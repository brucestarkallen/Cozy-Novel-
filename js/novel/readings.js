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

/* A version whose words changed in place — a fix, his partner's words, his
 * edit, Go on (his word, 2.12.2: only a rewrite or another take is a new
 * version) — keeps the readings of its earlier words beside its newest
 * (`prior`, shape.js putReading): read as a change, it is taken back to them
 * as it would be to a version before it. The reading of one version at one
 * signature, the newest or one before it: */
export function readingAt(byV, vid, sig) {
  const r = byV && byV[vid];
  if (!r || !sig) return null;
  if (r.sig === sig) return r;
  return (Array.isArray(r.prior) ? r.prior : []).find((x) => x && x.sig === sig) || null;
}

/* The reading kept for a passage as the helper read it (its seen signature),
 * following a passage read together with others to the reading they share. */
export function readingOf(novel, pid, sig) {
  const all = (novel && novel.memory && novel.memory.readings) || {};
  if (!sig) return null;
  const vid = String(sig).split(SEP)[0];
  const r = readingAt(all[pid], vid, sig);
  if (!r) return null;
  if (r.in) {
    const shared = readingAt(all[r.in.pid], r.in.vid, r.in.sig);
    return shared ? { ...shared, pointer: true } : null;
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
  return notesBeforeWith(novel, chapterId, pid).notes;
}
/* …and the other passages whose notes went with it: a passage read together
 * with the ones before it (one reading of 1.3–1.5) cannot be taken back
 * alone, so theirs go too — and they are said to be not in these notes yet,
 * for the writer to take from the page (context.js notesBehind) */
export function notesBeforeWith(novel, chapterId, pid) {
  let notes = (novel && novel.notes) || {};
  const seen = (novel && novel.memory && novel.memory.seen && novel.memory.seen[chapterId]) || {};
  /* a version read as a change from the one before it is taken back to that
   * one, and that one back to before the passage — never only halfway, to
   * an older version's notes. One read together with other passages (mixed)
   * is not taken back: it holds theirs too. */
  const chain = [];
  let r = readingOf(novel, pid, seen[pid]);
  for (let step = 0; r && step < 12; step++) {
    if (r.mode !== 'new' && r.mode !== 'change') return { notes, also: [] };
    chain.push(r);
    if (r.mode === 'new') break;
    r = readingOf(novel, pid, r.fromSig);
  }
  if (!chain.length || chain[chain.length - 1].mode !== 'new') return { notes, also: [] };
  for (const x of chain) notes = moved(notes, planOf({ notes, kept: novel.kept }, x, { back: true }).moves);
  const also = [...new Set(chain.flatMap((x) => (Array.isArray(x.covers) ? x.covers : [])))].filter((id) => id !== pid);
  return { notes, also };
}

/* THE NOTES AS THEY STOOD AT A POINT OF THE BOOK (Cozy Tavern's M336/M337:
 * a moment earlier in the story is never handed what comes after it as "so
 * far"). Writing at a point with read passages after it — another take or a
 * rewrite of an earlier passage, a page written in between, carrying on an
 * earlier chapter, a scene set there — the readings of everything after the
 * point are taken back, newest first, each only where every card it touched
 * still reads as it left it; the passage written again goes back to before
 * it, chain and all. point: {mark} the passage rewritten, {before} the
 * passage the new words come before (another take puts them in its place),
 * {through} the passage they come after; none: the chapter's end. Returns
 * {notes, kept, clean, later, also}: clean — nothing after the point is left
 * in them; later — something after the point had been read at all; also —
 * passages before the point read together with one taken back (said to be
 * not in these notes yet). Pure. */
export function notesAtPoint(novel, chapters, chapterId, point = {}) {
  const out = { notes: (novel && novel.notes) || {}, kept: (novel && novel.kept) || {}, clean: true, later: false, also: [] };
  const order = (novel && novel.order) || [];
  const ci = order.indexOf(chapterId);
  if (ci < 0) return out;
  const list = ((chapters[chapterId] || {}).passages) || [];
  const at = (id) => list.findIndex((p) => p.id === id);
  let from = list.length;
  if (point.mark && at(point.mark) >= 0) from = at(point.mark);
  else if (point.before && at(point.before) >= 0) from = at(point.before);
  else if (point.through === '^') from = 0;
  else if (point.through && at(point.through) >= 0) from = at(point.through) + 1;
  const after = [...list.slice(from).map((p) => [chapterId, p.id]), ...order.slice(ci + 1).flatMap((id) => (((chapters[id] || {}).passages) || []).map((p) => [id, p.id]))];
  const laterIds = new Set(after.map(([, pid]) => pid));
  const seen = (novel.memory && novel.memory.seen) || {};
  /* every reading behind what the notes hold of the passages after the point, each version's chain back to its first */
  const readings = [];
  const have = new Set();
  for (const [cid, pid] of after) {
    const sig = (seen[cid] || {})[pid];
    if (!sig) continue;
    out.later = true;
    let r = readingOf(novel, pid, sig);
    let whole = false;
    /* one read together with passages taken out (mixed) holds theirs too: never taken back by itself */
    for (let step = 0; r && step < 12; step++) {
      if (r.mode !== 'new' && r.mode !== 'change') break;
      if (!have.has(r.sig)) { have.add(r.sig); readings.push(r); }
      if (r.mode === 'new') { whole = true; break; }
      r = readingOf(novel, pid, r.fromSig);
    }
    if (!whole) out.clean = false;
  }
  /* a passage after the point taken out, its reading not yet told: its words are still in the notes */
  for (const [cid] of [[chapterId], ...order.slice(ci + 1).map((id) => [id])]) {
    const here = new Set((((chapters[cid] || {}).passages) || []).map((p) => p.id));
    for (const pid of Object.keys(seen[cid] || {})) if (!here.has(pid)) { out.later = true; out.clean = false; }
  }
  if (!out.later) return out;
  let state = { notes: out.notes, kept: out.kept };
  for (const r of readings.sort((a, b) => (b.at || 0) - (a.at || 0))) {
    const plan = planOf(state, r, { back: true });
    if (!plan.clean) { out.clean = false; break; }
    state = { notes: moved(state.notes, plan.moves), kept: keptMoved(state.kept, plan.kept) };
    for (const pid of Array.isArray(r.covers) ? r.covers : []) if (!laterIds.has(pid) && !out.also.includes(pid)) out.also.push(pid);
  }
  return { ...out, notes: state.notes, kept: state.kept };
}
function keptMoved(kept, moves) {
  const out = JSON.parse(JSON.stringify(kept || {}));
  for (const m of moves || []) {
    if (!same(out[m.key], m.from)) continue;
    if (m.to) out[m.key] = JSON.parse(JSON.stringify(m.to)); else delete out[m.key];
  }
  return out;
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
/* The passages set aside (their model would not read them) up to a point:
 * marked read with nothing taken from them, so never "not read yet" — but
 * never in the notes either (Cozy Tavern's M675-7: what was passed by is said) */
export function asideRows(novel, chapters, { chapterId = null, before = null, skip = null } = {}) {
  const aside = (novel && novel.memory && novel.memory.aside) || {};
  if (!Object.keys(aside).length) return [];
  const out = [];
  for (const id of (novel && novel.order) || []) {
    if (id === chapterId && before === '^') return out;
    const c = chapters[id];
    if (!c) continue;
    let n = 0;
    for (const p of c.passages || []) {
      if (id === chapterId && before && p.id === before) return out;
      if (p.by === 'break') continue;
      n++;
      if (p.id === skip || !aside[p.id]) continue;
      const v = picked(p);
      if (v && !v.streaming && aside[p.id].sig === sigOf(v)) out.push({ chapterId: id, pid: p.id, n });
    }
  }
  return out;
}

export function unread(novel, chapters, { chapterId = null, before = null, skip = null } = {}) {
  const seen = (novel && novel.memory && novel.memory.seen) || {};
  const out = [];
  for (const id of (novel && novel.order) || []) {
    if (id === chapterId && before === '^') return out;
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
