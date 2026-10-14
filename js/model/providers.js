/* Cozy Novel — js/model/providers.js
 *
 * ONE way out to a model, for the writer, the partner and the helper alike.
 *
 * THE SETTINGS LAW (his): a value he set is sent, exactly as set. A value he
 * did NOT set is not sent at all, so the provider's own default applies. The
 * one override is a floor that prevents corruption: a model that thinks,
 * pointed at a small reply budget, spends the budget thinking and returns an
 * empty page — where thinking is on, the room is raised to a floor, never
 * lowered.
 *
 * The thinking half below is Cozy Tavern's, as CozyMaker ported it whole and
 * held it to Tavern's real output (tests/fixtures/tavern-thinking.json, 198
 * cases — the same fixture holds this copy). The prefill is Tavern's M307/M328
 * (his Prefill Control extension); the rest of the dials are Tavern's M510.
 */

import { structuredSchema, hiddenMatcher, asciiOnly, MIN_AFTER_DEFAULT, bannedPattern, readTemplate } from './structured.js';

export const WORKER_ROOM = 2400;      /* a helper's answer needs this much room */
export const ALWAYS_THINKS_FLOOR = 16000;
export const DEFAULT_CONTEXT = 128000;

/* Which house is this address. */
export function houseOf(url) {
  const u = String(url || '').toLowerCase();
  /* Anthropic's own address, and the Anthropic-shaped addresses other houses
   * publish under /anthropic (DeepSeek, Moonshot, Z.ai): same body, same path. */
  if (u.includes('api.anthropic.com') || /\/anthropic(\/v\d+)?\/?(messages\/?)?$/.test(u.split('?')[0])) return 'anthropic';
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('bigmodel.cn') || u.includes('z.ai')) return 'zai';
  if (u.includes('moonshot')) return 'moonshot';
  if (u.includes('deepseek')) return 'deepseek';
  if (u.includes('dashscope') || u.includes('qwen')) return 'qwen';
  return 'openai';
}
/* The wire this connection speaks: Anthropic's messages, or the OpenAI-shaped
 * chat everyone else speaks. "shape" is set only when he says so on the form
 * (an Anthropic-shaped proxy at an address that does not look like one). */
export function wireOf(conn) {
  const c = conn || {};
  if (c.shape === 'anthropic') return 'anthropic';
  if (c.shape === 'openai') return houseOf(c.url) === 'anthropic' ? 'openai' : houseOf(c.url);
  return houseOf(c.url);
}

/* Models that think whether or not anyone asked. (OpenAI's GPT-5 family
 * reasons on every answer, except its chat model.) */
export function alwaysThinks(model) {
  const m = String(model || '').toLowerCase();
  return /(^|[^a-z])o[134](-|$)/.test(m) || m.includes('thinking') ||
         m.includes('reason') || /kimi-k[23]/.test(m) || m.includes('qwq') ||
         (/(^|\/)gpt-5(?![\d.])/.test(m) && !m.includes('chat'));
}

export function endpoint(conn) {
  const base = String(conn.url || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (/\/(chat\/completions|messages)$/.test(base)) return base;
  if (wireOf(conn) === 'anthropic') return /\/v\d+$/.test(base) ? base + '/messages' : base + '/v1/messages';
  if (/\/v\d+[a-z]*$/.test(base) || /\/openai$/.test(base)) return base + '/chat/completions';
  return base + '/v1/chat/completions';
}

export function headersFor(conn) {
  const h = {};
  if (wireOf(conn) === 'anthropic') {
    h['x-api-key'] = conn.key || '';
    h['anthropic-version'] = '2023-06-01';
  } else if (conn.key) {
    h['Authorization'] = 'Bearer ' + conn.key;
  }
  if (houseOf(conn.url) === 'openrouter') {
    h['HTTP-Referer'] = 'http://127.0.0.1/cozynovel';
    h['X-Title'] = 'Cozy Novel';
  }
  return h;
}

/* ------------------------------------------------- thinking (Cozy Tavern's) */

export const EFFORT_RANK = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
export const LEVELS = EFFORT_RANK;

export const EFFORT_LEVELS = {
  anthropic: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openrouter: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  zai: ['off', 'low', 'high', 'max'],
  qwen: ['off', 'low', 'medium', 'high'],
  hermes: ['off', 'low', 'medium', 'high'],
  deepseek: ['off', 'low', 'high', 'max'],
  kimi: ['low', 'high', 'max'],
  kimi2: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  none: ['off', 'low', 'medium', 'high'],
};

export const EFFORT_ALIAS = {
  zai: { medium: 'high', xhigh: 'max' },
  deepseek: { medium: 'high', xhigh: 'max' },
  kimi: { off: 'low', medium: 'high', xhigh: 'max' },
};

function isAnthropicShape(conn) { return wireOf(conn) === 'anthropic'; }

/* Which family's words this connection speaks (Tavern familyStyle). */
export function familyStyle(conn) {
  const c = conn || {};
  if (isAnthropicShape(c)) return 'anthropic';
  const url = String(c.url || '').toLowerCase();
  /* an alias hides a model's family (Synthetic serves Kimi K3 as
   * "syn:large:vision"): the weights its provider's list names are read too */
  const names = [c.model, c.modelHf].filter(Boolean).map((n) => String(n).toLowerCase());
  const model = names[0] || '';
  const any = (re) => names.some((n) => re.test(n));
  if (c.preset === 'hermes' || model === 'hermes-agent') return 'hermes';
  if (c.preset === 'openrouter' || url.includes('openrouter.ai')) return 'openrouter';
  const kimiHost = url.includes('moonshot') || /(^|[/.])kimi\.(ai|com)([/:]|$)/.test(url);
  if (any(/kimi[-_.]?k[3-9]/) || (kimiHost && names.some((n) => /^k[3-9]\b/.test(n)))) return 'kimi';
  if (kimiHost && /^kimi/.test(model)) return /k2\.?7-code/.test(model) ? 'none' : 'kimi2';
  if (c.preset === 'zai' || url.includes('api.z.ai') || any(/\bglm\b|^glm|glm-/)) return 'zai';
  if (any(/qwen/)) return 'qwen';
  if (c.preset === 'deepseek' || url.includes('deepseek') || any(/^deepseek/)) return 'deepseek';
  return 'openai';
}

/* A Hermes Agent on the phone: named as one, or the agent's own address. */
export function hermesLike(conn) {
  const c = conn || {};
  if (c.preset === 'hermes' || String(c.model || '') === 'hermes-agent') return true;
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):8642(?:\/|$)/i.test(String(c.url || ''));
}

export function glmVersion(conn) {
  const m = /glm[-_.]?(\d+)(?:[._](\d+))?/.exec(String((conn && conn.model) || '').toLowerCase());
  return m ? Number(m[1]) + (m[2] ? Number('0.' + m[2]) : 0) : null;
}

/* A model that cannot be told not to think. */
export function cannotStopThinking(conn) {
  const style = familyStyle(conn);
  if (style === 'kimi') return true;
  if (style === 'zai') { const v = glmVersion(conn); return v !== null && v >= 5.3; }
  return false;
}

export function zaiWire(effort, version) {
  const e = effort === 'medium' ? 'high' : effort === 'xhigh' ? 'max' : effort;
  if (version !== null && version >= 5.3) return { thinking: { type: 'enabled' }, reasoning_effort: e === 'off' ? 'low' : e };
  if (version !== null && version < 5.2) return { thinking: { type: e === 'off' ? 'disabled' : 'enabled' } };
  if (e === 'off') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: e === 'low' ? 'high' : e };
}

/* The level this connection can actually SAY. */
export function effortFor(style, eff) {
  const lv = EFFORT_LEVELS[style] || EFFORT_LEVELS.openai;
  const e = (EFFORT_ALIAS[style] && EFFORT_ALIAS[style][eff]) || eff;
  let r = EFFORT_RANK.indexOf(e);
  if (r < 0) r = 0;
  while (r > 0 && lv.indexOf(EFFORT_RANK[r]) < 0) r--;
  if (lv.indexOf(EFFORT_RANK[r]) >= 0) return EFFORT_RANK[r];
  if (lv.indexOf('off') < 0) { const least = lv.find((l) => l !== 'off'); if (least) return least; }
  return 'off';
}

export function hostIsOpenAI(url) { return /(^|\/\/)api\.openai\.com(\/|$)/i.test(String(url || '')); }

/* The thinking ROOM: only Claude takes a budget directly (never under its own
 * floor of 1,024), and through OpenRouter only Claude and Gemini. */
export const CLAUDE_BUDGET_FLOOR = 1024;
export function budgetFor(conn) {
  const c = conn || {};
  const asked = Number(c.thinkingBudget) > 0 ? Math.round(Number(c.thinkingBudget)) : 0;
  const model = String(c.model || '').toLowerCase();
  const url = String(c.url || '').toLowerCase();
  if (isAnthropicShape(c)) {
    if (/deepseek/.test(url + ' ' + model)) return { sent: false, tokens: 0 };
    const tokens = asked ? Math.max(CLAUDE_BUDGET_FLOOR, asked) : 0;
    return { sent: Boolean(tokens), tokens };
  }
  if (familyStyle(c) === 'openrouter' && /^(anthropic|google)\//.test(model)) return { sent: Boolean(asked), tokens: asked };
  return { sent: false, tokens: 0 };
}

/* WHAT THE MODEL ITSELF TAUGHT THE HOUSE: the levels a refusal said it takes, a
 * field it does not take, an Off that did not stop it, a context it said it
 * has. Kept per model at its address, for thirty days. A plain refusal of
 * thinking is kept for a day — one that happened for a passing reason heals. */
export const LEARN_FOR_MS = 30 * 24 * 60 * 60 * 1000;
export const REFUSAL_MEMORY_MS = 24 * 60 * 60 * 1000;
export function learnKey(conn) { return String((conn && conn.model) || '') + '@' + String((conn && conn.url) || ''); }
export function learnedFacts(conn, now = Date.now()) {
  const L = conn && conn.learned;
  if (!L || L.for !== learnKey(conn)) return null;
  if (Number.isFinite(L.at) && now - L.at > LEARN_FOR_MS) return null;
  return {
    efforts: Array.isArray(L.efforts) && L.efforts.length ? L.efforts : null,
    drop: Array.isArray(L.drop) ? L.drop : [],
    offThinks: L.offThinks === true,
    noLateSystem: L.noLateSystem === true,
    down: Number.isFinite(L.downAt) && now - L.downAt <= REFUSAL_MEMORY_MS,
    prefillDown: Number.isFinite(L.prefillDownAt),
    context: Number.isFinite(L.context) && L.context > 0 ? L.context : 0,
    /* that room is this app's own guess after a "too long" that named no
     * smaller size — the book is fitted to it, but nothing is refused for it */
    contextGuess: L.contextGuess === true,
    /* the longest reply the model said it can give */
    maxOut: Number.isFinite(L.maxOut) && L.maxOut > 0 ? L.maxOut : 0,
    /* the reply's length named the way this address asks: max_completion_tokens */
    completionField: L.completionField === true,
    /* this model would not take a structured prefill: its pages get the prefill as written (Tavern M580) */
    structuredDown: Number.isFinite(L.structuredDownAt),
  };
}

const EFFORT_WORDS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const OFFERS = /(supported values|allowed values|valid values|accepted values|possible values|available values|one of|must be|should be|expected|only supports?|options are|choose from|permitted values)/i;
const NOT_TAKEN = '(?:unrecognized|unknown|unsupported|not supported|extra (?:inputs?|fields?|arguments?)|not permitted|not allowed|unexpected|invalid (?:parameter|field|argument|key)|no such|does not support|doesn.t support)';
export function lessonFrom(detail, body) {
  const text = String(detail || '');
  const b = body && typeof body === 'object' ? body : {};
  let allowed = null;
  const m = OFFERS.exec(text);
  if (m) {
    const refused = [b.reasoning_effort, b.reasoning && b.reasoning.effort].filter((x) => typeof x === 'string');
    const words = [...new Set((text.slice(m.index).toLowerCase().match(/[a-z]+/g) || []).filter((w) => EFFORT_WORDS.includes(w) && !refused.includes(w)))];
    if (words.length) allowed = EFFORT_WORDS.filter((w) => words.includes(w));
  }
  let badField = null;
  for (const f of ['thinking', 'enable_thinking', 'reasoning_effort', 'reasoning', 'chat_template_kwargs', 'model_options', 'output_config']) {
    if (!(f in b)) continue;
    const near = new RegExp(NOT_TAKEN + '[^.]{0,80}["\'`]?\\b' + f + '\\b(?!_)|\\b' + f + '\\b(?!_)["\'`]?[^.]{0,80}' + NOT_TAKEN, 'i');
    if (near.test(text)) { badField = f; break; }
  }
  return { allowed, badField };
}
export function fitEffort(value, allowed, isOff = false) {
  if (!Array.isArray(allowed) || !allowed.length) return value;
  const thinking = EFFORT_RANK.filter((l) => l !== 'off' && allowed.includes(l));
  if (isOff || value === 'none' || value === 'off') return allowed.includes('none') ? 'none' : (thinking[0] || allowed[0]);
  if (allowed.includes(value)) return value;
  const r = EFFORT_RANK.indexOf(value);
  let best = '';
  for (const l of thinking) if (EFFORT_RANK.indexOf(l) <= r) best = l;
  return best || thinking[0] || allowed.find((a) => a !== 'none') || value;
}

export const THINKING_FIELDS = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking', 'model_options', 'output_config'];
export const REASONING_REFUSAL = /reasoning|effort|thinking|budget_tokens|enable_thinking/i;
export const PREFILL_REFUSAL = /assistant message prefill|must end with a user message|prefix|partial|prefill/i;
/* "more words than it holds", in the words the houses use for it (OpenAI,
 * vLLM, DeepSeek, OpenRouter, Claude, Gemini, Mistral, xAI, Moonshot,
 * llama.cpp, Z.ai) */
export const CONTEXT_REFUSAL = /context[_ ]length|context window|context size|maximum context|too (?:long|many tokens)|prompt is too long|input (?:is )?too long|exceeds? (?:the )?(?:model'?s? )?(?:maximum|max|context|available context)|exceeds? max(?:imum)? length|reduce the length|too large for model|token limit|maximum prompt length|maximum number of tokens/i;
/* the reply's own length, too long for the model: "max_tokens … is too
 * large", "maximum allowed number of output tokens" */
export const REPLY_TOO_LONG = /(?:max_tokens|max_completion_tokens|max_new_tokens|max_output_tokens|output tokens|completion tokens)[^.]{0,80}(?:too large|too long|exceeds?|greater than|maximum|at most|must be (?:less|<=?)|allowed)|(?:maximum|max)(?:imum)? (?:allowed )?(?:number of )?output tokens/i;
/* OpenAI's own newer models: "Unsupported parameter: 'max_tokens' is not
 * supported with this model. Use 'max_completion_tokens' instead." (and never
 * vLLM's "'max_tokens' or 'max_completion_tokens' is too large") */
export const COMPLETION_FIELD_REFUSAL = /(?:unsupported parameter|not supported|unrecognized)[^.]{0,60}max_tokens|max_completion_tokens['"`]?\s+instead/i;

/* The OpenAI-shaped house's thinking fields for a level. */
export function thinkingFields(conn, level) {
  const set = level === false || level === 'none' ? 'off' : level;
  if (set === undefined || set === null || set === '' || !EFFORT_RANK.includes(set)) return {};
  const style = familyStyle(conn);
  const effort = effortFor(style, set);
  const b = {};
  if (style === 'none') return b;
  if (style === 'openrouter') {
    const budget = budgetFor(conn).tokens;
    b.reasoning = effort === 'off' ? { enabled: false } : (budget ? { max_tokens: budget } : { effort });
  } else if (style === 'zai') {
    const w = zaiWire(effort, glmVersion(conn));
    b.thinking = w.thinking;
    if (w.reasoning_effort) b.reasoning_effort = w.reasoning_effort;
  } else if (style === 'qwen') {
    b.enable_thinking = effort !== 'off';
  } else if (style === 'hermes') {
    if (effort !== 'off') b.model_options = { reasoning: { enabled: true, effort } };
  } else if (style === 'kimi') {
    if (effort !== 'off') b.reasoning_effort = effort;
  } else if (style === 'kimi2') {
    b.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
  } else if (style === 'deepseek') {
    b.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
    if (effort !== 'off') b.reasoning_effort = effort;
  } else {
    if (effort !== 'off') b.reasoning_effort = effort;
    if (!hostIsOpenAI(conn && conn.url)) b.thinking = { type: effort === 'off' ? 'disabled' : 'enabled' };
  }
  return b;
}

/* Does this request make the model think? Then the reply room is raised so the
 * thinking cannot eat the answer. Only ever raised. */
export function thinksOn(conn) { return thinks(conn || {}); }
function thinks(conn) {
  const t = conn.thinking;
  if (t === 'off' || t === false || t === 'none') return cannotStopThinking(conn);
  if (EFFORT_RANK.includes(t)) return true;
  return alwaysThinks(conn.model) || alwaysThinks(conn.modelHf) || cannotStopThinking(conn);
}

function applyThinking(body, conn, wire) {
  const t = conn.thinking === false || conn.thinking === 'none' ? 'off' : conn.thinking;
  const said = t !== undefined && t !== null && t !== '' && EFFORT_RANK.includes(t);
  const learned = said ? learnedFacts(conn) : null;
  if (said && learned && learned.down) {
    /* refused within the last day: nothing is spent on it again today */
  } else if (wire === 'anthropic') {
    if (said) {
      const effort = effortFor('anthropic', t);
      const on = effort !== 'off';
      const url = String(conn.url || '') + ' ' + String(conn.model || '');
      if (/deepseek/i.test(url)) {
        /* DeepSeek behind the Anthropic shape takes reasoning:{effort}, none disables */
        const ladder = { off: 'none', low: 'low', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
        body.reasoning = { effort: ladder[effort] || 'none' };
        if (on) { body.temperature = 1; delete body.top_p; }
      } else if (on) {
        const budget = budgetFor(conn).tokens;
        if (budget) {
          body.thinking = { type: 'enabled', budget_tokens: budget };
          if (body.max_tokens <= budget) body.max_tokens = budget + 4096;
        } else {
          body.thinking = { type: 'adaptive' };
          body.output_config = { effort };
        }
        /* Claude takes no other temperature while it thinks, and no top-p or
         * top-k (it refuses them) */
        body.temperature = 1;
        delete body.top_p;
        delete body.top_k;
      }
      /* the thinking lives inside the reply's room: the room is raised so the
       * thinking cannot eat the page (the floor his law allows) */
      if (on && Number.isFinite(body.max_tokens)) body.max_tokens = Math.max(body.max_tokens, thinkingFloor(conn));
    }
  } else if (said) {
    Object.assign(body, thinkingFields(conn, t));
  }
  /* the levels the provider's own list says this model takes fit the level he chose */
  const listed = Array.isArray(conn.modelEfforts) && conn.modelEfforts.length ? conn.modelEfforts : null;
  if (said && listed && !(learned && (learned.down || learned.efforts))) {
    if (typeof body.reasoning_effort === 'string') body.reasoning_effort = fitEffort(body.reasoning_effort, listed, t === 'off');
    if (body.reasoning && typeof body.reasoning.effort === 'string') body.reasoning.effort = fitEffort(body.reasoning.effort, listed);
    if (body.output_config && typeof body.output_config.effort === 'string') body.output_config = { ...body.output_config, effort: fitEffort(body.output_config.effort, listed) };
  }
  if (learned && !learned.down) {
    const style = familyStyle(conn);
    if (t === 'off' && learned.offThinks && style !== 'hermes') {
      const least = learned.efforts ? fitEffort('low', learned.efforts) : 'low';
      if ('thinking' in body) body.thinking = { type: 'enabled' };
      if ('enable_thinking' in body) body.enable_thinking = true;
      if (style === 'openrouter') body.reasoning = { effort: least };
      else body.reasoning_effort = least;
    }
    for (const f of learned.drop) delete body[f];
    if (learned.efforts) {
      if (typeof body.reasoning_effort === 'string') body.reasoning_effort = fitEffort(body.reasoning_effort, learned.efforts, t === 'off' && !learned.offThinks);
      if (body.reasoning && typeof body.reasoning.effort === 'string') body.reasoning.effort = fitEffort(body.reasoning.effort, learned.efforts);
      /* Claude's level rides in output_config: a level it named as refused is fitted there too */
      if (body.output_config && typeof body.output_config.effort === 'string') body.output_config = { ...body.output_config, effort: fitEffort(body.output_config.effort, learned.efforts) };
    }
  }
  if (wire !== 'anthropic' && thinks(conn)) {
    const floor = thinkingFloor(conn);
    for (const k of ['max_tokens', 'max_completion_tokens']) {
      if (body[k] !== undefined) body[k] = Math.max(body[k], floor);
    }
  }
}

/* The room a thinking reply is raised to: sixteen thousand tokens, but never
 * more than half of what the model holds, nor more than the longest reply it
 * said it can give — a floor the model itself cannot take would only be
 * refused. */
export function thinkingFloor(conn) {
  const facts = learnedFacts(conn);
  let floor = Math.min(ALWAYS_THINKS_FLOOR, Math.floor(contextOf(conn) * 0.5));
  if (facts && facts.maxOut) floor = Math.min(floor, facts.maxOut);
  return Math.max(1024, floor);
}

/* The same request with every thinking field taken off. */
export function withoutThinking(body) {
  const b = { ...body };
  for (const f of THINKING_FIELDS) delete b[f];
  return b;
}

/* How the chosen level is actually spoken on this wire, in words. */
export function spokenAs(conn) {
  const probe = { max_tokens: 1000 };
  applyThinking(probe, { ...conn }, wireOf(conn));
  const said = [];
  const t = probe.thinking;
  if (t && t.type === 'adaptive') said.push('thinking as much as it needs');
  else if (t && t.type === 'enabled') said.push(Number.isFinite(t.budget_tokens) ? `thinking, up to ${t.budget_tokens.toLocaleString()} tokens` : 'thinking on');
  else if (t && t.type === 'disabled') said.push('thinking off');
  if (typeof probe.enable_thinking === 'boolean') said.push(probe.enable_thinking ? 'thinking on' : 'thinking off');
  const effort = probe.reasoning_effort || (probe.reasoning && probe.reasoning.effort) || (probe.output_config && probe.output_config.effort)
    || (probe.model_options && probe.model_options.reasoning && probe.model_options.reasoning.effort);
  if (probe.reasoning && probe.reasoning.enabled === false) said.push('reasoning off');
  if (probe.reasoning && Number.isFinite(probe.reasoning.max_tokens)) said.push(`reasoning, up to ${probe.reasoning.max_tokens.toLocaleString()} tokens`);
  if (typeof effort === 'string') said.push(effort === 'none' ? 'effort none (no thinking)' : `effort ${effort}`);
  if (said.length && probe.temperature === 1 && (!Number.isFinite(conn && conn.temperature) || conn.temperature !== 1)) {
    said.push(Number.isFinite(conn && conn.temperature)
      ? `temperature 1 instead of your ${conn.temperature} — the model takes no other while it thinks`
      : 'temperature 1, which the model requires while it thinks');
  }
  return said.length ? `sent as ${[...new Set(said)].join(', ')}` : 'nothing about thinking is sent — the provider decides';
}

/* -------------------------------------------- the rest of the dials (M510) */

export const KNOBS = [
  ['topK', 'top_k'],
  ['minP', 'min_p'],
  ['presencePenalty', 'presence_penalty'],
  ['frequencyPenalty', 'frequency_penalty'],
  ['repetitionPenalty', 'repetition_penalty'],
  ['seed', 'seed'],
  ['stop', 'stop'],
];
export const KNOB_FIELDS = KNOBS.map(([, field]) => field);
/* What a helper's JSON never rides with — the floor his law allows: a penalty
 * pushes a model off the quotes and keys it already wrote, and a stop text can
 * end an answer mid-object. */
export const WORKER_UNSAFE = ['presencePenalty', 'frequencyPenalty', 'repetitionPenalty', 'stop'];

export function knobsOf(conn, { worker = false, wire = 'openai' } = {}) {
  const c = conn && typeof conn === 'object' ? conn : {};
  const out = {};
  for (const [key, field] of KNOBS) {
    if (worker && WORKER_UNSAFE.includes(key)) continue;
    const v = c[key];
    if (key === 'stop') {
      const list = Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s !== '') : [];
      if (list.length) out[wire === 'anthropic' ? 'stop_sequences' : 'stop'] = list;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    /* Anthropic's messages take top_k and nothing else of these */
    if (wire === 'anthropic' && key !== 'topK') continue;
    out[field] = key === 'topK' || key === 'seed' ? Math.round(v) : v;
  }
  return out;
}

/* Which of the dials sent a refusal names. One, or '' — never a guess. */
const NOT_TAKEN_KNOB = '(?:unrecognized|unknown|unsupported|not supported|extra (?:inputs?|fields?|arguments?)|not permitted|not allowed|unexpected|invalid (?:parameter|field|argument|key)|no such|does not support|doesn.t support|is not a valid)';
export function knobRefused(detail, sent = []) {
  const text = String(detail || '');
  for (const f of Array.isArray(sent) ? sent : []) {
    const near = new RegExp(NOT_TAKEN_KNOB + '[^.]{0,80}?[\\s"\'`:(\\[]' + f + '(?![A-Za-z0-9_])|(?:^|[\\s"\'`(\\[])' + f + '(?![A-Za-z0-9_])[^.]{0,80}?' + NOT_TAKEN_KNOB, 'i');
    if (near.test(text)) return f;
  }
  return '';
}

/* ------------------------------------------------ the prefill (M307, M328) */
/* "Start the reply for it": a trailing assistant turn that opens the answer.
 * A prefill that opens with <think> is a SEED FOR THE THINKING: what follows the
 * tag (to </think>, or to the end) rides in the provider's reasoning field with
 * the reply left empty and flagged unfinished, and the model continues the
 * thought in his words. Anything after </think> is an ordinary started reply. */

export const PREFILL_PROFILES = {
  anthropic: { label: 'Claude', flagField: '' },
  moonshot: { label: 'Moonshot / Kimi', flagField: 'partial' },
  deepseek: { label: 'DeepSeek (beta prefix)', flagField: 'prefix' },
  generic: { label: 'Anything OpenAI-compatible', flagField: '' },
};

export function prefillProfile(conn) {
  const c = conn || {};
  if (wireOf(c) === 'anthropic') return 'anthropic';
  const url = String(c.url || '').toLowerCase();
  if (url.includes('moonshot')) return 'moonshot';
  if (url.includes('deepseek')) return 'deepseek';
  return 'generic';
}

const SEED_SPAN = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/;
export function splitPrefill(text) {
  const raw = String(text == null ? '' : text).replace(/\s+$/, '');
  const m = raw.match(SEED_SPAN);
  if (!m) return { seed: '', content: raw };
  return { seed: m[1].trim(), content: raw.slice(m[0].length).replace(/^\s+/, '') };
}

/* A STRUCTURED TEMPLATE SENT AS WRITTEN (Cozy Tavern M582, M586, M587). A
 * connection set to Structured goes as written where it cannot be held to a
 * pattern — an address that takes no JSON-schema answers, a model that
 * refused one, a worker — and a template's markers mean nothing to a model:
 * "[[w:5-20]]" or "[[keep]]" would be sent as words and land at the head of
 * his page. Only the plain words that open the shown part ride (the hidden
 * part before [[keep]] and the markers go), up to the first marker; a
 * thinking block, the same, as the seed. A template's own markers, known by
 * name, are read so in As written too. */
export const TEMPLATE_MARKER = /\[\[\s*(?:keep|end|stop|eos|pg|w|words|opt|options|line|lines|free|num|number|emotion|mood|name|action|thought|re|regex)\b[^\]\n]{0,400}\]\]/i;
const ANY_MARKER = /\[\[[^\]\n]{1,400}\]\]/;
function templated(conn, text) { return Boolean(conn) && /\[\[/.test(text) && (conn.prefillMode === 'structured' || TEMPLATE_MARKER.test(text)); }
export function asWrittenOpening(conn, content) {
  const text = String(content == null ? '' : content);
  if (!templated(conn, text)) return text;
  const tpl = readTemplate(text);
  const at = tpl.shown.search(ANY_MARKER);
  return (at === -1 ? tpl.shown : tpl.shown.slice(0, at)).replace(/^\s+/, '');
}
function asWrittenSeed(conn, seed) {
  const text = String(seed || '');
  if (!templated(conn, text)) return text;
  const at = text.search(ANY_MARKER);
  return (at === -1 ? text : text.slice(0, at)).replace(/\s+$/, '');
}

export const RESERVED_FIELDS = Object.freeze(['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'refusal', '__proto__', 'constructor', 'prototype']);
export function fieldName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) return { name: '', auto: true, valid: true, error: '' };
  if (/^none$/i.test(name)) return { name: '', auto: false, valid: true, error: '' };
  if (RESERVED_FIELDS.includes(name)) return { name, auto: false, valid: false, error: '“' + name + '” is part of the message itself' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { name, auto: false, valid: false, error: '“' + name + '” is not a field name' };
  return { name, auto: false, valid: true, error: '' };
}
export function prefillFields(conn) {
  const c = conn || {};
  const profile = prefillProfile(c);
  const url = String(c.url || '').toLowerCase();
  const model = String(c.model || '').toLowerCase();
  let flag = PREFILL_PROFILES[profile].flagField;
  let reasoning = profile === 'anthropic' ? '' : 'reasoning_content';
  if (profile === 'generic' && url.includes('openrouter')) {
    if (/^moonshotai\//.test(model)) { flag = 'partial'; reasoning = 'reasoning_content'; } else { flag = ''; reasoning = 'reasoning'; }
  }
  if (profile === 'anthropic') return { flag: '', reasoning: '', error: '' };
  const f = fieldName(c.prefillFlagField); const r = fieldName(c.prefillReasoningField);
  if (!f.valid) return { flag, reasoning, error: 'The continuation flag: ' + f.error + '.' };
  if (!r.valid) return { flag, reasoning, error: 'The thinking field: ' + r.error + '.' };
  if (!f.auto) flag = f.name;
  if (!r.auto) reasoning = r.name;
  if (flag && flag === reasoning) return { flag, reasoning, error: 'The continuation flag and the thinking field are both “' + flag + '” — the flag would overwrite the seed.' };
  return { flag, reasoning, error: '' };
}

export function deepseekBetaBase(url) {
  const m = String(url || '').trim().match(/^(https?:\/\/api\.deepseek\.com)(?:\/|$)/i);
  return m ? m[1] + '/beta' : '';
}

export function prefillIsDown(conn) {
  const facts = learnedFacts(conn);
  return Boolean(facts && facts.prefillDown);
}

/* what WOULD be sent for this connection, decided in one place */
export function prefillPlan(conn) {
  const text = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!text.trim()) return { send: false, why: '' };
  const profile = prefillProfile(conn);
  const written = splitPrefill(text);
  const seed = asWrittenSeed(conn, written.seed);
  /* a trailing space is never sent (some houses refuse it): prefillGap gives it back */
  const content = asWrittenOpening(conn, written.content).replace(/\s+$/, '');
  const fields = prefillFields(conn);
  const effort = conn && typeof conn.thinking === 'string' ? conn.thinking : '';
  const facts = learnedFacts(conn);
  const thinkingRefused = Boolean(facts && facts.down);
  if (fields.error) return { send: false, why: fields.error + ' Nothing is sent until it is put right.' };
  if (profile === 'anthropic') {
    if (!content) return { send: false, why: 'Claude takes no thinking seed — there is no field for one — and nothing follows the seed, so nothing is sent.' };
    if (effort && effort !== 'off' && !thinkingRefused) return { send: false, why: 'The reply was not started for it: on this address a started reply makes the model skip its thinking, and thinking is set to ' + effort + '. Set thinking to Off to use the prefill.' };
    return { send: true, seed: '', content, flag: '', reasoning: '', dropped: seed ? 'Claude takes no thinking seed; only the words after it were sent.' : '' };
  }
  const seedRides = Boolean(seed) && Boolean(fields.reasoning) && !thinkingRefused;
  const dropped = seed && !seedRides ? (thinkingRefused ? 'This connection refused its thinking settings today, so the thinking seed stayed home.' : 'No thinking field is set, so the thinking seed stayed home.') : '';
  if (!seedRides && !content) return { send: false, why: dropped || '' };
  if (profile === 'deepseek' && content && !seedRides && effort && effort !== 'off' && !thinkingRefused) {
    return { send: false, why: 'The reply was not started for it: on this address a started reply makes the model skip its thinking, and thinking is set to ' + effort + '. Set thinking to Off to use the prefill — or open it with <think> to seed the thinking instead.' };
  }
  if (!fields.flag && !seedRides) return { send: false, why: 'This address has no known way to start the reply for it — the prefill stayed home. (Open it with <think> and it rides as a thinking seed.)' };
  return { send: true, seed: seedRides ? seed : '', content, flag: fields.flag, reasoning: seedRides ? fields.reasoning : '', dropped,
    keepThinkingOpen: seedRides && (!conn || conn.prefillKeepThinking !== false) };
}

export function describePrefill(conn) {
  if (!String(conn && conn.prefill != null ? conn.prefill : '').trim()) return '';
  if (conn.prefillMode === 'structured') {
    if (!structuredOffered(conn)) return 'Structured is not taken at this address (it takes no JSON-schema answers), so it goes as written: ' + (describeWritten(conn) || 'nothing to send.');
    if ((learnedFacts(conn) || {}).structuredDown) return 'This model would not take a structured prefill, so it goes as written: ' + (describeWritten(conn) || 'nothing to send.');
    return 'Sent structured: the model writes your opening itself, held to it by the answer’s pattern — nothing is handed to it.';
  }
  return describeWritten(conn);
}
function describeWritten(conn) {
  if (prefillIsDown(conn)) return 'Not sent — this model refused a started reply, so it is not offered one any more (until the model or address changes).';
  const plan = prefillPlan(conn);
  if (!plan.send) return 'Not sent — ' + (plan.why || 'nothing to send.');
  const parts = [];
  if (plan.seed) parts.push('a thinking seed in “' + plan.reasoning + '” (' + plan.seed.length + ' characters) — the model continues the thought');
  if (plan.content) parts.push('the reply started with “' + (plan.content.length > 40 ? plan.content.slice(0, 40) + '…' : plan.content) + '”');
  return 'Sent as ' + parts.join(', and ') + (plan.flag ? ', flagged “' + plan.flag + '”' : ', no flag') + '.' + (plan.dropped ? ' ' + plan.dropped : '');
}

/* the space he ended his prefill with: the wire trims it; it goes back only
 * when the continuation brought none of its own */
export function prefillGap(conn) {
  const raw = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!raw.trim()) return '';
  /* a template as written: the space before its first marker */
  const { content } = splitPrefill(raw);
  const m = (templated(conn, content) ? asWrittenOpening(conn, content) : raw).match(/\s+$/);
  return m ? m[0] : '';
}

/* Put the prefill on a finished message list (a copy). */
export function applyPrefill(messages, conn) {
  const list = (Array.isArray(messages) ? messages : []).map((m) => ({ ...m }));
  const text = String(conn && conn.prefill != null ? conn.prefill : '');
  if (!text.trim()) return { messages: list, applied: false };
  if (prefillIsDown(conn)) return { messages: list, applied: false, note: 'This model refused a started reply once, so it is not offered one.' };
  if (!list.length) return { messages: list, applied: false };
  const plan = prefillPlan(conn);
  if (!plan.send) return { messages: list, applied: false, ...(plan.why ? { note: plan.why } : {}) };
  const msg = { role: 'assistant', content: plan.content };
  if (plan.seed) msg[plan.reasoning] = plan.seed;
  if (plan.flag) msg[plan.flag] = true;
  list.push(msg);
  return { messages: list, applied: true, seed: plan.seed, content: plan.content, keepThinkingOpen: Boolean(plan.keepThinkingOpen), ...(plan.dropped ? { note: plan.dropped } : {}) };
}

/* --------------------------------------------- the note at the end (M380) */
/* A system message after his request, the way SillyTavern's post-history
 * instructions ride. A model that refused one is remembered and is sent those
 * words at the end of the request instead; an Anthropic-shaped address takes
 * no system message among the messages at all, so it is folded there at once. */
export function hasLateSystem(messages) {
  return (messages || []).some((m) => m && m.role === 'system');
}
export function lateSystemFitted(conn, messages) {
  const list = (messages || []).map((m) => ({ ...m }));
  const facts = learnedFacts(conn);
  const never = wireOf(conn) === 'anthropic';
  if (!hasLateSystem(list) || (!never && !(facts && facts.noLateSystem))) return list;
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (m.role === 'system') {
      if (last && last.role === 'user') last.content = `${last.content}\n\n${m.content}`;
      else out.push({ role: 'user', content: m.content });
    } else if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push(m);
  }
  return out;
}

/* ------------------------------------------------------------- the room */

/* What a model of each house holds when nothing better is known (Cozy
 * Tavern's M289 table). */
export const PRESET_CONTEXT = {
  claude: 200000, openai: 128000, openrouter: 128000, zai: 200000, gemini: 1000000,
  deepseek: 1000000, moonshot: 256000, hermes: 200000, synthetic: 128000, custom: 128000,
};
export function presetOf(conn) {
  const c = conn || {};
  if (c.preset && PRESET_CONTEXT[c.preset]) return c.preset;
  const u = String(c.url || '').toLowerCase();
  if (wireOf(c) === 'anthropic' && u.includes('anthropic.com')) return 'claude';
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('api.openai.com')) return 'openai';
  if (u.includes('z.ai') || u.includes('bigmodel.cn')) return 'zai';
  if (u.includes('generativelanguage.googleapis.com')) return 'gemini';
  if (u.includes('deepseek.com')) return 'deepseek';
  if (u.includes('moonshot')) return 'moonshot';
  if (u.includes('synthetic.new')) return 'synthetic';
  if (/:8642(\/|$)/.test(u)) return 'hermes';
  return 'custom';
}

/* How many tokens this connection holds: what he set; else what the provider's
 * list says this model holds; else the house's usual size. What the model
 * itself said when a request was too long is a ceiling over all of them — a
 * room it cannot take would only be refused again. */
export function contextOf(conn) {
  const c = conn || {};
  let n;
  if (Number.isFinite(c.context) && c.context > 0) n = Math.round(c.context);
  else if (Number.isFinite(c.modelContext) && c.modelContext > 0) n = Math.round(c.modelContext);
  else n = PRESET_CONTEXT[presetOf(c)] || DEFAULT_CONTEXT;
  const facts = learnedFacts(c);
  return facts && facts.context ? Math.min(n, facts.context) : n;
}

const NUM = '(\\d{3,8})';
/* the number a "too long" refusal names as the model's whole room */
export function contextFrom(detail) {
  const text = String(detail || '').replace(/(\d),(?=\d{3})/g, '$1');
  const tries = [
    new RegExp(NUM + '\\s*(?:tokens?\\s*)?maximum context length', 'i'),                       /* Mistral: "for model with 32768 maximum context length" */
    new RegExp('(?:maximum context length|context length|context window|context size|max(?:imum)? (?:input|prompt|context)[^.\\d]{0,40}?)\\D{0,40}?' + NUM, 'i'),
    new RegExp('>\\s*' + NUM + '\\s*(?:tokens?\\s*)?maximum', 'i'),                            /* Claude: "205000 tokens > 200000 maximum" */
    new RegExp('allowed\\s*\\(?\\s*' + NUM, 'i'),                                               /* Gemini: "maximum number of tokens allowed (1048576)" */
    new RegExp('token limit\\D{0,12}' + NUM, 'i'),                                              /* Moonshot: "exceeded model token limit: 8192" */
    new RegExp('n_ctx\\W{0,4}' + NUM, 'i'),                                                     /* llama.cpp's own numbers */
    new RegExp(NUM + '\\s*tokens?\\s*(?:maximum|max|limit)', 'i'),
    new RegExp('limit (?:of|is) ' + NUM, 'i'),
  ];
  for (const re of tries) {
    const m = re.exec(text);
    const n = m ? Number(m[1]) : 0;
    if (n >= 1000 && n <= 20000000) return n;
  }
  return 0;
}
/* how many tokens the request itself was, when the refusal says */
export function inputFrom(detail) {
  const text = String(detail || '').replace(/(\d),(?=\d{3})/g, '$1');
  const m = new RegExp('(?:messages resulted in|request has|prompt is too long:?|input token count\\D{0,4}|prompt contains|request contains|requested about|n_prompt_tokens\\W{0,4})\\s*' + NUM, 'i').exec(text)
    || new RegExp(NUM + ' (?:tokens )?in the messages', 'i').exec(text)
    || new RegExp(NUM + ' (?:tokens )?of text input', 'i').exec(text);
  return m ? Number(m[1]) : 0;
}
/* the longest reply a refusal says the model can give */
export function replyLimitFrom(detail) {
  const text = String(detail || '').replace(/(\d),(?=\d{3})/g, '$1');
  const m = new RegExp('>\\s*' + NUM + ',?\\s*which is the maximum allowed number of output tokens', 'i').exec(text)
    || new RegExp('(?:maximum|max)(?:imum)? (?:allowed )?(?:number of )?(?:output|completion) tokens\\D{0,30}' + NUM, 'i').exec(text)
    || new RegExp('(?:max_tokens|max_completion_tokens|max_output_tokens)[^.]{0,60}?(?:at most|<=|less than or equal to|maximum(?: value)?(?: is| of)?)\\s*' + NUM, 'i').exec(text);
  const n = m ? Number(m[1]) : 0;
  return n >= 256 && n <= 2000000 ? n : 0;
}

/* -------------------------------------------------------- the request */

/* Turns of one role side by side (his message sent again after a reply that
 * failed; the narrator going on twice) go as one message, a blank line
 * between, in order: Claude would join them anyway, and strict houses refuse
 * them ("roles must alternate"). A system message is never joined here. */
export function foldTurns(messages) {
  const out = [];
  for (const m of messages || []) {
    const last = out[out.length - 1];
    if (last && m && last.role === m.role && m.role !== 'system' && typeof last.content === 'string' && typeof m.content === 'string') {
      last.content = `${last.content}\n\n${m.content}`;
    } else out.push({ ...m });
  }
  return out;
}

/* ------------------------------------- the structured prefill (Tavern M580) */
/* Does this page go out structured? Only when he chose it for this
 * connection, there is a prefill to ask for, the address takes JSON-schema
 * answers, and this model has not refused one. The whole prefill is the
 * template (a <think>…</think> in it is thinking the model writes itself). */
export const STRUCTURED_NEVER = /deepseek|moonshot|z\.ai|bigmodel|siliconflow|ai21|cometapi/i;
export function structuredOffered(conn) {
  return Boolean(conn) && wireOf(conn) !== 'anthropic' && !STRUCTURED_NEVER.test(String(conn.url || ''));
}
export function structuredPlanFor(conn) {
  const c = conn || {};
  if (c.prefillMode !== 'structured' || !structuredOffered(c)) return null;
  const facts = learnedFacts(c);
  if (facts && facts.structuredDown) return null;
  const reply = String(c.prefill == null ? '' : c.prefill).replace(/\s+$/, '');
  if (!reply.trim()) return null;
  const minChars = Number.isFinite(c.prefillMinChars) && c.prefillMinChars > 0 ? c.prefillMinChars : MIN_AFTER_DEFAULT;
  const ban = bannedPattern(String(c.prefillBanned || ''));
  const note = ban.tooBig ? `Your words it can never write are too many for one exact pattern (${ban.words.length} given) — the page went without them; fewer words ride.` : '';
  return { template: reply, schema: structuredSchema(reply, { minChars, ascii: asciiOnly(c), banned: asciiOnly(c) ? '' : ban.pattern }), hidden: hiddenMatcher(reply), note };
}

/* ------------------------------------------------ let it look things up */
/* The provider's own web search (Tavern M22-C): Claude's web_search tool, or
 * OpenRouter's web plugin — nowhere else, so the switch shows only there.
 * Pages, the partner and scenes ride with it; a helper never does. */
export function searchOffered(conn) {
  return Boolean(conn) && (wireOf(conn) === 'anthropic' || /openrouter\.ai/i.test(String(conn.url || '')));
}

/* Build the request one house understands. opts: {system, systemParts,
 * messages, maxTokens, maxCap, stream, worker, noPrefill, noUsage}. Returns
 * {url, headers, body, wire, prefill}. systemParts: the system as [the part
 * that stays the same page after page, the part that moves] — Claude is told
 * to keep the first part ready (its prompt cache), so a long book is not paid
 * for in full on every page. */
export function buildRequest(conn, opts = {}) {
  const { system, messages = [], maxTokens, stream = false, worker = false } = opts;
  const wire = wireOf(conn);
  const body = {};
  const limit = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : null;
  const fitted = foldTurns(lateSystemFitted(conn, messages));
  /* a request that already ends on the story's own words is a reply already started: no prefill on top of it */
  const endsOnAssistant = fitted.length && fitted[fitted.length - 1].role === 'assistant';
  /* a helper rides with the prefill only when he ticked "Workers riding this connection get it too" —
   * and never a Structured template's: its opening is a page's, and breaks a helper's JSON (Tavern M587) */
  const noPrefill = opts.noPrefill || (worker && (conn.prefillForWorkers !== true || conn.prefillMode === 'structured')) || endsOnAssistant;
  /* structured: his opening is asked of the model through the answer's schema — nothing is handed to it */
  const structured = !noPrefill && !opts.noStructured && !worker ? structuredPlanFor(conn) : null;
  const pf = noPrefill || structured ? { messages: fitted, applied: false } : applyPrefill(fitted, conn);
  const facts0 = learnedFacts(conn);

  if (wire === 'anthropic') {
    body.model = conn.model;
    body.max_tokens = limit || 4096;
    const parts = Array.isArray(opts.systemParts) ? opts.systemParts.filter((p) => String(p || '').trim()) : null;
    if (parts && parts.length > 1 && /api\.anthropic\.com/i.test(String(conn.url || ''))) {
      body.system = parts.map((text, i) => (i === 0 ? { type: 'text', text, cache_control: { type: 'ephemeral' } } : { type: 'text', text }));
    } else if (system) body.system = system;
    /* the book riding as a message of its own: Claude keeps the part that
     * stays the same ready too, up to where it ends (cacheSplit) */
    let cached = false;
    body.messages = pf.messages.map((m) => {
      const split = Number.isInteger(m.cacheSplit) ? m.cacheSplit : 0;
      if (!cached && split > 0 && typeof m.content === 'string' && /api\.anthropic\.com/i.test(String(conn.url || ''))) {
        cached = true;
        const head = m.content.slice(0, split);
        const rest = m.content.slice(split);
        return { role: m.role, content: [{ type: 'text', text: head, cache_control: { type: 'ephemeral' } }, ...(rest.trim() ? [{ type: 'text', text: rest }] : [])] };
      }
      return { role: m.role, content: m.content };
    });
  } else {
    body.model = conn.model;
    const list = [];
    if (system) list.push({ role: 'system', content: system });
    /* the app's own marks never go out */
    for (const m of pf.messages) { const { cacheSplit, ...rest } = m; list.push(rest); }
    body.messages = list;
    /* OpenAI's own address names the reply's length max_completion_tokens (its
     * newer models refuse max_tokens); elsewhere, once an address asked for it */
    if (limit) body[hostIsOpenAI(conn.url) || (facts0 && facts0.completionField) ? 'max_completion_tokens' : 'max_tokens'] = limit;
  }

  /* only what he set */
  if (Number.isFinite(conn.temperature)) body.temperature = conn.temperature;
  if (Number.isFinite(conn.topP)) body.top_p = conn.topP;
  Object.assign(body, knobsOf(conn, { worker, wire: wire === 'anthropic' ? 'anthropic' : 'openai' }));

  /* a thinking seed needs the thinking channel open: with the dial at Off, a
   * request that carries one asks for the lightest thinking (M328) */
  const opened = pf.applied && pf.keepThinkingOpen && (conn.thinking === 'off' || conn.thinking === false);
  applyThinking(body, opened ? { ...conn, thinking: 'low' } : conn, wire);
  /* a dial the model refused by name is left out from then on */
  const facts = learnedFacts(conn);
  if (facts) for (const f of facts.drop) if (KNOB_FIELDS.includes(f) || f === 'stop_sequences') delete body[f];
  /* never a longer reply than the model said it can give, nor than this one
   * request has room left for */
  const cap = Math.min(facts && facts.maxOut ? facts.maxOut : Infinity, Number.isFinite(opts.maxCap) && opts.maxCap > 0 ? Math.round(opts.maxCap) : Infinity);
  if (cap !== Infinity) {
    for (const k of ['max_tokens', 'max_completion_tokens']) if (Number.isFinite(body[k]) && body[k] > cap) body[k] = cap;
    if (body.thinking && Number.isFinite(body.thinking.budget_tokens) && body.thinking.budget_tokens >= body.max_tokens) {
      const b = Math.floor(body.max_tokens / 2);
      if (b >= CLAUDE_BUDGET_FLOOR) body.thinking = { ...body.thinking, budget_tokens: b };
      else { delete body.thinking; }
    }
  }
  if (stream) {
    body.stream = true;
    if (wire !== 'anthropic' && !opts.noUsage && !(facts && facts.drop.includes('stream_options'))) body.stream_options = { include_usage: true };
  }
  if (structured) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: structured.schema } };
    /* OpenRouter routes only to a provider that keeps the schema (one that ignores it may take the page otherwise) */
    if (/openrouter\.ai/i.test(String(conn.url || ''))) body.provider = { ...(body.provider && typeof body.provider === 'object' ? body.provider : {}), require_parameters: true };
  }
  /* let it look things up: only when he ticked it, and never for a helper */
  if (conn.searchOn === true && !worker && !opts.noSearch && searchOffered(conn)) {
    const uses = Number.isFinite(conn.searchMaxUses) && conn.searchMaxUses > 0 ? Math.round(conn.searchMaxUses) : 0;
    /* how many look-ups: only when he set it — otherwise the provider decides */
    if (wire === 'anthropic') body.tools = [{ type: 'web_search_20250305', name: 'web_search', ...(uses ? { max_uses: uses } : {}) }];
    else body.plugins = [{ id: 'web', ...(uses ? { max_results: uses } : {}) }];
  }

  let url = endpoint(conn);
  if (pf.applied && prefillProfile(conn) === 'deepseek' && wire !== 'anthropic') {
    const beta = deepseekBetaBase(conn.url);
    if (beta) url = beta + '/chat/completions';
  }
  return { url, headers: headersFor(conn), body, wire, house: wire, prefill: pf, structured };
}

/* Pull the answer out, whichever shape came back. Thinking is kept on its own
 * channel so the answer text is only ever the answer. */
export function readAnswer(wire, data) {
  if (!data || typeof data !== 'object') return { text: '', thinking: '', finish: 'empty' };
  if (data.error) {
    const d = data.detail || data.error;
    return { text: '', thinking: '', finish: 'error', error: typeof d === 'string' ? d : JSON.stringify(d) };
  }
  if (wire === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('');
    const thinking = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('');
    const hiddenThought = blocks.some((b) => b.type === 'redacted_thinking');
    return { text, thinking, finish: data.stop_reason || 'stop', hiddenThought, thinkTokens: 0 };
  }
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  const text = typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : '';
  let thinking = [msg.reasoning_content, msg.reasoning].find((v) => typeof v === 'string' && v) || '';
  if (!thinking) {
    for (const [k, v] of Object.entries(msg)) {
      if (k !== 'content' && k !== 'role' && k !== 'refusal' && typeof v === 'string' && v && /reason|think|thought/i.test(k)) { thinking = v; break; }
    }
  }
  const usage = data.usage || {};
  const n = Number((usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ?? usage.reasoning_tokens);
  return { text, thinking, finish: choice.finish_reason || 'stop', thinkTokens: Number.isFinite(n) && n > 0 ? n : 0, hiddenThought: false };
}

/* One streamed chunk, whichever shape: {text, thinking, cut?} or null. */
export function readChunk(wire, obj) {
  if (!obj) return null;
  if (wire === 'anthropic') {
    if (obj.type === 'content_block_delta') {
      const d = obj.delta || {};
      if (d.type === 'text_delta') return { text: d.text || '', thinking: '' };
      if (d.type === 'thinking_delta') return { text: '', thinking: d.thinking || '' };
    }
    if (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason === 'max_tokens') return { text: '', thinking: '', cut: true };
    return null;
  }
  const choice = (obj.choices && obj.choices[0]) || {};
  const d = choice.delta || {};
  const text = typeof d.content === 'string' ? d.content : '';
  const thinking = [d.reasoning_content, d.reasoning].find((v) => typeof v === 'string' && v) || '';
  const cut = choice.finish_reason === 'length';
  if (!text && !thinking && !cut) return null;
  return cut ? { text, thinking, cut } : { text, thinking };
}

/* Where a provider lists its models. */
export function modelsUrl(conn) {
  const base = String((conn && conn.url) || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|messages)$/, '');
  if (!base) return '';
  return /\/v\d+[a-z]*$/.test(base) || /\/openai$/.test(base) ? base + '/models' : base + '/v1/models';
}
/* What a listed model is, in its provider's own words. */
export function reportedIdentity(m) {
  if (!m || typeof m !== 'object') return { hf: '', efforts: null, context: 0 };
  const hf = [m.hugging_face_id, m.huggingface_id, m.hf_id, m.canonical_slug].find((x) => typeof x === 'string' && x.trim());
  const raw = (m.reasoning_parameters && m.reasoning_parameters.efforts) || null;
  const efforts = Array.isArray(raw) ? raw.map((e) => String(e || '').toLowerCase().trim()).filter(Boolean) : null;
  const ctx = [m.context_length, m.context_window, m.max_context_length, m.max_model_len, m.top_provider && m.top_provider.context_length, m.max_input_tokens]
    .map(Number).find((n) => Number.isFinite(n) && n > 0) || 0;
  return { hf: hf ? hf.trim() : '', efforts: efforts && efforts.length ? efforts : null, context: ctx };
}

/* --------------------------------------------------------------- presets */

export const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'moonshot', name: 'Kimi (Moonshot)', url: 'https://api.moonshot.ai/v1', model: '' },
  { id: 'synthetic', name: 'Synthetic', url: 'https://api.synthetic.new/openai/v1', model: '' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'zai', name: 'Z.ai GLM', url: 'https://api.z.ai/api/paas/v4', model: 'glm-4.6' },
  { id: 'claude', name: 'Claude', url: 'https://api.anthropic.com/v1', model: '' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1', model: '' },
  { id: 'gemini', name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '' },
  { id: 'hermes', name: 'Hermes Agent', url: 'http://127.0.0.1:8642/v1', model: 'hermes-agent' },
  { id: 'custom', name: 'Anything else', url: '', model: '' },
];
