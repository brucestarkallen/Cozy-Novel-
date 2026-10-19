/* The history of the notes, grounded in the words of each passage version.
 * The helper gathers these small pieces of evidence while it reads the
 * notes. They are not another account of where the book stands now, and
 * opening this view never asks a model. Pure: no store or screen. */
import { hashText } from '../util.js';
import { picked, matchCard, chapterLabel } from './shape.js';

export const TIMELINE_SCHEMA = 1;
export const TIMELINE_KINDS = ['relationship', 'character', 'thread'];
const STANCES = ['fact', 'belief', 'claim', 'intention'];
const NOTE_KINDS = ['people', 'threads'];
const words = (s, max) => typeof s === 'string' && s.trim().length <= max ? s.trim() : '';
const cardsIn = (notes, kind) => Array.isArray(notes?.[kind]) ? notes[kind] : [];
const allCards = (notes) => NOTE_KINDS.flatMap(kind => cardsIn(notes, kind).map(c => ({ ...c, kind })));

/* Names are resolved against the notes already folded from this answer.
 * A reference can never create a person or a thread. Ambiguous names stay
 * unresolved; a card folded into another can still be found by its alias. */
function resolve(notes, ref) {
  if (!ref || typeof ref !== 'object' || !NOTE_KINDS.includes(ref.kind)) return null;
  const cards = cardsIn(notes, ref.kind);
  const card = cards.find(c => ref.id && c.id === ref.id) || matchCard(cards, words(ref.name, 120), [], { kind: ref.kind, near: false }).card;
  return card ? { id: card.id, kind: ref.kind, name: card.name } : null;
}

/* A response for ONE explicitly named source. Quotes must be found both
 * in the part actually shown and in the whole version: even a real quote
 * from a different passage is not evidence for this one. Bad rows leave a
 * visible coverage gap; the sound rows can still be useful. */
export function continuityOf(rows, notes, { text = '', whole = text } = {}) {
  const out = { schema: TIMELINE_SCHEMA, fp: hashText(whole), events: [], complete: Array.isArray(rows) };
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { out.complete = false; continue; }
    const statement = words(row.text, 900), why = words(row.why, 900);
    const kind = row.kind, stance = row.stance;
    const refs = Array.isArray(row.cards) ? row.cards.map(ref => resolve(notes, ref)) : [];
    const evidence = Array.isArray(row.evidence) ? row.evidence.map(q => words(q, 1800)) : [];
    const whose = row.whose ? resolve(notes, typeof row.whose === 'string' ? { kind: 'people', name: row.whose } : row.whose) : null;
    const people = refs.filter(r => r?.kind === 'people');
    const valid = statement && (!row.why || why) && TIMELINE_KINDS.includes(kind) && STANCES.includes(stance)
      && refs.length && refs.every(Boolean) && new Set(refs.map(r => r.id)).size === refs.length
      && evidence.length && evidence.every(q => q.length >= 4 && text.includes(q) && whole.includes(q))
      && (stance === 'fact' || (whose?.kind === 'people' && refs.some(r => r.id === whose.id)))
      && (kind !== 'relationship' || people.length >= 2)
      && (kind !== 'character' || people.length >= 1)
      && (kind !== 'thread' || refs.some(r => r.kind === 'threads'));
    if (!valid) { out.complete = false; continue; }
    const quotes = [...new Set(evidence)];
    const event = { kind, refs, text: statement, why, evidence: quotes, stance, ...(whose ? { whose } : {}) };
    event.id = 'tl-' + hashText(JSON.stringify([kind, refs.map(r => r.id).sort(), quotes, stance, whose?.id || '']));
    if (!out.events.some(e => e.id === event.id)) out.events.push(event);
  }
  return out;
}

/* Every part has to contain its source's list (an empty list is an honest
 * reading with no turning point). A missing or invalid part is not made
 * complete by the final part. No partial result is written before the
 * passage's reading finishes. */
export function mergeContinuity(before, next) {
  if (!before || before.fp !== next.fp) return next;
  const events = [...before.events];
  for (const e of next.events) if (!events.some(x => x.id === e.id)) events.push(e);
  return { ...next, complete: before.complete && next.complete, events };
}

/* A store step, replayable by identity over a newer save. A reply to words
 * that changed, were removed, or are no longer selected writes nothing. */
export function continuityStep(passageId, versionId, continuity) {
  return chapter => {
    const p = (chapter.passages || []).find(p => p.id === passageId);
    const v = p && picked(p);
    if (!v || v.id !== versionId || v.streaming || hashText(v.text || '') !== continuity.fp) return;
    const next = !continuity.complete && sourceValid(v) ? mergeContinuity(v.continuity, continuity) : continuity;
    v.continuity = JSON.parse(JSON.stringify(next));
  };
}

/* A READING CARRIED TO NEW WORDS (2.12.37 — his report: "5 passages have no complete timeline reading yet — Read the
 * whole book again", under Super automatic): words changed on the page itself — the spaces mended on opening, a fix,
 * a name changed everywhere, words put back — kept the bibliography's facts (bibliography.js carriedCodex) but not the
 * Timeline's turns, whose print was of the words before: every such passage counted as never read. The turns go with
 * the words, as the facts do — kept whole only when every quote still stands in the new words (a name changed
 * everywhere: changed in them too, `swap`); else none, and the passage is read for them again (archivist.js
 * timelineDue). */
export function carriedContinuity(c, text, swap = (x) => x) {
  if (!c || c.schema !== TIMELINE_SCHEMA || !Array.isArray(c.events)) return null;
  const t = String(text || '');
  const events = [];
  for (const e of c.events) {
    if (!e || !Array.isArray(e.evidence) || !Array.isArray(e.refs)) return null;
    const evidence = e.evidence.map((q) => swap(String(q)));
    if (!evidence.length || !evidence.every((q) => q.length >= 4 && t.includes(q))) return null;
    const refs = e.refs.map((r) => ({ ...r, name: swap(String(r.name || '')) }));
    const whose = e.whose ? { ...e.whose, ...(e.whose.name ? { name: swap(String(e.whose.name)) } : {}) } : null;
    events.push({ ...e, refs, text: swap(String(e.text || '')), ...(e.why ? { why: swap(String(e.why)) } : {}), evidence, ...(whose ? { whose } : {}),
      id: 'tl-' + hashText(JSON.stringify([e.kind, refs.map((r) => r.id).sort(), evidence, e.stance, (whose && whose.id) || ''])) });
  }
  return { ...c, fp: hashText(t), events };
}
/* a passage's Timeline reading stands for its words as they are, read whole */
export function continuityDone(v) {
  const c = v && v.continuity;
  return Boolean(c && c.schema === TIMELINE_SCHEMA && c.fp === hashText(String(v.text || '')) && Array.isArray(c.events) && c.complete === true);
}

function sourceValid(v) {
  const c = v.continuity;
  return c && c.schema === TIMELINE_SCHEMA && c.fp === hashText(v.text || '') && Array.isArray(c.events);
}

/* Book order is the order of the story's telling, never when the helper
 * happened to read it. A boundary admits only the selected versions up to
 * that passage. It cannot leak an event from later in the book. */
export function timelineOf(novel, chapters, { chapterId = null, through = null, cardId = null, kind = null } = {}) {
  const notes = novel?.notes || {};
  const cards = allCards(notes).map(({ id, name, kind }) => ({ id, name, kind }));
  const events = [];
  /* passed: read for its turns and passed by — its model would not read it whole (archivist.js timelineBackfill) */
  const coverage = { total: 0, read: 0, missing: 0, passed: 0, complete: false };
  const order = novel?.order || [];
  const end = chapterId ? order.indexOf(chapterId) : order.length - 1;
  const limit = chapterId && through && through !== '^' ? (chapters?.[chapterId]?.passages || []).findIndex(p => p.id === through) : null;
  if (end < 0 || (limit !== null && limit < 0) || (through && !chapterId)) return { events, coverage, cards };
  let missingChapter = false;
  for (let ci = 0; ci <= end; ci++) {
    const cid = order[ci], chapter = chapters?.[cid];
    if (cid === chapterId && through === '^') break;
    if (!chapter) { missingChapter = true; continue; }
    let passageNumber = 0;
    for (let pi = 0; pi < (chapter.passages || []).length; pi++) {
      if (cid === chapterId && limit !== null && pi > limit) break;
      const p = chapter.passages[pi], v = picked(p);
      if (p.by === 'break') continue;
      passageNumber++;
      if (!v || v.streaming || !String(v.text || '').trim()) continue;
      coverage.total++;
      if (!sourceValid(v)) continue;
      let valid = true;
      const rows = [];
      for (const e of v.continuity.events) {
        /* Restored/imported records are held to the same evidence rule. */
        if (!e || !Array.isArray(e.evidence) || !e.evidence.length || e.evidence.some(q => typeof q !== 'string' || q.length < 4 || !v.text.includes(q))
          || !Array.isArray(e.refs) || !e.refs.length || e.refs.some(r => !r || typeof r.id !== 'string' || !words(r.name, 120) || !NOTE_KINDS.includes(r.kind))
          || new Set(e.refs.map(r => r.id)).size !== e.refs.length || !words(e.id, 100)
          || !TIMELINE_KINDS.includes(e.kind) || !STANCES.includes(e.stance) || !words(e.text, 900)
          || (e.kind === 'relationship' && e.refs.filter(r => r.kind === 'people').length < 2)
          || (e.kind === 'character' && !e.refs.some(r => r.kind === 'people'))
          || (e.kind === 'thread' && !e.refs.some(r => r.kind === 'threads'))
          || (e.stance !== 'fact' && (!e.whose || !e.refs.some(r => r.id === e.whose.id && r.kind === 'people')))) { valid = false; continue; }
        const participants = e.refs.map(ref => resolve(notes, ref) || { ...ref, missing: true });
        const ids = participants.map(r => r.id);
        if ((cardId && !ids.includes(cardId)) || (kind && kind !== 'all' && e.kind !== kind)) continue;
        const who = e.whose && (resolve(notes, e.whose) || e.whose);
        rows.push({ id: `${p.id}:${v.id}:${e.id}`, kind: e.kind, cards: ids, participants,
          text: e.text, why: e.why || '', evidence: [...e.evidence], stance: e.stance,
          ...(who ? { whose: who.id, whoseName: who.name } : {}),
          chapterId: cid, passageId: p.id, versionId: v.id, chapterNumber: ci + 1, passageNumber,
          label: `${chapterLabel(novel, chapter)}, passage ${passageNumber}`,
          offset: Math.min(...e.evidence.map(q => v.text.indexOf(q))) });
      }
      if (v.continuity.complete === true && valid) coverage.read++;
      else if (v.continuity.passed && v.continuity.passed === v.continuity.fp) coverage.passed++;
      events.push(...rows.sort((a, b) => a.offset - b.offset));
    }
  }
  coverage.missing = coverage.total - coverage.read;
  coverage.complete = !missingChapter && coverage.missing === 0;
  if (missingChapter) coverage.unavailable = true;
  return { events, coverage, cards };
}
