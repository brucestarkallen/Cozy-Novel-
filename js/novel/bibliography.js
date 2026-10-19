/* Cozy Novel — js/novel/bibliography.js — THE BIBLIOGRAPHY (pure)
 *
 * His own entries for the book's people, places, things, groups and lore —
 * what a name means, the way an RPG's codex tells it — kept with the book
 * (`novel.bibliography`). The notes are something else: what the story has
 * established so far, kept by the helper from the pages. An entry is his
 * (or his partner's, at his asking) and nothing else ever writes it.
 *
 * So that it never crowds the request, the writer, the narrator and the
 * checker read an entry only when its name comes up — in his words, or in
 * the words right before the point being written — or always, when he says
 * so; never, when he keeps it for himself. The writer and the narrator also
 * read the ones a page needs that no word near it names, found by what they
 * mean (pickRows, bibpick.js). What rides is fitted to a share of the room,
 * his words' names first, then what the page needs, then the nearest. The
 * partner sees every entry by its name and line, and the ones named here
 * whole.
 *
 * A name is found the way it is written: one written with capitals only with
 * them (or in all capitals, shouted), so "Will" is never "she will"; one in
 * small letters ("bankai") however it is written. Never inside a longer word,
 * nor in a name joined with a hyphen ("Mary" is not in "Mary-Jane"). */
import { newId, nameKey, estimateTokens, hashText } from '../util.js';
import { picked, matchCard, chapterLabel } from './shape.js';
import { foldedText, nameInText, firstSentence, samePersonName, titlesConflict } from './names.js';
import { superActive } from './auto.js';

export const ENTRY_KINDS = ['people', 'places', 'things', 'groups', 'lore'];
export const KIND_TITLE = { people: 'People', places: 'Places', things: 'Things', groups: 'Groups', lore: 'Lore' };
export const KIND_ONE = { people: 'person', places: 'place', things: 'thing', groups: 'group', lore: 'piece of lore' };
/* when the writer reads it ('named': with every page while there is room, and first when it comes up — 2.12.28) */
export const RIDES = ['named', 'always', 'never'];
export const RIDES_WORDS = {
  named: 'When there’s room',
  always: 'Always',
  never: 'Never — it’s only for me',
};
/* …and with Super automatic on, Always and When there's room are one: what each page names or needs (ridingItems byPage) */
export const BY_PAGE_WORDS = 'Page by page — Super automatic';

const clean = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
const cleanName = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 120);
export const kindOf = (k) => (ENTRY_KINDS.includes(k) ? k : 'lore');
/* the kind of entry a word names, as a person or a model would say it ('' when none) */
const KIND_WORDS = { person: 'people', people: 'people', character: 'people', characters: 'people', place: 'places', places: 'places', location: 'places', locations: 'places',
  thing: 'things', things: 'things', item: 'things', items: 'things', object: 'things', objects: 'things', weapon: 'things', group: 'groups', groups: 'groups', faction: 'groups', factions: 'groups', organization: 'groups', organisation: 'groups', clan: 'groups', family: 'groups',
  lore: 'lore', term: 'lore', terms: 'lore', concept: 'lore', rule: 'lore', magic: 'lore', power: 'lore', ability: 'lore', technique: 'lore', event: 'lore', history: 'lore', word: 'lore' };
export const kindSaid = (v) => KIND_WORDS[String(v || '').trim().toLowerCase()] || '';
export const ridesOf = (r) => (RIDES.includes(r) ? r : 'named');

export function newEntry(fields = {}) {
  return {
    id: newId('bb'),
    name: '',
    aka: [],
    kind: 'people',
    line: '',
    text: '',
    rides: 'named',
    at: Date.now(),
    ...fields,
  };
}

/* the entries of a book, as stored (never null) */
export function entriesOf(novel) {
  const list = novel && Array.isArray(novel.bibliography) ? novel.bibliography : [];
  return list.filter((e) => e && typeof e === 'object' && cleanName(e.name));
}

/* HIS ENTRIES AS THE HELPER READS THEM (2.12.40, the audit) — every one but those set to Never ("Never — it’s only for
 * me"): the writer, the narrator and the checker never read those (usableFor), and through 2.12.39 the helper did —
 * a reading put a Never entry's words on a card, and the card rode to the writer. Nor do they count as the book's
 * word. (A lorebook's switched-off entries come in as Never.) */
export function entriesForNotes(novel) { return entriesOf(novel).filter((e) => ridesOf(e.rides) !== 'never'); }

/* an entry made tidy for keeping: a name, other names once each (never its own name), a kind, when it rides */
export function tidyEntry(e) {
  const name = cleanName(e.name);
  const seen = new Set([nameKey(name)]);
  const aka = [];
  for (const a of Array.isArray(e.aka) ? e.aka : String(e.aka || '').split(',')) {
    const n = cleanName(a);
    const k = nameKey(n);
    if (!n || !k || seen.has(k)) continue;
    seen.add(k);
    aka.push(n);
  }
  return { ...e, name, aka, kind: kindOf(e.kind), line: clean(e.line).replace(/\n+/g, ' '), text: clean(e.text), rides: ridesOf(e.rides) };
}

/* the entry a name means: by its name first, then by one it goes by — {entry, ambiguous} */
export function entryNamed(entries, name) {
  const k = nameKey(name);
  if (!k) return { entry: null, ambiguous: false };
  const byName = entries.filter((e) => nameKey(e.name) === k);
  if (byName.length === 1) return { entry: byName[0], ambiguous: false };
  if (byName.length > 1) return { entry: null, ambiguous: true };
  const byAka = entries.filter((e) => (e.aka || []).some((a) => nameKey(a) === k));
  if (byAka.length === 1) return { entry: byAka[0], ambiguous: false };
  return { entry: null, ambiguous: byAka.length > 1 };
}

/* another entry already called this, or going by it (renaming or adding one never makes two that answer to one name) */
export function nameTaken(entries, name, butId = '') {
  const k = nameKey(name);
  return Boolean(k) && entries.some((e) => e.id !== butId && (nameKey(e.name) === k || (e.aka || []).some((a) => nameKey(a) === k)));
}

/* ------------------------------------------------------------ finding names */

const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* (an underscore is no letter: _Rukia_ is Rukia in italics) */
const EDGE_BEFORE = '(?<![\\p{L}\\p{N}])(?<![\\p{L}\\p{N}]-)';
const EDGE_AFTER = '(?![\\p{L}\\p{N}])(?!-[\\p{L}\\p{N}])';
/* a name is written with capitals when any letter of it is one */
const cased = (s) => /\p{Lu}/u.test(s);
/* a form as it is looked up again: the words as written for a cased name, folded for one in small letters */
export const formKey = (s) => (cased(s) ? String(s).normalize('NFC') : String(s).normalize('NFC').toLowerCase());

/* a person is found by a name of theirs alone too — "Rukia" for Rukia
 * Kuchiki — never by a title or a joining word, and only by one of three
 * letters or more written with a capital */
const PART_STOP = new Set(['the', 'of', 'and', 'von', 'van', 'der', 'den', 'de', 'du', 'la', 'le', 'el', 'al', 'bin', 'ibn', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'dame', 'lady', 'lord', 'captain', 'lieutenant', 'commander', 'general', 'colonel', 'major', 'sergeant', 'officer', 'detective', 'agent', 'king', 'queen', 'prince', 'princess', 'emperor', 'empress', 'duke', 'duchess', 'count', 'countess', 'baron', 'master', 'mistress', 'professor', 'doctor', 'saint', 'father', 'mother', 'sister', 'brother', 'aunt', 'uncle', 'old', 'young', 'little', 'big', 'great', 'head', 'chief', 'elder']);
export function nameParts(name) {
  const words = cleanName(name).split(/\s+/);
  if (words.length < 2) return [];
  return words.map((w) => w.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '')).filter((w) => w.length >= 3 && cased(w[0]) && !PART_STOP.has(w.toLowerCase()));
}

/* a name as it is looked for: without the article it starts with when a name follows it ("The Iron Covenant" is
 * found as "Iron Covenant", "the Iron Covenant" too) — a description in small letters keeps it ("the girl") */
/* (no i flag: with it \p{Lu} takes small letters too, and "the old road" would lose its article) */
const bareName = (n) => cleanName(n).replace(/^(?:[Tt][Hh][Ee]|[Aa][Nn]?)\s+(?=\p{Lu})/u, '');

/* Every name a set of entries and cards answers to, each once: [{form, refs}] —
 * refs are 'e:<id>' (an entry) and 'c:<kind>:<id>' (a card of the notes).
 * A card is found only by a name written with a capital — never by a
 * description ("the girl", "the letter"). */
export function nameForms(entries, cards = {}) {
  const map = new Map();
  const add = (form, ref) => {
    const f = cleanName(form).normalize('NFC');
    /* a name of one letter, or one that is only a number, is never looked for */
    if (f.length < 2 || !/\p{L}/u.test(f)) return;
    const key = formKey(f);
    const row = map.get(key) || { form: f, refs: [] };
    if (!row.refs.includes(ref)) row.refs.push(ref);
    map.set(key, row);
  };
  for (const e of entries || []) {
    if (!e || !cleanName(e.name)) continue;
    const names = [e.name, ...(e.aka || [])].map(bareName);
    for (const n of names) add(n, `e:${e.id}`);
    if (kindOf(e.kind) === 'people') for (const n of names) for (const w of nameParts(n)) add(w, `e:${e.id}`);
  }
  for (const [kind, list] of Object.entries(cards || {})) {
    for (const c of list || []) {
      if (!c || !cleanName(c.name)) continue;
      const names = [c.name, ...(c.aka || [])].map((n) => cleanName(n).replace(/^(?:the|a|an)\s+/i, '')).filter(cased);
      for (const n of names) add(n, `c:${kind}:${c.id}`);
      if (kind === 'people') for (const n of names) for (const w of nameParts(n)) add(w, `c:${kind}:${c.id}`);
    }
  }
  return [...map.values()];
}

/* A finder for a set of forms: find(text) -> [{start, end, key}] in order,
 * never overlapping — the longest name wins where two start together. */
export function makeFinder(forms) {
  const list = (forms || []).filter((f) => f && f.form);
  const sig = list.map((f) => `${formKey(f.form)}=${f.refs.join(',')}`).sort().join('|');
  const big = list.filter((f) => cased(f.form));
  const small = list.filter((f) => !cased(f.form));
  const alt = (arr, up) => [...new Set(arr.flatMap((f) => (up && f.form.toUpperCase() !== f.form ? [f.form, f.form.toUpperCase()] : [f.form])))]
    .sort((a, b) => b.length - a.length).map(esc).join('|');
  const reBig = big.length ? new RegExp(`${EDGE_BEFORE}(?:${alt(big, true)})${EDGE_AFTER}`, 'gu') : null;
  const reSmall = small.length ? new RegExp(`${EDGE_BEFORE}(?:${alt(small, false)})${EDGE_AFTER}`, 'giu') : null;
  const keyOf = new Map(list.map((f) => [formKey(f.form), f]));
  /* a match in all capitals finds its cased form */
  const upper = new Map(big.map((f) => [f.form.toUpperCase(), formKey(f.form)]));
  const find = (text) => {
    const t = String(text || '');
    if (!t || (!reBig && !reSmall)) return [];
    const hits = [];
    for (const re of [reBig, reSmall]) {
      if (!re) continue;
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) {
        const raw = m[0].normalize('NFC');
        let key = re === reBig ? (keyOf.has(raw) ? raw : upper.get(raw)) : raw.toLowerCase();
        if (!key || !keyOf.has(key)) key = formKey(raw);
        if (!keyOf.has(key)) continue;
        hits.push({ start: m.index, end: m.index + m[0].length, key });
      }
    }
    hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const out = [];
    let at = -1;
    for (const x of hits) { if (x.start < at) continue; out.push(x); at = x.end; }
    return out;
  };
  const refsOf = (key) => (keyOf.get(key) || { refs: [] }).refs;
  /* the names marked in some words, as a print — the page draws a passage again only when its own marks change, never
   * because a name came that it does not hold (his report, 2.12.2: the app lags) — kept per words while this finder lasts */
  const seen = new Map();
  const marksOf = (text) => {
    const t = String(text || '');
    if (!t) return '';
    const was = seen.get(t);
    if (was !== undefined) return was;
    const got = find(t).map((x) => `${x.start}:${x.end}:${x.key}`).join(',');
    if (seen.size > 3000) seen.clear();
    seen.set(t, got);
    return got;
  };
  return { sig, find, refsOf, marksOf, size: list.length };
}

/* THE ENTRIES SOME WORDS NAME, found as the page finds them (nameForms → makeFinder: a name with capitals only as it
 * is written, or shouted; a person by a name of theirs alone — never a title or a joining word; one in small letters
 * however written). 2.12.40, the audit: through 2.12.39 the notes' reading, the notes' check and Quick add took any
 * word of three letters of a name, in small letters, anywhere — "she will go to the market at night" named Will
 * Turner and the Night Market. The finder is kept for the same entries' names. */
const namedFinders = new Map();
export function entriesNamed(entries, text) {
  const list = (entries || []).filter((e) => e && cleanName(e.name));
  const t = String(text || '');
  if (!list.length || !t.trim()) return [];
  const key = JSON.stringify(list.map((e) => [e.id, e.name, e.aka || [], e.kind]));
  let finder = namedFinders.get(key);
  if (!finder) {
    finder = makeFinder(nameForms(list));
    if (namedFinders.size > 16) namedFinders.clear();
    namedFinders.set(key, finder);
  }
  const ids = new Set();
  for (const hit of finder.find(t)) for (const ref of finder.refsOf(hit.key)) if (ref.startsWith('e:')) ids.add(ref.slice(2));
  return list.filter((e) => ids.has(e.id));
}

/* ------------------------------------------------------------ what rides */

/* the words an entry rides as */
export function entryWords(e) {
  const head = `${e.name}${(e.aka || []).length ? ` (also ${e.aka.join(', ')})` : ''}${e.line ? ` — ${e.line}` : ''}`;
  return e.text ? `${head}\n${e.text}` : head;
}

/* the share of the room the entries named here may take */
/* (2.12.28: a fifth of what is free beside his words, the talk and the answer, at most 48,000 tokens — was 12%, at
 * most 16,000 — so a whole bibliography goes with every page on any model that holds it, as Cozy Tavern's brief does) */
export const BIB_PART = 0.2;
export const BIB_MOST = 48000;
export function bibShare(free) {
  return Math.max(600, Math.min(BIB_MOST, Math.floor(Math.max(0, free) * BIB_PART)));
}

/* every entry by its name and line (the partner's view of the whole), fitted to `budget` tokens */
export function entryIndex(entries, budget = 4000, { byPage = false } = {}) {
  const rows = [];
  let cost = 0;
  let left = 0;
  for (const e of entries || []) {
    if (!cleanName(e.name)) continue;
    const row = `- ${e.name}${(e.aka || []).length ? ` (also ${e.aka.join(', ')})` : ''}${e.line ? ` — ${e.line}` : ''}${e.rides === 'never' ? ' [only for me — the writer never reads it]' : e.rides === 'always' && !byPage ? ' [the writer always reads it]' : ''}`;
    const c = estimateTokens(row) + 1;
    if (cost + c > budget) { left++; continue; }
    rows.push(row);
    cost += c;
  }
  return { text: rows.join('\n'), left };
}

/* --------------------------------------------- SillyTavern's lorebooks */

/* A lorebook brought in (SillyTavern's World Info file, or the character
 * book inside a character card): each entry's first key — or its title —
 * its name, the other keys the names it goes by (a key written as a pattern
 * is no name), its words, and whether it rides always (constant), never
 * (switched off) or when named. [] when it holds none. */
export function entriesFromLorebook(json) {
  let data = json;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { return []; } }
  if (!data || typeof data !== 'object') return [];
  const book = data.entries ? data : data.data && data.data.character_book ? data.data.character_book : data.character_book ? data.character_book : null;
  if (!book || !book.entries) return [];
  const rows = Array.isArray(book.entries) ? book.entries : Object.values(book.entries);
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const keys = (Array.isArray(r.key) ? r.key : Array.isArray(r.keys) ? r.keys : typeof r.key === 'string' ? r.key.split(',') : [])
      .map((k) => String(k || '').trim()).filter((k) => k && !/^\/.*\/[a-z]*$/i.test(k));
    const title = cleanName(r.comment || r.name || '');
    const name = cleanName(keys[0] || title);
    const text = clean(r.content);
    if (!name || !text) continue;
    const off = r.disable === true || r.enabled === false;
    const always = r.constant === true;
    /* one this app took out: its kind and its line come back as they went (SillyTavern keeps fields it does not know) */
    const kind = kindSaid(r.cozyKind) || 'lore';
    const line = typeof r.cozyLine === 'string' ? clean(r.cozyLine).replace(/\n+/g, ' ') : '';
    const body = line && text.startsWith(line) ? clean(text.slice(line.length)) : text;
    out.push(tidyEntry(newEntry({ name, aka: [title, ...keys.slice(1)].filter((k) => k && nameKey(k) !== nameKey(name)), kind, line: line && body !== text ? line : '', text: line && body !== text ? body : text, rides: off ? 'never' : always ? 'always' : 'named' })));
  }
  return out;
}

/* The entries as a SillyTavern World Info file: its name and other names
 * the keys, its line and words the content. */
export function lorebookOf(entries, title = 'Bibliography') {
  const out = { name: title, entries: {} };
  (entries || []).forEach((e, uid) => {
    out.entries[uid] = {
      uid,
      key: [e.name, ...(e.aka || [])],
      keysecondary: [],
      comment: e.name,
      content: [e.line, e.text].filter((x) => String(x || '').trim()).join('\n'),
      cozyKind: e.kind,
      cozyLine: e.line || '',
      constant: e.rides === 'always',
      selective: false,
      disable: e.rides === 'never',
      order: 100,
      position: 0,
      addMemo: true,
      excludeRecursion: false,
      probability: 100,
      useProbability: false,
      depth: 4,
      group: '',
      displayIndex: uid,
    };
  });
  return out;
}

/* ============================================ WHAT THE BOOK ESTABLISHES

 * The helper fills the bibliography by itself as it reads each passage (the
 * reading it makes for the notes — no ask of its own): the lasting facts the
 * passage establishes about a name — who or what it is, how they look, where
 * they come from, what they can do and how it works, a rank, what a word or a
 * group is — each in a sentence, with the passage's own words that say it.
 * Kept on the version of the passage that says it (`version.codex`, as the
 * Timeline keeps its evidence), so a passage written again, taken out or
 * another version picked takes its facts with it, and the arrows bring them
 * back: the bibliography heals itself. A fact whose words are not in its
 * passage, or about a name the passage never gives, is never kept. */

export const CODEX_SCHEMA = 1;
export const FACTS_PER_SOURCE = 12;
/* WORDS COMPARED AS A READER SEES THEM: spacing, curly quotes and the shape of a dash aside — one rule for the
 * bibliography's facts and the Timeline's turns (2.12.40, the audit: the Timeline held a quote to the page letter for
 * letter, so a turn quoted with straight marks, or "..." for "…", was lost where a fact quoted alike was kept, and a
 * run of spaces mended to one took every turn standing on it). `at`: where each of its letters stands on the page, so
 * a quote read loosely is kept as the page has it (quoteSpan). A long text's is kept while its words are the same. */
const SINGLE = new Set(['‘', '’', 'ʼ', '′']);
const DOUBLE = new Set(['“', '”', '„', '″']);
const SPACE = /\s/;
const looseKept = new Map();
let looseHeld = 0;
function looseOf(t) {
  const s = String(t == null ? '' : t);
  const long = s.length > 200;
  const had = long ? looseKept.get(s) : null;
  if (had) return had;
  const out = [];
  const at = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (SPACE.test(c)) { if (out[out.length - 1] !== ' ') { out.push(' '); at.push(i); } continue; }
    if (c === '…') { out.push('.', '.', '.'); at.push(i, i, i); continue; }
    out.push(SINGLE.has(c) ? "'" : DOUBLE.has(c) ? '"' : (c >= '‐' && c <= '―') || c === '−' ? '-' : c);
    at.push(i);
  }
  if (out[0] === ' ') { out.shift(); at.shift(); }
  if (out[out.length - 1] === ' ') { out.pop(); at.pop(); }
  const r = { s: out.join(''), at };
  if (long) {
    looseKept.set(s, r);
    looseHeld += s.length;
    for (const k of looseKept.keys()) { if (looseHeld <= 2e6 && looseKept.size <= 64) break; looseKept.delete(k); looseHeld -= k.length; }
  }
  return r;
}
const loose = (t) => looseOf(t).s;
/* where a quote stands on the page, read loosely ({start, end}), or null — its own words where they stand exactly */
/* (its own words looked for first, and only when they are not there read loosely: 2.12.40, the review — the Timeline,
 * redrawn with every save while it is open, read every quote of the book loosely first and took five times as long.
 * Four characters with no run of spaces read loosely as four at least, so the answer is the same) */
export function quoteAt(hay, quote) {
  const h = String(hay == null ? '' : hay);
  const raw = String(quote == null ? '' : quote).trim();
  const plain = raw.length >= 4 && !/\s\s/.test(raw);
  let at = plain ? h.indexOf(raw) : -1;
  if (at >= 0) return { start: at, end: at + raw.length };
  const q = loose(quote);
  if (q.length < 4) return null;
  if (!plain) { at = h.indexOf(raw); if (at >= 0) return { start: at, end: at + raw.length }; }
  const L = looseOf(h);
  const k = L.s.indexOf(q);
  return k < 0 ? null : { start: L.at[k], end: L.at[k + q.length - 1] + 1 };
}
export function quoteIn(hay, quote) { return quoteAt(hay, quote) !== null; }
/* the words a quote stands for, as the page has them ('' when they are not there) */
export function quoteSpan(hay, quote) { const at = quoteAt(hay, quote); return at ? String(hay).slice(at.start, at.end) : ''; }

/* the facts one source gives, held to its words: {schema, fp, facts, complete} */
export function codexOf(rows, { text = '', whole = text } = {}) {
  const out = { schema: CODEX_SCHEMA, fp: hashText(whole), facts: [], complete: Array.isArray(rows) };
  if (!Array.isArray(rows)) return out;
  const folded = foldedText(whole);
  for (const r of rows.slice(0, FACTS_PER_SOURCE * 2)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) { out.complete = false; continue; }
    const name = cleanName(r.name).replace(/^(?:the|a|an)\s+(?=\p{Lu})/u, '');
    const fact = typeof r.fact === 'string' ? r.fact.replace(/\s+/g, ' ').trim() : '';
    const ev = typeof r.evidence === 'string' ? [r.evidence] : Array.isArray(r.evidence) ? r.evidence : [];
    const quotes = [...new Set(ev.map((q) => String(q == null ? '' : q).trim()).filter(Boolean))];
    const valid = name && fact && fact.length <= 400 && quotes.length && quotes.every((q) => q.length <= 600 && quoteIn(text, q) && quoteIn(whole, q)) && nameInText(folded, name);
    if (!valid) { out.complete = false; continue; }
    if (out.facts.length >= FACTS_PER_SOURCE) continue;
    const id = 'cx-' + hashText(JSON.stringify([nameKey(name), fact, quotes]));
    if (!out.facts.some((f) => f.id === id)) out.facts.push({ id, name, kind: kindSaid(r.kind) || 'lore', fact, evidence: quotes });
  }
  return out;
}

/* the parts of one passage read in parts, gathered */
export function mergeCodex(before, next) {
  if (!before || before.fp !== next.fp) return next;
  const facts = [...before.facts];
  for (const f of next.facts) if (!facts.some((x) => x.id === f.id) && facts.length < FACTS_PER_SOURCE * 3) facts.push(f);
  return { ...next, complete: before.complete && next.complete, facts };
}

/* A version's facts carried to words made from its own — a name changed
 * everywhere (`swap` changes the facts' words as the passage's were), a mend
 * that only took off what was never the story: kept whole only when every
 * fact's words still stand in the new words and its name with them; else
 * none, and the passage is read for them again (bibDue) — never a fact kept
 * whose words are gone. */
export function carriedCodex(codex, text, swap = (x) => x) {
  if (!codex || codex.schema !== CODEX_SCHEMA || !Array.isArray(codex.facts)) return null;
  const folded = foldedText(text);
  const facts = [];
  for (const f of codex.facts) {
    if (!f || typeof f.fact !== 'string' || typeof f.name !== 'string') return null;
    const name = swap(f.name);
    const fact = swap(f.fact);
    const evidence = (Array.isArray(f.evidence) ? f.evidence : []).map((q) => swap(String(q)));
    if (!evidence.length || !evidence.every((q) => quoteIn(text, q)) || !nameInText(folded, name)) return null;
    facts.push({ ...f, id: 'cx-' + hashText(JSON.stringify([nameKey(name), fact, evidence])), name, fact, evidence });
  }
  /* (one being read in parts, archivist.js bibBackfill: how far was of the words before — the new words read in parts again from their start, what was found kept) */
  const { upTo, gap: _g, ...rest } = codex;
  return { ...rest, ...(Number.isInteger(upTo) ? { upTo: 0 } : {}), fp: hashText(text), facts };
}

/* What a reading of a changed passage gives, with what the version before it
 * established that its new words still say (each fact whose words and name
 * still stand in them) — an answer that tells only what the change adds never
 * takes the rest away. */
export function withCarriedFacts(codex, before, text) {
  if (!codex || !before || !Array.isArray(before.facts)) return codex;
  const folded = foldedText(text);
  const facts = [...codex.facts];
  for (const f of before.facts) {
    if (!f || typeof f.fact !== 'string' || typeof f.name !== 'string' || facts.length >= FACTS_PER_SOURCE * 3) continue;
    if (facts.some((x) => x.id === f.id || (x.fact === f.fact && nameKey(x.name) === nameKey(f.name)))) continue;
    const evidence = Array.isArray(f.evidence) ? f.evidence : [];
    if (evidence.length && evidence.every((q) => quoteIn(text, q)) && nameInText(folded, f.name)) facts.push(f);
  }
  return { ...codex, facts };
}

/* a source as an answer may say it — "Chapter Three, passage 4", "Chapter 3,
 * Passage 4.", "chapter three passage 4", "Passage 4" — as one key */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function countOf(t) {
  const s = String(t || '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let n = 0;
  for (const w of s.replace(/-/g, ' ').split(/\s+/).filter((x) => x && x !== 'and')) {
    const a = ONES.indexOf(w);
    const b = TENS.indexOf(w);
    if (a > 0) n += a;
    else if (b > 1) n += b * 10;
    else if (w === 'hundred' && n > 0) n *= 100;
    else return 0;
  }
  return n;
}
export function sourceKey(s) {
  const t = String(s || '').toLowerCase().replace(/[“”"']/g, '').replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();
  const m = /^chapter (.+?)[,:;]? passage (\d+)$/.exec(t);
  if (m && countOf(m[1])) return `c${countOf(m[1])}p${parseInt(m[2], 10)}`;
  const p = /^passage (\d+)$/.exec(t);
  if (p) return `p${parseInt(p[1], 10)}`;
  return t;
}

/* a version's facts, as they stand for its words now (null when it has none
 * for them) — its words' print kept beside the words it was made of, so a
 * long book is not printed again for every request */
const prints = new WeakMap();
const printOf = (v) => {
  const t = String(v.text || '');
  const kept = prints.get(v);
  if (kept && kept.text === t) return kept.fp;
  const fp = hashText(t);
  prints.set(v, { text: t, fp });
  return fp;
};
export function codexNow(v) {
  const c = v && v.codex;
  return c && c.schema === CODEX_SCHEMA && Array.isArray(c.facts) && c.fp === printOf(v) ? c : null;
}

/* A store step, replayable by identity over a newer save: laid on the
 * version read while it reads as it did — on show or not, as the Timeline's
 * turns are (timeline.js continuityStep: 2.12.40, the review — a reading
 * that landed after he flipped to another take wrote nothing, and its words
 * were marked read with none of their facts) */
export function codexStep(passageId, versionId, codex) {
  return (chapter) => {
    const p = (chapter.passages || []).find((x) => x.id === passageId);
    const v = p && (p.versions || []).find((x) => x.id === versionId);
    if (!v || v.streaming) return false;
    if (hashText(v.text || '') !== codex.fp) {
      /* its words changed on the page itself while they were read (a fix put in meanwhile): the facts of the words read
       * kept with them, on the newest words before — the change is read against them next, and they stay (2.12.40) */
      const b = Array.isArray(v.before) ? v.before[v.before.length - 1] : null;
      if (b && typeof b.text === 'string' && hashText(b.text) === codex.fp) {
        const had = codexNow({ text: b.text, codex: b.codex });
        b.codex = JSON.parse(JSON.stringify(!codex.complete && had ? mergeCodex(had, codex) : codex));
      }
      return false;
    }
    const next = !codex.complete && codexNow(v) ? mergeCodex(v.codex, codex) : codex;
    v.codex = JSON.parse(JSON.stringify(next));
    return true;
  };
}

/* ------------------------------------------- the bibliography, whole */

const bareKey = (name) => nameKey(String(name || '').replace(/^(?:the|a|an)\s+/i, ''));
const CARD_KIND = { people: 'people', places: 'places', lore: 'things' };

/* Every name of the bibliography, as one list: his entries, and the names
 * the book establishes facts about — each with its facts in book order.
 * [{ref, name, aka, kind, rides, line, text, entry, card, facts, first}]:
 * ref 'e:<id>' for his entry (the book's facts about that name with it),
 * 'c:<kind>:<id>' for a name the notes hold a card for, 'n:<name>' for one
 * they don't. Never a model call. */
/* Where a name the book tells of is kept — his entry, a card of the notes,
 * or the name alone — depends only on the names the entries and the cards
 * go by: worked out once for them and kept while they stand (every card was
 * held against every name each time the bibliography was gathered — 1,500
 * names and 400 cards took a second, and it is gathered for every page). */
const PLACES = new Map();   /* names print -> Map(bare name -> {entryId} | {kind, id} | null) */
function placesFor(entries, notes) {
  const rows = [];
  for (const e of entries) rows.push(`e${e.id}\u0001${e.name}\u0001${(e.aka || []).join('\u0002')}`);
  for (const kind of ['people', 'places', 'lore']) for (const c of notes[kind] || []) rows.push(`${kind}${c.id}\u0001${c.name}\u0001${(c.aka || []).join('\u0002')}`);
  const print = hashText(rows.join('\u0003'));
  let map = PLACES.get(print);
  if (!map) {
    if (PLACES.size >= 4) PLACES.clear();
    map = new Map();
    PLACES.set(print, map);
  }
  return map;
}

/* A fact that says what an earlier one about the same name already says —
 * the same words in the same order, but for how the name is written, an
 * article, "is" or "was", and punctuation ("Rukia Kuchiki carries Sode no
 * Shirayuki." after "Rukia carries Sode no Shirayuki"): said once, the
 * earlier kept, with the later one's words beside it. Anything else is its
 * own fact — a "no" or a "can't", the order of who did what to whom ("Aizen
 * stabbed Ichigo" is not "Ichigo stabbed Aizen"), a pronoun, a number. */
const FACT_SKIP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were']);
const factSeq = (t, own) => String(t || '').toLowerCase().replace(/[’ʼ]/g, "'").split(/[^\p{L}\p{N}']+/u)
  .map((w) => w.replace(/^'+|'+$/g, '')).map((w) => (own.has(w.replace(/'s$/, '')) ? '' : w)).filter((w) => w && !FACT_SKIP.has(w)).join(' ');
function repeatOf(kept, seq) {
  if (!seq) return null;
  return kept.find((k) => k.seq === seq) || null;
}

const BY_NAME = new Intl.Collator(undefined, { sensitivity: 'base' });
export function bibItems(novel, chapters = {}, { facts = true } = {}) {
  const entries = entriesOf(novel);
  const notes = (novel && novel.notes) || {};
  const items = new Map();
  for (const e of entries) {
    items.set(`e:${e.id}`, { ref: `e:${e.id}`, name: e.name, aka: e.aka || [], kind: kindOf(e.kind), rides: ridesOf(e.rides), line: e.line || '', text: e.text || '', entry: e, card: null, facts: [], kinds: {} });
  }
  /* where the book says it: his entry first, then a card of the notes, then the name itself */
  const placed = facts ? placesFor(entries, notes) : null;
  const placeOf = new Map();
  /* kept by the name as the book wrote it (never by the name without its article: "The Order" and "Order" are each placed as themselves) */
  const placeFor = (name) => {
    const k = nameKey(name);
    if (placed.has(k)) return placed.get(k);
    let at = null;
    const bare = cleanName(name).replace(/^(?:the|a|an)\s+/i, '');
    const m = entryNamed(entries, name);
    const mb = !m.entry && !m.ambiguous && bare !== cleanName(name) ? entryNamed(entries, bare) : { entry: null };
    if (m.entry || mb.entry) at = { entryId: (m.entry || mb.entry).id };
    if (!at) {
      for (const kind of ['people', 'places', 'lore']) {
        const c = matchCard(notes[kind] || [], name, [], { kind, near: true, slip: false });
        if (c.card) { at = { kind, id: c.card.id }; break; }
        if (c.ambiguous) break;
      }
    }
    placed.set(k, at);
    return at;
  };
  const itemFor = (fact) => {
    const k = bareKey(fact.name);
    if (placeOf.has(k)) return placeOf.get(k);
    const at = placeFor(fact.name);
    let ref = '';
    if (at && at.entryId && items.has(`e:${at.entryId}`)) ref = `e:${at.entryId}`;
    else if (at && at.kind) {
      const card = (notes[at.kind] || []).find((c) => c.id === at.id);
      if (card) {
        ref = `c:${at.kind}:${card.id}`;
        if (!items.has(ref)) items.set(ref, { ref, name: card.name, aka: card.aka || [], kind: CARD_KIND[at.kind], rides: 'named', line: '', text: '', entry: null, card: { kind: at.kind, id: card.id, about: card.about || '' }, facts: [], kinds: {} });
      }
    }
    if (!ref) {
      ref = `n:${k}`;
      if (!items.has(ref)) items.set(ref, { ref, name: cleanName(fact.name), aka: [], kind: fact.kind, rides: 'named', line: '', text: '', entry: null, card: null, facts: [], kinds: {} });
    }
    placeOf.set(k, ref);
    return ref;
  };
  if (facts) {
    const order = (novel && novel.order) || [];
    const said = new Map();   /* ref -> [{words, fact}] */
    order.forEach((cid, ci) => {
      const ch = chapters[cid];
      if (!ch) return;
      let n = 0;
      for (const p of ch.passages || []) {
        if (p.by === 'break') continue;
        n++;
        const v = picked(p);
        const c = codexNow(v);
        if (!c) continue;
        /* laid only as codexOf held them to these very words (codexStep): read as they are */
        for (const f of c.facts) {
          if (!f || typeof f.fact !== 'string' || !f.fact.trim() || typeof f.name !== 'string') continue;
          const ref = itemFor(f);
          const item = items.get(ref);
          item.kinds[f.kind] = (item.kinds[f.kind] || 0) + 1;
          if (!said.has(ref)) said.set(ref, []);
          const kept = said.get(ref);
          const own = new Set([item.name, ...(item.aka || []), f.name].flatMap((x) => String(x || '').toLowerCase().replace(/[’ʼ]/g, "'").split(/[^\p{L}\p{N}']+/u).map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))).filter(Boolean));
          const seq = factSeq(f.fact, own);
          const same = item.facts.find((x) => x.fact === f.fact);
          const again = same ? { fact: same } : repeatOf(kept, seq);
          if (again) { again.fact.more = [...(again.fact.more || []), ...(f.evidence || [])]; continue; }
          /* name: as the book names it here — what rides of an entry he keeps for himself (ridingItems) */
          const row = { id: `${p.id}:${v.id}:${f.id}`, name: f.name, fact: f.fact, evidence: f.evidence, chapterId: cid, passageId: p.id, versionId: v.id, chapterNumber: ci + 1, passageNumber: n, label: `${chapterLabel(novel, ch)}, passage ${n}` };
          item.facts.push(row);
          kept.push({ seq, fact: row });
        }
      }
    });
  }
  /* HIS ENTRY AND THE NOTES' CARD FOR ONE NAME ARE ONE (2.12.37 — his report: the notes, the Timeline and the
   * bibliography "must be connected"): a tap on the name showed his entry and the card as two who go by that name.
   * The card his entry stands for (cardForEntry, kept while the names stand: entryJoins). 2.12.40, the audit: the join
   * went one way only — what the book told under another form of the name stayed on the card's own row, so the list
   * showed the name twice (his entry on one row, the book's facts on the other), and a tap on the card's name opened the
   * card without his entry. The card's row is folded into his entry's: its facts with his, in the book's order, and its
   * names to find it by (cardNames, itemForms). What the writer reads of it is his entry's own words, and the facts. */
  const joins = entryJoins(entries, notes);
  const cardsById = new Map(['people', 'places', 'lore'].flatMap((k) => (notes[k] || []).filter(Boolean).map((c) => [`${k}:${c.id}`, c])));
  for (const e of entries) {
    const j = joins.get(e.id);
    const card = j ? cardsById.get(`${j.kind}:${j.id}`) || null : null;
    const it = items.get(`e:${e.id}`);
    if (!card || !it) continue;
    it.card = { kind: j.kind, id: card.id, about: card.about || '' };
    it.cardNames = [card.name, ...(card.aka || [])].filter(Boolean);
    const theirs = items.get(`c:${j.kind}:${card.id}`);
    if (!theirs || theirs.entry) continue;
    for (const f of theirs.facts) {
      const same = it.facts.find((x) => x.fact === f.fact);
      if (same) same.more = [...(same.more || []), ...(f.evidence || []), ...(f.more || [])];
      else it.facts.push(f);
    }
    it.facts.sort((a, b) => a.chapterNumber - b.chapterNumber || a.passageNumber - b.passageNumber);
    items.delete(theirs.ref);
  }
  const out = [];
  for (const it of items.values()) {
    if (!it.entry && !it.facts.length) continue;
    /* a name the book alone tells of takes the kind it is most often said to be (a card of things worth remembering may be a group or lore) */
    if (!it.entry && (!it.card || it.card.kind === 'lore')) {
      const top = Object.entries(it.kinds).sort((a, b) => b[1] - a[1])[0];
      if (top && ENTRY_KINDS.includes(top[0])) it.kind = top[0];
    }
    it.first = it.facts[0] || null;
    if (!it.line) it.line = !it.entry && it.card && it.card.about ? firstSentence(it.card.about) : it.facts[0] ? it.facts[0].fact : '';
    out.push(it);
  }
  /* (by name, one collator for the whole list: a comparison made with its own words for each pair took 65 ms of every
   * gathering of 1,500 names — 2.12.40, the audit) */
  return out.sort((a, b) => BY_NAME.compare(a.name, b.name));
}

/* the notes' card an entry of his stands for: {kind, id, about} — the card's kind for the entry's kind first (a group or
 * a thing is kept among the lore). 2.12.40, the audit — joins that were wrong: a clan "Kuchiki" took Rukia Kuchiki's
 * card, "Wells" Tom Wells's, "Gotei 13" a card "Gotei"; "Mei Lin" (also Mei) took Mei Ling's card (also Mei), and with a
 * card "Mei Lin" as well, neither. Now: name to name first, every kind; then a name either goes by, only where one card
 * answers and never two people (a title that disagrees, or two whole names that are not one person's — Mei Lin and Mei
 * Ling); then a fuller or shorter form as the notes match one ("Emilia" is Emilia Vermaine, "Bruce's Batwing" the
 * Batwing) — a person's card so only for a person's entry. */
const CARD_KINDS_FOR = { people: ['people', 'lore'], places: ['places', 'lore'], things: ['lore', 'places'], groups: ['lore', 'people'], lore: ['lore', 'places', 'people'] };
const nameWords = (n) => cleanName(n).split(' ').filter((w) => /\p{L}/u.test(w)).length;
export function cardForEntry(e, notes) {
  const person = kindOf(e.kind) === 'people';
  const kinds = CARD_KINDS_FOR[kindOf(e.kind)] || ['lore'];
  const own = nameKey(e.name);
  const keys = new Set([e.name, ...(e.aka || [])].map(nameKey).filter(Boolean));
  const at = (kind, c) => ({ kind, id: c.id, about: c.about || '' });
  const twoPeople = (kind, c) => kind === 'people' && (titlesConflict(e.name, c.name) || (nameWords(e.name) >= 2 && nameWords(c.name) >= 2 && !samePersonName(e.name, c.name)));
  for (const kind of kinds) {
    const byName = ((notes && notes[kind]) || []).filter((c) => c && nameKey(c.name) === own);
    if (byName.length === 1) return at(kind, byName[0]);
    if (byName.length > 1) return null;
  }
  for (const kind of kinds) {
    const cards = ((notes && notes[kind]) || []).filter(Boolean);
    const named = cards.filter((c) => [c.name, ...(c.aka || [])].some((x) => keys.has(nameKey(x))));
    if (named.length > 1) return null;
    if (named.length === 1) { if (twoPeople(kind, named[0])) return null; return at(kind, named[0]); }
    if (kind === 'people' && !person) continue;
    const m = matchCard(cards, e.name, e.aka || [], { kind, near: true, slip: false });
    if (m.card && !twoPeople(kind, m.card)) return at(kind, m.card);
    if (m.ambiguous) return null;
  }
  return null;
}
/* EVERY ENTRY'S CARD, KEPT WHILE THE NAMES ARE THE SAME (2.12.40, the audit: the join was worked out again for every
 * entry each time the bibliography was gathered — for every page, every check, every reading: 1,500 entries and 400
 * cards took 0.6 s each time). Entry id → {kind, id} or null, kept by the names and kinds of the entries and the cards. */
const JOINS = new Map();   /* names print -> Map(entry id -> {kind, id} | null) */
export function entryJoins(entries, notes) {
  const rows = [];
  for (const e of entries || []) if (e) rows.push(`e${e.id}\u0001${e.name}\u0001${(e.aka || []).join('\u0002')}\u0001${kindOf(e.kind)}`);
  for (const kind of ['people', 'places', 'lore']) for (const c of (notes && notes[kind]) || []) if (c) rows.push(`${kind}${c.id}\u0001${c.name}\u0001${(c.aka || []).join('\u0002')}`);
  const print = hashText(rows.join('\u0003'));
  let map = JOINS.get(print);
  if (!map) {
    if (JOINS.size >= 8) JOINS.clear();
    map = new Map();
    JOINS.set(print, map);
  }
  for (const e of entries || []) {
    if (!e || map.has(e.id)) continue;
    const c = cardForEntry(e, notes || {});
    map.set(e.id, c ? { kind: c.kind, id: c.id } : null);
  }
  return map;
}

/* WHAT A NAME'S SHEET SHOWS (ui/bibliography.js showRefs — a name tapped in the page, a row of the list, a card's In the
 * bibliography): one row for each who goes by it, {it, card, cardKind} — his entry with the notes' card it stands for,
 * a card's name opening his entry with it (bibItems folds the card's row into his entry's); each once (2.12.40, the
 * audit: a card with the book's facts and no entry of his opened as "2 who go by that name", itself twice). */
export function nameRows(novel, chapters, refs) {
  const items = bibItems(novel, chapters, { facts: true });
  const byRef = new Map(items.map((it) => [it.ref, it]));
  const rows = [];
  const cardOf = (kind, id) => (((novel && novel.notes) || {})[kind] || []).find((c) => c && c.id === id) || null;
  for (const ref of refs || []) {
    const m = /^c:(people|places|lore):(.+)$/.exec(ref);
    const it = byRef.get(ref) || (m ? items.find((x) => x.entry && x.card && x.card.id === m[2]) || null : null);
    /* his entry with the notes' card it stands for: one, never two who go by the name (2.12.37) */
    const joined = !m && it && it.entry && it.card ? cardOf(it.card.kind, it.card.id) : null;
    const card = m ? cardOf(m[1], m[2]) : joined;
    if (!it && !card) continue;
    if (rows.some((r) => (it && r.it && r.it.ref === it.ref) || (!it && !r.it && card && r.card && r.card.id === card.id))) continue;
    rows.push({ it, card, cardKind: m ? m[1] : (it && it.card ? it.card.kind : '') });
  }
  /* a card shown with his entry is not shown again on its own — what the book told under the card's name goes with it */
  for (const r of rows.filter((x) => x.it && x.it.entry && x.card)) {
    for (const other of rows.filter((x) => x !== r && x.card && x.card.id === r.card.id && !(x.it && x.it.entry))) {
      if (other.it && other.it.facts.length) r.it = { ...r.it, facts: [...r.it.facts, ...other.it.facts.filter((f) => !r.it.facts.some((g) => g.id === f.id))] };
      rows.splice(rows.indexOf(other), 1);
    }
  }
  return rows;
}
/* what the bibliography holds for a card of the notes (2.12.37): his entry it stands for, or what the book told under its
 * name — and the card itself, once */
export function cardRefs(novel, chapters, kind, cardId) {
  const refs = bibItems(novel, chapters, { facts: true }).filter((it) => it.card && it.card.id === cardId && (it.entry || it.facts.length)).map((it) => it.ref);
  return refs.length ? [...new Set([...refs, `c:${kind}:${cardId}`])] : [];
}

/* the names a list of items answers to, for the finder: [{form, refs}] */
export function itemForms(items) {
  const map = new Map();
  for (const it of items || []) {
    const names = [it.name, ...(it.aka || [])];
    /* (the names of the notes' card his entry stands for find it too — only as names, with a capital, as a card's
     * are found: bibItems, 2.12.40) */
    const theirs = (it.cardNames || []).filter(cased);
    const forms = [...names, ...(it.kind === 'people' ? names.flatMap(nameParts) : []), ...theirs, ...(it.kind === 'people' ? theirs.flatMap(nameParts) : [])];
    for (const n of forms) {
      /* a name with its article ("The Iron Covenant") is found by its name, written with the article in small letters
       * mid-sentence too ("bowed to the Iron Covenant") — as a card's is (nameForms); never a description in small
       * letters ("the girl") */
      const f = bareName(n).normalize('NFC');
      if (f.length < 2 || !/\p{L}/u.test(f)) continue;
      /* the book's own names are found only as names (with a capital); his entries also by a word in small letters */
      if (!it.entry && !cased(f)) continue;
      const key = formKey(f);
      const row = map.get(key) || { form: f, refs: [] };
      if (!row.refs.includes(it.ref)) row.refs.push(it.ref);
      map.set(key, row);
    }
  }
  return [...map.values()];
}

/* an item as it rides: its name and line, his words, and the book's facts —
 * only those from passages not riding word for word (`skip`), or the ones
 * given (`facts`) */
const headOf = (it, lineHis = '') => `${it.name}${(it.aka || []).length ? ` (also ${it.aka.join(', ')})` : ''}${lineHis ? ` — ${lineHis}` : ''}`;
const TOLD_HEAD = { people: 'What the book has told of them:', other: 'What the book has told of it:' };
const toldHead = (it) => TOLD_HEAD[it.kind === 'people' ? 'people' : 'other'];
const factLine = (f) => `- ${f.fact} (${chapterWord(f.label)})`;
const chapterWord = (label) => String(label || '').replace(/, passage \d+$/, '').replace(/:.*$/, '');
export function itemWords(it, { skip = null, facts = null } = {}) {
  const told = facts || (it.facts || []).filter((f) => !(skip && skip.has(f.passageId)));
  const his = it.entry ? (it.entry.text || '') : '';
  const lineHis = it.entry ? (it.entry.line || '') : '';
  if (!his && !lineHis && !told.length) return '';
  const rows = [headOf(it, lineHis)];
  if (his) rows.push(his);
  if (told.length) rows.push(`${toldHead(it)}\n${told.map(factLine).join('\n')}`);
  return rows.join('\n');
}

/* An entry he keeps for himself (never), for the writer, the narrator and
 * the checker: his words are never theirs, nor which names he puts together
 * under it — what the book itself says rides as if he had written no entry,
 * each fact under the name the book gives it there, found by that name. */
function asTheBookHasIt(it) {
  const byName = new Map();
  for (const f of it.facts || []) {
    const name = cleanName(f.name || it.name);
    const k = bareKey(name);
    if (!byName.has(k)) byName.set(k, { ref: `${it.ref}#${k}`, name, aka: [], kind: it.kind, rides: 'named', line: '', text: '', entry: null, card: null, facts: [], kinds: {} });
    byName.get(k).facts.push(f);
  }
  return [...byName.values()];
}

/* What rides of the bibliography, in order: the entries he set to ride
 * always; then the names his own words name; then those named in the words
 * right before the point, the nearest first — all of it fitted to `budget`
 * tokens. His own words first, each entry whole or not at all, in that
 * order, an entry that does not fit left for one that does; then the book's
 * facts, a fact for each name in turn, earliest first — a name the book
 * alone tells of taking room only with its first fact — so the one told of
 * most never pushes out the others, nor is left out for having told so
 * much. {items, words, cost, left} — left: those that found no room. */
/* what the writer, the narrator and the checker may read of the items — an entry he keeps for himself only as the book
 * has it — and the partner all of them */
function usableFor(items, purpose) {
  return purpose === 'partner' ? items || [] : (items || []).flatMap((it) => (it.rides === 'never' ? asTheBookHasIt(it) : [it]));
}
/* the items his words name, in their order, and those the words near the point name, the nearest first */
function namedOrder(usable, his, near) {
  const finder = makeFinder(itemForms(usable));
  const refsIn = (text, nearestFirst) => {
    const hits = finder.find(text);
    return (nearestFirst ? [...hits].reverse() : hits).flatMap((x) => finder.refsOf(x.key));
  };
  return { his: refsIn(his, false), near: refsIn(near, true) };
}

export function ridingItems(items, { his = '', near = '', picked = [], rest = false, byPage = false, budget = 4000, skip = null, purpose = 'write', factsMost = Infinity } = {}) {
  const forPartner = purpose === 'partner';
  const usable = usableFor(items, purpose);
  /* byPage (Super automatic, auto.js — his word, 2.12.28: "always or not always, put automatically"): no entry goes first
   * for being set to Always — each goes by what this page names or needs, then by the words it shares with the moment;
   * Never stays his */
  const always = forPartner || byPage ? [] : usable.filter((it) => it.rides === 'always');
  const order = [];
  const seen = new Set(always.map((it) => it.ref));
  const take = (refs) => { for (const r of refs) if (!seen.has(r)) { seen.add(r); order.push(r); } };
  const found = namedOrder(usable, his, near);
  take(found.his);
  /* what the page needs that no word here names (pickRows): after his words' names, before the ones near the point */
  take(forPartner ? [] : picked || []);
  take(found.near);
  /* THE REST OF THE BIBLIOGRAPHY, AS MUCH AS THERE IS ROOM FOR (his word, 2.12.28: "when I press Continue it needs as
   * much context as it can have — what if something only mentioned is important and isn't sent?"): after the ones
   * named or needed, every other entry of his — those sharing the most words with the moment first — then what the book
   * itself says of the names not named here, so the whole of it goes with every page while it fits, and only a
   * bibliography bigger than its share is cut to what matters here */
  const restFrom = order.length;
  if (rest && !forPartner) {
    const moment = topicWords(`${his}\n${near}`);
    const others = usable.map((it, i) => ({ it, i })).filter((x) => !seen.has(x.it.ref) && (x.it.entry || (x.it.facts || []).length)).map((x) => {
      const about = x.it.entry ? `${pickHead(x.it)}\n${String(x.it.entry.text || '').slice(0, 800)}` : `${x.it.name} ${(x.it.aka || []).join(' ')}\n${x.it.facts.slice(0, 12).map((f) => f.fact).join('\n')}`;
      let score = 0;
      for (const w of topicWords(about)) if (moment.has(w)) score++;
      return { ...x, score };
    }).sort((a, b) => (a.it.entry ? 0 : 1) - (b.it.entry ? 0 : 1) || b.score - a.score || a.i - b.i);
    take(others.map((x) => x.it.ref));
  }
  const byRef = new Map(usable.map((it) => [it.ref, it]));
  const asItems = (refs) => refs.map((r) => byRef.get(r)).filter(Boolean);
  /* each part costed as the very words that ride: its first line (with the other names), his words, the facts' heading, each fact */
  const cost = (t) => estimateTokens(t) + 1;
  const rows = [];
  let spent = 0;
  let left = 0;
  /* (factsMost: what the facts may add past his words, at most) */
  let factsSpent = 0;
  /* what this page names or needs first — his words, then the book's facts of them — and only then the rest, its
   * words, then its facts: the rest never takes the room of a fact about who is on the page */
  for (const tier of [[...always, ...asItems(order.slice(0, restFrom))], asItems(order.slice(restFrom))]) {
    const these = [];
    for (const it of tier) {
      const facts = (it.facts || []).filter((f) => !(skip && skip.has(f.passageId)));
      const own = itemWords(it, { facts: [] });
      if (!own && !facts.length) continue;
      /* WHICH FACTS FIRST, WHEN THE SHARE RUNS OUT (2.12.18): from both ends of
       * the book toward its middle — what first told who they are, then what the
       * book told of them last (a lost hand, a new rank) — never only the
       * earliest, so a long book's newest lasting facts are not the ones that
       * wait; those chosen are told in the book's order */
      const ends = [];
      for (let i = 0, j = facts.length - 1; i <= j; i++, j--) { ends.push(i); if (j !== i) ends.push(j); }
      const row = { it, facts, ends, own: Boolean(own), n: 0, on: false };
      if (own) {
        const c = cost(own) + 3;
        if (spent + c > budget) { left++; continue; }
        spent += c;
        row.on = true;
      }
      these.push(row);
    }
    for (let more = true; more;) {
      more = false;
      for (const x of these) {
        if (x.full || x.n >= x.facts.length) continue;
        const c = cost(factLine(x.facts[x.ends[x.n]])) + (x.n ? 0 : cost(toldHead(x.it))) + (x.on ? 0 : cost(headOf(x.it)) + 3);
        if (spent + c > budget || factsSpent + c > factsMost) { x.full = true; continue; }
        spent += c;
        factsSpent += c;
        x.n++;
        x.on = true;
        more = true;
      }
    }
    rows.push(...these);
  }
  const out = [];
  const words = [];
  let cut = false;
  for (const x of rows) {
    if (!x.on) { left++; continue; }
    if (x.n < x.facts.length) cut = true;
    out.push(x.it);
    words.push(itemWords(x.it, { facts: x.ends.slice(0, x.n).sort((p, q) => p - q).map((i) => x.facts[i]) }));
  }
  /* allEntries: every entry of his the writer may read went, with its own words (the pick has nothing to bring);
   * whole: all of it — every name with something to give here, each with every fact it has; rest: how many went only as the rest */
  const went = new Set(out.map((it) => it.ref));
  const gives = (it) => Boolean(itemWords(it, { facts: [] })) || (it.facts || []).some((f) => !(skip && skip.has(f.passageId)));
  const allEntries = usable.every((it) => !it.entry || !itemWords(it, { facts: [] }) || went.has(it.ref));
  const whole = !cut && usable.every((it) => went.has(it.ref) || !gives(it));
  const restRefs = new Set(order.slice(restFrom));
  return { items: out, words, cost: spent, left, whole, allEntries, rest: out.filter((it) => restRefs.has(it.ref)).length };
}

/* ------------------------------------------------- what a page needs */

/* THE PICK (Cozy Tavern's smart recall, M510-50, made for the bibliography — his question, 2.12.27: "is the injection
 * of the bible smart, so it knows what to inject?"). A name rides when it is named (above). An entry the page needs
 * that its words never name — the order the city guard answers to when the guard storms the docks, how magic works
 * when a spell is cast — is found by what it means: the helper reads his words for the page and the words before the
 * point against his entries that would not ride, each by its name and line, and names the ones the page needs
 * (bibpick.js). Only names: what rides is his entry, word for word, as a named one does. */
export const PICK_MAX = 5;
/* Bibliography → Smart recall (Cozy Tavern's own name for it, M510-50): on unless he turned it off for the book (Super automatic: on) */
export const recallOn = (novel) => superActive() || !(novel && novel.prefs && novel.prefs.bibRecall === 'off');

/* the words that tell what something is about: letters only, four or more, the commonest left out */
const COMMON = new Set(['that', 'this', 'with', 'from', 'they', 'them', 'their', 'there', 'then', 'than', 'have', 'had', 'has', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'would', 'could', 'should', 'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'again', 'just', 'like', 'only', 'some', 'more', 'most', 'much', 'very', 'been', 'being', 'each', 'every', 'other', 'others', 'your', 'yours', 'mine', 'here', 'still', 'even', 'back', 'down', 'through', 'once', 'also', 'away', 'upon', 'does', 'done', 'make', 'made', 'said', 'says', 'know', 'knew', 'come', 'came', 'goes', 'went', 'gone', 'take', 'took', 'look', 'looks', 'looked', 'want', 'wants', 'something', 'nothing', 'anything', 'everything', 'someone', 'because', 'though', 'without', 'against', 'between', 'around', 'until', 'these', 'those', 'himself', 'herself', 'itself', 'themselves']);
function topicWords(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().normalize('NFC').split(/[^\p{L}]+/u)) if (w.length >= 4 && !COMMON.has(w)) out.add(w);
  return out;
}

/* one entry as the helper is shown it: its name, the other names it goes by, what kind it is and its line (else the
 * first sentence of its words) */
function pickHead(it) {
  const e = it.entry || {};
  const line = String(e.line || '').trim() || firstSentence(String(e.text || '').trim()).slice(0, 240);
  return `${it.name}${(it.aka || []).length ? ` (also ${it.aka.join(', ')})` : ''} — ${KIND_ONE[kindOf(it.kind)]}${line ? `: ${line.replace(/\s+/g, ' ')}` : ''}`;
}

/* What the pick is asked about: {rows, riding}. rows — his entries a page could still need: set to ride when named,
 * with words to give, that his words and the words near the point do not name — numbered, each by pickHead; the ones
 * that share the most words with the moment first, fitted to `cap` tokens, then numbered in the bibliography's order.
 * riding — his entries that ride anyway (always, or named here), for the helper to know what the page has. Pure. */
export function pickRows(items, { his = '', near = '', cap = 6000, rode = null, byPage = false } = {}) {
  const usable = usableFor(items, 'write');
  /* rode: the entries the request carries without a pick (context.js stats.entries) — else the ones it names */
  let named = rode;
  let found = null;
  if (!named) {
    found = namedOrder(usable, his, near);
    named = new Set([...found.his, ...found.near]);
  }
  /* (byPage: an entry set to Always rides only as any other does — the pick may bring it like any other) */
  const riding = usable.filter((it) => it.entry && ((!byPage && it.rides === 'always') || named.has(it.ref)));
  /* (never one his own words name: it goes right after them, picked or not — one left out for room is left out either
   * way, and asking for it only made the page wait, 2.12.35) */
  const own = new Set((found || namedOrder(usable, his, '')).his);
  const open = (items || []).filter((it) => it.entry && (byPage ? ridesOf(it.rides) !== 'never' : ridesOf(it.rides) === 'named') && !named.has(it.ref) && !own.has(it.ref) && String(it.entry.text || it.entry.line || '').trim());
  if (!open.length) return { rows: [], riding };
  const moment = topicWords(`${his}\n${near}`);
  const scored = open.map((it, i) => {
    const head = pickHead(it);
    let score = 0;
    for (const w of topicWords(`${head}\n${String(it.entry.text || '').slice(0, 800)}`)) if (moment.has(w)) score++;
    return { it, i, head, score };
  }).sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen = [];
  let used = 0;
  for (const x of scored) {
    const c = estimateTokens(x.head) + 4;
    if (used + c > cap) continue;
    chosen.push(x);
    used += c;
  }
  chosen.sort((a, b) => a.i - b.i);
  return { rows: chosen.map((x, k) => ({ n: k + 1, ref: x.it.ref, name: x.it.name, head: x.head })), riding };
}

/* the entries the helper named, as refs: only numbers on the list, each once, at most PICK_MAX; anything it wrote that
 * cannot be read is none */
export function readPick(raw, rows) {
  const t = String(raw == null ? '' : raw);
  /* the answer's own: the last list it gave (a thought written before it may name one too) */
  const all = [...t.matchAll(/"entries"\s*:/g)];
  if (!all.length) return [];
  const at = all[all.length - 1].index;
  const open = t.indexOf('[', at);
  const close = open < 0 ? -1 : t.indexOf(']', open);
  if (open < 0 || close < 0) return [];
  const byN = new Map((rows || []).map((r) => [r.n, r.ref]));
  const out = [];
  for (const m of t.slice(open + 1, close).matchAll(/\d+/g)) {
    const ref = byN.get(Number(m[0]));
    if (ref && !out.includes(ref)) out.push(ref);
    if (out.length >= PICK_MAX) break;
  }
  return out;
}

