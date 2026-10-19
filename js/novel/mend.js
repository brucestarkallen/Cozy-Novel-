/* Cozy Novel — js/novel/mend.js — PAGES KEPT BEFORE A REPAIR, MENDED ONCE.
 *
 * A page is made whole as it arrives (writer.js, talk.js): a plan or a
 * heading above it, a note to him, a check of its own work or a block of
 * tracking after it taken off and kept with the version, a soft wrap joined,
 * a stray of another script glued to a word taken off, a quotation left open
 * closed. Pages kept before each of those
 * repairs still carry the fault — read by the helper as story, sent back to
 * the writer as the chapter (teaching it to write the same again), printed
 * in the book sent out (Cozy Tavern M477, M488, M524).
 *
 * So, once per book for each version of the repair (`memory.mended`), when
 * the book opens: every version a writer made — never his own words, his
 * edits or what was brought in (howOf) — and every telling of a scene goes
 * through the same repair. Written in place only where something moved, what
 * came off kept with the version (⋯ → Put back), and what the helper read
 * and the checker found moved to the mended words, so nothing is read or
 * checked again for words that only lost what was never the story. A page
 * cut short keeps its unfinished end as it is (Go on finishes it). */

import * as store from '../store.js';
import { howOf, chapterSteps, novelSteps, turnSteps, chapterText, handsOf, picked, noHand, noneLetGo, wordsMatched, whoseFits, whoseNowWork } from './shape.js';
import { foldVersion, bookNameWords, bookTexts } from './inplace.js';
import { joinSoftWraps, finishTail, mendMarks, dropGluedStrays, dropTop, dropMarkup, partBlock, mendSpacing, unglueSounds } from './textshape.js';
import { shapeTelling } from './talk.js';
import { resign } from './archivist.js';
import { locate } from './changes.js';
import { liftOfFaults, wholeSig } from './checker.js';
import { hashText, countWords } from '../util.js';
import { carriedCodex } from './bibliography.js';
import { carriedContinuity } from './timeline.js';
import { nameWordsIn, renameIn, nameWordKey, bookEvidence, nameByEvidence } from './names.js';

/* 2: a plan or a draft above the page, and its check of its own work after it, come off too; a lift echoed from an old example is said again
 * 3: a web page's or code's markup left in a page (“…paid for.</code>”, his report 2.12.2) comes off; and a fix made as a
 *    version of its own (foldOld) goes on the version it was made from */
/* 4: speech marks paired in order — a mark standing where a lost quote belongs made that quote, a pair in two kinds
 *    written in one, a curly mark facing the wrong way turned, speech wrapped in asterisks unwrapped, an asterisk left
 *    open closed inside its own stretch, and a page that came as one block parted where speech begins (Cozy Tavern
 *    M753, M510-17, 2.12.34) */
/* 5: a space a slip of the hand left out or put in — after a full stop or a comma, around speech marks, before a comma
 *    (textshape.js spacingSlips); and what 4 did wrong, undone: the sounds it glued to the speech between them —
 *    `*CLANG!* "Nngh—!" *THUD*` made `*CLANG!"Nngh—!"THUD*` — parted again (unglueSounds; a bold it took off a spoken
 *    line cannot be told from an italic, and stays off); a chapter read whole stays read (2.12.35) */
export const MEND_V = 5;
const HIS = ['mine', 'edit', 'imported'];

/* one version's words made whole as a new page's are: {text, tookOff, tookOffTop} */
export function mendPage(v, { names = [] } = {}) {
  const given = String((v && v.text) || '');
  const cut = Boolean(v && v.cut);
  const head = dropTop(unglueSounds(given), { names });
  let text = joinSoftWraps(partBlock(head.text).text);
  let tail = '';
  /* the unfinished end of a page cut short is story still to be carried on — never a note */
  if (!cut) {
    const fin = finishTail(text);
    if (fin.removed) { text = fin.text.replace(/\s+$/, ''); tail = fin.removed; }
  }
  text = mendMarks(dropMarkup(dropGluedStrays(text).text).text, { leaveLast: cut }).text;
  text = mendSpacing(text, { leaveLast: cut }).text;
  return { text, tookOff: tail, tookOffTop: head.removed || '' };
}

/* what was kept aside, beside what comes off now */
const joined = (a, b) => [a, b].filter((x) => String(x || '').trim()).join('\n\n') || undefined;

/* Mend every page of a book once (for this version of the repair):
 * {pages, tellings} mended — none when nothing needed it, or the book is not
 * all here yet (it is tried again the next time it opens). */
export async function mendBook(novelId) {
  const none = { pages: 0, tellings: 0, versions: 0 };
  const novel = store.peek('novel', novelId);
  if (!novel || ((novel.memory || {}).mended || 0) >= MEND_V) return none;
  const chapters = (novel.order || []).map((id) => store.peek('chapter', id));
  if (chapters.some((c) => !c)) return none;
  let n = 0;
  let told = 0;
  /* a chapter read whole as it stood: still read, once its words have lost only what was never the story (2.12.35, the
   * audit: through 2.12.34 every chapter with a page mended was read whole again) */
  const readWas = new Set(chapters.filter((c) => c.wholeRead && c.wholeRead.sig === wholeSig(c)).map((c) => c.id));
  /* the fixes made as versions of their own first, then the pages, at once — before the helper looks at the book */
  const versions = foldOld(novelId, chapters.map((c) => c.id));
  for (const c of chapters) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      for (const v of p.versions || []) {
        if (v.streaming || HIS.includes(howOf(v)) || handsOf(v).includes('you') || !String(v.text || '').trim()) continue;
        const was = String(v.text || '');
        const m = mendPage(v, { names: [c.name].filter(Boolean) });
        if (m.text === was || !m.text.trim()) continue;
        store.change('chapter', c.id, chapterSteps.setVersion(p.id, v.id, {
          text: m.text, words: countWords(m.text),
          /* (the words before the fixes by themselves mended the same way: what went in by itself is still measured
           * from them — shape.js autoBaseOf) */
          ...(typeof v.autoBase === 'string' ? { autoBase: mendPage({ ...v, text: v.autoBase }, { names: [c.name].filter(Boolean) }).text } : {}),
          ...(m.tookOff ? { tookOff: joined(m.tookOff, v.tookOff) } : {}),
          ...(m.tookOffTop ? { tookOffTop: joined(v.tookOffTop, m.tookOffTop) } : {}),
        /* (not a checkpoint: the chapter as it was before the mend is kept among its earlier copies) */
        }));
        /* what the checker found for these words: on the mended words, what still stands in them */
        store.change('chapter', c.id, (ch) => {
          const e = ch.checks && ch.checks[p.id] && ch.checks[p.id][v.id];
          if (!e || e.sig !== hashText(was)) return;
          e.sig = hashText(m.text);
          e.items = (e.items || []).filter((x) => x.kind === 'grade' || !x.find || !locate(m.text, x.find).why);
        }, { checkpoint: true });
        /* the bibliography's facts of them, where every one still stands in the mended words (else read for them again) */
        store.change('chapter', c.id, (ch) => {
          const pp = (ch.passages || []).find((x) => x.id === p.id);
          const vv = pp && (pp.versions || []).find((x) => x.id === v.id);
          if (!vv || !vv.codex || vv.codex.fp !== hashText(was) || hashText(String(vv.text || '')) !== hashText(m.text)) return false;
          const facts = carriedCodex(vv.codex, m.text);
          if (!facts) return false;
          vv.codex = facts;
        }, { checkpoint: true });
        /* the Timeline's turns of them, as the facts (timeline.js carriedContinuity, 2.12.37: the helper never reads mended
         * words again, so turns left with the words before counted the passage as never read) */
        store.change('chapter', c.id, (ch) => {
          const pp = (ch.passages || []).find((x) => x.id === p.id);
          const vv = pp && (pp.versions || []).find((x) => x.id === v.id);
          if (!vv || !vv.continuity || vv.continuity.fp !== hashText(was) || hashText(String(vv.text || '')) !== hashText(m.text)) return false;
          const turns = carriedContinuity(vv.continuity, m.text);
          if (turns) vv.continuity = turns; else delete vv.continuity;
        }, { checkpoint: true });
        /* and what the helper read of them */
        resign(novelId, c.id, p.id, v.id, was, m.text);
        n++;
      }
    }
  }
  for (const id of readWas) {
    const c = store.peek('chapter', id);
    const sig = c && wholeSig(c);
    if (c && c.wholeRead && c.wholeRead.sig !== sig) store.change('chapter', id, chapterSteps.setWholeRead({ ...c.wholeRead, sig }), { checkpoint: true });
  }
  /* a lift the judge of 2.4 echoed from its own example — "Slow the moment
   * Yuki falls…" — in a book with no Yuki is not this book's: it would be
   * sent to the writer as the note for writing a page again. Said again from
   * the checks the page failed (Cozy Tavern M95-3: an example from an older
   * prompt echoed into what was kept) */
  const ECHO = /\bYuki\b/;
  if (!ECHO.test(JSON.stringify([novel.brief, novel.style, novel.plans, novel.notes])) && !chapters.some((c) => ECHO.test(chapterText(c)))) {
    for (const c of chapters) {
      const echoed = Object.values(c.checks || {}).some((byV) => Object.values(byV || {}).some((e) => e && (ECHO.test((e.grade && e.grade.lift) || '') || (e.items || []).some((x) => ECHO.test(x.lift || '')))));
      if (!echoed) continue;
      store.change('chapter', c.id, (ch) => {
        for (const byV of Object.values(ch.checks || {})) {
          for (const e of Object.values(byV || {})) {
            if (!e) continue;
            if (e.grade && ECHO.test(e.grade.lift || '')) e.grade.lift = liftOfFaults(e.grade.faults);
            for (const x of e.items || []) {
              if (ECHO.test(x.lift || '')) x.lift = liftOfFaults((x.grade || e.grade || {}).faults);
              if (x.grade && ECHO.test(x.grade.lift || '')) x.grade.lift = x.lift;
            }
          }
        }
      }, { checkpoint: true });
    }
  }
  /* then the scenes' tellings, read in first (a scene not here now: the book is mended again the next time it opens — the pages are already whole) */
  const plays = [];
  for (const id of novel.plays || []) {
    const play = store.peek('play', id) || (await store.open('play', id).catch(() => null));
    if (!play) return { pages: n, tellings: 0 };
    plays.push([id, play]);
  }
  /* — never one he had put back whole */
  for (const [id, play] of plays) {
    for (const t of play.turns || []) {
      if (t.by !== 'ai') continue;
      for (const v of t.versions || []) {
        if (v.streaming || v.asIs || !String(v.text || '').trim()) continue;
        const was = String(v.text || '');
        const m = shapeTelling(unglueSounds(was), { cut: Boolean(v.cut) });
        if (m.text === was || !m.text.trim()) continue;
        store.change('play', id, turnSteps.setVersion(t.id, v.id, {
          text: m.text,
          ...(m.tookOff ? { tookOff: joined(m.tookOff, v.tookOff) } : {}),
          ...(m.tookOffTop ? { tookOffTop: joined(v.tookOffTop, m.tookOffTop) } : {}),
        }));
        told++;
      }
    }
  }
  store.change('novel', novelId, novelSteps.setMemory({ mended: MEND_V }), { checkpoint: true });
  return { pages: n, tellings: told, versions };
}

/* A FIX MADE AS A VERSION OF ITS OWN, PUT ON THE VERSION IT WAS MADE FROM
 * (his word, 2.12.2: "it keeps rewrite rewrite new version … I can't even
 * know which version is what"; "new version is only for rewrite or another
 * take"). Through 2.12.1 each checking's fixes, a sentence the checker had
 * written again by itself, and a few words his partner changed each made a
 * version: each goes on the version it was made from (inplace.js
 * foldVersion — the words before kept on it, what the helper read, the
 * checker found and the bibliography holds moved with them). Never:
 *  - one made from words that are not that version's any more (two made
 *    from the same words: the second stays a version of its own);
 *  - onto the version he has on show, when the fix is not the one on show
 *    (he went back to the words without it);
 *  - a passage being written, his own edit, a passage his partner wrote
 *    anew (a rewrite), a rewrite, another take.
 * How many went. */
const FOLD_BY = { suggested: 'checker', selection: 'checker', partner: 'partner' };
function foldable(v) {
  if (v.how === 'suggested') return Boolean(v.from);
  if (v.how === 'selection') return Boolean(v.spanAuto && v.base);
  /* (a few words changed keeps the root it came from — a passage written anew does not) */
  if (v.how === 'partner') return Boolean(v.from && v.rootHow);
  return false;
}
export function foldOld(novelId, chapterIds) {
  let folded = 0;
  for (const cid of chapterIds) {
    const c = store.peek('chapter', cid);
    for (const p0 of (c && c.passages) || []) {
      if (p0.by === 'break' || (p0.versions || []).some((v) => v.streaming) || !(p0.versions || []).some(foldable)) continue;
      /* (as they stood before any of them went: a fold points what was made from the one gone at the other) */
      const orig = new Map(p0.versions.map((v) => [v.id, String(v.text || '')]));
      const parentOf = new Map(p0.versions.map((v) => [v.id, v.how === 'selection' ? v.base : v.from]));
      const shownAtStart = (picked(p0) || {}).id;
      const into = new Map();
      const resolve = (id) => { let x = id; for (let k = 0; k < 100 && into.has(x); k++) x = into.get(x); return x; };
      for (const v of [...p0.versions]) {
        if (!foldable(v)) continue;
        const parentId = parentOf.get(v.id);
        const targetId = resolve(parentId);
        if (targetId === shownAtStart) continue;
        const live = store.peek('chapter', cid);
        const p = live && (live.passages || []).find((x) => x.id === p0.id);
        const target = p && p.versions.find((x) => x.id === targetId);
        if (!target || !orig.has(parentId) || String(target.text || '') !== orig.get(parentId)) continue;
        if (foldVersion({ novelId, chapterId: cid, passageId: p0.id, childId: v.id, targetId, by: FOLD_BY[v.how] })) { into.set(v.id, targetId); folded++; }
      }
    }
  }
  return folded;
}

/* NAMES CHANGED EVERYWHERE BEFORE 2.12.41, MARKED ONCE (2.12.41, the review of 2.12.41 — the app repairs what it can
 * detect). Through 2.12.40 a name changed everywhere was kept as one more change of his partner's on each page it
 * touched: a writer's page touched only by "Mara" becoming "Marla" was "changed by your partner" — his partner's words
 * for his cards to be held against (shape.js hisChange), out of the writer's row in the judge's grades, "my partner
 * changed its words for me" beside his premise, and someone else's words on a page of his own. When the book opens, once
 * (`memory.renamesMarked`), each such change is marked `rename`, as a name changed everywhere is marked since:
 *  - exactly, while his partner's conversation keeps the change — its words before and after for this very passage: a
 *    name changed everywhere (op.rename) is marked, even one the words alone cannot tell is a name ("Sir" becoming
 *    "Galahad"); any other change of his partner's kept there is his partner's, as it was (2.12.41, the review of
 *    2.12.41: only a name changed everywhere is no one's hand — "Tom held the door" made "Jovan held the door" is who
 *    did it, not a name);
 *  - else by the words, only where they leave the book as a name changed everywhere leaves it: the words after are the
 *    words before with whole names swapped, the same way everywhere, and nothing else (renameSwaps — a name by the
 *    book's evidence, names.js), every name it took out standing nowhere in the book now — on no page (two names traded
 *    still stand on the page itself), no card (the card of who held the door) — and every name it put in a name by the
 *    book's evidence: a card's or an entry's, or a word the book writes as a name and never as a word (the review of
 *    2.12.41: who did a deed, two parts traded, or "Green light" made "Grey light", was marked). His entries never
 *    count: 2.12.40's rename never reached them, so an entry under the old name is the book as it left it (round 5, the
 *    review of round 4: such a rename was never marked, and with no card for either name neither). Otherwise it is his
 *    partner's change, as it was.
 * Then a hand no change left on the page accounts for comes off `hands` — his partner's once its renames are marked,
 * and his own where only the writer's words put back (Put back what was taken off: before 2.12.41 it added his hand) or
 * a change of his put back is left — only where none of it can have been let go (shape.js noneLetGo). Who put in each
 * word on a page it marks is worked out again (`whose`: what was kept was worked out with the rename his partner's). */
export const RENAMES_V = 1;
const CASED_WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const keyOfWord = nameWordKey;
/* the whole names swapped from some words to others, and nothing else changed — [{from, to}] as written, or null (a
 * name as names.js reads one, by the book's evidence when it is given: `book`, bookEvidence) */
export function renameSwaps(before, after, known = null, book = null) {
  const a = [...String(before || '').matchAll(CASED_WORD)].map((m) => m[0]);
  const b = [...String(after || '').matchAll(CASED_WORD)].map((m) => m[0]);
  const map = wordsMatched(a, b);
  const names = nameWordsIn(before, { known, book });
  const pairs = new Map();
  let lastA = -1;
  for (let j = 0; j < b.length; j++) {
    if (map[j] >= 0) { lastA = map[j]; continue; }
    let k = j;
    while (k < b.length && map[k] < 0) k++;
    const nextA = k < b.length ? map[k] : a.length;
    const from = a.slice(lastA + 1, nextA);
    if (!from.length || !from.every((w) => names.has(keyOfWord(w)))) return null;
    const f = from.join(' ');
    const t = b.slice(j, k).join(' ');
    if (pairs.has(f) && pairs.get(f) !== t) return null;
    pairs.set(f, t);
    j = k - 1;
  }
  if (!pairs.size) return null;
  /* (the swap made again gives the words after exactly — never a name taken out, nor any other word changed with it) */
  const list = [...pairs].map(([from, to]) => ({ from, to }));
  return renameIn(before, list) === String(after || '') ? list : null;
}
/* his partner's kept changes made on the pages themselves, by passage: "pid:vid" → [{before, after, rename}] — a name
 * changed everywhere (`rename`: its op.rename), or any other of his partner's (words changed across the chapters, or on
 * one page) */
function keptChanges(talk) {
  const out = new Map();
  const add = (pid, vid, before, after, rename) => {
    const k = `${pid}:${vid}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ before: String(before || ''), after: String(after || ''), rename });
  };
  const turns = [...((talk && talk.turns) || []), ...((talk && talk.convs) || []).flatMap((c) => (c && c.turns) || [])];
  for (const t of turns) {
    for (const v of (t && t.versions) || []) {
      for (const c of (v && v.changes) || []) {
        if (!c || c.status !== 'made' || !c.undo) continue;
        const rename = Boolean(c.op && c.op.rename);
        if (Array.isArray(c.undo.passages)) for (const row of c.undo.passages) if (row && row.inPlace) add(row.passageId, row.versionId, row.before, row.after, rename);
        if (c.undo.what === 'words' && c.undo.passageId) add(c.undo.passageId, c.undo.versionId, c.undo.before, c.undo.after, false);
      }
    }
  }
  return out;
}
/* the book as it is now, for an old change read by its words, each word asked when it is (names.js bookEvidence): where
 * a word stands — its pages as they read and its cards' names (`stands`; never his entries: 2.12.40's rename never
 * reached them, so his entry under the old name is the book as 2.12.40 left it — round 5, the review of round 4) — and
 * what the book writes of a word, for whether the name put in is a name (`book`) */
function bookNow(novel, chapters) {
  const named = [];
  for (const list of Object.values((novel && novel.notes) || {})) for (const card of Array.isArray(list) ? list : []) if (card) named.push(card.name, ...(card.aka || []));
  return {
    stands: bookEvidence(() => [...chapters.flatMap((c) => (c.passages || []).filter((p) => p.by !== 'break').map((p) => String((picked(p) || {}).text || ''))), ...named]),
    book: bookEvidence(() => bookTexts(novel, chapters)),
  };
}
/* by the words alone: names swapped and nothing else (renameSwaps), each name taken out standing nowhere in the book now
 * — on no page (two names traded both still stand on the page itself), no card (the card of who held the door still
 * stands) — and each it became a name by the book's evidence: a card's or an entry's, or written as a name and never as
 * a word ("Grey light" made from "Green light" beside "the grey lantern" is a colour) */
function renamedByWords(before, after, known, now) {
  const swaps = renameSwaps(before, after, known, now.book);
  if (!swaps) return false;
  const keys = (t) => [...String(t || '').matchAll(CASED_WORD)].map((m) => keyOfWord(m[0])).filter(Boolean);
  const tos = swaps.flatMap((s) => keys(s.to));
  if (!tos.length || tos.some((k) => !nameByEvidence(k, { known, book: now.book }))) return false;
  return !swaps.flatMap((s) => keys(s.from)).some((k) => now.stands.any(k));
}
/* a version's hands without his or his partner's where no change left on it accounts for it, and none of it can have
 * been let go (shape.js noneLetGo) */
function handsLeft(v) {
  const before = Array.isArray(v && v.before) ? v.before : [];
  const hands = handsOf(v);
  return hands.filter((h) => !['you', 'partner'].includes(h) || before.some((b) => b && b.by === h && !noHand(b)) || !noneLetGo(v, h));
}
const markStep = (pid, vid, marks) => (c) => {
  const p = (c.passages || []).find((x) => x.id === pid);
  const v = p && (p.versions || []).find((x) => x.id === vid);
  if (!v || !Array.isArray(v.before)) return false;
  let any = false;
  for (const { i, text } of marks) {
    const b = v.before[i];
    if (b && b.by === 'partner' && !Array.isArray(b.took) && !b.rename && String(b.text || '') === text) { b.rename = true; any = true; }
  }
  /* (who put in each word, kept or worked out with the rename his partner's, worked out again — 2.12.41, the review of
   * 2.12.41: a fix folded onto the page when the book opened kept it so for good) */
  if (any) { delete v.whose; for (const b of v.before) if (b) delete b.whose; }
  const left = handsLeft(v);
  if (left.length !== handsOf(v).length) v.hands = left;
  return true;
};
/* (the page given its turn — round 5, the review of round 4: markRenames held it in one block, keepWhose a whole chapter
 * at a time, up to half a second and more on a big book): work holds it at most SLICE_MS at a time, then lets it go;
 * every step laid after a pause finds its page as it stands then, by its words (markStep, whoseStep) */
const SLICE_MS = 25;
function slicer() {
  let at = performance.now();
  return {
    due: () => performance.now() - at >= SLICE_MS,
    pause: async () => { await new Promise((r) => setTimeout(r, 0)); at = performance.now(); },
  };
}
export async function markRenames(novelId) {
  const novel0 = store.peek('novel', novelId);
  if (!novel0 || ((novel0.memory || {}).renamesMarked || 0) >= RENAMES_V) return 0;
  const ids = novel0.order || [];
  if (ids.some((id) => !store.peek('chapter', id))) return 0;
  const talk = store.peek('talk', novelId) ?? (await store.open('talk', novelId).catch(() => undefined));
  /* (his partner's conversation not to be had just now: tried again the next time the book opens) */
  if (talk === undefined) return 0;
  const kept = keptChanges(talk);
  const slice = slicer();
  /* (the book as it stands, asked again after each pause) */
  let now = null;
  let marked = 0;
  for (const id of ids) {
    for (const pid of ((store.peek('chapter', id) || {}).passages || []).map((p) => p.id)) {
      if (slice.due()) { await slice.pause(); now = null; }
      const novel = store.peek('novel', novelId);
      const c = store.peek('chapter', id);
      if (!novel || !c) return marked;
      const p = (c.passages || []).find((x) => x.id === pid);
      if (!p || p.by === 'break') continue;
      const known = bookNameWords(novel);
      for (const v of p.versions || []) {
        if (!v || v.streaming) continue;
        const before = Array.isArray(v.before) ? v.before : [];
        const rows = kept.get(`${p.id}:${v.id}`) || [];
        const marks = [];
        before.forEach((b, i) => {
          if (!b || b.by !== 'partner' || Array.isArray(b.took) || b.rename) return;
          const after = String(i + 1 < before.length ? before[i + 1].text || '' : v.text || '');
          const text = String(b.text || '');
          /* (his partner's conversation's own record of this change decides; with none kept, the words) */
          const told = rows.filter((r) => r.before === text && r.after === after);
          if (told.length ? told.some((r) => r.rename) : renamedByWords(text, after, known, now || (now = bookNow(novel, ids.map((x) => store.peek('chapter', x)).filter(Boolean))))) marks.push({ i, text });
        });
        if (!marks.length && handsLeft(v).length === handsOf(v).length) continue;
        store.change('chapter', id, markStep(p.id, v.id, marks), { checkpoint: true });
        marked += marks.length;
      }
    }
  }
  if (store.peek('novel', novelId)) store.change('novel', novelId, novelSteps.setMemory({ renamesMarked: RENAMES_V }), { checkpoint: true });
  return marked;
}

/* WHO PUT IN EACH WORD, KEPT ONCE ON A VERSION KEPT BEFORE 2.12.41 (2.12.41, the review of 2.12.41: worked out from the
 * words before kept on it each time the book opened — a book of old pages took seconds of the page's time at the first
 * check of every session). When the book opens, once (`memory.whoseKept`), after its old names changed everywhere are
 * marked (markRenames): each version with changes kept on it and no `whose` that fits its words has it worked out
 * (shape.js whoseNow) and kept, SLICE_MS of work at a time, the page given its turn between them — only where its words
 * still read as they were worked out from. */
export const WHOSE_V = 1;
/* (how many it laid) */
const whoseStep = (rows) => (c) => {
  let laid = 0;
  for (const r of rows) {
    const p = (c.passages || []).find((x) => x.id === r.pid);
    const v = p && (p.versions || []).find((x) => x.id === r.vid);
    if (!v || v.streaming || whoseFits(v) || hashText(String(v.text || '')) !== r.whose.fp) continue;
    v.whose = r.whose;
    laid++;
  }
  return laid;
};
const whoseBusy = new Set();
export async function keepWhose(novelId) {
  const novel = store.peek('novel', novelId);
  if (!novel || whoseBusy.has(novelId) || ((novel.memory || {}).whoseKept || 0) >= WHOSE_V || ((novel.memory || {}).renamesMarked || 0) < RENAMES_V) return 0;
  const ids = novel.order || [];
  if (ids.some((id) => !store.peek('chapter', id))) return 0;
  whoseBusy.add(novelId);
  let kept = 0;
  const slice = slicer();
  try {
    for (const id of ids) {
      const first = store.peek('chapter', id);
      if (!first) return kept;
      const todo = [];
      for (const p of first.passages || []) if (p.by !== 'break') for (const v of p.versions || []) if (v) todo.push([p.id, v.id]);
      let rows = [];
      const lay = () => { if (rows.length) { kept += Number(store.change('chapter', id, whoseStep(rows), { checkpoint: true })) || 0; rows = []; } };
      for (const [pid, vid] of todo) {
        /* (what is worked out laid before the page is given its turn, each by the words it was worked out from) */
        if (slice.due()) { lay(); await slice.pause(); }
        const c = store.peek('chapter', id);
        if (!c) return kept;
        const p = (c.passages || []).find((x) => x.id === pid);
        const v = p && (p.versions || []).find((x) => x.id === vid);
        if (!v || v.streaming || whoseFits(v) || !((Array.isArray(v.before) && v.before.length) || v.how === 'edit' || v.how === 'selection')) continue;
        /* (a change at a time: the page has its turn between them too, the words worked out from as they were then —
         * laid only where they still read so, whoseStep) */
        const work = whoseNowWork(v, p);
        let step = work.next();
        while (!step.done) {
          if (slice.due()) { lay(); await slice.pause(); }
          step = work.next();
        }
        rows.push({ pid, vid, whose: step.value });
      }
      lay();
    }
    if (store.peek('novel', novelId)) store.change('novel', novelId, novelSteps.setMemory({ whoseKept: WHOSE_V }), { checkpoint: true });
  } finally { whoseBusy.delete(novelId); }
  return kept;
}
