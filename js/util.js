/* Cozy Novel — js/util.js — small things everything uses. Pure. */

export function newId(prefix = '') {
  const t = Date.now().toString(36);
  let r = '';
  const a = new Uint8Array(6);
  (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
  for (const b of a) r += (b % 36).toString(36);
  return (prefix ? prefix + '-' : '') + t + r;
}

/* A short fingerprint of a text (FNV-1a, 32 bits twice), to know whether it changed. */
export function hashText(s) {
  const str = String(s || '');
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c + i), 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const CJK = /[぀-ヿ㐀-鿿가-힯]/g;
export function countWords(text) {
  const s = String(text || '');
  const cjk = (s.match(CJK) || []).length;
  const words = (s.replace(CJK, ' ').match(WORD) || []).length;
  return words + cjk;
}

/* About how many tokens a text is. Set to read a little high: a request that
 * fits by this count fits by the model's own. */
export function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(CJK) || []).length;
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return Math.ceil((bytes - cjk * 3) / 3.5 + cjk * 1.1);
}

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

/* A yes or a no as a model writes it (Cozy Tavern's M654/M659): true and
 * false, and the same in words — "true", "yes", "1", "false", "no", "0" —
 * read as such; anything else is no answer (undefined). */
export function truthOf(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (/^(?:true|yes|y|1)$/.test(t)) return true;
  if (/^(?:false|no|n|0)$/.test(t)) return false;
  return undefined;
}

/* A name compared the way a person would: case, accents and spacing aside. */
export function nameKey(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function slug(s, max = 40) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'novel';
}
