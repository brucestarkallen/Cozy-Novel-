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
import { bibItems, itemForms, nameForms, makeFinder, formKey, codexNow, ENTRY_KINDS, KIND_TITLE, RIDES, RIDES_WORDS, newEntry, tidyEntry, entriesOf, nameTaken, entriesFromLorebook, lorebookOf } from '../novel/bibliography.js';
import { bibAutoOn } from '../novel/context.js';
import { nowLabelOf } from '../novel/prompts.js';
import { plural, nameKey, slug } from '../util.js';
import * as archivist from '../novel/archivist.js';
import { connFor } from '../novel/writer.js';

/* app.js: closeSide (the notes drawer on a phone), showCard (a card of the
 * notes), whenOpen (a passage, its words lit), openSearch (every place) */
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

function showRefs(novelId, refs, { said = '' } = {}) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const chapters = chaptersOf(novel);
  const items = bibItems(novel, chapters, { facts: true });
  const byRef = new Map(items.map((it) => [it.ref, it]));
  const rows = [];
  for (const ref of refs) {
    const it = byRef.get(ref) || null;
    const m = /^c:(people|places|lore):(.+)$/.exec(ref);
    const card = m ? ((novel.notes || {})[m[1]] || []).find((c) => c.id === m[2]) || null : null;
    if (!it && !card) continue;
    rows.push({ it, card, cardKind: m ? m[1] : (it && it.card ? it.card.kind : '') });
  }
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
  if (entry) box.append(h('p.namecard-note', entry.rides === 'always' ? 'Your entry — the writer always reads it.' : entry.rides === 'never' ? 'Your entry — only for you; the writer never reads it.' : `Your entry — the writer reads it when ${name} comes up.`));
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
  row.append(h('button.btn.small', { title: entry ? 'Change your entry — the book’s facts and the notes stay as they are.' : `Write your own entry for ${name}: what it means, for the writer to read when ${name} comes up.`, onclick: () => { close(); editEntry(novelId, entry ? entry.id : null, { name, kind }); } }, entry ? 'Edit your entry' : 'Write your entry'));
  if (card && hooks.showCard) row.append(h('button.btn.small.quiet', { title: 'Opens the card in the notes, to read or edit it.', onclick: () => { close(); hooks.showCard(cardKind, card.id); } }, 'Open the card'));
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
  const ridesBox = h('select', { 'aria-label': 'The writer reads it' }, ...RIDES.map((r) => h('option', { value: r, selected: e.rides === r }, RIDES_WORDS[r])));
  const boxes = { name: nameBox, aka: akaBox, kind: kindBox, line: lineBox, text: textBox, rides: ridesBox };
  const opened = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.value]));
  if (draft) { for (const [k, v] of Object.entries(draft)) if (boxes[k]) boxes[k].value = v; s.body.append(h('p.say', 'Your words from before, not saved yet, are back.')); }
  s.body.append(field('Name', nameBox));
  s.body.append(field('Also called', akaBox, 'Other names, separated by commas — the page marks them too.'));
  s.body.append(field('What it is', kindBox));
  s.body.append(field('In a line', lineBox));
  s.body.append(field('The entry', textBox, 'What it means — for you to read when you tap the name, and for the writer as background. People in the story still know only what they have lived.'));
  s.body.append(field('The writer reads it', ridesBox, 'When its name comes up keeps the request small; Always for what every page needs; Never keeps it for you alone.'));
  const typed = () => Object.fromEntries(Object.keys(boxes).filter((k) => boxes[k].value !== opened[k]).map((k) => [k, boxes[k].value]));
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
    keepEntryDraft(novelId, draftKey, undefined);
    done = true;
    s.close();
    toast(cur ? 'Your entry is changed.' : 'Your entry is in the bibliography.');
  } }, 'Save'));
  if (cur) row.append(h('button.btn.danger', { onclick: async () => {
    if (!(await confirmIt('Take this entry out?', `${cur.name} goes from the bibliography — what the book itself tells of it stays.`, 'Take it out', { danger: true }))) return;
    const before = entriesOf(store.peek('novel', novelId)).find((x) => x.id === cur.id);
    store.change('novel', novelId, novelSteps.dropEntry(cur.id), { now: true });
    keepEntryDraft(novelId, draftKey, undefined);
    done = true;
    s.close();
    if (before) undoToast(`${cur.name} is out of the bibliography.`, () => store.change('novel', novelId, novelSteps.entryBack(before.id, before, null), { now: true }));
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
  return JSON.stringify([novel.bibliography || [], novel.notes || {}, (novel.prefs || {}).bibAuto || '', lookOf().names || '', namesPrint(novel, chapters), archivist.bibDue ? archivist.bibDue(novelId).length : 0]);
}

export function bibliographyView(novelId, { redraw = () => {} } = {}) {
  const novel = store.peek('novel', novelId);
  const root = h('div.bibview');
  if (!novel) return root;
  const auto = bibAutoOn(novel);
  /* what the helper found stays with its passages whether or not it goes on filling it */
  const items = bibItems(novel, chaptersOf(novel), { facts: true });
  const mine = items.filter((it) => it.entry).length;
  root.dataset.count = plural(items.length, 'name');
  root.append(h('div.lightcard.bibintro',
    h('p.notekey', 'What each name in the book means — tap one to read it. ', auto ? 'The helper fills it from the pages as it reads them, each fact from the passage that says it; your own entries stand beside them. ' : 'The helper adds nothing to it just now — what it found stays with the passages that say it, and goes with them when they change; your own entries stand beside them. ', 'The notes say where everything stands now; the writer reads an entry here only when its name comes up.'),
    h('label.toggle', h('input', { type: 'checkbox', checked: auto, onchange: (e) => {
      store.change('novel', novelId, novelSteps.setPref('bibAuto', e.target.checked ? '' : 'off'), { now: true });
      if (e.target.checked) { archivist.nudge(novelId); toast('The helper fills the bibliography from the book — pages read before are filled in a few at a time.'); }
      redraw();
    } }), h('span', 'Fill it from the book by itself')),
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
  if (due) root.append(h('p.notekey.bibdue', `${plural(due, 'page')} read before the bibliography was kept — the helper fills ${due === 1 ? 'it' : 'them'} in a few at a time.`));
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
        if (it.entry) tags.push(h('span.ctag.yours', 'yours'));
        if (it.entry && it.entry.rides === 'always') tags.push(h('span.ctag', 'always'));
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
  root.append(h('p.notekey', `${plural(items.length, 'name')}${mine ? `, ${plural(mine, 'entry', 'entries')} of yours` : ''}. Your partner can write entries too — ask it.`));
  return root;
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
  redraw();
  undoToast(`${plural(fresh.length, 'entry', 'entries')} brought in.`, () => { for (const e of fresh) store.change('novel', novelId, novelSteps.dropEntry(e.id), { now: true }); redraw(); });
}

function takeLorebook(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const title = (novel.meta && novel.meta.title) || 'Book';
  download(`${slug(title)}-bibliography.json`, JSON.stringify(lorebookOf(entriesOf(novel), `${title} — bibliography`), null, 2), 'application/json');
}

