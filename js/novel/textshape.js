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
 * never a word; a line of marks (a scene break) is never joined. */
export function joinSoftWraps(text) {
  const given = String(text == null ? '' : text);
  if (!/\n[ \t]*\n/.test(given)) return given;
  const MARK_LINE = new RegExp(`^${SP}*(?:[*\\u2217\\u204e\\uff0a\\u2731_~—–-]+${SP}*)+$`);
  const lines = given.split('\n');
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];
    if (MARK_LINE.test(line) || MARK_LINE.test(prev)) out += '\n' + line;
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
 * is a narrator's own question — of "would", only "would you like" is one */
const TAIL_META = [
  /^(?:so,?\s+|now,?\s+|and\s+)?(?:what|how|where)\s+(?:(?:will|do|does|should|shall)\s+you|would\s+you\s+like)\b[^"“”]{0,140}\?$/i,
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

/* THE MARKS A MODEL LEFT OPEN ARE CLOSED (Cozy Tavern M458, M476, M490 —
 * made for a book, where each line is a paragraph). A paragraph that opens a
 * quotation and never closes it gets its close at its end — unless the next
 * paragraph opens with one (one speaker going on, a novel's way), or a later
 * one closes it (a letter, a song, a speech written over several lines); an
 * empty pair of quotes goes; a lone asterisk that opens an emphasis is closed
 * at the paragraph's end. Marks only — never a word: a quote is never taken
 * out (after a dialogue tag, "maybe later" is speech going on, not a stray),
 * and italics stay italics (in a novel they carry thoughts). A scene break
 * and a heading are left as they are; so is every paragraph that begins
 * before `from` (Go on: only what is new), and the last one of a page that
 * was cut (`leaveLast`: it is not finished — Go on finishes it). */
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
export function mendMarks(text, { from = 0, leaveLast = false } = {}) {
  const given = String(text == null ? '' : text);
  if (!/["“*]/.test(given)) return { text: given, changed: false };
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
    let core = line.slice(lead.length, line.length - tail.length);
    /* an empty pair of quotes goes, with the one space it leaves */
    const noEmpty = core.replace(/(^|[ \t(])(?:""|“[ \t]*”)(?=[ \t.,!?;:)]|$)/g, (m, pre) => (pre === ' ' || pre === '\t' ? '' : pre));
    if (noEmpty !== core) core = noEmpty.replace(/^[ \t]+/, '');
    let next = '';
    for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) { next = isBreakLine(lines[k]) ? '' : lines[k]; break; }
    const nextSpeaks = /^\s*[*_]*[“"]/.test(next);
    const opens = (core.match(/“/g) || []).length;
    const closes = (core.match(/”/g) || []).length;
    if (opens === closes + 1 && core.lastIndexOf('“') > core.lastIndexOf('”') && !nextSpeaks && !closedLater(lines, i, true)) core += '”';
    const straight = quotesAt(core);
    if (straight.length % 2 === 1 && !nextSpeaks && straightOpens(core, straight[straight.length - 1]) && !closedLater(lines, i, false)) core += '"';
    let single = -1;
    let count = 0;
    for (let k = 0; k < core.length; k++) if (core[k] === '*' && core[k - 1] !== '*' && core[k + 1] !== '*') { count++; single = k; }
    if (count % 2 === 1 && (single === 0 || /\s/.test(core[single - 1])) && /\S/.test(core[single + 1] || '')) core += '*';
    const mended = core ? lead + core + tail : '';
    if (mended !== line) { lines[i] = mended; changed = true; }
  }
  return changed ? { text: lines.join('\n'), changed: true } : { text: given, changed: false };
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
