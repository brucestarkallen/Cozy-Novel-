"""Keyboard and screen-reader paths through real dialogs, menus and search.

Uses the shared temporary-data harness. Optional ports let this focused walk
run independently of the longer browser walks.
"""
import asyncio
import os
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


async def no_sheets(pg):
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.wait_for_timeout(250)


async def scenario_dialogs(browser):
    """Sheets keep the keyboard, hand it to menus, and return it on Back."""
    logs = []
    pg = await harness.page(browser, logs, w=1100, hgt=850, mobile=False)
    await harness.new_book(pg, title='A Quiet Keyboard')
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("Settings")')
    dialog = pg.get_by_role('dialog', name='Settings', exact=True)
    await dialog.wait_for(state='visible')
    close = dialog.get_by_role('button', name='Close', exact=True)
    await close.focus()
    await pg.keyboard.press('Shift+Tab')
    check('Shift+Tab wraps inside the sheet', await dialog.evaluate('(el) => el.contains(document.activeElement) && document.activeElement !== el.querySelector(".head button")'))
    await pg.keyboard.press('Tab')
    check('Tab from the last control returns to Close', await close.evaluate('(el) => el === document.activeElement'))
    await pg.focus('#direction')
    check('a background control cannot take focus from a sheet', await dialog.evaluate('(el) => el.contains(document.activeElement)'))

    add = dialog.get_by_role('button', name='Add a connection', exact=True)
    await add.click()
    await pg.wait_for_selector('.menu-pop')
    first = await pg.evaluate('document.activeElement.textContent')
    check('a menu opened in a sheet receives focus', await pg.evaluate('Boolean(document.activeElement.closest(".menu-pop"))'))
    await pg.keyboard.press('ArrowDown')
    check('the menu arrow keys still work inside a sheet', await pg.evaluate('Boolean(document.activeElement.closest(".menu-pop"))') and await pg.evaluate('document.activeElement.textContent') != first)
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('.menu-pop', state='detached')
    check('Escape closes just the menu and restores its button', await dialog.count() == 1 and await add.evaluate('(el) => el === document.activeElement'))
    await pg.keyboard.press('Tab')
    check('Tab after a menu stays in the sheet', await dialog.evaluate('(el) => el.contains(document.activeElement)'))

    await add.click()
    await pg.click('.menu-pop button:has-text("Anything else")')
    release = dialog.get_by_role('button', name='Let go', exact=True)
    await release.click()
    child = pg.get_by_role('dialog').last
    await child.wait_for(state='visible')
    await child.get_by_role('button', name='Close', exact=True).focus()
    await pg.keyboard.press('Shift+Tab')
    check('a nested question keeps Tab in the top sheet', await child.evaluate('(el) => el.contains(document.activeElement)'))
    await pg.keyboard.press('Escape')
    await pg.wait_for_function("document.querySelectorAll('.sheet.on').length === 1")
    check('Back from a nested question restores its opener', await release.evaluate('(el) => el === document.activeElement'))
    await release.click()
    await pg.get_by_role('dialog').last.get_by_role('button', name='Not now', exact=True).click()
    check('a nested question button also restores its opener', await release.evaluate('(el) => el === document.activeElement'))

    # All overlay owners use onBack, including overlays outside the sheet kit.
    # A newer owner must be able to focus its own controls without a focus loop.
    await pg.evaluate("""async () => {
      const { onBack } = await import('/js/ui/dom.js');
      const button = document.createElement('button');
      button.id = 'newer-overlay-control'; button.textContent = 'Another overlay';
      document.body.append(button);
      window.releaseOverlay = onBack(() => button.remove());
      button.focus();
    }""")
    check('a newer overlay can own focus above a sheet', await pg.evaluate('document.activeElement.id === "newer-overlay-control"'))
    await pg.evaluate("document.querySelector('#newer-overlay-control').remove(); window.releaseOverlay();")
    await close.focus()

    # Clipboard fallback must remain usable while the sheet keeps focus.
    copied = await pg.evaluate("""async () => {
      const { copyText } = await import('/js/ui/dom.js');
      const original = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async () => { throw new Error('Use the fallback'); };
      try { return await copyText('The lantern is lit.'); }
      finally { navigator.clipboard.writeText = original; }
    }""")
    check('copying words still works inside a focused sheet', copied and await close.evaluate('(el) => el === document.activeElement'))
    await pg.evaluate("""async () => {
      const { undoToast } = await import('/js/ui/dom.js');
      window.toastUndone = false;
      undoToast('A reversible change.', () => { window.toastUndone = true; });
    }""")
    await close.focus()
    await pg.keyboard.press('Shift+Tab')
    check('Undo is reachable by keyboard within the active dialog', await pg.evaluate("document.activeElement.matches('#toast .toastact') && Boolean(document.activeElement.closest('[role=dialog]'))"))
    await pg.keyboard.press('Enter')
    check('keyboard Undo runs and its hidden action leaves the tab order', await pg.evaluate("window.toastUndone && document.querySelector('#toast').inert"))
    await close.click()
    await no_sheets(pg)
    check('closing Settings returns focus to More in the book', await pg.evaluate('document.activeElement.id === "moreBtn" && !document.querySelector("#desk").hidden'))
    check('dialogs produce no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_names_and_picker(browser):
    """Rename is labeled, composing text is safe, and cancel ends imports."""
    logs = []
    pg = await harness.page(browser, logs)
    await harness.new_book(pg, title='Named with Care')
    await pg.click('#partnerBtn')
    await pg.click('.convpick')
    await pg.click('.menu-pop button:has-text("Rename this conversation")')
    name = pg.get_by_role('textbox', name='Rename the conversation', exact=True)
    check('the conversation name has an accessible label', await name.count() == 1)
    await name.fill('Quiet evenings')
    await name.dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
    check('Enter during text composition does not close Rename', await name.is_visible())
    await name.press('Enter')
    await no_sheets(pg)
    await pg.wait_for_function("document.querySelector('.convname').textContent === 'Quiet evenings'")
    check('Enter after composition saves the conversation name', await pg.inner_text('.convname') == 'Quiet evenings')

    # Native file dialogs cannot be dismissed through Playwright; send the
    # browser's cancel event to the actual picker and observe its result.
    async with pg.expect_file_chooser():
        await pg.evaluate("""async () => {
          const { pickFile } = await import('/js/ui/dom.js');
          window.pickerResult = 'waiting';
          pickFile('.txt').then((file) => { window.pickerResult = file; });
        }""")
    await pg.locator('input[type=file]').dispatch_event('cancel')
    await pg.wait_for_function('window.pickerResult === null')
    check('cancel resolves the picker and removes its hidden input', await pg.locator('input[type=file]').count() == 0)
    check('renaming and canceling imports produce no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_search(browser):
    """Search speaks its results, supports the keyboard, and stops on close."""
    logs = []
    pg = await harness.page(browser, logs, w=1100, hgt=850, mobile=False)
    await harness.new_book(pg, title='The Search Window', brief='A quiet evening at home.')
    await pg.fill('#direction', 'The lantern glowed softly beside the kettle.')
    await pg.click('#mineBtn')
    await pg.wait_for_selector('#passages .prose')
    await pg.click('#searchBtn')
    search = pg.get_by_role('dialog', name='Search', exact=True)
    words = search.get_by_role('searchbox', name='Words to find')
    await words.fill('lantern')
    await words.press('Enter')
    await search.locator('.hit').wait_for()
    check('search announces the completed result count', await search.locator('.searchsay[role="status"]').inner_text() == '1 place.' and await search.locator('.results').get_attribute('aria-busy') == 'false')
    check('Enter keeps keyboard focus in the search field', await words.evaluate('(el) => el === document.activeElement'))
    for _ in range(3):
        await pg.keyboard.press('Tab')
    check('the keyboard reaches the first search result', await pg.evaluate('document.activeElement.matches(".searchsheet .hit")'))
    await pg.keyboard.press('Enter')
    await no_sheets(pg)
    await pg.wait_for_selector('#passages .passage.found')
    check('Enter on a result opens and marks its passage', await pg.locator('#passages .passage.found').count() == 1)

    started, finish, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
    reads = []
    pg.on('request', lambda r: reads.append(r.url) if 'n-search-unopened' in r.url else None)

    async def delayed_shelf(route):
        started.set()
        await finish.wait()
        await route.fulfill(json={'novels': [{'id': 'n-search-unopened', 'title': 'Still on the shelf'}]})
        finished.set()

    await pg.route('**/api/novels', delayed_shelf)
    await pg.click('#searchBtn')
    await search.get_by_role('button', name='All books', exact=True).click()
    await asyncio.wait_for(started.wait(), timeout=5)
    await pg.keyboard.press('Escape')
    await no_sheets(pg)
    await pg.fill('#direction', 'Words after closing Search')
    finish.set()
    await asyncio.wait_for(finished.wait(), timeout=5)
    await pg.wait_for_timeout(250)
    check('closing Search stops it opening books after a late shelf reply', not reads, reads)
    check('a closed search cannot steal focus or reopen results', await pg.evaluate('document.activeElement.id === "direction" && !document.querySelector(".searchsheet")'))
    await pg.unroute('**/api/novels', delayed_shelf)

    await pg.click('#searchBtn')
    await search.evaluate("""(el) => {
      const input = el.querySelector('input'); input.value = 'Remember these words';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      el.querySelector('.head button').click();
    }""")
    await no_sheets(pg)
    await pg.click('#searchBtn')
    check('closing immediately after typing keeps the query for next time', await words.input_value() == 'Remember these words')
    await pg.keyboard.press('Escape')
    await no_sheets(pg)
    check('search produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def main():
    with harness.Env():
        async with async_playwright() as playwright:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await playwright.chromium.launch(**options)
            for scenario in (scenario_dialogs, scenario_names_and_picker, scenario_search):
                print(scenario.__doc__, flush=True)
                try:
                    await scenario(browser)
                except Exception:
                    traceback.print_exc()
                    check(scenario.__name__ + ' ran to the end', False, traceback.format_exc()[-600:])
            await browser.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\naccessibility: {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    asyncio.run(main())
