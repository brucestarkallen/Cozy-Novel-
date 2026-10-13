/* Cozy Novel — js/ui/desk.js — THE PAGE: the chapter as a book page, the
 * passages on it with their versions, and the box at the bottom where he says
 * what happens next. */

import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as archivist from '../novel/archivist.js';
import { h, icon, toast, undoToast, menu, autoGrow, copyText, confirmIt, askChoice, onBack } from './dom.js';
import { drawProse, growProse, selectionIn } from './prose.js';
import { picked, chapterSteps, novelSteps, newChapter, chapterWords, chapterLabel, LENGTHS, newPassage, passageNumbers } from '../novel/shape.js';
import { numberWords, plural, debounce, countWords, timeAgo, clamp } from '../util.js';
import { showSent } from './sent.js';
import { thinkBox as makeThinkBox, updateThinkBox } from './think.js';
import { paced, follower } from './live.js';

const S = {
  novelId: null, chapterId: null,
  selected: null,        /* the passage whose controls show */
  editing: null,         /* the passage being edited */
  rewriting: null,       /* the passage with the rewrite box open */
  sel: null,             /* {passageId, start, end, text} — words selected for rewriting */
  error: null,           /* the last page that did not come, said once */
  followId: null,        /* the passage being written here, whose newest words the page follows */
  drawn: null,           /* what the page was last drawn from (shownSig) */
  els: new Map(),        /* passageId -> element */
  offs: [],
  live: new Map(),       /* passageId -> {text, thinking} while being written */
  thinkOpen: new Set(),
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
  ui.direction.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onWrite(); } });
  ui.writeBtn.addEventListener('click', onWrite);
  ui.mineBtn.addEventListener('click', onMine);
  ui.lengthBtn.addEventListener('click', () => lengthMenu());
  ui.writerBtn.addEventListener('click', () => hooks.writerMenu(ui.writerBtn));
  ui.wrap.addEventListener('scroll', onScroll, { passive: true });
  F = follower(ui.wrap, { tail: () => tailTop(S.followId), onChange: (on) => { ui.followBtn.hidden = on || !busy(); } });
  initScroller();
  ui.followBtn.addEventListener('click', () => { F.start(); ui.followBtn.hidden = true; toBottom(S.followId); });
  ui.chapname.addEventListener('focus', () => { ui.chapname.dataset.was = ui.chapname.textContent; });
  ui.chapname.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ui.chapname.blur(); } });
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
  if (changingBook) saveDraftSoon.now();
  S.novelId = novelId;
  S.chapterId = chapterId;
  S.selected = null; S.editing = null; S.rewriting = null; S.sel = null; S.error = null; S.insertAfter = null; S.followId = null;
  F.start();
  S.offs.push(store.subscribe('chapter', chapterId, (data, why) => {
    if (why === 'deleted') { hooks.chapterGone(); return; }
    /* the writer here keeping what it has streamed so far: the page shows
     * those words already, as they come — it is not drawn again for them */
    if (S.drawn !== null && S.drawn === shownSig(chapter())) return;
    drawSoon();
  }));
  S.offs.push(store.subscribe('novel', novelId, () => { drawHead(); drawComposer(); }));
  if (changingBook) loadDraft();
  drawHead();
  drawPage({ keepScroll: false });
  drawComposer();
  restoreScroll();
}

function novel() { return store.peek('novel', S.novelId); }
function chapter() { return store.peek('chapter', S.chapterId); }

/* ------------------------------------------------------------ the head */

export function drawHead() {
  const n = novel();
  const c = chapter();
  if (!n || !c) return;
  const num = n.order.indexOf(c.id) + 1;
  ui.chapnum.textContent = `Chapter ${numberWords(num)}`;
  if (document.activeElement !== ui.chapname) ui.chapname.textContent = c.name || '';
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

/* what the page shows of a chapter, as one string: a version this window is
 * writing shows its words from the stream, so the writer's own checkpoints
 * of them (every few seconds, and its heartbeat) leave it the same */
const writingHere = (v) => v.streaming && v.tab === store.CLIENT;
function shownSig(c) {
  if (!c) return '';
  return JSON.stringify([c.name || '', (c.passages || []).map((p) => ((p.versions || []).some(writingHere)
    ? { ...p, versions: p.versions.map((v) => (writingHere(v) ? { ...v, text: 0, thinking: 0, beat: 0 } : v)) }
    : p))]);
}

export function drawPage({ keepScroll = true } = {}) {
  if (drawFrame) { cancelAnimationFrame(drawFrame); drawFrame = 0; }
  const c = chapter();
  const n = novel();
  if (!c || !n) return;
  const look = (store.peek('house', 'house') || {}).look || {};
  const tint = look.tint !== 'off';
  const keep = keepScroll ? ui.wrap.scrollTop : 0;
  /* what he is typing on the page survives the page being drawn again */
  const editing = ui.passages.querySelector('.editbox');
  const rewriting = ui.passages.querySelector('.rewriterow input');
  const kept = { edit: editing ? editing.value : null, editFocus: editing && document.activeElement === editing, editSel: editing ? [editing.selectionStart, editing.selectionEnd] : null,
    note: rewriting ? rewriting.value : null };
  const list = c.passages || [];
  if (!S.selected || !list.some((p) => p.id === S.selected)) S.selected = defaultSelected(list);
  /* Only the passages that changed are drawn again (Cozy Tavern draws only
   * the message that changed): the rest stay on the page exactly as they
   * are, so a passage finishing, or a tap choosing another, costs one or two
   * passages however long the chapter — never the whole chapter. A passage
   * stays only while it is the same record (a newer copy from the phone is
   * drawn afresh) drawn the same way (drawnKey). */
  const nums = passageNumbers(c);
  const working = busy();
  const was = S.els;
  S.els = new Map();
  const staying = new Set();
  const keys = new Map();
  for (const p of list) {
    const key = drawnKey(p, { tint, nums, working });
    keys.set(p.id, key);
    const old = was.get(p.id);
    const as = old && drawnAs.get(old);
    if (as && as.p === p && as.key === key && old.parentNode === ui.passages) staying.add(old);
  }
  for (const node of [...ui.passages.childNodes]) if (!staying.has(node)) node.remove();
  let at = ui.passages.firstChild;
  for (const p of list) {
    const old = was.get(p.id);
    const el = old && staying.has(old) ? old : drawPassage(p, { tint });
    drawnAs.set(el, { p, key: keys.get(p.id) });
    S.els.set(p.id, el);
    if (el === at) at = at.nextSibling;
    else ui.passages.insertBefore(el, at);
  }
  drawEnd();
  drawHead();
  if (kept.edit !== null) {
    const box = ui.passages.querySelector('.editbox');
    if (box) { box.value = kept.edit; box.dispatchEvent(new Event('input')); if (kept.editFocus) { box.focus({ preventScroll: true }); try { box.setSelectionRange(kept.editSel[0], kept.editSel[1]); } catch (_) { /* fine */ } } }
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
const drawnAs = new WeakMap();   /* element -> { p, key } */
function drawnKey(p, { tint, nums, working }) {
  const sel = S.selected === p.id;
  const live = S.live.get(p.id);
  const v = sel ? picked(p) || {} : null;
  return JSON.stringify([p, live ? [live.text, live.thinking] : 0, tint, sel, S.editing === p.id, S.rewriting === p.id, S.thinkOpen.has(p.id),
    sel ? [working, nums.get(p.id) || 0, v.done || v.at ? timeAgo(v.done || v.at) : ''] : 0]);
}

function defaultSelected(list) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].by !== 'break') return list[i].id;
  return null;
}

function drawPassage(p, { tint }) {
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
    ta.value = v.text || '';
    el.append(ta, h('div.editrow',
      h('button.btn.primary.small', { onclick: () => finishEdit(p.id, ta.value) }, 'Save'),
      h('button.btn.quiet.small', { onclick: () => closeEdit() }, 'Cancel'),
      h('span.say', { style: { margin: 0, color: 'var(--ink-soft)' } }, 'Your edit is kept as a new version — the words before it stay one arrow away.')));
    autoGrow(ta, 0.7);
    /* the keyboard goes to it once, when it opens — never again on a redraw */
    if (S.focusNext === 'edit') { S.focusNext = null; setTimeout(() => ta.focus(), 30); }
    return el;
  }
  const prose = h('div.prose');
  drawProse(prose, text, { tint });
  if (!text && (v.streaming || live)) prose.append(h('p', { style: { color: 'var(--ink-faint)', fontStyle: 'italic' } }, thinking ? 'Thinking…' : 'Writing…'));
  el.append(prose);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.pctl, .thinkbox, .rewriterow, button, textarea, input')) return;
    if (window.getSelection && !window.getSelection().isCollapsed) return;
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

function busy() { return writer.busy(S.novelId); }

function controls(p) {
  const c = chapter();
  const v = picked(p) || {};
  const row = h('div.pctl');
  const live = S.live.has(p.id) || v.streaming;
  const working = busy();
  if (p.versions.length > 1) {
    const i = p.versions.indexOf(v);
    row.append(h('span.ver',
      h('button', { 'aria-label': 'The version before', disabled: working || i <= 0, onclick: () => pickVersion(p, i - 1) }, icon('left', 16)),
      h('span', `${i + 1} / ${p.versions.length}`),
      h('button', { 'aria-label': 'The version after', disabled: working || i >= p.versions.length - 1, onclick: () => pickVersion(p, i + 1) }, icon('right', 16))));
  }
  if (live) {
    row.append(h('span', { style: { padding: '0 8px', color: 'var(--ink-faint)' } }, 'Being written…'));
    return row;
  }
  /* a rewrite of selected words that stopped partway is written again, never carried on from the passage's end */
  const carry = v.cut && v.how !== 'selection';
  if (carry) row.append(h('button.go', { disabled: working, onclick: () => run(() => writer.goOn({ novelId: S.novelId, chapterId: c.id, passageId: p.id })) }, 'Go on'));
  if (writer.takeOf(p)) row.append(h('button', { disabled: working, onclick: () => run(() => writer.anotherTake({ novelId: S.novelId, chapterId: c.id, passageId: p.id })) }, 'Another take'));
  row.append(h('button', { disabled: working, onclick: () => { S.rewriting = S.rewriting === p.id ? null : p.id; S.focusNext = 'rewrite'; drawPage(); } }, 'Rewrite…'));
  row.append(h('button', { disabled: working, onclick: () => openEdit(p.id) }, 'Edit'));
  row.append(h('button', { 'aria-label': 'More for this passage', onclick: (e) => passageMenu(e.currentTarget, p) }, icon('more', 18)));
  /* what to know about this version, in a line — first, its number on the page */
  const bits = [];
  const num = passageNumbers(c).get(p.id);
  if (num) bits.push(`Passage ${num}`);
  if (v.how === 'mine' || v.how === 'imported') bits.push(v.how === 'imported' ? 'brought in' : 'your words');
  else if (v.how === 'edit') bits.push('edited by you');
  else if (v.how === 'partner') bits.push(v.why ? `changed by your partner: “${v.why.slice(0, 80)}”` : 'changed by your partner');
  if (v.words || v.text) bits.push(plural(v.words || countWords(v.text), 'word'));
  /* the request that wrote it, counted in full: the provider's own count, or the app's (about) */
  if (Number.isFinite(v.tokensIn)) bits.push(`${v.tokensCounted ? '' : 'about '}${v.tokensIn.toLocaleString()} tokens sent`);
  if (v.ask && v.ask.note && (v.how === 'rewrite' || v.how === 'selection')) bits.push(`“${v.ask.note.slice(0, 60)}”`);
  if (v.done || v.at) bits.push(timeAgo(v.done || v.at));
  if (bits.length) row.append(h('div.note', bits.join(' · ')));
  if (v.cut) row.append(h('div.note.warn', `It stopped partway${v.cutWhy ? ` (${v.cutWhy})` : ''}. ${carry ? 'Go on carries it on from the last word.' : 'Another take writes it again.'}`));
  if (v.notes && v.notes.length) row.append(h('div.note', v.notes.join(' ')));
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
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  if (S.focusNext === 'rewrite') { S.focusNext = null; setTimeout(() => inp.focus(), 30); }
  return h('div.rewriterow', inp, h('button.btn.primary.small', { onclick: go }, 'Rewrite'), h('button.btn.quiet.small', { onclick: () => { S.rewriting = null; drawPage(); } }, 'Cancel'));
}

function passageMenu(anchor, p) {
  const c = chapter();
  const v = picked(p) || {};
  const i = c.passages.indexOf(p);
  menu(anchor, [
    v.sent ? { label: 'What the writer was sent', run: () => showSent(S.novelId, v.sent) } : null,
    { label: 'Copy the words', run: async () => { toast((await copyText(v.text || '')) ? 'Copied.' : 'It could not be copied.'); } },
    '-',
    { label: 'Write from here (a passage after this one)', disabled: busy(), run: () => { S.insertAfter = p.id; S.sel = null; drawComposer(); ui.direction.focus(); } },
    { label: 'Add a scene break after this', run: () => { writer.addBreak({ chapterId: c.id, after: p.id }); } },
    i > 0 ? { label: 'Start a new chapter from here', disabled: busy(), run: () => splitHere(p) } : null,
    '-',
    p.versions.length > 1 ? { label: 'Remove this version', danger: true, run: () => removeVersion(p, v) } : null,
    { label: 'Remove the passage', danger: true, run: () => removePassage(p) },
  ]);
}

function pickVersion(p, i) {
  const v = p.versions[i];
  if (!v) return;
  store.change('chapter', S.chapterId, chapterSteps.pick(p.id, v.id));
  archivist.nudge(S.novelId, 8000);
  drawPage();
}

/* The edit box is open over the page like a sheet: the phone's Back closes
 * it — keeping what he typed, as a new version (the earlier words stay one
 * arrow away), so nothing typed is ever lost to a Back. */
function openEdit(pid) {
  keepOpenEdit();
  S.editing = pid;
  S.focusNext = 'edit';
  S.editBack = onBack(() => { S.editBack = null; keepOpenEdit(true); });
  drawPage();
}
function closeEdit() {
  S.editing = null;
  if (S.editBack) { const r = S.editBack; S.editBack = null; r(); }
  drawPage();
}
function keepOpenEdit(fromBack = false) {
  if (!S.editing) return;
  const box = ui && ui.passages.querySelector('.editbox');
  const pid = S.editing;
  S.editing = null;
  if (!fromBack && S.editBack) { const r = S.editBack; S.editBack = null; r(); }
  if (box) {
    if (!box.value.trim()) toast(EMPTY_EDIT, 6000);
    else if (writer.saveEdit({ novelId: S.novelId, chapterId: S.chapterId, passageId: pid, text: box.value })) { archivist.nudge(S.novelId); toast('Your edit is kept — the earlier words are one arrow away.'); }
  }
  if (fromBack) drawPage();
}
/* a passage emptied in the edit box is not kept empty: taking it out is its own step */
const EMPTY_EDIT = 'An empty passage is not kept, so the words stay as they were. To take the passage out, use ⋯ → Remove the passage.';
function finishEdit(pid, text) {
  const empty = !String(text || '').trim();
  const changed = !empty && writer.saveEdit({ novelId: S.novelId, chapterId: S.chapterId, passageId: pid, text });
  S.editing = null;
  if (S.editBack) { const r = S.editBack; S.editBack = null; r(); }
  drawPage();
  if (empty) toast(EMPTY_EDIT, 6000);
  else if (changed) { archivist.nudge(S.novelId); toast('Saved — the earlier words are one arrow away.'); }
}

function removeVersion(p, v) {
  archivist.retireIfSeen(S.novelId, S.chapterId, p.id, v.id);
  store.change('chapter', S.chapterId, chapterSteps.removeVersion(p.id, v.id), { now: true });
  archivist.nudge(S.novelId);
  writer.recount(S.novelId);
  drawPage();
}

function removePassage(p) {
  const c = chapter();
  const i = c.passages.findIndex((x) => x.id === p.id);
  const after = i > 0 ? c.passages[i - 1].id : '^';
  const copy = JSON.parse(JSON.stringify(p));
  archivist.retireIfSeen(S.novelId, S.chapterId, p.id);
  store.change('chapter', S.chapterId, chapterSteps.removePassage(p.id), { now: true });
  archivist.nudge(S.novelId, 9000);
  writer.recount(S.novelId);
  S.undo = { chapterId: S.chapterId, passage: copy, after };
  drawPage();
  undoToast('The passage is removed.', () => {
    const u = S.undo;
    if (!u) return;
    store.change('chapter', u.chapterId, chapterSteps.addPassage(u.passage, u.after), { now: true });
    S.undo = null;
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
  await store.create('chapter', fresh.id, fresh);
  store.change('novel', S.novelId, novelSteps.addChapter(fresh.id, c.id), { now: true });
  /* the moved passages were read where they stood: the helper is told nothing new */
  archivist.moveSeen(S.novelId, c.id, fresh.id, moving.map((m) => m.id));
  store.change('chapter', c.id, chapterSteps.cutFrom(p.id), { now: true });
  archivist.nudge(S.novelId);
  hooks.goChapter(fresh.id);
}

/* ----------------------------------------------------- the end of the page */

function drawEnd() {
  const c = chapter();
  const n = novel();
  ui.end.textContent = '';
  const list = c.passages || [];
  const hasText = list.some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
  if (!list.length) {
    const first = n.order.indexOf(c.id) === 0;
    ui.end.append(h('p.emptypage', first
      ? 'The first page. Say how the story opens and press Write — or write the opening yourself and press Add as my words.'
      : 'A fresh chapter. Say what happens and press Write, or write it yourself. With the box left empty, Write carries the story on.'));
  }
  if (S.error) {
    ui.end.append(h('div.endcard.error',
      h('b', 'The page did not come. '), S.error.words,
      h('div.row', S.error.needsConnection ? h('button.btn.primary.small', { onclick: () => hooks.openSettings('connections') }, 'Open Connections') : null,
        h('button.btn.small', { onclick: () => { S.error = null; drawEnd(); } }, 'Dismiss'))));
  }
  const at = n.order.indexOf(c.id);
  if (hasText && !busy()) {
    if (at === n.order.length - 1) {
      ui.end.append(h('div.nextchapter', h('button.btn', { disabled: S.making, onclick: () => newChapterAfter(c.id) }, `Start Chapter ${numberWords(at + 2)} `, icon('right', 16))));
    } else {
      const next = store.peek('chapter', n.order[at + 1]);
      const name = next && next.name ? ` — ${next.name.length > 48 ? next.name.slice(0, 48).replace(/\s+\S*$/, '') + '…' : next.name}` : '';
      ui.end.append(h('div.nextchapter', h('button.btn.quiet', { onclick: () => hooks.goChapter(n.order[at + 1]) }, `On to Chapter ${numberWords(at + 2)}${name} `, icon('right', 16))));
    }
  }
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

function drawComposer() {
  const n = novel();
  if (!n) return;
  const working = busy();
  const len = (n.prefs && n.prefs.length) || 'scene';
  ui.lengthBtn.textContent = '';
  ui.lengthBtn.append(h('b', LENGTHS[len] ? LENGTHS[len].label : 'A scene'), icon('down', 14));
  const house = store.peek('house', 'house') || {};
  const w = writer.connFor(house, 'writer');
  ui.writerBtn.textContent = '';
  ui.writerBtn.append(h('b', w ? writer.connName(w) : 'Choose a writer'), icon('down', 14));
  ui.writeBtn.textContent = '';
  /* one button, saying what it will do: Write, Rewrite (words are selected), or Stop */
  if (working) { ui.writeBtn.append(icon('stop', 16), 'Stop'); ui.writeBtn.classList.remove('primary'); }
  else { ui.writeBtn.append(S.sel ? 'Rewrite' : 'Write'); ui.writeBtn.classList.add('primary'); }
  ui.mineBtn.disabled = working || Boolean(S.sel);
  const was = ui.direction.placeholder;
  ui.direction.placeholder = S.sel ? 'How should the selected words change? (optional)'
    : S.insertAfter ? 'What happens in the new passage? (optional)'
      : 'What happens next? (optional)';
  if (ui.direction.placeholder !== was) fitDirection();
  drawSelBar();
}

function lengthMenu() {
  const n = novel();
  const cur = (n.prefs && n.prefs.length) || 'scene';
  menu(ui.lengthBtn, [
    { label: 'How much to write', header: true },
    ...Object.entries(LENGTHS).map(([k, L]) => ({ label: L.label + (L.words[0] ? ` (about ${L.words[0].toLocaleString()}–${L.words[1].toLocaleString()} words)` : ''), checked: k === cur, run: () => { store.change('novel', S.novelId, novelSteps.setPref('length', k)); drawComposer(); } })),
  ]);
}

async function run(fn) {
  S.error = null;
  S.followId = null;
  F.start();
  drawEnd();
  const out = await fn();
  if (out && !out.ok && !out.stopped && out.error) {
    S.error = { words: sentence(out.error), needsConnection: out.needsConnection };
    drawPage();
    if (!S.els.size) drawEnd();
    /* the reason is shown where he will see it */
    toBottomSoon(null, true);
  } else if (out && out.ok) {
    archivist.nudge(S.novelId);
  }
  drawComposer();
  return out;
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
  const out = await run(() => writer.writeNext({ novelId: S.novelId, chapterId: S.chapterId, direction, length: (n.prefs && n.prefs.length) || 'scene', after }));
  if (out && out.ok) {
    if (ui.direction.value.trim() === direction) { ui.direction.value = ''; ui.direction.dispatchEvent(new Event('input')); }
  }
}

function onMine() {
  const text = ui.direction.value;
  if (!text.trim()) { toast('Write your words in the box first.'); ui.direction.focus(); return; }
  const after = S.insertAfter || null;
  S.insertAfter = null;
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
  if (ev.done) {
    S.live.delete(ev.passageId);
    pending.delete(ev.passageId);
    if (ev.chapterId === S.chapterId) {
      drawPage();
      /* the finished page, drawn whole: still with him if he was following it */
      toBottomSoon(ev.passageId);
    }
    if (S.followId === ev.passageId) S.followId = null;
    return;
  }
  S.live.set(ev.passageId, { text: ev.text, thinking: ev.thinking });
  if (ev.chapterId !== S.chapterId) return;
  S.followId = ev.passageId;
  /* what is being written is what is shown with its controls */
  if (S.selected !== ev.passageId && !S.editing) { S.selected = ev.passageId; S.rewriting = null; pending.set(ev.passageId, ev); drawSoon(); return; }
  pending.set(ev.passageId, ev);
  livePaint.ask();
}
function flushLive() {
  if (!pending.size) return;
  const tint = ((store.peek('house', 'house') || {}).look || {}).tint !== 'off';
  for (const [pid, ev] of pending) {
    const el = S.els.get(pid);
    if (!el) { drawPage(); break; }
    if (!el.classList.contains('streaming')) el.classList.add('streaming');
    let box = el.querySelector(':scope > .thinkbox');
    if (ev.thinking && !box) { box = thinkBox(pid, ev.thinking, !ev.text); el.prepend(box); }
    else if (box) updateThinkBox(box, ev.thinking, { live: !ev.text });
    const prose = el.querySelector(':scope > .prose');
    if (prose && ev.text) growProse(prose, ev.text, { tint });
  }
  pending.clear();
  if (F.follow()) SC.self = Date.now();
  placeScrollerSoon();
}

/* ------------------------------------------------------------ the scroller */
/* A thumb at the page's right edge: it says which passage is under the eye
 * (its number on the page) and, dragged, moves through the chapter quickly —
 * the phone's own scrollbar can't be held. While he scrolls or holds it,
 * "Passage N of M" shows beside it (Cozy Tavern's "page N of M"). */
const SC = { bar: null, thumb: null, tip: null, drag: null, idle: 0, frame: 0, self: 0, said: '' };
function initScroller() {
  SC.bar = document.getElementById('scroller');
  if (!SC.bar) return;
  SC.thumb = SC.bar.querySelector('.thumb');
  SC.tip = SC.bar.querySelector('.tip');
  const ratioAt = (y) => {
    const r = SC.bar.getBoundingClientRect();
    return clamp((y - r.top - SC.drag.offset) / Math.max(1, r.height - SC.thumb.offsetHeight), 0, 1);
  };
  SC.thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { SC.thumb.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    SC.drag = { offset: e.clientY - SC.thumb.getBoundingClientRect().top };
    SC.bar.classList.add('drag', 'on');
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
}
function placeScrollerSoon() { if (SC.bar && !SC.frame) SC.frame = requestAnimationFrame(() => { SC.frame = 0; placeScroller(); }); }
/* the numbered passages on the page, in order, with their numbers */
function numberedEls() {
  const c = chapter();
  const nums = c ? passageNumbers(c) : new Map();
  const out = [];
  for (const [pid, el] of S.els) if (nums.has(pid)) out.push({ el, n: nums.get(pid) });
  return out;
}
/* the passage under the eye: the last one that starts above a quarter of the way down */
function passageUnderEye(list) {
  if (!list.length) return null;
  const eye = ui.wrap.getBoundingClientRect().top + ui.wrap.clientHeight * 0.25;
  let lo = 0, hi = list.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].el.getBoundingClientRect().top <= eye) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
function placeScroller() {
  if (!SC.bar || !ui) return;
  const list = numberedEls();
  const max = ui.wrap.scrollHeight - ui.wrap.clientHeight;
  const show = list.length > 1 && max > ui.wrap.clientHeight * 0.5;
  SC.bar.hidden = !show;
  if (!show) return;
  const i = passageUnderEye(list);
  const n = list[i].n;
  const total = list[list.length - 1].n;
  const top = Math.round((max > 0 ? ui.wrap.scrollTop / max : 0) * Math.max(0, SC.bar.clientHeight - SC.thumb.offsetHeight));
  SC.thumb.style.top = `${top}px`;
  SC.tip.style.top = `${top}px`;
  /* touched only when they change: this runs every frame while the page streams */
  const say = `Passage ${n} of ${total}`;
  if (SC.said === say) return;
  SC.said = say;
  SC.thumb.textContent = String(n);
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
  if (!busy()) ui.followBtn.hidden = true;
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

async function loadDraft() {
  const id = S.novelId;
  ui.direction.value = '';
  fitDirection();
  try {
    const d = await store.open('draft', id);
    /* still this book, and he has not started typing meanwhile */
    if (S.novelId === id && d && d.direction && !ui.direction.value) { ui.direction.value = d.direction; fitDirection(); }
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
