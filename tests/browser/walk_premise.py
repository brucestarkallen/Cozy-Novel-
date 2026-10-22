"""His premise under a page — Edit, Resend, Another take — and a page from a premise that did not come: its card's
Retry and Edit premise (2.12.63). The real browser, the real server and the stand-in model; a synthetic book. Every
step is checked; a failed check says what it saw."""
import asyncio, json, os, re, sys, traceback
from harness import *

RESULTS = []
def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:500]}]'), flush=True)

ROW = '#passages .passage.selected .pctl'
LINE = ROW + ' .note.premise'
BOX = LINE + ' textarea.premiseedit'
CARD = '#pageEnd .endcard'

async def idle(pg, t=15000):
    await pg.wait_for_function("!document.querySelector('.passage.streaming') && document.querySelector('#writeBtn').textContent.trim() !== 'Stop'", timeout=t)

async def write(pg, direction, t=15000):
    await pg.fill('#direction', direction)
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(200)
    await idle(pg, t)

async def set_model(pg, model):
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections")')
    await pg.fill('.sheet label.field:has(> span:text-is("Model")) input', model)
    await pg.wait_for_timeout(700)
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_timeout(400)

async def texts(pg, sel):
    return await pg.evaluate("(s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim())", sel)

async def chapter(pg):
    """the chapter on show, as the phone keeps it: each passage's id, premise and versions"""
    return await pg.evaluate("""async () => {
      const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js');
      const n = s.peek('novel', location.hash.split('/')[2]);
      return s.peek('chapter', n.order[0]).passages.map((p) => ({ id: p.id, premise: sh.premiseOf(p), versions: p.versions.length }));
    }""")

def asks():
    """what each page the writer was asked for asked: its premise — '' for one the writer chose (Continue)"""
    out = []
    for x in reqs():
        msgs = x['body'].get('messages') or []
        last = next((m.get('content') for m in reversed(msgs) if m.get('role') == 'user' and isinstance(m.get('content'), str)), '')
        m = re.search(r'^What happens(?: next)?: (.+)$', last, re.M)
        if m: out.append(m.group(1).strip())
        elif 'What happens next is yours to choose' in last or 'How it opens is yours to choose' in last: out.append('')
    return out

async def select(pg, i):
    await pg.locator('#passages .passage').nth(i).locator('.prose').click()
    await pg.wait_for_timeout(250)

async def open_premise(pg):
    if not await pg.locator(LINE).is_visible():
        await pg.click(ROW + ' button.premisebtn'); await pg.wait_for_timeout(200)

async def card_buttons(pg):
    await pg.wait_for_selector(CARD, timeout=8000)
    return await texts(pg, CARD + ' button')

async def scenario(b):
    logs = []
    pg = await page(b, logs)
    reset()
    await new_book(pg)
    await add_conn(pg)
    P1 = 'She finds a bottle with a letter.'
    P2 = 'The storm takes the roof.'
    await write(pg, P1)
    await write(pg, P2)
    await select(pg, 0)

    # ---- one button, one meaning
    row = await texts(pg, ROW + ' > button')
    every = await texts(pg, ROW + ' button')
    check('under a written page: Another take, Rewrite…, one Edit, Premise — no Retry and no Resend', row.count('Edit') == 1 and 'Another take' in row and 'Rewrite…' in row and 'Premise' in row and 'Retry' not in every and 'Resend' not in every, every)
    await open_premise(pg)
    words = await pg.inner_text(LINE + ' .premisewords')
    line = await texts(pg, LINE + ' button')
    every = await texts(pg, ROW + ' button')
    check('Premise shows it with its own Edit, in its own line — no Resend or Retry while the box is closed', words == P1 and line == ['Edit'] and 'Resend' not in every and 'Retry' not in every, (words, line, every))
    await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    check('Edit opens the premise in its box, inside the premise’s own line, with Resend and Cancel', await pg.locator(BOX).count() == 1 and await pg.input_value(BOX) == P1 and await texts(pg, LINE + ' button') == ['Resend', 'Cancel'] and (await texts(pg, ROW + ' > button')).count('Edit') == 1, await texts(pg, ROW + ' button'))

    # ---- his unsent words stay until he sends them or lets them go
    UNSENT = 'MY UNSENT WORDS: she reads it twice.'
    await pg.fill(BOX, UNSENT)
    await pg.click(ROW + ' button.premisebtn'); await pg.wait_for_timeout(150)
    hidden = not await pg.locator(LINE).is_visible()
    await pg.click(ROW + ' button.premisebtn'); await pg.wait_for_timeout(150)
    check('Premise put away with the box open and opened again: the same box, his words in it', hidden and await pg.locator(BOX).count() == 1 and await pg.input_value(BOX) == UNSENT, (hidden, await pg.locator(BOX).count()))
    await select(pg, 1)
    await open_premise(pg)
    await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    other = await pg.input_value(BOX)
    await select(pg, 0)
    await open_premise(pg)
    shows = await pg.inner_text(LINE + ' .premisewords') if await pg.locator(LINE + ' .premisewords').count() else ''
    await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    check('another page’s box opened, then Edit here again: his unsent words, never the premise over them', other == P2 and shows == P1 and await pg.input_value(BOX) == UNSENT, (other, shows, await pg.input_value(BOX)))
    await select(pg, 1)
    await open_premise(pg)
    if not await pg.locator(BOX).count():
        await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    await pg.fill(BOX, 'WORDS HE LETS GO')
    await pg.click(LINE + ' button:text-is("Cancel")'); await pg.wait_for_timeout(200)
    gone = await pg.locator(BOX).count() == 0
    await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    check('Cancel lets the words in the box go: Edit then opens on the premise as it stands', gone and await pg.input_value(BOX) == P2, await pg.input_value(BOX))
    await pg.click(LINE + ' button:text-is("Cancel")'); await pg.wait_for_timeout(200)

    # ---- a Resend that did not come: his edited premise is back in its box, and the card says why
    await set_model(pg, 'fake-broken')
    await select(pg, 0)
    await open_premise(pg)
    if not await pg.locator(BOX).count():
        await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    EDITED = 'HIS EDITED PREMISE: she burns the letter instead.'
    await pg.fill(BOX, EDITED)
    await pg.click(LINE + ' .premacts button:text-is("Resend")')
    await pg.wait_for_timeout(500); await idle(pg)
    card = await card_buttons(pg)
    await select(pg, 0)
    rec = await chapter(pg)
    check('a Resend that did not come: his edited premise is back in its box under the page', await pg.locator(BOX).count() == 1 and await pg.input_value(BOX) == EDITED and rec[0]['versions'] == 1, (await pg.locator(BOX).count(), rec))
    check('its card: Edit premise and Retry — no Resend (that is the box’s own)', 'Edit premise' in card and 'Retry' in card and 'Resend' not in card, card)
    await pg.evaluate("document.querySelector('#pageWrap').scrollTop = document.querySelector('#pageWrap').scrollHeight")
    await select(pg, 1)
    await pg.click(CARD + ' button:text-is("Edit premise")'); await pg.wait_for_timeout(500)
    focused = await pg.evaluate("(() => { const a = document.activeElement; return a && a.matches('textarea.premiseedit') ? a.value : null; })()")
    seen = await pg.evaluate("(() => { const b = document.querySelector('textarea.premiseedit'); if (!b) return false; const w = document.querySelector('#pageWrap').getBoundingClientRect(); const r = b.getBoundingClientRect(); return r.top >= w.top && r.bottom <= w.bottom; })()")
    sel_first = await pg.evaluate("document.querySelector('#passages .passage.selected') === document.querySelectorAll('#passages .passage')[0]")
    check('the card’s Edit premise takes him to that page’s box, his edited words in it', focused == EDITED and seen and sel_first, (focused, seen, sel_first))
    await set_model(pg, 'fake-writer')
    reset()
    await pg.click(CARD + ' button:text-is("Retry")')
    await pg.wait_for_timeout(500); await idle(pg)
    rec = await chapter(pg)
    await select(pg, 0)
    check('Retry on the card: the page written again from his edited premise, a new version of that page; the box let go', asks() == [EDITED] and rec[0]['premise'] == EDITED and rec[0]['versions'] == 2 and len(rec) == 2 and await pg.locator(BOX).count() == 0 and not await pg.locator(CARD).count(), (asks(), rec, await pg.locator(BOX).count()))

    # ---- Another take after it: the premise on show
    reset()
    await pg.click(ROW + ' > button:text-is("Another take")')
    await pg.wait_for_timeout(500); await idle(pg)
    rec = await chapter(pg)
    check('Another take after it writes from the edited premise — the first one is never put back', asks() == [EDITED] and rec[0]['premise'] == EDITED and rec[0]['versions'] == 3, (asks(), rec))

    # ---- Resend from the box, that comes: the box goes, the premise is the page's
    await select(pg, 1)
    await open_premise(pg)
    await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    CALM = 'The storm passes before dawn.'
    await pg.fill(BOX, CALM)
    reset()
    await pg.click(LINE + ' .premacts button:text-is("Resend")')
    await pg.wait_for_timeout(500); await idle(pg)
    await select(pg, 1)
    rec = await chapter(pg)
    check('Resend from the box: the page again from its words, a new version; the box closes on its premise', asks() == [CALM] and rec[1]['premise'] == CALM and rec[1]['versions'] == 2 and await pg.locator(BOX).count() == 0 and await pg.inner_text(LINE + ' .premisewords') == CALM, (asks(), rec))

    # ---- a Write that did not come: Retry is that premise again, never what he typed since
    await set_model(pg, 'fake-broken')
    FIRST = 'FIRST IDEA: the keeper climbs the tower.'
    await write(pg, FIRST)
    card = await card_buttons(pg)
    check('a Write that did not come: its card offers Edit premise and Retry, not Resend; the box keeps its words', 'Edit premise' in card and 'Retry' in card and 'Resend' not in card and await pg.input_value('#direction') == FIRST, (card, await pg.input_value('#direction')))
    NEWER = 'MY NEWER IDEA, typed after the failure.'
    await pg.fill('#direction', NEWER)
    await set_model(pg, 'fake-writer')
    reset()
    before = len(await chapter(pg))
    await pg.click(CARD + ' button:text-is("Retry")')
    await pg.wait_for_timeout(500); await idle(pg)
    rec = await chapter(pg)
    check('Retry writes the premise that did not come, and his newer words stay in the box', asks() == [FIRST] and rec[-1]['premise'] == FIRST and len(rec) == before + 1 and await pg.input_value('#direction') == NEWER, (asks(), [x['premise'] for x in rec], await pg.input_value('#direction')))
    await set_model(pg, 'fake-broken')
    SECOND = 'SECOND IDEA: the lamp goes out.'
    await write(pg, SECOND)
    await card_buttons(pg)
    MINE = 'MINE SINCE: nothing of the lamp.'
    await pg.fill('#direction', MINE)
    await pg.click(CARD + ' button:text-is("Edit premise")'); await pg.wait_for_timeout(400)
    asked_first = await pg.locator('.sheet.on:has-text("The box has words in it")').count()
    if asked_first:
        await pg.click('.sheet.on button:text-is("Not now")'); await pg.wait_for_timeout(400)
    kept = await pg.input_value('#direction')
    await pg.click(CARD + ' button:text-is("Edit premise")'); await pg.wait_for_timeout(400)
    if await pg.locator('.sheet.on button:text-is("Put this after them")').count():
        await pg.click('.sheet.on button:text-is("Put this after them")'); await pg.wait_for_timeout(400)
    both = await pg.input_value('#direction')
    check('Edit premise never writes over what he typed since: he is asked first, Not now keeps his words, and it can go after them', asked_first == 1 and kept == MINE and both == MINE + '\n\n' + SECOND, (asked_first, kept, both))
    await pg.click(CARD + ' button:text-is("Dismiss")'); await pg.wait_for_timeout(200)

    # ---- Continue that did not come: there was no premise to edit
    await write(pg, '')
    card = await card_buttons(pg)
    title = await pg.get_attribute(CARD + ' button:text-is("Retry")', 'title') if 'Retry' in card else ''
    check('Continue that did not come: Retry, and no Edit premise for a premise there never was', 'Retry' in card and 'Edit premise' not in card and 'premise' not in (title or '').lower(), (card, title))
    LATER = 'WORDS FOR LATER.'
    await pg.fill('#direction', LATER)
    await set_model(pg, 'fake-writer')
    reset()
    await pg.click(CARD + ' button:text-is("Retry")')
    await pg.wait_for_timeout(500); await idle(pg)
    check('its Retry asks again for a page the writer chooses — his words typed since stay in the box', asks() == [''] and await pg.input_value('#direction') == LATER, (asks(), await pg.input_value('#direction')))
    await pg.fill('#direction', '')

    # ---- a Write from here that did not come keeps its place, for Retry and for Write
    await set_model(pg, 'fake-broken')
    await select(pg, 0)
    await pg.click(ROW + ' button[aria-label="More for this passage"]'); await pg.wait_for_timeout(250)
    await pg.click('.menu-pop button:has-text("Write from here")'); await pg.wait_for_timeout(250)
    BETWEEN = 'BETWEEN THE TWO: a gull at the window.'
    await write(pg, BETWEEN)
    await card_buttons(pg)
    bar = await pg.locator('#selBar').is_visible()
    what = await pg.inner_text('#selWhat') if bar else ''
    check('a Write from here that did not come keeps its place: the box still says where the page goes', bar and what.startswith('The next passage goes after'), (bar, what))
    await set_model(pg, 'fake-writer')
    ids = [x['id'] for x in await chapter(pg)]
    reset()
    await pg.click(CARD + ' button:text-is("Retry")')
    await pg.wait_for_timeout(500); await idle(pg)
    rec = await chapter(pg)
    check('Retry writes it at the place it was asked for — right after that passage, never at the chapter’s end', asks() == [BETWEEN] and rec[1]['premise'] == BETWEEN and rec[1]['id'] not in ids and [x['id'] for x in rec if x['id'] in ids] == ids and not await pg.locator('#selBar').is_visible(), ([x['premise'] for x in rec], asks()))
    await set_model(pg, 'fake-broken')
    await select(pg, 0)
    await pg.click(ROW + ' button[aria-label="More for this passage"]'); await pg.wait_for_timeout(250)
    await pg.click('.menu-pop button:has-text("Write from here")'); await pg.wait_for_timeout(250)
    BRIDGE = 'A BRIDGE: the keeper sleeps.'
    await write(pg, BRIDGE)
    await card_buttons(pg)
    await set_model(pg, 'fake-writer')
    ids = [x['id'] for x in await chapter(pg)]
    reset()
    await pg.click('#writeBtn'); await pg.wait_for_timeout(500); await idle(pg)
    rec = await chapter(pg)
    check('and Write after it writes there too', asks() == [BRIDGE] and rec[1]['premise'] == BRIDGE and [x['id'] for x in rec if x['id'] in ids] == ids, ([x['premise'] for x in rec], asks()))

    # ---- an update waits for words in a premise box he has neither sent nor let go (they live in this window only)
    QUIET = "import('/js/app.js').then((m) => m.quietNow())"
    await pg.wait_for_function(f"{QUIET}.then((q) => {{ window.__quiet = q; }}) && window.__quiet === true", timeout=30000)
    await select(pg, 0)
    await open_premise(pg)
    if not await pg.locator(BOX).count():
        await pg.click(LINE + ' button:text-is("Edit")'); await pg.wait_for_timeout(250)
    await pg.fill(BOX, 'WORDS NOT SENT YET.')
    await pg.click(ROW + ' button.premisebtn'); await pg.wait_for_timeout(200)
    held = await pg.evaluate(QUIET)
    await pg.click(ROW + ' button.premisebtn'); await pg.wait_for_timeout(200)
    await pg.click(LINE + ' button:text-is("Cancel")'); await pg.wait_for_timeout(200)
    after = False
    for _ in range(50):
        after = await pg.evaluate(QUIET)
        if after: break
        await pg.wait_for_timeout(200)
    check('an update waits while a premise box holds words he has not sent, put away or not — and lands once he lets them go', held is False and after is True, (held, after))
    check('no page errors', not [l for l in logs if 'PAGEERROR' in l], [l for l in logs if 'PAGEERROR' in l][:5])
    await pg.context.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        with Env():
            try:
                await scenario(b)
            except Exception:
                traceback.print_exc()
                check('the premise walk ran to the end', False, traceback.format_exc()[-800:])
        await b.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\npremise: {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    asyncio.run(main())
