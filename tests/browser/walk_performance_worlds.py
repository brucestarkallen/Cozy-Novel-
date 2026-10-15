"""The illustrated rooms move without repainting or relaying out every frame.

Uses real Chromium tracing, a temporary library and no model calls. Counts
browser work rather than asserting a frame rate on a shared test machine.
"""
import asyncio
import collections
import os
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '20761'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '20762'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:500]}]'), flush=True)


async def look(pg, **values):
    await pg.evaluate("async look => (await import('/js/ui/look.js')).applyLook(look)", values)


async def frames(pg, count=45):
    return await pg.evaluate("""count => new Promise(resolve => {
      let prior, remaining = count; const gaps = [];
      function tick(t) {
        if (prior !== undefined) gaps.push(t - prior);
        prior = t;
        if (remaining--) requestAnimationFrame(tick); else resolve(gaps);
      }
      requestAnimationFrame(tick);
    })""", count)


async def trace_motion(pg):
    session = await pg.context.new_cdp_session(pg)
    events, finished = [], asyncio.Event()
    session.on('Tracing.dataCollected', lambda event: events.extend(event['value']))
    session.on('Tracing.tracingComplete', lambda _: finished.set())
    await session.send('Tracing.start', {
        'categories': 'devtools.timeline,disabled-by-default-devtools.timeline',
        'transferMode': 'ReportEvents',
    })
    gaps = await frames(pg)
    await session.send('Tracing.end')
    await asyncio.wait_for(finished.wait(), 10)
    await session.detach()
    counts = collections.Counter(event['name'] for event in events if event.get('ph') == 'X')
    return {'frames': len(gaps), 'layouts': counts['Layout'], 'paints': counts['Paint']}


async def running(pg):
    return await pg.evaluate("""() => document.querySelector('.room')
      .getAnimations({subtree:true}).filter(a => a.playState === 'running').length""")


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs, w=360, hgt=844)
    await pg.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])')
    await pg.wait_for_timeout(900)  # Finish the one-time shelf entrance.
    for width in (360, 853):
        await pg.set_viewport_size({'width': width, 'height': 844})
        for world in ('academy', 'tokyo', 'study'):
            for mode in ('dark', 'light'):
                await look(pg, theme=world, mode=mode, motion='on')
                await frames(pg, 20)  # Newly mounted scenery may raster once.
                count = await running(pg)
                check(f'{world} {mode} at {width}px retains ambient movement', count > 0, count)
                work = await trace_motion(pg)
                print(f'       {world} {mode} {width}px browser work: {work}', flush=True)
                check(f'{world} {mode} at {width}px does not lay out or repaint each animation frame',
                      work['layouts'] <= 2 and work['paints'] <= 6, work)

    same = await pg.evaluate("""async () => {
      const {applyLook} = await import('/js/ui/look.js');
      const look = {theme:'academy',mode:'dark',motion:'on'};
      applyLook(look); const scene = document.querySelector('.world-scene');
      let count = 0; const observer = new MutationObserver(records => count += records.length);
      observer.observe(document.documentElement, {subtree:true,attributes:true,childList:true,characterData:true});
      for (let n=0; n<40; n++) applyLook({...look});
      await Promise.resolve(); observer.disconnect();
      return {count, same:scene===document.querySelector('.world-scene')};
    }""")
    check('repeated saved appearance updates make no DOM changes or room replacements',
          same == {'count': 0, 'same': True}, same)

    await look(pg, theme='academy', mode='light', motion='off')
    check('Pause stops every Academy motion surface', await running(pg) == 0)
    await look(pg, theme='tokyo', mode='dark', motion='on')
    await pg.emulate_media(reduced_motion='reduce')
    check('device reduced motion stops every Tokyo motion surface', await running(pg) == 0)
    await pg.emulate_media(reduced_motion='no-preference')
    check('lifting device reduced motion restores the selected movement', await running(pg) > 0)
    await pg.evaluate("document.documentElement.dataset.pageHidden='true'")
    check('a resting page pauses all ambient movement', await running(pg) == 0)
    await pg.evaluate("document.documentElement.dataset.pageHidden='false'")
    check('returning to a page restores ambient movement', await running(pg) > 0)

    # A world selected while the room is hidden has no measurable SVG bounds.
    # Showing it later must prepare its motion without replacing the scene.
    await look(pg, theme='academy', room='off', motion='on')
    await look(pg, theme='academy', room='on', motion='on')
    await frames(pg, 20)
    work = await trace_motion(pg)
    check('showing a room first chosen while hidden uses the same efficient motion',
          await running(pg) > 0 and work['layouts'] <= 2 and work['paints'] <= 6, work)
    check('performance checks make no model calls', len(H.reqs()) == 0)
    check('world performance checks have no page errors', not logs, logs)
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            executable = os.environ.get('COZY_TEST_CHROMIUM')
            browser = await p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('performance scenario completed', False)
            finally:
                await browser.close()
    failed = [name for name, ok, _ in RESULTS if not ok]
    print(f'\n{len(RESULTS)-len(failed)}/{len(RESULTS)} performance world checks passed', flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
