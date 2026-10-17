"""Background saves keep review and shelf nodes still; changes still arrive.
Runs the real app with temporary books and no provider requests. Mutation counts
are structural checks, not timing thresholds tied to the test machine's speed.
"""
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
            await pg.evaluate("""async () => {
                const s = await import('/js/store.js'), shape = await import('/js/novel/shape.js');
                const u = await import('/js/util.js');
                const id = location.hash.split('/')[2], n = s.peek('novel', id), cid = n.order[0];
                const passage = shape.newPassage('you', 'The candle was was bright.');
                const v = passage.versions[0];
                s.change('chapter', cid, c => {
                    c.passages = [passage];
                    c.checks = {[passage.id]: {[v.id]: {sig: u.hashText(v.text), items: [{id:'fix', kind:'grammar', find:'was was', replace:'was', why:'A repeated word.'}], grade:{overall:10, of:10, faults:[]}}}};
                });
                window.fixture = {id, cid, pid:passage.id, vid:v.id};
                await s.flush();
            }""")
            await pg.click('#checkBubble')
            await pg.wait_for_selector('.sug .word-comparison')
            await pg.locator('.sug button:text-is("Apply")').focus()
            result = await pg.evaluate("""async () => {
                const s = await import('/js/store.js');
                const bubble = document.querySelector('#checkBubble'), body = document.querySelector('.sugsheet .body');
                const original = document.activeElement;
                let bubbleChanges = 0, sheetChanges = 0;
                const bo = new MutationObserver(rows => bubbleChanges += rows.length), so = new MutationObserver(rows => sheetChanges += rows.length);
                bo.observe(bubble,{childList:true}); so.observe(body,{childList:true});
                for (let i=0;i<20;i++) {
                    s.change('novel',fixture.id,n=>{n.memory.lit={at:i};});
                    s.change('chapter',fixture.cid,c=>{c.summary={text:'A changed helper summary '+i};});
                    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                }
                bo.disconnect();so.disconnect();
                return {bubbleChanges,sheetChanges,focus:document.activeElement===original,connected:original.isConnected};
            }""")
            check('20 notes and summary saves cause no checker indicator replacement', result['bubbleChanges'] == 0)
            check('20 notes and summary saves cause no review sheet replacement', result['sheetChanges'] == 0)
            check('background saves preserve the actual focused review button', result['focus'] and result['connected'])
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('chapter',fixture.cid,c=>{c.checks[fixture.pid][fixture.vid].items[0].replace='burned';});
            }""")
            await pg.wait_for_function("document.querySelector('.word-after ins')?.textContent==='burned'")
            check('a changed suggestion still refreshes in place of the old words', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), shape=await import('/js/novel/shape.js');
                s.change('chapter',fixture.cid,c=>{c.passages[0].versions.push(shape.newVersion({text:'The lantern shone.',how:'mine'}));c.passages[0].pick=1;});
            }""")
            await pg.wait_for_function("document.querySelectorAll('.sug').length===0")
            check('choosing a different passage version removes old suggestions', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('chapter',fixture.cid,c=>{c.passages[0].pick=0;});
            }""")
            await pg.wait_for_selector('.sug .word-comparison')
            check('choosing the checked version restores its suggestion', True)
            await pg.locator('.sug button:text-is("Leave it")').click()
            await pg.wait_for_function("document.querySelectorAll('.sug').length===0")
            check('Leave it still clears the suggestion without waiting for another save', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('chapter',fixture.cid,c=>{c.checks[fixture.pid][fixture.vid].items=[{id:'avoid',kind:'avoid',phrase:'bright',find:'bright',replace:null}];});
                s.change('house','house',h=>{h.instructions.avoid='bright';});
            }""")
            await pg.wait_for_selector('.sug[data-kind="avoid"]')
            check('adding a word to avoid updates the review', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('house','house',h=>{h.instructions.avoid='';});
            }""")
            await pg.wait_for_function("document.querySelectorAll('.sug').length===0")
            check('removing a word to avoid removes its obsolete suggestion', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), shape=await import('/js/novel/shape.js');
                const stream=shape.newPassage('ai','The road began.',{streaming:true,model:'streamed-writer',how:'write'});
                fixture.stream=stream.id;
                s.change('chapter',fixture.cid,c=>{c.passages.push(stream);});
                await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            }""")
            result = await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), body=document.querySelector('.sugsheet .body');
                let changes=0;
                const observer=new MutationObserver(rows=>changes+=rows.length);observer.observe(body,{childList:true});
                for(let i=0;i<20;i++) {
                    s.change('chapter',fixture.cid,c=>{const v=c.passages.find(p=>p.id===fixture.stream).versions[0];v.text+=' Another step.';v.thinking='Thinking '+i;});
                    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                }
                observer.disconnect();return changes;
            }""")
            check('20 streamed text and thinking checkpoints do not rebuild Suggestions', result == 0)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('chapter',fixture.cid,c=>{c.passages.find(p=>p.id===fixture.stream).versions[0].streaming=false;});
            }""")
            await pg.wait_for_function("document.querySelector('.judgebox')?.textContent.includes('streamed-writer')")
            check('a completed stream immediately joins the writer benchmark', True)
            # A temporary automatic rewrite failure has a retry state owned
            # by the automatic switches. All relay calls are intercepted here.
            await pg.route('**/api/call', lambda route: route.fulfill(status=503, content_type='application/json', body='{"error":"provider","status":503,"detail":"Temporarily unavailable."}'))
            result = await pg.evaluate("""async (provider) => {
                const s=await import('/js/store.js'), checker=await import('/js/novel/checker.js');
                s.change('house','house',h=>{
                    h.connections=[{id:'retry-test',name:'Local test',url:provider+'/v1',key:'test-only',model:'fake-writer',context:200000}];
                    h.roles={writer:'retry-test',helper:'off',checker:'retry-test'};
                    h.checksFrom=Date.now()+1000000;
                    h.autoLift={on:true,from:0};
                });
                s.change('chapter',fixture.cid,c=>{
                    const e=c.checks[fixture.pid][fixture.vid];
                    e.grade={overall:8,of:10,lift:'Show the candle burning clearly.',faults:[{check:'precision',words:'was was',why:'A repeated word.'}]};
                    e.items=[{id:'grade',kind:'grade',grade:e.grade,lift:e.grade.lift,replace:null}];
                });
                checker.forTests().autoAfter(fixture.id);
                const job=checker.forTests().lifting.get(fixture.id);
                return Boolean(job && (await job).passing);
            }""", f'http://127.0.0.1:{H.PROV}')
            check('a synthetic temporary automatic rewrite failure enters its retry wait', result)
            await pg.wait_for_function("document.querySelector('.sugstate')?.textContent.includes('automatic rewrite')")
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('house','house',h=>{h.autoLift={on:false};});
            }""")
            await pg.wait_for_function("!document.querySelector('.sugstate')?.textContent.includes('automatic rewrite') && ![...document.querySelectorAll('.sugsheet button')].some(b=>b.textContent==='Try again now')")
            check('turning automatic rewrite off immediately removes its retry state and action', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('house','house',h=>{h.autoFix={on:true,from:0};});
            }""")
            await pg.wait_for_function("document.querySelector('.sugstate')?.textContent.includes('automatic rewrite')")
            check('enabling automatic fixes immediately restores a pending automatic retry', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');
                s.change('house','house',h=>{h.autoFix={on:false};});
            }""")
            await pg.wait_for_function("!document.querySelector('.sugstate')?.textContent.includes('automatic rewrite')")
            check('turning automatic fixes off immediately clears its retry state', True)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), checker=await import('/js/novel/checker.js');
                s.change('house','house',h=>{h.connections=[];h.roles={};});
                for(const timer of checker.forTests().timers.values())clearTimeout(timer.t);
                checker.forTests().timers.clear();
            }""")
            await pg.keyboard.press('Escape')
            await pg.wait_for_selector('.sugsheet', state='detached')
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js');await s.flush();location.hash='#/';
            }""")
            await pg.wait_for_selector('#books .book:not(.new)')
            result = await pg.evaluate("""async () => {
                const shelf=await import('/js/ui/shelf.js'), books=document.querySelector('#books');
                const card=books.querySelector('.book:not(.new)'), button=card.querySelector('.cover');
                button.focus();let changes=0;
                const observer=new MutationObserver(rows=>changes+=rows.length);observer.observe(books,{childList:true});
                for(let i=0;i<10;i++)await shelf.refresh();
                await new Promise(r=>requestAnimationFrame(r));observer.disconnect();
                window.savedCover=button;
                return {changes,connected:card.isConnected,focus:document.activeElement===button};
            }""")
            check('10 identical shelf refreshes do not rebuild or animate the book list', result['changes'] == 0)
            check('shelf refresh preserves the actual cover and keyboard focus', result['connected'] and result['focus'])
            check('a book without a subtitle has no empty subtitle on its cover', await pg.locator('#books .book:not(.new) .s').count() == 0)
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), shelf=await import('/js/ui/shelf.js');
                s.change('novel',fixture.id,n=>{n.meta.subtitle='A story by candlelight';});
                await s.flush('novel',fixture.id);await shelf.refresh();
            }""")
            check('adding a subtitle keeps the same focused cover', await pg.evaluate("savedCover.querySelector('.s')?.textContent==='A story by candlelight' && document.activeElement===savedCover && savedCover===document.querySelector('#books .book:not(.new) .cover')"))
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), shelf=await import('/js/ui/shelf.js');
                s.change('novel',fixture.id,n=>{n.meta.subtitle='';});
                await s.flush('novel',fixture.id);await shelf.refresh();
            }""")
            check('removing a subtitle removes its element and keeps the focused cover', await pg.evaluate("!savedCover.querySelector('.s') && document.activeElement===savedCover && savedCover===document.querySelector('#books .book:not(.new) .cover')"))
            await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), shelf=await import('/js/ui/shelf.js');
                s.change('novel',fixture.id,n=>{n.meta.title='A steadier candle';n.meta.words=42;});
                await s.flush('novel',fixture.id);await shelf.refresh();
            }""")
            await pg.wait_for_function("document.querySelector('#books .t')?.textContent==='A steadier candle'")
            check('saved title and word count update on the same cover', await pg.evaluate("savedCover.isConnected && savedCover===document.querySelector('#books .book:not(.new) .cover') && document.querySelector('#books .meta').textContent.includes('42 words')"))
            await pg.fill('#search', 'missing title')
            await pg.wait_for_selector('.search-empty')
            await pg.click('.search-empty button')
            await pg.wait_for_selector('#books .book:not(.new)')
            check('search restores the existing cover and its current title', await pg.evaluate("savedCover.isConnected && savedCover.textContent.includes('A steadier candle')"))
            await pg.click('#shelfSettings')
            await H.settings_part(pg, 'Your instructions')
            await pg.locator('.modrow').first.click()
            await pg.wait_for_selector('.modsheet')
            result = await pg.evaluate("""async () => {
                const s=await import('/js/store.js'), button=document.querySelector('.modsheet .btnrow button');
                for(let i=0;i<10;i++) {
                    s.change('house','house',h=>{h.look={...(h.look||{}),size:18};});
                    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                }
                return button.isConnected && button===document.querySelector('.modsheet .btnrow button');
            }""")
            check('unrelated settings saves keep the module reset button mounted', result)
            check('performance checks make no provider requests', len(H.reqs()) == 0)
            check('no browser exceptions', not [x for x in logs if x.startswith('PAGEERROR')])
            await b.close()
    print(f'{passed} passed', flush=True)

asyncio.run(main())
