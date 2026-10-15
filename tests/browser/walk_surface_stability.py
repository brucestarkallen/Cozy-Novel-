"""Opaque scrolling/returning surfaces, retained scene setup, and input counts.
Temporary books and a local stand-in provider; no physical-phone FPS claim.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright
H.PORT = int(os.environ.get('COZY_TEST_PORT', '28581'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '28599'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f' [saw: {str(saw)[:500]}]'), flush=True)


async def frames(pg, count=3):
    await pg.evaluate('async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame)}', count)


async def show(pg, tab):
    await pg.evaluate("async tab=>(await import('/js/ui/panes.js')).showSide(tab)", tab)
    await frames(pg)


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs, w=412, hgt=915)
    await H.new_book(pg, 'Steady surfaces')
    await show(pg, 'play')
    who = pg.get_by_label('Who do you play?', exact=True)
    start = pg.get_by_placeholder('Right where the chapter leaves off', exact=True)
    await who.fill('Mara')
    await start.fill('  At the harbor.  ')
    await pg.evaluate("window.keptStart=document.querySelector('.scene-start');window.keptWho=keptStart.querySelector('input');keptWho.focus();keptWho.setSelectionRange(1,3)")
    for width, height in [(412, 520), (853, 1000)]:
        await pg.set_viewport_size({'width': width, 'height': height})
        await frames(pg, 5)
        state = await pg.evaluate("({same:keptStart.isConnected,focus:document.activeElement===keptWho,selection:[keptWho.selectionStart,keptWho.selectionEnd],value:keptWho.value})")
        check(f'scene setup retains fields, focus and selection at {width}×{height}', state == {'same': True, 'focus': True, 'selection': [1, 3], 'value': 'Mara'}, state)
    await show(pg, 'notes')
    await show(pg, 'play')
    check('scene setup retains both exact drafts across pane switches', await who.input_value() == 'Mara' and await start.input_value() == '  At the harbor.  ')
    await pg.evaluate("async()=>{await new Promise(r=>setTimeout(r,450));await(await import('/js/store.js')).flush()}")
    await pg.reload()
    await pg.wait_for_function('document.title.includes("Steady surfaces")')
    await show(pg, 'play')
    check('scene setup restores both drafts after reload', await who.input_value() == 'Mara' and await start.input_value() == '  At the harbor.  ')
    await pg.evaluate("""async port=>{const s=await import('/js/store.js');s.change('house','house',h=>{h.connections=[{id:'local',name:'Local',url:`http://127.0.0.1:${port}/v1`,key:'test-key',model:'fake-writer',context:100000}];h.roles={writer:'local',checker:'off',partner:'local'};});await s.flush();}""", H.PROV)
    await pg.get_by_role('button', name='Begin the scene', exact=True).click()
    await pg.wait_for_function('document.querySelector(".turn-tokens")?.textContent.includes("tokens sent")')
    ids = await pg.evaluate("""async()=>{const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');const nid=location.hash.split('/')[2],n=s.peek('novel',nid),p=s.peek('play',n.plays[0]),t=p.turns.find(t=>t.by==='ai'),v=sh.picked(t);await s.flush();return{nid,cid:n.order[0],pid:p.id,tid:t.id,vid:v.id,count:v.usage.in,label:v.usage.in.toLocaleString()+' tokens sent'}}""")
    check('the narrator shows the actual provider input count', ids['count'] > 0 and await pg.locator('.turn-tokens').inner_text() == ids['label'])
    await pg.locator('.tmore').last.click()
    await pg.get_by_role('menuitem', name='What was sent', exact=False).click()
    await pg.wait_for_selector('.sent-facts')
    sent = await pg.locator('[data-fact="Sent"]').inner_text()
    check('scene counter agrees with the saved request receipt', str(ids['count']) in sent.replace(',', '') and await pg.get_by_role('dialog').get_attribute('aria-label') == 'What the narrator was sent', sent)
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('.sentsheet', state='detached')
    await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('play',ids.pid,p=>{const t=p.turns.find(t=>t.id===ids.tid);t.versions.push({...t.versions[0],id:'estimated',usage:undefined,tokensIn:321,tokensCounted:undefined,sent:undefined});t.pick='estimated';});await s.flush();}""", ids)
    await pg.wait_for_function('document.querySelector(".turn-tokens")?.textContent==="About 321 tokens sent"')
    check('an estimated count is explicitly marked About', await pg.locator('.turn-tokens').inner_text() == 'About 321 tokens sent')
    await pg.get_by_role('button', name='The answer before', exact=True).click()
    await pg.wait_for_function('(label)=>document.querySelector(".turn-tokens")?.textContent===label', arg=ids['label'])
    check('switching answer versions restores the selected count', await pg.locator('.turn-tokens').inner_text() == ids['label'])
    await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('play',ids.pid,p=>{p.turns.find(t=>t.id===ids.tid).versions[0].usage.in=0});await s.flush();}""", ids)
    await pg.wait_for_function('document.querySelector(".turn-tokens")?.textContent==="0 tokens sent"')
    check('a usage-only update refreshes the counter, including a reported zero', await pg.locator('.turn-tokens').inner_text() == '0 tokens sent')
    await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('play',ids.pid,p=>{const t=p.turns.find(t=>t.id===ids.tid),v=t.versions[0];delete v.usage;delete v.tokensIn;delete v.tokensCounted;});await s.flush();}""", ids)
    await pg.wait_for_function('document.querySelector(".turn-tokens")?.textContent==="Tokens sent not recorded"')
    check('older answers with no count do not claim zero', await pg.locator('.turn-tokens').inner_text() == 'Tokens sent not recorded')
    await pg.get_by_role('button', name='All scenes', exact=True).click()
    await who.wait_for()
    check('successfully beginning a scene clears only the consumed setup', await who.input_value() == '' and await start.input_value() == '')
    # The scroll fixture is layout data, not a request to read 150 new passages.
    # The helper inherits the writer connection; only the checker supports off.
    await pg.evaluate("async()=>{const s=await import('/js/store.js');s.change('house','house',h=>{h.connections=[];h.roles={}});await s.flush()}")
    await pg.evaluate("import('/js/ui/panes.js').then(p=>p.closeRight())")
    await pg.evaluate("""async ids=>{const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');s.change('chapter',ids.cid,c=>{c.passages=Array.from({length:150},(_,i)=>sh.newPassage('you',`Passage ${i+1}. `+'The lighthouse shone through the rain. '.repeat(100)))});await s.flush();}""", ids)
    await pg.evaluate('document.fonts.ready')
    await frames(pg, 5)
    work = await pg.evaluate("""async()=>{const old=Element.prototype.getBoundingClientRect;let reads=0;Element.prototype.getBoundingClientRect=function(...args){reads++;return old.apply(this,args)};const box=document.querySelector('#pageWrap');try{for(let i=0;i<90;i++){box.scrollTop=(box.scrollHeight-box.clientHeight)*i/89;await new Promise(requestAnimationFrame)}}finally{Element.prototype.getBoundingClientRect=old}return{reads,last:document.querySelector('#whereNow').textContent}}""")
    check('a settled 150-passage scroll does not remeasure passage rectangles each frame', work['reads'] < 20 and '150 of 150' in work['last'], work)
    await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('chapter',ids.cid,c=>{c.passages[20].versions[0].text+=' A new paragraph. '.repeat(300)});await s.flush();}""", ids)
    await frames(pg, 5)
    at = await pg.evaluate("""async()=>{const p=document.querySelectorAll('#passages>.passage')[75],box=document.querySelector('#pageWrap');box.scrollTop+=p.getBoundingClientRect().top-box.getBoundingClientRect().top-box.clientHeight*.25+1;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return document.querySelector('#whereNow').textContent}""")
    check('the passage marker refreshes its geometry after earlier prose grows', '76 of 150' in at, at)
    # Exercise actual display surfaces through both lights and all rooms.
    for theme in ['academy', 'tokyo', 'study']:
        for mode in ['dark', 'light']:
            await pg.evaluate("async look=>(await import('/js/ui/look.js')).applyLook(look)", {'theme': theme, 'mode': mode, 'motion': 'on'})
            await frames(pg, 4)
            sample = await pg.evaluate("""async()=>{const box=document.querySelector('#pageWrap');box.scrollTop=box.scrollHeight;const values=[];for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);const s=getComputedStyle(box);values.push([s.opacity,s.backgroundImage,box.scrollTop,box.scrollHeight])}return{values,paper:getComputedStyle(document.querySelector('.page')).backgroundColor,root:getComputedStyle(document.documentElement).overscrollBehavior}}""")
            rows = sample['values']
            check(f'{theme} {mode}: bottom stays opaque, with stable geometry and no edge stretch', all(r[0] == '1' and sample['paper'] in r[1] and r[2:] == rows[0][2:] for r in rows) and sample['root'] == 'none', sample)
    # Exercise the application's visibility/resync handlers. This does not
    # emulate an Android GPU being reclaimed; that still needs a real device.
    await pg.evaluate("""() => {window.keptPage=document.querySelector('#passages>.passage');window.visibleTest='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibleTest});Object.defineProperty(document,'hidden',{configurable:true,get:()=>visibleTest==='hidden'});document.dispatchEvent(new Event('visibilitychange'));}""")
    await pg.wait_for_timeout(100)
    await pg.evaluate("visibleTest='visible';document.dispatchEvent(new Event('visibilitychange'))")
    await pg.wait_for_timeout(500)
    check('visibility resync retains the manuscript and its opaque scrolling surface', await pg.evaluate("keptPage.isConnected&&getComputedStyle(document.querySelector('#pageWrap')).opacity==='1'&&getComputedStyle(document.querySelector('#pageWrap')).backgroundImage.includes(getComputedStyle(document.querySelector('.page')).backgroundColor)"))
    await pg.evaluate("delete document.visibilityState;delete document.hidden")
    await pg.click('#moreBtn')
    check('an opened menu is opaque rather than fading through the room', await pg.locator('.menu-pop').evaluate("el=>getComputedStyle(el).opacity==='1'"))
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('.menu-pop', state='detached')
    await pg.evaluate("""async()=>{const d=await import('/js/ui/dom.js');window.testSheet=d.openSheet('Opaque sheet');testSheet.body.append(d.h('p','A steady reading surface.'));window.sheetOpacities=[];for(let i=0;i<8;i++){sheetOpacities.push(getComputedStyle(testSheet.wrap).opacity);await new Promise(requestAnimationFrame)}}""")
    check('sheet content stays opaque from its first frame', await pg.evaluate("sheetOpacities.every(v=>v==='1')"))
    await pg.evaluate('testSheet.close()')
    await pg.wait_for_selector('.sheet', state='detached')
    await pg.click('#toShelf')
    await pg.get_by_role('button', name='Open Steady surfaces', exact=True).wait_for()
    await pg.get_by_role('button', name='Open Steady surfaces', exact=True).click()
    await pg.wait_for_selector('#desk:not([hidden])')
    await pg.evaluate("""() => {window.shelfFrames=[];window.sampling=true;const tick=()=>{if(!document.querySelector('#shelf').hidden){shelfFrames.push([...document.querySelectorAll('.book,.shelf-welcome,.resume-card:not([hidden])')].every(el=>getComputedStyle(el).opacity==='1'))}if(sampling)requestAnimationFrame(tick)};requestAnimationFrame(tick)}""")
    await pg.click('#toShelf')
    await frames(pg, 12)
    check('returning to the shelf never restarts transparent cover/welcome fades', await pg.evaluate('sampling=false;shelfFrames.length>0&&shelfFrames.every(Boolean)'))
    check('the focused scenarios make only the requested narrator call', len(H.reqs()) == 1, len(H.reqs()))
    check('surface and token paths produce no browser exceptions', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=os.environ.get('COZY_TEST_CHROMIUM', '/usr/bin/chromium'), headless=True)
            try:
                await scenario(b)
            except Exception:
                traceback.print_exc()
                check('surface scenario completes', False)
            finally:
                await b.close()
    print(f'\nsurface stability: {sum(RESULTS)} passed, {len(RESULTS)-sum(RESULTS)} failed', flush=True)
    if not all(RESULTS):
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
