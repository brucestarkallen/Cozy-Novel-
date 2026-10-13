/* Cozy Novel — js/ui/checks.js — THE BUBBLE ON THE PAGE and what it holds.
 *
 * Green: every finished passage is checked and nothing needs changing. Blue:
 * the checker is at work (or will be, in a moment). Yellow, with a number:
 * suggestions waiting. Grey: nobody checks (Settings → Who does what). Red:
 * the checker's connection is in trouble. A tap opens Suggestions: each one
 * with what it would change and why — Apply, or Leave it — and Apply all. */

import * as store from '../store.js';
import * as checker from '../novel/checker.js';
import { h, icon, toast, openSheet, confirmIt } from './dom.js';
import { chapterLabel } from '../novel/shape.js';
import { findIn } from '../novel/search.js';
import { plural } from '../util.js';
import * as desk from './desk.js';

let bubble = null;
let hooks = {};
const C = { novelId: null, chapterId: null, offs: [], frame: 0, sheet: null };

const KIND = { grammar: 'Grammar', humanize: 'Humanize', avoid: 'Words to avoid', continuity: 'Continuity' };

export function initChecks(el, appHooks) {
  bubble = el;
  hooks = appHooks;
  bubble.addEventListener('click', () => openSuggestions());
  checker.onChecks((novelId) => { if (novelId === C.novelId) drawSoon(); });
}

/* the book now open: what it holds, watched */
export function showChecks(novelId, chapterId) {
  if (C.novelId !== novelId) {
    for (const off of C.offs) off();
    C.offs = [];
    C.novelId = novelId;
    C.watched = new Set();
    C.offs.push(store.subscribe('novel', novelId, () => { watchChapters(); drawSoon(); }));
    C.offs.push(store.subscribe('house', 'house', () => drawSoon()));
  }
  C.chapterId = chapterId;
  watchChapters();
  drawSoon();
}
function watchChapters() {
  const n = store.peek('novel', C.novelId);
  for (const id of (n && n.order) || []) {
    if (C.watched.has(id)) continue;
    C.watched.add(id);
    C.offs.push(store.subscribe('chapter', id, () => drawSoon()));
  }
}

function drawSoon() { if (!C.frame) C.frame = requestAnimationFrame(() => { C.frame = 0; draw(); }); }

function draw() {
  if (!bubble || !C.novelId) return;
  const st = checker.stateOf(C.novelId);
  bubble.dataset.state = st.state;
  bubble.textContent = '';
  if (st.state === 'found') bubble.append(h('b', st.count > 99 ? '99+' : String(st.count)));
  else if (st.state === 'clean') bubble.append(icon('check', 20));
  else if (st.state === 'trouble') bubble.append(h('b', '!'));
  else if (st.state === 'off') bubble.append(h('b', '–'));
  else bubble.append(h('span.ring'));
  const say = st.state === 'found' ? `Suggestions: ${plural(st.count, 'suggestion')}` : `Suggestions — ${st.words}`;
  bubble.setAttribute('aria-label', say);
  bubble.title = say;
  if (C.sheet) drawSheet();
}

/* ------------------------------------------------------------ the sheet */

function openSuggestions() {
  if (!C.novelId) return;
  if (C.sheet) return;
  const s = openSheet('Suggestions', { onClose: () => { C.sheet = null; } });
  s.box.classList.add('sugsheet');
  C.sheet = s;
  drawSheet();
}

function drawSheet() {
  const s = C.sheet;
  if (!s) return;
  const novelId = C.novelId;
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const st = checker.stateOf(novelId);
  const scroll = s.body.scrollTop;
  s.body.textContent = '';
  s.body.append(h('div.sugstate', { 'data-state': st.state }, h('span.dot'), h('span', st.words)));
  const list = checker.suggestions(novelId);
  const row = h('div.btnrow');
  /* Apply all puts in every change that has its words (a sentence to write again is his to ask for) */
  const can = list.filter((x) => typeof x.item.replace === 'string').length;
  if (can > 1) row.append(h('button.btn.primary.small', { onclick: () => {
    const n = checker.applyAll(novelId);
    toast(n ? `${plural(n, 'change')} applied — the words before are one arrow away.` : 'Nothing could be applied — the words had changed.');
  } }, `Apply all (${can})`));
  /* the older writing, checked only when he asks */
  const here = checker.unchecked(novelId, C.chapterId);
  const all = checker.unchecked(novelId);
  const busyNow = st.state === 'checking' || st.state === 'waiting';
  if (here.passages && !busyNow && st.state !== 'off') row.append(h('button.btn.small', { onclick: () => { checker.checkChapter(novelId, C.chapterId); toast('Checking this chapter.'); } }, 'Check this chapter'));
  if (all.passages > here.passages && !busyNow && st.state !== 'off') row.append(h('button.btn.small.quiet', { onclick: async () => {
    if (!(await confirmIt('Check the whole book?', `${plural(all.passages, 'passage')} that haven’t been checked — about ${all.words.toLocaleString()} words — go to the checker, a chapter at a time.`, 'Check the whole book'))) return;
    checker.checkBook(novelId);
  } }, 'Check the whole book'));
  if (row.childNodes.length) s.body.append(row);
  if (st.state === 'off') {
    s.body.append(h('div.btnrow', h('button.btn.small', { onclick: () => { s.close(); hooks.openSettings('roles'); } }, 'Open Who does what')));
  }
  if (!list.length) {
    /* (older writing: the line above says so, and the buttons are there) */
    if (st.state === 'clean' && !all.passages) s.body.append(h('p.say', 'Each passage is read once it is finished — for grammar, wording that sounds machine-made, your words to avoid, and slips against the book.'));
    s.body.scrollTop = scroll;
    return;
  }
  /* the open chapter first, then the others in the book's order */
  const groups = new Map();
  for (const x of list) { if (!groups.has(x.chapterId)) groups.set(x.chapterId, []); groups.get(x.chapterId).push(x); }
  const order = [...groups.keys()].sort((a, b) => (a === C.chapterId ? -1 : b === C.chapterId ? 1 : novel.order.indexOf(a) - novel.order.indexOf(b)));
  for (const cid of order) {
    const c = store.peek('chapter', cid);
    s.body.append(h('h3.sughead', c ? chapterLabel(novel, c) : 'A chapter'));
    for (const x of groups.get(cid)) s.body.append(card(novelId, x));
  }
  s.body.scrollTop = scroll;
}

const phrasesOf = (item) => (item.phrases && item.phrases.length ? item.phrases : item.phrase ? [item.phrase] : []);
/* a sentence with each of some words marked where it stands */
function marked(text, words) {
  const spans = [];
  for (const w of words) for (const s of findIn(text, w)) if (!spans.some((x) => x.start < s.end && s.start < x.end)) spans.push(s);
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const s of spans) { out.push(text.slice(at, s.start), h('mark', text.slice(s.start, s.end))); at = s.end; }
  out.push(text.slice(at));
  return out;
}

function card(novelId, x) {
  const { item } = x;
  const el = h('div.sug', { 'data-kind': item.kind });
  const show = () => {
    if (C.sheet) C.sheet.close();
    desk.whenOpen(x.chapterId, { passageId: x.passageId, show: { query: item.find } });
  };
  el.append(h('div.sugtop', h('span.tag', KIND[item.kind] || 'Wording'), h('button.link', { onclick: show }, `Passage ${x.number}`)));
  if (typeof item.replace === 'string') {
    el.append(h('div.sugwhat', h('del', item.find), ' ', icon('right', 14), ' ', item.replace ? h('ins', item.replace) : h('i', '(taken out)')));
  } else {
    /* words he never wants, marked in their sentence — to be written again */
    el.append(h('div.sugwhat', marked(item.find, phrasesOf(item))));
  }
  if (item.why) el.append(h('div.sugwhy', item.why));
  const btns = h('div.btnrow');
  if (typeof item.replace === 'string') {
    btns.append(h('button.btn.primary.small', { onclick: () => {
      const out = checker.applyOne(novelId, x.chapterId, x.passageId, item.id);
      if (!out.ok) toast(`It couldn’t be applied: ${out.said}.`, 5000);
    } }, 'Apply'));
  } else {
    btns.append(h('button.btn.primary.small', { onclick: () => {
      const spot = checker.spotOf(x.chapterId, x.passageId, item);
      if (!spot) { toast('Those words are not there any more.'); checker.leaveOne(x.chapterId, x.passageId, item.id, { remember: false }); return; }
      if (C.sheet) C.sheet.close();
      desk.rewriteSpan({ chapterId: x.chapterId, passageId: x.passageId, start: spot.start, end: spot.end, note: `Write it again without ${checker.quoted(phrasesOf(item))}.` });
    } }, 'Write it again'));
  }
  btns.append(h('button.btn.quiet.small', { onclick: () => checker.leaveOne(x.chapterId, x.passageId, item.id) }, 'Leave it'));
  el.append(btns);
  return el;
}
