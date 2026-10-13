"""More of the app in a real browser: Back through menus and sheets, writing
from the middle, scene breaks, a chapter split off, thinking, bringing a book
in, the look kept on the device, chapters removed and brought back, the
server stopping and starting under an open page."""
import asyncio, json, os, sys, time, traceback, subprocess, urllib.request
from harness import *

RESULTS = []
def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:300]}]'), flush=True)

def completions():
    return [x for x in reqs() if x['path'].endswith('/chat/completions')]

async def idle(pg, t=10000):
    await pg.wait_for_function("!document.querySelector('.passage.streaming') && document.querySelector('#writeBtn').textContent.trim() !== 'Stop'", timeout=t)

async def write(pg, direction, t=10000):
    await pg.fill('#direction', direction)
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(150)
    await idle(pg, t)

async def close_sheet(pg):
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_timeout(350)

async def on_desk(pg):
    return await pg.evaluate("!document.querySelector('#desk').hidden")

async def scenario_back(b):
    """Back through menus and sheets never leaves the book by surprise"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='Back and Forth')
    await add_conn(pg)
    await write(pg, 'A first page.')
    # every menu item that opens a sheet, then the sheet closed by its X
    for item in ('About this book', 'Settings'):
        await pg.click('#moreBtn'); await pg.click(f'.menu-pop button:has-text("{item}")')
        await pg.wait_for_selector('.sheet.on', timeout=3000)
        await close_sheet(pg)
        await pg.wait_for_timeout(300)
        check(f'More → {item} → close keeps the book open', await on_desk(pg), await pg.evaluate('location.hash'))
    # the same with the phone's Back
    for item in ('About this book', 'Settings'):
        await pg.click('#moreBtn'); await pg.click(f'.menu-pop button:has-text("{item}")')
        await pg.wait_for_selector('.sheet.on', timeout=3000)
        await pg.go_back(); await pg.wait_for_timeout(400)
        check(f'More → {item} → Back closes only the sheet', await on_desk(pg) and await pg.locator('.sheet.on').count() == 0, (await on_desk(pg), await pg.locator('.sheet.on').count()))
    # a sheet over a sheet, closed by Back twice
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections…")')
    await pg.wait_for_selector('.sheet.on')
    await pg.click('.sheet.on button.btn.danger:has-text("Remove")')
    await pg.wait_for_timeout(300)
    check('a question opens over the settings', await pg.locator('.sheet.on').count() == 2, await pg.locator('.sheet.on').count())
    await pg.go_back(); await pg.wait_for_timeout(400)
    check('Back answers the question “Not now”', await pg.locator('.sheet.on').count() == 1, await pg.locator('.sheet.on').count())
    await pg.go_back(); await pg.wait_for_timeout(400)
    check('and Back again closes the settings, still in the book', await pg.locator('.sheet.on').count() == 0 and await on_desk(pg), '')
    hs = await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())")
    check('the connection was not removed', len(hs['data']['connections']) == 1, len(hs['data']['connections']))
    # a passage menu then a drawer
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.go_back(); await pg.wait_for_timeout(300)
    check('Back closes a menu and nothing else', await pg.locator('.menu-pop').count() == 0 and await on_desk(pg), '')
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    await pg.click('#chaptersBody li button.menu')
    await pg.click('.menu-pop button:has-text("Name it")')
    await pg.fill('.sheet.on input', 'Back Again')
    await pg.click('.sheet.on button:has-text("Name it")')
    await pg.wait_for_timeout(400)
    check('a chapter named from the chapters list', await pg.text_content('#chapname') == 'Back Again', await pg.text_content('#chapname'))
    check('the drawer is still open after the name sheet', await pg.locator('#chaptersPane.open').count() == 1, '')
    await pg.go_back(); await pg.wait_for_timeout(400)
    check('Back closes the drawer', await pg.locator('#chaptersPane.open').count() == 0 and await on_desk(pg), '')
    await pg.go_back(); await pg.wait_for_timeout(600)
    check('and Back from the page goes to the shelf', await pg.evaluate("!document.querySelector('#shelf').hidden"), await pg.evaluate('location.hash'))
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (Back)', not errs, errs[:5])
    await pg.close()

async def scenario_middle(b):
    """writing from the middle, scene breaks, a chapter split off"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='Middles')
    await add_conn(pg)
    for words in ('First, the harbour.', 'Second, the hill.', 'Third, the house.'):
        await pg.fill('#direction', words); await pg.click('#mineBtn'); await pg.wait_for_timeout(250)
    first = pg.locator('#passages .passage').nth(0)
    await first.click()
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Write from here")')
    what = await pg.inner_text('#selWhat')
    check('Write from here says where the passage will go', 'First, the harbour.' in what, what)
    await write(pg, 'Between the harbour and the hill.')
    texts = await pg.locator('#passages .passage .prose').all_inner_texts()
    check('the new passage goes after the one he chose', len(texts) == 4 and 'Between the harbour' in texts[1] and texts[2].startswith('Second'), [t[:30] for t in texts])
    # a scene break after the second passage
    await pg.locator('#passages .passage').nth(1).click()
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Add a scene break after this")')
    await pg.wait_for_timeout(300)
    breaks = await pg.locator('#passages .passage.break').count()
    check('a scene break sits on the page', breaks == 1, breaks)
    # a new chapter from the fourth passage
    await pg.locator('#passages .passage:not(.break)').nth(3).click()
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Start a new chapter from here")')
    await pg.click('.sheet.on button:has-text("Start the new chapter")')
    await pg.wait_for_function("document.querySelector('#chapnum').textContent === 'Chapter Two'", timeout=5000)
    two = await pg.locator('#passages .passage .prose').all_inner_texts()
    check('a new chapter from here carries the rest', len(two) == 1 and two[0].startswith('Third'), two)
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    await pg.locator('#chaptersBody li').nth(0).locator('button.go').click()
    await pg.wait_for_function("document.querySelector('#chapnum').textContent === 'Chapter One'", timeout=5000)
    one = await pg.locator('#passages .passage').count()
    check('and the first chapter keeps what came before', one == 4, one)
    # the helper is told nothing new about the passages that moved
    await pg.wait_for_function("document.querySelector('#notesBtn').dataset.state === 'idle'", timeout=30000)
    reset()
    await pg.wait_for_timeout(5000)
    notes_calls = [x for x in completions() if 'Update the notes' in x['body']['messages'][-1]['content']]
    check('moving passages to a new chapter is not read again', not notes_calls, len(notes_calls))
    # remove chapter two and bring it back
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    await pg.locator('#chaptersBody li').nth(1).locator('button.menu').click()
    await pg.click('.menu-pop button:has-text("Remove the chapter")')
    await pg.click('.sheet.on button:has-text("Remove it")')
    await pg.wait_for_timeout(800)
    n = await pg.evaluate("fetch(location.origin + '/api/store/novel/' + location.hash.split('/')[2]).then((r) => r.json()).then((j) => j.data.order.length)")
    check('a chapter can be removed', n == 1, n)
    trash = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/trash'))['trash']
    item = [t for t in trash if t['kind'] == 'chapter']
    check('it waits in Recently deleted', len(item) == 1, trash)
    if item:
        req = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/trash/{item[0]["name"]}/restore', data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req).read()
        await pg.wait_for_timeout(1500)
        await pg.click('#bookTitle') if await pg.locator('#chaptersPane.open').count() == 0 else None
        await pg.wait_for_timeout(300)
        chs = await pg.text_content('#chaptersBody')
        check('brought back, it is at the end of its book, live on the open page', 'Chapter Two' in chs and 'Third' in chs, chs[:300])
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (middle)', not errs, errs[:5])
    await pg.close()

async def scenario_thinking(b):
    """a model that thinks"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='Thoughts')
    await add_conn(pg)
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections…")')
    await pg.fill('.sheet input[placeholder="deepseek-chat"]', 'fake-thinker')
    await pg.wait_for_timeout(600)
    await pg.select_option('.sheet.on label.field:has(span:text-is("Thinking")) select', 'high')
    await pg.wait_for_timeout(600)
    await close_sheet(pg)
    reset()
    await write(pg, 'A thoughtful page.')
    body = completions()[-1]['body']
    check('the thinking level he chose is sent', body.get('reasoning_effort') == 'high' or (isinstance(body.get('thinking'), dict)), {k: body.get(k) for k in ('reasoning_effort', 'thinking')})
    box = await pg.locator('.passage.selected .thinkbox').count()
    label = await pg.inner_text('.passage.selected .thinkbox > button') if box else ''
    check('the thinking is kept beside the passage, folded', box == 1 and 'The thinking' in label, label)
    await pg.click('.passage.selected .thinkbox > button')
    await pg.wait_for_timeout(200)
    words = await pg.inner_text('.passage.selected .thinkbox .words')
    check('and opens to show it', 'think about the scene' in words, words)
    check('the passage itself holds no thinking', 'think about' not in await pg.inner_text('.passage.selected .prose'), '')
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (thinking)', not errs, errs[:5])
    await pg.close()

async def scenario_bring_in(b, tmp):
    """a book brought in from a text file"""
    logs = []
    pg = await page(b, logs)
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *', timeout=8000)
    path = os.path.join(tmp, 'The Salt Road.md')
    with open(path, 'w') as f:
        f.write('# The Salt Road\n\n## Chapter 1: Departure\n\nThey left at dawn.\n\n"Keep up," said Ines.\n\n## Chapter 2: The Pass\n\nSnow on the pass.\n\n***\n\nNight fell.\n')
    async with pg.expect_file_chooser() as fc:
        await pg.click('#shelfFoot button:has-text("Bring in a book")')
    await (await fc.value).set_files(path)
    await pg.wait_for_timeout(1200)
    check('a text file comes onto the shelf', 'The Salt Road' in await pg.inner_text('#books'), await pg.inner_text('#books'))
    await pg.click('button.cover:has-text("The Salt Road")')
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    chs = await pg.text_content('#chaptersBody')
    check('its chapters and their names come with it', 'Departure' in chs and 'The Pass' in chs, chs[:300])
    await pg.locator('#chaptersBody li').nth(1).locator('button.go').click()
    await pg.wait_for_timeout(600)
    check('a *** becomes a scene break', await pg.locator('#passages .passage.break').count() == 1, await pg.locator('#passages .passage.break').count())
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (bring in)', not errs, errs[:5])
    await pg.close()

async def scenario_look(b):
    """the look is kept on the device: the same in every browser"""
    logs = []
    pg = await page(b, logs)
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])', timeout=8000)
    await pg.click('#shelfSettings')
    await pg.click('.sheet .group button.ghead:has-text("How it looks")')
    await pg.click('.sheet button.swatch:has-text("Candlelight")')
    await pg.wait_for_timeout(200)
    check('a room is chosen at once', await pg.evaluate("document.documentElement.dataset.theme") == 'candle', '')
    await pg.wait_for_timeout(900)
    other = await b.new_context(viewport={'width': 1280, 'height': 800})
    pg2 = await other.new_page()
    await pg2.goto(f'http://127.0.0.1:{PORT}/')
    await pg2.wait_for_selector('#shelf:not([hidden])', timeout=8000)
    await pg2.wait_for_timeout(500)
    check('another browser opens in the same room', await pg2.evaluate("document.documentElement.dataset.theme") == 'candle', await pg2.evaluate("document.documentElement.dataset.theme"))
    await pg.click('.sheet button.swatch:has-text("Daylight")')
    await pg.wait_for_timeout(2500)
    check('and follows a change made in the first, by itself', await pg2.evaluate("document.documentElement.dataset.theme") == 'day', await pg2.evaluate("document.documentElement.dataset.theme"))
    await pg.click('.sheet button.swatch:has-text("The study at night")')
    await pg.wait_for_timeout(900)
    await other.close()
    await pg.close()

async def scenario_offline(b, env):
    """the server stops under an open page, then comes back"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='Power Cut')
    await pg.wait_for_timeout(500)
    env.srv.terminate(); env.srv.wait()
    await pg.fill('#direction', 'Typed while the server was away.')
    await pg.click('#mineBtn')
    try:
        await pg.wait_for_selector('#banner:not([hidden])', timeout=20000)
        check('the page says the server is not answering', 'not answering' in await pg.inner_text('#banner'), '')
    except Exception as e:
        check('the page says the server is not answering', False, e)
    env.srv = subprocess.Popen([sys.executable, APP + '/serve.py'], env=dict(os.environ, COZYNOVEL_HOME=env.home, COZYNOVEL_PORT=str(PORT)), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        await pg.wait_for_selector('#banner[hidden]', state='attached', timeout=30000)
        check('and the banner goes when it is back', True)
    except Exception as e:
        check('and the banner goes when it is back', False, e)
    await pg.wait_for_timeout(2500)
    hashid = (await pg.evaluate('location.hash')).split('/')[2]
    nov = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/store/novel/{hashid}'))['data']
    ch = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/store/chapter/{nov["order"][0]}'))['data']
    texts = [v['text'] for p in ch['passages'] for v in p['versions']]
    check('what he wrote meanwhile is saved once it answers', any('server was away' in t for t in texts), texts)
    await pg.close()

async def main():
    import tempfile
    tmp = tempfile.mkdtemp()
    with Env() as env:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for sc in (scenario_back, scenario_middle, scenario_thinking, lambda b: scenario_bring_in(b, tmp), scenario_look, lambda b: scenario_offline(b, env)):
                print(getattr(sc, '__doc__', None) or 'scenario')
                try:
                    await sc(b)
                except Exception:
                    traceback.print_exc()
                    check('scenario ran to the end', False, traceback.format_exc()[-400:])
            await b.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\nbrowser (more): {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)

asyncio.run(main())
