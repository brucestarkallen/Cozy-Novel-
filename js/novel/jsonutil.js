/* Cozy Novel — js/novel/jsonutil.js — Cozy Tavern's tolerant JSON finder
 * (its agents/jsonutil.js, M9/M26/M31/M259/M439/M607). A model's JSON fails
 * in known ways: thinking before it, a code fence, comments, trailing commas,
 * raw line breaks inside a string, curly quotes as delimiters. Each is mended
 * mechanically; nothing is guessed. Pure. */

export function balancedCandidates(text, maxN = 5) {
  const src = String(text || '');
  const out = [];
  let i = 0;
  while (out.length < maxN) {
    const start = src.indexOf('{', i);
    if (start === -1) break;
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let j = start; j < src.length; j++) {
      const ch = src[j];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    /* a brace in the words before the object never closes: the search goes on
     * from the next one, so the object after it is still found */
    if (end === -1) { i = start + 1; continue; }
    out.push(src.slice(start, end + 1));
    i = end + 1;
  }
  return out;
}

export function repairJson(text) {
  const src = String(text || '');
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { out += ch; inStr = true; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 1; continue; }
    out += ch;
  }
  let fixed = '';
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (quoted) {
      fixed += ch;
      if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; fixed += ch; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j += 1;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    fixed += ch;
  }
  return fixed;
}

/* A quote inside a string that was never escaped ("find": "He said, "Go.""):
 * a quote that is not followed by what ends a string (a comma, a closing
 * bracket or brace, a colon, the end) is one of the words — escaped. The last
 * thing tried, after the mending above. */
export function repairQuotes(text) {
  const src = String(text || '');
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (!inStr) { out += ch; if (ch === '"') inStr = true; continue; }
    if (ch === '\\') { out += ch + (src[i + 1] || ''); i += 1; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (j >= src.length || ',}]:'.includes(src[j])) { out += ch; inStr = false; } else out += '\\"';
      continue;
    }
    out += ch;
  }
  return out;
}

export function parseLenient(candidate) {
  try { return JSON.parse(candidate); } catch (_) { /* try mending */ }
  const mended = repairJson(candidate);
  try { return JSON.parse(mended); } catch (_) { /* one more */ }
  try { return JSON.parse(repairQuotes(mended)); } catch (_) { return null; }
}

/* The object that answers, or null. want(obj) picks among several. */
export function parseFirstObject(raw, want = null) {
  try {
    let text = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/```(?:json|JSON)?/g, '');
    if (!text.includes('"') && /[“”]/.test(text)) text = text.replace(/[“”]/g, '"');
    for (const c of balancedCandidates(text, 6)) {
      const parsed = parseLenient(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (typeof want !== 'function' || want(parsed))) return parsed;
    }
    return null;
  } catch (_) {
    return null;
  }
}
