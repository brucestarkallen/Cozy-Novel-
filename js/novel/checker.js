/* Cozy Novel — js/novel/checker.js — THE CHECKER: Grammarly for the book.
 *
 * Each passage, once it is finished (written, his own words, an edit), is
 * read by the checker for grammar, wording that sounds machine-made rather
 * than written ("humanize"), his words to avoid, and slips against the book
 * and its notes ("continuity"). What it would change waits, passage by
 * passage, behind the bubble on the page — green when everything is checked
 * and nothing needs changing, blue while it checks, yellow with what it
 * found — to be applied one by one or all at once, or left as it is.
 *
 * Nothing is changed without him: an applied suggestion makes a new version
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
import { connFor, connById, busy as writerBusy, recount, rewrite as writeAgain } from './writer.js';
import * as archivist from './archivist.js';
import { picked, passageNumbers, chapterLabel, chapterNumber, chapterSteps, novelSteps, newVersion, endOf, chapterText } from './shape.js';
import { numberedText, shortOf } from './context.js';
import { checkerFrame, checkRequest, duelRequest, avoidList, avoidLine, lateFor, CHECK_KINDS, JUDGE_CHECKS, macroNames, withMacros } from './prompts.js';
import { locate } from './changes.js';
import { findIn } from './search.js';
import { stockIn } from './stock.js';
import { contextOf } from '../model/providers.js';
import { hashText, countWords, newId, plural, estimateTokens } from '../util.js';

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
function wanted(house, chapter, p) {
  if (p.by === 'break') return false;
  const v = picked(p);
  if (!v || v.streaming || !String(v.text || '').trim()) return false;
  if (entryFor(chapter, p)) return false;
  if (chapter.checkAll) return true;
  /* by itself, only a finished page: one cut short or stopped waits for its Go on (Cozy Tavern M552) */
  if (v.cut) return false;
  if (v.how === 'imported') return false;
  const from = house && house.checksFrom;
  return Number.isFinite(from) && (v.done || v.at || 0) >= from;
}

function chaptersOf(novelId) {
  const novel = store.peek('novel', novelId);
  const out = [];
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) out.push(c); }
  return out;
}

/* every suggestion waiting in the book, chapter by chapter, passage by passage */
export function suggestions(novelId) {
  const novel = store.peek('novel', novelId);
  const out = [];
  if (!novel) return out;
  for (const c of chaptersOf(novelId)) {
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const e = entryFor(c, p);
      if (!e || !(e.items || []).length) continue;
      const v = picked(p);
      for (const item of e.items) out.push({ chapterId: c.id, passageId: p.id, versionId: v.id, number: nums.get(p.id), chapter: chapterNumber(novel, c.id), item, text: String(v.text || '') });
    }
  }
  return out;
}

/* the passages still to be read by themselves, and the older ones he can ask for */
export function waiting(novelId) {
  const house = store.peek('house', 'house') || {};
  let n = 0;
  for (const c of chaptersOf(novelId)) for (const p of c.passages || []) if (wanted(house, c, p)) n++;
  return n;
}
export function unchecked(novelId, chapterId = null) {
  let n = 0;
  let words = 0;
  for (const c of chaptersOf(novelId)) {
    if (chapterId && c.id !== chapterId) continue;
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (!v || v.streaming || !String(v.text || '').trim() || entryFor(c, p)) continue;
      n++;
      words += countWords(v.text);
    }
  }
  return { passages: n, words };
}

/* ------------------------------------------------------------ the light */

const states = new Map();      /* novelId -> {state, words} while checking, or after a fault */
const timers = new Map();
const runningFor = new Set();
/* checking some book just now (an update waits for it) */
export function busyAny() { return runningFor.size > 0; }
const failures = new Map();
const blocked = new Map();
const fns = new Set();
export function onChecks(fn) { fns.add(fn); return () => fns.delete(fn); }
function tell(novelId) { for (const fn of fns) { try { fn(novelId); } catch (e) { console.error(e); } } }
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
  if (s && s.state === 'retry') return { state: 'waiting', words: s.words, count };
  if (waiting(novelId)) return { state: 'waiting', words: 'The newest words are checked in a moment.', count };
  if (count) return { state: 'found', words: `${plural(count, 'suggestion')} to look at.`, count };
  /* green says only what is true: older writing, never sent unasked, is not called checked */
  const older = unchecked(novelId).passages;
  return { state: 'clean', words: older ? `Everything new is checked — nothing to change. ${plural(older, 'older passage')} ${older === 1 ? 'is' : 'are'} checked only when you ask.` : 'Everything is checked — nothing to change.', count: 0 };
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
function fixedOf(house, novel) {
  const avoid = avoidList(house);
  const system = [checkerFrame(house, novel), avoidLine(avoid)].filter(Boolean).join('\n\n');
  return estimateTokens(system) + estimateTokens(checkRequest({ novel, chapterLabel: 'Chapter Twenty-Two', numbered: '', avoid, judge: judgeOf(house), his: hisWords(house) })) + 150;
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
  for (let i = order.indexOf(chapterId) - 1; i >= 0; i--) {
    const c = store.peek('chapter', order[i]);
    if (!c) continue;
    const row = `${chapterLabel(novel, c)}:\n${shortOf(c)}`;
    const t = estimateTokens(row);
    if (used + t > budget) break;
    rows.unshift(row);
    used += t;
  }
  return rows.join('\n\n');
}

/* how many words one checking carries: about as many as a careful read takes
 * at once, and never more than the checker's model holds beside the notes */
const BATCH_WORDS = 2500;
function batchWords(conn, house, novel) {
  const fixed = fixedOf(house, novel);
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
function nextBatch(novelId, limit) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  for (const c of chaptersOf(novelId)) {
    const list = [];
    let words = 0;
    for (const p of c.passages || []) {
      if (!wanted(house, c, p)) continue;
      const w = countWords(picked(p).text);
      if (list.length && words + w > limit) break;
      list.push(p);
      words += w;
      if (w > limit) break;
    }
    if (list.length) {
      const nums = passageNumbers(c);
      return { chapterId: c.id, passages: list, label: `${chapterLabel(novel, c, { withName: false })}, ${list.length === 1 ? `passage ${nums.get(list[0].id)}` : `passages ${nums.get(list[0].id)}–${nums.get(list[list.length - 1].id)}`}` };
    }
  }
  return null;
}

export async function runCheck(novelId) {
  if (runningFor.has(novelId)) { schedule(novelId, 5000); return; }
  if (writerBusy(novelId)) { schedule(novelId, 4000); return; }
  const house = store.peek('house', 'house') || {};
  const conn = checkerConn(house);
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  if (!conn) { setState(novelId, null); return; }
  if (blocked.has(novelId) && blocked.get(novelId) === archivist.connPrint(conn)) return;
  blocked.delete(novelId);
  const work = async () => {
    runningFor.add(novelId);
    try {
      for (const c of chaptersOf(novelId)) if (stale(c)) store.change('chapter', c.id, chapterSteps.pruneChecks(), { checkpoint: true });
      let lastAsked = '';
      for (let n = 0; ; n++) {
        if (writerBusy(novelId)) { schedule(novelId, 4000); break; }
        const limit = batchWords(conn, store.peek('house', 'house') || {}, store.peek('novel', novelId) || novel);
        const batch = nextBatch(novelId, limit);
        if (!batch) break;
        /* the same words again means nothing could be kept for them: never asked in a loop */
        const asking = batch.passages.map((p) => picked(p).id).join(',');
        if (asking === lastAsked) break;
        /* a whole long book: the rest in a moment, a run at a time */
        if (n >= 60) { schedule(novelId, 2000); break; }
        lastAsked = asking;
        setState(novelId, 'checking', `Checking ${batch.label}…`);
        await checkBatch(novelId, conn, batch, limit);
      }
      /* the judge's head to head, once the reading is done */
      if (judgeOf(store.peek('house', 'house') || {})) await runDuels(novelId, conn);
      /* and what he switched on to happen by itself */
      autoAfter(novelId);
      failures.delete(novelId);
      setState(novelId, null);
    } catch (e) {
      const why = (e && e.message) || String(e);
      /* another browser has the book now: it finishes the checking */
      if (e && e.yielded) { setState(novelId, null); schedule(novelId, 30000); return; }
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
  const leased = () => archivist.withLease('checker', novelId, work, { refused: (held) => schedule(novelId, Math.max(20000, Math.min(held.left || 0, 90000))) });
  if (globalThis.navigator && navigator.locks && navigator.locks.request) {
    await navigator.locks.request(`cozynovel-checker-${novelId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { schedule(novelId, 20000); return; }
      await leased();
    });
  } else {
    await leased();
  }
}

/* anything kept for a passage or version no longer in the chapter */
function stale(c) {
  for (const pid of Object.keys(c.checksLeft || {})) if (!(c.passages || []).some((x) => x.id === pid)) return true;
  for (const d of Object.values(c.duels || {})) {
    const p = d && (c.passages || []).find((x) => x.id === d.pid);
    if (!p || !(p.versions || []).some((v) => v.id === d.x) || !(p.versions || []).some((v) => v.id === d.y)) return true;
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
 * parts: every part's). A check fails where it was answered "no"; the words
 * it named are kept where they stand in the passage, to be shown there.
 * "fresh" fails wherever stock wording is counted in it, whatever was
 * answered (a model reading for its own kind of phrasing misses most of it).
 * The grade is the number of checks passed, of ten. */
function judged(a, list, judge) {
  const failed = new Map();
  let answered = false;
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const checks = g.checks && typeof g.checks === 'object' && !Array.isArray(g.checks) ? g.checks : null;
    const faults = (Array.isArray(g.faults) ? g.faults : []).filter((f) => f && typeof f === 'object');
    if (!checks && !faults.length) continue;
    answered = true;
    for (const [k] of JUDGE_CHECKS) {
      const said = checks ? checks[k] : undefined;
      const fault = faults.find((f) => String(f.check || '').trim().toLowerCase() === k);
      const no = checks ? said === false || ['no', 'fail', 'failed', 'false'].includes(String(said === undefined || said === null ? '' : said).toLowerCase().replace(/[^a-z]/g, '')) : Boolean(fault);
      if (!no || failed.has(k)) continue;
      const words = fault ? evidence(a.text, fault.words) : '';
      failed.set(k, { check: k, ...(words ? { words } : {}), why: fault ? clean(fault.why, 220) : '' });
    }
  }
  if (!answered) return null;
  if (a.stock.length && !(failed.get('fresh') || {}).words) {
    failed.set('fresh', { check: 'fresh', words: a.stock[0].words, why: 'stock wording — far more common in machine-made fiction than in books people write', counted: true });
  }
  const faults = JUDGE_CHECKS.map(([k]) => failed.get(k)).filter(Boolean);
  const grade = { overall: JUDGE_CHECKS.length - faults.length, of: JUDGE_CHECKS.length, faults, model: a.model };
  if (grade.overall < judge.target) {
    const lift = list.map((g) => String((g && g.lift) || '').trim()).filter(Boolean).join('\n');
    grade.lift = (lift || `Fix what falls short — ${faults.map((f) => `${CHECK_NAME[f.check].toLowerCase()}: ${f.why || `“${f.words}”`}`).join('; ')}.`).slice(0, 1200);
  }
  return grade;
}
/* the words a fault named, as they stand in the passage (its own spelling,
 * capitals and quotes) — or nothing when they are not there */
function evidence(text, words) {
  const w = String(words === undefined || words === null ? '' : words).replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, '').trim();
  if (!w) return '';
  const tries = [w, ...w.split(/\s*(?:…|\.\.\.)\s*/).filter((x) => x.length >= 12).sort((x, y) => y.length - x.length)];
  for (const t of tries) {
    const hit = findIn(text, t, { max: 1 })[0];
    if (hit) return text.slice(hit.start, hit.end);
  }
  return '';
}

/* one checking: these passages read (a passage longer than one request
 * carries, in parts); what it would change, kept */
async function checkBatch(novelId, conn, batch, limit = BATCH_WORDS) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', batch.chapterId);
  if (!novel || !chapter) return;
  const avoid = avoidList(house);
  const ci = chapterNumber(novel, chapter.id);
  const nums = passageNumbers(chapter);
  /* each passage as it read when asked — what comes back is kept only for those words */
  const asked = new Map();
  for (const p of batch.passages) {
    const v = picked(p);
    const text = String(v.text || '');
    asked.set(`${ci}.${nums.get(p.id)}`, { pid: p.id, vid: v.id, text, sig: sigOf(v), model: v.model || '', items: [], stock: stockIn(text), ask: askWords(v) });
  }
  const system = [checkerFrame(house, novel), avoidLine(avoid)].filter(Boolean).join('\n\n');
  const one = asked.size === 1 ? [...asked.entries()][0] : null;
  const numbered = one && countWords(one[1].text) > limit
    ? archivist.partsOf(one[1].text, limit).map((part) => `[${one[0]}] ${part}`)
    : [numberedText(novel, chapter, batch.passages)];
  /* the story right before them, so a slip against what was just written is caught —
   * and the passages are the truth where the notes lag behind them — as much of it
   * as the room left beside the passages holds (up to 6,000 characters; of the
   * chapter before, its last 2,500) */
  const lead = storyBefore(novel, chapter, batch.passages[0].id);
  const spare = archivist.readingRoom(conn, fixedOf(house, novel)) - Math.max(...numbered.map((x) => estimateTokens(x)));
  const keep = Math.max(0, Math.min(lead.from === 'last' ? 2500 : 6000, Math.floor(spare * 0.4 * 3.5)));
  const before = tailOf(lead.text, keep);
  /* what the writer is told too: his words for how it is written, and the chapters before as their summaries */
  const his = hisWords(house);
  const sofar = storySoFar(novel, chapter.id, Math.max(0, Math.min(4000, Math.floor(spare * 0.3))));
  const edits = [];
  const grades = [];
  const judge = judgeOf(house);
  /* what he asked the writer for in each passage this request carries (Cozy Tavern G3) */
  const askedOf = (words) => [...asked.entries()].filter(([n]) => words.includes(`[${n}]`)).map(([n, a]) => ({ n, words: a.ask }));
  for (const words of numbered) {
    /* the stock wording counted in what this request carries */
    const stock = {};
    for (const [n, a] of asked) {
      const here = [...new Set(a.stock.map((h) => h.words))].filter((w) => words.includes(w)).slice(0, 8);
      if (here.length) stock[n] = here;
    }
    const got = await archivist.askJson(conn, system, checkRequest({ novel, chapterLabel: chapterLabel(novel, chapter), numbered: words, avoid, before, beforeFrom: lead.from, judge, stock, his, sofar, asked: askedOf(words) }), { want: (o) => Array.isArray(o.edits) });
    await archivist.mustHold('checker', novelId);
    if (!got.ok) throw failed(got);
    edits.push(...got.obj.edits);
    if (Array.isArray(got.obj.grades)) grades.push(...got.obj.grades);
  }
  /* what he left as it is (as the chapter stands now) is not offered for that passage again */
  const now = store.peek('chapter', chapter.id) || chapter;
  const wasLeft = (a, find, replace) => ((now.checksLeft && now.checksLeft[a.pid]) || []).some((l) => l.find === find && l.replace === replace);
  for (const e of edits) {
    if (!e || typeof e !== 'object') continue;
    const ref = String(e.passage === undefined ? '' : e.passage).replace(/[^\d.]/g, '');
    const a = asked.get(ref) || (asked.size === 1 && !ref ? [...asked.values()][0] : null);
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
  for (const a of asked.values()) {
    /* a word he never wants that it let through: found here, and its sentence
     * offered to be written again (every such word of that sentence named) */
    for (const w of avoid) {
      for (const hit of avoidedIn(a.text, w)) {
        const s = sentenceAround(a.text, hit.start, hit.end);
        const same = a.items.find((x) => x.kind === 'avoid' && x.start === s.start && x.end === s.end);
        if (same) { if (!same.phrases.includes(w)) same.phrases.push(w); continue; }
        const sentence = a.text.slice(s.start, s.end);
        if (a.items.some((x) => overlaps(x, hit) || overlaps(x, s)) || wasLeft(a, sentence, null)) continue;
        a.items.push({ id: newId('sg'), kind: 'avoid', find: sentence, replace: null, phrase: w, phrases: [w], start: s.start, end: s.end });
      }
    }
    for (const x of a.items) if (x.kind === 'avoid' && x.replace === null) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} on your list of words to avoid`;
    /* stock wording counted that no fix here takes away: its sentence offered
     * to be written again, the same way */
    for (const hit of a.stock) {
      if (a.items.some((x) => overlaps(x, hit))) continue;
      const s = sentenceAround(a.text, hit.start, hit.end);
      const same = a.items.find((x) => x.stock && x.start === s.start && x.end === s.end);
      if (same) { if (!same.phrases.includes(hit.words)) same.phrases.push(hit.words); continue; }
      const sentence = a.text.slice(s.start, s.end);
      if (a.items.some((x) => overlaps(x, s)) || wasLeft(a, sentence, null)) continue;
      a.items.push({ id: newId('sg'), kind: 'humanize', find: sentence, replace: null, stock: true, phrases: [hit.words], start: s.start, end: s.end });
    }
    for (const x of a.items) if (x.stock) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} stock wording — far more common in machine-made fiction than in books people write`;
  }
  /* each passage's grade, from all it was answered (a passage read in parts: every part) */
  const graded = new Map();
  if (judge) {
    const byPassage = new Map();
    for (const g of grades) {
      if (!g || typeof g !== 'object') continue;
      const ref = String(g.passage === undefined ? '' : g.passage).replace(/[^\d.]/g, '');
      const a = asked.get(ref) || (asked.size === 1 && !ref ? [...asked.values()][0] : null);
      if (!a) continue;
      if (!byPassage.has(a.pid)) byPassage.set(a.pid, { a, list: [] });
      byPassage.get(a.pid).list.push(g);
    }
    for (const { a, list } of byPassage.values()) {
      const grade = judged(a, list, judge);
      if (grade) graded.set(a.pid, grade);
    }
  }
  const at = Date.now();
  for (const a of asked.values()) {
    a.items.sort((x, y) => x.start - y.start);
    const items = a.items.map(({ start, end, ...rest }) => rest);
    const grade = graded.get(a.pid) || null;
    /* under his mark: a suggestion of its own, to write it again toward it — or leave it */
    if (grade && judge && grade.overall < judge.target) items.unshift({ id: newId('sg'), kind: 'grade', find: '', replace: null, why: '', lift: grade.lift || '', target: judge.target, grade });
    store.change('chapter', chapter.id, chapterSteps.setCheck(a.pid, a.vid, { round: newId('ck'), sig: a.sig, at, items, ...(grade ? { grade } : {}) }), { checkpoint: true });
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
function keepWords(novelId, w, next, rest) {
  const { chapter, p, v, e } = w;
  const sig = hashText(next);
  const entry = { round: e.round, sig, at: Date.now(), items: rest };
  if (v.how === 'suggested' && v.round === e.round) {
    /* the helper had read these words: it is told what they were */
    archivist.retireIfSeen(novelId, chapter.id, p.id, v.id);
    store.change('chapter', chapter.id, chapterSteps.setVersion(p.id, v.id, { text: next, words: countWords(next) }), { now: true });
    store.change('chapter', chapter.id, chapterSteps.setCheck(p.id, v.id, entry), { now: true });
  } else {
    /* words fixed in place: where the version stops goes with them (cut short, stopped — its Go on stays: Tavern M511-1) */
    const version = newVersion({ text: next, how: 'suggested', round: e.round, from: v.id, words: countWords(next), ...(v.ask ? { ask: v.ask } : {}), ...endOf(v) });
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
        if ((c.duels && c.duels[key]) || duelTried.has(key)) continue;
        out.push({ chapterId: c.id, pid: p.id, x: v.id, y: u.id, key });
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
async function duel(novelId, conn, d) {
  const house = store.peek('house', 'house') || {};
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', d.chapterId);
  const p = chapter && (chapter.passages || []).find((x) => x.id === d.pid);
  const vx = p && (p.versions || []).find((v) => v.id === d.x);
  const vy = p && (p.versions || []).find((v) => v.id === d.y);
  if (!novel || !vx || !vy) return null;
  const pages = evenUp(String(vx.text || ''), String(vy.text || ''));
  const system = checkerFrame(house, novel);
  const lead = storyBefore(novel, chapter, p.id);
  const label = chapterLabel(novel, chapter);
  const his = hisWords(house);
  let sofar = '';
  const build = (first, second, before) => duelRequest({ novel, chapterLabel: label, before, beforeFrom: lead.from, asked: askedOf(vx), first, second, cut: pages.cut, his, sofar });
  const spare = archivist.readingRoom(conn, estimateTokens(system) + estimateTokens(build(pages.x, pages.y, '')));
  /* two pages that do not fit beside the notes are not read */
  if (spare < 0) return null;
  const before = tailOf(lead.text, Math.max(0, Math.min(lead.from === 'last' ? 2500 : 6000, Math.floor(spare * 0.4 * 3.5))));
  sofar = storySoFar(novel, chapter.id, Math.max(0, Math.min(4000, Math.floor(spare * 0.3))));
  const said = (o) => { const b = String(o.better || '').trim().toUpperCase(); return b === 'A' || b === 'B' ? b : 'same'; };
  const one = await archivist.askJson(conn, system, build(pages.x, pages.y, before), { want: (o) => typeof o.better === 'string' });
  if (!one.ok) return one.permanent ? { stop: failed(one) } : null;
  const two = await archivist.askJson(conn, system, build(pages.y, pages.x, before), { want: (o) => typeof o.better === 'string' });
  if (!two.ok) return two.permanent ? { stop: failed(two) } : null;
  const first = said(one.obj) === 'A' ? 'x' : said(one.obj) === 'B' ? 'y' : 'tie';
  const second = said(two.obj) === 'A' ? 'y' : said(two.obj) === 'B' ? 'x' : 'tie';
  const winner = first === second ? first : 'tie';
  await archivist.mustHold('checker', novelId);
  const row = { pid: p.id, x: vx.id, y: vy.id, xModel: vx.model, yModel: vy.model, winner, why: clean(winner === 'tie' ? '' : first === winner ? one.obj.why : two.obj.why, 300), at: Date.now() };
  store.change('chapter', chapter.id, chapterSteps.setDuel(d.key, row), { checkpoint: true });
  await store.flush('chapter', chapter.id);
  tell(novelId);
  return row;
}

/* a few pairs at a time (the rest in a moment); a pair that could not be read
 * is not asked again in a loop, and a connection turned away for good stops
 * the checker as any refusal does */
async function runDuels(novelId, conn) {
  let n = 0;
  for (const d of duelsDue(novelId)) {
    if (writerBusy(novelId)) { schedule(novelId, 4000); return; }
    if (n >= 3) { schedule(novelId, 3000); return; }
    n++;
    duelTried.add(d.key);
    const chapter = store.peek('chapter', d.chapterId);
    const novel = store.peek('novel', novelId);
    setState(novelId, 'checking', `Reading two versions of ${chapter && novel ? `${chapterLabel(novel, chapter, { withName: false })}, passage ${passageNumbers(chapter).get(d.pid)}` : 'a passage'} side by side…`);
    const out = await duel(novelId, conn, d);
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
  const n = stockIn(t).length;
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
      for (const f of e.grade.faults || []) fails.set(f.check, (fails.get(f.check) || 0) + 1);
    }
    for (const d of Object.values(c.duels || {})) {
      if (!d || !d.xModel || !d.yModel) continue;
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

/* every suggestion of a passage that has words to put in, applied at once */
/* HOW MUCH A FIX MAY CHANGE BY ITSELF (Cozy Tavern M259, M275): a mend is
 * small. Put in without him, no fix rewrites a large stretch or cuts much
 * away, and all of them together never change more than half the passage,
 * leave it shorter than 85% of what it was, or lose its ending — whatever is
 * bigger waits behind the bubble for him. */
export function changeShare(a, b) {
  const la = String(a).split('\n'); const lb = String(b).split('\n');
  const set = new Set(la);
  let same = 0;
  for (const line of lb) if (set.has(line)) same += 1;
  const byLines = 1 - same / Math.max(la.length, lb.length, 1);
  const words = (t) => String(t || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wa = words(a); const wb = words(b);
  const pool = new Map();
  for (const x of wb) pool.set(x, (pool.get(x) || 0) + 1);
  let kept = 0;
  for (const x of wa) { const c = pool.get(x) || 0; if (c > 0) { kept += 1; pool.set(x, c - 1); } }
  const byWords = 1 - kept / Math.max(wa.length, wb.length, 1);
  return Math.max(la.length, lb.length) <= 1 ? byWords : Math.max(byLines, byWords);
}
export function smallMend(before, after) {
  const b = String(before || ''); const a = String(after || '');
  if (Math.abs(a.length - b.length) > b.length * 0.5 || changeShare(b, a) > 0.5) return false;
  if (a.length < b.length * 0.85) return false;
  const lines = (t) => t.trim().split('\n');
  const lostEnding = lines(a).length < lines(b).length && !a.includes(b.trim().slice(-60).trim()) && lines(a).slice(-1)[0] !== lines(b).slice(-1)[0];
  return !lostEnding;
}
const smallFix = (item, text) => item.find.length <= Math.max(400, text.length * 0.4) && !(item.find.length > 120 && item.replace.length < item.find.length * 0.5);

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
    /* by itself: only a small fix (the rest wait for him) */
    if (byItself && !smallFix(item, text)) { rest.push(item); continue; }
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
/* his own words are never changed by themselves; only what a writer wrote whole is written again */
const HIS_HOW = ['mine', 'edit', 'imported'];
const LIFTABLE = ['write', 'another', 'rewrite', 'play'];
export const MAX_LIFTS = 2;
const liftsOf = (p) => (p.versions || []).filter((v) => v.lift);
const liftTried = new Set();
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
 *  - otherwise, with "Apply the fixes by themselves" on: every fix with words
 *    to put in goes in, one new version for the checking (Apply all, for that
 *    passage); sentences to write again stay behind the bubble.
 * One writing at a time, only while the writer is free; anything he asks the
 * writer meanwhile goes first (writer.js yieldAuto). */
function autoAfter(novelId) {
  const house = store.peek('house', 'house') || {};
  const a = autoOf(house);
  if (a.fix === null && a.lift === null) return;
  const judge = judgeOf(house);
  let next = null;
  for (const c of chaptersOf(novelId)) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      let v = picked(p);
      /* never by itself on a page cut short or stopped: it waits for its Go on (Cozy Tavern M552) */
      if (!v || v.streaming || v.cut || HIS_HOW.includes(v.how)) continue;
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
        if (under && LIFTABLE.includes(v.how) && (v.done || v.at || 0) >= a.lift && liftsOf(p).length < MAX_LIFTS && !liftTried.has(v.id) && (card.lift || g.lift)) {
          if (!next) next = { chapterId: c.id, passageId: p.id, v, note: card.lift || g.lift, lift: liftsOf(p).length + 1 };
          /* its fixes wait for the passage written again */
          continue;
        }
      }
      if (a.fix !== null && (v.done || v.at || 0) >= a.fix && (e.items || []).some((x) => typeof x.replace === 'string')) applyPassage(novelId, c.id, p.id, { byItself: true });
    }
  }
  if (next && !writerBusy(novelId) && !lifting.has(novelId)) {
    liftTried.add(next.v.id);
    const job = writeAgain({ novelId, chapterId: next.chapterId, passageId: next.passageId, note: next.note, fromVersion: next.v, lift: next.lift })
      .then((out) => { if (out && out.ok) archivist.nudge(novelId); return out; })
      .catch((err) => ({ ok: false, error: String((err && err.message) || err) }))
      .finally(() => lifting.delete(novelId));
    lifting.set(novelId, job);
  }
  tell(novelId);
}

export function forTests() { return { states, failures, blocked, timers, lifting, autoAfter, running: runningFor }; }
