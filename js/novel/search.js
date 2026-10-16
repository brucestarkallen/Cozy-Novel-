/* Cozy Novel — js/novel/search.js — FINDING WORDS ANYWHERE IN A BOOK.
 *
 * Pure: handed a book's records, it gives back every place the words stand —
 * the passages (the version on the page), chapter names, the notes, what the
 * book is about, the conversation with the partner and the scenes — each with
 * a few words either side. Letters match however they are written: capitals
 * or not, with marks or without (é is e), curly quotes as straight, and any
 * run of spaces or line breaks as one space. */

import { picked, passageNumbers, chapterNumber, NOTE_KINDS } from './shape.js';
import { wordsOf } from './changes.js';
import { sceneWords } from './prompts.js';
import { numberWords, plural } from '../util.js';

const QUOTES = { '’': "'", '‘': "'", 'ʼ': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"' };
const SPACE = new Set([9, 10, 11, 12, 13, 32, 160, 0x2028, 0x2029]);
/* marks that are no words on the page (Cozy Tavern M752-009): emphasis drawn
 * as italics or bold, and characters nobody sees — a zero-width space, a soft
 * hyphen, a joiner */
const UNSEEN = new Set([42, 95, 0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const DASHES = new Set(['-', '—', '–', '‐', '‑', '‒', '―', '−']);
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;
/* These scripts commonly put separate words beside one another without
 * spaces. Requiring spaces would reject real quotations from their prose. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const joinedWord = (a, b) => WORD_CHAR.test(a) && WORD_CHAR.test(b) && !UNSPACED.test(a) && !UNSPACED.test(b);

/* a text as it is matched, with where each of its letters came from —
 * kept for each text once, so typing in the box stays instant */
const folded = new Map();
const FOLD_BUDGET = 16 * 1024 * 1024;
let foldedBytes = 0;
export function fold(text) {
  const s = String(text || '');
  const seen = folded.get(s);
  if (seen) { folded.delete(s); folded.set(s, seen); return seen.value; }
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (UNSEEN.has(code)) continue;
    if (SPACE.has(code) || (code > 127 && /\s/.test(s[i]))) {
      /* the space beside a dash is the dash's: "door — she" is "door—she" */
      if (!space && out && out[out.length - 1] !== '-') { out += ' '; map.push(i); }
      space = true;
      continue;
    }
    space = false;
    /* any dash, and a run of them ("--"), is one; an ellipsis is its dots, and a run of dots one */
    if (DASHES.has(s[i]) || s[i] === '…' || s[i] === '.') {
      const ch = s[i] === '…' ? '.' : s[i] === '.' ? '.' : '-';
      if (ch === '-' && out[out.length - 1] === ' ') { out = out.slice(0, -1); map.pop(); }
      if (out[out.length - 1] !== ch) { out += ch; map.push(i); }
      continue;
    }
    if (code < 128) {
      out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s[i];
      map.push(i);
      continue;
    }
    /* a letter outside plain ASCII: one whole character (two halves, past the basic plane) */
    const wide = code >= 0xd800 && code <= 0xdbff && i + 1 < s.length;
    const ch = wide ? s.slice(i, i + 2) : s[i];
    const f = QUOTES[ch] || ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (let k = 0; k < f.length; k++) { out += f[k]; map.push(i); }
    if (wide) i++;
  }
  map.push(s.length);
  const done = { s: out, map };
  /* Index arrays cost much more than prose. A count-only cache could retain
   * thousands of enormous passages, then discard everything at once. Keep
   * a bounded working set and let the oldest entries go individually. */
  const bytes = (s.length + out.length) * 2 + map.length * 8 + 128;
  if (bytes <= FOLD_BUDGET) {
    while (folded.size && (foldedBytes + bytes > FOLD_BUDGET || folded.size >= 4000)) {
      const key = folded.keys().next().value;
      foldedBytes -= folded.get(key).bytes; folded.delete(key);
    }
    folded.set(s, { value: done, bytes }); foldedBytes += bytes;
  }
  return done;
}

/* the same, with every mark of punctuation let go: the same words in the same
 * order (Cozy Tavern M752-011 — a quote that dropped a comma is still the
 * page's own words) */
function foldWords(text) {
  const f = fold(text);
  let out = '';
  const map = [];
  for (let k = 0; k < f.s.length; k++) {
    const ch = f.s[k];
    if (/[\p{L}\p{N}]/u.test(ch)) { out += ch; map.push(f.map[k]); continue; }
    if (out && out[out.length - 1] !== ' ') { out += ' '; map.push(f.map[k]); }
  }
  map.push(f.map[f.map.length - 1]);
  return { s: out, map };
}

/* where the words stand in a text: [{start, end}] in its own letters
 * (words: punctuation let go; whole: never a different word's prefix or
 * suffix, for reading a quote as evidence without changing ordinary search) */
export function findIn(text, query, { max = 200, words = false, whole = false } = {}) {
  const q = (words ? foldWords(query) : fold(query)).s.trim();
  if (!q) return [];
  const src = String(text || '');
  const T = words ? foldWords(src) : fold(src);
  const out = [];
  /* a place turned away (part of another word) moves on one letter, so a real one overlapping it is still found */
  for (let at = T.s.indexOf(q); at >= 0 && out.length < max; ) {
    if (whole && (joinedWord([...T.s.slice(Math.max(0, at - 2), at)].at(-1) || '', [...q.slice(0, 2)][0]) ||
      joinedWord([...q.slice(-2)].at(-1), [...T.s.slice(at + q.length, at + q.length + 2)][0] || ''))) { at = T.s.indexOf(q, at + 1); continue; }
    const start = T.map[at];
    const last = T.map[at + q.length - 1];
    const c = src.charCodeAt(last);
    out.push({ start, end: last + (c >= 0xd800 && c <= 0xdbff ? 2 : 1) });
    at = T.s.indexOf(q, at + q.length);
  }
  return out;
}

/* a few words either side of what was found, with its markup let go */
export function snippet(text, start, end, around = 70) {
  const s = String(text || '');
  let a = Math.max(0, start - around);
  let b = Math.min(s.length, end + around);
  if (a > 0) { const sp = s.indexOf(' ', a); if (sp >= 0 && sp < start) a = sp + 1; }
  if (b < s.length) { const sp = s.lastIndexOf(' ', b); if (sp > end) b = sp; }
  const clean = (x) => x.replace(/\*+/g, '').replace(/\s+/g, ' ');
  return { before: (a > 0 ? '…' : '') + clean(s.slice(a, start)).replace(/^ /, ''), match: clean(s.slice(start, end)), after: clean(s.slice(end, b)).replace(/ $/, '') + (b < s.length ? '…' : '') };
}

const KIND_WORD = { people: 'People', places: 'Places', lore: 'Things worth remembering', threads: 'Threads' };
const BOOK_WORDS = [['brief', 'What it’s about'], ['style', 'How it reads'], ['plans', 'Where it’s headed']];

/* Every place in one book the words stand, in the book's own order: its
 * chapters (names and passages), then the notes, what it is about, the
 * conversation with the partner, and the scenes. Each place:
 * {where, label, snippet, text, start, end, novelId, chapterId?, passageId?,
 *  kind?, cardId?, field?, playId?, turnId?} */
function* sourcesOf({ novel, chapters = {}, talk = null, plays = [] }) {
  for (const id of novel.order || []) {
    const c = chapters[id];
    if (!c) continue;
    const num = chapterNumber(novel, id);
    const chapter = `Chapter ${numberWords(num)}`;
    if (c.name) yield [{ where: 'chapter', label: `${chapter}’s name`, group: chapter, chapterId: id }, c.name];
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (v && v.text) yield [{ where: 'passage', label: `Passage ${nums.get(p.id)}`, group: `${chapter}${c.name ? ` — ${c.name}` : ''}`, chapterId: id, passageId: p.id }, v.text];
    }
  }
  const notes = novel.notes || {};
  for (const kind of NOTE_KINDS) {
    for (const card of notes[kind] || []) {
      const label = `${card.name || 'A card'}`;
      const base = { where: 'note', label, group: `Notes — ${KIND_WORD[kind]}`, kind, cardId: card.id };
      yield [base, card.name || ''];
      for (const a of card.aka || []) yield [base, a];
      for (const f of ['about', 'ties', 'now']) if (card[f]) yield [base, card[f]];
    }
  }
  /* his entries in the bibliography: their names and words (a tap opens the entry's card) */
  for (const e of Array.isArray(novel.bibliography) ? novel.bibliography : []) {
    if (!e || !e.name) continue;
    const base = { where: 'entry', label: e.name, group: 'Bibliography', entryId: e.id };
    yield [base, e.name];
    for (const a of e.aka || []) yield [base, a];
    for (const f of ['line', 'text']) if (e[f]) yield [base, e[f]];
  }
  for (const [field, words] of BOOK_WORDS) if (novel[field]) yield [{ where: 'book', label: words, group: 'About this book', field }, novel[field]];
  /* the words a turn shows: the partner's without its blocks, the narrator's without its offers */
  /* every conversation with the partner: the open one, and the others (a tap opens that one) */
  const talks = talk ? [{ convId: null, name: '', turns: talk.turns || [] }, ...(talk.convs || []).map((c) => ({ convId: c.id, name: c.name || '', turns: c.turns || [] }))] : [];
  for (const c of talks) {
    for (const t of c.turns) {
      const v = picked(t);
      const shown = v && (t.by === 'you' ? v.text : wordsOf(v.text));
      if (shown) yield [{ where: 'talk', label: t.by === 'you' ? 'You' : 'Your partner', group: c.convId ? `Partner — ${c.name}` : 'Partner', turnId: t.id, ...(c.convId ? { convId: c.convId } : {}) }, shown];
    }
  }
  for (const p of plays || []) {
    for (const t of p.turns || []) {
      const v = picked(t);
      const who = p.who || 'Someone';
      const shown = v && (t.by === 'you' ? v.text : sceneWords(v.text));
      if (shown) yield [{ where: 'play', label: t.by === 'you' ? who : 'The narrator', group: `Scene — you play ${who}`, playId: p.id, turnId: t.id }, shown];
      if (v && v.tell) yield [{ where: 'play', label: 'To the narrator', group: `Scene — you play ${who}`, playId: p.id, turnId: t.id }, v.tell];
    }
  }
}

function collect(out, base, text, novelId, query, limit) {
  for (const hit of findIn(text, query, { max: Math.min(200, limit - out.length) })) {
    out.push({ ...base, novelId, text, start: hit.start, end: hit.end, snippet: snippet(text, hit.start, hit.end) });
  }
}

export function searchBook(options) {
  const { novel, query, limit = 300 } = options;
  const out = [];
  if (!novel || limit <= 0 || !fold(query).s.trim()) return out;
  for (const [base, text] of sourcesOf(options)) {
    collect(out, base, text, novel.id, query, limit);
    if (out.length >= limit) break;
  }
  return out;
}

/* Search is also used synchronously by the partner. The screen gives input
 * and painting their turns between short batches, and a closed sheet or
 * newer query stops before reading the next source. */
export function yieldSearch() {
  return globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
}
export async function searchBookAsync(options, current = () => true) {
  const { novel, query, limit = 300 } = options;
  const out = [];
  if (!current()) return null;
  if (!novel || limit <= 0 || !fold(query).s.trim()) return out;
  let start = performance.now(), count = 0;
  for (const [base, text] of sourcesOf(options)) {
    if (!current()) return null;
    collect(out, base, text, novel.id, query, limit);
    if (out.length >= limit) break;
    if (++count >= 16 || performance.now() - start >= 4) {
      await yieldSearch();
      if (!current()) return null;
      start = performance.now(); count = 0;
    }
  }
  return current() ? out : null;
}

/* The order every book is searched in: this one first, then the shelf's
 * own — the newest written or opened first — and the archived last (Cozy
 * Tavern A8: never the order the phone happens to list them in). */
export function searchOrder(novelId, rows) {
  const when = (r) => Math.max((r.meta && r.meta.written) || 0, (r.meta && r.meta.opened) || 0);
  const others = (rows || []).filter((r) => r && r.id && r.id !== novelId);
  const newest = (list) => list.sort((a, b) => when(b) - when(a)).map((r) => r.id);
  return [novelId, ...newest(others.filter((r) => !(r.meta && r.meta.archived))), ...newest(others.filter((r) => r.meta && r.meta.archived))];
}

/* What a search says it found — and what it could not read, said, never
 * taken for words that are not there (Cozy Tavern A8): the shelf, a book, a
 * chapter the phone did not answer for. `searched`: the books it read. */
export function searchSaid({ q, scope = 'book', total = 0, limit = 400, searched = 1, noShelf = false, unread = 0, lost = 0 }) {
  const all = scope === 'all';
  if (!searched) return `${all ? 'Your books' : 'This book'} could not be read just now — the phone did not answer. Try again in a moment.`;
  const partial = (all && (noShelf || unread)) || lost;
  const said = total ? (total >= limit ? `The first ${limit.toLocaleString()} places — more words find fewer.` : `${plural(total, 'place')}.`)
    : `“${q}” isn’t anywhere ${partial ? 'in what could be read' : all ? 'in your books' : 'in this book'}.`;
  const out = [said];
  if (all && noShelf) out.push('The shelf could not be read just now, so only this book was searched — the phone did not answer.');
  if (all && unread) out.push(`${unread === 1 ? 'One book' : plural(unread, 'book')} could not be read just now, so ${unread === 1 ? 'it was' : 'they were'} not searched — the phone did not answer.`);
  if (lost) out.push(`${lost === 1 ? 'One chapter' : plural(lost, 'chapter')} could not be read just now, so ${lost === 1 ? 'it was' : 'they were'} not searched.`);
  return out.join(' ');
}
