"""Stable manuscript DOM and bounded redraw/stream work on long chapters.

The real server and browser, synthetic records, no paid provider. Timing is
reported as evidence; assertions use work/identity rather than machine speed.
"""
import asyncio
import os
import sys
import traceback
import harness as H
from playwright.async_api import async_playwright
DRAWN_THE_SAME = r"""async () => {
  const { drawProse, growProse, sourceOffset } = await import('/js/ui/prose.js');
  const { streamLines } = await import('/js/ui/live.js');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bits = ['The rain ', 'came in. ', '“You should ', 'have stayed,” ', 'she said. ', '\n\n', '*soft* ', '**loud** ', '\n', '* * *', '# Heading', '   ', 'end'];
  const bad = [];
  for (let run = 0; run < 40; run++) {
    const a = document.createElement('div'), b = document.createElement('div'), s1 = document.createElement('div'), s2 = document.createElement('div');
    let text = '';
    const tint = run % 2 === 0;
    for (let step = 0; step < 60; step++) {
      const r = rnd();
      if (r < 0.75) { const many = 1 + Math.floor(rnd() * 3); for (let j = 0; j < many; j++) text += bits[Math.floor(rnd() * bits.length)]; }
      else if (r < 0.85) text = text.slice(0, Math.floor(rnd() * text.length));
      else if (r < 0.95 && text.length > 4) { const i = Math.floor(rnd() * text.length); text = text.slice(0, i) + bits[Math.floor(rnd() * bits.length)] + text.slice(i); }
      else text = '';
      growProse(a, text, { tint }); drawProse(b, text, { tint });
      if (a.innerHTML !== b.innerHTML) { bad.push(['prose', run, step]); break; }
      const pa = [...a.querySelectorAll('p')], pb = [...b.querySelectorAll('p')];
      for (let i = 0; i < pa.length; i++) {
        const ta = pa[i].firstChild, tb = pb[i].firstChild;
        if (ta && tb && sourceOffset(ta, 0) !== sourceOffset(tb, 0)) { bad.push(['where it stands', run, step, i]); break; }
      }
      for (const blocks of [true, false]) {
        const box = blocks ? s1 : s2;
        streamLines(box, text, { blocks });
        const got = blocks ? [...box.childNodes].map((n) => n.textContent).join('\n') : box.textContent;
        if (got !== text) { bad.push(['lines', blocks, run, step]); break; }
      }
    }
  }
  return bad;
}"""
H.PORT = int(os.environ.get('COZY_TEST_PORT', '23181'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '23199'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok)))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:450]}]'), flush=True)


async def scenario(browser):
    logs=[]
    pg=await H.page(browser,logs,w=360)
    await H.new_book(pg,'Performance by the Window')
    await pg.evaluate("""async()=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js');
      s.change('house','house',h=>{h.roles={...h.roles,helper:'off',checker:'off'};});
      s.change('chapter',d.deskState().chapterId,c=>{
        c.passages=Array.from({length:60},(_,i)=>({id:'perf-p'+i,by:'ai',pick:0,
          versions:Array.from({length:4},(_,j)=>({id:'perf-v'+i+'-'+j,
            text:('Paragraph '+i+'. The rain moves past the window.\\n').repeat(12),
            thinking:'Earlier thinking. '.repeat(1500),
            ask:{direction:'Extensive earlier instructions. '.repeat(800)},how:'write',at:1}))}));
      });await s.flush();
    }""")
    await pg.wait_for_function('document.querySelectorAll(".passage").length===60')
    measured=await pg.evaluate("""async()=>{
      const d=await import('/js/ui/desk.js');
      const stringify=JSON.stringify;let chars=0,calls=0;
      JSON.stringify=function(...args){const out=stringify(...args);chars+=out.length;calls++;return out;};
      const started=performance.now();
      try {for(let i=0;i<10;i++)d.drawPage();}
      finally {JSON.stringify=stringify;}
      return {ms:performance.now()-started,chars,calls};
    }""")
    print('  redraw measurement: '+str(measured),flush=True)
    check('unchanged page draws never serialize stored versions or requests',measured['chars']==0,measured)
    retained=await pg.evaluate("""async()=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js');
      const nodes=[...document.querySelectorAll('.passage')],prose=nodes[0].querySelector('.prose p');
      const range=document.createRange();range.setStart(prose.firstChild,0);range.setEnd(prose.firstChild,9);
      getSelection().removeAllRanges();getSelection().addRange(range);
      const c=s.peek('chapter',d.deskState().chapterId);c.passages=structuredClone(c.passages);d.drawPage();
      return {kept:nodes.filter(n=>n.isConnected).length,selected:getSelection().toString()};
    }""")
    check('equal records from another save retain every passage element',retained['kept']==60,retained)
    check('equal records preserve selected story words',retained['selected']=='Paragraph',retained)
    changed=await pg.evaluate("""async()=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js');
      getSelection().removeAllRanges();
      const first=document.querySelector('.passage .prose p'),last=document.querySelector('.passage:last-child .prose p');
      const c=s.peek('chapter',d.deskState().chapterId);c.passages[59].versions[0].text+='New words arrive.';d.drawPage();
      return {first:first.isConnected,last:last.isConnected,words:document.querySelector('.passage:last-child .prose').textContent.endsWith('New words arrive.')};
    }""")
    check('one changed passage retains the other prose and its own unchanged paragraphs',changed['first'] and changed['last'] and changed['words'],changed)
    controls=await pg.evaluate("""async()=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js');
      const old=document.querySelector('.passage:last-child .prose p');
      const c=s.peek('chapter',d.deskState().chapterId);c.passages[59].versions[0].cut=true;d.drawPage();
      return {kept:old.isConnected,go:document.querySelector('.passage:last-child .pctl').textContent.includes('Go on')};
    }""")
    check('changed version controls update without replacing the story',controls['kept'] and controls['go'],controls)
    # Clicking between passages changes controls, not the existing prose nodes.
    selected=await pg.evaluate("""()=>{
      const nodes=[...document.querySelectorAll('.passage .prose > p')];
      document.querySelector('.passage').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return {kept:nodes.every(n=>n.isConnected),chosen:document.querySelector('.passage').classList.contains('selected')};
    }""")
    check('choosing another passage preserves all manuscript paragraph nodes',selected['kept'] and selected['chosen'],selected)
    await pg.locator('.passage.selected').get_by_role('button',name='Edit',exact=True).click()
    edit=pg.locator('.editbox');await edit.fill('  My exact words while notes settle.  ')
    edit_result=await pg.evaluate("""async()=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js'),box=document.querySelector('.editbox');
      box.focus();box.setSelectionRange(5,12);
      const c=s.peek('chapter',d.deskState().chapterId);c.passages=structuredClone(c.passages);d.drawPage();
      return {same:box===document.querySelector('.editbox'),focused:document.activeElement===box,text:box.value,start:box.selectionStart,end:box.selectionEnd};
    }""")
    check('background copies keep the exact open edit, focus and caret',edit_result=={'same':True,'focused':True,'text':'  My exact words while notes settle.  ','start':5,'end':12},edit_result)
    await pg.locator('.editrow').get_by_role('button',name='Cancel',exact=True).click()
    await pg.locator('#direction').fill('  An unsent direction.  ')
    chips=await pg.evaluate("""async()=>{
      const d=await import('/js/ui/desk.js'),ids=['lengthBtn','outcomeBtn','writerBtn','writeBtn'];
      const nodes=ids.map(id=>document.getElementById(id).firstChild),box=document.getElementById('direction');box.focus();box.setSelectionRange(4,9);
      for(let i=0;i<10;i++)d.drawComposer();
      return {same:nodes.every((n,i)=>n===document.getElementById(ids[i]).firstChild),focus:document.activeElement===box,text:box.value,start:box.selectionStart,end:box.selectionEnd};
    }""")
    check('unchanged composer labels keep their DOM and exact draft caret',chips=={'same':True,'focus':True,'text':'  An unsent direction.  ','start':4,'end':9},chips)
    bad=await pg.evaluate(DRAWN_THE_SAME)
    check('incremental prose and thinking match full rendering through 2400 random edits',not bad,bad[:3])
    streams=await pg.evaluate("""async()=>{
      const {streamLines}=await import('/js/ui/live.js'),{drawProse,growProse,sourceOffset}=await import('/js/ui/prose.js');
      const box=document.createElement('div');document.body.append(box);
      let text='A thought about the warm window.\\n'.repeat(3000)+'The ending';
      streamLines(box,text,{blocks:true});const first=box.firstChild,last=box.lastChild.firstChild;
      const split=String.prototype.split;let splitChars=0;
      String.prototype.split=function(...args){splitChars+=this.length;return split.apply(this,args);};
      try {for(let i=0;i<30;i++){text+=' gently';streamLines(box,text,{blocks:true});}}
      finally {String.prototype.split=split;}
      const exact=[...box.children].map(x=>x.textContent).join('\\n')===text;
      const kept=first===box.firstChild&&last===box.lastChild.firstChild;box.remove();
      const prose=document.createElement('div');document.body.append(prose);drawProse(prose,'The window glows.');
      const para=prose.firstChild,node=para.firstChild,r=document.createRange();r.setStart(node,4);r.setEnd(node,10);getSelection().removeAllRanges();getSelection().addRange(r);
      growProse(prose,'The window glows. She smiles.');
      const out={splitChars,exact,kept,paragraph:para===prose.firstChild,node:node===para.firstChild,selection:getSelection().toString(),offset:sourceOffset(node,10)};
      getSelection().removeAllRanges();prose.remove();return out;
    }""")
    check('long streamed thinking only splits its unfinished tail',streams['splitChars']<10000,streams)
    check('streamed thinking preserves its first and growing text nodes exactly',streams['exact'] and streams['kept'],streams)
    check('growing prose retains paragraph, text selection and source offsets',streams['paragraph'] and streams['node'] and streams['selection']=='window' and streams['offset']==10,streams)
    await pg.set_viewport_size({'width':853,'height':915})
    await pg.wait_for_function('innerWidth===853')
    await pg.evaluate("document.querySelector('#pageWrap').scrollTop=1e8")
    await pg.wait_for_function('document.querySelector("#whereNow").textContent.includes("Passage 60 of 60")')
    check('the cached passage index follows the last passage after unfolding',(await pg.locator('#whereNow').inner_text()).strip()=='· Passage 60 of 60')
    opened=await pg.evaluate("""async()=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js'),sh=await import('/js/novel/shape.js');
      const state=d.deskState(),n=s.peek('novel',state.novelId),source=s.peek('chapter',state.chapterId),fresh=sh.newChapter(n.id);
      fresh.name='A second long chapter';
      fresh.passages=source.passages.map(p=>({...p,versions:[{...sh.picked(p),thinking:''}],pick:0}));
      await s.create('chapter',fresh.id,fresh);s.change('novel',n.id,sh.novelSteps.addChapter(fresh.id,source.id));await s.flush();
      const old=document.querySelector('.passage'),started=performance.now();
      await d.openChapter(n.id,fresh.id);
      return {ms:performance.now()-started,count:document.querySelectorAll('.passage').length,priorGone:!old.isConnected,name:document.querySelector('#chapname').textContent};
    }""")
    print('  chapter open measurement: '+str(opened),flush=True)
    check('opening another long chapter draws its own handlers even when passage IDs match',opened['count']==60 and opened['priorGone'] and opened['name']=='A second long chapter',opened)
    check('the performance audit makes no model calls',not H.reqs())
    check('the desk performance paths have no browser exceptions',not [x for x in logs if x.startswith('PAGEERROR')],logs)
    await pg.context.close()


async def scenario_branch_stream(browser):
    logs=[]
    pg=await H.page(browser,logs,w=360)
    await H.new_book(pg,'The Original Window')
    await pg.locator('#direction').fill('The branch keeps its own quiet room.')
    await pg.locator('#mineBtn').click()
    await pg.wait_for_function('document.querySelectorAll(".passage").length===1')
    ids=await pg.evaluate("""async port=>{
      const s=await import('/js/store.js'),d=await import('/js/ui/desk.js'),b=await import('/js/novel/branching.js');
      const {novelId,chapterId}=d.deskState(),passageId=s.peek('chapter',chapterId).passages[0].id;
      s.change('house','house',h=>{h.connections=[{id:'local-perf',name:'Local performance test',url:`http://127.0.0.1:${port}/v1`,model:'fake-writer',key:'test-key'}];h.roles={writer:'local-perf',helper:'off',checker:'off'};});
      await s.flush();const copied=await b.branchStory({novelId,name:'A quiet alternative'});
      if(!copied.ok)throw new Error(copied.error);window.perfDesk=d;
      return {novelId,chapterId,passageId,branchId:copied.novelId,branchChapter:copied.chapterId};
    }""",H.PROV)
    await pg.evaluate("""async ids=>{
      const w=await import('/js/novel/writer.js');window.perfStream=w.rewrite({...ids,note:'SLOW open the window in the original story.'});
    }""",ids)
    await pg.wait_for_function('document.querySelector(".passage.streaming .prose")?.textContent.length>30')
    check('the local writer is actually streaming the original shared passage',await pg.evaluate('id=>window.perfDesk.deskState().live.has(id)',ids['passageId']))
    await pg.evaluate('ids=>location.hash=`#/n/${ids.branchId}/${ids.branchChapter}`',ids)
    await pg.wait_for_function('id=>window.perfDesk.deskState().novelId===id',arg=ids['branchId'])
    branch=await pg.evaluate("""()=>({text:document.querySelector('.passage .prose').textContent,live:window.perfDesk.deskState().live.size,streaming:Boolean(document.querySelector('.passage.streaming'))})""")
    check('a branch with copied passage IDs never shows its original book’s live words',branch=={'text':'The branch keeps its own quiet room.','live':0,'streaming':False},branch)
    await pg.evaluate("""async id=>{(await import('/js/novel/writer.js')).stop(id);await window.perfStream;}""",ids['novelId'])
    settled=await pg.evaluate("""()=>({text:document.querySelector('.passage .prose').textContent,live:window.perfDesk.deskState().live.size})""")
    check('finishing the background source leaves the branch text and live state independent',settled=={'text':'The branch keeps its own quiet room.','live':0},settled)
    await pg.evaluate('ids=>location.hash=`#/n/${ids.novelId}/${ids.chapterId}`',ids)
    await pg.wait_for_function('id=>window.perfDesk.deskState().novelId===id',arg=ids['novelId'])
    original=await pg.evaluate("""async ids=>{
      const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');
      const text=sh.picked(s.peek('chapter',ids.chapterId).passages[0]).text;
      return {text,same:document.querySelector('.passage .prose').textContent===text,live:window.perfDesk.deskState().live.size};
    }""",ids)
    check('returning to the original shows its own saved stream without a stale live overlay',original['same'] and original['live']==0 and original['text']!='The branch keeps its own quiet room.',original)
    check('cross-book streaming produces no browser exceptions',not [x for x in logs if x.startswith('PAGEERROR')],logs)
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(executable_path=os.environ.get('COZY_TEST_CHROMIUM','/usr/bin/chromium'))
            try:
                await scenario(browser)
                await scenario_branch_stream(browser)
            except Exception:
                traceback.print_exc();check('desk performance scenario ran to the end',False,traceback.format_exc()[-600:])
            await browser.close()
    bad=[r for r in RESULTS if not r[1]]
    print(f'\ndesk performance: {len(RESULTS)-len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)
if __name__=='__main__':asyncio.run(main())
