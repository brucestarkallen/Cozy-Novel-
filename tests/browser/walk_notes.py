"""Note editing across refused saves and remote changes. No model connection."""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', 20581))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', 20599))
from harness import Env, async_playwright, new_book, page, reqs

RESULTS = []
def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f' [saw: {str(saw)[:400]}]'), flush=True)

async def scenario(browser):
    logs = []
    pg = await page(browser, logs, w=1280, hgt=900, mobile=False)
    try:
        await new_book(pg, 'Notes across windows')
        nid = (await pg.evaluate('location.hash')).split('/')[2]
        await pg.evaluate("""async nid => {
          const s = await import('/js/store.js');
          s.change('novel', nid, n => { n.notes.people = [{ id: 'mara', name: 'Mara', aka: [], about: 'The keeper.', now: 'At the gate.', ties: 'Trusts Tom.' }]; });
          await s.flush();
        }""", nid)
        if not await pg.locator('#sidePane').evaluate("el => el.classList.contains('dock') || el.classList.contains('open')"): await pg.click('#notesBtn')
        await pg.locator('#sideTabs button[data-tab="notes"]').click()
        section = pg.locator('#sidePane .notesec').filter(has=pg.locator('h3:text-is("People")'))
        if not await section.locator('.card').first.is_visible(): await section.locator('.sechead').click()

        async def edit_with_remote(remove=False):
            await section.locator('.card').first.click()
            await pg.locator('.sheet.on label.field').filter(has=pg.locator('span:text-is("Who they are")')).locator('textarea').fill('My exact correction.' if not remove else 'Words rescued after removal.')
            reached, release = asyncio.Event(), asyncio.Event()
            held = False
            statuses = []
            async def gate(route):
                nonlocal held
                if route.request.method == 'PUT' and not held:
                    held = True; reached.set(); await release.wait()
                await route.continue_()
            url = f'**/api/store/novel/{nid}'
            pg.on('response', lambda r: statuses.append(r.status) if r.url.endswith('/api/store/novel/' + nid) else None)
            await pg.route(url, gate)
            try:
                await pg.locator('.sheet.on button').filter(has_text='Save').click()
                await asyncio.wait_for(reached.wait(), 5)
                old = await (await pg.request.get(f'http://127.0.0.1:{harness.PORT}/api/store/novel/{nid}')).json()
                if remove: old['data']['notes']['people'] = []
                else:
                    old['data']['notes']['people'][0].update(now='At the harbor.', ties='Reconciled with Tom.', aka=['Lamp keeper'])
                res = await pg.request.put(f'http://127.0.0.1:{harness.PORT}/api/store/novel/{nid}', headers={'X-Base': str(old['rev']), 'X-Client': 'another-notes-window'}, data={'data': old['data']})
                assert res.status == 200
            finally: release.set()
            await pg.evaluate("async nid => { const s = await import('/js/store.js'); await s.flush('novel', nid); }", nid)
            await pg.unroute(url, gate)
            after = await (await pg.request.get(f'http://127.0.0.1:{harness.PORT}/api/store/novel/{nid}')).json()
            check('the test forces an actual refused save and replay', 409 in statuses, statuses)
            return after['data']

        after = await edit_with_remote()
        card = after['notes']['people'][0]
        check('only the edited box changes after a remote save', card['about'] == 'My exact correction.' and card['now'] == 'At the harbor.' and card['ties'] == 'Reconciled with Tom.' and card['aka'] == ['Lamp keeper'], card)
        check('the saved card marks only the fields written by hand', card.get('updated', {}).get('his') == ['about'], card)
        after = await edit_with_remote(remove=True)
        check('a removed card is not recreated by the delayed save', after['notes']['people'] == [], after['notes']['people'])
        await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('words are kept')", timeout=5000)
        await section.locator('button').filter(has_text='Add').click()
        about = pg.locator('.sheet.on label.field').filter(has=pg.locator('span:text-is("Who they are")')).locator('textarea')
        check('words from a save overtaken by removal are kept for a new card', await about.input_value() == 'Words rescued after removal.')
        await about.fill('My unsaved draft survives a reload.')
        await pg.evaluate("async () => { const s = await import('/js/store.js'); await s.flush(); }")
        await harness.settled_reload(pg)
        await pg.wait_for_selector('#desk:not([hidden])')
        await pg.wait_for_function("document.title === 'Notes across windows — Cozy Novel'")
        if not await pg.locator('#sidePane').evaluate("el => el.classList.contains('dock') || el.classList.contains('open')"): await pg.click('#notesBtn')
        await pg.locator('#sideTabs button[data-tab="notes"]').click()
        await section.locator('button.note-add').click()
        check('unsaved note words survive a reload while the editor was open', await about.input_value() == 'My unsaved draft survives a reload.')
        await pg.keyboard.press('Escape')
        await pg.evaluate("async () => { const s = await import('/js/store.js'); await s.flush(); }")
        await harness.settled_reload(pg)
        await pg.wait_for_selector('#desk:not([hidden])')
        await pg.wait_for_function("document.title === 'Notes across windows — Cozy Novel'")
        if not await pg.locator('#sidePane').evaluate("el => el.classList.contains('dock') || el.classList.contains('open')"): await pg.click('#notesBtn')
        await pg.locator('#sideTabs button[data-tab="notes"]').click()
        await section.locator('button.note-add').click()
        check('unsaved note words also survive Back followed by a reload', await about.input_value() == 'My unsaved draft survives a reload.')
        await pg.locator('.sheet.on label.field').filter(has=pg.locator('span:text-is("Name")')).locator('input').fill('Mara, kept safely')
        await pg.locator('.sheet.on button').filter(has_text='Save').click()
        await pg.wait_for_function("""async nid => {
          const s = await import('/js/store.js'); await s.flush();
          const d = (await (await fetch('/api/store/draft/' + nid)).json()).data;
          return !Object.keys(d.cards || {}).length;
        }""", arg=nid)
        saved = (await (await pg.request.get(f'http://127.0.0.1:{harness.PORT}/api/store/novel/{nid}')).json())['data']['notes']['people']
        check('Save keeps the new card and clears only its acknowledged draft', len(saved) == 1 and saved[0]['about'] == 'My unsaved draft survives a reload.', saved)
        await section.locator('.card').first.click()
        await about.fill('A closed draft whose card is removed stays recoverable.')
        await pg.keyboard.press('Escape')
        await pg.evaluate("async () => { const s = await import('/js/store.js'); await s.flush(); }")
        remote = await (await pg.request.get(f'http://127.0.0.1:{harness.PORT}/api/store/novel/{nid}')).json()
        remote['data']['notes']['people'] = []
        await pg.request.put(f'http://127.0.0.1:{harness.PORT}/api/store/novel/{nid}', headers={'X-Base': str(remote['rev']), 'X-Client': 'another-notes-window'}, data={'data': remote['data']})
        await harness.settled_reload(pg)
        await pg.wait_for_function("document.title === 'Notes across windows — Cozy Novel'")
        if not await pg.locator('#sidePane').evaluate("el => el.classList.contains('dock') || el.classList.contains('open')"): await pg.click('#notesBtn')
        await pg.locator('#sideTabs button[data-tab="notes"]').click()
        await section.locator('button.note-add').click()
        check('Add recovers a closed draft after its card is removed in another window', await about.input_value() == 'A closed draft whose card is removed stays recoverable.')
        name = pg.locator('.sheet.on label.field').filter(has=pg.locator('span:text-is("Name")')).locator('input')
        check('the recovered draft keeps the removed card’s name', await name.input_value() == 'Mara, kept safely')
        check('the notes editing paths have no page exceptions', not [x for x in logs if x.startswith('PAGEERROR')], logs)
        check('these edits make no model calls', reqs() == [])
    finally: await pg.context.close()

async def wait_said_as_it_passes(browser):
    """(2.12.41, round 7 — the review of round 5, its F11: "again in fifteen minutes" stood on an open notes pane until
    something else changed.) What waits its time is said with when, and said again as the time passes while the notes
    stay open — nothing else changing meanwhile."""
    logs = []
    pg = await page(browser, logs, w=1280, hgt=900, mobile=False)
    try:
        await new_book(pg, 'A wait said as it passes')
        nid = (await pg.evaluate('location.hash')).split('/')[2]
        # a helper chosen, and the first chapter's summary waiting its time after a stall, forty seconds on — as the helper
        # keeps it (archivist.js stageStalled); the book has no words, so nothing is asked of the helper
        await pg.evaluate("""async ([nid, prov]) => {
          const s = await import('/js/store.js');
          const sh = await import('/js/novel/shape.js');
          s.change('house', 'house', (h) => { h.connections = [...(h.connections || []), { id: 'c-help', name: 'Helper', url: `http://127.0.0.1:${prov}/v1`, model: 'fake-writer', key: 'test-key' }]; h.roles = { ...(h.roles || {}), helper: 'c-help' }; });
          const cid = s.peek('novel', nid).order[0];
          const fp = sh.chapterPrint(s.peek('chapter', cid));
          s.change('novel', nid, (d) => { d.memory = { ...(d.memory || {}), tries: { ['summary:' + cid]: { what: 'summary', fp, chapterId: cid, label: 'Chapter One', n: 0, next: s.phoneNow() + 40000 } } }; });
          await s.flush();
        }""", [nid, harness.PROV])
        if not await pg.locator('#sidePane').evaluate("el => el.classList.contains('dock') || el.classList.contains('open')"): await pg.click('#notesBtn')
        await pg.locator('#sideTabs button[data-tab="notes"]').click()
        said = "() => [document.querySelector('#sidePane .note-status-copy')?.textContent || '', document.querySelector('#notesBtn')?.title || '']"
        await pg.wait_for_function(f"({said})().every((w) => w.includes('again in a minute'))", timeout=8000)
        first = await pg.evaluate(said)
        check('what waits is said with when, in the notes and on the light', all('The helper sums up Chapter One again in a minute' in w for w in first), first)
        # its time nearer: said so by itself while the notes stay open — before the run booked for it comes (forty-one
        # seconds on), so it is the words drawn again as the time passes, never a change of the book
        t0 = asyncio.get_event_loop().time()
        try:
            await pg.wait_for_function(f"({said})().every((w) => w.includes('again in a moment'))", timeout=36000)
            took = asyncio.get_event_loop().time() - t0
            ok = True
        except Exception:
            took, ok = asyncio.get_event_loop().time() - t0, False
        check('said again as the time passes, the notes open and nothing else changed', ok and took > 15, [round(took, 1), await pg.evaluate(said)])
        # the notes' check asked while the helper waits on a model that kept silent for as long as it is ever waited (as
        # archivist.js setSilent keeps it): its report says so, with when — never "as soon as what is new has been read"
        await pg.evaluate("""async (nid) => {
          const s = await import('/js/store.js');
          const a = await import('/js/novel/archivist.js');
          const w = await import('/js/novel/writer.js');
          const helper = w.connFor(s.peek('house', 'house'), 'helper');
          s.change('novel', nid, (d) => {
            d.notes.people = [{ id: 'mara', name: 'Mara', aka: [], about: 'The keeper.' }];
            d.memory = { ...(d.memory || {}), auditAsked: true, silent: { conn: a.choicePrint(helper), until: s.phoneNow() + 14 * 60000, leashMs: 15 * 60000 } };
          });
          await s.flush();
        }""", nid)
        report = "() => document.querySelector('#sidePane .checkbox')?.textContent || ''"
        try: await pg.wait_for_function(f"({report})().includes('sent nothing for fifteen minutes')", timeout=8000)
        except Exception: pass
        words = await pg.evaluate(report)
        check('the notes’ check asked while its silent model is waited out says so, with when', 'Checking the notes against the book… The helper’s model sent nothing for fifteen minutes — the helper asks it again in fourteen minutes, and checks them once what is new is read; what it finds shows here.' in words, words)
        check('the wait said as it passes has no page exceptions', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally: await pg.context.close()

async def main():
    with Env():
        async with async_playwright() as p:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await p.chromium.launch(**options)
            try:
                await scenario(browser)
                await wait_said_as_it_passes(browser)
            except Exception:
                traceback.print_exc(); check('the notes walk completes', False, traceback.format_exc()[-500:])
            finally: await browser.close()
    print(f'\nbrowser (notes): {sum(RESULTS)} passed, {len(RESULTS) - sum(RESULTS)} failed')
    sys.exit(not all(RESULTS))

if __name__ == '__main__': asyncio.run(main())
