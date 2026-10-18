/* Cozy Novel — js/novel/textshape.js — how the words of a page are read for
 * their shape (pure; Cozy Tavern's pageshape and prose rules, made for a
 * book). The page drawn, the book sent out (EPUB, Markdown, text) and a book
 * brought in read a scene break and an emphasis the same way. */

/* white space a model sends — every kind but a line break, and the marks of
 * no width at all */
const SP = '(?:[^\\S\\n]|[\\u200b\\u200c\\u200d\\u2060])';
/* an asterisk, or one that only looks like one (∗ ⁎ ＊ ✱) */
const STAR = '[*\\u2217\\u204e\\uff0a\\u2731]';

/* A LINE THAT IS A SCENE BREAK: * * *, ***, ---, ___, #, ⁂, ~~~, ❦, • • • —
 * and a lone asterisk or two, or their look-alikes, with nothing else on the
 * line: the break that lost its shape (Tavern M489, M490). */
export const BREAK_LINE = new RegExp(`^${SP}*(?:${STAR}(?:${SP}*${STAR})*|-{3,}|_{3,}|#|⁂|~{3,}|❦|•${SP}*•${SP}*•)${SP}*$`);
export function isBreakLine(line) { return BREAK_LINE.test(String(line == null ? '' : line)); }

/* *italic* and **bold** start and end on a letter, never on a space or
 * another asterisk (markdown's flanking rule, Tavern M490): "*****" and
 * "* * *" are never drawn as emphasis */
export const STRONG = /\*\*(?=[^\s*])([^*\n]*?[^\s*])\*\*/g;
export const EM = /(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g;

/* A SOFT WRAP IS JOINED (Tavern M476). In a page whose paragraphs are parted
 * by blank lines, a lone line break followed by an indent, or one that leaves
 * a sentence hanging and goes on in lowercase, is a wrap the model let
 * through, not a new paragraph: joined with one space. White space only —
 * never a word; a line of marks (a scene break) is never joined. And a
 * book's own short lines never are (Cozy Tavern M675 §3): a run of three or
 * more short lines (a letter, a song, a list), a block whose every line is
 * indented (verse set in), or the lines under a letter's greeting ("Dear
 * Kara,") keep their breaks. */
const GREETING = /^[ \t]*(?:dear(?:est)?|my\s+dear(?:est)?|to|hello|hi)\b[^\n]{0,60},[ \t]*$/i;
export function joinSoftWraps(text) {
  const given = String(text == null ? '' : text);
  if (!/\n[ \t]*\n/.test(given)) return given;
  const MARK_LINE = new RegExp(`^${SP}*(?:[*\\u2217\\u204e\\uff0a\\u2731_~—–-]+${SP}*)+$`);
  const lines = given.split('\n');
  /* the line breaks that are the book's own: within a run of short lines, an indented block, a letter */
  const own = new Set();
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i++; continue; }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].trim()) j++;
    const block = lines.slice(i, j + 1);
    /* (a line of verse or a list is short; a wrap's lines are a sentence's width — "…than Dev liked —\n  and the thought…" is joined, Cozy Tavern M476) */
    const short = block.length >= 3 && block.slice(0, -1).every((l) => l.trim().length <= 40);
    const indented = block.length >= 2 && block.every((l) => /^[ \t]+\S/.test(l));
    if (short || indented || GREETING.test(block[0])) for (let k = i + 1; k <= j; k++) own.add(k);
    i = j + 1;
  }
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];
    if (own.has(i) || MARK_LINE.test(line) || MARK_LINE.test(prev)) out += '\n' + line;
    else if (/^[ \t]+\S/.test(line) && /\S/.test(prev)) out += ' ' + line.replace(/^[ \t]+/, '');
    else if (/[a-z,;:—–-]$/.test(prev) && /^[a-z]/.test(line)) out += ' ' + line;
    else out += '\n' + line;
  }
  return out;
}

/* THE WRITER'S NOTE TO HIM AT THE END IS NOT THE STORY (Cozy Tavern M510-34,
 * made for a book). A chatty model ends a page with a word to the one asking
 * — "Let me know if you'd like me to continue!", "I hope this captures the
 * scene.", "Word count: 812", an author's note — and it would be kept as the
 * story, read into the notes and printed in the book. Only these leave a
 * page, and only from its end: whole paragraphs that are nothing but such a
 * note (speech is never one, nor a narrator's own question), with a line of
 * marks right above them; four at most, nine hundred characters at most, and
 * only while two hundred characters of story stay. What comes off is kept
 * with the version, and the passage's menu puts it back. */
const TAIL_SEPARATOR = /^[ \t]*(?:[-–—_=~•·*][ \t]*){3,}$/;
/* "What will you do?" is the note; "What would you have done, in her place?"
 * is a narrator's own question — and so is "How do you forgive a man who
 * never asked to be forgiven?" (Cozy Tavern M510-40): a note's question is a
 * short one with a note's verb ("What do you want to happen next?", "How
 * would you like to proceed?"), or one that names the story's next part */
const NOTE_VERB = '(?:do|say|choose|decide|want|think|like|prefer|respond|react|try|proceed|continue)';
const TAIL_META = [
  new RegExp(`^(?:so,?\\s+|now,?\\s+|and\\s+)?(?:what|how|where|which)\\s+(?:will|would|do|does|should|shall|can)\\s+you\\s+${NOTE_VERB}\\b(?:\\s+[^\\s"“”?]+){0,4}\\s*\\?$`, 'i'),
  /^(?=[^"“”]*\byou\b)(?:so,?\s+|now,?\s+|and\s+)?(?:what|how|where|which)\b[^"“”?]{0,120}\b(?:happens?\s+next|next\s+(?:part|scene|chapter|page)|the\s+(?:story|scene|chapter|plot)|this\s+(?:story|scene|chapter))\b[^"“”?]{0,60}\?$/i,
  /^(?:would|do)\s+you\s+(?:like|want)\s+(?:me\s+)?to\b/i,
  /^(?:shall|should)\s+i\s+(?:continue|go\s+on|keep\s+going|proceed|write|carry\s+on)\b/i,
  /^let\s+me\s+know\s+(?:if|what|how|whether|when)\b/i,
  /^feel\s+free\s+to\b/i,
  /^i\s+hope\s+(?:this|that|the\s+(?:scene|page|chapter|response|continuation|passage))\s+(?:captures|works|fits|meets|continues|is\s+what\s+you|helps|flows|feels|reads)\b/i,
  /^i\s+hope\s+you\s+(?:enjoy|like|liked|enjoyed)\b/i,
  /^i(?:'ve|’ve|\s+have)\s+(?:written|kept|tried\s+to|focused\s+on|made\s+sure|included|continued)\b[^"“”]{0,200}\b(?:scene|page|response|story|chapter|tone|pacing|character|continuation|passage)\b/i,
  /^here(?:'s|’s|\s+is)\s+(?:the|your|a)\s+(?:next|continuation|scene|page|chapter|response|passage)\b/i,
  /^(?:ooc|out\s+of\s+character|author'?s?\s+note|author’s\s+note|a\/n|note\s+to\s+(?:the\s+)?(?:writer|reader|user))\s*[:\-—–]/i,
  /^(?:to\s+be\s+continued|end\s+of\s+(?:the\s+)?(?:page|scene|chapter|response|part|passage)|awaiting\s+your\s+(?:response|input|reply))\s*[.!?…]*$/i,
  /^word\s+count\s*[:\-—–]?\s*\d/i,
  /* its check of its own work after the page (Cozy Tavern M322–M326): "Let me check: ✓ … Ship it." — never a
   * narrator's own "Let me check whether the door is locked", a game's "Check — and mate", or "Ship it to the coast" */
  /^(?:let\s+me\s+(?:check|verify|double[-\s]?check|review)\s*[:\-—–]|(?:self[-\s]?|final\s+|quality\s+)?check(?:list)?\s*:|verification\s*:)/i,
  /^let\s+me\s+(?:check|verify|double[-\s]?check|review)\b[^"“”\n]{0,40}?\b(?:scene|page|passage|chapter|draft|rules?|checklist|beats?|prose|pov|tense|word\s+count)\b/i,
  /^ship\s+it[.!…]*$/i,
];
const TAIL_WRAPS = /^[\s>*_~#(\[]+|[\s*_~)\].]+$/g;
function tailIsNote(para) {
  const raw = String(para || '').trim();
  if (!raw || raw.length > 400) return false;
  /* speech is story */
  if (/^[\s>*_~(\[]*["“'‘]/.test(raw) || /["“][^"”\n]{2,}["”]/.test(raw)) return false;
  const b = raw.replace(TAIL_WRAPS, '').trim() + (/[?!]$/.test(raw.replace(/[\s*_~)\]]+$/, '')) ? raw.replace(/[\s*_~)\]]+$/, '').slice(-1) : '');
  const bare = b.replace(/([?!])\1$/, '$1');
  const isNote = (x) => TAIL_META.some((re) => re.test(x)) || /^let\s+me\s+know[.!…]*$/i.test(x);
  if (isNote(bare)) return true;
  /* a checklist of its own: two ticks or more */
  if ((raw.match(/[✓✔☑]/g) || []).length >= 2) return true;
  /* a paragraph of a few sentences, every one of them a note ("Want more? Let me know!") */
  const sentences = bare.split(/(?<=[.!?…])\s+/).map((x) => x.replace(TAIL_WRAPS, '').trim()).filter(Boolean);
  if (sentences.length > 1 && sentences.length <= 4 && sentences.every((x) => isNote(x.replace(/([?!])\1$/, '$1')) || isNote(x + (/[?!.]$/.test(x) ? '' : '?')))) return true;
  /* a paragraph wholly in brackets, to "you", about the writing itself */
  if (/^[\s*_]*[(\[][^\n|]{3,300}[)\]][\s*_.!?]*$/.test(raw) && /\byou(?:r)?\b/i.test(raw) && /\b(?:continue|next part|next chapter|this (?:scene|passage|chapter|page)|the story so far|let me know|feel free|word count|response)\b/i.test(raw)) return true;
  return false;
}
/* THE TRACKING A PRESET ASKS FOR IS NOT THE STORY EITHER (Cozy Tavern's
 * house rules, M524): the Plot Momentum block in <details>, the
 * {PULSE}/{WATCHLIST}/{VOICES} blocks — wherever they stand — and a block of
 * tags of the model's own making with tags inside it (<status> <Mara>…
 * </status>) at the very end. The notes keep track of the story; these come
 * off and are kept with the version too. HTML a page may truly carry (a
 * <div>, a <table>, an <em>) is never one. */
const MOMENTUM = /\n*<details>\s*<summary>\s*Plot Momentum\s*<\/summary>[\s\S]*?<\/details>[ \t]*/gi;
const STATE_BLOCKS = /\n*\{(PULSE|WATCHLIST|VOICES)\}[\s\S]*?\{\/\1\}[ \t]*/g;
const TAG_TAIL = /\n*<(?!(?:div|span|p|br|b|i|em|strong|u|s|small|sub|sup|font|table|tr|td|th|thead|tbody|ul|ol|li|img|a|h[1-6]|details|summary|blockquote|pre|code|hr|center|section|article|header|footer|style|script|mark|q|cite|abbr|figure|figcaption|audio|video|source|iframe)\b)([a-z][\w-]*)>(?=[\s\S]*?<[a-z][\w -]{0,40}>)[\s\S]*?<\/\1>\s*$/i;
export function finishTail(text, { minLeft = 200 } = {}) {
  const given = String(text == null ? '' : text);
  let page = given.replace(/\s+$/, '');
  const story = (t) => t.replace(/\s+/g, ' ').trim().length >= minLeft;
  const taken = [];
  /* the tracking first — with a line of marks it stood under — while two
   * hundred characters of story stay */
  const blocks = [];
  let rest = page.replace(MOMENTUM, (m) => { blocks.push(m.trim()); return '\n\n'; }).replace(STATE_BLOCKS, (m) => { blocks.push(m.trim()); return '\n\n'; });
  const tm = TAG_TAIL.exec(rest);
  if (tm) { blocks.push(tm[0].trim()); rest = rest.slice(0, tm.index); }
  let tracking = false;
  if (blocks.length) {
    /* the white space it began with stays its own (Go on: a new paragraph is still one) */
    const ps = rest.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, given.match(/^\n*/)[0]).replace(/\s+$/, '').split(/\n[ \t]*\n/);
    const dress = [];
    while (ps.length > 1 && TAIL_SEPARATOR.test(ps[ps.length - 1].trim())) dress.unshift(ps.pop().trim());
    const left = ps.join('\n\n');
    if (story(left)) { page = left; taken.push(...dress, ...blocks); tracking = true; }
  }
  /* then a note to him at the end */
  const paras = page.split(/\n[ \t]*\n/);
  const tail = [];
  let notes = 0;
  while (paras.length > 1 && tail.length < 4) {
    const last = paras[paras.length - 1];
    if (!last.trim()) { paras.pop(); continue; }
    const note = tailIsNote(last);
    /* a line of marks goes only with a note below it */
    if (!note && !(notes && TAIL_SEPARATOR.test(last.trim()))) break;
    if (note) notes++;
    tail.unshift(last.trim());
    paras.pop();
  }
  const left = paras.join('\n\n').replace(/\s+$/, '');
  const noted = notes > 0 && tail.join('\n').length <= 900 && story(left);
  if (noted) { page = left; taken.push(...tail); }
  if (!taken.length) return { text: given, removed: '', kinds: [] };
  /* what came off, in the order it stood */
  const at = (piece) => { const i = given.indexOf(piece); return i < 0 ? Infinity : i; };
  const inOrder = taken.map((piece, k) => ({ piece, k, i: at(piece) })).sort((a, b) => a.i - b.i || a.k - b.k).map((x) => x.piece);
  return { text: page, removed: inOrder.join('\n\n'), kinds: [...(tracking ? ['tracking'] : []), ...(noted ? ['note'] : [])] };
}

/* A HEADING ABOVE A NEW PAGE IS NOT THE STORY (Cozy Tavern M116). The
 * writer is told never to title a page; one that does anyway ("# Chapter
 * Three: The Storm", "**Chapter 3**", "## The Scene", the chapter's own name
 * on a line of its own) had it kept as the page's first line — drawn inside
 * the chapter, sent back as story on every later page, printed twice in a
 * book sent out. Only a first line that is nothing but such a heading — a
 * Markdown heading, or a chapter's or part's heading, or the chapter's name,
 * in bold or not — with story after it; a line of marks is a scene break and
 * stays. What comes off is kept with the version (Put back). */
const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final';
const CHAPTER_HEAD = new RegExp(`^(?:chapter|ch\\.|part|book|prologue|epilogue|interlude)(?:\\s+(?:\\d+|[ivxlcdm]+|(?:${NUMBER_WORDS})(?:[\\s-]+(?:${NUMBER_WORDS}))*))?\\s*(?:[:.—–-]+\\s*\\S.{0,100})?$`, 'i');
export function dropHeading(text, { names = [], minLeft = 200 } = {}) {
  const given = String(text == null ? '' : text);
  const none = { text: given, removed: '' };
  const m = /^\s*([^\n]+)\n/.exec(given);
  if (!m) return none;
  const line = m[1].trim();
  if (isBreakLine(line) || line.length > 160) return none;
  const md = /^#{1,6}\s+\S/.test(line);
  const bare = line.replace(/^#{1,6}\s+/, '').replace(/\s*#+$/, '').replace(/^(\*\*|__)(.+)\1$/, '$2').replace(/^(\*|_)(.+)\1$/, '$2').trim();
  const fold = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const named = names.some((n) => fold(n) && fold(n) === fold(bare));
  if (!bare || !(md || named || CHAPTER_HEAD.test(bare))) return none;
  const rest = given.slice(m.index + m[0].length).replace(/^\s+/, '');
  if (rest.replace(/\s+/g, ' ').trim().length < minLeft) return none;
  return { text: rest, removed: line };
}

/* A PLAN OR A DRAFT ABOVE THE PAGE IS NOT THE STORY (Cozy Tavern M322–M326,
 * M339). A model writing with its thinking off may plan the page on the page
 * — "Plan:", "Beats:", "Outline:", "Draft 1:", a checklist — and only then
 * write it; kept, the plan is read as story by the helper and sent back to
 * the writer as the chapter, teaching it to plan on the page again. Only a
 * block at the very top that opens with such a label: when it wrote drafts or
 * a "Final:", everything up to the last of those labels; else up to a line
 * that only parts it from the story (---, * * *) in the first half of the
 * page; else its own lines of points and labels. Kept with the version (Put
 * back). A story may open on a line of that shape — "My plan: wait for
 * dark.", a narrator's own list — so a label with "my" or "the" before it is
 * the story's, and so is a label with nothing after it but the story (no
 * points, no line parting them, no drafts): kept as it came. */
const PLAN_WORD = '(?:plan(?:ning)?|outline|beats?|beat\\s+sheet|approach|(?:first\\s+|rough\\s+)?draft(?:\\s*#?\\d+)?|self[-\\s]?check|checklist|thinking|reasoning|analysis|notes?\\s+(?:for|on)\\s+(?:this|the)\\s+(?:scene|passage|chapter|page))';
const PLAN_HEAD = new RegExp(`^[\\s>*_#]*(?:scene\\s+|page\\s+|chapter\\s+)?${PLAN_WORD}\\s*(?:\\([^)\\n]{0,40}\\)\\s*)?[*_]*\\s*:`, 'i');
const PLAN_POINT = /^\s*(?:[-*•–+]\s+\S|\d{1,2}[.)]\s+\S|\[[ xX✓]\]\s*\S|[✓✔☑✗✘]\s*\S|[A-Z][A-Za-z'’ ]{0,30}:\s+\S)/;
const PLAN_LAST = /^[\s>*_#]*(?:final(?:\s+(?:version|draft|page|text|passage))?|revised(?:\s+(?:version|draft))?|(?:draft|version|take)\s*#?\d+|the\s+(?:page|passage|scene)(?:\s+itself)?)\s*[*_]*\s*:[*_\s]*$/i;
export function dropPlan(text, { minLeft = 200 } = {}) {
  const given = String(text == null ? '' : text);
  const none = { text: given, removed: '' };
  const lines = given.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || !PLAN_HEAD.test(lines[i])) return none;
  const starts = [];
  for (let k = 0, pos = 0; k < lines.length; k++) { starts.push(pos); pos += lines[k].length + 1; }
  let end = -1;
  /* drafts, or a "Final:": the page is what follows the last of them */
  for (let k = lines.length - 1; k > i; k--) if (PLAN_LAST.test(lines[k])) { end = k + 1; break; }
  /* a line that only parts the plan from the story, in the first half of the page — what stands above it
   * shaped like a plan (a label alone on its line, points, or a line or two), never a story's first scene
   * that happens to open on "Thinking: …" */
  if (end < 0) {
    for (let k = i + 1; k < lines.length && starts[k] < given.length / 2; k++) {
      if (!isBreakLine(lines[k])) continue;
      const block = lines.slice(i, k);
      if (/:[*_\s]*$/.test(lines[i]) || block.slice(1).some((l) => PLAN_POINT.test(l)) || block.join('\n').trim().length <= 400) end = k + 1;
      break;
    }
  }
  /* its own lines: points and labels, and the blank lines between */
  if (end < 0) {
    end = i + 1;
    let points = 0;
    for (let k = i + 1; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (!PLAN_POINT.test(lines[k]) && !PLAN_HEAD.test(lines[k])) break;
      end = k + 1;
      points++;
    }
    /* a label with no points under it ("Plan: wait for dark.", "The plan:") and the story straight after:
     * no plan can be told from the story — kept as it came (Cozy Tavern M324) */
    if (!points) return none;
  }
  const rest = lines.slice(end).join('\n').replace(/^\s+/, '');
  if (rest.replace(/\s+/g, ' ').trim().length < minLeft) return none;
  return { text: rest, removed: lines.slice(i, end).join('\n').trim() };
}
/* what stands above the story — a plan, then a heading — taken off together:
 * {text, removed, plan, heading} */
export function dropTop(text, { names = [], minLeft = 200 } = {}) {
  const plan = dropPlan(text, { minLeft });
  const head = dropHeading(plan.text, { names, minLeft });
  return { text: head.text, removed: [plan.removed, head.removed].filter(Boolean).join('\n\n'), plan: Boolean(plan.removed), heading: Boolean(head.removed) };
}

/* THE MARKS A MODEL LEFT OPEN ARE CLOSED (Cozy Tavern M458, M476, M490 —
 * made for a book, where each line is a paragraph). A paragraph that opens a
 * quotation and never closes it gets its close at its end — unless the next
 * paragraph opens with one (one speaker going on, a novel's way), or a later
 * one closes it (a letter, a song, a speech written over several lines); an
 * empty pair of quotes goes; a lone asterisk that opens an emphasis is closed
 * where its stretch ends. Marks only — never a word: a quote is never taken
 * out (after a dialogue tag, "maybe later" is speech going on, not a stray),
 * and italics stay italics (in a novel they carry thoughts). A scene break
 * and a heading are left as they are; so is every paragraph that begins
 * before `from` (Go on: only what is new), and the last one of a page that
 * was cut (`leaveLast`: it is not finished — Go on finishes it).
 *
 * THE MARKS OF SPEECH PAIR UP (Cozy Tavern M753, 2.12.34 — his page: `"Tck. Tck. "You did not look at her…`, under a
 * green light). Through 2.12.33 only a quote left open at the END of a paragraph was seen; one opened mid-line while
 * another was still open, or a close with nothing open, stood on the page, and the checker was never told. Now each
 * paragraph's speech marks are read in order, each by where it stands (a quote before a word opens, after one closes;
 * a curly mark by its own face where its place says nothing). Where they do not pair, the one mark standing where the
 * missing quote belongs is made that quote when it alone makes every pair whole — a lone asterisk, or a single quote
 * after the punctuation that ends a spoken line; a pair written in two kinds ("…” or “…") is written in one, and a
 * curly mark facing the wrong way is turned. Speech wrapped in asterisks too (*"…"*: the sound law's two lanes never
 * mixed) loses the asterisks. What no mark accounts for — a quote simply left out — is left as it is, and found
 * (speechFaults) for the checker to set. */
const HEADING_LINE = /^\s{0,3}#{1,4}\s+\S/;
const OPENS_BEFORE = /[\s(\[—–-]/;
function straightOpens(line, at) { return (at === 0 || OPENS_BEFORE.test(line[at - 1])) && /\S/.test(line[at + 1] || ''); }
function quotesAt(line) { const at = []; for (let i = 0; i < line.length; i++) if (line[i] === '"') at.push(i); return at; }
/* a later paragraph closes the quotation this one left open (before another opens) */
function closedLater(lines, i, curly) {
  for (let k = i + 1, seen = 0; k < lines.length && seen < 8; k++) {
    const l = lines[k];
    if (!l.trim()) continue;
    if (isBreakLine(l)) return false;
    seen++;
    if (curly) {
      let depth = 0;
      for (const ch of l) { if (ch === '“') depth++; else if (ch === '”') { if (depth) depth--; else return true; } }
      if (depth > 0) return false;
    } else {
      const at = quotesAt(l);
      if (at.length % 2 === 1) return !straightOpens(l, at[0]);
    }
  }
  return false;
}
const OPENER_BEFORE = /[\s(\[{—–-]/; /* what may stand right before an opening quote */
const CLOSER_AFTER = /[\s.,!?;:)\]}…—–-]/; /* what may stand right after a closing quote */
const SPOKEN = /["“”]/;
const OTHER_LANGUAGE = /[„«»]/; /* „…“ and «…» keep their own language's rules */
const blankAt = (text, i) => i < 0 || i >= text.length || /\s/.test(text[i]);
/* where a mark stands says what it is: before a word it opens, after one it closes; between two words, or between two
 * spaces, its place says nothing ('either') */
function placeOf(text, i) {
  const prevBlank = blankAt(text, i - 1);
  const nextBlank = blankAt(text, i + 1);
  const opens = (prevBlank || OPENER_BEFORE.test(text[i - 1])) && !nextBlank;
  const closes = !prevBlank && (nextBlank || CLOSER_AFTER.test(text[i + 1]));
  return opens && !closes ? 'open' : closes && !opens ? 'close' : 'either';
}
/* the double quotes of a paragraph, in order — a quote right after a figure is a measure (5'9", a 12" blade), not speech */
export function speechMarks(text) {
  const src = String(text == null ? '' : text);
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (!SPOKEN.test(c)) continue;
    if (c === '"' && /\d/.test(src[i - 1] || '')) continue;
    const face = c === '“' ? 'open' : c === '”' ? 'close' : 'either';
    const place = placeOf(src, i);
    out.push({ at: i, curly: c !== '"', face, role: place !== 'either' ? place : face });
  }
  return out;
}
/* the marks walked in order: the pairs they make, and how many places do not pair (goesOn: the speech left open goes
 * on in the paragraph after — the next one speaks, or a later one closes it) */
export function pairWalk(marks, goesOn = false) {
  let open = null;
  let faults = 0;
  const pairs = [];
  const bad = [];
  for (const m of marks) {
    if (m.role === 'open' || (m.role === 'either' && !open)) {
      if (open) { faults += 1; bad.push(m.at); } /* a speech opened while the last one never closed */
      open = m;
    } else {
      if (!open) { faults += 1; bad.push(m.at); continue; } /* a close with nothing open */
      pairs.push([open, m]);
      open = null;
    }
  }
  if (open && !goesOn) { faults += 1; bad.push(open.at); }
  return { faults, pairs, open, bad };
}
const EMPHASIS_PAIR = /(?<!\*)\*(?=[^\s*])[^*\n]*?[^\s*]\*(?!\*)/g;
function loneAsterisks(text) {
  const taken = new Set();
  for (const m of text.matchAll(EMPHASIS_PAIR)) { taken.add(m.index); taken.add(m.index + m[0].length - 1); }
  const out = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '*' && text[i - 1] !== '*' && text[i + 1] !== '*' && !taken.has(i)) out.push(i);
  return out;
}
const wordChar = (c) => /[\p{L}\p{N}]/u.test(c || '');
/* the marks that may stand where a lost quote belongs, each with the part it would play */
function standIns(text) {
  const out = [];
  const lone = loneAsterisks(text);
  if (lone.length === 1) {
    const i = lone[0];
    const prevBlank = blankAt(text, i - 1);
    const nextBlank = blankAt(text, i + 1);
    if (!prevBlank && (nextBlank || CLOSER_AFTER.test(text[i + 1]))) out.push({ at: i, as: 'close' });
    else if ((prevBlank || OPENER_BEFORE.test(text[i - 1])) && !nextBlank) out.push({ at: i, as: 'open' });
  }
  /* a single quote stands in only after the punctuation that ends a spoken line, with nothing after it but a space or
   * the paragraph's end, and only when no other single quote stands in it to pair with (never an apostrophe in a word,
   * never the plural's "boys' ", never a quotation inside the speech) */
  const singles = [];
  for (let i = 0; i < text.length; i += 1) if (/['‘’]/.test(text[i]) && !(wordChar(text[i - 1]) && wordChar(text[i + 1]))) singles.push(i);
  if (singles.length === 1) {
    const i = singles[0];
    if (/[,.!?…—–-]/.test(text[i - 1] || '') && blankAt(text, i + 1)) out.push({ at: i, as: 'close' });
  }
  return out;
}
function quoteFor(marks, at, as) {
  if (as === 'close') {
    const before = pairWalk(marks.filter((m) => m.at < at), true);
    return before.open ? (before.open.curly ? '”' : '"') : '';
  }
  const next = marks.find((m) => m.at > at);
  return next && next.curly ? '“' : '"';
}
export function pairSpeech(text, goesOn = false) {
  const src = String(text == null ? '' : text);
  if (!SPOKEN.test(src) || OTHER_LANGUAGE.test(src)) return src;
  let out = src;
  let marks = speechMarks(out);
  let walk = pairWalk(marks, goesOn);
  if (walk.faults) {
    const whole = [];
    for (const c of standIns(src)) {
      const q = quoteFor(marks, c.at, c.as);
      if (!q) continue;
      const tried = src.slice(0, c.at) + q + src.slice(c.at + 1);
      if (!pairWalk(speechMarks(tried), goesOn).faults) whole.push(tried);
    }
    if (whole.length !== 1) return src; /* no mark accounts for it, or more than one could: as it came */
    out = whole[0];
    marks = speechMarks(out);
    walk = pairWalk(marks, goesOn);
  }
  /* every pair in one kind, every curly mark facing the part it plays */
  const curly = marks.filter((m) => m.curly).length;
  const straight = marks.length - curly;
  const chars = out.split('');
  for (const [o, c] of walk.pairs) {
    if (o.curly === c.curly && (!o.curly || (o.face === 'open' && c.face === 'close'))) continue;
    const asCurly = o.curly === c.curly ? o.curly : curly > straight ? true : curly < straight ? false : o.curly;
    chars[o.at] = asCurly ? '“' : '"';
    chars[c.at] = asCurly ? '”' : '"';
  }
  if (walk.open && walk.open.curly && walk.open.face !== 'open') chars[walk.open.at] = '“'; /* a long speech's open mark, facing in */
  return chars.join('');
}
/* an asterisk opened and never closed is closed at the end of the stretch it opened in — the page reads emphasis inside
 * one line of speech or one stretch of narration, never across a quote (M753: closed at the paragraph's end,
 * '"I *mean it," she said.*' showed two stray asterisks where there had been one). Speech that does not pair leaves no
 * place to know: the asterisk is left as it is. */
function closeEmphasis(line, goesOn) {
  let single = -1;
  let count = 0;
  for (let i = 0; i < line.length; i += 1) if (line[i] === '*' && line[i - 1] !== '*' && line[i + 1] !== '*') { count += 1; single = i; }
  if (!(count % 2 === 1 && single !== -1 && (single === 0 || /\s/.test(line[single - 1])) && /\S/.test(line[single + 1] || ''))) return line;
  const marks = speechMarks(line);
  if (!marks.some((m) => m.at > single)) return line + '*';
  const walk = pairWalk(marks, goesOn);
  if (walk.faults) return line;
  const inside = walk.pairs.find(([o, c]) => o.at < single && single < c.at);
  if (inside) return line.slice(0, inside[1].at) + '*' + line.slice(inside[1].at);
  if (walk.open && walk.open.at < single) return line + '*';
  const opener = walk.pairs.map(([o]) => o).concat(walk.open ? [walk.open] : []).filter((m) => m.at > single).sort((a, b) => a.at - b.at)[0];
  if (!opener) return line + '*';
  let end = opener.at;
  while (end > single + 1 && /\s/.test(line[end - 1])) end -= 1;
  return end > single + 1 ? line.slice(0, end) + '*' + line.slice(end) : line;
}
/* what follows a paragraph, for whether a speech left open in it goes on */
function goesOnAt(lines, i) {
  let next = '';
  for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) { next = isBreakLine(lines[k]) ? '' : lines[k]; break; }
  const nextSpeaks = /^\s*[*_]*[“"]/.test(next);
  return { nextSpeaks, curlyLater: closedLater(lines, i, true), straightLater: closedLater(lines, i, false) };
}
/* one paragraph's marks made whole (its words never) */
function mendCore(core0, { nextSpeaks, curlyLater, straightLater }) {
  let core = core0;
  /* an empty pair of quotes goes, with the one space it leaves */
  const noEmpty = core.replace(/(^|[ \t(])(?:""|“[ \t]*”)(?=[ \t.,!?;:)]|$)/g, (m, pre) => (pre === ' ' || pre === '\t' ? '' : pre));
  if (noEmpty !== core) core = noEmpty.replace(/^[ \t]+/, '');
  /* speech wrapped in asterisks: the quote alone (M458) */
  core = core.replace(/\*+[ \t]*(["“][^"“”\n]*["”])[ \t]*\*+/g, '$1');
  const goesOn = nextSpeaks || curlyLater || straightLater;
  core = pairSpeech(core, goesOn);
  const opens = (core.match(/“/g) || []).length;
  const closes = (core.match(/”/g) || []).length;
  if (opens === closes + 1 && core.lastIndexOf('“') > core.lastIndexOf('”') && !nextSpeaks && !curlyLater && !OTHER_LANGUAGE.test(core)) core += '”';
  const straight = quotesAt(core);
  if (straight.length % 2 === 1 && !nextSpeaks && straightOpens(core, straight[straight.length - 1]) && !straightLater) core += '"';
  return closeEmphasis(core, goesOn);
}
export function mendMarks(text, { from = 0, leaveLast = false } = {}) {
  const given = String(text == null ? '' : text);
  if (!/["“”*]/.test(given)) return { text: given, changed: false };
  const lines = given.split('\n');
  let last = -1;
  if (leaveLast) for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) { last = i; break; }
  let pos = 0;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const start = pos;
    pos += lines[i].length + 1;
    const line = lines[i];
    if (start < from || i === last || !line.trim() || isBreakLine(line) || HEADING_LINE.test(line)) continue;
    const lead = line.match(/^\s*/)[0];
    const tail = line.slice(lead.length).match(/\s*$/)[0];
    const core = mendCore(line.slice(lead.length, line.length - tail.length), goesOnAt(lines, i));
    const mended = core ? lead + core + tail : '';
    if (mended !== line) { lines[i] = mended; changed = true; }
  }
  return changed ? { text: lines.join('\n'), changed: true } : { text: given, changed: false };
}
/* A PAGE THAT CAME AS ONE BLOCK IS PARTED WHERE SPEECH BEGINS (Cozy Tavern M510-17 partParagraphs, 2.12.34): a new
 * page of more than 900 characters with not one paragraph break is parted before each line of speech that opens after
 * a finished sentence — white space only, never a word. A page that has its paragraphs is left as it is. */
export function partBlock(text) {
  const given = String(text == null ? '' : text);
  const trimmed = given.trim();
  if (trimmed.length <= 900 || /\n/.test(trimmed)) return { text: given, changed: false };
  const parted = trimmed.replace(/([.!?…]["”’)]?)[ \t]+(?=["“][^\s])/g, '$1\n\n');
  return parted === trimmed ? { text: given, changed: false } : { text: given.replace(trimmed, parted), changed: true };
}
/* an edit that only ADDS speech marks — every character kept, in order, and nothing new but a quotation mark — is the
 * only edit the marks' mender may make (Cozy Tavern M753) */
export function insertsOnlyMarks(before, after) {
  const a = String(before == null ? '' : before);
  const b = String(after == null ? '' : after);
  if (b.length <= a.length) return false;
  let i = 0;
  for (let j = 0; j < b.length; j += 1) {
    if (i < a.length && a[i] === b[j]) { i += 1; continue; }
    if (!/["“”]/.test(b[j])) return false;
  }
  return i === a.length;
}
/* THE PARAGRAPHS WHOSE SPEECH MARKS DO NOT PAIR (Cozy Tavern M753 speechFaults, for a book): [{start, end, line,
 * mended}] — each paragraph's place in the words, its words, and the paragraph as the repair would leave it when that
 * alone pairs every mark (mended, '' when only a reading of the sentence can say where the quote belongs). A scene
 * break, a heading, a paragraph in „…“ or «…», and a speech going on into the paragraph after are not faults. */
export function speechFaults(text) {
  const given = String(text == null ? '' : text);
  if (!SPOKEN.test(given)) return [];
  const lines = given.split('\n');
  const out = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const start = pos;
    const line = lines[i];
    pos += line.length + 1;
    if (!SPOKEN.test(line) || OTHER_LANGUAGE.test(line) || isBreakLine(line) || HEADING_LINE.test(line)) continue;
    const at = goesOnAt(lines, i);
    const goesOn = at.nextSpeaks || at.curlyLater || at.straightLater;
    const walk = pairWalk(speechMarks(line), goesOn);
    if (!walk.faults) continue;
    const lead = line.match(/^\s*/)[0].length;
    const tail = line.length - line.trimEnd().length;
    const core = line.slice(lead, line.length - tail);
    const fixed = mendCore(core, at);
    /* where it first goes wrong, with a few words either side: what a card marks */
    const k = walk.bad[0];
    const near = line.slice(Math.max(lead, k - 28), Math.min(line.length - tail, k + 28)).replace(/^\S*\s+(?=\S)/, (m) => (k - 28 > lead ? '' : m)).replace(/\s+\S*$/, (m) => (k + 28 < line.length - tail ? '' : m));
    out.push({ start: start + lead, end: start + line.length - tail, line: core, goesOn, near: near.trim(), mended: fixed !== core && !pairWalk(speechMarks(fixed), goesOn).faults ? fixed : '' });
  }
  return out;
}
/* the smallest stretch of `text` that one change makes, from `start` to `end` replaced by `next` — a few words either
 * side, enough to stand in only one place in the text: {find, replace, start, end} (a card shows only what changed) */
export function changeSpan(text, start, end, next) {
  const src = String(text == null ? '' : text);
  const was = src.slice(start, end);
  const now = String(next == null ? '' : next);
  let a = 0;
  while (a < was.length && a < now.length && was[a] === now[a]) a++;
  let b = 0;
  while (b < was.length - a && b < now.length - a && was[was.length - 1 - b] === now[now.length - 1 - b]) b++;
  for (let words = 2; ; words += 2) {
    let s = start + a;
    let e = start + was.length - b;
    for (let k = 0; k < words && s > start; ) { s--; if (/\s/.test(src[s]) && !/\s/.test(src[s + 1] || '')) k++; }
    while (s > start && !/\s/.test(src[s - 1])) s--;
    for (let k = 0; k < words && e < end; ) { if (/\s/.test(src[e]) && !/\s/.test(src[e - 1] || '')) k++; e++; }
    while (e < end && !/\s/.test(src[e])) e++;
    while (s < e && /\s/.test(src[s])) s++;
    while (e > s && /\s/.test(src[e - 1])) e--;
    const find = src.slice(s, e);
    const replace = now.slice(s - start, now.length - (end - e));
    const unique = src.indexOf(find) === src.lastIndexOf(find);
    if ((unique && find.trim()) || (s === start && e === end)) return { find, replace, start: s, end: e };
  }
}

/* A STRAY OF ANOTHER SCRIPT GLUED TO THE FRONT OF A WORD COMES OFF (Cozy
 * Tavern M626). A model trained on another language slips a token of it in
 * front of the English word it meant ("吃eat"): the word is there, so the
 * stray is noise. Only that shape — one to four characters right before a
 * Latin letter, never inside a word — on a page that is Latin nearly whole
 * (two hundred letters at least, four such characters at most: a phrase a
 * character speaks in another language is longer, and stays). Only what
 * stands at or after `from` (Go on: only what is new). */
const STRAY = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Cyrillic}\\p{Script=Arabic}\\p{Script=Thai}\\p{Script=Hebrew}]';
export function dropGluedStrays(text, { from = 0 } = {}) {
  const src = String(text == null ? '' : text);
  const all = src.slice(from).match(new RegExp(STRAY, 'gu')) || [];
  if (!all.length || all.length > 4) return { text: src, changed: false };
  if ((src.match(/\p{L}/gu) || []).length < 200) return { text: src, changed: false };
  const out = src.replace(new RegExp('(?<![\\p{L}\\p{N}])' + STRAY + '{1,4}(?=\\p{Script=Latin})', 'gu'), (m, at) => (at >= from ? '' : m));
  return { text: out, changed: out !== src };
}

/* WEB PAGE AND CODE MARKUP LEFT LOOSE IS NEVER THE STORY (his report,
 * 2.12.2: a page that ended "…everybody paid for.</code>"). A model that has
 * read the web leaves its marks in prose, and the page shows every one of
 * them as it is:
 *  - a tag standing alone — one that closes what was never opened, or opens
 *    what is never closed ("</code>" after the last sentence) — comes off;
 *  - code's own marks (<code>, <pre>, <kbd>…) and a paragraph's (<p>) come
 *    off around their words, which stay; a line that opens or closes a block
 *    of code (```) comes off;
 *  - italics and bold written as tags become the book's own (*it*, **it**),
 *    a line break written as a tag a line break, an escaped character
 *    (&amp;, &mdash;) the character.
 * HTML a page may truly carry — a <div> or a <table> around its words, opened
 * and closed (finishTail, Cozy Tavern M524) — stays, and so does what only
 * looks like a tag: a game's window ("<Level Up!>", "<Skill: Fireball>"), a
 * heart ("<3"). Only what stands at or after `from` (Go on: only what is new). */
const TAG_NAMES = 'a|abbr|article|b|big|blockquote|body|br|center|cite|code|del|div|em|font|footer|h[1-6]|head|header|hr|html|i|img|ins|kbd|li|main|mark|nav|ol|p|pre|q|s|samp|section|small|span|strike|strong|sub|sup|table|tbody|td|th|thead|tr|tt|u|ul|var';
const WEB_TAG = new RegExp(`<(\\/?)(${TAG_NAMES})(?:\\s[^<>\\n]{0,200})?\\s*(\\/?)>`, 'gi');
const FENCE_LINE = /^[ \t]*```[\w-]*[ \t]*$/gm;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', '#39': "'", '#x27': "'", '#8217': '’', '#8216': '‘', '#8220': '“', '#8221': '”', '#8212': '—', '#8211': '–', '#8230': '…', '#160': ' ' };
const ENTITY = /&(amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|#39|#x27|#8217|#8216|#8220|#8221|#8212|#8211|#8230|#160);/g;
const VOID = new Set(['br', 'hr', 'img']);
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'tt', 'var']);
const EMPHASIS = { i: '*', em: '*', b: '**', strong: '**' };
/* every tag of a web page in the words, paired where it is: [{start, end, name, close, pair, what}] — what: 'keep'
 * (HTML the page carries), 'stray', 'code' and 'p' (off, words kept), 'br', 'hr', 'img', or 'em' (the book's marks) */
function tagsIn(t) {
  const tags = [...t.matchAll(WEB_TAG)].map((m) => ({ start: m.index, end: m.index + m[0].length, name: m[2].toLowerCase(), close: m[1] === '/', self: m[3] === '/', raw: m[0] }));
  const open = new Map();
  for (const x of tags) {
    if (VOID.has(x.name)) { x.what = x.close ? 'stray' : x.name; continue; }
    if (x.self) { x.what = 'stray'; continue; }
    if (!x.close) { if (!open.has(x.name)) open.set(x.name, []); open.get(x.name).push(x); continue; }
    const list = open.get(x.name);
    const o = list && list.pop();
    if (!o) { x.what = 'stray'; continue; }
    o.pair = x; x.pair = o;
    const kind = EMPHASIS[x.name] ? 'em' : CODE_TAGS.has(x.name) ? 'code' : x.name === 'p' ? 'p' : 'keep';
    o.what = kind; x.what = kind;
  }
  for (const list of open.values()) for (const o of list) o.what = 'stray';
  /* a paragraph's marks, paired or not, part paragraphs ("…said.</p>\n<p>The gate…") */
  for (const x of tags) if (x.name === 'p') x.what = 'p';
  return tags;
}
const changes = (x) => x.what !== 'keep';
export function hasMarkup(text) {
  const t = String(text == null ? '' : text);
  if (!/[<&`]/.test(t)) return false;
  FENCE_LINE.lastIndex = 0; ENTITY.lastIndex = 0;
  const out = FENCE_LINE.test(t) || ENTITY.test(t) || tagsIn(t).some(changes);
  FENCE_LINE.lastIndex = 0; ENTITY.lastIndex = 0;
  return out;
}
function cleanMarkup(given) {
  /* escaped characters first — but for what would read as a tag once unescaped, which waits for the tags */
  const t = String(given).replace(ENTITY, (m, name) => (['lt', 'gt', 'amp'].includes(name) ? m : ENTITIES[name] || m));
  const tags = tagsIn(t).filter(changes);
  let x = '';
  let at = 0;
  for (const g of tags) {
    let put = '';
    let before = t.slice(at, g.start);
    let skip = 0;
    if (g.what === 'br') {
      put = '\n';
      before = before.replace(/[ \t]+$/, '');
      skip = t.slice(g.end).match(/^[ \t]*/)[0].length;
    } else if (g.what === 'p') {
      put = '\n\n';
      before = before.replace(/[ \t]+$/, '');
      skip = t.slice(g.end).match(/^[ \t]*/)[0].length;
    }
    else if (g.what === 'em') {
      /* the book's marks hug the words they mark: spaces inside the tags go outside them, once */
      const mark = EMPHASIS[g.name];
      const inner = g.close ? t.slice(g.pair.end, g.start) : t.slice(g.end, g.pair.start);
      if (inner.trim()) {
        if (g.close) {
          const moved = /\s$/.test(inner);
          before = before.replace(/\s+$/, '');
          const next = t[g.end];
          put = mark + (moved && next !== undefined && !/[\s,.;:!?…’”)\]]/.test(next) ? ' ' : '');
        } else {
          const moved = /^\s/.test(inner);
          put = (moved && !/\s$/.test(x + before) && (x + before) ? ' ' : '') + mark;
          skip = t.slice(g.end).match(/^\s*/)[0].length;
        }
      }
    }
    /* a tag between two words leaves one space; at a line's edge, or before a mark, none */
    if (!put && g.what !== 'p') {
      const prev = x + before;
      const nextCh = t[g.end];
      const edge = !prev || /\n[ \t]*$/.test(prev) || nextCh === undefined || nextCh === '\n';
      const tight = /[,.;:!?…’”)\]]/.test(nextCh || '') || /[(\[“‘]$/.test(prev);
      if (/[ \t]$/.test(prev) && /^[ \t]/.test(t.slice(g.end))) skip = t.slice(g.end).match(/^[ \t]+/)[0].length;
      else if (!edge && !tight && !/[ \t]$/.test(prev) && !/^[ \t]/.test(t.slice(g.end))) put = ' ';
      if (edge || tight) { before = before.replace(/[ \t]+$/, ''); if (!edge || nextCh === undefined || nextCh === '\n') skip = (t.slice(g.end).match(/^[ \t]*/) || [''])[0].length; }
    }
    x += before + put;
    at = g.end + skip;
  }
  x += t.slice(at);
  x = x.replace(FENCE_LINE, '').replace(ENTITY, (m, name) => ENTITIES[name] || m);
  return x.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
}
export function dropMarkup(text, { from = 0 } = {}) {
  const src = String(text == null ? '' : text);
  const head = src.slice(0, from);
  const tail = src.slice(from);
  if (!hasMarkup(tail)) return { text: src, changed: false, taken: [] };
  const taken = markupAt(tail).map((h) => h.words).filter((w, i, a) => a.indexOf(w) === i);
  const cleaned = cleanMarkup(tail);
  /* (what stood right after the words carried on keeps its first white space: a new paragraph is still one) */
  const lead = from > 0 ? tail.match(/^\s*/)[0] : '';
  const out = head + (from > 0 && !cleaned.startsWith(lead) ? lead + cleaned.replace(/^\s+/, '') : cleaned);
  return { text: out, changed: out !== src, taken };
}
/* words as they read without their loose markup (a sentence the checker offers) */
export function unmarked(text) { return cleanMarkup(String(text == null ? '' : text)); }
/* where loose markup stands in words: [{start, end, words}] */
export function markupAt(text) {
  const src = String(text == null ? '' : text);
  if (!hasMarkup(src)) return [];
  const hits = tagsIn(src).filter(changes).map((g) => ({ start: g.start, end: g.end, words: g.raw.trim() }));
  for (const m of src.matchAll(FENCE_LINE)) if (m[0].trim()) hits.push({ start: m.index, end: m.index + m[0].length, words: m[0].trim() });
  for (const m of src.matchAll(ENTITY)) hits.push({ start: m.index, end: m.index + m[0].length, words: m[0] });
  return hits.sort((a, b) => a.start - b.start);
}

/* STRAYS OF ANOTHER SCRIPT LEFT ON A LATIN PAGE (Cozy Tavern M119, M121):
 * what dropGluedStrays could not take off by itself — one to four characters
 * standing apart ("the 틀 door"), or inside a word, and a short run (to sixty
 * characters) — each with the words either side, for the checker to mend.
 * Never inside quotes: a line someone speaks or writes in another language
 * stays. On a page that is Latin nearly whole (two hundred letters at least). */
export function straysIn(text) {
  const src = String(text == null ? '' : text);
  if (!new RegExp(STRAY, 'u').test(src)) return [];
  const latin = (src.match(/\p{Script=Latin}/gu) || []).length;
  const other = (src.match(new RegExp(STRAY, 'gu')) || []).length;
  if (latin < 200 || other > latin / 4) return [];
  const quoted = [];
  for (const m of src.matchAll(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]{0,400}’/g)) quoted.push([m.index, m.index + m[0].length]);
  const out = [];
  for (const m of src.matchAll(new RegExp(`${STRAY}(?:[\\s·]*${STRAY}){0,59}`, 'gu'))) {
    const start = m.index;
    const end = start + m[0].length;
    if (quoted.some(([a, b]) => start >= a && end <= b)) continue;
    const left = src.slice(Math.max(0, start - 24), start).replace(/^\S*\s/, '');
    const right = src.slice(end, end + 24).replace(/\s\S*$/, '');
    out.push({ start, end, words: `${left}${m[0]}${right}`.trim() });
    if (out.length >= 8) break;
  }
  return out;
}

/* SUPER AUTOMATIC — THE CHAPTER ENDS HERE (prompts.js closeLine): the writer's line after the last words of a part
 * that ends its chapter, taken off — "END OF CHAPTER", in brackets, dashes, stars or as a heading, "The end of the
 * chapter", "Chapter ends here". {text, found, ended, before, after}: the words without the line (what came after
 * it kept, to be judged as anything after a page is: finishTail); found, the line was there; ended, it came at the end —
 * nothing after it but a short note (writer.js also takes it as the end when all that follows is what finishTail takes
 * off the page); before and after, the words on either side of it. A part that goes on past the line with the story
 * itself never ends there: the line is taken off and every word of the story stays. */
const END_LINE = /^[\s\[(⟦*_~#—–-]*(?:the\s+)?(?:end\s+of\s+(?:the\s+)?chapter(?:\s+\w+)?|chapter\s+ends(?:\s+here)?)[\s.!\])⟧*_~—–-]*$/i;
export function chapterEnds(text) {
  const t = String(text || '');
  const lines = t.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!END_LINE.test(lines[i])) continue;
    const after = lines.slice(i + 1).join('\n').trim();
    const before = lines.slice(0, i).join('\n').replace(/\s+$/, '');
    const words = after ? after.split(/\s+/).filter(Boolean).length : 0;
    return { text: before + (after ? `\n\n${after}` : ''), found: true, ended: Boolean(before.trim()) && words <= 40, before, after };
  }
  return { text: t, found: false, ended: false, before: t, after: '' };
}
