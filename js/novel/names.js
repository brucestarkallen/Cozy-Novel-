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
  const key = String(name || '');
  if (key.length > LONG_FROM) return foldLong(key).loose;
  return remembered(FOLDED, key, () => key.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
}

/* A WHOLE BOOK FOLDED (2.12.6). The helper and the checker ask whether a name
 * stands in the book — the book whole, a chapter, the chapters before — many
 * times for each page: through the regexes above, a book of 300,000 words
 * took 460 ms each time (1.5 s on a phone), on the thread the page draws
 * with; that was the lag while they worked. A long text is folded in one
 * pass over its letters instead — both ways at once, the apostrophe kept
 * inside a word (tight) and not (loose) — and the answer kept while the
 * words are the same, so asking again costs the look-up alone. Same answer
 * as the regexes, letter for letter (tests/app.mjs holds them together). */
const LONG_FROM = 200;
const LONG = new Map();           /* text -> { loose, tight } */
const LONG_KEEP = 6e6;            /* letters kept in all (a long book twice over), the oldest let go first */
let longHeld = 0;
const APOSTROPHE = new Set([0x27, 0x2019, 0x2018, 0x2bc]);
const IS_LETTER = /\p{L}/u, IS_NUMBER = /\p{N}/u, IS_MARK = /\p{M}/u;
const OTHER = 0, LETTER = 1, NUMBER = 2, MARK = 3, ACCENT = 4;   /* ACCENT: a combining mark the fold takes off (U+0300–U+036F) */
const CLASS_AT = new Map();       /* code point -> what it is */
function classOf(cp) {
  if (cp >= 0x300 && cp <= 0x36f) return ACCENT;
  let c = CLASS_AT.get(cp);
  if (c === undefined) {
    const ch = String.fromCodePoint(cp);
    c = IS_LETTER.test(ch) ? LETTER : IS_NUMBER.test(ch) ? NUMBER : IS_MARK.test(ch) ? MARK : OTHER;
    CLASS_AT.set(cp, c);
  }
  return c;
}
function foldLong(text) {
  const had = LONG.get(text);
  if (had) return had;
  const made = foldPair(text);
  LONG.set(text, made);
  longHeld += text.length;
  for (const k of LONG.keys()) { if (longHeld <= LONG_KEEP) break; LONG.delete(k); longHeld -= k.length; }
  return made;
}
/* The regexes, as one pass: the letters taken apart (NFD) and lowered; an
 * accent (U+0300–U+036F) comes off and is nothing; every other run of what is
 * not a letter or a figure is one space, none at either end. tight differs in
 * one thing: an apostrophe right after a letter or a mark and right before a
 * letter is nothing (O'Brien is obrien, Jovan's is jovans; 9's stays 9 s, and
 * an accent still on the letter counts as a mark, as the regex saw it) —
 * U+02BC is a letter in loose, an apostrophe in tight. */
function foldPair(text) {
  const s = text.normalize('NFD').toLowerCase();
  const n = s.length;
  const loose = [], tight = [];
  let runL = -1, runT = -1;             /* where the run being copied began, or -1 */
  let gapL = false, gapT = false;       /* a space owed before the next run */
  const flush = (out, start, i, gap) => { if (gap && out.length) out.push(' '); out.push(s.slice(start, i)); };
  let prev = OTHER;
  for (let i = 0; i < n;) {
    let cp = s.charCodeAt(i), w = 1, c;
    if (cp < 128) c = (cp >= 97 && cp <= 122) ? LETTER : (cp >= 48 && cp <= 57) ? NUMBER : OTHER;
    else {
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < n) { cp = s.codePointAt(i); w = 2; }
      c = classOf(cp);
    }
    if (c === ACCENT) { prev = MARK; i += w; continue; }   /* taken off: the run goes on around it */
    if ((c === LETTER && cp !== 0x2bc) || c === NUMBER) {
      if (runL < 0) runL = i;
      if (runT < 0) runT = i;
      prev = c;
      i += w;
      continue;
    }
    /* one plain space between two letters is itself what the fold would write: the run goes on through it */
    if (cp === 32 && runL >= 0 && runT >= 0 && i + 1 < n) {
      const nc = s.charCodeAt(i + 1);
      if ((nc >= 97 && nc <= 122) || (nc >= 48 && nc <= 57)) { prev = OTHER; i++; continue; }
    }
    let skipT = false;
    if ((cp === 0x27 || cp === 0x2019 || cp === 0x2018 || cp === 0x2bc) && (prev === LETTER || prev === MARK) && i + w < n) skipT = classOf(s.codePointAt(i + w)) === LETTER;
    /* loose: U+02BC is a letter; the rest break the run */
    if (cp === 0x2bc) { if (runL < 0) runL = i; } else if (runL >= 0) { flush(loose, runL, i, gapL); runL = -1; gapL = true; }
    if (skipT) { if (runT >= 0) { flush(tight, runT, i, gapT); runT = -1; gapT = false; } }
    else if (cp === 0x2bc) { if (runT < 0) runT = i; }
    else if (runT >= 0) { flush(tight, runT, i, gapT); runT = -1; gapT = true; }
    /* (the letter before a skipped apostrophe is spent on it, as the regex spends it: the one after cannot be another's letter before) */
    prev = skipT ? OTHER : c;
    i += w;
  }
  if (runL >= 0) flush(loose, runL, n, gapL);
  if (runT >= 0) flush(tight, runT, n, gapT);
  const bare = (parts) => parts.join('').replace(/[̀-ͯ]/g, '');
  return { loose: bare(loose), tight: bare(tight) };
}

/* A name is folded and parsed again and again — every card held against
 * every name the bibliography gathers (bibItems: 1,500 names and 400 cards
 * took 1.7 s, most of it here): each short name's answer is kept, up to a
 * few thousand, and the store let go once it is full. Pure functions of the
 * name, so the answer kept is the answer. */
const FOLDED = new Map();
const PARSED = new Map();
function remembered(store, key, make) {
  if (key.length > 200) return make();
  const had = store.get(key);
  if (had !== undefined) return had;
  const made = make();
  if (store.size >= 8000) store.clear();
  store.set(key, made);
  return made;
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
  const raw = String(name || '');
  if (raw.length > LONG_FROM) return foldLong(raw).tight;
  return foldName(raw.replace(/([\p{L}\p{M}])['’‘ʼ](?=\p{L})/gu, '$1'));
}
/* a courtesy or a rank after the name only when joined to it the Japanese way */
const TRAILING = /[-‐‑–]\s*(san|sama|kun|chan|dono|sensei|senpai|taich[oō]u?|fukutaich[oō]u?|s[oō]taich[oō]u?)\s*$/iu;
/* (kept: never changed by those who read it — titles read, words copied before sorting) */
function parseName(name) {
  const key = String(name || '');
  return remembered(PARSED, key, () => parsedName(key));
}
function parsedName(name) {
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
/* (a possessive needs an apostrophe: two names with none are never an owner and the one who is theirs — asked of every
 * card a name could be, the join of his entries above all: 2.12.41) */
const APOSTROPHES = /['’‘ʼ]/;
export function samePersonName(a, b) {
  if (APOSTROPHES.test(String(a || '')) || APOSTROPHES.test(String(b || ''))) {
    if (ownerAndDependent(a, b)) return false;
    if (sameOwnedDescriptor(a, b)) return true;
  }
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
/* A FAMILY'S NAME ALONE (2.12.41, the third review of Quick add: "Kuchiki" — the Kuchiki, a noble house — was put into
 * Rukia Kuchiki's entry, and his partner's change made her a group): a name of one word past its titles that is the last
 * word of a longer name and not its first ("Kuchiki", "Captain Venn" for Mara Venn). It names a family, or another of it,
 * as well as anyone — so a bibliography never finds an entry by it alone (bibliography.js entryFor); a given name is
 * found ("Mara" for Mara Venn). Only for that: who is the same person stays samePersonName's. */
export function familyNameOnly(a, b) {
  const A = parseName(a);
  const B = parseName(b);
  const [one, more] = A.words.length === 1 && B.words.length > 1 ? [A, B] : B.words.length === 1 && A.words.length > 1 ? [B, A] : [null, null];
  if (!one) return false;
  return more.words[more.words.length - 1] === one.words[0] && more.words[0] !== one.words[0];
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
  const raw = String(text || '');
  const pair = raw.length > LONG_FROM ? foldLong(raw) : { loose: foldName(raw), tight: nameFold(raw) };
  return { loose: ' ' + pair.loose + ' ', tight: ' ' + pair.tight + ' ', ...(cased ? { cased: raw.normalize('NFD').replace(/[̀-ͯ]/g, '') } : {}) };
}
export function nameInText(folded, name, { words = true } = {}) {
  const f = typeof folded === 'string' ? foldedText(folded) : folded;
  const present = (w) => Boolean(w) && (f.loose.includes(' ' + w + ' ') || f.tight.includes(' ' + w + ' '));
  /* with the capitals kept, a lone word of the name stands only where the book writes it as a name */
  /* (2.12.41, the review: "O'Brien" and "D'Arcy" never stood as a name, nor a name in a script with no capitals, nor
   * one he writes in small letters himself — the apostrophe inside a name folded as nameFold folds it, a letter with no
   * capital counted as one, and a name written all in small letters asked of the book in any letters) */
  const capitalised = (w) => {
    if (!f.cased || !/\p{Lu}/u.test(String(name || ''))) return true;
    if (f.casedFolded === undefined) f.casedFolded = f.cased.replace(/([\p{L}\p{M}])['’‘ʼ](?=\p{L})/gu, '$1');
    /* any casing after its first letter ("McAllister", "DuBois"): only the first letter has to be a capital */
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');
    /* (in the words as written — "Kira's", "Mara'll" — or with an apostrophe inside a name folded — "O'Brien": both,
     * 2.12.41, the review of the review: folding alone lost the possessive) */
    for (const t of [f.cased, f.casedFolded]) for (const m of t.matchAll(re)) { const c = m[0][0]; if (c !== c.toLowerCase() || c === c.toUpperCase()) return true; }
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
  /* a number standing alone; or a word whole — a name with a figure in it ("C3PO", "R2-D2", "Card7") is one name, never a name and a figure */
  for (const m of t.matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?(?![\p{L}\p{N}])|[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu)) {
    const tok = m[0];
    if (/^\d+(?:[.,:]\d+)*(?:st|nd|rd|th)?$/.test(tok)) { if (!/(?:st|nd|rd|th)$/.test(tok)) out.push(tok); continue; }
    /* a word that is not a name: no capital to open it */
    if (!/^\p{Lu}/u.test(tok)) continue;
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
/* A FIGURE A SUMMARY GIVES THAT ITS WORDS NEVER DO (Cozy Tavern's detail
 * check: a wrong fact is not a missing one — "seventeen" where the chapter
 * says sixteen, "1847" where it says 1874). Counted by value, in digits or in
 * words from ten to ninety-nine; a single digit is no figure, as above, and a
 * chapter's own number ("Chapter Twelve") is not one of its figures. A
 * hundred or a thousand written in words cannot be told by value here, so a
 * figure of 100 or more is held to the words only when they write none. */
const TENS_WORDS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ONES_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const NUMBER_WORD = new RegExp(`(?<![\\p{L}\\p{N}'’-])(${Object.keys(TENS_WORDS).join('|')})(?:[-\\s](${Object.keys(ONES_WORDS).join('|')}))?(?![\\p{L}\\p{N}'’-])`, 'giu');
const BIG_WORDS = /(?<![\p{L}])(hundred|thousand|million)s?(?![\p{L}])/iu;
function figureValues(text) {
  const t = String(text || '');
  const out = new Map();
  const ownNumber = (i) => /(?:chapter|part|book|volume)\s+$/i.test(t.slice(Math.max(0, i - 10), i));
  for (const m of t.matchAll(FIGURE)) {
    if (ownNumber(m.index)) continue;
    const raw = String(m[1]);
    const v = Number(/^\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw.replace(/,/g, ''));
    if (!Number.isFinite(v) || v < 10) continue;
    if (!out.has(v)) out.set(v, (m[1] + (m[2] || '')).replace(/\s+/g, ' ').trim());
  }
  for (const m of t.matchAll(NUMBER_WORD)) {
    if (ownNumber(m.index)) continue;
    const tens = TENS_WORDS[m[1].toLowerCase()];
    const v = tens + (tens >= 20 && m[2] ? ONES_WORDS[m[2].toLowerCase()] : 0);
    if (!out.has(v)) out.set(v, (tens >= 20 && m[2] ? m[0] : m[1]).replace(/\s+/g, ' '));
  }
  return out;
}
export function figuresInvented(text, summary) {
  const have = figureValues(text);
  const bigInWords = BIG_WORDS.test(String(text || ''));
  return [...figureValues(summary)].filter(([v]) => !have.has(v) && !(v >= 100 && bigInWords)).map(([, shown]) => shown);
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

/* THE NAMES A TEXT GIVES, BY THEIR WORDS (2.12.41, the review — what a change took out of a page is decided from the
 * change itself, as it is made, never from the notes as they stand that day): every word the text writes with a capital,
 * a possessive folded onto its name ("Mara's" is Mara) — never one it also writes in small letters ("Rain fell. The rain
 * kept on" gives no name), a little word that opens a sentence ("The", "She", "After"), a single letter or a
 * contraction. The words by their keys (accents off, small letters), a Set. */
const OPENERS = new Set([...TOKEN_STOP, 'A', 'An', 'He', 'It', 'We', 'Me', 'Us', 'Him', 'Them', 'My', 'Our', 'Its', 'If', 'So', 'As', 'At',
  'In', 'On', 'Of', 'To', 'By', 'Or', 'Nor', 'Yet', 'After', 'Before', 'Once', 'Later', 'Soon', 'Here', 'All', 'Some', 'Every', 'Each', 'No',
  'Nobody', 'Nothing', 'Everyone', 'Everything', 'Someone', 'Something', 'Today', 'Tonight', 'Tomorrow', 'Yesterday', 'Again', 'Maybe',
  'Perhaps', 'Please', 'Oh', 'Ah', 'Although', 'Though', 'Because', 'Since', 'While', 'Until', 'Unless', 'However', 'Meanwhile',
  'Suddenly', 'Finally', 'Instead', 'Also', 'Never', 'Always', 'Sometimes', 'Next', 'First', 'Inside', 'Outside', 'Above', 'Below',
  'Behind', 'Beyond', 'Into', 'Out', 'Up', 'Down', 'Over', 'Under', 'From', 'About', 'Without', 'Within', 'Through', 'Across', 'Around',
  'Between', 'Among', 'Against', 'Toward', 'Towards', 'Upon', 'Like', 'Do', 'Does', 'Did', 'Is', 'Are', 'Was', 'Were', 'Be', 'Been',
  'Have', 'Has', 'Had', 'Would', 'Could', 'Should', 'Must', 'Let', 'Every', 'Whatever', 'Whoever', 'Whenever', 'Wherever', 'Which',
  'Whose', 'Whom', 'Very', 'Too', 'Much', 'More', 'Most', 'Less', 'Few', 'Many', 'Both', 'Either', 'Neither', 'Other', 'Another', 'Such',
  'Same', 'Own', 'Yours', 'Mine', 'Ours', 'Theirs', 'Himself', 'Herself', 'Itself', 'Myself', 'Themselves', 'Ourselves', 'Yourself'].map((w) => w.toLowerCase()));
const ANY_WORD = /(?<![\p{L}\p{M}\p{N}'’-])\p{L}[\p{L}\p{M}'’-]*/gu;
const wordKey = (w) => String(w || '').replace(/['’]s$/i, '').replace(/['’-]+$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* a text's words by their keys: those it writes with a capital (the first form of each) — and those of them it writes so
 * inside a sentence (`mid`) — and those it writes in small letters */
const SENTENCE_START = /[.!?…"“”‘’'(\[—–*_\n]/;
function wordsScanned(text) {
  const t = String(text || '');
  const small = new Set();
  const caps = new Map();
  const mid = new Set();
  for (const m of t.matchAll(ANY_WORD)) {
    const w = m[0];
    const k = wordKey(w);
    if (!k) continue;
    if (!/^\p{Lu}/u.test(w)) { small.add(k); continue; }
    if (!caps.has(k)) caps.set(k, w);
    let i = m.index - 1;
    while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
    if (i >= 0 && !SENTENCE_START.test(t[i])) mid.add(k);
  }
  return { small, caps, mid };
}
/* (known: the book's own names by their words — names.js nameWordsOf, a Map of each word to 'person' or 'thing' — 2.12.41,
 * the review of 2.12.41: a name the page also writes as a word, "Will" beside "he will stay", "Rose" beside "a rose", was
 * never a name, and his edit taking Will out of the page took nothing out. A word of a person's name, written with a
 * capital, is a name; a word of a place's, a thing's or lore's name — "Magic", "Order" — only where the page writes it
 * so inside a sentence, never for a sentence it opens.) */
function namesScanned(s, known) {
  const out = new Set();
  for (const [k, w] of s.caps) {
    if (k.length < 2 || /^I['’]/.test(w) || CONTRACTION.test(w)) continue;
    const kind = known ? (known instanceof Map ? known.get(k) : known.has(k) ? 'person' : '') : '';
    if (kind === 'person' || (kind === 'thing' && s.mid.has(k)) || (!s.small.has(k) && !OPENERS.has(k))) out.add(k);
  }
  return out;
}
export function nameWordsIn(text, { known = null } = {}) {
  return namesScanned(wordsScanned(text), known);
}
/* THE NAMES A CHANGE TOOK OUT OF A PAGE (2.12.41): the names (nameWordsIn) the words before give that the words after do
 * not — sorted. A name stands in the words after in any letters ("TOM!", "tom"), but a name the words before also write
 * as a word ("Will" and "he will") only as a name, with a capital; a name joined with a hyphen stands while its parts do
 * ("Mary-Jane" written "Mary Jane", and the other way about: 2.12.41, the review of 2.12.41 — the hyphen alone taken out
 * took the name out). known: the book's names at the moment of the change (nameWordsOf), kept with it as it is made. */
export function nameWordsGone(before, after, { known = null } = {}) {
  const b = wordsScanned(before);
  const was = namesScanned(b, known);
  if (!was.size) return [];
  const a = wordsScanned(after);
  const any = new Set([...a.caps.keys(), ...a.small]);
  const named = new Set(a.caps.keys());
  for (const set of [any, named]) for (const k of [...set]) if (k.includes('-')) for (const part of k.split('-')) if (part) set.add(part);
  const stands = (k) => {
    const where = b.small.has(k) ? named : any;
    return where.has(k) || (k.includes('-') && k.split('-').filter(Boolean).every((part) => where.has(part)));
  };
  return [...was].filter((k) => !stands(k)).sort();
}
/* THE BOOK'S NAMES BY THEIR WORDS (2.12.41, the review of 2.12.41): every word of the names given — his entries' and the
 * notes' cards', their other names too — as nameWordsGone knows them, never a title, a rank or a joining word ("Captain
 * Hayes" gives Hayes; "The Order" gives Order). A Set of keys; with `things` too, a Map: each word of `names` (people's)
 * to 'person', each other word of `things` (places', things', lore's) to 'thing'. */
export function nameWordsOf(names, things = null) {
  const wordsOf = (list) => {
    const out = new Set();
    for (const n of list || []) {
      for (const m of String(n || '').matchAll(ANY_WORD)) {
        const k = wordKey(m[0]);
        if (k.length < 2 || NAME_STOP.has(k) || NAME_PARTICLES.has(k) || titleOf(k) || k === 'a' || k === 'an') continue;
        out.add(k);
        if (k.includes('-')) for (const part of k.split('-')) if (part.length >= 2) out.add(part);
      }
    }
    return out;
  };
  const people = wordsOf(names);
  if (!things) return people;
  const out = new Map([...wordsOf(things)].map((k) => [k, 'thing']));
  for (const k of people) out.set(k, 'person');
  return out;
}


/* ------------------------------------------------- a name changed everywhere */

const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* a name as a whole word, as written or in capitals (Cozy Tavern's
 * spelling) — never part of a longer word, nor of a name joined with a
 * hyphen ("Mary" is not in "Mary-Jane") */
/* (an underscore is no letter: _Mara_ is Mara in italics, and is changed with her) */
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])(?<![\\p{L}\\p{N}]-)';
const EDGE_AFTER = '(?![\\p{L}\\p{N}])(?!-[\\p{L}\\p{N}])';
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
/* NAMES CHANGED ONE CHANGE AFTER ANOTHER (2.12.41, round 5 — the review of round 4: every pair ran in one pass, as if
 * all were made together, so a rename and its Undo while a reading was out gave the answer the name undone — a stray
 * card, its turns lost — and a name renamed again gave it the first new name): in turn, one change at a time — the pairs
 * one change made together (one count `n`, else one time `at`) in one pass, as a swap must be — and a change undone (its
 * pairs given back the other way round after it, nothing between touching those names) never made, nor its Undo. Pairs
 * that say nothing of when (mend.js: the swaps one change made) are one change. */
function renameSteps(pairs) {
  const groups = [];
  for (const x of (pairs || []).filter((p) => p && p.from && p.to && p.from !== p.to)) {
    const key = x.n !== undefined ? `n${x.n}` : x.at !== undefined ? `a${x.at}` : '';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.pairs.push(x); else groups.push({ key, pairs: [x] });
  }
  const names = (g) => new Set(g.pairs.flatMap((p) => [String(p.from).toLowerCase(), String(p.to).toLowerCase()]));
  const undoes = (g, h) => g.pairs.length === h.pairs.length && g.pairs.every((p) => h.pairs.some((q) => q.from === p.to && q.to === p.from));
  const out = [];
  for (const g of groups) {
    const mine = names(g);
    let undone = -1;
    for (let k = out.length - 1; k >= 0; k--) {
      if (undoes(out[k], g)) { undone = k; break; }
      if ([...names(out[k])].some((w) => mine.has(w))) break;
    }
    if (undone >= 0) out.splice(undone, 1); else out.push(g);
  }
  return out.map((g) => g.pairs);
}
/* names changed in a text: pairs [{from, to}] — made together, or one change after another (renameSteps) */
export function renameIn(text, pairs) {
  let t = String(text == null ? '' : text);
  for (const step of renameSteps(pairs)) t = replaceMany(t, step.map((x) => renameRule(x.from, x.to))).text;
  return t;
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
