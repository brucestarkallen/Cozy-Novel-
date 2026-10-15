"""A download contains the whole book, or explains why no file was made.

Temporary records, the real server and browser, and no model calls.
"""
import asyncio
import os
from pathlib import Path
import sys
import traceback
import zipfile

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '22581'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '22599'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok)))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:300]}]'), flush=True)


async def scenario_exports(browser):
    logs, downloads = [], []
    pg = await H.page(browser, logs)
    pg.on('download', lambda item: downloads.append(item))
    await H.new_book(pg, title='Every Chapter Comes Along')
    first = 'The lantern glowed beside the kettle.'
    second = 'Mara returned before dawn with the letter.'
    await pg.fill('#direction', first)
    await pg.click('#mineBtn')
    await pg.wait_for_selector('#passages .prose')
    await pg.evaluate("""async () => {
      const s = await import('/js/store.js');
      const id = location.hash.split('/')[2];
      s.change('novel', id, n => { n.order.push('chapter-export-missing'); });
      await s.flush();
    }""")
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("About this book")')
    await pg.locator('.group[data-key="book.export"] .ghead').click()
    formats = [('Plain text', 'txt'), ('Markdown', 'md'), ('Printable book', 'html'), ('E-book (EPUB)', 'epub')]
    for label, kind in formats:
        await pg.get_by_role('button', name=label, exact=True).click()
        await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('no file was made')")
        await pg.wait_for_timeout(100)
        check(f'{kind} refuses a book with a missing chapter and explains recovery', not downloads and 'Backups' in await pg.locator('#toast').inner_text(), len(downloads))

    await pg.evaluate("""async (words) => {
      const s = await import('/js/store.js');
      const id = location.hash.split('/')[2];
      await s.create('chapter', 'chapter-export-missing', {
        id: 'chapter-export-missing', novelId: id, name: 'The Return',
        passages: [{id: 'p-export-second', by: 'you', pick: 'v-export-second', versions: [{id:'v-export-second', text:words, at:Date.now()}]}]
      });
    }""", second)
    for label, kind in formats:
        async with pg.expect_download() as received:
            await pg.get_by_role('button', name=label, exact=True).click()
        download = await received.value
        path = await download.path()
        if kind == 'epub':
            with zipfile.ZipFile(path) as archive:
                content = '\n'.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.xhtml'))
        else:
            content = Path(path).read_text()
        check(f'{kind} succeeds after the chapter returns and includes both chapters in order', first in content and second in content and content.index(first) < content.index(second), content[:150])

    failed_reads = []

    async def refuse_chapter(route):
        failed_reads.append(route.request.url)
        await route.fulfill(status=503, json={'error': 'temporarily unavailable'})

    await pg.route('**/api/store/chapter/chapter-export-unread', refuse_chapter)
    await pg.evaluate("""async () => {
      const s = await import('/js/store.js');
      s.change('novel', location.hash.split('/')[2], n => { n.order.push('chapter-export-unread'); });
    }""")
    before = len(downloads)
    await pg.get_by_role('button', name='Plain text', exact=True).click()
    await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('no file was made')")
    await pg.wait_for_timeout(100)
    check('a chapter read failure produces a helpful message and no partial download', bool(failed_reads) and len(downloads) == before)
    check('failed exports leave the title and writing available', await pg.get_by_role('textbox', name='Title', exact=True).input_value() == 'Every Chapter Comes Along' and first in await pg.locator('#passages').inner_text())
    check('exports make no model calls', not H.reqs())
    check('missing and unread chapters produce no unhandled browser errors', not [line for line in logs if line.startswith('PAGEERROR')], logs)
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as pw:
            options = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await pw.chromium.launch(**options)
            try:
                await scenario_exports(browser)
            except Exception:
                traceback.print_exc()
                check('export scenario ran to the end', False, traceback.format_exc()[-600:])
            await browser.close()
    bad = [row for row in RESULTS if not row[1]]
    print(f'\nexports: {len(RESULTS)-len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    asyncio.run(main())
