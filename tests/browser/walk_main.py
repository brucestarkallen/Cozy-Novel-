"""The whole app driven in a real browser against the real server and the
stand-in model. Every step is checked; a failed check says what it saw."""
import asyncio, json, os, sys, traceback
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

async def set_model(pg, model):
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections")')
    await pg.fill('.sheet label.field:has(> span:text-is("Model")) input', model)
    await pg.wait_for_timeout(700)
    await close_sheet(pg)

async def scenario_main(b):
    logs = []
    pg = await page(b, logs)
    reset()
    # ---- the shelf and a new book
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('text=Every story starts somewhere.', timeout=8000)
    check('an empty shelf greets him', True)
    await pg.click('text=Begin a book')
    await pg.fill('.sheet input[placeholder="A working title"]', 'The Lantern Keeper')
    await pg.fill('.sheet textarea', 'A lighthouse keeper on a stormy coast finds a letter in a bottle.')
    await pg.click('text=Open the book')
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    check('the new book opens on its first page', await pg.text_content('#chapnum') == 'Chapter One', await pg.text_content('#chapnum'))
    check('the empty page says what to do', 'press Write' in await pg.inner_text('#pageEnd'), await pg.inner_text('#pageEnd'))
    check('with no helper the light is grey', await pg.get_attribute('#notesBtn', 'data-state') == 'off', await pg.get_attribute('#notesBtn', 'data-state'))
    # ---- a connection
    await add_conn(pg)
    chip = await pg.inner_text('#writerBtn')
    check('the writer chip names the new connection', 'My connection' in chip, chip)
    # ---- write
    await write(pg, 'She finds a bottle with a letter.')
    prose = await pg.inner_text('#passages .passage.selected .prose')
    check('Write puts a passage on the page', 'Mara Venn' in prose and 'She finds a bottle with a letter.' in prose, prose[:200])
    # his premise: the box empties, and the premise stays under the page it wrote (2.12.30)
    said = await pg.inner_text('#passages .passage.selected .pctl .note.premise') if await pg.locator('#passages .passage.selected .pctl .note.premise').count() else ''
    check('the box empties and his premise shows under the page it wrote', await pg.input_value('#direction') == '' and said == 'Your premise: She finds a bottle with a letter.', said)
    await pg.locator('#passages .passage.selected .pctl .note.premise').scroll_into_view_if_needed(); await pg.screenshot(path=os.path.join(SHOTS, 'premise.png'))
    calls = completions()
    body = calls[-1]['body'] if calls else {}
    check('the request streams to the chosen model', body.get('model') == 'fake-writer' and body.get('stream') is True, {k: body.get(k) for k in ('model', 'stream')})
    nothing = [k for k in ('temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'reasoning_effort', 'thinking') if k in body]
    check('nothing he left empty is sent', not nothing, nothing)
    roles = [m['role'] for m in body.get('messages', [])]
    check('everything above the request is system', roles and roles[-1] == 'user' and all(r == 'system' for r in roles[:-1]), roles)
    check('the book is in what the writer reads', any('lighthouse keeper' in (m.get('content') or '') for m in body.get('messages', [])), '')
    # ---- the light turns green after the helper reads
    await pg.wait_for_function("document.querySelector('#notesBtn').dataset.state === 'idle'", timeout=30000)
    check('the helper reads the new passage and the light is green', True)
    # ---- another take, rewrite, versions, edit
    await pg.click('.passage.selected .pctl button:has-text("Another take")')
    await pg.wait_for_timeout(150); await idle(pg)
    ver = await pg.inner_text('.passage.selected .pctl .ver > span')
    check('Another take adds a second version', ver.strip() == '2 / 2', ver)
    await pg.click('.passage.selected .pctl button:has-text("Rewrite…")')
    await pg.fill('.rewriterow input', 'More rain, fewer gulls.')
    await pg.click('.rewriterow button:has-text("Rewrite")')
    await pg.wait_for_timeout(150); await idle(pg)
    ver = await pg.inner_text('.passage.selected .pctl .ver > span')
    prose = await pg.inner_text('.passage.selected .prose')
    check('Rewrite with a note makes a third version', ver.strip() == '3 / 3' and 'rewritten passage' in prose, (ver, prose[:100]))
    last = completions()[-1]['body']['messages'][-1]['content']
    check('the rewrite request carries his note', 'More rain, fewer gulls.' in last, last[-300:])
    await pg.click('.passage.selected .pctl .ver button[aria-label="The version before"]')
    await pg.wait_for_timeout(300)
    check('the arrow goes back a version', (await pg.inner_text('.passage.selected .pctl .ver > span')).strip() == '2 / 3', await pg.inner_text('.passage.selected .pctl .ver > span'))
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.fill('.editbox', 'Edited by hand. The lamp burned all night.')
    await pg.click('.editrow button:has-text("Save")')
    await pg.wait_for_timeout(400)
    # (a new version through 2.12.1 — since 2.12.2 an edit goes on the page itself: his word, "new version is only for rewrite or another take")
    pctl = await pg.inner_text('.passage.selected .pctl')
    check('an edit goes on the page itself, no new version', 'Edited by hand' in await pg.inner_text('.passage.selected .prose') and (await pg.inner_text('.passage.selected .pctl .ver > span')).strip() == '2 / 3' and 'edited by you' in pctl, pctl)
    # Back while editing keeps the edit
    await pg.click('.passage.selected .pctl button:has-text("Edit")')
    await pg.fill('.editbox', 'Edited, then Back was pressed.')
    await pg.go_back()
    await pg.wait_for_timeout(500)
    check('Back while editing keeps what he typed', 'then Back was pressed' in await pg.inner_text('.passage.selected .prose') and await pg.locator('#desk:not([hidden])').count() == 1, await pg.inner_text('.passage.selected .prose'))
    # ---- his own words
    await pg.fill('#direction', 'Mara put the kettle on and read the letter twice.')
    await pg.click('#mineBtn')
    await pg.wait_for_timeout(400)
    n = await pg.locator('#passages .passage').count()
    check('Add as my words puts his words on the page', n == 2 and 'kettle' in await pg.locator('#passages .passage').last.inner_text(), n)
    check('the box is empty after', await pg.input_value('#direction') == '', await pg.input_value('#direction'))
    # ---- notes
    await pg.wait_for_function("document.querySelector('#notesBtn').dataset.state === 'idle'", timeout=30000)
    await pg.click('#notesBtn')
    await pg.wait_for_timeout(500)
    notes = await pg.inner_text('#sideBody')
    check('Notes shows what the helper kept', 'Mara Venn' in notes and 'Crane Point' in notes and 'Who sent the letter?' in notes, notes[:400])
    check('a chapter of a few hundred words is not named yet', await pg.text_content('#chapname') == '', await pg.text_content('#chapname'))
    await pg.go_back(); await pg.wait_for_timeout(400)
    check('Back closes the notes drawer, not the book', await pg.locator('#sidePane.open').count() == 0 and await pg.locator('#desk:not([hidden])').count() == 1, '')
    # ---- partner
    await pg.click('#partnerBtn')
    await pg.fill('#sideFoot textarea', 'Who could have sent the letter?')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('.turn.ai .tctl', timeout=8000)
    said = await pg.inner_text('.turn.ai .words')
    check('the partner answers', 'brother' in said, said)
    pbody = completions()[-1]['body']
    check('the partner reads the book too', any('Mara' in (m.get('content') or '') for m in pbody['messages'] if m['role'] == 'system'), '')
    await pg.click('.turn.ai .direction button:has-text("Use as the next direction")')
    await pg.wait_for_timeout(400)
    check('Use as the next direction fills the box', 'brother' in await pg.input_value('#direction'), await pg.input_value('#direction'))
    await pg.fill('#direction', '')
    # ---- a scene
    await pg.click('#moreBtn')
    await pg.click('.menu-pop button:has-text("Scenes")')
    await pg.fill('#sideBody input[list=cn-people]', 'Mara')
    await pg.click('#sideBody button:has-text("Begin the scene")')
    await pg.wait_for_selector('.turn.ai .tctl', timeout=8000)
    check('the narrator opens the scene', 'stranger waits' in await pg.inner_text('.turn.ai .words'), await pg.inner_text('#sideBody'))
    # a line to the narrator, apart from his character's words
    check('the line to the narrator starts closed', await pg.locator('#sideFoot textarea.tellbox').is_hidden())
    await pg.click('#sideFoot button:has-text("Tell the narrator")')
    check('Tell the narrator opens its own box', await pg.locator('#sideFoot textarea.tellbox').is_visible())
    await pg.fill('#sideFoot textarea.tellbox', 'Let the rain ease off.')
    await pg.fill('#sideFoot textarea:not(.tellbox)', 'I walk down the steps to meet him.')
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_function("document.querySelectorAll('.turn.ai .tctl').length >= 2", timeout=8000)
    told = completions()[-1]['body']['messages'][-1]['content']
    check('the line rides after his move, as not his character\'s', told == 'I walk down the steps to meet him.\n\n(Just for you, not something Mara says or does — Let the rain ease off.)', told)
    mine = await pg.inner_text('#sideBody .turn.you >> nth=-1')
    check('his turn shows it apart: To the narrator', 'To the narrator: Let the rain ease off.' in mine and await pg.input_value('#sideFoot textarea.tellbox') == '', mine)
    # three choices: on, offered as buttons under the narrator's part; a tap is his move
    await pg.click('#sideFoot button:has-text("Three choices")')
    await pg.wait_for_timeout(200)
    check('Three choices turns on', await pg.get_attribute('#sideFoot button:has-text("Three choices")', 'aria-pressed') == 'true')
    # the newest part was told before they were on: said, with the way to ask again — never an empty row
    none = await pg.locator('#sideBody .nochoices').all_inner_texts()
    check('a part that came with no choices says so, and how to ask again', none == ['No choices came with this part — › under it writes another version, with them.'], none)
    await pg.click('#sideFoot button:has-text("Send")')
    await pg.wait_for_selector('#sideBody .choices .choice', timeout=8000)
    check('…and the line goes once the choices come', await pg.locator('#sideBody .nochoices').count() == 0)
    ways = await pg.locator('#sideBody .choices .choice').all_inner_texts()
    words = await pg.inner_text('#sideBody .turn.ai >> nth=-1')
    check('the narrator offers three ways, as buttons, never in its words', ways == ['Mara asks the stranger his name.', 'Mara turns back up the steps.', 'Mara holds out the letter.'] and 'choices' not in words and 'asks the stranger' not in words, (ways, words[-160:]))
    await pg.locator('#sideBody .choices .choice').last.click()
    await pg.wait_for_function("document.querySelectorAll('.turn.ai .tctl').length >= 4", timeout=8000)
    moved = completions()[-1]['body']['messages']
    story = [m for m in moved if m['role'] != 'system']
    check('a way tapped is his move, and the offers are not sent back as the story', moved[-1]['content'] == 'Mara holds out the letter.' and not any('<choices>' in (m.get('content') or '') or 'turns back up' in (m.get('content') or '') for m in story), [m['content'][-120:] for m in story])
    # a scene is played as his tales are: the swipe bar on the newest telling, Edit and Try again on his move
    last_ai = pg.locator('#sideBody .turn.ai').last
    more = last_ai.locator('.tctl button[aria-label="Write another version of this telling"]')
    check('the newest telling has its swipe bar, › writing another version', await more.is_visible() and (await last_ai.locator('.tctl .swipecount').inner_text()) == '1/1')
    my_last = pg.locator('#sideBody .turn.you').last
    check('his move has Edit and Try again', await my_last.locator('.tctl button:text-is("Edit")').is_visible() and await my_last.locator('.tctl button:text-is("Try again")').is_visible())
    await my_last.locator('.tctl button:text-is("Edit")').click()
    sheet = pg.get_by_role('dialog', name='Edit your move', exact=True)
    await sheet.wait_for(state='visible')
    await sheet.locator('textarea').first.fill('Mara holds out the letter, shaking.')
    await sheet.get_by_role('button', name='Save', exact=True).click()
    await pg.wait_for_timeout(200)
    check('Edit changes his move where it stands', 'Mara holds out the letter, shaking.' in await pg.locator('#sideBody .turn.you').last.inner_text())
    await pg.locator('#toast').get_by_role('button', name='Undo', exact=True).click()
    await pg.wait_for_timeout(200)
    check('…and Undo puts his words back', 'shaking' not in await pg.locator('#sideBody .turn.you').last.inner_text())
    n_sent = len(completions())
    await pg.locator('#sideBody .turn.ai').last.locator('.tctl button[aria-label="Write another version of this telling"]').click()
    await pg.wait_for_function("(() => { const t = [...document.querySelectorAll('#sideBody .turn.ai')].pop(); return t && !t.classList.contains('streaming') && t.querySelector('.swipecount') && t.querySelector('.swipecount').textContent === '2/2'; })()", timeout=10000)
    check('› writes another version of the telling, the one before one arrow back', len(completions()) == n_sent + 1)
    await pg.click('#sideFoot button:has-text("Three choices")')
    await pg.wait_for_timeout(200)
    check('…and turns off again', await pg.get_attribute('#sideFoot button:has-text("Three choices")', 'aria-pressed') == 'false')
    before = await pg.locator('#passages .passage').count()
    await pg.click('#sideFoot button:has-text("Turn it into prose")')
    await pg.wait_for_function(f"document.querySelectorAll('#passages .passage').length > {before} && !document.querySelector('.passage.streaming')", timeout=10000)
    lastp = await pg.locator('#passages .passage').last.inner_text()
    check('Turn it into prose writes the scene into the chapter', 'You found it' in lastp, lastp[:200])
    req = completions()[-1]['body']['messages'][-1]['content']
    check('the prose request carries the scene — not his line to the narrator, nor the offers', 'I walk down the steps' in req and 'Mara holds out the letter.' in req and 'rain ease off' not in req and 'turns back up' not in req, req[:400])
    # ---- stop and go on
    await pg.fill('#direction', 'SLOW she climbs the stairs.')
    await pg.click('#writeBtn')
    await pg.wait_for_function("document.querySelector('.passage.streaming .prose') && document.querySelector('.passage.streaming .prose').textContent.length > 60", timeout=8000)
    await pg.click('#writeBtn')
    await idle(pg)
    t1 = await pg.inner_text('.passage.selected .prose')
    warn = await pg.inner_text('.passage.selected .pctl .note.warn')
    check('Stop keeps what came and says it stopped', len(t1) > 40 and 'stopped partway' in warn, (len(t1), warn))
    await pg.click('.passage.selected .pctl button.go')
    await pg.wait_for_timeout(150); await idle(pg)
    t2 = await pg.inner_text('.passage.selected .prose')
    check('Go on carries it on from the last word', t2.startswith(t1[:40]) and 'came in' in t2 and len(t2) > len(t1), t2[-120:])
    # ---- a failure leaves nothing behind
    await set_model(pg, 'fake-broken')
    n0 = await pg.locator('#passages .passage').count()
    await pg.fill('#direction', 'Anything.')
    await pg.click('#writeBtn')
    await pg.wait_for_selector('.endcard.error', timeout=30000)
    err = await pg.inner_text('.endcard.error')
    check('a provider error says why on the page', 'did not come' in err and 'error' in err.lower(), err)
    check('and leaves no empty passage', await pg.locator('#passages .passage').count() == n0, await pg.locator('#passages .passage').count())
    check('and keeps the direction in the box', await pg.input_value('#direction') == 'Anything.', await pg.input_value('#direction'))
    # ---- cut by length
    await set_model(pg, 'fake-cutter')
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(150); await idle(pg)
    warn = await pg.locator('.passage.selected .pctl .note.warn').all_inner_texts()
    check('a reply cut by its length says so', warn and 'stopped partway' in warn[0], warn)
    # ---- selection rewrite
    await set_model(pg, 'fake-writer')
    await pg.evaluate("""() => {
      const ps = [...document.querySelectorAll('#passages .passage .prose p')];
      const p = ps.find((x) => x.textContent.includes('hammered'));
      const t = p.firstChild; const r = document.createRange();
      const i = t.textContent.indexOf('hammered'); r.setStart(t, i); r.setEnd(t, i + 'hammered'.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }""")
    await pg.wait_for_selector('#selBar:not([hidden])', timeout=4000)
    what = await pg.inner_text('#selWhat')
    btn = await pg.inner_text('#writeBtn')
    check('selecting words says Rewrite on the one button', 'hammered' in what and btn.strip() == 'Rewrite', (what, btn))
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(150); await idle(pg)
    allp = ' '.join(await pg.locator('#passages .passage .prose').all_inner_texts())
    check('only the selected words are rewritten', 'amber glow' in allp and 'Rain lit with a slow, amber glow the glass' in allp.replace('\n', ' '), allp[:300])
    # ---- a dial the model refuses is learned
    # Counted from before the dial is set, and by the words asked for: the
    # checker rides the same connection and reads the rewritten passage a few
    # seconds after it, so it can meet the refusal first — and what one of them
    # learns about the model holds for all of them.
    reset()
    await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections")')
    await pg.fill('.sheet label.field:has(> span:text-is("Model")) input', 'fake-picky')
    # every dial stands open on the form, as in Cozy Tavern's editor (no fold)
    await pg.fill('.sheet label.field:has(span:text-is("Top-k")) input', '40')
    await pg.fill('.sheet label.field:has(span:text-is("Temperature (0–2)")) input', '0.8')
    await pg.wait_for_timeout(800)
    await close_sheet(pg)
    asked = lambda words: [x for x in completions() if words in json.dumps(x['body'].get('messages') or [])]
    n0 = await pg.locator('#passages .passage').count()
    e0 = await pg.locator('.endcard.error').count()
    await write(pg, 'A quiet moment.')
    r = asked('A quiet moment.')
    picky = [x for x in reqs() if x['path'].endswith('/chat/completions') and x['body'].get('model') == 'fake-picky']
    came = await pg.locator('#passages .passage').count() == n0 + 1 and await pg.locator('.endcard.error').count() <= e0
    check('his temperature is sent exactly', r and all(x['body'].get('temperature') == 0.8 for x in r), [x['body'].get('temperature') for x in r])
    check('a refused dial is dropped and the page still comes', any('top_k' in x['body'] for x in picky) and r and 'top_k' not in r[-1]['body'] and came,
          ([('top_k' in x['body'], 'checker' if checking(x) else 'page') for x in picky], came))
    reset()
    await write(pg, 'Another quiet moment.')
    r = asked('Another quiet moment.')
    check('the next request leaves the refused dial out from the start', len(r) == 1 and 'top_k' not in r[0]['body'], [('top_k' in x['body']) for x in r])
    await set_model(pg, 'fake-writer')
    # ---- remove a passage, undo
    n1 = await pg.locator('#passages .passage').count()
    await pg.click('.passage.selected .pctl button[aria-label="More for this passage"]')
    await pg.click('.menu-pop button:has-text("Remove the passage")')
    await pg.wait_for_timeout(300)
    n2 = await pg.locator('#passages .passage').count()
    await pg.click('#toast .toastact')
    await pg.wait_for_timeout(400)
    n3 = await pg.locator('#passages .passage').count()
    check('a removed passage comes back with Undo', n2 == n1 - 1 and n3 == n1, (n1, n2, n3))
    # ---- reading mode
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Reading mode")')
    await pg.wait_for_timeout(300)
    hidden = await pg.evaluate("() => [...document.querySelectorAll('.composer, .deskbar, .pctl')].every((e) => getComputedStyle(e).display === 'none')")
    check('reading mode shows only the page', hidden, '')
    await pg.go_back(); await pg.wait_for_timeout(300)
    check('Back leaves reading mode', not await pg.evaluate("document.body.classList.contains('reading')"), '')
    # ---- chapter two
    await pg.click('.nextchapter button')
    await pg.wait_for_function("document.querySelector('#chapnum').textContent === 'Chapter Two'", timeout=5000)
    await write(pg, 'The stranger knocks at the door.')
    sysm = '\n'.join(m['content'] for m in completions()[-1]['body']['messages'] if m['role'] == 'system')
    check('Chapter Two is written with Chapter One behind it', 'Chapter One' in sysm and ('kettle' in sysm or 'The Bottle' in sysm), sysm[:400])
    check('and with the notes', 'Mara Venn' in sysm, '')
    await pg.click('#bookTitle')
    await pg.wait_for_timeout(400)
    chs = await pg.text_content('#chaptersBody')
    check('the chapters list shows both chapters', 'Chapter One' in chs and 'Chapter Two' in chs, chs[:300])
    await pg.go_back(); await pg.wait_for_timeout(300)
    # ---- reload keeps the place and the draft
    await pg.fill('#direction', 'An unsent thought.')
    await pg.wait_for_timeout(1500)
    await settled_reload(pg)
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(800)
    check('a reload comes back to the same chapter', await pg.text_content('#chapnum') == 'Chapter Two', await pg.text_content('#chapnum'))
    check('with what he was typing', await pg.input_value('#direction') == 'An unsent thought.', await pg.input_value('#direction'))
    # ---- two windows live
    url = pg.url
    pg2 = await page(b, logs)
    await pg2.goto(url)
    await pg2.wait_for_selector('#desk:not([hidden])', timeout=8000)
    await pg2.wait_for_timeout(800)
    k = await pg2.locator('#passages .passage').count()
    await pg.fill('#direction', 'A line from the first window.')
    await pg.click('#mineBtn')
    try:
        await pg2.wait_for_function(f"document.querySelectorAll('#passages .passage').length > {k}", timeout=6000)
        check('a second window shows new words by itself', 'first window' in await pg2.locator('#passages .passage').last.inner_text(), '')
    except Exception as e:
        check('a second window shows new words by itself', False, e)
    await pg2.locator('#passages .passage').last.click()
    await pg2.click('.passage.selected .pctl button:has-text("Edit")')
    await pg2.fill('.editbox', 'A line changed in the second window.')
    await pg2.click('.editrow button:has-text("Save")')
    try:
        await pg.wait_for_function("[...document.querySelectorAll('#passages .passage .prose')].some((p) => p.textContent.includes('second window'))", timeout=6000)
        check('and the first window sees the second one\'s edit', True)
    except Exception as e:
        check('and the first window sees the second one\'s edit', False, e)
    await pg2.close()
    # ---- the book sheet, a file out, remove and bring back
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("About this book")')
    await pg.wait_for_timeout(300)
    await pg.click('.sheet .group button.ghead:has-text("Take it out as a file")')
    async with pg.expect_download() as dl:
        await pg.click('.sheet button:has-text("E-book (EPUB)")')
    d = await dl.value
    path = await d.path()
    import zipfile
    z = zipfile.ZipFile(path)
    names = z.namelist()
    check('the book comes out as an EPUB', names[0] == 'mimetype' and any(n.endswith('.xhtml') for n in names), names[:6])
    await pg.click('.sheet .group button.ghead:has-text("Put it away")')
    await pg.click('.sheet button:has-text("Remove the book")')
    await pg.click('.sheet.on button:has-text("Remove it")')
    await pg.wait_for_selector('#shelf:not([hidden])', timeout=6000)
    await pg.wait_for_timeout(600)
    check('a removed book leaves the shelf', 'The Lantern Keeper' not in await pg.inner_text('#books'), await pg.inner_text('#books'))
    await pg.click('#shelfSettings')
    await settings_part(pg, 'Backups')
    await pg.wait_for_timeout(400)
    bk = await pg.inner_text('.sheet .group[data-key="set.backups"]')
    check('Recently deleted names the book', 'The Lantern Keeper' in bk, bk[:500])
    btn = pg.locator('.sheet .group[data-key="set.backups"] li:has-text("The Lantern Keeper") button:has-text("Bring back")').first
    await btn.click()
    await pg.wait_for_timeout(800)
    await close_sheet(pg)
    await pg.wait_for_timeout(600)
    check('and it comes back whole', 'The Lantern Keeper' in await pg.inner_text('#books'), await pg.inner_text('#books'))
    await pg.click('button.cover:has-text("The Lantern Keeper")')
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
    await pg.wait_for_timeout(500)
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    chs = await pg.text_content('#chaptersBody')
    check('with both its chapters', 'Chapter One' in chs and 'Chapter Two' in chs, chs[:200])
    # A save from an older copy is answered 409 with the newer copy, and the page
    # plays its unsaved steps over that and saves again (tests/server.py,
    # js/store.js): two windows — or a page and its own reload — saving one record
    # close together can always cross. Chromium reports each such answer as a
    # console error; it is the store doing its work, not a page error, so a few,
    # each one an answer from the store, are set aside. Anything else fails here,
    # and so does a run of crossings.
    said409 = 'error: Failed to load resource: the server responded with a status of 409 (Conflict)'
    crossed = [l for l in logs if l.startswith('HTTP 409 ') and '/api/store/' in l]
    errs = [l for l in logs if l.startswith('PAGEERROR') or l.startswith('error')]
    for _ in crossed:
        if said409 in errs:
            errs.remove(said409)
    check('no page errors along the way', not errs and len(crossed) <= 3, (errs[:5], crossed[:5]))
    await pg.close()

async def scenario_small(b):
    """a model that holds less than the book: the oldest chapters ride as summaries"""
    logs = []
    pg = await page(b, logs)
    reset()
    await new_book(pg)
    await add_conn(pg)
    LONG = ("The storm came in off the water like a held breath let go. " * 40 + "\n\n") * 5
    for i in range(3):
        await pg.fill('#direction', f'Chapter {i+1}. ' + LONG)
        await pg.click('#mineBtn')
        await pg.wait_for_timeout(300)
        await pg.click('.nextchapter button')
        await pg.wait_for_function(f"document.querySelector('#chapnum').textContent.includes('{['Two','Three','Four'][i]}')", timeout=5000)
    await pg.wait_for_function("document.querySelector('#notesBtn').dataset.state === 'idle'", timeout=40000)
    await pg.click('#bookTitle'); await pg.wait_for_timeout(300)
    chs = await pg.text_content('#chaptersBody')
    check('a long chapter is named by the helper', 'The Bottle' in chs, chs[:300])
    await pg.go_back(); await pg.wait_for_timeout(300)
    await set_model(pg, 'fake-small')
    reset()
    await write(pg, 'The rain stops.', 20000)
    r = completions()
    err = await pg.inner_text('.endcard.error') if await pg.locator('.endcard.error').count() else ''
    # its provider's list says how much it holds: known before anything is sent (Cozy Tavern M289)
    check('a model too small for his instructions and the novel craft says so in plain words, before anything is sent to it', len(r) == 0 and 'holds about 9,000 tokens' in err and 'Modules' in err and await pg.locator('#passages .passage').count() == 0, (len(r), err[:300]))
    # the novel craft off, in Settings → Your instructions → Modules
    await pg.click('#moreBtn'); await pg.click('.menu-pop button:has-text("Settings")')
    await pg.wait_for_selector('.sheet.on')
    row = pg.locator('.sheet.on .modrow[data-id="novel-craft"]')
    if not await row.is_visible():
        await settings_part(pg, 'Your instructions'); await pg.wait_for_timeout(200)
    await row.click(); await pg.wait_for_timeout(300)
    await pg.select_option('.sheet.on >> nth=-1 >> select', 'off')
    await close_sheet(pg)
    said = await pg.inner_text('.sheet.on .modrow[data-id="novel-craft"]')
    check('the list says the novel craft is off', 'Off — not sent' in said, said)
    await close_sheet(pg)
    reset()
    await write(pg, 'The rain stops.', 20000)
    r = completions()
    sizes = [sum(len(m.get('content') or '') for m in x['body']['messages']) for x in r]
    ok = await pg.locator('.endcard.error').count() == 0 and await pg.locator('#passages .passage').count() == 1
    check('with the craft off, a model too small for the whole book still writes the page', ok and sizes and sizes[-1] <= 9000 * 3, sizes)
    sysm = r[-1]['body']['messages'][0]['content'] if r else ''
    check('what was left out is said in the request', 'left out' in sysm or 'in short' in sysm, sysm[:300])
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (small model)', not errs, errs[:5])
    await pg.close()

async def scenario_wide(b):
    """a wide screen: the columns dock and the typing box sits under the page"""
    logs = []
    pg = await page(b, logs, w=1440, hgt=900, mobile=False)
    reset()
    await new_book(pg, title='Wide Book')
    await add_conn(pg)
    await write(pg, 'A first page.')
    await pg.click('#notesBtn'); await pg.wait_for_timeout(400)
    left = await pg.evaluate("document.querySelector('#chaptersPane').classList.contains('dock')")
    right = await pg.evaluate("document.querySelector('#sidePane').classList.contains('dock')")
    check('on a wide screen the chapters and notes dock beside the page', left and right, (left, right))
    geo = await pg.evaluate("""() => {
      const pg = document.querySelector('#page').getBoundingClientRect();
      const inner = document.querySelector('.composer .inner').getBoundingClientRect();
      return {page: [pg.left, pg.right], inner: [inner.left, inner.right]};
    }""")
    mid_page = (geo['page'][0] + geo['page'][1]) / 2
    mid_inner = (geo['inner'][0] + geo['inner'][1]) / 2
    check('the typing box is centred under the page', abs(mid_page - mid_inner) < 30, geo)
    await pg.screenshot(path=os.path.join(SHOTS, 'wide.png'))
    await pg.click('#notesBtn'); await pg.wait_for_timeout(300)
    check('Notes again puts the notes column away', not await pg.evaluate("document.querySelector('#sidePane').classList.contains('dock')"), '')
    errs = [l for l in logs if l.startswith('PAGEERROR')]
    check('no page errors (wide)', not errs, errs[:5])
    await pg.close()

async def main():
    with Env():
        async with async_playwright() as p:
            b = await p.chromium.launch()
            for sc in (scenario_main, scenario_small, scenario_wide):
                print(sc.__doc__ or sc.__name__)
                try:
                    await sc(b)
                except Exception:
                    traceback.print_exc()
                    check(sc.__name__ + ' ran to the end', False, traceback.format_exc()[-400:])
            await b.close()
    bad = [r for r in RESULTS if not r[1]]
    print(f'\nbrowser: {len(RESULTS) - len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)

asyncio.run(main())
