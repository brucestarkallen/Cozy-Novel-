"""The room remains visible and stationary behind scrolling content.

Pixel comparisons use paused motion to distinguish room movement from ambient
animation. Desktop Chromium cannot emulate Android's browser toolbar or GPU
reclamation; those paths still need a physical-device check.
"""
import asyncio
import os
import sys
import traceback
import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '29181'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '29199'))
RESULTS = []


def check(name, ok):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name, flush=True)


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs, w=412, hgt=915)
    await H.new_book(pg, 'A room to return to')
    await pg.evaluate("""async()=>{
      const sh=await import('/js/novel/shape.js');
      for(let i=0;i<10;i++) {
        const n=sh.newNovel({title:'Room '+i});
        for(const [kind,data] of [['chapter',n.chapter],['novel',n.novel]]) {
          const r=await fetch('/api/store/'+kind+'/'+data.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});
          if(!r.ok) throw Error('fixture save failed');
        }
      }
    }""")
    await pg.click('#toShelf')
    await pg.wait_for_selector('#shelf:not([hidden]) .cover')
    for width in [412, 853]:
        await pg.set_viewport_size({'width': width, 'height': 915})
        for world in ['academy', 'tokyo', 'study']:
            for mode in ['dark', 'light']:
                await pg.evaluate("async l=>(await import('/js/ui/look.js')).applyLook(l)", {'theme': world, 'mode': mode, 'motion': 'off'})
                await pg.evaluate("async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))}")
                # Preserve layout and scroll height while comparing only the room.
                style = await pg.add_style_tag(content='#shelf, #toast { visibility:hidden !important; }')
                await pg.evaluate('scrollTo(0,0)')
                before = await pg.screenshot()
                await pg.evaluate('scrollTo(0,700)')
                after = await pg.screenshot()
                check(f'{width} {world} {mode}: scrolling leaves every room pixel still', before == after and await pg.evaluate('scrollY > 0'))
                await style.evaluate('(el)=>el.remove()')
    # Height-only changes must not swap between two different photographs.
    for width, expected in [(853, 'desktop.webp'), (412, 'mobile.webp')]:
        sources = []
        for height in [1080, 965, 520, 1080]:
            await pg.set_viewport_size({'width': width, 'height': height})
            await pg.evaluate("async()=>{await document.querySelector('.study-photo').decode()}")
            sources.append(await pg.locator('.study-photo').evaluate('e=>e.currentSrc'))
        check(f'{width}: height changes retain the same study photograph', all(src.endswith(expected) for src in sources))
    await pg.evaluate('scrollTo(0,0)')
    await pg.get_by_role('button', name='Open A room to return to', exact=True).click()
    await pg.wait_for_selector('#desk:not([hidden]) .page')
    for width in [360, 412, 853]:
        await pg.set_viewport_size({'width': width, 'height': 915})
        state = await pg.evaluate("""()=>{
          const page=document.querySelector('.page'),wrap=document.querySelector('#pageWrap');
          const p=page.getBoundingClientRect(),w=wrap.getBoundingClientRect(),s=getComputedStyle(wrap);
          return {center:Math.abs((p.left+p.right)-(w.left+w.right))<1,
            roomVisible:p.width<w.width, backing:s.backgroundImage.includes(getComputedStyle(page).backgroundColor),
            overflow:document.documentElement.scrollWidth>innerWidth};
        }""")
        check(f'{width}: centered solid paper leaves visible room gutters', all([state['center'], state['roomVisible'], state['backing'], not state['overflow']]))
    check('room review produces no browser exceptions or model calls', not [l for l in logs if l.startswith('PAGEERROR')] and not H.reqs())
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None))
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('room review completes', False)
            finally:
                await browser.close()
    print(f'room backing: {sum(RESULTS)} passed, {len(RESULTS)-sum(RESULTS)} failed')
    sys.exit(0 if RESULTS and all(RESULTS) else 1)


if __name__ == '__main__':
    asyncio.run(main())
