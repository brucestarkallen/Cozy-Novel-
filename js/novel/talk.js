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
import { ask, emptyWhy, stripControlLeak } from '../model/call.js';
import { wireOf } from '../model/providers.js';
import { estimateTokens } from '../util.js';
import { assemble, requiredLength, SAFETY, partnerReply, PARTNER_FLOOR } from './context.js';
import { contextOf } from '../model/providers.js';
import { connFor, connName, recount } from './writer.js';
import { turnSteps, newTurn, newVersion, picked, novelSteps, chapterLabel, chapterText } from './shape.js';
import { newId, numberWords } from '../util.js';
import { playOpening, playOnwards, readBack, tellLine, sceneWords, ideasRequest, CHOICES_OPEN } from './prompts.js';
import { joinSoftWraps, mendMarks, dropGluedStrays, finishTail } from './textshape.js';
import { numberedText } from './context.js';
import { opsOf, readAsks, makeChange, undoChange, outcomeWords, labelOf, whyNot, wordsOf, withEdits, directionsIn, unreadableRead, targetOf, baseOf, driftOf } from './changes.js';
import { searchBook } from './search.js';
import { listModules } from './modules.js';
import { nameKey } from '../util.js';
import * as archivist from './archivist.js';
import { convSteps, conversationsOf, freeName, openName, cleanConvName, markedName } from './conversations.js';

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
 * (a scene already written into the book rides there, as the book). */
export function turnsFor(record, { upto = null, conn, openWith = '', after = null } = {}) {
  const out = [];
  const list = record.turns || [];
  const from = after ? list.findIndex((t) => t.id === after) + 1 : 0;
  /* what came of the partner's changes, told with his next message */
  let told = '';
  const scene = Boolean(record.who !== undefined || record.chapterId);
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
      out.push({ role: 'user', content: told ? `${told}\n\n${mine}` : mine });
      told = '';
    } else {
      out.push({ role: 'assistant', content: text });
      told = outcomeWords(v.changes);
    }
  }
  if (told && out.length && upto) {
    /* the answer asked for again: what came of the changes before it still rides */
    const last = out[out.length - 1];
    if (last.role === 'user') last.content = `${told}\n\n${last.content}`;
  }
  const cap = Math.floor(contextOf(conn) * 0.25);
  let total = out.reduce((a, m) => a + estimateTokens(m.content), 0);
  let dropped = 0;
  while (out.length > 2 && total > cap) { total -= estimateTokens(out[0].content); out.shift(); dropped++; }
  /* a conversation opens with his turn: the narrator's opening is answered to
   * the words that asked for it, and anything else that lost its question goes */
  if (out.length && out[0].role !== 'user') {
    if (openWith) out.unshift({ role: 'user', content: openWith });
    else while (out.length && out[0].role !== 'user') out.shift();
  }
  /* the oldest talk let go for room is said, never silently missing (Cozy Tavern's M265) */
  if (dropped && out.length && out[0].role === 'user') out[0] = { ...out[0], content: `${scene ? '(The earliest turns of this scene are left out here, to save room.)' : '(The earliest part of our talk is left out here, to save room.)'}\n\n${out[0].content}` };
  return out;
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
  const unglued = dropGluedStrays(story);
  if (unglued.changed) say('A stray character of another script, stuck to the front of a word, was taken off.');
  const fin = finishTail(joinSoftWraps(unglued.text));
  if (fin.removed) {
    const what = fin.kinds.includes('tracking') && fin.kinds.includes('note') ? 'A block of tracking and a note to you' : fin.kinds.includes('tracking') ? 'A block of tracking' : 'A note to you';
    say(`${what} after the telling ${fin.kinds.length > 1 ? 'were' : 'was'} taken off — Put back what was taken off brings ${fin.kinds.length > 1 ? 'them' : 'it'} back.`);
  }
  const telling = fin.removed ? fin.text.replace(/\s+$/, '') + (rest ? '\n\n' : '') : fin.text;
  return { text: mendMarks(telling, { leaveLast: cut && !rest }).text + rest, tookOff: fin.removed || '' };
}
/* What came off a telling's end, put back where it was — before the ways it
 * offers — as a new version of that answer; the one without it stays one
 * arrow away. */
export function putBackTelling({ playId, turnId }) {
  const play = store.peek('play', playId);
  const turn = play && (play.turns || []).find((t) => t.id === turnId);
  const v = turn && picked(turn);
  if (!v || !String(v.tookOff || '').trim() || running.has(`play/${playId}`)) return false;
  const w = String(v.text || '');
  const at = w.toLowerCase().indexOf(CHOICES_OPEN);
  const story = (at >= 0 ? w.slice(0, at) : w).replace(/\s+$/, '');
  const rest = at >= 0 ? w.slice(at) : '';
  const text = `${story}\n\n${v.tookOff}${rest ? `\n\n${rest}` : ''}`;
  const { id: _id, at: _at, tookOff: _off, notes: _n, ...keep } = v;
  store.change('play', playId, turnSteps.addVersion(turnId, newVersion({ ...keep, text, done: Date.now() })), { now: true });
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
export function fitRead(rows, budget) {
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
    const f = fitRead(rounds.filter((x) => x.rows).flatMap((x) => x.rows), budget);
    let k = 0;
    const messages = [];
    let tokens = f.tokens;
    for (const x of rounds) {
      if (x.rows) {
        const rows = f.rows.slice(k, k + x.rows.length);
        k += x.rows.length;
        messages.push({ role: 'assistant', content: x.said }, { role: 'user', content: readBack(rows, { cut: f.cut }) + (x.last ? `\n\n${READ_LAST}` : '') });
      } else {
        messages.push({ role: 'assistant', content: x.said }, { role: 'user', content: x.ask });
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
  const undo = () => { try { store.change(kind, id, (d) => { const t = (d.turns || []).find((x) => x.id === turnId); if (!t) return; if (t.versions.length < 2) d.turns = d.turns.filter((x) => x.id !== turnId); else turnSteps.removeVersion(turnId, versionId)(d); }, { now: true }); } catch (_) { /* gone */ } };
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
    if (Date.now() - last < 25000) return;
    last = Date.now();
    try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, { ...(keptNow() ? { text: keptNow() } : {}), ...alive() }), { checkpoint: true, delay: 50 }); } catch (_) { /* gone */ }
  }, 30000);
  try {
    let out;
    const askNow = () => ask(conn, {
        build: (c) => {
          const { novel, chapters } = bookNow(novelId);
          const rec = store.peek(kind, id);
          const args = buildArgs(rec, c);
          const made = (extra) => assemble({ house, novel, chapters, conn: c, ...args, turns: [...(args.turns || []), ...extra.messages], length });
          let extra = extraOf();
          let a = made(extra);
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
          seen = new Set([...(a.stats.wholeIds || []), ...(extra.whole || [])]);
          return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: replyRoom(c, kind, length), refuse: a.refuse, least };
        },
        stream: true,
        signal: ctl.signal,
        /* the partner talks the book over: never his page's started reply, nor its template (Cozy Tavern's M328) */
        ...(kind === 'talk' ? { noPrefill: true, noStructured: true } : {}),
        onText: (s) => {
          text += s;
          live({ kind, id, turnId, versionId, text: prefix + text, thinking });
          if (Date.now() - last > 3000) { last = Date.now(); store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: keptNow(), ...alive() }), { checkpoint: true, delay: 50 }); }
        },
        onThinking: (s) => {
          thinking += s;
          live({ kind, id, turnId, versionId, text: prefix + text, thinking });
          if (Date.now() - last > 20000) { last = Date.now(); store.change(kind, id, turnSteps.setVersion(turnId, versionId, alive()), { checkpoint: true, delay: 50 }); }
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
        const said = String(o.text || text);
        const asked = kind === 'talk' && o.ok && !o.cut ? readAsks(said) : [];
        /* a read block with nothing in it that can be read: told once how to ask (M222) */
        if (kind === 'talk' && o.ok && !o.cut && !asked.length && !howTold && unreadableRead(said)) {
          howTold = true;
          rounds.push({ said: said.trim(), ask: READ_HOW });
          keepThought(thinking, 'asked how to read');
          text = ''; thinking = '';
          live({ kind, id, turnId, versionId, text: replacing ? '' : prefix, thinking: thoughtBefore, note: 'Telling it how to ask for a chapter…' });
          continue;
        }
        if (!asked.length) return o;
        /* past three reads in one answer: what it asked is sent, and it is told to answer now (M221) */
        const last = readsLeft <= 0;
        if (last && lastTold) return o;
        readsLeft--;
        const rows = readRows(novelId, asked);
        rounds.push({ said: said.trim() || '(I asked to read them.)', rows, ...(last ? { last: true } : {}) });
        if (last) lastTold = true;
        read.push(...rows.filter((r) => !r.missing).map((r) => r.label));
        keepThought(thinking, `read ${rows.map((r) => r.label).join(', ')}`);
        text = '';
        thinking = '';
        live({ kind, id, turnId, versionId, text: replacing ? '' : prefix, thinking: thoughtBefore, note: `Reading ${rows.map((r) => r.label).join(', ')} whole…` });
      }
    };
    out = await askReading();
    const leakNotes = [];
    const firstWords = cleanAnswer(kind, id, turnId, String(out.text || text), leakNotes);
    if (!firstWords.trim()) {
      const why = out.stopped ? 'stopped before any words came'
        : String(out.text || text).trim() ? 'the answer held nothing before the provider’s own markers'
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
    }), { checkpoint: true, now: true });
    /* what the partner's block asks for: made now, or waiting for Apply. What
     * could not be made is told back for it to put right in the same answer
     * (twice at most, every answer's block made); an answer that says it
     * changed the book with no block for it is asked once for the whole
     * answer again, with the block — its words then stand in place of the
     * first ones (Cozy Tavern's M75/M118) */
    if (kind === 'talk') {
      let segment = done;
      const all = [];
      let askedWhole = false;
      for (let fix = 0; ; fix++) {
        const changes = settleChanges(novelId, turnId, versionId, segment, store.peek('house', 'house') || house, all, seen);
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
        live({ kind, id, turnId, versionId, text: replacing ? '' : done, thinking: thoughtBefore, note: missed.length ? 'Putting right what could not be made…' : 'Asking it for the change it described…' });
        out = await askReading();
        const next = cleanAnswer(kind, id, turnId, String(out.text || text), leakNotes).replace(/\s+$/, '');
        const whole = replacing;
        replacing = false;
        if (!next.trim()) break;
        segment = next;
        done = whole ? next : `${done}\n\n${next}`;
        store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: done, thinking: allThought(out.thinking || thinking) || undefined,
          cut: out.cut || out.stopped ? true : undefined, cutWhy: out.cut || out.stopped ? cutWords(out) : undefined, notes: notesOf(out), sources: sourcesOf(out) }), { checkpoint: true, now: true });
      }
      /* a change that missed and was then made (or set to wait) in a later round no longer stands as missed (Cozy Tavern's M683) */
      supersede(novelId, turnId, versionId);
    }
    store.change(kind, id, turnSteps.set({ updated: Date.now() }), { now: true });
    if (out.sent) store.keepSent(novelId, versionId, { ...out.sent, purpose: kind === 'talk' ? 'partner' : 'play' });
    await store.flush(kind, id);
    return { ok: true };
  } catch (e) {
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
const READ_HOW = 'That read block could not be read. Ask for a chapter by its number — [3] — for every place some words stand with "find: …", or for a module with "module: …", in a read block; or answer from what you have.';

/* ----------------------------------------------------- the partner's changes */

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

function settleChanges(novelId, turnId, versionId, text, house, before = [], seen = null) {
  const ops = opsOf(text);
  if (!ops.length) return [];
  const wait = house && house.partnerApplies === 'wait';
  const changes = ops.map((op) => {
    if (op.unreadable) return makeChange(novelId, op);
    if (!wait) return makeChange(novelId, op, { seen });
    /* waiting for Apply: looked at as it arrives, so one that cannot land is said now; and what it was made against kept, so a change since is said at Apply (M422) */
    const why = whyNot(novelId, op, { seen });
    return why ? { id: newId('cg'), op, label: labelOf(op), why: String(op.why || '').trim(), status: 'refused', said: why }
      : { id: newId('cg'), op, label: labelOf(op), why: String(op.why || '').trim(), status: 'waiting', base: baseOf(novelId, op) };
  });
  store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes: [...before, ...changes] }), { now: true });
  /* an older answer's change still waiting for the same thing, written whole, is set aside by this one (M397) */
  if (wait) asideOlder(novelId, turnId, changes.filter((c) => c.status === 'waiting'));
  if (changes.some((c) => c.status === 'made')) afterChanges(novelId);
  return changes;
}

/* a missed change made in a later round of the same answer: the miss no longer stands */
function supersede(novelId, turnId, versionId) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && t.versions.find((x) => x.id === versionId);
  const list = (v && v.changes) || [];
  const landed = new Set(list.filter((c) => c.status === 'made' || c.status === 'waiting').map((c) => targetOf(c.op)).filter(Boolean));
  let any = false;
  const next = list.map((c, i) => {
    if (c.status !== 'refused' || c.superseded) return c;
    const key = targetOf(c.op);
    const later = key && list.slice(i + 1).some((x) => (x.status === 'made' || x.status === 'waiting') && targetOf(x.op) === key);
    if (!later || !landed.has(key)) return c;
    any = true;
    return { ...c, superseded: true };
  });
  if (any) store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes: next }), { now: true });
}

/* a newer answer's waiting change for the same thing, written whole (a passage
 * anew, a card's words, a summary, a module): the older one is left */
function asideOlder(novelId, turnId, fresh) {
  const whole = fresh.filter((c) => c.op && (c.op.find === undefined) && targetOf(c.op));
  if (!whole.length) return;
  const keys = new Set(whole.map((c) => targetOf(c.op)));
  const rec = store.peek('talk', novelId);
  for (const t of (rec && rec.turns) || []) {
    if (t.id === turnId) continue;
    for (const v of t.versions || []) {
      const list = v.changes || [];
      if (!list.some((c) => c.status === 'waiting' && !c.copied && targetOf(c.op) && keys.has(targetOf(c.op)))) continue;
      const next = list.map((c) => (c.status === 'waiting' && !c.copied && keys.has(targetOf(c.op)) ? { ...c, status: 'skipped', said: 'a newer answer changes the same', aside: true } : c));
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
const MISSED = /not there|more than one place|has no passage|there is no chapter|not a passage number|passage number has to be given|only in short|no module called|more than one module|in the notes$|stand nowhere|no .* in the notes|more than one card goes by|changes block could not be read/i;
/* A change said to be made, with no block for it (Cozy Tavern's M118): the
 * partner saying it changed something — first person ("I've changed the
 * lamp…", "I rewrote passage 3"), or "now reads", or "the change is made".
 * Quoted words are the story's, never a claim; "I've added four directions
 * below", "it's changed everything for Oda" or "that's done well" are talk:
 * "added" and "made" claim only with a part of the book ("I've added a line
 * to passage 2", "I've made the changes"). */
const BOOK_PART = String.raw`(?:the |that |this |those |these |your |its |his |her |their |a |an |some )?(?:[\p{L}’'-]+ ){0,2}?(?:passages?|chapters?|notes?|cards?|summary|summaries|names?|title|subtitle|module|book|lines?|scenes?|text|wording|words|paragraphs?|opening|ending|dialogue|sentences?|changes?|edits?|fix(?:es)?|corrections?)\b`;
const CLAIM_WORDS = new RegExp(String.raw`\bI(?:['’]ve| have)?\s+(?:now\s+|also\s+|just\s+|gone ahead and\s+)?(?:(?:changed|updated|rewritten|rewrote|edited|fixed|corrected|replaced|removed|taken out|cut|renamed|trimmed|tightened)\b|(?:added|made)\s+${BOOK_PART})|\b(?:now reads|now says)\b|\b(?:the |that |your )?(?:change|edit|fix|correction)s? (?:is |are |has been |have been |was |were )?(?:done|applied|made|in place)\b`, 'iu');
export function claimsChange(prose) {
  const unquoted = String(prose || '').replace(/"[^"\n]{0,400}"|“[^”\n]{0,400}”|‘[^’\n]{0,200}’|(?<![\p{L}])'[^'\n]{0,200}'(?![\p{L}])/gu, ' ');
  return CLAIM_WORDS.test(unquoted);
}
function missedWords(list) {
  return `Some of your changes couldn’t be made: ${list.map((c) => `${c.label} — ${c.said}`).join('; ')}. Give a changes block again for just those, quoting exactly what stands there now — enough of it to be found in one place only (a chapter you only have in short, read it whole first) — or say plainly that you’re leaving them. Don’t repeat the ones that were made.`;
}
const NOTHING_HAPPENED = 'Your answer says a change was made, but it holds no changes block — so nothing changed in the book: a change happens only through the block. Send your whole answer again, with the changes block that makes it, quoting exactly the words you change. If I didn’t ask for a change — it was a question, a check, a thought aloud — simply answer that, as if this note were not here: never mention it. If a change was asked and no block can make it, say so plainly, without saying it was done.';
function afterChanges(novelId) {
  recount(novelId);
  /* a version brought back brings its own notes back (readings.js) */
  archivist.settle(novelId);
  archivist.nudge(novelId, 3000);
}

/* whether a waiting change could still be made now: '' or why not (drawn under it) */
export function waitingWhy(novelId, change) {
  if (!change || change.status !== 'waiting') return '';
  return driftOf(novelId, change) || whyNot(novelId, change.op);
}

/* one waiting change made, one made change undone, one waiting change left */
export function applyChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'apply'); }
export function undoOneChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'undo'); }
export function skipChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'skip'); }
/* Edit by hand: a waiting change made with his words in place of its own (changes.js editableOf) */
export function applyEdited(novelId, turnId, versionId, changeId, patch) { return settleOne(novelId, turnId, versionId, changeId, 'apply', patch); }
/* every change of one answer at once: Apply all, Leave all, Undo all (the newest made first) */
export function settleAll(novelId, turnId, versionId, how) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && t.versions.find((x) => x.id === versionId);
  const want = how === 'undo' ? 'made' : 'waiting';
  const ids = ((v && v.changes) || []).filter((c) => c.status === want && !c.copied).map((c) => c.id);
  if (how === 'undo') ids.reverse();
  const out = { done: 0, failed: [], partly: [] };
  for (const id of ids) {
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
  let next = c;
  /* written whole over a thing changed since it was offered: said, never made (his own words by hand are his to put) */
  const drift = how === 'apply' && c.status === 'waiting' && !patch ? driftOf(novelId, c) : '';
  if (drift) next = { ...c, status: 'refused', said: drift };
  else if (how === 'apply' && c.status === 'waiting') next = patch ? { ...makeChange(novelId, withEdits(c.op, patch), { id: c.id }), edited: true } : { ...makeChange(novelId, c.op, { id: c.id }) };
  else if (how === 'skip' && c.status === 'waiting') next = { ...c, status: 'skipped' };
  else if (how === 'undo' && c.status === 'made') {
    /* a passage it wrote anew, read by the helper since: those words are kept for the helper, so what came only from them goes too */
    if (c.undo && c.undo.what === 'passage') archivist.retireIfSeen(novelId, c.undo.chapterId, c.undo.passageId, c.undo.versionId);
    const u = undoChange(novelId, c);
    if (!u.ok) return u;
    /* put back where it still read as the change left it; what was changed since stays — and he is told */
    next = { ...c, status: 'undone', ...(u.said ? { undoneSaid: u.said } : {}) };
  } else return { ok: false, said: 'nothing to do' };
  const changes = list.map((x, k) => (k === i ? next : x));
  store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes }), { now: true });
  if (next.status === 'made' || next.status === 'undone') afterChanges(novelId);
  if (how === 'undo') return { ok: true, said: next.undoneSaid || '', partly: Boolean(next.undoneSaid), change: next };
  return { ok: next.status !== 'refused', said: next.said, change: next };
}

/* ------------------------------------------------------------- partner */

export async function ensureTalk(novelId) {
  let t = await store.open('talk', novelId);
  if (!t) t = await store.create('talk', novelId, { id: novelId, novelId, turns: [], updated: Date.now() });
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
  await ensureTalk(novelId);
  await loadPlays(novelId);
  if (talkBusy('talk', novelId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const mine = newTurn('you', t);
  const reply = newTurn('ai', '', { streaming: true });
  store.change('talk', novelId, turnSteps.addTurn(mine));
  store.change('talk', novelId, turnSteps.addTurn(reply), { now: true });
  const out = await runTurn({ kind: 'talk', id: novelId, novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'partner',
    buildArgs: (rec, c) => ({ purpose: 'partner', target: { chapterId }, turns: turnsFor(rec, { upto: reply.id, conn: c }), request: '', moment: hisLast(rec, reply.id) }) });
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
  return out;
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
export async function nextIdeas({ novelId, chapterId, count = 4, signal = null }) {
  const house = store.peek('house', 'house') || {};
  const conn = connFor(house, 'partner');
  if (!conn) return { ok: false, error: 'no connection is chosen for your partner yet — Settings → Connections' };
  ideasAsked++;
  const out = await ask(conn, {
    build: (c) => {
      const { novel, chapters } = bookNow(novelId);
      const a = assemble({ house, novel, chapters, conn: c, purpose: 'partner', target: { chapterId }, turns: [], request: ideasRequest(count) });
      return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, 'scene') : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse, least: a.stats.least };
    },
    stream: true,
    signal,
    /* premises to choose from, never a page: no started reply, no page template (Tavern M328) */
    noPrefill: true,
    noStructured: true,
  }).finally(() => { ideasAsked--; });
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
  if (talkBusy('talk', novelId)) return { error: 'a reply is on its way — Stop it first' };
  await repairStaleTurns('talk', novelId);
  const now = store.peek('talk', novelId) || rec;
  if ((now.turns || []).some((t) => (t.versions || []).some((v) => v.streaming))) return { error: 'a reply is being written in another window — wait for it there' };
  return { rec: now };
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
  store.change('talk', novelId, convSteps.fresh({ id: newId('cv'), name, ...s }), { now: true });
  return { ok: true, name };
}

/* another conversation opens; the open one stays in the list */
export async function openConversation(novelId, convId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  if (!(rec.convs || []).some((c) => c.id === convId)) return { ok: false, error: 'that conversation is not there any more' };
  store.change('talk', novelId, convSteps.open({ id: convId, ...spareOf(rec) }), { now: true });
  return { ok: true };
}

/* a copy of the open conversation — whole, or up to one of its turns — opens; this one stays as it is */
export async function copyConversation(novelId, upto = null) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  if (!(rec.turns || []).length || (upto && !(rec.turns || []).some((t) => t.id === upto))) return { ok: false, error: 'there is nothing to copy' };
  const s = spareOf(rec);
  const name = markedName(s.spareName, upto ? 'branch' : 'copy', [s.spareName, ...(rec.convs || []).map((c) => c.name)]);
  store.change('talk', novelId, convSteps.copy({ id: newId('cv'), name, upto, ...s }), { now: true });
  return { ok: true, name };
}

export async function renameConversation(novelId, name) {
  const n = cleanConvName(name);
  if (!n) return { ok: false, error: 'it needs a name' };
  const rec = await ensureTalk(novelId);
  if ((rec.convs || []).some((c) => c.name === n)) return { ok: false, error: `another conversation is called “${n}” already` };
  store.change('talk', novelId, convSteps.rename(n), { now: true });
  return { ok: true };
}

/* Start over: the open conversation's talk goes (the changes it made stay in the book); Undo puts it back */
export async function startOver(novelId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  const turns = JSON.parse(JSON.stringify(rec.turns || []));
  const convId = rec.convId || newId('cv');
  if (!rec.convId) store.change('talk', novelId, turnSteps.set({ convId }));
  store.change('talk', novelId, convSteps.clear(), { now: true });
  return { ok: true, undo: () => store.change('talk', novelId, convSteps.unclear(convId, turns), { now: true }) };
}

/* the open conversation goes from the list: the newest used of the others opens, or a new one; Undo opens it again */
export async function removeConversation(novelId) {
  const { rec, error } = await convReady(novelId);
  if (error) return { ok: false, error };
  const gone = { id: rec.convId || newId('cv'), name: openName(rec), ...(rec.named ? { named: true } : {}), at: Date.now(), turns: JSON.parse(JSON.stringify(rec.turns || [])) };
  const next = conversationsOf(rec).others[0];
  store.change('talk', novelId, convSteps.remove({ nextId: next ? next.id : null, freshId: newId('cv'), freshName: freeName(rec, [gone.name]) }), { now: true });
  return { ok: true, name: gone.name, undo: () => store.change('talk', novelId, convSteps.unremove(gone, { at: Date.now() }), { now: true }) };
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
  if (!rec.convId) store.change('talk', novelId, turnSteps.set({ convId }));
  store.change('talk', novelId, convSteps.cutFrom(turnId), { now: true });
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
  store.change('talk', novelId, turnSteps.addVersion(turnId, v), { now: true });
  return runTurn({ kind: 'talk', id: novelId, novelId, turnId, versionId: v.id, role: 'partner',
    buildArgs: (r, c) => ({ purpose: 'partner', target: { chapterId }, turns: turnsFor(r, { upto: turnId, conn: c }), request: '', moment: hisLast(r, turnId) }) });
}

/* ---------------------------------------------------------------- play */

/* A new scene: who he plays, where it starts. It picks up where the chapter
 * stands right now. */
export async function newPlay({ novelId, chapterId, who, from = '' }) {
  const id = newId('pl');
  const chapter = store.peek('chapter', chapterId);
  const after = chapter && chapter.passages.length ? chapter.passages[chapter.passages.length - 1].id : null;
  const play = { id, novelId, chapterId, after, who: String(who || '').trim(), from: String(from || '').trim(), title: '', turns: [], turned: null, created: Date.now(), updated: Date.now() };
  await store.create('play', id, play);
  store.change('novel', novelId, novelSteps.addPlay(id), { now: true });
  return id;
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
  const p = await store.open('play', playId);
  if (!p) return { ok: false, error: 'that scene is not there any more' };
  if (talkBusy('play', playId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const t = String(text || '').trim();
  const tl = String(tell || '').trim();
  const mine = t || tl ? newTurn('you', t, tl ? { tell: tl } : {}) : null;
  if (mine) store.change('play', playId, turnSteps.addTurn(mine));
  const reply = newTurn('ai', '', { streaming: true });
  store.change('play', playId, turnSteps.addTurn(reply), { now: true });
  const out = await runTurn({ kind: 'play', id: playId, novelId: p.novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'writer', length: 'paragraphs',
    buildArgs: playArgs(p, reply.id) });
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

/* A reply being written when its window closed would show "…" forever: one
 * whose writer is gone (its tab closed in this browser, or no heartbeat for
 * two minutes) keeps what arrived, or goes when nothing did. */
export async function repairStaleTurns(kind, id) {
  const rec = store.peek(kind, id);
  if (!rec) return 0;
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
      if (!String(v.text || '').trim()) {
        if (t.versions.length < 2) store.change(kind, id, turnSteps.removeTurn(t.id), { now: true });
        else store.change(kind, id, turnSteps.removeVersion(t.id, v.id), { now: true });
      } else store.change(kind, id, turnSteps.setVersion(t.id, v.id, { streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true }), { now: true });
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
  for (const t of turns.slice(start)) {
    const v = picked(t);
    /* what happened in it: his character's lines and the narrator's telling —
     * never his lines to the narrator, nor the ways it offered */
    const raw = String((v && v.text) || '');
    const text = (t.by === 'you' ? raw : sceneWords(raw)).trim();
    if (t.by === 'you') mine.push(...[text, String((v && v.tell) || '').trim()].filter(Boolean));
    if (!text) continue;
    lines.push(t.by === 'you' ? `${who}: ${text}` : `Narrator: ${text}`);
  }
  return { text: lines.join('\n\n'), mine: mine.join('\n'), lastId: turns.length ? turns[turns.length - 1].id : null, count: lines.length };
}
