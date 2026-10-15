"""Unsent partner and scene words stay with their conversation on reload.

Actual browser/store/server; only synthetic books and the local stand-in model.
"""
import asyncio
import os
import sys
import traceback

import harness as H
from playwright.async_api import async_playwright
H.PORT = int(os.environ.get('COZY_TEST_PORT', '22881'))
H.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', '22899'))
RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append((name, bool(ok)))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f'   [saw: {str(saw)[:350]}]'), flush=True)


async def flush(pg):
    await pg.evaluate("import('/js/store.js').then(s=>s.flush())")


async def partner(pg):
    await pg.evaluate("import('/js/ui/panes.js').then(p=>p.showSide('partner'))")
    await pg.get_by_role('textbox', name='Ask your partner', exact=True).wait_for()


async def scene(pg, pid):
    await pg.evaluate("async id=>(await import('/js/ui/panes.js')).showTurn('play',id,'none')", pid)
    await pg.locator('#sideFoot textarea').first.wait_for()


async def reload(pg):
    await flush(pg)
    await pg.reload()
    await pg.wait_for_function('document.title.includes("Drafts by the Fire")')


async def reply_finished(pg, count):
    # Poll the same page context as the application and assert real saved
    # output, rather than treating an idle flag as a successful answer.
    for _ in range(300):
        result = await pg.evaluate("""async()=>{
          const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');
          const t=s.peek('talk',location.hash.split('/')[2]);
          const replies=(t?.turns||[]).filter(x=>x.by==='ai');
          const v=sh.picked(replies[replies.length-1])||{};
          return {count:replies.length,text:v.text||'',streaming:Boolean(v.streaming)};
        }""")
        if result['count'] >= count and result['text'].strip() and not result['streaming']:
            return result
        await pg.wait_for_timeout(50)
    raise AssertionError(f"No completed partner reply: {result}; notice: {await pg.locator('#toast').inner_text()}")


async def scenario_drafts(browser):
    logs=[]
    pg=await H.page(browser,logs)
    await H.new_book(pg,'Drafts by the Fire')
    await partner(pg)
    ask=pg.get_by_role('textbox',name='Ask your partner',exact=True)
    first='  A question for the first conversation.\nKeep every space.  '
    await ask.fill(first)
    await pg.evaluate("import('/js/ui/panes.js').then(p=>p.showSide('notes'))")
    await partner(pg)
    check('Partner keeps exact words while visiting Notes',await ask.input_value()==first)
    await reload(pg)
    await partner(pg)
    check('Partner restores exact words after reload',await ask.input_value()==first)
    conv=await pg.evaluate("""async()=>{
      const t=await import('/js/novel/talk.js'),s=await import('/js/store.js');
      const id=location.hash.split('/')[2]; await t.renameConversation(id,'First conversation');
      const old=s.peek('talk',id).convId; await t.newConversation(id); return old;
    }""")
    await pg.wait_for_function('document.querySelector(".convname")?.textContent !== "First conversation"')
    check('a new conversation starts with its own empty draft',await ask.input_value()=='')
    second='A different thought for the second conversation.'
    await ask.fill(second)
    await pg.evaluate("async cv=>{const t=await import('/js/novel/talk.js');const id=location.hash.split('/')[2];await t.renameConversation(id,'Second conversation');await t.openConversation(id,cv);}",conv)
    await pg.wait_for_function('document.querySelector(".convname")?.textContent === "First conversation"')
    check('opening the first conversation restores only its own words',await ask.input_value()==first)
    await reload(pg)
    await partner(pg)
    check('the first conversation keeps its words after reopening the book',await ask.input_value()==first)
    await pg.locator('.convpick').click()
    await pg.locator('.menu-pop button').filter(has_text='Second conversation').click()
    await pg.wait_for_function('document.querySelector(".convname")?.textContent === "Second conversation"')
    check('the second conversation also keeps its separate words after reload',await ask.input_value()==second)
    ids=await pg.evaluate("""async()=>{
      const t=await import('/js/novel/talk.js'),s=await import('/js/store.js');
      const novelId=location.hash.split('/')[2],chapterId=s.peek('novel',novelId).order[0];
      const a=await t.newPlay({novelId,chapterId,who:'Elara',from:'The warm teahouse'});
      const b=await t.newPlay({novelId,chapterId,who:'Rowan',from:'The rain outside'});return[a,b];
    }""")
    await scene(pg,ids[0])
    move=pg.get_by_role('textbox',name='What Elara says or does',exact=True)
    tell=pg.get_by_role('textbox',name='Tell the narrator',exact=True)
    move_text='  I slide the warm cup across the table.\n“Stay awhile.”  '
    tell_text='  Let the answer be shy and funny.\nKeep it gentle.  '
    await move.fill(move_text)
    await pg.get_by_role('button',name='Tell the narrator',exact=True).click()
    await tell.fill(tell_text)
    await scene(pg,ids[1])
    rowan=pg.get_by_role('textbox',name='What Rowan says or does',exact=True)
    check('another scene starts with its own empty move and hidden narrator note',await rowan.input_value()=='' and not await tell.is_visible())
    await rowan.fill('I shake the rain from my coat.')
    await scene(pg,ids[0])
    check('returning to a scene restores its move and narrator note exactly',await move.input_value()==move_text and await tell.input_value()==tell_text and await tell.is_visible())
    await pg.get_by_role('button',name='Tell the narrator',exact=True).click()
    await reload(pg)
    await scene(pg,ids[0])
    check('reload preserves a scene move and keeps its narrator note folded',await move.input_value()==move_text and not await tell.is_visible())
    await pg.get_by_role('button',name='Tell the narrator',exact=True).click()
    check('a folded narrator note keeps every word after reload',await tell.input_value()==tell_text)
    await scene(pg,ids[1])
    check('the other scene keeps its own move after reload',await rowan.input_value()=='I shake the rain from my coat.')
    check('draft navigation makes no model calls',not H.reqs())

    # A first failed send restores the original exact draft, even while the
    # user has moved to another scene and started a different sentence.
    await pg.evaluate("""async port=>{
      const s=await import('/js/store.js');
      s.change('house','house',h=>{h.connections=[{id:'local',name:'Local test',url:`http://127.0.0.1:${port}/v1`,model:'fake-writer',key:'test-key'}];h.roles={writer:'local',partner:'local',helper:'off',checker:'off'};},{now:true});
    }""",H.PROV)
    await scene(pg,ids[0])
    failed='  SLOWFAIL I offer him the cup.  '
    await move.fill(failed)
    await pg.locator('#sideFoot').get_by_role('button',name='Send',exact=True).click()
    await scene(pg,ids[1])
    await rowan.fill('A newer sentence while Elara waits.')
    await pg.wait_for_function("async id=>!(await import('/js/novel/talk.js')).talkBusy('play',id)",arg=ids[0])
    await pg.wait_for_function("document.querySelector('#toast')?.textContent.includes('did not answer')")
    check('a failed scene elsewhere leaves this scene’s newer words alone',await rowan.input_value()=='A newer sentence while Elara waits.')
    await scene(pg,ids[0])
    check('a failed scene restores its exact move and narrator note to its own boxes',await move.input_value()==failed and await tell.input_value()==tell_text, [await move.input_value(),await tell.input_value()])
    await reload(pg)
    await scene(pg,ids[0])
    check('the recovered failed scene draft survives reload',await move.input_value()==failed and await tell.input_value()==tell_text)

    # Hold a successful partner response. Its sent text remains recoverable
    # while waiting; typing something newer must survive its completion.
    await partner(pg)
    await ask.fill('A question sent while the rain settles.')
    gate,started=asyncio.Event(),asyncio.Event()
    async def held(route):
        started.set()
        await gate.wait()
        await route.continue_()
    await pg.route('**/api/call',held)
    await pg.locator('#sideFoot').get_by_role('button',name='Send',exact=True).click()
    await asyncio.wait_for(started.wait(),timeout=10)
    saved=await pg.evaluate("""async()=>{
      const s=await import('/js/store.js');await s.flush();
      return s.peek('draft',location.hash.split('/')[2]).composers[document.querySelector('#sideFoot').dataset.for].value;
    }""")
    check('the sent partner draft stays saved until the answer settles',saved=='A question sent while the rain settles.')
    newer='  A new thought typed while the answer travels.  '
    await ask.fill(newer)
    gate.set()
    result=await reply_finished(pg,1)
    check('the delayed partner request actually succeeds with a saved reply',bool(result['text']))
    check('a successful response does not clear a newer partner draft',await ask.input_value()==newer)
    await reload(pg)
    await partner(pg)
    check('the newer partner draft survives reload after the response',await ask.input_value()==newer, await ask.input_value())
    await pg.unroute('**/api/call',held)
    async with pg.expect_response('**/api/call'):
        await pg.locator('#sideFoot').get_by_role('button',name='Send',exact=True).click()
    await reply_finished(pg,2)
    await pg.wait_for_function("document.querySelector('#sideFoot textarea')?.value===''")
    await reload(pg)
    await partner(pg)
    check('an acknowledged send clears just the sent draft across reload',await ask.input_value()=='',await ask.input_value())
    await ask.fill('An unsent thought that must stay.')
    await pg.locator('#sidePane button').filter(has_text='Edit and ask again').first.click()
    await pg.wait_for_function("document.querySelector('#sideFoot textarea')?.value.includes('A question sent while the rain settles.')")
    merged=await ask.input_value()
    check('Edit and ask again keeps the existing draft beside the returned question','An unsent thought that must stay.' in merged and 'A question sent while the rain settles.' in merged,merged)
    await flush(pg)
    await pg.locator('#toast .toastact').click()
    await pg.wait_for_function("document.querySelector('#sideFoot textarea')?.value==='An unsent thought that must stay.'")
    check('Undo of Edit and ask again restores the earlier draft exactly',await ask.input_value()=='An unsent thought that must stay.')
    await flush(pg)
    nid=(await pg.evaluate('location.hash')).split('/')[2]
    reached,release=asyncio.Event(),asyncio.Event()
    held_save=False
    async def gate_edit(route):
        nonlocal held_save
        if route.request.method=='PUT' and not held_save:
            held_save=True
            reached.set()
            await release.wait()
        await route.continue_()
    await pg.route(f'**/api/store/talk/{nid}',gate_edit)
    await pg.locator('#sidePane button').filter(has_text='Edit and ask again').first.click()
    await asyncio.wait_for(reached.wait(),timeout=5)
    await ask.fill('New words while the edit is being saved.')
    release.set()
    await pg.wait_for_function("document.querySelector('#sideFoot textarea')?.value.includes('A question sent while the rain settles.')")
    check('Edit preserves words typed while its save is on the way','New words while the edit is being saved.' in await ask.input_value())
    await pg.locator('#toast .toastact').click()
    await pg.wait_for_function("document.querySelector('#sideFoot textarea')?.value==='New words while the edit is being saved.'")
    check('Undo preserves the newer words typed during the delayed edit',await ask.input_value()=='New words while the edit is being saved.')
    await pg.unroute(f'**/api/store/talk/{nid}',gate_edit)
    await flush(pg)
    remote=await (await pg.request.get(f'http://127.0.0.1:{H.PORT}/api/store/draft/{nid}')).json()
    key=await pg.locator('#sideFoot').get_attribute('data-for')
    remote['data']['composers'][key]['value']='Newer words from another window.'
    response=await pg.request.put(f'http://127.0.0.1:{H.PORT}/api/store/draft/{nid}',headers={'X-Base':str(remote['rev']),'X-Client':'draft-other-window'},data={'data':remote['data']})
    check('another window can save the newer draft',response.status==200)
    await pg.evaluate("async id=>(await import('/js/store.js')).open('draft',id,{fresh:true})",nid)
    await pg.locator('#sideTabs [data-tab="notes"]').click()
    await pg.locator('#sideTabs [data-tab="partner"]').click()
    await pg.wait_for_function("document.querySelector('#sideFoot textarea')?.value==='Newer words from another window.'")
    check('reopening a clean draft follows the newer words saved in another window',await ask.input_value()=='Newer words from another window.')
    check('all composer draft paths produce no browser exceptions',not [x for x in logs if x.startswith('PAGEERROR')],logs)
    await pg.context.close()


async def main():
    with H.Env():
        async with async_playwright() as pw:
            options={'executable_path':os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser=await pw.chromium.launch(**options)
            try: await scenario_drafts(browser)
            except Exception:
                traceback.print_exc();check('composer draft scenario ran to the end',False,traceback.format_exc()[-600:])
            await browser.close()
    bad=[r for r in RESULTS if not r[1]]
    print(f'\ncomposer drafts: {len(RESULTS)-len(bad)} passed, {len(bad)} failed')
    sys.exit(1 if bad else 0)
if __name__=='__main__':asyncio.run(main())
