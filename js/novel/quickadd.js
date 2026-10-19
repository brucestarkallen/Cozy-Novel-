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
 * the rows as they stand (2.12.40), and what it gives again wins by name. The entries go in at once through the
 * partner's own entry change (changes.js makeChange — the same names, kinds and refusals), his own, with one Undo for the
 * answer; an entry already his is put together with what the answer wrote, one rule at every length — each sentence of
 * his kept, or the answer's that holds its words in its place, the words his newer word changes put right where they
 * stand, and only what brings what his entry lacks added — and written as the answer wrote it only when it went whole in
 * the request and keeps all it said (mergeEntry). A change to his own What it's about is put in it; words that stand only
 * in what the helper keeps of it are written again from the book. What he said before in Quick add rides with what he
 * says next, in his own voice, so "keep mine" is an answer. A changed entry under a card of the notes has the notes
 * checked against it (archivist.js auditDue). */

import * as store from '../store.js';
import { ask } from '../model/call.js';
import { wireOf, contextOf } from '../model/providers.js';
import { assemble, partnerReply } from './context.js';
import { connFor } from './writer.js';
import { picked, passageNumbers, chapterLabel, premisesOf } from './shape.js';
import { quickAddRequest, quickAgainRequest, keptByHelper, PREMISE_ROOM, JSON_AGAIN, JSON_CUT } from './prompts.js';
import { parseFirstObject, parseLastObject, closesWhole } from './jsonutil.js';
import { findIn } from './search.js';
import { namesAndFigures, foldedText, foldName, nearName } from './names.js';
import { entriesOf, entriesNamed, entryNamed, entryWords, kindSaid, nameForms, makeFinder, formKey } from './bibliography.js';
import { makeChange, undoChange } from './changes.js';
import * as archivist from './archivist.js';
import { newId, estimateTokens, numberWords, nameKey } from '../util.js';

/* the rows kept (his words and what came of them), and how many of the newest that put something in keep their Undo */
export const QUICK_KEEP = 12;
export const UNDO_KEEP = 4;
export const ENTRIES_MOST = 30;
/* a row being asked beats while it asks; one silent this long had its window close before it answered */
const BEAT_MS = 30000;
export const GONE_MS = 2 * 60 * 1000;

const running = new Map();   /* novelId -> {ctl, rowId} */
export function quickBusy(novelId) { return running.has(novelId); }
/* any Quick add this page is asking, in any book — so an update never lands mid-ask (app.js quietNow, 2.12.40) */
export function quickAny() { return running.size > 0; }
/* the row this page is asking just now ('' when none) */
export function quickAsking(novelId) { const j = running.get(novelId); return j ? j.rowId : ''; }
export function stopQuick(novelId) { const j = running.get(novelId); if (j) j.ctl.abort(); }
export function quickLog(novel) { return Array.isArray(novel && novel.quick) ? novel.quick.filter((r) => r && r.id) : []; }

/* HOW A ROW BEING ASKED STANDS, as this page sees it (2.12.40, the audit: another window read a row it was still asking
 * as "stopped before it answered", with Ask again — a second run of the same words): 'here' (this page asks it),
 * 'elsewhere' (another window does), 'gone' (its window closed before it answered); '' when it is not being asked.
 * Asked in this browser, the store's open-tab lock says at once whether its tab is still open (store.liveTabs — asked
 * by tabsNow); asked in another, it is gone once this page has seen its beat stand still for GONE_MS by its own clock —
 * never by holding another device's clock against this one's (2.12.40, the review: a reload left a row from a closed
 * tab "being checked" for two minutes, and a device whose clock ran behind read as closed while it still asked) */
const heard = new Map();     /* rowId -> {beat, since}: the beat this page last saw change, and when, by its own clock */
let tabsHere = null;         /* the tabs open in this browser, as last asked (null: not asked yet, or it cannot say) */
export async function tabsNow() { tabsHere = await store.liveTabs(); return tabsHere; }
const ownBrowser = (r) => Boolean(r && r.browser && store.BROWSER && r.browser === store.BROWSER && r.tab);
function stillFor(r, now) {
  const beat = r.beat || r.at || 0;
  const h = heard.get(r.id);
  if (!h || h.beat !== beat) { heard.set(r.id, { beat, since: now }); return 0; }
  return now - h.since;
}
export function askingWhere(novelId, r, now = Date.now()) {
  if (!r || r.state !== 'asking') return '';
  if (quickAsking(novelId) === r.id) return 'here';
  if (ownBrowser(r)) {
    /* (this very page asked it and asks it no more: never "elsewhere") */
    if (r.tab === store.CLIENT) return 'gone';
    if (tabsHere) return tabsHere.has(r.tab) ? 'elsewhere' : 'gone';
  }
  return stillFor(r, now) < GONE_MS ? 'elsewhere' : 'gone';
}
/* A ROW A CLOSED TAB OF THIS BROWSER WAS ASKING, PUT RIGHT: once the store's open-tab lock says its tab is gone — or this
 * very page asked it, and asks it no more — it is kept as stopped, its window closed before it answered, so every window
 * says so at once and Clear takes it as any other (2.12.40, the review: the app puts right what it can tell). Never one
 * judged by its beat alone: that is only how it looks from here. How many were put right. */
export function settleGone(novelId) {
  const sure = (r) => ownBrowser(r) && (r.tab === store.CLIENT || Boolean(tabsHere)) && askingWhere(novelId, r) === 'gone';
  const ids = new Set(quickLog(store.peek('novel', novelId)).filter(sure).map((r) => r.id));
  if (!ids.size) return 0;
  store.change('novel', novelId, (n) => {
    n.quick = quickLog(n).map((r) => {
      if (!ids.has(r.id) || r.state !== 'asking') return r;
      const { beat: _b, tab: _t, browser: _w, ...rest } = r;
      return { ...rest, state: 'stopped', closed: true };
    });
  }, { now: true });
  return ids.size;
}
/* how long, by this page's clock, before a row asked elsewhere would read as gone — null where its tab's lock says it,
 * to be asked again (a closed tab's lock can outlast it by a moment) */
export function goneIn(r, now = Date.now()) {
  if (ownBrowser(r) && tabsHere) return null;
  const h = heard.get(r.id);
  return GONE_MS - (h && h.beat === (r.beat || r.at || 0) ? now - h.since : 0);
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
  /* (`keptKey`: a quote standing only there has the helper write it again from the book — 2.12.40, the review) */
  for (const [key, what] of [['about', 'what it’s about'], ['style', 'how it reads']]) {
    const k = novel.kept && novel.kept[key];
    if (k && typeof k === 'object') out.push({ kind: 'helper', keptKey: key, label: `what the helper keeps of ${what}`, text: String(k.text || '') });
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
  const setAside = (r, quote, said, at) => out.aside.push({ mine: line(r.mine), quote: line(quote), where: line(r.where, 200), why: line(r.why), said, ...(at ? { only: at.label } : {}), ...(at && at.keptKey ? { kept: at.keptKey } : {}) });
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
/* THE NAMES SOME WORDS GIVE: his entries' and the notes' names (found as the page finds them, any name of the same one
 * counting as the same — never the entry's own), and names written with a capital mid-sentence. One finder, read for as
 * many texts as there are (2.12.40, the review: every sentence of an entry is held to them) */
function nameReader(novel, self) {
  const forms = nameForms(entriesOf(novel), cardsOf(novel));
  const finder = forms.length ? makeFinder(forms) : null;
  const own = self ? `e:${self.id}` : '';
  return (text) => {
    const t = String(text || '');
    const refs = [];
    const all = new Set();
    const known = [];
    if (finder) {
      const said = new Set();
      for (const h of finder.find(t)) {
        const words = t.slice(h.start, h.end);
        known.push(foldedText(words));
        const rs = finder.refsOf(h.key);
        for (const r of rs) all.add(r);
        if (rs.includes(own)) continue;
        const k = rs.join('|');
        if (said.has(k)) continue;
        said.add(k);
        refs.push({ words, refs: rs });
      }
    }
    const loose = [];
    for (const tok of namesAndFigures(t)) {
      if (/^\d/.test(tok) || notAName(tok)) continue;
      /* (a word of a name found above is judged with it) */
      if (known.some((f) => f.loose.includes(` ${foldName(tok)} `))) continue;
      if (!loose.includes(tok)) loose.push(tok);
    }
    return { text: t, refs, all, loose };
  };
}
/* the names one text gives (nameReader) that another loses */
function namesLostIn(a, b) {
  const lost = a.refs.filter((x) => !x.refs.some((r) => b.all.has(r))).map((x) => x.words);
  /* two lost side by side are one name: "Iron Covenant" */
  for (const tok of a.loose) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${esc(tok)}(?![\\p{L}\\p{N}])`, 'u').test(b.text)) continue;
    const last = lost.length ? lost[lost.length - 1] : '';
    if (last && new RegExp(`(?<![\\p{L}\\p{N}])${esc(last)}\\s+${esc(tok)}(?![\\p{L}\\p{N}])`, 'u').test(a.text)) lost[lost.length - 1] = `${last} ${tok}`;
    else lost.push(tok);
  }
  return lost;
}
const listOf = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/* WHAT AN ENTRY'S WORDS WRITTEN WHOLE AGAIN WOULD LOSE (2.12.40, the audit: his own 71-word entry came back as the
 * answer's 15 words — "seven of nine", "a black rose", "the Iron Covenant" gone), held as a summary is held to its names
 * and figures: no name or figure it gave is lost — but the words his newer word changes, looked up where they stand in it
 * (`changing`), may go. Its sentences are held one by one (mergeEntry). '' when it keeps them; else what it would lose. */
function whatItLoses(old, next, novel, self, changing = []) {
  const read = nameReader(novel, self);
  const have = figuresOf(next);
  const figures = [...figuresOf(old)].filter(([v]) => !have.has(v)).map(([, said]) => said);
  const freeText = changing.join('\n');
  const lost = [...namesLostIn(read(old), read(next)), ...figures].filter((w) => !freeText || !stands(freeText, w));
  return lost.length ? `what it wrote would have lost ${listOf(lost.map((w) => `“${w}”`))}` : '';
}

/* ONE KEEP RULE FOR HIS WORDS, AT EVERY LENGTH (2.12.40, the review: his grammar put right read as his words thinned, so
 * his entry was doubled; a short entry, and his line, were thinned with no check at all). Judged by telling words, as the
 * cards are (archivist.js tellingWords — words of four letters or more, a "'s" let go), each kept where the other has it:
 * as written, with its grammar put right ("meet", "meets"; "house", "houses"; "carry", "carried"), or with a slip of
 * spelling in a long word, as names.js nearName reads one in a name ("chapel", "chappel"). A sentence holds his — and may
 * stand in its place — when it keeps every telling word of his, every figure and name, and his "not" as he had it ("she is
 * not a vampire" is never held by "she is a vampire", nor "silver hair" by "black hair": a word he wrote is never let go,
 * nor a fact of his changed unsaid); one with no telling word, only word for word. A sentence says much of another
 * (`HOLD`, the cards' three-fifths against being thinned, archivist.js thins) when it keeps three-fifths of its telling
 * words: one that only says again what a sentence of his says is never added beside it. */
const HOLD = 0.6;
const NEGATION = /(?<![\p{L}\p{N}'’])(?:not|no|never|none|nothing|nobody|nowhere|neither|nor|cannot|without|\p{L}+n['’]t)(?![\p{L}\p{N}])/iu;
const tellingOf = (t) => archivist.tellingWords(t);
/* the same word with its grammar put right: one is the other with an ending of number or tense ("s", "es", "ed", "ing";
 * "d" after an "e": "rule", "ruled"), its "e" or "y" let go, or its last letter doubled ("stop", "stopped") */
const ENDINGS = new Set(['s', 'es', 'ed', 'ing']);
function regular(a, b) {
  const [x, y] = a.length <= b.length ? [a, b] : [b, a];
  if (y.length - x.length > 4) return false;
  if (x.endsWith('e') && y === `${x}d`) return true;
  for (const base of new Set([x, x.replace(/e$/, ''), x.replace(/y$/, 'i')])) {
    if (base.length < 3 || !y.startsWith(base)) continue;
    const rest = y.slice(base.length);
    if (ENDINGS.has(rest) || (rest.length > 2 && rest[0] === base[base.length - 1] && ENDINGS.has(rest.slice(1)))) return true;
  }
  return false;
}
function keptIn(word, set) {
  if (set.has(word)) return true;
  for (const w of set) {
    if (regular(word, w)) return true;
    if (word.length >= 6 && w.length >= 6 && Math.abs(w.length - word.length) <= 2 && nearName(word, w)) return true;
  }
  return false;
}
/* how much of some telling words another set holds (all, when there are none) */
function shareIn(words, set) {
  if (!words.size) return 1;
  let kept = 0;
  for (const w of words) if (keptIn(w, set)) kept += 1;
  return kept / words.size;
}
const prepared = (read) => (text) => { const t = String(text || '').trim(); return { text: t, tell: tellingOf(t), names: read(t), figures: figuresOf(t), neg: NEGATION.test(t) }; };
const bare = (t) => String(t || '').trim().replace(/[.!?…]+["”’)\]]*$/, '');
/* whether o keeps every word of s that tells — its telling words, its figures, its names (both prepared) */
function keepsAll(o, s) {
  if (shareIn(s.tell, o.tell) < 1) return false;
  for (const v of s.figures.keys()) if (!o.figures.has(v)) return false;
  return !namesLostIn(s.names, o.names).length;
}
/* whether sentence o holds sentence s, and may stand in its place */
function holds(o, s) {
  if (!s.text) return true;
  if (s.neg !== o.neg) return false;
  if (!s.tell.size) return stands(o.text, bare(s.text));
  return keepsAll(o, s);
}
/* whether some words say much the same as others: the same words, or each holding three-fifths of the other's */
function sameWords(a, b) {
  if (foldName(a) === foldName(b)) return true;
  const x = tellingOf(a);
  const y = tellingOf(b);
  return x.size > 0 && y.size > 0 && shareIn(x, y) >= HOLD && shareIn(y, x) >= HOLD;
}

/* his words piece by piece — each sentence with the space after it, a paragraph's break with it — so they are put back
 * together as they stood */
const SENTENCE_GAP = /(?<=[.!?…])\s+|[^\S\n]*\n\s*/g;
function piecesOf(text) {
  const t = String(text || '');
  const out = [];
  let from = 0;
  for (const m of t.matchAll(SENTENCE_GAP)) {
    out.push({ s: t.slice(from, m.index), sep: m[0], start: from, end: m.index });
    from = m.index + m[0].length;
  }
  if (from < t.length) out.push({ s: t.slice(from), sep: '', start: from, end: t.length });
  return out;
}
const sentencesOf = (text) => piecesOf(text).map((p) => p.s.trim()).filter(Boolean);
/* the pieces put back together: one taken out leaves its paragraph's break */
function joinPieces(pieces) {
  let out = '';
  let gap = '';
  for (const p of pieces) {
    const s = String(p.s || '').trim();
    if (!s) { if (/\n/.test(p.sep) && !/\n/.test(gap)) gap = p.sep; continue; }
    out += (out ? gap || ' ' : '') + s;
    gap = p.sep;
  }
  return out;
}
/* where a quote stands in his words, {start, end}: whole words, as the look-up found them — one shortened with "…" from
 * its first part to its last — else the first sentence that holds it (the look-up lets capitals and marks go); or null */
function spanOf(text, quote) {
  const t = String(text || '');
  const parts = String(quote || '').split(ELLIPSIS).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
  if (!parts.length) return null;
  let from = 0;
  let start = -1;
  let end = -1;
  for (const part of parts) {
    const [hit] = findIn(t.slice(from), part, { words: true, whole: true, max: 1 });
    if (!hit) { start = -1; break; }
    if (start < 0) start = from + hit.start;
    end = from + hit.end;
    from = end;
  }
  if (start >= 0) return { start, end };
  const p = piecesOf(t).find((x) => x.s.trim() && stands(x.s, quote));
  return p ? { start: p.start, end: p.end } : null;
}
/* HIS OWN WORDS FOR HIS NEWER WORD, where the answer has no sentence that carries it: its quote of his words where they
 * stand in what he said, else the sentence he said that holds most of them, else as it quoted them */
function hisOwnFor(mine, words) {
  const m = String(mine || '').trim();
  const said = String(words || '');
  if (m && stands(said, m)) return m;
  const tell = tellingOf(m);
  let best = '';
  let most = 0;
  for (const s of sentencesOf(said)) {
    const t = tellingOf(s);
    const n = [...tell].filter((w) => keptIn(w, t)).length;
    if (n > most) { most = n; best = s; }
  }
  return best || m;
}
/* his words put in place of some of his (a span of `text`): the stop after them stays theirs, never two, and a sentence
 * they open opens with a capital */
function putIn(text, span, words) {
  const before = text.slice(0, span.start);
  const after = text.slice(span.end);
  let w = String(words || '').trim();
  if (/^[.!?…]/.test(after)) w = w.replace(/[.!?…]+$/, '');
  if (!before.trim() || /[.!?…]\s*$/.test(before)) w = w.charAt(0).toUpperCase() + w.slice(1);
  return `${before}${w}${after}`;
}
/* THE ANSWER'S SENTENCE THAT CARRIES HIS NEWER WORD (2.12.40, the review): the one with most of the words his newer word
 * brings that his earlier words lack — or, where it brings none (a "not" put in or taken out), most of his newer word,
 * its "not" as his newer word has it and none of the words it changes; null when none does */
function carrierOf(c, theirs, prep) {
  const mine = prep(c.mine);
  const was = prep(c.was);
  const fresh = new Set([...mine.tell].filter((w) => !keptIn(w, was.tell)));
  let best = null;
  let top = 0;
  for (const o of theirs) {
    const f = [...fresh].filter((w) => keptIn(w, o.tell)).length;
    const m = [...mine.tell].filter((w) => keptIn(w, o.tell)).length;
    const ok = fresh.size ? f > 0 : mine.tell.size > 0 && o.neg === mine.neg && m / mine.tell.size >= HOLD && !stands(o.text, c.was);
    if (ok && f * 1000 + m > top) { best = o; top = f * 1000 + m; }
  }
  return best;
}
const sentencesWord = (n) => (n === 1 ? 'a sentence' : `${numberWords(n).toLowerCase()} sentences`);

/* HIS ENTRY, WITH WHAT THE ANSWER WROTE (2.12.40, the review — his grammar put right read as thinned, so his entry was
 * doubled; his newer word was added beside the very words it changes, so his entry said both). One rule for every length:
 * - the words his newer word changes (`changes`, each looked up where it stands in his entry) are put right in place —
 *   with the answer's sentence that carries it (carrierOf) where that sentence keeps the rest of what his said, else with
 *   his own words in place of those words — never left beside it;
 * - each other sentence of his stands, or the answer's sentence that holds its words (holds) stands in its place — put
 *   right, said better, with more;
 * - then the answer's sentences that bring telling words his entry lacks — never his earlier words his newer word
 *   changes, and never one that only says again what a sentence of his says, unless it alone carries words of his own
 *   from the box.
 * The answer's words stand as it wrote them only when it read his entry whole (`seenWhole`), holds every sentence of his
 * but those his newer word changes, loses no name or figure, carries every change, and keeps none of the words they
 * change. {text, whole, why, again, added, put: [{c, now}]} */
function mergeEntry({ had, offered, novel, self, changes = [], words = '', seenWhole = false }) {
  const prep = prepared(nameReader(novel, self));
  const pieces = piecesOf(had);
  const his = pieces.map((p) => (p.s.trim() ? prep(p.s) : null));
  const theirs = sentencesOf(offered).map(prep);
  const out = pieces.map((p) => ({ ...p }));
  const placed = new Set();
  const carriers = new Set();
  const freed = new Set();
  const put = [];
  for (const c of changes) {
    const span = spanOf(had, c.was);
    if (!span) continue;
    const at = pieces.map((p, i) => i).filter((i) => pieces[i].s.trim() && pieces[i].end > span.start && pieces[i].start < span.end);
    if (!at.length) continue;
    /* (two of his newer words in one sentence of his: the second put right in what stands there now — said after it in
     * his own words where the sentence put there no longer has the words it changes, nor says it) */
    if (at.some((i) => freed.has(i))) {
      const i = at.find((k) => freed.has(k) && out[k].s.trim());
      if (i === undefined) continue;
      const sp = spanOf(out[i].s, c.was);
      const says = !sp && Boolean(carrierOf(c, [prep(out[i].s)], prep));
      if (sp) out[i].s = putIn(out[i].s, sp, hisOwnFor(c.mine, words));
      else if (!says) out[i].s = `${out[i].s.trim()} ${putIn('', { start: 0, end: 0 }, hisOwnFor(c.mine, words)).replace(/([^.!?…])$/, '$1.')}`;
      put.push({ c, now: out[i].s.trim(), carried: says });
      continue;
    }
    const from = pieces[at[0]].start;
    const to = pieces[at[at.length - 1]].end;
    const o = carrierOf(c, theirs, prep);
    /* (the rest of his sentence: every word of it that tells kept by the sentence that carries it) */
    const rest = prep(`${had.slice(from, span.start)} ${had.slice(span.end, to)}`);
    const keeps = Boolean(o) && keepsAll(o, rest);
    let now;
    if (keeps) {
      const j = theirs.indexOf(o);
      now = placed.has(j) ? '' : o.text;
      placed.add(j);
      carriers.add(j);
    } else now = putIn(had.slice(from, to), { start: span.start - from, end: span.end - from }, hisOwnFor(c.mine, words)).trim();
    out[at[0]].s = now;
    for (const i of at.slice(1)) out[i].s = '';
    for (const i of at) freed.add(i);
    put.push({ c, now: now || o.text, carried: keeps });
  }
  /* each other sentence of his: said again in the answer's words — the one closest to his of those that hold it — or as
   * it stands */
  const sayer = new Map();
  his.forEach((s, i) => {
    if (!s || freed.has(i)) return;
    let best = -1;
    let top = -1;
    theirs.forEach((o, j) => {
      if (!holds(o, s)) return;
      const sh = shareIn(o.tell, s.tell);
      if (sh > top) { best = j; top = sh; }
    });
    if (best >= 0) sayer.set(i, best);
  });
  let again = 0;
  for (const [i, j] of sayer) {
    /* (one sentence of the answer holding two of his: said once, where the first of them stood) */
    if (placed.has(j)) { out[i].s = ''; continue; }
    if (theirs[j].text !== his[i].text) again += 1;
    out[i].s = theirs[j].text;
    placed.add(j);
  }
  let text = joinPieces(out);
  /* what the answer brings that his entry lacks */
  const box = tellingOf(words);
  const nowTell = tellingOf(text);
  const nowSentences = sentencesOf(text).map(prep);
  const fresh = [];
  theirs.forEach((o, j) => {
    if (placed.has(j)) return;
    if (changes.some((c) => stands(o.text, c.was))) return;
    if (!o.tell.size) { if (!stands(`${text}\n${fresh.join('\n')}`, bare(o.text))) fresh.push(o.text); return; }
    const brings = [...o.tell].filter((w) => !keptIn(w, nowTell));
    if (!brings.length) return;
    const says = nowSentences.some((s) => shareIn(o.tell, s.tell) >= HOLD);
    if (says && !brings.some((w) => keptIn(w, box))) return;
    fresh.push(o.text);
    nowSentences.push(o);
    for (const w of o.tell) nowTell.add(w);
  });
  if (fresh.length) text = [text, fresh.join(' ')].filter(Boolean).join('\n\n');
  const unheld = his.filter((s, i) => s && !freed.has(i) && !sayer.has(i)).length;
  const oldGone = changes.every((c) => theirs.every((o, j) => carriers.has(j) || !stands(o.text, c.was)));
  const carried = put.every((p) => p.carried) && put.length === changes.length;
  const loses = offered ? whatItLoses(had, offered, novel, self, changes.map((c) => c.was)) : '';
  const whole = Boolean(seenWhole && offered && !unheld && oldGone && carried && !loses);
  const why = whole ? '' : !offered ? '' : !seenWhole ? 'it had not read your entry whole'
    : loses || (unheld ? `what it wrote left out ${sentencesWord(unheld)} of yours`
      : !oldGone ? 'what it wrote still said the words your newer word changes'
        : !carried ? 'what it wrote did not say your newer word' : '');
  return { text: whole ? offered : text, whole, why, again, added: fresh.length, put: put.map(({ c, now }) => ({ c, now })) };
}

/* HIS LINE (2.12.40, the review: his line "An elder vampire, mother of the twins, sworn enemy of the Covenant" went as
 * "An elder vampire"): kept, unless his newer word quotes it — then the answer's line in its place where it no longer says
 * those words, else his line with them put right with his own words — or the answer's line holds its words (holds).
 * '' when his stands as it is. */
function lineFor(cur, said, changes, words, novel) {
  const mine = String(cur.line || '').trim();
  if (!mine) return said;
  const quoted = changes.filter((c) => stands(mine, c.was));
  if (quoted.length) {
    if (said && !quoted.some((c) => stands(said, c.was))) return said;
    let l = mine;
    for (const c of quoted) { const sp = spanOf(l, c.was); if (sp) l = putIn(l, sp, hisOwnFor(c.mine, words)); }
    return l === mine ? '' : l;
  }
  if (!said || said === mine) return '';
  const prep = prepared(nameReader(novel, cur));
  return holds(prep(said), prep(mine)) ? said : '';
}

/* The entries, put in through the partner's own entry change — his, each with what came of it. An entry already his is
 * put together with what the answer wrote (mergeEntry: written as the answer wrote it only when it read his entry whole
 * and keeps all it said), his newer word put in place of the words it changes; his line kept unless the answer's holds it
 * (lineFor). Its kind stays as he set it: the request never says it. Each says whether it went in as the answer wrote it
 * (`notAsWritten`): the answer's verdict stands only when every one did. `put`: what stands now in place of the words
 * each change of his entries quoted. */
function putEntries(novelId, entries, seen, changes = [], words = '') {
  const added = [];
  const refused = [];
  const put = [];
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
    let why = '';
    let asWritten = true;
    let joined = null;
    let puts = [];
    if (!cur) {
      op.kind = kindSaid(e.kind) || 'lore';
      if (said) op.line = said;
      if (offered) op.text = offered;
    } else {
      const had = String(cur.text || '').trim();
      const mine = changes.filter((c) => c.kind === 'entry' && c.entryId === cur.id);
      const inText = mine.filter((c) => stands(had, c.was));
      if (!had) { if (offered) { op.text = offered; how = 'whole'; } }
      else if ((offered && offered !== had) || inText.length) {
        const m = mergeEntry({ had, offered, novel, self: cur, changes: inText, words, seenWhole: seen.has(cur.id) && seen.get(cur.id) === String(cur.text || '') });
        if (m.text !== had) op.text = m.text;
        how = m.whole ? 'whole' : 'merged';
        why = m.why;
        asWritten = m.whole;
        if (!m.whole) joined = { again: m.again, added: m.added };
        puts = m.put;
      }
      const ln = lineFor(cur, said, mine, words, novel);
      if (ln && ln !== String(cur.line || '').trim()) op.line = ln;
      if (said && (ln || String(cur.line || '').trim()) !== said) asWritten = false;
    }
    const ch = makeChange(novelId, op, { entryBy: 'you' });
    if (ch.status === 'made') {
      const entryId = (ch.undo && ch.undo.id) || '';
      added.push({ name, entryId, was: Boolean(cur), status: 'made', change: ch, ...(how ? { how } : {}), ...(why ? { addedWhy: why } : {}), ...(joined ? { joined } : {}), ...(asWritten ? {} : { notAsWritten: true }) });
      for (const p of puts) put.push({ ...p, entryId });
    } else refused.push({ name, why: line(ch.said, 300) });
  }
  return { added, refused, put };
}

/* AN ENTRY THAT RESTS ON WHAT A PAGE SAYS OTHERWISE (2.12.40, the review): one whose words hold words of his a page says
 * otherwise (a conflict's "mine") — a sentence of it holding three-fifths of their telling words, or them word for word.
 * The conflict it rests on, or null. */
function restsOn(e, conflicts) {
  const words = [line(e.line, 400), String(e.text || '')].filter(Boolean).join('\n');
  const tells = sentencesOf(words).map(tellingOf);
  for (const c of conflicts) {
    const m = tellingOf(c.mine);
    if (m.size ? tells.some((t) => shareIn(m, t) >= HOLD) : stands(words, c.mine)) return c;
  }
  return null;
}
/* whether words of his went into an entry put in: the name of the first whose words hold them, or '' */
function carriedBy(mine, added, novelId) {
  const m = tellingOf(mine);
  if (!m.size) return '';
  const es = entriesOf(store.peek('novel', novelId));
  for (const a of added) {
    if (a.status !== 'made') continue;
    const e = es.find((x) => x.id === a.entryId);
    if (e && sentencesOf(entryWords(e)).some((s) => shareIn(m, tellingOf(s)) >= HOLD)) return a.name;
  }
  return '';
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

/* WHAT CAME OF IT, in the app's own plain words — said in place of the answer's verdict wherever the look-ups part from
 * it, or an entry did not go in as the answer wrote it (2.12.40, the audit: "the book gives grey" stood over a row the
 * app had set aside). Said to him on the row; told again in his own voice when the row rides with what he says next
 * (`his` — 2.12.40, the review: "your bibliography", "your word" went back to his partner as though it were the
 * partner's). Every count from what the row holds, so a row kept from before says it the same way. */
const many = (n, one, more) => (n === 1 ? `One ${one}` : `${numberWords(n)} ${more}`);
const KEPT_WHAT = { about: 'what it’s about', style: 'how it reads' };
function plainAccount(r, { his = false } = {}) {
  const your = his ? 'my' : 'your';
  const out = [];
  /* (every entry it put in went in, whatever was done with it since) */
  const made = (r.added || []).map((a) => a.name);
  const mended = (r.book || []).filter((b) => b.status !== 'refused').map((b) => b.label);
  if (made.length) out.push(`${listOf(made)} went into ${your} bibliography.`);
  if (mended.length) out.push(`${listOf(mended)} now say${mended.length === 1 ? 's' : ''} what ${your} newer words say.`);
  if (!made.length && !mended.length) out.push('Nothing went in.');
  const held = (r.refused || []).filter((x) => x.held).length + (r.held || []).length;
  if (held) out.push(`${many(held, 'entry waits', 'entries wait')} with what the book says otherwise.`);
  const unsaid = (r.changes || []).filter((c) => c.in === false).length;
  if (unsaid) out.push(`${many(unsaid, `newer word of ${his ? 'mine' : 'yours'} did`, `newer words of ${his ? 'mine' : 'yours'} did`)} not go in.`);
  const waits = (r.conflicts || []).length + (r.cannot || []).length;
  if (waits) out.push(`${many(waits, 'thing waits', 'things wait')} for ${your} word.`);
  const refused = (r.refused || []).filter((x) => !x.held).length;
  if (refused) out.push(`${many(refused, 'entry was', 'entries were')} not put in.`);
  if (Array.isArray(r.aside) && r.aside.length) out.push(`${many(r.aside.length, 'thing it named quoted', 'things it named quoted')} words that stand nowhere in the book or ${your} own words.`);
  const again = (r.keptAgain || []).map((k) => KEPT_WHAT[k]).filter(Boolean);
  if (again.length) out.push(`What the helper keeps of ${listOf(again)} is written again from the book.`);
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
  /* what was said before in Quick add, the newest few (never the one being asked) — what came of each, where the app
   * said it, told again in his own voice (2.12.40, the review) */
  const earlier = quickLog(novel).filter((r) => r.state === 'done').slice(-4).map((r) => (r.verdictBy === 'app' ? { ...r, verdict: plainAccount(r, { his: true }) } : r));
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
    /* the entries of the first answer held to what a page says otherwise (restsOn), and the rows they are held to */
    let hold = [];
    let holdTo = [];
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
        /* ITS ROWS LOOKED UP AS THE FIRST ANSWER'S ARE (2.12.40, the review: only one whose "mine" read the same, folded,
         * was kept — a page it quoted for his words said a little otherwise went unsaid): words a page holds say the book
         * says otherwise, and the row set aside that they answer is let go; words that stand only in his own earlier words
         * are his newer word; words quoted from nowhere are set aside */
        for (const c of second.conflicts) {
          if (read.conflicts.some((x) => x.passageId === c.passageId && foldName(x.against) === foldName(c.against))) continue;
          const i = read.aside.findIndex((x) => sameWords(x.mine, c.mine));
          if (i >= 0) read.aside.splice(i, 1);
          read.conflicts.push({ ...c, said: 'again' });
        }
        for (const c of second.changes) if (!read.changes.some((x) => foldName(x.was) === foldName(c.was))) read.changes.push({ ...c, said: 'again' });
        for (const x of second.aside) if (!read.aside.some((y) => sameWords(y.mine, x.mine))) read.aside.push({ ...x, said: 'again' });
        /* his book's own words written again for his newer word */
        for (const w of Array.isArray(obj2.changes) ? obj2.changes.filter(isObj) : []) {
          const c = read.changes.find((x) => x.kind === 'about' && !x.now && foldName(x.was) === foldName(w.was));
          if (c && line(w.now, 4000)) c.now = line(w.now, 4000);
        }
        /* MERGED BY NAME (2.12.40, the review: the second answer's entries took the place of all the first's, so the good
         * ones it did not give again were let go without a word): the second answer's entry wins where it gives one; the
         * first's others go in as it wrote them — unless they rest on what a page says otherwise */
        const keyOf = (e) => { const n = line(e.name, 200); const m = entryNamed(entriesOf(novel), n).entry; return m ? `e:${m.id}` : `n:${nameKey(n)}`; };
        const byKey = new Map(second.entries.map((e) => [keyOf(e), e]));
        const all = [];
        const firsts = [];
        for (const e of read.entries) {
          const theirs = byKey.get(keyOf(e));
          if (!theirs) { all.push(e); firsts.push(e); } else if (!all.includes(theirs)) all.push(theirs);
        }
        for (const e of second.entries) if (!all.includes(e)) all.push(e);
        entries = all.slice(0, ENTRIES_MOST);
        over = [...new Set([...all.slice(ENTRIES_MOST).map((e) => line(e.name, 200)), ...read.over, ...second.over])];
        hold = firsts;
        holdTo = read.conflicts;
      } else {
        again = 'failed';
        /* (asked to write them again without what a page says otherwise, it gave no answer: those resting on it wait) */
        hold = entries;
        holdTo = read.conflicts.filter((c) => c.said === 'changes');
      }
    }
    /* ENTRIES RESTING ON WHAT A PAGE SAYS OTHERWISE — rows it did not know waited when it wrote them — are held back, each
     * said under Not put in with why (2.12.40, the review) */
    const heldBack = [];
    for (const e of holdTo.length ? hold : []) {
      const c = restsOn(e, holdTo);
      if (!c) continue;
      heldBack.push({ name: line(e.name, 200), why: `it says what ${c.label} says otherwise (“${c.mine}”)${again === 'failed' ? ' — asked to write it again without that, it gave no answer that could be read' : ''} — it waits for your word`, held: true });
      entries = entries.filter((x) => x !== e);
    }
    const shown = { conflicts: read.conflicts, changes: read.changes, cannot: read.cannot, aside: read.aside, questions: read.questions, ...(again ? { again } : {}) };
    const { added, refused, put } = putEntries(novelId, entries, seen, read.changes, t);
    refused.unshift(...heldBack);
    partial = { ...shown, added, refused };
    for (const name of over) refused.push({ name, why: `only ${MOST_WORDS} go in from one answer — send it in a Quick add of its own` });
    const book = mendBook(novelId, read.changes);
    partial.book = book;
    /* WHETHER EACH NEWER WORD OF HIS WENT IN (2.12.40, the review: one no entry carried was listed as though it had): in
     * his entry, with what stands now in place of the words it changed; in What it's about, by its own row; else carried
     * by an entry that went in */
    const nowEntries = entriesOf(store.peek('novel', novelId));
    read.changes.forEach((c, i) => {
      if (c.kind === 'about') { c.in = book.some((b) => b.at === i && b.status === 'made'); return; }
      const p = put.find((x) => x.c === c);
      if (p) { c.in = true; c.put = line(p.now, 1600); return; }
      const e = c.kind === 'entry' ? nowEntries.find((x) => x.id === c.entryId) : null;
      c.in = Boolean(e && added.some((a) => a.entryId === c.entryId) && !stands(entryWords(e), c.was)) || Boolean(carriedBy(c.mine, added, novelId));
    });
    /* each row set aside: whether his words went in after all — never said so unchecked */
    for (const x of read.aside) { const by = carriedBy(x.mine, added, novelId); if (by) x.in = by; }
    /* WORDS THAT STAND ONLY IN WHAT THE HELPER KEEPS of what the book is about, or of how it reads: it writes that again
     * from the book (archivist.js keepAgain — its own "Write it from the book again"), and the row says so (2.12.40, the
     * review: a change quoting it was set aside, and nothing put it right) */
    const keeps = [...new Set(read.aside.map((x) => x.kept).filter(Boolean))].filter((k) => keptByHelper(store.peek('novel', novelId) || {}).includes(k));
    const helper = keeps.length ? connFor(store.peek('house', 'house') || {}, 'helper') : null;
    const keptAgain = helper ? keeps : [];
    /* its verdict only where the look-ups bear it out, every entry went in as it wrote it and none was let go, his book's
     * words were put right as it said, and every newer word of his went in */
    const agreed = !fix && !refused.length && book.every((b) => b.status === 'made') && added.every((a) => !a.notAsWritten) && read.changes.every((c) => c.in) && Boolean(read.verdict);
    const facts = { ...shown, added, refused, book, ...(keptAgain.length ? { keptAgain } : {}), ...(keeps.length && !helper ? { keptNone: true } : {}) };
    const done = settle({ state: 'done', ...facts, verdict: agreed ? read.verdict : plainAccount(facts), verdictBy: agreed ? 'partner' : 'app' });
    for (const k of keptAgain) archivist.keepAgain(novelId, k);
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
