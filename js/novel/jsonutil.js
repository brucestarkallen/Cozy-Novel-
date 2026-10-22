/* Cozy Novel — js/novel/jsonutil.js — Cozy Tavern's tolerant JSON finder
 * (its agents/jsonutil.js, M9/M26/M31/M259/M439/M607). A model's JSON fails
 * in known ways: thinking before it, a code fence, comments, trailing commas,
 * raw line breaks inside a string, curly quotes as delimiters. Each is mended
 * mechanically; nothing is guessed. Where the object it read opens is
 * said by the same reading (findFirstObject `at`). Pure. */

/* each whole object's place in the text — where it opens (`start`) and just past where it closes (`end`) — and every
 * brace that never closes (`open`) */
export function balancedSpans(text, maxN = 5) {
  const src = String(text || '');
  const spans = [];
  const open = [];
  let i = 0;
  while (spans.length < maxN) {
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
    if (end === -1) { open.push(start); i = start + 1; continue; }
    spans.push({ start, end: end + 1 });
    i = end + 1;
  }
  return { spans, open };
}

export function balancedCandidates(text, maxN = 5) {
  const src = String(text || '');
  return balancedSpans(src, maxN).spans.map((s) => src.slice(s.start, s.end));
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

/* WHAT THE PARSE READS, AND WHERE IT STOOD IN THE ANSWER (2.12.63, the review: the words before Quick add's record were
 * cut at a second guess — the first {" — so a brace in its words, or a record in curly quotes, garbled them): `re` cut
 * out of the text, with the runs it keeps — each run's place in the new text and in the text it was cut from — so a
 * place the parse finds is said in the answer's own words (`placeIn`) */
function cutOut(text, re) {
  let out = '';
  const runs = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) { runs.push([out.length, last]); out += text.slice(last, m.index); }
    last = m.index + m[0].length;
  }
  if (last < text.length) { runs.push([out.length, last]); out += text.slice(last); }
  return { text: out, runs };
}
function placeIn(runs, at) {
  let k = runs.length - 1;
  while (k > 0 && runs[k][0] > at) k--;
  return k < 0 ? at : runs[k][1] + (at - runs[k][0]);
}
const answers = (parsed, want) => Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed) && (typeof want !== 'function' || want(parsed));

/* The object that answers, with where it opens in the answer as it came (`at`), or null. want(obj) picks among several.
 * `whole` — for an answer cut off: only an object that no brace before it leaves open counts. A reply cut off inside its
 * object holds only inner objects, never the answer (Cozy Tavern's M685) — and that is asked of the object the parse
 * reads, never of the first brace (2.12.63: words before the object holding a {…} of their own passed for its close). */
export function findFirstObject(raw, want = null, { whole = false } = {}) {
  try {
    const thought = cutOut(String(raw || ''), /<think>[\s\S]*?(<\/think>|$)/gi);
    const fenced = cutOut(thought.text, /```(?:json|JSON)?/g);
    let text = fenced.text;
    /* (one mark for one: every place stays where it stood) */
    if (!text.includes('"') && /[“”]/.test(text)) text = text.replace(/[“”]/g, '"');
    const { spans, open } = balancedSpans(text, 6);
    for (const s of spans) {
      if (whole && open.some((o) => o < s.start)) continue;
      const parsed = parseLenient(text.slice(s.start, s.end));
      if (answers(parsed, want)) return { value: parsed, at: placeIn(thought.runs, placeIn(fenced.runs, s.start)) };
    }
    return null;
  } catch (_) {
    return null;
  }
}

/* the last object in words that may hold drafts of it before (a model's thinking) — `whole` as above */
export function findLastObject(raw, want = null, { whole = false } = {}) {
  try {
    const fenced = cutOut(String(raw || ''), /```(?:json|JSON)?/g);
    const { spans, open } = balancedSpans(fenced.text, 40);
    for (let k = spans.length - 1; k >= 0; k--) {
      const s = spans[k];
      if (whole && open.some((o) => o < s.start)) continue;
      const parsed = parseLenient(fenced.text.slice(s.start, s.end));
      if (answers(parsed, want)) return { value: parsed, at: placeIn(fenced.runs, s.start) };
    }
    return null;
  } catch (_) {
    return null;
  }
}

export function parseLastObject(raw, want = null) {
  const found = findLastObject(raw, want);
  return found ? found.value : null;
}

export function parseFirstObject(raw, want = null) {
  const found = findFirstObject(raw, want);
  return found ? found.value : null;
}
