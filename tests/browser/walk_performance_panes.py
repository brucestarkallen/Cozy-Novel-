"""Long notebooks and conversations keep the DOM the reader is using.
Synthetic records, real store subscriptions, no model connection."""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', 21151))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', 21152))
from harness import Env, async_playwright, new_book, page, reqs, add_conn

RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f' [saw: {str(saw)[:500]}]'), flush=True)


async def settle(pg):
    await pg.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')


async def fixture(pg):
    return await pg.evaluate("""async () => {
      const s=await import('/js/store.js'), sh=await import('/js/novel/shape.js');
      const talk=await import('/js/novel/talk.js'), tl=await import('/js/novel/timeline.js');
      const nid=location.hash.split('/')[2], cid=s.peek('novel',nid).order[0];
      const notes={people:Array.from({length:80},(_,i)=>({id:'person-'+i,name:'Keeper '+i,about:'A careful keeper. '.repeat(30),ties:'A wary friendship.',aka:[]})),threads:[],places:[],lore:[]};
      s.change('novel',nid,n=>{n.notes=notes;});
      const passages=Array.from({length:85},(_,i)=>{
        const p=sh.newPassage('you',`Keeper 0 opened letter ${i+1}.\n\n`+'The harbor lay quiet beneath the moon. '.repeat(40));
        p.versions[0].continuity=tl.continuityOf([{kind:'character',cards:[{kind:'people',name:'Keeper 0'}],text:`The keeper opens letter ${i+1}.`,why:'A fresh clue.',evidence:[`Keeper 0 opened letter ${i+1}.`],stance:'fact'}],notes,{text:p.versions[0].text});
        return p;
      });
      s.change('chapter',cid,c=>{c.passages=passages;});
      await talk.ensureTalk(nid);
      const turns=Array.from({length:120},(_,i)=>sh.newPassage(i%2?'ai':'you',`Turn ${i+1}. `+'The lantern shines across the quiet water. '.repeat(30)));
      s.change('talk',nid,t=>{t.turns=turns;});
      const play={id:'performance-scene',novelId:nid,chapterId:cid,who:'Keeper 0',from:'The harbor.',after:'^',turns:JSON.parse(JSON.stringify(turns)),turned:null};
      await s.create('play',play.id,play);
      s.change('novel',nid,n=>{n.plays=[play.id];});
      await s.flush();
      return {nid,cid,playId:play.id};
    }""")


async def scenario(browser):
    logs=[]
    pg=await page(browser,logs,w=1440,hgt=1000,mobile=False)
    try:
        await new_book(pg,'Steady pages')
        ids=await fixture(pg)
        await pg.click('#notesBtn')
        await pg.wait_for_selector('.notecard')
        await pg.locator('.notecard').first.focus()
        await pg.evaluate("""() => {window.keptCard=document.querySelector('.notecard');window.paneRemoved=0;window.paneObserver=new MutationObserver(rows=>{for(const row of rows) window.paneRemoved+=row.removedNodes.length;});window.paneObserver.observe(document.querySelector('#sideBody'),{childList:true,subtree:true});}""")
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');for(let i=0;i<4;i++) {s.change('novel',ids.nid,n=>{n.prefs.length=i%2?'short':'scene';});await s.flush();await new Promise(r=>requestAnimationFrame(r));}}""",ids)
        await settle(pg)
        status=await pg.evaluate('({connected:keptCard.isConnected,focused:document.activeElement===keptCard,removed:paneRemoved})')
        print('  measure notes unrelated saves:',status,flush=True)
        check('unrelated book saves retain notebook cards and keyboard focus',status['connected'] and status['focused'],status)
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('novel',ids.nid,n=>{n.notes.people[79].about='A new fact.';});await s.flush();}""",ids)
        await settle(pg)
        check('changing one note retains the other cards',await pg.evaluate("keptCard.isConnected && document.querySelectorAll('.notecard')[79].textContent.includes('A new fact.')"))
        await pg.set_viewport_size({'width':360,'height':800})
        await pg.get_by_role('button',name='Edit Keeper 76',exact=True).focus()
        await settle(pg)
        check('a distant card becomes readable when reached with keyboard focus',await pg.evaluate("""() => {const card=document.activeElement,body=document.querySelector('#sideBody'),r=card.getBoundingClientRect(),b=body.getBoundingClientRect();return card.dataset.id==='person-76'&&body.scrollTop>1000&&r.top<b.bottom&&r.bottom>b.top&&card.querySelector('.ab').getBoundingClientRect().height>0;}"""))
        await pg.evaluate("""() => {window.anchorCard=document.activeElement;window.anchorTop=anchorCard.getBoundingClientRect().top;const range=document.createRange();range.setStart(anchorCard.querySelector('.ab').firstChild,0);range.setEnd(anchorCard.querySelector('.ab').firstChild,8);getSelection().removeAllRanges();getSelection().addRange(range);}""")
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('novel',ids.nid,n=>{n.notes.people[0].about='A longer earlier card. '.repeat(100);});await s.flush();}""",ids)
        await settle(pg)
        check('an earlier card changing preserves the distant reading anchor and selected words',await pg.evaluate("anchorCard.isConnected&&Math.abs(anchorCard.getBoundingClientRect().top-anchorTop)<2&&getSelection().toString()==='A carefu'"))
        await pg.keyboard.press('Tab')
        check('keyboard navigation can reach the next offscreen card',await pg.evaluate("document.activeElement.dataset.id==='person-77'"))
        await pg.keyboard.press('Enter')
        check('a distant card still opens its full editor',await pg.get_by_label('Name',exact=True).input_value()=='Keeper 77')
        await pg.keyboard.press('Escape')
        await pg.set_viewport_size({'width':1440,'height':1000})
        await pg.locator('[data-notes-view="timeline"]').click()
        await pg.get_by_role('button',name='Whole book',exact=True).click()
        await pg.wait_for_function("document.querySelectorAll('.timeline-event').length===40")
        await pg.evaluate("window.keptEvent=document.querySelector('.timeline-event');window.keptEvent.querySelector('.timeline-source').focus()")
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('chapter',ids.cid,c=>{c.passages[30].versions[0].continuity.events[0].why='A clearer clue.';});await s.flush();}""",ids)
        await settle(pg)
        check('one new timeline detail leaves other source rows and focus in place',await pg.evaluate("keptEvent.isConnected && keptEvent.contains(document.activeElement) && document.querySelector('.timeline-results').textContent.includes('A clearer clue.')"))
        await pg.get_by_role('button',name='Show next 40',exact=True).click()
        check('showing more timeline history appends without replacing earlier rows',await pg.evaluate("keptEvent.isConnected && document.querySelectorAll('.timeline-event').length===80"))
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('chapter',ids.cid,c=>{c.name='The lantern returns';});await s.flush();}""",ids)
        await pg.wait_for_function("document.querySelector('.timeline-chapter')?.textContent.includes('The lantern returns')")
        check('a renamed chapter updates its timeline heading', 'The lantern returns' in await pg.locator('.timeline-chapter').first.text_content())
        await pg.click('#sideTabs [data-tab="partner"]')
        await pg.wait_for_function("document.querySelectorAll('#sideBody .turn').length===120")
        await pg.get_by_label('Ask your partner',exact=True).fill('A sentence still being composed.')
        await pg.evaluate("""() => {window.keptTurn=document.querySelector('.turn');window.keptComposer=document.querySelector('#sideFoot textarea');keptComposer.focus();keptComposer.setSelectionRange(3,11);window.paneRemoved=0;}""")
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');s.change('talk',ids.nid,t=>{t.turns.push(sh.newPassage('you','One more question.'));});await s.flush();}""",ids)
        await pg.wait_for_function("document.querySelectorAll('#sideBody .turn').length===121")
        status=await pg.evaluate("({turn:keptTurn.isConnected,composer:keptComposer.isConnected,focused:document.activeElement===keptComposer,selection:[keptComposer.selectionStart,keptComposer.selectionEnd],removed:paneRemoved})")
        print('  measure partner append:',status,flush=True)
        check('a new partner turn retains old messages and the composing box',status['turn'] and status['composer'] and status['focused'] and status['selection']==[3,11],status)
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('talk',ids.nid,t=>{t.turns[80].versions[0].text='Changed answer eighty-one.';});await s.flush();}""",ids)
        await settle(pg)
        check('a changed answer updates without repainting untouched conversation',await pg.evaluate("keptTurn.isConnected && document.querySelector('#sideBody .talk').textContent.includes('Changed answer eighty-one.')"))
        await pg.click('#sideTabs [data-tab="notes"]')
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('talk',ids.nid,t=>{t.turns[81].versions[0].text='A thought that arrived while reading notes.';});await s.flush();}""",ids)
        await pg.click('#sideTabs [data-tab="partner"]')
        await pg.wait_for_function("document.querySelector('#sideBody .talk')?.textContent.includes('A thought that arrived while reading notes.')")
        check('switching back reuses prior messages and includes changes made while away',await pg.evaluate("keptTurn.isConnected && keptComposer.isConnected && keptComposer.value==='A sentence still being composed.'"))
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');const pid=s.peek('chapter',ids.cid).passages[0].id;s.change('talk',ids.nid,t=>{t.turns[83].versions[0].changes=[{id:'waiting-check',op:{passage:'1.1',text:'Proposed words.'},status:'waiting',label:'Passage one',where:{chapterId:ids.cid,passageId:pid}}];});await s.flush();}""",ids)
        await pg.wait_for_selector('.change.waiting button.go')
        await pg.click('#sideTabs [data-tab="notes"]')
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('chapter',ids.cid,c=>{c.passages.shift();});await s.flush();}""",ids)
        await pg.click('#sideTabs [data-tab="partner"]')
        await pg.wait_for_function("document.querySelector('.change.waiting')?.textContent.includes('can’t be made now')")
        check('cached pending changes refresh availability against the current manuscript',await pg.locator('.change.waiting button.go').count()==0 and await pg.evaluate('keptTurn.isConnected'))
        await pg.evaluate("""async ids=>{const panes=await import('/js/ui/panes.js');panes.showTurn('play',ids.playId,'');}""",ids)
        await pg.wait_for_function("document.querySelectorAll('#sideBody .turn').length===120 && document.querySelector('.scenehead')")
        await pg.evaluate("""() => {window.keptSceneTurn=document.querySelector('.turn');window.keptSceneComposer=document.querySelector('#sideFoot textarea');keptSceneComposer.value='My next move.';keptSceneComposer.dispatchEvent(new Event('input'));keptSceneComposer.focus();keptSceneComposer.setSelectionRange(2,6);window.paneRemoved=0;}""")
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');s.change('play',ids.playId,p=>{p.turns.push(sh.newPassage('you','One more step.'));});await s.flush();}""",ids)
        await pg.wait_for_function("document.querySelectorAll('#sideBody .turn').length===121")
        status=await pg.evaluate("({turn:keptSceneTurn.isConnected,composer:keptSceneComposer.isConnected,focused:document.activeElement===keptSceneComposer,selection:[keptSceneComposer.selectionStart,keptSceneComposer.selectionEnd],removed:paneRemoved})")
        print('  measure scene append:',status,flush=True)
        check('a new scene turn retains old messages and the composing box',status['turn'] and status['composer'] and status['focused'] and status['selection']==[2,6],status)
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('play',ids.playId,p=>{p.who='The lighthouse keeper';});await s.flush();}""",ids)
        await settle(pg)
        check('a renamed character updates the retained scene composer',await pg.evaluate("keptSceneComposer.isConnected && keptSceneComposer.getAttribute('aria-label')==='What The lighthouse keeper says or does' && keptSceneComposer.value==='My next move.'"))
        await pg.set_viewport_size({'width':360,'height':800})
        check('folding preserves the scene composer and selection',await pg.evaluate("keptSceneComposer.isConnected && document.activeElement===keptSceneComposer && keptSceneComposer.selectionStart===2"))
        await pg.keyboard.press('Escape')
        check('Back closes the narrow scene drawer',not await pg.locator('#sidePane').evaluate("el=>el.classList.contains('open')"))
        await pg.evaluate("""async ids=>{const s=await import('/js/store.js');s.change('play',ids.playId,p=>{p.turns[80].versions[0].text='The quiet scene changed while closed.';});await s.flush();}""",ids)
        await settle(pg)
        check('a closed pane defers painting background changes',await pg.evaluate("!document.querySelector('#sideBody .talk').textContent.includes('The quiet scene changed while closed.')"))
        await pg.evaluate("""async ()=>{const panes=await import('/js/ui/panes.js');panes.showSide('play');}""")
        await pg.wait_for_function("document.querySelector('#sideBody .talk')?.textContent.includes('The quiet scene changed while closed.')")
        check('reopening paints deferred scene changes without rebuilding earlier turns',await pg.evaluate('keptSceneTurn.isConnected && keptSceneComposer.isConnected'))
        check('performance paths make no model calls',reqs()==[])
        check('performance paths have no page exceptions',not [x for x in logs if x.startswith('PAGEERROR')],logs)
    finally:
        await pg.context.close()


async def scenario_live_isolation(browser):
    logs=[]
    pg=await page(browser,logs,w=1440,hgt=1000,mobile=False)
    try:
        await new_book(pg,'The source conversation')
        await add_conn(pg)
        ids=await pg.evaluate("""async()=>{
          const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js'),talk=await import('/js/novel/talk.js');
          const nid=location.hash.split('/')[2],cid=s.peek('novel',nid).order[0];
          await talk.ensureTalk(nid);
          const turns=[sh.newPassage('you','SLOW: Talk about the lantern.'),sh.newPassage('ai','The answer kept in this copied book.')];
          s.change('talk',nid,t=>{t.turns=turns;});
          const branch=sh.newNovel({title:'The independent conversation'});
          await s.create('chapter',branch.chapter.id,branch.chapter);await s.create('novel',branch.novel.id,branch.novel);
          const copied=structuredClone(s.peek('talk',nid));copied.id=branch.novel.id;copied.novelId=branch.novel.id;
          await s.create('talk',copied.id,copied);await s.flush();
          window.sourceLiveCount=0;
          window.offSourceLive=talk.onTalkLive(ev=>{if(ev.kind==='talk'&&ev.id===nid&&ev.text)sourceLiveCount++;});
          window.sourceReply=talk.partnerAgain({novelId:nid,chapterId:cid,turnId:turns[1].id});
          return {nid,cid,branchId:branch.novel.id,branchChapter:branch.chapter.id};
        }""")
        await pg.wait_for_function('window.sourceLiveCount>0')
        await pg.evaluate("""ids=>{location.hash='#/n/'+ids.branchId+'/'+ids.branchChapter;}""",ids)
        await pg.wait_for_function("document.title==='The independent conversation — Cozy Novel'")
        await pg.click('#partnerBtn')
        await pg.wait_for_selector('#sideBody .turn.ai .words')
        check('a background source reply never paints into a branch with copied turn IDs',await pg.locator('#sideBody .turn.ai .words').text_content()=='The answer kept in this copied book.')
        await pg.evaluate("window.branchTurn=document.querySelector('#sideBody .turn.ai');window.branchComposer=document.querySelector('#sideFoot textarea');branchComposer.focus();")
        await pg.evaluate("""async ids=>{const talk=await import('/js/novel/talk.js');talk.stopTalk('talk',ids.nid);await window.sourceReply;window.offSourceLive();}""",ids)
        await settle(pg)
        check('a source reply finishing leaves the branch conversation and focus alone',await pg.evaluate("branchTurn.isConnected&&branchComposer.isConnected&&document.activeElement===branchComposer&&branchTurn.querySelector('.words').textContent==='The answer kept in this copied book.'"))
        check('branch streaming paths have no page exceptions',not [x for x in logs if x.startswith('PAGEERROR')],logs)
    finally:
        await pg.context.close()


async def main():
    with Env():
        async with async_playwright() as p:
            browser=await p.chromium.launch(executable_path=os.environ.get('COZY_TEST_CHROMIUM','/usr/bin/chromium'))
            try:
                await scenario(browser)
                await scenario_live_isolation(browser)
            except Exception:
                traceback.print_exc()
                check('the performance walk completes',False,traceback.format_exc()[-600:])
            finally:
                await browser.close()
    print(f'\nbrowser (pane performance): {sum(RESULTS)} passed, {len(RESULTS)-sum(RESULTS)} failed')
    sys.exit(not all(RESULTS))


if __name__=='__main__':
    asyncio.run(main())
