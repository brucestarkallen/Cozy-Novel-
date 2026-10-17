"""Three writing rooms, each in two lights: choices and the writer's words stay.

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
WORLDS = ('academy', 'tokyo', 'study')
WORLD_BUTTONS = {'academy': '#worldAcademy', 'tokyo': '#worldTokyo', 'study': '#worldStudy'}


def photos(requests):
    return [url for url in requests if '/assets/room/' in url or
            urlparse(url).path.lower().endswith(('.jpg', '.jpeg', '.webp'))]


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
    await H.settings_part(pg, 'How it looks')


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
    check('all three worlds have visible manual controls', all([
        await pg.locator(selector).is_visible() for selector in WORLD_BUTTONS.values()]))

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
    await H.settled_reload(pg)
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
    check('appearance offers both illustrated worlds and Original Study', await pg.locator('.swatch[data-world]').count() == 3 and
          'Academy of Ink' in await pg.locator('.swatch[data-world="academy"]').inner_text() and
          'Neon Tokyo' in await pg.locator('.swatch[data-world="tokyo"]').inner_text() and
          'Original Study' in await pg.locator('.swatch[data-world="study"]').inner_text())
    check('light is a separate choice with Day and Night labels',
          await pg.locator('.mode-choice[data-mode="light"]').inner_text() == 'Day' and
          await pg.locator('.mode-choice[data-mode="dark"]').inner_text() == 'Night')
    await pg.get_by_role('checkbox', name='Ambient animation', exact=True).check()
    check('Settings animation control updates the same saved preference', (await state(pg))['motion'] == 'on')
    await pg.get_by_role('checkbox', name='Ambient animation', exact=True).uncheck()
    check('Settings can pause ambient animation', (await state(pg))['motion'] == 'off')

    check('opening and choosing illustrated worlds never fetches the photographic room assets', not photos(requests), photos(requests))
    for world in WORLDS:
        for mode in ('dark', 'light'):
            request_start = len(requests)
            await pg.locator(f'.swatch[data-world="{world}"]').click()
            await pg.locator(f'.mode-choice[data-mode="{mode}"]').click()
            current = await state(pg)
            check(f'{world} {mode} uses the visible choice immediately', current['world'] == world and current['theme'] == world and current['mode'] == mode, current)
            check(f'{world} {mode} mounts only its own scene', await pg.locator('.room > .world-scene').count() == 1 and
                  await pg.locator(f'.room > .world-scene[data-world="{world}"]').count() == 1)
            if world == 'study':
                check(f'{world} {mode} shows the original photographic room', await pg.locator('.world-scene[data-world="study"] .study-picture img').is_visible())
            else:
                check(f'{world} {mode} uses vector artwork without photographs',
                      await pg.locator('.room .world-art').count() == 1 and await pg.locator('.room svg.world-art, .room .world-art svg').count() >= 1 and
                      await pg.locator('.room svg image, .room picture, .room img').count() == 0)
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
            if world != 'study':
                check(f'{world} {mode} requests no photographic assets', not photos(requests[request_start:]), photos(requests[request_start:]))
            await appearance(pg)
    await close_settings(pg)

    # Leave the unfinished draft in its chapter while visiting the shelf.
    await pg.click('#toShelf')
    await pg.wait_for_selector('#shelf:not([hidden])')
    for world in WORLDS:
        request_start = len(requests)
        await pg.click(WORLD_BUTTONS[world])
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
        scene_art = '.study-picture img' if world == 'study' else '.world-art'
        check(f'{world} reduced motion keeps the chosen scene visible', await pg.locator(f'.world-scene[data-world="{world}"] {scene_art}').is_visible())
        await pg.emulate_media(reduced_motion='no-preference')
        check(f'{world} reduced motion does not overwrite the manual preference', (await state(pg))['motion'] == 'on')
        for width in (320, 360, 1280):
            await pg.set_viewport_size({'width': width, 'height': 900})
            check(f'{world} shelf fits {width}px', await pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        if world != 'study':
            check(f'{world} never loads photographs after leaving Original Study', not photos(requests[request_start:]), photos(requests[request_start:]))

    await pg.get_by_role('button', name='Continue writing', exact=True).click()
    await pg.wait_for_selector('#desk:not([hidden])')
    check('the unfinished direction survives changing worlds from the shelf', await pg.input_value('#direction') == draft)
    remote_requests = [url for url in requests if urlparse(url).scheme in ('http', 'https') and urlparse(url).hostname not in ('127.0.0.1', 'localhost')]
    check('worlds load without any external network request', not remote_requests, remote_requests)
    check('no model is called while changing the room', not H.reqs(), H.reqs())
    check('world controls raise no browser exceptions', not [line for line in logs if line.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_neon(browser):
    """Neon Tokyo: one rain-wet street that covers every screen shape, its lights
    moved by the compositor alone, and a chapter's heading lit once when it opens."""
    logs = []
    pg = await H.page(browser, logs)
    await H.new_book(pg, 'A Lit Street', 'A courier crosses the city at night.')
    await pg.emulate_media(reduced_motion='no-preference')
    await pg.evaluate("async()=>(await import('/js/ui/look.js')).applyLook({theme:'tokyo',mode:'dark',motion:'on'})")
    await pg.wait_for_selector('.world-scene[data-world="tokyo"] .neon-stage')
    parts = await pg.evaluate("""() => { const s = document.querySelector('.world-scene[data-world="tokyo"]');
      return Object.fromEntries(['.neon-back', '.neon-front', '.neon-train', '.neon-flicker', '.neon-rain-far', '.neon-rain-near', '.neon-mote']
        .map(q => [q, s.querySelectorAll(q).length])); }""")
    check('Neon Tokyo mounts its street, the last train, a stuttering sign, two depths of rain and drifting lights', all(parts.values()), parts)
    # the street is one still drawing: nothing that moves stands between its two halves, and the train runs only in the
    # gap between the facades, where the facades ever let it be seen
    order = await pg.evaluate("""() => { const still = document.querySelector('.neon-stage.neon-still');
      const track = document.querySelector('.neon-track').getBoundingClientRect(), stage = still.getBoundingClientRect();
      return { still: [...still.children].map(c => c.className.baseVal || c.className), moving: still.querySelectorAll('[class*=neon-train],[class*=neon-rain],[class*=neon-mote],[class*=neon-flicker]').length,
               gap: [Math.round((track.left - stage.left) / stage.width * 100), Math.round(track.width / stage.width * 100)],
               rainOverflow: [...document.querySelectorAll('.neon-rain')].every(r => { const b = r.getBoundingClientRect(); return b.width < innerWidth + 60 && b.height < innerHeight + 200; }),
               rainMask: [...document.querySelectorAll('.neon-rain')].every(r => getComputedStyle(r).maskImage === 'none') }; }""")
    check('the street is one still drawing (far city and street together, nothing moving between them), the train in the facades\' gap, the rain the screen\'s own size without a mask',
          order['still'] == ['neon-back', 'neon-front'] and order['moving'] == 0 and order['gap'] == [40, 20] and order['rainOverflow'] and order['rainMask'], order)
    for width, height in ((320, 640), (412, 915), (853, 1280), (1280, 800), (1920, 1080)):
        await pg.set_viewport_size({'width': width, 'height': height})
        await pg.wait_for_timeout(80)
        box = await pg.evaluate("""() => { const r = document.querySelector('.neon-stage').getBoundingClientRect();
          return { cover: r.left <= .5 && r.top <= .5 && r.right >= innerWidth - .5 && r.bottom >= innerHeight - .5,
                   wide: document.documentElement.scrollWidth <= innerWidth, r: [r.left, r.top, r.right, r.bottom].map(Math.round) }; }""")
        check(f'the street covers the whole screen at {width}×{height}, nothing to scroll sideways', box['cover'] and box['wide'], box)
    moving = await pg.evaluate("""() => { const all = document.querySelector('.room').getAnimations({subtree: true});
      const props = new Set(all.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))));
      ['offset', 'easing', 'composite', 'computedOffset'].forEach(k => props.delete(k));
      return { running: all.filter(a => a.playState === 'running').length, props: [...props] }; }""")
    check('its lights move, and only by transform or opacity — nothing laid out or repainted for them',
          moving['running'] >= 5 and set(moving['props']) <= {'transform', 'opacity'}, moving)
    await pg.evaluate("async()=>(await import('/js/ui/look.js')).applyLook({theme:'tokyo',mode:'light',motion:'on'})")
    await pg.wait_for_timeout(80)
    day = await pg.evaluate("""() => ({ train: getComputedStyle(document.querySelector('.neon-train')).display,
      flicker: getComputedStyle(document.querySelector('.neon-flicker')).animationName, back: getComputedStyle(document.querySelector('.world-scene')).backgroundColor })""")
    check('by day the signs are off: no train, no stutter, a pale sky', day['train'] == 'none' and day['flicker'] == 'none' and day['back'] != 'rgb(5, 4, 26)', day)
    await pg.evaluate("async()=>(await import('/js/ui/look.js')).applyLook({theme:'tokyo',mode:'dark',motion:'on'})")

    # A chapter opened lights its heading once; a redraw of the same chapter never does it again.
    await pg.set_viewport_size({'width': 412, 'height': 915})
    lit = await pg.evaluate("""() => { const h = document.querySelector('.chapterhead');
      return { lighting: h.classList.contains('lighting'), lit: h.dataset.lit || '', chapter: (location.hash.split('/')[3] || '') ,
        names: document.querySelector('#chapname').getAnimations().map(a => a.animationName) }; }""")
    check('opening a chapter lights its heading', lit['lighting'] and lit['lit'] and 'neon-on' in lit['names'], lit)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("import('/js/ui/desk.js').then(d => d.drawHead())")
    await pg.fill('#direction', 'The courier stops under the sign.')
    await pg.click('#mineBtn')
    await pg.wait_for_selector('#passages .passage')
    again = await pg.evaluate("() => document.querySelector('#chapname').getAnimations().filter(a => a.playState === 'running').length")
    check('drawing the same chapter again never lights it twice', again == 0, again)
    await pg.evaluate("async()=>(await import('/js/ui/look.js')).applyLook({theme:'tokyo',mode:'dark',motion:'off'})")
    await pg.wait_for_timeout(80)
    still = await pg.evaluate("() => document.querySelector('.room').getAnimations({subtree:true}).filter(a => a.playState === 'running').length")
    check('Pause holds the whole street still', still == 0, still)
    check('Neon Tokyo raises no browser exceptions', not [line for line in logs if line.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_legacy(browser):
    """Older appearance choices keep their closest world and light on opening."""
    logs = []
    pg = await H.page(browser, logs)
    await pg.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])')
    for legacy, world, mode in (('study', 'study', 'dark'), ('candle', 'academy', 'dark'),
                                ('ink', 'academy', 'dark'), ('day', 'academy', 'light'), ('rain', 'tokyo', 'dark')):
        await pg.evaluate("""async (theme)=>{
          const s=await import('/js/store.js');
          s.change('house','house',h=>{h.look={theme,font:'classic',size:'21',lead:'1.9',width:'720',indent:'on',tint:'off'};});
          await s.flush();
        }""", legacy)
        await H.settled_reload(pg)
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
            await H.settled_reload(pg)
            await pg.wait_for_selector('#shelf:not([hidden])')
            check('restored legacy daylight survives reloading', (await state(pg))['world'] == 'academy' and (await state(pg))['mode'] == 'light', await state(pg))
    await pg.context.close()


async def study_source(pg, label, expected):
    await pg.wait_for_function("""expected => {
      const img = document.querySelector('.study-picture img');
      return img && img.complete && img.naturalWidth > 0 &&
        new URL(img.currentSrc).pathname.endsWith('/' + expected + '.webp');
    }""", arg=expected, timeout=8000)
    source = await pg.locator('.study-picture img').evaluate('(img)=>img.currentSrc')
    check(label, urlparse(source).path.endswith(f'/{expected}.webp'), source)


async def scenario_foldable(browser):
    """The restored study follows viewport shape without disturbing work in progress."""
    logs, requests = [], []
    pg = await H.page(browser, logs, w=360, hgt=874)
    pg.on('request', lambda request: requests.append(request.url))
    await pg.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])')
    await pg.click('#worldStudy')
    if (await state(pg))['mode'] != 'light':
        await pg.click('#modeToggle')
    if (await state(pg))['motion'] != 'off':
        await pg.click('#motionToggle')
    await flush(pg)
    expected = {'world': 'study', 'theme': 'study', 'mode': 'light', 'motion': 'off'}
    await H.settled_reload(pg)
    await pg.wait_for_selector('#shelf:not([hidden])')
    check('Original Study, daylight and paused motion survive reloading', await state(pg) == expected, await state(pg))
    check('Original Study announces its selected shelf control', await pg.locator('#worldStudy').get_attribute('aria-pressed') == 'true' and
          await pg.locator('#worldAcademy').get_attribute('aria-pressed') == 'false' and await pg.locator('#worldTokyo').get_attribute('aria-pressed') == 'false')
    await study_source(pg, 'a folded portrait loads the original mobile room', 'mobile')

    other = await browser.new_context(viewport={'width': 853, 'height': 965})
    pg2 = await other.new_page()
    await pg2.goto(f'http://127.0.0.1:{H.PORT}/')
    await pg2.wait_for_selector('#shelf:not([hidden])')
    check('a separate browser opens in the same Original Study choices', await state(pg2) == expected, await state(pg2))
    await study_source(pg2, 'a fresh unfolded viewport loads the wide original room', 'desktop')
    await other.close()

    title = 'Letters from the Quiet Study — A Very Long Working Title for a Novel Still Being Written'
    await H.new_book(pg, title, 'A writer keeps the same words when the room grows wider.')
    words = 'Mara unfolded the letter beneath the study lamp. Every word stayed exactly where she left it.'
    await pg.fill('#direction', words)
    await pg.click('#mineBtn')
    await pg.wait_for_selector('#passages .passage .prose')
    await pg.click('#lengthBtn')
    await pg.click('.menu-pop button:has-text("A few paragraphs")')
    await pg.click('#outcomeBtn')
    await pg.click('.menu-pop button:has-text("I decide")')
    draft = '  Keep this unfinished thought.\nThe next line is mine to decide.  '
    await pg.fill('#direction', draft)
    await pg.locator('#direction').evaluate("(e)=>{e.focus();e.setSelectionRange(2,12,'forward');window.__foldDirection=e;}")
    before = await pg.evaluate("async()=>structuredClone((await import('/js/store.js')).peek('chapter',location.hash.split('/')[3]))")

    # Representative CSS viewports for a narrow outer display, reduced height
    # with a keyboard, and near-square inner display; not hardware certification.
    sizes = ((360, 874), (768, 864), (402, 874), (402, 380), (853, 965), (1280, 900), (360, 874))
    for width, height in sizes:
        await pg.set_viewport_size({'width': width, 'height': height})
        photo = 'mobile' if width < 600 or width / height <= .8 else 'desktop'
        await study_source(pg, f'live resize to {width}×{height} chooses the {photo} composition', photo)
        editing = await pg.locator('#direction').evaluate('(e)=>[e.value,e.selectionStart,e.selectionEnd,e.selectionDirection,e===document.activeElement,e===window.__foldDirection]')
        check(f'{width}×{height} preserves the draft, selection and focused control', editing == [draft, 2, 12, 'forward', True, True], editing)
        check(f'{width}×{height} preserves manual world, light and writing choices', await state(pg) == expected and
              'A few paragraphs' in await pg.inner_text('#lengthBtn') and 'I decide' in await pg.inner_text('#outcomeBtn'), await state(pg))
        bounds = await pg.evaluate("""()=>{
          const ids=['writeBtn','mineBtn','moreBtn','lengthBtn','outcomeBtn','writerBtn'];
          return ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();
            const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {id,ok:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&!!hit&&e.contains(hit)};
          });
        }""")
        check(f'{width}×{height} keeps writing controls within reach with the long title',
              await pg.evaluate('document.documentElement.scrollWidth<=innerWidth') and all(row['ok'] for row in bounds), bounds)

    await pg.locator('#direction').evaluate('(e)=>e.blur()')
    selected = await pg.locator('#passages .passage .prose p').first.evaluate("""e=>{
      const text=e.firstChild, range=document.createRange();
      range.setStart(text,0);range.setEnd(text,'Mara unfolded the letter'.length);
      const s=window.getSelection();s.removeAllRanges();s.addRange(range);return s.toString();
    }""")
    await pg.wait_for_function("document.querySelector('#writeBtn').textContent==='Rewrite'")
    for width, height in ((853, 965), (402, 874)):
        await pg.set_viewport_size({'width': width, 'height': height})
        check(f'{width}×{height} keeps selected story words and the Rewrite action',
              await pg.evaluate('window.getSelection().toString()') == selected and
              await pg.inner_text('#writeBtn') == 'Rewrite' and await pg.locator('#selBar').is_visible() and
              await pg.input_value('#direction') == draft)
    await pg.click('#selClear')
    check('Never mind still clears the selected words after folding', await pg.inner_text('#writeBtn') == 'Write' and await pg.input_value('#direction') == draft)
    after = await pg.evaluate("async()=>structuredClone((await import('/js/store.js')).peek('chapter',location.hash.split('/')[3]))")
    check('folding and unfolding never changes the saved story', before == after)

    # A loaded photographic room must leave no image behind when an illustrated
    # world is selected, including after the viewport changes shape again.
    await appearance(pg)
    for world in ('academy', 'tokyo'):
        request_start = len(requests)
        await pg.locator(f'.swatch[data-world="{world}"]').click()
        await close_settings(pg)
        for width, height in ((768, 864), (360, 874)):
            await pg.set_viewport_size({'width': width, 'height': height})
        check(f'{world} replaces the photograph with one illustrated scene', await pg.locator('.room .world-art').count() == 1 and await pg.locator('.room svg.world-art, .room .world-art svg').count() >= 1 and
              await pg.locator('.room picture, .room img').count() == 0 and (await state(pg))['world'] == world)
        check(f'{world} fold and unfold requests no photographic assets', not photos(requests[request_start:]), photos(requests[request_start:]))
        check(f'{world} after Original Study preserves the draft and writing choices', await pg.input_value('#direction') == draft and
              'A few paragraphs' in await pg.inner_text('#lengthBtn') and 'I decide' in await pg.inner_text('#outcomeBtn'))
        await appearance(pg)
    await close_settings(pg)
    check('foldable layout changes make no model calls', not H.reqs(), H.reqs())
    check('foldable layout changes raise no browser exceptions', not [line for line in logs if line.startswith('PAGEERROR')], logs)
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
            for scenario in (scenario_worlds, scenario_neon, scenario_legacy, scenario_foldable, scenario_concurrent_choices):
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
