"""Per-book narration choices: real controls, saved records, and unchanged prose.

Temporary books only. No connection is configured and no model is called.
"""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', harness.PORT))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', harness.PROV))
from harness import Env, PORT, SHOTS, async_playwright, new_book, page


RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:350]}]'), flush=True)


async def about(pg):
    await pg.click('#moreBtn')
    await pg.locator('.menu-pop button').filter(has_text='About this book').click()
    await pg.wait_for_selector('.booksheet.on')


async def saved(pg, nid):
    return await pg.evaluate("""async id => {
      await (await import('/js/store.js')).flush('novel', id);
      return (await (await fetch('/api/store/novel/' + id)).json()).data;
    }""", nid)


async def scenario_viewpoint(browser):
    """Viewpoint and tense stay with this book without changing its words."""
    logs = []
    pg = await page(browser, logs)
    try:
        await new_book(pg, 'The Window at Dawn')
        nid = (await pg.evaluate('location.hash')).split('/')[2]
        fixture = await pg.evaluate("""async id => {
          const s = await import('/js/store.js');
          const shape = await import('/js/novel/shape.js');
          const own = 'First person, present tense, close on Mara. Keep my quiet, wry voice.';
          const kept = 'The older pages use third person and past tense.';
          const words = 'I open the window. Dawn warms the stone beneath my hands.';
          const n = s.peek('novel', id);
          s.change('novel', id, x => { x.style = own; x.kept.style = { text: kept, by: 'you', at: Date.now() }; });
          await s.open('chapter', n.order[0]);
          s.change('chapter', n.order[0], c => c.passages.push(shape.newPassage('you', words)));
          const other = shape.newNovel({ title: 'Another Book' });
          await s.create('chapter', other.chapter.id, other.chapter);
          await s.create('novel', other.novel.id, other.novel);
          await s.flush();
          return { own, kept, words, chapter: n.order[0], other: other.novel.id };
        }""", nid)
        await about(pg)
        pov = pg.get_by_label('Point of view', exact=True)
        tense = pg.get_by_label('Tense', exact=True)
        check('an existing book follows its own instructions and pages by default',
              await pov.input_value() == 'auto' and await tense.input_value() == 'auto')
        check('the choices explain precedence without promising to rewrite old pages',
              'instructions and requests for a particular passage still come first' in
              await pg.inner_text('.book-narration') and
              'existing pages stay as they are' in await pg.inner_text('.book-narration'))
        check('the scene keeps the character’s words, actions and feelings with the player',
              'your character’s words, actions and feelings still come from you' in
              await pg.inner_text('.book-narration-note'))

        for value in ('first', 'second', 'third-limited', 'third-omniscient'):
            await pov.select_option(value)
            record = await saved(pg, nid)
            check(f'{value} saves through the Point of view control', record['prefs'].get('pov') == value)
            hint = await pg.inner_text('#book-pov-hint')
            check(f'{value} has a readable explanation linked to its control',
                  bool(hint) and await pov.get_attribute('aria-describedby') == 'book-pov-hint')
        for value in ('past', 'present'):
            await tense.select_option(value)
            record = await saved(pg, nid)
            check(f'{value} saves through the Tense control', record['prefs'].get('tense') == value)
        record = await saved(pg, nid)
        check('the choices preserve the writer’s custom prose instructions and corrected helper style',
              record['style'] == fixture['own'] and record['kept']['style']['text'] == fixture['kept'])
        chapter = await pg.evaluate("id => fetch('/api/store/chapter/' + id).then(r => r.json()).then(j => j.data)", fixture['chapter'])
        check('changing narration defaults does not change existing text or add a version',
              len(chapter['passages']) == 1 and len(chapter['passages'][0]['versions']) == 1 and
              chapter['passages'][0]['versions'][0]['text'] == fixture['words'])
        other = await saved(pg, fixture['other'])
        check('another book keeps its own default choices',
              not other['prefs'].get('pov') and not other['prefs'].get('tense'))

        reads = pg.locator('.keptfield').filter(has=pg.locator('.keptname', has_text='How it reads'))
        for label in ('Manual', 'Automatic'):
            await reads.get_by_role('button', name=label, exact=True).click()
            check(f'narration controls remain available with {label} style',
                  await pov.is_visible() and await tense.is_visible() and
                  await pov.input_value() == 'third-omniscient' and await tense.input_value() == 'present')

        await pg.locator('.booksheet .head button[aria-label="Close"]').click()
        await pg.wait_for_function('!history.state || !history.state.cozy')
        await pg.locator('.booksheet').wait_for(state='detached')
        await pg.reload(wait_until='domcontentloaded')
        await pg.wait_for_selector('#desk:not([hidden])')
        await about(pg)
        check('both choices survive closing the sheet and reloading the book',
              await pov.input_value() == 'third-omniscient' and await tense.input_value() == 'present')
        await pg.evaluate("""async id => {
          const s = await import('/js/store.js');
          const { novelSteps } = await import('/js/novel/shape.js');
          s.change('novel', id, novelSteps.setPref('pov', 'second'));
          s.change('novel', id, novelSteps.setPref('tense', 'past'));
        }""", nid)
        check('an open sheet reflects updated saved choices without reopening',
              await pov.input_value() == 'second' and await tense.input_value() == 'past')
        await pov.select_option('auto')
        await tense.select_option('auto')
        record = await saved(pg, nid)
        check('Follow the book removes only the explicit narration choices',
              'pov' not in record['prefs'] and 'tense' not in record['prefs'] and
              record['style'] == fixture['own'] and record['kept']['style']['text'] == fixture['kept'])

        # An older or imported record may contain an unknown spelling. It
        # must not blank the controls or force a new narration style.
        await pg.evaluate("""async id => {
          const s = await import('/js/store.js');
          s.change('novel', id, n => { n.prefs.pov = 'unknown-view'; n.prefs.tense = 'future'; });
          await s.flush('novel', id);
        }""", nid)
        check('unknown stored values fall back to Follow the book',
              await pov.input_value() == 'auto' and await tense.input_value() == 'auto')
        await pov.select_option('third-omniscient')
        await tense.select_option('present')
        for width in (320, 412, 853):
            await pg.set_viewport_size({'width': width, 'height': 850})
            await pov.scroll_into_view_if_needed()
            fit = await pg.evaluate("""() => {
              const sheet = document.querySelector('.booksheet .body');
              const box = sheet.getBoundingClientRect();
              const nodes = [...document.querySelectorAll('.book-narration select, .book-narration em')];
              return { overflow: sheet.scrollWidth - sheet.clientWidth,
                outside: nodes.some(n => {const r=n.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1}) };
            }""")
            check(f'viewpoint and tense controls fit at {width}px', fit['overflow'] <= 1 and not fit['outside'], fit)
        await pg.set_viewport_size({'width': 412, 'height': 915})
        await pov.scroll_into_view_if_needed()
        await pg.screenshot(path=SHOTS + '/book-viewpoint-phone.png')
        check('the viewpoint walk has no page errors',
              not [line for line in logs if line.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def main():
    with Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                await scenario_viewpoint(browser)
            except Exception:
                traceback.print_exc()
                check('the viewpoint scenario ran to the end', False, traceback.format_exc()[-500:])
            finally:
                await browser.close()
    failed = [row for row in RESULTS if not row[1]]
    print(f'\nbrowser (viewpoint): {len(RESULTS) - len(failed)} passed, {len(failed)} failed')
    print(f'Screenshots: {SHOTS}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
