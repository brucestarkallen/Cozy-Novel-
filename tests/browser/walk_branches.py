"""Story branches through the real page, saved records, and browser Back.

Synthetic books in a temporary library only. No model connection or paid calls.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '23981'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '23999'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok)))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f' [saw: {str(saw)[:450]}]'), flush=True)


async def flush(pg):
    await pg.evaluate("import('/js/store.js').then(s => s.flush())")


async def record(pg, kind, rid):
    response = await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/store/{kind}/{rid}')
    assert response.ok, (kind, rid, response.status)
    return (await response.json())['data']


def words(record):
    return [p['versions'][p.get('pick', 0)]['text']
            for p in record.get('passages', record.get('turns', []))]


async def snapshot(pg, nid):
    await flush(pg)
    novel = await record(pg, 'novel', nid)
    return {'novel': novel,
            'chapters': [await record(pg, 'chapter', cid) for cid in novel['order']],
            'plays': [await record(pg, 'play', pid) for pid in novel.get('plays', [])],
            'talk': await record(pg, 'talk', nid)}


async def source_book(pg, title):
    await H.new_book(pg, title)
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    fixture = await pg.evaluate("""async nid => {
      const s = await import('/js/store.js');
      const sh = await import('/js/novel/shape.js');
      const n = s.peek('novel', nid), cid = n.order[0];
      const ps = [
        sh.newPassage('you', 'Mara opens the gate beneath the lantern.'),
        sh.newPassage('you', 'She chooses the river road at noon.'),
        sh.newPassage('you', 'At dusk she reaches the distant harbor.')
      ];
      s.change('chapter', cid, c => { c.name = 'At the gate'; c.passages = ps; });
      const later = sh.newChapter(nid);
      later.name = 'The voyage';
      later.passages = [sh.newPassage('you', 'A week later the ship reaches home.')];
      await s.create('chapter', later.id, later);
      s.change('novel', nid, d => {
        d.order.push(later.id);
        d.notes.people = [{id:'mara-manual', name:'Mara', aka:[], about:'My own note about Mara.',
          now:'At the gate.', ties:'Trusts Rowan.', updated:{by:'you', his:['name','about','now','ties']}}];
        d.auto = {about:false, style:false};
      });
      await s.flush();
      return {nid, cid, later:later.id, pids:ps.map(p => p.id)};
    }""", nid)
    await pg.locator(f'.passage[data-id="{fixture["pids"][0]}"]').wait_for()
    return fixture


async def passage_branch(pg, pid):
    passage = pg.locator(f'.passage[data-id="{pid}"]')
    await passage.locator('.prose').click()
    await passage.get_by_role('button', name='More for this passage', exact=True).click()
    await pg.locator('.menu-pop').get_by_role('menuitem', name='Branch from here', exact=False).click()
    await pg.get_by_role('textbox', name='Name this branch', exact=False).wait_for()


async def family(pg):
    if await pg.locator('#sidePane.open').is_visible():
        await pg.keyboard.press('Escape')
        await pg.wait_for_function("!document.querySelector('#sidePane').classList.contains('open')")
    await pg.click('#moreBtn')
    await pg.locator('.menu-pop').get_by_role('menuitem', name='Branches of this story', exact=False).click()
    await pg.locator('.branch-book').first.wait_for()


async def submit_branch(pg, name, source):
    await pg.get_by_role('textbox', name='Name this branch', exact=False).fill(name)
    async with pg.expect_response(lambda r: r.request.method == 'POST' and r.url.endswith('/api/branches')) as response:
        await pg.get_by_role('button', name='Create branch', exact=True).click()
    result = await response.value
    assert result.ok, await result.text()
    await pg.wait_for_function("id => location.hash.startsWith('#/n/') && location.hash.split('/')[2] !== id", arg=source)
    await pg.locator('#desk:not([hidden])').wait_for()
    await pg.locator('.branch-form').wait_for(state='detached')
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    await pg.wait_for_function("async id => (await import('/js/store.js')).peek('novel', id)?.id === id", arg=nid)
    return nid


async def open_turn(pg, kind, rid, tid):
    await pg.evaluate("async a => (await import('/js/ui/panes.js')).showTurn(a.kind, a.rid, a.tid)",
                      {'kind': kind, 'rid': rid, 'tid': tid})
    turn = pg.locator(f'.turn[data-id="{tid}"]')
    await turn.wait_for()
    await turn.get_by_role('button', name='More for this answer', exact=True).click()


async def scenario_passage(browser):
    logs = []
    pg = await H.page(browser, logs, w=853, hgt=900, mobile=False)
    try:
        f = await source_book(pg, 'The Roads from the Gate')
        before = await snapshot(pg, f['nid'])
        await passage_branch(pg, f['pids'][0])
        check('passage branching explains the inclusive boundary and independent book',
              'up to and including this passage' in await pg.locator('.branch-form').inner_text())
        branch = await submit_branch(pg, 'The wooded road', f['nid'])
        copied = await snapshot(pg, branch)
        original = await snapshot(pg, f['nid'])
        check('an early passage creates a new saved book ending at that passage',
              len(copied['chapters']) == 1 and words(copied['chapters'][0]) == words(before['chapters'][0])[:1])
        check('later original passages and chapters stay intact',
              original['chapters'] == before['chapters'])
        check('the saved branch points to its source and has its own chapter ids',
              copied['novel']['branch']['fromId'] == f['nid'] and
              copied['novel']['branch']['rootId'] == f['nid'] and
              not set(copied['novel']['order']) & set(original['novel']['order']))
        check('the writer’s own notes travel into the branch',
              copied['novel']['notes']['people'][0]['about'] == 'My own note about Mara.')
        p = pg.locator('.passage').first
        await p.locator('.prose').click()
        await p.get_by_role('button', name='Edit', exact=True).click()
        await pg.get_by_role('textbox', name='Edit the passage', exact=True).fill('Mara follows the wooded road instead.')
        await p.get_by_role('button', name='Save', exact=True).click()
        await pg.get_by_role('textbox', name='Edit the passage', exact=True).wait_for(state='detached')
        await pg.evaluate("import('/js/ui/panes.js').then(p => p.showSide('notes'))")
        people = pg.locator('#sidePane .notesec').filter(has=pg.locator('h3:text-is("People")'))
        if not await people.locator('.card').first.is_visible():
            await people.locator('.sechead').click()
        await people.locator('.card').first.click()
        await pg.locator('.sheet.on label.field').filter(has=pg.locator('span:text-is("Who they are")')).locator('textarea').fill('Mara belongs to the wooded-road branch.')
        await pg.locator('.sheet.on').get_by_role('button', name='Save', exact=True).click()
        await pg.locator('.sheet.on').wait_for(state='detached')
        edited = await snapshot(pg, branch)
        original = await snapshot(pg, f['nid'])
        check('editing branch prose and notes saves both independently',
              words(edited['chapters'][0]) == ['Mara follows the wooded road instead.'] and
              edited['novel']['notes']['people'][0]['about'] == 'Mara belongs to the wooded-road branch.')
        check('branch edits leave source prose, versions and notes intact',
              original['chapters'] == before['chapters'] and original['novel']['notes'] == before['novel']['notes'])
        await family(pg)
        check('the family lists the current branch beside the original',
              await pg.locator('.branch-book[aria-current="page"]').inner_text() == 'The wooded road\nOpen now' and
              'The Roads from the Gate' in await pg.locator('.branch-family').inner_text())
        await pg.locator('.branch-book').filter(has=pg.locator('b:text-is("The Roads from the Gate")')).click()
        await pg.wait_for_function('id => location.hash.split("/")[2] === id', arg=f['nid'])
        await pg.locator('.branch-sheet').wait_for(state='detached')
        check('family switching reopens the complete original', await pg.locator('.passage').count() == 3)
        await family(pg)
        await pg.locator('.branch-book').filter(has=pg.locator('b:text-is("The wooded road")')).click()
        await pg.wait_for_function('id => location.hash.split("/")[2] === id', arg=branch)
        await pg.locator('.branch-sheet').wait_for(state='detached')
        await pg.click('#moreBtn')
        await pg.locator('.menu-pop').get_by_role('menuitem', name='About this book', exact=False).click()
        branches = pg.locator('.booksheet .group').filter(has=pg.locator('.ghead h3:text-is("Branches of this story")'))
        if 'fold' in (await branches.get_attribute('class') or ''):
            await branches.locator('.ghead').click()
        await pg.get_by_role('textbox', name='Branch name', exact=True).fill('The quiet wooded road')
        await pg.locator('.booksheet .head button[aria-label="Close"]').click()
        await pg.locator('.booksheet').wait_for(state='detached')
        renamed = await snapshot(pg, branch)
        check('renaming a branch saves its name without changing its original',
              renamed['novel']['branch']['name'] == 'The quiet wooded road' and
              not (await record(pg, 'novel', f['nid'])).get('branch'))
        await pg.go_back()
        await pg.wait_for_function('id => location.hash.split("/")[2] === id', arg=f['nid'])
        check('browser Back returns from the branch to the previous source book',
              await pg.locator('.passage').count() == 3)
        check('passage branching and independent editing produce no page errors',
              not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def scenario_scene(browser):
    logs = []
    pg = await H.page(browser, logs)
    try:
        f = await source_book(pg, 'The Scene at the Gate')
        ids = await pg.evaluate("""async f => {
          const s = await import('/js/store.js'), sh = await import('/js/novel/shape.js');
          const ts = [sh.newTurn('you', 'I hold out the lantern.'), sh.newTurn('ai', 'Rowan reaches for its warm handle.'),
            sh.newTurn('you', 'I lead him to the river.'), sh.newTurn('ai', 'Together they board the river boat.')];
          const pid = 'scene-branch-fixture';
          s.change('chapter', f.cid, c => {
            c.passages[1].versions[0].how = 'play';
            c.passages[1].versions[0].ask = {play:pid, who:'Mara', transcript:'The full scene goes onward to the boat.'};
          });
          await s.create('play', pid, {id:pid, novelId:f.nid, chapterId:f.cid, title:'The lantern offered', who:'Mara',
            from:'At the gate', turns:ts, after:f.pids[1], turned:ts[3].id, created:Date.now(), updated:Date.now()});
          s.change('novel', f.nid, n => { n.plays = [pid]; });
          await s.flush(); return {pid, tid:ts[1].id};
        }""", f)
        before = await snapshot(pg, f['nid'])
        await open_turn(pg, 'play', ids['pid'], ids['tid'])
        await pg.locator('.menu-pop').get_by_role('menuitem', name='Branch story from here', exact=False).click()
        check('the scene branch explains its safe prose boundary',
              'before this scene was turned into prose' in await pg.locator('.branch-form').inner_text())
        branch = await submit_branch(pg, 'Keep the lantern', f['nid'])
        after = await snapshot(pg, branch)
        check('scene branching keeps only the selected conversation prefix',
              len(after['plays']) == 1 and words(after['plays'][0]) == words(before['plays'][0])[:2])
        check('converted prose containing later scene turns is excluded safely',
              len(after['chapters']) == 1 and words(after['chapters'][0]) == words(before['chapters'][0])[:1] and
              not after['plays'][0].get('turned'))
        original = await snapshot(pg, f['nid'])
        check('scene branching leaves the original conversation and converted prose intact',
              original['plays'] == before['plays'] and original['chapters'] == before['chapters'])
        check('the new scene opens ready to continue in its independent book',
              await pg.get_by_role('textbox', name='What Mara says or does', exact=True).is_visible())
        check('scene branching produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def scenario_partner(browser):
    logs = []
    pg = await H.page(browser, logs)
    try:
        f = await source_book(pg, 'Talking over the Roads')
        tid = await pg.evaluate("""async f => {
          const s = await import('/js/store.js'), sh = await import('/js/novel/shape.js');
          const ts = [sh.newTurn('you', 'Which road should Mara take?'), sh.newTurn('ai', 'The wooded road has room for a surprise.'),
            sh.newTurn('you', 'And after the harbor?'), sh.newTurn('ai', 'Send her home by sea.')];
          await s.create('talk', f.nid, {id:f.nid, novelId:f.nid, turns:ts,
            convId:'roads-conversation', name:'The roads', named:true});
          await s.flush(); return ts[1].id;
        }""", f)
        before = await snapshot(pg, f['nid'])
        await open_turn(pg, 'talk', f['nid'], tid)
        check('partner menu distinguishes a conversation copy from a separate story',
              await pg.locator('.menu-pop').get_by_role('menuitem', name='Branch from here (conversation in this book)', exact=False).count() == 1)
        await pg.locator('.menu-pop').get_by_role('menuitem', name='Branch story with this conversation', exact=False).click()
        text = await pg.locator('.branch-form').inner_text()
        check('partner branch clearly says it copies the current manuscript',
              'whole story as it stands now' in text and 'does not turn the book back' in text, text)
        branch = await submit_branch(pg, 'The partner’s wooded road', f['nid'])
        after = await snapshot(pg, branch)
        check('partner branching copies the whole current manuscript including later chapters',
              [words(c) for c in after['chapters']] == [words(c) for c in before['chapters']])
        check('the new book keeps only the selected partner conversation prefix',
              words(after['talk']) == words(before['talk'])[:2])
        original = await snapshot(pg, f['nid'])
        check('the original partner conversation and pages stay unchanged',
              original['talk'] == before['talk'] and original['chapters'] == before['chapters'])
        check('the partner opens in the separate book ready for a new question',
              await pg.get_by_role('textbox', name='Ask your partner', exact=True).is_visible())
        check('partner branching produces no page errors', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def scenario_failure_navigation_layout(browser):
    logs = []
    pg = await H.page(browser, logs, w=853, hgt=900, mobile=False)
    try:
        f = await source_book(pg, 'A Branch Kept Safe')
        draft = '  A direction that belongs to the original.\nKeep every space.  '
        await pg.locator('#direction').fill(draft)
        await passage_branch(pg, f['pids'][0])
        name = pg.get_by_role('textbox', name='Name this branch', exact=False)
        await name.fill('A long branch name that stays readable while the phone folds')
        await name.focus()
        await name.evaluate('el => {el.setSelectionRange(2, 18);window.branchNameBox = el;}')
        for mode in ('light', 'dark'):
            await pg.evaluate("async mode => (await import('/js/ui/look.js')).applyLook({mode})", mode)
            for width in (360, 853):
                await pg.set_viewport_size({'width': width, 'height': 900})
                await pg.wait_for_function('w => innerWidth === w', arg=width)
                fit = await pg.evaluate("""() => {
                  const box = document.querySelector('.branch-form'), sheet = box.closest('.sheet');
                  const n = window.branchNameBox, r = n.getBoundingClientRect();
                  return {overflow:box.scrollWidth-box.clientWidth, sheet:sheet.scrollWidth-sheet.clientWidth,
                    outside:r.left < 0 || r.right > innerWidth, focus:document.activeElement===n,
                    same:box.querySelector('input')===n, selection:[n.selectionStart,n.selectionEnd]};
                }""")
                check(f'branch creation fits {width}px in {mode} with focus and selection intact',
                      fit['overflow'] <= 1 and fit['sheet'] <= 1 and not fit['outside'] and
                      fit['focus'] and fit['same'] and fit['selection'] == [2, 18], fit)
                await pg.screenshot(path=f'{H.SHOTS}/branch-name-{width}-{mode}.png')
        route_before = await pg.evaluate('location.hash')
        await pg.keyboard.press('Escape')
        await pg.locator('.branch-form').wait_for(state='detached')
        check('Back closes branch naming without leaving the source',
              await pg.evaluate('location.hash') == route_before and await pg.locator('#direction').input_value() == draft)
        await passage_branch(pg, f['pids'][0])
        check('closing and reopening branch naming preserves the typed name',
              await name.input_value() == 'A long branch name that stays readable while the phone folds')
        before = await snapshot(pg, f['nid'])
        async def failed(route):
            if route.request.method == 'POST':
                await route.fulfill(status=409, content_type='application/json', body='{"error":"The source changed in another window. Try the branch again."}')
            else:
                await route.continue_()
        await pg.route('**/api/branches', failed)
        await pg.get_by_role('button', name='Create branch', exact=True).click()
        await pg.locator('.branch-status:not([hidden])').wait_for()
        check('failed creation keeps its name, source route, and actionable error',
              bool(await name.input_value()) and await pg.evaluate('location.hash') == route_before and
              bool(await pg.locator('.branch-status').inner_text()))
        await pg.keyboard.press('Escape')
        await pg.locator('.branch-form').wait_for(state='detached')
        check('failed creation keeps the original direction draft exactly', await pg.locator('#direction').input_value() == draft)
        original = await snapshot(pg, f['nid'])
        check('failed creation leaves the source pages and notes untouched',
              original['chapters'] == before['chapters'] and original['novel']['notes'] == before['novel']['notes'])
        await pg.unroute('**/api/branches', failed)
        await passage_branch(pg, f['pids'][0])
        await name.fill('The branch finished after leaving')
        reached, release = asyncio.Event(), asyncio.Event()
        async def held(route):
            if route.request.method == 'POST':
                reached.set()
                await release.wait()
            await route.continue_()
        await pg.route('**/api/branches', held)
        await pg.get_by_role('button', name='Create branch', exact=True).click()
        await asyncio.wait_for(reached.wait(), timeout=10)
        await pg.keyboard.press('Escape')
        await pg.locator('.branch-form').wait_for(state='detached')
        await pg.click('#toShelf')
        await pg.locator('#shelf:not([hidden])').wait_for()
        async with pg.expect_response(lambda r: r.request.method == 'POST' and r.url.endswith('/api/branches')) as pending:
            release.set()
        response = await pending.value
        check('the delayed branch request actually completes successfully', response.ok, await response.text())
        await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('ready on the shelf')")
        rows = (await (await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/novels')).json())['novels']
        matches = [n for n in rows if n.get('branch', {}).get('name') == 'The branch finished after leaving']
        check('successful creation after leaving is saved without pulling navigation back',
              len(matches) == 1 and await pg.locator('#shelf').is_visible() and
              not (await pg.evaluate('location.hash')).startswith('#/n/'))
        check('failure and delayed navigation produce no page errors',
              not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def scenario_lost_acknowledgement_reload(browser):
    """The phone commits; both replies are lost; a fresh page retries once."""
    logs = []
    pg = await H.page(browser, logs)
    try:
        f = await source_book(pg, 'The Branch beyond a Lost Reply')
        before = await snapshot(pg, f['nid'])
        original_route = await pg.evaluate('location.hash')
        draft = '  These next words still belong to the original.  '
        await pg.locator('#direction').fill(draft)
        await passage_branch(pg, f['pids'][0])
        name = 'The road kept after a reload'
        await pg.get_by_role('textbox', name='Name this branch', exact=False).fill(name)
        committed, requests = [], []
        both_dropped = asyncio.Event()

        async def commit_without_reply(route):
            if route.request.method != 'POST':
                await route.continue_()
                return
            requests.append(route.request.post_data_json)
            # This goes to the real server first. Only the acknowledgement
            # disappears, so retrying must discover the already saved book.
            response = await route.fetch()
            committed.append({'status': response.status, **await response.json()})
            await route.abort('failed')
            if len(committed) == 2:
                both_dropped.set()

        await pg.route('**/api/branches', commit_without_reply)
        await pg.get_by_role('button', name='Create branch', exact=True).click()
        await asyncio.wait_for(both_dropped.wait(), timeout=15)
        await pg.locator('.branch-status:not([hidden])').wait_for()
        check('both lost replies follow successful commits of the same branch request',
              len(committed) == 2 and all(r['status'] == 200 and r.get('ok') for r in committed) and
              committed[0]['novelId'] == committed[1]['novelId'] and requests[0] == requests[1], committed)
        target = committed[0]['novelId']
        saved = await snapshot(pg, target)
        check('an unacknowledged branch is fully saved while the original stays open',
              words(saved['chapters'][0]) == words(before['chapters'][0])[:1] and
              await pg.evaluate('location.hash') == original_route)
        await pg.unroute('**/api/branches', commit_without_reply)

        # Another window can use the committed branch before this window
        # learns it exists. The retry must open those newer saved words.
        cid = saved['novel']['order'][0]
        remote = await (await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/store/chapter/{cid}')).json()
        changed = 'Mara waits beneath the lantern, as saved from another window.'
        remote['data']['passages'][0]['versions'][0]['text'] = changed
        response = await pg.request.put(f'http://127.0.0.1:{H.PORT}/api/store/chapter/{cid}',
                                       headers={'X-Base': str(remote['rev']), 'X-Client': 'branch-other-window'},
                                       data={'data': remote['data']})
        assert response.ok, await response.text()
        await pg.reload(wait_until='domcontentloaded')
        await pg.locator(f'.passage[data-id="{f["pids"][0]}"]').wait_for()
        await pg.wait_for_function('value => document.querySelector("#direction").value === value', arg=draft)
        check('reload after the lost acknowledgement preserves the exact original draft',
              await pg.locator('#direction').input_value() == draft and
              (await record(pg, 'draft', f['nid']))['direction'] == draft)
        await passage_branch(pg, f['pids'][0])
        retried = await submit_branch(pg, name, f['nid'])
        rows = (await (await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/novels')).json())['novels']
        family_rows = [n for n in rows if n.get('branch', {}).get('fromId') == f['nid']]
        check('same-origin reload and retry open the one existing branch without duplication',
              retried == target and len(family_rows) == 1 and family_rows[0]['id'] == target, family_rows)
        after = await snapshot(pg, retried)
        await pg.wait_for_function('text => document.querySelector(".passage .prose")?.textContent.includes(text)', arg=changed)
        check('idempotent retry preserves and displays newer edits in the committed branch',
              words(after['chapters'][0]) == [changed] and changed in await pg.locator('.passage .prose').inner_text())
        original = await snapshot(pg, f['nid'])
        check('lost acknowledgements and recovery preserve the original pages and notes',
              original['chapters'] == before['chapters'] and original['novel']['notes'] == before['novel']['notes'])
        check('lost-acknowledgement recovery produces no page exceptions',
              not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def scenario_destination_removed(browser):
    """Deletion after commit cannot masquerade as a branch ready to open."""
    logs = []
    pg = await H.page(browser, logs)
    try:
        f = await source_book(pg, 'A Branch Removed before Opening')
        before = await snapshot(pg, f['nid'])
        original_route = await pg.evaluate('location.hash')
        await passage_branch(pg, f['pids'][0])
        await pg.get_by_role('textbox', name='Name this branch', exact=False).fill('Removed in another window')
        results = []

        async def remove_after_commit(route):
            if route.request.method != 'POST':
                await route.continue_()
                return
            committed = await route.fetch()
            payload = await committed.json()
            if committed.ok and payload.get('novelId'):
                removed = await pg.request.delete(f'http://127.0.0.1:{H.PORT}/api/store/novel/{payload["novelId"]}')
                results.append({'created': committed.status, 'removed': removed.status, 'id': payload['novelId']})
            await route.fulfill(response=committed)

        await pg.route('**/api/branches', remove_after_commit)
        await pg.get_by_role('button', name='Create branch', exact=True).click()
        await pg.locator('.branch-status:not([hidden])').wait_for()
        error = await pg.locator('.branch-status').inner_text()
        check('the deletion race actually saves and then removes the destination',
              len(results) == 1 and results[0]['created'] == 200 and results[0]['removed'] == 200, results)
        check('a branch removed after commit reports removal and keeps the source open',
              'removed' in error.lower() and await pg.evaluate('location.hash') == original_route and
              await pg.locator('.branch-form').is_visible(), error)
        check('the removed destination is not recreated while the source stays intact',
              await record(pg, 'novel', results[0]['id']) is None and
              (await snapshot(pg, f['nid']))['chapters'] == before['chapters'])
        check('destination removal produces no page exceptions',
              not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as pw:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await pw.chromium.launch(**options)
            for scenario in (scenario_passage, scenario_scene, scenario_partner, scenario_failure_navigation_layout,
                             scenario_lost_acknowledgement_reload, scenario_destination_removed):
                try:
                    await scenario(browser)
                except Exception:
                    traceback.print_exc()
                    check(f'{scenario.__name__} runs to completion', False, traceback.format_exc()[-700:])
            check('story branching makes no model calls', not H.reqs())
            await browser.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\nbrowser (branches): {len(RESULTS)-len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    asyncio.run(main())
