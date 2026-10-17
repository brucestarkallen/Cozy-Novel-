/* Cozy Novel — js/util.js — small things everything uses. Pure. */

export function newId(prefix = '') {
  const t = Date.now().toString(36);
  let r = '';
  const a = new Uint8Array(6);
  (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  for (const b of a) r += (b % 36).toString(36);
  return (prefix ? prefix + '-' : '') + t + r;
}


/* A COUNT KEPT WHILE THE WORDS ARE THE SAME (2.12.6). Words, tokens and
 * fingerprints are counted again and again for the same text — every passage of a chapter for
 * each stretch plan, a whole chapter for each run of the helper, the book for
 * each request fitted — and counting a 300,000-word book took 90 ms each time
 * (a third of a second on a phone), on the thread the page draws with. A pure
 * count is kept by its text: the same words, asked again, cost the look-up.
 * Texts kept up to a bound, the oldest let go first. */
function counted(count, { keep = 3e6, most = 12000 } = {}) {
  const kept = new Map();   /* text -> count */
  let held = 0;
  return (text) => {
    const s = String(text || '');
    const had = kept.get(s);
    if (had !== undefined) return had;
    const n = count(s);
    kept.set(s, n);
    held += s.length;
    if (held > keep || kept.size > most) {
      for (const k of kept.keys()) { if (held <= keep && kept.size <= most) break; kept.delete(k); held -= k.length; }
    }
    return n;
  };
}

/* A short fingerprint of a text (FNV-1a, 32 bits twice), to know whether it
 * changed — asked of every version of every passage each time the helper
 * looks for what changed, so kept by its text too. */
export const hashText = counted((str) => {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c + i), 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
});

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const CJK = /[぀-ヿ㐀-鿿가-힯]/g;
export const countWords = counted((s) => {
  const cjk = (s.match(CJK) || []).length;
  const words = (s.replace(CJK, ' ').match(WORD) || []).length;
  return words + cjk;
});

/* About how many tokens a text is. Set to read a little high: a request that
 * fits by this count fits by the model's own. */
export const estimateTokens = counted((s) => {
  const cjk = (s.match(CJK) || []).length;
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return Math.ceil((bytes - cjk * 3) / 3.5 + cjk * 1.1);
});

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
/* 1 → "One", 21 → "Twenty-One", 105 → "One Hundred and Five" */
export function numberWords(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 0) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + numberWords(n % 100) : '');
  return String(n);
}

export function timeAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Number(at || 0)) / 1000));
  if (!at) return '';
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

export function plural(n, one, many) { return `${Number(n).toLocaleString()} ${n === 1 ? one : (many || one + 's')}`; }

export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.now = (...args) => { clearTimeout(t); t = null; return fn(...args); };
  return d;
}

export function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

/* Words cut to fit, never mid-word (Cozy Tavern's M752): at the last end of a
 * sentence or a clause in the second half, else at the last space, with "…". */
export function cutWords(text, max) {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  const room = t.slice(0, Math.max(1, max - 1));
  const at = Math.max(room.lastIndexOf('. '), room.lastIndexOf('.\n'), room.lastIndexOf('; '), room.lastIndexOf('! '), room.lastIndexOf('? '));
  if (at > max / 2) return room.slice(0, at + 1) + '…';
  const sp = room.search(/\s\S*$/);
  return (sp > max / 2 ? room.slice(0, sp) : room).trimEnd() + '…';
}

/* A NUMBER AS PEOPLE TYPE IT (Cozy Tavern M234, M390). In a box for a whole
 * number, groups of three are one number whatever parts them — "8,000",
 * "200.000", "1 048 576", "1'000" — and "128k" is 128,000; a decimal there
 * ("8.5") is not a whole number and is not rounded into one. In a box for a
 * decimal, a comma is the point ("0,3"), and "1,234.56" / "1.234,56" read as
 * written. NaN when it is not a number. */
export function numberTyped(raw, { whole = false } = {}) {
  const s = String(raw ?? '').trim().replace(/[\s\u00a0\u202f]+/g, ' ');
  if (!s) return NaN;
  if (whole) {
    const k = /^(\d+(?:[.,]\d+)?)\s?k$/i.exec(s);
    if (k) return Math.round(Number(k[1].replace(',', '.')) * 1000);
    if (/^\d{1,3}(?:[.,' ’_]\d{3})+$/.test(s)) return Number(s.replace(/[.,' ’_]/g, ''));
    return /^-?\d+$/.test(s) ? Number(s) : NaN;
  }
  let t = s.replace(/ /g, '');
  if (/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^-?\d*,\d+$/.test(t)) t = t.replace(',', '.');
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}
/* a mark out of ten as people write it: "8", "8.5", "8,5", "8/10", "8 of 10", "80%" */
export function markTyped(raw) {
  const s = String(raw ?? '').trim();
  const pct = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(s);
  if (pct) return Number(pct[1].replace(',', '.')) / 10;
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:\/\s*10|(?:out\s+)?of\s+10)?$/i.exec(s);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

/* A yes or a no as a model writes it (Cozy Tavern's M654/M659): true and
 * false, and the same in words — "true", "yes", "1", "false", "no", "0" —
 * read as such; anything else is no answer (undefined). */
export function truthOf(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(?:true|yes|y|1)$/.test(t)) return true;
  if (/^(?:false|no|n|0)$/.test(t)) return false;
  return undefined;
}

/* Whether a thread is open, as a model writes it: "open": false, or the
 * same in words — "closed", "resolved" — or a "status" saying so, or
 * "resolved": true; anything else is no answer (undefined). */
const CLOSED_WORD = /^(?:closed?|resolved|settled|done|finished|over|ended|complete(?:d)?|fulfilled)$/i;
const OPEN_WORD = /^(?:open(?:ed)?|ongoing|active|unresolved|pending|in progress|still open)$/i;
export function openOf(row) {
  if (!row || typeof row !== 'object') return undefined;
  const word = (v) => { if (typeof v !== 'string') return undefined; const t = v.trim().replace(/[.!]+$/, ''); return CLOSED_WORD.test(t) ? false : OPEN_WORD.test(t) ? true : undefined; };
  const o = truthOf(row.open);
  if (o !== undefined) return o;
  const ow = word(row.open);
  if (ow !== undefined) return ow;
  const st = word(row.status);
  if (st !== undefined) return st;
  for (const k of ['resolved', 'closed', 'done']) { const t = truthOf(row[k]); if (t !== undefined) return !t; }
  return undefined;
}

/* A name compared the way a person would: case, accents and spacing aside. */
export function nameKey(s) {
  const raw = String(s || '');
  /* a name is keyed again and again (every card against every name the bibliography gathers): a short one's key is kept */
  if (raw.length > 200) return keyOfName(raw);
  const had = NAME_KEYS.get(raw);
  if (had !== undefined) return had;
  const made = keyOfName(raw);
  if (NAME_KEYS.size >= 8000) NAME_KEYS.clear();
  NAME_KEYS.set(raw, made);
  return made;
}
const NAME_KEYS = new Map();
function keyOfName(raw) {
  return raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function slug(s, max = 40) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'novel';
}
