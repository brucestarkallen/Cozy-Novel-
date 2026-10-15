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
import { howOf, chapterSteps, novelSteps, turnSteps, chapterText } from './shape.js';
import { joinSoftWraps, finishTail, mendMarks, dropGluedStrays, dropTop } from './textshape.js';
import { shapeTelling } from './talk.js';
import { resign } from './archivist.js';
import { locate } from './changes.js';
import { liftOfFaults } from './checker.js';
import { hashText, countWords } from '../util.js';

/* 2: a plan or a draft above the page, and its check of its own work after it, come off too; a lift echoed from an old example is said again */
export const MEND_V = 2;
const HIS = ['mine', 'edit', 'imported'];

/* one version's words made whole as a new page's are: {text, tookOff, tookOffTop} */
export function mendPage(v, { names = [] } = {}) {
  const given = String((v && v.text) || '');
  const cut = Boolean(v && v.cut);
  const head = dropTop(given, { names });
  let text = joinSoftWraps(head.text);
  let tail = '';
  /* the unfinished end of a page cut short is story still to be carried on — never a note */
  if (!cut) {
    const fin = finishTail(text);
    if (fin.removed) { text = fin.text.replace(/\s+$/, ''); tail = fin.removed; }
  }
  text = mendMarks(dropGluedStrays(text).text, { leaveLast: cut }).text;
  return { text, tookOff: tail, tookOffTop: head.removed || '' };
}

/* what was kept aside, beside what comes off now */
const joined = (a, b) => [a, b].filter((x) => String(x || '').trim()).join('\n\n') || undefined;

/* Mend every page of a book once (for this version of the repair):
 * {pages, tellings} mended — none when nothing needed it, or the book is not
 * all here yet (it is tried again the next time it opens). */
export async function mendBook(novelId) {
  const none = { pages: 0, tellings: 0 };
  const novel = store.peek('novel', novelId);
  if (!novel || ((novel.memory || {}).mended || 0) >= MEND_V) return none;
  const chapters = (novel.order || []).map((id) => store.peek('chapter', id));
  if (chapters.some((c) => !c)) return none;
  let n = 0;
  let told = 0;
  /* the pages first, at once — before the helper looks at the book */
  for (const c of chapters) {
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      for (const v of p.versions || []) {
        if (v.streaming || HIS.includes(howOf(v)) || !String(v.text || '').trim()) continue;
        const was = String(v.text || '');
        const m = mendPage(v, { names: [c.name].filter(Boolean) });
        if (m.text === was || !m.text.trim()) continue;
        store.change('chapter', c.id, chapterSteps.setVersion(p.id, v.id, {
          text: m.text, words: countWords(m.text),
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
        /* and what the helper read of them */
        resign(novelId, c.id, p.id, v.id, was, m.text);
        n++;
      }
    }
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
        const m = shapeTelling(was, { cut: Boolean(v.cut) });
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
  return { pages: n, tellings: told };
}
