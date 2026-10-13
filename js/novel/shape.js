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
 *             book as it stands (by 'you' once he corrected it)
 *   chapter { id, novelId, name, nameBy, passages:[passage], summary, retired:[] }
 *   passage { id, by:'ai'|'you'|'break', pick, versions:[version] }
 *   version { id, text, at, how, ask, conn, model, thinking, cut, stopped, notes, usage, ms, sent, streaming }
 *   talk    { id:novelId, novelId, turns:[turn] }          the partner
 *   play    { id, novelId, title, who, from, chapterId, turns:[turn], turned, created, updated }
 *   draft   { id:novelId, novelId, direction, partner, play:{} }
 */

import { newId, countWords, hashText, numberWords } from '../util.js';

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

export function coverFor(title) {
  const h = parseInt(hashText(title).slice(0, 6), 36) || 0;
  return COVERS[h % COVERS.length];
}

export function newVersion(fields = {}) {
  return { id: newId('v'), text: '', at: Date.now(), ...fields };
}

export function newPassage(by, text = '', fields = {}) {
  return { id: newId('p'), by, pick: 0, versions: [newVersion({ text, how: by === 'you' ? 'mine' : by, ...fields })] };
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
export function passageText(passage) {
  if (!passage) return '';
  if (passage.by === 'break') return '* * *';
  const v = picked(passage);
  return v ? String(v.text || '') : '';
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
  dropNote: (kind, cardId) => (n) => { n.notes[kind] = (n.notes[kind] || []).filter((c) => c.id !== cardId); },
  setNotes: (notes) => (n) => { n.notes = notes; },
  /* the helper's changes, card by card, by id: a card set to how it read
   * after, or taken out when it is gone after */
  applyCards: (cards) => (n) => {
    n.notes = n.notes || {};
    for (const c of cards) {
      const list = n.notes[c.kind] || (n.notes[c.kind] = []);
      const i = list.findIndex((x) => x.id === c.id);
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
  setMemory: (patch) => (n) => { n.memory = { ...(n.memory || {}), ...patch }; },
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

export const chapterSteps = {
  setName: (name, by) => (c) => { c.name = name; c.nameBy = by; },
  /* add a passage after another (or at the end), if it is not there yet */
  addPassage: (passage, afterId = null) => (c) => {
    if (findPassage(c, passage.id)) return;
    const copy = JSON.parse(JSON.stringify(passage));
    if (afterId === '^') { c.passages.unshift(copy); return; }
    const i = afterId ? c.passages.findIndex((p) => p.id === afterId) : -1;
    if (i >= 0) c.passages.splice(i + 1, 0, copy); else c.passages.push(copy);
  },
  removePassage: (pid) => (c) => { c.passages = c.passages.filter((p) => p.id !== pid); },
  /* a new version on a passage (if not there yet), shown */
  addVersion: (pid, version) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    if (!findVersion(p, version.id)) p.versions.push(JSON.parse(JSON.stringify(version)));
    p.pick = p.versions.findIndex((v) => v.id === version.id);
  },
  /* fields of one version set to these values */
  setVersion: (pid, vid, patch) => (c) => {
    const v = findVersion(findPassage(c, pid), vid);
    if (!v) return;
    for (const [k, val] of Object.entries(patch)) { if (val === undefined) delete v[k]; else v[k] = val; }
  },
  removeVersion: (pid, vid) => (c) => {
    const p = findPassage(c, pid);
    if (!p || p.versions.length < 2) return;
    const shown = picked(p);
    p.versions = p.versions.filter((v) => v.id !== vid);
    const keep = shown && shown.id !== vid ? p.versions.findIndex((v) => v.id === shown.id) : p.versions.length - 1;
    p.pick = Math.max(0, keep);
  },
  pick: (pid, vid) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    const i = p.versions.findIndex((v) => v.id === vid);
    if (i >= 0) p.pick = i;
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
    if (!t.versions.some((v) => v.id === version.id)) t.versions.push(JSON.parse(JSON.stringify(version)));
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
    t.versions = t.versions.filter((v) => v.id !== vid);
    const keep = shown && shown.id !== vid ? t.versions.findIndex((v) => v.id === shown.id) : t.versions.length - 1;
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
