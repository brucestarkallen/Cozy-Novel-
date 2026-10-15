/* Craft routing and preservation, with synthetic records and no model calls.
 * Run: node tests/craft.mjs
 */
import assert from 'node:assert/strict';
import { NOVEL_CRAFT, SCENE_CRAFT, VOICE_RULE, SOUND, wakesOn } from '../js/novel/crafts.js';
import { builtinOf, listModules, moduleOf, moduleSteps, ridingFor } from '../js/novel/modules.js';
import { cleanOwn, ownSteps, ownWordsFor } from '../js/novel/ownwords.js';
import { cleanVoice, presetSteps, startingVoice, voiceOf, sameVoice } from '../js/novel/presets.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`✓ ${name}`); };
const novel = { prefs: { sound: 'novel' } };
const custom = '\n  Preserve my line breaks.\r\n\tAnd this indentation.  \n';

for (const purpose of ['write', 'play']) {
  test(`${purpose}: a changed built-in module keeps every character`, () => {
    const id = purpose === 'write' ? 'novel-craft' : 'scene-craft';
    const house = { modules: { [id]: { text: custom } } };
    const before = structuredClone(house);
    assert.equal(ridingFor(house, novel, purpose).always[0], custom);
    assert.equal(moduleOf(house, id).ownWords, true);
    assert.deepEqual(house, before);
  });
}

test('custom modules retain text and user ordering after built-in modules', () => {
  const house = { modules: {
    newer: { custom: true, at: 20, name: 'Later', text: `${custom}later\n`, to: ['writer'], rides: 'always' },
    older: { custom: true, at: 10, name: 'Earlier', text: custom, to: ['writer'], rides: 'always' },
  } };
  const ride = ridingFor(house, novel, 'write');
  assert.ok(ride.always.indexOf(custom) > ride.always.indexOf(NOVEL_CRAFT));
  assert.ok(ride.always.indexOf(`${custom}later\n`) > ride.always.indexOf(custom));
});

test('a conditional custom module keeps exact text only when its condition wakes', () => {
  const house = { modules: { custom: { custom: true, text: custom, to: ['writer'], rides: 'fight' } } };
  assert.ok(!ridingFor(house, novel, 'write').woken.includes(custom));
  assert.ok(ridingFor(house, novel, 'write', { fight: true }).woken.includes(custom));
  assert.ok(!ridingFor(house, novel, 'play', { fight: true }).woken.includes(custom));
});

test('empty and switched-off module overrides do not revive a built-in default', () => {
  const empty = { modules: { 'novel-craft': { text: ' \r\n\t ' } } };
  assert.ok(!ridingFor(empty, novel, 'write').always.includes(NOVEL_CRAFT));
  const off = { modules: { 'novel-craft': { rides: 'off' } } };
  assert.ok(!ridingFor(off, novel, 'write').always.includes(NOVEL_CRAFT));
});

test('default updates do not replace a custom version or a deliberate empty module', () => {
  const house = { modules: {} };
  moduleSteps.set('novel-craft', { text: custom })(house);
  assert.equal(moduleOf(house, 'novel-craft').text, custom);
  moduleSteps.set('novel-craft', { text: '' })(house);
  assert.equal(moduleOf(house, 'novel-craft').text, '');
  moduleSteps.remove('novel-craft')(house);
  assert.equal(moduleOf(house, 'novel-craft').text, NOVEL_CRAFT);
});

test('restoring a removed module preserves its exact custom words', () => {
  const house = { modules: { mine: { custom: true, text: custom, name: 'Mine', to: ['narrator'], rides: 'always' } } };
  const row = structuredClone(house.modules.mine);
  moduleSteps.remove('mine')(house);
  moduleSteps.restore('mine', row)(house);
  assert.equal(ridingFor(house, novel, 'play').always.find(t => t === custom), custom);
  row.text = 'Changed elsewhere';
  assert.equal(house.modules.mine.text, custom);
});

test('novel and scene crafts remain separate and are never sent to the partner by default', () => {
  assert.ok(ridingFor({}, novel, 'write').always.includes(NOVEL_CRAFT));
  assert.ok(!ridingFor({}, novel, 'write').always.includes(SCENE_CRAFT));
  assert.ok(ridingFor({}, novel, 'play').always.includes(SCENE_CRAFT));
  assert.ok(!ridingFor({}, novel, 'play').always.includes(NOVEL_CRAFT));
  assert.deepEqual(ridingFor({}, novel, 'partner'), { always: [], woken: [], names: [] });
});

test('changing narrative person does not silently replace a custom craft', () => {
  const house = { modules: { 'novel-craft': { text: custom } } };
  for (const pov of ['first', 'second', 'third-limited', 'third-omniscient']) {
    assert.equal(ridingFor(house, { prefs: { pov, sound: 'novel' } }, 'write').always[0], custom);
  }
});

test('sound selection remains independent of the revised writing craft', () => {
  for (const sound of ['comic', 'novel']) {
    const ride = ridingFor({}, { prefs: { sound } }, 'write', { fight: true });
    assert.ok(ride.always.includes(SOUND[sound].always));
    assert.ok(ride.woken.includes(SOUND[sound].fight));
    assert.ok(ride.always.includes(VOICE_RULE));
  }
});

for (const role of ['teller', 'you', 'house']) {
  for (const place of ['before-pages', 'before-your-message', 'after-your-message']) {
    test(`own words preserve text for ${role} at ${place}`, () => {
      const house = { ownWords: [{ id: 'mine', role, place, to: 'both', text: custom, on: true }] };
      const before = structuredClone(house);
      for (const purpose of ['write', 'play']) {
        const [entry] = ownWordsFor(house, purpose);
        assert.equal(entry.text, custom);
        assert.equal(entry.place, place);
        assert.equal(entry.role, { teller: 'assistant', you: 'user', house: 'system' }[role]);
      }
      assert.deepEqual(house, before);
    });
  }
}

test('filling names changes only the intended macros in own words', () => {
  const original = '\n  {{char}} says to {{user}}:\n\tkeep this.  \n';
  const [entry] = ownWordsFor({ ownWords: [{ id: 'mine', text: original }] }, 'write', t => t.replaceAll('{{char}}', 'Mina').replaceAll('{{user}}', 'River'));
  assert.equal(entry.text, '\n  Mina says to River:\n\tkeep this.  \n');
});

test('empty, switched-off, and other-reader own words do not ride', () => {
  const house = { ownWords: [
    { id: 'empty', text: '\n  \t' },
    { id: 'off', text: custom, on: false },
    { id: 'scene', text: custom, to: 'play' },
  ] };
  assert.deepEqual(ownWordsFor(house, 'write'), []);
  assert.equal(ownWordsFor(house, 'play')[0].text, custom);
  assert.deepEqual(ownWordsFor(house, 'partner'), []);
});

test('own-word removal and Undo keep exact text and placement', () => {
  const house = { ownWords: [{ id: 'a', text: 'A' }, { id: 'b', text: custom, place: 'before-pages' }, { id: 'c', text: 'C' }] };
  const row = structuredClone(house.ownWords[1]);
  ownSteps.remove('b')(house);
  ownSteps.restore(row, 1)(house);
  assert.deepEqual(ownWordsFor(house, 'write').map(w => w.text), ['A', custom, 'C']);
  assert.equal(cleanOwn(house.ownWords)[1].place, 'before-pages');
});

test('preset save, export/import cleanup, and use preserve every custom instruction', () => {
  const house = {
    instructions: Object.fromEntries(['system', 'narrator', 'partner', 'late', 'lateNarrator', 'avoid'].map((key, i) => [key, `${custom}${i}\n`])),
    you: { name: 'River' },
    ownWords: [{ id: 'own', text: custom, on: true, role: 'teller', to: 'both', place: 'before-pages' }],
    modules: { 'novel-craft': { text: custom }, 'scene-craft': { rides: 'off' } },
  };
  const original = voiceOf(house), modules = structuredClone(house.modules);
  presetSteps.save('one', 'My voice', original, 1)(house);
  const imported = cleanVoice(JSON.parse(JSON.stringify(house.presets[0].voice)));
  presetSteps.use(startingVoice('River'))(house);
  presetSteps.use(imported, 'one')(house);
  assert.deepEqual(voiceOf(house), original);
  assert.deepEqual(house.modules, modules);
  assert.ok(sameVoice(voiceOf(house), original));
});

test('an older preset without own words leaves those entries intact', () => {
  const house = { ownWords: [{ id: 'one', text: custom }] };
  const old = { boxes: { system: custom, narrator: '', partner: '', late: '', lateNarrator: '', avoid: '' }, name: '' };
  presetSteps.use(old)(house);
  assert.equal(house.instructions.system, custom);
  assert.equal(house.instructions.narrator, '');
  assert.equal(ownWordsFor(house, 'write')[0].text, custom);
});

test('built-in craft changes never mutate an explicit custom module during listing', () => {
  const house = { modules: { 'novel-craft': { text: 'My original craft.\n' }, 'voice': { text: '' } } };
  const before = structuredClone(house);
  listModules(house);
  assert.deepEqual(house, before);
  assert.equal(moduleOf(house, 'novel-craft').text, 'My original craft.\n');
  assert.equal(moduleOf(house, 'voice').text, '');
  assert.equal(builtinOf('novel-craft').text, NOVEL_CRAFT);
});

for (const text of [
  'I draw my sword.', 'You draw your sword.', 'She draws her sword.',
  'They draw their swords.', 'We drew our blades.', 'You drew your knife.',
  'I hit you.', 'You hit me.', 'They hit us.', 'She punches you.',
  'You swing your axe.', 'We swing our staves.', 'You block my punch.',
  'You fight.', 'You kick him.', 'She strikes me.', 'You took us down.',
]) {
  test(`combat activation follows the act across narrative persons: ${text}`, () => {
    assert.deepEqual(wakesOn(text), { intimate: false, fight: true });
  });
}
for (const text of [
  'You shot me a look.', 'I shoot you a glance.', 'She hit you up.',
  'They fire you.', 'It struck you.', 'You fight the urge to reply.',
  "You won't hit me.", 'We never draw our swords.', 'She refuses to kick you.',
  'You draw your swordfish.', 'You swing your handbag.', 'You cock your head.',
  'You dodge my question.',
]) {
  test(`an idiom or negated act stays quiet in any person: ${text}`, () => {
    assert.deepEqual(wakesOn(text), { intimate: false, fight: false });
  });
}

console.log(`\n${passed} craft checks passed.`);
