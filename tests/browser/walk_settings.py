"""Settings actions use the words visible now, and Undo keeps those words.

Real browser, temporary books, and the local stand-in provider only.
COZY_TEST_PORT and COZY_TEST_PROVIDER_PORT allow an independent run.
"""
import asyncio
import json
from pathlib import Path
import os
import shutil
import sys
import traceback

import harness
from playwright.async_api import async_playwright

harness.PORT = int(os.environ.get('COZY_TEST_PORT', harness.PORT))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', harness.PROV))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:300]}]'), flush=True)


async def kept(pg):
    return await pg.evaluate("async () => { const s = await import('/js/store.js'); await s.flush('house', 'house'); return s.peek('house', 'house'); }")


async def scenario_settings(browser):
    logs = []
    pg = await harness.page(browser, logs, w=1100, hgt=900, mobile=False)
    await harness.new_book(pg, title='The Settings Study')
    await harness.add_conn(pg, model='fake-thinker')
    await pg.click('#writerBtn')
    await pg.click('.menu-pop button:has-text("Connections…")')
    dialog = pg.get_by_role('dialog', name='Settings', exact=True)
    await dialog.wait_for(state='visible')

    # The action can happen in the same frame as the last keystroke. The
    # provider's actual request, rather than the input alone, proves it landed.
    harness.reset()
    await dialog.evaluate("""(box) => {
      const model = [...box.querySelectorAll('label.field')].find(x => x.firstElementChild.textContent === 'Model').querySelector('input');
      model.value = 'fake-writer'; model.dispatchEvent(new Event('input', { bubbles: true }));
      [...box.querySelectorAll('button')].find(x => x.textContent.trim() === 'Test').click();
    }""")
    await dialog.locator('.connection-actions .good').wait_for(state='visible', timeout=15000)
    calls = [r for r in harness.reqs() if r['path'].endswith('/chat/completions')]
    check('Test uses the model just typed, before the typing pause', bool(calls) and all(r['body']['model'] == 'fake-writer' for r in calls), [r['body'].get('model') for r in calls])

    await dialog.evaluate("""(box) => {
      const model = [...box.querySelectorAll('label.field')].find(x => x.firstElementChild.textContent === 'Model').querySelector('input');
      model.value = 'fake-thinker'; model.dispatchEvent(new Event('input', { bubbles: true }));
      [...box.querySelectorAll('button')].find(x => x.textContent.trim() === 'Copy').click();
    }""")
    hs = await kept(pg)
    check('Copy includes the model just typed', len(hs['connections']) == 2 and all(c['model'] == 'fake-thinker' for c in hs['connections']))

    # The toolbar along the top names every part; under it, only the part
    # pressed is shown — never two parts at once, and no head of its own.
    nav = dialog.locator('.settings-nav')
    names = ['Connections', 'Who does what', 'Usage and cost', 'Your instructions', 'How it looks', 'Backups', 'About']
    check('The toolbar names all seven parts, in the screen\'s words', await nav.get_by_role('tab').all_inner_texts() == names, await nav.get_by_role('tab').all_inner_texts())
    for key, name in zip(('connections', 'roles', 'usage', 'words', 'look', 'backups', 'about'), names):
        await harness.settings_part(pg, name)
        shown = await dialog.evaluate("""(box) => {
          const parts = [...box.querySelectorAll(':scope > .body > section')];
          return [parts.map((x) => x.dataset.key), box.querySelector(':scope > .body > section > .ghead') === null,
            document.activeElement.textContent, box.querySelector(':scope > .body').scrollTop,
            [...box.querySelectorAll('.settings-tab[aria-selected=true]')].map((t) => t.textContent)];
        }""")
        check(f'{name} shows only its own part, its tab chosen and focused', shown == [[f'set.{key}'], True, name, 0, [name]], shown)
    await harness.settings_part(pg, 'Connections')
    await nav.get_by_role('tab', name='Connections', exact=True).press('ArrowRight')
    check('The arrow keys move along the toolbar', await dialog.evaluate("(box) => document.activeElement.textContent === 'Who does what' && box.querySelector(':scope > .body > section').dataset.key === 'set.roles'"))
    # The toolbar never scrolls away: a long part scrolls under it.
    await harness.settings_part(pg, 'Your instructions')
    held = await dialog.evaluate("""(box) => {
      const bar = box.querySelector('.settings-nav'), body = box.querySelector(':scope > .body');
      const before = bar.getBoundingClientRect().top;
      body.scrollTop = body.scrollHeight;
      return [body.scrollTop > 200, bar.getBoundingClientRect().top === before, bar.getBoundingClientRect().bottom <= body.getBoundingClientRect().top + 1];
    }""")
    check('A long part scrolls under the toolbar, which stays where it is', held == [True, True, True], held)
    # A copy is a snapshot of every visible word: words typed in one part a
    # moment before another part is pressed are in it.
    async with pg.expect_download() as pending_download:
        await dialog.evaluate("""box => {
          const input = box.querySelector('input[placeholder="e.g. Bruce"]');
          input.value = 'The newest name'; input.dispatchEvent(new Event('input', { bubbles: true }));
          box.querySelector('.settings-tab[data-part="backups"]').click();
          [...box.querySelectorAll('button')].find(x => x.textContent.trim() === 'Take a copy of everything').click();
        }""")
    download = await pending_download.value
    library = json.loads(Path(await download.path()).read_text())
    copied_house = next(r['data'] for r in library['records'] if r['kind'] == 'house')
    check('A downloaded backup includes the very latest Settings typing', copied_house['you']['name'] == 'The newest name', copied_house['you'])

    await harness.settings_part(pg, 'Your instructions')
    await dialog.locator('button.modrow[data-id="novel-craft"]').click()
    module = pg.get_by_role('dialog', name='The novel craft', exact=True)
    await module.wait_for(state='visible')
    await module.locator('select').select_option('off')
    before = 'The newest words belong to the writer, even before the typing pause.'
    await module.evaluate("""(box, words) => {
      const input = box.querySelector('textarea'); input.value = words;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...box.querySelectorAll('button')].find(x => x.textContent.trim() === 'Back to the default').click();
    }""", before)
    question = pg.get_by_role('dialog', name='Back to the default?', exact=True)
    await question.wait_for(state='visible')
    check('Reset asks before replacing newly typed module words', await question.get_by_role('button', name='Copy mine first', exact=True).is_visible())
    await question.get_by_role('button', name='Back to the default', exact=True).click()
    check('Reset puts the module back to its starting words', await module.locator('textarea').input_value() != before and await module.locator('select').input_value() == 'always')
    await pg.locator('#toast').get_by_role('button', name='Undo', exact=True).click()
    hs = await kept(pg)
    check('Undo restores the newest module words and its scope', await module.locator('textarea').input_value() == before and hs['modules']['novel-craft']['text'] == before and hs['modules']['novel-craft']['rides'] == 'off')
    await module.get_by_role('button', name='Close', exact=True).click()
    # Who is telling, beside the writer's box: folded, it says what is set;
    # opened, the name and the grounding phrase are kept as he types them.
    teller = dialog.locator('details.tellerbox[data-teller="write"]')
    check('Who is telling sits folded under the writer’s box', await teller.count() == 1 and not await teller.evaluate('(d) => d.open'))
    await teller.locator('summary').click()
    await teller.locator('label.field:has(> span:text-is("Who is telling")) input').fill('Tony Stark')
    await teller.locator('label.field:has(> span:text-is("Grounding phrase")) input').fill('Jarvis, wake up.')
    await teller.locator('label.field:has(> span:text-is("The teller thinks as")) select').select_option('first')
    await pg.wait_for_timeout(800)
    hs = await kept(pg)
    check('Who is telling, its grounding phrase and how it thinks are kept', (hs.get('tellers') or {}).get('write') == {'name': 'Tony Stark', 'phrase': 'Jarvis, wake up.', 'person': 'first', 'echo': False}, hs.get('tellers'))
    line = await teller.locator('summary .tellerline').inner_text()
    check('its folded line says what is set', 'Tony Stark' in line and 'Jarvis, wake up.' in line and 'thinks as I' in line, line)
    await dialog.get_by_role('button', name='Read my standing words for an assistant’s voice', exact=True).click()
    found = await dialog.locator('.voicefound').inner_text()
    check('Read my standing words says what it found in his words', 'YOUR words' in found or 'of YOURS' in found or 'yours' in found.lower(), found[:200])
    await dialog.get_by_role('button', name='Close', exact=True).click()
    await harness.settled_reload(pg)
    await pg.wait_for_selector('#desk:not([hidden])')
    hs = await kept(pg)
    check('The restored words survive a reload', hs['modules']['novel-craft']['text'] == before)

    # Opened again, Settings is on the part last shown; asked for by name
    # (the writer chip's Connections…) it is on that part.
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("Settings")')
    await dialog.wait_for(state='visible')
    check('Settings opens again on the part last shown', await dialog.evaluate("(box) => box.querySelector('.settings-tab[aria-selected=true]').textContent === 'Your instructions' && box.querySelector(':scope > .body > section').dataset.key === 'set.words'"))
    await dialog.get_by_role('button', name='Close', exact=True).click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.click('#writerBtn')
    await pg.click('.menu-pop button:has-text("Connections…")')
    await dialog.wait_for(state='visible')
    check('Connections… opens on Connections', await dialog.evaluate("(box) => box.querySelector('.settings-tab[aria-selected=true]').textContent === 'Connections' && box.querySelector(':scope > .body > section').dataset.key === 'set.connections'"))
    # The whole toolbar can be seen and pressed on a narrow phone.
    for width in (412, 320):
        await pg.set_viewport_size({'width': width, 'height': 850})
        await harness.settings_part(pg, 'Your instructions')
        fit = await dialog.evaluate("""(box) => {
          const body = box.querySelector(':scope > .body'), bar = box.querySelector('.settings-nav');
          const tabs = [...bar.querySelectorAll('.settings-tab')].map((t) => t.getBoundingClientRect());
          return [body.scrollWidth <= body.clientWidth + 1, tabs.every((r) => r.left >= 0 && r.right <= innerWidth && r.height > 0), Math.round(bar.getBoundingClientRect().height)];
        }""")
        check(f'Settings and its whole toolbar fit a {width}px phone', fit[0] and fit[1] and fit[2] <= 140, fit)
    check('Settings actions raise no browser exceptions', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.close()


async def main():
    with harness.Env():
        async with async_playwright() as playwright:
            executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH') or shutil.which('chromium')
            browser = await playwright.chromium.launch(executable_path=executable)
            try:
                await scenario_settings(browser)
            except Exception:
                traceback.print_exc()
                check('Settings walk reaches the end', False, traceback.format_exc()[-500:])
            await browser.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\nbrowser (settings): {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)


asyncio.run(main())
