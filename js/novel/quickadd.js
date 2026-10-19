/* Cozy Novel — js/novel/quickadd.js — QUICK ADD (2.12.37).
 *
 * His ask: "a quick add bibliography chat, connected to the partner or on its own, that adds world info — anything not
 * in the premise or the book yet — to the world quickly, prevents errors, and checks whether what I asked is possible
 * and not contradictory." Notes → Bibliography → Quick add: he says what he wants in his world in his own words; his
 * partner's connection reads them as the partner sees the book (context.js assemble, no changes block), with the
 * passages that name what he adds, his premises and his entries for those names whole (prompts.js quickAddRequest),
 * and answers with what contradicts the pages, what changes his own earlier words, what cannot be by the world's rules,
 * what is left for him to decide, and the entries for all of it that holds.
 *
 * Nothing it says is taken on its word: every words it quotes are looked up — a contradiction is said only where the
 * page's words stand (with where, to go there), one whose words stand only in his own earlier words is his newer word
 * (a change, and it goes in), and one quoting words that stand nowhere is set aside, each said as it was. What goes in
 * rests on those look-ups, never on how the answer sorted them: where they part from it, it is asked once more with
 * the rows as they stand (2.12.40). The entries go in at once through the partner's own entry change (changes.js
 * makeChange — the same names, kinds and refusals), his own, with one Undo for the answer; an entry already his is
 * written whole again only when it went whole in the request and keeps what it said — else what is new is added to it.
 * A change to his own What it's about is put in it. What he said before in Quick add rides with what he says next, so
 * "keep mine" is an answer. A changed entry under a card of the notes has the notes checked against it (archivist.js
 * auditDue). */

import * as store from '../store.js';
import { ask } from '../model/call.js';
import { wireOf, contextOf } from '../model/providers.js';
import { assemble, partnerReply } from './context.js';
import { connFor } from './writer.js';
import { picked, passageNumbers, chapterLabel, premisesOf } from './shape.js';
import { quickAddRequest, quickAgainRequest, PREMISE_ROOM, JSON_AGAIN, JSON_CUT } from './prompts.js';
import { parseFirstObject, parseLastObject, closesWhole } from './jsonutil.js';
import { findIn } from './search.js';
import { namesAndFigures, foldedText, foldName } from './names.js';
import { entriesOf, entriesNamed, entryNamed, entryWords, kindSaid, nameForms, makeFinder, formKey } from './bibliography.js';
import { makeChange, undoChange } from './changes.js';
import * as archivist from './archivist.js';
import { newId, estimateTokens, numberWords } from '../util.js';

/* the rows kept (his words and what came of them), and how many of the newest that put something in keep their Undo */
export const QUICK_KEEP = 12;
export const UNDO_KEEP = 4;
export const ENTRIES_MOST = 30;
/* a row being asked beats while it asks; one silent this long had its window close before it answered */
const BEAT_MS = 30000;
export const GONE_MS = 2 * 60 * 1000;

const running = new Map();   /* novelId -> {ctl, rowId} */
export function quickBusy(novelId) { return running.has(novelId); }
/* the row this page is asking just now ('' when none) */
export function quickAsking(novelId) { const j = running.get(novelId); return j ? j.rowId : ''; }
export function stopQuick(novelId) { const j = running.get(novelId); if (j) j.ctl.abort(); }
export function quickLog(novel) { return Array.isArray(novel && novel.quick) ? novel.quick.filter((r) => r && r.id) : []; }

/* HOW A ROW BEING ASKED STANDS, as this page sees it (2.12.40, the audit: another window read a row it was still asking
 * as "stopped before it answered", with Ask again — a second run of the same words): 'here' (this page asks it),
 * 'elsewhere' (another window does — it beat lately), 'gone' (its window closed before it answered); '' when it is not
 * being asked */
export function askingWhere(novelId, r, now = Date.now()) {
  if (!r || r.state !== 'asking') return '';
  if (quickAsking(novelId) === r.id) return 'here';
  return now - (r.beat || r.at || 0) < GONE_MS ? 'elsewhere' : 'gone';
}

function bookNow(novelId) {
  const novel = store.peek('novel', novelId);
  const chapters = {};
  for (const id of (novel && novel.order) || []) { const c = store.peek('chapter', id); if (c) chapters[id] = c; }
  return { novel, chapters };
}

/* what a row holds that its Undo would put back: the entries it put in, What it's about put right */
const undoable = (r) => [...((r && r.added) || []), ...((r && r.book) || [])].filter((a) => a && a.change);
const holdsUndo = (r) => undoable(r).some((a) => a.status === 'made');
/* THE LOG KEPT (2.12.40, the audit: four asks that failed took the Undo of the answer before them — his entry written
 * over, and nothing left to put it back): the newest QUICK_KEEP rows, and the newest UNDO_KEEP that still hold an Undo
 * keep it — kept even past QUICK_KEEP. A row with nothing to put back (failed, stopped, put back already) takes no
 * one's place; one whose Undo is let go keeps what went in, as 'kept', and says so. */
function tidyLog(list) {
  const holders = new Set();
  for (let k = list.length - 1; k >= 0 && holders.size < UNDO_KEEP; k--) if (holdsUndo(list[k])) holders.add(list[k].id);
  const from = Math.max(0, list.length - QUICK_KEEP);
  const kept = list.filter((r, k) => k >= from || holders.has(r.id));
  for (const r of kept) {
    if (holders.has(r.id)) continue;
    for (const a of undoable(r)) { delete a.change; if (a.status === 'made') a.status = 'kept'; }
  }
  return kept;
}
/* A row put in, or put right where it stands — by id, so it lands over a newer copy too */
function rowStep(row) {
  return (n) => {
    const list = quickLog(n);
    const i = list.findIndex((r) => r.id === row.id);
    if (i >= 0) list[i] = JSON.parse(JSON.stringify(row)); else list.push(JSON.parse(JSON.stringify(row)));
    n.quick = tidyLog(list);
  };
}
/* the row being asked, beating */
const beatStep = (id) => (n) => { const r = quickLog(n).find((x) => x.id === id); if (r && r.state === 'asking') r.beat = Date.now(); };

/* ------------------------------------------------------- what his words name */

/* words with a capital that are never a name: an article, a pronoun — nor a contraction ("I'd", "Don't"). 2.12.40, the
 * audit: "The Sanguelis meets…" gave "The" as a name, and every passage of the book was sent as naming it. */
const NOT_A_NAME = new Set(['the', 'a', 'an', 'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'ourselves', 'they', 'them', 'their', 'theirs', 'themselves', 'this', 'that',
  'these', 'those', 'who', 'whom', 'whose', 'which', 'what', 'whoever', 'whatever', 'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything',
  'everyone', 'everybody', 'everything', 'nobody', 'nothing', 'none', 'each', 'either', 'neither', 'both', 'all', 'some', 'any', 'another', 'other', 'others']);
const CONTRACTED = /['’](?:m|ve|ll|re|d|t)$/i;
const notAName = (w) => { const x = String(w || '').trim(); return x.length < 2 || NOT_A_NAME.has(x.toLowerCase()) || CONTRACTED.test(x); };
const cardsOf = (novel) => { const n = (novel && novel.notes) || {}; return { people: n.people || [], places: n.places || [], lore: n.lore || [], threads: n.threads || [] }; };
const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pagesText = (novel, chapters) => ((novel && novel.order) || []).map((id) => (chapters[id] ? (chapters[id].passages || []).map((p) => String((picked(p) || {}).text || '')).join('\n') : '')).join('\n');

/* THE NAMES HIS WORDS GIVE, found as the page finds a name (bibliography.js nameForms → makeFinder — 2.12.40, the audit:
 * through 2.12.39 they were found in small letters too, so "Make Will the captain" sent the passages that say "the tide
 * will turn"): his entries and the notes' cards his words name, with every name each goes by; names written with a
 * capital mid-sentence that are no article, pronoun or contraction; and a word opening a sentence that the book itself
 * writes with a capital mid-sentence ("Sanguelis is…") */
export function namesIn(words, novel, chapters) {
  const t = String(words || '');
  const out = new Map();
  const add = (n) => { const k = String(n || '').trim(); if (!notAName(k) && !out.has(formKey(k))) out.set(formKey(k), k); };
  const forms = nameForms(entriesOf(novel), cardsOf(novel));
  if (forms.length && t.trim()) {
    const finder = makeFinder(forms);
    const refs = new Set();
    for (const hit of finder.find(t)) for (const r of finder.refsOf(hit.key)) refs.add(r);
    for (const f of forms) if (f.refs.some((r) => refs.has(r))) add(f.form);
  }
  for (const tok of namesAndFigures(t)) if (!/^\d/.test(tok)) add(tok);
  let book = null;
  for (const m of t.matchAll(/(?:^|[.!?…]\s+|\n\s*)(\p{Lu}[\p{L}\p{M}'’-]{2,})/gu)) {
    const tok = m[1];
    if (notAName(tok) || out.has(formKey(tok))) continue;
    if (book === null) book = pagesText(novel, chapters);
    if (new RegExp(`[\\p{L}\\p{N},;]\\s+${esc(tok)}(?![\\p{L}\\p{N}])`, 'u').test(book)) add(tok);
  }
  return [...out.values()];
}

/* the passages on the page that name them — found as the page finds a name: with capitals only as written, never inside
 * a word — the most of them first, fitted to `room` tokens, then told in the book's order: [{chapterId, passageId,
 * label, text}], with how many more there were */
export function passagesNaming(novel, chapters, names, room) {
  const rows = [];
  if (!names.length) return { passages: [], passagesLeft: 0 };
  const finder = makeFinder(names.map((n) => ({ form: n, refs: [n] })));
  (novel.order || []).forEach((cid, ci) => {
    const c = chapters[cid];
    if (!c) return;
    const nums = passageNumbers(c);
    (c.passages || []).forEach((p, pi) => {
      if (p.by === 'break') return;
      const text = String((picked(p) || {}).text || '');
      if (!text.trim()) return;
      const found = new Set();
      for (const hit of finder.find(text)) for (const r of finder.refsOf(hit.key)) found.add(r);
      if (found.size) rows.push({ chapterId: cid, passageId: p.id, label: `${chapterLabel(novel, c, { withName: false })}, Passage ${nums.get(p.id) || '—'}`, text, hits: found.size, at: ci * 100000 + pi });
    });
  });
  rows.sort((a, b) => b.hits - a.hits || b.at - a.at);
  const chosen = [];
  let used = 0;
  for (const r of rows) {
    const cost = estimateTokens(r.text) + 20;
    if (used + cost > room) continue;
    chosen.push(r);
    used += cost;
  }
  chosen.sort((a, b) => a.at - b.at);
  return { passages: chosen.map(({ chapterId, passageId, label, text }) => ({ chapterId, passageId, label, text })), passagesLeft: rows.length - chosen.length };
}

/* ------------------------------------------------------ where quoted words stand */

/* Every place a quote is looked for, in order: the pages first (with where, to go there); then his own earlier words —
 * a premise, an entry, a card of the notes HE wrote, his What it's about, How it reads and Where it's headed; then the
 * helper's own words — a card it wrote, what it keeps of the book — which are neither a page nor his (2.12.40, the
 * audit: a card the helper wrote counted as his own earlier words) */
const BOOK_FIELD = { about: 'brief', style: 'style', plans: 'plans' };
const BOOK_LABEL = { about: 'What it’s about', style: 'How it reads', plans: 'Where it’s headed' };
const NOTE_KINDS = ['people', 'places', 'lore', 'threads'];
const cardWords = (c) => [c.name, c.about, c.since, c.ties, c.now].filter(Boolean).join('\n');
const hisCard = (c) => Boolean(c && c.updated && c.updated.by === 'you');
function placesOf(novel, chapters) {
  const out = [];
  for (const cid of novel.order || []) {
    const c = chapters[cid];
    if (!c) continue;
    const nums = passageNumbers(c);
    for (const p of c.passages || []) {
      if (p.by === 'break') continue;
      const text = String((picked(p) || {}).text || '');
      if (text.trim()) out.push({ kind: 'page', chapterId: cid, passageId: p.id, label: `${chapterLabel(novel, c, { withName: false })}, Passage ${nums.get(p.id) || '—'}`, text });
    }
  }
  for (const x of premisesOf(novel, chapters)) out.push({ kind: 'premise', chapterId: x.chapterId, passageId: x.pid, label: `your premise for ${x.label}`, text: x.text });
  for (const e of entriesOf(novel)) out.push({ kind: 'entry', entryId: e.id, ref: `e:${e.id}`, label: `your entry ${e.name}`, text: entryWords(e) });
  const notes = cardsOf(novel);
  for (const k of NOTE_KINDS) for (const c of notes[k]) if (hisCard(c)) out.push({ kind: 'card', cardKind: k, id: c.id, label: `your card ${c.name} in the notes`, text: cardWords(c) });
  for (const field of Object.keys(BOOK_FIELD)) out.push({ kind: 'about', field, label: BOOK_LABEL[field], text: String(novel[BOOK_FIELD[field]] || '') });
  for (const k of NOTE_KINDS) for (const c of notes[k]) if (!hisCard(c)) out.push({ kind: 'helper', label: `the notes’ card ${c.name}, which the helper keeps`, text: cardWords(c) });
  for (const [key, what] of [['about', 'what it’s about'], ['style', 'how it reads']]) {
    const k = novel.kept && novel.kept[key];
    if (k && typeof k === 'object') out.push({ kind: 'helper', label: `what the helper keeps of ${what}`, text: String(k.text || '') });
  }
  return out;
}

/* WHETHER A QUOTE'S WORDS STAND IN SOME WORDS (2.12.40, the audit: "he is no elder" was found in "She is no elder",
 * "Gate" in "navigate", and a quote shortened with "…" stood nowhere): whole words, the same words in the same order,
 * capitals, accents and punctuation let go (names.js foldedText — kept while the words are the same, so a long book is
 * folded once, not once for every quote); a quote shortened with "…" by its parts, each after the one before, within
 * one paragraph */
const ELLIPSIS = /\s*(?:…|\.{3,})\s*/;
function stands(text, quote) {
  const t = String(text || '');
  if (!t.trim()) return false;
  const parts = String(quote || '').split(ELLIPSIS).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
  if (!parts.length) return false;
  const f = foldedText(t);
  const has = (fold, part) => { const p = foldedText(part); return fold.loose.includes(p.loose) || fold.tight.includes(p.tight); };
  if (parts.length === 1) return has(f, parts[0]);
  if (!parts.every((p) => has(f, p))) return false;
  for (const para of t.split(/\n+/)) {
    if (!para.trim()) continue;
    const fp = foldedText(para).loose;
    let from = 0;
    let all = true;
    for (const part of parts) {
      const needle = foldedText(part).loose;
      const i = fp.indexOf(needle, from);
      if (i < 0) { all = false; break; }
      /* (the space after one part is the space before the next) */
      from = i + needle.length - 1;
    }
    if (all) return true;
  }
  return false;
}

/* where words it quotes stand (the first place of placesOf that holds them): {kind, label, …} — or null when they stand
 * nowhere. `places`: placesOf, for looking up many quotes in one book */
export function whereIn(novel, chapters, quote, places = null) {
  const q = String(quote || '').trim();
  if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 4) return null;
  for (const at of places || placesOf(novel, chapters)) {
    if (!stands(at.text, q)) continue;
    const { text, ...where } = at;
    return where;
  }
  return null;
}

const line = (v, max = 600) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const isObj = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);

/* An answer, held to the book: each row's quoted words looked up (whereIn) — words that stand on a page are the book
 * saying otherwise, with where (`conflicts`, waiting for his word); words that stand only in his own earlier words are
 * his newer word (`changes`, it goes in — with what kind of his words they are, and for his What it's about the words
 * written again, `now`); a rule's words standing anywhere wait (`cannot`); words that stand nowhere, or only in the
 * helper's own words, are set aside, each kept to be said (`aside`). Each row keeps how the answer itself had it
 * (`said`), so where the look-ups part from it is known. */
export function readAnswer(novel, chapters, obj) {
  const out = { verdict: line(obj && obj.verdict, 1600), conflicts: [], changes: [], cannot: [], aside: [], questions: [], entries: [], over: [] };
  const rows = (k) => (Array.isArray(obj && obj[k]) ? obj[k].filter(isObj) : []);
  const places = placesOf(novel, chapters);
  const lookUp = (quote) => whereIn(novel, chapters, quote, places);
  const setAside = (r, quote, said, at) => out.aside.push({ mine: line(r.mine), quote: line(quote), where: line(r.where, 200), why: line(r.why), said, ...(at ? { only: at.label } : {}) });
  const sort = (r, quote, said) => {
    const at = lookUp(quote);
    if (!at || at.kind === 'helper') { setAside(r, quote, said, at); return; }
    if (at.kind === 'page') { out.conflicts.push({ mine: line(r.mine), against: line(quote), why: line(r.why), label: at.label, chapterId: at.chapterId, passageId: at.passageId, said }); return; }
    const now = said === 'changes' ? line(r.now, 4000) : '';
    out.changes.push({ mine: line(r.mine), was: line(quote), ...(now ? { now } : {}), why: line(r.why), label: at.label, kind: at.kind,
      ...(at.field ? { field: at.field } : {}), ...(at.entryId ? { entryId: at.entryId } : {}), ...(at.kind === 'premise' ? { chapterId: at.chapterId, passageId: at.passageId } : {}), said });
  };
  for (const r of rows('conflicts')) sort(r, r.against, 'conflicts');
  for (const r of rows('changes')) sort(r, r.was, 'changes');
  for (const r of rows('cannot')) {
    const at = lookUp(r.rule);
    if (!at || at.kind === 'helper') { setAside(r, r.rule, 'cannot', at); continue; }
    out.cannot.push({ mine: line(r.mine), rule: line(r.rule), why: line(r.why), label: at.label, ...(at.kind === 'page' ? { chapterId: at.chapterId, passageId: at.passageId } : {}), said: 'cannot' });
  }
  out.questions = (Array.isArray(obj && obj.questions) ? obj.questions : []).map((q) => line(q, 400)).filter(Boolean).slice(0, 3);
  const named = rows('entries').filter((e) => line(e.name, 200));
  out.entries = named.slice(0, ENTRIES_MOST);
  /* (2.12.40, the audit: the ones past ENTRIES_MOST were let go without a word) */
  out.over = named.slice(ENTRIES_MOST).map((e) => line(e.name, 200));
  return out;
}

/* WHERE THE LOOK-UPS PART FROM THE ANSWER (2.12.40, the audit: its entries went in by its own sorting — a change a page
 * says otherwise went in while the row said it waited; a conflict quoting only his own words was said to go in while
 * nothing did): the rows it is asked again about, or null when the look-ups bear it out — a change a page says otherwise
 * (`conflicts`), a conflict or a rule that stands only in his own earlier words (`changes`), words quoted from nowhere
 * (`aside`), his What it's about changed with no words to put in its place (`about`), and a change that goes in with
 * no entry to carry it */
function toSetRight(read, novel) {
  const conflicts = read.conflicts.filter((c) => c.said !== 'conflicts');
  const moved = read.changes.filter((c) => c.said !== 'changes');
  /* (one it had as against the book is asked for its words too: it gave none) */
  const about = read.changes.filter((c) => c.kind === 'about' && !c.now);
  /* his newer word with nothing to carry it: no entry at all, or not the entry of his it changes */
  const gives = (id) => read.entries.some((e) => { const m = entryNamed(entriesOf(novel), line(e.name, 200)).entry; return Boolean(m) && m.id === id; });
  const lone = read.changes.filter((c) => c.said === 'changes' && c.kind !== 'about' && (!read.entries.length || (c.kind === 'entry' && !gives(c.entryId))));
  if (!conflicts.length && !moved.length && !read.aside.length && !about.length && !lone.length) return null;
  return { conflicts, changes: [...moved, ...lone], aside: read.aside, about };
}

/* --------------------------------------------- his entry, never thinned nor written blind */

/* figures as a reader counts them: digits, and numbers in words ("seven", "three hundred", "twenty-one") — `one` alone
 * is no figure ("one of them"). Map value -> as written */
const SMALL_NUMBER = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90 };
const BIG_NUMBER = { thousand: 1000, million: 1000000 };
function figuresOf(text) {
  const t = String(text || '');
  const out = new Map();
  for (const m of t.matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu)) {
    const v = Number(m[0].replace(/,(?=\d{3}(?!\d))/g, ''));
    if (Number.isFinite(v) && !out.has(v)) out.set(v, m[0]);
  }
  let run = [];
  let total = 0;
  let cur = 0;
  let end = 0;
  const flush = () => {
    while (run.length && run[run.length - 1].toLowerCase() === 'and') run.pop();
    if (run.length && !(run.length === 1 && run[0].toLowerCase() === 'one')) { const v = total + cur; if (v && !out.has(v)) out.set(v, run.join(' ')); }
    run = []; total = 0; cur = 0;
  };
  for (const m of t.matchAll(/\p{L}+/gu)) {
    const w = m[0].toLowerCase();
    if (run.length && !/^[\s-]*$/.test(t.slice(end, m.index))) flush();
    end = m.index + m[0].length;
    if (Object.hasOwn(SMALL_NUMBER, w)) { cur += SMALL_NUMBER[w]; run.push(m[0]); continue; }
    if (w === 'hundred') { cur = (cur || 1) * 100; run.push(m[0]); continue; }
    if (Object.hasOwn(BIG_NUMBER, w)) { total += (cur || 1) * BIG_NUMBER[w]; cur = 0; run.push(m[0]); continue; }
    /* "three hundred and twelve" */
    if (w === 'and' && run.length && /^(?:hundred|thousand|million)$/i.test(run[run.length - 1])) { run.push(m[0]); continue; }
    flush();
  }
  flush();
  return out;
}
/* the names some words give that others lose: his entries' and the notes' names (found as the page finds them, any
 * name of the same one kept counting as kept — never the entry's own), and names written with a capital mid-sentence */
function namesLost(old, next, novel, self) {
  const lost = [];
  const forms = nameForms(entriesOf(novel), cardsOf(novel));
  const finder = forms.length ? makeFinder(forms) : null;
  const own = self ? `e:${self.id}` : '';
  const known = [];
  if (finder) {
    const there = new Set();
    for (const h of finder.find(next)) for (const r of finder.refsOf(h.key)) there.add(r);
    const said = new Set();
    for (const h of finder.find(old)) {
      const words = old.slice(h.start, h.end);
      known.push(foldedText(words));
      const refs = finder.refsOf(h.key);
      if (refs.includes(own) || refs.some((r) => there.has(r))) continue;
      const k = refs.join('|');
      if (said.has(k)) continue;
      said.add(k);
      lost.push(words);
    }
  }
  const loose = [];
  for (const tok of namesAndFigures(old)) {
    if (/^\d/.test(tok) || notAName(tok)) continue;
    /* (a word of a name found above is judged with it) */
    if (known.some((f) => f.loose.includes(` ${foldName(tok)} `))) continue;
    if (!new RegExp(`(?<![\\p{L}\\p{N}])${esc(tok)}(?![\\p{L}\\p{N}])`, 'u').test(next) && !loose.includes(tok)) loose.push(tok);
  }
  /* two lost side by side are one name: "Iron Covenant" */
  for (const tok of loose) {
    const last = lost.length ? lost[lost.length - 1] : '';
    if (last && new RegExp(`(?<![\\p{L}\\p{N}])${esc(last)}\\s+${esc(tok)}(?![\\p{L}\\p{N}])`, 'u').test(old)) lost[lost.length - 1] = `${last} ${tok}`;
    else lost.push(tok);
  }
  return lost;
}
const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/* WHAT AN ENTRY'S WORDS WRITTEN WHOLE AGAIN WOULD LOSE (2.12.40, the audit: his own 71-word entry came back as the
 * answer's 15 words — "seven of nine", "a black rose", "the Iron Covenant" gone), held as the notes' check holds his
 * words (archivist.js judgeWords) and a summary its names and figures: a long telling (four sentences or more) keeps at
 * least half its sentences as they stand, and no name or figure it gave is lost — but the words his newer word changes,
 * looked up where they stand in it (`changing`), may go. '' when it keeps what it said; else what it would lose, said. */
function whatItLoses(old, next, novel, self, changing = []) {
  const nowF = foldedText(next).loose;
  const free = changing.map((w) => foldedText(w).loose);
  const freed = (s) => free.some((w) => s.includes(w) || w.includes(s));
  const was = String(old).split(/(?<=[.!?…])\s+/).map((s) => foldedText(s).loose).filter((s) => s.trim().split(' ').length >= 3 && !freed(s));
  const thin = was.length >= 4 && was.filter((s) => nowF.includes(s)).length / was.length < 0.5;
  const have = figuresOf(next);
  const figures = [...figuresOf(old)].filter(([v]) => !have.has(v)).map(([, said]) => said);
  const freeText = changing.join('\n');
  const lost = [...namesLost(old, next, novel, self), ...figures].filter((w) => !freeText || !stands(freeText, w));
  if (lost.length) return `what it wrote would have lost ${listOf(lost.map((w) => `“${w}”`))}`;
  return thin ? 'what it wrote would have left out more than half of what your entry says' : '';
}

/* The entries, put in through the partner's own entry change — his, each with what came of it. An entry already his is
 * written whole again only when it went whole in this request (`seen`: id -> its words as they were sent) and keeps what
 * it said (whatItLoses); else only its new sentences are added to it (the cards' rule: added to, never thinned —
 * archivist.js newSentences), and its line stays his. Its kind stays as he set it: the request never says it. */
function putEntries(novelId, entries, seen, changes = []) {
  const added = [];
  const refused = [];
  for (const e of entries) {
    const name = line(e.name, 200);
    const novel = store.peek('novel', novelId);
    const cur = entryNamed(entriesOf(novel), name).entry;
    const op = { entry: name };
    const aka = (Array.isArray(e.aka) ? e.aka : typeof e.aka === 'string' ? e.aka.split(',') : []).map((x) => line(x, 120)).filter(Boolean);
    if (aka.length) op.aka = aka;
    const said = line(e.line, 400);
    const offered = String(e.text || '').trim();
    let how = '';
    let addedWhy = '';
    if (!cur) {
      op.kind = kindSaid(e.kind) || 'lore';
      if (said) op.line = said;
      if (offered) op.text = offered;
    } else {
      const had = String(cur.text || '').trim();
      const whole = seen.has(cur.id) && seen.get(cur.id) === String(cur.text || '');
      if (offered && offered !== had) {
        const changing = changes.filter((c) => c.kind === 'entry' && c.entryId === cur.id).map((c) => c.was);
        const loses = had && whole ? whatItLoses(had, offered, novel, cur, changing) : '';
        if (!had || (whole && !loses)) { op.text = offered; how = 'whole'; }
        else {
          const fresh = archivist.newSentences(had, offered);
          if (fresh.length) op.add = fresh.join(' ');
          how = 'added';
          addedWhy = whole ? loses : 'it had not read your entry whole';
        }
      }
      /* (its line too: written again only with an entry it had whole and did not have to be added to) */
      if (said && ((whole && how !== 'added') || !String(cur.line || '').trim())) op.line = said;
    }
    const ch = makeChange(novelId, op, { entryBy: 'you' });
    if (ch.status === 'made') added.push({ name, entryId: (ch.undo && ch.undo.id) || '', was: Boolean(cur), status: 'made', change: ch, ...(how ? { how } : {}), ...(addedWhy ? { addedWhy } : {}) });
    else refused.push({ name, why: line(ch.said, 300) });
  }
  return { added, refused };
}

/* WHAT THE BOOK IS ABOUT, PUT RIGHT TO HIS NEWER WORD (2.12.40, the audit: a change to his own What it's about was only
 * said — the earlier words stayed, and rode to the writer beside the entry that says otherwise): the earlier words found
 * where they stand and the answer's words put in their place, through the partner's own change of the book's words, with
 * Undo these. His premises are his record of what he asked for a passage: never written again — the row says his newer
 * word stands over them. One row for each change of his book's words: {at (the change's place in the row), field,
 * label, was, now?, status: 'made' | 'refused', why?, change?} */
function mendBook(novelId, changes) {
  const out = [];
  changes.forEach((c, at) => {
    if (c.kind !== 'about' || !BOOK_FIELD[c.field]) return;
    const base = { at, field: c.field, label: c.label, was: c.was };
    if (!c.now) { out.push({ ...base, status: 'refused', why: 'no new words came for it' }); return; }
    const parts = String(c.was).split(ELLIPSIS).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
    if (parts.length !== 1) { out.push({ ...base, status: 'refused', why: 'it quoted those words only in part, so they cannot be put right here — change them in About this book' }); return; }
    const novel = store.peek('novel', novelId);
    const text = String((novel && novel[BOOK_FIELD[c.field]]) || '');
    const [hit] = findIn(text, parts[0], { words: true, whole: true, max: 1 });
    if (!hit) { out.push({ ...base, status: 'refused', why: 'those words are not there any more' }); return; }
    /* (the stop after the words stays theirs: never two) */
    const now = /[.!?…]$/.test(c.now) && /^[.!?…]/.test(text.slice(hit.end)) ? c.now.replace(/[.!?…]+$/, '') : c.now;
    const ch = makeChange(novelId, { book: c.field, find: text.slice(hit.start, hit.end), replace: now, why: 'your newer word, in Quick add' });
    if (ch.status === 'made') out.push({ ...base, now, status: 'made', change: ch });
    else out.push({ ...base, status: 'refused', why: line(ch.said, 300) });
  });
  return out;
}

/* what came of it, in the app's own plain words — said in place of the answer's verdict wherever the look-ups part from
 * it (2.12.40, the audit: "the book gives grey" stood over a row the app had set aside) */
const many = (n, one, more) => (n === 1 ? `One ${one}` : `${numberWords(n)} ${more}`);
function plainAccount(r) {
  const out = [];
  const made = (r.added || []).filter((a) => a.status === 'made').map((a) => a.name);
  const mended = (r.book || []).filter((b) => b.status === 'made').map((b) => b.label);
  if (made.length) out.push(`${listOf(made)} went into your bibliography.`);
  if (mended.length) out.push(`${listOf(mended)} now say${mended.length === 1 ? 's' : ''} what your newer words say.`);
  if (!made.length && !mended.length) out.push('Nothing went in.');
  if ((r.held || []).length) out.push('What it wrote waits with what the book says otherwise.');
  const waits = (r.conflicts || []).length + (r.cannot || []).length;
  if (waits) out.push(`${many(waits, 'thing waits', 'things wait')} for your word.`);
  if ((r.refused || []).length) out.push(`${many(r.refused.length, 'entry was', 'entries were')} not put in.`);
  if ((r.aside || []).length) out.push(`${many(r.aside.length, 'thing it named quoted', 'things it named quoted')} words that stand nowhere in the book or your own words.`);
  return out.join(' ');
}

/* ------------------------------------------------------------- asking */

/* the request as his partner's connection sees the book now, for these words: {request, shown} — shown, the entries it
 * gives whole (id -> their words as they stand) */
function requestFor(novelId, words, c) {
  const { novel, chapters } = bookNow(novelId);
  const room = Math.max(1500, Math.floor(contextOf(c) * 0.25));
  const names = namesIn(words, novel, chapters);
  /* his premises — those naming what his words name first, then the newest — and his entries for those names, fitted in
   * one pass (archivist.js premisesFitted, entriesFitted — 2.12.40, the audit: the earliest only, rebuilt for every one
   * let go, and none at all when the first was long) */
  const prem = archivist.premisesFitted(novel, chapters, Math.floor(room / 4), { names });
  /* (his entries his words name, found as the page finds a name — 2.12.40, the audit: any word of a name in small
   * letters counted; the partner reads every entry, Never ones too) */
  const byWords = new Set(entriesNamed(entriesOf(novel), words).map((e) => e.id));
  const named = entriesOf(novel).filter((e) => byWords.has(e.id) || names.some((n) => entryNamed([e], n).entry));
  const ent = archivist.entriesFitted(named, Math.floor(room / 4));
  const pas = passagesNaming(novel, chapters, names, Math.floor(room / 2));
  /* what was said before in Quick add, the newest few (never the one being asked) */
  const earlier = quickLog(novel).filter((r) => r.state === 'done').slice(-4);
  const request = quickAddRequest({ words, earlier, ...prem, ...ent, ...pas });
  /* (whole: an entry past its room rides by its opening only — prompts.js entryRow — and is never written over from that) */
  const whole = ent.entries.filter((e) => String(entryWords(e) || '').length <= PREMISE_ROOM);
  return { request, shown: new Map(whole.map((e) => [e.id, String(e.text || '')])) };
}

const want = (o) => isObj(o) && (Array.isArray(o.entries) || typeof o.verdict === 'string' || Array.isArray(o.conflicts));
const wantAgain = (o) => isObj(o) && Array.isArray(o.entries);
const CUT_TWICE = 'its answer was cut off at the reply’s length both times — give your partner’s connection a longer Longest reply (Settings → Connections)';
const MOST_WORDS = numberWords(ENTRIES_MOST).toLowerCase();

/* Quick add: his words checked, and what holds put in. {ok, row} or {ok: false, error, giveBack} */
export async function quickAdd({ novelId, chapterId = '', words }) {
  const t = String(words || '').trim();
  if (!t) return { ok: false, error: '' };
  if (running.has(novelId)) return { ok: false, error: 'Quick add is checking already — wait for it, or Stop it', giveBack: t };
  const house = store.peek('house', 'house') || {};
  const conn = connFor(house, 'partner');
  if (!conn) return { ok: false, error: 'no connection is chosen for your partner yet — Settings → Connections', giveBack: t };
  const novel0 = store.peek('novel', novelId);
  if (!novel0) return { ok: false, error: 'the book is not open', giveBack: t };
  const target = chapterId && (novel0.order || []).includes(chapterId) ? chapterId : (novel0.order || []).slice(-1)[0];
  const row = { id: newId('qa'), at: Date.now(), said: t, state: 'asking', beat: Date.now(), tab: store.CLIENT, browser: store.BROWSER };
  /* asking from before the row is laid in: the screen drawn for the row draws it as being asked */
  const ctl = new AbortController();
  running.set(novelId, { ctl, rowId: row.id });
  try { store.change('novel', novelId, rowStep(row), { now: true }); } catch (e) { running.delete(novelId); return { ok: false, error: (e && e.message) || String(e), giveBack: t }; }
  /* it beats while it asks, so another window says it is being checked — never that it stopped */
  const beating = setInterval(() => { try { store.change('novel', novelId, beatStep(row.id), { delay: 50 }); } catch (_) { /* gone */ } }, BEAT_MS);
  const settle = (patch) => {
    const now = quickLog(store.peek('novel', novelId)).find((r) => r.id === row.id) || row;
    const next = { ...now, ...patch };
    delete next.beat; delete next.tab; delete next.browser;
    store.change('novel', novelId, rowStep(next), { now: true });
    return next;
  };
  /* what went in already, should anything go wrong after it */
  let partial = null;
  try {
    /* the entries the last request carried whole: those the request gives, and those the bibliography's own part carried
     * whole (context.js stats.entries) — each with its words as they were then */
    let seenNow = new Map();
    const build = (extra) => (c) => {
      const { novel, chapters } = bookNow(novelId);
      const req = requestFor(novelId, t, c);
      const a = assemble({ house, novel, chapters, conn: c, purpose: 'partner', target: { chapterId: target }, turns: [], request: req.request, tools: false });
      const whole = new Map(req.shown);
      for (const ref of a.stats.entries || []) {
        if (!String(ref).startsWith('e:')) continue;
        const e = entriesOf(novel).find((x) => x.id === String(ref).slice(2));
        if (e) whole.set(e.id, String(e.text || ''));
      }
      seenNow = whole;
      /* the partner's own room: his Longest reply raised to the floor a block of it needs — a block cut off is lost whole
       * (context.js partnerReply; 2.12.40, the audit: Ideas' length was sent, and both tries were cut) */
      return { system: a.system, systemParts: a.systemParts, messages: [...a.messages, ...extra], maxTokens: partnerReply(c, 'scene', wireOf(c) === 'anthropic'), refuse: a.refuse, least: a.stats.least, seed: a.seed };
    };
    const opts = { stream: true, signal: ctl.signal, leash: true, noPrefill: true, noStructured: true };
    const readOut = (o, wanted) => {
      let obj = !o.cut || closesWhole(o.text) ? parseFirstObject(o.text, wanted) : null;
      if (!obj && !String(o.text || '').trim() && o.thinking && (!o.cut || closesWhole(o.thinking))) obj = parseLastObject(o.thinking, wanted);
      return obj;
    };
    const stopped = () => ({ ok: false, stopped: true, row: settle({ state: 'stopped' }), giveBack: t });
    let out = await ask(conn, { ...opts, build: build([]) });
    if (out.stopped) return stopped();
    if (!out.ok) return { ok: false, error: out.error || 'no answer came', row: settle({ state: 'failed', error: line(out.error || 'no answer came', 400) }), giveBack: t };
    let obj = readOut(out, want);
    let answered = out;
    /* once more, told what went wrong (as the helper is) */
    if (!obj) {
      const first = out;
      out = await ask(conn, { ...opts, build: build([{ role: 'assistant', content: String(first.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: first.cut ? JSON_CUT : JSON_AGAIN }]) });
      if (out.stopped) return stopped();
      obj = out.ok ? readOut(out, want) : null;
      if (!obj) {
        const why = !out.ok ? (out.error || 'no answer came') : first.cutBy === 'length' && out.cutBy === 'length' ? CUT_TWICE : 'its answer could not be read';
        return { ok: false, error: why, row: settle({ state: 'failed', error: line(why, 400) }), giveBack: t };
      }
      answered = out;
    }
    let seen = seenNow;
    let { novel, chapters } = bookNow(novelId);
    if (!novel) return { ok: false, error: 'the book was closed' };
    const read = readAnswer(novel, chapters, obj);
    let entries = read.entries;
    let over = read.over;
    let again = '';
    let held = [];
    /* the look-ups part from how it sorted them: asked once more, with the rows as they stand, for the entries again */
    const fix = toSetRight(read, novel);
    if (fix) {
      out = await ask(conn, { ...opts, build: build([{ role: 'assistant', content: String(answered.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: quickAgainRequest(fix) }]) });
      if (out.stopped) return stopped();
      const obj2 = out.ok ? readOut(out, wantAgain) : null;
      ({ novel, chapters } = bookNow(novelId));
      if (!novel) return { ok: false, error: 'the book was closed' };
      if (obj2) {
        again = 'answered';
        seen = seenNow;
        const second = readAnswer(novel, chapters, { entries: obj2.entries, conflicts: obj2.conflicts });
        entries = second.entries;
        over = second.over;
        /* a row set aside that it now quotes a page for: the book says otherwise, and it waits */
        for (const c of second.conflicts) {
          const i = read.aside.findIndex((x) => foldName(x.mine) === foldName(c.mine));
          if (i < 0) continue;
          read.aside.splice(i, 1);
          read.conflicts.push({ ...c, said: 'again' });
        }
        /* his book's own words written again for his newer word */
        for (const w of Array.isArray(obj2.changes) ? obj2.changes.filter(isObj) : []) {
          const c = read.changes.find((x) => x.kind === 'about' && !x.now && foldName(x.was) === foldName(w.was));
          if (c && line(w.now, 4000)) c.now = line(w.now, 4000);
        }
      } else {
        again = 'failed';
        /* what it wrote might say what a page says otherwise: none of it goes in */
        if (read.conflicts.some((c) => c.said === 'changes')) { held = [...entries.map((e) => line(e.name, 200)), ...over]; entries = []; over = []; }
      }
    }
    const shown = { conflicts: read.conflicts, changes: read.changes, cannot: read.cannot, aside: read.aside, questions: read.questions, ...(again ? { again } : {}), ...(held.length ? { held } : {}) };
    const { added, refused } = putEntries(novelId, entries, seen, read.changes);
    partial = { ...shown, added, refused };
    for (const name of over) refused.push({ name, why: `only ${MOST_WORDS} go in from one answer — send it in a Quick add of its own` });
    const book = mendBook(novelId, read.changes);
    partial.book = book;
    /* its verdict only where the look-ups bear it out, every entry went in and none was let go, and his book's words
     * were put right as it said */
    const agreed = !fix && !refused.length && book.every((b) => b.status === 'made') && Boolean(read.verdict);
    const done = settle({ state: 'done', ...shown, added, refused, book, verdict: agreed ? read.verdict : plainAccount({ ...shown, added, refused, book }), verdictBy: agreed ? 'partner' : 'app' });
    /* the notes follow what went in: an entry changed under a card has them checked against it (archivist.js auditDue) */
    if (added.length || book.some((b) => b.status === 'made')) archivist.nudge(novelId, 1500);
    return { ok: true, row: done };
  } catch (e) {
    /* never left "being asked" by something gone wrong on the way: said as it stands — what went in already, with its
     * Undo, or nothing, with his words back */
    const why = line((e && e.message) || String(e), 400) || 'something went wrong on the way';
    try {
      if (partial && ((partial.added || []).length || (partial.book || []).some((b) => b.status === 'made'))) {
        return { ok: true, row: settle({ state: 'done', ...partial, book: partial.book || [], verdict: plainAccount({ ...partial }), verdictBy: 'app' }) };
      }
      return { ok: false, error: why, row: settle({ state: 'failed', error: why }), giveBack: t };
    } catch (_) { return { ok: false, error: why, giveBack: t }; }
  } finally {
    clearInterval(beating);
    running.delete(novelId);
  }
}

/* Undo these: what one answer put in — its entries, his What it's about put right — taken back out, each only where it
 * stands as it went in (changes.js undoChange) */
export function undoQuick(novelId, rowId) {
  const row = quickLog(store.peek('novel', novelId)).find((r) => r.id === rowId);
  if (!row) return { ok: false, back: 0, said: ['that Quick add is not kept any more'] };
  const said = [];
  let back = 0;
  const added = (row.added || []).map((a) => ({ ...a }));
  const book = (row.book || []).map((b) => ({ ...b }));
  for (const [list, nameOf] of [[added, (a) => a.name], [book, (b) => b.label]]) {
    for (const a of [...list].reverse()) {
      if (a.status !== 'made' || !a.change) continue;
      const out = undoChange(novelId, a.change);
      if (out && out.ok === false) { said.push(`${nameOf(a)}: ${out.said || 'it has changed since'}`); continue; }
      a.status = 'undone';
      back++;
    }
  }
  store.change('novel', novelId, rowStep({ ...row, added, book }), { now: true });
  if (back) archivist.nudge(novelId, 1500);
  return { ok: back > 0, back, said };
}

/* Clear Quick add: the conversation let go — what went into the bibliography stays. Row by row (2.12.40, the audit: it
 * let the whole log go, so over a newer copy it took a row another window had just added, and a row still being asked
 * elsewhere): only the rows given back for its Undo, and never one being asked */
export function clearQuick(novelId) {
  const before = quickLog(store.peek('novel', novelId)).filter((r) => !askingWhere(novelId, r) || askingWhere(novelId, r) === 'gone');
  const ids = new Set(before.map((r) => r.id));
  store.change('novel', novelId, (n) => { n.quick = quickLog(n).filter((r) => !ids.has(r.id)); }, { now: true });
  return JSON.parse(JSON.stringify(before));
}
/* its Undo: the rows put back where they stood, beside any made since (2.12.40, the audit: the whole log was put back,
 * and a Quick add made between Clear and its Undo lost its row and its Undo while its entry stayed in) */
export function putBackQuick(novelId, rows) {
  const back = JSON.parse(JSON.stringify(rows || [])).filter((r) => r && r.id);
  store.change('novel', novelId, (n) => {
    const now = quickLog(n);
    const have = new Set(now.map((r) => r.id));
    const all = [...back.filter((r) => !have.has(r.id)), ...now].sort((a, b) => (a.at || 0) - (b.at || 0));
    n.quick = tidyLog(all);
  }, { now: true });
}
