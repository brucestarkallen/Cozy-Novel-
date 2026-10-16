/* Cozy Novel — js/novel/stretches.js — THE CHAPTER SO FAR (pure)
 *
 * A chapter longer than a model can read beside everything else used to be
 * told by its opening lines and its newest words, the middle "left out here
 * to save room" — a long chapter one lost its own story. Now each chapter is
 * kept in stretches of about STRETCH_WORDS words, passage boundaries only,
 * and the helper sums each finished stretch up (Summaryception's layers,
 * Cozy Tavern's record): what does not fit word for word rides as the
 * stretches' summaries, the newest words whole.
 *
 * A stretch's bounds are kept with its summary (chapter.stretches = [{from,
 * to, fp, text, at}]): a passage appended later starts the next stretch,
 * and a stretch whose words change keeps its bounds and is summed up again
 * (its fingerprint no longer matches). Bounds that no longer stand — a
 * passage taken out at an edge, one written in between two stretches — are
 * laid again from there on. Nothing here asks a model or touches the store.
 */
import { passageText, picked } from './shape.js';
import { hashText, countWords } from '../util.js';
import { sceneWords } from './prompts.js';

export const STRETCH_WORDS = 2500;

const wordsOf = (p) => (p.by === 'break' ? 0 : countWords(passageText(p)));
const streamingOf = (p) => Boolean((picked(p) || {}).streaming);
/* the stretch's own fingerprint: its passages, in order, as they read now */
export function stretchPrint(list) {
  return hashText(list.map((p) => `${p.id}\u0001${passageText(p)}`).join('\u0002'));
}

/* The chapter's stretches as they stand: [{from, to, ids, fp, words, text}]
 * (text: its summary while it still fits its words, else ''), and `open`:
 * the passages after the last finished stretch. closeLast: the chapter is no
 * longer the one being written, so its last words make a stretch too. */
export function stretchPlan(chapter, { size = STRETCH_WORDS, closeLast = false } = {}) {
  const list = ((chapter && chapter.passages) || []);
  const stored = Array.isArray(chapter && chapter.stretches) ? chapter.stretches : [];
  const out = [];
  let i = 0;
  /* the kept bounds, while each starts where the one before it ended */
  for (const s of stored) {
    if (!s || i >= list.length || list[i].id !== s.from) break;
    const to = list.findIndex((p, k) => k >= i && p.id === s.to);
    if (to < i) break;
    const part = list.slice(i, to + 1);
    if (part.some(streamingOf)) break;
    const fp = stretchPrint(part);
    const kept = s.fp === fp && String(s.text || '').trim();
    /* its check (the summary check, archivist.js) goes with its summary while the summary stands */
    out.push({ from: s.from, to: s.to, ids: part.map((p) => p.id), fp, words: part.reduce((a, p) => a + wordsOf(p), 0), text: kept ? String(s.text).trim() : '', at: s.at || 0, ...(kept && s.checked ? { checked: s.checked } : {}) });
    i = to + 1;
  }
  /* the rest laid anew: a stretch closes once it holds `size` words */
  let start = i, acc = 0;
  for (let k = i; k < list.length; k++) {
    if (streamingOf(list[k])) break;
    acc += wordsOf(list[k]);
    if (acc >= size) {
      const part = list.slice(start, k + 1);
      out.push({ from: part[0].id, to: list[k].id, ids: part.map((p) => p.id), fp: stretchPrint(part), words: acc, text: '', at: 0 });
      start = k + 1;
      acc = 0;
    }
  }
  let open = list.slice(start);
  if (closeLast && open.length && !open.some(streamingOf) && open.some((p) => wordsOf(p) > 0)) {
    out.push({ from: open[0].id, to: open[open.length - 1].id, ids: open.map((p) => p.id), fp: stretchPrint(open), words: acc, text: '', at: 0 });
    open = [];
  }
  return { stretches: out, open: open.map((p) => p.id) };
}

/* what the chapter keeps: every stretch's bounds, with its summary where it
 * has one — a summary that no longer fits its words is let go */
export function keptStretches(plan) {
  return plan.stretches.map((s) => ({ from: s.from, to: s.to, ...(s.text ? { fp: s.fp, text: s.text, at: s.at || Date.now(), ...(s.checked ? { checked: s.checked } : {}) } : {}) }));
}

/* the summary the helper wrote for one stretch, laid into the bounds as they
 * stand now — only while the stretch still reads as it did when asked */
export function withStretch(chapter, stretch, text, at = Date.now(), opts = {}, checked = null) {
  const plan = stretchPlan(chapter, opts);
  const now = plan.stretches.find((s) => s.from === stretch.from && s.to === stretch.to);
  if (!now || now.fp !== stretch.fp) return null;
  now.text = String(text || '').trim();
  now.at = at;
  /* new words are unchecked words; a check's own result comes with its mark */
  if (checked) now.checked = checked; else delete now.checked;
  return keptStretches(plan);
}

/* A SCENE KEPT IN STRETCHES, as a long chapter is: its turns read as the
 * scene's own transcript (talk.js transcriptOf — "Mara: …", "Narrator: …";
 * never his lines to the narrator, nor the ways it offered), each turn a
 * passage of a chapter-shaped record, so stretchPlan, keptStretches and
 * withStretch keep a scene's stretches as they keep a chapter's. A turn
 * whose words change changes its stretch's fingerprint, so a summary never
 * stands for words that are not there. */
export function sceneChapter(play) {
  const who = String((play && play.who) || 'their character');
  const passages = ((play && play.turns) || []).map((t) => {
    const v = picked(t) || {};
    const raw = String(v.text || '');
    const words = (t.by === 'you' ? raw : sceneWords(raw)).trim();
    const text = words ? `${t.by === 'you' ? who : 'Narrator'}: ${words}` : '';
    return { id: t.id, by: t.by === 'you' ? 'you' : 'ai', versions: [{ id: 'v', text, ...(v.streaming ? { streaming: true } : {}) }] };
  });
  return { passages, stretches: (play && play.stretches) || [] };
}
export function scenePlan(play, opts = {}) { return stretchPlan(sceneChapter(play), opts); }

/* a stretch read short where it has no summary yet: its opening and close */
function excerpt(text, n = 700) {
  const t = String(text || '').trim();
  if (t.length <= n * 2 + 40) return t;
  return `${t.slice(0, n).replace(/\s+\S*$/, '')}\n[…]\n${t.slice(-n).replace(/^\S*\s+/, '')}`;
}
/* …or its opening alone, when its close follows word for word */
function opening(text, n = 700) {
  const t = String(text || '').trim();
  return t.length <= n + 40 ? t : `${t.slice(0, n).replace(/\s+\S*$/, '')}\n[…]`;
}

/* The words before the point being written, fitted to `keep` tokens with the
 * chapter's stretches: the earliest stretches by their summaries, from where
 * it fits on word for word. `upto`: how many passages lead up to the point.
 * Returns the text, or '' when everything fits word for word anyway. When even
 * that does not fit, the summed-up stretches stay and the words after them
 * keep their end (the words right before the point matter most). A stretch
 * not summed up yet rides by its opening and close; the one right before the
 * words kept whole by its opening, its last passages joining those words. */
export function soFarText(chapter, { upto, keep, estimate, join, size = STRETCH_WORDS, label = (a, b) => '' }) {
  const list = (chapter && chapter.passages) || [];
  const n = Math.max(0, Math.min(list.length, upto));
  const plan = stretchPlan(chapter, { size });
  const ix = new Map(list.map((p, k) => [p.id, k]));
  /* the stretches wholly before the point */
  const before = plan.stretches.filter((s) => ix.get(s.to) < n);
  if (!before.length) return '';
  const short = before.map((s) => {
    const a = ix.get(s.from), b = ix.get(s.to);
    const head = label(a, b);
    const body = s.text || `(not summed up yet — its opening and close)\n${excerpt(join(list.slice(a, b + 1)))}`;
    return { start: a, summed: Boolean(s.text), text: head ? `${head}\n${body}` : body };
  });
  const cost = short.map((x) => estimate(x.text) + 6);
  const afterAll = ix.get(before[before.length - 1].to) + 1;
  const startOf = (c) => (c < short.length ? short[c].start : afterAll);
  const compose = (rows, whole) => {
    const parts = [];
    if (rows.length) parts.push(`The chapter so far, in short:\n\n${rows.join('\n\n')}`);
    if (String(whole || '').trim()) parts.push(`${rows.length ? 'From here on, word for word:\n\n' : ''}${whole}`);
    return parts.join('\n\n');
  };
  /* what room is left takes the last passages of the stretch just before the cut, word for word too */
  const topUp = (c, spent) => {
    let from = startOf(c);
    const floor = short[c - 1].start;
    while (from - 1 > floor) {
      const add = estimate(join(list.slice(from - 1, from))) + 4;
      if (spent + add > keep) break;
      spent += add;
      from--;
    }
    return from;
  };
  /* the earliest cut that fits: stretches before it in short, the rest whole */
  for (let c = 0; c <= short.length; c++) {
    const whole = join(list.slice(startOf(c), n));
    const total = cost.slice(0, c).reduce((x, y) => x + y, 0) + estimate(whole);
    if (total > keep) continue;
    if (c === 0) return '';
    /* stretches cut to their edges and not one summary among them: the plain opening and end (below) read better */
    if (!short.slice(0, c).some((x) => x.summed)) continue;
    const rows = short.slice(0, c).map((x) => x.text);
    const last = short[c - 1];
    if (!last.summed) {
      /* the stretch right before the words kept whole, not summed up yet: its opening here, and as much of its end as fits word for word */
      const a = last.start, b = startOf(c) - 1;
      const row = (to) => {
        const head = label(a, to);
        const body = `(not summed up yet — its opening, then its end word for word)\n${opening(join(list.slice(a, to + 1)))}`;
        return head ? `${head}\n${body}` : body;
      };
      const from = topUp(c, total - cost[c - 1] + estimate(row(b)) + 6);
      if (from < startOf(c)) {
        /* its opening from the passages not told whole below, so nothing is told twice */
        rows[c - 1] = row(from - 1);
        return compose(rows, join(list.slice(from, n)));
      }
      return compose(rows, whole);
    }
    const from = topUp(c, total);
    return compose(rows, from < startOf(c) ? join(list.slice(from, n)) : whole);
  }
  /* nothing fits: the summed-up stretches from the start, then the words after them, keeping their end */
  let k = 0;
  while (k < short.length && short[k].summed) k++;
  let rows = short.slice(0, k).map((x) => x.text);
  let spent = cost.slice(0, k).reduce((x, y) => x + y, 0);
  const wholeRoom = Math.max(600, Math.floor(keep * 0.55));
  let dropped = 0;
  while (rows.length && keep - spent < wholeRoom) { spent -= cost[dropped]; rows = rows.slice(1); dropped++; }
  if (dropped) rows.unshift(`(The earliest ${dropped === 1 ? 'stretch' : `${dropped} stretches`} of this chapter left out here to save room.)`);
  const rest = join(list.slice(startOf(k), n));
  const room = Math.max(600, keep - spent);
  if (estimate(rest) <= room) return compose(rows, rest);
  const chars = Math.floor(room * 3.2);
  if (!k) {
    /* nothing summed up yet: its opening, and the words right before the point */
    const head = rest.slice(0, 1200).replace(/\s+\S*$/, '');
    const tail = rest.slice(-Math.max(1000, chars - head.length - 120)).replace(/^\S*\s+/, '');
    return `(The start of this chapter is left out here to save room. It opens:)\n${head}\n[…]\n${tail}`;
  }
  return compose(rows, `(Some of what follows is left out here to save room — its end:)\n[…]\n${rest.slice(-chars).replace(/^\S*\s+/, '')}`);
}
