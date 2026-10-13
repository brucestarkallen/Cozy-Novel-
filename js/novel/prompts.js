/* Cozy Novel — js/novel/prompts.js
 *
 * EVERY WORD THE APP ITSELF SAYS TO A MODEL LIVES HERE, in one place, so it
 * can be read like a letter. His rule for all of it: natural, the way one
 * person hands a manuscript to another — never tags, labels or system-speak
 * that would break the voice his own instructions give the writer. His own
 * words (his instructions, his brief, his notes) go word for word.
 */

import { LENGTHS } from './shape.js';
import { numberWords } from '../util.js';

export const DEFAULT_WRITING = `You write fiction the way good published novels read: concrete, sensory detail; real feeling under the surface; dialogue that sounds like people actually talking; a pace that gives quiet moments room to breathe and lets big moments land.

Stay true to the characters and to everything already written — never contradict it. Show rather than summarise. Don't rush to wrap things up, don't end on a neat moral, and don't reach for a cliffhanger unless the story calls for one. Avoid stock phrases and repeating yourself.`;

function nameOf(house) { return String((house && house.you && house.you.name) || '').trim(); }

/* "Bruce" — or, with no name set, "the author" */
export function authorWord(house) { return nameOf(house) || 'the author'; }

function fence(text) { return `"""\n${String(text || '').trim()}\n"""`; }

function titled(novel) { return `“${(novel.meta && novel.meta.title) || 'Untitled'}”`; }

/* ---------------------------------------------------- the book, described */

export function notesText(novel, { forHelper = false } = {}) {
  const n = novel.notes || {};
  const out = [];
  const line = (c, extra) => `- ${c.name}${c.aka && c.aka.length ? ` (also ${c.aka.join(', ')})` : ''}${c.about ? ` — ${c.about.trim()}` : ''}${extra || ''}`;
  if ((n.people || []).length) out.push('People\n' + n.people.map((c) => line(c, c.now ? `\n  Right now: ${c.now.trim()}` : '')).join('\n'));
  if ((n.places || []).length) out.push('Places\n' + n.places.map((c) => line(c)).join('\n'));
  if ((n.lore || []).length) out.push((forHelper ? 'Things and facts' : 'Things worth remembering') + '\n' + n.lore.map((c) => line(c)).join('\n'));
  const open = (n.threads || []).filter((t) => t.open !== false);
  const shut = (n.threads || []).filter((t) => t.open === false);
  if (open.length) out.push('Threads still open\n' + open.map((c) => line(c)).join('\n'));
  if (shut.length) out.push('Threads that have closed\n' + shut.map((c) => line(c)).join('\n'));
  return out.join('\n\n');
}

/* The brief, the style and the plans, as he wrote them. */
export function aboutTheBook(novel, { plans = true } = {}) {
  const parts = [];
  if (String(novel.brief || '').trim()) parts.push(`What it's about:\n${novel.brief.trim()}`);
  if (String(novel.style || '').trim()) parts.push(`How it reads:\n${novel.style.trim()}`);
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

/* ---------------------------------------------------------- the writer */

export function writerFrame(house, novel) {
  const name = nameOf(house);
  return `Here's the novel ${name ? `you and ${name} are` : "you're"} writing, ${titled(novel)}${novel.meta && novel.meta.subtitle ? ` — ${novel.meta.subtitle}` : ''}: what it's about, the people and places in it so far, and the book itself up to where you are now.`;
}

export function lengthWords(length) {
  const L = LENGTHS[length] || LENGTHS.scene;
  if (length === 'chapter') return 'Write the rest of this chapter, through to a natural chapter ending.';
  if (length === 'paragraphs') return `Write the next few paragraphs — around ${L.words[0]} to ${L.words[1]} words.`;
  if (length === 'long') return `Write a long stretch — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
  return `Write the next scene — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
}

/* the same, for a chapter with nothing in it yet */
export function openingWords(length) {
  const L = LENGTHS[length] || LENGTHS.scene;
  if (length === 'chapter') return 'Write the whole chapter, through to a natural chapter ending.';
  if (length === 'paragraphs') return `Write its opening paragraphs — around ${L.words[0]} to ${L.words[1]} words.`;
  if (length === 'long') return `Write a long opening stretch — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
  return `Write the opening scene — around ${L.words[0].toLocaleString()} to ${L.words[1].toLocaleString()} words.`;
}

const STORY_ONLY = 'Just the story itself — it goes straight onto the page after the last line, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_FIRST = 'Just the story itself — it goes straight onto the page, so no chapter title, no notes, nothing before or after it.';
const STORY_ONLY_BETWEEN = 'Just the story itself — it goes straight onto the page between the two, so no chapter title, no notes, nothing before or after it.';

export function writeRequest({ house, chapterLabel, direction, length, empty, firstOfBook, between }) {
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
  lines.push(empty ? openingWords(length) : lengthWords(length));
  lines.push(empty ? STORY_ONLY_FIRST : between ? STORY_ONLY_BETWEEN : STORY_ONLY);
  return lines.join('\n\n');
}

export function rewriteRequest({ house, chapterLabel, note, text }) {
  const who = authorWord(house);
  const n = String(note || '').trim();
  return [
    who === 'the author' ? `This passage from ${chapterLabel} is to be rewritten.` : `${who} wants this passage from ${chapterLabel} rewritten.`,
    n ? `What to change: ${n}` : 'Write it again — a fresh take on the same moment.',
    `The passage as it stands now (it sits where the chapter above says it does):\n${fence(text)}`,
    "Write the new version — just the passage itself. It takes the old one's place on the page, so it has to fit with what comes before and after it.",
  ].join('\n\n');
}

export const MARK_OPEN = '⟦';
export const MARK_CLOSE = '⟧';

export function selectionRequest({ house, chapterLabel, note, marked }) {
  const who = authorWord(house);
  const n = String(note || '').trim();
  return [
    `In this passage from ${chapterLabel}, ${who === 'the author' ? 'one part needs' : `${who} wants one part`} rewritten — the part between ${MARK_OPEN} and ${MARK_CLOSE}.`,
    n ? `What to change: ${n}` : 'Make it read better — same moment, better words.',
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

export function playToProseRequest({ house, chapterLabel, who, transcript, length }) {
  const name = authorWord(house);
  return [
    `${name === 'the author' ? 'The author' : name} played ${who} through a scene, with a narrator playing everyone and everything else, picking up where ${chapterLabel} leaves off. Here's how it went:`,
    fence(transcript),
    `Now write it into the book as the next part of ${chapterLabel} — real prose in the book's own voice, not a transcript. Keep what happened and what was said; smooth it, give it room, let it read like the rest of the novel.${length === 'paragraphs' ? ' Keep it short.' : ''}`,
    STORY_ONLY,
  ].join('\n\n');
}

/* --------------------------------------------------------- the partner */

export function partnerFrame(house, novel) {
  const name = nameOf(house);
  return `You're ${name ? `${name}'s` : "the author's"} writing partner on ${titled(novel)} — the one ${name || 'they'} talk${name ? 's' : ''} the book over with: ideas, problems, characters, where it could go next. Talk like a friend who knows the book inside out — honest, specific and warm, and short when short will do. You're not writing the pages here; a line or two of prose to show an idea is fine. Here's the book as it stands.`;
}

/* ------------------------------------------------------- the narrator */

export function playFrame(house, novel, play, chapterLabel) {
  const name = authorWord(house);
  const who = String(play.who || '').trim() || 'their character';
  const Name = name === 'the author' ? 'The author' : name;
  return [
    `${Name} is playing ${who} in a scene from ${titled(novel)}. ${name === 'the author' ? 'They write' : `${name} writes`} what ${who} says, does and thinks; you play everyone and everything else — the other people, the place, what happens. Never speak, act or decide for ${who}: that's ${name === 'the author' ? 'theirs' : `${name}'s`}. Tell it in the book's own voice, a few paragraphs at a time, and stop where ${who} would get to react.`,
    `Where the scene starts: ${String(play.from || '').trim() || `right where ${chapterLabel} leaves off`}.`,
  ].join('\n\n');
}

export function playOpening({ who }) {
  return `Set the scene and begin — bring ${who || 'my character'} in, and stop where they would first get to act.`;
}

export function playOnwards({ who }) {
  return `Carry the scene on from where the chapter now stands, and stop where ${who || 'my character'} would next get to act.`;
}

/* ---------------------------------------------------------- the helper */

export function helperFrame(house, novel) {
  const name = nameOf(house);
  return `You keep the notes for ${titled(novel)}, a novel ${name ? `${name} is writing` : 'being written'}, so the writer never loses track of who's who, where things are and what's been set up. You read each new part of the book as it's written and keep the notes true to it.`;
}

export function notesRequest({ novel, chapterLabel, before, changes, removed, removedChapters, at = 0, of = 0 }) {
  const parts = [];
  const notes = notesText(novel, { forHelper: true });
  parts.push(`The notes as they stand:\n${notes ? notes : '(none yet — this is the start)'}`);
  const about = aboutTheBook(novel, { plans: false });
  if (about) parts.push(about);
  /* where this part sits: a change to an early chapter never turns back where people are "now" */
  if (at && of && at < of) parts.push(`This part is from ${chapterLabel}; the book goes on to Chapter ${numberWords(of)}. Where people are “now” is as of the end of the book, so change a “now” only if this part changes it for good.`);
  if (before && before.trim()) parts.push(`${chapterLabel}, up to the new part (for context — already in the notes):\n${fence(before)}`);
  for (const c of changes) {
    if (c.old) parts.push(`This part of ${chapterLabel} was changed. It used to read:\n${fence(c.old)}\nIt now reads:\n${fence(c.text)}`);
    else parts.push(`New in ${chapterLabel}:\n${fence(c.text)}`);
  }
  for (const r of removed) parts.push(`This part was taken out of ${chapterLabel}, so it no longer happens in the book:\n${fence(r)}`);
  for (const r of removedChapters) parts.push(`A whole chapter was taken out of the book, so none of it happens any more. It held:\n${fence(r)}`);
  parts.push(`Update the notes for what this changes. Answer with one JSON object and nothing else:

{
  "people": [{"name": "…", "aka": ["other names they go by"], "about": "who they are — looks, voice, history, what they want", "now": "where they are and what's going on with them as of the end of the book so far"}],
  "places": [{"name": "…", "about": "…"}],
  "lore": [{"name": "…", "about": "things, facts and rules of the world worth remembering"}],
  "threads": [{"name": "…", "about": "what's been set up and where it stands", "open": true}],
  "gone": [{"kind": "people", "name": "…"}],
  "chapterName": "a short name for ${chapterLabel}, only if it has none yet"
}

Include only entries that are new or changed, each in full — it replaces the old one. Leave out anything that hasn't changed. Keep every fact that's still true. Use "gone" only for an entry that no longer belongs in the book at all (it was only ever in text that's been taken out). Mark a thread "open": false once it's resolved. Write only what the book actually says — never invent.`);
  return parts.join('\n\n');
}

/* A chapter summed up — whole, or (too long for the helper's model) in parts,
 * each part's summary carried into the next. */
export function summaryRequest({ novel, chapterLabel, text, needsName, words, part = 0, parts = 0, soFar = '' }) {
  const size = Math.max(120, Math.min(450, Math.round(words / 12)));
  const lines = [];
  if (part) {
    lines.push(`Here's part ${part} of ${parts} of ${chapterLabel} of ${titled(novel)}:`);
    if (soFar) lines.push(`The summary of the parts before it:\n${fence(soFar)}`);
  } else lines.push(`Here's ${chapterLabel} of ${titled(novel)}:`);
  lines.push(fence(text));
  lines.push(`Summarise ${part ? `the chapter so far — ${soFar ? 'the summary above and this part together' : 'this part'} —` : 'it'} for the book's notes: what happens, in order; who's in it and what changes for them; anything set up for later — a promise, a secret, an object, a question left open. Plain prose, about ${size} words.${needsName ? ' The chapter has no name yet, so give it a short one.' : ''}`);
  lines.push(`Answer with one JSON object and nothing else: {"summary": "…"${needsName ? ', "name": "…"' : ''}}`);
  return lines.join('\n\n');
}

export const JSON_AGAIN = 'That answer could not be read as JSON. Answer again with only the JSON object — no other words, no code fence.';
export const JSON_CUT = 'That answer was cut off before it finished. Answer again with only the JSON object, complete — shorter where you can — with no other words and no code fence.';

/* ---------------------------------------------------- his own instructions */

export function withHis(own, frame) {
  return [String(own || '').trim(), frame].filter(Boolean).join('\n\n');
}
