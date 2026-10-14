/* Cozy Novel — js/novel/readings.js — EACH VERSION ITS OWN NOTES.
 *
 * Every time the helper reads a passage it keeps, beside the notes, what that
 * reading changed: each card it touched, how the card read before and after,
 * and what it kept of the book (`novel.memory.readings[passageId][versionId]`).
 * That is the notes' checkpoint for that version of that passage, the way Cozy
 * Tavern keeps a ledger checkpoint for every swipe:
 *
 * - Another take, a rewrite, his edit of the newest passage: the version it
 *   replaces is taken back out of the notes first — the notes go back to how
 *   they stood before that passage — and the new version is read from there,
 *   as new. Nothing the old version made up stays behind.
 * - The arrows back to a version read before: its notes come back as they
 *   were, at once, with no reading.
 * - What the writer is sent for a passage written again is the notes as they
 *   stood before it, never the notes the old version made.
 *
 * A card he wrote or changed himself (or his partner changed for him) stays
 * as he left it through all of this. Anything else changed since — by a later
 * passage's reading — is never written over: then the old version's notes
 * cannot be taken back cleanly, and the helper reads the change instead, told
 * what the passage used to say and what it says now.
 *
 * Pure: no store, no screen. archivist.js keeps and settles the readings;
 * context.js hands the writer the notes as they stood.
 */

import { NOTE_KINDS, picked } from './shape.js';
import { hashText } from '../util.js';

const SEP = ':';
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
export const his = (card) => Boolean(card && card.updated && card.updated.by === 'you');
const hisKept = (k) => Boolean(k && k.by === 'you');

function cardIn(notes, kind, id) {
  return ((notes && notes[kind]) || []).find((c) => c.id === id) || null;
}

/* The reading kept for a passage as the helper read it (its seen signature),
 * following a passage read together with others to the reading they share. */
export function readingOf(novel, pid, sig) {
  const all = (novel && novel.memory && novel.memory.readings) || {};
  if (!sig) return null;
  const vid = String(sig).split(SEP)[0];
  const r = all[pid] && all[pid][vid];
  if (!r || r.sig !== sig) return null;
  if (r.in) {
    const shared = all[r.in.pid] && all[r.in.pid][r.in.vid];
    return shared && shared.sig === r.in.sig ? { ...shared, pointer: true } : null;
  }
  return r;
}

/* How a reading would move the notes, taken back (back: true) or laid on
 * again: [{kind, id, from, to}] for the cards, [{key, from, to}] for what it
 * kept of the book — and whether it can be done cleanly: every card it
 * touched still reads as that reading left it (or found it). A card of his
 * that he changed since stays his and does not stand in the way. */
export function planOf(state, reading, { back = true } = {}) {
  const moves = [];
  const kept = [];
  let clean = true;
  for (const c of (reading && reading.cards) || []) {
    const cur = cardIn(state.notes, c.kind, c.id);
    const from = back ? c.after : c.before;
    const to = back ? c.before : c.after;
    if (same(cur, from)) { moves.push({ kind: c.kind, id: c.id, from: from || null, to: to || null }); continue; }
    if (his(cur)) continue;
    clean = false;
  }
  for (const [key, k] of Object.entries((reading && reading.kept) || {})) {
    const cur = (state.kept && state.kept[key]) || null;
    const from = back ? k.after : k.before;
    const to = back ? k.before : k.after;
    if (same(cur, from)) { kept.push({ key, from: from || null, to: to || null }); continue; }
    if (hisKept(cur)) continue;
    clean = false;
  }
  return { moves, kept, clean };
}

/* moves laid on a copy of the notes (each only where the card still reads as `from`) */
export function moved(notes, moves) {
  const out = JSON.parse(JSON.stringify(notes || {}));
  for (const k of NOTE_KINDS) if (!Array.isArray(out[k])) out[k] = [];
  for (const m of moves || []) {
    const list = out[m.kind] || (out[m.kind] = []);
    const i = list.findIndex((c) => c.id === m.id);
    const cur = i >= 0 ? list[i] : null;
    if (!same(cur, m.from)) continue;
    if (!m.to) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = JSON.parse(JSON.stringify(m.to));
    else list.push(JSON.parse(JSON.stringify(m.to)));
  }
  return out;
}

/* what the cards' moves change, said the way the notes say it */
export function changedBy(moves) {
  return (moves || []).map((m) => ({ kind: m.kind, name: (m.to || m.from || {}).name || '', how: !m.from ? 'new' : !m.to ? 'gone' : 'changed' })).filter((c) => c.name);
}

/* Has anything after this passage been read into the notes? The book's
 * newest read passage is the one whose notes can be taken back exactly. */
export function newestRead(novel, chapters, chapterId, pid, { after } = {}) {
  const seen = (novel && novel.memory && novel.memory.seen) || {};
  const order = (novel && novel.order) || [];
  const at = order.indexOf(chapterId);
  if (at < 0) return false;
  for (const id of order.slice(at + 1)) if (seen[id] && Object.keys(seen[id]).length) return false;
  const list = ((chapters[chapterId] || {}).passages) || [];
  const mine = seen[chapterId] || {};
  /* a passage taken out but not yet read as taken out stands in the way too */
  const here = new Set(list.map((p) => p.id));
  for (const id of Object.keys(mine)) if (id !== pid && !here.has(id)) return false;
  let i = list.findIndex((p) => p.id === pid);
  if (i < 0) {
    /* a passage taken out: where it stood (the passage before it), or nothing is known */
    if (after === '^') i = -1;
    else { i = after ? list.findIndex((p) => p.id === after) : -2; if (i < 0) return false; }
  }
  return !list.slice(i + 1).some((p) => p.id !== pid && mine[p.id]);
}

/* The notes as they stood right before a passage — for the writer, when it
 * writes that passage again (another take, a rewrite, his selected words):
 * what the helper read from the version being replaced is taken out, card by
 * card, wherever the card still reads as that reading left it. */
export function notesBefore(novel, chapterId, pid) {
  let notes = (novel && novel.notes) || {};
  const seen = (novel && novel.memory && novel.memory.seen && novel.memory.seen[chapterId]) || {};
  /* a version read as a change from the one before it is taken back to that
   * one, and that one back to before the passage — never only halfway, to
   * an older version's notes. One read together with other passages (mixed)
   * is not taken back: it holds theirs too. */
  const chain = [];
  let r = readingOf(novel, pid, seen[pid]);
  for (let step = 0; r && step < 12; step++) {
    if (r.mode !== 'new' && r.mode !== 'change') return notes;
    chain.push(r);
    if (r.mode === 'new') break;
    r = readingOf(novel, pid, r.fromSig);
  }
  if (!chain.length || chain[chain.length - 1].mode !== 'new') return notes;
  for (const x of chain) notes = moved(notes, planOf({ notes, kept: novel.kept }, x, { back: true }).moves);
  return notes;
}

/* The signature the helper marks a version read with (archivist.signature),
 * its text half computed once per version text. */
const hashes = new WeakMap();
export function sigOf(v) {
  if (!v) return '';
  const t = String(v.text || '');
  const h = hashes.get(v);
  if (h && h.t === t) return v.id + SEP + h.h;
  const x = hashText(t);
  hashes.set(v, { t, h: x });
  return v.id + SEP + x;
}

/* Passages with words the notes have not read yet — up to a point in the
 * book (before: a passage id in chapterId; with no point, the whole book):
 * [{chapterId, pid, n}] in book order, n its number on the page. A passage
 * being written, or the one being written again (skip), is not counted. */
export function unread(novel, chapters, { chapterId = null, before = null, skip = null } = {}) {
  const seen = (novel && novel.memory && novel.memory.seen) || {};
  const out = [];
  for (const id of (novel && novel.order) || []) {
    const c = chapters[id];
    if (!c) continue;
    let n = 0;
    for (const p of c.passages || []) {
      if (id === chapterId && before && p.id === before) return out;
      if (p.by === 'break') continue;
      n++;
      if (p.id === skip) continue;
      const v = picked(p);
      if (!v || v.streaming || !String(v.text || '').trim()) continue;
      if ((seen[id] || {})[p.id] !== sigOf(v)) out.push({ chapterId: id, pid: p.id, n });
    }
  }
  return out;
}
