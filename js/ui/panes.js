/* Cozy Novel — js/ui/panes.js — beside the page: the chapters, the notes the
 * helper keeps, the partner, and playing a scene. Drawers on a phone,
 * columns on a wide screen. */

import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as archivist from '../novel/archivist.js';
import * as talk from '../novel/talk.js';
import { h, icon, toast, undoToast, menu, openSheet, confirmIt, askText, autoGrow, copyText, field, onBack } from './dom.js';
import { picked, chapterSteps, novelSteps, chapterWords, chapterLabel, newCard, NOTE_KINDS, turnSteps } from '../novel/shape.js';
import { numberWords, plural, timeAgo, nameKey } from '../util.js';
import { showSent } from './sent.js';
import { thinkBox, updateThinkBox } from './think.js';
import { wordsOf, changesComing, editableOf, partsOf } from '../novel/changes.js';
import { enterFull, leaveFull, fullKind } from './full.js';
import { paced, follower, streamLines } from './live.js';
import { drawProse, growProse } from './prose.js';
import * as desk from './desk.js';
import { sceneWords, choicesIn } from '../novel/prompts.js';

let ui = null;
let hooks = {};
let SF = null;           /* the follow law beside the page (live.js) */
const P = { novelId: null, chapterId: null, side: 'notes', playId: null, offs: [], watched: new Set(), leftOpen: false, rightOpen: false, release: { left: null, right: null },
  shownView: '',    /* the view last drawn beside the page (sideView) */
  drawn: '',        /* the conversation it was drawn from (turnsSig) */
  liveTurn: null }; /* the reply being written here, whose newest words the pane follows */

export function initPanes(elements, appHooks) {
  ui = elements;
  hooks = appHooks;
  ui.scrim.addEventListener('click', () => { closeLeft(); closeRight(); });
  for (const b of ui.tabs.querySelectorAll('button')) b.addEventListener('click', () => { P.side = b.dataset.tab; drawSide(); });
  archivist.onLight((novelId) => { if (novelId === P.novelId) { drawLight(); if (P.side === 'notes') drawSide(); } });
  SF = follower(ui.rightBody, { tail: sideTail });
  talk.onTalkLive(onTalkLive);
  /* a reply asked for: the pane follows it in, until his hand moves it up */
  talk.onTalkJob((key, job) => { if (job) SF.start(); if (P.side === 'partner' || P.side === 'play') drawSide(); });
  window.addEventListener('resize', dockWide);
}

const wide = () => window.matchMedia('(min-width: 1180px)').matches;
/* how this browser left its columns and folds — a private window may refuse
 * to keep them, and then they last for this visit */
function kept(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function keep(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* this visit only */ } }

export function openPanes(novelId, chapterId) {
  for (const off of P.offs) off();
  P.offs = [];
  P.watched = new Set();
  if (P.novelId !== novelId) { P.playId = null; }
  P.novelId = novelId;
  P.chapterId = chapterId;
  P.offs.push(store.subscribe('novel', novelId, () => { drawChapters(); if (P.side === 'notes') drawSide(); drawLight(); }));
  dockWide();
  drawChapters();
  drawSide();
  drawLight();
}

let chFrame = 0;
function drawChaptersSoon() { if (!chFrame) chFrame = requestAnimationFrame(() => { chFrame = 0; drawChapters(); }); }

function dockWide() {
  const w = wide();
  ui.left.classList.toggle('dock', w && kept('cozynovel.left') !== 'off');
  ui.right.classList.toggle('dock', w && kept('cozynovel.right') === 'on');
  /* wide enough for columns: a drawer open from the narrow screen closes (its Back step with it) */
  if (w) { closeLeft(); closeRight(); ui.scrim.classList.remove('on'); }
  mirrorDock();
}

/* the desk knows which columns stand beside the page, so the box he types in
 * sits under the page and not under a column */
function mirrorDock() {
  const deskEl = document.getElementById('desk');
  if (!deskEl) return;
  deskEl.classList.toggle('dock-left', ui.left.classList.contains('dock'));
  deskEl.classList.toggle('dock-right', ui.right.classList.contains('dock'));
}

/* ------------------------------------------------------- opening and closing */

export function toggleLeft() {
  if (wide()) {
    const on = !ui.left.classList.contains('dock');
    ui.left.classList.toggle('dock', on);
    keep('cozynovel.left', on ? 'on' : 'off');
    mirrorDock();
    return;
  }
  if (P.leftOpen) closeLeft(); else openLeft();
}
function openLeft() {
  closeRight();
  P.leftOpen = true;
  ui.left.classList.add('open');
  ui.scrim.classList.add('on');
  drawChapters();
  P.release.left = onBack(() => closeLeft(true));
}
export function closeLeft(fromBack = false) {
  if (!P.leftOpen) return;
  P.leftOpen = false;
  ui.left.classList.remove('open');
  if (!P.rightOpen) ui.scrim.classList.remove('on');
  if (!fromBack && P.release.left) P.release.left();
  P.release.left = null;
}
export function showSide(tab) {
  P.side = tab;
  if (wide()) {
    if (ui.right.classList.contains('dock') && ui.right.dataset.tab === tab) {
      ui.right.classList.remove('dock');
      keep('cozynovel.right', 'off');
      mirrorDock();
      return;
    }
    ui.right.classList.add('dock');
    keep('cozynovel.right', 'on');
    mirrorDock();
    drawSide();
    return;
  }
  closeLeft();
  if (!P.rightOpen) {
    P.rightOpen = true;
    ui.right.classList.add('open');
    ui.scrim.classList.add('on');
    P.release.right = onBack(() => closeRight(true));
  }
  drawSide();
}
/* the side open on a tab, never toggled shut (a search result, a link) */
function ensureSide(tab) {
  if (wide() && ui.right.classList.contains('dock') && ui.right.dataset.tab === tab) { P.side = tab; drawSide(); return; }
  showSide(tab);
}
/* a card of the notes, open to read (search) */
export function showCard(kind, id) {
  ensureSide('notes');
  const n = store.peek('novel', P.novelId);
  if (n && ((n.notes && n.notes[kind]) || []).some((c) => c.id === id)) editCard(kind, id);
}
/* a turn of the conversation or of a scene, scrolled to and lit for a moment */
export function showTurn(kind, id, turnId) {
  if (kind === 'play') P.playId = id;
  ensureSide(kind === 'play' ? 'play' : 'partner');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = ui.rightBody.querySelector(`.turn[data-id="${turnId}"]`);
    if (!el) return;
    SF.stop();
    const top = el.getBoundingClientRect().top - ui.rightBody.getBoundingClientRect().top + ui.rightBody.scrollTop;
    SF.jump(Math.max(0, top - ui.rightBody.clientHeight * 0.25));
    el.classList.remove('found');
    void el.offsetWidth;
    el.classList.add('found');
    setTimeout(() => el.classList.remove('found'), 4000);
  }));
}
export function closeRight(fromBack = false) {
  if (!P.rightOpen) return;
  if (fullKind() === 'scene' || fullKind() === 'partner') leaveFull();
  P.rightOpen = false;
  ui.right.classList.remove('open');
  if (!P.leftOpen) ui.scrim.classList.remove('on');
  if (!fromBack && P.release.right) P.release.right();
  P.release.right = null;
}

/* ------------------------------------------------------------ chapters */

function drawChapters() {
  const n = store.peek('novel', P.novelId);
  if (!n || !ui) return;
  /* every chapter in the list is watched — one that joined the book since it was opened too */
  for (const id of n.order || []) {
    if (P.watched.has(id)) continue;
    P.watched.add(id);
    P.offs.push(store.subscribe('chapter', id, () => drawChaptersSoon()));
  }
  ui.leftBody.textContent = '';
  const list = h('ol.chlist');
  n.order.forEach((id, i) => {
    const c = store.peek('chapter', id);
    const words = c ? chapterWords(c) : 0;
    const li = h('li' + (id === P.chapterId ? '.on' : ''),
      h('button.go', { onclick: () => { closeLeft(); hooks.goChapter(id); } },
        h('span.n', `Chapter ${numberWords(i + 1)}`),
        c && c.name ? h('span.nm', c.name) : h('span.nm', { style: { fontStyle: 'italic', opacity: '.75' } }, words ? openingOf(c) : 'Not begun'),
        h('span.w', plural(words, 'word')),
        c && c.summary && c.summary.text ? h('span.sum', c.summary.text) : null),
      h('button.menu', { 'aria-label': 'More for this chapter', onclick: (e) => chapterMenu(e.currentTarget, id, i) }, icon('more', 18)));
    list.append(li);
  });
  ui.leftBody.append(list,
    h('div.btnrow', { style: { marginTop: '12px' } }, h('button.btn', { onclick: () => { closeLeft(); desk.newChapterAfter(n.order[n.order.length - 1]); } }, icon('plus', 16), 'New chapter')));
  const words = n.order.reduce((a, id) => a + chapterWords(store.peek('chapter', id) || { passages: [] }), 0);
  ui.leftBody.append(h('p.hint', { style: { textAlign: 'center', marginTop: '14px' } }, `${plural(n.order.length, 'chapter')} · ${plural(words, 'word')} in all`));
  ui.leftTitle.textContent = 'Chapters';
}

/* an unnamed chapter is known by its first words */
function openingOf(c) {
  for (const p of c.passages || []) {
    if (p.by === 'break') continue;
    const t = String((picked(p) || {}).text || '').replace(/[*_#]/g, '').replace(/\s+/g, ' ').trim();
    if (t) return t.length > 54 ? t.slice(0, 54).replace(/\s+\S*$/, '') + '\u2026' : t;
  }
  return '';
}

function chapterMenu(anchor, id, i) {
  const n = store.peek('novel', P.novelId);
  const c = store.peek('chapter', id);
  menu(anchor, [
    { label: 'Name it', hint: 'A name of yours stays: the helper never renames it.', run: async () => {
      const name = await askText('Name the chapter', { value: (c && c.name) || '', placeholder: 'A short name', yes: 'Name it' });
      if (name === null) return;
      /* cleared by him: it stays without a name (the helper does not name it again) */
      store.change('chapter', id, chapterSteps.setName(name.trim().slice(0, 120), 'you'), { now: true });
    } },
    i > 0 ? { label: 'Move it earlier', hint: 'One place up the book.', run: () => { store.change('novel', P.novelId, novelSteps.moveChapter(id, i - 1), { now: true }); } } : null,
    i < n.order.length - 1 ? { label: 'Move it later', hint: 'One place down the book.', run: () => { store.change('novel', P.novelId, novelSteps.moveChapter(id, i + 1), { now: true }); } } : null,
    { label: 'Earlier copies of this chapter', hint: 'Bring the chapter back as it was at an earlier time.', run: () => earlierCopies(id) },
    c && c.summary && c.summary.text ? { label: 'Its summary', hint: 'What rides for this chapter once the book is longer than the model holds.', run: () => { const s = openSheet(chapterLabel(n, c)); s.body.append(h('p', { style: { lineHeight: '1.6', whiteSpace: 'pre-wrap' } }, c.summary.text)); } } : null,
    '-',
    n.order.length > 1 ? { label: 'Remove the chapter', hint: 'To Recently deleted for thirty days.', danger: true, run: () => removeChapter(id) } : null,
  ]);
}

async function removeChapter(id) {
  const n = store.peek('novel', P.novelId);
  const c = store.peek('chapter', id);
  const words = c ? chapterWords(c) : 0;
  if (!(await confirmIt('Remove this chapter?', `${chapterLabel(n, c)}${words ? ` and its ${plural(words, 'word')}` : ''} go to Recently deleted (Settings → Backups) for thirty days.`, 'Remove it', { danger: true }))) return;
  archivist.retireChapter(P.novelId, c);
  const i = n.order.indexOf(id);
  store.change('novel', P.novelId, novelSteps.removeChapter(id), { now: true });
  await store.flush('novel', P.novelId);
  await store.remove('chapter', id).catch(() => {});
  archivist.nudge(P.novelId);
  writer.recount(P.novelId);
  if (id === P.chapterId) hooks.goChapter(n.order[Math.max(0, Math.min(i, n.order.length - 1))]);
  else drawChapters();
}

async function earlierCopies(id) {
  const n = store.peek('novel', P.novelId);
  const c = store.peek('chapter', id);
  const s = openSheet('Earlier copies');
  s.body.append(h('p.say', `${chapterLabel(n, c)} as it stood before each change — the newest eight, then one an hour for two days, then one a day for a month.`));
  const { status, data } = await store.api('GET', `/api/history/chapter/${id}`).catch(() => ({ status: 0 }));
  if (status !== 200 || !data || !data.copies.length) { s.body.append(h('p.say', 'No earlier copies yet.')); return; }
  const list = h('ul.list');
  for (const row of data.copies) {
    list.append(h('li', h('div.grow', new Date(row.at).toLocaleString(), h('small', timeAgo(row.at))),
      h('button.btn.small', { onclick: async () => {
        const got = await store.api('GET', `/api/history/chapter/${id}/${row.stamp}`);
        if (got.status !== 200 || !got.data || !got.data.data) { toast('That copy could not be read.'); return; }
        const old = got.data.data;
        if (!(await confirmIt('Bring this copy back?', `The chapter goes back to how it was ${timeAgo(row.at)} (${plural(chapterWords(old), 'word')}). How it is now is kept as an earlier copy too.`, 'Bring it back'))) return;
        /* what the helper had read that this changes is kept for it, so the notes follow the book back */
        archivist.retireBeforeReplace(P.novelId, id, old.passages || []);
        store.change('chapter', id, (d) => { d.passages = JSON.parse(JSON.stringify(old.passages || [])); d.name = old.name || ''; d.nameBy = old.nameBy || ''; }, { now: true });
        archivist.nudge(P.novelId);
        writer.recount(P.novelId);
        s.close();
        toast('The chapter is back as it was.');
      } }, 'Bring back')));
  }
  s.body.append(list);
}

/* --------------------------------------------------------------- light */

/* the helper's light rides on the Notes button */
function drawLight() {
  const l = archivist.lightOf(P.novelId);
  ui.light.dataset.state = l.state;
  ui.light.title = `Notes — ${l.words}`;
  ui.light.setAttribute('aria-label', `Notes — ${l.words}`);
}

/* --------------------------------------------------------------- side */

/* what he is typing beside the page survives the pane being drawn again */
const typed = { key: '', value: '', focus: false };
function keepTyped() {
  const ta = ui.rightFoot.querySelector('textarea');
  if (!ta) return;
  const key = ui.rightFoot.dataset.for || '';
  /* the line to the narrator, and whether its box was open, ride with the scene's own box */
  const tb = ui.rightFoot.querySelector('textarea.tellbox');
  if (typed.key !== key) { typed.tell = ''; typed.tellOpen = false; }
  typed.key = key;
  typed.value = ta.value;
  typed.focus = document.activeElement === ta;
  if (tb) { typed.tell = tb.value; typed.tellOpen = !tb.hidden; }
}
export function restoreTyped(key) {
  ui.rightFoot.dataset.for = key;
  const ta = ui.rightFoot.querySelector('textarea');
  if (!ta || typed.key !== key) return;
  if (typed.value && !ta.value) { ta.value = typed.value; ta.dispatchEvent(new Event('input')); }
  if (typed.focus) ta.focus({ preventScroll: true });
}

function drawSide() {
  if (!ui) return;
  /* full screen belongs to a scene: anything else beside the page goes back to its column */
  if (fullKind() === 'scene' && !(P.side === 'play' && P.playId)) leaveFull();
  if (fullKind() === 'partner' && P.side !== 'partner') leaveFull();
  keepTyped();
  /* the notes drawn again (the helper read something) stay where he had scrolled them */
  const scroll = ui.right.dataset.tab === P.side && P.side === 'notes' ? ui.rightBody.scrollTop : 0;
  /* and a conversation drawn again keeps his place too, unless he is with its newest words */
  sideKeep = { view: P.shownView, top: ui.rightBody.scrollTop };
  P.shownView = sideView();
  for (const b of ui.tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === P.side));
  ui.right.dataset.tab = P.side;
  ui.rightBody.textContent = '';
  ui.rightFoot.textContent = '';
  ui.rightFoot.hidden = true;
  if (P.side === 'notes') { drawNotes(); ui.rightBody.scrollTop = scroll; }
  else if (P.side === 'partner') drawPartner();
  else drawPlay();
}

/* ---------------------------------------------------------------- notes */

const KIND_TITLE = { people: 'People', places: 'Places', lore: 'Things worth remembering', threads: 'Threads' };

function drawNotes() {
  const n = store.peek('novel', P.novelId);
  if (!n) return;
  const l = archivist.lightOf(P.novelId);
  const card = h('div.lightcard', l.words);
  const row = h('div.row');
  const u = n.memory && n.memory.undo;
  if (u && ((Array.isArray(u.cards) ? u.cards.length : u.notes) || (u.kept && Object.keys(u.kept).length))) row.append(h('button.btn.small', { title: 'Puts back only what the helper’s last reading changed — a card you edited since stays as you left it.', onclick: () => { if (archivist.undoLast(P.novelId)) toast('What that reading changed is put back — anything you edited since stays as you left it.'); drawSide(); } }, 'Undo the last reading'));
  /* the auditor: the whole notes held against the book as it stands */
  const au = (n.memory && n.memory.audit) || null;
  row.append(h('button.btn.small', { title: `The helper holds every card against the book as it stands and puts right what an old version left or what drifted — your own words stay. It does this by itself every ${archivist.AUDIT_EVERY} readings${au && au.at ? `; last ${timeAgo(au.at)}${Number.isFinite(au.fixed) ? `, ${plural(au.fixed, 'card')} put right` : ''}` : ''}.`, disabled: Boolean(n.memory && n.memory.auditAsked), onclick: () => { archivist.askAudit(P.novelId); toast('The helper is checking the notes against the book.'); drawSide(); } }, n.memory && n.memory.auditAsked ? 'Checking the notes…' : 'Check the notes against the book'));
  row.append(h('button.btn.quiet.small', { title: 'The helper reads every chapter from the start and writes the notes and summaries afresh.', onclick: async () => {
    if (!(await confirmIt('Read the whole book again?', 'The helper reads every chapter from the start and writes the notes and summaries afresh — and, for a book set to Automatic, What it’s about and How it reads (never your own words, nor a correction of yours). What is there now can be put back with Undo.', 'Read it again'))) return;
    archivist.readAgain(P.novelId);
    drawSide();
  } }, 'Read the whole book again'));
  card.append(row);
  /* what the light on a card means — every card is sent, lit or not */
  const lit = (n.memory && n.memory.lit) || (u && u.changed && u.changed.length ? { at: u.at, label: u.label, changed: u.changed } : null);
  const how = new Map((lit && lit.changed || []).map((c) => [c.kind + ':' + nameKey(c.name), c.how]));
  const gone = (lit && lit.changed || []).filter((c) => c.how === 'gone').map((c) => c.name);
  card.append(h('p.notekey', { title: 'Each version of a passage keeps its own notes: another take or a rewrite takes the old version’s notes back out, and the arrows bring a version’s notes back with it. A card you wrote or changed keeps your words — the helper only moves where they are now and how they stand with others.' },
    'Every card here goes to the writer before every page, lit or not. ',
    lit ? h('span', h('b.lit', 'Lit'), ` — changed by the helper last (${lit.label}, ${timeAgo(lit.at)})`, gone.length ? `; took out ${gone.slice(0, 6).join(', ')}${gone.length > 6 ? '…' : ''}` : '', '. ') : null,
    h('b.yours', 'Yours'), ' — your own words, kept.'));
  ui.rightBody.append(card);
  for (const kind of NOTE_KINDS) {
    const cards = (n.notes && n.notes[kind]) || [];
    const key = 'notes.' + kind;
    const open = kept('cozynovel.fold.' + key) !== 'closed';
    const sec = h('section.notesec' + (open ? '.open' : ''));
    const head = h('button.sechead', { 'aria-expanded': String(open), onclick: () => { const now = sec.classList.toggle('open'); head.setAttribute('aria-expanded', String(now)); keep('cozynovel.fold.' + key, now ? 'open' : 'closed'); } },
      h('span.chev', icon('chev', 14)), h('h3', KIND_TITLE[kind]), h('span.count', String(cards.length)));
    const box = h('div.cards');
    const sorted = kind === 'threads' ? [...cards].sort((a, b) => (a.open === false) - (b.open === false)) : cards;
    for (const c of sorted) {
      const state = how.get(kind + ':' + nameKey(c.name));
      const mine = Boolean(c.updated && c.updated.by === 'you');
      box.append(h('div.card' + (state ? '.fresh' : '') + (kind === 'threads' && c.open === false ? '.closed' : ''), { onclick: () => editCard(kind, c.id) },
        h('div.nm', c.name + (kind === 'threads' && c.open === false ? ' — closed' : ''),
          state ? h('span.ctag.lit', state === 'new' ? 'new' : 'updated') : null,
          mine ? h('span.ctag.yours', 'yours') : null),
        c.aka && c.aka.length ? h('div.aka', 'also ' + c.aka.join(', ')) : null,
        c.about ? h('div.ab', c.about) : null,
        kind === 'people' && c.ties ? h('div.nw.ties', h('b', 'With others'), c.ties) : null,
        kind === 'people' && c.now ? h('div.nw', h('b', 'Now'), c.now) : null));
    }
    box.append(h('button.btn.quiet.small', { onclick: () => editCard(kind, null) }, icon('plus', 14), 'Add'));
    sec.append(head, box);
    ui.rightBody.append(sec);
  }
  ui.rightBody.append(readingsSection());
}

/* Each reading the helper made — the notes' checkpoints, one for every
 * version of every passage it read, newest first: what it read and what it
 * changed, with Put back (only what it changed, wherever the card still
 * reads so) and Read again (put back, and that passage read afresh). */
function readingsSection() {
  const key = 'cozynovel.fold.notes.readings';
  const open = kept(key) === 'open';
  const rows = archivist.readingsList(P.novelId);
  const sec = h('section.notesec' + (open ? '.open' : ''));
  const head = h('button.sechead', { 'aria-expanded': String(open), onclick: () => { const now = sec.classList.toggle('open'); head.setAttribute('aria-expanded', String(now)); keep(key, now ? 'open' : 'closed'); } },
    h('span.chev', icon('chev', 14)), h('h3', 'Each version’s notes'), h('span.count', String(rows.length)));
  const box = h('div.cards');
  box.append(h('p.notekey', 'Newest first. The arrows on a passage bring its version’s notes back by themselves.'));
  if (!rows.length) box.append(h('p.notekey', 'None kept yet — each reading from now on is.'));
  /* the newest few; the rest one tap away */
  const all = P.readingsAll === P.novelId;
  for (const r of rows.slice(0, all ? 60 : 8)) {
    const what = r.changed.length ? r.changed.slice(0, 6).map((c) => `${c.how === 'new' ? 'new' : c.how === 'gone' ? 'took out' : 'updated'} ${c.name}`).join(', ') + (r.changed.length > 6 ? '…' : '') : 'changed nothing';
    const state = r.live ? 'in the notes now' : r.shown ? 'the version on show — not read into the notes yet' : 'an earlier version — its notes come back when you pick it';
    box.append(h('div.card.reading' + (r.live ? '.fresh' : ''),
      h('div.nm', r.label, h('span.ctag' + (r.live ? '.lit' : ''), r.live ? 'in the notes' : r.shown ? 'on show' : 'earlier version')),
      h('div.ab', { title: state }, `${timeAgo(r.at)} · ${what}`),
      r.live ? h('div.row', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
        h('button.btn.small.quiet', { title: 'Takes out only what this reading changed; a card changed since stays as it is.', onclick: (e) => { e.stopPropagation(); if (archivist.putBackReading(P.novelId, r.pid, r.vid)) toast('What that reading changed is put back — anything changed since stays as it is.'); drawSide(); } }, 'Put back'),
        h('button.btn.small.quiet', { title: 'Puts it back, then the helper reads that passage afresh.', onclick: (e) => { e.stopPropagation(); if (archivist.putBackReading(P.novelId, r.pid, r.vid, { readAgain: true })) toast('Put back — the helper reads that passage again in a moment.'); drawSide(); } }, 'Read again')) : null));
  }
  if (!all && rows.length > 8) box.append(h('button.btn.quiet.small', { onclick: () => { P.readingsAll = P.novelId; drawSide(); } }, `Show all ${rows.length}`));
  sec.append(head, box);
  return sec;
}

function editCard(kind, id) {
  const n = store.peek('novel', P.novelId);
  const cur = id ? (n.notes[kind] || []).find((c) => c.id === id) : null;
  const c = cur ? JSON.parse(JSON.stringify(cur)) : newCard(kind);
  const s = openSheet(cur ? c.name : `A new ${kind === 'people' ? 'person' : kind === 'places' ? 'place' : kind === 'lore' ? 'thing to remember' : 'thread'}`, { small: true });
  const name = h('input', { type: 'text', value: c.name || '' });
  const about = h('textarea', { rows: 5 });
  about.value = c.about || '';
  s.body.append(field('Name', name));
  let aka = null, now = null, ties = null, open = null;
  if (kind === 'people') {
    aka = h('input', { type: 'text', value: (c.aka || []).join(', ') });
    now = h('textarea', { rows: 3 });
    now.value = c.now || '';
    ties = h('textarea', { rows: 3 });
    ties.value = c.ties || '';
    s.body.append(field('Also called', aka, 'Other names, separated by commas.'));
  }
  s.body.append(field(kind === 'people' ? 'Who they are' : kind === 'threads' ? 'What was set up, and where it stands' : 'About it', about,
    kind === 'people' ? 'For good: looks, voice, temperament, how they act under pressure, what they want, what they would never do.' : undefined));
  if (kind === 'people') {
    s.body.append(field('With others', ties, 'How they stand with the people who matter to them, and why — where it began, what moved it, where it is now.'));
    s.body.append(field('Right now', now, 'Where they are and what is going on with them as of the end of the book so far.'));
  }
  if (kind === 'threads') {
    open = h('input', { type: 'checkbox', checked: c.open !== false });
    s.body.append(h('label.toggle', open, h('span', 'Still open')));
  }
  s.body.append(h('p.say', 'The helper keeps these as the book is written; what you write here it keeps too.'));
  const row = h('div.btnrow', h('button.btn.primary', { onclick: () => {
    const nm = name.value.trim();
    if (!nm) { toast('It needs a name.'); return; }
    const out = { ...c, name: nm, about: about.value.trim(), updated: { by: 'you', at: Date.now() } };
    if (aka) out.aka = aka.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (now) out.now = now.value.trim();
    if (ties) out.ties = ties.value.trim();
    if (open) out.open = open.checked;
    store.change('novel', P.novelId, novelSteps.putNote(kind, out), { now: true });
    s.close();
  } }, 'Save'));
  if (cur) row.append(h('button.btn.danger', { onclick: async () => {
    if (!(await confirmIt('Take this out of the notes?', `${cur.name} goes from the notes. (The book itself is not changed.)`, 'Take it out', { danger: true }))) return;
    store.change('novel', P.novelId, novelSteps.dropNote(kind, cur.id), { now: true });
    s.close();
  } }, 'Take it out'));
  s.body.append(row);
}

/* -------------------------------------------------------------- partner */

let partnerFrame = 0;
const partnerLive = new Map();

async function drawPartner() {
  const n = store.peek('novel', P.novelId);
  if (!n) return;
  const novelId = P.novelId;
  const t = store.peek('talk', novelId) ?? await store.open('talk', novelId).catch(() => null);
  if (P.side !== 'partner' || P.novelId !== novelId) return;
  if (t) talk.repairStaleTurns('talk', novelId);
  if (!P.offs.talkSub) { P.offs.push(store.subscribe('talk', novelId, () => { if (P.side === 'partner' && !drawnAlready('talk', novelId)) drawPartnerSoon(); })); P.offs.talkSub = true; }
  ui.rightBody.textContent = '';
  ui.rightBody.append(conversationRow(novelId, t));
  const box = h('div.talk');
  const turns = (t && t.turns) || [];
  if (!turns.length) box.append(h('p.hint', `Talk the book over — a stuck scene, what someone would really do, where it could go next. Your partner knows the whole book and the notes, and when you ask, it makes the change itself: a passage (by its number on the page, like “Chapter Two, passage 3”), the same words across chapters, a name everywhere at once, a chapter’s name or summary, what the book is about, a card in the notes, a module’s words. Every change shows here with its Undo. Quick asks (⋯ beside Send) checks the notes against the book, tidies them, finds what contradicts itself, and more.`));
  for (const turn of turns) box.append(drawTurn('talk', novelId, turn));
  ui.rightBody.append(box);
  const ta = h('textarea', { rows: 1, placeholder: 'Ask your partner…', 'aria-label': 'Ask your partner' });
  const working = talk.talkBusy('talk', novelId);
  const send = h('button.btn.primary.small', { onclick: async () => {
    if (talk.talkBusy('talk', novelId)) { talk.stopTalk('talk', novelId); return; }
    const text = ta.value.trim();
    if (!text) return;
    ta.value = ''; typed.value = '';
    const out = await talk.partnerSay({ novelId, chapterId: P.chapterId, text });
    if (out && !out.ok && out.error) toast('Your partner did not answer: ' + out.error, 6000);
    /* a message whose answer did not come is not on the page: its words come back to the box */
    if (out && out.giveBack) giveBack('talk:' + novelId, out.giveBack);
  } }, working ? 'Stop' : 'Send');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
  ui.rightFoot.hidden = false;
  const quick = h('button.btn.quiet.small', { 'aria-label': 'Quick asks', title: 'Quick asks — ready-made requests for your partner', disabled: working, onclick: (e) => quickAsks(e.currentTarget, ta, send) }, icon('more', 16), 'Quick asks');
  ui.rightFoot.append(ta, h('div.crow', turns.length ? h('button.btn.quiet.small', { title: 'This conversation’s talk goes and it begins again — the changes it made stay in the book. With Undo.', disabled: working, onclick: clearTalk }, 'Start over') : null, h('span.grow'), quick, send));
  autoGrow(ta, 0.3);
  restoreTyped('talk:' + novelId);
  P.drawn = 'talk:' + novelId + turnsSig(t);
  placeSide();
}
/* Ready-made requests for the partner (Cozy Tavern's housekeeper's quick asks,
 * made for a book): sent at once, or put in the box for a name. */
const QUICK = [
  { label: 'Check the notes against the book', hint: 'It reads the book and its notes and puts right what the notes get wrong or leave out.',
    ask: 'Read the whole book and its notes. Find anything the notes get wrong or leave out — a name, how someone looks, where someone is now, how two people stand, who knows what, a thread the story has closed or one still open — and put each right in the notes with a changes block, every change with its why. Read whole any chapter you need before you judge; never guess from a summary.' },
  { label: 'Tidy the notes', hint: 'Cards that are the same merged, what the book no longer holds taken out — nothing true lost.',
    ask: 'Tidy the notes without losing anything: merge cards that are the same person, place or thing (the others they go by kept), take out what the book no longer holds, close threads the story has resolved, and keep every fact that is still true — as a changes block, each change with its why.' },
  { label: 'Find what contradicts itself', hint: 'Names, looks, times, who knows what — by passage number, with a fix for each.',
    ask: 'Read the book for anything that contradicts itself — a name, a look, a time or a day, an injury, who knows what, where someone is — and show me each place by its passage number, with a fix for each in a changes block. Read whole any chapter you only have in short before you say it is wrong.' },
  { label: 'Four directions the story could go', hint: 'Four real ways forward from here, each with what it costs.',
    ask: 'Give me four genuinely different directions the story could go from where it stands — each in a few lines: what happens, what it costs the people in it, and what it opens up later — and each as a premise I could hand the writer, in its own direction block. No changes, just the four.' },
  { label: 'Read a character’s psychology…', hint: 'Type the name after it and send.', fill: 'Read the psychology of ' },
  { label: 'Critique this chapter', hint: 'An honest editor’s read of the chapter open now — what works, what drags, what rings false.',
    ask: 'Be my editor for the chapter open now. Read it whole and tell me honestly how the telling works: where it drags or rushes, where a scene lands or falls flat, the voice, the dialogue, anything unclear or that rings false — each by its passage number, with what would make it better. Say what works and why, too. No changes unless I ask for them.' },
  { label: 'What the next chapter should do', hint: 'Where the book stands and what the next chapter needs to carry.',
    ask: 'Tell me where the book stands now — what is set up and unresolved, what each of the main people wants, what the reader is waiting for — and what the next chapter should do to carry it. A short, honest answer.' },
];
function quickAsks(anchor, ta, send) {
  menu(anchor, [{ label: 'Quick asks', header: true }, ...QUICK.map((q) => ({ label: q.label, hint: q.hint, run: () => {
    if (q.fill) { ta.value = q.fill; ta.dispatchEvent(new Event('input')); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
    ta.value = q.ask; ta.dispatchEvent(new Event('input'));
    send.click();
  } }))]);
}

function drawPartnerSoon() { if (!partnerFrame) partnerFrame = requestAnimationFrame(() => { partnerFrame = 0; if (P.side === 'partner') drawPartner(); }); }

function giveBack(key, words) {
  const ta = ui.rightFoot.querySelector('textarea');
  if (ta && ui.rightFoot.dataset.for === key && !ta.value.trim()) { ta.value = words; ta.dispatchEvent(new Event('input')); return; }
  if (typed.key === key && !typed.value) typed.value = words;
}

async function clearTalk() {
  const novelId = P.novelId;
  if (!(await confirmIt('Start the conversation over?', 'Its talk goes and it begins again; the changes it made stay in the book. (Undo brings the talk back.)', 'Start over'))) return;
  const out = await talk.startOver(novelId);
  if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
  drawSide();
  undoToast('The conversation begins again.', () => { out.undo(); drawSide(); });
}

/* The partner's conversations (Cozy Tavern's housekeeper sessions): the
 * open one by name — a tap lists the others, newest used first, and what can
 * be done with this one — New conversation beside it, and full screen. */
function conversationRow(novelId, t) {
  const c = talk.partnerConversations(novelId);
  const busy = talk.talkBusy('talk', novelId);
  const full = fullKind() === 'partner';
  const empty = !((t && t.turns) || []).length && !(t && t.named);
  return h('div.convrow',
    h('button.btn.quiet.small.convpick', { title: 'Your conversations with your partner: open another, rename, copy or remove this one', 'aria-label': `Conversation: ${c.open.name}`, onclick: (e) => conversationMenu(e.currentTarget, novelId) }, h('span.convname', c.open.name), icon('down', 14)),
    h('button.btn.quiet.small', { 'aria-label': 'New conversation', title: 'New conversation — a fresh one for a new question; this one stays in the list', disabled: busy || empty, onclick: async () => {
      const out = await talk.newConversation(novelId);
      if (!out.ok) toast(`It couldn’t: ${out.error}.`, 5000);
      drawSide();
    } }, icon('plus', 14), 'New'),
    h('span.grow'),
    h('button.icon', { 'aria-label': full ? 'Leave full screen' : 'Full screen', title: full ? 'Leave full screen' : 'Full screen', onclick: partnerFull }, icon(full ? 'shrink' : 'expand', 18)));
}
function conversationMenu(anchor, novelId) {
  const c = talk.partnerConversations(novelId);
  const busy = talk.talkBusy('talk', novelId);
  const run = (fn, done) => async () => {
    const out = await fn();
    if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
    drawSide();
    if (done) done(out);
  };
  menu(anchor, [
    { label: 'Conversations', header: true },
    { label: `${c.open.name} — open now`, checked: true, disabled: true },
    ...c.others.map((x) => ({ label: x.name, hint: `${plural(x.n, 'message')} · last used ${timeAgo(x.at)}`, disabled: busy, run: run(() => talk.openConversation(novelId, x.id)) })),
    '-',
    { label: 'Rename this conversation', hint: 'A name to know it by in this list.', run: async () => {
      const name = await askText('Rename the conversation', { value: c.open.name, yes: 'Rename' });
      if (name === null || name === undefined || name.trim() === c.open.name) return;
      const out = await talk.renameConversation(novelId, name);
      if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
      drawSide();
    } },
    { label: 'Copy this conversation', hint: 'A copy to take another way; this one stays as it is.', disabled: busy || !c.open.n, run: run(() => talk.copyConversation(novelId), (out) => toast(`“${out.name}” is open — the first one is in the list.`, 4000)) },
    { label: 'Remove this conversation', hint: 'It goes from the list, with Undo; the changes it made stay in the book.', danger: true, disabled: busy || (!c.open.n && !c.others.length), run: run(() => talk.removeConversation(novelId), (out) => undoToast(`“${out.name}” is removed.`, () => { out.undo(); drawSide(); })) },
  ]);
}
/* the partner over the whole screen */
function partnerFull() {
  if (fullKind() === 'partner') { leaveFull(); return; }
  enterFull('partner', () => { ui.right.classList.add('full'); drawSideSoon(); },
    () => { ui.right.classList.remove('full'); drawSideSoon(); });
}

/* which replies' thinking he unfolded, so a redraw keeps them open */
const thinkOpen = new Set();
function turnThinkBox(turnId, thinking, live) {
  return thinkBox(thinking, { live, open: thinkOpen.has(turnId), onToggle: (now) => { if (now) thinkOpen.add(turnId); else thinkOpen.delete(turnId); } });
}
/* what a reply shows: the partner's words without its blocks — while a
 * block is coming, or it is reading a chapter, a line says so */
function shownWords(kind, turn, raw, live) {
  if (turn.by === 'you') return raw || '';
  /* the narrator's telling, without the ways it offers (they are buttons under it) */
  if (kind === 'play') return sceneWords(raw);
  const words = wordsOf(raw);
  if (words) return words;
  if (live && live.note) return live.note;
  if (changesComing(raw)) return 'Making the changes…';
  /* it asked to read more than one answer can be sent */
  if (/<read>/i.test(String(raw || ''))) return 'It asked to read more of the book than one answer can carry — ask it again, about less at a time.';
  return '';
}
function drawTurn(kind, id, turn) {
  const v = picked(turn) || { text: '' };
  const live = (kind === 'talk' ? partnerLive : playLive).get(turn.id);
  const text = live ? live.text : v.text;
  const thinking = live ? live.thinking : v.thinking;
  const el = h('div.turn.' + (turn.by === 'you' ? 'you' : 'ai') + (kind === 'play' && turn.by !== 'you' ? '.prose-turn' : '') + (live || v.streaming ? '.streaming' : ''), { 'data-id': turn.id });
  /* the thinking streams open while it comes, then folds once the words begin */
  if (turn.by !== 'you' && thinking) el.append(turnThinkBox(turn.id, thinking, Boolean(live && !live.text)));
  /* the narrator's telling is prose — a thought or a sound in italics is drawn in italics */
  if (kind === 'play' && turn.by !== 'you') { const w = h('div.words.tprose'); drawProse(w, shownWords(kind, turn, text, live)); el.append(w); }
  else if (kind === 'talk' && turn.by !== 'you' && partsOf(text).some((x) => x.kind === 'direction')) {
    /* each premise it offered, with its own Use as the next direction */
    const w = h('div.words');
    for (const part of partsOf(text)) {
      if (part.kind === 'words') { w.append(h('span', part.text)); continue; }
      w.append(h('div.direction', h('span', part.text), part.done && !(live || v.streaming) ? h('button.btn.small', { title: 'Puts this premise in the box under the page — change it as you like, then Write.', onclick: async () => { if (!(await desk.useAsDirection(part.text))) return; if (!wide()) closeRight(); toast('It is in the box — change it as you like, then Write.'); } }, 'Use as the next direction') : null));
    }
    el.append(w);
  } else el.append(h('span.words', shownWords(kind, turn, text, live)));
  /* his line to the narrator, not his character's */
  if (kind === 'play' && turn.by === 'you' && v.tell) el.append(h('div.tell', h('b', 'To the narrator: '), v.tell));
  if (live || v.streaming) return el;
  if (kind === 'talk' && v.read && v.read.length) el.append(h('div.turnnote', `It read ${v.read.join(', ')} whole.`));
  if (kind === 'talk' && v.changes && v.changes.length) el.append(changeList(id, turn, v));
  const row = h('div.tctl');
  if (turn.by !== 'you') {
    if (turn.versions.length > 1) {
      const i = turn.versions.indexOf(v);
      row.append(h('button', { 'aria-label': 'The answer before', disabled: i <= 0, onclick: () => store.change(kind, id, turnSteps.pick(turn.id, turn.versions[i - 1].id), { now: true }) }, '‹'),
        h('span', { style: { alignSelf: 'center', fontSize: '12px', color: 'var(--chrome-soft)' } }, `${i + 1}/${turn.versions.length}`),
        h('button', { 'aria-label': 'The answer after', disabled: i >= turn.versions.length - 1, onclick: () => store.change(kind, id, turnSteps.pick(turn.id, turn.versions[i + 1].id), { now: true }) }, '›'));
    }
    row.append(h('button', { title: 'Asks again for this answer; the one you have stays one arrow away.', onclick: async () => {
      const out = kind === 'talk' ? await talk.partnerAgain({ novelId: id, chapterId: P.chapterId, turnId: turn.id }) : await talk.playAgain({ playId: id, turnId: turn.id });
      if (out && !out.ok && out.error) toast(out.error, 6000);
    } }, 'Another answer'));
  } else if (kind === 'talk') {
    /* his words back in the box; this message and everything after it let go — with Undo */
    row.append(h('button', { title: 'Your words back in the box to change and send again; this message and everything after it are let go (the changes made stay in the book). With Undo.', disabled: talk.talkBusy('talk', id), onclick: async () => {
      const out = await talk.editAndAskAgain(id, turn.id);
      if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
      drawSide();
      requestAnimationFrame(() => {
        const ta = ui.rightFoot.querySelector('textarea');
        if (ta) { ta.value = out.text; ta.dispatchEvent(new Event('input')); ta.focus(); }
      });
      undoToast('Your words are in the box.', () => {
        /* the message is back where it was: the box lets go of the words it was handed, unless he changed them */
        const ta = ui.rightFoot.querySelector('textarea');
        if (ta && ta.value === out.text) { ta.value = ''; ta.dispatchEvent(new Event('input')); }
        if (typed.value === out.text) typed.value = '';
        out.undo();
        drawSide();
      });
    } }, 'Edit and ask again'));
  }
  /* the rest, under ⋯ — only what this answer has */
  const copyWords = turn.by === 'you' ? (v.text || '') : kind === 'talk' ? wordsOf(v.text) : sceneWords(v.text);
  const mine = turn.by === 'you';
  row.append(h('button.tmore', { 'aria-label': mine ? 'More for this message' : 'More for this answer', title: 'More', onclick: (e) => menu(e.currentTarget, [
    !mine && kind === 'talk' ? { label: 'Branch from here', hint: 'A new conversation with everything up to this answer; this one stays as it is.', disabled: talk.talkBusy('talk', id), run: async () => {
      const out = await talk.copyConversation(id, turn.id);
      if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
      drawSide();
      toast(`“${out.name}” is open — the first one is in the list.`, 4000);
    } } : null,
    /* the answer as it came, its blocks and all (Cozy Tavern's "What it said, whole") */
    !mine && kind === 'talk' && String(v.text || '').trim() !== wordsOf(v.text).trim() ? { label: 'What it said, whole', hint: 'The answer as it came — its changes block and all.', run: () => showWhole(v.text) } : null,
    !mine && v.sent ? { label: 'What was sent', hint: 'Everything this answer was asked with, as it went out.', run: () => showSent(P.novelId, v.sent) } : null,
    { label: 'Copy', hint: mine ? 'Your words, to paste anywhere.' : 'Its words, to paste anywhere.', run: async () => toast((await copyText(copyWords)) ? 'Copied.' : 'It could not be copied.') },
    '-',
    { label: 'Remove', hint: mine ? 'This message goes from the conversation, with Undo.' : 'This answer goes from the conversation, with Undo; changes it made stay in the book.', danger: true, run: () => removeTurn(kind, id, turn) },
  ]) }, icon('more', 16)));
  el.append(row);
  return el;
}

/* The partner's changes under its answer: each with what it changed and
 * why, and its Undo — or, set to wait, Apply and Leave it. */
const clip = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function whatChanged(c) {
  const op = c.op || {};
  const u = c.status === 'made' && c.undo && c.undo.what === 'many' ? c.undo : null;
  /* how many places a change across the book reached */
  const reach = u ? ` (${[[u.passages, 'passage'], [u.chapters, 'chapter name'], [u.cards, 'card'], [u.book, 'of the book’s words']].filter(([l]) => l && l.length).map(([l, w]) => (w === 'of the book’s words' ? `${l.length} ${w}` : plural(l.length, w))).join(', ') || 'nowhere'})` : '';
  if (op.rename && typeof op.rename === 'object') return h('span', h('del', clip(op.rename.from, 60)), ' → ', h('ins', clip(op.rename.to, 60)), reach);
  if (op.passage !== undefined && op.remove === true) return 'taken out of the chapter';
  if (op.remove === true) return 'taken out of the notes';
  if (op.find !== undefined) return h('span', h('del', clip(op.find, 90)), ' → ', h('ins', clip(op.replace !== undefined ? op.replace : op.text, 90) || '(taken out)'), reach);
  if (op.passage !== undefined && op.text !== undefined) return `written anew (${plural(countWordsLoose(op.text), 'word')})`;
  if (op.module !== undefined && op.text !== undefined) return `its words, whole (${plural(countWordsLoose(op.text), 'word')})`;
  if (op.summary !== undefined) return h('span', h('ins', clip(op.text, 140)));
  if (op.book !== undefined) return op.add !== undefined ? h('span', 'a new paragraph: ', h('ins', clip(op.add))) : h('span', h('ins', clip(op.text)));
  if (op.chapter !== undefined) return h('span', 'named ', h('ins', clip(op.name, 80)));
  if (op.note !== undefined) {
    const bits = ['about', 'ties', 'now'].filter((k) => op[k] !== undefined).map((k) => `${k === 'ties' ? 'with others' : k === 'now' ? 'right now' : 'who they are'}: ${clip(op[k], 80)}`);
    if (op.newName !== undefined) bits.unshift(`renamed ${clip(op.newName, 60)}`);
    if (typeof op.open === 'boolean') bits.push(op.open ? 'open again' : 'closed');
    return bits.join(' · ') || 'brought up to date';
  }
  return '';
}
const countWordsLoose = (t) => String(t || '').split(/\s+/).filter(Boolean).length;
function changeList(novelId, turn, v) {
  const box = h('div.changes');
  const act = (fn, changeId) => async () => {
    const out = fn(novelId, turn.id, v.id, changeId);
    if (out && !out.ok && out.said) toast(`It couldn’t: ${out.said}.`, 5000);
    else if (out && out.partly) toast(`Undone in part: ${out.said}.`, 6000);
    drawSideSoon();
  };
  for (const c of v.changes) {
    const mark = { made: '✓', waiting: '•', refused: '✗', undone: '↶', skipped: '–' }[c.status] || '•';
    const state = { made: c.edited ? 'made with your words' : '', waiting: 'waiting for Apply', refused: `couldn’t be made — ${c.said || 'no reason given'}`, undone: c.undoneSaid ? `undone in part — ${c.undoneSaid}` : 'undone', skipped: 'left as it was' }[c.status] || '';
    const row = h('div.change.' + c.status,
      h('div.chead', h('b', `${mark} ${c.label}`), state ? h('small', state) : null),
      c.status !== 'refused' ? h('div.cwhat', whatChanged(c)) : null,
      c.why ? h('div.cwhy', c.why) : null);
    const btns = h('div.cbtns');
    if (c.copied) {
      /* copied with the conversation: it is undone or applied where it was made */
      if (c.status === 'made' || c.status === 'waiting') row.append(h('div.cwhy', 'In the conversation this one was copied from — its Undo and Apply are there.'));
    } else {
      if (c.status === 'made') btns.append(h('button', { title: 'Put back what this change changed (only if nothing has changed it since).', onclick: act(talk.undoOneChange, c.id) }, 'Undo'));
      if (c.status === 'waiting') {
        btns.append(h('button.go', { title: 'Make this change in the book.', onclick: act(talk.applyChange, c.id) }, 'Apply'));
        if (editableOf(c.op).length) btns.append(h('button', { title: 'Change its words yourself before it goes into the book.', onclick: () => editByHand(novelId, turn, v, c) }, 'Edit by hand'));
        btns.append(h('button', { title: 'Leave the book as it is for this one.', onclick: act(talk.skipChange, c.id) }, 'Leave it'));
      }
    }
    if (btns.childNodes.length) row.append(btns);
    box.append(row);
  }
  const all = (how) => async () => {
    const out = talk.settleAll(novelId, turn.id, v.id, how);
    if (out.failed.length) toast(`${plural(out.failed.length, 'change')} couldn’t: ${out.failed[0]}.`, 6000);
    else if (out.partly.length) toast(`Undone in part: ${out.partly[0]}.`, 6000);
    drawSideSoon();
  };
  const live = v.changes.filter((c) => !c.copied);
  const waiting = live.filter((c) => c.status === 'waiting');
  const made = live.filter((c) => c.status === 'made');
  if (waiting.length > 1) box.append(h('div.cbtns', h('button.go', { title: 'Every change waiting here, made in the book.', onclick: all('apply') }, 'Apply all'), h('button', { title: 'Leave the book as it is for every change waiting here.', onclick: all('skip') }, 'Leave all')));
  if (made.length > 1) box.append(h('div.cbtns', h('button', { title: 'Every change this answer made, put back — the newest first; one changed since stays.', onclick: all('undo') }, 'Undo all')));
  return box;
}

/* Edit by hand (Cozy Tavern's card editor): the words a waiting change would
 * write, his to change; Apply makes it with his words */
function editByHand(novelId, turn, v, c) {
  const fields = editableOf(c.op);
  if (!fields.length) return;
  const s = openSheet(`Edit by hand — ${c.label}`, { small: true });
  const boxes = fields.map((f) => {
    const ta = h(f.rows > 1 ? 'textarea' : 'input', f.rows > 1 ? { rows: f.rows } : { type: 'text' });
    ta.value = f.value;
    return { f, ta };
  });
  if (c.op && c.op.find !== undefined) s.body.append(h('p.say', 'In place of: ', h('del', clip(c.op.find, 300))));
  for (const { f, ta } of boxes) s.body.append(field(f.label, ta));
  if (c.why) s.body.append(h('p.say', c.why));
  s.body.append(h('div.btnrow', h('button.btn.primary', { onclick: () => {
    const patch = Object.fromEntries(boxes.map(({ f, ta }) => [f.key, ta.value]));
    const out = talk.applyEdited(novelId, turn.id, v.id, c.id, patch);
    if (out && !out.ok && out.said) { toast(`It couldn’t: ${out.said}.`, 5000); return; }
    s.close();
    drawSideSoon();
  } }, 'Apply'), h('button.btn.quiet', { onclick: () => s.close() }, 'Cancel')));
  setTimeout(() => { const first = boxes[0] && boxes[0].ta; if (first) first.focus(); }, 50);
}

/* the partner's answer as it came, its blocks and all */
function showWhole(text) {
  const s = openSheet('What it said, whole');
  s.body.append(h('pre.whole', String(text || '')));
}

/* a turn taken out, with a few seconds to change his mind */
function removeTurn(kind, id, turn) {
  const rec = store.peek(kind, id);
  const list = (rec && rec.turns) || [];
  const i = list.findIndex((t) => t.id === turn.id);
  const before = i > 0 ? list[i - 1].id : null;
  const copy = JSON.parse(JSON.stringify(turn));
  store.change(kind, id, turnSteps.removeTurn(turn.id), { now: true });
  undoToast('Taken out.', () => {
    store.change(kind, id, (d) => {
      d.turns = d.turns || [];
      if (d.turns.some((t) => t.id === copy.id)) return;
      const at = before ? d.turns.findIndex((t) => t.id === before) + 1 : 0;
      d.turns.splice(Math.max(0, at), 0, JSON.parse(JSON.stringify(copy)));
    }, { now: true });
  });
}

/* the view beside the page now, and whether a reply for (kind, id) is in it */
function sideView() { return `${P.side}/${P.side === 'play' ? P.playId || '' : ''}/${P.novelId}`; }
function showing(kind, id) { return kind === 'talk' ? P.side === 'partner' && id === P.novelId : P.side === 'play' && P.playId === id; }

/* what the pane shows of a conversation, as one string: a reply this window
 * is writing shows its words from the stream, so its own checkpoints of them
 * leave it the same — it is not drawn again for them */
const writingHere = (v) => v.streaming && v.tab === store.CLIENT;
function turnsSig(rec) {
  if (!rec) return '';
  /* the conversations put aside show only by name in the list (built when it opens) */
  return JSON.stringify({ ...rec, convs: (rec.convs || []).map((c) => [c.id, c.name, (c.turns || []).length]), turns: (rec.turns || []).map((t) => ((t.versions || []).some(writingHere)
    ? { ...t, versions: t.versions.map((v) => (writingHere(v) ? { ...v, text: 0, thinking: 0, beat: 0 } : v)) }
    : t)) });
}
function drawnAlready(kind, id) { return P.drawn === kind + ':' + id + turnsSig(store.peek(kind, id)); }

/* where the pane stands with the newest words: the end of the reply being
 * written at the bottom of the pane (the very bottom, for the last one) */
let sideKeep = null;
function sideTail() {
  const max = ui.rightBody.scrollHeight - ui.rightBody.clientHeight;
  const el = P.liveTurn && ui.rightBody.querySelector(`.turn[data-id="${P.liveTurn}"]`);
  if (!el) return max;
  const bottom = el.getBoundingClientRect().bottom - ui.rightBody.getBoundingClientRect().top + ui.rightBody.scrollTop;
  return Math.min(max, bottom + 30 - ui.rightBody.clientHeight);
}
/* a conversation just drawn: opened afresh, at its newest words; drawn again,
 * at his place — or still with the newest words if he was following them */
function placeSide() {
  const same = sideKeep && sideKeep.view === sideView();
  if (!same) { SF.start(); SF.jump(sideTail()); return; }
  if (SF.on && !SF.hand) SF.jump(Math.max(sideTail(), 0));
  else SF.jump(sideKeep.top);
}

/* The words arrive many times a second; the pane paints them at most once a
 * frame (and less often once a paint costs more — live.js), only the line
 * they land on drawn again, and goes down with them only while he follows. */
const sideLive = new Map();   /* turnId -> the newest event not yet painted */
const sidePaint = paced(paintSide);
function onTalkLive(ev) {
  const map = ev.kind === 'talk' ? partnerLive : playLive;
  if (ev.done) {
    map.delete(ev.turnId);
    sideLive.delete(ev.turnId);
    if ((ev.kind === 'talk' && P.side === 'partner') || (ev.kind === 'play' && P.side === 'play')) drawSide();
    if (P.liveTurn === ev.turnId) P.liveTurn = null;
    return;
  }
  map.set(ev.turnId, { text: ev.text, thinking: ev.thinking, note: ev.note || '' });
  sideLive.set(ev.turnId, ev);
  sidePaint.ask();
}
function paintSide() {
  let redraw = false;
  let painted = false;
  for (const [turnId, ev] of sideLive) {
    if (!showing(ev.kind, ev.id)) continue;
    const turnEl = ui.rightBody.querySelector(`.turn[data-id="${turnId}"]`);
    /* the reply's own words — never the thinking box's, which sits inside the box */
    const el = turnEl && turnEl.querySelector(':scope > .words');
    if (!el) { redraw = true; continue; }
    P.liveTurn = turnId;
    const entry = (ev.kind === 'talk' ? partnerLive : playLive).get(turnId) || { text: ev.text, thinking: ev.thinking, note: ev.note || '' };
    const box = turnEl.querySelector(':scope > .thinkbox');
    if (ev.thinking) {
      if (box) updateThinkBox(box, ev.thinking, { live: !ev.text });
      else turnEl.insertBefore(turnThinkBox(turnId, ev.thinking, !ev.text), el);
    } else if (!ev.text && box) {
      /* a new round (it is reading a chapter): the last round's thinking goes */
      box.remove();
    }
    const words = shownWords(ev.kind, { by: 'ai' }, ev.text || '', entry);
    if (el.classList.contains('tprose')) growProse(el, words); else streamLines(el, words);
    painted = true;
  }
  sideLive.clear();
  if (redraw) drawSide();
  /* only the conversation on screen is followed — never the notes, or a scene he is not in */
  else if (painted) SF.follow();
}

/* ----------------------------------------------------------------- play */

const playLive = new Map();

async function drawPlay() {
  const n = store.peek('novel', P.novelId);
  if (!n) return;
  if (P.playId) {
    const p = store.peek('play', P.playId) ?? await store.open('play', P.playId).catch(() => null);
    if (!p) { P.playId = null; return drawPlay(); }
    return drawOnePlay(p);
  }
  ui.rightBody.append(h('p.hint', 'Step into the story as one of its people. You write what they say and do; the narrator plays everyone and everything else. When it went somewhere good, Turn it into prose writes it into the chapter.'));
  const plays = [];
  for (const id of n.plays || []) { const p = store.peek('play', id) ?? await store.open('play', id).catch(() => null); if (p) plays.push(p); }
  if (P.side !== 'play' || P.playId) return;
  plays.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (plays.length) {
    const list = h('ul.plays');
    for (const p of plays) {
      const c = store.peek('chapter', p.chapterId);
      list.append(h('li', h('button', { onclick: () => { P.playId = p.id; drawSide(); } },
        h('b', `${p.who || 'Someone'}${p.from ? ` — ${p.from.slice(0, 50)}` : ''}`),
        h('small', `${c ? chapterLabel(n, c, { withName: false }) : 'a chapter'} · ${plural((p.turns || []).length, 'turn')} · ${timeAgo(p.updated)}`))));
    }
    ui.rightBody.append(list);
  }
  const people = (n.notes && n.notes.people) || [];
  const who = h('input', { type: 'text', placeholder: people[0] ? people[0].name : 'Their name', list: 'cn-people' });
  const dl = h('datalist', { id: 'cn-people' }, people.map((x) => h('option', { value: x.name })));
  const from = h('input', { type: 'text', placeholder: 'Right where the chapter leaves off' });
  ui.rightBody.append(h('div.group', h('div.gbody', { style: { paddingTop: '14px' } },
    field('Who do you play?', who), dl,
    field('Where does it start?', from, 'Leave it empty to pick up right where the chapter stands now.'),
    h('div.btnrow', h('button.btn.primary', { onclick: async () => {
      const name = who.value.trim();
      if (!name) { toast('Say who you play.'); who.focus(); return; }
      const id = await talk.newPlay({ novelId: P.novelId, chapterId: P.chapterId, who: name, from: from.value.trim() });
      P.playId = id;
      P.offs.push(store.subscribe('play', id, () => { if (P.side === 'play' && P.playId === id && !drawnAlready('play', id)) drawSideSoon(); }));
      drawSide();
      const out = await talk.playSay({ playId: id, text: '' });
      if (out && !out.ok && out.error) toast('The narrator did not answer: ' + out.error, 6000);
    } }, 'Begin the scene')))));
}

let sideFrame = 0;
function drawSideSoon() { if (!sideFrame) sideFrame = requestAnimationFrame(() => { sideFrame = 0; drawSide(); }); }

function drawOnePlay(p) {
  const n = store.peek('novel', P.novelId);
  talk.repairStaleTurns('play', p.id);
  if (!P.offs['play:' + p.id]) { P.offs.push(store.subscribe('play', p.id, () => { if (P.side === 'play' && P.playId === p.id && !drawnAlready('play', p.id)) drawSideSoon(); })); P.offs['play:' + p.id] = true; }
  const c = store.peek('chapter', p.chapterId);
  const full = fullKind() === 'scene';
  const head = h('div.scenehead',
    h('button.icon', { 'aria-label': 'All scenes', onclick: () => { P.playId = null; drawSide(); } }, icon('back', 20)),
    h('div', { style: { flex: '1', minWidth: '0' } }, h('b', { style: { font: '600 18px/1.2 var(--display)' } }, `You play ${p.who}`), h('div', { style: { fontSize: '12.5px', color: 'var(--chrome-soft)' } }, c ? `From ${chapterLabel(n, c, { withName: false })}` : '')),
    h('button.icon', { 'aria-label': full ? 'Leave full screen' : 'Full screen', title: full ? 'Leave full screen' : 'Full screen', onclick: () => sceneFull() }, icon(full ? 'shrink' : 'expand', 18)),
    h('button.icon', { 'aria-label': 'More for this scene', onclick: (e) => menu(e.currentTarget, [
      { label: 'Turn it all into prose (from the start)', hint: 'The whole scene written into the chapter, not just what is new since last time.', run: () => toProse(p, true) },
      { label: 'Remove this scene', hint: 'To Recently deleted; prose already written from it stays.', danger: true, run: async () => {
        if (!(await confirmIt('Remove this scene?', 'It goes to Recently deleted (Settings → Backups) for thirty days. Anything already turned into prose stays in the book.', 'Remove it', { danger: true }))) return;
        store.change('novel', P.novelId, novelSteps.removePlay(p.id), { now: true });
        await store.remove('play', p.id).catch(() => {});
        P.playId = null; drawSide();
      } },
    ]) }, icon('more', 18)));
  ui.rightBody.append(head);
  const box = h('div.talk');
  const turns = p.turns || [];
  const turnedAt = p.turned ? turns.findIndex((t) => t.id === p.turned) : -1;
  turns.forEach((t, i) => {
    box.append(drawTurn('play', p.id, t));
    if (i === turnedAt) box.append(h('p.hint', { style: { textAlign: 'center', margin: '0' } }, '— written into the book up to here —'));
  });
  const working = talk.talkBusy('play', p.id);
  /* the ways it could go, offered after the narrator's last part: a tap plays one */
  const last = turns[turns.length - 1];
  const lv = last && last.by !== 'you' ? picked(last) : null;
  const offered = lv && !lv.streaming && !working ? choicesIn(lv.text) : [];
  if (offered.length) {
    /* a way chosen is his move — with his line to the narrator, when its box is open */
    box.append(h('div.choices', { role: 'group', 'aria-label': 'Three ways it could go' },
      ...offered.map((c) => h('button.choice', { onclick: () => {
        const tb = ui.rightFoot.querySelector('textarea.tellbox');
        const tell = tb && !tb.hidden ? tb.value.trim() : '';
        if (tell) { tb.value = ''; typed.tell = ''; }
        playMove(p, c, tell);
      } }, c))));
  }
  ui.rightBody.append(box);
  const ta = h('textarea', { rows: 1, placeholder: `What does ${p.who} say or do?`, 'aria-label': `What ${p.who} says or does` });
  /* his line to the narrator: how the telling should go, never his character's words */
  const tellBox = h('textarea.tellbox', { rows: 1, placeholder: `Tell the narrator — not ${p.who}’s words (bring someone in, the storm gets worse…)`, 'aria-label': 'Tell the narrator' });
  const kept = typed.key === 'play:' + p.id ? typed : null;
  if (kept && kept.tell) tellBox.value = kept.tell;
  /* open or closed as he left it: closed, what is in it stays but is not sent */
  const tellOpen = Boolean(kept && kept.tellOpen);
  tellBox.hidden = !tellOpen;
  const tellBtn = h('button.chip.toggle', { 'aria-pressed': String(tellOpen), title: 'A line for the narrator about how the scene should go', onclick: () => {
    const now = tellBox.hidden;
    tellBox.hidden = !now;
    tellBtn.setAttribute('aria-pressed', String(now));
    typed.key = 'play:' + p.id; typed.tellOpen = now;
    if (now) tellBox.focus();
  } }, 'Tell the narrator');
  const house = store.peek('house', 'house') || {};
  const choicesBtn = h('button.chip.toggle', { 'aria-pressed': String(Boolean(house.sceneChoices)), title: 'After each part, the narrator offers three things you could do next', onclick: () => {
    const on = !(store.peek('house', 'house') || {}).sceneChoices;
    store.change('house', 'house', (x) => { if (on) x.sceneChoices = true; else delete x.sceneChoices; }, { now: true });
    choicesBtn.setAttribute('aria-pressed', String(on));
    toast(on ? 'After each part, the narrator offers three ways it could go.' : 'No more choices offered.');
  } }, 'Three choices');
  const send = h('button.btn.primary.small', { onclick: async () => {
    if (talk.talkBusy('play', p.id)) { talk.stopTalk('play', p.id); return; }
    const text = ta.value.trim();
    const tell = tellBox.hidden ? '' : tellBox.value.trim();
    ta.value = ''; typed.value = '';
    if (tell) { tellBox.value = ''; typed.tell = ''; }
    await playMove(p, text, tell);
  } }, working ? 'Stop' : 'Send');
  const fresh = talk.transcriptOf(p).count;
  ui.rightFoot.hidden = false;
  ui.rightFoot.append(ta, tellBox, h('div.crow.wrap',
    h('button.btn.small', { disabled: working || !fresh || writer.busy(P.novelId), onclick: () => toProse(p, false), title: 'Write what happened into the chapter as prose' }, 'Turn it into prose'),
    tellBtn, choicesBtn,
    h('span.grow'), send));
  for (const box2 of [ta, tellBox]) box2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
  tellBox.addEventListener('input', () => { typed.key = 'play:' + p.id; typed.tell = tellBox.value; });
  autoGrow(ta, 0.3);
  autoGrow(tellBox, 0.2);
  restoreTyped('play:' + p.id);
  P.drawn = 'play:' + p.id + turnsSig(p);
  placeSide();
}

/* his move — his character's words, a line to the narrator, or both (nothing: it goes on) */
async function playMove(p, text, tell) {
  const out = await talk.playSay({ playId: p.id, text, tell });
  if (out && !out.ok && out.error) toast('The narrator did not answer: ' + out.error, 6000);
  if (out && (out.giveBack || out.giveBackTell)) {
    giveBack('play:' + p.id, out.giveBack || '');
    if (out.giveBackTell) { typed.key = 'play:' + p.id; typed.tell = out.giveBackTell; typed.tellOpen = true; const tb = ui.rightFoot.querySelector('textarea.tellbox'); if (tb && ui.rightFoot.dataset.for === 'play:' + p.id && !tb.value.trim()) { tb.value = out.giveBackTell; tb.hidden = false; } }
  }
}

async function toProse(p, fromStart) {
  const tr = talk.transcriptOf(p, { fromStart });
  if (!tr.count) { toast('Nothing new to write yet.'); return; }
  const n = store.peek('novel', P.novelId);
  const chapterId = n.order.includes(p.chapterId) ? p.chapterId : n.order[n.order.length - 1];
  if (!wide()) closeRight();
  hooks.goChapter(chapterId);
  toast('Writing the scene into the chapter…');
  const out = await writer.playToProse({ novelId: P.novelId, chapterId, play: p, transcript: tr.text, mine: tr.mine, length: (n.prefs && n.prefs.length) || 'scene' });
  if (out && out.ok) {
    /* the scene goes on from the prose now in the book: what was turned rides as the book, not again as talk */
    store.change('play', p.id, turnSteps.set({ turned: tr.lastId, updated: Date.now(), ...(out.passageId ? { after: out.passageId, chapterId } : {}) }), { now: true });
    archivist.nudge(P.novelId);
  } else if (out && !out.stopped && out.error) toast('The scene was not written: ' + out.error, 7000);
}

/* a scene over the whole screen, the narrator's words in the book's own type */
function sceneFull() {
  if (fullKind() === 'scene') { leaveFull(); return; }
  enterFull('scene', () => { ui.right.classList.add('full'); drawSideSoon(); },
    () => { ui.right.classList.remove('full'); drawSideSoon(); });
}

export function paneState() { return P; }
