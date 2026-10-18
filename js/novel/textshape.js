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
/* (each later paragraph's marks read once for all the paragraphs before it that ask) */
const marksRead = new WeakMap();
function marksOfLine(lines, k) {
  let byLine = marksRead.get(lines);
  if (!byLine) { byLine = new Map(); marksRead.set(lines, byLine); }
  const l = lines[k];
  const was = byLine.get(k);
  if (was && was.l === l) return was.marks;
  const marks = SPOKEN.test(l) ? speechMarks(l) : [];
  byLine.set(k, { l, marks });
  return marks;
}
/* a later paragraph closes the quotation this one left open (before another opens) — each mark read by where it stands,
 * a measure (a 12" blade) never one (2.12.35: through 2.12.34 every straight quote was counted, so a later line with a
 * measure in it closed a speech left open). Its marks are walked whole, both kinds: a pair it writes in two kinds is its
 * own (`“Why should I?" he asked.`), and only a close with nothing open of its own closes the speech left open before
 * it — when it is that speech's kind (2.12.35, the review: the straight close of `“Why should I?"` was read as closing a
 * straight speech left open before it; once the paragraph was mended to one kind it no longer did, so the repair, made
 * twice, made another page) */
function closedLater(lines, i, curly) {
  for (let k = i + 1, seen = 0; k < lines.length && seen < 8; k++) {
    const l = lines[k];
    if (!l.trim()) continue;
    if (isBreakLine(l) || HEADING_LINE.test(l)) return false;
    seen++;
    let depth = 0;
    for (const m of marksOfLine(lines, k)) {
      if (m.role === 'open' || (m.role === 'either' && !depth)) depth += 1;
      else if (depth) depth -= 1;
      else return m.curly === curly;
    }
    if (depth > 0) return false;
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
/* the double quotes of a paragraph, in order. A straight quote right after a figure is a measure (5'9", a 12" blade) or
 * the close of a quotation that ends in one ("Top 10", "Catch-22", "I'm 25") — read as whichever leaves the fewest marks
 * of the paragraph unpaired, the close when it is even (2.12.35, the audit: through 2.12.34 always a measure, so "Top 10"
 * was a quotation never closed, and the checker and the mender were told so). `goesOn` and `carried` as pairWalk's. */
export function speechMarks(text, { goesOn = true, carried = null } = {}) {
  const src = String(text == null ? '' : text);
  const all = [];
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (!SPOKEN.test(c)) continue;
    const face = c === '“' ? 'open' : c === '”' ? 'close' : 'either';
    const place = placeOf(src, i);
    /* (a mark right after a figure closes a quotation, or is a measure — it never opens one: `8"x10"` is two measures,
     * never a quotation of "x10" — 2.12.35, the review: read so, a space was put in it) */
    const figure = c === '"' && /\d/.test(src[i - 1] || '');
    all.push({ at: i, curly: c !== '"', face, role: figure ? 'close' : place !== 'either' ? place : face, ...(figure ? { figure: true } : {}) });
  }
  const figs = all.filter((m) => m.figure);
  if (!figs.length) return all;
  if (figs.length > 6) return all.filter((m) => !m.figure);
  const bit = new Map(figs.map((m, k) => [m, 1 << k]));
  let best = null;
  for (let mask = 0; mask < (1 << figs.length); mask += 1) {
    const kept = all.filter((m) => !m.figure || !(mask & bit.get(m)));
    const faults = pairWalk(kept, goesOn, carried).faults;
    let n = 0;
    for (let x = mask; x; x >>= 1) n += x & 1;
    /* the fewest unpaired; then the fewest measures; then the later ones measures */
    if (!best || faults < best.faults || (faults === best.faults && (n < best.n || (n === best.n && mask > best.mask)))) best = { faults, n, mask, kept };
  }
  return best.kept;
}
/* the marks walked in order: the pairs they make, and how many places do not pair (goesOn: the speech left open goes
 * on in the paragraph after — the next one speaks, or a later one closes it; carried: {curly} — a speech the paragraph
 * before left open goes on into this one: a close with nothing open of its own closes it, and a speech opened again
 * at once is a novel's way of going on, never a fault — 2.12.35, the audit: the closing line of a letter or a song,
 * "Love, Mary”", was called a close with nothing open, and the mender was asked to open it again) */
export function pairWalk(marks, goesOn = false, carried = null) {
  let open = carried ? { at: -1, curly: Boolean(carried.curly), face: 'open', role: 'open', carried: true } : null;
  let faults = 0;
  const pairs = [];
  const bad = [];
  for (const m of marks) {
    if (m.role === 'open' || (m.role === 'either' && !open)) {
      if (open && !open.carried) { faults += 1; bad.push(m.at); } /* a speech opened while the last one never closed */
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
/* (never one beside another quotation mark: `*"Help me` is an asterisk astray before a quote that stands — made a quote,
 * it was an empty pair glued to the speech, `""Help me`, and the next repair took the speech's own quote away: 2.12.35,
 * the review) */
const besideQuote = (text, i) => SPOKEN.test(text[i - 1] || '') || SPOKEN.test(text[i + 1] || '');
function standIns(text) {
  const out = [];
  const lone = loneAsterisks(text);
  if (lone.length === 1 && !besideQuote(text, lone[0])) {
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
    if (/[,.!?…—–-]/.test(text[i - 1] || '') && blankAt(text, i + 1) && !besideQuote(text, i)) out.push({ at: i, as: 'close' });
  }
  return out;
}
function quoteFor(marks, at, as, carried = null) {
  if (as === 'close') {
    const before = pairWalk(marks.filter((m) => m.at < at), true, carried);
    return before.open ? (before.open.curly ? '”' : '"') : '';
  }
  const next = marks.find((m) => m.at > at);
  return next && next.curly ? '“' : '"';
}
/* (stand: false — only the quotation marks themselves faced and set in one kind, never another mark made one) */
export function pairSpeech(text, goesOn = false, carried = null, { stand = true } = {}) {
  const src = String(text == null ? '' : text);
  if (!SPOKEN.test(src) || OTHER_LANGUAGE.test(src)) return src;
  let out = src;
  let marks = speechMarks(out, { goesOn, carried });
  let walk = pairWalk(marks, goesOn, carried);
  if (walk.faults) {
    const whole = [];
    for (const c of stand ? standIns(src) : []) {
      const q = quoteFor(marks, c.at, c.as, carried);
      if (!q) continue;
      const tried = src.slice(0, c.at) + q + src.slice(c.at + 1);
      if (!pairWalk(speechMarks(tried, { goesOn, carried }), goesOn, carried).faults) whole.push(tried);
    }
    if (whole.length === 1) {
      out = whole[0];
      marks = speechMarks(out, { goesOn, carried });
      walk = pairWalk(marks, goesOn, carried);
    } else {
      /* no mark accounts for it, or more than one could: as it came — but a speech only left open at its end (closed
       * there after: mendCore) has its marks faced all the same, so the repair, made twice, makes the same page */
      const open = pairWalk(marks, true, carried);
      if (open.faults) return src;
      walk = open;
    }
  }
  /* every pair in one kind, every curly mark facing the part it plays */
  const curly = marks.filter((m) => m.curly).length;
  const straight = marks.length - curly;
  const chars = out.split('');
  for (const [o, c] of walk.pairs) {
    /* the close of a speech the paragraph before left open: in that speech's kind, facing out */
    if (o.carried) { chars[c.at] = o.curly ? '”' : '"'; continue; }
    if (o.curly === c.curly && (!o.curly || (o.face === 'open' && c.face === 'close'))) continue;
    const asCurly = o.curly === c.curly ? o.curly : curly > straight ? true : curly < straight ? false : o.curly;
    chars[o.at] = asCurly ? '“' : '"';
    chars[c.at] = asCurly ? '”' : '"';
  }
  if (walk.open && !walk.open.carried && walk.open.curly && walk.open.face !== 'open') chars[walk.open.at] = '“'; /* a long speech's open mark, facing in */
  return chars.join('');
}
/* an asterisk opened and never closed is closed at the end of the stretch it opened in — the page reads emphasis inside
 * one line of speech or one stretch of narration, never across a quote (M753: closed at the paragraph's end,
 * '"I *mean it," she said.*' showed two stray asterisks where there had been one). Speech that does not pair leaves no
 * place to know: the asterisk is left as it is. */
function closeEmphasis(line, goesOn, carried = null) {
  let single = -1;
  let count = 0;
  for (let i = 0; i < line.length; i += 1) if (line[i] === '*' && line[i - 1] !== '*' && line[i + 1] !== '*') { count += 1; single = i; }
  if (!(count % 2 === 1 && single !== -1 && (single === 0 || /\s/.test(line[single - 1])) && /\S/.test(line[single + 1] || ''))) return line;
  /* (never set against another asterisk: "**" and one more is a bold opened, not an emphasis closed) */
  const closeAt = (at) => (line[at - 1] === '*' || line[at] === '*' ? line : line.slice(0, at) + '*' + line.slice(at));
  const marks = speechMarks(line, { goesOn, carried });
  if (!marks.some((m) => m.at > single)) return closeAt(line.length);
  const walk = pairWalk(marks, goesOn, carried);
  if (walk.faults) return line;
  const inside = walk.pairs.find(([o, c]) => o.at < single && single < c.at);
  if (inside) return closeAt(inside[1].at);
  if (walk.open && walk.open.at < single) return closeAt(line.length);
  const opener = walk.pairs.map(([o]) => o).concat(walk.open ? [walk.open] : []).filter((m) => m.at > single).sort((a, b) => a.at - b.at)[0];
  if (!opener) return closeAt(line.length);
  let end = opener.at;
  while (end > single + 1 && /\s/.test(line[end - 1])) end -= 1;
  return end > single + 1 ? closeAt(end) : line;
}
const NOTHING_FOLLOWS = { nextSpeaks: false, curlyLater: false, straightLater: false, goesOn: false };
/* what follows a paragraph, for whether a speech left open in it goes on */
function goesOnAt(lines, i) {
  let next = '';
  for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) { next = isBreakLine(lines[k]) ? '' : lines[k]; break; }
  const nextSpeaks = /^\s*[*_]*[“"]/.test(next);
  const curlyLater = closedLater(lines, i, true);
  const straightLater = closedLater(lines, i, false);
  return { nextSpeaks, curlyLater, straightLater, goesOn: nextSpeaks || curlyLater || straightLater };
}
/* the speech a paragraph leaves open for the one after it: {curly}, or null — only when it goes on, and only when every
 * mark of it pairs (where they do not, only a reading can say what is left open). `at`: what follows it (goesOnAt), or a
 * function that reads it — read only for a paragraph that leaves a speech open, as few do */
function carryOut(line, at, carried) {
  if ((!carried && !SPOKEN.test(line)) || OTHER_LANGUAGE.test(line)) return null;
  const walk = pairWalk(speechMarks(line, { goesOn: true, carried }), true, carried);
  if (!walk.open || walk.faults) return null;
  return (typeof at === 'function' ? at() : at).goesOn ? { curly: walk.open.curly } : null;
}
/* speech wrapped in asterisks — one asterisk tight on either side of one quotation, standing outside any other
 * emphasis (before it a space or the line's start, after it a space, a mark or the line's end) — loses the asterisks
 * (M458). Never the close of one sound and the open of the next with the speech between them (2.12.35, the audit:
 * `*CLANG!* "Nngh—!" *THUD*`, the sound law's own two lanes, was made `*CLANG!"Nngh—!"THUD*`), never bold. */
const WRAPPED_SPEECH = /(^|[\s(\[—–-])\*(?!\*)[ \t]*(["“][^"“”\n*]*["”])[ \t]*\*(?![*\p{L}\p{N}])/gu;
/* an empty pair of quotes goes, with the one space it leaves */
function dropEmpty(core) {
  const noEmpty = core.replace(/(^|[ \t(])(?:""|“[ \t]*”)(?=[ \t.,!?;:)]|$)/g, (m, pre) => (pre === ' ' || pre === '\t' ? '' : pre));
  return noEmpty !== core ? noEmpty.replace(/^[ \t]+/, '') : core;
}
/* one paragraph's marks made whole (its words never) */
function mendCore(core0, { nextSpeaks, curlyLater, straightLater, carried = null }) {
  let core = dropEmpty(core0);
  core = core.replace(WRAPPED_SPEECH, '$1$2');
  const goesOn = nextSpeaks || curlyLater || straightLater;
  /* (and one the marks set facing each other made: the repair, made twice, makes the same page) */
  core = dropEmpty(pairSpeech(core, goesOn, carried));
  /* a speech opened and never closed, going on nowhere: closed at the paragraph's end, in its own kind */
  if (!OTHER_LANGUAGE.test(core)) {
    const walk = pairWalk(speechMarks(core, { goesOn: true, carried }), true, carried);
    const o = walk.open;
    /* (a mark with no word after it opens no speech: left for the checker, never closed into an empty pair) */
    const opens = o && !o.carried && (o.role === 'open' || (o.role === 'either' && o.curly && o.face === 'open')) && /[\p{L}\p{N}]/u.test(core.slice(o.at + 1));
    if (!walk.faults && opens && !nextSpeaks && !(o.curly ? curlyLater : straightLater)) core += o.curly ? '”' : '"';
  }
  return closeEmphasis(core, goesOn, carried);
}
export function mendMarks(text, { from = 0, leaveLast = false } = {}) {
  const given = String(text == null ? '' : text);
  if (!/["“”*]/.test(given)) return { text: given, changed: false };
  const lines = given.split('\n');
  let last = -1;
  if (leaveLast) for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) { last = i; break; }
  let pos = 0;
  let changed = false;
  /* a speech the paragraph before left open, going on into this one (a letter, a song, one speaker going on) */
  let carry = null;
  for (let i = 0; i < lines.length; i++) {
    const start = pos;
    pos += lines[i].length + 1;
    const line = lines[i];
    if (!line.trim()) continue;
    if (isBreakLine(line) || HEADING_LINE.test(line)) { carry = null; continue; }
    /* (what follows a paragraph is read only for one with speech in it, or carried into it) */
    const at = SPOKEN.test(line) || carry ? goesOnAt(lines, i) : NOTHING_FOLLOWS;
    const carried = carry;
    if (start < from || i === last) { carry = carryOut(line, at, carried); continue; }
    const lead = line.match(/^\s*/)[0];
    const tail = line.slice(lead.length).match(/\s*$/)[0];
    const core = mendCore(line.slice(lead.length, line.length - tail.length), { ...at, carried });
    const mended = core ? lead + core + tail : '';
    if (mended !== line) { lines[i] = mended; changed = true; }
    carry = carryOut(mended, at, carried);
  }
  return changed ? { text: lines.join('\n'), changed: true } : { text: given, changed: false };
}
/* THE SOUNDS 2.12.34 GLUED TO THE SPEECH BETWEEN THEM, PARTED AGAIN (2.12.35, the audit: its unwrap of speech in
 * asterisks read the close of one sound and the open of the next — `*CLANG!* "Nngh—!" *THUD*` — as one wrap and took
 * both off, `*CLANG!"Nngh—!"THUD*`, on new pages and, once, on every page kept before). Within one emphasis, a
 * quotation glued on both sides to its words — no space either side — is the sound before it, the speech, and the
 * sound after, each in its own lane again. Bold the same. Marks and spaces only: every letter stays. For the pages
 * kept (mend.js MEND_V 5); a new page never comes so. */
export function unglueSounds(text) {
  const src = String(text == null ? '' : text);
  if (!src.includes('*') || !SPOKEN.test(src)) return src;
  /* (the sounds either side may be one italic and one bold — `*CLANG!* "Nngh—!" **THUD**` was glued into
   * `*CLANG!"Nngh—!"THUD**` — each keeps its own: 2.12.35, the review) */
  return src.replace(/(?<!\*)(\*{1,2})(?=[^\s*])([^*\n]*?[^\s*])(\*{1,2})(?!\*)/g, (all, star, inner, end) => {
    const parts = [];
    let k = 0;
    for (const m of inner.matchAll(/["“][^"“”\n]*["”]/g)) {
      const s = m.index;
      const e = s + m[0].length;
      /* a quotation not glued on both sides is the emphasis's own: as it is */
      if (s === 0 || e >= inner.length || /\s/.test(inner[s - 1]) || /\s/.test(inner[e])) return all;
      parts.push(inner.slice(k, s), m[0]);
      k = e;
    }
    if (!parts.length) return all;
    parts.push(inner.slice(k));
    if (star !== end && parts.length !== 3) return all;
    return parts.map((x, i) => (i % 2 ? ` ${x} ` : i === parts.length - 1 ? `${end}${x}${end}` : `${star}${x}${star}`)).join('');
  });
}
/* the paragraphs of a text, each with where it stands, what follows it (goesOnAt) and the speech the paragraph before
 * left open going on into it (`carried`); a scene break or a heading ends a speech. Not the last paragraph of a page cut
 * short (`leaveLast`: it is not finished — Go on finishes it). [{i, line, start, at, carried}] */
function paragraphsOf(text, { leaveLast = false } = {}) {
  const lines = String(text == null ? '' : text).split('\n');
  let last = -1;
  if (leaveLast) for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) { last = i; break; }
  const out = [];
  let pos = 0;
  let carry = null;
  for (let i = 0; i < lines.length; i++) {
    const start = pos;
    const line = lines[i];
    pos += line.length + 1;
    if (!line.trim()) continue;
    if (isBreakLine(line) || HEADING_LINE.test(line)) { carry = null; continue; }
    /* (what follows it read only when asked: most paragraphs leave nothing open) */
    let seen = null;
    const at = () => seen || (seen = goesOnAt(lines, i));
    const carried = carry;
    carry = carryOut(line, at, carried);
    if (i !== last) out.push({ i, line, start, at, carried });
  }
  return out;
}
/* SPACES A SLIP OF THE HAND LEFT OUT OR PUT IN (2.12.35 — his page: "…the sky had gone from bruised to ash, She looked
 * at him", "keeping it wassentiment", under a green light). White space only, and only where no reading is needed: a
 * space after a full stop, question or exclamation mark between a word and the next sentence ("hand.She"); after a
 * comma before a letter, or a semicolon or colon before a small letter ("yes,she"); around speech marks that pair
 * (`"Go,"she said`, `he said,"Go."`); and a space standing before a comma ("word , next" — never before a semicolon or
 * a colon, where French sets one). Never in a figure (3,000; 9:30), an ellipsis, an initialism (U.S.A., Ph.D.), a title
 * like Re:Zero, an address, a scene break, a paragraph in „…“ or «…», or the last paragraph of a page cut short
 * (`leaveLast`). [{at, del, ins, why}], in order. */
/* (what a page carries that is not prose: a tag and what is inside it, `code`, an entity — never a slip's place; 2.12.35,
 * the partner's `<span style="color:red">` was given a space after its colon. A slip's place is the marks on either
 * side of the space put in or taken out, and the spaces taken out: not one of them may be a tag's, a code's or an
 * entity's own — the semicolon ending `&mdash;` before a word is no semicolon of the story, and a quote inside a tag
 * no speech mark) */
const NOT_PROSE = /<[^<>\n]*>|`[^`\n]*`|&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi;
export function spacingSlips(text, { leaveLast = false } = {}) {
  const out = [];
  for (const { line, start: base, carried } of paragraphsOf(text, { leaveLast })) {
    if (OTHER_LANGUAGE.test(line) || /:\/\/|www\.|@[\w-]+\./.test(line)) continue;
    const kept = [...line.matchAll(NOT_PROSE)].map((m) => [m.index, m.index + m[0].length]);
    const keptAt = (k) => kept.some(([s, e]) => k >= s && k < e);
    const slip = (at, del, ins, why) => {
      for (let k = at - 1; k <= at + del; k += 1) if (keptAt(k)) return;
      out.push({ at: base + at, del, ins, why });
    };
    for (const m of line.matchAll(/(?<=\p{Ll})[.!?](?=\p{Lu}\p{Ll})/gu)) slip(m.index + 1, 0, ' ', 'a space missing after the end of a sentence');
    /* (a comma after a word, or after the quote or bracket that closes one: `"Fine",she said` — 2.12.35, the review) */
    for (const m of line.matchAll(/(?<=\p{Ll}["”’)\]]?),(?=\p{L})|(?<=\p{Ll})[;:](?=\p{Ll})/gu)) slip(m.index + 1, 0, ' ', `a space missing after the ${m[0] === ',' ? 'comma' : m[0] === ';' ? 'semicolon' : 'colon'}`);
    for (const m of line.matchAll(/(?<=\p{L})[ \t]+(?=,(?:[ \t]|$))/gu)) slip(m.index, m[0].length, '', 'a space standing before the comma');
    /* speech marks that pair: a word straight after the closing mark, or straight before the opening one */
    const walk = pairWalk(speechMarks(line, { goesOn: true, carried }), true, carried);
    if (!walk.faults) {
      for (const [o, c] of walk.pairs) {
        if (/[\p{L}\p{N}]/u.test(line[c.at + 1] || '')) slip(c.at + 1, 0, ' ', 'a space missing after the closing quote');
        if (o.at > 0 && /[\p{L}\p{N},.;:!?]/u.test(line[o.at - 1])) slip(o.at, 0, ' ', 'a space missing before the opening quote');
      }
    }
  }
  out.sort((x, y) => x.at - y.at);
  return out.filter((x, i) => !i || !(out[i - 1].at === x.at && out[i - 1].ins === x.ins && out[i - 1].del === x.del));
}
/* the slips put right, on a new page (white space only; only what stands at or after `from`, never the last paragraph
 * of a page cut short) */
export function mendSpacing(text, { from = 0, leaveLast = false } = {}) {
  const given = String(text == null ? '' : text);
  const slips = spacingSlips(given, { leaveLast }).filter((x) => x.at >= from);
  if (!slips.length) return { text: given, changed: false };
  let out = given;
  for (const x of [...slips].sort((a, b) => b.at - a.at)) out = out.slice(0, x.at) + x.ins + out.slice(x.at + x.del);
  return { text: out, changed: out !== given };
}
/* A PAGE THAT CAME AS ONE BLOCK IS PARTED WHERE SPEECH BEGINS (Cozy Tavern M510-17 partParagraphs, 2.12.34): a new
 * page of more than 900 characters with not one paragraph break is parted before each line of speech that opens after
 * a finished sentence — white space only, never a word. Only where no speech is open still, and only up to the first
 * mark that does not pair (2.12.35, the audit: a quotation inside speech in the same kind of mark — `…asked for him.
 * "Who?" the man said…` — was parted inside the speech; and the page was put back with String.replace, so a "$&" or a
 * "$'" in it was read as a code: `$&` doubled the page into itself). A page that has its paragraphs is left as it is. */
export function partBlock(text) {
  const given = String(text == null ? '' : text);
  const trimmed = given.trim();
  if (trimmed.length <= 900 || /\n/.test(trimmed)) return { text: given, changed: false };
  const cuts = [];
  let open = null;
  for (const m of speechMarks(trimmed)) {
    if (m.role === 'open' || (m.role === 'either' && !open)) {
      if (open) break;
      const gap = /[.!?…]["”’)]?([ \t]+)$/.exec(trimmed.slice(0, m.at));
      if (gap && (!m.curly || trimmed[m.at] === '“') && /\S/.test(trimmed[m.at + 1] || '')) cuts.push({ from: m.at - gap[1].length, to: m.at });
      open = m;
    } else {
      if (!open) break;
      open = null;
    }
  }
  if (!cuts.length) return { text: given, changed: false };
  let parted = '';
  let k = 0;
  for (const c of cuts) { parted += trimmed.slice(k, c.from) + '\n\n'; k = c.to; }
  parted += trimmed.slice(k);
  const lead = given.indexOf(trimmed);
  return { text: given.slice(0, lead) + parted + given.slice(lead + trimmed.length), changed: true };
}
/* an edit that only ADDS speech marks — every character kept, in order, and nothing new but a quotation mark (Cozy
 * Tavern M753) */
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
/* a stretch as its words: every character but quotation marks and white space, in order — "..." one with "…", any
 * apostrophe one with another — and, before each and after the last, what stands there (its quotation marks and white
 * space) */
const QUOTE_MARK = /["“”]/;
function skeletonOf(s) {
  const chars = [];
  const gaps = [''];
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (QUOTE_MARK.test(ch) || /\s/.test(ch)) { gaps[gaps.length - 1] += ch; i += 1; continue; }
    if (s.startsWith('...', i)) { chars.push({ text: '...', key: '…' }); i += 3; } else { chars.push({ text: ch, key: /['‘’]/.test(ch) ? '’' : ch }); i += 1; }
    gaps.push('');
  }
  return { chars, gaps };
}
/* every speech mark of a stretch in one kind — curly ones facing the part each plays */
function asKind(text, curly, carried) {
  const flat = text.replace(/[“”]/g, '"');
  if (!curly) return flat;
  const from = carried ? { curly: false } : null;
  const marks = speechMarks(flat, { goesOn: true, carried: from });
  const walk = pairWalk(marks, true, from);
  const chars = flat.split('');
  for (const [o, c] of walk.pairs) { if (!o.carried) chars[o.at] = '“'; chars[c.at] = '”'; }
  if (walk.open && !walk.open.carried) chars[walk.open.at] = '“';
  for (const m of marks) if (chars[m.at] === '"') chars[m.at] = m.role === 'close' ? '”' : '“';
  return chars.join('');
}
/* AN ANSWER THAT SETS ONLY THE SPEECH MARKS (Cozy Tavern M753's rule, held: 2.12.35, the audit — the marks' mender's
 * answer in curly marks, or with "…" for "...", was refused for a change it never made; and "Write it again" for a
 * paragraph's marks went in by itself with no word checked, 52 words made 18, or speech made narration with its marks
 * taken off). The words before — every letter and every other mark of them as they stand — with the answer's quotation
 * marks: added, or one written in the kind or facing its pair needs, never one taken away; and the answer's white
 * space where it parts a paragraph or sets a space beside a mark, never where it joins two words or two paragraphs.
 * Written in the kind the words before had most of, every pair whole. '' when the answer changed anything else, or
 * nothing, or its marks still do not pair. */
export function marksOnlyResult(before, after, { goesOn = true, carried = null } = {}) {
  const was = String(before == null ? '' : before);
  const a = skeletonOf(was);
  const b = skeletonOf(String(after == null ? '' : after));
  if (!a.chars.length || a.chars.length !== b.chars.length || a.chars.some((c, k) => c.key !== b.chars[k].key)) return '';
  const quotes = (g) => (g.match(/["“”]/g) || []).length;
  /* (the answer's white space as the paragraph writes it: a space where it set one, a paragraph break where it parted
   * one — the break the words had there, or a blank line — never a space doubled that was single, nor a lone line
   * break: 2.12.35, the review) */
  const tidyGap = (g0, g1) => {
    const nl = (g0.match(/\s*\n\s*/) || [''])[0];
    const wide = /[ \t]{2,}/.test(g0);
    return g1.replace(/\s+/g, (run) => (/\n/.test(run) ? nl || '\n\n' : wide ? run : ' '));
  };
  let out = '';
  for (let k = 0; k <= a.chars.length; k += 1) {
    const g0 = a.gaps[k];
    const g1 = b.gaps[k];
    if (quotes(g1) < quotes(g0)) return '';
    if (/\s/.test(g0) && !/\s/.test(g1)) return '';
    if (/\n/.test(g0) && !/\n/.test(g1)) return '';
    if (!/\s/.test(g0) && /\s/.test(g1) && !quotes(g1) && !quotes(g0)) return '';
    /* (the words' own edges as they were: the answer's white space only inside them) */
    out += k === 0 || k === a.chars.length ? g1.replace(/\s+/g, '') : tidyGap(g0, g1);
    if (k < a.chars.length) out += a.chars[k].text;
  }
  const kinds = was.match(/["“”]/g) || [];
  const curly = kinds.filter((c) => c !== '"').length;
  if (kinds.length && curly !== kinds.length - curly) out = asKind(out, curly > kinds.length - curly, carried);
  out = pairSpeech(out, goesOn, carried, { stand: false });
  if (out === was || pairWalk(speechMarks(out, { goesOn, carried }), goesOn, carried).faults) return '';
  /* (never a measure made speech: `a 12" blade` read as the close of a quotation the answer opened, `a "12" blade`) */
  if (measuresIn(out, goesOn, carried) < measuresIn(was, goesOn, carried)) return '';
  return out;
}
/* how many straight quotes after a figure a paragraph reads as measures (speechMarks) */
function measuresIn(text, goesOn, carried) {
  const src = String(text);
  let n = 0;
  for (let i = 1; i < src.length; i += 1) if (src[i] === '"' && /\d/.test(src[i - 1])) n += 1;
  return n ? n - speechMarks(src, { goesOn, carried }).filter((m) => m.figure).length : 0;
}
/* THE PARAGRAPHS WHOSE SPEECH MARKS DO NOT PAIR (Cozy Tavern M753 speechFaults, for a book): [{start, end, line,
 * mended, goesOn, carried, near}] — each paragraph's place in the words, its words, and the paragraph as the repair would
 * leave it when that alone pairs every mark (mended, '' when only a reading of the sentence can say where the quote
 * belongs). A scene break, a heading, a paragraph in „…“ or «…», a speech going on into the paragraph after, the close
 * of one the paragraph before left open (a letter, a song), and the last paragraph of a page cut short (`leaveLast`)
 * are not faults. */
export function speechFaults(text, { leaveLast = false } = {}) {
  const given = String(text == null ? '' : text);
  if (!SPOKEN.test(given)) return [];
  const out = [];
  for (const { line, start, at: atOf, carried } of paragraphsOf(given, { leaveLast })) {
    if (!SPOKEN.test(line) || OTHER_LANGUAGE.test(line)) continue;
    /* (marks that pair, with nothing of its own left open: no fault, whatever follows) */
    const loose = pairWalk(speechMarks(line, { goesOn: true, carried }), true, carried);
    if (!loose.faults && !(loose.open && !loose.open.carried)) continue;
    const at = atOf();
    const goesOn = at.goesOn;
    const walk = pairWalk(speechMarks(line, { goesOn, carried }), goesOn, carried);
    if (!walk.faults) continue;
    const lead = line.match(/^\s*/)[0].length;
    const tail = line.length - line.trimEnd().length;
    const core = line.slice(lead, line.length - tail);
    const fixed = mendCore(core, { ...at, carried });
    /* where it first goes wrong, with a few words either side: what a card marks */
    const k = Math.max(0, walk.bad[0]);
    const near = line.slice(Math.max(lead, k - 28), Math.min(line.length - tail, k + 28)).replace(/^\S*\s+(?=\S)/, (m) => (k - 28 > lead ? '' : m)).replace(/\s+\S*$/, (m) => (k + 28 < line.length - tail ? '' : m));
    out.push({ start: start + lead, end: start + line.length - tail, line: core, goesOn, ...(carried ? { carried } : {}), near: near.trim(), mended: fixed !== core && !pairWalk(speechMarks(fixed, { goesOn, carried }), goesOn, carried).faults ? fixed : '' });
  }
  return out;
}
/* [ca, cb) out to whole words, then a few words either side at a time (`words` at first) — inside [lo, hi) first, then
 * past it — until it stands in only one place in the text: {start, end} (2.12.35, the audit: a paragraph standing twice
 * in a passage gave a fix whose words stood twice — its card came back at every look, Apply said "in more than one
 * place", and the mender was asked again each time) */
export function spanAround(text, ca, cb, { lo = 0, hi = String(text == null ? '' : text).length, words: first = 2 } = {}) {
  const src = String(text == null ? '' : text);
  let L = Math.max(0, Math.min(lo, ca));
  let H = Math.min(src.length, Math.max(hi, cb));
  for (let words = first; ; ) {
    let s = ca;
    let e = cb;
    for (let k = 0; k < words && s > L; ) { s--; if (/\s/.test(src[s]) && !/\s/.test(src[s + 1] || '')) k++; }
    while (s > L && !/\s/.test(src[s - 1])) s--;
    for (let k = 0; k < words && e < H; ) { if (/\s/.test(src[e]) && !/\s/.test(src[e - 1] || '')) k++; e++; }
    while (e < H && !/\s/.test(src[e])) e++;
    /* (grown as far as the stretch goes — read before the white space at its edges is let go, so a stretch that begins
     * or ends in white space is known to be used up: 2.12.35, found by a fuzz of this function, which never ended) */
    const usedUp = s <= L && e >= H;
    /* (white space at either edge is let go — never the change's own) */
    while (s < ca && /\s/.test(src[s])) s++;
    while (e > cb && /\s/.test(src[e - 1])) e--;
    const find = src.slice(s, e);
    if (find.trim() && src.indexOf(find) === src.lastIndexOf(find)) return { start: s, end: e };
    /* the stretch used up: past it, as many words again */
    if (usedUp) {
      if (L === 0 && H === src.length) return { start: s, end: e };
      L = 0;
      H = src.length;
      continue;
    }
    words += 2;
  }
}
/* a stretch of the text, as few words past it as make it stand in only one place: {find, start, end} */
export function uniqueAround(text, start, end) {
  const src = String(text == null ? '' : text);
  const at = spanAround(src, start, end, { lo: start, hi: end, words: 0 });
  return { find: src.slice(at.start, at.end), start: at.start, end: at.end };
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
  const ca = start + a;
  const cb = end - b;
  const at = spanAround(src, ca, cb, { lo: start, hi: end });
  return { find: src.slice(at.start, at.end), replace: src.slice(at.start, ca) + now.slice(a, now.length - b) + src.slice(cb, at.end), start: at.start, end: at.end };
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
/* (2.12.35, the audit: "END OF CHAPTER TWENTY-ONE" — the chapter's own name past Twenty, as the request says it — "End
 * of Chapter One Hundred", "END OF CHAPTER 1: The Riders", the line shouted at the end of the last line of story, and two
 * lines in one answer were each left on the page) */
const END_NUMBER = `(?:\\d+|[ivxlcdm]+|(?:${NUMBER_WORDS})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORDS}))*)`;
const END_LINE = new RegExp(`^[\\s\\[(⟦*_~#—–-]*(?:the\\s+)?(?:end\\s+of\\s+(?:the\\s+)?chapter(?:\\s+${END_NUMBER})?(?:\\s*[:—–-]\\s*[^\\n]{1,80})?|chapter(?:\\s+${END_NUMBER})?\\s+ends(?:\\s+here)?)[\\s.!\\])⟧*_~—–-]*$`, 'i');
/* (the line shouted after the last words: the words END OF CHAPTER in capitals, its number in any — 2.12.35, the review:
 * "END OF CHAPTER THREE" and "… XXI" were missed, the number words written small) */
const TRAILING_END = new RegExp(`[ \\t]+[\\[(⟦*_~—–-]*\\s*(END OF CHAPTER)(?:\\s+${END_NUMBER})?[\\s.!\\])⟧*_~—–-]*$`, 'i');
/* what a writer puts after the line that is not story: a note, the next chapter's heading, an announcement of it */
const AFTER_MATTER = [
  /^[\s\[(*_]*next(?:\s+chapter|\s+up|\s+time|\s+part)?\s*[:—–-]/i,
  /^[\s\[(*_]*(?:ready|on to|onward|up next|coming up|stay tuned)\b[^\n]{0,120}\b(?:chapter|next)\b/i,
  /^[\s\[(*_]*(?:note|author['’]?s?\s+note|a\/n|ooc|out of character)\s*[:—–-]/i,
  /^[\s*_]*[\[(][^\])\n]{0,240}[\])][\s*_.!?]*$/,
];
const isAfterMatter = (para) => {
  const bare = String(para || '').replace(/^[\s#>*_]+|[\s*_]+$/g, '');
  return Boolean(bare) && (CHAPTER_HEAD.test(bare) || AFTER_MATTER.some((re) => re.test(para)) || tailIsNote(para));
};
export function chapterEnds(text) {
  const t = String(text || '');
  const lines = t.split('\n');
  /* the line shouted after the last words, on their own line */
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) { last = i; break; }
  if (last >= 0 && !END_LINE.test(lines[last])) {
    const m = TRAILING_END.exec(lines[last]);
    if (m && m[1] === 'END OF CHAPTER' && lines[last].slice(0, m.index).trim()) { lines.splice(last + 1, 0, lines[last].slice(m.index).trim()); lines[last] = lines[last].slice(0, m.index).replace(/\s+$/, ''); }
  }
  const at = lines.map((l, i) => (END_LINE.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return { text: t, found: false, ended: false, before: t, after: '', matter: '' };
  /* every such line comes off; the last one says where the chapter ends */
  const end = at[at.length - 1];
  const tidy = (list) => list.join('\n').replace(/\n{3,}/g, '\n\n');
  const before = tidy(lines.slice(0, end).filter((_, k) => !at.includes(k))).replace(/\s+$/, '');
  const after = lines.slice(end + 1).join('\n').trim();
  /* after it: the writer's own matter comes off (kept with the version) and the chapter ends; story stays on the page,
   * and the chapter goes on */
  const paras = after ? after.split(/\n[ \t]*\n|\n/).map((x) => x.trim()).filter(Boolean) : [];
  const matter = paras.length > 0 && paras.every(isAfterMatter);
  const ended = Boolean(before.trim()) && (!paras.length || matter);
  /* (the writer's matter comes off with the line however little stands before it — with nothing before it, nothing is
   * the page: 2.12.35, the review — "END OF CHAPTER\n\nNext chapter: The Storm" was kept as the page) */
  return { text: ended || matter ? before : [before, after].filter((x) => x.trim()).join('\n\n'), found: true, ended, before, after, matter: matter ? after : '' };
}
