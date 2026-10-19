/* Cozy Novel — the turns of the story, read from the versions on the page.
 * This is another view of the notebook. Opening or filtering it only reads
 * what the helper already kept; the cards remain the place to edit notes. */

import * as store from '../store.js';
import { timelineOf } from '../novel/timeline.js';
import { picked, passageNumbers } from '../novel/shape.js';
import { h, icon, setText } from './dom.js';
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

/* helper: who reads what the Timeline lacks — 'on' (a helper reads it by itself), 'none' (no helper chosen), 'stopped'
 * (its connection was turned away: nothing is read until it is put right, or he presses Try again now) */
export function makeTimeline({ novelId, chapterId: openedChapter, current, openCard, jumpSource, readAgain, helper = () => 'on' }) {
  let chapterId = openedChapter, destroyed = false, frame = 0, lastResult = '', shown = PAGE_SIZE, onPage = null;
  let dirty = true, revision = 0, novelInput = '', projection = null;
  /* a card asked for from elsewhere (its card in the notes, its name in the bibliography): followed once its option is there (2.12.37) */
  let wantCard = '';
  const chapterInputs = new Map();
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
  function soon(changed = true) { if (changed) dirty = true; if (live() && !frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); }
  const offNovel = store.subscribe('novel', novelId, () => soon());
  const page = document.getElementById('pageWrap');
  /* Scroll events can outnumber frames. Read page geometry once in the frame,
   * and skip the story projection when the passage boundary has not moved. */
  const moved = () => { if (!whole && through.value === 'current') soon(false); };
  page?.addEventListener('scroll', moved, { passive: true });
  window.addEventListener('resize', moved);

  function chaptersOf(novel) {
    const chapters = {};
    for (const [id, off] of watches) if (!(novel.order || []).includes(id)) { off(); watches.delete(id); failed.delete(id); }
    for (const id of novel.order || []) {
      if (!watches.has(id)) watches.set(id, store.subscribe('chapter', id, () => soon()));
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

  /* Only a selected passage, its evidence, order or card identity can change
   * this view. Keep long prose as strings to compare, never re-encode an
   * entire manuscript for a preference save or a scroll frame. */
  function updateInputs(novel, chapters) {
    if (!dirty) return;
    dirty = false;
    let changed = false;
    /* (and what is set aside, which the Timeline counts apart: 2.12.40) */
    const nextNovel = JSON.stringify([novel.order, ['people', 'threads'].map(kind => (novel.notes?.[kind] || []).map(({id, name, aka}) => [id, name, aka])), Object.entries(novel.memory?.aside || {}).map(([k, a]) => [k, a && a.sig])]);
    if (novelInput !== nextNovel) { novelInput = nextNovel; changed = true; }
    for (const id of novel.order || []) {
      const c = chapters[id], before = chapterInputs.get(id);
      const values = [c?.name, ...(c?.passages || []).flatMap(p => {
        const v = picked(p);
        return [p.id, p.by, v?.id, v?.text, v?.streaming, JSON.stringify(v?.continuity)];
      })];
      if (!before || values.length !== before.values.length || values.some((v, i) => v !== before.values[i])) changed = true;
      chapterInputs.set(id, { record: c, values });
    }
    for (const id of chapterInputs.keys()) if (!(novel.order || []).includes(id)) chapterInputs.delete(id);
    if (changed) revision++;
  }
  function project(novel, chapters, args) {
    const key = JSON.stringify([revision, args]);
    if (projection?.key !== key) projection = { key, result: timelineOf(novel, chapters, args) };
    return projection.result;
  }

  function draw() {
    if (!live()) return;
    const novel = store.peek('novel', novelId);
    if (!novel) return;
    const chapters = chaptersOf(novel), chapter = chapters[chapterId];
    updateInputs(novel, chapters);
    const nums = passageNumbers(chapter || { passages: [] });
    const chapterNumber = (novel.order || []).indexOf(chapterId) + 1;
    optionsOf(through, [['current', 'The passage on the page'], ['^', `Before chapter ${chapterNumber}`],
      ...[...nums].map(([id, number]) => [id, `Chapter ${chapterNumber} · Passage ${number}`]), ['end', `End of chapter ${chapterNumber}`]]);
    onPage = currentPassage(chapter);
    const scopeArgs = whole ? {} : { chapterId, ...(through.value === 'end' ? {} : { through: through.value === 'current' ? onPage : through.value }) };
    const selectedCard = person.value;
    let result = project(novel, chapters, { ...scopeArgs, kind: kind.value || undefined, cardId: selectedCard || undefined });
    optionsOf(person, [['', 'All cards'], ...result.cards.map((card) => [card.id, card.name + (card.kind === 'threads' ? ' · thread' : '')])]);
    if (wantCard && result.cards.some((card) => card.id === wantCard)) person.value = wantCard;
    wantCard = '';
    if (person.value !== selectedCard) result = project(novel, chapters, { ...scopeArgs, kind: kind.value || undefined, cardId: person.value || undefined });
    const { total, read, complete } = result.coverage;
    const scopeOrder = whole ? novel.order || [] : (novel.order || []).slice(0, chapterNumber - (through.value === '^' ? 1 : 0));
    const unavailable = [...failed].filter((id) => scopeOrder.includes(id)).length;
    const waiting = [...loading].filter((id) => scopeOrder.includes(id)).length;
    const at = whole ? 'the whole book' : scopeArgs.through === '^' ? `before chapter ${chapterNumber}` : through.value === 'end' ? `through chapter ${chapterNumber}` : `through chapter ${chapterNumber}, passage ${nums.get(scopeArgs.through) || 1}`;
    const said = waiting ? 'Opening the chapters…' : `${plural(result.events.length, 'turning point')} · ${read} of ${total} passages read for the timeline · ${at}`;
    if (coverage.textContent !== said) coverage.textContent = said;
    gaps.hidden = !unavailable && (waiting || complete || !total);
    retry.hidden = !unavailable;
    /* (2.12.37: the helper reads them by itself — never a task handed to him; Read the whole book again stays in the notes) */
    reread.hidden = true;
    /* EVERY LINE TRUE, WHATEVER THE STATE (2.12.40, the audit): a passage set aside, or passed by, is never said to be
     * read by itself — it is not — nor is one while the helper is stopped; what he can do is said by the controls'
     * own names (Try again now and Read it again, under Cards) */
    /* (owed: counted by the helper's own tests for what it reads by itself — timeline.js turnsOwed — never what is left
     * of the count, 2.12.40, the review: a passage it held read was said to be read by itself) */
    const { passed = 0, aside = 0, passedFound = 0, owed = 0 } = result.coverage;
    const who = helper();
    const one = (n, a, b) => (n === 1 ? a : b);
    const stopped = 'The helper is stopped: its connection was turned away. Put it right in Settings → Connections, or press Try again now under Cards';
    setText(gapCopy, unavailable ? `${plural(unavailable, 'chapter')} could not be opened. These turns show only the chapters available here.`
      : [owed ? `${plural(owed, 'passage')} ${one(owed, 'is', 'are')} not read for the Timeline yet${who === 'on' ? ` — the helper reads ${one(owed, 'it', 'them')} by itself, a few at a time, and ${one(owed, 'its', 'their')} turns show here as they are read.` : who === 'stopped' ? `. ${stopped}, and it reads ${one(owed, 'it', 'them')} by itself.` : ` — choose a helper in Settings → Connections and it reads ${one(owed, 'it', 'them')} by itself.`}` : '',
        aside ? `${plural(aside, 'passage')} ${one(aside, 'was', 'were')} set aside — the helper’s model would not read ${one(aside, 'it', 'them')} for the notes, so ${one(aside, 'it has', 'they have')} no turns here. ${one(aside, 'Read it again', 'Read them all again')}, under Cards, has ${one(aside, 'it', 'them')} read afresh.` : '',
        passed ? `${plural(passed, 'passage')} ${one(passed, 'was', 'were')} tried twice for the Timeline and passed by — the helper’s model would not give all of ${one(passed, 'its', 'their')} turns from ${one(passed, 'its', 'their')} own words.${passedFound ? ' What it did find is shown.' : ''} ${one(passed, 'It is', 'They are')} read again if ${one(passed, 'its', 'their')} words change.` : ''].filter(Boolean).join(' '));
    /* Rows, quotes, buttons and scroll remain still on routine saves. */
    const signature = JSON.stringify([projection.key, total, read, waiting, unavailable, shown, who]);
    if (signature === lastResult) return;
    lastResult = signature;
    if (!result.events.length) {
      const title = waiting ? 'Opening your story' : kind.value || person.value ? 'No turns match this view yet' : !total ? 'The story is still ahead' : complete ? 'No turning points in these passages' : owed ? 'The timeline begins with a reading' : 'No turns to show yet';
      const copy = waiting ? 'The turns kept with each passage will appear here.' : kind.value || person.value ? 'Try another person, thread or kind of turn, or look at the whole book.' : !total ? 'As your story is read, its meaningful changes will gather here.' : complete ? 'The helper read these passages and found no changes to keep here.'
        : !owed ? 'The helper has read all it can of these passages for their turns — what it could not is said above.'
          : who === 'on' ? 'The helper reads these passages for their turns by itself, a few at a time — they gather here as they are read.' : who === 'stopped' ? `${stopped}.` : 'Choose a helper in Settings → Connections — it reads the pages for their turns by itself.';
      results.replaceChildren(h('div.timeline-empty', h('span.timeline-flourish', { 'aria-hidden': 'true' }, '⌁'), h('h3', title), h('p', copy)));
      return;
    }
    let list = results.querySelector('.timeline-list');
    if (!list) { list = h('ol.timeline-list', { 'aria-label': 'Turning points in story order' }); results.replaceChildren(list); }
    const old = new Map([...list.children].map(row => [row.dataset.event, row]));
    const rows = [];
    let lastChapter = null;
    for (const event of result.events.slice(0, shown)) {
      const heading = event.chapterId !== lastChapter ? `Chapter ${event.chapterNumber}${chapters[event.chapterId]?.name ? ` · ${chapters[event.chapterId].name}` : ''}` : '';
      const signature = JSON.stringify([event, heading]);
      let row = old.get(event.id);
      old.delete(event.id);
      if (!row || row._eventSignature !== signature) {
        const before = row;
        row = eventNode(event);
        row._eventSignature = signature;
        if (heading) row.prepend(h('p.timeline-chapter', heading));
        if (before) before.replaceWith(row);
      }
      lastChapter = event.chapterId;
      rows.push(row);
    }
    for (const row of old.values()) row.remove();
    rows.forEach((row, i) => { if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null); });
    results.querySelector('.timeline-more')?.remove();
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
    /* one card's turns, the whole book through (2.12.37: its card and its name in the bibliography lead here) */
    follow(cardId) {
      wantCard = cardId || '';
      whole = true;
      for (const b of scope.children) b.setAttribute('aria-pressed', String(b.textContent === 'Whole book'));
      boundary.hidden = true;
      kind.value = '';
      shown = PAGE_SIZE;
      lastResult = '';
      draw();
    },
    destroy() { destroyed = true; cancelAnimationFrame(frame); offNovel(); for (const off of watches.values()) off(); page?.removeEventListener('scroll', moved); window.removeEventListener('resize', moved); },
  };
}
