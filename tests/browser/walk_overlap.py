"""Nothing on screen lies over a control (2.12.36 — his report: "Follow the writing" lay under the Suggestions
bubble while a page streamed, and over a scene its Undo stood in the middle of the window, over the scene's own
buttons). Each state the app comes to — the page at rest, writing, scrolled up while it writes, with a line at the
bottom and its Undo; the Suggestions sheet with its Undo; Notes, the partner and a scene, beside the page or over
it; a scene's full screen; the page's full screen; reading mode — at a small phone, a phone, a tablet and two wide
screens. In each: every control of the layer on top can be pressed where it shows (at nine points across it, the
control itself is what is there), the line at the bottom lies over no control of the screen's frame — the box, the
row above it, a pane's head and foot — and, scrolled to the end, nothing of the frame lies over the last controls
of the page or the pane. Temporary books and the stand-in model only.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright
H.PORT = int(os.environ.get('COZY_TEST_PORT', '28681'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '28699'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f' [saw: {str(saw)[:900]}]'), flush=True)


async def frames(pg, count=3):
    await pg.evaluate('async n=>{for(let i=0;i<n;i++)await new Promise(requestAnimationFrame)}', count)


# Every control of the layer on top, sampled at nine points: what is there must be the control (or inside it, or
# what holds it). `content`: also the controls of what scrolls (the page, a pane, a sheet) — looked at only where
# that has been scrolled to its end, where nothing may stay under the frame. A line at the bottom may lie over what
# scrolls (it goes in a moment, and the words under it move), never over the frame.
COVERED = r"""(content) => {
  const vw = innerWidth, vh = innerHeight;
  /* the layer on top: a sheet; else a pane over the whole screen; else the panes over the page as drawers; else all */
  const roots = (() => {
    const menu = [...document.querySelectorAll('.menu-pop')].filter((m) => m.getClientRects().length).pop();
    if (menu) return [menu];
    const sheets = [...document.querySelectorAll('.sheet.on:not([aria-hidden="true"]) > .box')];
    if (sheets.length) return [sheets[sheets.length - 1]];
    const full = document.querySelector('.pane.right.full');
    if (full) return [full];
    if (document.querySelector('#scrim.on')) return [...document.querySelectorAll('.pane.open')].filter((p) => getComputedStyle(p).position === 'fixed');
    return [document.body];
  })();
  const SCROLLS = '#pageWrap, .panebody, .sheet .body, .playturns, .talkturns';
  const shown = (el) => {
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const st = getComputedStyle(el);
    if (st.visibility !== 'visible' || Number(st.opacity) < 0.05 || st.pointerEvents === 'none' || st.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };
  const clipped = (el, r) => {
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) return true;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX + ' ' + s.overflowY)) {
        const q = p.getBoundingClientRect();
        if (r.left < q.left - 0.5 || r.right > q.right + 0.5 || r.top < q.top - 0.5 || r.bottom > q.bottom + 0.5) return true;
      }
    }
    return false;
  };
  const name = (el) => {
    if (!el) return '(nothing)';
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const t = (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 34);
    return `${el.tagName.toLowerCase()}${id}${cls}${t ? ` “${t}”` : ''}`;
  };
  const toast = document.querySelector('#toast.on');
  const menuOn = roots.length === 1 && roots[0].classList.contains('menu-pop');
  const list = roots.flatMap((root) => [...root.querySelectorAll('button, input:not([type=hidden]), textarea, select, [role=tab], [role=slider], a[href], summary')]);
  /* (a menu open is the layer on top: the line under it waits) */
  if (toast && !menuOn && !roots.some((root) => root.contains(toast))) list.push(...toast.querySelectorAll('button'));
  /* the banner that says the phone is not answering is the frame too: what it lies over is counted */
  const banner = document.querySelector('#banner:not([hidden])');
  if (banner && !menuOn) list.push(...banner.querySelectorAll('button'));
  const out = [];
  for (const el of list) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (clipped(el, r)) continue;
    /* what scrolls with the words: inside a scroller, and not held in place outside it (a control placed against
     * the column, as Follow the writing was, is the frame) */
    const sc = el.closest(SCROLLS);
    let inScroll = Boolean(sc);
    for (let n = el; inScroll && n && n !== sc; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if ((pos === 'fixed' || pos === 'sticky') || (pos === 'absolute' && n.offsetParent && n.offsetParent !== sc && !sc.contains(n.offsetParent))) inScroll = false;
    }
    if (inScroll && !content) continue;
    /* what scrolls is looked at only at the end it has been scrolled to: under the frame at the foot when scrolled to
     * its end, under the frame at the top when scrolled to its start — in between, words pass under the frame */
    if (inScroll && content === 'end' && r.top + r.height / 2 < vh / 2) continue;
    if (inScroll && content === 'start' && r.top + r.height / 2 >= vh / 2) continue;
    for (const fx of [0.15, 0.5, 0.85]) {
      let bad = null;
      for (const fy of [0.2, 0.5, 0.8]) {
        const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
        /* the line at the bottom over what scrolls is no clash: it goes, and the words move */
        if (inScroll && toast && toast.contains(hit)) continue;
        bad = hit; break;
      }
      if (bad) { out.push(`${name(el)} under ${name(bad)}`); break; }
    }
  }
  return out;
}"""

# The line at the bottom's own rectangle against every control of the sheet on top (2.12.40, the audit: the look above
# finds what lies over a control by what is there at a point, and the line's words let taps through — so a line over a
# sheet's last buttons went unseen). `end`: the sheet's words scrolled to their end first.
LINE_OVER = r"""(end) => {
  const t = document.querySelector('#toast.on');
  if (!t) return ['(no line showing)'];
  const box = [...document.querySelectorAll('.sheet.on:not([aria-hidden="true"]) > .box')].pop();
  if (!box) return ['(no sheet)'];
  const body = box.querySelector('.body');
  if (end && body) body.scrollTop = body.scrollHeight;
  const tr = t.getBoundingClientRect();
  if (tr.top < 0 || tr.bottom > innerHeight) return ['(the line is off the screen)'];
  const view = body ? body.getBoundingClientRect() : box.getBoundingClientRect();
  const out = [];
  for (const el of box.querySelectorAll('button, input:not([type=hidden]), textarea, select, a[href]')) {
    if (t.contains(el) || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    /* (only what shows: a control scrolled out of the sheet's words is under nothing) */
    if (body && body.contains(el) && (r.bottom <= view.top || r.top >= view.bottom)) continue;
    if (end && body && body.contains(el) && el !== [...body.querySelectorAll('button')].pop()) continue;
    if (r.left < tr.right && r.right > tr.left && r.top < tr.bottom && r.bottom > tr.top) out.push((el.textContent || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 30));
  }
  return out;
}"""

SCROLL = """(end) => { for (const s of ['#pageWrap', '#sideBody', '.sheet.on .body', '.playturns', '.talkturns']) for (const el of document.querySelectorAll(s)) el.scrollTop = end ? el.scrollHeight : 0; }"""


async def look(pg, label, content=True):
    """Scrolled to the start and to the end (the frame over neither end of what scrolls), or as it stands (content:
    False — the page scrolled up while it writes: only the frame)."""
    found = []
    if content:
        for end in (False, True):
            await pg.evaluate(SCROLL, end)
            await frames(pg, 4)
            found += await pg.evaluate(COVERED, 'end' if end else 'start')
    else:
        await frames(pg, 4)
        found = await pg.evaluate(COVERED, False)
    found = sorted(set(found))
    check(f'{label}: nothing lies over a control', not found, found)
    return found


async def line(pg, words='What came after it is let go (2 parts) — Undo puts it back.', at=None):
    """A line at the bottom with its Undo, said after a tap where he is working (`at`: what he tapped)."""
    if at:
        await pg.evaluate("(sel) => { const el = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }", at)
    await pg.evaluate("(w) => import('/js/ui/dom.js').then((d) => d.undoToast(w, () => {}))", words)
    await pg.wait_for_timeout(350)


async def write_page(pg, premise=''):
    await pg.fill('#direction', premise)
    await pg.click('#writeBtn')
    await pg.wait_for_function("!document.querySelector('#passages .streaming')", timeout=30000)
    await pg.wait_for_timeout(300)


async def size(browser, w, hgt, mobile):
    tag = f'{w}×{hgt}'
    logs = []
    pg = await H.page(browser, logs, w=w, hgt=hgt, mobile=mobile)
    await H.new_book(pg, f'No clash {tag}')
    await H.add_conn(pg)
    for _ in range(3):
        await write_page(pg)
    await look(pg, f'{tag} the page at rest, at its end')
    # writing, scrolled up: Follow the writing beside Suggestions — and a line at the bottom then
    await pg.fill('#direction', 'SLOW she climbs the stair')
    await pg.click('#writeBtn')
    await pg.wait_for_timeout(1200)
    await pg.mouse.move(w // 2, hgt // 3)
    for _ in range(8):
        await pg.mouse.wheel(0, -500)
        await pg.wait_for_timeout(90)
    await pg.wait_for_timeout(500)
    shown = await pg.evaluate("!document.querySelector('#followBtn').hidden")
    check(f'{tag} scrolled up while it writes, Follow the writing shows', shown)
    await look(pg, f'{tag} writing, scrolled up', content=False)
    await line(pg, 'Put in on the page.', at='#passages .passage')
    await look(pg, f'{tag} writing, scrolled up, a line at the bottom', content=False)
    await pg.wait_for_function("document.querySelector('#followBtn').hidden", timeout=60000)
    await pg.wait_for_function("!document.querySelector('#passages .streaming')", timeout=60000)
    await line(pg, 'Put in on the page.', at='#passages .passage')
    await look(pg, f'{tag} the page with a line at the bottom')
    # the Suggestions sheet, a line in it
    await pg.click('#checkBubble')
    await pg.wait_for_selector('.sheet.on .box')
    await pg.wait_for_timeout(400)
    await look(pg, f'{tag} Suggestions')
    await line(pg, 'Put in on the page.', at='.sheet.on .head h2')
    await look(pg, f'{tag} Suggestions, a line at the bottom')
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(500)
    # a small sheet opened while a line with its Undo shows, and a long one scrolled to its end: the line lies over
    # none of their controls
    await line(pg, 'Put in on the page.')
    await pg.evaluate("() => import('/js/ui/dom.js').then((d) => { d.confirmIt('Take it out?', 'It goes to Recently deleted, for thirty days.', 'Take it out'); })")
    await pg.wait_for_selector('.sheet.on .box')
    await pg.wait_for_timeout(450)
    over = await pg.evaluate(LINE_OVER, False)
    check(f'{tag} a small sheet opened while a line shows: the line lies over none of its buttons', not over, over)
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(400)
    await pg.evaluate("""() => import('/js/ui/dom.js').then((d) => { const s = d.openSheet('A long one'); for (let i = 0; i < 40; i++) s.body.append(d.h('button.btn.small', { title: 'A button.' }, `Button ${i + 1}`)); })""")
    await pg.wait_for_selector('.sheet.on .box')
    await pg.wait_for_timeout(300)
    await line(pg, 'Put in on the page.')
    over = await pg.evaluate(LINE_OVER, True)
    check(f'{tag} a long sheet with a line showing, scrolled to its end: its last button clear of the line', not over, over)
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(400)
    # Notes, the partner, a scene
    nid = await pg.evaluate("location.hash.split('/')[2]")
    for tab in ('notes', 'partner'):
        await H.panes_call(pg, 'showSide', [tab])
        await frames(pg)
        await look(pg, f'{tag} {tab.capitalize()}')
        await line(pg, at='#sideBody')
        await look(pg, f'{tag} {tab.capitalize()}, a line at the bottom')
    await pg.evaluate("""async (nid) => { const talk = await import('/js/novel/talk.js'); const s = await import('/js/store.js');
      const n = s.peek('novel', nid); await talk.newPlay({ novelId: nid, chapterId: n.order[0], who: 'Mara', from: 'The stair' }); }""", nid)
    await H.panes_call(pg, 'showSide', ['play'])
    await frames(pg)
    await pg.locator('#sideBody .plays button').filter(has_text='The stair').first.click()
    await pg.wait_for_timeout(600)
    await pg.locator('#sideFoot textarea:not(.tellbox)').fill('I take the lamp and go up.')
    await pg.locator('#sideFoot button.primary').last.click()
    await pg.wait_for_function("!document.querySelector('#sideBody .streaming')", timeout=30000)
    await pg.wait_for_timeout(500)
    await look(pg, f'{tag} a scene')
    await line(pg, at='#sideBody')
    await look(pg, f'{tag} a scene, a line at the bottom')
    await pg.get_by_role('button', name='Full screen', exact=True).last.click()
    await pg.wait_for_timeout(600)
    await look(pg, f'{tag} a scene full screen')
    await line(pg, at='#sideBody')
    await look(pg, f'{tag} a scene full screen, a line at the bottom')
    # the phone not answering: a save turned away, the banner as the app shows it — over the scene full screen and beside
    # the page — and gone once the phone answers again
    async def refuse(route):
        if route.request.method == 'PUT':
            await route.abort()
        else:
            await route.continue_()
    await pg.route('**/api/store/**', refuse)
    await pg.evaluate("(nid) => import('/js/store.js').then((s) => s.change('novel', nid, (n) => { n.meta = { ...(n.meta || {}), touched: Date.now() }; }, { now: true }))", nid)
    await pg.wait_for_selector('#banner:not([hidden])', timeout=20000)
    await pg.wait_for_timeout(300)
    await look(pg, f'{tag} a scene full screen, the phone not answering')
    await pg.get_by_role('button', name='Leave full screen', exact=True).last.click()
    await pg.wait_for_timeout(500)
    await look(pg, f'{tag} a scene, the phone not answering')
    await pg.unroute('**/api/store/**', refuse)
    await pg.evaluate("(nid) => import('/js/store.js').then((s) => s.change('novel', nid, (n) => { n.meta = { ...(n.meta || {}), touched: Date.now() }; }, { now: true }))", nid)
    await pg.wait_for_selector('#banner[hidden]', state='attached', timeout=30000)
    check(f'{tag} the phone answering again, the band at the top goes with the banner', await pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--banner-band').trim() === ''"))
    await pg.click('#sideClose')
    await pg.wait_for_timeout(400)
    # the partner over the whole screen
    await H.panes_call(pg, 'showSide', ['partner'])
    await frames(pg)
    await pg.locator('#sidePane .panebody button[aria-label="Full screen"]').first.click()
    await pg.wait_for_timeout(600)
    await look(pg, f'{tag} the partner full screen')
    await line(pg, at='#sideBody')
    await look(pg, f'{tag} the partner full screen, a line at the bottom')
    await pg.locator('#sidePane button[aria-label="Leave full screen"]').first.click()
    await pg.wait_for_timeout(500)
    await pg.click('#sideClose')
    await pg.wait_for_timeout(400)
    # the chapters, as a drawer over the page (a column beside it on a wide screen: looked at with the page)
    if not await pg.evaluate("document.querySelector('#chaptersPane').classList.contains('dock')"):
        await pg.click('#bookTitle')
        await pg.wait_for_timeout(500)
        await look(pg, f'{tag} the chapters')
        await line(pg, at='#chaptersBody')
        await look(pg, f'{tag} the chapters, a line at the bottom')
        await pg.click('#chaptersClose')
        await pg.wait_for_timeout(400)
    # a menu opened while a line shows: the menu on top, every one of its items to be pressed
    await line(pg, 'Put in on the page.', at='#passages .passage')
    await pg.locator('#passages button[aria-label="More for this passage"]').last.click()
    await pg.wait_for_selector('.menu-pop')
    await pg.wait_for_timeout(250)
    await look(pg, f'{tag} a passage’s menu over a line at the bottom', content=False)
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(300)
    # words of a page selected: the box grows by the row that says them, and a line comes
    await pg.evaluate("""() => { const p = [...document.querySelectorAll('#passages .passage .prose p')].pop(); const r = document.createRange();
      r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, Math.min(24, p.firstChild.length)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    await pg.wait_for_timeout(500)
    check(f'{tag} words selected, the row that says them shows', await pg.evaluate("!document.querySelector('#selBar').hidden"))
    await line(pg, 'Put in on the page.', at='#passages .passage')
    await look(pg, f'{tag} words selected, a line at the bottom', content=False)
    await pg.evaluate("() => getSelection().removeAllRanges()")
    await pg.wait_for_timeout(300)
    # the scroller held, its tip beside it, at the foot of the page
    thumb = pg.locator('#scroller .thumb')
    if await thumb.is_visible():
        box = await thumb.bounding_box()
        await pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        await pg.mouse.down()
        await pg.mouse.move(box['x'] + box['width'] / 2, hgt - 40, steps=8)
        await pg.wait_for_timeout(200)
        await look(pg, f'{tag} the scroller held at the foot', content=False)
        await pg.mouse.up()
        await pg.wait_for_timeout(300)
    # the page's full screen, and reading mode — on a wide screen the notes' column beside the page goes, is not drawn
    # while it is gone, and comes back drawn as the book stands (2.12.40, the audit: it was drawn behind them all along)
    await H.panes_call(pg, 'showSide', ['notes'])
    await frames(pg)
    docked = await pg.evaluate("document.querySelector('#sidePane').classList.contains('dock')")
    for n, (item, leave) in enumerate((('Full screen', '.fullexit'), ('Reading mode', '.readexit'))):
        await pg.click('#moreBtn')
        await pg.locator('.menu-pop button').filter(has_text=item).first.click()
        await pg.wait_for_timeout(700)
        await look(pg, f'{tag} {item}')
        await line(pg, 'Put in on the page.', at='#passages .passage')
        await look(pg, f'{tag} {item}, a line at the bottom')
        name = f'Zedekiah Vale {n + 1}'
        if docked:
            await pg.evaluate("([nid, name]) => import('/js/store.js').then((s) => s.change('novel', nid, (x) => { x.notes.people.push({ id: 'pe-zv' + Date.now(), name, aka: [], about: 'A ferryman.' }); }, { now: true }))", [nid, name])
            await pg.wait_for_timeout(500)
            drawn = await pg.evaluate("(name) => document.querySelector('#sideBody').textContent.includes(name)", name)
            check(f'{tag} {item}: the notes’ column it hides is not drawn behind it', not drawn)
        await pg.locator(leave).first.click()
        await pg.wait_for_timeout(600)
        if docked:
            await frames(pg, 4)
            back = await pg.evaluate("(name) => document.querySelector('#sideBody').textContent.includes(name)", name)
            check(f'{tag} {item} left: the notes’ column comes back drawn as the book stands', back)
    errs = [x for x in logs if x.startswith('PAGEERROR')]
    check(f'{tag} no page errors', not errs, errs[:3])
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None), headless=True)
            try:
                for w, hgt, mobile in [(360, 740, True), (412, 915, True), (768, 1024, True), (1280, 800, False), (1600, 900, False)]:
                    await size(browser, w, hgt, mobile)
            except Exception:
                traceback.print_exc()
                RESULTS.append(False)
            await browser.close()
    print(f'overlap: {sum(RESULTS)} passed, {len(RESULTS) - sum(RESULTS)} failed')
    sys.exit(0 if all(RESULTS) else 1)


asyncio.run(main())
