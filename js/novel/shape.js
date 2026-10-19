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
 *   draft   { id:novelId, novelId, direction, partner, play:{}, cards:{} }
 */

import { newId, countWords, hashText, numberWords, nameKey } from '../util.js';
import { samePersonName, plainName, sameThingName, isDescriptorName, nameInText, nearName, nameWordsGone, foldName, premiseLocal } from './names.js';

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

/* Optional defaults for new narration. Missing and unrecognised values
 * follow his instructions and the established book, as older books did. */
export const POVS = {
  auto: { label: 'Follow the book', hint: 'Use your instructions and the point of view already established in the story.' },
  first: { label: 'First person — I', hint: 'Tell the story as “I”, through the narrator’s own experience and knowledge.' },
  second: { label: 'Second person — you', hint: 'Address the viewpoint character as “you”, through what they experience.' },
  'third-limited': { label: 'Third person — close', hint: 'Use names, “he”, “she” or “they”, staying with one character’s experience and knowledge at a time.' },
  'third-omniscient': { label: 'Third person — all-knowing', hint: 'An all-knowing narrator may reveal more than any one character knows, including different people’s thoughts.' },
};
export const TENSES = {
  auto: { label: 'Follow the book', hint: 'Use your instructions and the tense already established in the story.' },
  past: { label: 'Past — she opened the door', hint: 'Tell the main action as something that happened: “She opened the door.”' },
  present: { label: 'Present — she opens the door', hint: 'Tell the main action as it happens: “She opens the door.”' },
};
export function povOf(novel) { const v = novel && novel.prefs && novel.prefs.pov; return Object.hasOwn(POVS, v) ? v : 'auto'; }
export function tenseOf(novel) { const v = novel && novel.prefs && novel.prefs.tense; return Object.hasOwn(TENSES, v) ? v : 'auto'; }

export function coverFor(title) {
  const h = parseInt(hashText(title).slice(0, 6), 36) || 0;
  return COVERS[h % COVERS.length];
}

export function newVersion(fields = {}) {
  return { id: newId('v'), text: '', at: Date.now(), ...fields };
}

/* WHERE A VERSION STOPS, carried to one made from it (Cozy Tavern's M511-1,
 * M548): cut short at its end and why, stopped by his hand — so Go on is
 * still offered for it. A version made by changing words inside it keeps
 * these; one he finished himself does not (sameEnd). A few selected words
 * rewritten that stopped partway are cut in the middle, not at the end: Go
 * on cannot mend that, and it is not carried. */
export function cutAtEnd(v) { return Boolean(v && v.cut && (v.how !== 'selection' || v.endCut)); }
export function endOf(v) {
  const out = {};
  if (!cutAtEnd(v)) return out;
  for (const k of ['cut', 'cutWhy', 'cutBy', 'stopped']) if (v[k] !== undefined) out[k] = v[k];
  return out;
}
/* WHOSE WORDS, AND FROM WHEN (Cozy Tavern's M607 keepWritersOwn): a version
 * made from another by fixing words in place — a fix he applied, the
 * partner's, a name changed everywhere, a few words rewritten — keeps the
 * root it came from: his own words stay his, and writing from before the
 * checker began stays from before it. */
export function rootOf(v) {
  if (!v) return {};
  return { rootHow: v.rootHow || v.how, rootAt: v.rootAt || v.done || v.at || 0 };
}
export const howOf = (v) => (v && (v.rootHow || v.how)) || '';
export const bornOf = (v) => (v ? v.rootAt || v.done || v.at || 0 : 0);
/* What was taken off a page — a heading above it, a note or tracking after
 * it — kept with a version made from it in place (a fix, his partner's
 * words, a few words written again, his edit that keeps its end), so its
 * Put back stays (Cozy Tavern M46/M55: a copy made field by field dropped
 * what was not on its list) */
/* what wrote a version's words, kept with a version made from it by changing some of them — the checker's fixes,
 * his partner's words, his own edit: the request it was written from (What the writer was sent) and its thinking.
 * Never the model: the new version is no longer that model's own whole page. */
export function writtenWith(v) {
  if (!v) return {};
  return { ...(v.thinking ? { thinking: v.thinking } : {}), ...(v.sent ? { sent: v.sent } : {}), ...(Array.isArray(v.sentMore) && v.sentMore.length ? { sentMore: v.sentMore.slice() } : {}) };
}
export function keptTail(v) {
  if (!v) return {};
  return { ...(String(v.tookOff || '').trim() ? { tookOff: v.tookOff } : {}), ...(String(v.tookOffTop || '').trim() ? { tookOffTop: v.tookOffTop } : {}) };
}
/* WORDS CHANGED IN PLACE (his word, 2.12.2: "rewrite is the only thing who
 * create new version"; "new version is only for rewrite or another take").
 * A fix the checker put in, a sentence it had written again, his partner's
 * words, his own edit, a name changed everywhere: the version on show takes
 * them, as a page takes a correction. Kept on it:
 *  - `before`: the words before each change, the newest last (the first
 *    words and the newest BEFORE_KEEP - 1 changes: keptBefore) — Put back
 *    the words before brings the newest back, with
 *    what the checker had found in them and the bibliography's facts and the
 *    Timeline's turns of them (on the newest only), whether it stopped short,
 *    and what had been taken off it; and what the change did, decided as it
 *    is made (2.12.41): the names it took out of the page (`took`) and how
 *    many words it put in (`moved`) — a name changed everywhere marked
 *    `rename`, the writer's own words put back where they stood (Put back
 *    what was taken off) `back`;
 *  - `gone`: what the changes let go did, by hand — past BEFORE_KEEP, or by
 *    a Go on that left them behind (inplace.js grownFields) — {you: {took,
 *    moved, at}, …}, so what they took out is never forgotten;
 *  - `hands`: who changed its words — 'checker', 'partner', 'you' (a name
 *    changed everywhere, or the writer's words put back, is no one's hand);
 *  - `whose`: who put in each word on it now (`runs` over its words, kept
 *    by the print of its words, `fp`) — the writer's 'w', 'you', 'partner',
 *    'checker' — each change's words its own, a name changed everywhere the
 *    hand of the word it replaced (2.12.41, the review of 2.12.41: ownWords);
 *  - `written`: its words as they were before the first change — for a
 *    writer's page, the writer's own words: what is measured of the writer
 *    (its stock wording, head to head) is measured on these.
 * A new version is a take: written, another take, written again (whole, or
 * the words he selected), or a passage his partner wrote anew. */
export const BEFORE_KEEP = 5;
/* past BEFORE_KEEP, the oldest change after the first words goes — the words as first written stay first, so Put back
 * the words before always comes back to them (through 2.12.2 the oldest of all went, and with it the writer's own
 * words once a page had been changed six times) */
const keptBefore = (list) => (list.length <= BEFORE_KEEP ? list : [list[0], ...list.slice(-(BEFORE_KEEP - 1))]);
export const PRIOR_KEEP = 4;
export const handsOf = (v) => (v && Array.isArray(v.hands) ? v.hands : []);
export const writtenOf = (v) => (v ? String(typeof v.written === 'string' ? v.written : v.text || '') : '');
/* changed by him or his partner: no longer the writer's own words, nor only its words with fixes put in */
export const mixedHands = (v) => handsOf(v).some((x) => x === 'you' || x === 'partner');
export const END_KEYS = ['cut', 'cutWhy', 'cutBy', 'stopped', 'endCut'];
/* how many words a change put in: those of the new words the words before do not have, word for word (2.12.41) */
const A_WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
export function wordsPutIn(before, after) {
  const had = new Map();
  for (const m of String(before || '').matchAll(A_WORD)) { const w = m[0].toLowerCase(); had.set(w, (had.get(w) || 0) + 1); }
  let n = 0;
  for (const m of String(after || '').matchAll(A_WORD)) {
    const w = m[0].toLowerCase();
    const left = had.get(w) || 0;
    if (left > 0) had.set(w, left - 1); else n++;
  }
  return n;
}
/* what a change kept with the words before it took out of the page (`took`): as kept when it was made — or, kept before
 * 2.12.41, his own hand's read from those words and the words right after that change (`after`: the next words kept,
 * else the version's words — 2.12.41, the review of 2.12.41: read against the words now, a later name changed
 * everywhere or a fix of the checker's was blamed on his old edit); his partner's then are never counted, as a name
 * changed everywhere was not told from his other changes. (local: the names the page's own premise gives —
 * names.js premiseLocal — or the step that finds them, asked only for such a change.) */
const tookBy = (b, after, local = null) => (Array.isArray(b && b.took) ? b.took : b && b.by === 'you' ? nameWordsGone(b.text, after, { local: typeof local === 'function' ? local() : local }) : []);
/* the names a passage's own premise gives its page (names.js premiseLocal), with the book's names when they are known —
 * for a change kept before 2.12.41, read from its words, never with them (as its page's words are read: tookBy), so it
 * reads the same while it is kept (laterWords) and as it is let go (goneWith) */
const localOf = (passage, known = null, book = null) => (passage ? premiseLocal(premiseOf(passage), known, book) : null);
const localOnce = (passage) => { let had; return () => (had === undefined ? (had = localOf(passage)) : had); };
/* a change that is no one's hand on the page: a name changed everywhere (`rename`), the writer's own words put back where
 * they stood (`back`, Put back what was taken off — 2.12.41, the review of 2.12.41: it was his hand) */
export const noHand = (b) => Boolean(b && (b.rename || b.back));
/* WHAT THE CHANGES LET GO DID, KEPT ON THE VERSION BY HAND (`gone`): what they took out and how many words they put in —
 * each read from its own words and the words after it: the next in the list, else `now` (the version's words as they
 * were when they went). The one step for every change let go: past BEFORE_KEEP (inPlaceFields), and a Go on that
 * leaves behind the words before a change that ended otherwise (inplace.js grownFields — 2.12.41, the review of
 * 2.12.41: what his edit took out was forgotten, and his premise was the book again). (passage: the version's own, for
 * the names its premise gives — localOf.) */
export function goneWith(gone, list, dropped, now = '', passage = null) {
  const out = JSON.parse(JSON.stringify(gone || {}));
  const local = localOnce(passage);
  for (const i of dropped) {
    const b = list[i];
    if (!b || noHand(b) || !b.by) continue;
    const after = String(i + 1 < list.length ? (list[i + 1] && list[i + 1].text) || '' : now);
    const g = out[b.by] || (out[b.by] = { took: [], moved: 0, at: 0 });
    g.took = [...new Set([...g.took, ...tookBy(b, after, local)])].sort();
    g.moved += Number.isFinite(b.moved) ? b.moved : wordsPutIn(b.text, after);
    g.at = Math.max(g.at || 0, Number(b.at) || 0);
  }
  return Object.keys(out).length ? out : undefined;
}
/* WHO PUT IN EACH WORD ON A PAGE (2.12.41, the review of 2.12.41: ownWords multiplied shares of every word ever put in,
 * never asking whose words stand on the page now — his edit then his partner's change over all of it was still "his
 * own words", and his own rewrite of every word over his partner's was not). Each word of a version's words with the
 * hand that put it in: the writer's 'w' (his own for his own words, his partner's for a passage his partner wrote),
 * then each change's words its own — found word for word against the words before it (the words both have in the same
 * order keep their hand: wordsMatched) — a name changed everywhere the hand of the word it replaced, the writer's words
 * put back the writer's. Kept on the version by the print of its words (`whose`: {fp, runs: [[hand, n], …]}); one kept
 * before is worked out from the words before kept on it (whoseOf). */
const wordsOf = (t) => { const out = []; for (const m of String(t || '').matchAll(A_WORD)) out.push(m[0].toLowerCase()); return out; };
const baseHand = (v) => (v && v.how === 'mine' ? 'you' : v && v.how === 'partner' ? 'partner' : 'w');
const runsOf = (hands) => { const out = []; for (const h of hands) { const last = out[out.length - 1]; if (last && last[0] === h) last[1]++; else out.push([h, 1]); } return out; };
const handsFrom = (runs) => { const out = []; for (const [h, n] of runs || []) for (let i = 0; i < n; i++) out.push(h); return out; };
/* THE WORDS OF b THAT STAND IN a, IN THE SAME ORDER: for each word of b, its index in a, or -1 for a word put in.
 * A common start and end first; a stretch of a few changes (FEW_CHANGES) matched by the fewest of them at once (Myers);
 * else the words that stand once in each anchor the rest (a patience pass: the longest run of them in the same order),
 * and each stretch between two anchors is matched the same way, down to a stretch with no such word — matched by the
 * fewest changes where the words it shares can bring them within SHARED_MOST, else each word to the next one like it,
 * in order (inOrder). (2.12.41, the review of 2.12.41: one cap of 600 changes for the whole page — past it, every word
 * between the first change and the last was put in, and his own page with the checker's 330 scattered mends was 96
 * words his of 2,400; and a book of pages kept before 2.12.41 took seconds to read.) */
const FEW_CHANGES = 32;
export function wordsMatched(a, b) {
  const out = new Int32Array(b.length).fill(-1);
  const work = [[0, a.length, 0, b.length]];
  while (work.length) {
    let [a0, a1, b0, b1] = work.pop();
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { out[b0] = a0; a0++; b0++; }
    while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) { out[b1 - 1] = a1 - 1; a1--; b1--; }
    if (a0 >= a1 || b0 >= b1) continue;
    /* (a few changes: the fewest of them at once) */
    if (fewestChanges(a, b, a0, a1, b0, b1, out, FEW_CHANGES)) continue;
    const anchors = onceInEach(a, b, a0, a1, b0, b1);
    if (!anchors.length) { if (!fewestChanges(a, b, a0, a1, b0, b1, out, SHARED_MOST)) inOrder(a, b, a0, a1, b0, b1, out); continue; }
    let pa = a0;
    let pb = b0;
    for (const [ia, ib] of anchors) {
      out[ib] = ia;
      if (pa < ia && pb < ib) work.push([pa, ia, pb, ib]);
      pa = ia + 1;
      pb = ib + 1;
    }
    if (pa < a1 && pb < b1) work.push([pa, a1, pb, b1]);
  }
  return out;
}
/* the words standing once in a[a0, a1) and once in b[b0, b1), the longest run of them in the same order: [[ia, ib], …] */
function onceInEach(a, b, a0, a1, b0, b1) {
  const inA = new Map();
  for (let i = a0; i < a1; i++) { const w = a[i]; const had = inA.get(w); inA.set(w, had === undefined ? i : -1); }
  const inB = new Map();
  for (let j = b0; j < b1; j++) { const w = b[j]; if (!inA.has(w) || inA.get(w) < 0) continue; const had = inB.get(w); inB.set(w, had === undefined ? j : -1); }
  const pairs = [];
  for (const [w, j] of inB) if (j >= 0) pairs.push([inA.get(w), j]);
  if (!pairs.length) return pairs;
  pairs.sort((x, y) => x[0] - y[0]);
  /* the longest run rising in b too (patience sorting) */
  const tops = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tops[mid]][1] < pairs[i][1]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tops[lo - 1];
    tops[lo] = i;
  }
  const out = [];
  for (let i = tops[tops.length - 1]; i >= 0; i = prev[i]) out.push(pairs[i]);
  return out.reverse();
}
/* the fewest changes between a[a0, a1) and b[b0, b1) (Myers), when they are at most `cap` — whether it found them. (A
 * stretch the words it shares cannot bring within `cap` is not tried: inOrder matches it instead.) */
const SHARED_MOST = 200;
function fewestChanges(a, b, a0, a1, b0, b1, out, cap) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (cap > FEW_CHANGES) {
    const had = new Map();
    for (let i = a0; i < a1; i++) had.set(a[i], (had.get(a[i]) || 0) + 1);
    let shared = 0;
    for (let j = b0; j < b1; j++) { const c = had.get(b[j]); if (c) { shared++; had.set(b[j], c - 1); } }
    if (n + m - 2 * shared > Math.min(cap, SHARED_MOST) || shared * 4 < Math.min(n, m)) return false;
  }
  const most = Math.min(n + m, cap);
  const off = most + 1;
  const v = new Int32Array(2 * most + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= most && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return false;
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const t = trace[d];
    const k = x - y;
    const pk = k === -d || (k !== d && t[off + k - 1] < t[off + k + 1]) ? k + 1 : k - 1;
    const px = d === 0 ? 0 : t[off + pk];
    const py = d === 0 ? 0 : px - pk;
    while (x > px && y > py) { x--; y--; out[b0 + y] = a0 + x; }
    x = px; y = py;
  }
  return true;
}
/* a stretch of many changes and no word once in each (words written again mostly anew): each word of b matched to the
 * next one like it in a, in order — never the most of them, but each word kept where it plainly stands */
function inOrder(a, b, a0, a1, b0, b1, out) {
  const at = new Map();
  for (let i = a0; i < a1; i++) { const l = at.get(a[i]); if (l) l.push(i); else at.set(a[i], [i]); }
  const next = new Map();
  let last = a0 - 1;
  for (let j = b0; j < b1; j++) {
    const l = at.get(b[j]);
    if (!l) continue;
    let p = next.get(b[j]) || 0;
    while (p < l.length && l[p] <= last) p++;
    next.set(b[j], p);
    if (p < l.length) { out[j] = l[p]; last = l[p]; next.set(b[j], p + 1); }
  }
}
/* the hand of each word of `next`, from the hand of each word of `was` and the change made by `by` (rename: the hand of
 * the word it replaced; back: the writer's) */
function handsAfter(handsWas, was, next, by, { rename = false, back = false } = {}) {
  const a = wordsOf(was);
  const b = wordsOf(next);
  const ha = handsWas.length === a.length ? handsWas : a.map(() => 'w');
  const map = wordsMatched(a, b);
  const out = new Array(b.length);
  let lastA = -1;
  for (let j = 0; j < b.length; j++) {
    if (map[j] >= 0) { out[j] = ha[map[j]]; lastA = map[j]; continue; }
    let k = j;
    while (k < b.length && map[k] < 0) k++;
    const nextA = k < b.length ? map[k] : a.length;
    const replaced = ha.slice(lastA + 1, nextA);
    const near = lastA >= 0 ? ha[lastA] : nextA < a.length ? ha[nextA] : 'w';
    for (let t = j; t < k; t++) out[t] = back ? 'w' : rename ? (replaced.length ? replaced[Math.min(replaced.length - 1, Math.floor(((t - j) * replaced.length) / (k - j)))] : near) : by;
    j = k - 1;
  }
  return out;
}
/* the hand of each word of a version's words: as kept (`whose`, while its print is the words'), else worked out from the
 * words before kept on it, each change by its own hand — the changes let go between the first words and the next kept
 * (`gone`) sharing what that step put in by what each put in (`moved`); kept by the version and its words */
const WHOSE_KEPT = new Map();
/* (how many words a text has, by its print — a kept `whose` holds a hand for each, or it is worked out again: 2.12.41,
 * the review of 2.12.41 — a Go on that joined a word cut short counted one hand too many, and the next change gave
 * every word on the page to the writer) */
const WORDS_COUNTED = new Map();
const wordsCounted = (text, fp) => {
  let n = WORDS_COUNTED.get(fp);
  if (n === undefined) { n = wordsOf(text).length; if (WORDS_COUNTED.size >= 4000) WORDS_COUNTED.clear(); WORDS_COUNTED.set(fp, n); }
  return n;
};
const runsCount = (runs) => { let n = 0; for (const r of runs) n += Number(r && r[1]) || 0; return n; };
const runsFit = (w, text, fp = hashText(String(text || ''))) => Boolean(w) && Array.isArray(w.runs) && w.fp === fp && runsCount(w.runs) === wordsCounted(String(text || ''), fp);
/* (each change kept on a version by its hand and its marks, for what is kept of its words' hands) */
const changesSig = (v) => (Array.isArray(v && v.before) ? v.before : []).map((b) => `${(b && b.by) || ''}:${b && b.rename ? 'r' : ''}${b && b.back ? 'b' : ''}:${(b && b.at) || ''}`).join(',');
/* (kept with more hands than words, as a Go on that joined a word cut short kept them before the review of 2.12.41: the
 * writer's words it put in at the end counted one too many for each word joined — trimmed from them; null where the
 * hands are not of that shape) */
function runsTrimmed(w, n) {
  let over = runsCount(w.runs) - n;
  if (over <= 0) return null;
  const runs = w.runs.map((r) => [r[0], Number(r[1]) || 0]);
  for (let i = runs.length - 1; i >= 0 && over > 0 && runs[i][0] === 'w'; i--) {
    const take = Math.min(over, runs[i][1]);
    runs[i][1] -= take;
    over -= take;
  }
  return over > 0 ? null : handsFrom(runs.filter((r) => r[1] > 0));
}
function whoseOf(v, passage = null, depth = 0) {
  const work = whoseWork(v, passage, depth);
  let r = work.next();
  while (!r.done) r = work.next();
  return r.value;
}
/* (worked out a change at a time, giving way after each — mend.js keepWhose lets the page have its turn between them:
 * round 5, the review of round 4) */
function* whoseWork(v, passage = null, depth = 0) {
  const text = String((v && v.text) || '');
  const fp = hashText(text);
  if (v && runsFit(v.whose, text, fp)) return handsFrom(v.whose.runs);
  if (v && v.whose && v.whose.fp === fp && Array.isArray(v.whose.runs)) { const trimmed = runsTrimmed(v.whose, wordsCounted(text, fp)); if (trimmed) return trimmed; }
  const before = Array.isArray(v && v.before) ? v.before : [];
  /* (a version made from another by changing some of its words: his edit kept as a version of its own, before 2.12.2;
   * a few words written again at his note — the rest the words they came from, his own on a page of his: 2.12.41, the
   * review of 2.12.41, a few words written again on his own page made all of it the writer's) */
  const from = v && passage && (v.how === 'edit' || v.how === 'selection') ? (passage.versions || []).find((x) => x && x.id === (v.from || v.base) && x.id !== v.id) : null;
  /* (kept by the version, its words, and each change before them with its hand and its marks — a name marked changed
   * everywhere when the book opened is worked out again: 2.12.41, the review of 2.12.41) */
  const key = `${v && v.id}\u0001${fp}\u0001${changesSig(v)}\u0001${JSON.stringify((v && v.gone) || null)}\u0001${v && v.how}\u0001${from ? `${from.id}:${hashText(String(from.text || ''))}:${changesSig(from)}` : ''}`;
  const had = WHOSE_KEPT.get(key);
  if (had) return had;
  let hands;
  let cur;
  const first = before.length ? String(before[0].text || '') : text;
  if (from) {
    /* (his edit: its words his where they are not those it was made from; words written again: the writer's, the others
     * with the hands of the words they came from) */
    const edit = v.how === 'edit';
    cur = edit ? writtenOf(from) : String(from.text || '');
    const fromHands = edit || depth >= 4 ? wordsOf(cur).map(() => baseHand(from)) : yield* whoseWork(from, passage, depth + 1);
    hands = handsAfter(fromHands, cur, writtenOf(v), edit ? 'you' : 'w');
    yield;
    cur = writtenOf(v);
    if (cur !== first) { hands = handsAfter(hands, cur, first, 'w'); cur = first; yield; }
  } else { cur = first; hands = wordsOf(cur).map(() => baseHand(v)); }
  for (let i = 0; i < before.length; i++) {
    const b = before[i];
    const after = String(i + 1 < before.length ? before[i + 1].text || '' : text);
    if (cur !== String(b.text || '')) { hands = handsAfter(hands, cur, String(b.text || ''), 'w'); cur = String(b.text || ''); yield; }
    const gone = i === 0 && v && v.gone && typeof v.gone === 'object' ? Object.entries(v.gone).filter(([, g]) => g && Number(g.moved) > 0) : [];
    if (gone.length && !noHand(b)) {
      /* the changes let go between: what this step put in, shared by what each hand put in */
      const share = [[b.by, Number.isFinite(b.moved) ? b.moved : 0], ...gone.map(([h, g]) => [h, Number(g.moved)])].filter(([, n]) => n > 0);
      const all = share.reduce((s, [, n]) => s + n, 0) || 1;
      const put = handsAfter(hands, cur, after, '\u0000');
      const fresh = put.filter((h) => h === '\u0000').length;
      let at = 0;
      const quota = share.map(([h, n]) => [h, Math.round((n / all) * fresh)]);
      hands = put.map((h) => { if (h !== '\u0000') return h; let s = 0; for (const [hh, q] of quota) { s += q; if (at < s) { at++; return hh; } } at++; return b.by; });
    } else hands = handsAfter(hands, cur, after, b.by, { rename: Boolean(b.rename), back: Boolean(b.back) });
    cur = after;
    yield;
  }
  if (cur !== text) hands = handsAfter(hands, cur, text, 'w');
  if (WHOSE_KEPT.size >= 2000) WHOSE_KEPT.clear();
  WHOSE_KEPT.set(key, hands);
  return hands;
}
const whoseKept = (text, hands) => ({ fp: hashText(String(text || '')), runs: runsOf(hands) });
/* (whether a version keeps who put in each of its words as they read now; and that worked out, to keep on it once —
 * mend.js keepWhose: a version kept before 2.12.41 worked out again every time the book opened — a change at a time,
 * whoseNowWork, so the page has its turn between them) */
export const whoseFits = (v) => Boolean(v) && runsFit(v.whose, v.text);
export const whoseNow = (v, passage = null) => whoseKept(String((v && v.text) || ''), whoseOf(v, passage));
/* (worked out on the version and its page as they read when the work began — each version's words before and what was
 * let go copied: the store lays a change made while the page has its turn on these very records, and it must never mix
 * into what is worked out; kept with the print of the words it was worked out for, so keepWhose lays it only where they
 * still read so) */
const asItWas = (x) => (x && typeof x === 'object'
  ? { ...x, before: Array.isArray(x.before) ? x.before.map((b) => (b && typeof b === 'object' ? { ...b } : b)) : x.before, gone: x.gone && typeof x.gone === 'object' ? JSON.parse(JSON.stringify(x.gone)) : x.gone }
  : x);
export function* whoseNowWork(v, passage = null) {
  const page = passage && typeof passage === 'object' ? { ...passage, versions: (passage.versions || []).map(asItWas) } : null;
  const was = (page && v && page.versions.find((x) => x && x.id === v.id)) || asItWas(v);
  const hands = yield* whoseWork(was, page);
  return whoseKept(String((was && was.text) || ''), hands);
}
/* (the words a Go on put in, the writer's — and where it joins on in the middle of a word cut short, "the do" and "or.",
 * that word keeps the hand of the word it carries on: writer.js joinOn) */
const handsPutOn = (text, more) => {
  const added = wordsOf(more).map(() => 'w');
  const joined = Math.max(0, wordsOf(text).length + added.length - wordsOf(text + more).length);
  return added.slice(joined);
};
/* (the words of a version grown by a Go on: the words it put in the writer's — inplace.js grownFields; with its passage,
 * for the words of a version made from another, a few written again at his note: whoseOf) */
export function whoseGrown(v, more, passage = null) {
  const text = String((v && v.text) || '');
  return whoseKept(text + more, [...whoseOf(v, passage), ...handsPutOn(text, more)]);
}
/* (and the words before a change, grown by a Go on with it: its own runs, the words put in the writer's) */
export function whoseGrownBefore(b, more) {
  if (!b || !runsFit(b.whose, b.text)) return undefined;
  const text = String(b.text || '');
  return whoseKept(text + more, [...handsFrom(b.whose.runs), ...handsPutOn(text, more)]);
}
export function inPlaceFields(v, next, by, { at = Date.now(), check = null, codex = null, continuity = null, keepEnd = true, tail = false, extra = {}, names = null, book = null, passage = null } = {}) {
  const was = String((v && v.text) || '');
  const end = Object.fromEntries(END_KEYS.filter((k) => v && v[k] !== undefined).map((k) => [k, v[k]]));
  /* WHAT THE CHANGE DID, DECIDED AS IT IS MADE (2.12.41, the review — through 2.12.40 whether his edit had taken a name
   * of his premise out of the page was read from the notes as they stood, and the answer turned over when a reading took
   * the name's card away): the names it took out (names.js nameWordsGone — with the book's names as they are now,
   * `names`: inplace.js bookNameWords) and how many words it put in (wordsPutIn), kept with the words before it. A name
   * changed everywhere (`rename`) takes no name out of his world, puts in none of his words, and is no one's hand on the
   * page; nor are the writer's own words put back (`back`). */
  const rename = Boolean(extra && extra.rename);
  const back = Boolean(extra && extra.back);
  const handsWas = whoseOf(v, passage);
  /* (with the names the page's own premise gives it, a person's — names.js premiseLocal: 2.12.41, the review of 2.12.41,
   * his edit right after the page was written, before any card was made, took "Will" out of "Will stood at the gate … he
   * will stay" and nothing was told) */
  const local = localOf(passage, names, book);
  /* (and the Timeline's turns of them, as their facts — only the turns of these very words, timeline.js continuityNow:
   * 2.12.40, the audit — Undo and Put back the words before brought the facts back and lost the turns) */
  const entry = { text: was, by, at,
    ...(rename || back ? {} : { took: nameWordsGone(was, next, { known: names, local, book }), moved: wordsPutIn(was, next) }),
    ...(Object.keys(end).length ? { end } : {}),
    ...(check ? { check: JSON.parse(JSON.stringify(check)) } : {}),
    ...(codex ? { codex: JSON.parse(JSON.stringify(codex)) } : {}),
    ...(continuity ? { continuity: JSON.parse(JSON.stringify(continuity)) } : {}),
    ...(tail ? { tail: keptTail(v) } : {}),
    ...extra,
    whose: whoseKept(was, handsWas) };
  /* the facts and the turns of the words, kept on the newest words before only (they can be many); what the checker found in them on each */
  const older = (Array.isArray(v && v.before) ? v.before : []).map(({ codex: _x, continuity: _t, ...rest }) => rest);
  const hands = rename || back || handsOf(v).includes(by) ? handsOf(v).slice() : [...handsOf(v), by];
  const list = [...older, entry];
  const out = { text: next, words: countWords(next), before: keptBefore(list), hands, whose: whoseKept(next, handsAfter(handsWas, was, next, by, { rename, back })) };
  /* (what the changes let go past BEFORE_KEEP did stays on the version, by hand) */
  if (list.length > BEFORE_KEEP) out.gone = goneWith(v && v.gone, list, list.slice(1, list.length - (BEFORE_KEEP - 1)).map((_, k) => k + 1), next, passage);
  /* the words before the fixes put in by themselves since the last other change, kept on the version itself (autoBaseOf):
   * a change by itself keeps them, or takes them from what it changed; any other change lets them go */
  out.autoBase = extra && extra.auto ? autoBaseOf(v) : undefined;
  if (!(v && typeof v.written === 'string')) out.written = was;
  if (!keepEnd) for (const k of END_KEYS) out[k] = undefined;
  if (tail) { out.tookOff = undefined; out.tookOffTop = undefined; }
  return out;
}
/* the words before the fixes the checker has put in by itself since the last other change (`auto` on the words before):
 * what goes in by itself is measured against these, so a passage never drifts far by itself, a look at a time */
/* (kept on the version since 2.12.35 — the audit: read from the changes kept, the base moved each time the oldest of
 * them went past BEFORE_KEEP, so the checker's own fixes asked for the chapter to be read whole again, and the measure
 * of how far a passage may change by itself loosened; with his edit let go among them, the base went back to the words
 * before it. A version from before: read from its changes, as then.) */
export function autoBaseOf(v) {
  if (v && typeof v.autoBase === 'string') return v.autoBase;
  const list = Array.isArray(v && v.before) ? v.before : [];
  let base = String((v && v.text) || '');
  let i = list.length - 1;
  for (; i >= 0 && list[i] && list[i].auto; i--) base = String(list[i].text || '');
  /* every change kept was by itself, and older ones may have gone: the words as they were first */
  if (i < 0 && list.length >= BEFORE_KEEP) base = writtenOf(v);
  return base;
}
/* NO CHANGE OF A HAND LET GO WITHOUT A WORD OF IT KEPT (`gone`): since 2.12.41 every change let go — past BEFORE_KEEP, or
 * left behind by a Go on — is kept in `gone` by hand, so changes all made since (each with what it took out, `took`, or
 * no one's hand) let go nothing `gone` does not say (2.12.41, the review of 2.12.41: five kept were read as one let go,
 * and his edit put back as the fifth left his hand on the page); changes kept from before may have let some go
 * unsaid — fewer than BEFORE_KEEP kept, and the first words still first, say they did not */
/* (a change made since: with what it took out, or no one's hand and who put in its words kept with it — one marked a
 * name changed everywhere when the book opened is from before: mend.js markRenames) */
const madeSince = (b) => Boolean(b) && (Array.isArray(b.took) || (noHand(b) && Boolean(b.whose)));
export function noneLetGo(v, h) {
  if (v && v.gone && v.gone[h]) return false;
  const list = Array.isArray(v && v.before) ? v.before : [];
  if (list.length && list.every(madeSince)) return true;
  return list.length > 0 && list.length < BEFORE_KEEP && String(list[0].text || '') === writtenOf(v);
}
/* the newest words before, put back: the fields to set, and what was found in them (or null) — null when there are none */
export function putBackFields(v) {
  const list = Array.isArray(v && v.before) ? v.before : [];
  const last = list[list.length - 1];
  if (!last || typeof last.text !== 'string') return null;
  const rest = list.slice(0, -1);
  /* (the fixes by themselves before it still in: their base stays; else the base is these words again) */
  const out = { text: last.text, words: countWords(last.text), before: rest.length ? rest : undefined, autoBase: rest.length && rest[rest.length - 1] && rest[rest.length - 1].auto ? v.autoBase : undefined };
  for (const k of END_KEYS) out[k] = last.end ? last.end[k] : undefined;
  if (last.tail) { out.tookOff = last.tail.tookOff; out.tookOffTop = last.tail.tookOffTop; }
  /* who put in each of the words put back: as kept with them (else worked out again — whoseOf) */
  out.whose = runsFit(last.whose, last.text) ? last.whose : undefined;
  /* THE HAND OF THE CHANGE PUT BACK GOES WITH IT (2.12.41, the review of 2.12.41: his edit put back, or his partner's
   * change undone, and the page was still his, or his partner's — held against his cards as his own words, out of the
   * writer's row): once no other change of that hand is left on it — none kept, none let go (noneLetGo) */
  const h = last.by;
  if (h && !noHand(last) && handsOf(v).includes(h) && rest.length && !rest.some((b) => b && b.by === h && !noHand(b)) && noneLetGo(v, h)) out.hands = handsOf(v).filter((x) => x !== h);
  /* back to its first words: no longer changed by anyone (nor anything kept of changes let go past BEFORE_KEEP) */
  if (!rest.length && last.text === writtenOf(v)) { out.hands = undefined; out.written = undefined; out.gone = undefined; }
  return { patch: out, check: last.check || null, codex: last.codex || null, continuity: last.continuity || null, by: last.by, at: last.at };
}

/* the two read the same at their end: the last words untouched */
export function sameEnd(a, b) {
  const tail = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(-40);
  return tail(a) === tail(b);
}

/* A CHANGE MADE ON WORDS THAT HAVE CHANGED SINCE, LAID WHERE IT CAN BE LAID EXACTLY (2.12.41, a step laid again over
 * another window's newer copy): the stretch it changed in `was`, with a few whole words either side of it, standing once
 * in the newer words `now` — the change goes in there, and the rest of them stay as they are; standing nowhere, or more
 * than once, nothing (null). Only the words the change found are ever replaced, never another window's. */
const RELAY_WORDS = 3;
export function relaidOn(was, after, now) {
  const a = String(was || '');
  const b = String(after || '');
  const n = String(now || '');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let t = 0;
  while (t < a.length - s && t < b.length - s && a[a.length - 1 - t] === b[b.length - 1 - t]) t++;
  let start = s;
  let end = a.length - t;
  for (let w = 0; w < RELAY_WORDS && start > 0; w++) {
    while (start > 0 && /\s/.test(a[start - 1])) start--;
    while (start > 0 && !/\s/.test(a[start - 1])) start--;
  }
  for (let w = 0; w < RELAY_WORDS && end < a.length; w++) {
    while (end < a.length && /\s/.test(a[end])) end++;
    while (end < a.length && !/\s/.test(a[end])) end++;
  }
  const found = a.slice(start, end);
  if (!found.trim()) return null;
  const at = n.indexOf(found);
  if (at < 0 || n.indexOf(found, at + 1) >= 0) return null;
  return n.slice(0, at) + b.slice(start, b.length - (a.length - end)) + n.slice(at + found.length);
}

export function newPassage(by, text = '', fields = {}) {
  return { id: newId('p'), by, pick: 0, versions: [newVersion({ text, how: by === 'you' ? 'mine' : by, ...fields })] };
}

/* What a chapter kept for some of its passages, to go with them into
 * another chapter (A new chapter from here, Cozy Tavern F9): what the checker
 * found and what he left, the judge's head to head, and the words of their
 * versions taken out, which the helper reads to take back what came from
 * them. A copy — the chapter itself is not changed. */
export function keptFor(chapter, passageIds) {
  const ids = new Set(passageIds);
  const pick = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([pid]) => ids.has(pid)));
  const theirs = (r) => r && (ids.has(r.key) || [...ids].some((pid) => String(r.key || '').startsWith(pid + ':')));
  return JSON.parse(JSON.stringify({
    checks: pick(chapter && chapter.checks),
    checksLeft: pick(chapter && chapter.checksLeft),
    duels: Object.fromEntries(Object.entries((chapter && chapter.duels) || {}).filter(([, d]) => d && ids.has(d.pid))),
    retired: ((chapter && chapter.retired) || []).filter(theirs),
  }));
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
/* The request that made these words, through changes made in place. Follow
 * this version's ancestry, never an unrelated take or an older rewrite it
 * replaced. Selection notes still apply beside the whole passage's request. */
export function requestOf(passage, version = picked(passage)) {
  const versions = (passage && passage.versions) || [];
  const visited = new Set();
  const notes = [];
  let v = version;
  while (v && !visited.has(v.id)) {
    visited.add(v.id);
    const ask = v.ask || {};
    if (['write', 'another', 'rewrite', 'play'].includes(v.how)) return { how: v.how, ask, notes };
    if (v.how === 'selection' && String(ask.note || '').trim()) notes.unshift(String(ask.note));
    v = versions.find((x) => x.id === (v.from || v.base));
  }
  /* An earlier version can have been removed. An edit keeps its request,
   * so use those kept words, without guessing from a different branch. */
  const ask = (version && version.ask) || {};
  const how = ask.transcript ? 'play' : ask.direction !== undefined ? 'write'
    : ask.note !== undefined && ask.from === undefined && ask.to === undefined ? 'rewrite' : '';
  return { how, ask, notes };
}
/* THE PREMISE HE TYPED FOR A PASSAGE (his report, 2.12.30: "after the output my premise is gone — where can I see my
 * previous input?"): the words in the box under the page that it was written from, as he typed them — the version on
 * show's own request, else any version written from one (another take carries the same); '' when he pressed Continue
 * and let the writer choose, and for his own words, a scene's prose or a scene break */
export function premiseOf(passage) {
  if (!passage || passage.by === 'break') return '';
  const said = (ask) => String((ask && ask.direction) || '').trim();
  const r = requestOf(passage);
  if ((r.how === 'write' || r.how === 'another') && said(r.ask)) return said(r.ask);
  const v = (passage.versions || []).find((x) => x && (x.how === 'write' || x.how === 'another') && said(x.ask));
  if (v) return said(v.ask);
  /* a rewrite carries the premise of the page it wrote again — the version it came from removed, the premise stays (2.12.35) */
  const r2 = (passage.versions || []).find((x) => x && x.ask && String(x.ask.premise || '').trim());
  return r2 ? String(r2.ask.premise).trim() : '';
}
/* WHEN HE TYPED IT: the first version written from his premise (another take carries the same words, later) — 0 when
 * none of them is kept any more (a rewrite carries the premise on alone): never newer than anything */
export function premiseAt(passage) {
  const text = premiseOf(passage);
  if (!text) return 0;
  const ats = ((passage && passage.versions) || []).filter((v) => v && (v.how === 'write' || v.how === 'another') && String((v.ask && v.ask.direction) || '').trim() === text).map((v) => Number(v.at) || 0).filter((x) => x > 0);
  return ats.length ? Math.min(...ats) : 0;
}
/* HIS LATER WORD ON A PASSAGE (2.12.40, the audit — his newest word wins: he typed "Tom, Mara's brother, comes home",
 * then had the page written again with "Tom is not in this book at all", and the premise still stood as the book; his
 * own edit taking Tom out, the same). What he did to the passage after its premise, on the version on show and the
 * versions it was made from, back to the one written from the premise: written again with a note (the whole page, or
 * the words he selected — never the app's own lift, nor the checker's sentence by itself), his own words on it, his
 * partner's words on it, or the passage written anew by his partner. Each with when, oldest first:
 * [{how: 'rewrite' | 'selection' | 'edit' | 'partner' | 'anew', note, at}]. None: the premise stands as the book.
 * (A version he picked back with the arrows is the page he chose: what came after it on another version is not on it.)
 * His hand on the words is read from the words before kept on the version (inplace.js) — never what he only put back
 * there (Put back what was taken off, `back`), nor a name changed everywhere (`rename`, 2.12.41: it was told as "my
 * partner changed its words since"); past BEFORE_KEEP changes, what the ones let go did is kept on the version (`gone`),
 * and for a version from before 2.12.41 his hand on it says it. Each of his hand's or his partner's in place with the
 * names it took out of the page (`took`, kept as it was made — inPlaceFields). */
export function laterWords(passage) {
  if (!passage || passage.by === 'break' || passage.by === 'you') return [];
  const versions = passage.versions || [];
  const out = [];
  const seen = new Set();
  /* (the names the passage's own premise gives its page, for a change kept before 2.12.41 read from its words) */
  const local = localOnce(passage);
  let v = picked(passage);
  while (v && !seen.has(v.id)) {
    seen.add(v.id);
    const now = String(v.text || '');
    const note = String((v.ask && v.ask.note) || '').trim();
    if (v.how === 'rewrite' && !v.lift && note) out.push({ how: 'rewrite', note, at: Number(v.at) || 0 });
    else if (v.how === 'selection' && !v.spanAuto && note) out.push({ how: 'selection', note, at: Number(v.at) || 0 });
    else if (v.how === 'partner') out.push({ how: 'anew', note: '', at: Number(v.at) || 0 });
    else if (v.how === 'edit') {
      /* (his edit kept as a version of its own, before 2.12.2: what it took out, from the version it was made from) */
      const from = versions.find((x) => x.id === (v.from || v.base));
      out.push({ how: 'edit', note: '', at: Number(v.at) || 0, took: from ? nameWordsGone(writtenOf(from), writtenOf(v), { local: local() }) : [] });
    }
    const before = Array.isArray(v.before) ? v.before : [];
    /* (each with what it took out — one kept before 2.12.41 read against the words right after it, never the words now) */
    before.forEach((b, i) => {
      if (b && (b.by === 'you' || b.by === 'partner') && !noHand(b)) out.push({ how: b.by === 'you' ? 'edit' : 'partner', note: '', at: Number(b.at) || 0, took: tookBy(b, i + 1 < before.length ? String(before[i + 1].text || '') : now, local) });
    });
    const gone = (v.gone && typeof v.gone === 'object') ? v.gone : {};
    for (const by of ['you', 'partner']) {
      if (gone[by]) out.push({ how: by === 'you' ? 'edit' : 'partner', note: '', at: Number(gone[by].at) || Number(v.done || v.at) || 0, took: Array.isArray(gone[by].took) ? gone[by].took : [] });
      /* (a hand on the page that no change kept accounts for: a change of it let go before 2.12.41 kept no word of it) */
      else if (handsOf(v).includes(by) && !before.some((b) => b && b.by === by) && !noneLetGo(v, by)) out.push({ how: by === 'you' ? 'edit' : 'partner', note: '', at: Number(v.done || v.at) || 0, took: [] });
    }
    if (v.how === 'write' || v.how === 'another') break;
    const up = v.from || v.base;
    v = up ? versions.find((x) => x.id === up) : null;
  }
  return out.sort((a, b) => a.at - b.at);
}
/* EVERY PREMISE HE TYPED, THE BOOK THROUGH (2.12.36 — his report: "does the notes read my premise too?" — the world
 * his premise set up, an elder vampire's turning that comes once in a thousand, was read by the writer of that one page
 * and nobody after it; the notes read only what the page said, and the pages after it drifted). In the book's order,
 * each with the passage it was typed for, as the page numbers it: what the notes' reading, check and the helper's
 * telling of the book hold as his word (archivist.js). `chapters`: id → chapter. Each with when he typed it (`at`) and
 * what he did to its passage since (`later`, laterWords — 2.12.40: while there is any, the premise is no longer the
 * book; what he changed stands over it). */
export function premisesOf(novel, chapters) {
  const out = [];
  (((novel && novel.order) || [])).forEach((id) => {
    const c = chapters && chapters[id];
    if (!c) return;
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      const text = premiseOf(p);
      if (text) out.push({ chapterId: id, pid: p.id, text, label: `${chapterLabel(novel, c, { withName: false })}, Passage ${nums.get(p.id) || '—'}`, at: premiseAt(p), later: laterWords(p) });
    }
  });
  return out;
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
/* SUPER AUTOMATIC (auto.js): the chapter the writer ended — its last passage with words is, on show, a version that
 * ends it (writer.js `closes`). Anything written after it, or another version on show, and it goes on. */
export function chapterClosed(chapter) {
  const list = (chapter && chapter.passages) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!hasWords(list[i])) continue;
    return Boolean((picked(list[i]) || {}).closes);
  }
  return false;
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
  const request = requestOf(passage, shown);
  const note = [request.how === 'rewrite' ? request.ask.note : '', ...request.notes].filter((x) => String(x || '').trim()).join('\n');
  if (passage.by === 'you') {
    /* brought in from a file: only a note he gave it in a rewrite is his */
    if ((versions[0] || {}).how === 'imported') return note.trim();
    /* his own words: the version on show when it is his (typed, or his
     * edit), else the one of his it was rewritten from — never a rewrite
     * the writer made of it */
    const isMine = (v) => Boolean(v && (v.how === 'mine' || v.how === 'edit' || handsOf(v).includes('you')));
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

/* ------------------------------------------ when his entries' words were written */

/* WHEN EACH OF HIS ENTRY'S WORDS WAS WRITTEN (2.12.41, the review of 2.12.41, and Quick add's: an entry kept one time,
 * `at`, moved by every save — a Quick add that only added a sentence, or his partner only setting it to ride always,
 * made the whole entry newer than his premises, and his older "silver hair" stood over his newer "dyed her hair black").
 * Each sentence of his words — its line, and each sentence of the entry — with when its words were written (`saidAt`:
 * the sentence's print by its folded words → when), kept in the one write every entry goes through (novelSteps.putEntry:
 * his sheet, his partner's change, Quick add, the notes' check, a lorebook brought in). A sentence whose words stand as
 * they were keeps its time; one that only carries whole sentences of his before — a slip mended, the grammar put right,
 * "she" for his entry's own name, two sentences joined — and adds no telling word of its own, the newest of their times;
 * any other new or changed sentence (a word added or taken out, a "not", words of two sentences made a new one) takes
 * the time of the save. When it rides, its kind and its names change no time. An entry kept before has its `at` for
 * each. */
const SENTENCE_GAP = /(?<=[.!?…]["”’)\]]*)\s+|\s*\n+\s*/u;
export function entrySentences(e) {
  const out = [];
  const line = String((e && e.line) || '').replace(/\s+/g, ' ').trim();
  if (line) out.push(line);
  for (const s of String((e && e.text) || '').split(SENTENCE_GAP)) if (s && s.trim()) out.push(s.trim());
  return out;
}
export const sentenceKey = (s) => hashText(foldName(s));
/* THE SAME TELLING WORDS IN THE SAME ORDER (2.12.41, round 5 — the review of round 4: "loves" made "loved", "is" made
 * "was", "a son" made "sons", "diary" made "dairy", her name made "he", all kept their old time). A sentence's words,
 * folded, in their order, the articles alone left out (a, an, the — never is, was, has, had, than, then, not, never,
 * no), none cut to its stem; the entry's own names the same as the words for a person of its gender, as the entry's
 * own words give it (where her entry says "she" or "her", "Mara rules" is "She rules"; with no such word in it, no
 * word stands for her name), and each of those words only the same as itself ("he" is never "she"). Its words may be
 * those of a few of the sentences before it, in their order — what a later one opens with as the first does (its
 * name, "she is") said once, an "and" between ("She is tall. She is strong." is "She is tall and strong.") — and a
 * few of its sentences side by side may say one before them, the other way about; a word may be a slip of the pen
 * mended — a letter put in, left out, or two side by side swapped, in a word of five letters or more, never a letter
 * changed for another — only where what it was is no word anywhere in the book, its pages too, and what it is now is
 * one the book uses ("lighthuose" made "lighthouse" in a book of a lighthouse; "diary" made "dairy", "trial" "trail",
 * "lightning" "lighting" are newer words). */
const ARTICLES = new Set(['a', 'an', 'the']);
const PERSON_GENDERS = [['she', 'her', 'hers', 'herself'], ['he', 'him', 'his', 'himself'], ['they', 'them', 'their', 'theirs', 'themselves']].map((l) => new Set(l));
const THING_GENDERS = [['it', 'its', 'itself'], ['they', 'them', 'their', 'theirs', 'themselves']].map((l) => new Set(l));
const OWN_WORD = '\u0001';
/* a sentence's words as they are told (above), in their order */
const toldOf = (s, own) => foldName(s).split(' ').filter((w) => w && !ARTICLES.has(w)).map((w) => (own.has(w) ? OWN_WORD : w));
/* the words for a person of the entry's gender, as its own words give it: the most of them of one kind, or none */
function genderOf(e) {
  if (!e) return null;
  const words = foldName(`${e.line || ''} ${e.text || ''}`).split(' ');
  const kinds = e.kind && e.kind !== 'people' ? THING_GENDERS : PERSON_GENDERS;
  const counts = kinds.map((g) => words.filter((w) => g.has(w)).length);
  const most = Math.max(0, ...counts);
  return most && counts.filter((n) => n === most).length === 1 ? kinds[counts.indexOf(most)] : null;
}
/* a slip of the pen mended: one letter put in or left out, or two side by side swapped — never one changed for another */
function slipOf(was, now) {
  if (was === now || Math.max(was.length, now.length) < 5 || Math.abs(was.length - now.length) > 1) return false;
  if (was.length === now.length) {
    let i = 0;
    while (i < was.length && was[i] === now[i]) i++;
    return i + 1 < was.length && was[i] === now[i + 1] && was[i + 1] === now[i] && was.slice(i + 2) === now.slice(i + 2);
  }
  const [s, l] = was.length < now.length ? [was, now] : [now, was];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}
/* (the pages a book's words are read from — the novel's record alone cannot give them: set by inplace.js, which has the
 * chapters — round 5) */
let chapterWordsOf = () => [];
export function setChapterWords(fn) { chapterWordsOf = typeof fn === 'function' ? fn : () => []; }
const escWord = (w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* THE WORDS A BOOK USES OUTSIDE ONE ENTRY (withStamps' `elsewhere`, asked only when a slip is): his other entries, the
 * notes, his own words for the book, folded — and its pages, his premises and the chapters' plans, each word looked for
 * when it is asked (2.12.41, round 5: the pages were never read). `has(word)` */
export function wordsElsewhere(novel, entryId = '') {
  const out = new Set();
  const add = (t) => { for (const w of foldName(String(t || '')).split(' ')) if (w) out.add(w); };
  if (novel) {
    for (const e of Array.isArray(novel.bibliography) ? novel.bibliography : []) if (e && e.id !== entryId) { add(e.name); for (const a of e.aka || []) add(a); add(e.line); add(e.text); }
    for (const list of Object.values(novel.notes || {})) for (const c of Array.isArray(list) ? list : []) if (c && typeof c === 'object') for (const k of ['name', 'about', 'ties', 'now', 'since', 'title', 'text']) if (typeof c[k] === 'string') add(c[k]);
    for (const k of ['brief', 'style', 'plans', 'ending']) add(novel[k]);
  }
  let pages = null;
  const onPages = new Map();
  return {
    size: out.size,
    [Symbol.iterator]: () => out[Symbol.iterator](),
    has: (w) => {
      if (out.has(w)) return true;
      if (!novel || !w) return false;
      if (!onPages.has(w)) {
        if (pages === null) pages = (chapterWordsOf(novel) || []).filter((t) => typeof t === 'string' && t);
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escWord(w)}(?![\\p{L}\\p{N}])`, 'iu');
        onPages.set(w, pages.some((t) => re.test(t)));
      }
      return onPages.get(w);
    },
  };
}
/* the same words, one by one: the same, her name and a word for a person of her gender, or a slip of the pen mended
 * (`words`: what the book uses — what it was is none of them, what it is now one) — `was` the word before, `now` after */
function sameWord(was, now, gender, words) {
  if (was === now) return true;
  if (gender && ((was === OWN_WORD && gender.has(now)) || (now === OWN_WORD && gender.has(was)))) return true;
  if (was === OWN_WORD || now === OWN_WORD || !slipOf(was, now)) return false;
  const w = words();
  return Boolean(w) && !w.has(was) && w.has(now);
}
/* whether `words` say the sentences `parts` say, in their order (a few joined: what a later one opens with as the first
 * does said once, an "and" between) — `same(part's word, words' word)`, `alike` for what they open with */
function saysParts(parts, words, same, alike) {
  if (!parts.length) return false;
  const first = parts[0];
  const forms = parts.map((p, k) => {
    if (!k) return [p];
    let n = 0;
    while (n < p.length - 1 && n < first.length && alike(first[n], p[n])) n++;
    return n ? [p, p.slice(n)] : [p];
  });
  const from = (k, i) => {
    if (k === forms.length) return i === words.length;
    for (const part of forms[k]) {
      for (const j of k && words[i] === 'and' ? [i, i + 1] : [i]) {
        if (j + part.length > words.length) continue;
        let ok = true;
        for (let t = 0; ok && t < part.length; t++) ok = same(part[t], words[j + t]);
        if (ok && from(k + 1, j + part.length)) return true;
      }
    }
    return false;
  };
  return from(0, 0);
}
/* when each sentence of an entry was written: sentenceKey → when (0: not known) */
export function stampsOf(e) {
  const out = new Map();
  if (!e) return out;
  const kept = e.saidAt && typeof e.saidAt === 'object' ? e.saidAt : null;
  const at = Number(e.at) || 0;
  for (const s of entrySentences(e)) {
    const k = sentenceKey(s);
    if (!out.has(k)) out.set(k, kept && Number.isFinite(kept[k]) ? kept[k] : at);
  }
  return out;
}
/* the entry about to be kept (`next`, its `at` the time of the save), with when each of its sentences was written — from
 * the entry as it stands (`prev`), then from what it carries itself (a name changed everywhere carries its times over),
 * then the sentences of `prev` it says again in their words (above: the newest of their times), then the save's own
 * time. The same entry given again comes out the same. (elsewhere: the words his book uses outside this entry —
 * wordsElsewhere — for what a slip of the pen may have been) */
const JOINED_MOST = 3;
export function withStamps(prev, next, { elsewhere = null } = {}) {
  if (!next || typeof next !== 'object') return next;
  const at = Number(next.at) || 0;
  const was = stampsOf(prev);
  const given = next.saidAt && typeof next.saidAt === 'object' ? next.saidAt : {};
  const own = new Set([next.name, ...(Array.isArray(next.aka) ? next.aka : []), ...(prev ? [prev.name, ...(prev.aka || [])] : [])].flatMap((n) => foldName(n).split(' ')).filter(Boolean));
  const gender = genderOf(prev);
  let bookWords;
  const words = () => (bookWords === undefined ? (bookWords = (typeof elsewhere === 'function' ? elsewhere() : elsewhere) || null) : bookWords);
  const alike = (x, y) => x === y || Boolean(gender && ((x === OWN_WORD && gender.has(y)) || (y === OWN_WORD && gender.has(x))));
  const told = prev ? entrySentences(prev).map((s) => ({ words: toldOf(s, own), at: was.get(sentenceKey(s)) || 0 })).filter((x) => x.words.length) : [];
  /* (said before: one of them, or a few of them side by side, joined — the newest of their times) */
  const saidBefore = (said) => {
    for (let i = 0; i < told.length; i++) {
      for (let j = i; j < told.length && j - i < JOINED_MOST; j++) {
        if (saysParts(told.slice(i, j + 1).map((x) => x.words), said, (a, b) => sameWord(a, b, gender, words), alike)) return Math.max(...told.slice(i, j + 1).map((x) => x.at));
      }
    }
    return null;
  };
  const saidAt = {};
  /* (each of its sentences once, in their order — `open`: one left with the save's time) */
  const order = [];
  for (const s of entrySentences(next)) {
    const k = sentenceKey(s);
    if (Object.hasOwn(saidAt, k)) continue;
    if (was.has(k)) { saidAt[k] = was.get(k); order.push({ k }); continue; }
    if (Number.isFinite(given[k])) { saidAt[k] = given[k]; order.push({ k }); continue; }
    const said = toldOf(s, own);
    const hit = said.length ? saidBefore(said) : null;
    saidAt[k] = hit === null ? at : hit;
    order.push({ k, said, open: hit === null && said.length > 0 });
  }
  /* (and one he said before said again as a few sentences side by side, in their order — "She is tall and strong." made
   * "She is tall. She is strong.", as the other way about: each keeps its time) */
  for (let i = 0; i < order.length; i++) {
    if (!order[i].open) continue;
    for (let j = i + 1; j < order.length && j - i < JOINED_MOST && order[j].open; j++) {
      const parts = order.slice(i, j + 1).map((x) => x.said);
      const hit = told.find((t) => saysParts(parts, t.words, (b, a) => sameWord(a, b, gender, words), alike));
      if (!hit) continue;
      for (let x = i; x <= j; x++) { saidAt[order[x].k] = hit.at; order[x].open = false; }
      i = j;
      break;
    }
  }
  return { ...next, saidAt };
}

/* ------------------------------------------------------- steps (novel) */

/* (a step that writes words where the change found other words — `from`, given: laid only while the copy it is laid on
 * still reads so, so laid again over another window's newer copy it never writes over what that window wrote there:
 * 2.12.41, a step laid again over another window's newer copy) */
const readsAs = (cur, from) => String(cur == null ? '' : cur) === String(from == null ? '' : from);
export const novelSteps = {
  touchWritten: (at) => (n) => { n.meta.written = Math.max(n.meta.written || 0, at); },
  opened: (at) => (n) => { n.meta.opened = Math.max(n.meta.opened || 0, at); },
  setMeta: (patch, from = undefined) => (n) => {
    if (from && Object.entries(from).some(([k, v]) => !readsAs((n.meta || {})[k], v))) return false;
    Object.assign(n.meta, patch);
  },
  setField: (key, value, from = undefined) => (n) => {
    if (from !== undefined && !readsAs(n[key], from)) return false;
    n[key] = value;
  },
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
  /* A hand-edited card saves only the fields written. Replaying a refused
   * save over another window's copy must preserve its untouched fields and
   * must never recreate a card that window removed. */
  /* (`found`: the card as a change made for him found it — his partner's: a field his own words were written into since,
   * on the copy it is laid on (his mark's time moved on, and the field no longer reads as it found it), is never written
   * over — laid again over a newer copy, his typing in another window stays; laid again over the copy that holds it,
   * nothing; none left to write, nothing — 2.12.41, a step laid again over another window's newer copy) */
  editNote: (kind, card, fields, { create = false, found = undefined } = {}) => {
    const words = JSON.parse(JSON.stringify(card));
    const asked = [...new Set(fields)].filter((k) => CARD_FIELDS.includes(k) || k === 'since');
    const at = (words.updated && words.updated.at) || Date.now();
    const as = (x) => JSON.stringify(x === undefined ? null : x);
    /* (the card as it was found, kept as it stood when the step was made) */
    const was = found === undefined ? undefined : JSON.parse(JSON.stringify(found));
    const hisSince = (cur, k) => hisField(cur, k) && hisAtOf(cur.updated) > hisAtOf(was && was.updated) && as(cur[k]) !== as(was ? was[k] : undefined);
    return (n) => {
      n.notes = n.notes || {};
      const list = n.notes[kind] || (n.notes[kind] = []);
      const i = list.findIndex((c) => c.id === words.id);
      const cur = i >= 0 ? list[i] : null;
      if (!cur && !create) return false;
      const wrote = was !== undefined && cur ? asked.filter((k) => !hisSince(cur, k)) : asked;
      if (was !== undefined && !wrote.length) return false;
      const next = JSON.parse(JSON.stringify(cur || words));
      for (const field of wrote) {
        if (words[field] === undefined) delete next[field];
        else next[field] = JSON.parse(JSON.stringify(words[field]));
      }
      if (wrote.includes('name') && cur && nameKey(next.name) !== nameKey(cur.name)) next.aka = [...(next.aka || []), cur.name];
      if (wrote.includes('aka') || wrote.includes('name')) next.aka = (next.aka || []).filter((a, j, all) => nameKey(a) !== nameKey(next.name) && all.findIndex((b) => nameKey(b) === nameKey(a)) === j);
      if (wrote.includes('now')) {
        delete next.nowPid; delete next.nowAt;
        if (next.now && (words.nowAt || (n.order || []).length)) next.nowAt = words.nowAt || n.order[n.order.length - 1];
      }
      next.updated = hisStamp(cur, wrote, at);
      if (i >= 0) list[i] = next; else list.push(next);
      /* Everyone still uses the last complete notes during a rebuild. His
       * explicit corrections belong there immediately; partial helper work
       * does not. The snapshot has no memory, so this applies only once. */
      const from = n.memory && n.memory.rereadFrom;
      if (from && n.memory.undo && n.memory.undo.keep) {
        const own = newCard(kind, { id: words.id, name: words.name, updated: { at }, ...Object.fromEntries(wrote.map((k) => [k, words[k]])), ...(words.nowAt ? { nowAt: words.nowAt } : {}) });
        novelSteps.editNote(kind, own, wrote, { create: true })({ notes: from.notes || (from.notes = {}), order: n.order });
      }
      return true;
    };
  },
  dropNote: (kind, cardId) => (n) => {
    n.notes[kind] = (n.notes[kind] || []).filter((c) => c.id !== cardId);
    const from = n.memory && n.memory.rereadFrom;
    if (from && from.notes && n.memory.undo && n.memory.undo.keep) from.notes[kind] = (from.notes[kind] || []).filter((c) => c.id !== cardId);
  },
  setNotes: (notes) => (n) => { n.notes = notes; },
  /* THE BIBLIOGRAPHY (bibliography.js): an entry set whole, by id — laid
   * again over a newer copy it writes only that entry; taken out by id —
   * with when each of its words was written (withStamps, 2.12.41): an
   * entry given as withStamps made it is kept exactly as given */
  putEntry: (entry) => (n) => {
    const list = Array.isArray(n.bibliography) ? n.bibliography : (n.bibliography = []);
    const i = list.findIndex((x) => x && x.id === (entry && entry.id));
    const e = withStamps(i >= 0 ? list[i] : null, JSON.parse(JSON.stringify(entry)), { elsewhere: () => wordsElsewhere(n, entry && entry.id) });
    if (i >= 0) list[i] = e; else list.push(e);
  },
  dropEntry: (id) => (n) => {
    if (!Array.isArray(n.bibliography)) return false;
    const before = n.bibliography.length;
    n.bibliography = n.bibliography.filter((x) => x && x.id !== id);
    return n.bibliography.length !== before;
  },
  /* an entry put back as it was — only where it still reads as it did after (an Undo) */
  entryBack: (id, before, after) => (n) => {
    const list = Array.isArray(n.bibliography) ? n.bibliography : (n.bibliography = []);
    const i = list.findIndex((x) => x && x.id === id);
    const cur = i >= 0 ? list[i] : null;
    if (JSON.stringify(cur) !== JSON.stringify(after || null)) return false;
    if (!before) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = JSON.parse(JSON.stringify(before));
    else list.push(JSON.parse(JSON.stringify(before)));
    return true;
  },
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
  /* one version's reading; the one it had of its earlier words, changed in place since (a fix, his edit, Go on),
   * kept beside it — the last few (readings.js readingAt) */
  putReading: (pid, vid, reading) => (n) => {
    n.memory = n.memory || {};
    const all = n.memory.readings || (n.memory.readings = {});
    const was = all[pid] && all[pid][vid];
    const next = JSON.parse(JSON.stringify(reading));
    delete next.prior;
    const older = was ? [...(was.sig !== next.sig ? [(({ prior, ...x }) => x)(was)] : []), ...(Array.isArray(was.prior) ? was.prior : [])] : [];
    const prior = older.filter((x, i) => x && x.sig !== next.sig && older.findIndex((y) => y && y.sig === x.sig) === i).slice(0, PRIOR_KEEP);
    if (prior.length) next.prior = JSON.parse(JSON.stringify(prior));
    all[pid] = { ...(all[pid] || {}), [vid]: next };
  },
  /* ([pid, vid, sig]: that reading only while it is still the one of those words — a newer reading of the version, laid
   * meanwhile in another window, stays: 2.12.41, a step laid again over another window's newer copy) */
  dropReadings: (list) => (n) => {
    const all = n.memory && n.memory.readings;
    if (!all) return;
    for (const [pid, vid, sig] of list || []) {
      if (!all[pid]) continue;
      if (vid === '*') delete all[pid];
      else if (sig !== undefined && !(all[pid][vid] && all[pid][vid].sig === sig)) continue;
      else { delete all[pid][vid]; if (!Object.keys(all[pid]).length) delete all[pid]; }
    }
  },
  setMemory: (patch) => (n) => { n.memory = { ...(n.memory || {}), ...patch }; },
  /* a name changed everywhere, kept for a little while: work asked before it
   * (a page on its way, a reading) is given the new name when it lands */
  /* (each change of names counted on the book — its `n`: work asked before it is work that took the book's words while the
   * count was lower, in whichever browser either was made, whatever their clocks say — renamesSince. 2.12.41, round 5:
   * judged by the renaming browser's clock against the reading's, a rename made where the clock runs behind was missed,
   * and what the reading found lost) */
  /* (`mark`: {id} — the change of names, by its own mark — or {undoes} — the Undo of the change so marked: an Undo puts each
   * page's words back as they were, which no change of names does — names.js renameSteps, 2.12.41, round 7) */
  noteRenames: (pairs, at, mark = {}) => (n) => {
    n.memory = n.memory || {};
    const count = (Number(n.memory.renameN) || 0) + 1;
    n.memory.renameN = count;
    const tag = { ...(mark && mark.id ? { id: mark.id } : {}), ...(mark && mark.undoes ? { undoes: mark.undoes } : {}) };
    n.memory.renames = [...(n.memory.renames || []), ...pairs.map((x) => ({ from: x.from, to: x.to, at, n: count, ...tag }))].filter((x) => at - x.at < 3600000).slice(-20);
  },
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
  /* A CHAPTER'S MARKS OF READ (2.12.41, a step laid again over another window's newer copy): given the marks as the
   * change found them (`was`), only the marks it changed, each only where it still reads as it found it — laid again over
   * a newer copy, the marks another window's reading made meanwhile stay, and nothing is read again and paid for twice;
   * laid again over a copy that holds it, nothing. Without `was`, the chapter's marks set whole (a book marked read). */
  seen: (chapterId, map, was = undefined) => {
    /* (both as they stood when the step was made: the marks here may change after) */
    const found = was === undefined ? undefined : { ...(was || {}) };
    const marks = was === undefined ? map : { ...(map || {}) };
    return (n) => {
      n.memory = n.memory || {};
      const all = n.memory.seen || {};
      if (found === undefined) { n.memory.seen = { ...all, [chapterId]: marks }; return; }
      const cur = { ...(all[chapterId] || {}) };
      let any = false;
      for (const pid of new Set([...Object.keys(found), ...Object.keys(marks)])) {
        const from = found[pid];
        const to = marks[pid];
        if (from === to || cur[pid] !== from) continue;
        if (to === undefined) delete cur[pid]; else cur[pid] = to;
        any = true;
      }
      if (!any) return false;
      n.memory.seen = { ...all, [chapterId]: cur };
    };
  },
  forgetChapterSeen: (chapterId) => (n) => { if (n.memory && n.memory.seen) delete n.memory.seen[chapterId]; },
  pushRemoved: (entry) => (n) => {
    n.memory = n.memory || {};
    const list = n.memory.removed || (n.memory.removed = []);
    if (!list.some((x) => x.id === entry.id)) list.push(entry);
  },
  clearRemoved: (ids) => (n) => { if (n.memory && n.memory.removed) n.memory.removed = n.memory.removed.filter((x) => !ids.includes(x.id)); },
};
/* how many changes of names the book has had (noteRenames) — noted when work takes the book's words — and the names
 * changed since a count was noted, in order: work asked before them is given them when it lands (archivist.js
 * readChanges, writer.js; names.js renameIn applies them one change at a time) */
export const renameCount = (novel) => Number(((novel || {}).memory || {}).renameN) || 0;
export const renamesSince = (novel, count) => (((novel || {}).memory || {}).renames || []).filter((x) => x && Number(x.n) > count);

/* ----------------------------------------------------- steps (chapter) */

function findPassage(c, pid) { return (c.passages || []).find((p) => p.id === pid); }
function findVersion(p, vid) { return p && (p.versions || []).find((v) => v.id === vid); }
/* a passage's words as they stand — each version's, and the one on show — for a step taken only while they read so */
export const passagePrint = (p) => (p ? hashText(JSON.stringify([(p.versions || []).map((v) => [v.id, String(v.text || ''), Boolean(v.streaming)]), p.pick])) : '');
/* Go on keeps the version's id while changing its words. A comparison
 * belongs to the words it read, including when its save is replayed. */
/* (head to head reads the writers' own words — a fix put in since does not undo it) */
export function duelMatches(p, row) {
  if (!p || !row) return false;
  const x = findVersion(p, row.x), y = findVersion(p, row.y);
  return Boolean(x && y && (!row.xSig || row.xSig === hashText(writtenOf(x))) && (!row.ySig || row.ySig === hashText(writtenOf(y))));
}

/* What the checker kept for a passage or its versions, put aside when they
 * went (pruneChecks), back with them: only for versions there again, never
 * over what was found since */
function checksBack(c, pid) {
  const g = c.checksGone && c.checksGone[pid];
  const p = findPassage(c, pid);
  if (!g || !p) return;
  for (const [vid, e] of Object.entries(g.checks || {})) {
    if (!findVersion(p, vid)) continue;
    c.checks = c.checks || {};
    c.checks[pid] = c.checks[pid] || {};
    if (!c.checks[pid][vid]) c.checks[pid][vid] = e;
    delete g.checks[vid];
  }
  if (g.left) { c.checksLeft = c.checksLeft || {}; c.checksLeft[pid] = [...(c.checksLeft[pid] || []), ...g.left.filter((x) => !(c.checksLeft[pid] || []).some((y) => y.find === x.find && y.replace === x.replace))]; g.left = null; }
  for (const [key, d] of Object.entries(g.duels || {})) {
    if (!duelMatches(p, d)) continue;
    c.duels = c.duels || {};
    if (!c.duels[key]) c.duels[key] = d;
    delete g.duels[key];
  }
  if (!Object.keys(g.checks || {}).length && !g.left && !Object.keys(g.duels || {}).length) delete c.checksGone[pid];
}

export const chapterSteps = {
  /* (`from`, given: only while the chapter is still called so — novelSteps.setField, 2.12.41) */
  setName: (name, by, from = undefined) => (c) => {
    if (from !== undefined && !readsAs(c.name, from)) return false;
    c.name = name; c.nameBy = by;
  },
  /* add a passage after another (or at the end), if it is not there yet */
  addPassage: (passage, afterId = null) => (c) => {
    if (findPassage(c, passage.id)) return;
    const copy = JSON.parse(JSON.stringify(passage));
    if (afterId === '^') c.passages.unshift(copy);
    else {
      const i = afterId ? c.passages.findIndex((p) => p.id === afterId) : -1;
      if (i >= 0) c.passages.splice(i + 1, 0, copy); else c.passages.push(copy);
    }
    checksBack(c, copy.id);
  },
  /* (`found`, given: the passage's words as the change found them — passagePrint — taken out only while it still reads
   * so, never with words another window put on it meanwhile: 2.12.41) */
  removePassage: (pid, found = undefined) => (c) => {
    if (found !== undefined && passagePrint(findPassage(c, pid)) !== found) return false;
    c.passages = c.passages.filter((p) => p.id !== pid);
  },
  /* a new version on a passage (if not there yet), shown — knowing the one
   * that was on show when it came (`was`): if it goes unkept (nothing came,
   * Stop before a word, its writer's window closed, an Undo), that one is on
   * show again, never simply the newest (Cozy Tavern M364). show false: what
   * the app writes by itself is written off the page — the words he is
   * reading stay on show until it is done (his report, 2.12.3: "blinking and
   * jagged and flashing") */
  addVersion: (pid, version, { show = true } = {}) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    if (!findVersion(p, version.id)) {
      const shown = picked(p);
      const copy = JSON.parse(JSON.stringify(version));
      /* (a copy of another version brings that one's `was`: this one's is the version on show now) */
      if (shown) copy.was = shown.id; else delete copy.was;
      p.versions.push(copy);
      if (!show && shown) return;
    }
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
    checksBack(c, pid);
  },
  removeVersion: (pid, vid) => (c) => {
    const p = findPassage(c, pid);
    if (!p || p.versions.length < 2) return;
    const shown = picked(p);
    const gone = findVersion(p, vid);
    /* WHO PUT IN THE WORDS OF A VERSION MADE FROM IT STAYS KNOWN (round 5, the review of round 4: a few words of his own
     * page written again, then the version they came from taken out — every word was the writer's): worked out while
     * the version it came from is still there, and kept on it */
    for (const x of p.versions) if (x && x.id !== vid && (x.how === 'selection' || x.how === 'edit') && (x.from || x.base) === vid && !x.streaming && !whoseFits(x)) x.whose = whoseNow(x, p);
    p.versions = p.versions.filter((v) => v.id !== vid);
    const back = gone && gone.was ? p.versions.findIndex((v) => v.id === gone.was) : -1;
    const keep = shown && shown.id !== vid ? p.versions.findIndex((v) => v.id === shown.id) : back >= 0 ? back : p.versions.length - 1;
    p.pick = Math.max(0, keep);
  },
  /* one version's words put on another of the same passage, and the one gone (inplace.js foldVersion): the other
   * takes the patch, whatever was made from the one gone is made from the other, what was on show stays on show
   * (the other, where it was the one gone), and what the checker found in its words is the other's now */
  foldVersion: (pid, childId, targetId, patch) => (c) => {
    const p = findPassage(c, pid);
    const child = findVersion(p, childId);
    const target = findVersion(p, targetId);
    if (!child || !target || childId === targetId) return;
    const shown = picked(p);
    for (const [k, val] of Object.entries(patch)) { if (val === undefined) delete target[k]; else target[k] = val; }
    for (const v of p.versions) {
      if (v.from === childId) v.from = targetId;
      if (v.base === childId) v.base = targetId;
      if (v.was === childId) v.was = targetId;
    }
    if (child.chosen && (!shown || shown.id === childId)) target.chosen = child.chosen;
    p.versions = p.versions.filter((v) => v.id !== childId);
    const keepId = shown && shown.id !== childId ? shown.id : targetId;
    p.pick = Math.max(0, p.versions.findIndex((v) => v.id === keepId));
    const byV = c.checks && c.checks[pid];
    if (byV) {
      const sig = hashText(String(target.text || ''));
      if (byV[childId] && byV[childId].sig === sig) byV[targetId] = byV[childId];
      else if (byV[targetId] && byV[targetId].sig !== sig) delete byV[targetId];
      delete byV[childId];
    }
    for (const [k, d] of Object.entries(c.duels || {})) if (d && d.pid === pid && (d.x === childId || d.y === childId)) delete c.duels[k];
    for (const r of c.retired || []) if (r && r.key === `${pid}:${childId}`) r.key = `${pid}:${targetId}`;
  },
  pick: (pid, vid) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    const i = p.versions.findIndex((v) => v.id === vid);
    if (i >= 0) p.pick = i;
  },
  /* put on show by his own hand (the arrows, or the one on show removed): his choice, kept on the version —
   * nothing the checker does by itself starts from it (checker.js autoAfter) */
  choose: (pid, vid, at = Date.now()) => (c) => {
    const p = findPassage(c, pid);
    if (!p) return;
    const i = p.versions.findIndex((v) => v.id === vid);
    if (i < 0) return;
    p.pick = i;
    p.versions[i].chosen = at;
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
  /* (`from`, given: only while the summary still reads as the change found it — his own words, the helper's, or none —
   * 2.12.41: an Undo, his partner's change, a name changed) */
  setSummary: (summary, from = undefined) => {
    const was = from === undefined ? undefined : JSON.stringify(from || null);
    return (c) => {
      if (was !== undefined && JSON.stringify(c.summary || null) !== was) return false;
      c.summary = summary;
    };
  },
  /* the summaries of the chapter as it read before (each by its words'
   * fingerprint): a version brought back brings its summary back too */
  clearSummaries: () => (c) => { c.summaries = []; },
  dropSummary: (fp) => (c) => { c.summaries = (c.summaries || []).filter((x) => x.fp !== fp); },
  /* his plan for the chapter (the story map): empty takes it away */
  setPlan: (text, from = undefined) => (c) => {
    /* (`from`, given: only while his plan still reads as the change found it — novelSteps.setField, 2.12.41) */
    if (from !== undefined && !readsAs(c.plan, from)) return false;
    const t = String(text || '').trim(); if (t) c.plan = String(text).replace(/\s+$/, ''); else delete c.plan;
  },
  /* the chapter's stretches (stretches.js): their bounds, and each one's summary while it fits its words */
  setStretches: (list) => (c) => { if (Array.isArray(list) && list.length) c.stretches = JSON.parse(JSON.stringify(list)); else delete c.stretches; },
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
  /* (`found`, given: the entry the new one was made from, as it stood here — laid only while the copy still holds that
   * one: his Check it again, or a checking laid meanwhile in another window, is never undone by an older entry laid
   * again over it — 2.12.41, a step laid again over another window's newer copy) */
  setCheck: (pid, vid, entry, found = undefined) => {
    /* (as it stood when the step was made: the entry here may change after) */
    const was = found === undefined ? undefined : JSON.stringify(found || null);
    return (c) => {
      const p = findPassage(c, pid);
      const v = p && findVersion(p, vid);
      if (!v || hashText(String(v.text || '')) !== entry.sig) return;
      if (was !== undefined && JSON.stringify((c.checks && c.checks[pid] && c.checks[pid][vid]) || null) !== was) return false;
      c.checks = c.checks || {};
      c.checks[pid] = c.checks[pid] || {};
      const next = JSON.parse(JSON.stringify(entry));
      /* WHAT HE LEFT STAYS LEFT (2.12.41, a step laid again over another window's newer copy): a suggestion he left as it
       * is on the copy it is laid on — in another window, while this one's checker looked — is never laid back on it (a
       * fix he left came back to Suggestions, and could go in by itself); the grade's own card is his to leave each time */
      const left = (c.checksLeft && c.checksLeft[pid]) || [];
      if (left.length && Array.isArray(next.items)) next.items = next.items.filter((x) => !x || x.kind === 'grade' || !left.some((l) => l && l.find === x.find && l.replace === (typeof x.replace === 'string' ? x.replace : null)));
      c.checks[pid][vid] = next;
    };
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
    /* (the speech marks of a paragraph: left whatever fix of them comes next — checker.js leftTest) */
    if (!list.some((x) => x.find === item.find && x.replace === replace)) list.push({ find: item.find, replace, ...(item.marks ? { marks: true } : {}) });
    /* past sixty, what can never be offered again goes — words no version of
     * the passage holds any more — never the oldest he left (Cozy Tavern
     * M559: a cap that lets the oldest go brings them back) */
    if (list.length > 60) {
      const p = findPassage(c, pid);
      const texts = ((p && p.versions) || []).map((v) => String(v.text || ''));
      c.checksLeft[pid] = list.filter((x) => texts.some((t) => t.includes(x.find)));
      if (c.checksLeft[pid].length > 600) c.checksLeft[pid].splice(0, c.checksLeft[pid].length - 600);
    }
  },
  /* the judge's head to head of two versions of one passage (checker.js) —
   * kept while both versions are there */
  setDuel: (key, row) => (c) => {
    const p = findPassage(c, row.pid);
    if (!duelMatches(p, row)) return;
    c.duels = c.duels || {};
    c.duels[key] = JSON.parse(JSON.stringify(row));
  },
  /* what was kept for passages and versions no longer in the chapter goes —
   * kept aside a while (checksGone), so an Undo that brings the passage or
   * its versions back brings back what the checker found, what he left and
   * the head to head with them (Cozy Tavern M578: removal and undo whole) */
  pruneChecks: (now = Date.now()) => (c) => {
    const gone = (c.checksGone = c.checksGone || {});
    /* the two days count from the newest thing kept aside for the passage */
    const stash = (pid) => { const g = (gone[pid] = gone[pid] && typeof gone[pid] === 'object' ? gone[pid] : { checks: {}, left: null, duels: {} }); g.checks = g.checks || {}; g.duels = g.duels || {}; g.at = now; return g; };
    for (const pid of Object.keys(c.checksLeft || {})) if (!findPassage(c, pid)) { stash(pid).left = c.checksLeft[pid]; delete c.checksLeft[pid]; }
    for (const [key, d] of Object.entries(c.duels || {})) {
      const p = d && findPassage(c, d.pid);
      if (!p || !findVersion(p, d.x) || !findVersion(p, d.y)) { if (d && d.pid) stash(d.pid).duels[key] = d; delete c.duels[key]; }
      else if (!duelMatches(p, d)) delete c.duels[key];
    }
    for (const pid of Object.keys(c.checks || {})) {
      const p = findPassage(c, pid);
      for (const vid of Object.keys(c.checks[pid])) if (!p || !findVersion(p, vid)) { stash(pid).checks[vid] = c.checks[pid][vid]; delete c.checks[pid][vid]; }
      if (!Object.keys(c.checks[pid]).length) delete c.checks[pid];
    }
    /* kept two days, forty passages at most */
    for (const k of Object.keys(gone)) if (!gone[k] || typeof gone[k] !== 'object') delete gone[k];
    const keys = Object.keys(gone).filter((k) => now - (gone[k].at || 0) < 2 * 86400000).sort((a, b) => (gone[b].at || 0) - (gone[a].at || 0)).slice(0, 40);
    for (const k of Object.keys(gone)) if (!keys.includes(k)) delete gone[k];
  },
  /* the checker's entry for one version let go (Check it again) */
  dropCheck: (pid, vid) => (c) => {
    if (!c.checks || !c.checks[pid]) return;
    delete c.checks[pid][vid];
    if (!Object.keys(c.checks[pid]).length) delete c.checks[pid];
  },
  /* he asked for the whole chapter to be checked, older passages too — and read whole once they are (checker.js runWhole) */
  checkAll: () => (c) => { c.checkAll = true; c.wholeAsked = true; },
  /* …and answered: nothing of it waits for that asking any more (checker.js runCheck, 2.12.40) */
  checkedAll: () => (c) => { delete c.checkAll; },
  /* the chapter read whole by the checker: the words it read (checker.js wholeSig), when, how many times that day,
   * how long it was — or that its model would not read it (missed); his asking for it is answered */
  setWholeRead: (row) => (c) => { c.wholeRead = JSON.parse(JSON.stringify(row)); delete c.wholeAsked; },
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
    if (!t.versions.some((v) => v.id === version.id)) {
      const shown = picked(t);
      const copy = JSON.parse(JSON.stringify(version));
      if (shown) copy.was = shown.id; else delete copy.was;
      t.versions.push(copy);
    }
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
    const gone = t.versions.find((v) => v.id === vid);
    t.versions = t.versions.filter((v) => v.id !== vid);
    const back = gone && gone.was ? t.versions.findIndex((v) => v.id === gone.was) : -1;
    const keep = shown && shown.id !== vid ? t.versions.findIndex((v) => v.id === shown.id) : back >= 0 ? back : t.versions.length - 1;
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
/* WHAT OF A CARD IS HIS (Cozy Tavern's M263: his hand is kept field by
 * field). A card he wrote or changed is his — never taken out, his words
 * never written over — but only in the fields he wrote: the helper and the
 * notes' check still write the rest as the book goes on. A card marked his
 * before fields were told apart is his whole. */
export const CARD_FIELDS = ['name', 'aka', 'about', 'ties', 'now', 'open'];
export const hisCard = (card) => Boolean(card && card.updated && card.updated.by === 'you');
export function hisField(card, field) {
  if (!hisCard(card)) return false;
  const list = card.updated.his;
  return !Array.isArray(list) || list.includes(field);
}
/* his mark once he (or his partner, for him) wrote these fields — with when his words were written (`hisAt`, 2.12.40:
 * the helper's own changes move `at`, never this; a premise of his is weighed against it, archivist.js foldNotes) */
export function hisStamp(card, fields, at = Date.now()) {
  if (hisCard(card) && !Array.isArray(card.updated.his)) return { by: 'you', at, hisAt: at };
  const before = hisCard(card) ? card.updated.his : [];
  return { by: 'you', at, hisAt: at, his: CARD_FIELDS.filter((k) => before.includes(k) || (fields || []).includes(k)) };
}
/* when his words on a card were written: his mark's own time, else (a mark from before 2.12.40) when the card last
 * changed — never later than that */
export const hisAtOf = (updated) => Number((updated && (updated.hisAt || updated.at)) || 0);
/* A CARD'S WORDS NEVER CARRY THE NOTES' OWN DISPLAY (2.12.16; 2.12.18 for
 * every field and every kind). The notes are shown to the helper as
 * "- Name (also A, B) — who they are (my words) / With others: … / Right now:
 * … / Last seen (Chapter N): … / Since then: …"; a model copies that display
 * back, and a second card is made for "Name (also A, B)", or a fact is lost,
 * or a label shows twice. `unrender` takes the display off whatever a row or a
 * card gives: the other names into aka, "(my words)" off, a label at the head
 * of ties or now off, and labelled lines out of "about" — for a person into
 * ties or now (when those are not given) or, for "Since then", kept in "about"
 * so what it adds is read as added; for a place, a thing or a thread (which
 * have no "now" of their own) the words kept in "about", the label off. */
const ALSO = /^(.*?\S)\s*\(also ([^()]*)\)\s*$/i;
const LABEL_HEAD = /^\s*(?:[-•]\s*)?(with others|right now|now|since then|last seen \(chapter [a-z -]+\))\s*:\s*/i;
const LABEL_INLINE = /\s+(with others|right now|since then|last seen \(chapter [a-z -]+\))\s*:\s*/gi;
const MY_WORDS = /\s*\(my words\)/gi;
const keyOf = (label) => { const l = label.toLowerCase(); return l === 'with others' ? 'ties' : l === 'since then' ? 'since' : 'now'; };
const asText = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : v);
export function unrender(kind, fields) {
  const out = { ...fields };
  const person = kind === 'people';
  if (typeof out.name === 'string') {
    const m = ALSO.exec(out.name);
    if (m) {
      out.name = m[1].trim();
      const more = m[2].split(',').map((x) => x.trim()).filter(Boolean);
      const had = Array.isArray(out.aka) ? out.aka : typeof out.aka === 'string' ? out.aka.split(',') : [];
      out.aka = [...had, ...more];
    }
  }
  const head = (v) => (typeof v === 'string' ? v.replace(MY_WORDS, '').replace(LABEL_HEAD, '') : v);
  const about = asText(out.about);
  const shows = (t) => /\(my words\)/i.test(t) || /\s(with others|right now|since then|last seen \(chapter [a-z -]+\))\s*:/i.test(t) || t.split('\n').some((l) => LABEL_HEAD.test(l));
  /* (words with none of the display in them stay exactly as given) */
  if (typeof about === 'string' && shows(about)) {
    /* a label run together on one line is a line of its own */
    const lines = about.replace(MY_WORDS, '').replace(LABEL_INLINE, (all, label) => `\n${label}: `).split('\n');
    const kept = [];
    const got = {};
    for (const l of lines) {
      const m = LABEL_HEAD.exec(l);
      if (!m) { kept.push(l); continue; }
      const words = l.slice(m[0].length).trim();
      const key = keyOf(m[1]);
      if (!words) continue;
      if (person && key !== 'since') { if (!got[key]) got[key] = words; continue; }
      kept.push(words);
    }
    out.about = kept.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (got.ties && !String(asText(out.ties) || '').trim()) out.ties = got.ties;
    if (got.now && !String(asText(out.now) || '').trim()) out.now = got.now;
  }
  for (const f of ['ties', 'now']) {
    const v = asText(out[f]);
    if (typeof v !== 'string' || !shows(v)) continue;
    /* a "Right now:" line inside ties is the person's now, when none is given */
    const lines = v.split('\n');
    const kept = [];
    for (const l of lines) {
      const m = LABEL_HEAD.exec(l);
      if (m && f === 'ties' && keyOf(m[1]) === 'now' && person) { const w = l.slice(m[0].length).trim(); if (w && !String(asText(out.now) || '').trim()) out.now = w; continue; }
      kept.push(head(l));
    }
    out[f] = kept.map((l) => l.trim()).filter(Boolean).join('\n');
  }
  return out;
}
/* a card cleared of the notes' display (null when it had none): what it says
 * twice goes, what it says once is kept where it belongs */
export function cleanCard(card, kind = 'people') {
  if (!card) return null;
  const fields = { name: card.name, aka: card.aka, about: card.about, ties: card.ties, now: card.now };
  const MINE_ONE = /\(my words\)/i;
  const INLINE_ONE = /\s(with others|right now|since then|last seen \(chapter [a-z -]+\))\s*:/i;
  const touched = ['name', 'about', 'ties', 'now'].some((f) => typeof fields[f] === 'string' && (MINE_ONE.test(fields[f]) || LABEL_HEAD.test(fields[f]) || (f === 'about' && (/\n/.test(fields[f]) || INLINE_ONE.test(fields[f]))) || (f === 'name' && ALSO.test(fields[f]))));
  if (!touched) return null;
  /* a stored card: a "Since then" line in its words is what its own Since then says (kept there when it has none), never its words */
  let since = '';
  const about0 = typeof card.about === 'string' ? card.about.replace(LABEL_INLINE, (all, label) => `\n${label}: `) : card.about;
  LABEL_INLINE.lastIndex = 0;
  const aboutNoSince = typeof about0 === 'string' ? about0.split('\n').filter((l) => { const m = LABEL_HEAD.exec(l); if (m && keyOf(m[1]) === 'since') { since = since || l.slice(m[0].length).trim(); return false; } return true; }).join('\n') : about0;
  const u = unrender(kind, { ...fields, about: aboutNoSince, ties: String(card.ties || '').trim() ? card.ties : undefined, now: String(card.now || '').trim() ? card.now : undefined });
  const next = { ...card, name: u.name, about: u.about };
  if (Array.isArray(u.aka) && u.aka.length) next.aka = u.aka.filter((a, i) => u.aka.findIndex((b) => String(b).toLowerCase() === String(a).toLowerCase()) === i && String(a).toLowerCase() !== String(u.name).toLowerCase());
  if (kind === 'people') { if (u.ties !== undefined) next.ties = u.ties; if (u.now !== undefined) next.now = u.now; }
  if (since && !String(card.since || '').trim()) next.since = since;
  if (JSON.stringify(next) === JSON.stringify(card)) return null;
  return next;
}
/* his mark without one field (the book, changed by him, is his newer word for it — archivist foldNotes, 2.12.10) */
export function letGoStamp(updated, field, chapterId, at) {
  const list = Array.isArray(updated && updated.his) ? updated.his : CARD_FIELDS;
  const off = Array.isArray(field) ? field : [field];
  const his = list.filter((k) => !off.includes(k));
  return his.length ? { by: 'you', his, ...(hisAtOf(updated) ? { hisAt: hisAtOf(updated) } : {}), chapterId, at } : { chapterId, at };
}
/* WORDS HE CHANGED HIMSELF (2.12.10): a passage written again from his note or
 * his partner's (never the app's own lift), the words he selected written again
 * (never the checker's by itself), his partner's own passage, his own words, or
 * his hand or his partner's on the page. A card he wrote is held against these:
 * where they say the opposite of his words, the book is his newer word. The
 * writer's fresh page, a scene's prose and the app's own fixes are not his — a
 * slip in them is the checker's to catch, never a reason to change his card. */
export const hisChange = (v) => Boolean(v) && ((v.how === 'rewrite' && !v.lift) || (v.how === 'selection' && !v.spanAuto) || v.how === 'partner' || v.how === 'mine' || mixedHands(v));
/* HIS OWN WORDS ON A PAGE (2.12.41, the review — a writer's page his hand or his partner barely touched, a name changed
 * everywhere or a word mended, was told to the helper as "my own words" over his entries): a page he wrote himself, or
 * one most of whose words now are his own hand's — who put in each word standing on it now (`whose`, whoseOf: 2.12.41,
 * the review of 2.12.41 — shares of every word ever put in were counted, so his words written over by his partner were
 * still his, and his own rewrite of his partner's words was not). Never a name changed everywhere (it keeps the hand of
 * the word it replaced), nor the writer's words he only put back. A page he wrote himself is counted the same: his
 * words, each his until another hand writes over it (his partner's change over all of it is his partner's words) — and
 * a few of its words written again at his note, the writer's, the rest as they were on the version they came from (each
 * version's own kind decides, never the page's it came from: words brought in from a file are no words of his hand, and
 * his own words on one stay his — 2.12.41, the review of 2.12.41: a few words written again on the writer's page his
 * edit had made his for the most part was no page of his). */
export function ownWords(passage) {
  const v = picked(passage);
  if (!v || v.streaming) return false;
  /* (no hand of his on it: nothing to count) */
  if (!mayHoldHis(v, passage)) return false;
  const hands = whoseOf(v, passage);
  if (!hands.length) return false;
  let his = 0;
  for (const h of hands) if (h === 'you') his++;
  return his > hands.length / 2;
}
/* (whether a version can hold words of his hand at all: his own page, his edit kept as a version, a change of his kept on
 * it or let go — or a few words written again on one that can, the rest its words, as whoseOf takes them) */
function mayHoldHis(v, passage, depth = 0) {
  if (!v) return false;
  const before = Array.isArray(v.before) ? v.before : [];
  if (v.how === 'mine' || v.how === 'edit' || handsOf(v).includes('you') || before.some((b) => b && b.by === 'you' && !noHand(b)) || (v.gone && v.gone.you)) return true;
  /* (who put in its words kept on it, his among them: the version it came from may be taken out since — removeVersion) */
  if (runsFit(v.whose, v.text) && v.whose.runs.some((r) => r && r[0] === 'you')) return true;
  if (v.how !== 'selection' || !passage || depth >= 4) return false;
  return mayHoldHis((passage.versions || []).find((x) => x && x.id === (v.from || v.base) && x.id !== v.id), passage, depth + 1);
}
/* the mark a card keeps when the helper writes what is not his */
export function keptStamp(card, chapterId, at) {
  if (!hisCard(card)) return { chapterId, at };
  /* (when his words were written stays: the helper's change is not his — 2.12.40) */
  return { by: 'you', ...(Array.isArray(card.updated.his) ? { his: [...card.updated.his] } : {}), ...(hisAtOf(card.updated) ? { hisAt: hisAtOf(card.updated) } : {}), chapterId, at };
}

/* A THREAD IS FOUND BY SENSE (Cozy Tavern M259, M653): two titles say the
 * same thing when every telling word of the shorter is in the longer, and the
 * shorter has two at least; a word is its stem (promise, promised, promises).
 * A share of the words is not enough ("Claire Stone" is not "Alaric Stone"),
 * and a title of names alone says only who — the same thread only as the very
 * same names. */
const THREAD_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'hers', 'their', 'about', 'into', 'over', 'will', 'what', 'who', 'was', 'are', 'has', 'have', 'had', 'its', 'not', 'but', 'out', 'off', 'onto', 'upon', 'after', 'before', 'him', 'she', 'they', 'them']);
function titleWords(t) {
  const all = new Set();
  const common = new Set();
  /* the names, in the order the title gives them (whose vow, to whom) */
  const caps = [];
  const tokens = String(t || '').replace(/[‘’´`]/g, "'").replace(/'s\b/gi, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/);
  for (const raw of tokens) {
    const low = raw.toLowerCase();
    if (low.length <= 2 || THREAD_STOP.has(low)) continue;
    let w = low;
    if (w.length > 4) w = w.replace(/(?:ing|ed|es|s)$/, '');
    if (w.length > 4) w = w.replace(/e$/, '');
    all.add(w);
    if (raw[0] === raw[0].toLowerCase()) common.add(w);
    else if (!caps.includes(w)) caps.push(w);
  }
  return { all, common, caps };
}
/* Two titles are one thread when the shorter's telling words all stand in the
 * longer and cover four-fifths of it at least (Cozy Tavern M522: "Who killed
 * the king" is not "Who killed the king's guard"), and the people both name
 * come in the same order (M738: "Jovan's vow to protect Yuki" is not "Yuki's
 * vow to protect Jovan"). */
/* one title's telling words all in the other's, at any coverage: it may be
 * the same thread, or a narrower or wider one — never written on as the same */
export function threadsNear(a, b) {
  const x = titleWords(a);
  const y = titleWords(b);
  const [short, long] = x.all.size <= y.all.size ? [x, y] : [y, x];
  if (short.all.size < 2) return false;
  for (const w of short.all) if (!long.all.has(w)) return false;
  return true;
}
export function sameThreadTitle(a, b) {
  const x = titleWords(a);
  const y = titleWords(b);
  const [short, long] = x.all.size <= y.all.size ? [x, y] : [y, x];
  if (short.all.size < 2) return false;
  for (const w of short.all) if (!long.all.has(w)) return false;
  if (short.all.size < long.all.size * 0.8) return false;
  const shared = x.caps.filter((w) => y.caps.includes(w));
  if (shared.length >= 2 && shared.join(' ') !== y.caps.filter((w) => shared.includes(w)).join(' ')) return false;
  if (!short.common.size) return short.all.size === long.all.size;
  return true;
}
const sameWords = (a, b) => { const x = titleWords(a).all; const y = titleWords(b).all; return x.size === y.size && [...x].every((w) => y.has(w)); };

/* The card a name means (Cozy Tavern's lessons: a name matched loosely takes
 * the first card that shares it and writes on the wrong one, M584/M600/M607;
 * one person on two cards, M405/M414): the card called that comes first, then
 * the one that also goes by it, then the one whose name is among the other
 * names given with it, then — for a person — the one whose name is a short or
 * fuller form of it (Rias for Rias Wells, Captain Hitsugaya for Toshiro
 * Hitsugaya), for a place or a thing the one called the same but for a
 * leading "the", and last a person's name with a slip of the pen in it.
 * Past the first, a name two cards answer to means neither: `ambiguous`, and
 * nothing is written. */
export function matchCard(cards, name, aka = [], { kind = '', near = true, slip: slipOk = true } = {}) {
  const k = nameKey(name);
  if (!k) return { card: null, ambiguous: false };
  const list = cards || [];
  const exact = list.find((c) => nameKey(c.name) === k);
  if (exact) return { card: exact, ambiguous: false };
  const one = (found, how = '') => (found.length === 1 ? { card: found[0], ambiguous: false, ...(how ? { how } : {}) } : found.length > 1 ? { card: null, ambiguous: true, among: found } : null);
  /* for a reading's row about a person (Cozy Tavern M752): a description a
   * card was once known by is the record of how it was named, never a name a
   * new row answers to — another courier forty pages on is another courier;
   * and another name a card goes by answers only when no other card answers
   * to it by its own name too */
  const loose = near && kind === 'people';
  const byAkaList = list.filter((c) => (c.aka || []).some((a) => nameKey(a) === k && !(loose && isDescriptorName(a))));
  const alsoOwn = loose && byAkaList.length === 1 && !isDescriptorName(name) ? list.filter((c) => c !== byAkaList[0] && (samePersonName(c.name, name) || nearName(c.name, name))) : [];
  if (alsoOwn.length) return { card: null, ambiguous: true, among: [byAkaList[0], ...alsoOwn] };
  const byAka = one(byAkaList);
  if (byAka) return byAka;
  const others = (aka || []).map(nameKey).filter(Boolean);
  const byOthers = others.length ? one(list.filter((c) => others.includes(nameKey(c.name)))) : null;
  if (byOthers) return byOthers;
  /* a description is no person's name ("the girl"); a place or a thing may be called "The …" */
  const named = (n) => n && (kind !== 'people' || !isDescriptorName(n));
  const forms = [name, ...(aka || [])].filter(named);
  const namesOf = (c) => [c.name, ...(c.aka || [])].filter(named);
  /* a short or fuller form only where it is asked for: the helper's rows — never a change he made through the partner, which names its card exactly */
  /* (a place or a thing: its owner's possessive set aside — "Bruce's Batwing" is the Batwing) */
  const sameAs = (n, f) => (kind === 'people' ? samePersonName(n, f) : kind === 'places' || kind === 'lore' ? sameThingName(n, f) : plainName(n) === plainName(f));
  const close = near && forms.length ? one(list.filter((c) => namesOf(c).some((n) => forms.some((f) => sameAs(n, f))))) : null;
  if (close) return close;
  /* a thread in other words, for a reading's row: the one that says it in
   * the very same words when several answer; if they are all copies of one
   * thread, the oldest; threads that are not each other's copies both
   * answering mean neither (Cozy Tavern M653) */
  if (near && kind === 'threads') {
    const hits = list.filter((c) => [c.name, ...(c.aka || [])].some((n) => [name, ...(aka || [])].some((f) => sameThreadTitle(n, f))));
    if (hits.length === 1) return { card: hits[0], ambiguous: false };
    if (hits.length > 1) {
      const very = hits.filter((c) => sameWords(c.name, name));
      if (very.length === 1) return { card: very[0], ambiguous: false };
      if (hits.every((a) => hits.every((b) => a === b || sameThreadTitle(a.name, b.name)))) return { card: hits[0], ambiguous: false };
      return { card: null, ambiguous: true, among: hits };
    }
  }
  /* a slip of the pen, for a person only: one long word of the name a letter
   * off (Cozy Tavern M646) — `how: 'slip'`, so the slip is never kept as a
   * name the card goes by */
  const slip = loose && slipOk && forms.length ? one(list.filter((c) => namesOf(c).some((n) => forms.some((f) => nearName(n, f)))), 'slip') : null;
  return slip || { card: null, ambiguous: false };
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
  /* a thing with a name of its own (the Batwing, the Hollow Crown) stands while the book names it (Cozy Tavern M752) — a description ("the letter") never */
  if (kind === 'lore') { const bare = String(card.name || '').trim().replace(/^(?:the|a|an)\s+/i, ''); return /\p{Lu}/u.test(bare) && nameInText(folded, bare, { words: false }); }
  return false;
}
/* The cards that carry a card's name — the one it was folded into */
export function carriersOf(kind, card, cards) {
  return (cards || []).filter((o) => o.id !== card.id && [o.name, ...(o.aka || [])].some((n) => (kind === 'people' ? samePersonName(n, card.name) : kind === 'places' || kind === 'lore' ? sameThingName(n, card.name) : plainName(n) === plainName(card.name))));
}
export function carriedBy(kind, card, cards) { return carriersOf(kind, card, cards).length > 0; }
