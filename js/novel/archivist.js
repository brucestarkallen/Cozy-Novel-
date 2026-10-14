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
import { ask } from '../model/call.js';
import { contextOf, thinksOn, thinkingFloor } from '../model/providers.js';
import { connFor, busy as writerBusy, setNotesWait } from './writer.js';
import { parseFirstObject } from './jsonutil.js';
import { hashText, countWords, nameKey, newId, clone, estimateTokens } from '../util.js';
import { picked, chapterLabel, chapterText, chapterPrint, chapterWords, chapterSteps, novelSteps, passageNumbers, NOTE_KINDS } from './shape.js';
import { helperFrame, notesRequest, summaryRequest, keepRequest, keptByHelper, bookText, JSON_AGAIN, JSON_CUT, notesText, aboutTheBook, auditRequest } from './prompts.js';
import { fitBook } from './context.js';
import { readingOf, planOf, moved, changedBy, newestRead, unread } from './readings.js';

const lights = new Map();          /* novelId -> {state, words, at} */
const timers = new Map();
const runningFor = new Set();
const failures = new Map();        /* novelId -> {n, until} */
const blocked = new Map();         /* novelId -> the helper connection as it was refused */
const lightFns = new Set();

export function onLight(fn) { lightFns.add(fn); return () => lightFns.delete(fn); }
/* a page about to be written waits for a reading of this book that is on its way — a few seconds at most */
setNotesWait(async (novelId, ms, signal) => {
  const until = Date.now() + ms;
  while (runningFor.has(novelId) && Date.now() < until && !(signal && signal.aborted)) await new Promise((r) => setTimeout(r, 150));
});
export function lightOf(novelId) {
  /* no helper chosen is said whatever was last seen */
  if (!connFor(store.peek('house', 'house') || {}, 'helper')) return { state: 'off', words: 'No helper is chosen, so the notes are not being kept. Choose one in Settings → Connections (it can be the same as the writer).' };
  const l = lights.get(novelId);
  /* reading, waiting after a failure, or turned away: said as it is */
  if (l && (l.state === 'reading' || l.state === 'waiting' || l.state === 'trouble')) return l;
  /* green only when nothing is left unread */
  if (pendingWork(novelId)) return { state: 'waiting', words: 'The helper reads the newest words in a moment.' };
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

/* A whole chapter is going: what it held is kept for the helper. */
export function retireChapter(novelId, chapter) {
  const novel = store.peek('novel', novelId);
  if (!novel || !chapter) return;
  const seen = novel.memory && novel.memory.seen && novel.memory.seen[chapter.id];
  if (!seen || !Object.keys(seen).length) return;
  const text = chapter.summary && chapter.summary.text ? chapter.summary.text : chapterText(chapter).slice(0, 12000);
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

function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
function cleanText(s) { return String(s || '').replace(/\r/g, '').trim().slice(0, 4000); }
const his = (card) => Boolean(card && card.updated && card.updated.by === 'you');

function sameCard(card, name, aka = []) {
  const k = nameKey(name);
  if (!k) return false;
  if (nameKey(card.name) === k) return true;
  const theirs = (card.aka || []).map(nameKey);
  if (theirs.includes(k)) return true;
  return aka.map(nameKey).filter(Boolean).includes(nameKey(card.name));
}

/* Fold the helper's answer into the notes. Pure: returns the new notes and,
 * for each card it touched, the card before and after (so the reading can be
 * put back exactly). His own names and his own casing are kept. */
export function foldNotes(notes, answer, { chapterId = '', at = Date.now() } = {}) {
  const out = clone(notes || {});
  for (const k of NOTE_KINDS) if (!Array.isArray(out[k])) out[k] = [];
  const touched = new Map();       /* card id -> {kind, before} */
  const touch = (kind, card) => { if (!touched.has(card.id)) touched.set(card.id, { kind, before: clone(card) }); };
  for (const kind of NOTE_KINDS) {
    const rows = Array.isArray(answer && answer[kind]) ? answer[kind] : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const name = cleanName(row.name);
      if (!name) continue;
      const aka = Array.isArray(row.aka) ? row.aka.map(cleanName).filter((a) => a && nameKey(a) !== nameKey(name)) : [];
      const about = cleanText(row.about);
      const card = out[kind].find((c) => sameCard(c, name, aka));
      if (card) {
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
        /* what he wrote about it himself stands; the helper keeps the rest */
        if (about && !his(card)) card.about = about;
        if (kind === 'people') {
          const nowText = cleanText(row.now);
          if (nowText) card.now = nowText;
          /* how they stand with the others moves with the story, on his cards too */
          const ties = cleanText(row.ties);
          if (ties) card.ties = ties;
          const all = [...(card.aka || []), ...aka];
          card.aka = all.filter((a, i) => all.findIndex((b) => nameKey(b) === nameKey(a)) === i && nameKey(a) !== nameKey(card.name));
        }
        if (kind === 'threads' && typeof row.open === 'boolean') card.open = row.open;
        if (JSON.stringify(card) !== was) {
          if (!touched.has(card.id)) touched.set(card.id, { kind, before });
          /* a card he wrote stays his: the helper keeps where they are now, never his words */
          card.updated = his(before) ? { by: 'you', chapterId, at } : { chapterId, at };
        }
      } else {
        const fresh = { id: newId(kind.slice(0, 2)), name, about, updated: { chapterId, at } };
        if (kind === 'people') { fresh.aka = aka; fresh.ties = cleanText(row.ties); fresh.now = cleanText(row.now); }
        if (kind === 'threads') fresh.open = row.open !== false;
        out[kind].push(fresh);
        touched.set(fresh.id, { kind, before: null });
      }
    }
  }
  const gone = Array.isArray(answer && answer.gone) ? answer.gone : [];
  for (const g of gone) {
    if (!g || typeof g !== 'object' || !NOTE_KINDS.includes(g.kind)) continue;
    const name = cleanName(g.name);
    for (const c of out[g.kind].filter((x) => sameCard(x, name))) touch(g.kind, c);
    out[g.kind] = out[g.kind].filter((c) => !sameCard(c, name));
  }
  const cards = [];
  for (const [id, t] of touched) {
    const after = out[t.kind].find((c) => c.id === id) || null;
    if (JSON.stringify(after) === JSON.stringify(t.before)) continue;
    cards.push({ kind: t.kind, id, before: t.before, after: clone(after) });
  }
  const changed = cards.map((c) => ({ kind: c.kind, name: (c.after || c.before).name, how: !c.before ? 'new' : !c.after ? 'gone' : 'changed' }));
  return { notes: out, cards, changed };
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

/* how many tokens of the book a helper's request can carry, beside its notes
 * (and beside the reply's room, raised for a model that thinks) */
export function readingRoom(conn, fixed) {
  const reply = thinksOn(conn) ? Math.max(helperRoom(conn), thinkingFloor(conn)) : helperRoom(conn);
  return contextOf(conn) - reply - 1500 - fixed;
}

export async function askJson(conn, system, request, { want } = {}) {
  const room = helperRoom(conn);
  const first = await ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: request }], maxTokens: room }), stream: true, worker: true, patient: true });
  if (!first.ok) return { ok: false, error: first.error, permanent: first.permanent };
  let obj = parseFirstObject(first.text, want);
  if (obj) return { ok: true, obj };
  /* once more, told what went wrong — given more room when it ran out of it; never more than that */
  const cut = Boolean(first.cut);
  const more = cut ? Math.min(room * 2, Math.floor(contextOf(conn) * 0.6)) : room;
  const second = await ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: request }, { role: 'assistant', content: String(first.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: cut ? JSON_CUT : JSON_AGAIN }], maxTokens: more }), stream: true, worker: true, patient: true });
  if (!second.ok) return { ok: false, error: second.error, permanent: second.permanent };
  obj = parseFirstObject(second.text, want);
  if (obj) return { ok: true, obj };
  return { ok: false, error: 'its answer could not be read' };
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
    if (!target && !removedChapters.length) return;
    const chapter = target ? target.chapter : null;
    const label = chapter ? chapterLabel(novel, chapter) : 'the book';
    const at = chapter ? novel.order.indexOf(chapter.id) + 1 : 0;
    setLight(novelId, 'reading', `Reading ${label}…`);
    /* sized to the helper's model: what rides beside the notes */
    const fixed = estimateTokens(helperFrame(house, novel)) + estimateTokens(notesText(novel, { forHelper: true })) + estimateTokens(aboutTheBook(novel, { plans: false })) + 900;
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
    const batches = [];
    let batch = [];
    let words = 0;
    for (const c of changes) {
      const w = countWords(c.text) + countWords(c.old);
      if (w > batchWords) {
        if (batch.length) { batches.push(batch); batch = []; words = 0; }
        const parts = partsOf(c.text, Math.max(150, batchWords - countWords(c.old)));
        parts.forEach((part, i) => batches.push([{ ...c, whole: c.text, text: part + (parts.length > 1 ? `\n\n(part ${i + 1} of ${parts.length})` : ''), old: i === 0 ? c.old : '', partial: i < parts.length - 1 }]));
        continue;
      }
      if ((words + w > batchWords || (c.pid === newest && changes.length > 1)) && batch.length) { batches.push(batch); batch = []; words = 0; }
      batch.push(c);
      words += w;
    }
    if (batch.length) batches.push(batch);
    if (!batches.length) batches.push([]);
    /* what a passage read in parts changed, gathered until its last part */
    let acc = [];
    let accKept = {};
    for (let b = 0; b < batches.length; b++) {
      const now = store.peek('novel', novelId);
      const request = notesRequest({
        novel: now,
        chapterLabel: label,
        before: b === 0 ? beforeTail : '',
        changes: batches[b],
        removed: b === 0 ? removed.map((r) => r.text).filter((t) => String(t || '').trim()) : [],
        removedChapters: b === 0 ? removedChapters.map((r) => r.text) : [],
        at, of: (now.order || []).length, goesOn,
      });
      const got = await askJson(conn, helperFrame(house, now), request);
      if (!got.ok) throw failed(got);
      const latest = store.peek('novel', novelId);
      const folded = foldNotes(latest.notes, got.obj, { chapterId: chapter ? chapter.id : '', at: Date.now() });
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
          lit: { at: Date.now(), label: readLabel(latest, chapter, batches[b]) || label, changed: [...changedOf(folded.cards), ...keptChangedOf(kept)].slice(0, 40) } }));
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
        const done = batches[b].filter((c) => !c.partial);
        const map = { ...((store.peek('novel', novelId).memory || {}).seen || {})[chapter.id] };
        const clear = [];
        for (const r of (live && live.retired) || []) {
          if (b === 0 && removed.some((x) => x.key && x.key === r.key)) clear.push(r.key);
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
        if (b === 0) for (const r of removed) delete map[r.pid];
        store.change('novel', novelId, novelSteps.seen(chapter.id, map));
        /* what this reading changed, kept for each version it read (readings.js) */
        if (done.length) {
          keepReading(novelId, chapter, done, acc, accKept, { mixed: b === 0 && (removed.length > 0 || removedChapters.length > 0) });
          acc = [];
          accKept = {};
        }
      }
      if (b === 0 && removedChapters.length) store.change('novel', novelId, novelSteps.clearRemoved(removedChapters.map((r) => r.id)));
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
  /* one more reading since the notes were last checked against the book */
  const a = (novel.memory && novel.memory.audit) || null;
  store.change('novel', novelId, novelSteps.setMemory({ audit: { at: a ? a.at || 0 : Date.now(), reads: (a ? a.reads || 0 : 0) + 1 } }));
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
    if (c.summary && c.summary.fp === fp) continue;
    /* the chapter reads as it did once before (a version brought back): its summary from then comes back, with no call */
    const before = (c.summaries || []).find((x) => x.fp === fp && String(x.text || '').trim());
    if (before) { store.change('chapter', c.id, chapterSteps.setSummary({ text: before.text, fp, at: before.at || Date.now() })); continue; }
    const last = i === order.length - 1;
    const lastTouch = Math.max(0, ...(c.passages || []).map((p) => { const v = picked(p) || {}; return v.done || v.at || 0; }));
    if (last && Date.now() - lastTouch < QUIET_MS) { nudge(novelId, QUIET_MS - (Date.now() - lastTouch) + 1000); continue; }
    const now = store.peek('novel', novelId);
    const house = store.peek('house', 'house') || {};
    const label = chapterLabel(now, c, { withName: true });
    setLight(novelId, 'reading', `Summing up ${label}…`);
    const words = countWords(text);
    const frame = helperFrame(house, now);
    const room = readingRoom(conn, estimateTokens(frame) + 700);
    const partWords = Math.max(200, Math.floor((room * 0.75) / 1.4));
    const parts = words > partWords ? partsOf(text, partWords) : [text];
    let summary = '';
    let name = '';
    for (let k = 0; k < parts.length; k++) {
      const lastPart = k === parts.length - 1;
      const got = await askJson(conn, frame, summaryRequest({ novel: now, chapterLabel: label, text: parts[k], needsName: lastPart && !c.name && c.nameBy !== 'you', words,
        part: parts.length > 1 ? k + 1 : 0, parts: parts.length, soFar: summary }), { want: (o) => typeof o.summary === 'string' });
      if (!got.ok) throw failed(got);
      summary = String(got.obj.summary || '').trim() || summary;
      if (lastPart) name = cleanName(got.obj.name);
    }
    const live = store.peek('chapter', c.id);
    if (!live) continue;
    if (summary) {
      store.change('chapter', c.id, chapterSteps.setSummary({ text: summary, fp, at: Date.now() }));
      store.change('chapter', c.id, chapterSteps.keepSummary({ fp, text: summary, at: Date.now() }));
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
  const fixed = estimateTokens(frame) + estimateTokens(notesText(novel, { forHelper: true })) + estimateTokens(aboutTheBook(novel, { plans: false, kept: false })) + 1200;
  const room = readingRoom(conn, fixed);
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room: Math.max(0, room) });
  const got = await askJson(conn, frame, keepRequest({ novel, keeps, bookText: bookText(fit.book) }), { want: (o) => keeps.some((k) => typeof o[k] === 'string') });
  if (!got.ok) throw failed(got);
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
 * right: with the reading's Undo, lit, his own cards keeping his words.
 * Nothing waits on it: it runs once everything else is read. */
export const AUDIT_EVERY = 6;
export function auditDue(novel) {
  const m = (novel && novel.memory) || {};
  const notes = (novel && novel.notes) || {};
  if (!NOTE_KINDS.some((k) => (notes[k] || []).length)) return false;
  if (m.auditAsked) return true;
  return Boolean(m.audit) && (m.audit.reads || 0) >= AUDIT_EVERY;
}
/* A book opened for the first time since there was an auditor: notes kept
 * before then are checked against the book once — whatever an old version
 * left in them goes, by itself */
export function firstCheck(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel || (novel.memory && novel.memory.audit)) return false;
  const has = NOTE_KINDS.some((k) => ((novel.notes || {})[k] || []).length);
  store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0 }, ...(has ? { auditAsked: true } : {}) }), { now: true });
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
  if (!novel || !auditDue(novel) || pendingWork(novelId)) return;
  const house = store.peek('house', 'house') || {};
  const chapters = chaptersOf(novel);
  setLight(novelId, 'reading', 'Checking the notes against the book…');
  const frame = helperFrame(house, novel);
  const fixed = estimateTokens(frame) + estimateTokens(notesText(novel, { forHelper: true })) + estimateTokens(aboutTheBook(novel, { plans: false, kept: false })) + 1600;
  const room = readingRoom(conn, fixed);
  const fit = fitBook({ novel, chapters, chapterId: null, current: null, room: Math.max(0, room) });
  const his = NOTE_KINDS.flatMap((k) => ((novel.notes || {})[k] || []).filter((c) => c.updated && c.updated.by === 'you').map((c) => c.name));
  const got = await askJson(conn, frame, auditRequest({ novel, bookText: bookText(fit.book), his }));
  if (!got.ok) throw failed(got);
  const latest = store.peek('novel', novelId);
  if (!latest) return;
  /* his own cards are never taken out by it */
  const answer = { ...got.obj, gone: (Array.isArray(got.obj.gone) ? got.obj.gone : []).filter((g) => !((latest.notes || {})[g && g.kind] || []).some((c) => c.updated && c.updated.by === 'you' && nameKey(c.name) === nameKey(g.name))) };
  const folded = foldNotes(latest.notes, answer, { chapterId: '', at: Date.now() });
  const label = 'the notes checked against the book';
  if (folded.cards.length) {
    store.change('novel', novelId, novelSteps.applyCards(folded.cards));
    const changed = changedOf(folded.cards).slice(0, 40);
    store.change('novel', novelId, novelSteps.setMemory({ undo: { at: Date.now(), label, keep: false, cards: folded.cards, kept: {}, changed }, lit: { at: Date.now(), label, changed } }));
  }
  store.change('novel', novelId, novelSteps.setMemory({ audit: { at: Date.now(), reads: 0, fixed: folded.cards.length }, auditAsked: false }));
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
  store.change('novel', novelId, novelSteps.setMemory({ undo: null, lit: null }), { now: true });
  return true;
}

/* Read the whole book again from the start: the notes are rebuilt. Undo puts
 * back the ones there now (the whole re-reading counts as one reading). */
export function readAgain(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const cards = [];
  for (const kind of NOTE_KINDS) for (const c of (novel.notes && novel.notes[kind]) || []) cards.push({ kind, id: c.id, before: clone(c), after: null });
  /* what it keeps of the book (Automatic) is written afresh too — never his correction */
  const kept = {};
  for (const key of keptByHelper(novel)) if (novel.kept && novel.kept[key]) kept[key] = { before: clone(novel.kept[key]), after: null };
  store.change('novel', novelId, novelSteps.setMemory({ undo: { at: Date.now(), label: 'the whole book', keep: true, cards, kept, changed: [] }, seen: {}, removed: [], readings: {}, lit: null }), { now: true });
  store.change('novel', novelId, novelSteps.setNotes({ people: [], places: [], lore: [], threads: [] }), { now: true });
  for (const key of Object.keys(kept)) store.change('novel', novelId, novelSteps.setKept(key, null), { now: true });
  for (const id of novel.order || []) {
    const c = store.peek('chapter', id);
    if (c && c.summary) store.change('chapter', id, chapterSteps.setSummary(null), { now: true });
    /* and the summaries kept from before are not brought back in their place: all afresh */
    if (c && (c.summaries || []).length) store.change('chapter', id, chapterSteps.clearSummaries(), { now: true });
  }
  failures.delete(novelId);
  blocked.delete(novelId);
  nudge(novelId, 500);
}

/* a whole re-reading finished: its undo record is one reading from now on */
function finishReread(novelId) {
  const novel = store.peek('novel', novelId);
  const u = novel && novel.memory && novel.memory.undo;
  if (u && u.keep) store.change('novel', novelId, novelSteps.setMemory({ undo: { ...u, keep: false } }));
}

export function forTests() { return { lights, failures, blocked }; }
