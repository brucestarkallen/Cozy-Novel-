/* The page's own repairs held to what they promise, on many pages made at random (2.12.35): the speech marks
 * (`mendMarks`) and the spaces (`mendSpacing`) change quotation marks, asterisks and white space only — never a letter;
 * each, made twice, makes the same page; the marks' repair after the spaces changes nothing; and no fault the checker
 * would set by itself is left on a page the repairs made. A card's words stand in one place (`uniqueAround`,
 * `changeSpan`), and putting a change's find → replace in gives the very words it meant. Pure: no model, no server. */
import assert from 'node:assert/strict';
import { mendMarks, mendSpacing, speechFaults, spacingSlips, uniqueAround, changeSpan } from '../js/novel/textshape.js';

let passed = 0;
function test(name, work) { work(); passed++; console.log('ok   ' + name); }

let seed = 20251019;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['she', 'said', 'go', 'now', 'Mara', 'the', 'door', 'rock', "'n'", 'roll', "'tis", "Joneses'", "don't", 'wait', 'CLANG!', 'THUD', 'Nngh—!', '12', "5'9", '3,000', '9:30', 'yes', 'He', 'It', 'run'];
const PUNCT = ['', '', '', ',', '.', '!', '?', '…', '...', '—', ';', ':'];
const QUOTE = ['"', '"', '"', '“', '”', '*', '**', '"*', '*"'];
function paragraph() {
  let s = '';
  for (let i = 2 + Math.floor(rnd() * 10); i > 0; i--) {
    if (rnd() < 0.25) s += pick(QUOTE);
    s += pick(WORDS) + pick(PUNCT);
    if (rnd() < 0.2) s += pick(QUOTE);
    s += rnd() < 0.9 ? ' ' : '';
  }
  return s.trim();
}
function page() {
  const out = [];
  for (let i = 1 + Math.floor(rnd() * 6); i > 0; i--) { const r = rnd(); out.push(r < 0.05 ? '* * *' : r < 0.08 ? '## Heading' : paragraph()); }
  return out.join(rnd() < 0.8 ? '\n\n' : '\n');
}
const letters = (t) => t.replace(/["“”*\s]/g, '');
const N = Number(process.env.FUZZ_PAGES) || 20000;

test(`the repairs keep every letter, and made again change nothing (${N.toLocaleString()} pages)`, () => {
  for (let k = 0; k < N; k++) {
    const x = page();
    const a = mendMarks(x).text;
    assert.equal(letters(a), letters(x), `a letter changed: ${JSON.stringify(x)} → ${JSON.stringify(a)}`);
    assert.equal(mendMarks(a).text, a, `the marks' repair made twice made another page: ${JSON.stringify(x)}`);
    const s = mendSpacing(a).text;
    assert.equal(s.replace(/\s/g, ''), a.replace(/\s/g, ''), `the spaces changed more than white space: ${JSON.stringify(a)}`);
    assert.equal(mendSpacing(s).text, s, `the spaces made twice made another page: ${JSON.stringify(a)}`);
    assert.equal(mendMarks(s).text, s, `the marks' repair after the spaces changed the page: ${JSON.stringify(x)} → ${JSON.stringify(s)}`);
    const known = speechFaults(s).filter((f) => f.mended);
    assert.equal(known.length, 0, `a fault with a known fix left on a repaired page: ${JSON.stringify(s)}`);
  }
});

test('what the repairs never touch: measures, initialisms, figures, titles, French spacing, tags, code and entities', () => {
  for (const t of ['She framed the 8"x10" photo over a 2"x4" shelf.', 'He was 6\'2" and she was 5\'9" tall.', 'The 12" blade and the 6" knife.', 'U.S.A. and Ph.D. at 9:30, 3,000 of them, on Re:Zero.', 'Il dit : bonjour ; et puis il partit.', 'Mara <span style="color:red">ran</span>. She went.', 'He typed `a,b;c:d` and left.', 'It was&nbsp;late, &mdash;she said.']) {
    assert.equal(mendMarks(t).text, t, t);
    assert.deepEqual(spacingSlips(t), [], t);
  }
  /* a stray asterisk before a quote that stands is never made a quote: the speech is the checker's to set */
  const stray = '*"Help me, she begged. "Please."';
  assert.equal(mendMarks(stray).text, stray);
  assert.equal(mendMarks(mendSpacing(stray).text).text, stray);
});

test('what the spaces set right', () => {
  for (const [t, want] of [['ash.She looked at him.', 'ash. She looked at him.'], ['yes,she said.', 'yes, she said.'], ['"Fine",she said.', '"Fine", she said.'], ['"Go,"she said.', '"Go," she said.'], ['He said,"Wait."', 'He said, "Wait."'], ['a word , then', 'a word, then'], ['It was&nbsp;late.Then dark.', 'It was&nbsp;late. Then dark.']]) assert.equal(mendSpacing(t).text, want, t);
});

test('a card’s words stand in one place, and its find → replace makes the very words meant (30,000 changes)', () => {
  const vocab = ['she', 'said', '"Go."', 'Go.', 'go', 'the', 'door', '\n\n', '\n', ' ', '  ', 'a', 'aa', 'Ha', 'ha'];
  for (let k = 0; k < 30000; k++) {
    let src = '';
    for (let i = 1 + Math.floor(rnd() * 30); i > 0; i--) src += pick(vocab) + (rnd() < 0.7 ? ' ' : '');
    if (rnd() < 0.3) src += src;
    if (!src.trim()) continue;
    const s = Math.floor(rnd() * (src.length + 1));
    const e = s + Math.floor(rnd() * (src.length - s + 1));
    const u = uniqueAround(src, s, e);
    assert.ok(u.start <= s && u.end >= e, JSON.stringify({ src, s, e, u }));
    if (u.find.trim()) assert.equal(src.indexOf(u.find), src.lastIndexOf(u.find), JSON.stringify({ src, s, e, u }));
    const next = pick(['', 'X', `"${src.slice(s, e)}"`, `${src.slice(s, e)} `, ` ${src.slice(s, e)}`]);
    const c = changeSpan(src, s, e, next);
    if (!c.find) continue;
    assert.equal(src.indexOf(c.find), src.lastIndexOf(c.find), JSON.stringify({ src, s, e, next, c }));
    const at = src.indexOf(c.find);
    assert.equal(src.slice(0, at) + c.replace + src.slice(at + c.find.length), src.slice(0, s) + next + src.slice(e), JSON.stringify({ src, s, e, next, c }));
  }
});

console.log(`textshape fuzz: ${passed} passed, 0 failed`);
