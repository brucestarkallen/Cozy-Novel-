"""Two illustrated worlds, four lights: choices stay, the writer's words stay.

Real browser and server, a temporary library and no model calls. The default
ports are independent of the main browser walks; environment overrides work.
"""
import asyncio
import os
import sys
import traceback
from urllib.parse import urlparse

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '19681'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '19699'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:350]}]'), flush=True)


async def state(pg):
    return await pg.evaluate("""() => {
      const {world, theme, mode, motion} = document.documentElement.dataset;
      return {world, theme, mode, motion};
    }""")


async def flush(pg):
    await pg.evaluate("import('/js/store.js').then(s=>s.flush())")


async def appearance(pg, shelf=False):
    if shelf:
        await pg.click('#shelfSettings')
    else:
        await pg.click('#moreBtn')
        await pg.click('.menu-pop button:has-text("Settings")')
    await pg.get_by_role('dialog', name='Settings', exact=True).wait_for()
    await pg.locator('.settings-nav [aria-controls="settings-look"]').click()


async def close_settings(pg):
    await pg.get_by_role('dialog', name='Settings', exact=True).get_by_role('button', name='Close', exact=True).click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.wait_for_timeout(230)


async def running_room_animations(pg):
    return await pg.evaluate("""() => document.querySelector('.room')
      .getAnimations({subtree:true}).filter(a=>a.playState==='running').length""")


CONTRAST = """() => {
  const sample = (name) => {
    const e = document.createElement('i'); e.style.color = `var(${name})`;
    document.body.append(e); const rgb = getComputedStyle(e).color; e.remove();
    return rgb.match(/[\\d.]+/g).slice(0, 3).map(Number);
  };
  const luminance = (rgb) => rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;})
    .reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const contrast = (a,b) => {a=luminance(sample(a));b=luminance(sample(b));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  return Object.fromEntries([
    ['story', '--ink', '--paper'], ['story guidance', '--ink-soft', '--paper'],
    ['controls', '--chrome-ink', '--chrome-solid'], ['quiet controls', '--chrome-soft', '--chrome-solid'],
    ['accent controls', '--accent', '--chrome-solid'], ['page actions', '--accent-on-paper', '--paper'],
    ['primary button', '--accent-ink', '--accent'], ['primary highlight', '--accent-ink', '--accent-2']
  ].map(([name,a,b])=>[name,Math.round(contrast(a,b)*100)/100]));
}"""


async def scenario_worlds(browser):
    """World and light controls persist and never change the book or its draft."""
    logs, requests = [], []
    pg = await H.page(browser, logs, w=360, hgt=844)
    pg.on('request', lambda req: requests.append(req.url))
    await pg.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])')
    check('a new room begins in Academy of Ink at night with animation on',
          await state(pg) == {'world': 'academy', 'theme': 'academy', 'mode': 'dark', 'motion': 'on'}, await state(pg))
    check('both worlds have visible manual controls', await pg.locator('#worldAcademy').is_visible() and await pg.locator('#worldTokyo').is_visible())

    await pg.locator('#worldTokyo').focus()
    await pg.keyboard.press('Enter')
    await pg.click('#modeToggle')
    await pg.click('#motionToggle')
    await flush(pg)
    expected = {'world': 'tokyo', 'theme': 'tokyo', 'mode': 'light', 'motion': 'off'}
    check('the shelf independently changes world, light and animation', await state(pg) == expected, await state(pg))
    check('world and animation buttons announce their selected states',
          await pg.locator('#worldTokyo').get_attribute('aria-pressed') == 'true' and
          await pg.locator('#worldAcademy').get_attribute('aria-pressed') == 'false' and
          await pg.locator('#motionToggle').get_attribute('aria-pressed') == 'false')
    await pg.reload()
    await pg.wait_for_selector('#shelf:not([hidden])')
    check('all three choices survive a reload', await state(pg) == expected, await state(pg))
    await pg.emulate_media(color_scheme='dark')
    check('the chosen daylight stays manual when the device prefers dark', (await state(pg))['mode'] == 'light')
    await pg.emulate_media(color_scheme='no-preference')
    stored = await pg.evaluate("async()=>{const s=await import('/js/store.js');return s.peek('house','house').look;}")
    check('the stored appearance uses canonical world, light and motion values', all(stored.get(k) == expected[k] for k in ('theme', 'mode', 'motion')), stored)

    other = await browser.new_context(viewport={'width': 1280, 'height': 900})
    pg2 = await other.new_page()
    await pg2.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg2.wait_for_selector('#shelf:not([hidden])')
    check('a separate browser opens with the same choices', await state(pg2) == expected, await state(pg2))
    await pg.click('#worldAcademy')
    await flush(pg)
    await pg2.wait_for_function("document.documentElement.dataset.world==='academy'", timeout=7000)
    check('another browser follows a manual world change without reloading', (await state(pg2))['world'] == 'academy')
    await other.close()

    await H.new_book(pg, 'An Illustrated Home', 'A letter waits on the desk.\n  These words belong to the writer.  ')
    words = 'The letter waited beneath the lamp.\n\nMara kept every word.'
    await pg.fill('#direction', words)
    await pg.click('#mineBtn')
    await pg.wait_for_selector('#passages .passage')
    draft = '  A next step, still unfinished.\nKeep this exactly as I typed it.  '
    await pg.fill('#direction', draft)
    before = await pg.evaluate("async()=>{const s=await import('/js/store.js');return structuredClone(s.peek('chapter',location.hash.split('/')[3]));}")
    await appearance(pg)
    check('appearance offers exactly the two illustrated worlds', await pg.locator('.swatch[data-world]').count() == 2 and
          await pg.locator('.swatch[data-world="academy"]').inner_text() and await pg.locator('.swatch[data-world="tokyo"]').inner_text())
    check('light is a separate choice with Day and Night labels',
          await pg.locator('.mode-choice[data-mode="light"]').inner_text() == 'Day' and
          await pg.locator('.mode-choice[data-mode="dark"]').inner_text() == 'Night')
    await pg.get_by_role('checkbox', name='Ambient animation', exact=True).check()
    check('Settings animation control updates the same saved preference', (await state(pg))['motion'] == 'on')
    await pg.get_by_role('checkbox', name='Ambient animation', exact=True).uncheck()
    check('Settings can pause ambient animation', (await state(pg))['motion'] == 'off')

    for world in ('academy', 'tokyo'):
        for mode in ('dark', 'light'):
            await pg.locator(f'.swatch[data-world="{world}"]').click()
            await pg.locator(f'.mode-choice[data-mode="{mode}"]').click()
            current = await state(pg)
            check(f'{world} {mode} uses the visible choice immediately', current['world'] == world and current['theme'] == world and current['mode'] == mode, current)
            check(f'{world} {mode} mounts only its own illustrated scene', await pg.locator('.room > .world-scene').count() == 1 and
                  await pg.locator(f'.room > .world-scene[data-world="{world}"] > svg.world-art').count() == 1)
            check(f'{world} {mode} uses vector artwork without embedded photographs', await pg.locator('.room svg image').count() == 0)
            ratios = await pg.evaluate(CONTRAST)
            check(f'{world} {mode} keeps story and controls readable at AA', all(r >= 4.5 for r in ratios.values()), ratios)
            for width in (360, 1280):
                await pg.set_viewport_size({'width': width, 'height': 900})
                check(f'{world} {mode} Settings fits {width}px', await pg.locator('.settings-sheet > .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'))
            await close_settings(pg)
            for width in (360, 1280):
                await pg.set_viewport_size({'width': width, 'height': 900})
                check(f'{world} {mode} writing desk fits {width}px', await pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            check(f'{world} {mode} preserves the unfinished direction exactly', await pg.input_value('#direction') == draft)
            after = await pg.evaluate("async()=>{const s=await import('/js/store.js');return structuredClone(s.peek('chapter',location.hash.split('/')[3]));}")
            check(f'{world} {mode} leaves the saved chapter untouched', after == before)
            await appearance(pg)
    await close_settings(pg)

    # Leave the unfinished draft in its chapter while visiting the shelf.
    await pg.click('#toShelf')
    await pg.wait_for_selector('#shelf:not([hidden])')
    for world in ('academy', 'tokyo'):
        await pg.click('#worldAcademy' if world == 'academy' else '#worldTokyo')
        if await pg.locator('#motionToggle').get_attribute('aria-pressed') != 'true':
            await pg.click('#motionToggle')
        await pg.emulate_media(reduced_motion='no-preference')
        await pg.wait_for_timeout(100)
        check(f'{world} has gentle ambient motion when enabled', await running_room_animations(pg) > 0)
        await pg.click('#motionToggle')
        await pg.wait_for_timeout(100)
        check(f'{world} animation can be paused manually', await running_room_animations(pg) == 0)
        await pg.click('#motionToggle')
        await pg.emulate_media(reduced_motion='reduce')
        await pg.wait_for_timeout(100)
        check(f'{world} respects reduced motion even when animation is enabled', await running_room_animations(pg) == 0)
        check(f'{world} reduced motion keeps the chosen illustrated scene visible', await pg.locator(f'.world-scene[data-world="{world}"] svg.world-art').is_visible())
        await pg.emulate_media(reduced_motion='no-preference')
        check(f'{world} reduced motion does not overwrite the manual preference', (await state(pg))['motion'] == 'on')
        for width in (320, 360, 1280):
            await pg.set_viewport_size({'width': width, 'height': 900})
            check(f'{world} shelf fits {width}px', await pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    await pg.get_by_role('button', name='Continue writing', exact=True).click()
    await pg.wait_for_selector('#desk:not([hidden])')
    check('the unfinished direction survives changing worlds from the shelf', await pg.input_value('#direction') == draft)
    photo_requests = [url for url in requests if '/assets/room/' in url or urlparse(url).path.lower().endswith(('.jpg', '.jpeg', '.webp'))]
    remote_requests = [url for url in requests if urlparse(url).scheme in ('http', 'https') and urlparse(url).hostname not in ('127.0.0.1', 'localhost')]
    check('worlds never request the photographic room assets', not photo_requests, photo_requests)
    check('worlds load without any external network request', not remote_requests, remote_requests)
    check('no model is called while changing the room', not H.reqs(), H.reqs())
    check('world controls raise no browser exceptions', not [line for line in logs if line.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_legacy(browser):
    """Older appearance choices keep their closest world and light on opening."""
    logs = []
    pg = await H.page(browser, logs)
    await pg.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])')
    for legacy, world, mode in (('study', 'academy', 'dark'), ('candle', 'academy', 'dark'),
                                ('ink', 'academy', 'dark'), ('day', 'academy', 'light'), ('rain', 'tokyo', 'dark')):
        await pg.evaluate("""async (theme)=>{
          const s=await import('/js/store.js');
          s.change('house','house',h=>{h.look={theme,font:'classic',size:'21',lead:'1.9',width:'720',indent:'on',tint:'off'};});
          await s.flush();
        }""", legacy)
        await pg.reload()
        await pg.wait_for_selector('#shelf:not([hidden])')
        current = await state(pg)
        check(f'legacy {legacy} opens as {world} {mode}', current['world'] == world and current['mode'] == mode, current)
        typography = await pg.evaluate("""()=>{const d=document.documentElement;return [d.dataset.font,d.dataset.indent,d.dataset.tint,d.style.getPropertyValue('--prose-size'),d.style.getPropertyValue('--prose-lead'),d.style.getPropertyValue('--page-width')];}""")
        check(f'legacy {legacy} keeps its reading preferences', typography == ['classic', 'on', 'off', '21px', '1.9', '720px'], typography)
        if legacy == 'day':
            saved = await pg.evaluate("async()=>structuredClone((await import('/js/store.js')).peek('house','house').look)")
            await appearance(pg, shelf=True)
            await pg.get_by_role('button', name='Back to the default look', exact=True).click()
            check('reset from legacy daylight uses the complete new default', await state(pg) == {'world': 'academy', 'theme': 'academy', 'mode': 'dark', 'motion': 'on'}, await state(pg))
            await pg.locator('#toast').get_by_role('button', name='Undo', exact=True).focus()
            await pg.keyboard.press('Enter')
            await flush(pg)
            check('Undo restores legacy daylight immediately', (await state(pg))['mode'] == 'light', await state(pg))
            restored = await pg.evaluate("async()=>structuredClone((await import('/js/store.js')).peek('house','house').look)")
            check('Undo restores every older reading preference exactly', restored == saved, restored)
            await close_settings(pg)
            await pg.reload()
            await pg.wait_for_selector('#shelf:not([hidden])')
            check('restored legacy daylight survives reloading', (await state(pg))['world'] == 'academy' and (await state(pg))['mode'] == 'light', await state(pg))
    await pg.context.close()


async def scenario_concurrent_choices(browser):
    """An appearance save delayed on one phone keeps independent choices elsewhere."""
    logs = []
    first = await H.page(browser, logs)
    second = await H.page(browser, logs)
    for pg in (first, second):
        await pg.goto(f'http://127.0.0.1:{H.PORT}/')
        await pg.wait_for_selector('#shelf:not([hidden])')

    async def reset():
        await first.evaluate("""async()=>{
          const s=await import('/js/store.js'); const {DEFAULT_LOOK}=await import('/js/ui/look.js');
          s.change('house','house',h=>{h.look={...DEFAULT_LOOK};}); await s.flush();
        }""")
        await second.wait_for_function("document.documentElement.dataset.world==='academy' && document.documentElement.dataset.mode==='dark' && document.documentElement.dataset.motion==='on'")

    async def delayed_change(first_control, second_control, expected, label):
        held, release = asyncio.Event(), asyncio.Event()

        async def delay_save(route):
            if route.request.method == 'PUT':
                held.set()
                await release.wait()
            await route.continue_()

        await first.route('**/api/store/house/house', delay_save)
        try:
            await first.locator(first_control).click()
            await asyncio.wait_for(held.wait(), 5)
            # This saves a newer house while the first browser still holds its
            # old save. Releasing it exercises the real conflict-and-replay path.
            await second.locator(second_control).click()
            await flush(second)
            release.set()
            await flush(first)
            try:
                await second.wait_for_function("expected=>Object.entries(expected).every(([k,v])=>document.documentElement.dataset[k]===v)", arg=expected, timeout=5000)
            except Exception:
                pass
            first_state, second_state = await state(first), await state(second)
            check(label, all(first_state.get(k) == v and second_state.get(k) == v for k, v in expected.items()), [first_state, second_state])
            stored = await first.evaluate("async()=>structuredClone((await import('/js/store.js')).peek('house','house').look)")
            check(label + ' on the saved record', all(stored.get(k) == v for k, v in expected.items() if k != 'world'), stored)
        finally:
            release.set()
            await first.unroute('**/api/store/house/house', delay_save)

    await reset()
    await delayed_change('#motionToggle', '#worldTokyo',
                         {'world': 'tokyo', 'theme': 'tokyo', 'mode': 'dark', 'motion': 'off'},
                         'a delayed animation toggle keeps another browser’s newer world')
    await reset()
    await appearance(first, shelf=True)
    await delayed_change('.swatch[data-world="tokyo"]', '#modeToggle',
                         {'world': 'tokyo', 'theme': 'tokyo', 'mode': 'light', 'motion': 'on'},
                         'a delayed Settings world choice keeps another browser’s newer daylight')
    check('conflicting appearance choices raise no browser exceptions', not [line for line in logs if line.startswith('PAGEERROR')], logs)
    await first.context.close()
    await second.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            launch = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await p.chromium.launch(**launch)
            for scenario in (scenario_worlds, scenario_legacy, scenario_concurrent_choices):
                try:
                    await scenario(browser)
                except Exception:
                    traceback.print_exc()
                    check(scenario.__name__ + ' ran to the end', False, traceback.format_exc()[-500:])
            await browser.close()
    failed = [result for result in RESULTS if not result[1]]
    print(f'\nworlds: {len(RESULTS)-len(failed)} passed, {len(failed)} failed', flush=True)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
