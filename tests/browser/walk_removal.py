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


async def main():
    with Env():
        async with async_playwright() as p:
            chromium = os.environ.get('COZY_TEST_CHROMIUM')
            browser = await p.chromium.launch(**({'executable_path': chromium} if chromium else {}))
            try: await scenario(browser)
            except Exception:
                traceback.print_exc(); check('the deletion walk completes', False, traceback.format_exc()[-500:])
            finally: await browser.close()
    failed = sum(not ok for _, ok in RESULTS)
    print(f'\nbrowser (removal): {len(RESULTS) - failed} passed, {failed} failed')
    sys.exit(bool(failed))


if __name__ == '__main__':
    asyncio.run(main())
