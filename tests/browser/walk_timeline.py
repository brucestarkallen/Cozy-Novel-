"""The notebook timeline against real records, selected versions and routing.
No model connection; supported turns are kept through the real parser."""
import asyncio
import os
import sys
import traceback

import harness
harness.PORT = int(os.environ.get('COZY_TEST_PORT', 20981))
harness.PROV = int(os.environ.get('COZY_TEST_PROVIDER_PORT', 20999))
from harness import Env, async_playwright, new_book, page, reqs

RESULTS = []


def check(name, ok, saw=''):
    RESULTS.append(bool(ok))
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else f' [saw: {str(saw)[:500]}]'), flush=True)


async def fixture(pg):
    return await pg.evaluate("""async () => {
      const s = await import('/js/store.js');
      const sh = await import('/js/novel/shape.js');
      const {continuityOf} = await import('/js/novel/timeline.js');
      const nid = location.hash.split('/')[2], n = s.peek('novel', nid), cid = n.order[0];
      const notes = {people: [
        {id:'mara',name:'Mara',about:'A lighthouse keeper.',ties:'Wary of Tom.',aka:[]},
        {id:'tom',name:'Tom',about:'A boatwright.',ties:'Keeps his distance from Mara.',aka:[]}
      ], threads:[{id:'letter',name:'The missing letter',about:'Who took it?',open:true,aka:[]}],places:[],lore:[]};
      const person = name => ({kind:'people',name});
      const event = (kind, cards, text, why, quote, stance='fact', whose=null) => ({kind,cards,text,why,evidence:[quote],stance,...(whose?{whose}: {})});
      const p1 = sh.newPassage('you', 'Mara handed Tom the key. "Take it," she said. "Bring it back by dawn."');
      const p2 = sh.newPassage('you', 'Tom believed Mara had hidden the missing letter. He left without asking her.');
      p1.versions[0].continuity = continuityOf([event('relationship',[person('Mara'),person('Tom')], 'Mara entrusts Tom with the lighthouse key.', 'For the first time, she lets him enter alone.', 'Mara handed Tom the key.')],notes,{text:p1.versions[0].text});
      p2.versions[0].continuity = continuityOf([event('relationship',[person('Tom'),person('Mara')], 'Tom suspects Mara of concealing the letter.', 'His belief makes him withdraw before asking her.', 'Tom believed Mara had hidden the missing letter.','belief',person('Tom'))],notes,{text:p2.versions[0].text});
      const alt = sh.newVersion({text:'Tom asked Mara about the letter. She opened the empty drawer for him.',how:'mine'});
      alt.continuity = continuityOf([event('relationship',[person('Tom'),person('Mara')], 'Tom asks Mara directly about the letter.', 'He gives her a chance to answer his suspicion.', 'Tom asked Mara about the letter.')],notes,{text:alt.text});
      p2.versions.push(alt);
      const c2 = sh.newChapter(nid); c2.name = 'The crossing';
      const p3 = sh.newPassage('you', 'Mara intended to cross the bay alone. She packed her lantern.');
      p3.versions[0].continuity = continuityOf([event('character',[person('Mara')], 'Mara plans to cross the bay alone.', 'She chooses to search beyond the lighthouse.', 'Mara intended to cross the bay alone.','intention',person('Mara'))],notes,{text:p3.versions[0].text});
      const p4 = sh.newPassage('you', 'The missing letter lay beneath the loose floorboard. Tom lifted it into the light.');
      p4.versions[0].continuity = continuityOf([event('thread',[{kind:'threads',name:'The missing letter'},person('Tom')], 'Tom finds the missing letter beneath the floor.', 'The search for its hiding place is over.', 'The missing letter lay beneath the loose floorboard.')],notes,{text:p4.versions[0].text});
      const legacy = sh.newPassage('you','The tide turned before evening. Nobody spoke.');
      c2.passages = [p3,p4,legacy];
      await s.create('chapter',c2.id,c2);
      s.change('chapter',cid,c => {c.name='The key';c.passages=[p1,p2];});
      s.change('novel',nid,n => {n.notes=notes;n.order=[cid,c2.id];});
      await s.flush();
      return {nid,cid,c2:c2.id,p1:p1.id,p2:p2.id,p3:p3.id,p4:p4.id};
    }""")


async def open_timeline(pg):
    if not await pg.locator('#sidePane').evaluate("el => el.classList.contains('dock') || el.classList.contains('open')"):
        await pg.click('#notesBtn')
    await pg.locator('#sideTabs button[data-tab="notes"]').click()
    await pg.locator('[data-notes-view="timeline"]').click()
    await pg.wait_for_selector('.timeline')


async def scenario(browser):
    logs = []
    pg = await page(browser, logs, w=1440, hgt=1000, mobile=False)
    try:
        await new_book(pg, 'The key and the letter')
        ids = await fixture(pg)
        await pg.wait_for_selector('#passages > .passage')
        await open_timeline(pg)
        await pg.get_by_label('Timeline through', exact=True).select_option(ids['p1'])
        await pg.wait_for_function("document.querySelectorAll('.timeline-event').length === 1")
        check('Up to here admits only the selected passage', await pg.locator('.timeline-event').count() == 1 and 'entrusts' in await pg.inner_text('.timeline-turn'))
        await pg.get_by_label('Timeline through', exact=True).select_option('^')
        check('before chapter one shows no later turns', await pg.locator('.timeline-event').count() == 0)
        await pg.get_by_role('button',name='Whole book',exact=True).click()
        await pg.wait_for_function("document.querySelectorAll('.timeline-event').length === 4")
        texts = await pg.locator('.timeline-turn').all_text_contents()
        check('turns follow chapter and passage order', ['entrusts' in texts[0], 'suspects' in texts[1], 'plans' in texts[2], 'finds' in texts[3]] == [True]*4, texts)
        check('exact quotes and the reason are visible', await pg.locator('.timeline-evidence').first.text_content() == 'Mara handed Tom the key.' and 'For the first time' in await pg.locator('.timeline-why').first.inner_text())
        check('belief and intention identify whose they are', await pg.locator('.timeline-stance').all_text_contents() == ['Tom · belief','Mara · intention'])
        check('legacy passages remain an honest gap', '4 of 5 passages' in await pg.inner_text('.timeline-coverage') and '1 passage has no complete' in await pg.inner_text('.timeline-gaps'))
        await pg.get_by_label('Kind of turning point',exact=True).select_option('character')
        check('People filters to a character’s change', await pg.locator('.timeline-event').count() == 1 and 'plans' in await pg.inner_text('.timeline-turn'))
        await pg.get_by_label('Kind of turning point',exact=True).select_option('thread')
        check('Threads filters to the story question', await pg.locator('.timeline-event').count() == 1 and 'finds' in await pg.inner_text('.timeline-turn'))
        await pg.get_by_label('Kind of turning point',exact=True).select_option('')
        await pg.get_by_label('Person or thread',exact=True).select_option('letter')
        check('a particular existing card filters its turns', await pg.locator('.timeline-event').count() == 1 and 'finds' in await pg.inner_text('.timeline-turn'))
        await pg.get_by_label('Person or thread',exact=True).select_option('mara')
        await pg.get_by_label('Person or thread',exact=True).focus()
        await pg.evaluate("""async nid => {
          window.timelineFilter = document.activeElement;
          const s=await import('/js/store.js');s.change('novel',nid,n=>{n.notes.people[0].about='The keeper of the lighthouse.';});await s.flush();
        }""", ids['nid'])
        check('background saves preserve the focused filter and selection', await pg.evaluate("document.activeElement === window.timelineFilter && window.timelineFilter.isConnected && window.timelineFilter.value === 'mara'"))
        await pg.evaluate("""async ids => {const s=await import('/js/store.js');const sh=await import('/js/novel/shape.js');const p=s.peek('chapter',ids.cid).passages.find(p=>p.id===ids.p2);s.change('chapter',ids.cid,sh.chapterSteps.choose(ids.p2,p.versions[1].id));await s.flush();}""", ids)
        await pg.wait_for_function("document.querySelector('.timeline-results').textContent.includes('asks Mara directly')")
        check('selecting another version replaces only its turning point', 'suspects Mara' not in await pg.inner_text('.timeline-results') and 'entrusts' in await pg.inner_text('.timeline-results'))
        await pg.locator('.timeline-card').filter(has_text='Mara').first.click()
        check('a timeline person opens the existing card editor', await pg.locator('.sheet.on label.field').filter(has=pg.locator('span:text-is("With others")')).locator('textarea').input_value() == 'Wary of Tom.')
        await pg.keyboard.press('Escape')
        check('Back from a card returns to the same timeline filter', await pg.get_by_label('Person or thread',exact=True).input_value() == 'mara' and await pg.locator('.timeline').is_visible())

        await pg.get_by_label('Person or thread',exact=True).select_option('')
        await pg.set_viewport_size({'width':390,'height':844})
        await open_timeline(pg)
        await pg.get_by_role('button',name='Whole book',exact=True).click()
        check('phone timeline has no horizontal overflow', await pg.locator('.timeline').evaluate('el => el.scrollWidth <= el.clientWidth + 1'))
        await pg.locator('.timeline-event').filter(has_text='Mara plans to cross').locator('.timeline-source').click()
        await pg.wait_for_function("id => location.hash.endsWith('/' + id)",arg=ids['c2'])
        await pg.wait_for_selector(f'.passage[data-id="{ids["p3"]}"].found')
        check('a source jump reaches and highlights the exact passage', await pg.locator(f'.passage[data-id="{ids["p3"]}"].found').count() == 1)
        check('a source jump closes the phone drawer', not await pg.locator('#sidePane').evaluate("el=>el.classList.contains('open')"))
        await open_timeline(pg)
        await pg.get_by_role('button',name='Up to here',exact=True).click()
        check('Up to here follows the passage reached by the source jump', await pg.locator('.timeline-event').count() == 3 and await pg.get_by_label('Timeline through',exact=True).input_value() == 'current')
        await pg.get_by_label('Timeline through',exact=True).select_option(ids['p3'])
        check('a later chapter cutoff includes earlier chapters but no later passage', await pg.locator('.timeline-event').count() == 3 and 'finds the missing' not in await pg.inner_text('.timeline-results'))
        await pg.keyboard.press('Escape')
        check('Back closes Timeline through the Notes drawer', not await pg.locator('#sidePane').evaluate("el=>el.classList.contains('open')"))
        other = await pg.evaluate("""async () => {
          const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js');
          const {novel,chapter}=sh.newNovel({title:'A different story'});
          await s.create('chapter',chapter.id,chapter);await s.create('novel',novel.id,novel);
          location.hash='#/n/'+novel.id+'/'+chapter.id;
          return {nid:novel.id,cid:chapter.id};
        }""")
        await pg.wait_for_function("document.title === 'A different story — Cozy Novel'")
        await open_timeline(pg)
        check('a different book starts with its own empty timeline', await pg.locator('.timeline-event').count() == 0 and 'The story is still ahead' in await pg.inner_text('.timeline-empty'))
        await pg.evaluate("""async ids => {const s=await import('/js/store.js');s.change('chapter',ids.cid,c=>{c.name='Changed in the other book';});await s.flush();}""", ids)
        check('a late save from another book cannot draw over this one', 'Mara' not in await pg.inner_text('.timeline') and await pg.get_by_label('Person or thread',exact=True).locator('option').count() == 1)
        await pg.evaluate("""async ids => {
          const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js'),tl=await import('/js/novel/timeline.js');
          const p=sh.newPassage('you','Rain fell on the empty harbor.');
          p.versions[0].continuity=tl.continuityOf([],s.peek('novel',ids.nid).notes,{text:p.versions[0].text});
          s.change('chapter',ids.cid,c=>{c.passages=[p];});await s.flush();
        }""", other)
        await pg.get_by_role('button',name='Whole book',exact=True).click()
        await pg.wait_for_function("document.querySelector('.timeline-coverage').textContent.includes('1 of 1 passages')")
        check('a completed reading with no turn is distinct from missing history', 'No turning points in these passages' in await pg.inner_text('.timeline-empty') and not await pg.locator('.timeline-gaps').is_visible())
        await pg.evaluate("""async ids => {
          const s=await import('/js/store.js'),sh=await import('/js/novel/shape.js'),tl=await import('/js/novel/timeline.js');
          s.change('novel',ids.nid,n=>{n.notes.people=[{id:'keeper',name:'The keeper',aka:[]}];});
          const notes=s.peek('novel',ids.nid).notes;
          const passages=Array.from({length:85},(_,i)=>{
            const p=sh.newPassage('you',`The keeper opened letter ${i+1}.`);
            p.versions[0].continuity=tl.continuityOf([{kind:'character',cards:[{kind:'people',name:'The keeper'}],text:`The keeper opens letter ${i+1}.`,why:'A new lead for her search.',evidence:[p.versions[0].text],stance:'fact'}],notes,{text:p.versions[0].text});
            return p;
          });
          s.change('chapter',ids.cid,c=>{c.passages=passages;});await s.flush();
        }""", other)
        await pg.wait_for_function("document.querySelector('.timeline-coverage').textContent.includes('85 turning points')")
        check('a long book starts with a bounded group and says the full total', await pg.locator('.timeline-event').count() == 40 and 'Showing 40 of 85' in await pg.inner_text('.timeline-more'))
        await pg.get_by_role('button',name='Show next 40',exact=True).click()
        check('Show next reveals the following turns in order', await pg.locator('.timeline-event').count() == 80 and 'letter 80.' in await pg.locator('.timeline-turn').last.inner_text())
        await pg.get_by_role('button',name='Show all 85',exact=True).click()
        check('Show all reaches the final turn with nothing silently omitted', await pg.locator('.timeline-event').count() == 85 and 'letter 85.' in await pg.locator('.timeline-turn').last.inner_text())
        check('reading and filtering the timeline make no model calls', reqs() == [])
        check('timeline paths have no page exceptions', not [x for x in logs if x.startswith('PAGEERROR')], logs)
    finally:
        await pg.context.close()


async def main():
    with Env():
        async with async_playwright() as p:
            options = {'executable_path':os.environ['COZY_TEST_CHROMIUM']} if os.environ.get('COZY_TEST_CHROMIUM') else {}
            browser = await p.chromium.launch(**options)
            try:
                await scenario(browser)
            except Exception:
                traceback.print_exc()
                check('the timeline walk completes',False,traceback.format_exc()[-600:])
            finally:
                await browser.close()
    print(f'\nbrowser (timeline): {sum(RESULTS)} passed, {len(RESULTS)-sum(RESULTS)} failed')
    sys.exit(not all(RESULTS))


if __name__ == '__main__':
    asyncio.run(main())
