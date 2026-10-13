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
import { connFor, connById, busy as writerBusy, recount } from './writer.js';
import * as archivist from './archivist.js';
import { picked, passageNumbers, chapterLabel, chapterNumber, chapterSteps, novelSteps, newVersion } from './shape.js';
import { numberedText } from './context.js';
import { checkerFrame, checkRequest, avoidList, avoidLine, notesText, aboutTheBook, CHECK_KINDS } from './prompts.js';
import { locate } from './changes.js';
import { findIn } from './search.js';
import { contextOf } from '../model/providers.js';
import { hashText, countWords, newId, plural, estimateTokens } from '../util.js';

/* ------------------------------------------------------------ who checks */

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

function retryLater(novelId) {
  const n = ((failures.get(novelId) || {}).n || 0) + 1;
  const ms = [60000, 180000, 600000][Math.min(n - 1, 2)];
  failures.set(novelId, { n, until: Date.now() + ms });
  const was = timers.get(novelId);
  if (was) { clearTimeout(was.t); timers.delete(novelId); }
  schedule(novelId, ms);
  return n;
}

/* ------------------------------------------------------------ the reading */

/* how many words one checking carries: about as many as a careful read takes
 * at once, and never more than the checker's model holds beside the notes */
const BATCH_WORDS = 2500;
function batchWords(conn, house, novel) {
  const fixed = estimateTokens(checkerFrame(house, novel)) + estimateTokens(notesText(novel, { forHelper: true })) + estimateTokens(aboutTheBook(novel, { plans: false })) + 900;
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
      failures.delete(novelId);
      setState(novelId, null);
    } catch (e) {
      const why = (e && e.message) || String(e);
      if (e && e.permanent) {
        blocked.set(novelId, archivist.connPrint(conn));
        failures.delete(novelId);
        setState(novelId, 'trouble', `The checker stopped: ${why}. It checks again once its connection changes (Settings → Connections, or Who does what).`);
        return;
      }
      const n = retryLater(novelId);
      setState(novelId, n >= 3 ? 'trouble' : 'retry', `The checker couldn’t finish just now (${why}). It tries again by itself in ${n >= 3 ? 'ten minutes' : n === 2 ? 'three minutes' : 'a minute'}.`);
    } finally {
      runningFor.delete(novelId);
      tell(novelId);
    }
  };
  /* one window checks a book at a time */
  if (globalThis.navigator && navigator.locks && navigator.locks.request) {
    await navigator.locks.request(`cozynovel-checker-${novelId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { schedule(novelId, 20000); return; }
      await work();
    });
  } else {
    await work();
  }
}

/* anything kept for a passage or version no longer in the chapter */
function stale(c) {
  for (const pid of Object.keys(c.checksLeft || {})) if (!(c.passages || []).some((x) => x.id === pid)) return true;
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
    asked.set(`${ci}.${nums.get(p.id)}`, { pid: p.id, vid: v.id, text: String(v.text || ''), sig: sigOf(v), items: [] });
  }
  const system = [checkerFrame(house, novel), avoidLine(avoid)].filter(Boolean).join('\n\n');
  const one = asked.size === 1 ? [...asked.entries()][0] : null;
  const numbered = one && countWords(one[1].text) > limit
    ? archivist.partsOf(one[1].text, limit).map((part) => `[${one[0]}] ${part}`)
    : [numberedText(novel, chapter, batch.passages)];
  const edits = [];
  for (const words of numbered) {
    const got = await archivist.askJson(conn, system, checkRequest({ novel, chapterLabel: chapterLabel(novel, chapter), numbered: words, avoid }), { want: (o) => Array.isArray(o.edits) });
    if (!got.ok) throw failed(got);
    edits.push(...got.obj.edits);
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
  /* a word he never wants that it let through: found here, and its sentence
   * offered to be written again (every such word of that sentence named) */
  for (const a of asked.values()) {
    for (const w of avoid) {
      for (const hit of avoidedIn(a.text, w)) {
        const s = sentenceAround(a.text, hit.start, hit.end);
        const same = a.items.find((x) => x.replace === null && x.start === s.start && x.end === s.end);
        if (same) { if (!same.phrases.includes(w)) same.phrases.push(w); continue; }
        const sentence = a.text.slice(s.start, s.end);
        if (a.items.some((x) => overlaps(x, hit) || overlaps(x, s)) || wasLeft(a, sentence, null)) continue;
        a.items.push({ id: newId('sg'), kind: 'avoid', find: sentence, replace: null, phrase: w, phrases: [w], start: s.start, end: s.end });
      }
    }
    for (const x of a.items) if (x.replace === null) x.why = `${quoted(x.phrases, 'and')} ${x.phrases.length === 1 ? 'is' : 'are'} on your list of words to avoid`;
  }
  const at = Date.now();
  for (const a of asked.values()) {
    a.items.sort((x, y) => x.start - y.start);
    const items = a.items.map(({ start, end, ...rest }) => rest);
    store.change('chapter', chapter.id, chapterSteps.setCheck(a.pid, a.vid, { round: newId('ck'), sig: a.sig, at, items }), { checkpoint: true });
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
    const version = newVersion({ text: next, how: 'suggested', round: e.round, from: v.id, words: countWords(next), ...(v.ask ? { ask: v.ask } : {}) });
    store.change('chapter', chapter.id, chapterSteps.addVersion(p.id, version), { now: true });
    store.change('chapter', chapter.id, chapterSteps.setCheck(p.id, version.id, entry), { now: true });
  }
  store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  recount(novelId);
  archivist.nudge(novelId, 8000);
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
function applyPassage(novelId, chapterId, passageId) {
  const w = where(chapterId, passageId);
  if (w.why) return 0;
  let text = String(w.v.text || '');
  const rest = [];
  let made = 0;
  for (const item of w.e.items || []) {
    if (typeof item.replace !== 'string') { rest.push(item); continue; }
    const spot = locate(text, item.find);
    if (spot.why) continue;
    text = text.slice(0, spot.start) + item.replace + text.slice(spot.end);
    made++;
  }
  if (!made) return 0;
  keepWords(novelId, w, text, rest);
  return made;
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

export function forTests() { return { states, failures, blocked, timers }; }
