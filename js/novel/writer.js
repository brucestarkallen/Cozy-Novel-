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
import { newId, countWords } from '../util.js';
import { assemble, requiredLength } from './context.js';
import { chapterSteps, novelSteps, newPassage, newVersion, endOf, rootOf, keptTail, cutAtEnd, sameEnd, picked, chapterLabel, countBook, chapterText, outcomeOf, hasWords, hisWordsIn, hisWordsBefore } from './shape.js';
import { writeRequest, rewriteRequest, selectionRequest, goOnRequest, playToProseRequest, leftOutWords, MARK_OPEN, MARK_CLOSE } from './prompts.js';
import { joinSoftWraps, finishTail, mendMarks, dropGluedStrays, dropTop, straysIn } from './textshape.js';
import { renameIn } from './names.js';

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
  return roles.checker === 'off' ? null : (roles.checker && connById(house, roles.checker)) || connFor(house, 'helper');
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
  if (roles.checker !== 'off' && !own('checker') && out.includes('helper')) out.push('checker');
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

/* whether anyone checks the writing (checker.js checkerConn: his choice, or the helper's; "off" is nobody) */
function someoneChecks(h) {
  const roles = (h && h.roles) || {};
  if (roles.checker === 'off') return false;
  return Boolean((roles.checker && connById(h, roles.checker)) || connFor(h, 'helper'));
}

/* before anything is added to the page: is there a writer, and is the book free? */
function preflight(novelId) {
  if (running.has(novelId)) return { ok: false, error: 'something is already being written in this book — Stop it first', busy: true };
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
async function runVersion({ novelId, chapterId, passageId, versionId, base = '', original = null, mode, build, how, splice = null, length = 'scene', purpose = 'write', auto = false, keepEnd = null }) {
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
  /* what the page hears as words arrive: a page the app writes by itself says so (the page never follows it) */
  const live = (ev) => tellLive(job.auto ? { ...ev, auto: true } : ev);
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
    store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, { text: words, thinking: thoughtOf(thinking) || undefined, ...alive() }), { checkpoint: true, delay: 50 });
  };
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, alive()), { checkpoint: true, delay: 50 });
  /* and it beats while the model is silent too (a long think that streams
   * nothing), so another window never takes a page still being written for
   * one whose window closed */
  const beating = setInterval(() => { if (Date.now() - lastSave > 25000) checkpoint(); }, 30000);
  try {
    if (notesWait) { try { await notesWait(novelId, 5000, ctl.signal); } catch (_) { /* it goes anyway */ } }
    /* what the last request built held of the chapter open (context.js stats) */
    let told = null;
    const out = await ask(askConn, {
      build: (c) => {
        const { novel, chapters } = bookNow(novelId);
        const a = assemble({ house: h, novel, chapters, conn: c, purpose, target: build.target, request: build.request, length, play: build.play, moment: build.moment || '' });
        told = a.stats;
        return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, length) : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse, least: a.stats.least };
      },
      stream: true,
      signal: ctl.signal,
      noStructured: carryOn,
      onText: (s) => {
        text += s;
        live({ novelId, chapterId, passageId, versionId, text: shown(), thinking: thoughtOf(thinking), phase: 'text' });
        if (Date.now() - lastSave > 3000) checkpoint();
      },
      onThinking: (s) => {
        thinking += s;
        live({ novelId, chapterId, passageId, versionId, text: shown(), thinking: thoughtOf(thinking), phase: 'thinking' });
        /* a long, silent think still beats */
        if (Date.now() - lastSave > 20000) checkpoint();
      },
    });
    /* the book or the chapter was removed while it wrote: nothing is left to keep it in */
    if (job.gone) return { ok: false, stopped: true, gone: true };
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
    /* the chapter open told in part to fit its model's room: he is told too, not only the writer */
    if (told && build.target && build.target.chapterId && Array.isArray(told.wholeIds) && !told.wholeIds.includes(build.target.chapterId)) notes.push('This chapter was longer than the writer’s room, so it was sent its opening and the words right before this point, with the middle left out.');
    if (told && told.omitted > 0) notes.push(leftOutWords(told.omitted));
    if (leak.leaked) notes.push(leak.ranPast ? 'The writer ran past the end of its answer and began writing your next request — the words before that were kept.' : 'The words before the provider’s leak were kept.');
    let answer = mode === 'append' ? unfence(leak.text).replace(/\s+$/, '') : tidyAnswer(leak.text);
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
    let finalText = splice ? splice(answer).text : base + answer;
    /* the marks a model left open closed, and a stray of another script
     * stuck to the front of a word taken off — marks only, never a word, and
     * only what is new (Go on: never the words it carries on), never the
     * unfinished end of a page that was cut (Cozy Tavern M458, M626) */
    if (how !== 'selection') {
      const from = mode === 'append' && original ? original.text.length : 0;
      const unglued = dropGluedStrays(finalText, { from });
      if (unglued.changed) notes.push('A stray character of another script, stuck to the front of a word, was taken off.');
      finalText = mendMarks(unglued.text, { from, leaveLast: Boolean(out.cut || out.stopped) }).text;
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
    if (job.yielded) {
      undo();
      await store.flush('chapter', chapterId);
      return { ok: false, stopped: true, yielded: true };
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
      return { ok: false, error, notes, thought: kept, ...(passing ? { passing: true } : {}) };
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
    const endKept = !own && keepEnd && keepEnd.cut ? keepEnd : null;
    const patch = {
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
    };
    store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, patch), { checkpoint: true, now: true });
    store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
    keepSent(novelId, key, out.sent, { purpose: how, chapterId, passageId });
    await store.flush('chapter', chapterId);
    recount(novelId);
    return { ok: true, cut: patch.cut, notes, passageId };
  } catch (e) {
    if (job.gone) return { ok: false, stopped: true, gone: true };
    try {
      if (job.yielded || !String(text || '').trim()) undo();
      else store.change('chapter', chapterId, chapterSteps.setVersion(passageId, versionId, { text: shown(), thinking: thoughtOf(thinking) || undefined, streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true, cutWhy: 'something went wrong partway' }), { now: true });
    } catch (_) { /* the record is gone */ }
    return { ok: false, error: (e && e.message) || String(e), thought: !String(text || '').trim() && thinking.trim() ? thinking : undefined };
  } finally {
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
  /* between two passages only when words follow it (a scene break or an
   * empty page after it is not text to bridge to) */
  const between = at >= 0 && list.slice(at + 1).some(hasWords);
  /* what wakes a rule: what he asks for, with the words he is carrying on —
   * the premise, or a passage of his, right before the point */
  const moment = [direction, hisWordsBefore(list, at >= 0 ? at : list.length - 1)].map((x) => String(x || '').trim()).filter(Boolean).join('\n');
  const empty = !list.slice(0, at >= 0 ? at + 1 : list.length).some((p) => p.by !== 'break' && String((picked(p) || {}).text || '').trim());
  const passage = newPassage('ai', '', { how: 'write', ask: { direction, length }, streaming: true });
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, at >= 0 ? after : null), { now: true });
  const request = writeRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), direction, length, empty,
    firstOfBook: empty && book.novel.order.indexOf(chapterId) === 0, between, outcome: outcomeOf(book.novel) });
  return runVersion({ novelId, chapterId, passageId: passage.id, versionId: passage.versions[0].id, mode: 'new', how: 'write', length,
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
  if (take.how === 'play') {
    request = playToProseRequest({ chapterLabel: label, who: take.ask.who || 'their character', transcript: take.ask.transcript, length, between });
  } else {
    const empty = !list.slice(0, i).some((x) => x.by !== 'break' && String((picked(x) || {}).text || '').trim());
    /* how it turns out, as the chip says now */
    request = writeRequest({ chapterLabel: label, direction: take.ask.direction || '', length, empty,
      firstOfBook: empty && book.novel.order.indexOf(chapterId) === 0, between, outcome: outcomeOf(book.novel) });
  }
  return runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: version.how, length,
    build: { target: { chapterId, before: passageId }, request, moment } });
}

/* A rewrite of a whole passage, with his note. */
export async function rewrite({ novelId, chapterId, passageId, note = '', fromVersion = null, lift = 0 }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  const chapter = book.chapters[chapterId];
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return { ok: false, error: 'that passage is not there any more' };
  const from = fromVersion || picked(p) || {};
  const text = String(from.text || '');
  /* what wakes a rule, read before the new version shows */
  const moment = momentOf(chapter, p, note);
  /* lift: the judge's own lift, the app writing it by itself (its try, 1 or 2) */
  const version = newVersion({ how: 'rewrite', ask: { note }, streaming: true, from: from.id, ...(lift ? { lift } : {}) });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  const request = rewriteRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), note, text, last: lastInBook(book, chapterId, passageId) });
  const words = countWords(text);
  const out = await runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: 'rewrite',
    length: words > 2600 ? 'chapter' : words > 1500 ? 'long' : 'scene',
    build: { target: { chapterId, mark: passageId }, request, moment }, auto: Boolean(lift) });
  /* given way to him: the version it lifted from is on show again */
  if (out && out.yielded && from.id) store.change('chapter', chapterId, chapterSteps.pick(passageId, from.id), { now: true });
  return out;
}

/* Only the words he selected, rewritten; the rest of the passage untouched. */
/* auto: the app writing it by itself (a sentence the checker found, with
 * "Apply the checker's fixes by themselves" on) — it gives way to anything he
 * asks, and the version it was written from is on show again */
export async function rewriteSelection({ novelId, chapterId, passageId, start, end, note = '', fromVersion = null, auto = false }) {
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
  /* what wakes a rule, read before the new version shows */
  const moment = momentOf(chapter, p, note);
  /* a few words rewritten in place: the rest are the passage's as they were — his own, or from before the checker began, stay so (Cozy Tavern's M607) */
  const version = newVersion({ how: 'selection', ask: { note, from: start, to: end }, streaming: true, text: full, base: baseV.id, ...rootOf(baseV), ...keptTail(baseV), ...(auto ? { spanAuto: true } : {}) });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  const request = selectionRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), note, marked });
  /* (given way to him, it is taken away whole — runVersion's undo — and the version on show before it is on show again) */
  return runVersion({ novelId, chapterId, passageId, versionId: version.id, mode: 'version', how: 'selection', length: 'paragraphs',
    splice: (answer) => spliceSelection(full, start, end, answer),
    /* the passage it is written into was cut at its end: so is this version, and Go on still carries it on */
    keepEnd: cutAtEnd(baseV) ? endOf(baseV) : null,
    build: { target: { chapterId, mark: passageId }, request, moment }, auto });
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
  const settled = v.how === 'rewrite' || v.how === 'play';
  const asked = settled ? '' : (v.ask && v.ask.direction) || '';
  const change = v.how === 'rewrite' ? (v.ask && v.ask.note) || '' : '';
  const request = goOnRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), between, tail, direction: asked, change, outcome: settled ? '' : outcomeOf(book.novel) });
  return runVersion({ novelId, chapterId, passageId, versionId: v.id, original, mode: 'append', how: 'go on', length: (v.ask && v.ask.length) || 'scene',
    splice: (answer) => ({ text: original.text + joinOn(original.text, answer) }),
    build: { target: { chapterId, through: passageId }, request, moment } });
}

/* A scene he played, written into the chapter as prose. */
export async function playToProse({ novelId, chapterId, play, transcript, mine = '', length = 'scene' }) {
  const stopHere = preflight(novelId);
  if (stopHere) return stopHere;
  const book = await bookOf(novelId);
  const chapter = book.chapters[chapterId];
  if (!chapter) return { ok: false, error: 'that chapter is not in the book any more' };
  const who = play.who || 'their character';
  /* his own moves in it are kept beside it: what wakes a rule, now and for another take */
  const passage = newPassage('ai', '', { how: 'play', ask: { play: play.id, who, transcript, length, ...(String(mine || '').trim() ? { mine } : {}) }, streaming: true });
  /* where the scene was set — the narrator was shown the chapter to there, and what came after it as after —
   * never past passages written since (Cozy Tavern M548: a result kept where its anchor stands) */
  const list = chapter.passages || [];
  const at = play.after && list.some((x) => x.id === play.after) ? play.after : null;
  const between = Boolean(at) && list.slice(list.findIndex((x) => x.id === at) + 1).some(hasWords);
  store.change('chapter', chapterId, chapterSteps.addPassage(passage, between ? at : null), { now: true });
  const request = playToProseRequest({ chapterLabel: chapterLabel(book.novel, chapter, { withName: false }), who, transcript, length, between });
  return runVersion({ novelId, chapterId, passageId: passage.id, versionId: passage.versions[0].id, mode: 'new', how: 'play', length,
    build: { target: { chapterId, before: passage.id }, request, moment: hisWordsIn(passage) } });
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
 * of tracking after it — put back where it stood, as it came: a new version,
 * the page without it one arrow away. */
export function putBackTail({ novelId, chapterId, passageId }) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  const now = p && picked(p);
  const top = String((now && now.tookOffTop) || '').trim();
  const end = String((now && now.tookOff) || '').trim();
  if (!now || (!top && !end)) return false;
  const body = String(now.text || '').replace(/\s+$/, '');
  const t = `${top ? `${top}\n\n` : ''}${body}${end ? `\n\n${now.tookOff}` : ''}`;
  const version = newVersion({ text: t, how: 'edit', from: now.id, words: countWords(t), ...(now.ask ? { ask: now.ask } : {}) });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  recount(novelId);
  return true;
}

/* His edit, kept as a new version made from the version his box was opened
 * on (fromId) — another that came meanwhile (a fix, his partner) stays one
 * arrow back (Cozy Tavern M429). Whether a version was made. */
export function saveEdit({ novelId, chapterId, passageId, text, fromId = null }) {
  const chapter = store.peek('chapter', chapterId);
  const p = chapter && chapter.passages.find((x) => x.id === passageId);
  if (!p) return false;
  const now = (fromId && p.versions.find((x) => x.id === fromId)) || picked(p) || {};
  const t = String(text || '').replace(/\s+$/, '');
  if (t === String(now.text || '')) return false;
  if (!t.trim()) return false;
  /* his words changed inside a passage cut short: it still stops where it stopped, and Go on stays — unless he wrote its end himself (Tavern M511-1) */
  const version = newVersion({ text: t, how: 'edit', from: now.id, words: countWords(t), ...(now.ask ? { ask: now.ask } : {}), ...(sameEnd(now.text, t) ? { ...endOf(now), ...keptTail(now) } : {}) });
  store.change('chapter', chapterId, chapterSteps.addVersion(passageId, version), { now: true });
  store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  recount(novelId);
  return true;
}
