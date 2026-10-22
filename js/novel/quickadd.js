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
 * his kept, or the answer's that holds every word of it, his "not" with what it says no to, and brings nothing his words
 * do not say, in its place; the words his newer word changes put right where they stand (its own words for them, or the
 * answer's sentence that carries it — with neither, asked once more and still none, nothing is put in for it, and the
 * row says so, with Ask again: his words are never spliced in); and only what brings words of his newer word his entry
 * lacks added — never one that would say both a sentence of his and another way of it — and written as the answer wrote
 * it only when it went whole in the request, keeps all it said and every break of his paragraphs (mergeEntry); his line
 * held to the same rule (lineFor). Harm first: what would write broken or contradictory words waits under Not put in,
 * with Ask again, and nothing of his is lost. Nothing goes in that says what a page says otherwise, however the answer
 * sorted it (heldBy) — unless, answering the Quick add before, he said his word stands over that page. A change to his own
 * What it's about is put in it; words that stand only in what the helper keeps of it are written again from the book.
 * What he said before in Quick add rides with what he says next, in his own voice, so "keep mine" is an answer. A changed
 * entry under a card of the notes has the notes checked against it (archivist.js auditDue). */

import * as store from '../store.js';
import { ask } from '../model/call.js';
import { wireOf, contextOf } from '../model/providers.js';
import { assemble, partnerReply } from './context.js';
import { connFor } from './writer.js';
import { picked, passageNumbers, chapterLabel, premisesOf, renameCount, renamesSince } from './shape.js';
import { quickAddRequest, quickAgainRequest, keptByHelper, PREMISE_ROOM, JSON_AGAIN, JSON_CUT } from './prompts.js';
import { findFirstObject, findLastObject } from './jsonutil.js';
import { findIn } from './search.js';
import { namesAndFigures, foldedText, foldName, nearName, stopEndsNoSentence, renameIn } from './names.js';
import { entriesOf, entriesNamed, entryFor, otherKindSaid, entryWords, kindSaid, kindOf, nameForms, makeFinder, formKey } from './bibliography.js';
import { makeChange, undoChange, madeGone } from './changes.js';
import * as archivist from './archivist.js';
import { newId, estimateTokens, numberWords, truthOf } from '../util.js';

/* the rows kept (his words and what came of them), and how many of the newest that put something in keep their Undo */
export const QUICK_KEEP = 12;
export const UNDO_KEEP = 4;
export const ENTRIES_MOST = 30;
/* a row being asked beats while it asks; one silent this long had its window close before it answered */
const BEAT_MS = 30000;
export const GONE_MS = 2 * 60 * 1000;

const running = new Map();   /* novelId -> {ctl, rowId} */
/* A ROW'S TIME: the phone's (store.phoneNow), never before the newest this page gave or the log holds while the two are
 * within a few seconds (each answer gives the phone's time to the second, so it steps back by up to a second now and then:
 * 2.12.41, the third review — Clear's Undo, which puts rows back in order of their time, put a newer one before an older);
 * a step back past that is the phone's clock set otherwise, and is followed */
const STEP_BACK = 5000;
let lastAt = 0;
function rowTime(log) {
  const now = store.phoneNow();
  const newest = Math.max(lastAt, ...log.map((r) => Number(r.at) || 0));
  return newest >= now && newest - now < STEP_BACK ? newest + 1 : now;
}
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
 * by tabsNow); asked in another, by its beat, written and judged in the phone's time (store.phoneNow — the one rule the
 * writer's page and a scene's reply keep: writer.js repairStale, talk.js repairStaleTurns): silent past GONE_MS of it,
 * its window closed — judged at once (2.12.41, the review: judged by how long this page had watched it stand still, a
 * dead row from another browser read "being checked in another window" for two minutes after every load, Clear passed
 * it by, and it was never kept as stopped) */
let tabsHere = null;         /* the tabs open in this browser, as last asked (null: not asked yet, or it cannot say) */
export async function tabsNow() { tabsHere = await store.liveTabs(); return tabsHere; }
const ownBrowser = (r) => Boolean(r && r.browser && store.BROWSER && r.browser === store.BROWSER && r.tab);
const beatOf = (r) => r.beat || r.at || 0;
export function askingWhere(novelId, r) {
  if (!r || r.state !== 'asking') return '';
  if (quickAsking(novelId) === r.id) return 'here';
  if (ownBrowser(r)) {
    /* (this very page asked it and asks it no more: never "elsewhere") */
    if (r.tab === store.CLIENT) return 'gone';
    if (tabsHere) return tabsHere.has(r.tab) ? 'elsewhere' : 'gone';
  }
  return store.phoneNow() - beatOf(r) > GONE_MS ? 'gone' : 'elsewhere';
}
/* A ROW WHOSE WINDOW CLOSED BEFORE IT ANSWERED, PUT RIGHT: kept as stopped, so every window says so at once and Clear
 * takes it as any other (2.12.40, the review: the app puts right what it can tell) — whichever browser sees it so first
 * (2.12.41, the review: only this browser's own were). How many were put right. */
export function settleGone(novelId) {
  const ids = new Set(quickLog(store.peek('novel', novelId)).filter((r) => askingWhere(novelId, r) === 'gone').map((r) => r.id));
  if (!ids.size) return 0;
  store.change('novel', novelId, (n) => {
    n.quick = quickLog(n).map((r) => {
      /* (judged again over the copy it lands on: a beat that came meanwhile keeps it being asked) */
      if (!ids.has(r.id) || askingWhere(novelId, r) !== 'gone') return r;
      const { beat: _b, tab: _t, browser: _w, ...rest } = r;
      return { ...rest, state: 'stopped', closed: true };
    });
  }, { now: true });
  return ids.size;
}
/* how long, in the phone's time, before a row asked elsewhere would read as gone — null where its tab's lock says it,
 * to be asked again (a closed tab's lock can outlast it by a moment) */
export function goneIn(r) {
  if (ownBrowser(r) && tabsHere) return null;
  return GONE_MS - (store.phoneNow() - beatOf(r));
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
/* the row being asked, beating — in the phone's time, as it is judged (askingWhere) */
const beatStep = (id) => (n) => { const r = quickLog(n).find((x) => x.id === id); if (r && r.state === 'asking') r.beat = store.phoneNow(); };

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
    /* (one it says he ruled on — his word standing over that page — kept so, to be held to what he was shown: quickAdd) */
    if (at.kind === 'page') { out.conflicts.push({ mine: line(r.mine), against: line(quote), why: line(r.why), label: at.label, chapterId: at.chapterId, passageId: at.passageId, said, ...(said === 'conflicts' && truthOf(r.overruled) === true ? { overruled: true } : {}) }); return; }
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
 * (`aside`), and his newer word with nothing to carry it: a change no entry it wrote carries (`changes`), and his own
 * words it changes with no words given that hold for them — What it's about, how it reads, where it's headed, or an entry
 * of his whose change neither its words for it nor any sentence it wrote carries (`rewrite`, asked for "now"); and what
 * it wrote for an entry of his that brings his newer words but cannot go in (`again`): a sentence of his said again in
 * other words, one saying "not" otherwise than his words do, one that would say both a sentence of his and another way
 * of it with no change listed for it (2.12.41, the third review: those were left to him — rule 15). Each judged as
 * putting it in will judge it (dryRun — 2.12.41, the review: a premise's change counted lone only where no entry came at
 * all, so one the answer's other entries never carried was never asked again) */
function toSetRight(read, novel, finder, words) {
  const conflicts = read.conflicts.filter((c) => c.said !== 'conflicts');
  const moved = read.changes.filter((c) => c.said !== 'changes');
  /* (What it's about: asked once more where its words for it would not go in, as putting them in judges it — bookPlacing,
   * 2.12.41, the fourth review — but where its quote cannot be put right here at all) */
  const about = read.changes.filter((c) => c.kind === 'about' && BOOK_FIELD[c.field] && ((p) => !p.here && (p.noWords || p.couldNot))(bookPlacing(c, novel, finder, words)));
  const dry = dryRun(read, novel, finder, words);
  const lone = read.changes.filter((c) => c.said === 'changes' && c.kind !== 'about' && !(c.kind === 'entry' ? dry.put.has(c) : read.entries.some((e) => carriesWords(answerWords(e), c.mine))));
  const changes = [...moved, ...lone.filter((c) => c.kind !== 'entry')];
  const rewrite = [...about, ...lone.filter((c) => c.kind === 'entry')];
  if (!conflicts.length && !changes.length && !read.aside.length && !rewrite.length && !dry.again.length) return null;
  return { conflicts, changes, aside: read.aside, rewrite, again: dry.again };
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
 * counting as the same — never the entry's own), and names written with a capital mid-sentence. The finder made once for
 * every text one answer holds, and kept while the names are the same (2.12.41, the review: it was made again for every
 * entry, line and check — some ninety times an answer, three quarters of a second of the page's thread for thirty
 * entries on a long book) */
const FINDERS = new Map();
function finderFor(novel) {
  const es = entriesOf(novel);
  const cards = cardsOf(novel);
  const key = JSON.stringify([es.map((e) => [e.id, e.name, e.aka || [], e.kind]), NOTE_KINDS.map((k) => cards[k].map((c) => [c.id, c.name, c.aka || []]))]);
  if (FINDERS.has(key)) return FINDERS.get(key);
  const forms = nameForms(es, cards);
  const finder = forms.length ? makeFinder(forms) : null;
  if (FINDERS.size > 8) FINDERS.clear();
  FINDERS.set(key, finder);
  return finder;
}
function nameReader(finder, self) {
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
function whatItLoses(old, next, read, changing = []) {
  const have = figuresOf(next);
  const figures = [...figuresOf(old)].filter(([v]) => !have.has(v)).map(([, said]) => said);
  const freeText = changing.join('\n');
  const lost = [...namesLostIn(read(old), read(next)), ...figures].filter((w) => !freeText || !stands(freeText, w));
  return lost.length ? `what it wrote would have lost ${listOf(lost.map((w) => `“${w}”`))}` : '';
}

/* ONE KEEP RULE FOR HIS WORDS, AT EVERY LENGTH (2.12.40, the review: his grammar put right read as his words thinned, so
 * his entry was doubled; a short entry, and his line, were thinned with no check at all). Read word by word — in small
 * letters, a hyphened word in its parts ("raven-black" is raven and black — 2.12.41, the review: "raven-black hair" never
 * read as black hair), a "'s" let go; the words that tell are those of four letters or more, as the cards count them
 * (archivist.js tellingWords), and a short word that tells too ("red", "son", "fly" — never a little word: "the", "was").
 * Each is kept where the other has it: as written, with its grammar put right ("meet", "meets"; "house", "houses";
 * "carry", "carried"), or with a slip of spelling in a long word, as names.js nearName reads one in a name ("chapel",
 * "chappel"). A sentence holds his — and may stand in its place — when it keeps every word of his that tells, every figure
 * and name, and says "not" to each word as his does ("she is not a vampire" is never held by "she is a vampire", nor
 * "silver hair" by "black hair": a word he wrote is never let go, nor a fact of his changed unsaid); one with none of
 * them, only word for word. And nothing new goes into an entry of his that his newer words do not bring (2.12.41, the
 * review: a sentence of his said again in other words was added beside his — "drowned cathedral", "sunken cathedral"):
 * a sentence standing in his place brings no word his entry and his words in this Quick add do not say (`unbacked`), and
 * a sentence added brings words of his newer word his entry lacks (`brings`). */
const HOLD = 0.6;
/* a sentence holding half of a sentence of his words that tell, with words neither his entry nor his newer words give, is
 * his said again in other words ("every new moon … the sunken cathedral" for his "beneath the drowned cathedral every new
 * moon") — never put in beside his */
const AGAIN = 0.5;
/* little words that never tell what a sentence says: kept by the keep rule all the same where they are long (a sentence
 * that drops "with" or "never" may say another thing), never counted as what a sentence brings or carries */
const LITTLE = new Set(('the and but for nor yet not are was has had did does can may its his her him she who how why any all one too own our out off per via '
  + 'let got get you they them their theirs there here these those this that with from into onto over upon have been were will would could should '
  + 'shall might must also only then than when what where which while about after before again ever very much more most some such each every other '
  + 'being done your yours mine hers ours itself herself himself themselves myself yourself just even still both either neither whom whose within '
  + 'without along among across around against between toward towards because though although unless until since never none nothing nobody nowhere '
  + 'cannot whoever whatever').split(' '));
/* A NUMBER IN WORDS IS A FIGURE, READ AS ONE ONLY (2.12.41, the third review: "twelve" was a word as well as the figure
 * 12, so his "twelve" against an entry's "12" was a word the entry lost — a page's "eleven" let "12 members" in, and his
 * sentence held against the same figure in digits stood beside it): never a word too, so "twelve" and "12" are one figure
 * to every rule here (figuresOf) — "one" alone stays a word ("one of them"). And "as well" is a little word, as "too" is
 * (2.12.41, the third review: "Mara keeps bees as well" read as his sentence said again in other words) */
const NUMBER_WORD = new Set([...Object.keys(SMALL_NUMBER).filter((w) => w !== 'one'), 'hundred', 'thousand', 'million']);
function wordsOf(t) {
  const out = [];
  let before = '';
  for (const w of String(t || '').toLowerCase().split(/[^\p{L}\p{N}'’]+/u)) {
    const x = w.replace(/^['’]+|['’]+$/g, '').replace(/['’]s$/, '');
    const was = before;
    if (x) before = x;
    if (!/\p{L}/u.test(x) || NUMBER_WORD.has(x) || (x === 'well' && was === 'as')) continue;
    out.push(x);
  }
  return out;
}
const tellOf = (t) => new Set(wordsOf(t).filter((w) => w.length >= 4));
const shortOf = (t) => new Set(wordsOf(t).filter((w) => w.length === 3 && !LITTLE.has(w)));
/* what some words say: their words that tell, the short ones too, little words let go */
const saysOf = (t) => new Set(wordsOf(t).filter((w) => w.length >= 3 && !LITTLE.has(w)));
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
/* how much of some words another set holds (all, when there are none) */
function shareIn(words, set) {
  if (!words.size) return 1;
  let kept = 0;
  for (const w of words) if (keptIn(w, set)) kept += 1;
  return kept / words.size;
}
/* WHAT EACH "NOT" SAYS NO TO (2.12.41, the review: the "not" rule asked only whether a sentence held one at all — "no
 * vampire, and she is no saint" became "a vampire, and she is no saint"; the third review: each was tied to the one word
 * after it, so "never feeds on children" and "feeds on sailors, never on children" said no to two things, "nothing but
 * the sun" said no to "but", and a "not" ran on past a quote into the next sentence): each governs its clause — up to a
 * stop, a comma, a colon, a semicolon, a dash, a quote, or "but" or "except" — every word that tells after it ("never feeds
 * on children": feeds, children; "no longer the heir": heir), else the one just before it ("fears nothing": fears) —
 * [{words}] in order, words [] where it governs none. "Instead of" and "rather than" are a "not" over what follows them
 * (2.12.41, the fourth review: "Make Corvin her brother instead of her steward" said no to nothing) */
const NEG = /^(?:not|no|never|none|nothing|nobody|nowhere|neither|nor|cannot|without|\p{L}+n['’]t)$/u;
const NEG_TWO = { instead: 'of', rather: 'than' };
const PAST_NOT = new Set(('a an the to be is are was were been being am have has had do does did can could will would shall should may might must ever '
  + 'even yet still once again really truly quite very always just only any much more so too at all one of in on for with her his their its my your our '
  + 'this that these those he she it they we you i longer other such single own real true further less').split(' '));
const NOT_ENDS = new Set(['but', 'except']);
const notTells = (w) => w.split('-').map((x) => x.replace(/['’]s$/, '')).filter((x) => x.length >= 3 && !LITTLE.has(x) && !PAST_NOT.has(x) && !NEG.test(x) && !NUMBER_WORD.has(x));
function negsOf(t) {
  const out = [];
  for (const clause of String(t || '').toLowerCase().split(/[.!?…,;:—–()"“”«»]+/u)) {
    const ws = clause.split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/^['’-]+|['’-]+$/g, '')).filter(Boolean);
    let part = [];
    const parts = [part];
    for (const w of ws) { if (NOT_ENDS.has(w)) { part = []; parts.push(part); } else part.push(w); }
    for (const p of parts) {
      p.forEach((w, i) => {
        const two = Object.hasOwn(NEG_TWO, w) && p[i + 1] === NEG_TWO[w];
        if (!two && !NEG.test(w)) return;
        const after = p.slice(i + (two ? 2 : 1)).flatMap(notTells);
        out.push({ words: after.length ? after : two ? [] : p.slice(0, i).flatMap(notTells).slice(-1) });
      });
    }
  }
  return out;
}
const saysNoTo = (x, w) => x.negs.some((n) => n.words.some((g) => g === w || regular(g, w)));
/* WHETHER SOME WORDS SAY "NOT" AS THE WORDS THEY ANSWER TO DO — each "not" of theirs judged by the last word it says no
 * to that both give ("feeds on sailors, never on children" says no to children as "never feeds on children" does), as the
 * first of `refs` that gives that word has it, and a "not" of theirs to words none of `refs` gives is never theirs to say;
 * a "not" of `refs` judged only where they give every word it says no to (2.12.41, the fourth review: "Emilia drinks the
 * blood of animals" was read as taking back his "does not drink human blood" — it never says "human") */
function negsAgree(R, refs) {
  for (const n of R.negs) {
    if (!n.words.length) continue;
    const given = n.words.filter((w) => refs.some((x) => keptIn(w, x.words)));
    if (!given.length) return false;
    const k = given[given.length - 1];
    if (!saysNoTo(refs.find((x) => keptIn(k, x.words)), k)) return false;
  }
  for (const x of refs) {
    for (const n of x.negs) {
      if (!n.words.length || !n.words.every((w) => keptIn(w, R.words))) continue;
      const k = n.words[n.words.length - 1];
      if (saysNoTo(R, k) !== saysNoTo(refs.find((y) => keptIn(k, y.words)), k)) return false;
    }
  }
  return true;
}
const prepared = (read) => (text) => {
  const t = String(text || '').trim();
  return { text: t, words: new Set(wordsOf(t)), tell: tellOf(t), short: shortOf(t), says: saysOf(t), names: read(t), figures: figuresOf(t), negs: negsOf(t) };
};
const bare = (t) => String(t || '').trim().replace(/[.!?…]+["”’)\]]*$/, '');
/* whether o keeps every word of s that tells — its telling words, its short ones, its figures, its names (both prepared) */
function keepsAll(o, s) {
  for (const w of s.tell) if (!keptIn(w, o.tell)) return false;
  for (const w of s.short) if (!keptIn(w, o.short) && !keptIn(w, o.tell)) return false;
  for (const v of s.figures.keys()) if (!o.figures.has(v)) return false;
  return !namesLostIn(s.names, o.names).length;
}
/* whether sentence o holds sentence s, and may stand in its place: every word of it kept, its "not" with each word as s
 * has it — a word s never gives, as his words in this Quick add have it (`box`) */
function holds(o, s, box = null) {
  if (!s.text) return true;
  if (!negsAgree(o, box ? [s, box] : [s])) return false;
  if (!s.tell.size && !s.short.size) return stands(o.text, bare(s.text));
  return keepsAll(o, s);
}
/* whether some words say much the same as others: the same words, or each holding three-fifths of the other's */
function sameWords(a, b) {
  if (foldName(a) === foldName(b)) return true;
  const x = tellOf(a);
  const y = tellOf(b);
  return x.size > 0 && y.size > 0 && shareIn(x, y) >= HOLD && shareIn(y, x) >= HOLD;
}
/* what the keep rule holds an entry of his to, in one answer: his entry's words (`entry`, with its own names, `own`, and
 * his line, `line`), his words in this Quick add (`box`, and sentence by sentence, `said`), and the reader of names made
 * once for the answer; whose it is (`ref`), its kind, and the words his entry calls its own one by (`pron`: "she", "he",
 * "they" — the pronouns opening a sentence of his entry) */
function entryCtx(cur, finder, words) {
  const read = nameReader(finder, cur);
  const prep = prepared(read);
  return { prep, read, words: String(words || ''), box: prep(words), said: sentencesOf(words).map(prep), entry: prep([cur.name, ...(cur.aka || []), cur.line, cur.text].filter(Boolean).join('\n')),
    own: new Set(wordsOf([cur.name, ...(cur.aka || [])].join(' '))), line: String(cur.line || '').trim() ? prep(cur.line) : null,
    ref: `e:${cur.id}`, kind: kindOf(cur.kind), pron: pronounsOf(String(cur.text || ''), kindOf(cur.kind)) };
}
/* …and What it's about, how it reads or where it's headed, as his own words a newer word of his changes */
function bookCtx(novel, field, finder, words) {
  const read = nameReader(finder, null);
  const prep = prepared(read);
  return { prep, read, words: String(words || ''), box: prep(words), said: sentencesOf(words).map(prep), entry: prep(String((novel && novel[BOOK_FIELD[field]]) || '')), own: new Set(), line: null,
    ref: '', kind: '', pron: new Set() };
}
/* the words an entry calls its own one by: the pronouns opening its sentences ("She keeps a raven" — she, her, hers); every
 * one of a person's where none opens one; "it" only for what is no person (2.12.41, the fourth review: "Its eyes are
 * green", of her raven, was read as hers) */
const PRONOUNS = { she: ['she', 'her', 'hers', 'herself'], he: ['he', 'him', 'his', 'himself'], they: ['they', 'them', 'their', 'theirs', 'themselves'], it: ['it', 'its', 'itself'] };
const PRONOUN_OF = Object.fromEntries(Object.entries(PRONOUNS).flatMap(([k, ws]) => ws.map((w) => [w, k])));
function pronounsOf(text, kind) {
  const opening = new Set();
  for (const s of sentencesOf(text)) { const w = ((s.match(/^["“‘'(]*(\p{L}+)/u) || [])[1] || '').toLowerCase(); if (Object.hasOwn(PRONOUN_OF, w)) opening.add(PRONOUN_OF[w]); }
  if (kind === 'people') opening.delete('it');
  const keys = opening.size ? [...opening] : kind === 'people' ? ['she', 'he', 'they'] : ['it', 'they'];
  return new Set(keys.flatMap((k) => PRONOUNS[k]));
}
/* the words some words would bring into his entry that neither the words they stand in place of (`base`), his entry, nor
 * his words in this Quick add say — a little word is no word brought; a figure is */
function unbacked(o, base, ctx) {
  const out = [];
  for (const w of o.tell) if (!LITTLE.has(w) && !keptIn(w, base.tell) && !keptIn(w, ctx.entry.tell) && !keptIn(w, ctx.box.tell)) out.push(w);
  for (const [v, said] of o.figures) if (!base.figures.has(v) && !ctx.entry.figures.has(v) && !ctx.box.figures.has(v)) out.push(said);
  return out;
}
/* what his newer word says that his entry lacks: its words, its figures — {words, figures, mine}; never a word that only
 * marks it as newer ("now", "actually": "Emilia drinks blood now" was carried by no words of its partner's without
 * "now", found in this round's checks) */
const NEWER = new Set(['now', 'actually', 'anymore']);
function freshOf(c, ctx) {
  const mine = ctx.prep(c.mine);
  return { mine, words: [...mine.says].filter((w) => !NEWER.has(w) && !keptIn(w, ctx.entry.says)), figures: [...mine.figures.keys()].filter((v) => !ctx.entry.figures.has(v)) };
}
/* WHETHER SOME WORDS CARRY HIS NEWER WORD: words of it his entry lacks — or, where it brings none (a "not" put in or taken
 * out), all it says but the entry's own name, with "not" as his newer word has it and not as the words it changes — and
 * never still the words it changes */
function carries(o, c, ctx) {
  if (stands(o.text, c.was)) return false;
  const f = freshOf(c, ctx);
  if (f.words.length || f.figures.length) return f.words.some((w) => keptIn(w, o.says)) || f.figures.some((v) => o.figures.has(v));
  const all = [...f.mine.says].filter((w) => !ctx.own.has(w) && !NEWER.has(w));
  return all.length > 0 && all.every((w) => keptIn(w, o.says)) && negsAgree(o, [f.mine]) && !negsAgree(o, [ctx.prep(c.was)]);
}
/* whether some words put in place of the words his newer word changes keep every name and figure of those that his newer
 * word does not change — one of them let go only where his newer word brings one of its own — and every "not" of them:
 * over every word it says no to, but where his newer words say those words with no "not" (2.12.41, the fourth review: a
 * change the app's own ask again invited put "Emilia drinks the blood of animals." in place of his "Emilia does not
 * drink human blood.") */
function wasKept(o, c, ctx) {
  const was = ctx.prep(c.was);
  const f = freshOf(c, ctx);
  if (!f.figures.length && [...was.figures.keys()].some((v) => !o.figures.has(v))) return false;
  if (namesLostIn(was.names, o.names).length && !namesLostIn(f.mine.names, ctx.entry.names).length) return false;
  for (const n of was.negs) {
    if (!n.words.length) continue;
    if (n.words.every((w) => keptIn(w, o.words) && saysNoTo(o, w))) continue;
    const said = [f.mine, ctx.box].some((x) => n.words.every((w) => keptIn(w, x.words)) && !n.words.some((w) => saysNoTo(x, w)));
    if (!said) return false;
  }
  return true;
}
/* HIS PARTNER'S WORDS FOR HIS NEWER WORD, IN PLACE OF THE WORDS IT CHANGES ("now" — 2.12.41, the review), where they hold
 * to the keep rule: they carry it, say those words no longer, keep every name and figure of them his newer word does not
 * change, say "not" as he does, and bring nothing his entry, those words and his own words do not say — '' where not */
function nowFor(c, ctx) {
  const now = String(c.now || '').trim();
  if (!now) return '';
  const R = ctx.prep(now);
  const was = ctx.prep(c.was);
  if (!carries(R, c, ctx) || !wasKept(R, c, ctx)) return '';
  if (!negsAgree(R, [ctx.prep(c.mine), was, ctx.box]) || unbacked(R, was, ctx).length) return '';
  return now;
}

/* his words piece by piece — each sentence with the space after it, a paragraph's break with it — so they are put back
 * together as they stood; a stop inside a closing quote or bracket ends its sentence too (2.12.41, the third review:
 * "…the Covenant: “Never again.” She is feared." was one sentence, and "She is feared." was lost); a title's short form
 * or an initial ends none (names.js stopEndsNoSentence — 2.12.41, the fourth review: "Dr. Halloway treats the hunters"
 * was cut after "Dr.", and the lone "Dr." let go) */
const SENTENCE_GAP = /(?<=[.!?…]["”’»)\]]*)\s+|[^\S\n]*\n\s*/g;
function piecesOf(text) {
  const t = String(text || '');
  const out = [];
  let from = 0;
  for (const m of t.matchAll(SENTENCE_GAP)) {
    if (!m[0].includes('\n') && stopEndsNoSentence(t.slice(from, m.index), t.slice(m.index + m[0].length))) continue;
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
/* HIS OWN WORDS FOR HIS NEWER WORD: its quote of his words where they stand in what he said, else the sentence he said
 * that holds most of them, else as it quoted them */
function hisOwnFor(mine, words) {
  const m = String(mine || '').trim();
  const said = String(words || '');
  if (m && stands(said, m)) return m;
  const tell = tellOf(m);
  let best = '';
  let most = 0;
  for (const s of sentencesOf(said)) {
    const t = tellOf(s);
    const n = [...tell].filter((w) => keptIn(w, t)).length;
    if (n > most) { most = n; best = s; }
  }
  return best || m;
}
/* HIS PARTNER'S WORDS FOR HIS NEWER WORD, PUT IN BY THEIR SHAPE — WHOLE SENTENCES MEET WHOLE SENTENCES (2.12.41, the
 * fourth review: "Her eyes are green. and cold.", "Emilia has Emilia has green eyes.", "An elder vampire, Emilia is now an
 * ally of the Covenant., mother of twins." — its words went in wherever its quote stood, whatever their size). Where the
 * words they change stand in `text` (`span`), the same at every place they go in — his entry, his line, What it's about:
 * - in place of those words, where they read there: within one sentence of his, never saying the words beside them a
 *   second time ("Emilia has" and "has green eyes"), a whole sentence of their own only where those words open his ("Her
 *   eyes are grey" → "Her eyes are green and cold."), their stop let go where his sentence goes on after them, their
 *   capital where it goes on before them (a name keeps its own), and a stop given where those words ended his sentence;
 * - else, where they are whole sentences, in place of the sentence of his that holds those words — only where they keep
 *   every other word of it that tells, its names and its figures (keepsAll), and say "not" as it does;
 * - else nowhere: null — never pasted, never doubled.
 * {from, to, s}: the words of `text` from `from` to `to` are to stand as `s` */
const WHOLE = /^["“‘'(]*[\p{Lu}\p{N}][\s\S]*[.!?…]["”’»)\]]*$/u;
const STOP_END = /[.!?…]+(["”’»)\]]*)$/;
const wordRun = (t) => (String(t || '').toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) || []);
/* whether the first word of some words is a name: one of the entry's own, a name the book knows, or one written with a
 * capital in the middle of a sentence of his */
function nameFirst(w, ctx) {
  const m = /^["“‘'(]*(\p{Lu}[\p{L}'’-]*)/u.exec(w);
  if (!m) return false;
  const word = m[1];
  if (ctx.own.has(word.toLowerCase().replace(/['’]s$/, ''))) return true;
  if (ctx.read(w).refs.some((x) => foldName(w).startsWith(foldName(x.words)))) return true;
  const mid = new RegExp(`[\\p{L}\\p{N},;:]\\s+${esc(word)}(?![\\p{L}])`, 'u');
  return mid.test(ctx.entry.text) || mid.test(ctx.words);
}
function placeIn(text, span, now, ctx) {
  const t = String(text || '');
  const N = String(now || '').trim();
  if (!N || !span) return null;
  const at = piecesOf(t).filter((p) => p.s.trim() && p.end > span.start && p.start < span.end);
  if (!at.length) return null;
  const S0 = at[0].start + (at[0].s.length - at[0].s.trimStart().length);
  const S1 = at[at.length - 1].end;
  const before = t.slice(S0, span.start);
  const after = t.slice(span.end, S1);
  const ns = piecesOf(N).filter((p) => p.s.trim());
  const whole = ns.length > 0 && ns.every((p) => WHOLE.test(p.s.trim()));
  const opens = !/[\p{L}\p{N}]/u.test(before);
  /* in place of those words */
  if (at.length === 1 && ns.length === 1 && (!whole || opens)) {
    let w = N;
    const goesOn = /[\p{L}\p{N}]/u.test(after) || /^\s*[.!?…]/.test(after);
    if (goesOn) w = w.replace(/[.!?…]+$/, '');
    else if (!/[\p{L}\p{N}]/u.test(after)) {
      const end = STOP_END.exec(t.slice(span.start, span.end));
      if (end && !/[.!?…]["”’»)\]]*$/.test(w)) w = `${w}${end[0]}`;
    }
    if (opens) w = w.replace(/^(["“‘'(]*)(\p{Ll})/u, (_, q, x) => q + x.toUpperCase());
    else if (!nameFirst(w, ctx)) w = w.replace(/^(["“‘'(]*)(\p{Lu})(?!\p{Lu})/u, (_, q, x) => q + x.toLowerCase());
    const b = wordRun(before);
    const a = wordRun(after);
    const n = wordRun(w);
    const said = (xs, ys) => [1, 2, 3].some((k) => xs.length >= k && ys.length >= k && xs.slice(-k).join(' ') === ys.slice(0, k).join(' '));
    /* (one sentence of words in, one of his around them — the stop and the capital set above are the only joins: a stop
     * inside them or his, followed by a small letter, is a short form's — "e.g. emerald", "Dr. " — never a break) */
    if (!said(b, n) && !said(n, a)) return { from: span.start, to: span.end, s: w };
  }
  /* whole sentences in place of the sentence of his that holds those words */
  if (whole) {
    const rest = ctx.prep(`${before} ${after}`);
    const R = ctx.prep(N);
    if (keepsAll(R, rest) && negsAgree(R, [rest])) return { from: S0, to: S1, s: N };
  }
  return null;
}
/* a placing laid into the words it was made for */
const laid = (text, p) => `${text.slice(0, p.from)}${p.s}${text.slice(p.to)}`;
/* (2.12.41, the third review: no words of his are ever spliced into his entry, his line or What it's about in place of
 * the words his newer word changes — his words in Quick add are often an order ("Make her eyes green"), and the splice
 * wrote "Her eyes are Make her eyes green and cold" and "Emilia not trust the Covenant", with "as you said it" on the
 * row. Where his partner gives no words that hold, asked once more and still none, nothing is put in for that newer word:
 * the row says it did not go in, with Ask again.) */

/* WHAT A SENTENCE TELLS OF EACH THING IN IT — read where a page says otherwise, for the page's own words on what they part
 * on (heldBy; 2.12.41, the third review — "would say both" reads slotsOf since the fourth): the words that tell what a
 * thing is — right before it, after
 * "her", a name's "'s", "has" or "with" ("has grey eyes", "her long grey hair", "Lilith's grey eyes", "has a black
 * cloak"), or after it past "is", "are", "was", "were" ("her eyes are grey") — and a figure counted before it ("twelve
 * members"); with whose it is: a name's "'s" before it, else whom its clause names last before it, else whom its
 * sentence opens with ('' — the entry's own, a pronoun, or no one named). Read word by word, it tells only where it can
 * be told: a doing word is no thing ("her hair falls to her waist"), nor a lone article an opening ("the council meets")
 * — what it cannot tell it lets be. [{thing, owner, words: Set, figures: Set, verb, counted}] — `verb`, `counted`: told
 * after an article that follows a doing word, "is" or "has" ("wears a black cloak": 'wears'; "is a loyal steward":
 * 'be'), or right after the doing word that follows whom it tells of ("Emilia wears black robes": 'wears'), so one of a
 * thing among others may be meant */
/* (what opens words telling of a thing before it: whose it is — "her", a name's "'s" — or "has", "with"; an article only
 * after those, or after a doing word or "is" — "has a black cloak", "wears a black cloak", "is a loyal steward" (2.12.41,
 * the third review's round: "Emilia wears a red cloak" went in beside his "Emilia wears a black cloak") — never alone,
 * nor after a name: "the council meets", "the guard meets" tell of no council's kind, "gave Corvin a red cloak" of no
 * cloak of hers) */
const WHOSE = new Set(['her', 'his', 'their', 'its', 'my', 'your', 'our']);
const HAS_WITH = new Set(['has', 'have', 'had', 'with']);
const ARTICLE = new Set(['a', 'an', 'the', 'some']);
/* (what may come after a thing so told — its sentence's end, "and", "who", "is", "too", or what it does ("her twin sons
 * guard") — never a little word that follows a doing word: "her hair falls to …" tells nothing of what kind "falls" is;
 * "too", "also", "again", "still" end what tells of it: "Emilia has green eyes too" said both beside his grey, found
 * re-reading this round) */
const AFTER_THING = new Set(['and', 'or', 'but', 'who', 'which', 'that', 'like', 'as', 'with', 'while', 'when', 'is', 'are', 'was', 'were', 'too', 'also', 'again', 'still']);
const TO_BE = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'am']);
const PAST_TO_BE = new Set(['a', 'an', 'the', 'now', 'still', 'always', 'once', 'very', 'so', 'quite', 'rather', 'all', 'too', 'as', 'and']);
const SELF = new Set(['she', 'he', 'they', 'it', 'her', 'his', 'their', 'its', 'hers', 'theirs', 'them', 'him']);
const OFTEN = new Set(['often', 'always', 'usually', 'sometimes', 'rarely', 'seldom', 'mostly', 'once', 'now', 'already']);
function valuesOf(text, own0) {
  /* (an entry's own name, never its "The": "The Order" — the) */
  const own = new Set([...own0].filter((w) => !ARTICLE.has(w)));
  let words0 = 0;
  const toks = [...String(text || '').matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|[,;:—–()"“”«».!?…]/gu)].map((m) => {
    const raw = m[0];
    if (/^[,;:—–()"“”«».!?…]$/.test(raw)) return { stop: true };
    const low = raw.toLowerCase();
    const poss = /['’]s$/.test(low);
    const base = low.replace(/['’]s$/, '');
    const parts = base.split(/[-'’]/).filter(Boolean);
    const fig = /^\d+$/.test(base) ? Number(base) : base !== 'one' && parts.every((p) => Object.hasOwn(SMALL_NUMBER, p)) ? parts.reduce((s, p) => s + SMALL_NUMBER[p], 0) : null;
    /* (a capital opening the sentence tells nothing: "Grey eyes…") */
    const named = parts.some((p) => own.has(p)) || (words0 > 0 && /^\p{Lu}/u.test(raw) && !notAName(raw));
    words0 += 1;
    const little = fig === null && parts.every((p) => p.length < 3 || LITTLE.has(p) || NUMBER_WORD.has(p));
    return { base, parts, poss, fig, named, little, cap: /^\p{Lu}/u.test(raw) && !notAName(raw), self: own.has(base) || SELF.has(base) };
  });
  /* (a name's "'s" says whose — never what a thing is) */
  const isValue = (t) => Boolean(t) && !t.stop && !t.named && !t.poss && (t.fig !== null || (!t.little && !NEG.test(t.base)));
  const out = [];
  toks.forEach((t, i) => {
    if (t.stop || t.little || t.named || t.poss || t.fig !== null || NEG.test(t.base)) return;
    const words = new Set();
    const figures = new Set();
    const take = (v) => { for (const p of v.parts) if (p.length >= 3 && !LITTLE.has(p)) words.add(p); };
    /* before it: a count of it always ("keeps two black ravens" — a count opens the words for it); words only where whose
     * it is, "has" or "with" opens them, or "and" in a list "has" opened ("has grey eyes and long black hair") — and only
     * where its sentence ends, or goes on with "and", "who", "like", after it */
    let j = i - 1;
    const run = [];
    while (j >= 0 && run.length < 3 && isValue(toks[j])) { run.unshift(toks[j]); j--; if (run[0].fig !== null) break; }
    const lead = j >= 0 ? toks[j] : null;
    const before = j >= 1 ? toks[j - 1] : null;
    let listed = false;
    if (lead && (lead.base === 'and' || lead.base === 'or')) for (let q = j - 1; q >= 0 && !toks[q].stop; q--) if (HAS_WITH.has(toks[q].base)) { listed = true; break; }
    const next = toks[i + 1];
    const ends = !next || next.stop || AFTER_THING.has(next.base) || (!next.little && next.fig === null);
    const doing = (x) => Boolean(x) && !x.stop && !x.named && !x.poss && x.fig === null && !NEG.test(x.base) && (TO_BE.has(x.base) || HAS_WITH.has(x.base) || !x.little);
    const counted = Boolean(lead) && ARTICLE.has(lead.base) && doing(before);
    /* (a doing word right after whom it tells of, with words of the thing before it: "Emilia wears black robes", "she
     * keeps white ravens" — the first of them the doing word, an "often" or a word in "-ly" before it let go) */
    let k0 = 0;
    while (k0 < run.length && (OFTEN.has(run[k0].base) || /ly$/.test(run[k0].base))) k0 += 1;
    const said = run.slice(k0);
    const bare = !counted && ends && Boolean(lead) && (lead.self || lead.named) && !lead.poss && !WHOSE.has(lead.base) && said.length >= 2 && said.every((v) => v.fig === null);
    const verb = bare ? said[0].base : !counted ? '' : TO_BE.has(before.base) ? 'be' : HAS_WITH.has(before.base) ? 'has' : before.base;
    const opened = ends && Boolean(lead) && (lead.poss || WHOSE.has(lead.base) || HAS_WITH.has(lead.base) || listed || counted
      || (ARTICLE.has(lead.base) && Boolean(before) && WHOSE.has(before.base)));
    for (const v of run) { if (v.fig !== null) figures.add(v.fig); else if (bare ? said.indexOf(v) > 0 : opened || (run[0].fig !== null && ends)) take(v); }
    /* after it, past "is", "are", "was", "were": "her eyes are grey and cold" */
    if (toks[i + 1] && TO_BE.has(toks[i + 1].base)) {
      let k = i + 2;
      while (toks[k] && !toks[k].stop && PAST_TO_BE.has(toks[k].base)) k++;
      for (let n = 0; n < 2 && isValue(toks[k]); n++) {
        if (toks[k].fig !== null) figures.add(toks[k].fig); else take(toks[k]);
        k++;
        while (toks[k] && toks[k].base === 'and') k++;
      }
    }
    if (!words.size && !figures.size) return;
    /* whose: a name's "'s" right before what tells of it ("Lilith's eyes"); else whom its clause names last before it —
     * one of "her", or a name's "'s", with a word after it is that one's ("her raven has green eyes", "Emilia's raven"),
     * "she", "her" or the entry's own name alone are its own (''), another's name theirs; with none, the first word of it
     * that tells ("the guard has grey eyes") — and where its clause opens with no one ("…, has grey eyes"), whom its
     * sentence opens with ("Corvin, her steward, has grey eyes"). (The one named last, never a word opening the clause
     * before it: "At court Emilia wears a red cloak", "Beneath her hood her eyes are green" are hers — found re-reading
     * this round: "court" and "hood" were read as whose) */
    const end = run.length ? j : i - 1;
    const subjectIn = (from, to) => {
      let named = null;
      let plain = null;
      for (let q = from; q <= to; q++) {
        const x = toks[q];
        if (x.stop) continue;
        if (x.poss || WHOSE.has(x.base)) {
          const n = toks[q + 1];
          if (q + 1 <= to && n && !n.stop && !n.little && !n.poss) { named = n.self ? '' : n.base; q += 1; continue; }
          named = x.poss && !x.self ? x.base : '';
          continue;
        }
        if (x.self) named = '';
        else if (x.named) named = x.base;
        else if (!x.little && plain === null) plain = x.base;
      }
      return named !== null ? named : plain;
    };
    let owner = '';
    if (end >= 0 && toks[end].poss) owner = toks[end].self ? '' : toks[end].base;
    else {
      let s = end;
      while (s >= 0 && !toks[s].stop) s--;
      const inClause = subjectIn(s + 1, end);
      if (inClause !== null) owner = inClause;
      else {
        let e = 0;
        while (e < toks.length && !toks[e].stop) e++;
        const opening = e - 1 < end ? subjectIn(0, e - 1) : null;
        owner = opening || '';
      }
    }
    out.push({ thing: t.base, owner, words, figures, verb, counted: counted || bare });
  });
  return out;
}
/* one more of a thing, said so: "a white raven too", "also", "another", "a second", "as well", "more" */
const ONE_MORE = /\b(?:too|also|another|second|third|besides|more)\b|\bas well\b/i;

/* WHAT A SENTENCE TELLS OF ONE, WHERE ITS WORDS LEAVE NO DOUBT — all "would say both" holds back (2.12.41, the fourth
 * review: the guesses before it held her raven's green eyes, "Its eyes are green", "drinks the blood of animals" and "is
 * human" beside his, and let "lives in Prague", "five hundred years old" and "three brothers" in beside his "lives in
 * Venice", "three hundred" and "two brothers"). Each slot: whose it is (`who`: '' for the entry's own one — its name, the
 * pronoun its entry calls it by, that pronoun's "her" — else the name or word it is told of, "corvin", "raven"; never a
 * pronoun the entry does not use for it, "its" of a person), what is told (`head`: 'live' for where one lives, 'age', the
 * thing counted or coloured, "brothers", "eyes", "cloak"), by what (`verb`: 'has' for having it, being it, "her …";
 * else the doing word, "wears"), and its value (`kind`, `values`): a place, a figure ("three hundred" one figure), or
 * colour words; `more`: whether one more of a kind may be meant ("a red cloak", "black robes", a count, a place). Never
 * what "is a …" says, nor anything else: two of those may both be true. [{who, head, verb, kind, values: Set, more}] */
const COLOUR = new Set(('black white grey gray green blue red brown gold golden silver silvery yellow purple violet pink orange amber hazel auburn '
  + 'blond blonde ginger crimson scarlet ebony ivory copper bronze chestnut emerald sapphire ruby jade teal azure cobalt indigo maroon rust tawny '
  + 'sandy ashen ash').split(' '));
const TONE = new Set(['dark', 'fair', 'pale']);
const BODY = new Set(['eye', 'eyes', 'hair', 'skin', 'beard', 'fur', 'mane', 'scales', 'feathers']);
const SAME_COLOUR = { gray: 'grey', blonde: 'blond', golden: 'gold', silvery: 'silver', ashen: 'ash' };
const RESIDE = /^(?:liv(?:e|es|ed|ing)|dwell(?:s|ed|ing)?|dwelt|resid(?:e|es|ed|ing))$/;
const PLACE_AT = new Set(['in', 'at', 'on', 'near', 'by', 'beside', 'within', 'inside', 'outside', 'under', 'beneath', 'above', 'below']);
const PLACE_END = new Set(['and', 'with', 'where', 'who', 'which', 'that', 'since', 'for', 'until', 'while', 'when', 'but', 'or', 'as', 'now', 'again']);
const COPULA = new Set(['is', 'are', 'was', 'were', 'remains', 'remained']);
const HAS_FORM = new Set(['has', 'have', 'had']);
const AGE_UNIT = { year: 1, years: 1, century: 100, centuries: 100 };
const BEFORE_VERB = new Set([...OFTEN, 'also', 'still', 'too', 'only', 'just', 'even', 'ever']);
const numberWord = (p) => Object.hasOwn(SMALL_NUMBER, p) || p === 'hundred' || Object.hasOwn(BIG_NUMBER, p);
/* the figure some number words make, as figuresOf reads them: "three hundred" 300, "twenty-five" 25 — null for "one" alone */
function figureOfWords(ws) {
  if (ws.length === 1 && ws[0] === 'one') return null;
  let total = 0;
  let cur = 0;
  for (const w of ws) {
    if (Object.hasOwn(SMALL_NUMBER, w)) cur += SMALL_NUMBER[w];
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (Object.hasOwn(BIG_NUMBER, w)) { total += (cur || 1) * BIG_NUMBER[w]; cur = 0; }
  }
  return total + cur || null;
}
/* a sentence's words for slotsOf: each with its folded word (`base`), its parts, a name's "'s" (`poss`), whether it is a
 * word of the entry's own name (`own`), its capital, whether it opens a sentence, and a figure — a run of number words
 * one figure ("five hundred", "twenty-five") */
function slotTokens(text, ctx) {
  const toks = [];
  let opening = true;
  for (const m of String(text || '').matchAll(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*|[,;:—–()"“”«».!?…]/gu)) {
    const raw = m[0];
    if (!/[\p{L}\p{N}]/u.test(raw)) { toks.push({ stop: true, raw, base: raw, parts: [] }); if (/[.!?…]/.test(raw)) opening = true; continue; }
    const low = raw.toLowerCase();
    const base = low.replace(/['’]s$/, '');
    const parts = base.split(/[-'’]/).filter(Boolean);
    toks.push({ raw, base, parts, poss: /['’]s$/.test(low), own: !ARTICLE.has(base) && parts.some((p) => ctx.own.has(p)), cap: /^\p{Lu}/u.test(raw), opening,
      fig: /^\d+$/.test(base) ? Number(base) : null, num: parts.length > 0 && parts.every(numberWord), little: !/^\d+$/.test(base) && parts.every((p) => p.length < 3 || LITTLE.has(p)) });
    opening = false;
  }
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.num) { out.push(t); continue; }
    const run = [...t.parts];
    let j = i + 1;
    while (j < toks.length && (toks[j].num || (toks[j].base === 'and' && toks[j + 1] && toks[j + 1].num && /^(?:hundred|thousand|million)$/.test(run[run.length - 1])))) { if (toks[j].num) run.push(...toks[j].parts); j += 1; }
    out.push({ ...t, raw: toks.slice(i, j).map((x) => x.raw).join(' '), base: run.join(' '), fig: figureOfWords(run), num: false, little: false });
    i = j - 1;
  }
  return out;
}
const pronounKey = (base, ctx) => (ctx.pron.has(base) ? '' : `~${base}`);
/* whose a word before something says it is: '' the entry's own; a name's or a word's "'s" theirs; null where none */
function possKey(x, ctx) {
  if (!x || x.stop) return null;
  if (x.own) return '';
  if (Object.hasOwn(PRONOUN_OF, x.base)) return WHOSE.has(x.base) ? pronounKey(x.base, ctx) : null;
  return x.poss ? x.base : null;
}
/* whom the words before toks[i] tell of: past "also", "often" and the like, and past words set between commas ("Corvin, her
 * steward, has…") — '' the entry's own, a name, the word it is told of, or null */
function whoBefore(toks, i, ctx) {
  let q = i - 1;
  while (q >= 0 && !toks[q].stop && (BEFORE_VERB.has(toks[q].base) || /ly$/.test(toks[q].base))) q -= 1;
  if (q >= 0 && toks[q].raw === ',') {
    let p = q - 1;
    while (p >= 0 && !toks[p].stop) p -= 1;
    if (p < 0 || toks[p].raw !== ',') return null;
    q = p - 1;
  }
  const x = q >= 0 ? toks[q] : null;
  if (!x || x.stop || x.fig !== null || NEG.test(x.base)) return null;
  if (x.own) return '';
  if (Object.hasOwn(PRONOUN_OF, x.base)) return pronounKey(x.base, ctx);
  if (x.little) return null;
  return x.base;
}
/* the things told after toks[k] — "grey eyes and long black hair", "two brothers, Corvin and Dane", "a black cloak", "her
 * grey eyes": [{head, colours, figure, article}], each thing the word right after its last colour or figure; colours
 * with no thing of their own before "and" are the next thing's ("grey and green eyes": both the eyes' — read as two, its
 * grey was lost, and "Emilia has grey and green eyes" was held beside his "grey eyes", found in this round's checks) */
function thingsAfter(toks, k, max = 3) {
  const out = [];
  let q = k;
  let pending = [];
  while (out.length < max && toks[q] && !toks[q].stop) {
    let article = false;
    if (ARTICLE.has(toks[q].base)) { article = toks[q].base !== 'the'; q += 1; }
    if (toks[q] && !toks[q].stop && WHOSE.has(toks[q].base)) q += 1;
    const run = [];
    while (toks[q] && !toks[q].stop && run.length < 5 && !toks[q].little && !NEG.test(toks[q].base)) { run.push(toks[q]); q += 1; }
    let at = -1;
    run.forEach((t, n) => { if (t.fig !== null || t.parts.some((p) => COLOUR.has(p) || TONE.has(p))) at = n; });
    const head = at >= 0 ? run[at + 1] : null;
    if (head && head.fig === null && !head.cap) {
      const mods = run.slice(0, at + 1);
      out.push({ head: head.base, colours: [...pending, ...mods].flatMap((t) => t.parts.filter((p) => COLOUR.has(p) || (TONE.has(p) && BODY.has(head.base)))).map((p) => SAME_COLOUR[p] || p),
        figure: (mods.find((t) => t.fig !== null) || {}).fig ?? null, article });
      pending = [];
    } else pending = at >= 0 && at === run.length - 1 && run.every((t) => t.fig === null) ? [...pending, ...run] : [];
    if (!toks[q] || toks[q].stop || toks[q].base !== 'and') break;
    q += 1;
  }
  return out;
}
function slotsOf(text, ctx) {
  const toks = slotTokens(text, ctx);
  const out = [];
  const put = (who, head, verb, kind, values, more) => { if (who !== null && head && values.length) out.push({ who, head, verb, kind, values: new Set(values), more }); };
  const things = (who, verb, list) => {
    for (const x of list) {
      if (x.figure !== null) put(who, x.head, verb, 'figure', [x.figure], true);
      if (x.colours.length) put(who, x.head, verb, 'colour', x.colours, x.article || /s$/.test(x.head));
    }
  };
  toks.forEach((t, i) => {
    if (t.stop) return;
    /* "her eyes are grey", "Emilia's hair is black" */
    if (COPULA.has(t.base)) {
      let h = i - 1;
      while (h >= 0 && !toks[h].stop && toks[h].parts.some((p) => COLOUR.has(p) || TONE.has(p))) h -= 1;
      const head = toks[h];
      let p = h - 1;
      while (p >= 0 && !toks[p].stop && toks[p].parts.some((x) => COLOUR.has(x) || TONE.has(x))) p -= 1;
      const owner = head && !head.stop && !head.cap && p >= 0 ? possKey(toks[p], ctx) : null;
      if (owner !== null) {
        const said = [];
        for (let k = i + 1; toks[k] && !toks[k].stop && said.length < 3; k++) {
          const x = toks[k];
          if (PAST_TO_BE.has(x.base) || x.base === 'and') continue;
          const cs = x.parts.filter((y) => COLOUR.has(y) || (TONE.has(y) && BODY.has(head.base)));
          if (!cs.length) break;
          said.push(...cs.map((y) => SAME_COLOUR[y] || y));
        }
        put(owner, head.base, 'has', 'colour', said, false);
      }
      /* "Emilia is three hundred years old" */
      const n = toks[i + 1];
      if (n && n.fig !== null && toks[i + 2] && Object.hasOwn(AGE_UNIT, toks[i + 2].base) && toks[i + 3] && toks[i + 3].base === 'old') put(whoBefore(toks, i, ctx), 'age', 'has', 'figure', [n.fig * AGE_UNIT[toks[i + 2].base]], false);
      return;
    }
    /* "she keeps a raven with green eyes": the raven's — the word right before "with" */
    if (t.base === 'with') {
      const b = toks[i - 1];
      const who = !b || b.stop ? null : b.own ? '' : Object.hasOwn(PRONOUN_OF, b.base) || b.little ? null : b.base;
      things(who, 'has', thingsAfter(toks, i + 1));
      return;
    }
    /* "her two brothers", "Emilia's grey eyes" */
    if (WHOSE.has(t.base) || (t.poss && !t.little)) {
      const owner = possKey(t, ctx);
      if (owner !== null) things(owner, 'has', thingsAfter(toks, i + 1, 1));
    }
    if (t.little && !HAS_FORM.has(t.base)) return;
    const who = whoBefore(toks, i, ctx);
    if (who === null) return;
    /* "has grey eyes and long black hair", "has two brothers" */
    if (HAS_FORM.has(t.base)) { things(who, 'has', thingsAfter(toks, i + 1)); return; }
    /* "lives in Venice" */
    if (RESIDE.test(t.base) && toks[i + 1] && PLACE_AT.has(toks[i + 1].base)) {
      const place = [];
      for (let k = i + 2; toks[k] && !toks[k].stop && !PLACE_END.has(toks[k].base) && place.length < 4; k++) if (!toks[k].little) place.push(toks[k].base);
      put(who, 'live', 'live', 'place', place, true);
      return;
    }
    /* a doing word with a thing after it, counted or coloured: "wears a black cloak", "wears black robes", "keeps two
     * ravens", "commands twelve thralls" */
    const n = toks[i + 1];
    if (n && !n.stop && (ARTICLE.has(n.base) || n.fig !== null || n.parts.some((p) => COLOUR.has(p)))) things(who, t.base, thingsAfter(toks, i + 1, 1));
  });
  return out;
}
/* WHETHER AN ADDED SENTENCE WOULD SAY BOTH ONE OF HIS AND ANOTHER WAY OF IT, beyond doubt: the same one, the same thing
 * told the same way, another value — where she lives, her age, how many, what colour (slotsOf) — with no change listed
 * for it, whoever's words the new value is (a count his partner worked out is one: "a third brother" gave no "three").
 * Never one more of a kind said so ("keeps a white raven too", "also lives in Prague" — never of her eyes), a place it
 * names with a word of his ("the new mill" for "the old mill"), one telling his value too, or one his newer words still
 * give his value to ("Emilia has grey and green eyes") */
function saysBoth(o, s, ctx) {
  const mine = slotsOf(s.text, ctx);
  if (!mine.length) return false;
  const theirs = slotsOf(o.text, ctx);
  const more = ONE_MORE.test(o.text);
  for (const a of mine) {
    const same = theirs.filter((b) => b.who === a.who && b.kind === a.kind && (b.head === a.head || regular(b.head, a.head)) && (b.verb === a.verb || regular(b.verb, a.verb)));
    for (const b of same) {
      if (more && b.more && !BODY.has(b.head)) continue;
      const his = [...a.values].filter((v) => !b.values.has(v));
      const its = [...b.values].filter((v) => !a.values.has(v));
      if (!his.length || !its.length) continue;
      if (a.kind === 'place' && his.length < a.values.size) continue;
      if (theirs.some((x) => x !== b && x.who === a.who && x.kind === a.kind && (x.head === a.head || regular(x.head, a.head)) && his.every((v) => x.values.has(v)))) continue;
      if (his.some((v) => (a.kind === 'figure' ? ctx.box.figures.has(v) : keptIn(v, ctx.box.says) && !saysNoTo(ctx.box, v)))) continue;
      return true;
    }
  }
  return false;
}
/* WHAT HIS NEWER WORDS SAY "NOT" TO, STANDING IN HIS ENTRY (2.12.41, the fourth review: "Corvin is her cousin, not her
 * brother" left "Corvin is Emilia's brother" — and his line "Emilia's brother." — beside the cousin it added; "no longer
 * lives in Venice" left "Emilia lives in Venice"): a sentence of his about the entry's own one, or his line, that says
 * with no "not" every word a "not" of his newer words says no to ("not her brother", "no longer lives in Venice",
 * "instead of her steward"), told the same way — the word before them one of those words, "is", or none ("Corvin is
 * Emilia's younger brother", "Emilia's brother."; never "Corvin hunts vampires" for "not a vampire") — where the sentence
 * of his newer words holding that "not" names this entry. That sentence of his newer words, or null */
function deniedBy(s, ctx, { isLine = false } = {}) {
  if (!ctx.ref || !ctx.said) return null;
  for (const b of ctx.said) {
    if (!b.negs.length || !(b.names.all.has(ctx.ref) || [...b.words].some((w) => ctx.own.has(w)))) continue;
    for (const n of b.negs) {
      if (!n.words.length || !n.words.every((w) => keptIn(w, s.words)) || n.words.some((w) => saysNoTo(s, w))) continue;
      if (!isLine && subjectOfSentence(s.text, ctx) !== '') continue;
      if (!toldSameWay(s.text, n.words, ctx)) continue;
      return b;
    }
  }
  return null;
}
/* whom a sentence is about: whom it opens with, past words before a comma that open it ("In winter, she…") — '' the
 * entry's own; "Her brother Dane…", "Emilia's brother…" the brother's */
function subjectOfSentence(text, ctx) {
  const toks = slotTokens(text, ctx);
  let q = 0;
  const comma = toks.findIndex((t) => t.raw === ',');
  if (comma > 0 && comma <= 6 && toks[0] && (PLACE_AT.has(toks[0].base) || toks[0].little || /ly$/.test(toks[0].base)) && !Object.hasOwn(PRONOUN_OF, toks[0].base) && !toks[0].own) q = comma + 1;
  const x = toks[q];
  if (!x || x.stop) return null;
  if (WHOSE.has(x.base) || x.poss) return toks[q + 1] && !toks[q + 1].stop ? toks[q + 1].base : possKey(x, ctx);
  if (x.own) return '';
  if (Object.hasOwn(PRONOUN_OF, x.base)) return pronounKey(x.base, ctx);
  return x.base;
}
/* whether a sentence tells some words the way a "not" of his newer words says no to them: going back from the last of
 * them, the first word that is no little word, name, "'s" or a word between an article and them ("her younger brother")
 * is one of them, "is", or none */
function toldSameWay(text, words, ctx) {
  const toks = slotTokens(text, ctx);
  const last = words[words.length - 1];
  let i = -1;
  toks.forEach((t, k) => { if (!t.stop && (t.base === last || regular(t.base, last))) i = k; });
  if (i < 0) return false;
  for (let q = i - 1; q >= 0; q--) {
    const t = toks[q];
    if (t.stop) return true;
    if (words.some((w) => w === t.base || regular(w, t.base))) return true;
    if (COPULA.has(t.base) || t.base === 'be' || t.base === 'been' || t.base === 'becomes' || t.base === 'became') return true;
    if (t.little || t.poss || t.own || t.fig !== null) continue;
    const b = toks[q - 1];
    if (b && !b.stop && (ARTICLE.has(b.base) || WHOSE.has(b.base) || b.poss)) continue;
    return false;
  }
  return true;
}
/* A SENTENCE OF HIS SAID AGAIN IN OTHER WORDS (2.12.41, the review; the third review: one ordinary word his words never
 * gave — "a second raven" — read a new fact as his said again, so what it brought was lost): it holds half of what his
 * sentence tells — names set aside: a name says whom it tells of, never what — lets go of a word of it that tells, and
 * brings a word neither his entry nor his newer words give */
function saidAgain(o, s, ctx) {
  const named = new Set([...ctx.own, ...wordsOf(capsOf(s.text))]);
  const his = [...s.tell].filter((w) => !named.has(w));
  if (!his.length) return false;
  const kept = his.filter((w) => keptIn(w, o.tell)).length;
  /* (two words of his at least: one shared doing word — "keeps" — is no sentence of his said again) */
  return kept >= 2 && kept < his.length && kept / his.length >= AGAIN && unbacked(o, s, ctx).length > 0;
}
/* the words two sentences say "not" to otherwise — a "not" of either judged only where the other gives every word it says
 * no to ("does not drink blood" against "drinks blood"; never "does not drink human blood" against "drinks the blood of
 * animals", which never says "human": 2.12.41, the fourth review), and where both tell those words the same way
 * (toldSameWay: "fears nothing" and "fears the sun"; never "is not a vampire" against "hunts vampires" — held as saying
 * both, found in this round's checks) */
function notsOn(R, x, ctx) {
  const out = [];
  for (const [a, b] of [[R, x], [x, R]]) {
    for (const n of a.negs) {
      if (!n.words.length || !n.words.every((w) => keptIn(w, b.words))) continue;
      if (!toldSameWay(R.text, n.words, ctx) || !toldSameWay(x.text, n.words, ctx)) continue;
      const k = n.words[n.words.length - 1];
      if (saysNoTo(R, k) !== saysNoTo(x, k) && !out.includes(k)) out.push(k);
    }
  }
  return out;
}
/* THE ANSWER'S SENTENCE THAT CARRIES HIS NEWER WORD, IN PLACE OF HIS (2.12.40, the review; held to the keep rule since
 * 2.12.41): one that carries it (carries), keeps every word of the rest of his sentence that tells, every name and figure
 * of the words it changes that his newer word does not, says "not" to each word as he does, and brings nothing his entry
 * and his words do not say — the one with most of what his newer word brings; -1 when none does */
function carrierOf(c, theirs, ctx, whole) {
  const mine = ctx.prep(c.mine);
  const span = spanOf(whole, c.was);
  const rest = ctx.prep(span ? `${whole.slice(0, span.start)} ${whole.slice(span.end)}` : '');
  const base = ctx.prep(whole);
  const fresh = freshOf(c, ctx).words;
  let best = -1;
  let top = 0;
  theirs.forEach((o, j) => {
    if (!carries(o, c, ctx) || !keepsAll(o, rest) || !wasKept(o, c, ctx)) return;
    if (!negsAgree(o, [mine, rest, ctx.box]) || unbacked(o, base, ctx).length) return;
    const score = fresh.filter((w) => keptIn(w, o.says)).length * 1000 + [...mine.says].filter((w) => keptIn(w, o.says)).length + 1;
    if (score > top) { best = j; top = score; }
  });
  return best;
}
const sentencesWord = (n) => (n === 1 ? 'a sentence' : `${numberWords(n).toLowerCase()} sentences`);

/* HIS ENTRY, WITH WHAT THE ANSWER WROTE (2.12.40, the review — his grammar put right read as thinned, so his entry was
 * doubled; his newer word was added beside the very words it changes, so his entry said both; 2.12.41, the review — a
 * sentence of his said again in other words was added beside his, and a "not" of his was let go). One rule for every
 * length:
 * - the words his newer word changes (`changes`, each looked up where it stands in his entry) are put right in place —
 *   with its words for them ("now") where they hold, else the answer's sentence that carries it (carrierOf); with neither,
 *   nothing is put in for it, and his words stand as he wrote them (`unput` — 2.12.41, the third review: his own words were
 *   spliced in, "Her eyes are Make her eyes green and cold");
 * - each other sentence of his stands, or the answer's sentence that holds it (holds) and brings nothing his words do not
 *   say stands in its place — his put right, said better;
 * - then the answer's sentences that bring words of his newer word his entry lacks (`added`) — never one still saying the
 *   words his newer word changes, nor one saying a sentence of his again in words his do not give or saying "not"
 *   otherwise than his words do (`back`, why 'again' | 'not', where it carried words of his newer word too), nor one
 *   that would say both a sentence of his and another way of it with no change listed for it (`both` — 2.12.41, the
 *   third review: "Emilia has green eyes" went in beside his "Emilia has grey eyes").
 * The answer's words stand as it wrote them only when it read his entry whole (`seenWhole`) and gave it whole (`offered`),
 * every sentence it wrote went in, in its order, and every break of his paragraphs stands in it as he set it (2.12.41, the
 * third review: an answer in one paragraph flattened his). `adds`: what it wrote to add to his entry, his sentences left as
 * they stand. {text, whole, asWritten, why, joined, put: [{c, now, by: 'now' | 'carrier'}], unput: [c], gave: Set of c,
 * back, both, foreign: [word]} */
/* the breaks between some words' sentences, in order: 0 none, 1 a line's, 2 a paragraph's */
function breaksOf(t) {
  const ps = piecesOf(t).filter((p) => p.s.trim());
  return ps.slice(1).map((p, k) => Math.min(2, (t.slice(ps[k].end, p.start).match(/\n/g) || []).length));
}
function mergeEntry({ had, offered = '', adds = '', changes = [], ctx, seenWhole = false }) {
  const prep = ctx.prep;
  const pieces = piecesOf(had);
  const his = pieces.map((p) => (p.s.trim() ? prep(p.s) : null));
  const theirsWhole = sentencesOf(offered);
  const theirs = [...theirsWhole, ...sentencesOf(adds)].map(prep);
  const out = pieces.map((p) => ({ ...p }));
  const placed = new Set();
  const carriers = new Set();
  /* (the answer's sentence that took the place of each piece of his: piece -> its index) */
  const took = new Map();
  const freed = new Set();
  const put = [];
  const unput = [];
  /* (whether its partner gave words for one not put in — its own for it, or a sentence carrying it — so the row says
   * which: 2.12.41, the fourth review) */
  const gave = new Set();
  const notIn = (c) => { unput.push(c); if (String(c.now || '').trim() || theirs.some((o) => carries(o, c, ctx))) gave.add(c); };
  for (const c of changes) {
    const span = spanOf(had, c.was);
    const at = span ? pieces.map((p, i) => i).filter((i) => pieces[i].s.trim() && pieces[i].end > span.start && pieces[i].start < span.end) : [];
    if (!at.length) { notIn(c); continue; }
    const given = nowFor(c, ctx);
    /* (two of his newer words in one sentence of his: the second put right in what stands there now — its words for them,
     * by their shape — or carried by the sentence standing where its words stood, or the answer's sentence that took their
     * place — else not put in. That sentence was held to the keep rule when the first change put it there: every word of
     * his outside the first change's words is kept in it, so the second is held only to carrying it — 2.12.41, the fourth
     * review: held to wasKept as well, a figure the first change changed itself ("twelve ravens" made thirteen) said the
     * second "did not go in" where the sentence there carried it) */
    if (at.some((i) => freed.has(i))) {
      const i = at.find((k) => freed.has(k) && out[k].s.trim());
      const sp = i === undefined ? null : spanOf(out[i].s, c.was);
      const here = sp && given ? placeIn(out[i].s, sp, given, ctx) : null;
      if (here) { out[i].s = laid(out[i].s, here); put.push({ c, now: out[i].s.trim(), by: 'now' }); continue; }
      const there = i === undefined ? [...new Set(at.map((k) => took.get(k)).filter((j) => j !== undefined))].map((j) => theirs[j]) : sp ? [] : [prep(out[i].s)];
      const by = there.find((o) => carries(o, c, ctx));
      if (by) { put.push({ c, now: by.text, by: 'carrier' }); continue; }
      notIn(c);
      continue;
    }
    const from = pieces[at[0]].start;
    const to = pieces[at[at.length - 1]].end;
    const whole = had.slice(from, to);
    let now = '';
    let shown = '';
    let by = 'now';
    /* (its words for them by their shape — placeIn — else the answer's sentence that carries it) */
    const here = given ? placeIn(had, span, given, ctx) : null;
    if (here) now = laid(had, here).slice(from, to - (here.to - here.from) + here.s.length).trim();
    else {
      const j = carrierOf(c, theirs, ctx, whole);
      /* (no words for it that hold: his stand as he wrote them, and it is said — never his own words spliced in) */
      if (j < 0) { notIn(c); continue; }
      /* (one sentence of the answer carrying two of his newer words: said once, where the first stood) */
      now = placed.has(j) ? '' : theirs[j].text;
      shown = theirs[j].text;
      placed.add(j);
      carriers.add(j);
      for (const i of at) took.set(i, j);
      by = 'carrier';
    }
    out[at[0]].s = now;
    for (const i of at.slice(1)) out[i].s = '';
    for (const i of at) freed.add(i);
    put.push({ c, now: now || shown, by });
  }
  /* each other sentence of his: said again in the answer's words — the one closest to his of those that hold it and bring
   * nothing his words do not say — or as it stands */
  const sayer = new Map();
  his.forEach((s, i) => {
    if (!s || freed.has(i)) return;
    let best = -1;
    let top = -1;
    theirs.forEach((o, j) => {
      if (!holds(o, s, ctx.box) || unbacked(o, s, ctx).length) return;
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
  const text0 = joinPieces(out);
  let text = text0;
  /* what the answer brings that his entry lacks, and his newer words say */
  const nowSays = new Set([...ctx.entry.says, ...saysOf(text)]);
  const nowFigures = new Set([...ctx.entry.figures.keys(), ...figuresOf(text).keys()]);
  const hisNow = sentencesOf(text).map(prep);
  const standing = [...hisNow];
  const fresh = [];
  const back = [];
  const both = [];
  /* (what it wrote that brings none of his words, only its own: said where nothing else of it goes in — never "the entry
   * already says that", found in this round's checks) */
  const foreign = [];
  let lost = 0;
  let lostNot = 0;
  /* (the sentences of his newer words that name this one: his newest word on it — 2.12.41, the fourth review's round) */
  const about = (ctx.said || []).filter((b) => (ctx.ref && b.names.all.has(ctx.ref)) || [...b.words].some((w) => ctx.own.has(w)));
  theirs.forEach((o, j) => {
    if (placed.has(j)) return;
    if (changes.some((c) => stands(o.text, c.was))) return;
    /* (a word his entry says only the other way is new as well — with a "not" where his says none, or with none where his
     * says one: "Corvin is not a vampire" beside his "Corvin hunts vampires" brought nothing, so it was let go; "Emilia
     * drinks blood." beside his "Her brother Dane does not drink blood." brought nothing, so it was said as "the entry
     * already says that", found in this round's checks. Said so of the same one, told the same way, it is held as saying
     * both — `clash` — whatever it brings; one his line already says as it does brings nothing) */
    const his1 = [...standing, ...(ctx.line ? [ctx.line] : [])];
    const otherWay = (w) => his1.some((s) => keptIn(w, s.says) && saysNoTo(s, w) !== saysNoTo(o, w)) && !his1.some((s) => keptIn(w, s.says) && saysNoTo(s, w) === saysNoTo(o, w));
    const brings = [...o.says].filter((w) => keptIn(w, ctx.box.says) && (!keptIn(w, nowSays) || otherWay(w))).length
      + [...o.figures.keys()].filter((v) => ctx.box.figures.has(v) && !nowFigures.has(v)).length;
    /* one that would say both a sentence of his — or his line — and another way of it, with no change listed for it:
     * never in, whatever it brings — a thing of his told another way by his newer words ("green eyes" for his "grey"), or
     * a "not" of his said otherwise as his newer words say it ("drinks blood" for his "does not drink blood"): of the same
     * one, told the same way (never "is not a vampire" against his "hunts vampires") */
    const mine = [...hisNow, ...(ctx.line ? [ctx.line] : [])];
    const notHis = !negsAgree(o, [...standing, ctx.box]);
    const whom = subjectOfSentence(o.text, ctx);
    const one = (s) => s === ctx.line || (whom !== null && whom === subjectOfSentence(s.text, ctx));
    const clash = (notHis && mine.find((s) => { if (!one(s)) return false; const ks = notsOn(o, s, ctx); return ks.length > 0 && ks.every((k) => keptIn(k, ctx.box.words) && saysNoTo(ctx.box, k) === saysNoTo(o, k)); }))
      || mine.find((s) => saysBoth(o, s, ctx));
    if (clash) { both.push({ said: o.text, his: clash.text }); return; }
    /* a sentence of his said again in words his entry and his newer words never give, or with a "not" his newer words on
     * this one, his entry and the rest of his words do not say — judged by them in that order, so his newest word decides
     * ("Emilia never drinks wine" beside his "Emilia keeps a cellar of wine" was read as a "not" his words never say; his
     * "Dane never drinks wine" is never hers): his stands */
    const not = !negsAgree(o, [...about, ...standing, ctx.box]);
    const said = standing.find((s) => saidAgain(o, s, ctx));
    if (said || not) {
      if (brings) {
        if (said) lost += 1; else lostNot += 1;
        const his0 = said || standing.find((s) => !negsAgree(o, [s]));
        back.push({ said: o.text, his: his0 ? his0.text : '', why: said ? 'again' : 'not' });
      }
      return;
    }
    if (!brings) { for (const w of unbacked(o, prep(''), ctx)) if (!foreign.includes(w)) foreign.push(w); return; }
    fresh.push(o.text);
    placed.add(j);
    standing.push(o);
    for (const w of o.says) nowSays.add(w);
    for (const v of o.figures.keys()) nowFigures.add(v);
  });
  if (fresh.length) text = [text, fresh.join(' ')].filter(Boolean).join('\n\n');
  /* his sentences that stand as he wrote them, and those the answer gave whole without every word that tells: left out,
   * or said in other words (an answer's sentence holding a third of its words that tell) */
  const kept = his.filter((s, i) => s && !freed.has(i) && (!sayer.has(i) || theirs[sayer.get(i)].text === s.text)).length;
  let left = 0;
  let reworded = 0;
  let notted = 0;
  if (offered) {
    his.forEach((s, i) => {
      if (!s || freed.has(i) || sayer.has(i)) return;
      /* (one with every word of his but a "not" said otherwise is no rewording: it let his "not" go — 2.12.41, the third
       * review) */
      const bare = [...s.tell].filter((w) => !NEG.test(w) && !PAST_NOT.has(w));
      if (theirs.some((o) => bare.every((w) => keptIn(w, o.tell)) && !negsAgree(o, [s]))) notted += 1;
      else if (theirs.some((o) => s.tell.size && shareIn(s.tell, o.tell) >= 1 / 3)) reworded += 1;
      else left += 1;
    });
  }
  const carried = put.length === changes.length;
  const oldGone = changes.every((c) => theirs.every((o, j) => carriers.has(j) || !stands(o.text, c.was)));
  const all = theirs.every((o, j) => placed.has(j));
  const sameOrder = sentencesOf(text).join('\n') === theirsWhole.join('\n');
  /* (his paragraphs as he set them: every break between his sentences the same in what it wrote — 2.12.41, the third
   * review; what it gives after them is laid out as it wrote it) */
  const inOffered = breaksOf(offered);
  const keepsBreaks = breaksOf(text0).every((g, k) => g === inOffered[k]);
  const whole = Boolean(seenWhole && offered && !adds.trim() && sameOrder && carried && keepsBreaks);
  const asWritten = whole || Boolean(!offered && all && carried);
  const loses = offered ? whatItLoses(had, offered, ctx.read, changes.map((c) => c.was)) : '';
  const parted = [left ? `what it wrote left out ${sentencesWord(left)} of yours` : '',
    reworded ? `what it wrote said ${sentencesWord(reworded)} of yours in other words, so ${reworded === 1 ? 'yours stands as you wrote it' : 'yours stand as you wrote them'}` : '',
    notted ? `what it wrote let ${notted === 1 ? 'a “not” of yours' : `${numberWords(notted).toLowerCase()} “not”s of yours`} go, so ${notted === 1 ? 'yours stands as you wrote it' : 'yours stand as you wrote them'}` : ''].filter(Boolean).join('; ');
  const paras = sameOrder && !keepsBreaks ? 'what it wrote set your paragraphs otherwise, so they stand as you set them' : '';
  const why = whole || !offered ? '' : !seenWhole ? 'it had not read your entry whole'
    : loses || parted || paras || (!oldGone ? 'what it wrote still said the words your newer word changes' : '');
  const joined = {};
  const count = (k, n) => { if (n) joined[k] = n; };
  count('changed', put.length);
  count('again', again);
  count('kept', kept);
  count('added', fresh.length);
  count('lost', lost);
  count('lostNot', lostNot);
  /* (`base`: his sentences as they go in, `more`: what it adds after them — the parts its write lays apart: putEntries) */
  return { text: whole ? offered : text, base: whole ? offered : text0, more: whole ? '' : fresh.join(' '), whole, asWritten, why, joined, put: put.map(({ c, now, by }) => ({ c, now, by })), unput, gave, back, both, foreign };
}

/* HIS LINE, HELD TO THE SAME KEEP RULE (2.12.40, the review: "An elder vampire, mother of the twins, sworn enemy of the
 * Covenant" went as "An elder vampire"; 2.12.41, the review: where his newer word quoted his line, the answer's line was
 * taken whole, and "sworn enemy of the Covenant" was lost): what his newer word changes in it goes in its place — its
 * words for them ("now") where they hold, else the answer's line where it carries every one of them and keeps the rest of
 * his — and the rest of his line is kept; one with neither is not put in, his line as he wrote it (`unput` — 2.12.41, the
 * third review: his own words were spliced in, "Sworn now an ally of the Covenant"); with none of it quoted, his line
 * stands unless the answer's holds it and brings nothing his words do not say. {line: the line to write ('' — his
 * stands), how, put, unput} */
function lineFor(cur, said, changes, ctx) {
  const mine = String(cur.line || '').trim();
  const S = said ? ctx.prep(said) : null;
  if (!mine) return S && !unbacked(S, ctx.prep(''), ctx).length ? { line: said, how: 'theirs', put: [], unput: [] } : { line: '', how: said ? 'unbacked' : '', put: [], unput: [] };
  const quoted = changes.filter((c) => stands(mine, c.was));
  if (quoted.length) {
    const given = quoted.map((c) => nowFor(c, ctx));
    if (!given.every(Boolean) && S && said !== mine) {
      let rest = mine;
      for (const c of quoted) { const sp = spanOf(rest, c.was); if (sp) rest = `${rest.slice(0, sp.start)} ${rest.slice(sp.end)}`; }
      const R = ctx.prep(rest);
      if (quoted.every((c) => carries(S, c, ctx) && wasKept(S, c, ctx)) && keepsAll(S, R) && negsAgree(S, [...quoted.map((c) => ctx.prep(c.mine)), R, ctx.box]) && !unbacked(S, ctx.prep(mine), ctx).length) {
        return { line: said, how: 'carrier', put: quoted.map((c) => ({ c, now: said, by: 'carrier' })), unput: [] };
      }
    }
    let l = mine;
    const by = [];
    const unput = [];
    /* (its words for them by their shape, as in his entry: placeIn — 2.12.41, the fourth review: "An elder vampire, Emilia
     * is now an ally of the Covenant., mother of twins.") */
    quoted.forEach((c, k) => {
      const sp = spanOf(l, c.was);
      const here = sp && given[k] ? placeIn(l, sp, given[k], ctx) : null;
      if (!here) { unput.push(c); return; }
      l = laid(l, here);
      by.push({ c, by: 'now' });
    });
    const gave = new Set(unput.filter((c) => String(c.now || '').trim() || (S && carries(S, c, ctx))));
    if (!by.length) return { line: '', how: '', put: [], unput, gave };
    return { line: l, how: 'now', put: by.map((x) => ({ ...x, now: l })), unput, gave };
  }
  if (!S || said === mine) return { line: '', how: '', put: [], unput: [] };
  const M = ctx.prep(mine);
  return holds(S, M, ctx.box) && !unbacked(S, M, ctx).length ? { line: said, how: 'theirs', put: [], unput: [] } : { line: '', how: 'kept', put: [], unput: [] };
}

/* AN ENTRY OF HIS WITH WHAT ONE ANSWER WROTE FOR IT (`e`, or null where it wrote none): the words to write, and what came
 * of each — the same for putting it in (putEntries) and for asking whether it can go in (dryRun), so the two never part.
 * Each newer word of his on it is put in (`put`) or not (`unput`: no words for it that hold, or words it quotes that stand
 * neither in its words nor its line — `gave`: those its partner gave words for, its own or a sentence carrying it); and
 * the sentences of his, and his line, that would stand saying what his newer words say "not" to (`denied`: [{his, not}]
 * — deniedBy); and the words of what it wrote that brought none of his, only its own (`foreign`). {text: null — his
 * stands, base and more — that text as his sentences and what it adds after them —, line, lineHow, how, why, whole,
 * asWritten, joined, put, unput, gave, back, both, denied, foreign} */
function entryOp(cur, e, changes, ctx, seenWhole) {
  const had = String(cur.text || '').trim();
  const said = e ? line(e.line, 400) : '';
  const offered = e ? String(e.text || '').trim() : '';
  const adds = e ? String(e.add || '').trim() : '';
  const mine = changes.filter((c) => c.kind === 'entry' && c.entryId === cur.id);
  const inText = mine.filter((c) => stands(had, c.was));
  const out = { text: null, base: null, more: '', line: '', lineHow: '', how: '', why: '', whole: false, asWritten: true, joined: null, put: [], unput: [], gave: new Set(), back: [], both: [], denied: [], foreign: [] };
  if (offered || adds || inText.length) {
    const m = mergeEntry({ had, offered, adds, changes: inText, ctx, seenWhole });
    if (m.text !== had) { out.text = m.text; out.base = m.base; out.more = m.more; }
    out.how = m.whole ? 'whole' : 'merged';
    out.why = m.why;
    out.whole = m.whole;
    out.asWritten = m.asWritten;
    if (!m.whole) out.joined = m.joined;
    out.put = m.put;
    out.unput = m.unput;
    out.gave = m.gave;
    out.back = m.back;
    out.both = m.both;
    out.foreign = m.foreign;
  }
  const ln = lineFor(cur, said, mine, ctx);
  out.line = ln.line;
  out.lineHow = ln.how;
  out.put = [...out.put, ...ln.put];
  /* (a newer word put in nowhere: words it quotes in neither the entry's words nor its line, or none that hold for it) */
  const nowhere = mine.filter((c) => !stands(had, c.was) && !stands(String(cur.line || ''), c.was));
  out.unput = [...new Set([...out.unput, ...ln.unput, ...nowhere])].filter((c) => !out.put.some((p) => p.c === c));
  out.gave = new Set([...out.gave, ...(ln.gave || []), ...nowhere.filter((c) => String(c.now || '').trim())].filter((c) => out.unput.includes(c)));
  if (said && (ln.line || String(cur.line || '').trim()) !== said) out.asWritten = false;
  /* (what would stand of his, saying what his newer words say "not" to — 2.12.41, the fourth review) */
  if (ctx.said && ctx.said.some((b) => b.negs.length)) {
    const lineNow = String(ln.line || cur.line || '').trim();
    for (const s of sentencesOf(out.text !== null ? out.text : had)) {
      const by = deniedBy(ctx.prep(s), ctx);
      if (by) out.denied.push({ his: s, not: by.text });
    }
    if (lineNow) { const by = deniedBy(ctx.prep(lineNow), ctx, { isLine: true }); if (by) out.denied.push({ his: lineNow, not: by.text, line: true }); }
  }
  return out;
}

/* WHAT A PAGE SAYS OTHERWISE, CARRIED INTO AN ENTRY (2.12.41, the review: an entry was held back only when the answer
 * was asked again, and by three-fifths of his whole sentence — one never saying the words a page contradicts was held,
 * "raven-black hair" passed, and what went in from the first answer was never held to what it said itself): the row the
 * new words of an entry rest on — a sentence of them saying the words of his the page's lack ("black"), beside a word
 * both give where they give one ("hair": what they part on), or all his words where only a "not" parts them, with his
 * "not"; a figure of his the page counts otherwise, whatever the words beside it ("twelve" against the page's "eleven",
 * written "12" or "twelve" — 2.12.41, the third review) — or null. Only a sentence about whom the row is about: one
 * naming whom his words or the page name, or in that one's entry (`about`: the entry's names and its ref), or one where
 * that cannot be told (speaksOf) — and never one that says what the page says of it ("silver hair", the page's own
 * figure) (2.12.41, the third review: an entry for his steward, "a black cloak … his hair cropped", was held for "Emilia
 * has black hair"). A row he said his word stands over is never one (quickAdd). */
const capsOf = (t) => [...String(t || '').matchAll(/\p{Lu}[\p{L}'’-]*/gu)].map((m) => m[0]).filter((w) => !notAName(w)).join(' ');
/* whom a row is about: the entries and cards his words name (refs), every word of theirs written with a capital (words),
 * and those written so inside a sentence (sure: a capital opening one may be an order's "Make") — the page's quote only
 * where his words name no one (2.12.41, the fourth review: a quote naming "Emilia and Corvin" held Corvin's own "Corvin
 * has black hair." for her "Emilia has black hair") */
function subjectOf(m, a) {
  const x = m.names.all.size + m.names.loose.length > 0 ? m : a;
  return { refs: new Set(x.names.all), words: new Set(wordsOf(capsOf(x.text))), sure: x.names.all.size + x.names.loose.length > 0 };
}
/* whether a sentence speaks of whom a row is about: it, or its entry, names them — or it cannot be told otherwise: a row
 * naming no one for sure, or a sentence and entry naming no one */
function speaksOf(s, subject, about) {
  const refs = [...s.names.all, ...(about ? about.refs : [])];
  const words = [...wordsOf(capsOf(s.text)), ...(about ? about.words : [])];
  if (refs.some((r) => subject.refs.has(r)) || words.some((w) => subject.words.has(w))) return true;
  return !subject.sure || (!refs.length && !words.length);
}
const sameThing = (a, b) => a === b || regular(a, b);
function heldBy(texts, rows, prep, about = null) {
  const ss = texts.flatMap((t) => sentencesOf(t)).map(prep);
  if (!ss.length) return null;
  const own = about ? about.words : new Set();
  for (const r of rows) {
    const m = prep(r.mine);
    const a = prep(r.against);
    const names = new Set(wordsOf(capsOf(`${r.mine} ${r.against}`)));
    const odd = [...m.says].filter((w) => !keptIn(w, a.says) && !names.has(w));
    const oddFigures = [...m.figures.keys()].filter((v) => !a.figures.has(v));
    const anchor = [...m.says].filter((w) => keptIn(w, a.says) && !names.has(w));
    const subject = subjectOf(m, a);
    /* the page's own words for what they part on ("silver" of hair), and its figures his do not give */
    const pageWords = new Set();
    for (const t of valuesOf(r.against, own)) if (anchor.some((w) => sameThing(w, t.thing))) for (const w of t.words) if (!keptIn(w, m.says)) pageWords.add(w);
    const pageFigures = [...a.figures.keys()].filter((v) => !m.figures.has(v));
    const agrees = (s) => pageFigures.some((v) => s.figures.has(v))
      || (pageWords.size > 0 && valuesOf(s.text, own).some((t) => anchor.some((w) => sameThing(w, t.thing)) && [...t.words].some((w) => keptIn(w, pageWords))));
    const hit = ss.some((s) => {
      if (!speaksOf(s, subject, about)) return false;
      if (agrees(s)) return false;
      if (oddFigures.some((v) => s.figures.has(v))) return true;
      if (odd.length) {
        if (!odd.some((w) => keptIn(w, s.says))) return false;
        return anchor.length ? anchor.some((w) => keptIn(w, s.says)) : odd.every((w) => keptIn(w, s.says));
      }
      if (oddFigures.length) return false;
      const all = [...m.says].filter((w) => !names.has(w));
      return all.length > 0 && all.every((w) => keptIn(w, s.says)) && negsAgree(s, [m]) && !negsAgree(s, [a]);
    });
    if (hit) return r;
  }
  return null;
}
const heldWhy = (r, againWhy) => `${r.cannot ? `it says what cannot be, by ${r.label}` : `it says what ${r.label} says otherwise`} (“${r.mine}”)${againWhy ? ` — asked to write it again without that, ${againWhy}` : ''} — it waits for your word`;
/* (what it wrote would say both a sentence of his and another way of it: 2.12.41, the third review) */
const bothWhy = (x, againWhy) => `it would say both — your partner listed no change for your words: your “${x.his}” and its “${x.said}”${againWhy ? ` (asked again for it, ${againWhy})` : ''}`;
/* (his newer words say "not" to words of his that would stand: 2.12.41, the fourth review) */
const deniedWhy = (x, againWhy) => `your newer words say “not” to your ${x.line ? 'line ' : ''}“${x.his}” — your partner listed no change for it${againWhy ? ` (asked again for it, ${againWhy})` : ''}`;
/* the entries his words name, by the bibliography's own name finder */
function namedIn(words, novel, finder) {
  const all = prepared(nameReader(finder, null))(words).names.all;
  return entriesOf(novel).filter((e) => all.has(`e:${e.id}`));
}
/* (what it brought of his newer words came only in sentences of his said again, or saying "not" otherwise than his words
 * do — one of his let go, or one none of his words say put in) */
function lostWhy(j) {
  const n = (j.lost || 0) + (j.lostNot || 0);
  const again = `said ${n === 1 ? 'a sentence' : 'sentences'} of yours again in other words`;
  const not = 'said “not” otherwise than your words do';
  const how = j.lostNot && !j.lost ? not : j.lostNot ? `${again}, or ${not}` : again;
  return `what it wrote ${how} — yours stand${n === 1 ? 's' : ''} as you wrote ${n === 1 ? 'it' : 'them'}, and what it brought of your newer words did not go in`;
}

/* whether some words of an entry carry his newer word: a sentence of them holding three-fifths of what it says — the one
 * measure of whether it went in (carriedBy) and of whether to ask again for it (toSetRight) */
function carriesWords(text, mine) {
  const m = tellOf(mine);
  return m.size > 0 && sentencesOf(text).some((s) => shareIn(m, tellOf(s)) >= HOLD);
}
/* whether words of his went into an entry put in: the name of the first whose words carry them, or '' */
function carriedBy(mine, added, novelId) {
  const es = entriesOf(store.peek('novel', novelId));
  for (const a of added) {
    if (a.status !== 'made') continue;
    const e = es.find((x) => x.id === a.entryId);
    if (e && carriesWords(entryWords(e), mine)) return a.name;
  }
  return '';
}
const answerWords = (e) => [line(e.line, 400), String(e.text || ''), String(e.add || '')].filter(Boolean).join('\n');
/* WHAT AN ANSWER'S ENTRIES WOULD DO TO HIS, judged as putting them in judges them (entryOp — the same entries, found by
 * the same name matching for the kind it says, one of another kind found by another name never his), nothing written:
 * which newer words of his on an entry of his would go in (`put`), and what cannot go in (`again`: [{name, said, his, why:
 * 'again' | 'not' | 'both' | 'denied', not?, line?}]) — what it wrote that brings his newer words, and words of his that
 * would stand saying what his newer words say "not" to, in an entry it wrote for or one his words name — so the one ask
 * again asks for those too */
function dryRun(read, novel, finder, words) {
  const entries = entriesOf(novel);
  const put = new Set();
  const again = [];
  const forEntry = new Map();
  for (const e of read.entries) {
    const name = line(e.name, 200);
    const kind = kindSaid(e.kind);
    const found = entryFor(entries, name, { kind });
    if (found.entry && !otherKindSaid(found, name, kind) && !forEntry.has(found.entry.id)) forEntry.set(found.entry.id, e);
  }
  for (const c of read.changes) if (c.kind === 'entry' && c.entryId && !forEntry.has(c.entryId)) forEntry.set(c.entryId, null);
  if (negsOf(words).length) for (const e of namedIn(words, novel, finder)) if (!forEntry.has(e.id)) forEntry.set(e.id, null);
  for (const [id, e] of forEntry) {
    const cur = entries.find((x) => x.id === id);
    if (!cur) continue;
    const r = entryOp(cur, e, read.changes, entryCtx(cur, finder, words), false);
    for (const p of r.put) put.add(p.c);
    for (const x of r.back) again.push({ name: cur.name, ...x });
    for (const x of r.both) again.push({ name: cur.name, ...x, why: 'both' });
    for (const x of r.denied) again.push({ name: cur.name, said: '', ...x, why: 'denied' });
  }
  return { put, again };
}

/* The entries, put in through the partner's own entry change — his, each with what came of it. An entry already his is
 * put together with what the answer wrote (entryOp: mergeEntry, lineFor), his newer word put in place of the words it
 * changes. Each is found by the bibliography's own name matching, for the kind the answer says (bibliography.js entryFor
 * — 2.12.41, the third review: "Kuchiki", a group, went into Rukia Kuchiki's entry); its kind stays as he set it: the
 * request never says it. Each says whether it went in as the answer wrote it (`notAsWritten`): the answer's verdict
 * stands only when every one did. An entry whose new words say what a page says otherwise, or what cannot be
 * (`standing`), waits for his word under Not put in (heldBy), as does one that would say both a sentence of his and
 * another way of it with no change listed for it (`both`); and his newer word on an entry of his that no entry it wrote
 * is for is put in all the same — with its words for it (2.12.41, the review: his entry kept saying what his newer word
 * changes, and the writer read the old fact) — or, with none that hold, not put in, said on its own row (`unput`, never
 * his own words spliced in: 2.12.41, the third review). What went in is laid into `got` as it goes — {added, refused,
 * put: what stands now in place of the words each change of his entries quoted, unput, waits: the newer words of an
 * entry that waits} — so what went in before anything goes wrong is never said as nothing (2.12.41, the review). */
const SAME_WORDS = new Set(['the entry already says that', 'those words are there already']);
function putEntries(novelId, entries, seen, changes, words, { got, standing = [], againWhy = '' }) {
  const finder = finderFor(store.peek('novel', novelId));
  const done = new Set();
  const one = (e, { repair = false } = {}) => {
    const name = line(e.name, 200);
    const novel = store.peek('novel', novelId);
    const kind = kindSaid(e.kind);
    const found = entryFor(entriesOf(novel), name, { kind });
    /* (more than one of his going by that name — two people of one given name, a lone word of a person's name that an
     * entry of another kind goes by too: which is meant is never guessed, nor a new entry made beside them under the kind
     * it falls back to — said, as his partner's own change says it: 2.12.41, the fourth review) */
    if (found.ambiguous) { got.refused.push({ name, why: `more than one entry goes by ${name} — name it by its full name` }); return; }
    /* (found by another name and written as another kind: never that entry's — said, as his partner's own change says
     * it, and never written as a new one beside it: 2.12.41, the fourth review — the lore "Order" went into his group "The
     * Order") */
    const otherKind = repair ? '' : otherKindSaid(found, name, kind);
    if (otherKind) { got.refused.push({ name, why: otherKind }); return; }
    const cur = found.entry;
    const op = { entry: name };
    const aka = (Array.isArray(e.aka) ? e.aka : typeof e.aka === 'string' ? e.aka.split(',') : []).map((x) => line(x, 120)).filter(Boolean);
    if (aka.length) op.aka = aka;
    const said = line(e.line, 400);
    let r = null;
    let ctx = null;
    let fresh = [];
    /* (refused: what it would have put in of his newer words waits with it) */
    const waits = (row) => { got.refused.push(row); if (r) for (const p of r.put) got.waits.push(p.c); };
    if (!cur) {
      op.kind = kind || 'lore';
      if (said) op.line = said;
      const text = [String(e.text || '').trim(), String(e.add || '').trim()].filter(Boolean).join('\n\n');
      if (text) op.text = text;
      fresh = [said, text];
    } else {
      done.add(cur.id);
      ctx = entryCtx(cur, finder, words);
      r = entryOp(cur, repair ? null : e, changes, ctx, seen.has(cur.id) && seen.get(cur.id) === String(cur.text || ''));
      for (const c of r.unput) { got.unput.push(c); if (r.gave.has(c)) got.gave.push(c); }
      /* (his newer words say "not" to words of his that would stand, with no change listed for them, or what it wrote would
       * say both a sentence of his and another way of it: nothing of it goes in — said, with Ask again; never "brother"
       * beside "cousin", never both in his entry) */
      if (r.denied.length) { waits({ name, why: deniedWhy(r.denied[0], againWhy), denied: true }); return; }
      if (r.both.length) { waits({ name, why: bothWhy(r.both[0], againWhy), both: true }); return; }
      /* (what it adds after his sentences goes as a paragraph to add, laid on his entry as it stands: his words typed there
       * meanwhile in another window stay, and it goes after them — changes.js entryStep's `more`; his sentences with his
       * newer word put in go only while his entry reads as it was found — 2.12.41, a step laid again over another window's
       * newer copy) */
      if (r.text !== null) {
        if (r.more && r.more.length <= 8000 && r.base !== null && r.base.trim()) {
          if (r.base.trim() !== String(cur.text || '').trim()) op.text = r.base;
          op.add = r.more;
        } else op.text = r.text;
      }
      if (r.line && r.line !== String(cur.line || '').trim()) op.line = r.line;
      const nothing = op.text === undefined && op.add === undefined && op.line === undefined && !op.aka;
      /* (nothing of it to write, where what it brought of his newer words was in a sentence of his said again, or one that
       * said "not" otherwise than his words do: said so, never "the entry already says that") */
      if (nothing && r.joined && (r.joined.lost || r.joined.lostNot)) { got.refused.push({ name, why: lostWhy(r.joined), lost: true }); return; }
      /* (nothing to write where a newer word of his had no words that hold: its own row says it did not go in) */
      if (nothing && (repair || r.unput.length)) return;
      /* (nothing of it to write, where what it wrote says only what his words do not — "Corvin is human" for his "Corvin is
       * not a vampire": said so, with Ask again, never "the entry already says that") */
      if (nothing && r.foreign.length) { got.refused.push({ name, why: `what it wrote says what your words do not (${listOf(r.foreign.slice(0, 3).map((w) => `“${w}”`))}) — nothing of it went in` }); return; }
      const before = new Set(sentencesOf(String(cur.text || '')));
      fresh = [...(r.text !== null ? sentencesOf(r.text).filter((s) => !before.has(s)) : []), ...(op.line ? [op.line] : [])];
    }
    const about = { refs: new Set(cur ? [`e:${cur.id}`] : []), words: new Set(wordsOf([name, ...aka, ...(cur ? [cur.name, ...(cur.aka || [])] : [])].join(' '))) };
    const on = heldBy(fresh.filter(Boolean), standing, ctx ? ctx.prep : prepared(nameReader(finder, null)), about);
    if (on) { waits({ name, why: heldWhy(on, againWhy), held: true }); return; }
    const ch = makeChange(novelId, op, { entryBy: 'you' });
    if (ch.status !== 'made') { waits({ name, why: line(ch.said, 300), ...(SAME_WORDS.has(ch.said) ? { same: true } : {}) }); return; }
    const entryId = (ch.undo && ch.undo.id) || '';
    got.added.push({ name, entryId, was: Boolean(cur), status: 'made', change: ch,
      ...(r && r.how ? { how: r.how } : {}), ...(r && r.why ? { addedWhy: r.why } : {}), ...(r && r.joined && Object.keys(r.joined).length ? { joined: r.joined } : {}),
      ...(r && r.lineHow ? { line: r.lineHow } : {}), ...(repair ? { repaired: true } : {}), ...(!r || r.asWritten ? {} : { notAsWritten: true }) });
    for (const p of r ? r.put : []) got.put.push({ ...p, entryId });
  };
  for (const e of entries) one(e);
  for (const c of changes) {
    if (c.kind !== 'entry' || done.has(c.entryId)) continue;
    const cur = entriesOf(store.peek('novel', novelId)).find((x) => x.id === c.entryId);
    if (cur) one({ name: cur.name }, { repair: true });
  }
  /* an entry his words name that nothing it wrote is for, where his newer words say "not" to words of it that stand: said
   * under Not put in, with Ask again — never left as though nothing were wrong (2.12.41, the fourth review) */
  for (const cur of negsOf(words).length ? namedIn(words, store.peek('novel', novelId), finder) : []) {
    if (done.has(cur.id)) continue;
    const r = entryOp(cur, null, changes, entryCtx(cur, finder, words), false);
    if (r.denied.length) got.refused.push({ name: cur.name, why: deniedWhy(r.denied[0], againWhy), denied: true });
  }
  return got;
}

/* WHAT THE BOOK IS ABOUT, PUT RIGHT TO HIS NEWER WORD (2.12.40, the audit: a change to his own What it's about was only
 * said — the earlier words stayed, and rode to the writer beside the entry that says otherwise): the earlier words found
 * where they stand and the answer's words put in their place, through the partner's own change of the book's words, with
 * Undo these — held to the keep rule as his entry's are (nowFor), and never words that say what a page says otherwise
 * (heldBy; 2.12.41, the review), put in by their shape as in his entry (placeIn — 2.12.41, the fourth review: "Emilia
 * rules the Sanguelis Emilia rules the Sanguelis alone., and the Covenant hunts them both."); with no words for it that
 * hold, nothing is put in, and the row says so — that it gave none (`noWords` — 2.12.41, the third review: his own words
 * were spliced in, "Emilia rules the Sanguelis her brother"), or that its words could not go in as they were
 * (`couldNot`). His premises are his record of what he asked for a passage: never written again — the row says his newer
 * word stands over them. One row for each change of his book's words: {at (the change's place in the row), field, label,
 * was, now?, status: 'made' | 'refused', why?, held?, noWords?, couldNot?, change?} */
const COULD_NOT = 'its words for it could not go in as they were';
/* where a change of his book's words would go in, as mendBook puts it in — {here, text, ctx} — or why not: {why, noWords?,
 * couldNot?} — the same for asking once more for its words (toSetRight) and for putting it in */
function bookPlacing(c, novel, finder, words) {
  const parts = String(c.was).split(ELLIPSIS).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
  if (parts.length !== 1) return { why: 'it quoted those words only in part, so they cannot be put right here — change them in About this book' };
  const text = String((novel && novel[BOOK_FIELD[c.field]]) || '');
  const [hit] = findIn(text, parts[0], { words: true, whole: true, max: 1 });
  if (!hit) return { why: 'those words are not there any more' };
  const ctx = bookCtx(novel, c.field, finder, words);
  const given = nowFor(c, ctx);
  const here = given ? placeIn(text, { start: hit.start, end: hit.end }, given, ctx) : null;
  if (!here) return String(c.now || '').trim() ? { why: COULD_NOT, couldNot: true } : { why: 'your partner gave no words for it', noWords: true };
  return { here, text, ctx };
}
function mendBook(novelId, changes, finder, words, { standing = [], againWhy = '' } = {}) {
  const out = [];
  changes.forEach((c, at) => {
    if (c.kind !== 'about' || !BOOK_FIELD[c.field]) return;
    const base = { at, field: c.field, label: c.label, was: c.was };
    const p = bookPlacing(c, store.peek('novel', novelId), finder, words);
    if (!p.here) { out.push({ ...base, status: 'refused', why: p.why, ...(p.noWords ? { noWords: true } : {}), ...(p.couldNot ? { couldNot: true } : {}) }); return; }
    const { here, text, ctx } = p;
    const now = here.s;
    const on = heldBy([now], standing, ctx.prep);
    if (on) { out.push({ ...base, status: 'refused', why: heldWhy(on, againWhy), held: true }); return; }
    const ch = makeChange(novelId, { book: c.field, find: text.slice(here.from, here.to), replace: now, why: 'your newer word, in Quick add' });
    if (ch.status === 'made') out.push({ ...base, now, status: 'made', change: ch });
    else out.push({ ...base, status: 'refused', why: line(ch.said, 300) });
  });
  return out;
}

/* WHAT CAME OF IT, in the app's own plain words — said in place of the answer's verdict wherever the look-ups part from
 * it, or an entry did not go in as the answer wrote it (2.12.40, the audit: "the book gives grey" stood over a row the
 * app had set aside). Said to him on the row; told again in his own voice when the row rides with what he says next
 * (`his` — 2.12.40, the review: "your bibliography", "your word" went back to his partner as though it were the
 * partner's; 2.12.41, the review: "it named" there was the partner it spoke to). Every count from what the row holds, so a
 * row kept from before says it the same way. */
const many = (n, one, more) => (n === 1 ? `One ${one}` : `${numberWords(n)} ${more}`);
const KEPT_WHAT = { about: 'what it’s about', style: 'how it reads' };
function plainAccount(r, { his = false, novelId = '' } = {}) {
  const your = his ? 'my' : 'your';
  const ours = his ? 'mine' : 'yours';
  const out = [];
  /* (every entry it put in went in, whatever was done with it since) */
  const made = (r.added || []).map((a) => a.name);
  const mended = (r.book || []).filter((b) => b.status !== 'refused' && b.status !== 'undone' && !(novelId && b.status === 'made' && b.change && madeGone(novelId, b.change))).map((b) => b.label);
  if (made.length) out.push(`${listOf(made)} went into ${your} bibliography.`);
  if (mended.length) out.push(`${listOf(mended)} now say${mended.length === 1 ? 's' : ''} what ${your} newer words say.`);
  const missed = (r.book || []).filter((b) => novelId && b.status === 'made' && b.change && madeGone(novelId, b.change)).map((b) => b.label);
  if (missed.length) out.push(`${listOf(missed)} no longer ${missed.length === 1 ? 'reads' : 'read'} that way.`);
  if (!made.length && !mended.length) out.push('Nothing went in.');
  const held = (r.refused || []).filter((x) => x.held).length + (r.held || []).length;
  if (held) out.push(`${many(held, 'entry waits', 'entries wait')} with what the book says otherwise.`);
  const heldBook = (r.book || []).filter((b) => b.held).map((b) => b.label);
  if (heldBook.length) out.push(`${listOf(heldBook)} wait${heldBook.length === 1 ? 's' : ''} with what the book says otherwise.`);
  /* (his newer word with no words for it that hold: said as that — nothing of his spliced in: 2.12.41, the third review;
   * that its partner gave none only where it gave none, else that its words could not go in as they were: the fourth) */
  const unsaid = (r.changes || []).filter((c) => c.in === false);
  const noWords = unsaid.filter((c) => c.noWords).length;
  const couldNot = unsaid.filter((c) => c.couldNot).length;
  if (noWords) out.push(`${many(noWords, `newer word of ${ours} did`, `newer words of ${ours} did`)} not go in — ${his ? 'you' : 'your partner'} gave no words for ${noWords === 1 ? 'it' : 'them'}.`);
  if (couldNot) out.push(`${many(couldNot, `newer word of ${ours} did`, `newer words of ${ours} did`)} not go in — ${his ? 'your' : 'your partner’s'} words for ${couldNot === 1 ? 'it' : 'them'} could not go in as they were.`);
  if (unsaid.length - noWords - couldNot) out.push(`${many(unsaid.length - noWords - couldNot, `newer word of ${ours} did`, `newer words of ${ours} did`)} not go in.`);
  /* (his word over a page: said where an entry carried it, and where none did — never "as you said" for nothing: 2.12.41,
   * the third review) */
  const over = (r.conflicts || []).filter((c) => c.overruled);
  const overIn = over.filter((c) => c.in).length;
  if (overIn) out.push(`${many(overIn, `word of ${ours} went`, `words of ${ours} went`)} in over what the book says.`);
  if (over.length - overIn) out.push(`${many(over.length - overIn, `word of ${ours} over what the book says did`, `words of ${ours} over what the book says did`)} not go in.`);
  const waits = (r.conflicts || []).filter((c) => !c.overruled).length + (r.cannot || []).length;
  if (waits) out.push(`${many(waits, 'thing waits', 'things wait')} for ${your} word.`);
  const refused = (r.refused || []).filter((x) => !x.held).length;
  if (refused) out.push(`${many(refused, 'entry was', 'entries were')} not put in.`);
  if (Array.isArray(r.aside) && r.aside.length) out.push(`${many(r.aside.length, `thing ${his ? 'you' : 'it'} named quoted`, `things ${his ? 'you' : 'it'} named quoted`)} words that stand nowhere in the book or ${your} own words.`);
  const again = (r.keptAgain || []).map((k) => KEPT_WHAT[k]).filter(Boolean);
  if (again.length) out.push(`What the helper keeps of ${listOf(again)} is written again from the book.`);
  return out.join(' ');
}

/* ------------------------------------------------------------- asking */

/* the Quick adds before that ride with what he says next: the newest few answered */
const earlierRows = (novel) => quickLog(novel).filter((r) => r.state === 'done').slice(-4);
/* A ROW CARRIED THROUGH THE RENAMES MADE SINCE IT WAS SENT (2.12.42): a row made from then on keeps the book's rename
 * count. Where it is used again — the next request, and whether "keep mine" is the same words — those words take the
 * names the book uses now. The row he sees still shows his words as he typed them. A row from before, with no count,
 * stays as he typed it: the book cannot say which renames came after it. The change it made, and its Undo, are never
 * rewritten. */
const CARRY_KEYS = new Set(['said', 'verdict', 'talk', 'mine', 'against', 'was', 'now', 'why', 'label', 'name', 'rule', 'quote', 'error', 'againWhy']);
function carriedQuick(novel, row) {
  if (!row || typeof row.renameCount !== 'number') return row;
  const since = renamesSince(novel, row.renameCount);
  if (!since.length) return row;
  const walk = (v, key) => {
    if (typeof v === 'string') return CARRY_KEYS.has(key) ? renameIn(v, since) : v;
    if (Array.isArray(v)) {
      if (key === 'held' || key === 'questions') return v.map((x) => (typeof x === 'string' ? renameIn(x, since) : walk(x, key)));
      return v.map((x) => walk(x, key));
    }
    if (v && typeof v === 'object') {
      if (key === 'change' || key === 'undo') return v;
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(row, '');
}
/* his words back in the box, carried through the renames since that row — the row itself still shows them as typed */
export function wordsAgain(novelId, row) {
  const said = String((row && row.said) || '');
  if (!row || typeof row.renameCount !== 'number') return said;
  const since = renamesSince(store.peek('novel', novelId), row.renameCount);
  return since.length ? renameIn(said, since) : said;
}
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
  const named = entriesOf(novel).filter((e) => byWords.has(e.id) || names.some((n) => entryFor([e], n).entry));
  const ent = archivist.entriesFitted(named, Math.floor(room / 4));
  const pas = passagesNaming(novel, chapters, names, Math.floor(room / 2));
  /* what was said before in Quick add, the newest few (never the one being asked) — what came of each, where the app
   * said it, told again in his own voice (2.12.40, the review) */
  const earlier = earlierRows(novel).map((r) => { const row = carriedQuick(novel, r); return row.verdictBy === 'app' ? { ...row, verdict: plainAccount(row, { his: true, novelId }) } : row; });
  const request = quickAddRequest({ words, earlier, ...prem, ...ent, ...pas });
  /* (whole: an entry past its room rides by its opening only — prompts.js entryRow — and is never written over from that) */
  const whole = ent.entries.filter((e) => String(entryWords(e) || '').length <= PREMISE_ROOM);
  return { request, shown: new Map(whole.map((e) => [e.id, String(e.text || '')])) };
}

/* AN ANSWER ASKED BEFORE A NAME WAS CHANGED EVERYWHERE (2.12.41, the fourth review's round — the Timeline's review, its
 * F1 class: a Quick add sent, then Tom made Thomas everywhere while its partner answered, wrote "Tom" — a stray entry for
 * a name the book no longer uses, his entry named back, a change of his words quoting words that stand nowhere now):
 * every change of names made since its words were taken (`count`: shape.js renameCount, then) is made in what it would
 * write and in the rows it shows, one change at a time, as in the book (names.js renameIn) — but for words it quotes
 * that stand untouched in the book as it is now (`against`, `was`, `rule`, `quote`, found as the look-ups find them:
 * stands): those are the book's own, and stay as it has them, to be found where they stand. (Never by a quote's letters
 * inside other words, as archivist.js renamedAnswer reads the pages it asked with: "Thom" stands in "Thomas" so; nor
 * by the old name standing inside the new one — "the clan of Oda" stands in "the clan of Oda Nobunaga", which is the
 * quote renamed, and his "Oda" made "Takeda" there would leave "Takeda Nobunaga": a quote stays as it was only where it
 * stands and its renamed words stand nowhere.) */
const QUOTED = new Set(['against', 'was', 'rule', 'quote']);
function renamedFrom(value, novelId, count) {
  const { novel, chapters } = bookNow(novelId);
  const since = renamesSince(novel, count);
  if (!since.length) return value;
  const places = placesOf(novel, chapters);
  const standsIn = (q) => places.some((p) => stands(p.text, q));
  const walk = (v, key) => {
    if (typeof v === 'string') {
      const r = renameIn(v, since);
      return r !== v && QUOTED.has(key) && standsIn(v) && !standsIn(r) ? v : r;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value, '');
}
const want = (o) => isObj(o) && (Array.isArray(o.entries) || typeof o.verdict === 'string' || Array.isArray(o.conflicts));
const wantAgain = (o) => isObj(o) && Array.isArray(o.entries);
/* THE PARTNER'S OWN CHECK, said before the record — the sentences, never the object (2.12.46): the words before the
 * object its answer was read from, where that reading found it (jsonutil.js findFirstObject `at` — 2.12.63, the review:
 * they were cut at a second guess, the first {", so a brace in its words cut them short, a record in curly quotes left
 * none, and "Here's the record:" stayed). Its thinking and a code fence's marks are not its words, and nor is a last line
 * that only leads into the record — the words of that line after its last full stop, up to the colon it ends on. */
function talkBefore(before) {
  const lines = String(before || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/(?:`{3,}|~{3,})[\w+-]*/g, '').replace(/\s+$/, '').split('\n');
  const last = lines[lines.length - 1];
  if (/[:：]$/.test(last)) {
    const stop = last.match(/^([\s\S]*[.!?…][”’"')\]]*)\s+[^.!?…]*$/);
    lines[lines.length - 1] = stop ? stop[1] : '';
  }
  const prose = lines.join(' ').replace(/\s+/g, ' ').trim();
  return prose.length >= 12 ? prose.slice(0, 1800) : '';
}
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
  /* (its time and its beat in the phone's time, as another browser judges them: askingWhere — 2.12.41, the review) */
  const at = rowTime(quickLog(novel0));
  lastAt = at;
  const row = { id: newId('qa'), at, said: t, state: 'asking', beat: store.phoneNow(), tab: store.CLIENT, browser: store.BROWSER, renameCount: renameCount(novel0) };
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
     * whole (context.js stats.entries) — each with its words as they were then, and the count of changes of names then */
    let seenNow = { at: 0, shown: new Map() };
    /* (how many changes of names the book had when its words were taken for the request now answered, and when he sent
     * his words — renamedFrom; his words as the book names them now, for what is asked and judged: `said`) */
    const sentAt = renameCount(novel0);
    let takenAt = sentAt;
    let said = t;
    /* (`extra`: its own earlier answer and what is asked of it again, each with the count it was written at — `at` —
     * carried, with his words, to the book's names as its words are taken: a request in one book's names, and the answer
     * it gives renamed from then) */
    const build = (extra) => (c) => {
      const { novel, chapters } = bookNow(novelId);
      takenAt = renameCount(novel);
      said = renamedFrom(t, novelId, sentAt);
      const req = requestFor(novelId, said, c);
      const a = assemble({ house, novel, chapters, conn: c, purpose: 'partner', target: { chapterId: target }, turns: [], request: req.request, tools: false });
      const whole = new Map(req.shown);
      for (const ref of a.stats.entries || []) {
        if (!String(ref).startsWith('e:')) continue;
        const e = entriesOf(novel).find((x) => x.id === String(ref).slice(2));
        if (e) whole.set(e.id, String(e.text || ''));
      }
      seenNow = { at: takenAt, shown: whole };
      const more = extra.map((m) => ({ role: m.role, content: m.at === undefined ? m.content : renamedFrom(m.content, novelId, m.at) }));
      /* the partner's own room: his Longest reply raised to the floor a block of it needs — a block cut off is lost whole
       * (context.js partnerReply; 2.12.40, the audit: Ideas' length was sent, and both tries were cut) */
      return { system: a.system, systemParts: a.systemParts, messages: [...a.messages, ...more], maxTokens: partnerReply(c, 'scene', wireOf(c) === 'anthropic'), refuse: a.refuse, least: a.stats.least, seed: a.seed };
    };
    const opts = { stream: true, signal: ctl.signal, leash: true, noPrefill: true, noStructured: true };
    /* the record an answer gives and the words it said before it, from the one reading that found the record — an
     * answer cut off counts only where no brace before the record leaves it open (jsonutil.js `whole`); written only in
     * its thinking, the last whole answer there, and no words of its own: its thinking is never said to him */
    const readOut = (o, wanted) => {
      const whole = Boolean(o.cut);
      const found = findFirstObject(o.text, wanted, { whole });
      if (found) return { obj: found.value, talk: talkBefore(String(o.text || '').slice(0, found.at)) };
      const thought = !String(o.text || '').trim() && o.thinking ? findLastObject(o.thinking, wanted, { whole }) : null;
      return thought ? { obj: thought.value, talk: '' } : null;
    };
    const stopped = () => ({ ok: false, stopped: true, row: settle({ state: 'stopped' }), giveBack: t });
    let out = await ask(conn, { ...opts, build: build([]) });
    if (out.stopped) return stopped();
    if (!out.ok) return { ok: false, error: out.error || 'no answer came', row: settle({ state: 'failed', error: line(out.error || 'no answer came', 400) }), giveBack: t };
    let reply = readOut(out, want);
    let obj = reply && reply.obj;
    let answered = out;
    /* once more, told what went wrong (as the helper is) — its talk then is the words of the answer its record was read
     * from: the first one's record could not be read, so nothing says where in it the record began (its verdict, the
     * same sentences, stands where it says none) */
    if (!obj) {
      const first = out;
      out = await ask(conn, { ...opts, build: build([{ role: 'assistant', content: String(first.text || '').slice(0, 20000) || '(nothing)', at: takenAt }, { role: 'user', content: first.cut ? JSON_CUT : JSON_AGAIN }]) });
      if (out.stopped) return stopped();
      reply = out.ok ? readOut(out, want) : null;
      obj = reply && reply.obj;
      if (!obj) {
        const why = !out.ok ? (out.error || 'no answer came') : first.cutBy === 'length' && out.cutBy === 'length' ? CUT_TWICE : 'its answer could not be read';
        return { ok: false, error: why, row: settle({ state: 'failed', error: line(why, 400) }), giveBack: t };
      }
      answered = out;
    }
    let talk = reply.talk;
    let seen = seenNow;
    let { novel, chapters } = bookNow(novelId);
    if (!novel) return { ok: false, error: 'the book was closed' };
    /* (a name changed everywhere while it answered: carried into it, and into its words asked again with — renamedFrom) */
    obj = renamedFrom(obj, novelId, takenAt);
    const answeredText = renamedFrom(String(answered.text || ''), novelId, takenAt);
    said = renamedFrom(t, novelId, sentAt);
    talk = renamedFrom(talk, novelId, takenAt);
    let carriedTo = renameCount(novel);
    const read = readAnswer(novel, chapters, obj);
    let entries = read.entries;
    let over = read.over;
    let again = '';
    let againWhy = '';
    /* the look-ups part from how it sorted them: asked once more, with the rows as they stand, for the entries again */
    const fix = toSetRight(read, novel, finderFor(novel), said);
    if (fix) {
      out = await ask(conn, { ...opts, build: build([{ role: 'assistant', content: answeredText.slice(0, 20000) || '(nothing)', at: carriedTo }, { role: 'user', content: quickAgainRequest(fix), at: carriedTo }]) });
      if (out.stopped) return stopped();
      ({ novel, chapters } = bookNow(novelId));
      if (!novel) return { ok: false, error: 'the book was closed' };
      /* (and one changed while it answered again: the first answer's rows and entries, what was asked of it, and his words
       * carry it as well) */
      if (renamesSince(novel, carriedTo).length) {
        for (const k of Object.keys(read)) read[k] = renamedFrom(read[k], novelId, carriedTo);
        fix.again = renamedFrom(fix.again || [], novelId, carriedTo);
        entries = read.entries;
        over = read.over;
        said = renamedFrom(t, novelId, sentAt);
      }
      const obj2 = out.ok ? (readOut(out, wantAgain) || {}).obj : null;
      if (obj2) Object.assign(obj2, renamedFrom(obj2, novelId, takenAt));
      if (obj2) {
        again = 'answered';
        seen = seenNow;
        const second = readAnswer(novel, chapters, { entries: obj2.entries, conflicts: obj2.conflicts, changes: obj2.changes });
        /* ITS ROWS LOOKED UP AS THE FIRST ANSWER'S ARE (2.12.40, the review: only one whose "mine" read the same, folded,
         * was kept — a page it quoted for his words said a little otherwise went unsaid): words a page holds say the book
         * says otherwise, and the row set aside that they answer is let go; words that stand only in his own earlier words
         * are his newer word — a change it lists now for words of his it would have said both of, too (2.12.41, the third
         * review), told as his words in this Quick add that it carries; words quoted from nowhere are set aside */
        for (const c of second.conflicts) {
          if (read.conflicts.some((x) => x.passageId === c.passageId && foldName(x.against) === foldName(c.against))) continue;
          const i = read.aside.findIndex((x) => sameWords(x.mine, c.mine));
          if (i >= 0) read.aside.splice(i, 1);
          read.conflicts.push({ ...c, said: 'again' });
        }
        for (const c of second.changes) {
          if (read.changes.some((x) => foldName(x.was) === foldName(c.was))) continue;
          if (!c.mine) {
            /* (a change it lists for words of his it would have said both of, or that his newer words say "not" to: told as
             * his words in this Quick add that ask for it — that sentence of his newer words — and held to the keep rule as
             * every change is, his "not" with it: 2.12.41, the fourth review) */
            const was = (fix.again || []).find((x) => (x.why === 'both' || x.why === 'denied') && (stands(x.his, c.was) || stands(c.was, x.his)));
            c.mine = line(was && was.why === 'denied' ? was.not : hisOwnFor(was ? was.said : c.now || c.was, said), 600);
          }
          read.changes.push({ ...c, said: 'again' });
        }
        for (const x of second.aside) if (x.mine && !read.aside.some((y) => sameWords(y.mine, x.mine))) read.aside.push({ ...x, said: 'again' });
        /* his own words written again for his newer word — his book's, and an entry's whose change nothing it wrote carried */
        for (const w of Array.isArray(obj2.changes) ? obj2.changes.filter(isObj) : []) {
          const c = read.changes.find((x) => (x.kind === 'about' || x.kind === 'entry') && !x.now && foldName(x.was) === foldName(w.was));
          if (c && line(w.now, 4000)) c.now = line(w.now, 4000);
        }
        /* MERGED BY NAME (2.12.40, the review: the second answer's entries took the place of all the first's, so the good
         * ones it did not give again were let go without a word): the second answer's entry wins where it gives one — the
         * same one by the bibliography's own name matching, his entry's or a new name's (bibliography.js entryFor — 2.12.41,
         * the review: "Iron Covenant" and "The Iron Covenant" went in as two); the first's others go in as it wrote them */
        const firsts = read.entries.map((e, i) => ({ id: `a${i}`, name: line(e.name, 200), aka: Array.isArray(e.aka) ? e.aka : [], kind: kindSaid(e.kind) || 'lore' }));
        const keyOf = (e) => {
          const n = line(e.name, 200);
          /* (for the kind it says, as putting it in finds it: putEntries) */
          const kind = kindSaid(e.kind);
          const m = entryFor(entriesOf(novel), n, { kind }).entry;
          if (m) return `e:${m.id}`;
          const f = entryFor(firsts, n, { kind }).entry;
          return f ? `n:${f.id}` : `x:${n}`;
        };
        const byKey = new Map(second.entries.map((e) => [keyOf(e), e]));
        const all = [];
        for (const e of read.entries) {
          const theirs = byKey.get(keyOf(e));
          if (!theirs) all.push(e); else if (!all.includes(theirs)) all.push(theirs);
        }
        for (const e of second.entries) if (!all.includes(e)) all.push(e);
        entries = all.slice(0, ENTRIES_MOST);
        over = [...new Set([...all.slice(ENTRIES_MOST).map((e) => line(e.name, 200)), ...read.over, ...second.over])];
      } else {
        again = 'failed';
        /* (why, as it was: cut off, refused, or no answer that could be read — 2.12.41, the review: always the last) */
        againWhy = !out.ok ? `no answer came — ${line(out.error || 'its connection gave none', 300)}` : out.cutBy === 'length' ? 'its answer was cut off at the reply’s length' : 'it gave no answer that could be read';
      }
    }
    /* A PAGE HE SAID HIS WORD STANDS OVER (2.12.41, the review): only one that waited for his word in the newest Quick add
     * before this one — the row he is answering — the same page's words and the same words of his; never one it marks so
     * on its own, nor one from an older row (2.12.41, the third review: a mark on any conflict of the four newest rows let
     * a page's contradiction in where he had said nothing of it) */
    const log = quickLog(novel);
    const here = log.findIndex((r) => r.id === row.id);
    const answering = carriedQuick(novel, log.slice(0, here < 0 ? log.length : here).filter((r) => r.state === 'done').slice(-1)[0]);
    const waited = answering ? (answering.conflicts || []).filter((x) => !x.overruled) : [];
    const sameQuote = (x, y) => foldName(x) === foldName(y) || stands(x, y) || stands(y, x);
    let overNot = 0;
    for (const c of read.conflicts) {
      if (!c.overruled) continue;
      if (waited.some((x) => x.passageId === c.passageId && sameQuote(x.against, c.against) && (sameWords(x.mine, c.mine) || sameQuote(x.mine, c.mine)))) continue;
      delete c.overruled;
      overNot += 1;
    }
    /* WHAT WAITS FOR HIS WORD — a page that says otherwise, a rule it cannot be by: nothing goes in that says it, on any
     * path (heldBy — 2.12.41, the review: only what was asked again was held, and loosely) */
    const standing = [...read.conflicts.filter((c) => !c.overruled), ...read.cannot.map((c) => ({ ...c, against: c.rule, cannot: true }))];
    const shown = { conflicts: read.conflicts, changes: read.changes, cannot: read.cannot, aside: read.aside, questions: read.questions, ...(again ? { again } : {}), ...(againWhy ? { againWhy } : {}) };
    /* (laid into as it goes: what went in before anything goes wrong is said, never "nothing" — 2.12.41, the review) */
    const got = { added: [], refused: [], put: [], unput: [], gave: [], waits: [] };
    partial = { ...shown, added: got.added, refused: got.refused };
    /* (the entries it read whole, as they read with the names changed since: an entry a name changed everywhere changed
     * in nothing else was read whole all the same — never "it had not read your entry whole" for a name made new) */
    const readWhole = new Map([...seen.shown].map(([id, x]) => [id, renamedFrom(x, novelId, seen.at)]));
    putEntries(novelId, entries, readWhole, read.changes, said, { got, standing, againWhy });
    const { added, refused, put } = got;
    for (const name of over) refused.push({ name, why: `only ${MOST_WORDS} go in from one answer — send it in a Quick add of its own` });
    const book = mendBook(novelId, read.changes, finderFor(store.peek('novel', novelId)), said, { standing, againWhy });
    partial.book = book;
    /* WHETHER EACH NEWER WORD OF HIS WENT IN (2.12.40, the review: one no entry carried was listed as though it had): in
     * his entry, with what stands now in place of the words it changed; not, where his partner gave no words for it that
     * hold (`noWords` — nothing of his spliced in: 2.12.41, the third review), or the entry it goes into waits (`waits`);
     * in What it's about, by its own row; else carried by an entry that went in — never by one for an entry of his that
     * did not take it */
    const unput = new Set(got.unput);
    const gave = new Set(got.gave);
    const waiting = new Set(got.waits);
    read.changes.forEach((c, i) => {
      if (c.kind === 'about') {
        const b = book.find((x) => x.at === i);
        c.in = Boolean(b && b.status === 'made');
        if (b && b.noWords) c.noWords = true;
        if (b && b.couldNot) c.couldNot = true;
        return;
      }
      const p = put.find((x) => x.c === c);
      if (p) { c.in = true; c.put = line(p.now, 1600); return; }
      if (waiting.has(c)) { c.in = false; c.waits = true; return; }
      if (unput.has(c)) { c.in = false; if (gave.has(c)) c.couldNot = true; else c.noWords = true; return; }
      c.in = c.kind === 'entry' ? false : Boolean(carriedBy(c.mine, added, novelId));
    });
    /* (his word over a page: where an entry that went in carries it — said so, never "it goes in" where nothing did) */
    for (const c of read.conflicts) if (c.overruled) c.in = carriedBy(c.mine, added, novelId) || false;
    /* each row set aside: whether his words went in after all — never said so unchecked */
    for (const x of read.aside) { const by = carriedBy(x.mine, added, novelId); if (by) x.in = by; }
    /* WORDS THAT STAND ONLY IN WHAT THE HELPER KEEPS of what the book is about, or of how it reads: it writes that again
     * from the book (archivist.js keepAgain — its own "Write it from the book again"), and the row says so (2.12.40, the
     * review: a change quoting it was set aside, and nothing put it right) */
    const keeps = [...new Set(read.aside.map((x) => x.kept).filter(Boolean))].filter((k) => keptByHelper(store.peek('novel', novelId) || {}).includes(k));
    const helper = keeps.length ? connFor(store.peek('house', 'house') || {}, 'helper') : null;
    const keptAgain = helper ? keeps : [];
    /* its verdict only where the look-ups bear it out, every entry went in as it wrote it and none was let go, his book's
     * words were put right in its words, every newer word of his went in in its words, and every page it says his word
     * stands over was the one he was answering, and went in */
    const agreed = !fix && !refused.length && !overNot && book.every((b) => b.status === 'made') && added.every((a) => !a.notAsWritten)
      && read.changes.every((c) => c.in) && read.conflicts.every((c) => !c.overruled || c.in) && Boolean(read.verdict);
    const facts = { ...shown, added, refused, book, ...(keptAgain.length ? { keptAgain } : {}), ...(keeps.length && !helper ? { keptNone: true } : {}) };
    const done = settle({ state: 'done', ...facts, ...(talk ? { talk } : {}), verdict: agreed ? read.verdict : plainAccount(facts, { novelId }), verdictBy: agreed ? 'partner' : 'app' });
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
        return { ok: true, row: settle({ state: 'done', ...partial, book: partial.book || [], verdict: plainAccount({ ...partial }, { novelId }), verdictBy: 'app' }) };
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
