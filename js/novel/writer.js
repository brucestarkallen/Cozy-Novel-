/* Cozy Novel — js/novel/writer.js
 *
 * The writing itself: the next part, another take, a rewrite (whole passage or
 * just the words he selected), going on from where a passage was cut, and his
 * own words. Each one is a VERSION on a passage, so nothing is ever thrown
 * away — the earlier take is one arrow away.
 *
 * A page that fails is never asked again by itself (his rule): what arrived is
 * kept and said to be cut, or, when nothing arrived, the real reason is shown
 * and he tries again by hand.
 */

import * as store from '../store.js';
import { ask, emptyWhy, stripControlLeak, finalWords } from '../model/call.js';
import { wireOf, splitPrefill } from '../model/providers.js';
import { newId, countWords, numberWords, hashText } from '../util.js';
import { assemble, requiredLength } from './context.js';
import { pickEntries } from './bibpick.js';
import { superOn, autoOf } from './auto.js';
import { chapterSteps, novelSteps, newPassage, newVersion, endOf, rootOf, keptTail, writtenWith, cutAtEnd, sameEnd, picked, requestOf, chapterLabel, countBook, chapterText, outcomeOf, hasWords, hisWordsIn, hisWordsBefore, chapterWords, chapterClosed, newChapter, premiseOf } from './shape.js';
import { writeRequest, rewriteRequest, selectionRequest, goOnRequest, playToProseRequest, leftOutWords, MARK_OPEN, MARK_CLOSE } from './prompts.js';
import { joinSoftWraps, finishTail, mendMarks, dropGluedStrays, dropTop, straysIn, dropMarkup, chapterEnds, partBlock, mendSpacing, marksOnlyResult } from './textshape.js';
import { renameIn } from './names.js';
import { changeInPlace, foldVersion, grownFields } from './inplace.js';

/* -------------------------------------------------------------- roles */

export function connById(house, id) {
  return ((house && house.connections) || []).find((c) => c.id === id) || null;
}
/* who does what: the writer; the partner and the helper default to the writer */
export function connFor(house, role) {
  const roles = (house && house.roles) || {};
  const own = roles[role] ? connById(house, roles[role]) : null;
  if (own) return own;
  return roles.writer ? connById(house, roles.writer) : null;
}
export function connName(c) { return c ? (c.name || c.model || 'a connection') : ''; }
/* The parts a connection has as Who does what stands now — the partner and
 * the helper go with the writer unless he set them, the checker with the
 * helper unless he set it or turned it off (Cozy Tavern M321: which one is
 * in use is said, never guessed). */
export const PART_WORDS = { writer: 'the writer', partner: 'the partner', helper: 'the helper', checker: 'the checker' };
/* the connection that does a part now (the checker: its own, or the helper's; none when switched off) */
export function holderOf(house, part) {
  const roles = (house && house.roles) || {};
  if (part !== 'checker') return connFor(house, part);
  return roles.checker === 'off' && !superOn(house) ? null : (roles.checker && roles.checker !== 'off' && connById(house, roles.checker)) || connFor(house, 'helper');
}
export function partsOf(house, id) {
  if (!id) return [];
  return ['writer', 'partner', 'helper', 'checker'].filter((role) => { const c = holderOf(house, role); return Boolean(c && c.id === id); });
}
/* the parts that go with the writer, set to "The same as the writer" (the checker through the helper) */
export function followersOf(house) {
  const roles = (house && house.roles) || {};
  const own = (role) => Boolean(roles[role] && connById(house, roles[role]));
  const out = ['partner', 'helper'].filter((r) => !own(r));
  if ((roles.checker !== 'off' || superOn(house)) && !own('checker') && out.includes('helper')) out.push('checker');
  return out;
}
export function partsWords(parts) {
  const w = (parts || []).map((p) => PART_WORDS[p]).filter(Boolean);
  return w.length <= 1 ? (w[0] || '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

/* ------------------------------------------------------- the running job */

const running = new Map();      /* novelId -> job */
const jobFns = new Set();
export function onJob(fn) { jobFns.add(fn); return () => jobFns.delete(fn); }
function tellJob(novelId) { for (const fn of jobFns) { try { fn(novelId, running.get(novelId) || null); } catch (e) { console.error(e); } } }
export function jobOf(novelId) { return running.get(novelId) || null; }
export function busy(novelId) { return running.has(novelId); }
export function stop(novelId) { const j = running.get(novelId); if (j) { if (j.auto) j.yielded = true; j.ctl.abort(); } }
/* the book, or the chapter being written, removed: the writing stops at once —
 * it is paid for word by word, and there is nowhere left to keep it */
export function stopIn(novelId, chapterId = null) {
  const j = running.get(novelId);
  if (!j || (chapterId && j.chapterId !== chapterId)) return false;
  j.gone = true;
  j.ctl.abort();
  return true;
}
/* a page the app is writing by itself (the judge's lift): his own hand comes first */
export function autoBusy(novelId) { const j = running.get(novelId); return Boolean(j && j.auto); }
/* Anything he asks the writer for, while the app writes by itself, goes first:
 * the app's page stops and is taken away whole — the version it lifted from on
 * show again — and his request runs. */
export async function yieldAuto(novelId) {
  const j = running.get(novelId);
  if (!j || !j.auto) return;
  j.yielded = true;
  j.ctl.abort();
  for (let i = 0; i < 200 && running.get(novelId) === j; i++) await new Promise((r) => setTimeout(r, 25));
}
export function anyRunning() { return running.size > 0; }

/* live words for the screen while a version is being written */
const liveFns = new Set();
export function onLive(fn) { liveFns.add(fn); return () => liveFns.delete(fn); }
function tellLive(ev) { for (const fn of liveFns) { try { fn(ev); } catch (e) { console.error(e); } } }

/* ---------------------------------------------------------- helpers */

function house() { return store.peek('house', 'house') || {}; }

/* the book as the store holds it right now (a newer copy from the phone
 * replaces the objects, so nothing holds on to old ones) */
function bookNow(novelId) {
  const novel = store.peek('novel', novelId);
  const chapters = {};
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  return { novel, chapters };
}

/* words in the chapters before this one (a scene's prose that opens a chapter after them: prompts.js playToProseRequest) */
function wordsBefore(book, chapterId) {
  const order = (book.novel && book.novel.order) || [];
  return order.slice(0, Math.max(0, order.indexOf(chapterId))).some((id) => ((book.chapters[id] || {}).passages || []).some(hasWords));
}

/* whether anyone checks the writing (checker.js checkerConn: his choice, or the helper's; "off" is nobody) */
function someoneChecks(h) {
  const roles = (h && h.roles) || {};
  if (roles.checker === 'off' && !superOn(h)) return false;
  return Boolean((roles.checker && connById(h, roles.checker)) || connFor(h, 'helper'));
}

/* before anything is added to the page: is there a writer, and is the book free? */
function preflight(novelId) {
  if (running.has(novelId)) return { ok: false, error: 'something is already being written in this book — Stop it first', busy: true };
  if (!connFor(house(), 'writer')) return { ok: false, error: 'no writer is chosen yet — add a connection in Settings → Connections', needsConnection: true };
  return null;
}

async function bookOf(novelId) {
  try {
    const opened = await store.open('novel', novelId);
    if (!opened) return { error: 'that book is not on the shelf any more' };
    const ids = [...(opened.order || [])];
    const tried = await Promise.allSettled(ids.map((id) => store.open('chapter', id)));
    /* the phone answered that it holds no such chapter (its record gone while
     * the book's list still names it): not part of the book, never a reason
     * to refuse the page; one the phone could not be asked about is */
    const gone = new Set(ids.filter((id, k) => tried[k].status === 'fulfilled' && !tried[k].value));
    /* The book can change while its chapters open. Work from its current
     * order, and never write across a chapter whose words could not load. */
    const novel = store.peek('novel', novelId);
    if (!novel) return { error: 'that book is not on the shelf any more' };
    const chapters = {};
    for (const id of novel.order || []) {
      const chapter = store.peek('chapter', id);
      if (!chapter && gone.has(id)) continue;
      if (!chapter) return { error: 'a chapter could not be read just now — the phone did not answer; ask again in a moment' };
      chapters[id] = chapter;
    }
    /* the book's list as the page shows it, so every chapter keeps its number; the one not there is told as such where it stands (context.js) */
    return { novel, chapters };
  } catch (e) {
    return { error: `the book could not be opened: ${(e && e.message) || String(e)}` };
  }
}

export async function recount(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const chapters = {};
  /* every chapter in hand first — one the phone answered it no longer holds counts no words, never stops the count for good */
  for (const id of novel.order || []) { const c = store.peek('chapter', id); if (c === undefined) return; if (c) chapters[id] = c; }
  const { words, chapters: n } = countBook(novel, chapters);
  if (novel.meta.words !== words || novel.meta.chapters !== n) store.change('novel', novelId, novelSteps.counts(words, n));
  /* his length goal, a quarter at a time: each quarter of a goal is said once (app.js) — words taken out and
   * written again never say it twice; a new goal counts its quarters afresh */
  const goal = Number(novel.meta.goal) || 0;
  if (goal > 0) {
    const reached = Math.min(4, Math.floor((words / goal) * 4));
    const mark = novel.meta.reached && typeof novel.meta.reached === 'object' && novel.meta.reached.goal === goal ? Number(novel.meta.reached.n) || 0 : 0;
    if (reached > mark) {
      store.change('novel', novelId, novelSteps.setMeta({ reached: { goal, n: reached } }));
      for (const fn of milestoneFns) { try { fn({ novelId, reached, words, goal }); } catch (_) { /* a notice only */ } }
    }
  }
}
const milestoneFns = new Set();
export function onMilestone(fn) { milestoneFns.add(fn); return () => milestoneFns.delete(fn); }

function keepSent(novelId, key, sent, extra) {
  if (!sent) return;
  const body = { ...sent, ...extra };
  /* what was sent is a convenience; the page is not — a keep that fails is said where it is looked up */
  store.keepSent(novelId, key, body);
}

/* the model's words, cleaned only of what can never be the story: a code fence
 * around the whole answer, a stray marker the request itself used */
function unfence(text) {
  const t = String(text || '');
  const fenced = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i.exec(t);
  return fenced ? fenced[1] : t;
}
export function tidyAnswer(text) {
  return unfence(text).replace(/^\s*\n/, '').replace(/\s+$/, '');
}

/* Text for matching by eye: runs of space as one, curly quotes as straight —
 * with where each matched character stood in the original. */
function looseWithMap(str) {
  const out = []; const map = [];
  let space = false;
  for (let i = 0; i < str.length; i++) {
    let ch = str[i];
    if (/\s/.test(ch)) { if (space) continue; space = true; ch = ' '; } else space = false;
    if (ch === '’' || ch === '‘') ch = "'";
    else if (ch === '“' || ch === '”') ch = '"';
    out.push(ch); map.push(i);
  }
  map.push(str.length);
  return { s: out.join(''), map };
}
/* the longest end of `before` that `text` begins with, read loosely — whole
 * words from where it starts, at least `min` characters; returns how much of
 * `text` that covers (0: none) */
function overlapAtStart(before, text, min = 5, max = 600) {
  const b = looseWithMap(String(before).slice(-max)).s.replace(/^ /, '');
  const t = looseWithMap(text);
  for (let k = Math.min(b.length, t.s.length); k >= min; k--) {
    const from = b.length - k;
    if (from > 0 && b[from - 1] !== ' ') continue;
    if (t.s.startsWith(b.slice(from))) return t.map[k];
  }
  return 0;
}
/* the longest start of `after` that `text` ends with — whole words to where
 * it stops, at least `min` characters */
function overlapAtEnd(after, text, min = 5, max = 600) {
  const a = looseWithMap(String(after).slice(0, max)).s.replace(/^ /, '');
  const t = looseWithMap(String(text).replace(/\s+$/, ''));
  for (let k = Math.min(a.length, t.s.length); k >= min; k--) {
    if (k < a.length && a[k] !== ' ') continue;
    if (t.s.endsWith(a.slice(0, k))) return String(text).replace(/\s+$/, '').length - t.map[t.s.length - k];
  }
  return 0;
}

/* The selection's new words, however the model gave them: just the new
 * words; or the whole passage again, with or without the marks; or the new
 * words with a little of what stands around them. What it repeated from
 * around the selection is taken off, so nothing is ever doubled. */
/* what was taken off, in his words: the marks themselves, a few */
export function markupNote(taken = []) {
  const shown = taken.slice(0, 3).map((x) => `“${x}”`).join(', ');
  return `Web page or code markup the writer left in the story${shown ? ` (${shown})` : ''} was taken off.`;
}

/* keepQuotes: the speech marks of these words are what is being set — quotation marks around the whole answer are its
 * own (2.12.35, the audit: taken off, they made speech narration) */
export function spliceSelection(fullText, start, end, answer, { keepQuotes = false } = {}) {
  let a = tidyAnswer(answer).trim();
  const before = fullText.slice(0, start);
  const after = fullText.slice(end);
  const open = a.indexOf(MARK_OPEN);
  const close = a.indexOf(MARK_CLOSE, open + 1);
  if (open >= 0 && close > open) a = a.slice(open + MARK_OPEN.length, close).trim();   /* it kept the marks: what is inside them */
  else {
    a = a.split(MARK_OPEN).join('').split(MARK_CLOSE).join('');
    const lead = before.trim() ? overlapAtStart(before, a) : 0;
    if (lead) a = a.slice(lead).replace(/^\s+/, '');
    const tail = after.trim() ? overlapAtEnd(after, a) : 0;
    if (tail) a = a.slice(0, a.length - tail).replace(/\s+$/, '');
  }
  /* quotation marks the model put around its whole answer, when the old words
   * had none — never the quotes of dialogue inside it */
  const old = fullText.slice(start, end).trim();
  const pairs = [['"', '"'], ['“', '”'], ['«', '»']];
  for (const [o, c] of keepQuotes ? [] : pairs) {
    const inner = a.slice(o.length, a.length - c.length);
    if (a.startsWith(o) && a.endsWith(c) && a.length > 2 && !(old.startsWith(o) && old.endsWith(c)) && !inner.includes(o) && !inner.includes(c)) { a = inner.trim(); break; }
  }
  const lead = fullText.slice(start, end).match(/^\s*/)[0];
  const trail = fullText.slice(start, end).match(/\s*$/)[0];
  return { text: before + lead + a + trail + after, from: start + lead.length, to: start + lead.length + a.length };
}

/* The helper, while it is reading this book right now: a page waits for it
 * five seconds at most, so its newest notes ride (Cozy Tavern M3); past that
 * the page goes, and its notes say which passages they have not read yet
 * (context.js). archivist.js sets this. */
let notesWait = null;
export function setNotesWait(fn) { notesWait = fn; }
/* the helper keeps the words it read of a version about to grow in place (Go on), so it reads what is added as a change — never the whole again as new (archivist.js retireIfSeen) */
let beforeGrow = null;
export function setBeforeGrow(fn) { beforeGrow = fn; }

/* -------------------------------------------------------- the one loop */

/* his connection with only the thinking seed of his prefill: what a passage
 * carried on, or a few words written again, is given (Cozy Tavern M585) */
function seedOnly(conn) {
  const seed = splitPrefill(String((conn && conn.prefill) || '')).seed;
  return { ...conn, prefill: seed ? '<think>' + seed : '' };
}
/* the thinking of the words carried on, then the thinking that carried them on */
function joinThought(before, after) {
  const a = String(before || '').trim();
  const b = String(after || '').trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n— then, carrying it on —\n\n${b}`;
}

/* Write one version: kind 'new' (a passage), 'version' (another on a passage),
 * 'append' (go on). Resolves {ok, error?, stopped?, notes?}. */
async function runVersion({ novelId, chapterId, passageId, versionId, base = '', original = null, mode, build, how, splice = null, length = 'scene', purpose = 'write', auto = false, keepEnd = null, hidden = false, showWhenDone = false, closing = false, carryEnd = false }) {
  const h = house();
  const conn = connFor(h, 'writer');
  const undo = () => undoEmpty(chapterId, passageId, versionId, mode, original);
  /* carried on, or a few selected words written again: never a page's
   * opening — his started reply and a structured template would begin it
   * again in the middle of the passage; only his thinking seed rides (Cozy
   * Tavern M585) */
  const carryOn = mode === 'append' || how === 'selection';
  const askConn = carryOn && conn ? seedOnly(conn) : conn;
  /* carried on: the thinking of the words before stays, the new thinking after it (Tavern M674) */
  const thoughtBefore = mode === 'append' && original ? String(original.thinking || '') : '';
  const thoughtOf = (t) => joinThought(thoughtBefore, t);
  if (running.has(novelId) || !conn) { undo(); return preflight(novelId) || { ok: false, error: 'the writer could not start' }; }
  const ctl = new AbortController();
  const job = { kind: how, chapterId, passageId, versionId, ctl, at: Date.now(), conn: connName(conn), auto: Boolean(auto) };
  /* (a fix by itself: his switch or Super automatic; a passage under his mark: his switch — auto.js autoOf) */
  const autoKind = auto ? (how === 'selection' ? 'fix' : 'lift') : '';
  const autoFrom = autoKind ? autoOf(h)[autoKind] : null;
  /* Switching automatic writing off ends the permission that started this
   * attempt. Switching it on again starts a new period, never revives it. */
  const automaticAllowed = () => {
    if (!job.auto) return true;
    const current = autoOf(house())[autoKind];
    if (!job.yielded && current !== null && current === autoFrom) return true;
    job.yielded = true;
    ctl.abort();
    return false;
  };
  const unwatchAuto = auto ? store.subscribe('house', 'house', automaticAllowed) : () => {};
  /* written off the page: what was on show as it began — shown once whole only while that is still on show (a version
   * he put on show meanwhile stays) */
  const shownAt = () => { const c = store.peek('chapter', chapterId); const p = c && (c.passages || []).find((x) => x.id === passageId); return (p && picked(p)) || null; };
  const shownBefore = showWhenDone ? (shownAt() || {}).id : null;
  const ownsPage = () => {
    const novel = store.peek('novel', novelId);
    const chapter = store.peek('chapter', chapterId);
    if (!novel || !(novel.order || []).includes(chapterId) || !chapter) return false;
    const passage = (chapter.passages || []).find((p) => p.id === passageId);
    return Boolean(passage && (passage.versions || []).some((v) => v.id === versionId));
  };
  /* what the page hears as words arrive: a page the app writes by itself says so (the page never follows it); one
   * written off the page says so too — nothing of it is painted until it is done */
  const live = (ev) => tellLive({ ...ev, ...(job.auto ? { auto: true } : {}), ...(hidden ? { hidden: true } : {}) });
  running.set(novelId, job);
  tellJob(novelId);
  let text = '';
  let thinking = '';
  let lastSave = Date.now();
  /* how often the words so far are kept while they stream: every three seconds for a small chapter, up to twelve for
   * one of megabytes — each keep sends the whole chapter to the phone, which held the page and the stream for it
   * (2.12.5); other windows see the page grow at this pace, and a tab Android closes loses at most this much */
  const keepEvery = () => Math.min(12000, 3000 + Math.round(store.sizeOf('chapter', chapterId) / 300));
  /* carried on: shown once the words it repeats have arrived, so the join never flickers */
  const shown = () => (splice ? (mode === 'append' && text.trim().length < 40 ? splice('').text : splice(text).text) : base + text);
  /* a heartbeat: another window can tell a page being written from one whose
   * writer closed (repairStale) */
  const alive = () => ({ beat: Date.now(), tab: store.CLIENT, browser: store.BROWSER });
  const checkpoint = () => {
    if (!ownsPage()) { job.gone = true; ctl.abort(); return; }
    if (!automaticAllowed()) return;
    lastSave = Date.now();
    const words = shown();
    store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, { text: words, thinking: thoughtOf(thinking) || undefined, ...alive() }), { checkpoint: true, delay: 50 });
  };
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, alive()), { checkpoint: true, delay: 50 });
  /* and it beats while the model is silent too (a long think that streams
   * nothing), so another window never takes a page still being written for
   * one whose window closed */
  const beating = setInterval(() => { if (Date.now() - lastSave > 25000) checkpoint(); }, 30000);
  /* what this page is handed, as the book stands at the moment it is asked — with what the pick named (bibpick.js) */
  const assembleFor = (c, picks) => {
    const { novel, chapters } = bookNow(novelId);
    return assemble({ house: h, novel, chapters, conn: c, purpose, target: build.target, request: build.request, length, play: build.play, moment: build.moment || '', picks });
  };
  try {
    /* what the page needs from his bibliography that no word near it names (bibpick.js) — asked while the page waits
     * for a reading on its way, so the one wait is not added to the other; none, and the page goes as it would. A few
     * words written again inside a passage are not asked for: the passage around them carries its names */
    const picking = how === 'selection' ? Promise.resolve({ refs: [] }) : (() => {
      try {
        const { novel, chapters } = bookNow(novelId);
        /* (dry: the request as it would go without a pick — when the whole bibliography is in it, nothing is asked) */
        return pickEntries({ conn: connFor(h, 'helper'), house: h, novel, chapters, purpose, target: build.target, request: build.request, moment: build.moment || '', play: build.play, signal: ctl.signal,
          dry: () => assembleFor(conn, []).stats }).catch(() => ({ refs: [] }));
      } catch (e) { console.error(e); return Promise.resolve({ refs: [] }); }
    })();
    if (notesWait) { try { await notesWait(novelId, 5000, ctl.signal); } catch (_) { /* it goes anyway */ } }
    const picks = (await picking).refs || [];
    if (!automaticAllowed()) { undo(); await store.flush('chapter', chapterId); return { ok: false, stopped: true, yielded: true }; }
    /* what the last request built held of the chapter open (context.js stats) */
    let told = null;
    const out = await ask(askConn, {
      build: (c) => {
        if (!ownsPage()) { job.gone = true; throw new Error('that passage is not there any more'); }
        if (!automaticAllowed()) throw new Error('automatic writing stopped');
        const a = assembleFor(c, picks);
        told = a.stats;
        return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, length) : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse, least: a.stats.least, seed: a.seed };
      },
      stream: true,
      signal: ctl.signal,
      noStructured: carryOn,
      onText: (s) => {
        if (!ownsPage()) { job.gone = true; ctl.abort(); return; }
        if (!automaticAllowed()) return;
        text += s;
        live({ novelId, chapterId, passageId, versionId, text: shown(), thinking: thoughtOf(thinking), phase: 'text' });
        if (Date.now() - lastSave > keepEvery()) checkpoint();
      },
      onThinking: (s) => {
        if (!ownsPage()) { job.gone = true; ctl.abort(); return; }
        if (!automaticAllowed()) return;
        thinking += s;
        live({ novelId, chapterId, passageId, versionId, text: shown(), thinking: thoughtOf(thinking), phase: 'thinking' });
        /* a long, silent think still beats */
        if (Date.now() - lastSave > 20000) checkpoint();
      },
    });
    /* the book or the chapter was removed while it wrote: nothing is left to keep it in */
    if (job.gone || !ownsPage()) return { ok: false, stopped: true, gone: true };
    /* carried on: its request kept beside the first part's, never over it (Tavern M674) */
    const more = mode === 'append' && original && original.sent;
    const key = more ? `${versionId}-g${((original.sentMore || []).length) + 2}` : versionId;
    /* the thinking as it is kept: the call's own (a thought it never opened set apart), else what streamed */
    const thought = typeof out.thinking === 'string' ? out.thinking : thinking;
    /* words that are never the story: a provider's leaked control token, or
     * his next request typed out by a model that ran past its end (Tavern
     * M117, M469) — the answer is what came before */
    const leak = stripControlLeak(finalWords(out, text), { asked: build.request || '' });
    const notes = [...(out.notes || [])];
    /* the chapter open told in part to fit its model's room: he is told too, not only the writer — what was told how */
    const fitHow = told && told.chapterFit;
    if (fitHow && fitHow.before === 'stretches') notes.push('This chapter is longer than the writer’s room: its earlier stretches were sent by their summaries, and the words leading up to this point word for word.');
    else if (fitHow && fitHow.before === 'stretches-cut') notes.push('This chapter is longer than the writer’s room even by its stretches’ summaries: the summaries and the words right before this point were sent, and some of the words between them left out.');
    else if (fitHow && fitHow.before === 'cut') notes.push('This chapter is longer than the writer’s room, so it was sent its opening and the words right before this point, with the middle left out.');
    if (fitHow && fitHow.after === 'cut') notes.push('What follows this point in the chapter was sent only in part, to fit the writer’s room.');
    /* a chapter the book's list names that the phone no longer holds: written without it, never silently */
    if (told && told.unreadChapters > 0) notes.push(`${told.unreadChapters === 1 ? 'One chapter' : `${numberWords(told.unreadChapters)} chapters`} in the book’s list ${told.unreadChapters === 1 ? 'is' : 'are'} not on the phone, so the writer was told ${told.unreadChapters === 1 ? 'it' : 'they'} could not be read.`);
    if (told && told.omitted > 0) notes.push(leftOutWords(told.omitted));
    if (leak.leaked) notes.push(leak.ranPast ? 'The writer ran past the end of its answer and began writing your next request — the words before that were kept.' : 'The words before the provider’s leak were kept.');
    let answer = mode === 'append' ? unfence(leak.text).replace(/\s+$/, '') : tidyAnswer(leak.text);
    /* SUPER AUTOMATIC — the chapter ends here (prompts.js closeLine): the writer's line taken off before anything else
     * reads the end of the page, and the version kept as the one that ends its chapter */
    let endsChapter = false;
    const endLine = closing ? chapterEnds(answer) : null;
    if (endLine && endLine.found) {
      answer = mode === 'append' ? endLine.text.replace(/\s+$/, '') : endLine.text;
      endsChapter = endLine.ended;
    }
    /* the page made whole before it is kept — white space and its end only,
     * never a word of the story (Cozy Tavern M476, M510-34): a soft wrap the
     * model let through joined; a note to him after the story taken off and
     * kept with the version, to put back from the passage's menu */
    let tookOff = '';
    let topOff = '';
    if (how !== 'selection') {
      /* a plan or a heading above a new page — never one carried on (Cozy Tavern M116, M322–M326) */
      if (mode !== 'append') {
        const ch = store.peek('chapter', chapterId);
        const top = dropTop(answer, { names: [ch && ch.name].filter(Boolean) });
        if (top.removed) {
          answer = top.text;
          topOff = top.removed;
          const what = top.plan && top.heading ? 'The writer’s plan and a heading above the page were' : top.plan ? 'The writer’s plan for the page, written above it, was' : 'A heading the writer put above the page was';
          notes.push(`${what} taken off — the passage’s menu puts ${top.plan && top.heading ? 'them' : 'it'} back.`);
        }
      }
      answer = joinSoftWraps(answer);
      /* carried on: the story the passage already holds counts toward what must stay — the new part still has to bring some */
      const held = mode === 'append' && original ? String(original.text || '').replace(/\s+/g, ' ').trim().length : 0;
      const fin = finishTail(answer, { minLeft: Math.max(1, 200 - held) });
      if (fin.removed) {
        answer = fin.text.replace(/\s+$/, '');
        tookOff = fin.removed;
        const what = fin.kinds.includes('tracking') && fin.kinds.includes('note') ? 'A block of tracking and a note to you' : fin.kinds.includes('tracking') ? 'A block of tracking' : 'A note to you';
        notes.push(`${what} after the story ${fin.kinds.length > 1 ? 'were' : 'was'} taken off the page — the passage’s menu puts ${fin.kinds.length > 1 ? 'them' : 'it'} back.`);
      }
    }
    /* (Super automatic) what the writer put after its line that is not story — a note, the next chapter's heading, an
     * announcement of it — came off with the line: kept with the version, the passage's menu puts it back (2.12.35) */
    if (endLine && endLine.matter) {
      tookOff = [tookOff, endLine.matter].filter((x) => String(x || '').trim()).join('\n\n');
      notes.push('What the writer wrote after the chapter’s end — a note or the next chapter’s heading — was taken off the page; the passage’s menu puts it back.');
    }
    /* (Super automatic) what followed the writer's line was its note to him or its tracking, taken off the page just
     * now: the chapter ended there all the same — story after it, kept on the page, and it goes on */
    if (endLine && endLine.found && !endsChapter && endLine.before.trim()) {
      const flat = (t) => String(t || '').replace(/\s+/g, ' ').trim();
      endsChapter = !flat(answer).includes(flat(endLine.after).slice(0, 60));
    }
    /* a web page's or code's markup left in the new words ("…paid for.</code>",
     * his report 2.12.2) is never the story: taken off before the page is kept —
     * the words only, his own around a selection never touched */
    if (how === 'selection') {
      const lead = answer.match(/^\s*/)[0];
      const trail = answer.match(/\s*$/)[0];
      const marked = dropMarkup(answer.trim());
      if (marked.changed) { answer = lead + marked.text + trail; notes.push(markupNote(marked.taken)); }
    }
    let finalText = splice ? splice(answer).text : base + answer;
    /* the marks a model left open closed, and a stray of another script
     * stuck to the front of a word taken off — marks only, never a word, and
     * only what is new (Go on: never the words it carries on), never the
     * unfinished end of a page that was cut (Cozy Tavern M458, M626) */
    if (how !== 'selection') {
      const from = mode === 'append' && original ? original.text.length : 0;
      const unglued = dropGluedStrays(finalText, { from });
      if (unglued.changed) notes.push('A stray character of another script, stuck to the front of a word, was taken off.');
      const unmarked = dropMarkup(unglued.text, { from });
      if (unmarked.changed) notes.push(markupNote(unmarked.taken));
      /* a whole new page that came as one block: parted where speech begins (Cozy Tavern M510-17) */
      const parted = from === 0 ? partBlock(unmarked.text).text : unmarked.text;
      finalText = mendMarks(parted, { from, leaveLast: Boolean(out.cut || out.stopped) }).text;
      /* a space a slip of the hand left out or put in — white space only (2.12.35) */
      finalText = mendSpacing(finalText, { from, leaveLast: Boolean(out.cut || out.stopped) }).text;
      /* one standing loose ("the 틀 door") is not taken off by itself — a word may hang on it: said, for the checker to mend or for him (Cozy Tavern M119) */
      const loose = straysIn(finalText).filter((x) => x.start >= from);
      if (loose.length) notes.push(`A stray character of another script stands in it (“…${loose[0].words}…”) — ${someoneChecks(h) ? 'the checker offers to mend it, or Edit takes it out' : 'Edit takes it out'}.`);
    }
    /* a name changed everywhere while this was written: the page reads it as
     * the book does now (Cozy Tavern's M730 — work begun before the change is
     * given it when it lands) */
    const renamedSince = ((((store.peek('novel', novelId) || {}).memory || {}).renames) || []).filter((x) => x.at >= job.at);
    if (renamedSince.length && String(finalText).trim()) {
      const named = renameIn(finalText, renamedSince);
      if (named !== finalText) { finalText = named; notes.push(`A name was changed everywhere while this was written — it reads ${renamedSince.map((x) => x.to).join(', ')} here too.`); }
    }
    const arrived = String(answer).trim();
    /* the app's own page, given way to his hand: taken away whole */
    if (job.yielded || !automaticAllowed()) {
      undo();
      await store.flush('chapter', chapterId);
      return { ok: false, stopped: true, yielded: true };
    }
    if (!arrived && endLine && endLine.found && closing && !out.stopped) {
      /* only the writer's line came: the chapter ends where it already stops (2.12.35 — through 2.12.34 this was said as
       * "the model sent back nothing"). The empty page goes; the chapter's last page is the one that ends it */
      undo();
      const ch = store.peek('chapter', chapterId);
      const lastPage = ch && [...(ch.passages || [])].reverse().find((x) => hasWords(x));
      const lastV = lastPage && picked(lastPage);
      /* (a last page cut short is not finished: it cannot end the chapter, and nothing is said to) */
      const ends = Boolean(lastV && !lastV.streaming && !lastV.cut);
      if (ends) store.change('chapter', chapterId, chapterSteps.setVersion(lastPage.id, lastV.id, { closes: true }), { now: true });
      await store.flush('chapter', chapterId);
      return { ok: false, endedHere: ends, error: ends ? 'the writer said the chapter ends where it already stops — nothing new was written, and your next page goes in the next chapter' : 'the writer said the chapter ends here and wrote nothing new — its last page is not finished, so nothing was changed' };
    }
    if (!arrived) {
      /* nothing came: the empty version goes, and the reason is said — and
       * what it thought is handed back, never thrown away (Tavern M301) */
      undo();
      await store.flush('chapter', chapterId);
      const kept = String(thought || '').trim() ? thought : undefined;
      if (out.stopped) return { ok: false, stopped: true, thought: kept };
      const error = leak.leaked && finalWords(out, text).trim() ? 'the answer held nothing before the provider’s own markers' : out.ok ? emptyWhy(out, thought) : out.error;
      /* a passing fault (no answer, busy, down) — said apart, so what the app writes by itself tries again another time */
      const st = Number(out.status) || 0;
      const passing = !out.ok && !out.permanent && (st === 0 || st === 408 || st === 429 || st >= 500);
      return { ok: false, error, notes, thought: kept, ...(passing ? { passing: true, ...(Number.isFinite(out.retryAfterMs) && out.retryAfterMs > 0 ? { retryAfterMs: out.retryAfterMs } : {}) } : {}) };
    }
    const cutWhy = out.stopped ? 'you stopped it'
      : !out.cut ? undefined
        : out.cutBy === 'provider' ? `the provider broke off: ${out.error || ''}`.trim()
          : out.cutBy === 'filter' ? `the provider stopped it (its reason: ${out.reason || 'not given'})`
            : out.cutBy === 'quiet' ? 'the answer ended without the provider saying it was finished'
              : out.cutBy === 'closed' ? 'the structured answer closed mid-sentence — a quote the model wrote bare ends its text'
                : out.cutBy === 'stalled' ? 'the structured answer stopped making progress, so it was let go'
                  : 'it reached the reply length';
    /* a few words rewritten in the middle of a passage cut at its end: the end is still cut, and Go on is still offered */
    const own = Boolean(out.cut || out.stopped);
    /* some words written again are written whole or not at all: words broken off in the middle of a passage are never
     * a page (2.12.3 kept them on show — "something went wrong partway", the rest of the sentence gone). The words
     * before stay as they were, and why is said */
    if (how === 'selection' && own) {
      undo();
      await store.flush('chapter', chapterId);
      if (out.stopped) return { ok: false, stopped: true };
      return { ok: false, error: `the new words were not finished (${cutWhy}) — nothing was changed`, notes, unfinished: true };
    }
    const endKept = !own && keepEnd && keepEnd.cut ? keepEnd : null;
    /* (Super automatic) the version ends its chapter: said so by the writer, or "The rest of the chapter" written to its
     * end — never a page cut short; a rewrite of one that ended it ends it too */
    const ends = !own && ((closing && (endsChapter || length === 'chapter')) || carryEnd);
    const patch = {
      closes: ends ? true : undefined,
      text: finalText,
      thinking: thoughtOf(thought) || undefined,
      streaming: undefined, beat: undefined, tab: undefined, browser: undefined,
      cut: own || endKept ? true : undefined,
      stopped: out.stopped ? true : endKept && endKept.stopped ? true : undefined,
      cutWhy: own ? cutWhy : endKept ? endKept.cutWhy : undefined,
      endCut: endKept || (mode === 'append' && own && original && original.how === 'selection') ? true : undefined,
      /* carried on: what was said of the first part stays with what is said now */
      notes: (() => { const all = [...new Set([...(mode === 'append' && original ? original.notes || [] : []), ...notes])]; return all.length ? all.slice(-8) : undefined; })(),
      /* what the provider's own web search looked at, when he let it look things up */
      sources: (() => { const all = [...(mode === 'append' && original ? original.sources || [] : []), ...(out.sources || [])].filter((x, i, a) => x && a.findIndex((y) => y && y.url === x.url) === i); return all.length ? all.slice(0, 20) : undefined; })(),
      usage: out.usage || undefined,
      /* how big the request was: the provider's own count, or the app's when it gave none */
      tokensIn: out.usage && Number.isFinite(out.usage.in) ? out.usage.in : (out.sent && Number.isFinite(out.sent.tokens) ? out.sent.tokens : undefined),
      tokensCounted: out.usage && Number.isFinite(out.usage.in) ? true : undefined,
      ms: out.sent ? out.sent.ms : undefined,
      model: conn.model,
      /* carried on by another writer: no longer one writer's words (the judge's head to head and its counts leave it out) */
      carried: mode === 'append' && original && (original.carried || (original.model && original.model !== conn.model)) ? true : undefined,
      conn: connName(conn),
      sent: more ? original.sent : out.sent ? key : undefined,
      sentMore: more ? (out.sent ? [...(original.sentMore || []), key] : original.sentMore) : undefined,
      /* carried on: what came off the first part is kept beside what came off now; a few words written again keep what their passage had (keptTail) */
      ...(how === 'selection' ? {} : { tookOff: [mode === 'append' && original ? original.tookOff : '', tookOff].filter((x) => String(x || '').trim()).join('\n\n') || undefined }),
      ...(topOff ? { tookOffTop: topOff } : {}),
      words: countWords(finalText),
      done: Date.now(),
      /* carried on: the words as the writer wrote them, and the words before a change in place, carry on too */
      ...(mode === 'append' && original && finalText.startsWith(original.text) ? grownFields({ ...(versionNow(chapterId, passageId, versionId) || {}), text: original.text }, finalText.slice(original.text.length)) : {}),
    };
    store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, patch), { checkpoint: true, now: true });
    /* written off the page: on show once it is whole */
    if (showWhenDone && (shownAt() || {}).id === shownBefore) store.change('chapter', chapterId, chapterSteps.pick(passageId, versionId), { now: true });
    store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
    keepSent(novelId, key, out.sent, { purpose: how, chapterId, passageId });
    await store.flush('chapter', chapterId);
    recount(novelId);
    return { ok: true, cut: patch.cut, notes, passageId };
  } catch (e) {
    if (job.gone || !ownsPage()) return { ok: false, stopped: true, gone: true };
    if (!automaticAllowed()) {
      undo();
      await store.flush('chapter', chapterId);
      return { ok: false, stopped: true, yielded: true };
    }
    try {
      /* (some words written again: whole or not at all) */
      if (job.yielded || !String(text || '').trim() || how === 'selection') undo();
      else store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, { text: shown(), thinking: thoughtOf(thinking) || undefined, streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true, cutWhy: 'something went wrong partway' }), { now: true });
    } catch (_) { /* the record is gone */ }
    return { ok: false, error: (e && e.message) || String(e), thought: !String(text || '').trim() && thinking.trim() ? thinking : undefined };
  } finally {
    unwatchAuto();
    clearInterval(beating);
    running.delete(novelId);
    tellJob(novelId);
    live({ novelId, chapterId, passageId, versionId, done: true });
  }
}

/* nothing arrived: what was added for it goes, and a passage that was only
 * being carried on keeps exactly the words — and the "it stopped partway" —
 * it had */
function undoEmpty(chapterId, passageId, versionId, mode, original) {
  const quiet = { streaming: undefined, beat: undefined, tab: undefined, browser: undefined };
  try {
    if (mode === 'new') store.change('chapter', chapterId, chapterSteps.removePassage(passageId), { now: true });
    else if (mode === 'version') store.change('chapter', chapterId, chapterSteps.removeVersion(passageId, versionId), { now: true });
    else store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, original === null ? quiet
      : { ...quiet, text: original.text, cut: original.cut || undefined, cutWhy: original.cutWhy || undefined, stopped: original.stopped || undefined, endCut: original.endCut || undefined,
        /* and the thinking it had, never the thinking of the call that brought nothing (Tavern M674) */
        thinking: original.thinking || undefined }), { now: true });
  } catch (_) { /* the record is gone */ }
}

/* A page being written when its window closed (Android put the tab away)
 * would say "Being written…" forever: one whose writer is gone — its tab
 * closed in this browser, or no heartbeat for two minutes from anywhere — is
 * set right: what arrived stays, said to be cut, so Go on carries it on; a
 * version that never got a word goes. */
export const STALE_MS = 2 * 60 * 1000;
export async function repairStale(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return 0;
  const job = running.get(novelId);
  const tabs = await store.liveTabs();
  let fixed = 0;
  for (const cid of novel.order || []) {
    const c = store.peek('chapter', cid);
    if (!c) continue;
    for (const p of c.passages || []) {
      for (const v of p.versions || []) {
        if (!v.streaming) continue;
        if (job && job.passageId === p.id && job.versionId === v.id) continue;
        const here = v.browser && v.browser === store.BROWSER && tabs;
        const gone = here ? !tabs.has(v.tab) : Date.now() - (v.beat || v.done || v.at || 0) > STALE_MS;
        if (!gone) continue;
        /* some words written again, its window closed partway: whole or not at all — the words before stay on show */
        if (v.how === 'selection' && p.versions.length > 1) {
          const onShow = (picked(p) || {}).id === v.id;
          store.change('chapter', cid, chapterSteps.removeVersion(p.id, v.id), { now: true });
          if (onShow && p.versions.some((x) => x.id === v.base)) store.change('chapter', cid, chapterSteps.pick(p.id, v.base), { now: true });
        } else if (!String(v.text || '').trim()) {
          if (p.versions.length < 2) store.change('chapter', cid, chapterSteps.removePassage(p.id), { now: true });
          else store.change('chapter', cid, chapterSteps.removeVersion(p.id, v.id), { now: true });
        } else {
          store.change('chapter', cid, chapterSteps.setVersion(p.id, v.id, { streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true,
            cutWhy: 'the writing stopped when its window closed' }), { now: true });
        }
        fixed++;
      }
    }
  }
  if (fixed) recount(novelId);
  return fixed;
}

/* Some words written again that broke off partway, kept through 2.12.3 as a
 * version — on show, cut, the rest of the sentence gone ("something went
 * wrong partway", the reply ran out, its window closed): the words it was
 * written from are on show again and it goes. Never one he changed since or
 * put on show himself. How many passages. */
export function repairBrokenWords(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return 0;
  let n = 0;
  for (const cid of novel.order || []) {
    const c = store.peek('chapter', cid);
    for (const p of (c && c.passages) || []) {
      for (const v of [...(p.versions || [])]) {
        /* (changed since: by any hand, or by a name changed everywhere, which is no one's hand — shape.js inPlaceFields, 2.12.41) */
        if (v.how !== 'selection' || v.streaming || !v.cut || v.endCut || v.chosen || (Array.isArray(v.hands) && v.hands.length) || (Array.isArray(v.before) && v.before.length)) continue;
        if ((p.versions || []).length < 2 || !(p.versions || []).some((x) => x.id === v.base)) continue;
        const live = store.peek('chapter', cid);
        const lp = live && (live.passages || []).find((x) => x.id === p.id);
        const onShow = lp && (picked(lp) || {}).id === v.id;
        store.change('chapter', cid, chapterSteps.removeVersion(p.id, v.id), { now: true });
        if (onShow) store.change('chapter', cid, chapterSteps.pick(p.id, v.base), { now: true });
        n++;
      }
    }
  }
  if (n) recount(novelId);
  return n;
}

/* -------------------------------------------------------- what he asks */

/* The next part of the chapter (at its end, or after a given passage). */
export async function writeNext({ novelId, chapterId, direction = '', length = 'scene', after = null }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  if (book.error) return { ok: false, error: book.error };
  const chapter = book.chapters[chapterId];
  if (!chapter) return { ok: false, error: 'that chapter is not in the book any more' };
  const list = chapter.passages || [];
  const at = after ? list.findIndex((p) => p.id === after) : -1;
  /* between two passages only when words follow it (a scene break or an
   * empty page after it is not text to bridge to) */
  const between = at >= 0 && list.slice(at + 1).some(hasWords);
  /* what wakes a rule: what he asks for, with the words he is carrying on —
   * the premise, or a passage of his, right before the point */
  const moment = [direction, hisWordsBefore(list, at >= 0 ? at : list.length - 1)].map((x) => String(x || '').trim()).filter(Boolean).join('\n');
  const empty = !list.slice(0, at >= 0 ? at + 1 : list.length).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
  const passage = newPassage('ai', '', { how: 'write', ask: { direction, length }, streaming: true });
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, at >= 0 ? after : null), { now: true });
  /* Super automatic: the writer may end the chapter here (prompts.js closeLine) — never between two passages, nor on its
   * opening page, but for the rest of a chapter written whole */
  const closing = superOn(house()) && !between && (!empty || length === 'chapter');
  const request = writeRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), direction, length, empty,
    firstOfBook: empty && book.novel.order.indexOf(chapterId) === 0, between, outcome: outcomeOf(book.novel), close: closing ? { words: chapterWords(chapter) } : null });
  return runVersion({ novelId, chapterId, passageId: passage.id, versionId: passage.versions[0].id, mode: 'new', how: 'write', length, closing,
    build: { target: { chapterId, before: passage.id }, request, moment } });
}

/* What wakes a rule for a passage written again or carried on: his note for
 * it, with the words of his that made it — a passage of his is his words
 * itself, and ends the search — or else the premise it carried on. Never
 * the writer's prose (crafts.js). Read before a new version is added: the
 * passage then shows the words being written again. */
function momentOf(chapter, passage, note = '') {
  const list = (chapter && chapter.passages) || [];
  const i = list.indexOf(passage);
  const own = hisWordsIn(passage);
  const carried = own || passage.by === 'you' ? own : hisWordsBefore(list, i - 1);
  return [note, carried].map((x) => String(x || '').trim()).filter(Boolean).join('\n');
}

/* nothing comes after this passage anywhere in the book: no passage with
 * words after it in its chapter, no later chapter with any */
function lastInBook(book, chapterId, passageId) {
  const chapter = book.chapters[chapterId];
  const list = (chapter && chapter.passages) || [];
  const i = list.findIndex((x) => x.id === passageId);
  if (list.slice(i + 1).some((x) => x.by !== 'break' && String((picked(x) || {}).text || '').trim())) return false;
  const order = book.novel.order || [];
  return !order.slice(order.indexOf(chapterId) + 1).some((id) => chapterText(book.chapters[id]).trim());
}

/* What "Another take" does for this passage: whatever made the version on show,
 * made again beside it. Null when nothing made it but him. */
export function takeOf(passage) {
  if (!passage || passage.by === 'break') return null;
  const shown = picked(passage) || {};
  const how = shown.how;
  if (how === 'rewrite' || how === 'selection') return { how, ask: shown.ask || {}, from: shown.from || shown.base || '' };
  if (how === 'play' && shown.ask && shown.ask.transcript) return { how: 'play', ask: shown.ask };
  const first = (passage.versions || []).find((v) => v.ask && (v.how === 'write' || v.how === 'another' || v.how === 'play'));
  if (first && first.how === 'play' && first.ask.transcript) return { how: 'play', ask: first.ask };
  if (first) return { how: 'write', ask: first.ask };
  return null;
}

/* Another take on a passage: the same request again, a new version beside the old. */
export async function anotherTake({ novelId, chapterId, passageId }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  if (book.error) return { ok: false, error: book.error };
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const take = takeOf(p);
  if (!take) return { ok: false, error: 'these are your own words — use Rewrite to have them written another way' };
  const base = take.from ? p.versions.find((v) => v.id === take.from) : null;
  if (take.how === 'rewrite') return rewrite({ novelId, chapterId, passageId, note: take.ask.note || '', fromVersion: base || null });
  if (take.how === 'selection') {
    if (!base) return rewrite({ novelId, chapterId, passageId, note: take.ask.note || '' });
    return rewriteSelection({ novelId, chapterId, passageId, start: take.ask.from, end: take.ask.to, note: take.ask.note || '', fromVersion: base });
  }
  const list = chapter.passages;
  const i = list.indexOf(p);
  const between = list.slice(i + 1).some(hasWords);
  const length = take.ask.length || 'scene';
  /* what wakes a rule: his words that made it, or the premise it carried on */
  const moment = momentOf(chapter, p);
  const version = newVersion({ how: take.how === 'play' ? 'play' : 'another', ask: { ...take.ask }, streaming: true });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  const label = chapterLabel(book.novel, chapter, { withName: false });
  let request;
  let closing = false;
  if (take.how === 'play') {
    request = playToProseRequest({ chapterLabel: label, who: take.ask.who || 'their character', transcript: take.ask.transcript, length, between,
      opens: !list.slice(0, i).some(hasWords) && wordsBefore(book, chapterId) });
  } else {
    const empty = !list.slice(0, i).some((x) => x.by !== 'break' && String((picked(x) || {}).text || '').trim());
    /* Super automatic: the take may end the chapter as the page could (prompts.js closeLine) */
    closing = superOn(house()) && !between && (!empty || length === 'chapter');
    /* how it turns out, as the chip says now */
    request = writeRequest({ chapterLabel: label, direction: take.ask.direction || '', length, empty,
      firstOfBook: empty && book.novel.order.indexOf(chapterId) === 0, between, outcome: outcomeOf(book.novel), close: closing ? { words: chapterWords({ passages: list.slice(0, i) }) } : null });
  }
  return runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: version.how, length, closing,
    build: { target: { chapterId, before: passageId }, request, moment } });
}

/* A rewrite of a whole passage, with his note. */
export async function rewrite({ novelId, chapterId, passageId, note = '', fromVersion = null, lift = 0 }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  if (book.error) return { ok: false, error: book.error };
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const from = fromVersion || picked(p) || {};
  const text = String(from.text || '');
  /* what wakes a rule, read before the new version shows */
  const moment = momentOf(chapter, p, note);
  /* lift: the judge's own lift, the app writing it by itself (its try, 1 or 2) */
  /* (his premise for the page goes with it: shown behind the Premise button even once the version it came from is gone) */
  const premise = premiseOf(p);
  const version = newVersion({ how: 'rewrite', ask: { note, ...(premise ? { premise } : {}) }, streaming: true, from: from.id, ...(lift ? { lift } : {}) });
  /* the app's own lift is written off the page, and shown once whole — never streamed over the words he reads */
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version, { show: !lift }), { now: true });
  const request = rewriteRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), note, text, last: lastInBook(book, chapterId, passageId) });
  const words = countWords(text);
  const out = await runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: 'rewrite',
    length: words > 2600 ? 'chapter' : words > 1500 ? 'long' : 'scene', carryEnd: Boolean(from.closes),
    build: { target: { chapterId, mark: passageId }, request, moment }, auto: Boolean(lift), hidden: Boolean(lift), showWhenDone: Boolean(lift) });
  /* (the version it wrote and the one it wrote from: the partner's rewrite keeps them for its Undo) */
  return { ...out, versionId: version.id, from: from.id };
}

/* Only the words he selected, rewritten; the rest of the passage untouched. */
/* auto: the app writing it by itself (a sentence the checker found, with
 * "Apply the checker's fixes by themselves" on) — it gives way to anything he
 * asks, and the version it was written from is on show again.
 * fix: a sentence the checker found, written again (its Write it again, or by
 * itself) — a fix like any other: once written, it goes in on the version it
 * was written for, the words before kept on it (his word, 2.12.2: only a
 * rewrite or another take is a new version). His own Rewrite of words he
 * selected stays a version of its own. */
/* marks: only the speech marks of these words are set — every word kept (Write it again on a card of a paragraph's
 * speech marks, by his hand or by itself): what comes back goes in only when it changes nothing but its quotation marks
 * (textshape.js marksOnlyResult), else nothing goes in and it is said (2.12.35, the audit: it went in by itself as any
 * rewrite — 52 words made 18 — and quotation marks around the whole answer were taken off, so speech became narration).
 * {goesOn, carried}: the speech going on past the words, or carried into them (textshape.js speechFaults) */
export async function rewriteSelection({ novelId, chapterId, passageId, start, end, note = '', fromVersion = null, auto = false, fix = false, marks = false }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  if (book.error) return { ok: false, error: book.error };
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const baseV = fromVersion || picked(p) || {};
  const full = String(baseV.text || '');
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= full.length)) return { ok: false, error: 'select the words to rewrite first' };
  const marked = full.slice(0, start) + MARK_OPEN + full.slice(start, end) + MARK_CLOSE + full.slice(end);
  /* what wakes a rule, read before the new version shows */
  const moment = momentOf(chapter, p, note);
  /* a few words rewritten in place: the rest are the passage's as they were — his own, or from before the checker began, stay so (Cozy Tavern's M607) */
  const premise = premiseOf(p);
  const version = newVersion({ how: 'selection', ask: { note, from: start, to: end, ...(premise ? { premise } : {}) }, streaming: true, text: full, base: baseV.id, ...rootOf(baseV), ...keptTail(baseV), ...(auto ? { spanAuto: true } : {}) });
  /* by itself: written off the page, the words he reads untouched until the sentence is whole and goes in */
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version, { show: !auto }), { now: true });
  const request = selectionRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), note, marked, marks: Boolean(marks) });
  /* (given way to him, it is taken away whole — runVersion's undo — and the version on show before it is on show again) */
  const out = await runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: 'selection', length: 'paragraphs',
    splice: (answer) => spliceSelection(full, start, end, answer, { keepQuotes: Boolean(marks) }),
    /* the passage it is written into was cut at its end: so is this version, and Go on still carries it on */
    keepEnd: cutAtEnd(baseV) ? endOf(baseV) : null, carryEnd: Boolean(baseV.closes),
    build: { target: { chapterId, mark: passageId }, request, moment }, auto, hidden: auto });
  /* only its speech marks: held to that, or taken away whole and said */
  if (marks && out && out.ok) {
    const live = store.peek('chapter', chapterId);
    const lp = live && (live.passages || []).find((x) => x.id === passageId);
    const made = lp && (lp.versions || []).find((x) => x.id === version.id);
    const madeText = String((made && made.text) || '');
    const after = full.slice(end);
    const fresh = made && madeText.startsWith(full.slice(0, start)) && madeText.endsWith(after) && madeText.length >= start + after.length ? madeText.slice(start, madeText.length - after.length) : null;
    const lead = full.slice(start, end).match(/^\s*/)[0];
    const trail = full.slice(start, end).match(/\s*$/)[0];
    const set = fresh !== null && !made.cut ? marksOnlyResult(full.slice(start, end).trim(), fresh.trim(), { goesOn: Boolean(marks.goesOn), carried: marks.carried || null }) : '';
    if (!set) {
      const shownWas = lp && picked(lp);
      if (made) store.change('chapter', chapterId, chapterSteps.removeVersion(passageId, version.id), { now: true });
      if (shownWas && shownWas.id === version.id) store.change('chapter', chapterId, chapterSteps.pick(passageId, baseV.id), { now: true });
      await store.flush('chapter', chapterId);
      return { ok: false, error: 'the writer changed its words, not only its quotation marks — nothing was put in; Edit sets the marks by hand', marksRefused: true };
    }
    /* the words as they were, with the marks it set */
    const whole = full.slice(0, start) + lead + set + trail + after;
    if (whole !== madeText) store.change('chapter', chapterId, chapterSteps.setVersion(passageId, version.id, { text: whole, words: countWords(whole) }), { now: true });
  }
  /* a fix: on the version it was written for, while that still reads as it did */
  if ((fix || auto) && out && out.ok) {
    const live = store.peek('chapter', chapterId);
    const lp = live && (live.passages || []).find((x) => x.id === passageId);
    const target = lp && (lp.versions || []).find((x) => x.id === baseV.id);
    const made = lp && (lp.versions || []).find((x) => x.id === version.id);
    if (target && made && !made.cut && hashText(String(target.text || '')) === hashText(full)
      && foldVersion({ novelId, chapterId, passageId, childId: version.id, targetId: baseV.id, by: 'checker' })) {
      await store.flush('chapter', chapterId);
      return { ...out, inPlace: true, versionId: baseV.id };
    }
    /* the words changed while it was written (a fix put in, his edit, his partner's change): the new sentence goes in
     * where the old one still stands, once — never a version of words since changed on show over them (through 2.12.3
     * it stayed one, the change made meanwhile out of sight). Where the old sentence is gone, nothing goes in. */
    if (target && made && !made.cut) {
      const old = full.slice(start, end);
      const after = full.slice(end);
      const madeText = String(made.text || '');
      const fresh = madeText.startsWith(full.slice(0, start)) && madeText.endsWith(after) && madeText.length >= start + after.length ? madeText.slice(start, madeText.length - after.length) : null;
      const cur = String(target.text || '');
      const at = fresh !== null && old.trim() ? cur.indexOf(old) : -1;
      const once = at >= 0 && cur.indexOf(old, at + 1) < 0;
      const shownWas = picked(lp);
      store.change('chapter', chapterId, chapterSteps.removeVersion(passageId, version.id), { now: true });
      if (shownWas && shownWas.id === version.id) store.change('chapter', chapterId, chapterSteps.pick(passageId, baseV.id), { now: true });
      if (once && changeInPlace({ novelId, chapterId, passageId, versionId: baseV.id, next: cur.slice(0, at) + fresh + cur.slice(at + old.length), by: 'checker', extra: auto ? { auto: true } : {} })) {
        if (auto) store.change('chapter', chapterId, chapterSteps.setVersion(passageId, baseV.id, { spans: (Number(target.spans) || 0) + 1 }), { now: true });
        await store.flush('chapter', chapterId);
        return { ...out, inPlace: true, versionId: baseV.id };
      }
      await store.flush('chapter', chapterId);
      return { ok: false, error: 'the passage changed while the sentence was written, and the sentence is not there any more — nothing was put in', changedMeanwhile: true };
    }
  }
  return out;
}

/* The words a carried-on passage gets. The model was asked to begin by
 * repeating the passage's last words: those are found and taken off, so the
 * join lands exactly where the passage stops — in the middle of a word too —
 * and nothing is doubled. Without them, a paragraph the model began stays a
 * paragraph, and a space goes in only where one is missing. */
export function joinOn(base, more) {
  const s = String(more || '');
  if (!s.trim()) return '';
  const b = String(base || '');
  const lead = s.replace(/^\s+/, '');
  const cut = b.trim() ? overlapAtStart(b, lead) : 0;
  if (cut) return lead.slice(cut);
  if (/^[ \t]*\n/.test(s)) return '\n\n' + lead;
  if (!b || /\s$/.test(b)) return s.replace(/^[ \t]+/, '');
  if (/^[\s.,;:!?…’”'")\]—–-]/.test(s)) return s;
  return ' ' + s;
}

/* Go on from where a cut passage stops: the words join its last word. */
export async function goOn({ novelId, chapterId, passageId }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  if (book.error) return { ok: false, error: book.error };
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const v = picked(p);
  /* a rewrite of a few selected words that stopped partway sits in the middle
   * of the passage: carrying the passage on from its end would leave it cut
   * there — unless what is cut is the passage's own end */
  if (v.how === 'selection' && !v.endCut) return { ok: false, error: 'a rewrite of selected words can’t be carried on — Another take writes it again' };
  /* what it had, put back exactly if nothing comes — and kept with what does: its thinking, its request, what was said of it */
  const original = { text: String(v.text || ''), cut: v.cut, cutWhy: v.cutWhy, stopped: v.stopped, endCut: v.endCut, model: v.model, carried: v.carried, how: v.how,
    thinking: v.thinking, sent: v.sent, sentMore: v.sentMore, notes: v.notes, sources: v.sources, tookOff: v.tookOff };
  /* what wakes a rule: the words of his that made it, or the premise it carried on */
  const moment = momentOf(chapter, p);
  const i = chapter.passages.indexOf(p);
  const between = chapter.passages.slice(i + 1).some((x) => x.by !== 'break' && String((picked(x) || {}).text || '').trim());
  if (beforeGrow) { try { beforeGrow(novelId, chapterId, passageId, v.id); } catch (_) { /* the helper reads it whole, as before */ } }
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, v.id, { streaming: true, cut: undefined, cutWhy: undefined, stopped: undefined, endCut: undefined }), { now: true });
  /* its last words, from the start of a word */
  const tail = original.text.length > 240 ? original.text.slice(-240).replace(/^\S*\s+/, '') : original.text;
  /* what he asked for in it, and who decides how it turns out — as the chip
   * says now; a rewrite (his note settles it) and a scene written into prose
   * (the scene did) carry on with neither */
  const origin = requestOf(p, v);
  const settled = origin.how === 'rewrite' || origin.how === 'play';
  const asked = settled ? '' : origin.ask.direction || '';
  /* his rewrite's note is a change that is now what happens; a note some words were written again with (his, or the
   * checker's own "Write it again without …") is about how they are told — it holds as the passage goes on, never as an event */
  const change = origin.how === 'rewrite' ? String(origin.ask.note || '').trim() : '';
  const held = (origin.notes || []).map((x) => String(x || '').trim()).filter((x) => x && x !== change);
  /* Super automatic: a page carried on may end the chapter as the page could have (prompts.js closeLine) — never a scene's
   * prose, nor the chapter's opening page; the rest of a chapter carried on ends it when it is done, nothing to say */
  const goesTo = origin.ask.length || 'scene';
  const opening = !chapter.passages.slice(0, i).some(hasWords);
  const closing = superOn(house()) && !between && origin.how !== 'play' && (!opening || goesTo === 'chapter');
  const request = goOnRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), between, tail, direction: asked, change, held,
    ...(origin.how === 'play' ? { transcript: origin.ask.transcript || '', who: origin.ask.who || '' } : {}), outcome: settled ? '' : outcomeOf(book.novel),
    close: closing && goesTo !== 'chapter' ? { words: chapterWords(chapter) } : null });
  /* a rewrite of the page that ended the chapter, cut short and carried on: it ends the chapter when it is done (2.12.35) */
  const madeFrom = (v.how === 'rewrite' || v.how === 'selection') ? (p.versions || []).find((x) => x.id === (v.from || v.base)) : null;
  return runVersion({ novelId, chapterId, passageId, versionId: v.id, original, mode: 'append', how: 'go on', length: goesTo, closing, carryEnd: Boolean(madeFrom && madeFrom.closes),
    splice: (answer) => ({ text: original.text + joinOn(original.text, answer) }),
    build: { target: { chapterId, through: passageId }, request, moment } });
}

/* A scene he played, written into the chapter as prose. */
export async function playToProse({ novelId, chapterId, play, transcript, mine = '', length = 'scene' }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  if (book.error) return { ok: false, error: book.error };
  const chapter = book.chapters[chapterId];
  if (!chapter) return { ok: false, error: 'that chapter is not in the book any more' };
  const who = play.who || 'their character';
  /* his own moves in it are kept beside it: what wakes a rule, now and for another take */
  const passage = newPassage('ai', '', { how: 'play', ask: { play: play.id, who, transcript, length, ...(String(mine || '').trim() ? { mine } : {}) }, streaming: true });
  /* where the scene was set — the narrator was shown the chapter to there, and what came after it as after —
   * never past passages written since (Cozy Tavern M548: a result kept where its anchor stands) */
  const list = chapter.passages || [];
  const at = play.after === '^' || (play.after && list.some((x) => x.id === play.after)) ? play.after : null;
  const between = at === '^' ? list.some(hasWords) : Boolean(at) && list.slice(list.findIndex((x) => x.id === at) + 1).some(hasWords);
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, at), { now: true });
  const request = playToProseRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), who, transcript, length, between,
    opens: !list.some(hasWords) && wordsBefore(book, chapterId) });
  return runVersion({ novelId, chapterId, passageId: passage.id, versionId: passage.versions[0].id, mode: 'new', how: 'play', length,
    build: { target: { chapterId, before: passage.id }, request, moment: hisWordsIn(passage) } });
}

/* SUPER AUTOMATIC — WHERE THE NEXT PAGE GOES (auto.js): a chapter the writer ended (its last page says so, shape.js
 * chapterClosed) goes on in the chapter after it while that holds no words yet (a planned one, or one made empty) — or,
 * the last chapter, in a new one made after it: {chapterId} or {fresh}, with the number it has. null: the next page goes
 * where he is (Super automatic off, the chapter not ended, or a chapter after it already written — he went back to this
 * one himself). The desk says it at the chapter's end (desk.js drawEnd) by this very answer. */
export function closedGoesOn(novelId, chapterId) {
  if (!superOn(house())) return null;
  const novel = store.peek('novel', novelId);
  const chapter = store.peek('chapter', chapterId);
  if (!novel || !chapter || !chapterClosed(chapter)) return null;
  const order = novel.order || [];
  const at = order.indexOf(chapterId);
  if (at < 0) return null;
  if (at === order.length - 1) return { fresh: true, number: at + 2 };
  const next = store.peek('chapter', order[at + 1]);
  return next && !(next.passages || []).some(hasWords) ? { chapterId: next.id, number: at + 2 } : null;
}
/* …and the chapter it goes in, made when it is a new one (null: where he is) */
/* (one at a time: two taps at once — Write twice, or Write and Turn it into prose — make one chapter, 2.12.35) */
const afterClose = new Map();
export async function chapterAfterClose(novelId, chapterId) {
  const key = `${novelId}/${chapterId}`;
  if (afterClose.has(key)) return afterClose.get(key);
  const job = (async () => {
    const to = closedGoesOn(novelId, chapterId);
    if (!to) return null;
    if (to.chapterId) return to.chapterId;
    const fresh = newChapter(novelId);
    await store.create('chapter', fresh.id, fresh);
    store.change('novel', novelId, novelSteps.addChapter(fresh.id, chapterId), { now: true });
    recount(novelId);
    return fresh.id;
  })();
  afterClose.set(key, job);
  try { return await job; } finally { afterClose.delete(key); }
}
/* a scene set where its chapter ends now — nothing written after the point it was set: its prose is that chapter's
 * next page (and, the chapter ended, goes on where the next page would: chapterAfterClose) */
export function setAtEnd(chapter, play) {
  const list = (chapter && chapter.passages) || [];
  if (!play || play.after === '^') return !list.some(hasWords);
  const i = list.findIndex((x) => x.id === play.after);
  return i < 0 || !list.slice(i + 1).some(hasWords);
}

/* His own words, as a passage. */
export function addMine({ novelId, chapterId, text, after = null }) {
  const t = String(text || '').replace(/\s+$/, '');
  if (!t.trim()) return null;
  const passage = newPassage('you', t, { words: countWords(t) });
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, after), { now: true });
  store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  recount(novelId);
  return passage.id;
}

export function addBreak({ chapterId, after = null }) {
  const passage = newPassage('break', '');
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, after), { now: true });
  return passage.id;
}

/* What was taken off a page — a heading above it, a note to him or a block
 * of tracking after it — put back where it stood, as it came, on the page
 * itself (2.12.2): Put back the words before takes it off again. */
export function putBackTail({ novelId, chapterId, passageId }) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  const now = p && picked(p);
  const top = String((now && now.tookOffTop) || '').trim();
  const end = String((now && now.tookOff) || '').trim();
  if (!now || now.streaming || (!top && !end)) return false;
  const body = String(now.text || '').replace(/\s+$/, '');
  const t = `${top ? `${top}\n\n` : ''}${body}${end ? `\n\n${now.tookOff}` : ''}`;
  /* (`back`: the writer's own words put back where they stood — never a word of his on the story, shape.js laterWords) */
  if (!changeInPlace({ novelId, chapterId, passageId, versionId: now.id, next: t, by: 'you', tail: true, extra: { back: true } })) return false;
  recount(novelId);
  return true;
}

/* His edit, on the page itself (his word, 2.12.2: only a rewrite or another
 * take is a new version): the version his box was opened on (fromId) takes
 * his words, the words before kept on it — Put back the words before. A
 * change that came while he edited (his partner's) is in those words before.
 * Whether anything changed. */
export function saveEdit({ novelId, chapterId, passageId, text, fromId = null, opened = null }) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return false;
  const now = (fromId && p.versions.find((x) => x.id === fromId)) || picked(p) || {};
  const t = String(text || '').replace(/\s+$/, '');
  /* nothing he changed in the box (the words it opened on) is no edit — never a change made meanwhile taken away */
  if (!now.id || t === String(now.text || '') || (opened !== null && t === String(opened).replace(/\s+$/, ''))) return false;
  if (!t.trim()) return false;
  /* his words changed inside a passage cut short: it still stops where it stopped, and Go on stays — unless he wrote its end himself (Tavern M511-1) */
  /* (an end he wrote himself: what was taken off after the old end is not this page's any more — kept with the words before) */
  const same = sameEnd(now.text, t);
  if (!changeInPlace({ novelId, chapterId, passageId, versionId: now.id, next: t, by: 'you', keepEnd: same, tail: !same && Boolean(String(now.tookOff || '').trim() || String(now.tookOffTop || '').trim()) })) return false;
  /* the version his box was opened on is on show with his words */
  store.change('chapter', chapterId, chapterSteps.pick(passageId, now.id), { now: true });
  recount(novelId);
  return true;
}

function versionNow(chapterId, passageId, versionId) {
  const c = store.peek('chapter', chapterId);
  const p = c && (c.passages || []).find((x) => x.id === passageId);
  return p && (p.versions || []).find((x) => x.id === versionId);
}
