"""Repeatable, synthetic browser performance profile; no FPS pass/fail threshold.

Run against an untouched archive and the working tree with the SAME options:
  COZY_PROFILE_APP=/tmp/cozy-perf-baseline python3 tests/browser/profile_performance.py --output /tmp/before.json
  python3 tests/browser/profile_performance.py --output /tmp/after.json

Chromium is headless, normally 60 Hz. CPU throttling approximates less available
CPU; it does not emulate an actual phone GPU or establish 120 Hz performance.
Only temporary books and the local stand-in provider are used. JSON includes
rAF gaps, long tasks, rendering work, removed DOM subtrees and browser errors.
"""
import argparse
import asyncio
import json
import os
import pathlib
import statistics
import time

import harness as H
from playwright.async_api import async_playwright

H.APP = os.environ.get('COZY_PROFILE_APP', H.APP)
H.PORT = int(os.environ.get('COZY_TEST_PORT', '23881'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '23899'))
TRACE_DIR = None

FIXTURE = r"""async port => {
  const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js'),t=await import('/js/novel/talk.js');
  const nid=location.hash.split('/')[2],cid=s.peek('novel',nid).order[0];
  const paragraph='Mara carried the lantern down the winding stairs. Beyond the rain-streaked glass, the harbor lights trembled on the tide. Rowan waited beside the door with a folded letter in his hand. “There is still time,” he said, though neither of them believed it. She took the letter and let the silence answer for her.';
  const passages=Array.from({length:80},(_,i)=>sh.newPassage('you',Array.from({length:6},(_,j)=>`${paragraph} Passage ${i+1}, paragraph ${j+1}.`).join('\n\n')));
  s.change('house','house',h=>{h.connections=[{id:'local',name:'Local stand-in',url:`http://127.0.0.1:${port}/v1`,key:'test-key',model:'fake-writer',context:1000000}];h.roles={writer:'',partner:'local',helper:'',checker:'off'};});
  s.change('chapter',cid,c=>{c.name='The long night';c.passages=passages;});
  s.change('novel',nid,n=>{n.notes.people=Array.from({length:100},(_,i)=>sh.newCard('people',{id:'person'+i,name:'Keeper '+i,about:paragraph,ties:'Waits for Mara by the harbor.',now:'At the lighthouse.'}));n.meta.words=30000;});
  await t.ensureTalk(nid);
  s.change('talk',nid,x=>{x.turns=Array.from({length:36},(_,i)=>sh.newTurn(i%2?'ai':'you',i%2?paragraph+'\n\n'+paragraph:'Consider the next scene at the harbor.'));});
  await s.flush();
  return {nid,cid,words:passages.reduce((a,p)=>a+p.versions[0].text.split(/\s+/).length,0),passages:80,cards:100,turns:36};
}"""

START = r"""() => {
  const p=window.__profile={gaps:[],longTasks:[],mutations:0,removed:{passages:0,turns:0,cards:0,other:0},events:[],clickFrames:[],start:performance.now(),active:true};
  let last;
  const frame=t=>{if(!p.active)return;if(last!==undefined)p.gaps.push(t-last);last=t;requestAnimationFrame(frame)};
  requestAnimationFrame(frame);
  p.longObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push(e.duration)});
  p.longObserver.observe({type:'longtask',buffered:false});
  p.eventTimingSupported=PerformanceObserver.supportedEntryTypes.includes('event');
  if(p.eventTimingSupported){
    p.eventObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.startTime>=p.start&&e.interactionId)p.events.push({name:e.name,ms:e.duration,inputDelay:Math.round((e.processingStart-e.startTime)*100)/100,processingMs:Math.round((e.processingEnd-e.processingStart)*100)/100,interactionId:e.interactionId})});
    p.eventObserver.observe({type:'event',durationThreshold:16,buffered:false});
  }
  // Event Timing is browser-rounded and omits events below 16 ms. The second
  // rAF is a separate frame-opportunity latency proxy, not INP or a physical display measurement.
  p.clickListener=e=>{const start=e.timeStamp;requestAnimationFrame(()=>requestAnimationFrame(()=>p.clickFrames.push(performance.now()-start)))};
  window.addEventListener('click',p.clickListener,true);
  p.mutationObserver=new MutationObserver(list=>{
    p.mutations+=list.length;
    for(const m of list)for(const n of m.removedNodes){if(n.nodeType!==1)continue;
      for(const [key,selector] of [['passages','.passage'],['turns','.turn'],['cards','.notecard']])p.removed[key]+=(n.matches(selector)?1:0)+n.querySelectorAll(selector).length;
      p.removed.other++;
    }
  });
  p.mutationObserver.observe(document.body,{subtree:true,childList:true});
}"""
STOP = r"""() => {const p=window.__profile;p.active=false;p.longObserver.disconnect();p.mutationObserver.disconnect();p.eventObserver?.disconnect();window.removeEventListener('click',p.clickListener,true);return {events:p.events,eventTimingSupported:p.eventTimingSupported,clickFrames:p.clickFrames,gaps:p.gaps,longTasks:p.longTasks,mutations:p.mutations,removed:p.removed,elapsed:performance.now()-p.start}}"""


def summarize(values):
    if not values:
        return {'count':0,'p50':0,'p95':0,'max':0,'total':0}
    values=sorted(values)
    return {'count':len(values),'p50':round(statistics.median(values),2),'p95':round(values[min(len(values)-1,int(len(values)*.95))],2),'max':round(values[-1],2),'total':round(sum(values),2)}


async def metric(cdp):
    return {x['name']:x['value'] for x in (await cdp.send('Performance.getMetrics'))['metrics']}


async def measure(pg,cdp,label,action,seconds):
    trace_done=asyncio.get_running_loop().create_future()
    def finished(ev):
        if not trace_done.done():trace_done.set_result(ev['stream'])
    cdp.on('Tracing.tracingComplete',finished)
    await cdp.send('Tracing.start',{'categories':'devtools.timeline'+(',disabled-by-default-devtools.timeline.stack' if TRACE_DIR else ''),'transferMode':'ReturnAsStream'})
    before=await metric(cdp)
    await pg.evaluate(START)
    task=asyncio.create_task(action()) if action else None
    await pg.wait_for_timeout(seconds*1000)
    if task:
        await task
    # Include every requested operation even when a slow baseline overruns.
    await pg.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    data=await pg.evaluate(STOP)
    after=await metric(cdp)
    await cdp.send('Tracing.end')
    stream=await asyncio.wait_for(trace_done,timeout=30)
    chunks=[]
    while True:
        part=await cdp.send('IO.read',{'handle':stream})
        chunks.append(part.get('data',''))
        if part.get('eof'):break
    await cdp.send('IO.close',{'handle':stream})
    cdp.remove_listener('Tracing.tracingComplete',finished)
    raw_trace=''.join(chunks)
    trace_path=None
    if TRACE_DIR:
        pathlib.Path(TRACE_DIR).mkdir(parents=True,exist_ok=True)
        trace_path=str(pathlib.Path(TRACE_DIR)/f'{label}-{time.time_ns()}.json')
        pathlib.Path(trace_path).write_text(raw_trace)
    trace=json.loads(raw_trace).get('traceEvents',[])
    rendering={name:{'count':0,'ms':0} for name in ['Paint','Layout','UpdateLayoutTree','CompositeLayers']}
    for event in trace:
        name=event.get('name')
        if name in rendering and event.get('ph')=='X':
            rendering[name]['count']+=1
            rendering[name]['ms']+=event.get('dur',0)/1000
    for value in rendering.values():value['ms']=round(value['ms'],2)
    result={'scenario':label,'elapsed_ms':round(data['elapsed']), 'raf_ms':summarize(data['gaps']),
      'frames_over_25ms':sum(x>25 for x in data['gaps']), 'frames_over_50ms':sum(x>50 for x in data['gaps']),
      'long_tasks_ms':summarize(data['longTasks']), 'event_timing_supported':data['eventTimingSupported'],'input_events':data['events'],'click_to_second_frame_ms':summarize(data['clickFrames']), 'removed':data['removed'],'mutation_records':data['mutations'],
      'work_ms':{name:round((after.get(name,0)-before.get(name,0))*1000,2) for name in ['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration']},'rendering':rendering}
    if trace_path:result['trace']=trace_path
    print(json.dumps(result),flush=True)
    return result


async def case(browser,width,theme,args):
    logs=[]
    H.reset()
    pg=await H.page(browser,logs,w=width,hgt=800 if width==360 else 1000)
    try:
        await H.new_book(pg,'Performance profile')
        fixture=await pg.evaluate(FIXTURE,H.PROV)
        await pg.wait_for_function('document.querySelectorAll("#passages > .passage").length===80')
        await pg.evaluate("""async theme=>{const s=await import('/js/store.js');s.change('house','house',h=>{h.look={...(h.look||{}),theme,mode:'dark',motion:'on'};});await s.flush();}""",theme)
        await pg.evaluate('document.fonts.ready')
        # Let the initial delayed helper/no-connection status and fonts settle.
        await pg.wait_for_timeout(3500)
        await pg.evaluate("import('/js/store.js').then(s=>s.flush())")
        cdp=await pg.context.new_cdp_session(pg)
        await cdp.send('Performance.enable')
        await cdp.send('Emulation.setCPUThrottlingRate',{'rate':args.cpu})
        rows=[]
        rows.append(await measure(pg,cdp,'idle',None,args.seconds))
        async def click_more():
            await pg.locator('#moreBtn').click()
            await pg.locator('.menu-pop').wait_for(state='visible')
        rows.append(await measure(pg,cdp,'open_more_menu',click_more,1))
        await pg.keyboard.press('Escape')
        await pg.locator('.menu-pop').wait_for(state='detached')
        async def click_notes():
            await pg.locator('#notesBtn').click()
            await pg.wait_for_function('document.querySelector("#sidePane").classList.contains("open")')
        rows.append(await measure(pg,cdp,'open_notes_pane',click_notes,1))
        await pg.evaluate('window.__profileNotes=[...document.querySelectorAll("#sideBody .notecard")]')
        await pg.locator('#sideClose').click()
        await pg.wait_for_function('!document.querySelector("#sidePane").classList.contains("open")')
        async def click_partner():
            await pg.locator('#partnerBtn').click()
            await pg.get_by_role('textbox',name='Ask your partner',exact=True).wait_for()
        rows.append(await measure(pg,cdp,'open_partner_pane',click_partner,1))
        async def return_to_notes():
            await pg.locator('#sideTabs button[data-tab="notes"]').click()
            await pg.wait_for_function('document.querySelector("#sidePane").dataset.tab==="notes"')
        rows.append(await measure(pg,cdp,'switch_back_to_notes',return_to_notes,1))
        rows[-1]['notes_reused_on_return']=await pg.evaluate('({total:window.__profileNotes.length,retained:window.__profileNotes.filter(node=>node.isConnected).length})')
        await pg.locator('#sideClose').click()
        await pg.wait_for_function('!document.querySelector("#sidePane").classList.contains("open")')
        if args.transitions_only:
            for row in rows:row.update({'width':width,'theme':theme})
            return {'width':width,'theme':theme,'fixture':fixture,'measurements':rows,'provider_calls':len(H.reqs()),'errors':logs}
        async def scroll():
            await pg.evaluate("""ms=>new Promise(resolve=>{const el=document.querySelector('#pageWrap'),start=performance.now();const tick=now=>{const progress=(now-start)/ms;el.scrollTop=Math.min(1,progress)*(el.scrollHeight-el.clientHeight);if(progress<1)requestAnimationFrame(tick);else resolve()};el.scrollTop=0;requestAnimationFrame(tick)})""",args.seconds*1000-250)
        rows.append(await measure(pg,cdp,'long_manuscript_scroll',scroll,args.seconds))
        async def remote_save():
            nid,cid=fixture['nid'],fixture['cid']
            for i in range(6):
                response=await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/store/chapter/{cid}')
                record=await response.json()
                record['data']['passages'][0]['versions'][0]['text']+=' A bell rang.'
                result=await pg.request.put(f'http://127.0.0.1:{H.PORT}/api/store/chapter/{cid}',headers={'X-Base':str(record['rev']),'X-Client':'profile-second-window'},data={'data':record['data']})
                if result.status!=200:raise AssertionError(f'Remote save failed: {result.status}')
                await pg.evaluate("async id=>(await import('/js/store.js')).open('chapter',id,{fresh:true})",cid)
                await pg.wait_for_timeout((args.seconds*1000-600)/6)
        rows.append(await measure(pg,cdp,'remote_passage_save',remote_save,args.seconds))
        await pg.evaluate("import('/js/ui/panes.js').then(p=>p.showSide('notes'))")
        await pg.wait_for_timeout(600)
        async def update_notes():
            await pg.evaluate("""async ms=>{const s=await import('/js/store.js'),id=location.hash.split('/')[2];for(let i=0;i<12;i++){s.change('novel',id,n=>{n.notes.people[0].now='At the lighthouse, turn '+i+'.';n.memory.at=Date.now();},{now:true});await new Promise(r=>setTimeout(r,(ms-400)/12));}await s.flush();}""",args.seconds*1000)
        rows.append(await measure(pg,cdp,'saved_notes_updates',update_notes,args.seconds))
        await pg.evaluate("import('/js/ui/panes.js').then(p=>p.showSide('partner'))")
        await pg.get_by_role('textbox',name='Ask your partner',exact=True).wait_for()
        await pg.wait_for_timeout(600)
        async def stream():
            await pg.get_by_role('textbox',name='Ask your partner',exact=True).fill('SLOW Please consider the letter from her brother.')
            await pg.locator('#sideFoot').get_by_role('button',name='Send',exact=True).click()
        rows.append(await measure(pg,cdp,'partner_stream',stream,args.seconds))
        await pg.evaluate("async()=>{const t=await import('/js/novel/talk.js');t.stopTalk('talk',location.hash.split('/')[2])}")
        for _ in range(100):
            if not await pg.evaluate("async()=>{const t=await import('/js/novel/talk.js');return t.anyTalking()}"):break
            await pg.wait_for_timeout(50)
        for row in rows:row.update({'width':width,'theme':theme})
        return {'width':width,'theme':theme,'fixture':fixture,'measurements':rows,'provider_calls':len(H.reqs()),'errors':logs}
    finally:
        await pg.context.close()


async def main(args):
    global TRACE_DIR
    TRACE_DIR=args.trace_dir
    with H.Env():
        async with async_playwright() as p:
            browser=await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None),headless=True,args=['--no-sandbox'])
            output={'app':str(pathlib.Path(H.APP).resolve()),'cpu_throttle':args.cpu,'seconds':args.seconds,'repeats':args.repeats,'browser':browser.version,'note':'Headless Chromium rAF is normally 60 Hz; these are controlled diagnostics, not a physical phone or 120 Hz claim.','cases':[]}
            try:
                for repeat in range(args.repeats):
                    for width in args.widths:
                        for theme in args.themes:
                            print(f'PROFILE repeat={repeat+1} width={width} theme={theme}',flush=True)
                            result=await case(browser,width,theme,args)
                            result['repeat']=repeat+1
                            output['cases'].append(result)
                            pathlib.Path(args.output).write_text(json.dumps(output,indent=2)+'\n')
            finally:
                await browser.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    parser.add_argument('--cpu',type=float,default=4)
    parser.add_argument('--repeats',type=int,default=1)
    parser.add_argument('--trace-dir',help='Also keep raw Chrome traces with JavaScript stacks for diagnosis')
    parser.add_argument('--transitions-only',action='store_true',help='Measure idle and opening/switching menus and panes only')
    parser.add_argument('--seconds',type=float,default=4)
    parser.add_argument('--widths',type=int,nargs='+',default=[360,853])
    parser.add_argument('--themes',nargs='+',default=['academy','tokyo','study'])
    args=parser.parse_args()
    if args.seconds<1 or args.cpu<1 or args.repeats<1:
        parser.error('seconds, CPU throttle and repeats must each be at least 1')
    asyncio.run(main(args))
