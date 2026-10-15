/* Quote boundaries: actual search results, no model calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
/* Search also imports change handling; no browser news channel is needed
 * for these pure fixtures (Node's channel otherwise keeps the process open). */
const channel = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = undefined;
const { findIn } = await import('../js/novel/search.js');
globalThis.BroadcastChannel = channel;

test('whole quotations reject another word’s prefix or suffix', () => {
  for (const words of [false, true]) {
    assert.deepEqual(findIn('She left early. Mara ranted.', 'he left', { whole: true, words }), []);
    assert.deepEqual(findIn('Mara ranted.', 'Mara ran', { whole: true, words }), []);
    assert.deepEqual(findIn('There were 123 lanterns.', '12', { whole: true, words }), []);
  }
});
test('an invalid first occurrence does not hide the real quote later', () => {
  const text = 'She left early. Then **he** left late.';
  const [hit] = findIn(text, 'he left', { whole: true, max: 1 });
  assert.equal(text.slice(hit.start, hit.end), 'he** left');
  assert.equal(findIn(text, 'he left', { max: 1 })[0].start, 1, 'ordinary partial search is unchanged');
});
test('whole quotation matching respects accented and non-Latin word boundaries', () => {
  for (const [text, query] of [['Élodie', 'lodie'], ['Привет', 'ривет'], ['مرحبا', 'رحب'], ['𐐀𐐁𐐂', '𐐁']]) {
    assert.deepEqual(findIn(text, query, { whole: true }), []);
  }
  assert.equal(findIn('“Élodie”, she said.', 'Elodie', { whole: true }).length, 1);
});
test('real quotes remain available in prose written without spaces between words', () => {
  for (const [text, query] of [['她微笑着递来一杯茶。', '递来一杯茶'], ['彼は小さな竜にお茶を渡した。', '小さな竜'], ['เธอส่งถ้วยชาให้เขา', 'ถ้วยชา'], ['她说hello然后走开。', 'hello']]) {
    for (const words of [false, true]) assert.equal(findIn(text, query, { whole: true, words }).length, 1, text);
  }
});
