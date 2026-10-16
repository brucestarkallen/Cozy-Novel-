"""Search stays usable while a newer query waits; real sheets and saved records.
Synthetic temporary books only, no provider connections or model calls.
"""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', 21351))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', 21352))
from harness import Env, async_playwright, new_book, page, reqs

RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f' [saw: {str(saw)[:500]}]'), flush=True)


async def settle(pg):
    await pg.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


async def search(pg, query):
    await pg.get_by_role('searchbox', name='Words to find').fill(query)
    await pg.get_by_role('searchbox', name='Words to find').press('Enter')
    await pg.wait_for_function("document.querySelector('.sheet.on .results')?.getAttribute('aria-busy')==='false'")


async def open_search(pg):
    await pg.evaluate("import('/js/ui/search.js').then(m=>m.openSearch())")
    await pg.wait_for_selector('.sheet.on .searchtop')


async def scenario(browser):
    logs = []
    pg = await page(browser, logs, w=360, hgt=800)
    releases = []
    try:
        await new_book(pg, 'Search by lamplight')
        ids = await pg.evaluate("""async () => {
          const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');
          const nid=location.hash.split('/')[2],cid=s.peek('novel',nid).order[0];
          const first=sh.newPassage('you','Mara lit the lantern. Rowan waited by the harbor.');
          const second=sh.newPassage('you','The harbor held a secret.');
          const cap=[sh.newPassage('you','constellation '.repeat(240)),sh.newPassage('you','constellation '.repeat(240))];
          const tail=Array.from({length:180},(_,i)=>sh.newPassage('you',`Quiet page ${i}. `+'A long corridor under winter stars. '.repeat(12)));
          s.change('chapter',cid,c=>{c.passages=[first,second,...cap,...tail];});
          const foreign=sh.newNovel({title:'Another room'});
          foreign.chapter.passages=[sh.newPassage('you','The faraway harbor with a constellation.')];
          await s.flush();
          /* Save outside this page's store so a search must explicitly open it. */
          for(const [kind,record] of [['chapter',foreign.chapter],['novel',foreign.novel]]) {
            const r=await fetch(`/api/store/${kind}/${record.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:record})});
            if(!r.ok)throw Error('fixture save failed');
          }
          return {nid,cid,first:first.id,other:foreign.novel.id};
        }""")
        await open_search(pg)
        await search(pg, 'lantern')
        check('normal query returns its passage and highlighted words', await pg.evaluate("document.querySelectorAll('.sheet.on .hit').length===1 && document.querySelector('.sheet.on .hit mark')?.textContent==='lantern'"))
        await pg.evaluate("window.keptSearchHit=document.querySelector('.sheet.on .hit')")

        # Hold only the first whole-library listing. A second query can finish
        # first, so releasing the older response exercises the stale reply guard.
        waiting, release = asyncio.Event(), asyncio.Event()
        releases.append(release)
        held = False
        async def first_listing(route):
            nonlocal held
            if not held:
                held = True
                waiting.set()
                await release.wait()
            await route.continue_()
        await pg.route('**/api/novels', first_listing)
        await pg.get_by_role('button', name='All books', exact=True).click()
        await asyncio.wait_for(waiting.wait(), timeout=10)
        check('previous results remain connected while a new search waits', await pg.evaluate("keptSearchHit.isConnected && document.querySelector('.sheet.on .results').getAttribute('aria-busy')==='true'"))
        await search(pg, 'harbor')
        check('newer query completes without waiting for the older response', await pg.evaluate("[...document.querySelectorAll('.sheet.on .hit mark')].length===3 && [...document.querySelectorAll('.sheet.on .hit mark')].every(m=>m.textContent==='harbor')"))
        async with pg.expect_response('**/api/novels') as response:
            release.set()
        await (await response.value).json()
        await settle(pg)
        await pg.unroute('**/api/novels', first_listing)
        check('late older response cannot replace the newer results', await pg.evaluate("[...document.querySelectorAll('.sheet.on .hit mark')].length===3 && [...document.querySelectorAll('.sheet.on .hit mark')].every(m=>m.textContent==='harbor')"))

        # Reload gives the cap test a genuinely unopened second book again.
        await pg.get_by_role('dialog', name='Search', exact=True).get_by_role('button', name='Close', exact=True).click()
        # Closing a sheet unwinds its history entry asynchronously. Finish
        # that navigation before asking Chromium to reload the document.
        await pg.evaluate("import('/js/ui/dom.js').then(m=>m.afterBacks())")
        await pg.reload()
        await pg.wait_for_selector('#desk:not([hidden]) .passage')
        opened = []
        pg.on('request', lambda request: opened.append(request.url) if '/api/store/novel/' + ids['other'] in request.url else None)
        await open_search(pg)
        await search(pg, 'constellation')
        await pg.get_by_role('button', name='All books', exact=True).click()
        await pg.wait_for_function("document.querySelector('.sheet.on .results')?.getAttribute('aria-busy')==='false' && document.querySelector('.sheet.on .searchsay')?.textContent.includes('first 400')")
        check('common-word search keeps the 400-result cap', await pg.locator('.sheet.on .hit').count() == 400)
        check('a full result page does not open later books', not opened, opened)
        check('cap preserves source order and passage labels', await pg.evaluate("document.querySelector('.sheet.on .hit .where').textContent==='Passage 3' && [...document.querySelectorAll('.sheet.on .hit .where')].at(-1).textContent==='Passage 4'"))

        await pg.get_by_role('button', name='This book', exact=True).click()
        await search(pg, 'lantern')
        waiting2, release2, finished2 = asyncio.Event(), asyncio.Event(), asyncio.Event()
        releases.append(release2)
        async def closing_listing(route):
            waiting2.set()
            await release2.wait()
            await route.continue_()
            finished2.set()
        await pg.route('**/api/novels', closing_listing)
        await pg.get_by_role('button', name='All books', exact=True).click()
        await asyncio.wait_for(waiting2.wait(), timeout=10)
        # Retained results still mean their displayed old query and source.
        await pg.locator('.sheet.on .hit').first.click()
        await pg.wait_for_function("!document.querySelector('.sheet.on.searchsheet') && !document.querySelector('.sheet.on .searchtop')")
        await pg.wait_for_selector(f'.passage.found[data-id="{ids["first"]}"]')
        check('retained search result still navigates and highlights its own words', await pg.evaluate("[...CSS.highlights.get('found')][0].toString()==='lantern'"))
        async with pg.expect_response('**/api/novels') as response:
            release2.set()
        await (await response.value).json()
        await asyncio.wait_for(finished2.wait(), timeout=10)
        await settle(pg)
        check('closing search cancels a late response without reopening it', await pg.locator('.sheet.on .searchtop').count() == 0)
        await pg.unroute('**/api/novels', closing_listing)
        await open_search(pg)
        await search(pg, '')
        check('clearing the query clears results and busy state', await pg.evaluate("document.querySelectorAll('.sheet.on .hit').length===0 && document.querySelector('.sheet.on .results').getAttribute('aria-busy')==='false'"))
        await pg.keyboard.press('Escape')
        check('phone Back closes the search sheet', await pg.locator('.sheet.on .searchtop').count() == 0)
        check('search makes no model calls', reqs() == [])
        check('search paths have no page exceptions', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        for release in releases:
            release.set()
        await pg.context.close()


async def main():
    with Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None))
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('the search performance walk completes', False, traceback.format_exc()[-600:])
            finally:
                await browser.close()
    print(f'\nbrowser (search performance): {sum(RESULTS)} passed, {len(RESULTS)-sum(RESULTS)} failed')
    sys.exit(not all(RESULTS))


if __name__ == '__main__':
    asyncio.run(main())
