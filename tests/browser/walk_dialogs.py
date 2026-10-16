"""Book details and kept requests: the last keystroke and every word survive.

Real browser and server, temporary books and a local stand-in model. Optional
ports allow this walk to run beside other browser walks.
"""
import asyncio
import os
import re
from pathlib import Path
import sys
import traceback

import harness
from playwright.async_api import async_playwright

harness.PORT = int(os.environ.get('COZY_TEST_PORT', harness.PORT))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', harness.PROV))
RESULTS = []
SHOTS = Path(os.environ.get('COZY_TEST_SHOTS', harness.SHOTS))
SHOTS.mkdir(parents=True, exist_ok=True)


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:300]}]'), flush=True)


async def open_book(pg):
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_selector('.booksheet.on')


async def close_sheet(pg):
    await pg.locator('.sheet.on .head button[aria-label="Close"]').click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.wait_for_timeout(250)


async def scenario_book(browser):
    """Book edits are kept before exporting, closing, or redrawing a cover."""
    logs = []
    pg = await harness.page(browser, logs, w=390, hgt=844)
    await harness.new_book(pg)
    await open_book(pg)
    await pg.locator('.group[data-key="book.export"] .ghead').click()
    await pg.get_by_role('textbox', name='Title', exact=True).fill('A Lantern Just Renamed')
    async with pg.expect_download() as received:
        await pg.get_by_role('button', name='Plain text', exact=True).click()
    download = await received.value
    text = Path(await download.path()).read_text()
    check('an immediate export uses the title just typed', download.suggested_filename == 'A-Lantern-Just-Renamed.txt' and text.startswith('A Lantern Just Renamed\n'), [download.suggested_filename, text[:80]])

    own = 'Mara keeps the letter.\n\n  Every space and “word” stays.  '
    style = 'Quiet, wry prose.\nNo change to these instructions.'
    plans = 'She will return before dawn.\nThe keeper does not know yet.'
    # All inputs and Close happen in one event loop turn, before any debounce.
    await pg.evaluate("""({own, style, plans}) => {
      const s = document.querySelector('.booksheet.on');
      const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set(s.querySelectorAll('.keptfield textarea.tall')[0], own);
      set(s.querySelectorAll('.keptfield textarea.tall')[1], style);
      set(s.querySelector('.book-plans textarea'), plans);
      s.querySelector('.head button').click();
    }""", {'own': own, 'style': style, 'plans': plans})
    await pg.wait_for_timeout(250)
    await open_book(pg)
    check('closing immediately keeps the exact premise', await pg.get_by_role('textbox', name='What it’s about — your words', exact=True).input_value() == own)
    check('closing immediately keeps the exact voice and plans', await pg.get_by_role('textbox', name='How it reads — your words', exact=True).input_value() == style and await pg.get_by_role('textbox', name='Where it’s headed', exact=True).input_value() == plans)
    check('every book textarea has an accessible name', await pg.locator('.booksheet.on').get_by_role('textbox', name=re.compile(r'.+'), include_hidden=True).count() == await pg.locator('.booksheet.on input, .booksheet.on textarea').count())

    about = pg.locator('.booksheet.on .keptfield').first
    await about.locator('.keptbox summary').click()
    correction = 'The letter belongs to Mara.\n  Her correction stays exactly.  '
    await about.locator('.keptbox textarea').fill(correction)
    await pg.locator('.booksheet.on .covers button[aria-label="moss"]').click()
    check('a cover change cannot erase a pending helper correction', await about.locator('.keptbox textarea').input_value() == correction)
    await close_sheet(pg)
    await open_book(pg)
    check('the pending helper correction survives closing and reopening', await pg.get_by_role('textbox', name='What it’s about — kept by the helper', exact=True).input_value() == correction)
    await pg.get_by_role('textbox', name='Title', exact=True).fill('The Lantern Keeper')
    await pg.get_by_role('textbox', name='Under the title', exact=True).fill('Letters from the storm coast')
    await close_sheet(pg)
    await pg.evaluate("import('/js/store.js').then(s=>s.flush())")
    await harness.settled_reload(pg)
    await pg.wait_for_selector('#desk:not([hidden])')
    await open_book(pg)
    check('book edits survive a full page reload', await pg.get_by_role('textbox', name='What it’s about — your words', exact=True).input_value() == own and await pg.get_by_role('textbox', name='What it’s about — kept by the helper', exact=True).input_value() == correction and await pg.locator('.covers button[aria-label="moss"]').get_attribute('aria-pressed') == 'true')
    await about.locator('.segmented button:text-is("Manual")').click()
    check('Manual hides the helper section and preserves your words', await about.locator('.keptbox').is_hidden() and await about.locator('textarea.tall').input_value() == own)
    await about.locator('.segmented button:text-is("Automatic")').click()
    check('Automatic restores the helper correction', await about.locator('.keptbox textarea').input_value() == correction)
    await about.locator('.keptbox summary').click()
    await pg.wait_for_timeout(350)
    await pg.evaluate("document.querySelector('#toast')?.remove()")
    await pg.locator('.booksheet.on .body').evaluate('(e)=>e.scrollTop=0')
    await pg.screenshot(path=str(SHOTS / 'book-after-phone.png'))
    await pg.locator('.booksheet.on .body').evaluate('(e)=>e.scrollTop=e.scrollHeight')
    await pg.screenshot(path=str(SHOTS / 'book-bottom-phone.png'))
    await pg.locator('.booksheet.on .body').evaluate('(e)=>e.scrollTop=0')
    for theme in ('academy', 'tokyo', 'study'):
        for mode in ('dark', 'light'):
            await pg.evaluate("async (look)=>(await import('/js/ui/look.js')).applyLook(look)", {'theme': theme, 'mode': mode})
            check(f'book details fit the phone in {theme} {mode}', await pg.locator('.booksheet.on .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    await pg.evaluate("import('/js/ui/look.js').then(m=>m.applyLook(m.DEFAULT_LOOK))")
    for width in (320, 360, 390):
        await pg.set_viewport_size({'width': width, 'height': 844})
        close = pg.locator('.sheet.on .head button[aria-label=Close]')
        await close.click(trial=True)
        fits = await close.evaluate('(e)=>{const b=e.getBoundingClientRect(),h=e.closest(".head").getBoundingClientRect();return b.left>=h.left&&b.right<=h.right&&b.width>=32&&b.height>=32;}')
        check(f'the dialog Close control fits and can be clicked at {width}px', fits)
        check(f'the full dialog fits at {width}px', await pg.locator('.sheet.on .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    await pg.set_viewport_size({'width':1440,'height':1000})
    await pg.screenshot(path=str(SHOTS / 'book-after-desktop.png'))
    check('book details fit the desktop', await pg.locator('.booksheet.on .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    check('book details produce no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_kept_again(browser):
    """A helper rewrite keeps the correction just typed until its answer lands."""
    logs = []
    pg = await harness.page(browser, logs)
    await harness.new_book(pg, title='The Correction That Waited')
    await pg.fill('#direction', 'Mara opened the letter at the lighthouse. The rain waited at the window.')
    await pg.click('#mineBtn')
    gate, started = asyncio.Event(), asyncio.Event()

    async def held(route):
        started.set()
        await gate.wait()
        await route.continue_()

    await pg.route('**/api/call', held)
    await pg.evaluate("""async port => {
      const s = await import('/js/store.js'), shape = await import('/js/novel/shape.js');
      const id = location.hash.split('/')[2];
      for (const key of ['about', 'style']) s.change('novel', id, shape.novelSteps.setKept(key, {text:'Earlier saved ' + key, by:'you', at:Date.now()}));
      s.change('house', 'house', h => {
        h.connections.push({id:'test-helper', name:'Test helper', url:`http://127.0.0.1:${port}/v1`, model:'fake-writer', key:'test-key'});
        h.roles = {...h.roles, helper:'test-helper', checker:'off'};
      }, {now:true});
      (await import('/js/ui/book.js')).openBook(id);
    }""", harness.PROV)
    await pg.wait_for_selector('.booksheet.on')
    correction = 'New correction typed immediately before asking again.'
    # One event-loop turn: a user can ask again before the 600ms save lands.
    result = await pg.evaluate("""async correction => {
      const field = document.querySelector('.booksheet .keptfield');
      const text = field.querySelector('.keptbox textarea');
      text.value = correction; text.dispatchEvent(new Event('input', {bubbles:true}));
      field.querySelector('.keptbox button').click();
      const s = await import('/js/store.js'), id = location.hash.split('/')[2];
      return {kept:s.peek('novel', id).kept.about, visible:text.value};
    }""", correction)
    check('asking the helper again first keeps the correction just typed', result['kept']['text'] == correction and result['visible'] == correction and result['kept']['again'], result)
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
        await pg.wait_for_timeout(800)
        kept = await pg.evaluate("import('/js/store.js').then(s=>s.peek('novel',location.hash.split('/')[2]).kept.about)")
        check('the latest correction stays while the helper response is delayed', kept['text'] == correction and kept.get('again'), kept)
    finally:
        gate.set()
    await pg.wait_for_function("!document.querySelector('.booksheet .keptfield .keptbox .say').textContent.includes('Being written again')", timeout=30000)
    kept = await pg.evaluate("import('/js/store.js').then(s=>s.peek('novel',location.hash.split('/')[2]).kept.about)")
    check('the new helper words replace the correction only after they arrive', 'lighthouse keeper' in kept['text'] and not kept.get('again'), kept)
    check('asking the helper again produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_new_book_typing(browser):
    """A new book: words typed into a field in the sheet's first moment stay in that field."""
    logs = []
    pg = await harness.page(browser, logs, w=390, hgt=844)
    await pg.goto(f'http://127.0.0.1:{harness.PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)', timeout=8000)
    begin = 'button:has-text("Begin a book")' if await pg.locator('button:has-text("Begin a book")').count() else 'button[aria-label="Begin a new book"]'
    # the sheet opens and, in the same moment, he is already typing what it is about
    await pg.click(begin)
    await pg.evaluate("""() => {
      const s = document.querySelector('.sheet.on');
      const title = s.querySelector('input[placeholder="A working title"]');
      title.value = 'Salt Roads';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      s.querySelector('textarea').focus();
    }""")
    await pg.wait_for_timeout(300)
    focused = await pg.evaluate("document.activeElement && document.activeElement.tagName")
    await pg.keyboard.type('Two smugglers cross the dunes.')
    values = await pg.evaluate("""() => { const s = document.querySelector('.sheet.on');
      return { title: s.querySelector('input[placeholder="A working title"]').value, brief: s.querySelector('textarea').value }; }""")
    check('a field in use keeps the keyboard when the sheet finishes opening', focused == 'TEXTAREA', focused)
    check('the words go where they were typed, the title stays the title', values == {'title': 'Salt Roads', 'brief': 'Two smugglers cross the dunes.'}, values)
    await pg.locator('.sheet.on .head button[aria-label="Close"]').click()
    # opened with nothing in use, the title takes the keyboard as before
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.click(begin)
    await pg.wait_for_timeout(300)
    check('opened untouched, the title takes the keyboard', await pg.evaluate("document.activeElement && document.activeElement.getAttribute('placeholder')") == 'A working title')
    check('the new book sheet produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def scenario_sent(browser):
    """Sent messages preserve exact words and expose their expanded state."""
    logs = []
    pg = await harness.page(browser, logs, w=390, hgt=844)
    await harness.new_book(pg, title='Letters to the Keeper')
    messages = [
        {'role':'system', 'content':'You are a careful novelist. Keep the story warm, specific and true to its people.'},
        {'role':'user', 'content':'THE BOOK\n\nA lighthouse keeper on a stormy coast finds a letter in a bottle.\n\n  These spaces stay.  '},
        {'role':'user', 'content':'Bring Mara to the old lighthouse.\nLet the keeper recognize the letter.'},
    ]
    await pg.evaluate("""async messages=>{
      const s=await import('/js/store.js'), id=location.hash.split('/')[2];
      await s.keepSent(id,'test-sent',{at:Date.now(),ms:18300,model:'Lantern storyteller',url:'http://127.0.0.1/local-test',usage:{in:3850,out:847,cached:1840},body:{model:'Lantern storyteller',temperature:0.8,max_tokens:4000,messages}});
      await (await import('/js/ui/sent.js')).showSent(id,'test-sent');
    }""", messages)
    await pg.wait_for_selector('.sentmsg')
    check('kept messages remain exact and in order', await pg.locator('.sentmsg pre').all_text_contents() == [m['content'] for m in messages])
    buttons = pg.locator('.sentmsg > button')
    check('only the last message starts expanded', await buttons.evaluate_all('(els)=>els.map(e=>e.getAttribute("aria-expanded"))') == ['false','false','true'])
    await buttons.nth(1).focus()
    await pg.keyboard.press('Enter')
    check('a message opens from the keyboard and says it is expanded', await buttons.nth(1).get_attribute('aria-expanded') == 'true' and await pg.locator('.sentmsg pre').nth(1).is_visible())
    await buttons.nth(1).click()
    check('a message folds without losing its words', await buttons.nth(1).get_attribute('aria-expanded') == 'false' and await pg.locator('.sentmsg pre').nth(1).text_content() == messages[1]['content'])
    await pg.locator('.sent-details summary').click()
    check('request settings are available in their own fold', 'temperature' in await pg.locator('.sent-details').inner_text() and '0.8' in await pg.locator('.sent-details').inner_text())
    await pg.locator('.sent-details summary').click()
    await pg.get_by_role('button',name='Copy the whole request',exact=True).click()
    await pg.wait_for_function("document.querySelector('#toast')?.textContent === 'The whole request is copied.'")
    check('copying the full request succeeds inside its sheet', await pg.locator('#toast').inner_text() == 'The whole request is copied.')
    await pg.evaluate("document.querySelector('#toast')?.remove()")
    await pg.locator('.sentsheet.on .body').evaluate('(e)=>e.scrollTop=0')
    await pg.screenshot(path=str(SHOTS / 'sent-after-phone.png'))
    for theme in ('academy', 'tokyo', 'study'):
        for mode in ('dark', 'light'):
            await pg.evaluate("async (look)=>(await import('/js/ui/look.js')).applyLook(look)", {'theme': theme, 'mode': mode})
            check(f'Sent fits the phone in {theme} {mode}', await pg.locator('.sentsheet.on .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    await pg.evaluate("import('/js/ui/look.js').then(m=>m.applyLook(m.DEFAULT_LOOK))")
    for width in (320, 360, 390):
        await pg.set_viewport_size({'width': width, 'height': 844})
        close = pg.locator('.sheet.on .head button[aria-label=Close]')
        await close.click(trial=True)
        fits = await close.evaluate('(e)=>{const b=e.getBoundingClientRect(),h=e.closest(".head").getBoundingClientRect();return b.left>=h.left&&b.right<=h.right&&b.width>=32&&b.height>=32;}')
        check(f'the dialog Close control fits and can be clicked at {width}px', fits)
        check(f'the full dialog fits at {width}px', await pg.locator('.sheet.on .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    await pg.set_viewport_size({'width':1440,'height':1000})
    await pg.screenshot(path=str(SHOTS / 'sent-after-desktop.png'))
    check('Sent fits the desktop', await pg.locator('.sentsheet.on .body').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
    await close_sheet(pg)
    await pg.evaluate("""async()=>{const id=location.hash.split('/')[2];await(await import('/js/ui/sent.js')).showSent(id,'missing-test');}""")
    check('a missing kept request is explained', 'not kept any more' in await pg.locator('.sentsheet.on .body').inner_text())
    check('Sent produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def main():
    with harness.Env():
        async with async_playwright() as playwright:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await playwright.chromium.launch(**options)
            for scenario in (scenario_book, scenario_new_book_typing, scenario_sent, scenario_kept_again):
                print(scenario.__doc__, flush=True)
                try:
                    await scenario(browser)
                except Exception:
                    traceback.print_exc()
                    check(scenario.__name__ + ' ran to the end', False, traceback.format_exc()[-600:])
            await browser.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\ndialogs: {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    asyncio.run(main())
