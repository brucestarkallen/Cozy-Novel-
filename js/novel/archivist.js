/* Cozy Novel — js/novel/archivist.js — THE HELPER WHO KEEPS THE NOTES.
 *
 * After every change to the book the helper reads what changed — a new
 * passage, another take, an edit, a passage taken out — and keeps the notes
 * true to the book: the people (who they are, and where they are now), the
 * places, the things worth remembering, the threads still open. It also keeps
 * a summary of every chapter, so a long book can ride as summaries once it
 * outgrows the writer's room, and gives a chapter a name when it has none.
 * For a book whose "What it's about" or "How it reads" is set to Automatic it
 * keeps those too, as the book stands — beside his own words, never over
 * them; once he corrects what it keeps, his correction stands.
 *
 * Nothing here ever asks him to do anything. A reading that fails waits a
 * little and tries again by itself; the light says how it stands. What the
 * helper changed can be put back with one tap — only what it changed: a card
 * he edited since stays as he left it.
 *
 * Every request is sized to the helper's own model: a long change is read in
 * parts, a long chapter summed up in parts, so a small model is never sent
 * more than it holds.
 */

import * as store from '../store.js';
import { ask, emptyWhy } from '../model/call.js';
import { contextOf, thinksOn, thinkingFloor } from '../model/providers.js';
import { connFor, busy as writerBusy, setNotesWait, setBeforeGrow } from './writer.js';
import { parseFirstObject, parseLastObject, closesWhole } from './jsonutil.js';
import { hashText, countWords, nameKey, newId, clone, estimateTokens, openOf, numberWords, truthOf, cutWords, fitRows } from '../util.js';
import { picked, premiseOf, premisesOf, premiseAt, laterWords, chapterLabel, chapterText, chapterPrint, chapterWords, chapterSteps, novelSteps, turnSteps, passageNumbers, NOTE_KINDS, matchCard, cardsCalled, cardStands, carriersOf, sameThreadTitle, threadsNear, hisField, keptStamp, letGoStamp, hisAtOf, hisChange, ownWords, unrender, cleanCard, PRIOR_KEEP } from './shape.js';
import { foldedText, foldName, tokensMissing, figuresInvented, looksLikeTokenDump, isGroupName, isDescriptorName, renameIn, renameAll, nameInText, firstSentence, namesNear, namesAndFigures, nameWordsIn } from './names.js';
import { autoOn, helperFrame, premisesPart, premiseRow, premisesHead, leftLine, entriesPart, entryRow, entryOverWords, ENTRIES_HEAD, timelinePart, timelineRow, TIMELINE_HEAD, readingFocus, premiseBeside, timelineRequest, bibFactsRequest, notesRequest, summaryRequest, stretchRequest, sceneStretchRequest, summaryCheckRequest, summaryAgainRequest, summarySize, SUMMARY_MOST, keepRequest, keptByHelper, bookText, JSON_AGAIN, JSON_CUT, notesText, aboutTheBook, auditRequest, ASKED_WORDS, namedBook } from './prompts.js';
import { fitBook, bibAutoOn, shortOf } from './context.js';
import { readingOf, readingAt, planOf, moved, changedBy, newestRead, unread } from './readings.js';
import { continuityOf, mergeContinuity, continuityStep, timelineOf, continuityDone, continuityNow, turnsOfPrint, withCarriedTurns, sameTurn, turnStands, turnsPassed, turnsOwed, setAsideNow, turnsLost } from './timeline.js';
import { codexOf, mergeCodex, codexStep, codexNow, bibItems, carriedCodex, withCarriedFacts, factsLost, sourceKey, entriesOf, entriesForNotes, entriesNamed, entriesNamer, entryWords, CODEX_SCHEMA, entryJoins, nameForms, makeFinder } from './bibliography.js';
import { stretchPlan, keptStretches, withStretch, sceneChapter } from './stretches.js';
import { setHelperHooks } from './inplace.js';
import { applyCheck, checkSig, checkedNow } from './summarycheck.js';
import { readHouseWith } from './auto.js';

/* Super automatic (auto.js): the book's own switches read the house where they are */
readHouseWith(() => store.peek('house', 'house'));

const lights = new Map();          /* novelId -> {state, words, at} */
const timers = new Map();
const runningFor = new Set();
/* The phone's lease belongs to this window. Two starts in this same window
 * must not both obtain it while the first await is still pending. */
const entering = new Set();
const helperPrints = new Map();   /* connection as it was when this run began */
/* reading some book just now (an update waits for it) */
export function busyAny() { return runningFor.size > 0 || entering.size > 0; }
const failures = new Map();        /* novelId -> {n, until} */
const blocked = new Map();         /* novelId -> the helper connection as it was refused */
const lightFns = new Set();
/* a reading of changed passages being asked just now — the one thing a page waits for */
const readingNow = new Set();
/* a reading its model would not answer: the book read one passage at a time
 * from then on (Cozy Tavern's M316), each passage's failed runs counted */
const narrow = new Set();          /* novelId */
const stuck = new Map();           /* what was asked -> failed runs */

export function onLight(fn) { lightFns.add(fn); return () => lightFns.delete(fn); }
/* a page about to be written waits for a reading of this book that is on its
 * way — a few seconds at most, and never for a summary, the Automatic texts,
 * the notes' check or a wait after a passing fault (Cozy Tavern's M673) */
setBeforeGrow((novelId, chapterId, passageId, versionId) => retireIfSeen(novelId, chapterId, passageId, versionId));
/* words changed in place (inplace.js): what the helper read of them kept, or moved with them */
setHelperHooks({ retire: (...a) => retireIfSeen(...a), rekey: (...a) => rekeyVersion(...a) });
setNotesWait(async (novelId, ms, signal) => {
  const until = Date.now() + ms;
  while (readingNow.has(novelId) && Date.now() < until && !(signal && signal.aborted)) await new Promise((r) => setTimeout(r, 150));
});
/* whether the notes are being kept for this book: a helper chosen, and its connection not turned away */
export function keepingNotes(novelId) { return Boolean(connFor(store.peek('house', 'house') || {}, 'helper')) && !blocked.has(novelId); }
export function lightOf(novelId) {
  /* no helper chosen is said whatever was last seen */
  if (!connFor(store.peek('house', 'house') || {}, 'helper')) return { state: 'off', words: 'No helper is chosen, so the notes are not being kept. Choose one in Settings → Connections (it can be the same as the writer).' };
  const l = lights.get(novelId);
  /* reading, waiting after a failure, or turned away: said as it is */
  if (l && (l.state === 'reading' || l.state === 'waiting' || l.state === 'trouble')) return l;
  /* green only when nothing is left unread */
  const novel = store.peek('novel', novelId);
  if (pendingWork(novelId)) return { state: 'waiting', words: rebuildingNow(novel) ? 'Reading the whole book again — until it is done, the writer and the rest go on with the notes as they were.' : 'The helper reads the newest words in a moment.' };
  const aside = novel ? asideNow(novel).length : 0;
  if (aside) return { state: 'idle', words: `The notes are up to date — but for ${aside === 1 ? 'one part' : `${aside} parts`} its model would not read (in the notes, with Read it again).` };
  return { state: 'idle', words: 'The notes are up to date.' };
}
function tellLight(novelId) {
  for (const fn of lightFns) { try { fn(novelId, lights.get(novelId)); } catch (e) { console.error(e); } }
}
function setLight(novelId, state, words) {
  lights.set(novelId, { state, words, at: Date.now() });
  tellLight(novelId);
}

/* ----------------------------------------------------------- scheduling */

/* THE BOOK'S LEASE (store.lease; Cozy Tavern M293): the helper and the
 * checker work on a book in one browser at a time — another browser open on
 * the same book waits for it, and its notes and checks arrive there when it
 * is done. A result is written only while the lease is still this window's
 * (`mustHold`): a tab Android froze past it has lost it, and stops. */
const holding = new Map();   /* `${who}:${novelId}` -> the lease */
export async function withLease(who, novelId, work, { refused = () => {} } = {}) {
  const key = `${who}:${novelId}`;
  const held = await store.lease(key);
  if (!held.ok) { refused(held); return false; }
  holding.set(key, held);
  try { await work(); } finally { holding.delete(key); held.release(); }
  return true;
}
export async function mustHold(who, novelId) {
  const held = holding.get(`${who}:${novelId}`);
  if (held && !(await held.confirm())) {
    const e = new Error('another browser open on this book took the work over');
    e.yielded = true;
    throw e;
  }
}
export const ELSEWHERE = 'Another browser open on this book is reading it — the notes arrive here when it is done.';

/* the others who look over the book after a change (the checker) hear of it too */
const nudgeFns = new Set();
export function onNudge(fn) { nudgeFns.add(fn); return () => nudgeFns.delete(fn); }

/* A change to the book asks the helper to read it — but never sooner than a
 * reading that just failed said to wait. */
export function nudge(novelId, ms = 4000) {
  for (const fn of nudgeFns) { try { fn(novelId, ms); } catch (e) { console.error(e); } }
  const f = failures.get(novelId);
  const wait = f && f.until > Date.now() ? f.until - Date.now() : 0;
  clearTimeout(timers.get(novelId));
  timers.set(novelId, setTimeout(() => { timers.delete(novelId); run(novelId); }, Math.max(ms, wait)));
  /* the light turns amber the moment there is something new to read */
  tellLight(novelId);
}

/* WAITING, OR STOPPED: TRIED AGAIN NOW BY HIS HAND (Cozy Tavern M752-010,
 * "Manual yellow check"): a helper waiting out a failure, or stopped for a
 * connection that was turned away, is given a fresh try the moment he asks —
 * the wait it would keep by itself, and what it gave up on, are his to
 * overrule. It stops again only if the trouble is still there. */
export function stalled(novelId) {
  const f = failures.get(novelId);
  return blocked.has(novelId) || Boolean(f && f.until > Date.now());
}
export function tryNow(novelId) {
  if (!store.peek('novel', novelId)) return false;
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, 200);
  return true;
}

/* tried again by itself, later each time — and never sooner than its
 * provider asked (Cozy Tavern M28: the wait it named is a floor). Returns
 * how long, in his words. */
function retryLater(novelId, asked = 0) {
  const n = ((failures.get(novelId) || {}).n || 0) + 1;
  const ms = Math.max([60000, 180000, 600000][Math.min(n - 1, 2)], Number(asked) || 0);
  failures.set(novelId, { n, until: Date.now() + ms });
  nudge(novelId, ms);
  return { n, words: waitWords(ms) };
}
export function waitWords(ms) {
  const min = Math.round(ms / 60000);
  if (min <= 1) return 'a minute';
  if (min < 60) return `${numberWords(min).toLowerCase()} minutes`;
  const h = Math.round(min / 60);
  return h === 1 ? 'an hour' : `${numberWords(h).toLowerCase()} hours`;
}

const SIG_SEP = ':';
export function signature(version) { return version ? version.id + SIG_SEP + hashText(version.text || '') : ''; }

/* What changed in a chapter since the helper last read it. */
export function changesIn(novel, chapter) {
  const seen = (novel.memory && novel.memory.seen && novel.memory.seen[chapter.id]) || {};
  const changes = [];
  const now = {};
  let streaming = false;
  for (const p of chapter.passages || []) {
    if (p.by === 'break') continue;
    const v = picked(p);
    if (!v) continue;
    if (v.streaming) { streaming = true; continue; }
    const sig = signature(v);
    now[p.id] = sig;
    if (seen[p.id] === sig) continue;
    let old = '';
    if (seen[p.id]) {
      const [vid, h] = seen[p.id].split(SIG_SEP);
      const was = p.versions.find((x) => x.id === vid);
      if (was && hashText(was.text || '') === h) old = was.text || '';
      else {
        const r = (chapter.retired || []).find((x) => x.key === p.id + SIG_SEP + vid);
        if (r) old = r.text;
      }
    }
    if (!String(v.text || '').trim() && !old) continue;
    /* was: the version as the helper read it (its signature), '' when never read */
    changes.push({ pid: p.id, sig, text: v.text || '', old, was: seen[p.id] || '' });
  }
  const removed = [];
  for (const pid of Object.keys(seen)) {
    if (now[pid] !== undefined) continue;
    if ((chapter.passages || []).some((p) => p.id === pid)) continue;   /* still there, still being written */
    const r = (chapter.retired || []).find((x) => x.key === pid);
    removed.push({ pid, text: r ? r.text : '', key: r ? r.key : null, was: seen[pid], after: r ? r.after : undefined });
  }
  return { changes, removed, streaming, now };
}

/* A passage (or one version of it) the helper had read is about to go:
 * its words are kept so the helper can take back what came only from them. */
export function retireIfSeen(novelId, chapterId, passageId, versionId = null) {
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', chapterId);
  if (!novel || !chapter) return;
  const seen = (novel.memory && novel.memory.seen && novel.memory.seen[chapterId]) || {};
  const sig = seen[passageId];
  if (!sig) return;
  const p = chapter.passages.find((x) => x.id === passageId);
  if (!p) return;
  const [vid, h] = sig.split(SIG_SEP);
  if (versionId && versionId !== vid) return;
  const v = p.versions.find((x) => x.id === vid);
  /* only the words as it read them: a version grown since (Go on) has them kept already */
  const kept = (chapter.retired || []).find((x) => x.key === passageId + SIG_SEP + vid);
  const text = v && hashText(v.text || '') === h ? String(v.text || '') : kept && !versionId ? String(kept.text || '') : '';
  if (!text.trim()) return;
  /* a whole passage going keeps where it stood (the passage before it), so
   * the helper can tell whether anything it read came after it */
  const i = chapter.passages.indexOf(p);
  const where = versionId ? {} : { after: i > 0 ? chapter.passages[i - 1].id : '^' };
  store.change('chapter', chapterId, chapterSteps.retire({ key: versionId ? passageId + SIG_SEP + vid : passageId, text, at: Date.now(), ...where }));
}

/* A version's words mended in place (mend.js: what was never the story taken
 * off a page kept before a repair) — what the helper read of it is moved to
 * the mended words, so nothing is read again for words that only lost what
 * it never read as story: where it was marked read, its reading, the
 * readings that point to it, and its place among those set aside */
export function resign(novelId, chapterId, pid, vid, oldText, newText) {
  const from = vid + SIG_SEP + hashText(oldText || '');
  const to = vid + SIG_SEP + hashText(newText || '');
  if (from === to || !store.peek('novel', novelId)) return;
  store.change('novel', novelId, (n) => {
    const m = n.memory || (n.memory = {});
    const seen = m.seen && m.seen[chapterId];
    if (seen && seen[pid] === from) seen[pid] = to;
    const r = m.readings && m.readings[pid] && m.readings[pid][vid];
    if (r && r.sig === from) r.sig = to;
    for (const byV of Object.values(m.readings || {})) for (const x of Object.values(byV || {})) if (x && x.in && x.in.pid === pid && x.in.vid === vid && x.in.sig === from) x.in.sig = to;
    const a = m.aside && m.aside[pid];
    if (a && a.sig === from) a.sig = to;
  }, { checkpoint: true });
}

/* One version's words now kept on another of the same passage (inplace.js
 * foldVersion: a fix made before 2.12.2 as a version of its own, put on the
 * version it was made from — 2.12.2 changes words in place): what the helper
 * read of it — the passage as read, its reading and the readings pointing to
 * it, what it set aside — moved to the other, the other's own reading kept
 * beside it (readings.js readingAt), nothing read again. */
export function rekeyVersion(novelId, chapterId, pid, fromVid, toVid) {
  if (!store.peek('novel', novelId) || fromVid === toVid) return;
  const swap = (sig) => (typeof sig === 'string' && sig.split(SIG_SEP)[0] === fromVid ? toVid + sig.slice(fromVid.length) : sig);
  const swapIn = (r) => (r && r.in && r.in.pid === pid && r.in.vid === fromVid ? { ...r, in: { ...r.in, vid: toVid, sig: swap(r.in.sig) } } : r);
  store.change('novel', novelId, (n) => {
    const m = n.memory || (n.memory = {});
    const seen = m.seen && m.seen[chapterId];
    if (seen && seen[pid]) seen[pid] = swap(seen[pid]);
    const all = m.readings || {};
    /* the readings read together with it point to it where it is now */
    for (const group of Object.values(all)) {
      for (const [vid, r] of Object.entries(group || {})) {
        if (!r) continue;
        const next = swapIn(r);
        if (Array.isArray(next.prior)) next.prior = next.prior.map(swapIn);
        group[vid] = next;
      }
    }
    const byV = all[pid];
    const r = byV && byV[fromVid];
    if (r) {
      const moved = { ...r, sig: swap(r.sig), ...(r.fromSig ? { fromSig: swap(r.fromSig) } : {}) };
      if (Array.isArray(moved.prior)) moved.prior = moved.prior.map((x) => ({ ...x, sig: swap(x.sig), ...(x.fromSig ? { fromSig: swap(x.fromSig) } : {}) }));
      const was = byV[toVid];
      /* the other's own reading, and its earlier ones, kept beside it */
      const older = [...(was && was.sig !== moved.sig ? [(({ prior, ...x }) => x)(was)] : []), ...((was && was.prior) || []), ...(moved.prior || [])];
      const prior = older.filter((x, i) => x && x.sig !== moved.sig && older.findIndex((y) => y && y.sig === x.sig) === i).slice(0, PRIOR_KEEP);
      delete moved.prior;
      if (prior.length) moved.prior = prior;
      byV[toVid] = moved;
      delete byV[fromVid];
    }
    const a = m.aside && m.aside[pid];
    if (a && a.sig) a.sig = swap(a.sig);
  }, { checkpoint: true });
}

/* A chapter's passages are about to be replaced whole (an earlier copy of it
 * brought back): whatever the helper had read that goes, or reads otherwise
 * now, is kept for it — so what came only from those words can be taken back. */
export function retireBeforeReplace(novelId, chapterId, nextPassages) {
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', chapterId);
  if (!novel || !chapter) return;
  const seen = (novel.memory && novel.memory.seen && novel.memory.seen[chapterId]) || {};
  const next = new Map((nextPassages || []).map((p) => [p.id, p]));
  for (const p of chapter.passages || []) {
    const sig = seen[p.id];
    if (!sig) continue;
    const [vid] = sig.split(SIG_SEP);
    const v = p.versions.find((x) => x.id === vid);
    if (!v || !String(v.text || '').trim()) continue;
    const there = next.get(p.id);
    if (!there) store.change('chapter', chapterId, chapterSteps.retire({ key: p.id, text: v.text, at: Date.now() }));
    else if (signature(picked(there)) !== sig) store.change('chapter', chapterId, chapterSteps.retire({ key: p.id + SIG_SEP + vid, text: v.text, at: Date.now() }));
  }
}

/* Passages moving to another chapter (a chapter started from a passage):
 * they were read already, where they stood — the helper is told nothing new. */
export function moveSeen(novelId, fromId, toId, passageIds) {
  const novel = store.peek('novel', novelId);
  if (!novel || !novel.memory || !novel.memory.seen) return;
  const from = { ...(novel.memory.seen[fromId] || {}) };
  const to = { ...(novel.memory.seen[toId] || {}) };
  let moved = 0;
  for (const pid of passageIds) if (from[pid]) { to[pid] = from[pid]; delete from[pid]; moved++; }
  if (!moved) return;
  store.change('novel', novelId, novelSteps.seen(fromId, from));
  store.change('novel', novelId, novelSteps.seen(toId, to));
}

/* A whole chapter is going: what it held is kept for the helper — all of
 * it, read in parts when long (never cut from the front, nor told by a
 * summary that leaves out what the notes took from it: Cozy Tavern's M259-2). */
export function retireChapter(novelId, chapter) {
  const novel = store.peek('novel', novelId);
  if (!novel || !chapter) return;
  const seen = novel.memory && novel.memory.seen && novel.memory.seen[chapter.id];
  if (!seen || !Object.keys(seen).length) return;
  const text = chapterText(chapter);
  if (!text.trim()) return;
  store.change('novel', novelId, novelSteps.pushRemoved({ id: chapter.id, text, at: Date.now() }));
  store.change('novel', novelId, novelSteps.forgetChapterSeen(chapter.id));
}

/* ------------------------------------------- each version its own notes */
/* (readings.js) A version changed on a passage the helper had read — another
 * take, a rewrite, his edit, the arrows, a version or a passage taken out —
 * is settled from the readings kept, wherever that can be done exactly:
 *
 * (a) back to the version a change came from: the change's reading is taken
 *     back, and the notes are as they were;
 * (b) the book's newest read passage: the old version's reading is taken
 *     back — the notes stand as they did before the passage — and the new
 *     version's own reading is laid on again when it has one; when it has
 *     none it is left unread, and the helper reads it from there as new;
 * (c) a version never read since its passage was taken back, read before:
 *     its reading is laid on again;
 * and a passage taken out that was the newest read has its reading taken
 * back. Anything else — a card changed meanwhile by a later reading — is
 * left to the helper, who is told what the passage used to say. */

/* CARDS KEPT BEFORE TODAY'S DOOR, PUT THROUGH IT ONCE (Cozy Tavern's M519-2,
 * M524-1: a fault mended at the door only leaves what was kept carrying it):
 * a field of the helper's that says nothing — "unchanged", "none", an object
 * written out as "[object Object]" — is emptied; his own words are never
 * touched. Once a book, for each version of the door. */
const HEAL_V = 1;
export function healCards(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel || ((novel.memory || {}).healed || 0) >= HEAL_V) return 0;
  const cards = [];
  for (const kind of NOTE_KINDS) {
    for (const c of ((novel.notes || {})[kind]) || []) {
      const next = clone(c);
      for (const f of ['about', 'ties', 'now', 'since']) {
        if (typeof next[f] !== 'string' || !next[f].trim() || (f !== 'since' && hisField(c, f))) continue;
        if (!cleanText(next[f])) next[f] = '';
      }
      if (Array.isArray(next.aka) && !hisField(c, 'aka')) next.aka = next.aka.filter((a) => cleanName(a));
      if (JSON.stringify(next) !== JSON.stringify(c)) cards.push({ kind, id: c.id, before: clone(c), after: next });
    }
  }
  if (cards.length) store.change('novel', novelId, novelSteps.applyCards(cards));
  store.change('novel', novelId, novelSteps.setMemory({ healed: HEAL_V }));
  return cards.length;
}

/* the book's chapters read in where they are not yet: how many could not be */
async function loadChapters(novelId) {
  const novel = store.peek('novel', novelId);
  await Promise.all(((novel && novel.order) || []).map(async (id) => {
    if (store.peek('chapter', id) !== undefined) return;
    try { await store.open('chapter', id); } catch (_) { /* counted below */ }
  }));
  /* A missing record answers null rather than throwing. Check the current
   * order too: a chapter added while loading must not count as an empty one. */
  const current = store.peek('novel', novelId);
  return ((current && current.order) || []).filter((id) => !store.peek('chapter', id)).length;
}
function chaptersOf(novel) {
  const out = {};
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) out[id] = c; }
  return out;
}
function passageLabel(novel, chapter, pid) {
  const n = passageNumbers(chapter).get(pid);
  return `${chapterLabel(novel, chapter, { withName: false })}${n ? `, passage ${n}` : ''}`;
}

/* a settled plan, made on the notes: cards and kept words moved (each only
 * where it still reads as planned), the passages marked as now read — or
 * unread — and the cards it moved lit */
function commitPlans(novelId, chapterId, plans, { mark = {}, unmark = [], label = '' } = {}) {
  for (const p of plans) {
    if (p.moves.length) store.change('novel', novelId, novelSteps.moveCards(p.moves));
    if (p.kept.length) store.change('novel', novelId, novelSteps.moveKept(p.kept));
  }
  const live = store.peek('novel', novelId);
  const map = { ...((live.memory && live.memory.seen && live.memory.seen[chapterId]) || {}) };
  for (const pid of unmark) delete map[pid];
  for (const [pid, sig] of Object.entries(mark)) map[pid] = sig;
  store.change('novel', novelId, novelSteps.seen(chapterId, map));
  const changed = plans.flatMap((p) => changedBy(p.moves));
  if (changed.length) store.change('novel', novelId, novelSteps.setMemory({ lit: { at: Date.now(), label, changed: changed.slice(0, 40) } }));
}

function settleChange(novelId, chapter, c, chapters) {
  const novel = store.peek('novel', novelId);
  const state = { notes: novel.notes || {}, kept: novel.kept || {} };
  const rOld = c.was ? readingOf(novel, c.pid, c.was) : null;
  const rNew = readingOf(novel, c.pid, c.sig);
  const label = passageLabel(novel, chapter, c.pid);
  const clearRetired = () => {
    const keys = ((store.peek('chapter', chapter.id) || {}).retired || []).filter((r) => r.key === c.pid || r.key.startsWith(c.pid + SIG_SEP)).map((r) => r.key);
    if (keys.length) store.change('chapter', chapter.id, chapterSteps.clearRetired(keys));
  };
  /* (a) back to the version the change came from */
  if (rOld && rOld.mode === 'change' && !rOld.pointer && rOld.fromSig === c.sig) {
    const back = planOf(state, rOld, { back: true });
    if (!back.clean) return false;
    commitPlans(novelId, chapter.id, [back], { mark: { [c.pid]: c.sig }, label: `${label} — the version on show` });
    clearRetired();
    return true;
  }
  /* everything before it read: a reading laid on again lands where it was made */
  const readUpTo = () => !unread(novel, chapters, { chapterId: chapter.id, before: c.pid }).length;
  /* (c) never read since its passage was taken back: its own reading, laid on again */
  if (!c.was) {
    if (!rNew || rNew.mode !== 'new' || rNew.pointer || !newestRead(novel, chapters, chapter.id, c.pid) || !readUpTo()) return false;
    const on = planOf(state, rNew, { back: false });
    if (!on.clean) return false;
    commitPlans(novelId, chapter.id, [on], { mark: { [c.pid]: c.sig }, label: `${label} — the version on show` });
    clearRetired();
    return true;
  }
  /* (b) the newest read passage */
  if (!rOld || rOld.mode !== 'new' || !newestRead(novel, chapters, chapter.id, c.pid)) return false;
  const back = planOf(state, rOld, { back: true });
  if (!back.clean) return false;
  const covered = (rOld.covers && rOld.covers.length ? rOld.covers : [c.pid]);
  if (rNew && rNew.mode === 'new' && !rNew.pointer && covered.length === 1 && readUpTo()) {
    const after = { notes: moved(state.notes, back.moves), kept: keptAfter(state.kept, back.kept) };
    const on = planOf(after, rNew, { back: false });
    if (on.clean) {
      commitPlans(novelId, chapter.id, [back, on], { mark: { [c.pid]: c.sig }, label: `${label} — the version on show` });
      clearRetired();
      return true;
    }
  }
  /* taken back: what the old version made is out of the notes, and the
   * passage (with any read together with it) is read again from there, as new */
  commitPlans(novelId, chapter.id, [back], { unmark: covered, label: `${label} — what the version before made, taken back out` });
  clearRetired();
  return true;
}
function keptAfter(kept, moves) {
  const out = { ...(kept || {}) };
  for (const m of moves) { if (JSON.stringify(out[m.key] || null) !== JSON.stringify(m.from || null)) continue; if (m.to) out[m.key] = m.to; else delete out[m.key]; }
  return out;
}

function settleRemoved(novelId, chapter, r, chapters) {
  const novel = store.peek('novel', novelId);
  const rOld = r.was ? readingOf(novel, r.pid, r.was) : null;
  if (!rOld || rOld.mode !== 'new' || rOld.pointer) return false;
  if (!newestRead(novel, chapters, chapter.id, r.pid, { after: r.after })) return false;
  const back = planOf({ notes: novel.notes || {}, kept: novel.kept || {} }, rOld, { back: true });
  if (!back.clean) return false;
  commitPlans(novelId, chapter.id, [back], { unmark: [r.pid], label: `${chapterLabel(novel, chapter, { withName: false })} — a passage taken out` });
  if (r.key) store.change('chapter', chapter.id, chapterSteps.clearRetired([r.key]));
  return true;
}

/* -------------------------------------------- each reading, his to undo */

/* The readings kept, newest first: what each read and what it changed —
 * for the notes' list of readings. Only full readings (one read together
 * with others shows once, under the last of them). */
export function readingsList(novelId) {
  const novel = store.peek('novel', novelId);
  const all = (novel && novel.memory && novel.memory.readings) || {};
  const seen = (novel && novel.memory && novel.memory.seen) || {};
  const rows = [];
  for (const id of (novel && novel.order) || []) {
    const c = store.peek('chapter', id);
    for (const p of (c && c.passages) || []) {
      for (const [vid, top] of Object.entries(all[p.id] || {})) {
        const v = (p.versions || []).find((x) => x.id === vid);
        if (!v || !top) continue;
        /* (and the readings of its earlier words, a version changed on the page itself: 2.12.2) */
        for (const r of [top, ...(Array.isArray(top.prior) ? top.prior : [])]) {
          if (!r || r.in || !Array.isArray(r.cards)) continue;
          const onShow = picked(p) || {};
          const shown = onShow.id === vid && signature(onShow) === r.sig;
          const earlier = onShow.id === vid && !shown;
          const live = (seen[id] || {})[p.id] === r.sig;
          rows.push({ pid: p.id, vid, sig: r.sig, chapterId: id, at: r.at || 0, label: r.label || passageLabel(novel, c, p.id), mode: r.mode, shown, live, earlier,
            changed: changedOf(r.cards || []).concat(keptChangedOf(r.kept || {})) });
        }
      }
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

/* Put back what one reading changed — card by card, only where the card
 * still reads as it left it (his edits, and later readings, stay); read
 * again: and the passage is read afresh from there. */
export function putBackReading(novelId, pid, vid, { readAgain: again = false, sig = null } = {}) {
  const novel = store.peek('novel', novelId);
  const all = (novel && novel.memory && novel.memory.readings) || {};
  const top = all[pid] && all[pid][vid];
  /* (one of a version's readings by its words — its newest, or one of its earlier words) */
  const r = sig ? readingAt(all[pid], vid, sig) : top;
  if (!r || r.in) return false;
  const plan = planOf({ notes: novel.notes || {}, kept: novel.kept || {} }, r, { back: true });
  if (plan.moves.length) store.change('novel', novelId, novelSteps.moveCards(plan.moves), { now: true });
  if (plan.kept.length) store.change('novel', novelId, novelSteps.moveKept(plan.kept), { now: true });
  /* the reading is no longer what the notes hold: it goes, and with it the
   * readings of the passages read together with it */
  const covers = r.covers && r.covers.length ? r.covers : [pid];
  const drop = [];
  for (const other of covers) if (other !== pid) for (const [ov, x] of Object.entries(all[other] || {})) if (x && x.in && x.in.pid === pid && x.in.vid === vid && x.in.sig === r.sig) drop.push([other, ov]);
  /* that reading alone: the version's readings of its other words stay */
  if (top && top.sig !== r.sig) store.change('novel', novelId, (n) => { const t = n.memory.readings[pid] && n.memory.readings[pid][vid]; if (t && Array.isArray(t.prior)) t.prior = t.prior.filter((x) => x && x.sig !== r.sig); }, { now: true });
  else if (top && Array.isArray(top.prior) && top.prior.length) store.change('novel', novelId, (n) => { const t = n.memory.readings[pid] && n.memory.readings[pid][vid]; if (!t) return; const [next, ...rest] = t.prior; n.memory.readings[pid][vid] = { ...next, ...(rest.length ? { prior: rest } : {}) }; }, { now: true });
  else drop.push([pid, vid]);
  if (drop.length) store.change('novel', novelId, novelSteps.dropReadings(drop), { now: true });
  const changed = changedBy(plan.moves);
  store.change('novel', novelId, novelSteps.setMemory({ lit: changed.length ? { at: Date.now(), label: `${r.label || 'a reading'} — put back`, changed } : null }), { now: true });
  if (again) {
    for (const id of novel.order || []) {
      const c = store.peek('chapter', id);
      if (!c || !covers.some((x) => (c.passages || []).some((p) => p.id === x))) continue;
      const map = { ...((store.peek('novel', novelId).memory || {}).seen || {})[id] };
      for (const x of covers) delete map[x];
      store.change('novel', novelId, novelSteps.seen(id, map), { now: true });
    }
    failures.delete(novelId);
    blocked.delete(novelId);
    nudge(novelId, 500);
  }
  tellLight(novelId);
  return true;
}

/* Settle what can be settled from the readings kept. Returns how many. Run
 * by the reading itself before it asks anything, and by the page the moment
 * a version is picked or taken out — never while a reading of this book is
 * on its way (its answer is laid on the notes as they stood when it was
 * asked), nor in a window that is not the one reading this book. */
export function settleNow(novelId) {
  let n = 0;
  for (let guard = 0; guard < 400; guard++) {
    const novel = store.peek('novel', novelId);
    if (!novel) return n;
    const chapters = chaptersOf(novel);
    let did = false;
    for (const id of novel.order || []) {
      const c = chapters[id];
      if (!c) continue;
      const ch = changesIn(store.peek('novel', novelId), c);
      for (const x of ch.changes) if (settleChange(novelId, c, x, chapters)) { did = true; n++; break; }
      if (did) break;
      for (const r of ch.removed) if (settleRemoved(novelId, c, r, chapters)) { did = true; n++; break; }
      if (did) break;
    }
    if (!did) return n;
  }
  return n;
}
export async function settle(novelId) {
  if (runningFor.has(novelId) || entering.has(novelId)) return 0;
  const go = () => { const n = settleNow(novelId); if (n) tellLight(novelId); return n; };
  if (globalThis.navigator && navigator.locks && navigator.locks.request) {
    return navigator.locks.request(`cozynovel-helper-${novelId}`, { ifAvailable: true }, (lock) => (lock && !runningFor.has(novelId) ? go() : 0));
  }
  return go();
}

/* ----------------------------------------------------------- the notes */

/* What the helper gave for a field, as words — or '' when it gave none
 * (Cozy Tavern's door, M648/M658): only words are words (an object is no
 * field, never "[object Object]"; a list of lines is its lines); a field
 * that only says there is nothing ("none", "N/A", "unchanged") or excuses
 * itself is no field, so the card keeps what it had; and a runaway answer is
 * cut at its last whole sentence, far beyond anything honest (M197/M235). */
const NOTHING = /^(?:none|n\/?a|nil|null|undefined|object\s+object|nothing(?:\s+(?:new|yet|more|changed|to add))?|unknown|unchanged|no changes?|same(?:\s+as\s+before)?|not\s+(?:given|stated|known|mentioned|yet)|[-—–?.…\s]+)[.!]?$/i;
/* A field that opens by saying there is nothing and goes on only to point at
 * the passage or the notes — "Unchanged from before.", "Not mentioned in this
 * passage.", "No new information.", "None — the line is complete." — says
 * nothing too (Cozy Tavern's M648/M658); a real line that only begins so
 * ("Unknown to her, Tom had followed", "None of the guards saw her") stays. */
const NOTHING_HEAD = /^(?:none|n\/?a|nil|null|undefined|unknown|unchanged|no\s+(?:changes?|updates?|new\s+[\p{L}]+|additional\s+[\p{L}]+|further\s+[\p{L}]+|information|mention)|nothing(?:\s+(?:new|yet|more|changed|missing|further))?|same(?:\s+as\s+(?:before|above))?|not\s+(?:given|stated|known|mentioned|described|shown|specified|applicable|yet))(?![\p{L}])/iu;
const POINTING = /\b(?:from|since|as|in|for|at|on|of|to|by|the|this|that|it|is|was|a|an|any|not|before|earlier|above|previously|last|time|chapter|passage|part|scene|section|text|reading|update|notes?|book|so|far|yet|here|now|report|add|note|line|complete|mentioned|given|stated|described|applicable|information|new|anything|nothing|change|changes|changed|same|still|currently|all)\b/giu;
const SORRY = /^(?:i['’]?m\s+(?:sorry|afraid|unable|not able)|i\s+am\s+(?:sorry|afraid|unable|not able)|sorry[,.]|i\s+(?:can(?:['’]?t|not)|won['’]?t|will\s+not|must\s+decline|apologi[sz]e)\b|unfortunately,?\s+i\b|as\s+an\s+ai\b)/i;
function wordsOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))).map((x) => String(x).trim()).filter(Boolean).join('\n');
  return typeof v === 'string' ? v : '';
}
/* the field without what only dresses it: brackets or quotes around the
 * whole, a short label before a colon ("DETAIL: none") */
function bare(t) {
  let x = String(t || '').trim();
  for (let i = 0; i < 3; i++) {
    const m = /^[(\[{“"'‘*_]+([\s\S]*?)[)\]}”"'’*_]+$/.exec(x);
    if (!m) break;
    x = m[1].trim();
  }
  const label = /^[\p{L} ]{1,24}:\s*([\s\S]+)$/u.exec(x);
  return label && (NOTHING.test(label[1].trim()) || NOTHING_HEAD.test(label[1].trim())) ? label[1].trim() : x;
}
function nothingIn(t) {
  const x = bare(t);
  if (!x || NOTHING.test(x)) return true;
  const m = NOTHING_HEAD.exec(x);
  if (m && !x.slice(m[0].length).replace(POINTING, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()) return true;
  return echoed(x);
}
/* the request's own words for the field, given back */
function echoed(x) {
  const low = String(x || '').toLowerCase().replace(/[’']/g, "'").trim();
  return Boolean(low) && ASKED_WORDS.some((w) => { const a = w.toLowerCase().replace(/[’']/g, "'"); return low === a || (low.length >= 16 && a.startsWith(low.replace(/[.…]+$/, ''))) || low.startsWith(a.slice(0, 40)); });
}
export function cleanText(v, max = 12000) {
  let t = wordsOf(v).replace(/\r/g, '').trim();
  if (!t || nothingIn(t) || SORRY.test(t)) return '';
  if (t.length > max) t = cutWords(t, max);
  return t;
}
/* only says there is nothing ("none", "unchanged", "…") — no words at all */
export function saysNothing(v) { const t = wordsOf(v).replace(/\r/g, '').trim(); return !t || NOTHING.test(bare(t)); }
export function cleanName(v) {
  const t = wordsOf(v).replace(/\s+/g, ' ').trim().slice(0, 120);
  return t && !NOTHING.test(bare(t)) && !SORRY.test(t) && !echoed(bare(t)) && /[\p{L}\p{N}]/u.test(t) ? t : '';
}
const his = (card) => Boolean(card && card.updated && card.updated.by === 'you');
const NO_THREAD = /^(?:no\s+(?:new\s+)?threads?|untitled|title|tbd|todo|to\s+do)[.!]?$/i;

/* Who someone is, is added to — never thinned by a reading (Cozy Tavern's
 * M648): a new "about" that keeps less than three-fifths of the telling words
 * of the one that stands and says less than it is not written. The auditor,
 * which folds repeats and puts drift right, is not held to it. */
const telling = (t) => new Set(String(t || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length >= 4));
/* (the same count for his entries in Quick add — quickadd.js, 2.12.40) */
export const tellingWords = telling;
/* how much of one text's telling words another holds (1 when it has none) */
function heldIn(text, other) {
  const was = telling(text);
  if (!was.size) return 1;
  const now = telling(other);
  let kept = 0;
  for (const w of was) if (now.has(w)) kept += 1;
  return kept / was.size;
}
/* besides: words kept elsewhere (the bibliography) that the shorter one may
 * leave to them — counted as held, never as making the new one longer */
export function thins(standing, offered, besides = '') {
  const old = String(standing || '').trim();
  const neu = String(offered || '').trim();
  if (!old || !neu) return false;
  if (!telling(old).size) return false;
  return heldIn(old, besides ? `${neu} ${besides}` : neu) < 0.6 && neu.length < old.length;
}
/* the sentences of `add` that `have` does not say already */
export function newSentences(have, add) {
  const key = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const h = key(have);
  return String(add || '').trim().split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter((x) => { const k = key(x); return k && !h.includes(k); });
}
/* a field kept with what an answer adds to it — never its older lines lost */
/* HOW SOMEONE STANDS WITH THE OTHERS GROWS AT ITS END — the newest turn is
 * added last — so a telling past its room keeps its newest turns and lets its
 * oldest go, said by the "…" it opens with (Cozy Tavern M565: a cut that kept
 * the oldest lines lost where the story stands now) */
const TIES_MAX = 12000;
export function keepNewest(text, max = TIES_MAX) {
  const x = String(text || '').trim();
  if (x.length <= max) return x;
  const tail = x.slice(x.length - max);
  /* from the first sentence that begins whole in what is kept */
  const m = /[.!?…]["”’)\]]*\s+(?=\S)/.exec(tail);
  return `… ${m && m.index < max / 4 ? tail.slice(m.index + m[0].length) : tail.replace(/^\S*\s+/, '')}`;
}
function addedTo(old, add) {
  const o = String(old || '').trim();
  if (!o) return String(add || '').trim();
  const fresh = newSentences(o, add);
  return fresh.length ? `${o} ${fresh.join(' ')}` : o;
}
/* what stands of a card's words past the line it was shown by (notesText's first line) */
function pastFirstLine(text) {
  const x = String(text || '').trim();
  return x.slice(firstSentence(x).length).trim();
}

/* Fold the helper's answer into the notes. Pure: returns the new notes and,
 * for each card it touched, the card before and after (so the reading can be
 * put back exactly), with the reason it gave for each (`whys`, by card id),
 * the rows it did not write where they named (`aside`), and what it would not
 * do, with why (`refused`: for the notes' check's report).
 * A name means the card called that before one that also goes by it
 * (matchCard). His own names, casing and words are kept field by field (Cozy
 * Tavern's M263): what a reading says of a card whose words are his rides
 * beside them (`since`, M299), never over them. A card he wrote or changed is
 * never taken out; nor is one the same answer gives whole, nor — with
 * `stands` (bookFolded) — one whose name still stands in the book, unless
 * it was folded into another card that holds what it held.
 *  chapterId, at — where and when; nowAt — the chapter a person's "now" is
 *    as of (the chapter read; the book's last for the check)
 *  audit — the notes' check: it may thin a card, give the other names a
 *    person goes by whole, add a thread already closed; it never makes a card
 *    of a name two cards answer to
 *  limit — the check of some cards only (a Set of ids)
 *  nowStays — true, or a Set of card ids whose "now" a later part of the
 *    book wrote: a part read out of turn never moves it (Cozy Tavern M453)
 *  short — the cards it was shown by their first line (notesText shortIds):
 *    what it gives stands for that line, and their other lines stand
 *  asked — the notes as they stood when it was asked: a field changed since
 *    (his hand, his partner) is never written over (M299), and a card taken
 *    out since is never made again from what was read before
 *  named — the words it read, folded: a name they hold is someone's own,
 *    never a slip of the pen for another's (Robert is not Roberta)
 *  keepOpen — threads the newest passage's reading opened: the check never
 *    closes one (a loose end closes only with what comes after it, M681) */
/* The bibliography's words about each person of the notes — the book's facts
 * (and the passages' words that say them), his entry's words, and what this
 * answer establishes — so a portrait made shorter may leave to it what it
 * keeps, and never lose a word of the book (foldNotes keptElsewhere). Asked
 * for only by a reading that asked for a short portrait (askedCodex); the
 * facts it counts ride whatever the switch says by now. */
export function factsByCard(novelId, extra = []) {
  const novel = store.peek('novel', novelId);
  if (!novel) return null;
  const chapters = {};
  for (const id of novel.order || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  const people = (novel.notes || {}).people || [];
  const map = new Map();
  const add = (id, t) => { if (id && t) map.set(id, `${map.get(id) || ''} ${t}`); };
  const cardOf = (name, aka = []) => matchCard(people, name, aka, { kind: 'people', near: true, slip: false }).card;
  for (const it of bibItems(novel, chapters, { facts: true })) {
    const card = it.card && it.card.kind === 'people' ? people.find((c) => c.id === it.card.id) : it.entry ? cardOf(it.name, it.aka) : null;
    if (!card) continue;
    add(card.id, it.facts.map((f) => `${f.fact} ${(f.evidence || []).join(' ')} ${(f.more || []).join(' ')}`).join(' '));
    /* his entry's words, unless he keeps them for himself — the writer never reads those */
    if (it.entry && it.rides !== 'never') add(card.id, `${it.entry.line || ''} ${it.entry.text || ''}`);
  }
  for (const f of extra || []) { const card = cardOf(f.name); if (card) add(card.id, `${f.fact} ${(f.evidence || []).join(' ')}`); }
  return (card) => map.get(card.id) || '';
}
export function foldNotes(notes, answer, { chapterId = '', at = Date.now(), audit = false, stands = null, limit = null, nowStays = false, short = null, asked = null, named = null, keepOpen = null, nowAt = '', nowPid = '', unseen = null, grounds = null, keptElsewhere = null, hisWords = null, mine = null, outOfTurn = false } = {}) {
  const out = clone(notes || {});
  /* THE BOOK IS HIS NEWER WORD (2.12.10). His words on a card are never written
   * over by a reading — unless the words he changed himself (`hisWords`: the
   * folded text of the versions he wrote, had written again or had his partner
   * write; shape.js hisChange) say the opposite, and the answer quotes them:
   * "contradicts" — the words that say so, which must stand in those words.
   * Then his card is put right (about whole, "Since then" folded in, that
   * field his no longer), or a card of his about a thing the book no longer
   * has goes with "gone". A quote that stands nowhere in them, or only in the
   * writer's own page, changes nothing: a slip there is the checker's. */
  const contradicted = (row) => {
    const q = cleanText(row && row.contradicts, 600);
    if (!q || !hisWords) return '';
    const f = foldedText(q);
    return hisWords.loose.includes(' ' + f.loose.trim() + ' ') || hisWords.tight.includes(' ' + f.tight.trim() + ' ') ? q : '';
  };
  for (const k of NOTE_KINDS) if (!Array.isArray(out[k])) out[k] = [];
  const touched = new Map();       /* card id -> {kind, before} */
  const whys = {};
  const aside = [];
  const refused = [];
  const written = new Set();       /* the cards this answer gives */
  const givenBy = new Map();       /* card id -> the fields a row of this answer gave it */
  const landed = new Set();        /* the cards it changed */
  const why = (id, row) => { const w = cleanText(row && row.why, 400); if (w) whys[id] = w; };
  const touch = (kind, card) => { if (!touched.has(card.id)) touched.set(card.id, { kind, before: clone(card) }); };
  const uniq = (list, main) => list.filter((a, i) => list.findIndex((b) => nameKey(b) === nameKey(a)) === i && nameKey(a) !== nameKey(main));
  /* one line for a card: a second reason for it is said on the same line, never dropped */
  const refuse = (kind, name, w) => {
    const was = refused.find((x) => x.kind === kind && nameKey(x.name) === nameKey(name));
    if (!was) refused.push({ kind, name, why: w });
    else if (w && !String(was.why || '').split('; ').includes(w)) was.why = `${was.why}; ${w}`;
  };
  const stays = (id) => nowStays === true || (nowStays instanceof Set && nowStays.has(id));
  const shownShort = (id) => Boolean(short && short.has(id));
  /* how it was shown: 1 by its first line, 2 by its name only (a Map tells; a Set means its first line) */
  const shownLevel = (id) => (short instanceof Map ? short.get(id) || 0 : shownShort(id) ? 1 : 0);
  const filled = (v) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : true);
  const askedCard = (kind, id) => ((asked && Array.isArray(asked[kind]) ? asked[kind] : []).find((c) => c.id === id) || null);
  const standingCard = (kind, id) => ((notes && Array.isArray(notes[kind]) ? notes[kind] : []).find((c) => c.id === id) || null);
  /* a telling of someone's ties that no longer names a person the standing one did (Cozy Tavern M517-1: Sara's tie lost to one about Tom) */
  let peopleNames = null;
  const dropsSomeone = (old, neu) => {
    if (!old) return false;
    if (!peopleNames) peopleNames = out.people.flatMap((c) => [c.name, ...(c.aka || [])]).filter((n) => n && !isDescriptorName(n));
    const fo = foldedText(old);
    const fn = foldedText(neu);
    return peopleNames.some((n) => nameInText(fo, n, { words: false }) && !nameInText(fn, n, { words: false }));
  };
  /* A RECORD PUT RIGHT FROM THE BOOK (Cozy Tavern M752-012): the check may
   * say a fact in its own words, but a name or a figure it writes that the
   * card did not already hold must be one the book gives (`grounds`: its
   * passages and his About this book) — never one it made up. The first such
   * word, or '' */
  const unfounded = (card, value) => {
    if (!audit || !grounds || !String(value || '').trim()) return '';
    const held = card ? foldedText([card.name, ...(card.aka || []), card.about, card.now, card.ties, card.since].filter(Boolean).join(' \n ')) : null;
    const has = (w) => Boolean(w) && (grounds.loose.includes(` ${w} `) || Boolean(held && held.loose.includes(` ${w} `)));
    /* "Chapter 3", "passage 2.4": where in the book, never a figure of the story */
    const told = String(value).replace(/\b(?:chapters?|passages?|parts?)\s+(?:\d+(?:\.\d+)?|[A-Za-z]+(?:-[A-Za-z]+)?)\b/gi, ' ');
    for (const tok of namesAndFigures(told)) {
      const f = foldName(tok);
      if (has(f)) continue;
      if (/^\d+$/.test(tok) && Number(tok) < 1000 && has(foldName(numberWords(Number(tok))))) continue;
      return tok;
    }
    return '';
  };
  /* a new card's name: each word of it with a capital, or a number, as the book gives it */
  const unfoundedName = (name) => {
    if (!audit || !grounds || nameInText(grounds, name, { words: false })) return '';
    for (const w of String(name || '').split(/\s+/)) {
      const tok = w.replace(/['’]s$/i, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!tok || !/^[\p{Lu}\d]/u.test(tok)) continue;
      const f = foldName(tok);
      if (grounds.loose.includes(` ${f} `)) continue;
      if (/^\d+$/.test(tok) && Number(tok) < 1000 && grounds.loose.includes(` ${foldName(numberWords(Number(tok)))} `)) continue;
      return tok;
    }
    return '';
  };
  const groundWhy = (tok) => `a name or a figure the book never gives (“${tok}”) — left as it was`;
  /* where a "now" is as of: the chapter, and the passage when it is known (nowWrittenLater) */
  const stampNow = (card) => {
    const where = nowAt || chapterId;
    if (!where) return;
    card.nowAt = where;
    if (nowPid) card.nowPid = nowPid; else delete card.nowPid;
  };
  /* the card a new row would be, taken out of the notes since the answer was asked */
  const takenOutSince = (kind, name, aka) => {
    if (!asked || !Array.isArray(asked[kind])) return null;
    const was = matchCard(asked[kind], name, aka, { kind }).card;
    return was && !((notes && notes[kind]) || []).some((c) => c.id === was.id) ? was : null;
  };
  /* a description given as a person, standing beside the one name it is in
   * the words read — "the courier, Hachigorō", "Hachigorō the courier" — is
   * that person's card, never a second one beside it; the description goes
   * among the names it goes by (Cozy Tavern M482, M509-2, M509-5). Only by
   * what the words read say: "the courier and Hachigorō" are two, and so are
   * "Hachigorō, the courier's son" */
  const besideName = (descr) => {
    const f = typeof named === 'string' ? foldedText(named) : named;
    const d = foldName(descr);
    if (!f || !f.loose || !d) return null;
    const hits = out.people.filter((c) => !isDescriptorName(c.name) && foldName(c.name).split(' ').filter((w) => w.length >= 3)
      .some((w) => f.loose.includes(` ${d} ${w} `) || new RegExp(` ${w} ${d} (?!s )`).test(f.loose)));
    return hits.length === 1 ? hits[0] : null;
  };
  const makeCard = (kind, name, aka, row, about, open) => {
    const fresh = { id: newId(kind.slice(0, 2)), name, about, updated: { chapterId, at } };
    if (kind === 'people') {
      fresh.aka = aka;
      fresh.ties = keepNewest(cleanText(row.ties, Infinity));
      fresh.now = cleanText(row.now);
      if (fresh.now) stampNow(fresh);
    } else if (aka.length) fresh.aka = uniq(aka, name);
    if (kind === 'threads') fresh.open = open !== false;
    out[kind].push(fresh);
    written.add(fresh.id);
    landed.add(fresh.id);
    touched.set(fresh.id, { kind, before: null });
    givenBy.set(fresh.id, new Set(['about', 'now', 'ties'].filter((f) => String(fresh[f] || '').trim())));
    why(fresh.id, row);
    return fresh;
  };
  const foldRow = (kind, row0) => {
    if (!row0 || typeof row0 !== 'object') return;
    /* the notes' own display given back — "Name (also A, B)", "(my words)", "With others:", "Right now:", "Since then:" — taken off every field, each word kept where it belongs (shape.js unrender) */
    const row = unrender(kind, row0);
    const name = cleanName(row.name);
    if (!name) return;
    const aka = (Array.isArray(row.aka) ? row.aka : typeof row.aka === 'string' ? row.aka.split(',') : []).map(cleanName).filter((a) => a && nameKey(a) !== nameKey(name));
    const about = cleanText(row.about);
    const open = openOf(row);
    /* a title that names no thread ("TBD", "untitled") is none (Cozy Tavern M653) */
    if (kind === 'threads' && NO_THREAD.test(name)) return;
    /* a name the words it read hold is someone's own, never a slip of the pen for another's (Cozy Tavern M646) */
    const own = Boolean(named) && kind === 'people' && nameInText(named, name, { words: false });
    const m = matchCard(out[kind], name, aka, { kind, slip: !own });
    if (m.ambiguous) {
      const names = (m.among || []).map((c) => c.name);
      const which = names.length ? ` (${names.slice(0, 3).join(', ')})` : '';
      /* the check names cards exactly: a name two cards answer to is left for him to see */
      if (audit) { aside.push({ kind, name }); refuse(kind, name, `two cards answer to this name${which}`); return; }
      /* a reading's row is never lost (Cozy Tavern M491): kept on a card of its own, named as given, for the check to fold where it belongs */
      if (!about && !cleanText(row.now) && !cleanText(row.ties) && open === undefined) { aside.push({ kind, name }); return; }
      const fresh = makeCard(kind, name, aka, row, about, open);
      whys[fresh.id] = `two cards answer to this name${which} — the notes’ check folds it where it belongs`;
      aside.push({ kind, name, own: fresh.id });
      return;
    }
    /* a check of some cards only: the others are not its to change */
    if (limit && m.card && !limit.has(m.card.id)) { aside.push({ kind, name }); refuse(kind, name, 'not among the cards checked this time'); return; }
    /* A GROUP IS NOT A PERSON (Cozy Tavern M484): one given as a person is
     * kept as what it is — a thing of the world, among the lore; a person's
     * card that is a group, not his, goes over with it (the reading's Undo
     * brings it back) — only where the lore can take it */
    if (kind === 'people' && isGroupName(name) && (!m.card || (!his(m.card) && isGroupName(m.card.name)))) {
      const keepAbout = about || (m.card ? cleanText(m.card.about) : '');
      const as = m.card ? m.card.name : name;
      const names = [...(m.card ? [...(m.card.aka || []), name] : []), ...aka].map(cleanName).filter((a) => a && nameKey(a) !== nameKey(as));
      /* the lore card it becomes or joins, found as foldRow will find it */
      const lm = matchCard(out.lore, as, names, { kind: 'lore' });
      if (lm.ambiguous || (limit && lm.card && !limit.has(lm.card.id))) { aside.push({ kind, name }); return; }
      if (!lm.card && !keepAbout) return;
      if (m.card) {
        touch('people', m.card);
        why(m.card.id, { why: 'a group of people, not one person — kept among the lore' });
        out.people = out.people.filter((c) => c !== m.card);
      }
      foldRow('lore', { name: as, aka: names, about: keepAbout, why: row.why });
      return;
    }
    const card = m.card || (kind === 'people' && !audit && named && isDescriptorName(name) ? besideName(name) : null);
    /* a new card from a row that says nothing — "N/A", "none", "unknown", nothing at all — is none (2.12.18: as a row two cards answer to) */
    const saysAnything = Boolean(about) || Boolean(cleanText(row.ties)) || (Boolean(cleanText(row.now)) && !/^\s*(?:unknown|whereabouts\s+unknown|not\s+known)\s*[.!]?\s*$/i.test(String(row.now))) || open !== undefined;
    if (!card && !saysAnything) return;
    if (!card) {
      /* one he took out while this was read is not made again from what was read before (Cozy Tavern M752) */
      const gone = takenOutSince(kind, name, aka);
      if (gone) { refuse(kind, gone.name, 'taken out of the notes while this was being read'); return; }
      /* a title or a name near another's (narrower or wider: Cozy Tavern M522, M752): never written on as the same — kept as given, said, for the notes' check to fold if it is */
      const near = audit ? [] : kind === 'threads' ? out.threads.filter((t) => [t.name, ...(t.aka || [])].some((n) => threadsNear(n, name)))
        : kind === 'places' || kind === 'lore' ? out[kind].filter((t) => [t.name, ...(t.aka || [])].some((n) => namesNear(n, name))) : [];
      if (near.length) {
        const fresh = makeCard(kind, name, aka, row, about, open);
        whys[fresh.id] = `it may be the same ${kind === 'threads' ? 'thread' : kind === 'places' ? 'place' : 'thing'} as ${near.slice(0, 2).map((t) => `“${t.name}”`).join(' or ')} — the notes’ check folds it if it is`;
        aside.push({ kind, name, own: fresh.id, near: true });
        return;
      }
      /* a thread is never closed by the reading that opens it: a loose end closes only with what comes after it (Cozy Tavern M681) */
      if (kind === 'threads' && open === false && !audit) { refuse(kind, name, 'a thread new to the notes, already closed'); return; }
      /* the check adds only who and what the book gives */
      /* (a person's name is a name word for word; a thread's or a thing's title is read as a telling: "Whether Mara forgives Tom") */
      const bad = (kind === 'people' ? unfoundedName(name) : unfounded(null, name)) || unfounded(null, about) || (kind === 'people' ? unfounded(null, cleanText(row.now)) || unfounded(null, cleanText(row.ties)) : '');
      if (bad) { refuse(kind, name, groundWhy(bad)); return; }
      makeCard(kind, name, aka, row, about, open);
      return;
    }
    written.add(card.id);
    const was = JSON.stringify(card);
    const before = clone(card);
    /* TWO ROWS OF ONE ANSWER FOR ONE CARD — by its name and by a name it goes
     * by — never the later winning silently (Cozy Tavern M752: two writes to
     * one field): who they are keeps the fuller telling, where they are now
     * and how they stand keep the first; the clash is said */
    const given = givenBy.get(card.id) || new Set();
    givenBy.set(card.id, given);
    const clash = (f, v) => given.has(f) && Boolean(String(v || '').trim()) && String(card[f] || '').trim() !== String(v || '').trim();
    const then = asked ? askedCard(kind, card.id) : null;
    /* a field changed since it was asked — by his hand, or his partner's — is never written over by it (Cozy Tavern M299) */
    /* Compare with the card at the start of this fold, not with a field an
     * earlier row of this same answer just wrote. */
    const standing = standingCard(kind, card.id);
    const movedSince = (f) => Boolean(asked) && (then ? JSON.stringify(then[f] ?? null) !== JSON.stringify(standing?.[f] ?? null) : filled(standing?.[f]));
    if (nameKey(card.name) !== nameKey(name) && kind === 'people' && m.how !== 'slip') {
      /* a name the story now goes by — told as the main name, the old one
       * among the others — unless the name is his */
      /* (a description — "the courier" — never takes the place of a name the card already has: 2.12.18) */
      if (!hisField(card, 'name') && !movedSince('name') && !movedSince('aka') && aka.some((a) => nameKey(a) === nameKey(card.name)) && !(isDescriptorName(name) && !isDescriptorName(card.name))) {
        const old = card.name;
        card.name = name;
        card.aka = [...(card.aka || []), old];
      } else if (!movedSince('aka') && !(card.aka || []).some((a) => nameKey(a) === nameKey(name))) card.aka = [...(card.aka || []), name];
    }
    /* who someone is: his words stand, and what the book adds rides beside
     * them; the helper keeps the rest — added to, never thinned by a reading
     * (a person's; a place, a thing or a thread says where it stands now) */
    const aboutTwice = clash('about', about) && thins(card.about, about);
    if (aboutTwice) refuse(kind, card.name, 'who they are given twice in one answer — the fuller telling kept');
    if (about) given.add('about');
    const aboutBad = about && !aboutTwice && !movedSince('about') ? unfounded(before, about) : '';
    if (aboutBad) refuse(kind, card.name, groundWhy(aboutBad));
    if (about && !movedSince('about') && !aboutTwice && !aboutBad) {
      /* (the check's alone — it reads the whole book; a reading sees one passage and never rewrites his words: 2.12.16) */
      if (hisField(card, 'about') && audit && contradicted(row)) {
        /* his words, contradicted by words he changed himself: the book as it stands is what the card says now */
        card.about = about;
        delete card.since;
        letGo.add(card.id);
      } else if (hisField(card, 'about')) {
        const add = newSentences(card.about, about).join(' ');
        const old = String(card.since || '').trim();
        if (add && !movedSince('since')) {
          const next = !audit && (shownShort(card.id) || thins(old, add)) ? addedTo(old, add) : add;
          if (next !== old) { card.since = next; if (!audit) sinceHis.add(card.id); }
        }
      } else if (shownShort(card.id) && !audit) card.about = shownLevel(card.id) >= 2 ? addedTo(card.about, about) : addedTo(about, pastFirstLine(card.about));
      /* the check, which folds repeats and puts drift right, may thin one — unless it saw some of the book only in short (Cozy Tavern M403), when nothing is thinned;
       * and a person's portrait made shorter is taken when what it leaves out is kept in the bibliography (keptElsewhere: its facts and their words) */
      else {
        const elsewhere = kind === 'people' && keptElsewhere ? keptElsewhere(card) : '';
        const thinner = thins(card.about, about, elsewhere);
        if (audit ? !unseen || !thinner : kind !== 'people' || !thinner) card.about = about;
      }
    }
    if (kind === 'people') {
      /* "Unknown." for someone the words read name is where they are — nobody
       * knows — never nothing (the inn they left stays otherwise: Cozy Tavern
       * M509-13); for someone they never name it is a filler, and goes */
      const unknownNow = /^\s*(?:unknown|whereabouts\s+unknown|not\s+known)\s*[.!]?\s*$/i.test(String(row.now == null ? '' : row.now)) && Boolean(named) && nameInText(named, card.name, { words: false });
      const nowText = cleanText(row.now) || (unknownNow ? 'Whereabouts unknown.' : '');
      const nowTwice = clash('now', nowText);
      if (nowTwice) refuse(kind, card.name, 'where they are now given twice in one answer — the first kept');
      if (nowText) given.add('now');
      /* where someone is "now" is as of the end of the book: a part read out
       * of turn (the book already read past it) never moves one a later part
       * wrote — it only fills one never written (Cozy Tavern M453) */
      const nowBad = nowText && !nowTwice && !movedSince('now') ? unfounded(before, nowText) : '';
      if (nowBad) refuse(kind, card.name, groundWhy(nowBad));
      if (nowText && !nowTwice && !nowBad && !movedSince('now') && !(stays(card.id) && String(card.now || '').trim())) {
        card.now = nowText;
        stampNow(card);
      }
      /* how they stand with the others moves with the story; his lines, and
       * lines it was never shown (a card by its first line), are added to —
       * never lost to a thinner telling */
      const ties = keepNewest(cleanText(row.ties, Infinity));
      /* a reading adds to them, so a second telling only adds; the check's replaces — the fuller stands */
      const tiesTwice = audit && clash('ties', ties) && thins(card.ties, ties);
      if (tiesTwice) refuse(kind, card.name, 'how they stand given twice in one answer — the fuller telling kept');
      /* (a reading's second row for the same person — by another name it goes by — adds to the first, whatever their order: 2.12.18) */
      const tiedAgain = given.has('ties');
      if (ties) given.add('ties');
      const tiesBad = ties && !tiesTwice && !movedSince('ties') ? unfounded(before, ties) : '';
      if (tiesBad) refuse(kind, card.name, groundWhy(tiesBad));
      if (ties && !tiesTwice && !tiesBad && !movedSince('ties')) {
        const old = String(card.ties || '').trim();
        const next = !audit && (tiedAgain || shownShort(card.id) || hisField(card, 'ties') || thins(old, ties) || dropsSomeone(old, ties)) ? addedTo(old, ties) : ties;
        /* his own lines are never the ones let go */
        card.ties = hisField(card, 'ties') ? next : keepNewest(next);
      }
    }
    /* the other names it goes by: a reading adds to them; the notes' check
     * gives them whole, so a wrong one comes off (Cozy Tavern M223) — never
     * the names he gave, nor the one it was just renamed from */
    const renamedFrom = nameKey(card.name) !== nameKey(before.name) ? [before.name] : [];
    const usedName = nameKey(name) !== nameKey(card.name) && m.how !== 'slip' ? [name] : [];
    const akaWhole = audit && Array.isArray(row.aka) && row.aka.every((a) => cleanName(a));
    if (akaWhole && !hisField(card, 'aka') && !movedSince('aka')) card.aka = uniq([...aka, ...renamedFrom, ...usedName], card.name);
    else if (!movedSince('aka') && (aka.length || (card.aka && card.aka.length))) card.aka = uniq([...(card.aka || []), ...aka], card.name);
    if (kind === 'threads' && open !== undefined && !hisField(card, 'open') && !movedSince('open')) {
      if (open === false && card.open !== false && keepOpen && keepOpen.has(card.id)) refuse(kind, card.name, 'opened by the newest passage — only what comes after it can close it');
      /* a part of the book read out of turn — before pages already read — never reopens a thread they closed (2.12.18) */
      else if (open !== false && card.open === false && outOfTurn && !audit) refuse(kind, card.name, 'closed by a later part of the book — a part before it never reopens it');
      else card.open = open;
    }
    if (JSON.stringify(card) !== was) {
      if (!touched.has(card.id)) touched.set(card.id, { kind, before });
      landed.add(card.id);
      /* a card he wrote stays his in what he wrote: the helper keeps the rest — what the book he changed contradicted is his no longer */
      card.updated = letGo.has(card.id) ? letGoStamp(before.updated, 'about', chapterId, at) : keptStamp(before, chapterId, at);
      why(card.id, row);
    }
  };
  const letGo = new Set();      /* his cards whose words the book he changed contradicted: put right */
  const sinceHis = new Set();   /* his cards a reading laid "Since then" on: the check looks at them soon */
  for (const kind of NOTE_KINDS) for (const row of (Array.isArray(answer && answer[kind]) ? answer[kind] : [])) foldRow(kind, row);
  /* HIS WORDS AND THE BOOK'S ACCOUNT BESIDE THEM, JUDGED (2.12.12). Each card
   * of his with "Since then" is listed for the check (`mine`: {ids, book}), and
   * it must say for each whether the book still bears his words out. Where the
   * book says the opposite — quoted, the quote standing in the book as it
   * stands and in what "Since then" already holds of it — his words go and the
   * book's account is the card (about whole, Since then folded in, that field
   * his no longer), or the card goes when nothing of it is in the book. Held:
   * nothing changes, and it is not asked again until Since then changes. */
  const mineSaid = new Map();     /* card id -> 'held' | 'changed' | 'gone' | 'unfounded' */
  const goneMine = [];
  if (mine && mine.ids && mine.ids.size) {
    for (const row0 of (Array.isArray(answer && answer.mine) ? answer.mine : [])) {
      if (!row0 || typeof row0 !== 'object' || !NOTE_KINDS.includes(row0.kind)) continue;
      const row = { ...row0, name: unrender(row0.kind, { name: row0.name }).name };
      const c = cardsCalled(out[row.kind], cleanName(row.name)).find((x) => mine.ids.has(x.id));
      if (!c || mineSaid.has(c.id)) continue;
      if (asked && JSON.stringify(askedCard(row.kind, c.id)) !== JSON.stringify(standingCard(row.kind, c.id))) continue;
      const holds = truthOf(row.holds);
      const within = (f, g) => Boolean(f) && (f.loose.includes(' ' + g.loose.trim() + ' ') || f.tight.includes(' ' + g.tight.trim() + ' '));
      /* against: his card — the quote stands in the pages, or in a premise of his typed after the card (2.12.40, the
       * audit: his newest word wins — a premise older than his card is never the book overturning it) */
      const bookHas = (words, against = null) => {
        const g = words ? foldedText(words) : null;
        if (!g || !g.loose.trim() || !mine.book) return false;
        if (!against || !his(against) || !mine.pages) return within(mine.book, g);
        const since = hisAtOf(against.updated);
        return within(mine.pages, g) || (mine.premises || []).some((x) => x.at > since && within(x.f, g));
      };
      /* A THREAD IS WHAT THE BOOK SETS UP (2.12.16): every thread is held to the
       * book's own words that set it up ("evidence", standing in the book) — a
       * thread no words of the book set up goes; one partly told from nowhere
       * keeps only what the book sets up; one held without its words is not
       * taken as held (asked again, three times at most) */
      const evidence = cleanText(row.evidence, 600);
      /* (a thread the newest passage opened: only what comes after it closes it or takes it out — as for a thread row, 2.12.18) */
      const newest = row.kind === 'threads' && keepOpen && keepOpen.has(c.id);
      if (newest && (truthOf(row.never) === true || truthOf(row.gone) === true || truthOf(row.open) === false || cleanText(row.contradicts))) { mineSaid.set(c.id, 'held'); refuse(row.kind, c.name, 'opened by the newest passage — only what comes after it can close it'); continue; }
      if (row.kind === 'threads' && truthOf(row.never) === true && !written.has(c.id)) {
        /* (its telling words standing in the book, it is the book's — never taken for invented) */
        const words = [...telling([c.name, c.about].join(' '))];
        const found = words.filter((w) => mine.book && mine.book.loose.includes(' ' + foldName(w).split(' ')[0])).length;
        if (words.length && found / words.length >= 0.7) { mineSaid.set(c.id, 'unfounded'); refuse(row.kind, c.name, 'said to be set up by no words of the book, but its words stand in it'); continue; }
        touch(row.kind, c);
        whys[c.id] = cleanText(row.why, 400) || 'no words of the book set it up';
        goneMine.push([row.kind, c]);
        mineSaid.set(c.id, 'gone');
        continue;
      }
      if (holds === true && row.kind !== 'threads' && typeof row.since === 'string' && String(c.since || '').trim()) {
        /* his words hold, and Since then says what the book no longer does: cut down to what it still says (never new words — those are the readings'), or cleared (2.12.18) */
        const keep = cleanText(row.since, 4000);
        if (keep.trim() !== String(c.since).trim() && (!keep.trim() || heldIn(keep, String(c.since)) >= 0.8)) {
          touch(row.kind, c);
          const was = clone(c);
          if (keep.trim()) c.since = keep; else delete c.since;
          c.updated = keptStamp(was, chapterId, at);
          landed.add(c.id);
          whys[c.id] = cleanText(row.why, 400) || 'what was beside your words the book no longer says';
        }
        mineSaid.set(c.id, 'held');
        continue;
      }
      if (holds === true) { mineSaid.set(c.id, row.kind !== 'threads' || bookHas(evidence) ? 'held' : 'unfounded'); continue; }
      if (holds !== false) continue;
      if (row.kind === 'threads' && !cleanText(row.contradicts) && (cleanText(row.about) || truthOf(row.open) !== undefined)) {
        /* (cut down only: what it keeps are the thread's own words or the book's it quoted — never new words of its own) */
        const told = cleanText(unrender(row.kind, { about: row.about }).about, 4000) || String(c.about || '');
        if (!bookHas(evidence) || unfounded(c, told) || heldIn(told, [c.about, c.since, evidence].join(' ')) < 0.8) { mineSaid.set(c.id, 'unfounded'); refuse(row.kind, c.name, 'what it gave of the thread is not the thread’s own words nor the book’s'); continue; }
        /* what it would cut, measured as "never set up" is: words the book gives are never cut from a thread (2.12.18) */
        const cut = [...telling(c.about)].filter((w) => !telling(told).has(w));
        const cutFound = cut.filter((w) => mine.book && mine.book.loose.includes(' ' + foldName(w).split(' ')[0])).length;
        if (cut.length && cutFound / cut.length >= 0.7) { mineSaid.set(c.id, 'unfounded'); refuse(row.kind, c.name, 'what it would cut from the thread stands in the book'); continue; }
        touch(row.kind, c);
        const was = clone(c);
        c.about = told;
        delete c.since;
        const off = ['about'];
        const open = truthOf(row.open);
        if (open !== undefined && open !== (c.open !== false)) { c.open = open; off.push('open'); }
        c.updated = his(was) ? letGoStamp(was.updated, off, chapterId, at) : keptStamp(was, chapterId, at);
        landed.add(c.id);
        whys[c.id] = cleanText(row.why, 400) || 'only what the book sets up';
        mineSaid.set(c.id, 'changed');
        continue;
      }
      const q = cleanText(row.contradicts, 600);
      const inBook = bookHas(q, c);
      /* the quote is the book's, and what the account beside his words already tells (never a contradiction made up out of other words) */
      /* (a card with no Since then is held to its own subject: the quote names it — never a contradiction made of words about someone else) */
      const inSince = q && (String(c.since || '').trim() ? heldIn(q, String(c.since)) >= 0.5
        : row.kind === 'threads' ? heldIn(q, String(c.about || '')) >= 0.5
          : [c.name, ...(c.aka || [])].some((x) => x && nameInText(foldedText(q), x)));
      if (!inBook || !inSince) { mineSaid.set(c.id, 'unfounded'); refuse(row.kind, c.name, q ? 'the words it gave for the book saying otherwise are not the book’s' : 'it said the book says otherwise without the book’s words'); continue; }
      const whyNow = cleanText(row.why, 400) || `the book now says “${clipQuote(q)}”`;
      /* a thread is judged whole — its name (the storyline), its words, open or closed (2.12.14): overturned, it is the
       * storyline the book sets up now, named for it; with no storyline left to name, it goes (2.12.13) */
      /* a thread the book has overturned goes — the check never names or writes a storyline of its own in its place (2.12.16: it did, under 2.12.14, and wrote what no page says) */
      const renamed = '';
      if (truthOf(row.gone) === true || row.kind === 'threads') {
        if (written.has(c.id)) continue;
        touch(row.kind, c);
        whys[c.id] = whyNow;
        goneMine.push([row.kind, c]);
        mineSaid.set(c.id, 'gone');
        continue;
      }
      const given = cleanText(unrender(row.kind, { about: row.about }).about, 4000);
      /* (no words of the book's given, or words it never gives: with no Since then to take, nothing changes — his words and his mark as they were, 2.12.18) */
      if ((!given || unfounded(c, given)) && !String(c.since || '').trim()) { mineSaid.set(c.id, 'unfounded'); refuse(row.kind, c.name, given ? groundWhy(unfounded(c, given)) : 'it gave nothing to put in its place'); continue; }
      const about = given && !unfounded(c, given) ? given : String(c.since || '').trim();
      if (!about) continue;
      touch(row.kind, c);
      const before = clone(c);
      c.about = about;
      delete c.since;
      const off = ['about'];
      if (renamed) { c.name = renamed; off.push('name'); }
      const open = row.kind === 'threads' ? truthOf(row.open) : undefined;
      if (open !== undefined && open !== (c.open !== false)) { c.open = open; off.push('open'); }
      c.updated = his(before) ? letGoStamp(before.updated, off, chapterId, at) : keptStamp(before, chapterId, at);
      landed.add(c.id);
      whys[c.id] = whyNow;
      mineSaid.set(c.id, 'changed');
    }
    for (const [kind, c] of goneMine) out[kind] = out[kind].filter((x) => x !== c);
  }
  /* A THREAD CLOSED TAKES ITS COPIES WITH IT (Cozy Tavern M653): where the
   * notes already hold one thread as several, closing it closes every copy —
   * never one left open for ever */
  for (const [id, t] of [...touched]) {
    if (t.kind !== 'threads' || !t.before || t.before.open === false) continue;
    const card = out.threads.find((c) => c.id === id);
    if (!card || card.open !== false) continue;
    for (const twin of out.threads) {
      if (twin === card || twin.open === false || written.has(twin.id) || (limit && !limit.has(twin.id)) || !sameThreadTitle(twin.name, card.name) || hisField(twin, 'open') || (keepOpen && keepOpen.has(twin.id))) continue;
      touch('threads', twin);
      twin.open = false;
      twin.updated = keptStamp(twin, chapterId, at);
      whys[twin.id] = `the same thread as “${card.name}”, closed with it`;
    }
  }
  const gone = Array.isArray(answer && answer.gone) ? answer.gone : [];
  for (const g0 of gone) {
    if (!g0 || typeof g0 !== 'object' || !NOTE_KINDS.includes(g0.kind)) continue;
    const g = { ...g0, name: unrender(g0.kind, { name: g0.name }).name };
    /* only a card called that — never one that merely also goes by it (the card it was folded into) */
    const drop = [];
    for (const c of cardsCalled(out[g.kind], cleanName(g.name))) {
      if (limit && !limit.has(c.id)) { refuse(g.kind, c.name, 'not among the cards checked this time'); continue; }
      /* his, unless the words he changed himself say the book no longer has it (contradicted, quoted) */
      const against = his(c) && audit ? contradicted(g) : '';
      if (his(c) && !against) { refuse(g.kind, c.name, 'yours — never taken out'); continue; }
      if (g.kind === 'threads' && keepOpen && keepOpen.has(c.id)) { refuse(g.kind, c.name, 'opened by the newest passage — only what comes after it can close it'); continue; }
      if (asked && JSON.stringify(askedCard(g.kind, c.id)) !== JSON.stringify(standingCard(g.kind, c.id))) { refuse(g.kind, c.name, 'changed in the notes while this was being read'); continue; }
      if (written.has(c.id)) { refuse(g.kind, c.name, 'given whole in the same answer'); continue; }
      const carriers = carriersOf(g.kind, c, out[g.kind]);
      if (carriers.length) {
        /* folded into another card: only once what it held is there — nothing true is lost in the folding (Cozy Tavern M482) */
        if (!carriers.some((o) => landed.has(o.id) || heldIn([c.about, c.ties].join(' '), [o.about, o.since, o.ties, o.now].join(' ')) >= 0.6)) { refuse(g.kind, c.name, `what it holds is not on ${carriers[0].name} yet`); continue; }
      } else if (stands && !against && cardStands(g.kind, c, stands)) { refuse(g.kind, c.name, 'its name still stands in the book'); continue; }
      /* a thing or a thread the check saw only in short may still be told of in the chapters it did not read whole (Cozy Tavern M403) */
      else if (unseen && (g.kind === 'lore' || g.kind === 'threads') && [...telling(c.name)].some((w) => unseen.loose.includes(' ' + foldedText(w).loose.trim() + ' '))) { refuse(g.kind, c.name, 'the chapters that may still tell of it were read only in short'); continue; }
      drop.push(c);
    }
    if (!drop.length) continue;
    for (const c of drop) { touch(g.kind, c); why(c.id, g); }
    out[g.kind] = out[g.kind].filter((c) => !drop.includes(c));
  }
  const cards = [];
  for (const [id, t] of touched) {
    const after = out[t.kind].find((c) => c.id === id) || null;
    if (JSON.stringify(after) === JSON.stringify(t.before)) continue;
    cards.push({ kind: t.kind, id, before: t.before, after: clone(after) });
  }
  const changed = cards.map((c) => ({ kind: c.kind, name: (c.after || c.before).name, how: !c.before ? 'new' : !c.after ? 'gone' : 'changed' }));
  for (const id of Object.keys(whys)) if (!cards.some((c) => c.id === id)) delete whys[id];
  return { notes: out, cards, changed, whys, aside, refused, sinceHis: [...sinceHis], mineSaid };
}
const clipQuote = (q) => (q.length > 120 ? q.slice(0, 117).trimEnd() + '…' : q);
/* HIS OTHER WORDS THE WRITER READS AS TRUE (2.12.15): What it's about (read
 * on every page, said to be right wherever the book's account differs), Where
 * it's headed, each chapter's plan, and his bibliography's entries for names
 * the book has (the writer writes from an entry as the truth of the world, and
 * the checker holds pages to it). Written under a story since changed, each
 * would steer every page back to the old one. Judged by the check like his
 * cards, once for what each says (memory.mine by key), the entries a dozen at
 * a time. */
const WORDS_LABEL = { about: 'What it’s about', plans: 'Where it’s headed' };
export function wordsToJudge(novel, chapters) {
  const done = (novel && novel.memory && novel.memory.mine) || {};
  const out = [];
  const print = hisPrint(novel);
  const add = (x) => {
    const h = hashText([x.text, print].join('\n'));
    const m = done[x.key];
    if (m && m.h === h && (m.held || (m.n || 0) >= 3)) return;
    out.push({ ...x, h });
  };
  for (const f of ['about', 'plans']) {
    const field = f === 'about' ? 'brief' : 'plans';
    const text = String((novel && novel[field]) || '').trim();
    if (text) add({ key: `book:${f}`, what: 'book', name: f, field, label: WORDS_LABEL[f], text });
  }
  (novel.order || []).forEach((id, i) => {
    const text = String(((chapters[id] || {}).plan) || '').trim();
    if (text) add({ key: `plan:${id}`, what: 'plan', name: String(i + 1), chapterId: id, label: `Chapter ${numberWords(i + 1)}’s plan`, text });
  });
  /* (never one set to Never — the writer never reads it as true; and named by the book as the page finds a name,
   * 2.12.40, the audit: any word of a name in small letters anywhere counted) */
  const entries = entriesForNotes(novel);
  if (entries.length) {
    const named = new Set(entriesNamed(entries, [...(novel.order || []).map((id) => chapterText(chapters[id] || { passages: [] })), ...standingPremises(novel, chapters).map((x) => x.text)].join('\n\n')).map((e) => e.id));
    let room = 9000;
    let n = 0;
    for (const e of entries) {
      if (!e || !String(e.text || '').trim() || n >= 12 || room <= 0) continue;
      if (!named.has(e.id)) continue;
      const before = out.length;
      add({ key: `entry:${e.id}`, what: 'entry', name: e.name, id: e.id, label: `${e.name} (bibliography)`, text: String(e.text).trim() });
      if (out.length > before) { n++; room -= String(e.text).length; }
    }
  }
  return out;
}
/* the judgment of them laid on the book: a quote that is the book's, and his words given whole as the book has them now */
function judgeWords(novelId, list, answer) {
  const said = new Map();
  const changes = [];
  if (!list.length) return { said, changes };
  const rows = Array.isArray(answer && answer.mine) ? answer.mine : [];
  /* (grounded in the words he changed himself — a passage written again for him, his partner's, his hand: the story he changed — never the writer's own page) */
  const book = rows.length ? hisWordsFolded(store.peek('novel', novelId), chaptersOf(store.peek('novel', novelId))) : null;
  for (const x of list) {
    const row = rows.find((r) => r && (r.kind === x.what || (x.what === 'book' && r.kind === 'book')) && String(r.name || '').trim().toLowerCase().replace(/^chapter\s+/, '') === x.name.toLowerCase());
    if (!row) continue;
    const holds = truthOf(row.holds);
    if (holds === true) { said.set(x.key, 'held'); continue; }
    if (holds !== false) continue;
    const q = cleanText(row.contradicts, 600);
    const f = q ? foldedText(q) : null;
    if (!f || !book || !(book.loose.includes(' ' + f.loose.trim() + ' ') || book.tight.includes(' ' + f.tight.trim() + ' '))) { said.set(x.key, 'unfounded'); continue; }
    const next = typeof row.text === 'string' ? row.text.replace(/\s+$/, '') : null;
    /* an entry or a book's words never emptied by it — only a chapter's plan, when nothing of it is left */
    if (next === null || (!next.trim() && x.what !== 'plan')) { said.set(x.key, 'unfounded'); continue; }
    /* a name or a figure neither his words nor the book gives is never laid into his words (2.12.18 — as on a card) */
    if (inventedIn(next, [x.text], store.peek('novel', novelId))) { said.set(x.key, 'unfounded'); continue; }
    /* and his words are put right, never lost: of a long telling (four sentences or more), at least half its sentences come back as he wrote them —
     * a short one may be overturned whole (a chapter's plan with nothing left of it aside) */
    const was = String(x.text).split(/(?<=[.!?…])\s+/).map((t) => foldedText(t).loose.trim()).filter((t) => t.split(' ').length >= 3);
    const nowF = foldedText(next).loose;
    if (next.trim() && was.length >= 4 && was.filter((t) => nowF.includes(' ' + t + ' ')).length / was.length < 0.5) { said.set(x.key, 'unfounded'); continue; }
    const why = cleanText(row.why, 400) || `the book now says “${clipQuote(q)}”`;
    const novel = store.peek('novel', novelId);
    if (x.what === 'book') {
      const before = String(novel[x.field] || '');
      if (before.trim() !== x.text) continue;
      store.change('novel', novelId, novelSteps.setField(x.field, next), { now: true });
      changes.push({ key: x.key, what: 'book', field: x.field, before, after: next, label: x.label, why });
    } else if (x.what === 'plan') {
      const c = store.peek('chapter', x.chapterId);
      const before = c && typeof c.plan === 'string' ? c.plan : '';
      if (!c || before.trim() !== x.text) continue;
      store.change('chapter', x.chapterId, chapterSteps.setPlan(next), { now: true });
      changes.push({ key: x.key, what: 'plan', chapterId: x.chapterId, before, after: String((store.peek('chapter', x.chapterId) || {}).plan || ''), label: x.label, why });
    } else {
      const e = (novel.bibliography || []).find((y) => y && y.id === x.id);
      if (!e || String(e.text || '').trim() !== x.text) continue;
      const after = { ...clone(e), text: next, at: Date.now() };
      store.change('novel', novelId, novelSteps.putEntry(after), { now: true });
      changes.push({ key: x.key, what: 'entry', id: x.id, before: clone(e), after, label: x.label, why });
    }
    said.set(x.key, 'changed');
  }
  return { said, changes };
}
/* the first name or figure in some words that neither the given words nor the book (names filled) gives — '' when none */
function inventedIn(text, own, novel) {
  const grounds = groundsOf(namedBook(novel, store.peek('house', 'house') || {}));
  const mine = foldedText(own.filter(Boolean).join('\n'));
  const has = (w) => Boolean(w) && (grounds.loose.includes(` ${w} `) || mine.loose.includes(` ${w} `));
  const told = String(text).replace(/\b(?:chapters?|passages?|parts?)\s+(?:\d+(?:\.\d+)?|[A-Za-z]+(?:-[A-Za-z]+)?)\b/gi, ' ');
  for (const tok of namesAndFigures(told)) {
    const f = foldName(tok);
    if (has(f)) continue;
    if (/^\d+$/.test(tok) && Number(tok) < 1000 && has(foldName(numberWords(Number(tok))))) continue;
    return tok;
  }
  return '';
}
/* put back what the check changed of them — only where it still reads as the check left it */
function wordsBack(novelId, list) {
  for (const w of list || []) {
    const novel = store.peek('novel', novelId);
    if (!novel) return;
    if (w.what === 'book') { if (String(novel[w.field] || '') === w.after) store.change('novel', novelId, novelSteps.setField(w.field, w.before), { now: true }); }
    else if (w.what === 'plan') { const c = store.peek('chapter', w.chapterId); if (c && String(c.plan || '') === w.after) store.change('chapter', w.chapterId, chapterSteps.setPlan(w.before), { now: true }); }
    else if (w.what === 'entry') store.change('novel', novelId, novelSteps.entryBack(w.id, w.before, w.after), { now: true });
  }
}
/* HIS CARDS TO JUDGE: in his words, with "Since then" beside them not yet judged
 * against them (memory.mine: card id -> {h: the Since then's hash, held, n: how
 * many checks listed it and did not answer — three, and it waits for its Since
 * then to change) */
/* a print of the words he changed himself: a judgment made before he changed the book lapses with it (2.12.18) */
function hisPrint(novel) {
  const f = hisWordsFolded(novel, chaptersOf(novel));
  return f ? hashText(f.loose) : '';
}
export function mineToJudge(novel, only = null) {
  const done = (novel && novel.memory && novel.memory.mine) || {};
  const out = [];
  const print = hisPrint(novel);
  for (const kind of NOTE_KINDS) {
    for (const c of ((novel && novel.notes) || {})[kind] || []) {
      if (only && !only.has(c.id)) continue;
      const since = String(c.since || '').trim();
      /* and every thread — the helper's, his, his partner's: held to the book's own words that set it up, once for what it says (2.12.13; every thread, 2.12.16);
       * and every card in his words or his partner's, Since then or none: held against the book once for what it says — his partner's cards checked too (2.12.17) */
      const thread = kind === 'threads';
      if (!thread && !hisField(c, 'about')) continue;
      if (!thread && !since && !String(c.about || '').trim()) continue;
      const m = done[c.id];
      /* (a thread judged whole since 2.12.14 — name, words, open — so every one is judged once again under that) */
      /* (a card's Since then judged with his words as they are: he changes them, it is judged again, 2.12.18) */
      const h = hashText([...(thread ? ['t3', c.name, c.about, since, c.open === false ? 'closed' : 'open'] : since ? ['s2', c.about, since] : ['c1', c.about]), print].join('\n'));
      if (m && m.h === h && (m.held || (m.n || 0) >= 3)) continue;
      out.push({ kind, id: c.id, name: c.name, h });
    }
  }
  return out.slice(0, 40);
}
/* the words he changed himself, folded (foldNotes' `hisWords`): every version on show that is his (shape.js hisChange) */
export function hisWordsFolded(novel, chapters) {
  const out = [];
  for (const id of (novel && novel.order) || []) {
    for (const p of ((chapters[id] || {}).passages) || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (hisChange(v) && String(v.text || '').trim()) out.push(String(v.text));
    }
  }
  return out.length ? foldedText(out.join('\n\n')) : null;
}
/* whether an answer claims the book contradicts a card of his (so the fold of his words is made only then) */
const claimsContradiction = (o) => [...NOTE_KINDS, 'gone'].some((k) => Array.isArray(o && o[k]) && o[k].some((r) => r && cleanText(r.contradicts)));

/* What a record put right may draw on (foldNotes' `grounds`): the book's
 * passages as they stand, and his About this book — what it's about, how it
 * reads, and what is kept of them */
export function groundsOf(novel) {
  const chapters = chaptersOf(novel);
  const kept = Object.values((novel && novel.kept) || {}).map((k) => (k && typeof k === 'object' ? k.text : '')).filter(Boolean);
  return foldedText([...(novel.order || []).map((id) => chapterText(chapters[id] || { passages: [] })), novel.brief || '', novel.style || '', ...kept, ...standingPremises(novel, chapters).map((x) => x.text), ...entriesForNotes(novel).map(entryWords)].join('\n\n'));
}
/* HIS PREMISES THAT ARE STILL THE BOOK (2.12.41, the audit — his newest word wins): a premise stands until his newer
 * word on its passage says otherwise (shape.js laterWords) — and from then on it is shown beside that word as what it
 * stands over, never counted as the book: never a ground for a card, never what keeps a card from going, never quoted
 * as the book's words (groundsOf, standsFolded, bookFolded). His newer word says otherwise when it is an instruction —
 * the passage written again with a note of his, or the words he selected, or written anew by his partner — or when a
 * change of his hand on the page, or of his partner's, took out of it a name the premise gives: "Tom, Mara's brother,
 * comes home" and then "She had never had a brother". A slip he mended, or a name changed everywhere, leaves the premise
 * standing: it never takes his world out of the book. What a change took out is decided from the change, as it was made
 * (shape.js inPlaceFields `took`, names.js nameWordsGone) — 2.12.41, the review: read from the notes as they stood, the
 * answer turned over once a reading took the name's card away, and the premise was the book again. */
const INSTRUCTS = new Set(['rewrite', 'selection', 'anew']);
export function standingPremises(novel, chapters) {
  return premisesOf(novel, chapters).filter((x) => {
    const later = x.later || [];
    if (!later.length) return true;
    if (later.some((w) => INSTRUCTS.has(w.how))) return false;
    const gives = nameWordsIn(x.text);
    return !later.some((w) => (w.took || []).some((k) => gives.has(k)));
  });
}
/* What a card's name may stand in for "gone" to be refused (foldNotes' `stands`): the book and his premises
 * (bookFolded), and his bibliography's entries (2.12.37: a card for a name his entry gives is never "gone" for no page
 * naming it) */
export function standsFolded(novel) {
  const chapters = chaptersOf(novel);
  return foldedText([...(novel.order || []).map((id) => chapterText(chapters[id] || { passages: [] })), ...standingPremises(novel, chapters).map((x) => x.text), ...entriesForNotes(novel).map(entryWords)].join('\n\n'), { cased: true });
}
/* HIS ENTRIES BESIDE THE NOTES (2.12.37): those the words read name (`text`), found as the page finds them — never one
 * set to Never (2.12.40, the audit: bibliography.js entriesForNotes, entriesNamed) */
export function entriesNamedIn(novel, text) {
  if (!String(text || '').trim()) return [];
  return entriesNamed(entriesForNotes(novel), text);
}
/* his entries joined to a card of the notes, each with its card ({entry, card: {kind, id}}): the join made against the
 * whole notes (bibliography.js entryJoins, kept while the names stand) — never one set to Never */
function joinedEntries(novel) {
  const notes = (novel && novel.notes) || {};
  const joins = entryJoins(entriesOf(novel), notes);
  return entriesForNotes(novel).map((e) => ({ entry: e, card: joins.get(e.id) || null })).filter((x) => x.card);
}
/* his entries for some cards (`cards`: {kind: [card]}, or a Set of their ids) — an entry and a card for one name, as the
 * bibliography joins them. 2.12.40, the audit: joined against the cards checked alone, a group holding only Mei Ling
 * was given Mei Lin's entry (the two go by "Mei"), and "Emilia", two cards' in the notes, the one Emilia the group had.
 * Joined against the whole notes, then kept where its card is among these. */
export function entriesForCards(novel, cards) {
  const ids = cards instanceof Set ? cards : new Set(NOTE_KINDS.flatMap((k) => ((cards && cards[k]) || []).map((c) => c && c.id)));
  return joinedEntries(novel).filter((x) => ids.has(x.card.id)).map((x) => x.entry);
}
/* HIS WORDS BESIDE THE NOTES, FITTED TO THEIR ROOM IN ONE PASS (2.12.40, the audit: each fit built its part again for
 * every row it let go — a thousand premises, a thousand times, two seconds on the page's thread — kept the earliest
 * rows whatever they were, and one long row first left none, nothing said): the rows that matter here first, then the
 * newest; a long one by its opening (prompts.js premiseRow, entryRow); told in the book's order; how many were left out,
 * said even when none fits (util.js fitRows). */
const byNewest = (a, b) => (Number(b.at) || 0) - (Number(a.at) || 0);
/* the finder for the names in question: cards' names (as the page finds them) and names given as words */
function namesFinder({ cards = null, names = null } = {}) {
  const forms = [];
  if (cards) forms.push(...nameForms([], cards));
  for (const n of names || []) if (String(n || '').trim().length >= 2) forms.push({ form: String(n).trim(), refs: ['n'] });
  return forms.length ? makeFinder(forms) : null;
}
/* his premises: those that name the cards checked (or the names his words give) first, then the newest — weigh: each with
 * his entries written after it for a name it gives (premisesWeighed), the notes' check */
export function premisesFitted(novel, chapters, room, { cards = null, names = null, weigh = false } = {}) {
  const all0 = premisesOf(novel, chapters);
  if (!all0.length) return { premises: [], premisesLeft: 0 };
  const all = weigh ? premisesWeighed(novel, all0) : all0;
  const finder = namesFinder({ cards, names });
  const ranked = all.map((x, i) => ({ x, i, hit: Boolean(finder && finder.find(x.text).length) }))
    .sort((a, b) => Number(b.hit) - Number(a.hit) || byNewest(a.x, b.x) || b.i - a.i);
  const overhead = estimateTokens(premisesHead(all.some((x) => (x.later || []).length > 0))) + estimateTokens(leftLine('premise', all.length)) + 2;
  const { kept, left } = fitRows(ranked, Math.max(0, room), (r) => estimateTokens(premiseRow(r.x)) + 1, overhead);
  return { premises: kept.sort((a, b) => a.i - b.i).map((r) => r.x), premisesLeft: left };
}
/* his entries (all of them for the names in question): the newest first, told in the order given — each with what is
 * said after them of a premise of his typed after it (entryOverWords: entriesWeighed) counted with it */
export function entriesFitted(list, room) {
  const all = (list || []).map((e, i) => ({ e, i, at: e && e.at }));
  if (!all.length) return { entries: [], entriesLeft: 0 };
  const weighed = all.some((r) => entryOverWords(r.e));
  const overhead = estimateTokens(`${ENTRIES_HEAD}\n"""\n\n"""`) + estimateTokens(leftLine('entry', all.length)) + 2 + (weighed ? 24 : 0);
  const size = (r) => estimateTokens(entryRow(r.e)) + 2 + (entryOverWords(r.e) ? estimateTokens(entryOverWords(r.e)) + 2 : 0);
  const { kept, left } = fitRows([...all].sort((a, b) => byNewest(a, b) || a.i - b.i), Math.max(0, room), size, overhead);
  return { entries: kept.sort((a, b) => a.i - b.i).map((r) => r.e), entriesLeft: left };
}
/* WHICH OF HIS WORDS CAME AFTER THE OTHER, A PREMISE OR AN ENTRY (2.12.41, the review — his newest word wins: the two
 * were never weighed by which was newer). A premise's names are found as the page finds a name (bibliography.js
 * entriesNamed); a premise or an entry with no time kept is never the newer. Copies — one with nothing newer as it was:
 * - a premise, with his entries written after it for a name it gives (`entryOver`: their names) — never one set to Never;
 * - an entry, with his premises still the book (standingPremises) typed after it that name it (`premiseOver`: their
 *   passages). */
export function premisesWeighed(novel, premises) {
  const namer = entriesNamer(entriesForNotes(novel));
  return (premises || []).map((x) => {
    const at = Number(x && x.at) || 0;
    const newer = namer(x && x.text).filter((e) => (Number(e.at) || 0) > at).map((e) => e.name);
    return newer.length ? { ...x, entryOver: newer } : x;
  });
}
export function entriesWeighed(novel, chapters, entries) {
  const list = (entries || []).filter(Boolean);
  if (!list.length) return entries || [];
  const oldest = Math.min(...list.map((e) => Number(e.at) || 0));
  const namer = entriesNamer(list);
  const over = new Map();
  for (const x of standingPremises(novel, chapters)) {
    const at = Number(x.at) || 0;
    if (!at || at <= oldest) continue;
    for (const e of namer(x.text)) if (at > (Number(e.at) || 0)) over.set(e.id, [...(over.get(e.id) || []), x.label]);
  }
  return (entries || []).map((e) => (e && over.has(e.id) ? { ...e, premiseOver: over.get(e.id) } : e));
}
/* the Timeline's newest turns for some cards (ids), at most three each, in the book's order, fitted to `room` tokens —
 * the newest first when they cannot all ride: the earliest go */
/* (events: the Timeline's, when the caller has them already) */
function turnsFitted(novel, chapters, ids, room, events = null) {
  if (!events) { try { events = timelineOf(novel, chapters, {}).events; } catch (_) { events = []; } }
  const per = new Map();
  const keep = new Set();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const mine = (e.cards || []).filter((id) => ids.has(id));
    if (!mine.length || !mine.some((id) => (per.get(id) || 0) < 3)) continue;
    for (const id of mine) per.set(id, (per.get(id) || 0) + 1);
    keep.add(i);
  }
  const all = events.filter((_, i) => keep.has(i));
  if (!all.length) return { turns: [], turnsLeft: 0 };
  const overhead = estimateTokens(TIMELINE_HEAD) + estimateTokens(leftLine('turn', all.length)) + 2;
  const { kept, left } = fitRows([...all].reverse(), Math.max(0, room), (e) => estimateTokens(timelineRow(e)) + 1, overhead);
  const on = new Set(kept);
  return { turns: all.filter((e) => on.has(e)), turnsLeft: left };
}
/* THE PRINT OF HIS ENTRIES, EACH BY ITS WORDS (2.12.37: when an entry under a card changes — by his hand, his partner,
 * Quick add or a lorebook — the notes are checked against it, auditDue). 2.12.40, the audit: the print was one hash of
 * the joined entries in their order, so a reading that made a card for a name his entry already had, or an entry taken
 * out and put back (at the end of the list), owed a whole check with no entry changed. Now each entry for the notes by
 * id and the hash of its words, in the order of their ids, the ones joined to a card marked "+": owed is an entry under
 * a card whose words differ from those the last check saw (or new), or one under a card then that is gone — never a
 * new join of words already seen. */
const entryHash = (e) => hashText(JSON.stringify([e.name, e.aka || [], e.line || '', e.text || '']));
export function entriesPrint(novel) {
  const entries = entriesForNotes(novel);
  if (!entries.length) return '';
  const joined = new Set(joinedEntries(novel).map((x) => x.entry.id));
  return entries.map((e) => `${e.id}=${entryHash(e)}${joined.has(e.id) ? '+' : ''}`).sort().join(',');
}
/* whether the entries owe the notes a check since the print `was` (a print kept before 2.12.40 — one hash, no "=" — is
 * read as it was made: the joined entries' words in their order) */
export function entriesOwed(novel, was) {
  const stored = String(was || '');
  if (stored && !stored.includes('=')) {
    const notes = (novel && novel.notes) || {};
    const joins = entryJoins(entriesOf(novel), notes);
    const rows = entriesForNotes(novel).filter((e) => joins.get(e.id)).map((e) => [e.name, e.aka || [], e.line || '', e.text || '']);
    return stored !== (rows.length ? hashText(JSON.stringify(rows)) : '');
  }
  const seen = new Map();
  for (const row of stored ? stored.split(',') : []) {
    const m = /^(.+)=([0-9a-z]+)(\+?)$/.exec(row);
    if (m) seen.set(m[1], { h: m[2], joined: Boolean(m[3]) });
  }
  const now = joinedEntries(novel);
  const here = new Set(now.map((x) => x.entry.id));
  if (now.some((x) => { const s = seen.get(x.entry.id); return !s || s.h !== entryHash(x.entry); })) return true;
  return [...seen].some(([id, s]) => s.joined && !here.has(id));
}
/* The book's words as they stand, folded once, for asking whether a card's
 * name still stands in it (foldNotes' `stands`) — with his premises, his word
 * on the book (2.12.36: a card his premise alone names is never "gone" for no
 * page naming it, and a thread his premise sets up is quoted from it) — only
 * those still the book (standingPremises, 2.12.40) */
export function bookFolded(novel) {
  const chapters = chaptersOf(novel);
  return foldedText([...(novel.order || []).map((id) => chapterText(chapters[id] || { passages: [] })), ...standingPremises(novel, chapters).map((x) => x.text)].join('\n\n'), { cased: true });
}
/* …and for the check's judgment of his cards (foldNotes' `mine`): the book with the premises that are still the book,
 * the pages alone, and each of those premises with when he typed it — a premise older than his card never says the
 * book is otherwise than his card (2.12.40, the audit: a premise "a fledgling vampire" turned his card typed after it,
 * "a higher vampire", into the fledgling, and the card was his no longer). Against his card, only a premise whose
 * passage has no later word of his at all (2.12.41, the review: one he had edited since — his newer word, "a higher
 * vampire" written back into the page — still overturned the card he had written before it) */
function mineBook(novel) {
  const chapters = chaptersOf(novel);
  const pages = (novel.order || []).map((id) => chapterText(chapters[id] || { passages: [] })).join('\n\n');
  const standing = standingPremises(novel, chapters);
  const untouched = standing.filter((x) => !(x.later || []).length);
  return { book: foldedText([pages, ...standing.map((x) => x.text)].join('\n\n'), { cased: true }), pages: foldedText(pages, { cased: true }), premises: untouched.map((x) => ({ at: Number(x.at) || 0, f: foldedText(x.text, { cased: true }) })) };
}

/* One reading's changes laid over the undo record: a card keeps the copy from
 * before the first reading that touched it, and the copy after the last. */
function mergeUndo(undo, cards) {
  const list = [...((undo && undo.cards) || [])];
  for (const c of cards) {
    const i = list.findIndex((x) => x.id === c.id && x.kind === c.kind);
    if (i >= 0) list[i] = { ...list[i], after: c.after };
    else list.push(c);
  }
  return list.filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
}
const changedOf = (cards) => cards.map((c) => ({ kind: c.kind, name: (c.after || c.before).name, how: !c.before ? 'new' : !c.after ? 'gone' : 'changed' }));

/* ------------------------------------------------------------- calling */

/* the helper's answer needs room — the floor his law allows; never lower than
 * he set, never more than its model holds */
function helperRoom(conn) {
  const set = Number.isFinite(conn.maxTokens) && conn.maxTokens > 0 ? conn.maxTokens : 0;
  return Math.max(1024, Math.min(Math.max(set, 6000), Math.floor(contextOf(conn) * 0.4)));
}

/* how much of the helper's model the notes may take (Cozy Tavern's M664):
 * past this, the cards the words in hand do not name ride by their first line */
export function notesRoomOf(conn) { return Math.max(2000, Math.floor(contextOf(conn) * 0.3)); }

/* how many tokens of the book a helper's request can carry, beside its notes
 * (and beside the reply's room, raised for a model that thinks) */
export function readingRoom(conn, fixed) {
  const reply = thinksOn(conn) ? Math.max(helperRoom(conn), thinkingFloor(conn)) : helperRoom(conn);
  return contextOf(conn) - reply - 1500 - fixed;
}
/* the least of its model the book is read in, beside the notes (Cozy Tavern M752): a quarter */
const bookFloor = (conn) => Math.max(1500, Math.floor(contextOf(conn) * 0.25));
/* WHAT HIS WORDS BESIDE THE BOOK MAY TAKE (2.12.40, the audit — the notes' check, and What it's about written from the
 * book). Through 2.12.39 his premises, his entries, the Timeline's turns and his other words took their fifths on top
 * of the notes, and a chapter that rode whole without them — not summed up yet — was told by its opening and close.
 * Now they take what is left once the book has its room beside the rest (`fixed`): never below its floor, and never so
 * much that a chapter the book would tell whole, with no summary to tell it by, goes to its opening and close — it stays
 * whole, with every chapter after it (the book is told whole from its newest back), the ones before it in short. */
const BARE = /^\((?:not summarised yet|The summary is waiting)/;
function besideRoom(conn, novel, chapters, fixed) {
  const room = readingRoom(conn, fixed);
  if (room <= 0) return 0;
  const order = novel.order || [];
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room });
  const whole = new Set(fit.book.whole.map((x) => x.id));
  const ch = (id) => chapters[id] || { id, passages: [] };
  const from = order.findIndex((id) => whole.has(id) && BARE.test(shortOf(ch(id))));
  let keep = 0;
  if (from >= 0) order.forEach((id, i) => { if (i >= from) keep += estimateTokens(chapterText(ch(id))) + 12; else if (i >= fit.book.omitted) keep += estimateTokens(shortOf(ch(id))) + 12; });
  /* (the book as it is sent — its chapters' headings with it — a little over what the fit counts) */
  return Math.max(0, room - Math.max(bookFloor(conn), from >= 0 ? Math.ceil(keep * 1.02) + 60 : 0));
}

/* The shape of a notes answer: an object of the notes' parts — never one row
 * of them, which is what the first whole object of an answer cut off is
 * (Cozy Tavern's M246/M682: a cut answer stored as a finished reading) */
/* only the answer's own parts: a row's map of ties ("Aldric": …) found inside a reply cut off is no answer (Cozy Tavern's M685) */
const ANSWER_KEYS = new Set([...NOTE_KINDS, 'gone', 'mine', 'chapterName', 'about', 'style', 'clear', 'verdict', 'timeline', 'bibliography']);
export const notesShape = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => {
  if (!ANSWER_KEYS.has(k)) return false;
  /* A bad history does not discard sound notes or ask the model again.
   * Its valid events survive; its coverage stays incomplete (timeline.js). */
  if (k === 'timeline' || k === 'bibliography') return true;
  /* the check's judgment of his cards: rows it cannot read are passed by (foldNotes), never the whole answer lost */
  if (k === 'mine') return Array.isArray(o[k]);
  if (NOTE_KINDS.includes(k) || k === 'gone') return Array.isArray(o[k]) && o[k].every((row) =>
    Boolean(row) && typeof row === 'object' && !Array.isArray(row) && Boolean(cleanName(row.name)) && (k !== 'gone' || NOTE_KINDS.includes(row.kind)));
  if (k === 'clear') return truthOf(o[k]) !== undefined;
  return typeof o[k] === 'string' || (Array.isArray(o[k]) && o[k].every((x) => typeof x === 'string'));
});
const hasGone = (o) => Boolean(o && Array.isArray(o.gone) && o.gone.length);

export async function askJson(conn, system, request, { want, beforeAsk } = {}) {
  const room = helperRoom(conn);
  if (beforeAsk) await beforeAsk();
  const first = await ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: request }], maxTokens: room }), stream: true, worker: true, patient: true });
  if (!first.ok) return { ok: false, error: first.error, permanent: first.permanent, status: first.status, retryAfterMs: first.retryAfterMs, leashed: first.leashed, ...(first.longest ? { longest: true } : {}) };
  /* an answer cut off counts only when its object closed: one cut inside it holds pieces, never the answer (Cozy Tavern's M685, M737) */
  let obj = !first.cut || closesWhole(first.text) ? parseFirstObject(first.text, want) : null;
  /* a model that wrote its answer in its thinking and nothing after it: the last whole answer there is the answer (Cozy Tavern's M590) */
  if (!obj && !String(first.text || '').trim() && first.thinking && (!first.cut || closesWhole(first.thinking))) obj = parseLastObject(first.thinking, want);
  if (obj) return { ok: true, obj };
  /* let go on its leash partway: not out of room — asked again it would stall the same way */
  if (first.leashed) return { ok: false, error: first.error, status: 0, leashed: first.leashed, ...(first.longest ? { longest: true } : {}) };
  /* once more, told what went wrong — given more room when it ran out of it; never more than that */
  const cut = Boolean(first.cut);
  const more = cut ? Math.min(room * 2, Math.floor(contextOf(conn) * 0.6)) : room;
  if (beforeAsk) await beforeAsk();
  const second = await ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: request }, { role: 'assistant', content: String(first.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: cut ? JSON_CUT : JSON_AGAIN }], maxTokens: more }), stream: true, worker: true, patient: true });
  if (!second.ok) return { ok: false, error: second.error, permanent: second.permanent, status: second.status, retryAfterMs: second.retryAfterMs, leashed: second.leashed, ...(second.longest ? { longest: true } : {}) };
  obj = !second.cut || closesWhole(second.text) ? parseFirstObject(second.text, want) : null;
  if (!obj && !String(second.text || '').trim() && second.thinking && (!second.cut || closesWhole(second.thinking))) obj = parseLastObject(second.thinking, want);
  if (obj) return { ok: true, obj };
  if (second.leashed) return { ok: false, error: second.error, status: 0, leashed: second.leashed, ...(second.longest ? { longest: true } : {}) };
  return { ok: false, error: unreadWhy(second), unreadable: true, ...(second.cut ? { cut: true } : {}) };
}
/* why an answer could not be used, in plain words: the provider's reason for
 * an empty one (Cozy Tavern's M545), or how it began */
function unreadWhy(out) {
  const t = String((out && out.text) || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/\s+/g, ' ').trim();
  if (!t) return emptyWhy(out, out && out.thinking);
  return `its answer could not be read (it began: “${t.slice(0, 90)}${t.length > 90 ? '…' : ''}”)`;
}

/* Is the helper's model there at all? A small harmless ask — when a reading
 * fails, it tells the passage's fault from the model's (Cozy Tavern's M316).
 * Any words back prove it alive, as Cozy Tavern's keeperAlive: a model that
 * answers but not in the shape asked is there — what it would not answer is
 * the words' (set aside after two runs), never "down" for ever (D-U1). */
export async function probe(conn, { beforeAsk } = {}) {
  /* asked once, never waited out: a model that does not answer it now is down, and waited out as ever */
  if (beforeAsk) await beforeAsk();
  const out = await ask(conn, { build: () => ({ system: 'Answer with JSON only.', messages: [{ role: 'user', content: 'Answer with {"ok": true} and nothing else.' }], maxTokens: helperRoom(conn) }), stream: true, worker: true });
  if (!out.ok) return { ok: false, error: out.error, permanent: out.permanent, status: out.status };
  const said = String(out.text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim() || String(out.thinking || '').trim();
  return said ? { ok: true } : { ok: false, error: unreadWhy(out), unreadable: true };
}

/* Prefer paragraph ends, but a paragraph can itself be longer than the
 * model holds. Split that at counted words (including unspaced CJK), keeping
 * every character of it, so a long imported paragraph can still be read. */
/* (first: the first part's size, when it carries more than its words — the words it replaces, his premise: the parts
 * after it are `words` each; 2.12.40) */
export function partsOf(text, words = 9000, first = words) {
  words = Math.max(1, Math.floor(Number(words) || 9000));
  first = Math.max(1, Math.min(words, Math.floor(Number(first) || words)));
  const paras = String(text || '').split(/\n+/);
  const out = [];
  let cur = [];
  let n = 0;
  /* the room of the part being made: the first one's, until it is made */
  const room = () => (out.length ? words : first);
  for (const p of paras) {
    const w = countWords(p);
    if (w > room()) {
      if (cur.length) { out.push(cur.join('\n\n')); cur = []; n = 0; }
      if (w > room()) {
        const cjk = /[぀-ヿ㐀-鿿가-힯]/g;
        const starts = [...p.matchAll(cjk), ...p.replace(cjk, ' ').matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)].map((m) => m.index).sort((a, b) => a - b);
        let from = 0;
        for (let i = room(); i < starts.length; i += words) { out.push(p.slice(from, starts[i])); from = starts[i]; }
        out.push(p.slice(from));
        continue;
      }
    }
    if (n + w > room() && cur.length) { out.push(cur.join('\n\n')); cur = []; n = 0; }
    cur.push(p);
    n += w;
  }
  if (cur.length) out.push(cur.join('\n\n'));
  return out.filter((x) => x.trim());
}

/* his own words the helper is sent beside the book, as a fingerprint: a model
 * too small for them is asked again once he changes them (S12-G9) */
function wordsPrint(novel) { return hashText(aboutTheBook(novel, { plans: false, kept: 'his' })); }
/* turned away for good: by this connection (and, when his words were what filled its model, by them as they stood) */
function stillBlocked(novelId, conn) {
  const b = blocked.get(novelId);
  if (!b) return false;
  if (b.conn !== connPrint(conn)) return false;
  return !b.words || b.words === wordsPrint(store.peek('novel', novelId) || {});
}
/* too small a model, in plain words: his own words named when they are what fills it */
function tooSmallWhy(conn, novel, what) {
  const his = estimateTokens(aboutTheBook(novel, { plans: false, kept: 'his' }));
  const all = contextOf(conn);
  if (his > all * 0.3) return `your words in What it’s about and How it reads come to about ${his.toLocaleString()} tokens, and its model holds ${all.toLocaleString()} in all — too few to read the book beside them and ${what}. Shorten them, or choose a helper with more room`;
  return `its model holds ${all.toLocaleString()} tokens, too few to read the book beside ${what} — choose one with more room for the helper`;
}

/* which connection the helper uses, as a fingerprint: a refusal for good is
 * not asked again until it changes */
export function connPrint(conn) {
  const L = (conn && conn.learned) || {};
  return conn ? hashText(JSON.stringify([conn.url, conn.model, conn.key, conn.shape, conn.maxTokens, conn.context, conn.thinking, L.context, L.maxOut, L.drop, L.completionField])) : '';
}
/* who does it, as he chose it: his own settings only — a lesson the model
 * teaches about itself on the way (its room, a dial it refuses) is the same
 * choice, and never stops a reading or a checking in the middle */
export function choicePrint(conn) {
  return conn ? hashText(JSON.stringify([conn.id, conn.url, conn.model, conn.key, conn.shape, conn.maxTokens, conn.context, conn.thinking])) : '';
}
/* A completed reading can stand, but changing who reads must stop its next
 * request, including a JSON retry or a probe within the same stage. */
function requireHelper(novelId, conn) {
  const current = connFor(store.peek('house', 'house') || {}, 'helper');
  if (!store.peek('novel', novelId) || !current || choicePrint(current) !== (helperPrints.get(novelId) || choicePrint(conn))) {
    const e = new Error('who keeps the notes changed');
    e.helperChanged = true;
    throw e;
  }
}
function helperJson(novelId, conn, system, request, options = {}) {
  return askJson(conn, system, request, { ...options, beforeAsk: () => requireHelper(novelId, conn) });
}
function helperFault(novelId, conn, got) {
  return whoseFault(conn, got, { beforeAsk: () => requireHelper(novelId, conn) });
}

/* ----------------------------------------------------------- the reading */

export async function run(novelId) {
  if (runningFor.has(novelId) || entering.has(novelId)) { nudge(novelId, 5000); return; }
  if (writerBusy(novelId)) { nudge(novelId, 4000); return; }
  const house = store.peek('house', 'house') || {};
  const chosen = connFor(house, 'helper');
  const conn = chosen ? clone(chosen) : null;
  const print = conn ? choicePrint(conn) : '';
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  if (!conn) { setLight(novelId, 'off', 'No helper is chosen, so the notes are not being kept. Choose one in Settings → Connections (it can be the same as the writer).'); return; }
  /* refused for good (a key, an address, a model): not asked again until the connection changes */
  if (stillBlocked(novelId, conn)) return;
  blocked.delete(novelId);
  const work = async () => {
    runningFor.add(novelId);
    helperPrints.set(novelId, print);
    try {
      /* every chapter of the book in hand: the helper never works from a book missing one — it would read as empty, and what it holds be taken out of the notes */
      const missing = await loadChapters(novelId);
      if (missing) throw new Error(`${missing === 1 ? 'a chapter' : `${numberWords(missing).toLowerCase()} chapters`} of the book could not be read just now`);
      await mustHold('helper', novelId);
      pruneAside(novelId);
      healCards(novelId);
      /* parts one connection would not read are tried again once the helper's connection is another (S08-G11) */
      const print = connPrint(conn);
      for (const x of asideNow(store.peek('novel', novelId))) if (x.conn && x.conn !== print && !x.out) unsetAside(novelId, x.key);
      await readChanges(novelId, conn);
      await stretchUp(novelId, conn);
      await sceneStretchUp(novelId, conn);
      await summarise(novelId, conn);
      /* each summary held once against its own words, a few a run — the rest next time (summarycheck.js) */
      const checksLeft = await checkSummaries(novelId, conn);
      /* the bibliography filled for pages read before it was kept, a few a run (bibliography.js) */
      const bibLeft = await bibBackfill(novelId, conn);
      /* the Timeline put right by itself: pages read before it was kept, or whose turns were left behind (2.12.37) */
      const turnsLeft = await timelineBackfill(novelId, conn);
      /* the check a book opened since the check learned more owes, once its facts are in */
      owedCheck(novelId, conn, bibLeft);
      await keepTheBook(novelId, conn);
      await auditNotes(novelId, conn);
      failures.delete(novelId);
      const left = pendingWork(novelId) || checksLeft || bibLeft || turnsLeft;
      if (left) nudge(novelId, 2000);
      else {
        finishReread(novelId);
        setLight(novelId, 'idle', 'The notes are up to date.');
        /* a check owed now (after reading the whole book again, or a row kept on a card of its own) runs next */
        if (auditDue(store.peek('novel', novelId))) nudge(novelId, 1500);
      }
    } catch (e) {
      const why = (e && e.message) || String(e);
      if (e && e.helperChanged) {
        if (!store.peek('novel', novelId)) return;
        if (connFor(store.peek('house', 'house') || {}, 'helper')) { setLight(novelId, 'waiting', 'The helper changed — the notes carry on with the connection chosen now.'); nudge(novelId, 1500); }
        else setLight(novelId, 'off', 'No helper is chosen, so the notes are not being kept.');
        return;
      }
      /* another browser has the book now: it finishes the work */
      if (e && e.yielded) {
        setLight(novelId, 'waiting', ELSEWHERE);
        nudge(novelId, 30000);
        return;
      }
      /* it made way for his page on its connection: it reads on once the page has gone */
      if (e && e.gaveWay) {
        setLight(novelId, 'waiting', 'The helper made way for your page on its connection — it reads on in a moment.');
        nudge(novelId, 20000);
        return;
      }
      /* a reading its model would not answer: read again at once, one passage at a time */
      if (e && e.soon) {
        setLight(novelId, 'reading', `The helper reads one passage at a time now (${why}).`);
        nudge(novelId, 1500);
        return;
      }
      if (e && e.permanent) {
        blocked.set(novelId, { conn: connPrint(conn), words: e.wordsPrint || null });
        failures.delete(novelId);
        setLight(novelId, 'trouble', `The helper’s connection was turned away (${why}). It reads again once the connection is put right in Settings → Connections.`);
        return;
      }
      const later = retryLater(novelId, e && e.retryAfterMs);
      setLight(novelId, later.n >= 3 ? 'trouble' : 'waiting', `The helper couldn’t finish just now (${why}). It tries again by itself in ${later.words}.`);
    } finally {
      runningFor.delete(novelId);
      helperPrints.delete(novelId);
    }
  };
  /* one browser reads a book at a time (the phone's lease), and one window of it */
  const leased = () => withLease('helper', novelId, work, { refused: (held) => {
    if (!held.unreachable) setLight(novelId, 'waiting', ELSEWHERE);
    nudge(novelId, Math.max(20000, Math.min(held.left || 0, 90000)));
  } });
  entering.add(novelId);
  try {
    if (globalThis.navigator && navigator.locks && navigator.locks.request) {
      await navigator.locks.request(`cozynovel-helper-${novelId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) { nudge(novelId, 20000); return; }
        await leased();
      });
    } else {
      await leased();
    }
  } finally {
    entering.delete(novelId);
  }
}

/* is there anything the helper has not read? */
export function pendingWork(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return false;
  if (novel.memory && (novel.memory.removed || []).length) return true;
  if (toKeep(novel).length) return true;
  for (const id of novel.order || []) {
    const c = store.peek('chapter', id);
    if (!c) return true;
    const ch = changesIn(novel, c);
    if (ch.changes.length || ch.removed.length) return true;
  }
  return false;
}

function failed(got) {
  const e = new Error(got.error || 'the helper got no answer');
  e.permanent = Boolean(got.permanent);
  if (got.retryAfterMs) e.retryAfterMs = got.retryAfterMs;
  /* it made way for his page on the same connection: it reads again a little later, never narrowed or counted */
  if (got.leashed === 'gaveway') e.gaveWay = true;
  return e;
}

/* A failed ask: the words' fault (its model answers a harmless ask, but not
 * this one), the model's ('model': it is down, waited out as ever), or the
 * probe's own failure (a connection refused for good stays refused). A
 * passing fault is never probed: it is waited out. */
export async function whoseFault(conn, got, { beforeAsk } = {}) {
  const passing = !got.unreadable && !got.permanent;
  if (passing) return 'model';
  /* the key, the account, the model's address: the connection's, never asked again to find out */
  if (got.permanent && ([401, 402, 404, 405].includes(got.status) || /the key was refused|out of credit|was not found/.test(String(got.error || '')))) return got;
  const alive = await probe(conn, { beforeAsk });
  if (alive.ok) return 'words';
  return alive.permanent ? alive : 'model';
}
/* the model's fault: it is down just now, so the failed ask is waited out —
 * never kept as a refusal for good, whatever the failed ask was called (a
 * refusal while its model was down could not be told from the model's) */
export const passingFrom = (got) => ({ ...got, permanent: false });
/* what one ask held, for counting its failed runs */
function askedKey(B) {
  return [...B.items.map((c) => c.sig + (c.partial || c.whole !== undefined ? ':' + hashText(JSON.stringify([c.old || '', c.text])) : '')), ...B.removed.map((r) => 'out:' + (r.key || r.pid) + (r.partial !== undefined ? ':' + hashText(r.text) : '')), ...B.chapters.map((r) => 'chapter:' + r.id + ':' + hashText(r.text))].join('|');
}
/* a chapter taken out whole is done with once its last part is read (or set aside) */
function clearOut(novelId, B) {
  const ids = B.chapters.filter((p) => p.last).map((p) => p.id);
  if (ids.length) store.change('novel', novelId, novelSteps.clearRemoved(ids));
}
/* Set aside: marked read with nothing taken from it, and kept on the book
 * with why — so he sees it in the notes and can have it read again. */
function setAside(novelId, chapter, B, why, conn = null) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const said = cutWords(why || '', 300);
  /* which connection would not read it: another one is let try (S08-G11) */
  const by = conn ? { conn: connPrint(conn) } : {};
  const entries = {};
  if (chapter && (B.items.length || B.removed.length)) {
    const map = { ...((novel.memory || {}).seen || {})[chapter.id] };
    for (const c of B.items.filter((x) => !x.partial)) map[c.pid] = c.sig;
    for (const r of B.removed.filter((x) => !x.partial)) delete map[r.pid];
    store.change('novel', novelId, novelSteps.seen(chapter.id, map));
    const keys = B.removed.filter((r) => r.key && !r.partial).map((r) => r.key);
    if (keys.length) store.change('chapter', chapter.id, chapterSteps.clearRetired(keys));
    const label = readLabel(novel, chapter, B.items) || chapterLabel(novel, chapter);
    for (const c of B.items) entries[c.pid] = { chapterId: chapter.id, sig: c.sig, label: label + (c.partial || c.whole !== undefined ? ' (a part of it)' : ''), why: said, at: Date.now(), ...by };
    if (!B.items.length) entries['out:' + chapter.id] = { label: `what was taken out of ${chapterLabel(novel, chapter)}`, why: said, at: Date.now(), ...by };
  }
  for (const part of B.chapters) entries['out:chapter:' + part.id] = { label: 'a chapter taken out', why: said, at: Date.now(), ...by };
  store.change('novel', novelId, novelSteps.setAside(entries));
  clearOut(novelId, B);
}
/* The parts set aside as the book stands now: each labelled where it stands
 * now (a passage moved or renumbered says so), none for a passage, chapter or
 * summary no longer in the book (S02-G13) */
export function asideNow(novel) {
  const all = (novel && novel.memory && novel.memory.aside) || {};
  const chapters = chaptersOf(novel);
  const where = new Map();
  for (const id of (novel && novel.order) || []) for (const p of ((chapters[id] || {}).passages) || []) where.set(p.id, id);
  const out = [];
  for (const [key, a] of Object.entries(all)) {
    if (key.startsWith('summary:')) { const cid = key.slice(8); if (chapters[cid]) out.push({ ...a, key, label: `the summary of ${chapterLabel(novel, chapters[cid], { withName: false })}`, out: false }); continue; }
    if (key.startsWith('out:chapter:')) { out.push({ ...a, key, out: true }); continue; }
    if (key.startsWith('out:')) { const cid = key.slice(4); if (chapters[cid]) out.push({ ...a, key, label: `what was taken out of ${chapterLabel(novel, chapters[cid], { withName: false })}`, out: true }); continue; }
    const cid = where.get(key);
    if (!cid) continue;
    out.push({ ...a, key, chapterId: cid, label: passageLabel(novel, chapters[cid], key) + (/\(a part of it\)$/.test(a.label || '') ? ' (a part of it)' : ''), out: false });
  }
  return out;
}
/* what stands set aside for a passage, chapter or summary no longer in the book goes (every chapter in hand: run) */
function pruneAside(novelId) {
  const novel = store.peek('novel', novelId);
  const all = (novel && novel.memory && novel.memory.aside) || {};
  if (!Object.keys(all).length) return;
  const keep = new Set(asideNow(novel).map((x) => x.key));
  const drop = Object.keys(all).filter((k) => !keep.has(k));
  if (drop.length) store.change('novel', novelId, novelSteps.dropAside(drop));
}
/* the part set aside let go, to be read afresh: its passage's mark of read taken off where it stands now */
function unsetAside(novelId, key) {
  const novel = store.peek('novel', novelId);
  const a = novel && novel.memory && novel.memory.aside && novel.memory.aside[key];
  if (!a) return false;
  const now = asideNow(novel).find((x) => x.key === key);
  const cid = (now && now.chapterId) || a.chapterId;
  if (cid && a.sig) {
    const map = { ...((novel.memory || {}).seen || {})[cid] };
    if (map[key] === a.sig) delete map[key];
    store.change('novel', novelId, novelSteps.seen(cid, map), { now: true });
  }
  store.change('novel', novelId, novelSteps.dropAside([key]), { now: true });
  return true;
}
/* Read it again: a passage set aside is read afresh */
export function readAside(novelId, key) {
  if (!unsetAside(novelId, key)) return false;
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, 300);
  return true;
}
/* Read them all again: every part set aside, read afresh ("Let it go" for what was taken out) */
export function readAllAside(novelId) {
  const novel = store.peek('novel', novelId);
  let n = 0;
  for (const x of asideNow(novel || {})) if (unsetAside(novelId, x.key)) n += 1;
  if (n) { failures.delete(novelId); blocked.delete(novelId); nudge(novelId, 300); }
  return n;
}

/* What the earlier parts of a passage read in parts changed, taken back —
 * where it still reads as they left it — and the notes' Undo and light as
 * they were before it began: the next reading starts it clean */
function takeBackInParts(novelId, parts) {
  const live = store.peek('novel', novelId);
  if (!live) return;
  if ((parts.cards || []).length) store.change('novel', novelId, novelSteps.undoCards(parts.cards), { now: true });
  for (const [key, k] of Object.entries(parts.kept || {})) {
    const cur = (live.kept && live.kept[key]) || null;
    if (JSON.stringify(cur) === JSON.stringify(k.after || null)) store.change('novel', novelId, novelSteps.setKept(key, k.before || null), { now: true });
  }
  store.change('novel', novelId, novelSteps.setMemory({ ...(parts.from ? { undo: parts.from.undo, lit: parts.from.lit } : {}), inParts: null }), { now: true });
}

async function readChanges(novelId, conn) {
  /* a passage left half read when a window closed: its earlier parts taken back before anything is read */
  const left = ((store.peek('novel', novelId) || {}).memory || {}).inParts;
  if (left) takeBackInParts(novelId, left);
  for (let guard = 0; guard < 200; guard++) {
    /* what the readings kept can settle is settled first, with no call */
    if (settleNow(novelId)) tellLight(novelId);
    const novel = store.peek('novel', novelId);
    if (!novel) return;
    const house = store.peek('house', 'house') || {};
    /* a whole chapter taken out comes first */
    const removedChapters = (novel.memory && novel.memory.removed) || [];
    let target = null;
    for (const id of novel.order || []) {
      const c = store.peek('chapter', id);
      if (!c) continue;
      const ch = changesIn(novel, c);
      if (ch.changes.length || ch.removed.length) { target = { chapter: c, ...ch }; break; }
    }
    /* nothing left to read: one at a time is over */
    if (!target && !removedChapters.length) { narrow.delete(novelId); return; }
    const chapter = target ? target.chapter : null;
    const label = chapter ? chapterLabel(novel, chapter) : 'the book';
    const at = chapter ? novel.order.indexOf(chapter.id) + 1 : 0;
    setLight(novelId, 'reading', `Reading ${label}…`);
    /* sized to the helper's model: what rides beside the notes (the notes
     * themselves fitted to its room — M664 — with room for the cards the
     * passages name to ride whole) */
    const notesFit = notesRoomOf(conn);
    /* a long change is read in parts; the first part carries what was taken out */
    const changes = target ? target.changes : [];
    /* the premise he typed for each passage read, shown beside it (2.12.36): his word on the book — with what he did to
     * the passage since, his newer word on it (2.12.40, shape.js laterWords), and when he typed it; and whether the words
     * read are his own (a page he wrote himself, or one his own hand changed for the most part — shape.js ownWords,
     * 2.12.41: never a page a name changed everywhere or a mended word touched): beside his entries, his newer word */
    /* (and his entries written after the premise for a name it gives: they stand over it where they differ — 2.12.41) */
    let namer = null;
    for (const c of changes) {
      const p = c.pid && chapter ? (chapter.passages || []).find((x) => x.id === c.pid) : null;
      c.premise = p ? premiseOf(p) : '';
      c.later = c.premise ? laterWords(p) : [];
      c.premiseAt = c.premise ? premiseAt(p) : 0;
      c.his = Boolean(p && ownWords(p));
      if (c.premise) {
        if (!namer) namer = entriesNamer(entriesForNotes(novel));
        const newer = namer(c.premise).filter((e) => (Number(e.at) || 0) > c.premiseAt).map((e) => e.name);
        if (newer.length) c.entryOver = newer;
      }
    }
    const removed = target ? target.removed : [];
    const firstChanged = changes.length ? chapter.passages.findIndex((p) => p.id === changes[0].pid) : -1;
    const before = chapter && firstChanged > 0 ? chapterText({ passages: chapter.passages.slice(0, firstChanged) }) : '';
    /* the notes measured as they are sent: every card all of what is read now names, whole — no reading of a part of it carries more (Cozy Tavern M714: a request measured without what it carries) */
    /* (his premise among those words, as the request has them: prompts.js readingFocus — 2.12.40) */
    const focusAll = [before, ...changes.map(readingFocus), ...removed.map((r) => String((r && r.text) || '')), ...removedChapters.map((r) => String((r && r.text) || ''))].join('\n');
    /* Count the request's actual fixed words, including the history's
     * format and rules. The former guessed instructions plus a 1,500-token
     * safety allowance refused a 6,000-token helper that still had ample
     * room. With the fixed request measured, 600 tokens remain as safety,
     * and 160 more cover source labels and the part's position. */
    const named = namedBook(novel, house);
    const fixedWith = (notes) => estimateTokens(helperFrame(house, novel)) + estimateTokens(notesRequest({
      novel: named, chapterLabel: label, before: '', changes: [], removed: [], removedChapters: [],
      notesShown: notes, at, of: (novel.order || []).length, later: true, goesOn: true, codex: bibReading(novel, conn),
    })) + 160;
    const roomWith = (notes) => readingRoom(conn, fixedWith(notes)) + 900;
    let room = roomWith(notesText(named, { forHelper: true, fit: notesFit, focus: focusAll }));
    /* the cards it names cannot all ride whole beside it: past the notes' share they ride by their first line, as the others do — a reading is never refused for them (the fold never writes whole a card it saw by its first line) */
    let plain = false;
    if (room < 600) {
      const plainRoom = roomWith(notesText(named, { forHelper: true, fit: notesFit }));
      if (plainRoom >= 600) { plain = true; room = plainRoom; }
    }
    if (room < 600) {
      const e = new Error(tooSmallWhy(conn, novel, 'its notes'));
      e.permanent = true;
      /* not asked again until the connection changes — or his own words do (S12-G9: shortening them lifts it) */
      e.wordsPrint = wordsPrint(novel);
      throw e;
    }
    const batchWords = Math.max(200, Math.min(9000, Math.floor((room * 0.6) / 1.4)));
    /* Every tiny passage still has a source label and prose around it.
     * Count that cost in the batch too: hundreds of one-line passages
     * cannot share the room of a single passage with the same word count. */
    const sourceWords = Math.ceil(estimateTokens(`Passage source Passage 1234\nThis part of ${label} was changed. It used to read:\n"""\n\n"""\nIt now reads:\n"""\n\n"""`) / 1.4);
    const beforeChars = Math.max(0, Math.min(60000, Math.floor(room * 0.3 * 3.2)));
    /* a part written into the middle of a chapter: the chapter goes on after it, already read */
    const lastChanged = changes.length ? Math.max(...changes.map((c) => chapter.passages.findIndex((p) => p.id === c.pid))) : -1;
    const goesOn = lastChanged >= 0 && chapter.passages.slice(lastChanged + 1).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
    /* the book already read past this chapter (never while the whole book is
     * read again from the start): this part is read out of turn */
    const laterRead = Boolean(at) && (novel.order || []).slice(at).some((id) => Object.keys(((novel.memory || {}).seen || {})[id] || {}).length > 0);
    const beforeTail = before.length > beforeChars ? (beforeChars > 200 ? '[…]\n' + before.slice(-beforeChars) : '') : before;
    /* the book's newest passage is read on its own, so its version's notes
     * are its own: another take of it can take them back exactly */
    const newest = changes.length && !goesOn && at === (novel.order || []).length ? changes[changes.length - 1].pid : '';
    /* the asks, each one call: its passages (`items`), and what was taken out
     * that rides with it — passages (`removed`), chapters taken out whole
     * (`chapters`: read in parts when long, never cut — Cozy Tavern's
     * M259-2/M265) */
    const one = narrow.has(novelId);
    const chapterParts = [];
    for (const r of removedChapters) {
      const ps = partsOf(r.text, batchWords);
      if (!ps.length) { chapterParts.push({ id: r.id, text: r.text, last: true }); continue; }
      ps.forEach((t, i) => chapterParts.push({ id: r.id, text: ps.length > 1 ? `${t}\n\n(part ${i + 1} of ${ps.length} of what it held)` : t, last: i === ps.length - 1 }));
    }
    const outWords = removed.reduce((a, r) => a + countWords(r.text) + sourceWords, 0) + chapterParts.reduce((a, r) => a + countWords(r.text) + sourceWords, 0);
    const ask = (fields) => ({ items: [], removed: [], chapters: [], before: '', ...fields });
    const batches = [];
    /* what was taken out rides with the first passages when it is short; alone and first when it is long, or one at a time is asked */
    const alone = one || outWords > batchWords / 4 || chapterParts.length > removedChapters.length;
    if (alone) {
      /* passages taken out, a few at a time (one at a time when asked) */
      let group = [];
      let gw = 0;
      for (const r of removed) {
        const w = countWords(r.text) + sourceWords;
        /* one longer than a reading holds: told in parts, done with at its last (Cozy Tavern M714) */
        if (w > batchWords) {
          if (group.length) { batches.push(ask({ removed: group })); group = []; gw = 0; }
          const ps = partsOf(r.text, batchWords);
          ps.forEach((t, i) => batches.push(ask({ removed: [{ ...r, text: ps.length > 1 ? `${t}\n\n(part ${i + 1} of ${ps.length} of what it said)` : t, partial: i < ps.length - 1 }] })));
          continue;
        }
        if (group.length && (one || gw + w > batchWords)) { batches.push(ask({ removed: group })); group = []; gw = 0; }
        group.push(r);
        gw += w;
      }
      if (group.length) batches.push(ask({ removed: group }));
      for (const part of chapterParts) batches.push(ask({ chapters: [part] }));
    }
    let batch = [];
    let words = 0;
    const push = () => { if (batch.length) batches.push(ask({ items: batch })); batch = []; words = 0; };
    for (const c of changes) {
      /* his premise as it rides beside the page — by its opening when long (prompts.js premiseBeside, 2.12.40: through
       * 2.12.39 it went whole, and a long one made every part of the page smaller, though only its first part carries it).
       * HIS PREMISE AND HIS NOTES SINCE SHARE ONE ROOM (2.12.41, the review: each note was cut by itself, with no room for
       * them all — four long notes made a small helper's reading too big for it): what the batch leaves once the page has
       * its floor (150 words) and the words it replaces theirs — his newest note first, the oldest cut first, what is left
       * out said (prompts.js premiseBeside) */
      const oldFirst = countWords(c.old) > batchWords - 150;
      c.besideRoom = Math.max(0, batchWords - 150 - (oldFirst ? 0 : countWords(c.old)) - sourceWords);
      const besideWords = countWords(premiseBeside(c));
      const w = countWords(c.text) + countWords(c.old) + besideWords + sourceWords;
      if (one) push();
      if (w > batchWords) {
        push();
        /* An old version can itself fill the room. Read every part being
         * replaced first, then every part replacing it, as one provisional
         * change. Its seen mark and reversible reading wait for the end. */
        if (oldFirst) for (const old of partsOf(c.old, batchWords)) batches.push(ask({ items: [{ ...c, whole: c.text, text: '', old, oldOnly: true, fromChange: true, partial: true, premise: '' }] }));
        /* the words replaced and his premise ride with the first part only: that part is made smaller for them, the
         * parts after it are not (2.12.40, the audit) */
        const parts = partsOf(c.text, Math.max(150, batchWords), Math.max(150, batchWords - besideWords - (oldFirst ? 0 : countWords(c.old))));
        if (!parts.length) parts.push('');
        parts.forEach((part, i) => batches.push(ask({ items: [{ ...c, whole: c.text, fromChange: Boolean(c.old), premise: i === 0 ? c.premise : '', text: part + (parts.length > 1 ? `\n\n(part ${i + 1} of ${parts.length})` : ''), old: !oldFirst && i === 0 ? c.old : '', partial: i < parts.length - 1 }] })));
        continue;
      }
      if ((words + w > batchWords || (c.pid === newest && changes.length > 1)) && batch.length) push();
      batch.push(c);
      words += w;
    }
    push();
    if (!batches.length) batches.push(ask({}));
    if (!alone) { batches[0].removed = removed; batches[0].chapters = chapterParts; }
    /* the chapter up to the new part rides with the first passages read */
    const firstItems = batches.find((x) => x.items.length);
    if (firstItems) firstItems.before = beforeTail;
    /* what a passage read in parts changed, gathered until its last part */
    let acc = [];
    let accKept = {};
    const histories = new Map();
    /* what each passage establishes for the bibliography, gathered as its history is (bibliography.js) */
    const codexes = new Map();
    /* A PASSAGE READ IN PARTS THAT CANNOT BE FINISHED (Cozy Tavern M205,
     * M218: a part-built reading is never left half in the notes): what its
     * earlier parts changed is taken back — where it still reads as they left
     * it — and the notes' Undo and light are as they were before it began, so
     * the next reading starts it clean, never over itself. Only that passage's
     * parts: what earlier readings of this pass finished stands. */
    let midPassage = false;
    let parts = { cards: [], kept: {}, from: null };
    const takeBackParts = () => {
      if (!midPassage) return;
      takeBackInParts(novelId, parts);
      histories.clear();
      codexes.clear();
      midPassage = false;
    };
    for (let b = 0; b < batches.length; b++) {
      const B = batches[b];
      const now = store.peek('novel', novelId);
      if (!midPassage) parts = { cards: [], kept: {}, from: { undo: clone((now.memory || {}).undo || null), lit: clone((now.memory || {}).lit || null) } };
      /* the cards it is shown by their first line, and the notes as they stand when it is asked (foldNotes) */
      const shortIds = new Map();
      const askedNotes = clone(now.notes || {});
      const askedWords = wordsNow(now);
      /* each passage named as the page names it ("Passage 4"), never by the app's own id */
      const pageNums = chapter ? passageNumbers(store.peek('chapter', chapter.id) || chapter) : new Map();
      for (const c of B.items) c.source = c.pid ? `Passage ${pageNums.get(c.pid) || '—'}` : '';
      /* whether this reading asks for the bibliography (and a short portrait): what comes back is read as what was asked, whatever the switch says by then */
      const askedCodex = bibReading(now, conn);
      /* the words read, with his premise for each (names the premise gives are someone's own) — and his notes for writing
       * it again since, beside the premise (2.12.40) */
      const readText = B.items.map((c) => `${c.text}${c.premise ? `\n\n${c.premise}${(c.later || []).map((w) => (w.note ? `\n\n${w.note}` : '')).join('')}` : ''}`).join('\n\n');
      const readFold = B.items.length ? foldedText(readText) : null;
      /* his entries for the names these words give, beside the notes — at most a twelfth of its room (2.12.37); each with
       * a premise of his typed after it that names it, said (entriesWeighed, 2.12.41) */
      const entered = entriesFitted(B.items.length ? entriesWeighed(now, chaptersOf(now), entriesNamedIn(now, readText)) : [], Math.floor(room / 12));
      const request = notesRequest({
        novel: namedBook(now, house),
        chapterLabel: label,
        before: B.before,
        changes: B.items,
        removed: B.removed.map((r) => r.text).filter((t) => String(t || '').trim()),
        removedChapters: B.chapters.map((r) => r.text),
        at, of: (now.order || []).length, later: laterRead, goesOn, notesFit, shortIds, plain, codex: askedCodex, ...entered,
      });
      let got;
      const gen = ((now.memory || {}).reread || 0);
      const askedAt = Date.now();
      readingNow.add(novelId);
      try { got = await helperJson(novelId, conn, helperFrame(house, now), request, { want: notesShape }); }
      catch (e) { takeBackParts(); throw e; }
      finally { readingNow.delete(novelId); }
      /* a name changed everywhere while it was asked: its answer is given the new name, so no card is made under the old one (Cozy Tavern's M730) */
      const renamedSince = ((((store.peek('novel', novelId) || {}).memory || {}).renames) || []).filter((x) => x.at >= askedAt);
      if (got && got.ok && renamedSince.length) got = { ...got, obj: renameAll(got.obj, renamedSince) };
      /* the whole book began to be read again (or that was undone) while it was asked: its answer belongs to notes no longer there */
      if ((((store.peek('novel', novelId) || {}).memory || {}).reread || 0) !== gen) break;
      /* another browser has the book now: what this one began of a passage is taken back, and it stops */
      try { await mustHold('helper', novelId); } catch (e) { takeBackParts(); throw e; }
      if (!got.ok) {
        /* a passage its model will not read is set aside, never asked forever */
        const giveUp = (e) => { takeBackParts(); return e; };
        /* let go on its leash (nothing heard, or no progress, for minutes): never the passage's fault, never set
         * aside for it — but a long ask is what a slow model chokes on, so it is asked one passage at a time
         * (Cozy Tavern's M675-7) */
        if (got.leashed === 'gaveway') throw giveUp(failed(got));
        if (got.leashed) {
          if (B.items.length + B.removed.length + B.chapters.length > 1) { narrow.add(novelId); throw giveUp(failed(got)); }
          /* alone, and making no progress for minutes (Cozy Tavern M748): what it asks is too much for its model — set aside after a second run, like words it will not read, never asked for ever */
          if (got.leashed !== 'long') throw giveUp(failed(got));
        }
        let fault;
        try { fault = got.leashed === 'long' ? 'words' : await helperFault(novelId, conn, got); }
        catch (e) { takeBackParts(); throw e; }
        try { await mustHold('helper', novelId); } catch (e) { takeBackParts(); throw e; }
        if (fault !== 'words') throw giveUp(failed(fault === 'model' ? passingFrom(got) : fault));
        if (B.items.length + B.removed.length + B.chapters.length > 1) { narrow.add(novelId); const e = failed(got); e.soon = true; throw giveUp(e); }
        const key = askedKey(B);
        const n = (stuck.get(key) || 0) + 1;
        stuck.set(key, n);
        if (n < 2) throw giveUp(failed({ error: got.error }));
        stuck.delete(key);
        if (B.items.some((c) => c.partial || c.whole !== undefined)) {
          /* One unread part means this passage was not read whole. Undo
           * its earlier parts and skip its remainder, never erase its
           * refusal by later marking just the last part read. */
          takeBackParts(); acc = []; accKept = {};
          const failedIds = new Set(B.items.map((c) => c.pid));
          setAside(novelId, chapter, { ...B, items: B.items.map((c) => ({ ...c, partial: false })) }, got.error, conn);
          while (b + 1 < batches.length && batches[b + 1].items.some((c) => failedIds.has(c.pid))) b++;
        } else setAside(novelId, chapter, B, got.error, conn);
        continue;
      }
      stuck.delete(askedKey(B));
      const latest = store.peek('novel', novelId);
      /* its chapter taken out while it was asked: nothing of it is laid on or marked read — the chapter going is read as such (Cozy Tavern M290) */
      if (chapter && !((latest.order || []).includes(chapter.id) && store.peek('chapter', chapter.id))) { takeBackParts(); break; }
      const lastPid = B.items.length ? B.items[B.items.length - 1].pid : '';
      /* (an earlier passage he changed, read with words already there after it, is read out of turn — whatever else this pass reads: 2.12.18) */
      const liveList = chapter ? ((store.peek('chapter', chapter.id) || chapter).passages || []) : [];
      const lastAt = liveList.findIndex((p) => p.id === lastPid);
      const wordsAfter = lastAt >= 0 && liveList.slice(lastAt + 1).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
      const askGoesOn = goesOn || (wordsAfter && B.items.some((c) => c.old || c.fromChange));
      const liveChapter = chapter ? store.peek('chapter', chapter.id) || chapter : null;
      /* what each source establishes for the bibliography (bibliography.js), held to its own words — gathered first, so
       * a shorter "who they are" may leave to it what it keeps (factsByCard) */
      const batchFacts = [];
      /* an answer that gives none for a source leaves an honest gap, as the Timeline's does — never asked again for it */
      if (askedCodex) {
        /* a source as the answer says it ("Passage 4", "passage 4.") */
        const said = (r) => sourceKey(r && r.source);
        for (const c of B.items) {
          if (c.oldOnly) continue;
          const source = { text: c.text, whole: c.whole !== undefined ? c.whole : c.text };
          const rows = Array.isArray(got.obj.bibliography) ? got.obj.bibliography.filter((r) => r && c.source && (said(r) === sourceKey(c.source) || r.source === c.pid)) : [];
          let codex = rows.length ? null : codexOf(undefined, source);
          for (const row of rows) codex = mergeCodex(codex, codexOf(row.facts, source));
          if (rows.length !== 1) codex.complete = false;
          /* a passage further back read as a change: what its version before established that the new words still say stays */
          /* (every part of a change read in parts: 2.12.40 — only its first part carried the words before) */
          if (c.old || c.fromChange) for (const k of codexBefore(novelId, chapter && chapter.id, c)) codex = withCarriedFacts(codex, k, source.whole);
          codexes.set(c.sig, mergeCodex(codexes.get(c.sig), codex));
          batchFacts.push(...codex.facts);
        }
      }
      const folded = foldNotes(latest.notes, got.obj, {
        keptElsewhere: askedCodex ? factsByCard(novelId, batchFacts) : null,
        chapterId: chapter ? chapter.id : '', at: Date.now(),
        stands: hasGone(got.obj) ? standsFolded(latest) : null,
        nowStays: liveChapter ? nowWrittenLater(latest, liveChapter, lastPid, { laterRead, goesOn: askGoesOn }) : (laterRead || askGoesOn),
        outOfTurn: Boolean(laterRead || askGoesOn),
        nowAt: chapter ? chapter.id : '', nowPid: lastPid,
        short: shortIds, asked: askedNotes,
        named: readFold,
      });
      /* a row two cards answer to was kept on a card of its own: the notes' check folds it where it belongs */
      if (folded.aside.some((x) => x.own && !x.near)) store.change('novel', novelId, novelSteps.setMemory({ auditAsked: true }));
      /* what it keeps of the book as it stands (Automatic), when this part changed it — never over his correction */
      const kept = keptChanges(latest, got.obj, askedWords);
      if (folded.cards.length || Object.keys(kept).length) {
        /* the cards it touched, changed by id — never the whole notes over a change made meanwhile */
        if (folded.cards.length) store.change('novel', novelId, novelSteps.applyCards(folded.cards));
        for (const [key, k] of Object.entries(kept)) keepIfUnchanged(novelId, key, k.before, k.after);
        const u = latest.memory && latest.memory.undo;
        const keep = Boolean(u && u.keep);
        /* a later part of a passage read in parts is the same reading: its Undo takes back every part */
        const merge = Boolean(u) && (keep || midPassage);
        const cards = merge ? mergeUndo(u, folded.cards) : folded.cards;
        const keptUndo = merge ? mergeKeptUndo(u.kept, kept) : kept;
        const changed = [...changedOf(cards), ...keptChangedOf(keptUndo)].slice(0, 40);
        store.change('novel', novelId, novelSteps.setMemory({ undo: { at: merge ? u.at : Date.now(), label: merge ? u.label : label, keep, cards, kept: keptUndo, changed },
          lit: { at: Date.now(), label: readLabel(latest, chapter, B.items) || label, changed: [...changedOf(folded.cards), ...keptChangedOf(kept)].slice(0, 40) } }));
      }
      acc = mergeUndo({ cards: acc }, folded.cards);
      accKept = mergeKeptUndo(accKept, kept);
      /* Source labels belong to the words in this request, not to a name
       * guessed from the answer. Gather long passages until all their parts
       * are read. A missing list is a gap, never "nothing happened". */
      for (const c of B.items) {
        if (c.oldOnly) continue;
        const said = (r) => String(r.source || '').trim().replace(/[.\s]+$/, '').toLowerCase();
        const rows = Array.isArray(got.obj.timeline) ? got.obj.timeline.filter(r => r && c.source && (said(r) === c.source.toLowerCase() || r.source === c.pid)) : [];
        const source = { text: c.text, whole: c.whole !== undefined ? c.whole : c.text };
        const notes = store.peek('novel', novelId).notes;
        let history = rows.length ? null : continuityOf(undefined, notes, source);
        for (const row of rows) history = mergeContinuity(history, continuityOf(row.events, notes, source), source.whole, { oneReading: true });
        if (rows.length !== 1) history.complete = false;
        /* a passage read as a change — a fix, a Go on, his partner's words, his edit, words put back: the turns its words
         * before had that the new words still give stay, turn by turn, as its facts do (timeline.js withCarriedTurns —
         * 2.12.40, the audit: the answer, asked for what the change adds, took them all away) */
        if (c.old || c.fromChange) for (const k of turnsBefore(novelId, chapter && chapter.id, c)) history = withCarriedTurns(history, k, source.whole);
        histories.set(c.sig, mergeContinuity(histories.get(c.sig), history, source.whole));
      }
      parts.cards = mergeUndo({ cards: parts.cards }, folded.cards);
      parts.kept = mergeKeptUndo(parts.kept, kept);
      /* a part of a passage, and more of it to come — kept on the book, so a
       * window closed before its last part never leaves the earlier parts in
       * the notes with nothing to take them back (Cozy Tavern M205/M218) */
      midPassage = B.items.some((c) => c.partial);
      if (midPassage) store.change('novel', novelId, novelSteps.setMemory({ inParts: { cards: parts.cards, kept: parts.kept, from: parts.from, at: Date.now() } }));
      else if ((store.peek('novel', novelId).memory || {}).inParts) store.change('novel', novelId, novelSteps.setMemory({ inParts: null }));
      /* the chapter's name, when it has none, he has not cleared it, and it is long enough to have earned one */
      const cn = cleanName(got.obj.chapterName);
      const liveCh = chapter ? store.peek('chapter', chapter.id) : null;
      if (liveCh && cn && !liveCh.name && liveCh.nameBy !== 'you' && chapterWords(liveCh) >= 600) {
        store.change('chapter', chapter.id, chapterSteps.setName(cn.replace(/^chapter\s+\w+\s*[:—-]\s*/i, '').slice(0, 80), 'helper'));
      }
      /* what was read is marked read. A passage he changed while it was being
       * read is marked as read as it WAS, with those words kept — so the next
       * reading is told what it used to say and what it says now. */
      if (chapter) {
        const live = store.peek('chapter', chapter.id);
        const done = B.items.filter((c) => !c.partial);
        const map = { ...((store.peek('novel', novelId).memory || {}).seen || {})[chapter.id] };
        const clear = [];
        for (const r of (live && live.retired) || []) {
          if (B.removed.some((x) => x.key && x.key === r.key && !x.partial)) clear.push(r.key);
          else if (done.some((c) => r.key.startsWith(c.pid + SIG_SEP))) clear.push(r.key);
        }
        if (clear.length) store.change('chapter', chapter.id, chapterSteps.clearRetired(clear));
        /* a passage moved to another chapter while it was read (A new chapter from here): read there, never taken out here (Cozy Tavern M506-1) */
        const movedTo = new Map();
        for (const c of done) {
          if (live && live.passages.some((x) => x.id === c.pid)) continue;
          for (const id of latest.order || []) {
            const other = id !== chapter.id ? store.peek('chapter', id) : null;
            if (other && (other.passages || []).some((x) => x.id === c.pid)) { movedTo.set(c.pid, id); break; }
          }
        }
        for (const [pid, id] of movedTo) {
          const c = done.find((x) => x.pid === pid);
          const there = { ...(((store.peek('novel', novelId).memory || {}).seen || {})[id] || {}) };
          there[pid] = c.sig;
          store.change('novel', novelId, novelSteps.seen(id, there));
          delete map[pid];
        }
        for (const c of done) {
          if (movedTo.has(c.pid)) continue;
          const p = live && live.passages.find((x) => x.id === c.pid);
          const v = p && picked(p);
          /* renamed while it was read: what was read is the version the name made, read already */
          /* (on the page itself since 2.12.2: the same version, its words renamed — or, kept from before, a version made from it) */
          if (renamedSince.length && v && (v.id === c.sig.split(SIG_SEP)[0] || v.from === c.sig.split(SIG_SEP)[0]) && signature(v) !== c.sig && String(v.text || '') === renameIn(c.whole !== undefined ? c.whole : c.text, renamedSince)) c.sig = signature(v);
          map[c.pid] = c.sig;
          if (v && signature(v) === c.sig) continue;
          const [vid] = c.sig.split(SIG_SEP);
          /* the whole of what was read — every part of a passage read in parts */
          const read = c.whole !== undefined ? c.whole : c.text;
          if (!p) store.change('chapter', chapter.id, chapterSteps.retire({ key: c.pid, text: read, at: Date.now() }));
          else if (!p.versions.some((x) => x.id === vid && hashText(x.text || '') === c.sig.split(SIG_SEP)[1])) {
            store.change('chapter', chapter.id, chapterSteps.retire({ key: c.pid + SIG_SEP + vid, text: read, at: Date.now() }));
          }
        }
        /* a passage taken out is done with once its last part is told */
        for (const r of B.removed) if (!r.partial) delete map[r.pid];
        store.change('novel', novelId, novelSteps.seen(chapter.id, map));
        /* a passage once set aside, read now: no longer said to be left out */
        const aside = ((store.peek('novel', novelId).memory || {}).aside) || {};
        const back = done.map((c) => c.pid).filter((pid) => aside[pid]);
        if (back.length) store.change('novel', novelId, novelSteps.dropAside(back));
        /* what this reading changed, kept for each version it read (readings.js) */
        if (done.length) {
          for (const c of done) {
            const history = histories.get(c.sig);
            if (!history) continue;
            const cid = movedTo.get(c.pid) || chapter.id;
            /* (what its words before were read for cannot vouch for the rest: left owed, read whole by itself — turnsUnvouched) */
            const owed = turnsUnvouched(novelId, chapter.id, c, history);
            /* This step checks the selected version and words again when
             * a refused save is replayed over another browser's changes. */
            store.change('chapter', cid, continuityStep(c.pid, c.sig.split(SIG_SEP)[0], owed ? { ...history, complete: false } : history));
            histories.delete(c.sig);
          }
          for (const c of done) {
            const codex = codexes.get(c.sig);
            if (!codex) continue;
            /* (owed as the turns are — factsUnvouched: from its start, `upTo` 0, bibDue) */
            const owed = factsUnvouched(novelId, chapter.id, c, codex);
            store.change('chapter', movedTo.get(c.pid) || chapter.id, codexStep(c.pid, c.sig.split(SIG_SEP)[0], owed ? { ...codex, complete: false, upTo: 0 } : codex));
            codexes.delete(c.sig);
          }
          keepReading(novelId, chapter, done, acc, accKept, { mixed: B.removed.length > 0 || B.chapters.length > 0 });
          acc = [];
          accKept = {};
        }
      }
      clearOut(novelId, B);
    }
    pruneReadings(novelId);
    await store.flush('novel', novelId);
  }
}

/* The people whose "now" a later part of the book wrote (Cozy Tavern's
 * M453): a part read out of turn never moves them. A "now" knows the chapter
 * and the passage it is as of (nowAt, nowPid); one with no such mark (kept
 * before 2.6, or its chapter gone) counts as later whenever anything after
 * this part has been read. false: nothing after it has been read. */
export function nowWrittenLater(novel, chapter, lastPid, { laterRead = false, goesOn = false } = {}) {
  if (!laterRead && !goesOn) return false;
  const order = novel.order || [];
  const ci = order.indexOf(chapter.id);
  const list = (chapter.passages || []).map((p) => p.id);
  const at = lastPid ? list.indexOf(lastPid) : -1;
  const out = new Set();
  for (const c of (novel.notes && novel.notes.people) || []) {
    if (!String(c.now || '').trim()) continue;
    const ni = c.nowAt ? order.indexOf(c.nowAt) : -1;
    if (ni >= 0 && ni < ci) continue;
    if (ni > ci) { out.add(c.id); continue; }
    if (ni === ci) {
      const pi = c.nowPid ? list.indexOf(c.nowPid) : -1;
      if (pi >= 0 && at >= 0) { if (pi > at) out.add(c.id); continue; }
      /* somewhere in this chapter, not known where: kept while the chapter goes on past this part */
      if (goesOn) out.add(c.id);
      continue;
    }
    out.add(c.id);
  }
  return out;
}

/* "Chapter Two, passage 5" (or "passages 4–5") for what one reading read */
function readLabel(novel, chapter, list) {
  if (!chapter || !list || !list.length) return '';
  const live = store.peek('chapter', chapter.id) || chapter;
  const nums = passageNumbers(live);
  const ns = [...new Set(list.map((c) => nums.get(c.pid)).filter(Boolean))].sort((a, b) => a - b);
  const base = chapterLabel(novel, live, { withName: false });
  if (!ns.length) return base;
  return ns.length === 1 ? `${base}, passage ${ns[0]}` : `${base}, passages ${ns[0]}–${ns[ns.length - 1]}`;
}

/* One reading kept for the versions it read: in full on the last of them,
 * and the others pointing to it (read together, they are taken back
 * together). mode: 'new' — read as new from the notes as they stood before
 * it; 'change' — read as a change from the version it replaced (fromSig);
 * 'mixed' — anything else, never taken back by itself. */
function keepReading(novelId, chapter, done, cards, kept, { mixed = false } = {}) {
  const last = done[done.length - 1];
  const [vid] = last.sig.split(SIG_SEP);
  const allNew = done.every((c) => !c.was);
  const oneChange = done.length === 1 && last.was && (last.old || last.fromChange);
  const mode = mixed ? 'mixed' : allNew ? 'new' : oneChange ? 'change' : 'mixed';
  const novel = store.peek('novel', novelId);
  const reading = { sig: last.sig, mode, cards: clone(cards), kept: clone(kept), covers: done.map((c) => c.pid), at: Date.now(), label: readLabel(novel, chapter, done) };
  if (mode === 'change') reading.fromSig = last.was;
  store.change('novel', novelId, novelSteps.putReading(last.pid, vid, reading));
  /* one more reading since the notes were last checked against the book (not while the whole book is read again) */
  if (!(novel.memory && novel.memory.undo && novel.memory.undo.keep)) store.change('novel', novelId, novelSteps.readSinceCheck());
  for (const c of done.slice(0, -1)) {
    const [v] = c.sig.split(SIG_SEP);
    store.change('novel', novelId, novelSteps.putReading(c.pid, v, { sig: c.sig, in: { pid: last.pid, vid, sig: last.sig } }));
  }
}

/* The readings kept stay within bounds: a version no longer in the book has
 * none; each passage keeps the readings of its six newest versions (and the
 * one the notes were made from); and past about 600 KB the oldest chapters'
 * go first — the newest chapters, where takes and rewrites happen, keep theirs. */
const READINGS_MAX = 600000;
function pruneReadings(novelId) {
  const novel = store.peek('novel', novelId);
  const all = novel && novel.memory && novel.memory.readings;
  if (!all) return;
  const chapters = chaptersOf(novel);
  const where = new Map();   /* pid -> {chapterIndex, passage} */
  (novel.order || []).forEach((id, i) => { for (const p of (chapters[id] || {}).passages || []) where.set(p.id, { i, p, chapterId: id }); });
  /* a passage not found is out of the book only when every chapter is here
   * to look in — and one taken out but not yet read as taken out keeps its
   * reading, to be taken back with */
  const whole = (novel.order || []).every((id) => chapters[id]);
  const waiting = new Set(Object.values((novel.memory && novel.memory.seen) || {}).flatMap((m) => Object.keys(m || {})));
  const drop = [];
  for (const pid of Object.keys(all)) {
    const w = where.get(pid);
    if (!w) { if (whole && !waiting.has(pid)) drop.push([pid, '*']); continue; }
    const seenSig = ((novel.memory.seen || {})[w.chapterId] || {})[pid] || '';
    const ids = w.p.versions.map((v) => v.id);
    const keepIds = new Set(ids.slice(-6));
    const shown = picked(w.p);
    if (shown) keepIds.add(shown.id);
    if (seenSig) keepIds.add(seenSig.split(SIG_SEP)[0]);
    for (const vid of Object.keys(all[pid])) if (!keepIds.has(vid)) drop.push([pid, vid]);
  }
  if (drop.length) store.change('novel', novelId, novelSteps.dropReadings(drop));
  const after = store.peek('novel', novelId).memory.readings || {};
  let size = JSON.stringify(after).length;
  if (size <= READINGS_MAX) return;
  const byAge = Object.keys(after).map((pid) => ({ pid, i: (where.get(pid) || { i: -1 }).i, n: JSON.stringify(after[pid]).length })).sort((a, b) => a.i - b.i);
  const more = [];
  for (const x of byAge) {
    if (size <= READINGS_MAX * 0.8) break;
    more.push([x.pid, '*']);
    size -= x.n;
  }
  if (more.length) store.change('novel', novelId, novelSteps.dropReadings(more));
}

/* THE CHAPTER SO FAR (stretches.js): a chapter long enough that a model
 * reading it beside everything else might have to cut it is kept in
 * stretches, each summed up once it is finished — the oldest first, the
 * stretch before it carried in so each picks up where the last ends. Past a
 * third of the smallest room of those who read the open chapter (the writer,
 * the narrator on the writer's connection, the partner on its own) — and,
 * whatever the room, past the length where its one summary stops growing
 * (prompts.js summarySize: 1,200 words for 14,400 and more): a chapter of
 * 60,000 words on a model that holds it whole today would otherwise have
 * nothing finer than those 1,200 words once the book outgrows the room, and
 * the level between (context.js stretchesOf) needs its stretches. A stretch
 * its model will not sum up is passed by after a second try, until its words
 * change. */
export const ONE_SUMMARY_WORDS = SUMMARY_MOST * 12;
function wantsStretches(house, tokens, words = 0) {
  const rooms = ['writer', 'partner'].map((r) => connFor(house, r)).filter(Boolean).map((x) => contextOf(x));
  const room = rooms.length ? Math.min(...rooms) : 32000;
  return tokens > Math.max(3500, Math.floor(room / 3)) || words > ONE_SUMMARY_WORDS;
}
const stretchTried = new Map();   /* chapter:fingerprint -> refused runs */
async function stretchUp(novelId, conn) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const house = store.peek('house', 'house') || {};
  const order = [...(novel.order || [])];
  for (let i = 0; i < order.length; i++) {
    const c = store.peek('chapter', order[i]);
    if (!c || (c.passages || []).some((p) => (picked(p) || {}).streaming)) continue;
    const whole = chapterText(c);
    if (!wantsStretches(house, estimateTokens(whole), countWords(whole))) continue;
    /* a chapter the writing has moved past: its last words make a stretch too */
    const opts = { closeLast: i < order.length - 1 };
    const plan = stretchPlan(c, opts);
    const kept = keptStretches(plan);
    if (JSON.stringify(kept) !== JSON.stringify(c.stretches || [])) store.change('chapter', c.id, chapterSteps.setStretches(kept));
    const now = store.peek('novel', novelId);
    const label = chapterLabel(now, c, { withName: true });
    const frame = helperFrame(house, now);
    const cardNames = ['people', 'places', 'lore'].flatMap((k) => ((now.notes || {})[k] || []).flatMap((x) => [x.name, ...(x.aka || [])])).filter(Boolean);
    const list = c.passages || [];
    /* the chapters before this one, folded once for the chapter (only when a stretch is asked) */
    let earlierBook = null;
    for (let k = 0; k < plan.stretches.length; k++) {
      const st = plan.stretches[k];
      if (st.text) continue;
      const key = `${c.id}:${st.fp}`;
      if ((stretchTried.get(key) || 0) >= 2) continue;
      const a = list.findIndex((p) => p.id === st.from), b = list.findIndex((p) => p.id === st.to);
      if (a < 0 || b < a) continue;
      const text = chapterText({ passages: list.slice(a, b + 1) });
      if (!text.trim()) continue;
      /* who and what this stretch names that the book already knew before it */
      const here = foldedText(text);
      if (earlierBook === null) earlierBook = foldedText(order.slice(0, i).map((id) => { const x = store.peek('chapter', id); return x ? chapterText(x) : ''; }).join('\n\n'));
      const earlierHere = foldedText(chapterText({ passages: list.slice(0, a) }));
      const knewOf = (n) => nameInText(earlierHere, n, { words: false }) || nameInText(earlierBook, n, { words: false });
      const known = [...new Set(['people', 'places', 'lore'].flatMap((kind) => ((now.notes || {})[kind] || []).filter((x) => [x.name, ...(x.aka || [])].some((n) => n && nameInText(here, n, { words: false }) && knewOf(n))).map((x) => x.name)))];
      setLight(novelId, 'reading', `Summing up part of ${label}…`);
      /* a stretch longer than the helper's model reads at once (one passage can be): in parts, each part's summary carried into the next */
      const before = k > 0 ? plan.stretches[k - 1].text : '';
      /* what rides beside each part: the ask's own words as they are sent (the one before and the names known among them), and room for its parts' summary so far */
      const ask = stretchRequest({ novel: namedBook(now, house), chapterLabel: label, text: '', words: st.words, before, known, part: 1, parts: 2 });
      const room = readingRoom(conn, estimateTokens(frame) + estimateTokens(ask) + 1000);
      const partWords = Math.max(200, Math.floor((room * 0.75) / 1.4));
      const parts = countWords(text) > partWords ? partsOf(text, partWords) : [text];
      let summary = '';
      let refused = false;
      for (let q = 0; q < parts.length; q++) {
        const got = await helperJson(novelId, conn, frame, stretchRequest({ novel: namedBook(now, house), chapterLabel: label, text: parts[q], words: st.words, before: q === 0 ? before : '', known,
          part: parts.length > 1 ? q + 1 : 0, parts: parts.length, soFar: summary }), { want: (o) => Boolean(summaryWords(o.summary)) });
        if (!got.ok) {
          /* a stall on these words (heard, but no progress for minutes) is theirs, as the notes' reading counts it (M748): tried a bounded number of times, never for ever */
          if (got.leashed && got.leashed !== 'long') throw failed(got);
          const fault = got.leashed === 'long' ? 'words' : await helperFault(novelId, conn, got);
          if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
          refused = true;
          break;
        }
        summary = summaryWords(got.obj.summary) || summary;
      }
      if (refused) { stretchTried.set(key, (stretchTried.get(key) || 0) + 1); continue; }
      if (!summary) continue;
      const r = await keepHardTokens({ novelId, conn, frame, novel: now, label, text, summary, known: cardNames, stretch: true });
      summary = r.summary || summary;
      await mustHold('helper', novelId);
      /* laid in only while the stretch reads as it did when asked */
      let laid = false;
      store.change('chapter', c.id, (ch) => {
        const next = withStretch(ch, st, summary, Date.now(), opts);
        if (!next) return false;
        ch.stretches = next;
        laid = true;
        return true;
      });
      if (laid) { plan.stretches[k].text = summary; stretchTried.delete(key); }
      await store.flush('chapter', c.id);
    }
  }
}

/* A chapter's summary is kept current once the writing has moved past it, or
 * once it has been quiet a while. A chapter longer than the helper's model
 * holds is summed up in parts, each part's summary carried into the next. */
const QUIET_MS = 10 * 60 * 1000;
const summaryWords = (text) => typeof text === 'string' ? cleanText(text) : '';
/* Records change in place while a reply travels. Compare with values kept
 * before asking, never with that same record after awaiting the answer. */
function summaryStamp(novel, chapter) {
  return { fp: chapterPrint(chapter), summary: JSON.stringify(chapter.summary || null), reread: (novel.memory || {}).reread || 0 };
}
function summaryMatches(chapter, stamp) {
  return !((chapter.passages || []).some((p) => (picked(p) || {}).streaming)) && chapterPrint(chapter) === stamp.fp && JSON.stringify(chapter.summary || null) === stamp.summary;
}
/* The same conditions hold when an unsaved step is replayed over a newer
 * server copy. Summary, cache and generated name move together, so a remote
 * edit cannot receive even part of an answer to the old chapter. */
function saveSummary(novelId, chapterId, stamp, summary, { cache = false, name = '' } = {}) {
  const kept = clone(summary);
  return store.change('chapter', chapterId, (c) => {
    const n = store.peek('novel', novelId);
    if (!n || !(n.order || []).includes(chapterId) || ((n.memory || {}).reread || 0) !== stamp.reread || !summaryMatches(c, stamp)) return false;
    chapterSteps.setSummary(clone(kept))(c);
    if (cache && kept) chapterSteps.keepSummary(kept)(c);
    if (name && !c.name && c.nameBy !== 'you') chapterSteps.setName(name, 'helper')(c);
    return true;
  });
}
async function summaryStillCurrent(novelId, chapterId, stamp) {
  await mustHold('helper', novelId);
  const n = store.peek('novel', novelId);
  const c = store.peek('chapter', chapterId);
  if (!n || !c || !(n.order || []).includes(chapterId)) return false;
  const current = summaryMatches(c, stamp) && ((n.memory || {}).reread || 0) === stamp.reread;
  if (!current) nudge(novelId, 2000);
  return current;
}
async function summarise(novelId, conn) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const order = [...(novel.order || [])];
  for (let i = 0; i < order.length; i++) {
    const c = store.peek('chapter', order[i]);
    const current = store.peek('novel', novelId);
    if (!c || !current || !(current.order || []).includes(c.id)) continue;
    const stamp = summaryStamp(current, c);
    const text = chapterText(c);
    if ((c.passages || []).some((p) => (picked(p) || {}).streaming)) continue;
    if (!text.trim()) {
      /* An emptied chapter has no generated summary. Its saved summaries
       * stay available if a version is put back; his own words stay too. */
      if (c.summary && c.summary.by !== 'you' && await summaryStillCurrent(novelId, c.id, stamp)) saveSummary(novelId, c.id, stamp, null);
      continue;
    }
    const fp = chapterPrint(c);
    /* a summary from before Read the whole book again is due again — his own stays; one that says nothing (a refusal kept before 2.6) is due again too */
    const since = stamp.reread;
    const fresh = (x) => Boolean(x) && (x.by === 'you' || ((!since || (x.at || 0) >= since) && Boolean(summaryWords(x.text))));
    if (c.summary && c.summary.fp === fp && fresh(c.summary)) {
      if (c.summary.again && c.summary.by !== 'you') await tokensAgain(novelId, conn, c, fp);
      continue;
    }
    /* one its model would not write, set aside until the chapter changes */
    const aside = ((novel.memory || {}).aside || {})['summary:' + c.id];
    if (aside && aside.fp === fp) continue;
    /* the chapter reads as it did once before (a version brought back): its summary from then comes back, with no call — his own, when he wrote it */
    const before = (c.summaries || []).find((x) => x.fp === fp && String(x.text || '').trim() && fresh(x));
    if (before) {
      if (await summaryStillCurrent(novelId, c.id, stamp)) {
        const saved = saveSummary(novelId, c.id, stamp, { ...clone(before), fp, at: before.at || Date.now() });
        if (saved && before.again && before.by !== 'you') await tokensAgain(novelId, conn, c, fp);
      }
      continue;
    }
    const last = i === order.length - 1;
    const lastTouch = Math.max(0, ...(c.passages || []).map((p) => { const v = picked(p) || {}; return v.done || v.at || 0; }));
    if (last && Date.now() - lastTouch < QUIET_MS) { nudge(novelId, QUIET_MS - (Date.now() - lastTouch) + 1000); continue; }
    const now = store.peek('novel', novelId);
    const house = store.peek('house', 'house') || {};
    const label = chapterLabel(now, c, { withName: true });
    setLight(novelId, 'reading', `Summing up ${label}…`);
    const words = countWords(text);
    const frame = helperFrame(house, now);
    /* his own summary (his, or the partner's at his asking), from before the
     * chapter's latest changes: carried into the new one wherever the chapter
     * still says it — never lost to a summary written without it (Cozy Tavern
     * M675/M752: his own line is never let go) */
    const his = c.summary && c.summary.by === 'you' && String(c.summary.text || '').trim() ? String(c.summary.text).trim() : '';
    /* who and what in this chapter the book already knew from the chapters
     * before it, by name — so "for the first time" means the book's first
     * time (Cozy Tavern's M229), and the chapter's own newcomers are never
     * called known; every name on a card is held to the summary (keepHardTokens) */
    const cardNames = ['people', 'places', 'lore'].flatMap((k) => ((now.notes || {})[k] || []).flatMap((x) => [x.name, ...(x.aka || [])])).filter(Boolean);
    const here = foldedText(text);
    const earlier = foldedText(order.slice(0, i).map((id) => { const x = store.peek('chapter', id); return x ? chapterText(x) : ''; }).join('\n\n'));
    const known = [...new Set(['people', 'places', 'lore'].flatMap((k) => ((now.notes || {})[k] || []).filter((x) => [x.name, ...(x.aka || [])].some((n) => n && nameInText(here, n, { words: false }) && nameInText(earlier, n, { words: false }))).map((x) => x.name)))];
    /* what rides beside each part: the ask's own words as they are sent (the names known among them; the summary so far rides in the room the reply and the margin leave) */
    const ask = summaryRequest({ novel: namedBook(now, house), chapterLabel: label, text: '', needsName: true, words, part: 1, parts: 2, known });
    const room = readingRoom(conn, estimateTokens(frame) + estimateTokens(ask));
    const partWords = Math.max(200, Math.floor((room * 0.75) / 1.4));
    /* his own summary rides with the last part only: that part is kept short enough to hold it, beside the summary so far — never every part made small for it */
    const hisRoom = his ? estimateTokens(summaryRequest({ novel: namedBook(now, house), chapterLabel: label, text: '', needsName: true, words, part: 1, parts: 2, known, his })) - estimateTokens(ask) + Math.ceil(summarySize(words) * 1.4) : 0;
    const lastWords = Math.max(200, Math.floor(((room - hisRoom) * 0.75) / 1.4));
    const withHisLast = (list) => {
      if (!his || !list.length || countWords(list[list.length - 1]) <= lastWords) return list;
      return [...list.slice(0, -1), ...partsOf(list[list.length - 1], lastWords)];
    };
    /* a long chapter whose every stretch is summed up is summed up from them, with the words after its last stretch as they stand — the whole of it read, nothing squeezed away part by part */
    const sp = stretchPlan(c, { closeLast: !last });
    const openIds = new Set(sp.open);
    const tail = sp.open.length ? chapterText({ passages: (c.passages || []).filter((p) => openIds.has(p.id)) }) : '';
    const sums = sp.stretches.length && sp.stretches.every((x) => x.text) ? sp.stretches.map((x) => x.text).join('\n\n') : '';
    const stretched = sums && estimateTokens(sums) + estimateTokens(tail) < (room - hisRoom) * 0.75 ? sums : '';
    const parts = stretched ? [stretched] : withHisLast(words > partWords ? partsOf(text, partWords) : [text]);
    let summary = '';
    let name = '';
    let setAsideNow = false;
    for (let k = 0; k < parts.length; k++) {
      const lastPart = k === parts.length - 1;
      /* a summary with words in it, or none (an empty one is asked again — M681) */
      const got = await helperJson(novelId, conn, frame, summaryRequest({ novel: namedBook(now, house), chapterLabel: label, text: parts[k], needsName: lastPart && !c.name && c.nameBy !== 'you', words,
        part: parts.length > 1 ? k + 1 : 0, parts: parts.length, soFar: summary, known, his: lastPart ? his : '', stretched: parts[0] === stretched && Boolean(stretched), tail: stretched ? tail : '' }), { want: (o) => Boolean(summaryWords(o.summary)) });
      if (!(await summaryStillCurrent(novelId, c.id, stamp))) { setAsideNow = true; break; }
      if (!got.ok) {
        /* a stall on these words is theirs (M748): asked once more, then set aside — never for ever */
        if (got.leashed && got.leashed !== 'long') throw failed(got);
        const fault = got.leashed === 'long' ? 'words' : await helperFault(novelId, conn, got);
        if (!(await summaryStillCurrent(novelId, c.id, stamp))) { setAsideNow = true; break; }
        if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
        const key = `summary:${c.id}:${fp}`;
        const n = (stuck.get(key) || 0) + 1;
        stuck.set(key, n);
        if (n < 2) throw failed({ error: got.error });
        stuck.delete(key);
        store.change('novel', novelId, novelSteps.setAside({ ['summary:' + c.id]: { chapterId: c.id, fp, label: `the summary of ${label}`, why: cutWords(got.error || '', 300), at: Date.now(), conn: connPrint(conn) } }));
        setAsideNow = true;
        break;
      }
      /* a summary with words in it, through the helper's door (a refusal or "none" is no summary — Cozy Tavern M648) */
      summary = summaryWords(got.obj.summary) || summary;
      if (lastPart) name = cleanName(got.obj.name);
    }
    if (setAsideNow) continue;
    let tokensDue = null;
    if (summary) { const r = await keepHardTokens({ novelId, conn, frame, novel: now, label, text, summary, known: cardNames }); summary = r.summary; if (r.again) tokensDue = r; }
    if (!(await summaryStillCurrent(novelId, c.id, stamp))) continue;
    if (summary) {
      const entry = { text: summary, fp, at: Date.now(), ...(tokensDue ? { again: true } : {}) };
      saveSummary(novelId, c.id, stamp, entry, { cache: true, name: cutWords(name.replace(/^chapter\s+\w+\s*[:—-]\s*/i, ''), 80) });
      stuck.delete(`summary:${c.id}:${fp}`);
      if (((store.peek('novel', novelId).memory || {}).aside || {})['summary:' + c.id]) store.change('novel', novelId, novelSteps.dropAside(['summary:' + c.id]));
    }
    await store.flush('chapter', c.id);
    /* the names and figures it left out are asked for again later, by themselves (S14-G6) */
    if (tokensDue) throw failed({ error: tokensDue.error || 'the summary’s names and figures could not be checked just now' });
  }
}

/* A summary kept while its names and figures could not be asked for (a passing
 * fault): they are asked for again, the summary standing meanwhile */
async function tokensAgain(novelId, conn, c, fp) {
  const now = store.peek('novel', novelId);
  const stamp = summaryStamp(now, c);
  const summary = c.summary.text;
  const house = store.peek('house', 'house') || {};
  const text = chapterText(c);
  const cardNames = ['people', 'places', 'lore'].flatMap((k) => ((now.notes || {})[k] || []).flatMap((x) => [x.name, ...(x.aka || [])])).filter(Boolean);
  const r = await keepHardTokens({ novelId, conn, frame: helperFrame(house, now), novel: now, label: chapterLabel(now, c, { withName: true }), text, summary, known: cardNames });
  if (!(await summaryStillCurrent(novelId, c.id, stamp))) return;
  const live = store.peek('chapter', c.id);
  if (!live || !live.summary || live.summary.fp !== fp || live.summary.by === 'you') return;
  if (r.again) throw failed({ error: r.error || 'the summary’s names and figures could not be checked just now' });
  const { again: _a, ...rest } = live.summary;
  const entry = { ...rest, text: r.summary, at: Date.now() };
  saveSummary(novelId, c.id, stamp, entry, { cache: true });
  await store.flush('chapter', c.id);
}

/* THE HARD TOKENS (Cozy Tavern M111, M208): a summary that left out a name or
 * a figure the chapter holds, or gives a figure it never does (its detail
 * check: a wrong fact is not a missing one), is asked once more, with each
 * one where it stands in the chapter. The second is kept only when it gets
 * more of them right, reads as prose and is no thinner; otherwise the first
 * stands — never a list of words pasted in by the app. Returns {summary, again}: again — the ask
 * failed for a passing fault (its model down, let go on its leash), so the
 * summary stands meanwhile and they are asked for once more later. */
async function keepHardTokens({ novelId, conn, frame, novel, label, text, summary, known, stretch = false }) {
  const miss = tokensMissing(text, summary, known);
  /* and a figure it gives that its words never do (Cozy Tavern's detail check: a wrong fact is not a missing one) */
  const wrong = figuresInvented(text, summary);
  const lost = miss.names.length + miss.figures.length + wrong.length;
  if (!lost) return { summary, again: false };
  const lower = text.toLowerCase();
  const where = (t) => {
    const i = lower.indexOf(String(t).toLowerCase());
    return i < 0 ? '' : text.slice(Math.max(0, i - 120), i + String(t).length + 120).replace(/\s+/g, ' ').trim();
  };
  const missing = [...miss.names.slice(0, 8).map((t) => ({ kind: 'name', token: t, where: where(t) })), ...miss.figures.slice(0, 8).map((t) => ({ kind: 'figure', token: t, where: where(t) })), ...wrong.slice(0, 8).map((t) => ({ kind: 'wrong', token: t }))];
  let got;
  try {
    got = await helperJson(novelId, conn, frame, summaryAgainRequest({ novel, chapterLabel: label, summary, missing, stretch }), { want: (o) => Boolean(summaryWords(o.summary)) });
  } catch (e) { if (e && e.helperChanged) throw e; return { summary, again: true }; }
  if (!got || !got.ok) return { summary, again: Boolean(got && !got.unreadable && !got.permanent), error: got && got.error };
  const again = summaryWords(got.obj.summary);
  const left = tokensMissing(text, again, known);
  const sentences = again.split(/(?<=[.!?…])\s+/).filter((x) => x.trim());
  if (again && left.names.length + left.figures.length + figuresInvented(text, again).length < lost && again.length >= summary.length * 0.8 && !sentences.some(looksLikeTokenDump)) return { summary: again, again: false };
  return { summary, again: false };
}

/* ------------------------------------------- a long scene, kept in stretches */

/* A LONG SCENE KEPT IN STRETCHES (stretches.js scenePlan). The narrator
 * carries a quarter of the writer's room of the scene's turns (talk.js
 * turnsFor); past that, the earliest went "left out here, to save room".
 * Once a scene runs past half of that, each finished stretch of its turns is
 * summed up, the one before carried in, so its earliest turns ride as their
 * summaries instead — Cozy Tavern's record for the pages its window lets go.
 * A stretch its model will not sum up is passed by after a second try, until
 * its words change. */
export function sceneWantsStretches(house, tokens) {
  const w = connFor(house, 'writer');
  const room = w ? contextOf(w) : 32000;
  return tokens > Math.max(3500, Math.floor(room / 8));
}
const sceneTried = new Map();   /* scene:fingerprint -> refused runs */
async function sceneStretchUp(novelId, conn) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const house = store.peek('house', 'house') || {};
  for (const pid of [...(novel.plays || [])]) {
    let p = store.peek('play', pid);
    if (!p) p = await store.open('play', pid).catch(() => null);
    if (!p || p.novelId !== novelId || (p.turns || []).some((t) => (picked(t) || {}).streaming)) continue;
    const scene = sceneChapter(p);
    if (!sceneWantsStretches(house, estimateTokens(chapterText(scene)))) continue;
    const plan = stretchPlan(scene);
    const kept = keptStretches(plan);
    if (JSON.stringify(kept) !== JSON.stringify(p.stretches || [])) store.change('play', pid, turnSteps.set({ stretches: kept }));
    const now = store.peek('novel', novelId);
    const c = store.peek('chapter', p.chapterId);
    const label = `the scene played as ${p.who || 'my character'} from ${c ? chapterLabel(now, c, { withName: true }) : 'the book'}`;
    const frame = helperFrame(house, now);
    const cardNames = ['people', 'places', 'lore'].flatMap((k) => ((now.notes || {})[k] || []).flatMap((x) => [x.name, ...(x.aka || [])])).filter(Boolean);
    const list = scene.passages;
    const book = foldedText((now.order || []).map((id) => { const x = store.peek('chapter', id); return x ? chapterText(x) : ''; }).join('\n\n'));
    for (let k = 0; k < plan.stretches.length; k++) {
      const st = plan.stretches[k];
      if (st.text) continue;
      const key = `${pid}:${st.fp}`;
      if ((sceneTried.get(key) || 0) >= 2) continue;
      const a = list.findIndex((x) => x.id === st.from), b = list.findIndex((x) => x.id === st.to);
      if (a < 0 || b < a) continue;
      const text = chapterText({ passages: list.slice(a, b + 1) });
      if (!text.trim()) continue;
      /* who and what this stretch names that the book or the scene already knew before it */
      const here = foldedText(text);
      const earlier = foldedText(chapterText({ passages: list.slice(0, a) }));
      const known = [...new Set(['people', 'places', 'lore'].flatMap((kind) => ((now.notes || {})[kind] || []).filter((x) => [x.name, ...(x.aka || [])].some((n) => n && nameInText(here, n, { words: false }) && (nameInText(earlier, n, { words: false }) || nameInText(book, n, { words: false })))).map((x) => x.name)))];
      setLight(novelId, 'reading', `Summing up part of ${label}…`);
      const before = k > 0 ? plan.stretches[k - 1].text : '';
      const ask = sceneStretchRequest({ novel: namedBook(now, house), chapterLabel: c ? chapterLabel(now, c, { withName: true }) : 'the book', who: p.who, text: '', words: st.words, before, known, part: 1, parts: 2 });
      const room = readingRoom(conn, estimateTokens(frame) + estimateTokens(ask) + 1000);
      const partWords = Math.max(200, Math.floor((room * 0.75) / 1.4));
      const parts = countWords(text) > partWords ? partsOf(text, partWords) : [text];
      let summary = '';
      let refused = false;
      for (let q = 0; q < parts.length; q++) {
        const got = await helperJson(novelId, conn, frame, sceneStretchRequest({ novel: namedBook(now, house), chapterLabel: c ? chapterLabel(now, c, { withName: true }) : 'the book', who: p.who, text: parts[q], words: st.words, before: q === 0 ? before : '', known,
          part: parts.length > 1 ? q + 1 : 0, parts: parts.length, soFar: summary }), { want: (o) => Boolean(summaryWords(o.summary)) });
        if (!got.ok) {
          /* a stall on these words (heard, but no progress for minutes) is theirs, as the notes' reading counts it (M748): tried a bounded number of times, never for ever */
          if (got.leashed && got.leashed !== 'long') throw failed(got);
          const fault = got.leashed === 'long' ? 'words' : await helperFault(novelId, conn, got);
          if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
          refused = true;
          break;
        }
        summary = summaryWords(got.obj.summary) || summary;
      }
      if (refused) { sceneTried.set(key, (sceneTried.get(key) || 0) + 1); continue; }
      if (!summary) continue;
      const r = await keepHardTokens({ novelId, conn, frame, novel: now, label, text, summary, known: cardNames, stretch: true });
      summary = r.summary || summary;
      await mustHold('helper', novelId);
      /* laid in only while the stretch reads as it did when asked */
      let laid = false;
      store.change('play', pid, (d) => {
        const next = withStretch(sceneChapter(d), st, summary, Date.now());
        if (!next) return false;
        d.stretches = next;
        laid = true;
        return true;
      });
      if (laid) { plan.stretches[k].text = summary; sceneTried.delete(key); }
      await store.flush('play', pid);
    }
  }
}

/* ------------------------------------------------------- the summary check */

/* THE SUMMARY CHECK (summarycheck.js — Cozy Tavern's continuous audit and its
 * keeper's detail check, for a book): every summary the helper wrote — a
 * chapter's, a stretch's, a scene's stretch — is held once against its own
 * words, CHECKS_PER_RUN a run, the book's oldest first and then its scenes,
 * and what is wrong in it is put right in it. Summaries kept before the check
 * are checked too. His own summary is his words, never checked. One its model
 * will not check is passed by after a second try, its mark saying so, until
 * its words change. */
export const CHECKS_PER_RUN = 3;
const checkTried = new Map();   /* what was checked, as its words read -> refused runs */
function summaryChecksDue(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return [];
  const out = [];
  const order = novel.order || [];
  order.forEach((id, i) => {
    const c = store.peek('chapter', id);
    if (!c || (c.passages || []).some((p) => (picked(p) || {}).streaming)) return;
    const opts = { closeLast: i < order.length - 1 };
    const list = c.passages || [];
    for (const st of stretchPlan(c, opts).stretches) {
      if (!st.text || checkedNow(st)) continue;
      const a = list.findIndex((p) => p.id === st.from), b = list.findIndex((p) => p.id === st.to);
      out.push({ kind: 'stretch', id, st, opts, entry: st, source: chapterText({ passages: list.slice(a, b + 1) }) });
    }
    const s = c.summary;
    if (s && String(s.text || '').trim() && s.by !== 'you' && s.fp === chapterPrint(c) && !s.again && !checkedNow(s)) out.push({ kind: 'chapter', id, entry: s, source: chapterText(c) });
  });
  for (const pid of novel.plays || []) {
    const p = store.peek('play', pid);
    if (!p || p.novelId !== novelId || (p.turns || []).some((t) => (picked(t) || {}).streaming)) continue;
    const scene = sceneChapter(p);
    const list = scene.passages;
    for (const st of stretchPlan(scene).stretches) {
      if (!st.text || checkedNow(st)) continue;
      const a = list.findIndex((x) => x.id === st.from), b = list.findIndex((x) => x.id === st.to);
      out.push({ kind: 'scene', id: pid, st, entry: st, source: chapterText({ passages: list.slice(a, b + 1) }) });
    }
  }
  return out;
}
/* the check's result laid in, only while the summary reads as it did when it was checked */
function layCheck(novelId, item, asked, text, checked, stamp) {
  if (item.kind === 'chapter') return saveSummary(novelId, item.id, stamp, { ...clone(store.peek('chapter', item.id).summary), text, checked }, { cache: true });
  const same = (plan) => { const cur = plan.stretches.find((s) => s.from === item.st.from && s.to === item.st.to); return Boolean(cur) && cur.fp === item.st.fp && cur.text === asked; };
  if (item.kind === 'stretch') {
    return store.change('chapter', item.id, (ch) => {
      if (!same(stretchPlan(ch, item.opts))) return false;
      const next = withStretch(ch, item.st, text, item.st.at || Date.now(), item.opts, checked);
      if (!next) return false;
      ch.stretches = next;
      return true;
    });
  }
  return store.change('play', item.id, (d) => {
    if (!same(stretchPlan(sceneChapter(d)))) return false;
    const next = withStretch(sceneChapter(d), item.st, text, item.st.at || Date.now(), {}, checked);
    if (!next) return false;
    d.stretches = next;
    return true;
  });
}
async function checkSummaries(novelId, conn) {
  const due = summaryChecksDue(novelId);
  const house = store.peek('house', 'house') || {};
  let done = 0;
  for (const item of due) {
    if (done >= CHECKS_PER_RUN) return true;
    const now = store.peek('novel', novelId);
    if (!now) return false;
    const asked = String(item.entry.text || '').trim();
    const key = `${item.kind}:${item.id}:${item.st ? item.st.fp : ''}:${checkSig(asked)}`;
    const c = item.kind === 'scene' ? store.peek('chapter', (store.peek('play', item.id) || {}).chapterId) : store.peek('chapter', item.id);
    const label = c ? chapterLabel(now, c, { withName: true }) : 'the book';
    const p = item.kind === 'scene' ? store.peek('play', item.id) : null;
    const what = item.kind === 'chapter' ? label : item.kind === 'stretch' ? `a stretch of ${label}` : `a stretch of the scene played as ${(p && p.who) || 'my character'} from ${label}`;
    const stamp = item.kind === 'chapter' ? summaryStamp(now, store.peek('chapter', item.id)) : null;
    if ((checkTried.get(key) || 0) >= 2) {
      /* its model would not check it: passed by, the mark saying so, until its words change */
      layCheck(novelId, item, asked, asked, { sig: checkSig(asked), at: Date.now(), unread: true }, stamp);
      checkTried.delete(key);
      done++;
      continue;
    }
    setLight(novelId, 'reading', `Checking the summary of ${what}…`);
    const frame = helperFrame(house, now);
    const book = namedBook(now, house);
    const room = readingRoom(conn, estimateTokens(frame) + estimateTokens(summaryCheckRequest({ novel: book, what, source: '', summary: asked, part: 1, parts: 2, scene: item.kind === 'scene' })) + 200);
    const partWords = Math.max(200, Math.floor((room * 0.75) / 1.4));
    const parts = countWords(item.source) > partWords ? partsOf(item.source, partWords) : [item.source];
    let text = asked;
    const fixed = [];
    const added = [];
    let refused = false;
    for (let q = 0; q < parts.length; q++) {
      const got = await helperJson(novelId, conn, frame, summaryCheckRequest({ novel: book, what, source: parts[q], summary: text, part: parts.length > 1 ? q + 1 : 0, parts: parts.length, scene: item.kind === 'scene' }),
        { want: (o) => Array.isArray(o.wrong) || Array.isArray(o.missing) });
      if (!got.ok) {
        /* a stall on these words is theirs (M748): tried a bounded number of times, never for ever */
        if (got.leashed && got.leashed !== 'long') throw failed(got);
        const fault = got.leashed === 'long' ? 'words' : await helperFault(novelId, conn, got);
        if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
        refused = true;
        break;
      }
      /* what it says is taken only where the words of this part prove it */
      const r = applyCheck(text, got.obj, parts[q]);
      text = r.text;
      fixed.push(...r.fixed);
      added.push(...r.added);
    }
    if (refused) { checkTried.set(key, (checkTried.get(key) || 0) + 1); done++; continue; }
    await mustHold('helper', novelId);
    const checked = { sig: checkSig(text), at: Date.now(), ...(fixed.length ? { fixed } : {}), ...(added.length ? { added } : {}) };
    layCheck(novelId, item, asked, text, checked, stamp);
    checkTried.delete(key);
    await store.flush(item.kind === 'scene' ? 'play' : 'chapter', item.id);
    done++;
  }
  return false;
}

/* ---------------------------------------- the bibliography, filled in */

/* The pages read into the notes before the bibliography was kept (or while
 * he had it filled by hand only): their versions on show, read as they are
 * now, with no facts kept for their words — read for the bibliography alone,
 * a few at a time, the oldest first; the rest next run. A part its model
 * will not read is passed by after two runs (an empty, incomplete mark), so
 * nothing is asked for ever. Returns whether some are left. */
export const BIB_BATCHES_PER_RUN = 2;
/* a helper whose model holds less than this keeps the notes alone: the
 * bibliography's facts and their rules would take the room its reading needs */
export const BIB_HELPER_MIN = 16000;
export function bibReading(novel, conn) { return bibAutoOn(novel) && Boolean(conn) && contextOf(conn) >= BIB_HELPER_MIN; }
/* the print of the words a change is read against: the words as the helper read them (`was`, kept on every part of a
 * change read in parts — only its first part carries them: 2.12.40, the audit) */
const oldPrint = (c) => (c && c.was ? c.was.split(SIG_SEP)[1] || '' : '') || (c && c.old && !c.oldOnly ? hashText(c.old) : '');
/* the passage a reading read, where it stands now: moved to another chapter while it was read (A new chapter from here),
 * there — as what it read is laid there (readChanges, movedTo: 2.12.40, the review — looked for only where it stood,
 * the words before's turns and facts were not found, and a fix read there took them all) */
function passageNow(novelId, chapterId, pid) {
  const here = chapterId ? store.peek('chapter', chapterId) : null;
  const p = here && (here.passages || []).find((x) => x.id === pid);
  if (p) return p;
  for (const id of ((store.peek('novel', novelId) || {}).order) || []) {
    const other = id !== chapterId ? store.peek('chapter', id) : null;
    const q = other && (other.passages || []).find((x) => x.id === pid);
    if (q) return q;
  }
  return null;
}
/* the facts the version a change replaced had for its words (the version whose words the change was read against) —
 * and, first, the facts its new words already have (carried to them with a change in place, put back with them, or
 * read before: another version picked), kept as the turns are (turnsBefore): {own, old} */
function factsKept(novelId, chapterId, c) {
  const p = passageNow(novelId, chapterId, c.pid);
  if (!p) return { own: null, old: null };
  const shown = (p.versions || []).find((x) => x.id === String(c.sig || '').split(SIG_SEP)[0]);
  const own = (shown && codexNow({ text: c.whole !== undefined ? c.whole : c.text, codex: shown.codex })) || null;
  const fp = oldPrint(c);
  const ofThem = (k) => (k && k.schema === CODEX_SCHEMA && Array.isArray(k.facts) && fp && k.fp === fp ? k : null);
  for (const v of p.versions || []) {
    /* a version's own: of words it had (another version), or kept with the words a Go on grew from (2.12.40, the audit:
     * the facts of the words before a Go on were looked for only on a version still reading as they did, and lost) */
    /* (words changed in place since, 2.12.2: their facts kept with the words before) */
    const k = ofThem(v.codex) || (v.before || []).map((b) => b && ofThem(b.codex)).find(Boolean);
    if (k) return { own, old: k };
  }
  return { own, old: null };
}
const codexBefore = (novelId, chapterId, c) => { const { own, old } = factsKept(novelId, chapterId, c); return [own, old].filter(Boolean); };
/* THE TURNS A CHANGE'S NEW WORDS ALREADY HAVE, AND THOSE OF THE WORDS IT REPLACED (2.12.40, the audit): the new words'
 * own — carried to them with a change in place, put back with them, or read before (another version picked) — and
 * the words before's, found as their facts are (factsKept): a version's own, of words it had or kept with the words a
 * Go on grew from, or kept with the newest words before a change in place (shape.js inPlaceFields): {own, old} */
function turnsKept(novelId, chapterId, c) {
  const p = passageNow(novelId, chapterId, c.pid);
  if (!p) return { own: null, old: null };
  const v = (p.versions || []).find((x) => x.id === String(c.sig || '').split(SIG_SEP)[0]);
  const whole = String((c.whole !== undefined ? c.whole : c.text) || '');
  const own = v && turnsOfPrint(v.continuity, hashText(whole)) ? v.continuity : null;
  const fp = oldPrint(c);
  for (const x of fp ? p.versions || [] : []) {
    const k = turnsOfPrint(x.continuity, fp) ? x.continuity : (x.before || []).map((b) => b && b.continuity).find((t) => turnsOfPrint(t, fp));
    if (k) return { own, old: k };
  }
  return { own, old: null };
}
const turnsBefore = (novelId, chapterId, c) => { const { own, old } = turnsKept(novelId, chapterId, c); return [own, old].filter(Boolean); };
/* WHAT A CHANGE'S READING CANNOT VOUCH FOR IS READ WHOLE (2.12.40, the review: a name changed everywhere between a Go on
 * and its reading — the turns and facts kept for the words before quoted the old name, so none of them was carried, and
 * the passage was said read whole with them lost). A change to a version's own words is read for what it adds; the
 * rest of the passage stands on what its words before were read for. When that cannot vouch for it — nothing kept for
 * the words before, their turns not read whole, or one of their turns or facts neither carried to the new words nor
 * given by the reading again — the passage is never said read whole: it is left owed, and the helper reads it whole by
 * itself (timelineDue, bibDue — one ask; what the reading found kept beside it). A plain Go on carries them all and costs
 * nothing more. A change to another version (another take) leaves the words before with their own version. */
/* (read as a change, against the words before of the version itself — a passage read whole, as new, is read for all of it) */
const ownWordsBefore = (c) => Boolean(c && (c.old || c.fromChange) && c.was) && c.was.split(SIG_SEP)[0] === String(c.sig || '').split(SIG_SEP)[0];
const wholeOf = (c) => String((c.whole !== undefined ? c.whole : c.text) || '');
function turnsUnvouched(novelId, chapterId, c, history) {
  if (!ownWordsBefore(c) || !history || history.complete !== true) return false;
  const { own, old } = turnsKept(novelId, chapterId, c);
  if (own && own.complete === true) return false;
  return !old || old.complete !== true || turnsLost(history, old, wholeOf(c)).length > 0;
}
function factsUnvouched(novelId, chapterId, c, codex) {
  if (!ownWordsBefore(c) || !codex) return false;
  const { own, old } = factsKept(novelId, chapterId, c);
  if (own && own.complete === true && !Number.isInteger(own.upTo)) return false;
  return !old || factsLost(codex, old, wholeOf(c)).length > 0;
}
/* the backfill's tries, by version: a batch its model will not read is read one passage at a time (bibNarrow), and a
 * passage tried twice alone is passed by — never asked for ever, never paid for again */
/* TRIES KEPT ON THE VERSION, FOR THE WORDS TRIED (2.12.40, the audit): kept in the page's memory by version id, they
 * were let go with every reload — Android closes a tab often — so a page its model would not read was asked again and
 * paid for after each one, never passed by; and a branch or a copied book keeps its versions' ids, so a try in one book
 * counted in the other. Now on the version, as `passed` is: `tries` = {facts: {fp, n}, turns: {fp, at, n}} — `at`,
 * the part of a passage read in parts it is for. Words changed since: none. */
const bibNarrow = new Set();
function triesOf(v, what, at = 0) {
  const t = v && v.tries && v.tries[what];
  return t && t.fp === hashText(String(v.text || '')) && (t.at || 0) === at ? Number(t.n) || 0 : 0;
}
/* one more try (n), or none (n 0), for the version as it was asked — never on words changed since */
function triedStep(passageId, versionId, what, fp, n, at = 0) {
  return (chapter) => {
    const p = (chapter.passages || []).find((x) => x.id === passageId);
    const v = p && (p.versions || []).find((x) => x.id === versionId);
    if (!v || v.streaming || hashText(String(v.text || '')) !== fp) return false;
    const tries = { ...(v.tries || {}) };
    if (n > 0) tries[what] = { fp, n, ...(at ? { at } : {}) };
    else delete tries[what];
    if (Object.keys(tries).length) v.tries = tries; else delete v.tries;
  };
}
const tryOnce = (x, what, at = 0) => {
  const v = liveVersion(x);
  if (v) store.change('chapter', x.chapterId, triedStep(x.pid, x.vid, what, hashText(x.text), triesOf(v, what, at) + 1, at));
};
const triesDone = (x, what) => store.change('chapter', x.chapterId, triedStep(x.pid, x.vid, what, hashText(x.text), 0));
/* the version a backfill asked about, while it is the one on show reading as it did */
function liveVersion(x) {
  const p = ((store.peek('chapter', x.chapterId) || {}).passages || []).find((y) => y.id === x.pid);
  const v = p && picked(p);
  return v && v.id === x.vid && !v.streaming && String(v.text || '') === x.text ? v : null;
}
/* the version a backfill asked about while it reads as it did, on show or not — what its answer is laid on
 * (timeline.js continuityStep, bibliography.js codexStep), and what it read before is kept with (2.12.40, the review) */
function askedVersion(x) {
  const p = ((store.peek('chapter', x.chapterId) || {}).passages || []).find((y) => y.id === x.pid);
  const v = p && (p.versions || []).find((y) => y.id === x.vid);
  return v && !v.streaming && String(v.text || '') === x.text ? v : null;
}
/* A STALL (2.12.40, the audit, and its review): an ask let go for its silence was thrown as a passing fault — every run
 * stopped there, before What it's about and the notes' check, and one that always stalls was asked on every run for
 * ever. Then a stall alone was counted once its model answered a probe — but a model only slow to answer is given a
 * longer leash after each silence (call.js, Cozy Tavern M748: three minutes, six, twelve, then a quarter of an hour), so
 * a page it would have read on the third was passed by after the second. Now a stall ends that reading for this run,
 * never the run — the notes' check and What it's about are read all the same, and the page is asked again next run on
 * the longer leash. It is counted as a try only when its leash was already the longest it is ever given; no probe is
 * asked. An answer that made no progress at all on its words (M748's other leash) is counted, as the notes' reading
 * counts it. */
const stallEnds = (got) => got.leashed === 'quiet' && !got.longest;
export function bibDue(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel || !bibAutoOn(novel)) return [];
  const seen = (novel.memory || {}).seen || {};
  const out = [];
  for (const cid of novel.order || []) {
    const c = store.peek('chapter', cid);
    if (!c) continue;
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      /* a passage its model would not read is not asked for again here either — as its words stand (timeline.js
       * setAsideNow, the Timeline's own test: 2.12.40, the review) */
      if (setAsideNow(novel, p, v)) continue;
      /* (one read in parts and not to its end yet stays due: 2.12.40) */
      const k = v && codexNow(v);
      if (!v || v.streaming || !String(v.text || '').trim() || (k && !Number.isInteger(k.upTo))) continue;
      /* not read yet: its reading gathers its facts */
      if ((seen[cid] || {})[p.id] !== signature(v)) continue;
      out.push({ chapterId: cid, pid: p.id, vid: v.id, text: String(v.text), source: `${chapterLabel(novel, c, { withName: false })}, passage ${nums.get(p.id) || '—'}` });
    }
  }
  return out;
}
async function bibBackfill(novelId, conn) {
  if (!bibReading(store.peek('novel', novelId), conn)) return false;
  const due = bibDue(novelId);
  if (!due.length) return false;
  const house = store.peek('house', 'house') || {};
  let batches = 0;
  let i = 0;
  let again = false;
  for (let guard = 0; i < due.length && guard < 1000; guard++) {
    if (batches >= BIB_BATCHES_PER_RUN) return true;
    const now = store.peek('novel', novelId);
    if (!now || !bibAutoOn(now)) return false;
    const frame = helperFrame(house, now);
    const names = NOTE_KINDS.filter((k) => k !== 'threads').flatMap((k) => ((now.notes || {})[k] || []).map((c) => c.name)).filter(Boolean).slice(0, 200);
    const room = readingRoom(conn, estimateTokens(frame) + estimateTokens(bibFactsRequest({ novel: now, sources: [], names })) + 400);
    const words = Math.max(300, Math.min(6000, Math.floor((room * 0.6) / 1.4)));
    /* each passage's next ask: the whole of it — or, one longer than the room or begun in parts, its next part, as the
     * Timeline's are (2.12.40, the audit: only as much of it as fitted was read, and its end never) */
    const unitOf = (x) => {
      const v = liveVersion(x);
      const k = codexNow(v);
      if (!v || (k && !Number.isInteger(k.upTo))) return null;
      const at = k && k.upTo > 0 && k.upTo < x.text.length ? k.upTo : 0;
      if (!at && countWords(x.text) <= words) return { ...x, at: 0, shown: x.text, whole: true, last: true, gap: false };
      const part = nextPart(x.text, words, at);
      if (!part) return null;
      return { ...x, at, end: part.end, shown: `${x.text.slice(part.start, part.end)}\n\n(part ${part.i} of ${part.n})`, whole: false, last: part.last, gap: Boolean(at && k.gap) };
    };
    const batch = [];
    let w = 0;
    const one = bibNarrow.has(novelId);
    while (i < due.length) {
      const u = unitOf(due[i]);
      if (!u) { i++; continue; }
      if (batch.length && (!u.whole || one || w + countWords(u.text) > words)) break;
      batch.push(u);
      w += countWords(u.text);
      if (!u.whole) break;
      i++;
    }
    if (!batch.length) continue;
    setLight(novelId, 'reading', 'Filling the bibliography from the book…');
    const lay = (x, codex) => store.change('chapter', x.chapterId, codexStep(x.pid, x.vid, codex));
    /* tried twice and not read (or not answered for): passed by, never asked for again (a part: that part, the rest read) */
    /* (taken out of the ask before its tries are let go — 2.12.37: after the delete it was asked a third time) */
    const spent = batch.filter((u) => triesOf(liveVersion(u), 'facts', u.at) >= 2);
    for (const u of spent) {
      const empty = { ...codexOf(undefined, { text: u.text }), complete: false };
      lay(u, u.whole ? empty : factsTo(u, empty, { passedBy: true }));
      triesDone(u, 'facts');
    }
    const asking = batch.filter((u) => !spent.includes(u));
    if (!asking.length) continue;
    const got = await helperJson(novelId, conn, frame, bibFactsRequest({ novel: namedBook(now, house), sources: asking.map((x) => ({ source: x.source, text: x.shown })), names }),
      { want: (o) => Array.isArray(o.bibliography) });
    if (!got.ok) {
      /* let go on its leash: a stall ends this reading for this run (stallEnds) — of several, read one at a time from
       * then on; alone, counted only on its longest leash, or when it made no progress at all on them (M748) */
      if (got.leashed === 'gaveway') throw failed(got);
      if (got.leashed && asking.length > 1) { bibNarrow.add(novelId); return true; }
      if (stallEnds(got)) return true;
      const fault = got.leashed ? 'words' : await helperFault(novelId, conn, got);
      if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
      /* its model will not read them: one at a time from here, each tried twice at most */
      if (asking.length > 1) bibNarrow.add(novelId);
      else tryOnce(asking[0], 'facts', asking[0].at);
      if (asking.length === 1 && !asking[0].whole) i++;
      batches++;
      continue;
    }
    await mustHold('helper', novelId);
    /* a source as the answer says it ("Chapter 3, passage 4" for Chapter Three, passage 4) */
    const said = (r) => sourceKey(r && r.source);
    const answered = got.obj.bibliography.filter((r) => r && typeof r === 'object');
    for (const x of asking) {
      let rows = answered.filter((r) => said(r) === sourceKey(x.source));
      /* asked for one, answered for one: that one, however it named it */
      if (!rows.length && asking.length === 1 && answered.length === 1) rows = answered;
      /* not answered for among others: asked again later (twice at most) */
      if (!rows.length && asking.length > 1) { tryOnce(x, 'facts', x.at); again = true; continue; }
      let codex = rows.length ? null : codexOf(undefined, { text: x.shown, whole: x.text });
      for (const row of rows) codex = mergeCodex(codex, codexOf(row.facts, { text: x.shown, whole: x.text }));
      if (rows.length !== 1) codex.complete = false;
      if (x.whole) {
        /* (begun in parts, or left owed by a change's reading — factsUnvouched: what it found kept beside what this one
         * finds, each fact once, as the Timeline keeps an earlier reading's turns) */
        const had = codexNow(askedVersion(x));
        lay(x, had && Number.isInteger(had.upTo) ? withCarriedFacts(codex, had, x.text) : codex);
      } else {
        /* a part read: what the parts before it found kept with it, read as far as its end */
        const out = factsTo(x, codex);
        const had = codexNow(askedVersion(x));
        if (had && Number.isInteger(had.upTo)) out.facts = mergeCodex(had, out).facts;
        lay(x, out);
        if (x.last) i++;
      }
      if (triesOf(liveVersion(x), 'facts', x.at)) triesDone(x, 'facts');
    }
    await store.flush();
    batches++;
  }
  if (!again) bibNarrow.delete(novelId);
  return again;
}

/* -------------------------------------------- the Timeline, read for itself */

/* THE TIMELINE HEALS ITSELF (2.12.37 — his report: "5 passages have no complete timeline reading yet. Read the whole
 * book again… I thought Super automatic makes everything autonomous and self-heals"). A passage the helper has read
 * whose words carry no complete Timeline reading — read before the Timeline was kept, its reading's answer gave none
 * for it, or its words changed on the page itself while its turns stayed with the words before (before 2.12.37) — is
 * put right by itself: read for its turns alone, a few passages a run (prompts.js timelineRequest), once the notes have
 * nothing else to read. A passage its model will not read is tried twice, then passed by. (Turns kept with other words
 * are never carried to these here — 2.12.40, the review: they may be the turns of the words a Go on grew from, and the
 * words it added were said read with none of theirs. Words changed on the page itself carry their turns as they change:
 * inplace.js, mend.js, changes.js.) */
export const TIMELINE_BATCHES_PER_RUN = 2;
const tlNarrow = new Set();
export function timelineDue(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return [];
  const seen = (novel.memory || {}).seen || {};
  const out = [];
  for (const cid of novel.order || []) {
    const c = store.peek('chapter', cid);
    if (!c) continue;
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (!v || v.streaming || !String(v.text || '').trim()) continue;
      /* read for its turns, passed by (tried twice for these very words) or set aside as its words stand: not read
       * here — the Timeline's own tests, so what it counts owed is what is read (timeline.js turnsOwed, 2.12.40) */
      if (!turnsOwed(novel, p, v)) continue;
      /* not read yet: its reading gathers its turns */
      if ((seen[cid] || {})[p.id] !== signature(v)) continue;
      out.push({ chapterId: cid, pid: p.id, vid: v.id, text: String(v.text), source: `${chapterLabel(novel, c, { withName: false })}, passage ${nums.get(p.id) || '—'}` });
    }
  }
  return out;
}
/* A PASSAGE LONGER THAN THE ROOM, READ IN PARTS (2.12.40, the audit: it was cut to what fits and asked so, twice — the
 * same cut words, its end never sent — then passed by and said as "its model would not read it whole", when the app
 * had cut it, never its model). Each part asked by itself, as the page has it; its turns gathered on the version as
 * the parts are read (`upTo`: how far — a run, a reload or a failure goes on from there, never asking a part read
 * again); the passage read whole with its last part. A part its model gives no sound reading of is tried twice, then
 * passed by (`gap`) and the rest read — the passage then passed by, every turn it found kept. */
/* the parts of the words from `from`, as they stand on the page ([{start, end}]): at the ends of paragraphs where it
 * can, a paragraph longer than the room at the start of a word, every so many words (as partsOf) */
export function spansOf(text, words = 9000, from = 0) {
  words = Math.max(1, Math.floor(Number(words) || 9000));
  const t = String(text || '');
  const out = [];
  let start = -1;
  let end = -1;
  let n = 0;
  const push = () => { if (start >= 0 && t.slice(start, end).trim()) out.push({ start, end }); start = -1; end = -1; n = 0; };
  const re = /[^\n]+/g;
  re.lastIndex = Math.max(0, Math.min(t.length, Math.floor(Number(from) || 0)));
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const ps = m.index;
    const pe = ps + m[0].length;
    const w = countWords(m[0]);
    if (w > words) {
      push();
      const cjk = /[぀-ヿ㐀-鿿가-힯]/g;
      const starts = [...m[0].matchAll(cjk), ...m[0].replace(cjk, ' ').matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)].map((x) => x.index).sort((a, b) => a - b);
      let s = ps;
      for (let k = words; k < starts.length; k += words) { if (t.slice(s, ps + starts[k]).trim()) out.push({ start: s, end: ps + starts[k] }); s = ps + starts[k]; }
      if (t.slice(s, pe).trim()) out.push({ start: s, end: pe });
      continue;
    }
    if (start >= 0 && n + w > words) push();
    if (start < 0) start = ps;
    end = pe;
    n += w;
  }
  push();
  return out;
}
/* the part of a passage that starts at `at`, with where it stands among its parts */
function nextPart(text, words, at) {
  const rest = spansOf(text, words, at);
  if (!rest.length) return null;
  const before = at ? spansOf(text.slice(0, at), words).length : 0;
  return { ...rest[0], i: before + 1, n: before + rest.length, last: rest.length === 1 };
}
/* a passage's turns as read so far: read through `u` (`passedBy`: its model gave no sound reading of it, tried twice) —
 * whole with its last part, passed by when a part was — or, a part asked again, held where it was */
function readTo(u, history, { passedBy = false, again = false } = {}) {
  const { upTo: _u, gap: _g, passed: _p, ...h } = history;
  const gap = u.gap || passedBy;
  if (again) return { ...h, complete: false, ...(u.at ? { upTo: u.at } : {}), ...(u.gap ? { gap: true } : {}) };
  if (u.last) return { ...h, complete: !gap && history.complete === true, ...(gap ? { passed: hashText(u.text) } : {}) };
  return { ...h, complete: false, upTo: u.end, ...(gap ? { gap: true } : {}) };
}
/* a passage's facts as read so far, as its turns are (readTo): read through `u` — an answer that gives none for a part, as
 * for a whole passage, an honest gap never asked again — whole with its last part */
function factsTo(u, codex, { passedBy = false } = {}) {
  const { upTo: _u, gap: _g, ...k } = codex;
  const gap = u.gap || passedBy || codex.complete !== true;
  if (u.last) return { ...k, complete: !gap };
  return { ...k, complete: false, upTo: u.end, ...(gap ? { gap: true } : {}) };
}
async function timelineBackfill(novelId, conn) {
  const due = timelineDue(novelId);
  if (!due.length) return false;
  const house = store.peek('house', 'house') || {};
  let batches = 0;
  let i = 0;
  let again = false;
  for (let guard = 0; i < due.length && guard < 1000; guard++) {
    if (batches >= TIMELINE_BATCHES_PER_RUN) return true;
    const now = store.peek('novel', novelId);
    if (!now) return false;
    const frame = helperFrame(house, now);
    const people = ((now.notes || {}).people || []).map((c) => c.name).filter(Boolean).slice(0, 300);
    const threads = ((now.notes || {}).threads || []).map((c) => c.name).filter(Boolean).slice(0, 300);
    const room = readingRoom(conn, estimateTokens(frame) + estimateTokens(timelineRequest({ sources: [], people, threads })) + 400);
    const words = Math.max(300, Math.min(6000, Math.floor((room * 0.6) / 1.4)));
    /* each passage's next ask: the whole of it — or, one longer than the room or begun in parts, its next part; none
     * for one read or passed by since, or changed */
    const unitOf = (x) => {
      const v = liveVersion(x);
      const k = continuityNow(v);
      /* (read, by the Timeline's own test — a reading kept whole whose turn no longer holds is read again: 2.12.40) */
      if (!v || continuityDone(v) || turnsPassed(v)) return null;
      const at = k && Number.isInteger(k.upTo) && k.upTo > 0 && k.upTo < x.text.length ? k.upTo : 0;
      if (!at && countWords(x.text) <= words) return { ...x, at: 0, shown: x.text, whole: true, last: true, gap: false };
      const part = nextPart(x.text, words, at);
      if (!part) return null;
      return { ...x, at, end: part.end, shown: `${x.text.slice(part.start, part.end)}\n\n(part ${part.i} of ${part.n})`, whole: false, last: part.last, gap: Boolean(at && k.gap) };
    };
    const batch = [];
    let w = 0;
    const one = tlNarrow.has(novelId);
    while (i < due.length) {
      const u = unitOf(due[i]);
      if (!u) { i++; continue; }
      if (batch.length && (!u.whole || one || w + countWords(u.text) > words)) break;
      batch.push(u);
      w += countWords(u.text);
      /* a part is asked by itself; its passage stays next until its last part is read */
      if (!u.whole) break;
      i++;
    }
    if (!batch.length) continue;
    setLight(novelId, 'reading', 'Reading the book for the Timeline…');
    const lay = (x, history) => store.change('chapter', x.chapterId, continuityStep(x.pid, x.vid, history));
    /* tried twice and not read: passed by for these words — the Timeline says it has no reading of them (a part of one
     * read in parts: that part, and the rest read) */
    const spent = batch.filter((u) => triesOf(liveVersion(u), 'turns', u.at) >= 2);
    for (const u of spent) {
      const empty = continuityOf(undefined, now.notes, { text: u.text });
      lay(u, u.whole ? { ...empty, passed: hashText(u.text) } : readTo(u, empty, { passedBy: true }));
      triesDone(u, 'turns');
    }
    const asking = batch.filter((u) => !spent.includes(u));
    if (!asking.length) continue;
    const got = await helperJson(novelId, conn, frame, timelineRequest({ sources: asking.map((x) => ({ source: x.source, text: x.shown })), people, threads }),
      { want: (o) => Array.isArray(o.timeline) });
    if (!got.ok) {
      /* let go on its leash: as the bibliography's (stallEnds) */
      if (got.leashed === 'gaveway') throw failed(got);
      if (got.leashed && asking.length > 1) { tlNarrow.add(novelId); return true; }
      if (stallEnds(got)) return true;
      const fault = got.leashed ? 'words' : await helperFault(novelId, conn, got);
      if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
      if (asking.length > 1) tlNarrow.add(novelId);
      else tryOnce(asking[0], 'turns', asking[0].at);
      /* (a part it would not read: asked again another run — the passages after it are read meanwhile) */
      if (asking.length === 1 && !asking[0].whole) i++;
      batches++;
      continue;
    }
    await mustHold('helper', novelId);
    const said = (r) => sourceKey(r && r.source);
    const answered = got.obj.timeline.filter((r) => r && typeof r === 'object');
    const notes = (store.peek('novel', novelId) || now).notes;
    for (const x of asking) {
      let rows = answered.filter((r) => said(r) === sourceKey(x.source));
      if (!rows.length && asking.length === 1 && answered.length === 1) rows = answered;
      if (!rows.length) { tryOnce(x, 'turns', x.at); again = true; if (!x.whole) i++; continue; }
      let history = null;
      for (const row of rows) history = mergeContinuity(history, continuityOf(row.events, notes, { text: x.shown, whole: x.text }), x.text, { oneReading: true });
      if (rows.length !== 1) history.complete = false;
      /* the sound turns an earlier reading of these very words found — or its parts read before — stay beside what this
       * one finds, never lost to it; the same turn kept once, this reading's (timeline.js sameTurn — 2.12.40, the
       * audit: two readings of one turn were two rows) */
      /* (of these words on show or not — its answer is laid on them either way: 2.12.40, the review — and only the
       * turns that still hold in them: one that does not is why they were read again) */
      const had = continuityNow(askedVersion(x));
      if (had) history = { ...history, events: [...had.events.filter((e) => e && turnStands(e, x.text) && !history.events.some((n) => sameTurn(n, e, x.text))), ...history.events] };
      /* a turn it could not ground keeps the passage (or its part) due: asked once more, then passed by */
      if (!history.complete) {
        tryOnce(x, 'turns', x.at);
        again = true;
        lay(x, x.whole ? history : readTo(x, history, { again: true }));
        if (!x.whole) i++;
        continue;
      }
      if (triesOf(liveVersion(x), 'turns', x.at)) triesDone(x, 'turns');
      lay(x, readTo(x, history));
      /* (a part read: its next part asked next, a part a batch) */
      if (!x.whole && x.last) i++;
    }
    await store.flush();
    batches++;
  }
  if (!again) tlNarrow.delete(novelId);
  return again;
}

/* ------------------------------------------- what it's about, how it reads */

const KEPT_WORDS = { about: 'What it’s about', style: 'How it reads' };

/* his own words for it, as one short mark: kept with what the helper writes,
 * so his rewriting them is seen (Cozy Tavern M518-2) */
function ownFp(novel, key) { return hashText(String(((novel || {})[key === 'about' ? 'brief' : 'style']) || '').trim()); }
/* his words as they stand now, kept by value: what a slow answer is stamped with when it lands (the book's record changes in place meanwhile) */
const wordsNow = (novel) => ({ brief: String((novel && novel.brief) || ''), style: String((novel && novel.style) || '') });

/* A result may meet a newer phone copy only when its save lands. Repeat
 * the protection there, too: a manual correction, mode change or restarted
 * reread must not be overwritten by replaying an older helper result. */
function keepIfUnchanged(novelId, key, before, after) {
  const novel = store.peek('novel', novelId);
  const generation = ((novel || {}).memory || {}).reread || 0;
  const move = novelSteps.moveKept([{ key, from: clone(before || null), to: clone(after || null) }]);
  return store.change('novel', novelId, (n) => {
    if (((n.memory || {}).reread || 0) !== generation || !keptByHelper(n).includes(key)) return false;
    move(n);
  });
}

/* the kept texts a reading's answer changes: {key: {before, after}} — never
 * a thinner one in place of what stands (Cozy Tavern's M517/M522: a one-line
 * answer is not the book), stamped with his words as they were when it was
 * asked (`asked`), so his rewriting them meanwhile is still seen (M72-7) */
function keptChanges(novel, answer, asked = novel) {
  const out = {};
  for (const key of keptByHelper(novel)) {
    const text = cleanText(answer && answer[key]);
    const before = (novel.kept && novel.kept[key]) || null;
    const was = String((before && before.text) || '').trim();
    if (!text || text === was) continue;
    if (was && !(before && before.again) && thins(was, text)) continue;
    out[key] = { before: clone(before), after: { text, at: Date.now(), ownFp: ownFp(asked, key) } };
  }
  return out;
}
/* the kept texts the notes' check put right: whole ones only, never over his correction (prompts.js keptByHelper) */
function auditKept(novel, answer, asked) {
  const out = {};
  for (const key of keptByHelper(novel)) {
    const text = cleanText(answer && answer[key]);
    const before = (novel.kept && novel.kept[key]) || null;
    if (!text || text === String((before && before.text) || '').trim()) continue;
    if (text.length < 200 && text.split(/(?<=[.!?…])\s+/).filter((x) => x.trim()).length < 2) continue;
    out[key] = { before: clone(before), after: { text, at: Date.now(), ownFp: ownFp(asked, key) } };
  }
  return out;
}
function mergeKeptUndo(old, kept) {
  const out = { ...(old || {}) };
  for (const [key, k] of Object.entries(kept)) out[key] = out[key] ? { before: out[key].before, after: k.after } : k;
  return out;
}
const keptChangedOf = (kept) => Object.keys(kept || {}).map((key) => ({ kind: 'book', name: KEPT_WORDS[key], how: kept[key].before && kept[key].before.text ? 'changed' : 'new' }));

/* the ones to write whole: set to Automatic, his correction not standing,
 * never tried yet — or written beside words of his he has rewritten since,
 * so it never repeats or contradicts what he just wrote (Cozy Tavern
 * M518-2) — and only once the book has words */
function toKeep(novel) {
  const stale = (k, key) => k.by !== 'you' && typeof k.ownFp === 'string' && k.ownFp !== ownFp(novel, key);
  /* asked to be written from the book again (keepAgain): the words that stood stay in use until the new ones land */
  const missing = keptByHelper(novel).filter((key) => { const k = novel.kept && novel.kept[key]; return !k || stale(k, key) || Boolean(k.again); });
  if (!missing.length) return [];
  for (const id of novel.order || []) {
    const c = store.peek('chapter', id);
    if (c && chapterWords(c) > 0) return missing;
  }
  return [];
}

/* Written whole from the book (the chapters that fit whole, the rest in
 * short), its notes and his words — once, when there is none yet, or when he
 * asks for it again from the book. From then on every reading keeps it
 * current. An answer without it is kept as tried (empty), so it is never
 * asked again in a loop: the next reading writes it. */
async function keepTheBook(novelId, conn) {
  let novel = store.peek('novel', novelId);
  if (!novel) return;
  /* kept before his words were marked beside it (before 2.5): marked now, as
   * his words stand — so his next rewrite of them is seen */
  for (const key of keptByHelper(novel)) {
    const k = novel.kept && novel.kept[key];
    if (k && k.by !== 'you' && String(k.text || '').trim() && typeof k.ownFp !== 'string') keepIfUnchanged(novelId, key, k, { ...k, ownFp: ownFp(novel, key) });
  }
  novel = store.peek('novel', novelId);
  const keeps = toKeep(novel);
  if (!keeps.length) return;
  const house = store.peek('house', 'house') || {};
  const chapters = {};
  for (const id of novel.order || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  setLight(novelId, 'reading', `Reading the book for ${keeps.map((k) => KEPT_WORDS[k]).join(' and ')}…`);
  const frame = helperFrame(house, novel);
  const notesFit = notesRoomOf(conn);
  /* his premises, his word on the book (2.12.36): what it is about holds them — a fifth of its room at most, and only
   * what the book leaves (besideRoom, 2.12.40); those naming the people and things of the notes first, then the newest */
  const fixed0 = estimateTokens(frame) + estimateTokens(notesText(novel, { forHelper: true, fit: notesFit })) + estimateTokens(aboutTheBook(novel, { plans: false, kept: 'his' })) + 1200;
  const prem = premisesFitted(novel, chapters, premisesOf(novel, chapters).length ? Math.min(Math.floor(readingRoom(conn, 0) / 5), besideRoom(conn, novel, chapters, fixed0)) : 0, { cards: novel.notes || {} });
  const fixed = fixed0 + estimateTokens(premisesPart(prem.premises, prem.premisesLeft));
  const room = readingRoom(conn, fixed);
  if (room < 600) {
    /* no room to read the book beside its notes: never written from no book —
     * kept as tried, and the readings keep it as the book goes on */
    triedKeeping(novelId, keeps, novel);
    return;
  }
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room });
  const started = Date.now();
  const asked = wordsNow(novel);
  const generation = (novel.memory || {}).reread || 0;
  const sameReading = () => {
    const n = store.peek('novel', novelId);
    return Boolean(n && ((n.memory || {}).reread || 0) === generation);
  };
  const got = await helperJson(novelId, conn, frame, keepRequest({ novel: namedBook(novel, house), keeps, bookText: bookText(fit.book), notesFit, ...prem }), { want: (o) => keeps.some((k) => typeof o[k] === 'string' && o[k].trim()) });
  await mustHold('helper', novelId);
  if (!sameReading()) return;
  if (!got.ok) {
    const fault = await helperFault(novelId, conn, got);
    await mustHold('helper', novelId);
    if (!sameReading()) return;
    if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
    /* this book's: another book's failure never counts toward giving up on this one */
    const key = `keep:${novelId}:${keeps.join(',')}`;
    const n = (stuck.get(key) || 0) + 1;
    stuck.set(key, n);
    if (n < 2) throw failed({ error: got.error });
    stuck.delete(key);
    /* its model would not write it: kept as tried, so the readings write it as the book goes on */
    triedKeeping(novelId, keeps, asked);
    return;
  }
  const latest = store.peek('novel', novelId);
  if (!latest) return;
  const left = [];
  for (const key of keeps) {
    if (!keptByHelper(latest).includes(key)) continue;
    /* he corrected it, or a reading wrote it, while it was being written: that stands */
    const k = latest.kept && latest.kept[key];
    if (k && (k.by === 'you' || ((k.at || 0) > started && !k.again))) continue;
    /* only what the answer gave, and only a whole of it — a line is not the book (Cozy Tavern M517, M478) */
    const text = cleanText(got.obj[key]);
    const whole = text && (text.length >= 200 || text.split(/(?<=[.!?…])\s+/).filter((x) => x.trim()).length >= 2);
    if (!whole) { left.push(key); continue; }
    /* stamped with his words as they were when it was asked: his rewriting them meanwhile is seen */
    keepIfUnchanged(novelId, key, k, { text, at: Date.now(), ownFp: ownFp(asked, key) });
  }
  if (left.length) triedKeeping(novelId, left, asked);
  await store.flush('novel', novelId);
}
/* what could not be written whole from the book is kept as tried — what stood
 * stays as it was (never written over with nothing), marked tried for his
 * words as they were asked from — so it is not asked again in a loop: the
 * readings write it as the book goes on */
function triedKeeping(novelId, keys, asked) {
  const latest = store.peek('novel', novelId);
  if (!latest) return;
  for (const k of keys) {
    if (!keptByHelper(latest).includes(k)) continue;
    const was = latest.kept && latest.kept[k];
    if (!was) keepIfUnchanged(novelId, k, null, { text: '', at: Date.now(), ownFp: ownFp(asked, k) });
    else if (was.by !== 'you') { const { again: _a, ...rest } = was; keepIfUnchanged(novelId, k, was, { ...rest, ownFp: ownFp(asked, k) }); }
  }
}

/* ------------------------------------------------- the notes' auditor */
/* Cozy Tavern's ledger auditor, for a book: every few readings — and once
 * for notes kept before there was one, and whenever he asks — the whole
 * notes are held against the book as it stands, and whatever they still
 * hold from words since rewritten or taken out, or have drifted on, is put
 * right, and cards that repeat each other are folded into one: with the
 * reading's Undo, lit, his own cards keeping his words. What it found is
 * kept for him to read (memory.audit): its verdict, whether anything is
 * left for him to look at, and each change with its why. Nothing waits on
 * it: it runs once everything else is read. */
export const AUDIT_EVERY = 6;
/* what a check does, by version — 2: it folds repeats and says why; 3: a
 * person's card is a short portrait, its lasting details in the bibliography
 * (2.12). Notes checked under an earlier one are checked again once, by
 * themselves — once the bibliography holds the book's facts (owedCheck). */
export const AUDIT_V = 12;
export function auditDue(novel) {
  const m = (novel && novel.memory) || {};
  const notes = (novel && novel.notes) || {};
  if (!NOTE_KINDS.some((k) => (notes[k] || []).length)) return false;
  if (m.undo && m.undo.keep) return false;
  if (m.auditAsked) return true;
  /* his entries under a card changed since the last check — by his hand, his partner, Quick add or a lorebook: the
   * notes are held to them now (2.12.37) */
  if (m.audit && typeof m.audit.entries === 'string' && entriesOwed(novel, m.audit.entries)) return true;
  return Boolean(m.audit) && (m.audit.reads || 0) >= AUDIT_EVERY;
}
/* A book opened for the first time since there was an auditor, or since it
 * learned more: notes kept before then are checked against the book once —
 * whatever an old version left in them, or repeats, goes, by itself */
export function firstCheck(novelId) {
  const novel0 = store.peek('novel', novelId);
  if (!novel0) return false;
  /* cards whose words carry the notes' own lines, put right at open (shape.js cleanCard) — their mark as it was */
  const mended = NOTE_KINDS.flatMap((k) => ((novel0.notes || {})[k] || []).map((c) => [k, cleanCard(c, k)]).filter(([, c]) => c));
  if (mended.length) store.change('novel', novelId, (n) => { for (const [k, c] of mended) n.notes[k] = (n.notes[k] || []).map((x) => (x.id === c.id ? c : x)); }, { now: true });
  /* what the helper keeps of the book, frozen before 2.12.19 by a correction typed into it (or his partner's): handed back to the
   * helper, to be written afresh from the book beside his words — what it said used until then, and kept in the book's record */
  for (const key of ['about', 'style']) {
    const k = novel0.kept && novel0.kept[key];
    if (!k || k.by !== 'you' || !autoOn(novel0, key)) continue;
    store.change('novel', novelId, novelSteps.setKept(key, { text: String(k.text || ''), at: k.at || Date.now(), again: true, was: { text: String(k.text || ''), at: k.at || 0 } }), { now: true });
  }
  const novel = store.peek('novel', novelId);
  const a = (novel.memory && novel.memory.audit) || null;
  if (a && (a.v || 1) >= AUDIT_V) return false;
  /* every chapter in hand first (2.12.40, the audit: a chapter that failed to open was read as none — no premise in it,
   * none of his words — and the check it owed was never asked, the version kept as if it had been weighed): tried again
   * the next time the book opens. A chapter gone for good (null) is no reason to wait. */
  if ((novel.order || []).some((id) => store.peek('chapter', id) === undefined)) return false;
  const has = NOTE_KINDS.some((k) => ((novel.notes || {})[k] || []).length);
  /* owed once the bibliography holds the book's facts (owedCheck): notes checked by the check of 2.4–2.11 only for the
   * portrait — so not where the bibliography is not filled from the book; older ones in any case; notes checked under 3 owe nothing there */
  const owed = !has ? null : a && (a.v || 1) >= 3 ? null : a && (a.v || 1) >= 2 ? 'portrait' : 'all';
  /* 4–6 (2.12.11–13): a card of his with "Since then", or a thread of his, not yet judged against the book is held against it, soon */
  /* (his cards and threads at once; the helper's threads and his other words only in a book he has changed himself — where they can have been overturned — else at the next check, every few readings) */
  const chapters = chaptersOf(novel);
  const hisOwn = (x) => x.kind !== 'threads' || his(((novel.notes || {}).threads || []).find((c) => c.id === x.id));
  const judge = has ? mineToJudge(novel) : [];
  const sinceHis = judge.some(hisOwn) || (Boolean(hisWordsFolded(novel, chapters)) && (judge.length > 0 || wordsToJudge(novel, chapters).length > 0));
  /* 11 (2.12.36): his premises shown to the check — notes read before it never saw them, so a book with any is held against them once, soon */
  const premised = has && (!a || (a.v || 1) < 11) && premisesOf(novel, chapters).length > 0;
  /* 12 (2.12.37): his entries and the Timeline shown to the check — a book with an entry under a card of the notes is held to them once, soon */
  const entered = has && (!a || (a.v || 1) < 12) && joinedEntries(novel).length > 0;
  store.change('novel', novelId, novelSteps.setMemory({ audit: { ...(a || {}), at: a ? a.at || 0 : Date.now(), reads: a ? a.reads || 0 : 0, v: AUDIT_V, entries: entriesPrint(novel), ...(owed ? { owed } : {}) }, ...(sinceHis || premised || entered ? { auditAsked: true } : {}) }), { now: true });
  return has;
}
/* A check owed by a book opened for the first time since the check learned
 * more: asked once the pages read before the bibliography have their facts —
 * so a card made a portrait leaves its details to them, never to nothing —
 * or at once where the bibliography is not filled from the book (a check owed
 * only for the portrait is let go there: it has nothing to leave them to). */
function owedCheck(novelId, conn, bibLeft) {
  const novel = store.peek('novel', novelId);
  const a = novel && novel.memory && novel.memory.audit;
  if (!a || !a.owed) return;
  const filling = bibReading(novel, conn);
  if (filling && (bibLeft || bibDue(novelId).length)) return;
  const { owed, ...rest } = a;
  const ask = (owed === 'all' || filling) && NOTE_KINDS.some((k) => ((novel.notes || {})[k] || []).length);
  store.change('novel', novelId, novelSteps.setMemory({ audit: rest, ...(ask ? { auditAsked: true } : {}) }), { now: true });
}
/* Check the notes against the book, now (by hand, and for notes kept before the auditor) */
export function askAudit(novelId, { soon = 300 } = {}) {
  store.change('novel', novelId, novelSteps.setMemory({ auditAsked: true }), { now: true });
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, soon);
}
/* what of a card is his, for the check: the parts it must never change (where
 * someone is now, and how they stand with the others, move with the story) */
const HIS_PARTS = { name: 'the name', aka: 'the other names', about: 'who they are', open: 'whether it is open' };
function hisLine(kind, c) {
  const list = Array.isArray(c.updated && c.updated.his) ? c.updated.his : null;
  if (!list) return c.name;
  const parts = list.filter((f) => HIS_PARTS[f]).map((f) => (f === 'about' && kind !== 'people' ? 'what it says' : HIS_PARTS[f]));
  return parts.length ? `${c.name} (my words: ${parts.join(', ')})` : '';
}
/* HIS OWN PASSAGES, AS THE CHECK IS TOLD OF THEM (2.12.41, the review: its rule for his entries called a page of his own
 * the page's slip, where the reading holds it his newer word): each that is his own words (shape.js ownWords) by its
 * chapter and how it opens — the book it reads has no passage numbers — a chapter all of his by its name */
function ownPassages(novel, chapters) {
  const out = [];
  for (const id of (novel && novel.order) || []) {
    const c = chapters[id];
    if (!c) continue;
    const ps = (c.passages || []).filter((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
    const mine = ps.filter((p) => ownWords(p));
    if (!mine.length) continue;
    const label = chapterLabel(novel, c, { withName: false });
    if (mine.length === ps.length) { out.push(`all of ${label}`); continue; }
    for (const p of mine) {
      const t = String(picked(p).text).replace(/\s+/g, ' ').trim();
      const words = t.split(' ');
      out.push(`the passage of ${label} that begins “${words.slice(0, 8).join(' ')}${words.length > 8 ? '…' : ''}”`);
    }
  }
  return out;
}
/* the threads the reading of the book's newest read passage opened: the check never closes one (a loose end closes only with what comes after it) */
function openedByNewest(novel, chapters) {
  const seen = (novel.memory && novel.memory.seen) || {};
  const order = novel.order || [];
  for (let i = order.length - 1; i >= 0; i--) {
    const ps = ((chapters[order[i]] || {}).passages) || [];
    for (let k = ps.length - 1; k >= 0; k--) {
      const sig = (seen[order[i]] || {})[ps[k].id];
      if (!sig) continue;
      const r = readingOf(novel, ps[k].id, sig);
      return new Set(((r && r.cards) || []).filter((c) => c.kind === 'threads' && !c.before && c.after).map((c) => c.id));
    }
  }
  return new Set();
}
/* Keep the inputs by value. A new passage, a different order or a manual
 * note correction invalidates a check just as a rewritten passage does. */
function auditStamp(novel, chapters) {
  return JSON.stringify([
    (novel.order || []).map((id) => {
      const c = chapters[id];
      return [id, c ? [c.name, c.summary, (c.passages || []).map((p) => {
        const v = picked(p); return [p.id, p.by, signature(v), Boolean(v && v.streaming)];
      })] : null];
    }),
    novel.notes, novel.brief, novel.style, novel.kept, novel.auto, novel.prefs,
    novel.meta && [novel.meta.title, novel.meta.subtitle, novel.meta.char],
  ]);
}
/* the shape of the check's answer: the notes' parts, or at least whether they are clear or its verdict — never an empty object */
export const auditShape = (o) => notesShape(o) && (truthOf(o.clear) !== undefined || Boolean(cleanText(o.verdict)) || [...NOTE_KINDS, 'gone', 'mine'].some((k) => Array.isArray(o[k]) && o[k].length));
async function auditNotes(novelId, conn) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  /* asked of notes that have no cards (any more): nothing to check, and never "checking" for good */
  if (novel.memory && novel.memory.auditAsked && !NOTE_KINDS.some((k) => ((novel.notes || {})[k] || []).length)) { store.change('novel', novelId, novelSteps.setMemory({ auditAsked: false })); return; }
  if (!auditDue(novel) || pendingWork(novelId)) return;
  const house = store.peek('house', 'house') || {};
  const chapters = chaptersOf(novel);
  setLight(novelId, 'reading', 'Checking the notes against the book…');
  const frame = helperFrame(house, novel);
  /* the notes outgrow its model: checked a group of cards at a time, in turn
   * (Cozy Tavern's M664) — the others named, so none is added twice */
  const a0 = (novel.memory && novel.memory.audit) || {};
  const every = NOTE_KINDS.flatMap((k) => ((novel.notes || {})[k] || []).map((c) => ({ kind: k, card: c })));
  /* the notes never take the room the book needs to be read beside them
   * (Cozy Tavern M752): a quarter of its model, at least, is the book's */
  const replyRoom = thinksOn(conn) ? Math.max(helperRoom(conn), thinkingFloor(conn)) : helperRoom(conn);
  const around0 = estimateTokens(frame) + estimateTokens(aboutTheBook(novel, { plans: false, kept: 'his' })) + 2000;
  /* HIS WORDS BESIDE THE NOTES ARE PART OF WHAT SURROUNDS THE BOOK (2.12.40, the audit: his premises, his entries, the
   * Timeline's turns and his other words to judge each took a fifth on top of the notes, and a chapter that rode whole
   * without them was told by its opening and close). What they need beside the whole notes — each at most its fifth —
   * is held back from the notes' room, half of what is left after the book's floor at most; and they are fitted to
   * what the book leaves (besideRoom). */
  const hisNow = hisWordsFolded(novel, chapters);
  const listCost = (ws) => estimateTokens(ws.map((w) => w.text).join('\n')) + 30 * ws.length;
  const wordsRoom = Math.max(0, Math.floor(readingRoom(conn, 0) / 5));
  const CAPS = { words: wordsRoom, premises: wordsRoom, entries: Math.floor(wordsRoom * 2 / 3), turns: Math.floor(wordsRoom / 3) };
  /* (worked out once for the check: what there is to judge, and the Timeline's turns) */
  const toJudge = hisNow ? wordsToJudge(novel, chapters) : [];
  let events = [];
  try { events = timelineOf(novel, chapters, {}).events; } catch (_) { events = []; }
  /* his words beside the notes for some cards (`cards`: {kind: [card]}), each fitted to its room: his other words to
   * judge (judge: with the round's first group — the entries give way first, then the chapters' plans), his premises
   * (those naming the cards first, then the newest), his entries for the cards — never one judged in this same check
   * (2.12.40, the audit: judged against the book and ruling the cards in one request, it was told both, and an answer
   * that did both left the entry and the card saying opposite things) — and the Timeline's newest turns for them */
  const besideFor = (rooms, { cards, judge }) => {
    let words = judge ? toJudge.slice() : [];
    while (words.length && listCost(words) > rooms.words) {
      const drop = [...words].reverse().find((w) => w.what === 'entry') || [...words].reverse().find((w) => w.what === 'plan') || words[words.length - 1];
      words = words.filter((w) => w !== drop);
    }
    const ids = new Set(NOTE_KINDS.flatMap((k) => ((cards && cards[k]) || []).map((c) => c.id)));
    const judged = new Set(words.filter((w) => w.what === 'entry').map((w) => w.id));
    /* (each premise and entry with the other of his written after it, said — 2.12.41: weigh, entriesWeighed) */
    const prem = premisesFitted(novel, chapters, rooms.premises, { cards, weigh: true });
    const ent = entriesFitted(entriesWeighed(novel, chapters, entriesForCards(novel, ids).filter((e) => !judged.has(e.id))), rooms.entries);
    const tl = turnsFitted(novel, chapters, ids, rooms.turns, events);
    const costs = { words: words.length ? listCost(words) : 0, premises: estimateTokens(premisesPart(prem.premises, prem.premisesLeft)), entries: estimateTokens(entriesPart(ent.entries, ent.entriesLeft)), turns: estimateTokens(timelinePart(tl.turns, tl.turnsLeft)) };
    return { words, prem, ent, tl, costs, cost: costs.words + costs.premises + costs.entries + costs.turns };
  };
  const floor = bookFloor(conn);
  const whole0 = besideFor(CAPS, { cards: novel.notes || {}, judge: Boolean(hisNow) });
  const avail = contextOf(conn) - replyRoom - 1500 - around0 - floor;
  const around = around0 + Math.min(whole0.cost, Math.floor(Math.max(0, avail) / 2));
  const budget = Math.min(Math.max(2000, Math.floor(contextOf(conn) * 0.4)), contextOf(conn) - replyRoom - 1500 - around - floor);
  let only = null;
  let others = [];
  let nextFrom = 0;
  /* A ROUND OF GROUPS IS ONE CHECK, MADE AS SOON AS IT CAN BE (Cozy Tavern
   * M752-017: the automatic audit starts as soon as it can). Notes too long
   * for its model are checked a group at a time, one group straight after
   * another — never a group now and the rest readings later — each card once
   * in the round (the cards it has checked are kept by name, so a card put
   * right or folded away moves no other out of its turn), and what the round
   * puts right, what it leaves and its Undo are gathered as one check. A
   * group that fails is passed by and waits, as any failure does; the round
   * goes on at the next check. */
  const gen0 = (novel.memory || {}).reread || 0;
  const seen0 = (a0.roundLeft || 0) > 0 && (a0.roundGen || 0) === gen0 && Array.isArray(a0.roundSeen) ? new Set(a0.roundSeen) : null;
  /* a check whose answer outgrew its room checks fewer cards at once from then on (Cozy Tavern M719) */
  const cap = Number.isFinite(a0.groupMax) && a0.groupMax > 0 ? a0.groupMax : Infinity;
  /* (whether this check begins a round: his other words are judged with the round's first group, wherever it starts — 2.12.18) */
  let roundBegins = true;
  /* THE CARDS OF AN ENTRY THE CHECK PUT RIGHT (2.12.41, the review: checked a group at a time, an entry put right in one
   * group never ruled its card, checked in that same group, and nothing was owed once the round was done): carried into
   * the next group, first — the round's, or the check owed when the round is done (`carry`) */
  const carried = new Set((Array.isArray(a0.carry) ? a0.carry : []).filter((id) => every.some((x) => x.card.id === id)));
  if ((estimateTokens(notesText(novel, { forHelper: true })) > budget || every.length > cap) && budget >= 800) {
    const start = Math.min(Math.max(0, a0.from || 0), Math.max(0, every.length - 1));
    /* the round goes on with the cards it has not checked yet; when none is left, a new round begins */
    const fresh = !seen0 || every.every((x) => seen0.has(x.card.id));
    roundBegins = fresh;
    only = new Set();
    for (const id of carried) {
      if (only.size >= cap) break;
      only.add(id);
      if (estimateTokens(notesText(novel, { forHelper: true, only })) > budget && only.size > 1) { only.delete(id); break; }
    }
    let last = -1;
    for (let i = 0; i < every.length && only.size < cap; i++) {
      const x = every[(start + i) % every.length];
      if (!fresh && seen0.has(x.card.id)) continue;
      only.add(x.card.id);
      if (estimateTokens(notesText(novel, { forHelper: true, only })) > budget && only.size > 1) { only.delete(x.card.id); break; }
      last = i;
    }
    nextFrom = (start + last + 1) % every.length;
    others = every.filter((x) => !only.has(x.card.id)).map((x) => x.card.name);
  }
  /* a group the check could not make is passed by: the next check goes on to the next group, and this one comes round again (Cozy Tavern M675-7) */
  const fromAfter = only ? nextFrom : (a0.from || 0);
  const roundOn = Boolean(only) && Boolean(seen0) && every.some((x) => !seen0.has(x.card.id));
  const roundId = roundOn && a0.roundId ? a0.roundId : newId('rd');
  const seenAfter = only ? [...(roundOn ? seen0 : []), ...only] : [];
  const roundLeft = only ? every.filter((x) => !seenAfter.includes(x.card.id)).length : 0;
  /* a check owed for the portraits (owedCheck) stays owed through this one while the bibliography is still being filled: a portrait asked before its details are there is refused, and the card would stay as it was */
  const owedKeep = a0.owed && bibReading(novel, conn) && bibDue(novelId).length ? { owed: a0.owed } : {};
  const roundKeep = only ? { roundId, roundAll: seenAfter.length + roundLeft, roundLeft, roundSeen: seenAfter, roundGen: gen0, roundFixed: roundOn ? a0.roundFixed || 0 : 0, roundChanges: roundOn ? a0.roundChanges || [] : [] } : {};
  const tooSmall = (why) => {
    /* never checked against no book: said, and not asked again until it is due */
    store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0, v: AUDIT_V, entries: entriesPrint(store.peek('novel', novelId) || novel), checked: true, failed: why, fixed: 0, changes: [], verdict: '', clear: true, from: fromAfter, ...roundKeep, ...(a0.groupMax ? { groupMax: a0.groupMax } : {}), ...owedKeep, ...(carried.size ? { carry: [...carried] } : {}) }, auditAsked: false }));
  };
  if (budget < 800) { tooSmall(tooSmallWhy(conn, novel, 'the notes')); return; }
  /* what it judges by name — his cards, the threads, his other words — counted in the room before the book is fitted to it (2.12.18) */
  const mineList = mineToJudge(novel, only);
  const judgeCost = 30 * mineList.length + (mineList.length ? 500 : 0);
  /* his words beside the notes for the cards checked, fitted to what the book leaves (besideRoom): each part at most its
   * fifth, and all of them made smaller alike, each to its share, when they cannot all have that */
  const checkedCards = Object.fromEntries(NOTE_KINDS.map((k) => [k, ((novel.notes || {})[k] || []).filter((c) => !only || only.has(c.id))]));
  const judge = Boolean(hisNow) && (!only || roundBegins);
  /* his own passages, said in the rule for his entries (ownPassages, 2.12.41): counted with what is fixed */
  const own = entriesForNotes(novel).length ? ownPassages(novel, chapters) : [];
  const fixed0 = around0 + estimateTokens(notesText(novel, { forHelper: true, only })) + estimateTokens(others.join(', ')) + judgeCost + (own.length ? estimateTokens(own.slice(0, 20).join('; ')) + 40 : 0);
  let side = only || judge !== Boolean(hisNow) ? besideFor(CAPS, { cards: checkedCards, judge }) : whole0;
  /* (the words that ask him to judge his other words, when there are any to judge: 400) */
  const allowed = side.cost > 0 ? besideRoom(conn, novel, chapters, fixed0 + (side.words.length ? 400 : 0)) : 0;
  if (side.cost > allowed) {
    const share = allowed / side.cost;
    side = besideFor(Object.fromEntries(Object.keys(CAPS).map((k) => [k, Math.floor(side.costs[k] * share)])), { cards: checkedCards, judge });
  }
  const { prem, ent, tl } = side;
  const wordsList = side.words;
  const fixed = fixed0 + side.cost + (wordsList.length ? 400 : 0);
  const room = readingRoom(conn, fixed);
  if (room < 600) { tooSmall(tooSmallWhy(conn, novel, 'the notes')); return; }
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room });
  const his = NOTE_KINDS.flatMap((k) => ((novel.notes || {})[k] || []).filter((c) => c.updated && c.updated.by === 'you' && (!only || only.has(c.id))).map((c) => hisLine(k, c))).filter(Boolean);
  const partial = Boolean(fit.book.omitted || fit.book.summaries.length);
  /* the chapters it reads only in short or not at all, and whether the end of the book is among them (Cozy Tavern M453/M403) */
  const order = novel.order || [];
  const shortIds = new Set([...order.slice(0, fit.book.omitted), ...fit.book.summaries.map((x) => x.id)]);
  /* a chapter told partly whole (context.js partlyWhole): only its part in short is unseen, and its end is read word for word */
  const wholeFrom = new Map(fit.book.summaries.filter((x) => x.wholeFrom).map((x) => [x.id, x.wholeFrom]));
  const unseen = partial ? foldedText(order.filter((id) => shortIds.has(id)).map((id) => chapterText(chapters[id] || { passages: [] }, { upto: wholeFrom.get(id) || null })).join('\n\n')) : null;
  let endId = '';
  for (const id of order) if (chapters[id] && chapterText(chapters[id]).trim()) endId = id;
  const endShort = Boolean(endId) && shortIds.has(endId) && !wholeFrom.has(endId);
  const endList = endId ? ((chapters[endId] || {}).passages || []).filter((p) => p.by !== 'break') : [];
  const endPid = endList.length ? endList[endList.length - 1].id : '';
  const gen = (novel.memory || {}).reread || 0;
  const askedNotes = clone(novel.notes || {});
  const askedWords = wordsNow(novel);
  const stamp = auditStamp(novel, chapters);
  const askedCodex = bibReading(novel, conn);
  const got = await helperJson(novelId, conn, frame, auditRequest({ novel: namedBook(novel, house), bookText: bookText(fit.book), his, partial, only, others, endShort, codex: askedCodex, mine: mineList, words: wordsList, ...prem, ...ent, ...tl, own: ent.entries.length ? own : [] }), { want: auditShape });
  /* the whole book began to be read again while it checked: the notes it checked are not there any more */
  const now = store.peek('novel', novelId);
  if (!now || ((now.memory || {}).reread || 0) !== gen || rebuildingNow(now)) return;
  await mustHold('helper', novelId);
  if (!got.ok) {
    /* let go on its leash: never the notes' fault — tried again later as it was; but a stall on them (heard, no progress for minutes) is theirs (M748): asked once more, then said, and not asked again until it is due */
    if (got.leashed && got.leashed !== 'long') throw failed(got);
    const fault = got.leashed === 'long' ? 'words' : await helperFault(novelId, conn, got);
    await mustHold('helper', novelId);
    if (fault !== 'words') throw failed(fault === 'model' ? passingFrom(got) : fault);
    /* its answer outgrew the room, asked again with more: half as many cards at once, asked again now — never the same whole for ever (Cozy Tavern M719) */
    const size = only ? only.size : every.length;
    if (got.cut && size > 1) {
      stuck.delete('audit:' + novelId);
      store.change('novel', novelId, novelSteps.setMemory({ audit: { ...a0, groupMax: Math.max(1, Math.floor(size / 2)) }, auditAsked: true }));
      nudge(novelId, 1500);
      return;
    }
    const n = (stuck.get('audit:' + novelId) || 0) + 1;
    stuck.set('audit:' + novelId, n);
    if (n < 2) throw failed({ error: got.error });
    stuck.delete('audit:' + novelId);
    /* its model would not check the notes: said so, and not asked again until it is due */
    store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0, v: AUDIT_V, entries: entriesPrint(store.peek('novel', novelId) || novel), checked: true, failed: cutWords(got.error || 'its model would not check them', 300), fixed: 0, changes: [], verdict: '', clear: true, from: fromAfter, ...roundKeep, ...(a0.groupMax ? { groupMax: a0.groupMax } : {}), ...owedKeep, ...(carried.size ? { carry: [...carried] } : {}) }, auditAsked: false }));
    return;
  }
  stuck.delete('audit:' + novelId);
  const latest = store.peek('novel', novelId);
  if (!latest) return;
  /* the book changed under it — a version it read written again, picked or
   * taken out: its answer belongs to a book no longer there, and it checks
   * again once that is read (Cozy Tavern M709/M716) */
  const live = chaptersOf(latest);
  if (auditStamp(latest, live) !== stamp) {
    store.change('novel', novelId, novelSteps.setMemory({ auditAsked: true }));
    nudge(novelId, 2000);
    return;
  }
  /* his own cards are never taken out, nor his words changed; nor a card
   * still in the book (foldNotes) */
  const folded = foldNotes(latest.notes, got.obj, {
    chapterId: '', at: Date.now(), audit: true, limit: only,
    stands: hasGone(got.obj) ? standsFolded(latest) : null,
    hisWords: claimsContradiction(got.obj) ? hisWordsFolded(latest, live) : null,
    mine: mineList.length ? { ids: new Set(mineList.map((x) => x.id)), ...(Array.isArray(got.obj && got.obj.mine) && got.obj.mine.length ? mineBook(latest) : { book: null }) } : null,
    grounds: groundsOf(namedBook(latest, store.peek('house', 'house') || {})),
    asked: askedNotes, keepOpen: openedByNewest(latest, live), unseen, keptElsewhere: askedCodex ? factsByCard(novelId) : null,
    /* where people are "now" is the end of the book's: when it read the end only in short, it only fills one never written */
    nowStays: endShort, nowAt: endId, nowPid: endPid,
  });
  const label = 'the notes checked against the book';
  /* what it keeps of the book, put right where it drifted — whole, never one line (S10-G1) */
  const kept = only ? {} : auditKept(latest, got.obj, askedWords);
  const judged = judgeWords(novelId, wordsList, got.obj);
  const changed = [...changedOf(folded.cards).map((c, i) => (folded.whys[folded.cards[i].id] ? { ...c, why: folded.whys[folded.cards[i].id] } : c)), ...keptChangedOf(kept),
    ...judged.changes.map((w) => ({ kind: 'book', name: w.label, how: 'changed', why: w.why }))];
  if (folded.cards.length || Object.keys(kept).length || judged.changes.length) {
    if (folded.cards.length) store.change('novel', novelId, novelSteps.applyCards(folded.cards));
    for (const [key, k] of Object.entries(kept)) keepIfUnchanged(novelId, key, k.before, k.after);
    /* a group of a round: one Undo, and one lighting, for every group of it so far (nothing read in between) */
    const u0 = (latest.memory || {}).undo;
    const joined = Boolean(only) && Boolean(u0) && u0.round === roundId && Array.isArray(u0.cards);
    const cardsAll = joined ? [...u0.cards, ...folded.cards] : folded.cards;
    const changedAll = (joined ? [...(u0.changed || []), ...changed] : changed).slice(0, 200);
    const wordsAll = [...(joined && Array.isArray(u0.words) ? u0.words : []), ...judged.changes];
    /* (what its judgment changed, by key: its Undo takes them as held, so the next check does not change them again, 2.12.18) */
    const judgedKeys = [...(joined && Array.isArray(u0.judged) ? u0.judged : []), ...[...folded.mineSaid].filter(([, said]) => said === 'changed' || said === 'gone').map(([k]) => k), ...[...judged.said].filter(([, said]) => said === 'changed').map(([k]) => k)];
    store.change('novel', novelId, novelSteps.setMemory({ undo: { at: Date.now(), label, keep: false, cards: cardsAll, kept, changed: changedAll, ...(wordsAll.length ? { words: wordsAll } : {}), ...(judgedKeys.length ? { judged: judgedKeys } : {}), ...(only ? { round: roundId } : {}) }, lit: { at: Date.now(), label, changed: changedAll } }));
  }
  /* what it found, for him to read: whether anything is left for him, in its
   * words — never "clear" while a change it gave did not hold (Cozy Tavern
   * M259-6) */
  const verdict = cleanText(got.obj && got.obj.verdict, 800);
  const refused = folded.refused.slice(0, 40);
  const clear = truthOf(got.obj && got.obj.clear) === true && !folded.refused.length;
  /* checked a group at a time: what the earlier groups of this round left open stays said through the round */
  const round = roundOn && a0.round ? a0.round : [];
  const nextRound = only ? [...round, ...(clear ? [] : [{ at: Date.now(), verdict, refused }])].slice(-6) : [];
  const fixedNow = folded.cards.length + Object.keys(kept).length;
  /* AN ENTRY THE CHECK PUT RIGHT RULES ITS CARD AT THE NEXT CHECK (2.12.40, the audit): judged here, it did not rule the
   * cards in this check (besideFor); put right under a card of the notes, the notes owe a check against it — at once —
   * and it is held as the check left it (its words are what the book has now), so that check holds the card to it
   * instead of judging it again. Through 2.12.39 the print was taken after the entry changed: nothing was owed, and the
   * card said the opposite of the entry until the sixth reading. */
  const afterAll = store.peek('novel', novelId) || latest;
  const joinsNow = entryJoins(entriesOf(afterAll), afterAll.notes || {});
  const ruled = new Map(judged.changes.filter((w) => w.what === 'entry' && w.after && joinsNow.get(w.id)).map((w) => [w.key, hashText([String(w.after.text || '').trim(), hisPrint(afterAll)].join('\n'))]));
  /* what it said of each card of his it was asked to judge: held is not asked again until its Since then changes; put right or gone, nothing to keep; not answered, counted */
  const mineNow = { ...((store.peek('novel', novelId).memory || {}).mine || {}) };
  const judgedOf = [...mineList.map((x) => ({ key: x.id, h: x.h, said: folded.mineSaid.get(x.id) })), ...wordsList.map((x) => ({ key: x.key, h: x.h, said: judged.said.get(x.key) }))];
  for (const x of judgedOf) {
    if (x.said === 'changed' && ruled.has(x.key)) mineNow[x.key] = { h: ruled.get(x.key), held: true };
    else if (x.said === 'changed' || x.said === 'gone') delete mineNow[x.key];
    else if (x.said === 'held') mineNow[x.key] = { h: x.h, held: true };
    else mineNow[x.key] = { h: x.h, n: ((mineNow[x.key] && mineNow[x.key].h === x.h ? mineNow[x.key].n : 0) || 0) + 1 };
  }
  if (judgedOf.length) store.change('novel', novelId, novelSteps.setMemory({ mine: mineNow }));
  /* (the cards of the entries put right here, and those carried here and not checked in it: carried on, first in the next
   * group — of the round, or of the check owed for them: never the entry and its card left saying opposite things with
   * nothing owed — 2.12.41, the review) */
  const ruledCards = judged.changes.filter((w) => w.what === 'entry' && w.after && joinsNow.get(w.id)).map((w) => joinsNow.get(w.id).id);
  const carryNext = [...new Set([...[...carried].filter((id) => only && !only.has(id)), ...ruledCards])];
  store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0, v: AUDIT_V, entries: entriesPrint(store.peek('novel', novelId) || novel), checked: true, fixed: fixedNow, changes: changed.slice(0, 200), verdict, clear, partial, refused, refusedAll: folded.refused.length,
    ...(only ? { from: nextFrom, some: { checked: only.size, all: every.length }, round: nextRound, earlier: round, ...roundKeep, roundFixed: roundKeep.roundFixed + fixedNow, roundChanges: [...roundKeep.roundChanges, ...changed].slice(0, 200) } : {}), ...(a0.groupMax ? { groupMax: a0.groupMax } : {}), ...owedKeep, ...(carryNext.length ? { carry: carryNext } : {}) },
    /* the next group of the round, as soon as the helper is free — and a check at once for an entry put right under a card */
    auditAsked: roundLeft > 0 || carryNext.length > 0 }));
  await store.flush('novel', novelId);
}

/* "Write it from the book again": his correction goes, and the helper writes
 * it afresh from the book. */
export function keepAgain(novelId, key, { keepWords = true } = {}) {
  const n = store.peek('novel', novelId);
  const k = n && n.kept && n.kept[key];
  /* the words that stand stay in use until the new ones land — never left
   * with none when the helper cannot write it (S04-G4); emptied by him, none */
  const text = keepWords && k ? String(k.text || '').trim() : '';
  store.change('novel', novelId, novelSteps.setKept(key, { text, at: (k && k.at) || Date.now(), again: true }), { now: true });
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, 300);
}

/* --------------------------------------------------------- his controls */

/* Put back what the helper's last reading changed — only that: a card he
 * edited since stays as he left it, and one he took out stays out. */
export function undoLast(novelId) {
  const novel = store.peek('novel', novelId);
  const u = novel && novel.memory && novel.memory.undo;
  if (!u) return false;
  if (Array.isArray(u.cards)) store.change('novel', novelId, novelSteps.undoCards(u.cards), { now: true });
  else if (u.notes) store.change('novel', novelId, novelSteps.setNotes(clone(u.notes)), { now: true });
  /* his other words the check put right, put back where they still read as it left them */
  if (Array.isArray(u.words)) wordsBack(novelId, u.words);
  /* what its judgment changed and he undid: held as it is now, never changed again by the next check unless it changes (2.12.18) */
  if (Array.isArray(u.judged) && u.judged.length) {
    const n1 = store.peek('novel', novelId);
    const hold = new Map([...mineToJudge(n1).map((x) => [x.id, x.h]), ...wordsToJudge(n1, chaptersOf(n1)).map((x) => [x.key, x.h])]);
    const mineNow = { ...((n1.memory || {}).mine || {}) };
    for (const k of u.judged) if (hold.has(k)) mineNow[k] = { h: hold.get(k), held: true };
    store.change('novel', novelId, novelSteps.setMemory({ mine: mineNow }), { now: true });
  }
  /* what it keeps of the book goes back too — unless he corrected it since */
  for (const [key, k] of Object.entries(u.kept || {})) {
    const cur = (novel.kept && novel.kept[key]) || null;
    if (JSON.stringify(cur) === JSON.stringify(k.after || null)) store.change('novel', novelId, novelSteps.setKept(key, k.before || null), { now: true });
  }
  /* Read the whole book again, undone (while it reads, or after): stopped, and
   * what was read put back as it was */
  const back = u.seen ? { seen: u.seen, readings: u.readings || {}, removed: u.removed || [], reread: 0, rereadFrom: null, ...(u.aside ? { aside: u.aside } : {}) } : {};
  store.change('novel', novelId, novelSteps.setMemory({ undo: null, lit: null, ...back }), { now: true });
  if (u.seen) { narrow.delete(novelId); tellLight(novelId); }
  return true;
}

/* Read the whole book again from the start: the notes are rebuilt. Undo puts
 * back the ones there before (the whole re-reading counts as one reading).
 * Cozy Tavern's M262: built beside the notes, never instead of them — the
 * writer, the partner, the scenes and the checker go on with the notes, the
 * Automatic texts and the summaries as they stood (prompts.js standingNotes)
 * until it is done, and they are swapped in whole. Pressed again while it
 * reads, it starts again, its way back still the notes before the first
 * press; Undo while it reads stops it and puts everything back. His own cards
 * and his own summaries stay as he left them. */
export function readAgain(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const m = novel.memory || {};
  const going = rebuildingNow(novel);
  /* the helper's cards go, to be written afresh; his own stay as he left them
   * (the reading moves only where they are now and how they stand) */
  const cards = [];
  const keep = {};
  for (const kind of NOTE_KINDS) {
    keep[kind] = [];
    for (const c of (novel.notes && novel.notes[kind]) || []) {
      if (his(c)) keep[kind].push(clone(c));
      else cards.push({ kind, id: c.id, before: clone(c), after: null });
    }
  }
  /* what it keeps of the book (Automatic) is written afresh too — never his correction */
  const kept = {};
  for (const key of keptByHelper(novel)) if (novel.kept && novel.kept[key]) kept[key] = { before: clone(novel.kept[key]), after: null };
  const at = Date.now();
  if (!going) {
    store.change('novel', novelId, novelSteps.setMemory({
      undo: { at, label: 'the whole book', keep: true, cards, kept, changed: [], seen: clone(m.seen || {}), readings: clone(m.readings || {}), removed: clone(m.removed || []), aside: clone(m.aside || {}) },
      rereadFrom: { at, notes: clone(novel.notes || {}), kept: clone(novel.kept || {}) },
    }), { now: true });
  }
  /* read from the start, the summaries written afresh (each older than now is due again — his stay), the notes' check not due till it is done */
  /* everything read afresh — what was set aside too */
  store.change('novel', novelId, novelSteps.setMemory({ seen: {}, removed: [], readings: {}, lit: null, reread: at, inParts: null, aside: {}, audit: { ...(m.audit || {}), reads: 0 } }), { now: true });
  store.change('novel', novelId, novelSteps.setNotes(keep), { now: true });
  for (const key of keptByHelper(novel)) if (novel.kept && novel.kept[key]) store.change('novel', novelId, novelSteps.setKept(key, null), { now: true });
  failures.delete(novelId);
  blocked.delete(novelId);
  narrow.delete(novelId);
  nudge(novelId, 500);
}
function rebuildingNow(novel) { const m = (novel && novel.memory) || {}; return Boolean(m.undo && m.undo.keep && m.rereadFrom); }
export function rereading(novelId) { return rebuildingNow(store.peek('novel', novelId)); }

/* a whole re-reading finished: what it built is the notes from now on, and
 * its undo record one reading */
function finishReread(novelId) {
  const novel = store.peek('novel', novelId);
  const u = novel && novel.memory && novel.memory.undo;
  /* notes written afresh hold again what the checks had folded: one is owed at once (D-G12) */
  if (u && u.keep) store.change('novel', novelId, novelSteps.setMemory({ undo: { ...u, keep: false }, rereadFrom: null, auditAsked: true }));
  else if (novel && novel.memory && novel.memory.rereadFrom) store.change('novel', novelId, novelSteps.setMemory({ rereadFrom: null }));
}

export function forTests() { return { lights, failures, blocked, timers, narrow, stuck, running: runningFor }; }
