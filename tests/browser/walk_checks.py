"""The review sheet stays useful while its suggestions change; stand-in calls only."""
import asyncio
import json
import os
import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', H.PORT))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', H.PROV))
passed = 0

def check(name, ok):
    global passed
    assert ok, name
    passed += 1
    print('PASS', name, flush=True)

async def main():
    with H.Env():
        async with async_playwright() as p:
            launch = {'executable_path': os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            b = await p.chromium.launch(**launch)
            logs = []
            pg = await H.page(b, logs, 390, 844)
            await H.new_book(pg)
            # An informational toast must never block the connection menu behind it.
            await H.add_conn(pg)
            check('connection menu works while the introductory notice is visible', 'Choose a writer' not in await pg.inner_text('#writerBtn'))
            await pg.fill('#direction', 'The lamp goes out.')
            await pg.click('#writeBtn')
            await pg.wait_for_function("document.querySelector('#checkBubble').dataset.state === 'found'", timeout=40000)
            await pg.click('#checkBubble')
            await pg.wait_for_selector('.sug .word-comparison')
            check('each proposed replacement separates original and suggested words', await pg.locator('.word-before del').count() == 2 and await pg.locator('.word-after ins').count() == 2)
            await pg.click('.judgebox summary')
            await pg.locator('.sug button:text-is("Apply")').first.focus()
            await pg.keyboard.press('Enter')
            await pg.wait_for_function("document.querySelectorAll('.sug').length === 1")
            check('grade details remain open after applying a suggestion', await pg.locator('.judgebox').evaluate('(e) => e.open'))
            check('keyboard focus moves to the next suggestion action', await pg.evaluate("document.activeElement.matches('.sug button')"))
            # 2.12.2: the fix goes in on the page itself, with its Undo — no new version
            toast = await pg.inner_text('#toast')
            check('an applied fix says it is on the page, with its Undo', 'Put in on the page.' in toast and await pg.locator('#toast button.toastact:text-is("Undo")').count() == 1)
            check('no new version for a fix', await pg.evaluate("(async () => { const s = await import('/js/store.js'); const n = s.peek('novel', location.hash.split('/')[2]); const c = s.peek('chapter', n.order[0]); return c.passages[0].versions.length; })()") == 1)
            # why each grade: the checks it failed, with the words, and the scale
            why = await pg.inner_text('.judgebox .gradewhy')
            check('the grades say why each grade is what it is', 'Why each grade' in why and 'of 10' in why and 'published novelist' in why)
            check('the table holds the writer whose words were graded', await pg.locator('.judgebox table tr').count() >= 2)
            await pg.locator('.judgebox summary').focus()
            await pg.evaluate("""async () => {
                const s = await import('/js/store.js');
                const id = location.hash.split('/')[2];
                s.change('novel', id, n => { n.meta.subtitle = 'A seaside story'; }, {now: true});
            }""")
            await pg.wait_for_timeout(250)
            check('background updates keep focus on the grade summary', await pg.evaluate("document.activeElement.matches('.judgebox summary')"))
            for width in [360, 412, 1280]:
                await pg.set_viewport_size({'width': width, 'height': 900})
                for theme in ('academy', 'tokyo', 'study'):
                    for mode in ('dark', 'light'):
                        await pg.evaluate("async (look) => (await import('/js/ui/look.js')).applyLook(look)", {'theme': theme, 'mode': mode})
                        check(f'{theme} {mode} review fits {width}px with grades expanded', await pg.locator('.sugsheet .body').evaluate('(e) => e.scrollWidth <= e.clientWidth + 1'))
            await pg.locator('.sug button:text-is("Leave it")').click()
            await pg.wait_for_selector('.check-empty')
            check('finishing review offers a calm empty state', 'Room to keep writing.' in await pg.inner_text('.check-empty'))
            check('focus remains inside Suggestions when the last card is removed', await pg.evaluate("Boolean(document.activeElement.closest('.sugsheet'))"))
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(200)
            check('closing review returns focus to its button', await pg.evaluate("document.activeElement.id === 'checkBubble'"))
            # the fix taken back out from the passage's menu
            before = await pg.evaluate("(async () => { const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const n = s.peek('novel', location.hash.split('/')[2]); const v = sh.picked(s.peek('chapter', n.order[0]).passages[0]); return [v.text, v.before[v.before.length - 1].text]; })()")
            await pg.locator('.passage').first.click()
            await pg.locator('button[aria-label="More for this passage"]').first.click()
            await pg.locator('.menu-pop button:has-text("Put back the words before")').click()
            await pg.wait_for_timeout(250)
            now = await pg.evaluate("(async () => { const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const n = s.peek('novel', location.hash.split('/')[2]); return sh.picked(s.peek('chapter', n.order[0]).passages[0]).text; })()")
            check('Put back the words before brings the words before the fix back', now == before[1] and now != before[0])
            check('and says so', 'The words before are back.' in await pg.inner_text('#toast'))
            # (2.12.41, the review of 2.12.40) the checker in trouble: Try again now is the way on, the Check buttons wait,
            # and the words say how long is left as it stands; its wait over while a page is being written, it says it
            # tries again once the page is done — never a wait gone stale, never a sheet with no way on and no true word
            trouble = """async ([until, writing]) => {
              const ck = await import('/js/novel/checker.js');
              const nid = location.hash.split('/')[2];
              const t = ck.forTests();
              t.failures.set(nid, { n: 3, until: Date.now() + until });
              t.states.set(nid, { state: 'trouble', words: 'The checker couldn’t finish just now (down for a moment). It tries again by itself in ten minutes.', why: 'down for a moment' });
              const was = t.timers.get(nid); if (was) { clearTimeout(was.t); t.timers.delete(nid); }
              if (writing) t.lifting.set(nid, new Promise(() => {})); else t.lifting.delete(nid);
              document.querySelector('#checkBubble').click();
              await new Promise((r) => setTimeout(r, 300));
              const sheet = document.querySelector('.sheet.on:not([aria-hidden="true"]) .body');
              const said = sheet ? sheet.innerText : '';
              const buttons = sheet ? [...sheet.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
              return { said, buttons };
            }"""
            got = await pg.evaluate(trouble, [3 * 60000 + 2000, False])
            if not ('Try again now' in got['buttons'] and 'Check this chapter' not in got['buttons'] and 'tries again by itself in three minutes' in got['said']): print('  saw:', got)
            check('the checker in trouble: Try again now is there, the Check buttons wait', 'Try again now' in got['buttons'] and 'Check this chapter' not in got['buttons'])
            check('and its wait is said as it stands now', 'tries again by itself in three minutes' in got['said'])
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(300)
            got = await pg.evaluate(trouble, [-1000, True])
            if 'tries again once the page being written is done' not in got['said']: print('  saw:', got)
            check('its wait over while a page is being written: it says it tries again once the page is done', 'tries again once the page being written is done' in got['said'] and 'in ten minutes' not in got['said'])
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(300)
            await pg.evaluate("""async () => { const ck = await import('/js/novel/checker.js'); const nid = location.hash.split('/')[2]; ck.forTests().lifting.delete(nid); ck.tryNow(nid); }""")
            await pg.wait_for_timeout(600)
            check('no browser exceptions', not [x for x in logs if x.startswith('PAGEERROR')])
            # the ring turns while the checker waits or checks — with Ambient animation off and the phone's reduced
            # motion too, and stops only in a tab out of sight (2.12.32: "not circling, just stuck")
            turn = """async ([state, hidden]) => {
              const b = document.querySelector('#checkBubble');
              b.dataset.state = state; b.textContent = ''; const r = document.createElement('span'); r.className = 'ring'; b.append(r);
              if (hidden) document.documentElement.dataset.pageHidden = 'true'; else delete document.documentElement.dataset.pageHidden;
              /* turning, not breathing: the ring's angle moves (a scale alone leaves it at nought) */
              const angle = (t) => { const m = /matrix\(([^,]+), ([^,]+)/.exec(t); return m ? Math.round(Math.atan2(+m[2], +m[1]) * 180 / Math.PI) : 0; };
              const seen = new Set();
              for (let i = 0; i < 6; i++) { seen.add(angle(getComputedStyle(r).transform)); await new Promise((ok) => setTimeout(ok, 120)); }
              return seen.size > 2;
            }"""
            for label, reduced, motion in (('motion on', 'no-preference', 'on'), ('Ambient animation off', 'no-preference', 'off'), ('reduced motion', 'reduce', 'on')):
                ctx = await b.new_context(viewport={'width': 412, 'height': 915}, reduced_motion=reduced)
                rp = await ctx.new_page()
                await H.new_book(rp, title='The Ring')
                await rp.evaluate("(m) => { document.documentElement.dataset.motion = m; }", motion)
                moving = [await rp.evaluate(turn, [s, False]) for s in ('waiting', 'checking')]
                check(f'the checker’s ring turns while it waits and while it checks ({label})', moving == [True, True])
                check(f'and stands still in a tab out of sight ({label})', not await rp.evaluate(turn, ['checking', True]))
                await ctx.close()
            # 2.12.35: the phone's reduced motion with Ambient animation off too — the ring alone turns, and slowly; the
            # notes' light does not breathe, nor the caret blink (the rules that keep them moving outranked reduced motion)
            ctx = await b.new_context(viewport={'width': 412, 'height': 915}, reduced_motion='reduce')
            rp = await ctx.new_page()
            await H.new_book(rp, title='The Slow Ring')
            await rp.evaluate("(m) => { document.documentElement.dataset.motion = m; }", 'off')
            moving = [await rp.evaluate(turn, [s, False]) for s in ('waiting', 'checking')]
            check('reduced motion and Ambient animation off: the ring still turns, waiting and checking', moving == [True, True])
            slow = await rp.evaluate("() => getComputedStyle(document.querySelector('#checkBubble .ring')).animationDuration")
            check(f'and slowly, as reduced motion asks ({slow})', slow == '2.4s')
            still = await rp.evaluate("""() => {
              const n = document.createElement('button'); n.className = 'notesbtn'; n.dataset.state = 'reading';
              const d = document.createElement('span'); d.className = 'dot'; n.append(d); document.body.append(n);
              const name = getComputedStyle(d).animationName; n.remove(); return name;
            }""")
            check(f'and the notes’ light does not breathe (animation: {still})', still == 'none')
            await ctx.close()
            # 2.12.33: a chapter read whole once it has ended — a cup set down, and later still in her hand — its fix on a
            # card that says what the book says before it, and where it was found
            ctx = await b.new_context(viewport={'width': 412, 'height': 915})
            wp = await ctx.new_page()
            wlogs = []
            wp.on('pageerror', lambda e: wlogs.append(str(e)))
            await H.new_book(wp, title='The Cup')
            await H.add_conn(wp)
            await wp.evaluate("""async () => {
              const s = await import('/js/store.js'); const sh = await import('/js/novel/shape.js'); const w = await import('/js/novel/writer.js');
              const id = location.hash.split('/')[2]; const one = s.peek('novel', id).order[0];
              for (const t of ['She set the cup down on the sill and looked out at the rain.', 'The wind had come up off the sea.', 'She turned back to the room, the cup still warm in her hand.']) w.addMine({ novelId: id, chapterId: one, text: t });
              const two = sh.newChapter(id);
              await s.create('chapter', two.id, two);
              s.change('novel', id, (n) => { n.order.push(two.id); }, { now: true });
              w.addMine({ novelId: id, chapterId: two.id, text: 'Morning came grey over the cliffs.' });
            }""")
            await wp.wait_for_function("document.querySelector('#checkBubble').dataset.state === 'found'", timeout=60000)
            await wp.click('#checkBubble')
            await wp.wait_for_selector('.sug .sugheld', timeout=10000)
            card = await wp.inner_text('.sug:has(.sugheld)')
            check('the chapter read whole: its fix on a card — what it holds to in the book’s words, and where it was found', 'As the book says before it:' in card and 'She set the cup down on the sill' in card and 'Found when the chapter was read whole.' in card and 'the cup cooling on the sill' in card)
            check('no browser exceptions reading the chapter whole', not wlogs)
            await ctx.close()
            # (2.12.41, round 8) the checker waiting out a model that kept silent for as long as it is ever waited — the
            # helper's silence, on the same connection: nothing asked of it, said with when in the bubble and in
            # Suggestions (never "in a moment"), and Check this chapter there to ask now; what waits its time after a stall
            # said with when too, and said again as the time passes, nothing else changing
            ctx = await b.new_context(viewport={'width': 412, 'height': 915})
            qp = await ctx.new_page()
            qlogs = []
            qp.on('pageerror', lambda e: qlogs.append(str(e)))
            await H.new_book(qp, title='The Quiet Shore')
            await H.add_conn(qp)
            await qp.evaluate("""async () => {
              const s = await import('/js/store.js'); const a = await import('/js/novel/archivist.js'); const ck = await import('/js/novel/checker.js'); const w = await import('/js/novel/writer.js');
              const id = location.hash.split('/')[2]; const one = s.peek('novel', id).order[0];
              window.__q = { s, id, print: a.choicePrint(ck.checkerConn(s.peek('house', 'house'))) };
              s.change('novel', id, (d) => { d.memory = { ...(d.memory || {}), silent: { [window.__q.print]: { until: s.phoneNow() + 14 * 60000, leashMs: 15 * 60000 } } }; });
              w.addMine({ novelId: id, chapterId: one, text: 'Mara walked the quiet shore at dawn.' });
              await s.flush();
            }""")
            quiet_words = 'The checker’s model sent nothing for fifteen minutes — the checker asks it again in fourteen minutes, and nothing more until then.'
            bubble = "() => document.querySelector('#checkBubble')?.title || ''"
            try: await qp.wait_for_function(f"({bubble})().includes('sent nothing for fifteen minutes')", timeout=15000)
            except Exception: pass
            title = await qp.evaluate(bubble)
            if quiet_words not in title: print('  saw:', title)
            check('the checker waiting out its silent model says so in its bubble, with when', quiet_words in title)
            await qp.click('#checkBubble')
            await qp.wait_for_selector('.sugsheet .sugstate')
            line = await qp.inner_text('.sugsheet .sugstate')
            buttons = await qp.evaluate("() => [...document.querySelectorAll('.sugsheet .check-actions button')].map((x) => x.textContent.trim())")
            if not (quiet_words in line and 'Check this chapter' in buttons): print('  saw:', line, buttons)
            check('and in Suggestions, with Check this chapter there to ask now', quiet_words in line and 'Check this chapter' in buttons)
            check('nothing was asked of it meanwhile', not [r for r in H.reqs() if 'Check these passages from' in json.dumps(r) and 'Mara walked the quiet shore at dawn.' in json.dumps(r)])
            await qp.click('.sugsheet .check-actions button:text-is("Check this chapter")')
            await qp.wait_for_function("""() => { const q = window.__q; const n = q.s.peek('novel', q.id); const sil = (n.memory || {}).silent || {};
              const c = q.s.peek('chapter', n.order[0]); const p = c.passages.find((x) => (x.versions || []).some((v) => v.text === 'Mara walked the quiet shore at dawn.'));
              return !sil[q.print] && Boolean(p && c.checks && c.checks[p.id]); }""", timeout=20000)
            check('Check this chapter asks now: the wait let go, the passage checked', True)
            await qp.keyboard.press('Escape')
            await qp.wait_for_timeout(300)
            # a passage waiting its time after a stall, fifty seconds on (as the checker keeps it, checker.js triedCount)
            await qp.evaluate("""async () => {
              const q = window.__q; const w = await import('/js/novel/writer.js'); const sh = await import('/js/novel/shape.js'); const u = await import('/js/util.js');
              const one = q.s.peek('novel', q.id).order[0];
              w.addMine({ novelId: q.id, chapterId: one, text: 'The tide came in over the stones.' });
              q.s.change('chapter', one, (c) => { const p = c.passages.find((x) => (x.versions || []).some((v) => v.text === 'The tide came in over the stones.')); const v = sh.picked(p); v.tries = { check: { fp: u.hashText(v.text), n: 0, next: q.s.phoneNow() + 50000, conn: q.print } }; });
              await q.s.flush();
            }""")
            slow = 'again in a minute — its model was too slow to answer for it.'
            try: await qp.wait_for_function(f"({bubble})().includes({json.dumps(slow)})", timeout=8000)
            except Exception: pass
            title = await qp.evaluate(bubble)
            if not ('The checker checks Chapter One, passage' in title and slow in title): print('  saw:', title)
            check('what waits its time after a stall is said with when in the bubble', 'The checker checks Chapter One, passage' in title and slow in title)
            t0 = asyncio.get_event_loop().time()
            try:
                await qp.wait_for_function(f"({bubble})().includes('again in a moment — its model was too slow to answer for it.')", timeout=50000)
                took, ok = asyncio.get_event_loop().time() - t0, True
            except Exception:
                took, ok = asyncio.get_event_loop().time() - t0, False
            if not (ok and took > 15): print('  saw:', round(took, 1), await qp.evaluate(bubble))
            check('and said again as the time passes, nothing else changing', ok and took > 15)
            check('no browser exceptions while it waits', not qlogs)
            await ctx.close()
            await b.close()
    print(f'{passed} passed', flush=True)

asyncio.run(main())
