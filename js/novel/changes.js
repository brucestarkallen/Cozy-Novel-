/* Cozy Novel — js/novel/changes.js — THE PARTNER'S CHANGES.
 *
 * The partner talks the book over and, when he asks (or a change plainly
 * needs making), makes it: in a changes block at the top of its answer
 * (prompts.js). Each change lands as it comes — or waits for Apply, as he
 * chose (Settings → Your instructions → Your partner's changes) — and each
 * keeps its Undo. Cozy Tavern's housekeeper, for a novel.
 *
 * Nothing he wrote is lost: a passage changed is a new version of it (his
 * words one arrow away); the book's words, a chapter's name and a card in the
 * notes keep how they read before, for Undo. A change whose words cannot be
 * found — or could be found in more than one place — is not guessed at: it
 * says why, and nothing changes. Undo puts back only a thing still as the
 * change left it; one he has changed since stays his.
 */

import * as store from '../store.js';
import { chapterSteps, novelSteps, newChapter, newVersion, endOf, rootOf, picked, passageNumbers, newCard, chapterPrint, chapterLabel, NOTE_KINDS, matchCard, CARD_FIELDS, hisStamp, cleanCard, keptTail, writtenWith, withStamps, stampsOf, entrySentences, sentenceKey } from './shape.js';
import { countWords, nameKey, numberWords, newId, clone, truthOf, openOf, hashText, cutWords, linesOf, sameLines } from '../util.js';
import { parseLenient } from './jsonutil.js';
import { CHANGES_OPEN, CHANGES_CLOSE, READ_OPEN, READ_CLOSE, DIRECTION_OPEN, DIRECTION_CLOSE, bookNames, macroMap } from './prompts.js';
import { superOn } from './auto.js';
import { listModules, moduleSteps } from './modules.js';
import * as archivist from './archivist.js';
import { joinSoftWraps, mendMarks, dropGluedStrays, dropMarkup, mendSpacing, hasMarkup as hasMarkupText } from './textshape.js';
import { replaceMany, renameRule } from './names.js';
import { entriesOf, entryFor, nameTaken, newEntry, tidyEntry, kindSaid, kindOf, KIND_ONE, ENTRY_KINDS, RIDES, codexNow, carriedCodex } from './bibliography.js';
import { carriedContinuity, continuityNow } from './timeline.js';
import { changeInPlace, putBackWords } from './inplace.js';

/* ------------------------------------------------------------ reading it */

/* a block: a close tag paired with the nearest open tag before it (Cozy
 * Tavern's M172 — "I'll put it in a <changes> block:" before the real one is
 * words, not the block) */
const BLOCK = (open, close) => {
  const o = open.replace(/[<>/]/g, (c) => `\\${c}`);
  const c = close.replace(/[<>/]/g, (x) => `\\${x}`);
  return new RegExp(`${o}((?:(?!${o})[\\s\\S])*?)${c}`, 'gi');
};

/* the words of an answer, without its blocks — and, while one is still
 * coming, without the part of it that has come so far */
export function wordsOf(text, { keepDirections = false } = {}) {
  let t = String(text || '');
  t = t.replace(BLOCK(CHANGES_OPEN, CHANGES_CLOSE), '').replace(BLOCK(READ_OPEN, READ_CLOSE), '');
  /* a premise it offered reads as words (its marks out) — kept marked only for the screen */
  if (!keepDirections) t = t.replace(/<\/?direction>/gi, '');
  /* a block still coming (or one left open): its part so far is not words — but
   * a tag named in the words, with words after it, stays a word (M75-003(4)) */
  const open = t.search(/<(changes|read)>(?=\s*(?:[[{"`]|$))/i);
  if (open >= 0) t = t.slice(0, open);
  /* a fence it put around a block, left empty */
  t = t.replace(/```[a-z]*\s*```/gi, '');
  return t.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
/* the answer as it is shown: its words, and each premise it offered for the
 * next page — [{kind: 'words'|'direction', text, done}] (a premise still
 * coming is not done) */
export function partsOf(text) {
  const t = wordsOf(text, { keepDirections: true });
  const out = [];
  let at = 0;
  const re = /<direction>([\s\S]*?)(<\/direction>|$)/gi;
  for (const m of t.matchAll(re)) {
    const before = t.slice(at, m.index).trim();
    if (before) out.push({ kind: 'words', text: before });
    const d = m[1].trim();
    if (d) out.push({ kind: 'direction', text: d, done: Boolean(m[2]) });
    at = m.index + m[0].length;
    if (!m[2]) break;
  }
  const rest = t.slice(at).trim();
  if (rest) out.push({ kind: 'words', text: rest });
  return out;
}
/* the premises an answer offers */
export function directionsIn(text) { return partsOf(text).filter((x) => x.kind === 'direction' && x.done).map((x) => x.text); }

/* the changes blocks of an answer, as written ('' when none) */
export function blocksIn(text) { return [...String(text || '').matchAll(BLOCK(CHANGES_OPEN, CHANGES_CLOSE))].map((m) => m[0]).join('\n\n'); }
/* a changes block still on its way */
export function changesComing(text) { return /<changes>/i.test(String(text || '')) && !/<\/changes>/i.test(String(text || '')); }

/* the chapters it asked to read whole: numbers, at most four */
export function readsOf(text) {
  return readAsks(text).filter((x) => typeof x === 'number').slice(0, 4);
}
/* everything it asked to read (Cozy Tavern's fetch, for a book): a chapter
 * by number (2), the places some words stand ("find: Oda Jovan"), a module's
 * words ("module: The novel craft"). One answer reads eight at most: what is
 * past them is named back, never dropped without a word (READ_AT_ONCE) */
export const READ_AT_ONCE = 8;
export function readAsks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(BLOCK(READ_OPEN, READ_CLOSE))) {
    const body = m[1].trim();
    let list = parseLenient(body.startsWith('[') ? body : `[${body}]`);
    if (!Array.isArray(list)) list = body.split(/\n|,(?![^"]*"\s*\])/).map((x) => x.trim().replace(/^["“]|["”]$/g, ''));
    for (const x of list) {
      const t = String(x == null ? '' : x).trim();
      const ask = /^find\s*:/i.test(t) ? { find: t.replace(/^find\s*:\s*/i, '').slice(0, 200) }
        : /^module\s*:/i.test(t) ? { module: t.replace(/^module\s*:\s*/i, '').slice(0, 120) }
          : /^card\s*:/i.test(t) ? { card: t.replace(/^card\s*:\s*/i, '').slice(0, 120) }
            : /^entry\s*:/i.test(t) ? { entry: t.replace(/^entry\s*:\s*/i, '').slice(0, 120) }
              /* the book's own words whole — what it's about, how it reads, where it's headed — as they stand now (2.12.8: a change to them quoted from an older look missed) */
              : /^(?:about|book(?:\s*:\s*about)?|about\s+this\s+book|what\s+it['’]s\s+about)$/i.test(t) ? { about: true }
                : chapterNumber(t);
      if (ask === null || (typeof ask === 'object' && !Object.values(ask)[0])) continue;
      if (!out.some((y) => JSON.stringify(y) === JSON.stringify(ask))) out.push(ask);
    }
  }
  return out;
}

/* a chapter as it is asked for: 3, "3", "Chapter 3", "Chapter Three",
 * "chapter three" — or null (Cozy Tavern's M61 v2.79: the page's own
 * spelled-out labels are how it is told the chapters) */
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function chapterNumber(t) {
  const s = String(t == null ? '' : t).trim().toLowerCase().replace(/^chapter\s+/, '').replace(/[.:,]$/, '').trim();
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 0 ? n : null; }
  const words = s.replace(/-/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  if (!words.length || words.length > 4) return null;
  let n = 0;
  for (const w of words) {
    const a = SMALL.indexOf(w);
    const b = TENS.indexOf(w);
    if (a > 0) n += a;
    else if (b > 1) n += b * 10;
    else if (w === 'hundred' && n > 0) n *= 100;
    else return null;
  }
  return n > 0 ? n : null;
}
/* an answer with a read block in it that holds nothing that can be read */
export function unreadableRead(text) {
  return [...String(text || '').matchAll(BLOCK(READ_OPEN, READ_CLOSE))].some((m) => m[1].trim()) && !readAsks(text).length;
}

/* the changes in an answer, as written. A block in curly quotes is read as
 * straight (M439); a block that cannot be read at all is one change of its
 * own — {unreadable, head} — so it is said, never lost (M75-003(2)) */
export function opsOf(text) {
  const out = [];
  for (const m of String(text || '').matchAll(BLOCK(CHANGES_OPEN, CHANGES_CLOSE))) {
    let body = m[1].replace(/```[a-z]*/gi, '').trim();
    if (!body) continue;
    if (!body.includes('"') && /[“”]/.test(body)) body = body.replace(/[“”]/g, '"');
    const list = parseLenient(body);
    /* a block that says nothing is to change — [] or {} — is no change, never one that could not be read (his report,
     * 2.12.2: "✗ A changes block couldn't be made — its changes block could not be read (it began: [])") */
    if ((Array.isArray(list) && !list.length) || (list && typeof list === 'object' && !Array.isArray(list) && !Object.keys(list).length)) continue;
    const ops = (Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : [])).filter((op) => op && typeof op === 'object' && !Array.isArray(op));
    if (!ops.length) { out.push({ unreadable: true, head: body.replace(/\s+/g, ' ').slice(0, 120) }); continue; }
    for (const op of ops) out.push(op);
  }
  return out;
}

/* Edit by hand (Cozy Tavern's card editor): the words a waiting change would
 * write, each as he can change them before it is applied — [{key, label,
 * value, rows}]; and the change with his words in place of its own. What
 * the change finds (its place, its card) is never edited, only what it
 * writes. */
export function editableOf(op) {
  const o = op || {};
  const out = [];
  const add = (key, label, rows = 3) => { if (typeof (key === 'to' ? (o.rename || {}).to : o[key]) === 'string') out.push({ key, label, value: String(key === 'to' ? o.rename.to : o[key]), rows }); };
  if (o.rename && typeof o.rename === 'object') { add('to', 'The name it becomes', 1); return out; }
  if (o.module !== undefined) { add('replace', 'The new words'); add('text', 'The module’s words, whole', 10); return out; }
  if (o.summary !== undefined) { add('text', 'The summary', 6); return out; }
  if (o.plan !== undefined) { add('text', 'What the chapter is for', 6); return out; }
  if (o.note !== undefined) { add('newName', 'Its new name', 1); add('about', 'Who or what it is'); add('ties', 'With others'); add('now', 'Right now'); return out; }
  if (o.entry !== undefined) { add('newName', 'Its new name', 1); add('line', 'In a line', 2); add('text', 'The entry', 8); add('add', 'The paragraph it adds', 4); return out; }
  if (o.chapter !== undefined && o.passage === undefined) { add('name', 'The chapter’s new name', 1); return out; }
  if (o.passage !== undefined && o.rewrite !== undefined) { add('rewrite', 'What the writer is to change', 5); return out; }
  add('replace', 'The new words');
  add('text', o.passage !== undefined ? 'The passage, written anew' : 'The words, whole', 10);
  add('add', 'The paragraph it adds', 4);
  return out;
}
export function withEdits(op, patch) {
  const out = clone(op || {});
  for (const [k, v] of Object.entries(patch || {})) {
    if (typeof v !== 'string') continue;
    if (k === 'to') { if (out.rename && typeof out.rename === 'object') out.rename.to = v; continue; }
    if (typeof out[k] === 'string') out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------ where */

const BOOK_FIELDS = Object.freeze(Object.assign(Object.create(null), { about: 'brief', style: 'style', plans: 'plans', title: 'title', subtitle: 'subtitle' }));
const BOOK_WORDS = { about: 'What it’s about', style: 'How it reads', plans: 'Where it’s headed', title: 'The title', subtitle: 'The line under the title' };
const KIND_WORD = { people: 'People', places: 'Places', lore: 'Things worth remembering', threads: 'Threads' };

/* The page as the partner was shown it: "2.3" is the passage that stood
 * there then, "2" the chapter — a number names what it named when the
 * answer was written, never whatever holds it once the changes before it in
 * the same answer (or his own hand) have moved the rest (Cozy Tavern's
 * M682/M726/M736; the checker keys its own asks the same way). */
export function numbersOf(novel) {
  const passages = new Map();
  const chapters = new Map();
  ((novel && novel.order) || []).forEach((id, i) => {
    chapters.set(i + 1, id);
    const c = store.peek('chapter', id);
    if (!c) return;
    const nums = passageNumbers(c);
    for (const p of c.passages || []) { const n = nums.get(p.id); if (n) passages.set(`${i + 1}.${n}`, { chapterId: id, passageId: p.id }); }
  });
  return { passages, chapters };
}
const PASSAGE_REF = /^\s*(\d+)\s*[.,:]\s*(\d+)\s*$/;
/* what a change's numbers named on that page: {chapterId, passageId} for a
 * passage, {chapterId} for a chapter's name or summary — or null */
export function whereOf(novel, op, numbers) {
  const o = op || {};
  if (!novel || !numbers || o.unreadable || o.rename || o.replace_all !== undefined) return null;
  if (o.passage !== undefined) {
    const m = typeof o.passage === 'number' ? null : PASSAGE_REF.exec(String(o.passage));
    const hit = m && numbers.passages.get(`${parseInt(m[1], 10)}.${parseInt(m[2], 10)}`);
    return hit ? { ...hit } : null;
  }
  const ref = o.summary !== undefined ? o.summary : o.plan !== undefined ? o.plan : o.chapter;
  if (ref === undefined) return null;
  const n = chapterNumber(ref);
  const id = n && numbers.chapters.get(n);
  return id ? { chapterId: id } : null;
}
/* a passage by its id, in the chapter it was in or wherever it stands now */
function passageById(novel, passageId, chapterId) {
  const order = novel.order || [];
  for (const id of [chapterId, ...order]) {
    if (!id || !order.includes(id)) continue;
    const chapter = store.peek('chapter', id);
    const passage = chapter && (chapter.passages || []).find((p) => p.id === passageId);
    if (passage) return { chapter, passage, ci: order.indexOf(id) + 1 };
  }
  return null;
}
function passageAt(novel, ref, { where = null, numbers = null } = {}) {
  /* a number loses its last nought (2.10 is 2.1): only words are read as a passage */
  if (typeof ref === 'number') return { why: `a passage number has to be given as words in quotes, like "2.10" — as a number it can lose a nought` };
  const m = PASSAGE_REF.exec(String(ref || ''));
  if (!m) return { why: `“${ref}” is not a passage number like 2.3` };
  const ci = parseInt(m[1], 10);
  const pn = parseInt(m[2], 10);
  /* the passage the number named when the answer was written */
  const at = where && where.passageId ? where : numbers ? numbers.passages.get(`${ci}.${pn}`) : null;
  if (at) {
    const found = passageById(novel, at.passageId, at.chapterId);
    if (!found) return { why: 'that passage is not there any more — it was taken out since' };
    return { ...found, pn };
  }
  if (numbers) return { why: numbers.chapters.has(ci) ? `Chapter ${numberWords(ci)} has no passage ${pn}` : `there is no Chapter ${numberWords(ci)}` };
  const chapterId = (novel.order || [])[ci - 1];
  const chapter = chapterId && store.peek('chapter', chapterId);
  if (!chapter) return { why: `there is no Chapter ${numberWords(ci)}` };
  const nums = passageNumbers(chapter);
  const p = (chapter.passages || []).find((x) => nums.get(x.id) === pn);
  if (!p) return { why: `Chapter ${numberWords(ci)} has no passage ${pn}` };
  return { chapter, passage: p, ci, pn };
}
/* the one passage of the chapter named where some words stand — or null (none, or more than one) */
function passageByWords(novel, ref, find) {
  const m = PASSAGE_REF.exec(String(ref || ''));
  if (!m || !String(find || '').trim()) return null;
  const ci = parseInt(m[1], 10);
  const chapterId = (novel.order || [])[ci - 1];
  const chapter = chapterId && store.peek('chapter', chapterId);
  if (!chapter) return null;
  const nums = passageNumbers(chapter);
  const hits = (chapter.passages || []).filter((p) => p.by !== 'break' && !locate(String((picked(p) || {}).text || ''), find).why);
  if (hits.length !== 1) return null;
  return { chapter, passage: hits[0], ci, pn: nums.get(hits[0].id) };
}
/* a chapter by its number as the partner writes it — 3, "3", "Chapter
 * Three", "three" (read as the read block reads it: Cozy Tavern's M61
 * v2.79) — through the page it was shown */
function chapterAt(novel, ref, { where = null, numbers = null } = {}) {
  const order = novel.order || [];
  if (where && where.chapterId) {
    const chapter = order.includes(where.chapterId) && store.peek('chapter', where.chapterId);
    return chapter ? { chapter, chapterId: where.chapterId, n: order.indexOf(where.chapterId) + 1 } : { why: 'that chapter is not there any more' };
  }
  const n = chapterNumber(ref);
  if (!n) return { why: `“${String(ref)}” is not a chapter number like 3` };
  const id = numbers ? numbers.chapters.get(n) : order[n - 1];
  const chapter = id && order.includes(id) && store.peek('chapter', id);
  if (!chapter) return { why: id ? 'that chapter is not there any more' : `there is no Chapter ${numberWords(n)}` };
  return { chapter, chapterId: id, n: order.indexOf(id) + 1 };
}

/* the chapters a change across the book names, said as the book says them */
function rangeWords(spec) {
  if (spec === undefined || spec === null || spec === '' || /^all$/i.test(String(spec).trim())) return 'the book';
  const r = chapterRange({ order: { length: Infinity } }, spec);
  if (!r) return `chapters ${Array.isArray(spec) ? spec.join(', ') : spec}`;
  if (r.list) return r.list.length === 1 ? `Chapter ${numberWords(r.list[0])}` : `Chapters ${r.list.slice(0, -1).map(numberWords).join(', ')} and ${numberWords(r.list[r.list.length - 1])}`;
  return r.from === r.to ? `Chapter ${numberWords(r.from)}` : `Chapters ${numberWords(r.from)} to ${numberWords(r.to)}`;
}
/* a change's label as the page stands now: a passage or chapter it found by
 * its place shown by its number today, however the book was renumbered since
 * (the label the partner wrote stays its own, for what it is told back) */
export function labelNow(novelId, change) {
  const c = change || {};
  const label = c.label || labelOf(c.op || {});
  const w = c.where;
  const novel = store.peek('novel', novelId);
  if (!w || !c.op || !novel || c.status === 'refused') return label;
  if (w.passageId) {
    const found = passageById(novel, w.passageId, w.chapterId);
    const pn = found && passageNumbers(found.chapter).get(w.passageId);
    return pn ? `Chapter ${numberWords(found.ci)}, passage ${pn}` : label;
  }
  const n = (novel.order || []).indexOf(w.chapterId) + 1;
  if (!n) return label;
  return c.op.summary !== undefined ? `Chapter ${numberWords(n)}’s summary` : c.op.plan !== undefined ? `What Chapter ${numberWords(n)} is for` : `Chapter ${numberWords(n)}’s name`;
}

export function labelOf(op) {
  if (op.rename && typeof op.rename === 'object') return `“${String(op.rename.from || '').trim()}” to “${String(op.rename.to || '').trim()}”, everywhere in the book`;
  if (op.replace_all !== undefined) return `“${String(op.find || '').slice(0, 40)}” across ${rangeWords(op.chapters !== undefined ? op.chapters : op.range)}`;
  if (op.module !== undefined) return `The module “${String(op.module || '').trim()}”`;
  if (op.summary !== undefined) return `Chapter ${numberWords(chapterNumber(op.summary) || 0)}’s summary`;
  if (op.plan !== undefined) return `What Chapter ${numberWords(chapterNumber(op.plan) || 0)} is for`;
  if (op.passage !== undefined) {
    const m = PASSAGE_REF.exec(String(op.passage));
    return m ? `Chapter ${numberWords(parseInt(m[1], 10))}, passage ${parseInt(m[2], 10)}` : `Passage ${op.passage}`;
  }
  if (op.chapter !== undefined) return `Chapter ${numberWords(chapterNumber(op.chapter) || 0)}’s name`;
  if (op.book !== undefined) return BOOK_WORDS[op.book] || 'The book';
  if (op.note !== undefined) return `${String(op.name || '').trim() || 'A card'} (${KIND_WORD[op.note] || 'notes'})`;
  if (op.entry !== undefined) return `${String(op.entry || '').trim() || 'An entry'} (bibliography)`;
  return 'A change';
}

/* ------------------------------------------------------------ finding words */

/* where `find` stands in `text`: exactly, or else read loosely — runs of
 * space as one, curly quotes as straight, any dash (and the space around it,
 * or a double hyphen) as one, an ellipsis as its dots (Cozy Tavern A7: a
 * model types "--" and "..." where the book has "—" and "…") — and only when
 * it stands in one place. {start, end} or {why}. */
const SINGLE_QUOTES = new Set(['’', '‘', 'ʼ', '′']);
const DOUBLE_QUOTES = new Set(['“', '”', '„', '″']);
const DASHES = new Set(['—', '–', '‐', '‑', '‒', '―', '−']);
function loose(str) {
  const out = []; const starts = []; const ends = [];
  for (let i = 0; i < str.length; i++) {
    let ch = str[i];
    /* emphasis marks are the page's dressing, not its words (Cozy Tavern's
     * M752: a quote with other marks is the original's own text) — "She
     * knew" is found where the page has "She *knew*" — and so are the
     * characters nobody sees: a zero-width space, a soft hyphen (M752-009) */
    if (ch === '*' || ch === '_' || /[\u00ad\u200b-\u200d\u2060\ufeff]/.test(ch)) continue;
    if (/\s/.test(ch)) ch = ' ';
    else if (SINGLE_QUOTES.has(ch)) ch = "'";
    else if (DOUBLE_QUOTES.has(ch)) ch = '"';
    else if (DASHES.has(ch)) ch = '-';
    else if (ch === '…') ch = '.';
    const last = out.length - 1;
    /* a run of space, of dashes or of dots is one; space beside a dash is the dash's */
    if (last >= 0 && (ch === ' ' || ch === '-' || ch === '.') && out[last] === ch) { ends[last] = i + 1; continue; }
    if (last >= 0 && ch === ' ' && out[last] === '-') { ends[last] = i + 1; continue; }
    if (last >= 0 && ch === '-' && out[last] === ' ') { out[last] = '-'; ends[last] = i + 1; continue; }
    out.push(ch); starts.push(i); ends.push(i + 1);
  }
  return { s: out.join(''), starts, ends };
}
export function locate(text, find) {
  const f = String(find || '');
  if (!f.trim()) return { why: 'it named no words to change' };
  const at = text.indexOf(f);
  if (at >= 0) {
    if (text.indexOf(f, at + 1) >= 0) return { why: 'those words stand in more than one place — it has to quote more of them' };
    return { start: at, end: at + f.length };
  }
  const T = loose(text);
  const F = loose(f.trim()).s.trim();
  if (!F) return { why: 'those words are not there' };
  const i = T.s.indexOf(F);
  if (i < 0) return { why: 'those words are not there' };
  if (T.s.indexOf(F, i + 1) >= 0) return { why: 'those words stand in more than one place — it has to quote more of them' };
  /* the words themselves: never the space a dash took in at either end */
  let start = T.starts[i];
  let end = T.ends[i + F.length - 1];
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

/* WHERE A QUOTE THAT IS NOT THERE PARTS FROM THE PAGE (Cozy Tavern
 * M752-009): the longest start of it that stands in one place, and what the
 * page says from there — told back with the miss, so the quote is put right
 * from the page, never guessed again. '' when not even its first few words
 * stand anywhere. */
export function departure(text, find) {
  const page = String(text || '');
  const T = loose(page);
  const words = loose(String(find || '').trim()).s.trim().split(' ').filter(Boolean);
  for (let n = words.length - 1; n >= 3; n--) {
    const head = words.slice(0, n).join(' ');
    const i = T.s.indexOf(head);
    if (i < 0 || T.s.indexOf(head, i + 1) >= 0) continue;
    const upto = T.ends[i + head.length - 1];
    const agreed = page.slice(T.starts[i], upto).replace(/\s+/g, ' ').trim().split(' ');
    const rest = page.slice(upto).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!rest.length) return ` — the page agrees up to “${agreed.length > 6 ? '…' : ''}${agreed.slice(-6).join(' ')}”, and ends there`;
    return ` — the page agrees up to “${agreed.length > 6 ? '…' : ''}${agreed.slice(-6).join(' ')}”, and from there reads “${rest.slice(0, 10).join(' ')}${rest.length > 10 ? '…' : ''}”`;
  }
  return '';
}
const whyNotFound = (spot, text, find) => (spot.why === 'those words are not there' ? spot.why + departure(text, find) : spot.why);

/* the book's own words as the partner read them: {{user}} and {{char}} in
 * them are read as names (prompts.js namedBook), so words it quotes with the
 * names in are found where the marks stand — a mark its quote takes in is
 * written as the name, whole; every other mark stays as he wrote it.
 * {start, end, pre, post}: pre and post go either side of the new words */
function locateNamed(text, find, names) {
  const spot = locate(text, find);
  if (!spot.why || !names) return spot;
  const m = macroMap(text, names);
  if (m.text === text) return spot;
  const s = locate(m.text, find);
  if (s.why) return s;
  const a = m.toRaw(s.start, false);
  const b = m.toRaw(s.end, true);
  return { start: a.at, end: b.at, pre: a.keep, post: b.keep };
}
/* the words with the new ones in the place found */
const putIn = (text, spot, words) => text.slice(0, spot.start) + (spot.pre || '') + words + (spot.post || '') + text.slice(spot.end);

/* ------------------------------------------------------------ cards */

function sameCard(card, name) {
  const k = nameKey(name);
  return Boolean(k) && (nameKey(card.name) === k || (card.aka || []).some((a) => nameKey(a) === k));
}
const text = (v) => String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim();
/* a whole text that only says there is nothing — "…", "unchanged", "none" —
 * is no words, never written as his (Cozy Tavern's door, M656/M658); a
 * summary or a card that is an excuse is none either (archivist.cleanText),
 * but a passage may well open "I'm afraid…" in a book told by its "I" */
const hasWords = (t) => Boolean(String(t || '').trim()) && !archivist.saysNothing(t);
const clipped = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 40 ? `${x.slice(0, 39)}…` : x; };
/* WORDS GIVEN BACK WORD FOR WORD AS THEY STAND (the spaces within a line let go) are no words written over — never turned
 * away as read only in short or by a first line, which asks it again for nothing (2.12.40, the review): what the change
 * says then is that they are there already. Its lines and paragraphs as they stand too (util.js sameLines — 2.12.41, the
 * review: every run of white space was read as one, so a passage's paragraphs parted or joined, and an entry put into
 * paragraphs, were turned away as changing nothing) */
const sameWordsAs = (given, standing) => Boolean(linesOf(given)) && sameLines(given, standing);
/* the new words for a find: "replace" ("" takes the words out) — or "text",
 * when it wrote that instead; with neither, nothing is guessed */
const newWords = (op) => (op.replace !== undefined ? String(op.replace) : op.text !== undefined ? String(op.text) : null);

/* ------------------------------------------------------------ across the book */

const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_OR_DAY = /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
function renamed(text, from, to) { return replaceMany(text, [renameRule(from, to)]).text; }
/* the same words wherever they stand: whole words at the ends that are
 * letters or numbers ("Ann" is not in "Annual" nor "Anna") */
function wordsRe(find) {
  const f = String(find || '');
  /* (an underscore is no letter: "Ann" stands in _Ann_, her name in italics) */
  const before = /^[\p{L}\p{N}]/u.test(f) ? '(?<![\\p{L}\\p{N}])' : '';
  const after = /[\p{L}\p{N}]$/u.test(f) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`${before}${esc(f)}${after}`, 'gu');
}
/* every passage on the page, in book order: {chapterId, chapter, passage, version, ci} */
function eachPassage(novel, { from = 1, to = Infinity, list = null } = {}) {
  const out = [];
  (novel.order || []).forEach((id, i) => {
    if (i + 1 < from || i + 1 > to || (list && !list.includes(i + 1))) return;
    const chapter = store.peek('chapter', id);
    for (const p of (chapter && chapter.passages) || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (!v || v.streaming || !String(v.text || '').trim()) continue;
      out.push({ chapterId: id, chapter, passage: p, version: v, ci: i + 1 });
    }
  });
  return out;
}
/* where some words still stand in the book, but for one passage: '' or a line */
function stillStands(novel, find, butFor) {
  const f = find.trim();
  if (f.length < 4 || !/\p{L}/u.test(f) || f.split(/\s+/).length > 12) return '';
  const re = wordsRe(f);
  const at = [];
  for (const x of eachPassage(novel)) {
    if (x.passage.id === butFor) continue;
    re.lastIndex = 0;
    if (re.test(String(x.version.text))) at.push(`${x.ci}.${passageNumbers(x.chapter).get(x.passage.id)}`);
  }
  if (!at.length) return '';
  return `the words it replaced still stand in ${at.slice(0, 6).join(', ')}${at.length > 6 ? ` and ${at.length - 6} more` : ''} — change those too if they should match`;
}

/* "2-5", "Chapters Two to Five", "3", "Chapter Three", [2, 5] (the chapters
 * it names, each — a list is never read as a range), "all" or nothing: which
 * chapters. {from, to} or {list}, or null when it cannot be read. */
function chapterRange(novel, spec) {
  const n = (novel.order || []).length;
  if (spec === undefined || spec === null || spec === '' || /^all$/i.test(String(spec).trim())) return { from: 1, to: n };
  if (Array.isArray(spec)) {
    const list = [...new Set(spec.map((x) => chapterNumber(x)))];
    if (!list.length || list.some((x) => !x)) return null;
    return { list: list.filter((x) => x <= n).sort((a, b) => a - b) };
  }
  const s = String(spec).trim().replace(/^chapters?\s+/i, '');
  /* one chapter ("3", "twenty-one") before a range ("2-5", "Two to Five") */
  const one = chapterNumber(s);
  const m = one ? null : /^(.+?)\s*(?:[-–—]|\bto\b|\bthrough\b)\s*(?:chapter\s+)?(.+)$/i.exec(s);
  const a = one || (m ? chapterNumber(m[1]) : null);
  const b = one || (m ? chapterNumber(m[2]) : null);
  if (!a || !b) return null;
  return { from: Math.max(1, Math.min(a, b)), to: Math.min(n, Math.max(a, b)) };
}
/* the words changed on the page itself (his word, 2.12.2: only a rewrite or another take is a new version): the
 * version takes them, where it stops stays (cut short, stopped — its Go on: M511-1), the words before are kept on
 * it. retire: false where what the helper read is moved to the new words by the caller (a name changed); rename: a
 * name changed everywhere, marked so on the words before (shape.js inPlaceFields, 2.12.41: no one's hand on the page —
 * never his partner's words on it, never a name taken out of his world) */
function newVersionOn(put, novelId, x, next, why, { retire = true, rename = false } = {}) {
  const row = { chapterId: x.chapterId, passageId: x.passage.id, versionId: x.version.id, before: String(x.version.text || ''), after: next, inPlace: true };
  if (put.dry) return row;
  changeInPlace({ novelId, chapterId: x.chapterId, passageId: x.passage.id, versionId: x.version.id, next, by: 'partner', retire, extra: { ...(why ? { why } : {}), ...(rename ? { rename: true } : {}) } });
  return row;
}
/* a word of what he asked for on a version — his premise, his note for writing it again — set to the words given, only
 * where it reads as it did (a name changed everywhere, and its Undo) */
const askStep = (pid, vid, field, from, to) => (c) => {
  const p = (c.passages || []).find((x) => x.id === pid);
  const v = p && (p.versions || []).find((x) => x.id === vid);
  if (!v || !v.ask || v.ask[field] !== from) return false;
  v.ask = { ...v.ask, [field]: to };
  return true;
};
/* what a version's words fixed in place keep of it: what was asked, and
 * whether it was cut short or stopped (its Go on stays) */
export function carried(v) {
  if (!v) return {};
  return { ...(v.ask ? { ask: v.ask } : {}), ...endOf(v), ...rootOf(v), ...keptTail(v), ...writtenWith(v) };
}

/* ------------------------------------------------------------ across the book, together */

/* a name changed everywhere (Cozy Tavern's spelling correction): never an
 * ordinary word — a month, a weekday, a word written in small letters, or
 * one the book uses in small letters too. {from, to, rule} or {why} */
function renameOf(novel, op) {
  const from = text(op.rename.from).slice(0, 80);
  const to = text(op.rename.to).slice(0, 80);
  if (!from || !to || from === to) return { why: 'it needs a name as it stands and the name it becomes, not the same' };
  if (!archivist.cleanName(to)) return { why: `“${to}” is no name` };
  if (from === from.toLowerCase() || MONTH_OR_DAY.test(from)) return { why: `“${from}” is an ordinary word as well as a name — change it passage by passage instead` };
  const lower = new RegExp(`(?<![\\p{L}\\p{N}])${esc(from.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u');
  if (eachPassage(novel).some((x) => lower.test(String(x.version.text)))) return { why: `the book also uses “${from.toLowerCase()}” as an ordinary word — change it passage by passage instead` };
  return { from, to, rule: renameRule(from, to) };
}
/* the same words across chapters (Cozy Tavern's bulk replace), exactly as
 * written: {find, words, range, rule} or {why} */
function replaceAllOf(novel, op) {
  const find = String(op.find || '');
  const words = newWords(op);
  if (!find.trim()) return { why: 'it named no words to change' };
  if (words === null) return { why: 'it gave no new words for them' };
  const range = chapterRange(novel, op.chapters !== undefined ? op.chapters : op.range);
  if (!range) return { why: 'it didn’t name chapters I could read — say them as “2-5”, or “all”' };
  return { find, words, range, rule: { re: wordsRe(find), to: () => words } };
}
const inRange = (r, ci) => (r.list ? r.list.includes(ci) : ci >= r.from && ci <= r.to);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* Changes across the book in one answer that touch each other — one's words
 * are in another's, or become them ("Kara" to "Mara" and "Mara" to "Kara";
 * "Lena" to "Mara" and "Mara" to "Ilse") — are made together, in one pass
 * over every text as it stood; the rest one by one. [[op index, …], …] */
export function groupsOf(ops) {
  const out = [];
  const holds = (x, y) => Boolean(x && y) && new RegExp(`(?<![\\p{L}\\p{N}])${esc(x)}(?![\\p{L}\\p{N}])`, 'iu').test(y);
  const kinds = [
    [(o) => o && !o.unreadable && o.rename && typeof o.rename === 'object', (o) => [text(o.rename.from), text(o.rename.to)]],
    [(o) => o && !o.unreadable && !o.rename && o.replace_all !== undefined, (o) => [String(o.find || '').trim(), String(newWords(o) || '').trim()]],
  ];
  for (const [is, words] of kinds) {
    const list = ops.map((o, i) => (is(o) ? i : -1)).filter((i) => i >= 0);
    const root = new Map(list.map((i) => [i, i]));
    const top = (i) => (root.get(i) === i ? i : top(root.get(i)));
    for (const a of list) {
      for (const b of list) {
        if (a >= b) continue;
        const [fa, ta] = words(ops[a]);
        const [fb, tb] = words(ops[b]);
        if (holds(fb, ta) || holds(fa, tb) || holds(fb, fa) || holds(fa, fb)) root.set(top(b), top(a));
      }
    }
    const groups = new Map();
    for (const i of list) { const r = top(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    for (const g of groups.values()) if (g.length > 1) out.push(g.sort((x, y) => x - y));
  }
  return out;
}

/* names changed everywhere: every passage on the page, chapter names, the
 * notes, the book's own words, what the helper keeps of it, and the scenes
 * (who he plays, where it starts, every telling and move — Cozy Tavern's
 * M607-8) — each text once, every rule over it as it stood */
function renameEverywhere(novelId, novel, rules, put, why) {
  const undo = { what: 'many', passages: [], chapters: [], cards: [], book: [], kept: [], plays: [], seen: [], aside: [], summaries: [], entries: [], asks: [], plans: [] };
  const entriesSeen = archivist.entriesPrint(novel);
  const counts = rules.map(() => 0);
  const swap = (t) => { const r = replaceMany(t, rules); r.counts.forEach((c, k) => { counts[k] += c; }); return r.text; };
  /* the same rules over what was read, checked and summed up — never counted as places changed */
  const quiet = (t) => replaceMany(t, rules).text;
  const printsBefore = new Map((novel.order || []).map((id) => [id, chapterPrint(store.peek('chapter', id) || { passages: [] })]));
  const restamp = [];
  for (const x of eachPassage(novel)) {
    const next = swap(x.version.text);
    if (next === x.version.text) continue;
    /* (what it read as before it changes on the page itself: its words, their facts) */
    /* (its turns only while they are of these words, as its facts — timeline.js continuityNow, 2.12.40) */
    const was = { text: String(x.version.text || ''), sig: archivist.signature(x.version), codex: clone(codexNow(x.version)), continuity: clone(continuityNow(x.version)) };
    const made = newVersionOn(put, novelId, x, next, why, { retire: false, rename: true });
    undo.passages.push(made);
    restamp.push({ x, made, next, was });
  }
  /* WHAT WAS READ, CHECKED AND SUMMED UP FOLLOWS THE NAME (Cozy Tavern's
   * M752 restamp, M730): a version a rename made from the one the helper read
   * is read already — its reading kept for it, the names in it changed — and
   * the checker's findings and the chapter's summary go with it, so nothing
   * is read, checked or summed up again, and paid for, because a name changed */
  restampRenamed(novelId, novel, restamp, quiet, put, undo, printsBefore);
  for (const id of novel.order || []) {
    const c = store.peek('chapter', id);
    if (!c || !c.name) continue;
    const next = swap(c.name);
    if (next === c.name) continue;
    undo.chapters.push({ chapterId: id, before: { name: c.name, nameBy: c.nameBy || '' }, after: next });
    put('chapter', id, chapterSteps.setName(next, c.nameBy || 'you'), { now: true });
  }
  /* HIS OWN WORDS ON THE BOOK FOLLOW THE NAME (2.12.41, the review of 2.12.41 — a name changed everywhere is his word
   * for everywhere: after Tom became Thomas, his premise "Tom, Mara's brother…" still stood as the book, and the notes'
   * check made a card "Tom" beside Thomas's): each premise he typed — on every version that carries it, with his notes
   * for writing a passage again — each chapter's plan, and his bibliography's entries, their names, other names, line
   * and words (each sentence keeping when it was written: a name changed is no newer word — shape.js withStamps), all
   * with the rename's Undo. (Changed where they stand, not read through the rename: the writer, the helper, the check,
   * the Premise button and another take all read the one place his words are kept.) */
  for (const id of novel.order || []) {
    const c = store.peek('chapter', id);
    if (!c) continue;
    if (typeof c.plan === 'string' && c.plan.trim()) {
      const next = swap(c.plan);
      if (next !== c.plan) { undo.plans.push({ chapterId: id, before: c.plan, after: next.replace(/\s+$/, '') }); put('chapter', id, chapterSteps.setPlan(next), { now: true }); }
    }
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      for (const v of p.versions || []) {
        if (!v || !v.ask || typeof v.ask !== 'object') continue;
        for (const field of ['direction', 'premise', 'note']) {
          const was = v.ask[field];
          if (typeof was !== 'string' || !was.trim()) continue;
          const next = swap(was);
          if (next === was) continue;
          undo.asks.push({ chapterId: id, passageId: p.id, versionId: v.id, field, before: was, after: next });
          put('chapter', id, askStep(p.id, v.id, field, was, next), { now: true });
        }
      }
    }
  }
  for (const e of entriesOf(novel)) {
    const before = clone(e);
    const next = tidyEntry({ ...clone(e), name: swap(e.name), aka: (e.aka || []).map((a) => swap(a)), line: swap(e.line || ''), text: swap(e.text || '') });
    if (JSON.stringify(next) === JSON.stringify(tidyEntry(clone(e)))) continue;
    /* (when each sentence was written, carried to its words with the name changed; when it was saved stays) */
    const stamps = stampsOf(e);
    next.saidAt = Object.fromEntries(entrySentences(e).map((s) => [sentenceKey(quiet(s)), stamps.get(sentenceKey(s)) || 0]).filter(([, t]) => t));
    next.at = e.at;
    const after = withStamps(e, next);
    undo.entries.push({ id: e.id, before, after: clone(after) });
    put('novel', novelId, novelSteps.putEntry(after), { now: true });
  }
  for (const kind of NOTE_KINDS) {
    for (const card of (novel.notes && novel.notes[kind]) || []) {
      const next = clone(card);
      for (const k of ['name', 'about', 'ties', 'now', 'since']) if (typeof next[k] === 'string') next[k] = swap(next[k]);
      if (Array.isArray(next.aka)) next.aka = next.aka.map((a) => swap(a));
      if (JSON.stringify(next) === JSON.stringify(card)) continue;
      undo.cards.push({ kind, id: card.id, before: clone(card), after: clone(next) });
      put('novel', novelId, novelSteps.putNote(kind, next), { now: true });
    }
  }
  for (const [field, meta] of [['brief', false], ['style', false], ['plans', false], ['ending', false], ['title', true], ['subtitle', true]]) {
    const old = String((meta ? novel.meta[field] : novel[field]) || '');
    const next = swap(old);
    if (next === old) continue;
    undo.book.push({ field, meta, before: old, after: next });
    put('novel', novelId, meta ? novelSteps.setMeta({ [field]: next }) : novelSteps.setField(field, next), { now: true });
  }
  for (const key of ['about', 'style']) {
    const k = novel.kept && novel.kept[key];
    if (!k || !k.text) continue;
    const next = swap(k.text);
    if (next === k.text) continue;
    const after = { ...k, text: next };
    undo.kept.push({ key, before: clone(k), after: clone(after) });
    put('novel', novelId, novelSteps.setKept(key, after), { now: true });
  }
  for (const playId of novel.plays || []) {
    const pl = store.peek('play', playId);
    if (!pl) continue;
    const row = { playId, fields: {}, versions: [] };
    for (const k of ['who', 'from']) {
      const next = swap(pl[k]);
      if (next !== String(pl[k] || '')) row.fields[k] = { before: pl[k], after: next };
    }
    for (const t of pl.turns || []) {
      for (const v of t.versions || []) {
        if (v.streaming) continue;
        const nt = swap(v.text);
        const nl = v.tell ? swap(v.tell) : v.tell;
        if (nt !== String(v.text || '') || nl !== v.tell) row.versions.push({ turnId: t.id, versionId: v.id, before: { text: v.text, tell: v.tell }, after: { text: nt, tell: nl } });
      }
    }
    if (!Object.keys(row.fields).length && !row.versions.length) continue;
    put('play', playId, (d) => {
      for (const [k, f] of Object.entries(row.fields)) d[k] = f.after;
      for (const x of row.versions) {
        const t = (d.turns || []).find((y) => y.id === x.turnId);
        const v = t && t.versions.find((y) => y.id === x.versionId);
        if (v) { v.text = x.after.text; if (x.after.tell !== undefined) v.tell = x.after.tell; }
      }
    }, { now: true });
    undo.plays.push(row);
  }
  /* (the notes' check saw his entries as they read: it has seen them with the name changed — the cards changed with them —
   * so no check is owed for a name changed, as nothing is read again for it; and its Undo the same way back) */
  if (!put.dry && undo.entries.length) undo.entriesPrint = entriesCheckFollows(novelId, entriesSeen);
  return { undo, counts };
}
/* the notes' check's print of his entries moved to the entries as they are now, when it was the print of `was` — the
 * print now, or '' when nothing moved */
function entriesCheckFollows(novelId, was) {
  const live = store.peek('novel', novelId);
  const a = live && live.memory && live.memory.audit;
  if (!a || a.entries !== was) return '';
  const now = archivist.entriesPrint(live);
  store.change('novel', novelId, novelSteps.setMemory({ audit: { ...a, entries: now } }), { now: true });
  return now;
}
function restampRenamed(novelId, novel, restamp, quiet, put, undo, printsBefore) {
  const mem = novel.memory || {};
  const seenAll = mem.seen || {};
  const readings = mem.readings || {};
  const sigOfV = (v) => archivist.signature(v);
  const newSigs = new Map();
  for (const { x, made, next, was } of restamp) newSigs.set(was.sig, { pid: x.passage.id, vid: made.versionId, sig: sigOfV({ id: made.versionId, text: next }) });
  const swapCard = (c) => {
    if (!c) return c;
    const out = clone(c);
    for (const k of ['name', 'about', 'ties', 'now', 'since']) if (typeof out[k] === 'string') out[k] = quiet(out[k]);
    if (Array.isArray(out.aka)) out.aka = out.aka.map(quiet);
    return out;
  };
  const swapKept = (k) => (k && typeof k.text === 'string' ? { ...clone(k), text: quiet(k.text) } : clone(k));
  const seenNow = {};
  const asideMoved = {};
  for (const { x, made, next, was } of restamp) {
    const oldSig = was.sig;
    const to = newSigs.get(oldSig);
    /* read as it was: read as it is now */
    if ((seenAll[x.chapterId] || {})[x.passage.id] === oldSig) {
      const map = seenNow[x.chapterId] || (seenNow[x.chapterId] = { ...(seenAll[x.chapterId] || {}) });
      map[x.passage.id] = to.sig;
      undo.seen.push({ chapterId: x.chapterId, pid: x.passage.id, from: oldSig, to: to.sig });
    }
    /* set aside as it was: set aside as it is now, as a mend keeps it (archivist.js resign — 2.12.40, the review: left
     * with the words before, the Timeline said it was read by itself, which it never was, and Read it again, under
     * Cards, took off a mark of read it no longer had, so nothing was read again) */
    const a = (mem.aside || {})[x.passage.id];
    if (a && a.sig === oldSig) {
      asideMoved[x.passage.id] = { ...clone(a), sig: to.sig };
      undo.aside.push({ pid: x.passage.id, from: oldSig, to: to.sig });
    }
    /* its reading, kept for the new version with the names in it changed */
    const r = (readings[x.passage.id] || {})[x.version.id];
    if (r && r.sig === oldSig) {
      let copy;
      if (r.in) { const t = newSigs.get(r.in.sig); copy = { sig: to.sig, in: t ? { pid: t.pid, vid: t.vid, sig: t.sig } : clone(r.in) }; }
      else copy = { ...clone(r), sig: to.sig, cards: (r.cards || []).map((c) => ({ ...c, before: swapCard(c.before), after: swapCard(c.after) })), kept: Object.fromEntries(Object.entries(r.kept || {}).map(([k, v]) => [k, { before: swapKept(v.before), after: swapKept(v.after) }])) };
      put('novel', novelId, novelSteps.putReading(x.passage.id, made.versionId, copy), { now: true });
    }
    /* the bibliography's facts it established, their words changed with it (bibliography.js carriedCodex): never read for again */
    const facts = carriedCodex(was.codex, next, quiet);
    if (facts) {
      put('chapter', x.chapterId, (ch) => {
        const p = (ch.passages || []).find((y) => y.id === x.passage.id);
        const v = p && (p.versions || []).find((y) => y.id === made.versionId);
        if (!v || hashText(String(v.text || '')) !== facts.fp) return false;
        v.codex = JSON.parse(JSON.stringify(facts));
      }, { now: true });
    }
    /* and the Timeline's turns, as the facts (timeline.js carriedContinuity, 2.12.37) */
    const turns = carriedContinuity(was.continuity, next, quiet);
    if (turns) {
      put('chapter', x.chapterId, (ch) => {
        const p = (ch.passages || []).find((y) => y.id === x.passage.id);
        const v = p && (p.versions || []).find((y) => y.id === made.versionId);
        if (!v || hashText(String(v.text || '')) !== turns.fp) return false;
        v.continuity = JSON.parse(JSON.stringify(turns));
      }, { now: true });
    }
    /* the checker's findings on it, their words changed with it */
    const live = store.peek('chapter', x.chapterId);
    const e = live && live.checks && live.checks[x.passage.id] && live.checks[x.passage.id][x.version.id];
    if (e && e.sig === hashText(was.text)) {
      const items = (e.items || []).map((it) => ({ ...clone(it), ...(typeof it.find === 'string' ? { find: quiet(it.find) } : {}), ...(typeof it.replace === 'string' ? { replace: quiet(it.replace) } : {}) }));
      put('chapter', x.chapterId, chapterSteps.setCheck(x.passage.id, made.versionId, { ...clone(e), sig: hashText(next), items }), { now: true });
    }
  }
  for (const [chapterId, map] of Object.entries(seenNow)) put('novel', novelId, novelSteps.seen(chapterId, map), { now: true });
  if (Object.keys(asideMoved).length) put('novel', novelId, novelSteps.setAside(asideMoved), { now: true });
  /* a chapter's summary that was true of it stays true of it, the name changed */
  for (const id of novel.order || []) {
    const c = store.peek('chapter', id);
    const s = c && c.summary;
    if (!s || !String(s.text || '').trim() || s.fp !== printsBefore.get(id)) continue;
    const text = quiet(s.text);
    const fp = chapterPrint(c);
    if (text === s.text && fp === s.fp) continue;
    const after = { ...clone(s), text, fp };
    undo.summaries.push({ chapterId: id, before: clone(s), after: clone(after) });
    put('chapter', id, chapterSteps.setSummary(after), { now: true });
    put('chapter', id, chapterSteps.keepSummary(after), { now: true });
  }
}

/* the same words changed across the chapters each change names */
function replaceEverywhere(novelId, novel, items, put, why) {
  const undo = { what: 'many', passages: [], chapters: [], cards: [], book: [], kept: [] };
  const counts = items.map(() => 0);
  for (const x of eachPassage(novel)) {
    const which = items.map((it, k) => (inRange(it.range, x.ci) ? k : -1)).filter((k) => k >= 0);
    if (!which.length) continue;
    const r = replaceMany(x.version.text, which.map((k) => items[k].rule));
    if (r.text === String(x.version.text)) continue;
    r.counts.forEach((c, j) => { counts[which[j]] += c; });
    undo.passages.push(newVersionOn(put, novelId, x, r.text, why));
  }
  return { undo, counts };
}

/* Changes across the book made together: names everywhere, or words across
 * chapters (one kind a group). Each is checked first — one that cannot be
 * made takes the others of its group with it, said, so a swap is never made
 * by half. The first holds the Undo for all; the others say they went with
 * it. Returns one change per op, in order. */
const REREADING = 'the whole book is being read again for the notes just now — ask for this once that is done';
export function makeTogether(novelId, ops, { ids = [], dry = false } = {}) {
  const put = dry ? Object.assign(() => {}, { dry: true }) : (...a) => store.change(...a);
  const at = Date.now();
  const bases = ops.map((op, i) => ({ id: ids[i] || newId('cg'), op: clone(op), label: labelOf(op), why: text(op.why) }));
  const novel = store.peek('novel', novelId);
  if (!novel) return bases.map((b) => ({ ...b, status: 'refused', said: 'the book is not open' }));
  const names = ops[0] && ops[0].rename && typeof ops[0].rename === 'object';
  /* while the whole book is read again, the notes stand half built beside the ones everyone reads: a name changed now would miss one of them (S04-G2) */
  if (names && archivist.rereading(novelId)) return bases.map((b) => ({ ...b, status: 'refused', said: REREADING }));
  const items = ops.map((op) => (names ? renameOf(novel, op) : replaceAllOf(novel, op)));
  const bad = items.findIndex((x) => x.why);
  if (bad >= 0) return bases.map((b, i) => ({ ...b, status: 'refused', said: i === bad ? items[i].why : `it goes together with ${bases[bad].label}, which could not be made: ${items[bad].why}` }));
  const why = bases.map((b) => b.why).filter(Boolean).join(' ') || undefined;
  const { undo, counts } = names ? renameEverywhere(novelId, novel, items.map((x) => x.rule), put, why) : replaceEverywhere(novelId, novel, items, put, why);
  if (names && counts.some((n) => n > 0)) {
    undo.renamed = items.map((x) => ({ from: x.from, to: x.to }));
    put('novel', novelId, novelSteps.noteRenames(undo.renamed, at));
  }
  const missing = (i) => (names ? `“${items[i].from}” does not stand anywhere in the book` : 'those words stand nowhere in those chapters');
  if (!counts.some((n) => n > 0)) return bases.map((b, i) => ({ ...b, status: 'refused', said: missing(i) }));
  put('novel', novelId, novelSteps.touchWritten(at));
  const lead = counts.findIndex((n) => n > 0);
  const premises = new Set((undo.asks || []).map((x) => x.passageId)).size;
  const reach = names
    ? [undo.passages.length ? plural(undo.passages.length, 'passage') : '', undo.chapters.length ? plural(undo.chapters.length, 'chapter name') : '',
      undo.cards.length ? `${plural(undo.cards.length, 'card')} in the notes` : '', (undo.entries || []).length ? `${plural(undo.entries.length, 'entry', 'entries')} in the bibliography` : '',
      premises ? `the premises of ${plural(premises, 'passage')}` : '', (undo.plans || []).length ? plural(undo.plans.length, 'chapter plan') : '',
      undo.book.length + undo.kept.length ? 'the book’s own words' : '',
      undo.plays.length ? plural(undo.plays.length, 'scene') : ''].filter(Boolean).join(', ')
    : `${plural(counts.reduce((a, b) => a + b, 0), 'place')} in ${plural(undo.passages.length, 'passage')}`;
  /* two cards now called the same (the name it became was a card's already): the notes' check folds them into one (Cozy Tavern's M730) */
  const after = dry ? null : store.peek('novel', novelId);
  let twice = '';
  for (const k of after ? NOTE_KINDS : []) {
    const list = (after.notes || {})[k] || [];
    const ks = list.map((c) => nameKey(c.name));
    const i = ks.findIndex((x, j) => x && ks.indexOf(x) !== j);
    if (i >= 0) { twice = list[i].name; break; }
  }
  if (twice) archivist.askAudit(novelId);
  /* (and two entries now called the same: said, for him to put together — an entry is his, never folded by the app) */
  let twiceEntry = '';
  if (after && names && (undo.entries || []).length) {
    const list = entriesOf(after);
    const hit = list.find((e) => undo.entries.some((x) => x.id === e.id) && nameTaken(list, e.name, e.id));
    if (hit) twiceEntry = hit.name;
  }
  const said = (names ? `changed in ${reach}` : reach) + (twice ? `; two cards are now called ${twice} — the notes’ check folds them into one` : '') + (twiceEntry ? `; two entries of your bibliography now go by ${twiceEntry} — put them together there` : '');
  return bases.map((b, i) => {
    const what = names ? { before: items[i].from, after: items[i].to } : { before: items[i].find, after: items[i].words };
    if (!counts[i]) return { ...b, status: 'refused', said: missing(i) };
    if (i === lead) return { ...b, status: 'made', undo, ...what, said };
    return { ...b, status: 'made', with: bases[lead].id, ...what, said: `made together with ${bases[lead].label} — its Undo takes back both` };
  });
}

/* ------------------------------------------------------------ making one */

/* the kind an entry change asks for, as the bibliography finds its entry by it (bibliography.js entryFor) — the same for
 * making it, for what it was shown and for what it writes over, so a change for a new group named as a person of his is
 * never held to that person's words (2.12.41, the third review) */
const kindAsked = (op) => ({ kind: op && op.kind !== undefined ? kindSaid(op.kind) : '' });

/* One change, made. Returns the change as kept on the reply:
 * {id, op, label, why, status: 'made'|'refused', said?, undo?}. */
/* when the writer reads an entry, as it may be said */
/* (and as the screen says it: "When there's room", "Page by page", "Never — it's only for me", 2.12.35) */
const RIDES_SAID = { always: 'always', named: 'named', 'when named': 'named', 'when its name comes up': 'named', 'when there’s room': 'named', "when there's room": 'named', 'page by page': 'named', never: 'never', 'only for me': 'never', 'never — it’s only for me': 'never', "never — it's only for me": 'never', 'never - only for me': 'never' };
const entryRides = (v) => RIDES_SAID[String(v || '').trim().toLowerCase().replace(/[.!]+$/, '')] || '';
function makeEntry(novelId, novel, op, { base, refuse, put, at, newBy = 'partner', entriesSeen = null }) {
  const entries = entriesOf(novel);
  const name = archivist.cleanName(op.entry);
  if (!name) return refuse(text(op.entry) ? `“${clipped(text(op.entry))}” is no name — name the entry as the bibliography does` : 'the entry needs a name');
  /* (found as the bibliography finds a name, for the kind it asks for — a person by a name of theirs only where it asks
   * for a person, or for no kind: 2.12.41, the third review of Quick add, "Kuchiki" the house made Rukia Kuchiki a group) */
  const asked = kindAsked(op).kind;
  const m = entryFor(entries, name, { kind: asked });
  if (m.ambiguous) return refuse(`more than one entry goes by ${name} — name it by its full name`);
  const cur = m.entry ? clone(m.entry) : null;
  /* AN ENTRY FOUND BY ANOTHER NAME IS NEVER MADE ANOTHER KIND (2.12.41, the third review): one it goes by, the same without
   * its "The", a person's given name — another kind asked for is said, never written, and nothing of the change is made:
   * two kinds of one name may be two things */
  if (cur && asked && m.by !== 'name' && asked !== kindOf(cur.kind)) return refuse(`“${name}” finds ${cur.name}, a ${KIND_ONE[kindOf(cur.kind)]} — its kind is changed under its own name, ${cur.name}; for something else, give it a name of its own`);
  /* HIS ENTRY WRITTEN WHOLE ONLY BY AN ANSWER THAT READ IT WHOLE (2.12.40, the audit — the twin of a passage it had only
   * in short, and of a card it had by its first line): an entry its answer saw only by its name and line in the list is
   * never written over from that — read first (`entriesSeen`: the ids of the entries it had whole); a paragraph added to
   * it takes nothing away. Its words given back word for word write nothing over: the entry already says that (2.12.40,
   * the review — it was turned away as read only in short, and asked again for nothing) */
  if (cur && op.text !== undefined && sameWordsAs(op.text, cur.text)) op = { ...op, text: undefined };
  if (cur && entriesSeen && !entriesSeen.has(cur.id) && String(cur.text || '').trim() && op.text !== undefined && archivist.cleanText(op.text, 20000)) return refuse(`it had ${cur.name}’s entry only in short, by its name and line — read it whole first with “entry: ${cur.name}”, or add a paragraph to it`);
  if (truthOf(op.remove) === true) {
    if (!cur) return refuse(`there is no ${name} in the bibliography`);
    put('novel', novelId, novelSteps.dropEntry(cur.id), { now: true });
    return { ...base, status: 'made', undo: { what: 'entry', id: cur.id, before: cur, after: null }, before: cur.text || cur.line || '', after: '' };
  }
  const next = cur ? clone(cur) : newEntry({ name, kind: 'people', at });
  const newName = archivist.cleanName(op.newName !== undefined ? op.newName : op.rename_to);
  if (newName && !cur) return refuse(`there is no ${name} in the bibliography to rename`);
  if (newName && nameKey(newName) !== nameKey(cur.name)) {
    if (nameTaken(entries, newName, cur.id)) return refuse(`another entry goes by ${newName} already`);
    next.aka = [...(next.aka || []), cur.name];
    next.name = newName;
  }
  if (op.kind !== undefined) {
    const k = kindSaid(op.kind);
    if (!k) return refuse(`“${clipped(text(op.kind))}” is not a kind of entry — people, places, things, groups or lore`);
    next.kind = k;
  }
  if (op.rides !== undefined) {
    let r = entryRides(op.rides);
    if (!r) return refuse(`“${clipped(text(op.rides))}” is not when the writer reads it — always, named or never`);
    /* (Page by page, under Super automatic, is how the screen says Always and When there's room alike: what he set stays
     * underneath, as the entry's own sheet keeps it — never Never, which goes as When there's room; 2.12.35, the review:
     * said by the partner, it let his Always go) */
    if (/^page by page$/i.test(String(op.rides || '').trim().replace(/[.!]+$/, '')) && superOn(store.peek('house', 'house') || {})) r = cur && cur.rides !== 'never' ? cur.rides : 'named';
    /* with Super automatic on, every entry goes page by page: Always is his to set when it is off (2.12.35) */
    if (r === 'always' && superOn(store.peek('house', 'house') || {}) && (!cur || cur.rides !== 'always')) return refuse('with Super automatic on, every entry goes page by page — Always is set in the entry itself once Super automatic is off');
    next.rides = r;
  }
  const line = op.line === undefined ? '' : archivist.cleanText(op.line, 400);
  if (line) next.line = line.replace(/\s*\n+\s*/g, ' ');
  const whole = op.text === undefined ? '' : archivist.cleanText(op.text, 20000);
  if (whole) next.text = whole;
  const more = op.add === undefined ? '' : archivist.cleanText(op.add, 8000);
  /* the same paragraph never twice (an answer asked again, a round sent again: as the book's own words, M79/M603) */
  const had = String(next.text || '');
  const twice = Boolean(more && had.trim() && (!locate(had, more).why || had.includes(more)));
  if (more && !twice) next.text = [had.trim(), more].filter(Boolean).join('\n\n');
  const names = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : String(v).split(',')).map(archivist.cleanName).filter(Boolean);
  const less = names(op.dropAka).map(nameKey);
  /* (only a name it does not go by yet is held to the others — one it goes by already stands, though an entry from
   * before goes by it too: 2.12.41, the third review, as his entry sheet checks only the names he sets) */
  const hasNow = new Set(cur ? [cur.name, ...(cur.aka || [])].map(nameKey) : []);
  for (const a of names(op.aka)) {
    if (nameKey(a) === nameKey(next.name) || less.includes(nameKey(a)) || hasNow.has(nameKey(a))) continue;
    if (nameTaken(entries, a, next.id)) return refuse(`another entry goes by ${a} already`);
    next.aka = [...(next.aka || []), a];
  }
  if (less.length) next.aka = (next.aka || []).filter((a) => !less.includes(nameKey(a)));
  const tidy = tidyEntry(next);
  if (!ENTRY_KINDS.includes(tidy.kind) || !RIDES.includes(tidy.rides)) return refuse('the entry could not be read');
  if (cur && JSON.stringify(tidy) === JSON.stringify(tidyEntry(cur))) return refuse(twice ? 'those words are there already' : 'the entry already says that');
  if (!cur && !tidy.line && !tidy.text) return refuse('it gave nothing to write in a new entry');
  /* whose it is: an entry he wrote stays his when the partner changes it (2.12.35: it was tagged "your partner's"); one
   * changed by his own words — Quick add's — is his from then on (2.12.40, the audit: it stayed "your partner's") */
  const by = cur ? (newBy === 'you' ? 'you' : cur.by === 'partner' ? 'partner' : cur.by) : newBy;
  /* (with when each of its words was written, as the entry's one write keeps it — a sentence kept keeps its time, only
   * one new or changed takes now: shape.js withStamps, 2.12.41 — so its Undo finds it as it was left) */
  const after = withStamps(cur, { ...tidy, at, ...(by ? { by } : {}) });
  put('novel', novelId, novelSteps.putEntry(after), { now: true });
  return { ...base, status: 'made', undo: { what: 'entry', id: after.id, before: cur, after: clone(after) }, before: cur ? (cur.text || cur.line || '') : '', after: after.text || after.line || '' };
}

export function makeChange(novelId, op, { id = newId('cg'), dry = false, seen = null, where = null, numbers = null, short = null, entryBy = '', entriesSeen = null } = {}) {
  /* dry: everything looked at as it would be, nothing written — whether it would land (whyNot) */
  const put = dry ? () => {} : (...a) => store.change(...a);
  if (op && op.unreadable) return { id, op: clone(op), label: 'A changes block', why: '', status: 'refused', said: `its changes block could not be read (it began: ${op.head || '…'})` };
  const base = { id, op: clone(op), label: labelOf(op), why: text(op.why) };
  const refuse = (said) => ({ ...base, status: 'refused', said });
  const novel = store.peek('novel', novelId);
  if (!novel) return refuse('the book is not open');
  const at = Date.now();

  /* a name changed everywhere in the book, or the same words across chapters:
   * made as one of a group of one (makeTogether) */
  if ((op.rename && typeof op.rename === 'object') || op.replace_all !== undefined) return makeTogether(novelId, [op], { ids: [id], dry })[0];

  /* a module's words (Cozy Tavern's rulebook edits): his words from then on */
  if (op.module !== undefined) {
    const house = store.peek('house', 'house') || {};
    const want = nameKey(op.module);
    const all = listModules(house);
    let m = all.find((x) => nameKey(x.name) === want || x.id === String(op.module));
    if (!m) { const starts = all.filter((x) => nameKey(x.name).startsWith(want)); if (starts.length === 1) [m] = starts; else if (starts.length > 1) return refuse(`more than one module starts with “${op.module}” — name it whole`); }
    if (!m) return refuse(`there is no module called “${op.module}”`);
    const old = String(m.text || '');
    let next;
    if (op.find !== undefined) {
      const w = newWords(op);
      if (w === null) return refuse('it gave no new words for them');
      const spot = locate(old, op.find);
      if (spot.why) return refuse(whyNotFound(spot, old, op.find));
      next = old.slice(0, spot.start) + w + old.slice(spot.end);
    } else if (op.text !== undefined) {
      next = String(op.text);
      if (!hasWords(next)) return refuse(`it gave no words for the module — “${clipped(next)}” is none`);
    } else return refuse('it gave no words');
    if (next === old) return refuse('it would change nothing');
    const before = m.builtin && !m.ownWords ? undefined : old;
    put('house', 'house', moduleSteps.set(m.id, { text: next }), { now: true });
    return { ...base, label: `The module “${m.name}”`, status: 'made', undo: { what: 'module', id: m.id, before, after: next }, before: cutWords(old, 400), after: cutWords(next, 400) };
  }

  /* a chapter's summary, his from then on (until the chapter itself changes) */
  if (op.summary !== undefined) {
    const spot0 = chapterAt(novel, op.summary, { where, numbers });
    if (spot0.why) return refuse(spot0.why);
    const { chapter, chapterId } = spot0;
    const old = String((chapter.summary && chapter.summary.text) || '');
    let next;
    if (op.find !== undefined) {
      const w = newWords(op);
      if (w === null) return refuse('it gave no new words for them');
      const spot = locate(old, op.find);
      if (spot.why) return refuse(whyNotFound(spot, old, op.find));
      next = old.slice(0, spot.start) + w + old.slice(spot.end);
    } else if (op.text !== undefined) {
      next = text(op.text);
      if (next && !archivist.cleanText(next)) return refuse(`it gave no words for the summary — “${clipped(next)}” is none`);
    } else return refuse('it gave no words');
    if (!next.trim()) return refuse('a summary needs words');
    if (next === old) return refuse('it would change nothing');
    const was = chapter.summary ? clone(chapter.summary) : null;
    const after = { text: next, fp: chapterPrint(chapter), at, by: 'you' };
    put('chapter', chapterId, chapterSteps.setSummary(after), { now: true });
    /* kept for the chapter as it reads, so a version brought back brings his back too (Cozy Tavern's M680-9) */
    const keptBefore = clone((chapter.summaries || []).find((x) => x.fp === after.fp) || null);
    put('chapter', chapterId, chapterSteps.keepSummary(after), { now: true });
    return { ...base, status: 'made', undo: { what: 'summary', chapterId, before: was, after: clone(after), keptBefore }, before: old, after: next };
  }

  /* THE STORY MAP: what a chapter is for — his plan from then on. The chapter
   * after the last can be planned too: it is made, empty, to hold the plan
   * (Undo takes it out again while nothing is written in it). */
  if (op.plan !== undefined) {
    const next = text(op.text);
    if (!next.trim() || !archivist.cleanText(next)) return refuse(next ? `it gave no words for the plan — “${clipped(next)}” is none` : 'a plan needs words');
    const n = chapterNumber(op.plan);
    const order = novel.order || [];
    if (!(where && where.chapterId) && n === order.length + 1) {
      if (dry) return { ...base, status: 'made', before: '', after: next };
      const fresh = newChapter(novelId);
      fresh.plan = next;
      /* the chapter is on the page at once; its save goes on its way (a failed one is the store's to try again, never an unheard rejection) */
      Promise.resolve(store.create('chapter', fresh.id, fresh)).catch(() => {});
      put('novel', novelId, novelSteps.addChapter(fresh.id, order[order.length - 1] || null), { now: true });
      return { ...base, status: 'made', label: `What Chapter ${numberWords(n)} is for (a new chapter)`, undo: { what: 'plan', chapterId: fresh.id, before: '', after: next, made: true }, before: '', after: next };
    }
    const spot0 = chapterAt(novel, op.plan, { where, numbers });
    if (spot0.why) return refuse(spot0.why);
    const { chapter, chapterId } = spot0;
    const old = String(chapter.plan || '');
    if (next === old) return refuse('it would change nothing');
    put('chapter', chapterId, chapterSteps.setPlan(next), { now: true });
    return { ...base, status: 'made', undo: { what: 'plan', chapterId, before: old, after: next }, before: old, after: next };
  }

  if (op.passage !== undefined) {
    let spot0 = passageAt(novel, op.passage, { where, numbers });
    /* THE WORDS ARE THE KEY, THE NUMBER A HINT (2.12.9): a passage may hold a
     * whole chapter, and a partner counting paragraphs names "1.2" for words
     * that stand in 1.1 — the app can find them, so it does: words to change
     * that stand in exactly one passage of the chapter named are changed
     * there, and the card says where. Never for a passage taken out or
     * written whole (those name a passage, not words). */
    let relocated = '';
    if (op.find !== undefined && truthOf(op.remove) !== true && op.rewrite === undefined) {
      const named = spot0.why ? null : spot0;
      const there = named && !locate(String((picked(named.passage) || {}).text || ''), op.find).why;
      if (!there) {
        const alt = passageByWords(novel, op.passage, op.find);
        if (alt) { relocated = `the words stand in passage ${alt.pn}${named ? `, not ${named.pn}` : ''}`; spot0 = alt; }
      }
    }
    if (spot0.why) return refuse(spot0.why);
    const { chapter, passage } = spot0;
    if (passage.by === 'break') return refuse('that is a scene break');
    const v = picked(passage) || {};
    if (v.streaming) return refuse('that passage is being written just now');
    /* WRITTEN AGAIN BY THE WRITER (2.12.9): the partner's note goes to the
     * writer — his model, his instructions, its craft — as a Rewrite of that
     * passage, a new version he can undo; the partner's own prose for a page
     * only when he asks for its words ("text"). Started by talk.js once the
     * change is kept (status 'writing'); dry: looked at only. */
    if (op.rewrite !== undefined) {
      const note = text(op.rewrite);
      if (!hasWords(note)) return refuse('it gave no note for the writer');
      return { ...base, status: 'writing', rewrite: { chapterId: chapter.id, passageId: passage.id, from: v.id, note }, before: String(v.text || ''), said: 'the writer is writing it again' };
    }
    /* a passage taken out or written anew in a chapter it only had in short is
     * never guessed at: it reads the chapter whole first (Cozy Tavern's M61 v2.80) —
     * a passage it had word for word in a chapter told partly whole is seen (seen holds its id) */
    /* (its words given back word for word: nothing to write — said so, never as read only in short: 2.12.40) */
    if (truthOf(op.remove) !== true && op.text !== undefined && op.find === undefined && sameWordsAs(op.text, v.text)) return refuse('it would change nothing');
    if (seen && !seen.has(chapter.id) && !seen.has(passage.id) && (truthOf(op.remove) === true || (op.text !== undefined && op.find === undefined))) return refuse(`Chapter ${numberWords(spot0.ci)} was only in short in what it had — read it whole first`);
    /* taken out of the chapter, with its Undo; what only it put in the notes goes too */
    if (truthOf(op.remove) === true) {
      const i = chapter.passages.indexOf(passage);
      const after = i > 0 ? chapter.passages[i - 1].id : '^';
      const copy = clone(passage);
      if (!dry) archivist.retireIfSeen(novelId, chapter.id, passage.id);
      put('chapter', chapter.id, chapterSteps.removePassage(passage.id), { now: true });
      put('novel', novelId, novelSteps.touchWritten(at));
      return { ...base, status: 'made', undo: { what: 'removed', chapterId: chapter.id, passage: copy, after }, before: String(v.text || ''), after: '' };
    }
    const old = String(v.text || '');
    let next;
    let mended = '';
    if (op.text !== undefined && op.find === undefined) {
      next = text(op.text);
      if (!next) return refuse('it gave no words for the passage');
      if (!hasWords(next)) return refuse(`it gave no words for the passage — “${clipped(next)}” is none`);
      /* a passage written anew is made whole the way a page is (Cozy Tavern's
       * M176: the third path takes the same door): a stray of another script
       * stuck to a word, a soft wrap, a quotation left open — its words never
       * cut, they are all its own */
      const unglued = dropGluedStrays(next);
      const unmarked = dropMarkup(unglued.text);
      const marks = mendMarks(joinSoftWraps(unmarked.text));
      const spaced = mendSpacing(marks.text);
      if (unglued.changed || unmarked.changed || spaced.text !== unmarked.text) {
        mended = [unglued.changed ? 'a stray character of another script stuck to a word taken off' : '', unmarked.changed ? 'web page or code markup taken off' : '', marks.changed ? 'its quotation marks set right' : '', !marks.changed && marks.text !== unmarked.text ? 'a line broken mid-sentence joined' : '', spaced.changed ? 'a space a slip left out or put in set right' : ''].filter(Boolean).join('; ');
        next = spaced.text;
      }
    } else {
      let words = newWords(op);
      if (words === null) return refuse('it gave no new words for them');
      /* its new words, never a web page's tag or a fence of code (his report, 2.12.2) — unless the words it replaces had them */
      if (!hasMarkupText(String(op.find || ''))) {
        const lead = words.match(/^\s*/)[0];
        const trail = words.match(/\s*$/)[0];
        const unmarked = dropMarkup(words.trim());
        if (unmarked.changed) { words = lead + unmarked.text + trail; mended = 'web page or code markup taken off'; }
      }
      const spot = locate(old, op.find);
      if (spot.why) return refuse(whyNotFound(spot, old, op.find));
      next = old.slice(0, spot.start) + words + old.slice(spot.end);
    }
    if (next === old) return refuse('it would change nothing');
    const anew = op.text !== undefined && op.find === undefined;
    /* words changed in it: on the page itself, the words before kept on it (his word, 2.12.2: "Why partner edit create
     * new version??? … new version is only for rewrite or another take"); the passage written anew is a rewrite: a
     * version of its own, the one before one arrow away */
    let version = null;
    if (anew) {
      /* (the page that ended its chapter, written anew, still ends it: 2.12.35) */
      version = newVersion({ text: next, how: 'partner', from: v.id, words: countWords(next), why: base.why || undefined, ...(v.ask ? { ask: v.ask } : {}), ...(v.closes ? { closes: true } : {}) });
      put('chapter', chapter.id, chapterSteps.addVersion(passage.id, version), { now: true });
      put('novel', novelId, novelSteps.touchWritten(at));
    } else if (!dry && !changeInPlace({ novelId, chapterId: chapter.id, passageId: passage.id, versionId: v.id, next, by: 'partner', extra: base.why ? { why: base.why } : {} })) return refuse('the passage is being written just now');
    /* the words it replaced, where they still stand elsewhere in the book —
     * said, so the rest can be made to agree when it should (Cozy Tavern's
     * ripple, M61 v2.77; nothing else is changed by itself) */
    const stands = op.find !== undefined && !dry ? stillStands(novel, String(op.find), passage.id) : '';
    /* a passage written whole at less than half its length is said so, with
     * both counts — asked for, it stands; if not, Undo is right there */
    const was = countWords(old);
    const now = countWords(next);
    const shrunk = anew && was > 60 && now < was / 2 ? `it is ${now.toLocaleString()} words now, from ${was.toLocaleString()}` : '';
    const said = [relocated, shrunk, stands, mended].filter(Boolean).join('; ');
    const undo = anew ? { what: 'passage', chapterId: chapter.id, passageId: passage.id, versionId: version.id, from: v.id } : { what: 'words', chapterId: chapter.id, passageId: passage.id, versionId: v.id, before: old, after: next };
    return { ...base, status: 'made', undo, before: old, after: next, ...(said ? { said } : {}) };
  }

  if (op.chapter !== undefined) {
    const spot0 = chapterAt(novel, op.chapter, { where, numbers });
    if (spot0.why) return refuse(spot0.why);
    const { chapter, chapterId } = spot0;
    /* "" takes the name off; "…", "unchanged" and the like are no name (Cozy Tavern's door, M656) */
    const name = text(op.name).slice(0, 120);
    if (name && !archivist.cleanName(name)) return refuse(`“${name}” is no name for a chapter`);
    if (name === (chapter.name || '')) return refuse('it already has that name');
    /* how it was, taken before the change (the record changes in place) */
    const was = { name: chapter.name || '', nameBy: chapter.nameBy || '' };
    /* named for him: the helper never names it again */
    put('chapter', chapterId, chapterSteps.setName(name, 'you'), { now: true });
    return { ...base, status: 'made', undo: { what: 'chapter', chapterId, before: was, after: name }, before: was.name, after: name };
  }

  if (op.book !== undefined) {
    const field = BOOK_FIELDS[op.book];
    if (!field) return refuse(`“${op.book}” is not a part of the book it can change`);
    const meta = field === 'title' || field === 'subtitle';
    const old = String((meta ? novel.meta[field] : novel[field]) || '');
    /* What it's about / How it reads, for a book set to Automatic: the words
     * it reads are his and what the helper keeps of the book — a find in the
     * kept words is made there, as his correction from then on (Cozy
     * Tavern's M223: sight without reach) */
    const keyOf = { brief: 'about', style: 'style' }[field];
    const k = keyOf && novel.kept && novel.kept[keyOf];
    /* read with the names in */
    const names = meta ? null : bookNames(store.peek('house', 'house') || {}, novel);
    if (op.find !== undefined && keyOf && k && String(k.text || '').trim() && locateNamed(old, op.find, names).why && !locateNamed(String(k.text), op.find, names).why) {
      const words = newWords(op);
      if (words === null) return refuse('it gave no new words for them');
      const spot = locateNamed(String(k.text), op.find, names);
      /* (the helper's account put right — still the helper's, kept current from the book: never frozen as his own, 2.12.19) */
      const after = { text: putIn(String(k.text), spot, words), at };
      put('novel', novelId, novelSteps.setKept(keyOf, after), { now: true });
      return { ...base, status: 'made', undo: { what: 'many', passages: [], chapters: [], cards: [], book: [], kept: [{ key: keyOf, before: clone(k), after: clone(after) }] }, before: k.text, after: after.text };
    }
    let next;
    if (op.find !== undefined) {
      const words = newWords(op);
      if (words === null) return refuse('it gave no new words for them');
      const spot = locateNamed(old, op.find, names);
      if (spot.why) return refuse(whyNotFound(spot, old, op.find));
      next = putIn(old, spot, words);
    } else if (op.add !== undefined) {
      /* the same paragraph never twice (an answer asked again, a round re-sent: M79/M603) */
      const add = text(op.add);
      if (!add || !hasWords(add)) return refuse('it gave no words');
      if (!locateNamed(old, add, names).why || old.includes(add)) return refuse('those words are there already');
      next = [old.replace(/\s+$/, ''), add].filter(Boolean).join('\n\n');
    } else if (op.text !== undefined) {
      next = text(op.text);
      if (next && !hasWords(next)) return refuse(`it gave no words — “${clipped(next)}” is none`);
    } else return refuse('it gave no words');
    if (field === 'title' && !next.trim()) return refuse('a book needs a title');
    if (next === old) return refuse('it would change nothing');
    put('novel', novelId, meta ? novelSteps.setMeta({ [field]: next }) : novelSteps.setField(field, next), { now: true });
    return { ...base, status: 'made', undo: { what: 'book', field, meta, before: old, after: next }, before: old, after: next };
  }

  /* an entry in his bibliography (bibliography.js): his, made at his asking */
  /* (Quick add's entries are his own words for his world: a new one is his — quickadd.js `entryBy`) */
  if (op.entry !== undefined) return makeEntry(novelId, novel, op, { base, refuse, put, at, newBy: entryBy === 'you' ? 'you' : 'partner', entriesSeen });
  if (op.note !== undefined && archivist.rereading(novelId)) return refuse(REREADING);
  if (op.note !== undefined) {
    const kind = op.note;
    if (!NOTE_KINDS.includes(kind)) return refuse(`“${kind}” is not a part of the notes`);
    /* through the helper's door (Cozy Tavern's M648/M656): "…", "unchanged",
     * "none", an excuse or an object is no name and no words — a part given
     * so is not given, and the card keeps what it says */
    const name = archivist.cleanName(op.name);
    if (!name) return refuse(text(op.name) ? `“${clipped(text(op.name))}” is no name — name the card as the notes do` : 'the card needs a name');
    const list = (novel.notes && novel.notes[kind]) || [];
    /* the card the name means: the one called that before one that goes by it; two answering, neither (shape.js matchCard) */
    const m = matchCard(list, name, [], { kind, near: false });
    if (m.ambiguous) return refuse(`more than one card goes by ${name} — name the card by its full name`);
    /* how it was, taken before the change */
    const card = m.card ? clone(m.card) : null;
    /* no card called that, but one the name answers to as a reading would
     * find it — a short or fuller name, a slip of the pen, the same thread in
     * other words: named back, never a second card beside it (Cozy Tavern's
     * M419/M449; told back, the partner names it as the notes do) */
    if (!card) {
      const near = matchCard(list, name, [], { kind });
      if (near.ambiguous) return refuse(`there is no ${name} in the notes — more than one card answers to it; name the card as the notes do`);
      if (near.card) return refuse(`there is no ${name} in the notes — the card is called ${near.card.name}; name it so`);
    }
    /* a card it was shown only by its first line is never written whole from
     * it: who they are, or how they stand with the others, read first (the
     * twin of a passage it only had in short — Cozy Tavern's M84-4/M86) */
    /* (a field given back word for word as it stands writes nothing: 2.12.40) */
    const writes = (k) => op[k] !== undefined && Boolean(archivist.cleanText(op[k])) && !(card && sameWordsAs(op[k], card[k]));
    if (card && short && short.has(card.id) && ['about', 'ties'].some(writes)) return refuse(`it had ${card.name}'s card only by its first line — read it whole first with “card: ${card.name}”`);
    if (truthOf(op.remove) === true) {
      if (!card) return refuse(`there is no ${name} in the notes`);
      put('novel', novelId, novelSteps.dropNote(kind, card.id), { now: true });
      return { ...base, status: 'made', undo: { what: 'note', kind, id: card.id, before: card, after: null }, before: card.about || '', after: '' };
    }
    /* a card given a new name: the old one stays among the others it goes by */
    const newName = archivist.cleanName(op.newName !== undefined ? op.newName : op.rename_to);
    if (newName && !card) return refuse(`there is no ${name} in the notes to rename`);
    const next = card ? clone(card) : newCard(kind, { name });
    if (newName && card && nameKey(newName) !== nameKey(card.name)) {
      if (list.some((c) => c.id !== card.id && (nameKey(c.name) === nameKey(newName) || (c.aka || []).some((a) => nameKey(a) === nameKey(newName))))) return refuse(`another card is called ${newName} already`);
      next.aka = [...(next.aka || []).filter((a) => nameKey(a) !== nameKey(newName)), card.name];
      next.name = newName;
    }
    for (const key of ['about', 'now', 'ties']) {
      if (key !== 'about' && kind !== 'people') continue;
      const words = writes(key) ? archivist.cleanText(op[key]) : '';
      if (words) next[key] = words;
    }
    /* a "now" it writes is as of the end of the book so far */
    if (kind === 'people' && next.now !== (card ? card.now : undefined) && String(next.now || '').trim() && (novel.order || []).length) { next.nowAt = novel.order[novel.order.length - 1]; delete next.nowPid; }
    /* "aka" adds names it goes by; "dropAka" takes them off */
    const names = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : String(v).split(',')).map(archivist.cleanName).filter(Boolean);
    const more = names(op.aka);
    const less = names(op.dropAka).map(nameKey);
    if (more.length || less.length) {
      const all = [...(next.aka || []), ...more].filter((a) => !less.includes(nameKey(a)));
      next.aka = all.filter((a, i) => all.findIndex((b) => nameKey(b) === nameKey(a)) === i && nameKey(a) !== nameKey(next.name));
    }
    if (kind === 'threads' && openOf(op) !== undefined) next.open = openOf(op);
    /* its words never carry the notes' own lines (With others:, Right now:) — they go where they belong (shape.js cleanCard) */
    { const cl = cleanCard(next, kind); if (cl) Object.assign(next, cl); }
    /* what this change wrote, field by field */
    const fields = CARD_FIELDS.filter((k) => !card ? (k === 'name' || (next[k] !== undefined && JSON.stringify(next[k]) !== JSON.stringify(newCard(kind)[k]))) : JSON.stringify(card[k]) !== JSON.stringify(next[k]));
    if (card && !fields.length) return refuse('the card already says that');
    if (!card && !['about', 'now', 'ties'].some((k) => String(next[k] || '').trim())) return refuse('it gave nothing to write on a new card');
    /* changed for him, as if by his own hand — in the fields it wrote: the
     * helper keeps his words there, and writes the rest as the book goes on */
    next.updated = hisStamp(card, fields, at);
    put('novel', novelId, novelSteps.editNote(kind, next, fields, { create: !card }), { now: true });
    /* its Undo puts back only what it wrote (the helper moves where they are now on his cards meanwhile: M74/M83-2) */
    return { ...base, status: 'made', undo: { what: 'note', kind, id: next.id, before: card, after: clone(next), fields: [...fields, 'updated'] }, before: card ? (card.about || '') : '', after: next.about || '' };
  }
  return refuse('it did not say what to change');
}

/* ------------------------------------------------------------ before it waits */

/* Would this change land? A change set to wait for Apply is looked at as it
 * arrives (Cozy Tavern checks a card's anchor when it is staged): one whose
 * place or words cannot be found is said so at once, while the partner can
 * still put it right. '' when nothing stands in its way that can be seen now. */
export function whyNot(novelId, op, { seen = null, where = null, numbers = null } = {}) {
  const novel = store.peek('novel', novelId);
  if (!novel || !op || typeof op !== 'object') return 'the book is not open';
  /* every kind looked at exactly as it would be made (M397/M83-4) */
  const r = makeChange(novelId, op, { dry: true, seen, where, numbers });
  return r.status === 'refused' ? (r.said || 'it could not be made') : '';
}

/* ------------------------------------------------------------ undoing one */

/* Put one change back. {ok} or {ok: false, said}. */
export function undoChange(novelId, change) {
  const u = change && change.undo;
  if (!u) return { ok: false, said: 'there is nothing to put back' };
  const novel = store.peek('novel', novelId);
  if (!novel) return { ok: false, said: 'the book is not open' };
  if (u.what === 'removed') {
    const c = store.peek('chapter', u.chapterId);
    if (!c) return { ok: false, said: 'that chapter is not there any more' };
    if ((c.passages || []).some((p) => p.id === u.passage.id)) return { ok: false, said: 'the passage is back already' };
    store.change('chapter', u.chapterId, chapterSteps.addPassage(u.passage, u.after), { now: true });
    /* back in its place: nothing of it is taken out any more (its notes come back as the page's Undo brings them) */
    store.change('chapter', u.chapterId, chapterSteps.clearRetired([u.passage.id]), { now: true });
    return { ok: true };
  }
  if (u.what === 'many') {
    /* each place put back that still reads as the change left it; one changed since stays */
    let back = 0;
    let kept = 0;
    const putBack = new Set();
    /* a name changed everywhere goes back as it was read only when the notes'
     * cards go back with it: a card changed since keeps the new name, and the
     * passages put back are then read again as changes */
    const notesBack = (u.cards || []).every((x) => JSON.stringify(((store.peek('novel', novelId).notes || {})[x.kind] || []).find((c) => c.id === x.id) || null) === JSON.stringify(x.after));
    const asRead = (pid) => notesBack && (u.seen || []).some((y) => y.pid === pid);
    for (const x of u.passages || []) {
      const c = store.peek('chapter', x.chapterId);
      const p = c && (c.passages || []).find((y) => y.id === x.passageId);
      /* changed on the page itself (2.12.2): its words before put back, where it still reads as the change left it */
      if (x.inPlace) {
        const got = putBackWords({ novelId, chapterId: x.chapterId, passageId: x.passageId, versionId: x.versionId, expect: x.after, before: x.before, retire: !asRead(x.passageId), hold: false });
        if (!got.ok) { kept++; continue; }
        putBack.add(x.passageId);
        back++;
        continue;
      }
      const shown = p && picked(p);
      if (!shown || shown.id !== x.versionId || !p.versions.some((v) => v.id === x.from)) { kept++; continue; }
      putBack.add(x.passageId);
      /* read by the helper since: its words are kept for it, so what came only from them goes too —
       * unless it was only read as renamed, and is read as it was again below */
      if (!asRead(x.passageId)) archivist.retireIfSeen(novelId, x.chapterId, x.passageId, x.versionId);
      store.change('chapter', x.chapterId, chapterSteps.pick(x.passageId, x.from), { now: true });
      store.change('chapter', x.chapterId, chapterSteps.removeVersion(x.passageId, x.versionId), { now: true });
      back++;
    }
    for (const x of u.chapters || []) {
      const c = store.peek('chapter', x.chapterId);
      if (!c || (c.name || '') !== x.after) { kept++; continue; }
      store.change('chapter', x.chapterId, chapterSteps.setName(x.before.name, x.before.nameBy), { now: true });
      back++;
    }
    for (const x of u.cards || []) {
      const cur = ((store.peek('novel', novelId).notes || {})[x.kind] || []).find((c) => c.id === x.id) || null;
      if (JSON.stringify(cur) !== JSON.stringify(x.after)) { kept++; continue; }
      store.change('novel', novelId, novelSteps.undoCards([{ kind: x.kind, id: x.id, before: x.before, after: x.after }]), { now: true });
      back++;
    }
    for (const x of u.book || []) {
      const live = store.peek('novel', novelId);
      const cur = String((x.meta ? live.meta[x.field] : live[x.field]) || '');
      if (cur !== x.after) { kept++; continue; }
      store.change('novel', novelId, x.meta ? novelSteps.setMeta({ [x.field]: x.before }) : novelSteps.setField(x.field, x.before), { now: true });
      back++;
    }
    for (const x of u.kept || []) {
      const live = store.peek('novel', novelId);
      if (JSON.stringify((live.kept || {})[x.key] || null) !== JSON.stringify(x.after)) { kept++; continue; }
      store.change('novel', novelId, novelSteps.setKept(x.key, x.before), { now: true });
      back++;
    }
    /* what was read as renamed is read as it was again; a summary renamed with it goes back too */
    const seenBack = {};
    for (const x of u.seen || []) {
      if (!putBack.has(x.pid) || !asRead(x.pid)) continue;
      const live = store.peek('novel', novelId);
      const map = seenBack[x.chapterId] || (seenBack[x.chapterId] = { ...(((live.memory || {}).seen || {})[x.chapterId] || {}) });
      if (map[x.pid] === x.to) map[x.pid] = x.from;
    }
    for (const [chapterId, map] of Object.entries(seenBack)) store.change('novel', novelId, novelSteps.seen(chapterId, map), { now: true });
    /* and what was set aside as renamed is set aside as it was again, with its mark of read */
    const asideBack = {};
    for (const x of u.aside || []) {
      if (!putBack.has(x.pid) || !asRead(x.pid)) continue;
      const a = (((store.peek('novel', novelId) || {}).memory || {}).aside || {})[x.pid];
      if (a && a.sig === x.to) asideBack[x.pid] = { ...clone(a), sig: x.from };
    }
    if (Object.keys(asideBack).length) store.change('novel', novelId, novelSteps.setAside(asideBack), { now: true });
    /* work on its way since the names changed is given them back as they were */
    if ((u.renamed || []).length && back) store.change('novel', novelId, novelSteps.noteRenames(u.renamed.map((x) => ({ from: x.to, to: x.from })), Date.now()), { now: true });
    for (const x of u.summaries || []) {
      const c = store.peek('chapter', x.chapterId);
      if (!c || JSON.stringify(c.summary || null) !== JSON.stringify(x.after)) continue;
      store.change('chapter', x.chapterId, chapterSteps.setSummary(x.before), { now: true });
    }
    for (const row of u.plays || []) {
      const pl = store.peek('play', row.playId);
      if (!pl) { kept++; continue; }
      let any = false;
      store.change('play', row.playId, (d) => {
        for (const [k, f] of Object.entries(row.fields || {})) if (String(d[k] || '') === String(f.after || '')) { d[k] = f.before; any = true; }
        for (const x of row.versions || []) {
          const t = (d.turns || []).find((y) => y.id === x.turnId);
          const v = t && t.versions.find((y) => y.id === x.versionId);
          if (v && v.text === x.after.text && v.tell === x.after.tell) { v.text = x.before.text; if (x.before.tell === undefined) delete v.tell; else v.tell = x.before.tell; any = true; }
        }
      }, { now: true });
      if (any) back++; else kept++;
    }
    /* his premises and his notes, the chapters' plans and his entries as they were (2.12.41) — each only where it still
     * reads as the change left it */
    for (const x of u.asks || []) {
      if (!store.peek('chapter', x.chapterId)) { kept++; continue; }
      if (store.change('chapter', x.chapterId, askStep(x.passageId, x.versionId, x.field, x.after, x.before), { now: true }) === false) kept++; else back++;
    }
    for (const x of u.plans || []) {
      const c = store.peek('chapter', x.chapterId);
      if (!c || String(c.plan || '') !== x.after) { kept++; continue; }
      store.change('chapter', x.chapterId, chapterSteps.setPlan(x.before), { now: true });
      back++;
    }
    for (const x of u.entries || []) {
      if (store.change('novel', novelId, novelSteps.entryBack(x.id, x.before, x.after), { now: true }) === false) kept++; else back++;
    }
    if (u.entriesPrint) entriesCheckFollows(novelId, u.entriesPrint);
    if (!back) return { ok: false, said: 'everything it changed has been changed again since' };
    return { ok: true, said: kept ? `${back} put back; ${kept} changed since, kept as they are` : '' };
  }
  if (u.what === 'entry') {
    const done = store.change('novel', novelId, novelSteps.entryBack(u.id, u.before, u.after), { now: true });
    /* (one he took out since is said so — 2.12.40, the audit: it was "changed since") */
    const there = entriesOf(store.peek('novel', novelId)).some((e) => e.id === u.id);
    if (done === false) return { ok: false, said: !u.after ? 'the entry is back in the bibliography already' : there ? 'the entry has been changed since' : 'the entry has been taken out since' };
    return { ok: true };
  }
  if (u.what === 'module') {
    const m = listModules(store.peek('house', 'house') || {}).find((x) => x.id === u.id);
    if (!m || String(m.text || '') !== u.after) return { ok: false, said: 'the module has been changed since' };
    store.change('house', 'house', moduleSteps.set(u.id, { text: u.before }), { now: true });
    return { ok: true };
  }
  if (u.what === 'plan') {
    const c = store.peek('chapter', u.chapterId);
    if (!c) return { ok: false, said: 'that chapter is not there any more' };
    if (String(c.plan || '') !== u.after) return { ok: false, said: 'the plan has been changed since' };
    /* a chapter made to hold the plan goes again, while nothing is written in it */
    if (u.made) {
      if ((c.passages || []).some((p) => String((picked(p) || {}).text || '').trim())) return { ok: false, said: 'the chapter made for it has words in it now' };
      const n = store.peek('novel', c.novelId);
      if (n) store.change('novel', n.id, novelSteps.removeChapter(u.chapterId), { now: true });
      return { ok: true };
    }
    store.change('chapter', u.chapterId, chapterSteps.setPlan(u.before), { now: true });
    return { ok: true };
  }
  if (u.what === 'summary') {
    const c = store.peek('chapter', u.chapterId);
    if (!c) return { ok: false, said: 'that chapter is not there any more' };
    if (JSON.stringify(c.summary || null) !== JSON.stringify(u.after)) return { ok: false, said: 'the summary has been written again since' };
    store.change('chapter', u.chapterId, chapterSteps.setSummary(u.before), { now: true });
    /* and the one kept for the chapter as it read goes back to what it was */
    if (u.after && u.after.fp) {
      const kept = (c.summaries || []).find((x) => x.fp === u.after.fp);
      if (kept && JSON.stringify(kept) === JSON.stringify(u.after)) store.change('chapter', u.chapterId, u.keptBefore ? chapterSteps.keepSummary(u.keptBefore) : chapterSteps.dropSummary(u.after.fp), { now: true });
    }
    return { ok: true };
  }
  if (u.what === 'words') {
    const back = putBackWords({ novelId, chapterId: u.chapterId, passageId: u.passageId, versionId: u.versionId, expect: u.after, before: u.before, hold: false });
    return back.ok ? { ok: true } : { ok: false, said: back.said };
  }
  if (u.what === 'passage') {
    const c = store.peek('chapter', u.chapterId);
    const p = c && (c.passages || []).find((x) => x.id === u.passageId);
    if (!p) return { ok: false, said: 'that passage is not there any more' };
    const shown = picked(p);
    if (!shown || shown.id !== u.versionId) return { ok: false, said: 'the passage has changed since — its versions are one arrow away' };
    if (!p.versions.some((v) => v.id === u.from)) return { ok: false, said: 'the words before it are not there any more' };
    store.change('chapter', u.chapterId, chapterSteps.pick(u.passageId, u.from), { now: true });
    store.change('chapter', u.chapterId, chapterSteps.removeVersion(u.passageId, u.versionId), { now: true });
    return { ok: true };
  }
  if (u.what === 'chapter') {
    const c = store.peek('chapter', u.chapterId);
    if (!c) return { ok: false, said: 'that chapter is not there any more' };
    if ((c.name || '') !== u.after) return { ok: false, said: 'the chapter has been named again since' };
    store.change('chapter', u.chapterId, chapterSteps.setName(u.before.name, u.before.nameBy), { now: true });
    return { ok: true };
  }
  if (u.what === 'book') {
    const cur = String((u.meta ? novel.meta[u.field] : novel[u.field]) || '');
    if (cur !== u.after) return { ok: false, said: 'it has been changed again since' };
    store.change('novel', novelId, u.meta ? novelSteps.setMeta({ [u.field]: u.before }) : novelSteps.setField(u.field, u.before), { now: true });
    return { ok: true };
  }
  if (u.what === 'note') {
    const list = (novel.notes && novel.notes[u.kind]) || [];
    const cur = list.find((c) => c.id === u.id) || null;
    /* the fields it wrote, put back where they still read as it left them —
     * what the helper moved meanwhile (where they are now, how they stand) stays */
    if (u.fields && u.before && u.after && cur) {
      const mine = u.fields.filter((k) => k !== 'updated');
      const still = mine.filter((k) => JSON.stringify(cur[k]) === JSON.stringify(u.after[k]));
      if (!still.length) return { ok: false, said: 'the card has been changed since' };
      const back = clone(cur);
      /* where someone is now goes back with when it was as of */
      const withIt = (k) => (k === 'now' ? ['now', 'nowAt', 'nowPid'] : [k]);
      for (const k of still.flatMap(withIt)) { if (u.before[k] === undefined) delete back[k]; else back[k] = clone(u.before[k]); }
      if (still.length === mine.length) back.updated = clone(u.before.updated);
      store.change('novel', novelId, novelSteps.putNote(u.kind, back), { now: true });
      const PART = { name: 'its name', aka: 'the other names', about: 'what it says', ties: 'with others', now: 'right now', open: 'open or closed' };
      return still.length === mine.length ? { ok: true } : { ok: true, said: `${mine.filter((k) => !still.includes(k)).map((k) => PART[k] || k).join(', ')} changed since, kept as ${mine.length - still.length === 1 ? 'it is' : 'they are'}` };
    }
    if (u.after && cur && u.fields && !u.before) {
      /* a card it made: taken out again (what the helper added to it since goes with it) */
      store.change('novel', novelId, novelSteps.dropNote(u.kind, u.id), { now: true });
      return { ok: true };
    }
    if (JSON.stringify(cur) !== JSON.stringify(u.after)) return { ok: false, said: u.after ? 'the card has been changed since' : 'the card is back in the notes already' };
    store.change('novel', novelId, novelSteps.undoCards([{ kind: u.kind, id: u.id, before: u.before, after: u.after }]), { now: true });
    return { ok: true };
  }
  return { ok: false, said: 'there is nothing to put back' };
}

/* ------------------------------------------------------------ waiting ones */

/* what a change writes, as one key — the same passage, card, part of the
 * book, summary, chapter name or module — or '' for one across the book */
export function targetOf(op, where = null) {
  const o = op || {};
  if (o.unreadable || o.rename || o.replace_all !== undefined) return '';
  if (o.passage !== undefined) return where && where.passageId ? `p#${where.passageId}` : `p:${String(o.passage).trim()}`;
  if (o.note !== undefined) return `n:${o.note}:${nameKey(archivist.cleanName(o.name) || o.name)}`;
  if (o.entry !== undefined) return `e:${nameKey(archivist.cleanName(o.entry) || o.entry)}`;
  if (o.module !== undefined) return `m:${nameKey(o.module)}`;
  if (o.summary !== undefined) return where && where.chapterId ? `s#${where.chapterId}` : `s:${chapterNumber(o.summary) || 0}`;
  if (o.plan !== undefined) return where && where.chapterId ? `pl#${where.chapterId}` : `pl:${chapterNumber(o.plan) || 0}`;
  if (o.book !== undefined) return `b:${o.book}`;
  if (o.chapter !== undefined) return where && where.chapterId ? `c#${where.chapterId}` : `c:${chapterNumber(o.chapter) || 0}`;
  return '';
}
/* the parts of a card a card change writes — only those it gives words for
 * (the rest of the card is not its to watch) — or null for a change that
 * writes its thing whole */
export function fieldsOf(op) {
  const o = op || {};
  if (o.entry !== undefined) return entryFieldsOf(o, { clash: true });
  if (o.note === undefined || truthOf(o.remove) === true) return null;
  const out = ['about', 'now', 'ties'].filter((k) => o[k] !== undefined && archivist.cleanText(o[k]));
  if (archivist.cleanName(o.newName !== undefined ? o.newName : o.rename_to)) out.push('name');
  if (o.aka !== undefined || o.dropAka !== undefined) out.push('aka');
  if (openOf(o) !== undefined) out.push('open');
  return out;
}
/* the parts of an entry a change to it writes: its name, other names, kind,
 * when it rides, its line, its words whole (null: the entry taken out,
 * whole). A paragraph it only adds is watched for nothing — it goes on
 * whatever stands — but `clash`: a newer answer's words for the entry, a
 * paragraph or the whole of them, set aside an older one's still waiting
 * (M397), as the book's own words do. */
function entryFieldsOf(o, { clash = false } = {}) {
  if (truthOf(o.remove) === true) return null;
  const out = [];
  if (archivist.cleanName(o.newName !== undefined ? o.newName : o.rename_to)) out.push('name', 'aka');
  if ((o.aka !== undefined || o.dropAka !== undefined) && !out.includes('aka')) out.push('aka');
  for (const k of ['kind', 'rides', 'line', 'text']) if (o[k] !== undefined) out.push(k);
  if (clash && o.add !== undefined && !out.includes('text')) out.push('text');
  return out;
}
/* the thing a change renames comes to be called this (an entry or a card given a new name): '' when it renames nothing */
export function renamedTarget(op) {
  const o = op || {};
  const to = archivist.cleanName(o.newName !== undefined ? o.newName : o.rename_to);
  if (!to) return '';
  if (o.entry !== undefined) return `e:${nameKey(to)}`;
  if (o.note !== undefined) return `n:${o.note}:${nameKey(to)}`;
  return '';
}
/* how an entry stood for a change to it: the parts it writes ("f:"), the whole entry it takes out ("w:"), or none there */
function entryBase(op, entry) {
  if (!entry) return 'none';
  const fields = entryFieldsOf(op);
  return fields ? `f:${hashText(JSON.stringify(fields.map((k) => (entry[k] === undefined ? null : entry[k]))))}`
    : `w:${hashText(JSON.stringify({ ...entry, at: null, by: null }))}`;
}
function cardBase(op, card) {
  if (!card) return 'none';
  const fields = fieldsOf(op);
  return fields ? `f:${hashText(JSON.stringify(fields.map((k) => (card[k] === undefined ? null : card[k]))))}`
    : `w:${hashText(JSON.stringify({ ...card, updated: null }))}`;
}
function moduleNamed(rows, name) {
  const want = nameKey(name);
  const exact = rows.find((m) => nameKey(m.name) === want || m.id === String(name));
  if (exact) return exact;
  const starts = rows.filter((m) => nameKey(m.name).startsWith(want));
  return starts.length === 1 ? starts[0] : null;
}
/* Follow makeChange's routing: extra fields a model supplied must not turn
 * a whole edit into a quote or addition that the applying branch ignores. */
function scopeOf(op) {
  return ['module', 'summary', 'plan', 'passage', 'chapter', 'book', 'note', 'entry'].find((key) => op[key] !== undefined);
}
function quotedChange(op, scope = scopeOf(op)) {
  return op.find !== undefined && (['module', 'summary', 'book'].includes(scope)
    || (scope === 'passage' && truthOf(op.remove) !== true));
}

/* What the partner was shown when this round began. Keep only fingerprints
 * of long pages and instructions; cards keep their fields so a change to
 * who someone is can still land while the helper updates where they are. */
export function snapshotForChanges(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel) return null;
  const snapshot = { book: {}, chapters: {}, passages: {}, notes: clone(novel.notes || {}), entries: clone(entriesOf(novel)),
    modules: listModules(store.peek('house', 'house') || {}).map((m) => ({ id: m.id, name: m.name, base: hashText(String(m.text || '')) })) };
  for (const book of Object.keys(BOOK_FIELDS)) snapshot.book[book] = baseOf(novelId, { book });
  for (const chapterId of novel.order || []) {
    const chapter = store.peek('chapter', chapterId);
    if (!chapter) continue;
    snapshot.chapters[chapterId] = { name: hashText(String(chapter.name || '')), summary: hashText(String((chapter.summary && chapter.summary.text) || '')), plan: hashText(String(chapter.plan || '')) };
    for (const passage of chapter.passages || []) {
      const v = picked(passage);
      if (v) snapshot.passages[passage.id] = `${v.id}:${hashText(String(v.text || ''))}`;
    }
  }
  return snapshot;
}

/* Whole replacements must still answer the words they were asked about.
 * Exact quoted replacements and additions find their own place as before.
 * Compare all operations before applying a round: its own first change must
 * not make its second one look like somebody changed the book meanwhile. */
export function changedSinceSnapshot(novelId, op, snapshot, { where = null, numbers = null } = {}) {
  const o = op || {};
  const scope = scopeOf(o);
  if (!snapshot || quotedChange(o, scope) || (scope === 'book' && o.add !== undefined)
    || (o.rename && typeof o.rename === 'object') || o.replace_all !== undefined || o.unreadable) return '';
  const novel = store.peek('novel', novelId);
  if (!novel) return '';
  const changed = 'it changed while this reply was on the way — ask again for this one';
  let before;
  let now;
  if (scope === 'passage') {
    const spot = passageAt(novel, o.passage, { where, numbers });
    const id = (where && where.passageId) || (spot.passage && spot.passage.id);
    before = id && snapshot.passages[id];
    now = baseOf(novelId, { passage: o.passage }, where);
  } else if (scope === 'summary' || scope === 'chapter' || scope === 'plan') {
    const spot = chapterAt(novel, o[scope], { where, numbers });
    const id = (where && where.chapterId) || spot.chapterId;
    const row = id && snapshot.chapters[id];
    before = row && row[scope === 'summary' ? 'summary' : scope === 'plan' ? 'plan' : 'name'];
    now = baseOf(novelId, { [scope]: o[scope] }, where);
  } else if (scope === 'book') {
    before = snapshot.book[o.book];
    now = baseOf(novelId, { book: o.book }, where);
  } else if (scope === 'module') {
    const old = moduleNamed(snapshot.modules, o.module);
    const current = moduleNamed(listModules(store.peek('house', 'house') || {}), o.module);
    if (old && (!current || old.id !== current.id)) return changed;
    before = old && old.base;
    now = current && hashText(String(current.text || ''));
  } else if (scope === 'note' && NOTE_KINDS.includes(o.note)) {
    const name = archivist.cleanName(o.name) || text(o.name);
    const old = matchCard(snapshot.notes[o.note] || [], name, [], { kind: o.note, near: false }).card;
    const current = matchCard((novel.notes || {})[o.note] || [], name, [], { kind: o.note, near: false }).card;
    if ((old && old.id) !== (current && current.id)) return changed;
    before = cardBase(o, old);
    now = cardBase(o, current);
  } else if (scope === 'entry') {
    const name = archivist.cleanName(o.entry) || text(o.entry);
    const old = entryFor(snapshot.entries || [], name, kindAsked(o)).entry;
    const current = entryFor(entriesOf(novel), name, kindAsked(o)).entry;
    if ((old && old.id) !== (current && current.id)) return changed;
    before = entryBase(o, old);
    now = entryBase(o, current);
  }
  return before !== undefined && before !== now ? changed : '';
}
/* how what it writes stood when it was offered: a print of it — for a card,
 * of the parts it writes ("f:"), or the whole card it takes out ("w:") */
export function baseOf(novelId, op, where = null) {
  const novel = store.peek('novel', novelId);
  const o = op || {};
  if (!novel) return '';
  try {
    if (o.passage !== undefined) { const w = passageAt(novel, o.passage, { where }); const v = w.passage && picked(w.passage); return v ? `${v.id}:${hashText(String(v.text || ''))}` : ''; }
    if (o.note !== undefined) {
      const m = matchCard((novel.notes || {})[o.note] || [], archivist.cleanName(o.name) || text(o.name), [], { kind: o.note, near: false });
      return cardBase(o, m.card);
    }
    if (o.book !== undefined) { const f = BOOK_FIELDS[o.book]; return f ? hashText(String(((f === 'title' || f === 'subtitle') ? novel.meta[f] : novel[f]) || '')) : ''; }
    if (o.summary !== undefined) { const c = chapterAt(novel, o.summary, { where }).chapter; return c ? hashText(String((c.summary && c.summary.text) || '')) : ''; }
    if (o.plan !== undefined) { const c = chapterAt(novel, o.plan, { where }).chapter; return c ? hashText(String(c.plan || '')) : ''; }
    if (o.chapter !== undefined) { const c = chapterAt(novel, o.chapter, { where }).chapter; return c ? hashText(String(c.name || '')) : ''; }
    if (o.module !== undefined) { const m = moduleNamed(listModules(store.peek('house', 'house') || {}), o.module); return m ? hashText(String(m.text || '')) : ''; }
    if (o.entry !== undefined) return entryBase(o, entryFor(entriesOf(novel), archivist.cleanName(o.entry) || text(o.entry), kindAsked(o)).entry);
  } catch (_) { /* nothing to print */ }
  return '';
}
/* a card change kept before cards were watched part by part: the whole card's print */
function wholeCardBase(novelId, op) {
  const novel = store.peek('novel', novelId);
  const m = novel && matchCard((novel.notes || {})[op.note] || [], text(op.name), [], { kind: op.note, near: false });
  return m && m.card ? hashText(JSON.stringify({ ...m.card, updated: null })) : 'none';
}
/* A waiting change whose thing was changed since it was offered, and which
 * writes it whole (a passage anew or taken out, a card's words, a summary, a
 * module, the book's words): said, never written over what is there now
 * (Cozy Tavern's M422). One that finds its words in place is looked for as it
 * is applied. A card change is watched only in the parts it writes — the
 * helper moving where someone is now never stops a change to who they are
 * (Cozy Tavern's M602). */
export function driftOf(novelId, change) {
  const c = change || {};
  if (!c.base || !c.op || quotedChange(c.op) || c.op.rewrite !== undefined) return '';
  const legacy = c.op.note !== undefined && c.base !== 'none' && !/^[fw]:/.test(c.base);
  const now = legacy ? wholeCardBase(novelId, c.op) : baseOf(novelId, c.op, c.where || null);
  return now && now !== c.base ? 'it has changed since this was offered — ask again for this one' : '';
}

/* the words a change writes over, as they stand now — for a change still
 * waiting, so its row shows what it would replace (Cozy Tavern's M76-2) */
export function wordsNow(novelId, change) {
  const c = change || {};
  const o = c.op || {};
  const novel = store.peek('novel', novelId);
  if (!novel || o.find !== undefined) return '';
  try {
    if (o.book !== undefined && o.add === undefined) { const f = BOOK_FIELDS[o.book]; return f ? String(((f === 'title' || f === 'subtitle') ? novel.meta[f] : novel[f]) || '') : ''; }
    if (o.summary !== undefined) { const x = chapterAt(novel, o.summary, { where: c.where || null }).chapter; return x ? String((x.summary && x.summary.text) || '') : ''; }
    if (o.plan !== undefined) { const x = chapterAt(novel, o.plan, { where: c.where || null }).chapter; return x ? String(x.plan || '') : ''; }
    if (o.chapter !== undefined && o.passage === undefined) { const x = chapterAt(novel, o.chapter, { where: c.where || null }).chapter; return x ? String(x.name || '') : ''; }
    if (o.note !== undefined && o.about !== undefined) { const m = matchCard((novel.notes || {})[o.note] || [], archivist.cleanName(o.name), [], { kind: o.note, near: false }); return m.card ? String(m.card.about || '') : ''; }
    if (o.entry !== undefined && o.text !== undefined) { const e = entryFor(entriesOf(novel), archivist.cleanName(o.entry), kindAsked(o)).entry; return e ? String(e.text || '') : ''; }
  } catch (_) { /* nothing to show */ }
  return '';
}

/* the words a change wrote, in short (his report, 2.12.2: "Chapter One, passage 2 — made" five times could not tell it
 * which of its fixes had landed) */
const clipQ = (t, n = 60) => { const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
export function changeShort(c) {
  const o = (c && c.op) || {};
  if (o.find !== undefined && !(o.rename && typeof o.rename === 'object')) {
    const to = o.replace !== undefined ? o.replace : o.text;
    return ` (“${clipQ(o.find)}” → ${String(to == null ? '' : to).trim() ? `“${clipQ(to)}”` : 'taken out'})`;
  }
  if (o.passage !== undefined && o.remove !== undefined) return ' (taken out)';
  if (o.passage !== undefined && o.rewrite !== undefined) return ` (written again by the writer from your note: “${clipQ(o.rewrite)}”)`;
  if (o.passage !== undefined && o.text !== undefined) return ' (written anew)';
  return '';
}
/* a change made that the page no longer shows: he put back the words before it, or another version is on show (his
 * report, 2.12.2: the partner must know what the book holds now) — '' when it stands */
export function madeGone(novelId, c) {
  const u = c && c.status === 'made' && c.undo;
  if (!u || (u.what !== 'words' && u.what !== 'passage')) return '';
  const ch = store.peek('chapter', u.chapterId);
  const p = ch && (ch.passages || []).find((x) => x.id === u.passageId);
  if (!p) return 'the passage has been taken out since';
  const v = picked(p);
  if (!v || v.id !== u.versionId) return 'another version of the passage is on show now';
  const o = c.op || {};
  const to = o.replace !== undefined ? o.replace : o.text;
  if (u.what !== 'words') return '';
  /* put back, or written over since (his edit, a fix of the checker's): said as it happened */
  const now = String(v.text || '');
  const back = u.before !== undefined && u.before !== u.after && now === String(u.before);
  if (back) return 'the page no longer reads that way — the words before it were put back';
  if (String(to || '').trim() && !now.includes(String(to).trim())) {
    /* who wrote over them, and what the page says there now — never only "changed since" (his report, 18 October: told
     * that much and no more, the partner could not see the page, said its own line was gone, then that it was there) */
    const who = writtenOverBy(v, u);
    const there = readsNow(String(u.after || ''), now);
    return `the page no longer reads that way — ${who ? `${who} since` : 'those words were changed since'}${there ? `; it reads there now: “${there}”` : ''}`;
  }
  return '';
}
/* who changed a passage's words after a change of the partner's: each change kept on the version (shape.js
 * inPlaceFields) holds the words it changed and who changed them — the first after the partner's holds the words the
 * partner left */
const OVER_BY = { checkerAuto: 'the checker’s fixes went in on them by themselves', checker: 'I put in a fix of the checker’s on them', you: 'I changed them myself', partner: 'a later change of yours went in on them' };
function writtenOverBy(v, u) {
  const list = Array.isArray(v && v.before) ? v.before : [];
  let k = -1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].text === u.after) { k = i; break; }
  if (k < 0) return '';
  const who = [...new Set(list.slice(k).map((e) => (e && e.by === 'checker' ? (e.auto ? 'checkerAuto' : 'checker') : e && e.by)).filter((b) => OVER_BY[b]))];
  return who.map((b) => OVER_BY[b]).join(', and ');
}
/* the sentences of the page where it no longer reads as the change left it — 400 characters at most */
function readsNow(after, now) {
  let a = 0;
  while (a < after.length && a < now.length && after[a] === now[a]) a++;
  let b = 0;
  while (b < after.length - a && b < now.length - a && after[after.length - 1 - b] === now[now.length - 1 - b]) b++;
  let s = a;
  while (s > 0 && now[s - 1] !== '\n' && !(/[.!?…]/.test(now[s - 2] || '') && /\s/.test(now[s - 1]))) s--;
  let e = Math.max(s, now.length - b);
  while (e < now.length && now[e] !== '\n' && !/[.!?…]/.test(now[e])) e++;
  while (e < now.length && /[.!?…"”’)\]]/.test(now[e])) e++;
  const seg = now.slice(s, e).replace(/\s+/g, ' ').trim();
  return seg.length > 400 ? `${seg.slice(0, 400).replace(/\s+\S*$/, '')} …` : seg;
}
/* what came of its changes, in his words, for the partner to read next time */
export function outcomeWords(changes, novelId = null) {
  const bits = (changes || []).filter((c) => !c.superseded).map((c) => {
    const what = `${c.label}${changeShort(c)}`;
    /* made with his own words in place of the ones it gave (Edit by hand): said, so it never takes its words as the ones that stand (Cozy Tavern M736) */
    if (c.status === 'made' && c.edited) { const gone = novelId ? madeGone(novelId, c) : ''; return gone ? `${c.label} — made, in my own words instead of yours, but ${gone}` : `${c.label} — made, in my own words instead of yours (the book as it reads now has them)`; }
    if (c.status === 'made') { const gone = novelId ? madeGone(novelId, c) : ''; return `${what} — made${c.said && c.op && c.op.passage !== undefined ? ` (${c.said})` : ''}${gone ? `, but ${gone}` : ''}`; }
    if (c.status === 'undone') return `${what} — I undid it`;
    if (c.status === 'writing') return `${what} — the writer is writing it now`;
    if (c.status === 'waiting') return `${what} — waiting for me to apply it`;
    if (c.status === 'skipped') return `${what} — ${c.aside ? 'set aside for a newer answer’s change to the same' : 'I left it'}`;
    return `${what} — couldn’t be made (${c.said || 'no reason given'})`;
  });
  return bits.length ? `(Of your changes: ${bits.join('; ')}.)` : '';
}
/* where a change stands now, as it was last told to the partner (toldAs): its status, or 'gone' for one made the page
 * no longer shows */
export function statusNow(novelId, c) { return c.status === 'made' && madeGone(novelId, c) ? 'gone' : c.status; }
/* what changed of its changes since it was last told, in his words */
export function sinceWords(novelId, c) {
  const what = `${c.label}${changeShort(c)}`;
  const now = statusNow(novelId, c);
  /* applied in his own words (Edit by hand): said as his, as outcomeWords says it (Cozy Tavern M736) */
  if (now === 'made' && c.edited) return `${what} — I applied it in my own words instead of yours: the book has them now`;
  if (now === 'made') return `${what} — I applied it: the book has it now`;
  if (now === 'gone') return `${what} — made, but ${madeGone(novelId, c)}`;
  if (now === 'undone') return `${what} — I undid it: the book no longer has it`;
  if (now === 'writing') return `${what} — the writer is still writing it`;
  if (now === 'waiting') return `${what} — still waiting for me to apply it`;
  if (now === 'skipped') return `${what} — I left it`;
  return `${what} — couldn’t be made (${c.said || 'no reason given'})`;
}
