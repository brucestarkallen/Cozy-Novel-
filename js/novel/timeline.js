/* The history of the notes, grounded in the words of each passage version.
 * The helper gathers these small pieces of evidence while it reads the
 * notes. They are not another account of where the book stands now, and
 * opening this view never asks a model. Pure: no store or screen. */
import { hashText } from '../util.js';
import { picked, matchCard, chapterLabel } from './shape.js';
/* one rule for a quote, the bibliography's (2.12.40, the audit): curly or straight marks, a dash's shape, "..." for "…"
 * and runs of spaces read as a reader reads them — the turn keeps the words as the page has them */
import { quoteAt, quoteIn, quoteSpan } from './bibliography.js';

export const TIMELINE_SCHEMA = 1;
export const TIMELINE_KINDS = ['relationship', 'character', 'thread'];
const STANCES = ['fact', 'belief', 'claim', 'intention'];
const NOTE_KINDS = ['people', 'threads'];
const words = (s, max) => typeof s === 'string' && s.trim().length <= max ? s.trim() : '';
const cardsIn = (notes, kind) => Array.isArray(notes?.[kind]) ? notes[kind] : [];
const allCards = (notes) => NOTE_KINDS.flatMap(kind => cardsIn(notes, kind).map(c => ({ ...c, kind })));

/* turns kept for the words with this print (the words a reading or a change was of) */
export function turnsOfPrint(c, fp) {
  return Boolean(c && c.schema === TIMELINE_SCHEMA && Array.isArray(c.events) && fp && c.fp === fp);
}
/* a version's turns while they are of its words as they stand — never turns left with words it had before (2.12.40, the
 * audit: as bibliography.js codexNow is for its facts; a version's raw turns, left with the words before a Go on, were
 * carried to new words and said read whole, the words added never read for theirs) */
export function continuityNow(v) {
  return v && turnsOfPrint(v.continuity, hashText(String(v.text || ''))) ? v.continuity : null;
}

/* THE SAME TURN (2.12.40, the audit: a part read and then the passage read for the Timeline alone gave "Emilia turns
 * Jovan." and "Emilia turns Jovan with a bite." as two rows — an id is the hash of the exact quotes, so the same turn
 * worded or quoted another way was another): the same kind, the same cards, the same stance and whose it is, and
 * words behind it that overlap on the page. Read in `text`, the words both stand in; with none, the same words quoted. */
const cardsKey = (e) => (Array.isArray(e.refs) ? e.refs : []).map((r) => (r && r.id) || '').sort().join('\u0001');
const voiceOf = (e) => `${e.stance || ''}\u0001${e.stance && e.stance !== 'fact' ? ((e.whose && e.whose.id) || '') : ''}`;
export function sameTurn(a, b, text = '') {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  if (a.kind !== b.kind || cardsKey(a) !== cardsKey(b) || voiceOf(a) !== voiceOf(b)) return false;
  const qa = Array.isArray(a.evidence) ? a.evidence : [], qb = Array.isArray(b.evidence) ? b.evidence : [];
  const t = String(text || '');
  const sa = t ? qa.map((q) => quoteAt(t, q)).filter(Boolean) : [], sb = t ? qb.map((q) => quoteAt(t, q)).filter(Boolean) : [];
  if (sa.length && sb.length) return sa.some((x) => sb.some((y) => x.start < y.end && y.start < x.end));
  return qa.some((x) => qb.some((y) => quoteIn(x, y) || quoteIn(y, x)));
}

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
      && evidence.length && evidence.every(q => q.length >= 4 && quoteIn(text, q) && quoteIn(whole, q))
      && (stance === 'fact' || (whose?.kind === 'people' && refs.some(r => r.id === whose.id)))
      && (kind !== 'relationship' || people.length >= 2)
      && (kind !== 'character' || people.length >= 1)
      && (kind !== 'thread' || refs.some(r => r.kind === 'threads'));
    if (!valid) { out.complete = false; continue; }
    /* each quote kept as the page has it */
    const quotes = [...new Set(evidence.map(q => quoteSpan(whole, q)))];
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
/* (text: the words both are of — the same turn found in them is kept once, sameTurn) */
export function mergeContinuity(before, next, text = '') {
  if (!before || before.fp !== next.fp) return next;
  const events = [...before.events];
  for (const e of next.events) if (!events.some(x => sameTurn(x, e, text))) events.push(e);
  return { ...next, complete: before.complete && next.complete, events };
}

/* A store step, replayable by identity over a newer save. A reply to words
 * that changed, were removed, or are no longer selected writes nothing. */
export function continuityStep(passageId, versionId, continuity) {
  return chapter => {
    const p = (chapter.passages || []).find(p => p.id === passageId);
    const v = p && picked(p);
    if (!v || v.id !== versionId || v.streaming) return;
    if (hashText(v.text || '') !== continuity.fp) {
      /* its words changed on the page itself while they were read (a fix put in meanwhile): the turns of the words read
       * kept with them, on the newest words before — the change is read against them next, and they stay (2.12.40) */
      const b = Array.isArray(v.before) ? v.before[v.before.length - 1] : null;
      if (b && typeof b.text === 'string' && hashText(b.text) === continuity.fp) {
        const kept = !continuity.complete && turnsOfPrint(b.continuity, continuity.fp) ? mergeContinuity(b.continuity, continuity, b.text) : continuity;
        b.continuity = JSON.parse(JSON.stringify(kept));
      }
      return;
    }
    const next = !continuity.complete && sourceValid(v) ? mergeContinuity(v.continuity, continuity, v.text) : continuity;
    v.continuity = JSON.parse(JSON.stringify(next));
  };
}

/* a turn kept as a reading keeps one: its cards, kind, stance and whose it is as continuityOf made them (restored or
 * imported records are held to it too) — its words aside */
function soundTurn(e) {
  return Boolean(e && Array.isArray(e.evidence) && e.evidence.length && e.evidence.every((q) => typeof q === 'string' && q.length >= 4)
    && Array.isArray(e.refs) && e.refs.length && !e.refs.some((r) => !r || typeof r.id !== 'string' || !words(r.name, 120) || !NOTE_KINDS.includes(r.kind))
    && new Set(e.refs.map((r) => r.id)).size === e.refs.length && words(e.id, 100)
    && TIMELINE_KINDS.includes(e.kind) && STANCES.includes(e.stance) && words(e.text, 900)
    && !(e.kind === 'relationship' && e.refs.filter((r) => r.kind === 'people').length < 2)
    && !(e.kind === 'character' && !e.refs.some((r) => r.kind === 'people'))
    && !(e.kind === 'thread' && !e.refs.some((r) => r.kind === 'threads'))
    && !(e.stance !== 'fact' && (!e.whose || !e.refs.some((r) => r.id === e.whose.id && r.kind === 'people'))));
}
/* ONE TURN CARRIED TO NEW WORDS: every quote still standing in them, kept as they have it (a name changed everywhere:
 * changed in them too, `swap`) — or null */
function carriedTurn(e, t, swap) {
  if (!soundTurn(e)) return null;
  const evidence = e.evidence.map((q) => quoteSpan(t, swap(String(q))));
  if (!evidence.length || evidence.some((q) => q.length < 4)) return null;
  const refs = e.refs.map((r) => ({ ...r, name: swap(String((r && r.name) || '')) }));
  const whose = e.whose ? { ...e.whose, ...(e.whose.name ? { name: swap(String(e.whose.name)) } : {}) } : null;
  return { ...e, refs, text: swap(String(e.text || '')), ...(e.why ? { why: swap(String(e.why)) } : {}), evidence: [...new Set(evidence)], ...(whose ? { whose } : {}),
    id: 'tl-' + hashText(JSON.stringify([e.kind, refs.map((r) => r.id).sort(), [...new Set(evidence)], e.stance, (whose && whose.id) || ''])) };
}
/* what is the reading's own, never carried: how far it was read in parts (`upTo`, `gap`) and whether it was passed by */
const ownOnly = ({ upTo: _u, gap: _g, passed: _p, ...rest }) => rest;

/* A READING CARRIED TO NEW WORDS (2.12.37 — his report: "5 passages have no complete timeline reading yet — Read the
 * whole book again", under Super automatic): words changed on the page itself — the spaces mended on opening, a fix,
 * a name changed everywhere, words put back — kept the bibliography's facts (bibliography.js carriedCodex) but not the
 * Timeline's turns, whose print was of the words before: every such passage counted as never read. The turns go with
 * the words, as the facts do — kept whole only when every quote still stands in the new words (a name changed
 * everywhere: changed in them too, `swap`); else none, and the passage is read for them again (archivist.js
 * timelineDue). */
/* (2.12.40, the audit: given only the turns of the words being replaced — continuityNow, as the facts are codexNow;
 * a quote read as the bibliography reads one, and kept as the new words have it: a run of spaces mended to one kept
 * every turn on it) */
export function carriedContinuity(c, text, swap = (x) => x) {
  if (!c || c.schema !== TIMELINE_SCHEMA || !Array.isArray(c.events)) return null;
  const t = String(text || '');
  const events = [];
  for (const e of c.events) {
    const carried = carriedTurn(e, t, swap);
    if (!carried) return null;
    events.push(carried);
  }
  return { ...ownOnly(c), fp: hashText(t), events };
}
/* WHAT A READING OF A CHANGE GIVES, WITH THE TURNS THE WORDS BEFORE IT HAD THAT ITS NEW WORDS STILL GIVE (2.12.40, the
 * audit: the reading is asked for what the change adds — a fix adds nothing — and its answer was the passage's whole
 * history, so a fix, a Go on, his partner's words, his edit or an Undo took away every turn of the words still
 * standing; the bibliography kept its facts — bibliography.js withCarriedFacts). Judged turn by turn: each earlier turn
 * whose quotes all still stand in the new words is kept, as they have them — unless the reading gives the same turn
 * (sameTurn), whose own words stand. */
export function withCarriedTurns(history, before, text) {
  if (!history || !before || before.schema !== TIMELINE_SCHEMA || !Array.isArray(before.events)) return history;
  const t = String(text || '');
  const events = [...history.events];
  for (const e of before.events) {
    const carried = carriedTurn(e, t, (x) => x);
    if (carried && !events.some((x) => sameTurn(x, carried, t))) events.push(carried);
  }
  return { ...history, events };
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
  /* passed: read for its turns and passed by — its model would not give them from its words (archivist.js timelineBackfill);
   * passedFound: the turns those passages gave, shown; aside: set aside by the notes' reading as its words stand — its model
   * would not read it, never read for its turns until he has it read again (2.12.40: said apart, never "read by itself") */
  const coverage = { total: 0, read: 0, missing: 0, passed: 0, complete: false };
  const asideAll = (novel && novel.memory && novel.memory.aside) || {};
  let aside = 0, passedFound = 0;
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
      const setAside = () => { const a = asideAll[p.id]; return Boolean(a && a.sig === `${v.id}:${hashText(v.text || '')}`); };
      if (!sourceValid(v)) { if (setAside()) aside++; continue; }
      let valid = true;
      const rows = [];
      /* the same turn kept twice by a merge made before 2.12.40 is shown, and sent to the notes' check, once (sameTurn) */
      const shown = [];
      for (const e of v.continuity.events) {
        /* Restored/imported records are held to the same evidence rule. */
        if (!soundTurn(e) || e.evidence.some(q => !quoteIn(v.text, q))) { valid = false; continue; }
        if (shown.some(x => sameTurn(x, e, v.text))) continue;
        shown.push(e);
        const participants = e.refs.map(ref => resolve(notes, ref) || { ...ref, missing: true });
        const ids = participants.map(r => r.id);
        if ((cardId && !ids.includes(cardId)) || (kind && kind !== 'all' && e.kind !== kind)) continue;
        const who = e.whose && (resolve(notes, e.whose) || e.whose);
        rows.push({ id: `${p.id}:${v.id}:${e.id}`, kind: e.kind, cards: ids, participants,
          text: e.text, why: e.why || '', evidence: [...e.evidence], stance: e.stance,
          ...(who ? { whose: who.id, whoseName: who.name } : {}),
          chapterId: cid, passageId: p.id, versionId: v.id, chapterNumber: ci + 1, passageNumber,
          label: `${chapterLabel(novel, chapter)}, passage ${passageNumber}`,
          offset: Math.min(...e.evidence.map(q => (quoteAt(v.text, q) || { start: 0 }).start)) });
      }
      if (v.continuity.complete === true && valid) coverage.read++;
      else if (v.continuity.passed && v.continuity.passed === v.continuity.fp) { coverage.passed++; passedFound += rows.length; }
      else if (setAside()) aside++;
      events.push(...rows.sort((a, b) => a.offset - b.offset));
    }
  }
  coverage.missing = coverage.total - coverage.read;
  coverage.complete = !missingChapter && coverage.missing === 0;
  if (missingChapter) coverage.unavailable = true;
  if (aside) coverage.aside = aside;
  if (passedFound) coverage.passedFound = passedFound;
  return { events, coverage, cards };
}
