"""More of the app in a real browser: Back through menus and sheets, writing
from the middle, scene breaks, a chapter split off, thinking, full screen,
the scroller and passage numbers, the partner's changes, Automatic, the
settings' defaults, bringing a book in, the look kept on the device,
chapters removed and brought back, the server stopping and starting under
an open page."""
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
    # Connections… opens on the connections, even when he folded them before
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if await pg.locator('.sheet .group[data-key="set.connections"]:not(.fold)').count():
        await pg.click('.sheet .group button.ghead:has-text("Connections")')
    await close_sheet(pg)
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections…")')
    await pg.wait_for_selector('.sheet.on')
    check('Connections… opens the connections even after they were folded', await pg.locator('.sheet .group[data-key="set.connections"]:not(.fold)').count() == 1, '')
    await close_sheet(pg)
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

async def scenario_windows(b):
    """six windows side by side: one holds the news line for all of them"""
    import uuid
    ctx = await b.new_context(viewport={'width': 800, 'height': 700})
    pages = []
    for i in range(6):
        pg = await ctx.new_page()
        await pg.goto(f'http://127.0.0.1:{PORT}/')
        await pg.wait_for_selector('#shelf:not([hidden])', timeout=8000)
        pages.append(pg)
    await pages[0].wait_for_timeout(800)
    took = await pages[0].evaluate("""async () => { const t = performance.now(); const c = new AbortController(); setTimeout(() => c.abort(), 8000);
      try { await (await fetch('/api/store/house/house', { signal: c.signal })).json(); return Math.round(performance.now() - t); } catch (e) { return -1; } }""")
    check('with six windows open a window still saves and reads at once', 0 <= took < 2000, took)
    def new_book(title):
        nid = 'n-' + uuid.uuid4().hex[:10]
        body = json.dumps({'data': {'id': nid, 'meta': {'title': title, 'subtitle': '', 'cover': 'ember', 'words': 0, 'chapters': 1, 'created': int(time.time() * 1000), 'written': int(time.time() * 1000), 'opened': 0, 'archived': False},
            'brief': '', 'style': '', 'plans': '', 'order': [], 'notes': {'people': [], 'places': [], 'lore': [], 'threads': []}, 'memory': {'seen': {}, 'removed': [], 'undo': None, 'at': 0}, 'prefs': {}, 'plays': []}}).encode()
        rq = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/store/novel/{nid}', data=body, method='PUT', headers={'Content-Type': 'application/json', 'X-Base': '0', 'X-Client': 'another-device'})
        urllib.request.urlopen(rq).read()
    async def everyone_sees(title, pgs):
        for pg in pgs:
            await pg.wait_for_function(f"document.querySelector('#books').textContent.includes({json.dumps(title)})", timeout=8000)
    new_book('Seen By All Six')
    try:
        await everyone_sees('Seen By All Six', pages)
        check('a book made elsewhere appears in all six windows by itself', True)
    except Exception as e:
        check('a book made elsewhere appears in all six windows by itself', False, e)
    lines = await pages[0].evaluate("navigator.locks.query().then((q) => (q.held || []).filter((l) => l.name === 'cozynovel-news').length)")
    check('one window holds the news line for all six', lines == 1, lines)
    await pages[0].close()
    await pages[1].wait_for_timeout(1200)
    new_book('After The First Window Closed')
    try:
        await everyone_sees('After The First Window Closed', pages[1:])
        check('when a window closes, the others still hear the news', True)
    except Exception as e:
        check('when a window closes, the others still hear the news', False, e)
    lines = await pages[1].evaluate("navigator.locks.query().then((q) => (q.held || []).filter((l) => l.name === 'cozynovel-news').length)")
    check('and exactly one window holds the line', lines == 1, lines)
    await ctx.close()

async def scenario_round(b):
    """full screen, the scroller and passage numbers, the scene's thinking, the partner's changes, Automatic, the settings with defaults"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Round')
    await add_conn(pg)
    # the models on offer sit in a box like every other box (no white block)
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections…")')
    await pg.wait_for_selector('.sheet.on')
    await pg.click('.sheet.on button:has-text("Show the models on offer")')
    await pg.wait_for_selector('.sheet.on select[aria-label="Pick a model"]', state='visible', timeout=5000)
    look = await pg.evaluate("(() => { const s = document.querySelector('.sheet.on select[aria-label=\"Pick a model\"]'); const c = getComputedStyle(s); return { inField: Boolean(s.closest('label.field')), bg: c.backgroundColor, radius: c.borderRadius } })()")
    check('the models on offer: a box like the others, never a white block', look['inField'] and look['bg'] != 'rgb(255, 255, 255)' and look['radius'] == '12px', look)
    # Your instructions: the narrator's own box, with its starting words and Back to the default
    await pg.click('.sheet.on .ghead:has-text("Your instructions")')
    await pg.wait_for_timeout(200)
    narr = pg.locator('.sheet.on label.field:has(span:text-is("How the narrator tells scenes")) textarea')
    check('a box for the narrator, with its starting words', (await narr.count()) == 1 and 'You tell the scene the way the book itself is told' in await narr.input_value())
    await narr.fill('MY NARRATOR.')
    await pg.wait_for_timeout(700)
    await pg.locator('.sheet.on label.field:has(span:text-is("How the narrator tells scenes")) + .btnrow button:has-text("Back to the default")').click()
    await pg.wait_for_function("document.querySelectorAll('.sheet.on').length === 2", timeout=3000)
    await pg.locator('.sheet.on >> nth=-1').locator('button:has-text("Back to the default")').click()
    await pg.wait_for_timeout(700)
    check('Back to the default puts the starting words back', 'You tell the scene the way the book itself is told' in await narr.input_value(), await narr.input_value())
    house = await pg.evaluate("fetch('/api/store/house/house').then(r => r.json()).then(j => j.data)")
    check('…and they are what the phone keeps', 'You tell the scene the way the book itself is told' in (house.get('instructions') or {}).get('narrator', ''), (house.get('instructions') or {}).get('narrator', '')[:60])
    check('where the book and its notes ride can be chosen', await pg.locator('.sheet.on label.field:has(span:text-is("The book and its notes ride as")) select').count() == 1)
    check('and whether the partner\'s changes wait', await pg.locator('.sheet.on label.field:has(span:text-is("Your partner’s changes land")) select').count() == 1)
    await close_sheet(pg)
    # a chapter long enough to scroll: passage numbers and the scroller
    for i in range(4):
        await write(pg, f'Part {i + 1}.')
    await pg.click('#passages .passage >> nth=0')
    await pg.wait_for_timeout(200)
    line = await pg.inner_text('#passages .passage.selected .pctl .note')
    check('a passage says its number on the page', line.startswith('Passage 1 ·') and 'tokens sent' in line and 'My connection' not in line, line)
    await pg.evaluate("document.querySelector('#pageWrap').scrollTop = 0")
    await pg.wait_for_timeout(300)
    vis = await pg.evaluate("!document.querySelector('#scroller').hidden")
    first = await pg.inner_text('#scroller .thumb') if vis else ''
    check('the scroller stands at the page\'s edge with the passage under the eye', vis and first.strip() == '1', (vis, first))
    box = await pg.locator('#scroller .thumb').bounding_box()
    track = await pg.locator('#scroller').bounding_box()
    await pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    await pg.mouse.down()
    await pg.mouse.move(box['x'] + box['width'] / 2, track['y'] + track['height'] - 4, steps=6)
    tip = await pg.inner_text('#scroller .tip')
    await pg.mouse.up()
    await pg.wait_for_timeout(300)
    top = await pg.evaluate("(() => { const w = document.querySelector('#pageWrap'); return [w.scrollTop, w.scrollHeight - w.clientHeight] })()")
    last = await pg.inner_text('#scroller .thumb')
    check('dragging it moves through the chapter, and says which passage of how many', top[0] > top[1] * 0.9 and tip.startswith('Passage ') and ' of 4' in tip and last.strip() in ('3', '4'), (top, tip, last))
    # full screen on the page: the bars go, Back brings them back, a new chapter keeps it
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Full screen")')
    await pg.wait_for_timeout(300)
    bar = await pg.evaluate("getComputedStyle(document.querySelector('.deskbar')).display")
    check('Full screen hides the bars above the page and keeps the box', bar == 'none' and await pg.locator('.composer').is_visible() and await pg.locator('.fullexit').count() == 1, bar)
    await pg.go_back(); await pg.wait_for_timeout(400)
    check('Back leaves full screen, not the book', await on_desk(pg) and await pg.evaluate("getComputedStyle(document.querySelector('.deskbar')).display") != 'none')
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Full screen")')
    await pg.wait_for_timeout(300)
    await pg.evaluate("document.querySelector('#pageWrap').scrollTop = 1e9")
    await pg.click('#pageEnd button:has-text("Chapter Two")')
    await pg.wait_for_timeout(900)
    h2 = await pg.evaluate('location.hash')
    check('a new chapter keeps the page full', await pg.evaluate("document.body.classList.contains('fullpage')") and await pg.evaluate("document.querySelector('#chapnum').textContent") == 'Chapter Two', h2)
    await pg.go_back(); await pg.wait_for_timeout(500)
    check('…and Back leaves full screen there, on the new chapter', not await pg.evaluate("document.body.classList.contains('fullpage')") and await pg.evaluate('location.hash') == h2 and await on_desk(pg))
    await pg.click('#bookTitle'); await pg.click('#chaptersBody .go >> nth=0'); await pg.wait_for_timeout(600)
    # the partner changes a passage, and Undo puts it back
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    await pg.fill('#sideFoot textarea', 'CHANGE THE PASSAGE, please.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .change.made', timeout=8000)
    card = await pg.inner_text('#sideBody .change.made')
    p1 = await pg.evaluate("(() => { const p = document.querySelector('#passages .passage .prose'); return p ? p.textContent : '' })()")
    words = await pg.inner_text('#sideBody .turn.ai >> nth=-1')
    check('the partner\'s change shows with its Undo, and the page has it', 'Chapter One, passage 1' in card and 'Rain lashed the glass' in p1 and '<changes>' not in words, (card, p1[:60], words[:120]))
    await pg.click('#sideBody .change.made button:has-text("Undo")')
    await pg.wait_for_timeout(500)
    p1 = await pg.evaluate("(() => { const p = document.querySelector('#passages .passage .prose'); return p ? p.textContent : '' })()")
    check('Undo puts the passage back', 'Rain hammered the glass' in p1 and await pg.locator('#sideBody .change.undone').count() == 1, p1[:60])
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    # a scene: the thinking streams open first, then folds; full screen over everything
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections…")')
    await pg.fill('.sheet input[placeholder="deepseek-chat"]', 'fake-thinker')
    await pg.wait_for_timeout(600)
    await pg.select_option('.sheet.on label.field:has(span:text-is("Thinking")) select', 'high')
    await pg.wait_for_timeout(600)
    await close_sheet(pg)
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Scenes")')
    await pg.wait_for_timeout(300)
    await pg.fill('#sidePane input[list="cn-people"]', 'Mara')
    await pg.fill('#sidePane input[placeholder="Right where the chapter leaves off"]', 'SLOW at the gate')
    await pg.click('#sidePane button:has-text("Begin the scene")')
    await pg.wait_for_selector('#sideBody .turn.ai .thinkbox.live', timeout=6000)
    live_label = await pg.inner_text('#sideBody .turn.ai .thinkbox.live > button')
    # a second piece of thinking has come by now: the words keep growing in the box, never wiped
    await pg.wait_for_timeout(1200)
    live_words = await pg.evaluate("(() => { const w = document.querySelector('#sideBody .turn.ai .thinkbox .words'); return w ? w.textContent : '' })()")
    check('the narrator\'s thinking streams open, first, and keeps growing', 'Thinking' in live_label and 'think about' in live_words, (live_label, live_words))
    await pg.wait_for_selector('#sideBody .turn.ai:not(.streaming)', timeout=15000)
    folded = await pg.inner_text('#sideBody .turn.ai .thinkbox > button')
    check('…and folds once its words come', 'The thinking' in folded and await pg.locator('#sideBody .turn.ai .thinkbox.live').count() == 0, folded)
    await pg.click('#sidePane button[aria-label="Full screen"]')
    await pg.wait_for_timeout(400)
    r = await pg.evaluate("(() => { const b = document.querySelector('#sidePane').getBoundingClientRect(); return [b.x, b.y, b.width, b.height, innerWidth, innerHeight] })()")
    check('a scene goes full screen', r[0] == 0 and r[1] == 0 and r[2] == r[4] and r[3] == r[5], r)
    await pg.go_back(); await pg.wait_for_timeout(400)
    check('Back leaves the scene\'s full screen and keeps the scene open', not await pg.evaluate("document.querySelector('#sidePane').classList.contains('full')") and await pg.evaluate("document.querySelector('#sidePane').classList.contains('open')"))
    await pg.go_back(); await pg.wait_for_timeout(400)
    # About this book: Manual or Automatic; Automatic keeps what the book is about
    await pg.wait_for_function("document.querySelector('#notesBtn').dataset.state === 'idle'", timeout=30000)
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_selector('.sheet.on .keptfield')
    modes = await pg.locator('.sheet.on .keptfield .segmented button[aria-pressed="true"]').all_inner_texts()
    check('What it’s about and How it reads start Automatic', modes == ['Automatic', 'Automatic'], modes)
    kept = await pg.locator('.sheet.on .keptfield >> nth=0').locator('.keptbox textarea').input_value()
    check('…with what the helper keeps of the book as it stands', 'lighthouse keeper' in kept, kept)
    await pg.locator('.sheet.on .keptfield >> nth=0').locator('.segmented button:has-text("Manual")').click()
    await pg.wait_for_timeout(300)
    check('Manual hides what the helper keeps', await pg.locator('.sheet.on .keptfield >> nth=0').locator('.keptbox').is_hidden())
    await close_sheet(pg)
    # a card in the notes has With others
    await pg.click('#notesBtn'); await pg.wait_for_timeout(300)
    await pg.click('#sideBody .notesec:has(h3:text-is("People")) .card >> nth=0')
    await pg.wait_for_selector('.sheet.on')
    check('a person\'s card keeps how they stand with the others', await pg.locator('.sheet.on label.field:has(span:text-is("With others")) textarea').count() == 1)
    await close_sheet(pg)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (this round)', not errs, errs[:5])
    await pg.close()

DRAWN_THE_SAME = r"""async () => {
  const { drawProse, growProse, sourceOffset } = await import('/js/ui/prose.js');
  const { streamLines } = await import('/js/ui/live.js');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const bits = ['The rain ', 'came in. ', '“You should ', 'have stayed,” ', 'she said. ', '\n\n', '*soft* ', '**loud** ', '\n', '* * *', '# Heading', '   ', 'end'];
  const bad = [];
  for (let run = 0; run < 40; run++) {
    const a = document.createElement('div'), b = document.createElement('div'), s1 = document.createElement('div'), s2 = document.createElement('div');
    let text = '';
    const tint = run % 2 === 0;
    for (let step = 0; step < 60; step++) {
      const r = rnd();
      if (r < 0.75) { const many = 1 + Math.floor(rnd() * 3); for (let j = 0; j < many; j++) text += bits[Math.floor(rnd() * bits.length)]; }
      else if (r < 0.85) text = text.slice(0, Math.floor(rnd() * text.length));
      else if (r < 0.95 && text.length > 4) { const i = Math.floor(rnd() * text.length); text = text.slice(0, i) + bits[Math.floor(rnd() * bits.length)] + text.slice(i); }
      else text = '';
      growProse(a, text, { tint }); drawProse(b, text, { tint });
      if (a.innerHTML !== b.innerHTML) { bad.push(['prose', run, step]); break; }
      const pa = [...a.querySelectorAll('p')], pb = [...b.querySelectorAll('p')];
      for (let i = 0; i < pa.length; i++) {
        const ta = pa[i].firstChild, tb = pb[i].firstChild;
        if (ta && tb && sourceOffset(ta, 0) !== sourceOffset(tb, 0)) { bad.push(['where it stands', run, step, i]); break; }
      }
      for (const blocks of [true, false]) {
        const box = blocks ? s1 : s2;
        streamLines(box, text, { blocks });
        const got = blocks ? [...box.childNodes].map((n) => n.textContent).join('\n') : box.textContent;
        if (got !== text) { bad.push(['lines', blocks, run, step]); break; }
      }
    }
  }
  return bad;
}"""

async def scenario_follow(b):
    """the page follows the words being written until his finger moves it up, then stays where he put it"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Follow')
    bad = await pg.evaluate(DRAWN_THE_SAME)
    check('words drawn as they arrive end exactly as the whole text drawn at once (2,400 random steps)', not bad, bad[:3])
    await add_conn(pg)
    for i in range(4):
        await pg.fill('#direction', ' '.join(['The tide turned under the lighthouse and the gulls went quiet, one by one, as if they knew.'] * 12))
        await pg.click('#mineBtn'); await pg.wait_for_timeout(150)
    reset()
    await pg.fill('#direction', 'SLOW the lamp goes out')
    await pg.click('#writeBtn')
    await pg.wait_for_function("(() => { const p = document.querySelector('.passage.streaming .prose'); return p && p.textContent.length > 120; })()", timeout=10000)
    await pg.wait_for_timeout(400)
    y0 = await pg.evaluate("document.querySelector('#pageWrap').scrollTop")
    cdp = await pg.context.new_cdp_session(pg)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 200, 'y': 300}]})
    for i in range(1, 13):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 200, 'y': 300 + 400 * i / 12}]})
        await pg.wait_for_timeout(16)
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    await pg.wait_for_timeout(500)
    y1 = await pg.evaluate("document.querySelector('#pageWrap').scrollTop")
    grew = await pg.evaluate("document.querySelector('.passage.streaming .prose').textContent.length")
    await pg.wait_for_timeout(1500)
    y2 = await pg.evaluate("document.querySelector('#pageWrap').scrollTop")
    grew2 = await pg.evaluate("(() => { const p = document.querySelector('.passage.streaming .prose'); return p ? p.textContent.length : 0; })()")
    check('a flick up while it streams moves the page up', y1 < y0 - 100, (y0, y1))
    check('…and the writing never pulls it back down', abs(y2 - y1) <= 2 and grew2 > grew, (y1, y2, grew, grew2))
    check('"Follow the writing" shows while he reads above it', await pg.locator('#followBtn:not([hidden])').count() == 1)
    await pg.click('#followBtn')
    await pg.wait_for_timeout(700)
    y3 = await pg.evaluate("document.querySelector('#pageWrap').scrollTop")
    check('…and takes him back down to the words, following again', y3 > y2 + 100 and await pg.locator('#followBtn[hidden]').count() == 1, (y2, y3))
    await idle(pg, 30000)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (follow)', not errs, errs[:5])
    await pg.close()

async def scenario_made_while_asked(b):
    """a record made while the page asks the phone what changed is kept, with every change after"""
    logs = []
    pg = await page(b, logs)
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(800)
    # the phone answers "what changed?" before the new record lands; the page hears that answer after it landed
    asked, landed = asyncio.Event(), asyncio.Event()
    async def revs(route):
        resp = await route.fetch()
        asked.set()
        await landed.wait()
        await pg.wait_for_timeout(300)
        await route.fulfill(response=resp)
    async def made(route):
        if route.request.method != 'PUT':
            await route.continue_(); return
        await asked.wait()
        resp = await route.fetch()
        await route.fulfill(response=resp)
        landed.set()
    await pg.route('**/api/revs', revs)
    await pg.route('**/api/store/draft/race-check', made)
    await pg.evaluate("""async () => { const S = await import('/js/store.js');
      S.create('draft', 'race-check', { id: 'race-check', novelId: 'race-check', direction: 'first words' }).catch(() => {});
      S.recheck(); }""")
    await asyncio.wait_for(landed.wait(), 10)
    await pg.wait_for_timeout(900)
    await pg.unroute('**/api/revs'); await pg.unroute('**/api/store/draft/race-check')
    got = await pg.evaluate("""async () => { const S = await import('/js/store.js');
      S.change('draft', 'race-check', (d) => { d.direction = 'changed after'; }, { now: true });
      await S.flush('draft', 'race-check');
      const r = await (await fetch('/api/store/draft/race-check')).json();
      return r.data && r.data.direction; }""")
    check('a change after it reaches the phone (it was not taken for deleted)', got == 'changed after', got)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (made while asked)', not errs, errs[:5])
    await pg.close()

async def main():
    import tempfile
    tmp = tempfile.mkdtemp()
    with Env() as env:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for sc in (scenario_back, scenario_middle, scenario_thinking, scenario_round, lambda b: scenario_bring_in(b, tmp), scenario_look, scenario_windows, scenario_follow, scenario_made_while_asked, lambda b: scenario_offline(b, env)):
                # ONLY=words runs just the scenarios whose description holds them
                if os.environ.get('ONLY') and os.environ['ONLY'] not in (getattr(sc, '__doc__', None) or ''):
                    continue
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
