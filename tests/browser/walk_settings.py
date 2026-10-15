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

    # Every navigation destination is keyboard focusable and opens its own
    # remembered section; no unrelated saved preference is changed.
    nav = dialog.locator('.settings-nav')
    check('Settings navigation covers all seven sections', await nav.locator('button').count() == 7)
    for key in ('connections', 'roles', 'usage', 'words', 'look', 'backups', 'about'):
        await nav.locator(f'button[aria-controls="settings-{key}"]').click()
        check(f'Settings navigation opens and focuses {key}', await dialog.locator(f'#settings-{key}').evaluate('(x) => !x.classList.contains("fold") && document.activeElement === x.firstElementChild'))
    # A copy is a snapshot of every visible word, including Settings input
    # whose typing pause has not yet elapsed.
    await nav.locator('button[aria-controls="settings-backups"]').click()
    async with pg.expect_download() as pending_download:
        await dialog.evaluate('''box => {
          const input = box.querySelector('input[placeholder="e.g. Bruce"]');
          input.value = 'The newest name'; input.dispatchEvent(new Event('input', { bubbles: true }));
          [...box.querySelectorAll('button')].find(x => x.textContent.trim() === 'Take a copy of everything').click();
        }''')
    download = await pending_download.value
    library = json.loads(Path(await download.path()).read_text())
    copied_house = next(r['data'] for r in library['records'] if r['kind'] == 'house')
    check('A downloaded backup includes the very latest Settings typing', copied_house['you']['name'] == 'The newest name', copied_house['you'])

    await nav.locator('button[aria-controls="settings-words"]').click()
    gap = await dialog.evaluate('(box) => box.querySelector("#settings-words").getBoundingClientRect().top - box.querySelector(".settings-nav").getBoundingClientRect().bottom')
    check('Navigation places the chosen section just below the sticky buttons', 0 <= gap <= 24, gap)
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
    await dialog.get_by_role('button', name='Close', exact=True).click()
    await pg.reload()
    await pg.wait_for_selector('#desk:not([hidden])')
    hs = await kept(pg)
    check('The restored words survive a reload', hs['modules']['novel-craft']['text'] == before)

    # Opening from the shelf keeps this usable on a narrow phone as well.
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("Settings")')
    for width in (412, 320):
        await pg.set_viewport_size({'width': width, 'height': 850})
        await dialog.locator('.settings-nav button[aria-controls="settings-words"]').click()
        check(f'Settings fit a {width}px phone', await dialog.locator(':scope > .body').evaluate('(x) => x.scrollWidth <= x.clientWidth + 1'))
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
