"""More of the app in a real browser: Back through menus and sheets, writing
from the middle, scene breaks, a chapter split off, thinking, full screen,
the scroller and passage numbers, the partner's changes, Automatic, the
settings' defaults, bringing a book in, the look kept on the device,
chapters removed and brought back, the server stopping and starting under
an open page."""
import asyncio, json, os, sys, time, traceback, subprocess, urllib.request
from harness import *

RESULTS = []
NARRATOR_STARTING = 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.'

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
    folded = await pg.evaluate("document.querySelector('.passage.selected .thinkbox .words').textContent")
    check('a folded box holds none of its words until it is opened', folded == '', folded[:80])
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
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)', timeout=8000)
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
    await pg.click('.sheet button.swatch[data-world="tokyo"]')
    await pg.wait_for_timeout(200)
    check('a world is chosen at once', await pg.evaluate("document.documentElement.dataset.world") == 'tokyo', '')
    await pg.wait_for_timeout(900)
    other = await b.new_context(viewport={'width': 1280, 'height': 800})
    pg2 = await other.new_page()
    await pg2.goto(f'http://127.0.0.1:{PORT}/')
    await pg2.wait_for_selector('#shelf:not([hidden])', timeout=8000)
    await pg2.wait_for_timeout(500)
    check('another browser opens in the same world', await pg2.evaluate("document.documentElement.dataset.world") == 'tokyo', await pg2.evaluate("document.documentElement.dataset.world"))
    await pg.click('.sheet button.mode-choice[data-mode="light"]')
    await pg.wait_for_timeout(2500)
    check('and follows a change of light made in the first, by itself', await pg2.evaluate("document.documentElement.dataset.world === 'tokyo' && document.documentElement.dataset.mode === 'light'"), await pg2.evaluate("({...document.documentElement.dataset})"))
    await pg.click('.sheet button.swatch[data-world="academy"]')
    await pg.click('.sheet button.mode-choice[data-mode="dark"]')
    await pg.wait_for_timeout(900)
    await other.close()
    await pg.close()

async def scenario_offline(b, env):
    """the server stops under an open page, then comes back"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='Power Cut')
    await pg.wait_for_timeout(500)
    # another book whose chapter the phone cannot read (its file damaged, with no earlier copy)
    rq = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/store/novel/n-damaged', method='PUT', headers={'Content-Type': 'application/json', 'X-Base': '0', 'X-Client': 'another-device'},
                                data=json.dumps({'data': {'id': 'n-damaged', 'meta': {'title': 'Damaged', 'subtitle': '', 'cover': 'ember', 'words': 0, 'chapters': 1, 'created': 1, 'written': 1, 'opened': 0, 'archived': False},
                                                          'brief': '', 'style': '', 'plans': '', 'order': ['c-damaged'], 'notes': {'people': [], 'places': [], 'lore': [], 'threads': []}, 'memory': {'seen': {}, 'removed': [], 'undo': None, 'at': 0}, 'prefs': {}, 'plays': []}}).encode())
    urllib.request.urlopen(rq).read()
    os.makedirs(os.path.join(env.home, 'store', 'chapter'), exist_ok=True)
    with open(os.path.join(env.home, 'store', 'chapter', 'c-damaged.json'), 'w') as f:
        f.write('{damaged')
    await pg.click('#searchBtn')
    await pg.wait_for_selector('.sheet.on .searchtop')
    await pg.click('.sheet.on .segmented button:has-text("All books")')
    await pg.fill('.sheet.on input[type=search]', 'nowhere at all')
    try:
        await pg.wait_for_function("/could not be read/.test(document.querySelector('.sheet.on .searchsay').textContent)", timeout=15000)
        say = await pg.inner_text('.sheet.on .searchsay')
        check('a search says the chapter it could not read — never that the words are nowhere in it', 'One chapter could not be read' in say and 'in your books' not in say, say)
    except Exception as e:
        check('a search says the chapter it could not read — never that the words are nowhere in it', False, await pg.inner_text('.sheet.on .searchsay'))
    await close_sheet(pg)
    env.srv.terminate(); env.srv.wait()
    await pg.fill('#direction', 'Typed while the server was away.')
    await pg.click('#mineBtn')
    try:
        await pg.wait_for_selector('#banner:not([hidden])', timeout=20000)
        check('the page says the server is not answering', 'not answering' in await pg.inner_text('#banner'), '')
    except Exception as e:
        check('the page says the server is not answering', False, e)
    # a search of every book while the phone does not answer says what it could not read
    await pg.click('#searchBtn')
    await pg.wait_for_selector('.sheet.on .searchtop')
    await pg.click('.sheet.on .segmented button:has-text("All books")')
    await pg.fill('.sheet.on input[type=search]', 'server was away')
    try:
        await pg.wait_for_function("(() => { const t = document.querySelector('.sheet.on .searchsay').textContent; return /could not be read/.test(t) && !/nowhere at all/.test(t); })()", timeout=15000)
        say = await pg.inner_text('.sheet.on .searchsay')
        check('searching every book while the phone does not answer says only this book was searched — never that the words are nowhere', say.startswith('1 place.') and 'only this book was searched' in say, say)
    except Exception as e:
        check('searching every book while the phone does not answer says only this book was searched — never that the words are nowhere', False, await pg.inner_text('.sheet.on .searchsay'))
    await close_sheet(pg)
    # a copy of everything is not taken while words wait to reach the phone
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if not await pg.locator('.sheet.on .group[data-key="set.backups"] button:has-text("Take a copy of everything")').is_visible():
        await pg.click('.sheet.on .group button.ghead:has-text("Backups")'); await pg.wait_for_timeout(200)
    await pg.click('.sheet.on button:has-text("Take a copy of everything")')
    try:
        await pg.wait_for_function("document.querySelector('#toast') && /not reached the phone yet/.test(document.querySelector('#toast').textContent)", timeout=15000)
        check('a copy of everything is not taken while words wait to reach the phone — he is told why', (await pg.evaluate('location.pathname')) == '/')
    except Exception as e:
        check('a copy of everything is not taken while words wait to reach the phone — he is told why', False, await pg.evaluate("document.querySelector('#toast') ? document.querySelector('#toast').textContent : location.href"))
    await close_sheet(pg)
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
    check('what he wrote meanwhile is saved once it answers', any('server was away' in t for t in texts), (texts, nov['order'], ch.get('passages')))
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
    check('a box for the narrator, with its starting words', (await narr.count()) == 1 and await narr.input_value() == NARRATOR_STARTING)
    await narr.fill('MY NARRATOR.')
    await pg.wait_for_timeout(700)
    await pg.locator('.sheet.on label.field:has(span:text-is("How the narrator tells scenes")) + .btnrow button:has-text("Back to the default")').click()
    await pg.wait_for_function("document.querySelectorAll('.sheet.on').length === 2", timeout=3000)
    await pg.locator('.sheet.on >> nth=-1').locator('button:has-text("Back to the default")').click()
    await pg.wait_for_timeout(700)
    check('Back to the default puts the starting words back', await narr.input_value() == NARRATOR_STARTING, await narr.input_value())
    house = await pg.evaluate("fetch('/api/store/house/house').then(r => r.json()).then(j => j.data)")
    check('…and they are what the phone keeps', (house.get('instructions') or {}).get('narrator', '') == NARRATOR_STARTING, (house.get('instructions') or {}).get('narrator', '')[:60])
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
    first = (await pg.get_attribute('#scroller .thumb', 'aria-valuenow') or '') if vis else ''
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
    last = await pg.get_attribute('#scroller .thumb', 'aria-valuenow') or ''
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
    jb = await pg.locator('.sheet.on details.judgebox summary').all_inner_texts()
    line = (await pg.inner_text('#passages .passage >> nth=-1 >> .pctl .note >> nth=0')).lower()
    check('the grade stays through Apply: the judge’s box still says it, and the passage’s line says its grade and that the fixes are in', len(jb) == 1 and 'graded 10 of 10' in jb[0].lower() and 'graded 10 of 10' in line and 'the checker’s fixes put in' in line, (jb, line))
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
    # his own words, read as Grammarly reads: a sentence in a weak passive is a Clarity card
    await pg.fill('#direction', 'The choice was made by her to stay.'); await pg.click('#mineBtn')
    await pg.wait_for_function("document.querySelector('#checkBubble').dataset.state === 'found'", timeout=15000)
    await pg.click('#checkBubble'); await pg.wait_for_selector('.sheet.on .sug')
    tags = await pg.locator('.sheet.on .sug .tag').all_inner_texts()
    check('his own words are checked too, and a clarity fix says Clarity', [t.lower() for t in tags] == ['clarity'], tags)
    await pg.locator('.sheet.on .sug:has-text("She chose") button:has-text("Leave it")').click(); await pg.wait_for_timeout(300)
    if await pg.locator('.sheet.on').count(): await close_sheet(pg)
    # checked with the judge off: once it is on, said, and Check this chapter grades it — never sent by itself
    async def judge_on(on):
        await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
        await pg.wait_for_selector('.sheet.on')
        jt = pg.locator('.sheet.on label.toggle:has-text("The judge grades each passage") input')
        if not await jt.is_visible():
            await pg.click('.sheet.on .ghead:has-text("Who does what")'); await pg.wait_for_timeout(200)
        await (jt.check() if on else jt.uncheck()); await pg.wait_for_timeout(500)
        await close_sheet(pg)
    await judge_on(False)
    await pg.fill('#direction', 'Mara kept no diary.'); await pg.click('#mineBtn')
    for i in range(80):
        if any('Mara kept no diary' in json.dumps(x['body'].get('messages') or []) and 'Check these passages from' in json.dumps(x['body'].get('messages') or []) for x in reqs()): break
        await pg.wait_for_timeout(250)
    await pg.wait_for_function("['clean', 'found'].includes(document.querySelector('#checkBubble').dataset.state)", timeout=15000)
    await pg.wait_for_timeout(800)
    await judge_on(True)
    sent = len(reqs())
    await pg.wait_for_timeout(2500)
    await pg.click('#checkBubble'); await pg.wait_for_selector('.sheet.on .sugstate')
    said = await pg.inner_text('.sheet.on .sugstate')
    btn = pg.locator('.sheet.on button:has-text("Check this chapter")')
    check('a passage checked with the judge off is said not graded yet, with Check this chapter — never sent by itself', 'checked but not graded yet' in said and await btn.count() == 1 and len(reqs()) == sent, (said, await btn.count(), len(reqs()) - sent))
    await btn.click()
    for i in range(80):
        st = await pg.get_attribute('#checkBubble', 'data-state')
        now = await pg.inner_text('.sheet.on .sugstate') if await pg.locator('.sheet.on .sugstate').count() else ''
        if st in ('clean', 'found') and 'not graded yet' not in now and len(reqs()) > sent: break
        await pg.wait_for_timeout(250)
    if await pg.locator('.sheet.on').count(): await close_sheet(pg)
    await pg.click('#passages .passage >> nth=-1', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(300)
    line = (await pg.inner_text('#passages .passage >> nth=-1 >> .pctl .note >> nth=0')).lower()
    asked = [x for x in reqs()[sent:] if 'Answer every check of every passage' in json.dumps(x['body'].get('messages') or [])]
    check('Check this chapter asks for the grade alone, and the passage’s line says it', 'graded 10 of 10' in line and len(asked) >= 1 and all('Suggest only what is worth changing' not in json.dumps(x['body'].get('messages') or []) for x in asked), (line, len(asked)))
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
    check('boxes still holding the old starting words get today’s when the app starts', ins['system'].startswith('You are a master novelist') and ins['narrator'] == NARRATOR_STARTING, (ins['system'][:60], ins['narrator'][:80]))
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
    check('the narrator reads his preset’s opening, the scene craft and his module', sysp.startswith(NARRATOR_STARTING) and 'Role = you handle narration' in sysp and 'MY OWN MODULE' in sysp and '## The Telling\nI bring you premises' not in sysp, sysp[:160])
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
    key = await pg.inner_text('#sidePane .keycard .notekey') if await pg.locator('#sidePane .keycard .notekey').count() else ''
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
    # how each note at the end rides: Sent as, the book's and the scenes' each its own
    sent_as = '.sheet.on label.field:has(> span:text-is("Sent as")) select'
    check('each note at the end has its Sent as — the setup’s words to begin with', await pg.locator(sent_as).count() == 2 and await pg.input_value(f'{sent_as} >> nth=0') == 'system' and await pg.input_value(f'{sent_as} >> nth=1') == 'system')
    await pg.select_option(f'{sent_as} >> nth=0', 'assistant'); await pg.select_option(f'{sent_as} >> nth=1', 'user'); await pg.wait_for_timeout(800)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    check('Sent as is kept, each note its own', house['instructions'].get('lateAs') == 'assistant' and house['instructions'].get('lateNarratorAs') == 'user', house['instructions'])
    # words in the storyteller's own voice: each in a sheet of its own, kept as he goes, taken out with Undo
    await pg.click('.sheet.on button:has-text("Add words")'); await pg.wait_for_timeout(500)
    top = '.sheet.on >> nth=-1'
    await pg.fill(f'{top} >> label.field:has(> span:text-is("Name")) input', 'Stay Batman')
    await pg.select_option(f'{top} >> label.field:has(> span:text-is("Whose words")) select', 'you')
    await pg.select_option(f'{top} >> label.field:has(> span:text-is("Where they ride")) select', 'before-pages')
    await pg.select_option(f'{top} >> label.field:has(> span:text-is("Who reads them")) select', 'play')
    await pg.fill(f'{top} >> label.field:has(> span:text-is("The words")) textarea', 'Batman here.')
    await close_sheet(pg); await pg.wait_for_timeout(900)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    ow = house.get('ownWords') or []
    row = await pg.inner_text('.sheet.on .ownlist .modrow') if await pg.locator('.sheet.on .ownlist .modrow').count() else ''
    check('words in the storyteller’s own voice are kept as he set them, and the list says whose, where and for whom', len(ow) == 1 and ow[0].get('name') == 'Stay Batman' and ow[0].get('role') == 'you' and ow[0].get('place') == 'before-pages' and ow[0].get('to') == 'play' and ow[0].get('text') == 'Batman here.' and 'Stay Batman' in row and 'Your words, before the story — for the narrator' in row, (ow, row))
    await pg.click('.sheet.on .ownlist .modrow'); await pg.wait_for_timeout(400)
    await pg.click('.sheet.on >> nth=-1 >> button:has-text("Remove these words")'); await pg.wait_for_timeout(600)
    gone = len(((await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']).get('ownWords') or [])
    await pg.click('#toast button:has-text("Undo")'); await pg.wait_for_timeout(800)
    back = ((await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']).get('ownWords') or []
    check('Remove these words takes them out, and Undo puts them back', gone == 0 and len(back) == 1 and back[0].get('text') == 'Batman here.', (gone, back))
    # (as they were, for the walks after: the house is shared)
    await pg.click('.sheet.on .ownlist .modrow'); await pg.wait_for_timeout(400)
    await pg.click('.sheet.on >> nth=-1 >> button:has-text("Remove these words")'); await pg.wait_for_timeout(500)
    await pg.select_option(f'{sent_as} >> nth=0', 'system'); await pg.select_option(f'{sent_as} >> nth=1', 'system'); await pg.wait_for_timeout(700)
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
    check('the partner’s quick asks, each with its line — the notes’ check the same as the notes’ own, no second way to tidy them', 'Check the notes against the book' in items and 'Tidy the notes' not in items and await pg.locator('.menu-pop button .mhint').count() == len(items), items)
    # the quick ask asks the helper's check — no message to the partner
    async def talk_turns():
        t = await pg.evaluate(f"fetch('/api/store/talk/{nid}').then((r) => r.ok ? r.json() : null)")
        return len(((t or {}).get('data') or {}).get('turns') or [])
    before_turns = await talk_turns()
    # the take on show is read by now (until then its notes are the book's before it: none)
    await until(lambda n: len((n.get('notes') or {}).get('people', [])) > 0, 20000)
    await pg.click('.menu-pop button:has-text("Check the notes against the book")'); await pg.wait_for_timeout(600)
    n = await novel()
    after_turns = await talk_turns()
    check('the quick ask is the helper’s check, the same as the notes’ button — nothing sent to the partner', ((n.get('memory') or {}).get('auditAsked') is True or ((n.get('memory') or {}).get('audit') or {}).get('checked')) and after_turns == before_turns, (n.get('memory') or {}).get('audit'))
    errs = [l for l in logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no errors on the page', not errs, errs[:3])

async def scenario_notes(b):
    """the notes: the check against the book with its verdict and reasons, a card saved with only what he typed, his unsaved words kept on Back, what its model would not read"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Notes Kept')
    await add_conn(pg)
    await write(pg, 'Mara finds a bottle.')
    nid = await pg.evaluate("location.hash.split('/')[2]")
    novel = lambda: pg.evaluate(f"fetch('/api/store/novel/{nid}').then((r) => r.json()).then((j) => j.data)")
    async def until(test, t=15000):
        for _ in range(t // 200):
            n = await novel()
            if test(n):
                return n
            await pg.wait_for_timeout(200)
        return await novel()
    n = await until(lambda n: len((n.get('notes') or {}).get('people', [])) > 0)
    await pg.click('#notesBtn'); await pg.wait_for_timeout(400)
    report = await pg.inner_text('#sidePane .checkbox')
    check('the notes say when they were checked against the book — not yet, and when they will be', 'Not checked against the book yet' in report and 'more reading' in report, report)
    await pg.click('#sidePane button:has-text("Check the notes against the book")')
    n = await until(lambda n: ((n.get('memory') or {}).get('audit') or {}).get('checked'))
    await pg.wait_for_timeout(600)
    report = await pg.inner_text('#sidePane .checkbox')
    check('the check says plainly that every card holds and he can carry on, in its own words too', 'every card holds true to the book. You can carry on.' in report and 'Every card holds true to the book.' in report, report)
    # a newer page read into the notes since: the verdict says it is of the book as it was
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    await write(pg, 'Mara reads it twice.')
    n = await until(lambda n: (((n.get('memory') or {}).get('audit') or {}).get('reads') or 0) >= 1)
    await pg.click('#notesBtn'); await pg.wait_for_timeout(600)
    report = await pg.inner_text('#sidePane .checkbox')
    check('after newer pages are read, the verdict says it was of the book then — never “you can carry on” over them', 'held true to the book then' in report and 'reading of newer pages since, not checked yet' in report and 'You can carry on' not in report, report)
    # a card: only what he typed is saved, onto the card as it stands now
    await pg.click('#sidePane .notesec:has(h3:text-is("People")) .card >> nth=0'); await pg.wait_for_selector('.sheet.on')
    now_box = '.sheet.on label.field:has(span:text-is("Right now")) textarea'
    await pg.fill(now_box, 'HIS NOW: asleep by the lamp.')
    await pg.evaluate(f"import('/js/store.js').then((s) => s.change('novel', '{nid}', (n) => {{ n.notes.people[0].about = 'THE HELPER WROTE THIS MEANWHILE.'; }}, {{ now: true }}))")
    await pg.click('.sheet.on button:has-text("Save")'); await pg.wait_for_timeout(700)
    n = await novel()
    card = n['notes']['people'][0]
    check('a card saved with only what he typed — the helper’s words written meanwhile stand', card.get('now') == 'HIS NOW: asleep by the lamp.' and card.get('about') == 'THE HELPER WROTE THIS MEANWHILE.' and (card.get('updated') or {}).get('by') == 'you', card)
    # his words, left with Back, come back when he opens it again
    await pg.click('#sidePane .notesec:has(h3:text-is("People")) .card >> nth=0'); await pg.wait_for_selector('.sheet.on')
    about_box = '.sheet.on label.field:has(span:text-is("Who they are")) textarea'
    await pg.fill(about_box, 'TYPED AND LEFT.')
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(500)
    if await pg.locator('.sheet.on').count():
        await pg.go_back(); await pg.wait_for_timeout(500)
    n = await novel()
    left = n['notes']['people'][0].get('about')
    await pg.click('#sidePane .notesec:has(h3:text-is("People")) .card >> nth=0'); await pg.wait_for_selector('.sheet.on')
    back = await pg.input_value(about_box)
    said = await pg.inner_text('.sheet.on .body')
    check('words typed into a card and left are kept, never saved by themselves, and back when it opens again', left == 'THE HELPER WROTE THIS MEANWHILE.' and back == 'TYPED AND LEFT.' and 'not saved yet, are back' in said, (left, back))
    # renamed by his hand: the old name stays among the others it goes by
    name_box = '.sheet.on label.field:has(span:text-is("Name")) input'
    old_name = await pg.input_value(name_box)
    await pg.fill(name_box, 'Mara Venn-Hale')
    await pg.fill(about_box, 'TYPED AND SAVED.')
    await pg.click('.sheet.on button:has-text("Save")'); await pg.wait_for_timeout(700)
    n = await novel()
    card = n['notes']['people'][0]
    check('a card renamed by his hand keeps its old name among the others it goes by', card['name'] == 'Mara Venn-Hale' and old_name in (card.get('aka') or []) and card.get('about') == 'TYPED AND SAVED.', card)
    # what its model would not read: said where the passage stands now, with why and Read it again
    # (a part no longer in the book is not listed — so a passage that is there)
    pid = await pg.evaluate("document.querySelector('#passages .passage').dataset.id || ''")
    await pg.evaluate(f"import('/js/store.js').then((s) => s.change('novel', '{nid}', (n) => {{ n.memory.aside = {{ '{pid}': {{ label: 'Chapter One, passage 9', why: 'its answer could not be read', at: Date.now() }} }}; }}, {{ now: true }}))")
    await pg.wait_for_timeout(600)
    aside = await pg.inner_text('#sidePane .lightcard.aside') if await pg.locator('#sidePane .lightcard.aside').count() else ''
    check('a part its model would not read is said in the notes where it stands now, with why and Read it again', pid and 'Chapter One, passage 1' in aside and 'could not be read' in aside and await pg.locator('#sidePane .lightcard.aside button:has-text("Read it again")').count() == 1, aside)
    await pg.click('#sidePane .lightcard.aside button:has-text("Read it again")'); await pg.wait_for_timeout(500)
    n = await novel()
    check('Read it again takes it off the list', not (n.get('memory') or {}).get('aside'), (n.get('memory') or {}).get('aside'))
    # notes too long for its model: checked a group at a time, one group straight after another — the round said as it goes, and as one check once done
    going = "{ at: Date.now(), reads: 0, v: 2, checked: true, fixed: 1, changes: [{ name: 'Card18', how: 'changed', why: 'the book says so' }], verdict: 'These hold.', clear: true, some: { checked: 12, all: 30 }, roundId: 'rd-x', roundAll: 30, roundLeft: 12, roundSeen: [], roundFixed: 1, roundChanges: [{ name: 'Card0', how: 'changed', why: 'the book says so' }], round: [], earlier: [] }"
    await pg.evaluate(f"import('/js/store.js').then((s) => s.change('novel', '{nid}', (n) => {{ n.memory.auditAsked = false; n.memory.audit = {going}; }}, {{ now: true }}))")
    await pg.wait_for_timeout(600)
    report = await pg.inner_text('#sidePane .checkbox')
    check('a round of the check made a group at a time says how far it has come, never “you can carry on” before every card is checked', '18 of the 30 cards so far: 1 card put right, the rest hold true to the book.' in report and 'one group straight after another — 18 of the 30 cards so far' in report and 'You can carry on' not in report, report)
    await pg.evaluate(f"import('/js/store.js').then((s) => s.change('novel', '{nid}', (n) => {{ n.memory.audit = {{ ...{going}, fixed: 1, roundLeft: 0, roundFixed: 2, roundChanges: [{{ name: 'Card0', how: 'changed', why: 'the book says so' }}, {{ name: 'Card18', how: 'changed', why: 'the book says so' }}] }}; }}, {{ now: true }}))")
    await pg.wait_for_timeout(600)
    report = await pg.inner_text('#sidePane .checkbox')
    check('a round done is said as one check of every card: what each group put right together, and he can carry on', '2 cards put right, the rest hold true to the book. You can carry on.' in report and 'Card0' in report and 'Card18' in report and 'all 30 cards were checked a group at a time' in report, report)
    errs = [l for l in logs if 'PAGEERROR' in l or l.startswith('error')]
    check('no errors on the page', not errs, errs[:3])

async def scenario_page_fails(b):
    """a page that did not come is said in its own chapter, with what it thought; a chapter removed while it is written stops the writing"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Failing Page')
    await add_conn(pg)
    await write(pg, 'Mara finds a bottle.')
    await pg.click('.nextchapter button')
    await pg.wait_for_function("document.querySelector('#chapnum').textContent.includes('Two')", timeout=5000)
    # chapter two asks, and he goes back to chapter one before the answer
    await pg.fill('#direction', 'SLOWFAIL the storm comes.')
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(300)
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    await pg.locator('#chaptersBody li').nth(0).locator('button.go').click()
    await pg.wait_for_function("document.querySelector('#chapnum').textContent === 'Chapter One'", timeout=5000)
    await pg.wait_for_function("document.querySelector('#toast') && /did not come/.test(document.querySelector('#toast').textContent)", timeout=8000)
    toast = await pg.inner_text('#toast')
    here = await pg.locator('#pageEnd .endcard.error, .endcard.error').count()
    check('he is told where he is, naming the chapter it was asked in — and the chapter he is in shows no failure of another', 'Chapter Two' in toast and here == 0, (toast, here))
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    await pg.locator('#chaptersBody li').nth(1).locator('button.go').click()
    await pg.wait_for_function("document.querySelector('#chapnum').textContent === 'Chapter Two'", timeout=5000)
    await pg.wait_for_timeout(300)
    card = await pg.inner_text('.endcard.error') if await pg.locator('.endcard.error').count() else ''
    check('back in its chapter, the reason waits there', 'The page did not come' in card and 'trouble on its side' in card, card[:200])
    await pg.click('.endcard.error button:has-text("Dismiss")'); await pg.wait_for_timeout(200)
    # a model that only thinks: what it thought is kept with the reason, to read and copy
    await pg.fill('#direction', 'ONLYTHINK and then nothing.')
    await pg.click('#writeBtn')
    await pg.wait_for_selector('.endcard.error .keptthought', timeout=8000)
    await pg.click('.endcard.error .keptthought summary'); await pg.wait_for_timeout(200)
    kept = await pg.inner_text('.endcard.error .keptthought')
    buttons = await pg.locator('.endcard.error button').all_inner_texts()
    check('a page that only thought keeps what it thought under the reason, with a way to copy it — no empty passage', 'I weigh the storm' in kept and 'Copy what it thought' in buttons and await pg.locator('#passages .passage').count() == 0, (kept[:120], buttons))
    # a chapter removed while its page is being written: the writing stops
    await pg.fill('#direction', 'SLOW the storm comes again.')
    await pg.click('#writeBtn')
    await pg.wait_for_function("document.querySelector('#writeBtn').textContent.trim() === 'Stop'", timeout=5000)
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    await pg.locator('#chaptersBody li').nth(1).locator('button.menu').click()
    await pg.click('.menu-pop button:has-text("Remove the chapter")')
    await pg.click('.sheet.on button:has-text("Remove it")')
    await pg.wait_for_timeout(600)
    busy = await pg.evaluate("import('/js/novel/writer.js').then((w) => w.busy(location.hash.split('/')[2]))")
    check('a chapter removed while its page is being written stops the writing at once', busy is False, busy)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (failures)', not errs, errs[:5])
    await pg.close()

async def scenario_partner_said(b):
    """the partner says what happened: a reply cut off inside its changes, Another answer only on the newest answer, a waiting change that can no longer land"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Partner Says')
    await add_conn(pg)
    await pg.fill('#direction', 'Rain hammered the glass. The sea was grey.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(400)
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    await pg.fill('#sideFoot textarea', 'CUT CHANGES please.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .turn.ai .cutnote', timeout=8000)
    words = await pg.inner_text('#sideBody .turn.ai >> nth=-1')
    check('a reply cut off inside its changes says none were made, and why it stopped', 'none of them were made' in words and 'It stopped partway' in words and 'ran out of room' in words and 'Making the changes' not in words, words[:300])
    await pg.fill('#sideFoot textarea', 'Anything else?')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_function("document.querySelectorAll('#sideBody .turn.ai').length >= 2 && !document.querySelector('#sideBody .turn.streaming')", timeout=8000)
    await pg.wait_for_timeout(300)
    n_again = await pg.locator('#sideBody .turn.ai .tctl button:has-text("Another answer")').count()
    last_again = await pg.locator('#sideBody .turn.ai >> nth=-1 >> .tctl button:has-text("Another answer")').count()
    check('Another answer is offered on the newest answer only', n_again == 1 and last_again == 1, (n_again, last_again))
    # set to wait: a change whose words are gone since can no longer land — said, with no Apply
    await pg.evaluate("import('/js/store.js').then((s) => s.change('house', 'house', (h) => { h.partnerApplies = 'wait'; }, { now: true }))")
    await pg.fill('#sideFoot textarea', 'CHANGE THE PASSAGE please.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .change.waiting', timeout=8000)
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    await pg.click('#passages .passage >> nth=0'); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.fill('.editbox', 'Snow fell on the glass. The sea was grey.')
    await pg.click('.editrow button:has-text("Save")'); await pg.wait_for_timeout(500)
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(500)
    row = await pg.inner_text('#sideBody .change.waiting >> nth=-1')
    applies = await pg.locator('#sideBody .change.waiting >> nth=-1 >> button:has-text("Apply")').count()
    check('a waiting change whose words are gone since says it can’t be made now, and offers no Apply', 'can’t be made now' in row and 'not there' in row and applies == 0, row[:200])
    await pg.evaluate("import('/js/store.js').then((s) => s.change('house', 'house', (h) => { h.partnerApplies = 'now'; }, { now: true }))")
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
    await pg.wait_for_timeout(500)
    check('one box to ask the partner, however often its talk is drawn again', await pg.locator('#sideFoot textarea').count() == 1 and await pg.locator('#sideFoot button:has-text("Send")').count() == 1, await pg.locator('#sideFoot textarea').count())
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

async def scenario_suggestions_more(b):
    """Suggestions: a passage set aside with Check it again, a fault not counted, a writing-again that failed, where it joins; an edit made on the words it opened"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Set Aside Book')
    await add_conn(pg)
    await pg.fill('#direction', 'Mara climbed the stair. The lamp was lit.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    for i in range(80):
        if await pg.get_attribute('#checkBubble', 'data-state') == 'clean': break
        await pg.wait_for_timeout(250)
    # the checker's model would not check it, twice: set aside as the checker keeps it
    ids = await pg.evaluate("""async () => {
      const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js'); const util = await import('/js/util.js');
      const checker = await import('/js/novel/checker.js'); const archivist = await import('/js/novel/archivist.js');
      const D = (await import('/js/ui/desk.js')).deskState(); const nid = D.novelId; const cid = D.chapterId;
      const c = store.peek('chapter', cid); const p = c.passages[0]; const v = shape.picked(p);
      const conn = archivist.connPrint(checker.checkerConn(store.peek('house', 'house')));
      store.change('chapter', cid, shape.chapterSteps.setCheck(p.id, v.id, { round: 'ck-x', sig: util.hashText(v.text), at: Date.now(), items: [], aside: 'its answer could not be read (it began: “I am sorry, I cannot help with that.”)', conn }), { now: true });
      return { nid, cid, pid: p.id, vid: v.id };
    }""")
    await pg.wait_for_timeout(300)
    words = await pg.get_attribute('#checkBubble', 'aria-label')
    check('the bubble says a passage was set aside, and where to find it', 'One passage its model would not check — in Suggestions, with Check it again.' in (words or ''), words)
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .asidebox')
    summary = (await pg.inner_text('.sheet.on .asidebox summary')).strip()
    check('Suggestions holds the passage set aside, folded', summary == 'Set aside — one passage its model would not check', summary)
    await pg.click('.sheet.on .asidebox summary'); await pg.wait_for_timeout(200)
    box = await pg.inner_text('.sheet.on .asidebox')
    btn = pg.locator('.sheet.on .asidebox button:has-text("Check it again")')
    title = (await btn.get_attribute('title') or '') if await btn.count() else ''
    check('each with why, where it is, and Check it again — saying what it does', 'I am sorry, I cannot help' in box and 'Chapter One, passage 1' in box and await btn.count() == 1 and 'check this passage again' in title.lower(), (box[:300], title))
    await btn.click()
    for i in range(80):
        if not await pg.locator('.sheet.on .asidebox').count() and await pg.get_attribute('#checkBubble', 'data-state') == 'clean': break
        await pg.wait_for_timeout(250)
    check('Check it again checks it afresh: the box goes and the bubble is green', not await pg.locator('.sheet.on .asidebox').count() and await pg.get_attribute('#checkBubble', 'data-state') == 'clean', await pg.get_attribute('#checkBubble', 'aria-label'))
    await close_sheet(pg)
    # a passage under his mark: a "no" whose words are not on the page, and a writing-again by itself that failed
    await pg.fill('#direction', 'He gave her a look that meant he was sorry. Her voice was barely above a whisper. And she knew, at last, that she was home.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    for i in range(80):
        if await pg.get_attribute('#checkBubble', 'data-state') == 'found': break
        await pg.wait_for_timeout(250)
    await pg.evaluate("""async () => {
      const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js');
      const D = (await import('/js/ui/desk.js')).deskState(); const nid = D.novelId; const cid = D.chapterId;
      const c = store.peek('chapter', cid);
      const p1 = c.passages[0]; const p2 = c.passages[1];
      store.change('chapter', cid, (ch) => {
        const e = ch.checks[p2.id][shape.picked(p2).id];
        const card = e.items.find((x) => x.kind === 'grade');
        card.grade.faults.push({ check: 'pacing', unverified: true, why: 'it rushes the end' });
        const e1 = ch.checks[p1.id][shape.picked(p1).id];
        e1.items.push({ id: 'sg-seam', kind: 'seam', find: 'Mara climbed the stair.', replace: 'Mara climbed on up the stair.', why: 'it carries on from where the story stopped' });
      }, { now: true });
      store.change('chapter', cid, shape.chapterSteps.setVersion(p2.id, shape.picked(p2).id, { liftFailed: { at: Date.now(), why: 'the provider refused the request' } }), { now: true });
    }""")
    await pg.wait_for_timeout(300)
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .sug')
    cards = await pg.locator('.sheet.on .sug').all_inner_texts()
    grade = next((c for c in cards if 'UNDER YOUR MARK' in c.upper()), '')
    check('a “no” whose words are not in the passage is shown, said not counted', 'Pacing — it rushes the end — its words were not found in the passage, so it is not counted' in grade and '7 of 10' in grade, grade)
    check('a writing-again by itself that failed is said on its grade, and the button is still there', 'Written again by itself, it did not come: the provider refused the request. It is not tried by itself again' in grade and 'Write it again toward 9' in grade, grade)
    seam = next((c for c in cards if 'WHERE IT JOINS' in c.upper()), '')
    check('a fix where a passage joins the one before has its own name', 'Mara climbed on up the stair.' in seam and 'it carries on from where the story stopped' in seam, cards)
    titles = await pg.evaluate("[...document.querySelectorAll('.sheet.on .sug button')].filter((x) => !x.classList.contains('link')).map((x) => [x.textContent.trim(), x.title])")
    check('every button in Suggestions says what it does', titles and all(t for _, t in titles), titles)
    await close_sheet(pg)
    # his edit, made on the words he opened: a version that comes meanwhile stays one arrow back
    await pg.click('#passages .passage >> nth=0', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.wait_for_selector('.editbox')
    opened = await pg.evaluate("""async () => { const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js');
      const D = (await import('/js/ui/desk.js')).deskState(); const nid = D.novelId; const cid = D.chapterId; const p = store.peek('chapter', cid).passages[0]; const v = shape.picked(p);
      store.change('chapter', cid, shape.chapterSteps.addVersion(p.id, shape.newVersion({ text: 'Mara climbed the long stair. The lamp was lit.', how: 'suggested' })), { now: true });
      return v.id; }""")
    await pg.wait_for_timeout(300)
    box = await pg.input_value('.editbox')
    check('the box keeps the words it was opened on while another version comes', box == 'Mara climbed the stair. The lamp was lit.', box)
    await pg.fill('.editbox', 'Mara climbed the stair slowly. The lamp was lit.')
    await pg.click('.editrow button:has-text("Save")')
    await pg.wait_for_timeout(400)
    toast = await pg.inner_text('#toast')
    got = await pg.evaluate("""async () => { const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js');
      const D = (await import('/js/ui/desk.js')).deskState(); const nid = D.novelId; const cid = D.chapterId; const p = store.peek('chapter', cid).passages[0];
      return { n: p.versions.length, text: shape.picked(p).text, from: shape.picked(p).from, before: p.versions[1].text }; }""")
    check('his edit is made on the words he opened, the version that came meanwhile one arrow back — and said', got['n'] == 3 and got['text'] == 'Mara climbed the stair slowly. The lamp was lit.' and got['from'] == opened and got['before'] == 'Mara climbed the long stair. The lamp was lit.' and 'Another version came while you edited — it is one arrow back.' in toast, (got, toast))
    # nothing goes in by itself under his open box: the fixes wait, and go in once it closes
    # As the switch does in the app, begin with newly written pages. A zero
    # date also rewrites the earlier stock-wording fixture, leaving the
    # whole-book bubble busy after this target's own fixes have arrived.
    await pg.evaluate("import('/js/store.js').then((s) => s.change('house', 'house', (h) => { h.autoFix = { on: true, from: Date.now() }; h.judge = { on: false }; }, { now: true }))")
    await write(pg, 'The keeper waits.')
    await pg.click('#passages .passage >> nth=-1', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.wait_for_selector('.editbox')
    snapshot = """async () => {
      const store = await import('/js/store.js'); const checker = await import('/js/novel/checker.js');
      const D = (await import('/js/ui/desk.js')).deskState(); const c = store.peek('chapter', D.chapterId);
      const p = c.passages[c.passages.length - 1]; const e = checker.entryFor(c, p);
      return { versions: [p.versions.length, p.versions[p.versions.length - 1].how],
        found: Boolean(e && (e.items || []).some((x) => typeof x.replace === 'string')),
        bubble: document.querySelector('#checkBubble').dataset.state };
    }"""
    for i in range(80):
        shown = await pg.evaluate(snapshot)
        if shown['found'] and shown['bubble'] == 'found': break
        await pg.wait_for_timeout(250)
    count = "(async () => { const store = await import('/js/store.js'); const D = (await import('/js/ui/desk.js')).deskState(); const c = store.peek('chapter', D.chapterId); const p = c.passages[c.passages.length - 1]; return [p.versions.length, p.versions[p.versions.length - 1].how]; })()"
    held = shown['versions']
    check('a fix found while his box is open waits behind the bubble, never put in under his hand', held == [1, 'write'] and shown['found'] and shown['bubble'] == 'found', shown)
    await pg.click('.editrow button:has-text("Cancel")')
    went = held
    for i in range(40):
        went = await pg.evaluate(count)
        if went[0] == 2: break
        await pg.wait_for_timeout(250)
    check('once the box is closed, it goes in by itself', went == [2, 'suggested'], went)
    # (the house as it was, for the walks after)
    await pg.evaluate("import('/js/store.js').then((s) => s.change('house', 'house', (h) => { delete h.autoFix; delete h.judge; }, { now: true }))")
    await pg.wait_for_timeout(300)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (Suggestions, the edit box)', not errs, errs[:5])
    await pg.close()

async def scenario_page_whole(b):
    """the page made whole: a heading taken off and put back from the passage's menu; pages kept from before mended once when the book opens"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Whole Page')
    await add_conn(pg)
    await write(pg, 'HEADING PLEASE')
    # (the page's own words: a thinking box above them, from a connection that thinks, is no part of the page)
    prose = await pg.inner_text('#passages .passage >> nth=-1 >> .prose')
    check('a heading the writer put above a new page is not on the page', 'Chapter Three: The Storm' not in prose and prose.strip().startswith('Rain hammered'), prose[:120])
    await pg.click('#passages .passage >> nth=-1', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    item = pg.locator('.menu-pop button:has-text("Put back what was taken off its top")')
    hint = await item.inner_text() if await item.count() else ''
    check('the passage’s menu offers it back, saying what it does', await item.count() == 1 and 'What the writer put above the story — a heading, or its plan' in hint, hint)
    await item.click(); await pg.wait_for_timeout(500)
    prose = await pg.inner_text('#passages .passage >> nth=-1 >> .prose')
    check('Put back puts the heading back at the top, as a new version', 'Chapter Three: The Storm' in prose.split('\n')[0] and '2 / 2' in await pg.inner_text('.passage.selected .pctl'), prose[:160])
    # a page kept from before, with tracking and a note after it: mended once, when the book opens
    await pg.evaluate("""async () => {
      const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js');
      const D = (await import('/js/ui/desk.js')).deskState();
      const c = store.peek('chapter', D.chapterId);
      const old = shape.newPassage('ai', 'Mara counted the ships that night, one by one, until the last light went under the edge of the world and only the lamp was left. ' + 'The wind came round to the west and the glass sang in its frame. '.repeat(2) + '\\n\\n{PULSE}\\nMara: tired\\n{/PULSE}\\n\\nI hope this captures the scene.', { how: 'write' });
      store.change('chapter', D.chapterId, shape.chapterSteps.addPassage(old), { now: true });
      store.change('novel', D.novelId, (n) => { n.memory = n.memory || {}; delete n.memory.mended; }, { now: true });
      await store.flush();
    }""")
    hash_ = await pg.evaluate('location.hash')
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)', timeout=8000)
    await pg.goto(f'http://127.0.0.1:{PORT}/{hash_}')
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    try:
        await pg.wait_for_function("document.querySelector('#toast') && /made whole the way new ones are/.test(document.querySelector('#toast').textContent)", timeout=8000)
        toast = await pg.inner_text('#toast')
    except Exception:
        toast = await pg.evaluate("document.querySelector('#toast') ? document.querySelector('#toast').textContent : ''")
    prose = await pg.inner_text('#passages .passage >> nth=-1 >> .prose')
    check('a page kept from before is made whole when the book opens, and he is told', '1 page kept from before was made whole the way new ones are' in toast and '{PULSE}' not in prose and 'I hope this captures' not in prose, (toast, prose[-160:]))
    await pg.click('#passages .passage >> nth=-1', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    check('what came off it is kept, to put back', await pg.locator('.menu-pop button:has-text("Put back what was taken off its end")').count() == 1)
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (the page made whole)', not errs, errs[:5])
    await pg.close()

async def scenario_rest(b):
    """numbers as people type them, the shelf when the phone sends no list, Back while a book is opening"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Rest')
    await add_conn(pg)
    # his message taken out goes with the answer to it; Undo brings both back, in their place
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    for k, words in enumerate(['Hello there.', 'And again.']):
        await pg.fill('#sideFoot textarea', words)
        await pg.click('#sideFoot button:has-text("Send")')
        await pg.wait_for_function(f"document.querySelectorAll('#sideBody .turn.ai:not(.streaming)').length === {k + 1}", timeout=8000)
        await pg.wait_for_timeout(300)
    turns = "[...document.querySelectorAll('#sideBody .turn')].map((t) => (t.classList.contains('you') ? 'you: ' : 'ai: ') + (t.classList.contains('you') ? t.textContent.includes('Hello') ? 1 : 2 : ''))"
    await pg.click('#sideBody .turn.you >> nth=0 >> .tmore')
    item = pg.locator('.menu-pop button:has-text("Remove")')
    hint = await item.inner_text()
    await item.click(); await pg.wait_for_timeout(400)
    left = await pg.evaluate(turns)
    said = await pg.inner_text('#toast')
    check('Remove on his message takes the answer to it too, and says so', left == ['you: 2', 'ai: '] and 'with the answer to it' in said and 'and the answer to it go' in hint, (left, said, hint))
    await pg.click('#toast button.toastact'); await pg.wait_for_timeout(400)
    order = await pg.evaluate(turns)
    check('Undo brings both back, in their place', order == ['you: 1', 'ai: ', 'you: 2', 'ai: '], order)
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    # a scene written into the book up to the narrator's last telling: his move it has not answered stays, and he is told
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("Scenes")')
    await pg.fill('#sideBody input[list=cn-people]', 'Mara')
    await pg.click('#sideBody button:has-text("Begin the scene")')
    await pg.wait_for_selector('.turn.ai .tctl', timeout=8000)
    await pg.fill('#sideFoot textarea:not(.tellbox)', 'I walk down the steps to meet him.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_function("document.querySelectorAll('#sideBody .turn.ai .tctl').length >= 2", timeout=8000)
    await pg.wait_for_timeout(300)
    await pg.click('#sideBody .turn.ai >> nth=-1 >> .tmore')
    item = pg.locator('.menu-pop button:has-text("Remove")')
    hint = await item.inner_text()
    await item.click(); await pg.wait_for_timeout(400)
    before = await pg.locator('#passages .passage').count()
    await pg.click('#sideFoot button:has-text("Turn it into prose")')
    await pg.wait_for_function(f"document.querySelectorAll('#passages .passage').length > {before} && !document.querySelector('.passage.streaming')", timeout=10000)
    said = await pg.inner_text('#toast')
    asked = completions()[-1]['body']['messages'][-1]['content']
    check('a telling taken out says only that; the scene goes into prose up to the narrator\'s last telling — his move it never answered stays in the scene, and he is told', 'This telling goes from the scene, with Undo.' in hint and 'answer' not in hint and 'your last move stays in the scene' in said and 'I walk down the steps' not in asked, (hint, said, asked[:300]))
    # (on a phone the scene's pane closes as its prose is written: let it go before going on)
    try:
        await pg.wait_for_function("!document.querySelector('#sidePane').classList.contains('open')", timeout=4000)
        await pg.wait_for_timeout(500)
    except Exception:
        await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    # Show all in each version's notes is every one kept — past sixty too
    kept_n = await pg.evaluate("""async () => {
      const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js');
      const id = location.hash.split('/')[2];
      const chId = store.peek('novel', id).order[0];
      const ps = Array.from({ length: 70 }, (_, i) => shape.newPassage('ai', `Line ${i + 1}.`));
      store.change('chapter', chId, (c) => { c.passages.push(...ps); }, { now: true });
      const readings = {};
      ps.forEach((p, i) => { readings[p.id] = { [p.versions[0].id]: { at: Date.now() - 100000 - i * 1000, cards: [], sig: 'not-this', label: `Line ${i + 1}` } }; });
      store.change('novel', id, (n) => { n.memory = { ...(n.memory || {}), readings: { ...((n.memory || {}).readings || {}), ...readings } }; }, { now: true });
      /* read already, so the helper stays quiet while the list is looked at */
      const archivist = await import('/js/novel/archivist.js');
      const map = {};
      for (const p of store.peek('chapter', chId).passages) if (p.by !== 'break') map[p.id] = archivist.signature(shape.picked(p));
      store.change('novel', id, shape.novelSteps.seen(chId, map), { now: true });
      return Object.keys(readings).length;
    }""")
    await pg.click('#notesBtn'); await pg.wait_for_timeout(600)
    sec = '#sidePane .notesec:has(h3:text-is("Each version’s notes"))'
    if 'open' not in (await pg.get_attribute(sec, 'class') or ''):
        await pg.click(f'{sec} .sechead'); await pg.wait_for_timeout(200)
    more = pg.locator(f'{sec} button:has-text("Show all")')
    title = await more.get_attribute('title') if await more.count() else ''
    await more.click(); await pg.wait_for_timeout(400)
    shown = await pg.locator(f'{sec} .card.reading').count()
    check('Show all in each version’s notes shows every one kept — never sixty of them — and says what it does', kept_n == 70 and shown >= 70 and 'every one' in (title or ''), (kept_n, shown, title))
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    # a helper waiting out a failure: Try again now, saying what it does — pressed, it tries at once
    await pg.evaluate("async () => { const a = await import('/js/novel/archivist.js'); a.forTests().failures.set(location.hash.split('/')[2], { n: 3, until: Date.now() + 600000 }); }")
    await pg.click('#notesBtn'); await pg.wait_for_timeout(500)
    btn = pg.locator('#sidePane button:has-text("Try again now")')
    title = (await btn.get_attribute('title')) if await btn.count() else ''
    if await btn.count(): await btn.click()
    await pg.wait_for_timeout(300)
    said = await pg.inner_text('#toast')
    left = await pg.locator('#sidePane button:has-text("Try again now")').count()
    stalled = await pg.evaluate("async () => (await import('/js/novel/archivist.js')).stalled(location.hash.split('/')[2])")
    check('a helper waiting out a failure has Try again now, saying what it does — pressed, it tries at once', 'tries again at once' in (title or '') and 'tries again now' in said and left == 0 and stalled is False, (title, said, left, stalled))
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    # the checker stopped for a connection turned away: the same, in Suggestions
    await pg.evaluate("""async () => { const c = await import('/js/novel/checker.js'); const a = await import('/js/novel/archivist.js'); const s = await import('/js/store.js');
      c.forTests().blocked.set(location.hash.split('/')[2], a.connPrint(c.checkerConn(s.peek('house', 'house')))); }""")
    await pg.click('#checkBubble'); await pg.wait_for_timeout(400)
    btn = pg.locator('.sheet.on button:has-text("Try again now")')
    title = (await btn.get_attribute('title')) if await btn.count() else ''
    if await btn.count(): await btn.click()
    await pg.wait_for_timeout(300)
    said = await pg.inner_text('#toast')
    stalled = await pg.evaluate("async () => (await import('/js/novel/checker.js')).stalled(location.hash.split('/')[2])")
    check('a checker stopped for a connection turned away has Try again now in Suggestions — pressed, it tries at once', 'tries again at once' in (title or '') and 'checker tries again now' in said and stalled is False, (title, said, stalled))
    await close_sheet(pg)
    # every copy the phone keeps is listed — never twenty of them
    fake = {'copies': [{'name': f'cozy-2026-10-{i:02d}.zip', 'at': 1760000000000 + i * 86400000, 'size': 4096} for i in range(1, 26)]}
    await pg.route('**/api/copies', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fake)))
    await pg.evaluate("async () => (await import('/js/ui/settings.js')).openSettings()")
    await pg.wait_for_timeout(300)
    g = '.sheet.on section.group[data-key="set.backups"]'
    if 'fold' in (await pg.get_attribute(g, 'class') or ''):
        await pg.click(f'{g} > button.ghead'); await pg.wait_for_timeout(300)
    await pg.wait_for_function("(() => { const h = [...document.querySelectorAll('.sheet.on h4')].find((x) => x.textContent.includes('Copies kept on this phone')); return h && h.nextElementSibling && h.nextElementSibling.querySelector('li'); })()", timeout=8000)
    listed = await pg.evaluate("(() => { const h = [...document.querySelectorAll('.sheet.on h4')].find((x) => x.textContent.includes('Copies kept on this phone')); const box = h.nextElementSibling; return [box.querySelectorAll('li').length, [...box.querySelectorAll('li button')].every((x) => x.title)]; })()")
    check('every copy the phone keeps is listed, each Bring it back saying what it does', listed == [25, True], listed)
    await pg.unroute('**/api/copies')
    await close_sheet(pg)
    # a number typed the way people write it is the number they mean
    await pg.evaluate("async () => (await import('/js/ui/settings.js')).openSettings('connections')")
    await pg.wait_for_timeout(300)
    room = pg.locator('.sheet.on label.field:has(> span:text-is("The model’s room, in tokens")) input')
    await room.fill('8,000'); await pg.wait_for_timeout(700)
    longest = pg.locator('.sheet.on label.field:has(> span:text-is("Longest reply, in tokens")) input')
    await longest.fill('8.5'); await pg.wait_for_timeout(700)
    kept = await pg.evaluate("async () => { const s = await import('/js/store.js'); const c = s.peek('house', 'house').connections[0]; return [c.context, c.maxTokens === undefined]; }")
    said = await pg.locator('.sheet.on label.field:has(> span:text-is("Longest reply, in tokens")) .badnum').is_visible()
    check('"8,000" in the room is kept as 8000; "8.5" in Longest reply is said not kept, and nothing is kept for it', kept == [8000, True] and said, (kept, said))
    # emptied, each box keeps nothing: the model's own room again (and the walks after this one write with it)
    await room.fill(''); await pg.wait_for_timeout(700)
    await longest.fill(''); await pg.wait_for_timeout(700)
    kept = await pg.evaluate("async () => { const s = await import('/js/store.js'); const c = s.peek('house', 'house').connections[0]; return ['context' in c, 'maxTokens' in c]; }")
    gone_said = await pg.locator('.sheet.on label.field:has(> span:text-is("Longest reply, in tokens")) .badnum').is_visible()
    check('a number box emptied keeps nothing, and says nothing under it', kept == [False, False] and not gone_said, (kept, gone_said))
    await close_sheet(pg)
    # a connection let go: the parts it did, and who does them after it, said before and after
    await pg.evaluate("""async () => { const s = await import('/js/store.js');
      s.change('house', 'house', (h) => { h.connections.push({ id: 'c-zed', name: 'Zed Helper', url: h.connections[0].url, model: 'fake-writer', key: 'k' }); h.roles = { ...(h.roles || {}), helper: 'c-zed' }; }, { now: true }); }""")
    await pg.evaluate("async () => (await import('/js/ui/settings.js')).openSettings('connections')")
    await pg.wait_for_timeout(300)
    await pg.select_option('.sheet.on select[aria-label="Which connection"]', 'c-zed')
    await pg.wait_for_timeout(300)
    await pg.click('.sheet.on button.btn.danger:has-text("Let go") >> nth=0')
    await pg.wait_for_timeout(300)
    asked = await pg.inner_text('.sheet.on >> nth=-1')
    await pg.click('.sheet.on >> nth=-1 >> button:has-text("Let go")')
    await pg.wait_for_timeout(500)
    gone = await pg.inner_text('#toast')
    check('Let go says which parts the connection does and who does them after it — before and after', 'It is the helper and the checker now — they go to “My connection”, the writer.' in asked and '“Zed Helper” is gone — the helper and the checker are “My connection” now.' in gone, (asked[-200:], gone))
    await close_sheet(pg)
    await pg.evaluate("async () => (await import('/js/ui/settings.js')).openSettings('roles')")
    await pg.wait_for_timeout(300)
    mark = pg.locator('.sheet.on label.field:has(> span:text-is("Your mark")) input')
    await mark.fill('8/10'); await pg.wait_for_timeout(700)
    t1 = await pg.evaluate("async () => ((await import('/js/store.js')).peek('house', 'house').judge || {}).target")
    await mark.fill('eleven'); await pg.wait_for_timeout(700)
    t2 = await pg.evaluate("async () => ((await import('/js/store.js')).peek('house', 'house').judge || {}).target")
    bad = await pg.locator('.sheet.on label.field:has(> span:text-is("Your mark")) .badnum').is_visible()
    check('his mark "8/10" is kept as 8; a mark that is none is said, and 8 stays', t1 == 8 and t2 == 8 and bad, (t1, t2, bad))
    # emptied, the mark is the starting one again (9), nothing kept (and the walks after this one judge by it)
    await mark.fill(''); await pg.wait_for_timeout(700)
    t3 = await pg.evaluate("async () => 'target' in ((await import('/js/store.js')).peek('house', 'house').judge || {})")
    bad = await pg.locator('.sheet.on label.field:has(> span:text-is("Your mark")) .badnum').is_visible()
    check('his mark emptied keeps nothing — the starting mark again', t3 is False and not bad, (t3, bad))
    await close_sheet(pg)
    # the shelf when the phone sends no list: never shown as no books
    retry_requests = []
    shelf_recovered = False
    async def list_after_retry(route):
        nonlocal shelf_recovered
        if route.request.headers.get('x-test-shelf-retry') == 'clicked':
            retry_requests.append(route.request.url)
            shelf_recovered = True
        # Once the real retry reaches the phone, recovery must apply to later
        # catch-up requests too. Otherwise a newer artificial failure can
        # supersede the successful manual retry under concurrent test load.
        if shelf_recovered:
            await route.continue_()
        else:
            await route.abort()
    await pg.route('**/api/novels', list_after_retry)
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)', timeout=8000)
    # A successful startup request can start an automatic retry between two
    # browser reads. Inspect the error's words and button in the same DOM state,
    # before that legitimate retry replaces the notice with “Reading…”.
    unread = await pg.wait_for_function("""() => {
      const books = document.querySelector('#books');
      if (!books?.querySelector('.unread')) return null;
      return {
        text: books.innerText,
        retries: [...books.querySelectorAll('button')].filter((button) => button.textContent.includes('Try again')).length,
      };
    }""", timeout=8000)
    unread = await unread.json_value()
    shelf = unread['text']
    check('books the phone did not list are never shown as no books — it says so, with Try again', 'could not be read just now' in shelf and 'Every story starts somewhere' not in shelf and unread['retries'] == 1, unread)
    # Keep startup catch-up requests failing through the click. Mark only a
    # list request made during the real retry click, so automatic recovery
    # cannot remove the button first or satisfy this manual-retry assertion.
    await pg.evaluate("""() => {
      const original = window.fetch;
      let duringRetry = false;
      const clicked = (event) => {
        if (!event.target.closest('#books .unread button')) return;
        duringRetry = true;
        setTimeout(() => { duringRetry = false; }, 0);
      };
      document.addEventListener('click', clicked, true);
      window.fetch = (input, init = {}) => {
        const path = new URL(input instanceof Request ? input.url : input, location.href).pathname;
        if (duringRetry && path === '/api/novels') {
          const headers = new Headers(init.headers);
          headers.set('X-Test-Shelf-Retry', 'clicked');
          return original(input, { ...init, headers });
        }
        return original(input, init);
      };
      window.__restoreShelfRetry = () => {
        window.fetch = original;
        document.removeEventListener('click', clicked, true);
        delete window.__restoreShelfRetry;
      };
    }""")
    try:
        await pg.click('#books button:has-text("Try again")')
        await pg.wait_for_selector('#books button.cover', timeout=8000)
        check('Try again brings the books', len(retry_requests) == 1 and 'The Rest' in await pg.inner_text('#books'), (len(retry_requests), await pg.inner_text('#books')))
    finally:
        await pg.evaluate('window.__restoreShelfRetry?.()')
        await pg.unroute('**/api/novels', list_after_retry)
    # again, and this time the phone answers something else first: the books come by themselves
    await pg.route('**/api/novels', lambda r: r.abort())
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#books .unread', timeout=8000)
    # (the page's own catching up as it opens asks for the list too: it fails as well, before the phone answers again)
    await pg.wait_for_timeout(1200)
    await pg.unroute('**/api/novels')
    await pg.wait_for_timeout(800)
    still = await pg.locator('#books .unread').count()
    await pg.evaluate("async () => { await (await import('/js/store.js')).open('house', 'house', { fresh: true }); }")
    try:
        await pg.wait_for_selector('#books button.cover', timeout=8000)
        came = 'The Rest' in await pg.inner_text('#books')
    except Exception:
        came = False
    check('when the phone answers again, the books it could not list come by themselves', still == 1 and came, (still, await pg.inner_text('#books')))
    # Back while a book is still opening on a slow phone: the shelf stays
    async def slow(route):
        await asyncio.sleep(1.5)
        await route.continue_()
    await pg.route('**/api/store/novel/**', slow)
    await pg.click('#books button.cover >> nth=0')
    await pg.wait_for_timeout(300)
    await pg.go_back()
    await pg.wait_for_timeout(2500)
    where = await pg.evaluate("[location.hash, document.querySelector('#desk').hidden, document.querySelector('#shelf').hidden]")
    check('Back while the book is opening: the shelf stays, the book is not drawn over it', where[0] in ('', '#/') and where[1] is True and where[2] is False, where)
    await pg.unroute('**/api/store/novel/**')
    # and while its chapters are still on their way
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#books button.cover', timeout=8000)
    await pg.route('**/api/store/chapter/**', slow)
    await pg.click('#books button.cover >> nth=0')
    await pg.wait_for_timeout(300)
    await pg.go_back()
    await pg.wait_for_timeout(2500)
    where = await pg.evaluate("[location.hash, document.querySelector('#desk').hidden, document.querySelector('#shelf').hidden]")
    check('Back while its chapters are on their way: the shelf stays too', where[0] in ('', '#/') and where[1] is True and where[2] is False, where)
    await pg.unroute('**/api/store/chapter/**')
    # and while the chapter it opens at, which could not be read at first, is asked for once more
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#books button.cover', timeout=8000)
    asked = {}
    async def flaky(route):
        u = route.request.url
        asked[u] = asked.get(u, 0) + 1
        # (the phone's three tries for it fail; asked again as the book opens, it is slow)
        if asked[u] <= 3:
            await route.abort()
        else:
            await asyncio.sleep(3)
            await route.continue_()
    await pg.route('**/api/store/chapter/**', flaky)
    await pg.click('#books button.cover >> nth=0')
    for _ in range(80):
        if any(n >= 4 for n in asked.values()): break
        await pg.wait_for_timeout(100)
    again = any(n >= 4 for n in asked.values())
    await pg.wait_for_timeout(300)
    await pg.go_back()
    await pg.wait_for_timeout(4000)
    # (the book had already been drawn when Back came: what stands down is the rest — its chapter, its bar, its title, its helper)
    where = await pg.evaluate("[location.hash, document.querySelector('#desk').hidden, document.querySelector('#shelf').hidden, document.title]")
    check('Back while the chapter it opens at is asked for once more: the shelf stays, and nothing of the book goes on', again and where[0] in ('', '#/') and where[1] is True and where[2] is False and where[3] == 'Cozy Novel', (asked, where))
    await pg.unroute('**/api/store/chapter/**')
    # a book found gone after he has moved on to another: he stays in the other
    other = await pg.evaluate("""async () => {
      const store = await import('/js/store.js'); const shape = await import('/js/novel/shape.js');
      const { novel, chapter } = shape.newNovel({ title: 'The Other' });
      await store.create('chapter', chapter.id, chapter); await store.create('novel', novel.id, novel); return novel.id;
    }""")
    gone_id =await pg.evaluate("async () => (await (await fetch('/api/novels')).json()).novels.find((n) => n.meta.title === 'The Rest').id")
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#books button.cover', timeout=8000)
    async def gone(route):
        await asyncio.sleep(1.5)
        await route.fulfill(status=200, content_type='application/json', body='{"rev": 0, "data": null}')
    await pg.route(f'**/api/store/novel/{gone_id}', gone)
    await pg.evaluate(f"location.hash = '#/n/{gone_id}'")
    await pg.wait_for_timeout(300)
    await pg.evaluate(f"location.hash = '#/n/{other}'")
    await pg.wait_for_timeout(2500)
    where = await pg.evaluate("[location.hash, document.querySelector('#desk').hidden]")
    check('a book found gone after he moved on to another never takes him back to the shelf', where[0] == f'#/n/{other}' and where[1] is False, where)
    await pg.unroute(f'**/api/store/novel/{gone_id}')
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (the rest)', not errs, errs[:5])
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
    # the fixed version still says what wrote it, and what the judge said of it
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]'); await pg.wait_for_timeout(200)
    items = await pg.locator('.menu-pop button').all_inner_texts()
    await pg.click('.menu-pop button:has-text("What the judge said")'); await pg.wait_for_timeout(400)
    said = await pg.inner_text('.sheet.on >> nth=-1')
    rows = await pg.locator('.sheet.on ul.judged li').count()
    check('the version the fixes made keeps What the writer was sent, and What the judge said shows its ten checks', any('What the writer was sent' in t for t in items) and 'Graded 10 of 10' in said and rows == 10, (items, said[:120], rows))
    await close_sheet(pg)
    # he goes back to the words before with the arrows: his choice stands (looked at again below, after more checking)
    await pg.click('#passages .passage >> nth=-1', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    await pg.click('.passage.selected button[aria-label="The version before"]'); await pg.wait_for_timeout(400)
    # his own words: fixed by themselves too (his word, 2.6.2)
    await pg.fill('#direction', 'My own page: Mara kept no letters anymore.'); await pg.click('#mineBtn')
    for i in range(120):
        mine = await pg.inner_text('#passages .passage >> nth=-1')
        if 'letters any more' in mine: break
        await pg.wait_for_timeout(250)
    check('his own words get the checker’s fix by themselves, the words before one arrow away', 'letters any more' in mine and '2 / 2' in await pg.inner_text('#passages .passage >> nth=-1 >> .pctl'), mine[:200])
    # he takes the fixed version away: the words that come back on show are his choice too (looked at again below)
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Remove this version")'); await pg.wait_for_timeout(500)
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
    first = await pg.inner_text('#passages .passage >> nth=0')
    await pg.click('#passages .passage >> nth=0', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    ctl = await pg.inner_text('.passage.selected .pctl')
    check('the version he went back to stays as he chose it, through every checking after — its fix waits for him', 'patient and unhurried' in first and '1 / 2' in ctl, (first[:160], ctl))
    own = await pg.inner_text('#passages .passage >> nth=1')
    await pg.click('#passages .passage >> nth=1', position={'x': 6, 'y': 6}); await pg.wait_for_timeout(200)
    vl = '.passage.selected .pctl .ver > span'
    ver = await pg.inner_text(vl) if await pg.locator(vl).count() else '1 / 1'
    check('and the words that came back when he took the fixed version away stay too', 'letters anymore' in own and '1 / 1' in ver, (own[:160], ver))
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

QUIET_NOW = "import('/js/app.js').then((m) => m.quietNow())"
CONTRAST = r"""(async () => {
  const {applyLook} = await import('/js/ui/look.js');
  const L = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const color = (v) => { const p = document.createElement('i'); p.style.color = `var(${v})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  const was = {...document.documentElement.dataset};
  const style = document.documentElement.getAttribute('style');
  const out = {};
  for (const theme of ['academy', 'tokyo', 'study']) for (const mode of ['dark', 'light']) {
    applyLook({theme, mode});
    const btn = getComputedStyle(document.querySelector('#writeBtn'));
    const stops = btn.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
    out[`${theme}-${mode}`] = Math.round(100 * Math.min(...stops.map((s) => ratio(btn.color, s)), ratio(color('--accent'), color('--chrome-solid')), ratio(color('--accent-on-paper'), color('--paper')))) / 100;
  }
  applyLook({...was, theme: was.world || was.theme});
  if (style === null) document.documentElement.removeAttribute('style');
  else document.documentElement.setAttribute('style', style);
  return out;
})()"""

async def quiet_soon(pg, want=True, t=40000):
    for _ in range(t // 250):
        if await pg.evaluate(QUIET_NOW) == want:
            return True
        await pg.wait_for_timeout(250)
    return False

async def scenario_tavern_page(b):
    """what Cozy Tavern learned, on the page: a chapter split off keeps its checks, the reading line at the bottom, the partner's sources, an update waits for words not sent, the looks read, one scroll thumb, his own words wake the helper"""
    logs = []
    pg = await page(b, logs)
    await new_book(pg, title='The Tavern Lessons')
    await add_conn(pg)
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    def record(kind, rid):
        return json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/store/{kind}/{rid}'))['data']
    # a chapter split off takes what the checker found for its passages, and what he left
    await pg.fill('#direction', 'Mine first: the harbour at dawn.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    await write(pg, 'The lamp goes out.')
    for i in range(80):
        if await pg.get_attribute('#checkBubble', 'data-state') == 'found': break
        await pg.wait_for_timeout(250)
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .sug')
    await pg.locator('.sheet.on .sug:has-text("letters any more") button:has-text("Leave it")').click()
    await pg.wait_for_timeout(400)
    await close_sheet(pg)
    left = (await pg.inner_text('#checkBubble')).strip()
    reset()
    await pg.locator('#passages .passage:not(.break)').nth(1).click()
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Start a new chapter from here")')
    await pg.click('.sheet.on button:has-text("Start the new chapter")')
    await pg.wait_for_function("document.querySelector('#chapnum').textContent === 'Chapter Two'", timeout=5000)
    await pg.wait_for_timeout(1200)
    nov = record('novel', nid)
    one, two = record('chapter', nov['order'][0]), record('chapter', nov['order'][1])
    pid = two['passages'][0]['id']
    check('a chapter split off takes what the checker found for its passages and what he left — the chapter before keeps none of it',
          left == '1' and pid in (two.get('checks') or {}) and pid in (two.get('checksLeft') or {}) and pid not in (one.get('checks') or {}) and pid not in (one.get('checksLeft') or {}),
          (left, list((two.get('checks') or {}).keys()), list((two.get('checksLeft') or {}).keys()), list((one.get('checks') or {}).keys())))
    # a page written after it: the moved passage is not checked again, and what he left is not offered again
    await write(pg, 'The tide turns.')
    for i in range(80):
        if await pg.get_attribute('#checkBubble', 'data-state') in ('found', 'clean'): break
        await pg.wait_for_timeout(250)
    await pg.wait_for_timeout(1500)
    asked = [x['body']['messages'][-1]['content'].split('Check these passages from', 1)[1].split('Suggest only what is worth changing', 1)[0] for x in reqs() if checking(x)]
    n = (await pg.inner_text('#checkBubble')).strip()
    check('…so it is not checked again where it now stands, and what he left stays left', asked and not any('[2.1]' in a for a in asked) and any('[2.2]' in a for a in asked) and n == '3', (n, [a[:120] for a in asked]))
    # at the bottom, a short last passage is named: the room under the last passage brings it past the reading line
    await pg.fill('#direction', 'The end.')
    await pg.click('#mineBtn'); await pg.wait_for_timeout(400)
    await pg.evaluate("document.querySelector('#pageWrap').scrollTop = 1e9")
    await pg.wait_for_timeout(400)
    thumb = (await pg.get_attribute('#scroller .thumb', 'aria-valuenow') or '').strip() if await pg.evaluate("!document.querySelector('#scroller').hidden") else ''
    check('at the bottom of the chapter the scroller names its last passage, however short', thumb == '3', thumb)
    # a name he changes by hand: changing it everywhere is offered, with Undo (Cozy Tavern's ripple)
    for words in ('At dawn Mara walked down to the shore.', 'By night Mara slept beside the lamp.'):
        await pg.fill('#direction', words); await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    n_before = await pg.locator('#passages .passage:not(.break)').count()
    await pg.locator('#passages .passage:not(.break)').nth(n_before - 2).click()
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.fill('.editbox', 'At dawn Mira walked down to the shore.')
    await pg.click('.editrow button:has-text("Save")')
    offered = False
    for i in range(20):
        if await pg.locator('#toast.on button.toastact:has-text("Change it everywhere")').count():
            offered = True; break
        await pg.wait_for_timeout(250)
    offer = await pg.inner_text('#toast')
    if offered:
        await pg.click('#toast button.toastact:has-text("Change it everywhere")')
    await pg.wait_for_timeout(600)
    last = await pg.inner_text(f'#passages .passage:not(.break) >> nth={n_before - 1}')
    first = await pg.inner_text('#passages .passage:not(.break) >> nth=0')
    check('a name he changes by hand: changing it everywhere is offered, and done everywhere at a tap', '“Mara” is “Mira” here now' in offer and 'Mira slept' in last and 'Mara' not in first.split('\n')[0], (offer, last[:80], first[:80]))
    if await pg.locator('#toast button:has-text("Undo")').count():
        await pg.click('#toast button:has-text("Undo")')
    await pg.wait_for_timeout(600)
    last = await pg.inner_text(f'#passages .passage:not(.break) >> nth={n_before - 1}')
    check('…and Undo puts the old name back everywhere else', offered and 'Mara slept' in last, last[:80])
    await pg.fill('#direction', 'At noon Tobin came up the stair.'); await pg.click('#mineBtn'); await pg.wait_for_timeout(300)
    await pg.locator('#passages .passage:not(.break)').last.click()
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.fill('.editbox', 'At noon Tobias came up the stair.')
    await pg.click('.editrow button:has-text("Save")')
    await pg.wait_for_selector('#toast.on', timeout=5000)
    check('…never for a name that stands nowhere else in the book', await pg.locator('#toast button.toastact').count() == 0, await pg.inner_text('#toast'))
    # the partner's own web search: what it looked at, under its answer — only addresses on the web
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    await pg.fill('#sideFoot textarea', 'LOOK IT UP: how lighthouses were lit.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_function("document.querySelectorAll('#sideBody .turn.ai').length >= 1 && !document.querySelector('#sideBody .turn.streaming')", timeout=10000)
    links = await pg.evaluate("[...document.querySelectorAll('#sideBody .turn.ai .sources a')].map((a) => a.getAttribute('href'))")
    said = await pg.inner_text('#sideBody .turn.ai .sources') if links else ''
    check('what the partner looked up is listed under its answer, only the addresses on the web', links == ['https://example.com/lighthouses'] and 'Lighthouses of the north coast' in said, (links, said))
    # an update waits for words he has not sent
    check('with nothing going on, an update may land', await quiet_soon(pg, True))
    await pg.fill('#sideFoot textarea', 'Half a thought')
    await pg.evaluate('document.activeElement && document.activeElement.blur()')
    check('words typed beside the page and not sent hold an update back', await pg.evaluate(QUIET_NOW) is False)
    await pg.click('#sideTabs button[data-tab="notes"]'); await pg.wait_for_timeout(300)
    check('…still, when another tab is shown', await pg.evaluate(QUIET_NOW) is False)
    await pg.click('#sideTabs button[data-tab="partner"]'); await pg.wait_for_timeout(300)
    back = await pg.input_value('#sideFoot textarea')
    await pg.fill('#sideFoot textarea', '')
    await pg.evaluate('document.activeElement && document.activeElement.blur()')
    check('…and once he clears them, it may land again (the box is the truth, not what was kept of it)', back == 'Half a thought' and await quiet_soon(pg, True, 6000), back)
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    check('an open sheet holds it back', await pg.evaluate(QUIET_NOW) is False)
    await close_sheet(pg)
    await pg.fill('#direction', 'Half a direction')
    await pg.evaluate('document.activeElement && document.activeElement.blur()')
    check('the box’s last words, not yet handed over, hold it back', await pg.evaluate(QUIET_NOW) is False)
    check('…until they are on the phone', await quiet_soon(pg, True, 8000))
    await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
    await pg.fill('#sideFoot textarea', 'SLOW tell me about the keeper.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .turn.streaming', timeout=5000)
    check('an answer on its way holds it back', await pg.evaluate(QUIET_NOW) is False)
    await pg.wait_for_function("!document.querySelector('#sideBody .turn.streaming')", timeout=30000)
    await pg.click('#sideClose'); await pg.wait_for_timeout(300)
    # every look reads: the words on a button and the accent's own words, at 4.5:1 or more
    ratios = await pg.evaluate(CONTRAST)
    check('every look reads at 4.5:1 or more — a button’s words, the accent’s words on the page and around it', all(v >= 4.5 for v in ratios.values()), ratios)
    # one scroll thumb on a wide screen: the page's own mark, never the browser's beside it
    # (a browser that draws its scroll bars, as a computer's does — the test browser hides them unless asked)
    drawn = await b.browser_type.launch(ignore_default_args=['--hide-scrollbars'])
    wctx = await drawn.new_context(viewport={'width': 1280, 'height': 760})
    wide = await wctx.new_page()
    wide.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    await wide.goto(f'http://127.0.0.1:{PORT}/' + await pg.evaluate('location.hash'))
    await wide.wait_for_selector('#desk:not([hidden]) #passages .passage', timeout=8000)
    await wide.wait_for_timeout(600)
    bar = await wide.evaluate("""(() => { const w = document.querySelector('#pageWrap');
      const t = document.createElement('div'); t.style.cssText = 'position:fixed;top:0;left:0;width:100px;height:50px;overflow:scroll'; document.body.append(t); const drawnHere = t.offsetWidth - t.clientWidth; t.remove();
      return { drawnHere, scrolls: w.scrollHeight > w.clientHeight, native: w.offsetWidth - w.clientWidth, mark: !document.querySelector('#scroller').hidden } })()""")
    check('one scroll thumb on a wide screen: the passage mark, and no bar of the browser’s beside it', bar['drawnHere'] > 0 and bar['scrolls'] and bar['native'] == 0 and bar['mark'], bar)
    await drawn.close()
    # his own words for what the book is about, rewritten: the helper writes what it keeps beside them again, by itself
    await pg.wait_for_function("document.querySelector('#notesBtn').dataset.state === 'idle'", timeout=40000)
    reset()
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_selector('.sheet.on .keptfield')
    await pg.locator('.sheet.on .keptfield >> nth=0').locator('textarea.tall').fill('A lighthouse keeper finds a letter from her drowned brother.')
    kept_asked = False
    for i in range(100):
        if any('for the writer to read before every page' in (x['body']['messages'][-1].get('content') or '') for x in reqs() if x['path'].endswith('/chat/completions')):
            kept_asked = True; break
        await pg.wait_for_timeout(250)
    check('his own words for what it is about, rewritten on Automatic: what the helper keeps beside them is written again by itself', kept_asked)
    await close_sheet(pg)
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (what Cozy Tavern learned)', not errs, errs[:5])
    await pg.close()

async def scenario_update_waits(b):
    """an update waits for words he has not sent, then lands by itself"""
    import tempfile, shutil
    app = tempfile.mkdtemp(prefix='cozynovel-update-')
    home = tempfile.mkdtemp(prefix='cozynovel-update-home-')
    files = subprocess.run(['git', 'ls-files', '-co', '--exclude-standard'], cwd=APP, capture_output=True, text=True).stdout.split('\n')
    for f in files:
        if f and os.path.isfile(os.path.join(APP, f)):
            os.makedirs(os.path.dirname(os.path.join(app, f)), exist_ok=True)
            shutil.copy2(os.path.join(APP, f), os.path.join(app, f))
    git = ['git', '-c', 'user.name=walk', '-c', 'user.email=walk@example.com']
    subprocess.run(['git', 'init', '-q'], cwd=app, check=True)
    subprocess.run(['git', 'add', '-A'], cwd=app, check=True)
    subprocess.run(git + ['commit', '-qm', 'one'], cwd=app, check=True)
    port = PORT + 9
    srv = subprocess.Popen([sys.executable, app + '/serve.py'], env=dict(os.environ, COZYNOVEL_HOME=home, COZYNOVEL_PORT=str(port)), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    logs = []
    pg = await page(b, logs)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(f'http://127.0.0.1:{port}/api/version', timeout=1); break
            except Exception: time.sleep(0.1)
        await pg.goto(f'http://127.0.0.1:{port}/')
        await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)', timeout=8000)
        await pg.click('button:has-text("Begin a book")') if await pg.locator('button:has-text("Begin a book")').count() else await pg.click('button[aria-label="Begin a new book"]')
        await pg.fill('.sheet input[placeholder="A working title"]', 'The Update')
        await pg.click('text=Open the book')
        await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
        await pg.click('#partnerBtn'); await pg.wait_for_timeout(300)
        await pg.fill('#sideFoot textarea', 'A thought not sent yet')
        await pg.evaluate('document.activeElement && document.activeElement.blur(); window.__stillHere = true')
        before = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/version'))['commit']
        subprocess.run(git + ['commit', '-q', '--allow-empty', '-m', 'two'], cwd=app, check=True)
        moved = ''
        for _ in range(100):
            try:
                moved = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/api/version', timeout=1))['commit']
                if moved and moved != before: break
            except Exception: pass
            await pg.wait_for_timeout(200)
        await pg.wait_for_timeout(9000)
        held = await pg.evaluate('window.__stillHere === true')
        words = await pg.input_value('#sideFoot textarea') if held else ''
        check('an update that lands while words wait unsent in the box beside the page waits for them', moved != before and held and words == 'A thought not sent yet', (before[:8], moved[:8], held, words))
        await pg.fill('#sideFoot textarea', '')
        await pg.evaluate('document.activeElement && document.activeElement.blur()')
        try:
            await pg.wait_for_function('window.__stillHere !== true', timeout=20000)
            await pg.wait_for_selector('#desk:not([hidden]), #shelf:not([hidden])', timeout=8000)
            check('…and lands by itself once they are gone', True)
        except Exception as e:
            check('…and lands by itself once they are gone', False, e)
        errs = [l for l in logs if l.startswith('PAGEERROR')]
        check('no page errors (an update)', not errs, errs[:5])
    finally:
        await pg.close()
        srv.terminate()
        shutil.rmtree(app, ignore_errors=True); shutil.rmtree(home, ignore_errors=True)

# the painted bar of the scroller and every word on the page that it stands beside: where they meet
BAR_OVER_WORDS = r"""(() => {
  const t = document.querySelector('#scroller .thumb');
  if (!t || document.querySelector('#scroller').hidden) return { shown: false };
  const r = t.getBoundingClientRect();
  /* what of it is painted: the thumb itself when it has a fill, a border or words; its bar (::after) where it stands */
  const cs = getComputedStyle(t);
  const clear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const painted = [];
  if (!clear(cs.backgroundColor) || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !clear(cs.borderTopColor)) || (t.textContent.trim() && !clear(cs.color) && parseFloat(cs.fontSize) > 0)) painted.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  const af = getComputedStyle(t, '::after');
  if (af.content && af.content !== 'none') {
    const right = parseFloat(af.right) || 0, width = parseFloat(af.width) || 0, top = parseFloat(af.top) || 0, bottom = parseFloat(af.bottom) || 0;
    painted.push({ left: r.right - right - width, right: r.right - right, top: r.top + top, bottom: r.bottom - bottom });
  }
  const hits = [];
  const walker = document.createTreeWalker(document.querySelector('#page'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const q of range.getClientRects()) {
      if (q.width < 1 || q.height < 1) continue;
      for (const bar of painted) if (q.left < bar.right && q.right > bar.left && q.top < bar.bottom && q.bottom > bar.top) hits.push(n.data.slice(0, 30));
    }
  }
  const tip = getComputedStyle(document.querySelector('#scroller .tip')).display;
  return { shown: true, hits, tip, painted: painted.length, where: document.querySelector('#whereNow').textContent };
})()"""

async def scenario_tavern_ui(b):
    """what Cozy Tavern learned, on the screen: the scroller never over a word, ticks in their fields, every menu item says what it does, which parts a connection has, Back to the default with Undo, a thinking with no line breaks drawn in pieces"""
    logs = []
    pg = await page(b, logs)   # a phone, 412 wide
    await new_book(pg, title='The Narrow Screen')
    await add_conn(pg)
    for i in range(6):
        await write(pg, f'Part {i + 1}.')
    # the scroller: its bar is never painted over a word, at forty places down the chapter; the number is said above the page
    hit, tips, wheres = [], [], set()
    most = await pg.evaluate("(() => { const w = document.querySelector('#pageWrap'); return w.scrollHeight - w.clientHeight })()")
    for k in range(40):
        await pg.evaluate(f"document.querySelector('#pageWrap').scrollTop = {most} * {k} / 39")
        await pg.wait_for_timeout(60)
        got = await pg.evaluate(BAR_OVER_WORDS)
        if not got.get('shown'): continue
        hit += got['hits']; tips.append(got['tip']); wheres.add(got['where']); painted = got['painted']
    check('the scroller’s bar is never painted over a word, anywhere down the chapter, on a phone', most > 0 and tips and painted and not hit, (most, hit[:5]))
    check('…the number is not beside it while the page only scrolls — it is said above the page', tips and all(t == 'none' for t in tips) and any(w.startswith(' · Passage 1 of ') for w in wheres) and any(w.startswith(' · Passage ') and ' of ' in w and not w.startswith(' · Passage 1 of ') for w in wheres), (set(tips), sorted(wheres)[:4]))
    box = await pg.locator('#scroller .thumb').bounding_box()
    await pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    await pg.mouse.down()
    await pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + 60, steps=4)
    held = await pg.evaluate("[getComputedStyle(document.querySelector('#scroller .tip')).display, document.querySelector('#scroller .tip').textContent]")
    await pg.mouse.up()
    check('…and beside the bar only while he drags it', held[0] == 'block' and held[1].startswith('Passage '), held)
    # every item of the writer menu says what it does, and what goes with it
    await pg.click('#writerBtn'); await pg.wait_for_selector('.menu-pop')
    items = await pg.evaluate("[...document.querySelectorAll('.menu-pop button')].map((b) => [b.querySelector('.mlabel') ? b.querySelector('.mlabel').textContent : b.textContent, b.querySelector('.mhint') ? b.querySelector('.mhint').textContent : ''])")
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    check('every item of the writer menu says in a small line what it does — and that the partner and the helper go with the writer', items and all(h for _, h in items) and any('the partner, the helper and the checker' in h for _, h in items), items)
    # Settings: which parts the connection shown has; ticks the size of ticks
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    if not await pg.locator('.sheet.on .say.inuse').is_visible():
        await pg.click('.sheet.on .ghead:has-text("Connections")'); await pg.wait_for_timeout(300)
    inuse = await pg.inner_text('.sheet.on .say.inuse')
    opt = await pg.evaluate("[...document.querySelectorAll('.sheet.on select[aria-label=\"Which connection\"] option')].map((o) => o.textContent)")
    check('the connection shown says which parts it has, and the list marks the ones in use', inuse == 'In use as the writer, the partner, the helper and the checker.' and opt and opt[0].endswith('(in use)'), (inuse, opt))
    if not await pg.locator('.sheet.on .group[data-key="set.roles"] label.toggle').first.is_visible():
        await pg.click('.sheet.on .ghead:has-text("Who does what")'); await pg.wait_for_timeout(300)
    ticks = await pg.evaluate("[...document.querySelectorAll('.sheet.on .field input[type=checkbox]')].filter((i) => i.offsetParent).map((i) => [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)])")
    check('a tick inside a field is a tick’s size, never a text box’s', ticks and all(w <= 24 and h <= 24 for w, h in ticks), ticks)
    # Back to the default over his words: Copy mine first, or back — and Undo puts his back
    if not await pg.locator('.sheet.on button:has-text("Save current preset")').is_visible():
        await pg.click('.sheet.on .ghead:has-text("Your instructions")'); await pg.wait_for_timeout(300)
    narr = '.sheet.on label.field:has(span:text-is("How the narrator tells scenes")) textarea'
    await pg.fill(narr, 'MY NARRATOR, MY WAY.')
    await pg.wait_for_timeout(900)
    await pg.locator('.sheet.on .btnrow:below(label.field:has(span:text-is("How the narrator tells scenes"))) button:has-text("Back to the default")').first.click()
    await pg.wait_for_selector('.sheet.on button:has-text("Copy mine first")')
    choices = await pg.evaluate("[...document.querySelectorAll('.sheet.on')].pop().innerText")
    await pg.click('.sheet.on button:has-text("Back to the default") >> nth=-1')
    await pg.wait_for_timeout(600)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    starting = await pg.evaluate("import('/js/novel/prompts.js').then((m) => m.DEFAULT_NARRATOR)")
    went = house['instructions'].get('narrator') == starting and await pg.input_value(narr) == starting
    await pg.click('#toast button:has-text("Undo")'); await pg.wait_for_timeout(900)
    house = (await pg.evaluate("fetch('/api/store/house/house').then((r) => r.json())"))['data']
    check('Back to the default over his words offers Copy mine first, and Undo puts his words back — in the box and on the phone', 'Copy mine first' in choices and went and house['instructions'].get('narrator') == 'MY NARRATOR, MY WAY.' and await pg.input_value(narr) == 'MY NARRATOR, MY WAY.', (choices[-160:], went, (house['instructions'].get('narrator') or '')[:40]))
    # every item of a preset's menu says what it does
    await pg.click('.sheet.on button:has-text("Save current preset")'); await pg.wait_for_timeout(300)
    await pg.fill('.sheet.on >> nth=-1 >> input', 'Narrow')
    await pg.click('.sheet.on >> nth=-1 >> button:has-text("Save")'); await pg.wait_for_timeout(600)
    await pg.click('.sheet.on .presetrow button[aria-label="More for Narrow"]'); await pg.wait_for_selector('.menu-pop')
    items = await pg.evaluate("[...document.querySelectorAll('.menu-pop button')].map((b) => [b.querySelector('.mlabel') ? b.querySelector('.mlabel').textContent : b.textContent, b.querySelector('.mhint') ? b.querySelector('.mhint').textContent : ''])")
    await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
    check('every item of a preset’s menu says in a small line what it does', len(items) == 4 and all(h for _, h in items), items)
    await close_sheet(pg)
    # a thinking with no line breaks at all: drawn in pieces, its first words there, the pieces before the newest never drawn again
    pieces = await pg.evaluate("""(async () => {
      const m = await import('/js/ui/live.js');
      const box = document.createElement('div'); document.body.append(box);
      const one = 'The keeper weighed the letter and the storm and what each would cost her. '.repeat(120);
      m.streamLines(box, one, { blocks: true });
      const first = [...box.querySelectorAll('.ln')][0].childNodes[0];
      const firstNodes = [...box.querySelector('.ln').childNodes];
      m.streamLines(box, one + 'And then the lamp went out.', { blocks: true });
      const after = [...box.querySelector('.ln').childNodes];
      const out = { lines: box.querySelectorAll('.ln').length, pieces: after.length, longest: Math.max(...after.map((n) => n.data.length)),
        same: box.textContent === one + 'And then the lamp went out.', kept: firstNodes.slice(0, -1).every((n, i) => after[i] === n), firstWords: first.data.startsWith('The keeper weighed') };
      box.remove();
      return out;
    })()""")
    check('a thinking with no line breaks is drawn in pieces of one line — every word there from the first, only the newest piece drawn again', pieces['lines'] == 1 and pieces['pieces'] > 5 and pieces['longest'] <= 1600 and pieces['same'] and pieces['kept'] and pieces['firstWords'], pieces)
    # a page that goes (reloaded, closed, an update landing) lets its book's lease go at once: the next page never waits it out
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    held = await pg.evaluate(f"import('/js/store.js').then((m) => m.lease('helper:{nid}')).then((h) => h.ok)")
    def other_asks():
        req = urllib.request.Request(f'http://127.0.0.1:{PORT}/api/lease', data=json.dumps({'key': f'helper:{nid}', 'ttl': 60000}).encode(), headers={'Content-Type': 'application/json', 'X-Client': 'tab-another-browser'}, method='POST')
        return json.load(urllib.request.urlopen(req))
    before = other_asks()
    await pg.reload(); await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    after = other_asks()
    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{PORT}/api/lease', data=json.dumps({'key': f'helper:{nid}', 'release': True}).encode(), headers={'Content-Type': 'application/json', 'X-Client': 'tab-another-browser'}, method='POST'))
    check('a page that goes lets its book’s lease go at once — another browser never waits it out', held and before.get('ok') is False and after.get('ok') is True, (held, before, after))
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (on the screen)', not errs, errs[:5])
    await pg.close()

async def main():
    import tempfile
    tmp = tempfile.mkdtemp()
    with Env() as env:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            async def bring_in(b):
                """bringing a book in"""
                await scenario_bring_in(b, tmp)
            async def offline(b):
                """the server stops under an open page, then comes back"""
                await scenario_offline(b, env)
            for sc in (scenario_back, scenario_middle, scenario_thinking, scenario_round, bring_in, scenario_look, scenario_windows, scenario_follow, scenario_made_while_asked, scenario_checker, scenario_judge, scenario_suggestions_more, scenario_page_whole, scenario_rest, scenario_auto, scenario_crafts, scenario_versions, scenario_notes, scenario_page_fails, scenario_partner_said, scenario_partner, scenario_tavern_page, scenario_tavern_ui, scenario_update_waits, offline):
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
