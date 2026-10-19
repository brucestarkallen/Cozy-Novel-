"""Quick add, and the notes, the Timeline and the bibliography as one (2.12.37). Notes → Bibliography → Quick add: his
words checked by the partner's connection (the stand-in model) — what goes in shows with Undo these, the page that says
otherwise with where it stands and a tap that goes there, his words kept in the box across a redraw; the entry written
up in the partner's words, never his sentence pasted; what he types while it asks kept when it fails, and on Ask again;
his entry and the notes' card for one name open as one card, with On the Timeline; a card's own sheet leads to its name
in the bibliography and its turns on the Timeline. Real browser and server, a temporary library, the stand-in model only.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '25961'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '25979'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:600]}]'), flush=True)


async def open_bib(pg):
    # (on a wide screen Notes beside the page is a column: pressed again it closes — opened only when it is not open; and
    # once more where the column a reload brings back was still being drawn when it was looked for)
    for _ in range(3):
        if await pg.locator('[data-notes-view=bibliography]').is_visible():
            break
        await H.panes_call(pg, 'showSide', ['notes'])
        await pg.wait_for_timeout(500)
    await pg.wait_for_selector('[data-notes-view=bibliography]')
    await pg.click('[data-notes-view=bibliography]')
    await pg.wait_for_selector('.bibview .quickbox')
    await pg.wait_for_timeout(250)


async def ask(pg, words):
    # his words sent with Check and add, and the row they make waited for until it is answered
    await pg.locator('.bibview .quickbox').fill(words)
    await pg.get_by_role('button', name='Check and add').click()
    for _ in range(300):
        last = pg.locator('.bibview .quickrow').last
        if await last.count() and (await last.locator('.quick-mine').inner_text()).strip() == words and not await last.locator('.quick-wait').count():
            break
        await pg.wait_for_timeout(100)
    await pg.wait_for_timeout(300)


QUIET_NOW = "import('/js/app.js').then((m) => m.quietNow())"


async def scenario(browser, w, hgt, mobile):
    tag = f'{w}×{hgt}'
    logs = []
    pg = await H.page(browser, logs, w=w, hgt=hgt, mobile=mobile)
    await H.new_book(pg, f'Quick {tag}', 'A hunter, and the vampire who turned him.')
    await H.add_conn(pg)
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    fx = await pg.evaluate("""async nid => {
      const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const B = await import('/js/novel/bibliography.js');
      const n = s.peek('novel', nid), cid = n.order[0];
      const text = 'Emilia Vermaine had silver hair. She bit Jovan Wessex, and he did not die.';
      s.change('chapter', cid, (c) => { c.passages = [sh.newPassage('ai', text)]; });
      const u = await import('/js/util.js');
      s.change('chapter', cid, (c) => { const v = sh.picked(c.passages[0]); v.continuity = { schema: 1, fp: u.hashText(v.text), complete: true,
        events: [{ id: 'tl-1', kind: 'relationship', refs: [{ id: 'pe-e', kind: 'people', name: 'Emilia Vermaine' }, { id: 'pe-j', kind: 'people', name: 'Jovan Wessex' }], text: 'Emilia turns Jovan.', evidence: ['She bit Jovan Wessex'], stance: 'fact' }] }; });
      s.change('novel', nid, (x) => {
        x.notes.people.push({ id: 'pe-e', name: 'Emilia Vermaine', aka: [], about: 'An elder vampire.', updated: { chapterId: cid, at: 1 } });
        x.notes.people.push({ id: 'pe-j', name: 'Jovan Wessex', aka: [], about: 'A hunter.', updated: { chapterId: cid, at: 1 } });
      });
      s.change('novel', nid, sh.novelSteps.putEntry(B.tidyEntry(B.newEntry({ name: 'Emilia Vermaine', kind: 'people', line: 'The youngest elder.', text: 'She has no family of her own yet.', by: 'you' }))));
      await s.flush();
      return { cid, pid: s.peek('chapter', cid).passages[0].id };
    }""", nid)
    await pg.wait_for_timeout(500)
    await open_bib(pg)

    # his words, kept in the box across a redraw of the bibliography: a card of the notes laid in as he types, as the
    # helper lays one — what the bibliography is drawn from (2.12.40, the audit: the walk changed a field the view never
    # reads, so nothing was drawn again and the check could not fail)
    box = pg.locator('.bibview .quickbox')
    words = 'Emilia has black hair. The Sanguelis is the council of the elder houses.'
    await box.fill(words)
    await pg.evaluate("() => { document.querySelector('.bibview .quickbox').dataset.before = '1'; }")
    await pg.evaluate("(nid) => import('/js/store.js').then((s) => s.change('novel', nid, (x) => { x.notes.lore.push({ id: 'lo-r', name: 'Red Mile', aka: [], about: 'A street of lanterns.' }); }, { now: true }))", nid)
    redrawn = False
    for _ in range(40):
        if await pg.evaluate("() => { const b = document.querySelector('.bibview .quickbox'); return Boolean(b && !b.dataset.before); }"):
            redrawn = True
            break
        await pg.wait_for_timeout(100)
    check(f'{tag} the bibliography is drawn again when a card of the notes is laid in', redrawn)
    check(f'{tag} his words stay in the box while the bibliography is drawn again', await box.input_value() == words, await box.input_value())

    await pg.get_by_role('button', name='Check and add').click()
    await pg.wait_for_selector('.bibview .quickrow .quick-verdict', timeout=30000)
    await pg.wait_for_timeout(400)
    row = await pg.locator('.bibview .quickrow').last.inner_text()
    check(f'{tag} what went in: Sanguelis, into the bibliography', 'Into the bibliography' in row and 'Sanguelis' in row, row)
    check(f'{tag} the page that says otherwise, with where it stands, waiting for his word',
          'The book says otherwise — waiting for your word' in row and 'Chapter One, Passage 1' in row and 'Emilia Vermaine had silver hair' in row, row)
    check(f'{tag} the box is empty for his answer', await pg.locator('.bibview .quickbox').input_value() == '')
    listed = await pg.locator('.bibview .biblist .bibitem .nm').all_inner_texts()
    check(f'{tag} Sanguelis is in the bibliography, his', any(t.startswith('Sanguelis') and 'yours' in t.lower() for t in listed), listed)

    # the entry is its partner's writing up of his meaning, never his sentence pasted (2.12.39 — the stand-in writes it
    # up in words of its own since 2.12.40, so a pasted entry shows here)
    await pg.locator('.bibview .quickrow').last.get_by_role('button', name='Sanguelis').click()
    await pg.wait_for_selector('.sheet.on .namecard-text')
    told = (await pg.locator('.sheet.on .namecard-text').inner_text()).strip()
    mine = 'The Sanguelis is the council of the elder houses.'
    check(f'{tag} the entry is written up, never his sentence pasted', told == 'Sanguelis: the council of the elder houses.' and mine not in told, told)
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_function("!document.querySelector('.sheet.on')")

    # Undo these
    await pg.get_by_role('button', name='Undo these').click()
    await pg.wait_for_timeout(500)
    listed = await pg.locator('.bibview .biblist .bibitem .nm').all_inner_texts()
    row = await pg.locator('.bibview .quickrow').last.inner_text()
    check(f'{tag} Undo these takes it back out', not any(t.startswith('Sanguelis') for t in listed) and 'taken back out' in row, [listed, row])

    # his entry and the notes' card for one name: one card, with its Timeline
    await pg.locator('.bibview .bibitem', has_text='Emilia Vermaine').first.click()
    await pg.wait_for_selector('.sheet.on .namecard')
    sections = await pg.locator('.sheet.on .namecard').count()
    sheet = await pg.locator('.sheet.on .box').inner_text()
    check(f'{tag} his entry and the notes’ card open as one', sections == 1 and 'She has no family of her own yet.' in sheet and 'In the notes' in sheet and 'An elder vampire.' in sheet, [sections, sheet])
    await pg.locator('.sheet.on').get_by_role('button', name='On the Timeline').click()
    await pg.wait_for_selector('.timeline-event', timeout=8000)
    await pg.wait_for_timeout(300)
    follow = await pg.evaluate("document.querySelector('select[aria-label=\"Person or thread\"]').value")
    events = await pg.locator('.timeline-event .timeline-turn').all_inner_texts()
    check(f'{tag} On the Timeline: her turns, the whole book through', follow == 'pe-e' and events == ['Emilia turns Jovan.'], [follow, events])

    # a card's own sheet leads to its name in the bibliography and its turns
    await pg.evaluate("() => import('/js/ui/panes.js').then((p) => p.showCard('people', 'pe-j'))")
    await pg.wait_for_selector('.sheet.on .cardlinks')
    links = await pg.locator('.sheet.on .cardlinks button').all_inner_texts()
    check(f'{tag} a card with nothing in the bibliography offers its Timeline only', links == ['On the Timeline'], links)
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.evaluate("() => import('/js/ui/panes.js').then((p) => p.showCard('people', 'pe-e'))")
    await pg.wait_for_selector('.sheet.on .cardlinks')
    links = await pg.locator('.sheet.on .cardlinks button').all_inner_texts()
    check(f'{tag} her card leads to the bibliography and the Timeline', links == ['In the bibliography', 'On the Timeline'], links)
    await pg.locator('.sheet.on .cardlinks').get_by_role('button', name='In the bibliography').click()
    await pg.wait_for_selector('.sheet.on .namecard')
    sheet = await pg.locator('.sheet.on .box').inner_text()
    check(f'{tag} In the bibliography opens her name’s card — his entry with the notes’ card', 'She has no family of her own yet.' in sheet and await pg.locator('.sheet.on .namecard').count() == 1, sheet)
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_function("!document.querySelector('.sheet.on')")

    # a tap on where the page says otherwise goes there
    await open_bib(pg)
    await pg.locator('.bibview .quick-sec.wait button.link').first.click()
    await pg.wait_for_timeout(700)
    lit = await pg.evaluate("(pid) => { const p = document.querySelector(`#passages .passage[data-id=\"${pid}\"]`); return Boolean(p && (p.classList.contains('selected') || p.querySelector('mark, .found'))); }", fx['pid'])
    check(f'{tag} the tap goes to the page that says otherwise', lit)

    # (2.12.40, the review) an entry resting on what a page says otherwise is held back, said under Not put in, and the row
    # has Ask again — his words back in the box, before anything typed there
    await open_bib(pg)
    await ask(pg, 'HELDBACK Emilia has black hair.')
    row = await pg.locator('.bibview .quickrow').last.inner_text()
    check(f'{tag} an entry resting on what a page says otherwise: held back under Not put in, saying why',
          'Not put in' in row and 'Emilia Vermaine — it says what Chapter One, Passage 1 says otherwise (“Emilia has black hair”)' in row and 'it waits for your word' in row, row)
    again = pg.locator('.bibview .quickrow').last.get_by_role('button', name='Ask again')
    check(f'{tag} a row that held something back has Ask again', await again.count() == 1, row)
    if await again.count():
        await again.click()
        await pg.wait_for_timeout(300)
        kept = await pg.locator('.bibview .quickbox').input_value()
        check(f'{tag} Ask again puts his words back in the box', kept == 'HELDBACK Emilia has black hair.', kept)
    await pg.locator('.bibview .quickbox').fill('')

    # a newer word of his that went into no entry says so, with Ask again
    await ask(pg, 'LONE Emilia has a brother.')
    row = await pg.locator('.bibview .quickrow').last.inner_text()
    check(f'{tag} a newer word that went in nowhere says it did not go in',
          'It changes your earlier words' in row and 'it did not go in: nothing it wrote carries it. Send your words again.' in row
          and await pg.locator('.bibview .quickrow').last.get_by_role('button', name='Ask again').count() == 1, row)

    # set aside: "yours went in" only where the entry put in says his words — never "not held back" unchecked
    await ask(pg, 'ASIDE Emilia Vermaine is an elder whose eyes are green.')
    row = await pg.locator('.bibview .quickrow').last.inner_text()
    check(f'{tag} set aside, with yours said to go in only where an entry put in says them',
          'Set aside' in row and 'so yours went into Emilia Vermaine.' in row and 'not held back' not in row, row)

    # what he types while it asks is kept: when the ask fails, his words come back before it, never in its place — and
    # Ask again the same (2.12.40, the audit)
    await open_bib(pg)
    await pg.locator('.bibview .quickbox').fill('SLOWFAIL The Hollow Gate is a ruin.')
    await pg.get_by_role('button', name='Check and add').click()
    await pg.wait_for_selector('.bibview .quickrow .quick-wait', timeout=8000)
    await pg.locator('.bibview .quickbox').fill('More words, typed while it asked.')
    await pg.wait_for_selector('.bibview .quickrow .notekey.bibdue', timeout=30000)
    await pg.wait_for_timeout(300)
    both = 'SLOWFAIL The Hollow Gate is a ruin.\n\nMore words, typed while it asked.'
    kept = await pg.locator('.bibview .quickbox').input_value()
    check(f'{tag} what he typed while it asked stays, his words given back before it', kept == both, kept)
    await pg.locator('.bibview .quickrow').last.get_by_role('button', name='Ask again').click()
    await pg.wait_for_timeout(300)
    kept = await pg.locator('.bibview .quickbox').input_value()
    check(f'{tag} Ask again never writes over what the box holds', kept == both, kept)

    # (2.12.40, the review) a Quick add being asked is work on its way: an update waits for it (app.js quietNow), and
    # leaving the page asks first; reloaded mid-ask, the row its closed tab was asking says at once that it stopped — its
    # tab's lock is gone (store.liveTabs), never "being checked in another window" for two minutes
    await pg.locator('.bibview .quickbox').fill('')
    await pg.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    # (quiet, and staying quiet a moment: nothing else on its way — a save, the helper — that would keep it from being so)
    quiet, still = False, 0
    for _ in range(400):
        still = still + 1 if await pg.evaluate(QUIET_NOW) else 0
        if still >= 15:
            quiet = True
            break
        await pg.wait_for_timeout(100)
    check(f'{tag} quiet before it asks', quiet)
    gate = 'SLOW The Gloam Gate is a ruin on the old north road, where the hunters of the Iron Covenant once kept their watch over the drowned city below.'
    await pg.locator('.bibview .quickbox').fill(gate)
    await pg.get_by_role('button', name='Check and add').click()
    await pg.wait_for_selector('.bibview .quickrow .quick-wait', timeout=8000)
    # (for three seconds of its asking — its own saves landed meanwhile — never quiet)
    loud = True
    for _ in range(30):
        if await pg.evaluate(QUIET_NOW):
            loud = False
            break
        await pg.wait_for_timeout(100)
    still_asking = await pg.locator('.bibview .quickrow .quick-wait').count() > 0
    check(f'{tag} while Quick add asks, no update lands', loud and still_asking, [loud, still_asking])
    asks_first = await pg.evaluate("() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }")
    check(f'{tag} leaving the page while it asks asks first', asks_first)
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
    await H.settled_reload(pg)
    await pg.wait_for_selector('#desk:not([hidden])', timeout=10000)
    await pg.wait_for_timeout(600)
    await open_bib(pg)
    seen = ''
    for _ in range(50):
        seen = await pg.locator('.bibview .quickrow', has_text='SLOW The Gloam Gate').last.inner_text()
        if 'its window closed before it answered' in seen:
            break
        await pg.wait_for_timeout(100)
    check(f'{tag} reloaded mid-ask, its row says at once that it stopped, with Ask again',
          'Not checked — its window closed before it answered. Nothing went in.' in seen and 'Being checked in another window' not in seen and 'Ask again' in seen, seen)
    kept = await pg.evaluate("(nid) => import('/js/store.js').then((s) => { const r = (s.peek('novel', nid).quick || []).find((x) => x.said.startsWith('SLOW The Gloam Gate')); return r ? [r.state, Boolean(r.closed), r.tab || ''] : null; })", nid)
    check(f'{tag} and it is kept as stopped, for every window', kept == ['stopped', True, ''], kept)
    errs = [x for x in logs if x.startswith('PAGEERROR')]
    check(f'{tag} no page errors', not errs, errs[:3])
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None), headless=True)
            try:
                for w, hgt, mobile in [(412, 915, True), (1280, 800, False)]:
                    await scenario(browser, w, hgt, mobile)
            except Exception:
                traceback.print_exc()
                RESULTS.append(False)
            await browser.close()
    print(f'quick add: {sum(RESULTS)} passed, {len(RESULTS) - sum(RESULTS)} failed')
    sys.exit(0 if all(RESULTS) else 1)


asyncio.run(main())
