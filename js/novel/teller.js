/* Cozy Novel — js/novel/teller.js — THE TELLER: who is telling, and how it
 * thinks (Cozy Tavern's M327, M333–M335, M358, M359, M361 and M21, for the
 * three voices of a book).
 *
 * His three boxes — How you like it written, How the narrator tells scenes,
 * How the partner talks — each say who a teller IS ("You are Tony Stark…").
 * Beside each, as in Cozy Tavern's The frame:
 *
 *   - Who is telling: the teller's name. Every line the app itself says to
 *     the teller in his turn is said to it by that name ("Tony — pick Chapter
 *     Two up right where it stops…"), and {{char}} in his words is that name.
 *     Nothing anywhere calls it a persona or a role: a name is just used, the
 *     way one uses a friend's name.
 *   - Grounding phrase: the first words of the teller's own thinking. Woven
 *     into the standing words — at the top and a third of the way down — and,
 *     where the model continues a started thought, planted as the start of its
 *     thinking itself (providers.js buildRequest). A teller that opens its own
 *     thinking in character stays in character through it.
 *   - The teller thinks as: I or you — read off the box's own opening words
 *     unless he sets it. In the first person the app's own standing words
 *     (the crafts and rules, the lines between his words and the book) become
 *     the teller's notes to itself, and he is "you" in them: "you bring me
 *     premises… and I write the novel". What he says in his turn — the
 *     request, his notes — always says "you" to the teller, the way one does
 *     to a friend.
 *   - Say it again at the end: his box once more just before the note at the
 *     end — the anchor against a long request's fade.
 *
 * A teller with a self (a name in Who is telling, or a box in the first
 * person) turns the scene over before the page the way a person does, never
 * as a checklist (M335). Only words the APP wrote go through
 * here — never a page, a card, a summary or a word of his book. With nothing
 * set, every word is exactly what it was. Pure: no store, no screen.
 */

/* the three tellers, by what the request is for (context.js assemble) */
export const TELLERS = ['write', 'play', 'partner'];
export const PERSONS = ['follow', 'first', 'second'];

export function cleanTellerName(v) {
  return String(v == null ? '' : v).replace(/[\[\]{}<>\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
export function cleanPhrase(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 80);
}
/* one teller as the house keeps it: {name, phrase, person, echo} */
export function cleanTeller(t) {
  const s = t && typeof t === 'object' ? t : {};
  return { name: cleanTellerName(s.name), phrase: cleanPhrase(s.phrase), person: PERSONS.includes(s.person) ? s.person : 'follow', echo: s.echo === true };
}
export function tellerOf(house, purpose) {
  const all = house && house.tellers && typeof house.tellers === 'object' ? house.tellers : {};
  return cleanTeller(all[purpose]);
}
/* all three, as a preset keeps them — nothing kept for one with nothing set */
export function cleanTellers(v) {
  const src = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const k of TELLERS) {
    const t = cleanTeller(src[k]);
    if (t.name || t.phrase || t.person !== 'follow' || t.echo) out[k] = t;
  }
  return out;
}

/* FIRST PERSON OR SECOND (M334): what the box's own opening words say the teller IS. Cozy Tavern counted every
 * "I", "my" and "me" — but his boxes here are his own instructions as often as a self ("Keep my lyrical voice",
 * "I want it slow"), and those are HIM speaking, not the teller. So the first person is read only from a teller
 * that says what it is as "I" — "I am Tony Stark", "I’m Hulk" — near the top, and never where the box says
 * "You are…" too; anything else is the second person, as every word was before. */
export function framePerson(text) {
  const head = String(text || '').slice(0, 800);
  if (/\byou(?:\s+are|[’']re)\b/i.test(head)) return 'second';
  return /(?:^|[\s"“(])(?:I am|I[’']m)\b/.test(head.slice(0, 300)) ? 'first' : 'second';
}
export function personFor(teller, boxText) {
  const p = teller && teller.person;
  if (p === 'first' || p === 'second') return p;
  return framePerson(boxText);
}
/* a teller named in Who is telling, or a box in the first person: he is writing WITH someone, not working a tool.
 * (Cozy Tavern counted his own name too — there it lives beside the teller's in The frame. Here Your name came
 * long before any teller and speaks for him in the notes, so the teller's own name, or its "I", is what says so.) */
export function hasSelf(teller, person) {
  return Boolean((teller && teller.name) || person === 'first');
}

/* "Tony — " before a line the app says to the teller in his turn (its first letter lowered, as after a dash) */
export function toTeller(text, name) {
  const t = cleanTellerName(name);
  const s = String(text == null ? '' : text);
  if (!t || !s.trim()) return s;
  if (s.startsWith(`${t} — `)) return s;
  const body = (/^[A-Z][a-z’']/.test(s) || /^A /.test(s)) && !/^I\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
  return `${t} — ${body}`;
}

/* THE GROUNDING PHRASE (M358, M359): said where a reader would put it — once in the first breath after the
 * opening paragraph, and once more at the paragraph break nearest a third of the way down; never inside a
 * paragraph, never more than twice */
export function groundingSaid(phrase, person = 'second') {
  const p = cleanPhrase(phrase);
  /* (a phrase that ends its own sentence is not given a second full stop after the quote) */
  return `${person === 'first' ? 'I open' : 'You open'} every thought with “${p}”${/[.!?…]$/.test(p) ? '' : '.'}`;
}
export function groundingWeave(text, phrase, person = 'second') {
  const body = String(text == null ? '' : text);
  const said = cleanPhrase(phrase);
  if (!said || !body.trim()) return body;
  const line = groundingSaid(said, person);
  if (body.includes(line)) return body;
  const parts = body.split(/\n\n+/);
  if (parts.length < 2) return `${line}\n\n${body}`;
  const at = (n) => parts.slice(0, n).join('\n\n').length;
  const third = body.length / 3;
  let best = 1;
  for (let i = 1; i < parts.length; i += 1) if (Math.abs(at(i) - third) < Math.abs(at(best) - third)) best = i;
  const out = [...parts];
  if (best > 1) out.splice(best, 0, line);
  out.splice(1, 0, line);
  return out.join('\n\n');
}
/* what the thinking itself is started with, where the model takes a seed */
export function groundingSeed(phrase) {
  const p = cleanPhrase(phrase);
  return p ? `${p} ` : '';
}

/* ONE "YOU ARE" (M333): his box says who the teller IS; his preset's narrator also said "You are an unbiased
 * cinematographer." — a second self, and the plainer of the two. With a teller named, it is a manner. */
export function oneYouAre(text, teller) {
  const s = String(text == null ? '' : text);
  if (!(teller && teller.name) || !s) return s;
  return s.replace(/\bYou are an unbiased cinematographer\./g, 'You tell it the way an unbiased cinematographer would.');
}

/* THE LAST LOOK, TURNED OVER LIKE A PERSON (M335): the crafts asked for it "in your own head" as a list of
 * checks — and a mind told to think in a checklist thinks in one. For a teller with a self the same checks are
 * asked for the way a person turns a scene over before telling it. The checks themselves are untouched. */
export const LOOK_LEAD = 'Before a word reaches the page, in your own head and never on it: ';
export const LOOK_NATURAL = 'Before a word reaches the page, turn it over in your head the way you would before telling it to a friend — briefly, in your own voice, in plain sentences about these people: what each of them wants right now, what each of them actually saw or was told, what it will cost. Never name a rule, a heading, or where a fact is written while you think — say “she can’t know that yet, she only saw the truck go by”, never “the trace says”; no labels, no checklist. And make sure, in your own words, of these: ';
export function naturalLook(text, self) {
  const s = String(text == null ? '' : text);
  if (!self || !s.includes(LOOK_LEAD)) return s;
  return s.split(LOOK_LEAD).join(LOOK_NATURAL);
}

/* --------------------------------------------------------- I and you
 * The app's own standing words speak as him to the teller: "I bring you premises… you write the novel". For a
 * teller that thinks as "I", those words become the teller's notes to itself, and he is "you" in them: "you
 * bring me premises… I write the novel". English says I and you with the same verb, but for "to be" (I am,
 * you are; I was, you were) — so the two trade places, once each, in one pass. Words in quotation marks are
 * examples of story text and are never touched, nor a line that is a list of phrases, nor a pronoun set off by
 * slashes (the word itself being talked about). */
const OBJECT_BEFORE = 'to|for|with|from|of|at|by|on|in|about|than|toward|towards|against|before|after|behind|beside|around|over|under|between|without|upon|onto|into|like|unlike|hands?|handed|gives?|gave|tells?|telling|told|asks?|asking|asked|shows?|showed|lets?|sends?|sent|reach(?:es)?|serves?|binds?|holds?|held|calls?|called|costs?|fails?|gets?|got|makes?|made|keeps?|kept|helps?|helped|reminds?|warns?|ruin|ruins|trust|trusts|want|wants|wanted|need|needs|requires?|allows?|forces?|expects?|leaves?|left|brings?|brought|takes?|took|puts?|sees?|saw|hears?|heard|watch(?:es)?|teach(?:es)?|taught|stops?|permits?|invites?|orders?|instructs?|thanks?|owes?|pays?|paid|meets?|met|joins?|finds?|found|offers?|answers?|interrupts?|follows?|leads?|led|loves?|hates?|surprises?|fools?|wakes?|beats?|saves?|spares?|hits?|catch(?:es)?|caught|grabs?|pulls?|push(?:es)?|touch(?:es)?|hurts?|kills?|lose|loses|lost|guide|guides|bring|automatically|is|was|be|being|been';
const OBJECT_RE = new RegExp(`(?:^|[^\\w’'])(?:${OBJECT_BEFORE})[ \\t]+$`, 'i');
const SWAP = {
  'I’m': 'you’re', "I'm": "you're", 'I’ve': 'you’ve', "I've": "you've", 'I’ll': 'you’ll', "I'll": "you'll", 'I’d': 'you’d', "I'd": "you'd",
  'you’re': 'I’m', "you're": "I'm", 'you’ve': 'I’ve', "you've": "I've", 'you’ll': 'I’ll', "you'll": "I'll", 'you’d': 'I’d', "you'd": "I'd",
  myself: 'yourself', yourself: 'myself', mine: 'yours', yours: 'mine', my: 'your', your: 'my', me: 'you',
};
const BE_I = { am: 'are', was: 'were', "wasn't": "weren't", 'wasn’t': 'weren’t' };
const BE_YOU = { are: 'am', were: 'was', "weren't": "wasn't", 'weren’t': 'wasn’t', "aren't": 'am not', 'aren’t': 'am not' };
const cap = (w) => w[0].toUpperCase() + w.slice(1);
function sentenceStart(before) {
  const t = before.replace(/[ \t]+$/, '');
  return !t || /[.!?\n]$/.test(t) || /(?:^|\n)#+$/.test(t) || /[.!?]["”’)]$/.test(t) || /(?:^|\n)[ \t]*[-*•]$/.test(t);
}
const TOKEN = /(I[’']m|I[’']ve|I[’']ll|I[’']d|[Yy]ou[’']re|[Yy]ou[’']ve|[Yy]ou[’']ll|[Yy]ou[’']d|[Mm]yself|[Yy]ourself|[Mm]ine|[Yy]ours|[Mm]y|[Yy]our|[Mm]e|I|[Yy]ou)\b(?:([ \t]+)(am|are|was|were|wasn[’']t|weren[’']t|aren[’']t)\b)?/g;
function swapChunk(chunk) {
  return chunk.replace(TOKEN, (m, word, gap, be, at, whole) => {
    const prev = whole[at - 1] || '';
    const next = whole[at + word.length] || '';
    /* a pronoun set off by slashes, or inside a word, is the word itself — and so is "the I of the fiction" */
    if (prev === '/' || next === '/' || /[\w’']/.test(prev)) return m;
    const before = whole.slice(0, at);
    if (/(?:^|[^\w’'])(?:the|a|an)[ \t]+$/i.test(before)) return m;
    const starts = sentenceStart(before);
    const lower = word.toLowerCase();
    const tail = (b, map) => (b ? gap + (map[b.toLowerCase()] || map[b.replace('’', "'").toLowerCase()] || b) : '');
    if (word === 'I') {
      const out = starts ? 'You' : 'you';
      return out + tail(be, BE_I);
    }
    if (lower === 'you') {
      /* an object "you" follows its verb or preposition on the same line ("hands you the truth"); "you to <verb>" is one too */
      const object = OBJECT_RE.test(before.split('\n').pop()) || /^[ \t]+to[ \t]+[a-z]/.test(whole.slice(at + word.length));
      if (object && !be) return 'me';
      return 'I' + tail(be, BE_YOU);
    }
    const base = SWAP[word] || SWAP[lower] || word;
    /* "I’m" → "you’re" (capital where a sentence starts); "Your" → "My"; "you’re" → "I’m" */
    const out = /^I[’']/.test(word) ? (starts ? cap(base) : base) : /^[A-Z]/.test(word) ? cap(base) : base;
    return out + (be ? gap + be : '');
  });
}
/* a line that is mostly commas is a list of phrases being named ("…, ruin you, don't you dare, …"), not words to someone */
const phraseList = (line) => (line.match(/,/g) || []).length >= 12 && (line.match(/,/g) || []).length * 28 >= line.length;
export function swapPerson(text) {
  const s = String(text == null ? '' : text);
  if (!s) return s;
  return s.split('\n').map((line) => (phraseList(line) ? line
    : line.split(/("[^"\n]{0,400}"|“[^”\n]{0,400}”)/).map((part, i) => (i % 2 ? part : swapChunk(part))).join(''))).join('\n');
}

/* his words where the book and its notes are handed over — in the first person they are the teller's notes
 * about HIM, so the lines of his ownership there say "you" too. Only these exact lines of the app's: never a
 * word of the book. */
const HEADS_FIRST = [
  ['Where it\'s headed — my plans for later.', 'Where it\'s headed — your plans for later.'],
  ['My choices for the book’s prose:', 'Your choices for the book’s prose:'],
  ['My own writing instructions, and anything I ask for in a particular passage, come first.', 'Your own writing instructions, and anything you ask for in a particular passage, come first.'],
  ['Whatever I left unchosen follows my instructions', 'Whatever you left unchosen follows your instructions'],
  ['How I mean the book to end', 'How you mean the book to end'],
  ['My bibliography of the book', 'Your bibliography of the book'],
  ['my bibliography of the book', 'your bibliography of the book'],
  ['unless I say always or never', 'unless you say always or never'],
  ['What I mean this chapter to do — my plan for it.', 'What you mean this chapter to do — your plan for it.'],
  ["(the chapter you're writing now)", "(the chapter I'm writing now)"],
  ["(the chapter you're working in)", "(the chapter I'm working in)"],
];
export function headsInPerson(text, person) {
  let s = String(text == null ? '' : text);
  if (person !== 'first' || !s) return s;
  for (const [a, b] of HEADS_FIRST) s = s.split(a).join(b);
  return s;
}
