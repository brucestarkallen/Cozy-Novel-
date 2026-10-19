/* Cozy Novel — js/ui/bibliography.js — THE BIBLIOGRAPHY, on the screen.
 *
 * Notes → Bibliography: every name the book gives meaning to — what the
 * helper gathered from the pages as it read them, each fact with the passage
 * that says it, and his own entries (his, or his partner's at his asking) —
 * by kind, each opening its card. Tap names: a name in the page with an
 * entry, the book's facts or a card of the notes is marked; a tap opens its
 * card — what it means, where it stands now (the notes), what the book has
 * told of it, chapter by chapter. Nothing here asks a model. */

import * as store from '../store.js';
import { h, icon, toast, undoToast, openSheet, confirmIt, field, pickFile, download } from './dom.js';
import { picked, novelSteps } from '../novel/shape.js';
import { bibItems, itemForms, nameForms, makeFinder, formKey, codexNow, ENTRY_KINDS, KIND_TITLE, RIDES, RIDES_WORDS, BY_PAGE_WORDS, newEntry, tidyEntry, entriesOf, nameTaken, entriesFromLorebook, lorebookOf, recallOn, nameRows, cardRefs } from '../novel/bibliography.js';
import { bibAutoOn } from '../novel/context.js';
import { superActive } from '../novel/auto.js';

/* the entry sheet's "page by page" (Super automatic): never kept as such — it keeps what the entry was set to */
const BY_PAGE = 'page';
import { nowLabelOf } from '../novel/prompts.js';
import { plural, nameKey, slug } from '../util.js';
import * as archivist from '../novel/archivist.js';
import { connFor } from '../novel/writer.js';
import { quickAdd, quickBusy, stopQuick, quickLog, undoQuick, clearQuick, putBackQuick, askingWhere, GONE_MS } from '../novel/quickadd.js';

/* app.js: closeSide (the notes drawer on a phone), showCard (a card of the
 * notes), whenOpen (a passage, its words lit), openSearch (every place),
 * showTimeline (a card's turns), chapterNow (the chapter open) */
let hooks = {};
export function initBibliography(appHooks) { hooks = appHooks || {}; }

const chaptersOf = (novel) => Object.fromEntries((novel.order || []).map((id) => [id, store.peek('chapter', id)]).filter(([, c]) => c));
const lookOf = () => ((store.peek('house', 'house') || {}).look || {});
/* Tap names: on unless he switched it off */
export const namesOn = () => lookOf().names !== 'off';

/* ------------------------------------------------------- names in the page */

/* every name of the book, as one finder: the bibliography's names and the
 * cards of the notes — made again only when one of them changes */
const finders = new Map();   /* novelId -> {sig, finder} */
function namesPrint(novel, chapters) {
  const rows = [];
  for (const e of entriesOf(novel)) rows.push(`e${e.id}:${e.name}:${(e.aka || []).join(',')}:${e.kind}`);
  for (const kind of ['people', 'places', 'lore']) for (const c of ((novel.notes || {})[kind] || [])) rows.push(`c${c.id}:${c.name}:${(c.aka || []).join(',')}`);
  /* the names the facts on show give, and their kinds — only these decide what the page marks: facts laid on a passage
   * that name no one new mark nothing new, and the finder is not built again (2.12.2: the app lagged) */
  const named = new Set();
  for (const id of novel.order || []) {
    const ch = chapters[id];
    for (const p of (ch && ch.passages) || []) { const c = codexNow(picked(p)); if (c) for (const f of c.facts) if (f && typeof f.name === 'string') named.add(`${f.name}/${f.kind}`); }
  }
  rows.push(...[...named].sort());
  return rows.join('|');
}
function mergeForms(...lists) {
  const map = new Map();
  for (const list of lists) for (const f of list) {
    const key = formKey(f.form);
    const row = map.get(key) || { form: f.form, refs: [] };
    for (const r of f.refs) if (!row.refs.includes(r)) row.refs.push(r);
    map.set(key, row);
  }
  return [...map.values()];
}
/* The names the page marks for this book (null when Tap names is off, or none) */
export function pageNames(novelId) {
  if (!namesOn()) return null;
  const novel = store.peek('novel', novelId);
  if (!novel) return null;
  const chapters = chaptersOf(novel);
  const sig = namesPrint(novel, chapters);
  const was = finders.get(novelId);
  if (was && was.sig === sig) return was.finder;
  const items = bibItems(novel, chapters, { facts: true });
  const forms = mergeForms(itemForms(items), nameForms([], novel.notes || {}));
  let finder = forms.length ? makeFinder(forms) : null;
  /* the same names marked as before (a passage read again, its facts the same names): the same finder — what it found
   * in each passage's words is kept, and nothing on the page is drawn again */
  if (finder && was && was.finder && was.finder.sig === finder.sig) finder = was.finder;
  finders.set(novelId, { sig, finder });
  return finder;
}

/* ------------------------------------------------------------ a name's card */

/* A tap on a marked name: what it answers to, now */
export function showName(novelId, key) {
  const finder = pageNames(novelId) || (finders.get(novelId) || {}).finder;
  const refs = finder ? finder.refsOf(key) : [];
  if (!refs.length) { toast('Nothing is kept for that name just now.'); return; }
  showRefs(novelId, refs, { said: key });
}
/* A tap on a marked name, in the page or a scene: with a mouse, a moment's
 * wait — a second click of a double click selects the word instead, as it
 * would anywhere (a finger's tap opens it at once; a long press selects) */
let tapWaiting = 0;
export function tapName(novelId, key, e) {
  clearTimeout(tapWaiting);
  if (e && e.detail > 1) return;
  if (!e || e.pointerType !== 'mouse') { showName(novelId, key); return; }
  tapWaiting = setTimeout(() => { if (!window.getSelection || window.getSelection().isCollapsed) showName(novelId, key); }, 280);
}
/* one item of the bibliography by its ref ('e:<id>' for his entry) */
export function showRef(novelId, ref) { showRefs(novelId, [ref]); }
/* what the bibliography holds for a card of the notes (2.12.37): his entry it stands for, or what the book told under its
 * name (bibliography.js cardRefs) */
function refsForCard(novelId, kind, cardId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return [];
  return cardRefs(novel, chaptersOf(novel), kind, cardId);
}
export function bibHas(novelId, kind, cardId) { return refsForCard(novelId, kind, cardId).length > 0; }
export function showForCard(novelId, kind, cardId) {
  const refs = refsForCard(novelId, kind, cardId);
  if (refs.length) showRefs(novelId, refs);
  else toast('Nothing is kept in the bibliography for this card yet.');
}

function showRefs(novelId, refs, { said = '' } = {}) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  /* one row for each who goes by the name, his entry with the notes' card it stands for (bibliography.js nameRows) */
  const rows = nameRows(novel, chaptersOf(novel), refs);
  if (!rows.length) { toast('Nothing is kept for that name just now.'); return; }
  const title = rows.length === 1 ? (rows[0].it ? rows[0].it.name : rows[0].card.name) : `${rows.length} who go by that name`;
  const s = openSheet(title, { small: true });
  s.box.classList.add('namesheet');
  for (const r of rows) s.body.append(nameSection(novelId, novel, r, { many: rows.length > 1, close: s.close, said }));
}

const CARD_KIND_TITLE = { people: 'People', places: 'Places', lore: 'Things' };
function paragraphs(text) {
  return String(text || '').split(/\n{2,}|\n/).filter((x) => x.trim()).map((x) => h('p', x.trim()));
}
function nameSection(novelId, novel, { it, card, cardKind }, { many, close, said = '' }) {
  const name = it ? it.name : card.name;
  const kind = it ? it.kind : (cardKind === 'lore' ? 'things' : cardKind);
  const box = h('section.namecard');
  if (many) box.append(h('h3.namecard-name', name));
  const aka = [...new Set([...(it ? it.aka || [] : []), ...((card && card.aka) || [])])].filter((a) => nameKey(a) !== nameKey(name));
  box.append(h('p.namecard-kind', `${KIND_TITLE[kind] || CARD_KIND_TITLE[cardKind] || 'Lore'}${aka.length ? ` — also ${aka.join(', ')}` : ''}`));
  const entry = it && it.entry;
  if (entry && entry.line) box.append(h('p.namecard-line', entry.line));
  if (entry && entry.text) box.append(h('div.namecard-text', ...paragraphs(entry.text)));
  /* whose words: his own, or his partner's written for him — kept alike, never written over by the helper */
  const whose = entry && entry.by === 'partner' ? 'Your partner’s entry' : 'Your entry';
  if (entry) box.append(h('p.namecard-note', entry.rides === 'never' ? `${whose} — only for you; the writer never reads it.`
    : superActive() ? `${whose} — the writer reads it with every page while there’s room; when there isn’t, Super automatic sends it first when the page names it or needs it.`
      : entry.rides === 'always' ? `${whose} — the writer always reads it.`
        : `${whose} — the writer reads it with every page while there’s room, and first when ${name} comes up${recallOn(novel) ? ' or a page needs it' : ''}.`));
  /* where it stands now: the notes' own card (the notes are the story as it stands) */
  if (card) {
    const notes = h('div.namecard-notes', h('h4', 'In the notes'));
    if (card.about) notes.append(...paragraphs(card.about));
    if (card.since && String(card.since).trim()) notes.append(h('p', h('b', 'Since then '), card.since));
    if (cardKind === 'people' && card.ties) notes.append(h('p', h('b', 'With others '), card.ties));
    if (cardKind === 'people' && card.now) notes.append(h('p', h('b', `${nowLabelOf(novel, card, 'Right now')} `), card.now));
    if (notes.childNodes.length > 1) box.append(notes);
  }
  /* what the book has told of it, chapter by chapter — each with the passage that says it */
  const facts = it ? it.facts : [];
  if (facts.length) {
    const list = h('ol.namecard-facts');
    for (const f of facts) {
      list.append(h('li', h('span', f.fact), ' ', h('button.link', { title: 'Go to the passage that says it, its words lit.', onclick: () => {
        close();
        if (hooks.closeSide) hooks.closeSide();
        if (hooks.whenOpen) hooks.whenOpen(f.chapterId, { passageId: f.passageId, show: { query: (f.evidence || [])[0] || name } });
      } }, f.label)));
    }
    box.append(h('div.namecard-book', h('h4', 'What the book has told'), list));
  }
  if (!entry && !facts.length && !card) box.append(h('p.namecard-note', 'Nothing is kept for this name yet.'));
  const row = h('div.btnrow');
  row.append(h('button.btn.small', { title: entry ? 'Change your entry — the book’s facts and the notes stay as they are.' : `Write your own entry for ${name}: what it means, for the writer to read with every page while there’s room.`, onclick: () => { close(); editEntry(novelId, entry ? entry.id : null, { name, kind }); } }, entry ? 'Edit your entry' : 'Write your entry'));
  if (card && hooks.showCard) row.append(h('button.btn.small.quiet', { title: 'Opens the card in the notes, to read or edit it.', onclick: () => { close(); hooks.showCard(cardKind, card.id); } }, 'Open the card'));
  /* its turns through the book (2.12.37) */
  if (card && cardKind === 'people' && hooks.showTimeline) row.append(h('button.btn.small.quiet', { title: `The turns of ${card.name} through the book, each with the words behind it.`, onclick: () => { close(); hooks.showTimeline(card.id); } }, 'On the Timeline'));
  /* by the name as he tapped it ("Rukia" finds Rukia and Rukia Kuchiki), else its own */
  const asked = said || name;
  if (hooks.openSearch) row.append(h('button.btn.small.quiet', { title: `Every place ${asked} stands in the book.`, onclick: () => { close(); hooks.openSearch(asked); } }, 'Every place'));
  box.append(row);
  return box;
}

/* ------------------------------------------------------------ his entry */

/* what he typed into an entry and left without saving, with the book's draft record */
const entryDrafts = new Map();
function keepEntryDraft(novelId, key, words) {
  if (words) entryDrafts.set(key, words); else entryDrafts.delete(key);
  (async () => {
    let d = store.peek('draft', novelId);
    if (d === undefined) d = await store.open('draft', novelId).catch(() => null);
    if (entryDrafts.get(key) !== words) return;
    if (!d) { if (words) await store.create('draft', novelId, { id: novelId, novelId, entries: { [key]: words } }); return; }
    store.change('draft', novelId, (x) => { x.entries = x.entries || {}; if (words) x.entries[key] = JSON.parse(JSON.stringify(words)); else delete x.entries[key]; }, { delay: 300 });
  })().catch(() => { /* kept in this window until the phone answers */ });
}

/* His entry: written or changed by his hand — only what he typed, onto the
 * entry as it stands when he saves. */
export async function editEntry(novelId, id, { name = '', kind = '' } = {}) {
  if (store.peek('draft', novelId) === undefined) { try { await store.open('draft', novelId); } catch (_) { /* the local draft still works */ } }
  const n = store.peek('novel', novelId);
  if (!n) return;
  const cur = id ? entriesOf(n).find((e) => e.id === id) || null : null;
  const e = cur ? JSON.parse(JSON.stringify(cur)) : newEntry({ name, kind: ENTRY_KINDS.includes(kind) ? kind : 'people' });
  const drafts = { ...(((store.peek('draft', novelId) || {}).entries) || {}), ...Object.fromEntries(entryDrafts) };
  let draftKey = `${novelId}:entry:${id || nameKey(name) || 'new'}`;
  /* an entry taken out while his words for it waited unsaved has no entry to open them on: Add an entry brings them back */
  if (!id && !name && !drafts[draftKey]) {
    const prefix = `${novelId}:entry:`;
    const ids = new Set(entriesOf(n).map((x) => x.id));
    const orphan = Object.keys(drafts).find((k) => k.startsWith(prefix) && /^bb-/.test(k.slice(prefix.length)) && drafts[k] && !ids.has(k.slice(prefix.length)));
    if (orphan) draftKey = orphan;
  }
  const draft = drafts[draftKey] || null;
  const s = openSheet(cur ? cur.name : name ? `Your entry for ${name}` : 'A new entry', { small: true, onClose: () => keepDraft() });
  const nameBox = h('input', { type: 'text', value: e.name || '' });
  const akaBox = h('input', { type: 'text', value: (e.aka || []).join(', ') });
  const kindBox = h('select', { 'aria-label': 'What it is' }, ...ENTRY_KINDS.map((k) => h('option', { value: k, selected: e.kind === k }, KIND_TITLE[k])));
  const lineBox = h('input', { type: 'text', value: e.line || '', placeholder: 'Who or what it is, in a line' });
  const textBox = h('textarea', { rows: 7 });
  textBox.value = e.text || '';
  /* Super automatic: Always and When there's room are one, page by page — what he set stays for when it is off (BY_PAGE) */
  const byPage = superActive();
  const ridesBox = byPage
    ? h('select', { 'aria-label': 'The writer reads it' }, h('option', { value: BY_PAGE, selected: e.rides !== 'never' }, BY_PAGE_WORDS), h('option', { value: 'never', selected: e.rides === 'never' }, RIDES_WORDS.never))
    : h('select', { 'aria-label': 'The writer reads it' }, ...RIDES.map((r) => h('option', { value: r, selected: e.rides === r }, RIDES_WORDS[r])));
  const boxes = { name: nameBox, aka: akaBox, kind: kindBox, line: lineBox, text: textBox, rides: ridesBox };
  const opened = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.value]));
  /* a draft's Always or When there's room, chosen while Super automatic was off: kept underneath when it is saved now (2.12.35) */
  let underneath = null;
  if (draft) {
    for (const [k, v] of Object.entries(draft)) {
      if (!boxes[k]) continue;
      /* a choice kept while Super automatic was on, or off, read as the sheet offers it now */
      if (k === 'rides') { if (byPage && (v === 'always' || v === 'named')) underneath = v; const r = byPage ? (v === 'never' ? 'never' : BY_PAGE) : v === BY_PAGE ? null : v; if (r) boxes[k].value = r; continue; }
      boxes[k].value = v;
    }
    s.body.append(h('p.say', 'Your words from before, not saved yet, are back.'));
  }
  s.body.append(field('Name', nameBox));
  s.body.append(field('Also called', akaBox, 'Other names, separated by commas — the page marks them too.'));
  s.body.append(field('What it is', kindBox));
  s.body.append(field('In a line', lineBox));
  s.body.append(field('The entry', textBox, 'What it means — for you to read when you tap the name, and for the writer as background. People in the story still know only what they have lived.'));
  s.body.append(field('The writer reads it', ridesBox, byPage
    ? 'Page by page: with every page while the bibliography has room beside the book — when it hasn’t, Super automatic sends it first when the page names it or needs it. Never keeps it for you alone. Always, set before, comes back when Super automatic is off.'
    : 'When there’s room: with every page while the bibliography has room beside the book — when it hasn’t, first when its name is said near the page or, with Smart recall, when the page needs it. Always: with every page, before anything else. Never keeps it for you alone.'));
  const typed = () => {
    const t = Object.fromEntries(Object.keys(boxes).filter((k) => boxes[k].value !== opened[k]).map((k) => [k, boxes[k].value]));
    /* (a draft's Always or When there's room, kept underneath while the box says Page by page, is his still to save —
     * 2.12.35, the review: for an entry read page by page already the box never changed, so it was let go) */
    const liveNow = cur ? entriesOf(store.peek('novel', novelId) || {}).find((x) => x.id === cur.id) : null;
    if (underneath && ridesBox.value === BY_PAGE && (!liveNow || liveNow.rides !== underneath)) t.rides = underneath;
    return t;
  };
  let done = false;
  const keepDraft = () => {
    if (done) return;
    const t = typed();
    if (Object.keys(t).length) { keepEntryDraft(novelId, draftKey, t); toast('Your words are kept — open the entry again to go on.'); } else keepEntryDraft(novelId, draftKey, undefined);
  };
  for (const b of Object.values(boxes)) b.addEventListener('input', () => { if (!done) { const t = typed(); keepEntryDraft(novelId, draftKey, Object.keys(t).length ? t : undefined); } });
  const row = h('div.btnrow', h('button.btn.primary', { onclick: () => {
    const t = typed();
    const live = cur ? entriesOf(store.peek('novel', novelId)).find((x) => x.id === cur.id) || null : null;
    /* taken out meanwhile: his words, the whole entry as he had it, wait for Add an entry */
    if (cur && !live) {
      keepEntryDraft(novelId, `${novelId}:entry:new`, Object.fromEntries(Object.entries(boxes).map(([k, bx]) => [k, bx.value])));
      keepEntryDraft(novelId, draftKey, undefined);
      toast('This entry was taken out meanwhile — your words are kept; Add an entry makes it anew.', 6000);
      done = true; s.close(); return;
    }
    if (cur && !Object.keys(t).length) { done = true; keepEntryDraft(novelId, draftKey, undefined); s.close(); return; }
    const out = live ? JSON.parse(JSON.stringify(live)) : e;
    for (const [k, v] of Object.entries(t)) out[k] = k === 'aka' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
    if (!cur) { out.name = nameBox.value; out.aka = akaBox.value.split(',').map((x) => x.trim()).filter(Boolean); out.kind = kindBox.value; out.line = lineBox.value; out.text = textBox.value; out.rides = ridesBox.value; }
    /* page by page: what it was set to stays (Always, or When there's room), Never let go of as When there's room */
    if (out.rides === BY_PAGE) out.rides = underneath || (live && live.rides !== 'never' ? live.rides : 'named');
    /* renamed: the old name stays among the others it goes by */
    if (cur && t.name !== undefined && nameKey(t.name) !== nameKey(live.name)) out.aka = [...(out.aka || []), live.name];
    const tidy = tidyEntry(out);
    if (!tidy.name) { toast('It needs a name.'); return; }
    const all = entriesOf(store.peek('novel', novelId));
    const clash = [tidy.name, ...tidy.aka].find((x) => nameTaken(all, x, tidy.id));
    if (clash) { toast(`Another entry goes by ${clash} already — give this one another name, or change that one.`, 6000); return; }
    if (!tidy.line && !tidy.text) { toast('Write what it is — in a line, or the entry.'); return; }
    const saved = { ...tidy, at: Date.now(), by: 'you' };
    store.change('novel', novelId, novelSteps.putEntry(saved), { now: true });
    /* an entry under a card of the notes: the notes are checked against it (archivist.js auditDue, 2.12.37) */
    archivist.nudge(novelId);
    keepEntryDraft(novelId, draftKey, undefined);
    done = true;
    s.close();
    toast(cur ? 'Your entry is changed.' : 'Your entry is in the bibliography.');
  } }, 'Save'));
  if (cur) row.append(h('button.btn.danger', { onclick: async () => {
    if (!(await confirmIt('Take this entry out?', `${cur.name} goes from the bibliography — what the book itself tells of it stays.`, 'Take it out', { danger: true }))) return;
    const before = entriesOf(store.peek('novel', novelId)).find((x) => x.id === cur.id);
    store.change('novel', novelId, novelSteps.dropEntry(cur.id), { now: true });
    archivist.nudge(novelId);
    keepEntryDraft(novelId, draftKey, undefined);
    done = true;
    s.close();
    if (before) undoToast(`${cur.name} is out of the bibliography.`, () => { store.change('novel', novelId, novelSteps.entryBack(before.id, before, null), { now: true }); archivist.nudge(novelId); });
  } }, 'Take it out'));
  s.body.append(row);
}

/* ------------------------------------------------------- Notes → Bibliography */

const FOLD = 'cozynovel.fold.bib.';
const folded = (k) => { try { return localStorage.getItem(FOLD + k) === 'closed'; } catch (_) { return false; } };
const setFold = (k, closed) => { try { localStorage.setItem(FOLD + k, closed ? 'closed' : 'open'); } catch (_) { /* this visit only */ } };
const filters = new Map();   /* novelId -> the words he filters by */

/* What the view is drawn from — the same print draws nothing again */
export function bibliographyPrint(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return '';
  const chapters = chaptersOf(novel);
  /* (not the words he filters by: the list under the box follows them by itself) */
  /* (with how each Quick add being asked stands — here, in another window, or its window closed: 2.12.40) */
  return JSON.stringify([novel.bibliography || [], novel.notes || {}, (novel.prefs || {}).bibAuto || '', (novel.prefs || {}).bibRecall || '', superActive(), lookOf().names || '', namesPrint(novel, chapters), archivist.bibDue ? archivist.bibDue(novelId).length : 0, quickLog(novel), quickLog(novel).map((r) => askingWhere(novelId, r)), quickBusy(novelId)]);
}

export function bibliographyView(novelId, { redraw = () => {} } = {}) {
  const novel = store.peek('novel', novelId);
  const root = h('div.bibview');
  if (!novel) return root;
  const auto = bibAutoOn(novel);
  const recall = recallOn(novel);
  /* what the helper found stays with its passages whether or not it goes on filling it */
  const items = bibItems(novel, chaptersOf(novel), { facts: true });
  const mine = items.filter((it) => it.entry).length;
  root.dataset.count = plural(items.length, 'name');
  root.append(h('div.lightcard.bibintro',
    h('p.notekey', 'What each name in the book means — tap one to read it. ', auto ? 'The helper fills it from the pages as it reads them, each fact from the passage that says it; your own entries stand beside them. ' : 'The helper adds nothing to it just now — what it found stays with the passages that say it, and goes with them when they change; your own entries stand beside them. ', 'The notes say where everything stands now. The whole bibliography goes to the writer with every page while there is room beside the book; when there isn’t, what this page needs goes first — ', superActive() ? 'decided page by page by Super automatic: the entries named in your words or near the page, and those the page needs though nothing there names them (Smart recall: the helper brings them in before each page and each telling of a scene, eight seconds at most) — then as much of the rest as fits. Always waits until it is off, and Super automatic keeps both switches on.' : ['the entries set to Always and those named in your words or near the page', recall ? ' and, with Smart recall, those the page needs though nothing there names them (the helper brings them in before each page and each telling of a scene, eight seconds at most)' : '', ' — then as much of the rest as fits.'].join('')),
    h('label.toggle', h('input', { type: 'checkbox', checked: auto, disabled: superActive(), onchange: (e) => {
      store.change('novel', novelId, novelSteps.setPref('bibAuto', e.target.checked ? '' : 'off'), { now: true });
      if (e.target.checked) { archivist.nudge(novelId); toast('The helper fills the bibliography from the book — pages read before are filled in a few at a time.'); }
      redraw();
    } }), h('span', 'Fill it from the book by itself')),
    /* Cozy Tavern's Smart recall (M510-50), for the bibliography (bibpick.js) */
    h('label.toggle', h('input', { type: 'checkbox', checked: recall, disabled: superActive(), onchange: (e) => {
      store.change('novel', novelId, novelSteps.setPref('bibRecall', e.target.checked ? '' : 'off'), { now: true });
      redraw();
    } }), h('span', 'Smart recall')),
    h('label.toggle', h('input', { type: 'checkbox', checked: namesOn(), onchange: (e) => {
      const house = store.peek('house', 'house');
      if (house) store.change('house', 'house', (x) => { x.look = { ...(x.look || {}), names: e.target.checked ? 'on' : 'off' }; }, { now: true });
      redraw();
    } }), h('span', 'Tap names in the page'))));
  /* who fills it: the helper, when there is one and its model has the room (archivist.bibReading) */
  const helper = connFor(store.peek('house', 'house') || {}, 'helper');
  const can = auto && helper && archivist.bibReading(novel, helper);
  if (auto && !helper) root.append(h('p.notekey.bibdue', 'No helper is chosen, so nothing is filled from the book just now — choose one in Settings → Connections. Your own entries are kept.'));
  else if (auto && !can) root.append(h('p.notekey.bibdue', `The helper’s model holds too little to fill the bibliography beside the notes (it needs ${archivist.BIB_HELPER_MIN.toLocaleString()} tokens of room) — choose a helper with more room in Settings → Who does what. Your own entries are kept.`));
  const due = can && archivist.bibDue ? archivist.bibDue(novelId).length : 0;
  /* (every page it fills by itself said so — read before it was kept, read in parts, or left by a change's reading it
   * could not vouch for, 2.12.41: never "read before the bibliography was kept" for one read since) */
  if (due) root.append(h('p.notekey.bibdue', `${plural(due, 'page')} ${due === 1 ? 'is' : 'are'} not read for the bibliography yet — the helper reads ${due === 1 ? 'it' : 'them'} by itself, a few at a time.`));
  root.append(quickView(novelId, redraw));
  const q = filters.get(novelId) || '';
  if (items.length > 8 || q) {
    const input = h('input.bibfilter', { type: 'search', placeholder: 'Find a name…', 'aria-label': 'Find a name', value: q });
    input.addEventListener('input', () => { filters.set(novelId, input.value); drawList(); });
    root.append(input);
  }
  const listBox = h('div.biblist');
  root.append(listBox);
  const drawList = () => {
    const want = nameKey(filters.get(novelId) || '');
    const shown = want ? items.filter((it) => [it.name, ...(it.aka || [])].some((n) => nameKey(n).includes(want))) : items;
    listBox.replaceChildren();
    if (!items.length) {
      listBox.append(h('p.notes-empty', auto ? 'As the helper reads the book, the people, places and things it gives meaning to gather here.' : 'Your entries gather here.'));
      return;
    }
    for (const kind of ENTRY_KINDS) {
      const rows = shown.filter((it) => it.kind === kind);
      if (!rows.length) continue;
      const open = !folded(kind);
      const sec = h('section.notesec.bibsec' + (open ? '.open' : ''), { 'data-kind': kind });
      const head = h('button.sechead', { 'aria-expanded': String(open), onclick: () => { const now = sec.classList.toggle('open'); head.setAttribute('aria-expanded', String(now)); setFold(kind, !now); } },
        h('span.chev', icon('chev', 14)), h('h3', KIND_TITLE[kind]), h('span.count', String(rows.length)));
      const box = h('div.cards');
      for (const it of rows) {
        const tags = [];
        if (it.entry) tags.push(it.entry.by === 'partner' ? h('span.ctag.partner', 'your partner’s') : h('span.ctag.yours', 'yours'));
        /* (Super automatic sends each entry page by page: Always is not first while it is on) */
        if (it.entry && it.entry.rides === 'always' && !superActive()) tags.push(h('span.ctag', 'always'));
        if (it.entry && it.entry.rides === 'never') tags.push(h('span.ctag', 'only for you'));
        box.append(h('div.card.notecard.bibitem', { role: 'button', tabindex: 0, 'data-ref': it.ref, title: `Open ${it.name}`,
          onclick: () => showRef(novelId, it.ref),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showRef(novelId, it.ref); } } },
        h('div.nm', it.name, ...tags),
        it.line ? h('div.ab', it.line) : null,
        it.facts.length ? h('div.aka', `${plural(it.facts.length, 'fact')} from the book — first in ${it.facts[0].label.replace(/, passage \d+$/, '')}`) : null));
      }
      sec.append(head, box);
      listBox.append(sec);
    }
    if (want && !shown.length) listBox.append(h('p.notes-empty', 'No name here answers to that.'));
  };
  drawList();
  root.append(h('div.btnrow.bibactions',
    h('button.btn.small', { title: 'Write your own entry: what a name means, for you and for the writer.', onclick: () => editEntry(novelId, null) }, icon('plus', 14), 'Add an entry'),
    h('button.btn.small.quiet', { title: 'Adds the entries of a SillyTavern lorebook (World Info) or a character card’s book — a name already here is left as it is.', onclick: () => bringLorebook(novelId, redraw) }, 'Bring in a lorebook'),
    mine ? h('button.btn.small.quiet', { title: 'Your entries as a SillyTavern lorebook (World Info) file.', onclick: () => takeLorebook(novelId) }, 'Take it out as a lorebook') : null));
  const theirs = items.filter((it) => it.entry && it.entry.by === 'partner').length;
  root.append(h('p.notekey', `${plural(items.length, 'name')}${mine ? `, ${plural(mine, 'entry', 'entries')} of yours${theirs ? ` — ${theirs === mine ? (mine === 1 ? 'written' : 'all written') : `${theirs} written`} by your partner` : ''}` : ''}. Your partner can write entries too — ask it.`));
  return root;
}

/* ------------------------------------------------------------ Quick add */

/* QUICK ADD (2.12.37, quickadd.js): his world in his own words, held against the book first; what holds goes into the
 * bibliography at once, with Undo; what a page contradicts, or what cannot be, is said with where it stands and waits
 * for his word — answered in the same box. Asked of his partner's connection. */
const quickTyped = new Map();   /* novelId -> what he typed and has not sent */
const quickStale = new Map();   /* novelId -> the timer that draws a row asked elsewhere again once it falls silent */
const QUICK_SHOWN = 6;
const quickKey = (novelId) => `${novelId}:quick`;
/* what the box holds: what he typed in this window, else what was kept with the book's draft */
function quickBoxNow(novelId) {
  const kept = quickTyped.has(novelId) ? quickTyped.get(novelId) : (((store.peek('draft', novelId) || {}).entries || {})[quickKey(novelId)] || '');
  return typeof kept === 'string' ? kept : '';
}
/* WORDS PUT BACK IN THE BOX — before what it holds, never in place of it (2.12.40, the audit: what he typed while it
 * asked was written over by the words given back when the ask failed or was stopped, and by Ask again) */
function putInBox(novelId, words) {
  const back = String(words || '').trim();
  const now = quickBoxNow(novelId).trim();
  const next = !now || now === back || now.includes(back) ? (now || back) : !back || back.includes(now) ? back : `${back}\n\n${now}`;
  quickTyped.set(novelId, next);
  keepEntryDraft(novelId, quickKey(novelId), next.trim() ? next : undefined);
}
function quickView(novelId, redraw) {
  const novel = store.peek('novel', novelId);
  const log = quickLog(novel);
  const busy = quickBusy(novelId);
  const key = quickKey(novelId);
  const box = h('section.lightcard.quickadd', { 'aria-label': 'Quick add' });
  const head = h('div.quickhead', h('h3', 'Quick add'));
  if (log.length && !busy) head.append(h('button.btn.quiet.small', { title: 'Lets this Quick add conversation go — what went into the bibliography stays.', onclick: () => {
    const rows = clearQuick(novelId);
    redraw();
    undoToast('Quick add is cleared — your bibliography is as it was.', () => { putBackQuick(novelId, rows); redraw(); });
  } }, 'Clear'));
  box.append(head, h('p.notekey', 'Tell it what you want in your world — a council, a power and what it costs, a rule, a person. Your partner’s connection holds it against the book, your premises, your bibliography and the notes first: what holds goes into the bibliography at once, with Undo; what a page says otherwise, or what cannot be by your world’s rules, is said with where it stands and waits for your word — answer here.'));
  const helper = connFor(store.peek('house', 'house') || {}, 'partner');
  if (!helper) box.append(h('p.notekey.bibdue', 'No connection is chosen for your partner, so Quick add cannot ask — choose one in Settings → Connections.'));
  /* a row another window is asking: drawn again the moment it falls silent long enough to say its window closed */
  clearTimeout(quickStale.get(novelId));
  const silentIn = log.filter((r) => askingWhere(novelId, r) === 'elsewhere').map((r) => (r.beat || r.at || 0) + GONE_MS - Date.now());
  if (silentIn.length) quickStale.set(novelId, setTimeout(() => redraw(), Math.max(1000, Math.min(...silentIn) + 500)));
  if (log.length) {
    const list = h('div.quicklog');
    /* the newest, and any older one that still holds its Undo — an Undo kept is never one he cannot reach */
    const shown = log.filter((r, i) => i >= log.length - QUICK_SHOWN || [...(r.added || []), ...(r.book || [])].some((a) => a && a.status === 'made' && a.change));
    if (log.length > shown.length) list.append(h('p.notekey', `${plural(log.length - shown.length, 'earlier one')} kept, not shown — Clear lets them go.`));
    for (const r of shown) list.append(quickRow(novelId, r, redraw));
    box.append(list);
  }
  const ta = h('textarea.quickbox', { rows: 3, 'aria-label': 'What to add to your world', placeholder: log.length ? 'Answer it, or add more to your world…' : 'Sanguelis is the council of the elder vampire families…' });
  ta.value = quickBoxNow(novelId);
  ta.addEventListener('input', () => { quickTyped.set(novelId, ta.value); keepEntryDraft(novelId, key, ta.value.trim() ? ta.value : undefined); });
  const send = async () => {
    const words = ta.value.trim();
    if (!words) { toast('Write what you want in your world first.'); return; }
    quickTyped.delete(novelId);
    keepEntryDraft(novelId, key, undefined);
    ta.value = '';
    const live = hooks.chapterNow ? hooks.chapterNow() : '';
    const out = await quickAdd({ novelId, chapterId: live, words });
    /* not checked: his words back in the box, as he typed them — before anything he typed while it asked */
    if (!out.ok && out.giveBack) putInBox(novelId, out.giveBack);
    if (!out.ok && out.error && !out.row) toast(`Quick add could not ask: ${out.error}.`, 6000);
    redraw();
    const made = out.ok ? (out.row.added || []).filter((a) => a.status === 'made') : [];
    if (made.length) undoToast(`${made.map((a) => a.name).join(', ')} — in the bibliography.`, () => { const back = undoQuick(novelId, out.row.id); if (back.said.length) toast(back.said.join(' · '), 6000); redraw(); });
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!quickBusy(novelId)) send(); } });
  const row = h('div.btnrow.quickactions');
  if (busy) row.append(h('button.btn.small', { title: 'Stops the check — nothing goes in, and your words come back to the box.', onclick: () => stopQuick(novelId) }, 'Stop'));
  else row.append(h('button.btn.primary.small', { title: 'Holds your words against the book, your premises, your bibliography and the notes, then puts what holds into the bibliography, with Undo.', disabled: !helper, onclick: send }, 'Check and add'));
  box.append(ta, row);
  return box;
}
/* one of his Quick adds and what came of it — every line of it what happened (2.12.40, the audit) */
const listed = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
function quickRow(novelId, r, redraw) {
  const row = h('div.quickrow', { 'data-id': r.id });
  row.append(h('p.quick-mine', r.said));
  const again = () => h('button.btn.small.quiet', { title: 'Puts these words back in the box, before anything you have typed there, to send again.', onclick: () => { putInBox(novelId, r.said); redraw(); requestAnimationFrame(() => document.querySelector('.bibview .quickbox')?.focus()); } }, 'Ask again');
  /* being asked: here, or in another window — never "stopped" while it still asks */
  const where = askingWhere(novelId, r);
  if (where === 'here') { row.append(h('p.quick-wait', h('span.ring', { 'aria-hidden': 'true' }), 'Holding it against the book…')); return row; }
  if (where === 'elsewhere') { row.append(h('p.quick-wait', h('span.ring', { 'aria-hidden': 'true' }), 'Being checked in another window…')); return row; }
  if (where === 'gone') { row.append(h('p.notekey', 'Not checked — its window closed before it answered. Nothing went in.'), h('div.btnrow', again())); return row; }
  if (r.state === 'stopped') { row.append(h('p.notekey', 'Not checked — it was stopped before it finished. Nothing went in.'), h('div.btnrow', again())); return row; }
  if (r.state === 'failed') { row.append(h('p.notekey.bibdue', `Not checked — ${r.error || 'no answer came'}. Nothing went in.`), h('div.btnrow', again())); return row; }
  if (r.verdict) row.append(h('p.quick-verdict', r.verdict));
  const go = (x) => (x.chapterId && x.passageId && hooks.whenOpen ? h('button.link', { title: 'Go to the passage, its words lit.', onclick: () => { if (hooks.closeSide) hooks.closeSide(); hooks.whenOpen(x.chapterId, { passageId: x.passageId, show: { query: x.against || x.rule || '' } }); } }, x.label) : h('span', x.label));
  const section = (title, items, cls = '') => h('div.quick-sec' + cls, h('h4', title), h('ul', ...items));
  const added = r.added || [];
  const book = r.book || [];
  if (added.length) {
    const live = new Set(entriesOf(store.peek('novel', novelId)).map((e) => e.id));
    const how = (a) => (a.status === 'undone' ? ' — taken back out'
      : !a.was ? ''
        : a.how === 'whole' ? ' — your entry, written again with what you said'
          : a.addedWhy ? ` — your entry, added to: ${a.addedWhy}, so only what is new went in` : ' — your entry, added to');
    row.append(section('Into the bibliography', added.map((a) => h('li' + (a.status === 'undone' ? '.undone' : ''),
      a.status !== 'undone' && live.has(a.entryId) ? h('button.link', { title: `Open ${a.name}.`, onclick: () => showRef(novelId, `e:${a.entryId}`) }, a.name) : h('span', a.name),
      how(a)))));
  }
  if ([...added, ...book].some((a) => a.status === 'made' && a.change)) row.append(h('div.btnrow', h('button.btn.small.quiet', { title: 'Takes back out what this answer put in — its entries, and your book’s words as they were — anything changed since stays as it is.', onclick: () => { const back = undoQuick(novelId, r.id); if (back.said.length) toast(back.said.join(' · '), 6000); else if (back.back) toast('Taken back out.'); redraw(); } }, 'Undo these')));
  /* its Undo let go: said, never just gone (the newest that put something in keep theirs) */
  if ([...added, ...book].some((a) => a.status === 'kept')) row.append(h('p.notekey', 'Its Undo is let go — the four newest Quick adds that put something in keep theirs. What went in stays; open an entry to change it.'));
  if ((r.held || []).length) row.append(section('Held back — waiting for your word', [h('li', h('b', listed(r.held)), ' — what it wrote may say what the book says otherwise (below), and asked to write it again without that, it gave no answer that could be read. Send your words again.')], '.wait'));
  if ((r.refused || []).length) row.append(section('Not put in', r.refused.map((x) => h('li', h('b', x.name), ` — ${x.why}`))));
  if ((r.changes || []).length) {
    row.append(section('It changes your earlier words', r.changes.map((x, i) => {
      const kids = [h('span', `“${x.mine}”`), ' — ', h('span', x.label), ` said “${x.was}”`];
      /* his premise is his record of what he asked for that passage: never written again — his newer word stands over it */
      if (x.kind === 'premise') kids.push(' — your newer word stands over it.');
      if (x.kind === 'about') {
        const b = book.find((y) => y.at === i);
        kids.push(!b ? ' — it still says it.'
          : b.status === 'made' || b.status === 'kept' ? `; it says “${b.now}” now.`
            : b.status === 'undone' ? ' — put back as it was.'
              : ` — it still says it: ${b.why}.`);
      }
      /* (it held this back as the book saying otherwise, and asked again it gave no answer) */
      if (x.said !== 'changes' && r.again === 'failed') kids.push(' It held this back, as if a page said otherwise — send it again to put it in.');
      if (x.why) kids.push(h('span.quick-why', ` ${x.why}`));
      return h('li', ...kids);
    })));
  }
  if ((r.conflicts || []).length) row.append(section('The book says otherwise — waiting for your word', r.conflicts.map((x) => h('li', h('span', `“${x.mine}”`), ' — ', go(x), ` says “${x.against}”`, x.why ? h('span.quick-why', ` ${x.why}`) : null)), '.wait'));
  if ((r.cannot || []).length) row.append(section('Cannot be, by your world’s rules — waiting for your word', r.cannot.map((x) => h('li', h('span', `“${x.mine}”`), ' — ', go(x), `: “${x.rule}”`, x.why ? h('span.quick-why', ` ${x.why}`) : null)), '.wait'));
  if ((r.questions || []).length) row.append(section('For you to decide', r.questions.map((q) => h('li', q))));
  /* what it set against your words with words that stand nowhere — each said, and what came of it */
  const aside = Array.isArray(r.aside) ? r.aside : [];
  if (aside.length) {
    const tail = r.again === 'answered' ? ', so yours were not held back for them.' : r.again === 'failed' ? ' — asked again to put yours in, it gave no answer that could be read; send it again.' : '.';
    row.append(section('Set aside', aside.map((x) => h('li', h('span', `“${x.mine}”`), ` — it said ${x.where || 'the book'} says “${x.quote}”, but ${x.only ? `those words stand only in ${x.only}, not on a page or in your own words` : 'those words stand nowhere in the book or your own words'}${tail}`))));
  }
  /* (a row kept from before 2.12.40 counted them) */
  if (typeof r.aside === 'number' && r.aside > 0) row.append(h('p.notekey', `${plural(r.aside, 'more thing it named', 'more things it named')} quoted words that stand nowhere in the book or your own words — set aside.`));
  if (!added.length && !book.length && !(r.held || []).length && !(r.conflicts || []).length && !(r.cannot || []).length && !(r.changes || []).length && !(r.refused || []).length && !(r.questions || []).length && !aside.length) row.append(h('p.notekey', 'Nothing went in — it gave no entries.'));
  return row;
}

async function bringLorebook(novelId, redraw) {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let rows = [];
  try { rows = entriesFromLorebook(await file.text()); } catch (_) { rows = []; }
  if (!rows.length) { toast('That file holds no lorebook entries this can read — a SillyTavern World Info file, or a character card with a book.', 6000); return; }
  /* every name taken, once (a lorebook of thousands: a name looked up among all the others each time took seconds) */
  const taken = new Set();
  for (const e of entriesOf(store.peek('novel', novelId))) for (const x of [e.name, ...(e.aka || [])]) taken.add(nameKey(x));
  const fresh = [];
  for (const r of rows) {
    /* its own name taken: left out; another name it goes by taken: it comes in without that one */
    if (taken.has(nameKey(r.name))) continue;
    const aka = (r.aka || []).filter((x) => !taken.has(nameKey(x)));
    for (const x of [r.name, ...aka]) taken.add(nameKey(x));
    fresh.push({ ...r, aka, by: 'you', at: Date.now() });
  }
  const left = rows.length - fresh.length;
  if (!fresh.length) { toast(`Every name in it is in the bibliography already (${plural(rows.length, 'entry', 'entries')}) — nothing was added.`, 6000); return; }
  if (!(await confirmIt('Bring in this lorebook?', `${plural(fresh.length, 'entry', 'entries')} from ${file.name} go into the bibliography, each riding as the lorebook had it (always, when named, or switched off).${left ? ` ${plural(left, 'entry', 'entries')} whose names are here already ${left === 1 ? 'is' : 'are'} left out.` : ''}`, 'Bring them in'))) return;
  for (const e of fresh) store.change('novel', novelId, novelSteps.putEntry(e), { now: true });
  archivist.nudge(novelId);
  redraw();
  undoToast(`${plural(fresh.length, 'entry', 'entries')} brought in.`, () => { for (const e of fresh) store.change('novel', novelId, novelSteps.dropEntry(e.id), { now: true }); archivist.nudge(novelId); redraw(); });
}

function takeLorebook(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const title = (novel.meta && novel.meta.title) || 'Book';
  download(`${slug(title)}-bibliography.json`, JSON.stringify(lorebookOf(entriesOf(novel), `${title} — bibliography`), null, 2), 'application/json');
}

