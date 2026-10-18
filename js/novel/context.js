/* Cozy Novel — js/novel/context.js
 *
 * WHAT EACH ONE IS HANDED. The writer reads his instructions, the book as he
 * described it, the book itself — every chapter told once, at one level of
 * detail: whole while it fits in the model's room, and past that the oldest
 * chapters ride as their summaries instead (never both) — then the notes, then
 * the chapter being written, which always rides whole while it fits. His
 * request is the last thing the writer reads, as in a SillyTavern preset;
 * his note at the end, when he wrote one, rides after it (the book's note for
 * the writer, the scenes' note for the narrator).
 *
 * His instructions and the few lines after them are the system message. The
 * book and its notes ride there too — or, as he chooses (Settings → Your
 * instructions → The book and its notes ride as), in a message of their own
 * before his request: his notes (user) or the writer's own notebook
 * (assistant), as in Cozy Tavern.
 *
 * The order is also the order things change in: what stays the same page
 * after page comes first, so the providers that keep the start of a request
 * ready (DeepSeek, OpenAI, Claude) are not paid in full for the whole book on
 * every page.
 */

import { estimateTokens, countWords, numberWords } from '../util.js';
import { contextOf, thinksOn, thinkingFloor, learnedFacts } from '../model/providers.js';
import { chapterLabel, chapterText, chapterPrint, passageText, chapterNumber, passageNumbers, picked } from './shape.js';
import { ownWordsFor } from './ownwords.js';
import { aboutTheBook, notesText, earlierText, currentText, endingWords, writerFrame, partnerFrame, playFrame, withHis, notesAsOf, notesOpening, PICK_UP, PICK_UP_FIRST, DEFAULT_NARRATOR, avoidList, avoidLine, lateFor, lateRoleFor, notReadWords, asideWords, standingNotes, macroNames, withMacros, namedBook, bibPart, READ_OPEN, READ_CLOSE } from './prompts.js';
import { entriesOf, entryIndex, bibShare, bibItems, ridingItems } from './bibliography.js';
import { notesAtPoint, unread, asideRows } from './readings.js';
import { ridingFor } from './modules.js';
import { wakesOn } from './crafts.js';
import { stretchPlan, soFarText } from './stretches.js';

export const SAFETY = 1500;
/* the least an answer is given before a request is refused as too big, when he set no Longest reply (Cozy Tavern M752) */
export const ANSWER_FLOOR = 4096;

/* How much of the room the answer may need — for budgeting only; what is SENT
 * as the reply's length is his setting alone (providers.js). Never more than
 * half of what the model holds. */
export function answerRoom(conn, length = 'scene', purpose = 'write') {
  const set = Number.isFinite(conn && conn.maxTokens) && conn.maxTokens > 0 ? conn.maxTokens : 0;
  /* Automatic may run as long as a long stretch */
  const wanted = length === 'chapter' ? 12000 : length === 'long' || length === 'auto' ? 9000 : length === 'paragraphs' ? 2500 : 6000;
  let room = set || wanted;
  if (thinksOn(conn || {})) room = Math.max(room, thinkingFloor(conn || {}));
  /* the partner's answer: room for a changes block whatever Longest reply says (talk.js) */
  if (purpose === 'partner') room = Math.max(room, PARTNER_FLOOR);
  return Math.min(room, Math.floor(contextOf(conn || {}) * 0.5));
}

/* What one answer of the partner may run to: his Longest reply, raised to a
 * floor a changes block fits in — a block cut off is lost whole (Cozy
 * Tavern's M75-002, the floor his law allows) — never past half the model's
 * room; Claude's own when he set none. Unset elsewhere: nothing is sent. */
export const PARTNER_FLOOR = 8192;
export function partnerReply(conn, length = 'scene', anthropic = false) {
  const half = Math.floor(contextOf(conn || {}) * 0.5);
  const set = Number.isFinite(conn && conn.maxTokens) && conn.maxTokens > 0 ? conn.maxTokens : 0;
  if (anthropic) return Math.min(Math.max(requiredLength(conn, length), PARTNER_FLOOR), Math.max(half, requiredLength(conn, length)));
  if (!set) return undefined;
  return Math.max(set, Math.min(PARTNER_FLOOR, half));
}

/* For Claude, whose wire must say a length: what fits the length asked for,
 * when he set none. */
export function requiredLength(conn, length) {
  if (Number.isFinite(conn && conn.maxTokens) && conn.maxTokens > 0) return conn.maxTokens;
  return { paragraphs: 2048, scene: 4096, long: 8192, auto: 8192, chapter: 12000 }[length] || 4096;
}

function excerpt(text, n = 900) {
  const t = String(text || '').trim();
  if (t.length <= n * 2 + 40) return t;
  return `${t.slice(0, n).trim()}\n[…]\n${t.slice(-n).trim()}`;
}

/* A chapter told in short: its summary, while it fits the chapter's words.
 * A summary from before a change can hold an event since taken out, so it
 * never rides (2.10): a long chapter rides by its stretches instead — each
 * whose words are unchanged by its own summary, one that changed or was never
 * summed up by its opening and close — and any other by its current opening
 * and close, until the helper writes the summary again. */
function stretchedShort(chapter) {
  const plan = stretchPlan(chapter, { closeLast: true });
  if (plan.stretches.length < 2 || !plan.stretches.some((x) => x.text)) return '';
  const list = chapter.passages || [];
  const ix = new Map(list.map((p, k) => [p.id, k]));
  return plan.stretches.map((x) => x.text
    || `(not summed up as it reads now — its opening and close)\n${excerpt(chapterText({ passages: list.slice(ix.get(x.from), ix.get(x.to) + 1) }), 600)}`).join('\n\n');
}
export function shortOf(chapter) {
  const s = chapter && chapter.summary;
  const text = chapterText(chapter);
  if (!text.trim()) return '(nothing written in it yet)';
  const has = Boolean(s && String(s.text || '').trim());
  if (has && (!s.fp || s.fp === chapterPrint(chapter))) return s.text.trim();
  const stretched = stretchedShort(chapter);
  if (stretched) return stretched;
  if (has) return `(The summary is waiting for the chapter’s latest changes — its current opening and close follow instead.)\n${excerpt(text)}`;
  return `(not summarised yet — its opening and close)\n${excerpt(text)}`;
}

/* THE LEVEL BETWEEN (Summaryception's layers, Cozy Tavern's record: the finer
 * lines ride while the room holds them, and only the oldest are folded into
 * fewer): a long chapter that cannot ride whole is told by its stretches'
 * summaries — one for every ~2,500 words — before it falls to its one
 * summary, while the room holds them. Only when every stretch of it is summed
 * up as its words read now; the partner sees which passages each stands for.
 * '' when it has none. */
export function stretchesOf(novel, chapter, numbered = false) {
  const plan = stretchPlan(chapter, { closeLast: true });
  if (plan.stretches.length < 2 || plan.open.length || plan.stretches.some((x) => !x.text)) return '';
  const nums = passageNumbers(chapter);
  const n = chapterNumber(novel, chapter.id);
  const label = (x) => {
    if (!numbered) return '';
    const ns = x.ids.map((id) => nums.get(id)).filter(Boolean);
    return ns.length ? `[${n}.${ns[0]}–${n}.${ns[ns.length - 1]}, in short]\n` : '';
  };
  return plan.stretches.map((x) => label(x) + x.text).join('\n\n');
}

/* THE NEWEST CHAPTER IN SHORT, PARTLY WHOLE (Cozy Tavern's window: the
 * newest pages ride word for word wherever a chapter ends): when the chapter
 * just before the ones told whole cannot ride whole but the room left holds
 * more than its stretches' summaries, its earliest stretches ride by their
 * summaries and the rest of it word for word — the most of it whole that
 * fits, cut at a stretch's edge, so the start of the request stays the same
 * page after page until a whole stretch has to go. Only when every stretch
 * is summed up as its words read now. null when it does not fit or has no
 * stretches. */
export function partlyWhole(novel, chapter, keep, numbered = false) {
  const plan = stretchPlan(chapter, { closeLast: true });
  if (plan.stretches.length < 2 || plan.open.length || plan.stretches.some((x) => !x.text)) return null;
  const list = chapter.passages || [];
  const ix = new Map(list.map((p, k) => [p.id, k]));
  const nums = passageNumbers(chapter);
  const n = chapterNumber(novel, chapter.id);
  const label = (x) => {
    if (!numbered) return '';
    const ns = x.ids.map((id) => nums.get(id)).filter(Boolean);
    return ns.length ? `[${n}.${ns[0]}–${n}.${ns[ns.length - 1]}, in short]\n` : '';
  };
  const join = numbered ? (arr) => numberedText(novel, chapter, arr) : (arr) => arr.map(passageText).filter((x) => x.trim()).join('\n\n');
  /* at least one stretch in short, at least one word for word: the fewest in short that fit */
  for (let c = 1; c < plan.stretches.length; c++) {
    const rows = plan.stretches.slice(0, c).map((x) => label(x) + x.text).join('\n\n');
    const whole = join(list.slice(ix.get(plan.stretches[c].from)));
    const text = `${rows}\n\nThe rest of it, word for word:\n\n${whole}`;
    const cost = estimateTokens(text) + 12;
    if (cost <= keep) return { text, cost, inShort: c, from: plan.stretches[c].from };
  }
  return null;
}

/* A chapter with every passage numbered as the page numbers it ("2.3" is
 * passage 3 of Chapter Two; a scene break has no number) — for the partner,
 * who changes a passage by its number. */
export function numberedText(novel, chapter, list = null) {
  return numberedRows(novel, chapter, list).map((x) => x.text).join('\n\n');
}
/* each passage as the partner sees it: [{p, text, words, brk}] — one with no words yet is said so, never left out
 * without a word (a number the page shows it would not find) */
function numberedRows(novel, chapter, list = null) {
  const n = chapterNumber(novel, chapter.id);
  const nums = passageNumbers(chapter);
  return (list || chapter.passages || []).map((p) => {
    const t = passageText(p);
    if (p.by === 'break') return t.trim() ? { p, text: t, words: 0, brk: true } : null;
    const v = picked(p) || {};
    if (!t.trim()) return { p, text: `[${n}.${nums.get(p.id)}] (${v.streaming ? 'being written just now' : 'no words yet'})`, words: 0 };
    return { p, text: `[${n}.${nums.get(p.id)}] ${t}`, words: countWords(t), label: `[${n}.${nums.get(p.id)}]` };
  }).filter(Boolean);
}

/* THE CHAPTER OPEN, CUT ONLY AT ITS PASSAGES' EDGES, FOR THE PARTNER (his
 * report, 2.12.2: it said "[1.2], which you did not send this time", and
 * that it would wait for him to "paste [1.2] back"). Through 2.12.1 it was
 * cut by letters: the chapter's first lines, then its end — a passage's
 * number in the middle lost, the end of [1.2] read as more of [1.1], and
 * nothing said of what was gone. Now whole passages go: the first stays if
 * it is short, then as many of the newest as fit; every passage left out is
 * named where it stood, with its length and how to read it. The one
 * passage too long by itself keeps its number, its start and its end, its
 * middle said. Within `keep` tokens. */
export function partnerCut(novel, chapter, list, keep) {
  const rows = numberedRows(novel, chapter, list);
  const cost = rows.map((x) => estimateTokens(x.text) + 2);
  const all = cost.reduce((a, b) => a + b, 0);
  if (all <= keep) return rows.map((x) => x.text).join('\n\n');
  const n = chapterNumber(novel, chapter.id);
  const how = `${READ_OPEN}[${n}]${READ_CLOSE} sends this chapter whole, and ${READ_OPEN}["find: …"]${READ_CLOSE} every place some words stand`;
  const gapLine = (gone) => {
    const named = gone.filter((x) => !x.brk);
    if (!named.length) return '';
    const words = named.reduce((a, x) => a + x.words, 0).toLocaleString('en-US');
    const which = named.length === 1 ? `${named[0].label || named[0].text.split(' ')[0]} — left out here to save room (${words} words)` : `${named[0].label}–${named[named.length - 1].label} — ${numberWords(named.length).toLowerCase()} passages left out here to save room (${words} words)`;
    return `${which}: ${how}.`;
  };
  const GAP = 70;
  /* the first, when it is short beside the room; then the newest, back from the end, while they fit */
  const keepFirst = rows.length > 1 && cost[0] <= keep * 0.25;
  let spent = (keepFirst ? cost[0] : 0) + GAP;
  let from = rows.length;
  while (from - 1 > (keepFirst ? 0 : -1) && spent + cost[from - 1] <= keep) { spent += cost[from - 1]; from--; }
  if (from < rows.length) {
    const head = keepFirst ? [rows[0].text] : [];
    const gone = rows.slice(keepFirst ? 1 : 0, from);
    return [...head, gapLine(gone), ...rows.slice(from).map((x) => x.text)].filter(Boolean).join('\n\n');
  }
  /* not even the newest passage fits whole: the others named, and its start and its end */
  const last = rows[rows.length - 1];
  const before = gapLine(rows.slice(0, -1));
  const room = Math.max(200, keep - estimateTokens(before) - GAP);
  const body = last.text;
  const chars = Math.floor(room * 3.2);
  const headPart = body.slice(0, Math.floor(chars * 0.4)).replace(/\s+\S*$/, '');
  const tailPart = body.slice(-Math.floor(chars * 0.6)).replace(/^\S*\s+/, '');
  const middle = `[… the middle of ${last.label || 'this passage'} is left out here to save room: ${how} …]`;
  return [before, `${headPart}\n\n${middle}\n\n${tailPart}`].filter(Boolean).join('\n\n');
}

/* where in the current chapter the request sits — said by whoever speaks:
 * his notes, or the writer's own notebook ("I") */
const NOTE = { write: "the chapter you're writing now", partner: 'the chapter open right now', play: 'the scene picks up where this leaves off' };
const NOTE_MINE = { write: "the chapter I'm writing now", mark: "the chapter I'm working in" };
function currentPart(novel, chapter, target, purpose = 'write', notesAs = 'system') {
  const label = chapterLabel(novel, chapter);
  const mine = notesAs === 'assistant';
  const note = (mine && NOTE_MINE[purpose]) || NOTE[purpose] || NOTE.write;
  const list = chapter.passages || [];
  const join = purpose === 'partner' ? (arr) => numberedText(novel, chapter, arr) : (arr) => arr.map(passageText).filter((t) => t.trim()).join('\n\n');
  if (target.mark) {
    const i = list.findIndex((p) => p.id === target.mark);
    return { label, note: mine ? NOTE_MINE.mark : "the chapter you're working in", before: join(list.slice(0, Math.max(0, i))), marker: '[ … the passage you’re writing again goes here … ]', after: join(list.slice(i + 1)) };
  }
  if (target.before) {
    const i = list.findIndex((p) => p.id === target.before);
    if (i >= 0) {
      return { label, note, text: join(list.slice(0, i)), afterText: join(list.slice(i + 1)) };
    }
  }
  if (target.through) {
    if (target.through === '^') return { label, note, text: '', afterText: join(list) };
    const i = list.findIndex((p) => p.id === target.through);
    if (i >= 0) return { label, note, text: join(list.slice(0, i + 1)), afterText: join(list.slice(i + 1)) };
  }
  return { label, note, text: join(list) };
}

/* The chapter being written, cut to fit `keep` tokens: what leads up to the
 * point being written keeps its end (the words right before it) and the
 * chapter's opening lines; what follows the point keeps its start. */
export function trimCurrent(current, keep, { cutPre = null } = {}) {
  const preKey = current.marker ? 'before' : 'text';
  const postKey = current.marker ? 'after' : 'afterText';
  const pre = String(current[preKey] || '');
  const post = String(current[postKey] || '');
  const preT = estimateTokens(pre);
  const postT = estimateTokens(post);
  if (preT + postT <= keep) return current;
  const budget = Math.max(1000, keep);
  const postShare = Math.min(postT, Math.floor(budget * 0.3));
  const preShare = budget - postShare;
  const out = { ...current };
  const preChars = Math.floor(preShare * 3.2);
  /* the words before the point already fitted by the chapter so far (fitCurrent) are left as they are */
  if (pre.length > preChars && !current.fitted) {
    if (cutPre) out[preKey] = cutPre(preShare);
    else {
      const head = pre.slice(0, 1200).replace(/\s+\S*$/, '');
      const tail = pre.slice(-Math.max(1000, preChars - head.length - 120)).replace(/^\S*\s+/, '');
      /* (its opening and the words leading up to here: the middle is what is left out — through 2.12.1 it said "the start") */
      out[preKey] = `(The middle of this chapter is left out here to save room — its opening, then the words leading up to here:)\n${head}\n[…]\n${tail}`;
    }
  }
  const postChars = Math.floor(postShare * 3.2);
  if (post.length > postChars) {
    out[postKey] = postChars > 200 ? `${post.slice(0, postChars).replace(/\s+\S*$/, '')}\n[…] (the rest of the chapter is left out here to save room)` : '(The rest of the chapter is left out here to save room.)';
  }
  return out;
}

/* The chapter open, fitted to `keep` tokens: what leads up to the point —
 * its earliest stretches by their summaries (stretches.js), from where it
 * fits on word for word; what follows the point keeps its start
 * (trimCurrent). The partner sees each summed-up stretch's passage numbers. */
function fitCurrent(novel, chapter, current, target, keep, purpose) {
  const list = chapter.passages || [];
  const at = (id) => list.findIndex((p) => p.id === id);
  let upto = list.length;
  if (target.mark) upto = Math.max(0, at(target.mark));
  else if (target.before && at(target.before) >= 0) upto = at(target.before);
  else if (target.through) upto = target.through === '^' ? 0 : at(target.through) >= 0 ? at(target.through) + 1 : list.length;
  const preKey = current.marker ? 'before' : 'text';
  const postKey = current.marker ? 'after' : 'afterText';
  const postShare = Math.min(estimateTokens(String(current[postKey] || '')), Math.floor(keep * 0.3));
  const numbered = purpose === 'partner';
  const join = numbered ? (arr) => numberedText(novel, chapter, arr) : (arr) => arr.map(passageText).filter((t) => t.trim()).join('\n\n');
  const nums = passageNumbers(chapter);
  const n = chapterNumber(novel, chapter.id);
  const label = numbered ? (a, b) => {
    const ns = list.slice(a, b + 1).map((p) => nums.get(p.id)).filter(Boolean);
    return ns.length ? `[${n}.${ns[0]}–${n}.${ns[ns.length - 1]}, in short]` : '';
  } : () => '';
  /* the partner: cut only at a passage's edges, each one left out named (partnerCut) */
  const cut = numbered ? (arr, room) => partnerCut(novel, chapter, arr, room) : null;
  const soFar = soFarText(chapter, { upto, keep: Math.max(600, keep - postShare), estimate: estimateTokens, join, label, cut });
  return trimCurrent(soFar ? { ...current, [preKey]: soFar, fitted: true } : current, keep, { cutPre: cut ? (room) => cut(list.slice(0, upto), room) : null });
}

/* what the chapters before the open one cost told in short, and what comes after it (capped as fitBook caps it) */
function shortBookCost(novel, chapters, chapterId) {
  const order = novel.order || [];
  const at = order.indexOf(chapterId);
  const cost = (id) => estimateTokens(chapters[id] ? shortOf(chapters[id]) : '') + 12;
  const earlier = (at > 0 ? order.slice(0, at) : []).reduce((a, id) => a + cost(id), 0);
  const later = (at >= 0 ? order.slice(at + 1) : []).reduce((a, id) => a + cost(id), 0);
  return { earlier, later };
}

const currentCost = (c) => (c ? estimateTokens([c.text, c.before, c.after, c.afterText, c.plan, c.ending].filter(Boolean).join('\n')) : 0);

/* Fit the book into what is left of the room. numbered: every passage of a
 * chapter told whole carries its number (the partner's view). */
export function fitBook({ novel, chapters, chapterId, current, room, numbered = false, plans = false }) {
  const order = novel.order || [];
  const at = order.indexOf(chapterId);
  const earlier = at > 0 ? order.slice(0, at) : at < 0 ? order.slice() : [];
  const later = at >= 0 ? order.slice(at + 1) : [];
  const ch = (id) => chapters[id] || { id, passages: [] };
  const labelOf = (id) => chapterLabel(novel, ch(id));
  /* a chapter not in hand is never told as empty: said to be unread just now */
  const UNREAD = '(this chapter could not be read just now)';
  const wholeOf = (id) => (!chapters[id] ? UNREAD : numbered ? numberedText(novel, ch(id)) : chapterText(ch(id)));
  const wholeCost = earlier.map((id) => estimateTokens(wholeOf(id)) + 12);
  const shortText = (id) => (!chapters[id] ? UNREAD : shortOf(ch(id)));
  const shortCost = earlier.map((id) => estimateTokens(shortText(id)) + 12);
  /* the partner plans with him: a later chapter's plan rides beside it (the writer never reads ahead in the map) */
  const planOf = (id) => (plans && chapters[id] && String(chapters[id].plan || '').trim() ? `\nPlanned: ${String(chapters[id].plan).trim()}` : '');
  const laterRows = later.map((id) => ({ label: labelOf(id), text: shortText(id) + planOf(id) }));
  let laterCost = laterRows.reduce((a, r) => a + estimateTokens(r.text) + 12, 0);
  let laterOmitted = 0;
  while (laterRows.length && laterCost > room * 0.25) { const r = laterRows.pop(); laterCost -= estimateTokens(r.text) + 12; laterOmitted++; }
  const left = room - laterCost;
  /* the newest earlier chapters whole, the older ones in short: the smallest k that fits */
  let k = earlier.length;
  const sumWhole = (from) => wholeCost.slice(from).reduce((a, b) => a + b, 0);
  const sumShort = (to) => shortCost.slice(0, to).reduce((a, b) => a + b, 0);
  for (let from = 0; from <= earlier.length; from++) {
    if (sumWhole(from) + sumShort(from) <= left) { k = from; break; }
    if (from === earlier.length) k = earlier.length;
  }
  let omitted = 0;
  let cost = sumWhole(k) + sumShort(k);
  /* even in short it does not all fit: the oldest go, and it says so */
  while (cost > left && omitted < k) { cost -= shortCost[omitted]; omitted++; }
  /* the room left over lifts the chapters told in short, the newest first, to
   * their stretches (stretchesOf) — never at the cost of a chapter told whole */
  const finer = new Map();
  for (let i = k - 1; i >= omitted && cost < left; i--) {
    const id = earlier[i];
    if (!chapters[id]) continue;
    const text = stretchesOf(novel, ch(id), numbered);
    if (!text || text === shortText(id)) continue;
    const extra = estimateTokens(text) + 12 - shortCost[i];
    if (extra <= 0 || cost + extra > left) continue;
    finer.set(id, text);
    cost += extra;
  }
  /* what room is still left goes to the newest chapter told in short: as much of it word for word as fits (partlyWhole) —
   * the passage its words start from said with it (wholeFrom), so a reader of the fit knows its end is there word for word */
  const wholeFrom = new Map();
  if (k - 1 >= omitted && cost < left && chapters[earlier[k - 1]]) {
    const id = earlier[k - 1];
    const now = finer.has(id) ? estimateTokens(finer.get(id)) + 12 : shortCost[k - 1];
    const part = partlyWhole(novel, ch(id), left - cost + now, numbered);
    if (part && part.cost > now) { finer.set(id, part.text); wholeFrom.set(id, part.from); cost += part.cost - now; }
  }
  const book = {
    omitted,
    summaries: earlier.slice(omitted, k).map((id) => ({ id, label: labelOf(id), text: finer.get(id) || shortText(id), ...(wholeFrom.has(id) ? { wholeFrom: wholeFrom.get(id) } : {}) })),
    whole: earlier.slice(k).map((id) => ({ id, label: labelOf(id), text: wholeOf(id) || '(nothing written in it yet)' })),
    current,
    later: laterRows,
    laterOmitted,
  };
  return { book, used: cost + laterCost, whole: earlier.length - k, short: k - omitted };
}

/* Where the notes hold what comes after the point being written and it
 * could not all be taken back: said, in words true in every voice — the
 * checker is told the same (prompts.js NOTES_FOR_A_READER) */
function notesRunOn(novel, chapters) {
  const order = novel.order || [];
  let last = '';
  for (const id of order) if (chapters[id] && chapterText(chapters[id]).trim()) last = id;
  const label = last ? chapterLabel(novel, chapters[last], { withName: false }) : 'the book';
  return `These notes run to the end of the book so far (${label}), past the point we’re writing at here. Where they tell of anything after it — where someone is, what they know, what has happened since — go by the chapters up to this point: nothing after it has happened yet.`;
}

/* The passages the notes have not read yet, up to the point being written
 * (for the partner and a scene: anywhere in the book) — the words that say
 * so, or ''. The passage being written again is not counted. */
export function notesBehind(novel, chapters, chapter, target = {}, purpose = 'write', alsoBack = []) {
  let point = {};
  if ((purpose === 'write' || purpose === 'play') && chapter && chapter.id) {
    const list = chapter.passages || [];
    if (target.mark || target.before) point = { chapterId: chapter.id, before: target.mark || target.before, skip: target.mark || target.before };
    else if (target.through === '^') point = { chapterId: chapter.id, before: '^' };
    else if (target.through) {
      const i = list.findIndex((p) => p.id === target.through);
      /* Go on is writing the anchor itself; a played scene follows it and
       * still needs to know when its facts have not reached the notes. */
      const skip = purpose === 'write' ? target.through : null;
      point = { chapterId: chapter.id, before: i >= 0 && list[i + 1] ? list[i + 1].id : null, skip };
      if (!point.before) {
        const next = (novel.order || []).slice((novel.order || []).indexOf(chapter.id) + 1).find((id) => chapters[id]);
        point = next ? { chapterId: next, before: '^', skip } : { skip };
      }
    }
  }
  const rows = unread(novel, chapters, point);
  /* passages read together with the one written again, their notes taken back with it */
  if (alsoBack.length && chapter && chapter.id) {
    const nums = passageNumbers(chapter);
    const list = chapter.passages || [];
    const at = point.before ? list.findIndex((p) => p.id === point.before) : list.length;
    for (const pid of alsoBack) {
      const i = list.findIndex((p) => p.id === pid);
      if (i >= 0 && i < at && nums.get(pid) && !rows.some((r) => r.pid === pid)) rows.push({ chapterId: chapter.id, pid, n: nums.get(pid) });
    }
    const order = novel.order || [];
    rows.sort((a, b) => order.indexOf(a.chapterId) - order.indexOf(b.chapterId) || a.n - b.n);
  }
  const grouped = (list) => {
    const groups = [];
    for (const r of list) {
      const label = chapterLabel(novel, chapters[r.chapterId], { withName: false });
      const g = groups[groups.length - 1];
      if (g && g.id === r.chapterId) g.ns.push(r.n); else groups.push({ id: r.chapterId, label, ns: [r.n] });
    }
    return groups;
  };
  /* and the passages set aside — their model would not read them — said too, never silently missing (S04-G8) */
  const aside = asideRows(novel, chapters, point);
  return [notReadWords(grouped(rows)), asideWords(grouped(aside))].filter(Boolean).join('\n');
}

/* The narrator's own words, from "How the narrator tells scenes": its
 * starting words until he sets his own; emptied, nothing of his is sent —
 * like the partner's box. (Before 2.3 an emptied box sent "How you like it
 * written"; those words now tell the writer it writes everyone, the main
 * character too — the one thing the narrator of a scene he plays must never
 * do.) */
export function narratorWords(instr) {
  return typeof instr.narrator === 'string' ? instr.narrator : DEFAULT_NARRATOR;
}

/* How far back before the point a name still counts as named here: the
 * words right before it, as a reader holds them (SillyTavern's scan depth,
 * for a book). */
export const BIB_NEAR_WORDS = 2500;
const lastWords = (text, n) => { const w = String(text || '').split(/\s+/); return w.length <= n ? String(text || '') : w.slice(-n).join(' '); };
const firstWords = (text, n) => { const w = String(text || '').split(/\s+/); return w.length <= n ? String(text || '') : w.slice(0, n).join(' '); };
/* Whether the helper fills the bibliography from the book by itself (Bibliography → Fill it from the book by itself) */
export const bibAutoOn = (novel) => !(novel && novel.prefs && novel.prefs.bibAuto === 'off');

/* The passages after the point being written: what the book establishes there
 * has not happened yet for the writer or the narrator (never for the partner,
 * who talks over the whole book). */
export function passagesAfter(novel, chapters, chapterId, target = {}, purpose = 'write') {
  const out = new Set();
  if (purpose === 'partner' || !chapterId) return out;
  const order = novel.order || [];
  const at = order.indexOf(chapterId);
  if (at < 0) return out;
  for (const id of order.slice(at + 1)) for (const p of (chapters[id] || {}).passages || []) out.add(p.id);
  const list = (chapters[chapterId] || {}).passages || [];
  let from = list.length;
  if (target.mark || target.before) { const i = list.findIndex((p) => p.id === (target.mark || target.before)); if (i >= 0) from = i; }
  else if (target.through === '^') from = 0;
  else if (target.through) { const i = list.findIndex((p) => p.id === target.through); if (i >= 0) from = i + 1; }
  for (const p of list.slice(from)) out.add(p.id);
  return out;
}

/* The bibliography as it rides for one of them (bibliography.js): {text,
 * ids, left}. His entries named here — or set to ride always — and what the
 * book has established about the names named here, only from passages not
 * riding word for word and never from after the point (`skip`); `skipAll`:
 * none of the book's facts (the first fitting, before it is known which
 * chapters ride whole). The partner also sees every entry of his by its name
 * and line. */
export function bibliographyFor({ items, opened, purpose, request = '', moment = '', plan = '', turns = [], names = {}, free = 0, skip = null, skipAll = false, factsMost = Infinity }) {
  if (!items || !items.length) return { text: '', ids: [], left: 0 };
  const filled = items.map((it) => ({ ...it, ...(skipAll ? { facts: [] } : {}), ...(it.entry ? { entry: { ...it.entry, line: withMacros(it.entry.line || '', names), text: withMacros(it.entry.text || '', names) } } : {}) }));
  const his = [request, moment, plan].filter(Boolean).join('\n');
  const before = opened ? String(opened.before !== undefined ? opened.before : opened.text || '') : '';
  const after = opened ? String(opened.after !== undefined ? opened.after : opened.afterText || '') : '';
  const talk = (turns || []).slice(-8).map((t) => String(t.content || '')).join('\n\n');
  /* nearest last: the talk of a scene or with the partner comes after the chapter's words */
  const near = [lastWords(before, BIB_NEAR_WORDS), firstWords(after, 300), lastWords(talk, BIB_NEAR_WORDS)].filter((x) => x.trim()).join('\n\n');
  const share = bibShare(free);
  if (purpose === 'partner') {
    const mine = filled.filter((it) => it.entry).map((it) => it.entry);
    const index = mine.length ? entryIndex(mine, Math.floor(share / 3)) : { text: '', left: 0 };
    const ride = ridingItems(filled, { his, near, budget: share - (mine.length ? Math.floor(share / 3) : 0), skip, purpose, factsMost });
    const text = ride.words.length || index.text ? bibPart(ride.words, { index: index.text, indexLeft: index.left }) : '';
    return { text, ids: ride.items.map((it) => it.ref), left: ride.left };
  }
  const ride = ridingItems(filled, { his, near, budget: share, skip, purpose, factsMost });
  return { text: ride.words.length ? bibPart(ride.words) : '', ids: ride.items.map((it) => it.ref), left: ride.left };
}

/* Build what one of them reads. purpose: 'write' | 'partner' | 'play'.
 * target: {chapterId, before?, through?, mark?}. request: his request (the
 * last user message). turns: earlier messages (partner, play). moment: HIS
 * words for this request, and only his — what he asks for, the words of his
 * that set going what he is carrying on, his last moves in a scene or a talk
 * (writer.js, talk.js) — what wakes a rule that rides only when the scene
 * turns intimate or a fight starts (crafts.js wakesOn). Never the page, nor
 * the narrator's or the partner's words: the patterns are made for what he
 * types, and prose is full of looks shot and heads cocked.
 * Returns {system, systemParts: [what stays the same page after page, what
 * moves], messages, stats, refuse}. His modules that always ride sit right
 * after his own words, in the part that stays the same; the ones his words
 * woke ride nearer the page, in the part that moves — always in the system
 * message. With the book riding in a message of its own, that message
 * carries cacheSplit: where the part that stays the same ends (Claude keeps
 * the request ready up to there); a rule waking or going back to sleep
 * changes the system message before it, so that one request is not kept
 * ready — the next one is. */
export function assemble({ house, novel, chapters, conn, purpose = 'write', target = {}, request = '', turns = [], length = 'scene', play = null, moment = '', tools = true, notesKept = true }) {
  const instr = (house && house.instructions) || {};
  const notesAs = notesAsOf(house);
  const chapter = chapters[target.chapterId] || chapters[(novel.order || [])[novel.order.length - 1]] || { id: '', passages: [] };
  const opened = chapter.id ? currentPart(novel, chapter, target, purpose, notesAs) : null;
  /* the story map: this chapter's plan, and in the book's last chapter how it ends with what is still open (prompts.js) */
  const planHere = String(chapter.plan || '').trim();
  const lastHere = Boolean(chapter.id) && (novel.prefs || {}).endsAt === chapter.id && (purpose === 'write' || purpose === 'play');
  const label = chapter.id ? chapterLabel(novel, chapter) : 'the first chapter';
  let own = '';
  let frame = '';
  if (purpose === 'write') { own = instr.system; frame = writerFrame(house, novel, { notesAs }); }
  else if (purpose === 'partner') { own = instr.partner; frame = partnerFrame(house, novel, { notesAs, tools, notesKept }); }
  else if (purpose === 'play') { own = narratorWords(instr); frame = playFrame(house, novel, play || {}, label, { notesAs }); }
  /* while the whole book is read again, the notes as they stood before it */
  const shown = standingNotes(novel);
  const rebuilt = shown !== novel;
  /* the notes as they stood at the point being written (readings.js): a
   * passage written again — another take, a rewrite, his selected words — is
   * never handed the notes its old version made, and a point earlier in the
   * book — a page written in between, an earlier chapter carried on, a scene
   * set there — is never handed what comes after it as "so far" (Cozy
   * Tavern's M336/M337); what cannot be taken back is said to run to the end */
  const pointed = (purpose === 'write' || purpose === 'play') && chapter.id && !rebuilt;
  const atPoint = pointed ? notesAtPoint(novel, chapters, chapter.id, { mark: target.mark, before: target.before, through: target.through }) : null;
  const notesNow = atPoint && atPoint.later ? { ...shown, notes: atPoint.notes, kept: atPoint.kept } : shown;
  const runsOn = atPoint && atPoint.later && !atPoint.clean ? notesRunOn(novel, chapters) : '';
  /* the book's own words with {{user}} and {{char}} filled, never sent raw */
  const named = namedBook(notesNow, house);
  /* (the last chapter's open threads: the notes as of the point, names filled — never the live notes of a take being replaced, 2.12.18) */
  const current = opened ? { ...opened, ...(planHere ? { plan: withMacros(planHere, macroNames(house, purpose, play)) } : {}),
    ...(lastHere ? { ending: endingWords(withMacros(String(novel.ending || ''), macroNames(house, purpose, play)), ((named.notes || {}).threads || []).filter((t) => t.open !== false)) } : {}) } : null;
  /* how he means it to end: the partner's to plan with, always; the writer's only in the last chapter (above) */
  const endingNote = purpose === 'partner' && String(named.ending || '').trim() ? `How I mean the book to end (between us — the writer is told it only in the book's last chapter):\n${String(named.ending).trim()}` : '';
  const about = [aboutTheBook(named, { plans: true }), endingNote].filter(Boolean).join('\n\n');
  /* the modules (modules.js): the ones that always ride, and the ones his words woke */
  const ride = ridingFor(house, novel, purpose, wakesOn(moment));
  /* his words and the modules with the names in them — never {{user}} or {{char}} (Tavern M361) */
  const names = macroNames(house, purpose, play);
  const woken = withMacros(ride.woken.join('\n\n'), names);
  /* his own words first, then the words he never wants (when he listed any),
   * then the modules that always ride, then the frame */
  const head = withHis(withMacros([String(own || ''), avoidLine(avoidList(house)), ...ride.always].filter((text) => String(text || '').trim()).join('\n\n'), names), frame);
  const opening = notesAs === 'system' ? '' : notesOpening(house, novel, notesAs, purpose);
  /* his note at the end: the writer's, or the scenes' own (prompts.js lateFor), as he chose it to ride — the
   * storyteller's own voice marked, for the model layer to send it as the setup's words where it cannot go so */
  const late = withMacros(lateFor(instr, purpose), names);
  const lateRole = lateRoleFor(instr, purpose);
  /* his words in the storyteller's own voice (ownwords.js), each at its place — for the writer and the narrator */
  const voiced = ownWordsFor(house, purpose, (t) => withMacros(t, names));
  const ownMsg = (w) => ({ role: w.role, content: w.text, ...(w.role === 'assistant' ? { voice: true } : {}) });
  const after = [];
  for (const t of turns) after.push({ role: t.role, content: t.content });
  if (request) after.push({ role: 'user', content: request });
  /* right before what he asks: his request, or his last move — with nothing of his to stand before, at the end */
  const beforeYours = voiced.filter((w) => w.place === 'before-your-message').map(ownMsg);
  if (beforeYours.length) {
    let at = -1;
    for (let i = after.length - 1; i >= 0; i--) if (after[i].role === 'user') { at = i; break; }
    if (at === -1) after.push(...beforeYours); else after.splice(at, 0, ...beforeYours);
  }
  after.push(...voiced.filter((w) => w.place === 'after-your-message').map(ownMsg));
  if (late) after.push({ role: lateRole, content: late, ...(lateRole === 'assistant' ? { voice: true } : {}) });
  /* after the book and its notes, before the story */
  const beforePages = voiced.filter((w) => w.place === 'before-pages').map(ownMsg);

  const total = contextOf(conn);
  const reserve = answerRoom(conn, length, purpose);
  const afterCost = [...beforePages, ...after].reduce((a, m) => a + estimateTokens(m.content) + 8, 0);
  /* what has to go whatever the book — his words, the modules, the frame,
   * the talk and his request — with the room for the answer: the least this
   * model must hold before any of the book (a "too long" never fits the book
   * smaller than this, call.js). Past what it holds, nothing is sent and the
   * reason says which of them takes the room. */
  const instructions = estimateTokens(head) + estimateTokens(woken);
  /* where the answer's room comes from: his Longest reply, or the room a
   * thinking model needs to think and write (when that is more) */
  const setReply = Number.isFinite(conn && conn.maxTokens) && conn.maxTokens > 0 ? conn.maxTokens : 0;
  const floor = thinksOn(conn || {}) ? thinkingFloor(conn || {}) : 0;
  /* refused only below an answer's floor when he set no Longest reply and no
   * thinking needs more (Cozy Tavern M752 ANSWER_FLOOR): the larger room is
   * for fitting the book, never a reason to send nothing while thousands of
   * tokens stay free for the answer */
  const needed = setReply || (floor && floor >= reserve) ? reserve : Math.min(reserve, ANSWER_FLOOR);
  const least = instructions + afterCost + 200 + needed;
  /* THE NOTES NEVER CROWD OUT THE CHAPTER (Cozy Tavern M664, for the writer,
   * the partner and the narrator too): past a third of what is left beside
   * his words, the talk and the answer, the cards the chapter and his request
   * do not name ride by their first line — his own cards always whole. And
   * which passages up to that point they have not read yet, said at their top. */
  const notesShare = Math.max(1500, Math.floor((total - reserve - instructions - afterCost) / 3));
  /* whole: every card the chapter, his request or his own last words name (Cozy Tavern's M74: a card he asks about is never shown by its first line) */
  const shortIds = new Set();
  const kept = notesText(named, { fit: notesShare, focus: [chapter.id ? chapterText(chapter) : '', request, moment].filter(Boolean).join('\n'), shortIds });
  const notes = kept || (atPoint && atPoint.also.length) ? [rebuilt ? '' : notesBehind(novel, chapters, chapter, target, purpose, atPoint ? atPoint.also : []), kept ? runsOn : '', kept].filter(Boolean).join('\n\n') : '';
  const notesPart = notes ? `Who and what's in the story so far:\n\n${notes}` : '';
  /* THE BIBLIOGRAPHY (bibliography.js): his entries for who and what is named
   * here — his own words and the words right before the point — fitted to a
   * share of the room; the partner sees every entry by its name and line too */
  /* the book's facts ride whenever the helper has gathered them — Fill it from the book by itself only says whether it goes on gathering them (a portrait made short leaves its lasting details to them) */
  const bibItemsNow = bibItems(named, chapters, { facts: true });
  const bibArgs = { items: bibItemsNow, opened, purpose, request, moment, plan: planHere, turns, names, free: total - reserve - instructions - afterCost };
  const afterPoint = passagesAfter(novel, chapters, chapter.id, target, purpose);
  /* first fitted with his entries alone; the book's facts come once it is known which chapters ride word for word */
  let bib = bibliographyFor({ ...bibArgs, skipAll: true });
  /* a room this app only guessed after a "too long" is never a reason to
   * refuse: the book fits it, and the page goes */
  const facts = learnedFacts(conn);
  const guessed = Boolean(facts && facts.contextGuess && facts.context === total);
  const overOf = (extra = {}) => ({
    room: total, purpose, instructions: instructions + 200, talk: afterCost, answer: needed, modules: ride.names.length > 0,
    reply: floor && floor >= reserve && floor > setReply ? 'thinking' : setReply ? 'his' : '', ...extra,
  });
  const over = least > total && !guessed ? overOf() : null;
  let fixed = instructions + estimateTokens(about) + estimateTokens(opening) + estimateTokens(bib.text) + estimateTokens(notesPart) + currentCost(current) + afterCost + 200;
  let room = total - reserve - SAFETY - fixed;
  let cur = current;
  if (room < 0 && current) {
    /* the chapter alone is longer than the room left: it is told in part —
     * its earliest stretches by their summaries, the newest words whole —
     * and the chapters before it keep their summaries beside it (up to a
     * third of the room): they used to be dropped whole, "left out here to
     * save room", the moment the open chapter outgrew the model */
    const bookRoom = room + currentCost(current);
    const need = shortBookCost(novel, chapters, chapter.id);
    const besides = Math.min(need.earlier + Math.min(need.later, Math.floor(bookRoom * 0.25)), Math.floor(bookRoom * 0.35));
    cur = fitCurrent(novel, chapter, current, target, Math.max(1000, bookRoom - besides - 500), purpose);
    room = Math.max(0, bookRoom - currentCost(cur));
  }
  let fit = fitBook({ novel, chapters, chapterId: chapter.id, current: cur, room: Math.max(0, room), numbered: purpose === 'partner', plans: purpose === 'partner' });
  /* the book's facts about the names named here — only from passages not riding word for word (the chapter open rides as
   * itself), never from after the point; the room they take comes off the earlier chapters, which are fitted again */
  if (bibItemsNow.some((it) => it.facts.length)) {
    /* the chapter open rides as itself — but when it is told in part (its earliest stretches by their summaries, or
     * its start left out), only the passages whose words are there whole */
    const openWhole = [];
    if (chapter.id) {
      const told = cur === current ? null : [cur.text, cur.before, cur.after, cur.afterText].filter(Boolean).join('\n');
      for (const p of chapter.passages || []) { const t = passageText(p).trim(); if (!told || !t || told.includes(t)) openWhole.push(p.id); }
    }
    /* the passages that ride word for word with this fitting (and those after the point, which have not happened yet) */
    const wholeIn = (f) => {
      const whole = new Set([...afterPoint, ...openWhole]);
      for (const w of f.book.whole) for (const p of (chapters[w.id] || {}).passages || []) whole.add(p.id);
      for (const x of f.book.summaries) {
        if (!x.wholeFrom) continue;
        const list = (chapters[x.id] || {}).passages || [];
        const i = list.findIndex((p) => p.id === x.wholeFrom);
        if (i >= 0) for (const p of list.slice(i)) whole.add(p.id);
      }
      return whole;
    };
    /* the room they take comes off the chapters before, which are fitted again — until what rides of the facts is what that fitting leaves in short */
    const base = estimateTokens(bib.text);
    /* the facts take at most half of what the book before has left; his entries ride as they did without them */
    const factsMost = Math.floor(Math.max(0, room) / 2);
    let held = 0;
    let settled = null;
    for (let round = 0; round < 4 && !settled; round++) {
      const withFacts = bibliographyFor({ ...bibArgs, skip: wholeIn(fit), factsMost });
      const extra = Math.max(0, estimateTokens(withFacts.text) - base);
      if (extra <= held) { settled = withFacts; break; }
      held = extra;
      fit = fitBook({ novel, chapters, chapterId: chapter.id, current: cur, room: Math.max(0, room - held), numbered: purpose === 'partner', plans: purpose === 'partner' });
    }
    if (!settled) {
      /* still moving: the whole share held back, and what that fitting leaves in short */
      held = factsMost + estimateTokens(bibPart(['']));
      fit = fitBook({ novel, chapters, chapterId: chapter.id, current: cur, room: Math.max(0, room - held), numbered: purpose === 'partner', plans: purpose === 'partner' });
      const last = bibliographyFor({ ...bibArgs, skip: wholeIn(fit), factsMost });
      if (estimateTokens(last.text) - base <= held) settled = last;
    }
    if (settled) { fixed += Math.max(0, estimateTokens(settled.text) - base); bib = settled; }
    else fit = fitBook({ novel, chapters, chapterId: chapter.id, current: cur, room: Math.max(0, room), numbered: purpose === 'partner', plans: purpose === 'partner' });
  }
  const joinParts = (arr) => arr.filter((x) => String(x || '').trim()).join('\n\n\n');
  const stableBook = joinParts([about, earlierText(fit.book)]);
  const moving = joinParts([bib.text, notesPart, currentText(fit.book)]);
  let system;
  let systemParts;
  const messages = [];
  if (notesAs === 'system') {
    const stable = joinParts([head, stableBook]);
    /* what this moment woke, before the notes (Cozy Tavern's order: the rules, then the notes, then the story) */
    const tail = joinParts([woken, moving]);
    system = joinParts([stable, tail]);
    systemParts = [stable, tail];
  } else {
    /* his instructions, the modules and the frame stay the system message —
     * what this moment woke as its last part, so the part before it stays
     * the same; the book and its notes are a message of their own, before
     * his request */
    system = joinParts([head, woken]);
    systemParts = woken.trim() ? [head, woken] : [head];
    const lead = joinParts([opening, stableBook]);
    const body = joinParts([lead, moving]);
    if (body.trim()) messages.push({ role: notesAs, content: body, cacheSplit: moving.trim() ? lead.length : body.length });
  }
  /* a request that would open on the storyteller's words of the app's making — the book as its notebook, or his own
   * words in its voice before the story — opens on one line of his (a house that wants his turn first takes it, the
   * rest read it as he says it); a book with no words yet has nothing to pick up: it begins */
  const ours = messages.length ? messages[0].role === 'assistant' : Boolean(beforePages.length) && beforePages[0].role === 'assistant';
  if (ours) {
    const written = Object.values(chapters || {}).some((c) => c && chapterText(c).trim());
    messages.unshift({ role: 'user', content: written ? PICK_UP : PICK_UP_FIRST });
  }
  messages.push(...beforePages, ...after);
  const tokens = estimateTokens(system) + messages.reduce((a, m) => a + estimateTokens(m.content), 0);
  /* the book is fitted to the room the answer would like; the request is
   * refused only when, with the least of the book that goes — What it's
   * about, the notes, the chapter open in part — not even the answer's floor
   * is left (Cozy Tavern M752) */
  const tooBig = over || (!guessed && total - tokens < needed ? overOf({ book: Math.max(0, tokens - (instructions + 200) - afterCost), about: estimateTokens(about) }) : null);
  /* how the chapter open was told, each side of the point (writer.js says it under the page) */
  const sideOf = (key) => String(((cur || {})[key]) || '');
  const preK = current && current.marker ? 'before' : 'text', postK = current && current.marker ? 'after' : 'afterText';
  const pre = sideOf(preK);
  /* the passages of the chapter open whose words did not go whole (said under the partner's answer: never a silent cut) */
  const toldNow = cur === current ? null : [cur && cur.text, cur && cur.before, cur && cur.after, cur && cur.afterText].filter(Boolean).join('\n');
  const openLeft = !toldNow || !chapter.id ? [] : (chapter.passages || []).filter((p) => p.by !== 'break' && passageText(p).trim() && !toldNow.includes(passageText(p).trim())).map((p) => `${chapterNumber(novel, chapter.id)}.${passageNumbers(chapter).get(p.id)}`);
  const chapterFit = !current || cur === current ? { before: 'whole', after: 'whole' } : {
    before: pre === String(current[preK] || '') ? 'whole' : !cur.fitted || !pre.includes('The chapter so far, in short:') ? 'cut' : /left out here to save room/.test(pre) ? 'stretches-cut' : 'stretches',
    after: sideOf(postK) === String(current[postK] || '') ? 'whole' : 'cut',
  };
  return {
    system,
    systemParts,
    messages,
    stats: { tokens, room: total, whole: fit.whole + (chapter.id ? 1 : 0), short: fit.short, omitted: fit.book.omitted, modules: ride.names, over: tooBig, least,
      /* the chapters it was given whole — the one open (unless told in part) and the earlier ones that fit (talk.js: never a passage written anew in one it only had in short) */
      wholeIds: [...fit.book.whole.map((w) => w.id), ...(chapter.id && cur === current ? [chapter.id] : [])],
      /* the passages of a chapter told partly whole (partlyWhole) that it had word for word: those may be written anew */
      wholePassages: [...fit.book.summaries.filter((x) => x.wholeFrom).flatMap((x) => {
        const list = (chapters[x.id] || {}).passages || [];
        const i = list.findIndex((p) => p.id === x.wholeFrom);
        return i < 0 ? [] : list.slice(i).map((p) => p.id);
      }),
      /* the chapter open told in part: the passages whose words went whole (the partner's cut keeps whole passages) */
      ...(toldNow && chapter.id ? (chapter.passages || []).filter((p) => p.by !== 'break' && passageText(p).trim() && toldNow.includes(passageText(p).trim())).map((p) => p.id) : [])],
      /* the cards shown by their first line (talk.js: never written whole from it) */
      shortCards: [...shortIds],
      /* the bibliography's entries it read whole, and how many named ones the room left out */
      entries: bib.ids, entriesLeft: bib.left,
      /* what goes whatever the book's earlier chapters, the answer's room, the chapter open (talk.js) */
      fixed, reserve, current: currentCost(current), chapterFit, openLeft,
      /* chapters in the book's list that could not be read (the writer is told so in their place; writer.js tells him under the page) */
      unreadChapters: (novel.order || []).filter((id) => !chapters[id]).length },
    /* a model whose room cannot hold what has to go with the least of the
     * book is never sent this: the reason, in plain words (call.js) */
    refuse: tooBig ? tooSmallWords(tooBig) : '',
  };
}

/* Which model is short of room, and which of what it must hold takes the
 * room — his instructions with the modules, the talk or his request, the
 * room for the answer (his Longest reply, or its thinking) — and the ways
 * out that fit: the one that is his own setting first. The narrator of a
 * scene is the writer's connection (Who does what → The writer). */
const WHO = { write: 'the writer', play: 'the narrator', partner: 'your partner' };
const ROW = { write: 'The writer', play: 'The writer', partner: 'The partner' };
export function tooSmallWords(over) {
  const n = (x) => Math.round(x).toLocaleString();
  const who = WHO[over.purpose] || 'the writer';
  const room = over.room;
  /* the talk is named only when it is a real part of it; a short request rides in with his instructions */
  const talkBig = over.talk > Math.max(1500, room * 0.15);
  const mine = over.instructions + (talkBig ? 0 : over.talk);
  const parts = [`your instructions${over.modules ? ' with the modules' : ''} for ${who} (about ${n(mine)})`];
  if (talkBig) parts.push(over.purpose === 'partner' ? `the talk so far (about ${n(over.talk)})` : over.purpose === 'play' ? `the scene so far (about ${n(over.talk)})` : `what it is given to work from (about ${n(over.talk)})`);
  /* the least of the book that has to go, when that is what tips it */
  if (over.book) parts.push(`what of the book has to go with them at the least (about ${n(over.book)})`);
  parts.push(`the room for its answer (about ${n(over.answer)}${over.reply === 'his' ? ', your Longest reply' : over.reply === 'thinking' ? ', with its thinking' : ''})`);
  const list = parts.length === 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const ways = [];
  /* his Longest reply is what tips it: that first */
  const replyTips = over.reply === 'his' && mine + over.talk * (talkBig ? 1 : 0) + 2000 <= room;
  if (replyTips) ways.push('lower Longest reply on its connection (Settings → Connections)');
  ways.push(`give ${over.purpose === 'play' ? 'the writer, who tells your scenes,' : who} a model with more room (Settings → Who does what → ${ROW[over.purpose] || 'The writer'})`);
  if (over.modules) ways.push(`switch off a module ${who} reads (Settings → Your instructions → Modules)`);
  /* his own long What it's about is most of that least */
  if (over.book && over.about > over.book * 0.5) ways.push('make What it’s about shorter (⋯ → About this book)');
  if (talkBig && over.purpose === 'partner') ways.push('send a shorter message, or Start over');
  if (talkBig && over.purpose === 'play') ways.push('make your move shorter');
  const said = ways.length === 1 ? ways[0] : `${ways.slice(0, -1).join(', ')}, or ${ways[ways.length - 1]}`;
  return `this model holds about ${n(room)} tokens, but ${list} need about ${n(mine + (talkBig ? over.talk : 0) + (over.book || 0) + over.answer)}${over.book ? '' : ' before any of the book'} — ${said}`;
}
