/* Cozy Novel — js/novel/talk.js
 *
 * The two conversations beside the book: the PARTNER, to talk the book over
 * with, and PLAY A SCENE, where he plays one of the people and the narrator
 * plays the rest. Both are turns with versions (another reply sits beside the
 * first, one arrow away), streamed as they come; a reply that fails is never
 * asked again by itself — the reason is said and he tries again by hand.
 */

import * as store from '../store.js';
import { ask, emptyWhy } from '../model/call.js';
import { wireOf } from '../model/providers.js';
import { estimateTokens } from '../util.js';
import { assemble, requiredLength } from './context.js';
import { contextOf } from '../model/providers.js';
import { connFor, connName } from './writer.js';
import { turnSteps, newTurn, newVersion, picked, novelSteps } from './shape.js';
import { newId } from '../util.js';
import { playOpening, playOnwards } from './prompts.js';

const running = new Map();        /* 'talk/<id>' | 'play/<id>' -> job */
const jobFns = new Set();
export function onTalkJob(fn) { jobFns.add(fn); return () => jobFns.delete(fn); }
function tell(key) { for (const fn of jobFns) { try { fn(key, running.get(key) || null); } catch (e) { console.error(e); } } }
export function talkBusy(kind, id) { return running.has(`${kind}/${id}`); }
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
  for (const t of list.slice(Math.max(0, from))) {
    if (upto && t.id === upto) break;
    const v = picked(t);
    const text = String((v && v.text) || '').trim();
    if (!text) continue;
    out.push({ role: t.by === 'you' ? 'user' : 'assistant', content: text });
  }
  const cap = Math.floor(contextOf(conn) * 0.25);
  let total = out.reduce((a, m) => a + estimateTokens(m.content), 0);
  while (out.length > 2 && total > cap) { total -= estimateTokens(out[0].content); out.shift(); }
  /* a conversation opens with his turn: the narrator's opening is answered to
   * the words that asked for it, and anything else that lost its question goes */
  if (out.length && out[0].role !== 'user') {
    if (openWith) out.unshift({ role: 'user', content: openWith });
    else while (out.length && out[0].role !== 'user') out.shift();
  }
  return out;
}

async function runTurn({ kind, id, novelId, turnId, versionId, role, buildArgs, length = 'scene' }) {
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
  const alive = () => ({ beat: Date.now(), tab: store.CLIENT, browser: store.BROWSER });
  try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, alive()), { checkpoint: true, delay: 50 }); } catch (_) { /* gone */ }
  /* it beats while the model is silent too, so another window never takes a
   * reply still coming for one whose window closed */
  const beating = setInterval(() => {
    if (Date.now() - last < 25000) return;
    last = Date.now();
    try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, { ...(text ? { text } : {}), ...alive() }), { checkpoint: true, delay: 50 }); } catch (_) { /* gone */ }
  }, 30000);
  try {
    const out = await ask(conn, {
      build: (c) => {
        const { novel, chapters } = bookNow(novelId);
        const rec = store.peek(kind, id);
        const a = assemble({ house, novel, chapters, conn: c, ...buildArgs(rec, c) , length });
        return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, length) : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined) };
      },
      stream: true,
      signal: ctl.signal,
      onText: (s) => {
        text += s;
        live({ kind, id, turnId, versionId, text, thinking });
        if (Date.now() - last > 3000) { last = Date.now(); store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text, ...alive() }), { checkpoint: true, delay: 50 }); }
      },
      onThinking: (s) => {
        thinking += s;
        live({ kind, id, turnId, versionId, text, thinking });
        if (Date.now() - last > 20000) { last = Date.now(); store.change(kind, id, turnSteps.setVersion(turnId, versionId, alive()), { checkpoint: true, delay: 50 }); }
      },
    });
    if (!String(out.text || text).trim()) {
      undo();
      if (out.stopped) return { ok: false, stopped: true };
      return { ok: false, error: out.ok ? emptyWhy(out, thinking) : out.error };
    }
    const done = String(out.text || text).replace(/\s+$/, '');
    store.change(kind, id, turnSteps.setVersion(turnId, versionId, {
      text: done, thinking: (out.thinking || thinking) || undefined, streaming: undefined, beat: undefined, tab: undefined, browser: undefined,
      cut: out.cut || out.stopped ? true : undefined, notes: out.notes && out.notes.length ? out.notes : undefined,
      usage: out.usage || undefined, ms: out.sent ? out.sent.ms : undefined, model: conn.model, conn: connName(conn), sent: out.sent ? versionId : undefined, done: Date.now(),
    }), { checkpoint: true, now: true });
    store.change(kind, id, turnSteps.set({ updated: Date.now() }), { now: true });
    if (out.sent) store.api('PUT', `/api/sent/${novelId}/${versionId}`, { body: { ...out.sent, purpose: kind === 'talk' ? 'partner' : 'play' } }).catch(() => {});
    await store.flush(kind, id);
    return { ok: true };
  } catch (e) {
    /* what arrived stays, said to be cut — never left "being written" */
    if (!text.trim()) undo();
    else {
      try { store.change(kind, id, turnSteps.setVersion(turnId, versionId, { text: text.replace(/\s+$/, ''), streaming: undefined, beat: undefined, tab: undefined, browser: undefined, cut: true }), { now: true }); } catch (_) { /* gone */ }
    }
    return { ok: false, error: (e && e.message) || String(e) };
  } finally {
    clearInterval(beating);
    running.delete(key);
    tell(key);
    live({ kind, id, turnId, versionId, done: true });
  }
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
export async function partnerSay({ novelId, chapterId, text }) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: '' };
  await ensureTalk(novelId);
  if (talkBusy('talk', novelId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const mine = newTurn('you', t);
  const reply = newTurn('ai', '', { streaming: true });
  store.change('talk', novelId, turnSteps.addTurn(mine));
  store.change('talk', novelId, turnSteps.addTurn(reply), { now: true });
  const out = await runTurn({ kind: 'talk', id: novelId, novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'partner',
    buildArgs: (rec, c) => ({ purpose: 'partner', target: { chapterId }, turns: turnsFor(rec, { upto: reply.id, conn: c }), request: '' }) });
  if (!out.ok && !replied('talk', novelId, reply.id)) {
    try { store.change('talk', novelId, turnSteps.removeTurn(mine.id), { now: true }); } catch (_) { /* gone */ }
    return { ...out, giveBack: t };
  }
  return out;
}
/* did any words of this reply stay? */
function replied(kind, id, turnId) {
  const rec = store.peek(kind, id);
  return Boolean(rec && (rec.turns || []).some((x) => x.id === turnId));
}

/* Another answer to the same message. */
export async function partnerAgain({ novelId, chapterId, turnId }) {
  const rec = await store.open('talk', novelId);
  const t = rec && rec.turns.find((x) => x.id === turnId);
  if (!t || t.by !== 'ai') return { ok: false, error: '' };
  if (talkBusy('talk', novelId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const v = newVersion({ streaming: true });
  store.change('talk', novelId, turnSteps.addVersion(turnId, v), { now: true });
  return runTurn({ kind: 'talk', id: novelId, novelId, turnId, versionId: v.id, role: 'partner',
    buildArgs: (r, c) => ({ purpose: 'partner', target: { chapterId }, turns: turnsFor(r, { upto: turnId, conn: c }), request: '' }) });
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
    /* the narrator opens the scene when he has not said anything yet — or,
     * once what was played is in the book, carries it on from there */
    if (!turns.length) return { purpose: 'play', play: p, target, turns: [], request: p.turned ? playOnwards({ who: p.who }) : opening };
    /* the narrator spoke last and he said nothing: it carries on */
    if (turns[turns.length - 1].role === 'assistant') return { purpose: 'play', play: p, target, turns, request: 'Go on.' };
    return { purpose: 'play', play: p, target, turns, request: '' };
  };
}

/* His move in the scene (or nothing, to have the narrator begin), and the narrator's answer. */
export async function playSay({ playId, text }) {
  const p = await store.open('play', playId);
  if (!p) return { ok: false, error: 'that scene is not there any more' };
  if (talkBusy('play', playId)) return { ok: false, error: 'a reply is already on its way — Stop it first' };
  const t = String(text || '').trim();
  const mine = t ? newTurn('you', t) : null;
  if (mine) store.change('play', playId, turnSteps.addTurn(mine));
  const reply = newTurn('ai', '', { streaming: true });
  store.change('play', playId, turnSteps.addTurn(reply), { now: true });
  const out = await runTurn({ kind: 'play', id: playId, novelId: p.novelId, turnId: reply.id, versionId: reply.versions[0].id, role: 'writer', length: 'paragraphs',
    buildArgs: playArgs(p, reply.id) });
  if (!out.ok && mine && !replied('play', playId, reply.id)) {
    try { store.change('play', playId, turnSteps.removeTurn(mine.id), { now: true }); } catch (_) { /* gone */ }
    return { ...out, giveBack: t };
  }
  return out;
}

export async function playAgain({ playId, turnId }) {
  const p = await store.open('play', playId);
  const t = p && p.turns.find((x) => x.id === turnId);
  if (!t || t.by !== 'ai') return { ok: false, error: '' };
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
  for (const t of turns.slice(start)) {
    const v = picked(t);
    const text = String((v && v.text) || '').trim();
    if (!text) continue;
    lines.push(t.by === 'you' ? `${who}: ${text}` : `Narrator: ${text}`);
  }
  return { text: lines.join('\n\n'), lastId: turns.length ? turns[turns.length - 1].id : null, count: lines.length };
}
