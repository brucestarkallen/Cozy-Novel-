"""Failed chapter/scene deletion preserves visibility and concurrent book edits.

Real app/server, temporary books, failed DELETE responses; no model connection.
"""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', 19681))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', 19699))
from harness import Env, PORT, async_playwright, new_book, page, reqs

RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok)))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f' [saw: {str(saw)[:400]}]'), flush=True)


async def saved(pg, nid):
    return await pg.evaluate("""async id => {
      const s = await import('/js/store.js'); await s.flush('novel', id);
      return (await (await fetch('/api/store/novel/' + id)).json()).data;
    }""", nid)


async def chapter_remove(pg):
    if not await pg.locator('#chaptersBody').is_visible():
        await pg.click('#bookTitle')
    row = pg.locator('#chaptersBody li').filter(has_text='Keep this chapter')
    await row.locator('button.menu').click()
    await pg.locator('.menu-pop button').filter(has_text='Remove the chapter').click()
    await pg.locator('.sheet.on button').filter(has_text='Remove it').click()


async def scene_remove(pg):
    await pg.get_by_role('button', name='More for this scene', exact=True).click()
    await pg.locator('.menu-pop button').filter(has_text='Remove this scene').click()
    await pg.locator('.sheet.on button').filter(has_text='Remove it').click()


async def scenario(browser):
    logs = []
    pg = await page(browser, logs, w=1280, hgt=900, mobile=False)
    try:
        await new_book(pg, 'A Book That Stays')
        nid = (await pg.evaluate('location.hash')).split('/')[2]
        fixture = await pg.evaluate("""async nid => {
          const s = await import('/js/store.js');
          const sh = await import('/js/novel/shape.js');
          const talk = await import('/js/novel/talk.js');
          const n = s.peek('novel', nid), first = n.order[0];
          const middle = sh.newChapter(nid), target = sh.newChapter(nid);
          middle.name = 'Another chapter'; target.name = 'Keep this chapter';
          const passage = sh.newPassage('you', 'These exact chapter words must stay.');
          target.passages.push(passage);
          await s.create('chapter', middle.id, middle); await s.create('chapter', target.id, target);
          s.change('novel', nid, n => {
            n.order.push(middle.id, target.id);
            n.memory.seen[target.id] = { [passage.id]: { sig: 'already-read' } };
          });
          const play = await talk.newPlay({ novelId: nid, chapterId: first, who: 'Mara', from: 'Keep this scene' });
          const turn = sh.newTurn('you', 'These exact scene words must stay.');
          s.change('play', play, sh.turnSteps.addTurn(turn));
          const other = await talk.newPlay({ novelId: nid, chapterId: first, who: 'Tomas', from: 'Another scene' });
          await s.flush();
          return { first, middle: middle.id, target: target.id, play, other, seen: n.memory.seen[target.id] };
        }""", nid)
        await pg.evaluate("x => location.hash = '#/n/' + x.nid + '/' + x.cid", {'nid': nid, 'cid': fixture['target']})
        await pg.wait_for_function("document.querySelector('#chapname').textContent === 'Keep this chapter'")

        reached, release = asyncio.Event(), asyncio.Event()
        async def fail_chapter(route):
            if route.request.method != 'DELETE':
                await route.continue_(); return
            reached.set(); await release.wait()
            await route.fulfill(status=503, content_type='application/json', body='{"error":"synthetic delete failure"}')
        url = f'**/api/store/chapter/{fixture["target"]}'
        await pg.route(url, fail_chapter)
        await chapter_remove(pg)
        await asyncio.wait_for(reached.wait(), 5)
        order = [fixture['middle'], fixture['first'], fixture['target']]
        await pg.evaluate("""async x => {
          const s = await import('/js/store.js');
          s.change('novel', x.nid, n => { n.order = x.order; n.meta.title = 'Edited while deleting'; });
          await s.flush('novel', x.nid);
        }""", {'nid': nid, 'order': order})
        during = await saved(pg, nid)
        check('a chapter remains linked and read while deletion is unresolved',
              during['order'] == order and during['memory']['seen'].get(fixture['target']) == fixture['seen'])
        release.set()
        await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('The chapter could not be removed')")
        after = await saved(pg, nid)
        check('a failed chapter deletion preserves concurrent ordering and book edits',
              after['order'] == order and after['meta']['title'] == 'Edited while deleting', after)
        check('failed deletion preserves the chapter’s reading state and does not retire its words',
              after['memory']['seen'].get(fixture['target']) == fixture['seen'] and
              not any(row['id'] == fixture['target'] for row in after['memory'].get('removed', [])))
        check('the failed chapter remains selected with its exact prose',
              (await pg.evaluate('location.hash')).endswith('/' + fixture['target']) and
              'These exact chapter words must stay.' in await pg.inner_text('#passages'))
        await pg.unroute(url, fail_chapter)
        await chapter_remove(pg)
        await pg.wait_for_function("""async x => {
          const n = (await (await fetch('/api/store/novel/' + x.nid)).json()).data;
          return !n.order.includes(x.cid);
        }""", arg={'nid': nid, 'cid': fixture['target']})
        after = await saved(pg, nid)
        check('retry removes only the chosen chapter from the current order',
              after['order'] == order[:-1] and after['meta']['title'] == 'Edited while deleting', after['order'])
        await pg.wait_for_function("document.querySelector('#desk:not([hidden])') && location.hash.endsWith('/' + " + repr(fixture['first']) + ")")
        check('successful deletion of the selected last chapter leaves a live chapter open', await pg.locator('#desk').is_visible())
        check('successful chapter deletion retires its reading once',
              fixture['target'] not in after['memory']['seen'] and
              sum(row['id'] == fixture['target'] for row in after['memory'].get('removed', [])) == 1)

        if not await pg.locator('#sideTabs').is_visible(): await pg.click('#notesBtn')
        await pg.locator('#sideTabs button[data-tab="play"]').click()
        await pg.locator('#sideBody .plays button').filter(has_text='Keep this scene').click()
        reached, release = asyncio.Event(), asyncio.Event()
        async def fail_scene(route):
            if route.request.method != 'DELETE':
                await route.continue_(); return
            reached.set(); await release.wait()
            await route.fulfill(status=503, content_type='application/json', body='{"error":"synthetic delete failure"}')
        url = f'**/api/store/play/{fixture["play"]}'
        await pg.route(url, fail_scene)
        await scene_remove(pg)
        await asyncio.wait_for(reached.wait(), 5)
        extra = await pg.evaluate("""async x => {
          const s = await import('/js/store.js'), talk = await import('/js/novel/talk.js');
          const id = await talk.newPlay({ novelId: x.nid, chapterId: x.cid, who: 'Edda', from: 'Added while deleting' });
          s.change('novel', x.nid, n => { n.plays = [id, x.other, x.target]; n.meta.title = 'Edited during scene deletion'; });
          await s.flush(); return id;
        }""", {'nid': nid, 'cid': fixture['first'], 'other': fixture['other'], 'target': fixture['play']})
        expected_plays = [extra, fixture['other'], fixture['play']]
        release.set()
        await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('The scene could not be removed')")
        after = await saved(pg, nid)
        check('a failed scene deletion preserves all links, concurrent additions and ordering', after['plays'] == expected_plays, after['plays'])
        check('the failed scene stays open with its exact words',
              await pg.get_by_role('button', name='More for this scene', exact=True).is_visible() and
              'These exact scene words must stay.' in await pg.inner_text('#sideBody'))
        await pg.unroute(url, fail_scene)
        await scene_remove(pg)
        await pg.wait_for_selector('#sideBody .plays')
        after = await saved(pg, nid)
        check('retry removes only the chosen scene and preserves concurrent title edits',
              after['plays'] == expected_plays[:-1] and after['meta']['title'] == 'Edited during scene deletion', after)
        check('successful scene deletion returns to the remaining scenes',
              await pg.locator('#sideBody .plays button').count() == 2)
        check('scene removal leaves every surviving chapter in the book', after['order'] == order[:-1], after['order'])
        trash = await pg.evaluate("fetch('/api/trash').then(r => r.json()).then(j => j.trash)")
        check('only successful removals create deleted copies',
              sorted(row['kind'] for row in trash) == ['chapter', 'play'], trash)
        check('the failure/retry paths have no page errors', not [row for row in logs if row.startswith('PAGEERROR')], logs)
        check('the deletion tests make no model calls', reqs() == [])
    finally:
        await pg.context.close()


async def earlier_copies(browser):
    """His report, 2.12.3: "Who designed Earlier copies … everything looks the same" — a passage gone from the chapter
    is found in the copy that still has it, said beside the chapter now, looked at before anything changes, and brought
    back; copies that read the same are one row, and the one that reads as the chapter does now is said so."""
    logs = []
    pg = await page(browser, logs)
    try:
        await new_book(pg, 'Copies Book')
        nid = (await pg.evaluate('location.hash')).split('/')[2]
        await pg.evaluate("""async id => {
          const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js');
          const cid = s.peek('novel', id).order[0];
          s.change('chapter', cid, c => { c.passages = [sh.newPassage('you', 'The first passage stays.'), sh.newPassage('you', 'My beautiful passage two, every word of it.')]; }, { now: true });
          await s.flush();
          s.change('chapter', cid, c => { c.name = 'Harbour'; }, { now: true }); await s.flush();
          s.change('chapter', cid, c => { c.name = 'The Harbour'; }, { now: true }); await s.flush();
          s.change('chapter', cid, c => { c.passages = c.passages.slice(0, 1); }, { now: true });
          await s.flush();
        }""", nid)
        if not await pg.locator('#chaptersBody').is_visible():
            await pg.click('#bookTitle')
        await pg.locator('#chaptersBody li button.menu').first.click()
        await pg.locator('.menu-pop button').filter(has_text='Earlier copies of this chapter').click()
        sheet = pg.locator('.sheet.on').filter(has_text='Earlier copies')
        await sheet.locator('text=Now:').wait_for()
        body = await sheet.inner_text()
        check('the chapter now is said first', 'Now: 1 passage · 4 words.' in body, body[:600])
        rows = sheet.locator('ul.copies > li')
        texts = [await rows.nth(i).inner_text() for i in range(await rows.count())]
        check('the copy that still has the passage says so beside now', any('1 passage more than now' in t for t in texts), texts)
        check('copies that read the same are one row', any('2 copies, the same words' in t or '3 copies, the same words' in t for t in texts), texts)
        more = rows.filter(has_text='1 passage more than now').first
        await more.locator('button').filter(has_text='Look').click()
        look = pg.locator('.sheet.on').filter(has_text='The copy of')
        await look.wait_for()
        seen = await look.inner_text()
        check('Look shows its passages, the one gone from the chapter named so', 'Passage 2 — Not in the chapter now' in seen and 'My beautiful passage two' in seen, seen[:500])
        check('the passage still in the chapter is not marked', 'Passage 1 —' not in seen, seen[:300])
        await look.locator('button').filter(has_text='Bring this copy back').click()
        await pg.locator('.sheet.on button').filter(has_text='Bring it back').click()
        await pg.locator('#toast.on').filter(has_text='The chapter is back as it was').wait_for()
        back = await pg.evaluate("""async id => { const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js');
          return s.peek('chapter', s.peek('novel', id).order[0]).passages.map(p => sh.picked(p).text); }""", nid)
        check('brought back, the passage is in the chapter again', back == ['The first passage stays.', 'My beautiful passage two, every word of it.'], back)
        await pg.evaluate("import('/js/store.js').then(s => s.flush())")
        await pg.locator('#chaptersBody li button.menu').first.click()
        await pg.locator('.menu-pop button').filter(has_text='Earlier copies of this chapter').click()
        sheet = pg.locator('.sheet.on').filter(has_text='Earlier copies')
        await sheet.locator('text=Now:').wait_for()
        rows = sheet.locator('ul.copies > li')
        top = await rows.nth(0).inner_text()
        check('the chapter as it was a moment ago is the newest copy, said beside now', '1 passage fewer than now' in top, top)
        same = sheet.locator('ul.copies > li.same')
        check('the copy that reads as the chapter does now is marked, with nothing to bring back',
              await same.count() >= 1 and 'The same words as now' in await same.first.inner_text() and await same.first.locator('button').filter(has_text='Bring back').count() == 0,
              [await rows.nth(i).inner_text() for i in range(await rows.count())])
        check('earlier copies make no page errors', not [r for r in logs if r.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def main():
    with Env():
        async with async_playwright() as p:
            chromium = os.environ.get('COZY_TEST_CHROMIUM')
            browser = await p.chromium.launch(**({'executable_path': chromium} if chromium else {}))
            try:
                await scenario(browser)
                await earlier_copies(browser)
            except Exception:
                traceback.print_exc(); check('the deletion walk completes', False, traceback.format_exc()[-500:])
            finally: await browser.close()
    failed = sum(not ok for _, ok in RESULTS)
    print(f'\nbrowser (removal): {len(RESULTS) - failed} passed, {failed} failed')
    sys.exit(bool(failed))


if __name__ == '__main__':
    asyncio.run(main())
