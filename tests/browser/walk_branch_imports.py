"""Damaged branch backups are refused through both actual import controls.

Synthetic records in a temporary library only; no model connection or calls.
"""
import asyncio
import json
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '24681'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '24699'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok)))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f' [saw: {str(saw)[:450]}]'), flush=True)


def damaged_copy():
    def rec(kind, data):
        return {'kind': kind, 'id': data['id'], 'data': data}

    # A good book comes first: validation must finish before any books land.
    return {'format': 'cozynovel-library', 'version': 2, 'records': [
        rec('novel', {'id': 'n-good', 'meta': {'title': 'A Good Book First'},
                      'order': ['ch-good'], 'plays': []}),
        rec('chapter', {'id': 'ch-good', 'novelId': 'n-good', 'passages': []}),
        rec('novel', {'id': 'n-left', 'meta': {'title': 'The Left Road'},
                      'order': ['ch-shared'], 'plays': []}),
        rec('novel', {'id': 'n-right', 'meta': {'title': 'The Right Road'},
                      'order': ['ch-shared'], 'plays': [],
                      'branch': {'rootId': 'n-left', 'fromId': 'n-left',
                                 'name': 'The other road', 'point': {'kind': 'book'}}}),
        rec('chapter', {'id': 'ch-shared', 'novelId': 'n-left', 'passages': []}),
    ]}


async def saved_records(pg):
    await pg.evaluate("import('/js/store.js').then(s => s.flush())")
    response = await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/backup')
    assert response.ok, await response.text()
    backup = await response.json()
    return {(r['kind'], r['id']): r for r in backup['records']}


async def choose_copy(pg, button):
    async with pg.expect_file_chooser() as choosing:
        await button.click()
    chooser = await choosing.value
    await chooser.set_files({'name': 'shared-chapter-copy.json',
                             'mimeType': 'application/json',
                             'buffer': json.dumps(damaged_copy()).encode()})


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs)
    try:
        await H.new_book(pg, 'The Book Already Here')
        nid = (await pg.evaluate('location.hash')).split('/')[2]
        await pg.evaluate("""async id => {
          const s = await import('/js/store.js');
          const sh = await import('/js/novel/shape.js');
          const n = s.peek('novel', id);
          s.change('chapter', n.order[0], c => {
            c.name = 'My untouched chapter';
            c.passages = [sh.newPassage('you', 'The lantern stays beside the gate.')];
          });
          s.change('novel', id, d => {
            d.notes.people = [{id:'mara', name:'Mara', about:'My own note stays here.',
                               updated:{by:'you', at:123}}];
          });
          await s.flush();
        }""", nid)
        await pg.click('#toShelf')
        await pg.locator('#shelf:not([hidden])').wait_for()
        # The shelf opens before its asynchronous list has arrived. Establish
        # that this book is visible before testing whether rejection keeps it
        # visible; the cached welcome also has a Bring in a book button.
        await pg.get_by_role('button', name='Open The Book Already Here', exact=True).wait_for(state='visible')
        before = await saved_records(pg)
        writes = []
        pg.on('request', lambda req: writes.append(req.url)
              if req.method in ('PUT', 'POST', 'DELETE') and '/api/store/' in req.url else None)

        await choose_copy(pg, pg.get_by_role('button', name='Bring in a book', exact=True))
        await pg.locator('#toast.on').filter(has_text='conflicting owners').wait_for()
        toast = await pg.locator('#toast').inner_text()
        check('shelf import visibly explains the damaged copy and says no books were added',
              'conflicting owners' in toast and 'No books were added' in toast, toast)
        after = await saved_records(pg)
        check('shelf import creates no records, including the good book before the damaged pair',
              set(after) == set(before) and not writes, {'added': list(set(after) - set(before)), 'writes': writes})
        check('shelf import leaves every saved source record unchanged', after == before)
        check('shelf remains usable with its existing book visible',
              await pg.get_by_role('button', name='Open The Book Already Here', exact=True).is_visible())

        await pg.click('#shelfSettings')
        await H.settings_part(pg, 'Backups')
        before = await saved_records(pg)
        writes.clear()
        # Clear the earlier transient message by its normal timeout before
        # checking that the Settings route raises its own visible error. The
        # app's own hint (Add a connection…) waits for a line showing to go
        # and then has its own time (2.12.2), so up to 7 s + 6.5 s.
        await pg.locator('#toast.on').wait_for(state='hidden', timeout=16000)
        await choose_copy(pg, pg.get_by_role('button', name='Bring a copy back', exact=True))
        await pg.get_by_role('button', name='Add its books to the shelf', exact=True).click()
        await pg.locator('#toast.on').filter(has_text='conflicting owners').wait_for()
        toast = await pg.locator('#toast').inner_text()
        check('Settings Add books visibly explains the damaged copy and says no books were added',
              'conflicting owners' in toast and 'No books were added' in toast, toast)
        after = await saved_records(pg)
        check('Settings Add books creates no records or partial imported books',
              set(after) == set(before) and not writes, {'added': list(set(after) - set(before)), 'writes': writes})
        check('Settings Add books leaves every saved source record unchanged', after == before)
        check('Settings remains usable after rejecting the copy',
              await pg.get_by_role('button', name='Bring a copy back', exact=True).is_visible())
        check('both refused imports produce no page or console errors', not logs, logs)
    finally:
        await pg.context.close()


async def hint_waits(browser):
    """The app's own hint, said 0.9 s after it opens with no connection, never
    covers a line already showing (the walk above once saw it take the place
    of the import's error); it comes once that line goes."""
    logs = []
    pg = await H.page(browser, logs)
    try:
        await pg.goto(f'http://127.0.0.1:{H.PORT}/')
        await pg.locator('#shelf:not([hidden])').wait_for()
        await pg.evaluate("import('/js/ui/dom.js').then(d => d.toast('That copy could not be read. No books were added.', 3000))")
        await pg.wait_for_timeout(1700)
        shown = await pg.locator('#toast').inner_text()
        check('a line showing is never covered by the app’s own hint', 'No books were added' in shown, shown)
        hint = pg.locator('#toast.on').filter(has_text='Add a connection in Settings')
        try:
            await hint.wait_for(timeout=9000)
            came = True
        except Exception:
            came = False
        check('the hint comes once that line has gone', came, await pg.locator('#toast').inner_text())
        check('the hint makes no page or console errors', not logs, logs)
    finally:
        await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as pw:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await pw.chromium.launch(**options)
            try:
                await scenario(browser)
                await hint_waits(browser)
            except Exception:
                traceback.print_exc()
                check('damaged imports run to completion', False, traceback.format_exc()[-700:])
            check('import checks make no model calls', not H.reqs())
            await browser.close()
    failed = [r for r in RESULTS if not r[1]]
    print(f'\nbrowser (branch imports): {len(RESULTS) - len(failed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
