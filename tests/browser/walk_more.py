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

def checking(x):
    # the checker reads finished passages in the background: its requests are its own
    return any('Check these passages from' in (m.get('content') or '') for m in (x['body'].get('messages') or []) if isinstance(m.get('content'), str))

def completions():
    return [x for x in reqs() if x['path'].endswith('/chat/completions') and not checking(x)]

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
    await pg.click('.sheet.on button.btn.danger:has-text("Let go")')
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
    await pg.fill('.sheet label.field:has(> span:text-is("Model")) input', 'fake-thinker')
    await pg.wait_for_timeout(600)
    await pg.select_option('.sheet.on label.field:has(span:text-is("Thinking — how long the writer weighs the page before writing")) select', 'high')
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
    await pg.click('.sheet.on button:has-text("Fetch what’s on offer")')
    await pg.wait_for_selector('.sheet.on select[aria-label="What’s on offer"]', state='visible', timeout=5000)
    look = await pg.evaluate("(() => { const s = document.querySelector('.sheet.on select[aria-label=\"What’s on offer\"]'); const c = getComputedStyle(s); return { inField: Boolean(s.closest('label.field')), bg: c.backgroundColor, radius: c.borderRadius } })()")
    check('the models on offer: a box like the others, never a white block', look['inField'] and look['bg'] != 'rgb(255, 255, 255)' and look['radius'] == '12px', look)
    # Your instructions: the narrator's own box, with its starting words (2.3: his preset's own opening) and Back to the default
    await pg.click('.sheet.on .ghead:has-text("Your instructions")')
    await pg.wait_for_timeout(200)
    narr = pg.locator('.sheet.on label.field:has(span:text-is("How the narrator tells scenes")) textarea')
    check('a box for the narrator, with its starting words', (await narr.count()) == 1 and 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.' in await narr.input_value())
    await narr.fill('MY NARRATOR.')
    await pg.wait_for_timeout(700)
    await pg.locator('.sheet.on label.field:has(span:text-is("How the narrator tells scenes")) + .btnrow button:has-text("Back to the default")').click()
    await pg.wait_for_function("document.querySelectorAll('.sheet.on').length === 2", timeout=3000)
    await pg.locator('.sheet.on >> nth=-1').locator('button:has-text("Back to the default")').click()
    await pg.wait_for_timeout(700)
    check('Back to the default puts the starting words back', 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.' in await narr.input_value(), await narr.input_value())
    house = await pg.evaluate("fetch('/api/store/house/house').then(r => r.json()).then(j => j.data)")
    check('…and they are what the phone keeps', 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.' in (house.get('instructions') or {}).get('narrator', ''), (house.get('instructions') or {}).get('narrator', '')[:60])
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
    await pg.fill('.sheet label.field:has(> span:text-is("Model")) input', 'fake-thinker')
    await pg.wait_for_timeout(600)
    await pg.select_option('.sheet.on label.field:has(span:text-is("Thinking — how long the writer weighs the page before writing")) select', 'high')
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
    # the flick's glide comes to rest first (on a busy machine it runs past half a second)
    y1 = await pg.evaluate("document.querySelector('#pageWrap').scrollTop")
    for _ in range(30):
        await pg.wait_for_timeout(100)
        y = await pg.evaluate("document.querySelector('#pageWrap').scrollTop")
        if y == y1: break
        y1 = y
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

async def scenario_checker(b):
    """the checker: the bubble, Apply, Leave it, Write it again, words to avoid; search in this book and another"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Other Book')
    await pg.fill('#direction', 'A heron stood in the shallows, grey as the morning.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    other = await pg.evaluate('location.hash')
    await new_book(pg, title='The Checked Book')
    await add_conn(pg)
    # words he never wants, in Your instructions
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    avoid = pg.locator('.sheet.on label.field:has(span:text-is("Words to avoid")) textarea')
    # (a section stays as he left it, open or folded, in this browser)
    if not await avoid.is_visible():
        await pg.click('.sheet.on .ghead:has-text("Your instructions")')
        await pg.wait_for_timeout(200)
    check('Your instructions has a box for words to avoid', await avoid.count() == 1)
    await avoid.fill('tar')
    await pg.wait_for_timeout(700)
    await close_sheet(pg)
    await write(pg, 'The lamp goes out.')
    sysw = '\n'.join(m['content'] for m in completions()[-1]['body']['messages'] if m['role'] == 'system')
    check('the writer is told the words he never wants', 'Words and phrases I never want in the book: “tar”.' in sysw, sysw[:200])
    # the bubble: blue while it checks, then yellow with how many
    states = []
    for i in range(60):
        st = await pg.get_attribute('#checkBubble', 'data-state')
        if not states or states[-1] != st: states.append(st)
        if st == 'found': break
        await pg.wait_for_timeout(250)
    n = (await pg.inner_text('#checkBubble')).strip()
    check('the bubble is blue while it checks, then yellow with how many it found', states[-1] == 'found' and states[0] in ('waiting', 'checking') and n == '3', (states, n))
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .sug')
    cards = [c.lower() for c in await pg.locator('.sheet.on .sug').all_inner_texts()]
    check('Suggestions holds each one: what it changes and why, Apply or Write it again, and Leave it; Apply all counts what it can put in', len(cards) == 3
          and any('humanize' in c and 'patient, unhurried' in c and 'apply' in c for c in cards)
          and any('grammar' in c and 'letters any more' in c for c in cards)
          and any('words to avoid' in c and 'write it again' in c and 'leave it' in c for c in cards)
          and await pg.locator('.sheet.on button:has-text("Apply all (2)")').count() == 1, cards)
    await pg.locator('.sheet.on .sug:has-text("patient, unhurried") button:has-text("Apply")').click()
    await pg.wait_for_timeout(500)
    prose = await pg.inner_text('#passages .passage >> nth=-1')
    check('Apply changes the words on the page, takes it off the list and counts the bubble down', 'patient, unhurried' in prose and await pg.locator('.sheet.on .sug').count() == 2 and (await pg.inner_text('#checkBubble')).strip() == '2', prose[:160])
    await pg.locator('.sheet.on .sug:has-text("letters any more") button:has-text("Leave it")').click()
    await pg.wait_for_timeout(400)
    prose = await pg.inner_text('#passages .passage >> nth=-1')
    check('Leave it takes it off and leaves the words as they are', 'letters anymore' in prose and await pg.locator('.sheet.on .sug').count() == 1, prose[:200])
    await pg.locator('.sheet.on .sug:has-text("tar") button:has-text("Write it again")').click()
    await pg.wait_for_timeout(200)
    await idle(pg)
    asked = completions()[-1]['body']['messages'][-1]['content']
    prose = await pg.inner_text('#passages .passage >> nth=-1')
    check('Write it again rewrites just that sentence, without the word', 'without “tar”' in asked and 'smelled of tar' not in prose and 'amber glow' in prose and 'patient, unhurried' in prose, (asked[-200:], prose[-200:]))
    states = []
    for i in range(60):
        st = await pg.get_attribute('#checkBubble', 'data-state')
        if not states or states[-1] != st: states.append(st)
        if st == 'clean' and i > 2: break
        await pg.wait_for_timeout(250)
    check('the new words are checked, and what he left is not offered again: green', states[-1] == 'clean', states)
    ctl = await pg.inner_text('#passages .passage >> nth=-1 >> .pctl')
    check('each change is a version of its own, the words before one arrow away', '3 / 3' in ctl, ctl)
    # search: the words, wherever they are written, and a tap goes there
    await pg.click('#searchBtn')
    await pg.wait_for_selector('.sheet.on .searchtop')
    await pg.fill('.sheet.on input[type=search]', 'AMBER  glow')
    await pg.wait_for_timeout(500)
    say = await pg.inner_text('.sheet.on .searchsay')
    hits = await pg.locator('.sheet.on .hit').count()
    check('search finds the words, however they are typed', say == '1 place.' and hits == 1, (say, hits))
    await pg.click('.sheet.on .hit')
    await pg.wait_for_timeout(900)
    lit = await pg.evaluate("(() => ({ glow: Boolean(document.querySelector('#passages .passage.found')), marked: Boolean(globalThis.CSS && CSS.highlights && CSS.highlights.has('found')), text: CSS.highlights && CSS.highlights.has('found') ? [...CSS.highlights.get('found')][0].toString() : '' }))()")
    check('a tap goes to the passage and marks the words', lit['glow'] and lit['marked'] and lit['text'].lower() == 'amber glow', lit)
    # another book: All books, and a tap opens it there
    await pg.click('#searchBtn')
    await pg.wait_for_selector('.sheet.on .searchtop')
    await pg.click('.sheet.on .segmented button:has-text("All books")')
    await pg.fill('.sheet.on input[type=search]', 'heron')
    # (the box keeps the last words; the places for the new ones are the ones to read)
    await pg.wait_for_function("[...document.querySelectorAll('.sheet.on .hit')].some((x) => /heron/i.test(x.textContent))", timeout=5000)
    books = await pg.locator('.sheet.on .searchbook').all_inner_texts()
    check('All books says which book each place is in', books == ['The Other Book'], books)
    await pg.click('.sheet.on .hit')
    await pg.wait_for_function(f"location.hash.startsWith({json.dumps(other.split('/')[0] + '/' + other.split('/')[1] + '/' + other.split('/')[2])})", timeout=5000)
    await pg.wait_for_timeout(900)
    there = await pg.evaluate("(() => ({ title: document.querySelector('#bookTitle') ? document.querySelector('#bookTitle').textContent : '', glow: Boolean(document.querySelector('#passages .passage.found')), marked: CSS.highlights && CSS.highlights.has('found') ? [...CSS.highlights.get('found')][0].toString() : '' }))()")
    check('a place in another book opens that book at the words', 'The Other Book' in there['title'] and there['glow'] and there['marked'].lower() == 'heron', there)
    await pg.go_back(); await pg.wait_for_timeout(500)
    check('Back from there leaves the book for the shelf, as from any book', await pg.evaluate("!document.querySelector('#shelf').hidden"), await pg.evaluate('location.hash'))
    # the list emptied again, for the walks after
    await pg.click('#shelfSettings')
    await pg.wait_for_selector('.sheet.on')
    avoid = pg.locator('.sheet.on label.field:has(span:text-is("Words to avoid")) textarea')
    if not await avoid.is_visible():
        await pg.click('.sheet.on .ghead:has-text("Your instructions")')
        await pg.wait_for_timeout(200)
    await avoid.fill('')
    await pg.wait_for_timeout(700)
    await close_sheet(pg)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (checker and search)', not errs, errs[:5])
    await pg.close()

OLD_WRITING = "You write fiction the way good published novels read: concrete, sensory detail; real feeling under the surface; dialogue that sounds like people actually talking; a pace that gives quiet moments room to breathe and lets big moments land.\n\nStay true to the characters and to everything already written — never contradict it. Show rather than summarise. Don't rush to wrap things up, don't end on a neat moral, and don't reach for a cliffhanger unless the story calls for one. Avoid stock phrases and repeating yourself."
OLD_NARRATOR = "You tell the scene the way the book itself is told — its voice, its point of view, its tense — a few paragraphs at a time: the place, the weather of the moment, the other people and what they say and do, what happens next.\n\nThe people in it have their own minds. They want things, they push back, they lie, they surprise; nobody waits politely for a turn or exists only to agree. The world keeps moving around the scene. Keep it concrete and alive, let quiet moments breathe and big ones land, and end each telling at a moment that asks for an answer."

def system_of(x):
    return '\n'.join(m['content'] for m in x['body']['messages'] if m['role'] == 'system')

async def scenario_crafts(b):
    """the crafts and modules: old starting words brought up to date, the Modules list, his own module, Off, the outcome chip, Sound, a scene in italics"""
    logs = []
    pg = await page(b, logs)
    reset()
    await new_book(pg, title='The Crafted Book')
    await add_conn(pg)
    # ---- a house that still holds the starting words of before 2.3, untouched
    await pg.evaluate("""async (old) => {
      const r = await fetch('/api/store/house/house').then((x) => x.json());
      const data = r.data;
      data.instructions.system = old.w; data.instructions.narrator = old.n;
      /* and the one note at the end of before 2.3.2, for the writer and the narrator alike */
      data.instructions.late = 'MY OLD NOTE'; delete data.instructions.lateNarrator;
      await fetch('/api/store/house/house', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base': String(r.rev) }, body: JSON.stringify({ data }) });
    }""", {'w': OLD_WRITING, 'n': OLD_NARRATOR})
    await pg.reload()
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(1000)
    ins = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']['instructions']
    check('boxes still holding the old starting words get today’s when the app starts', ins['system'].startswith('You are a master novelist') and ins['narrator'] == 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.', (ins['system'][:60], ins['narrator'][:80]))
    check('the one note at the end of before stays the book’s, and the scenes get their own copy of it', ins.get('late') == 'MY OLD NOTE' and ins.get('lateNarrator') == 'MY OLD NOTE', (ins.get('late'), ins.get('lateNarrator')))
    # ---- the Modules list, in Settings → Your instructions
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if not await pg.locator('.sheet.on .modrow').first.is_visible():
        await pg.click('.sheet.on .ghead:has-text("Your instructions")'); await pg.wait_for_timeout(200)
    box = await pg.input_value('.sheet.on label.field:has(span:text-is("How you like it written")) textarea')
    check('How you like it written shows the master novelist', box.startswith('You are a master novelist'), box[:80])
    # ---- a note at the end for the book, and one for scenes
    book_note = '.sheet.on label.field:has(span:text-is("A note at the end — the book")) textarea'
    scene_note = '.sheet.on label.field:has(span:text-is("A note at the end — scenes")) textarea'
    shown = (await pg.input_value(book_note), await pg.input_value(scene_note))
    await pg.fill(scene_note, 'SCENES ONLY')
    # kept after the typing pause (half a second) and the save's own (under one more)
    for _ in range(25):
        await pg.wait_for_timeout(200)
        ins = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']['instructions']
        if ins.get('lateNarrator') == 'SCENES ONLY':
            break
    check('two boxes for the note at the end, each kept on its own', shown == ('MY OLD NOTE', 'MY OLD NOTE') and ins.get('late') == 'MY OLD NOTE' and ins.get('lateNarrator') == 'SCENES ONLY', (shown, ins.get('late'), ins.get('lateNarrator')))
    await pg.fill(book_note, ''); await pg.fill(scene_note, '')
    for _ in range(25):
        await pg.wait_for_timeout(200)
        ins = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']['instructions']
        if ins.get('late') == '' and ins.get('lateNarrator') == '':
            break
    check('and both emptied, both are empty', ins.get('late') == '' and ins.get('lateNarrator') == '', (ins.get('late'), ins.get('lateNarrator')))
    names = await pg.locator('.sheet.on .modrow b').all_inner_texts()
    check('Modules lists the app’s in the order they ride', names == ['The novel craft', 'The scene craft', 'When the scene turns intimate', 'When words won’t carry it', 'The sound of a voice', 'Spectacle combat (for the anime arcs)'], names)
    lines = await pg.locator('.sheet.on .modrow small:not(.about)').all_inner_texts()
    check('each says who reads it and when', lines[:3] == ['The writer · always', 'The narrator · always', 'The writer and the narrator · when the scene turns intimate'] and lines[5] == 'Off — not sent', lines)
    top = '.sheet.on >> nth=-1'
    # his own module, for the writer and the narrator
    await pg.click('.sheet.on button:has-text("Add your own module")')
    await pg.wait_for_timeout(400)
    await pg.fill(f'{top} >> input[type=text]', 'My rain')
    await pg.check(f'{top} >> label.toggle:has-text("The writer") input')
    await pg.fill(f'{top} >> textarea', 'MY OWN MODULE: the rain never stops.')
    await pg.wait_for_timeout(100)
    who = await pg.inner_text(f'{top} >> .field:has(.modwho) em')
    await close_sheet(pg)
    names = await pg.locator('.sheet.on .modrow b').all_inner_texts()
    check('his own module is listed after the app’s, saying who reads it', names[-1] == 'My rain' and who == 'The writer and the narrator · always', (names, who))
    # Spectacle when a fight starts; the voice rule off — each with Back to the default
    await pg.click('.sheet.on .modrow[data-id="spectacle"]'); await pg.wait_for_timeout(300)
    await pg.select_option(f'{top} >> select', 'fight')
    await close_sheet(pg)
    await pg.click('.sheet.on .modrow[data-id="voice"]'); await pg.wait_for_timeout(300)
    await pg.select_option(f'{top} >> select', 'off')
    await pg.wait_for_timeout(200)
    back = await pg.locator(f'{top} >> button:has-text("Back to the default")').count()
    await close_sheet(pg)
    check('one of the app’s he changed offers Back to the default', back == 1, back)
    # the novel craft's words changed, then put back
    await pg.click('.sheet.on .modrow[data-id="novel-craft"]'); await pg.wait_for_timeout(300)
    craft = await pg.input_value(f'{top} >> textarea')
    await pg.fill(f'{top} >> textarea', 'HIS OWN CRAFT.')
    await close_sheet(pg)
    tag = await pg.inner_text('.sheet.on .modrow[data-id="novel-craft"]')
    await pg.click('.sheet.on .modrow[data-id="novel-craft"]'); await pg.wait_for_timeout(300)
    await pg.click(f'{top} >> button:has-text("Back to the default")')
    await pg.wait_for_selector('.sheet.on .btn:has-text("Back to the default") >> nth=-1')
    await pg.click('.sheet.on >> nth=-1 >> .btn.primary:has-text("Back to the default")')
    await pg.wait_for_timeout(400)
    again = await pg.input_value(f'{top} >> textarea')
    await close_sheet(pg)
    check('his words for a craft are marked his, and Back to the default puts the app’s back', 'your words' in tag.lower() and again == craft and craft.startswith('## The Telling'), (tag, again[:60]))
    await close_sheet(pg)
    mods = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data'].get('modules', {})
    mine = [v for v in mods.values() if v.get('custom')]
    check('the house keeps only what he changed — and his own whole', mods.get('voice') == {'rides': 'off'} and mods.get('spectacle') == {'rides': 'fight'} and 'novel-craft' not in mods
          and len(mine) == 1 and mine[0]['to'] == ['writer', 'narrator'] and mine[0]['text'] == 'MY OWN MODULE: the rain never stops.' and mine[0]['name'] == 'My rain', mods)
    # ---- the chip by the box: who decides how it turns out
    await pg.click('#outcomeBtn')
    items = await pg.locator('.menu-pop button').all_inner_texts()
    await pg.click('.menu-pop button:has-text("I decide")')
    await pg.wait_for_timeout(300)
    chip = await pg.inner_text('#outcomeBtn')
    check('the chip offers Writer decides and I decide, and says which', len(items) == 2 and items[0].startswith('Writer decides') and items[1].startswith('I decide') and 'I decide' in chip, (items, chip))
    reset()
    await write(pg, 'Jovan fights Kenjaku in the corridor.')
    x = completions()[-1]
    sysw = system_of(x)
    ask = x['body']['messages'][-1]['content']
    check('the writer reads his words, the novel craft, then his module', sysw.startswith('You are a master novelist') and 0 < sysw.index('## The Telling') < sysw.index('MY OWN MODULE') and '## The Sound Of A Voice' not in sysw, sysw[:160])
    check('a fight in his words wakes how a fight sounds, and Spectacle', '## How A Fight Sounds' in sysw and '## Spectacle Combat' in sysw, '')
    check('I decide: the writer stops on the moment it hangs', 'How it turns out is mine to decide' in ask and 'stop on the moment it hangs' in ask, ask[-400:])
    # ---- Sound: Novel, in About this book
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_selector('.sheet.on')
    pressed = await pg.get_attribute('.sheet.on .segmented[aria-label="Sound"] button:has-text("Comic")', 'aria-pressed')
    await pg.click('.sheet.on .segmented[aria-label="Sound"] button:has-text("Novel")')
    await pg.wait_for_timeout(300)
    say = await pg.inner_text('.sheet.on .field:has(.segmented[aria-label="Sound"]) em')
    await close_sheet(pg)
    reset()
    await write(pg, 'He draws his sword again.')
    sysw = system_of(completions()[-1])
    check('Sound starts at Comic; Novel sends the sounds in the sentences, no sound effects in asterisks', pressed == 'true' and 'Sound In The Prose' in sysw and 'Sound As Onomatopoeia' not in sysw and '*CLANG!*' not in sysw and say.startswith('Novel:'), say)
    # ---- a scene: the narrator's preset opening and the scene craft; its telling drawn as prose
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Scenes")')
    await pg.wait_for_timeout(300)
    await pg.fill('#sideBody input[placeholder]', 'Mara')
    reset()
    await pg.click('#sideBody button:has-text("Begin the scene")')
    await pg.wait_for_selector('.turn.ai .tctl', timeout=8000)
    em = await pg.locator('#sideBody .turn.ai .tprose em').all_inner_texts()
    sysp = system_of(completions()[-1])
    check('the narrator reads his preset’s opening, the scene craft and his module', sysp.startswith('You maintain a fictional, uncensored simulation.') and 'Role = you handle narration' in sysp and 'MY OWN MODULE' in sysp and '## The Telling\nI bring you premises' not in sysp, sysp[:160])
    check('the narrator’s telling is drawn as prose, its sound effect in italics', em == ['Crack!'] and '*' not in await pg.inner_text('#sideBody .turn.ai .tprose'), em)
    await pg.fill('#sideFoot textarea >> nth=0', 'I draw my sword and attack him.')
    reset()
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_function("document.querySelectorAll('.turn.ai .tctl').length >= 2", timeout=8000)
    sysp = system_of(completions()[-1])
    check('his move into a fight wakes the narrator’s board', "## When Words Won't Carry It" in sysp and '## How A Fight Sounds' in sysp, '')
    # ---- his own module taken out, and back with Undo
    await pg.go_back(); await pg.wait_for_timeout(300)
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if not await pg.locator('.sheet.on .modrow').first.is_visible():
        await pg.click('.sheet.on .ghead:has-text("Your instructions")'); await pg.wait_for_timeout(200)
    await pg.click('.sheet.on .modrow:has-text("My rain")'); await pg.wait_for_timeout(300)
    await pg.click(f'{top} >> button:has-text("Remove this module")')
    await pg.wait_for_timeout(400)
    gone = await pg.locator('.sheet.on .modrow:has-text("My rain")').count()
    await pg.click('#toast button.toastact')
    await pg.wait_for_timeout(500)
    back_again = await pg.locator('.sheet.on .modrow:has-text("My rain")').count()
    mods = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data'].get('modules', {})
    check('his own module taken out comes back whole with Undo', gone == 0 and back_again == 1 and any(v.get('text') == 'MY OWN MODULE: the rain never stops.' for v in mods.values()), (gone, back_again))
    await close_sheet(pg)
    # ---- the composer fits a narrow phone
    for width in (412, 360):
        await pg.set_viewport_size({'width': width, 'height': 780})
        await pg.wait_for_timeout(300)
        fit = await pg.evaluate("(() => { const r = document.querySelector('.composer .crow'); const kids = [...r.querySelectorAll('.chip')].map((c) => ({ w: c.getBoundingClientRect().width, right: c.getBoundingClientRect().right, need: c.scrollWidth })); return { over: r.scrollWidth - r.clientWidth, right: Math.max(...kids.map((k) => k.right)), width: document.documentElement.clientWidth, crushed: kids.filter((k) => k.w < 60).length }; })()")
        await pg.screenshot(path=os.path.join(SHOTS, f'composer-{width}.png'))
        check(f'the chips by the box fit a {width}-wide phone, none crushed', fit['over'] <= 0 and fit['right'] <= fit['width'] and fit['crushed'] == 0, fit)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (crafts and modules)', not errs, errs[:5])
    await pg.close()

async def scenario_versions(b):
    """each version its own notes, the notes explained, the readings list, presets, the note switch, structured templates, quick asks"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Two Takes')
    await add_conn(pg)
    await write(pg, 'Mara finds a bottle.')
    nid = await pg.evaluate("location.hash.split('/')[2]")
    novel = lambda: pg.evaluate(f"fetch('/api/store/novel/{nid}').then((r) => r.json()).then((j) => j.data)")
    readings = lambda: len([x for x in reqs() if 'Update the notes' in json.dumps(x['body'].get('messages') or [])])
    lore = lambda n: sorted(c['name'] for c in (n.get('notes') or {}).get('lore', []))
    async def until(test, t=15000):
        for _ in range(t // 200):
            n = await novel()
            if test(n):
                return n
            await pg.wait_for_timeout(200)
        return await novel()
    n = await until(lambda n: len((n.get('notes') or {}).get('people', [])) > 0)
    check('the helper read the first take', lore(n) == ['The bottle'], lore(n))
    # the notes say what lit and yours mean, and that every card goes to the writer
    await pg.click('#notesBtn'); await pg.wait_for_timeout(400)
    key = await pg.inner_text('#sidePane .notekey >> nth=0') if await pg.locator('#sidePane .notekey').count() else ''
    lit = await pg.locator('#sidePane .card .ctag.lit').count()
    check('the notes say every card goes to the writer, lit or not, and what lit means', 'Every card here goes to the writer before every page, lit or not' in key and 'changed by the helper last' in key, key[:200])
    check('the cards the last reading changed are marked new', lit >= 3, lit)
    # his edit of the newest passage: the old version's notes go, the edit is read as new
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    await pg.click('#passages .passage >> nth=0'); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.fill('.editbox', 'SECOND TAKE: Mara finds a bottle and a second letter.')
    await pg.click('.editrow button:has-text("Save")')
    n = await until(lambda n: 'The second take' in lore(n))
    check('the edit, read as new, has its own notes', lore(n) == ['The bottle', 'The second take'], lore(n))
    before = readings()
    # the arrows back to the first take: its notes come back, with no reading
    # (the passage is still open from the edit; a click on its middle could land on Another take)
    if not await pg.locator('.passage.selected').count():
        await pg.click('#passages .passage >> nth=0', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected button[aria-label="The version before"]')
    n = await until(lambda n: 'The second take' not in lore(n), 6000)
    await pg.wait_for_timeout(1200)
    check('the arrows bring the first take’s notes back at once', lore(n) == ['The bottle'], lore(n))
    check('and cost no reading', readings() == before, (before, readings()))
    # the readings list: both versions, one in the notes, one an earlier version
    await pg.click('#notesBtn'); await pg.wait_for_timeout(400)
    await pg.click('#sidePane .sechead:has(h3:text-is("Each version’s notes"))'); await pg.wait_for_timeout(300)
    tags = await pg.locator('#sidePane .card.reading .ctag').all_inner_texts()
    check('the readings list shows each version: one in the notes, one an earlier version', sorted(t.lower() for t in tags) == ['earlier version', 'in the notes'], tags)
    # several versions taken out at once, with Undo
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    if not await pg.locator('.passage.selected').count():
        await pg.click('#passages .passage >> nth=0', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button:has-text("Another take")')
    await pg.wait_for_function("(() => { const v = document.querySelector('.passage.selected .pctl .ver > span'); return v && /3 \\/ 3/.test(v.textContent) && !document.querySelector('.passage.streaming'); })()", timeout=15000)
    await pg.wait_for_timeout(600)
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Remove versions")')
    await pg.wait_for_selector('.sheet.on .verrow')
    await pg.check('.sheet.on .verrow >> nth=0 >> input'); await pg.check('.sheet.on .verrow >> nth=1 >> input')
    await pg.click('.sheet.on button:has-text("Remove 2 versions")'); await pg.wait_for_timeout(500)
    vl = '.passage.selected .pctl .ver > span'
    one = await pg.locator(vl).count() == 0 or '1 / 1' in await pg.inner_text(vl)
    await pg.click('#toast button:has-text("Undo")'); await pg.wait_for_timeout(500)
    back = await pg.inner_text(vl) if await pg.locator(vl).count() else ''
    check('Remove versions takes out the ones ticked, and Undo brings them back', one and '3 / 3' in back, back)
    # presets: saved, the box changed, used again
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if not await pg.locator('.sheet.on button:has-text("Save current preset")').is_visible():
        await pg.click('.sheet.on .ghead:has-text("Your instructions")'); await pg.wait_for_timeout(300)
    sysbox = '.sheet.on label.field:has(span:text-is("How you like it written")) textarea'
    await pg.fill(sysbox, 'BATMAN WRITES.')
    await pg.wait_for_timeout(1200)
    await pg.click('.sheet.on button:has-text("Save current preset")'); await pg.wait_for_timeout(300)
    await pg.fill('.sheet.on >> nth=-1 >> input', 'Batman')
    await pg.click('.sheet.on >> nth=-1 >> button:has-text("Save")'); await pg.wait_for_timeout(600)
    await pg.fill(sysbox, 'SOMEONE ELSE WRITES.'); await pg.wait_for_timeout(1200)
    await pg.click('.sheet.on .presetrow button:has-text("Use")'); await pg.wait_for_timeout(800)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    check('a preset saved and used again puts the words back exactly', house['instructions'].get('system') == 'BATMAN WRITES.' and await pg.input_value(sysbox) == 'BATMAN WRITES.' and [p['name'] for p in house.get('presets', [])] == ['Batman'], (house['instructions'].get('system'), [p['name'] for p in house.get('presets', [])]))
    check('and is marked in use', await pg.locator('.sheet.on .presetrow .tag:has-text("in use")').count() == 1)
    # words typed a moment ago, then The starting words at once: the typing is not written in afterwards over them
    await pg.fill(sysbox, 'TYPED JUST NOW.')
    await pg.click('.sheet.on button:has-text("The starting words")'); await pg.wait_for_timeout(1400)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    starting = await pg.evaluate("import('/js/novel/prompts.js').then((m) => m.DEFAULT_WRITING)")
    check('a preset used right after typing is not written over by the typing', house['instructions'].get('system') == starting and await pg.input_value(sysbox) == starting and await pg.locator('.sheet.on .presetrow .tag:has-text("in use")').count() == 0, (house['instructions'].get('system') or '')[:40])
    await pg.click('#toast button:has-text("Undo")'); await pg.wait_for_timeout(900)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    check('and its Undo brings back what was typed', house['instructions'].get('system') == 'TYPED JUST NOW.' and await pg.input_value(sysbox) == 'TYPED JUST NOW.', house['instructions'].get('system'))
    # the note at the end switched off: kept, not sent
    await pg.uncheck('.sheet.on .switchrow >> nth=0 >> input'); await pg.wait_for_timeout(800)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    check('Send it, unticked, switches the book’s note at the end off', house['instructions'].get('lateOff') is True, house['instructions'])
    # the connection editor: Structured shows the ready-made templates
    if not await pg.locator('.sheet.on label.field:has(> span:text-is("How it is sent")) select').is_visible():
        await pg.click('.sheet.on .ghead:has-text("Connections")'); await pg.wait_for_timeout(300)
    await pg.select_option('.sheet.on label.field:has(> span:text-is("How it is sent")) select', 'structured'); await pg.wait_for_timeout(700)
    await pg.select_option('.sheet.on label.field:has(> span:text-is("Ready-made template")) select', 'line')
    await pg.fill('.sheet.on label.field:has(> span:has-text("Your words")) input', 'Yuhuu')
    await pg.click('.sheet.on button:has-text("Put it in the prefill box")'); await pg.wait_for_timeout(900)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    c = house['connections'][0]
    check('a ready-made template is written into the prefill box, set to Structured', c.get('prefill') == 'Yuhuu' and c.get('prefillMode') == 'structured', (c.get('prefill'), c.get('prefillMode')))
    await close_sheet(pg)
    # the partner's quick asks
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(400)
    await pg.click('#sideFoot button:has-text("Quick asks")'); await pg.wait_for_timeout(200)
    items = await pg.locator('.menu-pop button .mlabel').all_inner_texts()
    check('the partner’s quick asks, each with its line', 'Check the notes against the book' in items and 'Tidy the notes' in items and await pg.locator('.menu-pop button .mhint').count() == len(items), items)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
    errs = [l for l in logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no errors on the page', not errs, errs[:3])

async def scenario_partner(b):
    """the partner as Cozy Tavern's housekeeper: Edit by hand, Apply all, Undo all, What it said whole, conversations, Branch from here, Edit and ask again, Start over, full screen, Critique"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Housekeeper')
    await add_conn(pg)
    await pg.fill('#direction', 'Rain hammered the glass. The sea was grey.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(400)
    nid = await pg.evaluate("location.hash.split('/')[2]")
    await pg.evaluate("import('/js/store.js').then((s) => s.change('house', 'house', (h) => { h.partnerApplies = 'wait'; }, { now: true }))")
    first_words = "(() => { const p = document.querySelector('#passages .passage .prose'); return p ? p.textContent : '' })()"
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    row = await pg.inner_text('#sideBody .convrow')
    check('the open conversation shows by name, with New conversation', 'Conversation 1' in row and await pg.locator('#sideBody .convrow button[aria-label="New conversation"]').count() == 1, row)
    await pg.fill('#sideFoot textarea', 'TWO CHANGES please.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .change.waiting', timeout=8000)
    check('waiting changes: Apply, Edit by hand, Leave it — and Apply all, Leave all', await pg.locator('#sideBody .change.waiting button:has-text("Edit by hand")').count() == 2 and await pg.locator('#sideBody button:has-text("Apply all")').count() == 1 and await pg.locator('#sideBody button:has-text("Leave all")').count() == 1)
    await pg.click('#sideBody button:has-text("Apply all")'); await pg.wait_for_timeout(500)
    p1 = await pg.evaluate(first_words)
    check('Apply all makes every one', p1.strip() == 'Rain lashed the glass. The sea was black.', p1)
    await pg.click('#sideBody button:has-text("Undo all")'); await pg.wait_for_timeout(600)
    p1 = await pg.evaluate(first_words)
    check('Undo all puts every one back', p1.strip() == 'Rain hammered the glass. The sea was grey.' and await pg.locator('#sideBody .change.undone').count() == 2, p1)
    await pg.click('#sideBody .turn.ai .tmore'); await pg.click('.menu-pop button:has-text("What it said, whole")'); await pg.wait_for_timeout(300)
    whole = await pg.inner_text('.sheet.on pre.whole')
    check('What it said, whole shows the block too', '<changes>' in whole and 'Two changes to the first passage.' in whole, whole[:80])
    await close_sheet(pg)
    # again: one by hand, one left
    await pg.fill('#sideFoot textarea', 'TWO CHANGES again.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .turn.ai >> nth=1 >> .change.waiting', timeout=8000)
    await pg.click('#sideBody .change.waiting >> nth=0 >> button:has-text("Edit by hand")')
    await pg.wait_for_selector('.sheet.on textarea, .sheet.on input')
    box = '.sheet.on label.field:has(span:text-is("The new words")) textarea'
    check('Edit by hand shows the words it would write', await pg.input_value(box) == 'Rain lashed the glass', await pg.input_value(box))
    await pg.fill(box, 'Rain drummed on the glass')
    await pg.click('.sheet.on button:has-text("Apply")'); await pg.wait_for_timeout(500)
    await pg.click('#sideBody .change.waiting button:has-text("Leave it")'); await pg.wait_for_timeout(400)
    p1 = await pg.evaluate(first_words)
    check('applied with his words; the other left', p1.strip() == 'Rain drummed on the glass. The sea was grey.' and await pg.locator('#sideBody .change.made:has-text("made with your words")').count() == 1 and await pg.locator('#sideBody .change.skipped').count() == 1, p1)
    # Branch from here: a new conversation up to that answer, its changes the first one's
    await pg.click('#sideBody .turn.ai >> nth=-1 >> .tmore'); await pg.click('.menu-pop button:has-text("Branch from here")'); await pg.wait_for_timeout(500)
    row = await pg.inner_text('#sideBody .convrow')
    note = await pg.locator('#sideBody .change .cwhy:has-text("In the conversation this one was copied from")').count()
    check('Branch from here opens a copy; its changes stay the first one\'s', 'Conversation 1 (branch)' in row and note == 1 and await pg.locator('#sideBody .change button').count() == 0 and await pg.locator('#sideBody .turn').count() == 4, (row, note))
    # the list: the first one, by name; open it again
    await pg.click('#sideBody .convpick'); await pg.wait_for_timeout(200)
    items = await pg.locator('.menu-pop button .mlabel').all_inner_texts()
    check('the conversations list: the others, and rename, copy, remove', 'Conversation 1' in items and 'Rename this conversation' in items and 'Copy this conversation' in items and 'Remove this conversation' in items, items)
    await pg.click('.menu-pop button:has(.mlabel:text-is("Conversation 1"))'); await pg.wait_for_timeout(500)
    check('…and opening one shows its talk, its Undo there', 'Conversation 1' in await pg.inner_text('#sideBody .convrow') and await pg.locator('#sideBody .change.made button:has-text("Undo")').count() == 1 and await pg.locator('#sideBody .change.undone').count() == 2)
    # New conversation
    await pg.click('#sideBody .convrow button[aria-label="New conversation"]'); await pg.wait_for_timeout(400)
    check('New conversation begins empty; the first stays in the list', 'Conversation 2' in await pg.inner_text('#sideBody .convrow') and await pg.locator('#sideBody .turn').count() == 0)
    await pg.fill('#sideFoot textarea', 'A question about the letter.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .turn.ai:not(.streaming)', timeout=8000)
    # Edit and ask again: his words back in the box, the message and its answer let go; Undo brings them back
    await pg.click('#sideBody .turn.you button:has-text("Edit and ask again")'); await pg.wait_for_timeout(500)
    back = await pg.input_value('#sideFoot textarea')
    check('Edit and ask again: his words in the box, the talk let go', back == 'A question about the letter.' and await pg.locator('#sideBody .turn').count() == 0, back)
    await pg.click('#toast button:has-text("Undo")'); await pg.wait_for_timeout(500)
    check('…and Undo brings them back, the box empty again', await pg.locator('#sideBody .turn').count() == 2 and await pg.input_value('#sideFoot textarea') == '', await pg.input_value('#sideFoot textarea'))
    # Start over, with Undo
    await pg.click('#sideFoot button:has-text("Start over")')
    await pg.click('.sheet.on button:has-text("Start over")'); await pg.wait_for_timeout(500)
    gone = await pg.locator('#sideBody .turn').count()
    await pg.click('#toast button:has-text("Undo")'); await pg.wait_for_timeout(500)
    check('Start over empties it, and Undo brings it back', gone == 0 and await pg.locator('#sideBody .turn').count() == 2, gone)
    # full screen, and back
    await pg.click('#sideBody .convrow button[aria-label="Full screen"]'); await pg.wait_for_timeout(400)
    full = await pg.evaluate("document.querySelector('#sidePane').classList.contains('full')")
    await pg.click('#sideBody .convrow button[aria-label="Leave full screen"]'); await pg.wait_for_timeout(400)
    check('the partner goes full screen and comes back', full and not await pg.evaluate("document.querySelector('#sidePane').classList.contains('full')"))
    # a passage taken out is said as such
    await pg.fill('#sideFoot textarea', 'TAKE OUT THE PASSAGE, please.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .turn.ai >> nth=-1 >> .change.waiting', timeout=8000)
    what = await pg.inner_text('#sideBody .turn.ai >> nth=-1 >> .change.waiting .cwhat')
    check('a passage the partner would take out is said to be taken out of the chapter', what.strip() == 'taken out of the chapter', what)
    await pg.click('#sideBody .turn.ai >> nth=-1 >> .change.waiting button:has-text("Leave it")'); await pg.wait_for_timeout(300)
    # Ideas: a premise a tap puts in the box; off, the chip is gone
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    await pg.click('#ideasBtn'); await pg.wait_for_selector('.sheet.on .idea', timeout=10000)
    idea = await pg.inner_text('.sheet.on .idea >> nth=0 >> span')
    await pg.click('.sheet.on .idea >> nth=0 >> button:has-text("Use")'); await pg.wait_for_timeout(400)
    check('Ideas: a premise for what happens next goes in the box with a tap', 'brother' in idea and 'brother' in await pg.input_value('#direction'), idea)
    await pg.fill('#direction', '')
    await pg.evaluate("import('/js/store.js').then((s) => s.change('house', 'house', (h) => { h.ideas = { on: false }; }, { now: true }))"); await pg.wait_for_timeout(400)
    check('Ideas off: the chip is gone', await pg.locator('#ideasBtn:not([hidden])').count() == 0)
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    # Critique among the quick asks
    await pg.click('#sideFoot button:has-text("Quick asks")'); await pg.wait_for_timeout(200)
    items = await pg.locator('.menu-pop button .mlabel').all_inner_texts()
    check('Critique this chapter is a quick ask', 'Critique this chapter' in items, items)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
    t = (await pg.evaluate(f"fetch('/api/store/talk/{nid}').then((r) => r.json())"))['data']
    check('every conversation is kept on the phone', sorted([t.get('name')] + [c['name'] for c in t.get('convs', [])]) == ['Conversation 1', 'Conversation 1 (branch)', 'Conversation 2'], [t.get('name')] + [c['name'] for c in t.get('convs', [])])
    errs = [l for l in logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no errors on the page', not errs, errs[:3])

async def scenario_judge(b):
    """the judge: ten checks and the words that fail them, stock wording counted, the benchmark box, two writers head to head"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Judged Book')
    await add_conn(pg)
    # his own words: a look explained, a stock phrase, an ending that says what it meant
    await pg.fill('#direction', 'He gave her a look that meant he was sorry. Her voice was barely above a whisper. And she knew, at last, that she was home.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    for i in range(80):
        if await pg.get_attribute('#checkBubble', 'data-state') == 'found': break
        await pg.wait_for_timeout(250)
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .sug')
    cards = await pg.locator('.sheet.on .sug').all_inner_texts()
    # (the tag on each card shows in capitals)
    grade = next((c for c in cards if 'UNDER YOUR MARK' in c.upper()), '')
    check('a passage under his mark: its grade, each check it fails with the words that fail it, and Write it again toward 9',
          '7 of 10 — under your 9' in grade and 'Shown' in grade and '“a look that meant he was sorry”' in grade and 'Ending' in grade and 'Fresh' in grade and '“voice was barely above a whisper”' in grade and 'Write it again toward 9' in grade, grade)
    stock_card = next((c for c in cards if c.upper().startswith('HUMANIZE')), '')
    check('the stock wording counted in it is offered to be written again', 'HUMANIZE' in stock_card.upper() and 'Write it again' in stock_card and 'Leave it' in stock_card and '“voice was barely above a whisper” is stock wording' in stock_card, cards)
    summary = await pg.inner_text('.sheet.on .judgebox summary')
    check('the judge box says how the book grades', summary.strip() == 'Graded 7 of 10 on average · 1 passage · 1 under your 9', summary)
    await pg.click('.sheet.on .judgebox summary'); await pg.wait_for_timeout(200)
    box = await pg.inner_text('.sheet.on .judgebox')
    check('folded open: each writer, what it fails most, how it is judged', 'your own words' in box and 'Stock per 1,000 words' in box and 'Fails most: Shown 1 · Fresh 1 · Ending 1' in box and 'Ten checks a passage passes or fails' in box, box[:400])
    # a tap on the words goes to them in the passage
    await pg.locator('.sheet.on .sug:has-text("Under your mark") .faults button.quote >> nth=0').click()
    await pg.wait_for_timeout(900)
    lit = await pg.evaluate("(() => ({ glow: Boolean(document.querySelector('#passages .passage.found')), marked: CSS.highlights && CSS.highlights.has('found') ? [...CSS.highlights.get('found')][0].toString() : '' }))()")
    check('the words of a failed check, tapped, are found in the passage', lit['glow'] and lit['marked'] == 'a look that meant he was sorry', lit)
    # two writers for the same moment, read head to head
    await write(pg, 'THE LAMP is lit.')
    await add_conn(pg, 'fake-thinker')
    await pg.click('.passage.selected .pctl button:has-text("Another take")')
    await pg.wait_for_function("(() => { const v = document.querySelector('.passage.selected .pctl .ver > span'); return v && /2 \\/ 2/.test(v.textContent) && !document.querySelector('.passage.streaming'); })()", timeout=15000)
    duels = []
    for i in range(120):
        duels = [x for x in reqs() if 'Which is the better page' in json.dumps(x['body'].get('messages') or [])]
        if len(duels) >= 2: break
        await pg.wait_for_timeout(250)
    await pg.wait_for_timeout(800)
    check('the two takes are read head to head, both ways round', len(duels) == 2, len(duels))
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .judgebox')
    await pg.click('.sheet.on .judgebox summary'); await pg.wait_for_timeout(200)
    rows = await pg.evaluate("[...document.querySelectorAll('.sheet.on .judgebox tr')].map((r) => [...r.children].map((c) => c.textContent.trim()))")
    head = rows[0] if rows else []
    byw = {r[0].split(' · ')[0]: r for r in rows[1:]}
    check('the benchmark shows who won: the take that lit the lamp, both readings agreeing', 'Head to head' in head and byw.get('fake-thinker', [''])[-1] == '1–0–0' and byw.get('fake-writer', [''])[-1] == '0–1–0', rows)
    box = await pg.inner_text('.sheet.on .judgebox')
    check('a judge that is the very model it grades is said so', 'judged by itself' in box and 'A judge leans toward its own writing' in box, box[-500:])
    width = await pg.evaluate("(() => { const s = document.querySelector('.sheet.on .body') || document.querySelector('.sheet.on'); return [s.scrollWidth, s.clientWidth]; })()")
    check('the box fits a phone: nothing wider than the sheet', width[0] <= width[1] + 1, width)
    await close_sheet(pg)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (the judge)', not errs, errs[:5])
    await pg.close()

async def scenario_auto(b):
    """by itself: the checker's fixes put in, and a passage under the mark written again, from Who does what"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Book That Mends')
    await add_conn(pg)
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    grp = '.sheet.on .group[data-key="set.roles"]'
    if not await pg.locator(f'{grp} label.toggle:has-text("Apply the checker")').is_visible():
        await pg.click('.sheet.on .ghead:has-text("Who does what")'); await pg.wait_for_timeout(200)
    fix = pg.locator(f'{grp} label.toggle:has-text("Apply the checker’s fixes by themselves") input')
    lift = pg.locator(f'{grp} label.toggle:has-text("Write a passage under your mark again by itself") input')
    check('Who does what has both switches, off to begin with', await fix.count() == 1 and await lift.count() == 1 and not await fix.is_checked() and not await lift.is_checked())
    await fix.check(); await lift.check(); await pg.wait_for_timeout(500)
    await close_sheet(pg)
    # a page the judge passes: its fix goes in by itself
    await write(pg, 'The tide turns.')
    for i in range(120):
        prose = await pg.inner_text('#passages .passage >> nth=-1')
        if 'patient, unhurried' in prose: break
        await pg.wait_for_timeout(250)
    check('the checker’s fix goes in by itself, the words before one arrow away', 'patient, unhurried' in prose and '2 / 2' in await pg.inner_text('#passages .passage >> nth=-1 >> .pctl'), prose[:200])
    # a page under the mark: written again by itself, toward it
    await write(pg, 'He gave her a look that meant he was sorry. And she knew, at last, that she was home.')
    for i in range(160):
        prose = await pg.inner_text('#passages .passage >> nth=-1')
        if 'A rewritten passage' in prose: break
        await pg.wait_for_timeout(250)
    asked = [x for x in reqs() if 'written again' in json.dumps(x['body'].get('messages') or []) and 'End on what Mara does next' in json.dumps(x['body'].get('messages') or [])]
    check('a page under the mark is written again by itself, with what the judge said it needs', 'A rewritten passage' in prose and len(asked) == 1, (prose[:160], len(asked)))
    await pg.wait_for_timeout(1500)
    writ = await pg.inner_text('#writeBtn')
    check('and the writer is his again', writ.strip() == 'Write', writ)
    # both off again, for the walks after (the house is shared)
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if not await pg.locator(f'{grp} label.toggle:has-text("Apply the checker")').is_visible():
        await pg.click('.sheet.on .ghead:has-text("Who does what")'); await pg.wait_for_timeout(200)
    await pg.locator(f'{grp} label.toggle:has-text("Apply the checker’s fixes by themselves") input').uncheck()
    await pg.locator(f'{grp} label.toggle:has-text("Write a passage under your mark again by itself") input').uncheck()
    await pg.wait_for_timeout(500)
    await close_sheet(pg)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (by itself)', not errs, errs[:5])
    await pg.close()

async def main():
    import tempfile
    tmp = tempfile.mkdtemp()
    with Env() as env:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for sc in (scenario_back, scenario_middle, scenario_thinking, scenario_round, lambda b: scenario_bring_in(b, tmp), scenario_look, scenario_windows, scenario_follow, scenario_made_while_asked, scenario_checker, scenario_judge, scenario_auto, scenario_crafts, scenario_versions, scenario_partner, lambda b: scenario_offline(b, env)):
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
