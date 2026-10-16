"""The story map: what each chapter is for, which chapter is the last, how the
book ends and how long it is meant to be — set where he looks for them, kept
with the book, and sent to the writer only where they belong. And the drawers
that open at his touch.

Real browser and server, a temporary library and the stand-in model; no paid
calls. The default ports are its own; environment overrides work.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '21781'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '21799'))
RESULTS = []

PLAN = 'Mara finds the letter in the lamp room and decides, against Rowan, to answer it.'
ENDING = 'Mara leaves the lighthouse on the last boat and the light stays lit behind her.'


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:400]}]'), flush=True)


def writing():
    """what the writer was sent: its pages, never the helper's or the checker's"""
    out = []
    for x in H.reqs():
        if not x['path'].endswith('/chat/completions'):
            continue
        msgs = [m.get('content') for m in (x['body'].get('messages') or []) if isinstance(m.get('content'), str)]
        joined = '\n'.join(msgs)
        if 'Check these passages from' in joined or "for the book's notes" in joined or 'Update the notes' in joined:
            continue
        out.append(joined)
    return out


async def novel(pg):
    return await pg.evaluate("async()=>{const s=await import('/js/store.js');return structuredClone(s.peek('novel',location.hash.split('/')[2]));}")


async def chapter(pg):
    return await pg.evaluate("async()=>{const s=await import('/js/store.js');const n=s.peek('novel',location.hash.split('/')[2]);return structuredClone(s.peek('chapter',location.hash.split('/')[3]||n.order[0]));}")


async def flush(pg):
    await pg.evaluate("import('/js/store.js').then(s=>s.flush())")


async def idle(pg, t=10000):
    await pg.wait_for_function("!document.querySelector('.passage.streaming') && document.querySelector('#writeBtn').textContent.trim() !== 'Stop'", timeout=t)


async def write(pg, direction):
    await pg.fill('#direction', direction)
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(150)
    await idle(pg)


async def chapters_pane(pg):
    if not await pg.locator('.chlist li').count() or not await pg.locator('.chlist').is_visible():
        await pg.click('#bookTitle')
    await pg.wait_for_selector('.chlist li')
    await pg.wait_for_timeout(300)


async def chapter_menu(pg):
    await chapters_pane(pg)
    await pg.locator('.chlist li').first.get_by_role('button', name='More for this chapter').click()
    await pg.wait_for_selector('.menu-pop')
    return await pg.evaluate("""() => [...document.querySelectorAll('.menu-pop button')].map(b => ({
      label: (b.querySelector('.mlabel') || b).textContent.trim(), hint: (b.querySelector('.mhint') || {}).textContent || '' }))""")


async def to_page(pg):
    """the chapters drawer put away, back to the page"""
    if await pg.evaluate("document.querySelector('#chaptersPane').classList.contains('open')"):
        await pg.click('#chaptersClose')
        await pg.wait_for_timeout(350)


async def close_sheet(pg):
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_timeout(350)


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs)
    await H.new_book(pg, 'The Last Boat', 'A lighthouse keeper finds a letter and must decide whether to leave.')
    await H.add_conn(pg)
    await write(pg, 'Mara climbs to the lamp room.')
    check('a first page is written', await pg.locator('#passages .passage').count() >= 1)

    # What this chapter is for — found in the chapter's own menu, with its hint.
    items = await chapter_menu(pg)
    check('every item in the chapter menu carries a hint line', all(i['hint'].strip() for i in items), [i for i in items if not i['hint'].strip()])
    labels = [i['label'] for i in items]
    check('the chapter menu offers “What this chapter is for” and “Make it the last chapter”',
          'What this chapter is for' in labels and 'Make it the last chapter' in labels, labels)
    await pg.locator('.menu-pop button:has-text("What this chapter is for")').click()
    dialog = pg.get_by_role('dialog', name='What Chapter One is for', exact=True)
    await dialog.wait_for()
    await dialog.locator('textarea').fill(PLAN)
    await dialog.get_by_role('button', name='Keep it', exact=True).click()
    await pg.wait_for_timeout(300)
    await flush(pg)
    check('the plan is kept with its chapter, as he wrote it', (await chapter(pg)).get('plan') == PLAN, (await chapter(pg)).get('plan'))
    await chapters_pane(pg)
    shown = await pg.locator('.chlist li').first.locator('.plan').inner_text()
    check('the chapters list shows the plan under the chapter', shown.startswith('Planned: Mara finds the letter'), shown)
    items = await chapter_menu(pg)
    check('the same item now reads “Change what this chapter is for”', 'Change what this chapter is for' in [i['label'] for i in items], items)
    await pg.locator('.menu-pop button:has-text("Change what this chapter is for")').click()
    dialog = pg.get_by_role('dialog', name='What Chapter One is for', exact=True)
    await dialog.wait_for()
    check('changing it starts from his own words', await dialog.locator('textarea').input_value() == PLAN)
    await dialog.locator('textarea').fill('')
    await dialog.get_by_role('button', name='Keep it', exact=True).click()
    await pg.wait_for_timeout(300)
    check('emptied, the plan is gone', 'plan' not in (await chapter(pg)), await chapter(pg))
    await chapters_pane(pg)
    check('and the list no longer shows one', await pg.locator('.chlist li').first.locator('.plan').is_hidden())
    await chapter_menu(pg)
    await pg.locator('.menu-pop button:has-text("What this chapter is for")').click()
    dialog = pg.get_by_role('dialog', name='What Chapter One is for', exact=True)
    await dialog.wait_for()
    await dialog.locator('textarea').fill(PLAN)
    await dialog.get_by_role('button', name='Keep it', exact=True).click()
    await pg.wait_for_timeout(300)

    # How it ends and how long — in About this book.
    await to_page(pg)
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_selector('.sheet.on .book-ending textarea')
    await pg.fill('.sheet.on .book-ending textarea', ENDING)
    await pg.fill('.sheet.on .book-goal input', '90.000')
    await pg.wait_for_timeout(800)
    said = await pg.locator('.sheet.on .book-goal em').inner_text()
    check('the goal is read as ninety thousand, and how far the book has come is said', said.endswith('of 90,000 words — 0% of the way.'), said)
    await close_sheet(pg)
    await flush(pg)
    n = await novel(pg)
    check('how it ends and the goal are kept with the book', n.get('ending') == ENDING and n['meta'].get('goal') == 90000, {'ending': n.get('ending'), 'goal': n['meta'].get('goal')})
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_selector('.sheet.on .book-ending textarea')
    check('opened again, both stand as he left them',
          await pg.input_value('.sheet.on .book-ending textarea') == ENDING and await pg.input_value('.sheet.on .book-goal input') == '90,000')
    await close_sheet(pg)
    await chapters_pane(pg)
    total = await pg.locator('.chapter-total').inner_text()
    check('the chapters list counts the book against the goal', 'of 90,000 words' in total and '% of the way' in total, total)

    # The writer: the plan always in its chapter; the ending only once it is the last.
    H.reset()
    await to_page(pg)
    await write(pg, 'Rowan comes up the stairs.')
    sent = writing()
    check('the writer reads the chapter’s plan while writing in it', any(PLAN in s and 'my plan for it' in s for s in sent), [s[-600:] for s in sent])
    check('and is not told how the book ends before its last chapter', sent and not any(ENDING in s or 'This is the book’s last chapter.' in s for s in sent), [s[-600:] for s in sent])

    items = await chapter_menu(pg)
    await pg.locator('.menu-pop button:has-text("Make it the last chapter")').click()
    await pg.wait_for_timeout(300)
    await flush(pg)
    n, c = await novel(pg), await chapter(pg)
    check('“Make it the last chapter” marks it', (n.get('prefs') or {}).get('endsAt') == c['id'], n.get('prefs'))
    await chapters_pane(pg)
    last = await pg.locator('.chlist li').first.locator('.n').text_content()
    check('the list says which chapter is the last', 'Chapter One · the last' in last, last)
    items = await chapter_menu(pg)
    check('the menu now offers “Not the last chapter after all” in its place',
          'Not the last chapter after all' in [i['label'] for i in items] and 'Make it the last chapter' not in [i['label'] for i in items], items)
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(200)
    await to_page(pg)
    H.reset()
    await write(pg, 'Mara reads the letter aloud.')
    sent = writing()
    check('in the last chapter the writer is told how he means it to end', any('This is the book’s last chapter.' in s and ENDING in s for s in sent), [s[-800:] for s in sent])

    await chapter_menu(pg)
    await pg.locator('.menu-pop button:has-text("Not the last chapter after all")').click()
    await pg.wait_for_timeout(300)
    await to_page(pg)
    H.reset()
    await write(pg, 'The boat horn sounds below.')
    sent = writing()
    check('taken back, the ending is no longer sent', sent and not any(ENDING in s for s in sent), [s[-600:] for s in sent])

    # The notes drawer opens at once, its contents drawn on the frame after.
    await to_page(pg)
    await pg.click('#notesBtn')
    opened = await pg.evaluate("""() => ({ open: document.querySelector('#sidePane').classList.contains('open'),
      tab: (document.querySelector('#sideTabs [aria-selected=true]') || {}).textContent || '' })""")
    await pg.wait_for_timeout(500)
    drawn = await pg.evaluate("""() => ({ open: document.querySelector('#sidePane').classList.contains('open'), text: document.querySelector('#sideBody').innerText.length })""")
    check('Notes opens its drawer with its tab chosen at once', opened['open'] and 'Notes' in opened['tab'], opened)
    check('and what is in it is drawn', drawn.get('open') and drawn.get('text', 0) > 20, drawn)

    # The partner can map the chapters to the end.
    await pg.click('#sideTabs [data-tab="partner"]')
    await pg.wait_for_timeout(500)
    await pg.get_by_role('button', name='Quick asks', exact=True).click()
    await pg.wait_for_selector('.menu-pop')
    asks = await pg.evaluate("""() => [...document.querySelectorAll('.menu-pop button')].map(b => ({
      label: (b.querySelector('.mlabel') || b).textContent.trim(), hint: (b.querySelector('.mhint') || {}).textContent || '' }))""")
    mapping = [a for a in asks if a['label'] == 'Map the chapters to the end']
    check('Quick asks offers “Map the chapters to the end”, with its hint', mapping and mapping[0]['hint'].strip(), asks)
    await pg.keyboard.press('Escape')

    check('the story map raises no browser errors', not [l for l in logs if l.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            executable = os.environ.get('COZY_TEST_CHROMIUM')
            browser = await p.chromium.launch(**({'executable_path': executable} if executable else {}))
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('the story map walk ran to the end', False, traceback.format_exc()[-600:])
            await browser.close()
    failed = [r for r in RESULTS if not r[1]]
    print(f'\nstory map: {len(RESULTS) - len(failed)} passed, {len(failed)} failed', flush=True)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
