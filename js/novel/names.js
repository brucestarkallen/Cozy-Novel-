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
  duke: 'peer', duchess: 'peer', count: 'peer', countess: 'peer', baron: 'peer', baroness: 'peer', earl: 'peer', viscount: 'peer', marquis: 'peer', marquess: 'peer',
  saint: 'holy',
  old: 'nick', young: 'nick', little: 'nick', big: 'nick',
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
  /* one name, and a longer one that adds a name's words to it — a surname, a
   * given name, a title — never role words: "Red" is not the "Red Guard
   * captain" (Cozy Tavern M490-3, M471-2) */
  if (wa.length === 1 && wb.length > 1 && (wb[0] === wa[0] || wb[wb.length - 1] === wa[0]) && namesOnly(b)) return true;
  if (wb.length === 1 && wa.length > 1 && (wa[0] === wb[0] || wa[wa.length - 1] === wb[0]) && namesOnly(a)) return true;
  if (wa.length >= 2 && wa.length === wb.length && [...wa].sort().join(' ') === [...wb].sort().join(' ')) return true;
  /* a name cut short on purpose — "Rukia K.", "Kaelen St." — is the whole one; two
   * names that only share a start are two people: Mei Lin and Mei Ling, John
   * Smith and John Smithson */
  if (wa.length >= 2 && wb.length >= 2) {
    const [shortOne, longOne, shortRaw] = fa.length <= fb.length ? [fa, fb, a] : [fb, fa, b];
    if (longOne.startsWith(shortOne) && longOne.length > shortOne.length && /[.…]$/.test(String(shortRaw || '').trim())) return true;
  }
  return false;
}
/* every word of a name as written is a name's — a capital, or a script with
 * no capitals — or one of the little words names carry (da, van, bin) */
const NAME_PARTICLES = new Set(['da', 'de', 'del', 'della', 'di', 'du', 'van', 'von', 'der', 'den', 'ter', 'le', 'la', 'bin', 'ibn', 'al', 'el', 'no', 'y']);
function namesOnly(raw) {
  return String(raw || '').trim().split(/\s+/).filter(Boolean).every((w) => /^[^\p{L}]*[\p{Lu}\p{Lt}\p{Lo}\p{N}]/u.test(w) || NAME_PARTICLES.has(w.toLowerCase()));
}

/* A SLIP OF THE PEN IS FORGIVEN ONLY WHERE IT CAN BE ONE (Cozy Tavern M646).
 * One word of the name a letter off — two, in a word of ten letters or more —
 * inside a word of six letters at least, every other word the same and no
 * title that disagrees: "Hitsugaya" and "Hitsugayo" are one man. A short name
 * a letter off is another name — Mira is not Mina, Tom is not Tim, Jon is not
 * John — and "Tom Wells" and "Tim Wells" are brothers. */
function boundedLevenshtein(a, b, bound) {
  if (Math.abs(a.length - b.length) > bound) return bound + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > bound) return bound + 1;
    prev = cur;
  }
  return prev[b.length];
}
export function nearName(a, b) {
  if (titlesConflict(a, b)) return false;
  const x = parseName(a).words;
  const y = parseName(b).words;
  if (!x.length || x.length !== y.length) return false;
  let slips = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    const short = Math.min(x[i].length, y[i].length);
    if (short < 6) return false;
    const bound = short >= 10 ? 2 : 1;
    if (boundedLevenshtein(x[i], y[i], bound) > bound) return false;
    slips += 1;
  }
  return slips === 1;
}

/* A GROUP IS NOT A PERSON (Cozy Tavern M484, M490-3): a determiner and a word
 * for people that ends the name ("the onlookers behind the taped line",
 * "several guards", "the rest"), or a bare plural of one ("Harbour runners").
 * "of" before the word ("Captain of the guards"), a possessive, or anything
 * after it but where they stand or who they are ("Squad Leader Hayes") is a
 * person. */
const GROUP_PLURAL = '(?:onlookers|bystanders|crowds|people|passers-?by|guards|officers|soldiers|troops|villagers|townsfolk|townspeople|men|women|children|kids|students|runners|attendants|servants|thugs|bandits|goons|others|spectators|reporters|guests|patrons|workers|refugees|civilians|sailors|fishermen|monks|nuns|priests|pirates|knights|riders|mercenaries)';
const GROUP_COLLECTIVE = '(?:crowd|mob|patrol|squad|unit|team|band|gang|pair|couple|group|handful|dozen|rest)';
const GROUP_AFTER = '(?:\\s+(?:behind|at|by|near|in|on|from|outside|inside|around|along|under|over|beside|across|with|of|who|that|watching|waiting)\\b.*)?';
const GROUP_BEFORE = "(?:(?!of\\b)[\\p{L}-]+\\s+)";
const GROUP_DET = '(?:the|a|an|some|several|a few|many|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
const GROUP_WITH_DET = new RegExp('^' + GROUP_DET + '\\s+' + GROUP_BEFORE + '{0,3}(?:' + GROUP_PLURAL + '|' + GROUP_COLLECTIVE + ')' + GROUP_AFTER + '$', 'iu');
const GROUP_BARE = new RegExp('^' + GROUP_BEFORE + '{0,2}' + GROUP_PLURAL + GROUP_AFTER + '$', 'iu');
export function isGroupName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n || /['’]s\b/i.test(n)) return false;
  return GROUP_WITH_DET.test(n) || GROUP_BARE.test(n);
}

/* Is this name in this text? The whole name, or any word of it that names
 * someone — never a title, a joining word, or the owner in "Jovan's mother".
 * `folded` is the text already folded (foldedText), for asking of many names. */
export function foldedText(text, { cased = false } = {}) {
  /* cased: the words with their capitals kept (accents off), so one word of a
   * name is asked of the book as a name — "Will" for Will Turner is never
   * "she will go", "Wells" never "the old wells" (Cozy Tavern's M257/M280) */
  return { loose: ' ' + foldName(text) + ' ', tight: ' ' + nameFold(text) + ' ', ...(cased ? { cased: String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '') } : {}) };
}
export function nameInText(folded, name, { words = true } = {}) {
  const f = typeof folded === 'string' ? foldedText(folded) : folded;
  const present = (w) => Boolean(w) && (f.loose.includes(' ' + w + ' ') || f.tight.includes(' ' + w + ' '));
  /* with the capitals kept, a lone word of the name stands only where the book writes it as a name */
  const capitalised = (w) => {
    if (!f.cased) return true;
    /* any casing after its first letter ("McAllister", "DuBois"): only the first letter has to be a capital */
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of f.cased.matchAll(re)) if (m[0][0] !== m[0][0].toLowerCase()) return true;
    return false;
  };
  const has = present;
  const raw = String(name || '');
  const P = parseName(raw);
  if (has(P.bare) || has(foldName(raw))) return true;
  if (!words) return false;
  const owners = new Set([...raw.matchAll(/([\p{L}\p{M}\p{N}'’‘ʼ-]+)['’‘ʼ]s(?![\p{L}])/gu)].map((m) => nameFold(m[1] + 's')));
  const ws = P.words.filter((w) => !owners.has(w) && !NAME_STOP.has(w));
  let distinct = ws.filter((w) => w.length >= 3);
  if (!distinct.length) distinct = ws.filter((w) => w.length >= 2);
  return distinct.some((w) => present(w) && capitalised(w));
}

/* A place's or a thing's name in other words — one name's telling words all
 * in the other's ("the letter" and "Claire's letter", "the Barracks" and "the
 * 10th Division Barracks"): it may be the same, or another; never written on
 * as the same (Cozy Tavern M752 — the notes' check folds what is) */
export function namesNear(a, b) {
  const words = (x) => new Set(plainName(x).replace(/\b(\p{L}+) s\b/gu, '$1').split(' ').filter((w) => w.length >= 3 && !['the', 'and', 'of', 'for', 'with', 'from'].includes(w)));
  const x = words(a);
  const y = words(b);
  const [short, long] = x.size <= y.size ? [x, y] : [y, x];
  if (!short.size || short.size === long.size) return false;
  for (const w of short) if (!long.has(w)) return false;
  return true;
}

/* a place's or a thing's name, a leading "the" or "a" set aside ("The Wells
 * Residence" is Wells Residence) */
export function plainName(name) {
  return foldName(name).replace(/^(?:the|a|an)\s+/, '');
}

/* The names and the figures in a telling (Cozy Tavern M752-012: what a record
 * put right may say only as the book gives it): every number, and every word
 * with a capital that does not open a sentence or a quotation — "Mara's"
 * as Mara; a number with an ordinal's ending ("3rd") is let be. */
export function namesAndFigures(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(/\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?|\p{Lu}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*/gu)) {
    const tok = m[0];
    if (/^\d/.test(tok)) { if (!/(?:st|nd|rd|th)$/.test(tok)) out.push(tok); continue; }
    if (tok.length < 2) continue;
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(t[k])) k--;
    if (k < 0 || /[.!?…:"“‘(\[]/.test(t[k])) continue;
    out.push(tok.replace(/['’]s$/i, ''));
  }
  return out;
}

/* AN OWNER'S POSSESSIVE IS NOT A THING'S NAME (Cozy Tavern M605): "Bruce's
 * Batwing" is the Batwing — set aside when only one of two names has it, and
 * only before a name of its own (a capital: "Batwing", "Hollow Crown"); a
 * thing told by what it is ("Claire's letter", "the letter") may be another
 * of its kind, and stays near, never the same (Cozy Tavern M522). Two owners
 * must be the same owner ("Gordon's case file" and "Barbara's case file"
 * stay two). For a place or a thing only: a thread's owner is what it is
 * about ("Tom's promise"). */
function ownerSplit(name) {
  const m = /^\s*(?:the\s+)?(\S.*?)(?:['’]s|(?<=s)['’])\s+(\S.*)$/i.exec(String(name || ''));
  return m && /^\p{Lu}/u.test(m[2]) ? { owner: foldName(m[1]), rest: plainName(m[2]) } : null;
}
export function sameThingName(a, b) {
  if (plainName(a) === plainName(b)) return true;
  const x = ownerSplit(a);
  const y = ownerSplit(b);
  if (x && y) return false;
  if (x) return Boolean(x.rest) && x.rest === plainName(b);
  if (y) return Boolean(y.rest) && y.rest === plainName(a);
  return false;
}

/* ------------------------------------------------------- the hard tokens */
/* What a chapter's summary loses most disastrously, and what code can check
 * without a model (Cozy Tavern M111): the NAMES the chapter holds — the
 * notes' own, and any capitalised word it repeats inside a sentence (a
 * contraction or "I" never one, a possessive folded onto its name: M192) —
 * and the FIGURES (counts, times, money, distances; a year or a bare single
 * digit is not one). */
const TOKEN_STOP = new Set(['The', 'She', 'They', 'And', 'But', 'Then', 'When', 'His', 'Her', 'Hers', 'Their', 'You', 'Your', 'Not', 'For', 'With', 'That', 'This', 'There', 'These', 'Those',
  'What', 'Where', 'Who', 'How', 'Why', 'Yes', 'Now', 'Still', 'Just', 'Even', 'Only', 'Fine', 'Okay', 'Sir', 'Madam', 'Miss', 'Mister', 'God',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const CONTRACTION = /['’](m|ve|ll|re|d|t)$/i;
const UNITS = '%|am|pm|a\\.m\\.|p\\.m\\.|o[\'’]clock|men|women|soldiers|riders|ships|guards|gold|silver|coins|crowns|dollars|euros|pounds|yen|seconds|minutes|hours|days|nights|weeks|months|years|km|kilometres|kilometers|miles|metres|meters|feet|yards|steps|rounds|shots';
const FIGURE = new RegExp(`\\b(\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d+)?|\\d+)(\\s*(?:${UNITS}))?(?![\\p{L}\\d])`, 'giu');
export function hardTokens(text, knownNames = []) {
  const t = String(text || '');
  const names = new Set();
  const folded = foldedText(t);
  for (const n of knownNames || []) if (String(n || '').trim().length >= 2 && nameInText(folded, n, { words: false })) names.add(String(n).trim());
  const counts = new Map();
  for (const m of t.matchAll(/(?<![.!?…]\s|^|["“‘(—–]|\n)\b(\p{Lu}[\p{Ll}'’-]{2,})(?![\p{L}])/gmu)) {
    let w = m[1];
    if (/^I['’]/.test(w) || CONTRACTION.test(w)) continue;
    const bare = w.replace(/['’]s$/i, '');
    if (bare.length >= 3) w = bare;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const knownFolded = [...names].map((n) => foldName(n));
  for (const [w, c] of counts) if (c >= 2 && !TOKEN_STOP.has(w) && !knownFolded.some((k) => (' ' + k + ' ').includes(' ' + foldName(w) + ' '))) names.add(w);
  const figures = new Set();
  for (const m of t.matchAll(FIGURE)) {
    if (/^(1[5-9]|20)\d\d$/.test(m[1]) && !m[2]) continue;
    if (!m[2] && Number(String(m[1]).replace(/[.,]/g, '')) < 10) continue;
    figures.add((m[1] + (m[2] || '')).replace(/\s+/g, ' ').trim());
  }
  return { names: [...names], figures: [...figures] };
}
/* which of them a summary has lost: a name kept whole or by any word of it, a figure by its number */
export function tokensMissing(text, summary, knownNames = []) {
  const { names, figures } = hardTokens(text, knownNames);
  const kept = foldedText(summary);
  const keptRaw = ' ' + String(summary || '').toLowerCase().replace(/\s+/g, ' ') + ' ';
  return {
    names: names.filter((n) => !nameInText(kept, n)),
    figures: figures.filter((f) => !new RegExp(`(?<![\\d.,])${f.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d])`).test(keptRaw)),
  };
}
/* a bare list of words is not a summary's sentence (Cozy Tavern M208): "also
 * named: Rachel, British, American" is the app talking nonsense to the writer */
export function looksLikeTokenDump(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(also named|figures?|names?)\s*:/i.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length < 4) return false;
  const commas = (t.match(/,/g) || []).length;
  const joiners = (t.match(/\b(is|was|are|were|has|had|said|told|and|of|in|at|to|for|with|from|who|which|that)\b/gi) || []).length;
  return commas >= 3 && joiners <= 1;
}

/* A NAME HIS HAND CHANGED (Cozy Tavern M100, the ripple, made for a book):
 * one name his edit took out everywhere it stood in the passage, with
 * another in its place every time — {from, to}. Anything more (a rewrite, two
 * names at once), a word the book does not hold as a name (`isName`: a card's
 * name, or a word it capitalises inside a sentence — never "Rain" changed to
 * "Snow" at a sentence's start), or a change made in only some places, is
 * not one. A possessive is its name's ("Mara's" is Mara). */
export function nameChange(before, after, isName = () => false) {
  const words = (t) => [...String(t || '').matchAll(/(?<![\p{L}\p{M}\p{N}'’-])\p{Lu}[\p{L}\p{M}'’-]*/gu)].map((m) => m[0].replace(/['’]s$/i, '').replace(/['’-]+$/, ''));
  const count = (list) => list.reduce((m, w) => m.set(w, (m.get(w) || 0) + 1), new Map());
  const b = count(words(before));
  const a = count(words(after));
  const gone = [...b.keys()].filter((w) => !a.has(w));
  const came = [...a.keys()].filter((w) => !b.has(w));
  if (gone.length !== 1 || came.length !== 1) return null;
  const from = gone[0];
  const to = came[0];
  if (from.length < 2 || to.length < 2 || TOKEN_STOP.has(from) || TOKEN_STOP.has(to) || !isName(from)) return null;
  /* every place it stood, and only there */
  if (a.get(to) !== b.get(from)) return null;
  return { from, to };
}
/* is this word one a text capitalises inside a sentence (a name, not a sentence's first word)? */
export function namedMidSentence(text, word) {
  const w = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(w) && new RegExp(`(?<![.!?…]\\s|^|["“‘(—–]|\\n)(?<![\\p{L}\\p{M}\\p{N}])${w}(?![\\p{L}\\p{M}\\p{N}])`, 'mu').test(String(text || ''));
}


/* ------------------------------------------------- a name changed everywhere */

const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* a name as a whole word, as written or in capitals (Cozy Tavern's
 * spelling) — never part of a longer word, nor of a name joined with a
 * hyphen ("Mary" is not in "Mary-Jane") */
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])(?<![\\p{L}\\p{N}]-)';
const EDGE_AFTER = '(?![\\p{L}\\p{N}_])(?!-[\\p{L}\\p{N}])';
export function nameRe(name) {
  const n = String(name || '');
  const forms = [...new Set([n, n.toUpperCase()])].map(escRe).join('|');
  return new RegExp(`${EDGE_BEFORE}(?:${forms})${EDGE_AFTER}`, 'gu');
}
/* Several changes of one text made in one pass over it as it stood — each
 * place changed once, by the longest change that finds it there, and never
 * again by another (Cozy Tavern's M675-8: "Kara" to "Mara" and "Mara" to
 * "Kara" made together swap the two; made one after the other they leave
 * one name for both). rules: [{re, to(match), skip(text) -> [[from, to]]}].
 * {text, counts} — how many places each rule changed. */
export function replaceMany(text, rules) {
  const t = String(text || '');
  const hits = [];
  rules.forEach((r, k) => {
    const skip = r.skip ? r.skip(t) : [];
    for (const m of t.matchAll(new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : `${r.re.flags}g`))) {
      if (!m[0]) continue;
      const a = m.index;
      const b = a + m[0].length;
      if (skip.some(([x, y]) => a >= x && b <= y)) continue;
      hits.push({ a, b, k, m: m[0] });
    }
  });
  hits.sort((x, y) => x.a - y.a || (y.b - y.a) - (x.b - x.a) || x.k - y.k);
  const counts = rules.map(() => 0);
  let out = '';
  let at = 0;
  for (const h of hits) {
    if (h.a < at) continue;
    out += t.slice(at, h.a) + rules[h.k].to(h.m);
    at = h.b;
    counts[h.k]++;
  }
  return { text: out + t.slice(at), counts };
}
/* a name changed wherever it stands — but never where it is already part
 * of the name it becomes ("Oda" to "Oda Jovan" leaves "Oda Jovan" as it is) */
export function renameRule(from, to) {
  const up = String(from).toUpperCase();
  return {
    re: nameRe(from),
    skip: (t) => [...t.matchAll(nameRe(to))].map((m) => [m.index, m.index + m[0].length]),
    to: (m) => (m === up && up !== from ? String(to).toUpperCase() : to),
  };
}
/* names changed in a text, all at once: pairs [{from, to}] */
export function renameIn(text, pairs) {
  const rules = (pairs || []).filter((x) => x && x.from && x.to && x.from !== x.to).map((x) => renameRule(x.from, x.to));
  return rules.length ? replaceMany(text, rules).text : String(text == null ? '' : text);
}
/* every word of an answer renamed: strings in it, however deep (a helper's answer asked before a name changed) */
export function renameAll(value, pairs) {
  if (!pairs || !pairs.length) return value;
  if (typeof value === 'string') return renameIn(value, pairs);
  if (Array.isArray(value)) return value.map((x) => renameAll(x, pairs));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameAll(v, pairs)]));
  return value;
}

/* A text's first sentence (twenty letters at least): a full stop after a
 * title or an initial — "Dr. Wells", "J. Hale", "St. Ives" — or in "e.g." is
 * no sentence's end (Cozy Tavern's M292: "Ms. June runs the Bluebird" was
 * once cut to "Ms. June — Ms") */
const TITLE_STOP = /(?:^|[\s(“"'])(?:Mr|Mrs|Ms|Mx|Dr|St|Prof|Capt|Lt|Sgt|Mt|Gen|Col|Cmdr|Sr|Jr|Rev|Hon|vs|etc|No|e\.g|i\.e|[A-Z])\.$/;
export function firstSentence(text) {
  const x = String(text || '').trim();
  const re = /[.!?…](?=\s|$)/g;
  for (let m = re.exec(x); m; m = re.exec(x)) {
    const end = m.index + 1;
    if (end < 20) continue;
    const head = x.slice(0, end);
    if (m[0] === '.' && TITLE_STOP.test(head)) continue;
    return head;
  }
  return x;
}
