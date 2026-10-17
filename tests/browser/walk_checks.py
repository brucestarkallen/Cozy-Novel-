"""The review sheet stays useful while its suggestions change; stand-in calls only."""
import asyncio
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
            check('no browser exceptions', not [x for x in logs if x.startswith('PAGEERROR')])
            await b.close()
    print(f'{passed} passed', flush=True)

asyncio.run(main())
