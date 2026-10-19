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
/* a turn's quote, as it is kept: four characters of the page at least — one rule for a quote read and a quote kept */
const quoteKept = (q) => typeof q === 'string' && q.length >= 4;
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
 * worded or quoted another way was another): the same kind, the same cards, the same stance and whose it is, words
 * behind it that overlap on the page — and the same thing said (the review: "Emilia betrays Jovan to the Order." and
 * "Jovan stops trusting Emilia.", each side told from one sentence, were folded into one, and a book of 2,400 turns
 * showed 1,410): most of the telling words of one are the other's, either way round — its words of four letters or
 * more, as archivist.js reads a telling, its cards' names aside (they are compared apart, and every turn of two people
 * names them both). Read in `text`, the words both stand in; with none, the same words quoted. Two turns of ONE reading
 * are never the same — its turns are never compared with each other (mergeContinuity, withCarriedTurns): only a turn
 * of one reading with a turn of another. */
const cardsKey = (e) => (Array.isArray(e.refs) ? e.refs : []).map((r) => (r && r.id) || '').sort().join('\u0001');
const voiceOf = (e) => `${e.stance || ''}\u0001${e.stance && e.stance !== 'fact' ? ((e.whose && e.whose.id) || '') : ''}`;
const tellingWords = (t) => String(t || '').toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/['’]s$/, '')).filter((w) => w.length >= 4);
function tellingOf(e) {
  const names = new Set([...(Array.isArray(e.refs) ? e.refs : []), e.whose].filter((r) => r && typeof r === 'object').flatMap((r) => tellingWords(r.name)));
  return new Set(tellingWords(e.text).filter((w) => !names.has(w)));
}
function saysSame(a, b) {
  const A = tellingOf(a), B = tellingOf(b);
  if (!A.size || !B.size) return A.size === B.size;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared * 2 > A.size || shared * 2 > B.size;
}
export function sameTurn(a, b, text = '') {
  if (!a || !b) return false;
  if (a.kind !== b.kind || cardsKey(a) !== cardsKey(b) || voiceOf(a) !== voiceOf(b) || !saysSame(a, b)) return false;
  const qa = Array.isArray(a.evidence) ? a.evidence : [], qb = Array.isArray(b.evidence) ? b.evidence : [];
  const t = String(text || '');
  const sa = t ? qa.map((q) => quoteAt(t, q)).filter(Boolean) : [], sb = t ? qb.map((q) => quoteAt(t, q)).filter(Boolean) : [];
  if (sa.length && sb.length) return sa.some((x) => sb.some((y) => x.start < y.end && y.start < x.end));
  return qa.some((x) => qb.some((y) => quoteIn(x, y) || quoteIn(y, x)));
}
/* a turn's mark: what it is, of whom, on which words — and what it says (2.12.40, the review: two turns of one reading
 * on the same words, saying different things, had one mark, and the second was lost) */
const turnId = (kind, refs, quotes, stance, whose, text) => 'tl-' + hashText(JSON.stringify([kind, refs.map((r) => r.id).sort(), quotes, stance, whose || '', text]));

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
      && evidence.length && evidence.every(q => quoteKept(q) && quoteIn(text, q) && quoteIn(whole, q))
      && (stance === 'fact' || (whose?.kind === 'people' && refs.some(r => r.id === whose.id)))
      && (kind !== 'relationship' || people.length >= 2)
      && (kind !== 'character' || people.length >= 1)
      && (kind !== 'thread' || refs.some(r => r.kind === 'threads'));
    if (!valid) { out.complete = false; continue; }
    /* each quote kept as the page has it — and held, as kept, to the rule every kept turn is held to (soundTurn): a
     * quote read loosely whose words on the page are fewer ("No..." for the page's "No…") is no quote (2.12.40, the
     * review: kept, the turn was unsound from then on — its passage counted unread for ever, never read again, and a
     * fix anywhere in it took all its turns) */
    const quotes = [...new Set(evidence.map(q => quoteSpan(whole, q)))];
    if (!quotes.every(quoteKept)) { out.complete = false; continue; }
    const event = { kind, refs, text: statement, why, evidence: quotes, stance, ...(whose ? { whose } : {}) };
    event.id = turnId(kind, refs, quotes, stance, whose?.id, statement);
    /* (the same turn given twice in one answer, word for word: once) */
    if (!out.events.some(e => e.id === event.id)) out.events.push(event);
  }
  return out;
}

/* Every part has to contain its source's list (an empty list is an honest
 * reading with no turning point). A missing or invalid part is not made
 * complete by the final part. No partial result is written before the
 * passage's reading finishes. */
/* (text: the words both are of — a turn of `next` that `before` holds, read another way, is kept once, the newer
 * reading's (sameTurn); of `before`, only the turns still sound and standing in them. oneReading: the rows of one
 * answer for one source, one reading — its turns are never folded together, only one given twice word for word) */
export function mergeContinuity(before, next, text = '', { oneReading = false } = {}) {
  if (!before || before.fp !== next.fp) return next;
  const t = String(text || '');
  if (oneReading) return { ...next, complete: before.complete && next.complete, events: [...before.events, ...next.events.filter(e => !before.events.some(x => x.id === e.id))] };
  const kept = before.events.filter(x => (!t || turnStands(x, t)) && !next.events.some(e => sameTurn(x, e, t)));
  return { ...next, complete: before.complete && next.complete, events: [...kept, ...next.events] };
}

/* A store step, replayable by identity over a newer save. A reply to words that changed or were removed writes
 * nothing. It is laid on the version it read while that version reads as it did — on show or not (2.12.40, the
 * review: he flipped the arrows to another take while a Go on's words were read; the reading wrote nothing, its words
 * were marked read all the same, and when he flipped back they were said read whole with the turns of the words they
 * grew from, their own never kept) */
export function continuityStep(passageId, versionId, continuity) {
  return chapter => {
    const p = (chapter.passages || []).find(p => p.id === passageId);
    const v = p && (p.versions || []).find(x => x.id === versionId);
    if (!v || v.streaming) return;
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
  return Boolean(e && Array.isArray(e.evidence) && e.evidence.length && e.evidence.every(quoteKept)
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
  const evidence = [...new Set(e.evidence.map((q) => quoteSpan(t, swap(String(q)))))];
  if (!evidence.length || !evidence.every(quoteKept)) return null;
  const refs = e.refs.map((r) => ({ ...r, name: swap(String((r && r.name) || '')) }));
  const whose = e.whose ? { ...e.whose, ...(e.whose.name ? { name: swap(String(e.whose.name)) } : {}) } : null;
  const text = swap(String(e.text || ''));
  return { ...e, refs, text, ...(e.why ? { why: swap(String(e.why)) } : {}), evidence, ...(whose ? { whose } : {}), id: turnId(e.kind, refs, evidence, e.stance, whose && whose.id, text) };
}
/* a kept turn that holds in these words: sound, and every quote of it standing in them */
export function turnStands(e, text) {
  return soundTurn(e) && e.evidence.every((q) => quoteIn(text, q));
}
/* the turns of words before a change that a reading of it neither carries to the new words nor gives again — their
 * quotes stand in them no longer (a name changed everywhere since, a sentence put another way, words taken out) and
 * the reading, asked what the change adds, does not tell them (archivist.js turnsUnvouched: read whole again, 2.12.40) */
export function turnsLost(history, before, text) {
  if (!before || before.schema !== TIMELINE_SCHEMA || !Array.isArray(before.events)) return [];
  const t = String(text || '');
  const have = (history && Array.isArray(history.events)) ? history.events : [];
  return before.events.filter((e) => soundTurn(e) && !carriedTurn(e, t, (x) => x) && !have.some((x) => sameTurn(x, e, t)));
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
 * (sameTurn), whose own words stand. (The words before's turns are of one reading: never folded together — only one
 * they hold word for word as the reading or another record does is kept once.) */
export function withCarriedTurns(history, before, text) {
  if (!history || !before || before.schema !== TIMELINE_SCHEMA || !Array.isArray(before.events)) return history;
  const t = String(text || '');
  const own = history.events;
  const events = [...own];
  for (const e of before.events) {
    const carried = carriedTurn(e, t, (x) => x);
    if (carried && !events.some((x) => x.id === carried.id) && !own.some((x) => sameTurn(x, carried, t))) events.push(carried);
  }
  return { ...history, events };
}
/* each kept turn of a version where it stands in its words ([{start, end}] a quote) — null for one unsound or whose
 * quotes do not all stand (restored or imported records are held to the rule too); null with no turns of its words.
 * Worked out once a turn (2.12.40, the review: the Timeline read every quote again for each use of it) */
function standingOf(v) {
  const c = continuityNow(v);
  if (!c) return null;
  const t = String(v.text || '');
  return { c, at: c.events.map((e) => {
    if (!soundTurn(e)) return null;
    const at = e.evidence.map((q) => quoteAt(t, q));
    return at.every(Boolean) ? at : null;
  }) };
}
const doneOf = (s) => Boolean(s && s.c.complete === true && s.at.every(Boolean));
/* A PASSAGE READ FOR THE TIMELINE: its words' turns, read whole, every one of them sound and standing in them — one test
 * for what the Timeline counts read and what the helper reads by itself (archivist.js timelineDue). (2.12.40, the
 * review: a reading kept whole whose turn no longer held was counted unread on screen, said to be read by itself, and
 * never read: the helper held it read.) */
export function continuityDone(v) { return doneOf(standingOf(v)); }
/* passed by: tried twice for these very words, its model giving no sound reading of them (archivist.js timelineBackfill) */
export function turnsPassed(v) {
  const c = continuityNow(v);
  return Boolean(c && c.passed && c.passed === c.fp);
}
/* SET ASIDE AS ITS WORDS STAND: the notes' reading would not read these words of it (archivist.js setAside, marked with
 * the version and its words as read — archivist.js signature). One test for what the Timeline counts apart and what the
 * helper leaves for him to have read again — for its turns and its facts (archivist.js timelineDue, bibDue). (2.12.40,
 * the review: the helper passed by a passage set aside under any of its versions, while the Timeline said a version
 * picked since was read by itself.) */
export function setAsideNow(novel, p, v) {
  const a = p && v && novel && novel.memory && novel.memory.aside && novel.memory.aside[p.id];
  return Boolean(a && a.sig === `${v.id}:${hashText(String(v.text || ''))}`);
}
/* what the helper reads for the Timeline by itself: a passage not read for its turns, neither passed by nor set aside
 * (counted owed on screen by this very test — archivist.js timelineDue reads them, the notes' reading the ones it has
 * not read yet) */
export function turnsOwed(novel, p, v) { return !continuityDone(v) && !turnsPassed(v) && !setAsideNow(novel, p, v); }

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
   * would not read it, never read for its turns until he has it read again (2.12.40: said apart, never "read by itself");
   * owed: the rest not read, which the helper reads by itself (turnsOwed: each counted by the helper's own tests) */
  const coverage = { total: 0, read: 0, missing: 0, passed: 0, complete: false };
  let aside = 0, passedFound = 0, owed = 0;
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
      /* (read, passed by, set aside or owed: the helper's own tests — continuityDone, turnsPassed, setAsideNow) */
      const s = standingOf(v);
      const read = doneOf(s);
      const passed = !read && turnsPassed(v);
      if (read) coverage.read++;
      else if (passed) coverage.passed++;
      else if (setAsideNow(novel, p, v)) aside++;
      else owed++;
      if (!s) continue;
      const rows = [];
      /* every turn kept is shown — two of one reading are two, however alike (sameTurn: 2.12.40, the review) */
      s.c.events.forEach((e, i) => {
        const at = s.at[i];
        if (!at) return;
        const participants = e.refs.map(ref => resolve(notes, ref) || { ...ref, missing: true });
        const ids = participants.map(r => r.id);
        if ((cardId && !ids.includes(cardId)) || (kind && kind !== 'all' && e.kind !== kind)) return;
        const who = e.whose && (resolve(notes, e.whose) || e.whose);
        rows.push({ id: `${p.id}:${v.id}:${e.id}`, kind: e.kind, cards: ids, participants,
          text: e.text, why: e.why || '', evidence: [...e.evidence], stance: e.stance,
          ...(who ? { whose: who.id, whoseName: who.name } : {}),
          chapterId: cid, passageId: p.id, versionId: v.id, chapterNumber: ci + 1, passageNumber,
          label: `${chapterLabel(novel, chapter)}, passage ${passageNumber}`,
          offset: Math.min(...at.map(x => x.start)) });
      });
      if (passed) passedFound += rows.length;
      events.push(...rows.sort((a, b) => a.offset - b.offset));
    }
  }
  coverage.missing = coverage.total - coverage.read;
  coverage.complete = !missingChapter && coverage.missing === 0;
  if (missingChapter) coverage.unavailable = true;
  if (aside) coverage.aside = aside;
  if (passedFound) coverage.passedFound = passedFound;
  if (owed) coverage.owed = owed;
  return { events, coverage, cards };
}
