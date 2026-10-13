/* Cozy Novel — js/ui/desk.js — THE PAGE: the chapter as a book page, the
 * passages on it with their versions, and the box at the bottom where he says
 * what happens next. */

import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as archivist from '../novel/archivist.js';
import { h, icon, toast, undoToast, menu, autoGrow, copyText, confirmIt, askChoice, onBack } from './dom.js';
import { drawProse, selectionIn } from './prose.js';
import { picked, chapterSteps, novelSteps, newChapter, chapterWords, chapterLabel, LENGTHS, newPassage } from '../novel/shape.js';
import { numberWords, plural, debounce, countWords, timeAgo } from '../util.js';
import { showSent } from './sent.js';

const S = {
  novelId: null, chapterId: null,
  selected: null,        /* the passage whose controls show */
  editing: null,         /* the passage being edited */
  rewriting: null,       /* the passage with the rewrite box open */
  sel: null,             /* {passageId, start, end, text} — words selected for rewriting */
  error: null,           /* the last page that did not come, said once */
  follow: true,
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
  ui.followBtn.addEventListener('click', () => { S.follow = true; ui.followBtn.hidden = true; toBottom(); });
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
    if (!busy()) { ui.followBtn.hidden = true; S.follow = true; }
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
  S.selected = null; S.editing = null; S.rewriting = null; S.sel = null; S.error = null; S.follow = true; S.insertAfter = null;
  S.offs.push(store.subscribe('chapter', chapterId, (data, why) => {
    if (why === 'deleted') { hooks.chapterGone(); return; }
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
  ui.passages.textContent = '';
  S.els.clear();
  const list = c.passages || [];
  if (!S.selected || !list.some((p) => p.id === S.selected)) S.selected = defaultSelected(list);
  for (const p of list) {
    const el = drawPassage(p, { tint });
    S.els.set(p.id, el);
    ui.passages.append(el);
  }
  drawEnd();
  drawHead();
  if (kept.edit !== null) {
    const box = ui.passages.querySelector('.editbox');
    if (box) { box.value = kept.edit; box.dispatchEvent(new Event('input')); if (kept.editFocus) { box.focus({ preventScroll: true }); try { box.setSelectionRange(kept.editSel[0], kept.editSel[1]); } catch (_) { /* fine */ } } }
  }
  if (kept.note !== null) { const inp = ui.passages.querySelector('.rewriterow input'); if (inp) inp.value = kept.note; }
  if (keepScroll) ui.wrap.scrollTop = keep;
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
  const open = S.thinkOpen.has(pid);
  const box = h('div.thinkbox' + (open ? '.open' : '') + (liveNow ? '.live' : ''));
  const words = h('div.words', thinking);
  const copy = h('button.copy', { onclick: async () => toast((await copyText(words.textContent || '')) ? 'The thinking is copied.' : 'It could not be copied.') }, 'Copy it');
  box.append(h('button', { 'aria-expanded': String(open || liveNow), onclick: (e) => {
    if (S.thinkOpen.has(pid)) S.thinkOpen.delete(pid); else S.thinkOpen.add(pid);
    box.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(box.classList.contains('open')));
  } }, h('span.chev', icon('chev', 14)), liveNow ? 'Thinking…' : `The thinking (${plural(countWords(thinking), 'word')})`), words, h('div.thinkcopy', copy));
  if (liveNow) requestAnimationFrame(() => { words.scrollTop = words.scrollHeight; });
  return box;
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
  /* what to know about this version, in a line */
  const bits = [];
  if (v.how === 'mine' || v.how === 'imported') bits.push(v.how === 'imported' ? 'brought in' : 'your words');
  else if (v.how === 'edit') bits.push('edited by you');
  else if (v.conn) bits.push(v.conn);
  if (v.words || v.text) bits.push(plural(v.words || countWords(v.text), 'word'));
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
  S.follow = true;
  drawEnd();
  const out = await fn();
  if (out && !out.ok && !out.stopped && out.error) {
    S.error = { words: sentence(out.error), needsConnection: out.needsConnection };
    drawPage();
    if (!S.els.size) drawEnd();
    toBottomSoon();
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
    S.follow = !after;
    drawPage();
    if (!after) toBottomSoon();
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

let liveFrame = 0;
const pending = new Map();
function onLive(ev) {
  if (ev.novelId !== S.novelId) return;
  if (ev.done) {
    S.live.delete(ev.passageId);
    pending.delete(ev.passageId);
    if (ev.chapterId === S.chapterId) { drawPage(); if (S.follow) toBottomSoon(); }
    return;
  }
  S.live.set(ev.passageId, { text: ev.text, thinking: ev.thinking });
  if (ev.chapterId !== S.chapterId) return;
  /* what is being written is what is shown with its controls */
  if (S.selected !== ev.passageId && !S.editing) { S.selected = ev.passageId; S.rewriting = null; pending.set(ev.passageId, ev); drawSoon(); return; }
  pending.set(ev.passageId, ev);
  if (!liveFrame) liveFrame = requestAnimationFrame(flushLive);
}
function flushLive() {
  liveFrame = 0;
  const look = (store.peek('house', 'house') || {}).look || {};
  for (const [pid, ev] of pending) {
    const el = S.els.get(pid);
    if (!el) { drawPage(); break; }
    el.classList.add('streaming');
    let box = el.querySelector('.thinkbox');
    if (ev.thinking && !box) { box = thinkBox(pid, ev.thinking, !ev.text); el.prepend(box); }
    else if (box) {
      box.querySelector('.words').textContent = ev.thinking;
      box.classList.toggle('live', !ev.text);
      if (!ev.text) box.querySelector('.words').scrollTop = 1e9;
      const label = box.querySelector('button');
      if (label && ev.text && label.lastChild && label.lastChild.nodeType === 3 && /Thinking/.test(label.lastChild.textContent)) label.lastChild.textContent = `The thinking (${plural(countWords(ev.thinking), 'word')})`;
    }
    const prose = el.querySelector('.prose');
    if (prose && ev.text) drawProse(prose, ev.text, { tint: look.tint !== 'off' });
  }
  pending.clear();
  if (S.follow) toBottom();
}

/* ------------------------------------------------------------ scrolling */

function onScroll() {
  const near = ui.wrap.scrollHeight - ui.wrap.scrollTop - ui.wrap.clientHeight < 220;
  if (busy()) {
    if (!near && S.follow) { S.follow = false; ui.followBtn.hidden = false; }
    if (near && !S.follow) { S.follow = true; ui.followBtn.hidden = true; }
  } else ui.followBtn.hidden = true;
  rememberScroll();
}
function toBottom() {
  const p = ui.passages.lastElementChild;
  if (!p) return;
  const target = p.offsetTop + p.offsetHeight - ui.wrap.clientHeight * 0.55;
  if (target > ui.wrap.scrollTop) ui.wrap.scrollTop = target;
}
function toBottomSoon() { requestAnimationFrame(() => requestAnimationFrame(toBottom)); }

const rememberScroll = debounce(() => {
  try { sessionStorage.setItem(`cozynovel.scroll.${S.chapterId}`, String(ui.wrap.scrollTop)); } catch (_) { /* fine */ }
}, 300);
function restoreScroll() {
  let y = null;
  try { y = sessionStorage.getItem(`cozynovel.scroll.${S.chapterId}`); } catch (_) { y = null; }
  requestAnimationFrame(() => {
    if (y !== null) ui.wrap.scrollTop = Number(y) || 0;
    else if (busy()) toBottom();
    else ui.wrap.scrollTop = 0;
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
