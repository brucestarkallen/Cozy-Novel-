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
import { chapterSteps, novelSteps, picked, inPlaceFields, putBackFields, writtenOf, END_KEYS, sameEnd } from './shape.js';
import { hashText, countWords } from '../util.js';
import { codexNow, carriedCodex } from './bibliography.js';
import { carriedContinuity } from './timeline.js';

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
export function changeInPlace({ novelId, chapterId, passageId, versionId, next, by, check = null, keepEnd = true, tail = false, retire = true, extra = {} }) {
  const { ch, v } = find(chapterId, passageId, versionId);
  if (!v || v.streaming) return null;
  const was = String(v.text || '');
  const after = String(next == null ? '' : next);
  if (after === was || !after.trim()) return null;
  const e = ch.checks && ch.checks[passageId] && ch.checks[passageId][v.id];
  const found = e && e.sig === hashText(was) ? e : null;
  const facts = codexNow(v);
  if (retire && novelId) retireIfSeen(novelId, chapterId, passageId, v.id);
  const fields = inPlaceFields(v, after, by, { check: found, codex: facts, keepEnd, tail, extra });
  fields.codex = (facts && carriedCodex(facts, after)) || undefined;
  fields.continuity = carriedContinuity(v.continuity, after) || undefined;
  /* a page fixed by the app is no longer one he put back as it was */
  fields.fixesBack = undefined;
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, v.id, fields), { now: true });
  if (check) store.change('chapter', chapterId, chapterSteps.setCheck(passageId, v.id, check), { now: true });
  if (novelId) store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  return { before: was, after, versionId: v.id };
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
  if (before !== null && (!back || back.patch.text !== String(before))) back = { patch: { text: String(before), words: countWords(String(before)), autoBase: String(before) }, check: null, codex: null, by: '' };
  if (!back) return { ok: false, said: 'there are no words before to put back' };
  if (novelId && retire) retireIfSeen(novelId, chapterId, passageId, v.id);
  const now = codexNow(v);
  const to = back.patch.text;
  back.patch.codex = (back.codex && codexNow({ text: to, codex: back.codex })) || (now && carriedCodex(now, to)) || undefined;
  back.patch.continuity = carriedContinuity(v.continuity, to) || undefined;
  back.patch.fixesBack = hold ? hashText(to) : undefined;
  store.change('chapter', chapterId, chapterSteps.setVersion(passageId, v.id, back.patch), { now: true });
  if (back.check && back.check.sig === hashText(to)) store.change('chapter', chapterId, chapterSteps.setCheck(passageId, v.id, back.check), { now: true });
  if (novelId) store.change('novel', novelId, novelSteps.touchWritten(Date.now()));
  return { ok: true, by: back.by, versionId: v.id };
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
  const facts = codexNow(target);
  const patch = next === was ? {} : inPlaceFields(target, next, by, { check: found, codex: facts, at: child.done || child.at || Date.now(), extra: child.spanAuto ? { auto: true } : {} });
  /* the words' own end and what was taken off them come with them */
  for (const k of END_KEYS) patch[k] = child[k];
  patch.tookOff = child.tookOff;
  patch.tookOffTop = child.tookOffTop;
  patch.codex = codexNow(child) || (facts && carriedCodex(facts, next)) || undefined;
  patch.continuity = carriedContinuity(child.continuity, next) || carriedContinuity(target.continuity, next) || undefined;
  const notes = [...(target.notes || []), ...(child.notes || []).filter((n) => !(target.notes || []).includes(n))];
  if (notes.length) patch.notes = notes;
  if (child.spanAuto || child.spans) patch.spans = (target.spans || 0) + (child.spanAuto ? 1 : 0) + (child.spans || 0);
  if (Array.isArray(child.spanFailed) && child.spanFailed.length) patch.spanFailed = [...new Set([...(target.spanFailed || []), ...child.spanFailed])];
  store.change('chapter', chapterId, chapterSteps.foldVersion(passageId, childId, targetId, patch), { now: true });
  /* a fix's checking kept no grade before 2.6.3: the grade of the words it was made from goes with it (checker.js
   * keepGrades) — theirs, or the newest kept with the words before them */
  const after = store.peek('chapter', chapterId);
  const moved = after && after.checks && after.checks[passageId] && after.checks[passageId][targetId];
  const fromGrade = (found && found.grade) || [...(target.before || [])].reverse().map((b) => b && b.check && b.check.grade).find(Boolean);
  if (moved && !moved.grade && fromGrade && moved.sig === hashText(next)) store.change('chapter', chapterId, chapterSteps.setCheck(passageId, targetId, { ...moved, grade: fromGrade }), { now: true });
  if (novelId) rekeyVersion(novelId, chapterId, passageId, childId, targetId);
  return true;
}

/* the words as the writer wrote them grew (Go on): its own words, and the
 * words before each change that end as these did, grow with them */
export function grownFields(v, more) {
  const was = String((v && v.text) || '');
  const out = {};
  if (v && typeof v.written === 'string' && sameEnd(v.written, was)) out.written = v.written + more;
  /* (the base of the fixes put in by itself grows with the words: what is added was never changed by itself) */
  if (v && typeof v.autoBase === 'string') out.autoBase = sameEnd(v.autoBase, was) ? v.autoBase + more : undefined;
  if (v && Array.isArray(v.before) && v.before.length) {
    const kept = v.before.filter((b) => b && sameEnd(b.text, was)).map((b) => ({ ...b, text: b.text + more, check: undefined, codex: undefined }));
    out.before = kept.length ? kept.map((b) => JSON.parse(JSON.stringify(b))) : undefined;
  }
  return out;
}

export { writtenOf };
