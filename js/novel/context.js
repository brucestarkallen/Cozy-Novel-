/* Cozy Novel — js/novel/context.js
 *
 * WHAT EACH ONE IS HANDED. The writer reads his instructions, the book as he
 * described it, the book itself — every chapter told once, at one level of
 * detail: whole while it fits in the model's room, and past that the oldest
 * chapters ride as their summaries instead (never both) — then the notes, then
 * the chapter being written, which always rides whole while it fits. His
 * request is the last thing the writer reads, as in a SillyTavern preset;
 * his note at the end, when he wrote one, rides after it.
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

import { estimateTokens } from '../util.js';
import { contextOf, thinksOn, thinkingFloor } from '../model/providers.js';
import { chapterLabel, chapterText, chapterPrint, passageText, chapterNumber, passageNumbers } from './shape.js';
import { aboutTheBook, notesText, earlierText, currentText, writerFrame, partnerFrame, playFrame, withHis, notesAsOf, notesOpening, PICK_UP, DEFAULT_NARRATOR } from './prompts.js';

export const SAFETY = 1500;

/* How much of the room the answer may need — for budgeting only; what is SENT
 * as the reply's length is his setting alone (providers.js). Never more than
 * half of what the model holds. */
export function answerRoom(conn, length = 'scene') {
  const set = Number.isFinite(conn && conn.maxTokens) && conn.maxTokens > 0 ? conn.maxTokens : 0;
  const wanted = length === 'chapter' ? 12000 : length === 'long' ? 9000 : length === 'paragraphs' ? 2500 : 6000;
  let room = set || wanted;
  if (thinksOn(conn || {})) room = Math.max(room, thinkingFloor(conn || {}));
  return Math.min(room, Math.floor(contextOf(conn || {}) * 0.5));
}

/* For Claude, whose wire must say a length: what fits the length asked for,
 * when he set none. */
export function requiredLength(conn, length) {
  if (Number.isFinite(conn && conn.maxTokens) && conn.maxTokens > 0) return conn.maxTokens;
  return { paragraphs: 2048, scene: 4096, long: 8192, chapter: 12000 }[length] || 4096;
}

function excerpt(text, n = 900) {
  const t = String(text || '').trim();
  if (t.length <= n * 2 + 40) return t;
  return `${t.slice(0, n).trim()}\n[…]\n${t.slice(-n).trim()}`;
}

/* The chapter's summary — said to be older than the chapter when the chapter
 * has changed since — or, with none yet, the chapter's opening and close. */
function shortOf(chapter) {
  const s = chapter && chapter.summary;
  const text = chapterText(chapter);
  if (!text.trim()) return '(nothing written in it yet)';
  if (s && s.text) return s.fp && s.fp !== chapterPrint(chapter) ? `(This summary was written before the chapter's latest changes.)\n${s.text.trim()}` : s.text.trim();
  return `(not summarised yet — its opening and close)\n${excerpt(text)}`;
}

/* A chapter with every passage numbered as the page numbers it ("2.3" is
 * passage 3 of Chapter Two; a scene break has no number) — for the partner,
 * who changes a passage by its number. */
export function numberedText(novel, chapter, list = null) {
  const n = chapterNumber(novel, chapter.id);
  const nums = passageNumbers(chapter);
  return (list || chapter.passages || []).map((p) => {
    const t = passageText(p);
    if (!t.trim()) return '';
    return p.by === 'break' ? t : `[${n}.${nums.get(p.id)}] ${t}`;
  }).filter(Boolean).join('\n\n');
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
    return { label, note: mine ? NOTE_MINE.mark : "the chapter you're working in", before: join(list.slice(0, Math.max(0, i))), marker: '[ … the passage being rewritten sits here … ]', after: join(list.slice(i + 1)) };
  }
  if (target.before) {
    const i = list.findIndex((p) => p.id === target.before);
    if (i >= 0) {
      return { label, note, text: join(list.slice(0, i)), afterText: join(list.slice(i + 1)) };
    }
  }
  if (target.through) {
    const i = list.findIndex((p) => p.id === target.through);
    if (i >= 0) return { label, note, text: join(list.slice(0, i + 1)), afterText: join(list.slice(i + 1)) };
  }
  return { label, note, text: join(list) };
}

/* The chapter being written, cut to fit `keep` tokens: what leads up to the
 * point being written keeps its end (the words right before it) and the
 * chapter's opening lines; what follows the point keeps its start. */
export function trimCurrent(current, keep) {
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
  if (pre.length > preChars) {
    const head = pre.slice(0, 1200).replace(/\s+\S*$/, '');
    const tail = pre.slice(-Math.max(1000, preChars - head.length - 120)).replace(/^\S*\s+/, '');
    out[preKey] = `(The start of this chapter is left out here to save room. It opens:)\n${head}\n[…]\n${tail}`;
  }
  const postChars = Math.floor(postShare * 3.2);
  if (post.length > postChars) {
    out[postKey] = postChars > 200 ? `${post.slice(0, postChars).replace(/\s+\S*$/, '')}\n[…] (the rest of the chapter is left out here to save room)` : '(The rest of the chapter is left out here to save room.)';
  }
  return out;
}

const currentCost = (c) => (c ? estimateTokens([c.text, c.before, c.after, c.afterText].filter(Boolean).join('\n')) : 0);

/* Fit the book into what is left of the room. numbered: every passage of a
 * chapter told whole carries its number (the partner's view). */
export function fitBook({ novel, chapters, chapterId, current, room, numbered = false }) {
  const order = novel.order || [];
  const at = order.indexOf(chapterId);
  const earlier = at > 0 ? order.slice(0, at) : at < 0 ? order.slice() : [];
  const later = at >= 0 ? order.slice(at + 1) : [];
  const ch = (id) => chapters[id] || { id, passages: [] };
  const labelOf = (id) => chapterLabel(novel, ch(id));
  const wholeOf = (id) => (numbered ? numberedText(novel, ch(id)) : chapterText(ch(id)));
  const wholeCost = earlier.map((id) => estimateTokens(wholeOf(id)) + 12);
  const shortCost = earlier.map((id) => estimateTokens(shortOf(ch(id))) + 12);
  const laterRows = later.map((id) => ({ label: labelOf(id), text: shortOf(ch(id)) }));
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
  const book = {
    omitted,
    summaries: earlier.slice(omitted, k).map((id) => ({ label: labelOf(id), text: shortOf(ch(id)) })),
    whole: earlier.slice(k).map((id) => ({ label: labelOf(id), text: wholeOf(id) || '(nothing written in it yet)' })),
    current,
    later: laterRows,
    laterOmitted,
  };
  return { book, used: cost + laterCost, whole: earlier.length - k, short: k - omitted };
}

/* The narrator's own words, from "How the narrator tells scenes": its
 * starting words until he sets his own; emptied, the narrator reads "How you
 * like it written" instead. */
export function narratorWords(instr) {
  if (typeof instr.narrator !== 'string') return DEFAULT_NARRATOR;
  return instr.narrator.trim() ? instr.narrator : String(instr.system || '');
}

/* Build what one of them reads. purpose: 'write' | 'partner' | 'play'.
 * target: {chapterId, before?, through?, mark?}. request: his request (the
 * last user message). turns: earlier messages (partner, play).
 * Returns {system, systemParts: [what stays the same page after page, what
 * moves], messages, stats}. With the book riding in a message of its own,
 * that message carries cacheSplit: where the part that stays the same ends
 * (Claude keeps the request ready up to there). */
export function assemble({ house, novel, chapters, conn, purpose = 'write', target = {}, request = '', turns = [], length = 'scene', play = null }) {
  const instr = (house && house.instructions) || {};
  const notesAs = notesAsOf(house);
  const chapter = chapters[target.chapterId] || chapters[(novel.order || [])[novel.order.length - 1]] || { id: '', passages: [] };
  const current = chapter.id ? currentPart(novel, chapter, target, purpose, notesAs) : null;
  const label = chapter.id ? chapterLabel(novel, chapter) : 'the first chapter';
  let own = '';
  let frame = '';
  if (purpose === 'write') { own = instr.system; frame = writerFrame(house, novel, { notesAs }); }
  else if (purpose === 'partner') { own = instr.partner; frame = partnerFrame(house, novel, { notesAs }); }
  else if (purpose === 'play') { own = narratorWords(instr); frame = playFrame(house, novel, play || {}, label, { notesAs }); }
  const about = aboutTheBook(novel, { plans: true });
  const notes = notesText(novel);
  const head = withHis(own, frame);
  const opening = notesAs === 'system' ? '' : notesOpening(house, novel, notesAs, purpose);
  const notesPart = notes ? `Who and what's in the story so far:\n\n${notes}` : '';
  const late = purpose === 'partner' ? '' : String(instr.late || '').trim();
  const after = [];
  for (const t of turns) after.push({ role: t.role, content: t.content });
  if (request) after.push({ role: 'user', content: request });
  if (late) after.push({ role: 'system', content: late });

  const total = contextOf(conn);
  const reserve = answerRoom(conn, length);
  const fixed = estimateTokens(head) + estimateTokens(about) + estimateTokens(opening) + estimateTokens(notesPart) + currentCost(current)
    + after.reduce((a, m) => a + estimateTokens(m.content) + 8, 0) + 200;
  let room = total - reserve - SAFETY - fixed;
  let cur = current;
  if (room < 0 && current) {
    /* the chapter alone is longer than the room left: it is told in part —
     * every part of it, before and after the point being written */
    cur = trimCurrent(current, currentCost(current) + room - 500);
    room = 0;
  }
  const fit = fitBook({ novel, chapters, chapterId: chapter.id, current: cur, room: Math.max(0, room), numbered: purpose === 'partner' });
  const joinParts = (arr) => arr.filter((x) => String(x || '').trim()).join('\n\n\n');
  const stableBook = joinParts([about, earlierText(fit.book)]);
  const moving = joinParts([notesPart, currentText(fit.book)]);
  let system;
  let systemParts;
  const messages = [];
  if (notesAs === 'system') {
    const stable = joinParts([head, stableBook]);
    system = joinParts([stable, moving]);
    systemParts = [stable, moving];
  } else {
    /* his instructions and the frame stay the system message; the book and
     * its notes are a message of their own, before his request */
    system = head;
    systemParts = [head];
    const lead = joinParts([opening, stableBook]);
    const body = joinParts([lead, moving]);
    if (body.trim()) {
      if (notesAs === 'assistant') messages.push({ role: 'user', content: PICK_UP });
      messages.push({ role: notesAs, content: body, cacheSplit: moving.trim() ? lead.length : body.length });
    }
  }
  messages.push(...after);
  return {
    system,
    systemParts,
    messages,
    stats: { tokens: estimateTokens(system) + messages.reduce((a, m) => a + estimateTokens(m.content), 0), room: total, whole: fit.whole + (chapter.id ? 1 : 0), short: fit.short, omitted: fit.book.omitted },
  };
}
