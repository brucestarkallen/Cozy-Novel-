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
import { ask, emptyWhy } from '../model/call.js';
import { wireOf } from '../model/providers.js';
import { estimateTokens } from '../util.js';
import { assemble, requiredLength } from './context.js';
import { contextOf } from '../model/providers.js';
import { connFor, connName, recount } from './writer.js';
import { turnSteps, newTurn, newVersion, picked, novelSteps, chapterLabel, chapterText } from './shape.js';
import { newId, numberWords } from '../util.js';
import { playOpening, playOnwards, readBack, tellLine, sceneWords } from './prompts.js';
import { numberedText } from './context.js';
import { opsOf, readsOf, makeChange, undoChange, outcomeWords, labelOf } from './changes.js';
import * as archivist from './archivist.js';

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
  /* the chapters the partner asked to read whole, and its words before it asked */
  const extra = [];
  const read = [];
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
    let out;
    for (let round = 0; ; round++) {
      out = await ask(conn, {
        build: (c) => {
          const { novel, chapters } = bookNow(novelId);
          const rec = store.peek(kind, id);
          const args = buildArgs(rec, c);
          const a = assemble({ house, novel, chapters, conn: c, ...args, turns: [...(args.turns || []), ...extra], length });
          return { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: wireOf(c) === 'anthropic' ? requiredLength(c, length) : (Number.isFinite(c.maxTokens) ? c.maxTokens : undefined), refuse: a.refuse };
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
      /* the partner asked to read chapters whole: they are sent, and the same answer goes on */
      const asked = kind === 'talk' && out.ok && !out.cut && round < 3 ? readsOf(out.text || text) : [];
      if (!asked.length) break;
      const rows = readRows(novelId, asked);
      extra.push({ role: 'assistant', content: String(out.text || text).trim() || '(I asked to read them.)' }, { role: 'user', content: readBack(rows) });
      read.push(...rows.filter((r) => !r.missing).map((r) => r.label));
      text = '';
      thinking = '';
      live({ kind, id, turnId, versionId, text: '', thinking: '', note: `Reading ${rows.map((r) => r.label).join(', ')} whole…` });
    }
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
      tokensIn: out.usage && Number.isFinite(out.usage.in) ? out.usage.in : (out.sent && Number.isFinite(out.sent.tokens) ? out.sent.tokens : undefined),
      tokensCounted: out.usage && Number.isFinite(out.usage.in) ? true : undefined,
      read: read.length ? read : undefined,
    }), { checkpoint: true, now: true });
    /* what the partner's block asks for: made now, or waiting for Apply */
    if (kind === 'talk') settleChanges(novelId, turnId, versionId, done, store.peek('house', 'house') || house);
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

/* ----------------------------------------------------- the partner's changes */

/* the chapters it asked for, whole and numbered (or said not to be there) */
function readRows(novelId, numbers) {
  const novel = store.peek('novel', novelId);
  return numbers.map((n) => {
    const chId = ((novel && novel.order) || [])[n - 1];
    const c = chId && store.peek('chapter', chId);
    if (!c) return { label: `Chapter ${numberWords(n)}`, text: '(there is no such chapter)', missing: true };
    return { label: chapterLabel(novel, c), text: numberedText(novel, c) || chapterText(c) || '(nothing written in it yet)' };
  });
}

function settleChanges(novelId, turnId, versionId, text, house) {
  const ops = opsOf(text);
  if (!ops.length) return;
  const wait = house && house.partnerApplies === 'wait';
  const changes = ops.map((op) => (wait ? { id: newId('cg'), op, label: labelOf(op), why: String(op.why || '').trim(), status: 'waiting' } : makeChange(novelId, op)));
  store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes }), { now: true });
  if (changes.some((c) => c.status === 'made')) afterChanges(novelId);
}
function afterChanges(novelId) {
  recount(novelId);
  archivist.nudge(novelId, 3000);
}

/* one waiting change made, one made change undone, one waiting change left */
export function applyChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'apply'); }
export function undoOneChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'undo'); }
export function skipChange(novelId, turnId, versionId, changeId) { return settleOne(novelId, turnId, versionId, changeId, 'skip'); }
function settleOne(novelId, turnId, versionId, changeId, how) {
  const rec = store.peek('talk', novelId);
  const t = rec && (rec.turns || []).find((x) => x.id === turnId);
  const v = t && t.versions.find((x) => x.id === versionId);
  const list = (v && v.changes) || [];
  const i = list.findIndex((c) => c.id === changeId);
  if (i < 0) return { ok: false, said: 'that change is not there any more' };
  const c = list[i];
  let next = c;
  if (how === 'apply' && c.status === 'waiting') next = { ...makeChange(novelId, c.op, { id: c.id }) };
  else if (how === 'skip' && c.status === 'waiting') next = { ...c, status: 'skipped' };
  else if (how === 'undo' && c.status === 'made') {
    const u = undoChange(novelId, c);
    if (!u.ok) return u;
    next = { ...c, status: 'undone' };
  } else return { ok: false, said: 'nothing to do' };
  const changes = list.map((x, k) => (k === i ? next : x));
  store.change('talk', novelId, turnSteps.setVersion(turnId, versionId, { changes }), { now: true });
  if (next.status === 'made' || next.status === 'undone') afterChanges(novelId);
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
    /* what happened in it: his character's lines and the narrator's telling —
     * never his lines to the narrator, nor the ways it offered */
    const raw = String((v && v.text) || '');
    const text = (t.by === 'you' ? raw : sceneWords(raw)).trim();
    if (!text) continue;
    lines.push(t.by === 'you' ? `${who}: ${text}` : `Narrator: ${text}`);
  }
  return { text: lines.join('\n\n'), lastId: turns.length ? turns[turns.length - 1].id : null, count: lines.length };
}
