/* Cozy Novel — js/model/call.js
 *
 * The one way anything here speaks to a model. Every call goes out through the
 * phone's own server, so keys never leave the phone and no provider's browser
 * rules can break a page.
 *
 * WHAT A MODEL TEACHES IS KEPT (Cozy Tavern M350, M380, M510, M307). A request
 * the provider refuses for its SHAPE — a thinking level it does not take, a
 * dial it does not know, a started reply it will not continue, a note after
 * the request it will not read as a system message, more words than it holds —
 * is read for what it says, the lesson is kept on the connection for that
 * model at that address, and the same request goes again fitted to it. That is
 * the request being put right, not a failed page asked again: a page that
 * fails for any other reason is never re-asked by itself (his rule) — it says
 * the real cause and he retries by hand. Background helpers alone wait out a
 * "slow down" and try again.
 */

import {
  buildRequest, readAnswer, readChunk, wireOf, learnedFacts, learnKey, lessonFrom, familyStyle, cannotStopThinking,
  THINKING_FIELDS, REASONING_REFUSAL, PREFILL_REFUSAL, CONTEXT_REFUSAL, REPLY_TOO_LONG, COMPLETION_FIELD_REFUSAL,
  KNOB_FIELDS, knobRefused, hasLateSystem, hermesLike, prefillGap, contextFrom, inputFrom, replyLimitFrom, contextOf,
  modelsUrl, headersFor, reportedIdentity, spokenAs, describePrefill, prefillProfile, deepseekBetaBase, structuredPlanFor, prefillPlan,
} from './providers.js';
import { estimateTokens } from '../util.js';
import { makeStructuredDecoder, STRUCTURED_REFUSAL, unwrapStructured, readTemplate } from './structured.js';

/* ------------------------------------------------------------- lessons */

const learners = new Set();
/* the house hears every lesson and keeps it on the connection */
export function onLearn(fn) { learners.add(fn); return () => learners.delete(fn); }

export function learn(conn, fact) {
  if (!conn) return null;
  const was = learnedFacts(conn) ? conn.learned : null;
  const next = {
    for: learnKey(conn),
    at: Date.now(),
    efforts: fact.efforts || (was && was.efforts) || null,
    drop: [...new Set([...((was && was.drop) || []), ...(fact.drop || [])])],
    offThinks: fact.offThinks === true || Boolean(was && was.offThinks),
    noLateSystem: fact.noLateSystem === true || Boolean(was && was.noLateSystem),
    downAt: fact.downAt || (was && was.downAt) || null,
    prefillDownAt: fact.prefillDownAt || (was && was.prefillDownAt) || null,
    context: fact.context || (was && was.context) || null,
    /* a room of this app's own guessing, or the model's own number */
    contextGuess: fact.context ? fact.contextGuess === true : Boolean(was && was.contextGuess),
    maxOut: fact.maxOut || (was && was.maxOut) || null,
    completionField: fact.completionField === true || Boolean(was && was.completionField),
    structuredDownAt: fact.structuredDownAt || (was && was.structuredDownAt) || null,
  };
  conn.learned = next;
  for (const fn of learners) { try { fn(conn.id, next); } catch (_) { /* a listener's trouble is not the call's */ } }
  return next;
}

function lessonFor(detail, body) {
  const l = lessonFrom(detail, body);
  if (l.allowed) return { efforts: l.allowed };
  if (l.badField) return { drop: [l.badField] };
  return { downAt: Date.now() };
}
function thinkingPart(body) {
  const b = body || {};
  return JSON.stringify(THINKING_FIELDS.filter((f) => f in b).map((f) => [f, b[f]]));
}
function noticeOff(conn, thinking) {
  if (conn && conn.thinking === 'off' && String(thinking || '').trim() &&
      familyStyle(conn) !== 'hermes' && !cannotStopThinking(conn) && !(learnedFacts(conn) || {}).offThinks) {
    learn(conn, { offThinks: true });
  }
}

/* HERMES' KEY FOLLOWS HERMES (Cozy Chat v5.28.3): a refusal of the key from a
 * Hermes Agent on this phone asks the server for the key Hermes accepts now. */
const keyKeepers = new Set();
export function onKey(fn) { keyKeepers.add(fn); return () => keyKeepers.delete(fn); }
async function repairHermesKey(conn, status) {
  if (status !== 401 && status !== 403) return false;
  if (!hermesLike(conn)) return false;
  try {
    const res = await fetch('/api/hermes/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: conn.url }) });
    const data = await res.json();
    const key = data && typeof data.key === 'string' && data.key && data.key !== conn.key ? data.key : '';
    if (!key) return false;
    conn.key = key;
    for (const fn of keyKeepers) { try { fn(conn.id, key); } catch (_) { /* ignore */ } }
    return true;
  } catch (_) { return false; }
}

/* -------------------------------------------------------------- reading */

/* A thought written into the reply is the model's thinking, not its reply:
 * some servers send it between <think> and </think> inside the words, often
 * with no opening tag at all. Cozy Tavern's splitter moves a reply's leading
 * span onto the thinking channel as it streams, holding back a tag cut in two. */
function makeThinkSplitter(emit) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let state = 'open';
  let buf = '';
  let afterThought = false;
  function feed(text) {
    buf += text;
    for (;;) {
      if (state === 'open') {
        const trimmed = buf.replace(/^\s+/, '');
        if (trimmed.length < OPEN.length && OPEN.startsWith(trimmed)) return;
        if (trimmed.startsWith(OPEN)) {
          buf = trimmed.slice(OPEN.length);
          state = 'thinking';
          continue;
        }
        emit('prose', buf);
        buf = '';
        state = 'prose';
        return;
      }
      if (state === 'thinking') {
        const at = buf.indexOf(CLOSE);
        if (at !== -1) {
          if (at) emit('thinking', buf.slice(0, at));
          buf = buf.slice(at + CLOSE.length);
          state = 'prose';
          afterThought = true;
          continue;
        }
        let hold = 0;
        for (let k = Math.min(CLOSE.length - 1, buf.length); k > 0; k--) {
          if (CLOSE.startsWith(buf.slice(-k))) { hold = k; break; }
        }
        const out = buf.slice(0, buf.length - hold);
        if (out) emit('thinking', out);
        buf = buf.slice(buf.length - hold);
        return;
      }
      if (afterThought) { buf = buf.replace(/^\s+/, ''); if (!buf) return; afterThought = false; }
      emit('prose', buf);
      buf = '';
      return;
    }
  }
  function end() {
    if (!buf) return;
    emit(state === 'thinking' ? 'thinking' : 'prose', buf);
    buf = '';
  }
  return { feed, end };
}

export function splitThink(text) {
  let words = String(text || '');
  let thought = '';
  const lead = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/.exec(words);
  if (lead) { thought = lead[1]; words = words.slice(lead[0].length); }
  const close = words.lastIndexOf('</think>');
  if (close !== -1 && words.slice(0, close).indexOf('<think>') === -1) {
    thought = (thought ? thought + '\n' : '') + words.slice(0, close);
    words = words.slice(close + 8);
  }
  return { text: words.replace(/^\s+/, ''), thinking: thought.trim() };
}

const TRANSIENT_WORDS = /overload|rate.?limit|too many requests|timed? ?out|try again|temporar|unavailable|capacity|busy/i;
function errorOf(e) {
  const err = e && typeof e === 'object' ? e : { message: String(e || '') };
  const message = typeof err.message === 'string' && err.message ? err.message : JSON.stringify(err);
  let status = Number(err.code) || Number(err.status) || 0;
  if (!status) status = TRANSIENT_WORDS.test(message + ' ' + String(err.type || '')) ? 503 : 422;
  return { message, status };
}

/* A service's own count of a request: tokens in (with what came from its
 * cache), tokens out. Null when it said nothing. */
export function countOf(u) {
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
  const cached = n(u.cache_read_input_tokens) ?? n(u.prompt_cache_hit_tokens) ?? n(u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ?? 0;
  let inTok = n(u.prompt_tokens);
  if (inTok === null && n(u.input_tokens) !== null) inTok = n(u.input_tokens) + (n(u.cache_read_input_tokens) || 0) + (n(u.cache_creation_input_tokens) || 0);
  const outTok = n(u.completion_tokens) ?? n(u.output_tokens);
  if (inTok === null && outTok === null) return null;
  return { in: inTok, out: outTok, cached };
}

/* ONE READER FOR EVERY ANSWER, streamed or not. Words and thinking go to
 * whoever listens, each on its own channel. A refusal comes back as one line
 * of JSON (the phone's server answers every refusal so); a provider that
 * ignored "stream" is read whole; an error in the middle of a stream is an
 * error, never a finished answer. */
export async function readReply(wire, res, { onText, onThinking, onNote } = {}) {
  const reader = res && res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  const whole = (data) => {
    if (data && data.error) {
      /* the phone's relay says "provider" or "transport" and gives the words in detail */
      const relay = data.error === 'provider' || data.error === 'transport';
      const d = relay ? (data.detail || '') : (data.detail || data.error);
      return { finish: 'error', error: typeof d === 'string' ? d : JSON.stringify(d), status: Number(data.status) || 0, retryAfter: data.retryAfter, transport: data.error === 'transport', text: '', thinking: '' };
    }
    const a = readAnswer(wire, data);
    a.usage = countOf(data && data.usage);
    a.sources = [];
    for (const b of (data && Array.isArray(data.content) ? data.content : [])) if (b && b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r && r.url && !a.sources.some((x) => x.url === r.url)) a.sources.push({ url: r.url, title: r.title || r.url });
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    for (const x of (msg && Array.isArray(msg.annotations) ? msg.annotations : [])) { const c = x && (x.url_citation || x); if (c && c.url && !a.sources.some((y) => y.url === c.url)) a.sources.push({ url: c.url, title: c.title || c.url }); }
    a.reason = typeof a.finish === 'string' ? a.finish : '';
    const cut = splitThink(a.text);
    if (cut.thinking) { a.text = cut.text; a.thinking = [a.thinking, cut.thinking].filter(Boolean).join('\n\n'); }
    if (a.thinking && onThinking) onThinking(a.thinking);
    if (a.text && onText) onText(a.text);
    return a;
  };
  if (!reader) {
    let data = null;
    try { data = await res.json(); } catch (_) { return { finish: 'error', error: 'the answer could not be read', status: 0, text: '', thinking: '' }; }
    return whole(data);
  }
  const decoder = new TextDecoder();
  let buffer = '', raw = '', sse = false, text = '', thinking = '', cut = false, ended = false, midError = null, usage = null, reason = '';
  /* the provider's own web search: what it looked at (Claude's results, OpenRouter's citations) */
  const sources = [];
  const source = (url, title) => { if (url && !sources.some((x) => x.url === url)) sources.push({ url: String(url), title: String(title || url) }); };
  let pending = '';   /* an event whose words came over more than one data: line */
  const split = makeThinkSplitter((kind, s) => {
    if (kind === 'thinking') { thinking += s; if (onThinking) onThinking(s); } else { text += s; if (onText) onText(s); }
  });
  const parsed = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (_) { return null; } };
  const handle = (line) => {
    const l = line.trim();
    if (!l) {
      /* the end of one event: what it gathered is read, or let go */
      if (pending) { const o = parsed(pending); pending = ''; if (o) take(o); }
      return;
    }
    if (!l.startsWith('data:')) return;
    sse = true;
    const payload = l.slice(5).trim();
    if (pending) {
      const joined = `${pending}\n${payload}`;
      const whole = parsed(joined);
      if (whole) { pending = ''; take(whole); return; }
      const alone = parsed(payload);
      if (alone) { pending = ''; take(alone); return; }   /* the gathered one was broken: it goes */
      pending = joined.length > 2000000 ? '' : joined;
      return;
    }
    if (payload === '[DONE]') { ended = true; return; }
    const obj = parsed(payload);
    if (obj) take(obj);
    else if (payload) pending = payload;
  };
  const take = (obj) => {
    if (obj.toolCallId) return;              /* a Hermes Agent narrating its tools */
    if (obj.error) { midError = obj.error; return; }
    if (obj.usage && typeof obj.usage === 'object') usage = { ...(usage || {}), ...obj.usage };
    if (obj.type === 'message_start' && obj.message && obj.message.usage) usage = { ...(usage || {}), ...obj.message.usage };
    if (obj.type === 'message_stop') ended = true;
    if (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason) { ended = true; reason = String(obj.delta.stop_reason); }
    if (obj.type === 'content_block_start' && obj.content_block) {
      if (obj.content_block.type === 'server_tool_use' && onNote) onNote('Searching the web…');
      if (obj.content_block.type === 'web_search_tool_result' && Array.isArray(obj.content_block.content)) for (const r of obj.content_block.content) if (r && r.url) source(r.url, r.title);
    }
    {
      const ch = obj.choices && obj.choices[0];
      const ann = (ch && ch.delta && ch.delta.annotations) || (ch && ch.message && ch.message.annotations) || null;
      if (Array.isArray(ann)) for (const a of ann) { const c = a && (a.url_citation || a); if (c && c.url) source(c.url, c.title); }
    }
    const choice = obj.choices && obj.choices[0];
    if (choice && choice.finish_reason) { ended = true; reason = String(choice.finish_reason); }
    const part = readChunk(wire, obj);
    if (!part) return;
    if (part.thinking) { thinking += part.thinking; if (onThinking) onThinking(part.thinking); }
    if (part.text) split.feed(part.text);
    if (part.cut) cut = true;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    if (!sse) raw += piece;
    buffer += piece;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) { handle(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
  }
  const tail = decoder.decode();
  if (!sse) raw += tail;
  handle(buffer + tail);
  handle('');
  if (!sse) {
    let data = null;
    try { data = JSON.parse(raw); } catch (_) { return { finish: 'error', error: raw.trim() ? plainPage(raw) || 'the answer could not be read' : 'nothing came back', status: 0, text: '', thinking: '' }; }
    return whole(data);
  }
  split.end();
  const late = splitThink(text);
  if (late.thinking) { text = late.text; thinking = [thinking, late.thinking].filter(Boolean).join('\n\n'); }
  if (midError) { const e = errorOf(midError); return { finish: 'error', error: e.message, status: e.status, midStream: true, text, thinking, reason, usage: countOf(usage), sources }; }
  if (!text && !thinking && !ended) return { finish: 'error', error: 'the answer stopped before anything came', status: 0, text: '', thinking: '' };
  /* words came, then the line simply closed — no "finished" from the provider:
   * kept, and said to be possibly cut */
  const quiet = !ended && !cut;
  return { text, thinking, finish: cut ? 'length' : 'stop', usage: countOf(usage), reason, quiet, sources };
}

/* WHAT WAS SENT, kept as it went: the body's lists and objects copied, its
 * words shared (a string never changes). Never the headers — they carry his key. */
export function snapshotBody(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (Array.isArray(v)) out[k] = v.map((m) => (m && typeof m === 'object' ? { ...m } : m));
    else if (v && typeof v === 'object') out[k] = JSON.parse(JSON.stringify(v));
    else out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------ usage */
/* Every call counted as it lands, on the phone (Settings → Usage and cost):
 * the provider's own count, or the app's estimate when it gave none. */
export function noteUsage(conn, usage, sent, text) {
  try {
    const u = usage || null;
    const counted = Boolean(u && Number.isFinite(u.in));
    const d = new Date();
    const spec = {
      url: String((conn && conn.url) || ''), model: String((conn && conn.model) || ''),
      in: counted ? u.in : Math.max(0, Number((sent && sent.tokens) || 0)),
      out: u && Number.isFinite(u.out) ? u.out : estimateTokens(String(text || '')),
      cached: (u && Number.isFinite(u.cached) && u.cached) || 0,
      estimated: !counted,
      day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    };
    if (!spec.url || !spec.model) return;
    const p = fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* counting never stands in a page's way */ }
}

/* ------------------------------------------------------------ the call */

export const BACKOFF_MS = [3000, 8000, 20000];
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/* ask(conn, opts) — the whole call, with every lesson applied.
 *
 *   opts.build(conn) -> {system, systemParts?, messages, maxTokens, refuse?}
 *                       built again after a lesson that changes the room (a
 *                       "too long" refusal); refuse: the plain reason this
 *                       request cannot fit that room — then nothing is sent
 *   opts.stream      words as they come (default true)
 *   opts.worker      a helper's call: no prefill, no penalties or stop words
 *   opts.patient     a helper may wait out "slow down" and try again
 *   opts.signal      his Stop
 *   opts.onText / opts.onThinking   the words as they arrive
 *   opts.onSent(rec) where the request went and its body, word for word
 *
 * Returns {ok, text, thinking, cut, cutBy, finish, reason, usage, notes,
 * error, status, stopped, sent, thinkTokens, hiddenThought}. Never throws. */
export async function ask(conn, opts = {}) {
  if (!conn || !String(conn.url || '').trim() || !String(conn.model || '').trim()) {
    return { ok: false, text: '', thinking: '', notes: [], error: 'no connection is chosen for this yet — pick one in Settings → Connections' };
  }
  const stream = opts.stream !== false;
  const notes = [];
  let flags = { noPrefill: false, noUsage: false, maxCap: 0, noStructured: Boolean(opts.noStructured) };
  let lessons = 0;
  let keyMended = false;
  let transientTries = 0;
  let lastError = 'the call did not go through';
  let lastStatus = 0;
  const shapeOf = (c) => (typeof opts.build === 'function' ? opts.build(c)
    : { system: opts.system, systemParts: opts.systemParts, messages: opts.messages || [], maxTokens: opts.maxTokens });
  const sizeOf = (s) => estimateTokens(String((s && s.system) || ''))
    + ((s && s.messages) || []).reduce((a, m) => a + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')) + 8, 0);
  for (;;) {
    if (opts.signal && opts.signal.aborted) return { ok: false, stopped: true, text: '', thinking: '', notes, error: 'stopped' };
    const shape = shapeOf(conn);
    /* a request the builder knows cannot fit this model (its room, as a
     * lesson may just have taught it) is never sent: the builder's reason is */
    if (shape && shape.refuse) return { ok: false, text: '', thinking: '', notes, error: shape.refuse, status: lastStatus || 0 };
    const req = buildRequest(conn, { ...shape, stream, worker: Boolean(opts.worker), noPrefill: flags.noPrefill, noUsage: flags.noUsage, maxCap: flags.maxCap || undefined, noStructured: flags.noStructured, noSearch: Boolean(opts.noSearch) });
    if (req.prefill && req.prefill.note && !notes.includes(req.prefill.note)) notes.push(req.prefill.note);
    if (req.structured && req.structured.note && !notes.includes(req.structured.note)) notes.push(req.structured.note);
    const sent = { url: req.url, model: req.body && req.body.model, body: snapshotBody(req.body), at: Date.now(), tokens: sizeOf(shape), ...(req.structured ? { structured: true } : {}) };
    /* the started reply and the started thought are part of what comes back */
    let lead = req.prefill && req.prefill.applied ? String(req.prefill.content || '') : '';
    let thoughtLead = req.prefill && req.prefill.applied ? String(req.prefill.seed || '') : '';
    const gap = lead ? prefillGap(conn) : '';
    let text = '';
    let thinking = '';
    const emitText = (s) => {
      if (!s) return;
      if (lead) {
        const put = lead; lead = '';
        if (!s.startsWith(put)) { const back = put + (/^\s/.test(s) ? '' : gap); text += back; if (opts.onText) opts.onText(back); }
      }
      text += s;
      if (opts.onText) opts.onText(s);
    };
    const emitThinking = (s) => {
      if (!s) return;
      if (thoughtLead) {
        const put = thoughtLead; thoughtLead = '';
        if (!s.startsWith(put)) { const back = put + (/^\s/.test(s) ? '' : ' '); thinking += back; if (opts.onThinking) opts.onThinking(back); }
      }
      thinking += s;
      if (opts.onThinking) opts.onThinking(s);
    };
    /* STRUCTURED: the answer is JSON ({"response":"…"}) — its words are read
     * out of it as they stream, the hidden part held back, and a <think>…</think>
     * the template made it write goes to the thinking box (Tavern M580, M586) */
    let decoder = null;
    let onWords = emitText;
    if (req.structured) {
      decoder = makeStructuredDecoder({ hidden: req.structured.hidden });
      let sep = false;
      let begun = false;
      const splitter = makeThinkSplitter((kind, t) => {
        if (kind === 'thinking') { let x = t; if (!sep) { sep = true; if (thinking && !/\n\s*$/.test(thinking)) x = '\n\n' + x; } emitThinking(x); return; }
        let x = t;
        if (!begun) { x = x.replace(/^\s+/, ''); if (!x) return; begun = true; }
        emitText(x);
      });
      onWords = (raw) => { const w = decoder.feed(raw); if (w) splitter.feed(w); };
      onWords.end = () => { const w = decoder.end ? decoder.end() : ''; if (w) splitter.feed(w); splitter.end(); };
    }
    let out;
    try {
      const res = await fetch('/api/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: req.url, headers: req.headers, body: req.body, stream }),
        signal: opts.signal,
      });
      if (!res.ok) {
        out = { finish: 'error', error: res.status === 403 ? 'the phone’s server turned the call away' : `the phone’s server answered ${res.status}`, status: 0, text: '', thinking: '' };
      } else {
        out = await readReply(req.wire, res, { onText: onWords, onThinking: emitThinking, onNote: (n) => { if (!notes.includes(n)) notes.push(n); } });
        if (decoder && onWords.end) onWords.end();
      }
    } catch (e) {
      if ((e && e.name === 'AbortError') || (opts.signal && opts.signal.aborted)) {
        sent.ms = Date.now() - sent.at;
        if (opts.onSent) opts.onSent(sent);
        /* what streamed before Stop was paid for too */
        if (String(text + thinking).trim()) noteUsage(conn, null, sent, text + thinking);
        return { ok: false, stopped: true, text, thinking, notes, error: 'stopped', sent, cut: true };
      }
      out = { finish: 'error', error: 'the phone’s server could not be reached (is Cozy Novel still running in Termux?)', status: 0, phone: true, text, thinking };
    }
    sent.ms = Date.now() - sent.at;
    sent.usage = out.usage || null;
    sent.finish = out.finish;
    if (out.finish === 'error') sent.error = out.error;

    if (out.finish === 'error' && !text) {
      lastError = String(out.error || '');
      lastStatus = Number(out.status) || 0;
      const fourHundred = !out.midStream && (lastStatus === 400 || lastStatus === 422 || lastStatus === 413);
      const body = req.body || {};
      const sentMax = Number(body.max_tokens || body.max_completion_tokens) || 0;
      /* ---- the request put right, from what the provider said ---- */
      if (lessons < 12) {
        /* Tavern M318: DeepSeek's beta address is asked about itself first.
         * Whatever it says no to, the request goes again at the ordinary
         * address without the prefill; only a no that names the prefix is
         * remembered, and only against the prefill. */
        const betaBase = req.prefill && req.prefill.applied && prefillProfile(conn) === 'deepseek' ? deepseekBetaBase(conn.url) : '';
        if (betaBase && String(req.url).startsWith(betaBase) && !flags.noPrefill && (fourHundred || lastStatus === 404)) {
          if (fourHundred && PREFILL_REFUSAL.test(lastError)) {
            learn(conn, { prefillDownAt: Date.now() });
            notes.push('This model would not continue a started reply, so it was sent without the prefill — and it is not offered one from now on.');
          } else {
            notes.push(`DeepSeek’s beta address would not take this request (${lastStatus}), so it went to the ordinary address without the prefill this once.`);
          }
          flags = { ...flags, noPrefill: true };
          lessons++;
          continue;
        }
      }
      /* a model that takes no structured answer: remembered for its model, and
       * the page goes again with the prefill as written (Tavern M580) */
      if (req.structured && !flags.noStructured && lessons < 12 && (fourHundred || lastStatus === 404) && STRUCTURED_REFUSAL.test(lastError || String(lastStatus))) {
        learn(conn, { structuredDownAt: Date.now() });
        notes.push(`This model would not take a structured prefill (${String(lastError || lastStatus).slice(0, 120)}), so the page went with the prefill as written — and it goes so for this model from now on.`);
        flags = { ...flags, noStructured: true };
        lessons++;
        continue;
      }
      if (fourHundred && lessons < 12) {
        /* the reply's length, named the way this address wants it */
        if ('max_tokens' in body && COMPLETION_FIELD_REFUSAL.test(lastError) && !(learnedFacts(conn) || {}).completionField) {
          learn(conn, { completionField: true });
          lessons++;
          continue;
        }
        /* a longer reply than the model can give: its own number, kept */
        const replyCap = REPLY_TOO_LONG.test(lastError) ? replyLimitFrom(lastError) : 0;
        if (replyCap && sentMax > replyCap) {
          learn(conn, { maxOut: replyCap });
          notes.push(`This model gives at most ${replyCap.toLocaleString()} tokens in one reply, so the reply was fitted to that — and is from now on.`);
          lessons++;
          continue;
        }
        /* more words than the model holds */
        const tooLong = CONTEXT_REFUSAL.test(lastError) || REPLY_TOO_LONG.test(lastError);
        if (tooLong) {
          const said = contextFrom(lastError);
          const now = contextOf(conn);
          let mended = false;
          /* the book fitted to a smaller room — kept only when that really
           * makes the request smaller, so a request that cannot shrink is
           * never asked again and again */
          /* the request built again for a smaller room — the model's own number, or a guess */
          const trialAt = (size, guess) => shapeOf({ ...conn, learned: { ...((learnedFacts(conn) && conn.learned) || {}), for: learnKey(conn), at: Date.now(), context: size, contextGuess: guess } });
          /* the size the model said it holds, when that is less than the room
           * the request was made for */
          let next = said && said < now ? said : 0;
          let trialShape = null;
          if (typeof opts.build === 'function' && next >= 2000) {
            trialShape = trialAt(next, false);
            /* that size cannot hold even the part that has to go (his
             * instructions, the modules, the talk, the room for the answer):
             * its number is kept, and the builder's reason — made for that
             * size — is said; nothing more is sent */
            if (trialShape && trialShape.refuse) {
              learn(conn, { context: said });
              if (opts.onSent) opts.onSent(sent);
              return { ok: false, text: '', thinking: '', notes, error: trialShape.refuse, status: lastStatus, sent, permanent: true };
            }
          }
          if (typeof opts.build === 'function' && !next) {
            /* no size said, or one no smaller than the room: the model counts
             * the request bigger than this app does — the book is fitted a
             * quarter smaller, and never below what has to go with it (a
             * guess is never a reason to refuse) */
            const least = Number(shape && shape.least) || 0;
            next = Math.max(Math.floor(now * 0.75), least > 0 ? least + 2000 : 0);
            trialShape = next >= 2000 && next < now ? trialAt(next, true) : null;
            if (trialShape && trialShape.refuse) trialShape = null;
          }
          if (trialShape && next >= 2000 && next < now) {
            const trialSize = sizeOf(trialShape);
            if (trialSize < sizeOf(shape) * 0.97) {
              /* the model's own number, or this app's guess — a guess fits the
               * book, but is never a reason to refuse a page (context.js) */
              learn(conn, { context: next, contextGuess: next !== said });
              notes.push(`The model said the request was longer than it holds, so the book was fitted to ${next.toLocaleString()} tokens and sent again.`);
              mended = true;
              /* and when even the fitted request leaves less than the reply's room, the reply gets what is left */
              const left = said ? said - trialSize - 256 : 0;
              if (said && sentMax && trialSize + sentMax > said && left >= 512) {
                flags = { ...flags, maxCap: left };
                notes.push(`The model holds ${said.toLocaleString()} tokens in all, so this reply was given the ${left.toLocaleString()} left after the request.`);
              }
            }
          }
          /* the request fits, but not with the reply's room on top: the
           * reply gets what is left */
          if (!mended && said && sentMax) {
            const used = inputFrom(lastError) || sizeOf(shape);
            const left = said - used - 256;
            if (left >= 512 && left < sentMax && (!flags.maxCap || left < flags.maxCap)) {
              flags = { ...flags, maxCap: left };
              notes.push(`The model holds ${said.toLocaleString()} tokens in all, so this reply was given the ${left.toLocaleString()} left after the request.`);
              mended = true;
            }
          }
          /* the model's own number is kept even when nothing more could be done now */
          if (!mended && said && said < now) learn(conn, { context: said });
          if (mended) { lessons++; continue; }
        }
        if (body.stream_options && /stream_options|include_usage/i.test(lastError)) {
          learn(conn, { drop: ['stream_options'] });
          lessons++;
          continue;
        }
        const sentKnobs = [...KNOB_FIELDS, 'stop_sequences'].filter((f) => f in body);
        const knob = sentKnobs.length ? knobRefused(lastError, sentKnobs) : '';
        if (knob) {
          learn(conn, { drop: [knob] });
          notes.push(`This address does not take “${knob}”, so it was sent again without it — it is left out from now on, and the rest of your dials still ride.`);
          lessons++;
          continue;
        }
        if (hasLateSystem(shape.messages) && /system/i.test(lastError) && !(learnedFacts(conn) || {}).noLateSystem) {
          learn(conn, { noLateSystem: true });
          notes.push('This model takes no system message after the request, so your note at the end rode at the end of the request instead.');
          lessons++;
          continue;
        }
        if (req.prefill && req.prefill.applied && PREFILL_REFUSAL.test(lastError) && !flags.noPrefill) {
          learn(conn, { prefillDownAt: Date.now() });
          notes.push('This model would not continue a started reply, so it was sent without the prefill — and it is not offered one from now on.');
          flags = { ...flags, noPrefill: true };
          lessons++;
          continue;
        }
        if (THINKING_FIELDS.some((f) => f in body) && REASONING_REFUSAL.test(lastError)) {
          const before = thinkingPart(body);
          learn(conn, lessonFor(lastError, body));
          if (thinkingPart(buildRequest(conn, { ...shape, stream, worker: Boolean(opts.worker), noPrefill: flags.noPrefill }).body) === before) learn(conn, { downAt: Date.now() });
          notes.push('The thinking setting was not taken as sent, so it was fitted to what this model takes and sent again.');
          lessons++;
          continue;
        }
        /* a refusal that names nothing while the usage request rode: once more without it,
         * and when that goes through, the address is taught (Tavern M510-25). A
         * refusal already read as "too long" named its cause: not sent again. */
        if (body.stream_options && !flags.noUsage && !tooLong) { flags = { ...flags, noUsage: true, usageTried: true }; lessons++; continue; }
      }
      if (!keyMended && await repairHermesKey(conn, lastStatus)) { keyMended = true; continue; }
      /* only a helper waits out a passing fault; a page never asks again by itself */
      const transient = lastStatus === 0 || lastStatus === 408 || lastStatus === 429 || lastStatus >= 500;
      if (opts.patient && transient && transientTries < BACKOFF_MS.length && !(opts.signal && opts.signal.aborted)) {
        const retryAfter = Number(out.retryAfter) * 1000;
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60000) : BACKOFF_MS[transientTries], opts.signal);
        transientTries++;
        continue;
      }
      if (opts.onSent) opts.onSent(sent);
      return { ok: false, text: '', thinking, notes, error: plainError(lastError, lastStatus, { transport: out.transport, phone: out.phone }), status: lastStatus, sent,
        permanent: !transient && lastStatus !== 0 };
    }
    if (opts.onSent) opts.onSent(sent);
    noteUsage(conn, out.usage, sent, text + thinking);
    /* a request whose thinking seed opened the thinking on purpose says nothing about Off */
    const opened = Boolean(req.prefill && req.prefill.applied && req.prefill.keepThinkingOpen && (conn.thinking === 'off' || conn.thinking === false));
    if (!opened) noticeOff(conn, thinking);
    if (flags.usageTried) learn(conn, { drop: ['stream_options'] });
    const extra = { thinkTokens: Number(out.thinkTokens) || 0, hiddenThought: Boolean(out.hiddenThought) };
    if (out.finish === 'error') {
      /* broken off partway: what arrived is kept, and said to be cut */
      return { ok: true, text, thinking, cut: true, cutBy: 'provider', finish: 'error', notes, error: plainError(out.error, out.status), usage: out.usage || null, sent, sources: out.sources || [], ...extra };
    }
    const reason = out.reason || '';
    const blocked = BLOCKED.test(reason);
    const byLength = out.finish === 'length' || /^(?:length|max_tokens|max_output_tokens)$/i.test(reason);
    const quiet = Boolean(out.quiet && String(text).trim());
    if (blocked && String(text).trim()) notes.push(`The provider stopped the answer here (its reason: ${reason}).`);
    else if (quiet && !byLength) notes.push('The answer ended without the provider saying it was finished, so it may have been cut short.');
    if (out.sources && out.sources.length) notes.push(`It looked things up: ${out.sources.length} page${out.sources.length === 1 ? '' : 's'}.`);
    return { ok: true, text, thinking, cut: byLength || blocked || quiet, cutBy: blocked ? 'filter' : byLength ? 'length' : quiet ? 'quiet' : undefined,
      finish: out.finish, reason, usage: out.usage || null, notes, sent, sources: out.sources || [], ...extra };
  }
}

/* a stop the provider made for its own reasons, in the words houses use */
export const BLOCKED = /content_filter|safety|blocked|prohibited|refus|recitation|spii|policy|moderation/i;

/* WHY AN ANSWER CAME BACK EMPTY, IN THE PROVIDER'S OWN WORD (Tavern M545) —
 * never a guess. */
export function emptyWhy(out, thinking = '') {
  const why = String((out && out.reason) || '').trim();
  const thought = String(thinking || (out && out.thinking) || '').trim().length > 0 || Boolean(out && (out.thinkTokens > 0 || out.hiddenThought));
  if (/max_tokens|length/i.test(why)) {
    return thought
      ? 'the model used all of its room thinking and had none left to write — a larger “Longest reply” on this connection, or less thinking, gives it room'
      : 'the provider stopped the answer for length before any words came — the reply room on this connection is too small';
  }
  if (BLOCKED.test(why)) return `the provider blocked the answer${thought ? ' after the thinking' : ''} (its reason: ${why})`;
  if (why && !/^(?:stop|end_turn|stop_sequence|eos)$/i.test(why)) return `the provider ended its answer${thought ? ' after the thinking' : ''} with nothing in it (its reason: ${why})`;
  if (thought) return 'the model only thought and wrote nothing — try again, or turn its thinking down';
  return 'the model sent back nothing, and the provider gave no reason';
}

/* An error page (a gateway's HTML) as the few words it says. */
export function plainPage(raw) {
  const s = String(raw || '');
  if (!/<(?:!doctype|html|head|body|title|h1)\b/i.test(s)) return '';
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(s);
  const pick = (title && title[1]) || (h1 && h1[1]) || s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ');
  return pick.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/* What the phone's relay says when the address could not be reached at all. */
function plainTransport(s) {
  const t = String(s || '');
  if (/name or service not known|nodename nor servname|temporary failure in name resolution|getaddrinfo|errno -[23]\b|no address associated/i.test(t)) return 'that address could not be found — check it, and that the phone is online';
  if (/connection refused|errno 111\b/i.test(t)) return 'nothing answered at that address — is the server there running?';
  if (/timed? ?out/i.test(t)) return 'the provider took too long to answer';
  if (/certificate|ssl|tls/i.test(t)) return 'the provider’s secure connection could not be checked (its certificate)';
  if (/network is unreachable|no route to host|errno 101\b|errno 113\b/i.test(t)) return 'the phone could not reach the internet just now';
  if (/connection reset|broken pipe|remote end closed|incomplete ?read|line dropped/i.test(t)) return 'the provider’s line dropped';
  return '';
}

/* The provider's words, made readable: a JSON error body becomes its message,
 * an error page its title, the relay's network trouble plain words. */
export function plainError(detail, status, { transport = false, phone = false } = {}) {
  let s = String(detail || '').trim();
  if (phone) return s || 'the phone’s server could not be reached';
  let j = null;
  try { j = JSON.parse(s); } catch (_) { j = null; }
  if (Array.isArray(j)) j = j[0];                         /* Gemini wraps its error in a list */
  if (j && typeof j === 'object') {
    const e = j.error && typeof j.error === 'object' ? j.error : j;
    let m = (typeof e.message === 'string' && e.message) || (typeof j.error === 'string' && j.error) || (typeof j.message === 'string' && j.message) || (typeof j.detail === 'string' && j.detail) || '';
    /* OpenRouter: "Provider returned error", with the real cause inside */
    const raw = e.metadata && e.metadata.raw;
    if (raw && (/provider returned error/i.test(m) || !m)) {
      let inner = typeof raw === 'string' ? raw : JSON.stringify(raw);
      try { const r = JSON.parse(inner); const ie = r && (r.error || r); inner = (ie && (ie.message || (typeof ie === 'string' ? ie : ''))) || inner; } catch (_) { /* plain words */ }
      const who = e.metadata.provider_name ? `${e.metadata.provider_name} said: ` : '';
      m = `${who}${String(inner).trim()}`;
    }
    if (m) s = m;
  } else {
    const page = plainPage(s);
    if (page) s = page;
  }
  if (transport || (!status && plainTransport(s))) {
    const said = plainTransport(s);
    if (said) return said;
  }
  s = s.replace(/\s+/g, ' ').slice(0, 400);
  const keyWords = /api[ _-]?key not valid|invalid api[ _-]?key|incorrect api key|invalid x-api-key|invalid authentication|unauthori[sz]ed|authentication fail/i;
  const why = status === 401 || status === 403 || keyWords.test(s) ? 'the key was refused'
    : status === 402 ? 'the account is out of credit'
      : status === 413 ? 'the request was too big for the provider to take'
      : status === 404 ? 'that model or address was not found'
        : status === 429 ? 'the provider asked to slow down'
          : status >= 500 ? 'the provider had trouble on its side' : '';
  if (why && s) return `${why} (${status ? status + ': ' : ''}${s})`;
  if (why) return `${why}${status ? ` (${status})` : ''}`;
  return s || 'the call did not go through';
}

/* --------------------------------------------------- models and Try it */

export async function listModels(conn) {
  const url = modelsUrl(conn);
  if (!url) return { ok: false, error: 'there is no address yet' };
  try {
    const res = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers: headersFor(conn), method: 'GET', timeout: 30 }) });
    const data = await res.json();
    if (data && data.error) return { ok: false, error: plainError(data.error === 'provider' || data.error === 'transport' ? data.detail || '' : data.detail || data.error, data.status, { transport: data.error === 'transport' }) };
    const rows = Array.isArray(data && data.data) ? data.data : Array.isArray(data && data.models) ? data.models : Array.isArray(data) ? data : [];
    const models = rows.filter((m) => m && (m.id || m.name)).map((m) => ({ id: String(m.id || m.name).replace(/^models\//, ''), ...reportedIdentity(m) }));
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, models };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

/* DOES IT WORK, AND DOES IT THINK AT THE LEVEL SET? (Tavern M351, M373) Sends
 * exactly what a page sends for the thinking — never the page's structured
 * schema nor its web search, which would answer for themselves — and says
 * plainly what came back; when a level gave no thinking, asks once more at
 * the top level, so he is told whether it is this LEVEL or this ADDRESS that
 * gives none. Then one streamed answer, timed: how soon its first words came
 * and how fast it writes. */
export const SPEED_ASK = 'Write three short paragraphs, about three hundred words in all, of rain on a window at night.';
export const SPEED_MAX_TOKENS = 1200;

export function speedWords(m) {
  if (!m) return '';
  const secs = (ms) => (ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)) + ' s';
  if (m.firstMs === null) return 'Speed: nothing streamed back to time (' + secs(m.totalMs) + ' in all).';
  const rate = m.tps !== null ? (m.estimated ? 'about ' : '') + Math.round(m.tps) + ' tokens a second' : 'too short an answer to time its writing';
  return 'Speed: first words after ' + secs(m.firstMs) + ' · ' + rate + ' (' + m.tokens.toLocaleString() + (m.estimated ? ' tokens, estimated from its length' : ' tokens') + ' in ' + secs(m.totalMs) + ').';
}

/* one streamed answer, timed, with his own settings */
export async function measureSpeed(conn, { now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
  const t0 = now();
  let first = null;
  let words = '';
  const mark = () => { if (first === null) first = now() - t0; };
  const out = await ask(conn, { build: () => ({ messages: [{ role: 'user', content: SPEED_ASK }], maxTokens: SPEED_MAX_TOKENS }), stream: true, noStructured: true, noSearch: true,
    onText: (t) => { mark(); words += t; }, onThinking: (t) => { mark(); words += t; } });
  if (!out.ok) return null;
  const totalMs = now() - t0;
  const counted = out.usage && Number.isFinite(out.usage.out) ? out.usage.out : null;
  const tokens = counted !== null ? counted : estimateTokens(words);
  const writing = first === null ? 0 : totalMs - first;
  const tps = first !== null && writing >= 250 && tokens >= 20 ? tokens / (writing / 1000) : null;
  return { firstMs: first === null ? null : Math.round(first), totalMs: Math.round(totalMs), tokens, estimated: counted === null, tps };
}

export async function tryConnection(conn, { speed = true } = {}) {
  const level = conn && conn.thinking ? String(conn.thinking) : '';
  const go = (c) => ask(c, { build: () => ({ messages: [{ role: 'user', content: 'Answer with one word: ready.' }], maxTokens: 2000 }), stream: false, worker: false, noStructured: true, noSearch: true });
  const first = await go(conn);
  if (!first.ok) return { ok: false, words: `Not working — ${first.error}` };
  const answered = String(first.text || '').trim();
  const said = answered ? ` It answered “${answered.slice(0, 30)}”.` : ` It wrote no answer — ${emptyWhy(first, first.thinking)}.`;
  const at = level ? `Asked at “${level}” (${spokenAs(conn)})` : 'Asked with nothing said about thinking, so the model decided';
  const pf = describePrefill(conn);
  let verdict;
  let thinks = false;
  if (String(first.thinking || '').trim()) { thinks = true; verdict = `${at} — ${first.thinking.trim().length.toLocaleString()} characters of thinking came back. Thinking works on this connection.`; }
  else if (first.thinkTokens > 0) { thinks = true; verdict = `${at} — it reported ${first.thinkTokens.toLocaleString()} thinking tokens, so the model DID think — this address keeps the words to itself.`; }
  else if (first.hiddenThought) { thinks = true; verdict = `${at} — it thought, and the provider kept the thinking hidden.`; }
  else if (level === 'off' || !level) verdict = `${at} — it answered without thinking.`;
  else if (level === 'max') verdict = `${at} — the answer came, but NO thinking with it. At the top level too, so this address sends no thinking back at all — the model may still think inside it.`;
  else {
    /* none at this level: once more at the top, to tell the level from the address */
    const top = await go({ ...conn, thinking: 'max' });
    const back = top.ok && (String(top.thinking || '').trim() || top.thinkTokens > 0 || top.hiddenThought);
    verdict = `${at} — the answer came, but NO thinking with it.` + (!top.ok ? ' (The top level was refused, so it could not be compared.)'
      : back ? ` Asked again at “max” — ${String(top.thinking || '').trim() ? `${String(top.thinking).trim().length.toLocaleString()} characters came back` : top.thinkTokens > 0 ? `${top.thinkTokens.toLocaleString()} thinking tokens were reported` : 'it thought, kept hidden'}. So it is this LEVEL that gives none here, not the address: choose a higher one.`
        : ' Nor at “max” — this address sends no thinking back at any level, though the model may still think inside it.');
  }
  const m = speed ? await measureSpeed(conn) : null;
  const tail = (pf ? ` Prefill: ${pf}` : '') + (first.notes.length ? ' ' + first.notes.join(' ') : '');
  return { ok: true, thinks, speed: m, words: `Working. ${verdict}${said}${m ? ' ' + speedWords(m) : ''}${tail}` };
}

/* "Test it" — THE PREFILL'S OWN PROBE (Tavern M22-D, M328, M329, M587): a tiny
 * exchange with the prefill applied exactly as a page applies it — the
 * thinking dial, the seed, the two field names, the beta address — and the
 * reply READ: did the model think on from the seed, did the reply go on from
 * his words. Set to Structured, it asks the structured way, with the very
 * schema a page carries. A refusal teaches the connection, as on a page; a
 * fresh yes lifts an old refusal (clearDown). Returns {ok, words, clearDown}. */
async function rawCall(req) {
  try {
    const res = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: req.url, headers: req.headers, body: req.body, stream: false }) });
    if (!res.ok) return { ok: false, status: 0, detail: `the phone’s server answered ${res.status}` };
    let data = null;
    try { data = await res.json(); } catch (_) { return { ok: false, status: 0, detail: 'the answer could not be read' }; }
    if (data && data.error) return { ok: false, status: Number(data.status) || 0, detail: String((data.error === 'provider' || data.error === 'transport' ? data.detail : data.detail || data.error) || ''), transport: data.error === 'transport' };
    return { ok: true, data };
  } catch (_) {
    return { ok: false, status: 0, detail: '', phone: true };
  }
}
export async function testPrefill(conn) {
  const prefill = String((conn && conn.prefill) || '');
  if (!prefill.trim()) return { ok: false, words: 'There’s no prefill to try — write one first.' };
  /* a refusal of before is set aside for the probe: it asks afresh */
  const fresh = { ...conn, learned: conn.learned ? { ...conn.learned, prefillDownAt: null, structuredDownAt: null } : conn.learned };
  const plan = structuredPlanFor(fresh);
  if (plan) {
    const req = buildRequest(fresh, { messages: [{ role: 'user', content: 'Write one short paragraph of a story — a gate at dawn.' }], maxTokens: 600, stream: false, noSearch: true });
    const r = await rawCall(req);
    if (!r.ok) {
      if (r.phone) return { ok: false, words: 'The phone’s server could not be reached (is Cozy Novel still running in Termux?).' };
      if (STRUCTURED_REFUSAL.test(r.detail || String(r.status))) {
        learn(conn, { structuredDownAt: Date.now() });
        return { ok: false, words: `This model would not take a structured prefill (${plainError(r.detail, r.status).slice(0, 140)}) — its pages will get the prefill as written.` };
      }
      return { ok: false, words: `It refused the test — ${plainError(r.detail, r.status, { transport: r.transport })}.` };
    }
    const said = (readAnswer(req.wire, r.data).text) || '';
    const words = unwrapStructured(said, { hidden: plan.hidden });
    const opening = readTemplate(plan.template).shown.split(/\[\[/)[0].replace(/<\/?think>/g, '').trim();
    let held = false;
    try { held = new RegExp(plan.schema.properties.response.pattern).test(unwrapStructured(said)); } catch (_) { held = false; }
    if (held) return { ok: true, clearDown: true, words: 'Structured works on this model — its answer opened ' + (opening ? 'with “' + opening.slice(0, 60) + '”' : 'as your template asks') + ': “' + words.replace(/\s+/g, ' ').slice(0, 120) + '…”' };
    return { ok: false, words: 'The model answered, but not in the shape asked (the provider did not hold it to the schema): “' + String(said).replace(/\s+/g, ' ').slice(0, 120) + '”. Its pages may not open with your words — As written may serve better here.' };
  }
  const req = buildRequest(fresh, { messages: [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'B' }, { role: 'user', content: 'C' }], maxTokens: 8, stream: false, noSearch: true, noStructured: true });
  if (!req.prefill || !req.prefill.applied) {
    const why = prefillPlan(fresh).why;
    return { ok: false, words: why ? `${why} Nothing was sent.` : 'This address has no known way to start the reply for it — nothing was sent.' };
  }
  const seeded = Boolean(req.prefill.seed);
  const body = req.body;
  if (seeded) {
    /* room for a first few words of thinking to come back and be seen */
    for (const k of ['max_tokens', 'max_completion_tokens']) if (k in body) body[k] = 96;
  } else {
    for (const k of ['reasoning', 'reasoning_effort', 'thinking', 'enable_thinking', 'model_options', 'output_config']) delete body[k];
  }
  const r = await rawCall(req);
  if (!r.ok) {
    if (r.phone) return { ok: false, words: 'The phone’s server could not be reached (is Cozy Novel still running in Termux?).' };
    if ((r.status === 400 || r.status === 422) && PREFILL_REFUSAL.test(r.detail)) {
      learn(conn, { prefillDownAt: Date.now() });
      return { ok: false, words: 'Won’t take a prefill — sent without it from here on, until the model changes.' };
    }
    return { ok: false, words: `It refused the test — ${plainError(r.detail, r.status, { transport: r.transport })}.` };
  }
  const got = readAnswer(req.wire, r.data);
  const thought = String(got.thinking || '').trim();
  const saidBack = String(got.text || '').trim();
  const clip = (t) => (t.length > 70 ? t.slice(0, 70) + '…' : t);
  if (seeded) {
    if (thought) return { ok: true, clearDown: true, words: 'Working — the model took your seed and thought on from it: “…' + clip(thought) + '”' };
    if (saidBack) return { ok: false, words: 'Accepted, but NO thinking came back — this model answered straight away (“' + clip(saidBack) + '”), so a seed steers nothing here. It may not think, or this address drops the thinking field.' };
    return { ok: false, words: 'Accepted, but nothing came back in this short probe — it cannot tell whether the seed was used.' };
  }
  const started = String(req.prefill.content || '');
  if (saidBack && started && saidBack.startsWith(started)) return { ok: true, clearDown: true, words: 'Took it — this address echoes your words back before going on (the app never doubles them).' };
  return { ok: true, clearDown: true, words: saidBack ? 'Working — the reply went on from your words: “' + clip(started) + '” → “' + clip(saidBack) + '”' : 'Took it — the address accepted a started reply (nothing came back in this short probe to show).' };
}

export { wireOf };
