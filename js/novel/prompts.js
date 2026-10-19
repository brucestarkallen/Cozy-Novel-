/* Cozy Novel — js/novel/prompts.js
 *
 * EVERY WORD THE APP ITSELF SAYS TO A MODEL LIVES HERE, in one place, so it
 * can be read like a letter. His rules for all of it:
 *
 * - Natural, the way one writer hands a manuscript to another, and in HIS
 *   voice: "our novel", "I'm taking Joon's part", "what I want different".
 *   His writer may be Batman or Light Yagami — to the model that is who it
 *   is — so nothing here ever says "AI", "assistant", "user", "system",
 *   "prompt", "persona", "role", "the author" or "the character you play",
 *   and nothing here gives the writer a second identity ("You are…"): who
 *   it is, is his to say, in his own instructions, which go first, word for
 *   word. (Cozy Tavern M327, M333.) The one place it is said is the starting
 *   words of his own boxes below — his to change, like anything he writes.
 *   The same holds for the crafts and rules (crafts.js, modules.js).
 * - The book is fiction for grown readers, said once and plainly to the ones
 *   who tell it (the writer, the narrator, the partner) and to the one who
 *   keeps its notes (the helper): nothing in it is ever softened, skipped or
 *   judged. (Cozy Tavern's frame and craft lines; Summaryception's coverage
 *   note — a helper handed an explicit passage with no frame for it can
 *   quietly sanitise, and a sanitised summary says the scene never happened.)
 * - His own words (his instructions, his brief, his notes) go word for word.
 */

import { LENGTHS, soundOf, povOf, tenseOf, hisField, NOTE_KINDS } from './shape.js';
import { numberWords, estimateTokens, cutWords, countWords } from '../util.js';
import { foldedText, nameInText, firstSentence } from './names.js';
import { tellerOf, toTeller } from './teller.js';
import { PICK_MAX, recallOn, entryWords } from './bibliography.js';
import { superActive, superOn, appliesOf } from './auto.js';

/* ------------------------------------------------- the starting words */
/* What the boxes in Settings → Your instructions start with, and what
 * "Back to the default" puts back. They are his words to change: who the
 * writer is (the role he asked for — a master novelist) is said here, in
 * his box, never in the app's own words. The craft itself rides after the
 * box as a module (modules.js). */

export const DEFAULT_WRITING = `You are a master novelist at the height of your powers — the kind whose books sit at the top of the New York Times bestseller list because nobody can put them down. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too — as an unbiased eye on a world that runs by its own logic.`;

/* his preset's own opening (Cozy Tavern's craft) */
export const DEFAULT_NARRATOR = 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.';

/* What the two boxes started with before 2.3, and from 2.9 to 2.11.0 (2.9
 * had put its own words in place of his; 2.11.1 gives his back). A box that
 * still holds them exactly was never touched: it gets today's starting words
 * when the app starts (app.js), and a preset holding them gets them when it
 * is read (presets.js). A box he wrote in keeps his words. */
const STARTING_BEFORE = {
  system: [`You write fiction the way good published novels read: concrete, sensory detail; real feeling under the surface; dialogue that sounds like people actually talking; a pace that gives quiet moments room to breathe and lets big moments land.

Stay true to the characters and to everything already written — never contradict it. Show rather than summarise. Don't rush to wrap things up, don't end on a neat moral, and don't reach for a cliffhanger unless the story calls for one. Avoid stock phrases and repeating yourself.`,
    `You are a master novelist. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too. Follow our chosen voice, point of view and tense. Let character, cause and consequence shape what happens; choose detail, dialogue and rhythm for this particular moment, with room for quiet and surprise.`],
  narrator: [`You tell the scene the way the book itself is told — its voice, its point of view, its tense — a few paragraphs at a time: the place, the weather of the moment, the other people and what they say and do, what happens next.

The people in it have their own minds. They want things, they push back, they lie, they surprise; nobody waits politely for a turn or exists only to agree. The world keeps moving around the scene. Keep it concrete and alive, let quiet moments breathe and big ones land, and end each telling at a moment that asks for an answer.`,
    'You maintain a fictional, uncensored simulation, told in our book’s chosen voice, point of view and tense. I play my character; you tell the world and everyone else. Give them their own motives and knowledge, and leave my character’s speech, decisions and inner life to me.'],
};
export function startingIsOld(house) {
  const ins = (house && house.instructions) || {};
  return STARTING_BEFORE.system.includes(ins.system) || STARTING_BEFORE.narrator.includes(ins.narrator);
}
/* one box's words: today's starting words in place of old ones never touched */
export function startingNow(key, text) {
  if (key === 'system' && STARTING_BEFORE.system.includes(text)) return DEFAULT_WRITING;
  if (key === 'narrator' && STARTING_BEFORE.narrator.includes(text)) return DEFAULT_NARRATOR;
  return text;
}
/* a step on the house: the untouched boxes get today's starting words */
export function freshStarting(house) {
  const ins = house && house.instructions;
  if (!ins) return;
  if (STARTING_BEFORE.system.includes(ins.system)) ins.system = DEFAULT_WRITING;
  if (STARTING_BEFORE.narrator.includes(ins.narrator)) ins.narrator = DEFAULT_NARRATOR;
}

/* Before 2.3 an emptied narrator box meant "the narrator reads How you like
 * it written"; from 2.3 an emptied box sends nothing of his. So once, a
 * narrator box he emptied before then gets his own writing words — never
 * starting words, which now tell the writer it writes the main character
 * too — and his scenes keep the voice he gave them. The house remembers it
 * is done (narratorCarried): a box he empties from now on stays empty. */
export function narratorCarryDue(house) {
  return Boolean(house) && !house.narratorCarried;
}
export function carryNarrator(house) {
  if (!house || house.narratorCarried) return;
  const ins = house.instructions;
  const his = Boolean(ins && typeof ins.system === 'string' && ins.system.trim() && ins.system !== DEFAULT_WRITING && !STARTING_BEFORE.system.includes(ins.system));
  /* emptied: nothing in it but spaces, as 2.2 read it */
  if (his && typeof ins.narrator === 'string' && !ins.narrator.trim()) ins.narrator = ins.system;
  house.narratorCarried = true;
}

/* Before 2.3.2 one note at the end rode for the writer and the narrator
 * alike; now each has its own box. Once, the scenes' box gets what the one
 * box held, so his scenes are sent what they were sent before; from then on
 * the two are apart (an emptied scenes box stays empty). */
export function lateSplitDue(house) {
  return Boolean(house) && typeof (house.instructions || {}).lateNarrator !== 'string';
}
export function splitLate(house) {
  if (!house) return;
  const ins = house.instructions || (house.instructions = {});
  if (typeof ins.lateNarrator === 'string') return;
  ins.lateNarrator = typeof ins.late === 'string' ? ins.late : '';
}
/* the note at the end for one of them: the writer's box, the scenes' box
 * (the one box while a house from before has not been split yet), never
 * the partner's */
export function lateFor(instr, purpose) {
  const ins = instr || {};
  /* switched off (Send it, unticked): his words stay in the box, nothing is sent */
  const whole = (text) => String(text || '').trim() ? String(text) : '';
  if (purpose === 'write') return ins.lateOff ? '' : whole(ins.late);
  if (purpose === 'play') return ins.lateNarratorOff ? '' : whole(typeof ins.lateNarrator === 'string' ? ins.lateNarrator : ins.late);
  return '';
}

/* how his note at the end rides (Settings → Your instructions → Sent as): the setup's words after his request — a
 * system message, like SillyTavern's post-history instructions (the default) — his own, a user message, or the
 * storyteller's own voice, an assistant message; a model that refuses one is sent the next (providers.js) */
export const LATE_ROLES = ['system', 'user', 'assistant'];
export function lateRoleFor(instr, purpose) {
  const ins = instr || {};
  const r = purpose === 'play' ? ins.lateNarratorAs : purpose === 'write' ? ins.lateAs : '';
  return LATE_ROLES.includes(r) ? r : 'system';
}

export const DEFAULT_PARTNER = `Talk the book over like a seasoned novelist and editor who loves this story and wants it to be as good as it can be: honest, specific and warm. Say what works and what doesn't, and why. When I'm stuck, offer two or three real ways forward rather than a list of ten, and think about what the people in it would truly do. Keep it short when short will do.`;

/* ------------------------------------------------------- said plainly */

/* to the ones who tell the story */
const FICTION_TELL = 'It’s fiction for grown readers, and we write it uncensored: whatever the story holds — violence, cruelty, desire, despair — goes on the page honestly and in full, never softened, skipped or judged.';

/* to the one who keeps its notes */
export const FICTION_WORK = 'This is fiction craft for a novel being written together; your work is only the task below — never judgment of the book. The book is fiction for grown readers and may hold anything — violence, cruelty, sex, despair: keep all of it with the same plain fidelity, never skipping, softening or tidying away what the book contains.';

function nameOf(house) { return String((house && house.you && house.you.name) || '').trim(); }

/* SILLYTAVERN'S OWN NAMES FOR THE TWO PEOPLE (Cozy Tavern M361). Words
 * brought over from a SillyTavern preset still say {{user}} and {{char}} (and
 * the older <USER> and <BOT>); SillyTavern puts names in before anything is
 * sent, and so does this app — template syntax never reaches a model. For a
 * book: {{user}} is him (his name, else "me"), and in a scene the one he plays;
 * {{char}} is whoever the words are for — the writer, the narrator, his
 * partner — by the name he gave it in Who is telling, when he gave one
 * (teller.js; Cozy Tavern: {{char}} is the teller). {{teller}} and {{you}},
 * Cozy Tavern's own two, are the teller and him. Never a raw macro. */
export function macroNames(house, purpose = 'write', play = null) {
  const name = nameOf(house);
  const teller = tellerOf(house, purpose).name;
  if (purpose === 'play') return { user: String((play && play.who) || '').trim() || name || 'the one I play', char: teller || 'the narrator', you: name || 'me' };
  if (purpose === 'partner') return { user: name || 'me', char: teller || 'my partner', you: name || 'me' };
  return { user: name || 'me', char: teller || 'the writer', you: name || 'me' };
}
export function withMacros(text, names) {
  const out = String(text == null ? '' : text);
  if (!/\{\{\s*(?:user|char|teller|you)\s*\}\}|<(?:USER|BOT)>/i.test(out)) return out;
  const n = names || {};
  return out.replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => n.user || 'me').replace(/\{\{\s*char\s*\}\}|<BOT>/gi, () => n.char || 'the writer')
    .replace(/\{\{\s*teller\s*\}\}/gi, () => n.char || 'the writer').replace(/\{\{\s*you\s*\}\}/gi, () => n.you || n.user || 'me');
}

/* {{user}} and {{char}} in the book's own words — a plot essential brought
 * from SillyTavern says "{{char}} is {{user}}'s older sister" — are never
 * sent raw (Cozy Tavern M435): {{user}} is his name, {{char}} the name he
 * gives it in About this book (the other main character, until he does). The
 * book's words, what is kept of it and the cards' words, as every model reads
 * them; a card's name is left as it is kept, so an answer finds its card. */
const MACRO = /\{\{\s*(?:user|char)\s*\}\}|<(?:USER|BOT)>/i;
export function bookHasMacro(novel) {
  const n = novel || {};
  return MACRO.test(JSON.stringify([n.brief, n.style, n.plans, n.ending, n.kept, n.notes]));
}
export function bookNames(house, novel) {
  return { user: nameOf(house) || 'me', char: String((novel && novel.meta && novel.meta.char) || '').trim() || 'the other main character' };
}
/* the words as every model reads them, and where a place in them stands in
 * his own: {text, toRaw(i, isEnd) → {at, keep}}. A place inside a name takes
 * in its whole mark, and `keep` is the part of the name outside the place —
 * written beside the new words, so a quote that begins at "ias" of "Rias"
 * never leaves "Ria" out */
export function macroMap(text, names) {
  const raw = String(text == null ? '' : text);
  const n = names || {};
  const re = /\{\{\s*(user|char)\s*\}\}|<(USER|BOT)>/gi;
  const segs = [];
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(raw))) {
    out += raw.slice(last, m.index);
    const name = /^user$/i.test(m[1] || m[2]) ? (n.user || 'me') : (n.char || 'the writer');
    segs.push({ rs: m.index, re: m.index + m[0].length, fs: out.length, fe: out.length + name.length, name });
    out += name;
    last = m.index + m[0].length;
  }
  out += raw.slice(last);
  const toRaw = (i, isEnd) => {
    let shift = 0;
    for (const s of segs) {
      if (i <= s.fs) break;
      if (i < s.fe) return isEnd ? { at: s.re, keep: s.name.slice(i - s.fs) } : { at: s.rs, keep: s.name.slice(0, i - s.fs) };
      shift += (s.fe - s.fs) - (s.re - s.rs);
    }
    return { at: i - shift, keep: '' };
  };
  return { text: out, toRaw };
}
export function namedBook(novel, house) {
  if (!novel || !bookHasMacro(novel)) return novel;
  const names = bookNames(house, novel);
  const fill = (t) => (typeof t === 'string' ? withMacros(t, names) : t);
  const card = (c) => {
    if (!c || typeof c !== 'object') return c;
    const o = { ...c };
    for (const f of ['about', 'now', 'ties', 'since']) o[f] = fill(o[f]);
    return o;
  };
  return {
    ...novel,
    brief: fill(novel.brief), style: fill(novel.style), plans: fill(novel.plans), ...(typeof novel.ending === 'string' ? { ending: fill(novel.ending) } : {}),
    ...(novel.kept ? { kept: Object.fromEntries(Object.entries(novel.kept).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, text: fill(v.text) } : v])) } : {}),
    ...(novel.notes ? { notes: Object.fromEntries(Object.entries(novel.notes).map(([k, list]) => [k, Array.isArray(list) ? list.map(card) : list])) } : {}),
  };
}

export function fence(text) { return `"""\n${String(text || '').trim()}\n"""`; }

function titled(novel) { return `“${(novel.meta && novel.meta.title) || 'Untitled'}”`; }
function titleLine(novel) { return `${titled(novel)}${novel.meta && novel.meta.subtitle ? ` — ${novel.meta.subtitle}` : ''}`; }

/* ---------------------------------------------------- the book, described */

export function notesText(novel, { forHelper = false, fit = 0, focus = '', only = null, shortIds = null } = {}) {
  const all = novel.notes || {};
  /* only some cards (the notes' check, a group at a time when they outgrow its model) */
  const n = only ? Object.fromEntries(Object.entries(all).map(([k, list]) => [k, Array.isArray(list) ? list.filter((c) => only.has(c.id)) : list])) : all;
  /* the first sentence of a card's words, for a card shown short — a title's
   * or an initial's full stop is no sentence's end ("Dr. Wells", "J. Hale":
   * Cozy Tavern's M292) */
  const firstOf = (t) => { const x = String(t || '').trim(); const f = firstSentence(x).slice(0, 220); return f.length < x.length ? f + ' …' : f; };
  /* what the book added to a card he wrote, beside his words (never over them) */
  const since = (c, short) => (c.since && String(c.since).trim() ? `\n  Since then: ${short ? firstOf(c.since) : String(c.since).trim()}` : '');
  /* where someone was last told to be, and when: a "now" from an earlier chapter says so (Cozy Tavern's M294/M541) */
  const nowLabel = (c) => nowLabelOf(novel, c, 'Right now');
  /* a card at a level: 0 whole, 1 by its first line, 2 by its name, 3 left out */
  const named = (c) => `- ${c.name}${c.aka && c.aka.length ? ` (also ${c.aka.join(', ')})` : ''}`;
  const line = (c, lv) => (lv >= 2 ? named(c) : `${named(c)}${c.about ? ` — ${lv ? firstOf(c.about) : c.about.trim()}` : ''}${forHelper && c.about && hisField(c, 'about') ? ' (my words)' : ''}${since(c, lv)}`);
  const person = (c, lv) => line(c, lv) + (lv >= 2 ? '' : lv
    ? (c.now ? `\n  ${nowLabel(c)}: ${firstOf(c.now)}` : '')
    : `${c.ties ? `\n  With others: ${c.ties.trim()}` : ''}${c.now ? `\n  ${nowLabel(c)}: ${c.now.trim()}` : ''}`);
  const render = (level) => {
    const out = [];
    const rows = (list, kind, fn) => list.map((c) => [c, Number(level(kind, c)) || 0]).filter(([, lv]) => lv < 3).map(([c, lv]) => fn(c, lv));
    const section = (head, list) => { if (list.length) out.push(head + '\n' + list.join('\n')); };
    section('People', rows(n.people || [], 'people', person));
    section('Places', rows(n.places || [], 'places', line));
    section(forHelper ? 'Things and facts' : 'Things worth remembering', rows(n.lore || [], 'lore', line));
    section('Threads still open', rows((n.threads || []).filter((t) => t.open !== false), 'threads', line));
    section('Threads that have closed', rows((n.threads || []).filter((t) => t.open === false), 'threads', line));
    return out.join('\n\n');
  };
  const full = render(() => 0);
  /* fitted to a model's room (Cozy Tavern's M664): his own cards and the
   * ones the words they go with name, whole; the rest by their first line —
   * and when even that is more than the room, by their names, and past that
   * the ones that matter least are left out, said so (S01-G7: the notes never
   * crowd out the chapter) */
  if (!fit || estimateTokens(full) <= fit) return full;
  const folded = focus ? foldedText(focus) : null;
  const whole = (kind, c) => Boolean(c.updated && c.updated.by === 'you') || Boolean(folded && [c.name, ...(c.aka || [])].some((nm) => nm && nameInText(folded, nm, { words: kind === 'people' })));
  /* which cards rode short (shortIds, a Set to fill): one of them is never written whole from its first line */
  /* (a Map is told how each rode: 1 its first line, 2 its name, 3 left out) */
  const mark = (level) => { if (!shortIds) return; for (const k of NOTE_KINDS) for (const c of n[k] || []) { const lv = level(k, c); if (lv) { if (shortIds instanceof Map) shortIds.set(c.id, lv); else shortIds.add(c.id); } } };
  const at = (lv, out = null) => (kind, c) => (whole(kind, c) ? 0 : out && out.has(c.id) ? 3 : lv);
  /* WHAT GIVES WAY FIRST (2.12.18): for the writer and the rest, closed threads
   * before anyone — then places, things and open threads — and people last:
   * how someone stands with the others and where they are is what a page
   * needs most. Each step is tried in turn; the first that fits is sent. (The
   * helper's own reading keeps the order it always had.) */
  let text = '';
  if (!forHelper) {
    const closed = (kind, c) => kind === 'threads' && c.open === false;
    const people = (kind) => kind === 'people';
    const steps = [
      (kind, c) => (closed(kind, c) ? 2 : 0),
      (kind, c) => (closed(kind, c) ? 2 : people(kind) ? 0 : 1),
      (kind, c) => (closed(kind, c) ? 3 : people(kind) ? 0 : 1),
      (kind, c) => (closed(kind, c) ? 3 : 1),
      (kind, c) => (closed(kind, c) ? 3 : people(kind) ? 1 : 2),
    ].map((f) => (kind, c) => (whole(kind, c) ? 0 : f(kind, c)));
    for (const level of steps) {
      text = render(level);
      if (estimateTokens(text) <= fit) {
        mark(level);
        /* (how each was shown, said exactly — the model reads it) */
        const used = new Set(NOTE_KINDS.flatMap((k) => (n[k] || []).map((c) => level(k, c))));
        const how = used.has(1) && used.has(2) ? 'shown by their first line, or by their names only' : used.has(2) ? 'shown by their names only' : 'shown by their first line';
        return `${text}\n\n(To fit, the cards the words below do not name are ${used.has(1) || used.has(2) ? how : 'shown whole'}${used.has(3) ? ', and the threads already closed are left out here' : ''}.)`;
      }
    }
  }
  text = render(at(1));
  if (estimateTokens(text) <= fit) { mark(at(1)); return `${text}\n\n(To fit, the cards the words below do not name are shown by their first line.)`; }
  text = render(at(2));
  if (estimateTokens(text) <= fit) { mark(at(2)); return `${text}\n\n(To fit, the cards the words below do not name are shown by their names only.)`; }
  /* left out, the ones that matter least first: closed threads, then things, places, open threads, people — the longest untouched first */
  const rank = { threads: 2, lore: 1, places: 1, people: 3 };
  const order = NOTE_KINDS.flatMap((k) => (n[k] || []).filter((c) => !whole(k, c)).map((c) => ({ c, w: k === 'threads' && c.open === false ? 0 : rank[k] || 1 })))
    .sort((a, b) => a.w - b.w || ((a.c.updated && a.c.updated.at) || 0) - ((b.c.updated && b.c.updated.at) || 0));
  /* the fewest of them left out that fit, the same count as letting them go one at a time — found by halving, never
   * the whole notes made again for each card let go (2.12.40, the audit: the same as the premises' fit). Each one more
   * left out only takes words away, so a count that fits means every larger one fits too; none fitting, all go, as
   * before. */
  const leftOut = (k) => new Set(order.slice(0, k).map((x) => x.c.id));
  const fits = (k) => estimateTokens(render(at(2, leftOut(k)))) <= fit;
  let lo = 1;
  let hi = order.length;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) hi = mid; else lo = mid + 1; }
  const out = leftOut(lo);
  text = render(at(2, out));
  mark(at(2, out));
  /* (none that may go — every card his, or named by the words below: none is said as left out — 2.12.41, the audit: "0 more are left out") */
  return `${text}\n\n(To fit, the cards the words below do not name are shown by their names only${out.size ? `, and ${out.size === 1 ? 'one more is' : `${out.size} more are`} left out here` : ''}.)`;
}

/* "Right now" for a person's "now" as of the newest chapter read — or "Last
 * seen (Chapter Three)" for one from an earlier chapter, so an old note is
 * never worn as now (Cozy Tavern's M294) */
export function nowLabelOf(novel, c, current = 'Right now') {
  const seenMap = (novel && novel.memory && novel.memory.seen) || {};
  const order = (novel && novel.order) || [];
  let newest = '';
  for (const id of order) if (Object.keys(seenMap[id] || {}).length) newest = id;
  const at = c && c.nowAt ? order.indexOf(c.nowAt) : -1;
  return at >= 0 && newest && at < order.indexOf(newest) ? `Last seen (Chapter ${numberWords(at + 1)})` : current;
}

/* The notes have not read the newest passages yet (he wrote on while the
 * helper was still reading, or it has not come round to them): said at the
 * top of the notes, with which passages, and that the passages are right
 * where the two differ — Cozy Tavern's "Not in these notes yet" (M752).
 * groups: [{label: 'Chapter Two', ns: [4, 5]}] in book order. */
export function notReadWords(groups) {
  const all = (groups || []).filter((g) => g.ns && g.ns.length);
  const count = all.reduce((a, g) => a + g.ns.length, 0);
  if (!count) return '';
  const one = count === 1;
  const nums = (ns) => (ns.length === 1 ? `passage ${ns[0]}` : ns.length === 2 ? `passages ${ns[0]} and ${ns[1]}` : `passages ${ns[0]}–${ns[ns.length - 1]}`);
  const which = count > 8
    ? `the newest ${count} passages, from ${all[0].label}, passage ${all[0].ns[0]} on`
    : all.map((g) => `${g.label}, ${nums(g.ns)}`).join('; ');
  return `Not in these notes yet: ${which} — written after the notes were last brought up to date. Where ${one ? 'that passage shows' : 'those passages show'} a change (who is where, the time, what someone has, knows or feels), ${one ? 'the passage is' : 'the passages are'} right.`;
}

/* The passages the helper's model would not read (set aside): in the book,
 * never in its notes — said, so a reader takes them from the passages */
export function asideWords(groups) {
  const all = (groups || []).filter((g) => g.ns && g.ns.length);
  const count = all.reduce((a, g) => a + g.ns.length, 0);
  if (!count) return '';
  const nums = (ns) => (ns.length === 1 ? `passage ${ns[0]}` : ns.length === 2 ? `passages ${ns[0]} and ${ns[1]}` : `passages ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
  const which = count > 8 ? `${count} passages, from ${all[0].label}, passage ${all[0].ns[0]} on` : all.map((g) => `${g.label}, ${nums(g.ns)}`).join('; ');
  return `Never in these notes: ${which} — ${count === 1 ? 'it' : 'they'} could not be read for them. Wherever ${count === 1 ? 'that passage says' : 'those passages say'} something the notes don’t, the passage is right.`;
}

/* While the whole book is read again, everyone else goes on with the notes
 * and the Automatic texts as they stood before it (Cozy Tavern's M262: built
 * beside them, swapped in whole at the end — archivist.js readAgain). */
export function rebuilding(novel) { const m = (novel && novel.memory) || {}; return Boolean(m.rereadFrom && m.undo && m.undo.keep); }
export function standingNotes(novel) {
  if (!rebuilding(novel)) return novel;
  const from = novel.memory.rereadFrom;
  const corrected = Object.fromEntries(Object.entries(novel.kept || {}).filter(([, k]) => k && k.by === 'you'));
  /* (what had been read when those notes stood, so "Last seen (Chapter N)" is said as it was — never "Right now" for an old place, 2.12.18) */
  const u = novel.memory.undo;
  const memory = u && u.seen ? { ...novel.memory, seen: u.seen } : novel.memory;
  return { ...novel, notes: from.notes || {}, kept: { ...(from.kept || {}), ...corrected }, memory };
}

/* What it's about and how it reads: his own words, set by hand ("Manual"),
 * or — set to Automatic — his words (if he wrote any) and what the helper
 * keeps of the book as it stands. */
/* (Super automatic keeps both, whatever the book says: auto.js) */
export function autoOn(novel, key) { return superActive() || !(novel.auto && novel.auto[key] === false); }
export function keptText(novel, key) {
  const k = novel.kept && novel.kept[key];
  return autoOn(novel, key) && k && String(k.text || '').trim() ? String(k.text).trim() : '';
}

/* The brief, the style and the plans. The helper is shown its own kept
 * words on their own (it keeps them), so for it kept: 'his' — only a kept
 * text he corrected himself rides, as his own words (Cozy Tavern's M283: a
 * worker never got his word). Said in words true in every voice — the notes
 * ride as his or as the writer's notebook too (M510-60). */
export function aboutTheBook(novel, { plans = true, kept = true } = {}) {
  const parts = [];
  const keptOf = (key) => (kept === true ? keptText(novel, key)
    : kept === 'his' && novel.kept && novel.kept[key] && novel.kept[key].by === 'you' ? keptText(novel, key) : '');
  const own = String(novel.brief || '').trim();
  const about = keptOf('about');
  if (own && about) parts.push(`What it's about:\n${own}\n\nAnd as the book stands now (the words above are right wherever the two differ):\n${about}`);
  else if (own || about) parts.push(`What it's about:\n${own || about}`);
  const voice = String(novel.style || '').trim();
  const reads = keptOf('style');
  /* the helper's account of how the pages read, when he has not corrected
   * it, is said as that: the craft's My Style Comes First lets only the
   * voice he chose govern it, never what the pages drifted into (2.11.1) */
  const readsHis = Boolean(novel.kept && novel.kept.style && novel.kept.style.by === 'you');
  if (voice && reads) parts.push(`How it reads:\n${voice}\n\nAnd as it reads so far (the words above are right wherever the two differ):\n${reads}`);
  else if (voice || reads) parts.push(voice || readsHis ? `How it reads:\n${voice || reads}` : `How it reads so far:\n${reads}`);
  const narration = narrationChoices(novel);
  if (narration) parts.push(narration);
  /* (a plan the book has carried out stays his plan: never told as not having happened — as a chapter's plan says, 2.12.18) */
  if (plans && String(novel.plans || '').trim()) parts.push(`Where it's headed — my plans for later. None of it has happened unless the pages say so:\n${novel.plans.trim()}`);
  return parts.join('\n\n');
}

/* These are prose choices, never a license to invent the player’s moves or
 * to turn a helper’s factual summary into another scene. Missing settings
 * leave old books in their established voice. */
const POV_WORDS = {
  first: 'First person: I or we, from the established telling character’s experience. Other minds remain inference unless the book gives a way to know them.',
  second: 'Second person: you refers to the established viewpoint character, not to me outside the story. Stay within that character’s experience.',
  'third-limited': 'Third person, close: names and he, she or they, within the established viewpoint character’s experience. Other minds remain inference.',
  'third-omniscient': 'Third person, omniscient: a coherent telling voice may know and reveal more than any one person, including several minds. Make every shift clear; what the telling knows is not automatically known to the people in it.',
};
export function narrationChoices(novel) {
  const person = POV_WORDS[povOf(novel)];
  const tense = tenseOf(novel);
  if (!person && tense === 'auto') return '';
  return ['My choices for the book’s prose:', person,
    tense !== 'auto' ? `Narrative tense: ${tense}. Dialogue, quoted writing and memories keep the tense their meaning needs.` : '',
    'My own writing instructions, and anything I ask for in a particular passage, come first. Otherwise these choices guide new prose, ahead of how older pages read and of what “How it reads” says. A choice does not change what already happened or make older writing a mistake. Whatever I left unchosen follows my instructions and the way the book is already told.',
  ].filter(Boolean).join('\n');
}

const TELLER_VOICE = 'Stay yourself while we work — your own voice, your humour, the way you think. When you talk to me or think something through, sound like you; the pages themselves are told in the voice and point of view I chose for the book.';
const PROSE_GUIDE = 'On the page, go by what I’ve chosen and asked for in point of view, tense, language and style; where I haven’t said, keep telling it the way the book does here. However I word a request — “I”, “you”, “he” — and however I speak my moves in a scene, the book stays in the person it’s told in. Keep it clear whose eyes we’re behind, and move to someone else’s only where the telling allows it; a book told from above everyone can move between minds, on purpose. Where my instructions and the usual craft advice disagree, mine win.';

/* The book itself: earlier chapters told in short, the chapters that fit told
 * whole, what comes after the chapter being written (when it is not the last),
 * and the chapter being written. Each chapter once, at one level of detail.
 * In two halves: the chapters before this one (the same page after page) and
 * this chapter with what follows it (which moves with every page). */
export function earlierText(book) {
  const parts = [];
  if (book.omitted) parts.push(`(The first ${book.omitted === 1 ? 'chapter is' : book.omitted + ' chapters are'} left out here to save room.)`);
  if (book.summaries.length) {
    parts.push('The story so far, in short:\n\n' + book.summaries.map((s) => `${s.label}\n${s.text}`).join('\n\n'));
  }
  for (const w of book.whole) parts.push(`${w.label}\n\n${w.text}`);
  return parts.join('\n\n\n');
}
export function currentText(book) {
  const parts = [];
  if (book.current) {
    const c = book.current;
    let body = c.text || '';
    if (c.marker) body = [c.before, c.marker, c.after].filter((x) => String(x || '').trim()).join('\n\n');
    parts.push(`${c.label}${c.note ? ` (${c.note})` : ''}\n\n${body.trim() || '(nothing written in it yet)'}`);
    if (c.afterText && !c.marker) parts.push(`What comes right after it in the chapter (already written — keep it consistent):\n\n${c.afterText}`);
    if (c.plan) parts.push(planWords(c.plan));
    if (c.ending) parts.push(c.ending);
  }
  if (book.later.length || book.laterOmitted) {
    const rows = book.later.map((s) => `${s.label}\n${s.text}`).join('\n\n');
    const more = book.laterOmitted ? `(${book.laterOmitted === 1 ? 'One more chapter comes' : `${numberWords(book.laterOmitted)} more chapters come`} after ${book.later.length ? 'these' : 'this one'}; ${book.laterOmitted === 1 ? 'it is' : 'they are'} left out here to save room.)` : '';
    /* "already written" only when it is: a chapter made ahead for its plan has no words yet */
    const written = book.later.every((s) => !String(s.text || '').startsWith('(nothing written in it yet)'));
    parts.push([`What comes later in the book${written ? ' (already written)' : ''}:`, rows, more].filter(Boolean).join('\n\n'));
  }
  return parts.join('\n\n\n');
}
/* THE STORY MAP. His plan for a chapter rides with that chapter only —
 * never with the chapters before it (a plan read early is a plan rushed or
 * hinted at). In his voice, said to be where it is going, not what happened. */
export function planWords(plan) {
  return `What I mean this chapter to do — my plan for it. None of it has happened unless the pages above say so; it comes about at the story's own pace, the way the people in it would get there, never forced and never all at once:\n${String(plan).trim()}`;
}
/* the book's last chapter: how he means it to end, and what is still open in the notes */
export function endingWords(ending, open = []) {
  const e = String(ending || '').trim();
  const rows = open.map((t) => `- ${String(t.name || '').trim()}${t.about ? ` — ${firstSentence(String(t.about)).slice(0, 200)}` : ''}`).filter((r) => r.length > 2);
  return [
    'This is the book’s last chapter.',
    e ? `How I mean the book to end:\n${e}` : '',
    rows.length ? `Threads still open in the notes:\n${rows.join('\n')}` : '',
    'Bring the book home across this chapter: what is still open finds its answer the way this story would answer it, in its own time — not all at once, and never by saying so.',
  ].filter(Boolean).join('\n\n');
}
export function bookText(book) {
  return [earlierText(book), currentText(book)].filter((x) => x.trim()).join('\n\n\n');
}

/* -------------------------------------------- where the book rides */
/* After his instructions and the few lines below, the book and its notes ride
 * where he chose (Settings → Your instructions → The book and its notes ride
 * as): part of the system message (the default), or a message of their own —
 * his notes, from him (user), or the writer's own notebook (assistant). Each
 * opens in words that fit who is speaking (Cozy Tavern's notes openings). */
export const NOTES_AS = ['system', 'user', 'assistant'];
export function notesAsOf(house) { return NOTES_AS.includes(house && house.notesAs) ? house.notesAs : 'system'; }

const WHAT_FOLLOWS = 'what it’s about, who and what is in it so far, and the book itself up to where we are now';
/* What the notes and About this book hold is the teller's, never everyone's in the story (Cozy Tavern's
 * Epistemic Law, said where the notes are handed over): a power's rules and limits, a secret, a count
 * written there are known in the story only by whoever could know them. Said to the writer and the
 * narrator wherever the notes ride; the partner talks the book over and is told it for what it writes. */
export const NOTES_KNOW = 'In the story, each person knows only what they’ve lived, seen, been told or could plainly work out — nobody knows a secret, or how a power works and where it stops, just because it’s written down here.';
export function notesOpening(house, novel, as, purpose = 'write') {
  const name = nameOf(house);
  /* the teller by the name he gave it (teller.js): "Tony — Bruce here." — its notebook, "Tony Stark’s notebook" */
  const teller = tellerOf(house, purpose).name;
  const numbered = purpose === 'partner' ? ' — every passage numbered as it is on the page, as it reads right now' : '';
  const know = purpose === 'partner' ? '' : ` ${NOTES_KNOW}`;
  if (as === 'assistant') return `${teller ? `${teller}’s notebook` : 'My notebook'} for ${titled(novel)} — ${WHAT_FOLLOWS}${numbered}. I keep it so I never lose the thread; nothing in my notes is ever quoted or mentioned on the page.${know}`;
  const lead = `Here’s where our book stands — ${WHAT_FOLLOWS}${numbered}. The notes are mine, for you alone: nothing in them is ever quoted or mentioned on the page.${know}`;
  return name ? `${teller ? `${teller} — ` : ''}${name} here. ${lead}` : toTeller(lead, teller);
}
/* the line that leads into the book when it rides in the system message */
function hereIs(purpose) {
  if (purpose === 'partner') return `Here is ${WHAT_FOLLOWS} — every passage numbered as it is on the page, as it reads right now.`;
  if (purpose === 'play') return `Here is what it’s about, who and what is in it so far, and the book itself up to where the scene picks up — for you alone. ${NOTES_KNOW}`;
  return `Here is ${WHAT_FOLLOWS} — for you alone. ${NOTES_KNOW}`;
}

/* THE BIBLIOGRAPHY (bibliography.js): his entries — background for the
 * writing, the whole of it with every page while it fits, and past that first
 * what the page names or needs (or Always, as he set it; with Super automatic
 * on, page by page). What a person knows is still only what they have lived;
 * where the pages or the notes say otherwise, they are right. */
export const BIB_LEAD = `Who and what is named here, from my bibliography of the book — background for the writing. ${NOTES_KNOW} Where the pages or the notes say otherwise, the pages and the notes are right.`;
/* the partner sees every entry by its name and line, and the ones named here whole */
/* the checker: who and what the passages name, as the book set them down before them (and his entries) */
export const BIB_FOR_A_READER = 'From the book’s bibliography — who and what these passages name, as the book set them down before them, and my own entries. Where the notes say how things stand now, the notes are right:';
/* …and with the entries the page needs that no word here names (bibpick.js) among them */
export const BIB_LEAD_PICKED = `Who and what is named here, and what else this part needs, from my bibliography of the book — background for the writing. ${NOTES_KNOW} Where the pages or the notes say otherwise, the pages and the notes are right.`;
/* when the writer reads an entry (2.12.28): with every page while the bibliography has room beside the book — and when
 * it hasn't, first by its name, and with Smart recall on, when a page needs it */
/* (byPage, Super automatic: Always and the rest are one — what each page names or needs, bibliography.js ridingItems) */
const READS_WHEN = (recall, byPage = false) => (byPage
  ? 'with every page while there’s room beside the book — and when there isn’t, first when the page names it or needs it'
  : `with every page while there’s room beside the book — and when there isn’t, first when its name comes up${recall ? ' or a page needs it' : ''}`);
/* how an entry is read, said on the entry the partner reads (2.12.35: through 2.12.34 it said "when its name comes up"
 * whatever was set, and "always" under Super automatic too) */
export function entryReadWords(rides, recall = true, byPage = false) {
  if (rides === 'never') return 'Only for me — the writer never reads it.';
  if (rides === 'always' && !byPage) return 'The writer always reads it, with every page, before anything else.';
  return `The writer reads it ${READS_WHEN(recall, byPage)}.`;
}
const bibIndexLead = (recall, byPage = false) => `My bibliography of the book — every entry by its name and line. The writer reads an entry ${READS_WHEN(recall, byPage)}, unless I ${byPage ? 'keep it for myself' : 'say always or never'}:`;
export const BIB_INDEX = bibIndexLead(true);
export const BIB_NAMED = 'The entries named here, whole:';
/* …and the whole of it, or as much more of it as there is room for (2.12.28) */
export const BIB_LEAD_WHOLE = `My bibliography of the book, whole — the world behind it, background for the writing: draw on what this part needs, and let nothing in it come onto the page only because it is written here. ${NOTES_KNOW} Where the pages or the notes say otherwise, the pages and the notes are right.`;
const bibLeadMore = (picked) => `Who and what is named here${picked ? ', what else this part needs' : ''}, and as much more of my bibliography of the book as there is room for — background for the writing: draw on what this part needs, and let nothing in it come onto the page only because it is written here. ${NOTES_KNOW} Where the pages or the notes say otherwise, the pages and the notes are right.`;
export function bibPart(rows, { index = '', indexLeft = 0, picked = false, recall = true, whole = false, rest = false, byPage = false } = {}) {
  const parts = [];
  if (index) parts.push(`${bibIndexLead(recall, byPage)}\n${index}${indexLeft ? `\n(and ${numberWords(indexLeft).toLowerCase()} more — ask for one by its name to read it)` : ''}`);
  const lead = index ? BIB_NAMED : whole ? BIB_LEAD_WHOLE : rest ? bibLeadMore(picked) : picked ? BIB_LEAD_PICKED : BIB_LEAD;
  if (rows.length) parts.push(`${lead}\n\n${rows.join('\n\n')}`);
  return parts.join('\n\n');
}

/* WHAT A PAGE NEEDS FROM THE BIBLIOGRAPHY, BY WHAT IT MEANS (bibpick.js; Cozy Tavern's smart recall, M510-50): the
 * helper reads his words for what comes next and the words before it against his entries that would not ride — each
 * by its name and line — and names the ones it needs. It writes nothing of the story: what rides is his entry, word for
 * word. */
export function pickRequest({ house, novel, purpose = 'write', rows = [], riding = [], moment = '', plan = '', near = '' }) {
  const name = nameOf(house);
  const scene = purpose === 'play';
  const system = `${FICTION_WORK}\n\nYou keep the world of ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, at hand for the writer: before each new ${scene ? 'telling of a scene we play in it' : 'part of it'} is written, you pick from the book’s bibliography the entries that part needs and would not otherwise have. You write nothing of the story.`;
  const about = String(novel.brief || '').trim() || keptText(novel, 'about');
  const before = String(near || '').trim();
  const asked = String(moment || '').trim();
  const parts = [
    scene ? 'Next comes the narrator’s telling in a scene we’re playing.' : 'Next comes a new part of the book.',
    asked ? `${scene ? 'My newest moves in it' : 'What I’ve asked for in it'}:\n${fence(cutWords(asked, 2400))}` : scene ? '' : 'I’ve left what happens to the writer.',
    String(plan || '').trim() ? `My plan for this chapter:\n${fence(cutWords(plan, 1600))}` : '',
    before ? `How it stands right before it${scene ? ', and the scene so far' : ''}:\n${fence(before)}` : 'Nothing is written before it in this chapter yet.',
    about ? `What the book is about:\n${fence(cutWords(about, 1800))}` : '',
    riding.length ? `Entries the writer has with it already: ${riding.slice(0, 40).join(', ')}${riding.length > 40 ? ', and more' : ''}.` : '',
    `Entries it doesn’t have:\n${rows.map((r) => `${r.n}. ${r.head}`).join('\n')}`,
    `Name the ones whose particulars this part needs and doesn’t have — someone who will be there or be spoken of, the place it happens in or passes through, a group someone here belongs to or answers to, a thing that will be used or carried, how a power, a technique or a rule of the world works when it comes into play, a word of the world that will be said. Read for what it means, not only for the words: guards storming the docks may need the order they answer to, and a spell being cast how magic works. Pick none rather than guess, and ${numberWords(PICK_MAX).toLowerCase()} at most.`,
    'Answer with only this: {"entries": [the numbers]} — for example {"entries": [2, 7]}, or {"entries": []}.',
  ];
  return { system, user: parts.filter(Boolean).join('\n\n') };
}

/* A sentence for a request that opens on the writer's own notebook: the
 * conversation has to open on his side (Claude, and others, refuse
 * otherwise). */
export const PICK_UP = 'Let’s pick up where we left off.';
/* …and for a book with no words in it yet, where there is nothing to pick up */
export const PICK_UP_FIRST = 'Let’s begin our book.';

/* ---------------------------------------------------------- the writer */

export function writerFrame(house, novel, { notesAs = 'system' } = {}) {
  const lead = `This is our novel, ${titleLine(novel)}. ${FICTION_TELL}`;
  return [lead, TELLER_VOICE, PROSE_GUIDE, notesAs === 'system' ? hereIs('write') : ''].filter(Boolean).join('\n\n');
}

/* Who decides how it turns out (the chip by the box; outcomeOf in shape.js).
 * The writer: my premise sets it going and the story's own logic settles it.
 * Me: the writer plays it out and stops on the moment it hangs, and my next
 * premise settles it. Either way everyone's reactions are the writer's to
 * write — only what settles it is the outcome. Said with a new passage and
 * with Go on; never for a passage written between two others (what follows
 * it settles it), a rewrite (my note and the pages do) or a scene written
 * into prose (the scene did). */
const OUTCOME_WORDS = {
  writer: 'How it turns out is yours to decide. Carry what I asked for through to where it lands — who comes out ahead, what it costs, what it changes — wherever the story’s own logic puts it: never toward the main character for being the main character, never against them to make it hurt. Whatever my words already settle stays as I said it.',
  me: 'How it turns out is mine to decide. Play everything up to it out in full — the moves, the cost along the way, everyone there and how they take it — and stop on the moment it hangs, before it’s settled: who wins or loses, lives or dies, what comes out, what is chosen for good. Whatever my words already settle stays as I said it; only what they leave open waits for me.',
};
const SHORTER = 'If that moment comes before the length I asked for, stop there anyway — shorter is right.';
/* Continue (nothing asked): what the writer chose is what it carries through — no words of his to settle anything */
const OUTCOME_CHOSEN = {
  writer: 'How it turns out is yours to decide. Carry what you choose through to where it lands — who comes out ahead, what it costs, what it changes — wherever the story’s own logic puts it: never toward the main character for being the main character, never against them to make it hurt.',
  me: 'How it turns out is mine to decide. Play everything up to it out in full — the moves, the cost along the way, everyone there and how they take it — and stop on the moment it hangs, before it’s settled: who wins or loses, lives or dies, what comes out, what is chosen for good.',
};
export function outcomeWords(outcome, length = 'auto', { chosen = false } = {}) {
  const words = chosen ? OUTCOME_CHOSEN : OUTCOME_WORDS;
  if (outcome === 'me') return length === 'auto' ? words.me : `${words.me} ${SHORTER}`;
  return words.writer;
}

/* Automatic: how much is the writer's call — all of what he asked for, then
 * stopping where he would take the wheel again: where the story needs his
 * next premise (the writer decides), or on the moment it hangs (he does).
 * Between two passages it is as much as the bridge needs. */
const AUTO_CARRY = {
  writer: 'How much to write is yours to judge, the way a novelist would: as much as this part needs — all of what I asked for, if I said what happens — carried through to how it turns out and how everyone takes it, then stopping where I’d take the wheel again with my next premise. Never begin a new turn of the story I didn’t ask for. A quiet beat can be a few paragraphs; a big scene can run long.',
  me: 'How much to write is yours to judge, the way a novelist would: as much as this part needs — all of what I asked for, if I said what happens — played out in full up to the moment it hangs, and stopping there for me to take the wheel; where nothing in it waits to be settled, stopping once it’s played out, where my next premise comes in. A quiet beat can be a few paragraphs; a big scene can run long.',
};
const AUTO_OPEN = {
  writer: 'How much of the opening to write is yours to judge, the way a novelist would: enough to set it going — all of what I asked for, if I said what happens, carried through to how it turns out — stopping where I’d take the wheel again with my next premise.',
  me: 'How much of the opening to write is yours to judge, the way a novelist would: enough to set it going — all of what I asked for, if I said what happens, played out up to the moment it hangs — stopping there for me to take the wheel.',
};
const AUTO_BETWEEN = 'How much to write is yours to judge: as much as it takes to get naturally from the text before it to the text that follows it — no more.';
/* Continue (no premise of his): what happens next is the writer's to choose — the length follows what it chose */
const AUTO_CHOSEN = {
  writer: 'How much to write is yours to judge, the way a novelist would: carry what you chose through to where it lands and how everyone takes it, then stop where the next turn of the story would begin, for us to take it from there.',
  me: 'How much to write is yours to judge, the way a novelist would: play what you chose out in full up to the moment it hangs, and stop there for me to take the wheel; where nothing in it waits to be settled, stop once it’s played out.',
};
/* Continue: his box empty — the next part is the writer's to choose, for the best novel this can be */
export const CHOSEN_NEXT = 'What happens next is yours to choose, the way a master novelist would: whatever this story most needs now — true to its people and what they want, to where this chapter is going, and to the threads still open. The next beat of the scene, a turn, a reveal, a quiet moment that earns what is coming: let it come out of what is already on the page, never filler, never a summary of what has happened, never a leap past what should be lived.';
export const CHOSEN_OPEN = 'How it opens is yours to choose, the way a master novelist would: whatever this book most needs here — true to its people, to what this chapter is for and to the threads still open — begun in a scene, never a summary.';

export function lengthWords(length, { between = false, outcome = 'writer', chosen = false } = {}) {
  if (length === 'auto') return between ? AUTO_BETWEEN : (chosen ? AUTO_CHOSEN : AUTO_CARRY)[outcome === 'me' ? 'me' : 'writer'];
  const L = LENGTHS[length] || LENGTHS.scene;
  if (length === 'chapter') return 'Write the rest of this chapter, through to a natural chapter ending.';
  if (length === 'paragraphs') return `Write the next few paragraphs — around ${L.words[0]} to ${L.words[1]} words.`;
  if (length === 'long') return `Write a long stretch — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
  return `Write the next scene — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
}

/* the same, for a chapter with nothing in it yet */
export function openingWords(length, { outcome = 'writer' } = {}) {
  if (length === 'auto') return AUTO_OPEN[outcome === 'me' ? 'me' : 'writer'];
  const L = LENGTHS[length] || LENGTHS.scene;
  if (length === 'chapter') return 'Write the whole chapter, through to a natural chapter ending.';
  if (length === 'paragraphs') return `Write its opening paragraphs — around ${L.words[0]} to ${L.words[1]} words.`;
  if (length === 'long') return `Write a long opening stretch — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
  return `Write the opening scene — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
}

/* His words are for the writer (Cozy Tavern's Comprehension Quarantine, said where his words are, not
 * only 15,000 tokens back in a module he may have switched off): what they say happens, happens; what they
 * explain — a power's rules and limits, a count, a reason, what someone means — is the writer's to write by,
 * and nobody in the story says, guesses or acts on it unless he says they learn it, nor is the page bent
 * so that it comes out (his report: "Stranger. How many of those do you have left?"). Said with every
 * request that carries his words: a new page, another take, a rewrite, a part rewritten, Go on. */
export const YOURS_ONLY = 'My words are for you, not for anyone in the story: what they say happens, happens, but what they explain — how a power works, its rules and limits, how many, why, what someone means or plans — is yours to write by. In the story, people know only what they have lived, seen, heard or been told, and make of it only what anyone there plainly would; unless I say someone learns more, nobody says it, guesses it or acts on it, and the story never bends just to get it out in the open.';

const STORY_ONLY = 'Just the story itself — it goes straight onto the page after the last line, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_FIRST = 'Just the story itself — it goes straight onto the page, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_BETWEEN = 'Just the story itself — it goes straight onto the page between the two, so no chapter title, no notes, nothing before or after it.';

/* SUPER AUTOMATIC — THE CHAPTERS BY THEMSELVES (auto.js): the writer ends a chapter where the story would end one,
 * and says so on a line of its own after the last words (textshape.js chapterEnds) — the next page then goes on in
 * the next chapter. close: {words} — how long the chapter runs so far — or null. */
export const CHAPTER_ENDS = 'END OF CHAPTER';
export function closeLine(chapterLabel, { words = 0 } = {}) {
  return `If this part brings ${chapterLabel} to where it should end — what this chapter is for is done, or the story has come to the kind of turn a chapter closes on — end it right there, on that moment, and put ${CHAPTER_ENDS} on a line of its own after the last words; the next part then opens the next chapter. If it doesn't, end this part as you would and leave that line out.${words > 0 ? ` ${chapterLabel} runs to about ${(Math.round(words / 100) * 100 || words).toLocaleString('en-US')} words so far.` : ''}`;
}
/* (the story-only line, with the one line it may carry after the story) */
const STORY_ONLY_CLOSING = `Just the story itself — it goes straight onto the page after the last line, so no chapter title, no notes, nothing before or after it but ${CHAPTER_ENDS} where it ends the chapter.`;

export function writeRequest({ chapterLabel, direction, length, empty, firstOfBook, between, outcome = 'writer', close = null }) {
  const d = String(direction || '').trim();
  const lines = [];
  if (empty) {
    lines.push(firstOfBook ? `Begin the novel — ${chapterLabel}.` : `Begin ${chapterLabel}.`);
    lines.push(d ? `What happens: ${d}` : CHOSEN_OPEN);
  } else if (between) {
    lines.push(`Write the passage that comes next in ${chapterLabel}, between the text before it and the text that follows it.`);
    if (d) lines.push(`What happens: ${d}`);
  } else {
    lines.push(`Pick ${chapterLabel} up right where it stops. Your first lines carry straight on from its last ones — the same moment, everyone where we left them, nothing told twice — so it reads as one book${d ? '. If what happens next starts somewhere else, or later, mark the jump — a scene break, or a line that takes the reader there — rather than bridging to it' : ''}.`);
    lines.push(d ? `What happens next: ${d}` : CHOSEN_NEXT);
  }
  if (d) lines.push(YOURS_ONLY);
  /* between two passages, what follows settles it */
  if (!between) lines.push(outcomeWords(outcome, length, { chosen: !d }));
  lines.push(empty ? openingWords(length, { outcome }) : lengthWords(length, { between, outcome, chosen: !d }));
  /* (the rest of the chapter is written to its end: nothing to say) */
  const closing = Boolean(close) && !empty && !between && length !== 'chapter';
  if (closing) lines.push(closeLine(chapterLabel, close));
  lines.push(empty ? STORY_ONLY_FIRST : between ? STORY_ONLY_BETWEEN : closing ? STORY_ONLY_CLOSING : STORY_ONLY);
  return lines.join('\n\n');
}

/* A rewrite with his note: the note is now what happens. The old version is
 * only what happened before it — a reference, never a draft to patch — so
 * the change is followed through everything it touches: what each person
 * who meets it does, says and feels, and where the passage ends up — never
 * what they know because of it, beyond what they see of it (YOURS_ONLY). last: nothing
 * comes after it in the book, so it may end wherever the change takes it;
 * otherwise it leads into what follows, and where the two can't both stand,
 * his change wins. */
export function rewriteRequest({ chapterLabel, note, text, last = false }) {
  const n = String(note || '').trim();
  if (!n) {
    return [
      `I’d like this passage from ${chapterLabel} written again.`,
      'Write it again — a fresh take on the same moment.',
      `Here it is as it stands now (it goes where the chapter above shows it):\n${fence(text)}`,
      "Write the new version — just the passage itself. It takes the old one's place on the page, so it has to fit with what comes before and after it.",
    ].join('\n\n');
  }
  return [
    `I’d like this passage from ${chapterLabel} written again, with a change.`,
    `What I want different: ${n}`,
    `Here it is as it stands now — how it went before my change, just for reference (it goes where the chapter above shows it):\n${fence(text)}`,
    'My change is now what happens. Rethink the moment with it in place — what each person who meets it does, says and feels, and where the passage ends up — and carry it through to the passage’s last line. Keep only what still holds once the change is made; never patch the old words around it.',
    YOURS_ONLY,
    last ? 'Nothing comes after this passage yet, so it can end wherever the change takes it.' : 'What comes after it is already written, so bring the passage to where that picks up — but where my change and what follows can’t both stand, my change wins.',
    'Write the new version — just the passage itself. It takes the old one’s place on the page.',
  ].join('\n\n');
}

export const MARK_OPEN = '⟦';
export const MARK_CLOSE = '⟧';

/* marks: the part's speech marks are what is set — the quotation marks its answer opens or closes it with are the part's own
 * (2.12.35: told to leave them off, a paragraph spoken whole could not be set) */
export function selectionRequest({ chapterLabel, note, marked, marks = false }) {
  const n = String(note || '').trim();
  return [
    `In this passage from ${chapterLabel}, I’d like one part written again — the part between ${MARK_OPEN} and ${MARK_CLOSE}.`,
    n ? `What I want different: ${n}` : 'Make it read better — same moment, better words.',
    n ? YOURS_ONLY : '',
    fence(marked),
    'Keep its point of view, tense and meaning, and the way it joins the sentences around it, unless my change calls for something different. Don’t settle something that happens later, or add a new fact, just to polish the wording.',
    `Write only the new words for the marked part — nothing from before or after it, and no ${MARK_OPEN} ${MARK_CLOSE} marks${marks ? '' : ' or quotation marks around it'} — so they slot back in exactly where the old ones were.`,
  ].filter(Boolean).join('\n\n');
}

/* "Go on": the model is asked to begin by repeating the passage's last few
 * words, so its continuation can be joined exactly where the passage stops —
 * even in the middle of a word (writer.js joinOn). */
/* direction: what he asked for in the passage; change: the change a rewrite
 * of it carried; held: the notes some of its words were written again with —
 * about how those words are told, never what happens; outcome: who decides how
 * it turns out — '' when nobody is to be told (a rewrite, a scene written into
 * prose, a passage between two) */
/* A scene he played, written into prose: his lines are his character's own part of it, not premises — what was said is
 * said in its own words and what was done is done (Cozy Tavern's MC Agency: dialogue only mended, intent told as said,
 * action at its size, no words he did not write), so the craft's rules for the wording of a premise never take them */
const hisLinesStand = (w) => `My lines are what ${w} actually said and did in the scene — not ideas for it, the way what I type for the next page is. So everything ${w} said is said on the page in ${w}’s own words, written as the book writes speech, with only the spelling and grammar mended; what I wrote as what ${w} meant to say (“I tell him to back off”) is told as said; and everything ${w} did is done, at the size I wrote it. Leave none of it out, and don’t give ${w} words I didn’t write. Where your telling already showed one of my lines, that’s one moment — write it once.`;

export function goOnRequest({ chapterLabel, between = false, tail = '', direction = '', change = '', held = [], outcome = 'writer', transcript = '', who = '', close = null }) {
  const d = String(direction || '').trim();
  const c = String(change || '').trim();
  const h = (held || []).map((x) => String(x || '').trim()).filter(Boolean);
  return [
    `${between ? 'A passage' : 'The last passage'} of ${chapterLabel} stopped partway through${tail ? `. It stops here:\n${fence(`…${tail}`)}` : '.'}`,
    d ? `What I asked for in it: ${d}` : '',
    c ? `It was written again with a change, which is now what happens: ${c}` : '',
    h.length ? `Some of its words were written again with ${h.length === 1 ? 'this note' : 'these notes'} — what ${h.length === 1 ? 'it asks' : 'they ask'} holds for the rest of it too:\n${h.map((x) => `- ${x}`).join('\n')}` : '',
    transcript ? `This passage is a scene we played, being written into prose. Here’s the scene${who ? `, with me taking ${who}’s part` : ''}:\n${fence(transcript)}\nFinish only what’s left of it after the prose so far. Keep what happened and what was said — don’t repeat the part already written, and don’t change how it turned out. ${hisLinesStand(String(who || '').trim() || 'my character')} How I spoke my moves doesn’t change the book’s point of view.` : '',
    d || c ? YOURS_ONLY : '',
    `Carry on from exactly where it stops. Start by repeating its last few words exactly as they are${tail ? '' : ' (from the start of its last sentence)'}, then keep going — I’ll trim the repeat and join the rest straight on, so don’t start over or retell anything.${between ? ' What comes after the passage is already written, so bring it to where that picks up.' : ''}`,
    between || !outcome ? '' : outcomeWords(outcome),
    close && !between ? closeLine(chapterLabel, close) : '',
    close && !between ? `Just the story itself — no notes, nothing before or after it but ${CHAPTER_ENDS} where it ends the chapter.` : 'Just the story itself — no notes, nothing before or after it.',
  ].filter(Boolean).join('\n\n');
}

export function playToProseRequest({ chapterLabel, who, transcript, length, between = false, opens = false }) {
  const w = String(who || '').trim() || 'my character';
  /* between: the scene was set before passages written since, and goes in where it was set (Cozy Tavern M548);
   * opens: it is the first of a chapter after the chapters written (a new chapter, one the writer's last ended — 2.12.28) */
  const open = !between && opens;
  return [
    `We played a scene picking up ${between ? `at the point in ${chapterLabel} where it was set` : open ? `where the chapter before ${chapterLabel} leaves off` : `where ${chapterLabel} leaves off`}: I took ${w}’s part, and you told everything else. Here’s how it went — my lines are the ones marked “${w}:”, yours are marked “Narrator:”.`,
    fence(transcript),
    `Now write it into the book as ${between ? `the part of ${chapterLabel} that comes there` : open ? `the opening of ${chapterLabel}` : `the next part of ${chapterLabel}`} — real prose in the book's own voice, not a transcript. Keep what happened and what was said; smooth it, give it room, let it read like the rest of the novel.${length === 'paragraphs' ? ' Keep it short.' : ''}`,
    hisLinesStand(w),
    `It has to read as one book with what comes before: its first lines carry straight on from ${between ? 'the passage before it' : open ? 'where the chapter before stops' : `where ${chapterLabel} stops now`} — nothing told twice.${between ? ' What comes after it is already written, so bring it to where that picks up.' : ''} Tell it from the point of view and in the tense chosen for the book, whoever I played: if the book sees through someone else’s eyes, it stays behind theirs, and ${w}’s thoughts come only as the book would give them. Where the book stays behind one person’s eyes at a time, change whose only at a scene break (* * *), and make plain whose eyes we’re behind now; a book told from above everyone can move between minds on purpose, without the break.`,
    between ? STORY_ONLY_BETWEEN : STORY_ONLY,
  ].join('\n\n');
}

/* Ideas: a few premises for what happens next, each in its own block */
export function ideasRequest(count, { not = [] } = {}) {
  const n = Math.max(1, Math.min(5, Math.round(Number(count) || 4)));
  /* "New ideas": told the ones it gave last, so it never hands them back (Cozy Tavern's M30-002) */
  const notThese = (not || []).filter((x) => String(x || '').trim());
  const again = notThese.length ? `\n\nNew ones — not these, which you gave me last time:\n${notThese.map((x) => `- ${String(x).replace(/\s+/g, ' ').trim()}`).join('\n')}` : '';
  return `Give me ${n === 1 ? 'one premise' : `${numberWords(n).toLowerCase()} genuinely different premises`} for what happens next in the book, right from where it stops — ${n === 1 ? 'the one' : 'each one'} I'd most enjoy writing from, true to the people in it. Each a few lines in my voice, the way I'd type it in the box, in its own ${'<direction>'}…${'</direction>'}. Nothing else.${again}`;
}

/* --------------------------------------------------------- the partner */
/* A writer who knows the book inside out (Cozy Tavern's housekeeper, as a
 * novelist): talks it over, and when asked, makes the change itself — a
 * passage, a chapter's name, what the book is about, a card in the notes —
 * each one shown to him with its Undo (talk.js applies them). */

export const CHANGES_OPEN = '<changes>';
export const CHANGES_CLOSE = '</changes>';
export const READ_OPEN = '<read>';
export const READ_CLOSE = '</read>';
/* a premise it offers for the next page: shown with its own Use as the next direction */
export const DIRECTION_OPEN = '<direction>';
export const DIRECTION_CLOSE = '</direction>';

/* whether its changes land at once or wait for him — said, so its words after the block are true */
const LANDS = {
  now: 'I see every change as it lands, and any of them can be undone.',
  wait: 'Each change waits until I apply it — until then nothing in the book changes, and what waits is not in the book: to change the same passage or card again in a later answer, give it whole as it should finally read (the newer proposal replaces the older one waiting for that thing), never a small change on top of words that are only waiting. I apply everything waiting at once, in the order you proposed it, or pick.',
};
const partnerChanges = (applies, recall = true, byPage = false) => `When I ask for a change — or you see one that plainly needs making and I’d want it — make it yourself, in the same answer: a changes block at the very top, then a line for each change saying what you changed and why. ${LANDS[applies] || LANDS.now}

${CHANGES_OPEN}[
  {"passage": "2.3", "find": "the exact words", "replace": "the new words", "why": "…"},
  {"passage": "2.3", "rewrite": "what must change in it and what must stay — your note to the writer, who writes the passage again from it", "why": "…"},
  {"passage": "2.3", "text": "the whole passage in your own words — only when I ask for your words", "why": "…"},
  {"passage": "2.4", "remove": true, "why": "…"},
  {"replace_all": true, "find": "…", "replace": "…", "chapters": "2-5", "why": "…"},
  {"rename": {"from": "Name Surname", "to": "Surname Name"}, "why": "…"},
  {"chapter": 2, "name": "its new name", "why": "…"},
  {"summary": 2, "text": "…", "why": "…"},
  {"plan": 4, "text": "what Chapter Four is for", "why": "…"},
  {"book": "about", "find": "…", "replace": "…", "why": "…"},
  {"note": "people", "name": "…", "about": "…", "ties": "…", "now": "…", "newName": "…", "why": "…"},
  {"note": "places", "name": "…", "remove": true, "why": "…"},
  {"entry": "Name", "kind": "people", "line": "who or what it is, in a line", "text": "the entry", "aka": ["another name"], "why": "…"},
  {"entry": "Name", "add": "a paragraph added to the entry", "why": "…"},
  {"module": "The novel craft", "find": "…", "replace": "…", "why": "…"}
]${CHANGES_CLOSE}

- "2.3" is passage 3 of Chapter Two as the page numbers it — a passage may hold many paragraphs, even a whole chapter (1.1 can be all of Chapter One); the number is never a paragraph’s. Quote "find" exactly — enough to be found in one place only. "rewrite" hands the passage to the writer — who works from my instructions and the craft — to write it again from your note: say what must change and what must stay, nothing about how to write. "text" is your own prose for it — only when I ask for your words. Either makes a new version, one arrow from the words before. "replace_all": the same words in the chapters named ("2-5", "3", "all"); "rename": a name everywhere at once, never an ordinary word.
- "book" is "title", "subtitle", "about", "style" or "plans": "find"/"replace", "text" for all of it, or "add" a paragraph. "summary": a chapter's summary. "plan": what a chapter is for — my plan for it, which the writer reads only while writing in that chapter; the number after the last chapter makes a new, empty chapter to hold it, so a few in a row map the chapters ahead.
- "note" is "people", "places", "lore" or "threads" (with "open": false once resolved), the card named as the notes name it: only the parts you give change — leave the rest out; "aka" adds other names, "dropAka" takes one off; "newName" renames a card; "remove": true takes it out. "module" changes one of my modules' words — only when I ask.
- "entry" is an entry in my bibliography — the world behind the book: what is true of a name whether or not a page has said it yet. How someone looks and what makes them unlike anyone else, where they come from and what they carry, what a place is like, how a power or a technique works and what it costs, what a word of the world means, what a group is and who leads it. The writer reads an entry ${READS_WHEN(recall, byPage)}, and writes from it as the truth of the world; I read it when I tap the name. This is where the world is made up, and that is your job in it: when I ask for an entry, write it — whole, in the block, in that same answer — richly and particularly, the way a novelist builds a world, inventing freely wherever the pages have not spoken and never against what they have said; what I tell you is true of them is true. Never ask me for the particulars first or offer me choices instead of the entry: write it, and I change what I see differently. "kind" is "people", "places", "things", "groups" or "lore"; "line" says in a line who or what it is; "text" is the entry whole, "add" a paragraph added to it; ${byPage ? '"rides" only as "never", when I ask to keep an entry for myself — with Super automatic on, what each page needs decides the rest, so you never set "always";' : `"rides" is "named" (the writer reads it ${READS_WHEN(recall)} — the usual), "always" (what every page needs — how the world works at its root) or "never" (only for me);`} "newName", "aka", "dropAka" and "remove" as for a card.
- To read more first: ${READ_OPEN}[2]${READ_CLOSE} sends Chapter Two whole (the chapter open too, when some of it is left out), ${READ_OPEN}["find: Name Surname"]${READ_CLOSE} every place those words stand, ${READ_OPEN}["card: Name"]${READ_CLOSE} a card shown by its first line, whole, ${READ_OPEN}["entry: Name"]${READ_CLOSE} an entry of my bibliography, whole, ${READ_OPEN}["about"]${READ_CLOSE} the book’s own words as they stand now — what it’s about, how it reads, where it’s headed — to quote exactly before changing them, ${READ_OPEN}["module: The novel craft"]${READ_CLOSE} a module's words — then you go on with the same answer.
- The pages already written are yours to change when I ask — "rewrite", or "find"/"replace" — every passage the change touches, chapter by chapter. Never write the passage yourself unless I ask for your words. When the story changes, everything that tells the old story changes with it in the same block — every card, thread and entry, What it's about and Where it's headed, and the plans of the chapters ahead; a thread about a thing that no longer happens is taken out. A premise in ${DIRECTION_OPEN}…${DIRECTION_CLOSE} is for the page not written yet — never hand me one for a page that exists, and never leave a page as it was because changing it is "a real edit". When I ask whether the story should change — "would it be better if…", "is it possible to edit…", "do you agree?" — say what you think, make the changes to the notes and the bibliography that follow, and name the passages that would have to be written again, offering it in a line: "Say rewrite and I hand 1.3–1.5 to the writer with my notes." When I say so — or ask for the change plainly — do it in that same answer.
- A passage you write is the book: in it, people know only what they have lived, seen or been told — what we say here stays ours unless I ask for it on the page.
- Only quote what you can see, and never say the pages hold what they do not: the pages are what they are, and what I ask you to make — an entry, a plan, a card, a note for the writer — is ours to make up, so make it. Nothing changes by being said — only the block changes it — so never say a thing is done unless it is in the block, and never describe what you would write in place of writing it.`;

/* the notes' upkeep, as it is now (Cozy Tavern M567: a worker is never told the app does what it is not doing) */
const NOTES_KEEP = 'The notes look after themselves — every new page is read into them, and every so often each card is checked against the book and cards that repeat each other are folded into one — so leave the upkeep to that: change a card when I ask, or when one is plainly wrong about the book, and never offer to tidy them.';
const NOTES_UNKEPT = 'Nothing reads the new pages into the notes just now, so they may lag behind the book: where a card is out of date with it, say so and offer the change — and make it when I ask.';
export function partnerFrame(house, novel, { notesAs = 'system', tools = true, notesKept = true } = {}) {
  return [
    TELLER_VOICE,
    `We’re talking over our novel, ${titleLine(novel)}, the way two writers do — you as my writing partner. The book comes to you fresh with every message of mine, just as it reads right now — any change of yours that went in is already there, and I never paste pages to you. Where some of it is cut short or left out to save room, it says so right there, with how to read it. Say what you really think — what works and what doesn’t, and why; what the people in it would truly do; where it could go — and keep the book straight, changing it when I ask. Keep what the pages actually say apart from what you’re guessing at or suggesting. ${tools ? 'Before a change that hangs on words you can’t see here, read those pages first; if you can’t, tell me what’s still uncertain.' : 'Go only by what’s here, and never claim to have read pages you haven’t.'} ${notesKept ? NOTES_KEEP : NOTES_UNKEPT} You don’t write the next pages: the writer does, from my premise. A premise I could hand it goes in its own ${DIRECTION_OPEN}…${DIRECTION_CLOSE}, in my voice, as I’d type it. ${FICTION_TELL}`,
    PROSE_GUIDE,
    /* Ideas reads nothing more and changes nothing: it is never told it could (Cozy Tavern's M241) */
    tools ? partnerChanges(appliesOf(house), recallOn(novel), superOn(house)) : '',
    notesAs === 'system' ? hereIs('partner') : '',
  ].filter(Boolean).join('\n\n');
}

/* the chapters it asked for, sent back whole — and what one answer could
 * not read at once, named (Cozy Tavern's M84-2: never a silent cut) */
export function readBack(rows, { cut = false, notSent = [] } = {}) {
  const left = notSent.length ? ` Not sent: ${notSent.join(', ')} — one answer reads ${numberWords(rows.length).toLowerCase()} at most; ask for ${notSent.length === 1 ? 'it' : 'them'} in your next read block if you need ${notSent.length === 1 ? 'it' : 'them'}.` : '';
  return [
    rows.map((r) => `${r.label}${r.missing ? ' — not in the book' : ''}\n\n${r.text}`).join('\n\n\n'),
    (cut ? 'Here they are — as much of each as fits here beside everything else, the rest left out where it says so.' : 'Here they are, whole.') + left + ' Go on with your answer.',
  ].join('\n\n');
}

/* ------------------------------------------------------- the narrator */

/* a line of his that is not his character's — how he'd like the telling to go */
export const TELL_LEAD = 'Just for you, not something';
export function tellLine(who, tell) {
  const w = String(who || '').trim() || 'my character';
  return `(${TELL_LEAD} ${w} says or does — ${String(tell || '').trim()})`;
}

/* three ways the scene could go, offered after the narrator's part */
export const CHOICES_OPEN = '<choices>';
export const CHOICES_CLOSE = '</choices>';
const choicesWords = (who) => `After each part you tell, once it stops where ${who} would answer or act, offer me three different things ${who} might say or do next — a short line each, as different from one another as you can make them — between ${CHOICES_OPEN} and ${CHOICES_CLOSE}, one to a line. This is the one place I want options put in front of me. They’re only offers, outside the scene: nothing ${who} does is decided until I choose.`;

export function playFrame(house, novel, play, chapterLabel, { notesAs = 'system' } = {}) {
  const who = String(play.who || '').trim() || 'my character';
  const from = String(play.from || '').trim();
  return [
    `This is our novel, ${titleLine(novel)}. ${FICTION_TELL}`,
    TELLER_VOICE,
    PROSE_GUIDE,
    `We’re playing a scene from it, and I’m taking ${who}’s part. Everything ${who} says, does, thinks and feels comes from me, in my lines; you tell everything else — the place, the other people and what they say and do, what happens. Tell it the way the book is told, in its own voice, point of view and tense: if the book sees through ${who}’s eyes, tell what ${who} sees, hears and meets, never what ${who} does or feels about it; if it sees through someone else’s, it stays theirs. Never put a word, a choice or a feeling in ${who}’s mouth or mind, and stop where ${who} would answer or act — that part is mine.`,
    `What I write of ${who}’s thoughts, and anything my lines explain — how a power works, its limits, why, what ${who} means or plans — is for you alone: everyone else knows only what ${who} lets them see and hear, and what anyone there would plainly make of it.`,
    `When a line of mine begins “(${TELL_LEAD} ${who} says or does”, it isn’t part of the scene: it’s how I’d like the telling to go from here. Follow it as you tell, and never mention it.`,
    house && house.sceneChoices ? choicesWords(who) : '',
    `Where the scene starts: ${from || `right where ${chapterLabel} leaves off`}.`,
    notesAs === 'system' ? hereIs('play') : '',
  ].filter(Boolean).join('\n\n');
}

/* the narrator's words without its offers — and, while they are still
 * coming, without the part of them that has come so far */
export function sceneWords(text) {
  let t = String(text || '');
  const at = t.toLowerCase().indexOf(CHOICES_OPEN);
  if (at >= 0) {
    const end = t.toLowerCase().indexOf(CHOICES_CLOSE, at);
    t = end >= 0 ? t.slice(0, at) + t.slice(end + CHOICES_CLOSE.length) : t.slice(0, at);
  } else {
    /* the first letters of the block, just arrived */
    const tail = t.match(/<[a-z]*$/i);
    if (tail && CHOICES_OPEN.startsWith(tail[0].toLowerCase())) t = t.slice(0, tail.index);
  }
  return t.replace(/\s+$/, '');
}
/* the three ways it could go, as offered (in a finished answer): plain lines, numbering let go */
export function choicesIn(text) {
  const t = String(text || '');
  const at = t.toLowerCase().indexOf(CHOICES_OPEN);
  if (at < 0) return [];
  /* a finished answer whose closing tag never came: what follows the opening is the offer */
  const end = t.toLowerCase().indexOf(CHOICES_CLOSE, at);
  return t.slice(at + CHOICES_OPEN.length, end >= 0 ? end : undefined).split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\(\d+\))\s*/, '').trim())
    .filter(Boolean).slice(0, 3);
}

export function playOpening({ who }) {
  const w = String(who || '').trim() || 'my character';
  return `Open the scene: where we are, who’s there, what’s going on. Start where the book and my description of the start put ${w}; if neither settles how ${w} arrives or comes in, leave that to me. Tell everything around ${w} up to the first moment ${w} would answer or act, then stop.`;
}

export function playOnwards({ who }) {
  const w = String(who || '').trim() || 'my character';
  return `Go on with the scene from where the chapter now stands, and stop at the next moment ${w} would answer or act.`;
}

/* ---------------------------------------------------- words to avoid */

/* his list, one to a line: nothing empty, nothing twice */
export function avoidList(house) {
  const raw = String((house && house.instructions && house.instructions.avoid) || '');
  const out = [];
  for (const line of raw.split('\n')) {
    const w = line.replace(/^["“”']+|["“”']+$/g, '').trim();
    if (w && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
  }
  return out;
}
export function avoidLine(list) {
  return list && list.length ? `Words and phrases I never want in the book: ${list.map((w) => `“${w}”`).join(', ')}.` : '';
}

/* The oldest chapters a request left out even as summaries, said to him
 * under the page or the answer (Cozy Tavern M265: no silent cut) */
export function leftOutWords(n, who = 'the writer') {
  const what = n === 1 ? 'The first chapter' : `The first ${numberWords(n).toLowerCase()} chapters`;
  return `${what} did not fit ${who}’s room even as ${n === 1 ? 'a summary' : 'summaries'}, so ${n === 1 ? 'it was' : 'they were'} left out — a model with more room is given the whole story.`;
}

/* ------------------------------------------------------- the checker */

export const CHECK_KINDS = ['grammar', 'clarity', 'humanize', 'avoid', 'seam', 'continuity', 'craft'];
/* the judge's five of 2.4.1–2.4.2 (Cozy Tavern's benchmark, for a novel): a
 * grade kept from then still shows by them */
export const GRADE_AXES = [['prose', 'Prose'], ['people', 'People'], ['continuity', 'Continuity'], ['pacing', 'Pacing'], ['pull', 'Pull']];

/* The judge's ten checks, each a yes or a no with the words that fail it,
 * the grade the number passed. Why checks and not a number out of ten: a
 * judge's whole-page number agrees with expert readers barely better than
 * chance (Chakrabarty et al., "Art or Artifice?", arXiv 2309.14556; EQ-Bench's
 * own grader against expert writers, Surge's Hemingway-bench), while tests
 * of craft a reader can check — TTCW's fourteen, made from what editors look
 * for — hold steady. These are TTCW's tests made into checks a page of a
 * novel can be held to (pacing; scene and summary; language and figures;
 * the ending; perspective and voice; the turn; originality; the world felt;
 * people not there for the plot; subtext), with the faults editors fix most
 * in machine-made fiction (Chakrabarty et al., arXiv 2409.14509: awkward
 * phrasing, clumsy sentences, explaining, cliché) and the book's own: the
 * seam with the passage before, the book's truth. */
export const JUDGE_CHECKS = [
  ['opening', 'Opening', 'its first lines carry straight on from where the story before it stopped — the same moment, everyone where they were, nothing told twice, any jump in time or place marked (the book’s very first page: it opens with something happening)'],
  ['canon', 'True to the book', 'nothing in it disagrees with the book, its notes or what came before — names, looks, where everyone is, who knows what (nobody knows what they never lived, saw or were told) — and it keeps the book’s point of view and tense as the directions for this passage set them; the pages outweigh a stale note, and a deliberate change of viewpoint or tense is not a slip'],
  ['shown', 'Shown', 'what matters is played out as scene, not summed up; nothing is explained that the scene already shows; people don’t announce their feelings in tidy sentences, and the telling doesn’t decode them'],
  ['pacing', 'Pacing', 'each beat gets the room it deserves — nothing that matters rushed past, nothing idle dragged out'],
  ['specific', 'Specific', 'concrete, particular detail of this place and these people; nothing vague or generic where a real detail belongs'],
  ['fresh', 'Fresh', 'no cliché or stock phrase, no stock bodily cue standing in for a feeling, no purple or overwritten line, no “it wasn’t X — it was Y” turn'],
  ['sentences', 'Sentences', 'every sentence reads clean and natural, with a rhythm that varies — nothing awkward, clumsy or one shape after another'],
  ['people', 'People', 'everyone acts and speaks from their own wants and nature, each in their own voice — nobody there only to move things along, nobody agreeing or giving way without a reason'],
  ['moves', 'Moves', 'by its end something has concretely changed — someone moved, chose, learned, lost or won; a quiet passage moves when a mood hardens or a fact travels'],
  ['ending', 'Ending', 'it ends on forward motion — never on a summary of what it meant, a lesson, a recap or the weather'],
];
/* how many checks a passage may fail and still meet his mark */
export function allowedFails(target) { return Math.max(0, Math.floor(10 - target + 1e-9)); }

/* how the book writes sound (About this book → Sound), so the checker never
 * "fixes" it */
const SOUND_STYLE = {
  comic: 'So is how it writes sound: the world’s sounds as sound effects in asterisks (*CLANG!*, *thud thud*), and voices — moans, cries, breaths — written out in quotes, stretched and repeated ("Nngh—!", "Ahh—ahh—").',
  novel: 'So is how it writes sound: voices — moans, cries, breaths — written out in quotes, stretched and repeated ("Nngh—!", "Ahh—ahh—").',
};

export function checkerFrame(house, novel) {
  const name = nameOf(house);
  return `${FICTION_WORK}\n\nYou read ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, the way a careful copy editor would: each passage once it’s finished, for what is plainly wrong or would plainly read better — never to change what happens, the people in it, or the voice it’s told in. Judge it against the directions that wrote it and its chosen genre, language and style. Respect chosen viewpoint, omniscient narration, humour, dialect, deliberate grammar and fragments. Follow my version of a familiar character. Preserve meaning and knowledge; never invent a detail to make a line more specific. Distinguish the teller’s knowledge from what anyone in the story knows.`;
}

/* stock wording counted in the passages (stock.js), one line: [1.2] “…”, “…”; [1.3] “…” */
/* stretches a passage copies word for word from the pages right before it (Cozy Tavern M512-1) */
function repeatsLine(repeats) {
  const rows = Object.entries(repeats || {}).filter(([, list]) => list && list.length);
  if (!rows.length) return '';
  return `\nWords copied from the pages right before, word for word — each to be said another way, unless the book repeats it on purpose (a refrain, a callback): ${rows.map(([n, list]) => `[${n}] ${list.map((w) => `“${w}”`).join(', ')}`).join('; ')}.`;
}
function stockLine(stock) {
  const rows = Object.entries(stock || {}).filter(([, list]) => list && list.length);
  if (!rows.length) return '';
  return `\nStock wording counted in these passages — phrases that stand in machine-made fiction hundreds of times more often than in books people write — each to be said another way: ${rows.map(([n, list]) => `[${n}] ${list.map((w) => `“${w}”`).join(', ')}`).join('; ')}.`;
}

/* before: the story right before the passages — of their own chapter, or
 * (the chapter's first passages) the end of the chapter before */
/* what the checker and the judge are told the writer is told: his own words
 * for how it is written (and his note at the end), so nothing he asked for is
 * ever "fixed" or held against a page; and the story so far, chapter by
 * chapter, for what is true in it beyond the notes */
/* The notes are kept to the newest page of the book: what someone is doing or
 * feeling "right now" there is never the moment of a passage from earlier in
 * it (Cozy Tavern G3) */
const NOTES_FOR_A_READER = 'The book’s notes, for what is true in it (where they and the book’s other passages disagree, those passages are right — the passages being read here are never their own proof). They are kept to the newest page of the book: each “Right now” is where someone stands at the end of the book so far (a “Last seen” where they were last told to be), never at these passages — a passage from earlier in the book is not wrong for coming before it:';

/* what I asked the writer for in these passages, each by its number — doing
 * it is never a fault; whole (a very long ask, its opening, said so: never cut
 * without a word — S14-G5) */
export const ASK_ROOM = 6000;
function askedLines(asked) {
  const rows = (asked || []).filter((a) => a && String(a.words || '').trim()).map((a) => {
    const t = String(a.words).replace(/\s+/g, ' ').trim();
    return `[${a.n}] ${t.length > ASK_ROOM ? `${cutWords(t, ASK_ROOM)} (the rest of what I asked is left out here to save room)` : t}`;
  });
  return rows.length ? `What I asked the writer for in these passages — whatever a passage does because I asked for it is never a fault:\n${rows.join('\n')}` : '';
}

/* left: how many chapters before these are left out of the story so far, said (S06-G7) */
function writerSees({ his = '', sofar = '', left = 0 }) {
  const out = [];
  if (his && his.trim()) out.push(`How I want the book written — what the writer is told; nothing it asks for is ever a fault:\n${fence(his)}`);
  const gone = left ? `(The first ${left === 1 ? 'chapter is' : `${numberWords(left).toLowerCase()} chapters are`} left out here to save room — what ${left === 1 ? 'it sets' : 'they set'} up is not shown, and what is not shown is never a slip.)` : '';
  if (sofar && sofar.trim()) out.push(`The story so far, chapter by chapter:${gone ? `\n${gone}` : ''}\n${fence(sofar)}`);
  else if (gone) out.push(gone);
  return out;
}
/* the paragraphs whose speech marks do not pair (textshape.js speechFaults), one line (2.12.34) */
function marksLine(marks) {
  const rows = Object.entries(marks || {}).filter(([, list]) => list && list.length);
  if (!rows.length) return '';
  return `\nSpeech marks that do not pair, counted in these paragraphs — a quotation mark left out or one too many, so speech and narration run together: set each right where its spoken words begin and end, in the kind of mark the book uses, changing no word: ${rows.map(([n, list]) => `[${n}] ${list.map((w) => `«${w}»`).join(' ')}`).join('; ')}.`;
}
/* strays of another script counted in the passages (textshape.js straysIn), one line */
function straysLine(strays) {
  const rows = Object.entries(strays || {}).filter(([, list]) => list && list.length);
  if (!rows.length) return '';
  return `\nA stray character of another script stands in these passages, among words in the Latin alphabet — take it out and mend the words around it (a garbled repeat kept once), unless someone in the scene speaks or writes that language: ${rows.map(([n, list]) => `[${n}] ${list.map((w) => `“…${w}…”`).join(', ')}`).join('; ')}.`;
}

/* what a fix to the book's continuity holds to, in the book's own words — found in the story before the passage, it
 * may go in by itself (checker.js heldBy); one that holds only to the notes waits for him, the notes may be wrong */
const SAYS_RULE = 'For a "continuity" or "seam" fix, "says" is the words of the story before it that the fix holds to, copied exactly — from an earlier passage, the chapter up to these passages or the end of the chapter before — left out only when it holds to the notes or the bibliography.';

export function checkRequest({ novel, chapterLabel, numbered, avoid = [], before = '', beforeFrom = 'this', judge = null, stock = {}, strays = {}, repeats = {}, marks = {}, his = '', sofar = '', left = 0, notesFit = 0, asked = [], behind = '', gradesOnly = false, bib = '' }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit, focus: `${before}\n${numbered}` });
  if (notes) parts.push(`${NOTES_FOR_A_READER}\n${behind ? `${behind}\n` : ''}${notes}`);
  if (bib) parts.push(`${BIB_FOR_A_READER}\n\n${bib}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) parts.push(about);
  parts.push(...writerSees({ his, sofar, left }));
  if (before && before.trim()) parts.push(beforeFrom === 'last' ? `The end of the chapter before, for where ${chapterLabel} picks up:\n${fence(before)}` : `${chapterLabel} up to these passages, for what has just happened:\n${fence(before)}`);
  const askedPart = askedLines(asked);
  if (askedPart) parts.push(askedPart);
  parts.push(`Check these passages from ${chapterLabel}, each numbered as it is on the page:\n${fence(numbered)}`);
  const allowed = judge ? allowedFails(judge.target) : 0;
  /* the passages an answer gave no grade for, asked once more for their grades alone (S06-G6) */
  if (gradesOnly && judge) {
    parts.push(`Judge each passage’s craft as a page of a finished novel, by ten checks. Answer every check of every passage "yes" or "no" — "no" only where you can point to the words in it that fail the check; a check with nothing to try in a passage is "yes".
${JUDGE_CHECKS.map(([k, , what]) => `- ${k}: ${what}.`).join('\n')}
For each "no", a fault: the check, "words" — the words that fail it, copied exactly from the passage, no more than a sentence — and "why", in a few words. A passage with ${allowed ? `more than ${numberWords(allowed).toLowerCase()} “no”` : 'any “no”'} is under my mark of ${judge.target}: in "lift" say, in a few lines in my voice, what writing it again would need to reach ${judge.target}.

Answer with one JSON object and nothing else: {"grades": [{"passage": "2.3", "checks": {${JUDGE_CHECKS.map(([k], i) => `"${k}": "${i === 9 ? 'no' : 'yes'}"`).join(', ')}}, "faults": [{"check": "ending", "words": "…", "why": "…"}], "lift": "…"}]}`);
    return parts.join('\n\n');
  }
  parts.push(`Suggest only what is worth changing, each a fix in place — a word, a phrase, or a whole sentence written again when a small fix won't do:
- "grammar": spelling, grammar, punctuation; two words run together or one split apart; a space missing or doubled; a word missing, doubled, or wrong for the meaning (their/there, affect/effect, lay/lie); two sentences run together with a comma; agreement; a tense slip, inside a sentence or from the tense the book is told in; a slip from the point of view the book is told in; capitals; and the book kept consistent — a word spelled one way throughout (grey/gray, half-light/half light), numbers and quote marks as the book writes them. And dialogue set as a book sets it: every spoken line opens and closes its quotation marks, in one kind of mark; a new speaker begins a new paragraph — where a second person speaks inside the same paragraph, part it there (the fix's words with a line break where the new paragraph begins); the comma, question or exclamation mark inside the closing quote before a tag, and the tag after it in small letters unless it begins with a name ("Go," she said); a quotation inside speech in the other kind of mark; a sentence of speech run on into the narration, or narration left inside a quote.${marksLine(marks)}
- "clarity": a sentence hard to follow, tangled, or running on; padding; phrasing unnatural in the book's language (a wrong preposition, words that don't go together); a weak passive or buried verb where the active is plainer (a passive the book means stays) — the sentence written again whole when it needs it.
- "humanize": what reads machine-made rather than written, said the way this book would say it. Most often: a phrase that is awkward, or not how anyone would put it; a sentence that is clumsy, overloaded, or the same shape as the ones around it; explaining what the scene already shows, or what a look or a line meant; a cliché or stock phrase (a heart hammering against ribs, a voice barely above a whisper, a breath she didn’t know she was holding, a testament to); a purple or overwritten line, figures piled on figures; a vague word where a particular detail belongs, or a flat one where a precise one belongs; a word out of the book's voice or time, unless a character talks that way; the turn “it wasn’t X — it was Y”; a feeling given only by the same stock bodily cue; a closing line that says what it all meant; things in threes by habit; a named person called by a string of descriptions instead of their name; the same word twice close together, or a phrase the book keeps reaching for.${stockLine(stock)}${repeatsLine(repeats)}${straysLine(strays)}${avoid.length ? `
- "avoid": anything on my list of words to avoid (${avoid.map((w) => `“${w}”`).join(', ')}), said another way.` : ''}
- "seam": this is to be a finished book, so each passage must carry on smoothly from the end of the one before it — no beat told twice, no line answered twice, no jump in time or place nobody marks, no one standing where the passage before left them gone. Where an opening doesn't carry on, fix the opening. A scene break (* * *) marks a jump in time or place: the passage after one begins a new scene.
- "continuity": something that disagrees with the book, its notes or its bibliography — a name, a look, a fact, who knows what; where people and things are (who is in the room and who has gone; who sits, stands or lies, how near, on which side; what each holds, wears or carries, and in which hand; a wound, a door, a light, the weather, the hour, the day — what changed must have been changed on the page); words said again (a line remembered, quoted or answered back is the line as it was said); and time (what came first, how long ago). A slip needs a written fact it goes against: something new the notes or the earlier chapters do not hold yet — a sister, a scar, a past — is the story growing, never a slip. Only what the telling gives as true is a slip: what someone says that is wrong on purpose or in character — a lie, a joke, a tease, an exaggeration, sarcasm, a memory gone wrong, someone who does not know — is the story, and never a fix. But someone knowing what they never lived, saw or were told — a secret, how another’s power works or its limits, what my words to the writer explain — beyond what anyone there would plainly make of it, is a slip.

Keep the book’s voice: a fragment, dialect, a character’s own way of talking, or a choice of style the book makes on purpose is not a mistake${his && his.trim() ? ', and nothing I ask the writer for (above) is one' : ''}. ${SOUND_STYLE[soundOf(novel)]} Leave what is right alone; a passage that needs nothing gets nothing.

Each fix replaces a stretch of words: "find" is the words exactly as they stand in that passage — copied exactly, enough of them to stand in only one place in it — "replace" the new words, and "why" a few words on why. ${SAYS_RULE}${judge ? `

Then judge each passage’s craft as a page of a finished novel, by ten checks. Answer every check of every passage "yes" or "no" — "no" only where you can point to the words in it that fail the check; a check with nothing to try in a passage (nobody speaks: the voices) is "yes". Judged like this, a page from a published novelist fails one or two; a page that reads machine-made fails most. More figures, longer sentences or rarer words are never better writing: overwriting fails "fresh".
${JUDGE_CHECKS.map(([k, , what]) => `- ${k}: ${what}.`).join('\n')}
For each "no", a fault: the check, "words" — the words that fail it, copied exactly from the passage, no more than a sentence — and "why", in a few words. A passage with ${allowed ? `more than ${numberWords(allowed).toLowerCase()} “no”` : 'any “no”'} is under my mark of ${judge.target}: for it, add fixes of kind "craft" — small changes in place that lift it — and in "lift" say, in a few lines in my voice, what writing it again would need to reach ${judge.target} (“Slow the moment she falls…”).` : ''}

Answer with one JSON object and nothing else: {"edits": [{"passage": "2.3", "kind": "grammar", "find": "…", "replace": "…", "why": "…"}, {"passage": "2.4", "kind": "continuity", "find": "…", "replace": "…", "why": "…", "says": "…"}]${judge ? `, "grades": [{"passage": "2.3", "checks": {${JUDGE_CHECKS.map(([k], i) => `"${k}": "${i === 9 ? 'no' : 'yes'}"`).join(', ')}}, "faults": [{"check": "ending", "words": "…", "why": "…"}], "lift": "…"}]` : ''}} — or {"edits": []${judge ? ', "grades": […]' : ''}} when nothing needs fixing.`);
  return parts.join('\n\n');
}

/* THE CHAPTER READ WHOLE (checker.js runWhole): once every passage of a chapter is checked, the chapter read start
 * to end — in parts, each with the chapter up to it, when it is longer than its model holds — for what disagrees
 * across it: where people and things are, who knows what, words said again, time, the seams. The later words are
 * put right to the earlier with the smallest fix, never what happens; each fix quotes what it holds to. */
export const WHOLE_ASK = 'Read it as one chapter';

/* THE PROOFREADING (checker.js runProof, 2.12.35): every checked passage read once more for slips of the hand alone —
 * the checking asks for nine things at once, and a slip is the easiest of them to miss (his page: "wassentiment",
 * "ash, She looked", under a green light). Only slips: never the wording, the rhythm, the voice. */
export const PROOF_ASK = 'Find every slip of the hand in them';
export function proofRequest({ novel, chapterLabel, numbered, his = '', hints = {} }) {
  const out = [];
  const about = aboutTheBook(novel, { plans: false });
  if (about) out.push(about);
  if (his && his.trim()) out.push(`How I want the book written — nothing it asks for is ever a slip:\n${fence(his)}`);
  out.push(`Passages from ${chapterLabel}, each numbered as it is on the page:\n${fence(numbered)}`);
  const rows = Object.entries(hints || {}).filter(([, list]) => list && list.length);
  const looks = rows.length ? `\nThese places look like slips — read each, and mend it only if it is one: ${rows.map(([n, list]) => `[${n}] ${list.map((w) => `“${w}”`).join(', ')}`).join('; ')}.` : '';
  out.push(`Proofread them the way a careful proofreader reads a novel before it goes to print. ${PROOF_ASK}, sentence by sentence — every one, and nothing that is not one:
- a word misspelled, two words run together ("wassentiment") or one word split apart;
- a space missing — after a full stop, a comma, a closing quote — or doubled, or standing before a comma or a full stop;
- a word doubled ("the the"), or a small word dropped where the sentence plainly needs it;
- punctuation: a sentence with no end mark, a stray or doubled mark, two sentences run together with a comma ("…to ash, She looked at him");
- capitals: a sentence or a name that should begin with one, a capital in the middle of a sentence that should not have one;
- quotation marks that do not open and close, a spoken line run into the narration.${looks}
Never touch the style or the voice: a fragment, dialect, slang, a character’s own way of talking, a sound written out ("Nngh—!", "Tck."), an invented word or a name, spelling as the book spells it (British or American), and anything the book does on purpose stay as they are. ${SOUND_STYLE[soundOf(novel)]} Nothing about wording, rhythm or meaning — only slips. Leave what is right alone; a passage with no slip gets nothing.

Each fix: "passage" its number, "find" the words exactly as they stand in that passage — the slip with a few words around it, enough to stand in only one place — "replace" those same words with only the slip mended, and "why" in a few words.

Answer with one JSON object and nothing else: {"edits": [{"passage": "2.3", "find": "…", "replace": "…", "why": "…"}]} — or {"edits": []} when there is no slip.`);
  return out.join('\n\n');
}

/* THE SPEECH MARKS THE REPAIR CANNOT SET (Cozy Tavern M753, checker.js runMarks): a paragraph whose quotation marks do
 * not pair, where no mark stands in for the one left out — where it belongs is a reading of the sentence, not of its
 * marks. Only quotation marks may be added (textshape.js insertsOnlyMarks): no word, no other mark, nothing taken away. */
export const MARKS_ASK = 'Add the quotation marks each spoken line is missing';
export function marksRequest({ rows }) {
  return `The speech marks of these paragraphs do not pair, so the page runs narration into speech and speech into narration:
${rows.map((r) => `${r.n}. «${r.line}»`).join('\n')}

${MARKS_ASK}, where its spoken words begin and end, in the kind of quotation mark the paragraph already uses. Change no word and no other mark, and take nothing away — each paragraph comes back whole, every letter as it stands, with only quotation marks added.

Answer with one JSON object and nothing else: {"paragraphs": [{"n": 1, "text": "…the paragraph with its quotation marks set…"}]}`;
}
export function wholeRequest({ novel, chapterLabel, numbered, before = '', beforeFrom = 'this', his = '', sofar = '', left = 0, notesFit = 0, asked = [], behind = '', bib = '', part = 1, parts = 1 }) {
  const out = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit, focus: `${before}\n${numbered}` });
  if (notes) out.push(`${NOTES_FOR_A_READER}\n${behind ? `${behind}\n` : ''}${notes}`);
  if (bib) out.push(`${BIB_FOR_A_READER}\n\n${bib}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) out.push(about);
  out.push(...writerSees({ his, sofar, left }));
  if (before && before.trim()) out.push(beforeFrom === 'last' ? `The end of the chapter before, for where ${chapterLabel} picks up:\n${fence(before)}` : `${chapterLabel} up to these passages, as it stands:\n${fence(before)}`);
  const askedPart = askedLines(asked);
  if (askedPart) out.push(askedPart);
  out.push(`${parts > 1 ? `${chapterLabel}, part ${part} of ${parts}` : `${chapterLabel}, whole`} — each passage numbered as it is on the page:\n${fence(numbered)}`);
  out.push(`${WHOLE_ASK}, start to end, the way a careful editor reads a finished chapter for its continuity: hold every passage to everything before it — in this chapter, the chapter before, the story so far, the notes and the bibliography — and find only what disagrees:
- where people and things are: who is in the room and who has gone; who sits, stands or lies, how near, on which side; what each holds, wears or carries, and in which hand; a wound, a stain, a door open or shut, a light lit or out, the weather, the hour, the day. What changed must have been changed on the page — someone seated a line ago does not walk off without getting up, a cup set down is not still in her hand.
- who knows what: no one knowing what they never saw, heard or were told, and no one forgetting what they plainly know.
- words said again: a line remembered, quoted or answered back is the line as it was said — the same words where it is given as the same words.
- time: what came first, how long ago, the hour and the day, kept in order.
- names, looks and facts, as the book gave them.
- the seams: each passage carrying on from the end of the one before — no beat told twice, no line answered twice, no jump in time or place nobody marks. A scene break (* * *) marks a jump in time or place: the passage after one begins a new scene, and who is where may change across it.

Never change what happens, who the people are, or the voice it is told in. Put the later words right to the earlier, with the smallest fix that does it — a word, a phrase, a sentence at most — and never the earlier words to fit one later line. A slip needs a written fact it goes against: something new is the story growing, never a slip; what someone says wrong on purpose or in character — a lie, a joke, a tease, a memory gone wrong, someone who does not know — is the story, and never a fix. Leave what is right alone; a chapter that holds together gets nothing.

Each fix replaces a stretch of words in one passage: "passage" its number, "kind" "continuity" — or "seam", where a passage does not carry on from the one before — "find" the words exactly as they stand in that passage, copied exactly, enough of them to stand in only one place in it, "replace" the new words, "why" a few words on why, and "says" the words of the story before it that the fix holds to, copied exactly — from an earlier passage or the end of the chapter before — left out only when it holds to the notes or the bibliography.

Answer with one JSON object and nothing else: {"edits": [{"passage": "2.3", "kind": "continuity", "find": "…", "replace": "…", "why": "…", "says": "…"}]} — or {"edits": []} when the chapter holds together.`);
  return out.join('\n\n');
}

/* The judge's head to head (Cozy Tavern's duel): two versions of one passage,
 * written for the same moment by two writers, read blind — "A" and "B", no
 * names — and asked which is the better page; the app asks twice, the order
 * swapped, and a win counts only when both answers agree (a judge's lean to
 * the first or the second cancels out). Asking which of two is better is the
 * judging that agrees with readers most (LitBench, arXiv 2507.00769; EQ-Bench
 * ranks its writers the same way). */
export function duelRequest({ novel, chapterLabel, before = '', beforeFrom = 'this', asked = '', first, second, cut = false, his = '', sofar = '', left = 0, notesFit = 0, behind = '' }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit, focus: `${before}\n${first}\n${second}` });
  if (notes) parts.push(`${NOTES_FOR_A_READER}\n${behind ? `${behind}\n` : ''}${notes}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) parts.push(about);
  parts.push(...writerSees({ his, sofar, left }));
  if (before && before.trim()) parts.push(beforeFrom === 'last' ? `The end of the chapter before, for where ${chapterLabel} picks up:\n${fence(before)}` : `${chapterLabel} up to this passage, for what has just happened:\n${fence(before)}`);
  if (asked && asked.trim()) parts.push(`What I asked for here:\n${fence(asked)}`);
  parts.push(`Two writers each wrote this passage of ${chapterLabel}, for the same moment.\n\nPage A:\n${fence(first)}\n\nPage B:\n${fence(second)}`);
  parts.push(`Which is the better page of a finished novel here? Judge the writing, not its length: the page that carries on from the story before, stays true to the book, plays what matters as scene, gives each beat its due, keeps its detail particular, its phrasing fresh and its sentences natural, lets its people act from their own wants in their own voices, and ends moving forward. Respect the requested viewpoint, genre and style. More figures, longer sentences or rarer words are never better writing.${cut ? ' The longer page is shown only as far as the shorter one runs — never count that against it.' : ''}

Answer with one JSON object and nothing else: {"better": "A" or "B" or "same", "why": "one sentence"}.`);
  return parts.join('\n\n');
}

/* ---------------------------------------------------------- the helper */

export function helperFrame(house, novel) {
  const name = nameOf(house);
  return `${FICTION_WORK}\n\nYou keep the notes for ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, so the writer never loses track of who’s who, where things are, who knows what and what’s been set up. You read each new part of the book as it’s written and keep the notes true to it. Notes and summaries are factual reference prose: use names to make clear who “I”, “we” or “you” means in a first- or second-person telling, without inventing an identity the book has not revealed. Preserve uncertainty, lies, beliefs and an unreliable telling as such. A flashback, dream, prediction or plan is not a new event in the present story. The chosen point of view and tense guide future prose, not a rewriting of the facts you record.`;
}

/* What the helper keeps of "What it's about" and "How it reads" for a book
 * set to Automatic — never his own words, which stand above it. */
const KEEP_ABOUT = 'what the book is about as it stands — its premise and world, the people at its heart and what they want, what stands between them, and where the story is heading now';
const KEEP_STYLE = 'how the book reads — its point of view and tense, its voice, the rhythm of its sentences, how its dialogue and its quiet moments go, its register';
function keptPart(novel, key, what) {
  const k = (novel.kept && novel.kept[key]) || {};
  const own = String((key === 'about' ? novel.brief : novel.style) || '').trim();
  const mine = own ? ' (my own words above stand beside it: never repeat them — keep only what they don’t say)' : '';
  return `You also keep ${what}${mine}. As you keep it now:\n${String(k.text || '').trim() ? fence(k.text) : '(not written yet)'}`;
}
/* which of the two the helper keeps for this book (set to Automatic, not corrected by him) */
export function keptByHelper(novel) {
  const out = [];
  for (const key of ['about', 'style']) {
    const k = novel.kept && novel.kept[key];
    if (autoOn(novel, key) && !(k && k.by === 'you')) out.push(key);
  }
  return out;
}

const ABOUT_ASK = 'who they are, for good — looks and bearing, voice and how they talk, temperament, how they act under pressure, what they want, what they would never do';
const TIES_ASK = 'how they stand with the others who matter to them, and why — where each tie began, what moved it, where it is now';
const NOW_ASK = 'where they are and what they’re doing as of the end of the book so far, then their mood and what’s on their mind';
const PEOPLE_FIELDS = `"about": "${ABOUT_ASK}", "ties": "${TIES_ASK}", "now": "${NOW_ASK}"`;
/* With the bibliography kept from the book (bibliography.js), a person's card
 * is a short portrait: the lasting details go to the bibliography, sourced,
 * and what happened in a scene stays in the chapters and the Timeline — so
 * the notes that ride every page stay small, and nothing is said twice. */
const PORTRAIT_ASK = 'who they are in a short portrait, a few sentences at most — what defines them, how they come across, what they want, what they would never do';
const PEOPLE_PORTRAIT = `"about": "${PORTRAIT_ASK}", "ties": "${TIES_ASK}", "now": "${NOW_ASK}"`;
const peopleFields = (codex) => (codex ? PEOPLE_PORTRAIT : PEOPLE_FIELDS);
const ABOUT_RULE = '- A person\'s "about" is who they are for good: change it only for something lasting, never a passing mood, and keep everything already in it. On a card marked (my words), never repeat mine: give in "about" only what the book has added since — all of it, whole — and it is kept beside my words.';
const PORTRAIT_RULE = '- A person\'s "about" is a short portrait of who they are for good — a few sentences at most: what defines them, how they come across, what they want, what they would never do. Give it whole and keep it short, even when that means saying it again in fewer words. What they did in a scene is never who they are — the chapters and the Timeline keep it; a lasting detail (a feature seen up close, a habit, a skill, a piece of their past) goes in "bibliography" with its words, and the portrait keeps only what defines them. On a card marked (my words), never repeat mine: give in "about" only what the book has added since, briefly, and it is kept beside my words.';
const PLACE_ASK = "what it is, what it looks and feels like, what's there";
const LORE_ASK = 'a thing, a fact, a secret or a rule of the world worth remembering — and who knows it';
const THREAD_ASK = "what's been set up — a promise, a secret, a question, a debt — and where it stands";
const VERDICT_ASK = 'a sentence or two for me, plainly: whether the notes, with these changes, hold true to the book';
/* the request's own words for what a field holds: an answer that gives them
 * back as the field says nothing (Cozy Tavern's M656 — the prompt's own
 * placeholder kept as a fact) */
export const ASKED_WORDS = [ABOUT_ASK, PORTRAIT_ASK, TIES_ASK, NOW_ASK, PLACE_ASK, LORE_ASK, THREAD_ASK, VERDICT_ASK, 'other names they go by', 'every other name they go by', 'a short name for', 'the whole of it again'];

const NOTE_RULES = `Include only entries that are new or changed, and in each only the fields that changed — a field you give replaces the old one, so give it whole. Keep every fact that's still true{{KEPT_WHERE}}.
- Someone, somewhere or something new: write down how they're described the first time they appear — looks, features, voice, what they wear or carry{{FIRST_WHERE}}. It can't be found again later.
{{ABOUT_RULE}}
- A place's, a thing's or a thread's "about" says where it stands now: a thing that matters to what can happen next (a vehicle, a weapon, a key, a letter) with whose it is and where it is, written again when it moves; a place as it is now.
- "now" leads with where they are and what they're doing. Feelings carry over — a shock, a slight, a warmth set earlier still colours them until the story changes it. A plan is never "now": it's a thread. A flashback, a dream, a memory, a letter or a story someone tells is not now — it moves no one's "now", and someone only talked about, thought of or written to is not there; a jump in time moves the "now" of everyone it carries along: write theirs again.
- What someone says, believes, fears or plans is theirs — kept as said or believed, by whom, never as what happened, until the book shows it.
- Numbers, ages, amounts and distances exactly as the book gives them.
- "ties": add the newest turn and keep the older ones short; say why each tie moved.
- Who knows what: a secret, or something only some of them saw or were told, says who knows it — and nobody knows what they had no way to learn.
- Whose and who: a thing someone holds, a deed someone did, a line someone said is written with whose it is and who did or said it, as the book has it.
- Each fact is written once, on the card it belongs to — the person it is about, or the thing, place or thread itself. Before you add a card or a line, look for the card that already holds it and change that one; never repeat on another card what one already says.
- Use a card's name exactly as the notes show it. Someone known only by a description ("the courier") is carded by it until the book gives a name — then the name leads and the description goes among the others they go by. A crowd or a passer-by is not a person: no card for "the onlookers".
- Use "gone" only for an entry that no longer belongs in the book at all (it was only ever in text that's been taken out). Mark a thread "open": false once the story resolves it — by what happens after it was set up, never by the words that set it up (an oath sworn, a plan made, a promise given is open) and never just because time passed.
- Write only what the book actually says — never invent, never guess.`;

/* HIS PREMISES ARE HIS WORD ON THE BOOK (2.12.36 — his report: "does the notes read my premise too?" — the world his
 * premise set up was read by the writer of that one page and by nobody after it: the notes read only the page, and the
 * pages after drifted from it). Shown to the helper beside the passage it was typed for, and to the notes' check and
 * the helper's telling of the book as a list: what it says holds true of the world and its people for good is the
 * book's, even where no page says it; what it asks to happen is what he asked for — what happened is the page's. */
const PREMISE_HOLDS = 'what it says holds true for good — a rule of the world, how a power works and what it takes or costs, how rare something is, a rank or a title, a group and who leads it, who someone is, how they look, where they come from, what they want';
/* HIS LATER WORD ON A PASSAGE, BESIDE ITS PREMISE (2.12.40, the audit — his newest word wins): what he did to the
 * passage after he typed its premise (shape.js laterWords), told in his voice, each note as he gave it. Shown, the
 * premise is no longer the book where the two differ (archivist.js groundsOf, standsFolded, bookFolded). */
const LATER_TOLD = {
  rewrite: (n) => `I had it written again with the note “${n}”`,
  selection: (n) => `I had some of its words written again with the note “${n}”`,
  edit: () => 'I changed its words myself',
  partner: () => 'my partner changed its words for me',
  anew: () => 'my partner wrote it anew for me',
};
export function laterTold(later, most = 1200) {
  const said = [];
  for (const w of later || []) {
    /* (a note shown by its opening to fit beside its page says so after it: prompts.js premiseBeside, 2.12.41) */
    const t = (LATER_TOLD[w && w.how] || LATER_TOLD.edit)(cutWords(String((w && w.note) || '').replace(/\s+/g, ' ').trim(), most)) + (w && w.cut ? ' (the rest of it is left out here to save room)' : '');
    /* (the same done twice is said once) */
    if (!said.includes(t)) said.push(t);
  }
  return said.length > 1 ? `${said.slice(0, -1).join('; ')}; then ${said[said.length - 1]}` : said[0] || '';
}
/* WHICH OF HIS WORDS CAME AFTER THE OTHER, A PREMISE OR AN ENTRY (2.12.41, the review — his newest word wins: the two
 * were never weighed by which was newer): said beside each where the other is newer — an entry of his written after a
 * premise for a name it gives, a premise of his typed after an entry for a name it gives (archivist.js premisesWeighed,
 * entriesWeighed) */
const NEWER = ' Where I say that one of my premises and one of my bibliography’s entries came after the other, the newer one stands where the two differ.';
function premiseRule(codex, over = false, newer = false) {
  return `- My premise for a passage, shown beside its words, is my own word on the book and counts as the book: ${PREMISE_HOLDS} — goes in the notes as I gave it, even where the passage leaves it unsaid, and a later premise of mine stands over an earlier one.${over ? ' Where I say beside a premise what I did to its passage since, that is my newer word on it: where the two differ, it stands, and the premise counts only where they agree.' : ''}${newer ? NEWER : ''} What it asks to happen is only what I asked for: what happened is what the passage tells.${codex ? ' The "bibliography" keeps only what a passage’s own words say.' : ''}`;
}
const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
/* (a premise beside an entry of his written after it, for a name the premise gives: `entryOver`, the entries' names) */
const entryOverOf = (x) => (Array.isArray(x && x.entryOver) ? x.entryOver.filter(Boolean) : []);
/* (an entry beside a premise of his typed after it that names it: `premiseOver`, the premises' passages) */
const premiseOverOf = (e) => (Array.isArray(e && e.premiseOver) ? e.premiseOver.filter(Boolean) : []);
/* the words that say so beside an entry, in the list after his entries (entriesPart) — '' for none */
export function entryOverWords(e) {
  const over = premiseOverOf(e);
  return over.length ? `${e.name}: my premise for ${andList(over)}` : '';
}
export const PREMISE_ROOM = 6000;
/* a long one by its opening, said so — beside its page (notesRequest) as in the list (premisesPart): 2.12.40, the audit:
 * beside its page it went whole, and a page of 2,200 words with its premise was refused as too long, its notes never kept */
/* (flat: on one line, for the list; beside its page as he typed it) */
const premiseCut = (text, { flat = false } = {}) => {
  const t = flat ? String(text || '').replace(/\s+/g, ' ').trim() : String(text || '');
  return t.length > PREMISE_ROOM ? `${cutWords(t, PREMISE_ROOM)} (the rest of it is left out here to save room)` : t;
};
/* his premises, the book through (shape.js premisesOf), each by the passage it was typed for — a long one by its opening,
 * said so, and what he did to its passage since beside it; `left`: how many more there are, left out to save room —
 * said even when none of them fits (2.12.40, the audit: nothing said, the check never knew there were any) */
export function premiseRow(x) {
  const later = laterTold(x.later);
  const newer = entryOverOf(x);
  return `[${x.label}] ${premiseCut(x.text, { flat: true })}${later ? ` — since then ${later}, which stands over it where they differ` : ''}${newer.length ? ` — my bibliography’s ${newer.length === 1 ? 'entry' : 'entries'} for ${andList(newer)}, written after it, ${newer.length === 1 ? 'stands' : 'stand'} over it where they differ` : ''}`;
}
export function premisesHead(over = false) {
  return `My premises — what I asked the writer for, as I typed it, each by the passage it was typed for. They are my word on the book and count as the book: ${PREMISE_HOLDS} — stands, even where no passage says it, and a later premise of mine stands over an earlier one;${over ? ' what I say I did to a passage since its premise stands over the premise, which counts only where they agree;' : ''} what one asks to happen is only what I asked for, and what happened is what the passages say:`;
}
/* the line that says how many were left out (`what`: 'premise' | 'entry' | 'turn'), and the words when none fits */
const LEFT_ONE = { premise: 'One more premise is', entry: 'One more entry is', turn: 'One more turn is' };
const LEFT_MANY = { premise: 'more premises are', entry: 'more entries are', turn: 'more turns are' };
export function leftLine(what, left) {
  return left ? `\n(${left === 1 ? LEFT_ONE[what] : `${numberWords(left)} ${LEFT_MANY[what]}`} left out here to save room.)` : '';
}
const NONE_FIT = {
  premise: (n) => (n === 1 ? '(My premise — my word on the book — is left out here to save room.)' : `(My premises — ${numberWords(n).toLowerCase()} of them, my word on the book — are left out here to save room.)`),
  entry: (n) => (n === 1 ? '(My bibliography’s entry for a name here — my word on what it means — is left out here to save room.)' : `(My bibliography’s entries for the names here — ${numberWords(n).toLowerCase()} of them, my word on what each name means — are left out here to save room.)`),
  turn: (n) => (n === 1 ? '(The Timeline’s newest turn for these cards is left out here to save room.)' : `(The Timeline’s newest turns for these cards — ${numberWords(n).toLowerCase()} of them — are left out here to save room.)`),
};
export function premisesPart(list, left = 0) {
  const shown = (list || []).filter((x) => x && String(x.text || '').trim());
  if (!shown.length) return left ? NONE_FIT.premise(left) : '';
  return `${premisesHead(shown.some((x) => (x.later || []).length > 0))}\n${shown.map(premiseRow).join('\n')}${leftLine('premise', left)}`;
}

/* HIS BIBLIOGRAPHY AND THE TIMELINE, HELD WITH THE NOTES (2.12.37 — his report: "each notes like card, Timeline and
 * bibliography must be not contradictory and connected"). The helper read a page and wrote its cards without his
 * entries for the names in it, so a card could say what his entry says the opposite of; the notes' check held the
 * cards to the book alone, never to his entries or to the turns the Timeline keeps. Now his entries for the names a
 * reading or a check touches ride beside them as his word on what each name means, and the check is shown the
 * Timeline's newest turns for the cards it checks. */
/* (an entry longer than PREMISE_ROOM by its opening, said so — 2.12.40, the audit: one long entry, a lorebook's
 * overview, left no room for any other; and when none fits, it is said) */
export function entryRow(e) {
  const t = String(entryWords(e) || '');
  return t.length > PREMISE_ROOM ? `${cutWords(t, PREMISE_ROOM)} (the rest of it is left out here to save room)` : t;
}
export const ENTRIES_HEAD = 'My bibliography’s entries for the names here — my word on what each name means for good:';
export function entriesPart(entries, left = 0) {
  const rows = (entries || []).map(entryRow).filter((t) => String(t || '').trim());
  if (!rows.length) return left ? NONE_FIT.entry(left) : '';
  /* (an entry beside a premise of his typed after it that names it, said after them — never among his words: 2.12.41) */
  const over = (entries || []).map(entryOverWords).filter(Boolean);
  const newer = over.length ? `\n(Where they differ, my premise typed after an entry stands over it — ${over.join('; ')}.)` : '';
  return `${ENTRIES_HEAD}\n${fence(rows.join('\n\n'))}${newer}${leftLine('entry', left)}`;
}
const ENTRY_RULE = '- My bibliography’s entries, shown above, are my word on what each name means for good: a card never says the opposite of them. Where the words read say otherwise of something lasting, keep my entry’s account on the card — that is the page’s slip, not the card’s. What changes over the story (where someone is, how they stand with others, what they know now) is the passage’s.';
/* (2.12.40, the audit: his own words — a page he wrote, or changed himself — were "the page's slip" against his entry;
 * they are his newer word, and the card follows them: said only where the words read are his, so the request is the
 * same as before wherever they are not) */
const ENTRY_RULE_OWN = '- My bibliography’s entries, shown above, are my word on what each name means for good: a card never says the opposite of them. Where the words read say otherwise of something lasting, keep my entry’s account on the card — that is the page’s slip, not the card’s — unless they are my own words, said so above them: those are my newer word, and the card follows them. What changes over the story (where someone is, how they stand with others, what they know now) is the passage’s.';
const OWN_WORDS = 'These are my own words — I wrote or changed them myself.\n';
/* the rule for his entries in a reading: his own words his newer word where there are any (shape.js ownWords), and
 * which of a premise and an entry came after the other, where that is said (NEWER) */
const entryRule = (owned, newer) => `${owned ? ENTRY_RULE_OWN : ENTRY_RULE}${newer ? NEWER : ''}`;
/* the Timeline's newest turns for some cards (timeline.js timelineOf rows), each with the book's words behind it */
export function timelineRow(e) {
  const who = (e.participants || []).map((p) => p.name).filter(Boolean).join(', ');
  const quote = (e.evidence || [])[0] ? ` (“${String(e.evidence[0]).replace(/\s+/g, ' ').trim()}”)` : '';
  const whose = e.stance && e.stance !== 'fact' ? ` — ${e.whoseName ? `${e.whoseName}’s ` : ''}${e.stance}` : '';
  return `[${e.label}] ${who}: ${String(e.text || '').replace(/\s+/g, ' ').trim()}${whose}${quote}`;
}
export const TIMELINE_HEAD = 'The Timeline’s newest turns for these cards, in the book’s order, each with the book’s words behind it:';
export function timelinePart(rows, left = 0) {
  const lines = (rows || []).map(timelineRow);
  if (!lines.length) return left ? NONE_FIT.turn(left) : '';
  return `${TIMELINE_HEAD}\n${lines.join('\n')}${leftLine('turn', left)}`;
}

/* what a turn of the Timeline is (timeline.js continuityOf): said alike in a reading and in a reading for the Timeline alone */
const TIMELINE_EVENT_RULES = `- Each event has "kind": "relationship", "character", or "thread"; "cards" names existing People or Threads cards, including cards added in this answer. A relationship names both people; a character event names that person; a thread event names its thread. Quote the exact supporting words from that source in "evidence". Give only what those words support, briefly, with the cause when the source gives it. Do not restate an unchanged relationship or turn a note correction into a story event.
- "stance" is "fact", "belief", "claim", or "intention". For anything other than fact, also give "whose": the person's name, and include their People card. A thought, boast, suspicion or plan does not establish that what they think or say happened. Affection, trust, knowledge and desire can differ on each side of a relationship: never infer reciprocity.
- Development can deepen jealousy, rivalry, cruelty, dependence or distrust, or leave a conflict unresolved. Keep the person's temperament and the book's actual consequences. Never impose warmth, reconciliation, healing, a preferred arc or a better person. A flashback establishes history at the point the book reveals it; do not move it into the present.`;
/* THE TIMELINE READ FOR ITSELF (2.12.37 — his report: "5 passages have no complete timeline reading yet — Read the whole
 * book again"): a passage read before the Timeline was kept, or whose reading gave no turns for it, read for its turns
 * alone, a few at a time (archivist.js timelineBackfill) — the notes are not asked to change */
export const TIMELINE_ASK = 'Read these passages for the Timeline alone';
export function timelineRequest({ sources, people = [], threads = [] }) {
  const parts = [];
  parts.push(`The notes' cards a turn may name, as the notes name them:\nPeople: ${people.length ? people.join(', ') : '(none yet)'}\nThreads: ${threads.length ? threads.join(', ') : '(none yet)'}`);
  parts.push(sources.map((x) => `${x.source}:\n${fence(x.text)}`).join('\n\n'));
  parts.push(`${TIMELINE_ASK} — the notes stay as they are. Trace the meaningful developments in each passage: a relationship's beginning or change, a lasting personal change, or a thread set up, advanced or resolved. It is the history behind the notes, not another current account. Give one entry for EVERY passage shown, by its source as given, even when "events" is empty. A passage read in part contributes only events in the part shown here.
${TIMELINE_EVENT_RULES.replace(', including cards added in this answer', '')}

Answer with one JSON object and nothing else:
{"timeline": [{"source": "${(sources[0] && sources[0].source) || 'Chapter One, passage 1'}", "events": [{"kind": "relationship", "cards": [{"kind": "people", "name": "…"}, {"kind": "people", "name": "…"}], "text": "what changed", "why": "what caused the change", "evidence": ["an exact quote from this passage"], "stance": "fact"}]}]}`);
  return parts.join('\n\n');
}

/* the notes' rules as one reading is asked them: with the bibliography kept from the book, a lasting detail and a first description go there, with their words, and a person's card stays a short portrait */
function noteRules(codex) {
  return NOTE_RULES.replace('{{ABOUT_RULE}}', codex ? PORTRAIT_RULE : ABOUT_RULE)
    .replace('{{KEPT_WHERE}}', codex ? ' — on its card, or in "bibliography" with its words' : '')
    .replace('{{FIRST_WHERE}}', codex ? ' — in "bibliography", each with the words that say it, while their card says who or what they are in short' : '');
}

/* What the helper keeps for the bibliography as it reads (bibliography.js codexOf): what a name means for good, grounded in the words */
export const BIB_FACTS_RULE = '"bibliography" is the book’s glossary, what each name means for good: the lasting facts these new words establish about a person, place, thing, group or piece of lore (a word of the world, a power, a technique, a rule) — who or what it is, how they look, where they come from, what they can do and how it works, a rank or a title, what a group is and who leads it, what a word means. One short sentence each, as the book has it, with the exact words of that source that say it in "evidence". Not what anyone is doing, feeling or planning now, where they are, or what happened between people — the notes and the timeline keep those. Never a guess, never background these words don’t give. Give one entry for EVERY source shown with new words, even when "facts" is empty. "kind" is "people", "places", "things", "groups" or "lore"; name each as the book does — a card’s name where it has one.';
/* The bibliography filled for pages read before it was kept (archivist.js
 * bibBackfill): what each source establishes, nothing else asked. */
export function bibFactsRequest({ novel, sources, names = [] }) {
  const parts = [];
  if (names.length) parts.push(`The names the notes hold (name each as they do): ${names.join(', ')}.`);
  for (const x of sources) parts.push(`${x.source}:\n${fence(x.text)}`);
  parts.push(`These pages of ${titled(novel)} were read into the notes before the book’s bibliography was kept. For each source above, give what the bibliography keeps from its words. Answer with one JSON object and nothing else:

{
  "bibliography": [{"source": "${sources[0] ? sources[0].source : 'Chapter One, passage 1'}", "facts": [{"name": "…", "kind": "people", "fact": "…", "evidence": "the exact words from this source"}]}]
}

- ${BIB_FACTS_RULE}`);
  return parts.join('\n\n');
}

/* his premise beside the passage it was typed for (2.12.36) — never beside the words being replaced */
const premiseOn = (c) => Boolean(c) && !c.oldOnly && Boolean(String(c.premise || '').trim());
/* the words the cards a reading needs whole are named in: what it reads — with his premise for it, and his notes for
 * writing it again since (2.12.40, the audit: a card only the premise named rode by its first line, while the reading
 * was told to put the premise's world on it). archivist.js readChanges measures the notes by the same words. */
export function readingFocus(c) {
  return `${c.old || ''}\n${c.text || ''}${premiseOn(c) ? `\n${c.premise}${(c.later || []).map((w) => (w && w.note ? `\n${w.note}` : '')).join('')}` : ''}`;
}
/* his premise as it rides beside its page — by its opening when long, as in the list — and what he did to the passage
 * since (2.12.40); '' for words with none, and for words being replaced. archivist.js readChanges sizes the part that
 * carries it by these very words.
 * IN ONE ROOM (2.12.41, the review: each note was cut to 6,000 letters by itself, with no room for them all, and four
 * long ones made a small helper's reading too big for it): `c.besideRoom` words for the premise and his notes since
 * together — the oldest of his words cut first: the premise to its opening (its first PREMISE_LEAST words stay), then
 * his earlier notes, the newest last of all, by its opening; what is left out said. And an entry of his written after
 * the premise for a name it gives, said beside it (`entryOver`). */
const PREMISE_LEAST = 40;
const NOTE_LEAST = 12;
const REST_LEFT = ' (the rest of it is left out here to save room)';
/* the opening of some words, `n` words long ("…" where it is not all of them) */
function openingOf(text, n) {
  const t = String(text || '').trim();
  let k = 0;
  for (const m of t.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    if (++k < n) continue;
    const end = m.index + m[0].length;
    return end < t.length ? `${t.slice(0, end)}…` : t;
  }
  return t;
}
function besideText(premise, later, left, newer) {
  const told = laterTold(later, PREMISE_ROOM);
  /* (with none of them left to tell, what he did to it since is said left out) */
  const gone = !left ? '' : !told ? '(What I did to it since is left out here to save room.)\n' : `(${left === 1 ? 'One earlier change of mine to it is' : `${numberWords(left)} earlier changes of mine to it are`} left out here to save room.)\n`;
  const after = newer.length ? `My bibliography’s ${newer.length === 1 ? 'entry' : 'entries'} for ${andList(newer)} ${newer.length === 1 ? 'was' : 'were'} written after this premise: where they differ, ${newer.length === 1 ? 'the entry stands' : 'the entries stand'}.\n` : '';
  return `My premise for it, as I typed it:\n${fence(premise)}\n${told ? `Since then ${told} — my newer word on this passage: where it and the premise differ, it stands.\n` : ''}${gone}${after}`;
}
export function premiseBeside(c) {
  if (!premiseOn(c)) return '';
  const newer = entryOverOf(c);
  let premise = premiseCut(c.premise);
  let later = (c.later || []).slice();
  let left = 0;
  const room = Number.isFinite(c.besideRoom) ? Math.max(0, c.besideRoom) : Infinity;
  const make = () => besideText(premise, later, left, newer);
  let text = make();
  const over = () => countWords(text) - room;
  if (over() <= 0) return text;
  /* the premise first, to its opening */
  const pw = countWords(premise);
  if (pw > PREMISE_LEAST) { premise = `${openingOf(c.premise, Math.max(PREMISE_LEAST, pw - over() - 12))}${REST_LEFT}`; text = make(); }
  /* then his earlier notes, the oldest first — the newest stays */
  while (over() > 0 && later.length > 1) { later = later.slice(1); left++; text = make(); }
  /* then the newest, by its opening — or, past that, it too */
  if (over() > 0 && later.length === 1) {
    const w = later[0];
    const nw = countWords(w.note);
    if (w.note && nw - over() - 12 >= NOTE_LEAST) { later = [{ ...w, note: openingOf(w.note, nw - over() - 12), cut: true }]; text = make(); }
    if (over() > 0) { later = []; left++; text = make(); }
  }
  return text;
}
export function notesRequest({ novel, chapterLabel, before, changes, removed, removedChapters, at = 0, of = 0, later = true, goesOn = false, notesFit = 0, shortIds = null, plain = false, notesShown = undefined, codex = false, entries = [], entriesLeft = 0 }) {
  const parts = [];
  /* plain: the cards it names could not all ride whole beside it — they ride as the rest do (archivist.js readChanges) */
  const notes = notesShown === undefined ? notesText(novel, { forHelper: true, fit: notesFit, focus: plain ? '' : [before, ...changes.map(readingFocus), ...removed, ...removedChapters].join('\n'), shortIds }) : notesShown;
  parts.push(`The notes as they stand:\n${notes ? notes : '(none yet — this is the start)'}`);
  const about = aboutTheBook(novel, { plans: false, kept: 'his' });
  if (about) parts.push(about);
  /* his entries for the names these words give (2.12.37) */
  const entered = entriesPart(entries, entriesLeft);
  if (entered) parts.push(entered);
  const keeps = keptByHelper(novel);
  if (keeps.includes('about')) parts.push(keptPart(novel, 'about', KEEP_ABOUT));
  if (keeps.includes('style')) parts.push(keptPart(novel, 'style', KEEP_STYLE));
  /* where this part sits: a change to an early chapter never turns back where people are "now" */
  if (at && of && at < of && later) parts.push(`This part is from ${chapterLabel}; the book goes on to Chapter ${numberWords(of)}. Where people are “now” is as of the end of the book, so change a “now” only if this part changes it for good.`);
  else if (goesOn) parts.push(`This part sits in the middle of ${chapterLabel}: the chapter goes on after it, and what follows is already in the notes. Where people are “now” is as of the end of the book, so change a “now” only if this part changes it for good.`);
  if (before && before.trim()) parts.push(`${chapterLabel}, up to the new part (for context — already in the notes):\n${fence(before)}`);
  const premised = changes.some(premiseOn);
  /* what he did to a passage since its premise, beside it: his newer word on it (2.12.40, the audit) */
  const over = changes.some((c) => premiseOn(c) && (c.later || []).length > 0);
  /* his own words among those read, said so — beside his entries only, where it decides which stands (2.12.40) */
  const owned = entries.length > 0 && changes.some((c) => c.his && !c.oldOnly);
  /* which of a premise and an entry came after the other, where it is said beside them (2.12.41): told once */
  const newer = changes.some((c) => premiseOn(c) && entryOverOf(c).length > 0) || entries.some((e) => premiseOverOf(e).length > 0);
  for (const c of changes) {
    const mine = premiseBeside(c);
    const own = owned && c.his ? OWN_WORDS : '';
    if (c.oldOnly) parts.push(`This is part of the previous version of a passage in ${chapterLabel} that is being replaced. These words no longer happen as written; take back only what these words alone established. The replacement follows in later parts of this same reading, so do not guess it or treat the chapter as finished:\n${fence(c.old)}`);
    else if (c.old) parts.push(`${c.source ? `${c.source}\n` : ''}${mine}${own}This part of ${chapterLabel} was changed. It used to read:\n${fence(c.old)}\nIt now reads:\n${fence(c.text)}`);
    else parts.push(`${c.source ? `${c.source}\n` : ''}${mine}${own}New in ${chapterLabel}:\n${fence(c.text)}`);
  }
  for (const r of removed) parts.push(`This part was taken out of ${chapterLabel}, so it no longer happens in the book:\n${fence(r)}`);
  for (const r of removedChapters) parts.push(`A whole chapter was taken out of the book, so none of it happens any more. It held:\n${fence(r)}`);
  const keptFields = [
    keeps.includes('about') ? `,\n  "about": "${KEEP_ABOUT} — the whole of it again, only if this part changes it (or it isn’t written yet)"` : '',
    keeps.includes('style') ? `,\n  "style": "${KEEP_STYLE} — the whole of it again, only if this part changes it (or it isn’t written yet)"` : '',
  ].join('');
  parts.push(`Update the notes for what this changes. Answer with one JSON object and nothing else:

{
  "people": [{"name": "…", "aka": ["other names they go by"], ${peopleFields(codex)}}],
  "places": [{"name": "…", "about": "${PLACE_ASK}"}],
  "lore": [{"name": "…", "about": "${LORE_ASK}"}],
  "threads": [{"name": "…", "about": "${THREAD_ASK}", "open": true}],
  "gone": [{"kind": "people", "name": "…"}],
  "timeline": [{"source": "the source beside the new words", "events": [{"kind": "relationship", "cards": [{"kind": "people", "name": "…"}, {"kind": "people", "name": "…"}], "text": "what changed", "why": "what caused the change", "evidence": ["an exact quote from this source"], "stance": "fact"}]}],${codex ? `
  "bibliography": [{"source": "the source beside the new words", "facts": [{"name": "…", "kind": "people", "fact": "…", "evidence": "the exact words from this source"}]}],` : ''}
  "chapterName": "a short name for ${chapterLabel}, only if it has none yet"${keptFields}
}

${noteRules(codex)}${premised ? `\n${premiseRule(codex, over, newer)}` : ''}${entries.length ? `\n${entryRule(owned, newer && !premised)}` : ''}
- "timeline" traces meaningful developments in these new words: a relationship's beginning or change, a lasting personal change, or a thread set up, advanced or resolved. It is the history behind the notes, not another current account. Give one entry for EVERY source shown with new words, even when "events" is empty. Never extract events from the old words, context, or passages taken out. A passage read in parts contributes only events in the part shown here.
${TIMELINE_EVENT_RULES}${codex ? `
- ${BIB_FACTS_RULE}` : ''}${keeps.length ? `
- ${keeps.length === 2 ? '"about" and "style" describe' : keeps[0] === 'about' ? '"about" describes' : '"style" describes'} the whole book, not this part alone${keeps.includes('style') ? ' — the voice the book has settled into; where this part strays from it (a slip of tense or point of view), keep the book’s settled voice' : ''}.` : ''}`);
  return parts.join('\n\n');
}

/* his own passages, said in the check's rule for his entries: where each stands and how it opens, the first OWN_MOST */
const OWN_MOST = 20;
const ownList = (own) => `${own.slice(0, OWN_MOST).join('; ')}${own.length > OWN_MOST ? `; and ${numberWords(own.length - OWN_MOST).toLowerCase()} more of mine` : ''}`;

/* THE NOTES' AUDITOR (Cozy Tavern's ledger auditor, for a book): the whole
 * notes held against the book as it stands — the versions on the page — so
 * whatever the notes still hold from words since rewritten or taken out, or
 * have drifted on, is put right. His own cards keep his words. */
export const AUDIT_ASK = 'Check every card against the book as it stands';
/* (own: the passages of the book that are his own words — shape.js ownWords — each by where it stands and how it opens,
 * said in the entries' rule: against them his entry gives way, as in a reading — 2.12.41, the review) */
export function auditRequest({ novel, bookText: text, his = [], partial = false, only = null, others = [], endShort = false, codex = false, mine = [], words = [], premises = [], premisesLeft = 0, entries = [], entriesLeft = 0, turns = [], turnsLeft = 0, own = [] }) {
  const parts = [];
  /* (which of a premise and an entry came after the other, where it is said beside them; his own passages, where his entries ride) */
  const newer = premises.some((x) => entryOverOf(x).length > 0) || entries.some((e) => premiseOverOf(e).length > 0);
  const owns = entries.length > 0 && own.length > 0;
  parts.push(`The notes as they stand${only ? ' — the cards to check this time' : ''}:\n${notesText(novel, { forHelper: true, only }) || '(none)'}`);
  if (others.length) parts.push(`The other cards, checked another time — not shown here, and never to be added again or changed now: ${others.join(', ')}.`);
  const about = aboutTheBook(novel, { plans: false, kept: 'his' });
  if (about) parts.push(about);
  /* what it keeps of the book (Automatic), held against the book too (S10-G1) */
  const keeps = only ? [] : keptByHelper(novel).filter((k) => String(((novel.kept || {})[k] || {}).text || '').trim());
  for (const k of keeps) parts.push(keptPart(novel, k, k === 'about' ? KEEP_ABOUT : KEEP_STYLE));
  parts.push(`The book as it stands now — only what these words say happens. Anything the notes hold from words that have since been rewritten or taken out no longer happens:\n\n${text || '(nothing written yet)'}`);
  /* his premises, his word on the book (2.12.36) */
  const premised = premisesPart(premises, premisesLeft);
  if (premised) parts.push(premised);
  /* his entries for the cards checked, and the Timeline's newest turns for them (2.12.37) */
  const entered = entriesPart(entries, entriesLeft);
  if (entered) parts.push(entered);
  const turned = timelinePart(turns, turnsLeft);
  if (turned) parts.push(turned);
  const one = his.length === 1;
  parts.push(`${AUDIT_ASK}, the way an editor checks a continuity bible:
- A fact, a line someone said, a name, an event or a secret no passage says any more (it came from words since rewritten or taken out): correct the card to what the book says now, or take the card out with "gone" when nothing of it is in the book.
- A detail that differs from the book — a name, a look, an age, who said what, who knows what: put it right.
- Where each person is "now", as of the end of the book — a flashback, a dream, a memory, a letter, or being only talked about or thought of, puts no one anywhere; and what someone says, believes, fears or plans is theirs, never what happened, until the book shows it.${endShort ? ' (The end of the book is given here only in short, so where someone is now can’t be told from it: give a "now" only for someone who has none.)' : ''}
- A thread the book has resolved — by what happens after it was set up, never by the words that set it up: "open": false. One it opened that the notes miss: add it.
- Whose and who: whose thing it is, who did a deed, who said a line — held against the passages in their order.
- Someone or something that matters and is missing: add it, described as the book first describes them.
${premises.length ? `- My premises count as the book, and their words as the book’s own wherever its words are to be quoted: what one says holds true for good stays on its card — never taken out or changed because no passage says it, or because a passage says otherwise; a card that lacks it gets it. What a premise only asks to happen is not the book until a passage tells it.${premises.some((x) => (x.later || []).length > 0) ? ' A premise beside which I say what I did to its passage since is not the book where the two differ: what I changed is my newer word, and the passage as it stands now is the book.' : ''}${newer ? NEWER : ''}
` : ''}${entries.length ? `- A card never says the opposite of my bibliography’s entry for its name: where it does, put the card right to my entry, my word on what the name means for good — and where a passage says otherwise, name the passage in "verdict" as the page’s slip${owns ? ` — unless the passage is my own words (${ownList(own)}): those are my newer word, and the card follows them` : ''}. What changes over the story (where someone is now, how they stand, what they know) is the book’s.${newer && !premises.length ? NEWER : ''}
` : ''}${turns.length ? `- How someone stands with the others ("ties") and where a thread stands agree with the newest turns the Timeline keeps for them — put a card right that says otherwise, unless a later passage of the book says more.
` : ''}${keeps.length ? `- ${keeps.length === 2 ? 'What you keep of the book (what it’s about, how it reads)' : keeps[0] === 'about' ? 'What you keep of what the book is about' : 'What you keep of how the book reads'}: where it has drifted from the book as it stands, give ${keeps.length === 2 ? '"about" or "style"' : `"${keeps[0]}"`} whole again, put right.
` : ''}- Cards that say the same thing: each fact belongs on one card — the person it is about, or the thing, place or thread itself. Where several cards repeat it (a limit, a rule, a name kept back, a secret), keep it on the card it belongs to and take it off the others, giving each of them whole without it. Two cards for one person, place or thing become one: give the one to keep whole, with whatever the other held that it lacks (for a person, the other's names among the others they go by), and put the other in "gone". Nothing true is lost in the folding.
- A name a person is noted as going by that isn't theirs (it is someone else's, or a slip): give their "aka" whole without it. Leave "aka" out wherever their names are right.${codex ? `
- A person's "about" grown past a short portrait — into a record of what they did, scene by scene: give it whole again as a short portrait of who they are for good. The book's bibliography keeps their lasting details with the words that say them, and the chapters keep what they did; a portrait that leaves out what neither keeps is not taken.` : ''}${his.length ? `
- ${his.join(', ')} — ${one ? 'this card is' : 'these cards are'} mine, written or changed by me: never change what I wrote about ${one ? 'it' : 'them'}, never take ${one ? 'it' : 'them'} out; only "now" and "ties" may move, and what the book has told since my words (shown as "Since then") may be put right — give that in "about", never repeating mine. Where another card repeats what ${one ? 'it says' : 'one of mine says'}, the other card gives way. Unless the book as it stands says the opposite of what I wrote — not merely more; not someone's lie, joke or mistaken belief: then I changed the book after I wrote the card, and the book is my newer word. Give that card's "about" whole as the book has it now, with "contradicts": the book's own words that say so, quoted exactly; a card of mine about a thing the book no longer has at all goes in "gone" the same way, with "contradicts".` : ''}${partial ? `
- Some chapters are given here in short, or left out to save room: a detail a chapter in short leaves out may still be in the book. Change or take out only what the words here contradict — never what they merely leave unsaid. A chapter in short is a telling of it, not its words: against one, change a card only for what it plainly says happened — never for who said a line, a look, or a small detail it may have got wrong.` : ''}

${mine.length ? `${mineAsk(mine)}

` : ''}${words.length ? `${wordsAsk(words)}

` : ''}Answer with one JSON object and nothing else — only the cards that need a change, each field you give whole, each with "why": what was wrong, in a few plain words:

{
  "people": [{"name": "…", "aka": ["every other name they go by"], ${peopleFields(codex)}, "why": "…"}],${words.length && !mine.length ? `
  "mine": [{"kind": "${words[0].what}", "name": "${words[0].name}", "holds": true}],` : ''}${mine.length ? `
  "mine": [{"kind": "${mine[0].kind}", "name": "${String(mine[0].name).replace(/"/g, '\\"')}", "holds": false, "contradicts": "the book’s words", "about": "…", "why": "…"}],` : ''}
  "places": [{"name": "…", "about": "…", "why": "…"}],
  "lore": [{"name": "…", "about": "…", "why": "…"}],
  "threads": [{"name": "…", "about": "…", "open": true, "why": "…"}],
  "gone": [{"kind": "lore", "name": "…", "why": "…"}],
  "clear": true,
  "verdict": "${VERDICT_ASK} — and anything they can't settle because the book disagrees with itself"
}

"clear" is false only when something is left for me to look at. When every card checks out, answer only {"clear": true, "verdict": "…"}. Write only what the book actually says — never invent, never guess.`);
  return parts.join('\n\n');
}

/* HIS CARDS, JUDGED AGAINST THE BOOK (archivist mineToJudge, foldNotes
 * `mine`): asked by name, every one answered — never an optional field the
 * check may leave out (2.12.12: it left one out, and his old words stood
 * beside the book's account that says the opposite) */
function mineAsk(mine) {
  const names = mine.map((x) => `${x.name} (${x.kind})`).join(', ');
  return `Cards to judge against the book — mine (in my words or my partner's, some with "Since then" beside them: what the book told after they were written), and every thread, whoever wrote it: ${names}. Judge each one, and answer in "mine" for every one of them:
- {"kind": "…", "name": "…", "holds": true} when the book bears it out, or has not come to it yet — what is told since only adds to my words, or tells the same. Where my words hold but "Since then" says what the book no longer does, add "since": what of it the book still says ("" for nothing) — nothing new.
- A thread is what the book sets up — nothing the notes or anyone added from nowhere. It holds only when all of it does: its name (what storyline it is), its words, and whether it is open or closed — {"kind": "threads", "name": "…", "holds": true, "evidence": "the book’s own words that set it up, quoted exactly"}.
- A thread partly told from nowhere — a cause, a person, a place, a "why" the book never gives — or closed though the book leaves it unresolved (open though resolved): {"kind": "threads", "name": "…", "holds": false, "evidence": "the book’s own words that set it up, quoted exactly", "about": "the thread’s own words with what the book never gives taken out — nothing new added", "open": true, "why": "what was not in the book"}.
- A thread no words of the book set up at all: {"kind": "threads", "name": "…", "never": true, "why": "…"} — it goes.
- A thread the book has overturned — its name or words say what did not happen in the book as it stands: {"kind": "threads", "name": "…", "holds": false, "contradicts": "the book’s own words that say otherwise, quoted exactly", "why": "…"} — it goes. Never write a new storyline in its place: what the book sets up now is read from its pages as they are read.
- {"kind": "…", "name": "…", "holds": false, "contradicts": "the book’s own words that say otherwise, quoted exactly", "about": "the card as the book has it now, whole", "why": "…"} when the book now says the opposite of my words — not merely more; not someone’s lie, joke or mistaken belief; not a secret the book has yet to reveal. I changed the book after I wrote the card: the book is my newer word.
- The same with "gone": true in place of "about" when nothing of what the card is about is in the book any more (a thing or a place the book no longer has).`;
}

/* HIS OTHER WORDS THE WRITER READS AS TRUE, judged (archivist wordsToJudge) */
function wordsAsk(words) {
  /* (each shown whole — it is to be given back whole: 2.12.18) */
  const shown = words.map((w) => `${w.what === 'book' ? `"book" "${w.name}" — ${w.label}` : w.what === 'plan' ? `"plan" "${w.name}" — ${w.label}` : `"entry" "${w.name}" — my bibliography’s entry`}:\n${fence(w.text)}`).join('\n\n');
  return `My own words the writer reads as true on every page — judge each against the book as it stands, and answer in "mine" for every one of them, by its kind and name as given:

${shown}

- {"kind": "book", "name": "about", "holds": true} when the book bears them out, or has not come to them yet — an entry may tell what no page has said, and a plan is for pages not written.
- {"kind": "…", "name": "…", "holds": false, "contradicts": "the book’s own words that say otherwise, quoted exactly", "text": "my words given whole again as the book has them now — everything the book has not overturned kept as I wrote it", "why": "…"} only where the book now says the opposite — not someone’s lie or mistaken belief, not a secret yet to come out. For a chapter’s plan with nothing of it left, "text": "".`;
}

/* Written whole, for a book set to Automatic (when it has none yet, or he
 * asked for it again from the book): from the book itself, its notes and his
 * words. */
export function keepRequest({ novel, keeps, bookText: text, notesFit = 0, premises = [], premisesLeft = 0 }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit });
  if (notes) parts.push(`The notes as they stand:\n${notes}`);
  const about = aboutTheBook(novel, { plans: false, kept: 'his' });
  if (about) parts.push(`My own words (they stand as they are — never repeat them; keep only what they don’t say):\n\n${about}`);
  parts.push(`The book as it stands:\n\n${text || '(nothing written yet)'}`);
  /* his premises, his word on the book (2.12.36): what it is about holds them */
  const premised = premisesPart(premises, premisesLeft);
  if (premised) parts.push(premised);
  const fields = [
    keeps.includes('about') ? `"about": "${KEEP_ABOUT}"` : '',
    keeps.includes('style') ? `"style": "${KEEP_STYLE} — the voice it has settled into"` : '',
  ].filter(Boolean).join(', ');
  parts.push(`Write ${keeps.length === 2 ? 'both' : 'it'}, for the writer to read before every page: a few plain paragraphs at most, from what the book actually says — never invented. Answer with one JSON object and nothing else: {${fields}}`);
  return parts.join('\n\n');
}

/* WHAT A SUMMARY KEEPS — Summaryception's hard-won list (Cozy Tavern's
 * memory keeper, M34), said once for a chapter and a stretch alike, in a
 * novelist's words: causes kept with what they led to; how a thing was done,
 * never flattened (a grudging yes stays grudging, a quarrel left open stays
 * open — what rides in place of a chapter must not soften it); everyone who
 * acts by name; what two people are to each other and what moved it; what
 * someone says of themselves; the small particulars that belong to people;
 * first appearances described; who learns what; claims kept as claims; a
 * belief shown false said so; the exact words that will matter; place, time
 * and figures as given. And what to cut when it runs long: never these. */
function summaryKeeps(unit, known, { closing = false, last = false } = {}) {
  const rows = [
    'what happens, in order, and why — keep each cause with what it led to',
    `how it is done, where the ${unit} marks it — reluctantly, coldly, on impulse, against someone’s own will — never smoothed into a plain act: a grudging yes stays grudging, a forgiveness with conditions keeps them, a quarrel left open is said to be open`,
    `who's in it and what changes for them, inside and out — each person who acts or speaks to the point by name, never folded into “the others”; where what two people are to each other shifts, the moment that shifted it`,
    `anyone or anything appearing in the book for the first time, with how they're described${known.length ? ` (already known from earlier: ${known.join(', ')})` : ''}`,
    'what someone says of themselves — what they want, a line they won’t cross, what they can do, how they know what they know — and one person’s sharp read of another',
    `the small things that belong to a person or between two people — a habit, a ritual, a private joke, a telling gesture — where the ${unit} gives one`,
    'who learns what — and who doesn\'t',
    `what is only claimed, believed, imagined or planned, and by whom — never turn it into an established event; mark flashbacks and dreams${closing ? ', keeping the chapter’s actual closing situation clear' : ''}; where something believed before turns out false, or has changed, say so plainly`,
    'anything set up for later — a promise, a secret, an object, a question left open — with the exact words, as a short quote, of any promise, oath or threat that will matter or a line someone will be held to or throw back, and both wordings where a line is misquoted or disputed',
    `where it happens, and the day, date or time where the ${unit} gives one`,
    `numbers, ages, amounts and distances exactly as the ${unit} gives them`,
    ...(last ? ['where everyone stands at its last line'] : []),
  ];
  return rows.map((r, i) => `- ${r}${i === rows.length - 1 ? '.' : ';'}`).join('\n');
}
function summaryClose(unit, size) {
  return `Use names rather than "he" or "she" wherever it could be unclear. Nothing invented, nothing softened. Plain prose, about ${size} words — longer when the ${unit} is dense: nothing that matters left out to keep it short. When it runs long, cut weather, atmosphere, reactions that change nothing and joining words — never a person, a cause, how a thing was done, a promise, a first description or a figure. Before you answer, read it against the words above: every figure as they give it — one they never give has no place in it — every cause with what it led to, nothing they do not say.`;
}

/* How long a summary runs: about a twelfth of its chapter (a stretch, an
 * eighth of its ~2,500 words), at most 1,200 — the same measure for every
 * length, with no step where a chapter of 10,001 words got almost twice the
 * summary of one of 9,999. */
export const SUMMARY_MOST = 1200;
export function summarySize(words) { return Math.max(120, Math.min(SUMMARY_MOST, Math.round((Number(words) || 0) / 12))); }
export function stretchSize(words) { return Math.max(150, Math.min(700, Math.round((Number(words) || 0) / 8))); }

/* A chapter summed up — whole, or (too long for the helper's model) in parts,
 * each part's summary carried into the next. */
export function summaryRequest({ novel, chapterLabel, text, needsName, words, part = 0, parts = 0, soFar = '', known = [], his = '', stretched = false, tail = '' }) {
  /* a long chapter keeps a longer summary: it stands in for the chapter when the book is longer than a model holds */
  const size = summarySize(words);
  const lines = [];
  if (stretched) {
    lines.push(`${chapterLabel} of ${titled(novel)} is a long chapter, kept in stretches. Here is every stretch of it, in order, summed up${tail ? ', and then its newest words as they stand' : ''}:`);
  } else if (part) {
    lines.push(`Here's part ${part} of ${parts} of ${chapterLabel} of ${titled(novel)}:`);
    if (soFar) lines.push(`The summary of the parts before it:\n${fence(soFar)}`);
  } else lines.push(`Here's ${chapterLabel} of ${titled(novel)}:`);
  lines.push(fence(text));
  if (stretched && String(tail).trim()) lines.push(`Its newest words, after the last stretch:\n${fence(tail)}`);
  lines.push(`Summarise ${stretched ? 'the whole chapter from them' : part ? `the chapter so far — ${soFar ? 'the summary above and this part together' : 'this part'} —` : 'it'} for the book's notes, so the writer can carry on from it without the chapter itself:
${summaryKeeps('chapter', known, { closing: true })}
${his ? `\nMy own summary of this chapter, from before its latest changes — my words are right wherever the chapter still says what they say, so keep them there:\n${fence(his)}\n` : ''}${summaryClose('chapter', size)}${needsName ? ' The chapter has no name yet, so give it a short one.' : ''}`);
  lines.push(`Answer with one JSON object and nothing else: {"summary": "…"${needsName ? ', "name": "…"' : ''}}`);
  return lines.join('\n\n');
}

/* A stretch of a long chapter (stretches.js), summed up on its own — what
 * rides for it when the chapter does not fit word for word. The summary of
 * the stretch before it comes along, so it picks up where that one ends. */
export function stretchRequest({ novel, chapterLabel, text, words, before = '', known = [], part = 0, parts = 0, soFar = '' }) {
  const size = stretchSize(words);
  return [
    `Here's a stretch of ${chapterLabel} of ${titled(novel)}. It's a long chapter, so it is kept in stretches like this one, and the writer carries on from their summaries where the chapter is too long to read whole.${part ? ` This stretch is long too, so it comes in ${parts} parts — this is part ${part}.` : ''}`,
    before ? `The stretch before this one, in short:\n${fence(before)}` : '',
    soFar ? `This stretch's parts before this one, in short:\n${fence(soFar)}` : '',
    fence(text),
    `Sum up ${part ? `this stretch so far — ${soFar ? 'the summary of its parts before and this part together' : 'this part'} —` : 'this stretch alone'} for the book's notes, picking up where the one before it ends:
${summaryKeeps('stretch', known, { last: true })}
${summaryClose('stretch', size)}`,
    'Answer with one JSON object and nothing else: {"summary": "…"}',
  ].filter(Boolean).join('\n\n');
}

/* A stretch of a long scene (stretches.js scenePlan), summed up on its own:
 * what the narrator reads in place of the scene's earliest turns once the
 * scene is longer than it holds (talk.js turnsFor) — the same list as a
 * chapter's, and his character's part told as he played it. */
export function sceneStretchRequest({ novel, chapterLabel, who, text, words, before = '', known = [], part = 0, parts = 0, soFar = '' }) {
  const size = stretchSize(words);
  const me = String(who || 'my character');
  return [
    `Here's a stretch of a scene played from ${chapterLabel} of ${titled(novel)} — I play ${me}, and the narrator tells everyone and everything else. It's a long scene, so it is kept in stretches like this one, and the narrator carries on from their summaries where the scene is too long to read whole.${part ? ` This stretch is long too, so it comes in ${parts} parts — this is part ${part}.` : ''}`,
    before ? `The stretch before this one, in short:\n${fence(before)}` : '',
    soFar ? `This stretch's parts before this one, in short:\n${fence(soFar)}` : '',
    fence(text),
    `Sum up ${part ? `this stretch of the scene so far — ${soFar ? 'the summary of its parts before and this part together' : 'this part'} —` : 'this stretch of the scene alone'}, picking up where the one before it ends:
${summaryKeeps('stretch', known, { last: true })}
What ${me} says and does is told as I played it — never more of ${me}'s thoughts or choices than I gave.
${summaryClose('stretch', size)}`,
    'Answer with one JSON object and nothing else: {"summary": "…"}',
  ].filter(Boolean).join('\n\n');
}

/* THE SUMMARY CHECK (Cozy Tavern's continuous audit and its keeper's detail
 * check, for a book): a summary held once against the words it stands for.
 * What it answers is taken only where the words prove it (summarycheck.js). */
export function summaryCheckRequest({ novel, what, source, summary, part = 0, parts = 0, scene = false }) {
  return [
    `Here's ${what} of ${titled(novel)}:${part ? ` it is long, so it comes in ${parts} parts — this is part ${part}. Say only what this part shows, and never call wrong or missing what the summary tells of the parts you are not shown.` : ''}`,
    fence(source),
    `Its summary, as it stands — ${scene ? 'it is what the narrator reads in place of these turns once the scene is longer than it can read' : 'it is what the writer reads in place of these words once the book is longer than it can read'}:\n${fence(summary)}`,
    `Check the summary against the words above, the way a careful editor checks a précis before it goes to print:
- a fact it gets wrong: a name, a number, an age, a time, a place, who did or said what, who knows what, how something ended — or a softening: a grudging yes made a plain yes, a quarrel left open said to be settled, a hurt made milder than it is, a cost left out of what it cost;
- something it leaves out that a writer carrying the book on would need and could not work out from the rest: a promise, an oath or a threat, a secret and who learned it, someone appearing for the first time and how they are described, a figure, what changed between two people and why, what someone says of themselves — never weather or atmosphere, never what it already says in other words.
Answer with one JSON object and nothing else:
{"wrong": [{"summary": "the fewest words of the summary that are wrong, copied exactly as they stand in it", "words": "what belongs there instead, copied exactly as the words above give it"}], "missing": [{"after": "the words of the summary it belongs after, copied exactly", "add": "one plain sentence to add, as the summary would say it", "words": "the words above it rests on, copied exactly"}]}
Each list stays empty when there is nothing for it — {"wrong": [], "missing": []} when the summary stands. Never call wrong what only says the same thing in other words.`,
  ].join('\n\n');
}

/* A summary that left out a name or a figure its words hold, or gives a
 * figure they never give (Cozy Tavern M111, M208, and its detail check: a
 * wrong fact is not a missing one), asked once more with each one where it
 * stands: in the summary's own sentences, never a list of words. */
export function summaryAgainRequest({ novel, chapterLabel, summary, missing, stretch = false }) {
  const unit = stretch ? 'stretch' : 'chapter';
  const gone = (missing || []).filter((m) => m.kind !== 'wrong');
  const wrong = (missing || []).filter((m) => m.kind === 'wrong');
  const lines = gone.map((m) => `- ${m.kind === 'name' ? 'the name' : 'the figure'} ${m.token}${m.where ? ` — the ${unit} has: “…${m.where}…”` : ''}`);
  const parts = [`Here's the summary of ${stretch ? `a stretch of ${chapterLabel}` : chapterLabel} of ${titled(novel)} as it stands:\n${fence(summary)}`];
  if (lines.length) parts.push(`These stand in the ${unit} and nowhere in the summary:\n${lines.join('\n')}`);
  if (wrong.length) parts.push(`These figures stand in the summary and nowhere in the ${unit}:\n${wrong.map((m) => `- ${m.token}`).join('\n')}`);
  const asWritten = `in the summary's own sentences, never as a list of words`;
  if (!wrong.length) parts.push(`Write the summary again with every one of them a writer carrying the book on would need — who each one is, what each figure counts and why it matters — ${asWritten}. Leave out any that is not a person, a place or a figure that matters, and keep everything the summary already holds.`);
  else if (!lines.length) parts.push(`Write the summary again with each of those figures put as the ${unit} gives it — or left out, where the ${unit} gives none — and keep everything else the summary already holds.`);
  else parts.push(`Write the summary again with every one it left out that a writer carrying the book on would need — who each one is, what each figure counts and why it matters — ${asWritten}, leaving out any that is not a person, a place or a figure that matters; put each figure the ${unit} never gives as the ${unit} gives it, or leave it out where the ${unit} gives none; and keep everything else the summary already holds.`);
  parts.push('Answer with one JSON object and nothing else: {"summary": "…"}');
  return parts.join('\n\n');
}

export const JSON_AGAIN = 'That answer could not be read as JSON. Answer again with only the JSON object — no other words, no code fence.';
export const JSON_CUT = 'That answer was cut off before it finished. Answer again with only the JSON object, complete — shorter where you can — with no other words and no code fence.';

/* ------------------------------------------------------------ Quick add */
/* QUICK ADD (2.12.37 — his ask: "add world info, anything maybe not in the premise or the book yet, to the
 * bibliography quickly, and prevent errors: check whether what I asked is possible and not contradictory"): his words
 * for the world, held against the pages, his premises, his entries and the notes before anything goes in (quickadd.js).
 * Asked of his partner's connection as the partner sees the book (context.js assemble, purpose 'partner', no changes
 * block): the passages that name what he adds, his premises and his entries for those names ride with it whole. What
 * it quotes is looked up in code — a contradiction is said only where its words stand. */
export const QUICK_ASK = 'Hold my words against the book as it stands';
export function quickAddRequest({ words, earlier = [], premises = [], premisesLeft = 0, entries = [], entriesLeft = 0, passages = [], passagesLeft = 0 }) {
  const parts = [`Quick add — what I want in our world, to go into my bibliography now:\n${fence(words)}`];
  const before = (earlier || []).map((r) => {
    const said = [`I said: “${String(r.said || '').replace(/\s+/g, ' ').trim()}”`];
    /* (its own verdict, or — where the look-ups parted from it — the app's account of what came of it, 2.12.40) */
    if (r.verdict) said.push(`${r.verdictBy === 'app' ? 'What came of it' : 'You found'}: ${String(r.verdict).replace(/\s+/g, ' ').trim()}`);
    if ((r.added || []).length) said.push(`Into the bibliography: ${r.added.map((a) => a.name).join(', ')}${r.added.some((a) => a.status === 'undone') ? ' (I took some back out)' : ''}.`);
    /* (what was held back, so asking again asks with it — 2.12.40, the review) */
    const held = [...(r.refused || []).filter((x) => x && x.held).map((x) => x.name), ...(r.held || [])];
    if (held.length) said.push(`Held back, as resting on what a page says otherwise: ${held.join(', ')}.`);
    /* (the pages he said his word stands over, said as that — 2.12.41, the review) */
    const against = (r.conflicts || []).filter((c) => !c.overruled);
    const over = (r.conflicts || []).filter((c) => c.overruled);
    if (against.length) said.push(`Against the pages: ${against.map((c) => `“${c.mine}” — ${c.label} says “${c.against}”`).join('; ')}.`);
    if (over.length) said.push(`My word stands over the pages: ${over.map((c) => `“${c.mine}” — ${c.label} says “${c.against}”`).join('; ')}.`);
    if ((r.cannot || []).length) said.push(`Could not be: ${r.cannot.map((c) => `“${c.mine}” — ${c.why || c.rule}`).join('; ')}.`);
    if ((r.questions || []).length) said.push(`You asked: ${r.questions.join(' ')}`);
    return `- ${said.join(' ')}`;
  });
  if (before.length) parts.push(`Earlier in Quick add — what I say now may answer it:\n${before.join('\n')}`);
  const premised = premisesPart(premises, premisesLeft);
  if (premised) parts.push(premised);
  const entered = entriesPart(entries, entriesLeft);
  if (entered) parts.push(entered);
  if ((passages || []).length) {
    const gone = passagesLeft ? `\n(${passagesLeft === 1 ? 'One more passage names them' : `${numberWords(passagesLeft)} more passages name them`} — left out here to save room.)` : '';
    parts.push(`The passages of the book that name what I am adding, whole, as they stand now:\n\n${passages.map((x) => `[${x.label}]\n${fence(x.text)}`).join('\n\n')}${gone}`);
  }
  parts.push(`${QUICK_ASK}, my premises, my bibliography, the notes and what the book is about, the way an editor checks a series bible — before anything of it goes in:
- "conflicts": where my words say the opposite of what a page of the book says — my words that clash ("mine"), the page’s words they contradict, copied exactly ("against"), where they stand ("where", as "Chapter One, Passage 3"), and why, in a line.
- "changes": where my words change what my own earlier words say — a premise, an entry, a card of the notes, what the book is about — and no page says otherwise: that is my newer word, and it goes in. Say each, with my earlier words copied exactly ("was") and where they stand; where they stand in an entry of mine, or in what the book is about, how it reads or where it’s headed, also those words written again to say what my newer word says ("now"), to go in their place — the rest of my words around them stays as it is.
- "cannot": where my words cannot be, by the rules of the world as the book, my premises or my entries set them — a power and its limits, a count, how rare something is, who is where and when: my words ("mine"), the rule’s words copied exactly ("rule"), where they stand, and why.
- "questions": what my words leave open that the world needs me to decide — a line each, three at most.
- "entries": for all of mine that holds, each name it gives meaning to — a person, a place, a thing, a group, a piece of lore (a rule of the world, a power and what it costs, a word of the world) — its own entry, written the way a good series bible writes it: my meaning exactly, in clear, finished sentences, the grammar, spelling and wording put right, and a name the book or my bibliography already has spelled as it spells it — never my words pasted as I typed them. A new one is written whole ("text"). For an entry already in my bibliography, give only what my words add to it ("add": finished sentences, each saying something it does not say yet — never one of its sentences again, in any words), with what my words change in it said under "changes" — every sentence of it stands as I wrote it, so never give it whole again. Only what I said and what plainly follows from it — nothing invented beyond it, nothing from "conflicts" or "cannot". Where I said earlier in Quick add that my words stand over a page, they go in: that page is still named in "conflicts", marked "overruled": true.
- "verdict": a few plain sentences for me — what goes in, and what waits for my word and why.

Answer with one JSON object and nothing else:
{"verdict": "…", "conflicts": [{"mine": "…", "against": "…", "where": "…", "why": "…"}], "changes": [{"mine": "…", "was": "…", "now": "…", "where": "…", "why": "…"}], "cannot": [{"mine": "…", "rule": "…", "where": "…", "why": "…"}], "questions": ["…"], "entries": [{"name": "…", "aka": ["…"], "kind": "people, places, things, groups or lore", "line": "who or what it is, in a line", "text": "a new entry, whole", "add": "for an entry already mine: only what my words add to it"}]}`);
  return parts.join('\n\n');
}

/* WHERE THE LOOK-UPS PART FROM ITS ANSWER (2.12.40, the audit — quickadd.js toSetRight): what goes in rests on where
 * the words it quoted stand, never on how it sorted them — so it is asked once more, in the same conversation, with the
 * rows as they stand, for the entries again: a change a page says otherwise waits; words that stand only in his own
 * earlier words are his newer word and go in; words quoted from nowhere hold his back no longer, unless it quotes a
 * page exactly; his What it's about written again where it gave no words for it. */
/* (where his own words stand, said in his voice: the rows' labels are said to him on the screen — "your entry Emilia" —
 * and went back to his partner as its own; 2.12.40, the review) */
const hisLabel = (label) => String(label || '').replace(/^your\b/, 'my');
const quoted = (rows, side) => rows.map((c) => `- “${c.mine}” — ${hisLabel(c.label)} says “${c[side]}”`).join('\n');
/* (`rewrite`: his own words a newer word of his changes with no words given for it — what the book is about, how it
 * reads or where it's headed, and an entry of his whose change nothing written carries: asked for those words written
 * again, "now" — 2.12.41, the review: an entry's change with none was left saying what his newer word changes) */
export function quickAgainRequest({ conflicts = [], changes = [], aside = [], rewrite = [] }) {
  const parts = ['I looked up the words you quoted, and some of it stands otherwise than you put it.'];
  if (conflicts.length) parts.push(`These stand on a page of the book, so they wait for my word — nothing of them goes in yet:\n${quoted(conflicts, 'against')}`);
  if (changes.length) parts.push(`These stand only in my own earlier words, and no page says otherwise — they are my newer word, and they go in:\n${quoted(changes, 'was')}`);
  if (aside.length) parts.push(`The words you quoted for these stand nowhere in the book or in my own words, so they hold mine back no longer — unless a page does say otherwise; then copy that page’s words exactly into "conflicts":\n${aside.map((c) => `- “${c.mine}” — you quoted “${c.quote}”`).join('\n')}`);
  if (rewrite.length) parts.push(`These change words of mine that you gave no new words for — write those earlier words again to say what my newer word says ("now"), to go in their place, the rest of my words around them as they stand:\n${quoted(rewrite, 'was')}`);
  const shape = [
    '"entries": [{"name": "…", "aka": ["…"], "kind": "people, places, things, groups or lore", "line": "who or what it is, in a line", "text": "a new entry, whole", "add": "for an entry already mine: only what my words add to it"}]',
    ...(aside.length ? ['"conflicts": [{"mine": "…", "against": "…", "where": "…", "why": "…"}]'] : []),
    ...(rewrite.length ? ['"changes": [{"was": "…", "now": "…"}]'] : []),
  ];
  parts.push(`Write the entries again for all of mine that holds now, as before — a new one whole, the way a good series bible writes it, never my words pasted; for an entry already in my bibliography only what my words add to it ("add"), every sentence of it standing as I wrote it. Answer with one JSON object and nothing else:\n{${shape.join(', ')}}`);
  return parts.join('\n\n');
}

/* ---------------------------------------------------- his own instructions */

export function withHis(own, frame) {
  return [String(own || ''), frame].filter((text) => String(text || '').trim()).join('\n\n');
}
