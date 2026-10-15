/* Cozy Novel — the turns of the story, read from the versions on the page.
 * This is another view of the notebook. Opening or filtering it only reads
 * what the helper already kept; the cards remain the place to edit notes. */

import * as store from '../store.js';
import { timelineOf } from '../novel/timeline.js';
import { picked, passageNumbers } from '../novel/shape.js';
import { h, icon } from './dom.js';
import { plural } from '../util.js';

const KINDS = { relationship: 'Relationships', character: 'People', thread: 'Threads' };
const STANCES = { belief: 'Belief', claim: 'Claim', intention: 'Intention' };
const PAGE_SIZE = 40;

/* Keep each select itself, and unchanged options, under his fingers when a
 * reading, save acknowledgement or another window brings something new. */
function optionsOf(select, rows) {
  const value = select.value;
  const old = new Map([...select.options].map((o) => [o.value, o]));
  rows.forEach(([id, text], i) => {
    const option = old.get(id) || h('option', { value: id });
    old.delete(id);
    if (option.textContent !== text) option.textContent = text;
    if (select.options[i] !== option) select.insertBefore(option, select.options[i] || null);
  });
  for (const o of old.values()) o.remove();
  select.value = rows.some(([id]) => id === value) ? value : rows[0]?.[0] || '';
}

function currentPassage(chapter) {
  const wrap = document.getElementById('pageWrap');
  const numbers = passageNumbers(chapter || { passages: [] });
  const els = [...document.querySelectorAll('#passages > .passage')].filter((el) => numbers.has(el.dataset.id));
  if (!wrap || !els.length) return '^';
  const eye = wrap.getBoundingClientRect().top + wrap.clientHeight * .25;
  let seen = els[0];
  for (const el of els) { if (el.getBoundingClientRect().top <= eye) seen = el; else break; }
  return seen.dataset.id;
}

export function makeTimeline({ novelId, chapterId: openedChapter, current, openCard, jumpSource, readAgain }) {
  let chapterId = openedChapter, destroyed = false, frame = 0, lastResult = '', shown = PAGE_SIZE, onPage = null;
  const watches = new Map(), loading = new Set(), failed = new Set();
  const el = h('section.timeline', { 'aria-label': 'Story timeline' });
  const kind = h('select', { 'aria-label': 'Kind of turning point' }, h('option', { value: '' }, 'Every turning point'),
    ...Object.entries(KINDS).map(([value, label]) => h('option', { value }, label)));
  const person = h('select', { 'aria-label': 'Person or thread' }, h('option', { value: '' }, 'All cards'));
  const scope = h('div.segmented.timeline-scope', { role: 'group', 'aria-label': 'How far to read' });
  let whole = false;
  const through = h('select', { 'aria-label': 'Timeline through' }, h('option', { value: 'current' }, 'The passage on the page'));
  const boundary = h('label.timeline-field.timeline-boundary', h('span', 'Up to'), through);
  for (const [value, label, title] of [[false, 'Up to here', 'Show turns only as far as the passage or chapter you choose.'], [true, 'Whole book', 'Show turns from every chapter, including what happens later.']]) {
    scope.append(h('button', { 'aria-pressed': String(value === whole), title, onclick: () => {
      whole = value;
      shown = PAGE_SIZE;
      for (const b of scope.children) b.setAttribute('aria-pressed', String(b.textContent === label));
      boundary.hidden = whole;
      draw();
    } }, label));
  }
  const coverage = h('p.timeline-coverage', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const gaps = h('div.timeline-gaps');
  const gapCopy = h('p');
  const reread = h('button.btn.quiet.small', { title: 'Open the notebook’s existing Read the whole book again action. It explains the reading before you begin.', onclick: () => { if (current()) readAgain(); } }, 'Read the whole book again');
  const retry = h('button.btn.quiet.small', { title: 'Try opening chapters that the phone could not send.', onclick: () => { failed.clear(); draw(); } }, 'Try opening the chapters again');
  gaps.append(gapCopy, h('div.btnrow', reread, retry));
  const results = h('div.timeline-results');
  el.append(h('p.timeline-intro', 'Changes in people, relationships and threads, with the words behind each turn.'),
    h('div.timeline-controls', scope,
      h('div.timeline-filters', h('label.timeline-field', h('span', 'Show'), kind), h('label.timeline-field', h('span', 'Follow'), person)), boundary),
    coverage, gaps, results,
    h('p.timeline-footnote', 'The cards keep your notes. This view follows the versions on the page; choosing another take changes the turns shown here.'));
  for (const select of [kind, person, through]) select.addEventListener('change', () => { shown = PAGE_SIZE; draw(); });

  function live() { return !destroyed && current(); }
  function soon() { if (live() && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); }
  const offNovel = store.subscribe('novel', novelId, soon);
  const page = document.getElementById('pageWrap');
  const moved = () => { if (!whole && through.value === 'current' && currentPassage(store.peek('chapter', chapterId)) !== onPage) soon(); };
  page?.addEventListener('scroll', moved, { passive: true });
  window.addEventListener('resize', moved);

  function chaptersOf(novel) {
    const chapters = {};
    for (const [id, off] of watches) if (!(novel.order || []).includes(id)) { off(); watches.delete(id); failed.delete(id); }
    for (const id of novel.order || []) {
      if (!watches.has(id)) watches.set(id, store.subscribe('chapter', id, soon));
      const chapter = store.peek('chapter', id);
      if (chapter) { chapters[id] = chapter; failed.delete(id); }
      else if (!loading.has(id) && !failed.has(id)) {
        loading.add(id);
        store.open('chapter', id).then((c) => { if (!c) failed.add(id); }, () => failed.add(id)).finally(() => { loading.delete(id); soon(); });
      }
    }
    return chapters;
  }

  function eventNode(event) {
    const people = event.participants || [];
    const whose = event.whoseName || people.find((p) => p.id === event.whose)?.name || '';
    const stance = STANCES[event.stance];
    const row = h('li.timeline-event', { 'data-event': event.id, 'data-passage': event.passageId },
      h('div.timeline-event-top', h('span.timeline-kind', KINDS[event.kind] || 'Turning point'), stance ? h('span.timeline-stance', whose ? `${whose} · ${stance.toLowerCase()}` : stance) : null),
      h('p.timeline-turn', event.text));
    if (event.why) row.append(h('p.timeline-why', h('b', 'Why it matters. '), event.why));
    const quotes = Array.isArray(event.evidence) ? event.evidence : event.evidence ? [event.evidence] : [];
    for (const quote of quotes) row.append(h('blockquote.timeline-evidence', String(quote)));
    row.append(h('button.timeline-source', { title: 'Go to this passage and mark the words behind this turn.', onclick: () => {
      if (!live()) return;
      /* The selected version may have moved since this row was drawn. */
      const c = store.peek('chapter', event.chapterId);
      const p = c?.passages?.find((p) => p.id === event.passageId);
      if (picked(p)?.id !== event.versionId) { draw(); return; }
      jumpSource(event.chapterId, event.passageId, quotes[0] || '');
    } }, event.label || `Chapter ${event.chapterNumber} · Passage ${event.passageNumber}`, icon('right', 12)));
    const links = h('div.timeline-cards');
    for (const card of people) {
      if (card.missing) links.append(h('span.timeline-card-missing', `${card.name} · card removed`));
      else links.append(h('button.timeline-card', { title: `Open ${card.name} in your notes to read or edit the existing card.`, onclick: () => { if (live()) openCard(card.kind, card.id); } }, card.name));
    }
    if (links.childNodes.length) row.append(links);
    return row;
  }

  function draw() {
    if (!live()) return;
    const novel = store.peek('novel', novelId);
    if (!novel) return;
    const chapters = chaptersOf(novel), chapter = chapters[chapterId];
    const nums = passageNumbers(chapter || { passages: [] });
    const chapterNumber = (novel.order || []).indexOf(chapterId) + 1;
    optionsOf(through, [['current', 'The passage on the page'], ['^', `Before chapter ${chapterNumber}`],
      ...[...nums].map(([id, number]) => [id, `Chapter ${chapterNumber} · Passage ${number}`]), ['end', `End of chapter ${chapterNumber}`]]);
    onPage = currentPassage(chapter);
    const scopeArgs = whole ? {} : { chapterId, ...(through.value === 'end' ? {} : { through: through.value === 'current' ? onPage : through.value }) };
    const selectedCard = person.value;
    let result = timelineOf(novel, chapters, { ...scopeArgs, kind: kind.value || undefined, cardId: selectedCard || undefined });
    optionsOf(person, [['', 'All cards'], ...result.cards.map((card) => [card.id, card.name + (card.kind === 'threads' ? ' · thread' : '')])]);
    if (person.value !== selectedCard) result = timelineOf(novel, chapters, { ...scopeArgs, kind: kind.value || undefined, cardId: person.value || undefined });
    const { total, read, missing, complete } = result.coverage;
    const scopeOrder = whole ? novel.order || [] : (novel.order || []).slice(0, chapterNumber - (through.value === '^' ? 1 : 0));
    const unavailable = [...failed].filter((id) => scopeOrder.includes(id)).length;
    const waiting = [...loading].filter((id) => scopeOrder.includes(id)).length;
    const at = whole ? 'the whole book' : scopeArgs.through === '^' ? `before chapter ${chapterNumber}` : through.value === 'end' ? `through chapter ${chapterNumber}` : `through chapter ${chapterNumber}, passage ${nums.get(scopeArgs.through) || 1}`;
    const said = waiting ? 'Opening the chapters…' : `${plural(result.events.length, 'turning point')} · ${read} of ${total} passages read for the timeline · ${at}`;
    if (coverage.textContent !== said) coverage.textContent = said;
    gaps.hidden = !unavailable && (waiting || complete || !total);
    retry.hidden = !unavailable;
    reread.hidden = Boolean(unavailable);
    gapCopy.textContent = unavailable ? `${plural(unavailable, 'chapter')} could not be opened. These turns show only the chapters available here.` : `${plural(missing, 'passage')} ${missing === 1 ? 'has' : 'have'} no complete timeline reading yet. Read the whole book again to include older pages.`;
    /* Rows, quotes, buttons and scroll remain still on routine saves. */
    const signature = JSON.stringify([result.events, kind.value, person.value, total, read, waiting, unavailable, shown]);
    if (signature === lastResult) return;
    lastResult = signature;
    if (!result.events.length) {
      const title = waiting ? 'Opening your story' : kind.value || person.value ? 'No turns match this view yet' : !total ? 'The story is still ahead' : complete ? 'No turning points in these passages' : 'The timeline begins with a reading';
      const copy = waiting ? 'The turns kept with each passage will appear here.' : kind.value || person.value ? 'Try another person, thread or kind of turn, or look at the whole book.' : !total ? 'As your story is read, its meaningful changes will gather here.' : complete ? 'The helper read these passages and found no changes to keep here.' : 'Cards written before the timeline keep their notes. The helper adds supported turns while reading new pages, or when you choose Read the whole book again.';
      results.replaceChildren(h('div.timeline-empty', h('span.timeline-flourish', { 'aria-hidden': 'true' }, '⌁'), h('h3', title), h('p', copy)));
      return;
    }
    const list = h('ol.timeline-list', { 'aria-label': 'Turning points in story order' });
    let lastChapter = null;
    for (const event of result.events.slice(0, shown)) {
      const row = eventNode(event);
      if (event.chapterId !== lastChapter) {
        row.prepend(h('p.timeline-chapter', `Chapter ${event.chapterNumber}`, chapters[event.chapterId]?.name ? ` · ${chapters[event.chapterId].name}` : ''));
        lastChapter = event.chapterId;
      }
      list.append(row);
    }
    results.replaceChildren(list);
    if (result.events.length > shown) {
      const more = (count) => {
        const from = shown;
        shown = count;
        draw();
        /* Continue with the first newly revealed turn, including its words,
         * instead of sending the reader past them to the next button. */
        const next = results.querySelectorAll('.timeline-event')[from];
        if (next) { next.tabIndex = -1; next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'start' }); }
      };
      results.append(h('div.timeline-more',
        h('p', `Showing ${shown} of ${plural(result.events.length, 'turning point')}.`),
        h('div.btnrow', h('button.btn.small', { title: 'Continue through the next turns in story order.', onclick: () => more(shown + PAGE_SIZE) }, `Show next ${Math.min(PAGE_SIZE, result.events.length - shown)}`),
          h('button.btn.quiet.small', { title: 'Show every matching turn; a long book may take a moment.', onclick: () => more(result.events.length) }, `Show all ${result.events.length}`))));
    }
  }

  return {
    el, novelId,
    update(nextChapter = chapterId) { if (chapterId !== nextChapter) { chapterId = nextChapter; through.value = 'current'; shown = PAGE_SIZE; } draw(); },
    destroy() { destroyed = true; cancelAnimationFrame(frame); offNovel(); for (const off of watches.values()) off(); page?.removeEventListener('scroll', moved); window.removeEventListener('resize', moved); },
  };
}
