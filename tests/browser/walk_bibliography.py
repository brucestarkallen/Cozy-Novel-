"""The bibliography on the screen (2.12): names in the page that open their
card (Tap names) — his entry, what the book has told of the name with the
passage that says it, the notes' card — never selecting the passage under
the finger; Notes → Bibliography by kind, its switches and its filter; his
own entry written and kept; Continue on the button while the box is empty.

Real browser and server, a temporary library; no connection is chosen, so no
model is asked anything. No paid calls. The default ports are its own;
environment overrides work.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '21961'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '21979'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:500]}]'), flush=True)


async def close_sheet(pg):
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_function("!document.querySelector('.sheet.on')")


async def card_text(pg):
    await pg.wait_for_selector('.sheet.on .namecard')
    await pg.wait_for_timeout(250)
    return await pg.locator('.sheet.on .box').inner_text()


async def open_bib(pg):
    await pg.click('#notesBtn')
    await pg.wait_for_selector('[data-notes-view=bibliography]')
    await pg.click('[data-notes-view=bibliography]')
    await pg.wait_for_selector('.bibview')
    await pg.wait_for_timeout(300)


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs)
    await H.new_book(pg, 'Soul Gate', 'A reaper story.')
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    fx = await pg.evaluate("""async nid => {
      const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const B = await import('/js/novel/bibliography.js');
      const n = s.peek('novel', nid), cid = n.order[0];
      s.change('chapter', cid, c => {
        c.passages = [sh.newPassage('ai', 'Rukia Kuchiki stood at the gate of the 13th Division. Her eyes were a deep violet, and she carried a white sword named Sode no Shirayuki. Byakuya watched from the wall. She will not bow.'),
          sh.newPassage('ai', 'Rukia raised Sode no Shirayuki. The Gotei 13 would hear of this, and so would Byakuya.')];
        const v = sh.picked(c.passages[0]);
        v.codex = B.codexOf([{ name: 'Rukia Kuchiki', kind: 'people', fact: 'Her eyes are violet.', evidence: 'Her eyes were a deep violet' },
          { name: 'Sode no Shirayuki', kind: 'things', fact: 'Rukia carries this white sword.', evidence: 'she carried a white sword named Sode no Shirayuki' }], { text: v.text });
      });
      s.change('novel', nid, sh.novelSteps.putNote('people', sh.newCard('people', { name: 'Byakuya Kuchiki', aka: ['Byakuya'], about: 'Captain of the 6th Division, Rukia’s adoptive brother.', now: 'On the wall above the gate.' })));
      s.change('novel', nid, sh.novelSteps.putEntry(B.tidyEntry(B.newEntry({ name: 'Gotei 13', kind: 'groups', line: 'The thirteen court guard squads.', text: 'Each division has a captain and a lieutenant.', by: 'you' }))));
      await s.flush();
      const c = s.peek('chapter', cid);
      return { cid, p1: c.passages[0].id, p2: c.passages[1].id };
    }""", nid)
    await pg.wait_for_timeout(700)

    marked = await pg.locator('.prose .nm').all_inner_texts()
    check('the names the book gives meaning to are marked in the page — an entry, a name the book tells facts of, a card of the notes, a name of a card alone',
          marked == ['Rukia Kuchiki', 'Sode no Shirayuki', 'Byakuya', 'Rukia', 'Sode no Shirayuki', 'Gotei 13', 'Byakuya'], marked)
    check('an ordinary word is never a name ("will" of "She will not bow")', 'will' not in [m.lower() for m in marked], marked)
    selected_before = await pg.evaluate("document.querySelector('.passage.selected')?.dataset.id || null")

    await pg.locator('.passage[data-id="%s"] .prose .nm' % fx['p1'], has_text='Rukia Kuchiki').first.click()
    t = await card_text(pg)
    check('a tap opens the name’s card: what the book has told of it, with the passage that says it', 'What the book has told' in t and 'Her eyes are violet.' in t and 'Chapter One, passage 1' in t, t)
    selected_after = await pg.evaluate("document.querySelector('.passage.selected')?.dataset.id || null")
    check('the tap never selects the passage under the finger', selected_after == selected_before and selected_before == fx['p2'], [selected_before, selected_after])
    await pg.screenshot(path=os.path.join(H.SHOTS, 'bib-card-phone.png'))
    over = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
    check('the card fits a phone', over <= 1, over)
    await pg.locator('.sheet.on .namecard-facts button.link').first.click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.wait_for_timeout(500)
    found = await pg.evaluate("[...document.querySelectorAll('.passage.found')].map(p => p.dataset.id)")
    check('a fact’s passage, tapped, is shown with its words lit', found == [fx['p1']], found)

    await pg.locator('.prose .nm', has_text='Byakuya').first.click()
    t = await card_text(pg)
    check('a card of the notes: who they are, where they stand now', 'In the notes' in t and 'Captain of the 6th Division' in t and 'On the wall above the gate.' in t, t)
    check('…with Open the card and Every place', await pg.locator('.sheet.on button', has_text='Open the card').count() == 1 and await pg.locator('.sheet.on button', has_text='Every place').count() == 1)
    await pg.locator('.sheet.on button', has_text='Every place').click()
    await pg.wait_for_selector('.sheet.on .searchtop input')
    await pg.wait_for_timeout(600)
    q = await pg.locator('.sheet.on .searchtop input').input_value()
    hits = await pg.locator('.sheet.on .hit').count()
    # (it once took the card's full name: "Byakuya Kuchiki" never finds the bare "Byakuya" he tapped)
    check('Every place opens Search on the name as he tapped it', q == 'Byakuya', q)
    await close_sheet(pg)

    # his own entry, written from the card
    await pg.locator('.prose .nm', has_text='Sode no Shirayuki').first.click()
    await card_text(pg)
    await pg.locator('.sheet.on button', has_text='Write your entry').click()
    await pg.wait_for_selector('.sheet.on textarea')
    name_now = await pg.locator('.sheet.on input[type=text] >> nth=0').input_value()
    check('Write your entry opens with the name filled in', name_now == 'Sode no Shirayuki', name_now)
    await pg.locator('.sheet.on input[placeholder="Who or what it is, in a line"]').fill('Rukia’s zanpakutō, the most beautiful ice-type in Soul Society.')
    await pg.locator('.sheet.on textarea').fill('Its first dance is Tsukishiro.')
    await pg.locator('.sheet.on button', has_text='Save').click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    saved = await pg.evaluate("""async nid => { const s = await import('/js/store.js'); const B = await import('/js/novel/bibliography.js'); await s.flush();
      return B.entriesOf(s.peek('novel', nid)).map(e => [e.name, e.kind, e.line, e.text, e.by]); }""", nid)
    check('his entry is kept, his', ['Sode no Shirayuki', 'things', 'Rukia’s zanpakutō, the most beautiful ice-type in Soul Society.', 'Its first dance is Tsukishiro.', 'you'] in saved, saved)
    await pg.locator('.prose .nm', has_text='Sode no Shirayuki').first.click()
    t = await card_text(pg)
    check('the card shows his words beside what the book has told', 'Its first dance is Tsukishiro.' in t and 'Rukia carries this white sword.' in t and 'Your entry' in t, t)
    await close_sheet(pg)

    # Notes → Bibliography
    await open_bib(pg)
    v = await pg.locator('.bibview').inner_text()
    check('Notes → Bibliography lists every name by kind', all(x in v for x in ['People', 'Things', 'Groups', 'Rukia Kuchiki', 'Sode no Shirayuki', 'Gotei 13']), v)
    yours = await pg.locator('.bibview .bibitem[data-ref^="e:"] .ctag.yours').count()
    check('his own entries are marked yours', yours == 2, yours)
    count = await pg.locator('.pane-intro .pane-count').inner_text()
    check('the notebook says how many names it holds', count == '3 names', count)
    over = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
    check('the view fits a phone', over <= 1, over)
    await pg.screenshot(path=os.path.join(H.SHOTS, 'bib-view-phone.png'))
    # Tap names off: nothing marked; on again: marked
    await pg.locator('.bibview label.toggle', has_text='Tap names in the page').locator('input').click()
    await pg.wait_for_timeout(400)
    n_off = await pg.locator('.prose .nm').count()
    check('Tap names off: nothing in the page is marked', n_off == 0, n_off)
    await pg.locator('.bibview label.toggle', has_text='Tap names in the page').locator('input').click()
    await pg.wait_for_timeout(400)
    n_on = await pg.locator('.prose .nm').count()
    check('on again: the names are marked again', n_on == 7, n_on)
    # Fill from the book off: the helper adds nothing more — what it found stays with its passages (a portrait made
    # short leaves its lasting details to them: hidden by the switch, they would be gone from his view and the writer's)
    await pg.locator('.bibview label.toggle', has_text='Fill it from the book by itself').locator('input').click()
    await pg.wait_for_timeout(400)
    v = await pg.locator('.bibview').inner_text()
    check('filled by hand only: the helper adds nothing more, and what it found stays beside his entries', 'Rukia Kuchiki' in v and 'Gotei 13' in v and 'Sode no Shirayuki' in v and 'The helper adds nothing to it just now' in v, v)
    await pg.locator('.bibview label.toggle', has_text='Fill it from the book by itself').locator('input').click()
    await pg.wait_for_timeout(300)
    # Smart recall (2.12.27): on by itself, said in the card; off for the book is kept on the phone, and said so
    on_at_first = await pg.locator('.bibview label.toggle', has_text='Smart recall').locator('input').is_checked()
    said_on = await pg.locator('.bibview .bibintro').inner_text()
    await pg.locator('.bibview label.toggle', has_text='Smart recall').locator('input').click()
    await pg.wait_for_timeout(400)
    said_off = await pg.locator('.bibview .bibintro').inner_text()
    kept_off = await pg.evaluate("nid => fetch('/api/store/novel/' + nid).then((r) => r.json()).then((x) => (x.data.prefs || {}).bibRecall || '')", nid)
    await pg.locator('.bibview label.toggle', has_text='Smart recall').locator('input').click()
    await pg.wait_for_timeout(400)
    kept_on = await pg.evaluate("nid => fetch('/api/store/novel/' + nid).then((r) => r.json()).then((x) => (x.data.prefs || {}).bibRecall || '')", nid)
    check('Smart recall is on by itself and says what it does; off for the book is kept on the phone, and the card says names only', on_at_first and 'with Smart recall, those the page needs though nothing there names them' in said_on and 'with Smart recall' not in said_off and kept_off == 'off' and kept_on == '', (on_at_first, said_off[-160:], kept_off, kept_on))
    async with pg.expect_download() as dl:
        await pg.locator('.bibview button', has_text='Take it out as a lorebook').click()
    d = await dl.value
    check('his entries go out as a lorebook file', d.suggested_filename.endswith('-bibliography.json'), d.suggested_filename)
    await pg.click('#sideClose')
    await pg.wait_for_timeout(300)

    # Continue
    label = (await pg.locator('#writeBtn').inner_text()).strip()
    check('the box empty, the button says Continue', label == 'Continue', label)
    await pg.locator('#direction').fill('They fight.')
    label = (await pg.locator('#writeBtn').inner_text()).strip()
    check('his premise in the box, it says Write', label == 'Write', label)
    await pg.locator('#direction').fill('')
    label = (await pg.locator('#writeBtn').inner_text()).strip()
    check('emptied again, Continue', label == 'Continue', label)

    # what a review of 2.12 found
    # words he selected stay selected while the names the page marks change (a card the helper just made)
    picked_words = await pg.evaluate("""pid => {
      const prose = document.querySelector(`.passage[data-id="${pid}"] .prose`);
      const w = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const i = t.data.indexOf('raised');
        if (i >= 0) { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 'raised'.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); }
      }
      return '';
    }""", fx['p2'])
    await pg.wait_for_function("document.querySelector('#writeBtn').innerText.trim() === 'Rewrite'")
    await pg.evaluate("""async nid => {
      const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js');
      s.change('novel', nid, sh.novelSteps.putNote('people', sh.newCard('people', { name: 'Ichigo Kurosaki', about: 'A substitute.' })));
      await s.flush();
    }""", nid)
    await pg.wait_for_timeout(700)
    still = await pg.evaluate("[getSelection().toString(), document.querySelector('#writeBtn').innerText.trim()]")
    check('his selected words stay selected while the page marks a new name — Rewrite stays Rewrite', picked_words == 'raised' and still == ['raised', 'Rewrite'], [picked_words, still])
    await pg.evaluate("(() => { const s = getSelection(); if (s.rangeCount) s.collapseToStart(); })()")
    await pg.wait_for_timeout(300)
    check('a tap lets the selection go: Continue again', (await pg.locator('#writeBtn').inner_text()).strip() == 'Continue')

    # the helper reads a passage again over the same words and finds another name in it: marked
    await pg.evaluate("""async ({ nid, cid }) => {
      const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const B = await import('/js/novel/bibliography.js');
      s.change('chapter', cid, c => { const v = sh.picked(c.passages[0]);
        v.codex = B.codexOf([{ name: 'Rukia Kuchiki', kind: 'people', fact: 'Her eyes are violet.', evidence: 'Her eyes were a deep violet' },
          { name: 'Sode no Shirayuki', kind: 'things', fact: 'Rukia carries this white sword.', evidence: 'she carried a white sword named Sode no Shirayuki' },
          { name: '13th Division', kind: 'groups', fact: 'Its gate is where Rukia stood.', evidence: 'stood at the gate of the 13th Division' }], { text: v.text }); });
      await s.flush();
    }""", {'nid': nid, 'cid': fx['cid']})
    await pg.wait_for_timeout(700)
    marked = await pg.locator('.passage[data-id="%s"] .prose .nm' % fx['p1']).all_inner_texts()
    check('a name the helper finds on reading a passage again over the same words is marked at once', '13th Division' in marked, marked)

    # a name in a scene's telling is marked as in the page
    deco = await pg.evaluate("""() => {
      const turn = document.createElement('div'); turn.className = 'turn ai prose-turn';
      turn.innerHTML = '<div class="words tprose"><p><span class="nm" data-name="Rukia">Rukia</span> ran.</p></div>';
      document.body.append(turn);
      const st = getComputedStyle(turn.querySelector('.nm'));
      const out = [st.textDecorationStyle, st.cursor];
      turn.remove();
      return out;
    }""")
    check('a name in a scene’s telling is marked as one in the page — dotted, and a hand to tap it', deco == ['dotted', 'pointer'], deco)

    # a third review: what the page does with what it is given
    # a double click on a name selects the word, as anywhere, and opens nothing
    await pg.locator('.passage[data-id="%s"] .prose .nm' % fx['p2'], has_text='Byakuya').first.dblclick()
    await pg.wait_for_timeout(600)
    dbl = await pg.evaluate("[getSelection().toString().trim(), Boolean(document.querySelector('.sheet.on'))]")
    check('a double click on a marked name selects the word and opens nothing', dbl == ['Byakuya', False], dbl)
    await pg.evaluate("(() => { const s = getSelection(); if (s.rangeCount) s.collapseToStart(); })()")
    await pg.wait_for_timeout(300)

    # the premise kept from before comes back in the box: the button says Write, not Continue
    await pg.evaluate("""async nid => { const s = await import('/js/store.js');
      if (!s.peek('draft', nid)) await s.create('draft', nid, { id: nid, novelId: nid, direction: 'They fight on the bridge.' });
      else s.change('draft', nid, (d) => { d.direction = 'They fight on the bridge.'; }, { now: true });
      await s.flush(); }""", nid)
    await H.settled_reload(pg)
    await pg.wait_for_selector('#writeBtn')
    await pg.wait_for_function("document.querySelector('#direction').value === 'They fight on the bridge.'")
    await pg.wait_for_timeout(300)
    check('his premise kept from before, back in the box: the button says Write', (await pg.locator('#writeBtn').inner_text()).strip() == 'Write')
    await pg.locator('#direction').fill('')
    # Write from here on the last passage, the box empty: what goes is a Continue, and the button says so
    await pg.locator('.passage[data-id="%s"]' % fx['p2']).click(position={'x': 3, 'y': 3})
    await pg.wait_for_selector('.passage.selected .pctl')
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Write from here")')
    await pg.wait_for_timeout(300)
    check('Write from here on the last passage, the box empty: Continue', (await pg.locator('#writeBtn').inner_text()).strip() == 'Continue', await pg.locator('#writeBtn').inner_text())
    await pg.click('#selClear')
    await pg.wait_for_timeout(200)

    # his words for an entry taken out meanwhile wait for Add an entry
    await open_bib(pg)
    await pg.locator('.bibview .bibitem', has_text='Gotei 13').first.click()
    await card_text(pg)
    await pg.locator('.sheet.on button', has_text='Edit your entry').click()
    await pg.wait_for_selector('.sheet.on input[placeholder="Who or what it is, in a line"]')
    await pg.locator('.sheet.on input[placeholder="Who or what it is, in a line"]').fill('THE COURT GUARD, IN HIS WORDS.')
    await pg.evaluate("""async nid => { const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const B = await import('/js/novel/bibliography.js');
      const e = B.entriesOf(s.peek('novel', nid)).find((x) => x.name === 'Gotei 13'); s.change('novel', nid, sh.novelSteps.dropEntry(e.id)); await s.flush(); }""", nid)
    await pg.locator('.sheet.on button', has_text='Save').click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.wait_for_timeout(300)
    await pg.locator('.bibview button', has_text='Add an entry').click()
    await pg.wait_for_selector('.sheet.on input[placeholder="Who or what it is, in a line"]')
    back = [await pg.locator('.sheet.on input[type=text] >> nth=0').input_value(), await pg.locator('.sheet.on input[placeholder="Who or what it is, in a line"]').input_value()]
    check('his words for an entry taken out meanwhile come back in Add an entry', back == ['Gotei 13', 'THE COURT GUARD, IN HIS WORDS.'], back)
    await pg.locator('.sheet.on button', has_text='Save').click()
    await pg.wait_for_function("!document.querySelector('.sheet.on')")
    await pg.wait_for_timeout(300)

    # a lorebook of thousands comes in at once; an entry whose other name another has comes in without that one
    import json, tempfile
    rows = {str(i): {'uid': i, 'key': [f'Lore{i} Zeta'], 'content': f'Entry {i} of a long lorebook.'} for i in range(3000)}
    rows['3000'] = {'uid': 3000, 'key': ['Hyorinmaru'], 'content': 'An ice dragon.'}
    rows['3001'] = {'uid': 3001, 'key': ['Toshiro Hitsugaya', 'Hyorinmaru'], 'content': 'A captain of ice.'}
    fd, path = tempfile.mkstemp(suffix='.json')
    with os.fdopen(fd, 'w') as f:
        json.dump({'entries': rows}, f)
    async with pg.expect_file_chooser() as fc:
        await pg.locator('.bibview button', has_text='Bring in a lorebook').click()
    await (await fc.value).set_files(path)
    await pg.wait_for_selector('.sheet.on button:has-text("Bring them in")')
    t0 = await pg.evaluate('performance.now()')
    await pg.click('.sheet.on button:has-text("Bring them in")')
    await pg.wait_for_function("!document.querySelector('.sheet.on')", timeout=60000)
    took = await pg.evaluate('performance.now()') - t0
    got = await pg.evaluate("""async nid => { const s = await import('/js/store.js'); const B = await import('/js/novel/bibliography.js'); await s.flush();
      const es = B.entriesOf(s.peek('novel', nid)); const h = es.find((e) => e.name === 'Toshiro Hitsugaya');
      return [es.filter((e) => /^Lore\d+ Zeta$/.test(e.name)).length, Boolean(es.find((e) => e.name === 'Hyorinmaru')), h ? h.aka : null]; }""", nid)
    check('a lorebook of 3,000 entries comes in at once (%d ms) — and one whose other name another has comes in without that one' % took, took < 5000 and got == [3000, True, []], [took, got])
    os.unlink(path)

    # drawn again while he types in its filter: the box keeps his words and his place in them
    await pg.wait_for_selector('.bibview .bibfilter')
    await pg.locator('.bibview .bibfilter').click()
    await pg.keyboard.type('Hyo')
    await pg.wait_for_timeout(300)
    await pg.evaluate("""async nid => { const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js');
      s.change('novel', nid, sh.novelSteps.putNote('places', sh.newCard('places', { name: 'Seireitei', about: 'The court.' }))); await s.flush(); }""", nid)
    await pg.wait_for_timeout(800)
    kept = await pg.evaluate("(() => { const b = document.querySelector('.bibview .bibfilter'); return [b && b.value, document.activeElement === b]; })()")
    await pg.keyboard.type('rin')
    await pg.wait_for_timeout(300)
    typed = await pg.locator('.bibview .bibfilter').input_value()
    check('the list drawn again while he types in its filter: his words and the keyboard stay', kept == ['Hyo', True] and typed == 'Hyorin', [kept, typed])

    # facts kept in a shape this page did not make never stop it drawing
    await pg.evaluate("""async ({ cid }) => { const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const u = await import('/js/util.js');
      s.change('chapter', cid, c => { const v = sh.picked(c.passages[1]); v.codex = { schema: 1, fp: u.hashText(v.text), facts: null }; });
      s.change('chapter', cid, c => { const v = sh.picked(c.passages[1]); v.codex = { schema: 1, fp: u.hashText(v.text), facts: [null, { name: 'Rukia' }] }; });
      await s.flush(); }""", {'cid': fx['cid']})
    await pg.wait_for_timeout(600)
    check('facts in a shape it did not make: the page still draws, its names still marked', await pg.locator('.prose .nm').count() >= 7 and not [x for x in logs if x.startswith('PAGEERROR')], [x for x in logs if x.startswith('PAGEERROR')])

    check('no page errors', not [x for x in logs if x.startswith('PAGEERROR')], [x for x in logs if x.startswith('PAGEERROR')])
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None))
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('the walk ran to its end', False)
            await browser.close()
    passed = sum(1 for r in RESULTS if r[1])
    failed = len(RESULTS) - passed
    print(f'bibliography: {passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
