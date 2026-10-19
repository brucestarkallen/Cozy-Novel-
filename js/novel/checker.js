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
import { picked, passageNumbers, chapterLabel, chapterNumber, chapterSteps, novelSteps, howOf, bornOf, chapterText, duelMatches, writtenOf, mixedHands, autoBaseOf, hasWords, chapterClosed } from './shape.js';
import { changeInPlace } from './inplace.js';
import { numberedText, shortOf, notesBehind, passagesAfter } from './context.js';
import { bibItems, ridingItems } from './bibliography.js';
import { superOn, superFrom, autoOf } from './auto.js';
import { checkerFrame, checkRequest, wholeRequest, marksRequest, proofRequest, duelRequest, avoidList, avoidLine, lateFor, CHECK_KINDS, JUDGE_CHECKS, macroNames, withMacros, standingNotes, namedBook } from './prompts.js';
import { locate, chapterNumber as chapterNum } from './changes.js';
import { findIn } from './search.js';
import { stockIn, repeatsIn } from './stock.js';
import { straysIn, markupAt, unmarked, speechFaults, changeSpan, uniqueAround, marksOnlyResult, speechMarks, pairWalk, spacingSlips } from './textshape.js';
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
  /* (Super automatic checks whatever he set here: auto.js) */
  if (roles.checker === 'off' && !superOn(house)) return null;
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
 * now — any page of the book, in either mode (2.12.38); words brought in
 * from a file only in a chapter he asked to have checked */
/* checked, but with no grade on the ten checks (never one it would not give: graded false) */
const needsGrade = (e) => Boolean(e) && !e.aside && e.graded !== false && !(e.grade && Number.isFinite(e.grade.overall) && e.grade.of);

/* WHEN CHECKING BEGAN HERE: Settings' own start (set when the house was made, and again when he chooses a checker
 * after Nobody: settings.js) — or, with Nobody chosen and Super automatic checking for him, when Super automatic was
 * switched on. What is new since goes first (nextBatch); writing from before is checked by itself after it, in either
 * mode (2.12.38) */
export function checksFromOf(house) {
  const from = house && house.checksFrom;
  const roles = (house && house.roles) || {};
  const all = roles.checker === 'off' ? superFrom(house) : null;
  if (all === null) return from;
  return Number.isFinite(from) ? Math.max(from, all) : all;
}

function wanted(house, chapter, p) {
  if (p.by === 'break') return false;
  const v = picked(p);
  if (!v || v.streaming || !String(v.text || '').trim()) return false;
  const e = entryFor(chapter, p);
  /* an answer that gave it no grade: graded again on a later look, twice at most (S06-G6) — and one checked
   * with no grade (the judge was off, or its grade is from before the ten checks) graded by itself once the judge
   * is on, in either mode: its grade alone is asked for, what it found kept (2.12.38 — his word: "manual doesn't
   * mean that something is not automatic and self heal"; before, only once he asked for the chapter) */
  if (e) {
    if (!judgeOf(house)) return false;
    if (e.graded === false) return (e.tries || 0) < 2;
    return needsGrade(e);
  }
  if (chapter.checkAll) return true;
  /* by itself, only a finished page: one cut short or stopped waits for its Go on (Cozy Tavern M552) */
  if (v.cut) return false;
  if (howOf(v) === 'imported') return false;
  /* every page of the book, in either mode — written before checking began too, and words changed since they were
   * checked (his word, 18 October: "make it like Grammarly that fixes everything"; and 19 October: manual decides
   * what goes in, never whether the book is looked at — 2.12.38); the newest first (nextBatch). What its fixes do is
   * the mode's: with Super automatic they go in by themselves, else they wait for him (autoOf) */
  return true;
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
  /* checked, never graded — with the judge on, graded by itself, in either mode (2.12.38: waiting() counts them; in a chapter he asked for, they wait their turn) */
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
/* a page that stopped partway: checked once Go on finishes it — never "older writing" (S11-G11); any page, in either
 * mode (every page is checked: an old one too, once Go on finishes it — 2.12.35, and with Super automatic off 2.12.38) */
function waitsForGoOn(house, v) {
  return Boolean(v && v.cut && howOf(v) !== 'imported');
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
  const toGo = waiting(novelId);
  if (toGo) return { state: 'waiting', words: toGo > 3 ? `${plural(toGo, 'passage')} to check — the newest first, a few at a time.` : 'The newest words are checked in a moment.', count };
  /* green says only what is true: words brought in from a file, never sent
   * unasked, are not called checked; a page that stopped partway waits for its
   * Go on; one its model would not check is said */
  /* (a passage checked but not graded is graded by itself once the judge is on — waiting() counts it, never a task for him: 2.12.38) */
  const { passages: older } = unchecked(novelId);
  const cut = cutWaiting(novelId);
  const aside = setAsideList(novelId).length;
  const asideSaid = aside ? `${aside === 1 ? 'One passage' : plural(aside, 'passage')} its model would not check — in Suggestions, with Check it again.` : '';
  if (count) return { state: 'found', words: [`${plural(count, 'suggestion')} to look at.`, asideSaid].filter(Boolean).join(' '), count };
  const more = [
    cut ? `${cut === 1 ? 'A passage that stopped partway is' : `${plural(cut, 'passage')} that stopped partway are`} checked once Go on finishes ${cut === 1 ? 'it' : 'them'}.` : '',
    asideSaid,
    /* (every page is checked by itself, in either mode: what waits for him is only words brought in from a file) */
    older ? `${plural(older, 'passage')} brought in from a file ${older === 1 ? 'is' : 'are'} checked only when you ask.` : '',
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
  const from = checksFromOf(house);
  /* what is new first — written since checking began, words changed since they were checked, a chapter he asked for —
   * and only then the book's older pages (2.12.35; in either mode since 2.12.38): a backlog never holds up the newest page */
  const isNew = (c, p) => { const v = picked(p); return Boolean(c.checkAll) || Boolean(c.checks && c.checks[p.id] && c.checks[p.id][v.id]) || (Number.isFinite(from) && bornOf(v) >= from); };
  for (const older of [false, true]) for (const c of chaptersOf(novelId)) {
    const list = [];
    let words = 0;
    /* passages checked already, wanted for their grade alone, go in a checking of their own */
    let gradeOnly = null;
    for (const p of c.passages || []) {
      if (!wanted(house, c, p) || (!older && !isNew(c, p))) continue;
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
        /* (by its words too: a version keeps its id as its words change on the page, 2.12.2) */
        const asking = batch.passages.map((p) => `${picked(p).id}:${sigOf(picked(p))}`).join(',');
        if (asking === lastAsked) break;
        /* a whole long book: the rest in a moment, a run at a time */
        if (n >= 60) { schedule(novelId, 2000); break; }
        lastAsked = asking;
        setState(novelId, 'checking', `Checking ${batch.label}…`);
        await checkBatch(novelId, conn, batch, limit, choice);
      }
      choice.beforeAsk();
      /* every checked passage proofread once for slips alone — the ones checked before this was here too */
      await runProof(novelId, conn, choice);
      choice.beforeAsk();
      /* the speech marks of every checked passage: found on what was found in it, and set by the marks' mender */
      await runMarks(novelId, conn, choice);
      choice.beforeAsk();
      /* what goes in by itself goes in first: the chapter is read whole as it will stand, never on words a fix found
       * this look is about to change (2.12.35, the audit: both went in together — "red" made "blue" in one passage, and
       * "blue" made "red" in the next on the old words) */
      autoAfter(novelId);
      choice.beforeAsk();
      /* each chapter read whole once its passages are checked, for what disagrees across it */
      await runWhole(novelId, conn, choice);
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

/* WHAT A FIX HOLDS TO (2.12.33): a fix to the book's continuity, or a seam, quotes the words of the story before it
 * that it holds to ("says", prompts.js SAYS_RULE) — found in its own passage before the words it changes, or in the
 * passages before that one, nearest first, that passage's chapter and then the chapters before it, it is `held` (the
 * words as they stand there, and where: `heldAt`): it holds the page to the book itself, not to the notes, and may go in
 * by itself as any small fix (waitsForHim) — while those words still stand there. Words it quotes that are not there
 * are kept as `unheld`, and it waits for him. A few words at least: four.
 * (2.12.35, the audit: the quick look compared the page's letters as typed, so "Siobhán" never held a quote of
 * "Siobhan", and the fix waited with a reason that was not true; a quote of its own passage was never found; and on a
 * book of 300,000 words each fix whose quote was not there folded every page before it again.) */
const SAYS_MIN = 4;
const lightSeen = new WeakMap();
/* the words as the quick look reads them: small letters, accents and the marks no one sees let go (search.js fold's way) */
const lightFold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f\u00ad\u200b-\u200d\u2060\ufeff*_]/g, '');
function lightOf(v) {
  const t = String((v && v.text) || '');
  const was = v && lightSeen.get(v);
  if (was && was.t === t) return was.light;
  const light = lightFold(t);
  if (v) lightSeen.set(v, { t, light });
  return light;
}
function heldBy(novelId, chapterId, pid, says, before = '') {
  const want = clean(says, 1200);
  if (countWords(want) < SAYS_MIN) return null;
  const list = chaptersOf(novelId);
  const at = list.findIndex((c) => c.id === chapterId);
  if (at < 0) return null;
  /* a quick look first, by its longest word: most passages never hold it */
  const key = (lightFold(want).match(/[\p{L}\p{N}]+/gu) || []).sort((a, b) => b.length - a.length)[0] || '';
  const quick = key.length >= 4;
  const own = String(before || '');
  if (own.trim() && (!quick || lightFold(own).includes(key))) {
    const [hit] = findIn(own, want, { words: true, max: 1 });
    if (hit) return { held: cutWords(own.slice(hit.start, hit.end), 600), at: { chapterId, passageId: pid } };
  }
  for (let i = at; i >= 0; i--) {
    const ps = list[i].passages || [];
    const end = i === at ? ps.findIndex((p) => p.id === pid) : ps.length;
    if (end < 0) return null;
    for (let j = end - 1; j >= 0; j--) {
      if (ps[j].by === 'break') continue;
      const v = picked(ps[j]);
      const t = String((v || {}).text || '');
      if (!t || (quick && !lightOf(v).includes(key))) continue;
      const [hit] = findIn(t, want, { words: true, max: 1 });
      if (hit) return { held: cutWords(t.slice(hit.start, hit.end), 600), at: { chapterId: list[i].id, passageId: ps[j].id } };
    }
  }
  return null;
}
/* a passage that opens after a scene break: the jump in time or place is marked there — a seam fix of its opening waits
 * for him (2.12.35, the audit: the chapter read whole was sent without its breaks, and could add a transition at each) */
function afterBreak(chapter, pid) {
  const ps = (chapter && chapter.passages) || [];
  for (let i = ps.findIndex((p) => p.id === pid) - 1; i >= 0; i--) {
    if (ps[i].by === 'break') return true;
    if (hasWords(ps[i])) return false;
  }
  return false;
}
function saysOf(novelId, chapterId, pid, kind, says, before = '') {
  const brk = kind === 'seam' && afterBreak(store.peek('chapter', chapterId), pid) ? { afterBreak: true } : {};
  if ((kind !== 'continuity' && kind !== 'seam') || typeof says !== 'string' || !says.trim()) return brk;
  const h = heldBy(novelId, chapterId, pid, says, before);
  return { ...brk, ...(h ? { held: h.held, heldAt: h.at } : { unheld: clean(says, 300) }) };
}
/* the words a fix holds to, still where they were found (2.12.35, the audit: a fix held to words another fix changed in
 * the same look went in by itself all the same — "red cup" made "blue" in one passage, and "blue" made "red" in the next
 * on the strength of the old words) */
function holdStands(novelId, item) {
  if (!item.held || !item.heldAt) return true;
  const home = homeOf(novelId, item.heldAt.chapterId, item.heldAt.passageId);
  const c = home && store.peek('chapter', home);
  const p = c && (c.passages || []).find((x) => x.id === item.heldAt.passageId);
  const t = String(((p && picked(p)) || {}).text || '');
  return Boolean(t.trim()) && findIn(t, item.held, { words: true, max: 1 }).length > 0;
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
    asked.set(`${ci}.${nums.get(p.id)}`, { pid: p.id, vid: v.id, text, sig: sigOf(v), model: v.model || '', cut: Boolean(v.cut), items: [], stock: stockIn(text, { not: ask }), strays: straysIn(text), repeats: repeatsIn(text, priorOf(p)), marks: marksOf(text, Boolean(v.cut)), ask, tries: ((entryFor(chapter, p) || {}).tries || 0) });
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
    budget: Math.max(0, Math.min(2500, Math.floor(spare * 0.2))), skip: passagesAfter(novel, inHand, chapter.id, { before: batch.passages[0].id }, 'write'), byPage: superOn(house) }).words.join('\n\n');
  const edits = [];
  const grades = [];
  const incompleteParts = new Set();
  const judge = judgeOf(house);
  const request = (words, extra = {}) => {
    const stock = {};
    const strays = {};
    const repeats = {};
    const marks = {};
    for (const [n, a] of asked) {
      /* the paragraphs whose speech marks do not pair, as they stand in this request (2.12.34) */
      /* (a long paragraph by the place it goes wrong: the whole of it is in the passage above) */
      const unpaired = (a.marks || []).filter((f) => words.includes(f.line.slice(0, 120))).map((f) => (f.line.length > 400 && f.near ? `…${f.near}…` : f.line)).slice(0, 4);
      if (unpaired.length) marks[n] = unpaired;
      const here = [...new Set(a.stock.map((h) => h.words))].filter((w) => words.includes(w)).slice(0, 8);
      if (here.length) stock[n] = here;
      const off = a.strays.filter((h) => words.includes(a.text.slice(h.start, h.end))).map((h) => h.words).slice(0, 4);
      if (off.length) strays[n] = off;
      const again = (a.repeats || []).map((h) => h.words).filter((w) => words.includes(w)).slice(0, 4);
      if (again.length) repeats[n] = again;
    }
    return checkRequest({ novel: view, chapterLabel: chapterLabel(novel, chapter), numbered: words, avoid, before, beforeFrom: lead.from, judge, stock, strays, repeats, marks, his, sofar: story.text, left: story.left, notesFit, asked: askedOf(words), behind, bib, ...extra });
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
  /* asked again and answered, still with no grade: its model will not grade it — marked so (graded false, as the
   * grades alone mark it, noGrade), since one checked with no grade is graded by itself on a later look (2.12.38) */
  const wontGrade = new Set();
  if (judge) {
    gather(grades);
    /* a passage the answer gave no grade: asked once more for its grades alone (S06-G6) — never for one read in parts */
    const missing = numbered.length === 1 && !gradeOnly ? [...asked.values()].filter((a) => !byPassage.has(a.pid) || !judged(a, byPassage.get(a.pid).list, judge)) : [];
    if (missing.length && choice.current() && judgeOf(store.peek('house', 'house') || {})) {
      const passages = batch.passages.filter((p) => missing.some((a) => a.pid === p.id));
      const again = await archivist.askJson(conn, system, request(numberedText(novel, chapter, passages), { gradesOnly: true }), { want: (o) => Array.isArray(o.grades), beforeAsk: choice.beforeAsk });
      await archivist.mustHold('checker', novelId);
      /* answered and still no grade: its model will not grade it — checked, never asked in a loop */
      if (again.ok) { gather(again.obj.grades); for (const a of missing) wontGrade.add(a.pid); }
      else for (const a of missing) gradeLater.add(a.pid);
    }
  }
  /* what he left as it is (as the chapter stands now) is not offered for that passage again */
  const now = store.peek('chapter', chapter.id) || chapter;
  const leftFor = new Map([...asked.values()].map((a) => [a.pid, leftTest((now.checksLeft && now.checksLeft[a.pid]) || [])]));
  const wasLeft = (a, find, replace) => leftFor.get(a.pid)(find, replace);
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
    a.items.push({ id: newId('sg'), kind, find, replace: e.replace, why: clean(e.why), ...saysOf(novelId, chapter.id, a.pid, kind, e.says, a.text.slice(0, spot.start)), start: spot.start, end: spot.end });
  }
  if (!gradeOnly) for (const a of asked.values()) foundHere(a, avoid, leftFor.get(a.pid), { cut: a.cut });
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
    const ungraded = judge && !grade && gradeLater.has(a.pid) ? { graded: false, tries: a.tries + 1 } : judge && !grade && wontGrade.has(a.pid) ? { graded: false, tries: 2 } : {};
    /* (read in parts: its chapter, if it is the whole of one, is read whole too — wholeWanted) */
    store.change('chapter', home, chapterSteps.setCheck(a.pid, a.vid, { round: newId('ck'), sig: a.sig, at, items, ...(grade ? { grade } : {}), ...ungraded, ...(numbered.length > 1 ? { parts: numbered.length } : {}) }), { checkpoint: true });
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

/* WHAT HE LEFT AS IT IS, ASKED ONE WAY EVERYWHERE (2.12.35, the audit: each finder asked in words of its own, and two
 * asked for what Leave it never records — a markup fix he left was looked for as its sentence with no fix, and came
 * back; a fix the marks' mender made was looked for as its paragraph, so a card came back and the mender was asked
 * again at every look): the same words with the same fix — and for the speech marks of a paragraph, whose fix is
 * made fresh each time, any fix of them he left (`marks`) that stands inside its words. */
function leftTest(list) {
  const left = Array.isArray(list) ? list : [];
  const marksLeft = left.filter((l) => l && (l.marks || (typeof l.replace === 'string' && l.replace !== l.find && Boolean(marksOnlyResult(l.find, l.replace)))));
  /* (the marks of a paragraph: a fix of them he left, where it stands in the words — over the paragraph's own place,
   * {text, start, end} — or, with no words to look in, the one's words inside the other's) */
  const overParagraph = (l, find, { text = null, start = -1, end = -1 }) => {
    if (typeof text === 'string' && start >= 0) { const at = text.indexOf(l.find); return at >= 0 && at < end && at + l.find.length > start; }
    return String(find).includes(l.find) || String(l.find).includes(String(find));
  };
  return (find, replace = null, { marks = false, ...where } = {}) => left.some((l) => l && l.find === find && l.replace === replace)
    || (marks && marksLeft.some((l) => overParagraph(l, find, where)));
}

/* the new words, kept: on the version this checking made, when it is the
 * one on the page — or as a new version, the words before one arrow away */
/* The sentences the app finds itself, to be written again — a word on his list it let through, stock wording
 * counted, a stray of another script — in words as they stand (a.text), around what is found there already
 * (a.items, with their places): where a fix takes in the very words, the fix takes them away; where a fix only
 * shares the sentence, the sentence waits, and is found again in the words the fix makes (keepWords). `left`
 * (leftTest): what he left as it is for this passage. Each find stands in one place in the words — a sentence that
 * stands twice takes a few words around it (2.12.35, the audit: its card could not be written again, nor put in).
 * `cut`: the passage stopped partway — its last paragraph is not finished, and is never offered a fix of its marks or
 * its spaces (Go on finishes it). */
function foundHere(a, avoid, left, { cut = false } = {}) {
  const spotOf = (s) => uniqueAround(a.text, s.start, s.end);
  /* a word he never wants: its sentence offered to be written again (every such word of that sentence named) */
  for (const w of avoid) {
    for (const hit of avoidedIn(a.text, w)) {
      const s = spotOf(sentenceAround(a.text, hit.start, hit.end));
      /* (one of its own for the same sentence — never a fix that came back for it, which holds no list of words: 2.6.1 stopped on that) */
      const same = a.items.find((x) => x.kind === 'avoid' && x.replace === null && x.start === s.start && x.end === s.end);
      if (same) { if (!same.phrases.includes(w)) same.phrases.push(w); continue; }
      if (a.items.some((x) => overlaps(x, hit) || overlaps(x, s)) || left(s.find)) continue;
      a.items.push({ id: newId('sg'), kind: 'avoid', find: s.find, replace: null, phrase: w, phrases: [w], start: s.start, end: s.end });
    }
  }
  for (const x of a.items) if (x.kind === 'avoid' && x.replace === null) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} on your list of words to avoid`;
  /* stock wording counted that no fix here takes away: its sentence offered to be written again, the same way */
  for (const hit of a.stock) {
    const s = spotOf(sentenceAround(a.text, hit.start, hit.end));
    /* (a second stock wording in a sentence already offered is named on its card — looked for first: the card itself overlaps it) */
    const same = a.items.find((x) => x.stock && x.start === s.start && x.end === s.end);
    if (same) { if (!same.phrases.includes(hit.words)) same.phrases.push(hit.words); continue; }
    if (a.items.some((x) => overlaps(x, hit))) continue;
    if (a.items.some((x) => overlaps(x, s)) || left(s.find)) continue;
    a.items.push({ id: newId('sg'), kind: 'humanize', find: s.find, replace: null, stock: true, phrases: [hit.words], start: s.start, end: s.end });
  }
  for (const x of a.items) if (x.stock) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} stock wording — far more common in machine-made fiction than in books people write`;
  /* a stray of another script no fix here takes out: its sentence offered to be written again (Cozy Tavern M119) */
  for (const hit of a.strays) {
    if (a.items.some((x) => overlaps(x, hit))) continue;
    const s = spotOf(sentenceAround(a.text, hit.start, hit.end));
    if (a.items.some((x) => overlaps(x, s)) || left(s.find)) continue;
    a.items.push({ id: newId('sg'), kind: 'grammar', find: s.find, replace: null, stray: true, phrases: [a.text.slice(hit.start, hit.end)], why: 'a stray character of another script stands here', start: s.start, end: s.end });
  }
  /* a web page's or code's markup in the story ("…paid for.</code>", his report 2.12.2): the sentence as it reads
   * without it — the fix is known, no model asked, so it is put in by itself when he lets fixes go in by themselves */
  for (const hit of markupAt(a.text)) {
    const s = spotOf(sentenceAround(a.text, hit.start, hit.end));
    const same = a.items.find((x) => x.markup && x.start === s.start && x.end === s.end);
    if (same) { if (!same.phrases.includes(hit.words)) same.phrases.push(hit.words); continue; }
    if (a.items.some((x) => overlaps(x, hit))) continue;
    const bare = unmarked(s.find);
    if (bare === s.find || a.items.some((x) => overlaps(x, s)) || left(s.find, bare)) continue;
    a.items.push({ id: newId('sg'), kind: 'grammar', find: s.find, replace: bare, markup: true, phrases: [hit.words], start: s.start, end: s.end });
  }
  for (const x of a.items) if (x.markup) x.why = `web page or code markup (${quoted(x.phrases, 'and')}) stands in the story`;
  marksHere(a, left, { cut });
  slipsHere(a, left, { cut });
}
/* SPACES A SLIP OF THE HAND LEFT OUT OR PUT IN (textshape.js spacingSlips, 2.12.35): the fix is known — white space
 * only — so no model is asked, and it goes in by itself as any small fix; slips a few letters apart are one fix */
const slipsSeen = new Map();
function slipsOf(text, cut = false) {
  const t = String(text || '');
  const key = `${cut ? 'cut:' : ''}${hashText(t)}`;
  if (slipsSeen.has(key)) return slipsSeen.get(key);
  const out = spacingSlips(t, { leaveLast: cut });
  if (slipsSeen.size > 4000) slipsSeen.clear();
  slipsSeen.set(key, out);
  return out;
}
function slipsHere(a, left, { cut = false } = {}) {
  const groups = [];
  for (const x of slipsOf(a.text, cut)) {
    const g = groups[groups.length - 1];
    if (g && x.at - g.end <= 6) { g.list.push(x); g.end = Math.max(g.end, x.at + x.del); } else groups.push({ start: x.at, end: x.at + x.del, list: [x] });
  }
  for (const g of groups) {
    let seg = a.text.slice(g.start, g.end);
    for (const x of [...g.list].sort((p, q) => q.at - p.at)) seg = seg.slice(0, x.at - g.start) + x.ins + seg.slice(x.at - g.start + x.del);
    const c = changeSpan(a.text, g.start, g.end, seg);
    const spot = { start: c.start, end: c.end };
    if (a.items.some((x) => x.start !== undefined && overlaps(x, spot)) || left(c.find, c.replace)) continue;
    a.items.push({ id: newId('sg'), kind: 'grammar', find: c.find, replace: c.replace, slip: true, why: [...new Set(g.list.map((x) => x.why))].join('; '), start: c.start, end: c.end });
  }
}
/* SPEECH MARKS THAT DO NOT PAIR (Cozy Tavern M753, 2.12.34 — his page: `"Tck. Tck. "You did not look…`): each
 * paragraph of the words whose quotation marks do not pair, that no fix here takes in. Where one mark accounts for it
 * (textshape.js pairSpeech), the fix is known — no model asked, put in by itself as any small fix; where only a reading
 * can say where the quote belongs, the paragraph waits for the marks' mender (runMarks), and failing that is offered
 * to be written again. */
const MARKS_SET = 'its speech marks do not pair — the quotation marks set right, every word as it is';
const MARKS_LEFT = 'a quotation mark is left out or one too many stands here, so speech and narration run together';
const marksSeen = new Map();
function marksOf(text, cut = false) {
  const t = String(text || '');
  const key = `${cut ? 'cut:' : ''}${hashText(t)}`;
  if (marksSeen.has(key)) return marksSeen.get(key);
  const out = speechFaults(t, { leaveLast: cut });
  if (marksSeen.size > 4000) marksSeen.clear();
  marksSeen.set(key, out);
  return out;
}
/* (a paragraph that waits for the mender keeps its own words, `line`, for the mender, and where they stand in its
 * find, `lineAt`: the find takes a few words around them where the paragraph stands twice) */
function marksHere(a, left, { cut = false } = {}) {
  for (const f of marksOf(a.text, cut)) {
    const spot = { start: f.start, end: f.end };
    if (a.items.some((x) => x.start !== undefined && overlaps(x, spot))) continue;
    if (f.mended) {
      const c = changeSpan(a.text, f.start, f.end, f.mended);
      if (left(c.find, c.replace, { marks: true, text: a.text, start: f.start, end: f.end })) continue;
      a.items.push({ id: newId('sg'), kind: 'grammar', find: c.find, replace: c.replace, marks: true, why: MARKS_SET, start: c.start, end: c.end });
    } else {
      const u = uniqueAround(a.text, f.start, f.end);
      if (left(u.find, null, { marks: true, text: a.text, start: f.start, end: f.end })) continue;
      a.items.push({ id: newId('sg'), kind: 'grammar', find: u.find, replace: null, marks: true, goesOn: f.goesOn, ...(f.carried ? { carried: f.carried } : {}), ...(u.find !== f.line ? { line: f.line, lineAt: f.start - u.start } : {}), phrases: f.near ? [f.near] : [], why: MARKS_LEFT, start: u.start, end: u.end });
    }
  }
}
const ownFind = (x) => x.replace === null && (x.kind === 'avoid' || x.stock || x.stray || x.marks);
/* what the app finds itself, fix and all, found again in new words each time (foundHere) — never kept on words it no
 * longer stands in */
const foundAgain = (x) => ownFind(x) || Boolean(x.slip || x.markup || (x.marks && typeof x.replace === 'string'));

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
    /* (what the app found itself, no longer standing in the words: found again in them, or gone — 2.12.35, the audit:
     * kept loose, it stood beside the one found again, and a card more came at every look) */
    if (spot.why) { if (!foundAgain(x)) loose.push(x); } else placed.push({ ...x, start: spot.start, end: spot.end });
  }
  const a = { text: next, items: placed, stock: stockIn(next, { not: askWords(w.v) }), strays: straysIn(next) };
  foundHere(a, avoidList(house), leftTest((w.chapter.checksLeft && w.chapter.checksLeft[w.p.id]) || []), { cut: Boolean(w.v.cut) });
  const before = rest.filter(ownFind);
  const found = a.items.sort((x, y) => x.start - y.start).map(({ start, end, ...x }) => {
    const was = ownFind(x) ? before.find((o) => o.find === x.find && o.kind === x.kind && Boolean(o.marks) === Boolean(x.marks)) : null;
    /* (and a paragraph the marks' mender was asked about once, for these very words, is not asked again) */
    return was ? { ...x, id: was.id, ...(was.asked ? { asked: was.asked } : {}) } : x;
  });
  const twice = (x) => found.some((f) => f.kind === x.kind && f.find === x.find && f.replace === x.replace);
  return [...loose.filter((x) => x.kind === 'grade'), ...found, ...loose.filter((x) => x.kind !== 'grade' && !twice(x))];
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

/* THE FIXES GO IN ON THE PAGE ITSELF (his word, 2.12.2: "Grammarly always
 * change directly the page … rewrite is the only thing who create new
 * version"): the version on show takes them — where it stops goes with it
 * (cut short, stopped: its Go on stays, Tavern M511-1), the words before
 * are kept on it (⋯ → Put back the words before), and what still waits is
 * found in the new words. Through 2.12.1 each checking's fixes made a
 * version of their own. {before, after, versionId} or null. */
function keepWords(novelId, w, next, rest, { auto = false } = {}) {
  const { chapter, p, v, e } = w;
  const sig = hashText(next);
  /* (words its own fixes made were proofread with the words they came from: never asked again for them) */
  const entry = { round: e.round, sig, at: Date.now(), items: stillWaiting(w, next, rest), ...gradeKept(e), ...(e.proofed ? { proofed: true } : {}), ...(e.parts ? { parts: e.parts } : {}) };
  const made = changeInPlace({ novelId, chapterId: chapter.id, passageId: p.id, versionId: v.id, next, by: 'checker', check: entry, extra: auto ? { auto: true } : {} });
  if (!made) return null;
  recount(novelId);
  archivist.nudge(novelId, 8000);
  return made;
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
/* head to head reads each writer's own words (shape.js writtenOf): a fix put in since, or his edit, is not the writer's */
const duelable = (v) => Boolean(v && !v.streaming && !v.cut && !v.carried && v.model && writtenOf(v).trim() && momentOf(v));
const writtenSig = (v) => hashText(writtenOf(v));
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
        const tryKey = `${key}:${[v, u].sort((a, b) => a.id.localeCompare(b.id)).map(writtenSig).join(':')}`;
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
  const snapshot = { pid: p.id, x: vx.id, y: vy.id, xSig: writtenSig(vx), ySig: writtenSig(vy), xModel: vx.model, yModel: vy.model };
  const currentPair = () => {
    const n = store.peek('novel', novelId), c = store.peek('chapter', chapter.id);
    const live = c && (c.passages || []).find((x) => x.id === p.id);
    return Boolean(n && (n.order || []).includes(chapter.id) && duelMatches(live, snapshot) && !(live.versions || []).some((v) => (v.id === snapshot.x || v.id === snapshot.y) && v.streaming));
  };
  const pages = evenUp(writtenOf(vx), writtenOf(vy));
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

/* ------------------------------------------------------------ the proofreading */

/* THE PROOFREADING (2.12.35 — his pages: "…whether keeping it wassentiment or discipline…", "…from bruised to ash,
 * She looked at him…", "even as anything", each under a green light, each found at once by his partner when he asked
 * it only that). A checking asks for nine things at once — grammar, clarity, machine-made wording, his words to avoid,
 * continuity, seams, and the judge's ten checks — and a slip of the hand is the easiest of them to miss. So every
 * checked passage — those checked before this was here too — is read once more for slips alone (prompts.js
 * proofRequest), the places code sees as likely slips named to it ("ash, She", a doubled word). Each fix must be a
 * slip's size — a few letters, marks or words, never a sentence said another way (`slipSize`) — and is kept like any
 * other fix, put in by itself as any small fix; where a fix found already covers the same words, the slip is mended
 * inside it. Each version's words are read once (`proofed`, carried with the words its own fixes make); a passing fault
 * is waited out; the connection's own stops the checker. */
const PROOF_ASKS = 4;
const proofWait = new Map();
const proofPart = new Map(); /* `${passage}:${sig}:${limit}` -> {k, proofs}: a passage read in parts, stopped at part k */
export function slipSize(find, replace) {
  const f = String(find || '');
  const r = String(replace || '');
  let a = 0;
  while (a < f.length && a < r.length && f[a] === r[a]) a++;
  let b = 0;
  while (b < f.length - a && b < r.length - a && f[f.length - 1 - b] === r[r.length - 1 - b]) b++;
  /* the stretch that changed, out to whole words */
  while (a > 0 && /[\p{L}\p{N}]/u.test(f[a - 1])) a--;
  while (b > 0 && /[\p{L}\p{N}]/u.test(f[f.length - b])) b--;
  const was = f.slice(a, f.length - b);
  const now = r.slice(a, r.length - b);
  return Math.max(was.length, now.length) <= 40 && countWords(was) <= 3 && countWords(now) <= 4;
}
/* places code sees as likely slips, for the proofreader to read (never mended by code: only a reading can say) */
const SPLICE = /\p{Ll}, (?:She|He|They|It|We|You|The|His|Her|Their|There|Then|This|That|These|Those|But|And|So|Its|My|Our|Your)\b/gu;
function likelySlips(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(SPLICE)) out.push(t.slice(Math.max(0, m.index - 24), m.index + m[0].length + 16).replace(/^\S*\s/, '').replace(/\s\S*$/, ''));
  for (const m of t.matchAll(/(?<![\p{L}'’])(\p{L}+)\s+\1(?![\p{L}'’])/giu)) if (!/^(?:had|that|no|very|so|ha|bye|now|go|come|there|knock|tsk|tck|yes|well|oh|ah|my|run|again)$/i.test(m[1])) out.push(t.slice(Math.max(0, m.index - 16), m.index + m[0].length + 16).replace(/^\S*\s/, '').replace(/\s\S*$/, ''));
  return out.slice(0, 6);
}
/* (the newest chapter first: the page he is writing is proofread before the backlog of the book's older ones) */
function proofBatch(novelId, limit) {
  for (const c of chaptersOf(novelId).reverse()) {
    const list = [];
    let words = 0;
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      const e = v && entryFor(c, p);
      if (!e || e.aside || e.proofed || v.streaming || v.cut || !String(v.text || '').trim()) continue;
      const w = countWords(v.text);
      if (list.length && words + w > limit) break;
      list.push(p);
      words += w;
      if (w > limit) break;
    }
    if (list.length) return { chapterId: c.id, passages: list };
  }
  return null;
}
async function runProof(novelId, conn, choice) {
  const wait = proofWait.get(novelId);
  if (wait && wait.until > Date.now()) { schedule(novelId, wait.until - Date.now() + 500); return; }
  for (let asks = 0; ; asks++) {
    choice.beforeAsk();
    if (writerBusy(novelId)) { schedule(novelId, 4000); return; }
    const limit = batchWords(conn, store.peek('house', 'house') || {}, store.peek('novel', novelId));
    const batch = proofBatch(novelId, limit);
    if (!batch) return;
    if (asks >= PROOF_ASKS) { schedule(novelId, 3000); return; }
    const out = await proofRead(novelId, conn, batch, limit, choice);
    if (out && out.gaveWay) { schedule(novelId, 20000); return; }
    if (out && out.stop) throw out.stop;
    if (out && out.passing) return;
  }
}
async function proofRead(novelId, conn, batch, limit, choice) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', batch.chapterId);
  if (!novel || !chapter) return null;
  const view = namedBook(standingNotes(novel), house);
  const ci = chapterNumber(novel, chapter.id);
  const nums = passageNumbers(chapter);
  const label = chapterLabel(novel, chapter);
  const asked = new Map();
  for (const p of batch.passages) {
    const v = picked(p);
    asked.set(`${ci}.${nums.get(p.id)}`, { pid: p.id, vid: v.id, sig: sigOf(v), text: String(v.text || ''), items: [] });
  }
  const keys = new Set(asked.keys());
  const one = asked.size === 1 ? [...asked.entries()][0] : null;
  const numbered = one && countWords(one[1].text) > limit
    ? archivist.partsOf(one[1].text, limit).map((part) => `[${one[0]}] ${part}`)
    : [numberedText(novel, chapter, batch.passages)];
  const system = checkerFrame(house, view);
  const his = cutWords(hisWords(house), 8000);
  setState(novelId, 'checking', `Proofreading ${chapterLabel(novel, chapter, { withName: false })}, ${batch.passages.length === 1 ? `passage ${nums.get(batch.passages[0].id)}` : `passages ${nums.get(batch.passages[0].id)}–${nums.get(batch.passages[batch.passages.length - 1].id)}`}…`);
  /* a passage read in parts goes on at the part it stopped at, with what the parts before it found (as the chapter read
   * whole does: a fault on part 2 never throws part 1's slips away, nor pays for part 1 again) */
  const key = numbered.length > 1 ? `${one[1].pid}:${one[1].sig}:${limit}` : null;
  const was = key ? proofPart.get(key) : null;
  const proofs = was ? was.proofs.slice() : [];
  const settleAll = (fields) => {
    for (const a of asked.values()) {
      const home = homeOf(novelId, chapter.id, a.pid);
      const c = home && store.peek('chapter', home);
      const p = c && (c.passages || []).find((x) => x.id === a.pid);
      const v = p && picked(p);
      const e = v && v.id === a.vid && sigOf(v) === a.sig && c.checks && c.checks[a.pid] && c.checks[a.pid][a.vid];
      if (!e || e.sig !== a.sig) continue;
      store.change('chapter', home, chapterSteps.setCheck(a.pid, a.vid, { ...e, ...fields(a, e, c) }), { checkpoint: true });
    }
  };
  for (let k = was ? was.k : 0; k < numbered.length; k++) {
    const words = numbered[k];
    const hints = {};
    for (const [n, a] of asked) if (words.includes(`[${n}]`)) { const h = likelySlips(a.text).filter((x) => words.includes(x)); if (h.length) hints[n] = h; }
    const got = await archivist.askJson(conn, system, proofRequest({ novel: view, chapterLabel: label, numbered: words, his, hints }), { want: (o) => Array.isArray(o.edits), beforeAsk: choice.beforeAsk });
    await archivist.mustHold('checker', novelId);
    if (!got.ok) {
      if (key) { if (proofPart.size > 100) proofPart.clear(); proofPart.set(key, { k, proofs: proofs.slice() }); }
      if (got.leashed === 'gaveway') return { gaveWay: true };
      const fault = got.leashed === 'long' ? 'words' : got.leashed ? 'model' : await archivist.whoseFault(conn, got, { beforeAsk: choice.beforeAsk });
      if (fault && typeof fault === 'object') return { stop: failed(fault) };
      if (fault === 'words') {
        /* its model would not read these: a few passages are asked again one at a time (as the marks' mender is) — only
         * words it will not read alone are passed by, never asked in a loop, and what the parts before found is kept */
        if (batch.passages.length > 1) {
          for (const p of batch.passages) {
            choice.beforeAsk();
            if (writerBusy(novelId)) { schedule(novelId, 4000); return { passing: true }; }
            const out = await proofRead(novelId, conn, { chapterId: batch.chapterId, passages: [p] }, limit, choice);
            if (out && (out.gaveWay || out.stop || out.passing)) return out;
          }
          return { ok: true };
        }
        break;
      }
      const held = proofWait.get(novelId);
      const n = ((held && held.n) || 0) + 1;
      const ms = Math.max([60000, 180000, 600000][Math.min(n - 1, 2)], Number(got.retryAfterMs) || 0);
      proofWait.set(novelId, { n, until: Date.now() + ms });
      schedule(novelId, ms + 1000);
      return { passing: true };
    }
    proofs.push(...got.obj.edits);
  }
  if (key) proofPart.delete(key);
  proofWait.delete(novelId);
  for (const e of proofs) {
    if (!e || typeof e !== 'object' || typeof e.find !== 'string' || typeof e.replace !== 'string') continue;
    const ref = refOf(e.passage, keys);
    const a = ref ? asked.get(ref) : null;
    if (!a) continue;
    const spot = locate(a.text, e.find);
    if (spot.why) continue;
    const find = a.text.slice(spot.start, spot.end);
    if (find === e.replace || find.replace(/\s+/g, ' ').trim() === e.replace.replace(/\s+/g, ' ').trim() || !slipSize(find, e.replace)) continue;
    if (a.items.some((x) => overlaps(x, spot))) continue;
    a.items.push({ id: newId('sg'), kind: 'grammar', find, replace: e.replace, why: clean(e.why) || 'a slip of the hand', proof: true, start: spot.start, end: spot.end });
  }
  /* laid beside what was found in each passage: inside a fix found already over the same words, when its words still
   * hold the slip; never over one he left */
  settleAll((a, e, c) => {
    const left = leftTest((c.checksLeft && c.checksLeft[a.pid]) || []);
    const items = (e.items || []).map((x) => ({ ...x }));
    const where = items.map((x) => (typeof x.replace === 'string' && x.find ? locate(a.text, x.find) : { why: 'none' }));
    for (const s of a.items) {
      if (left(s.find, s.replace)) continue;
      const over = items.map((x, i) => ({ x, sp: where[i] })).filter(({ sp }) => !sp.why && overlaps(sp, s));
      if (over.length) {
        /* (put in by its place, never by String.replace — a "$&" in the words is no code) */
        const at = over.length === 1 ? over[0].x.replace.indexOf(s.find) : -1;
        if (at >= 0 && over[0].x.replace.indexOf(s.find, at + 1) < 0) over[0].x.replace = over[0].x.replace.slice(0, at) + s.replace + over[0].x.replace.slice(at + s.find.length);
        continue;
      }
      const { start, end, ...item } = s;
      items.push(item);
      where.push({ start, end });
    }
    const at = (x, i) => (x.kind === 'grade' ? -1 : where[i] && !where[i].why ? where[i].start : (() => { const sp = x.find ? locate(a.text, x.find) : { why: 'none' }; return sp.why ? Infinity : sp.start; })());
    const sorted = items.map((x, i) => ({ x, k: at(x, i) })).sort((m, n) => m.k - n.k).map(({ x }) => x);
    return { items: sorted, proofed: true };
  });
  await store.flush();
  tell(novelId);
  return { ok: true };
}

/* ------------------------------------------------------------ the speech marks */

/* THE SPEECH MARKS OF EVERY CHECKED PASSAGE (2.12.34; Cozy Tavern M753's mender, for a book). A passage checked before
 * its marks were read — every page checked through 2.12.33 — is never sent again: its speech marks are read here, on
 * what was found in it, so a quote left out on a page checked last week is found as one on a page checked today. Then
 * each paragraph only a reading can set goes to the marks' mender — the checker's connection, asked a few at a time to
 * add the quotation marks each spoken line is missing and nothing else (prompts.js marksRequest). What comes back is
 * kept only when it ADDS quotation marks and nothing more — no word, no other mark, nothing taken away (textshape.js
 * insertsOnlyMarks) — and every mark of the paragraph pairs after it: then it is a fix like any other, put in by itself
 * as any small fix. Each paragraph is asked about once for its words (`asked`); one it could not set is offered to be
 * written again (spanNote). A passing fault is waited out; the connection's own stops the checker. */
const MARKS_AT_ONCE = 6;
const marksWait = new Map();
async function runMarks(novelId, conn, choice) {
  const due = [];
  let read = 0;
  for (const c0 of chaptersOf(novelId)) {
    for (const p0 of c0.passages || []) {
      if (p0.by === 'break') continue;
      /* (a long book read a few pages at a time, the page let breathe between — each passage looked at as it stands then) */
      if (++read % 12 === 0) await new Promise((r) => setTimeout(r, 0));
      const c = store.peek('chapter', c0.id) || c0;
      const p = (c.passages || []).find((x) => x.id === p0.id);
      const v = p && picked(p);
      const e = p && entryFor(c, p);
      if (!v || !e || e.aside || v.streaming) continue;
      const text = String(v.text || '');
      const cut = Boolean(v.cut);
      const faults = marksOf(text, cut);
      const slips = slipsOf(text, cut);
      const own = (e.items || []).filter((x) => x.marks || x.slip);
      if (!faults.length && !slips.length && !own.length) continue;
      /* what is found already, where it stands — a fault of the marks or the spaces found by an older reading that
       * these words no longer have (2.12.35: the closing line of a letter, "Top 10"), or found where it no longer
       * stands, let go: never put in, never asked for again */
      const items = [];
      let dropped = false;
      for (const x of e.items || []) {
        const sp = x.kind === 'grade' || !x.find ? { why: 'none' } : locate(text, x.find);
        const still = !(x.marks || x.slip) || (!sp.why && (x.marks
          ? faults.some((f) => overlaps(sp, f))
          : slips.some((g) => g.at >= sp.start && g.at + g.del <= sp.end)));
        /* (only the marks and the spaces: what this pass finds again itself) */
        if (!still || (sp.why && (x.marks || x.slip))) { dropped = true; continue; }
        items.push(sp.why ? { ...x } : { ...x, start: sp.start, end: sp.end });
      }
      const a = { text, items: items.slice() };
      const leftOf = leftTest((c.checksLeft && c.checksLeft[p.id]) || []);
      marksHere(a, leftOf, { cut });
      slipsHere(a, leftOf, { cut });
      if (a.items.length > items.length || dropped) {
        const at = (x) => (x.kind === 'grade' ? -1 : x.start !== undefined ? x.start : Infinity);
        const next = a.items.map((x) => ({ x, at: at(x) })).sort((m, n) => m.at - n.at).map(({ x: { start: _s, end: _e, ...x } }) => x);
        store.change('chapter', c.id, chapterSteps.setCheck(p.id, v.id, { ...e, items: next }), { checkpoint: true });
      }
      const live = entryFor(store.peek('chapter', c.id) || c, p) || e;
      for (const x of live.items || []) if (x.marks && x.replace === null && !x.asked) due.push({ chapterId: c.id, pid: p.id, vid: v.id, sig: sigOf(v), item: x });
    }
  }
  if (!due.length) return;
  const wait = marksWait.get(novelId);
  if (wait && wait.until > Date.now()) { schedule(novelId, wait.until - Date.now() + 500); return; }
  for (let k = 0; k < due.length; k += MARKS_AT_ONCE) {
    choice.beforeAsk();
    if (writerBusy(novelId)) { schedule(novelId, 4000); return; }
    const out = await askMarks(novelId, conn, choice, due.slice(k, k + MARKS_AT_ONCE));
    if (out && out.gaveWay) { schedule(novelId, 20000); return; }
    if (out && out.stop) throw out.stop;
    if (out && out.passing) return;
    if (k + MARKS_AT_ONCE < due.length && k >= MARKS_AT_ONCE * 2) { schedule(novelId, 3000); return; }
  }
  tell(novelId);
}
/* one ask of the marks' mender for a few paragraphs; each item settled as set, or as asked. A request its model would
 * not read for its words is asked again a paragraph at a time — only a paragraph it will not read alone is let be
 * (2.12.35, the audit: all six were marked asked at once, and each went to be written again). What comes back is held
 * to the marks alone (textshape.js marksOnlyResult): the paragraph's own words, with the quotation marks the answer
 * adds — never a word, nor a mark taken away. */
async function askMarks(novelId, conn, choice, list) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  if (!novel) return null;
  setState(novelId, 'checking', `Setting the speech marks of ${list.length === 1 ? 'a paragraph' : `${list.length} paragraphs`}…`);
  const system = checkerFrame(house, namedBook(standingNotes(novel), house));
  const lineOf = (item) => (typeof item.line === 'string' ? item.line : item.find);
  const rows = list.map((x, i) => ({ n: i + 1, line: lineOf(x.item) }));
  const got = await archivist.askJson(conn, system, marksRequest({ rows }), { want: (o) => Array.isArray(o.paragraphs), beforeAsk: choice.beforeAsk });
  await archivist.mustHold('checker', novelId);
  const settle = (x, fields) => {
    const c = store.peek('chapter', x.chapterId);
    const p = c && (c.passages || []).find((y) => y.id === x.pid);
    const v = p && picked(p);
    const e = v && v.id === x.vid && c.checks && c.checks[x.pid] && c.checks[x.pid][x.vid];
    if (!e || e.sig !== x.sig || sigOf(v) !== x.sig) return;
    const left = leftTest((c.checksLeft && c.checksLeft[x.pid]) || []);
    const items = (e.items || []).map((y) => (y.id === x.item.id ? { ...y, ...fields(String(v.text || ''), y, left) } : y));
    store.change('chapter', x.chapterId, chapterSteps.setCheck(x.pid, x.vid, { ...e, items }), { checkpoint: true });
  };
  if (!got.ok) {
    if (got.leashed === 'gaveway') return { gaveWay: true };
    const fault = got.leashed === 'long' ? 'words' : got.leashed ? 'model' : await archivist.whoseFault(conn, got, { beforeAsk: choice.beforeAsk });
    if (fault && typeof fault === 'object') return { stop: failed(fault) };
    if (fault === 'words') {
      if (list.length > 1) {
        for (const x of list) {
          choice.beforeAsk();
          if (writerBusy(novelId)) { schedule(novelId, 4000); return { passing: true }; }
          const out = await askMarks(novelId, conn, choice, [x]);
          if (out && (out.gaveWay || out.stop || out.passing)) return out;
        }
        return { ok: true };
      }
      for (const x of list) settle(x, () => ({ asked: true }));
      return { missed: true };
    }
    const was = marksWait.get(novelId);
    const n = ((was && was.n) || 0) + 1;
    const ms = Math.max([60000, 180000, 600000][Math.min(n - 1, 2)], Number(got.retryAfterMs) || 0);
    marksWait.set(novelId, { n, until: Date.now() + ms });
    schedule(novelId, ms + 1000);
    return { passing: true };
  }
  marksWait.delete(novelId);
  const answers = got.obj.paragraphs;
  list.forEach((x, i) => {
    const said = answers.find((r) => r && Number(r.n) === i + 1);
    const line = lineOf(x.item);
    const text = said && typeof said.text === 'string' ? said.text.replace(/^\s+|\s+$/g, '') : '';
    /* only quotation marks added (or one set in the kind its pair needs), every word as it is, and every mark pairs */
    const mended = text ? marksOnlyResult(line, text, { goesOn: Boolean(x.item.goesOn), carried: x.item.carried || null }) : '';
    settle(x, (vtext, y, left) => {
      const spot = mended ? locate(vtext, y.find) : { why: 'none' };
      if (spot.why) return { asked: true };
      const at = spot.start + (Number.isInteger(y.lineAt) ? y.lineAt : 0);
      if (vtext.slice(at, at + line.length) !== line) return { asked: true };
      const c = changeSpan(vtext, at, at + line.length, mended);
      if (left(c.find, c.replace, { marks: true, text: vtext, start: at, end: at + line.length })) return { asked: true };
      return { find: c.find, replace: c.replace, why: MARKS_SET, asked: true, phrases: undefined, line: undefined, lineAt: undefined, goesOn: undefined, carried: undefined };
    });
  });
  await store.flush();
  tell(novelId);
  return { ok: true };
}

/* ------------------------------------------------------------ the chapter read whole */

/* THE CHAPTER READ WHOLE (his word, 17 October: "checked the passage as whole and summary to make sure consistency
 * and everything, especially spatial or other awareness … not changing story but edit to make sure quote or
 * everything is correct … in the background … super auto mode made sure it doesn't happen"). A checking reads a
 * passage with as much of the story right before it as its model holds; this reads a chapter start to end once every
 * passage in it is checked, for what disagrees across it (prompts.js wholeRequest) — told the chapters before by
 * their summaries, the notes and the bibliography, as a checking is. A chapter longer than its model holds is read in
 * parts, each told the chapter up to it. What it finds joins what was found in each passage, and is kept, shown and
 * put in by itself as every suggestion is (Apply the checker's fixes by themselves, or Super automatic) — a fix that
 * quotes the words of the book before it that it holds to, found there (heldBy), holds the page to the book itself.
 * When: once the chapter has ended (a chapter after it holds words, its END OF CHAPTER under Super automatic) or he
 * asked (Check this chapter, Check the whole book) — or once it has grown by WHOLE_GROW words since it was last read
 * whole; again only when its words change — as they stood before the fixes put in by themselves (autoBaseOf), so its
 * own fixes going in never ask for another read — never sooner than WHOLE_REST after the last, and at most
 * WHOLE_A_DAY times a day, unless he asks. */
const WHOLE_GROW = 4000;
const WHOLE_REST = 10 * 60000;
const WHOLE_A_DAY = 6;
const WHOLE_WORDS = 9000;
const WHOLE_BEFORE = 24000;
const dayOf = (t) => Math.floor(t / 86400000);
/* chapterId:sig -> {n, until}: a passing fault waited out; chapterId:sig -> n: its model would not read it (twice, and it is let be) */
const wholeWait = new Map();
const wholeMiss = new Map();
const wholeList = (c) => (c.passages || []).filter((p) => p.by !== 'break' && hasWords(p));
const wordsOf = (ps) => ps.reduce((n, p) => n + countWords(String(picked(p).text || '')), 0);
export function wholeSig(c) {
  return hashText(wholeList(c).map((p) => { const v = picked(p); return `${p.id}:${v.id}:${hashText(autoBaseOf(v))}`; }).join('|'));
}
/* a chapter one checking did not read whole: two passages or more — or one so long it was read in parts (`parts` on its
 * check; 2.12.35, the audit: a chapter of one passage, as a book brought in from a text file makes each, was never read
 * whole, even when he asked, and the end of a long one was never held to its start) */
function wholeWanted(c) {
  const ps = wholeList(c);
  if (ps.length >= 2) return true;
  const e = ps.length === 1 ? entryFor(c, ps[0]) : null;
  return Boolean(e && (Number(e.parts) || 0) > 1);
}
/* a chapter whose words as they stand were never read whole — Check this chapter reads it (ui/checks.js) */
export function wholeOwed(novelId, chapterId) {
  const c = store.peek('chapter', chapterId);
  return Boolean(c && store.peek('novel', novelId) && wholeWanted(c) && (c.wholeRead || {}).sig !== wholeSig(c) && !(wholeMiss.get(`${c.id}:${wholeSig(c)}`) >= 2));
}
/* what he asked for, settled where no read is wanted: a chapter its checking read whole already (one passage, read at
 * once), or one read whole at the words it has now — its ask let go (2.12.35, the audit: it stayed, and a chapter still
 * being written was read whole by itself the moment it grew, past the rules for when) */
function settleWhole(novelId) {
  for (const c of chaptersOf(novelId)) {
    if (!c.wholeAsked) continue;
    const ps = wholeList(c);
    if (ps.some((p) => picked(p).streaming || !entryFor(c, p))) continue;
    const sig = wholeSig(c);
    const r = c.wholeRead || {};
    if (r.sig === sig) store.change('chapter', c.id, chapterSteps.setWholeRead(r), { checkpoint: true });
    else if (!wholeWanted(c)) wholeDone(c.id, sig, wordsOf(ps), { byCheck: true });
  }
}
/* the next chapter to read whole — {chapter, sig} — or {wait} until one may be, or null. Every page is checked by
 * itself, in either mode (2.12.38), so every ended chapter is read whole by itself too, a few a day (WHOLE_A_DAY) */
function wholeDue(novelId, now = Date.now()) {
  const list = chaptersOf(novelId);
  let last = -1;
  list.forEach((c, i) => { if (wholeList(c).length) last = i; });
  let wait = null;
  const later = (ms) => { wait = wait === null ? ms : Math.min(wait, ms); };
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const ps = wholeList(c);
    if (ps.some((p) => picked(p).streaming || !entryFor(c, p)) || !wholeWanted(c)) continue;
    const sig = wholeSig(c);
    const r = c.wholeRead || {};
    if (r.sig === sig) continue;
    const key = `${c.id}:${sig}`;
    if ((wholeMiss.get(key) || 0) >= 2) continue;
    const words = wordsOf(ps);
    if (!c.wholeAsked && !(i < last || chapterClosed(c) || words - (Number(r.words) || 0) >= WHOLE_GROW)) continue;
    const held = wholeWait.get(key);
    if (held && held.until > now) { later(held.until - now); continue; }
    if (!c.wholeAsked) {
      if (r.day === dayOf(now) && (r.n || 0) >= WHOLE_A_DAY) continue;
      const rest = (Number(r.at) || 0) + WHOLE_REST - now;
      if (rest > 0) { later(rest); continue; }
    }
    return { chapter: c, sig, words };
  }
  return wait === null ? null : { wait };
}
function wholeDone(chapterId, sig, words, extra = {}) {
  const c = store.peek('chapter', chapterId);
  if (!c) return;
  const r = c.wholeRead || {};
  const now = Date.now();
  const day = dayOf(now);
  store.change('chapter', chapterId, chapterSteps.setWholeRead({ sig, at: now, day, n: r.day === day ? (r.n || 0) + 1 : 1, words, ...extra }), { checkpoint: true });
}

/* a few chapters at a time (the rest in a moment) */
async function runWhole(novelId, conn, choice) {
  /* (what is written again by itself goes in first, as every fix does) */
  const busyNow = () => writerBusy(novelId) || lifting.has(novelId);
  settleWhole(novelId);
  for (let n = 0; ; n++) {
    choice.beforeAsk();
    if (busyNow()) { schedule(novelId, 4000); return; }
    const due = wholeDue(novelId);
    if (!due) return;
    if (due.wait) { schedule(novelId, due.wait + 1000); return; }
    if (n >= 3) { schedule(novelId, 3000); return; }
    const out = await readWhole(novelId, conn, due.chapter, due.sig, due.words, choice);
    if (out && out.gaveWay) { schedule(novelId, 20000); return; }
    if (out && out.stop) throw out.stop;
    /* its model would not read it: once more on a later look, never straight away (a passing fault set its own wait) */
    if (out && out.missed) { schedule(novelId, 30000); return; }
    if (out && out.passing) return;
  }
}

/* one chapter read whole: its passages as they read when asked, in parts as its model holds them — what each part finds
 * kept as it comes, and a read that stopped partway (a passing fault, the checker giving way to his page) goes on at the
 * part it stopped at (2.12.35, the audit: a fault on part 2 threw part 1's findings away, and the next look paid for
 * part 1 again) */
const wholePart = new Map();
async function readWhole(novelId, conn, chapter, sig, words, choice) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  if (!novel) return null;
  const key = `${chapter.id}:${sig}`;
  const view = namedBook(standingNotes(novel), house);
  const notesFit = archivist.notesRoomOf(conn);
  const ci = chapterNumber(novel, chapter.id);
  const nums = passageNumbers(chapter);
  const label = chapterLabel(novel, chapter);
  const system = checkerFrame(house, view);
  const his = hisWords(house);
  const inHand = Object.fromEntries(chaptersOf(novelId).map((c) => [c.id, c]));
  const ps = wholeList(chapter);
  const asked = new Map();
  for (const p of ps) { const v = picked(p); asked.set(`${ci}.${nums.get(p.id)}`, { pid: p.id, vid: v.id, sig: sigOf(v), text: String(v.text || ''), ask: askWords(v), items: [] }); }
  const keys = new Set(asked.keys());
  const byPid = new Map([...asked.values()].map((a) => [a.pid, a]));
  /* the parts: as many passages as one ask carries — a longer passage alone, in pieces */
  const limit = Math.max(150, Math.min(WHOLE_WORDS, Math.floor((archivist.readingRoom(conn, fixedOf(house, novel, conn)) * 0.5) / 1.4)));
  const runs = [];
  let run = null;
  for (const p of ps) {
    const a = byPid.get(p.id);
    const w = countWords(a.text);
    if (w > limit) {
      if (run) { runs.push(run); run = null; }
      const pieces = archivist.partsOf(a.text, limit);
      pieces.forEach((piece, k) => runs.push({ first: p, piece: k, numbered: `[${ci}.${nums.get(p.id)}] ${piece}`, lead: pieces.slice(0, k).join('\n\n'), refs: [`${ci}.${nums.get(p.id)}`] }));
      continue;
    }
    if (run && run.words + w > limit) { runs.push(run); run = null; }
    if (!run) run = { first: p, list: [], words: 0, refs: [] };
    run.list.push(p); run.words += w; run.refs.push(`${ci}.${nums.get(p.id)}`);
  }
  if (run) runs.push(run);
  /* where a read that stopped partway goes on (the part it stopped at, found by its first passage — its words may have
   * taken fixes since: the parts are made again on them) */
  const was = wholePart.get(key);
  const resume = was ? runs.findIndex((r) => r.first.id === was.pid && (r.piece === undefined ? -1 : r.piece) === was.piece) : -1;
  /* what a part found, laid beside what each passage's checking found — only on the words it read, and never over a fix
   * there already or one he left as it is */
  const merge = (refs) => {
    for (const ref of refs) {
      const a = asked.get(ref);
      if (!a || !a.items.length) continue;
      const found = a.items;
      a.items = [];
      const home = homeOf(novelId, chapter.id, a.pid);
      const c = home && store.peek('chapter', home);
      const p = c && (c.passages || []).find((x) => x.id === a.pid);
      const v = p && picked(p);
      const e = v && v.id === a.vid && sigOf(v) === a.sig && c.checks && c.checks[a.pid] && c.checks[a.pid][a.vid];
      if (!e || e.sig !== a.sig || e.aside) continue;
      const left = leftTest((c.checksLeft && c.checksLeft[a.pid]) || []);
      const there = (e.items || []).filter((x) => typeof x.replace === 'string' && x.find).map((x) => locate(a.text, x.find)).filter((x) => !x.why);
      const add = found.filter((x) => !there.some((y) => overlaps(x, y)) && !left(x.find, x.replace));
      if (!add.length) continue;
      /* in the order they stand, the grade's card first */
      const at = (x) => (x.kind === 'grade' ? -1 : x.start !== undefined ? x.start : (() => { const sp = x.find ? locate(a.text, x.find) : { why: 'none' }; return sp.why ? Infinity : sp.start; })());
      const items = [...(e.items || []), ...add].map((x) => ({ x, at: at(x) })).sort((m, n) => m.at - n.at).map(({ x: { start: _s, end: _e, ...x } }) => x);
      store.change('chapter', home, chapterSteps.setCheck(a.pid, a.vid, { ...e, items }), { checkpoint: true });
    }
  };
  for (let k = Math.max(0, resume); k < runs.length; k++) {
    const r = runs[k];
    choice.beforeAsk();
    if (writerBusy(novelId) || lifting.has(novelId)) { wholePart.set(key, { pid: r.first.id, piece: r.piece === undefined ? -1 : r.piece }); schedule(novelId, 4000); return null; }
    setState(novelId, 'checking', `Reading ${chapterLabel(novel, chapter, { withName: false })} whole${runs.length > 1 ? ` (part ${k + 1} of ${runs.length})` : ''}, for what disagrees across it…`);
    const numbered = r.numbered || numberedText(novel, chapter, r.list);
    /* the chapter up to these words — or, for its opening, the end of the chapter before */
    const lead = storyBefore(novel, chapter, r.first.id);
    const leadText = r.lead ? [lead.from === 'this' ? lead.text : '', r.lead].filter((x) => x && x.trim()).join('\n\n') : lead.text;
    const leadFrom = r.lead ? 'this' : lead.from;
    const askList = r.refs.map((n) => ({ n, words: asked.get(n).ask }));
    const askCost = askList.reduce((t, x) => t + estimateTokens(x.words) + 12, 0);
    const spare = archivist.readingRoom(conn, fixedOf(house, novel, conn)) - estimateTokens(numbered) - askCost;
    const before = tailOf(leadText, Math.max(0, Math.min(leadFrom === 'last' ? 2500 : WHOLE_BEFORE, Math.floor(spare * 0.4 * 3.5))));
    const story = storySoFar(novel, chapter.id, Math.max(0, Math.min(4000, Math.floor(spare * 0.3))));
    const behind = notesBehind(view, inHand, chapter, { before: r.first.id }, 'write');
    const bib = ridingItems(bibItems(view, inHand, { facts: true }), { near: numbered,
      budget: Math.max(0, Math.min(2500, Math.floor(spare * 0.2))), skip: passagesAfter(novel, inHand, chapter.id, { before: r.first.id }, 'write'), byPage: superOn(house) }).words.join('\n\n');
    const req = wholeRequest({ novel: view, chapterLabel: label, numbered, before, beforeFrom: leadFrom, his, sofar: story.text, left: story.left, notesFit, asked: askList, behind, bib, part: k + 1, parts: runs.length });
    const got = await archivist.askJson(conn, system, req, { want: (o) => Array.isArray(o.edits), beforeAsk: choice.beforeAsk });
    await archivist.mustHold('checker', novelId);
    if (!got.ok) {
      /* (this part is read again first) */
      wholePart.set(key, { pid: r.first.id, piece: r.piece === undefined ? -1 : r.piece });
      /* it made way for his page: read again once the page has gone */
      if (got.leashed === 'gaveway') return { gaveWay: true };
      const fault = got.leashed === 'long' ? 'words' : got.leashed ? 'model' : await archivist.whoseFault(conn, got, { beforeAsk: choice.beforeAsk });
      /* the connection's own: the checker stops, as for any checking */
      if (fault && typeof fault === 'object') return { stop: failed(fault) };
      /* the words': its model would not read this chapter — twice, and it is let be until its words change */
      if (fault === 'words') {
        const n = (wholeMiss.get(key) || 0) + 1;
        wholeMiss.set(key, n);
        if (n >= 2) { wholeDone(chapter.id, sig, words, { missed: cutWords(got.error || 'its model would not read it', 200) }); wholePart.delete(key); }
        return { missed: true };
      }
      /* passing (down, busy, too slow): waited out, a minute and then longer, never holding up the rest */
      const held = wholeWait.get(key);
      const n = ((held && held.n) || 0) + 1;
      const ms = Math.max([60000, 180000, 600000][Math.min(n - 1, 2)], Number(got.retryAfterMs) || 0);
      wholeWait.set(key, { n, until: Date.now() + ms });
      schedule(novelId, ms + 1000);
      return { passing: true };
    }
    /* each fix where its words stand in the passage as it was read; two over the same words, the first stands */
    for (const e of got.obj.edits) {
      if (!e || typeof e !== 'object' || typeof e.find !== 'string' || typeof e.replace !== 'string') continue;
      const ref = refOf(e.passage, keys);
      const a = ref && r.refs.includes(ref) ? asked.get(ref) : null;
      if (!a) continue;
      const spot = locate(a.text, e.find);
      if (spot.why) continue;
      const find = a.text.slice(spot.start, spot.end);
      if (find === e.replace || find.replace(/\s+/g, ' ').trim() === e.replace.replace(/\s+/g, ' ').trim()) continue;
      if (a.items.some((x) => overlaps(x, spot))) continue;
      const kind = String(e.kind || '').toLowerCase() === 'seam' ? 'seam' : 'continuity';
      a.items.push({ id: newId('sg'), kind, find, replace: e.replace, why: clean(e.why), whole: true, ...saysOf(novelId, chapter.id, a.pid, kind, e.says, a.text.slice(0, spot.start)), start: spot.start, end: spot.end });
    }
    merge(r.refs);
    await store.flush('chapter', chapter.id);
    if (k + 1 < runs.length) wholePart.set(key, { pid: runs[k + 1].first.id, piece: runs[k + 1].piece === undefined ? -1 : runs[k + 1].piece });
  }
  wholeDone(chapter.id, sig, words);
  wholePart.delete(key);
  wholeMiss.delete(key);
  wholeWait.delete(key);
  await store.flush('chapter', chapter.id);
  tell(novelId);
  return { ok: true };
}

/* ------------------------------------------------------------ the benchmark */

/* stock wording counted in a version, kept for it while its words stay */
const stockSeen = new WeakMap();
function stockCount(v) {
  /* the writer's own words: what a fix took out since is still the writer's to count */
  const t = writtenOf(v);
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
  /* (fixes put in on its page leave it the writer's; his words or his partner's in it do not — 2.12.2) */
  if (!v || v.streaming || v.carried || MIXED.includes(v.how) || mixedHands(v)) return '';
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
  /* what no one writer wrote whole — his words or his partner's in it, carried on by another writer, brought in — has
   * a row of its own: a grade is never left out of the table (his report, 2.12.2: "Who wrote it" empty under a grade) */
  const MIXED_ROW = '\u0000mixed';
  const fails = new Map();
  let duels = 0;
  for (const c of chaptersOf(novelId)) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      const who = authorOf(v) || (v && !v.streaming && String(v.text || '').trim() ? MIXED_ROW : '');
      if (who === MIXED_ROW) { const r = row(who); r.words += countWords(v.text); r.stock += stockIn(String(v.text || ''), { not: askWords(v) }).length; }
      else if (who) { const r = row(who); r.words += countWords(writtenOf(v)); r.stock += stockCount(v); }
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
    model: r.model === MIXED_ROW ? '' : r.model, mixed: r.model === MIXED_ROW, n: r.n, average: r.n ? Math.round((r.sum / r.n) * 10) / 10 : null,
    words: r.words, stock: r.stock, per1000: r.words ? Math.round((r.stock / r.words) * 10000) / 10 : null,
    win: r.win, loss: r.loss, tie: r.tie, self: Boolean(judgeModel) && r.model === judgeModel,
  })).sort((a, b) => (Number(a.mixed) - Number(b.mixed)) || ((b.average === null ? -1 : b.average) - (a.average === null ? -1 : a.average)) || ((b.win - b.loss) - (a.win - a.loss)) || (b.words - a.words));
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
  const made = keepWords(novelId, w, next, w.e.items.filter((x) => x.id !== itemId));
  tell(novelId);
  return made ? { ok: true, ...made } : { ok: false, said: 'the passage is being written just now' };
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

/* A fix under continuity holds the page to the notes, and the notes may be what is wrong, so it waits for him — unless
 * all it changes is the tense of its verbs ("which is the way" → "which was the way"): that holds the page to the tense
 * the book is told in, never to the notes. Through 2.12.19 the checker was told to file a slip of the book's tense under
 * continuity, and such a fix never went in by itself; it is filed under grammar now, and one filed before still goes in.
 * Only plain pairs are read as tense — anything else under continuity waits, as before. */
const TENSE_PAIRS = new Set();
for (const [a, b] of [['is', 'was'], ['are', 'were'], ['am', 'was'], ['has', 'had'], ['have', 'had'], ['does', 'did'], ['do', 'did'],
  ['can', 'could'], ['will', 'would'], ['shall', 'should'], ['may', 'might'], ["isn't", "wasn't"], ["aren't", "weren't"],
  ["hasn't", "hadn't"], ["haven't", "hadn't"], ["doesn't", "didn't"], ["don't", "didn't"], ["can't", "couldn't"], ["won't", "wouldn't"]]) {
  TENSE_PAIRS.add(`${a}|${b}`); TENSE_PAIRS.add(`${b}|${a}`);
}
/* a regular verb's present and past: walks/walked, moves/moved, watches/watched, tries/tried, walk/walked, move/moved */
const ENDINGS = [['s', 'ed'], ['s', 'd'], ['es', 'ed'], ['ies', 'ied'], ['', 'ed'], ['', 'd']];
const pastOf = (now, then) => ENDINGS.some(([a, b]) => {
  const stem = now.slice(0, now.length - a.length);
  return now.endsWith(a) && then.endsWith(b) && stem.length >= 2 && stem === then.slice(0, then.length - b.length) &&
    /* a bare "d" only after an "e" (move/moved, never wan/wand) */
    (b !== 'd' || stem.endsWith('e'));
});
const tenseWords = (x) => String(x || '').toLowerCase().replace(/[’‘]/g, "'").match(/[a-z']+|[^a-z'\s]+/g) || [];
export function tenseOnly(find, replace) {
  const a = tenseWords(find);
  const b = tenseWords(replace);
  if (!a.length || a.length !== b.length) return false;
  let moved = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!TENSE_PAIRS.has(`${a[i]}|${b[i]}`) && !pastOf(a[i], b[i]) && !pastOf(b[i], a[i])) return false;
    moved++;
  }
  return moved > 0;
}
/* (one that quotes the words of the book before it that it holds to, found there — `held` — holds the page to the
 * book itself, never to the notes: it may go in by itself as any small fix, 2.12.33) */
/* what never goes in by itself: a fix to the book's continuity that holds to the notes (a fact the notes say may be the
 * notes' slip, Cozy Tavern M447/M448) or to words of the book that are not there — or no longer: changed since (2.12.35);
 * and a seam that quotes words not there, or opens after a scene break (2.12.35, the audit: a seam was put in by itself
 * whatever it quoted, against what 2.12.33 said) */
const waitsForHim = (novelId, item) => (item.kind === 'continuity' && !tenseOnly(item.find, item.replace) && (!item.held || !holdStands(novelId, item)))
  || (item.kind === 'seam' && Boolean(item.unheld || item.afterBreak || (item.held && !holdStands(novelId, item))));
function waitsForHimWhy(novelId, item) {
  if (item.kind === 'seam' && item.afterBreak) return 'a scene break stands before it, and the jump in time or place is marked there';
  if (item.held && !holdStands(novelId, item)) return 'the words of the book it holds to were changed since, so it may be wrong now';
  if (item.unheld) return 'the words it quotes from the book before it are not there, so it may be wrong';
  return 'it holds the page to the notes, and the notes may be what is wrong';
}

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
    if (byItself && (waitsForHim(novelId, item) || !smallFix(item, text))) { rest.push(item); continue; }
    const spot = locate(text, item.find);
    if (spot.why || spots.some((s) => overlaps(s, spot))) { rest.push(item); continue; }
    spots.push({ ...spot, item });
  }
  if (!spots.length) return 0;
  const put = (list) => { let t = text; for (const s of [...list].sort((a, b) => b.start - a.start)) t = t.slice(0, s.start) + s.item.replace + t.slice(s.end); return t; };
  /* by itself, all that go in together are a small mend too — with what went in by itself before them, measured from
   * the words before any of it (autoBaseOf): each in turn, from the top of the passage, goes in while they still are;
   * one that would make them more waits for him (through 2.12.1 one too many held them all back) */
  let going = spots;
  if (byItself) {
    const base = autoBaseOf(w.v);
    going = [];
    for (const s of [...spots].sort((a, b) => a.start - b.start)) {
      if (smallMend(base, put([...going, s]))) going.push(s); else rest.push(s.item);
    }
    if (!going.length) return 0;
  }
  const next = put(going);
  if (!keepWords(novelId, w, next, rest, { auto: byItself })) return 0;
  return going.length;
}

/* Why a suggestion is not put in by itself, in his words ('' when it will be) — said on its card while "Apply the
 * checker's fixes by themselves" is on (his report, 2.12.2: 27 waiting, and not one said why) */
export function waitsWhy(chapterId, passageId, item) {
  const house = store.peek('house', 'house') || {};
  if (autoOf(house).fix === null || !item || item.kind === 'grade') return '';
  const w = where(chapterId, passageId);
  if (w.why) return '';
  const { p, v } = w;
  if (v.cut) return 'the passage stopped partway — what goes in by itself waits for its Go on';
  if (editingNow.has(passageId)) return 'the passage is open in your edit box';
  if (v.fixesBack && v.fixesBack === sigOf(v)) return 'you put these words back yourself, so nothing goes in on them by itself';
  if (howOf(v) === 'imported') return 'words you brought in from a file are never changed by themselves';
  if (typeof item.replace !== 'string') {
    if (item.marks && !item.asked) return 'its quotation marks are being set in a moment';
    if ((v.spanFailed || []).includes(item.find)) return 'written again by itself, it did not come — Write it again asks for it';
    if (spansOf(p) >= MAX_SPANS) return `${numberWord(MAX_SPANS)} sentences of this passage were written again by itself already — Write it again does this one`;
    return '';
  }
  if (waitsForHim(w.chapter.novelId, item)) return waitsForHimWhy(w.chapter.novelId, item);
  const text = String(v.text || '');
  if (!smallFix(item, text)) return 'it rewrites a large stretch of the passage';
  const spot = locate(text, item.find);
  if (!spot.why && !smallMend(autoBaseOf(v), text.slice(0, spot.start) + item.replace + text.slice(spot.end))) return text === autoBaseOf(v) ? 'it would change too much of the passage at once' : 'with the fixes put in by themselves already, it would change too much of the passage';
  return '';
}
const numberWord = (n) => (['no', 'one', 'two', 'three', 'four', 'five'][n] || String(n)).replace(/^./, (c) => c.toUpperCase());

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
  const spot = spanSpot(String(w.v.text || ''), item);
  return spot.why ? null : spot;
}
/* where the words a card writes again stand: its find — or, for a paragraph whose speech marks wait for a reading and
 * which stands twice in the passage, the paragraph itself, inside the few words around it that find it (`line`,
 * `lineAt`): the writer is given the paragraph alone, as the marks' mender is (2.12.35, the review: it was given the
 * words around it too, so its answer was refused, by his button and by itself) */
function spanSpot(text, item) {
  const spot = locate(text, item.find);
  if (spot.why || typeof item.line !== 'string' || !item.line || !Number.isInteger(item.lineAt)) return spot;
  const at = spot.start + item.lineAt;
  return text.slice(at, at + item.line.length) === item.line ? { start: at, end: at + item.line.length } : { why: 'those words are not there any more' };
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
 * themselves. null when off. (auto.js autoOf: his two switches, and Super
 * automatic for the fixes) */
export { autoOf };
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
/* (a sentence written again by itself goes in on the version it was written for, 2.12.2: counted there) */
const spansOf = (p) => (p.versions || []).reduce((n, v) => n + (v.spanAuto ? 1 : 0) + (Number(v.spans) || 0), 0);
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
/* a paragraph's speech marks written again: held to its marks alone (writer.js rewriteSelection `marks`) — by his
 * button and by itself the same */
export function spanMarks(item) { return item && item.marks ? { goesOn: Boolean(item.goesOn), carried: item.carried || null } : false; }
/* what the writer is told for a sentence to write again — the same by his button (Suggestions → Write it again) and by itself */
export function spanNote(item) {
  if (item && item.marks) return 'Set the quotation marks of this paragraph right — where each spoken line begins and ends, and a new paragraph where someone else begins to speak — and keep every word as it is.';
  const words = quoted(Array.isArray(item.phrases) && item.phrases.length ? item.phrases : item.phrase ? [item.phrase] : []);
  return item.stock ? `Write it again without ${words} — say it the way this book would.` : `Write it again without ${words}.`;
}
/* the passages open in his edit box: nothing goes in by itself under his hand (Cozy Tavern M429) */
const editingNow = new Set();
export function setEditing(passageId, on) { if (on) editingNow.add(passageId); else editingNow.delete(passageId); }
/* under his mark only for being untrue to the book: the notes may be what is wrong — never written again by itself (Cozy Tavern M447) */
const onlyCanon = (g) => { const held = (g.faults || []).filter((f) => !f.unverified); return held.length > 0 && held.every((f) => f.check === 'canon'); };
const lifting = new Map();
/* novelId -> the passage being written again by itself just now: nothing else goes in on it, by itself, until its new
 * words are in (2.12.35 — a look while it was written put the fixes it was waiting with into the old words) */
const writingAgain = new Map();
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
 *    with words to put in goes in, on the page itself (2.12.2), while what
 *    went in by itself stays a small change; then a sentence to write again
 *    that is left on it (a word on his list, stock wording, a stray of
 *    another script) is written again by itself, on the page too, one at a
 *    time, twice at most for a passage. A slip against the notes, and a fix
 *    too large, wait for him — on every passage checked, never words he put
 *    back himself or brought in from a file.
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
      /* never by itself on a page cut short or stopped: it waits for its Go on (Cozy Tavern M552) — nor under his hand in the edit box;
       * a version he put on show himself (the arrows, or the one on show removed) is never written again by itself (below), and
       * words he put back himself get nothing by themselves (fixesBack) */
      if (!v || v.streaming || v.cut || editingNow.has(p.id) || writingAgain.get(novelId) === p.id) continue;
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
        if (under && !v.chosen && since(v, a.lift) && liftsOf(p).length < MAX_LIFTS && !liftTried.has(`${v.id}|${sigOf(v)}`) && !v.liftFailed && !onlyCanon(g) && (card.lift || g.lift)) {
          if (!next) next = { chapterId: c.id, passageId: p.id, v, note: card.lift || g.lift, lift: liftsOf(p).length + 1 };
          /* its fixes wait for the passage written again */
          continue;
        }
      }
      /* the fixes: on every passage checked, from the moment he switches it on (his report, 2.12.2: "27 suggestions and
       * it doesn't automatically change it" — through 2.12.1 only passages written after) — never on words he put
       * back himself, nor words he brought in from a file */
      if (a.fix !== null && howOf(v) !== 'imported' && v.fixesBack !== sigOf(v)) {
        if ((e.items || []).some((x) => typeof x.replace === 'string') && applyPassage(novelId, c.id, p.id, { byItself: true })) {
          /* the version the fixes made, with what still waits on it */
          const now = store.peek('chapter', c.id);
          const np = now && (now.passages || []).find((x) => x.id === p.id);
          v = np ? picked(np) : null;
          e = v ? checkOf(now, np, v) : null;
          if (!e) continue;
        }
        const span = (e.items || []).find((x) => x.replace === null && x.kind !== 'grade' && x.find && stands(x) && !(x.marks && !x.asked) && !spanTried.has(`${v.id}|${hashText(String(v.text || ''))}|${x.find}`) && !(v.spanFailed || []).includes(x.find));
        const cur = ((store.peek('chapter', c.id) || c).passages || []).find((x) => x.id === p.id) || p;
        if (span && !next && spansOf(cur) < MAX_SPANS) next = { span: true, chapterId: c.id, passageId: p.id, v, item: span };
      }
    }
  }
  if (next && next.span && !writerBusy(novelId) && !lifting.has(novelId)) {
    /* (the version keeps its id as its words change in place: tried once for these words) */
    const key = `${next.v.id}|${hashText(String(next.v.text || ''))}|${next.item.find}`;
    spanTried.add(key);
    const spot = spanSpot(String(next.v.text || ''), next.item);
    if (!spot.why) {
      const job = writeSpanAgain({ novelId, chapterId: next.chapterId, passageId: next.passageId, start: spot.start, end: spot.end, note: spanNote(next.item), fromVersion: next.v, auto: true, fix: true, marks: spanMarks(next.item) })
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
        .finally(() => { lifting.delete(novelId); writingAgain.delete(novelId); });
      writingAgain.set(novelId, next.passageId);
      lifting.set(novelId, job);
    }
  } else if (next && !next.span && !writerBusy(novelId) && !lifting.has(novelId)) {
    const liftKey = `${next.v.id}|${sigOf(next.v)}`;
    liftTried.add(liftKey);
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
      .then((out) => afterAutomatic(novelId, liftTried, liftKey, out))
      .finally(() => { lifting.delete(novelId); writingAgain.delete(novelId); });
    writingAgain.set(novelId, next.passageId);
    lifting.set(novelId, job);
  }
  tell(novelId);
}

export function forTests() { return { states, failures, blocked, timers, lifting, autoAfter, running: runningFor, narrow: narrowC, liftTried, spanTried, wholeDue, wholeWait, wholeMiss, wholePart, marksWait, proofWait, proofPart }; }
