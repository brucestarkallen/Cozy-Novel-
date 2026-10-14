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
import { chapterSteps, novelSteps, newVersion, picked, passageNumbers, newCard, chapterPrint, chapterLabel, NOTE_KINDS } from './shape.js';
import { countWords, nameKey, numberWords, newId, clone } from '../util.js';
import { parseLenient } from './jsonutil.js';
import { CHANGES_OPEN, CHANGES_CLOSE, READ_OPEN, READ_CLOSE, DIRECTION_OPEN, DIRECTION_CLOSE } from './prompts.js';
import { listModules, moduleSteps } from './modules.js';
import * as archivist from './archivist.js';

/* ------------------------------------------------------------ reading it */

const BLOCK = (open, close) => new RegExp(`${open.replace(/[<>/]/g, (c) => `\\${c}`)}([\\s\\S]*?)${close.replace(/[<>/]/g, (c) => `\\${c}`)}`, 'gi');

/* the words of an answer, without its blocks — and, while one is still
 * coming, without the part of it that has come so far */
export function wordsOf(text, { keepDirections = false } = {}) {
  let t = String(text || '');
  t = t.replace(BLOCK(CHANGES_OPEN, CHANGES_CLOSE), '').replace(BLOCK(READ_OPEN, READ_CLOSE), '');
  /* a premise it offered reads as words (its marks out) — kept marked only for the screen */
  if (!keepDirections) t = t.replace(/<\/?direction>/gi, '');
  const open = t.search(/<(changes|read)>/i);
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

/* a changes block still on its way */
export function changesComing(text) { return /<changes>/i.test(String(text || '')) && !/<\/changes>/i.test(String(text || '')); }

/* the chapters it asked to read whole: numbers, at most four */
export function readsOf(text) {
  return readAsks(text).filter((x) => typeof x === 'number').slice(0, 4);
}
/* everything it asked to read (Cozy Tavern's fetch, for a book): a chapter
 * by number (2), the places some words stand ("find: Oda Jovan"), a module's
 * words ("module: The novel craft") — at most eight */
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
          : (() => { const n = parseInt(t.replace(/^\D+/, ''), 10); return Number.isFinite(n) && n > 0 ? n : null; })();
      if (ask === null || (typeof ask === 'object' && !Object.values(ask)[0])) continue;
      if (!out.some((y) => JSON.stringify(y) === JSON.stringify(ask))) out.push(ask);
    }
  }
  return out.slice(0, 8);
}

/* the changes in an answer, as written */
export function opsOf(text) {
  const out = [];
  for (const m of String(text || '').matchAll(BLOCK(CHANGES_OPEN, CHANGES_CLOSE))) {
    const list = parseLenient(m[1].replace(/```[a-z]*/gi, '').trim());
    for (const op of Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : [])) if (op && typeof op === 'object') out.push(op);
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
  if (o.note !== undefined) { add('newName', 'Its new name', 1); add('about', 'Who or what it is'); add('ties', 'With others'); add('now', 'Right now'); return out; }
  if (o.chapter !== undefined && o.passage === undefined) { add('name', 'The chapter’s new name', 1); return out; }
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

const BOOK_FIELDS ={ about: 'brief', style: 'style', plans: 'plans', title: 'title', subtitle: 'subtitle' };
const BOOK_WORDS = { about: 'What it’s about', style: 'How it reads', plans: 'Where it’s headed', title: 'The title', subtitle: 'The line under the title' };
const KIND_WORD = { people: 'People', places: 'Places', lore: 'Things worth remembering', threads: 'Threads' };

function passageAt(novel, ref) {
  const m = /^\s*(\d+)\s*[.,:]\s*(\d+)\s*$/.exec(String(ref || ''));
  if (!m) return { why: `“${ref}” is not a passage number like 2.3` };
  const ci = parseInt(m[1], 10);
  const pn = parseInt(m[2], 10);
  const chapterId = (novel.order || [])[ci - 1];
  const chapter = chapterId && store.peek('chapter', chapterId);
  if (!chapter) return { why: `there is no Chapter ${numberWords(ci)}` };
  const nums = passageNumbers(chapter);
  const p = (chapter.passages || []).find((x) => nums.get(x.id) === pn);
  if (!p) return { why: `Chapter ${numberWords(ci)} has no passage ${pn}` };
  return { chapter, passage: p, ci, pn };
}

export function labelOf(op) {
  if (op.rename && typeof op.rename === 'object') return `“${String(op.rename.from || '').trim()}” to “${String(op.rename.to || '').trim()}”, everywhere in the book`;
  if (op.replace_all !== undefined) return `“${String(op.find || '').slice(0, 40)}” across ${op.chapters && String(op.chapters).trim() !== 'all' ? `chapters ${op.chapters}` : 'the book'}`;
  if (op.module !== undefined) return `The module “${String(op.module || '').trim()}”`;
  if (op.summary !== undefined) return `Chapter ${numberWords(parseInt(op.summary, 10) || 0)}’s summary`;
  if (op.passage !== undefined) {
    const m = /^\s*(\d+)\s*[.,:]\s*(\d+)\s*$/.exec(String(op.passage));
    return m ? `Chapter ${numberWords(parseInt(m[1], 10))}, passage ${parseInt(m[2], 10)}` : `Passage ${op.passage}`;
  }
  if (op.chapter !== undefined) return `Chapter ${numberWords(parseInt(op.chapter, 10) || 0)}’s name`;
  if (op.book !== undefined) return BOOK_WORDS[op.book] || 'The book';
  if (op.note !== undefined) return `${String(op.name || '').trim() || 'A card'} (${KIND_WORD[op.note] || 'notes'})`;
  return 'A change';
}

/* ------------------------------------------------------------ finding words */

/* where `find` stands in `text`: exactly, or else read loosely (runs of
 * space as one, curly quotes as straight) — and only when it stands in one
 * place. {start, end} or {why}. */
function loose(str) {
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
export function locate(text, find) {
  const f = String(find || '');
  if (!f.trim()) return { why: 'it named no words to change' };
  const at = text.indexOf(f);
  if (at >= 0) {
    if (text.indexOf(f, at + 1) >= 0) return { why: 'those words stand in more than one place — it has to quote more of them' };
    return { start: at, end: at + f.length };
  }
  const T = loose(text);
  const F = loose(f.trim()).s;
  const i = T.s.indexOf(F);
  if (i < 0) return { why: 'those words are not there' };
  if (T.s.indexOf(F, i + 1) >= 0) return { why: 'those words stand in more than one place — it has to quote more of them' };
  return { start: T.map[i], end: T.map[i + F.length - 1] + 1 };
}

/* ------------------------------------------------------------ cards */

function sameCard(card, name) {
  const k = nameKey(name);
  return Boolean(k) && (nameKey(card.name) === k || (card.aka || []).some((a) => nameKey(a) === k));
}
const text = (v) => String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim();
/* the new words for a find: "replace" ("" takes the words out) — or "text",
 * when it wrote that instead; with neither, nothing is guessed */
const newWords = (op) => (op.replace !== undefined ? String(op.replace) : op.text !== undefined ? String(op.text) : null);

/* ------------------------------------------------------------ across the book */

const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_OR_DAY = /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
/* a name as a whole word, as written or in capitals (Cozy Tavern's
 * spelling) — never part of a longer word, nor of a name joined with a
 * hyphen ("Mary" is not in "Mary-Jane") */
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])(?<![\\p{L}\\p{N}]-)';
const EDGE_AFTER = '(?![\\p{L}\\p{N}_])(?!-[\\p{L}\\p{N}])';
function nameRe(name) {
  const n = String(name || '');
  const forms = [...new Set([n, n.toUpperCase()])].map(esc).join('|');
  return new RegExp(`${EDGE_BEFORE}(?:${forms})${EDGE_AFTER}`, 'gu');
}
/* the name changed wherever it stands — but never where it is already part
 * of the name it becomes ("Oda" to "Oda Jovan" leaves "Oda Jovan" as it is) */
function renamed(text, from, to) {
  const t = String(text || '');
  const up = String(from).toUpperCase();
  const taken = [...t.matchAll(nameRe(to))].map((m) => [m.index, m.index + m[0].length]);
  return t.replace(nameRe(from), (m, at) => {
    if (taken.some(([a, b]) => at >= a && at + m.length <= b)) return m;
    return m === up && up !== from ? String(to).toUpperCase() : to;
  });
}
/* the same words wherever they stand: whole words at the ends that are
 * letters or numbers ("Ann" is not in "Annual" nor "Anna") */
function wordsRe(find) {
  const f = String(find || '');
  const before = /^[\p{L}\p{N}_]/u.test(f) ? '(?<![\\p{L}\\p{N}_])' : '';
  const after = /[\p{L}\p{N}_]$/u.test(f) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(`${before}${esc(f)}${after}`, 'gu');
}
/* every passage on the page, in book order: {chapterId, chapter, passage, version, ci} */
function eachPassage(novel, { from = 1, to = Infinity } = {}) {
  const out = [];
  (novel.order || []).forEach((id, i) => {
    if (i + 1 < from || i + 1 > to) return;
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
/* "2-5", "3", [2,5], "all" or nothing: which chapters */
function chapterRange(novel, spec) {
  const n = (novel.order || []).length;
  if (spec === undefined || spec === null || spec === '' || /^all$/i.test(String(spec).trim())) return { from: 1, to: n };
  if (Array.isArray(spec) && spec.length === 2) return { from: Math.max(1, parseInt(spec[0], 10) || 1), to: Math.min(n, parseInt(spec[1], 10) || n) };
  const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(String(spec));
  if (!m) return null;
  const a = parseInt(m[1], 10); const b = m[2] ? parseInt(m[2], 10) : a;
  return { from: Math.max(1, Math.min(a, b)), to: Math.min(n, Math.max(a, b)) };
}
function newVersionOn(novelId, x, next, why) {
  const version = newVersion({ text: next, how: 'partner', from: x.version.id, words: countWords(next), why: why || undefined, ...(x.version.ask ? { ask: x.version.ask } : {}) });
  store.change('chapter', x.chapterId, chapterSteps.addVersion(x.passage.id, version), { now: true });
  return { chapterId: x.chapterId, passageId: x.passage.id, versionId: version.id, from: x.version.id };
}

/* ------------------------------------------------------------ making one */

/* One change, made. Returns the change as kept on the reply:
 * {id, op, label, why, status: 'made'|'refused', said?, undo?}. */
export function makeChange(novelId, op, { id = newId('cg') } = {}) {
  const base = { id, op: clone(op), label: labelOf(op), why: text(op.why) };
  const refuse = (said) => ({ ...base, status: 'refused', said });
  const novel = store.peek('novel', novelId);
  if (!novel) return refuse('the book is not open');
  const at = Date.now();

  /* a name changed everywhere in the book (Cozy Tavern's spelling correction):
   * every passage on the page, chapter names, the notes, the book's own words —
   * the name as a whole word, as written or in capitals; never an ordinary
   * word (a month, a weekday, a word written in small letters, or one the book
   * uses in small letters too) */
  if (op.rename && typeof op.rename === 'object') {
    const from = text(op.rename.from).slice(0, 80);
    const to = text(op.rename.to).slice(0, 80);
    if (!from || !to || from === to) return refuse('it needs a name as it stands and the name it becomes, not the same');
    if (from === from.toLowerCase() || MONTH_OR_DAY.test(from)) return refuse(`“${from}” is an ordinary word as well as a name — change it passage by passage instead`);
    const lower = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(from.toLowerCase())}(?![\\p{L}\\p{N}_])`, 'u');
    const places = eachPassage(novel);
    if (from.toLowerCase() !== from && places.some((x) => lower.test(String(x.version.text)))) return refuse(`the book also uses “${from.toLowerCase()}” as an ordinary word — change it passage by passage instead`);
    const undo = { what: 'many', passages: [], chapters: [], cards: [], book: [], kept: [] };
    for (const x of places) {
      const next = renamed(x.version.text, from, to);
      if (next !== x.version.text) undo.passages.push(newVersionOn(novelId, x, next, base.why));
    }
    for (const id of novel.order || []) {
      const c = store.peek('chapter', id);
      if (!c || !c.name) continue;
      const next = renamed(c.name, from, to);
      if (next === c.name) continue;
      undo.chapters.push({ chapterId: id, before: { name: c.name, nameBy: c.nameBy || '' }, after: next });
      store.change('chapter', id, chapterSteps.setName(next, c.nameBy || 'you'), { now: true });
    }
    for (const kind of NOTE_KINDS) {
      for (const card of (novel.notes && novel.notes[kind]) || []) {
        const next = clone(card);
        for (const k of ['name', 'about', 'ties', 'now']) if (typeof next[k] === 'string') next[k] = renamed(next[k], from, to);
        if (Array.isArray(next.aka)) next.aka = next.aka.map((a) => renamed(a, from, to));
        if (JSON.stringify(next) === JSON.stringify(card)) continue;
        undo.cards.push({ kind, id: card.id, before: clone(card), after: clone(next) });
        store.change('novel', novelId, novelSteps.putNote(kind, next), { now: true });
      }
    }
    for (const [field, meta] of [['brief', false], ['style', false], ['plans', false], ['title', true], ['subtitle', true]]) {
      const old = String((meta ? novel.meta[field] : novel[field]) || '');
      const next = renamed(old, from, to);
      if (next === old) continue;
      undo.book.push({ field, meta, before: old, after: next });
      store.change('novel', novelId, meta ? novelSteps.setMeta({ [field]: next }) : novelSteps.setField(field, next), { now: true });
    }
    for (const key of ['about', 'style']) {
      const k = novel.kept && novel.kept[key];
      if (!k || !k.text) continue;
      const next = renamed(k.text, from, to);
      if (next === k.text) continue;
      const after = { ...k, text: next };
      undo.kept.push({ key, before: clone(k), after: clone(after) });
      store.change('novel', novelId, novelSteps.setKept(key, after), { now: true });
    }
    const n = undo.passages.length + undo.chapters.length + undo.cards.length + undo.book.length + undo.kept.length;
    if (!n) return refuse(`“${from}” does not stand anywhere in the book`);
    store.change('novel', novelId, novelSteps.touchWritten(at));
    const said = [undo.passages.length ? `${undo.passages.length} passage${undo.passages.length === 1 ? '' : 's'}` : '', undo.chapters.length ? `${undo.chapters.length} chapter name${undo.chapters.length === 1 ? '' : 's'}` : '',
      undo.cards.length ? `${undo.cards.length} card${undo.cards.length === 1 ? '' : 's'} in the notes` : '', undo.book.length + undo.kept.length ? 'the book’s own words' : ''].filter(Boolean).join(', ');
    return { ...base, status: 'made', undo, before: from, after: to, said: `changed in ${said}` };
  }

  /* the same words changed across chapters (Cozy Tavern's bulk replace) —
   * exactly as written, every place they stand, each passage a new version */
  if (op.replace_all !== undefined) {
    const find = String(op.find || '');
    const words = newWords(op);
    if (!find.trim()) return refuse('it named no words to change');
    if (words === null) return refuse('it gave no new words for them');
    const range = chapterRange(novel, op.chapters !== undefined ? op.chapters : op.range);
    if (!range) return refuse('it did not name chapters the app could read — say them as “2-5”, or “all”');
    const undo = { what: 'many', passages: [], chapters: [], cards: [], book: [], kept: [] };
    let hits = 0;
    const re = wordsRe(find);
    for (const x of eachPassage(novel, range)) {
      const t = String(x.version.text);
      const n = (t.match(re) || []).length;
      if (!n) continue;
      hits += n;
      undo.passages.push(newVersionOn(novelId, x, t.replace(re, () => words), base.why));
    }
    if (!hits) return refuse('those words stand nowhere in those chapters');
    store.change('novel', novelId, novelSteps.touchWritten(at));
    return { ...base, status: 'made', undo, before: find, after: words, said: `${hits} place${hits === 1 ? '' : 's'} in ${undo.passages.length} passage${undo.passages.length === 1 ? '' : 's'}` };
  }

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
      if (spot.why) return refuse(spot.why);
      next = old.slice(0, spot.start) + w + old.slice(spot.end);
    } else if (op.text !== undefined) next = String(op.text);
    else return refuse('it gave no words');
    if (next === old) return refuse('it would change nothing');
    const before = m.builtin && !m.ownWords ? undefined : old;
    store.change('house', 'house', moduleSteps.set(m.id, { text: next }), { now: true });
    return { ...base, label: `The module “${m.name}”`, status: 'made', undo: { what: 'module', id: m.id, before, after: next }, before: old.slice(0, 400), after: next.slice(0, 400) };
  }

  /* a chapter's summary, his from then on (until the chapter itself changes) */
  if (op.summary !== undefined) {
    const n = parseInt(op.summary, 10);
    const chapterId = (novel.order || [])[n - 1];
    const chapter = chapterId && store.peek('chapter', chapterId);
    if (!chapter) return refuse(`there is no Chapter ${numberWords(n || 0)}`);
    const old = String((chapter.summary && chapter.summary.text) || '');
    let next;
    if (op.find !== undefined) {
      const w = newWords(op);
      if (w === null) return refuse('it gave no new words for them');
      const spot = locate(old, op.find);
      if (spot.why) return refuse(spot.why);
      next = old.slice(0, spot.start) + w + old.slice(spot.end);
    } else if (op.text !== undefined) next = text(op.text);
    else return refuse('it gave no words');
    if (!next.trim()) return refuse('a summary needs words');
    if (next === old) return refuse('it would change nothing');
    const was = chapter.summary ? clone(chapter.summary) : null;
    const after = { text: next, fp: chapterPrint(chapter), at, by: 'you' };
    store.change('chapter', chapterId, chapterSteps.setSummary(after), { now: true });
    /* kept for the chapter as it reads, so a version brought back brings his back too (Cozy Tavern's M680-9) */
    const keptBefore = clone((chapter.summaries || []).find((x) => x.fp === after.fp) || null);
    store.change('chapter', chapterId, chapterSteps.keepSummary(after), { now: true });
    return { ...base, status: 'made', undo: { what: 'summary', chapterId, before: was, after: clone(after), keptBefore }, before: old, after: next };
  }

  if (op.passage !== undefined) {
    const where = passageAt(novel, op.passage);
    if (where.why) return refuse(where.why);
    const { chapter, passage } = where;
    if (passage.by === 'break') return refuse('that is a scene break');
    const v = picked(passage) || {};
    if (v.streaming) return refuse('that passage is being written just now');
    /* taken out of the chapter, with its Undo; what only it put in the notes goes too */
    if (op.remove === true) {
      const i = chapter.passages.indexOf(passage);
      const after = i > 0 ? chapter.passages[i - 1].id : '^';
      const copy = clone(passage);
      archivist.retireIfSeen(novelId, chapter.id, passage.id);
      store.change('chapter', chapter.id, chapterSteps.removePassage(passage.id), { now: true });
      store.change('novel', novelId, novelSteps.touchWritten(at));
      return { ...base, status: 'made', undo: { what: 'removed', chapterId: chapter.id, passage: copy, after }, before: String(v.text || ''), after: '' };
    }
    const old = String(v.text || '');
    let next;
    if (op.text !== undefined && op.find === undefined) {
      next = text(op.text);
      if (!next) return refuse('it gave no words for the passage');
    } else {
      const words = newWords(op);
      if (words === null) return refuse('it gave no new words for them');
      const spot = locate(old, op.find);
      if (spot.why) return refuse(spot.why);
      next = old.slice(0, spot.start) + words + old.slice(spot.end);
    }
    if (next === old) return refuse('it would change nothing');
    const version = newVersion({ text: next, how: 'partner', from: v.id, words: countWords(next), why: base.why || undefined, ...(v.ask ? { ask: v.ask } : {}) });
    store.change('chapter', chapter.id, chapterSteps.addVersion(passage.id, version), { now: true });
    store.change('novel', novelId, novelSteps.touchWritten(at));
    return { ...base, status: 'made', undo: { what: 'passage', chapterId: chapter.id, passageId: passage.id, versionId: version.id, from: v.id }, before: old, after: next };
  }

  if (op.chapter !== undefined) {
    const n = parseInt(op.chapter, 10);
    const chapterId = (novel.order || [])[n - 1];
    const chapter = chapterId && store.peek('chapter', chapterId);
    if (!chapter) return refuse(`there is no Chapter ${numberWords(n || 0)}`);
    const name = text(op.name).slice(0, 120);
    if (name === (chapter.name || '')) return refuse('it already has that name');
    /* how it was, taken before the change (the record changes in place) */
    const was = { name: chapter.name || '', nameBy: chapter.nameBy || '' };
    /* named for him: the helper never names it again */
    store.change('chapter', chapterId, chapterSteps.setName(name, 'you'), { now: true });
    return { ...base, status: 'made', undo: { what: 'chapter', chapterId, before: was, after: name }, before: was.name, after: name };
  }

  if (op.book !== undefined) {
    const field = BOOK_FIELDS[op.book];
    if (!field) return refuse(`“${op.book}” is not a part of the book it can change`);
    const meta = field === 'title' || field === 'subtitle';
    const old = String((meta ? novel.meta[field] : novel[field]) || '');
    let next;
    if (op.find !== undefined) {
      const words = newWords(op);
      if (words === null) return refuse('it gave no new words for them');
      const spot = locate(old, op.find);
      if (spot.why) return refuse(spot.why);
      next = old.slice(0, spot.start) + words + old.slice(spot.end);
    } else if (op.add !== undefined) next = [old.replace(/\s+$/, ''), text(op.add)].filter(Boolean).join('\n\n');
    else if (op.text !== undefined) next = text(op.text);
    else return refuse('it gave no words');
    if (field === 'title' && !next.trim()) return refuse('a book needs a title');
    if (next === old) return refuse('it would change nothing');
    store.change('novel', novelId, meta ? novelSteps.setMeta({ [field]: next }) : novelSteps.setField(field, next), { now: true });
    return { ...base, status: 'made', undo: { what: 'book', field, meta, before: old, after: next }, before: old, after: next };
  }

  if (op.note !== undefined) {
    const kind = op.note;
    if (!NOTE_KINDS.includes(kind)) return refuse(`“${kind}” is not a part of the notes`);
    const name = text(op.name).slice(0, 120);
    if (!name) return refuse('the card needs a name');
    const list = (novel.notes && novel.notes[kind]) || [];
    const found = list.find((c) => sameCard(c, name));
    /* how it was, taken before the change */
    const card = found ? clone(found) : null;
    if (op.remove === true) {
      if (!card) return refuse(`there is no ${name} in the notes`);
      store.change('novel', novelId, novelSteps.dropNote(kind, card.id), { now: true });
      return { ...base, status: 'made', undo: { what: 'note', kind, id: card.id, before: card, after: null }, before: card.about || '', after: '' };
    }
    /* a card given a new name: the old one stays among the others it goes by */
    const newName = text(op.newName || op.rename_to || '').slice(0, 120);
    if (newName && !card) return refuse(`there is no ${name} in the notes to rename`);
    const next = card ? clone(card) : newCard(kind, { name });
    if (newName && card && nameKey(newName) !== nameKey(card.name)) {
      if (list.some((c) => c.id !== card.id && sameCard(c, newName))) return refuse(`another card is called ${newName} already`);
      if (kind === 'people') next.aka = [...(next.aka || []).filter((a) => nameKey(a) !== nameKey(newName)), card.name];
      next.name = newName;
    }
    for (const key of ['about', 'now', 'ties']) if (op[key] !== undefined && (key === 'about' || kind === 'people')) next[key] = text(op[key]);
    if (kind === 'people' && op.aka !== undefined) {
      const more = (Array.isArray(op.aka) ? op.aka : String(op.aka).split(',')).map(text).filter(Boolean);
      const all = [...(next.aka || []), ...more];
      next.aka = all.filter((a, i) => all.findIndex((b) => nameKey(b) === nameKey(a)) === i && nameKey(a) !== nameKey(next.name));
    }
    if (kind === 'threads' && typeof op.open === 'boolean') next.open = op.open;
    /* changed for him, as if by his own hand: the helper keeps his words on it */
    next.updated = { by: 'you', at };
    const was = card ? JSON.stringify({ ...card, updated: null }) : '';
    if (card && JSON.stringify({ ...next, updated: null }) === was) return refuse('the card already says that');
    store.change('novel', novelId, novelSteps.putNote(kind, next), { now: true });
    return { ...base, status: 'made', undo: { what: 'note', kind, id: next.id, before: card, after: clone(next) }, before: card ? (card.about || '') : '', after: next.about || '' };
  }
  return refuse('it did not say what to change');
}

/* ------------------------------------------------------------ before it waits */

/* Would this change land? A change set to wait for Apply is looked at as it
 * arrives (Cozy Tavern checks a card's anchor when it is staged): one whose
 * place or words cannot be found is said so at once, while the partner can
 * still put it right. '' when nothing stands in its way that can be seen now. */
export function whyNot(novelId, op) {
  const novel = store.peek('novel', novelId);
  if (!novel || !op || typeof op !== 'object') return 'the book is not open';
  if (op.passage !== undefined) {
    const where = passageAt(novel, op.passage);
    if (where.why) return where.why;
    if (op.find !== undefined && op.remove !== true) { const spot = locate(String((picked(where.passage) || {}).text || ''), op.find); if (spot.why) return spot.why; }
    return '';
  }
  if (op.book !== undefined && op.find !== undefined) {
    const field = BOOK_FIELDS[op.book];
    if (!field) return `“${op.book}” is not a part of the book it can change`;
    const old = String(((field === 'title' || field === 'subtitle') ? novel.meta[field] : novel[field]) || '');
    return locate(old, op.find).why || '';
  }
  if (op.note !== undefined && (op.remove === true || text(op.newName || op.rename_to || ''))) {
    const list = (novel.notes && novel.notes[op.note]) || [];
    return list.some((c) => sameCard(c, text(op.name))) ? '' : `there is no ${text(op.name)} in the notes${op.remove === true ? '' : ' to rename'}`;
  }
  if (op.replace_all !== undefined) {
    const range = chapterRange(novel, op.chapters !== undefined ? op.chapters : op.range);
    if (!range) return 'it did not name chapters the app could read — say them as “2-5”, or “all”';
    const find = String(op.find || '');
    if (!find.trim()) return 'it named no words to change';
    const re = wordsRe(find);
    return eachPassage(novel, range).some((x) => { re.lastIndex = 0; return re.test(String(x.version.text)); }) ? '' : 'those words stand nowhere in those chapters';
  }
  return '';
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
    for (const x of u.passages || []) {
      const c = store.peek('chapter', x.chapterId);
      const p = c && (c.passages || []).find((y) => y.id === x.passageId);
      const shown = p && picked(p);
      if (!shown || shown.id !== x.versionId || !p.versions.some((v) => v.id === x.from)) { kept++; continue; }
      /* read by the helper since: its words are kept for it, so what came only from them goes too */
      archivist.retireIfSeen(novelId, x.chapterId, x.passageId, x.versionId);
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
    if (!back) return { ok: false, said: 'everything it changed has been changed again since' };
    return { ok: true, said: kept ? `${back} put back; ${kept} changed since, kept as they are` : '' };
  }
  if (u.what === 'module') {
    const m = listModules(store.peek('house', 'house') || {}).find((x) => x.id === u.id);
    if (!m || String(m.text || '') !== u.after) return { ok: false, said: 'the module has been changed since' };
    store.change('house', 'house', moduleSteps.set(u.id, { text: u.before }), { now: true });
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
    if (JSON.stringify(cur) !== JSON.stringify(u.after)) return { ok: false, said: u.after ? 'the card has been changed since' : 'the card is back in the notes already' };
    store.change('novel', novelId, novelSteps.undoCards([{ kind: u.kind, id: u.id, before: u.before, after: u.after }]), { now: true });
    return { ok: true };
  }
  return { ok: false, said: 'there is nothing to put back' };
}

/* what came of its changes, in his words, for the partner to read next time */
export function outcomeWords(changes) {
  const bits = (changes || []).map((c) => {
    if (c.status === 'made') return `${c.label} — made`;
    if (c.status === 'undone') return `${c.label} — I undid it`;
    if (c.status === 'waiting') return `${c.label} — waiting for me to apply it`;
    if (c.status === 'skipped') return `${c.label} — I left it`;
    return `${c.label} — couldn’t be made (${c.said || 'no reason given'})`;
  });
  return bits.length ? `(Of your changes: ${bits.join('; ')}.)` : '';
}
