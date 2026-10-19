/* Cozy Novel — js/ui/desk.js — THE PAGE: the chapter as a book page, the
 * passages on it with their versions, and the box at the bottom where he says
 * what happens next. */

import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as archivist from '../novel/archivist.js';
import * as talk from '../novel/talk.js';
import * as checker from '../novel/checker.js';
import { h, icon, toast, undoToast, menu, autoGrow, copyText, confirmIt, askChoice, onBack, openSheet } from './dom.js';
import { drawProse, growProse, selectionIn } from './prose.js';
import { picked, chapterSteps, novelSteps, newChapter, chapterWords, chapterLabel, LENGTHS, OUTCOMES, outcomeOf, newPassage, passageNumbers, cutAtEnd, keptFor, NOTE_KINDS, handsOf, premiseOf, passagePrint } from '../novel/shape.js';
import { putBackWords } from '../novel/inplace.js';
import { numberWords, plural, debounce, countWords, timeAgo, clamp } from '../util.js';
import { showSent } from './sent.js';
import { showJudged } from './checks.js';
import { webUrl } from '../model/call.js';
import { thinkBox as makeThinkBox, updateThinkBox } from './think.js';
import { paced, follower } from './live.js';
import { findIn } from '../novel/search.js';
import { makeChange, undoChange } from '../novel/changes.js';
import { nameChange, namedMidSentence, foldName } from '../novel/names.js';
import { openBranch, branchBusy } from './branches.js';
import { pageNames, tapName } from './bibliography.js';

const S = {
  novelId: null, chapterId: null,
  selected: null,        /* the passage whose controls show */
  editing: null,         /* the passage being edited */
  editText: null,        /* the words its box opened on */
  rewriting: null,       /* the passage with the rewrite box open */
  sel: null,             /* {passageId, start, end, text} — words selected for rewriting */
  errors: new Map(),     /* chapterId -> a page that did not come there: why, and what it thought */
  followId: null,        /* the passage being written here, whose newest words the page follows */
  drawn: null,           /* what the page was last drawn from (shownSig) */
  els: new Map(),        /* passageId -> element */
  offs: [],
  live: new Map(),       /* passageId -> {text, thinking} while being written */
  thinkOpen: new Set(),
  premiseOpen: new Set(),  /* passages whose premise he opened (Premise, under the page) */
  undo: null,            /* a removed passage, for a few seconds */
  insertAfter: null,     /* "Write from here": the next passage goes after this one */
  focusNext: null,       /* the box that takes the keyboard when it opens: 'edit' | 'rewrite' */
  editBack: null,        /* the phone's Back while editing: keeps the edit and closes the box */
  making: false,         /* a new chapter on its way (one tap, one chapter) */
};
let ui = null;           /* the elements this module draws into */
let F = null;            /* the follow law on the page (live.js) */
let hooks = {};          /* app.js: openChapters, openNotes, … */
let fitDirection = () => {};

export function initDesk(elements, appHooks) {
  ui = elements;
  hooks = appHooks;
  fitDirection = autoGrow(ui.direction);
  ui.direction.addEventListener('input', saveDraft);
  ui.direction.addEventListener('input', () => drawWriteLabel());
  ui.direction.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onWrite(); } });
  ui.writeBtn.addEventListener('click', onWrite);
  ui.mineBtn.addEventListener('click', onMine);
  ui.ideasBtn.addEventListener('click', () => showIdeas());
  ui.lengthBtn.addEventListener('click', () => lengthMenu());
  ui.outcomeBtn.addEventListener('click', () => outcomeMenu());
  ui.writerBtn.addEventListener('click', () => hooks.writerMenu(ui.writerBtn));
  /* Tap names switched on or off, here or in another window — and Super automatic, which says at a chapter's end where the next page goes */
  store.subscribe('house', 'house', () => { namesMoved(); if (ui && S.chapterId && chapter() && novel()) drawEnd(); });
  ui.wrap.addEventListener('scroll', onScroll, { passive: true });
  F = follower(ui.wrap, { tail: () => tailTop(S.followId), active: busy, onChange: (on) => { ui.followBtn.hidden = on || !busy(); } });
  initScroller();
  ui.followBtn.addEventListener('click', () => { F.start(); ui.followBtn.hidden = true; toBottom(S.followId); });
  ui.chapname.addEventListener('focus', () => { ui.chapname.dataset.was = ui.chapname.textContent; });
  ui.chapname.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ui.chapname.blur(); } });
  ui.chapname.addEventListener('blur', renameFromHeading);
  document.addEventListener('selectionchange', onSelection);
  ui.selClear.addEventListener('click', () => {
    if (S.sel) { S.sel = null; try { window.getSelection().removeAllRanges(); } catch (_) { /* fine */ } }
    else S.insertAfter = null;
    drawComposer();
  });
  writer.onLive(onLive);
  writer.onJob((novelId) => {
    if (novelId !== S.novelId) return;
    if (!busy()) ui.followBtn.hidden = true;
    drawComposer(); drawSoon();
  });
}

/* --------------------------------------------------------------- open */

export async function openChapter(novelId, chapterId) {
  /* an edit still open is kept as a version before the page changes */
  keepOpenEdit();
  for (const off of S.offs) off();
  S.offs = [];
  const changingBook = S.novelId !== novelId;
  /* what he typed for the book he is leaving is kept for that book, now */
  if (changingBook) {
    saveDraftSoon.now();
    /* Branches keep their passage IDs. These live words and queued paints
     * belong only to the book being left, never to its independent copy. */
    S.live.clear();
    pending.clear();
    livePaint.cancel();
  }
  S.novelId = novelId;
  S.chapterId = chapterId;
  S.selected = null; S.editing = null; S.editText = null; S.rewriting = null; S.sel = null; S.insertAfter = null; S.followId = null;
  F.start();
  S.offs.push(store.subscribe('chapter', chapterId, (data, why) => {
    if (why === 'deleted') { hooks.chapterGone(); return; }
    /* the writer here keeping what it has streamed so far: the page shows
     * those words already, as they come — it is not drawn again for them */
    if (S.drawn !== null && samePage(S.drawn, shownSig(chapter()))) return;
    drawSoon();
  }));
  S.offs.push(store.subscribe('novel', novelId, () => { drawHead(); drawComposer(); namesMoved(); }));
  if (changingBook) loadDraft();
  drawHead();
  drawPage({ keepScroll: false });
  drawComposer();
  /* opened to show something (a word found, a suggestion), or to write some words again */
  const then = S.then && S.then.chapterId === chapterId ? S.then : null;
  S.then = null;
  if (then && then.show) requestAnimationFrame(() => requestAnimationFrame(() => showFound(then.passageId, then.show)));
  else restoreScroll();
  if (then && then.rewrite) rewriteSpan(then.rewrite);
  if (then && then.rewriteWhole) rewritePassage(then.rewriteWhole);
}

/* ------------------------------------------------------------- found */

/* Some words of a passage, shown: the page goes to them, they are marked for
 * a few seconds (the passage glows where the browser cannot mark words).
 * spec: {query} — words as they read on the page. Returns whether it could. */
let foundTimer = 0;
export function showFound(passageId, spec = {}) {
  const el = S.els.get(passageId);
  if (!el) return false;
  const prose = el.querySelector(':scope > .prose');
  const range = prose && spec.query ? rangeIn(prose, spec.query) : null;
  const box = (range || el).getBoundingClientRect();
  const top = ui.wrap.scrollTop + box.top - ui.wrap.getBoundingClientRect().top - ui.wrap.clientHeight * 0.3;
  if (busy()) F.stop();
  setTop(Math.max(0, top));
  el.classList.remove('found');
  void el.offsetWidth;
  el.classList.add('found');
  clearTimeout(foundTimer);
  try {
    if (range && globalThis.CSS && CSS.highlights && typeof Highlight === 'function') CSS.highlights.set('found', new Highlight(range));
  } catch (_) { /* the glow says where */ }
  foundTimer = setTimeout(() => { el.classList.remove('found'); try { CSS.highlights.delete('found'); } catch (_) { /* fine */ } }, 6000);
  return true;
}
/* where words stand among a passage's paragraphs on screen, as a range */
function rangeIn(prose, query) {
  const nodes = [];
  let flat = '';
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  let lastP = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const p = t.parentElement && t.parentElement.closest('p');
    if (lastP && p !== lastP) flat += ' ';
    lastP = p;
    nodes.push({ t, at: flat.length });
    flat += t.data;
  }
  const hit = findIn(flat, String(query).replace(/\*+/g, ''), { max: 1 })[0];
  if (!hit) return null;
  /* a start falls inside a piece of text; an end may fall at its very end */
  const pointAt = (i, isEnd) => {
    for (const n of nodes) {
      const len = n.t.data.length;
      if (isEnd ? i > n.at && i <= n.at + len : i >= n.at && i < n.at + len) return { node: n.t, offset: i - n.at };
    }
    const last = nodes[nodes.length - 1];
    return { node: last.t, offset: last.t.data.length };
  };
  const a = pointAt(hit.start, false);
  const b = pointAt(hit.end, true);
  const r = document.createRange();
  try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch (_) { return null; }
  return r;
}
/* one thing to do in a chapter once it opens (it is being opened elsewhere) */
export function thenOnOpen(chapterId, then) { S.then = { chapterId, ...then }; }
/* go to a chapter and do one thing there once it is open */
export function whenOpen(chapterId, then) {
  if (chapterId === S.chapterId && S.els.size) {
    if (then.show) showFound(then.passageId, then.show);
    if (then.rewrite) rewriteSpan(then.rewrite);
    if (then.rewriteWhole) rewritePassage(then.rewriteWhole);
    return;
  }
  S.then = { chapterId, ...then };
  hooks.goChapter(chapterId);
}
/* a whole passage written again with a note (the judge's way to lift it) */
export function rewritePassage({ chapterId, passageId, note = '' }) {
  if (busy()) { toast('The writer is busy — try again once it has finished.'); return; }
  if (chapterId !== S.chapterId) { whenOpen(chapterId, { rewriteWhole: { chapterId, passageId, note } }); return; }
  S.selected = passageId;
  run(() => writer.rewrite({ novelId: S.novelId, chapterId, passageId, note }));
}
/* the checker looks now (Settings: what goes in by itself was switched on) */
export function nudgeChecker() { if (S.novelId) checker.schedule(S.novelId, 300); }
/* the helper of the book open, asked to read now (Super automatic switched on) */
export function nudgeHelper() { if (S.novelId) archivist.nudge(S.novelId, 1500); }
/* some words of a passage written again (a word he never wants) */
export function rewriteSpan({ chapterId, passageId, start, end, note = '', marks = false }) {
  if (busy()) { toast('The writer is busy — try again once it has finished.'); return; }
  if (chapterId !== S.chapterId) { whenOpen(chapterId, { rewrite: { chapterId, passageId, start, end, note, marks } }); return; }
  S.selected = passageId;
  /* the checker's sentence written again: a fix, on the page itself (a paragraph's speech marks: its marks alone) */
  run(() => writer.rewriteSelection({ novelId: S.novelId, chapterId, passageId, start, end, note, fix: true, marks }));
}

function novel() { return store.peek('novel', S.novelId); }
function chapter() { return store.peek('chapter', S.chapterId); }

/* ------------------------------------------------------------ the head */

export function drawHead() {
  const n = novel();
  const c = chapter();
  if (!n || !c) return;
  const num = n.order.indexOf(c.id) + 1;
  const label = `Chapter ${numberWords(num)}`;
  if (ui.chapnum.textContent !== label) ui.chapnum.textContent = label;
  if (document.activeElement !== ui.chapname && ui.chapname.textContent !== (c.name || '')) ui.chapname.textContent = c.name || '';
  /* a chapter opened: its heading comes on once, the way the room lights it (css: .lighting) — never on a redraw of the same one */
  if (ui.chapterhead && ui.chapterhead.dataset.lit !== c.id) {
    ui.chapterhead.dataset.lit = c.id;
    ui.chapterhead.classList.remove('lighting');
    void ui.chapterhead.offsetWidth;
    ui.chapterhead.classList.add('lighting');
  }
  hooks.drawBar && hooks.drawBar();
}

function renameFromHeading() {
  const c = chapter();
  if (!c) return;
  const name = ui.chapname.textContent.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name === (c.name || '')) return;
  /* named — or cleared — by him: the helper does not name it again */
  store.change('chapter', c.id, chapterSteps.setName(name, 'you'), { now: true });
  toast(name ? 'The chapter is named.' : 'The chapter has no name now.');
}

/* ------------------------------------------------------------ the page */

let drawFrame = 0;
function drawSoon() { if (!drawFrame) drawFrame = requestAnimationFrame(() => { drawFrame = 0; drawPage(); }); }
/* the names the page marks changed (an entry, a card, Tap names): drawn again with them */
let namesDrawn = '';
function namesMoved() {
  if (!S.novelId) return;
  const names = pageNames(S.novelId);
  if ((names ? names.sig : '') !== namesDrawn) drawSoon();
}
export { namesMoved };

/* Keep only what is visible. Comparing whole records serialized every old
 * version, request, and folded thinking on every save, even when the page
 * had not changed. Strings here are compared directly, never copied. */
const writingHere = (v) => v.streaming && v.tab === store.CLIENT;
const sameParts = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameKey = (a, b) => sameParts(a.body, b.body) && sameParts(a.controls, b.controls);
function samePage(a, b) {
  return a.name === b.name && a.keys.length === b.keys.length && a.keys.every((k, i) => sameKey(k, b.keys[i]));
}
function shownSig(c) {
  if (!c) return { name: '', keys: [] };
  const tint = ((store.peek('house', 'house') || {}).look || {}).tint !== 'off';
  const nums = passageNumbers(c), working = busy();
  const names = pageNames(S.novelId);
  return { name: c.name || '', keys: (c.passages || []).map((p) => drawnKey(p, { tint, nums, working, names, snapshot: true })) };
}

export function drawPage({ keepScroll = true } = {}) {
  if (drawFrame) { cancelAnimationFrame(drawFrame); drawFrame = 0; }
  const c = chapter();
  const n = novel();
  if (!c || !n) return;
  const look = (store.peek('house', 'house') || {}).look || {};
  const tint = look.tint !== 'off';
  /* the names the page marks, each opening its card (bibliography.js; Tap names) */
  const names = pageNames(S.novelId);
  namesDrawn = names ? names.sig : '';
  const keep = keepScroll ? ui.wrap.scrollTop : 0;
  /* what he is typing on the page survives the page being drawn again */
  const editing = ui.passages.querySelector('.editbox');
  const rewriting = ui.passages.querySelector('.rewriterow input');
  const kept = { edit: editing ? editing.value : null, editFocus: editing && document.activeElement === editing, editSel: editing ? [editing.selectionStart, editing.selectionEnd] : null,
    note: rewriting ? rewriting.value : null };
  const list = c.passages || [];
  if (!S.selected || !list.some((p) => p.id === S.selected)) S.selected = defaultSelected(list);
  /* Keep the actual passage and paragraph nodes through server saves and
   * controls changing. Selection, browser anchoring and a fling then survive
   * an unchanged page arriving in a new record object. */
  const nums = passageNumbers(c);
  const working = busy();
  const was = S.els;
  S.els = new Map();
  const wanted = new Set(list.map((p) => p.id));
  for (const [id, el] of was) if (!wanted.has(id)) el.remove();
  let at = ui.passages.firstChild;
  for (const p of list) {
    const key = drawnKey(p, { tint, nums, working, names });
    const old = was.get(p.id);
    const as = old && drawnAs.get(old);
    let el = old;
    if (!as || as.chapterId !== S.chapterId || old.parentNode !== ui.passages || as.key.body[1] !== p.by || as.key.body[7] !== (S.editing === p.id)) {
      el = drawPassage(p, { tint, names });
      if (old && old.parentNode === ui.passages) { if (at === old) at = old.nextSibling; old.replaceWith(el); }
    } else if (!sameKey(as.key, key)) updatePassage(el, p, { tint, names }, as.key, key);
    drawnAs.set(el, { chapterId: S.chapterId, key });
    S.els.set(p.id, el);
    if (el === at) at = at.nextSibling;
    else ui.passages.insertBefore(el, at);
  }
  SC.numbered = [...S.els].filter(([pid]) => nums.has(pid)).map(([pid, el]) => ({ el, n: nums.get(pid) }));
  drawEnd();
  drawHead();
  if (kept.edit !== null) {
    const box = ui.passages.querySelector('.editbox');
    if (box && box !== editing) { box.value = kept.edit; box.dispatchEvent(new Event('input')); if (kept.editFocus) { box.focus({ preventScroll: true }); try { box.setSelectionRange(kept.editSel[0], kept.editSel[1]); } catch (_) { /* fine */ } } }
  }
  if (kept.note !== null) { const inp = ui.passages.querySelector('.rewriterow input'); if (inp) inp.value = kept.note; }
  /* his place is kept — and the page is only moved when drawing it again
   * moved it, so a fling under way goes on */
  if (keepScroll && ui.wrap.scrollTop !== keep) setTop(keep);
  else F.moved();
  S.drawn = shownSig(c);
  placeScrollerSoon();
}

/* everything a passage is drawn from: the record, its words still arriving,
 * and how it is shown (chosen, being edited, the rewrite box, its thinking
 * unfolded) — and for the chosen one its controls (busy, its number, when) */
const drawnAs = new WeakMap();   /* element -> its visible fields */
function drawnKey(p, { tint, nums, working, names = null, snapshot = false }) {
  const sel = S.selected === p.id;
  const v = picked(p) || {};
  const live = S.live.get(p.id);
  const checkpoint = snapshot && writingHere(v);
  const text = checkpoint ? null : (live ? live.text : v.text);
  const thinking = checkpoint ? null : (live ? live.thinking : v.thinking);
  /* (the names marked in its own words — a name that came for another passage never draws this one again) */
  const body = [p.id, p.by, v.id, text, thinking, tint, sel, S.editing === p.id, S.rewriting === p.id, S.thinkOpen.has(p.id), Boolean(v.streaming || live), names && text ? names.marksOf(text) : ''];
  const controls = sel ? [working, nums.get(p.id) || 0, v.done || v.at ? timeAgo(v.done || v.at) : '', gradeSaid(p),
    p.pick, (p.versions || []).length, ...(p.versions || []).map((x) => x.id), Boolean(v.streaming || live), cutAtEnd(v), Boolean(writer.takeOf(p)),
    v.how, v.why, ...handsOf(v), (v.before || []).length, checkpoint ? null : v.words, checkpoint ? null : v.text, v.tokensIn, v.tokensCounted, v.ask && v.ask.note,
    v.cut, v.cutWhy, (v.notes || []).length, ...(v.notes || []), (v.sources || []).length, ...(v.sources || []).flatMap((x) => x ? [x.url, x.title] : [])] : [];
  return { body, controls };
}

function updatePassage(el, p, { tint, names = null }, before, after) {
  const v = picked(p) || {};
  const live = S.live.get(p.id);
  const text = live ? live.text : v.text;
  const thinking = live ? live.thinking : v.thinking;
  el.classList.toggle('selected', S.selected === p.id);
  el.classList.toggle('streaming', Boolean(v.streaming || live));
  let box = el.querySelector(':scope > .thinkbox');
  if (thinking && !box) { box = thinkBox(p.id, thinking, Boolean(live && !live.text)); el.prepend(box); }
  else if (box && !thinking) box.remove();
  else if (box) updateThinkBox(box, thinking, { live: Boolean(live && !live.text) });
  const prose = el.querySelector(':scope > .prose');
  if (prose && (before.body[3] !== after.body[3] || before.body[5] !== tint || before.body[11] !== after.body[11] || (!text && Boolean(before.body[4]) !== Boolean(after.body[4])))) {
    growProse(prose, text, { tint, names });
    if (!text && (v.streaming || live)) prose.append(h('p', { style: { color: 'var(--ink-faint)', fontStyle: 'italic' } }, thinking ? 'Thinking…' : 'Writing…'));
  }
  if (!sameParts(before.controls, after.controls) || before.body[6] !== after.body[6]) {
    const row = el.querySelector(':scope > .pctl');
    if (row) row.remove();
    if (S.selected === p.id && S.editing !== p.id) el.insertBefore(p.by === 'break' ? breakControls(p) : controls(p), el.querySelector(':scope > .rewriterow'));
  }
  const rewrite = el.querySelector(':scope > .rewriterow');
  if (rewrite && S.rewriting !== p.id) rewrite.remove();
  else if (!rewrite && S.rewriting === p.id && S.editing !== p.id) el.append(rewriteRow(p));
}
/* the judge's grade of the version on show, in the passage's line (with the judge on) */
function gradeSaid(p, c = chapter()) {
  if (!c || !checker.judgeOf(store.peek('house', 'house') || {})) return '';
  const e = checker.entryFor(c, p);
  const g = e && e.grade;
  return g && Number.isFinite(g.overall) && g.of ? `graded ${g.overall} of ${g.of}` : '';
}

function defaultSelected(list) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].by !== 'break') return list[i].id;
  return null;
}

function drawPassage(p, { tint, names = null }) {
  /* a passage is reached by keyboard too: Enter shows its controls */
  const el = h('div.passage', { 'data-id': p.id, tabindex: '0' });
  el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); select(p.id); } });
  if (p.by === 'break') {
    el.classList.add('break');
    el.append(h('p.orn', '❦'));
    el.addEventListener('click', () => select(p.id));
    if (S.selected === p.id) { el.classList.add('selected'); el.append(breakControls(p)); }
    return el;
  }
  const v = picked(p) || { text: '' };
  const live = S.live.get(p.id);
  const text = live ? live.text : v.text;
  const thinking = live ? live.thinking : v.thinking;
  if (v.streaming || live) el.classList.add('streaming');
  if (thinking) el.append(thinkBox(p.id, thinking, Boolean(live && !live.text)));
  if (S.editing === p.id) {
    const ta = h('textarea.editbox', { 'aria-label': 'Edit the passage' });
    /* the words the box was opened on, whatever came meanwhile */
    ta.value = typeof S.editText === 'string' ? S.editText : ((S.editFrom && p.versions.find((x) => x.id === S.editFrom)) || v).text || '';
    el.append(ta, h('div.editrow',
      h('button.btn.primary.small', { onclick: () => finishEdit(p.id, ta.value) }, 'Save'),
      h('button.btn.quiet.small', { onclick: () => closeEdit() }, 'Cancel'),
      h('span.say', { style: { margin: 0, color: 'var(--ink-soft)' } }, 'Your edit goes on the page itself — ⋯ → Put back the words before undoes it.')));
    autoGrow(ta, 0.7);
    /* the keyboard goes to it once, when it opens — never again on a redraw */
    if (S.focusNext === 'edit') { S.focusNext = null; setTimeout(() => ta.focus(), 30); }
    return el;
  }
  const prose = h('div.prose');
  drawProse(prose, text, { tint, names });
  if (!text && (v.streaming || live)) prose.append(h('p', { style: { color: 'var(--ink-faint)', fontStyle: 'italic' } }, thinking ? 'Thinking…' : 'Writing…'));
  el.append(prose);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.pctl, .thinkbox, .rewriterow, button, textarea, input')) return;
    if (window.getSelection && !window.getSelection().isCollapsed) return;
    /* a marked name opens its card (Tap names) — the passage stays as it was */
    const nm = e.target.closest('.prose .nm');
    if (nm && nm.dataset.name) { tapName(S.novelId, nm.dataset.name, e); return; }
    select(p.id);
  });
  if (S.selected === p.id) {
    el.classList.add('selected');
    el.append(controls(p));
    if (S.rewriting === p.id) el.append(rewriteRow(p));
  }
  return el;
}

function thinkBox(pid, thinking, liveNow) {
  return makeThinkBox(thinking, { live: liveNow, open: S.thinkOpen.has(pid), onToggle: (now) => { if (now) S.thinkOpen.add(pid); else S.thinkOpen.delete(pid); } });
}

function select(pid) {
  if (S.selected === pid) return;
  S.selected = pid;
  S.rewriting = null;
  drawPage();
}

/* the writer busy with something of his — a page the app writes by itself (the
 * judge's lift) never holds his hand: anything he asks goes first (run) */
function busy() { return writer.busy(S.novelId) && !writer.autoBusy(S.novelId); }

function controls(p) {
  const c = chapter();
  const v = picked(p) || {};
  const row = h('div.pctl');
  const live = S.live.has(p.id) || v.streaming;
  const working = busy();
  if (p.versions.length > 1) {
    const i = p.versions.indexOf(v);
    row.append(h('span.ver',
      h('button', { 'aria-label': 'The version before', title: 'The version before — its notes come back with it', disabled: working || i <= 0, onclick: () => pickVersion(p, i - 1) }, icon('left', 16)),
      h('span', `${i + 1} / ${p.versions.length}`),
      h('button', { 'aria-label': 'The version after', title: 'The version after — its notes come back with it', disabled: working || i >= p.versions.length - 1, onclick: () => pickVersion(p, i + 1) }, icon('right', 16))));
  }
  if (live) {
    row.append(h('span', { style: { padding: '0 8px', color: 'var(--ink-faint)' } }, 'Being written…'));
    return row;
  }
  /* a rewrite of selected words that stopped partway is written again, never carried on from the passage's end */
  const carry = cutAtEnd(v);
  if (carry) row.append(h('button.go', { title: 'Carry this passage on from its last word', disabled: working, onclick: () => run(() => writer.goOn({ novelId: S.novelId, chapterId: c.id, passageId: p.id })) }, 'Go on'));
  if (writer.takeOf(p)) row.append(h('button', { title: 'The same request written again, as a new version — the notes it is written from are the ones before this passage', disabled: working, onclick: () => run(() => writer.anotherTake({ novelId: S.novelId, chapterId: c.id, passageId: p.id })) }, 'Another take'));
  row.append(h('button', { title: 'Say what should change; the change becomes what happens, carried through the passage', disabled: working, onclick: () => { S.rewriting = S.rewriting === p.id ? null : p.id; S.focusNext = 'rewrite'; drawPage(); } }, 'Rewrite…'));
  row.append(h('button', { title: 'Change the words yourself, on the page itself — ⋯ → Put back the words before undoes it', disabled: working, onclick: () => openEdit(p.id) }, 'Edit'));
  /* HIS PREMISE, A TAP AWAY (his word, 2.12.31: "it should have a button and be hidden, not below it — it destroys
   * immersion"): the words he typed for this page, shown only when he presses Premise, and put away again the same way */
  const premise = premiseOf(p);
  const premiseLine = premise ? h('div.note.premise', { hidden: !S.premiseOpen.has(p.id) }, h('b', 'Your premise: '), premise) : null;
  if (premise) {
    const btn = h('button.premisebtn', { title: 'The premise you typed for this page', 'aria-expanded': String(S.premiseOpen.has(p.id)), onclick: () => {
      const open = !S.premiseOpen.has(p.id);
      if (open) S.premiseOpen.add(p.id); else S.premiseOpen.delete(p.id);
      premiseLine.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    } }, 'Premise');
    row.append(btn);
  }
  row.append(h('button', { 'aria-label': 'More for this passage', title: 'More for this passage', onclick: (e) => passageMenu(e.currentTarget, p) }, icon('more', 18)));
  /* what to know about this version, in a line — first, its number on the page */
  const bits = [];
  const num = passageNumbers(c).get(p.id);
  if (num) bits.push(`Passage ${num}`);
  const graded = gradeSaid(p);
  if (graded) bits.push(graded);
  if (v.how === 'mine' || v.how === 'imported') bits.push(v.how === 'imported' ? 'brought in' : 'your words');
  else if (v.how === 'edit') bits.push('edited by you');
  else if (v.how === 'partner') bits.push(v.why ? `written anew by your partner: “${v.why.slice(0, 80)}”` : 'written anew by your partner');
  else if (v.how === 'suggested') bits.push('the checker’s fixes put in');
  /* changed on the page itself (2.12.2): by whom, the newest reason his partner gave */
  const hands = handsOf(v);
  if (hands.includes('you') && v.how !== 'edit' && v.how !== 'mine') bits.push('edited by you');
  if (hands.includes('partner')) { const why = [...(v.before || [])].reverse().find((b) => b && b.by === 'partner' && b.why && !b.rename); bits.push(why ? `changed by your partner: “${String(why.why).slice(0, 80)}”` : 'changed by your partner'); }
  /* (a name changed everywhere is no one's hand on the page — shape.js inPlaceFields, 2.12.41 — and is said as itself) */
  if ((v.before || []).some((b) => b && b.rename)) bits.push('a name changed everywhere');
  if (hands.includes('checker') && v.how !== 'suggested') bits.push('the checker’s fixes put in');
  if (v.words || v.text) bits.push(plural(v.words || countWords(v.text), 'word'));
  /* the request that wrote it, counted in full: the provider's own count, or the app's (about) */
  if (Number.isFinite(v.tokensIn)) bits.push(`${v.tokensCounted ? '' : 'about '}${v.tokensIn.toLocaleString()} tokens sent`);
  if (v.ask && v.ask.note && (v.how === 'rewrite' || v.how === 'selection')) bits.push(`“${v.ask.note.slice(0, 60)}”`);
  if (v.done || v.at) bits.push(timeAgo(v.done || v.at));
  if (bits.length) row.append(h('div.note', bits.join(' · ')));
  /* (his premise, whole, when he opened it — shape.js premiseOf) */
  if (premiseLine) row.append(premiseLine);
  if (v.cut) row.append(h('div.note.warn', `It stopped partway${v.cutWhy ? ` (${v.cutWhy})` : ''}. ${carry ? 'Go on carries it on from the last word.' : 'Another take writes it again.'}`));
  if (v.notes && v.notes.length) row.append(h('div.note', v.notes.join(' ')));
  /* only an address on the web is ever a link (a page kept before this check, too) */
  const looked = (v.sources || []).filter((x) => x && webUrl(x.url));
  if (looked.length) row.append(h('div.note.sources', 'Looked up: ', ...looked.slice(0, 8).flatMap((x, k) => [k ? ' · ' : '', h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, String(x.title || x.url).slice(0, 80))])));
  return row;
}

function breakControls(p) {
  const c = chapter();
  return h('div.pctl', { style: { justifyContent: 'center' } },
    h('span', { style: { color: 'var(--ink-faint)', padding: '0 8px' } }, 'A scene break'),
    h('button', { onclick: () => removePassage(p) }, 'Remove it'));
}

function rewriteRow(p) {
  const inp = h('input', { type: 'text', placeholder: 'What should change? (optional)', 'aria-label': 'What should change' });
  const go = () => {
    const note = inp.value.trim();
    S.rewriting = null;
    run(() => writer.rewrite({ novelId: S.novelId, chapterId: S.chapterId, passageId: p.id, note }));
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  if (S.focusNext === 'rewrite') { S.focusNext = null; setTimeout(() => inp.focus(), 30); }
  return h('div.rewriterow', inp, h('button.btn.primary.small', { onclick: go }, 'Rewrite'), h('button.btn.quiet.small', { onclick: () => { S.rewriting = null; drawPage(); } }, 'Cancel'));
}

function passageMenu(anchor, p) {
  const c = chapter();
  p = c && (c.passages || []).find((x) => x.id === p.id);
  if (!p) return;
  const v = picked(p) || {};
  const i = c.passages.indexOf(p);
  menu(anchor, [
    v.sent ? { label: 'What the writer was sent', hint: v.how === 'suggested' || v.how === 'edit' || v.how === 'partner' ? 'Every word of the request that wrote the words this version was made from.' : 'Every word of the request this version was written from.', run: () => showSent(S.novelId, v.sent) } : null,
    gradeSaid(p) ? { label: 'What the judge said', hint: 'Its ten checks of this version — each passed or failed, with the words; a no it could not find in the passage is shown, not counted.', run: () => showJudged(S.novelId, c.id, p.id) } : null,
    ...(Array.isArray(v.sentMore) ? v.sentMore : []).map((key, k, all) => ({ label: all.length > 1 ? `What Go on was sent (${numberWords(k + 1).toLowerCase()})` : 'What Go on was sent', hint: 'Every word of the request that carried this passage on.', run: () => showSent(S.novelId, key) })),
    { label: 'Copy the words', hint: 'This passage as it shows, to paste anywhere.', run: async () => { toast((await copyText(v.text || '')) ? 'Copied.' : 'It could not be copied.'); } },
    Array.isArray(v.before) && v.before.length && !v.streaming ? { label: 'Put back the words before',
      hint: `The words before the last change made on this page — ${v.before[v.before.length - 1].rename ? 'a name changed everywhere' : ({ checker: 'the checker’s fixes', partner: 'your partner’s change', you: 'your edit' })[v.before[v.before.length - 1].by] || 'the last change'}${v.before.length > 1 ? `; ${v.before.length - 1} more before ${v.before.length === 2 ? 'it' : 'them'} can be put back after` : ''}. What the checker found in them comes back with them, and nothing goes in on them by itself.`,
      run: () => { const out = putBackWords({ novelId: S.novelId, chapterId: c.id, passageId: p.id, versionId: v.id }); if (out.ok) { archivist.nudge(S.novelId); drawPage(); toast('The words before are back.'); } else toast(`They couldn’t be put back: ${out.said}.`, 5000); } } : null,
    v.tookOff || v.tookOffTop ? { label: v.tookOff && v.tookOffTop ? 'Put back what was taken off' : v.tookOffTop ? 'Put back what was taken off its top' : 'Put back what was taken off its end',
      hint: v.tookOff && v.tookOffTop ? 'What the writer put around the story — a heading or its plan above it, and a note to you, its check of its work or a block of tracking after it — back where it stood, on the page itself.' : v.tookOffTop ? 'What the writer put above the story — a heading, or its plan for the page — back at the top as it came, on the page itself.' : 'What the writer added after the story — a note to you, its check of its work, a block of tracking — back on the page as it came.',
      run: () => { if (writer.putBackTail({ novelId: S.novelId, chapterId: c.id, passageId: p.id })) { archivist.nudge(S.novelId); toast('Put back — ⋯ → Put back the words before takes it off again.'); } } } : null,
    '-',
    { label: 'Write from here (a passage after this one)', hint: 'A new passage between this one and the next, written to fit both.', disabled: busy(), run: () => { S.insertAfter = p.id; S.sel = null; drawComposer(); ui.direction.focus(); } },
    { label: 'Branch from here', hint: 'Take the story up to this passage into a separate book, with its own notes.', disabled: branchBusy(S.novelId), run: () => openBranch({ novelId: S.novelId, chapterId: c.id, through: p.id }) },
    { label: 'Add a scene break after this', hint: 'A * * * line: a new scene begins after it.', run: () => { writer.addBreak({ chapterId: c.id, after: p.id }); } },
    i > 0 ? { label: 'Start a new chapter from here', hint: 'This passage and everything after it become the next chapter.', disabled: busy(), run: () => splitHere(p) } : null,
    '-',
    p.versions.length > 1 ? { label: 'Remove this version', hint: 'Only the version on show goes; its notes go with it. With Undo.', danger: true, run: () => removeVersions(p, [v.id]) } : null,
    p.versions.length > 2 ? { label: 'Remove versions…', hint: 'Choose the ones to go — any of them, one always stays. With Undo.', danger: true, run: () => chooseVersions(p) } : null,
    { label: 'Remove the passage', hint: 'With Undo; anything only it put in the notes goes too.', danger: true, run: () => removePassage(p) },
  ]);
}

function pickVersion(p, i) {
  p = (chapter()?.passages || []).find((x) => x.id === p.id);
  const v = p && p.versions[i];
  if (!v) return;
  /* put on show by his own hand: left as he chose it — nothing the checker does by itself starts from it */
  store.change('chapter', S.chapterId, chapterSteps.choose(p.id, v.id));
  /* a version read before brings its own notes back at once (readings.js) */
  archivist.settle(S.novelId);
  archivist.nudge(S.novelId, 8000);
  drawPage();
}

/* The edit box is open over the page like a sheet: the phone's Back closes
 * it — keeping what he typed, as a new version (the earlier words stay one
 * arrow away), so nothing typed is ever lost to a Back. */
function openEdit(pid) {
  keepOpenEdit();
  S.editing = pid;
  /* the version the box opens on: his edit is made on it, whatever comes meanwhile — and nothing goes in by itself under his hand (Cozy Tavern M429) */
  { const c = chapter(); const p = c && (c.passages || []).find((x) => x.id === pid); S.editFrom = p && picked(p) ? picked(p).id : null; S.editText = p && picked(p) ? String(picked(p).text || '') : null; }
  checker.setEditing(pid, true);
  S.focusNext = 'edit';
  S.editBack = onBack(() => { S.editBack = null; keepOpenEdit(true); });
  drawPage();
}
/* the box closed: what waited for it may go in now */
function editDone(pid) {
  if (!pid) return;
  checker.setEditing(pid, false);
  checker.schedule(S.novelId, 1500);
}
/* the words the box was opened on — and whether another version came meanwhile */
function editBase(pid) {
  const c = chapter();
  const p = c && (c.passages || []).find((x) => x.id === pid);
  const shown = p && picked(p);
  const v = p && ((S.editFrom && p.versions.find((x) => x.id === S.editFrom)) || shown);
  const opened = typeof S.editText === 'string' ? S.editText : String((v && v.text) || '');
  /* another version on show now (a rewrite), or these words changed on the page while he edited (his partner's change) */
  const meanwhile = !v || !shown ? '' : v.id !== shown.id ? MEANWHILE : String(v.text || '') !== opened ? CHANGED_MEANWHILE : '';
  return { from: v ? v.id : null, text: opened, meanwhile };
}
function closeEdit() {
  editDone(S.editing);
  S.editing = null;
  S.editText = null;
  if (S.editBack) { const r = S.editBack; S.editBack = null; r(); }
  drawPage();
}
function keepOpenEdit(fromBack = false) {
  if (!S.editing) return;
  const box = ui && ui.passages.querySelector('.editbox');
  const pid = S.editing;
  const base = editBase(pid);
  S.editing = null;
  S.editText = null;
  if (!fromBack && S.editBack) { const r = S.editBack; S.editBack = null; r(); }
  if (box) {
    if (!box.value.trim()) toast(EMPTY_EDIT, 6000);
    else {
      if (writer.saveEdit({ novelId: S.novelId, chapterId: S.chapterId, passageId: pid, text: box.value, fromId: base.from, opened: base.text })) editKept(pid, base.text, box.value, `Your edit is kept — ⋯ → Put back the words before undoes it.${base.meanwhile}`);
    }
  }
  editDone(pid);
  if (fromBack) drawPage();
}
/* another version came while he edited (his partner, a fix): said, never lost */
const MEANWHILE = ' Another version came while you edited — it is one arrow away; your edit is on the one you opened.';
const CHANGED_MEANWHILE = ' These words were changed while you edited (your partner, a fix) — your edit is on the page now, and those words are under ⋯ → Put back the words before.';
/* a passage emptied in the edit box is not kept empty: taking it out is its own step */
const EMPTY_EDIT = 'An empty passage is not kept, so the words stay as they were. To take the passage out, use ⋯ → Remove the passage.';
function finishEdit(pid, text) {
  const empty = !String(text || '').trim();
  const base = editBase(pid);
  const changed = !empty && writer.saveEdit({ novelId: S.novelId, chapterId: S.chapterId, passageId: pid, text, fromId: base.from, opened: base.text });
  S.editing = null;
  S.editText = null;
  if (S.editBack) { const r = S.editBack; S.editBack = null; r(); }
  editDone(pid);
  drawPage();
  if (empty) toast(EMPTY_EDIT, 6000);
  else if (changed) editKept(pid, base.text, text, `Saved — ⋯ → Put back the words before undoes it.${base.meanwhile}`);
}
/* His edit kept, and said. When it changed a name everywhere it stood in the
 * passage, and the rest of the book still holds the old one, changing it
 * everywhere is offered (Cozy Tavern M100, the ripple — offered, never done
 * by itself): every passage, chapter name, card, the book's own words and
 * the scenes, each passage a new version, with Undo. */
function editKept(pid, before, after, words) {
  const novelId = S.novelId;
  archivist.nudge(novelId);
  const n = store.peek('novel', novelId) || {};
  const cards = NOTE_KINDS.flatMap((k) => (n.notes && n.notes[k]) || []);
  const isName = (w) => namedMidSentence(before, w) || cards.some((c) => [c.name, ...(c.aka || [])].some((x) => (' ' + foldName(x) + ' ').includes(' ' + foldName(w) + ' ')));
  const ch = nameChange(before, after, isName);
  if (!ch || !standsElsewhere(n, ch.from, pid)) { toast(words); return; }
  toast(`${words} “${ch.from}” is “${ch.to}” here now; the rest of the book still says “${ch.from}”.`, 12000, { label: 'Change it everywhere', run: () => {
    const out = makeChange(novelId, { rename: { from: ch.from, to: ch.to }, why: 'Your edit of the name.' });
    if (out.status !== 'made') { toast(`Nothing was changed — ${out.said}.`, 7000); return; }
    archivist.nudge(novelId);
    undoToast(`“${ch.from}” is “${ch.to}” everywhere — ${String(out.said || '').replace(/^changed in /, 'changed in ')}.`, () => {
      const back = undoChange(novelId, out);
      archivist.nudge(novelId);
      toast(back.ok ? (back.said ? `Put back — ${back.said}.` : `Put back — “${ch.from}” everywhere else again.`) : `It could not be put back — ${back.said}.`, 6000);
    });
  } });
}
/* the old name still stands somewhere else in the book: another passage, a chapter's name, a card */
function standsElsewhere(n, name, pid) {
  const w = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${w}(?![\\p{L}\\p{M}\\p{N}])`, 'u');
  for (const id of n.order || []) {
    const c = store.peek('chapter', id);
    if (!c) continue;
    if (re.test(String(c.name || ''))) return true;
    for (const p of c.passages || []) if (p.id !== pid && p.by !== 'break' && re.test(String((picked(p) || {}).text || ''))) return true;
  }
  return NOTE_KINDS.some((k) => ((n.notes && n.notes[k]) || []).some((c) => [c.name, ...(c.aka || []), c.about, c.now, c.ties].some((x) => re.test(String(x || '')))));
}

/* Versions taken out — the one on show, or several chosen — with Undo; one
 * always stays. Each one's notes go with it (the helper read it: its words
 * are kept for it, so what came only from them is taken back). */
function removeVersions(p, ids) {
  const chapterId = S.chapterId;
  const live = (chapter().passages || []).find((x) => x.id === p.id);
  if (!live) return;
  const gone = ids.filter((id) => live.versions.some((v) => v.id === id));
  if (!gone.length) return;
  if (gone.length >= live.versions.length) { toast('One version always stays.'); return; }
  const before = JSON.parse(JSON.stringify(live.versions));
  const shown = (picked(live) || {}).id;
  for (const id of gone) archivist.retireIfSeen(S.novelId, chapterId, p.id, id);
  for (const id of gone) store.change('chapter', chapterId, chapterSteps.removeVersion(p.id, id), { now: true });
  /* the one on show taken away: the version that comes on show in its place is his choice too */
  const after = gone.includes(shown) ? picked((chapter().passages || []).find((x) => x.id === p.id) || { versions: [] }) : null;
  if (after) store.change('chapter', chapterId, chapterSteps.choose(p.id, after.id), { now: true });
  archivist.settle(S.novelId);
  archivist.nudge(S.novelId);
  writer.recount(S.novelId);
  drawPage();
  undoToast(gone.length === 1 ? 'The version is removed.' : `${plural(gone.length, 'version')} are removed.`, () => {
    store.change('chapter', chapterId, chapterSteps.putVersionsBack(p.id, before, shown), { now: true });
    store.change('chapter', chapterId, chapterSteps.clearRetired(gone.map((id) => `${p.id}:${id}`)), { now: true });
    archivist.settle(S.novelId);
    archivist.nudge(S.novelId);
    writer.recount(S.novelId);
    drawPage();
  });
}
/* the versions of a passage, to choose which go */
function chooseVersions(p) {
  const live = (chapter().passages || []).find((x) => x.id === p.id) || p;
  const shown = (picked(live) || {}).id;
  const s = openSheet('Remove versions', { small: true });
  const boxes = live.versions.map((v, i) => {
    const cb = h('input', { type: 'checkbox' });
    const first = String(v.text || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    return { v, cb, row: h('label.verrow', cb, h('span.grow', h('b', `Version ${i + 1}${v.id === shown ? ' — on show' : ''}`), h('small', `${first}${String(v.text || '').length > 90 ? '…' : ''}`), h('small', timeAgo(v.done || v.at || 0)))) };
  });
  const go = h('button.btn.primary.small.danger', { disabled: true }, 'Remove the chosen');
  const sync = () => {
    const n = boxes.filter((b) => b.cb.checked).length;
    go.disabled = !n || n >= boxes.length;
    go.textContent = n >= boxes.length ? 'One has to stay' : n ? `Remove ${plural(n, 'version')}` : 'Remove the chosen';
  };
  for (const b of boxes) b.cb.addEventListener('change', sync);
  go.addEventListener('click', () => { const ids = boxes.filter((b) => b.cb.checked).map((b) => b.v.id); s.close(); removeVersions(live, ids); });
  s.body.append(h('p.say', 'Tick the ones to go. Their notes go with them; one always stays. With Undo.'),
    h('div.verlist', ...boxes.map((b) => b.row)),
    h('div.btnrow', go, h('button.btn.quiet.small', { onclick: () => { for (const b of boxes) b.cb.checked = b.v.id !== shown; sync(); } }, 'All but the one on show')));
}

function removePassage(p) {
  p = (chapter()?.passages || []).find((x) => x.id === p.id);
  if (!p) return;
  const c = chapter();
  const i = c.passages.findIndex((x) => x.id === p.id);
  const after = i > 0 ? c.passages[i - 1].id : '^';
  const copy = JSON.parse(JSON.stringify(p));
  archivist.retireIfSeen(S.novelId, S.chapterId, p.id);
  /* (taken out only while it reads as he saw it — his words typed into it meanwhile in another window keep it, never
   * taken out with them nor brought back by Undo as the older words: 2.12.41, a step laid again over another window's
   * newer copy) */
  store.change('chapter', S.chapterId, chapterSteps.removePassage(p.id, passagePrint(p)), { now: true });
  archivist.settle(S.novelId);
  archivist.nudge(S.novelId, 9000);
  writer.recount(S.novelId);
  S.undo = { chapterId: S.chapterId, passage: copy, after };
  drawPage();
  undoToast('The passage is removed.', () => {
    const u = S.undo;
    if (!u) return;
    store.change('chapter', u.chapterId, chapterSteps.addPassage(u.passage, u.after), { now: true });
    /* back in its place: nothing of it is taken out any more — and the
     * notes it made, taken back when it went, come back at once */
    store.change('chapter', u.chapterId, chapterSteps.clearRetired([u.passage.id]), { now: true });
    S.undo = null;
    archivist.settle(S.novelId);
    archivist.nudge(S.novelId);
    writer.recount(S.novelId);
    drawPage();
  });
}

async function splitHere(p) {
  const n = novel();
  const c = chapter();
  const i = c.passages.findIndex((x) => x.id === p.id);
  if (i <= 0) return;
  if (!(await confirmIt('A new chapter from here', `Everything from this passage on becomes ${`Chapter ${numberWords(n.order.indexOf(c.id) + 2)}`}, right after this one.`, 'Start the new chapter'))) return;
  const moving = JSON.parse(JSON.stringify(c.passages.slice(i)));
  const fresh = newChapter(S.novelId);
  fresh.passages = moving;
  /* what was kept for those passages goes with them (shape.js keptFor) */
  Object.assign(fresh, keptFor(c, moving.map((m) => m.id)));
  await store.create('chapter', fresh.id, fresh);
  store.change('novel', S.novelId, novelSteps.addChapter(fresh.id, c.id), { now: true });
  /* the moved passages were read where they stood: the helper is told nothing new */
  archivist.moveSeen(S.novelId, c.id, fresh.id, moving.map((m) => m.id));
  /* (THE PASSAGES MOVED, BY ID, EACH ONLY WHILE IT READS AS IT WAS COPIED — 2.12.41, a step laid again over another
   * window's newer copy: everything from here on was cut, so a page written or changed meanwhile in another window went
   * with the old copy into the new chapter, its newer words nowhere) */
  const moved = new Map(moving.map((m) => [m.id, passagePrint(m)]));
  store.change('chapter', c.id, (ch) => { const before = (ch.passages || []).length; ch.passages = (ch.passages || []).filter((x) => moved.get(x.id) !== passagePrint(x)); return ch.passages.length !== before; }, { now: true });
  store.change('chapter', c.id, chapterSteps.pruneChecks(), { now: true });
  if (fresh.retired.length) store.change('chapter', c.id, chapterSteps.clearRetired(fresh.retired.map((r) => r.key)), { now: true });
  archivist.nudge(S.novelId);
  hooks.goChapter(fresh.id);
  await carryStrays(S.novelId, c.id, fresh.id, c.passages.slice(0, i).map((x) => x.id), moved);
}
/* …and once the cut has landed: what still stands in the chapter after the passages kept there — a moved passage
 * changed meanwhile in another window, a page written there since — goes on into the new chapter, with its words as
 * they are now (the app puts right what it can tell). A page still being written stays where its writer writes it,
 * and the older copy of it taken to the new chapter goes: never one passage in two chapters. */
async function carryStrays(novelId, fromId, toId, keepIds, moved) {
  try { await store.flush('chapter', fromId); } catch (_) { return; }
  const now = store.peek('chapter', fromId);
  if (!now || !store.peek('chapter', toId)) return;
  const keep = new Set(keepIds);
  const list = now.passages || [];
  let last = -1;
  list.forEach((x, k) => { if (keep.has(x.id)) last = k; });
  const writing = (x) => (x.versions || []).some((v) => v && v.streaming);
  const strays = JSON.parse(JSON.stringify(list.slice(last + 1).filter((x) => !keep.has(x.id))));
  if (!strays.length) return;
  const carried = store.change('chapter', toId, (fc) => {
    const out = [];
    for (const q of strays) {
      const at = (fc.passages || []).findIndex((x) => x.id === q.id);
      const asMoved = at >= 0 && passagePrint(fc.passages[at]) === moved.get(q.id);
      if (writing(q)) { if (asMoved) fc.passages.splice(at, 1); continue; }
      if (at >= 0) { if (asMoved) { fc.passages[at] = JSON.parse(JSON.stringify(q)); out.push(q); } }
      else { fc.passages.push(JSON.parse(JSON.stringify(q))); out.push(q); }
    }
    return out;
  }, { now: true }) || [];
  for (const q of carried) store.change('chapter', fromId, chapterSteps.removePassage(q.id, passagePrint(q)), { now: true });
  if (!carried.length) return;
  archivist.moveSeen(novelId, fromId, toId, carried.map((q) => q.id));
  archivist.nudge(novelId);
}

/* ----------------------------------------------------- the end of the page */

let endDrawn = null;
function drawEnd() {
  const c = chapter();
  const n = novel();
  const list = c.passages || [];
  const hasText = list.some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
  /* a page that did not come, said in the chapter it was asked for — with
   * what the model thought, kept to read and copy (Cozy Tavern M301) */
  let err = S.errors.get(c.id);
  /* a passage added since — his words, a scene turned into prose — and the failure no longer stands (Cozy Tavern's M669) */
  if (err && err.ids && (c.passages || []).some((p) => !err.ids.has(p.id))) { S.errors.delete(c.id); err = null; }
  const at = n.order.indexOf(c.id);
  const next = store.peek('chapter', n.order[at + 1]);
  /* Super automatic: the writer ended this chapter — the next page goes in the next one (writer.js closedGoesOn, the
   * very answer Write and Add as my words go by) */
  const goes = writer.closedGoesOn(n.id, c.id);
  const key = [n.id, c.id, Boolean(list.length), hasText, at, n.order.length, n.order[at + 1], next && next.name, busy(), S.making,
    err, err && err.words, err && err.thought, err && err.stopped, err && err.needsConnection, goes && goes.number];
  if (endDrawn && sameParts(endDrawn, key)) return;
  endDrawn = key;
  ui.end.textContent = '';
  if (!list.length) {
    const first = n.order.indexOf(c.id) === 0;
    ui.end.append(h('div.firstpage',
      h('span.firstpage-orn', { 'aria-hidden': 'true' }, '❧'),
      h('h2', first ? 'A world begins here.' : 'A new chapter awaits.'),
      h('p.emptypage', first
        ? 'The first page. Say how the story opens and press Write — or write the opening yourself and press Add as my words.'
        : 'A fresh chapter. Say what happens and press Write, or write it yourself. With the box left empty, Write carries the story on.'),
      h('button.btn.quiet.small', { onclick: () => ui.direction.focus(), title: 'Move to the box below to write your opening or say what happens.' }, 'Start your opening', h('span', { 'aria-hidden': 'true' }, '↓'))));
  }
  if (err) {
    const card = h('div.endcard.error',
      h('b', err.stopped ? 'Stopped before any words came. ' : 'The page did not come. '), err.stopped ? 'What it thought is below.' : err.words);
    if (err.thought) {
      const fold = h('details.keptthought', h('summary', 'What it thought'), h('div.thinkbody', err.thought));
      card.append(fold, h('p.say.quiet', 'Copy it, and Add as my words puts any of it in the chapter as your own.'));
    }
    card.append(h('div.row', err.needsConnection ? h('button.btn.primary.small', { onclick: () => hooks.openSettings('connections') }, 'Open Connections') : null,
      err.thought ? h('button.btn.small', { title: 'Its thinking, to paste anywhere', onclick: async () => toast((await copyText(err.thought)) ? 'What it thought is copied.' : 'It could not be copied.') }, 'Copy what it thought') : null,
      h('button.btn.small', { onclick: () => { S.errors.delete(c.id); drawEnd(); } }, 'Dismiss')));
    ui.end.append(card);
  }
  if (hasText && !busy()) {
    if (goes) ui.end.append(h('p.say.quiet.chapterended', `The chapter ends here — your next page goes in Chapter ${numberWords(goes.number)}.`));
    if (at === n.order.length - 1) {
      ui.end.append(h('div.nextchapter', h('button.btn', { disabled: S.making, onclick: () => newChapterAfter(c.id) }, `Start Chapter ${numberWords(at + 2)} `, icon('right', 16))));
    } else {
      const name = next && next.name ? ` — ${next.name.length > 48 ? next.name.slice(0, 48).replace(/\s+\S*$/, '') + '…' : next.name}` : '';
      ui.end.append(h('div.nextchapter', h('button.btn.quiet', { onclick: () => hooks.goChapter(n.order[at + 1]) }, `On to Chapter ${numberWords(at + 2)}${name} `, icon('right', 16))));
    }
  }
}

/* a chapter opened, and the page drawn, before what comes next (a few seconds at most) */
async function openThen(chapterId) {
  hooks.goChapter(chapterId);
  for (let i = 0; i < 60 && !(S.chapterId === chapterId && ui.end); i++) await new Promise((r) => setTimeout(r, 50));
}

/* one tap, one chapter */
export async function newChapterAfter(afterId) {
  if (S.making) return;
  S.making = true;
  drawEnd();
  try {
    const fresh = newChapter(S.novelId);
    await store.create('chapter', fresh.id, fresh);
    store.change('novel', S.novelId, novelSteps.addChapter(fresh.id, afterId), { now: true });
    writer.recount(S.novelId);
    hooks.goChapter(fresh.id);
  } finally { S.making = false; }
}

/* ---------------------------------------------------------- the composer */

const chipLabels = new WeakMap();
function drawChip(button, label) {
  if (chipLabels.get(button) === label) return;
  chipLabels.set(button, label);
  button.replaceChildren(h('b', label), icon('down', 14));
}
let writeLabel = '';
/* the one button under the page says what it does now: Stop while the writer
 * writes, Rewrite for selected words, Write for his premise — and Continue
 * with the box empty: the writer chooses what happens next (prompts.js
 * writeRequest, no premise) */
/* Continue: the box empty and the next passage at the chapter's end (Write from here on its last passage too) —
 * between two passages the writer bridges them, and the button says Write */
function atTheEnd() {
  if (!S.insertAfter) return true;
  const c = chapter();
  const list = (c && c.passages) || [];
  const at = list.findIndex((p) => p.id === S.insertAfter);
  return at < 0 || !list.slice(at + 1).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
}
function drawWriteLabel(working = busy()) {
  const empty = !ui.direction.value.trim();
  const label = working ? 'Stop' : S.sel ? 'Rewrite' : empty && atTheEnd() ? 'Continue' : 'Write';
  if (label === writeLabel) return;
  writeLabel = label;
  ui.writeBtn.replaceChildren(...(working ? [icon('stop', 16), label] : [label]));
  ui.writeBtn.classList.toggle('primary', !working);
  ui.writeBtn.title = working ? 'Stops the writer — what came is kept' : label === 'Rewrite' ? 'Writes the selected words again, the rest of the passage as it is'
    : label === 'Continue' ? 'The writer decides what happens next — whatever this story most needs now — and writes it onto the page' : 'Writes what the box says happens next';
}
function drawComposer() {
  const n = novel();
  if (!n) return;
  const working = busy();
  const len = (n.prefs && n.prefs.length) || 'scene';
  drawChip(ui.lengthBtn, LENGTHS[len] ? LENGTHS[len].label : 'A scene');
  drawChip(ui.outcomeBtn, OUTCOMES[outcomeOf(n)].label);
  const house = store.peek('house', 'house') || {};
  const w = writer.connFor(house, 'writer');
  drawChip(ui.writerBtn, w ? writer.connName(w) : 'Choose a writer');
  drawWriteLabel(working);
  ui.mineBtn.disabled = working || Boolean(S.sel);
  /* Ideas: there only while it is on (Settings → Who does what) */
  ui.ideasBtn.hidden = !ideasOn(house);
  if (!ui.ideasBtn.firstChild || ui.ideasBtn.firstChild.nodeType === 3) { ui.ideasBtn.textContent = ''; ui.ideasBtn.append(icon('feather', 14), h('b', 'Ideas')); }
  const was = ui.direction.placeholder;
  ui.direction.placeholder = S.sel ? 'How should the selected words change? (optional)'
    : S.insertAfter ? 'What happens in the new passage? (optional)'
      : 'What happens next? (optional)';
  if (ui.direction.placeholder !== was) fitDirection();
  drawSelBar();
}

/* Ideas for what happens next: a few premises, a tap puts one in the box —
 * kept for the chapter until he asks for new ones */
const ideasOn = (house) => !(house && house.ideas && house.ideas.on === false);
/* Ideas are kept for the place they were asked for — the book, the chapter
 * and how it ends — and shown only there: never filed under a chapter he
 * moved to while they came, nor offered once the chapter has gone on
 * (Cozy Tavern's M389/M443/M548). */
const IDEAS = { key: '', list: [], asking: null };
function ideasKey() {
  const c = chapter();
  const last = c ? [...(c.passages || [])].reverse().find((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim()) : null;
  const v = last && picked(last);
  return `${S.novelId}|${S.chapterId}|${v ? `${v.id}:${String(v.text || '').length}` : ''}`;
}
async function showIdeas({ fresh = false } = {}) {
  const house = store.peek('house', 'house') || {};
  const count = Number((house.ideas || {}).count) || 4;
  const here = ideasKey();
  let open = true;
  const s = openSheet('Ideas for what happens next', { small: true, onClose: () => { open = false; } });
  const draw = () => {
    if (!open) return;
    s.body.textContent = '';
    if (IDEAS.asking && IDEAS.asking.key === here) {
      s.body.append(h('p.say', 'Thinking of what could happen next…'), h('div.btnrow', h('button.btn.small', { title: 'Lets go of this ask — no ideas come from it.', onclick: () => IDEAS.asking && IDEAS.asking.ctl.abort() }, 'Stop')));
      return;
    }
    const list = IDEAS.key === here ? IDEAS.list : [];
    if (!list.length) { s.body.append(h('p.say', 'None yet.')); }
    for (const idea of list) {
      s.body.append(h('div.idea', h('span', idea), h('button.btn.small.primary', { title: 'Puts this premise in the box — change it as you like, then Write.', onclick: async () => { s.close(); await useAsDirection(idea); } }, 'Use')));
    }
    s.body.append(h('div.btnrow', h('button.btn.small', { title: 'Asks for new ones, from where the book stands now — never the ones above again.', onclick: () => ask() }, 'New ideas')));
  };
  const ask = async () => {
    if (IDEAS.asking && IDEAS.asking.key === here) return;
    /* an ask for another place lets go: only one is ever on its way */
    if (IDEAS.asking) IDEAS.asking.ctl.abort();
    const asking = { key: here, ctl: new AbortController() };
    const not = IDEAS.key === here ? [...IDEAS.list] : [];
    const at = { novelId: S.novelId, chapterId: S.chapterId };
    IDEAS.asking = asking;
    draw();
    const out = await talk.nextIdeas({ ...at, count, signal: asking.ctl.signal, not });
    if (IDEAS.asking === asking) IDEAS.asking = null;
    if (out.ok) { IDEAS.list = out.ideas; IDEAS.key = asking.key; } else if (!out.stopped) toast(`No ideas came${asking.key !== ideasKey() ? ' for the chapter you asked in' : ''}: ${out.error}.`, 5000);
    draw();
  };
  if (IDEAS.asking && IDEAS.asking.key === here) draw();
  else if (fresh || IDEAS.key !== here || !IDEAS.list.length) ask();
  else draw();
}

function lengthMenu() {
  const n = novel();
  const cur = (n.prefs && n.prefs.length) || 'scene';
  menu(ui.lengthBtn, [
    { label: 'How much to write', header: true },
    ...Object.entries(LENGTHS).map(([k, L]) => ({ label: L.label, hint: L.hint ? `${L.hint.charAt(0).toUpperCase()}${L.hint.slice(1)}.` : L.words[0] ? `About ${L.words[0].toLocaleString()}–${L.words[1].toLocaleString()} words.` : 'To where the chapter would naturally end.', checked: k === cur, run: () => { store.change('novel', S.novelId, novelSteps.setPref('length', k)); drawComposer(); } })),
  ]);
}

/* Who decides how what he asks for turns out: the writer, or he does (the
 * writer then stops on the moment it hangs). Each book keeps its own. */
function outcomeMenu() {
  const n = novel();
  const cur = outcomeOf(n);
  menu(ui.outcomeBtn, [
    { label: 'Who decides how it turns out', header: true },
    ...Object.entries(OUTCOMES).map(([k, o]) => ({ label: o.label, hint: `${o.hint.charAt(0).toUpperCase()}${o.hint.slice(1)}.`, checked: k === cur, run: () => {
      store.change('novel', S.novelId, novelSteps.setPref('outcome', k === 'writer' ? '' : k), { now: true });
      drawComposer();
    } })),
  ]);
}

async function run(fn) {
  /* the book and the chapter this was asked in: where its answer — or why
   * none came — is said, wherever he has gone meanwhile */
  const novelId = S.novelId;
  const chapterId = S.chapterId;
  await writer.yieldAuto(novelId);
  S.errors.delete(chapterId);
  S.followId = null;
  F.start();
  drawEnd();
  const out = await fn();
  const here = () => S.novelId === novelId && S.chapterId === chapterId;
  const failed = out && !out.ok && !out.gone && ((!out.stopped && out.error) || (out.stopped && out.thought));
  if (failed) {
    const ch = store.peek('chapter', chapterId);
    S.errors.set(chapterId, { words: sentence(out.error), needsConnection: out.needsConnection, thought: out.thought || '', stopped: Boolean(out.stopped), ids: new Set(((ch && ch.passages) || []).map((p) => p.id)) });
    if (here()) {
      drawPage();
      if (!S.els.size) drawEnd();
      /* the reason is shown where he will see it */
      if (!out.stopped) toBottomSoon(null, true);
    } else if (!out.stopped) {
      /* he went elsewhere while it wrote: told now, and kept in its chapter for when he goes back */
      toast(`${chapterNameOf(novelId, chapterId)}: the page did not come — ${out.error}.`, 7000);
    }
  } else if (out && out.ok) {
    archivist.nudge(novelId);
  }
  drawComposer();
  return out;
}
/* "Chapter Two", or the book's title and chapter when it is another book */
function chapterNameOf(novelId, chapterId) {
  const n = store.peek('novel', novelId);
  const c = store.peek('chapter', chapterId);
  if (!n || !c) return 'The page you asked for';
  const label = chapterLabel(n, c, { withName: false });
  return novelId === S.novelId ? label : `${n.meta && n.meta.title ? n.meta.title : 'Another book'}, ${label}`;
}

function sentence(s) {
  const t = String(s || '').trim();
  if (!t) return 'The model sent back nothing.';
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?)]$/.test(t) ? '' : '.');
}

async function onWrite() {
  if (busy()) { writer.stop(S.novelId); return; }
  if (S.sel) { onRewriteSelection(); return; }
  const n = novel();
  const direction = ui.direction.value.trim();
  const after = S.insertAfter || null;
  S.insertAfter = null;
  if (!after) await toNextIfEnded();
  const out = await run(() => writer.writeNext({ novelId: S.novelId, chapterId: S.chapterId, direction, length: (n.prefs && n.prefs.length) || 'scene', after }));
  if (out && out.ok) {
    if (ui.direction.value.trim() === direction) { ui.direction.value = ''; ui.direction.dispatchEvent(new Event('input')); }
  }
}

/* SUPER AUTOMATIC: the next page of a chapter the writer ended — his premise's or his own words — goes in the next
 * chapter, opened first so it is written where he reads it (writer.js chapterAfterClose) */
async function toNextIfEnded() {
  const next = await writer.chapterAfterClose(S.novelId, S.chapterId);
  if (next && next !== S.chapterId) await openThen(next);
}

async function onMine() {
  const text = ui.direction.value;
  if (!text.trim()) { toast('Write your words in the box first.'); ui.direction.focus(); return; }
  const after = S.insertAfter || null;
  S.insertAfter = null;
  if (!after) await toNextIfEnded();
  const id = writer.addMine({ novelId: S.novelId, chapterId: S.chapterId, text, after });
  if (id) {
    ui.direction.value = '';
    ui.direction.dispatchEvent(new Event('input'));
    S.selected = id;
    drawPage();
    if (!after) toBottomSoon(null, true);
    archivist.nudge(S.novelId);
  }
}

/* -------------------------------------------------------- selection */

function onSelection() {
  if (!S.chapterId || !ui || busy()) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const base = node.nodeType === 1 ? node : node.parentElement;
  /* a tap on the page lets the selection go; typing in the box keeps it */
  if (sel.isCollapsed) {
    if (S.sel && base && ui.passages.contains(base)) { S.sel = null; drawComposer(); }
    return;
  }
  const el = base && base.closest('.passage');
  if (!el || !ui.passages.contains(el)) return;
  const pid = el.getAttribute('data-id');
  const range = selectionIn(el);
  if (!range) return;
  const c = chapter();
  const p = c && c.passages.find((x) => x.id === pid);
  const v = p && picked(p);
  if (!v) return;
  S.sel = { passageId: pid, start: range.start, end: range.end, text: v.text.slice(range.start, range.end) };
  drawComposer();
}

/* the box says what Write will do, when it is something other than the next passage */
function drawSelBar() {
  const short = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 70 ? x.slice(0, 70) + '…' : x; };
  if (S.sel) {
    ui.selBar.hidden = false;
    ui.selWhat.textContent = `Rewrite “${short(S.sel.text)}”`;
    return;
  }
  const c = chapter();
  const p = S.insertAfter && c ? c.passages.find((x) => x.id === S.insertAfter) : null;
  if (S.insertAfter && !p) S.insertAfter = null;
  if (p) {
    ui.selBar.hidden = false;
    ui.selWhat.textContent = p.by === 'break' ? 'The next passage goes after the scene break' : `The next passage goes after “${short((picked(p) || {}).text)}”`;
    return;
  }
  ui.selBar.hidden = true;
}

async function onRewriteSelection() {
  const s = S.sel;
  if (!s || busy()) return;
  const note = ui.direction.value.trim();
  S.sel = null;
  window.getSelection().removeAllRanges();
  drawSelBar();
  S.selected = s.passageId;
  const out = await run(() => writer.rewriteSelection({ novelId: S.novelId, chapterId: S.chapterId, passageId: s.passageId, start: s.start, end: s.end, note }));
  if (out && out.ok && note && ui.direction.value.trim() === note) { ui.direction.value = ''; ui.direction.dispatchEvent(new Event('input')); }
}

/* --------------------------------------------------------- live words */

/* The words arrive many times a second; the page paints them at most once a
 * frame (and less often once a paint costs more — live.js), and only the
 * paragraph they land on is drawn again. */
const pending = new Map();
const livePaint = paced(flushLive);
function onLive(ev) {
  if (ev.novelId !== S.novelId) return;
  /* written off the page (what the app does by itself): nothing painted until it is done, then the page as it is */
  if (ev.hidden && !ev.done) return;
  if (ev.done) {
    S.live.delete(ev.passageId);
    pending.delete(ev.passageId);
    if (ev.chapterId === S.chapterId) {
      drawPage();
      /* the finished page, drawn whole: still with him if he was following it
       * (a page the app wrote by itself never moves his) */
      if (!ev.auto) toBottomSoon(ev.passageId);
    }
    if (S.followId === ev.passageId) S.followId = null;
    return;
  }
  S.live.set(ev.passageId, { text: ev.text, thinking: ev.thinking });
  if (ev.chapterId !== S.chapterId) return;
  /* the app's own lift is painted where it stands; the page stays where he has it */
  if (ev.auto) { pending.set(ev.passageId, ev); livePaint.ask(); return; }
  S.followId = ev.passageId;
  /* what is being written is what is shown with its controls */
  if (S.selected !== ev.passageId && !S.editing) { S.selected = ev.passageId; S.rewriting = null; pending.set(ev.passageId, ev); drawSoon(); return; }
  pending.set(ev.passageId, ev);
  livePaint.ask();
}
function flushLive() {
  if (!pending.size) return;
  const tint = ((store.peek('house', 'house') || {}).look || {}).tint !== 'off';
  const names = pageNames(S.novelId);
  for (const [pid, ev] of pending) {
    const el = S.els.get(pid);
    if (!el) { drawPage(); break; }
    if (!el.classList.contains('streaming')) el.classList.add('streaming');
    let box = el.querySelector(':scope > .thinkbox');
    if (ev.thinking && !box) { box = thinkBox(pid, ev.thinking, !ev.text); el.prepend(box); }
    else if (box) updateThinkBox(box, ev.thinking, { live: !ev.text });
    const prose = el.querySelector(':scope > .prose');
    if (prose && ev.text) growProse(prose, ev.text, { tint, names });
  }
  const his = [...pending.values()].some((ev) => !ev.auto);
  pending.clear();
  if (his && F.follow()) SC.self = Date.now();
  placeScrollerSoon();
}

/* ------------------------------------------------------------ the scroller */
/* A slim thumb in the page's right gutter: dragged, it moves through the
 * chapter quickly — the phone's own scrollbar can't be held. Which passage is
 * under the eye ("Passage N of M", Cozy Tavern's "page N of M") is said in
 * the bar above the page, where no word of the story is, and beside the thumb
 * only while he holds it (Cozy Tavern M675). */
const SC = { bar: null, thumb: null, tip: null, where: null, drag: null, idle: 0, frame: 0, self: 0, said: '', numbered: [], geometry: null };
function initScroller() {
  SC.bar = document.getElementById('scroller');
  if (!SC.bar) return;
  SC.thumb = SC.bar.querySelector('.thumb');
  SC.tip = SC.bar.querySelector('.tip');
  SC.where = document.getElementById('whereNow');
  const ratioAt = (y) => {
    const r = SC.bar.getBoundingClientRect();
    return clamp((y - r.top - SC.drag.offset) / Math.max(1, r.height - SC.thumb.offsetHeight), 0, 1);
  };
  SC.thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { SC.thumb.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    SC.drag = { offset: e.clientY - SC.thumb.getBoundingClientRect().top };
    SC.bar.classList.add('drag', 'on');
    SC.tip.style.transform = SC.thumb.style.transform;
  });
  SC.thumb.addEventListener('pointermove', (e) => {
    if (!SC.drag) return;
    ui.wrap.scrollTop = ratioAt(e.clientY) * Math.max(0, ui.wrap.scrollHeight - ui.wrap.clientHeight);
    placeScroller();
  });
  const done = () => { if (!SC.drag) return; SC.drag = null; SC.bar.classList.remove('drag'); wake(); };
  SC.thumb.addEventListener('pointerup', done);
  SC.thumb.addEventListener('pointercancel', done);
  SC.thumb.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1, Home: -1e9, End: 1e9 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    toPassage(step);
  });
  window.addEventListener('resize', placeScrollerSoon);
  if (typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(() => {
      SC.geometry = null;
      placeScrollerSoon();
    });
    watch.observe(ui.passages);
    /* (and the page's own height: the box grows with his words or the row that says what he selected, the page under
     * it shortens, and the thumb is placed on the shorter track — through 2.12.35 it stayed where it was, below the
     * track's end and over Suggestions: 2.12.36) */
    watch.observe(ui.wrap);
  }
}
function placeScrollerSoon() { if (SC.bar && !SC.frame) SC.frame = requestAnimationFrame(() => { SC.frame = 0; placeScroller(); }); }
/* the numbered passages on the page, in order, with their numbers */
function numberedEls() { return SC.numbered; }
/* Like Tavern's page mark, measure passage positions when layout changes,
 * not on every frame of a fling. Scrolling itself only searches numbers. */
function passageTops(list) {
  const height = ui.wrap.scrollHeight, width = ui.wrap.clientWidth, viewHeight = ui.wrap.clientHeight;
  const previous = SC.geometry;
  if (previous?.list === list && previous.height === height && previous.width === width && previous.viewHeight === viewHeight) return previous.tops;
  const origin = ui.wrap.getBoundingClientRect().top - ui.wrap.scrollTop;
  const tops = list.map(({ el }) => el.getBoundingClientRect().top - origin);
  SC.geometry = { list, height, width, viewHeight, tops };
  return tops;
}
/* the passage under the eye: the last one that starts above a quarter of the
 * way down. (Cozy Tavern slides its line to the bottom near the end, M468, so
 * a short last passage is named there; here the page keeps 40–45% of the
 * screen as room under the last passage, which brings it up past the line at
 * the end — measured, and held by the walk.) */
function passageUnderEye(list) {
  if (!list.length) return null;
  const tops = passageTops(list);
  const eye = ui.wrap.scrollTop + ui.wrap.clientHeight * 0.25;
  let lo = 0, hi = list.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= eye) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
function placeScroller() {
  if (!SC.bar || !ui) return;
  const list = numberedEls();
  const max = ui.wrap.scrollHeight - ui.wrap.clientHeight;
  const show = list.length > 1 && max > ui.wrap.clientHeight * 0.5;
  SC.bar.hidden = !show;
  if (!show) { if (SC.said) { SC.said = ''; if (SC.where) SC.where.textContent = ''; } return; }
  const i = passageUnderEye(list);
  const n = list[i].n;
  const total = list[list.length - 1].n;
  const top = Math.round((max > 0 ? ui.wrap.scrollTop / max : 0) * Math.max(0, SC.bar.clientHeight - SC.thumb.offsetHeight));
  const move = `translateY(${top}px)`;
  if (SC.thumb.style.transform !== move) SC.thumb.style.transform = move;
  /* the tip shows only while he drags the thumb */
  if (SC.drag && SC.tip.style.transform !== move) SC.tip.style.transform = move;
  /* touched only when they change: this runs every frame while the page streams */
  const say = `Passage ${n} of ${total}`;
  if (SC.said === say) return;
  SC.said = say;
  /* said where no word of the story is: the bar above the page (Cozy Tavern M675) */
  if (SC.where) SC.where.textContent = ` · ${say}`;
  SC.thumb.setAttribute('aria-valuemax', String(total));
  SC.thumb.setAttribute('aria-valuenow', String(n));
  SC.thumb.setAttribute('aria-valuetext', say);
  SC.tip.textContent = say;
}
/* shown in full while the page moves, a little after */
function wake() {
  if (!SC.bar) return;
  SC.bar.classList.add('on');
  clearTimeout(SC.idle);
  SC.idle = setTimeout(() => { if (!SC.drag) SC.bar.classList.remove('on'); }, 1500);
}
/* the keyboard on the thumb: a passage at a time */
function toPassage(step) {
  const list = numberedEls();
  if (!list.length) return;
  const i = clamp((passageUnderEye(list) || 0) + step, 0, list.length - 1);
  ui.wrap.scrollTop += list[i].el.getBoundingClientRect().top - ui.wrap.getBoundingClientRect().top - 12;
  placeScroller();
  wake();
}

/* ------------------------------------------------------------ scrolling */

/* following and not following is the follow law's (live.js); this keeps the
 * scroller and his place */
function onScroll() {
  placeScrollerSoon();
  if (Date.now() - (SC.self || 0) > 200) wake();
  /* written only when it changes: an attribute set on every frame of a fling invalidates the page's styles each time */
  if (!busy() && !ui.followBtn.hidden) ui.followBtn.hidden = true;
  rememberScroll();
}
/* where the page stands when it is with the newest words: the end of the
 * passage being written (or the last one) a little past the middle */
function tailTop(pid) {
  const el = (pid && S.els.get(pid)) || ui.passages.lastElementChild;
  if (!el) return 0;
  return el.getBoundingClientRect().bottom - ui.wrap.getBoundingClientRect().top + ui.wrap.scrollTop - ui.wrap.clientHeight * 0.55;
}
/* the page moved by the app (his place kept, a jump to the words): the
 * scroller stays quiet and the follow law knows it was not his hand */
function setTop(y) { SC.self = Date.now(); F.jump(y); }
/* down to the newest words — never up */
function toBottom(pid) {
  const max = ui.wrap.scrollHeight - ui.wrap.clientHeight;
  const target = Math.min(max, tailTop(pid));
  if (target > ui.wrap.scrollTop + 1) setTop(target);
}
/* after the page is drawn: when following (and no finger on it), or always (force) */
function toBottomSoon(pid = null, force = false) {
  requestAnimationFrame(() => requestAnimationFrame(() => { if (force || (F.on && !F.hand)) toBottom(pid); }));
}

const rememberScroll = debounce(() => {
  try { sessionStorage.setItem(`cozynovel.scroll.${S.chapterId}`, String(ui.wrap.scrollTop)); } catch (_) { /* fine */ }
}, 300);
function restoreScroll() {
  let y = null;
  try { y = sessionStorage.getItem(`cozynovel.scroll.${S.chapterId}`); } catch (_) { y = null; }
  requestAnimationFrame(() => {
    if (y !== null) {
      setTop(Number(y) || 0);
      /* back where he was reading, above the words being written: he stays there */
      if (busy() && !F.atTail()) F.stop();
    } else if (busy()) toBottom(S.followId);
    else setTop(0);
  });
}

/* --------------------------------------------------------------- draft */

/* The box is kept for its book: the book and the words are taken when he
 * types, so a save that lands after he has moved to another book still goes
 * to the book the words were typed for. */
let draftDue = null;     /* {id, text} not yet kept */
const saveDraftSoon = debounce(async () => {
  const due = draftDue;
  draftDue = null;
  if (!due || !due.id) return;
  const { id, text } = due;
  try {
    let d = store.peek('draft', id);
    if (d === undefined) d = await store.open('draft', id);
    if (!d) { await store.create('draft', id, { id, novelId: id, direction: text }); return; }
    if ((d.direction || '') === text) return;
    store.change('draft', id, (x) => { x.direction = text; }, { delay: 200 });
  } catch (_) { /* the words are still in the box */ }
}, 600);
function saveDraft() {
  if (!S.novelId) return;
  draftDue = { id: S.novelId, text: ui.direction.value };
  saveDraftSoon();
}
/* the box's last words, not yet handed to the store (the moment after he types): an update waits for them */
export function draftWaiting() { return Boolean(draftDue); }
/* the page going away: they are handed over now, to go with the rest */
export function draftNow() { if (draftDue) saveDraftSoon.now(); }

/* A branch must include the last keystroke, even before the typing pause. */
export async function saveDeskForBranch(novelId) {
  if (S.novelId !== novelId || !ui) return;
  keepOpenEdit();
  const direction = ui.direction.value;
  saveDraftSoon.cancel();
  draftDue = null;
  let d = store.peek('draft', novelId);
  if (d === undefined) d = await store.open('draft', novelId);
  if (!d) await store.create('draft', novelId, { id: novelId, novelId, direction });
  else store.change('draft', novelId, x => { x.direction = direction; }, { now: true });
  await store.flush('draft', novelId);
}

async function loadDraft() {
  const id = S.novelId;
  ui.direction.value = '';
  fitDirection();
  try {
    const d = await store.open('draft', id);
    /* still this book, and he has not started typing meanwhile */
    if (S.novelId === id && d && d.direction && !ui.direction.value) { ui.direction.value = d.direction; fitDirection(); drawWriteLabel(); }
  } catch (_) { /* nothing kept */ }
}

export function deskState() { return S; }
export function focusComposer() { ui.direction.focus(); }
/* the partner's idea into the box — never over his own words without asking */
export async function useAsDirection(text) {
  const idea = String(text || '').trim();
  const mine = ui.direction.value.trim();
  let value = idea;
  if (mine && mine !== idea) {
    const how = await askChoice('The box has words in it', 'Your words are in the box already. What should happen to them?', [
      { label: 'Put this after them', value: 'add', primary: true },
      { label: 'Replace them', value: 'replace' },
      { label: 'Not now', value: null, quiet: true },
    ]);
    if (!how) return false;
    value = how === 'add' ? `${mine}\n\n${idea}` : idea;
  }
  ui.direction.value = value;
  ui.direction.dispatchEvent(new Event('input'));
  ui.direction.focus();
  return true;
}
export { drawComposer };
