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
import { numberWords } from '../util.js';

const QUOTES = { '’': "'", '‘': "'", 'ʼ': "'", '“': '"', '”': '"', '„': '"', '«': '"', '»': '"' };
const SPACE = new Set([9, 10, 11, 12, 13, 32, 160, 0x2028, 0x2029]);

/* a text as it is matched, with where each of its letters came from —
 * kept for each text once, so typing in the box stays instant */
const folded = new Map();
export function fold(text) {
  const s = String(text || '');
  const seen = folded.get(s);
  if (seen) return seen;
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (SPACE.has(code) || (code > 127 && /\s/.test(s[i]))) {
      if (!space && out) { out += ' '; map.push(i); }
      space = true;
      continue;
    }
    space = false;
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
  if (folded.size > 4000) folded.clear();
  folded.set(s, done);
  return done;
}

/* where the words stand in a text: [{start, end}] in its own letters */
export function findIn(text, query, { max = 200 } = {}) {
  const q = fold(query).s.trim();
  if (!q) return [];
  const src = String(text || '');
  const T = fold(src);
  const out = [];
  for (let at = T.s.indexOf(q); at >= 0 && out.length < max; at = T.s.indexOf(q, at + q.length)) {
    const start = T.map[at];
    const last = T.map[at + q.length - 1];
    const c = src.charCodeAt(last);
    out.push({ start, end: last + (c >= 0xd800 && c <= 0xdbff ? 2 : 1) });
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
export function searchBook({ novel, chapters = {}, talk = null, plays = [], query, limit = 300 }) {
  const out = [];
  if (!novel || !fold(query).s.trim()) return out;
  const add = (base, text) => {
    for (const hit of findIn(text, query)) {
      if (out.length >= limit) return;
      out.push({ ...base, novelId: novel.id, text, start: hit.start, end: hit.end, snippet: snippet(text, hit.start, hit.end) });
    }
  };
  for (const id of novel.order || []) {
    const c = chapters[id];
    if (!c) continue;
    const num = chapterNumber(novel, id);
    const chapter = `Chapter ${numberWords(num)}`;
    if (c.name) add({ where: 'chapter', label: `${chapter}’s name`, group: chapter, chapterId: id }, c.name);
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const v = picked(p);
      if (v && v.text) add({ where: 'passage', label: `Passage ${nums.get(p.id)}`, group: `${chapter}${c.name ? ` — ${c.name}` : ''}`, chapterId: id, passageId: p.id }, v.text);
    }
  }
  const notes = novel.notes || {};
  for (const kind of NOTE_KINDS) {
    for (const card of notes[kind] || []) {
      const label = `${card.name || 'A card'}`;
      const base = { where: 'note', label, group: `Notes — ${KIND_WORD[kind]}`, kind, cardId: card.id };
      add(base, card.name || '');
      for (const a of card.aka || []) add(base, a);
      for (const f of ['about', 'ties', 'now']) if (card[f]) add(base, card[f]);
    }
  }
  for (const [field, words] of BOOK_WORDS) if (novel[field]) add({ where: 'book', label: words, group: 'About this book', field }, novel[field]);
  /* the words a turn shows: the partner's without its blocks, the narrator's without its offers */
  /* every conversation with the partner: the open one, and the others (a tap opens that one) */
  const talks = talk ? [{ convId: null, name: '', turns: talk.turns || [] }, ...(talk.convs || []).map((c) => ({ convId: c.id, name: c.name || '', turns: c.turns || [] }))] : [];
  for (const c of talks) {
    for (const t of c.turns) {
      const v = picked(t);
      const shown = v && (t.by === 'you' ? v.text : wordsOf(v.text));
      if (shown) add({ where: 'talk', label: t.by === 'you' ? 'You' : 'Your partner', group: c.convId ? `Partner — ${c.name}` : 'Partner', turnId: t.id, ...(c.convId ? { convId: c.convId } : {}) }, shown);
    }
  }
  for (const p of plays || []) {
    for (const t of p.turns || []) {
      const v = picked(t);
      const who = p.who || 'Someone';
      const shown = v && (t.by === 'you' ? v.text : sceneWords(v.text));
      if (shown) add({ where: 'play', label: t.by === 'you' ? who : 'The narrator', group: `Scene — you play ${who}`, playId: p.id, turnId: t.id }, shown);
      if (v && v.tell) add({ where: 'play', label: 'To the narrator', group: `Scene — you play ${who}`, playId: p.id, turnId: t.id }, v.tell);
    }
  }
  return out;
}
