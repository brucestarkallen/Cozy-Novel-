/* Cozy Novel — js/ui/panes.js — beside the page: the chapters, the notes the
 * helper keeps, the partner, and playing a scene. Drawers on a phone,
 * columns on a wide screen. */

import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as archivist from '../novel/archivist.js';
import * as talk from '../novel/talk.js';
import { h, icon, toast, undoToast, menu, openSheet, confirmIt, askText, autoGrow, copyText, field, onBack } from './dom.js';
import { picked, chapterSteps, novelSteps, chapterWords, chapterLabel, newCard, NOTE_KINDS, turnSteps, hisStamp } from '../novel/shape.js';
import { numberWords, plural, timeAgo, nameKey, openOf } from '../util.js';
import { showSent } from './sent.js';
import { webUrl } from '../model/call.js';
import { thinkBox, updateThinkBox } from './think.js';
import { wordsOf, changesComing, editableOf, partsOf, labelNow, wordsNow } from '../novel/changes.js';
import { enterFull, leaveFull, fullKind } from './full.js';
import { paced, follower, streamLines } from './live.js';
import { drawProse, growProse } from './prose.js';
import * as desk from './desk.js';
import { sceneWords, choicesIn, nowLabelOf } from '../novel/prompts.js';
import { openBranch, branchBusy } from './branches.js';
import { makeTimeline } from './timeline.js';

let ui = null;
let hooks = {};
let SF = null;           /* the follow law beside the page (live.js) */
let paneFocus = null;    /* a control hidden by the new media query before resize fires */
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
  document.addEventListener('focusin', (e) => { paneFocus = ui.left.contains(e.target) || ui.right.contains(e.target) ? e.target : null; });
  document.addEventListener('focusout', (e) => {
    /* Ordinary blur lets go. A column becoming hidden at the breakpoint
     * keeps the control long enough for dockWide to put it in its drawer. */
    if (e.target === paneFocus && !e.relatedTarget && (!paneFocus.isConnected || getComputedStyle(paneFocus).visibility !== 'hidden')) paneFocus = null;
  });
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
  if (P.novelId !== novelId) { P.playId = null; notesView = 'cards'; notesTimeline?.destroy(); notesTimeline = null; }
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
  const focused = document.activeElement === document.body && paneFocus?.isConnected ? paneFocus : document.activeElement;
  const carryLeft = !w && ui.left.classList.contains('dock') && ui.left.contains(focused);
  const carryRight = !w && ui.right.classList.contains('dock') && !ui.right.classList.contains('full') && ui.right.contains(focused);
  /* A drawer he is using becomes a column when there is room. A saved
   * closed column still starts closed; opening a drawer is what changes it. */
  if (w && P.leftOpen) keep('cozynovel.left', 'on');
  if (w && P.rightOpen) keep('cozynovel.right', 'on');
  ui.left.classList.toggle('dock', w && kept('cozynovel.left') !== 'off');
  ui.right.classList.toggle('dock', w && kept('cozynovel.right') === 'on');
  /* wide enough for columns: a drawer open from the narrow screen closes (its Back step with it) */
  if (w) { closeLeft(); closeRight(false, { keepFull: true }); ui.scrim.classList.remove('on'); }
  /* On the way back, keep only the column he is actually using. Reuse its
   * controls so a half-written sentence and its selection never move. A
   * full-screen pane owns its own Back step and is already visible. */
  else if (carryLeft && !P.leftOpen) {
    closeRight();
    P.leftOpen = true;
    ui.left.classList.add('open');
    ui.scrim.classList.add('on');
    P.release.left = onBack(() => closeLeft(true));
  } else if (carryRight && !P.rightOpen) {
    closeLeft();
    P.rightOpen = true;
    ui.right.classList.add('open');
    ui.scrim.classList.add('on');
    P.release.right = onBack(() => closeRight(true));
  }
  mirrorDock();
  if ((carryLeft || carryRight) && focused !== document.activeElement) focused.focus({ preventScroll: true });
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
  const hadFocus = ui.left.contains(document.activeElement);
  P.leftOpen = false;
  ui.left.classList.remove('open');
  if (!P.rightOpen) ui.scrim.classList.remove('on');
  if (!fromBack && P.release.left) P.release.left();
  P.release.left = null;
  if (hadFocus && !ui.left.classList.contains('dock')) document.getElementById('bookTitle')?.focus({ preventScroll: true });
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
export function closeRight(fromBack = false, { keepFull = false } = {}) {
  if (!P.rightOpen) return;
  const hadFocus = ui.right.contains(document.activeElement);
  if (!keepFull && (fullKind() === 'scene' || fullKind() === 'partner')) leaveFull();
  P.rightOpen = false;
  ui.right.classList.remove('open');
  if (!P.leftOpen) ui.scrim.classList.remove('on');
  if (!fromBack && P.release.right) P.release.right();
  P.release.right = null;
  if (hadFocus && !ui.right.classList.contains('dock')) document.getElementById(P.side === 'partner' ? 'partnerBtn' : P.side === 'notes' ? 'notesBtn' : 'moreBtn')?.focus({ preventScroll: true });
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
  /* Save acknowledgements and helper summaries arrive while he is using
   * this list. Keep its buttons, focus and open menu anchors in place. */
  let list = ui.leftBody.querySelector('.chlist');
  if (!list) {
    list = h('ol.chlist');
    ui.leftBody.replaceChildren(h('p.pane-kicker', 'The shape of your story'), list,
      h('div.btnrow.chapter-add', h('button.btn', { title: 'Begin a fresh chapter at the end of the book.', onclick: () => {
        const now = store.peek('novel', P.novelId);
        if (!now) return;
        closeLeft(); desk.newChapterAfter(now.order[now.order.length - 1]);
      } }, icon('plus', 16), 'New chapter')),
      h('p.hint.chapter-total', { style: { textAlign: 'center', marginTop: '14px' } }));
  }
  const active = document.activeElement;
  const rows = new Map([...list.children].map((li) => [li.dataset.id, li]));
  n.order.forEach((id, i) => {
    const c = store.peek('chapter', id);
    const words = c ? chapterWords(c) : 0;
    let li = rows.get(id);
    if (!li) li = h('li', { 'data-id': id },
      h('button.go', { onclick: () => { closeLeft(); hooks.goChapter(id); } }, h('span.n'), h('span.nm'), h('span.w'), h('span.sum')),
      h('button.menu', { 'aria-label': 'More for this chapter', onclick: (e) => chapterMenu(e.currentTarget, id, (store.peek('novel', P.novelId)?.order || []).indexOf(id)) }, icon('more', 18)));
    rows.delete(id);
    li.classList.toggle('on', id === P.chapterId);
    const go = li.querySelector('.go');
    if (id === P.chapterId) go.setAttribute('aria-current', 'page'); else go.removeAttribute('aria-current');
    li.querySelector('.n').textContent = `Chapter ${numberWords(i + 1)}`;
    const name = li.querySelector('.nm');
    name.textContent = c?.name || (words ? openingOf(c) : 'Not begun');
    name.style.fontStyle = c?.name ? '' : 'italic';
    name.style.opacity = c?.name ? '' : '.75';
    li.querySelector('.w').textContent = plural(words, 'word');
    const summary = li.querySelector('.sum');
    summary.textContent = c?.summary?.text || '';
    summary.hidden = !summary.textContent;
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });
  for (const li of rows.values()) li.remove();
  if (active?.isConnected && list.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
  const words = n.order.reduce((a, id) => a + chapterWords(store.peek('chapter', id) || { passages: [] }), 0);
  ui.leftBody.querySelector('.chapter-total').textContent = `${plural(n.order.length, 'chapter')} · ${plural(words, 'word')} in all`;
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
  const novelId = P.novelId;
  const n = store.peek('novel', novelId);
  const c = store.peek('chapter', id);
  const words = c ? chapterWords(c) : 0;
  if (!(await confirmIt('Remove this chapter?', `${chapterLabel(n, c)}${words ? ` and its ${plural(words, 'word')}` : ''} go to Recently deleted (Settings → Backups) for thirty days.`, 'Remove it', { danger: true }))) return;
  /* a page being written into it stops: there is nowhere left to keep it (Tavern M675) */
  writer.stopIn(novelId, id);
  try { await store.remove('chapter', id); }
  catch (_) { toast('The chapter could not be removed. Try again in a moment.', 6000); return; }
  /* Only a chapter the phone removed leaves the book and its readings.
   * Apply the change by id to the current order, preserving edits made while
   * the request was on its way. */
  const current = store.peek('novel', novelId);
  if (!current) return;
  const i = current.order.indexOf(id);
  archivist.retireChapter(novelId, c);
  store.change('novel', novelId, novelSteps.removeChapter(id), { now: true });
  await store.flush('novel', novelId);
  archivist.nudge(novelId);
  writer.recount(novelId);
  if (P.novelId !== novelId) return;
  if (id === P.chapterId) hooks.goChapter(current.order[Math.max(0, Math.min(i, current.order.length - 1))]);
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

/* Each conversation and scene keeps its own unsent words on the phone.
 * The small in-memory copy also keeps selection during a redraw. */
const typed = { key: '', value: '', focus: false };
const composerDrafts = new Map();
const composerBooks = new Map();
const composerView = new Map();
let restoringComposer = false;
function composerOf(key, novelId = composerBooks.get(key) || P.novelId) {
  return composerDrafts.get(key) || store.peek('draft', novelId)?.composers?.[key] || { value: '', tell: '', tellOpen: false };
}
function keepComposer(novelId, key, words) {
  const next = { value: words.value || '', tell: words.tell || '', tellOpen: Boolean(words.tellOpen) };
  const prior = composerOf(key, novelId);
  composerBooks.set(key, novelId);
  if (JSON.stringify(prior) === JSON.stringify(next)) return;
  composerDrafts.set(key, next);
  const save = async () => {
    let d = store.peek('draft', novelId);
    if (d === undefined) d = await store.open('draft', novelId);
    if (composerDrafts.get(key) !== next) return;
    if (!d) await store.create('draft', novelId, { id: novelId, novelId, composers: { [key]: next } });
    else store.change('draft', novelId, x => { x.composers ||= {}; x.composers[key] = { ...next }; }, { delay: 300 });
    await new Promise(resolve => setTimeout(resolve, 350));
    if (composerDrafts.get(key) !== next) return;
    await store.flush('draft', novelId);
    /* A clean copy follows later saves from another window. An unfinished
     * save or the deliberately blank box of a sent message keeps its copy. */
    if (composerDrafts.get(key) === next) {
      composerDrafts.delete(key);
      const latest = store.peek('draft', novelId)?.composers?.[key];
      if (latest && JSON.stringify(latest) !== JSON.stringify(next) && ui.rightFoot.dataset.for === key && JSON.stringify(composerView.get(key)) === JSON.stringify(next)) restoreTyped(key, novelId);
    }
  };
  save().catch(() => { /* the window keeps the words until the phone answers */ });
}
function keepTyped() {
  if (restoringComposer) return;
  const ta = ui.rightFoot.querySelector('textarea');
  const key = ui.rightFoot.dataset.for;
  if (!ta || !key) return;
  const tb = ui.rightFoot.querySelector('textarea.tellbox');
  Object.assign(typed, { key, value: ta.value, focus: document.activeElement === ta,
    selection: [ta.selectionStart, ta.selectionEnd], tell: tb?.value || '', tellOpen: Boolean(tb && !tb.hidden),
    tellFocus: tb && document.activeElement === tb, tellSelection: tb ? [tb.selectionStart, tb.selectionEnd] : null });
  const words = { value: typed.value, tell: typed.tell, tellOpen: typed.tellOpen };
  if (JSON.stringify(composerView.get(key)) !== JSON.stringify(words)) {
    composerView.set(key, words);
    keepComposer(ui.rightFoot.dataset.book, key, words);
  }
}
export function unsentWords() {
  const boxes = ui ? [...ui.rightFoot.querySelectorAll('textarea')] : [];
  if (boxes.some(t => t.value.trim())) return true;
  return [...composerBooks.keys()].some(key => {
    const d = composerOf(key);
    return String(d.value || '').trim() || String(d.tell || '').trim();
  });
}
export async function saveComposersForBranch(novelId) {
  if (P.novelId === novelId) keepTyped();
  const words = [...composerDrafts].filter(([key]) => composerBooks.get(key) === novelId);
  if (!words.length) { await store.flush('draft', novelId); return; }
  let d = store.peek('draft', novelId);
  if (d === undefined) d = await store.open('draft', novelId);
  if (!d) await store.create('draft', novelId, { id: novelId, novelId, composers: Object.fromEntries(words) });
  else store.change('draft', novelId, x => {
    x.composers ||= {};
    for (const [key, value] of words) x.composers[key] = { ...value };
  }, { now: true });
  await store.flush('draft', novelId);
}
export function restoreTyped(key, novelId = P.novelId) {
  const cursor = { ...typed };
  ui.rightFoot.dataset.for = key;
  ui.rightFoot.dataset.book = novelId;
  composerBooks.set(key, novelId);
  const ta = ui.rightFoot.querySelector('textarea');
  if (!ta) return;
  const saved = composerOf(key, novelId);
  composerView.set(key, { value: saved.value || '', tell: saved.tell || '', tellOpen: Boolean(saved.tellOpen) });
  ta.value = saved.value || '';
  const tb = ui.rightFoot.querySelector('textarea.tellbox');
  if (tb) {
    tb.value = saved.tell || '';
    tb.hidden = !saved.tellOpen;
    ui.rightFoot.querySelector('.tell-toggle')?.setAttribute('aria-pressed', String(Boolean(saved.tellOpen)));
  }
  restoringComposer = true;
  try { if (tb) tb.dispatchEvent(new Event('input')); ta.dispatchEvent(new Event('input')); }
  finally { restoringComposer = false; }
  if (cursor.key === key) {
    const target = cursor.tellFocus && tb ? tb : cursor.focus ? ta : null;
    const selection = target === tb ? cursor.tellSelection : cursor.selection;
    if (target) { target.focus({ preventScroll: true }); if (selection) target.setSelectionRange(...selection); }
  }
}
/* The sent draft stays on disk until the operation settles. A new sentence
 * typed meanwhile gets its own save and cannot be cleared by this answer. */
function beginComposerSend(key, { value = true, tell = false } = {}) {
  keepTyped();
  const novelId = composerBooks.get(key) || P.novelId;
  const standing = composerOf(key, novelId);
  const before = ui.rightFoot.dataset.for === key
    ? { value: typed.value, tell: typed.tell, tellOpen: typed.tellOpen } : { ...standing };
  const after = { ...standing, ...(value && standing.value === before.value ? { value: '' } : {}), ...(tell && standing.tell === before.tell ? { tell: '' } : {}) };
  composerDrafts.set(key, after);
  composerView.set(key, after);
  if (ui.rightFoot.dataset.for === key) {
    const ta = ui.rightFoot.querySelector('textarea');
    const tb = ui.rightFoot.querySelector('textarea.tellbox');
    if (value && ta) ta.value = after.value;
    if (tell && tb) tb.value = after.tell;
    Object.assign(typed, after);
  }
  return { key, novelId, before, after, value, tell };
}
function endComposerSend(sent, out) {
  const { key, novelId, before, after, value, tell } = sent;
  if (out?.giveBack || out?.giveBackTell) {
    const current = { ...composerOf(key, novelId) };
    const join = (old, next) => old && next && old !== next ? `${old}\n\n${next}` : old || next;
    if (value && out.giveBack) current.value = join(before.value || out.giveBack, current.value);
    if (tell && out.giveBackTell) { current.tell = join(before.tell || out.giveBackTell, current.tell); current.tellOpen = true; }
    keepComposer(novelId, key, current);
    if (ui.rightFoot.dataset.for === key) restoreTyped(key, novelId);
    return;
  }
  const d = store.peek('draft', novelId);
  if (d) {
    store.change('draft', novelId, x => {
      if (JSON.stringify(x.composers?.[key]) === JSON.stringify(before)) x.composers[key] = { ...after };
    }, { delay: 300 });
    store.flush('draft', novelId).then(() => { if (composerDrafts.get(key) === after) composerDrafts.delete(key); }).catch(() => {});
  }
}

/* each drawing of the side pane counts: one overtaken while it waited for a
 * record stops there, so nothing is drawn twice (Cozy Tavern's M245-1) */
let sideGen = 0;
function drawSide() {
  if (!ui) return;
  sideGen++;
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
  /* A helper reading never removes a timeline filter under his fingers. */
  if (P.side === 'notes' && notesView === 'timeline' && notesTimeline?.novelId === P.novelId && notesTimeline.el.isConnected) {
    notesTimeline.update(P.chapterId);
    return;
  }
  notesTimeline?.destroy();
  notesTimeline = null;
  ui.rightBody.textContent = '';
  ui.rightFoot.textContent = '';
  ui.rightFoot.hidden = true;
  if (P.side === 'notes') { drawNotes(); ui.rightBody.scrollTop = scroll; }
  else if (P.side === 'partner') drawPartner();
  else drawPlay();
}

/* ---------------------------------------------------------------- notes */

const KIND_TITLE = { people: 'People', places: 'Places', lore: 'Things worth remembering', threads: 'Threads' };
let notesView = 'cards', notesTimeline = null;

/* Both views belong to the same notebook. The timeline links back to these
 * cards and to the existing reading action, never to another set of notes. */
function notesViews() {
  const views = h('div.segmented.notes-views', { role: 'group', 'aria-label': 'Notebook view' });
  for (const [value, label, title] of [['cards', 'Cards', 'Read or edit the notes that travel with your story.'], ['timeline', 'Timeline', 'Follow changes in people, relationships and threads, with their source passages.']]) {
    views.append(h('button', { 'data-notes-view': value, title, 'aria-pressed': String(notesView === value), onclick: () => {
      if (notesView === value) return;
      notesView = value;
      drawSide();
      ui.rightBody.querySelector(`[data-notes-view="${value}"]`)?.focus({ preventScroll: true });
      ui.rightBody.scrollTop = 0;
    } }, label));
  }
  return views;
}

function drawNotes() {
  const n = store.peek('novel', P.novelId);
  if (!n) return;
  const novelId = P.novelId;
  const l = archivist.lightOf(novelId);
  const totalCards = NOTE_KINDS.reduce((a, k) => a + ((n.notes && n.notes[k]) || []).length, 0);
  ui.rightBody.append(h('div.pane-intro', h('p.pane-kicker', 'Beside the story'), h('div.pane-title-row', h('h2', 'Your notebook'), h('span.pane-count', plural(totalCards, 'card')))));
  ui.rightBody.append(notesViews());
  if (notesView === 'timeline') {
    notesTimeline = makeTimeline({ novelId, chapterId: P.chapterId,
      current: () => P.novelId === novelId && P.side === 'notes' && notesView === 'timeline' && location.hash.split('/')[2] === novelId,
      openCard: (kind, id) => {
        const now = store.peek('novel', novelId);
        if (now?.notes?.[kind]?.some((card) => card.id === id)) editCard(kind, id);
        else toast('This card is no longer in the notes.');
      },
      jumpSource: (chapterId, passageId, query) => { closeRight(); desk.whenOpen(chapterId, { passageId, show: { query } }); },
      readAgain: () => {
        notesView = 'cards';
        drawSide();
        const button = ui.rightBody.querySelector('[data-read-whole-book]');
        button?.scrollIntoView({ block: 'center' });
        button?.focus({ preventScroll: true });
        button?.click();
      },
    });
    ui.rightBody.append(notesTimeline.el);
    notesTimeline.update();
    return;
  }
  const card = h('div.lightcard.note-status', { 'data-state': l.state },
    h('div.note-status-heading', h('span.note-status-light', { 'aria-hidden': 'true' }), h('h3', l.state === 'off' ? 'No helper chosen' : l.state === 'reading' ? 'Reading your story' : l.state === 'trouble' ? 'The helper needs a hand' : l.state === 'waiting' ? 'Waiting to read' : 'Keeping the story close')),
    h('p.note-status-copy', l.state === 'off' ? 'Choose one in Settings → Connections to keep your notes up to date. Your own cards are always yours to edit.' : l.words));
  const row = h('div.row');
  const m = n.memory || {};
  const u = m.undo;
  const again = archivist.rereading(novelId);
  /* waiting out a failure, or stopped: tried again now, by his hand */
  if (archivist.stalled(novelId)) row.append(h('button.btn.primary.small', { title: 'The helper tries again at once — even after its connection was turned away. It stops again only if the trouble is still there.', onclick: () => { if (archivist.tryNow(novelId)) toast('The helper tries again now.'); drawSide(); } }, 'Try again now'));
  if (again) row.append(h('button.btn.small', { title: 'Stops reading the whole book again and puts back the notes, the summaries’ marks and what it keeps of the book as they were before — anything you edited since stays as you left it.', onclick: () => { if (archivist.undoLast(novelId)) toast('Stopped — the notes are back as they were.'); drawSide(); } }, 'Stop, and put the notes back'));
  else if (u && ((Array.isArray(u.cards) ? u.cards.length : u.notes) || (u.kept && Object.keys(u.kept).length))) row.append(h('button.btn.small', { title: 'Puts back only what the helper’s last reading changed — a card you edited since stays as you left it.', onclick: () => { if (archivist.undoLast(novelId)) toast('What that reading changed is put back — anything you edited since stays as you left it.'); drawSide(); } }, 'Undo the last reading'));
  /* the auditor: the whole notes held against the book as it stands */
  const asked = Boolean(m.auditAsked);
  const off = l.state === 'off';
  const cards = NOTE_KINDS.reduce((a, k) => a + ((n.notes && n.notes[k]) || []).length, 0);
  row.append(h('button.btn.small', { title: `The helper holds every card against the book as it stands — puts right what drifted, folds cards that repeat each other into one, and says why for each; your own words stay. It does this by itself every ${archivist.AUDIT_EVERY} readings.`, disabled: asked && !off && cards > 0, onclick: () => {
    if (off) { toast('No helper is chosen, so the notes are not kept or checked. Choose one in Settings → Connections.', 6000); return; }
    if (!cards) { toast('There are no notes to check yet — the helper writes them as the book is read.'); return; }
    archivist.askAudit(novelId);
    toast('The helper is checking the notes against the book — what it finds shows here.');
    drawSide();
  } }, asked && !off && cards > 0 ? 'Checking the notes…' : 'Check the notes against the book'));
  row.append(h('button.btn.quiet.small', { 'data-read-whole-book': '', title: 'The helper reads every chapter from the start and writes its notes and summaries afresh — your own cards and summaries stay. Until it is done, everything goes on with the notes as they are now.', disabled: again, onclick: async () => {
    /* never begun with no helper to finish it: the notes it would rebuild are never left half gone */
    if (off) { toast('No helper is chosen, so the book cannot be read again. Choose one in Settings → Connections.', 6000); return; }
    if (!(await confirmIt('Read the whole book again?', 'The helper reads every chapter from the start and writes its notes and summaries afresh — and, for a book set to Automatic, What it’s about and How it reads. Your own cards, your own summaries and your corrections stay as they are; a card you took out comes back if the book still tells of them. Until it is done, the writer and the rest go on with the notes as they are now; Undo puts back what is there now.', 'Read it again'))) return;
    archivist.readAgain(novelId);
    drawSide();
  } }, again ? 'Reading the whole book again…' : 'Read the whole book again'));
  card.append(row);
  ui.rightBody.append(card);
  /* the last check, for him to read: whether everything holds and he can carry on, and why for each change */
  ui.rightBody.append(checkReport(n, { asked, off, cards }));
  /* what its model would not read, set aside — each with Read it again, labelled where it stands now */
  const aside = archivist.asideNow(n);
  if (aside.length) {
    const box = h('div.lightcard.aside', h('b', aside.length === 1 ? 'Not in the notes: one part its model would not read' : `Not in the notes: ${aside.length} parts its model would not read`));
    const rows = h('div');
    const drawRows = (all) => {
      rows.textContent = '';
      for (const a of all ? aside : aside.slice(0, 12)) {
        /* words taken out are gone from the book: nothing to read again — the notes' check puts right what they may still say */
        rows.append(h('div.asiderow', h('div', h('b', a.label || 'A passage'), a.why ? ` — ${a.why}` : '', a.at ? ` (${timeAgo(a.at)})` : '', a.out ? '. The notes may still hold what it said — the next check against the book puts that right.' : ''),
          a.out
            ? h('button.btn.quiet.small', { title: 'It is no longer shown here.', onclick: () => { archivist.readAside(novelId, a.key); drawSide(); } }, 'Let it go')
            : h('button.btn.quiet.small', { title: 'The helper reads it afresh — set aside again only if its model still will not read it.', onclick: () => { if (archivist.readAside(novelId, a.key)) toast('The helper reads it again in a moment.'); drawSide(); } }, 'Read it again')));
      }
      if (!all && aside.length > 12) rows.append(h('button.btn.quiet.small', { title: `Shows all ${aside.length}.`, onclick: () => drawRows(true) }, `Show all ${aside.length}`));
    };
    drawRows(false);
    box.append(rows);
    if (aside.length > 1) box.append(h('div.btnrow', h('button.btn.quiet.small', { title: 'Every part here read afresh by the helper — set aside again only where its model still will not read it. What was taken out is let go.', onclick: () => { const k = archivist.readAllAside(novelId); if (k) toast(`The helper reads ${k === 1 ? 'it' : `all ${k}`} again in a moment.`); drawSide(); } }, 'Read them all again')));
    ui.rightBody.append(box);
  }
  /* what the light on a card means — every card is sent, lit or not */
  const lit = m.lit || (u && u.changed && u.changed.length ? { at: u.at, label: u.label, changed: u.changed } : null);
  const how = new Map((lit && lit.changed || []).map((c) => [c.kind + ':' + nameKey(c.name), c.how]));
  const whyOf = new Map((lit && lit.changed || []).filter((c) => c.why).map((c) => [c.kind + ':' + nameKey(c.name), c.why]));
  const gone = (lit && lit.changed || []).filter((c) => c.how === 'gone').map((c) => c.name);
  const key = h('div.lightcard.keycard.note-guide', h('h3.pane-section-title', 'Always with the story'), h('p.notekey', { title: 'Each version of a passage keeps its own notes: another take or a rewrite takes the old version’s notes back out, and the arrows bring a version’s notes back with it. A card you wrote or changed keeps your words — the helper only moves where they are now and how they stand with others.' },
    again ? 'Every card here goes to the helper as it reads the book again; until it is done, the writer and the rest are sent the notes as they were before. ' : 'Every card here goes to the writer before every page, lit or not. ',
    lit ? h('span', h('b.lit', 'Lit'), ` — changed by the helper last (${lit.label}, ${timeAgo(lit.at)})`, gone.length ? `; took out ${gone.slice(0, 6).join(', ')}${gone.length > 6 ? '…' : ''}` : '', '. ') : null,
    h('b.yours', 'Yours'), ' — your own words, kept.'));
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
      box.append(h('div.card.notecard' + (state ? '.fresh' : '') + (kind === 'threads' && c.open === false ? '.closed' : ''), {
        role: 'button', tabindex: 0, 'aria-label': `Edit ${c.name}`, title: `Open ${c.name} to read or edit the card`,
        onclick: () => editCard(kind, c.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editCard(kind, c.id); } },
      },
        h('div.nm', c.name + (kind === 'threads' && c.open === false ? ' — closed' : ''),
          state ? h('span.ctag.lit', state === 'new' ? 'new' : 'updated') : null,
          mine ? h('span.ctag.yours', 'yours') : null),
        c.aka && c.aka.length ? h('div.aka', 'also ' + c.aka.join(', ')) : null,
        state && whyOf.get(kind + ':' + nameKey(c.name)) ? h('div.why', 'Why: ' + whyOf.get(kind + ':' + nameKey(c.name))) : null,
        c.about ? h('div.ab', c.about) : null,
        c.since && String(c.since).trim() ? h('div.nw.since', { title: 'What the book has told of them since your words — kept beside them, never over them.' }, h('b', 'Since then'), c.since) : null,
        kind === 'people' && c.ties ? h('div.nw.ties', h('b', 'With others'), c.ties) : null,
        kind === 'people' && c.now ? h('div.nw', h('b', nowLabelOf(n, c, 'Now')), c.now) : null));
    }
    if (!cards.length) box.append(h('p.notes-empty', kind === 'people' ? 'The people of your story will gather here.' : kind === 'places' ? 'A place for every corner of your world.' : kind === 'threads' ? 'Keep the questions your story has yet to answer.' : 'The small details that make your world its own.'));
    box.append(h('button.btn.quiet.small.note-add', { title: `Add your own card to ${KIND_TITLE[kind].toLowerCase()}.`, onclick: () => editCard(kind, null) }, icon('plus', 14), 'Add'));
    sec.append(head, box);
    ui.rightBody.append(sec);
  }
  ui.rightBody.append(key, readingsSection());
}

/* The notes' last check against the book, in plain words (his ask: "whether
 * everything is already right and I can carry on"): every card holds, or
 * what it put right — each with why — and what it could not settle; when it
 * checks next. */
function checkReport(n, { asked, off, cards }) {
  const m = n.memory || {};
  const a = m.audit || {};
  const box = h('div.lightcard.checkbox', h('div.note-report-label', icon('check', 14), 'Notes & continuity'));
  const left = Math.max(0, archivist.AUDIT_EVERY - (a.reads || 0));
  const next = left ? `It checks again by itself after ${plural(left, 'more reading')}.` : 'It checks again as soon as what is new is read.';
  if (off) { box.classList.add('note-report-quiet'); box.append(h('b', 'Not checked: no helper is chosen.')); return box; }
  if (!cards) { box.append(h('b', 'Nothing to check yet.'), ` The helper writes the notes as the book is read, and checks them against the book every ${archivist.AUDIT_EVERY} readings.`); return box; }
  if (asked) {
    box.append(h('b', 'Checking the notes against the book…'), ' It begins as soon as what is new has been read; what it finds shows here.');
    if (!a.checked) return box;
    box.append(h('p.notekey', 'The check before this one:'));
  }
  if (!a.checked) { box.append(h('b', 'Not checked against the book yet.'), ` ${next} Check the notes against the book does it now.`); return box; }
  if (a.failed) { box.append(h('b', `The last check could not be made (${timeAgo(a.at)}).`), ` It could not check them: ${a.failed}. ${next}`); return box; }
  /* notes too long for its model, checked a group at a time one straight after another: a round done is one check of every card, said as one (Cozy Tavern M752-017) */
  const roundDone = Boolean(a.some) && a.roundLeft === 0 && (a.roundAll || 0) > 0;
  const roundGoing = Boolean(a.some) && (a.roundLeft || 0) > 0;
  const changes = (roundDone ? a.roundChanges : a.changes) || [];
  /* counted from what it changed, never from the list kept to show */
  const fixed = roundDone && Number.isFinite(a.roundFixed) ? a.roundFixed : Number.isFinite(a.fixed) ? a.fixed : changes.length;
  const refused = a.refused || [];
  const earlier = (a.earlier || []).filter((x) => x && (x.verdict || (x.refused || []).length));
  /* "you can carry on" only for the whole notes, checked and clear (a group checked says how many) */
  const whose = roundDone ? '' : roundGoing ? `${a.roundAll - a.roundLeft} of the ${a.roundAll} cards so far` : a.some ? `${a.some.checked} of the ${a.some.all} cards` : '';
  /* a verdict is of the book as it was checked: once newer pages are read into the notes it says so, never "you can carry on" over them (Cozy Tavern M694) */
  const since = a.reads || 0;
  const hold = since ? 'held true to the book then' : 'hold true to the book';
  const tail = since ? ` ${plural(since, 'reading')} of newer pages since, not checked yet — ${next.charAt(0).toLowerCase()}${next.slice(1)}` : ' You can carry on.';
  const head = a.clear === false || (roundDone && earlier.length)
    ? `Checked ${timeAgo(a.at)}${whose ? ` (${whose})` : ''} — something is worth a look:`
    : whose ? `Checked ${timeAgo(a.at)} — ${whose}${fixed ? `: ${plural(fixed, 'card')} put right, the rest ${hold}` : `, and they ${hold}`}.`
    : fixed ? `Checked ${timeAgo(a.at)} — ${plural(fixed, 'card')} put right, the rest ${hold}.${tail}`
    : `Checked ${timeAgo(a.at)} — every card ${since ? 'held true to the book then' : 'holds true to the book'}.${tail}`;
  box.append(h('b', head));
  if (a.verdict) box.append(h('p.verdict', a.verdict));
  if (changes.length) {
    const ul = h('ul.checklist');
    for (const c of changes.slice(0, 20)) ul.append(h('li', h('b', c.name), ` — ${c.how === 'new' ? 'added' : c.how === 'gone' ? 'taken out' : 'put right'}${c.why ? ': ' + c.why : ''}`));
    if (fixed > 20) ul.append(h('li', `and ${fixed - 20} more`));
    box.append(ul);
    const u = m.undo;
    if (u && u.label === 'the notes checked against the book' && (u.at || 0) >= (a.at || 0) - 5000) box.append(h('p.notekey', 'Undo the last reading, above, puts back what it changed.'));
  }
  /* what it would have changed and did not (Cozy Tavern M259-6): never certified as put right */
  if (refused.length) {
    box.append(h('p.notekey', 'Seen, and left as it is — worth a look:'));
    const ul = h('ul.checklist');
    for (const r of refused.slice(0, 20)) ul.append(h('li', h('b', r.name), ` — ${r.why}`));
    const all = Number.isFinite(a.refusedAll) ? a.refusedAll : refused.length;
    if (all > 20) ul.append(h('li', `and ${all - 20} more`));
    box.append(ul);
  }
  /* what the earlier groups of this round left open, until the round comes back to the start */
  if (earlier.length) {
    box.append(h('p.notekey', 'From the cards checked before these:'));
    const ul = h('ul.checklist');
    for (const x of earlier) ul.append(h('li', `${timeAgo(x.at)}: ${x.verdict || 'something was worth a look'}${(x.refused || []).length ? ` (left as it is: ${x.refused.slice(0, 4).map((r) => r.name).join(', ')}${x.refused.length > 4 ? '…' : ''})` : ''}`));
    box.append(ul);
  }
  if (roundDone) box.append(h('p.notekey', `The notes are longer than its model holds, so all ${a.roundAll} cards were checked a group at a time, one group straight after another.`));
  else if (roundGoing) box.append(h('p.notekey', `The notes are longer than its model holds, so they are checked a group at a time, one group straight after another — ${a.roundAll - a.roundLeft} of the ${a.roundAll} cards so far.`));
  else if (a.some) box.append(h('p.notekey', `The notes are longer than its model holds, so ${a.some.checked} of the ${a.some.all} cards were checked this time — the rest in turn, at the next checks.`));
  if (a.partial) box.append(h('p.notekey', 'The book is longer than its model holds, so its oldest chapters were checked by their summaries — a card was changed only where the words it saw say otherwise.'));
  box.append(h('p.notekey', next));
  return box;
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
  /* Show all is all of them (it drew sixty, the rest out of reach and unsaid — Cozy Tavern M134) */
  for (const r of all ? rows : rows.slice(0, 8)) {
    const what = r.changed.length ? r.changed.slice(0, 6).map((c) => `${c.how === 'new' ? 'new' : c.how === 'gone' ? 'took out' : 'updated'} ${c.name}`).join(', ') + (r.changed.length > 6 ? '…' : '') : 'changed nothing';
    const state = r.live ? 'in the notes now' : r.shown ? 'the version on show — not read into the notes yet' : 'an earlier version — its notes come back when you pick it';
    box.append(h('div.card.reading' + (r.live ? '.fresh' : ''),
      h('div.nm', r.label, h('span.ctag' + (r.live ? '.lit' : ''), r.live ? 'in the notes' : r.shown ? 'on show' : 'earlier version')),
      h('div.ab', { title: state }, `${timeAgo(r.at)} · ${what}`),
      r.live ? h('div.row', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
        h('button.btn.small.quiet', { title: 'Takes out only what this reading changed; a card changed since stays as it is.', onclick: (e) => { e.stopPropagation(); if (archivist.putBackReading(P.novelId, r.pid, r.vid)) toast('What that reading changed is put back — anything changed since stays as it is.'); drawSide(); } }, 'Put back'),
        h('button.btn.small.quiet', { title: 'Puts it back, then the helper reads that passage afresh.', onclick: (e) => { e.stopPropagation(); if (archivist.putBackReading(P.novelId, r.pid, r.vid, { readAgain: true })) toast('Put back — the helper reads that passage again in a moment.'); drawSide(); } }, 'Read again')) : null));
  }
  if (!all && rows.length > 8) box.append(h('button.btn.quiet.small', { title: `Shows every one of the ${rows.length} kept.`, onclick: () => { P.readingsAll = P.novelId; drawSide(); } }, `Show all ${rows.length}`));
  sec.append(head, box);
  return sec;
}

/* what he typed into a card and left without saving, kept for when he opens
 * it again (Cozy Tavern's M611/M618: the edit box keeps its words on Back) */
const cardDrafts = new Map();
/* Note boxes use the book's existing draft record, so closing a browser or
 * Android suspending it does not throw away words left without Save. */
function keepCardDraft(novelId, key, words, expected = null) {
  if (words) cardDrafts.set(key, words); else cardDrafts.delete(key);
  const save = async () => {
    let d = store.peek('draft', novelId);
    if (d === undefined) d = await store.open('draft', novelId);
    if (cardDrafts.get(key) !== words) return;
    if (!d) {
      if (words) await store.create('draft', novelId, { id: novelId, novelId, cards: { [key]: words } });
      return;
    }
    store.change('draft', novelId, (x) => {
      x.cards = x.cards || {};
      if (expected && JSON.stringify(x.cards[key] || null) !== JSON.stringify(expected)) return;
      if (words) x.cards[key] = JSON.parse(JSON.stringify(words)); else delete x.cards[key];
    }, { delay: 300 });
  };
  save().catch(() => { /* kept in this window until the phone answers */ });
}

/* A card, by his hand. Only the boxes he typed in are written, onto the card
 * as it stands when he saves — a change the helper made while it was open
 * stands (Cozy Tavern's M426/M428); a name he changes keeps the old one among
 * the others it goes by. */
async function editCard(kind, id) {
  const novelId = P.novelId;
  if (store.peek('draft', novelId) === undefined) { try { await store.open('draft', novelId); } catch (_) { /* the local draft still works */ } }
  if (P.novelId !== novelId) return;
  const n = store.peek('novel', novelId);
  if (!n) return;
  const cur = id ? (n.notes[kind] || []).find((c) => c.id === id) : null;
  const c = cur ? JSON.parse(JSON.stringify(cur)) : newCard(kind);
  const drafts = { ...((store.peek('draft', novelId) || {}).cards || {}), ...Object.fromEntries(cardDrafts) };
  let draftKey = `${novelId}:${kind}:${id || 'new'}`;
  let recovered = false;
  if (!id && !drafts[draftKey]) {
    /* A card removed while its editor was closed has no card to reopen.
     * Add recovers its draft instead of leaving the words out of reach. */
    const prefix = `${novelId}:${kind}:`;
    const orphan = Object.keys(drafts).find((key) => key.startsWith(prefix) && drafts[key] && !(n.notes[kind] || []).some((x) => key === prefix + x.id));
    if (orphan) { draftKey = orphan; recovered = true; }
  }
  const draft = drafts[draftKey] || null;
  const s = openSheet(cur ? c.name : `A new ${kind === 'people' ? 'person' : kind === 'places' ? 'place' : kind === 'lore' ? 'thing to remember' : 'thread'}`, { small: true, onClose: () => keepDraft() });
  const name = h('input', { type: 'text', value: c.name || '' });
  const about = h('textarea', { rows: 5 });
  about.value = c.about || '';
  const aka = h('input', { type: 'text', value: (c.aka || []).join(', ') });
  let now = null, ties = null, open = null;
  if (draft) s.body.append(h('p.say', recovered ? 'Your words from a card taken out are back. Save makes a new card.' : 'Your words from before, not saved yet, are back.'));
  s.body.append(field('Name', name));
  s.body.append(field('Also called', aka, 'Other names, separated by commas.'));
  if (kind === 'people') {
    now = h('textarea', { rows: 3 });
    now.value = c.now || '';
    ties = h('textarea', { rows: 3 });
    ties.value = c.ties || '';
  }
  s.body.append(field(kind === 'people' ? 'Who they are' : kind === 'threads' ? 'What was set up, and where it stands' : 'About it', about,
    kind === 'people' ? 'For good: looks, voice, temperament, how they act under pressure, what they want, what they would never do.' : undefined));
  /* what the book told after his words, kept beside them: his to correct or clear */
  let since = null;
  if (c.since && String(c.since).trim()) {
    since = h('textarea', { rows: 3 });
    since.value = c.since;
    s.body.append(field('Since then', since, 'What the book has told since your words, kept beside them by the helper. Correct it or clear it here; move what matters into your own words above if you like.'));
  }
  if (kind === 'people') {
    s.body.append(field('With others', ties, 'How they stand with the people who matter to them, and why — where it began, what moved it, where it is now.'));
    s.body.append(field('Right now', now, 'Where they are and what is going on with them as of the end of the book so far.'));
  }
  if (kind === 'threads') {
    open = h('input', { type: 'checkbox', checked: c.open !== false });
    s.body.append(h('label.toggle', open, h('span', 'Still open')));
  }
  /* the boxes, what each held when it opened, and which he has typed in */
  const boxes = { name, about, aka, ...(now ? { now } : {}), ...(ties ? { ties } : {}), ...(since ? { since } : {}) };
  const valueOf = (k) => (k === 'open' ? open.checked : boxes[k].value);
  const opened = Object.fromEntries([...Object.keys(boxes), ...(open ? ['open'] : [])].map((k) => [k, valueOf(k)]));
  if (draft) for (const [k, v] of Object.entries(draft)) { if (k === 'open' && open) open.checked = v; else if (boxes[k]) boxes[k].value = v; }
  const typed = () => Object.fromEntries(Object.keys(opened).filter((k) => valueOf(k) !== opened[k]).map((k) => [k, valueOf(k)]));
  let done = false;
  const keepDraft = () => {
    if (done) return;
    const t = typed();
    if (Object.keys(t).length) { keepCardDraft(novelId, draftKey, { ...t, name: valueOf('name') }); toast('Your words are kept — open the card again to go on.'); } else keepCardDraft(novelId, draftKey, undefined);
  };
  const draftTyped = () => { if (!done) { const t = typed(); keepCardDraft(novelId, draftKey, Object.keys(t).length ? { ...t, name: valueOf('name') } : undefined); } };
  for (const box of [...Object.values(boxes), ...(open ? [open] : [])]) box.addEventListener('input', draftTyped);
  s.body.append(h('p.say', 'The helper keeps these as the book is written; what you write here it keeps too.'));
  const row = h('div.btnrow', h('button.btn.primary', { onclick: () => {
    const t = typed();
    const nm = (t.name !== undefined ? t.name : c.name || '').trim();
    if (!nm) { toast('It needs a name.'); return; }
    /* onto the card as it stands now: only what he typed */
    const live = cur ? ((store.peek('novel', novelId).notes[kind] || []).find((x) => x.id === cur.id) || null) : null;
    if (cur && !live) { toast('This card was taken out meanwhile — your words are kept; Add makes it anew.'); keepCardDraft(novelId, `${novelId}:${kind}:new`, { ...t, name: nm }); keepCardDraft(novelId, draftKey, undefined); done = true; s.close(); return; }
    const out = live ? JSON.parse(JSON.stringify(live)) : c;
    if (t.aka !== undefined || (!cur && aka.value.trim())) out.aka = aka.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (t.name !== undefined || !cur) {
      /* renamed: the old name stays among the others it goes by */
      if (cur && nameKey(nm) !== nameKey(out.name)) out.aka = [...(out.aka || []), out.name];
      out.name = nm;
    }
    if (t.about !== undefined || !cur) out.about = about.value.trim();
    if (out.aka) out.aka = out.aka.filter((a, i) => out.aka.findIndex((b) => nameKey(b) === nameKey(a)) === i && nameKey(a) !== nameKey(out.name));
    if (now && (t.now !== undefined || !cur)) {
      out.now = now.value.trim();
      /* his "now" is as of the end of the book so far */
      const ord = store.peek('novel', novelId).order || [];
      if (out.now && ord.length) { out.nowAt = ord[ord.length - 1]; delete out.nowPid; }
    }
    if (since && t.since !== undefined) { const v = since.value.trim(); if (v) out.since = v; else delete out.since; }
    if (ties && (t.ties !== undefined || !cur)) out.ties = ties.value.trim();
    if (open && (t.open !== undefined || !cur)) out.open = open.checked;
    if (cur && !Object.keys(t).length) { done = true; keepCardDraft(novelId, draftKey, undefined); s.close(); return; }
    /* his in what he wrote here (a new card: all he gave it) — the helper still writes the rest as the book goes on */
    const wrote = cur ? Object.keys(t) : ['name', ...Object.keys(t), ...(aka.value.trim() ? ['aka'] : [])];
    out.updated = hisStamp(live, wrote, Date.now());
    store.change('novel', novelId, novelSteps.editNote(kind, out, wrote, { create: !cur }), { now: true });
    /* Keep a way back until the phone accepts it. A card removed in another
     * window during the save stays removed, with these words ready for Add. */
    const saving = { ...t, name: nm };
    keepCardDraft(novelId, draftKey, saving);
    store.flush('novel', novelId).then(() => {
      if (cardDrafts.get(draftKey) !== saving) return;
      const kept = store.peek('novel', novelId);
      const found = ((kept && kept.notes[kind]) || []).some((x) => x.id === out.id);
      keepCardDraft(novelId, draftKey, undefined, saving);
      if (!found) { keepCardDraft(novelId, `${novelId}:${kind}:new`, saving); toast('This card was taken out meanwhile — your words are kept; Add makes it anew.', 6000); }
    });
    /* a name another card already goes by: two cards for one — the notes' check folds them (Cozy Tavern's M614, M730) */
    const twin = (store.peek('novel', novelId).notes[kind] || []).find((x) => x.id !== out.id && [x.name, ...(x.aka || [])].some((a) => nameKey(a) === nameKey(out.name)));
    if (twin) { archivist.askAudit(novelId); toast(`${twin.name === out.name ? 'Another card is called' : 'Another card also goes by'} ${out.name} — the notes’ check folds the two into one, keeping your words.`, 6000); }
    done = true;
    s.close();
  } }, 'Save'));
  if (cur) row.append(h('button.btn.danger', { onclick: async () => {
    if (!(await confirmIt('Take this out of the notes?', `${cur.name} goes from the notes. (The book itself is not changed.)`, 'Take it out', { danger: true }))) return;
    store.change('novel', novelId, novelSteps.dropNote(kind, cur.id), { now: true });
    done = true;
    keepCardDraft(novelId, draftKey, undefined);
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
  const gen = sideGen;
  const t = await talk.ensureTalk(novelId).catch(() => null);
  await store.open('draft', novelId).catch(() => null);
  if (gen !== sideGen || P.side !== 'partner' || P.novelId !== novelId) return;
  const draftKey = `talk:${novelId}:${t?.convId || 'current'}`;
  if (t) talk.repairStaleTurns('talk', novelId);
  /* the book's scenes at hand, so a rename everywhere reaches them */
  talk.loadPlays(novelId).catch(() => {});
  if (!P.offs.talkSub) { P.offs.push(store.subscribe('talk', novelId, () => { if (P.side === 'partner' && !drawnAlready('talk', novelId)) drawPartnerSoon(); })); P.offs.talkSub = true; }
  ui.rightBody.textContent = '';
  ui.rightBody.append(conversationRow(novelId, t));
  const box = h('div.talk');
  const turns = (t && t.turns) || [];
  if (!turns.length) box.append(h('div.pane-welcome', h('span.pane-welcome-mark', { 'aria-hidden': 'true' }, icon('chat', 28)), h('p.pane-kicker', 'A little room to think'), h('h2', 'Talk the story over'),
    h('p', 'A scene that feels stuck. A character you want to understand. The next turn in the story. Your partner knows the book and its notes.'),
    h('div.pane-welcome-tip', icon('more', 18), h('span', h('b', 'Need a starting point?'), ' Quick asks, beside Send, has a few.')),
    h('details.pane-guide', h('summary', 'What your partner can help with'), h('p', 'Ask about any passage by its chapter and passage number, a name across the book, a chapter’s name or summary, what the book is about, a card in the notes, or a module’s words. When you ask for a change, it shows here with its Undo. The helper keeps and checks the notes; its reasons are in Notes.'))));
  for (const turn of turns) box.append(drawTurn('talk', novelId, turn));
  ui.rightBody.append(box);
  const ta = h('textarea', { rows: 1, placeholder: 'Ask your partner…', 'aria-label': 'Ask your partner' });
  const working = talk.talkBusy('talk', novelId);
  const send = h('button.btn.primary.small', { onclick: async () => {
    if (talk.talkBusy('talk', novelId)) { talk.stopTalk('talk', novelId); return; }
    const text = ta.value.trim();
    if (!text) return;
    const sent = beginComposerSend(draftKey);
    const out = await talk.partnerSay({ novelId, chapterId: P.chapterId, text });
    if (out && !out.ok && out.error) toast(`Your partner${elsewhere(novelId)} did not answer: ${out.error}${out.giveBack && elsewhere(novelId) ? ' — your message is back in its box there' : ''}`, 6000);
    /* a message whose answer did not come is not on the page: its words come back to the box */
    endComposerSend(sent, out);
  } }, working ? 'Stop' : 'Send');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
  ta.addEventListener('input', keepTyped);
  /* drawn again on its own (its talk changed): the box keeps his words, and there is one of it */
  keepTyped();
  ui.rightFoot.textContent = '';
  ui.rightFoot.hidden = false;
  const quick = h('button.btn.quiet.small', { 'aria-label': 'Quick asks', title: 'Quick asks — ready-made requests for your partner', disabled: working, onclick: (e) => quickAsks(e.currentTarget, ta, send) }, icon('more', 16), 'Quick asks');
  ui.rightFoot.append(ta, h('div.crow', turns.length ? h('button.btn.quiet.small', { title: 'This conversation’s talk goes and it begins again — the changes it made stay in the book. With Undo.', disabled: working, onclick: clearTalk }, 'Start over') : null, h('span.grow'), quick, send));
  autoGrow(ta, 0.3);
  restoreTyped(draftKey, novelId);
  P.drawn = 'talk:' + novelId + turnsSig(t);
  placeSide();
}
/* Ready-made requests for the partner (Cozy Tavern's housekeeper's quick asks,
 * made for a book): sent at once, or put in the box for a name. */
const QUICK = [
  /* one button, one meaning: the same check as the notes' own, made by the helper — its verdict and its reasons show in the notes */
  { label: 'Check the notes against the book', hint: 'The helper holds every card against the book, puts right what drifted and folds cards that repeat each other — why for each shows in the notes.', audit: true },
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
    if (q.audit) {
      const n = store.peek('novel', P.novelId);
      if (archivist.lightOf(P.novelId).state === 'off') { toast('No helper is chosen, so the notes are not kept or checked. Choose one in Settings → Connections.', 6000); return; }
      if (!NOTE_KINDS.some((k) => ((n && n.notes && n.notes[k]) || []).length)) { toast('There are no notes to check yet — the helper writes them as the book is read.'); return; }
      archivist.askAudit(P.novelId);
      toast('The helper is checking the notes against the book — what it finds shows at the top of the notes.', 5000);
      return;
    }
    if (q.fill) { ta.value = q.fill; ta.dispatchEvent(new Event('input')); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
    /* what he had typed is not lost to a quick ask: it comes back to the box once the ask is sent */
    const mine = ta.value;
    const key = ui.rightFoot.dataset.for;
    ta.value = q.ask; ta.dispatchEvent(new Event('input'));
    send.click();
    if (mine.trim()) giveBack(key, mine);
  } }))]);
}

function drawPartnerSoon() { if (!partnerFrame) partnerFrame = requestAnimationFrame(() => { partnerFrame = 0; if (P.side === 'partner') drawPartner(); }); }

function giveBack(key, words) {
  if (!String(words || '').trim()) return;
  const novelId = composerBooks.get(key) || P.novelId;
  const before = composerOf(key, novelId);
  keepComposer(novelId, key, { ...before, value: before.value && before.value !== words ? `${before.value}\n\n${words}` : words });
  if (ui.rightFoot.dataset.for === key) restoreTyped(key, novelId);
}
/* where a reply that did not come was asked, when he is somewhere else now */
function elsewhere(novelId, playId = '') {
  const here = P.novelId === novelId && (!playId || (P.side === 'play' && P.playId === playId));
  if (here) return '';
  const n = store.peek('novel', novelId);
  return ` in “${(n && n.meta && n.meta.title) || 'Untitled'}”`;
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
  return h('div.conversation-heading', h('p.pane-kicker', 'Your conversations'), h('div.convrow',
    h('button.btn.quiet.small.convpick', { title: 'Your conversations with your partner: open another, rename, copy or remove this one', 'aria-label': `Conversation: ${c.open.name}`, onclick: (e) => conversationMenu(e.currentTarget, novelId) }, h('span.convname', c.open.name), icon('down', 14)),
    h('button.btn.quiet.small', { 'aria-label': 'New conversation', title: 'New conversation — a fresh one for a new question; this one stays in the list', disabled: busy || empty, onclick: async () => {
      const out = await talk.newConversation(novelId);
      if (!out.ok) toast(`It couldn’t: ${out.error}.`, 5000);
      drawSide();
    } }, icon('plus', 14), 'New'),
    h('span.grow'),
    h('button.icon', { 'aria-label': full ? 'Leave full screen' : 'Full screen', title: full ? 'Leave full screen' : 'Full screen', onclick: partnerFull }, icon(full ? 'shrink' : 'expand', 18))));
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
  if (changesComing(raw)) return live ? 'Making the changes…' : 'Its changes were cut off before they finished, so none of them were made — ask again (a larger Longest reply gives it room).';
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
  el.append(h('div.turn-speaker', turn.by === 'you' ? 'You' : kind === 'play' ? 'The narrator' : 'Your partner'));
  /* the thinking streams open while it comes, then folds once the words begin */
  if (turn.by !== 'you' && thinking) el.append(turnThinkBox(turn.id, thinking, Boolean(live && !live.text)));
  /* the narrator's telling is prose — a thought or a sound in italics is drawn in italics */
  if (kind === 'play' && turn.by !== 'you') { const w = h('div.words.tprose'); drawProse(w, shownWords(kind, turn, text, live)); el.append(w); }
  else if (kind === 'talk' && turn.by !== 'you' && partsOf(text).some((x) => x.kind === 'direction')) {
    /* each premise it offered, with its own Use as the next direction */
    const w = h('div.words');
    for (const part of partsOf(text)) {
      if (part.kind === 'words') { if (live || v.streaming) w.append(h('span', part.text)); else { const d = h('div.tprose.talkprose'); drawProse(d, part.text); w.append(d); } continue; }
      w.append(h('div.direction', h('span', part.text), part.done && !(live || v.streaming) ? h('button.btn.small', { title: 'Puts this premise in the box under the page — change it as you like, then Write.', onclick: async () => { if (!(await desk.useAsDirection(part.text))) return; if (!wide()) closeRight(); toast('It is in the box — change it as you like, then Write.'); } }, 'Use as the next direction') : null));
    }
    el.append(w);
  } else if (kind === 'talk' && turn.by !== 'you' && !(live || v.streaming) && wordsOf(text)) { const w = h('div.words.tprose.talkprose'); drawProse(w, shownWords(kind, turn, text, live)); el.append(w); }
  else el.append(h('span.words', shownWords(kind, turn, text, live)));
  /* his line to the narrator, not his character's */
  if (kind === 'play' && turn.by === 'you' && v.tell) el.append(h('div.tell', h('b', 'To the narrator: '), v.tell));
  if (live || v.streaming) return el;
  if (turn.by !== 'you' && v.cut) el.append(h('div.turnnote.cutnote', String(v.text || '').trim() ? `It stopped partway${v.cutWhy ? ` — ${v.cutWhy}` : ''}.` : `No words came${v.cutWhy ? ` — ${v.cutWhy}` : ''}. What it thought is kept above.`));
  if (kind === 'talk' && v.read && v.read.length) el.append(h('div.turnnote', `It read ${v.read.join(', ')} whole.`));
  /* what was said of this answer — a lesson its model taught, what was taken off it — as a page's version says it */
  if (turn.by !== 'you' && v.notes && v.notes.length) el.append(h('div.turnnote.said', v.notes.join(' ')));
  /* what its own web search looked at — only an address on the web is ever a link */
  const looked = turn.by !== 'you' ? (v.sources || []).filter((x) => x && webUrl(x.url)) : [];
  if (looked.length) el.append(h('div.turnnote.sources', 'Looked up: ', ...looked.slice(0, 8).flatMap((x, k) => [k ? ' · ' : '', h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, String(x.title || x.url).slice(0, 80))])));
  if (kind === 'talk' && v.changes && v.changes.length) el.append(changeList(id, turn, v));
  const row = h('div.tctl');
  if (turn.by !== 'you') {
    if (turn.versions.length > 1) {
      const i = turn.versions.indexOf(v);
      row.append(h('button', { 'aria-label': 'The answer before', disabled: i <= 0, onclick: () => store.change(kind, id, turnSteps.pick(turn.id, turn.versions[i - 1].id), { now: true }) }, '‹'),
        h('span', { style: { alignSelf: 'center', fontSize: '12px', color: 'var(--chrome-soft)' } }, `${i + 1}/${turn.versions.length}`),
        h('button', { 'aria-label': 'The answer after', disabled: i >= turn.versions.length - 1, onclick: () => store.change(kind, id, turnSteps.pick(turn.id, turn.versions[i + 1].id), { now: true }) }, '›'));
    }
    const rec = store.peek(kind, id);
    const newest = rec && rec.turns && rec.turns.length && rec.turns[rec.turns.length - 1].id === turn.id;
    if (newest) row.append(h('button', { title: 'Asks again for this answer; the one you have stays one arrow away.', onclick: async () => {
      const out = kind === 'talk' ? await talk.partnerAgain({ novelId: id, chapterId: P.chapterId, turnId: turn.id }) : await talk.playAgain({ playId: id, turnId: turn.id });
      if (out && !out.ok && out.error) toast(out.error, 6000);
    } }, 'Another answer'));
  } else if (kind === 'talk') {
    /* his words back in the box; this message and everything after it let go — with Undo */
    row.append(h('button', { title: 'Your words back in the box to change and send again; this message and everything after it are let go (the changes made stay in the book). With Undo.', disabled: talk.talkBusy('talk', id), onclick: async () => {
      const key = `talk:${id}:${store.peek('talk', id)?.convId || 'current'}`;
      composerBooks.set(key, id);
      keepTyped();
      const out = await talk.editAndAskAgain(id, turn.id);
      if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
      const before = { ...composerOf(key, id) };
      giveBack(key, out.text);
      const returned = { ...composerOf(key, id) };
      if (ui.rightFoot.dataset.for === key) ui.rightFoot.querySelector('textarea')?.focus();
      undoToast('Your words are in the box.', () => {
        /* Only this conversation's returned text lets go. A newer draft,
         * or words in a scene he opened meanwhile, belong where they are. */
        if (JSON.stringify(composerOf(key, id)) === JSON.stringify(returned)) {
          keepComposer(id, key, before);
          if (ui.rightFoot.dataset.for === key) restoreTyped(key, id);
        }
        out.undo();
      });
    } }, 'Edit and ask again'));
  }
  /* the rest, under ⋯ — only what this answer has */
  const copyWords = turn.by === 'you' ? (v.text || '') : kind === 'talk' ? wordsOf(v.text) : sceneWords(v.text);
  const mine = turn.by === 'you';
  row.append(h('button.tmore', { 'aria-label': mine ? 'More for this message' : 'More for this answer', title: 'More', onclick: (e) => menu(e.currentTarget, [
    !mine && kind === 'talk' ? { label: 'Branch from here (conversation in this book)', hint: 'A new conversation up to this answer. Both conversations work on this same book and its notes.', disabled: talk.talkBusy('talk', id), run: async () => {
      await saveComposersForBranch(id);
      const out = await talk.copyConversation(id, turn.id);
      if (!out.ok) { toast(`It couldn’t: ${out.error}.`, 5000); return; }
      drawSide();
      toast(`“${out.name}” is open — the first one is in the list.`, 4000);
    } } : null,
    !mine && kind === 'talk' ? { label: 'Branch story with this conversation', hint: 'A separate book with the story as it stands now, and this conversation up to this answer. Earlier book changes are kept.', disabled: branchBusy(id), run: () => openBranch({ novelId: id, conversationId: store.peek('talk', id)?.convId || 'current', conversationTurnId: turn.id }) } : null,
    kind === 'play' ? { label: 'Branch story from here', hint: 'A separate book with the story before this scene was turned into prose, and the scene up to this turn.', disabled: branchBusy(P.novelId), run: () => openBranch({ novelId: P.novelId, playId: id, turnId: turn.id }) } : null,
    /* the answer as it came, its blocks and all (Cozy Tavern's "What it said, whole") */
    !mine && kind === 'talk' && String(v.text || '').trim() !== wordsOf(v.text).trim() ? { label: 'What it said, whole', hint: 'The answer as it came — its changes block and all.', run: () => showWhole(v.text) } : null,
    !mine && v.sent ? { label: 'What was sent', hint: 'Everything this answer was asked with, as it went out.', run: () => showSent(P.novelId, v.sent) } : null,
    !mine && kind === 'play' && (String(v.tookOff || '').trim() || String(v.tookOffTop || '').trim()) ? { label: 'Put back what was taken off', hint: 'What the narrator added around its telling — a heading or its plan above it, a note to you, its check of its work or a block of tracking after it — back where it was, as a new version of this answer.', disabled: talk.talkBusy('play', id), run: () => { if (talk.putBackTelling({ playId: id, turnId: turn.id })) toast('Put back — the answer without it is one arrow away.'); } } : null,
    { label: 'Copy', hint: mine ? 'Your words, to paste anywhere.' : 'Its words, to paste anywhere.', run: async () => toast((await copyText(copyWords)) ? 'Copied.' : 'It could not be copied.') },
    '-',
    { label: 'Remove', hint: mine ? `This message and the ${kind === 'play' ? 'telling' : 'answer'} to it go from the ${kind === 'play' ? 'scene' : 'conversation'}, with Undo${kind === 'talk' ? '; changes it made stay in the book' : ''}.` : kind === 'play' ? 'This telling goes from the scene, with Undo.' : 'This answer goes from the conversation, with Undo; changes it made stay in the book.', danger: true, run: () => removeTurn(kind, id, turn) },
  ]) }, icon('more', 16)));
  el.append(row);
  return el;
}

/* The partner's changes under its answer: each with what it changed and
 * why, and its Undo — or, set to wait, Apply and Leave it. */
const clip = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function whatChanged(novelId, c) {
  const op = c.op || {};
  const u = c.status === 'made' && c.undo && c.undo.what === 'many' ? c.undo : null;
  /* how many places a change across the book reached — or, waiting, will reach */
  const reach = u ? ` (${[[u.passages, 'passage'], [u.chapters, 'chapter name'], [u.cards, 'card'], [u.book, 'of the book’s words']].filter(([l]) => l && l.length).map(([l, w]) => (w === 'of the book’s words' ? `${l.length} ${w}` : plural(l.length, w))).join(', ') || 'nowhere'})`
    : c.status === 'waiting' && c.reach ? ` (${c.reach})` : '';
  /* what it wrote over: the words before it, kept with the change once made; as they stand now while it waits */
  const was = (c.status === 'made' || c.status === 'undone') && typeof c.before === 'string' ? c.before : c.status === 'waiting' ? wordsNow(novelId, c) : '';
  const over = (n = 140) => (String(was || '').trim() ? [h('del', clip(was, n)), ' → '] : []);
  if (op.rename && typeof op.rename === 'object') return h('span', h('del', clip(op.rename.from, 60)), ' → ', h('ins', clip(op.rename.to, 60)), reach);
  if (op.passage !== undefined && op.remove === true) return 'taken out of the chapter';
  if (op.remove === true) return 'taken out of the notes';
  if (op.find !== undefined) return h('span', h('del', clip(op.find, 90)), ' → ', h('ins', clip(op.replace !== undefined ? op.replace : op.text, 90) || '(taken out)'), reach);
  if (op.passage !== undefined && op.text !== undefined) return `written anew (${plural(countWordsLoose(op.text), 'word')})`;
  if (op.module !== undefined && op.text !== undefined) return `its words, whole (${plural(countWordsLoose(op.text), 'word')})`;
  if (op.summary !== undefined) return h('span', ...over(), h('ins', clip(op.text, 140)));
  if (op.book !== undefined) return op.add !== undefined ? h('span', 'a new paragraph: ', h('ins', clip(op.add))) : h('span', ...over(), h('ins', clip(op.text)));
  if (op.chapter !== undefined) return h('span', 'named ', ...over(80), h('ins', clip(op.name, 80) || '(no name)'));
  if (op.note !== undefined) {
    const bits = ['about', 'ties', 'now'].filter((k) => op[k] !== undefined).map((k) => `${k === 'ties' ? 'with others' : k === 'now' ? 'right now' : 'who they are'}: ${clip(op[k], 80)}`);
    if (op.newName !== undefined) bits.unshift(`renamed ${clip(op.newName, 60)}`);
    if (op.aka !== undefined) bits.push(`also called ${clip([].concat(op.aka).join(', '), 60)}`);
    if (op.dropAka !== undefined) bits.push(`no longer called ${clip([].concat(op.dropAka).join(', '), 60)}`);
    if (openOf(op) !== undefined) bits.push(openOf(op) ? 'open again' : 'closed');
    const said = bits.join(' · ') || 'brought up to date';
    return op.about !== undefined && String(was || '').trim() ? h('span', said, h('br'), 'it said: ', h('del', clip(was, 140))) : said;
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
    /* a miss it put right in a later round of the same answer is not shown as a miss (M683) */
    if (c.superseded) continue;
    const mark = { made: '✓', waiting: '•', refused: '✗', undone: '↶', skipped: '–' }[c.status] || '•';
    /* a waiting one that could not land now (its words gone, its thing changed since): said, with no Apply (M224) */
    const stale = c.status === 'waiting' && !c.copied ? talk.waitingWhy(novelId, c) : '';
    const state = { made: c.edited ? 'made with your words' : c.with ? c.said : (c.said && c.op && (c.op.find !== undefined || c.op.text !== undefined) ? c.said : ''), waiting: stale ? `can’t be made now — ${stale}` : c.group ? 'waiting for Apply — made together with the others of its kind here' : 'waiting for Apply', refused: `couldn’t be made — ${c.said || 'no reason given'}`, undone: c.undoneSaid ? `undone in part — ${c.undoneSaid}` : 'undone', skipped: c.aside ? 'left — a newer answer changes the same' : 'left as it was' }[c.status] || '';
    const row = h('div.change.' + c.status,
      h('div.chead', h('b', `${mark} ${labelNow(novelId, c)}`), state ? h('small', state) : null),
      c.status !== 'refused' ? h('div.cwhat', whatChanged(novelId, c)) : (c.op && c.op.find !== undefined ? h('div.cwhat', 'It looked for: ', h('del', clip(c.op.find, 140))) : null),
      c.why ? h('div.cwhy', c.why) : null);
    const btns = h('div.cbtns');
    if (c.copied) {
      /* copied with the conversation: it is undone or applied where it was made */
      if (c.status === 'made' || c.status === 'waiting') row.append(h('div.cwhy', 'In the conversation this one was copied from — its Undo and Apply are there.'));
    } else {
      if (c.status === 'made') btns.append(h('button', { title: c.with ? 'Put back this change and the one it was made with (only where nothing has changed them since).' : 'Put back what this change changed (only if nothing has changed it since).', onclick: act(talk.undoOneChange, c.id) }, 'Undo'));
      if (c.status === 'waiting') {
        if (!stale) btns.append(h('button.go', { title: 'Make this change in the book.', onclick: act(talk.applyChange, c.id) }, 'Apply'));
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
  if (i < 0) return;
  /* his message goes with the answers to it, up to his next one — an answer
   * to a message no longer there is never told on, nor written into the book
   * (Cozy Tavern's M635) */
  let end = i + 1;
  if (turn.by === 'you') while (end < list.length && list[end].by !== 'you') end++;
  const gone = list.slice(i, end);
  if (gone.some((t) => (t.versions || []).some((v) => v.streaming))) { toast('An answer to it is still being written — Stop it first.'); return; }
  const before = i > 0 ? list[i - 1].id : null;
  const copies = JSON.parse(JSON.stringify(gone));
  store.change(kind, id, (d) => { d.turns = (d.turns || []).filter((t) => !copies.some((c) => c.id === t.id)); }, { now: true });
  undoToast(copies.length > 1 ? 'Taken out, with the answer to it.' : 'Taken out.', () => {
    store.change(kind, id, (d) => {
      d.turns = d.turns || [];
      const back = copies.filter((c) => !d.turns.some((t) => t.id === c.id));
      if (!back.length) return;
      const at = before ? d.turns.findIndex((t) => t.id === before) + 1 : 0;
      d.turns.splice(Math.max(0, at), 0, ...JSON.parse(JSON.stringify(back)));
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
  const gen = sideGen;
  await store.open('draft', n.id).catch(() => null);
  if (gen !== sideGen) return;
  if (P.playId) {
    const p = store.peek('play', P.playId) ?? await store.open('play', P.playId).catch(() => null);
    if (gen !== sideGen) return;
    if (!p) { P.playId = null; return drawPlay(); }
    /* its prose taken out of the book since: "written into the book up to here" lets go */
    if (talk.mendScene(p.id)) return drawOnePlay(store.peek('play', p.id));
    return drawOnePlay(p);
  }
  ui.rightBody.append(h('div.pane-intro.scene-intro', h('p.pane-kicker', 'Try another way in'), h('h2', 'Step into your story'),
    h('p', 'Be one of its people. You write what they say and do; the narrator brings the world around them to life.'),
    h('details.pane-guide', h('summary', 'From a scene to the page'), h('p', 'When a scene goes somewhere good, Turn it into prose writes what happened into the chapter. Your scenes stay here to return to.'))));
  const plays = [];
  for (const id of n.plays || []) { const p = store.peek('play', id) ?? await store.open('play', id).catch(() => null); if (p) plays.push(p); }
  if (gen !== sideGen || P.side !== 'play' || P.playId) return;
  plays.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (plays.length) {
    ui.rightBody.append(h('h3.pane-section-title', 'Return to a scene'));
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
  ui.rightBody.append(h('div.group.scene-start', h('div.gbody', h('h3.pane-section-title', 'Begin somewhere new'),
    field('Who do you play?', who), dl,
    field('Where does it start?', from, 'Leave it empty to pick up right where the chapter stands now.'),
    h('div.btnrow', h('button.btn.primary', { onclick: async () => {
      const name = who.value.trim();
      if (!name) { toast('Say who you play.'); who.focus(); return; }
      const id = await talk.newPlay({ novelId: P.novelId, chapterId: P.chapterId, who: name, from: from.value.trim() });
      P.playId = id;
      P.offs.push(store.subscribe('play', id, () => { if (P.side === 'play' && P.playId === id && !drawnAlready('play', id)) drawSideSoon(); }));
      drawSide();
      const novelId = P.novelId;
      const out = await talk.playSay({ playId: id, text: '' });
      const away = elsewhere(novelId, id);
      if (out && !out.ok && out.error) toast(`The narrator${away ? ` of your scene${away}` : ''} did not answer: ${out.error}`, 6000);
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
        talk.stopTalk('play', p.id);
        try { await store.remove('play', p.id); }
        catch (_) { toast('The scene could not be removed. Try again in a moment.', 6000); return; }
        if (store.peek('novel', p.novelId)) store.change('novel', p.novelId, novelSteps.removePlay(p.id), { now: true });
        if (P.novelId === p.novelId && P.playId === p.id) { P.playId = null; drawSide(); }
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
    box.append(h('div.choices', { role: 'group', 'aria-label': 'Three ways it could go' }, h('p.choice-heading', 'Where will you take it?'),
      ...offered.map((c) => h('button.choice', { onclick: () => {
        const tb = ui.rightFoot.querySelector('textarea.tellbox');
        const tell = tb && !tb.hidden ? tb.value.trim() : '';
        const sent = beginComposerSend('play:' + p.id, { value: false, tell: Boolean(tell) });
        playMove(p, c, tell, sent);
      } }, c))));
  } else if ((store.peek('house', 'house') || {}).sceneChoices && lv && !lv.streaming && !working && sceneWords(String(lv.text || '')).trim()) {
    /* Three choices on, and none came with the newest part (told before they were on, or left out): said, with the way to ask
     * again — never an empty row (Cozy Tavern m752-018/019) */
    box.append(h('p.hint.nochoices', 'No choices came with this part — Another answer, on it, tells it again with them.'));
  }
  ui.rightBody.append(box);
  const ta = h('textarea', { rows: 1, placeholder: `What does ${p.who} say or do?`, 'aria-label': `What ${p.who} says or does` });
  /* his line to the narrator: how the telling should go, never his character's words */
  const tellBox = h('textarea.tellbox', { rows: 1, placeholder: `Tell the narrator — not ${p.who}’s words (bring someone in, the storm gets worse…)`, 'aria-label': 'Tell the narrator' });
  const kept = composerOf('play:' + p.id, p.novelId);
  if (kept && kept.tell) tellBox.value = kept.tell;
  /* open or closed as he left it: closed, what is in it stays but is not sent */
  const tellOpen = Boolean(kept && kept.tellOpen);
  tellBox.hidden = !tellOpen;
  const tellBtn = h('button.chip.toggle.tell-toggle', { 'aria-pressed': String(tellOpen), title: 'A line for the narrator about how the scene should go', onclick: () => {
    const now = tellBox.hidden;
    tellBox.hidden = !now;
    tellBtn.setAttribute('aria-pressed', String(now));
    keepTyped();
    if (now) tellBox.focus();
  } }, 'Tell the narrator');
  const house = store.peek('house', 'house') || {};
  const choicesBtn = h('button.chip.toggle', { 'aria-pressed': String(Boolean(house.sceneChoices)), title: 'After each part, the narrator offers three things you could do next', onclick: () => {
    const on = !(store.peek('house', 'house') || {}).sceneChoices;
    store.change('house', 'house', (x) => { if (on) x.sceneChoices = true; else delete x.sceneChoices; }, { now: true });
    choicesBtn.setAttribute('aria-pressed', String(on));
    toast(on ? 'After each part, the narrator offers three ways it could go.' : 'No more choices offered.');
    /* the line under the newest part follows the switch */
    drawSide();
  } }, 'Three choices');
  const send = h('button.btn.primary.small', { onclick: async () => {
    if (talk.talkBusy('play', p.id)) { talk.stopTalk('play', p.id); return; }
    const text = ta.value.trim();
    const tell = tellBox.hidden ? '' : tellBox.value.trim();
    const sent = beginComposerSend('play:' + p.id, { tell: Boolean(tell) });
    await playMove(p, text, tell, sent);
  } }, working ? 'Stop' : 'Send');
  const fresh = talk.transcriptOf(p).count;
  ui.rightFoot.hidden = false;
  ui.rightFoot.append(ta, tellBox, h('div.crow.wrap',
    h('button.btn.small', { disabled: working || !fresh || (writer.busy(P.novelId) && !writer.autoBusy(P.novelId)), onclick: () => toProse(p, false), title: 'Write what happened into the chapter as prose' }, 'Turn it into prose'),
    tellBtn, choicesBtn,
    h('span.grow'), send));
  for (const box2 of [ta, tellBox]) {
    box2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
    box2.addEventListener('input', keepTyped);
  }
  autoGrow(ta, 0.3);
  autoGrow(tellBox, 0.2);
  restoreTyped('play:' + p.id);
  P.drawn = 'play:' + p.id + turnsSig(p);
  placeSide();
}

/* his move — his character's words, a line to the narrator, or both (nothing: it goes on) */
async function playMove(p, text, tell, sent) {
  const out = await talk.playSay({ playId: p.id, text, tell });
  const away = elsewhere(p.novelId || P.novelId, p.id);
  if (out && !out.ok && out.error) toast(`The narrator${away ? ` of your scene${away}` : ''} did not answer: ${out.error}`, 6000);
  if (sent) endComposerSend(sent, out);
}

async function toProse(p0, fromStart) {
  const p = talk.mendScene(p0.id) ? store.peek('play', p0.id) : p0;
  const tr = talk.transcriptOf(p, { fromStart });
  if (!tr.count) { toast(tr.waiting ? 'Nothing to write in yet — the narrator has not told your last move.' : 'Nothing new to write yet.'); return; }
  /* his hand first: a page the app is writing by itself stops and is taken away whole (the same door as the desk's) */
  await writer.yieldAuto(P.novelId);
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
    /* his move the narrator has not told yet stays in the scene: said */
    if (tr.waiting) toast(`Written in up to the narrator’s last telling — your last ${tr.waiting === 1 ? 'move stays' : 'moves stay'} in the scene, for the narrator to tell.`, 6000);
  } else if (out && !out.stopped && out.error) toast('The scene was not written: ' + out.error, 7000);
}

/* a scene over the whole screen, the narrator's words in the book's own type */
function sceneFull() {
  if (fullKind() === 'scene') { leaveFull(); return; }
  enterFull('scene', () => { ui.right.classList.add('full'); drawSideSoon(); },
    () => { ui.right.classList.remove('full'); drawSideSoon(); });
}

export function paneState() { return P; }
