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

import { LENGTHS, soundOf } from './shape.js';
import { numberWords, estimateTokens } from '../util.js';
import { foldedText, nameInText } from './names.js';

/* ------------------------------------------------- the starting words */
/* What the boxes in Settings → Your instructions start with, and what
 * "Back to the default" puts back. They are his words to change: who the
 * writer is (the role he asked for — a master novelist) is said here, in
 * his box, never in the app's own words. The craft itself rides after the
 * box as a module (modules.js). */

export const DEFAULT_WRITING = `You are a master novelist at the height of your powers — the kind whose books sit at the top of the New York Times bestseller list because nobody can put them down. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too — as an unbiased eye on a world that runs by its own logic.`;

/* his preset's own opening (Cozy Tavern's craft) */
export const DEFAULT_NARRATOR = 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.';

/* What the two boxes started with before 2.3. A box that still holds them
 * exactly was never touched: it gets today's starting words when the app
 * starts (app.js). A box he wrote in keeps his words. */
const STARTING_BEFORE = {
  system: [`You write fiction the way good published novels read: concrete, sensory detail; real feeling under the surface; dialogue that sounds like people actually talking; a pace that gives quiet moments room to breathe and lets big moments land.

Stay true to the characters and to everything already written — never contradict it. Show rather than summarise. Don't rush to wrap things up, don't end on a neat moral, and don't reach for a cliffhanger unless the story calls for one. Avoid stock phrases and repeating yourself.`],
  narrator: [`You tell the scene the way the book itself is told — its voice, its point of view, its tense — a few paragraphs at a time: the place, the weather of the moment, the other people and what they say and do, what happens next.

The people in it have their own minds. They want things, they push back, they lie, they surprise; nobody waits politely for a turn or exists only to agree. The world keeps moving around the scene. Keep it concrete and alive, let quiet moments breathe and big ones land, and end each telling at a moment that asks for an answer.`],
};
export function startingIsOld(house) {
  const ins = (house && house.instructions) || {};
  return STARTING_BEFORE.system.includes(ins.system) || STARTING_BEFORE.narrator.includes(ins.narrator);
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
  if (purpose === 'write') return ins.lateOff ? '' : String(ins.late || '').trim();
  if (purpose === 'play') return ins.lateNarratorOff ? '' : String((typeof ins.lateNarrator === 'string' ? ins.lateNarrator : ins.late) || '').trim();
  return '';
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
 * partner. Never a raw macro. */
export function macroNames(house, purpose = 'write', play = null) {
  const name = nameOf(house);
  if (purpose === 'play') return { user: String((play && play.who) || '').trim() || name || 'the one I play', char: 'the narrator' };
  if (purpose === 'partner') return { user: name || 'me', char: 'my partner' };
  return { user: name || 'me', char: 'the writer' };
}
export function withMacros(text, names) {
  const out = String(text == null ? '' : text);
  if (!/\{\{\s*(?:user|char)\s*\}\}|<(?:USER|BOT)>/i.test(out)) return out;
  const n = names || {};
  return out.replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => n.user || 'me').replace(/\{\{\s*char\s*\}\}|<BOT>/gi, () => n.char || 'the writer');
}

function fence(text) { return `"""\n${String(text || '').trim()}\n"""`; }

function titled(novel) { return `“${(novel.meta && novel.meta.title) || 'Untitled'}”`; }
function titleLine(novel) { return `${titled(novel)}${novel.meta && novel.meta.subtitle ? ` — ${novel.meta.subtitle}` : ''}`; }

/* ---------------------------------------------------- the book, described */

export function notesText(novel, { forHelper = false, fit = 0, focus = '', only = null } = {}) {
  const all = novel.notes || {};
  /* only some cards (the notes' check, a group at a time when they outgrow its model) */
  const n = only ? Object.fromEntries(Object.entries(all).map(([k, list]) => [k, Array.isArray(list) ? list.filter((c) => only.has(c.id)) : list])) : all;
  /* the first sentence of a card's words, for a card shown short */
  const firstOf = (t) => { const x = String(t || '').trim(); const m = x.match(/^[\s\S]{20,}?[.!?…](?=\s|$)/); const f = (m ? m[0] : x).slice(0, 220); return f.length < x.length ? f + ' …' : f; };
  const line = (c, short) => `- ${c.name}${c.aka && c.aka.length ? ` (also ${c.aka.join(', ')})` : ''}${c.about ? ` — ${short ? firstOf(c.about) : c.about.trim()}` : ''}`;
  const person = (c, short) => line(c, short) + (short
    ? (c.now ? `\n  Right now: ${firstOf(c.now)}` : '')
    : `${c.ties ? `\n  With others: ${c.ties.trim()}` : ''}${c.now ? `\n  Right now: ${c.now.trim()}` : ''}`);
  const render = (short) => {
    const out = [];
    if ((n.people || []).length) out.push('People\n' + n.people.map((c) => person(c, short('people', c))).join('\n'));
    if ((n.places || []).length) out.push('Places\n' + n.places.map((c) => line(c, short('places', c))).join('\n'));
    if ((n.lore || []).length) out.push((forHelper ? 'Things and facts' : 'Things worth remembering') + '\n' + n.lore.map((c) => line(c, short('lore', c))).join('\n'));
    const open = (n.threads || []).filter((t) => t.open !== false);
    const shut = (n.threads || []).filter((t) => t.open === false);
    if (open.length) out.push('Threads still open\n' + open.map((c) => line(c, short('threads', c))).join('\n'));
    if (shut.length) out.push('Threads that have closed\n' + shut.map((c) => line(c, short('threads', c))).join('\n'));
    return out.join('\n\n');
  };
  const full = render(() => false);
  /* fitted to a model's room (Cozy Tavern's M664): his own cards and the
   * ones the words they go with name, whole; the rest by their first line */
  if (!fit || estimateTokens(full) <= fit) return full;
  const folded = focus ? foldedText(focus) : null;
  const whole = (kind, c) => Boolean(c.updated && c.updated.by === 'you') || Boolean(folded && [c.name, ...(c.aka || [])].some((nm) => nm && nameInText(folded, nm, { words: kind === 'people' })));
  return `${render((kind, c) => !whole(kind, c))}\n\n(To fit, the cards the words below do not name are shown by their first line.)`;
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

/* While the whole book is read again, everyone else goes on with the notes
 * and the Automatic texts as they stood before it (Cozy Tavern's M262: built
 * beside them, swapped in whole at the end — archivist.js readAgain). */
export function rebuilding(novel) { const m = (novel && novel.memory) || {}; return Boolean(m.rereadFrom && m.undo && m.undo.keep); }
export function standingNotes(novel) {
  if (!rebuilding(novel)) return novel;
  const from = novel.memory.rereadFrom;
  return { ...novel, notes: from.notes || {}, kept: { ...(from.kept || {}), ...(novel.kept || {}) } };
}

/* What it's about and how it reads: his own words, set by hand ("Manual"),
 * or — set to Automatic — his words (if he wrote any) and what the helper
 * keeps of the book as it stands. */
export function autoOn(novel, key) { return !(novel.auto && novel.auto[key] === false); }
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
  if (voice && reads) parts.push(`How it reads:\n${voice}\n\nAnd as it reads so far (the words above are right wherever the two differ):\n${reads}`);
  else if (voice || reads) parts.push(`How it reads:\n${voice || reads}`);
  if (plans && String(novel.plans || '').trim()) parts.push(`Where it's headed — plans for later, none of this has happened yet:\n${novel.plans.trim()}`);
  return parts.join('\n\n');
}

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
  }
  if (book.later.length || book.laterOmitted) {
    const rows = book.later.map((s) => `${s.label}\n${s.text}`).join('\n\n');
    const more = book.laterOmitted ? `(${book.laterOmitted === 1 ? 'One more chapter comes' : `${numberWords(book.laterOmitted)} more chapters come`} after ${book.later.length ? 'these' : 'this one'}; ${book.laterOmitted === 1 ? 'it is' : 'they are'} left out here to save room.)` : '';
    parts.push(['What comes later in the book (already written):', rows, more].filter(Boolean).join('\n\n'));
  }
  return parts.join('\n\n\n');
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
export function notesOpening(house, novel, as, purpose = 'write') {
  const name = nameOf(house);
  const numbered = purpose === 'partner' ? ' — every passage numbered as it is on the page' : '';
  if (as === 'assistant') return `My notebook for ${titled(novel)} — ${WHAT_FOLLOWS}${numbered}. I keep it so I never lose the thread; nothing in my notes is ever quoted or mentioned on the page.`;
  return `${name ? `${name} here. ` : ''}Here’s where our book stands — ${WHAT_FOLLOWS}${numbered}. The notes are mine, for you alone: nothing in them is ever quoted or mentioned on the page.`;
}
/* the line that leads into the book when it rides in the system message */
function hereIs(purpose) {
  if (purpose === 'partner') return `Here is ${WHAT_FOLLOWS} — every passage numbered as it is on the page.`;
  if (purpose === 'play') return 'Here is what it’s about, who and what is in it so far, and the book itself up to where the scene picks up.';
  return `Here is ${WHAT_FOLLOWS}.`;
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
  return notesAs === 'system' ? `${lead} ${hereIs('write')}` : lead;
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
export function outcomeWords(outcome, length = 'auto') {
  if (outcome === 'me') return length === 'auto' ? OUTCOME_WORDS.me : `${OUTCOME_WORDS.me} ${SHORTER}`;
  return OUTCOME_WORDS.writer;
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

export function lengthWords(length, { between = false, outcome = 'writer' } = {}) {
  if (length === 'auto') return between ? AUTO_BETWEEN : AUTO_CARRY[outcome === 'me' ? 'me' : 'writer'];
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

const STORY_ONLY = 'Just the story itself — it goes straight onto the page after the last line, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_FIRST = 'Just the story itself — it goes straight onto the page, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_BETWEEN = 'Just the story itself — it goes straight onto the page between the two, so no chapter title, no notes, nothing before or after it.';

export function writeRequest({ chapterLabel, direction, length, empty, firstOfBook, between, outcome = 'writer' }) {
  const d = String(direction || '').trim();
  const lines = [];
  if (empty) {
    lines.push(firstOfBook ? `Begin the novel — ${chapterLabel}.` : `Begin ${chapterLabel}.`);
    if (d) lines.push(`What happens: ${d}`);
  } else if (between) {
    lines.push(`Write the passage that comes next in ${chapterLabel}, between the text before it and the text that follows it.`);
    if (d) lines.push(`What happens: ${d}`);
  } else {
    lines.push(`Carry on with ${chapterLabel} from where it stops. Your first lines follow straight on from its last ones — the same moment, everyone where it left them, nothing it already told told again — so the book reads as one.`);
    lines.push(d ? `What happens next: ${d}` : 'Let the story go where it naturally goes next.');
  }
  /* between two passages, what follows settles it */
  if (!between) lines.push(outcomeWords(outcome, length));
  lines.push(empty ? openingWords(length, { outcome }) : lengthWords(length, { between, outcome }));
  lines.push(empty ? STORY_ONLY_FIRST : between ? STORY_ONLY_BETWEEN : STORY_ONLY);
  return lines.join('\n\n');
}

/* A rewrite with his note: the note is now what happens. The old version is
 * only what happened before it — a reference, never a draft to patch — so
 * the change is followed through everything it touches: what each person
 * does, says, knows and feels, and where the passage ends up. last: nothing
 * comes after it in the book, so it may end wherever the change takes it;
 * otherwise it leads into what follows, and where the two can't both stand,
 * his change wins. */
export function rewriteRequest({ chapterLabel, note, text, last = false }) {
  const n = String(note || '').trim();
  if (!n) {
    return [
      `I’d like this passage from ${chapterLabel} written again.`,
      'Write it again — a fresh take on the same moment.',
      `The passage as it stands now (it sits where the chapter above says it does):\n${fence(text)}`,
      "Write the new version — just the passage itself. It takes the old one's place on the page, so it has to fit with what comes before and after it.",
    ].join('\n\n');
  }
  return [
    `I’d like this passage from ${chapterLabel} written again, with a change.`,
    `What I want different: ${n}`,
    `The passage as it stands now — what happened before my change, there only for reference (it sits where the chapter above says it does):\n${fence(text)}`,
    'My change is now what happens. Rethink the moment with it in place — what each person does, says, knows and feels because of it, and where the passage ends up — and carry it through to the passage’s last line. Keep only what still holds once the change is made; never patch the old words around it.',
    last ? 'Nothing comes after this passage yet, so it can end wherever the change takes it.' : 'What comes after it is already written, so bring the passage to where that picks up — but where my change and what follows can’t both stand, my change wins.',
    'Write the new version — just the passage itself. It takes the old one’s place on the page.',
  ].join('\n\n');
}

export const MARK_OPEN = '⟦';
export const MARK_CLOSE = '⟧';

export function selectionRequest({ chapterLabel, note, marked }) {
  const n = String(note || '').trim();
  return [
    `In this passage from ${chapterLabel}, I’d like one part written again — the part between ${MARK_OPEN} and ${MARK_CLOSE}.`,
    n ? `What I want different: ${n}` : 'Make it read better — same moment, better words.',
    fence(marked),
    `Write only the new words for the marked part — nothing from before or after it, and no ${MARK_OPEN} ${MARK_CLOSE} marks or quotation marks around it — so they slot back in exactly where the old ones were.`,
  ].join('\n\n');
}

/* "Go on": the model is asked to begin by repeating the passage's last few
 * words, so its continuation can be joined exactly where the passage stops —
 * even in the middle of a word (writer.js joinOn). */
/* direction: what he asked for in the passage; change: the change a rewrite
 * of it carried; outcome: who decides how it turns out — '' when nobody is
 * to be told (a rewrite, a scene written into prose, a passage between two) */
export function goOnRequest({ chapterLabel, between = false, tail = '', direction = '', change = '', outcome = 'writer' }) {
  const d = String(direction || '').trim();
  const c = String(change || '').trim();
  return [
    `${between ? 'A passage' : 'The last passage'} of ${chapterLabel} stopped partway through${tail ? `. It stops here:\n${fence(`…${tail}`)}` : '.'}`,
    d ? `What I asked for in it: ${d}` : '',
    c ? `It was written again with a change, which is now what happens: ${c}` : '',
    `Carry on from exactly where it stops. Begin by repeating its last few words exactly as they stand${tail ? '' : ' (from the start of its last sentence)'}, then go on — the repeated words are taken off again and what follows is joined straight on, so don't start over or retell anything.${between ? ' What comes after the passage is already written, so bring it to where that picks up.' : ''}`,
    between || !outcome ? '' : outcomeWords(outcome),
    'Just the story itself — no notes, nothing before or after it.',
  ].filter(Boolean).join('\n\n');
}

export function playToProseRequest({ chapterLabel, who, transcript, length }) {
  const w = String(who || '').trim() || 'my character';
  return [
    `We played a scene picking up where ${chapterLabel} leaves off: I took ${w}’s part, and you told everything else. Here’s how it went — my lines are the ones marked “${w}:”, yours are marked “Narrator:”.`,
    fence(transcript),
    `Now write it into the book as the next part of ${chapterLabel} — real prose in the book's own voice, not a transcript. Keep what happened and what was said; smooth it, give it room, let it read like the rest of the novel.${length === 'paragraphs' ? ' Keep it short.' : ''}`,
    `It has to read as one book with what comes before: its first lines carry straight on from where ${chapterLabel} stops now — nothing it already told told again. Tell it from the point of view and in the tense the book is told in, whoever I played: if the book sees through someone else’s eyes, it stays behind theirs, and ${w}’s thoughts come only as the book would give them. Where the book moves between people’s points of view, change only at a scene break (* * *), and make plain whose eyes we’re behind from its first line.`,
    STORY_ONLY,
  ].join('\n\n');
}

/* Ideas: a few premises for what happens next, each in its own block */
export function ideasRequest(count) {
  const n = Math.max(1, Math.min(5, Math.round(Number(count) || 4)));
  return `Give me ${n === 1 ? 'one premise' : `${numberWords(n).toLowerCase()} genuinely different premises`} for what happens next in the book, right from where it stops — ${n === 1 ? 'the one' : 'each one'} I'd most enjoy writing from, true to the people in it. Each a few lines in my voice, the way I'd type it in the box, in its own ${'<direction>'}…${'</direction>'}. Nothing else.`;
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
  wait: 'Each change waits until I apply it — until then nothing in the book changes.',
};
const partnerChanges = (applies) => `When I ask for a change — or you see one that plainly needs making and I’d want it — make it yourself, in the same answer: a changes block at the very top, then a line for each change saying what you changed and why. ${LANDS[applies] || LANDS.now}

${CHANGES_OPEN}[
  {"passage": "2.3", "find": "the exact words", "replace": "the new words", "why": "…"},
  {"passage": "2.3", "text": "the whole passage, written anew", "why": "…"},
  {"passage": "2.4", "remove": true, "why": "…"},
  {"replace_all": true, "find": "…", "replace": "…", "chapters": "2-5", "why": "…"},
  {"rename": {"from": "Name Surname", "to": "Surname Name"}, "why": "…"},
  {"chapter": 2, "name": "its new name", "why": "…"},
  {"summary": 2, "text": "…", "why": "…"},
  {"book": "about", "find": "…", "replace": "…", "why": "…"},
  {"note": "people", "name": "…", "about": "…", "ties": "…", "now": "…", "newName": "…", "why": "…"},
  {"note": "places", "name": "…", "remove": true, "why": "…"},
  {"module": "The novel craft", "find": "…", "replace": "…", "why": "…"}
]${CHANGES_CLOSE}

- "2.3" is passage 3 of Chapter Two, as on the page. Quote "find" exactly — enough to be found in one place only. A passage written anew is a new version. "replace_all": the same words in the chapters named ("2-5", "3", "all"); "rename": a name everywhere at once, never an ordinary word.
- "book" is "title", "subtitle", "about", "style" or "plans": "find"/"replace", "text" for all of it, or "add" a paragraph. "summary": a chapter's summary.
- "note" is "people", "places", "lore" or "threads" (with "open": false once resolved): only the parts you give change; "newName" renames a card; "remove": true takes it out. "module" changes one of my modules' words — only when I ask.
- To read more first: ${READ_OPEN}[2]${READ_CLOSE} sends Chapter Two whole, ${READ_OPEN}["find: Name Surname"]${READ_CLOSE} every place those words stand, ${READ_OPEN}["module: The novel craft"]${READ_CLOSE} a module's words — then you go on with the same answer.
- Only quote what you can see; never make up a passage or a fact. Nothing changes by being said — only the block changes it — so never say a thing is done unless it is in the block.`;

export function partnerFrame(house, novel, { notesAs = 'system' } = {}) {
  return [
    `We’re talking over our novel, ${titleLine(novel)}, the way two writers do — you as my writing partner: you know the book inside out (it’s all below) and the craft as well as anyone. Say what you really think — what works and what doesn’t, and why; what the people in it would truly do; where it could go — and keep the book straight, changing it when I ask. The notes keep themselves — every new page is read into them, and every few readings each card is checked against the book and cards that repeat each other are folded into one — so leave their upkeep to that: change a card when I ask, or when one is plainly wrong about the book, and never offer to tidy them. You don’t write the next pages: the writer does, from my premise. A premise I could hand it goes in its own ${DIRECTION_OPEN}…${DIRECTION_CLOSE}, in my voice, as I’d type it. ${FICTION_TELL}`,
    partnerChanges(house && house.partnerApplies === 'wait' ? 'wait' : 'now'),
    notesAs === 'system' ? hereIs('partner') : '',
  ].filter(Boolean).join('\n\n');
}

/* the chapters it asked for, sent back whole */
export function readBack(rows, { cut = false } = {}) {
  return [
    rows.map((r) => `${r.label}${r.missing ? ' — not in the book' : ''}\n\n${r.text}`).join('\n\n\n'),
    cut ? 'Here they are — as much of each as fits here beside everything else, the rest left out where it says so. Go on with your answer.' : 'Here they are, whole. Go on with your answer.',
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
    `We’re playing a scene from it, and I’m taking ${who}’s part. Everything ${who} says, does, thinks and feels comes from me, in my lines; you tell everything else — the place, the other people and what they say and do, what happens. Tell it the way the book is told, in its own voice, point of view and tense: if the book sees through ${who}’s eyes, tell what ${who} sees, hears and meets, never what ${who} does or feels about it; if it sees through someone else’s, it stays theirs. Never put a word, a choice or a feeling in ${who}’s mouth or mind, and stop where ${who} would answer or act — that part is mine.`,
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
  return `Begin the scene: where we are, who is there, what is happening. If ${w} isn’t there yet, bring ${w} in; then stop at the first moment ${w} would answer or act.`;
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

/* ------------------------------------------------------- the checker */

export const CHECK_KINDS = ['grammar', 'humanize', 'avoid', 'continuity', 'craft'];
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
  ['canon', 'True to the book', 'nothing in it disagrees with the book, its notes or what came before — names, looks, where everyone is, who knows what — and it keeps the book’s point of view and tense'],
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
  return `${FICTION_WORK}\n\nYou read ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, the way a careful copy editor would: each passage once it’s finished, for what is plainly wrong or would plainly read better — never to change what happens, the people in it, or the voice it’s told in.`;
}

/* stock wording counted in the passages (stock.js), one line: [1.2] “…”, “…”; [1.3] “…” */
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
const NOTES_FOR_A_READER = 'The book’s notes, for what is true in it (where they and the book’s own words disagree, the book’s words are right). They are kept to the newest page of the book: each “Right now” is where someone stands at the end of the book so far, never at these passages — a passage from earlier in the book is not wrong for coming before it:';

/* what I asked the writer for in these passages, each by its number — doing it is never a fault */
function askedLines(asked) {
  const rows = (asked || []).filter((a) => a && String(a.words || '').trim()).map((a) => `[${a.n}] ${String(a.words).replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  return rows.length ? `What I asked the writer for in these passages — whatever a passage does because I asked for it is never a fault:\n${rows.join('\n')}` : '';
}

function writerSees({ his = '', sofar = '' }) {
  const out = [];
  if (his && his.trim()) out.push(`How I want the book written — what the writer is told; nothing it asks for is ever a fault:\n${fence(his)}`);
  if (sofar && sofar.trim()) out.push(`The story so far, chapter by chapter:\n${fence(sofar)}`);
  return out;
}

export function checkRequest({ novel, chapterLabel, numbered, avoid = [], before = '', beforeFrom = 'this', judge = null, stock = {}, his = '', sofar = '', notesFit = 0, asked = [] }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit, focus: `${before}\n${numbered}` });
  if (notes) parts.push(`${NOTES_FOR_A_READER}\n${notes}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) parts.push(about);
  parts.push(...writerSees({ his, sofar }));
  if (before && before.trim()) parts.push(beforeFrom === 'last' ? `The end of the chapter before, for where ${chapterLabel} picks up:\n${fence(before)}` : `${chapterLabel} up to these passages, for what has just happened:\n${fence(before)}`);
  const askedPart = askedLines(asked);
  if (askedPart) parts.push(askedPart);
  parts.push(`Check these passages from ${chapterLabel}, each numbered as it is on the page:\n${fence(numbered)}`);
  const allowed = judge ? allowedFails(judge.target) : 0;
  parts.push(`Suggest only what is worth changing, each a small fix in place:
- "grammar": spelling, grammar, punctuation, a word missing or doubled.
- "humanize": what reads machine-made rather than written, said the way this book would say it. Most often: a phrase that is awkward, or not how anyone would put it; a sentence that is clumsy, overloaded, or the same shape as the ones around it; explaining what the scene already shows, or what a look or a line meant; a cliché or stock phrase (a heart hammering against ribs, a voice barely above a whisper, a breath she didn’t know she was holding, a testament to); a purple or overwritten line, figures piled on figures; a vague word where a particular detail belongs; the turn “it wasn’t X — it was Y”; a feeling given only by the same stock bodily cue; a closing line that says what it all meant; things in threes by habit; a named person called by a string of descriptions instead of their name; the same word twice close together, or a phrase the book keeps reaching for.${stockLine(stock)}${avoid.length ? `
- "avoid": anything on my list of words to avoid (${avoid.map((w) => `“${w}”`).join(', ')}), said another way.` : ''}
- "continuity": something that disagrees with the book or its notes — a name, a look, a fact, who knows what — or a slip from the tense or point of view the book is told in. Only what the telling gives as true is a slip: what someone says that is wrong on purpose or in character — a lie, a joke, a tease, an exaggeration, sarcasm, a memory gone wrong, someone who does not know — is the story, and never a fix. And the seams: this is to be a finished book, so each passage must carry on smoothly from the end of the one before it — no beat told twice, no line answered twice, no jump in time or place nobody marks, no one standing where the passage before left them gone. Where an opening doesn't carry on, fix the opening.

Keep the book’s voice: a fragment, dialect, a character’s own way of talking, or a choice of style the book makes on purpose is not a mistake${his && his.trim() ? ', and nothing I ask the writer for (above) is one' : ''}. ${SOUND_STYLE[soundOf(novel)]} Leave what is right alone; a passage that needs nothing gets nothing.

Each fix replaces a stretch of words: "find" is the words exactly as they stand in that passage — copied exactly, enough of them to stand in only one place in it — "replace" the new words, and "why" a few words on why.${judge ? `

Then judge each passage’s craft as a page of a finished novel, by ten checks. Answer every check of every passage "yes" or "no" — "no" only where you can point to the words in it that fail the check; a check with nothing to try in a passage (nobody speaks: the voices) is "yes". Judged like this, a page from a published novelist fails one or two; a page that reads machine-made fails most. More figures, longer sentences or rarer words are never better writing: overwriting fails "fresh".
${JUDGE_CHECKS.map(([k, , what]) => `- ${k}: ${what}.`).join('\n')}
For each "no", a fault: the check, "words" — the words that fail it, copied exactly from the passage, no more than a sentence — and "why", in a few words. A passage with ${allowed ? `more than ${numberWords(allowed).toLowerCase()} “no”` : 'any “no”'} is under my mark of ${judge.target}: for it, add fixes of kind "craft" — small changes in place that lift it — and in "lift" say, in a few lines in my voice, what writing it again would need to reach ${judge.target} (“Slow the moment she falls…”).` : ''}

Answer with one JSON object and nothing else: {"edits": [{"passage": "2.3", "kind": "grammar", "find": "…", "replace": "…", "why": "…"}]${judge ? `, "grades": [{"passage": "2.3", "checks": {${JUDGE_CHECKS.map(([k], i) => `"${k}": "${i === 9 ? 'no' : 'yes'}"`).join(', ')}}, "faults": [{"check": "ending", "words": "…", "why": "…"}], "lift": "…"}]` : ''}} — or {"edits": []${judge ? ', "grades": […]' : ''}} when nothing needs fixing.`);
  return parts.join('\n\n');
}

/* The judge's head to head (Cozy Tavern's duel): two versions of one passage,
 * written for the same moment by two writers, read blind — "A" and "B", no
 * names — and asked which is the better page; the app asks twice, the order
 * swapped, and a win counts only when both answers agree (a judge's lean to
 * the first or the second cancels out). Asking which of two is better is the
 * judging that agrees with readers most (LitBench, arXiv 2507.00769; EQ-Bench
 * ranks its writers the same way). */
export function duelRequest({ novel, chapterLabel, before = '', beforeFrom = 'this', asked = '', first, second, cut = false, his = '', sofar = '', notesFit = 0 }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit, focus: `${before}\n${first}\n${second}` });
  if (notes) parts.push(`${NOTES_FOR_A_READER}\n${notes}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) parts.push(about);
  parts.push(...writerSees({ his, sofar }));
  if (before && before.trim()) parts.push(beforeFrom === 'last' ? `The end of the chapter before, for where ${chapterLabel} picks up:\n${fence(before)}` : `${chapterLabel} up to this passage, for what has just happened:\n${fence(before)}`);
  if (asked && asked.trim()) parts.push(`What I asked for here:\n${fence(asked)}`);
  parts.push(`Two writers each wrote this passage of ${chapterLabel}, for the same moment.\n\nPage A:\n${fence(first)}\n\nPage B:\n${fence(second)}`);
  parts.push(`Which is the better page of a finished novel here? Judge the writing, not its length: the page that carries on from the story before, stays true to the book, plays what matters as scene, gives each beat its due, keeps its detail particular, its phrasing fresh and its sentences natural, lets its people act from their own wants in their own voices, and ends moving forward. More figures, longer sentences or rarer words are never better writing.${cut ? ' The longer page is shown only as far as the shorter one runs — never count that against it.' : ''}

Answer with one JSON object and nothing else: {"better": "A" or "B" or "same", "why": "one sentence"}.`);
  return parts.join('\n\n');
}

/* ---------------------------------------------------------- the helper */

export function helperFrame(house, novel) {
  const name = nameOf(house);
  return `${FICTION_WORK}\n\nYou keep the notes for ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, so the writer never loses track of who’s who, where things are, who knows what and what’s been set up. You read each new part of the book as it’s written and keep the notes true to it.`;
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

const PEOPLE_FIELDS = '"about": "who they are, for good — looks and bearing, voice and how they talk, temperament, how they act under pressure, what they want, what they would never do", "ties": "how they stand with the others who matter to them, and why — where each tie began, what moved it, where it is now", "now": "where they are and what they’re doing as of the end of the book so far, then their mood and what’s on their mind"';

const NOTE_RULES = `Include only entries that are new or changed, and in each only the fields that changed — a field you give replaces the old one, so give it whole. Keep every fact that's still true.
- Someone, somewhere or something new: write down how they're described the first time they appear — looks, features, voice, what they wear or carry. It can't be found again later.
- "about" is who someone is for good: change it only for something lasting, never a passing mood, and keep everything already in it.
- "now" leads with where they are and what they're doing. Feelings carry over — a shock, a slight, a warmth set earlier still colours them until the story changes it. A plan is never "now": it's a thread.
- "ties": add the newest turn and keep the older ones short; say why each tie moved.
- Who knows what: a secret, or something only some of them saw or were told, says who knows it — and nobody knows what they had no way to learn.
- Whose and who: a thing someone holds, a deed someone did, a line someone said is written with whose it is and who did or said it, as the book has it.
- Each fact is written once, on the card it belongs to — the person it is about, or the thing, place or thread itself. Before you add a card or a line, look for the card that already holds it and change that one; never repeat on another card what one already says.
- Use a card's name exactly as the notes show it. Someone known only by a description ("the courier") is carded by it until the book gives a name — then the name leads and the description goes among the others they go by. A crowd or a passer-by is not a person: no card for "the onlookers".
- Use "gone" only for an entry that no longer belongs in the book at all (it was only ever in text that's been taken out). Mark a thread "open": false once the story resolves it — by what happens after it was set up, never by the words that set it up (an oath sworn, a plan made, a promise given is open) and never just because time passed.
- Write only what the book actually says — never invent, never guess.`;

export function notesRequest({ novel, chapterLabel, before, changes, removed, removedChapters, at = 0, of = 0, later = true, goesOn = false, notesFit = 0 }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit, focus: [before, ...changes.map((c) => `${c.old || ''}\n${c.text || ''}`), ...removed, ...removedChapters].join('\n') });
  parts.push(`The notes as they stand:\n${notes ? notes : '(none yet — this is the start)'}`);
  const about = aboutTheBook(novel, { plans: false, kept: 'his' });
  if (about) parts.push(about);
  const keeps = keptByHelper(novel);
  if (keeps.includes('about')) parts.push(keptPart(novel, 'about', KEEP_ABOUT));
  if (keeps.includes('style')) parts.push(keptPart(novel, 'style', KEEP_STYLE));
  /* where this part sits: a change to an early chapter never turns back where people are "now" */
  if (at && of && at < of && later) parts.push(`This part is from ${chapterLabel}; the book goes on to Chapter ${numberWords(of)}. Where people are “now” is as of the end of the book, so change a “now” only if this part changes it for good.`);
  else if (goesOn) parts.push(`This part sits in the middle of ${chapterLabel}: the chapter goes on after it, and what follows is already in the notes. Where people are “now” is as of the end of the book, so change a “now” only if this part changes it for good.`);
  if (before && before.trim()) parts.push(`${chapterLabel}, up to the new part (for context — already in the notes):\n${fence(before)}`);
  for (const c of changes) {
    if (c.old) parts.push(`This part of ${chapterLabel} was changed. It used to read:\n${fence(c.old)}\nIt now reads:\n${fence(c.text)}`);
    else parts.push(`New in ${chapterLabel}:\n${fence(c.text)}`);
  }
  for (const r of removed) parts.push(`This part was taken out of ${chapterLabel}, so it no longer happens in the book:\n${fence(r)}`);
  for (const r of removedChapters) parts.push(`A whole chapter was taken out of the book, so none of it happens any more. It held:\n${fence(r)}`);
  const keptFields = [
    keeps.includes('about') ? `,\n  "about": "${KEEP_ABOUT} — the whole of it again, only if this part changes it (or it isn’t written yet)"` : '',
    keeps.includes('style') ? `,\n  "style": "${KEEP_STYLE} — the whole of it again, only if this part changes it (or it isn’t written yet)"` : '',
  ].join('');
  parts.push(`Update the notes for what this changes. Answer with one JSON object and nothing else:

{
  "people": [{"name": "…", "aka": ["other names they go by"], ${PEOPLE_FIELDS}}],
  "places": [{"name": "…", "about": "what it is, what it looks and feels like, what's there"}],
  "lore": [{"name": "…", "about": "a thing, a fact, a secret or a rule of the world worth remembering — and who knows it"}],
  "threads": [{"name": "…", "about": "what's been set up — a promise, a secret, a question, a debt — and where it stands", "open": true}],
  "gone": [{"kind": "people", "name": "…"}],
  "chapterName": "a short name for ${chapterLabel}, only if it has none yet"${keptFields}
}

${NOTE_RULES}${keeps.length ? `
- ${keeps.length === 2 ? '"about" and "style" describe' : keeps[0] === 'about' ? '"about" describes' : '"style" describes'} the whole book, not this part alone${keeps.includes('style') ? ' — the voice the book has settled into; where this part strays from it (a slip of tense or point of view), keep the book’s settled voice' : ''}.` : ''}`);
  return parts.join('\n\n');
}

/* THE NOTES' AUDITOR (Cozy Tavern's ledger auditor, for a book): the whole
 * notes held against the book as it stands — the versions on the page — so
 * whatever the notes still hold from words since rewritten or taken out, or
 * have drifted on, is put right. His own cards keep his words. */
export const AUDIT_ASK = 'Check every card against the book as it stands';
export function auditRequest({ novel, bookText: text, his = [], partial = false, only = null, others = [] }) {
  const parts = [];
  parts.push(`The notes as they stand${only ? ' — the cards to check this time' : ''}:\n${notesText(novel, { forHelper: true, only }) || '(none)'}`);
  if (others.length) parts.push(`The other cards, checked another time — not shown here, and never to be added again or changed now: ${others.join(', ')}.`);
  const about = aboutTheBook(novel, { plans: false, kept: 'his' });
  if (about) parts.push(about);
  parts.push(`The book as it stands now — only what these words say happens. Anything the notes hold from words that have since been rewritten or taken out no longer happens:\n\n${text || '(nothing written yet)'}`);
  const one = his.length === 1;
  parts.push(`${AUDIT_ASK}, the way an editor checks a continuity bible:
- A fact, a line someone said, a name, an event or a secret no passage says any more (it came from words since rewritten or taken out): correct the card to what the book says now, or take the card out with "gone" when nothing of it is in the book.
- A detail that differs from the book — a name, a look, an age, who said what, who knows what: put it right.
- Where each person is "now", as of the end of the book.
- A thread the book has resolved — by what happens after it was set up, never by the words that set it up: "open": false. One it opened that the notes miss: add it.
- Whose and who: whose thing it is, who did a deed, who said a line — held against the passages in their order.
- Someone or something that matters and is missing: add it, described as the book first describes them.
- Cards that say the same thing: each fact belongs on one card — the person it is about, or the thing, place or thread itself. Where several cards repeat it (a limit, a rule, a name kept back, a secret), keep it on the card it belongs to and take it off the others, giving each of them whole without it. Two cards for one person, place or thing become one: give the one to keep whole, with whatever the other held that it lacks (for a person, the other's names among the others they go by), and put the other in "gone". Nothing true is lost in the folding.${his.length ? `
- ${his.join(', ')} — ${one ? 'this card is' : 'these cards are'} mine, written or changed by me: never change what I wrote about ${one ? 'it' : 'them'}, never take ${one ? 'it' : 'them'} out; only "now" and "ties" may move. Where another card repeats what ${one ? 'it says' : 'one of mine says'}, the other card gives way.` : ''}${partial ? `
- Some chapters are given here in short, or left out to save room: a detail a chapter in short leaves out may still be in the book. Change or take out only what the words here contradict — never what they merely leave unsaid.` : ''}

Answer with one JSON object and nothing else — only the cards that need a change, each field you give whole, each with "why": what was wrong, in a few plain words:

{
  "people": [{"name": "…", "aka": ["…"], ${PEOPLE_FIELDS}, "why": "…"}],
  "places": [{"name": "…", "about": "…", "why": "…"}],
  "lore": [{"name": "…", "about": "…", "why": "…"}],
  "threads": [{"name": "…", "about": "…", "open": true, "why": "…"}],
  "gone": [{"kind": "lore", "name": "…", "why": "…"}],
  "clear": true,
  "verdict": "a sentence or two for me, plainly: whether the notes, with these changes, hold true to the book — and anything they can't settle because the book disagrees with itself"
}

"clear" is false only when something is left for me to look at. When every card checks out, answer only {"clear": true, "verdict": "…"}. Write only what the book actually says — never invent, never guess.`);
  return parts.join('\n\n');
}

/* Written whole, for a book set to Automatic (when it has none yet, or he
 * asked for it again from the book): from the book itself, its notes and his
 * words. */
export function keepRequest({ novel, keeps, bookText: text, notesFit = 0 }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true, fit: notesFit });
  if (notes) parts.push(`The notes as they stand:\n${notes}`);
  const about = aboutTheBook(novel, { plans: false, kept: 'his' });
  if (about) parts.push(`My own words (they stand as they are — never repeat them; keep only what they don’t say):\n\n${about}`);
  parts.push(`The book as it stands:\n\n${text || '(nothing written yet)'}`);
  const fields = [
    keeps.includes('about') ? `"about": "${KEEP_ABOUT}"` : '',
    keeps.includes('style') ? `"style": "${KEEP_STYLE} — the voice it has settled into"` : '',
  ].filter(Boolean).join(', ');
  parts.push(`Write ${keeps.length === 2 ? 'both' : 'it'}, for the writer to read before every page: a few plain paragraphs at most, from what the book actually says — never invented. Answer with one JSON object and nothing else: {${fields}}`);
  return parts.join('\n\n');
}

/* A chapter summed up — whole, or (too long for the helper's model) in parts,
 * each part's summary carried into the next. What to keep is Summaryception's
 * hard-won list, for a novel: causes kept with what they led to, first
 * appearances described, who learns what, the exact words that will matter. */
export function summaryRequest({ novel, chapterLabel, text, needsName, words, part = 0, parts = 0, soFar = '', known = [], his = '' }) {
  const size = Math.max(120, Math.min(450, Math.round(words / 12)));
  const lines = [];
  if (part) {
    lines.push(`Here's part ${part} of ${parts} of ${chapterLabel} of ${titled(novel)}:`);
    if (soFar) lines.push(`The summary of the parts before it:\n${fence(soFar)}`);
  } else lines.push(`Here's ${chapterLabel} of ${titled(novel)}:`);
  lines.push(fence(text));
  lines.push(`Summarise ${part ? `the chapter so far — ${soFar ? 'the summary above and this part together' : 'this part'} —` : 'it'} for the book's notes, so the writer can carry on from it without the chapter itself:
- what happens, in order, and why — keep each cause with what it led to;
- who's in it and what changes for them, inside and out;
- anyone or anything appearing in the book for the first time, with how they're described${known.length ? ` (already known from earlier: ${known.join(', ')})` : ''};
- who learns what — and who doesn't;
- anything set up for later — a promise, a secret, an object, a question left open — with the exact words of any promise, oath or threat that will matter (a short quote);
- where it happens, and the day, date or time where the chapter gives one;
- numbers, ages, amounts and distances exactly as the chapter gives them.
${his ? `\nMy own summary of this chapter, from before its latest changes — my words are right wherever the chapter still says what they say, so keep them there:\n${fence(his)}\n` : ''}Use names rather than "he" or "she" wherever it could be unclear. Nothing invented, nothing softened. Plain prose, about ${size} words — longer when the chapter is dense: nothing that matters left out to keep it short.${needsName ? ' The chapter has no name yet, so give it a short one.' : ''}`);
  lines.push(`Answer with one JSON object and nothing else: {"summary": "…"${needsName ? ', "name": "…"' : ''}}`);
  return lines.join('\n\n');
}

/* A summary that left out a name or a figure the chapter holds, asked once
 * more with each one where it stands (Cozy Tavern M111, M208): in the
 * summary's own sentences, never a list of words. */
export function summaryAgainRequest({ novel, chapterLabel, summary, missing }) {
  const lines = (missing || []).map((m) => `- ${m.kind === 'name' ? 'the name' : 'the figure'} ${m.token}${m.where ? ` — the chapter has: “…${m.where}…”` : ''}`);
  return `Here's the summary of ${chapterLabel} of ${titled(novel)} as it stands:\n${fence(summary)}\n\nThese stand in the chapter and nowhere in the summary:\n${lines.join('\n')}\n\nWrite the summary again with every one of them a writer carrying the book on would need — who each one is, what each figure counts and why it matters — in the summary's own sentences, never as a list of words. Leave out any that is not a person, a place or a figure that matters, and keep everything the summary already holds.\n\nAnswer with one JSON object and nothing else: {"summary": "…"}`;
}

export const JSON_AGAIN = 'That answer could not be read as JSON. Answer again with only the JSON object — no other words, no code fence.';
export const JSON_CUT = 'That answer was cut off before it finished. Answer again with only the JSON object, complete — shorter where you can — with no other words and no code fence.';

/* ---------------------------------------------------- his own instructions */

export function withHis(own, frame) {
  return [String(own || '').trim(), frame].filter(Boolean).join('\n\n');
}
