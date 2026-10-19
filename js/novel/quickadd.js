/* Cozy Novel — js/novel/quickadd.js — QUICK ADD (2.12.37).
 *
 * His ask: "a quick add bibliography chat, connected to the partner or on its own, that adds world info — anything not
 * in the premise or the book yet — to the world quickly, prevents errors, and checks whether what I asked is possible
 * and not contradictory." Notes → Bibliography → Quick add: he says what he wants in his world in his own words; his
 * partner's connection reads them as the partner sees the book (context.js assemble, no changes block), with the
 * passages that name what he adds, his premises and his entries for those names whole (prompts.js quickAddRequest),
 * and answers with what contradicts the pages, what changes his own earlier words, what cannot be by the world's rules,
 * what is left for him to decide, and the entries for all of it that holds.
 *
 * Nothing it says is taken on its word: every words it quotes are looked up — a contradiction is said only where the
 * page's words stand (with where, to go there), one whose words stand only in his own earlier words is his newer word
 * (a change, and it goes in), and one quoting words that stand nowhere is set aside, and counted. The entries go in at
 * once through the partner's own entry change (changes.js makeChange — the same names, kinds and refusals), his own,
 * with one Undo for the answer. What he said before in Quick add rides with what he says next, so "keep mine" is an
 * answer. A changed entry under a card of the notes has the notes checked against it (archivist.js auditDue). */

import * as store from '../store.js';
import { ask } from '../model/call.js';
import { wireOf, contextOf } from '../model/providers.js';
import { assemble, requiredLength } from './context.js';
import { connFor } from './writer.js';
import { picked, passageNumbers, chapterLabel, premisesOf } from './shape.js';
import { quickAddRequest, JSON_AGAIN, JSON_CUT } from './prompts.js';
import { parseFirstObject, parseLastObject, closesWhole } from './jsonutil.js';
import { findIn } from './search.js';
import { namesAndFigures, foldedText, nameInText } from './names.js';
import { entriesOf, entriesNamed, entryNamed, entryWords, kindSaid } from './bibliography.js';
import { makeChange, undoChange } from './changes.js';
import * as archivist from './archivist.js';
import { newId, estimateTokens } from '../util.js';

/* the rows kept (his words and what came of them), and how many of the newest keep their Undo */
export const QUICK_KEEP = 12;
const UNDO_KEEP = 4;
const ENTRIES_MOST = 30;

const running = new Map();   /* novelId -> {ctl} */
export function quickBusy(novelId) { return running.has(novelId); }
export function stopQuick(novelId) { const j = running.get(novelId); if (j) j.ctl.abort(); }
export function quickLog(novel) { return Array.isArray(novel && novel.quick) ? novel.quick.filter((r) => r && r.id) : []; }

function bookNow(novelId) {
  const novel = store.peek('novel', novelId);
  const chapters = {};
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  return { novel, chapters };
}

/* A row put in, or put right where it stands — by id, so it lands over a newer copy too; the oldest let go past
 * QUICK_KEEP, and the Undo of all but the newest UNDO_KEEP (what it would put back) let go with them */
function rowStep(row) {
  return (n) => {
    const list = quickLog(n);
    const i = list.findIndex((r) => r.id === row.id);
    if (i >= 0) list[i] = JSON.parse(JSON.stringify(row)); else list.push(JSON.parse(JSON.stringify(row)));
    const kept = list.slice(-QUICK_KEEP);
    kept.forEach((r, k) => {
      if (k >= kept.length - UNDO_KEEP) return;
      for (const a of r.added || []) if (a.change) { delete a.change; if (a.status === 'made') a.status = 'kept'; }
    });
    n.quick = kept;
  };
}

/* ------------------------------------------------------- what his words name */

const WORD_EDGE = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
/* the names his words give: names written with a capital mid-sentence; his entries and the notes' cards his words
 * name; and a word opening a sentence that the book itself writes with a capital mid-sentence ("Sanguelis is…") */
export function namesIn(words, novel, chapters) {
  const t = String(words || '');
  const out = new Map();
  const add = (n) => { const k = String(n || '').trim(); if (k.length >= 2 && !out.has(k.toLowerCase())) out.set(k.toLowerCase(), k); };
  for (const tok of namesAndFigures(t)) if (!/^\d/.test(tok)) add(tok);
  const folded = foldedText(t);
  for (const e of entriesOf(novel)) for (const x of [e.name, ...(e.aka || [])]) if (x && nameInText(folded, x)) add(x);
  const notes = (novel && novel.notes) || {};
  for (const k of ['people', 'places', 'lore', 'threads']) for (const c of notes[k] || []) for (const x of [c.name, ...(c.aka || [])]) if (x && nameInText(folded, x)) add(x);
  const book = (novel.order || []).map((id) => (chapters[id] ? (chapters[id].passages || []).map((p) => String((picked(p) || {}).text || '')).join('\n') : '')).join('\n');
  for (const m of t.matchAll(/(?:^|[.!?…]\s+|\n\s*)(\p{Lu}[\p{L}\p{M}'’-]{2,})/gu)) {
    const tok = m[1];
    if (out.has(tok.toLowerCase())) continue;
    if (new RegExp(`[\\p{L}\\p{N},;]\\s+${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(book)) add(tok);
  }
  return [...out.values()];
}

/* the passages on the page that name them, the most of them first, fitted to `room` tokens — then told in the book's
 * order: [{chapterId, passageId, label, text}], with how many more there were */
export function passagesNaming(novel, chapters, names, room) {
  const rows = [];
  if (!names.length) return { passages: [], passagesLeft: 0 };
  const res = names.map(WORD_EDGE);
  (novel.order || []).forEach((cid, ci) => {
    const c = chapters[cid];
    if (!c) return;
    const nums = passageNumbers(c);
    (c.passages || []).forEach((p, pi) => {
      if (p.by === 'break') return;
      const text = String((picked(p) || {}).text || '');
      if (!text.trim()) return;
      const hits = res.filter((re) => re.test(text)).length;
      if (hits) rows.push({ chapterId: cid, passageId: p.id, label: `${chapterLabel(novel, c, { withName: false })}, Passage ${nums.get(p.id) || '—'}`, text, hits, at: ci * 100000 + pi });
    });
  });
  rows.sort((a, b) => b.hits - a.hits || b.at - a.at);
  const chosen = [];
  let used = 0;
  for (const r of rows) {
    const cost = estimateTokens(r.text) + 20;
    if (used + cost > room) continue;
    chosen.push(r);
    used += cost;
  }
  chosen.sort((a, b) => a.at - b.at);
  return { passages: chosen.map(({ chapterId, passageId, label, text }) => ({ chapterId, passageId, label, text })), passagesLeft: rows.length - chosen.length };
}

/* ------------------------------------------------------ where quoted words stand */

/* where words it quotes stand: a page of the book first (with where, to go there), then his own earlier words — a
 * premise, an entry, a card of the notes, what the book is about — or null when they stand nowhere */
export function whereIn(novel, chapters, quote) {
  const q = String(quote || '').trim();
  if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 4) return null;
  const has = (text) => findIn(String(text || ''), q, { words: true, max: 1 }).length > 0;
  for (const cid of novel.order || []) {
    const c = chapters[cid];
    if (!c) continue;
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      if (has((picked(p) || {}).text)) return { kind: 'page', chapterId: cid, passageId: p.id, label: `${chapterLabel(novel, c, { withName: false })}, Passage ${nums.get(p.id) || '—'}` };
    }
  }
  for (const x of premisesOf(novel, chapters)) if (has(x.text)) return { kind: 'premise', chapterId: x.chapterId, passageId: x.pid, label: `your premise for ${x.label}` };
  for (const e of entriesOf(novel)) if (has(entryWords(e))) return { kind: 'entry', ref: `e:${e.id}`, label: `your entry ${e.name}` };
  const notes = (novel && novel.notes) || {};
  for (const k of ['people', 'places', 'lore', 'threads']) for (const c of notes[k] || []) {
    if (has([c.name, c.about, c.since, c.ties, c.now].filter(Boolean).join('\n'))) return { kind: 'card', cardKind: k, id: c.id, label: `the notes’ card ${c.name}` };
  }
  const kept = Object.values((novel && novel.kept) || {}).map((k) => (k && typeof k === 'object' ? k.text : ''));
  if ([novel.brief, novel.plans, novel.style, ...kept].some(has)) return { kind: 'about', label: 'what the book is about' };
  return null;
}

const line = (v, max = 600) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/* An answer, held to the book: each row's quoted words looked up (whereIn) — a contradiction of a page stays one,
 * with where; one of his own earlier words is a change (his newer word); words that stand nowhere set it aside. */
export function readAnswer(novel, chapters, obj) {
  const out = { verdict: line(obj && obj.verdict, 1600), conflicts: [], changes: [], cannot: [], questions: [], entries: [], aside: 0 };
  const rows = (k) => (Array.isArray(obj && obj[k]) ? obj[k].filter((r) => r && typeof r === 'object') : []);
  const asConflict = (r, quote, at) => out.conflicts.push({ mine: line(r.mine), against: line(quote), why: line(r.why), label: at.label, chapterId: at.chapterId, passageId: at.passageId });
  const asChange = (r, quote, at) => out.changes.push({ mine: line(r.mine), was: line(quote), why: line(r.why), label: at.label });
  for (const r of rows('conflicts')) {
    const at = whereIn(novel, chapters, r.against);
    if (!at) { out.aside++; continue; }
    if (at.kind === 'page') asConflict(r, r.against, at); else asChange(r, r.against, at);
  }
  for (const r of rows('changes')) {
    const at = whereIn(novel, chapters, r.was);
    if (!at) { out.aside++; continue; }
    if (at.kind === 'page') asConflict(r, r.was, at); else asChange(r, r.was, at);
  }
  for (const r of rows('cannot')) {
    const at = whereIn(novel, chapters, r.rule);
    if (!at) { out.aside++; continue; }
    out.cannot.push({ mine: line(r.mine), rule: line(r.rule), why: line(r.why), label: at.label, ...(at.kind === 'page' ? { chapterId: at.chapterId, passageId: at.passageId } : {}) });
  }
  out.questions = (Array.isArray(obj && obj.questions) ? obj.questions : []).map((q) => line(q, 400)).filter(Boolean).slice(0, 3);
  out.entries = rows('entries').filter((e) => line(e.name, 200)).slice(0, ENTRIES_MOST);
  return out;
}

/* the entries, put in through the partner's own entry change — his, each with what came of it */
function putEntries(novelId, entries) {
  const added = [];
  const refused = [];
  for (const e of entries) {
    const name = line(e.name, 200);
    const exists = entryNamed(entriesOf(store.peek('novel', novelId)), name).entry;
    const op = { entry: name };
    const kind = kindSaid(e.kind);
    if (kind) op.kind = kind; else if (!exists) op.kind = 'lore';
    if (line(e.line)) op.line = line(e.line, 400);
    if (String(e.text || '').trim()) op.text = String(e.text);
    const aka = (Array.isArray(e.aka) ? e.aka : typeof e.aka === 'string' ? e.aka.split(',') : []).map((x) => line(x, 120)).filter(Boolean);
    if (aka.length) op.aka = aka;
    const ch = makeChange(novelId, op, { entryBy: 'you' });
    if (ch.status === 'made') added.push({ name, entryId: (ch.undo && ch.undo.id) || '', was: Boolean(exists), status: 'made', change: ch });
    else refused.push({ name, why: line(ch.said, 300) });
  }
  return { added, refused };
}

/* ------------------------------------------------------------- asking */

/* the request as his partner's connection sees the book now, for these words */
function requestFor(novelId, words, c) {
  const { novel, chapters } = bookNow(novelId);
  const room = Math.max(1500, Math.floor(contextOf(c) * 0.25));
  const names = namesIn(words, novel, chapters);
  /* his premises — those naming what his words name first, then the newest — and his entries for those names, fitted in
   * one pass (archivist.js premisesFitted, entriesFitted — 2.12.40, the audit: the earliest only, rebuilt for every one
   * let go, and none at all when the first was long) */
  const prem = archivist.premisesFitted(novel, chapters, Math.floor(room / 4), { names });
  /* (his entries his words name, found as the page finds a name — 2.12.40, the audit: any word of a name in small
   * letters counted; the partner reads every entry, Never ones too) */
  const byWords = new Set(entriesNamed(entriesOf(novel), words).map((e) => e.id));
  const named = entriesOf(novel).filter((e) => byWords.has(e.id) || names.some((n) => entryNamed([e], n).entry));
  const ent = archivist.entriesFitted(named, Math.floor(room / 4));
  const pas = passagesNaming(novel, chapters, names, Math.floor(room / 2));
  /* what was said before in Quick add, the newest few (never the one being asked) */
  const earlier = quickLog(novel).filter((r) => r.state === 'done').slice(-4);
  return quickAddRequest({ words, earlier, ...prem, ...ent, ...pas });
}

const want = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o) && (Array.isArray(o.entries) || typeof o.verdict === 'string' || Array.isArray(o.conflicts));

/* Quick add: his words checked, and what holds put in. {ok, row} or {ok: false, error, giveBack} */
export async function quickAdd({ novelId, chapterId = '', words }) {
  const t = String(words || '').trim();
  if (!t) return { ok: false, error: '' };
  if (running.has(novelId)) return { ok: false, error: 'Quick add is checking already — wait for it, or Stop it', giveBack: t };
  const house = store.peek('house', 'house') || {};
  const conn = connFor(house, 'partner');
  if (!conn) return { ok: false, error: 'no connection is chosen for your partner yet — Settings → Connections', giveBack: t };
  const novel0 = store.peek('novel', novelId);
  if (!novel0) return { ok: false, error: 'the book is not open', giveBack: t };
  const target = chapterId && (novel0.order || []).includes(chapterId) ? chapterId : (novel0.order || []).slice(-1)[0];
  const row = { id: newId('qa'), at: Date.now(), said: t, state: 'asking' };
  /* asking from before the row is laid in: the screen drawn for the row draws it as being asked */
  const ctl = new AbortController();
  running.set(novelId, { ctl });
  try { store.change('novel', novelId, rowStep(row), { now: true }); } catch (e) { running.delete(novelId); return { ok: false, error: (e && e.message) || String(e), giveBack: t }; }
  const settle = (patch) => {
    const now = quickLog(store.peek('novel', novelId)).find((r) => r.id === row.id) || row;
    const next = { ...now, ...patch };
    store.change('novel', novelId, rowStep(next), { now: true });
    return next;
  };
  try {
    const build = (extra) => (c) => {
      const { novel, chapters } = bookNow(novelId);
      const request = requestFor(novelId, t, c);
      const a = assemble({ house, novel, chapters, conn: c, purpose: 'partner', target: { chapterId: target }, turns: [], request, tools: false });
      return { system: a.system, systemParts: a.systemParts, messages: [...a.messages, ...extra], maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, 'scene') : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse, least: a.stats.least, seed: a.seed };
    };
    const opts = { stream: true, signal: ctl.signal, leash: true, noPrefill: true, noStructured: true };
    const readOut = (out) => {
      let obj = !out.cut || closesWhole(out.text) ? parseFirstObject(out.text, want) : null;
      if (!obj && !String(out.text || '').trim() && out.thinking && (!out.cut || closesWhole(out.thinking))) obj = parseLastObject(out.thinking, want);
      return obj;
    };
    let out = await ask(conn, { ...opts, build: build([]) });
    if (out.stopped) return { ok: false, stopped: true, row: settle({ state: 'stopped' }), giveBack: t };
    if (!out.ok) return { ok: false, error: out.error || 'no answer came', row: settle({ state: 'failed', error: line(out.error || 'no answer came', 400) }), giveBack: t };
    let obj = readOut(out);
    /* once more, told what went wrong (as the helper is) */
    if (!obj) {
      const first = out;
      out = await ask(conn, { ...opts, build: build([{ role: 'assistant', content: String(first.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: first.cut ? JSON_CUT : JSON_AGAIN }]) });
      if (out.stopped) return { ok: false, stopped: true, row: settle({ state: 'stopped' }), giveBack: t };
      obj = out.ok ? readOut(out) : null;
      if (!obj) {
        const why = out.ok ? 'its answer could not be read' : (out.error || 'no answer came');
        return { ok: false, error: why, row: settle({ state: 'failed', error: line(why, 400) }), giveBack: t };
      }
    }
    const { novel, chapters } = bookNow(novelId);
    if (!novel) return { ok: false, error: 'the book was closed' };
    const read = readAnswer(novel, chapters, obj);
    const { added, refused } = putEntries(novelId, read.entries);
    const { entries, ...shown } = read;
    const done = settle({ state: 'done', ...shown, added, refused });
    /* the notes follow what went in: an entry changed under a card has them checked against it (archivist.js auditDue) */
    if (added.length) archivist.nudge(novelId, 1500);
    return { ok: true, row: done };
  } finally {
    running.delete(novelId);
  }
}

/* Undo these: what one answer put in, taken back out — each only where it stands as it went in (changes.js undoChange) */
export function undoQuick(novelId, rowId) {
  const row = quickLog(store.peek('novel', novelId)).find((r) => r.id === rowId);
  if (!row) return { ok: false, said: 'that Quick add is not kept any more' };
  const said = [];
  let back = 0;
  const added = (row.added || []).map((a) => ({ ...a }));
  for (const a of [...added].reverse()) {
    if (a.status !== 'made' || !a.change) continue;
    const out = undoChange(novelId, a.change);
    if (out && out.ok === false) { said.push(`${a.name}: ${out.said || 'it has changed since'}`); continue; }
    a.status = 'undone';
    back++;
  }
  store.change('novel', novelId, rowStep({ ...row, added }), { now: true });
  if (back) archivist.nudge(novelId, 1500);
  return { ok: back > 0, back, said };
}

/* Clear Quick add: the conversation let go — what went into the bibliography stays */
export function clearQuick(novelId) {
  const before = quickLog(store.peek('novel', novelId));
  store.change('novel', novelId, (n) => { n.quick = []; }, { now: true });
  return before;
}
export function putBackQuick(novelId, rows) {
  store.change('novel', novelId, (n) => { n.quick = JSON.parse(JSON.stringify(rows || [])).slice(-QUICK_KEEP); }, { now: true });
}
