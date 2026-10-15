"""The writing room: returning to a book, finding it, and beginning safely.

The real page and server, temporary books only, and no model connection.
"""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', harness.PORT))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', harness.PROV))
from harness import Env, PORT, SHOTS, async_playwright, new_book, page


RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:350]}]'), flush=True)


async def shelf(pg):
    await pg.click('#toShelf')
    await pg.wait_for_selector('#shelf:not([hidden])')
    await pg.evaluate("import('/js/store.js').then((s) => s.flush())")
    await pg.evaluate("import('/js/ui/shelf.js').then((s) => s.refresh())")


async def covers(pg):
    return await pg.locator('#books .book:not(.new) .cover .t').all_text_contents()


async def search(pg, words):
    await pg.fill('#search', words)
    # Search deliberately waits for a pause in typing before drawing.
    await pg.wait_for_timeout(250)


async def archive_action(pg, name):
    await pg.wait_for_selector('.sheet.on')
    folded = pg.locator('.sheet.on .group.fold > .ghead').filter(has_text='Put it away')
    if await folded.count():
        await folded.click()
    await pg.get_by_role('button', name=name, exact=True).click()


async def scenario_room(b):
    """the shelf welcomes, returns to the right chapter, and finds every book"""
    logs = []
    pg = await page(b, logs)
    try:
        await pg.goto(f'http://127.0.0.1:{PORT}/')
        await pg.wait_for_selector('#shelf:not([hidden]) .empty-shelf')
        check('a new room has its own welcome',
              await pg.text_content('#shelfGreeting') == 'A little room.\nA whole world.')
        check('a new room offers no pretend book to continue',
              not await pg.locator('#shelfResume').is_visible())
        check('the empty shelf says exactly how many books it holds',
              await pg.inner_text('#shelfCount') == '0 books')

        await new_book(pg, 'A Cup of Moonlight')
        first_id = (await pg.evaluate('location.hash')).split('/')[2]
        await shelf(pg)
        check('search is available with just one book', await pg.locator('#search').is_visible())
        check('the first book is counted once', await pg.inner_text('#shelfCount') == '1 book')
        check('the shelf offers the first book to continue',
              await pg.inner_text('.resume-title') == 'A Cup of Moonlight')
        check('the return button explains where it leads',
              'chapter you last visited' in await pg.inner_text('.resume-hint'))

        # Saved fixtures give one book an older opening but newer writing,
        # and an archived book the newest date of all. The chosen chapter
        # has real words so the displayed counts describe the actual book.
        fixture = await pg.evaluate("""async (firstId) => {
          const s = await import('/js/store.js');
          const shape = await import('/js/novel/shape.js');
          const { countWords } = await import('/js/util.js');
          const at = Date.now();
          await s.open('novel', firstId);
          s.change('novel', firstId, n => Object.assign(n.meta, {
            created: at - 90000, written: at - 50000, opened: at - 30000
          }));
          await s.flush('novel', firstId);
          const { novel: n, chapter: first } = shape.newNovel({ title: 'The Letters Beneath the Floorboards' });
          first.name = 'A Knock at Dusk';
          const next = shape.newChapter(n.id);
          next.name = 'The Window Opens';
          const words = 'A small brass key waited beside the open window.';
          next.passages.push(shape.newPassage('you', words));
          n.order.push(next.id); n.prefs.at = next.id;
          Object.assign(n.meta, { created: at - 80000, written: at - 10000,
            opened: at - 40000, words: countWords(words), chapters: 2 });
          await s.create('chapter', first.id, first);
          await s.create('chapter', next.id, next);
          await s.create('novel', n.id, n);
          const title = 'The Little Library of ' + 'Extraordinarily'.repeat(8) + ' Stories';
          const { novel: old, chapter: oc } = shape.newNovel({ title });
          Object.assign(old.meta, { archived: true, created: at - 70000,
            written: at - 1000, opened: at - 1000 });
          await s.create('chapter', oc.id, oc);
          await s.create('novel', old.id, old);
          await (await import('/js/ui/shelf.js')).refresh();
          return { recent: n.id, chapter: next.id, words: n.meta.words, archived: old.id, longTitle: title };
        }""", first_id)
        check('Continue chooses recent writing among active books, even when an archived book is newer',
              await pg.inner_text('.resume-title') == 'The Letters Beneath the Floorboards')
        check('the return card uses the saved word and chapter counts',
              await pg.inner_text('.resume-meta') == f"{fixture['words']} words · 2 chapters")
        check('the active count excludes the archive', await pg.inner_text('#shelfCount') == '2 books')
        await pg.locator('#shelfResume button').focus()
        same_button = await pg.evaluate("""async (id) => {
          const before = document.activeElement;
          const store = await import('/js/store.js');
          const shape = await import('/js/novel/shape.js');
          const novel = await store.open('novel', id);
          await store.open('chapter', novel.prefs.at);
          store.change('chapter', novel.prefs.at, c => c.passages.push(shape.newPassage('you', 'Home.')));
          store.change('novel', id, n => { n.meta.words += 1; });
          await store.flush();
          await (await import('/js/ui/shelf.js')).refresh();
          return before === document.querySelector('#shelfResume button') && before === document.activeElement;
        }""", fixture['recent'])
        check('a saved word count updates the return card without replacing its focused button',
              same_button and await pg.inner_text('.resume-meta') == f"{fixture['words'] + 1} words · 2 chapters")
        await pg.click('#shelfResume button')
        await pg.wait_for_selector('#desk:not([hidden])')
        await pg.wait_for_function("document.querySelector('#chapname').textContent === 'The Window Opens'")
        check('Continue opens the last visited chapter, rather than starting the book again',
              await pg.text_content('#chapnum') == 'Chapter Two' and
              fixture['recent'] in await pg.evaluate('location.hash'))
        await shelf(pg)

        # Opening a different book is also a reason to offer it next time.
        await pg.locator('#books button.cover[aria-label="Open A Cup of Moonlight"]').click()
        await pg.wait_for_selector('#desk:not([hidden])')
        await shelf(pg)
        check('a later opening becomes the next invitation to write',
              await pg.inner_text('.resume-title') == 'A Cup of Moonlight')

        await search(pg, 'Floorboards')
        check('search returns the matching book and an accurate filtered count',
              await covers(pg) == ['The Letters Beneath the Floorboards'] and
              await pg.inner_text('#shelfCount') == '1 of 2 books')
        check('a filtered shelf keeps its attention on the results',
              not await pg.locator('#shelfResume').is_visible() and
              await pg.locator('#books .book.new').count() == 0)
        await search(pg, 'No such tale anywhere')
        check('an unmatched search has a clear empty state and no blank new-book card',
              await pg.locator('#books .book').count() == 0 and
              await pg.locator('#books .search-empty').is_visible() and
              await pg.inner_text('#shelfCount') == '0 of 2 books')
        await pg.get_by_role('button', name='Clear search', exact=True).click()
        check('Clear search restores the shelf and leaves the search ready to type',
              await pg.input_value('#search') == '' and len(await covers(pg)) == 2 and
              await pg.evaluate("document.activeElement.id === 'search'"))

        await pg.locator('#shelfFoot button').filter(has_text='Archived (1)').click()
        check('the archive identifies and counts only its own books',
              await pg.inner_text('#shelfCollectionTitle') == 'Archived books' and
              await pg.inner_text('#shelfCount') == '1 book' and
              await covers(pg) == [fixture['longTitle']] and
              not await pg.locator('#shelfResume').is_visible())
        await search(pg, 'Floorboards')
        check('an archive search explains that the archive has no match',
              'No archived book matches' in await pg.inner_text('#books') and
              await pg.inner_text('#shelfCount') == '0 of 1 book')
        await pg.get_by_role('button', name='Clear search', exact=True).click()
        await pg.locator('#books .book .more').click()
        await archive_action(pg, 'Bring it back from the archive')
        await pg.wait_for_function("document.querySelector('#shelfCount').textContent === '0 books'")
        check('bringing the last archived book back leaves an honest empty archive',
              'Nothing archived.' in await pg.inner_text('#books') and
              not await pg.locator('#shelfResume').is_visible())
        await pg.get_by_role('button', name='Back to the shelf', exact=True).click()

        await search(pg, 'A Cup')
        await pg.locator('#books .book .more').click()
        await archive_action(pg, 'Archive it')
        await pg.wait_for_function("document.querySelector('#shelfCount').textContent === '0 of 2 books'")
        check('a search remains visible and intact when its book leaves the shelf',
              await pg.input_value('#search') == 'A Cup' and
              await pg.locator('#search').is_visible() and
              await pg.locator('#books .search-empty').is_visible())
        await pg.get_by_role('button', name='Clear search', exact=True).click()

        # A failed refresh may leave the last good list visible, but it must
        # not pretend an unavailable book is ready to continue.
        async def unavailable(route):
            await route.fulfill(status=503, content_type='application/json', body='{}')
        await pg.route('**/api/novels', unavailable)
        await pg.evaluate("import('/js/ui/shelf.js').then(s => s.refresh())")
        check('an unavailable refresh withdraws the return invitation',
              not await pg.locator('#shelfResume').is_visible())
        await pg.unroute('**/api/novels', unavailable)
        await pg.evaluate("import('/js/ui/shelf.js').then(s => s.refresh())")
        check('the return invitation recovers after the shelf can be read',
              await pg.locator('#shelfResume').is_visible())

        # Give the long title the most recent real opening and inspect the
        # displayed cover, invitation, and controls at narrow phone sizes.
        await pg.locator('#books button.cover').filter(has=pg.locator('.t', has_text=fixture['longTitle'])).click()
        await pg.wait_for_selector('#desk:not([hidden])')
        await shelf(pg)
        for width in (320, 360, 412):
            await pg.set_viewport_size({'width': width, 'height': 850})
            await pg.wait_for_timeout(150)
            fit = await pg.evaluate("""() => {
              const w = document.documentElement.clientWidth;
              const nodes = [...document.querySelectorAll('#books .cover, #books .more, #search, .resume-card, .resume-title')];
              return { overflow: document.documentElement.scrollWidth - w,
                outside: nodes.filter(n => { const r = n.getBoundingClientRect(); return r.left < -1 || r.right > w + 1; }).map(n => n.className),
                titleOverflow: [...document.querySelectorAll('#books .t, .resume-title')].some(n => n.scrollWidth > n.clientWidth + 1),
                coverClipping: [...document.querySelectorAll('#books .cover .t, #books .cover .s, #books .cover .cover-kicker, #books .cover .cover-foot')].filter(n => {
                  const r = n.getBoundingClientRect(), c = n.closest('.cover').getBoundingClientRect();
                  return r.top < c.top - 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1 || r.right > c.right + 1;
                }).map(n => n.className) };
            }""")
            check(f'long titles, covers, and shelf controls fit a {width}px phone',
                  fit['overflow'] <= 1 and not fit['outside'] and not fit['titleOverflow'] and not fit['coverClipping'], fit)
        await pg.screenshot(path=os.path.join(SHOTS, 'cozy-shelf-phone.png'), full_page=True)

        await pg.emulate_media(reduced_motion='reduce')
        motion = await pg.evaluate("""() => {
          const nodes = [...document.querySelectorAll('.shelf-welcome, .resume-card, #books .book, #books .cover, #shelf .btn, .room')];
          return nodes.flatMap(n => [null, '::before', '::after'].map(pseudo => {
            const s = getComputedStyle(n, pseudo);
            return { name: n.className, animation: s.animationName, transition: s.transitionDuration };
          })).filter(s => s.animation !== 'none' || s.transition.split(',').some(d => parseFloat(d) !== 0));
        }""")
        check('reduced motion disables the new arrivals, cover movement, and transitions', not motion, motion)
        await pg.emulate_media(reduced_motion='no-preference')

        # Hold the first save open. Enter remains usable in the title box
        # while the action button is disabled, so pressing it repeatedly
        # must still create only one book and one first chapter.
        before = await pg.evaluate("fetch('/api/novels').then(r => r.json()).then(x => x.novels.length)")
        started, release = asyncio.Event(), asyncio.Event()
        creations = []

        async def slow_creation(route):
            if route.request.method == 'PUT' and route.request.headers.get('x-base') == '0':
                creations.append(route.request.url)
                started.set()
                await release.wait()
            await route.continue_()

        await pg.route('**/api/store/chapter/*', slow_creation)
        try:
            await pg.get_by_role('button', name='Begin a new book', exact=True).click()
            title = pg.locator('.sheet input[placeholder="A working title"]')
            await title.fill('Only One Beginning')
            await title.dispatch_event('keydown', {'key': 'Enter', 'isComposing': True})
            await pg.wait_for_timeout(150)
            check('Enter that finishes a composed character does not begin the book',
                  not started.is_set() and await title.is_visible() and
                  not await pg.get_by_role('button', name='Open the book', exact=True).is_disabled())
            await title.press('Enter')
            await asyncio.wait_for(started.wait(), timeout=5)
            for _ in range(5):
                await title.press('Enter')
            check('the creation action stays disabled while the first save is on its way',
                  await pg.get_by_role('button', name='Open the book', exact=True).is_disabled())
        finally:
            release.set()
        await pg.wait_for_selector('#desk:not([hidden])')
        await pg.unroute('**/api/store/chapter/*', slow_creation)
        after = await pg.evaluate("fetch('/api/novels').then(r => r.json()).then(x => x.novels)")
        matches = [r for r in after if r.get('meta', {}).get('title') == 'Only One Beginning']
        check('repeated Enter creates exactly one book and one first chapter',
              len(after) == before + 1 and len(matches) == 1 and len(set(creations)) == 1,
              {'before': before, 'after': len(after), 'matching': len(matches), 'chapters': len(set(creations))})
        check('the new book opens normally after the delayed save',
              await pg.inner_text('#bookTitle b') == 'Only One Beginning' and
              await pg.text_content('#chapnum') == 'Chapter One')
        errors = [line for line in logs if line.startswith('PAGEERROR')]
        check('the writing-room walk has no page errors', not errors, errors)
    finally:
        await pg.context.close()


async def main():
    with Env():
        async with async_playwright() as p:
            b = await p.chromium.launch()
            try:
                print(scenario_room.__doc__, flush=True)
                await scenario_room(b)
            except Exception:
                traceback.print_exc()
                check('the writing-room scenario ran to the end', False, traceback.format_exc()[-500:])
            finally:
                await b.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\nbrowser (cozy): {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    print(f'Screenshots: {SHOTS}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    asyncio.run(main())
