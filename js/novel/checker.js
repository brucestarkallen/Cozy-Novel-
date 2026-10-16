/* Cozy Novel — js/novel/checker.js — THE CHECKER: Grammarly for the book.
 *
 * Each passage, once it is finished (written, his own words, an edit), is
 * read by the checker as Grammarly reads writing, made for a book: grammar,
 * spelling, punctuation and the book kept consistent ("grammar"); sentences
 * hard to follow, padded, unidiomatic or in a weak passive, written again
 * whole when that is what they need ("clarity"); wording that sounds
 * machine-made rather than written, a flat word, a word out of the book's
 * voice ("humanize"); his words to avoid; where a passage joins the one
 * before ("seam"); and slips against the book and its notes ("continuity").
 * What it would change waits, passage by
 * passage, behind the bubble on the page — green when everything is checked
 * and nothing needs changing, blue while it checks, yellow with what it
 * found — to be applied one by one or all at once, or left as it is.
 *
 * Nothing is changed without him — unless he switched on what happens by
 * itself (then his own words too, Settings → Who does what): an applied
 * suggestion makes a new version
 * of the passage (the words before are one arrow away); the suggestions of
 * one checking all land on that one new version. What it found is kept on
 * the chapter, for the version it read, only while that version still reads
 * the same. Old writing is never sent unasked: what was written before the
 * checker began on this phone, or brought in from a file, is checked when he
 * asks for a chapter or the whole book.
 *
 * Like the helper, it waits out a passing fault and tries again by itself; a
 * connection turned away for good is not asked again until it changes. */

import * as store from '../store.js';
import { connFor, connById, busy as writerBusy, recount, rewrite as writeAgain, rewriteSelection as writeSpanAgain } from './writer.js';
import * as archivist from './archivist.js';
import { picked, passageNumbers, chapterLabel, chapterNumber, chapterSteps, novelSteps, newVersion, endOf, rootOf, keptTail, writtenWith, howOf, bornOf, chapterText, duelMatches } from './shape.js';
import { numberedText, shortOf, notesBehind, passagesAfter } from './context.js';
import { bibItems, ridingItems } from './bibliography.js';
import { checkerFrame, checkRequest, duelRequest, avoidList, avoidLine, lateFor, CHECK_KINDS, JUDGE_CHECKS, macroNames, withMacros, standingNotes, namedBook } from './prompts.js';
import { locate, chapterNumber as chapterNum } from './changes.js';
import { findIn } from './search.js';
import { stockIn, repeatsIn } from './stock.js';
import { straysIn } from './textshape.js';
import { contextOf } from '../model/providers.js';
import { hashText, countWords, newId, plural, estimateTokens, cutWords } from '../util.js';

/* ------------------------------------------------------------ who checks */

/* The judge (Cozy Tavern's benchmark, for a novel): in the checker's own
 * reading, each passage held to ten checks of craft (prompts.js JUDGE_CHECKS)
 * — its grade the number it passes, each one it fails named with the words
 * that fail it; on unless he turns it off. A passage under his mark (9 unless
 * he sets another) comes with fixes that lift it and what writing it again
 * would need. And where one passage has versions by two writers for the same
 * moment, the two are read head to head (duels, below). Behind the bubble like
 * every suggestion: nothing changes until he says. */
export function judgeOf(house) {
  const j = (house && house.judge) || {};
  if (j.on === false) return null;
  const t = Number(j.target);
  return { target: Number.isFinite(t) && t >= 1 && t <= 10 ? Math.round(t * 10) / 10 : 9 };
}
export const CHECK_NAME = Object.fromEntries(JUDGE_CHECKS.map(([k, name]) => [k, name]));

/* the checker's connection: his choice, or the helper's; "off" is nobody */

export function checkerConn(house) {
  const roles = (house && house.roles) || {};
  if (roles.checker === 'off') return null;
  const own = roles.checker ? connById(house, roles.checker) : null;
  return own || connFor(house, 'helper');
}

/* A completed reading may be kept, but the next ask belongs to the choice
 * he has now, not a connection captured before he changed it. */
function checkerChoice(conn) {
  const id = conn.id;
  const print = archivist.choicePrint(conn);
  const current = () => {
    const now = checkerConn(store.peek('house', 'house') || {});
    return Boolean(now && now.id === id && archivist.choicePrint(now) === print);
  };
  return { current, beforeAsk: () => {
    if (current()) return;
    const error = new Error('the checker choice changed');
    error.checkerChanged = true;
    throw error;
  } };
}

/* ------------------------------------------------------------ what it found */

/* a version's words, as one short mark — kept for each version once */
const sigs = new WeakMap();
export function sigOf(v) {
  const t = String((v && v.text) || '');
  const was = sigs.get(v);
  if (was && was.text === t) return was.sig;
  const sig = hashText(t);
  if (v && typeof v === 'object') sigs.set(v, { text: t, sig });
  return sig;
}

/* what was found in the version of a passage on the page — only while it still reads as it did */
export function entryFor(chapter, p) {
  const v = picked(p);
  const e = v && chapter.checks && chapter.checks[p.id] && chapter.checks[p.id][v.id];
  return e && e.sig === sigOf(v) ? e : null;
}

/* a passage the checker reads by itself: finished, not checked as it reads
 * now, and written since checking began here (or in a chapter he asked to
 * have checked whole) */
/* checked, but with no grade on the ten checks (never one it would not give: graded false) */
const needsGrade = (e) => Boolean(e) && !e.aside && e.graded !== false && !(e.grade && Number.isFinite(e.grade.overall) && e.grade.of);

function wanted(house, chapter, p) {
  if (p.by === 'break') return false;
  const v = picked(p);
  if (!v || v.streaming || !String(v.text || '').trim()) return false;
  const e = entryFor(chapter, p);
  /* an answer that gave it no grade: graded again on a later look, twice at most (S06-G6) — and one checked
   * with no grade (the judge was off, or its grade is from before the ten checks) graded once he asks for
   * the chapter: its grade alone is asked for, what it found kept */
  if (e) {
    if (!judgeOf(house)) return false;
    if (e.graded === false) return (e.tries || 0) < 2;
    return Boolean(chapter.checkAll) && needsGrade(e);
  }
  if (chapter.checkAll) return true;
  /* by itself, only a finished page: one cut short or stopped waits for its Go on (Cozy Tavern M552) */
  if (v.cut) return false;
  if (howOf(v) === 'imported') return false;
  const from = house && house.checksFrom;
  return Number.isFinite(from) && bornOf(v) >= from;
}

function chaptersOf(novelId) {
  const novel = store.peek('novel', novelId);
  const out = [];
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) out.push(c); }
  return out;
}

/* every suggestion waiting in the book, chapter by chapter, passage by
 * passage — as his settings stand now (Cozy Tavern M474): a word he took off
 * his list is no longer offered, and a grade is under his mark only while it
 * is under the mark he has now */
/* a suggestion as his settings stand now: one for a word he took off his list, or a grade his mark no longer
 * stands over, is no longer his to see — nor done by itself */
function standsNow(house) {
  const avoid = new Set(avoidList(house).map((w) => w.toLowerCase()));
  const judge = judgeOf(house);
  return (item) => {
    if (item.kind === 'avoid' && item.replace === null) return (item.phrases || [item.phrase]).some((w) => w && avoid.has(String(w).toLowerCase()));
    if (item.kind === 'grade') return Boolean(judge) && Boolean(item.grade) && Number.isFinite(item.grade.overall) && item.grade.overall < judge.target;
    return true;
  };
}
export function suggestions(novelId) {
  const novel = store.peek('novel', novelId);
  const out = [];
  if (!novel) return out;
  const house = store.peek('house', 'house') || {};
  const judge = judgeOf(house);
  const stands = standsNow(house);
  for (const c of chaptersOf(novelId)) {
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const e = entryFor(c, p);
      if (!e || !(e.items || []).length) continue;
      const v = picked(p);
      for (const item of e.items) {
        if (!stands(item)) continue;
        const shown = item.kind === 'grade' ? { ...item, target: judge.target, ...(v.liftFailed ? { liftFailed: v.liftFailed } : {}) } : item;
        out.push({ chapterId: c.id, passageId: p.id, versionId: v.id, number: nums.get(p.id), chapter: chapterNumber(novel, c.id), item: shown, text: String(v.text || '') });
      }
    }
  }
  return out;
}

/* the passages its model would not check, set aside while their words stand — each with Check it again */
export function setAsideList(novelId) {
  const novel = store.peek('novel', novelId);
  const out = [];
  if (!novel) return out;
  for (const c of chaptersOf(novelId)) {
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      const e = p.by === 'break' ? null : entryFor(c, p);
      if (e && e.aside) out.push({ chapterId: c.id, passageId: p.id, versionId: picked(p).id, number: nums.get(p.id), chapter: chapterNumber(novel, c.id), why: e.aside, at: e.at });
    }
  }
  return out;
}
/* Check it again: one set aside let go, read afresh */
export function checkAgain(novelId, chapterId, passageId) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && (chapter.passages || []).find((x) => x.id === passageId);
  const v = p && picked(p);
  const e = p && entryFor(chapter, p);
  if (!e || !e.aside) return false;
  store.change('chapter', chapterId, chapterSteps.dropCheck(p.id, v.id), { now: true, checkpoint: true });
  /* asked again in its own right, never together with others */
  stuckC.delete(`${p.id}:${v.id}:${e.sig}`);
  failures.delete(novelId);
  blocked.delete(novelId);
  schedule(novelId, 300);
  return true;
}

/* the passages still to be read by themselves, and the older ones he can ask for */
export function waiting(novelId) {
  const house = store.peek('house', 'house') || {};
  let n = 0;
  for (const c of chaptersOf(novelId)) for (const p of c.passages || []) if (wanted(house, c, p)) n++;
  return n;
}
export function unchecked(novelId, chapterId = null) {
  const house = store.peek('house', 'house') || {};
  const judge = Boolean(judgeOf(house));
  let n = 0;
  let words = 0;
  /* checked, never graded — with the judge on, graded when he asks for the chapter (in one he asked for already, they wait their turn) */
  let ungraded = 0;
  for (const c of chaptersOf(novelId)) {
    if (chapterId && c.id !== chapterId) continue;
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (!v || v.streaming || !String(v.text || '').trim() || waitsForGoOn(house, v)) continue;
      const e = entryFor(c, p);
      if (e) { if (judge && !c.checkAll && needsGrade(e)) ungraded++; continue; }
      n++;
      words += countWords(v.text);
    }
  }
  return { passages: n, words, ungraded };
}
/* a new page that stopped partway: checked once Go on finishes it — never "older writing" (S11-G11) */
function waitsForGoOn(house, v) {
  const from = house && house.checksFrom;
  return Boolean(v && v.cut) && howOf(v) !== 'imported' && Number.isFinite(from) && bornOf(v) >= from;
}
function cutWaiting(novelId) {
  const house = store.peek('house', 'house') || {};
  let n = 0;
  for (const c of chaptersOf(novelId)) for (const p of c.passages || []) { const v = p.by === 'break' ? null : picked(p); if (v && !v.streaming && String(v.text || '').trim() && !entryFor(c, p) && waitsForGoOn(house, v)) n++; }
  return n;
}

/* ------------------------------------------------------------ the light */

const states = new Map();      /* novelId -> {state, words} while checking, or after a fault */
const timers = new Map();
const runningFor = new Set();
/* a run of this page between its start and its work (waiting for the lock or the phone's lease): never two at once, and never taken for another window's */
const entering = new Set();
/* checking some book just now (an update waits for it) */
export function busyAny() { return runningFor.size > 0; }
const failures = new Map();
const blocked = new Map();
/* one passage at a time for a book, after a checking of several its model would not answer; and how often each passage's words were not answered (Cozy Tavern M316, M675-7) */
const narrowC = new Set();
const stuckC = new Map();
const fns = new Set();
export function onChecks(fn) { fns.add(fn); return () => fns.delete(fn); }
function tell(novelId) { for (const fn of fns) { try { fn(novelId); } catch (e) { console.error(e); } } }
const ELSEWHERE = 'Another window or browser open on this book is checking it — what it finds shows here when it is done.';
function setState(novelId, state, words) {
  if (state) states.set(novelId, { state, words }); else states.delete(novelId);
  tell(novelId);
}

/* How it stands, for the bubble: off (nobody checks), trouble, checking,
 * waiting (blue: checked in a moment), found (yellow), clean (green). */
export function stateOf(novelId) {
  const house = store.peek('house', 'house') || {};
  const count = suggestions(novelId).length;
  if (!checkerConn(house)) return { state: 'off', words: 'Nobody checks the writing just now. Choose a checker in Settings → Who does what.', count };
  const s = states.get(novelId);
  if (s && (s.state === 'trouble' || s.state === 'checking')) return { ...s, count };
  if (s && (s.state === 'retry' || s.state === 'elsewhere')) return { state: 'waiting', words: s.words, count };
  const again = automaticWait(novelId);
  if (again) return { state: 'waiting', words: `An automatic rewrite couldn’t finish just now. It tries again by itself in ${archivist.waitWords(again.until - Date.now())}.`, count };
  if (waiting(novelId)) return { state: 'waiting', words: 'The newest words are checked in a moment.', count };
  /* green says only what is true: older writing, never sent unasked, is not
   * called checked; a page that stopped partway waits for its Go on; one its
   * model would not check is said */
  const { passages: older, ungraded } = unchecked(novelId);
  const cut = cutWaiting(novelId);
  const aside = setAsideList(novelId).length;
  const asideSaid = aside ? `${aside === 1 ? 'One passage' : plural(aside, 'passage')} its model would not check — in Suggestions, with Check it again.` : '';
  if (count) return { state: 'found', words: [`${plural(count, 'suggestion')} to look at.`, asideSaid].filter(Boolean).join(' '), count };
  const more = [
    cut ? `${cut === 1 ? 'A passage that stopped partway is' : `${plural(cut, 'passage')} that stopped partway are`} checked once Go on finishes ${cut === 1 ? 'it' : 'them'}.` : '',
    asideSaid,
    older ? `${plural(older, 'older passage')} ${older === 1 ? 'is' : 'are'} checked only when you ask.` : '',
    ungraded ? `${ungraded === 1 ? 'One passage is' : `${plural(ungraded, 'passage')} are`} checked but not graded yet — Check this chapter, or Check the whole book, grades ${ungraded === 1 ? 'it' : 'them'}.` : '',
  ].filter(Boolean).join(' ');
  return { state: 'clean', words: more ? `${cut || aside ? 'Everything else new' : 'Everything new'} is checked — nothing to change. ${more}` : 'Everything is checked — nothing to change.', count: 0 };
}

/* ------------------------------------------------------------ when */

/* A look at the book soon — never later than one already due (a later
 * nudge never puts off a look that is coming), and never sooner than a
 * failed one said to wait. */
export function schedule(novelId, ms = 6000) {
  const f = failures.get(novelId);
  const wait = f && f.until > Date.now() ? f.until - Date.now() : 0;
  const due = Date.now() + Math.max(ms, wait);
  const was = timers.get(novelId);
  if (was && was.due <= due) { tell(novelId); return; }
  if (was) clearTimeout(was.t);
  timers.set(novelId, { due, t: setTimeout(() => { timers.delete(novelId); runCheck(novelId); }, due - Date.now()) });
  tell(novelId);
}
/* the page's own: a few seconds after any change the helper hears of, the
 * checker looks too (the helper's own later look — a summary in ten minutes —
 * is the helper's: the checker does not wait for it) */
let started = false;
export function startChecking() {
  if (started) return;
  started = true;
  archivist.onNudge((novelId) => schedule(novelId, 6000));
}

/* waiting out a failure, or stopped for a connection turned away: tried again now by his hand (Cozy Tavern M752-010) */
export function stalled(novelId) {
  const f = failures.get(novelId);
  return blocked.has(novelId) || Boolean(f && f.until > Date.now()) || Boolean(automaticWait(novelId));
}
export function tryNow(novelId) {
  if (!store.peek('novel', novelId)) return false;
  failures.delete(novelId);
  autoFailures.delete(novelId);
  blocked.delete(novelId);
  states.delete(novelId);
  const was = timers.get(novelId);
  if (was) { clearTimeout(was.t); timers.delete(novelId); }
  schedule(novelId, 200);
  return true;
}
function retryLater(novelId, asked = 0) {
  const n = ((failures.get(novelId) || {}).n || 0) + 1;
  /* never sooner than its provider asked (Cozy Tavern M28) */
  const ms = Math.max([60000, 180000, 600000][Math.min(n - 1, 2)], Number(asked) || 0);
  failures.set(novelId, { n, until: Date.now() + ms });
  const was = timers.get(novelId);
  if (was) { clearTimeout(was.t); timers.delete(novelId); }
  schedule(novelId, ms);
  return { n, words: archivist.waitWords(ms) };
}

/* ------------------------------------------------------------ the reading */

/* what one checking holds besides the passages and the story before them:
 * its frame, his words to avoid, and the request itself with nothing in it to
 * check — the notes, what the book is about, every instruction, the judge's
 * checks when it judges — measured from the words that are sent, so a longer
 * instruction is never more than the room allows; and room for a line of
 * stock wording found */
function fixedOf(house, novel, conn = null) {
  /* the notes as everyone reads them while the whole book is read again (Cozy Tavern M262), fitted to its model's room as the helper's are (S06-G3) */
  const view = namedBook(standingNotes(novel), house);
  const notesFit = conn ? archivist.notesRoomOf(conn) : 0;
  const avoid = avoidList(house);
  const system = [checkerFrame(house, view), avoidLine(avoid)].filter(Boolean).join('\n\n');
  const req = checkRequest({ novel: view, chapterLabel: 'Chapter Twenty-Two', numbered: '', avoid, judge: judgeOf(house), his: hisWords(house), notesFit });
  /* with the notes fitted, room for the cards the passages name to ride whole */
  const fitted = /\(To fit, the cards [^)]*\)/.test(req);
  return estimateTokens(system) + estimateTokens(req) + (fitted ? Math.floor(notesFit * 0.25) : 0) + 150;
}

/* What the writer is told of how to write — his own box, and his note at the
 * end for the book — word for word, for the checker and the judge to hold
 * the page to the book he asked for (a box past 6,000 tokens, its opening
 * and close: a quick checker's room is for the pages). */
function hisWords(house) {
  const instr = (house && house.instructions) || {};
  /* as the writer is told them: the names in, never {{user}} or {{char}} */
  const t = withMacros([String(instr.system || '').trim(), lateFor(instr, 'write')].filter(Boolean).join('\n\n'), macroNames(house, 'write'));
  if (estimateTokens(t) <= 6000) return t;
  const n = 9000;
  return `${t.slice(0, n).trim()}\n[…]\n${t.slice(-n).trim()}`;
}

/* The chapters before this one as the writer is told them past its room —
 * each by its summary (or, not summarised yet, its opening and close) — as
 * many of the nearest as the room holds. */
function storySoFar(novel, chapterId, budget) {
  const order = novel.order || [];
  const rows = [];
  let used = 0;
  let left = 0;
  for (let i = order.indexOf(chapterId) - 1; i >= 0; i--) {
    const c = store.peek('chapter', order[i]);
    if (!c) continue;
    const row = `${chapterLabel(novel, c)}:\n${shortOf(c)}`;
    const t = estimateTokens(row);
    /* the ones before that are left out — said, never silent (S06-G7) */
    if (used + t > budget) { left = i + 1; break; }
    rows.unshift(row);
    used += t;
  }
  return { text: rows.join('\n\n'), left };
}

/* how many words one checking carries: about as many as a careful read takes
 * at once, and never more than the checker's model holds beside the notes */
const BATCH_WORDS = 2500;
function batchWords(conn, house, novel) {
  const fixed = fixedOf(house, novel, conn);
  const room = archivist.readingRoom(conn, fixed);
  if (room < 600) {
    const e = new Error(`its model holds ${contextOf(conn).toLocaleString()} tokens, too few to check the book beside its notes — choose one with more room for the checker`);
    e.permanent = true;
    throw e;
  }
  return Math.max(150, Math.min(BATCH_WORDS, Math.floor((room * 0.6) / 1.4)));
}

/* the next passages to read: of one chapter, in the book's order, as many
 * words as one checking carries (a longer passage alone, read in parts) */
function nextBatch(novelId, limit, { one = false } = {}) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  for (const c of chaptersOf(novelId)) {
    const list = [];
    let words = 0;
    /* passages checked already, wanted for their grade alone, go in a checking of their own */
    let gradeOnly = null;
    for (const p of c.passages || []) {
      if (!wanted(house, c, p)) continue;
      const w = countWords(picked(p).text);
      const has = Boolean(entryFor(c, p));
      if (list.length && has !== gradeOnly) break;
      gradeOnly = has;
      /* one at a time once a checking of several its model would not answer (the helper's narrow) */
      if (list.length && (one || words + w > limit)) break;
      list.push(p);
      words += w;
      if (w > limit) break;
    }
    if (list.length) {
      const nums = passageNumbers(c);
      return { chapterId: c.id, passages: list, gradeOnly: Boolean(gradeOnly), label: `${chapterLabel(novel, c, { withName: false })}, ${list.length === 1 ? `passage ${nums.get(list[0].id)}` : `passages ${nums.get(list[0].id)}–${nums.get(list[list.length - 1].id)}`}` };
    }
  }
  return null;
}

export async function runCheck(novelId) {
  if (runningFor.has(novelId) || entering.has(novelId)) { schedule(novelId, 5000); return; }
  if (writerBusy(novelId)) { schedule(novelId, 4000); return; }
  const house = store.peek('house', 'house') || {};
  const selected = checkerConn(house);
  const conn = selected ? JSON.parse(JSON.stringify(selected)) : null;
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  if (!conn) { setState(novelId, null); return; }
  const choice = checkerChoice(conn);
  if (blocked.has(novelId) && blocked.get(novelId) === archivist.connPrint(conn)) return;
  blocked.delete(novelId);
  const work = async () => {
    runningFor.add(novelId);
    try {
      for (const c of chaptersOf(novelId)) if (stale(c)) store.change('chapter', c.id, chapterSteps.pruneChecks(), { checkpoint: true });
      keepGrades(novelId);
      /* a passage another connection's model would not check: this one may (S08-G11, as the helper's) */
      const print = archivist.connPrint(conn);
      for (const c of chaptersOf(novelId)) {
        for (const [pid, byV] of Object.entries(c.checks || {})) {
          for (const [vid, e] of Object.entries(byV || {})) if (e && e.aside && e.conn && e.conn !== print) store.change('chapter', c.id, chapterSteps.dropCheck(pid, vid), { checkpoint: true });
        }
      }
      let lastAsked = '';
      for (let n = 0; ; n++) {
        choice.beforeAsk();
        if (writerBusy(novelId)) { schedule(novelId, 4000); break; }
        const limit = batchWords(conn, store.peek('house', 'house') || {}, store.peek('novel', novelId) || novel);
        const batch = nextBatch(novelId, limit, { one: narrowC.has(novelId) });
        if (!batch) { narrowC.delete(novelId); break; }
        /* the same words again means nothing could be kept for them: never asked in a loop */
        const asking = batch.passages.map((p) => picked(p).id).join(',');
        if (asking === lastAsked) break;
        /* a whole long book: the rest in a moment, a run at a time */
        if (n >= 60) { schedule(novelId, 2000); break; }
        lastAsked = asking;
        setState(novelId, 'checking', `Checking ${batch.label}…`);
        await checkBatch(novelId, conn, batch, limit, choice);
      }
      choice.beforeAsk();
      /* the judge's head to head, once the reading is done */
      if (judgeOf(store.peek('house', 'house') || {})) await runDuels(novelId, conn, choice);
      choice.beforeAsk();
      /* and what he switched on to happen by itself */
      autoAfter(novelId);
      failures.delete(novelId);
      setState(novelId, null);
    } catch (e) {
      const why = (e && e.message) || String(e);
      if (e && e.checkerChanged) {
        failures.delete(novelId);
        setState(novelId, null);
        if (checkerConn(store.peek('house', 'house') || {})) schedule(novelId, 300);
        return;
      }
      /* another browser has the book now: it finishes the checking */
      if (e && e.yielded) { setState(novelId, 'elsewhere', ELSEWHERE); schedule(novelId, 30000); return; }
      /* it made way for his page on its connection: it reads on once the page has gone */
      if (e && e.gaveWay) { setState(novelId, null); schedule(novelId, 20000); return; }
      /* a checking of several its model would not answer: read again at once, one passage at a time */
      if (e && e.soon) { setState(novelId, 'checking', `The checker reads one passage at a time now (${why}).`); schedule(novelId, 1500); return; }
      if (e && e.permanent) {
        blocked.set(novelId, archivist.connPrint(conn));
        failures.delete(novelId);
        setState(novelId, 'trouble', `The checker stopped: ${why}. It checks again once its connection changes (Settings → Connections, or Who does what).`);
        return;
      }
      const later = retryLater(novelId, e && e.retryAfterMs);
      setState(novelId, later.n >= 3 ? 'trouble' : 'retry', `The checker couldn’t finish just now (${why}). It tries again by itself in ${later.words}.`);
    } finally {
      runningFor.delete(novelId);
      tell(novelId);
    }
  };
  /* one browser checks a book at a time (the phone's lease), and one window of it */
  /* another window or browser open on this book is checking it: said, never "in a moment" for as long as it holds it (Cozy Tavern M483) */
  const leased = () => archivist.withLease('checker', novelId, work, { refused: (held) => {
    if (!held.unreachable) setState(novelId, 'elsewhere', ELSEWHERE);
    schedule(novelId, Math.max(20000, Math.min(held.left || 0, 90000)));
  } });
  entering.add(novelId);
  try {
    if (globalThis.navigator && navigator.locks && navigator.locks.request) {
      await navigator.locks.request(`cozynovel-checker-${novelId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) { setState(novelId, 'elsewhere', ELSEWHERE); schedule(novelId, 20000); return; }
        await leased();
      });
    } else {
      await leased();
    }
  } finally {
    entering.delete(novelId);
  }
}

/* anything kept for a passage or version no longer in the chapter — or kept aside past its two days */
function stale(c) {
  const old = Date.now() - 2 * 86400000;
  for (const g of Object.values(c.checksGone || {})) if (!g || (g.at || 0) < old) return true;
  for (const pid of Object.keys(c.checksLeft || {})) if (!(c.passages || []).some((x) => x.id === pid)) return true;
  for (const d of Object.values(c.duels || {})) {
    const p = d && (c.passages || []).find((x) => x.id === d.pid);
    if (!duelMatches(p, d)) return true;
  }
  for (const [pid, byV] of Object.entries(c.checks || {})) {
    const p = (c.passages || []).find((x) => x.id === pid);
    if (!p) return true;
    for (const vid of Object.keys(byV || {})) if (!(p.versions || []).some((v) => v.id === vid)) return true;
  }
  return false;
}

function failed(got) {
  const e = new Error(got.error || 'the checker got no answer');
  e.permanent = Boolean(got.permanent);
  if (got.retryAfterMs) e.retryAfterMs = got.retryAfterMs;
  /* it made way for his page on the same connection: it reads again a little later, never narrowed or counted */
  if (got.leashed === 'gaveway') e.gaveWay = true;
  return e;
}

/* “a”, “a” or “b”, “a”, “b” or “c” */
export function quoted(list, last = 'or') {
  const q = (list || []).map((w) => `“${w}”`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} ${last} ${q[q.length - 1]}` : q.join('');
}
const clean = (s, n = 300) => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/* the sentence around some words: from the end of the one before to the end of its own */
function sentenceAround(text, start, end) {
  let a = start;
  while (a > 0 && text[a - 1] !== '\n' && !(/[.!?…]/.test(text[a - 2] || '') && /\s/.test(text[a - 1]))) a--;
  let b = end;
  while (b < text.length && text[b] !== '\n' && !/[.!?…]/.test(text[b])) b++;
  while (b < text.length && /[.!?…"”’)\]]/.test(text[b])) b++;
  while (a < b && /\s/.test(text[a])) a++;
  return { start: a, end: b };
}

/* his words to avoid, standing as words (not inside longer ones) */
function avoidedIn(text, phrase) {
  const word = /[\p{L}\p{N}]/u;
  return findIn(text, phrase).filter((h) => !(word.test(phrase[0]) && word.test(text[h.start - 1] || '')) && !(word.test(phrase[phrase.length - 1]) && word.test(text[h.end] || '')));
}

/* what he asked the writer for in a version: his premise, or his note for a rewrite */
function askWords(v) {
  const a = (v && v.ask) || {};
  return String(a.direction || a.note || '').trim();
}

/* the story right before some passages, for slips against what was just
 * written and for the seam: their own chapter up to them — or, for a
 * chapter's first passages, the end of the chapter before (how this one
 * picks up). from: 'this' or 'last' */
function storyBefore(novel, chapter, pid) {
  const list = chapter.passages || [];
  const first = list.findIndex((p) => p.id === pid);
  const lead = first > 0 ? chapterText({ passages: list.slice(0, first) }) : '';
  if (lead.trim()) return { text: lead, from: 'this' };
  const order = novel.order || [];
  for (let i = order.indexOf(chapter.id) - 1; i >= 0; i--) {
    const t = chapterText(store.peek('chapter', order[i]));
    if (t.trim()) return { text: t, from: 'last' };
  }
  return { text: '', from: 'this' };
}
/* as much of it as `keep` characters hold, from its end */
const tailOf = (text, keep) => (!keep ? '' : text.length > keep ? '[…]\n' + text.slice(-keep).replace(/^\S*\s+/, '') : text);

/* The judge's grade of one passage, from its answers (a passage read in
 * parts: every part's). A check is read by its first word — "no — it repeats
 * the last line" is a no, "N", "✗", false and 0 too (Cozy Tavern M439); one a
 * fault names and that was not answered a plain yes fails as well. A fail is
 * held to its evidence (Cozy Tavern M644/M658): the words it named, found
 * where they stand in the passage — a "no" whose words are not on the page is
 * shown, unverified, and never counted or written again for. "fresh" fails
 * wherever stock wording is counted in it, and "sentences" wherever a stray of
 * another script stands, whatever was answered (a model reading for its own
 * kind of phrasing misses most of it). The grade is the number of checks
 * passed, of ten. */
const SAID_NO = /^\s*(?:(?:no|n|fail(?:s|ed)?|false)(?![\p{L}])|[✗❌×✘])/iu;
const SAID_YES = /^\s*(?:(?:yes|y|pass(?:es|ed)?|true|ok)(?![\p{L}])|[✓✔])/iu;
/* a check as an answer names it — its key or its name, in any capitals, spaces or marks ("canon", "True to the book",
 * "true_to_the_book", "Opening") — or nothing (2.6.5: a check named any way but the key was read as a pass, so a
 * judge that wrote "Opening": "no" gave a page ten of ten) */
const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const CHECK_KEY = new Map(JUDGE_CHECKS.flatMap(([k, name]) => [[squash(k), k], [squash(name), k]]));
const checkKey = (s) => CHECK_KEY.get(squash(s)) || '';

const saidYes = (said) => said === true || said === 1 || (typeof said === 'string' && SAID_YES.test(said));
const saidNo = (said) => said === false || said === 0 || (typeof said === 'string' && SAID_NO.test(said));
function gradeAnswers(g) {
  const raw = g && g.checks && typeof g.checks === 'object' && !Array.isArray(g.checks) ? g.checks : null;
  const checks = {};
  for (const [name, said] of Object.entries(raw || {})) { const k = checkKey(name); if (k && !(k in checks)) checks[k] = said; }
  const faults = (g && Array.isArray(g.faults) ? g.faults : []).filter((f) => f && typeof f === 'object' && checkKey(f.check));
  /* A missing or unreadable answer is not a pass. A named fault can supply
   * its own no; every other check still needs a clear yes or no. */
  const complete = JUDGE_CHECKS.every(([k]) => saidYes(checks[k]) || saidNo(checks[k]) || faults.some((f) => checkKey(f.check) === k));
  return { checks, faults, complete };
}

function judged(a, list, judge) {
  const failed = new Map();
  const completeGrades = [];
  let answered = false;
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const { checks, faults, complete } = gradeAnswers(g);
    if (!complete) continue;
    completeGrades.push(g);
    answered = true;
    for (const [k] of JUDGE_CHECKS) {
      const said = checks[k];
      const fault = faults.find((f) => checkKey(f.check) === k);
      const yes = saidYes(said);
      const no = saidNo(said) || (Boolean(fault) && !yes);
      if (!no || failed.has(k)) continue;
      const words = fault ? evidence(a.text, fault.words) : '';
      /* a "no" whose words are not in the passage: kept with what the judge quoted, shown — never counted */
      const quoted = fault ? clean(fault.words, 200) : '';
      failed.set(k, { check: k, ...(words ? { words } : { unverified: true, ...(quoted ? { said: quoted } : {}) }), why: fault ? clean(fault.why, 220) : '' });
    }
  }
  if (!answered) return null;
  if (a.stock.length && !(failed.get('fresh') || {}).words) {
    failed.set('fresh', { check: 'fresh', words: a.stock[0].words, why: 'stock wording — far more common in machine-made fiction than in books people write', counted: true });
  }
  if ((a.strays || []).length && !(failed.get('sentences') || {}).words) {
    const h = a.strays[0];
    failed.set('sentences', { check: 'sentences', words: a.text.slice(h.start, h.end), why: 'a stray character of another script stands in it', counted: true });
  }
  const faults = JUDGE_CHECKS.map(([k]) => failed.get(k)).filter(Boolean);
  const held = faults.filter((f) => !f.unverified);
  const grade = { overall: JUDGE_CHECKS.length - held.length, of: JUDGE_CHECKS.length, faults, model: a.model };
  if (grade.overall < judge.target) {
    const lift = completeGrades.map((g) => String(g.lift || '').trim()).filter(Boolean).join('\n');
    grade.lift = lift ? cutWords(lift, 1200) : liftOfFaults(held);
  }
  return grade;
}
/* what a lift says when the judge said none of its own: the checks the page
 * failed — only from what the page bears out: never "undefined", never a
 * fail it could not show */
export function liftOfFaults(faults) {
  const held = (faults || []).filter((f) => f && !f.unverified && CHECK_NAME[f.check]);
  const why = held.map((f) => { const w = f.why || (f.words ? `“${f.words}”` : ''); return w ? `${CHECK_NAME[f.check].toLowerCase()}: ${w}` : CHECK_NAME[f.check].toLowerCase(); });
  return why.length ? cutWords(`Fix what falls short — ${why.join('; ')}.`, 1200) : '';
}
/* the words a fault named, as they stand in the passage (its own spelling,
 * capitals and quotes) — or nothing when they are not there */
function evidence(text, words) {
  const w = String(words === undefined || words === null ? '' : words).replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, '').trim();
  if (!w) return '';
  const tries = [w, ...w.split(/\s*(?:…|\.\.\.)\s*/).filter((x) => x.length >= 12).sort((x, y) => y.length - x.length)];
  for (const t of tries) {
    const hit = findIn(text, t, { max: 1, whole: true })[0];
    if (hit) return text.slice(hit.start, hit.end);
  }
  /* the same words in the same order, a comma or a mark of its own aside, are the page's (Cozy Tavern M752-011) */
  for (const t of tries) {
    const hit = findIn(text, t, { max: 1, words: true, whole: true })[0];
    if (hit) return text.slice(hit.start, hit.end);
  }
  /* a quote with a word of its own in it (2.6.5): the longest stretch of six words or more of it that stands in the
   * passage as written — the page's own words, never the judge's */
  const ws = w.split(/\s+/).filter(Boolean).slice(0, 80);
  for (let len = ws.length - 1; len >= 6; len--) {
    for (let i = 0; i + len <= ws.length; i++) {
      const hit = findIn(text, ws.slice(i, i + len).join(' '), { max: 1, words: true, whole: true })[0];
      if (hit) return text.slice(hit.start, hit.end);
    }
  }
  return '';
}

/* A passage's number as an answer gives it — "2.3", "[2.3]", "2:3",
 * "Chapter Two, passage 3", a bare 3 in a batch of one chapter — read against
 * the numbers this checking asked about; a JSON number only when its
 * trailing-nought readings name one of them (2.1 is 2.10 only when there is no
 * 2.1). null when it names none, or more than one (S15-G10). */
export function refOf(raw, keys) {
  const list = [...keys];
  if (raw === undefined || raw === null || raw === '') return list.length === 1 ? list[0] : null;
  /* a whole JSON number is a bare passage number, as "3" is */
  if (typeof raw === 'number' && Number.isInteger(raw)) return refOf(String(raw), keys);
  if (typeof raw === 'number') {
    const t = String(raw);
    const hits = [t, `${t}0`, `${t}00`].filter((k) => keys.has(k));
    return hits.length === 1 ? hits[0] : null;
  }
  const t = String(raw).trim();
  let m = /^\[?\s*(\d+)\s*[.:]\s*(\d+)\s*\]?$/.exec(t);
  if (m) { const k = `${Number(m[1])}.${Number(m[2])}`; return keys.has(k) ? k : null; }
  m = /chapter\s+([\p{L}\d][\p{L}\d -]*?)\s*[,;:]?\s*passage\s+(\d+)/iu.exec(t);
  if (m) { const ci = chapterNum(m[1]); const k = `${ci}.${Number(m[2])}`; return ci && keys.has(k) ? k : null; }
  m = /^(?:passage\s+)?(\d+)$/i.exec(t);
  if (m) { const hits = list.filter((k) => k.split('.')[1] === String(Number(m[1]))); return hits.length === 1 ? hits[0] : null; }
  return null;
}

/* the chapter a passage stands in now — it may have moved (A new chapter from here) while it was checked */
function homeOf(novelId, chapterId, pid) {
  const c = store.peek('chapter', chapterId);
  if (c && (c.passages || []).some((x) => x.id === pid)) return chapterId;
  for (const x of chaptersOf(novelId)) if ((x.passages || []).some((y) => y.id === pid)) return x.id;
  return null;
}

/* a passage its model would not check, set aside while its words stand:
 * kept as checked, nothing found, and why — Check it again lets it go */
function setAsideCheck(novelId, chapterId, a, why, conn) {
  const home = homeOf(novelId, chapterId, a.pid);
  if (!home) return;
  store.change('chapter', home, chapterSteps.setCheck(a.pid, a.vid, { round: newId('ck'), sig: a.sig, at: Date.now(), items: [], aside: cutWords(why || 'its model would not check it', 300), conn: archivist.connPrint(conn) }), { checkpoint: true });
}

/* one checking: these passages read (a passage longer than one request
 * carries, in parts); what it would change, kept */
async function checkBatch(novelId, conn, batch, limit, choice) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', batch.chapterId);
  if (!novel || !chapter) return;
  /* the notes as everyone reads them while the whole book is read again (Cozy Tavern M262) */
  const view = namedBook(standingNotes(novel), house);
  const notesFit = archivist.notesRoomOf(conn);
  const avoid = avoidList(house);
  const ci = chapterNumber(novel, chapter.id);
  const nums = passageNumbers(chapter);
  /* the story right before the first of them (its chapter's, or the end of the chapter before) */
  const lead = storyBefore(novel, chapter, batch.passages[0].id);
  /* the pages right before a passage, for stretches it copies from them word for word (Cozy Tavern M512-1) */
  const list = chapter.passages || [];
  const priorOf = (p) => {
    const i = list.findIndex((x) => x.id === p.id);
    const near = list.slice(Math.max(0, i - 3), Math.max(0, i)).map((x) => String((picked(x) || {}).text || '')).join('\n\n');
    return i < 3 && lead.from === 'last' ? `${String(lead.text || '').slice(-6000)}\n\n${near}` : near;
  };
  /* each passage as it read when asked — what comes back is kept only for those words */
  const asked = new Map();
  for (const p of batch.passages) {
    const v = picked(p);
    const text = String(v.text || '');
    const ask = askWords(v);
    /* stock wording counted — never a kind his own words for it asked for (Cozy Tavern M355) — strays of another script, and stretches copied from the pages before */
    asked.set(`${ci}.${nums.get(p.id)}`, { pid: p.id, vid: v.id, text, sig: sigOf(v), model: v.model || '', items: [], stock: stockIn(text, { not: ask }), strays: straysIn(text), repeats: repeatsIn(text, priorOf(p)), ask, tries: ((entryFor(chapter, p) || {}).tries || 0) });
  }
  const keys = new Set(asked.keys());
  const system = [checkerFrame(house, view), avoidLine(avoid)].filter(Boolean).join('\n\n');
  const one = asked.size === 1 ? [...asked.entries()][0] : null;
  const numbered = one && countWords(one[1].text) > limit
    ? archivist.partsOf(one[1].text, limit).map((part) => `[${one[0]}] ${part}`)
    : [numberedText(novel, chapter, batch.passages)];
  /* what I asked the writer for in each passage this request carries (Cozy Tavern G3) */
  const askedOf = (words) => [...asked.entries()].filter(([n]) => words.includes(`[${n}]`)).map(([n, a]) => ({ n, words: a.ask }));
  /* the story right before them, so a slip against what was just written is caught —
   * and the passages are the truth where the notes lag behind them — as much of it
   * as the room left beside the passages holds (up to 6,000 characters; of the
   * chapter before, its last 2,500) */
  const askCost = Math.max(0, ...numbered.map((w) => askedOf(w).reduce((t, x) => t + estimateTokens(x.words) + 12, 0)));
  const spare = archivist.readingRoom(conn, fixedOf(house, novel, conn)) - Math.max(...numbered.map((x) => estimateTokens(x))) - askCost;
  const keep = Math.max(0, Math.min(lead.from === 'last' ? 2500 : 6000, Math.floor(spare * 0.4 * 3.5)));
  const before = tailOf(lead.text, keep);
  /* what the writer is told too: his words for how it is written, and the chapters before as their summaries — the ones left out said */
  const his = hisWords(house);
  const story = storySoFar(novel, chapter.id, Math.max(0, Math.min(4000, Math.floor(spare * 0.3))));
  /* the passages before these that the notes have not read, or never will (set aside) */
  const inHand = Object.fromEntries(chaptersOf(novelId).map((c) => [c.id, c]));
  const behind = notesBehind(view, inHand, chapter, { before: batch.passages[0].id }, 'write');
  /* the bibliography (bibliography.js): who and what these passages name, as the book set them down before them and as
   * his entries tell them — never from these passages or after them — so a slip against a chapter it reads only in
   * short is still caught */
  const bib = ridingItems(bibItems(view, inHand, { facts: true }), { near: batch.passages.map((x) => String((picked(x) || {}).text || '')).join('\n\n'),
    budget: Math.max(0, Math.min(2500, Math.floor(spare * 0.2))), skip: passagesAfter(novel, inHand, chapter.id, { before: batch.passages[0].id }, 'write') }).words.join('\n\n');
  const edits = [];
  const grades = [];
  const incompleteParts = new Set();
  const judge = judgeOf(house);
  const request = (words, extra = {}) => {
    const stock = {};
    const strays = {};
    const repeats = {};
    for (const [n, a] of asked) {
      const here = [...new Set(a.stock.map((h) => h.words))].filter((w) => words.includes(w)).slice(0, 8);
      if (here.length) stock[n] = here;
      const off = a.strays.filter((h) => words.includes(a.text.slice(h.start, h.end))).map((h) => h.words).slice(0, 4);
      if (off.length) strays[n] = off;
      const again = (a.repeats || []).map((h) => h.words).filter((w) => words.includes(w)).slice(0, 4);
      if (again.length) repeats[n] = again;
    }
    return checkRequest({ novel: view, chapterLabel: chapterLabel(novel, chapter), numbered: words, avoid, before, beforeFrom: lead.from, judge, stock, strays, repeats, his, sofar: story.text, left: story.left, notesFit, asked: askedOf(words), behind, bib, ...extra });
  };
  /* passages checked already, read again for their grade alone: what was found in them is kept as it is */
  const gradeOnly = Boolean(batch.gradeOnly) && Boolean(judge);
  const keptOf = (a) => { const live = store.peek('chapter', chapter.id) || chapter; return (live.checks && live.checks[a.pid] && live.checks[a.pid][a.vid]) || null; };
  /* no grade will come for it: kept as checked, never asked in a loop — what it found stays */
  const noGrade = (a) => { const old = keptOf(a); if (old && old.sig === a.sig) store.change('chapter', chapter.id, chapterSteps.setCheck(a.pid, a.vid, { ...old, graded: false, tries: 2 }), { checkpoint: true }); };
  for (const words of numbered) {
    choice.beforeAsk();
    const got = await archivist.askJson(conn, system, gradeOnly ? request(words, { gradesOnly: true }) : request(words), { want: gradeOnly ? (o) => Array.isArray(o.grades) : (o) => Array.isArray(o.edits), beforeAsk: choice.beforeAsk });
    await archivist.mustHold('checker', novelId);
    if (!got.ok) {
      /* WHOSE FAULT (Cozy Tavern M316, M675-7): the connection's stops the
       * checker until it changes; the model's (down, busy, let go on its
       * leash) waits; the words' — its model answers a harmless ask but not
       * this one — a checking of several is read one passage at a time, and
       * one passage refused a second time is set aside, never asked for ever,
       * never holding up the passages after it */
      const several = asked.size > 1;
      if (got.leashed === 'gaveway') throw failed(got);
      if (got.leashed && got.leashed !== 'long') { if (several) narrowC.add(novelId); throw failed(got); }
      const fault = got.leashed === 'long' ? 'words' : await archivist.whoseFault(conn, got, { beforeAsk: choice.beforeAsk });
      if (fault !== 'words') throw failed(fault === 'model' ? archivist.passingFrom(got) : fault);
      if (several) { narrowC.add(novelId); const e = failed(got); e.soon = true; throw e; }
      const a = [...asked.values()][0];
      const key = `${a.pid}:${a.vid}:${a.sig}`;
      const n = (stuckC.get(key) || 0) + 1;
      stuckC.set(key, n);
      if (n < 2) throw failed({ error: got.error });
      stuckC.delete(key);
      if (gradeOnly) noGrade(a); else setAsideCheck(novelId, chapter.id, a, got.error, conn);
      await store.flush('chapter', chapter.id);
      tell(novelId);
      return;
    }
    if (!gradeOnly) edits.push(...got.obj.edits);
    if (Array.isArray(got.obj.grades)) grades.push(...got.obj.grades);
    if (judge && numbered.length > 1) for (const [ref, a] of asked) {
      if (words.includes(`[${ref}]`) && !(Array.isArray(got.obj.grades) ? got.obj.grades : []).some((g) => g && refOf(g.passage, keys) === ref && gradeAnswers(g).complete)) incompleteParts.add(a.pid);
    }
  }
  /* each passage's grade, from all it was answered (a passage read in parts: every part) */
  const byPassage = new Map();
  const gather = (list) => {
    for (const g of list) {
      if (!g || typeof g !== 'object') continue;
      const ref = refOf(g.passage, keys);
      const a = ref ? asked.get(ref) : null;
      if (!a) continue;
      if (!byPassage.has(a.pid)) byPassage.set(a.pid, { a, list: [] });
      byPassage.get(a.pid).list.push(g);
    }
  };
  /* a passage whose grades could not be asked for again just now: graded on a later look */
  const gradeLater = new Set();
  if (judge) {
    gather(grades);
    /* a passage the answer gave no grade: asked once more for its grades alone (S06-G6) — never for one read in parts */
    const missing = numbered.length === 1 && !gradeOnly ? [...asked.values()].filter((a) => !byPassage.has(a.pid) || !judged(a, byPassage.get(a.pid).list, judge)) : [];
    if (missing.length && choice.current() && judgeOf(store.peek('house', 'house') || {})) {
      const passages = batch.passages.filter((p) => missing.some((a) => a.pid === p.id));
      const again = await archivist.askJson(conn, system, request(numberedText(novel, chapter, passages), { gradesOnly: true }), { want: (o) => Array.isArray(o.grades), beforeAsk: choice.beforeAsk });
      await archivist.mustHold('checker', novelId);
      /* answered and still no grade: its model will not grade it — checked, never asked in a loop */
      if (again.ok) gather(again.obj.grades);
      else for (const a of missing) gradeLater.add(a.pid);
    }
  }
  /* what he left as it is (as the chapter stands now) is not offered for that passage again */
  const now = store.peek('chapter', chapter.id) || chapter;
  const wasLeft = (a, find, replace) => ((now.checksLeft && now.checksLeft[a.pid]) || []).some((l) => l.find === find && l.replace === replace);
  for (const e of edits) {
    if (!e || typeof e !== 'object') continue;
    const ref = refOf(e.passage, keys);
    const a = ref ? asked.get(ref) : null;
    if (!a) continue;
    if (typeof e.find !== 'string' || typeof e.replace !== 'string') continue;
    const spot = locate(a.text, e.find);
    if (spot.why) continue;
    const find = a.text.slice(spot.start, spot.end);
    if (find === e.replace || find.replace(/\s+/g, ' ').trim() === e.replace.replace(/\s+/g, ' ').trim()) continue;
    /* two fixes over the same words: the first stands */
    if (a.items.some((x) => overlaps(x, spot)) || wasLeft(a, find, e.replace)) continue;
    const kind = CHECK_KINDS.includes(String(e.kind || '').toLowerCase()) ? String(e.kind).toLowerCase() : 'humanize';
    a.items.push({ id: newId('sg'), kind, find, replace: e.replace, why: clean(e.why), start: spot.start, end: spot.end });
  }
  if (!gradeOnly) for (const a of asked.values()) foundHere(a, avoid, (find) => wasLeft(a, find, null));
  const graded = new Map();
  if (judge) {
    for (const { a, list } of byPassage.values()) {
      if (incompleteParts.has(a.pid)) continue;
      const grade = judged(a, list, judge);
      if (grade) graded.set(a.pid, grade);
    }
  }
  const at = Date.now();
  if (gradeOnly) {
    for (const a of asked.values()) {
      const old = keptOf(a);
      /* changed while it was graded: its new words are checked as new */
      if (!old || old.sig !== a.sig) continue;
      const grade = graded.get(a.pid) || null;
      if (!grade) { noGrade(a); continue; }
      const items = (old.items || []).filter((x) => x.kind !== 'grade');
      if (grade.overall < judge.target) items.unshift({ id: newId('sg'), kind: 'grade', find: '', replace: null, why: '', lift: grade.lift || '', target: judge.target, grade });
      const { graded: _g, tries: _t, ...rest } = old;
      store.change('chapter', chapter.id, chapterSteps.setCheck(a.pid, a.vid, { ...rest, items, grade }), { checkpoint: true });
    }
    await store.flush('chapter', chapter.id);
    tell(novelId);
    return;
  }
  for (const a of asked.values()) {
    a.items.sort((x, y) => x.start - y.start);
    const items = a.items.map(({ start, end, ...rest }) => rest);
    const grade = graded.get(a.pid) || null;
    /* under his mark: a suggestion of its own, to write it again toward it — or leave it */
    if (grade && judge && grade.overall < judge.target) items.unshift({ id: newId('sg'), kind: 'grade', find: '', replace: null, why: '', lift: grade.lift || '', target: judge.target, grade });
    /* where the passage stands now (moved while it was checked: there; taken out: nowhere) */
    const home = homeOf(novelId, chapter.id, a.pid);
    if (!home) continue;
    /* no grade, its asking again stopped by a fault: checked again on a later look (twice at most), never counted judged */
    const ungraded = judge && !grade && gradeLater.has(a.pid) ? { graded: false, tries: a.tries + 1 } : {};
    store.change('chapter', home, chapterSteps.setCheck(a.pid, a.vid, { round: newId('ck'), sig: a.sig, at, items, ...(grade ? { grade } : {}), ...ungraded }), { checkpoint: true });
  }
  await store.flush('chapter', chapter.id);
  tell(novelId);
}

/* ------------------------------------------------------------ his answer */

function where(chapterId, passageId) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && (chapter.passages || []).find((x) => x.id === passageId);
  if (!p) return { why: 'that passage is not there any more' };
  const v = picked(p);
  if (!v || v.streaming) return { why: 'that passage is being written just now' };
  const e = entryFor(chapter, p);
  if (!e) return { why: 'the passage has changed since it was checked' };
  return { chapter, p, v, e };
}

/* the new words, kept: on the version this checking made, when it is the
 * one on the page — or as a new version, the words before one arrow away */
/* The sentences the app finds itself, to be written again — a word on his list it let through, stock wording
 * counted, a stray of another script — in words as they stand (a.text), around what is found there already
 * (a.items, with their places): where a fix takes in the very words, the fix takes them away; where a fix only
 * shares the sentence, the sentence waits, and is found again in the words the fix makes (keepWords). `left`:
 * a sentence he left as it is for this passage. */
function foundHere(a, avoid, left) {
  /* a word he never wants: its sentence offered to be written again (every such word of that sentence named) */
  for (const w of avoid) {
    for (const hit of avoidedIn(a.text, w)) {
      const s = sentenceAround(a.text, hit.start, hit.end);
      /* (one of its own for the same sentence — never a fix that came back for it, which holds no list of words: 2.6.1 stopped on that) */
      const same = a.items.find((x) => x.kind === 'avoid' && x.replace === null && x.start === s.start && x.end === s.end);
      if (same) { if (!same.phrases.includes(w)) same.phrases.push(w); continue; }
      const sentence = a.text.slice(s.start, s.end);
      if (a.items.some((x) => overlaps(x, hit) || overlaps(x, s)) || left(sentence)) continue;
      a.items.push({ id: newId('sg'), kind: 'avoid', find: sentence, replace: null, phrase: w, phrases: [w], start: s.start, end: s.end });
    }
  }
  for (const x of a.items) if (x.kind === 'avoid' && x.replace === null) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} on your list of words to avoid`;
  /* stock wording counted that no fix here takes away: its sentence offered to be written again, the same way */
  for (const hit of a.stock) {
    if (a.items.some((x) => overlaps(x, hit))) continue;
    const s = sentenceAround(a.text, hit.start, hit.end);
    const same = a.items.find((x) => x.stock && x.start === s.start && x.end === s.end);
    if (same) { if (!same.phrases.includes(hit.words)) same.phrases.push(hit.words); continue; }
    const sentence = a.text.slice(s.start, s.end);
    if (a.items.some((x) => overlaps(x, s)) || left(sentence)) continue;
    a.items.push({ id: newId('sg'), kind: 'humanize', find: sentence, replace: null, stock: true, phrases: [hit.words], start: s.start, end: s.end });
  }
  for (const x of a.items) if (x.stock) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} stock wording — far more common in machine-made fiction than in books people write`;
  /* a stray of another script no fix here takes out: its sentence offered to be written again (Cozy Tavern M119) */
  for (const hit of a.strays) {
    if (a.items.some((x) => overlaps(x, hit))) continue;
    const s = sentenceAround(a.text, hit.start, hit.end);
    const sentence = a.text.slice(s.start, s.end);
    if (a.items.some((x) => overlaps(x, s)) || left(sentence)) continue;
    a.items.push({ id: newId('sg'), kind: 'grammar', find: sentence, replace: null, stray: true, phrases: [a.text.slice(hit.start, hit.end)], why: 'a stray character of another script stands here', start: s.start, end: s.end });
  }
}
const ownFind = (x) => x.replace === null && (x.kind === 'avoid' || x.stock || x.stray);

/* what still waits on words a fix made: the fixes not put in, where they stand in them, and the app's own
 * sentences found again in them (foundHere) — a word on his list in a sentence a fix shared is offered now,
 * never left standing unsaid because a fix stood beside it; one found again keeps its card */
function stillWaiting(w, next, rest) {
  const house = store.peek('house', 'house') || {};
  const placed = [];
  const loose = [];
  for (const x of rest) {
    if (ownFind(x)) continue;
    const spot = x.kind === 'grade' || !x.find ? { why: 'none' } : locate(next, x.find);
    if (spot.why) loose.push(x); else placed.push({ ...x, start: spot.start, end: spot.end });
  }
  const a = { text: next, items: placed, stock: stockIn(next, { not: askWords(w.v) }), strays: straysIn(next) };
  const leftHere = (w.chapter.checksLeft && w.chapter.checksLeft[w.p.id]) || [];
  foundHere(a, avoidList(house), (find) => leftHere.some((l) => l.find === find && l.replace === null));
  const before = rest.filter(ownFind);
  const found = a.items.sort((x, y) => x.start - y.start).map(({ start, end, ...x }) => {
    const was = ownFind(x) ? before.find((o) => o.find === x.find && o.kind === x.kind) : null;
    return was ? { ...x, id: was.id } : x;
  });
  return [...loose.filter((x) => x.kind === 'grade'), ...found, ...loose.filter((x) => x.kind !== 'grade')];
}

/* the grade a checking gave goes with the words its fixes made (through 2.6.2 it was lost — the score, the average
 * and the judge's box gone the moment a fix went in): what still waits for a grade waits on them too */
const gradeKept = (e) => ({ ...(e.grade ? { grade: e.grade } : {}), ...(e.graded === false ? { graded: false, tries: e.tries || 0 } : {}) });

/* a version the fixes made before 2.6.3 kept no grade: the grade of the version it was made from, where that
 * still reads as it did, is put back on it — no model asked (on opening a book, and before each look) */
export function keepGrades(novelId) {
  let n = 0;
  for (const c of chaptersOf(novelId)) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      const e = v && entryFor(c, p);
      if (!e || e.grade || e.graded === false || e.aside || v.how !== 'suggested') continue;
      let from = v;
      let grade = null;
      for (let hop = 0; hop < 20 && from && from.how === 'suggested' && from.from && !grade; hop++) {
        from = (p.versions || []).find((x) => x.id === from.from);
        const fe = from && c.checks && c.checks[p.id] && c.checks[p.id][from.id];
        if (fe && fe.sig === sigOf(from) && fe.grade) grade = fe.grade;
      }
      if (!grade) continue;
      store.change('chapter', c.id, chapterSteps.setCheck(p.id, v.id, { ...e, grade }), { now: true });
      n++;
    }
  }
  if (n) tell(novelId);
  return n;
}

function keepWords(novelId, w, next, rest) {
  const { chapter, p, v, e } = w;
  const sig = hashText(next);
  const entry = { round: e.round, sig, at: Date.now(), items: stillWaiting(w, next, rest), ...gradeKept(e) };
  if (v.how === 'suggested' && v.round === e.round) {
    /* the helper had read these words: it is told what they were */
    archivist.retireIfSeen(novelId, chapter.id, p.id, v.id);
    store.change('chapter', chapter.id, chapterSteps.setVersion(p.id, v.id, { text: next, words: countWords(next) }), { now: true });
    store.change('chapter', chapter.id, chapterSteps.setCheck(p.id, v.id, entry), { now: true });
  } else {
    /* words fixed in place: where the version stops goes with them (cut short, stopped — its Go on stays: Tavern M511-1) */
    const version = newVersion({ text: next, how: 'suggested', round: e.round, from: v.id, words: countWords(next), ...(v.ask ? { ask: v.ask } : {}), ...endOf(v), ...rootOf(v), ...keptTail(v), ...writtenWith(v) });
    store.change('chapter', chapter.id, chapterSteps.addVersion(p.id, version), { now: true });
    store.change('chapter', chapter.id, chapterSteps.setCheck(p.id, version.id, entry), { now: true });
  }
  store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  recount(novelId);
  archivist.nudge(novelId, 8000);
}

/* ------------------------------------------------------------ head to head */

/* Versions of one passage made for the same moment by the same request —
 * written and taken again, a scene told as prose again, or written again with
 * the same note — each by the model that wrote it whole (never one carried on
 * by another, or one he or the checker changed). */
function momentOf(v) {
  const ask = (v && v.ask) || {};
  if (v.how === 'write' || v.how === 'another') return 'w' + JSON.stringify([ask.direction || '', ask.length || '']);
  if (v.how === 'play' && ask.transcript) return 'p' + hashText(JSON.stringify(ask.transcript));
  if (v.how === 'rewrite') return 'r' + JSON.stringify([v.from || '', ask.note || '']);
  return '';
}
const duelable = (v) => Boolean(v && !v.streaming && !v.cut && !v.carried && v.model && String(v.text || '').trim() && momentOf(v));
const duelKey = (pid, a, b) => `${pid}:${[a, b].sort().join('|')}`;
/* pairs that could not be judged just now: not asked again until the app starts again */
const duelTried = new Set();

/* The pairs waiting for the judge: for the version on show, the newest
 * version by each other writer made for the same moment. Each pair is read
 * once, and only when the later of the two was written since the judge began
 * reading takes head to head (house.duelsFrom): takes from before are never
 * sent unasked. */
const madeAt = (v) => v.done || v.at || 0;
export function duelsDue(novelId) {
  const house = store.peek('house', 'house') || {};
  const from = Number.isFinite(house.duelsFrom) ? house.duelsFrom : 0;
  const out = [];
  for (const c of chaptersOf(novelId)) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (!duelable(v)) continue;
      const m = momentOf(v);
      const seen = new Set([v.model]);
      for (let i = (p.versions || []).length - 1; i >= 0; i--) {
        const u = p.versions[i];
        if (u.id === v.id || !duelable(u) || seen.has(u.model) || momentOf(u) !== m) continue;
        seen.add(u.model);
        if (Math.max(madeAt(v), madeAt(u)) < from) continue;
        const key = duelKey(p.id, v.id, u.id);
        const tryKey = `${key}:${[v, u].sort((a, b) => a.id.localeCompare(b.id)).map(sigOf).join(':')}`;
        if (duelMatches(p, c.duels && c.duels[key]) || duelTried.has(tryKey)) continue;
        out.push({ chapterId: c.id, pid: p.id, x: v.id, y: u.id, key, tryKey });
      }
    }
  }
  return out;
}

/* never one page much longer than the other: a judge leans to the longer
 * (EQ-Bench cuts its pages to one length) — the longer is shown only as far
 * as a little past the shorter, at a paragraph's end */
function evenUp(x, y) {
  const wx = countWords(x);
  const wy = countWords(y);
  const short = Math.min(wx, wy);
  if (!short || Math.max(wx, wy) <= short * 1.3) return { x, y, cut: false };
  const cap = Math.ceil(short * 1.15);
  const trim = (t) => {
    const first = archivist.partsOf(t, cap)[0] || t;
    if (countWords(first) <= cap * 1.3) return first;
    /* one long paragraph: cut at the end of a sentence */
    let out = '';
    for (const s of t.match(/[^.!?…]+(?:[.!?…]+["”’)\]]*\s*|$)/g) || [t]) { if (out && countWords(out + s) > cap) break; out += s; }
    return out.trim();
  };
  const tx = wx > wy ? trim(x) : x;
  const ty = wy > wx ? trim(y) : y;
  return { x: tx, y: ty, cut: tx.length < x.length || ty.length < y.length };
}

/* what he asked for that moment, for the judge */
function askedOf(v) {
  const ask = (v && v.ask) || {};
  if (v.how === 'rewrite') return ask.note ? `Written again, with my note: ${ask.note}` : '';
  if (v.how === 'play') return '';
  return String(ask.direction || '');
}

/* One pair read head to head, blind and both ways round (Cozy Tavern's
 * duel): a win only when both readings agree, a tie otherwise. Kept on the
 * chapter while both versions are there. */
async function duel(novelId, conn, d, choice) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', d.chapterId);
  const p = chapter && (chapter.passages || []).find((x) => x.id === d.pid);
  const vx = p && (p.versions || []).find((v) => v.id === d.x);
  const vy = p && (p.versions || []).find((v) => v.id === d.y);
  if (!novel || !vx || !vy) return null;
  const snapshot = { pid: p.id, x: vx.id, y: vy.id, xSig: sigOf(vx), ySig: sigOf(vy), xModel: vx.model, yModel: vy.model };
  const currentPair = () => {
    const n = store.peek('novel', novelId), c = store.peek('chapter', chapter.id);
    const live = c && (c.passages || []).find((x) => x.id === p.id);
    return Boolean(n && (n.order || []).includes(chapter.id) && duelMatches(live, snapshot) && !(live.versions || []).some((v) => (v.id === snapshot.x || v.id === snapshot.y) && v.streaming));
  };
  const pages = evenUp(String(vx.text || ''), String(vy.text || ''));
  /* the notes as everyone reads them, fitted to its model (S06-G3, M262) */
  const view = namedBook(standingNotes(novel), house);
  const notesFit = archivist.notesRoomOf(conn);
  const system = checkerFrame(house, view);
  const lead = storyBefore(novel, chapter, p.id);
  const label = chapterLabel(novel, chapter);
  const his = hisWords(house);
  let story = { text: '', left: 0 };
  /* the passages before this one the notes have not read, or never will (set aside) — as the checker is told */
  const behind = notesBehind(view, Object.fromEntries(chaptersOf(novelId).map((c) => [c.id, c])), chapter, { before: p.id }, 'write');
  const build = (first, second, before) => duelRequest({ novel: view, chapterLabel: label, before, beforeFrom: lead.from, asked: askedOf(vx), first, second, cut: pages.cut, his, sofar: story.text, left: story.left, notesFit, behind });
  const spare = archivist.readingRoom(conn, estimateTokens(system) + estimateTokens(build(pages.x, pages.y, '')));
  /* two pages that do not fit beside the notes are not read */
  if (spare < 0) return null;
  const before = tailOf(lead.text, Math.max(0, Math.min(lead.from === 'last' ? 2500 : 6000, Math.floor(spare * 0.4 * 3.5))));
  story = storySoFar(novel, chapter.id, Math.max(0, Math.min(4000, Math.floor(spare * 0.3))));
  /* the page it names, however it names it: "A", "A.", "Page A", "a (the first)" (Cozy Tavern M439) */
  const said = (o) => { const text = String(o.better || ''); const m = /^\s*(?:page\s+)?([AB])(?![\p{L}\p{N}])/iu.exec(text); return m ? m[1].toUpperCase() : /^\s*(?:same|tie|equal)(?![\p{L}\p{N}])/iu.test(text) ? 'same' : ''; };
  /* a pair its model would not read for the pages' own words is let go — never a stop for the checker (S06-G2); only the connection's own fault is */
  const stopOf = async (got) => { if (got.leashed === 'gaveway') return { gaveWay: true }; if (got.leashed) return null; const f = await archivist.whoseFault(conn, got, { beforeAsk: choice.beforeAsk }); return f && typeof f === 'object' ? { stop: failed(f) } : null; };
  const one = await archivist.askJson(conn, system, build(pages.x, pages.y, before), { want: (o) => typeof o.better === 'string' && Boolean(said(o)), beforeAsk: choice.beforeAsk });
  if (!one.ok) return stopOf(one);
  choice.beforeAsk();
  if (!judgeOf(store.peek('house', 'house') || {}) || !currentPair()) return { changed: true };
  const two = await archivist.askJson(conn, system, build(pages.y, pages.x, before), { want: (o) => typeof o.better === 'string' && Boolean(said(o)), beforeAsk: choice.beforeAsk });
  if (!two.ok) return stopOf(two);
  const first = said(one.obj) === 'A' ? 'x' : said(one.obj) === 'B' ? 'y' : 'tie';
  const second = said(two.obj) === 'A' ? 'y' : said(two.obj) === 'B' ? 'x' : 'tie';
  const winner = first === second ? first : 'tie';
  await archivist.mustHold('checker', novelId);
  if (!currentPair()) return { changed: true };
  const row = { ...snapshot, winner, why: clean(winner === 'tie' ? '' : first === winner ? one.obj.why : two.obj.why, 300), at: Date.now() };
  store.change('chapter', chapter.id, chapterSteps.setDuel(d.key, row), { checkpoint: true });
  await store.flush('chapter', chapter.id);
  tell(novelId);
  return row;
}

/* a few pairs at a time (the rest in a moment); a pair that could not be read
 * is not asked again in a loop, and a connection turned away for good stops
 * the checker as any refusal does */
async function runDuels(novelId, conn, choice) {
  let n = 0;
  for (const d of duelsDue(novelId)) {
    choice.beforeAsk();
    if (!judgeOf(store.peek('house', 'house') || {})) return;
    if (writerBusy(novelId)) { schedule(novelId, 4000); return; }
    if (n >= 3) { schedule(novelId, 3000); return; }
    n++;
    duelTried.add(d.tryKey);
    const chapter = store.peek('chapter', d.chapterId);
    const novel = store.peek('novel', novelId);
    setState(novelId, 'checking', `Reading two versions of ${chapter && novel ? `${chapterLabel(novel, chapter, { withName: false })}, passage ${passageNumbers(chapter).get(d.pid)}` : 'a passage'} side by side…`);
    let out;
    try { out = await duel(novelId, conn, d, choice); }
    catch (error) { if (error && error.checkerChanged) duelTried.delete(d.tryKey); throw error; }
    if (out && out.changed) { duelTried.delete(d.tryKey); schedule(novelId, 3000); return; }
    /* it made way for his page: read again once the page has gone */
    if (out && out.gaveWay) { duelTried.delete(d.tryKey); schedule(novelId, 20000); return; }
    if (out && out.stop) throw out.stop;
  }
}

/* ------------------------------------------------------------ the benchmark */

/* stock wording counted in a version, kept for it while its words stay */
const stockSeen = new WeakMap();
function stockCount(v) {
  const t = String((v && v.text) || '');
  const was = stockSeen.get(v);
  if (was && was.text === t) return was.n;
  /* never a kind of stock wording his own words for it asked for (Cozy Tavern M355) */
  const n = stockIn(t, { not: askWords(v) }).length;
  if (v && typeof v === 'object') stockSeen.set(v, { text: t, n });
  return n;
}
/* whose words a version is, for the benchmark: the model that wrote it whole,
 * or his own (nothing wrote it but him) — never a mix (carried on by another
 * writer, changed by him, the checker or his partner, rewritten in part), nor
 * what was brought in from a file */
const MIXED = ['suggested', 'partner', 'edit', 'selection', 'imported'];
function authorOf(v) {
  if (!v || v.streaming || v.carried || MIXED.includes(v.how)) return '';
  return v.model || 'your own words';
}

/* The benchmark: which writer writes best, by this judge, over the book as it
 * reads now — for each writer its passages graded and their average, the
 * stock wording counted in every thousand of its words (no judge needed: a
 * count), and its wins, losses and ties head to head; which checks the
 * book's passages fail most; and whether the judge is the very model it
 * grades (a judge leans to its own writing — Panickssery et al., arXiv
 * 2404.13076). */
export function gradesOf(novelId) {
  const house = store.peek('house', 'house') || {};
  const judgeConn = checkerConn(house);
  const judgeModel = (judgeConn && judgeConn.model) || '';
  const rows = [];
  const by = new Map();
  const row = (k) => { if (!by.has(k)) by.set(k, { model: k, n: 0, sum: 0, words: 0, stock: 0, win: 0, loss: 0, tie: 0 }); return by.get(k); };
  const fails = new Map();
  let duels = 0;
  for (const c of chaptersOf(novelId)) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      const who = authorOf(v);
      if (who) { const r = row(who); r.words += countWords(v.text); r.stock += stockCount(v); }
      const e = entryFor(c, p);
      /* (a grade from before the ten checks, 2.4.1–2.4.2, was one number on another scale: its
       * card still shows, but it is not averaged with these) */
      if (!e || !e.grade || !Number.isFinite(e.grade.overall) || !e.grade.of) continue;
      /* every grade counts for the book; a writer's row holds only what that writer wrote whole */
      rows.push({ chapterId: c.id, passageId: p.id, ...e.grade });
      if (who) { const r = row(who); r.n++; r.sum += e.grade.overall; }
      /* a "no" whose words were not on the page is not counted here either */
      for (const f of e.grade.faults || []) if (!f.unverified) fails.set(f.check, (fails.get(f.check) || 0) + 1);
    }
    for (const d of Object.values(c.duels || {})) {
      if (!d || !d.xModel || !d.yModel) continue;
      if (!duelMatches((c.passages || []).find((p) => p.id === d.pid), d)) continue;
      duels++;
      const a = row(d.xModel);
      const b = row(d.yModel);
      if (d.winner === 'x') { a.win++; b.loss++; } else if (d.winner === 'y') { b.win++; a.loss++; } else { a.tie++; b.tie++; }
    }
  }
  const models = [...by.values()].map((r) => ({
    model: r.model, n: r.n, average: r.n ? Math.round((r.sum / r.n) * 10) / 10 : null,
    words: r.words, stock: r.stock, per1000: r.words ? Math.round((r.stock / r.words) * 10000) / 10 : null,
    win: r.win, loss: r.loss, tie: r.tie, self: Boolean(judgeModel) && r.model === judgeModel,
  })).sort((a, b) => ((b.average === null ? -1 : b.average) - (a.average === null ? -1 : a.average)) || ((b.win - b.loss) - (a.win - a.loss)) || (b.words - a.words));
  return {
    rows, models, duels,
    fails: JUDGE_CHECKS.map(([k, name]) => ({ check: k, name, n: fails.get(k) || 0 })).filter((x) => x.n).sort((a, b) => b.n - a.n),
  };
}

/* one suggestion, applied. {ok} or {ok: false, said} */
export function applyOne(novelId, chapterId, passageId, itemId) {
  const w = where(chapterId, passageId);
  if (w.why) return { ok: false, said: w.why };
  const item = (w.e.items || []).find((x) => x.id === itemId);
  if (!item) return { ok: false, said: 'that suggestion is not there any more' };
  if (typeof item.replace !== 'string') return { ok: false, said: 'it has no words to put in — write the sentence again instead' };
  const text = String(w.v.text || '');
  const spot = locate(text, item.find);
  if (spot.why) {
    /* (another fix applied first can leave these words standing twice) */
    leaveOne(chapterId, passageId, itemId, { remember: false });
    return { ok: false, said: /more than one place/.test(spot.why) ? 'those words stand in more than one place now' : 'those words are not there any more' };
  }
  const next = text.slice(0, spot.start) + item.replace + text.slice(spot.end);
  keepWords(novelId, w, next, w.e.items.filter((x) => x.id !== itemId));
  tell(novelId);
  return { ok: true };
}

/* HOW MUCH A FIX MAY CHANGE BY ITSELF (Cozy Tavern M259, M275): a mend is
 * small. Put in without him, no fix rewrites a large stretch or cuts much
 * away, and all of them together never change more than half the passage,
 * leave it shorter than 85% of what it was, or lose its ending — whatever is
 * bigger waits behind the bubble for him. */
/* by the words changed (Cozy Tavern M275: by lines, a comma fixed in each of
 * two paragraphs read as half the passage rewritten) */
export function changeShare(a, b) {
  const words = (t) => String(t || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wa = words(a); const wb = words(b);
  const pool = new Map();
  for (const x of wb) pool.set(x, (pool.get(x) || 0) + 1);
  let kept = 0;
  for (const x of wa) { const c = pool.get(x) || 0; if (c > 0) { kept += 1; pool.set(x, c - 1); } }
  return 1 - kept / Math.max(wa.length, wb.length, 1);
}
export function smallMend(before, after) {
  const b = String(before || ''); const a = String(after || '');
  if (Math.abs(a.length - b.length) > Math.max(40, b.length * 0.5) || changeShare(b, a) > 0.5) return false;
  /* never shorter by more than a few words and a sixth of them (by characters, a doubled word taken out of a short passage was "cut much away") */
  const wb = countWords(b);
  if (wb - countWords(a) > Math.max(3, wb * 0.15)) return false;
  const lines = (t) => t.trim().split('\n');
  const lostEnding = lines(a).length < lines(b).length && !a.includes(b.trim().slice(-60).trim()) && lines(a).slice(-1)[0] !== lines(b).slice(-1)[0];
  if (lostEnding) return false;
  /* and no paragraph written anew whole: each keeps more than half its words */
  const pb = lines(b);
  const pa = lines(a);
  if (pa.length === pb.length && pb.some((x, i) => x.trim() && changeShare(x, pa[i]) > 0.5)) return false;
  return true;
}
const smallFix = (item, text) => item.find.length <= Math.max(400, text.length * 0.4) && !(item.find.length > 120 && item.replace.length < item.find.length * 0.5);

/* every suggestion of a passage that has words to put in, applied at once */
function applyPassage(novelId, chapterId, passageId, { byItself = false } = {}) {
  const w = where(chapterId, passageId);
  if (w.why) return 0;
  /* every fix found in the words as they stood when they were checked, and
   * all put in at once — never one on words the fix before it changed (two
   * fixes that swap words would undo each other, Cozy Tavern G2); one that
   * cannot go in beside the others stays offered, never dropped unseen */
  const text = String(w.v.text || '');
  const rest = [];
  const spots = [];
  for (const item of w.e.items || []) {
    if (typeof item.replace !== 'string') { rest.push(item); continue; }
    /* by itself: only a small fix — and never one that holds the page to
     * the notes (a fact the notes say may be the notes' slip, Cozy Tavern
     * M447/M448): continuity waits for him; the rest wait if large */
    if (byItself && (item.kind === 'continuity' || !smallFix(item, text))) { rest.push(item); continue; }
    const spot = locate(text, item.find);
    if (spot.why || spots.some((s) => overlaps(s, spot))) { rest.push(item); continue; }
    spots.push({ ...spot, item });
  }
  if (!spots.length) return 0;
  let next = text;
  for (const s of [...spots].sort((a, b) => b.start - a.start)) next = next.slice(0, s.start) + s.item.replace + next.slice(s.end);
  /* by itself, all of them together are a small mend too, or none goes in */
  if (byItself && !smallMend(text, next)) return 0;
  keepWords(novelId, w, next, rest);
  return spots.length;
}

/* all of them — in one chapter, or the whole book: how many were applied */
export function applyAll(novelId, chapterId = null) {
  const seen = new Set();
  let made = 0;
  for (const s of suggestions(novelId)) {
    if (chapterId && s.chapterId !== chapterId) continue;
    const key = s.chapterId + '/' + s.passageId;
    if (seen.has(key)) continue;
    seen.add(key);
    made += applyPassage(novelId, s.chapterId, s.passageId);
  }
  tell(novelId);
  return made;
}

/* left as it is — and not offered for this passage again (remember: false
 * only takes it off: one that could not be applied) */
export function leaveOne(chapterId, passageId, itemId, { remember = true } = {}) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && (chapter.passages || []).find((x) => x.id === passageId);
  const v = p && picked(p);
  if (!v) return;
  /* (no earlier copy of the chapter for it: its words are as they were) */
  store.change('chapter', chapterId, chapterSteps.dropSuggestion(passageId, v.id, itemId, { remember }), { now: true, checkpoint: true });
  tell(chapter.novelId);
}

/* where a suggestion's words stand now, for showing them or writing them again */
export function spotOf(chapterId, passageId, item) {
  const w = where(chapterId, passageId);
  if (w.why) return null;
  const spot = locate(String(w.v.text || ''), item.find);
  return spot.why ? null : spot;
}

/* the older passages too: a chapter, or every chapter */
export function checkChapter(novelId, chapterId) {
  store.change('chapter', chapterId, chapterSteps.checkAll(), { now: true, checkpoint: true });
  schedule(novelId, 300);
}
export function checkBook(novelId) {
  for (const c of chaptersOf(novelId)) store.change('chapter', c.id, chapterSteps.checkAll(), { now: true, checkpoint: true });
  schedule(novelId, 300);
}

/* ------------------------------------------------------------ by itself */

/* What he switched on to happen by itself (Settings → Who does what), each
 * from when he switched it on: passages written before are never changed by
 * themselves. null when off. */
export function autoOf(house) {
  const on = (x) => (x && x.on && Number.isFinite(x.from) ? x.from : null);
  return { fix: on(house && house.autoFix), lift: on(house && house.autoLift) };
}
/* what happens by itself happens to his own words too, once he switches it on (his word, 15 October:
 * "automatically change my word — my own writing is ok too"): a passage under his mark is written again
 * whoever wrote it — the writer, his partner, or he himself — twice at most; every version stays one
 * arrow away */
export const MAX_LIFTS = 2;
const liftsOf = (p) => (p.versions || []).filter((v) => v.lift);
const liftTried = new Set();
/* written after he switched it on — by the version it came from: a fix or a rewrite of older words is as old as
 * they are, and words brought in were written before, whenever they came */
const since = (v, from) => howOf(v) !== 'imported' && bornOf(v) >= from;
/* a sentence to write again — his word to avoid, stock wording, a stray of another script — that no fix took
 * away: with the fixes going in by themselves, written again by itself too, one at a time, twice at most for a
 * passage; each once for the words it was found in, and one that failed for a real reason never again */
export const MAX_SPANS = 2;
const spansOf = (p) => (p.versions || []).filter((v) => v.spanAuto);
const spanTried = new Set();
/* A temporary writing failure is not a completed attempt. Keep its own
 * backoff: successful proofreading must not reset the writer's wait. */
const autoFailures = new Map();
function automaticWait(novelId) {
  const a = autoOf(store.peek('house', 'house') || {});
  const f = autoFailures.get(novelId);
  return (a.fix !== null || a.lift !== null) && f && f.until > Date.now() ? f : null;
}
function afterAutomatic(novelId, tried, key, out) {
  if (!out || out.ok) { if (out && out.ok) autoFailures.delete(novelId); return out; }
  if (out.passing || out.busy || out.needsConnection) tried.delete(key);
  if (out.passing && store.peek('novel', novelId)) {
    const n = ((autoFailures.get(novelId) || {}).n || 0) + 1;
    const ms = Math.max([60000, 180000, 600000][Math.min(n - 1, 2)], Number(out.retryAfterMs) || 0);
    autoFailures.set(novelId, { n, until: Date.now() + ms });
    schedule(novelId, ms);
  } else if (out.busy) schedule(novelId, 4000);
  return out;
}
/* what the writer is told for a sentence to write again — the same by his button (Suggestions → Write it again) and by itself */
export function spanNote(item) {
  const words = quoted(Array.isArray(item.phrases) && item.phrases.length ? item.phrases : item.phrase ? [item.phrase] : []);
  return item.stock ? `Write it again without ${words} — say it the way this book would.` : `Write it again without ${words}.`;
}
/* the passages open in his edit box: nothing goes in by itself under his hand (Cozy Tavern M429) */
const editingNow = new Set();
export function setEditing(passageId, on) { if (on) editingNow.add(passageId); else editingNow.delete(passageId); }
/* under his mark only for being untrue to the book: the notes may be what is wrong — never written again by itself (Cozy Tavern M447) */
const onlyCanon = (g) => { const held = (g.faults || []).filter((f) => !f.unverified); return held.length > 0 && held.every((f) => f.check === 'canon'); };
const lifting = new Map();
const checkOf = (c, p, v) => { const e = c.checks && c.checks[p.id] && c.checks[p.id][v.id]; return e && e.sig === sigOf(v) ? e : null; };

/* After each look at the book, passage by passage, one rule so the two never
 * cross:
 *  - under his mark, with "Write it again by itself" on: the writer writes the
 *    passage again toward the mark, with what the judge said it needs — twice
 *    at most for a passage; its fixes wait (they were for the words it
 *    replaces). After the second try is graded, the best-graded of the tries
 *    and the version they came from stays on show, once (a version he picks
 *    afterwards is his). "Leave it" on its grade stops it.
 *  - otherwise, with "Apply the fixes by themselves" on: every small fix
 *    with words to put in goes in, one new version for the checking (Apply
 *    all, for that passage); then a sentence to write again that is left on
 *    it (a word on his list, stock wording, a stray of another script) is
 *    written again by itself, one at a time, twice at most for a passage.
 *    A slip against the notes, and a fix too large, wait for him.
 * His own words too, once he switched it on (his word, 2.6.2).
 * One writing at a time, only while the writer is free; anything he asks the
 * writer meanwhile goes first (writer.js yieldAuto). */
function autoAfter(novelId) {
  const house = store.peek('house', 'house') || {};
  const a = autoOf(house);
  if (a.fix === null && a.lift === null) return;
  const waiting = autoFailures.get(novelId);
  if (waiting && waiting.until > Date.now()) { schedule(novelId, waiting.until - Date.now()); return; }
  const judge = judgeOf(house);
  const stands = standsNow(house);
  let next = null;
  for (const c of chaptersOf(novelId)) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      let v = picked(p);
      /* never by itself on a page cut short or stopped: it waits for its Go on (Cozy Tavern M552) — nor under his hand in the edit box,
       * nor on a version he put on show himself (the arrows, or the one on show removed): his choice stands, its suggestions wait for him */
      if (!v || v.streaming || v.cut || v.chosen || editingNow.has(p.id)) continue;
      let e = checkOf(c, p, v);
      if (!e) continue;
      if (a.lift !== null && judge) {
        /* the last try graded: the best of the tries stays on show */
        if (v.lift >= MAX_LIFTS && !v.settled) {
          const lifts = liftsOf(p);
          const first = lifts.find((x) => x.lift === 1);
          const pool = [...lifts, ...(first && first.from ? (p.versions || []).filter((x) => x.id === first.from) : [])];
          let best = v;
          let bestGrade = e.grade ? e.grade.overall : -1;
          for (const x of pool) {
            const g = (checkOf(c, p, x) || {}).grade;
            if (g && Number.isFinite(g.overall) && g.overall > bestGrade) { best = x; bestGrade = g.overall; }
          }
          store.change('chapter', c.id, chapterSteps.setVersion(p.id, v.id, { settled: true }), { now: true });
          if (best.id !== v.id) {
            store.change('chapter', c.id, chapterSteps.pick(p.id, best.id), { now: true });
            archivist.nudge(novelId);
            const now = store.peek('chapter', c.id);
            const np = now && (now.passages || []).find((x) => x.id === p.id);
            v = np ? picked(np) : best;
            e = checkOf(now || c, np || p, v);
            if (!e) continue;
          }
        }
        const g = e.grade;
        const card = (e.items || []).find((x) => x.kind === 'grade');
        const under = g && g.of && g.overall < judge.target && card;
        if (under && since(v, a.lift) && liftsOf(p).length < MAX_LIFTS && !liftTried.has(v.id) && !v.liftFailed && !onlyCanon(g) && (card.lift || g.lift)) {
          if (!next) next = { chapterId: c.id, passageId: p.id, v, note: card.lift || g.lift, lift: liftsOf(p).length + 1 };
          /* its fixes wait for the passage written again */
          continue;
        }
      }
      if (a.fix !== null && since(v, a.fix)) {
        if ((e.items || []).some((x) => typeof x.replace === 'string') && applyPassage(novelId, c.id, p.id, { byItself: true })) {
          /* the version the fixes made, with what still waits on it */
          const now = store.peek('chapter', c.id);
          const np = now && (now.passages || []).find((x) => x.id === p.id);
          v = np ? picked(np) : null;
          e = v ? checkOf(now, np, v) : null;
          if (!e) continue;
        }
        const span = (e.items || []).find((x) => x.replace === null && x.kind !== 'grade' && x.find && stands(x) && !spanTried.has(`${v.id}|${x.find}`) && !(v.spanFailed || []).includes(x.find));
        const cur = ((store.peek('chapter', c.id) || c).passages || []).find((x) => x.id === p.id) || p;
        if (span && !next && spansOf(cur).length < MAX_SPANS) next = { span: true, chapterId: c.id, passageId: p.id, v, item: span };
      }
    }
  }
  if (next && next.span && !writerBusy(novelId) && !lifting.has(novelId)) {
    const key = `${next.v.id}|${next.item.find}`;
    spanTried.add(key);
    const spot = locate(String(next.v.text || ''), next.item.find);
    if (!spot.why) {
      const job = writeSpanAgain({ novelId, chapterId: next.chapterId, passageId: next.passageId, start: spot.start, end: spot.end, note: spanNote(next.item), fromVersion: next.v, auto: true })
        .then((out) => {
          if (out && out.ok) archivist.nudge(novelId);
          /* failed for a real reason: kept on the version, never tried by itself again */
          else if (out && !out.stopped && !out.yielded && !out.passing && !out.busy && !out.needsConnection) {
            try { store.change('chapter', next.chapterId, chapterSteps.setVersion(next.passageId, next.v.id, { spanFailed: [...(next.v.spanFailed || []), next.item.find] }), { now: true }); } catch (_) { /* the chapter is gone */ }
          }
          return out;
        })
        .catch((err) => ({ ok: false, error: String((err && err.message) || err) }))
        .then((out) => afterAutomatic(novelId, spanTried, key, out))
        .finally(() => lifting.delete(novelId));
      lifting.set(novelId, job);
    }
  } else if (next && !next.span && !writerBusy(novelId) && !lifting.has(novelId)) {
    liftTried.add(next.v.id);
    const job = writeAgain({ novelId, chapterId: next.chapterId, passageId: next.passageId, note: next.note, fromVersion: next.v, lift: next.lift })
      .then((out) => {
        if (out && out.ok) archivist.nudge(novelId);
        /* failed for a real reason: kept on the version, never tried by itself again, and said on its grade (S11-G6) */
        else if (out && !out.stopped && !out.yielded && !out.passing && !out.busy && !out.needsConnection) {
          try { store.change('chapter', next.chapterId, chapterSteps.setVersion(next.passageId, next.v.id, { liftFailed: { at: Date.now(), why: cutWords(out.error || 'no words came', 200) } }), { now: true }); } catch (_) { /* the chapter is gone */ }
        }
        return out;
      })
      .catch((err) => ({ ok: false, error: String((err && err.message) || err) }))
      .then((out) => afterAutomatic(novelId, liftTried, next.v.id, out))
      .finally(() => lifting.delete(novelId));
    lifting.set(novelId, job);
  }
  tell(novelId);
}

export function forTests() { return { states, failures, blocked, timers, lifting, autoAfter, running: runningFor, narrow: narrowC, liftTried, spanTried }; }
