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
import { connFor, busy as writerBusy, setNotesWait } from './writer.js';
import { parseFirstObject } from './jsonutil.js';
import { hashText, countWords, nameKey, newId, clone, estimateTokens, truthOf } from '../util.js';
import { picked, chapterLabel, chapterText, chapterPrint, chapterWords, chapterSteps, novelSteps, passageNumbers, NOTE_KINDS, matchCard, cardsCalled, cardStands, carriedBy } from './shape.js';
import { foldedText } from './names.js';
import { helperFrame, notesRequest, summaryRequest, keepRequest, keptByHelper, bookText, JSON_AGAIN, JSON_CUT, notesText, aboutTheBook, auditRequest } from './prompts.js';
import { fitBook } from './context.js';
import { readingOf, planOf, moved, changedBy, newestRead, unread } from './readings.js';

const lights = new Map();          /* novelId -> {state, words, at} */
const timers = new Map();
const runningFor = new Set();
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
setNotesWait(async (novelId, ms, signal) => {
  const until = Date.now() + ms;
  while (readingNow.has(novelId) && Date.now() < until && !(signal && signal.aborted)) await new Promise((r) => setTimeout(r, 150));
});
export function lightOf(novelId) {
  /* no helper chosen is said whatever was last seen */
  if (!connFor(store.peek('house', 'house') || {}, 'helper')) return { state: 'off', words: 'No helper is chosen, so the notes are not being kept. Choose one in Settings → Connections (it can be the same as the writer).' };
  const l = lights.get(novelId);
  /* reading, waiting after a failure, or turned away: said as it is */
  if (l && (l.state === 'reading' || l.state === 'waiting' || l.state === 'trouble')) return l;
  /* green only when nothing is left unread */
  const novel = store.peek('novel', novelId);
  if (pendingWork(novelId)) return { state: 'waiting', words: rebuildingNow(novel) ? 'Reading the whole book again — until it is done, the writer and the rest go on with the notes as they were.' : 'The helper reads the newest words in a moment.' };
  const aside = Object.keys((novel && novel.memory && novel.memory.aside) || {}).length;
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

function retryLater(novelId) {
  const n = ((failures.get(novelId) || {}).n || 0) + 1;
  const ms = [60000, 180000, 600000][Math.min(n - 1, 2)];
  failures.set(novelId, { n, until: Date.now() + ms });
  nudge(novelId, ms);
  return n;
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
  const [vid] = sig.split(SIG_SEP);
  if (versionId && versionId !== vid) return;
  const v = p.versions.find((x) => x.id === vid);
  if (!v || !String(v.text || '').trim()) return;
  /* a whole passage going keeps where it stood (the passage before it), so
   * the helper can tell whether anything it read came after it */
  const i = chapter.passages.indexOf(p);
  const where = versionId ? {} : { after: i > 0 ? chapter.passages[i - 1].id : '^' };
  store.change('chapter', chapterId, chapterSteps.retire({ key: versionId ? passageId + SIG_SEP + vid : passageId, text: v.text, at: Date.now(), ...where }));
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
      for (const [vid, r] of Object.entries(all[p.id] || {})) {
        if (!r || r.in || !Array.isArray(r.cards)) continue;
        const v = (p.versions || []).find((x) => x.id === vid);
        if (!v) continue;
        const shown = (picked(p) || {}).id === vid;
        const live = (seen[id] || {})[p.id] === r.sig;
        rows.push({ pid: p.id, vid, chapterId: id, at: r.at || 0, label: r.label || passageLabel(novel, c, p.id), mode: r.mode, shown, live,
          changed: changedOf(r.cards || []).concat(keptChangedOf(r.kept || {})) });
      }
    }
  }
  return rows.sort((a, b) => b.at - a.at);
}

/* Put back what one reading changed — card by card, only where the card
 * still reads as it left it (his edits, and later readings, stay); read
 * again: and the passage is read afresh from there. */
export function putBackReading(novelId, pid, vid, { readAgain: again = false } = {}) {
  const novel = store.peek('novel', novelId);
  const all = (novel && novel.memory && novel.memory.readings) || {};
  const r = all[pid] && all[pid][vid];
  if (!r || r.in) return false;
  const plan = planOf({ notes: novel.notes || {}, kept: novel.kept || {} }, r, { back: true });
  if (plan.moves.length) store.change('novel', novelId, novelSteps.moveCards(plan.moves), { now: true });
  if (plan.kept.length) store.change('novel', novelId, novelSteps.moveKept(plan.kept), { now: true });
  /* the reading is no longer what the notes hold: it goes, and with it the
   * readings of the passages read together with it */
  const covers = r.covers && r.covers.length ? r.covers : [pid];
  const drop = [[pid, vid]];
  for (const other of covers) if (other !== pid) for (const [ov, x] of Object.entries(all[other] || {})) if (x && x.in && x.in.pid === pid && x.in.vid === vid) drop.push([other, ov]);
  store.change('novel', novelId, novelSteps.dropReadings(drop), { now: true });
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
  if (runningFor.has(novelId)) return 0;
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
const NOTHING = /^(?:none|n\/?a|nil|null|undefined|nothing(?:\s+(?:new|yet|more|changed|to add))?|unknown|unchanged|no changes?|same(?:\s+as\s+before)?|not\s+(?:given|stated|known|mentioned|yet)|[-—–?.…\s]+)[.!]?$/i;
const SORRY = /^(?:i['’]?m\s+(?:sorry|afraid|unable|not able)|i\s+am\s+(?:sorry|afraid|unable|not able)|sorry[,.]|i\s+(?:can(?:['’]?t|not)|won['’]?t|will\s+not|must\s+decline|apologi[sz]e)\b|unfortunately,?\s+i\b|as\s+an\s+ai\b)/i;
function wordsOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))).map((x) => String(x).trim()).filter(Boolean).join('\n');
  return typeof v === 'string' ? v : '';
}
export function cleanText(v, max = 12000) {
  let t = wordsOf(v).replace(/\r/g, '').trim();
  if (!t || NOTHING.test(t) || SORRY.test(t)) return '';
  if (t.length > max) {
    const room = t.slice(0, max - 1);
    const at = Math.max(room.lastIndexOf('. '), room.lastIndexOf('.\n'), room.lastIndexOf('; '));
    t = (at > max / 2 ? room.slice(0, at + 1) : room.trimEnd()) + '…';
  }
  return t;
}
export function cleanName(v) {
  const t = wordsOf(v).replace(/\s+/g, ' ').trim().slice(0, 120);
  return t && !NOTHING.test(t) && !SORRY.test(t) ? t : '';
}
const his = (card) => Boolean(card && card.updated && card.updated.by === 'you');

/* Who someone is, is added to — never thinned by a reading (Cozy Tavern's
 * M648): a new "about" that keeps less than three-fifths of the telling words
 * of the one that stands and says less than it is not written. The auditor,
 * which folds repeats and puts drift right, is not held to it. */
export function thins(standing, offered) {
  const old = String(standing || '').trim();
  const neu = String(offered || '').trim();
  if (!old || !neu) return false;
  const telling = (t) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length >= 4));
  const was = telling(old);
  if (!was.size) return false;
  const now = telling(neu);
  let kept = 0;
  for (const w of was) if (now.has(w)) kept += 1;
  return kept / was.size < 0.6 && neu.length < old.length;
}

/* Fold the helper's answer into the notes. Pure: returns the new notes and,
 * for each card it touched, the card before and after (so the reading can be
 * put back exactly), with the reason it gave for each (`whys`, by card id),
 * and the rows it set aside (`aside`: a name two cards answer to).
 * A name means the card called that before one that also goes by it
 * (matchCard). His own names, casing and words are kept, and a card he wrote
 * or changed is never taken out; nor is one the same answer gives whole, nor
 * — with `stands` (the book's words, folded) — a person or a place whose name
 * still stands in the book, unless another card now carries that name (the
 * card it was folded into). */
export function foldNotes(notes, answer, { chapterId = '', at = Date.now(), audit = false, stands = null, limit = null } = {}) {
  const out = clone(notes || {});
  for (const k of NOTE_KINDS) if (!Array.isArray(out[k])) out[k] = [];
  const touched = new Map();       /* card id -> {kind, before} */
  const whys = {};
  const aside = [];
  const written = new Set();       /* the cards this answer gives */
  const why = (id, row) => { const w = cleanText(row && row.why).slice(0, 400); if (w) whys[id] = w; };
  const touch = (kind, card) => { if (!touched.has(card.id)) touched.set(card.id, { kind, before: clone(card) }); };
  const uniq = (list, main) => list.filter((a, i) => list.findIndex((b) => nameKey(b) === nameKey(a)) === i && nameKey(a) !== nameKey(main));
  for (const kind of NOTE_KINDS) {
    const rows = Array.isArray(answer && answer[kind]) ? answer[kind] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const name = cleanName(row.name);
      if (!name) continue;
      const aka = (Array.isArray(row.aka) ? row.aka : typeof row.aka === 'string' ? row.aka.split(',') : []).map(cleanName).filter((a) => a && nameKey(a) !== nameKey(name));
      const about = cleanText(row.about);
      const open = truthOf(row.open);
      const m = matchCard(out[kind], name, aka, { kind });
      if (m.ambiguous) { aside.push({ kind, name }); continue; }
      /* a check of some cards only: the others are not its to change */
      if (limit && m.card && !limit.has(m.card.id)) { aside.push({ kind, name }); continue; }
      const card = m.card;
      if (card) {
        written.add(card.id);
        const was = JSON.stringify(card);
        const before = clone(card);
        if (nameKey(card.name) !== nameKey(name) && kind === 'people') {
          /* a name the story now goes by — told as the main name, the old one
           * among the others — unless he named the card himself */
          if (!his(card) && aka.some((a) => nameKey(a) === nameKey(card.name))) {
            const old = card.name;
            card.name = name;
            card.aka = [...(card.aka || []), old];
          } else if (!(card.aka || []).some((a) => nameKey(a) === nameKey(name))) card.aka = [...(card.aka || []), name];
        }
        /* what he wrote about it himself stands; the helper keeps the rest —
         * added to, never thinned by a reading */
        if (about && !his(card) && (audit || !thins(card.about, about))) card.about = about;
        if (kind === 'people') {
          const nowText = cleanText(row.now);
          if (nowText) card.now = nowText;
          /* how they stand with the others moves with the story, on his cards too */
          const ties = cleanText(row.ties);
          if (ties) card.ties = ties;
        }
        /* the other names it goes by, on any card (a card folded into another keeps its names) */
        if (aka.length || (card.aka && card.aka.length)) card.aka = uniq([...(card.aka || []), ...aka], card.name);
        if (kind === 'threads' && open !== undefined) card.open = open;
        if (JSON.stringify(card) !== was) {
          if (!touched.has(card.id)) touched.set(card.id, { kind, before });
          /* a card he wrote stays his: the helper keeps where they are now, never his words */
          card.updated = his(before) ? { by: 'you', chapterId, at } : { chapterId, at };
          why(card.id, row);
        }
      } else {
        const fresh = { id: newId(kind.slice(0, 2)), name, about, updated: { chapterId, at } };
        if (kind === 'people') { fresh.aka = aka; fresh.ties = cleanText(row.ties); fresh.now = cleanText(row.now); }
        else if (aka.length) fresh.aka = aka;
        if (kind === 'threads') fresh.open = open !== false;
        out[kind].push(fresh);
        written.add(fresh.id);
        touched.set(fresh.id, { kind, before: null });
        why(fresh.id, row);
      }
    }
  }
  const gone = Array.isArray(answer && answer.gone) ? answer.gone : [];
  for (const g of gone) {
    if (!g || typeof g !== 'object' || !NOTE_KINDS.includes(g.kind)) continue;
    /* only a card called that — never one that merely also goes by it (the
     * card it was folded into), never his own, never one just given whole,
     * never one still in the book unless another card carries its name */
    const drop = cardsCalled(out[g.kind], cleanName(g.name))
      .filter((c) => !his(c) && !written.has(c.id) && (!limit || limit.has(c.id)))
      .filter((c) => !(stands && cardStands(g.kind, c, stands) && !carriedBy(g.kind, c, out[g.kind])));
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
  return { notes: out, cards, changed, whys, aside };
}

/* The book's words as they stand, folded once, for asking whether a card's
 * name still stands in it (foldNotes' `stands`) */
export function bookFolded(novel) {
  const chapters = chaptersOf(novel);
  return foldedText((novel.order || []).map((id) => chapterText(chapters[id] || { passages: [] })).join('\n\n'));
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

/* The shape of a notes answer: an object of the notes' parts — never one row
 * of them, which is what the first whole object of an answer cut off is
 * (Cozy Tavern's M246/M682: a cut answer stored as a finished reading) */
export const notesShape = (o) => !('name' in o) && !('kind' in o) && !('passage' in o);
const hasGone = (o) => Boolean(o && Array.isArray(o.gone) && o.gone.length);

export async function askJson(conn, system, request, { want } = {}) {
  const room = helperRoom(conn);
  const first = await ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: request }], maxTokens: room }), stream: true, worker: true, patient: true });
  if (!first.ok) return { ok: false, error: first.error, permanent: first.permanent, status: first.status };
  let obj = parseFirstObject(first.text, want);
  if (obj) return { ok: true, obj };
  /* once more, told what went wrong — given more room when it ran out of it; never more than that */
  const cut = Boolean(first.cut);
  const more = cut ? Math.min(room * 2, Math.floor(contextOf(conn) * 0.6)) : room;
  const second = await ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: request }, { role: 'assistant', content: String(first.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: cut ? JSON_CUT : JSON_AGAIN }], maxTokens: more }), stream: true, worker: true, patient: true });
  if (!second.ok) return { ok: false, error: second.error, permanent: second.permanent, status: second.status };
  obj = parseFirstObject(second.text, want);
  if (obj) return { ok: true, obj };
  return { ok: false, error: unreadWhy(second), unreadable: true };
}
/* why an answer could not be used, in plain words: the provider's reason for
 * an empty one (Cozy Tavern's M545), or how it began */
function unreadWhy(out) {
  const t = String((out && out.text) || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/\s+/g, ' ').trim();
  if (!t) return emptyWhy(out, out && out.thinking);
  return `its answer could not be read (it began: “${t.slice(0, 90)}${t.length > 90 ? '…' : ''}”)`;
}

/* Is the helper's model there at all? A small harmless ask — when a reading
 * fails, it tells the passage's fault from the model's (Cozy Tavern's M316). */
export async function probe(conn) {
  /* asked once, never waited out: a model that does not answer it now is down, and waited out as ever */
  const out = await ask(conn, { build: () => ({ system: 'Answer with JSON only.', messages: [{ role: 'user', content: 'Answer with {"ok": true} and nothing else.' }], maxTokens: helperRoom(conn) }), stream: true, worker: true });
  if (!out.ok) return { ok: false, error: out.error, permanent: out.permanent, status: out.status };
  return parseFirstObject(out.text) ? { ok: true } : { ok: false, error: unreadWhy(out), unreadable: true };
}

/* split a long text into parts of about `words` words, at paragraph ends */
export function partsOf(text, words = 9000) {
  const paras = String(text || '').split(/\n+/);
  const out = [];
  let cur = [];
  let n = 0;
  for (const p of paras) {
    const w = countWords(p);
    if (n + w > words && cur.length) { out.push(cur.join('\n\n')); cur = []; n = 0; }
    cur.push(p);
    n += w;
  }
  if (cur.length) out.push(cur.join('\n\n'));
  return out.filter((x) => x.trim());
}

/* which connection the helper uses, as a fingerprint: a refusal for good is
 * not asked again until it changes */
export function connPrint(conn) {
  const L = (conn && conn.learned) || {};
  return conn ? hashText(JSON.stringify([conn.url, conn.model, conn.key, conn.shape, conn.maxTokens, conn.context, conn.thinking, L.context, L.maxOut, L.drop, L.completionField])) : '';
}

/* ----------------------------------------------------------- the reading */

export async function run(novelId) {
  if (runningFor.has(novelId)) { nudge(novelId, 5000); return; }
  if (writerBusy(novelId)) { nudge(novelId, 4000); return; }
  const house = store.peek('house', 'house') || {};
  const conn = connFor(house, 'helper');
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  if (!conn) { setLight(novelId, 'off', 'No helper is chosen, so the notes are not being kept. Choose one in Settings → Connections (it can be the same as the writer).'); return; }
  /* refused for good (a key, an address, a model): not asked again until the connection changes */
  if (blocked.has(novelId) && blocked.get(novelId) === connPrint(conn)) return;
  blocked.delete(novelId);
  const work = async () => {
    runningFor.add(novelId);
    try {
      await readChanges(novelId, conn);
      await summarise(novelId, conn);
      await keepTheBook(novelId, conn);
      await auditNotes(novelId, conn);
      failures.delete(novelId);
      const left = pendingWork(novelId);
      if (left) nudge(novelId, 2000);
      else {
        finishReread(novelId);
        setLight(novelId, 'idle', 'The notes are up to date.');
      }
    } catch (e) {
      const why = (e && e.message) || String(e);
      /* a reading its model would not answer: read again at once, one passage at a time */
      if (e && e.soon) {
        setLight(novelId, 'reading', `The helper reads one passage at a time now (${why}).`);
        nudge(novelId, 1500);
        return;
      }
      if (e && e.permanent) {
        blocked.set(novelId, connPrint(conn));
        failures.delete(novelId);
        setLight(novelId, 'trouble', `The helper’s connection was turned away (${why}). It reads again once the connection is put right in Settings → Connections.`);
        return;
      }
      const n = retryLater(novelId);
      setLight(novelId, n >= 3 ? 'trouble' : 'waiting', `The helper couldn’t finish just now (${why}). It tries again by itself in ${n >= 3 ? 'ten minutes' : n === 2 ? 'three minutes' : 'a minute'}.`);
    } finally {
      runningFor.delete(novelId);
    }
  };
  /* one window reads a book at a time */
  if (globalThis.navigator && navigator.locks && navigator.locks.request) {
    await navigator.locks.request(`cozynovel-helper-${novelId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { nudge(novelId, 20000); return; }
      await work();
    });
  } else {
    await work();
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
    if (!c) continue;
    const ch = changesIn(novel, c);
    if (ch.changes.length || ch.removed.length) return true;
  }
  return false;
}

function failed(got) {
  const e = new Error(got.error || 'the helper got no answer');
  e.permanent = Boolean(got.permanent);
  return e;
}

/* A failed ask: the words' fault (its model answers a harmless ask, but not
 * this one), the model's ('model': it is down, waited out as ever), or the
 * probe's own failure (a connection refused for good stays refused). A
 * passing fault is never probed: it is waited out. */
async function whoseFault(conn, got) {
  const passing = !got.unreadable && !got.permanent;
  if (passing) return 'model';
  /* the key, the account, the model's address: the connection's, never asked again to find out */
  if (got.permanent && ([401, 402, 404, 405].includes(got.status) || /the key was refused|out of credit|was not found/.test(String(got.error || '')))) return got;
  const alive = await probe(conn);
  if (alive.ok) return 'words';
  return alive.permanent ? alive : 'model';
}
/* what one ask held, for counting its failed runs */
function askedKey(B) {
  return [...B.items.map((c) => c.sig + (c.partial || c.whole !== undefined ? ':' + hashText(c.text) : '')), ...B.removed.map((r) => 'out:' + (r.key || r.pid)), ...B.chapters.map((r) => 'chapter:' + r.id + ':' + hashText(r.text))].join('|');
}
/* a chapter taken out whole is done with once its last part is read (or set aside) */
function clearOut(novelId, B) {
  const ids = B.chapters.filter((p) => p.last).map((p) => p.id);
  if (ids.length) store.change('novel', novelId, novelSteps.clearRemoved(ids));
}
/* Set aside: marked read with nothing taken from it, and kept on the book
 * with why — so he sees it in the notes and can have it read again. */
function setAside(novelId, chapter, B, why) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const said = String(why || '').slice(0, 300);
  const entries = {};
  if (chapter && (B.items.length || B.removed.length)) {
    const map = { ...((novel.memory || {}).seen || {})[chapter.id] };
    for (const c of B.items.filter((x) => !x.partial)) map[c.pid] = c.sig;
    for (const r of B.removed) delete map[r.pid];
    store.change('novel', novelId, novelSteps.seen(chapter.id, map));
    const keys = B.removed.filter((r) => r.key).map((r) => r.key);
    if (keys.length) store.change('chapter', chapter.id, chapterSteps.clearRetired(keys));
    const label = readLabel(novel, chapter, B.items) || chapterLabel(novel, chapter);
    for (const c of B.items) entries[c.pid] = { chapterId: chapter.id, sig: c.sig, label: label + (c.partial || c.whole !== undefined ? ' (a part of it)' : ''), why: said, at: Date.now() };
    if (!B.items.length) entries['out:' + chapter.id] = { label: `what was taken out of ${chapterLabel(novel, chapter)}`, why: said, at: Date.now() };
  }
  for (const part of B.chapters) entries['out:chapter:' + part.id] = { label: 'a chapter taken out', why: said, at: Date.now() };
  store.change('novel', novelId, novelSteps.setAside(entries));
  clearOut(novelId, B);
}
/* Read it again: a passage set aside is read afresh */
export function readAside(novelId, key) {
  const novel = store.peek('novel', novelId);
  const a = novel && novel.memory && novel.memory.aside && novel.memory.aside[key];
  if (!a) return false;
  if (a.chapterId && a.sig) {
    const map = { ...((novel.memory || {}).seen || {})[a.chapterId] };
    if (map[key] === a.sig) delete map[key];
    store.change('novel', novelId, novelSteps.seen(a.chapterId, map), { now: true });
  }
  store.change('novel', novelId, novelSteps.dropAside([key]), { now: true });
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, 300);
  return true;
}

async function readChanges(novelId, conn) {
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
    const notesNow = notesText(novel, { forHelper: true, fit: notesFit });
    const fixed = estimateTokens(helperFrame(house, novel)) + estimateTokens(notesNow) + (notesNow.endsWith('shown by their first line.)') ? Math.floor(notesFit * 0.25) : 0) + estimateTokens(aboutTheBook(novel, { plans: false, kept: 'his' })) + 900;
    const room = readingRoom(conn, fixed);
    if (room < 600) {
      const e = new Error(`its model holds ${contextOf(conn).toLocaleString()} tokens, too few to read the book beside its notes — choose one with more room for the helper`);
      e.permanent = true;
      throw e;
    }
    const batchWords = Math.max(200, Math.min(9000, Math.floor((room * 0.6) / 1.4)));
    const beforeChars = Math.max(0, Math.min(60000, Math.floor(room * 0.3 * 3.2)));
    /* a long change is read in parts; the first part carries what was taken out */
    const changes = target ? target.changes : [];
    const removed = target ? target.removed : [];
    const firstChanged = changes.length ? chapter.passages.findIndex((p) => p.id === changes[0].pid) : -1;
    const before = chapter && firstChanged > 0 ? chapterText({ passages: chapter.passages.slice(0, firstChanged) }) : '';
    /* a part written into the middle of a chapter: the chapter goes on after it, already read */
    const lastChanged = changes.length ? Math.max(...changes.map((c) => chapter.passages.findIndex((p) => p.id === c.pid))) : -1;
    const goesOn = lastChanged >= 0 && chapter.passages.slice(lastChanged + 1).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
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
    const outWords = removed.reduce((a, r) => a + countWords(r.text), 0) + chapterParts.reduce((a, r) => a + countWords(r.text), 0);
    const ask = (fields) => ({ items: [], removed: [], chapters: [], before: '', ...fields });
    const batches = [];
    /* what was taken out rides with the first passages when it is short; alone and first when it is long, or one at a time is asked */
    const alone = one || outWords > batchWords / 4 || chapterParts.length > removedChapters.length;
    if (alone) {
      /* passages taken out, a few at a time (one at a time when asked) */
      let group = [];
      let gw = 0;
      for (const r of removed) {
        const w = countWords(r.text);
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
      const w = countWords(c.text) + countWords(c.old);
      if (one) push();
      if (w > batchWords) {
        push();
        const parts = partsOf(c.text, Math.max(150, batchWords - countWords(c.old)));
        parts.forEach((part, i) => batches.push(ask({ items: [{ ...c, whole: c.text, text: part + (parts.length > 1 ? `\n\n(part ${i + 1} of ${parts.length})` : ''), old: i === 0 ? c.old : '', partial: i < parts.length - 1 }] })));
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
    for (let b = 0; b < batches.length; b++) {
      const B = batches[b];
      const now = store.peek('novel', novelId);
      const request = notesRequest({
        novel: now,
        chapterLabel: label,
        before: B.before,
        changes: B.items,
        removed: B.removed.map((r) => r.text).filter((t) => String(t || '').trim()),
        removedChapters: B.chapters.map((r) => r.text),
        at, of: (now.order || []).length, goesOn, notesFit,
      });
      let got;
      const gen = ((now.memory || {}).reread || 0);
      readingNow.add(novelId);
      try { got = await askJson(conn, helperFrame(house, now), request, { want: notesShape }); } finally { readingNow.delete(novelId); }
      /* the whole book began to be read again (or that was undone) while it was asked: its answer belongs to notes no longer there */
      if ((((store.peek('novel', novelId) || {}).memory || {}).reread || 0) !== gen) break;
      if (!got.ok) {
        /* a passage its model will not read is set aside, never asked forever */
        const fault = await whoseFault(conn, got);
        if (fault !== 'words') throw failed(fault === 'model' ? got : fault);
        if (B.items.length + B.removed.length + B.chapters.length > 1) { narrow.add(novelId); const e = failed(got); e.soon = true; throw e; }
        const key = askedKey(B);
        const n = (stuck.get(key) || 0) + 1;
        stuck.set(key, n);
        if (n < 2) throw failed({ error: got.error });
        stuck.delete(key);
        setAside(novelId, chapter, B, got.error);
        continue;
      }
      stuck.delete(askedKey(B));
      const latest = store.peek('novel', novelId);
      const folded = foldNotes(latest.notes, got.obj, { chapterId: chapter ? chapter.id : '', at: Date.now(), stands: hasGone(got.obj) ? bookFolded(latest) : null });
      /* what it keeps of the book as it stands (Automatic), when this part changed it — never over his correction */
      const kept = keptChanges(latest, got.obj);
      if (folded.cards.length || Object.keys(kept).length) {
        /* the cards it touched, changed by id — never the whole notes over a change made meanwhile */
        if (folded.cards.length) store.change('novel', novelId, novelSteps.applyCards(folded.cards));
        for (const [key, k] of Object.entries(kept)) store.change('novel', novelId, novelSteps.setKept(key, k.after));
        const u = latest.memory && latest.memory.undo;
        const keep = Boolean(u && u.keep);
        const cards = keep ? mergeUndo(u, folded.cards) : folded.cards;
        const keptUndo = keep ? mergeKeptUndo(u.kept, kept) : kept;
        const changed = [...changedOf(cards), ...keptChangedOf(keptUndo)].slice(0, 40);
        store.change('novel', novelId, novelSteps.setMemory({ undo: { at: keep ? u.at : Date.now(), label: keep ? u.label : label, keep, cards, kept: keptUndo, changed },
          lit: { at: Date.now(), label: readLabel(latest, chapter, B.items) || label, changed: [...changedOf(folded.cards), ...keptChangedOf(kept)].slice(0, 40) } }));
      }
      acc = mergeUndo({ cards: acc }, folded.cards);
      accKept = mergeKeptUndo(accKept, kept);
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
          if (B.removed.some((x) => x.key && x.key === r.key)) clear.push(r.key);
          else if (done.some((c) => r.key.startsWith(c.pid + SIG_SEP))) clear.push(r.key);
        }
        if (clear.length) store.change('chapter', chapter.id, chapterSteps.clearRetired(clear));
        for (const c of done) {
          const p = live && live.passages.find((x) => x.id === c.pid);
          const v = p && picked(p);
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
        for (const r of B.removed) delete map[r.pid];
        store.change('novel', novelId, novelSteps.seen(chapter.id, map));
        /* a passage once set aside, read now: no longer said to be left out */
        const aside = ((store.peek('novel', novelId).memory || {}).aside) || {};
        const back = done.map((c) => c.pid).filter((pid) => aside[pid]);
        if (back.length) store.change('novel', novelId, novelSteps.dropAside(back));
        /* what this reading changed, kept for each version it read (readings.js) */
        if (done.length) {
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
  const oneChange = done.length === 1 && last.was && last.old;
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

/* A chapter's summary is kept current once the writing has moved past it, or
 * once it has been quiet a while. A chapter longer than the helper's model
 * holds is summed up in parts, each part's summary carried into the next. */
const QUIET_MS = 10 * 60 * 1000;
async function summarise(novelId, conn) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const order = novel.order || [];
  for (let i = 0; i < order.length; i++) {
    const c = store.peek('chapter', order[i]);
    if (!c) continue;
    const text = chapterText(c);
    if (!text.trim()) continue;
    if ((c.passages || []).some((p) => (picked(p) || {}).streaming)) continue;
    const fp = chapterPrint(c);
    /* a summary from before Read the whole book again is due again — his own stays */
    const since = (novel.memory || {}).reread || 0;
    const fresh = (x) => Boolean(x) && (x.by === 'you' || !since || (x.at || 0) >= since);
    if (c.summary && c.summary.fp === fp && fresh(c.summary)) continue;
    /* one its model would not write, set aside until the chapter changes */
    const aside = ((novel.memory || {}).aside || {})['summary:' + c.id];
    if (aside && aside.fp === fp) continue;
    /* the chapter reads as it did once before (a version brought back): its summary from then comes back, with no call — his own, when he wrote it */
    const before = (c.summaries || []).find((x) => x.fp === fp && String(x.text || '').trim() && fresh(x));
    if (before) { store.change('chapter', c.id, chapterSteps.setSummary({ ...clone(before), fp, at: before.at || Date.now() })); continue; }
    const last = i === order.length - 1;
    const lastTouch = Math.max(0, ...(c.passages || []).map((p) => { const v = picked(p) || {}; return v.done || v.at || 0; }));
    if (last && Date.now() - lastTouch < QUIET_MS) { nudge(novelId, QUIET_MS - (Date.now() - lastTouch) + 1000); continue; }
    const now = store.peek('novel', novelId);
    const house = store.peek('house', 'house') || {};
    const label = chapterLabel(now, c, { withName: true });
    setLight(novelId, 'reading', `Summing up ${label}…`);
    const words = countWords(text);
    const frame = helperFrame(house, now);
    /* who and what the book already knows, by name — so "for the first time" means the book's first time (Cozy Tavern's M229) */
    const known = ['people', 'places', 'lore'].flatMap((k) => ((now.notes || {})[k] || []).map((x) => x.name)).filter(Boolean).slice(0, 150);
    const room = readingRoom(conn, estimateTokens(frame) + 700 + estimateTokens(known.join(', ')));
    const partWords = Math.max(200, Math.floor((room * 0.75) / 1.4));
    const parts = words > partWords ? partsOf(text, partWords) : [text];
    let summary = '';
    let name = '';
    const began = Date.now();
    let setAsideNow = false;
    for (let k = 0; k < parts.length; k++) {
      const lastPart = k === parts.length - 1;
      /* a summary with words in it, or none (an empty one is asked again — M681) */
      const got = await askJson(conn, frame, summaryRequest({ novel: now, chapterLabel: label, text: parts[k], needsName: lastPart && !c.name && c.nameBy !== 'you', words,
        part: parts.length > 1 ? k + 1 : 0, parts: parts.length, soFar: summary, known }), { want: (o) => typeof o.summary === 'string' && o.summary.trim().length > 0 });
      if (!got.ok) {
        const fault = await whoseFault(conn, got);
        if (fault !== 'words') throw failed(fault === 'model' ? got : fault);
        const key = `summary:${c.id}:${fp}`;
        const n = (stuck.get(key) || 0) + 1;
        stuck.set(key, n);
        if (n < 2) throw failed({ error: got.error });
        stuck.delete(key);
        store.change('novel', novelId, novelSteps.setAside({ ['summary:' + c.id]: { chapterId: c.id, fp, label: `the summary of ${label}`, why: String(got.error || '').slice(0, 300), at: Date.now() } }));
        setAsideNow = true;
        break;
      }
      summary = String(got.obj.summary || '').trim() || summary;
      if (lastPart) name = cleanName(got.obj.name);
    }
    if (setAsideNow) continue;
    const live = store.peek('chapter', c.id);
    if (!live) continue;
    /* one written meanwhile for the chapter as it reads (his, by the partner) stands — M72-8 */
    if (live.summary && live.summary.fp === fp && (live.summary.at || 0) >= began) continue;
    if (summary) {
      store.change('chapter', c.id, chapterSteps.setSummary({ text: summary, fp, at: Date.now() }));
      store.change('chapter', c.id, chapterSteps.keepSummary({ fp, text: summary, at: Date.now() }));
      if (((store.peek('novel', novelId).memory || {}).aside || {})['summary:' + c.id]) store.change('novel', novelId, novelSteps.dropAside(['summary:' + c.id]));
    }
    if (name && !live.name && live.nameBy !== 'you') store.change('chapter', c.id, chapterSteps.setName(name.replace(/^chapter\s+\w+\s*[:—-]\s*/i, '').slice(0, 80), 'helper'));
    await store.flush('chapter', c.id);
  }
}

/* ------------------------------------------- what it's about, how it reads */

const KEPT_WORDS = { about: 'What it’s about', style: 'How it reads' };

/* the kept texts a reading's answer changes: {key: {before, after}} */
function keptChanges(novel, answer) {
  const out = {};
  for (const key of keptByHelper(novel)) {
    const text = cleanText(answer && answer[key]);
    const before = (novel.kept && novel.kept[key]) || null;
    if (text && text !== String((before && before.text) || '').trim()) out[key] = { before: clone(before), after: { text, at: Date.now() } };
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
 * never tried yet — and only once the book has words */
function toKeep(novel) {
  const missing = keptByHelper(novel).filter((key) => !(novel.kept && novel.kept[key]));
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
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const keeps = toKeep(novel);
  if (!keeps.length) return;
  const house = store.peek('house', 'house') || {};
  const chapters = {};
  for (const id of novel.order || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  setLight(novelId, 'reading', `Reading the book for ${keeps.map((k) => KEPT_WORDS[k]).join(' and ')}…`);
  const frame = helperFrame(house, novel);
  const notesFit = notesRoomOf(conn);
  const fixed = estimateTokens(frame) + estimateTokens(notesText(novel, { forHelper: true, fit: notesFit })) + estimateTokens(aboutTheBook(novel, { plans: false, kept: 'his' })) + 1200;
  const room = readingRoom(conn, fixed);
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room: Math.max(0, room) });
  const got = await askJson(conn, frame, keepRequest({ novel, keeps, bookText: bookText(fit.book), notesFit }), { want: (o) => keeps.some((k) => typeof o[k] === 'string' && o[k].trim()) });
  if (!got.ok) {
    const fault = await whoseFault(conn, got);
    if (fault !== 'words') throw failed(fault === 'model' ? got : fault);
    const key = 'keep:' + keeps.join(',');
    const n = (stuck.get(key) || 0) + 1;
    stuck.set(key, n);
    if (n < 2) throw failed({ error: got.error });
    stuck.delete(key);
    /* its model would not write it: kept as tried, so the readings write it as the book goes on */
    const latest = store.peek('novel', novelId);
    for (const k of keeps) if (latest && keptByHelper(latest).includes(k) && !(latest.kept && latest.kept[k])) store.change('novel', novelId, novelSteps.setKept(k, { text: '', at: Date.now() }));
    return;
  }
  const latest = store.peek('novel', novelId);
  if (!latest) return;
  for (const key of keeps) {
    /* he corrected it, or set it to Manual, while it was being written: his stands */
    if (!keptByHelper(latest).includes(key) || (latest.kept && latest.kept[key])) continue;
    store.change('novel', novelId, novelSteps.setKept(key, { text: cleanText(got.obj[key]), at: Date.now() }));
  }
  await store.flush('novel', novelId);
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
/* what a check does, by version — 2: it folds repeats and says why. Notes
 * checked under an earlier one are checked again once, by themselves. */
export const AUDIT_V = 2;
export function auditDue(novel) {
  const m = (novel && novel.memory) || {};
  const notes = (novel && novel.notes) || {};
  if (!NOTE_KINDS.some((k) => (notes[k] || []).length)) return false;
  if (m.undo && m.undo.keep) return false;
  if (m.auditAsked) return true;
  return Boolean(m.audit) && (m.audit.reads || 0) >= AUDIT_EVERY;
}
/* A book opened for the first time since there was an auditor, or since it
 * learned more: notes kept before then are checked against the book once —
 * whatever an old version left in them, or repeats, goes, by itself */
export function firstCheck(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return false;
  const a = (novel.memory && novel.memory.audit) || null;
  if (a && (a.v || 1) >= AUDIT_V) return false;
  const has = NOTE_KINDS.some((k) => ((novel.notes || {})[k] || []).length);
  store.change('novel', novelId, novelSteps.setMemory({ audit: { ...(a || {}), at: a ? a.at || 0 : Date.now(), reads: a ? a.reads || 0 : 0, v: AUDIT_V }, ...(has ? { auditAsked: true } : {}) }), { now: true });
  return has;
}
/* Check the notes against the book, now (by hand, and for notes kept before the auditor) */
export function askAudit(novelId, { soon = 300 } = {}) {
  store.change('novel', novelId, novelSteps.setMemory({ auditAsked: true }), { now: true });
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, soon);
}
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
  const budget = Math.max(2000, Math.floor(contextOf(conn) * 0.4));
  let only = null;
  let others = [];
  let nextFrom = 0;
  if (estimateTokens(notesText(novel, { forHelper: true })) > budget) {
    const start = Math.min(Math.max(0, a0.from || 0), Math.max(0, every.length - 1));
    only = new Set();
    for (let i = 0; i < every.length; i++) {
      const x = every[(start + i) % every.length];
      only.add(x.card.id);
      if (estimateTokens(notesText(novel, { forHelper: true, only })) > budget && only.size > 1) { only.delete(x.card.id); break; }
    }
    nextFrom = (start + only.size) % every.length;
    others = every.filter((x) => !only.has(x.card.id)).map((x) => x.card.name);
  }
  const fixed = estimateTokens(frame) + estimateTokens(notesText(novel, { forHelper: true, only })) + estimateTokens(others.join(', ')) + estimateTokens(aboutTheBook(novel, { plans: false, kept: 'his' })) + 2000;
  const room = readingRoom(conn, fixed);
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room: Math.max(0, room) });
  const his = NOTE_KINDS.flatMap((k) => ((novel.notes || {})[k] || []).filter((c) => c.updated && c.updated.by === 'you' && (!only || only.has(c.id))).map((c) => c.name));
  const partial = Boolean(fit.book.omitted || fit.book.summaries.length);
  const gen = (novel.memory || {}).reread || 0;
  const got = await askJson(conn, frame, auditRequest({ novel, bookText: bookText(fit.book), his, partial, only, others }), { want: notesShape });
  /* the whole book began to be read again while it checked: the notes it checked are not there any more */
  const now = store.peek('novel', novelId);
  if (!now || ((now.memory || {}).reread || 0) !== gen || rebuildingNow(now)) return;
  if (!got.ok) {
    const fault = await whoseFault(conn, got);
    if (fault !== 'words') throw failed(fault === 'model' ? got : fault);
    const n = (stuck.get('audit:' + novelId) || 0) + 1;
    stuck.set('audit:' + novelId, n);
    if (n < 2) throw failed({ error: got.error });
    stuck.delete('audit:' + novelId);
    /* its model would not check the notes: said so, and not asked again until it is due */
    store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0, v: AUDIT_V, checked: true, failed: String(got.error || '').slice(0, 300), fixed: 0, changes: [], verdict: '', clear: true, from: a0.from || 0 }, auditAsked: false }));
    return;
  }
  stuck.delete('audit:' + novelId);
  const latest = store.peek('novel', novelId);
  if (!latest) return;
  /* his own cards are never taken out, nor his words changed; nor a card
   * still in the book (foldNotes) */
  const folded = foldNotes(latest.notes, got.obj, { chapterId: '', at: Date.now(), audit: true, stands: hasGone(got.obj) ? bookFolded(latest) : null, limit: only });
  const label = 'the notes checked against the book';
  const changed = changedOf(folded.cards).map((c, i) => (folded.whys[folded.cards[i].id] ? { ...c, why: folded.whys[folded.cards[i].id] } : c)).slice(0, 40);
  if (folded.cards.length) {
    store.change('novel', novelId, novelSteps.applyCards(folded.cards));
    store.change('novel', novelId, novelSteps.setMemory({ undo: { at: Date.now(), label, keep: false, cards: folded.cards, kept: {}, changed }, lit: { at: Date.now(), label, changed } }));
  }
  /* what it found, for him to read: whether anything is left for him, in its words */
  const verdict = cleanText(got.obj && got.obj.verdict).slice(0, 800);
  const clear = !(got.obj && got.obj.clear === false);
  store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0, v: AUDIT_V, checked: true, fixed: folded.cards.length, changes: changed, verdict, clear, partial,
    ...(only ? { from: nextFrom, some: { checked: only.size, all: every.length } } : {}) }, auditAsked: false }));
  await store.flush('novel', novelId);
}

/* "Write it from the book again": his correction goes, and the helper writes
 * it afresh from the book. */
export function keepAgain(novelId, key) {
  store.change('novel', novelId, novelSteps.setKept(key, null), { now: true });
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
  /* what it keeps of the book goes back too — unless he corrected it since */
  for (const [key, k] of Object.entries(u.kept || {})) {
    const cur = (novel.kept && novel.kept[key]) || null;
    if (JSON.stringify(cur) === JSON.stringify(k.after || null)) store.change('novel', novelId, novelSteps.setKept(key, k.before || null), { now: true });
  }
  /* Read the whole book again, undone (while it reads, or after): stopped, and
   * what was read put back as it was */
  const back = u.seen ? { seen: u.seen, readings: u.readings || {}, removed: u.removed || [], reread: 0, rereadFrom: null } : {};
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
      undo: { at, label: 'the whole book', keep: true, cards, kept, changed: [], seen: clone(m.seen || {}), readings: clone(m.readings || {}), removed: clone(m.removed || []) },
      rereadFrom: { at, notes: clone(novel.notes || {}), kept: clone(novel.kept || {}) },
    }), { now: true });
  }
  /* read from the start, the summaries written afresh (each older than now is due again — his stay), the notes' check not due till it is done */
  store.change('novel', novelId, novelSteps.setMemory({ seen: {}, removed: [], readings: {}, lit: null, reread: at, audit: { ...(m.audit || {}), reads: 0 } }), { now: true });
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
  if (u && u.keep) store.change('novel', novelId, novelSteps.setMemory({ undo: { ...u, keep: false }, rereadFrom: null }));
  else if (novel && novel.memory && novel.memory.rereadFrom) store.change('novel', novelId, novelSteps.setMemory({ rereadFrom: null }));
}

export function forTests() { return { lights, failures, blocked, timers, narrow, stuck }; }
