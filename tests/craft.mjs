/* Craft routing and preservation, with synthetic records and no model calls.
 * Run: node tests/craft.mjs
 */
import assert from 'node:assert/strict';
import { assemble } from '../js/novel/context.js';
import { newNovel } from '../js/novel/shape.js';
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


/* 2.11.1: his V177 laws ride again, as 2.6.6 sent them (2.9 had rewritten
 * forty-eight of them and taken eleven out of each craft; he asked for his
 * back, 2026-10-16), with the five additions he chose to keep: My Style
 * Comes First, the point-of-view laws, his character's unstated past and
 * agency, Care Has Particulars, and the judge's respect for viewpoint and
 * genre. The checks below assemble real requests and read what is sent. */
const assembled = (purpose, { house = {}, prefs = {}, request = 'Continue the scene.', moment = '' } = {}) => {
  const { novel: book, chapter } = newNovel({ title: 'The Clock Garden', brief: 'Mara tends a magical garden.' });
  book.prefs = { ...book.prefs, ...prefs };
  const r = assemble({ house, novel: book, chapters: { [chapter.id]: chapter }, conn: { context: 128000 }, purpose,
    target: { chapterId: chapter.id }, request, play: { who: 'Mara' }, moment });
  assert.equal(r.refuse, '');
  return [r.system, ...r.messages.map(m => m.content)].join('\n');
};

for (const [identity, words] of [
  ['Batman', '  You are a funny, unusually cheerful Batman.\nKeep your dry jokes and easy manner.  \n'],
  ['Hulk', '  You are Hulk. Hulk tells funny story. Hulk grammar on purpose!\nHULK LIKE LITTLE JOKE.  \n'],
]) for (const purpose of ['write', 'play']) {
  test(`${identity} ${purpose}: persona words survive the assembled request beside his craft`, () => {
    const { novel: book, chapter } = newNovel({ title: 'The Clock Garden', brief: 'Mara tends a magical garden.' });
    book.prefs = { ...book.prefs, pov: 'first', tense: 'present' };
    const own = `\n  ${identity} keeps this exact unusual voice.  \n`;
    const house = {
      instructions: { system: words, narrator: words, partner: '', late: '', lateNarrator: '' },
      ownWords: [{ id: 'voice', text: own, role: 'teller', to: 'both', place: 'before-your-message' }],
    };
    const before = structuredClone(house);
    const r = assemble({ house, novel: book, chapters: { [chapter.id]: chapter },
      conn: { context: 128000 }, purpose, target: { chapterId: chapter.id },
      request: '"HULK SMASH!"', play: { who: 'Mara' }, moment: 'Mara fights the guards.' });
    assert.equal(r.refuse, '');
    assert.ok(r.system.startsWith(words), 'the chosen identity arrives first, with exact whitespace');
    assert.ok(r.messages.some(m => m.role === 'assistant' && m.content === own), 'the explicit own-voice entry remains exact');
    assert.deepEqual(house, before, 'assembling never rewrites the persona');
    const text = [r.system, ...r.messages.map(m => m.content)].join('\n');
    /* who the storyteller is, kept beside his laws (My Style Comes First) */
    assert.ok(text.includes('These craft defaults never change who you are or how you speak.'));
    assert.ok(text.includes('Who you are does not by itself put you in the cast'));
    assert.ok(text.includes('Humor, slang, fragments, unusual grammar and an exaggerated or unconventional voice are deliberate when my instructions make them so'));
    /* his own laws, as 2.6.6 sent them */
    assert.ok(text.includes('Humor is allowed when THIS character jokes under THIS pressure'));
    assert.ok(text.includes('Before a word reaches the page, in your own head'));
    assert.ok(!text.includes('A joke need not pay a dramatic cost or reveal a secret to belong.'), '2.9’s Humor And Weight is gone');
    assert.ok(!text.includes('You are a master novelist'), 'no generic replacement identity');
    if (purpose === 'play') {
      assert.ok(text.includes('MC Agency = ABSOLUTE. Render only the MC content I wrote.'));
      assert.ok(text.includes('Dialogue: grammar/spelling fix only. Match input length (6 words in = 6 words out).'));
      assert.ok(text.includes('Roll, in your head, and let the result stand — for everyone.'), 'his board for the contest');
      assert.ok(!text.includes('Use dice, numeric difficulty and other game mechanics only if I ask for them'));
    } else {
      assert.ok(text.includes("the story's telling character — the I of the fiction"));
    }
  });
}

test('an explicitly edited craft retains its persona and original rules unchanged', () => {
  const words = '\nHulk narrator! Hulk says what Hulk likes.\nKeep my deliberate dialect.  \n';
  const house = { modules: {} };
  moduleSteps.set('scene-craft', { text: words })(house);
  const r = ridingFor(house, novel, 'play', { fight: true });
  assert.equal(r.always[0], words);
  assert.equal(moduleOf(house, 'scene-craft').text, words);
  assert.ok(!r.always.includes(SCENE_CRAFT), 'the built-in craft never replaces an explicit edit');
});


const appMetaWords = /\b(?:robot(?:ic)?|persona|AI|assistant|language model|LLM|chatbot|few[- ]shot|the model)\b/i;
for (const purpose of ['write', 'play']) {
  test(`${purpose}: the assembled default craft speaks directly without machine labels`, () => {
    const words = 'Batman, keep your dry humor as we write.';
    const text = assembled(purpose, { house: { instructions: { system: words, narrator: words, late: '', lateNarrator: '' } },
      moment: 'Mara fights the guards. Later they make love.' });
    assert.ok(text.startsWith(words));
    assert.equal(appMetaWords.exec(text), null, 'ordinary author-to-writer language throughout the request');
    /* the three places his laws said it with a machine word, in plain words */
    assert.ok(text.includes("Their gravity is real: the "), 'Own Output Is Not Precedent');
    assert.ok(text.includes('gravity is global; varying the opener'), 'The Book (Scene) Is The Whole Context');
    assert.ok(text.includes('on the eighth body blow = a voice that ignores what the body has endured.'), 'the Ledger Law');
    /* knowledge stays where it was learned */
    assert.ok(text.includes('What you know never tilts'));
    assert.ok(text.includes("One exposure licenses the anomaly in the character's OWN vocabulary, never the theory"));
    assert.ok(text.includes('Default State = CONFIDENTLY WRONG'));
  });
}

test('intentional story and custom words are never scrubbed by the terminology cleanup', () => {
  const words = '  Batman, write a story about an AI assistant and a robot who invents a persona.\n';
  const own = '  The language model is called LLM in this fictional laboratory.\n';
  const { novel: book, chapter } = newNovel({ title: 'The Robot Garden', brief: 'An AI assistant tends the garden with a robot.' });
  const house = { instructions: { system: words, narrator: words, late: '', lateNarrator: '' },
    ownWords: [{ id: 'scientist', text: own, role: 'teller', place: 'before-your-message', to: 'both' }],
    modules: { 'novel-craft': { text: 'Custom persona: a chatbot with robotic diction.\n' } } };
  const r = assemble({ house, novel: book, chapters: { [chapter.id]: chapter }, conn: { context: 128000 },
    purpose: 'write', target: { chapterId: chapter.id }, request: 'The robot sees the model on the desk.' });
  assert.ok(r.system.startsWith(words));
  assert.ok(r.system.includes(house.modules['novel-craft'].text));
  assert.ok(r.system.includes(book.brief));
  assert.ok(r.messages.some(m => m.content === own));
  assert.ok(r.messages.some(m => m.content === 'The robot sees the model on the desk.'));
});

/* the laws 2.9 took out of each craft, by name: every one rides again */
const TAKEN_OUT = ['Simulation Principle', 'Support Is The Sequel', 'Own Output Is Not Precedent', 'Bonds Are Not Frozen Categories',
  'Ambient Frame', 'Crowd In Action', 'Simultaneity', 'Event Phases Advance', 'Scene Relocation', 'Exception', 'Night Empties The World',
  'Pressure Advances State', 'CORE Is A Trajectory Not A Freeze', 'Composure Is Effort Not Absence', 'Intelligent Is Not Flat', 'Effort Has A Budget',
  'Tone Is Output Never Input', 'Standings Move On Revelation', 'Affection Is Not Anesthesia', 'Anger Has A Physical Channel', 'Love Interests Are Rivals',
  'Dominance Shapes Anger', 'Pathways', 'One Step Standard', 'Pathway Laundering', 'Default State', 'Anomaly Reads Mundane', 'Noticing Cap', 'Ripening Lock',
  'Public Records Absolute', 'Book Override', 'Expertise Is A Multiplier', 'Room Divergence', 'Vocabulary Quarantine', 'Distributed Deduction Ban',
  'Rule Shape Is Theory', 'Limits Are Peak Resolution', 'State Gates Cognition', 'Information Routes Through Established Mechanics', 'Camera Lens',
  'Body From Biography', 'Anchor Feature', 'Cast Contrast', 'Show Never Interpret', 'Silence Is A Choice', 'Dialogue Ratio', 'Anti Melodrama',
  'Signature Bits Burn', 'Peaks Are Plain', 'Never Spreads', 'Beat Arcs', 'Weight Is Not Defused', 'Tone Calibration', 'Peak Trigger',
  'Real People, Real Record', 'Banned Constructs (narration only)', 'CORE Voice Fixed, Register Dynamic', 'State-Driven Speech'];
const TAKEN_OUT_OF = { write: ['A Passage Moves The World', 'Nobody Is Sherlock Holmes'], play: ['A Turn Moves The World', 'NPCs Are Not Sherlock Holmes', 'NPC Private Thoughts'] };
/* what 2.9 put in their place: none of it rides */
const PUT_IN = ['Cause And Consequence', 'Earlier Prose Is Not Precedent', 'Bonds Can Grow', 'A Passage Has A Purpose', 'A Turn Has A Purpose',
  'Pressure And Response', 'Tone Follows The People', 'Reasoned Conclusions', 'Relationships Keep Their History', 'Affection And Conflict',
  'Power And Emotion', 'Show And Tell With Purpose', 'Sentence Choices', 'Dialogue And Action', 'CORE Voice And Register', 'Signature Bits',
  'Humor And Weight', 'Real People, Chosen Version'];
for (const purpose of ['write', 'play']) {
  test(`${purpose}: every law 2.9 took out rides again, and nothing 2.9 put in its place`, () => {
    const text = assembled(purpose);
    const missing = [...TAKEN_OUT, ...TAKEN_OUT_OF[purpose]].filter((name) => !text.includes(`${name} = `));
    assert.deepEqual(missing, []);
    const back = PUT_IN.filter((name) => text.includes(`${name} = `));
    assert.deepEqual(back, []);
    assert.ok(text.includes('## Simulation Core') && !text.includes("## The World's Logic"));
  });
}

for (const purpose of ['write', 'play']) {
  const crafted = (prefs = {}) => assembled(purpose, {
    house: { instructions: { system: 'Batman, keep your dry warmth.', narrator: 'Hulk tell tender story.', late: '', lateNarrator: '' } },
    prefs, request: 'Let the reunion breathe.' });
  test(`${purpose}: warmth is earned and never anesthetizes conflict; care, where it belongs, has particulars`, () => {
    const text = crafted();
    assert.ok(text.includes('TRANSACTIONAL INDIFFERENCE. Strangers are polite, busy, self-interested.'));
    assert.ok(text.includes('HARD STOP, all conflict types. Never resolve conflict by making the losing party noble, self-sacrificing, or suddenly wise.'));
    assert.ok(text.includes('warm strangers, gracious losers, porn-compliance'));
    assert.ok(text.includes('The anti-positivity ban is on UNEARNED wins'));
    assert.ok(text.includes('people DO concede — when evidence is undeniable and conceding costs less than fighting'));
    assert.ok(text.includes('VELOCITY TAX — one scene = one degree'));
    assert.ok(text.includes('they never anesthetize it'));
    assert.ok(text.includes('jealousy is default physics'));
    assert.ok(text.includes("never on the beat's pleasantness"));
    assert.ok(text.includes('who disagree fight to WIN'));
    assert.ok(text.includes('the gentle snap LATER but land worse'));
    assert.ok(text.includes('fire where a rival is visible'));
    assert.ok(text.includes('Warmth is EARNED through the standings, one beat at a time'));
    /* kept: what affection looks like where the book has it */
    assert.ok(text.includes('Care Has Particulars = where affection belongs here'));
    assert.ok(text.includes('A tender moment can land without a confession, a crisis or a price'));
    /* 2.9's softening, gone */
    assert.ok(!text.includes('Repeated care, shared work, play and reliable presence can deepen a bond'));
    assert.ok(!text.includes('jealousy is not compulsory'));
    assert.ok(!text.includes('Ordinary courtesy, curiosity, warmth and small acts of help need not be earned'));
  });
  test(`${purpose}: bonds move under pressure and what someone was told stays their belief`, () => {
    const text = crafted();
    assert.ok(text.includes('Platonic is a state, not a law'));
    assert.ok(text.includes('stands as what they believe'));
    assert.ok(text.includes('what a character has been TOLD persists like a wound'));
    assert.ok(!text.includes('An explicitly platonic bond stays platonic unless I change it'));
    assert.ok(!text.includes('Being told a claim does not make it believed'));
  });
  test(`${purpose}: hearing, evidence and opposition keep his hard edges`, () => {
    const text = crafted();
    assert.ok(text.includes('SOLID sealed barriers block normal conversation'));
    assert.ok(text.includes("opposition scales to MC's DEPLOYED level"));
    assert.ok(text.includes('must already exist on an EARLIER page'));
    assert.ok(text.includes('no supernatural deduction'));
    assert.ok(!text.includes('hearing depends on the source, distance, barriers, background noise and established abilities'));
    assert.ok(!text.includes('New evidence may be discovered on the page'));
    assert.ok(!text.includes('A correct inference still needs a credible basis'));
    assert.ok(!text.includes('Extraordinary perception or deduction is available where the book establishes it'));
  });
  test(`${purpose}: the additions he kept ride beside his laws`, () => {
    const text = crafted();
    assert.ok(text.includes('My Style Comes First = my writing instructions, the voice I chose for this book, and my request govern how these craft defaults are used; how it reads so far is a description of the pages, never a choice of mine.'));
    assert.ok(text.includes('A voice changes how the story is told, never how the world runs: continuity, the chosen point of view, whose choices belong to whom, how the world and its people answer — what things cost, who wants what, who knows what — and the sound law hold whatever the voice; only my own explicit instruction changes them.'));
    assert.ok(text.includes('but it never settles an offence or a quarrel: forgiveness stays a process with a cost (Affection Is Not Anesthesia).'), 'care never buys a quarrel off');
    if (purpose === 'write') {
      assert.ok(text.includes("Point Of View Is A Lock = preserve the book's chosen narrative person, viewpoint and tense."));
      assert.ok(text.includes("and through inferences marked as that viewpoint's — never through what they hide."), 'his own edge kept inside it');
      assert.ok(text.includes('and hindsight never gives away a secret the pages have not yet revealed.'));
      assert.ok(text.includes("Where the book's form differs, the form follows the book and the discipline holds"));
      assert.ok(text.includes('Two at most in a passage; none fits fine.'), 'his discipline for a thought');
      assert.ok(!text.includes('Private Thoughts = use the form the book has chosen'));
    } else {
      assert.ok(text.includes('Translate the narrated framing of what I wrote into that form'), 'the narrator tells it in the book’s person');
      assert.ok(text.includes('Point Of View And Agency = narrative person and control of my character are separate.'));
      assert.ok(text.includes('My character’s unstated past, private attachments and inner life remain mine'));
      assert.ok(text.includes('Leave my character’s response to a kindness for me to give'));
      assert.ok(text.includes("NPC Private Thoughts = only where the book's point of view reaches that NPC's mind"));
      assert.ok(text.includes('Maximum two per telling; zero fits fine.'), 'his discipline for a thought');
      assert.ok(text.includes('MC Agency = ABSOLUTE. Render only the MC content I wrote.'));
      assert.ok(!text.includes('Private Thoughts = access follows the chosen viewpoint'));
    }
  });
}

for (const sound of ['comic', 'novel']) for (const purpose of ['write', 'play']) {
  test(`${sound}, ${purpose}: his sound law, a fight’s and the act’s, as Cozy Tavern carries them`, () => {
    const text = assembled(purpose, { prefs: { sound }, moment: 'Mara fights the guards. Later they make love.', request: 'Mara draws her sword and attacks the guard. Later they make love.' });
    assert.ok(text.includes(sound === 'comic' ? 'REQUIRED: every impact, contact, and friction beat gets one' : 'REQUIRED: every impact, contact, and friction beat is heard'));
    assert.ok(text.includes('Self-check every few sentences: sound present, dialogue present, continuously.'));
    assert.ok(text.includes('How A Fight Sounds = a fight is LOUD'));
    assert.ok(text.includes('Acoustics Are Simulation = sex sounds the way a film'));
    /* Cozy Tavern's lines the 2.3 adaptation had left out */
    assert.ok(text.includes('a knock ONLY from an established person with live cause'));
    assert.ok(text.includes('Overheard is witnessed audio, entering knowledge through those ears only.'));
    assert.ok(text.includes("the craft's rotate-the-palette and anti-repetition laws never shrink it to one syllable"));
    /* beside it: the book's person and tense, his character's sounds his */
    assert.ok(text.includes("Sound Belongs To This Book = the sound law's examples show the sound, never the person or the tense to tell it in"));
    assert.ok(text.includes('the character whose part I take speaks and vocalizes only what I wrote, while what the world does to them is heard like everything else.'), 'a blow on his character is still heard');
    assert.ok(text.includes(sound === 'comic' ? 'a sex, combat, or action passage with zero effects is a failed draft' : 'never in a describing verb: "nnh—", "FUUUUUCKKK!!!!!!", "Mmm—ahhh—yes—"'));
    if (sound === 'novel') {
      assert.ok(text.includes('so is a scream or a clash only NAMED ("he screamed", "a sound rang out", "a grunt escaped him")'));
      assert.ok(text.includes("never reuse the last passage's sounds; repetition inside one sound is the sound."));
    }
    for (const soft of ['no built-in sound quota overrides them', 'without a sound or dialogue quota', 'A quiet passage may remain quiet', 'an em dash is available, not a required frame']) {
      assert.ok(!text.includes(soft), soft);
    }
    assert.ok(text.includes("a woman's voice is written, not assumed"), 'the sound of a voice, as Cozy Tavern wrote it');
  });
}

for (const purpose of ['write', 'play', 'partner']) {
  test(`${purpose}: the prose guide keeps the viewpoint mechanics and none of 2.9's softening`, () => {
    const text = assembled(purpose);
    assert.ok(text.includes('The person of my request or a scene’s spoken moves does not choose the book’s person.'));
    assert.ok(text.includes('My instructions take precedence over general craft advice.'));
    assert.ok(!text.includes('a quiet moment need not become a cliffhanger'));
    assert.ok(!text.includes('Keep deliberate dialect, repetition, figurative language'));
  });
}

test('Settings says what the sound of a voice is for, as Cozy Tavern wrote it', () => {
  const voice = listModules({}).find((m) => m.id === 'voice');
  assert.equal(voice.about, 'Every woman in the book sounds like herself, never like the next one.');
  assert.equal(voice.text, VOICE_RULE);
});

for (const purpose of ['write', 'play']) {
  test(`${purpose}: what Cozy Tavern says of gloss, warmth and a canon look, as it says it`, () => {
    const text = assembled(purpose);
    assert.ok(text.includes('Gloss Is Not Witnessed = a line of the notes or of the story so far fuses observable events with gloss'));
    assert.ok(text.includes('Fear FOR MC, worry, grief at his pain are symptoms of high warmth'));
    assert.ok(text.includes("the real-world or established-lore reference (look it up, don't guess)"));
    assert.ok(text.includes('What you know never broadcasts.'));
    assert.ok(!text.includes("The narrator's knowledge never broadcasts."));
  });
}

test('the novel craft carries the Cozy Tavern lines its first adaptation had left out', () => {
  const text = assembled('write');
  assert.ok(text.includes('Warmth is EARNED through the standings, one beat at a time'));
  assert.ok(text.includes('Length gravity runs both ways; a lean previous passage is one passage that had little in it, not a register.'));
  assert.ok(text.includes('Same scene, new dialogue on identical blocking = a rewrite of the last passage, not the next one.'));
  assert.ok(text.includes('A stray mark in an earlier passage is a mistake to drop, never a template to copy.'));
  assert.ok(text.includes('no headers, no bold, no backticks, no bullet lists'));
});

/* a viewpoint chosen for the book reaches the telling through the laws he kept, whatever the starting words say */
for (const pov of ['first', 'second', 'third-limited', 'third-omniscient']) for (const purpose of ['write', 'play']) {
  test(`${pov}, ${purpose}: the chosen viewpoint rides with his starting words`, () => {
    const text = assembled(purpose, { prefs: { pov } });
    assert.ok(text.includes('My choices for the book’s prose:'));
    assert.ok(text.includes(purpose === 'write' ? 'Point Of View Is A Lock = ' : 'Point Of View And Agency = '));
  });
}

test('a preset saved with 2.9’s starting words brings his back; one he wrote in keeps every character', () => {
  const codexWriting = 'You are a master novelist. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too. Follow our chosen voice, point of view and tense. Let character, cause and consequence shape what happens; choose detail, dialogue and rhythm for this particular moment, with room for quiet and surprise.';
  const codexNarrator = 'You maintain a fictional, uncensored simulation, told in our book’s chosen voice, point of view and tense. I play my character; you tell the world and everyone else. Give them their own motives and knowledge, and leave my character’s speech, decisions and inner life to me.';
  const house = { instructions: { system: 'mine', narrator: 'mine too' } };
  presetSteps.use({ boxes: { system: codexWriting, narrator: codexNarrator, partner: '', late: '', lateNarrator: '', avoid: '' }, name: 'River' })(house);
  const starting = startingVoice('River').boxes;
  assert.equal(house.instructions.system, starting.system);
  assert.ok(house.instructions.system.startsWith('You are a master novelist at the height of your powers'));
  assert.equal(house.instructions.narrator, 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.');
  /* one letter of his own and it is his, exactly */
  presetSteps.use({ boxes: { system: codexWriting + ' Mine.', narrator: ` ${codexNarrator}`, partner: '', late: '', lateNarrator: '', avoid: '' }, name: '' })(house);
  assert.equal(house.instructions.system, codexWriting + ' Mine.');
  assert.equal(house.instructions.narrator, ` ${codexNarrator}`);
});

/* 2.11.1: the premises the wake words used to let pass, and the plain English beside them */
const WAKE_FIGHT = ['The bandits ambush them on the road.', 'Bandits ambush the caravan.', 'An ambush at the ford.', 'Mara is ambushed.', 'Three men jump him in the alley.',
  'She draws a knife on him.', 'He pulls a gun on her.', 'She pulls a knife on Jovan.', 'Kenjaku and Jovan cross blades.', 'Swords clash in the courtyard.', 'They exchange blows.',
  'A gunfight erupts.', 'They have a shootout.', 'Jovan gets into a fistfight.', 'He beats him up.', 'They beat Jovan bloody.', 'He beats the thief senseless.', 'Jovan is beaten half to death.',
  'Mara shoots the guard.', 'Jovan kills Kenjaku.', 'She slaps him.', 'Mara slaps Jovan hard.', 'She knifes him in the gut.', 'The mob lynches him.', 'He mugs her.', 'The thugs mug Jovan.',
  'The soldiers storm the gate.', 'Jovan wrestles the bear.', 'Kenjaku strangles Yuki.', 'Mara punches Jovan.'];
const WAKE_HEAT = ['He takes her to bed.', 'They spend the night together.', 'She sleeps with him.', 'She sleeps with Jovan.', 'They kiss and fall into bed.', 'They fuck.', 'They fucked in the shower.',
  'She got fucked over the desk.', 'She rides him.', 'He goes down on her.', 'She went down on Jovan.', 'He fingers her.', 'They hook up.', 'He beds her.', 'Jovan beds Mara.',
  'They consummate the marriage.', 'They fall into bed together.'];
const WAKE_CALM = ['She sleeps with the light on.', 'He slept with a knife under his pillow.', 'They fucked up the plan.', 'They fucking hate the rain.', 'He got fucked over by the bank.',
  'She rides her bike to school.', 'He rides his horse to town.', 'Kenji rides him about his grades.', 'He fingered him as the killer.', 'She fingers her necklace.',
  'They hook up the trailer.', 'She is a consummate professional.', 'They fall into bed exhausted.', 'She falls into bed.', 'It struck Mara that she was alone.', 'That hit Jovan hard.',
  'Mara hits Jovan up for money.', 'The song chokes Mara up.', 'He slaps him on the back.', 'Mara slaps Jovan on the shoulder.', 'Detective Lynch arrives.', 'The lynchpin of the plan.',
  'He beats him at chess.', 'She beat Jovan to the door.', 'They exchange glances.', 'He shoots the scene at dawn.', 'They shoot a film in Kyoto.', 'The reporters ambush him with questions.',
  'Her friends ambush Mara with a surprise party.', 'She mugs for the camera.', 'They wrestle with the problem.', 'She draws a picture on the wall.', 'He takes her to the station.',
  'They spend the night at the inn.', 'They bed down in the barn.', 'Kenji punches the clock.', 'She strikes a match.', 'Jovan kisses Mara goodnight.'];
for (const text of WAKE_FIGHT) test(`a fight in his words wakes how a fight sounds: ${text}`, () => assert.equal(wakesOn(text).fight, true));
for (const text of WAKE_HEAT) test(`the act in his words wakes the intimate rule: ${text}`, () => assert.equal(wakesOn(text).intimate, true));
for (const text of WAKE_CALM) test(`plain English beside them stays quiet: ${text}`, () => assert.deepEqual(wakesOn(text), { intimate: false, fight: false }));
test('a premise the words now catch carries the rule into the request', () => {
  const fight = assembled('write', { moment: 'Mara shoots the guard.' });
  assert.ok(fight.includes('How A Fight Sounds = a fight is LOUD'));
  const heat = assembled('write', { moment: 'She sleeps with him.' });
  assert.ok(heat.includes('## When The Scene Turns Intimate') && heat.includes('Acoustics Are Simulation'));
  const calm = assembled('write', { moment: 'She sleeps with the light on.' });
  assert.ok(!calm.includes('## When The Scene Turns Intimate') && !calm.includes('## How A Fight Sounds'));
});

console.log(`\n${passed} craft checks passed.`);
