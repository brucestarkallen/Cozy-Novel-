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


async def layer_cost(pg, dpr):
    """The pictures the phone keeps apart to move the room (composited layers):
    how much memory they hold at this pixel density, and how many are the size
    of the screen. The page's own scrolling words are left out: the browser
    keeps only what is near the screen of those."""
    session = await pg.context.new_cdp_session(pg)
    got = asyncio.get_running_loop().create_future()
    session.on('LayerTree.layerTreeDidChange', lambda ev: got.done() or got.set_result(ev['layers']))
    await session.send('DOM.enable')
    await session.send('LayerTree.enable')
    await pg.evaluate("document.body.style.setProperty('--walk-poke', String(Math.random()))")
    layers = await asyncio.wait_for(got, 5)
    await session.send('LayerTree.disable')
    screen = await pg.evaluate('[innerWidth, innerHeight]')
    page = await pg.evaluate("(() => { const w = document.querySelector('#pageWrap'); return [w.clientWidth, w.scrollHeight]; })()")
    total, big, rows = 0, 0, []
    for layer in layers:
        if not layer.get('drawsContent'):
            continue
        name = '?'
        try:
            node = (await session.send('DOM.describeNode', {'backendNodeId': layer['backendNodeId']}))['node']
            attrs = node.get('attributes', [])
            name = node['nodeName'] + ''.join(f' {attrs[i]}={attrs[i + 1][:24]}' for i in range(0, len(attrs) - 1, 2) if attrs[i] in ('id', 'class'))
        except Exception:
            pass
        w, h = layer.get('width', 0), layer.get('height', 0)
        if 'id=pageWrap' in name or (abs(w - page[0]) <= 1 and abs(h - page[1]) <= 2):
            continue  # the page's own words (the scrolling box and what scrolls in it): the browser keeps only what is near the screen of those
        mb = w * h * dpr * dpr * 4 / 1e6
        total += mb
        if w * h >= screen[0] * screen[1] * .9:
            big += 1
        rows.append((round(mb, 1), int(w), int(h), name))
    await session.detach()
    rows.sort(reverse=True)
    return {'mb': round(total), 'screenSized': big, 'rows': rows[:8]}


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

    # The desk at a phone's pixel density: the pictures the phone keeps apart for
    # the room must stay small. Before 2.12.5 the rooms kept 72–130 MB of them,
    # four or five the size of the screen (the room, its veil, the drawing split
    # by its moving pieces, the rain at 1.4 screens with a mask each) — on a
    # phone the words were dropped and drawn again as he scrolled: the flashing.
    dense = await browser.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True, device_scale_factor=3)
    pg = await dense.new_page()
    pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    await H.new_book(pg, 'A Room Kept Light')
    for world in ('academy', 'tokyo', 'study'):
        await look(pg, theme=world, mode='dark', motion='on')
        await frames(pg, 30)
        cost = await layer_cost(pg, 3)
        print(f'       {world} desk layers at 3x: {cost}', flush=True)
        check(f'{world}: the desk keeps at most 90 MB of pictures apart for the room at a phone\'s density, no more than two the size of the screen beside the rain',
              cost['mb'] <= 90 and cost['screenSized'] <= (4 if world == 'tokyo' else 2), cost)
    # the shelf scrolls in its own box: the document never moves, so the browser's bar never slides the room with it
    await pg.evaluate("location.hash='#/'")
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)')
    await frames(pg, 10)
    shelf = await pg.evaluate("""async () => { const s = document.querySelector('#shelf');
      const st = getComputedStyle(document.documentElement);
      s.scrollTop = 300; await new Promise(r => requestAnimationFrame(r));
      return { boxScrolled: s.scrollTop, documentScrolled: scrollY, documentOverflow: st.overflowY, bodyOverflow: getComputedStyle(document.body).overflowY,
               tallerThanScreen: s.getBoundingClientRect().height > innerHeight, roomTop: document.querySelector('.room').getBoundingClientRect().top }; }""")
    check('the shelf scrolls inside its own box; the document never scrolls and the room stays put',
          shelf['boxScrolled'] > 0 and shelf['documentScrolled'] == 0 and shelf['documentOverflow'] == 'hidden' and shelf['bodyOverflow'] == 'hidden' and shelf['tallerThanScreen'] and shelf['roomTop'] == 0, shelf)
    check('dense-screen checks have no page errors', not logs, logs)
    await dense.close()


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
