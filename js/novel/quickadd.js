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
import { picked, passageNumbers, chapterLabel, premisesOf } from './shape.js';
import { quickAddRequest, quickAgainRequest, keptByHelper, PREMISE_ROOM, JSON_AGAIN, JSON_CUT } from './prompts.js';
import { parseFirstObject, parseLastObject, closesWhole } from './jsonutil.js';
import { findIn } from './search.js';
import { namesAndFigures, foldedText, foldName, nearName } from './names.js';
import { entriesOf, entriesNamed, entryFor, entryWords, kindSaid, nameForms, makeFinder, formKey } from './bibliography.js';
import { makeChange, undoChange } from './changes.js';
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
  const about = read.changes.filter((c) => c.kind === 'about' && !nowFor(c, bookCtx(novel, c.field, finder, words)));
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
 * [{words}] in order, words [] where it governs none */
const NEG = /^(?:not|no|never|none|nothing|nobody|nowhere|neither|nor|cannot|without|\p{L}+n['’]t)$/u;
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
        if (!NEG.test(w)) return;
        const after = p.slice(i + 1).flatMap(notTells);
        out.push({ words: after.length ? after : p.slice(0, i).flatMap(notTells).slice(-1) });
      });
    }
  }
  return out;
}
const saysNoTo = (x, w) => x.negs.some((n) => n.words.some((g) => g === w || regular(g, w)));
/* WHETHER SOME WORDS SAY "NOT" AS THE WORDS THEY ANSWER TO DO — each "not" judged by the last word it says no to that
 * both give ("feeds on sailors, never on children" says no to children as "never feeds on children" does), as the first of
 * `refs` that gives that word has it; and a "not" of theirs to words none of `refs` gives is never theirs to say */
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
      const given = n.words.filter((w) => keptIn(w, R.words));
      if (!given.length) continue;
      const k = given[given.length - 1];
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
 * his line, `line`), his words in this Quick add (`box`), and the reader of names made once for the answer */
function entryCtx(cur, finder, words) {
  const read = nameReader(finder, cur);
  const prep = prepared(read);
  return { prep, read, words: String(words || ''), box: prep(words), entry: prep([cur.name, ...(cur.aka || []), cur.line, cur.text].filter(Boolean).join('\n')),
    own: new Set(wordsOf([cur.name, ...(cur.aka || [])].join(' '))), line: String(cur.line || '').trim() ? prep(cur.line) : null };
}
/* …and What it's about, how it reads or where it's headed, as his own words a newer word of his changes */
function bookCtx(novel, field, finder, words) {
  const read = nameReader(finder, null);
  const prep = prepared(read);
  return { prep, read, words: String(words || ''), box: prep(words), entry: prep(String((novel && novel[BOOK_FIELD[field]]) || '')), own: new Set(), line: null };
}
/* the words some words would bring into his entry that neither the words they stand in place of (`base`), his entry, nor
 * his words in this Quick add say — a little word is no word brought; a figure is */
function unbacked(o, base, ctx) {
  const out = [];
  for (const w of o.tell) if (!LITTLE.has(w) && !keptIn(w, base.tell) && !keptIn(w, ctx.entry.tell) && !keptIn(w, ctx.box.tell)) out.push(w);
  for (const [v, said] of o.figures) if (!base.figures.has(v) && !ctx.entry.figures.has(v) && !ctx.box.figures.has(v)) out.push(said);
  return out;
}
/* what his newer word says that his entry lacks: its words, its figures — {words, figures, mine} */
function freshOf(c, ctx) {
  const mine = ctx.prep(c.mine);
  return { mine, words: [...mine.says].filter((w) => !keptIn(w, ctx.entry.says)), figures: [...mine.figures.keys()].filter((v) => !ctx.entry.figures.has(v)) };
}
/* WHETHER SOME WORDS CARRY HIS NEWER WORD: words of it his entry lacks — or, where it brings none (a "not" put in or taken
 * out), all it says but the entry's own name, with "not" as his newer word has it and not as the words it changes — and
 * never still the words it changes */
function carries(o, c, ctx) {
  if (stands(o.text, c.was)) return false;
  const f = freshOf(c, ctx);
  if (f.words.length || f.figures.length) return f.words.some((w) => keptIn(w, o.says)) || f.figures.some((v) => o.figures.has(v));
  const all = [...f.mine.says].filter((w) => !ctx.own.has(w));
  return all.length > 0 && all.every((w) => keptIn(w, o.says)) && negsAgree(o, [f.mine]) && !negsAgree(o, [ctx.prep(c.was)]);
}
/* whether some words put in place of the words his newer word changes keep every name and figure of those that his newer
 * word does not change — one of them let go only where his newer word brings one of its own */
function wasKept(o, c, ctx) {
  const was = ctx.prep(c.was);
  const f = freshOf(c, ctx);
  if (!f.figures.length && [...was.figures.keys()].some((v) => !o.figures.has(v))) return false;
  if (namesLostIn(was.names, o.names).length && !namesLostIn(f.mine.names, ctx.entry.names).length) return false;
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
 * "…the Covenant: “Never again.” She is feared." was one sentence, and "She is feared." was lost) */
const SENTENCE_GAP = /(?<=[.!?…]["”’»)\]]*)\s+|[^\S\n]*\n\s*/g;
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
/* (2.12.41, the third review: no words of his are ever spliced into his entry, his line or What it's about in place of
 * the words his newer word changes — his words in Quick add are often an order ("Make her eyes green"), and the splice
 * wrote "Her eyes are Make her eyes green and cold" and "Emilia not trust the Covenant", with "as you said it" on the
 * row. Where his partner gives no words that hold, asked once more and still none, nothing is put in for that newer word:
 * the row says it did not go in, with Ask again.) */

/* WHAT A SENTENCE TELLS OF EACH THING IN IT (2.12.41, the third review: an added "Emilia has green eyes." went in beside
 * his "Emilia has grey eyes." — the entry said both): the words that tell what a thing is — right before it, after
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
/* one more of a thing, said so: "a white raven too", "also", "another", "a second", "as well" */
const ONE_MORE = /\b(?:too|also|another|second|third|besides)\b|\bas well\b/i;
/* WHETHER AN ADDED SENTENCE WOULD SAY BOTH ONE OF HIS AND ANOTHER WAY OF IT: the same thing of the same one ("eyes", hers)
 * told with a word of his newer words ("green") where his sentence tells it with one they never give ("grey") — and with
 * no change listed for it, the entry would say both. Never where it tells of one more of a thing ("keeps a white raven
 * too"), where the two tell it by two doings ("sews a red cloak" beside his "wears a black cloak"), or where it tells
 * his of it too ("keeps a white raven beside her black raven") */
function saysBoth(o, s, ctx) {
  const vo = valuesOf(o.text, ctx.own);
  if (!vo.length) return false;
  const more = ONE_MORE.test(o.text);
  for (const a of valuesOf(s.text, ctx.own)) {
    const same = vo.filter((b) => a.owner === b.owner && (a.thing === b.thing || regular(a.thing, b.thing)));
    for (const b of same) {
      if (a.verb && b.verb && !(a.verb === b.verb || regular(a.verb, b.verb))) continue;
      if (b.counted && more) continue;
      const his = [...a.words].filter((w) => !keptIn(w, b.words));
      const hisFigures = [...a.figures].filter((v) => !b.figures.has(v));
      if (!his.length && !hisFigures.length) continue;
      if (same.some((x) => x !== b && his.every((w) => keptIn(w, x.words)) && hisFigures.every((v) => x.figures.has(v)))) continue;
      const its = [...b.words].filter((w) => !keptIn(w, a.words));
      const itsFigures = [...b.figures].filter((v) => !a.figures.has(v));
      const newer = its.some((w) => keptIn(w, ctx.box.says)) || itsFigures.some((v) => ctx.box.figures.has(v));
      /* (his newer words still saying his word, as his: he wants both) */
      const still = his.some((w) => keptIn(w, ctx.box.says) && !saysNoTo(ctx.box, w)) || hisFigures.some((v) => ctx.box.figures.has(v));
      if (newer && !still) return true;
    }
  }
  return false;
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
/* the words two sentences say "not" to otherwise — each judged as negsAgree judges it, by the last word it says no to that
 * both give */
function notsOn(R, x) {
  const out = [];
  for (const [a, b] of [[R, x], [x, R]]) {
    for (const n of a.negs) {
      const given = n.words.filter((w) => keptIn(w, b.words));
      if (!given.length) continue;
      const k = given[given.length - 1];
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
 * they stand. {text, whole, asWritten, why, joined, put: [{c, now, by: 'now' | 'carrier'}], unput: [c], back, both} */
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
  const freed = new Set();
  const put = [];
  const unput = [];
  for (const c of changes) {
    const span = spanOf(had, c.was);
    const at = span ? pieces.map((p, i) => i).filter((i) => pieces[i].s.trim() && pieces[i].end > span.start && pieces[i].start < span.end) : [];
    if (!at.length) { unput.push(c); continue; }
    const given = nowFor(c, ctx);
    /* (two of his newer words in one sentence of his: the second put right in what stands there now — its words for them,
     * or the sentence put there carrying it with every name and figure of them kept — else not put in) */
    if (at.some((i) => freed.has(i))) {
      const i = at.find((k) => freed.has(k) && out[k].s.trim());
      const sp = i === undefined ? null : spanOf(out[i].s, c.was);
      if (sp && given) { out[i].s = putIn(out[i].s, sp, given); put.push({ c, now: out[i].s.trim(), by: 'now' }); continue; }
      const there = i === undefined ? [...carriers].map((j) => theirs[j]) : sp ? [] : [prep(out[i].s)];
      const by = there.find((o) => carries(o, c, ctx) && wasKept(o, c, ctx));
      if (by) { put.push({ c, now: by.text, by: 'carrier' }); continue; }
      unput.push(c);
      continue;
    }
    const from = pieces[at[0]].start;
    const to = pieces[at[at.length - 1]].end;
    const whole = had.slice(from, to);
    const rel = { start: span.start - from, end: span.end - from };
    let now = '';
    let shown = '';
    let by = 'now';
    if (given) now = putIn(whole, rel, given).trim();
    else {
      const j = carrierOf(c, theirs, ctx, whole);
      /* (no words for it that hold: his stand as he wrote them, and it is said — never his own words spliced in) */
      if (j < 0) { unput.push(c); continue; }
      /* (one sentence of the answer carrying two of his newer words: said once, where the first stood) */
      now = placed.has(j) ? '' : theirs[j].text;
      shown = theirs[j].text;
      placed.add(j);
      carriers.add(j);
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
  let lost = 0;
  let lostNot = 0;
  theirs.forEach((o, j) => {
    if (placed.has(j)) return;
    if (changes.some((c) => stands(o.text, c.was))) return;
    const brings = [...o.says].filter((w) => keptIn(w, ctx.box.says) && !keptIn(w, nowSays)).length
      + [...o.figures.keys()].filter((v) => ctx.box.figures.has(v) && !nowFigures.has(v)).length;
    /* one that would say both a sentence of his — or his line — and another way of it, with no change listed for it:
     * never in, whatever it brings — a thing of his told another way by his newer words ("green eyes" for his "grey"), or
     * a "not" of his said otherwise as his newer words say it ("drinks blood" for his "does not drink blood") */
    const mine = [...hisNow, ...(ctx.line ? [ctx.line] : [])];
    const not = !negsAgree(o, [...standing, ctx.box]);
    const clash = (not && mine.find((s) => { const ks = notsOn(o, s); return ks.length > 0 && ks.every((k) => keptIn(k, ctx.box.words) && saysNoTo(ctx.box, k) === saysNoTo(o, k)); }))
      || mine.find((s) => saysBoth(o, s, ctx));
    if (clash) { both.push({ said: o.text, his: clash.text }); return; }
    /* a sentence of his said again in words his entry and his newer words never give, or with a "not" his entry and his
     * newer words do not say: his stands */
    const said = standing.find((s) => saidAgain(o, s, ctx));
    if (said || not) {
      if (brings) {
        if (said) lost += 1; else lostNot += 1;
        const his0 = said || standing.find((s) => !negsAgree(o, [s]));
        back.push({ said: o.text, his: his0 ? his0.text : '', why: said ? 'again' : 'not' });
      }
      return;
    }
    if (!brings) return;
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
  return { text: whole ? offered : text, whole, asWritten, why, joined, put: put.map(({ c, now, by }) => ({ c, now, by })), unput, back, both };
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
    quoted.forEach((c, k) => {
      const sp = spanOf(l, c.was);
      if (!sp || !given[k]) { unput.push(c); return; }
      l = putIn(l, sp, given[k]);
      by.push({ c, by: 'now' });
    });
    if (!by.length) return { line: '', how: '', put: [], unput };
    return { line: l, how: 'now', put: by.map((x) => ({ ...x, now: l })), unput };
  }
  if (!S || said === mine) return { line: '', how: '', put: [], unput: [] };
  const M = ctx.prep(mine);
  return holds(S, M, ctx.box) && !unbacked(S, M, ctx).length ? { line: said, how: 'theirs', put: [], unput: [] } : { line: '', how: 'kept', put: [], unput: [] };
}

/* AN ENTRY OF HIS WITH WHAT ONE ANSWER WROTE FOR IT (`e`, or null where it wrote none): the words to write, and what came
 * of each — the same for putting it in (putEntries) and for asking whether it can go in (dryRun), so the two never part.
 * Each newer word of his on it is put in (`put`) or not (`unput`: no words for it that hold, or words it quotes that stand
 * neither in its words nor its line). {text: null — his stands, line, lineHow, how, why, whole, asWritten, joined, put,
 * unput, back, both} */
function entryOp(cur, e, changes, ctx, seenWhole) {
  const had = String(cur.text || '').trim();
  const said = e ? line(e.line, 400) : '';
  const offered = e ? String(e.text || '').trim() : '';
  const adds = e ? String(e.add || '').trim() : '';
  const mine = changes.filter((c) => c.kind === 'entry' && c.entryId === cur.id);
  const inText = mine.filter((c) => stands(had, c.was));
  const out = { text: null, line: '', lineHow: '', how: '', why: '', whole: false, asWritten: true, joined: null, put: [], unput: [], back: [], both: [] };
  if (offered || adds || inText.length) {
    const m = mergeEntry({ had, offered, adds, changes: inText, ctx, seenWhole });
    if (m.text !== had) out.text = m.text;
    out.how = m.whole ? 'whole' : 'merged';
    out.why = m.why;
    out.whole = m.whole;
    out.asWritten = m.asWritten;
    if (!m.whole) out.joined = m.joined;
    out.put = m.put;
    out.unput = m.unput;
    out.back = m.back;
    out.both = m.both;
  }
  const ln = lineFor(cur, said, mine, ctx);
  out.line = ln.line;
  out.lineHow = ln.how;
  out.put = [...out.put, ...ln.put];
  /* (a newer word put in nowhere: words it quotes in neither the entry's words nor its line, or none that hold for it) */
  const nowhere = mine.filter((c) => !stands(had, c.was) && !stands(String(cur.line || ''), c.was));
  out.unput = [...new Set([...out.unput, ...ln.unput, ...nowhere])].filter((c) => !out.put.some((p) => p.c === c));
  if (said && (ln.line || String(cur.line || '').trim()) !== said) out.asWritten = false;
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
/* whom a row is about: the entries and cards its words name (refs), every word of theirs written with a capital (words),
 * and those written so inside a sentence (sure: a capital opening one may be an order's "Make") */
const subjectOf = (m, a) => ({ refs: new Set([...m.names.all, ...a.names.all]), words: new Set(wordsOf(capsOf(`${m.text}\n${a.text}`))),
  sure: m.names.all.size + a.names.all.size + m.names.loose.length + a.names.loose.length > 0 });
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
 * the same name matching for the kind it says), nothing written: which newer words of his on an entry of his would go in
 * (`put`), and what it wrote that brings his newer words but cannot go in (`again`: [{name, said, his, why: 'again' |
 * 'not' | 'both'}]) — so the one ask again asks for those too */
function dryRun(read, novel, finder, words) {
  const entries = entriesOf(novel);
  const put = new Set();
  const again = [];
  const forEntry = new Map();
  for (const e of read.entries) {
    const m = entryFor(entries, line(e.name, 200), { kind: kindSaid(e.kind) }).entry;
    if (m && !forEntry.has(m.id)) forEntry.set(m.id, e);
  }
  for (const c of read.changes) if (c.kind === 'entry' && c.entryId && !forEntry.has(c.entryId)) forEntry.set(c.entryId, null);
  for (const [id, e] of forEntry) {
    const cur = entries.find((x) => x.id === id);
    if (!cur) continue;
    const r = entryOp(cur, e, read.changes, entryCtx(cur, finder, words), false);
    for (const p of r.put) put.add(p.c);
    for (const x of r.back) again.push({ name: cur.name, ...x });
    for (const x of r.both) again.push({ name: cur.name, ...x, why: 'both' });
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
    const cur = entryFor(entriesOf(novel), name, { kind }).entry;
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
      for (const c of r.unput) got.unput.push(c);
      /* (what it wrote would say both a sentence of his and another way of it: nothing of it goes in — said, with Ask
       * again; never both in his entry) */
      if (r.both.length) { waits({ name, why: bothWhy(r.both[0], againWhy), both: true }); return; }
      if (r.text !== null) op.text = r.text;
      if (r.line && r.line !== String(cur.line || '').trim()) op.line = r.line;
      const nothing = op.text === undefined && op.line === undefined && !op.aka;
      /* (nothing of it to write, where what it brought of his newer words was in a sentence of his said again, or one that
       * said "not" otherwise than his words do: said so, never "the entry already says that") */
      if (nothing && r.joined && (r.joined.lost || r.joined.lostNot)) { got.refused.push({ name, why: lostWhy(r.joined), lost: true }); return; }
      /* (nothing to write where a newer word of his had no words that hold: its own row says it did not go in) */
      if (nothing && (repair || r.unput.length)) return;
      const before = new Set(sentencesOf(String(cur.text || '')));
      fresh = [...(op.text !== undefined ? sentencesOf(op.text).filter((s) => !before.has(s)) : []), ...(op.line ? [op.line] : [])];
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
  return got;
}

/* WHAT THE BOOK IS ABOUT, PUT RIGHT TO HIS NEWER WORD (2.12.40, the audit: a change to his own What it's about was only
 * said — the earlier words stayed, and rode to the writer beside the entry that says otherwise): the earlier words found
 * where they stand and the answer's words put in their place, through the partner's own change of the book's words, with
 * Undo these — held to the keep rule as his entry's are (nowFor), and never words that say what a page says otherwise
 * (heldBy; 2.12.41, the review); with no words for it that hold, nothing is put in, and the row says so (`noWords` —
 * 2.12.41, the third review: his own words were spliced in, "Emilia rules the Sanguelis her brother"). His premises are
 * his record of what he asked for a passage: never written again — the row says his newer word stands over them. One row
 * for each change of his book's words: {at (the change's place in the row), field, label, was, now?, status: 'made' |
 * 'refused', why?, held?, noWords?, change?} */
function mendBook(novelId, changes, finder, words, { standing = [], againWhy = '' } = {}) {
  const out = [];
  changes.forEach((c, at) => {
    if (c.kind !== 'about' || !BOOK_FIELD[c.field]) return;
    const base = { at, field: c.field, label: c.label, was: c.was };
    const parts = String(c.was).split(ELLIPSIS).map((x) => x.trim()).filter((x) => /[\p{L}\p{N}]/u.test(x));
    if (parts.length !== 1) { out.push({ ...base, status: 'refused', why: 'it quoted those words only in part, so they cannot be put right here — change them in About this book' }); return; }
    const novel = store.peek('novel', novelId);
    const text = String((novel && novel[BOOK_FIELD[c.field]]) || '');
    const [hit] = findIn(text, parts[0], { words: true, whole: true, max: 1 });
    if (!hit) { out.push({ ...base, status: 'refused', why: 'those words are not there any more' }); return; }
    const ctx = bookCtx(novel, c.field, finder, words);
    const given = nowFor(c, ctx);
    if (!given) { out.push({ ...base, status: 'refused', why: 'your partner gave no words for it', noWords: true }); return; }
    const span = { start: hit.start, end: hit.end };
    /* (as it stands put in: the stop after the words stays theirs, never two, and a sentence they open opens with a capital) */
    const next = putIn(text, span, given);
    const now = next.slice(hit.start, next.length - (text.length - hit.end));
    const on = heldBy([now], standing, ctx.prep);
    if (on) { out.push({ ...base, status: 'refused', why: heldWhy(on, againWhy), held: true }); return; }
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
 * partner's; 2.12.41, the review: "it named" there was the partner it spoke to). Every count from what the row holds, so a
 * row kept from before says it the same way. */
const many = (n, one, more) => (n === 1 ? `One ${one}` : `${numberWords(n)} ${more}`);
const KEPT_WHAT = { about: 'what it’s about', style: 'how it reads' };
function plainAccount(r, { his = false } = {}) {
  const your = his ? 'my' : 'your';
  const ours = his ? 'mine' : 'yours';
  const out = [];
  /* (every entry it put in went in, whatever was done with it since) */
  const made = (r.added || []).map((a) => a.name);
  const mended = (r.book || []).filter((b) => b.status !== 'refused').map((b) => b.label);
  if (made.length) out.push(`${listOf(made)} went into ${your} bibliography.`);
  if (mended.length) out.push(`${listOf(mended)} now say${mended.length === 1 ? 's' : ''} what ${your} newer words say.`);
  if (!made.length && !mended.length) out.push('Nothing went in.');
  const held = (r.refused || []).filter((x) => x.held).length + (r.held || []).length;
  if (held) out.push(`${many(held, 'entry waits', 'entries wait')} with what the book says otherwise.`);
  const heldBook = (r.book || []).filter((b) => b.held).map((b) => b.label);
  if (heldBook.length) out.push(`${listOf(heldBook)} wait${heldBook.length === 1 ? 's' : ''} with what the book says otherwise.`);
  /* (his newer word with no words for it that hold: said as that — nothing of his spliced in: 2.12.41, the third review) */
  const unsaid = (r.changes || []).filter((c) => c.in === false);
  const noWords = unsaid.filter((c) => c.noWords).length;
  if (noWords) out.push(`${many(noWords, `newer word of ${ours} did`, `newer words of ${ours} did`)} not go in — ${his ? 'you' : 'your partner'} gave no words for ${noWords === 1 ? 'it' : 'them'}.`);
  if (unsaid.length - noWords) out.push(`${many(unsaid.length - noWords, `newer word of ${ours} did`, `newer words of ${ours} did`)} not go in.`);
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
  const earlier = earlierRows(novel).map((r) => (r.verdictBy === 'app' ? { ...r, verdict: plainAccount(r, { his: true }) } : r));
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
  /* (its time and its beat in the phone's time, as another browser judges them: askingWhere — 2.12.41, the review) */
  const at = rowTime(quickLog(novel0));
  lastAt = at;
  const row = { id: newId('qa'), at, said: t, state: 'asking', beat: store.phoneNow(), tab: store.CLIENT, browser: store.BROWSER };
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
    let againWhy = '';
    /* the look-ups part from how it sorted them: asked once more, with the rows as they stand, for the entries again */
    const fix = toSetRight(read, novel, finderFor(novel), t);
    if (fix) {
      out = await ask(conn, { ...opts, build: build([{ role: 'assistant', content: String(answered.text || '').slice(0, 20000) || '(nothing)' }, { role: 'user', content: quickAgainRequest(fix) }]) });
      if (out.stopped) return stopped();
      const obj2 = out.ok ? readOut(out, wantAgain) : null;
      ({ novel, chapters } = bookNow(novelId));
      if (!novel) return { ok: false, error: 'the book was closed' };
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
            const was = (fix.again || []).find((x) => x.why === 'both' && (stands(x.his, c.was) || stands(c.was, x.his)));
            c.mine = line(hisOwnFor(was ? was.said : c.now || c.was, t), 600);
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
    const answering = log.slice(0, here < 0 ? log.length : here).filter((r) => r.state === 'done').slice(-1)[0];
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
    const got = { added: [], refused: [], put: [], unput: [], waits: [] };
    partial = { ...shown, added: got.added, refused: got.refused };
    putEntries(novelId, entries, seen, read.changes, t, { got, standing, againWhy });
    const { added, refused, put } = got;
    for (const name of over) refused.push({ name, why: `only ${MOST_WORDS} go in from one answer — send it in a Quick add of its own` });
    const book = mendBook(novelId, read.changes, finderFor(store.peek('novel', novelId)), t, { standing, againWhy });
    partial.book = book;
    /* WHETHER EACH NEWER WORD OF HIS WENT IN (2.12.40, the review: one no entry carried was listed as though it had): in
     * his entry, with what stands now in place of the words it changed; not, where his partner gave no words for it that
     * hold (`noWords` — nothing of his spliced in: 2.12.41, the third review), or the entry it goes into waits (`waits`);
     * in What it's about, by its own row; else carried by an entry that went in — never by one for an entry of his that
     * did not take it */
    const unput = new Set(got.unput);
    const waiting = new Set(got.waits);
    read.changes.forEach((c, i) => {
      if (c.kind === 'about') {
        const b = book.find((x) => x.at === i);
        c.in = Boolean(b && b.status === 'made');
        if (b && b.noWords) c.noWords = true;
        return;
      }
      const p = put.find((x) => x.c === c);
      if (p) { c.in = true; c.put = line(p.now, 1600); return; }
      if (waiting.has(c)) { c.in = false; c.waits = true; return; }
      if (unput.has(c)) { c.in = false; c.noWords = true; return; }
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
