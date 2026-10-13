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
import { chapterSteps, novelSteps, newVersion, picked, passageNumbers, newCard, NOTE_KINDS } from './shape.js';
import { countWords, nameKey, numberWords, newId, clone } from '../util.js';
import { parseLenient } from './jsonutil.js';
import { CHANGES_OPEN, CHANGES_CLOSE, READ_OPEN, READ_CLOSE } from './prompts.js';

/* ------------------------------------------------------------ reading it */

const BLOCK = (open, close) => new RegExp(`${open.replace(/[<>/]/g, (c) => `\\${c}`)}([\\s\\S]*?)${close.replace(/[<>/]/g, (c) => `\\${c}`)}`, 'gi');

/* the words of an answer, without its blocks — and, while one is still
 * coming, without the part of it that has come so far */
export function wordsOf(text) {
  let t = String(text || '');
  t = t.replace(BLOCK(CHANGES_OPEN, CHANGES_CLOSE), '').replace(BLOCK(READ_OPEN, READ_CLOSE), '');
  const open = t.search(/<(changes|read)>/i);
  if (open >= 0) t = t.slice(0, open);
  /* a fence it put around a block, left empty */
  t = t.replace(/```[a-z]*\s*```/gi, '');
  return t.replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
/* a changes block still on its way */
export function changesComing(text) { return /<changes>/i.test(String(text || '')) && !/<\/changes>/i.test(String(text || '')); }

/* the chapters it asked to read whole: numbers, at most four */
export function readsOf(text) {
  const out = [];
  for (const m of String(text || '').matchAll(BLOCK(READ_OPEN, READ_CLOSE))) {
    const list = parseLenient(m[1].trim().startsWith('[') ? m[1] : `[${m[1]}]`);
    for (const x of Array.isArray(list) ? list : []) {
      const n = parseInt(String(x).replace(/^\D+/, ''), 10);
      if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out.slice(0, 4);
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

/* ------------------------------------------------------------ where */

const BOOK_FIELDS = { about: 'brief', style: 'style', plans: 'plans', title: 'title', subtitle: 'subtitle' };
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

/* ------------------------------------------------------------ making one */

/* One change, made. Returns the change as kept on the reply:
 * {id, op, label, why, status: 'made'|'refused', said?, undo?}. */
export function makeChange(novelId, op, { id = newId('cg') } = {}) {
  const base = { id, op: clone(op), label: labelOf(op), why: text(op.why) };
  const refuse = (said) => ({ ...base, status: 'refused', said });
  const novel = store.peek('novel', novelId);
  if (!novel) return refuse('the book is not open');
  const at = Date.now();

  if (op.passage !== undefined) {
    const where = passageAt(novel, op.passage);
    if (where.why) return refuse(where.why);
    const { chapter, passage } = where;
    if (passage.by === 'break') return refuse('that is a scene break');
    const v = picked(passage) || {};
    if (v.streaming) return refuse('that passage is being written just now');
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
    const next = card ? clone(card) : newCard(kind, { name });
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

/* ------------------------------------------------------------ undoing one */

/* Put one change back. {ok} or {ok: false, said}. */
export function undoChange(novelId, change) {
  const u = change && change.undo;
  if (!u) return { ok: false, said: 'there is nothing to put back' };
  const novel = store.peek('novel', novelId);
  if (!novel) return { ok: false, said: 'the book is not open' };
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
