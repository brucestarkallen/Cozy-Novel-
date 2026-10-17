/* Cozy Novel — js/novel/shape.js
 *
 * What a book is made of, and the small steps that change it. Pure: no
 * fetches, no screen. Every step is written by id and means the same thing
 * when played twice (see store.js), so it can be played again over a newer
 * copy from the phone.
 *
 *   novel   { id, meta, brief, style, plans, auto, kept, order:[chapterId], notes, memory, prefs, plays:[playId] }
 *             brief and style are his own words; auto {about, style}: false
 *             when he set that one to Manual (Automatic otherwise); kept
 *             {about, style}: {text, at, by} — what the helper keeps of the
 *             book as it stands (by 'you' once he corrected it); prefs
 *             {length, outcome: 'me' (absent: the writer decides), sound:
 *             'novel' (absent: Comic), at: the chapter last open}
 *             memory {seen, removed, undo, lit, readings}: what the helper
 *             has read (seen[chapter][passage] = its signature), the last
 *             reading's Undo, what to light on the notes (lit), and what each
 *             reading of each version changed (readings.js)
 *   chapter { id, novelId, name, nameBy, passages:[passage], summary, summaries:[{fp,text,at}], retired:[] }
 *   passage { id, by:'ai'|'you'|'break', pick, versions:[version] }
 *   version { id, text, at, how, ask, conn, model, thinking, cut, stopped, notes, usage, ms, sent, streaming }
 *   talk    { id:novelId, novelId, turns:[turn] }          the partner
 *   play    { id, novelId, title, who, from, chapterId, turns:[turn], turned, created, updated }
 *   draft   { id:novelId, novelId, direction, partner, play:{}, cards:{} }
 */

import { newId, countWords, hashText, numberWords, nameKey } from '../util.js';
import { samePersonName, plainName, sameThingName, isDescriptorName, nameInText, nearName } from './names.js';

export const COVERS = ['ember', 'moss', 'dusk', 'rose', 'ink', 'sea', 'wine', 'gold'];
/* how much a Write writes. A size is asked as a range (around x to y words):
 * a model aims for the middle of a range, where "at most x" is read as a
 * target to hit or a reason to rush. Automatic leaves it to the writer. */
export const LENGTHS = {
  auto: { label: 'Automatic', words: [0, 0], hint: 'the writer judges how much the story needs' },
  paragraphs: { label: 'A few paragraphs', words: [250, 500] },
  scene: { label: 'A scene', words: [1000, 1800] },
  long: { label: 'A long stretch', words: [2500, 4000] },
  chapter: { label: 'The rest of the chapter', words: [0, 0] },
};
export const NOTE_KINDS = ['people', 'places', 'lore', 'threads'];

/* Who decides how what he asks for turns out (the chip by the box): the
 * writer, or he does — the writer stops on the moment it hangs. */
export const OUTCOMES = {
  writer: { label: 'Writer decides', hint: 'your premise sets it going; the writer decides how it turns out and what it costs' },
  me: { label: 'I decide', hint: 'the writer plays it out and stops right before it’s settled — your next premise settles it' },
};
export function outcomeOf(novel) { return novel && novel.prefs && novel.prefs.outcome === 'me' ? 'me' : 'writer'; }
/* How the world's sounds are written in this book (About this book → Sound):
 * Comic — sound effects in asterisks — or Novel — sounds in the sentences. */
export const SOUNDS = ['comic', 'novel'];
export function soundOf(novel) { return novel && novel.prefs && SOUNDS.includes(novel.prefs.sound) ? novel.prefs.sound : 'comic'; }

/* Optional defaults for new narration. Missing and unrecognised values
 * follow his instructions and the established book, as older books did. */
export const POVS = {
  auto: { label: 'Follow the book', hint: 'Use your instructions and the point of view already established in the story.' },
  first: { label: 'First person — I', hint: 'Tell the story as “I”, through the narrator’s own experience and knowledge.' },
  second: { label: 'Second person — you', hint: 'Address the viewpoint character as “you”, through what they experience.' },
  'third-limited': { label: 'Third person — close', hint: 'Use names, “he”, “she” or “they”, staying with one character’s experience and knowledge at a time.' },
  'third-omniscient': { label: 'Third person — all-knowing', hint: 'An all-knowing narrator may reveal more than any one character knows, including different people’s thoughts.' },
};
export const TENSES = {
  auto: { label: 'Follow the book', hint: 'Use your instructions and the tense already established in the story.' },
  past: { label: 'Past — she opened the door', hint: 'Tell the main action as something that happened: “She opened the door.”' },
  present: { label: 'Present — she opens the door', hint: 'Tell the main action as it happens: “She opens the door.”' },
};
export function povOf(novel) { const v = novel && novel.prefs && novel.prefs.pov; return Object.hasOwn(POVS, v) ? v : 'auto'; }
export function tenseOf(novel) { const v = novel && novel.prefs && novel.prefs.tense; return Object.hasOwn(TENSES, v) ? v : 'auto'; }

export function coverFor(title) {
  const h = parseInt(hashText(title).slice(0, 6), 36) || 0;
  return COVERS[h % COVERS.length];
}

export function newVersion(fields = {}) {
  return { id: newId('v'), text: '', at: Date.now(), ...fields };
}

/* WHERE A VERSION STOPS, carried to one made from it (Cozy Tavern's M511-1,
 * M548): cut short at its end and why, stopped by his hand — so Go on is
 * still offered for it. A version made by changing words inside it keeps
 * these; one he finished himself does not (sameEnd). A few selected words
 * rewritten that stopped partway are cut in the middle, not at the end: Go
 * on cannot mend that, and it is not carried. */
export function cutAtEnd(v) { return Boolean(v && v.cut && (v.how !== 'selection' || v.endCut)); }
export function endOf(v) {
  const out = {};
  if (!cutAtEnd(v)) return out;
  for (const k of ['cut', 'cutWhy', 'cutBy', 'stopped']) if (v[k] !== undefined) out[k] = v[k];
  return out;
}
/* WHOSE WORDS, AND FROM WHEN (Cozy Tavern's M607 keepWritersOwn): a version
 * made from another by fixing words in place — a fix he applied, the
 * partner's, a name changed everywhere, a few words rewritten — keeps the
 * root it came from: his own words stay his, and writing from before the
 * checker began stays from before it. */
export function rootOf(v) {
  if (!v) return {};
  return { rootHow: v.rootHow || v.how, rootAt: v.rootAt || v.done || v.at || 0 };
}
export const howOf = (v) => (v && (v.rootHow || v.how)) || '';
export const bornOf = (v) => (v ? v.rootAt || v.done || v.at || 0 : 0);
/* What was taken off a page — a heading above it, a note or tracking after
 * it — kept with a version made from it in place (a fix, his partner's
 * words, a few words written again, his edit that keeps its end), so its
 * Put back stays (Cozy Tavern M46/M55: a copy made field by field dropped
 * what was not on its list) */
/* what wrote a version's words, kept with a version made from it by changing some of them — the checker's fixes,
 * his partner's words, his own edit: the request it was written from (What the writer was sent) and its thinking.
 * Never the model: the new version is no longer that model's own whole page. */
export function writtenWith(v) {
  if (!v) return {};
  return { ...(v.thinking ? { thinking: v.thinking } : {}), ...(v.sent ? { sent: v.sent } : {}), ...(Array.isArray(v.sentMore) && v.sentMore.length ? { sentMore: v.sentMore.slice() } : {}) };
}
export function keptTail(v) {
  if (!v) return {};
  return { ...(String(v.tookOff || '').trim() ? { tookOff: v.tookOff } : {}), ...(String(v.tookOffTop || '').trim() ? { tookOffTop: v.tookOffTop } : {}) };
}
/* WORDS CHANGED IN PLACE (his word, 2.12.2: "rewrite is the only thing who
 * create new version"; "new version is only for rewrite or another take").
 * A fix the checker put in, a sentence it had written again, his partner's
 * words, his own edit, a name changed everywhere: the version on show takes
 * them, as a page takes a correction. Kept on it:
 *  - `before`: the words before each change, the newest last (the first
 *    words and the newest BEFORE_KEEP - 1 changes: keptBefore) — Put back
 *    the words before brings the newest back, with
 *    what the checker had found in them and the bibliography's facts of them
 *    (on the newest only), whether it stopped short, and what had been taken
 *    off it;
 *  - `hands`: who changed its words — 'checker', 'partner', 'you';
 *  - `written`: its words as they were before the first change — for a
 *    writer's page, the writer's own words: what is measured of the writer
 *    (its stock wording, head to head) is measured on these.
 * A new version is a take: written, another take, written again (whole, or
 * the words he selected), or a passage his partner wrote anew. */
export const BEFORE_KEEP = 5;
/* past BEFORE_KEEP, the oldest change after the first words goes — the words as first written stay first, so Put back
 * the words before always comes back to them (through 2.12.2 the oldest of all went, and with it the writer's own
 * words once a page had been changed six times) */
const keptBefore = (list) => (list.length <= BEFORE_KEEP ? list : [list[0], ...list.slice(-(BEFORE_KEEP - 1))]);
export const PRIOR_KEEP = 4;
export const handsOf = (v) => (v && Array.isArray(v.hands) ? v.hands : []);
export const writtenOf = (v) => (v ? String(typeof v.written === 'string' ? v.written : v.text || '') : '');
/* changed by him or his partner: no longer the writer's own words, nor only its words with fixes put in */
export const mixedHands = (v) => handsOf(v).some((x) => x === 'you' || x === 'partner');
export const END_KEYS = ['cut', 'cutWhy', 'cutBy', 'stopped', 'endCut'];
export function inPlaceFields(v, next, by, { at = Date.now(), check = null, codex = null, keepEnd = true, tail = false, extra = {} } = {}) {
  const was = String((v && v.text) || '');
  const end = Object.fromEntries(END_KEYS.filter((k) => v && v[k] !== undefined).map((k) => [k, v[k]]));
  const entry = { text: was, by, at,
    ...(Object.keys(end).length ? { end } : {}),
    ...(check ? { check: JSON.parse(JSON.stringify(check)) } : {}),
    ...(codex ? { codex: JSON.parse(JSON.stringify(codex)) } : {}),
    ...(tail ? { tail: keptTail(v) } : {}),
    ...extra };
  /* the facts of the words, kept on the newest words before only (they can be many); what the checker found in them on each */
  const older = (Array.isArray(v && v.before) ? v.before : []).map(({ codex: _x, ...rest }) => rest);
  const hands = handsOf(v).includes(by) ? handsOf(v).slice() : [...handsOf(v), by];
  const out = { text: next, words: countWords(next), before: keptBefore([...older, entry]), hands };
  if (!(v && typeof v.written === 'string')) out.written = was;
  if (!keepEnd) for (const k of END_KEYS) out[k] = undefined;
  if (tail) { out.tookOff = undefined; out.tookOffTop = undefined; }
  return out;
}
/* the words before the fixes the checker has put in by itself since the last other change (`auto` on the words before):
 * what goes in by itself is measured against these, so a passage never drifts far by itself, a look at a time */
export function autoBaseOf(v) {
  const list = Array.isArray(v && v.before) ? v.before : [];
  let base = String((v && v.text) || '');
  let i = list.length - 1;
  for (; i >= 0 && list[i] && list[i].auto; i--) base = String(list[i].text || '');
  /* every change kept was by itself, and older ones may have gone: the words as they were first */
  if (i < 0 && list.length >= BEFORE_KEEP) base = writtenOf(v);
  return base;
}
/* the newest words before, put back: the fields to set, and what was found in them (or null) — null when there are none */
export function putBackFields(v) {
  const list = Array.isArray(v && v.before) ? v.before : [];
  const last = list[list.length - 1];
  if (!last || typeof last.text !== 'string') return null;
  const rest = list.slice(0, -1);
  const out = { text: last.text, words: countWords(last.text), before: rest.length ? rest : undefined };
  for (const k of END_KEYS) out[k] = last.end ? last.end[k] : undefined;
  if (last.tail) { out.tookOff = last.tail.tookOff; out.tookOffTop = last.tail.tookOffTop; }
  /* back to its first words: no longer changed by anyone */
  if (!rest.length && last.text === writtenOf(v)) { out.hands = undefined; out.written = undefined; }
  return { patch: out, check: last.check || null, codex: last.codex || null, by: last.by, at: last.at };
}

/* the two read the same at their end: the last words untouched */
export function sameEnd(a, b) {
  const tail = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(-40);
  return tail(a) === tail(b);
}

export function newPassage(by, text = '', fields = {}) {
  return { id: newId('p'), by, pick: 0, versions: [newVersion({ text, how: by === 'you' ? 'mine' : by, ...fields })] };
}

/* What a chapter kept for some of its passages, to go with them into
 * another chapter (A new chapter from here, Cozy Tavern F9): what the checker
 * found and what he left, the judge's head to head, and the words of their
 * versions taken out, which the helper reads to take back what came from
 * them. A copy — the chapter itself is not changed. */
export function keptFor(chapter, passageIds) {
  const ids = new Set(passageIds);
  const pick = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([pid]) => ids.has(pid)));
  const theirs = (r) => r && (ids.has(r.key) || [...ids].some((pid) => String(r.key || '').startsWith(pid + ':')));
  return JSON.parse(JSON.stringify({
    checks: pick(chapter && chapter.checks),
    checksLeft: pick(chapter && chapter.checksLeft),
    duels: Object.fromEntries(Object.entries((chapter && chapter.duels) || {}).filter(([, d]) => d && ids.has(d.pid))),
    retired: ((chapter && chapter.retired) || []).filter(theirs),
  }));
}

export function newChapter(novelId) {
  return { id: newId('ch'), novelId, name: '', nameBy: '', passages: [], summary: null, retired: [] };
}

export function newNovel({ title, brief = '', style = '', plans = '' }) {
  const id = newId('n');
  const chapter = newChapter(id);
  const at = Date.now();
  const novel = {
    id,
    meta: { title: String(title || '').trim() || 'Untitled', subtitle: '', cover: coverFor(title), words: 0, chapters: 1,
      created: at, written: at, opened: at, archived: false },
    brief, style, plans,
    auto: { about: true, style: true },
    kept: {},
    order: [chapter.id],
    notes: { people: [], places: [], lore: [], threads: [] },
    memory: { seen: {}, removed: [], undo: null, at: 0 },
    prefs: { length: 'scene', writer: '' },
    plays: [],
  };
  return { novel, chapter };
}

/* ------------------------------------------------------------ reading */

export function picked(passage) {
  if (!passage || !Array.isArray(passage.versions) || !passage.versions.length) return null;
  const i = Number.isInteger(passage.pick) && passage.pick >= 0 && passage.pick < passage.versions.length ? passage.pick : passage.versions.length - 1;
  return passage.versions[i];
}
/* The request that made these words, through changes made in place. Follow
 * this version's ancestry, never an unrelated take or an older rewrite it
 * replaced. Selection notes still apply beside the whole passage's request. */
export function requestOf(passage, version = picked(passage)) {
  const versions = (passage && passage.versions) || [];
  const visited = new Set();
  const notes = [];
  let v = version;
  while (v && !visited.has(v.id)) {
    visited.add(v.id);
    const ask = v.ask || {};
    if (['write', 'another', 'rewrite', 'play'].includes(v.how)) return { how: v.how, ask, notes };
    if (v.how === 'selection' && String(ask.note || '').trim()) notes.unshift(String(ask.note));
    v = versions.find((x) => x.id === (v.from || v.base));
  }
  /* An earlier version can have been removed. An edit keeps its request,
   * so use those kept words, without guessing from a different branch. */
  const ask = (version && version.ask) || {};
  const how = ask.transcript ? 'play' : ask.direction !== undefined ? 'write'
    : ask.note !== undefined && ask.from === undefined && ask.to === undefined ? 'rewrite' : '';
  return { how, ask, notes };
}
export function passageText(passage) {
  if (!passage) return '';
  if (passage.by === 'break') return '* * *';
  const v = picked(passage);
  return v ? String(v.text || '') : '';
}
/* a passage with words on the page (a scene break, or a page that never got
 * a word, is none) */
export function hasWords(passage) {
  return Boolean(passage && passage.by !== 'break' && String((picked(passage) || {}).text || '').trim());
}

/* The words of his that set a passage going — what wakes a rule for what is
 * written from it (crafts.js wakesOn). A passage he typed is his words (one
 * brought in from a file is his book, not words for this moment; and, as
 * Cozy Tavern reads a typed move, a wall of pasted text is not read for it).
 * One the writer wrote: what he asked for in it — the premise, a rewrite's
 * note, his moves in a scene written into prose. '' when it carried none of
 * his: the writer just went on. */
const HIS_WORDS_MAX = 6000;
export function hisWordsIn(passage) {
  if (!passage || passage.by === 'break') return '';
  const shown = picked(passage) || {};
  const versions = passage.versions || [];
  const request = requestOf(passage, shown);
  const note = [request.how === 'rewrite' ? request.ask.note : '', ...request.notes].filter((x) => String(x || '').trim()).join('\n');
  if (passage.by === 'you') {
    /* brought in from a file: only a note he gave it in a rewrite is his */
    if ((versions[0] || {}).how === 'imported') return note.trim();
    /* his own words: the version on show when it is his (typed, or his
     * edit), else the one of his it was rewritten from — never a rewrite
     * the writer made of it */
    const isMine = (v) => Boolean(v && (v.how === 'mine' || v.how === 'edit' || handsOf(v).includes('you')));
    const from = versions.find((v) => v.id === (shown.from || shown.base));
    const mine = isMine(shown) ? shown : isMine(from) ? from : [...versions].reverse().find(isMine);
    const t = mine ? String(mine.text || '') : '';
    return [t.length > HIS_WORDS_MAX ? '' : t, note].map((x) => x.trim()).filter(Boolean).join('\n');
  }
  const parts = [];
  const first = versions.find((v) => v.ask && String(v.ask.direction || '').trim());
  if (first) parts.push(first.ask.direction);
  if (note) parts.push(note);
  const scene = shown.how === 'play' && shown.ask ? shown : versions.find((v) => v.how === 'play' && v.ask);
  if (scene) parts.push(scene.ask.mine || movesIn(scene.ask.transcript, scene.ask.who));
  return parts.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
}
/* his lines in a scene's transcript (talk.js transcriptOf), for a scene
 * written into prose before his own words were kept beside it */
function movesIn(transcript, who) {
  const lead = `${String(who || '').trim() || 'their character'}: `;
  return String(transcript || '').split(/\n{2,}/).filter((l) => l.startsWith(lead)).map((l) => l.slice(lead.length)).join('\n');
}
/* His words for a point in a chapter: the nearest passage at or before
 * index that carries some — the premise he is still carrying on. A passage
 * of his own is the moment itself and ends the search; so do a scene break
 * and the chapter's start, where a new scene begins. */
export function hisWordsBefore(list, index) {
  const ps = list || [];
  for (let i = Math.min(index, ps.length - 1); i >= 0; i--) {
    const p = ps[i];
    if (!p) continue;
    if (p.by === 'break') return '';
    const w = hisWordsIn(p);
    if (w || p.by === 'you') return w;
  }
  return '';
}
export function chapterText(chapter, { upto = null, from = null } = {}) {
  const list = (chapter && chapter.passages) || [];
  let a = 0, b = list.length;
  if (upto !== null) { const i = list.findIndex((p) => p.id === upto); if (i >= 0) b = i; }
  if (from !== null) { const i = list.findIndex((p) => p.id === from); if (i >= 0) a = i + 1; }
  return list.slice(a, b).map(passageText).filter((t) => t.trim()).join('\n\n');
}
/* each passage is counted once for the words it shows: the chapter list
 * counts the whole book again whenever any chapter changes — every few
 * seconds while a page streams — and only the passage that changed is
 * counted again */
const counted = new WeakMap();   /* passage -> { text, n } */
export function chapterWords(chapter) {
  let n = 0;
  for (const p of (chapter && chapter.passages) || []) {
    if (p.by === 'break') continue;
    const text = passageText(p);
    const was = counted.get(p);
    if (was && was.text === text) { n += was.n; continue; }
    const k = countWords(text);
    counted.set(p, { text, n: k });
    n += k;
  }
  return n;
}
export function chapterNumber(novel, chapterId) {
  const i = (novel.order || []).indexOf(chapterId);
  return i < 0 ? 0 : i + 1;
}
/* Each passage's number on the page, by id: 1, 2, 3… — a scene break has
 * none. The page shows them, and the partner changes a passage by its number
 * ("2.3" is passage 3 of Chapter Two). */
export function passageNumbers(chapter) {
  const out = new Map();
  let n = 0;
  for (const p of (chapter && chapter.passages) || []) if (p.by !== 'break') out.set(p.id, ++n);
  return out;
}

/* "Chapter Three", and its name when it has one */
export function chapterLabel(novel, chapter, { withName = true } = {}) {
  const n = chapterNumber(novel, chapter.id);
  const base = n ? `Chapter ${numberWords(n)}` : 'Chapter';
  return withName && chapter.name ? `${base} — ${chapter.name}` : base;
}
export function chapterPrint(chapter) {
  return hashText(chapterText(chapter));
}

/* ------------------------------------------------------- steps (novel) */

export const novelSteps = {
  touchWritten: (at) => (n) => { n.meta.written = Math.max(n.meta.written || 0, at); },
  opened: (at) => (n) => { n.meta.opened = Math.max(n.meta.opened || 0, at); },
  setMeta: (patch) => (n) => { Object.assign(n.meta, patch); },
  setField: (key, value) => (n) => { n[key] = value; },
  setPref: (key, value) => (n) => { n.prefs = n.prefs || {}; if (value === '' || value === null || value === undefined) delete n.prefs[key]; else n.prefs[key] = value; },
  counts: (words, chapters) => (n) => { n.meta.words = words; n.meta.chapters = chapters; },
  addChapter: (chapterId, afterId = null) => (n) => {
    if (n.order.includes(chapterId)) return;
    const i = afterId ? n.order.indexOf(afterId) : -1;
    if (i >= 0) n.order.splice(i + 1, 0, chapterId); else n.order.push(chapterId);
  },
  removeChapter: (chapterId) => (n) => { n.order = n.order.filter((x) => x !== chapterId); },
  moveChapter: (chapterId, toIndex) => (n) => {
    const from = n.order.indexOf(chapterId);
    if (from < 0) return;
    n.order.splice(from, 1);
    n.order.splice(Math.max(0, Math.min(toIndex, n.order.length)), 0, chapterId);
  },
  addPlay: (playId) => (n) => { n.plays = n.plays || []; if (!n.plays.includes(playId)) n.plays.unshift(playId); },
  removePlay: (playId) => (n) => { n.plays = (n.plays || []).filter((x) => x !== playId); },
  /* a card in the notes, set whole (by id) */
  putNote: (kind, card) => (n) => {
    const list = n.notes[kind] || (n.notes[kind] = []);
    const i = list.findIndex((c) => c.id === card.id);
    if (i >= 0) list[i] = card; else list.push(card);
  },
  /* A hand-edited card saves only the fields written. Replaying a refused
   * save over another window's copy must preserve its untouched fields and
   * must never recreate a card that window removed. */
  editNote: (kind, card, fields, { create = false } = {}) => {
    const words = JSON.parse(JSON.stringify(card));
    const wrote = [...new Set(fields)].filter((k) => CARD_FIELDS.includes(k) || k === 'since');
    const at = (words.updated && words.updated.at) || Date.now();
    return (n) => {
      n.notes = n.notes || {};
      const list = n.notes[kind] || (n.notes[kind] = []);
      const i = list.findIndex((c) => c.id === words.id);
      const cur = i >= 0 ? list[i] : null;
      if (!cur && !create) return false;
      const next = JSON.parse(JSON.stringify(cur || words));
      for (const field of wrote) {
        if (words[field] === undefined) delete next[field];
        else next[field] = JSON.parse(JSON.stringify(words[field]));
      }
      if (wrote.includes('name') && cur && nameKey(next.name) !== nameKey(cur.name)) next.aka = [...(next.aka || []), cur.name];
      if (wrote.includes('aka') || wrote.includes('name')) next.aka = (next.aka || []).filter((a, j, all) => nameKey(a) !== nameKey(next.name) && all.findIndex((b) => nameKey(b) === nameKey(a)) === j);
      if (wrote.includes('now')) {
        delete next.nowPid; delete next.nowAt;
        if (next.now && (words.nowAt || (n.order || []).length)) next.nowAt = words.nowAt || n.order[n.order.length - 1];
      }
      next.updated = hisStamp(cur, wrote, at);
      if (i >= 0) list[i] = next; else list.push(next);
      /* Everyone still uses the last complete notes during a rebuild. His
       * explicit corrections belong there immediately; partial helper work
       * does not. The snapshot has no memory, so this applies only once. */
      const from = n.memory && n.memory.rereadFrom;
      if (from && n.memory.undo && n.memory.undo.keep) {
        const own = newCard(kind, { id: words.id, name: words.name, updated: { at }, ...Object.fromEntries(wrote.map((k) => [k, words[k]])), ...(words.nowAt ? { nowAt: words.nowAt } : {}) });
        novelSteps.editNote(kind, own, wrote, { create: true })({ notes: from.notes || (from.notes = {}), order: n.order });
      }
      return true;
    };
  },
  dropNote: (kind, cardId) => (n) => {
    n.notes[kind] = (n.notes[kind] || []).filter((c) => c.id !== cardId);
    const from = n.memory && n.memory.rereadFrom;
    if (from && from.notes && n.memory.undo && n.memory.undo.keep) from.notes[kind] = (from.notes[kind] || []).filter((c) => c.id !== cardId);
  },
  setNotes: (notes) => (n) => { n.notes = notes; },
  /* THE BIBLIOGRAPHY (bibliography.js): an entry set whole, by id — laid
   * again over a newer copy it writes only that entry; taken out by id */
  putEntry: (entry) => (n) => {
    const e = JSON.parse(JSON.stringify(entry));
    const list = Array.isArray(n.bibliography) ? n.bibliography : (n.bibliography = []);
    const i = list.findIndex((x) => x && x.id === e.id);
    if (i >= 0) list[i] = e; else list.push(e);
  },
  dropEntry: (id) => (n) => {
    if (!Array.isArray(n.bibliography)) return false;
    const before = n.bibliography.length;
    n.bibliography = n.bibliography.filter((x) => x && x.id !== id);
    return n.bibliography.length !== before;
  },
  /* an entry put back as it was — only where it still reads as it did after (an Undo) */
  entryBack: (id, before, after) => (n) => {
    const list = Array.isArray(n.bibliography) ? n.bibliography : (n.bibliography = []);
    const i = list.findIndex((x) => x && x.id === id);
    const cur = i >= 0 ? list[i] : null;
    if (JSON.stringify(cur) !== JSON.stringify(after || null)) return false;
    if (!before) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = JSON.parse(JSON.stringify(before));
    else list.push(JSON.parse(JSON.stringify(before)));
    return true;
  },
  /* the helper's changes, card by card, by id: a card set to how it read
   * after, or taken out when it is gone after — only where it still reads as
   * it did when the change was made (Cozy Tavern's M680-5: a step laid again
   * over a newer copy never writes over his edit made meanwhile) */
  applyCards: (cards) => (n) => {
    n.notes = n.notes || {};
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    for (const c of cards) {
      const list = n.notes[c.kind] || (n.notes[c.kind] = []);
      const i = list.findIndex((x) => x.id === c.id);
      const cur = i >= 0 ? list[i] : null;
      if (!same(cur, c.before)) continue;
      if (!c.after) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = JSON.parse(JSON.stringify(c.after));
      else list.push(JSON.parse(JSON.stringify(c.after)));
    }
  },
  /* a reading put back: each card it touched goes back to how it read before —
   * unless he changed it since (then his stays), or took it out (it stays out) */
  undoCards: (cards) => (n) => {
    n.notes = n.notes || {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const c of [...cards].reverse()) {
      const list = n.notes[c.kind] || (n.notes[c.kind] = []);
      const i = list.findIndex((x) => x.id === c.id);
      const cur = i >= 0 ? list[i] : null;
      if (!c.before) { if (cur && same(cur, c.after)) list.splice(i, 1); }
      else if (!c.after) { if (!cur) list.push(JSON.parse(JSON.stringify(c.before))); }
      else if (cur && same(cur, c.after)) list[i] = JSON.parse(JSON.stringify(c.before));
    }
  },
  /* cards moved by id, each only where it still reads as it did (readings.js):
   * a version's notes taken back out, or laid on again — never over a card
   * changed meanwhile */
  moveCards: (moves) => (n) => {
    n.notes = n.notes || {};
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    for (const m of moves || []) {
      const list = n.notes[m.kind] || (n.notes[m.kind] = []);
      const i = list.findIndex((x) => x.id === m.id);
      const cur = i >= 0 ? list[i] : null;
      if (!same(cur, m.from)) continue;
      if (!m.to) { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = JSON.parse(JSON.stringify(m.to));
      else list.push(JSON.parse(JSON.stringify(m.to)));
    }
  },
  /* what the helper keeps of the book, moved the same way */
  moveKept: (moves) => (n) => {
    n.kept = { ...(n.kept || {}) };
    const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
    for (const m of moves || []) {
      if (!same(n.kept[m.key], m.from)) continue;
      if (m.to) n.kept[m.key] = JSON.parse(JSON.stringify(m.to)); else delete n.kept[m.key];
    }
  },
  /* what one reading of one version of a passage changed (readings.js) */
  /* one version's reading; the one it had of its earlier words, changed in place since (a fix, his edit, Go on),
   * kept beside it — the last few (readings.js readingAt) */
  putReading: (pid, vid, reading) => (n) => {
    n.memory = n.memory || {};
    const all = n.memory.readings || (n.memory.readings = {});
    const was = all[pid] && all[pid][vid];
    const next = JSON.parse(JSON.stringify(reading));
    delete next.prior;
    const older = was ? [...(was.sig !== next.sig ? [(({ prior, ...x }) => x)(was)] : []), ...(Array.isArray(was.prior) ? was.prior : [])] : [];
    const prior = older.filter((x, i) => x && x.sig !== next.sig && older.findIndex((y) => y && y.sig === x.sig) === i).slice(0, PRIOR_KEEP);
    if (prior.length) next.prior = JSON.parse(JSON.stringify(prior));
    all[pid] = { ...(all[pid] || {}), [vid]: next };
  },
  dropReadings: (list) => (n) => {
    const all = n.memory && n.memory.readings;
    if (!all) return;
    for (const [pid, vid] of list || []) {
      if (!all[pid]) continue;
      if (vid === '*') delete all[pid];
      else { delete all[pid][vid]; if (!Object.keys(all[pid]).length) delete all[pid]; }
    }
  },
  setMemory: (patch) => (n) => { n.memory = { ...(n.memory || {}), ...patch }; },
  /* a name changed everywhere, kept for a little while: work asked before it
   * (a page on its way, a reading) is given the new name when it lands */
  noteRenames: (pairs, at) => (n) => {
    n.memory = n.memory || {};
    n.memory.renames = [...(n.memory.renames || []), ...pairs.map((x) => ({ from: x.from, to: x.to, at }))].filter((x) => at - x.at < 3600000).slice(-20);
  },
  /* what the helper's model would not read, set aside with why (archivist.js) */
  setAside: (entries) => (n) => { n.memory = n.memory || {}; n.memory.aside = { ...(n.memory.aside || {}), ...entries }; },
  dropAside: (keys) => (n) => { if (!n.memory || !n.memory.aside) return; for (const k of keys || []) delete n.memory.aside[k]; },
  /* one more reading since the notes were last checked against the book —
   * what that check found kept with it */
  readSinceCheck: () => (n) => {
    n.memory = n.memory || {};
    const a = n.memory.audit || null;
    n.memory.audit = { ...(a || {}), at: a ? a.at || 0 : Date.now(), reads: ((a && a.reads) || 0) + 1 };
  },
  /* What it's about / How it reads: Manual or Automatic, and what the helper keeps */
  setAuto: (key, on) => (n) => { n.auto = { ...(n.auto || {}), [key]: Boolean(on) }; },
  setKept: (key, value) => (n) => { n.kept = { ...(n.kept || {}) }; if (value) n.kept[key] = value; else delete n.kept[key]; },
  seen: (chapterId, map) => (n) => { n.memory = n.memory || {}; n.memory.seen = { ...(n.memory.seen || {}), [chapterId]: map }; },
  forgetChapterSeen: (chapterId) => (n) => { if (n.memory && n.memory.seen) delete n.memory.seen[chapterId]; },
  pushRemoved: (entry) => (n) => {
    n.memory = n.memory || {};
    const list = n.memory.removed || (n.memory.removed = []);
    if (!list.some((x) => x.id === entry.id)) list.push(entry);
  },
  clearRemoved: (ids) => (n) => { if (n.memory && n.memory.removed) n.memory.removed = n.memory.removed.filter((x) => !ids.includes(x.id)); },
};

/* ----------------------------------------------------- steps (chapter) */

function findPassage(c, pid) { return (c.passages || []).find((p) => p.id === pid); }
function findVersion(p, vid) { return p && (p.versions || []).find((v) => v.id === vid); }
/* Go on keeps the version's id while changing its words. A comparison
 * belongs to the words it read, including when its save is replayed. */
/* (head to head reads the writers' own words — a fix put in since does not undo it) */
export function duelMatches(p, row) {
  if (!p || !row) return false;
  const x = findVersion(p, row.x), y = findVersion(p, row.y);
  return Boolean(x && y && (!row.xSig || row.xSig === hashText(writtenOf(x))) && (!row.ySig || row.ySig === hashText(writtenOf(y))));
}

/* What the checker kept for a passage or its versions, put aside when they
 * went (pruneChecks), back with them: only for versions there again, never
 * over what was found since */
function checksBack(c, pid) {
  const g = c.checksGone && c.checksGone[pid];
  const p = findPassage(c, pid);
  if (!g || !p) return;
  for (const [vid, e] of Object.entries(g.checks || {})) {
    if (!findVersion(p, vid)) continue;
    c.checks = c.checks || {};
    c.checks[pid] = c.checks[pid] || {};
    if (!c.checks[pid][vid]) c.checks[pid][vid] = e;
    delete g.checks[vid];
  }
  if (g.left) { c.checksLeft = c.checksLeft || {}; c.checksLeft[pid] = [...(c.checksLeft[pid] || []), ...g.left.filter((x) => !(c.checksLeft[pid] || []).some((y) => y.find === x.find && y.replace === x.replace))]; g.left = null; }
  for (const [key, d] of Object.entries(g.duels || {})) {
    if (!duelMatches(p, d)) continue;
    c.duels = c.duels || {};
    if (!c.duels[key]) c.duels[key] = d;
    delete g.duels[key];
  }
  if (!Object.keys(g.checks || {}).length && !g.left && !Object.keys(g.duels || {}).length) delete c.checksGone[pid];
}

export const chapterSteps = {
  setName: (name, by) => (c) => { c.name = name; c.nameBy = by; },
  /* add a passage after another (or at the end), if it is not there yet */
  addPassage: (passage, afterId = null) => (c) => {
    if (findPassage(c, passage.id)) return;
    const copy = JSON.parse(JSON.stringify(passage));
    if (afterId === '^') c.passages.unshift(copy);
    else {
      const i = afterId ? c.passages.findIndex((p) => p.id === afterId) : -1;
      if (i >= 0) c.passages.splice(i + 1, 0, copy); else c.passages.push(copy);
    }
    checksBack(c, copy.id);
  },
  removePassage: (pid) => (c) => { c.passages = c.passages.filter((p) => p.id !== pid); },
  /* a new version on a passage (if not there yet), shown — knowing the one
   * that was on show when it came (`was`): if it goes unkept (nothing came,
   * Stop before a word, its writer's window closed, an Undo), that one is on
   * show again, never simply the newest (Cozy Tavern M364). show false: what
   * the app writes by itself is written off the page — the words he is
   * reading stay on show until it is done (his report, 2.12.3: "blinking and
   * jagged and flashing") */
  addVersion: (pid, version, { show = true } = {}) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    if (!findVersion(p, version.id)) {
      const shown = picked(p);
      const copy = JSON.parse(JSON.stringify(version));
      /* (a copy of another version brings that one's `was`: this one's is the version on show now) */
      if (shown) copy.was = shown.id; else delete copy.was;
      p.versions.push(copy);
      if (!show && shown) return;
    }
    p.pick = p.versions.findIndex((v) => v.id === version.id);
  },
  /* fields of one version set to these values */
  setVersion: (pid, vid, patch) => (c) => {
    const v = findVersion(findPassage(c, pid), vid);
    if (!v) return;
    for (const [k, val] of Object.entries(patch)) { if (val === undefined) delete v[k]; else v[k] = val; }
  },
  /* versions taken out put back (Undo): in their places, the one that was on show on show again;
   * a version made since stays, after them */
  putVersionsBack: (pid, versions, shownId) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    const now = new Map(p.versions.map((v) => [v.id, v]));
    const back = versions.map((v) => now.get(v.id) || JSON.parse(JSON.stringify(v)));
    const since = p.versions.filter((v) => !versions.some((x) => x.id === v.id));
    p.versions = [...back, ...since];
    const i = p.versions.findIndex((v) => v.id === shownId);
    if (i >= 0) p.pick = i;
    checksBack(c, pid);
  },
  removeVersion: (pid, vid) => (c) => {
    const p = findPassage(c, pid);
    if (!p || p.versions.length < 2) return;
    const shown = picked(p);
    const gone = findVersion(p, vid);
    p.versions = p.versions.filter((v) => v.id !== vid);
    const back = gone && gone.was ? p.versions.findIndex((v) => v.id === gone.was) : -1;
    const keep = shown && shown.id !== vid ? p.versions.findIndex((v) => v.id === shown.id) : back >= 0 ? back : p.versions.length - 1;
    p.pick = Math.max(0, keep);
  },
  /* one version's words put on another of the same passage, and the one gone (inplace.js foldVersion): the other
   * takes the patch, whatever was made from the one gone is made from the other, what was on show stays on show
   * (the other, where it was the one gone), and what the checker found in its words is the other's now */
  foldVersion: (pid, childId, targetId, patch) => (c) => {
    const p = findPassage(c, pid);
    const child = findVersion(p, childId);
    const target = findVersion(p, targetId);
    if (!child || !target || childId === targetId) return;
    const shown = picked(p);
    for (const [k, val] of Object.entries(patch)) { if (val === undefined) delete target[k]; else target[k] = val; }
    for (const v of p.versions) {
      if (v.from === childId) v.from = targetId;
      if (v.base === childId) v.base = targetId;
      if (v.was === childId) v.was = targetId;
    }
    if (child.chosen && (!shown || shown.id === childId)) target.chosen = child.chosen;
    p.versions = p.versions.filter((v) => v.id !== childId);
    const keepId = shown && shown.id !== childId ? shown.id : targetId;
    p.pick = Math.max(0, p.versions.findIndex((v) => v.id === keepId));
    const byV = c.checks && c.checks[pid];
    if (byV) {
      const sig = hashText(String(target.text || ''));
      if (byV[childId] && byV[childId].sig === sig) byV[targetId] = byV[childId];
      else if (byV[targetId] && byV[targetId].sig !== sig) delete byV[targetId];
      delete byV[childId];
    }
    for (const [k, d] of Object.entries(c.duels || {})) if (d && d.pid === pid && (d.x === childId || d.y === childId)) delete c.duels[k];
    for (const r of c.retired || []) if (r && r.key === `${pid}:${childId}`) r.key = `${pid}:${targetId}`;
  },
  pick: (pid, vid) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    const i = p.versions.findIndex((v) => v.id === vid);
    if (i >= 0) p.pick = i;
  },
  /* put on show by his own hand (the arrows, or the one on show removed): his choice, kept on the version —
   * nothing the checker does by itself starts from it (checker.js autoAfter) */
  choose: (pid, vid, at = Date.now()) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    const i = p.versions.findIndex((v) => v.id === vid);
    if (i < 0) return;
    p.pick = i;
    p.versions[i].chosen = at;
  },
  /* move a passage to another place in the same chapter */
  movePassage: (pid, afterId) => (c) => {
    const i = c.passages.findIndex((p) => p.id === pid);
    if (i < 0) return;
    const [p] = c.passages.splice(i, 1);
    if (afterId === '^') { c.passages.unshift(p); return; }
    const j = afterId ? c.passages.findIndex((x) => x.id === afterId) : -1;
    if (j >= 0) c.passages.splice(j + 1, 0, p); else c.passages.push(p);
  },
  setSummary: (summary) => (c) => { c.summary = summary; },
  /* the summaries of the chapter as it read before (each by its words'
   * fingerprint): a version brought back brings its summary back too */
  clearSummaries: () => (c) => { c.summaries = []; },
  dropSummary: (fp) => (c) => { c.summaries = (c.summaries || []).filter((x) => x.fp !== fp); },
  /* his plan for the chapter (the story map): empty takes it away */
  setPlan: (text) => (c) => { const t = String(text || '').trim(); if (t) c.plan = String(text).replace(/\s+$/, ''); else delete c.plan; },
  /* the chapter's stretches (stretches.js): their bounds, and each one's summary while it fits its words */
  setStretches: (list) => (c) => { if (Array.isArray(list) && list.length) c.stretches = JSON.parse(JSON.stringify(list)); else delete c.stretches; },
  keepSummary: (entry) => (c) => {
    const list = (c.summaries = (c.summaries || []).filter((x) => x.fp !== entry.fp));
    list.push(JSON.parse(JSON.stringify(entry)));
    if (list.length > 6) list.splice(0, list.length - 6);
  },
  retire: (entry) => (c) => {
    c.retired = c.retired || [];
    if (!c.retired.some((x) => x.key === entry.key)) c.retired.push(entry);
  },
  clearRetired: (keys) => (c) => { c.retired = (c.retired || []).filter((x) => !keys.includes(x.key)); },
  /* passages from here on go out (to a new chapter) */
  cutFrom: (pid) => (c) => {
    const i = c.passages.findIndex((p) => p.id === pid);
    if (i >= 0) c.passages = c.passages.slice(0, i);
  },
  setPassages: (passages) => (c) => { c.passages = passages; },
  /* what the checker found in one version of a passage (checker.js) — kept
   * only while that version still reads as it did when it was checked */
  setCheck: (pid, vid, entry) => (c) => {
    const p = findPassage(c, pid);
    const v = p && findVersion(p, vid);
    if (!v || hashText(String(v.text || '')) !== entry.sig) return;
    c.checks = c.checks || {};
    c.checks[pid] = c.checks[pid] || {};
    c.checks[pid][vid] = JSON.parse(JSON.stringify(entry));
  },
  /* one suggestion let go; one he left as it is (remember) is never offered
   * for that passage again — the same words, the same change */
  dropSuggestion: (pid, vid, itemId, { remember = false } = {}) => (c) => {
    const e = c.checks && c.checks[pid] && c.checks[pid][vid];
    if (!e) return;
    const item = (e.items || []).find((x) => x.id === itemId);
    e.items = (e.items || []).filter((x) => x.id !== itemId);
    if (!item || !remember) return;
    c.checksLeft = c.checksLeft || {};
    const list = (c.checksLeft[pid] = c.checksLeft[pid] || []);
    const replace = typeof item.replace === 'string' ? item.replace : null;
    if (!list.some((x) => x.find === item.find && x.replace === replace)) list.push({ find: item.find, replace });
    /* past sixty, what can never be offered again goes — words no version of
     * the passage holds any more — never the oldest he left (Cozy Tavern
     * M559: a cap that lets the oldest go brings them back) */
    if (list.length > 60) {
      const p = findPassage(c, pid);
      const texts = ((p && p.versions) || []).map((v) => String(v.text || ''));
      c.checksLeft[pid] = list.filter((x) => texts.some((t) => t.includes(x.find)));
      if (c.checksLeft[pid].length > 600) c.checksLeft[pid].splice(0, c.checksLeft[pid].length - 600);
    }
  },
  /* the judge's head to head of two versions of one passage (checker.js) —
   * kept while both versions are there */
  setDuel: (key, row) => (c) => {
    const p = findPassage(c, row.pid);
    if (!duelMatches(p, row)) return;
    c.duels = c.duels || {};
    c.duels[key] = JSON.parse(JSON.stringify(row));
  },
  /* what was kept for passages and versions no longer in the chapter goes —
   * kept aside a while (checksGone), so an Undo that brings the passage or
   * its versions back brings back what the checker found, what he left and
   * the head to head with them (Cozy Tavern M578: removal and undo whole) */
  pruneChecks: (now = Date.now()) => (c) => {
    const gone = (c.checksGone = c.checksGone || {});
    /* the two days count from the newest thing kept aside for the passage */
    const stash = (pid) => { const g = (gone[pid] = gone[pid] && typeof gone[pid] === 'object' ? gone[pid] : { checks: {}, left: null, duels: {} }); g.checks = g.checks || {}; g.duels = g.duels || {}; g.at = now; return g; };
    for (const pid of Object.keys(c.checksLeft || {})) if (!findPassage(c, pid)) { stash(pid).left = c.checksLeft[pid]; delete c.checksLeft[pid]; }
    for (const [key, d] of Object.entries(c.duels || {})) {
      const p = d && findPassage(c, d.pid);
      if (!p || !findVersion(p, d.x) || !findVersion(p, d.y)) { if (d && d.pid) stash(d.pid).duels[key] = d; delete c.duels[key]; }
      else if (!duelMatches(p, d)) delete c.duels[key];
    }
    for (const pid of Object.keys(c.checks || {})) {
      const p = findPassage(c, pid);
      for (const vid of Object.keys(c.checks[pid])) if (!p || !findVersion(p, vid)) { stash(pid).checks[vid] = c.checks[pid][vid]; delete c.checks[pid][vid]; }
      if (!Object.keys(c.checks[pid]).length) delete c.checks[pid];
    }
    /* kept two days, forty passages at most */
    for (const k of Object.keys(gone)) if (!gone[k] || typeof gone[k] !== 'object') delete gone[k];
    const keys = Object.keys(gone).filter((k) => now - (gone[k].at || 0) < 2 * 86400000).sort((a, b) => (gone[b].at || 0) - (gone[a].at || 0)).slice(0, 40);
    for (const k of Object.keys(gone)) if (!keys.includes(k)) delete gone[k];
  },
  /* the checker's entry for one version let go (Check it again) */
  dropCheck: (pid, vid) => (c) => {
    if (!c.checks || !c.checks[pid]) return;
    delete c.checks[pid][vid];
    if (!Object.keys(c.checks[pid]).length) delete c.checks[pid];
  },
  /* he asked for the whole chapter to be checked, older passages too */
  checkAll: () => (c) => { c.checkAll = true; },
};

/* ----------------------------------------------------- turns (talk, play) */

export function newTurn(by, text = '', fields = {}) {
  return { id: newId('t'), by, pick: 0, versions: [newVersion({ text, ...fields })] };
}
export const turnSteps = {
  addTurn: (turn) => (d) => { d.turns = d.turns || []; if (!d.turns.some((t) => t.id === turn.id)) d.turns.push(JSON.parse(JSON.stringify(turn))); },
  removeTurn: (tid) => (d) => { d.turns = (d.turns || []).filter((t) => t.id !== tid); },
  removeFrom: (tid) => (d) => { const i = (d.turns || []).findIndex((t) => t.id === tid); if (i >= 0) d.turns = d.turns.slice(0, i); },
  addVersion: (tid, version) => (d) => {
    const t = (d.turns || []).find((x) => x.id === tid);
    if (!t) return;
    if (!t.versions.some((v) => v.id === version.id)) {
      const shown = picked(t);
      const copy = JSON.parse(JSON.stringify(version));
      if (shown) copy.was = shown.id; else delete copy.was;
      t.versions.push(copy);
    }
    t.pick = t.versions.findIndex((v) => v.id === version.id);
  },
  setVersion: (tid, vid, patch) => (d) => {
    const t = (d.turns || []).find((x) => x.id === tid);
    const v = t && t.versions.find((x) => x.id === vid);
    if (!v) return;
    for (const [k, val] of Object.entries(patch)) { if (val === undefined) delete v[k]; else v[k] = val; }
  },
  pick: (tid, vid) => (d) => {
    const t = (d.turns || []).find((x) => x.id === tid);
    if (!t) return;
    const i = t.versions.findIndex((v) => v.id === vid);
    if (i >= 0) t.pick = i;
  },
  removeVersion: (tid, vid) => (d) => {
    const t = (d.turns || []).find((x) => x.id === tid);
    if (!t || t.versions.length < 2) return;
    const shown = picked(t);
    const gone = t.versions.find((v) => v.id === vid);
    t.versions = t.versions.filter((v) => v.id !== vid);
    const back = gone && gone.was ? t.versions.findIndex((v) => v.id === gone.was) : -1;
    const keep = shown && shown.id !== vid ? t.versions.findIndex((v) => v.id === shown.id) : back >= 0 ? back : t.versions.length - 1;
    t.pick = Math.max(0, keep);
  },
  set: (patch) => (d) => { Object.assign(d, patch); },
};

/* A book's words and chapters, counted from its chapters. */
export function countBook(novel, chapters) {
  let words = 0;
  for (const id of novel.order || []) words += chapterWords(chapters[id]);
  return { words, chapters: (novel.order || []).length };
}

/* Notes cards */
export function newCard(kind, fields = {}) {
  return { id: newId(kind.slice(0, 2)), name: '', about: '', ...(kind === 'people' ? { aka: [], ties: '', now: '' } : {}), ...(kind === 'threads' ? { open: true } : {}), ...fields };
}
/* WHAT OF A CARD IS HIS (Cozy Tavern's M263: his hand is kept field by
 * field). A card he wrote or changed is his — never taken out, his words
 * never written over — but only in the fields he wrote: the helper and the
 * notes' check still write the rest as the book goes on. A card marked his
 * before fields were told apart is his whole. */
export const CARD_FIELDS = ['name', 'aka', 'about', 'ties', 'now', 'open'];
export const hisCard = (card) => Boolean(card && card.updated && card.updated.by === 'you');
export function hisField(card, field) {
  if (!hisCard(card)) return false;
  const list = card.updated.his;
  return !Array.isArray(list) || list.includes(field);
}
/* his mark once he (or his partner, for him) wrote these fields */
export function hisStamp(card, fields, at = Date.now()) {
  if (hisCard(card) && !Array.isArray(card.updated.his)) return { by: 'you', at };
  const before = hisCard(card) ? card.updated.his : [];
  return { by: 'you', at, his: CARD_FIELDS.filter((k) => before.includes(k) || (fields || []).includes(k)) };
}
/* his mark without one field (the book, changed by him, is his newer word for it — archivist foldNotes, 2.12.10) */
export function letGoStamp(updated, field, chapterId, at) {
  const list = Array.isArray(updated && updated.his) ? updated.his : CARD_FIELDS;
  const his = list.filter((k) => k !== field);
  return his.length ? { by: 'you', his, chapterId, at } : { chapterId, at };
}
/* WORDS HE CHANGED HIMSELF (2.12.10): a passage written again from his note or
 * his partner's (never the app's own lift), the words he selected written again
 * (never the checker's by itself), his partner's own passage, his own words, or
 * his hand or his partner's on the page. A card he wrote is held against these:
 * where they say the opposite of his words, the book is his newer word. The
 * writer's fresh page, a scene's prose and the app's own fixes are not his — a
 * slip in them is the checker's to catch, never a reason to change his card. */
export const hisChange = (v) => Boolean(v) && ((v.how === 'rewrite' && !v.lift) || (v.how === 'selection' && !v.spanAuto) || v.how === 'partner' || v.how === 'mine' || mixedHands(v));
/* the mark a card keeps when the helper writes what is not his */
export function keptStamp(card, chapterId, at) {
  if (!hisCard(card)) return { chapterId, at };
  return { by: 'you', ...(Array.isArray(card.updated.his) ? { his: [...card.updated.his] } : {}), chapterId, at };
}

/* A THREAD IS FOUND BY SENSE (Cozy Tavern M259, M653): two titles say the
 * same thing when every telling word of the shorter is in the longer, and the
 * shorter has two at least; a word is its stem (promise, promised, promises).
 * A share of the words is not enough ("Claire Stone" is not "Alaric Stone"),
 * and a title of names alone says only who — the same thread only as the very
 * same names. */
const THREAD_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'hers', 'their', 'about', 'into', 'over', 'will', 'what', 'who', 'was', 'are', 'has', 'have', 'had', 'its', 'not', 'but', 'out', 'off', 'onto', 'upon', 'after', 'before', 'him', 'she', 'they', 'them']);
function titleWords(t) {
  const all = new Set();
  const common = new Set();
  /* the names, in the order the title gives them (whose vow, to whom) */
  const caps = [];
  const tokens = String(t || '').replace(/[‘’´`]/g, "'").replace(/'s\b/gi, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/);
  for (const raw of tokens) {
    const low = raw.toLowerCase();
    if (low.length <= 2 || THREAD_STOP.has(low)) continue;
    let w = low;
    if (w.length > 4) w = w.replace(/(?:ing|ed|es|s)$/, '');
    if (w.length > 4) w = w.replace(/e$/, '');
    all.add(w);
    if (raw[0] === raw[0].toLowerCase()) common.add(w);
    else if (!caps.includes(w)) caps.push(w);
  }
  return { all, common, caps };
}
/* Two titles are one thread when the shorter's telling words all stand in the
 * longer and cover four-fifths of it at least (Cozy Tavern M522: "Who killed
 * the king" is not "Who killed the king's guard"), and the people both name
 * come in the same order (M738: "Jovan's vow to protect Yuki" is not "Yuki's
 * vow to protect Jovan"). */
/* one title's telling words all in the other's, at any coverage: it may be
 * the same thread, or a narrower or wider one — never written on as the same */
export function threadsNear(a, b) {
  const x = titleWords(a);
  const y = titleWords(b);
  const [short, long] = x.all.size <= y.all.size ? [x, y] : [y, x];
  if (short.all.size < 2) return false;
  for (const w of short.all) if (!long.all.has(w)) return false;
  return true;
}
export function sameThreadTitle(a, b) {
  const x = titleWords(a);
  const y = titleWords(b);
  const [short, long] = x.all.size <= y.all.size ? [x, y] : [y, x];
  if (short.all.size < 2) return false;
  for (const w of short.all) if (!long.all.has(w)) return false;
  if (short.all.size < long.all.size * 0.8) return false;
  const shared = x.caps.filter((w) => y.caps.includes(w));
  if (shared.length >= 2 && shared.join(' ') !== y.caps.filter((w) => shared.includes(w)).join(' ')) return false;
  if (!short.common.size) return short.all.size === long.all.size;
  return true;
}
const sameWords = (a, b) => { const x = titleWords(a).all; const y = titleWords(b).all; return x.size === y.size && [...x].every((w) => y.has(w)); };

/* The card a name means (Cozy Tavern's lessons: a name matched loosely takes
 * the first card that shares it and writes on the wrong one, M584/M600/M607;
 * one person on two cards, M405/M414): the card called that comes first, then
 * the one that also goes by it, then the one whose name is among the other
 * names given with it, then — for a person — the one whose name is a short or
 * fuller form of it (Rias for Rias Wells, Captain Hitsugaya for Toshiro
 * Hitsugaya), for a place or a thing the one called the same but for a
 * leading "the", and last a person's name with a slip of the pen in it.
 * Past the first, a name two cards answer to means neither: `ambiguous`, and
 * nothing is written. */
export function matchCard(cards, name, aka = [], { kind = '', near = true, slip: slipOk = true } = {}) {
  const k = nameKey(name);
  if (!k) return { card: null, ambiguous: false };
  const list = cards || [];
  const exact = list.find((c) => nameKey(c.name) === k);
  if (exact) return { card: exact, ambiguous: false };
  const one = (found, how = '') => (found.length === 1 ? { card: found[0], ambiguous: false, ...(how ? { how } : {}) } : found.length > 1 ? { card: null, ambiguous: true, among: found } : null);
  /* for a reading's row about a person (Cozy Tavern M752): a description a
   * card was once known by is the record of how it was named, never a name a
   * new row answers to — another courier forty pages on is another courier;
   * and another name a card goes by answers only when no other card answers
   * to it by its own name too */
  const loose = near && kind === 'people';
  const byAkaList = list.filter((c) => (c.aka || []).some((a) => nameKey(a) === k && !(loose && isDescriptorName(a))));
  const alsoOwn = loose && byAkaList.length === 1 && !isDescriptorName(name) ? list.filter((c) => c !== byAkaList[0] && (samePersonName(c.name, name) || nearName(c.name, name))) : [];
  if (alsoOwn.length) return { card: null, ambiguous: true, among: [byAkaList[0], ...alsoOwn] };
  const byAka = one(byAkaList);
  if (byAka) return byAka;
  const others = (aka || []).map(nameKey).filter(Boolean);
  const byOthers = others.length ? one(list.filter((c) => others.includes(nameKey(c.name)))) : null;
  if (byOthers) return byOthers;
  /* a description is no person's name ("the girl"); a place or a thing may be called "The …" */
  const named = (n) => n && (kind !== 'people' || !isDescriptorName(n));
  const forms = [name, ...(aka || [])].filter(named);
  const namesOf = (c) => [c.name, ...(c.aka || [])].filter(named);
  /* a short or fuller form only where it is asked for: the helper's rows — never a change he made through the partner, which names its card exactly */
  /* (a place or a thing: its owner's possessive set aside — "Bruce's Batwing" is the Batwing) */
  const sameAs = (n, f) => (kind === 'people' ? samePersonName(n, f) : kind === 'places' || kind === 'lore' ? sameThingName(n, f) : plainName(n) === plainName(f));
  const close = near && forms.length ? one(list.filter((c) => namesOf(c).some((n) => forms.some((f) => sameAs(n, f))))) : null;
  if (close) return close;
  /* a thread in other words, for a reading's row: the one that says it in
   * the very same words when several answer; if they are all copies of one
   * thread, the oldest; threads that are not each other's copies both
   * answering mean neither (Cozy Tavern M653) */
  if (near && kind === 'threads') {
    const hits = list.filter((c) => [c.name, ...(c.aka || [])].some((n) => [name, ...(aka || [])].some((f) => sameThreadTitle(n, f))));
    if (hits.length === 1) return { card: hits[0], ambiguous: false };
    if (hits.length > 1) {
      const very = hits.filter((c) => sameWords(c.name, name));
      if (very.length === 1) return { card: very[0], ambiguous: false };
      if (hits.every((a) => hits.every((b) => a === b || sameThreadTitle(a.name, b.name)))) return { card: hits[0], ambiguous: false };
      return { card: null, ambiguous: true, among: hits };
    }
  }
  /* a slip of the pen, for a person only: one long word of the name a letter
   * off (Cozy Tavern M646) — `how: 'slip'`, so the slip is never kept as a
   * name the card goes by */
  const slip = loose && slipOk && forms.length ? one(list.filter((c) => namesOf(c).some((n) => forms.some((f) => nearName(n, f)))), 'slip') : null;
  return slip || { card: null, ambiguous: false };
}
export function findCard(cards, name, aka = [], opts = {}) { return matchCard(cards, name, aka, opts).card; }

/* The cards a name takes out: only those called exactly that — never one that
 * merely also goes by it, which is a card the name was folded into. */
export function cardsCalled(cards, name) {
  const k = nameKey(name);
  return k ? (cards || []).filter((c) => nameKey(c.name) === k) : [];
}

/* Whether a card's name still stands in the book as it stands (`folded`:
 * foldedText of the book's words): a person by the whole name or a word of it
 * that names someone, a place by its whole name; a description ("the girl")
 * and a thing or a thread (their names are descriptions) never. */
export function cardStands(kind, card, folded) {
  if (!card || !folded) return false;
  if (kind === 'people') return !isDescriptorName(card.name) && nameInText(folded, card.name);
  if (kind === 'places') return nameInText(folded, card.name, { words: false });
  /* a thing with a name of its own (the Batwing, the Hollow Crown) stands while the book names it (Cozy Tavern M752) — a description ("the letter") never */
  if (kind === 'lore') { const bare = String(card.name || '').trim().replace(/^(?:the|a|an)\s+/i, ''); return /\p{Lu}/u.test(bare) && nameInText(folded, bare, { words: false }); }
  return false;
}
/* The cards that carry a card's name — the one it was folded into */
export function carriersOf(kind, card, cards) {
  return (cards || []).filter((o) => o.id !== card.id && [o.name, ...(o.aka || [])].some((n) => (kind === 'people' ? samePersonName(n, card.name) : kind === 'places' || kind === 'lore' ? sameThingName(n, card.name) : plainName(n) === plainName(card.name))));
}
export function carriedBy(kind, card, cards) { return carriersOf(kind, card, cards).length > 0; }
