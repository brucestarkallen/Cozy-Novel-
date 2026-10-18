/* Cozy Novel — js/novel/talk.js
 *
 * The two conversations beside the book: the PARTNER, to talk the book over
 * with, and PLAY A SCENE, where he plays one of the people and the narrator
 * plays the rest. Both are turns with versions (another reply sits beside the
 * first, one arrow away), streamed as they come; a reply that fails is never
 * asked again by itself — the reason is said and he tries again by hand.
 *
 * The partner can change the book too (changes.js): what its answer's block
 * asks for lands as the answer finishes — or waits for Apply — each with its
 * Undo. A chapter it only has in short it may ask to read whole: it is sent,
 * and the same answer goes on (up to three times).
 */

import * as store from '../store.js';
import { ask, emptyWhy, stripControlLeak, finalWords } from '../model/call.js';
import { wireOf } from '../model/providers.js';
import { estimateTokens } from '../util.js';
import { assemble, requiredLength, SAFETY, partnerReply, PARTNER_FLOOR } from './context.js';
import { contextOf } from '../model/providers.js';
import { connFor, connName, recount, rewrite as writerRewrite, busy as writerBusy } from './writer.js';
import { turnSteps, newTurn, newVersion, picked, novelSteps, chapterLabel, chapterText, NOTE_KINDS, matchCard } from './shape.js';
import { newId, numberWords } from '../util.js';
import { playOpening, playOnwards, readBack, tellLine, sceneWords, ideasRequest, leftOutWords, CHOICES_OPEN, CHOICES_CLOSE } from './prompts.js';
import { joinSoftWraps, mendMarks, dropGluedStrays, finishTail, dropTop, dropMarkup, partBlock } from './textshape.js';
import { numberedText, partnerCut } from './context.js';
import { READ_AT_ONCE, blocksIn, opsOf, readAsks, makeChange, makeTogether, groupsOf, undoChange, outcomeWords, statusNow, sinceWords, changeShort, madeGone, labelOf, whyNot, wordsOf, withEdits, directionsIn, unreadableRead, targetOf, baseOf, driftOf, numbersOf, whereOf, fieldsOf, snapshotForChanges, changedSinceSnapshot, renamedTarget } from './changes.js';
import { searchBook } from './search.js';
import { listModules } from './modules.js';
import { nameKey } from '../util.js';
import * as archivist from './archivist.js';
import { convSteps, conversationsOf, freeName, openName, cleanConvName, markedName } from './conversations.js';
import { tellerOf, toTeller } from './teller.js';
import { scenePlan } from './stretches.js';
import { entriesOf, entryNamed, entryWords, KIND_TITLE } from './bibliography.js';
import { pickEntries } from './bibpick.js';
import { appliesOf } from './auto.js';

const running = new Map();        /* 'talk/<id>' | 'play/<id>' -> job */
const jobFns = new Set();
export function onTalkJob(fn) { jobFns.add(fn); return () => jobFns.delete(fn); }
function tell(key) { for (const fn of jobFns) { try { fn(key, running.get(key) || null); } catch (e) { console.error(e); } } }
export function talkBusy(kind, id) { return running.has(`${kind}/${id}`); }
/* any answer on its way anywhere — the partner's, a scene's, Ideas — in any book (an update waits for it) */
let ideasAsked = 0;
export function anyTalking() { return running.size > 0 || ideasAsked > 0; }
export function stopTalk(kind, id) { const j = running.get(`${kind}/${id}`); if (j) j.ctl.abort(); }

const liveFns = new Set();
export function onTalkLive(fn) { liveFns.add(fn); return () => liveFns.delete(fn); }
function live(ev) { for (const fn of liveFns) { try { fn(ev); } catch (e) { console.error(e); } } }

function bookNow(novelId) {
  const novel = store.peek('novel', novelId);
  const chapters = {};
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  return { novel, chapters };
}

/* the conversation so far, newest kept whole and oldest let go once it would
 * take more than a quarter of the room. after: only the turns after that one
 * (a scene already written into the book rides there, as the book). A long
 * scene's earliest turns ride as the summaries of their stretches (archivist
 * sceneStretchUp) before any is let go: the fewest summed up that fit. */
export const SCENE_SHORT = 'The scene so far, in short — its earliest turns, summed up:';
export const SCENE_ON = 'Then, turn by turn:';
/* share: of the model's room the talk may take (the book open comes first: runTurn gives it less when the chapter open
 * would be cut) */
export function turnsFor(record, { upto = null, conn, openWith = '', after = null, share = 0.25 } = {}) {
  const out = [];
  const list = record.turns || [];
  const from = after ? list.findIndex((t) => t.id === after) + 1 : 0;
  /* what came of the partner's changes, told with his next message */
  let told = '';
  const scene = Boolean(record.who !== undefined || record.chapterId);
  const bookId = record.novelId || record.id || null;
  for (const t of list.slice(Math.max(0, from))) {
    if (upto && t.id === upto) break;
    const v = picked(t);
    /* in a scene: the narrator's words without the ways it offered, and his
     * line to the narrator (not his character's) after his own */
    const raw = String((v && v.text) || '');
    const text = (scene && t.by !== 'you' ? sceneWords(raw) : raw).trim();
    const tell = scene && t.by === 'you' && v && v.tell ? tellLine(record.who, v.tell) : '';
    if (!text && !tell) continue;
    if (t.by === 'you') {
      const mine = [text, tell].filter(Boolean).join('\n\n');
      /* as it was told when he sent it (2.12.2) — the talk is never rewritten after; kept from before, as it stands now */
      const said = v && typeof v.told === 'string' ? v.told : told;
      out.push({ role: 'user', content: said ? `${said}\n\n${mine}` : mine, turn: t.id });
      told = '';
    } else {
      out.push({ role: 'assistant', content: text, turn: t.id });
      told = outcomeWords(v.changes, bookId);
    }
  }
  if (told && out.length && upto) {
    /* the answer asked for again: what came of the changes before it still rides */
    const last = out[out.length - 1];
    if (last.role === 'user') last.content = `${told}\n\n${last.content}`;
  }
  /* the answer asked for again: what its earlier answers changed is in the book, said (his report, 2.12.2) */
  if (upto && !scene && out.length && out[out.length - 1].role === 'user') {
    const t = list.find((x) => x.id === upto);
    const made = ((t && t.versions) || []).filter((v) => !v.streaming).flatMap((v) => v.changes || []).filter((c) => c.status === 'made' && !c.superseded && !madeGone(bookId, c));
    if (made.length) {
      const last = out[out.length - 1];
      last.content = `(From your earlier answer to this, these changes were made and are in the book as it reads now: ${made.slice(-12).map((c) => `${c.label}${changeShort(c)}`).join('; ')}${made.length > 12 ? `; and ${made.length - 12} more` : ''}.)\n\n${last.content}`;
    }
  }
  const cap = Math.floor(contextOf(conn) * share);
  let total = out.reduce((a, m) => a + estimateTokens(m.content), 0);
  /* a long scene: its earliest stretches by their summaries — summed up as their turns read now, from the first turn sent, before the point answered — the fewest that fit */
  let short = '';
  if (scene && total > cap && Array.isArray(record.stretches) && record.stretches.length) {
    const at = new Map(list.map((t, k) => [t.id, k]));
    const end = upto && at.has(upto) ? at.get(upto) : list.length;
    const usable = [];
    for (const s of scenePlan(record).stretches) {
      if (at.get(s.from) < from) continue;
      if (!s.text || at.get(s.to) >= end) break;
      if (!usable.length && at.get(s.from) !== from && list.slice(from, at.get(s.from)).some((t) => out.some((m) => m.turn === t.id))) break;
      usable.push(s);
    }
    for (let k = 1; k <= usable.length; k++) {
      const last = at.get(usable[k - 1].to);
      const rest = out.filter((m) => at.get(m.turn) > last);
      const rows = usable.slice(0, k).map((s) => s.text).join('\n\n');
      const cost = estimateTokens(rows) + 20 + rest.reduce((a, m) => a + estimateTokens(m.content), 0);
      if (cost <= cap || k === usable.length) {
        short = rows;
        out.splice(0, out.length - rest.length);
        total = cost;
        break;
      }
    }
  }
  let dropped = 0;
  const droppedTurns = [];
  while (out.length > 2 && total > cap) { total -= estimateTokens(out[0].content); droppedTurns.push(out[0].turn); out.shift(); dropped++; }
  /* the scene so far in short opens it — with his first turn after it, or as his message before the narrator's — and says what after it is left out */
  if (short) {
    const head = `${SCENE_SHORT}\n\n${short}${dropped ? '\n\n(Some turns after these are left out here, to save room.)' : ''}`;
    if (out.length && out[0].role === 'user') out[0] = { ...out[0], content: `${head}\n\n${SCENE_ON}\n\n${out[0].content}` };
    else out.unshift({ role: 'user', content: head });
    return out.map(({ turn, ...m }) => m);
  }
  /* a conversation opens with his turn: the narrator's opening is answered to
   * the words that asked for it, and anything else that lost its question goes */
  if (out.length && out[0].role !== 'user') {
    if (openWith) out.unshift({ role: 'user', content: openWith });
    else while (out.length && out[0].role !== 'user') out.shift();
  }
  /* the oldest talk let go for room is said, never silently missing (Cozy Tavern's M265) — with the changes made in it
   * that the book still has (2.12.2: it must know they are in the book) */
  const madeThen = scene ? [] : list.filter((t) => t.by === 'ai' && droppedTurns.includes(t.id)).flatMap((t) => (picked(t) || {}).changes || []).filter((c) => c.status === 'made' && !c.superseded && !madeGone(bookId, c));
  const thenWords = madeThen.length ? ` Your changes in it that the book has now: ${madeThen.slice(-12).map((c) => `${c.label}${changeShort(c)}`).join('; ')}${madeThen.length > 12 ? `; and ${madeThen.length - 12} more` : ''}.` : '';
  if (dropped && out.length && out[0].role === 'user') out[0] = { ...out[0], content: `${scene ? '(The earliest turns of this scene are left out here, to save room.)' : `(The earliest part of our talk is left out here, to save room.${thenWords})`}\n\n${out[0].content}` };
  return out.map(({ turn, ...m }) => m);
}

/* His last few turns, in his own words only — his moves and his lines to the
 * narrator, or his messages to the partner — up to the reply being written:
 * what wakes a rule (crafts.js wakesOn); never the narrator's telling nor the
 * partner's answers. A scene's own premise — where he said it starts — goes
 * with them for the whole scene, as a premise does on the page until a scene
 * break (shape.js hisWordsBefore). */
export const HIS_TURNS = 3;
/* his own message this answer answers: what an answer that ran past its end types out again */
function hisLine(record, turnId) {
  const turns = (record && record.turns) || [];
  const i = turns.findIndex((t) => t.id === turnId);
  for (let k = (i === -1 ? turns.length : i) - 1; k >= 0; k--) {
    const t = turns[k];
    if (t.by !== 'you') continue;
    const v = picked(t) || {};
    return [String(v.text || ''), String(v.tell || '')].filter((x) => x.trim()).join('\n');
  }
  return '';
}
/* the answer without what is never its words: a provider's leaked control
 * token, or his next message typed out by a model that ran past its end
 * (Cozy Tavern M117, M469) — said once on the answer */
function cleanAnswer(kind, id, turnId, words, notes) {
  const leak = stripControlLeak(words, { asked: hisLine(store.peek(kind, id), turnId) });
  if (!leak.leaked) return words;
  const said = leak.ranPast ? 'It ran past the end of its answer and began writing your next message — the words before that were kept.' : 'The words before the provider’s leak were kept.';
  if (!notes.includes(said)) notes.push(said);
  return leak.text;
}

/* the narrator's telling made whole the way a page is (Cozy Tavern's
 * storyteller: M510-34, M524, M476, M458, M626) — a block of tracking and a
 * note to him after it taken off and kept (`tookOff`: the turn's menu puts
 * it back), white space and marks mended; only the telling: the ways it
 * could go, offered after it, stay to the letter; the unfinished end of a
 * telling that was cut is left as it is */
export function shapeTelling(words, { cut = false, notes = null } = {}) {
  const w = String(words || '');
  const at = w.toLowerCase().indexOf(CHOICES_OPEN);
  const story = at >= 0 ? w.slice(0, at) : w;
  const rest = at >= 0 ? w.slice(at) : '';
  const say = (said) => { if (notes && !notes.includes(said)) notes.push(said); };
  /* a plan or a heading above the telling ("## The Scene") is not the telling (Cozy Tavern M116, M322–M326) */
  const head = dropTop(story);
  if (head.removed) say(`${head.plan && head.heading ? 'The narrator’s plan and a heading above the telling were' : head.plan ? 'The narrator’s plan, written above the telling, was' : 'A heading above the telling was'} taken off — Put back what was taken off brings ${head.plan && head.heading ? 'them' : 'it'} back.`);
  const unglued = dropGluedStrays(head.text);
  if (unglued.changed) say('A stray character of another script, stuck to the front of a word, was taken off.');
  const unmarked = dropMarkup(unglued.text);
  if (unmarked.changed) say(`Web page or code markup the narrator left in the telling (${unmarked.taken.slice(0, 3).map((x) => `“${x}”`).join(', ')}) was taken off.`);
  const fin = finishTail(joinSoftWraps(partBlock(unmarked.text).text));
  if (fin.removed) {
    const what = fin.kinds.includes('tracking') && fin.kinds.includes('note') ? 'A block of tracking and a note to you' : fin.kinds.includes('tracking') ? 'A block of tracking' : 'A note to you';
    say(`${what} after the telling ${fin.kinds.length > 1 ? 'were' : 'was'} taken off — Put back what was taken off brings ${fin.kinds.length > 1 ? 'them' : 'it'} back.`);
  }
  const telling = fin.removed ? fin.text.replace(/\s+$/, '') + (rest ? '\n\n' : '') : fin.text;
  return { text: mendMarks(telling, { leaveLast: cut && !rest }).text + rest, tookOff: fin.removed || '', tookOffTop: head.removed || '' };
}
/* What came off a telling's end, put back where it was — before the ways it
 * offers — as a new version of that answer; the one without it stays one
 * arrow away. */
export function putBackTelling({ playId, turnId }) {
  const play = store.peek('play', playId);
  const turn = play && (play.turns || []).find((t) => t.id === turnId);
  const v = turn && picked(turn);
  const top = String((v && v.tookOffTop) || '').trim();
  const end = String((v && v.tookOff) || '').trim();
  if (!v || (!top && !end) || running.has(`play/${playId}`)) return false;
  const w = String(v.text || '');
  const at = w.toLowerCase().indexOf(CHOICES_OPEN);
  const story = (at >= 0 ? w.slice(0, at) : w).replace(/\s+$/, '');
  const rest = at >= 0 ? w.slice(at) : '';
  const text = `${top ? `${top}\n\n` : ''}${story}${end ? `\n\n${v.tookOff}` : ''}${rest ? `\n\n${rest}` : ''}`;
  const { id: _id, at: _at, tookOff: _off, tookOffTop: _top, notes: _n, ...keep } = v;
  /* as he wants it, whole: never made whole again (mend.js) */
  store.change('play', playId, turnSteps.addVersion(turnId, newVersion({ ...keep, text, done: Date.now(), asIs: true })), { now: true });
  return true;
}

export function hisLast(record, upto = null) {
  const out = [];
  for (const t of (record && record.turns) || []) {
    if (upto && t.id === upto) break;
    if (t.by !== 'you') continue;
    const v = picked(t) || {};
    const words = [String(v.text || ''), String(v.tell || '')].filter((x) => x.trim()).join('\n');
    if (words) out.push(words);
  }
  return [String((record && record.from) || '').trim(), ...out.slice(-HIS_TURNS)].filter(Boolean).join('\n');
}

/* The chapters the partner asked to read whole, when they are more than its
 * model holds beside everything else: the short ones go whole, and what they
 * leave is shared among the long ones, each keeping its opening and its end,
 * the middle said to be left out. Never more than the budget. tokens: what
 * the chapters' words come to as sent. */
const CUT_MARK = '[… the middle of this chapter is left out here: the whole of it is more than fits beside everything else …]';
/* cutRow(row, room): a chapter's own cut, at its passages' edges, each left out named (context.js partnerCut) — or null */
export function fitRead(rows, budget, cutRow = null) {
  const cost = rows.map((r) => (r.missing ? 0 : estimateTokens(r.text)));
  const whole = cost.reduce((a, b) => a + b, 0);
  if (whole <= budget) return { rows, cut: false, tokens: whole };
  const share = new Array(rows.length).fill(0);
  let left = Math.max(0, Math.floor(budget));
  let n = rows.length;
  for (const i of rows.map((_, k) => k).sort((a, b) => cost[a] - cost[b])) {
    share[i] = Math.min(cost[i], Math.floor(left / n));
    left -= share[i];
    n -= 1;
  }
  let tokens = 0;
  const out = rows.map((r, i) => {
    if (r.missing || share[i] >= cost[i]) { tokens += cost[i]; return r; }
    const own = cutRow && r.chapterId ? cutRow(r, Math.max(200, share[i])) : null;
    if (own) { tokens += estimateTokens(own); return { ...r, text: own }; }
    const room = share[i] - estimateTokens(CUT_MARK) - 10;
    if (room < 120) { tokens += estimateTokens(CUT_MARK); return { ...r, text: CUT_MARK }; }
    const chars = Math.floor((r.text.length * room) / cost[i]);
    const head = r.text.slice(0, Math.floor(chars * 0.6)).replace(/\s+\S*$/, '');
    const tail = r.text.slice(-Math.floor(chars * 0.4)).replace(/^\S*\s+/, '');
    const text = `${head}\n\n${CUT_MARK}\n\n${tail}`;
    tokens += estimateTokens(text);
    return { ...r, text };
  });
  return { rows: out, cut: true, tokens };
}

async function runTurn({ kind, id, novelId, turnId, versionId, role, buildArgs, length = 'scene' }) {
  /* the rounds within one answer, in the order they came: what it asked to
   * read ({said, rows}: chapters whole, places some words stand, a module) —
   * fitted to the room that is left when they are more than it holds — and
   * what became of its changes ({said, ask}), told back so it can put right
   * the ones that could not be made (Cozy Tavern's re-asks) */
  const rounds = [];
  const readSome = () => rounds.some((x) => x.rows);
  const extraOf = (budget = Infinity) => {
    const f = fitRead(rounds.filter((x) => x.rows).flatMap((x) => x.rows), budget, (row, room) => {
      const c = store.peek('chapter', row.chapterId);
      const n = store.peek('novel', novelId);
      return c && n ? partnerCut(n, c, c.passages || [], room) : null;
    });
    let k = 0;
    const messages = [];
    let tokens = f.tokens;
    /* what the app asks again in his turn is said to the teller by its name (teller.js) — a chapter sent back opens on the chapter */
    const teller = tellerOf(store.peek('house', 'house') || {}, kind === 'play' ? 'play' : 'partner').name;
    for (const x of rounds) {
      if (x.rows) {
        const rows = f.rows.slice(k, k + x.rows.length);
        k += x.rows.length;
        messages.push({ role: 'assistant', content: x.said }, { role: 'user', content: readBack(rows, { cut: f.cut, notSent: x.notSent || [] }) + (x.last ? `\n\n${READ_LAST}` : '') });
      } else {
        messages.push({ role: 'assistant', content: x.said }, { role: 'user', content: toTeller(x.ask, teller) });
        tokens += estimateTokens(x.said) + estimateTokens(x.ask);
      }
    }
    /* the chapters it read whole — not one sent cut to fit */
    const whole = f.rows.filter((r) => r.chapterId && !r.missing && !String(r.text).includes(CUT_MARK)).map((r) => r.chapterId);
    return { messages, tokens, whole };
  };
  const read = [];
  /* the chapters it has had whole in this answer: the ones the request carried, and the ones it read (never cut) */
  let seen = new Set();
  /* the page as it was numbered for the round its changes answer */
  let numbers = null;
  let snapshot = null;
  /* the cards it was shown by their first line, and the ones it read whole since */
  let shortCards = new Set();
  /* the oldest chapters its room left out even as summaries — said under the answer (Cozy Tavern M265: no silent cut) */
  let leftOut = 0;
  /* the passages of the chapter open its room left out (each named where it stood, with how to read it) — said too */
  let openLeft = [];
  const cardsRead = new Set();
  /* the thinking of every round, kept whole (Cozy Tavern's M77/M80): what
   * each round thought, and between them what happened next */
  let thoughtBefore = '';
  let thoughtNext = '';
  const keepThought = (t, after) => {
    const has = String(t || '').trim();
    if (has) { thoughtBefore = joinThought(thoughtBefore, has, thoughtNext); thoughtNext = after; } else if (thoughtBefore) thoughtNext = thoughtNext ? `${thoughtNext}, ${after}` : after;
  };
  const allThought = (t) => joinThought(thoughtBefore, t, thoughtNext || 'then');
  const key = `${kind}/${id}`;
  const house = store.peek('house', 'house') || {};
  const conn = connFor(house, role);
  const conversation = (store.peek(kind, id) || {}).convId || null;
  /* A reply can outlive a conversation replaced in another window or a
   * restored copy. It must still belong here before any of its changes land. */
  const ownsReply = () => {
    const rec = store.peek(kind, id);
    if (!store.peek('novel', novelId) || !rec || (kind === 'talk' && (rec.convId || null) !== conversation)) return false;
    const turn = (rec.turns || []).find((t) => t.id === turnId);
    return Boolean(turn && (turn.versions || []).some((v) => v.id === versionId));
  };
  const gone = () => ({ ok: false, stopped: true, gone: true, error: 'the conversation changed while its reply was on the way' });
  const undo = () => { if (!ownsReply()) return; try { store.change(kind, id, (d) => { const t = (d.turns || []).find((x) => x.id === turnId); if (!t) return; if (t.versions.length < 2) d.turns = d.turns.filter((x) => x.id !== turnId); else turnSteps.removeVersion(turnId, versionId)(d); }, { now: true }); } catch (_) { /* gone */ } };
  if (!conn) { undo(); return { ok: false, error: 'no connection is chosen for this yet — Settings → Connections', needsConnection: true }; }
  if (running.has(key)) { undo(); return { ok: false, error: 'a reply is already on its way — Stop it first' }; }
  const ctl = new AbortController();
  running.set(key, { ctl, turnId, versionId, at: Date.now() });
  tell(key);
  let text = '';
  let thinking = '';
  let last = Date.now();
  /* the words already settled in this answer: shown before a continuation
   * (prefix), and what is kept of it while a round is on its way — a round
   * that asks for the whole answer again keeps the one in hand until the new
   * one has come whole */
  let prefix = '';
  let done = '';
  let replacing = false;
  const keptNow = () => (replacing ? done : prefix + text);
  const alive = () => ({ beat: Date.now(), tab: store.CLIENT, browser: store.BROWSER });
  try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, alive()), { checkpoint: true, delay: 50 }); } catch (_) { /* gone */ }
  /* it beats while the model is silent too, so another window never takes a
   * reply still coming for one whose window closed */
  const beating = setInterval(() => {
    if (!ownsReply()) { ctl.abort(); return; }
    if (Date.now() - last < 25000) return;
    last = Date.now();
    try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, { ...(keptNow() ? { text: keptNow() } : {}), thinking: allThought(thinking) || undefined, ...alive() }), { checkpoint: true, delay: 50 }); } catch (_) { /* gone */ }
  }, 30000);
  try {
    /* a scene's telling: what it needs from his bibliography that no word near it names (bibpick.js), asked once
     * before it is written — none, and it goes as it would */
    let picks = [];
    if (kind === 'play') {
      try {
        const { novel, chapters } = bookNow(novelId);
        const args = buildArgs(store.peek(kind, id), conn);
        picks = (await pickEntries({ conn: connFor(house, 'helper'), house, novel, chapters, purpose: args.purpose, target: args.target, request: args.request || '', moment: args.moment || '', turns: args.turns || [], play: args.play, signal: ctl.signal,
          /* (the telling as it would go without a pick: when the whole bibliography is in it, nothing is asked) */
          dry: () => assemble({ house, novel, chapters, conn, ...args, turns: args.turns || [], length, notesKept: archivist.keepingNotes(novelId) }).stats })).refs || [];
      } catch (e) { console.error(e); picks = []; }
    }
    let out;
    const askNow = () => ask(conn, {
        build: (c) => {
          if (!ownsReply()) throw new Error('the conversation changed while its reply was on the way');
          const { novel, chapters } = bookNow(novelId);
          numbers = numbersOf(novel);
          snapshot = kind === 'talk' ? snapshotForChanges(novelId) : null;
          const rec = store.peek(kind, id);
          let args = buildArgs(rec, c);
          const made = (extra) => assemble({ house, novel, chapters, conn: c, ...args, turns: [...(args.turns || []), ...extra.messages], length, notesKept: archivist.keepingNotes(novelId), picks });
          let extra = extraOf();
          let a = made(extra);
          /* the book open comes before old talk (his report, 2.12.2: a passage of the chapter open left out while the
           * oldest talk rode whole): the talk gives way — its earliest part said to be left out — before a passage does */
          if (kind === 'talk' && (a.stats.openLeft || []).length) {
            for (const share of [0.12, 0.05]) {
              const was = args;
              args = buildArgs(rec, c, share);
              const fewer = made(extra);
              if ((fewer.stats.openLeft || []).length < a.stats.openLeft.length) a = fewer; else args = was;
              if (!(a.stats.openLeft || []).length) break;
            }
          }
          if (readSome()) {
            /* what it asked to read, beside everything else that has to go —
             * his words, the book's words and notes, the chapter open (down
             * to its start and the words before the point), the talk and the
             * answer's room — is more than the model holds: they share what
             * is left */
            const mustGo = a.stats.fixed - extra.tokens - a.stats.current + Math.min(a.stats.current, 1000);
            const left = contextOf(c) - a.stats.reserve - SAFETY - mustGo - 300;
            if (extra.tokens > left) { extra = extraOf(Math.max(0, left)); a = made(extra); }
          }
          /* the chapters it asked for give way to a smaller room, like the book */
          const least = a.stats.least - extra.tokens;
          seen = new Set([...(a.stats.wholeIds || []), ...(a.stats.wholePassages || []), ...(extra.whole || [])]);
          shortCards = new Set((a.stats.shortCards || []).filter((x) => !cardsRead.has(x)));
          leftOut = a.stats.omitted || 0;
          openLeft = a.stats.openLeft || [];
          return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: replyRoom(c, kind, length), refuse: a.refuse, least, seed: a.seed };
        },
        stream: true,
        signal: ctl.signal,
        /* the partner talks the book over: never his page's started reply, nor its template (Cozy Tavern's M328) */
        ...(kind === 'talk' ? { noPrefill: true, noStructured: true } : {}),
        onText: (s) => {
          if (!ownsReply()) { ctl.abort(); return; }
          text += s;
          /* (asked for the block its first words described: those words stay on screen while it answers, never a blank nor the second try's prose) */
          live({ kind, id, turnId, versionId, text: replacing ? done : prefix + text, thinking, ...(replacing ? { note: ASKING_BLOCK } : {}) });
          if (Date.now() - last > 3000) { last = Date.now(); store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: keptNow(), thinking: allThought(thinking) || undefined, ...alive() }), { checkpoint: true, delay: 50 }); }
        },
        onThinking: (s) => {
          if (!ownsReply()) { ctl.abort(); return; }
          thinking += s;
          live({ kind, id, turnId, versionId, text: replacing ? done : prefix + text, thinking, ...(replacing ? { note: ASKING_BLOCK } : {}) });
          if (Date.now() - last > 20000) { last = Date.now(); store.change(kind, id, turnSteps.setVersion(turnId, versionId, { thinking: allThought(thinking) || undefined, ...alive() }), { checkpoint: true, delay: 50 }); }
        },
      });
    /* one ask — and when the partner asks to read chapters whole, find words
     * or read a module, they are sent and the same answer goes on (three
     * times in all, in any round) */
    let readsLeft = 3;
    let lastTold = false;
    let howTold = false;
    const askReading = async () => {
      for (;;) {
        const o = await askNow();
        if (!ownsReply()) throw new Error('the conversation changed while its reply was on the way');
        const said = finalWords(o, text);
        const all = kind === 'talk' && o.ok && !o.cut ? readAsks(said) : [];
        const asked = all.slice(0, READ_AT_ONCE);
        const notSent = all.slice(READ_AT_ONCE).map(askLabel);
        /* a read block with nothing in it that can be read: told once how to ask (M222) */
        if (kind === 'talk' && o.ok && !o.cut && !asked.length && !howTold && unreadableRead(said)) {
          howTold = true;
          rounds.push({ said: said.trim(), ask: READ_HOW });
          keepThought(thinking, 'asked how to read');
          text = ''; thinking = '';
          live({ kind, id, turnId, versionId, text: replacing ? done : prefix, thinking: thoughtBefore, note: 'Telling it how to ask for a chapter…' });
          continue;
        }
        if (!asked.length) return o;
        /* past three reads in one answer: what it asked is sent, and it is told to answer now (M221) */
        const last = readsLeft <= 0;
        if (last && lastTold) return o;
        readsLeft--;
        const rows = readRows(novelId, asked);
        rounds.push({ said: said.trim() || '(I asked to read them.)', rows, ...(notSent.length ? { notSent } : {}), ...(last ? { last: true } : {}) });
        if (last) lastTold = true;
        read.push(...rows.filter((r) => !r.missing).map((r) => r.label));
        for (const r of rows) if (r.cardId) cardsRead.add(r.cardId);
        keepThought(thinking, `read ${rows.map((r) => r.label).join(', ')}`);
        text = '';
        thinking = '';
        live({ kind, id, turnId, versionId, text: replacing ? done : prefix, thinking: thoughtBefore, note: `Reading ${rows.map((r) => r.label).join(', ')} whole…` });
      }
    };
    out = await askReading();
    const leakNotes = [];
    if (leftOut > 0) leakNotes.push(leftOutWords(leftOut, kind === 'play' ? 'the narrator' : 'your partner'));
    /* (read since, in this answer: it had them) */
    const stillLeft = openLeft.filter((n) => !read.some((r) => r.startsWith(chapterLabelOf(novelId, n))));
    if (kind === 'talk' && stillLeft.length) leakNotes.push(`To fit your partner’s room, ${stillLeft.length === 1 ? `passage ${stillLeft[0]} of the chapter open was` : `passages ${stillLeft.slice(0, 6).join(', ')}${stillLeft.length > 6 ? ' and more' : ''} of the chapter open were`} left out of what it was sent — each named where it stood, with how to read it.`);
    const firstWords = cleanAnswer(kind, id, turnId, finalWords(out, text), leakNotes);
    if (!firstWords.trim()) {
      const why = out.stopped ? 'stopped before any words came'
        : finalWords(out, text).trim() ? 'the answer held nothing before the provider’s own markers'
          : out.ok ? emptyWhy(out, thinking) : out.error;
      /* what it thought is never thrown away: kept beside his message, with why no words came (Cozy Tavern's M301) */
      const thought = allThought(out.thinking || thinking);
      if (thought.trim()) {
        store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: '', thinking: thought, streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true, cutWhy: why, done: Date.now(), model: conn.model, conn: connName(conn) }), { checkpoint: true, now: true });
        return out.stopped ? { ok: false, stopped: true, kept: true } : { ok: false, error: why, kept: true };
      }
      undo();
      if (out.stopped) return { ok: false, stopped: true };
      return { ok: false, error: why };
    }
    const shaped = kind === 'play' ? shapeTelling(firstWords, { cut: Boolean(out.cut || out.stopped), notes: leakNotes }) : { text: firstWords, tookOff: '' };
    done = shaped.text.replace(/\s+$/, '');
    const notesOf = (o) => { const all = [...new Set([...((o && o.notes) || []), ...leakNotes])]; return all.length ? all : undefined; };
    /* what its own web search looked at, every round of the answer (Cozy Tavern F9) */
    const looked = [];
    const sourcesOf = (o) => { for (const x of (o && o.sources) || []) if (x && x.url && !looked.some((y) => y.url === x.url)) looked.push(x); return looked.length ? looked.slice(0, 20) : undefined; };
    store.change(kind, id, turnSteps.setVersion(turnId, versionId, {
      text: done, thinking: allThought(out.thinking || thinking) || undefined, streaming: undefined, beat: undefined, tab: undefined, browser: undefined,
      cut: out.cut || out.stopped ? true : undefined, cutWhy: out.cut || out.stopped ? cutWords(out) : undefined, notes: notesOf(out), sources: sourcesOf(out),
      usage: out.usage || undefined, ms: out.sent ? out.sent.ms : undefined, model: conn.model, conn: connName(conn), sent: out.sent ? versionId : undefined, done: Date.now(),
      tokensIn: out.usage && Number.isFinite(out.usage.in) ? out.usage.in : (out.sent && Number.isFinite(out.sent.tokens) ? out.sent.tokens : undefined),
      tokensCounted: out.usage && Number.isFinite(out.usage.in) ? true : undefined,
      read: read.length ? read : undefined,
      tookOff: shaped.tookOff || undefined,
      tookOffTop: shaped.tookOffTop || undefined,
    }), { checkpoint: true, now: true });
    /* what the partner's block asks for: made now, or waiting for Apply. What
     * could not be made is told back for it to put right in the same answer
     * (twice at most, every answer's block made); an answer that says it
     * changed the book with no block for it is asked once for the block
     * (Cozy Tavern's M75/M118) — and its first words stand whatever comes
     * back: the block that comes is laid beside them and made; "NOTHING" (no
     * change was meant — a question answered, a change made earlier spoken
     * of) leaves them as they were; a plain line that it could not be made is
     * added under them. They were never written over before 2.12.7: his
     * question answered well, then the answer gone, a muddle about earlier
     * changes in its place, because a sentence of it read like a claim. */
    if (kind === 'talk') {
      let segment = done;
      const all = [];
      let askedWhole = false;
      for (let fix = 0; ; fix++) {
        const changes = settleChanges(novelId, turnId, versionId, segment, store.peek('house', 'house') || house, all, seen, numbers, new Set([...shortCards].filter((x) => !cardsRead.has(x))), snapshot);
        all.push(...changes);
        if (fix >= 2 || out.cut || out.stopped || ctl.signal.aborted) break;
        const missed = changes.filter((c) => c.status === 'refused' && MISSED.test(String(c.said || '')));
        const claimed = !missed.length && !askedWhole && !opsOf(segment).length && claimsChange(wordsOf(segment));
        if (!missed.length && !claimed) break;
        rounds.push({ said: segment, ask: missed.length ? missedWords(missed) : NOTHING_HAPPENED });
        replacing = claimed;
        askedWhole = askedWhole || claimed;
        prefix = replacing ? '' : done + '\n\n';
        keepThought(out.thinking || thinking, 'asked again');
        text = '';
        thinking = '';
        live({ kind, id, turnId, versionId, text: done, thinking: thoughtBefore, note: missed.length ? 'Putting right what could not be made…' : ASKING_BLOCK });
        out = await askReading();
        const next = cleanAnswer(kind, id, turnId, finalWords(out, text), leakNotes).replace(/\s+$/, '');
        const whole = replacing;
        replacing = false;
        if (!next.trim()) break;
        segment = next;
        let cutAgain = false;
        if (whole) {
          /* its first words stand (Cozy Tavern's M163: a re-ask never erases the reading it was improving) */
          if (NOTHING_MEANT.test(next)) {
            store.change(kind, id, turnSteps.setVersion(turnId, versionId, { thinking: allThought(out.thinking || thinking) || undefined, notes: notesOf(out), sources: sourcesOf(out) }), { checkpoint: true, now: true });
            break;
          }
          const block = blocksIn(next);
          cutAgain = Boolean(out.cut || out.stopped);
          if (block) done = `${done}\n\n${block}`;
          else if (cutAgain) { if (!leakNotes.includes(AGAIN_CUT)) leakNotes.push(AGAIN_CUT); }
          else done = `${done}\n\n${next}`;
        } else done = `${done}\n\n${next}`;
        store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: done, thinking: allThought(out.thinking || thinking) || undefined,
          cut: !cutAgain && (out.cut || out.stopped) ? true : undefined, cutWhy: !cutAgain && (out.cut || out.stopped) ? cutWords(out) : undefined, notes: notesOf(out), sources: sourcesOf(out) }), { checkpoint: true, now: true });
        if (cutAgain && !blocksIn(next)) break;
      }
      /* a change that missed and was then made (or set to wait) in a later round no longer stands as missed (Cozy Tavern's M683) */
      supersede(novelId, turnId, versionId);
    }
    store.change(kind, id, turnSteps.set({ updated: Date.now() }), { now: true });
    if (out.sent) store.keepSent(novelId, versionId, { ...out.sent, purpose: kind === 'talk' ? 'partner' : 'play' });
    await store.flush(kind, id);
    return { ok: true };
  } catch (e) {
    if (!ownsReply()) return gone();
    /* what arrived stays, said to be cut — never left "being written". An
     * answer already in hand (its changes made) is never taken back by a
     * round that failed after it: it stays, with whatever the round added */
    const kept = done ? (replacing || !text.trim() ? done : `${prefix}${text}`) : text;
    if (!kept.trim()) undo();
    else {
      try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: kept.replace(/\s+$/, ''), streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: kept !== done ? true : undefined }), { now: true }); } catch (_) { /* gone */ }
    }
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    clearInterval(beating);
    running.delete(key);
    tell(key);
    live({ kind, id, turnId, versionId, done: true });
  }
}

/* what one answer may run to: the partner's with room for a changes block (context.js partnerReply); a scene's as he set it */
export { PARTNER_FLOOR };
function replyRoom(c, kind, length) {
  if (kind === 'talk') return partnerReply(c, length, wireOf(c) === 'anthropic');
  if (wireOf(c) === 'anthropic') return requiredLength(c, length);
  return Number.isFinite(c.maxTokens) ? c.maxTokens : undefined;
}
/* the thinking of the rounds, joined where each round began again */
function joinThought(before, now, why) {
  const t = String(now || '').trim();
  if (!t) return before;
  return before ? `${before}\n\n— ${why || 'then'}, then —\n\n${t}` : t;
}
const READ_LAST = 'That is all of the book one answer can read: answer now, from what you have.';
const AGAIN_CUT = 'Asked again for the change it described, the answer came back cut — its first answer stands, with what the second one made.';
const READ_HOW = 'That read block could not be read. Ask for a chapter by its number — [3] — for every place some words stand with "find: …", for an entry of the bibliography with "entry: …", or for a module with "module: …", in a read block; or answer from what you have.';

/* ----------------------------------------------------- the partner's changes */

/* an ask named back: Chapter Nine, where “Oda” stands, the module “The novel craft” */
function askLabel(n) {
  if (n && typeof n === 'object' && n.find) return `where “${n.find}” stands`;
  if (n && typeof n === 'object' && n.card) return `the card “${n.card}”`;
  if (n && typeof n === 'object' && n.entry) return `the entry “${n.entry}”`;
  if (n && typeof n === 'object' && n.about) return 'About this book';
  if (n && typeof n === 'object' && n.module) return `the module “${n.module}”`;
  return `Chapter ${numberWords(n)}`;
}
/* the chapters it asked for, whole and numbered (or said not to be there) */
function readRows(novelId, asked) {
  const novel = store.peek('novel', novelId);
  return asked.map((n) => {
    /* the places some words stand, each with its passage number and the words either side */
    if (n && typeof n === 'object' && n.find) {
      const chapters = {};
      for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
      const hits = searchBook({ novel, chapters, query: n.find, limit: 40 }).filter((x) => x.where === 'passage' || x.where === 'chapter' || x.where === 'note' || x.where === 'book');
      const label = `Where “${n.find}” stands`;
      if (!hits.length) return { label, text: '(those words stand nowhere in the book)', missing: false };
      const rows = hits.map((x) => {
        const where = x.where === 'passage' ? `[${novel.order.indexOf(x.chapterId) + 1}.${(x.label.match(/\d+/) || [''])[0]}]` : `${x.group} — ${x.label}`;
        return `${where} …${x.snippet.before}${x.snippet.match}${x.snippet.after}…`;
      });
      return { label: `${label} (${hits.length >= 40 ? 'the first 40 places' : `${hits.length} place${hits.length === 1 ? '' : 's'}`})`, text: rows.join('\n') };
    }
    /* the book's own words, whole, each under the name a change to it uses ("book": "title" / "subtitle" / "about" / "style" / "plans") */
    if (n && typeof n === 'object' && n.about) {
      const meta = (novel && novel.meta) || {};
      const lines = [];
      lines.push(`Title: ${String(meta.title || '').trim() || '(none)'}`);
      if (String(meta.subtitle || '').trim()) lines.push(`Subtitle: ${String(meta.subtitle).trim()}`);
      lines.push(`What it's about ("about"):\n${String((novel && novel.brief) || '').trim() || '(nothing written yet)'}`);
      lines.push(`How it reads ("style"):\n${String((novel && novel.style) || '').trim() || '(nothing written yet)'}`);
      lines.push(`Where it's headed ("plans"):\n${String((novel && novel.plans) || '').trim() || '(nothing written yet)'}`);
      return { label: 'About this book, as it stands now', text: lines.join('\n\n') };
    }
    /* a card of the notes, whole: every part of it */
    if (n && typeof n === 'object' && n.card) {
      for (const kind of NOTE_KINDS) {
        const m = matchCard(((novel && novel.notes) || {})[kind] || [], n.card, [], { kind });
        if (m.ambiguous) return { label: `The card “${n.card}”`, text: '(more than one card answers to that name — ask for it by the name the notes give it)', missing: true };
        if (!m.card) continue;
        const c = m.card;
        const lines = [`${c.name}${c.aka && c.aka.length ? ` (also ${c.aka.join(', ')})` : ''}${c.about ? ` — ${String(c.about).trim()}` : ''}`];
        if (c.since) lines.push(`Since: ${String(c.since).trim()}`);
        if (c.ties) lines.push(`With others: ${String(c.ties).trim()}`);
        if (c.now) lines.push(`Right now: ${String(c.now).trim()}`);
        if (kind === 'threads') lines.push(c.open === false ? '(closed)' : '(still open)');
        return { label: `The card “${c.name}”`, text: lines.join('\n'), cardId: c.id };
      }
      return { label: `The card “${n.card}”`, text: '(there is no card by that name in the notes)', missing: true };
    }
    /* an entry of his bibliography, whole */
    if (n && typeof n === 'object' && n.entry) {
      const m = entryNamed(entriesOf(novel), n.entry);
      if (m.ambiguous) return { label: `The entry “${n.entry}”`, text: '(more than one entry goes by that name — ask for it by its full name)', missing: true };
      if (!m.entry) return { label: `The entry “${n.entry}”`, text: '(there is no entry by that name in the bibliography)', missing: true };
      const e = m.entry;
      const when = e.rides === 'always' ? 'The writer always reads it.' : e.rides === 'never' ? 'Only for me — the writer never reads it.' : 'The writer reads it when its name comes up.';
      return { label: `The entry “${e.name}”`, text: `${entryWords(e)}\n(${KIND_TITLE[e.kind] || 'Lore'}. ${when})` };
    }
    /* a module's words, whole */
    if (n && typeof n === 'object' && n.module) {
      const want = nameKey(n.module);
      const all = listModules(store.peek('house', 'house') || {});
      const m = all.find((x) => nameKey(x.name) === want) || all.find((x) => nameKey(x.name).startsWith(want));
      if (!m) return { label: `The module “${n.module}”`, text: `(there is no module called “${n.module}” — they are: ${all.map((x) => x.name).join(', ')})`, missing: true };
      return { label: `The module “${m.name}”`, text: m.text || '(empty — nothing is sent)' };
    }
    const chId = ((novel && novel.order) || [])[n - 1];
    const c = chId && store.peek('chapter', chId);
    if (!c) return { label: `Chapter ${numberWords(n)}`, text: '(there is no such chapter)', missing: true };
    return { label: chapterLabel(novel, c), chapterId: c.id, text: numberedText(novel, c) || chapterText(c) || '(nothing written in it yet)' };
  });
}

function settleChanges(novelId, turnId, versionId, text, house, before = [], seen = null, numbers = null, short = null, snapshot = null) {
  const ops = opsOf(text);
  if (!ops.length) return [];
  const wait = appliesOf(house) === 'wait';
  const novel = store.peek('novel', novelId);
  const changed = ops.map((op) => changedSinceSnapshot(novelId, op, snapshot, { where: whereOf(novel, op, numbers), numbers }));
  /* changes across the book that touch each other are made together, in one
   * pass over the book as it stood (Cozy Tavern's M675-8); the rest one by
   * one, each passage and chapter found as the page it was shown numbered
   * it (M682/M726) */
  const groups = groupsOf(ops);
  const groupOf = new Map();
  groups.forEach((g, k) => g.forEach((i) => groupOf.set(i, k)));
  const out = new Array(ops.length).fill(null);
  ops.forEach((op, i) => {
    if (out[i]) return;
    if (changed[i]) { out[i] = { id: newId('cg'), op, label: labelOf(op), why: String(op.why || ''), status: 'refused', said: changed[i] }; return; }
    if (groupOf.has(i)) {
      const g = groups[groupOf.get(i)];
      const made = makeTogether(novelId, g.map((k) => ops[k]), { dry: wait });
      const group = newId('cg');
      g.forEach((k, j) => {
        const r = made[j];
        out[k] = wait && r.status !== 'refused'
          ? { id: r.id, op: r.op, label: r.label, why: r.why, status: 'waiting', group, ...(r.undo && r.said ? { reach: r.said } : {}) }
          : { ...r, group };
      });
      return;
    }
    if (op.unreadable) { out[i] = makeChange(novelId, op); return; }
    const where = whereOf(novel, op, numbers);
    const at = where ? { where } : {};
    if (!wait) { out[i] = { ...makeChange(novelId, op, { seen, numbers, where, short }), ...at }; return; }
    /* waiting for Apply: looked at as it arrives, so one that cannot land is said now; and what it was made against kept, so a change since is said at Apply (M422) */
    const dry = makeChange(novelId, op, { dry: true, seen, numbers, where, short });
    const bulk = op.rename || op.replace_all !== undefined;
    out[i] = dry.status === 'refused' ? { ...dry, ...at }
      : { id: dry.id, op: dry.op, label: dry.label, why: dry.why, status: 'waiting', base: baseOf(novelId, op, where), ...at, ...(bulk && dry.said ? { reach: dry.said } : {}) };
  });
  const changes = out;
  store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes: [...before, ...changes] }), { now: true });
  /* an older answer's change still waiting for the same thing, written whole, is set aside by this one (M397) */
  if (wait) asideOlder(novelId, turnId, changes.filter((c) => c.status === 'waiting'));
  if (changes.some((c) => c.status === 'made')) afterChanges(novelId);
  startRewrites(novelId, turnId, versionId, changes.filter((c) => c.status === 'writing').map((c) => c.id));
  return changes;
}

/* THE WRITER WRITES IT AGAIN (2.12.9). A rewrite the partner asked for
 * ({"passage": "1.1", "rewrite": "…"}) goes to the writer as his own Rewrite
 * would — his model, his instructions, its craft — one passage after another,
 * behind whatever the writer is writing already; the card follows it: being
 * written, then written (with Undo, as a passage written anew), or why not.
 * One window's chain per book; a window closed mid-way is put right at open
 * (settleWriting). */
const rewriting = new Map();   /* novelId -> the chain of rewrites on their way */
function startRewrites(novelId, turnId, versionId, changeIds) {
  if (!changeIds.length) return;
  const run = async () => {
    for (const changeId of changeIds) {
      const c = changeAt(novelId, turnId, versionId, changeId);
      if (!c || c.status !== 'writing' || !c.rewrite) continue;
      /* his own page first: a rewrite waits until the writer is free */
      while (writerBusy(novelId)) await new Promise((r) => setTimeout(r, 500));
      if (!changeAt(novelId, turnId, versionId, changeId)) continue;
      let out;
      try { out = await writerRewrite({ novelId, chapterId: c.rewrite.chapterId, passageId: c.rewrite.passageId, note: c.rewrite.note }); } catch (e) { out = { ok: false, error: (e && e.message) || String(e) }; }
      const now = changeAt(novelId, turnId, versionId, changeId);
      if (!now || now.status !== 'writing') continue;
      if (out && out.ok && out.versionId) {
        const ch = store.peek('chapter', c.rewrite.chapterId);
        const p = ch && (ch.passages || []).find((x) => x.id === c.rewrite.passageId);
        const v = p && (p.versions || []).find((x) => x.id === out.versionId);
        patchChange(novelId, turnId, versionId, changeId, { status: 'made', undo: { what: 'passage', chapterId: c.rewrite.chapterId, passageId: c.rewrite.passageId, versionId: out.versionId, from: out.from }, after: String((v && v.text) || ''), said: cutShort(v || out) });
        afterChanges(novelId);
      } else patchChange(novelId, turnId, versionId, changeId, { status: 'refused', said: (out && (out.error || (out.stopped ? 'the writer was stopped' : ''))) || 'the writer could not write it' });
    }
  };
  const prior = rewriting.get(novelId) || Promise.resolve();
  /* the chain done, what another window left being written is looked at (settleWriting waits for the chain) */
  const next = prior.then(run, run).finally(() => { if (rewriting.get(novelId) === next) { rewriting.delete(novelId); settleWriting(novelId); } });
  rewriting.set(novelId, next);
}
/* a version the writer left cut, said on the card */
const cutShort = (v) => (v && v.cut ? `cut short${v.cutWhy ? ` — ${v.cutWhy}` : ''}` : '');
function changeAt(novelId, turnId, versionId, changeId) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && (t.versions || []).find((x) => x.id === versionId);
  return ((v && v.changes) || []).find((c) => c.id === changeId) || null;
}
function patchChange(novelId, turnId, versionId, changeId, patch) {
  store.change('talk', novelId, (d) => {
    const t = (d.turns || []).find((x) => x.id === turnId);
    const v = t && (t.versions || []).find((x) => x.id === versionId);
    if (!v) return;
    v.changes = (v.changes || []).map((c) => (c.id === changeId ? { ...c, ...patch } : c));
  }, { now: true });
}
/* a rewrite left being written by a window that closed (the chapter put right
 * first — writer.repairStale marks what it left cut, or takes an empty version
 * out): made, when its version is there with words — cut short, said so; nothing
 * there and nothing streaming, said; still streaming in another window, left.
 * Never while this window's own chain runs: those are its to settle. */
export function settleWriting(novelId) {
  const rec = store.peek('talk', novelId);
  if (!rec || rewriting.has(novelId)) return 0;
  let n = 0;
  for (const t of rec.turns || []) {
    for (const v of t.versions || []) {
      for (const c of v.changes || []) {
        if (c.status !== 'writing' || !c.rewrite) continue;
        const ch = store.peek('chapter', c.rewrite.chapterId);
        const p = ch && (ch.passages || []).find((x) => x.id === c.rewrite.passageId);
        const done = p && (p.versions || []).find((x) => x.how === 'rewrite' && x.from === c.rewrite.from && x.ask && x.ask.note === c.rewrite.note && !x.streaming && String(x.text || '').trim());
        if (done) patchChange(novelId, t.id, v.id, c.id, { status: 'made', undo: { what: 'passage', chapterId: c.rewrite.chapterId, passageId: c.rewrite.passageId, versionId: done.id, from: c.rewrite.from }, after: String(done.text || ''), said: cutShort(done) });
        else if (!(p && (p.versions || []).some((x) => x.streaming))) patchChange(novelId, t.id, v.id, c.id, { status: 'refused', said: 'the writer was interrupted before it was written — ask again' });
        else continue;
        n++;
      }
    }
  }
  return n;
}

/* a missed change made in a later round of the same answer: the miss no longer stands */
function supersede(novelId, turnId, versionId) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && t.versions.find((x) => x.id === versionId);
  const list = (v && v.changes) || [];
  const keysOf = (c) => [targetOf(c.op, c.where), targetOf(c.op)].filter(Boolean);
  let any = false;
  const next = list.map((c, i) => {
    if (c.status !== 'refused' || c.superseded) return c;
    const keys = keysOf(c);
    const later = keys.length && list.slice(i + 1).some((x) => (x.status === 'made' || x.status === 'waiting') && keysOf(x).some((k) => keys.includes(k)));
    if (!later) return c;
    any = true;
    return { ...c, superseded: true };
  });
  if (any) store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes: next }), { now: true });
}

/* a newer answer's waiting change for the same thing, written whole (a passage
 * anew, a card's words, a summary, a module): the older one is left — a card
 * change only when the newer one writes one of the same parts of it */
function asideOlder(novelId, turnId, fresh) {
  const whole = fresh.filter((c) => c.op && (c.op.find === undefined) && targetOf(c.op, c.where));
  if (!whole.length) return;
  const clash = (older) => whole.some((n) => {
    if (targetOf(n.op, n.where) !== targetOf(older.op, older.where)) return false;
    const a = fieldsOf(n.op);
    const b = fieldsOf(older.op);
    return !a || !b || a.some((f) => b.includes(f));
  });
  const rec = store.peek('talk', novelId);
  for (const t of (rec && rec.turns) || []) {
    if (t.id === turnId) continue;
    for (const v of t.versions || []) {
      const list = v.changes || [];
      if (!list.some((c) => c.status === 'waiting' && !c.copied && targetOf(c.op, c.where) && clash(c))) continue;
      const next = list.map((c) => (c.status === 'waiting' && !c.copied && targetOf(c.op, c.where) && clash(c) ? { ...c, status: 'skipped', said: 'replaced by a newer answer’s change to the same', aside: true } : c));
      store.change('talk', novelId, turnSteps.setVersion(t.id, v.id, { changes: next }), { now: true });
    }
  }
}
/* why an answer came back cut, in plain words */
function cutWords(out) {
  if (out.stopped) return 'you stopped it';
  if (out.cutBy === 'length') return 'it ran out of room — a larger Longest reply on its connection gives it more';
  if (out.cutBy === 'filter') return `the provider stopped it${out.reason ? ` (its reason: ${out.reason})` : ''}`;
  if (out.cutBy === 'provider') return 'the provider broke off partway';
  if (out.cutBy === 'quiet') return 'it ended without the provider saying it was finished';
  if (out.cutBy === 'closed') return 'the structured answer closed mid-sentence — a quote written bare ends its text';
  if (out.cutBy === 'stalled') return 'the structured answer stopped making progress, so it was let go';
  return 'it stopped partway';
}

/* a change that could not be made for its place or its words (not there,
 * there twice, no such passage, chapter, card or module): told back once */
const MISSED = /not there|more than one place|has no passage|there is no chapter|not a passage number|not a chapter number|passage number has to be given|only in short|only by its first line|no module called|more than one module|in the notes$|stand nowhere|no .* in the notes|more than one card goes by|is no name|gave nothing to write|changes block could not be read/i;
/* A change said to be made, with no block for it (Cozy Tavern's M118): the
 * partner saying it changed something — first person ("I've changed the
 * lamp…", "I rewrote passage 3"), or "now reads", or "the change is made".
 * Quoted words are the story's, never a claim; "I've added four directions
 * below", "it's changed everything for Oda" or "that's done well" are talk:
 * "added" and "made" claim only with a part of the book ("I've added a line
 * to passage 2", "I've made the changes"). */
const BOOK_PART = String.raw`(?:the |that |this |those |these |your |its |his |her |their |a |an |some )?(?:[\p{L}’'-]+ ){0,2}?(?:passages?|chapters?|notes?|cards?|summary|summaries|names?|title|subtitle|module|book|lines?|scenes?|text|wording|words|paragraphs?|opening|ending|dialogue|sentences?|changes?|edits?|fix(?:es)?|corrections?)\b`;
const CHANGE_VERBS = 'changed|updated|rewritten|rewrote|edited|fixed|corrected|replaced|removed|taken out|cut|renamed|trimmed|tightened';
const CLAIM_WORDS = [
  /* "I've changed the lamp…", "I rewrote passage 3", "I've added a line to passage 2" */
  new RegExp(String.raw`\bI(?:['’]ve| have)?\s+(?:now\s+|also\s+|just\s+|gone ahead and\s+)?(?:(?:${CHANGE_VERBS})\b|(?:added|made)\s+${BOOK_PART})`, 'iu'),
  /* "Done — Mira is nineteen now.", "Done.", "Updated Mira to nineteen." (Cozy Tavern's M118: a line beginning
   * "Done") — "Done" and "All set" standing on their own: "Done reading" is no change made */
  /^\W*(?:(?:done|all set)(?=\s*(?:[.!:;,—–-]|$))|(?:updated|changed|fixed|rewritten|renamed|removed|corrected)\b)/i,
  /* "Mira's card has been updated", "the opening is now fixed" */
  new RegExp(String.raw`${BOOK_PART}\s+(?:has|have)\s+been\s+(?:${CHANGE_VERBS})\b|\b(?:is|are)\s+now\s+(?:${CHANGE_VERBS})\b`, 'iu'),
  /\b(?:now reads|now says)\b/i,
  /\b(?:the |that |your )?(?:change|edit|fix|correction)s? (?:is |are |has been |have been |was |were )?(?:done|applied|made|in place)\b/i,
];
/* …but never a sentence that only supposes it, says it was not done, or
 * speaks of a change made before this answer or of other work (Cozy Tavern's
 * M126: a question or a thought aloud is no order, and the note that follows
 * would push the partner to make it) */
const NOT_A_CLAIM = new RegExp(String.raw`\b(?:if|had I|would|could|should|might|whether|suppose|imagine|unless)\b|\bI\s+(?:have\s+not|haven['’]t|did\s+not|didn['’]t|won['’]t|can['’]t|cannot|couldn['’]t|never)\b|\b(?:${CHANGE_VERBS})\s+(?:nothing|none)\b|\b(?:nothing|none)\s+(?:of\s+it\s+)?(?:has\s+been|was|is)\s+(?:${CHANGE_VERBS})\b|\bnot\s+(?:yet\s+)?(?:been\s+)?(?:${CHANGE_VERBS})\b|\b(?:last time|previously|already|yesterday|earlier,? I|since I|in (?:my|an|the) (?:last|earlier|previous|other) (?:answer|reply|message))\b|\bchanged (?:my|your|his|her) (?:mind|view|thinking)\b|\b(?:my|your) own (?:first |earlier |old )?(?:draft|work|version|book|story|manuscript|writing)\b|\b(?:my|your) (?:first|earlier|old) (?:draft|version|manuscript)\b|\bwhen I\b`, 'i');
export function claimsChange(prose) {
  const unquoted = String(prose || '').replace(/"[^"\n]{0,400}"|“[^”\n]{0,400}”|‘[^’\n]{0,200}’|(?<![\p{L}])'[^'\n]{0,200}'(?![\p{L}])/gu, ' ');
  return unquoted.split(/(?<=[.!…])\s+|\n+/).some((sentence) => {
    const t = sentence.trim();
    if (!t || /\?\s*$/.test(t)) return false;
    return CLAIM_WORDS.some((re) => re.test(t)) && !NOT_A_CLAIM.test(t);
  });
}
function missedWords(list) {
  return `Some of your changes couldn’t be made: ${list.map((c) => `${c.label} — ${c.said}`).join('; ')}. Give a changes block again for just those, quoting exactly what stands there now — enough of it to be found in one place only (a chapter you only have in short, read it whole first) — or say plainly that you’re leaving them. Don’t repeat the ones that were made.`;
}
const NOTHING_HAPPENED = 'Your last answer reads as if it made a change, but it holds no changes block, and a change happens only through the block — so that answer changed nothing (what your earlier answers changed stands in the book as you see it). Your words stay as they are; I am asking only for the block. If you meant to make a change now, send the changes block alone, quoting exactly the words you change, and nothing else. If no change was meant — I asked a question, you spoke of a change made earlier, you were thinking aloud — reply with the one word NOTHING and nothing else. If a change was asked and no block can make it, say so in one line, without saying it was done.';
/* the one word NOTHING — or a short line beginning with it (“Nothing — you asked a question”) */
const NOTHING_MEANT = /^\W*nothing\b[^\n]{0,60}$/i;
const ASKING_BLOCK = 'Asking it for the block of the change it described…';
function afterChanges(novelId) {
  recount(novelId);
  /* a version brought back brings its own notes back (readings.js) */
  archivist.settle(novelId);
  archivist.nudge(novelId, 3000);
}

/* whether a waiting change could still be made now: '' or why not (drawn under it) */
export function waitingWhy(novelId, change) {
  if (!change || change.status !== 'waiting') return '';
  /* one of a group is made with the others of it: looked at with them */
  if (change.group) {
    const rec = store.peek('talk', novelId);
    const list = ((rec && rec.turns) || []).flatMap((t) => t.versions || []).map((v) => v.changes || []).find((l) => l.some((c) => c.id === change.id)) || [change];
    const members = list.filter((c) => c.group === change.group && c.status === 'waiting');
    const r = makeTogether(novelId, members.map((c) => c.op), { ids: members.map((c) => c.id), dry: true }).find((x) => x.id === change.id);
    return r && r.status === 'refused' ? (r.said || 'it could not be made') : '';
  }
  return driftOf(novelId, change) || whyNot(novelId, change.op, { where: change.where || null });
}

/* one waiting change made, one made change undone, one waiting change left */
export function applyChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'apply'); }
export function undoOneChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'undo'); }
export function skipChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'skip'); }
/* Edit by hand: a waiting change made with his words in place of its own (changes.js editableOf) */
export function applyEdited(novelId, turnId, versionId, changeId, patch) { return settleOne(novelId, turnId, versionId, changeId, 'apply', patch); }
/* EVERYTHING WAITING IN THE CONVERSATION (2.12.9). Set to wait, the partner's
 * changes gather answer by answer — seven in one, six in the next — and he
 * asked, rightly, what he was meant to press. One answer: the conversation's
 * own Apply all, in the partner's foot, which makes every change still
 * waiting in it, the oldest answer first and each answer in its order (a
 * newer answer that writes the same thing whole has set the older one aside
 * already — asideOlder — so one proposal stands for a thing). Leave all leaves
 * them all. The buttons under one answer say their own scope — Apply these 6. */
export function waitingAll(novelId) {
  const rec = store.peek('talk', novelId);
  const out = [];
  for (const t of (rec && rec.turns) || []) {
    if (t.by !== 'ai') continue;
    const v = picked(t);
    for (const c of (v && v.changes) || []) if (c.status === 'waiting' && !c.copied && !c.superseded) out.push({ turnId: t.id, versionId: v.id, change: c, stale: Boolean(waitingWhy(novelId, c)) });
  }
  return out;
}
export function settleWaiting(novelId, how) {
  const out = { done: 0, failed: [], partly: [] };
  const seen = new Set();
  for (const w of waitingAll(novelId)) {
    const key = `${w.turnId}/${w.versionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = settleAll(novelId, w.turnId, w.versionId, how);
    out.done += r.done; out.failed.push(...r.failed); out.partly.push(...r.partly);
  }
  return out;
}
/* every change of one answer at once: Apply these, Leave these, Undo these (the newest made first) */
export function settleAll(novelId, turnId, versionId, how) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && t.versions.find((x) => x.id === versionId);
  const want = how === 'undo' ? 'made' : 'waiting';
  const ids = ((v && v.changes) || []).filter((c) => c.status === want && !c.copied).map((c) => c.id);
  if (how === 'undo') ids.reverse();
  const out = { done: 0, failed: [], partly: [] };
  for (const id of ids) {
    /* one made or undone with another of its group already is done with */
    const cur = (((store.peek('talk', novelId) || {}).turns || []).find((x) => x.id === turnId) || { versions: [] }).versions.find((x) => x.id === versionId);
    const now = ((cur && cur.changes) || []).find((c) => c.id === id);
    if (!now || now.status !== want) continue;
    const r = settleOne(novelId, turnId, versionId, id, how);
    if (r.ok) { out.done++; if (r.partly) out.partly.push(r.said); } else out.failed.push(r.said || 'it could not be done');
  }
  return out;
}
function settleOne(novelId, turnId, versionId, changeId, how, patch = null) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && t.versions.find((x) => x.id === versionId);
  const list = (v && v.changes) || [];
  const i = list.findIndex((c) => c.id === changeId);
  if (i < 0) return { ok: false, said: 'that change is not there any more' };
  const c = list[i];
  /* copied from another conversation: it is that conversation's to apply or undo */
  if (c.copied) return { ok: false, said: 'that change is the conversation’s it was made in — undo or apply it there' };
  const write = (changes) => store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes }), { now: true });
  /* a change made fresh on Apply keeps how it was last told to the partner — so its being applied since is news */
  const told = (x) => (x.toldAs !== undefined ? { toldAs: x.toldAs } : {});
  /* one of a group is applied, left or undone with the others of it — a
   * swap is never made, or taken back, by half */
  if (c.group && c.status === 'waiting' && (how === 'apply' || how === 'skip')) {
    const members = list.filter((x) => x.group === c.group && x.status === 'waiting');
    let byId;
    if (how === 'skip') byId = new Map(members.map((x) => [x.id, { ...x, status: 'skipped' }]));
    else {
      const made = makeTogether(novelId, members.map((x) => (x.id === c.id && patch ? withEdits(x.op, patch) : x.op)), { ids: members.map((x) => x.id) });
      byId = new Map(made.map((r, j) => [members[j].id, { ...r, group: c.group, ...told(members[j]), ...(patch && members[j].id === c.id ? { edited: true } : {}) }]));
    }
    write(list.map((x) => byId.get(x.id) || x));
    const mine = byId.get(c.id);
    if (how === 'apply' && [...byId.values()].some((x) => x.status === 'made')) afterChanges(novelId);
    return { ok: mine.status !== 'refused', said: mine.said, change: mine };
  }
  const leader = c.with ? list.find((x) => x.id === c.with) : c;
  if (how === 'undo' && c.status === 'made' && leader && leader !== c) return settleOne(novelId, turnId, versionId, leader.id, 'undo');
  let next = c;
  /* written whole over a thing changed since it was offered: said, never made (his own words by hand are his to put) */
  const drift = how === 'apply' && c.status === 'waiting' && !patch ? driftOf(novelId, c) : '';
  /* the others of this answer still waiting for the same thing — or for it by the new name this one gives it — as it
   * stood when they were offered: this one making or changing it is the answer's own doing, never a change since, and
   * they are watched from what it leaves (an entry made and then added to, a card made and then moved, renamed and
   * then changed under its new name). One it takes out is gone for them too (said as changed since). M422 is for
   * changes made by anyone else. */
  const keys = [targetOf(c.op, c.where), renamedTarget(c.op)].filter(Boolean);
  const inStep = how === 'apply' && c.status === 'waiting' && keys.length
    ? list.filter((x) => x !== c && x.status === 'waiting' && !x.copied && !x.group && x.base && keys.includes(targetOf(x.op, x.where)) && !driftOf(novelId, x))
    : [];
  const rebased = (x) => {
    const now = baseOf(novelId, x.op, x.where || null);
    return now && !(x.base !== 'none' && now === 'none') ? { ...x, base: now, rebased: { by: c.id, base: x.base } } : x;
  };
  const at = c.where ? { where: c.where } : {};
  if (drift) next = { ...c, status: 'refused', said: drift };
  else if (how === 'apply' && c.status === 'waiting') next = patch ? { ...makeChange(novelId, withEdits(c.op, patch), { id: c.id, where: c.where || null }), ...at, ...told(c), edited: true } : { ...makeChange(novelId, c.op, { id: c.id, where: c.where || null }), ...at, ...told(c) };
  else if (how === 'skip' && c.status === 'waiting') next = { ...c, status: 'skipped' };
  else if (how === 'undo' && c.status === 'made') {
    /* a passage it wrote anew, read by the helper since: those words are kept for the helper, so what came only from them goes too */
    if (c.undo && c.undo.what === 'passage') archivist.retireIfSeen(novelId, c.undo.chapterId, c.undo.passageId, c.undo.versionId);
    const u = undoChange(novelId, c);
    if (!u.ok) return u;
    /* put back where it still read as the change left it; what was changed since stays — and he is told */
    next = { ...c, status: 'undone', ...(u.said ? { undoneSaid: u.said } : {}) };
  } else return { ok: false, said: 'nothing to do' };
  /* the others made with it are taken back with it */
  /* and when it is undone, they are watched from where it found it again */
  const unbased = (x) => { const { rebased: was, ...rest } = x; return { ...rest, base: was.base }; };
  const changes = list.map((x, k) => (k === i ? next : next.status === 'undone' && x.with === c.id && x.status === 'made' ? { ...x, status: 'undone' }
    : next.status === 'made' && inStep.includes(x) ? rebased(x)
      : next.status === 'undone' && x.status === 'waiting' && x.rebased && x.rebased.by === c.id ? unbased(x) : x));
  write(changes);
  if (next.status === 'made' || next.status === 'undone') afterChanges(novelId);
  if (next.status === 'writing') startRewrites(novelId, turnId, versionId, [next.id]);
  if (how === 'undo') return { ok: true, said: next.undoneSaid || '', partly: Boolean(next.undoneSaid), change: next };
  return { ok: next.status !== 'refused', said: next.said, change: next };
}

/* ------------------------------------------------------------- partner */

export async function ensureTalk(novelId) {
  let t = await store.open('talk', novelId);
  if (!t) t = await store.create('talk', novelId, { id: novelId, novelId, convId: newId('cv'), turns: [], updated: Date.now() });
  if (t && !t.convId) {
    /* A draft belongs to a conversation even before its first message.
     * Older records gain an identity once; a newer window's identity wins. */
    const convId = newId('cv');
    store.change('talk', novelId, (d) => { if (!d.convId) d.convId = convId; }, { now: true });
    await store.flush('talk', novelId);
    t = store.peek('talk', novelId);
  }
  return t;
}

/* His message, and the partner's answer to it. A message whose answer did
 * not come is taken back off (and handed back for the box), so sending it
 * again sends it once. */
/* the book's scenes, open in this window — a rename everywhere reaches them */
export async function loadPlays(novelId) {
  const novel = store.peek('novel', novelId);
  for (const pid of (novel && novel.plays) || []) if (!store.peek('play', pid)) await store.open('play', pid).catch(() => null);
}
export async function partnerSay({ novelId, chapterId, text }) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: '' };
  let rec;
  try { rec = { convId: (await ensureTalk(novelId)).convId || null }; await loadPlays(novelId); }
  catch (e) { return { ok: false, error: (e && e.message) || String(e), giveBack: t }; }
  if (talkBusy('talk', novelId)) return { ok: false, error: 'a reply is already on its way — Stop it first', giveBack: t };
  const current = store.peek('talk', novelId);
  if (!current || !store.peek('novel', novelId) || (rec.convId || null) !== (current.convId || null)) return { ok: false, error: 'the conversation changed while it was opening', giveBack: t };
  /* what came of its changes, told with this message and kept with it as told (his report, 2.12.2: it took a change
   * it had made for one still waiting) — the answer before's, what changed since of the others', and what the answers
   * he asked again for left in the book */
  const news = changesNews(novelId, current, heldCut.get(novelId));
  const mine = newTurn('you', t, news.told ? { told: news.told } : {});
  const reply = newTurn('ai', '', { streaming: true });
  store.change('talk', novelId, inConversation(rec, turnSteps.addTurn(mine)));
  store.change('talk', novelId, inConversation(rec, turnSteps.addTurn(reply)), { now: true });
  const out = await runTurn({ kind: 'talk', id: novelId, novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'partner',
    buildArgs: (rec, c, share) => ({ purpose: 'partner', target: { chapterId }, turns: turnsFor(rec, { upto: reply.id, conn: c, share }), request: '', moment: hisLast(rec, reply.id) }) });
  if (out.gone) return { ...out, giveBack: t };
  if (!out.ok && !replied('talk', novelId, reply.id)) {
    try { store.change('talk', novelId, turnSteps.removeTurn(mine.id), { now: true }); } catch (_) { /* gone */ }
    /* asked again after Edit and ask again, and no answer came: what it let go is back as it was (unless the talk moved on since) */
    const held = heldCut.get(novelId);
    const rec = store.peek('talk', novelId);
    if (held && rec && (rec.convId || '') === held.convId && (rec.turns || []).length === held.i) {
      store.change('talk', novelId, convSteps.putBack(held.convId, held.i, held.cut), { now: true });
      heldCut.delete(novelId);
      return { ...out, giveBack: t, putBack: true };
    }
    return { ...out, giveBack: t };
  }
  heldCut.delete(novelId);
  /* told: each change marked as it stood when this message went (an answer that never came tells it again next time) */
  store.change('talk', novelId, inConversation(rec, (d) => markTold(d, news.marks)), { now: true });
  return out;
}
/* What came of the partner's changes, for his next message: the answer
 * right before it — every change of it, as it stands; the others' — each
 * that changed since it was last told (applied, undone, left, or no longer
 * on the page: he put back the words before, or another version is on
 * show); and what the answers he let go with Edit and ask again made, still
 * in the book. {told, marks} */
function changesNews(novelId, rec, held = null) {
  const turns = (rec && rec.turns) || [];
  const lastAi = [...turns].reverse().find((t) => t.by === 'ai');
  const parts = [];
  const before = lastAi ? outcomeWords((picked(lastAi) || {}).changes, novelId) : '';
  if (before) parts.push(before);
  const since = [];
  for (const t of turns) {
    if (t.by !== 'ai' || t === lastAi) continue;
    for (const c of (picked(t) || {}).changes || []) {
      if (!c || c.superseded || c.copied) continue;
      /* (one kept from before 2.12.2, never marked: the message after its answer says where it stands now, as it always did) */
      if (c.toldAs === undefined) continue;
      if (c.toldAs === statusNow(novelId, c)) continue;
      since.push(c);
    }
  }
  if (since.length) parts.push(`(Since then, of your earlier changes: ${since.slice(-12).map((c) => sinceWords(novelId, c)).join('; ')}${since.length > 12 ? `; and ${since.length - 12} more` : ''}.)`);
  if (held && held.convId === ((rec && rec.convId) || null)) {
    const kept = (held.cut || []).filter((t) => t.by === 'ai').flatMap((t) => (t.versions || []).flatMap((v) => v.changes || [])).filter((c) => c && c.status === 'made' && !c.superseded && !madeGone(novelId, c));
    if (kept.length) parts.push(`(The answers I asked again for made these changes, and the book has them now: ${kept.slice(-12).map((c) => `${c.label}${changeShort(c)}`).join('; ')}${kept.length > 12 ? `; and ${kept.length - 12} more` : ''}.)`);
  }
  /* how each change of the talk stands as this is told */
  const marks = [];
  for (const t of turns) {
    if (t.by !== 'ai') continue;
    for (const v of t.versions || []) for (const c of v.changes || []) if (c && !c.copied) marks.push([t.id, v.id, c.id, statusNow(novelId, c)]);
  }
  return { told: parts.join('\n\n'), marks };
}
/* each change marked as it was told */
function markTold(d, marks) {
  for (const [tid, vid, cid, as] of marks || []) {
    const t = (d.turns || []).find((x) => x.id === tid);
    const v = t && (t.versions || []).find((x) => x.id === vid);
    const c = v && (v.changes || []).find((x) => x.id === cid);
    if (c) c.toldAs = as;
  }
}

/* the label of a chapter by a passage's number ("1.2" → "Chapter One"), as read rows are labelled */
function chapterLabelOf(novelId, n) {
  const novel = store.peek('novel', novelId);
  const id = novel && (novel.order || [])[Number(String(n).split('.')[0]) - 1];
  const c = id && store.peek('chapter', id);
  return c ? chapterLabel(novel, c) : '\u0000';
}
/* did any words of this reply stay? */
function replied(kind, id, turnId) {
  const rec = store.peek(kind, id);
  return Boolean(rec && (rec.turns || []).some((x) => x.id === turnId));
}

/* ---------------------------------------------------------------- ideas */
/* A few premises for what happens next (Settings → Who does what → Ideas),
 * asked of the partner's connection with the whole book — never kept in the
 * conversation: a tap puts one in the box under the page. */
export async function nextIdeas({ novelId, chapterId, count = 4, signal = null, not = [] }) {
  const house = store.peek('house', 'house') || {};
  const conn = connFor(house, 'partner');
  if (!conn) return { ok: false, error: 'no connection is chosen for your partner yet — Settings → Connections' };
  ideasAsked++;
  const out = await ask(conn, {
    build: (c) => {
      const { novel, chapters } = bookNow(novelId);
      const a = assemble({ house, novel, chapters, conn: c, purpose: 'partner', target: { chapterId }, turns: [], request: ideasRequest(count, { not }), tools: false });
      return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, 'scene') : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse, least: a.stats.least, seed: a.seed };
    },
    stream: true,
    signal,
    /* asked from a sheet he may close: on a leash, so a provider gone silent never holds the app (Cozy Tavern's M83-6) */
    leash: true,
    /* premises to choose from, never a page: no started reply, no page template (Tavern M328) */
    noPrefill: true,
    noStructured: true,
  }).finally(() => { ideasAsked--; });
  if (out.stopped) return { ok: false, stopped: true, error: 'stopped' };
  if (!out.ok) return { ok: false, error: out.error || 'no answer came' };
  const ideas = directionsIn(out.text).slice(0, Math.max(1, Math.min(5, count)));
  return ideas.length ? { ok: true, ideas } : { ok: false, error: 'it gave no premises — ask again' };
}

/* ------------------------------------------- the partner's conversations */
/* Cozy Tavern's housekeeper sessions, for a book (conversations.js). None of
 * it while a reply is being written — here or in another window — so a
 * reply never lands in a conversation that is no longer open. */

async function convReady(novelId) {
  const rec = await ensureTalk(novelId);
  if (!rec || !store.peek('novel', novelId)) return { error: 'that conversation is not there any more' };
  const convId = rec.convId || null;
  if (talkBusy('talk', novelId)) return { error: 'a reply is on its way — Stop it first' };
  await repairStaleTurns('talk', novelId);
  const now = store.peek('talk', novelId);
  if (!now || !store.peek('novel', novelId)) return { error: 'that conversation is not there any more' };
  if ((now.convId || null) !== convId) return { error: 'another conversation opened while this one was being read — try again' };
  if ((now.turns || []).some((t) => (t.versions || []).some((v) => v.streaming))) return { error: 'a reply is being written in another window — wait for it there' };
  return { rec: now };
}
/* Steps are replayed after a refused save. A different conversation may
 * have opened in another window by then: an action belongs to the one it
 * was asked in, never whichever happens to be open when the save lands. */
function inConversation(rec, step, unchanged = false) {
  const convId = (rec && rec.convId) || null;
  const turns = unchanged ? JSON.stringify((rec && rec.turns) || []) : null;
  return (d) => {
    if ((d.convId || null) !== convId || (unchanged && JSON.stringify(d.turns || []) !== turns)) return false;
    step(d);
    return true;
  };
}
/* Wait for any refused save to replay before calling the action done. A
 * destructive action also checks the turns: Undo only has the words that
 * were here when it was asked, so newer messages must stay untouched. */
async function keepConversation(novelId, rec, step, result, unchanged = false) {
  const apply = inConversation(rec, step, unchanged);
  let applied = false;
  store.change('talk', novelId, (d) => { applied = apply(d); }, { now: true });
  await store.flush('talk', novelId);
  return applied ? result : { ok: false, error: 'the conversation changed in another window — your words are still there; try again' };
}
const spareOf = (rec) => ({ spareId: rec.convId || newId('cv'), spareName: openName(rec), at: Date.now() });

export function partnerConversations(novelId) { return conversationsOf(store.peek('talk', novelId)); }

/* a fresh conversation; the open one stays in the list */
export async function newConversation(novelId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  if (!(rec.turns || []).length && !rec.named) return { ok: false, error: 'this conversation is a new one already' };
  const s = spareOf(rec);
  const name = freeName(rec, [s.spareName]);
  return keepConversation(novelId, rec, convSteps.fresh({ id: newId('cv'), name, ...s }), { ok: true, name });
}

/* another conversation opens; the open one stays in the list */
export async function openConversation(novelId, convId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  if (!(rec.convs || []).some((c) => c.id === convId)) return { ok: false, error: 'that conversation is not there any more' };
  return keepConversation(novelId, rec, convSteps.open({ id: convId, ...spareOf(rec) }), { ok: true });
}

/* a copy of the open conversation — whole, or up to one of its turns — opens; this one stays as it is */
export async function copyConversation(novelId, upto = null) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  if (!(rec.turns || []).length || (upto && !(rec.turns || []).some((t) => t.id === upto))) return { ok: false, error: 'there is nothing to copy' };
  const s = spareOf(rec);
  const name = markedName(s.spareName, upto ? 'branch' : 'copy', [s.spareName, ...(rec.convs || []).map((c) => c.name)]);
  return keepConversation(novelId, rec, convSteps.copy({ id: newId('cv'), name, upto, ...s }), { ok: true, name });
}

export async function renameConversation(novelId, name) {
  const n = cleanConvName(name);
  if (!n) return { ok: false, error: 'it needs a name' };
  const rec = await ensureTalk(novelId);
  if (!rec || !store.peek('novel', novelId)) return { ok: false, error: 'that conversation is not there any more' };
  if ((rec.convs || []).some((c) => c.name === n)) return { ok: false, error: `another conversation is called “${n}” already` };
  return keepConversation(novelId, rec, convSteps.rename(n), { ok: true });
}

/* Start over: the open conversation's talk goes (the changes it made stay in the book); Undo puts it back */
export async function startOver(novelId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  const turns = JSON.parse(JSON.stringify(rec.turns || []));
  const convId = rec.convId || newId('cv');
  return keepConversation(novelId, rec, (d) => { d.convId = convId; convSteps.clear()(d); },
    { ok: true, undo: () => store.change('talk', novelId, convSteps.unclear(convId, turns), { now: true }) }, true);
}

/* the open conversation goes from the list: the newest used of the others opens, or a new one; Undo opens it again */
export async function removeConversation(novelId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  const gone = { id: rec.convId || newId('cv'), name: openName(rec), ...(rec.named ? { named: true } : {}), at: Date.now(), turns: JSON.parse(JSON.stringify(rec.turns || [])) };
  const next = conversationsOf(rec).others[0];
  return keepConversation(novelId, rec, convSteps.remove({ nextId: next ? next.id : null, freshId: newId('cv'), freshName: freeName(rec, [gone.name]) }),
    { ok: true, name: gone.name, undo: () => store.change('talk', novelId, convSteps.unremove(gone, { at: Date.now() }), { now: true }) }, true);
}

/* Edit and ask again: his message and everything after it are let go, his
 * words handed back for the box; Undo puts them back while nothing was said since */
export async function editAndAskAgain(novelId, turnId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  const list = rec.turns || [];
  const i = list.findIndex((t) => t.id === turnId);
  if (i < 0 || list[i].by !== 'you') return { ok: false, error: 'that message is not there any more' };
  const text = String((picked(list[i]) || {}).text || '');
  const cut = JSON.parse(JSON.stringify(list.slice(i)));
  const convId = rec.convId || newId('cv');
  const out = await keepConversation(novelId, rec, (d) => { d.convId = convId; convSteps.cutFrom(turnId)(d); }, { ok: true }, true);
  if (!out.ok) return out;
  /* until a new answer has come, what was let go is held: an ask that brings no answer puts it back as it was */
  heldCut.set(novelId, { convId, i, cut, at: Date.now() });
  return { ok: true, text, undo: () => { heldCut.delete(novelId); store.change('talk', novelId, convSteps.putBack(convId, i, cut), { now: true }); } };
}
const heldCut = new Map();       /* novelId -> what Edit and ask again let go, until an answer comes */

/* Another answer to the same message. */
export async function partnerAgain({ novelId, chapterId, turnId }) {
  const rec = await store.open('talk', novelId);
  const t = rec && rec.turns.find((x) => x.id === turnId);
  if (!t || t.by !== 'ai') return { ok: false, error: '' };
  /* only the newest: the talk after an older one answered what it said (M73) */
  if (rec.turns[rec.turns.length - 1].id !== turnId) return { ok: false, error: 'only the newest answer can be asked again — for an older one, use Edit and ask again on your message before it' };
  if (talkBusy('talk', novelId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const v = newVersion({ streaming: true });
  store.change('talk', novelId, inConversation(rec, turnSteps.addVersion(turnId, v)), { now: true });
  return runTurn({ kind: 'talk', id: novelId, novelId, turnId, versionId: v.id, role: 'partner',
    buildArgs: (r, c, share) => ({ purpose: 'partner', target: { chapterId }, turns: turnsFor(r, { upto: turnId, conn: c, share }), request: '', moment: hisLast(r, turnId) }) });
}

/* ---------------------------------------------------------------- play */

/* A new scene: who he plays, where it starts. It picks up where the chapter
 * stands right now. */
export async function newPlay({ novelId, chapterId, who, from = '' }) {
  const id = newId('pl');
  const chapter = store.peek('chapter', chapterId);
  const after = chapter && chapter.passages.length ? chapter.passages[chapter.passages.length - 1].id : '^';
  const play = { id, novelId, chapterId, after, who: String(who || '').trim(), from: String(from || '').trim(), title: '', turns: [], turned: null, created: Date.now(), updated: Date.now() };
  await store.create('play', id, play);
  store.change('novel', novelId, novelSteps.addPlay(id), { now: true });
  return id;
}

/* A scene whose prose has left the book (its passage taken out, to redo
 * it) lets go of "written into the book up to here": the talk it covered
 * rides again as the scene, and Turn it into prose takes it again; one whose
 * prose moved to another chapter follows it — as does a scene's original
 * starting point, before any prose has been made (Cozy Tavern's M44: a hole
 * never left in what is handed on). True when it changed. */
export function mendScene(playId) {
  const p = store.peek('play', playId);
  if (!p || !p.after || p.after === '^') return false;
  const novel = store.peek('novel', p.novelId);
  if (!novel) return false;
  for (const cid of novel.order || []) {
    const c = store.peek('chapter', cid);
    if (!c) return false;
    if ((c.passages || []).some((x) => x.id === p.after)) {
      if (cid === p.chapterId) return false;
      store.change('play', playId, turnSteps.set({ chapterId: cid }), { now: true });
      return true;
    }
  }
  store.change('play', playId, turnSteps.set({ turned: null, after: null }), { now: true });
  return true;
}

function playArgs(playRec, upto) {
  return (rec, c) => {
    const p = rec || playRec;
    const opening = playOpening({ who: p.who });
    /* what was already turned into prose rides as the book, not again as the talk */
    const turns = turnsFor(p, { upto, conn: c, openWith: p.turned ? '' : opening, after: p.turned || null });
    const target = { chapterId: p.chapterId, through: p.after || undefined };
    /* his last moves, his words only: what wakes a rule */
    const moment = hisLast(p, upto);
    /* the narrator opens the scene when he has not said anything yet — or,
     * once what was played is in the book, carries it on from there */
    if (!turns.length) return { purpose: 'play', play: p, target, turns: [], request: p.turned ? playOnwards({ who: p.who }) : opening, moment };
    /* the narrator spoke last and he said nothing: it carries on */
    if (turns[turns.length - 1].role === 'assistant') return { purpose: 'play', play: p, target, turns, request: 'Go on.', moment };
    return { purpose: 'play', play: p, target, turns, request: '', moment };
  };
}

/* His move in the scene (or nothing, to have the narrator begin), with — or
 * only — a line for the narrator about how the telling should go, and the
 * narrator's answer. */
export async function playSay({ playId, text, tell = '' }) {
  const t = String(text || '').trim();
  const tl = String(tell || '').trim();
  const giveBack = { giveBack: t, giveBackTell: tl };
  let p;
  try { p = await store.open('play', playId); }
  catch (e) { return { ok: false, error: (e && e.message) || String(e), ...giveBack }; }
  if (!p || !store.peek('novel', p.novelId)) return { ok: false, error: 'that scene is not there any more', ...giveBack };
  if (mendScene(playId)) p = store.peek('play', playId);
  if (talkBusy('play', playId)) return { ok: false, error: 'a reply is already on its way — Stop it first', ...giveBack };
  const mine = t || tl ? newTurn('you', t, tl ? { tell: tl } : {}) : null;
  if (mine) store.change('play', playId, turnSteps.addTurn(mine));
  const reply = newTurn('ai', '', { streaming: true });
  store.change('play', playId, turnSteps.addTurn(reply), { now: true });
  const out = await runTurn({ kind: 'play', id: playId, novelId: p.novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'writer', length: 'paragraphs',
    buildArgs: playArgs(p, reply.id) });
  if (out.gone) return { ...out, ...giveBack };
  if (!out.ok && mine && !replied('play', playId, reply.id)) {
    try { store.change('play', playId, turnSteps.removeTurn(mine.id), { now: true }); } catch (_) { /* gone */ }
    return { ...out, giveBack: t, giveBackTell: tl };
  }
  return out;
}

export async function playAgain({ playId, turnId }) {
  const p = await store.open('play', playId);
  const t = p && p.turns.find((x) => x.id === turnId);
  if (!t || t.by !== 'ai') return { ok: false, error: '' };
  if (p.turns[p.turns.length - 1].id !== turnId) return { ok: false, error: 'only the newest telling can be asked again — the scene after an older one followed from it' };
  if (talkBusy('play', playId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const v = newVersion({ streaming: true });
  store.change('play', playId, turnSteps.addVersion(turnId, v), { now: true });
  return runTurn({ kind: 'play', id: playId, novelId: p.novelId, turnId, versionId: v.id, role: 'writer', length: 'paragraphs',
    buildArgs: playArgs(p, turnId) });
}

/* EDIT AND TRY AGAIN IN A SCENE (Cozy Tavern's "edit" and "try again", M27/M40): a scene is played the way his
 * tales are, so his move can be changed where it stands, the narrator's telling can be changed by his hand, and his
 * move can be answered afresh. Never on what is already written into the book ("written into the book up to here"):
 * that part is the book's now — taking out the passage it became lets the scene go back to before it (mendScene). */
function choicesBlockOf(text) {
  const t = String(text || '');
  const at = t.toLowerCase().indexOf(CHOICES_OPEN);
  if (at < 0) return '';
  const end = t.toLowerCase().indexOf(CHOICES_CLOSE, at);
  return t.slice(at, end >= 0 ? end + CHOICES_CLOSE.length : undefined).trim();
}
function turnedAt(p) { return p && p.turned ? (p.turns || []).findIndex((t) => t.id === p.turned) : -1; }
export function inBook(p, turnId) {
  const i = (p && p.turns ? p.turns : []).findIndex((t) => t.id === turnId);
  return i >= 0 && i <= turnedAt(p);
}

/* his move's words and his line to the narrator, changed where they stand — or the narrator's telling, changed by
 * his hand as a new version of it, the one before one arrow away. With Undo. */
export function editPlayTurn({ playId, turnId, text = '', tell = '' }) {
  const p = store.peek('play', playId);
  const t = p && (p.turns || []).find((x) => x.id === turnId);
  if (!t) return { ok: false, error: 'that part of the scene is not there any more' };
  if (inBook(p, turnId)) return { ok: false, error: 'that part is already written into the book — change it on the page' };
  if (talkBusy('play', playId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const v = picked(t);
  const words = String(text || '').replace(/\s+$/, '');
  if (t.by === 'you') {
    const line = String(tell || '').trim();
    if (!words.trim() && !line) return { ok: false, error: 'a move needs words — Remove takes it out' };
    const was = { text: v.text, tell: v.tell };
    store.change('play', playId, turnSteps.setVersion(t.id, v.id, { text: words.trim(), tell: line || undefined }), { now: true });
    return { ok: true, undo: () => { if (store.peek('play', playId)) store.change('play', playId, turnSteps.setVersion(t.id, v.id, { text: was.text, tell: was.tell || undefined }), { now: true }); } };
  }
  if (!words.trim()) return { ok: false, error: 'a telling needs words — Remove takes it out' };
  /* he edits the telling as it is drawn; the choices that came with it stay with it */
  const raw = String(v.text || '');
  if (words === sceneWords(raw)) return { ok: true, same: true, undo: () => {} };
  const block = choicesBlockOf(raw);
  const nv = newVersion({ text: block ? `${words}\n\n${block}` : words, how: 'edited' });
  store.change('play', playId, turnSteps.addVersion(t.id, nv), { now: true });
  return { ok: true, undo: () => { if (store.peek('play', playId)) store.change('play', playId, turnSteps.removeVersion(t.id, nv.id), { now: true }); } };
}

/* Try again on his move: the narrator answers it afresh. The telling right after it gets another version (the one
 * before one arrow away); whatever came after that telling is let go — onCut hands the Undo over at once, before the
 * answer comes. A move with no telling after it gets one. */
export async function playRetry({ playId, turnId, onCut = null }) {
  const p = await store.open('play', playId);
  const list = (p && p.turns) || [];
  const i = list.findIndex((t) => t.id === turnId);
  if (i < 0 || list[i].by !== 'you') return { ok: false, error: 'that move is not there any more' };
  if (inBook(p, turnId)) return { ok: false, error: 'that part is already written into the book — change it on the page' };
  if (talkBusy('play', playId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const next = list[i + 1] && list[i + 1].by !== 'you' ? list[i + 1] : null;
  const keep = next ? i + 2 : i + 1;
  const later = JSON.parse(JSON.stringify(list.slice(keep)));
  if (later.length) {
    store.change('play', playId, turnSteps.removeFrom(later[0].id), { now: true });
    const after = (next || list[i]).id;
    const undo = () => store.change('play', playId, (d) => {
      d.turns = d.turns || [];
      const back = later.filter((c) => !d.turns.some((t) => t.id === c.id));
      if (!back.length) return;
      const at = d.turns.findIndex((t) => t.id === after);
      d.turns.splice(at >= 0 ? at + 1 : d.turns.length, 0, ...JSON.parse(JSON.stringify(back)));
    }, { now: true });
    if (typeof onCut === 'function') onCut(undo, later.length);
  }
  if (next) return playAgain({ playId, turnId: next.id });
  const reply = newTurn('ai', '', { streaming: true });
  store.change('play', playId, turnSteps.addTurn(reply), { now: true });
  return runTurn({ kind: 'play', id: playId, novelId: p.novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'writer', length: 'paragraphs',
    buildArgs: playArgs(store.peek('play', playId) || p, reply.id) });
}

/* A reply being written when its window closed would show "…" forever: one
 * whose writer is gone (its tab closed in this browser, or no heartbeat for
 * two minutes) keeps what arrived, or goes when nothing did. */
export async function repairStaleTurns(kind, id) {
  const rec = store.peek(kind, id);
  if (!rec) return 0;
  if (kind === 'talk') settleWriting(id);
  const job = running.get(`${kind}/${id}`);
  const tabs = await store.liveTabs();
  let fixed = 0;
  for (const t of rec.turns || []) {
    for (const v of t.versions || []) {
      if (!v.streaming) continue;
      if (job && job.turnId === t.id && job.versionId === v.id) continue;
      const here = v.browser && v.browser === store.BROWSER && tabs;
      const gone = here ? !tabs.has(v.tab) : Date.now() - (v.beat || v.at || 0) > 2 * 60 * 1000;
      if (!gone) continue;
      if (!String(v.text || '').trim() && !String(v.thinking || '').trim()) {
        if (t.versions.length < 2) store.change(kind, id, turnSteps.removeTurn(t.id), { now: true });
        else store.change(kind, id, turnSteps.removeVersion(t.id, v.id), { now: true });
      } else store.change(kind, id, turnSteps.setVersion(t.id, v.id, { streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true, cutWhy: 'the reply stopped when its window closed' }), { now: true });
      fixed++;
    }
  }
  return fixed;
}

/* The scene so far as a transcript the writer can turn into prose: from the
 * last turn already written into the book (or the start), to the end. */
export function transcriptOf(play, { fromStart = false } = {}) {
  const turns = play.turns || [];
  let start = 0;
  if (!fromStart && play.turned) {
    const i = turns.findIndex((t) => t.id === play.turned);
    if (i >= 0) start = i + 1;
  }
  const who = play.who || 'their character';
  const lines = [];
  /* his own words in it — where he said it starts, his moves and his lines
   * to the narrator — what wakes a rule when it is written into prose
   * (writer.js), as they did while he played it (hisLast) */
  const mine = String(play.from || '').trim() ? [String(play.from).trim()] : [];
  /* only what the narrator has told: his moves after its last telling are
   * attempts no one has answered yet — they stay in the scene, for the
   * narrator, never written into the book as done (Cozy Tavern M110) */
  const rest = turns.slice(start);
  let told = -1;
  rest.forEach((t, i) => { if (t.by !== 'you' && sceneWords(String((picked(t) || {}).text || '')).trim()) told = i; });
  const upto = told >= 0 ? rest.slice(0, told + 1) : [];
  for (const t of upto) {
    const v = picked(t);
    /* what happened in it: his character's lines and the narrator's telling —
     * never his lines to the narrator, nor the ways it offered */
    const raw = String((v && v.text) || '');
    const text = (t.by === 'you' ? raw : sceneWords(raw)).trim();
    if (t.by === 'you') mine.push(...[text, String((v && v.tell) || '').trim()].filter(Boolean));
    if (!text) continue;
    lines.push(t.by === 'you' ? `${who}: ${text}` : `Narrator: ${text}`);
  }
  const waiting = rest.slice(told + 1).filter((t) => t.by === 'you' && String((picked(t) || {}).text || '').trim()).length;
  return { text: lines.join('\n\n'), mine: mine.join('\n'), lastId: upto.length ? upto[upto.length - 1].id : (start > 0 ? turns[start - 1].id : null), count: lines.length, waiting };
}
