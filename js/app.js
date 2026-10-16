/* Cozy Novel — js/app.js — the front door: what opens, what the bars do, and
 * the care that runs underneath (saving, live changes from other windows,
 * updates landing by themselves). */

import * as store from './store.js';
import * as writer from './novel/writer.js';
import * as archivist from './novel/archivist.js';
import { onLearn, onKey, onIdentity } from './model/call.js';
import { h, $, icon, toast, menu, closeMenu, closeAllSheets, afterBacks, onBack, dropOverlays, setText } from './ui/dom.js';
import { enterFull, leaveFull, fullKind, holdFull } from './ui/full.js';
import { initShelf, refresh as refreshShelf } from './ui/shelf.js';
import { initDesk, openChapter, drawComposer, deskState, draftWaiting, draftNow, saveDeskForBranch, showFound, whenOpen } from './ui/desk.js';
import { initPanes, openPanes, toggleLeft, showSide, closeLeft, closeRight, unsentWords, saveComposersForBranch, showTurn, showCard } from './ui/panes.js';
import { openSettings, redrawSettings, freshenPresets } from './ui/settings.js';
import { openBook } from './ui/book.js';
import { applyLook, DEFAULT_LOOK, resolveLook, mergeLook } from './ui/look.js';
import { bringOldBooks } from './legacy.js';
import { DEFAULT_WRITING, DEFAULT_NARRATOR, DEFAULT_PARTNER, startingIsOld, freshStarting, narratorCarryDue, carryNarrator, lateSplitDue, splitLate } from './novel/prompts.js';
import { chapterLabel, novelSteps } from './novel/shape.js';
import { plural, numberWords } from './util.js';
import { anyTalking, repairStaleTurns as talkRepair } from './novel/talk.js';
import { startChecking, busyAny as checkingAny, keepGrades } from './novel/checker.js';
import { initChecks, showChecks } from './ui/checks.js';
import { initSearch, openSearch } from './ui/search.js';
import { initBibliography } from './ui/bibliography.js';
import { mendBook } from './novel/mend.js';
import { initBranches, openBranches } from './ui/branches.js';
import { openConversation } from './novel/talk.js';

const A = { novelId: null, chapterId: null, booting: true, updateWaiting: false, fromShelf: false, reading: null, route: 0, then: null };

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
      duelsFrom: Date.now(),
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
  /* the judge reads two writers' takes head to head from now on — takes written before are never sent unasked */
  if (!Number.isFinite(house.duelsFrom)) store.change('house', 'house', (x) => { if (!Number.isFinite(x.duelsFrom)) x.duelsFrom = Date.now(); }, { now: true });
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
  /* what the provider said its model is (its room, the weights behind an alias, its thinking levels): kept on the connection */
  onIdentity((id, patch) => store.change('house', 'house', (hs) => {
    const c = (hs.connections || []).find((x) => x.id === id);
    if (!c) return;
    /* only while the connection is still that model at that address */
    if (patch.identTriedFor && patch.identTriedFor !== `${c.model || ''}@${c.url || ''}`) return;
    for (const [f, v] of Object.entries(patch)) { if (v === undefined) delete c[f]; else c[f] = v; }
  }));
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
  /* each move owns the screen: a book still opening when he has moved on
   * (Back on a slow phone) stands down, never drawn over where he is now */
  const token = ++A.route;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'n' && parts[1]) return showNovel(parts[1], parts[2] || null, token);
  return showShelf();
}

async function showShelf() {
  closeMenu();
  closeAllSheets();
  closeLeft(); closeRight();
  exitReading();
  A.novelId = null; A.chapterId = null;
  showChecks(null, null);
  /* what was to be done in a book he did not stay to see is not done in the next one */
  A.then = null;
  if (A.offBook) { A.offBook(); A.offBook = null; }
  document.body.classList.add('shelfview');
  $('#desk').hidden = true;
  $('#shelf').hidden = false;
  document.title = 'Cozy Novel';
  await refreshShelf();
}

async function showNovel(novelId, chapterId, token = A.route) {
  const moved = () => token !== A.route;
  let novel;
  try { novel = await store.open('novel', novelId); } catch (_) { if (!moved()) banner(true); return; }
  if (moved()) return;
  if (!novel) { toast('That book is not on the shelf any more.'); go('#/'); return; }
  /* every chapter of the book, so the writer can read the whole of it */
  await Promise.all((novel.order || []).map((id) => store.open('chapter', id).catch(() => null)));
  if (moved()) return;
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
  if (moved()) return;
  await openChapter(novelId, chapterId);
  if (moved()) return;
  openPanes(novelId, chapterId);
  showChecks(novelId, chapterId);
  drawBar();
  document.title = `${novel.meta.title} — Cozy Novel`;
  /* a page or a reply left being written by a window that closed is set right */
  repairNow(novelId);
  /* pages kept before a repair to how a page is made whole: mended once, what came off kept with each (mend.js) */
  mendBook(novelId).then(({ pages, tellings }) => {
    const what = [pages ? plural(pages, 'page') : '', tellings ? `${plural(tellings, 'telling')} of a scene` : ''].filter(Boolean).join(' and ');
    if (what) toast(`${what} kept from before ${pages + tellings === 1 ? 'was' : 'were'} made whole the way new ones are — anything taken off is kept with ${pages + tellings === 1 ? 'it' : 'each'} (⋯ → Put back).`, 8000);
  }).catch((e) => console.warn(e));
  /* notes kept before the auditor are checked against the book, once, by themselves */
  archivist.firstCheck(novelId);
  /* the helper looks over what it has not read yet */
  archivist.nudge(novelId, 2500);
  /* opened to show something in it (a search found it in another book) — only in the book it was for */
  if (A.then && A.then.novelId === novelId) { const fn = A.then.run; A.then = null; try { fn(); } catch (e) { console.error(e); } }
}

/* another book, at a chapter, then one thing to do there — no step in the history */
async function goBook(novelId, chapterId = null, then = null) {
  A.then = then ? { novelId, run: then } : null;
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
    /* a grade a fix lost before 2.6.3, put back from the version it was made from */
    keepGrades(novelId);
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
  initBranches({
    where: () => `${A.route}:${location.hash}`,
    chapter: novelId => A.novelId === novelId ? A.chapterId : null,
    prepare: async novelId => { await saveDeskForBranch(novelId); await saveComposersForBranch(novelId); },
    open: async (novelId, chapterId = null, target = {}) => {
      const startingRoute = A.route;
      const startingHash = location.hash;
      const point = target.source;
      /* A source conversation may since have been put aside; open its own
       * words before showing the source answer. */
      if (point?.conversationId) {
        await store.open('novel', novelId);
        const conversation = await store.open('talk', novelId);
        if (conversation?.convId !== point.conversationId) {
          const out = await openConversation(novelId, point.conversationId);
          if (!out.ok) throw new Error(out.error || 'The conversation could not be opened.');
        }
      }
      if (A.route !== startingRoute || location.hash !== startingHash) return;
      A.then = { novelId, run: () => {
        if (point?.playId) showTurn('play', point.playId, point.turnId);
        else if (point?.conversationTurnId) showTurn('talk', novelId, point.conversationTurnId);
        else if (point?.through && point.through !== '^') showFound(point.through);
        else if (target.playId) showTurn('play', target.playId);
        else if (target.conversationId) showTurn('talk', novelId);
      } };
      A.fromShelf = false;
      await go(`#/n/${novelId}${chapterId ? `/${chapterId}` : ''}`);
    },
  });
  initShelf({ root: $('#shelf'), books: $('#books'), search: $('#search'), foot: $('#shelfFoot') }, { openNovel });
  $('#shelfSettings').addEventListener('click', () => openSettings());
  const changeRoom = (patch) => {
    store.change('house', 'house', (h) => { h.look = mergeLook(h.look, patch); }, { now: true });
    applyLook(store.peek('house', 'house')?.look);
  };
  $('#worldAcademy').addEventListener('click', () => changeRoom({ theme: 'academy' }));
  $('#worldTokyo').addEventListener('click', () => changeRoom({ theme: 'tokyo' }));
  $('#worldStudy').addEventListener('click', () => changeRoom({ theme: 'study' }));
  $('#modeToggle').addEventListener('click', () => changeRoom({ mode: resolveLook(store.peek('house', 'house')?.look).mode === 'dark' ? 'light' : 'dark' }));
  $('#motionToggle').addEventListener('click', () => changeRoom({ motion: resolveLook(store.peek('house', 'house')?.look).motion === 'on' ? 'off' : 'on' }));
  initDesk({
    wrap: $('#pageWrap'), passages: $('#passages'), end: $('#pageEnd'), chapnum: $('#chapnum'), chapname: $('#chapname'), chapterhead: document.querySelector('.chapterhead'),
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
  $('#notesBtn').addEventListener('click', () => showSide('notes', { soon: true }));
  /* his length goal, a quarter at a time */
  writer.onMilestone(({ reached, words, goal }) => {
    const said = ['', 'A quarter of the way', 'Halfway there', 'Three quarters of the way', 'You reached your goal'][reached];
    if (said) toast(`${said} — ${words.toLocaleString()} of ${goal.toLocaleString()} words.${reached === 4 ? ' The ending is yours to write.' : ''}`, 6000);
  });
  $('#searchBtn').addEventListener('click', () => openSearch());
  initChecks($('#checkBubble'), { openSettings });
  initSearch({ currentNovel: () => A.novelId, goChapter, goBook, openBook: (id) => openBook(id, { onGone: () => toShelf() }) });
  /* the bibliography's cards go where the rest of the book goes: a passage, a card of the notes, every place a name stands */
  initBibliography({ closeSide: () => closeRight(), showCard, whenOpen, openSearch: (query) => openSearch({ query }) });
  $('#partnerBtn').addEventListener('click', () => showSide('partner', { soon: true }));
  $('#moreBtn').addEventListener('click', (e) => moreMenu(e.currentTarget));
  /* a phone puts a hidden page away without warning: what waits is saved now */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { store.flushOnHide(); store.quiet(); }
    else store.recheck();
  });
  window.addEventListener('pagehide', () => { draftNow(); store.flushOnHide(); store.letLeasesGo(); store.quiet(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) store.recheck(); });
  window.addEventListener('beforeunload', (e) => {
    if (writer.anyRunning() || anyTalking()) { e.preventDefault(); e.returnValue = ''; }
  });
  store.onStatus((s) => banner(s.offline));
  store.onUpdate(() => { A.updateWaiting = true; reloadWhenQuiet(); });
  store.onReload(() => { toast('A copy was brought back — showing it now.'); setTimeout(() => location.reload(), 500); });
}

export function drawBar() {
  const n = store.peek('novel', A.novelId);
  const c = store.peek('chapter', A.chapterId);
  if (!n || !c) return;
  setText($('#bookTitle b'), n.meta.title || 'Untitled');
  const title = n.branch?.name ? `${n.meta.title || 'Untitled'} — ${n.branch.name}` : 'Chapters';
  if ($('#bookTitle').title !== title) $('#bookTitle').title = title;
  const num = n.order.indexOf(c.id) + 1;
  setText($('#chapLine'), `${n.branch?.name ? `${n.branch.name} · ` : ''}Chapter ${numberWords(num)}${c.name ? ` — ${c.name}` : ''}`);
}

function writerMenu(anchor) {
  const hs = store.peek('house', 'house') || {};
  const conns = [...(hs.connections || [])].sort((a, b) => writer.connName(a).localeCompare(writer.connName(b)));
  const cur = (hs.roles || {}).writer;
  menu(anchor, [
    { label: 'The writer', header: true },
    ...conns.map((c) => {
      /* what tapping it does, and what goes with it (Who does what: the parts set to follow the writer) */
      const follow = writer.partsWords(writer.followersOf(hs));
      const others = writer.partsWords(writer.partsOf(hs, c.id).filter((r) => r !== 'writer'));
      const hint = c.id === cur
        ? `Writes the pages and narrates your scenes now${follow ? `, with ${follow} beside it` : ''}.`
        : `Writes the pages and narrates your scenes from now on${follow ? ` — ${follow} ${writer.followersOf(hs).length > 1 ? 'go' : 'goes'} with it` : ''}.${others ? ` It is ${others} already.` : ''}`;
      return { label: `${writer.connName(c)}${c.model && c.name ? ` — ${c.model}` : ''}`, hint, checked: c.id === cur, run: () => {
        store.change('house', 'house', (x) => { x.roles = x.roles || {}; x.roles.writer = c.id; }, { now: true });
        drawComposer();
        toast(`${writer.connName(c)} writes now${follow ? `, and is ${follow} too` : ''}.`);
      } };
    }),
    conns.length ? '-' : null,
    { label: conns.length ? 'Connections…' : 'Add a connection…', hint: conns.length ? 'Settings → Connections: add one, or change a key, a model, the dials.' : 'Settings → Connections: pick your provider, paste your key, pick a model.', run: () => openSettings('connections') },
  ]);
}

/* what has no button of its own on the bar */
function moreMenu(anchor) {
  menu(anchor, [
    { label: 'Scenes', hint: 'Step into the story as one of its people; the narrator plays everyone else.', run: () => showSide('play') },
    { label: 'Branches of this story', hint: 'Take another path in a separate book, or return to the original and its branches.', run: () => openBranches(A.novelId) },
    { label: 'About this book', hint: 'What it’s about, how it reads, where it’s headed, Sound, taking it out as a file.', run: () => openBook(A.novelId, { onGone: () => toShelf() }) },
    { label: 'Full screen', hint: 'The page and the box, nothing above them.', run: fullPage },
    { label: 'Reading mode', hint: 'Only the page, for reading.', run: readingMode },
    '-',
    { label: 'Your writing room', hint: 'Academy of Ink, Neon Tokyo or the Original Study, with light and movement your way.', run: () => openSettings('look') },
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
  if (b.hidden === !offline) return;
  if (!offline) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = '';
  b.append('Cozy Novel’s server on the phone is not answering, so nothing can be saved or written just now. Open Termux and run ', h('code', 'cozynovel'), ' — what you typed here waits and is saved the moment it answers.');
}

/* An update to the app lands by itself: the page refreshes once nothing
 * would be lost or cut (Cozy Tavern M720, M332) — no page, answer, scene,
 * Ideas, reading or checking on its way in any book; nothing waiting to be
 * saved (the box's last words too); no sheet open (a card being edited, Edit
 * by hand, a new scene); no words typed and not yet sent — the box beside
 * the page, a rewrite note, his edit of a passage. */
export function quietNow() {
  const typing = document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName) && document.activeElement.value;
  const unsaved = document.querySelector('.editbox') || [...document.querySelectorAll('.rewriterow input')].some((i) => i.value.trim()) || unsentWords();
  const open = document.querySelector('.sheet.on');
  const working = writer.anyRunning() || anyTalking() || archivist.busyAny() || checkingAny() || store.hasPending() || draftWaiting();
  return !(working || unsaved || open || typing);
}
function reloadWhenQuiet() {
  if (!A.updateWaiting) return;
  if (!quietNow()) { setTimeout(reloadWhenQuiet, 4000); return; }
  toast('Cozy Novel was updated — refreshing.');
  setTimeout(() => { if (quietNow()) location.reload(); else reloadWhenQuiet(); }, 800);
}

/* ------------------------------------------------------------- the service worker */
/* It caches nothing: it is there so the app can sit on the home screen, and
 * so the first Cozy Novel's worker (which served old copies) is replaced. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

boot();

export { A as appState, deskState };
