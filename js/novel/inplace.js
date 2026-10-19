/* Cozy Novel — js/novel/inplace.js — WORDS CHANGED ON THE PAGE ITSELF.
 *
 * His word (2.12.2): "Grammarly always change directly the page… rewrite is
 * the only thing who create new version"; "new version is only for rewrite
 * or another take". A fix the checker put in, a sentence it had written
 * again, his partner's words for some of a passage, a name changed
 * everywhere, his own edit: the version on show takes them. What it was
 * stays on it (shape.js inPlaceFields): the words before, to put back; who
 * changed it; the writer's own words, for what is measured of the writer.
 *
 * Everything that follows a version's words follows them here:
 *  - the helper: the words it read kept for it (archivist.retireIfSeen), so
 *    it reads the change as a change, and its reading of the words before
 *    kept beside the new one (readings.js readingAt) — put back, the notes
 *    go back with no reading;
 *  - the checker: what it found in the words before kept with them, and put
 *    back with them; what it finds in the new words set by the caller;
 *  - the bibliography: its facts carried to the new words where each still
 *    stands in them (bibliography.js carriedCodex), the facts of the words
 *    before kept with them;
 *  - the Timeline: its turns carried the same way (timeline.js
 *    carriedContinuity, 2.12.37) — else none, and the passage is read for
 *    them again.
 */

import * as store from '../store.js';
import { chapterSteps, novelSteps, picked, inPlaceFields, putBackFields, writtenOf, END_KEYS, sameEnd, goneWith, whoseGrown, whoseGrownBefore, NOTE_KINDS, relaidOn, setChapterWords } from './shape.js';
import { hashText, countWords } from '../util.js';
import { codexNow, carriedCodex, entriesForNotes } from './bibliography.js';
import { carriedContinuity, continuityNow } from './timeline.js';
import { nameWordsOf, bookEvidence } from './names.js';

/* THE BOOK'S NAMES AS THEY ARE NOW, BY THEIR WORDS (names.js nameWordsOf): his entries' and the notes' cards' — a person's
 * apart from a place's, a thing's or lore's, never a thread's title (a telling, not a name) — what a change took out of
 * a page is decided with, as it is made (shape.js inPlaceFields `took` — 2.12.41, the review of 2.12.41: "Will" taken
 * out of a page that also says "he will" was no name taken out). Kept while the names are the same. */
let namesKept = { sig: '', words: null };
export function bookNameWords(novel) {
  if (!novel) return null;
  const people = [];
  const things = [];
  /* (never an entry set to Never: his words for himself alone decide nothing — 2.12.41, the review of 2.12.41, as
   * bibliography.js entriesForNotes keeps them from the notes) */
  for (const e of entriesForNotes(novel)) (e.kind === 'people' ? people : things).push(e.name, ...(e.aka || []));
  for (const kind of NOTE_KINDS) if (kind !== 'threads') for (const c of ((novel.notes || {})[kind]) || []) if (c) (kind === 'people' ? people : things).push(c.name, ...(c.aka || []));
  const sig = hashText(`${people.join('\u0001')}\u0002${things.join('\u0001')}`);
  if (namesKept.sig !== sig) namesKept = { sig, words: nameWordsOf(people, things) };
  return namesKept.words;
}
const namesOfBook = (novelId) => bookNameWords(novelId ? store.peek('novel', novelId) : null);
/* THE BOOK'S WORDS, FOR WHAT IT WRITES OF A WORD (names.js bookEvidence — 2.12.41, round 5: a word is a name only by
 * evidence, the whole book's, never the page's in hand alone): its pages as they read, what the cards say, and his
 * own words — his premises and notes on every version, the chapters' plans, his entries, his words for the book — each
 * given as his ({text, his: true}: one he typed in small letters says nothing by them); their sentences, never a name
 * or a title, whose every word has its capital ("The Long Night" makes no "Night" a name) */
export function bookTexts(novel, chapters) {
  if (!novel) return [];
  const out = new Map();
  const add = (t, his) => { if (typeof t === 'string' && t.trim()) out.set(t, his && (out.get(t) ?? true)); };
  for (const c of chapters || []) {
    if (!c) continue;
    add(c.plan, true);
    for (const p of c.passages || []) {
      if (!p || p.by === 'break') continue;
      add((picked(p) || {}).text, false);
      for (const v of p.versions || []) if (v && v.ask && typeof v.ask === 'object') for (const f of ['direction', 'premise', 'note']) add(v.ask[f], true);
    }
  }
  for (const kind of NOTE_KINDS) for (const card of ((novel.notes || {})[kind]) || []) if (card && typeof card === 'object') for (const k of ['about', 'ties', 'now', 'since', 'text']) add(card[k], false);
  for (const e of Array.isArray(novel.bibliography) ? novel.bibliography : []) if (e) { add(e.line, true); add(e.text, true); }
  for (const k of ['brief', 'style', 'plans', 'ending']) add(novel[k], true);
  return [...out].map(([text, his]) => ({ text, his }));
}
/* (the chapters' words, for what a slip of the pen of his entry was: the pages as they read, his premises and notes on
 * every version, the chapters' plans) */
export function chapterTexts(chapters) {
  const out = new Set();
  const add = (t) => { if (typeof t === 'string' && t.trim()) out.add(t); };
  for (const c of chapters || []) {
    if (!c) continue;
    add(c.plan);
    for (const p of c.passages || []) {
      if (!p || p.by === 'break') continue;
      add((picked(p) || {}).text);
      for (const v of p.versions || []) if (v && v.ask && typeof v.ask === 'object') for (const f of ['direction', 'premise', 'note']) add(v.ask[f]);
    }
  }
  return [...out];
}
/* (the words of a book's pages for what his entry's slip of the pen was — shape.js wordsElsewhere, whose steps have the
 * book's record only) */
setChapterWords((novel) => chapterTexts(((novel && novel.order) || []).map((id) => store.peek('chapter', id))));
/* (what the book writes of a word, as it stands in this window — asked only where a page cannot tell) */
const bookOf = (novelId) => bookEvidence(() => {
  const novel = novelId ? store.peek('novel', novelId) : null;
  return novel ? bookTexts(novel, (novel.order || []).map((id) => store.peek('chapter', id))) : [];
});

/* FACTS AND TURNS OF OTHER WORDS STAY AS THEY STAND (2.12.40, the audit): a version's facts or turns that are not of its
 * words as they stand are of the words the helper read before them — a Go on leaves them with the words it grew from,
 * and the helper reads what it added as a change against them (archivist.js codexBefore, turnsBefore). A change in
 * place before that reading never carries them (they are not of the words it changes) and never takes them away. */
const otherWords = (kept, now) => (kept && !now ? kept : undefined);

/* the helper's side, given by archivist.js as it loads (the writer changes words in place too, and never imports the helper) */
let helper = { retire: () => {}, rekey: () => {} };
export function setHelperHooks(h) { helper = { ...helper, ...h }; }
const retireIfSeen = (...a) => helper.retire(...a);
const rekeyVersion = (...a) => helper.rekey(...a);

function find(chapterId, passageId, versionId) {
  const ch = store.peek('chapter', chapterId);
  const p = ch && (ch.passages || []).find((x) => x.id === passageId);
  const v = p && (versionId ? (p.versions || []).find((x) => x.id === versionId) : picked(p));
  return { ch, p, v };
}

/* The words of one version changed in place by `by` ('checker', 'partner',
 * 'you'). check: what the checker finds in the new words (set with them);
 * keepEnd: whether it still stops where it stopped (its Go on stays) —
 * true unless the change wrote its end; tail: what was taken off it is put
 * back on it (Put back what was taken off); retire: false when the caller
 * moves what the helper read itself (a name changed everywhere).
 * {before, after} or null when nothing changed. */
/* remake: what the change makes of words another window changed since (a name changed everywhere: the names changed in
 * them as they stand) — else, his own edit his words, the writer's words put back only on the words they were taken
 * off, anything else where the words it changed still stand once (inPlaceStep). */
export function changeInPlace({ novelId, chapterId, passageId, versionId, next, by, check = null, keepEnd = true, tail = false, retire = true, extra = {}, remake = null }) {
  const { v } = find(chapterId, passageId, versionId);
  if (!v || v.streaming) return null;
  const was = String(v.text || '');
  const after = String(next == null ? '' : next);
  if (after === was || !after.trim()) return null;
  if (retire && novelId) retireIfSeen(novelId, chapterId, passageId, v.id);
  const back = Boolean(extra && extra.back);
  const again = typeof remake === 'function' ? remake : back ? () => null : by === 'you' ? () => after : (now) => relaidOn(was, after, now);
  store.change('chapter', chapterId, inPlaceStep({ passageId, versionId: v.id, was, after, by, at: Date.now(), keepEnd, tail, extra, names: namesOfBook(novelId), book: () => bookOf(novelId), remake: again }), { now: true });
  if (check) store.change('chapter', chapterId, chapterSteps.setCheck(passageId, v.id, check), { now: true });
  if (novelId) store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  return { before: was, after, versionId: v.id };
}

/* THE CHANGE IN PLACE, AS THE STEP THE STORE KEEPS (2.12.41, a step laid again over another window's newer copy — its
 * save turned away, or news of a newer copy come while it waited): laid on the version as the copy it is laid on has
 * it, never as this window had it. Where the words still read as the change found them, it goes in as it was made;
 * where they read as it left them (or the version keeps it among its words before), it is in already, and nothing is
 * laid twice; where another window changed them since, what `remake` makes of them goes in — a name changed everywhere
 * changes the names in them as they stand; his own edit is his word (these are now the words: the newer ones kept with
 * the words before, for Put back the words before); anything else only where the words it changed still stand once, a
 * few words either side (shape.js relaidOn) — or nothing, and the app's own look takes over: the checker looks again at
 * words it has not checked, his partner's card says the page no longer reads that way (changes.js madeGone). Through
 * 2.12.40 the fields were worked out from this window's copy and set whole: his typing in another window was lost to a
 * fix of the checker's, a change of his partner's or a name changed everywhere, made from the older words. */
/* (book: what the book writes of a word, asked afresh each time the step is laid — bookOf, as the copy stands then) */
function inPlaceStep({ passageId, versionId, was, after, by, at, keepEnd, tail, extra, names, book = null, remake }) {
  return (c) => {
    const p = (c.passages || []).find((x) => x.id === passageId);
    const v = p && (p.versions || []).find((x) => x.id === versionId);
    if (!v || v.streaming) return false;
    const now = String(v.text || '');
    let to = after;
    if (now !== was) {
      if (now === after || (Array.isArray(v.before) && v.before.some((b) => b && b.at === at && b.by === by))) return false;
      to = remake(now);
      if (typeof to !== 'string' || to === now || !to.trim()) return false;
    }
    const e = c.checks && c.checks[passageId] && c.checks[passageId][versionId];
    const found = e && e.sig === hashText(now) ? e : null;
    const facts = codexNow(v);
    const turns = continuityNow(v);
    const fields = inPlaceFields(v, to, by, { at, check: found, codex: facts, continuity: turns, keepEnd, tail, extra, names, book: book ? book() : null, passage: p });
    fields.codex = (facts && carriedCodex(facts, to)) || otherWords(v.codex, facts);
    fields.continuity = (turns && carriedContinuity(turns, to)) || otherWords(v.continuity, turns);
    /* a page fixed by the app is no longer one he put back as it was */
    fields.fixesBack = undefined;
    chapterSteps.setVersion(passageId, versionId, fields)(c);
    return true;
  };
}

/* The newest words before put back (his Put back the words before, or the
 * Undo of one change — expect: the words that change left, refused when
 * they have changed since). The checker's findings and the facts of those
 * words come back with them; the fixes it would put in by itself wait for
 * him on words he put back himself (`fixesBack`). {ok, by} or {ok:false, said} */
/* before: the words the Undo of one change expects back — when they are not the newest kept on it (kept no more),
 * they are put back as they are; retire: false where the caller moves what the helper read itself; hold: false
 * for the Undo of his partner's change or a name changed everywhere (the words go back to what they were — fixes
 * waiting on them may go in by themselves as before) */
export function putBackWords({ novelId, chapterId, passageId, versionId = null, expect = null, before = null, retire = true, hold = true }) {
  const { p, v } = find(chapterId, passageId, versionId);
  if (!p) return { ok: false, said: 'that passage is not there any more' };
  if (!v) return { ok: false, said: 'that version is not there any more' };
  if (v.streaming) return { ok: false, said: 'the passage is being written just now' };
  if (expect !== null && String(v.text || '') !== String(expect)) return { ok: false, said: 'the passage has changed since' };
  let back = putBackFields(v);
  /* (words put back that are not the newest kept: the base of the fixes by themselves is these words — nothing in them
   * went in by itself since. Never the base before: it is of other words, and the changes kept on the version are not
   * these words' — shape.js autoBaseOf would read one of them; 2.12.35, the review) */
  if (before !== null && (!back || back.patch.text !== String(before))) back = { patch: { text: String(before), words: countWords(String(before)), autoBase: String(before) }, check: null, codex: null, continuity: null, by: '' };
  if (!back) return { ok: false, said: 'there are no words before to put back' };
  if (novelId && retire) retireIfSeen(novelId, chapterId, passageId, v.id);
  /* (worked out again on the copy the step is laid on, and laid only while the version still reads as the words found
   * here — never the words before put back over words another window wrote since: 2.12.41, a step laid again over
   * another window's newer copy) */
  store.change('chapter', chapterId, backStep({ passageId, versionId: v.id, expect: String(v.text || ''), before, hold }), { now: true });
  if (novelId) store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  return { ok: true, by: back.by, versionId: v.id };
}
/* the words before, put back as a step: on the version as the copy has it, while it reads as `expect` */
function backStep({ passageId, versionId, expect, before, hold }) {
  return (c) => {
    const p = (c.passages || []).find((x) => x.id === passageId);
    const v = p && (p.versions || []).find((x) => x.id === versionId);
    if (!v || v.streaming || String(v.text || '') !== expect) return false;
    let back = putBackFields(v);
    if (before !== null && (!back || back.patch.text !== String(before))) back = { patch: { text: String(before), words: countWords(String(before)), autoBase: String(before) }, check: null, codex: null, continuity: null, by: '' };
    if (!back) return false;
    const now = codexNow(v);
    const turnsNow = continuityNow(v);
    const to = back.patch.text;
    back.patch.codex = (back.codex && codexNow({ text: to, codex: back.codex })) || (now && carriedCodex(now, to)) || otherWords(v.codex, now);
    /* the turns of the words put back come back with them, as their facts (2.12.40, the audit: a name changed everywhere,
     * undone, left every passage it touched with no turns — a paid reading of each to get them back) */
    back.patch.continuity = (back.continuity && continuityNow({ text: to, continuity: back.continuity })) || (turnsNow && carriedContinuity(turnsNow, to)) || otherWords(v.continuity, turnsNow);
    back.patch.fixesBack = hold ? hashText(to) : undefined;
    chapterSteps.setVersion(passageId, versionId, back.patch)(c);
    if (back.check && back.check.sig === hashText(to)) chapterSteps.setCheck(passageId, versionId, back.check)(c);
    return true;
  };
}

/* One version's words put on the version it was made from, and the one
 * gone (a sentence the checker had written again, kept the moment it is
 * written; a fix made before 2.12.2 as a version of its own): the words are
 * the other's, its own words before them kept — the helper's reading,
 * the checker's findings and the facts of the words moved with them, nothing
 * read or checked again. Whether it was folded. */
export function foldVersion({ novelId, chapterId, passageId, childId, targetId, by }) {
  const { p } = find(chapterId, passageId, null);
  const child = p && (p.versions || []).find((x) => x.id === childId);
  const target = p && (p.versions || []).find((x) => x.id === targetId);
  if (!child || !target || child.streaming || target.streaming || childId === targetId) return false;
  const ch = store.peek('chapter', chapterId);
  const next = String(child.text || '');
  if (!next.trim()) return false;
  const was = String(target.text || '');
  const e = ch.checks && ch.checks[passageId] && ch.checks[passageId][targetId];
  const found = e && e.sig === hashText(was) ? e : null;
  store.change('chapter', chapterId, foldStep({ passageId, childId, targetId, was, by, at: child.done || child.at || Date.now(), names: namesOfBook(novelId), book: () => bookOf(novelId) }), { now: true });
  /* a fix's checking kept no grade before 2.6.3: the grade of the words it was made from goes with it (checker.js
   * keepGrades) — theirs, or the newest kept with the words before them */
  const after = store.peek('chapter', chapterId);
  const moved = after && after.checks && after.checks[passageId] && after.checks[passageId][targetId];
  const fromGrade = (found && found.grade) || [...(target.before || [])].reverse().map((b) => b && b.check && b.check.grade).find(Boolean);
  if (moved && !moved.grade && fromGrade && moved.sig === hashText(next)) store.change('chapter', chapterId, chapterSteps.setCheck(passageId, targetId, { ...moved, grade: fromGrade }, moved), { now: true });
  if (novelId) rekeyVersion(novelId, chapterId, passageId, childId, targetId);
  return true;
}
/* THE FOLD AS THE STEP THE STORE KEEPS (2.12.41, a step laid again over another window's newer copy — through 2.12.40
 * its patch was worked out from this window's copy and set whole: his edit of the page made in another window while the
 * checker wrote a sentence of it again was written over by the old words with the new sentence). Laid on the other
 * version as the copy has it, while it still reads as the words the one gone was made from (`was`); where they have
 * changed since, the one gone goes all the same — never a version of old words left beside them — and its new words go
 * in where the words they replace still stand once in the newer ones, a few words either side (shape.js relaidOn), as a
 * sentence written again goes in when the page changed while it was written (writer.js writeSpanAgain); else nothing. */
function foldStep({ passageId, childId, targetId, was, by, at, names, book = null }) {
  return (c) => {
    const p = (c.passages || []).find((x) => x.id === passageId);
    const child = p && (p.versions || []).find((x) => x.id === childId);
    const target = p && (p.versions || []).find((x) => x.id === targetId);
    if (!child || !target || child.streaming || target.streaming) return false;
    const next = String(child.text || '');
    const now = String(target.text || '');
    const e = c.checks && c.checks[passageId] && c.checks[passageId][targetId];
    const found = e && e.sig === hashText(now) ? e : null;
    const facts = codexNow(target);
    const turns = continuityNow(target);
    const counted = (patch) => {
      const notes = [...(target.notes || []), ...(child.notes || []).filter((x) => !(target.notes || []).includes(x))];
      if (notes.length) patch.notes = notes;
      if (child.spanAuto || child.spans) patch.spans = (target.spans || 0) + (child.spanAuto ? 1 : 0) + (child.spans || 0);
      if (Array.isArray(child.spanFailed) && child.spanFailed.length) patch.spanFailed = [...new Set([...(target.spanFailed || []), ...child.spanFailed])];
      return patch;
    };
    if (now === was) {
      const patch = next === was ? {} : inPlaceFields(target, next, by, { check: found, codex: facts, continuity: turns, at, extra: child.spanAuto ? { auto: true } : {}, names, book: book ? book() : null, passage: p });
      /* the words' own end and what was taken off them come with them */
      for (const k of END_KEYS) patch[k] = child[k];
      patch.tookOff = child.tookOff;
      patch.tookOffTop = child.tookOffTop;
      patch.codex = codexNow(child) || (facts && carriedCodex(facts, next)) || undefined;
      /* (the turns of the words it takes, or of the words it had carried to them — never turns left with other words) */
      patch.continuity = continuityNow(child) || (turns && carriedContinuity(turns, next)) || undefined;
      chapterSteps.foldVersion(passageId, childId, targetId, counted(patch))(c);
      return true;
    }
    const to = relaidOn(was, next, now);
    chapterSteps.removeVersion(passageId, childId)(c);
    if (typeof to !== 'string' || to === now || !to.trim()) return true;
    const fields = counted(inPlaceFields(target, to, by, { at, check: found, codex: facts, continuity: turns, extra: child.spanAuto ? { auto: true } : {}, names, book: book ? book() : null, passage: p }));
    fields.codex = (facts && carriedCodex(facts, to)) || otherWords(target.codex, facts);
    fields.continuity = (turns && carriedContinuity(turns, to)) || otherWords(target.continuity, turns);
    fields.fixesBack = undefined;
    chapterSteps.setVersion(passageId, targetId, fields)(c);
    return true;
  };
}

/* the words as the writer wrote them grew (Go on): its own words, and the
 * words before each change that end as these did, grow with them */
/* (passage: the version's own — for who put in the words of a version made from another, and the names its premise
 * gives: 2.12.41, the review of 2.12.41 — without it, a Go on of a few of his own page's words written again gave all of
 * it to the writer) */
export function grownFields(v, more, passage = null) {
  const was = String((v && v.text) || '');
  const out = {};
  if (v && typeof v.written === 'string' && sameEnd(v.written, was)) out.written = v.written + more;
  /* (the base of the fixes put in by itself grows with the words: what is added was never changed by itself) */
  if (v && typeof v.autoBase === 'string') out.autoBase = sameEnd(v.autoBase, was) ? v.autoBase + more : undefined;
  if (v && Array.isArray(v.before) && v.before.length) {
    const list = v.before;
    const grows = list.map((b) => Boolean(b) && sameEnd(b.text, was));
    /* (what was found in them, their facts and their turns are of the words before they grew: not kept with them) */
    const kept = list.filter((_, i) => grows[i]).map((b) => ({ ...b, text: b.text + more, check: undefined, codex: undefined, continuity: undefined, whose: whoseGrownBefore(b, more) }));
    out.before = kept.length ? kept.map((b) => JSON.parse(JSON.stringify(b))) : undefined;
    /* WHAT A CHANGE LEFT BEHIND DID IS KEPT (2.12.41, the review of 2.12.41: a change that touched the page's last words
     * cannot grow with it, and went — with it what his edit took out of the page, so his premise was the book again,
     * and what his hand put in): into `gone`, by the same step as the changes let go past BEFORE_KEEP (shape.js goneWith) */
    const left = list.map((_, i) => i).filter((i) => !grows[i]);
    if (left.length) out.gone = goneWith(v.gone, list, left, was, passage);
  }
  /* (who put in each word: the words added the writer's — shape.js whose) */
  if (v) out.whose = whoseGrown(v, more, passage);
  return out;
}

export { writtenOf };
