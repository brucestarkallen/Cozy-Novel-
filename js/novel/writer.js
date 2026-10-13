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
import { ask, emptyWhy } from '../model/call.js';
import { wireOf } from '../model/providers.js';
import { newId, countWords } from '../util.js';
import { assemble, requiredLength } from './context.js';
import { chapterSteps, novelSteps, newPassage, newVersion, picked, chapterLabel, countBook, chapterText, outcomeOf } from './shape.js';
import { writeRequest, rewriteRequest, selectionRequest, goOnRequest, playToProseRequest, MARK_OPEN, MARK_CLOSE } from './prompts.js';

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

/* ------------------------------------------------------- the running job */

const running = new Map();      /* novelId -> job */
const jobFns = new Set();
export function onJob(fn) { jobFns.add(fn); return () => jobFns.delete(fn); }
function tellJob(novelId) { for (const fn of jobFns) { try { fn(novelId, running.get(novelId) || null); } catch (e) { console.error(e); } } }
export function jobOf(novelId) { return running.get(novelId) || null; }
export function busy(novelId) { return running.has(novelId); }
export function stop(novelId) { const j = running.get(novelId); if (j) j.ctl.abort(); }
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

/* before anything is added to the page: is there a writer, and is the book free? */
function preflight(novelId) {
  if (running.has(novelId)) return { ok: false, error: 'something is already being written in this book — Stop it first' };
  if (!connFor(house(), 'writer')) return { ok: false, error: 'no writer is chosen yet — add a connection in Settings → Connections', needsConnection: true };
  return null;
}

async function bookOf(novelId) {
  const novel = await store.open('novel', novelId);
  if (!novel) throw new Error('that book is not on the shelf any more');
  const chapters = {};
  await Promise.all((novel.order || []).map(async (id) => { chapters[id] = await store.open('chapter', id); }));
  for (const id of Object.keys(chapters)) if (!chapters[id]) delete chapters[id];
  return { novel, chapters };
}

export async function recount(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const chapters = {};
  for (const id of novel.order || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  if (Object.keys(chapters).length !== (novel.order || []).length) return;
  const { words, chapters: n } = countBook(novel, chapters);
  if (novel.meta.words !== words || novel.meta.chapters !== n) store.change('novel', novelId, novelSteps.counts(words, n));
}

function keepSent(novelId, key, sent, extra) {
  if (!sent) return;
  const body = { ...sent, ...extra };
  store.api('PUT', `/api/sent/${novelId}/${key}`, { body }).catch(() => { /* what was sent is a convenience; the page is not */ });
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
export function spliceSelection(fullText, start, end, answer) {
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
  for (const [o, c] of pairs) {
    const inner = a.slice(o.length, a.length - c.length);
    if (a.startsWith(o) && a.endsWith(c) && a.length > 2 && !(old.startsWith(o) && old.endsWith(c)) && !inner.includes(o) && !inner.includes(c)) { a = inner.trim(); break; }
  }
  const lead = fullText.slice(start, end).match(/^\s*/)[0];
  const trail = fullText.slice(start, end).match(/\s*$/)[0];
  return { text: before + lead + a + trail + after, from: start + lead.length, to: start + lead.length + a.length };
}

/* -------------------------------------------------------- the one loop */

/* Write one version: kind 'new' (a passage), 'version' (another on a passage),
 * 'append' (go on). Resolves {ok, error?, stopped?, notes?}. */
async function runVersion({ novelId, chapterId, passageId, versionId, base = '', original = null, mode, build, how, splice = null, length = 'scene', purpose = 'write' }) {
  const h = house();
  const conn = connFor(h, 'writer');
  const undo = () => undoEmpty(chapterId, passageId, versionId, mode, original);
  if (running.has(novelId) || !conn) { undo(); return preflight(novelId) || { ok: false, error: 'the writer could not start' }; }
  const ctl = new AbortController();
  const job = { kind: how, chapterId, passageId, versionId, ctl, at: Date.now(), conn: connName(conn) };
  running.set(novelId, job);
  tellJob(novelId);
  let text = '';
  let thinking = '';
  let lastSave = Date.now();
  /* carried on: shown once the words it repeats have arrived, so the join never flickers */
  const shown = () => (splice ? (mode === 'append' && text.trim().length < 40 ? splice('').text : splice(text).text) : base + text);
  /* a heartbeat: another window can tell a page being written from one whose
   * writer closed (repairStale) */
  const alive = () => ({ beat: Date.now(), tab: store.CLIENT, browser: store.BROWSER });
  const checkpoint = () => {
    lastSave = Date.now();
    const words = shown();
    store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, { text: words, thinking: thinking || undefined, ...alive() }), { checkpoint: true, delay: 50 });
  };
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, alive()), { checkpoint: true, delay: 50 });
  /* and it beats while the model is silent too (a long think that streams
   * nothing), so another window never takes a page still being written for
   * one whose window closed */
  const beating = setInterval(() => { if (Date.now() - lastSave > 25000) checkpoint(); }, 30000);
  try {
    const out = await ask(conn, {
      build: (c) => {
        const { novel, chapters } = bookNow(novelId);
        const a = assemble({ house: h, novel, chapters, conn: c, purpose, target: build.target, request: build.request, length, play: build.play, moment: build.moment || '' });
        return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, length) : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse };
      },
      stream: true,
      signal: ctl.signal,
      onText: (s) => {
        text += s;
        tellLive({ novelId, chapterId, passageId, versionId, text: shown(), thinking, phase: 'text' });
        if (Date.now() - lastSave > 3000) checkpoint();
      },
      onThinking: (s) => {
        thinking += s;
        tellLive({ novelId, chapterId, passageId, versionId, text: shown(), thinking, phase: 'thinking' });
        /* a long, silent think still beats */
        if (Date.now() - lastSave > 20000) checkpoint();
      },
    });
    const key = versionId;
    const answer = mode === 'append' ? unfence(out.text || text).replace(/\s+$/, '') : tidyAnswer(out.text || text);
    const finalText = splice ? splice(answer).text : base + answer;
    const arrived = String(out.text || text).trim();
    if (!arrived) {
      /* nothing came: the empty version goes, and the reason is said */
      undo();
      await store.flush('chapter', chapterId);
      if (out.stopped) return { ok: false, stopped: true };
      return { ok: false, error: out.ok ? emptyWhy(out, thinking) : out.error, notes: out.notes };
    }
    const cutWhy = out.stopped ? 'you stopped it'
      : !out.cut ? undefined
        : out.cutBy === 'provider' ? `the provider broke off: ${out.error || ''}`.trim()
          : out.cutBy === 'filter' ? `the provider stopped it (its reason: ${out.reason || 'not given'})`
            : out.cutBy === 'quiet' ? 'the answer ended without the provider saying it was finished'
              : 'it reached the reply length';
    const patch = {
      text: finalText,
      thinking: (out.thinking || thinking) || undefined,
      streaming: undefined, beat: undefined, tab: undefined, browser: undefined,
      cut: out.cut || out.stopped ? true : undefined,
      stopped: out.stopped ? true : undefined,
      cutWhy,
      notes: out.notes && out.notes.length ? out.notes : undefined,
      usage: out.usage || undefined,
      /* how big the request was: the provider's own count, or the app's when it gave none */
      tokensIn: out.usage && Number.isFinite(out.usage.in) ? out.usage.in : (out.sent && Number.isFinite(out.sent.tokens) ? out.sent.tokens : undefined),
      tokensCounted: out.usage && Number.isFinite(out.usage.in) ? true : undefined,
      ms: out.sent ? out.sent.ms : undefined,
      model: conn.model,
      conn: connName(conn),
      sent: out.sent ? key : undefined,
      words: countWords(finalText),
      done: Date.now(),
    };
    store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, patch), { checkpoint: true, now: true });
    store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
    keepSent(novelId, key, out.sent, { purpose: how, chapterId, passageId });
    await store.flush('chapter', chapterId);
    recount(novelId);
    return { ok: true, cut: patch.cut, notes: out.notes, passageId };
  } catch (e) {
    try {
      if (!String(text || '').trim()) undo();
      else store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, { text: shown(), streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true, cutWhy: 'something went wrong partway' }), { now: true });
    } catch (_) { /* the record is gone */ }
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    clearInterval(beating);
    running.delete(novelId);
    tellJob(novelId);
    tellLive({ novelId, chapterId, passageId, versionId, done: true });
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
      : { ...quiet, text: original.text, cut: original.cut || undefined, cutWhy: original.cutWhy || undefined, stopped: original.stopped || undefined }), { now: true });
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
        if (!String(v.text || '').trim()) {
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

/* -------------------------------------------------------- what he asks */

/* The next part of the chapter (at its end, or after a given passage). */
export async function writeNext({ novelId, chapterId, direction = '', length = 'scene', after = null }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  const chapter = book.chapters[chapterId];
  if (!chapter) return { ok: false, error: 'that chapter is not in the book any more' };
  const list = chapter.passages || [];
  const at = after ? list.findIndex((p) => p.id === after) : -1;
  const between = at >= 0 && at < list.length - 1;
  const empty = !list.slice(0, at >= 0 ? at + 1 : list.length).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
  const passage = newPassage('ai', '', { how: 'write', ask: { direction, length }, streaming: true });
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, at >= 0 ? after : null), { now: true });
  const request = writeRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), direction, length, empty,
    firstOfBook: empty && book.novel.order.indexOf(chapterId) === 0, between, outcome: outcomeOf(book.novel) });
  return runVersion({ novelId, chapterId, passageId: passage.id, versionId: passage.versions[0].id, mode: 'new', how: 'write', length,
    build: { target: { chapterId, before: passage.id }, request, moment: direction } });
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
  const between = i < list.length - 1;
  const length = take.ask.length || 'scene';
  const version = newVersion({ how: take.how === 'play' ? 'play' : 'another', ask: { ...take.ask }, streaming: true });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  const label = chapterLabel(book.novel, chapter, { withName: false });
  let request;
  let moment;
  if (take.how === 'play') {
    request = playToProseRequest({ chapterLabel: label, who: take.ask.who || 'their character', transcript: take.ask.transcript, length });
    moment = take.ask.transcript;
  } else {
    const empty = !list.slice(0, i).some((x) => x.by !== 'break' && String((picked(x) || {}).text || '').trim());
    /* how it turns out, as the chip says now */
    request = writeRequest({ chapterLabel: label, direction: take.ask.direction || '', length, empty,
      firstOfBook: empty && book.novel.order.indexOf(chapterId) === 0, between, outcome: outcomeOf(book.novel) });
    moment = take.ask.direction || '';
  }
  return runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: version.how, length,
    build: { target: { chapterId, before: passageId }, request, moment } });
}

/* A rewrite of a whole passage, with his note. */
export async function rewrite({ novelId, chapterId, passageId, note = '', fromVersion = null }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const from = fromVersion || picked(p) || {};
  const text = String(from.text || '');
  const version = newVersion({ how: 'rewrite', ask: { note }, streaming: true, from: from.id });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  const request = rewriteRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), note, text, last: lastInBook(book, chapterId, passageId) });
  const words = countWords(text);
  return runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: 'rewrite',
    length: words > 2600 ? 'chapter' : words > 1500 ? 'long' : 'scene',
    build: { target: { chapterId, mark: passageId }, request, moment: `${note}\n${text}` } });
}

/* Only the words he selected, rewritten; the rest of the passage untouched. */
export async function rewriteSelection({ novelId, chapterId, passageId, start, end, note = '', fromVersion = null }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const baseV = fromVersion || picked(p) || {};
  const full = String(baseV.text || '');
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= full.length)) return { ok: false, error: 'select the words to rewrite first' };
  const marked = full.slice(0, start) + MARK_OPEN + full.slice(start, end) + MARK_CLOSE + full.slice(end);
  const version = newVersion({ how: 'selection', ask: { note, from: start, to: end }, streaming: true, text: full, base: baseV.id });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  const request = selectionRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), note, marked });
  return runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: 'selection', length: 'paragraphs',
    splice: (answer) => spliceSelection(full, start, end, answer),
    build: { target: { chapterId, mark: passageId }, request, moment: `${note}\n${full}` } });
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
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const v = picked(p);
  /* a rewrite of a few selected words that stopped partway sits in the middle
   * of the passage: carrying the passage on from its end would leave it cut there */
  if (v.how === 'selection') return { ok: false, error: 'a rewrite of selected words can’t be carried on — Another take writes it again' };
  const original = { text: String(v.text || ''), cut: v.cut, cutWhy: v.cutWhy, stopped: v.stopped };
  const i = chapter.passages.indexOf(p);
  const between = chapter.passages.slice(i + 1).some((x) => x.by !== 'break' && String((picked(x) || {}).text || '').trim());
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, v.id, { streaming: true, cut: undefined, cutWhy: undefined, stopped: undefined }), { now: true });
  /* its last words, from the start of a word */
  const tail = original.text.length > 240 ? original.text.slice(-240).replace(/^\S*\s+/, '') : original.text;
  /* what he asked for in it, and who decides how it turns out — as the chip
   * says now; a rewrite (his note settles it) and a scene written into prose
   * (the scene did) carry on with neither */
  const settled = v.how === 'rewrite' || v.how === 'play';
  const asked = settled ? '' : (v.ask && v.ask.direction) || '';
  const change = v.how === 'rewrite' ? (v.ask && v.ask.note) || '' : '';
  const request = goOnRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), between, tail, direction: asked, change, outcome: settled ? '' : outcomeOf(book.novel) });
  return runVersion({ novelId, chapterId, passageId, versionId: v.id, original, mode: 'append', how: 'go on', length: (v.ask && v.ask.length) || 'scene',
    splice: (answer) => ({ text: original.text + joinOn(original.text, answer) }),
    build: { target: { chapterId, through: passageId }, request, moment: [asked, change].filter(Boolean).join('\n') } });
}

/* A scene he played, written into the chapter as prose. */
export async function playToProse({ novelId, chapterId, play, transcript, length = 'scene' }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  const chapter = book.chapters[chapterId];
  if (!chapter) return { ok: false, error: 'that chapter is not in the book any more' };
  const who = play.who || 'their character';
  const passage = newPassage('ai', '', { how: 'play', ask: { play: play.id, who, transcript, length }, streaming: true });
  store.change('chapter', chapterId, chapterSteps.addPassage(passage), { now: true });
  const request = playToProseRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), who, transcript, length });
  return runVersion({ novelId, chapterId, passageId: passage.id, versionId: passage.versions[0].id, mode: 'new', how: 'play', length,
    build: { target: { chapterId, before: passage.id }, request, moment: transcript } });
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

/* His edit, kept as a new version — the words before it stay one arrow away. */
export function saveEdit({ novelId, chapterId, passageId, text }) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return false;
  const now = picked(p) || {};
  const t = String(text || '').replace(/\s+$/, '');
  if (t === String(now.text || '')) return false;
  if (!t.trim()) return false;
  const version = newVersion({ text: t, how: 'edit', from: now.id, words: countWords(t), ...(now.ask ? { ask: now.ask } : {}) });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  recount(novelId);
  return true;
}
