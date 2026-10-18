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

/* 2.11.1: his starting words are back (2.9 had put its own in their place);
 * a box still holding 2.9's, untouched, gets his once, and his are today's */
const formerWriting = 'You are a master novelist. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too. Follow our chosen voice, point of view and tense. Let character, cause and consequence shape what happens; choose detail, dialogue and rhythm for this particular moment, with room for quiet and surprise.';
const formerNarrator = 'You maintain a fictional, uncensored simulation, told in our book’s chosen voice, point of view and tense. I play my character; you tell the world and everyone else. Give them their own motives and knowledge, and leave my character’s speech, decisions and inner life to me.';
const hisWriting = 'You are a master novelist at the height of your powers — the kind whose books sit at the top of the New York Times bestseller list because nobody can put them down. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too — as an unbiased eye on a world that runs by its own logic.';
const hisNarrator = 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.';
check('untouched 2.9 to 2.11.0 starting words give his back, once', () => {
  const h = { instructions: { system: formerWriting, narrator: formerNarrator, partner: custom, late: custom } };
  assert.equal(prompts.startingIsOld(h), true);
  prompts.freshStarting(h);
  assert.equal(h.instructions.system, hisWriting);
  assert.equal(h.instructions.narrator, hisNarrator);
  assert.equal(prompts.DEFAULT_WRITING, hisWriting);
  assert.equal(prompts.DEFAULT_NARRATOR, hisNarrator);
  assert.equal(h.instructions.partner, custom);
  assert.equal(h.instructions.late, custom);
  assert.equal(prompts.startingIsOld(h), false, 'his are today’s, never old');
  /* the viewpoint he chooses reaches the telling through the laws he kept, not through the starting words */
  for (const [pov, label] of Object.entries(modes)) for (const purpose of ['write', 'play']) {
    const text = allWords(request(purpose, { ...novel, prefs: { pov } }, h));
    assert.ok(text.startsWith(purpose === 'write' ? hisWriting : hisNarrator));
    assert.ok(text.includes(label));
    assert.ok(text.includes(purpose === 'write' ? "Point Of View Is A Lock = preserve the book's chosen narrative person" : 'Point Of View And Agency = narrative person and control of my character are separate.'));
    if (purpose === 'play') assert.ok(text.includes('Never put a word, a choice or a feeling in Mara'));
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
      /* 2.11 said it in plain words; the same rule: his instructions and what he asks for in a passage come first */
      assert.ok(text.includes('My own writing instructions, and anything I ask for in a particular passage, come first.'));
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
  assert.ok(r.includes('don’t repeat the part already written, and don’t change how it turned out'));
  assert.ok(!r.includes('How it turns out is yours to decide'));
});
check('opening a scene preserves the player’s starting position and next move', () => {
  const words = prompts.playOpening({ who: 'Mara' });
  assert.ok(words.includes('where the book and my description of the start put Mara'));
  assert.ok(words.includes('if neither settles how Mara arrives or comes in, leave that to me'));
  assert.ok(!words.includes('bring Mara in'));
});
/* 2.11.1: the judge's checks as 2.6.6 asked them (2.9 had excused a quiet
 * page from moving and agreement from needing a reason); the viewpoint and
 * genre respect he kept stay */
check('the judge holds his checks and its measure, and keeps the book’s viewpoint and genre', () => {
  const words = prompts.checkRequest({ novel, chapterLabel: 'One', numbered: '[1.1] Mara kept the kettle warm for her friend.', judge: { target: 9 } });
  assert.ok(words.includes('nobody there only to move things along, nobody agreeing or giving way without a reason'));
  assert.ok(words.includes('by its end something has concretely changed — someone moved, chose, learned, lost or won; a quiet passage moves when a mood hardens or a fact travels'));
  assert.ok(words.includes('it ends on forward motion — never on a summary of what it meant, a lesson, a recap or the weather'));
  assert.ok(words.includes('what matters is played out as scene, not summed up'));
  assert.ok(words.includes('no purple or overwritten line'));
  assert.ok(words.includes('Judged like this, a page from a published novelist fails one or two; a page that reads machine-made fails most.'));
  assert.ok(words.includes('the pages outweigh a stale note, and a deliberate change of viewpoint or tense is not a slip'));
  for (const soft of ['ordinary kindness, cooperation and affection can be true to them', 'quiet beat need not invent a new event', 'There is no expected number of failures']) assert.ok(!words.includes(soft), soft);
  /* the checker is told how the book writes sound, so it never "fixes" his voiced lines */
  for (const sound of ['comic', 'novel']) {
    const told = prompts.checkRequest({ novel: { ...novel, prefs: { ...novel.prefs, sound } }, chapterLabel: 'One', numbered: '[1.1] "Nngh—!" Steel rang.' });
    assert.ok(told.includes('voices — moans, cries, breaths — written out in quotes, stretched and repeated ("Nngh—!", "Ahh—ahh—")'), sound);
    assert.equal(told.includes('the world’s sounds as sound effects in asterisks (*CLANG!*, *thud thud*)'), sound === 'comic');
    assert.ok(!told.includes('without a quota'));
  }
  const frame = prompts.checkerFrame(house, novel);
  assert.ok(frame.includes('Respect chosen viewpoint, omniscient narration, humour, dialect, deliberate grammar and fragments.'));
  assert.ok(!frame.includes('quiet passages'));
  const duel = prompts.duelRequest({ novel, chapterLabel: 'One', first: 'I found the key.', second: 'I discovered the key.' });
  assert.ok(duel.includes('plays what matters as scene') && duel.includes('and ends moving forward. Respect the requested viewpoint, genre and style.'));
  assert.ok(!duel.includes('a quiet or lyrical page is not worse'));
});
check('Another take asks a fresh take on the same moment, fitted to what comes before and after it', () => {
  const words = prompts.rewriteRequest({ chapterLabel: 'One', text: 'Mara gave the key to Ivo, who accepted it.' });
  assert.ok(words.includes('Write it again — a fresh take on the same moment.'));
  assert.ok(words.includes("It takes the old one's place on the page, so it has to fit with what comes before and after it."));
  assert.ok(words.includes('Mara gave the key to Ivo, who accepted it.'));
  assert.ok(!words.includes('Keep the established events, choices, relationships and outcome'));
});
check('how the book reads: his words are his choice; the helper’s account of the pages is said as an account', () => {
  const helperOnly = { ...novel, style: '', auto: { style: true }, kept: { style: { text: 'Lyrical, ornate, long sentences.', at: 1 } } };
  assert.ok(prompts.aboutTheBook(helperOnly).includes('How it reads so far:\nLyrical, ornate, long sentences.'));
  assert.ok(!prompts.aboutTheBook(helperOnly).includes('How it reads:\n'));
  const corrected = { ...helperOnly, kept: { style: { text: 'Plain and close on Mara.', at: 1, by: 'you' } } };
  assert.ok(prompts.aboutTheBook(corrected).includes('How it reads:\nPlain and close on Mara.'));
  const both = { ...helperOnly, style: 'Plain, past tense.' };
  assert.ok(prompts.aboutTheBook(both).includes('How it reads:\nPlain, past tense.\n\nAnd as it reads so far (the words above are right wherever the two differ):\nLyrical, ornate, long sentences.'));
  const manual = { ...helperOnly, auto: { style: false } };
  assert.ok(!prompts.aboutTheBook(manual).includes('Lyrical'), 'Manual sends only his words');
  /* the helper is shown only a correction of his */
  assert.ok(!prompts.aboutTheBook(helperOnly, { kept: 'his' }).includes('Lyrical'));
  assert.ok(prompts.aboutTheBook(corrected, { kept: 'his' }).includes('How it reads:\nPlain and close on Mara.'));
});
console.log(`\n${passed} passed, 0 failed`);
