/* Cozy Novel — js/novel/names.js — one answer to "is this the same person?"
 * (Cozy Tavern's engine/names.js, M396/M404/M414/M418/M752, made for a
 * book's notes). Letters folded (Suì-Fēng = Sui-Feng), a rank or a courtesy
 * set aside ("Captain Hitsugaya" is Hitsugaya, "Kyōraku-san" is Kyōraku), a
 * first or last name of the other (Rukia = Rukia Kuchiki — never Rukia =
 * Byakuya Kuchiki), one cut short of the other (Vanessa Rey = Vanessa
 * Reynolds), the same names in another order (Kuchiki Rukia); never two
 * titles that disagree (Captain Kuchiki is not Lieutenant Kuchiki), never the
 * owner in "Jovan's mother", never a description ("the girl"). Pure. */

/* a name with its letters folded: accents off, case off, punctuation to spaces */
export function foldName(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const TITLE_KIND = {
  mr: 'civil', mrs: 'civil', ms: 'civil', miss: 'civil', mx: 'civil', madam: 'civil', dr: 'civil', prof: 'civil',
  sir: 'noble', dame: 'noble', lady: 'noble', lord: 'noble',
  king: 'royal', queen: 'royal', prince: 'royal', princess: 'royal', emperor: 'royal', empress: 'royal',
  captain: 'rank', lieutenant: 'rank', commander: 'rank', general: 'rank', colonel: 'rank', major: 'rank', sergeant: 'rank',
  officer: 'rank', detective: 'rank', agent: 'rank', head: 'rank', chief: 'rank', admiral: 'rank',
  headmaster: 'rank', headmistress: 'rank', principal: 'rank', instructor: 'rank', chancellor: 'rank', vice: 'rank',
  aunt: 'kin', uncle: 'kin', grandma: 'kin', grandpa: 'kin',
  father: 'order', mother: 'order', sister: 'order', brother: 'order',
  coach: 'role', master: 'role', elder: 'role',
};
const TITLE_SAME = { mister: 'mr', missus: 'mrs', madame: 'madam', mme: 'madam', mlle: 'miss', doctor: 'dr', professor: 'prof', auntie: 'aunt', granny: 'grandma' };
/* own keys only: a word like "constructor" is a name, never Object.prototype's */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);
const titleOf = (w) => { const t = own(TITLE_SAME, w) || w; return own(TITLE_KIND, t) ? t : ''; };
const TRAILING_RANK = { taicho: ['captain'], fukutaicho: ['lieutenant'], sotaicho: ['head', 'captain'] };
const NAME_STOP = new Set(['the', 'and', 'of', 'von', 'der', 'den', 'des', 'du', 'bin', 'ibn']);

/* an apostrophe inside a word is part of the word: "O'Brien" is obrien, and
 * "Jovan's mother" is "jovans mother", never Jovan */
function nameFold(name) {
  return foldName(String(name || '').replace(/([\p{L}\p{M}])['’‘ʼ](?=\p{L})/gu, '$1'));
}
/* a courtesy or a rank after the name only when joined to it the Japanese way */
const TRAILING = /[-‐‑–]\s*(san|sama|kun|chan|dono|sensei|senpai|taich[oō]u?|fukutaich[oō]u?|s[oō]taich[oō]u?)\s*$/iu;
function parseName(name) {
  let raw = String(name || '').trim();
  const titles = new Set();
  for (let m = TRAILING.exec(raw); m && raw.slice(0, m.index).trim(); m = TRAILING.exec(raw)) {
    const w = foldName(m[1]).replace(/u$/, '');
    for (const t of own(TRAILING_RANK, w) || []) titles.add(t);
    raw = raw.slice(0, m.index).trim();
  }
  let words = nameFold(raw).split(' ').filter(Boolean);
  while (words.length > 1 && titleOf(words[0])) { titles.add(titleOf(words[0])); words = words.slice(1); }
  return { words, bare: words.join(' '), titles };
}

/* two sets of titles that say two different people: a kind both carry, with
 * no title of that kind in common */
export function titlesConflict(a, b) {
  const ta = a instanceof Set ? a : parseName(a).titles;
  const tb = b instanceof Set ? b : parseName(b).titles;
  if (!ta.size || !tb.size) return false;
  const kinds = (set) => { const m = new Map(); for (const t of set) { const k = own(TITLE_KIND, t); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t); } return m; };
  const ka = kinds(ta);
  const kb = kinds(tb);
  for (const [kind, va] of ka) { const vb = kb.get(kind); if (vb && ![...va].some((t) => vb.has(t))) return true; }
  return false;
}

/* a possessive names somebody related to its owner, not the owner */
function ownerAndDependent(a, b) {
  const owner = (name) => /^(.+?)['’‘ʼ]s\s+\S/iu.exec(String(name || '').trim())?.[1] || '';
  const A = owner(a);
  const B = owner(b);
  return Boolean((A && samePersonName(A, b)) || (B && samePersonName(B, a)));
}
function sameOwnedDescriptor(a, b) {
  const d = (name) => /^(.+?)['’‘ʼ]s\s+(.+)$/iu.exec(String(name || '').trim());
  const A = d(a);
  const B = d(b);
  return Boolean(A && B && foldName(A[2]) === foldName(B[2]) && samePersonName(A[1], B[1]));
}

/* A description is not a name: "the girl", "a stranger", "his sister",
 * "Jovan's driver", or a label with no capital letter means whoever the
 * sentence it stands in means. */
export function isDescriptorName(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  return /^(?:the|a|an|this|that|these|those|his|her|their|my|your|our|its)\s/iu.test(n)
    || /^\S.*?(?:['’‘ʼ]s|s['’‘ʼ])\s+\S/u.test(n)
    || (/\p{Ll}/u.test(n) && !/\p{Lu}/u.test(n));
}

/* Is `a` the same person as `b`? Never a near miss. */
export function samePersonName(a, b) {
  if (ownerAndDependent(a, b)) return false;
  if (sameOwnedDescriptor(a, b)) return true;
  const A = parseName(a);
  const B = parseName(b);
  const fa = A.bare;
  const fb = B.bare;
  if (!fa || !fb) return false;
  if (titlesConflict(A.titles, B.titles)) return false;
  if (fa === fb) return true;
  const wa = A.words;
  const wb = B.words;
  if (wa.length === 1 && wb.length > 1 && (wb[0] === wa[0] || wb[wb.length - 1] === wa[0])) return true;
  if (wb.length === 1 && wa.length > 1 && (wa[0] === wb[0] || wa[wa.length - 1] === wb[0])) return true;
  if (wa.length >= 2 && wa.length === wb.length && [...wa].sort().join(' ') === [...wb].sort().join(' ')) return true;
  if (wa.length >= 2 && wb.length >= 2) {
    const [shortOne, longOne] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
    if (longOne.startsWith(shortOne) && longOne.length > shortOne.length) return true;
  }
  return false;
}

/* Is this name in this text? The whole name, or any word of it that names
 * someone — never a title, a joining word, or the owner in "Jovan's mother".
 * `folded` is the text already folded (foldedText), for asking of many names. */
export function foldedText(text) {
  return { loose: ' ' + foldName(text) + ' ', tight: ' ' + nameFold(text) + ' ' };
}
export function nameInText(folded, name, { words = true } = {}) {
  const f = typeof folded === 'string' ? foldedText(folded) : folded;
  const has = (w) => Boolean(w) && (f.loose.includes(' ' + w + ' ') || f.tight.includes(' ' + w + ' '));
  const raw = String(name || '');
  const P = parseName(raw);
  if (has(P.bare) || has(foldName(raw))) return true;
  if (!words) return false;
  const owners = new Set([...raw.matchAll(/([\p{L}\p{M}\p{N}'’‘ʼ-]+)['’‘ʼ]s(?![\p{L}])/gu)].map((m) => nameFold(m[1] + 's')));
  const ws = P.words.filter((w) => !owners.has(w) && !NAME_STOP.has(w));
  let distinct = ws.filter((w) => w.length >= 3);
  if (!distinct.length) distinct = ws.filter((w) => w.length >= 2);
  return distinct.some(has);
}

/* a place's or a thing's name, a leading "the" or "a" set aside ("The Wells
 * Residence" is Wells Residence) */
export function plainName(name) {
  return foldName(name).replace(/^(?:the|a|an)\s+/, '');
}
