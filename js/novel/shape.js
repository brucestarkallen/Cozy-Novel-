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
 *   draft   { id:novelId, novelId, direction, partner, play:{} }
 */

import { newId, countWords, hashText, numberWords, nameKey } from '../util.js';
import { samePersonName, plainName, isDescriptorName, nameInText } from './names.js';

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
  const note = (shown.how === 'rewrite' || shown.how === 'selection') && shown.ask && shown.ask.note ? String(shown.ask.note) : '';
  if (passage.by === 'you') {
    /* brought in from a file: only a note he gave it in a rewrite is his */
    if ((versions[0] || {}).how === 'imported') return note.trim();
    /* his own words: the version on show when it is his (typed, or his
     * edit), else the one of his it was rewritten from — never a rewrite
     * the writer made of it */
    const isMine = (v) => Boolean(v && (v.how === 'mine' || v.how === 'edit'));
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
  dropNote: (kind, cardId) => (n) => { n.notes[kind] = (n.notes[kind] || []).filter((c) => c.id !== cardId); },
  setNotes: (notes) => (n) => { n.notes = notes; },
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
  putReading: (pid, vid, reading) => (n) => {
    n.memory = n.memory || {};
    const all = n.memory.readings || (n.memory.readings = {});
    all[pid] = { ...(all[pid] || {}), [vid]: JSON.parse(JSON.stringify(reading)) };
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
  /* the summaries of the chapter as it read before (each by its words'
   * fingerprint): a version brought back brings its summary back too */
  clearSummaries: () => (c) => { c.summaries = []; },
  dropSummary: (fp) => (c) => { c.summaries = (c.summaries || []).filter((x) => x.fp !== fp); },
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
    if (list.length > 60) list.splice(0, list.length - 60);
  },
  /* the judge's head to head of two versions of one passage (checker.js) —
   * kept while both versions are there */
  setDuel: (key, row) => (c) => {
    const p = findPassage(c, row.pid);
    if (!p || !findVersion(p, row.x) || !findVersion(p, row.y)) return;
    c.duels = c.duels || {};
    c.duels[key] = JSON.parse(JSON.stringify(row));
  },
  /* what was kept for passages and versions no longer in the chapter goes */
  pruneChecks: () => (c) => {
    for (const pid of Object.keys(c.checksLeft || {})) if (!findPassage(c, pid)) delete c.checksLeft[pid];
    for (const [key, d] of Object.entries(c.duels || {})) {
      const p = d && findPassage(c, d.pid);
      if (!p || !findVersion(p, d.x) || !findVersion(p, d.y)) delete c.duels[key];
    }
    if (!c.checks) return;
    for (const pid of Object.keys(c.checks)) {
      const p = findPassage(c, pid);
      if (!p) { delete c.checks[pid]; continue; }
      for (const vid of Object.keys(c.checks[pid])) if (!findVersion(p, vid)) delete c.checks[pid][vid];
      if (!Object.keys(c.checks[pid]).length) delete c.checks[pid];
    }
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

/* The card a name means (Cozy Tavern's lessons: a name matched loosely takes
 * the first card that shares it and writes on the wrong one, M584/M600/M607;
 * one person on two cards, M405/M414): the card called that comes first, then
 * the one that also goes by it, then the one whose name is among the other
 * names given with it, then — for a person — the one whose name is a short or
 * fuller form of it (Rias for Rias Wells, Captain Hitsugaya for Toshiro
 * Hitsugaya), for a place or a thing the one called the same but for a
 * leading "the". Past the first, a name two cards answer to means neither:
 * `ambiguous`, and nothing is written. */
export function matchCard(cards, name, aka = [], { kind = '' } = {}) {
  const k = nameKey(name);
  if (!k) return { card: null, ambiguous: false };
  const list = cards || [];
  const exact = list.find((c) => nameKey(c.name) === k);
  if (exact) return { card: exact, ambiguous: false };
  const one = (found) => (found.length === 1 ? { card: found[0], ambiguous: false } : found.length > 1 ? { card: null, ambiguous: true } : null);
  const byAka = one(list.filter((c) => (c.aka || []).some((a) => nameKey(a) === k)));
  if (byAka) return byAka;
  const others = (aka || []).map(nameKey).filter(Boolean);
  const byOthers = others.length ? one(list.filter((c) => others.includes(nameKey(c.name)))) : null;
  if (byOthers) return byOthers;
  /* a description is no person's name ("the girl"); a place or a thing may be called "The …" */
  const named = (n) => n && (kind !== 'people' || !isDescriptorName(n));
  const forms = [name, ...(aka || [])].filter(named);
  const namesOf = (c) => [c.name, ...(c.aka || [])].filter(named);
  const near = forms.length ? one(list.filter((c) => namesOf(c).some((n) => forms.some((f) => (kind === 'people' ? samePersonName(n, f) : plainName(n) === plainName(f)))))) : null;
  return near || { card: null, ambiguous: false };
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
  return false;
}
/* Whether another card carries a card's name — the one it was folded into */
export function carriedBy(kind, card, cards) {
  return (cards || []).some((o) => o.id !== card.id && [o.name, ...(o.aka || [])].some((n) => (kind === 'people' ? samePersonName(n, card.name) : plainName(n) === plainName(card.name))));
}
