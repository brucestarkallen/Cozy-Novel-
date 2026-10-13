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
import { wordsOf, changesComing } from '../novel/changes.js';
import { enterFull, leaveFull, fullKind } from './full.js';
import * as desk from './desk.js';

let ui = null;
let hooks = {};
const P = { novelId: null, chapterId: null, side: 'notes', playId: null, offs: [], watched: new Set(), leftOpen: false, rightOpen: false, release: { left: null, right: null } };

export function initPanes(elements, appHooks) {
  ui = elements;
  hooks = appHooks;
  ui.scrim.addEventListener('click', () => { closeLeft(); closeRight(); });
  for (const b of ui.tabs.querySelectorAll('button')) b.addEventListener('click', () => { P.side = b.dataset.tab; drawSide(); });
  archivist.onLight((novelId) => { if (novelId === P.novelId) { drawLight(); if (P.side === 'notes') drawSide(); } });
  talk.onTalkLive(onTalkLive);
  talk.onTalkJob(() => { if (P.side === 'partner' || P.side === 'play') drawSide(); });
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
export function closeRight(fromBack = false) {
  if (!P.rightOpen) return;
  if (fullKind() === 'scene') leaveFull();
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
    { label: 'Name it', run: async () => {
      const name = await askText('Name the chapter', { value: (c && c.name) || '', placeholder: 'A short name', yes: 'Name it' });
      if (name === null) return;
      /* cleared by him: it stays without a name (the helper does not name it again) */
      store.change('chapter', id, chapterSteps.setName(name.trim().slice(0, 120), 'you'), { now: true });
    } },
    i > 0 ? { label: 'Move it earlier', run: () => { store.change('novel', P.novelId, novelSteps.moveChapter(id, i - 1), { now: true }); } } : null,
    i < n.order.length - 1 ? { label: 'Move it later', run: () => { store.change('novel', P.novelId, novelSteps.moveChapter(id, i + 1), { now: true }); } } : null,
    { label: 'Earlier copies of this chapter', run: () => earlierCopies(id) },
    c && c.summary && c.summary.text ? { label: 'Its summary', run: () => { const s = openSheet(chapterLabel(n, c)); s.body.append(h('p', { style: { lineHeight: '1.6', whiteSpace: 'pre-wrap' } }, c.summary.text)); } } : null,
    '-',
    n.order.length > 1 ? { label: 'Remove the chapter', danger: true, run: () => removeChapter(id) } : null,
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
  typed.key = ui.rightFoot.dataset.for || '';
  typed.value = ta.value;
  typed.focus = document.activeElement === ta;
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
  keepTyped();
  /* the notes drawn again (the helper read something) stay where he had scrolled them */
  const scroll = ui.right.dataset.tab === P.side && P.side === 'notes' ? ui.rightBody.scrollTop : 0;
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
  if (u && ((Array.isArray(u.cards) ? u.cards.length : u.notes) || (u.kept && Object.keys(u.kept).length))) row.append(h('button.btn.small', { onclick: () => { if (archivist.undoLast(P.novelId)) toast('What that reading changed is put back — anything you edited since stays as you left it.'); drawSide(); } }, 'Undo the last reading'));
  row.append(h('button.btn.quiet.small', { onclick: async () => {
    if (!(await confirmIt('Read the whole book again?', 'The helper reads every chapter from the start and writes the notes and summaries afresh — and, for a book set to Automatic, What it’s about and How it reads (never your own words, nor a correction of yours). What is there now can be put back with Undo.', 'Read it again'))) return;
    archivist.readAgain(P.novelId);
    drawSide();
  } }, 'Read the whole book again'));
  card.append(row);
  if (u && u.changed && u.changed.length && (Date.now() - u.at) < 30 * 60 * 1000) {
    card.append(h('div', { style: { marginTop: '8px', fontSize: '12.5px' } }, `Last reading (${u.label}, ${timeAgo(u.at)}): ` + u.changed.slice(0, 8).map((c) => `${c.how === 'new' ? 'new' : c.how === 'gone' ? 'took out' : 'updated'} ${c.name}`).join(', ') + (u.changed.length > 8 ? '…' : '')));
  }
  ui.rightBody.append(card);
  const fresh = new Set((u && u.changed || []).map((c) => c.kind + ':' + nameKey(c.name)));
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
      box.append(h('div.card' + (fresh.has(kind + ':' + nameKey(c.name)) ? '.fresh' : '') + (kind === 'threads' && c.open === false ? '.closed' : ''), { onclick: () => editCard(kind, c.id) },
        h('div.nm', c.name + (kind === 'threads' && c.open === false ? ' — closed' : '')),
        c.aka && c.aka.length ? h('div.aka', 'also ' + c.aka.join(', ')) : null,
        c.about ? h('div.ab', c.about) : null,
        kind === 'people' && c.ties ? h('div.nw.ties', h('b', 'With others'), c.ties) : null,
        kind === 'people' && c.now ? h('div.nw', h('b', 'Now'), c.now) : null));
    }
    box.append(h('button.btn.quiet.small', { onclick: () => editCard(kind, null) }, icon('plus', 14), 'Add'));
    sec.append(head, box);
    ui.rightBody.append(sec);
  }
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
  if (!P.offs.talkSub) { P.offs.push(store.subscribe('talk', novelId, () => { if (P.side === 'partner') drawPartnerSoon(); })); P.offs.talkSub = true; }
  ui.rightBody.textContent = '';
  const box = h('div.talk');
  const turns = (t && t.turns) || [];
  if (!turns.length) box.append(h('p.hint', `Talk the book over — a stuck scene, what someone would really do, where it could go next. Your partner knows the whole book and the notes, and when you ask, it makes the change itself: a passage (by its number on the page, like “Chapter Two, passage 3”), a chapter’s name, what the book is about, a card in the notes. Every change shows here with its Undo.`));
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
  ui.rightFoot.append(ta, h('div.crow', turns.length ? h('button.btn.quiet.small', { onclick: clearTalk }, 'Start over') : null, h('span.grow'), send));
  autoGrow(ta, 0.3);
  restoreTyped('talk:' + novelId);
  ui.rightBody.scrollTop = 1e9;
}
function drawPartnerSoon() { if (!partnerFrame) partnerFrame = requestAnimationFrame(() => { partnerFrame = 0; if (P.side === 'partner') drawPartner(); }); }

function giveBack(key, words) {
  const ta = ui.rightFoot.querySelector('textarea');
  if (ta && ui.rightFoot.dataset.for === key && !ta.value.trim()) { ta.value = words; ta.dispatchEvent(new Event('input')); return; }
  if (typed.key === key && !typed.value) typed.value = words;
}

async function clearTalk() {
  if (!(await confirmIt('Start the conversation over?', 'This conversation goes to Recently deleted (Settings → Backups) for thirty days.', 'Start over'))) return;
  await store.remove('talk', P.novelId).catch(() => {});
  await talk.ensureTalk(P.novelId);
  drawSide();
}

/* which replies' thinking he unfolded, so a redraw keeps them open */
const thinkOpen = new Set();
function turnThinkBox(turnId, thinking, live) {
  return thinkBox(thinking, { live, open: thinkOpen.has(turnId), onToggle: (now) => { if (now) thinkOpen.add(turnId); else thinkOpen.delete(turnId); } });
}
/* what a reply shows: the partner's words without its blocks — while a
 * block is coming, or it is reading a chapter, a line says so */
function shownWords(kind, turn, raw, live) {
  if (kind !== 'talk' || turn.by === 'you') return raw || '';
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
  el.append(h('span.words', shownWords(kind, turn, text, live)));
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
    row.append(h('button', { onclick: async () => {
      const out = kind === 'talk' ? await talk.partnerAgain({ novelId: id, chapterId: P.chapterId, turnId: turn.id }) : await talk.playAgain({ playId: id, turnId: turn.id });
      if (out && !out.ok && out.error) toast(out.error, 6000);
    } }, 'Another answer'));
    if (kind === 'talk') row.append(h('button', { onclick: async () => { if (!(await desk.useAsDirection(wordsOf(v.text)))) return; if (!wide()) closeRight(); toast('It is in the box — change it as you like, then Write.'); } }, 'Use as the next direction'));
    if (v.sent) row.append(h('button', { onclick: () => showSent(P.novelId, v.sent) }, 'What was sent'));
  }
  row.append(h('button', { onclick: async () => toast((await copyText(kind === 'talk' && turn.by !== 'you' ? wordsOf(v.text) : (v.text || ''))) ? 'Copied.' : 'It could not be copied.') }, 'Copy'));
  row.append(h('button', { onclick: () => removeTurn(kind, id, turn) }, 'Remove'));
  el.append(row);
  return el;
}

/* The partner's changes under its answer: each with what it changed and
 * why, and its Undo — or, set to wait, Apply and Leave it. */
const clip = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function whatChanged(c) {
  const op = c.op || {};
  if (op.remove === true) return 'taken out of the notes';
  if (op.find !== undefined) return h('span', h('del', clip(op.find, 90)), ' → ', h('ins', clip(op.replace !== undefined ? op.replace : op.text, 90) || '(taken out)'));
  if (op.passage !== undefined && op.text !== undefined) return `written anew (${plural(countWordsLoose(op.text), 'word')})`;
  if (op.book !== undefined) return op.add !== undefined ? h('span', 'a new paragraph: ', h('ins', clip(op.add))) : h('span', h('ins', clip(op.text)));
  if (op.chapter !== undefined) return h('span', 'named ', h('ins', clip(op.name, 80)));
  if (op.note !== undefined) {
    const bits = ['about', 'ties', 'now'].filter((k) => op[k] !== undefined).map((k) => `${k === 'ties' ? 'with others' : k === 'now' ? 'right now' : 'who they are'}: ${clip(op[k], 80)}`);
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
    drawSideSoon();
  };
  for (const c of v.changes) {
    const mark = { made: '✓', waiting: '•', refused: '✗', undone: '↶', skipped: '–' }[c.status] || '•';
    const state = { made: '', waiting: 'waiting for Apply', refused: `couldn’t be made — ${c.said || 'no reason given'}`, undone: 'undone', skipped: 'left as it was' }[c.status] || '';
    const row = h('div.change.' + c.status,
      h('div.chead', h('b', `${mark} ${c.label}`), state ? h('small', state) : null),
      c.status !== 'refused' ? h('div.cwhat', whatChanged(c)) : null,
      c.why ? h('div.cwhy', c.why) : null);
    const btns = h('div.cbtns');
    if (c.status === 'made') btns.append(h('button', { onclick: act(talk.undoOneChange, c.id) }, 'Undo'));
    if (c.status === 'waiting') btns.append(h('button.go', { onclick: act(talk.applyChange, c.id) }, 'Apply'), h('button', { onclick: act(talk.skipChange, c.id) }, 'Leave it'));
    if (btns.childNodes.length) row.append(btns);
    box.append(row);
  }
  const waiting = v.changes.filter((c) => c.status === 'waiting');
  if (waiting.length > 1) box.append(h('div.cbtns', h('button.go', { onclick: async () => { for (const c of waiting) talk.applyChange(novelId, turn.id, v.id, c.id); drawSideSoon(); } }, 'Apply all')));
  return box;
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

function onTalkLive(ev) {
  const map = ev.kind === 'talk' ? partnerLive : playLive;
  if (ev.done) { map.delete(ev.turnId); if ((ev.kind === 'talk' && P.side === 'partner') || (ev.kind === 'play' && P.side === 'play')) drawSide(); return; }
  const entry = { text: ev.text, thinking: ev.thinking, note: ev.note || '' };
  map.set(ev.turnId, entry);
  const turnEl = ui.rightBody.querySelector(`.turn[data-id="${ev.turnId}"]`);
  /* the reply's own words — never the thinking box's, which sits before them */
  const el = turnEl && turnEl.querySelector(':scope > span.words');
  if (el) {
    if (ev.thinking) {
      const box = turnEl.querySelector('.thinkbox');
      if (box) updateThinkBox(box, ev.thinking, { live: !ev.text });
      else turnEl.insertBefore(turnThinkBox(ev.turnId, ev.thinking, !ev.text), el);
    } else if (!ev.text) {
      /* a new round (it is reading a chapter): the last round's thinking goes */
      const box = turnEl.querySelector('.thinkbox');
      if (box) box.remove();
    }
    el.textContent = shownWords(ev.kind, { by: 'ai' }, ev.text || '', entry);
    ui.rightBody.scrollTop = 1e9;
  } else if ((ev.kind === 'talk' && P.side === 'partner') || (ev.kind === 'play' && P.side === 'play')) drawSide();
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
      P.offs.push(store.subscribe('play', id, () => { if (P.side === 'play' && P.playId === id) drawSideSoon(); }));
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
  if (!P.offs['play:' + p.id]) { P.offs.push(store.subscribe('play', p.id, () => { if (P.side === 'play' && P.playId === p.id) drawSideSoon(); })); P.offs['play:' + p.id] = true; }
  const c = store.peek('chapter', p.chapterId);
  const full = fullKind() === 'scene';
  const head = h('div.scenehead',
    h('button.icon', { 'aria-label': 'All scenes', onclick: () => { P.playId = null; drawSide(); } }, icon('back', 20)),
    h('div', { style: { flex: '1', minWidth: '0' } }, h('b', { style: { font: '600 18px/1.2 var(--display)' } }, `You play ${p.who}`), h('div', { style: { fontSize: '12.5px', color: 'var(--chrome-soft)' } }, c ? `From ${chapterLabel(n, c, { withName: false })}` : '')),
    h('button.icon', { 'aria-label': full ? 'Leave full screen' : 'Full screen', title: full ? 'Leave full screen' : 'Full screen', onclick: () => sceneFull() }, icon(full ? 'shrink' : 'expand', 18)),
    h('button.icon', { 'aria-label': 'More for this scene', onclick: (e) => menu(e.currentTarget, [
      { label: 'Turn it all into prose (from the start)', run: () => toProse(p, true) },
      { label: 'Remove this scene', danger: true, run: async () => {
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
  ui.rightBody.append(box);
  const ta = h('textarea', { rows: 1, placeholder: `What does ${p.who} say or do?`, 'aria-label': `What ${p.who} says or does` });
  const working = talk.talkBusy('play', p.id);
  const send = h('button.btn.primary.small', { onclick: async () => {
    if (talk.talkBusy('play', p.id)) { talk.stopTalk('play', p.id); return; }
    const text = ta.value.trim();
    ta.value = ''; typed.value = '';
    const out = await talk.playSay({ playId: p.id, text });
    if (out && !out.ok && out.error) toast('The narrator did not answer: ' + out.error, 6000);
    if (out && out.giveBack) giveBack('play:' + p.id, out.giveBack);
  } }, working ? 'Stop' : 'Send');
  const fresh = talk.transcriptOf(p).count;
  ui.rightFoot.hidden = false;
  ui.rightFoot.append(ta, h('div.crow',
    h('button.btn.small', { disabled: working || !fresh || writer.busy(P.novelId), onclick: () => toProse(p, false), title: 'Write what happened into the chapter as prose' }, 'Turn it into prose'),
    h('span.grow'), send));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); } });
  autoGrow(ta, 0.3);
  restoreTyped('play:' + p.id);
  ui.rightBody.scrollTop = 1e9;
}

async function toProse(p, fromStart) {
  const tr = talk.transcriptOf(p, { fromStart });
  if (!tr.count) { toast('Nothing new to write yet.'); return; }
  const n = store.peek('novel', P.novelId);
  const chapterId = n.order.includes(p.chapterId) ? p.chapterId : n.order[n.order.length - 1];
  if (!wide()) closeRight();
  hooks.goChapter(chapterId);
  toast('Writing the scene into the chapter…');
  const out = await writer.playToProse({ novelId: P.novelId, chapterId, play: p, transcript: tr.text, length: (n.prefs && n.prefs.length) || 'scene' });
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
