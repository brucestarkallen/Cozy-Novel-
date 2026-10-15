/* Request contracts, with synthetic books and no model calls. */
import assert from 'node:assert/strict';
import { assemble, shortOf, notesBehind } from '../js/novel/context.js';
import * as prompts from '../js/novel/prompts.js';
import { newNovel, newPassage, chapterPrint } from '../js/novel/shape.js';

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const { novel, chapter } = newNovel({ title: 'The Clock Garden', brief: 'Mara keeps the garden.' });
chapter.passages = [newPassage('you', 'I found the brass key beside the gate.')];
const chapters = { [chapter.id]: chapter };
const custom = '  Keep my lyrical voice.\nDo not flatten my sentences.  \n';
const house = { instructions: { system: custom, narrator: custom, partner: custom, late: '  My closing instruction.\n', lateNarrator: '  My scene instruction.\n' }, modules: Object.fromEntries(['novel-craft', 'scene-craft', 'voice', 'intimate', 'contested', 'spectacle'].map((id) => [id, { rides: 'off' }])) };
const request = (purpose, n = novel, h = house, target = {}) => assemble({ house: h, novel: n, chapters, conn: { context: 64000 }, purpose, target: { chapterId: chapter.id, ...target }, request: 'Continue this moment.', play: { who: 'Mara' } });
const allWords = (r) => [r.system, ...r.messages.map((m) => m.content)].join('\n');
const modes = { first: 'First person:', second: 'Second person:', 'third-limited': 'Third person, close:', 'third-omniscient': 'Third person, omniscient:' };

const formerWriting = 'You are a master novelist at the height of your powers — the kind whose books sit at the top of the New York Times bestseller list because nobody can put them down. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too — as an unbiased eye on a world that runs by its own logic.';
const formerNarrator = 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.';
check('untouched 2.8 starting instructions adopt viewpoint-aware defaults once', () => {
  const h = { instructions: { system: formerWriting, narrator: formerNarrator, partner: custom, late: custom } };
  assert.equal(prompts.startingIsOld(h), true);
  prompts.freshStarting(h);
  assert.equal(h.instructions.system, prompts.DEFAULT_WRITING);
  assert.equal(h.instructions.narrator, prompts.DEFAULT_NARRATOR);
  assert.equal(h.instructions.partner, custom);
  assert.equal(h.instructions.late, custom);
  assert.equal(prompts.startingIsOld(h), false);
  for (const [pov, label] of Object.entries(modes)) for (const purpose of ['write', 'play']) {
    const text = allWords(request(purpose, { ...novel, prefs: { pov } }, h));
    assert.ok(text.includes(label));
    assert.ok(text.includes('chosen voice, point of view and tense'));
    if (purpose === 'play') assert.ok(text.includes('leave my character’s speech, decisions and inner life to me'));
  }
});
check('edited former defaults and intentionally empty instruction boxes remain exact', () => {
  for (const words of [formerWriting + '\nMy voice matters.', ' ' + formerWriting, '']) {
    const h = { instructions: { system: words, narrator: formerNarrator + '\nMine.', partner: custom } };
    const before = structuredClone(h);
    assert.equal(prompts.startingIsOld(h), false);
    prompts.freshStarting(h);
    assert.deepEqual(h, before);
  }
});

for (const [pov, label] of Object.entries(modes)) for (const tense of ['past', 'present']) for (const notesAs of ['system', 'user', 'assistant']) {
  check(`${pov}, ${tense}, book as ${notesAs}: every storytelling request carries the choices`, () => {
    const n = { ...novel, prefs: { ...novel.prefs, pov, tense } };
    for (const purpose of ['write', 'play', 'partner']) {
      const r = request(purpose, n, { ...house, notesAs });
      assert.equal(r.refuse, '');
      assert.ok(r.system.startsWith(custom), 'own instructions arrive first, exactly');
      const text = allWords(r);
      assert.ok(text.includes(label));
      assert.ok(text.includes(`Narrative tense: ${tense}.`));
      assert.ok(text.includes('explicit writing instructions and directions for a particular passage come first'));
      if (purpose === 'play') assert.ok(text.includes('Never put a word, a choice or a feeling in Mara'));
    }
    for (const r of [
      prompts.checkRequest({ novel: n, chapterLabel: 'One', numbered: '[1.1] I found the key.' }),
      prompts.duelRequest({ novel: n, chapterLabel: 'One', first: 'I found the key.', second: 'I discovered the key.' }),
      prompts.notesRequest({ novel: n, chapterLabel: 'One', changes: [], removed: [], removedChapters: [] }),
      prompts.auditRequest({ novel: n, bookText: 'I found the key.' }),
      prompts.keepRequest({ novel: n, keeps: ['style'], bookText: 'I found the key.' }),
    ]) assert.ok(r.includes(label), 'workers receive the same selected choices');
  });
}

check('old books keep their free-text style and no imposed person or tense', () => {
  const n = { ...novel, style: 'First person plural, future tense, in letters.', prefs: {} };
  assert.equal(prompts.narrationChoices(n), '');
  assert.ok(allWords(request('write', n)).includes(n.style));
  assert.equal(prompts.narrationChoices({ ...n, prefs: { pov: 'unknown', tense: 'unknown' } }), '');
});
check('closing instructions are preserved exactly and empty instructions send nothing', () => {
  for (const purpose of ['write', 'play']) {
    const r = request(purpose);
    assert.equal(r.messages.at(-1).content, purpose === 'write' ? house.instructions.late : house.instructions.lateNarrator);
  }
  assert.equal(prompts.lateFor({ late: ' \n ' }, 'write'), '');
  assert.equal(prompts.lateFor({ late: 'keep me', lateOff: true }, 'write'), '');
  assert.equal(prompts.lateFor({ late: 'keep me' }, 'partner'), '');
});
check('an obsolete summary never supplies deleted canon', () => {
  const c = { ...chapter, summary: { text: 'Mara murdered the gardener.', fp: 'obsolete' } };
  assert.ok(!shortOf(c).includes('murdered'));
  assert.ok(shortOf(c).includes('brass key'));
  c.summary.fp = chapterPrint(c);
  assert.equal(shortOf(c), c.summary.text, 'matching summary retained');
});
check('scene anchored at a chapter opening sees its later prose as later', () => {
  const r = request('play', novel, house, { through: '^' });
  const text = allWords(r);
  assert.ok(text.includes('I found the brass key'));
  assert.ok(text.indexOf('I found the brass key') > text.indexOf('after'), 'later prose labeled after the scene');
  assert.equal(notesBehind(novel, chapters, chapter, { through: '^' }, 'play'), '');
});
check('scene anchored after an unread passage is warned its notes lag behind', () => {
  const target = { through: chapter.passages[0].id };
  assert.ok(notesBehind(novel, chapters, chapter, target, 'play').includes('passage 1'));
  assert.equal(notesBehind(novel, chapters, chapter, target, 'write'), '', 'Go on is writing that passage itself');
});
check('checker and helper distinguish narration from factual reference', () => {
  assert.ok(prompts.checkerFrame(house, novel).includes('omniscient narration'));
  const helper = prompts.helperFrame(house, novel);
  assert.ok(helper.includes('use names'));
  assert.ok(helper.includes('uncertainty, lies, beliefs'));
  const summary = prompts.summaryRequest({ novel, chapterLabel: 'One', text: 'I dreamed the gate burned.', words: 10 });
  assert.ok(summary.includes('mark flashbacks and dreams'));
});
check('a continued scene retains what actually happened and the book’s viewpoint', () => {
  const r = prompts.goOnRequest({ chapterLabel: 'One', transcript: 'Mara: I give the key back.\nNarrator: The gardener locks the gate.', who: 'Mara', tail: 'The gardener', outcome: '' });
  assert.ok(r.includes('The gardener locks the gate.'));
  assert.ok(r.includes('without repeating the converted part or inventing a different outcome'));
  assert.ok(!r.includes('How it turns out is yours to decide'));
});
check('opening a scene preserves the player’s starting position and next move', () => {
  const words = prompts.playOpening({ who: 'Mara' });
  assert.ok(words.includes('where the book and my starting description place Mara'));
  assert.ok(words.includes('leave the arrival or entry for me to choose'));
  assert.ok(!words.includes('bring Mara in'));
});
check('the judge permits grounded kindness and a quiet emotional payoff', () => {
  const words = prompts.checkRequest({ novel, chapterLabel: 'One', numbered: '[1.1] Mara kept the kettle warm for her friend.', judge: { target: 9 } });
  assert.ok(words.includes('ordinary kindness, cooperation and affection can be true to them'));
  assert.ok(words.includes('quiet beat need not invent a new event'));
});
check('a prose-only fresh take preserves what the established moment settled', () => {
  const words = prompts.rewriteRequest({ chapterLabel: 'One', text: 'Mara gave the key to Ivo, who accepted it.' });
  assert.ok(words.includes('Keep the established events, choices, relationships and outcome'));
  assert.ok(words.includes('unless I ask to change them'));
  assert.ok(words.includes('Mara gave the key to Ivo, who accepted it.'));
});
console.log(`\n${passed} passed, 0 failed`);
