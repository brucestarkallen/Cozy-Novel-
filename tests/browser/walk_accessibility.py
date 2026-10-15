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
    await pg.locator('#chapname').fill('夜の灯り')
    await pg.locator('#chapname').dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
    check('confirming a composed character does not blur the chapter heading', await pg.evaluate('document.activeElement.id === "chapname"'))
    await pg.locator('#chapname').press('Enter')
    check('Enter after composition names the chapter', await pg.evaluate("async()=>{const s=await import('/js/store.js');const n=s.peek('novel',location.hash.split('/')[2]);return s.peek('chapter',n.order[0]).name==='夜の灯り';}"))
    await pg.fill('#direction', 'A lantern waits beside the door.')
    await pg.locator('#direction').dispatch_event('keydown', {'key': 'Enter', 'ctrlKey': True, 'isComposing': True})
    check('composing text in the writing box cannot start a page', not harness.reqs() and await pg.input_value('#direction') == 'A lantern waits beside the door.')
    await pg.click('#mineBtn')
    await pg.click('.passage.selected .pctl button:has-text("Rewrite…")')
    rewrite = pg.locator('.rewriterow input')
    await rewrite.fill('灯りを優しく')
    await rewrite.dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
    check('confirming a composed character does not send a rewrite', await rewrite.is_visible() and await rewrite.input_value() == '灯りを優しく' and not harness.reqs())
    await pg.locator('.rewriterow button:has-text("Cancel")').click()
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
    await pg.set_viewport_size({'width': 360, 'height': 840})
    await pg.evaluate("async()=>{const d=await import('/js/ui/dom.js');d.toast('Your words are kept safely. Return to this conversation whenever you are ready to carry on.');}")
    bounds = await pg.locator('#toast').bounding_box()
    check('a phone notice uses the available width and stays within the screen', bounds['width'] >= 280 and bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= 360, bounds)
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


async def scenario_folded_menus(browser):
    """An open menu follows a folded screen without replacing focus or Back."""
    logs = []
    pg = await harness.page(browser, logs, w=853, hgt=900, mobile=False)
    await harness.new_book(pg, title='A Fold in the Page')
    route = await pg.evaluate('location.hash')
    await pg.click('#moreBtn')
    await pg.wait_for_selector('.menu-pop')
    await pg.evaluate("""async () => {
      window.beforeFoldMenu = document.querySelector('.menu-pop');
      window.beforeFoldFocus = document.activeElement;
      window.beforeFoldDepth = (await import('/js/ui/dom.js')).backDepth();
    }""")
    for width in (402, 360, 853):
        await pg.set_viewport_size({'width': width, 'height': 900})
        await pg.wait_for_function("""() => {
          const r = document.querySelector('.menu-pop').getBoundingClientRect();
          return r.left >= 7 && r.right <= innerWidth - 7 && r.top >= 7 && r.bottom <= innerHeight - 7;
        }""")
        same = await pg.evaluate("""async () => ({
          menu: document.querySelector('.menu-pop') === window.beforeFoldMenu,
          focus: document.activeElement === window.beforeFoldFocus,
          depth: (await import('/js/ui/dom.js')).backDepth() === window.beforeFoldDepth
        })""")
        check(f'the menu stays onscreen at {width}px with the same focus and Back step', all(same.values()), same)

    # A short visual viewport (the keyboard or landscape) must also keep the
    # focused final item visible inside the menu's own scrolling area.
    await pg.keyboard.press('End')
    await pg.set_viewport_size({'width': 402, 'height': 320})
    await pg.wait_for_timeout(150)
    visible = await pg.evaluate("""() => {
      const m = document.querySelector('.menu-pop').getBoundingClientRect();
      const a = document.activeElement.getBoundingClientRect();
      return m.top >= 7 && m.bottom <= innerHeight - 7 && a.top >= m.top && a.bottom <= m.bottom;
    }""")
    check('a short viewport keeps the focused menu item visible', visible)
    await pg.keyboard.press('Escape')
    await pg.wait_for_selector('.menu-pop', state='detached')
    await pg.wait_for_timeout(150)
    check('Back after folding closes only the menu and restores More', await pg.evaluate('document.activeElement.id === "moreBtn"') and await pg.evaluate('location.hash') == route)
    await pg.set_viewport_size({'width': 853, 'height': 900})
    await pg.evaluate("""() => {
      window.dispatchEvent(new Event('resize'));
      if (window.visualViewport) {
        visualViewport.dispatchEvent(new Event('resize'));
        visualViewport.dispatchEvent(new Event('scroll'));
      }
    }""")
    await pg.wait_for_timeout(100)
    check('later viewport events cannot revive a closed menu', await pg.locator('.menu-pop').count() == 0)
    check('folding menus produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_drawer_to_column(browser):
    """An active drawer becomes a column without losing its writing or focus."""
    logs = []
    pg = await harness.page(browser, logs, w=1440, hgt=900, mobile=False)
    await pg.add_init_script("localStorage.setItem('cozynovel.left', 'off'); localStorage.setItem('cozynovel.right', 'off');")
    await harness.new_book(pg, title='Room for the Conversation')
    check('a saved closed column still starts closed on a wide screen', not await pg.locator('#sidePane').is_visible() and not await pg.locator('#chaptersPane').is_visible())
    await pg.set_viewport_size({'width': 402, 'height': 900})
    await pg.click('#partnerBtn')
    draft = pg.locator('#sideFoot textarea')
    await draft.fill('Keep these words while the screen grows.')
    await draft.evaluate('(el) => { el.setSelectionRange(5, 16); window.columnDraft = el; }')
    await pg.set_viewport_size({'width': 1440, 'height': 900})
    await pg.wait_for_timeout(350)
    state = await draft.evaluate("""(el) => ({
      same: el === window.columnDraft, focused: el === document.activeElement,
      text: el.value, selection: [el.selectionStart, el.selectionEnd],
      docked: el.closest('aside').classList.contains('dock'),
      visible: getComputedStyle(el).visibility === 'visible'
    })""")
    check('the open Partner becomes a visible column with its original draft and selection', state['same'] and state['focused'] and state['docked'] and state['visible'] and state['text'] == 'Keep these words while the screen grows.' and state['selection'] == [5, 16], state)
    check('becoming a column releases only the drawer Back step', await pg.evaluate("async () => (await import('/js/ui/dom.js')).backDepth()") == 0)
    await pg.set_viewport_size({'width': 1300, 'height': 900})
    await pg.wait_for_timeout(100)
    check('the active column stays open on subsequent resizes', await draft.is_visible() and await draft.evaluate('(el) => el === document.activeElement'))

    await pg.set_viewport_size({'width': 402, 'height': 900})
    await pg.wait_for_timeout(350)
    inverse = await draft.evaluate("""(el) => ({
      same: el === window.columnDraft, focused: el === document.activeElement,
      selection: [el.selectionStart, el.selectionEnd],
      open: el.closest('aside').classList.contains('open'),
      visible: getComputedStyle(el).visibility === 'visible'
    })""")
    check('folding the focused column returns its original draft and selection to a drawer', inverse['same'] and inverse['focused'] and inverse['open'] and inverse['visible'] and inverse['selection'] == [5, 16], inverse)
    check('the returning drawer has exactly one Back step', await pg.evaluate("async () => (await import('/js/ui/dom.js')).backDepth()") == 1)
    await pg.keyboard.press('Escape')
    await pg.wait_for_function("!document.querySelector('#sidePane').classList.contains('open')")
    check('Back closes the returned drawer and restores Partner focus', await pg.evaluate('document.activeElement.id === "partnerBtn" && !document.querySelector("#desk").hidden'))
    await pg.click('#partnerBtn')
    await pg.locator('.convrow button[aria-label="Full screen"]').click()
    await pg.wait_for_selector('#sidePane.full')
    await draft.focus()
    await draft.evaluate('(el) => el.setSelectionRange(5, 16)')
    await pg.set_viewport_size({'width': 1440, 'height': 900})
    await pg.wait_for_timeout(350)
    check('a full-screen Partner stays full while its drawer becomes a column', await pg.locator('#sidePane.full').count() == 1 and await draft.evaluate('(el) => el === document.activeElement && el.selectionStart === 5 && el.selectionEnd === 16'))
    await pg.keyboard.press('Escape')
    await pg.wait_for_function("!document.querySelector('#sidePane').classList.contains('full')")
    await pg.wait_for_function('!document.fullscreenElement')
    await pg.evaluate("async () => (await import('/js/ui/dom.js')).afterBacks()")
    check('Back leaves full screen for the visible Partner column', await pg.locator('#sidePane.dock').is_visible() and await pg.locator('#desk').is_visible())

    await pg.set_viewport_size({'width': 402, 'height': 900})
    # The viewport command can return before the resize handler carries the
    # focused column into its drawer. Wait for that transition before
    # deciding whether the drawer needs closing.
    await pg.wait_for_function("!document.querySelector('#sidePane').classList.contains('dock')")
    if await pg.locator('#sidePane.open').count():
        await pg.click('#sideClose')
        await pg.wait_for_function("!document.querySelector('#sidePane').classList.contains('open')")
    await pg.click('#bookTitle')
    chapter = pg.locator('#chaptersBody button.go').first
    await chapter.focus()
    await chapter.evaluate('(el) => { window.columnChapter = el; }')
    await pg.evaluate("""async () => {
      const s = await import('/js/store.js');
      s.change('novel', location.hash.split('/')[2], n => { n.meta.subtitle = 'A room for every chapter'; });
      await s.flush();
    }""")
    check('a book save keeps the actual focused chapter button', await chapter.evaluate('(el) => el === window.columnChapter && el === document.activeElement'))
    await pg.evaluate("""async () => {
      const s = await import('/js/store.js');
      const n = s.peek('novel', location.hash.split('/')[2]);
      s.change('chapter', n.order[0], c => { c.summary = {text: 'The lantern waits by the door.'}; });
    }""")
    await pg.wait_for_function('document.querySelector("#chaptersBody .sum").textContent === "The lantern waits by the door."')
    check('an arriving summary updates the chapter without taking keyboard focus', await chapter.evaluate('(el) => el === window.columnChapter && el === document.activeElement'))
    await pg.set_viewport_size({'width': 1440, 'height': 900})
    await pg.wait_for_timeout(350)
    left = await chapter.evaluate('(el) => ({ same: el === window.columnChapter, focused: el === document.activeElement, active: document.activeElement.outerHTML.slice(0, 120), pane: el.closest("aside").className, visible: getComputedStyle(el).visibility })')
    check('the focused Chapters drawer also becomes a visible column', await chapter.is_visible() and left['focused'] and await pg.locator('#chaptersPane.dock').count() == 1, left)
    await pg.set_viewport_size({'width': 402, 'height': 900})
    await pg.wait_for_timeout(350)
    left = await chapter.evaluate('(el) => ({ focused: el === document.activeElement, active: document.activeElement.outerHTML.slice(0, 120), pane: el.closest("aside").className, visible: getComputedStyle(el).visibility })')
    check('the focused Chapters column returns as a drawer', await chapter.is_visible() and left['focused'] and await pg.locator('#chaptersPane.open').count() == 1, left)
    await pg.keyboard.press('Escape')
    await pg.wait_for_function("!document.querySelector('#chaptersPane').classList.contains('open')")
    check('Back from the returning Chapters drawer restores the chapter button', await pg.evaluate('document.activeElement.id === "bookTitle"'))
    check('changing drawers into columns produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def main():
    with harness.Env():
        async with async_playwright() as playwright:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await playwright.chromium.launch(**options)
            for scenario in (scenario_dialogs, scenario_names_and_picker, scenario_search, scenario_folded_menus, scenario_drawer_to_column):
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
