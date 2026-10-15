/* Provider edge cases: pure local fixtures, no server or model calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readAnswer, readChunk, buildRequest } from '../js/model/providers.js';
import { slotPattern, makeStructuredDecoder, unwrapStructured, hiddenMatcher, structuredSchema } from '../js/model/structured.js';

test('malformed content blocks leave the provider’s valid answer and thinking readable', () => {
  const malformed = [null, 7, { text: { wrong: true } }, { type: 'text', text: null }];
  const openai = readAnswer('openai', { choices: [{ message: { content: [...malformed, { type: 'text', text: 'The surviving page.' }] } }] });
  assert.equal(openai.text, 'The surviving page.');
  const anthropic = readAnswer('anthropic', { content: [...malformed, { type: 'thinking', thinking: null }, { type: 'thinking', thinking: 'A thought.' }, { type: 'text', text: 'The surviving page.' }] });
  assert.equal(anthropic.text, 'The surviving page.');
  assert.equal(anthropic.thinking, 'A thought.');
  assert.equal(readChunk('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: { wrong: true } } }).text, '');
  assert.equal(readChunk('anthropic', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: ['wrong'] } }).thinking, '');
});

test('structured answers use the top-level response, regardless of earlier metadata or alternate fields', () => {
  const fixtures = [
    '{"metadata":{"text":"internal label"},"response":"The actual story."}',
    '{"content":"internal label","response":"The actual story."}',
    '{"metadata":{"response":"internal label"},"response":"The actual story."}',
    '{"metadata":[{"response":"internal label"}],"response":"The actual story."}',
    '{"metadata":"' + 'x'.repeat(600) + '","response":"The actual story."}',
    '{"res\\u0070onse":"The actual story."}',
  ];
  for (const raw of fixtures) {
    assert.equal(unwrapStructured(raw), 'The actual story.');
    for (let at = 1; at < raw.length; at += 1) {
      const decoder = makeStructuredDecoder();
      const streamed = decoder.feed(raw.slice(0, at)) + decoder.feed(raw.slice(at)) + decoder.end();
      assert.equal(streamed, 'The actual story.', `split at ${at}: ${raw.slice(0, 80)}`);
      assert.equal(decoder.words(), streamed);
    }
  }
});

test('structured decoding preserves streamed escapes, hidden openings and early completion', () => {
  const raw = JSON.stringify({ response: 'Secret plan. The page says "hello".\nA lamp glows. 🕯' });
  const decoder = makeStructuredDecoder({ hidden: hiddenMatcher('Secret plan. [[keep]]') });
  let streamed = '';
  for (const ch of raw.slice(0, -1)) streamed += decoder.feed(ch);
  assert.equal(decoder.closed(), true, 'the response closes before any trailing object or provider padding');
  streamed += decoder.end();
  assert.equal(streamed, 'The page says "hello".\nA lamp glows. 🕯');
  assert.equal(decoder.feed(' ignored provider padding'), '');
  assert.equal(unwrapStructured('{"reply":"The page."}'), 'The page.');
  assert.equal(unwrapStructured('{"content":"The page."}'), 'The page.');
  assert.equal(unwrapStructured('The plain page.'), 'The plain page.');
  assert.equal(unwrapStructured('{a page with an unmatched brace'), '{a page with an unmatched brace');
});

test('every custom template keeps the root response schema; recovery aliases wait for root response priority', () => {
  for (const template of ['Your opening', '[[number:10-100]] [[end]]', '{"text":"Your opening"}', '<think>A plan.</think> [[keep]]The page:']) {
    const schema = structuredSchema(template);
    assert.deepEqual(Object.keys(schema.properties), ['response']);
    assert.deepEqual(schema.required, ['response']);
    assert.equal(schema.additionalProperties, false);
  }
  for (const key of ['text', 'content', 'value', 'reply']) {
    const decoder = makeStructuredDecoder();
    assert.equal(decoder.feed(JSON.stringify({ metadata: { response: 'Nested text is not the page.' }, [key]: 'The recovered page.' })), '');
    assert.equal(decoder.end(), 'The recovered page.');
    assert.equal(decoder.words(), 'The recovered page.');
    const later = makeStructuredDecoder();
    assert.equal(later.feed(`{"${key}":"Earlier alternate field.",`), '');
    assert.equal(later.feed('"response":"The real page."}'), 'The real page.');
    assert.equal(later.end(), '');
  }
  assert.equal(unwrapStructured('{"metadata":{"response":"Nested text."},"response":""}'), '');
});

test('malformed structured prefixes have bounded buffering and preserve every original word', () => {
  const decoder = makeStructuredDecoder();
  const first = '{not JSON: ' + 'words '.repeat(100);
  assert.equal(decoder.feed(first), '');
  const rest = 'more words '.repeat(7000);
  assert.equal(decoder.feed(rest), first + rest, 'a long prefix is released without waiting for an absent response field');
  assert.equal(decoder.feed(' and the last words.'), ' and the last words.');
  assert.equal(decoder.end(), '');
  assert.equal(decoder.words(), first + rest + ' and the last words.');
});

test('number slots enforce their exact inclusive bounds across decimal widths', () => {
  for (const [lo, hi] of [[0, 0], [1, 100], [10, 100], [98, 143], [310, 942], [0, 9999], [9001, 9999]]) {
    const pattern = new RegExp('^(?:' + slotPattern(`number:${lo}-${hi}`) + ')$');
    for (let n = -1; n <= 10000; n += 1) assert.equal(pattern.test(String(n)), n >= lo && n <= hi, `${lo}-${hi}: ${n}`);
    assert.equal(pattern.test('00'), false);
    assert.equal(pattern.test('01'), false);
    assert.equal(pattern.test('10.5'), false);
  }
});

test('explicit zero and non-default generation dials remain exact', () => {
  const conn = { url: 'https://example.test/v1', model: 'plain', temperature: 0, topP: 0.73, topK: 37, minP: 0, seed: 0, presencePenalty: -0.4, frequencyPenalty: 0.2, repetitionPenalty: 1.04, stop: ['THE END'] };
  const { body } = buildRequest(conn, { messages: [{ role: 'user', content: 'Write.' }], maxTokens: 777 });
  assert.deepEqual(Object.fromEntries(['temperature', 'top_p', 'top_k', 'min_p', 'seed', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'stop', 'max_tokens'].map((key) => [key, body[key]])), {
    temperature: 0, top_p: 0.73, top_k: 37, min_p: 0, seed: 0, presence_penalty: -0.4, frequency_penalty: 0.2, repetition_penalty: 1.04, stop: ['THE END'], max_tokens: 777,
  });
});
