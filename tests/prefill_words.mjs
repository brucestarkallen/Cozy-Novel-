/* Persona words in ready-made prefills, including provider fallbacks.
 * Pure request fixtures: no server, credentials or model calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fillPreset, presetWords, STRUCTURED_PRESETS, structuredSchema } from '../js/model/structured.js';
import { buildRequest, prefillPlan } from '../js/model/providers.js';

test('ready-made prefills preserve persona words and whitespace exactly', () => {
  for (const words of ['  I am [[The Lantern Keeper]].\n\t', 'Hulk thinks: tiny lantern, big responsibility!', 'A [[title without a slot]] and an unfinished [[ mark.', 'Funny Batman\r\nkeeps his own rhythm.']) {
    assert.equal(presetWords(words), words);
    for (const preset of STRUCTURED_PRESETS) {
      const made = fillPreset(preset.id, words);
      assert.equal(made.error, undefined);
      assert.equal(made.prefill, preset.build(words));
    }
  }
});

test('templates that need words reject whitespace without changing optional words', () => {
  for (const id of ['line', 'think']) for (const words of ['', ' \n\t ', null]) {
    const made = fillPreset(id, words);
    assert.match(made.error, /needs your words/);
    assert.equal(made.prefill, undefined);
  }
  for (const id of ['plan', 'brainstorm']) {
    const preset = STRUCTURED_PRESETS.find(p => p.id === id);
    assert.equal(fillPreset(id, ' \n\t ').prefill, preset.build(' \n\t '));
  }
});

test('literal-word fields reject template controls instead of silently altering them', () => {
  const controls = ['[[keep]]', '[[end]]', '[[stop]]', '[[eos]]', '[[pg]]', '[[w:2]]', '[[words:2-4]]', '[[opt:A|B]]', '[[options:A|B]]', '[[line]]', '[[lines:2]]', '[[free]]', '[[num]]', '[[number:1-3]]', '[[emotion]]', '[[mood]]', '[[name]]', '[[action]]', '[[thought]]', '[[re:.*]]', '[[regex:.*]]', '[[ KEEP ]]', '<think>', '</think>', '<THINK>'];
  for (const control of controls) for (const preset of STRUCTURED_PRESETS) {
    const words = `My own ${control} words.`;
    assert.equal(presetWords(words), words);
    const made = fillPreset(preset.id, words);
    assert.match(made.error, /your words were not added/);
    assert(made.error.includes(control));
    assert.equal(made.prefill, undefined);
  }
});

test('unknown bracketed persona names remain literal in the structured pattern', () => {
  const words = 'I am [[The Lantern Keeper]].';
  const made = fillPreset('line', words);
  const pattern = new RegExp(structuredSchema(made.prefill, { minChars: 1 }).properties.response.pattern);
  assert(pattern.test(words + ' The lantern wakes.'));
  assert(!pattern.test('I am The Lantern Keeper. The lantern wakes.'));
});

test('unsupported structured providers retain unknown bracketed words and thinking seeds', () => {
  const words = 'I am [[The Lantern Keeper]].';
  const conn = { url: 'https://api.deepseek.com/v1', model: 'sample', thinking: 'off', prefillMode: 'structured' };
  const normal = buildRequest({ ...conn, prefill: fillPreset('line', words).prefill }, { system: 'Keep my own voice.', messages: [{ role: 'user', content: 'Carry on.' }] });
  assert.equal(normal.body.messages.at(-1).content, words);
  assert.equal(normal.body.messages[0].content, 'Keep my own voice.');
  const thinking = prefillPlan({ ...conn, prefill: fillPreset('think', words).prefill });
  assert.equal(thinking.seed, words);
  assert.equal(thinking.content, '');
});

test('direct structured controls keep their existing pattern and fallback behavior', () => {
  const template = '<plan>Plan [[w:2]]</plan>\n[[keep]][[The Lantern Keeper]] says [[opt:hello|goodbye]]';
  const pattern = new RegExp(structuredSchema(template, { minChars: 1 }).properties.response.pattern);
  assert(pattern.test('<plan>Plan next move</plan>\n[[The Lantern Keeper]] says hello.'));
  const fallback = prefillPlan({ url: 'https://api.deepseek.com/v1', model: 'sample', thinking: 'off', prefillMode: 'structured', prefill: template });
  assert.equal(fallback.content, '[[The Lantern Keeper]] says');
});
