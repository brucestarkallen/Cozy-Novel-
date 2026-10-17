/* Cozy Novel — js/ui/panes.js — beside the page: the chapters, the notes the
 * helper keeps, the partner, and playing a scene. Drawers on a phone,
 * columns on a wide screen. */

import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as archivist from '../novel/archivist.js';
import * as talk from '../novel/talk.js';
import { h, icon, toast, undoToast, menu, openSheet, confirmIt, askText, autoGrow, copyText, field, onBack, setText } from './dom.js';
import { picked, chapterSteps, novelSteps, chapterWords, chapterLabel, chapterPrint, passageNumbers, newCard, NOTE_KINDS, turnSteps, hisStamp } from '../novel/shape.js';
import { stretchPlan, scenePlan } from '../novel/stretches.js';
import { checkedNow } from '../novel/summarycheck.js';
import { numberWords, plural, timeAgo, nameKey, openOf, countWords } from '../util.js';
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
import { bibliographyView, bibliographyPrint, pageNames, tapName } from './bibliography.js';

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
  /* a marked name in a scene's telling opens its card (Tap names) */
  ui.rightBody.addEventListener('click', (e) => {
    const nm = e.target.closest && e.target.closest('.tprose .nm');
    if (!nm || !nm.dataset.name || (window.getSelection && !window.getSelection().isCollapsed)) return;
    e.stopPropagation();
    tapName(P.novelId, nm.dataset.name, e);
  }, true);
  for (const b of ui.tabs.querySelectorAll('button')) b.addEventListener('click', () => { P.side = b.dataset.tab; drawSide(); });
  archivist.onLight((novelId) => { if (novelId === P.novelId) { drawLight(); if (P.side === 'notes') drawSideSoon(); } });
  SF = follower(ui.rightBody, { tail: sideTail, active: () => P.side === 'partner' ? talk.talkBusy('talk', P.novelId) : P.side === 'play' && P.playId && talk.talkBusy('play', P.playId) });
  talk.onTalkLive(onTalkLive);
  /* a reply asked for: the pane follows it in, until his hand moves it up */
  talk.onTalkJob((key, job) => {
    const [kind, id] = key.split('/');
    if (!showing(kind, id)) return;
    if (job) SF.start();
    drawSide();
  });
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
  if (P.novelId !== novelId) { P.playId = null; notesView = 'cards'; notesTimeline?.destroy(); notesTimeline = null; paneCache.clear(); renderedPane = null; }
  P.novelId = novelId;
  P.chapterId = chapterId;
  P.offs.push(store.subscribe('novel', novelId, () => { drawChaptersSoon(); if (P.side === 'notes' || partnerChangesVisible()) drawSideSoon(); drawLight(); }));
  dockWide();
  drawChapters();
  drawSide();
  drawLight();
  watchTalk(novelId);
}

let chFrame = 0;
function drawChaptersSoon() { if (!chFrame) chFrame = requestAnimationFrame(() => { chFrame = 0; drawChapters(); }); }
/* the chapters are drawn only where they can be seen — the drawer open, or the
 * column beside the page; closed, the list is drawn as it opens (openLeft,
 * toggleLeft, dockWide). Every save of a chapter told the list to draw itself
 * again behind a closed drawer, every chapter's words counted each time (2.12.6). */
function leftVisible() { return Boolean(ui) && !document.getElementById('desk')?.hidden && (P.leftOpen || ui.left.classList.contains('dock')); }

function dockWide() {
  const w = wide();
  const focused = document.activeElement === document.body && paneFocus?.isConnected ? paneFocus : document.activeElement;
  const carryLeft = !w && ui.left.classList.contains('dock') && ui.left.contains(focused);
  const carryRight = !w && ui.right.classList.contains('dock') && !ui.right.classList.contains('full') && ui.right.contains(focused);
  /* A drawer he is using becomes a column when there is room. A saved
   * closed column still starts closed; opening a drawer is what changes it. */
  if (w && P.leftOpen) keep('cozynovel.left', 'on');
  if (w && P.rightOpen) keep('cozynovel.right', 'on');
  const leftWas = leftVisible();
  ui.left.classList.toggle('dock', w && kept('cozynovel.left') !== 'off');
  ui.right.classList.toggle('dock', w && kept('cozynovel.right') === 'on');
  if (!leftWas && leftVisible()) drawChapters();
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
  if (sideVisible()) drawSideSoon();
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
    if (on) drawChapters();
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
/* soon: from his tap on Notes, Partner or Scenes — the drawer begins to slide
 * at once and what is in it is drawn on the frame after: the slide runs on the
 * compositor, so building a long notebook no longer holds its first frame back */
let sideSoon = 0;
export function showSide(tab, { soon = false } = {}) {
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
  const opening = !P.rightOpen;
  if (opening) {
    P.rightOpen = true;
    ui.right.classList.add('open');
    ui.scrim.classList.add('on');
    P.release.right = onBack(() => closeRight(true));
  }
  if (soon && opening && typeof requestAnimationFrame === 'function') {
    for (const b of ui.tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === P.side));
    cancelAnimationFrame(sideSoon);
    sideSoon = requestAnimationFrame(() => { sideSoon = requestAnimationFrame(() => { sideSoon = 0; drawSide(); }); });
    return;
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
    P.offs.push(store.subscribe('chapter', id, () => { drawChaptersSoon(); if (P.side === 'notes' || partnerChangesVisible()) drawSideSoon(); }));
  }
  if (!leftVisible()) return;
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
    setText(li.querySelector('.n'), `Chapter ${numberWords(i + 1)}${(n.prefs || {}).endsAt === id ? ' · the last' : ''}`);
    /* his plan for it, under its name (the story map) */
    let plan = li.querySelector('.plan');
    if (!plan) { plan = h('span.plan'); li.querySelector('.go').append(plan); }
    setText(plan, String(c?.plan || '').trim() ? `Planned: ${String(c.plan).trim().replace(/\s+/g, ' ').slice(0, 160)}${String(c.plan).trim().length > 160 ? '…' : ''}` : '');
    plan.hidden = !plan.textContent;
    const name = li.querySelector('.nm');
    setText(name, c?.name || (words ? openingOf(c) : 'Not begun'));
    name.style.fontStyle = c?.name ? '' : 'italic';
    name.style.opacity = c?.name ? '' : '.75';
    setText(li.querySelector('.w'), plural(words, 'word'));
    const summary = li.querySelector('.sum');
    setText(summary, c?.summary?.text || '');
    summary.hidden = !summary.textContent;
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });
  for (const li of rows.values()) li.remove();
  if (active?.isConnected && list.contains(active) && document.activeElement !== active) active.focus({ preventScroll: true });
  const words = n.order.reduce((a, id) => a + chapterWords(store.peek('chapter', id) || { passages: [] }), 0);
  const goal = Number((n.meta || {}).goal) || 0;
  setText(ui.leftBody.querySelector('.chapter-total'), goal
    ? `${plural(n.order.length, 'chapter')} · ${words.toLocaleString()} of ${goal.toLocaleString()} words — ${Math.min(100, Math.floor((words / goal) * 100))}% of the way`
    : `${plural(n.order.length, 'chapter')} · ${plural(words, 'word')} in all`);
  setText(ui.leftTitle, 'Chapters');
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
    c && chapterWords(c) ? { label: 'Its summary', hint: 'What rides for this chapter once the book is longer than the model holds, and what the helper’s check made of it.', run: () => summarySheet(id) } : null,
    /* the story map: his plan for each chapter, the writer reading only the one it writes in */
    { label: c && String(c.plan || '').trim() ? 'Change what this chapter is for' : 'What this chapter is for', hint: 'Your plan for it. The writer reads it while writing in this chapter, never before; your partner sees the whole map.', run: async () => {
      const now = store.peek('chapter', id);
      const text = await askText(`What ${chapterLabel(n, now || c, { withName: false })} is for`, { multiline: true, value: (now && now.plan) || '', placeholder: 'What happens in it, where it leaves everyone — as loose or as exact as you like.', yes: 'Keep it',
        words: 'Your plan for this chapter. The writer reads it only while writing here, as where the chapter is going — never as something that already happened.' });
      if (text === null) return;
      store.change('chapter', id, chapterSteps.setPlan(text), { now: true });
    } },
    (n.prefs || {}).endsAt === id
      ? { label: 'Not the last chapter after all', hint: 'The writer stops being told how the book ends here.', run: () => { store.change('novel', P.novelId, novelSteps.setPref('endsAt', ''), { now: true }); } }
      : { label: 'Make it the last chapter', hint: 'The writer is told how the book ends and what is still open in the notes — and brings it home here.', run: () => { store.change('novel', P.novelId, novelSteps.setPref('endsAt', id), { now: true }); toast('This is the last chapter now — the writer brings the book home here.'); } },
    '-',
    n.order.length > 1 ? { label: 'Remove the chapter', hint: 'To Recently deleted for thirty days.', danger: true, run: () => removeChapter(id) } : null,
  ]);
}

/* WHAT RIDES IN SHORT, AND WHAT THE CHECK MADE OF IT: a chapter's summary
 * as it stands — or why there is none to send — with its check, and a long
 * chapter's stretches, each in its fold (the level between: archivist.js,
 * context.js stretchesOf). A scene's stretches the same (sceneShortSheet). */
function checkWords(entry, unit) {
  const k = entry && entry.checked;
  if (!k || !checkedNow(entry)) return `Not checked yet — the helper holds it against the ${unit} next.`;
  if (k.unread) return 'Its model would not check it. It is checked again once its words change.';
  const fixes = (k.fixed || []).map((f) => `“${f.from}” → “${f.to}”`);
  const adds = (k.added || []).map((a) => `“${a}”`);
  if (!fixes.length && !adds.length) return `Checked against the ${unit} — it stood.`;
  return `Checked against the ${unit}, and put right${fixes.length ? `: ${fixes.join('; ')}` : ''}${adds.length ? `${fixes.length ? '. Added' : ' — added'}: ${adds.join(' ')}` : ''}`;
}
const shortText = (text) => h('p', { style: { lineHeight: '1.6', whiteSpace: 'pre-wrap', margin: '6px 0 0' } }, text);
function stretchFolds(rows, unit) {
  const state = (st) => (!checkedNow(st) ? 'not checked yet' : st.checked.unread ? 'its model would not check it' : 'checked');
  return rows.map((r) => h('details.pane-guide.summary-stretch', h('summary', r.text ? `${r.label} · ${state(r.st)}` : `${r.label} · not summed up yet`),
    ...(r.text ? [h('p.hint', checkWords(r.st, unit)), shortText(r.text)] : [h('p.hint', 'The helper sums it up next.')])));
}
function summarySheet(chapterId) {
  const n = store.peek('novel', P.novelId);
  const c = store.peek('chapter', chapterId);
  if (!n || !c) return;
  const s = openSheet(chapterLabel(n, c));
  s.box.classList.add('summary-sheet');
  const sum = c.summary && String(c.summary.text || '').trim() ? c.summary : null;
  const current = sum && (!sum.fp || sum.fp === chapterPrint(c));
  const parts = [];
  if (sum && sum.by === 'you' && current) parts.push(h('p.hint', 'Your own summary — the helper keeps your words and never changes them.'), shortText(sum.text));
  else if (current) parts.push(h('p.hint', checkWords(sum, 'chapter')), shortText(sum.text));
  else if (sum) parts.push(h('p.hint', 'Waiting for the chapter’s latest changes: the summary from before them is never sent. Until the helper sums it up again, the chapter rides by its unchanged stretches, or by its opening and close.'));
  else parts.push(h('p.hint', 'Not summed up yet. The helper sums a chapter up once the writing has moved on from it, or after it has been quiet ten minutes; until then it rides by its stretches, or by its opening and close.'));
  /* a long chapter's stretches: what rides for it while the room holds them, before its one summary */
  const order = n.order || [];
  const plan = stretchPlan(c, { closeLast: order.indexOf(chapterId) < order.length - 1 });
  if (Array.isArray(c.stretches) && c.stretches.length && plan.stretches.length) {
    const nums = passageNumbers(c);
    const list = c.passages || [];
    const rows = plan.stretches.map((st) => {
      const ns = list.filter((p) => st.ids.includes(p.id)).map((p) => nums.get(p.id)).filter(Boolean);
      return { st, text: st.text, label: ns.length ? `Passages ${ns[0]}–${ns[ns.length - 1]}` : 'A stretch' };
    });
    parts.push(h('h3.summary-head', 'Its stretches, in short'), h('p.hint', 'A long chapter is kept in stretches of about 2,500 words. When it cannot ride whole, it rides by these while the room holds them — before its one summary.'), ...stretchFolds(rows, 'chapter'));
  }
  s.body.append(...parts);
}
function sceneShortSheet(playId) {
  const p = store.peek('play', playId);
  if (!p) return;
  const s = openSheet(`You play ${p.who} — in short`);
  s.box.classList.add('summary-sheet');
  const plan = scenePlan(p);
  if (!Array.isArray(p.stretches) || !p.stretches.length) {
    s.body.append(h('p.hint', 'Not needed yet: the narrator reads this scene whole. Once it grows long for the narrator’s room, the helper sums its earliest turns up in stretches, and those ride in their place — never just left out.'));
    return;
  }
  const turns = p.turns || [];
  const rows = plan.stretches.map((st) => {
    const a = turns.findIndex((t) => t.id === st.from) + 1, b = turns.findIndex((t) => t.id === st.to) + 1;
    return { st, text: st.text, label: `Turns ${a}–${b}` };
  });
  s.body.append(h('p.hint', 'Once the scene is longer than the narrator holds, its earliest turns ride as these — the fewest that fit.'), ...stretchFolds(rows, 'scene'));
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
  s.body.append(h('p.say', `${chapterLabel(n, c)} as it stood before each change — the newest eight, then one an hour for two days, then one a day for a month. Each says what it holds beside the chapter now; copies that read the same are one row. Look shows its passages before anything changes.`));
  const box = h('div');
  s.body.append(box);
  await fillEarlier(id, box, s);
}
/* how a copy differs from the chapter now, in a few words */
function besideNow(row, now) {
  if (!now || !Number.isFinite(row.passages)) return '';
  if (row.print && row.print === now.print) return 'The same words as now';
  const dp = row.passages - now.passages;
  const dw = row.words - now.words;
  const bits = [];
  if (dp) bits.push(`${plural(Math.abs(dp), 'passage')} ${dp > 0 ? 'more' : 'fewer'} than now`);
  if (dw) bits.push(`${plural(Math.abs(dw), 'word')} ${dw > 0 ? 'more' : 'fewer'}`);
  return bits.length ? bits.join(', ') : 'Other words than now, the same length';
}
/* the list as the phone has it now (the newest eight change as the book is saved: a copy replaced meanwhile is never
 * offered — his report, 2.12.3: "That copy could not be read"); copies that read the same, one row; the one that
 * reads as the chapter does now, said so (his report: "everything looks the same") */
async function fillEarlier(id, box, s) {
  box.replaceChildren(h('p.say', 'Looking…'));
  const { status, data } = await store.api('GET', `/api/history/chapter/${id}`, { wait: 60000 }).catch(() => ({ status: 0 }));
  if (status !== 200 || !data) { box.replaceChildren(h('p.say', 'The copies could not be listed just now — the phone did not answer.'), h('button.btn.small', { onclick: () => fillEarlier(id, box, s) }, 'Try again')); return; }
  if (!data.copies.length) { box.replaceChildren(h('p.say', 'No earlier copies yet.')); return; }
  const now = data.now;
  const groups = [];
  for (const row of data.copies) {
    const last = groups[groups.length - 1];
    if (last && row.print && last.rows[0].print === row.print) last.rows.push(row);
    else groups.push({ rows: [row] });
  }
  const list = h('ul.list.copies');
  box.replaceChildren(now ? h('p.say', h('strong', 'Now: '), `${plural(now.passages, 'passage')} · ${plural(now.words, 'word')}.`) : '', list);
  for (const g of groups) {
    const row = g.rows[0];
    const oldest = g.rows[g.rows.length - 1];
    const when = g.rows.length > 1 ? `${new Date(oldest.at).toLocaleString()} – ${new Date(row.at).toLocaleString()}` : new Date(row.at).toLocaleString();
    const holds = Number.isFinite(row.passages) ? `${plural(row.passages, 'passage')} · ${plural(row.words, 'word')}` : '';
    const beside = besideNow(row, now);
    const same = beside === 'The same words as now';
    list.append(h(same ? 'li.same' : 'li',
      h('div.grow', h('strong', beside || when), h('small', [beside ? when : '', holds, g.rows.length > 1 ? `${g.rows.length} copies, the same words` : '', timeAgo(row.at)].filter(Boolean).join(' · '))),
      h('button.btn.small', { onclick: () => lookAtCopy(id, row, box, s) }, 'Look'),
      same ? '' : h('button.btn.small', { onclick: () => bringBackCopy(id, row, box, s) }, 'Bring back')));
  }
}
/* one copy, read from the phone: {old} or null (said why) */
async function copyOf(id, row, box, s) {
  const got = await store.api('GET', `/api/history/chapter/${id}/${row.stamp}`, { wait: 60000 }).catch(() => ({ status: 0 }));
  if (got.status === 404) { toast('That copy was just replaced by a newer save — the list is up to date now. The copies an hour apart stay.', 7000); fillEarlier(id, box, s); return null; }
  if (got.status === 0) { toast('The phone did not answer in time — try again.', 6000); return null; }
  if (got.status !== 200 || !got.data || !got.data.data) { toast('That copy’s file is damaged — try the one below it.', 7000); return null; }
  return got.data.data;
}
/* its passages, each beside the chapter now: one not in it now, one with other words now */
async function lookAtCopy(id, row, box, s) {
  const old = await copyOf(id, row, box, s);
  if (!old) return;
  const cur = store.peek('chapter', id) || { passages: [] };
  const nowById = new Map((cur.passages || []).map((p) => [p.id, p]));
  const sheet = openSheet(`The copy of ${new Date(row.at).toLocaleString()}`);
  const list = h('ol.list.copypassages');
  let k = 0;
  for (const p of old.passages || []) {
    if (p.by === 'break') { list.append(h('li.break', '❦ scene break')); continue; }
    k++;
    const v = picked(p) || {};
    const text = String(v.text || '');
    const here = nowById.get(p.id);
    const state = !here ? 'Not in the chapter now' : String((picked(here) || {}).text || '') === text ? '' : 'Other words now';
    list.append(h('li', h('strong', `Passage ${k}${state ? ` — ${state}` : ''}`), h('small', `${plural(countWords(text), 'word')}`), h('p.say', text.length > 220 ? `${text.slice(0, 220)}…` : text || '(no words)')));
  }
  const gone = (cur.passages || []).filter((p) => p.by !== 'break' && !(old.passages || []).some((x) => x.id === p.id)).length;
  sheet.body.append(list,
    gone ? h('p.say.quiet', `${plural(gone, 'passage')} in the chapter now ${gone === 1 ? 'is' : 'are'} not in this copy.`) : '',
    h('div.btnrow', h('button.btn.primary.small', { onclick: () => { sheet.close(); bringBackCopy(id, row, box, s, old); } }, 'Bring this copy back')));
}
async function bringBackCopy(id, row, box, s, given = null) {
  const old = given || await copyOf(id, row, box, s);
  if (!old) return;
  if (!(await confirmIt('Bring this copy back?', `The chapter goes back to the copy of ${new Date(row.at).toLocaleString()} (${plural((old.passages || []).filter((p) => p.by !== 'break').length, 'passage')}, ${plural(chapterWords(old), 'word')}). The chapter as it is now is kept as the newest earlier copy, at the top of this list.`, 'Bring it back'))) return;
  /* what the helper had read that this changes is kept for it, so the notes follow the book back */
  archivist.retireBeforeReplace(P.novelId, id, old.passages || []);
  store.change('chapter', id, (d) => { d.passages = JSON.parse(JSON.stringify(old.passages || [])); d.name = old.name || ''; d.nameBy = old.nameBy || ''; }, { now: true });
  archivist.nudge(P.novelId);
  writer.recount(P.novelId);
  s.close();
  toast(`The chapter is back as it was at ${new Date(row.at).toLocaleString()}. How it was a moment ago is the newest earlier copy.`, 7000);
}

/* --------------------------------------------------------------- light */

/* the helper's light rides on the Notes button */
function drawLight() {
  const l = archivist.lightOf(P.novelId);
  ui.light.dataset.state = l.state;
  ui.light.title = `Notes — ${l.words}`;
  ui.light.setAttribute('aria-label', `Notes — ${l.words}`);
}
/* the talk record at hand as the book opens — read, never made — so the Partner
 * button's count is right before the pane is opened; one subscription per book
 * open, shared with the pane (drawPartner) */
function watchTalk(novelId) {
  if (P.offs.talkSub) { drawWaiting(); return; }
  P.offs.talkSub = true;
  P.offs.push(store.subscribe('talk', novelId, () => { drawWaiting(); if (P.side === 'partner' && !drawnAlready('talk', novelId)) drawPartnerSoon(); }));
  store.open('talk', novelId).then(() => { if (P.novelId === novelId) drawWaiting(); }).catch(() => {});
}
/* the Partner button carries how many of its changes wait for him (2.12.9), so he knows without opening it */
function drawWaiting() {
  const btn = document.getElementById('partnerBtn');
  if (!btn || !P.novelId) return;
  const n = store.peek('talk', P.novelId) ? talk.waitingAll(P.novelId).length : 0;
  if (n) { btn.dataset.waiting = String(n); btn.title = `Partner — ${plural(n, 'change')} waiting for you`; btn.setAttribute('aria-label', btn.title); }
  else if (btn.dataset.waiting) { delete btn.dataset.waiting; btn.title = 'Partner'; btn.setAttribute('aria-label', 'Partner'); }
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
function refreshComposer(key, novelId = P.novelId) {
  const ta = ui.rightFoot.querySelector('textarea'), tb = ui.rightFoot.querySelector('textarea.tellbox');
  const saved = composerOf(key, novelId);
  if (ta && (ta.value !== (saved.value || '') || (tb && (tb.value !== (saved.tell || '') || tb.hidden === Boolean(saved.tellOpen))))) restoreTyped(key, novelId);
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
const paneCache = new Map();
let renderedPane = null;
function sideVisible() {
  return ui && !document.getElementById('desk')?.hidden && ['open', 'dock', 'full'].some(c => ui.right.classList.contains(c));
}
function partnerChangesVisible() { return sideVisible() && P.side === 'partner' && ui.rightBody.querySelector('.changes'); }
/* Returning to a tab should not typeset the same long conversation again.
 * Keep only the latest view of each of the three tabs, and only for this
 * book. A Timeline owns subscriptions, so it is recreated when left. */
function switchPane(key) {
  if (renderedPane?.key === key) return;
  P.liveTurn = null;
  if (renderedPane && renderedPane.cacheable) {
    const body = document.createDocumentFragment(), foot = document.createDocumentFragment();
    body.append(...ui.rightBody.childNodes); foot.append(...ui.rightFoot.childNodes);
    paneCache.set(renderedPane.side, { ...renderedPane, body, foot, footHidden: ui.rightFoot.hidden,
      draftFor: ui.rightFoot.dataset.for, draftBook: ui.rightFoot.dataset.book, notesSignature, drawn: P.drawn });
  }
  notesTimeline?.destroy(); notesTimeline = null;
  const cached = paneCache.get(P.side);
  paneCache.delete(P.side);
  ui.rightBody.replaceChildren(); ui.rightFoot.replaceChildren();
  ui.rightFoot.hidden = true; notesSignature = ''; P.drawn = '';
  if (cached?.key === key) {
    ui.rightBody.append(cached.body); ui.rightFoot.append(cached.foot);
    ui.rightFoot.hidden = cached.footHidden;
    ui.rightFoot.dataset.for = cached.draftFor || ''; ui.rightFoot.dataset.book = cached.draftBook || '';
    notesSignature = cached.notesSignature; P.drawn = cached.drawn;
  } else if (P.side !== 'notes') {
    ui.rightBody.append(h('p.pane-loading', { role: 'status' }, P.side === 'play' ? 'Opening your scenes…' : 'Opening your conversation…'));
  }
  renderedPane = { key, side: P.side, cacheable: P.side !== 'notes' || notesView === 'cards' };
}
/* Leave unchanged elements connected: removing and immediately putting them
 * back still loses selection, focus and the browser's scrolling anchor. */
function keepChildren(parent, children) {
  const wanted = new Set(children);
  for (const child of [...parent.children]) if (!wanted.has(child)) child.remove();
  children.forEach((child, i) => { if (parent.children[i] !== child) parent.insertBefore(child, parent.children[i] || null); });
}
function drawSide() {
  if (!ui || !sideVisible()) return;
  sideGen++;
  /* full screen belongs to a scene: anything else beside the page goes back to its column */
  if (fullKind() === 'scene' && !(P.side === 'play' && P.playId)) leaveFull();
  if (fullKind() === 'partner' && P.side !== 'partner') leaveFull();
  keepTyped();
  const nextPane = sideView() + (P.side === 'notes' ? '/' + notesView : '');
  /* and a conversation drawn again keeps his place too, unless he is with its newest words */
  sideKeep = { view: P.shownView, top: ui.rightBody.scrollTop };
  /* Reset a different notebook view before changing its contents. Unchanged
   * cards stay connected, so the browser keeps the reading anchor itself.
   * Writing scrollTop after appending every card forces all their layout
   * inside the click handler, before the drawer can begin to move. */
  if (P.side === 'notes' && renderedPane?.key !== nextPane && sideKeep.top) ui.rightBody.scrollTop = 0;
  P.shownView = sideView();
  for (const b of ui.tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === P.side));
  ui.right.dataset.tab = P.side;
  /* A helper reading never removes a timeline filter under his fingers. */
  if (P.side === 'notes' && notesView === 'timeline' && notesTimeline?.novelId === P.novelId && notesTimeline.el.isConnected) {
    notesTimeline.update(P.chapterId);
    return;
  }
  switchPane(nextPane);
  if (P.side === 'notes') drawNotes();
  else if (P.side === 'partner') drawPartner();
  else drawPlay();
}

/* ---------------------------------------------------------------- notes */

const KIND_TITLE = { people: 'People', places: 'Places', lore: 'Things worth remembering', threads: 'Threads' };
let notesView = 'cards', notesTimeline = null;
let notesSignature = '';

/* Both views belong to the same notebook. The timeline links back to these
 * cards and to the existing reading action, never to another set of notes. */
function notesViews() {
  const views = h('div.segmented.notes-views', { role: 'group', 'aria-label': 'Notebook view' });
  for (const [value, label, title] of [['cards', 'Cards', 'Read or edit the notes that travel with your story.'], ['timeline', 'Timeline', 'Follow changes in people, relationships and threads, with their source passages.'], ['bibliography', 'Bibliography', 'What each name in the book means — filled from the book as it is read, with your own entries.']]) {
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

let bibSignature = '';
function drawNotes() {
  const n = store.peek('novel', P.novelId);
  if (!n) return;
  const novelId = P.novelId;
  /* Notes → Bibliography (bibliography.js): drawn again only when what it shows changed */
  if (notesView === 'bibliography') {
    const sig = bibliographyPrint(novelId);
    if (sig === bibSignature && ui.rightBody.querySelector('.bibview')) return;
    bibSignature = sig;
    notesSignature = '';
    let intro = ui.rightBody.querySelector('.pane-intro');
    if (!intro) intro = h('div.pane-intro', h('p.pane-kicker', 'Beside the story'), h('div.pane-title-row', h('h2', 'Your notebook'), h('span.pane-count')));
    /* drawn again while he types in its filter, or reads down the list: the box keeps his place in it, the list its place */
    const old = ui.rightBody.querySelector('.bibview .bibfilter');
    const typing = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
    const top = ui.rightBody.scrollTop;
    const view = bibliographyView(novelId, { redraw: () => { bibSignature = ''; drawSide(); } });
    const count = intro.querySelector('.pane-count');
    if (count.textContent !== view.dataset.count) count.textContent = view.dataset.count || '';
    keepChildren(ui.rightBody, [intro, ui.rightBody.querySelector('.notes-views') || notesViews(), view]);
    const box = typing && view.querySelector('.bibfilter');
    if (box) { box.focus({ preventScroll: true }); try { box.setSelectionRange(typing[0], typing[1]); } catch (_) { /* fine */ } }
    if (ui.rightBody.scrollTop !== top) ui.rightBody.scrollTop = top;
    return;
  }
  bibSignature = '';
  const l = archivist.lightOf(novelId);
  const m = n.memory || {};
  const readings = notesView === 'cards' ? archivist.readingsList(novelId) : [];
  const aside = archivist.asideNow(n);
  const whereabouts = (n.notes?.people || []).filter(c => c.now).map(c => nowLabelOf(n, c, 'Now'));
  const signature = JSON.stringify([novelId, notesView, n.order, n.notes, whereabouts, m.lit, m.undo && [m.undo.at, m.undo.label, m.undo.cards?.length, m.undo.notes, m.undo.kept, m.undo.changed], aside, m.audit, m.auditAsked, l, archivist.rereading(novelId), archivist.stalled(novelId), readings, P.readingsAll]);
  if (signature === notesSignature && ui.rightBody.querySelector('.notesec')) return;
  notesSignature = signature;
  const children = [];
  const totalCards = NOTE_KINDS.reduce((a, k) => a + ((n.notes && n.notes[k]) || []).length, 0);
  let intro = ui.rightBody.querySelector('.pane-intro');
  if (!intro) intro = h('div.pane-intro', h('p.pane-kicker', 'Beside the story'), h('div.pane-title-row', h('h2', 'Your notebook'), h('span.pane-count')));
  const count = plural(totalCards, 'card');
  if (intro.querySelector('.pane-count').textContent !== count) intro.querySelector('.pane-count').textContent = count;
  children.push(intro, ui.rightBody.querySelector('.notes-views') || notesViews());
  if (notesView === 'timeline') {
    notesTimeline = makeTimeline({ novelId, chapterId: P.chapterId,
      current: () => sideVisible() && P.novelId === novelId && P.side === 'notes' && notesView === 'timeline' && location.hash.split('/')[2] === novelId,
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
    keepChildren(ui.rightBody, [...children, notesTimeline.el]);
    notesTimeline.update();
    return;
  }
  const card = h('div.lightcard.note-status', { 'data-state': l.state },
    h('div.note-status-heading', h('span.note-status-light', { 'aria-hidden': 'true' }), h('h3', l.state === 'off' ? 'No helper chosen' : l.state === 'reading' ? 'Reading your story' : l.state === 'trouble' ? 'The helper needs a hand' : l.state === 'waiting' ? 'Waiting to read' : 'Keeping the story close')),
    h('p.note-status-copy', l.state === 'off' ? 'Choose one in Settings → Connections to keep your notes up to date. Your own cards are always yours to edit.' : l.words));
  const row = h('div.row');
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
  children.push(card);
  /* the last check, for him to read: whether everything holds and he can carry on, and why for each change */
  children.push(checkReport(n, { asked, off, cards }));
  /* what its model would not read, set aside — each with Read it again, labelled where it stands now */
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
    children.push(box);
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
    let sec = ui.rightBody.querySelector(`.notesec[data-kind="${kind}"]`);
    if (!sec) {
      sec = h('section.notesec' + (open ? '.open' : ''), { 'data-kind': kind });
      const head = h('button.sechead', { 'aria-expanded': String(open), onclick: () => { const now = sec.classList.toggle('open'); head.setAttribute('aria-expanded', String(now)); keep('cozynovel.fold.' + key, now ? 'open' : 'closed'); } },
        h('span.chev', icon('chev', 14)), h('h3', KIND_TITLE[kind]), h('span.count'));
      sec.append(head, h('div.cards'));
    }
    const count = sec.querySelector('.count');
    if (count.textContent !== String(cards.length)) count.textContent = String(cards.length);
    const box = sec.querySelector('.cards'), nextCards = [];
    const previous = new Map([...box.querySelectorAll('.notecard')].map(el => [el.dataset.id, el]));
    const sorted = kind === 'threads' ? [...cards].sort((a, b) => (a.open === false) - (b.open === false)) : cards;
    for (const c of sorted) {
      const state = how.get(kind + ':' + nameKey(c.name));
      const mine = Boolean(c.updated && c.updated.by === 'you');
      const signature = JSON.stringify([c, state, whyOf.get(kind + ':' + nameKey(c.name)), kind === 'people' && c.now ? nowLabelOf(n, c, 'Now') : '']);
      const before = previous.get(c.id);
      if (before?._noteSignature === signature) { nextCards.push(before); continue; }
      const card = h('div.card.notecard' + (state ? '.fresh' : '') + (kind === 'threads' && c.open === false ? '.closed' : ''), {
        'data-id': c.id,
        role: 'button', tabindex: 0, 'aria-label': `Edit ${c.name}`, title: `Open ${c.name} to read or edit the card`,
        onclick: () => editCard(kind, c.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editCard(kind, c.id); } },
      },
        h('div.nm', c.name + (kind === 'threads' && c.open === false ? ' — closed' : ''),
          state ? h('span.ctag.lit', state === 'new' ? 'new' : 'updated') : null,
          mine ? h('span.ctag.yours', 'yours') : null),
        c.aka && c.aka.length ? h('div.aka', 'also ' + c.aka.join(', ')) : null,
        /* (why a card changed is in the check's own list above, never on every card: 2.12.16) */
        c.about ? h('div.ab', c.about) : null,
        c.since && String(c.since).trim() ? h('div.nw.since', { title: 'What the book has told of them since your words — kept beside them, never over them.' }, h('b', 'Since then'), c.since) : null,
        kind === 'people' && c.ties ? h('div.nw.ties', h('b', 'With others'), c.ties) : null,
        kind === 'people' && c.now ? h('div.nw', h('b', nowLabelOf(n, c, 'Now')), c.now) : null);
      card._noteSignature = signature;
      nextCards.push(card);
    }
    if (!cards.length) nextCards.push(box.querySelector('.notes-empty') || h('p.notes-empty', kind === 'people' ? 'The people of your story will gather here.' : kind === 'places' ? 'A place for every corner of your world.' : kind === 'threads' ? 'Keep the questions your story has yet to answer.' : 'The small details that make your world its own.'));
    nextCards.push(box.querySelector('.note-add') || h('button.btn.quiet.small.note-add', { title: `Add your own card to ${KIND_TITLE[kind].toLowerCase()}.`, onclick: () => editCard(kind, null) }, icon('plus', 14), 'Add'));
    keepChildren(box, nextCards);
    children.push(sec);
  }
  children.push(key, readingsSection(readings));
  keepChildren(ui.rightBody, children);
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
function readingsSection(rows = archivist.readingsList(P.novelId)) {
  const key = 'cozynovel.fold.notes.readings';
  const open = kept(key) === 'open';
  const sec = h('section.notesec' + (open ? '.open' : ''));
  const head = h('button.sechead', { 'aria-expanded': String(open), onclick: () => { const now = sec.classList.toggle('open'); head.setAttribute('aria-expanded', String(now)); keep(key, now ? 'open' : 'closed'); } },
    h('span.chev', icon('chev', 14)), h('h3', 'Each version’s notes'), h('span.count', String(rows.length)));
  const box = h('div.cards');
  box.append(h('p.notekey', 'Newest first. The arrows on a passage bring its version’s notes back by themselves, and so does Put back the words before.'));
  if (!rows.length) box.append(h('p.notekey', 'None kept yet — each reading from now on is.'));
  /* the newest few; the rest one tap away */
  const all = P.readingsAll === P.novelId;
  /* Show all is all of them (it drew sixty, the rest out of reach and unsaid — Cozy Tavern M134) */
  for (const r of all ? rows : rows.slice(0, 8)) {
    const what = r.changed.length ? r.changed.slice(0, 6).map((c) => `${c.how === 'new' ? 'new' : c.how === 'gone' ? 'took out' : 'updated'} ${c.name}`).join(', ') + (r.changed.length > 6 ? '…' : '') : 'changed nothing';
    const state = r.live ? 'in the notes now' : r.shown ? 'the version on show — not read into the notes yet' : r.earlier ? 'its words before a change — their notes come back with Put back the words before' : 'an earlier version — its notes come back when you pick it';
    box.append(h('div.card.reading' + (r.live ? '.fresh' : ''),
      h('div.nm', r.label, h('span.ctag' + (r.live ? '.lit' : ''), r.live ? 'in the notes' : r.shown ? 'on show' : r.earlier ? 'earlier words' : 'earlier version')),
      h('div.ab', { title: state }, `${timeAgo(r.at)} · ${what}`),
      r.live ? h('div.row', { style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
        h('button.btn.small.quiet', { title: 'Takes out only what this reading changed; a card changed since stays as it is.', onclick: (e) => { e.stopPropagation(); if (archivist.putBackReading(P.novelId, r.pid, r.vid, { sig: r.sig })) toast('What that reading changed is put back — anything changed since stays as it is.'); drawSide(); } }, 'Put back'),
        h('button.btn.small.quiet', { title: 'Puts it back, then the helper reads that passage afresh.', onclick: (e) => { e.stopPropagation(); if (archivist.putBackReading(P.novelId, r.pid, r.vid, { readAgain: true, sig: r.sig })) toast('Put back — the helper reads that passage again in a moment.'); drawSide(); } }, 'Read again')) : null));
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
    /* his own words changed and Since then left: of it, only what his new words do not already say (2.12.18) — the check judges the rest against the book */
    else if (t.about !== undefined && String(out.since || '').trim()) { const rest = archivist.newSentences(out.about, out.since).join(' ').trim(); if (rest) out.since = rest; else delete out.since; }
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
  if (gen !== sideGen || P.side !== 'partner' || P.novelId !== novelId || !sideVisible()) return;
  const draftKey = `talk:${novelId}:${t?.convId || 'current'}`;
  if (t) talk.repairStaleTurns('talk', novelId);
  /* the book's scenes at hand, so a rename everywhere reaches them */
  talk.loadPlays(novelId).catch(() => {});
  watchTalk(novelId);
  const priorTop = ui.rightBody.querySelector('.conversation-heading');
  const headingSignature = JSON.stringify([talk.partnerConversations(novelId).open.name, fullKind(), talk.talkBusy('talk', novelId), !t?.turns?.length && !t?.named]);
  const heading = priorTop?._headingSignature === headingSignature ? priorTop : conversationRow(novelId, t);
  heading._headingSignature = headingSignature;
  let box = ui.rightBody.querySelector('.talk');
  if (box?.dataset.conversation !== draftKey) box = h('div.talk', { 'data-conversation': draftKey });
  const turns = (t && t.turns) || [];
  const extras = [];
  if (!turns.length) extras.push(box.querySelector('.pane-welcome') || h('div.pane-welcome', h('span.pane-welcome-mark', { 'aria-hidden': 'true' }, icon('chat', 28)), h('p.pane-kicker', 'A little room to think'), h('h2', 'Talk the story over'),
    h('p', 'A scene that feels stuck. A character you want to understand. The next turn in the story. Your partner knows the book and its notes.'),
    h('div.pane-welcome-tip', icon('more', 18), h('span', h('b', 'Need a starting point?'), ' Quick asks, beside Send, has a few.')),
    h('details.pane-guide', h('summary', 'What your partner can help with'), h('p', 'Ask about any passage by its chapter and passage number, a name across the book, a chapter’s name or summary, what the book is about, a card in the notes, or a module’s words. When you ask for a change, it shows here with its Undo. The helper keeps and checks the notes; its reasons are in Notes.'))));
  updateTurns(box, 'talk', novelId, turns, { extras });
  keepChildren(ui.rightBody, [heading, box]);
  const working = talk.talkBusy('talk', novelId);
  if (ui.rightFoot.dataset.for === draftKey && ui.rightFoot.querySelector('textarea')) {
    waitBar(novelId);
    refreshComposer(draftKey, novelId);
    const send = ui.rightFoot.querySelector('[data-composer-send]');
    const label = working ? 'Stop' : 'Send';
    if (send.textContent !== label) send.textContent = label;
    ui.rightFoot.querySelector('[aria-label="Quick asks"]').disabled = working;
    const start = ui.rightFoot.querySelector('[data-start-over]');
    start.disabled = working; start.hidden = !turns.length;
    rememberDrawn('talk', novelId, t);
    placeSide();
    return;
  }
  const ta = h('textarea', { rows: 1, placeholder: 'Ask your partner…', 'aria-label': 'Ask your partner' });
  const send = h('button.btn.primary.small', { 'data-composer-send': '', onclick: async () => {
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
  ui.rightFoot.append(ta, h('div.crow', h('button.btn.quiet.small', { 'data-start-over': '', hidden: !turns.length, title: 'This conversation’s talk goes and it begins again — the changes it made stay in the book. With Undo.', disabled: working, onclick: clearTalk }, 'Start over'), h('span.grow'), quick, send));
  waitBar(novelId);
  autoGrow(ta, 0.3);
  restoreTyped(draftKey, novelId);
  rememberDrawn('talk', novelId, t);
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
  { label: 'Map the chapters to the end', hint: 'Plans the chapters still to come, one by one, to the ending you have in mind — each a plan you can change, new chapters made to hold them, with Undo.',
    ask: 'Map the rest of the book with me: from where it stands now to the end I have in mind, the chapters it still needs — each chapter’s plan in a few lines (what happens, what it turns, where it leaves everyone), pacing it so nothing is rushed and every open thread is paid off. Make each one a plan for its chapter, new chapters after the last one where they are needed, and tell me the shape of it in a few lines.' },
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

function drawPartnerSoon() { if (!partnerFrame) partnerFrame = requestAnimationFrame(() => { partnerFrame = 0; if (P.side === 'partner') drawSide(); }); }

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
const turnKey = (kind, id, turnId) => `${kind}:${id}:${turnId}`;
function turnThinkBox(key, thinking, live) {
  return thinkBox(thinking, { live, open: thinkOpen.has(key), onToggle: (now) => { if (now) thinkOpen.add(key); else thinkOpen.delete(key); } });
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
  const key = turnKey(kind, id, turn.id);
  const live = (kind === 'talk' ? partnerLive : playLive).get(key);
  const text = live ? live.text : v.text;
  const thinking = live ? live.thinking : v.thinking;
  const el = h('div.turn.' + (turn.by === 'you' ? 'you' : 'ai') + (kind === 'play' && turn.by !== 'you' ? '.prose-turn' : '') + (live || v.streaming ? '.streaming' : ''), { 'data-id': turn.id });
  el.append(h('div.turn-speaker', turn.by === 'you' ? 'You' : kind === 'play' ? 'The narrator' : 'Your partner'));
  /* the thinking streams open while it comes, then folds once the words begin */
  if (turn.by !== 'you' && thinking) el.append(turnThinkBox(key, thinking, Boolean(live && !live.text)));
  /* the narrator's telling is prose — a thought or a sound in italics is drawn in italics */
  if (kind === 'play' && turn.by !== 'you') { const w = h('div.words.tprose'); drawProse(w, shownWords(kind, turn, text, live), { tint: true, names: pageNames(P.novelId) }); el.append(w); }
  else if (kind === 'talk' && turn.by !== 'you' && partsOf(text).some((x) => x.kind === 'direction')) {
    /* each premise it offered, with its own Use as the next direction */
    const w = h('div.words');
    for (const part of partsOf(text)) {
      if (part.kind === 'words') { if (live || v.streaming) w.append(h('span', part.text)); else { const d = h('div.tprose.talkprose'); drawProse(d, part.text, { tint: true }); w.append(d); } continue; }
      w.append(h('div.direction', h('span', part.text), part.done && !(live || v.streaming) ? h('button.btn.small', { title: 'Puts this premise in the box under the page — change it as you like, then Write.', onclick: async () => { if (!(await desk.useAsDirection(part.text))) return; if (!wide()) closeRight(); toast('It is in the box — change it as you like, then Write.'); } }, 'Use as the next direction') : null));
    }
    el.append(w);
  } else if (kind === 'talk' && turn.by !== 'you' && !(live || v.streaming) && wordsOf(text)) { const w = h('div.words.tprose.talkprose'); drawProse(w, shownWords(kind, turn, text, live), { tint: true }); el.append(w); }
  else el.append(h('span.words', shownWords(kind, turn, text, live)));
  /* his line to the narrator, not his character's */
  if (kind === 'play' && turn.by === 'you' && v.tell) el.append(h('div.tell', h('b', 'To the narrator: '), v.tell));
  if (live || v.streaming) return el;
  if (turn.by !== 'you' && v.cut) el.append(h('div.turnnote.cutnote', String(v.text || '').trim() ? `It stopped partway${v.cutWhy ? ` — ${v.cutWhy}` : ''}.` : `No words came${v.cutWhy ? ` — ${v.cutWhy}` : ''}. What it thought is kept above.`));
  if (kind === 'talk' && v.read && v.read.length) el.append(h('div.turnnote', `It read ${v.read.join(', ')} whole.`));
  /* what was said of this answer — a lesson its model taught, what was taken off it — as a page's version says it */
  if (turn.by !== 'you' && v.notes && v.notes.length) el.append(h('div.turnnote.said', v.notes.join(' ')));
  if (kind === 'play' && turn.by !== 'you') {
    const usage = sceneInputTokens(v);
    el.append(h('p.turn-tokens', { title: usage?.counted
      ? 'Input tokens reported by the provider for this telling, including the instructions, notes and scene history sent with your move.'
      : usage ? 'Estimated input tokens for this telling. The provider did not return an input-token count.' : 'This older telling has no saved input-token count.' },
    usage ? `${usage.counted ? '' : 'About '}${usage.tokens.toLocaleString()} tokens sent` : 'Tokens sent not recorded'));
  }
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
    !mine && v.sent ? { label: 'What was sent', hint: 'Everything this answer was asked with, as it went out.', run: () => showSent(P.novelId, v.sent, kind === 'play' ? 'play' : 'partner') } : null,
    !mine && kind === 'play' && (String(v.tookOff || '').trim() || String(v.tookOffTop || '').trim()) ? { label: 'Put back what was taken off', hint: 'What the narrator added around its telling — a heading or its plan above it, a note to you, its check of its work or a block of tracking after it — back where it was, as a new version of this answer.', disabled: talk.talkBusy('play', id), run: () => { if (talk.putBackTelling({ playId: id, turnId: turn.id })) toast('Put back — the answer without it is one arrow away.'); } } : null,
    { label: 'Copy', hint: mine ? 'Your words, to paste anywhere.' : 'Its words, to paste anywhere.', run: async () => toast((await copyText(copyWords)) ? 'Copied.' : 'It could not be copied.') },
    '-',
    { label: 'Remove', hint: mine ? `This message and the ${kind === 'play' ? 'telling' : 'answer'} to it go from the ${kind === 'play' ? 'scene' : 'conversation'}, with Undo${kind === 'talk' ? '; changes it made stay in the book' : ''}.` : kind === 'play' ? 'This telling goes from the scene, with Undo.' : 'This answer goes from the conversation, with Undo; changes it made stay in the book.', danger: true, run: () => removeTurn(kind, id, turn) },
  ]) }, icon('more', 16)));
  el.append(row);
  return el;
}

/* A checkpoint or one changed answer is not a new conversation. Inspect the
 * selected answer only; its saved request and all older takes are not painted.
 * Keeping earlier turns connected also keeps text selection and open thinking. */
function sceneInputTokens(v) {
  if (Number.isFinite(v.usage?.in) && v.usage.in >= 0) return { tokens: v.usage.in, counted: true };
  if (Number.isFinite(v.tokensIn) && v.tokensIn >= 0) return { tokens: v.tokensIn, counted: Boolean(v.tokensCounted) };
  return null;
}
function turnSignature(turn, newest, kind, id) {
  const v = picked(turn) || {};
  const { ask, usage, ms, conn, model, beat, at, tab, text, thinking, ...visible } = v;
  const changesContext = kind === 'talk' && v.changes?.length ? v.changes.filter(c => !c.superseded).map(c => [
    labelNow(id, c), c.status === 'waiting' && !c.copied ? talk.waitingWhy(id, c) : '',
    c.status === 'waiting' ? wordsNow(id, c) : '',
  ]) : null;
  /* Compare long strings directly. JSON-encoding the whole conversation on
   * every checkpoint allocates another copy of every old paragraph. */
  return [turn.id, turn.by, turn.pick, (turn.versions || []).map(v => v.id).join('\0'), JSON.stringify(visible), JSON.stringify(changesContext),
    writingHere(v) ? null : text, writingHere(v) ? null : thinking,
    newest, kind === 'play' ? JSON.stringify(sceneInputTokens(v)) : '', turn.by === 'you' && kind === 'talk' && talk.talkBusy(kind, id),
    Boolean((kind === 'talk' ? partnerLive : playLive).get(turnKey(kind, id, turn.id)))];
}
const sameSignature = (a, b) => a?.length === b?.length && a.every((part, i) => part === b[i]);
function updateTurns(box, kind, id, turns, { turned = null, extras = [] } = {}) {
  const old = new Map([...box.querySelectorAll(':scope > .turn')].map(el => [el.dataset.id, el]));
  const children = [];
  for (const [index, turn] of turns.entries()) {
    const signature = turnSignature(turn, index === turns.length - 1, kind, id);
    let el = old.get(turn.id);
    if (!el || !sameSignature(el._turnSignature, signature)) { el = drawTurn(kind, id, turn); el._turnSignature = signature; }
    children.push(el);
    if (turn.id === turned) children.push(box.querySelector('.turned-marker') || h('p.hint.turned-marker', { style: { textAlign: 'center', margin: '0' } }, '— written into the book up to here —'));
  }
  keepChildren(box, [...children, ...extras]);
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
  if (op.passage !== undefined && op.rewrite !== undefined) return h('span', 'to the writer, to write it again: ', h('i', clip(op.rewrite, 300)));
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
    const mark = { made: '✓', waiting: '•', writing: '…', refused: '✗', undone: '↶', skipped: '–' }[c.status] || '•';
    /* a waiting one that could not land now (its words gone, its thing changed since): said, with no Apply (M224) */
    const stale = c.status === 'waiting' && !c.copied ? talk.waitingWhy(novelId, c) : '';
    const state = { made: c.op && c.op.rewrite !== undefined ? `written again by the writer from ${c.edited ? 'your' : 'its'} note${c.said ? ` — ${c.said}` : ''} — one arrow away from the words before` : c.edited ? 'made with your words' : c.with ? c.said : (c.said && c.op && (c.op.find !== undefined || c.op.text !== undefined) ? c.said : ''), writing: 'the writer is writing it again — it streams on the page', waiting: stale ? `can’t be made now — ${stale}` : c.group ? 'waiting for Apply — made together with the others of its kind here' : 'waiting for Apply', refused: `couldn’t be made — ${c.said || 'no reason given'}`, undone: c.undoneSaid ? `undone in part — ${c.undoneSaid}` : 'undone', skipped: c.aside ? 'replaced by a newer answer’s change to the same' : 'left as it was' }[c.status] || '';
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
  /* this answer's own: named by their scope — the conversation's Apply all, for everything waiting in every answer, is in the foot (waitBar) */
  if (waiting.length > 1) box.append(h('div.cbtns', h('button.go', { title: `The ${waiting.length} changes waiting in this answer, made in the book. Apply all, below the talk, makes everything waiting in every answer.`, onclick: all('apply') }, `Apply these ${waiting.length}`), h('button', { title: `Leave the book as it is for the ${waiting.length} changes waiting in this answer.`, onclick: all('skip') }, `Leave these ${waiting.length}`)));
  if (made.length > 1) box.append(h('div.cbtns', h('button', { title: `The ${made.length} changes this answer made, put back — the newest first; one changed since stays.`, onclick: all('undo') }, `Undo these ${made.length}`)));
  return box;
}

/* WHAT WAITS IN THE WHOLE CONVERSATION, under the talk and above his box:
 * "6 changes waiting", Apply all, Leave all (talk.js settleWaiting). One
 * place, one button, however many answers the changes came in (2.12.9). */
function waitBar(novelId) {
  const all = talk.waitingAll(novelId);
  const can = all.filter((w) => !w.stale);
  let bar = ui.rightFoot.querySelector('.waitbar');
  if (!all.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = h('div.waitbar', h('span.waitcount'), h('span.grow'),
      h('button.btn.primary.small', { 'data-apply-all': '', title: 'Every change still waiting in this conversation, from every answer, made in the book — the oldest answer first, each in its order. One that can’t be made now says why and stays.', onclick: async () => { const out = talk.settleWaiting(novelId, 'apply'); if (out.failed.length) toast(`${plural(out.failed.length, 'change')} couldn’t: ${out.failed[0]}.`, 6000); drawSideSoon(); } }, 'Apply all'),
      h('button.btn.quiet.small', { 'data-leave-all': '', title: 'Leave the book as it is for every change still waiting in this conversation.', onclick: async () => { talk.settleWaiting(novelId, 'skip'); drawSideSoon(); } }, 'Leave all'));
    ui.rightFoot.prepend(bar);
  }
  const answers = new Set(all.map((w) => w.turnId)).size;
  setText(bar.querySelector('.waitcount'), `${plural(all.length, 'change')} waiting${answers > 1 ? ` from ${plural(answers, 'answer')}` : ''}${can.length < all.length ? ` — ${all.length - can.length} can’t be made now` : ''}`);
  bar.querySelector('[data-apply-all]').disabled = !can.length;
  bar.querySelector('[data-apply-all]').textContent = can.length && can.length < all.length ? `Apply all ${can.length}` : 'Apply all';
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
function showing(kind, id) { return sideVisible() && (kind === 'talk' ? P.side === 'partner' && id === P.novelId : P.side === 'play' && P.playId === id); }

/* what the pane shows of a conversation, as one string: a reply this window
 * is writing shows its words from the stream, so its own checkpoints of them
 * leave it the same — it is not drawn again for them */
const writingHere = (v) => v.streaming && v.tab === store.CLIENT;
function turnsSig(rec) {
  if (!rec) return [];
  const kind = rec.who !== undefined ? 'play' : 'talk';
  const turns = rec.turns || [];
  /* The saved requests and unselected takes can be much larger than the talk
   * on screen. Neither is redrawn when a streaming checkpoint arrives. */
  return [rec.convId, rec.name, rec.named, rec.who, rec.from, rec.chapterId, rec.after, rec.turned,
    ...turns.flatMap((t, i) => turnSignature(t, i === turns.length - 1, kind, rec.id))];
}
function rememberDrawn(kind, id, record) { P.drawn = { key: kind + ':' + id, signature: turnsSig(record) }; }
function drawnAlready(kind, id) { return P.drawn?.key === kind + ':' + id && sameSignature(P.drawn.signature, turnsSig(store.peek(kind, id))); }

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
const sideLive = new Map();   /* kind/record/turn -> newest event not yet painted */
const sidePaint = paced(paintSide);
function onTalkLive(ev) {
  const map = ev.kind === 'talk' ? partnerLive : playLive;
  const key = turnKey(ev.kind, ev.id, ev.turnId);
  if (ev.done) {
    map.delete(key);
    sideLive.delete(key);
    if (showing(ev.kind, ev.id)) { drawSide(); if (P.liveTurn === ev.turnId) P.liveTurn = null; }
    return;
  }
  map.set(key, { text: ev.text, thinking: ev.thinking, note: ev.note || '' });
  sideLive.set(key, ev);
  sidePaint.ask();
}
function paintSide() {
  let redraw = false;
  let painted = false;
  for (const [key, ev] of sideLive) {
    if (!showing(ev.kind, ev.id)) continue;
    const turnId = ev.turnId;
    const turnEl = ui.rightBody.querySelector(`.turn[data-id="${turnId}"]`);
    /* the reply's own words — never the thinking box's, which sits inside the box */
    const el = turnEl && turnEl.querySelector(':scope > .words');
    if (!el) { redraw = true; continue; }
    P.liveTurn = turnId;
    const entry = (ev.kind === 'talk' ? partnerLive : playLive).get(key) || { text: ev.text, thinking: ev.thinking, note: ev.note || '' };
    const box = turnEl.querySelector(':scope > .thinkbox');
    if (ev.thinking) {
      if (box) updateThinkBox(box, ev.thinking, { live: !ev.text });
      else turnEl.insertBefore(turnThinkBox(key, ev.thinking, !ev.text), el);
    } else if (!ev.text && box) {
      /* a new round (it is reading a chapter): the last round's thinking goes */
      box.remove();
    }
    const words = shownWords(ev.kind, { by: 'ai' }, ev.text || '', entry);
    if (el.classList.contains('tprose')) growProse(el, words, { tint: true, names: P.side === 'play' ? pageNames(P.novelId) : null }); else streamLines(el, words);
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
  const playId = P.playId;
  const current = () => gen === sideGen && sideVisible() && P.novelId === n.id && P.side === 'play' && P.playId === playId;
  await store.open('draft', n.id).catch(() => null);
  if (!current()) return;
  if (playId) {
    const p = store.peek('play', playId) ?? await store.open('play', playId).catch(() => null);
    if (!current()) return;
    if (!p) { P.playId = null; return drawPlay(); }
    /* its prose taken out of the book since: "written into the book up to here" lets go */
    if (talk.mendScene(p.id)) return drawOnePlay(store.peek('play', p.id));
    return drawOnePlay(p);
  }
  const plays = [];
  for (const id of n.plays || []) {
    const p = store.peek('play', id) ?? await store.open('play', id).catch(() => null);
    if (!current()) return;
    if (p) plays.push(p);
  }
  plays.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const intro = ui.rightBody.querySelector('.scene-intro') || h('div.pane-intro.scene-intro', h('p.pane-kicker', 'Try another way in'), h('h2', 'Step into your story'),
    h('p', 'Be one of its people. You write what they say and do; the narrator brings the world around them to life.'),
    h('details.pane-guide', h('summary', 'From a scene to the page'), h('p', 'When a scene goes somewhere good, Turn it into prose writes what happened into the chapter. Your scenes stay here to return to.')));
  const children = [intro];
  if (plays.length) {
    children.push(ui.rightBody.querySelector('.scene-list-title') || h('h3.pane-section-title.scene-list-title', 'Return to a scene'));
    const list = ui.rightBody.querySelector('.plays') || h('ul.plays');
    const old = new Map([...list.children].map(el => [el.dataset.id, el]));
    const items = plays.map(p => {
      const c = store.peek('chapter', p.chapterId);
      const label = `${p.who || 'Someone'}${p.from ? ` — ${p.from.slice(0, 50)}` : ''}`;
      const detail = `${c ? chapterLabel(n, c, { withName: false }) : 'a chapter'} · ${plural((p.turns || []).length, 'turn')} · ${timeAgo(p.updated)}`;
      const el = old.get(p.id) || h('li', { 'data-id': p.id }, h('button', { onclick: () => { P.playId = p.id; drawSide(); } }, h('b'), h('small')));
      setText(el.querySelector('b'), label); setText(el.querySelector('small'), detail);
      return el;
    });
    keepChildren(list, items);
    children.push(list);
  }
  children.push(sceneStartForm(n));
  keepChildren(ui.rightBody, children);
  ui.rightFoot.hidden = true;
}

/* A keyboard resize is not a new form. The same fields keep focus and their
 * selection; the existing draft journal also keeps them across reloads. */
function sceneStartForm(n) {
  const key = `setup:${n.id}`;
  let form = ui.rightBody.querySelector('.scene-start');
  if (!form) {
    const saved = composerOf(key, n.id);
    composerBooks.set(key, n.id);
    const who = h('input', { type: 'text', placeholder: 'Their name', list: 'cn-people', value: saved.value || '' });
    const from = h('input', { type: 'text', placeholder: 'Right where the chapter leaves off', value: saved.tell || '' });
    const save = () => keepComposer(n.id, key, { value: who.value, tell: from.value });
    who.addEventListener('input', save); from.addEventListener('input', save);
    const begin = h('button.btn.primary', { onclick: async () => {
      const name = who.value.trim();
      if (!name) { toast('Say who you play.'); who.focus(); return; }
      if (begin.disabled) return;
      const chapterId = P.chapterId;
      const before = { value: who.value, tell: from.value };
      begin.disabled = true;
      try {
        const id = await talk.newPlay({ novelId: n.id, chapterId, who: name, from: from.value.trim() });
        if (who.value === before.value && from.value === before.tell) {
          who.value = ''; from.value = ''; save();
        }
        if (P.novelId === n.id && P.chapterId === chapterId && P.side === 'play' && !P.playId && sideVisible()) {
          P.playId = id;
          drawSide();
        }
        const out = await talk.playSay({ playId: id, text: '' });
        const away = elsewhere(n.id, id);
        if (out && !out.ok && out.error) toast(`The narrator${away ? ` of your scene${away}` : ''} did not answer: ${out.error}`, 6000);
      } catch (error) { toast(`The scene could not begin: ${error.message || error}`, 6000); }
      finally { begin.disabled = false; }
    } }, 'Begin the scene');
    form = h('div.group.scene-start', h('div.gbody', h('h3.pane-section-title', 'Begin somewhere new'),
      field('Who do you play?', who), h('datalist', { id: 'cn-people' }),
      field('Where does it start?', from, 'Leave it empty to pick up right where the chapter stands now.'), h('div.btnrow', begin)));
  }
  const people = (n.notes?.people || []).map(p => p.name);
  const signature = JSON.stringify(people);
  if (form._people !== signature) {
    form._people = signature;
    form.querySelector('datalist').replaceChildren(...people.map(name => h('option', { value: name })));
    form.querySelector('input').placeholder = people[0] || 'Their name';
  }
  return form;
}

let sideFrame = 0;
function drawSideSoon() { if (!sideFrame) sideFrame = requestAnimationFrame(() => { sideFrame = 0; drawSide(); }); }

function drawOnePlay(p) {
  const n = store.peek('novel', P.novelId);
  talk.repairStaleTurns('play', p.id);
  if (!P.offs['play:' + p.id]) { P.offs.push(store.subscribe('play', p.id, () => { if (P.side === 'play' && P.playId === p.id && !drawnAlready('play', p.id)) drawSideSoon(); })); P.offs['play:' + p.id] = true; }
  const c = store.peek('chapter', p.chapterId);
  const full = fullKind() === 'scene';
  const previousHead = ui.rightBody.querySelector('.scenehead');
  const headingSignature = JSON.stringify([p.id, p.who, c && chapterLabel(n, c, { withName: false }), full]);
  const head = previousHead?._headingSignature === headingSignature ? previousHead : h('div.scenehead',
    h('button.icon', { 'aria-label': 'All scenes', onclick: () => { P.playId = null; drawSide(); } }, icon('back', 20)),
    h('div', { style: { flex: '1', minWidth: '0' } }, h('b', { style: { font: '600 18px/1.2 var(--display)' } }, `You play ${p.who}`), h('div', { style: { fontSize: '12.5px', color: 'var(--chrome-soft)' } }, c ? `From ${chapterLabel(n, c, { withName: false })}` : '')),
    h('button.icon', { 'aria-label': full ? 'Leave full screen' : 'Full screen', title: full ? 'Leave full screen' : 'Full screen', onclick: () => sceneFull() }, icon(full ? 'shrink' : 'expand', 18)),
    h('button.icon', { 'aria-label': 'More for this scene', onclick: (e) => menu(e.currentTarget, [
      { label: 'Turn it all into prose (from the start)', hint: 'The whole scene written into the chapter, not just what is new since last time.', run: () => toProse(store.peek('play', p.id) || p, true) },
      { label: 'The scene so far, in short', hint: 'What rides for its earliest turns once the scene is longer than the narrator holds, and what the helper’s check made of it.', run: () => sceneShortSheet(p.id) },
      { label: 'Remove this scene', hint: 'To Recently deleted; prose already written from it stays.', danger: true, run: async () => {
        if (!(await confirmIt('Remove this scene?', 'It goes to Recently deleted (Settings → Backups) for thirty days. Anything already turned into prose stays in the book.', 'Remove it', { danger: true }))) return;
        talk.stopTalk('play', p.id);
        try { await store.remove('play', p.id); }
        catch (_) { toast('The scene could not be removed. Try again in a moment.', 6000); return; }
        if (store.peek('novel', p.novelId)) store.change('novel', p.novelId, novelSteps.removePlay(p.id), { now: true });
        if (P.novelId === p.novelId && P.playId === p.id) { P.playId = null; drawSide(); }
      } },
    ]) }, icon('more', 18)));
  head._headingSignature = headingSignature;
  let box = ui.rightBody.querySelector('.talk');
  if (box?.dataset.play !== p.id) box = h('div.talk', { 'data-play': p.id });
  const turns = p.turns || [];
  const extras = [];
  const working = talk.talkBusy('play', p.id);
  /* the ways it could go, offered after the narrator's last part: a tap plays one */
  const last = turns[turns.length - 1];
  const lv = last && last.by !== 'you' ? picked(last) : null;
  const offered = lv && !lv.streaming && !working ? choicesIn(lv.text) : [];
  if (offered.length) {
    /* a way chosen is his move — with his line to the narrator, when its box is open */
    extras.push(h('div.choices', { role: 'group', 'aria-label': 'Three ways it could go' }, h('p.choice-heading', 'Where will you take it?'),
      ...offered.map((c) => h('button.choice', { onclick: () => {
        const tb = ui.rightFoot.querySelector('textarea.tellbox');
        const tell = tb && !tb.hidden ? tb.value.trim() : '';
        const sent = beginComposerSend('play:' + p.id, { value: false, tell: Boolean(tell) });
        playMove(p, c, tell, sent);
      } }, c))));
  } else if ((store.peek('house', 'house') || {}).sceneChoices && lv && !lv.streaming && !working && sceneWords(String(lv.text || '')).trim()) {
    /* Three choices on, and none came with the newest part (told before they were on, or left out): said, with the way to ask
     * again — never an empty row (Cozy Tavern m752-018/019) */
    extras.push(box.querySelector('.nochoices') || h('p.hint.nochoices', 'No choices came with this part — Another answer, on it, tells it again with them.'));
  }
  updateTurns(box, 'play', p.id, turns, { turned: p.turned, extras });
  keepChildren(ui.rightBody, [head, box]);
  const converted = p.turned ? turns.findIndex(t => t.id === p.turned) : -1;
  const fresh = turns.some((t, i) => i > converted && t.by !== 'you' && sceneWords(String(picked(t)?.text || '')).trim());
  if (ui.rightFoot.dataset.for === 'play:' + p.id && ui.rightFoot.querySelector('textarea')) {
    refreshComposer('play:' + p.id, p.novelId);
    const ta = ui.rightFoot.querySelector('textarea');
    ta.placeholder = `What does ${p.who} say or do?`;
    ta.setAttribute('aria-label', `What ${p.who} says or does`);
    ui.rightFoot.querySelector('textarea.tellbox').placeholder = `Tell the narrator — not ${p.who}’s words (bring someone in, the storm gets worse…)`;
    const send = ui.rightFoot.querySelector('[data-composer-send]');
    const label = working ? 'Stop' : 'Send';
    if (send.textContent !== label) send.textContent = label;
    ui.rightFoot.querySelector('[data-to-prose]').disabled = working || !fresh || (writer.busy(P.novelId) && !writer.autoBusy(P.novelId));
    ui.rightFoot.querySelector('[data-scene-choices]').setAttribute('aria-pressed', String(Boolean((store.peek('house', 'house') || {}).sceneChoices)));
    rememberDrawn('play', p.id, p);
    placeSide();
    return;
  }
  ui.rightFoot.textContent = '';
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
  const choicesBtn = h('button.chip.toggle', { 'data-scene-choices': '', 'aria-pressed': String(Boolean(house.sceneChoices)), title: 'After each part, the narrator offers three things you could do next', onclick: () => {
    const on = !(store.peek('house', 'house') || {}).sceneChoices;
    store.change('house', 'house', (x) => { if (on) x.sceneChoices = true; else delete x.sceneChoices; }, { now: true });
    choicesBtn.setAttribute('aria-pressed', String(on));
    toast(on ? 'After each part, the narrator offers three ways it could go.' : 'No more choices offered.');
    /* the line under the newest part follows the switch */
    drawSide();
  } }, 'Three choices');
  const send = h('button.btn.primary.small', { 'data-composer-send': '', onclick: async () => {
    if (talk.talkBusy('play', p.id)) { talk.stopTalk('play', p.id); return; }
    const text = ta.value.trim();
    const tell = tellBox.hidden ? '' : tellBox.value.trim();
    const sent = beginComposerSend('play:' + p.id, { tell: Boolean(tell) });
    await playMove(p, text, tell, sent);
  } }, working ? 'Stop' : 'Send');
  ui.rightFoot.hidden = false;
  ui.rightFoot.append(ta, tellBox, h('div.crow.wrap',
    h('button.btn.small', { 'data-to-prose': '', disabled: working || !fresh || (writer.busy(P.novelId) && !writer.autoBusy(P.novelId)), onclick: () => toProse(store.peek('play', p.id) || p, false), title: 'Write what happened into the chapter as prose' }, 'Turn it into prose'),
    tellBtn, choicesBtn,
    h('span.grow'), send));
  for (const box2 of [ta, tellBox]) {
    box2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
    box2.addEventListener('input', keepTyped);
  }
  autoGrow(ta, 0.3);
  autoGrow(tellBox, 0.2);
  restoreTyped('play:' + p.id);
  rememberDrawn('play', p.id, p);
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
