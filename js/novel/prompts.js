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
 *   word. (Cozy Tavern M327, M333.)
 * - The book is fiction for grown readers, said once and plainly to the ones
 *   who tell it (the writer, the narrator, the partner) and to the one who
 *   keeps its notes (the helper): nothing in it is ever softened, skipped or
 *   judged. (Cozy Tavern's frame and craft lines; Summaryception's coverage
 *   note — a helper handed an explicit passage with no frame for it can
 *   quietly sanitise, and a sanitised summary says the scene never happened.)
 * - His own words (his instructions, his brief, his notes) go word for word.
 */

import { LENGTHS } from './shape.js';
import { numberWords } from '../util.js';

/* ------------------------------------------------- the starting words */
/* What the boxes in Settings → Your instructions start with, and what
 * "Back to the default" puts back. */

export const DEFAULT_WRITING = `You write fiction the way good published novels read: concrete, sensory detail; real feeling under the surface; dialogue that sounds like people actually talking; a pace that gives quiet moments room to breathe and lets big moments land.

Stay true to the characters and to everything already written — never contradict it. Show rather than summarise. Don't rush to wrap things up, don't end on a neat moral, and don't reach for a cliffhanger unless the story calls for one. Avoid stock phrases and repeating yourself.`;

export const DEFAULT_NARRATOR = `You tell the scene the way the book itself is told — its voice, its point of view, its tense — a few paragraphs at a time: the place, the weather of the moment, the other people and what they say and do, what happens next.

The people in it have their own minds. They want things, they push back, they lie, they surprise; nobody waits politely for a turn or exists only to agree. The world keeps moving around the scene. Keep it concrete and alive, let quiet moments breathe and big ones land, and end each telling at a moment that asks for an answer.`;

export const DEFAULT_PARTNER = `Talk the book over like a seasoned novelist and editor who loves this story and wants it to be as good as it can be: honest, specific and warm. Say what works and what doesn't, and why. When I'm stuck, offer two or three real ways forward rather than a list of ten, and think about what the people in it would truly do. Keep it short when short will do.`;

/* ------------------------------------------------------- said plainly */

/* to the ones who tell the story */
const FICTION_TELL = 'It’s fiction for grown readers, and we write it uncensored: whatever the story holds — violence, cruelty, desire, despair — goes on the page honestly and in full, never softened, skipped or judged.';

/* to the one who keeps its notes */
export const FICTION_WORK = 'This is fiction craft for a novel being written together; your work is only the task below — never judgment of the book. The book is fiction for grown readers and may hold anything — violence, cruelty, sex, despair: keep all of it with the same plain fidelity, never skipping, softening or tidying away what the book contains.';

function nameOf(house) { return String((house && house.you && house.you.name) || '').trim(); }

function fence(text) { return `"""\n${String(text || '').trim()}\n"""`; }

function titled(novel) { return `“${(novel.meta && novel.meta.title) || 'Untitled'}”`; }
function titleLine(novel) { return `${titled(novel)}${novel.meta && novel.meta.subtitle ? ` — ${novel.meta.subtitle}` : ''}`; }

/* ---------------------------------------------------- the book, described */

export function notesText(novel, { forHelper = false } = {}) {
  const n = novel.notes || {};
  const out = [];
  const line = (c, extra) => `- ${c.name}${c.aka && c.aka.length ? ` (also ${c.aka.join(', ')})` : ''}${c.about ? ` — ${c.about.trim()}` : ''}${extra || ''}`;
  const person = (c) => line(c, `${c.ties ? `\n  With others: ${c.ties.trim()}` : ''}${c.now ? `\n  Right now: ${c.now.trim()}` : ''}`);
  if ((n.people || []).length) out.push('People\n' + n.people.map(person).join('\n'));
  if ((n.places || []).length) out.push('Places\n' + n.places.map((c) => line(c)).join('\n'));
  if ((n.lore || []).length) out.push((forHelper ? 'Things and facts' : 'Things worth remembering') + '\n' + n.lore.map((c) => line(c)).join('\n'));
  const open = (n.threads || []).filter((t) => t.open !== false);
  const shut = (n.threads || []).filter((t) => t.open === false);
  if (open.length) out.push('Threads still open\n' + open.map((c) => line(c)).join('\n'));
  if (shut.length) out.push('Threads that have closed\n' + shut.map((c) => line(c)).join('\n'));
  return out.join('\n\n');
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
 * words on their own (it keeps them), so for it kept: false. */
export function aboutTheBook(novel, { plans = true, kept = true } = {}) {
  const parts = [];
  const own = String(novel.brief || '').trim();
  const about = kept ? keptText(novel, 'about') : '';
  if (own && about) parts.push(`What it's about:\n${own}\n\nAnd as the book stands now (my words above win wherever the two differ):\n${about}`);
  else if (own || about) parts.push(`What it's about:\n${own || about}`);
  const voice = String(novel.style || '').trim();
  const reads = kept ? keptText(novel, 'style') : '';
  if (voice && reads) parts.push(`How it reads:\n${voice}\n\nAnd as it reads so far (my words above win wherever the two differ):\n${reads}`);
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

/* ---------------------------------------------------------- the writer */

export function writerFrame(house, novel, { notesAs = 'system' } = {}) {
  const lead = `This is our novel, ${titleLine(novel)}. ${FICTION_TELL}`;
  return notesAs === 'system' ? `${lead} ${hereIs('write')}` : lead;
}

/* Automatic: how much is the writer's call — enough to carry the story on the
 * way he'll enjoy it, all of what he asked for, stopping where he'd want to
 * take the wheel. Between two passages it is as much as the bridge needs. */
const AUTO_CARRY = 'How much to write is yours to judge, the way a novelist would: as much as this part needs — all of what I asked for, if I said what happens — carrying the story forward the way you think I’ll enjoy it, and stopping where I’d most want to take the wheel: a choice that’s mine to make, a line that waits for an answer, a turn I’d want to steer. A quiet beat can be a few paragraphs; a big scene can run long.';
const AUTO_OPEN = 'How much of the opening to write is yours to judge, the way a novelist would: enough to set it going the way you think I’ll enjoy it — all of what I asked for, if I said what happens — stopping where I’d most want to take the wheel: a choice that’s mine to make, a line that waits for an answer, a turn I’d want to steer.';
const AUTO_BETWEEN = 'How much to write is yours to judge: as much as it takes to get naturally from the text before it to the text that follows it — no more.';

export function lengthWords(length, { between = false } = {}) {
  if (length === 'auto') return between ? AUTO_BETWEEN : AUTO_CARRY;
  const L = LENGTHS[length] || LENGTHS.scene;
  if (length === 'chapter') return 'Write the rest of this chapter, through to a natural chapter ending.';
  if (length === 'paragraphs') return `Write the next few paragraphs — around ${L.words[0]} to ${L.words[1]} words.`;
  if (length === 'long') return `Write a long stretch — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
  return `Write the next scene — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
}

/* the same, for a chapter with nothing in it yet */
export function openingWords(length) {
  if (length === 'auto') return AUTO_OPEN;
  const L = LENGTHS[length] || LENGTHS.scene;
  if (length === 'chapter') return 'Write the whole chapter, through to a natural chapter ending.';
  if (length === 'paragraphs') return `Write its opening paragraphs — around ${L.words[0]} to ${L.words[1]} words.`;
  if (length === 'long') return `Write a long opening stretch — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
  return `Write the opening scene — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
}

const STORY_ONLY = 'Just the story itself — it goes straight onto the page after the last line, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_FIRST = 'Just the story itself — it goes straight onto the page, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_BETWEEN = 'Just the story itself — it goes straight onto the page between the two, so no chapter title, no notes, nothing before or after it.';

export function writeRequest({ chapterLabel, direction, length, empty, firstOfBook, between }) {
  const d = String(direction || '').trim();
  const lines = [];
  if (empty) {
    lines.push(firstOfBook ? `Begin the novel — ${chapterLabel}.` : `Begin ${chapterLabel}.`);
    if (d) lines.push(`What happens: ${d}`);
  } else if (between) {
    lines.push(`Write the passage that comes next in ${chapterLabel}, between the text before it and the text that follows it.`);
    if (d) lines.push(`What happens: ${d}`);
  } else {
    lines.push(`Carry on with ${chapterLabel} from where it stops.`);
    lines.push(d ? `What happens next: ${d}` : 'Let the story go where it naturally goes next.');
  }
  lines.push(empty ? openingWords(length) : lengthWords(length, { between }));
  lines.push(empty ? STORY_ONLY_FIRST : between ? STORY_ONLY_BETWEEN : STORY_ONLY);
  return lines.join('\n\n');
}

export function rewriteRequest({ chapterLabel, note, text }) {
  const n = String(note || '').trim();
  return [
    `I’d like this passage from ${chapterLabel} written again.`,
    n ? `What I want different: ${n}` : 'Write it again — a fresh take on the same moment.',
    `The passage as it stands now (it sits where the chapter above says it does):\n${fence(text)}`,
    "Write the new version — just the passage itself. It takes the old one's place on the page, so it has to fit with what comes before and after it.",
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
export function goOnRequest({ chapterLabel, between = false, tail = '' }) {
  return [
    `${between ? 'A passage' : 'The last passage'} of ${chapterLabel} stopped partway through${tail ? `. It stops here:\n${fence(`…${tail}`)}` : '.'}`,
    `Carry on from exactly where it stops. Begin by repeating its last few words exactly as they stand${tail ? '' : ' (from the start of its last sentence)'}, then go on — the repeated words are taken off again and what follows is joined straight on, so don't start over or retell anything.${between ? ' What comes after the passage is already written, so bring it to where that picks up.' : ''}`,
    'Just the story itself — no notes, nothing before or after it.',
  ].join('\n\n');
}

export function playToProseRequest({ chapterLabel, who, transcript, length }) {
  const w = String(who || '').trim() || 'my character';
  return [
    `We played a scene picking up where ${chapterLabel} leaves off: I took ${w}’s part, and you told everything else. Here’s how it went — my lines are the ones marked “${w}:”, yours are marked “Narrator:”.`,
    fence(transcript),
    `Now write it into the book as the next part of ${chapterLabel} — real prose in the book's own voice, not a transcript. Keep what happened and what was said; smooth it, give it room, let it read like the rest of the novel.${length === 'paragraphs' ? ' Keep it short.' : ''}`,
    STORY_ONLY,
  ].join('\n\n');
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

/* whether its changes land at once or wait for him — said, so its words after the block are true */
const LANDS = {
  now: 'I see every change as it lands, and any of them can be undone.',
  wait: 'Each change waits until I apply it — until then nothing in the book changes.',
};
const partnerChanges = (applies) => `When I ask for a change — or you see one that plainly needs making and I’d want it — make it yourself, in the same answer: a changes block at the very top, then a line for each change saying what you changed and why. ${LANDS[applies] || LANDS.now}

${CHANGES_OPEN}[
  {"passage": "2.3", "find": "the exact words", "replace": "the new words", "why": "…"},
  {"passage": "2.3", "text": "the whole passage, written anew", "why": "…"},
  {"chapter": 2, "name": "its new name", "why": "…"},
  {"book": "about", "find": "…", "replace": "…", "why": "…"},
  {"note": "people", "name": "…", "about": "…", "ties": "…", "now": "…", "why": "…"},
  {"note": "threads", "name": "…", "open": false, "why": "…"},
  {"note": "places", "name": "…", "remove": true, "why": "…"}
]${CHANGES_CLOSE}

- "2.3" is passage 3 of Chapter Two, numbered as on the page. Quote "find" exactly as it stands — enough of it to be found in one place only. A passage written anew becomes a new version of it; my earlier words stay, one arrow away.
- "book" is "title", "subtitle", "about" (what it’s about), "style" (how it reads) or "plans" (where it’s headed) — with "find" and "replace", or "text" for the whole of it, or "add" for a new paragraph at its end.
- "note" is "people", "places", "lore" (things worth remembering) or "threads": a card added or brought up to date — only the parts you give change — or, with "remove": true, taken out of the notes.
- For a chapter you only have in short, ask for it whole with ${READ_OPEN}[2]${READ_CLOSE} — it comes back to you, and you go on from there.
- Only quote what you can see; never make up a passage or a fact. Nothing changes by being said — only the block changes it — so never say a thing is done unless it is in the block.`;

export function partnerFrame(house, novel, { notesAs = 'system' } = {}) {
  return [
    `We’re talking over our novel, ${titleLine(novel)}, the way two writers do. You know the book inside out and the craft as well as anyone: say what you really think — what works and what doesn’t, and why; what the people in it would truly do; where it could go. ${FICTION_TELL}`,
    partnerChanges(house && house.partnerApplies === 'wait' ? 'wait' : 'now'),
    notesAs === 'system' ? hereIs('partner') : '',
  ].filter(Boolean).join('\n\n');
}

/* the chapters it asked for, sent back whole */
export function readBack(rows) {
  return [
    rows.map((r) => `${r.label}${r.missing ? ' — not in the book' : ''}\n\n${r.text}`).join('\n\n\n'),
    'Here they are, whole. Go on with your answer.',
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
const choicesWords = (who) => `After each part you tell, once it stops where ${who} would answer or act, offer me three different things ${who} might say or do next — a short line each, as different from one another as you can make them — between ${CHOICES_OPEN} and ${CHOICES_CLOSE}, one to a line. They’re only offers, outside the scene: nothing ${who} does is decided until I choose.`;

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

export const CHECK_KINDS = ['grammar', 'humanize', 'avoid', 'continuity'];

export function checkerFrame(house, novel) {
  const name = nameOf(house);
  return `${FICTION_WORK}\n\nYou read ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, the way a careful copy editor would: each passage once it’s finished, for what is plainly wrong or would plainly read better — never to change what happens, the people in it, or the voice it’s told in.`;
}

export function checkRequest({ novel, chapterLabel, numbered, avoid = [] }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true });
  if (notes) parts.push(`The book’s notes, for what is true in it:\n${notes}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) parts.push(about);
  parts.push(`Check these passages from ${chapterLabel}, each numbered as it is on the page:\n${fence(numbered)}`);
  parts.push(`Suggest only what is worth changing, each a small fix in place:
- "grammar": spelling, grammar, punctuation, a word missing or doubled.
- "humanize": what reads stock or machine-made rather than written — a cliché, filler, the same word twice close together, a phrase the book keeps reaching for — said the way this book would say it.${avoid.length ? `
- "avoid": anything on my list of words to avoid (${avoid.map((w) => `“${w}”`).join(', ')}), said another way.` : ''}
- "continuity": something that disagrees with the book or its notes — a name, a look, a fact, who knows what — or a slip from the tense or point of view the book is told in.

Keep the book’s voice: a fragment, dialect, a character’s own way of talking, or a choice of style the book makes on purpose is not a mistake. Leave what is right alone; a passage that needs nothing gets nothing.

Each fix replaces a stretch of words: "find" is the words exactly as they stand in that passage — copied exactly, enough of them to stand in only one place in it — "replace" the new words, and "why" a few words on why. Answer with one JSON object and nothing else: {"edits": [{"passage": "2.3", "kind": "grammar", "find": "…", "replace": "…", "why": "…"}]} — or {"edits": []} when nothing needs fixing.`);
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
  const mine = own ? ' (the author’s own words above stand beside it: never repeat them — keep only what they don’t say)' : '';
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
- Use "gone" only for an entry that no longer belongs in the book at all (it was only ever in text that's been taken out). Mark a thread "open": false once the story resolves it — never just because time passed.
- Write only what the book actually says — never invent, never guess.`;

export function notesRequest({ novel, chapterLabel, before, changes, removed, removedChapters, at = 0, of = 0, goesOn = false }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true });
  parts.push(`The notes as they stand:\n${notes ? notes : '(none yet — this is the start)'}`);
  const about = aboutTheBook(novel, { plans: false, kept: false });
  if (about) parts.push(about);
  const keeps = keptByHelper(novel);
  if (keeps.includes('about')) parts.push(keptPart(novel, 'about', KEEP_ABOUT));
  if (keeps.includes('style')) parts.push(keptPart(novel, 'style', KEEP_STYLE));
  /* where this part sits: a change to an early chapter never turns back where people are "now" */
  if (at && of && at < of) parts.push(`This part is from ${chapterLabel}; the book goes on to Chapter ${numberWords(of)}. Where people are “now” is as of the end of the book, so change a “now” only if this part changes it for good.`);
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

/* Written whole, for a book set to Automatic (when it has none yet, or he
 * asked for it again from the book): from the book itself, its notes and his
 * words. */
export function keepRequest({ novel, keeps, bookText: text }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true });
  if (notes) parts.push(`The notes as they stand:\n${notes}`);
  const about = aboutTheBook(novel, { plans: false, kept: false });
  if (about) parts.push(`The author’s own words (they stand as they are — never repeat them; keep only what they don’t say):\n\n${about}`);
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
export function summaryRequest({ novel, chapterLabel, text, needsName, words, part = 0, parts = 0, soFar = '' }) {
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
- anyone or anything appearing for the first time, with how they're described;
- who learns what — and who doesn't;
- anything set up for later — a promise, a secret, an object, a question left open — with the exact words of any promise, oath or threat that will matter (a short quote);
- the day, date or time, where the chapter gives one.
Use names rather than "he" or "she" wherever it could be unclear. Nothing invented, nothing softened. Plain prose, about ${size} words.${needsName ? ' The chapter has no name yet, so give it a short one.' : ''}`);
  lines.push(`Answer with one JSON object and nothing else: {"summary": "…"${needsName ? ', "name": "…"' : ''}}`);
  return lines.join('\n\n');
}

export const JSON_AGAIN = 'That answer could not be read as JSON. Answer again with only the JSON object — no other words, no code fence.';
export const JSON_CUT = 'That answer was cut off before it finished. Answer again with only the JSON object, complete — shorter where you can — with no other words and no code fence.';

/* ---------------------------------------------------- his own instructions */

export function withHis(own, frame) {
  return [String(own || '').trim(), frame].filter(Boolean).join('\n\n');
}
