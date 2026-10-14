/* Cozy Novel — js/app.js — the front door: what opens, what the bars do, and
 * the care that runs underneath (saving, live changes from other windows,
 * updates landing by themselves). */

import * as store from './store.js';
import * as writer from './novel/writer.js';
import * as archivist from './novel/archivist.js';
import { onLearn, onKey } from './model/call.js';
import { h, $, icon, toast, menu, closeMenu, closeAllSheets, afterBacks, onBack, dropOverlays } from './ui/dom.js';
import { enterFull, leaveFull, fullKind, holdFull } from './ui/full.js';
import { initShelf, refresh as refreshShelf } from './ui/shelf.js';
import { initDesk, openChapter, drawComposer, deskState } from './ui/desk.js';
import { initPanes, openPanes, toggleLeft, showSide, closeLeft, closeRight } from './ui/panes.js';
import { openSettings, redrawSettings, freshenPresets } from './ui/settings.js';
import { openBook } from './ui/book.js';
import { applyLook, DEFAULT_LOOK } from './ui/look.js';
import { bringOldBooks } from './legacy.js';
import { DEFAULT_WRITING, DEFAULT_NARRATOR, DEFAULT_PARTNER, startingIsOld, freshStarting, narratorCarryDue, carryNarrator, lateSplitDue, splitLate } from './novel/prompts.js';
import { chapterLabel, novelSteps } from './novel/shape.js';
import { plural, numberWords } from './util.js';
import { talkBusy, repairStaleTurns as talkRepair } from './novel/talk.js';
import { startChecking } from './novel/checker.js';
import { initChecks, showChecks } from './ui/checks.js';
import { initSearch, openSearch } from './ui/search.js';

const A = { novelId: null, chapterId: null, booting: true, updateWaiting: false, fromShelf: false, reading: null };

/* ------------------------------------------------------------- boot */

async function boot() {
  /* a reload with a sheet open left its step in the history: it is stepped
   * back over, so the first Back does what it says */
  const st = history.state;
  if (st && Number.isInteger(st.cozy) && st.cozy > 0) {
    await new Promise((resolve) => {
      const done = () => { window.removeEventListener('popstate', done); resolve(); };
      window.addEventListener('popstate', done);
      history.go(-st.cozy);
      setTimeout(done, 600);
    });
  }
  store.listen();
  bindChrome();
  let house = null;
  /* the page waits for the phone as long as it takes; the banner says how to wake it */
  for (;;) {
    try { house = await store.open('house', 'house'); break; }
    catch (_) { banner(true); await new Promise((r) => setTimeout(r, 2000)); }
  }
  banner(false);
  /* work a tab closed by Android left in this browser goes to the phone first */
  try {
    const n = await store.replayJournal();
    if (n) house = await store.open('house', 'house', { fresh: true }) || house;
  } catch (e) { console.warn('the journal waits for the next try', e); }
  if (!house) {
    house = await store.create('house', 'house', {
      connections: [], roles: {}, you: { name: '' },
      instructions: { system: DEFAULT_WRITING, narrator: DEFAULT_NARRATOR, partner: DEFAULT_PARTNER, late: '', lateNarrator: '' },
      look: { ...DEFAULT_LOOK },
      created: Date.now(),
      checksFrom: Date.now(),
      narratorCarried: true,
    });
  }
  /* a box still holding the starting words of before 2.3 — never touched —
   * gets today's: the master novelist, his preset's own opening for the
   * narrator (a box he wrote in keeps his words) */
  if (startingIsOld(house)) store.change('house', 'house', freshStarting, { now: true });
  /* a narrator box he emptied before 2.3 (it read his writing words then)
   * gets his writing words, once */
  if (narratorCarryDue(house)) store.change('house', 'house', carryNarrator, { now: true });
  /* one note at the end for both, before 2.3.2: the scenes keep it in their own box, once */
  if (lateSplitDue(house)) store.change('house', 'house', splitLate, { now: true });
  /* the checker reads what is written from now on; older writing only when he asks */
  if (!Number.isFinite(house.checksFrom)) store.change('house', 'house', (x) => { if (!Number.isFinite(x.checksFrom)) x.checksFrom = Date.now(); }, { now: true });
  startChecking();
  applyLook(house.look);
  /* a change made here is already on screen; one made in another window is drawn */
  store.subscribe('house', 'house', (data, why) => {
    if (data) applyLook(data.look);
    drawComposer(); drawBar();
    if (why === 'remote') redrawSettings(); else freshenPresets();
    /* a helper chosen (or changed) starts on whatever it has not read */
    if (A.novelId) archivist.nudge(A.novelId, 3000);
  });
  /* what a model teaches about itself, and a Hermes key that moved, are kept on the connection */
  onLearn((id, learned) => store.change('house', 'house', (hs) => { const c = (hs.connections || []).find((x) => x.id === id); if (c) c.learned = learned; }));
  onKey((id, key) => store.change('house', 'house', (hs) => { const c = (hs.connections || []).find((x) => x.id === id); if (c) c.key = key; }));
  /* the first Cozy Novel's books come along, once */
  try {
    const n = await bringOldBooks();
    if (n) toast(`${plural(n, 'book')} from the first Cozy Novel ${n === 1 ? 'is' : 'are'} on the shelf.`, 6000);
  } catch (e) { console.warn(e); }
  A.booting = false;
  window.addEventListener('hashchange', route);
  await route();
  if (!(house.connections || []).length) setTimeout(() => toast('Add a connection in Settings to let a writer write with you — your own words need none.', 6500), 900);
}

/* ------------------------------------------------------------- routes */
/* #/                 the shelf
 * #/n/<novel>        a book, at the chapter last open
 * #/n/<novel>/<ch>   a book, at that chapter */
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'n' && parts[1]) return showNovel(parts[1], parts[2] || null);
  return showShelf();
}

async function showShelf() {
  closeMenu();
  closeAllSheets();
  closeLeft(); closeRight();
  exitReading();
  A.novelId = null; A.chapterId = null;
  if (A.offBook) { A.offBook(); A.offBook = null; }
  document.body.classList.add('shelfview');
  $('#desk').hidden = true;
  $('#shelf').hidden = false;
  document.title = 'Cozy Novel';
  await refreshShelf();
}

async function showNovel(novelId, chapterId) {
  let novel;
  try { novel = await store.open('novel', novelId); } catch (_) { banner(true); return; }
  if (!novel) { toast('That book is not on the shelf any more.'); go('#/'); return; }
  /* every chapter of the book, so the writer can read the whole of it */
  await Promise.all((novel.order || []).map((id) => store.open('chapter', id).catch(() => null)));
  if (!chapterId || !novel.order.includes(chapterId)) {
    chapterId = (novel.prefs && novel.order.includes(novel.prefs.at) ? novel.prefs.at : null) || novel.order[novel.order.length - 1];
  }
  if (!chapterId) return;
  if (A.novelId !== novelId) exitReading();
  if (A.novelId !== novelId || !A.offBook) {
    if (A.offBook) A.offBook();
    /* a chapter that joins the book while it is open (made in another window,
     * brought back from Recently deleted) is read in, so the page, the writer
     * and the helper all have the whole book */
    A.offBook = store.subscribe('novel', novelId, (data) => { if (data) openMissing(novelId, data); });
  }
  A.novelId = novelId;
  A.chapterId = chapterId;
  document.body.classList.remove('shelfview');
  $('#shelf').hidden = true;
  $('#desk').hidden = false;
  /* where he is in the book is remembered, without filling the book's earlier copies */
  store.change('novel', novelId, novelSteps.opened(Date.now()), { delay: 3000, checkpoint: true });
  if (!novel.prefs || novel.prefs.at !== chapterId) store.change('novel', novelId, novelSteps.setPref('at', chapterId), { delay: 3000, checkpoint: true });
  if (!store.peek('chapter', chapterId)) await store.open('chapter', chapterId);
  await openChapter(novelId, chapterId);
  openPanes(novelId, chapterId);
  showChecks(novelId, chapterId);
  drawBar();
  document.title = `${novel.meta.title} — Cozy Novel`;
  /* a page or a reply left being written by a window that closed is set right */
  repairNow(novelId);
  /* notes kept before the auditor are checked against the book, once, by themselves */
  archivist.firstCheck(novelId);
  /* the helper looks over what it has not read yet */
  archivist.nudge(novelId, 2500);
  /* opened to show something in it (a search found it in another book) */
  if (A.then) { const fn = A.then; A.then = null; try { fn(); } catch (e) { console.error(e); } }
}

/* another book, at a chapter, then one thing to do there — no step in the history */
async function goBook(novelId, chapterId = null, then = null) {
  A.then = then;
  dropOverlays();
  await afterBacks();
  const hash = `#/n/${novelId}${chapterId ? `/${chapterId}` : ''}`;
  if (location.hash === hash) route(); else location.replace(hash);
}

function openMissing(novelId, novel) {
  for (const id of novel.order || []) {
    if (store.peek('chapter', id) === undefined) store.open('chapter', id).catch(() => {});
  }
}

async function repairNow(novelId) {
  try {
    await writer.repairStale(novelId);
    if (store.peek('talk', novelId)) await talkRepair('talk', novelId);
    for (const id of (store.peek('novel', novelId) || {}).plays || []) if (store.peek('play', id)) await talkRepair('play', id);
  } catch (e) { console.warn(e); }
}
/* and looked at again while the book is open: a writer in another window may stop beating */
setInterval(() => { if (A.novelId && document.visibilityState === 'visible') repairNow(A.novelId); }, 60000);

/* every move to another address goes through here */
export async function go(hash) {
  dropOverlays();
  await afterBacks();
  if (location.hash === hash) return route();
  location.hash = hash;
}
/* Into a book from the shelf is a step forward; the book's ← is the same as
 * the phone's Back, so the shelf is never stacked over itself. */
function openNovel(id) {
  A.fromShelf = true;
  go(`#/n/${id}`);
}
async function toShelf() {
  dropOverlays();
  await afterBacks();
  if (A.fromShelf && /^#\/n\//.test(location.hash)) { A.fromShelf = false; history.back(); return; }
  A.fromShelf = false;
  location.replace('#/');
}
/* chapters are pages of one book, not steps: moving between them takes no step in the history */
export async function goChapter(chapterId) {
  if (!A.novelId) return;
  /* the page full screen goes on in the next chapter */
  const full = fullKind() === 'page';
  holdFull(full);
  try {
    dropOverlays();
    await afterBacks();
    const hash = `#/n/${A.novelId}/${chapterId}`;
    if (location.hash === hash) route(); else location.replace(hash);
    if (full) fullPage();
  } finally { holdFull(false); }
}

/* ------------------------------------------------------------- the bars */

function bindChrome() {
  initShelf({ root: $('#shelf'), books: $('#books'), search: $('#search'), foot: $('#shelfFoot') }, { openNovel });
  $('#shelfSettings').addEventListener('click', () => openSettings());
  initDesk({
    wrap: $('#pageWrap'), passages: $('#passages'), end: $('#pageEnd'), chapnum: $('#chapnum'), chapname: $('#chapname'),
    direction: $('#direction'), writeBtn: $('#writeBtn'), mineBtn: $('#mineBtn'), ideasBtn: $('#ideasBtn'), lengthBtn: $('#lengthBtn'), outcomeBtn: $('#outcomeBtn'), writerBtn: $('#writerBtn'),
    followBtn: $('#followBtn'), selBar: $('#selBar'), selWhat: $('#selWhat'), selClear: $('#selClear'),
  }, {
    goChapter, writerMenu, openSettings, drawBar,
    chapterGone: () => { const n = store.peek('novel', A.novelId); if (n && n.order.length) goChapter(n.order[n.order.length - 1]); else toShelf(); },
  });
  initPanes({
    left: $('#chaptersPane'), leftBody: $('#chaptersBody'), leftTitle: $('#chaptersTitle'),
    right: $('#sidePane'), rightBody: $('#sideBody'), rightFoot: $('#sideFoot'), tabs: $('#sideTabs'),
    scrim: $('#scrim'), light: $('#notesBtn'),
  }, { goChapter });
  $('#toShelf').addEventListener('click', () => toShelf());
  $('#bookTitle').addEventListener('click', () => toggleLeft());
  $('#chaptersClose').addEventListener('click', () => closeLeft());
  $('#sideClose').addEventListener('click', () => closeRight());
  $('#notesBtn').addEventListener('click', () => showSide('notes'));
  $('#searchBtn').addEventListener('click', () => openSearch());
  initChecks($('#checkBubble'), { openSettings });
  initSearch({ currentNovel: () => A.novelId, goChapter, goBook, openBook: (id) => openBook(id, { onGone: () => toShelf() }) });
  $('#partnerBtn').addEventListener('click', () => showSide('partner'));
  $('#moreBtn').addEventListener('click', (e) => moreMenu(e.currentTarget));
  /* a phone puts a hidden page away without warning: what waits is saved now */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { store.flushOnHide(); store.quiet(); }
    else store.recheck();
  });
  window.addEventListener('pagehide', () => { store.flushOnHide(); store.quiet(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) store.recheck(); });
  window.addEventListener('beforeunload', (e) => {
    if (writer.anyRunning()) { e.preventDefault(); e.returnValue = ''; }
  });
  store.onStatus((s) => banner(s.offline));
  store.onUpdate(() => { A.updateWaiting = true; reloadWhenQuiet(); });
  store.onReload(() => { toast('A copy was brought back — showing it now.'); setTimeout(() => location.reload(), 500); });
}

export function drawBar() {
  const n = store.peek('novel', A.novelId);
  const c = store.peek('chapter', A.chapterId);
  if (!n || !c) return;
  $('#bookTitle b').textContent = n.meta.title || 'Untitled';
  const num = n.order.indexOf(c.id) + 1;
  $('#bookTitle small').textContent = `Chapter ${numberWords(num)}${c.name ? ` — ${c.name}` : ''}`;
}

function writerMenu(anchor) {
  const hs = store.peek('house', 'house') || {};
  const conns = [...(hs.connections || [])].sort((a, b) => writer.connName(a).localeCompare(writer.connName(b)));
  const cur = (hs.roles || {}).writer;
  menu(anchor, [
    { label: 'The writer', header: true },
    ...conns.map((c) => ({ label: `${writer.connName(c)}${c.model && c.name ? ` — ${c.model}` : ''}`, checked: c.id === cur, run: () => {
      store.change('house', 'house', (x) => { x.roles = x.roles || {}; x.roles.writer = c.id; }, { now: true });
      drawComposer();
      toast(`${writer.connName(c)} writes now.`);
    } })),
    conns.length ? '-' : null,
    { label: conns.length ? 'Connections…' : 'Add a connection…', run: () => openSettings('connections') },
  ]);
}

/* what has no button of its own on the bar */
function moreMenu(anchor) {
  menu(anchor, [
    { label: 'Scenes', hint: 'Step into the story as one of its people; the narrator plays everyone else.', run: () => showSide('play') },
    { label: 'About this book', hint: 'What it’s about, how it reads, where it’s headed, Sound, taking it out as a file.', run: () => openBook(A.novelId, { onGone: () => toShelf() }) },
    { label: 'Full screen', hint: 'The page and the box, nothing above them.', run: fullPage },
    { label: 'Reading mode', hint: 'Only the page, for reading.', run: readingMode },
    '-',
    { label: 'Settings', hint: 'Connections, who does what, your instructions and presets, how it looks, backups.', run: () => openSettings() },
  ]);
}

/* Full screen: the writing page with nothing above it — the bars at the top
 * go (and the browser's own, where it allows), the page and the box he types
 * in stay. The button in the corner, or Back, brings them back. */
function fullPage() {
  const out = h('button.icon.fullexit', { 'aria-label': 'Leave full screen', title: 'Leave full screen', onclick: () => leaveFull() }, icon('shrink', 20));
  enterFull('page', () => { document.body.classList.add('fullpage'); document.body.append(out); },
    () => { document.body.classList.remove('fullpage'); out.remove(); });
}

/* Reading mode: only the page. The phone's Back (or Escape, or Back to
 * writing) brings the bars back; leaving the book leaves it too. */
function readingMode() {
  if (A.reading) return;
  document.body.classList.add('reading');
  const out = h('button.btn.small.readexit', { onclick: () => exitReading() }, 'Back to writing');
  document.body.append(out);
  A.reading = { out, release: onBack(() => exitReading(true)) };
}
function exitReading(fromBack = false) {
  const r = A.reading;
  if (!r) return;
  A.reading = null;
  document.body.classList.remove('reading');
  r.out.remove();
  if (!fromBack && r.release) r.release();
}

/* ------------------------------------------------------------- notices */

function banner(offline) {
  const b = $('#banner');
  if (!offline) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = '';
  b.append('Cozy Novel’s server on the phone is not answering, so nothing can be saved or written just now. Open Termux and run ', h('code', 'cozynovel'), ' — what you typed here waits and is saved the moment it answers.');
}

/* An update to the app lands by itself: the page refreshes once nothing is
 * being written and he is not typing. */
function reloadWhenQuiet() {
  if (!A.updateWaiting) return;
  const typing = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) && document.activeElement.value;
  const busy = writer.anyRunning() || store.hasPending() || (A.novelId && talkBusy('talk', A.novelId)) || document.querySelector('.editbox');
  if (busy || typing) { setTimeout(reloadWhenQuiet, 4000); return; }
  toast('Cozy Novel was updated — refreshing.');
  setTimeout(() => location.reload(), 800);
}

/* ------------------------------------------------------------- the service worker */
/* It caches nothing: it is there so the app can sit on the home screen, and
 * so the first Cozy Novel's worker (which served old copies) is replaced. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

boot();

export { A as appState, deskState };
