"""What rides in short, where he looks for it: a chapter's summary with what
the helper's check made of it, a long chapter's stretches each in its fold,
a summary waiting for the chapter's latest changes, his own summary, a
chapter not summed up yet — and a long scene's stretches from the scene's own
menu (2.11.3).

Real browser and server, a temporary library; no connection is chosen, so no
helper changes anything while the walk reads. No paid calls. The default
ports are its own; environment overrides work.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright

H.PORT = int(os.environ.get('COZY_TEST_PORT', '21881'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '21899'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok), saw))
    print(('  ok   ' if ok else '  FAIL ') + name +
          ('' if ok else f'   [saw: {str(saw)[:500]}]'), flush=True)


async def chapter_menu(pg, row=0):
    if not await pg.locator('.chlist li').count() or not await pg.locator('.chlist').is_visible():
        await pg.click('#bookTitle')
    await pg.wait_for_selector('.chlist li')
    await pg.wait_for_timeout(300)
    await pg.locator('.chlist li').nth(row).get_by_role('button', name='More for this chapter').click()
    await pg.wait_for_selector('.menu-pop')


async def open_summary(pg, row=0):
    await chapter_menu(pg, row)
    await pg.locator('.menu-pop button').filter(has_text='Its summary').click()
    await pg.wait_for_selector('.sheet.on .summary-sheet')
    await pg.wait_for_timeout(250)


async def sheet_text(pg):
    return await pg.locator('.sheet.on .summary-sheet').inner_text()


async def close_sheet(pg):
    await pg.click('.sheet.on .head button[aria-label=Close] >> nth=-1')
    await pg.wait_for_function("!document.querySelector('.sheet.on')")


async def fits(pg):
    return await pg.evaluate("""() => { const b = document.querySelector('.sheet.on .summary-sheet');
      return { over: document.documentElement.scrollWidth - window.innerWidth, wide: b.getBoundingClientRect().right - window.innerWidth }; }""")


async def scenario(browser):
    logs = []
    pg = await H.page(browser, logs)
    await H.new_book(pg, 'The Gate', 'A keeper of a border gate and the ring she will not take.')
    nid = (await pg.evaluate('location.hash')).split('/')[2]
    fx = await pg.evaluate("""async nid => {
      const s = await import('/js/store.js');
      const sh = await import('/js/novel/shape.js');
      const st = await import('/js/novel/stretches.js');
      const C = await import('/js/novel/summarycheck.js');
      const talk = await import('/js/novel/talk.js');
      const n = s.peek('novel', nid), first = n.order[0];
      const words = (k, tag) => Array.from({ length: k }, (_, i) => `${tag}${i % 40}`).join(' ') + '.';
      /* a long first chapter, a second after it (the first is no longer being written) */
      const two = sh.newChapter(nid);
      two.passages.push(sh.newPassage('ai', 'The second chapter begins at the gate.'));
      await s.create('chapter', two.id, two);
      s.change('novel', nid, x => { x.order.push(two.id); });
      s.change('chapter', first, c => {
        c.passages = Array.from({ length: 10 }, (_, i) => sh.newPassage('ai', words(1000, `p${i}w`)));
      });
      const c = s.peek('chapter', first);
      const plan = st.stretchPlan(c, { closeLast: true });
      const texts = plan.stretches.map((x, k) => `Stretch ${k + 1}: Mara keeps the gate and refuses the ring.`);
      plan.stretches.forEach((x, k) => {
        x.text = texts[k]; x.at = 1;
        if (k === 0) x.checked = { sig: C.checkSig(texts[k]), at: 2, fixed: [{ from: 'accepts the ring', to: 'refuses the ring' }] };
        if (k === 1) x.checked = { sig: C.checkSig(texts[k]), at: 2 };
        if (k === 2) x.checked = { sig: C.checkSig(texts[k]), at: 2, unread: true };
      });
      const summary = 'Mara keeps the gate through the winter. She refused the ring. Tom swears he will come back for it before the thaw.';
      s.change('chapter', first, x => {
        x.stretches = st.keptStretches(plan);
        x.summary = { text: summary, fp: sh.chapterPrint(x), at: 3,
          checked: { sig: C.checkSig(summary), at: 4, fixed: [{ from: 'accepted the ring', to: 'refused the ring' }], added: ['Tom swears he will come back for it before the thaw.'] } };
      });
      /* a long scene kept in stretches, and a short one */
      const play = await talk.newPlay({ novelId: nid, chapterId: first, who: 'Mara' });
      for (let i = 0; i < 40; i++) s.change('play', play, sh.turnSteps.addTurn(sh.newTurn(i % 2 ? 'ai' : 'you', words(150, `t${i}w`))));
      const p = s.peek('play', play);
      const sp = st.scenePlan(p);
      sp.stretches.forEach((x, k) => { x.text = `Scene stretch ${k + 1}: Mara at the gate, the narrator's storm.`; x.at = 1; if (k === 0) x.checked = { sig: C.checkSig(x.text), at: 2 }; });
      s.change('play', play, sh.turnSteps.set({ stretches: st.keptStretches(sp) }));
      const short = await talk.newPlay({ novelId: nid, chapterId: first, who: 'Tom' });
      s.change('play', short, sh.turnSteps.addTurn(sh.newTurn('you', 'I wait by the gate.')));
      await s.flush();
      return { first, two: two.id, stretches: plan.stretches.length, play, short, sceneStretches: sp.stretches.length,
        firstNums: [1, plan.stretches[0].ids.length] };
    }""", nid)
    await pg.evaluate("x => location.hash = '#/n/' + x.nid + '/' + x.cid", {'nid': nid, 'cid': fx['first']})
    await pg.wait_for_timeout(600)

    # The chapter's summary, with what the check made of it.
    await open_summary(pg, 0)
    t = await sheet_text(pg)
    check('Its summary shows the summary that rides', 'Mara keeps the gate through the winter. She refused the ring.' in t, t)
    check('and what the check put right in it, and what it added',
          'Checked against the chapter, and put right: “accepted the ring” → “refused the ring”' in t and 'Added: “Tom swears he will come back for it before the thaw.”' in t, t)
    folds = await pg.locator('.sheet.on .summary-stretch summary').all_inner_texts()
    check('a long chapter shows each of its stretches in a fold of its own, by its passages', len(folds) == fx['stretches'] and folds[0].startswith(f"Passages {fx['firstNums'][0]}–{fx['firstNums'][1]}"), folds)
    check('each fold says whether its summary was checked', folds[0].endswith('· checked') and folds[1].endswith('· checked') and folds[2].endswith('· its model would not check it') and folds[3].endswith('· not checked yet'), folds)
    check('the folds start closed — the sheet stays tidy', await pg.locator('.sheet.on .summary-stretch[open]').count() == 0)
    await pg.locator('.sheet.on .summary-stretch summary').first.click()
    opened = await pg.locator('.sheet.on .summary-stretch').first.inner_text()
    check('opened, a stretch shows its summary and what its check did', 'Stretch 1: Mara keeps the gate' in opened and '“accepts the ring” → “refuses the ring”' in opened, opened)
    await pg.locator('.sheet.on .summary-stretch summary').nth(2).click()
    third = await pg.locator('.sheet.on .summary-stretch').nth(2).inner_text()
    check('one its model would not check says so', 'Its model would not check it' in third, third)
    await pg.locator('.sheet.on .summary-stretch summary').nth(3).click()
    fourth = await pg.locator('.sheet.on .summary-stretch').nth(3).inner_text()
    check('one not checked yet says the helper checks it next', 'Not checked yet — the helper holds it against the chapter next.' in fourth, fourth)
    f = await fits(pg)
    check('the sheet fits a phone, nothing wider than the screen', f['over'] <= 1 and f['wide'] <= 1, f)
    await pg.screenshot(path=os.path.join(H.SHOTS, 'summary-sheet-phone.png'))
    await close_sheet(pg)

    # A chapter with no summary yet still has the item, and says why there is none.
    await open_summary(pg, 1)
    t = await sheet_text(pg)
    check('a chapter not summed up yet says so, and when it will be', 'Not summed up yet. The helper sums a chapter up once the writing has moved on from it' in t, t)
    await close_sheet(pg)

    # His own summary; then one from before the chapter changed.
    await pg.evaluate("""async x => { const s = await import('/js/store.js');
      s.change('chapter', x.first, c => { c.summary = { ...c.summary, by: 'you' }; }); }""", fx)
    await open_summary(pg, 0)
    t = await sheet_text(pg)
    check('his own summary is said to be his, never checked', 'Your own summary — the helper keeps your words and never changes them.' in t and 'Checked against' not in t.split('Its stretches')[0], t)
    await close_sheet(pg)
    await pg.evaluate("""async x => { const s = await import('/js/store.js');
      s.change('chapter', x.first, c => { const { by, ...rest } = c.summary; c.summary = rest; c.passages[0].versions[0].text += ' Changed.'; }); }""", fx)
    await open_summary(pg, 0)
    t = await sheet_text(pg)
    check('a summary from before the chapter changed is said to be waiting, never shown as what rides',
          'Waiting for the chapter’s latest changes' in t and 'Mara keeps the gate through the winter' not in t, t)
    folds = await pg.locator('.sheet.on .summary-stretch summary').all_inner_texts()
    check('the stretch whose words changed is not summed up yet; the others keep theirs', folds[0].endswith('· not summed up yet') and folds[1].endswith('· checked'), folds)
    await close_sheet(pg)

    # A long scene's stretches, from the scene's own menu.
    await H.panes_call(pg, 'showTurn', ['play', fx['play'], 'none'])
    await pg.wait_for_selector('.scenehead')
    await pg.get_by_role('button', name='More for this scene', exact=True).click()
    await pg.wait_for_selector('.menu-pop')
    labels = await pg.locator('.menu-pop button').all_inner_texts()
    check('the scene’s menu offers “The scene so far, in short”, with its hint', any(l.startswith('The scene so far, in short') and 'narrator' in l for l in labels), labels)
    await pg.locator('.menu-pop button').filter(has_text='The scene so far, in short').click()
    await pg.wait_for_selector('.sheet.on .summary-sheet')
    folds = await pg.locator('.sheet.on .summary-stretch summary').all_inner_texts()
    check('a long scene shows its stretches by their turns', len(folds) == fx['sceneStretches'] and folds[0].startswith('Turns 1–') and folds[0].endswith('· checked'), folds)
    await close_sheet(pg)
    await H.panes_call(pg, 'showTurn', ['play', fx['short'], 'none'])
    await pg.wait_for_function("document.querySelector('.scenehead b')?.textContent === 'You play Tom'")
    await pg.get_by_role('button', name='More for this scene', exact=True).click()
    await pg.locator('.menu-pop button').filter(has_text='The scene so far, in short').click()
    await pg.wait_for_selector('.sheet.on .summary-sheet')
    t = await sheet_text(pg)
    check('a short scene says it is read whole, and what happens once it grows', 'Not needed yet: the narrator reads this scene whole.' in t, t)
    await close_sheet(pg)
    check('no page errors', not [x for x in logs if x.startswith('PAGEERROR')], [x for x in logs if x.startswith('PAGEERROR')])
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=(os.environ.get('COZY_TEST_CHROMIUM') or None))
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('the walk ran to its end', False)
            await browser.close()
    passed = sum(1 for r in RESULTS if r[1])
    failed = len(RESULTS) - passed
    print(f'summaries: {passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
