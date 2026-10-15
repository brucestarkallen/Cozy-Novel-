/* Custom storytelling voices through real request paths. The local provider's
 * canned words exercise delivery and storage, never judge literary quality. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_PERSONA_PORT || 20450);
const PROV = Number(process.env.COZY_PERSONA_PROVIDER_PORT || 20452);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = `http://127.0.0.1:${PROV}`;
const personaHome = mkdtempSync(path.join(os.tmpdir(), 'cozy-personas-'));
const fetchLocal = globalThis.fetch;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: personaHome, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetchLocal(url)).ok) return; } catch (_) { /* starting */ }
    await sleep(50);
  }
  throw new Error('The local persona test server did not start: ' + url);
}
let passed = 0, failed = 0, store;
const WRITER = 'You are a funny Batman who writes gentle fantasy with dry jokes.\n\nKeep the wit in the telling, not just a greeting. {{user}} is your collaborator; {{char}} names your place in these instructions.';
const NARRATOR = 'You are Hulk, a warm, funny storyteller with big feelings and careful listening.\n\nTell the scene in Hulk’s voice. {{user}} chooses their own moves; {{char}} tells what happens around them.';
const PARTNER = 'You are Aster Vale, a patient bookbinder with a mischievous sense of humor.\n\nHelp {{user}} plan the novel in your own voice; {{char}} is what these notes call you.';
const WRITER_SENT = WRITER.replace('{{user}}', 'Maya').replace('{{char}}', 'the writer');
const NARRATOR_SENT = NARRATOR.replace('{{user}}', 'Rook').replace('{{char}}', 'the narrator');
const PARTNER_SENT = PARTNER.replace('{{user}}', 'Maya').replace('{{char}}', 'my partner');
const LATE_WRITE = 'BATMAN LATE: Keep the dry humor, {{char}}.\nMaya remains Maya.';
const LATE_PLAY = 'HULK LATE: Stay warm and funny, {{char}}.\n{{user}} keeps the next choice.';
const SEED_WRITE = 'Batman keeps his dry humor while respecting the book.';
const SEED_PLAY = 'Hulk keeps his voice while leaving Rook’s choices open.';
const OPEN_WRITE = 'BATMAN_OPEN: ';
const OPEN_PLAY = 'HULK_OPEN: ';

try {
  await Promise.all([ready(BASE + '/api/version'), ready(PROVIDER + '/requests')]);
  globalThis.fetch = (url, init) => fetchLocal(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  store = await import('../js/store.js');
  const shape = await import('../js/novel/shape.js');
  const writer = await import('../js/novel/writer.js');
  const talk = await import('../js/novel/talk.js');
  const prompts = await import('../js/novel/prompts.js');
  const { picked } = shape;
  const connection = { id: 'persona-local', name: 'Local persona fixture', model: 'scripted', url: PROVIDER + '/v1', key: 'test-only', context: 200000, maxTokens: 5000, prefillFlagField: 'prefix' };
  const ownWords = [
    { id: 'voice-before', name: 'The chosen voice', role: 'teller', place: 'before-pages', to: 'both', text: 'OWN VOICE: {{char}} keeps the voice chosen by {{user}}.' },
    { id: 'writer-own', name: 'Batman rhythm', role: 'you', place: 'before-your-message', to: 'write', text: 'OWN WRITER: Dry jokes, gentle warmth.\nKeep this line exactly.' },
    { id: 'narrator-own', name: 'Hulk warmth', role: 'house', place: 'after-your-message', to: 'play', text: 'OWN NARRATOR: Big feelings, tender humor.\n{{user}} acts for themselves.' },
    { id: 'off-own', name: 'Not sent', on: false, role: 'teller', place: 'after-your-message', to: 'both', text: 'OFF VOICE: replace everything with a generic narrator.' },
  ];
  async function profile({ scene = false, empty = false } = {}) {
    const instructions = { system: empty ? '' : WRITER, narrator: empty ? '' : NARRATOR, partner: empty ? '' : PARTNER,
      late: LATE_WRITE, lateNarrator: LATE_PLAY, lateAs: 'system', lateNarratorAs: 'system', ...(empty ? { lateOff: true, lateNarratorOff: true } : {}) };
    const data = { connections: [{ ...connection, prefill: empty ? '' : `<think>${scene ? SEED_PLAY : SEED_WRITE}</think>${scene ? OPEN_PLAY : OPEN_WRITE}` }],
      roles: { writer: connection.id, partner: connection.id, checker: 'off' }, you: { name: 'Maya' }, instructions,
      ownWords: empty ? ownWords.map(w => ({ ...w, on: false })) : ownWords, modules: {} };
    if (await store.open('house', 'house')) store.change('house', 'house', h => { for (const key of Object.keys(h)) delete h[key]; Object.assign(h, structuredClone(data)); });
    else await store.create('house', 'house', structuredClone(data));
    await store.flush('house', 'house');
    return structuredClone(data);
  }
  async function book() {
    const { novel, chapter } = shape.newNovel({ title: 'The Lantern Academy', brief: 'BOOK IDENTITY: {{user}} writes about {{char}}, the academy’s keeper.', style: 'Tender fantasy told in third person, past tense.' });
    novel.meta.char = 'Edda';
    novel.auto = { about: false, style: false };
    novel.prefs.pov = 'third-limited';
    novel.prefs.tense = 'past';
    chapter.passages.push(shape.newPassage('you', 'Edda waited beside the academy’s blue gate.', { how: 'mine' }));
    await store.create('chapter', chapter.id, chapter);
    await store.create('novel', novel.id, novel);
    return { novelId: novel.id, chapterId: chapter.id, chapter: () => store.peek('chapter', chapter.id) };
  }
  const script = queue => fetchLocal(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) });
  const requests = async () => (await (await fetchLocal(PROVIDER + '/requests')).json()).requests;
  const allWords = body => body.messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n\n');
  function noDefaults(body) {
    const words = allWords(body);
    for (const defaultWords of [prompts.DEFAULT_WRITING, prompts.DEFAULT_NARRATOR, prompts.DEFAULT_PARTNER]) assert.ok(!words.includes(defaultWords), 'a custom or empty box is not replaced by its default');
    assert.ok(!words.includes('OFF VOICE:'), 'a disabled own-voice entry stays absent');
    assert.ok(!/\{\{\s*(?:user|char)\s*\}\}/i.test(words), 'identity macros are filled before sending');
  }
  function writerVoice(body, { seed = true, opening = true } = {}) {
    noDefaults(body);
    const words = allWords(body);
    assert.ok(body.messages[0].content.startsWith(WRITER_SENT), 'the exact funny-Batman instructions come first');
    assert.ok(words.includes('BOOK IDENTITY: Maya writes about Edda, the academy’s keeper.'));
    assert.ok(words.includes('OWN VOICE: the writer keeps the voice chosen by Maya.'));
    assert.ok(words.includes('OWN WRITER: Dry jokes, gentle warmth.\nKeep this line exactly.'));
    assert.ok(words.includes('BATMAN LATE: Keep the dry humor, the writer.\nMaya remains Maya.'));
    assert.ok(!words.includes('HULK LATE:') && !words.includes('OWN NARRATOR:'));
    if (seed) {
      const last = body.messages.at(-1);
      assert.equal(last.role, 'assistant');
      assert.equal(last.reasoning_content, SEED_WRITE, 'his thinking seed is delivered unchanged');
      assert.equal(last.content, opening ? OPEN_WRITE.trimEnd() : '', 'only fresh prose receives the page opening');
    }
  }
  async function test(name, fn) {
    await fetchLocal(PROVIDER + '/reset');
    try { await fn(); passed++; console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.stack); }
  }

  await test('funny Batman stays the writer through a page, rewrite, selected rewrite and Go on', async () => {
    const saved = await profile();
    const b = await book();
    await script([
      { text: 'Edda lifted the blue lamp while the last bell rang', finish: 'length', think: 'VISIBLE BATMAN THOUGHT: keep the requested voice.' },
      { text: 'Edda lifted the silver lamp while the last bell rang', finish: 'length', think: 'VISIBLE REWRITE THOUGHT: keep the requested change.' },
      { text: 'golden', think: 'VISIBLE SELECTION THOUGHT: change only the marked word.' },
      { text: 'and the garden door opened.', think: 'VISIBLE CONTINUATION THOUGHT: carry on from the same moment.' },
    ]);
    assert.equal((await writer.writeNext({ ...b, direction: 'Edda waits for the last bell.' })).ok, true);
    const passage = () => b.chapter().passages.at(-1);
    assert.equal(picked(passage()).thinking, SEED_WRITE + ' VISIBLE BATMAN THOUGHT: keep the requested voice.');
    assert.equal((await writer.rewrite({ ...b, passageId: passage().id, note: 'The lamp is silver; keep Batman’s dry humor.' })).ok, true);
    assert.equal(picked(passage()).thinking, SEED_WRITE + ' VISIBLE REWRITE THOUGHT: keep the requested change.');
    const at = picked(passage()).text.indexOf('silver');
    assert.ok(at >= 0);
    assert.equal((await writer.rewriteSelection({ ...b, passageId: passage().id, start: at, end: at + 6, note: 'Make only the lamp golden.' })).ok, true);
    assert.equal(picked(passage()).thinking, SEED_WRITE + ' VISIBLE SELECTION THOUGHT: change only the marked word.');
    assert.equal((await writer.goOn({ ...b, passageId: passage().id })).ok, true);
    const thought = picked(passage()).thinking;
    assert.ok(thought.includes('VISIBLE SELECTION THOUGHT: change only the marked word.'));
    assert.ok(thought.includes('VISIBLE CONTINUATION THOUGHT: carry on from the same moment.'));
    const bodies = (await requests()).map(r => r.body);
    assert.equal(bodies.length, 4);
    bodies.forEach((body, i) => writerVoice(body, { opening: i < 2 }));
    assert.ok(allWords(bodies[3]).includes('The lamp is silver; keep Batman’s dry humor.'));
    assert.ok(allWords(bodies[3]).includes('Make only the lamp golden.'));
    assert.deepEqual(store.peek('house', 'house').instructions, saved.instructions, 'calls never rewrite custom instructions');
    assert.deepEqual(store.peek('house', 'house').ownWords, saved.ownWords);
  });

  await test('Hulk narrates for the played character while scene conversion returns to the chosen writer', async () => {
    await profile({ scene: true });
    const b = await book();
    const playId = await talk.newPlay({ ...b, who: 'Rook', from: 'Rook arrives at the academy gate.' });
    await script([
      { text: 'Edda opened the blue gate and waited for Rook to speak.', think: 'VISIBLE HULK THOUGHT: keep Rook’s next choice open.' },
      { text: 'Edda opened the gate as Rook arrived.', think: 'VISIBLE CONVERSION THOUGHT: keep the scene and chosen prose voice.' },
    ]);
    assert.equal((await talk.playSay({ playId, text: 'I raise my hand to knock.', tell: 'Leave my next words to me.' })).ok, true);
    const sceneBody = (await requests())[0].body;
    noDefaults(sceneBody);
    assert.ok(sceneBody.messages[0].content.startsWith(NARRATOR_SENT), 'Hulk receives the exact scene instructions and Rook identity');
    const sceneWords = allWords(sceneBody);
    assert.ok(sceneWords.includes('BOOK IDENTITY: Maya writes about Edda, the academy’s keeper.'));
    assert.ok(sceneWords.includes('OWN VOICE: the narrator keeps the voice chosen by Rook.'));
    assert.ok(sceneWords.includes('OWN NARRATOR: Big feelings, tender humor.\nRook acts for themselves.'));
    assert.ok(sceneWords.includes('HULK LATE: Stay warm and funny, the narrator.\nRook keeps the next choice.'));
    assert.ok(!sceneWords.includes('BATMAN LATE:') && !sceneWords.includes('OWN WRITER:'));
    assert.equal(sceneBody.messages.at(-1).reasoning_content, SEED_PLAY);
    const play = store.peek('play', playId);
    assert.equal(picked(play.turns.at(-1)).thinking, SEED_PLAY + ' VISIBLE HULK THOUGHT: keep Rook’s next choice open.');
    const transcript = talk.transcriptOf(play);
    await profile();
    assert.equal((await writer.playToProse({ ...b, play, transcript: transcript.text, mine: transcript.mine })).ok, true);
    const proseBody = (await requests())[1].body;
    writerVoice(proseBody);
    assert.ok(allWords(proseBody).includes(transcript.text), 'the played events reach the prose writer unchanged');
    assert.equal(picked(b.chapter().passages.at(-1)).thinking, SEED_WRITE + ' VISIBLE CONVERSION THOUGHT: keep the scene and chosen prose voice.');
  });

  await test('an original partner keeps their instructions through a read round without borrowing story personas', async () => {
    const saved = await profile();
    const b = await book();
    await script([
      { text: '<read>[1]</read>', think: 'VISIBLE PARTNER FIRST: request the chapter.' },
      { text: 'The chapter places Edda at the blue gate.', think: 'VISIBLE PARTNER SECOND: answer from what was read.' },
    ]);
    assert.equal((await talk.partnerSay({ ...b, text: 'Read chapter one, then help me plan the next moment.' })).ok, true);
    const bodies = (await requests()).map(r => r.body);
    assert.equal(bodies.length, 2, 'the read round actually occurred');
    for (const body of bodies) {
      noDefaults(body);
      const words = allWords(body);
      assert.ok(body.messages[0].content.startsWith(PARTNER_SENT));
      assert.ok(words.includes('BOOK IDENTITY: Maya writes about Edda, the academy’s keeper.'));
      assert.ok(!words.includes('BATMAN LATE:') && !words.includes('HULK LATE:') && !words.includes('OWN VOICE:'));
      assert.ok(!words.includes(WRITER_SENT) && !words.includes(NARRATOR_SENT));
      assert.ok(!body.messages.some(m => m.reasoning_content === SEED_WRITE), 'the page’s thinking seed is not the partner’s');
      assert.equal(body.messages.at(-1).role, 'user');
    }
    const thought = picked(store.peek('talk', b.novelId).turns.at(-1)).thinking;
    assert.ok(thought.includes('VISIBLE PARTNER FIRST: request the chapter.'));
    assert.ok(thought.includes('VISIBLE PARTNER SECOND: answer from what was read.'));
    assert.deepEqual(store.peek('house', 'house').instructions, saved.instructions);
    assert.equal(store.peek('house', 'house').connections[0].prefill, saved.connections[0].prefill, 'partner calls never erase the writer’s seed');
  });

  await test('empty persona boxes and disabled voice entries stay empty instead of reinstalling defaults', async () => {
    const saved = await profile({ empty: true });
    const b = await book();
    await script([{ text: 'The lamp stayed lit.' }, { text: 'Edda waited at the gate.' }]);
    assert.equal((await writer.writeNext({ ...b, direction: 'Continue the moment.' })).ok, true);
    const playId = await talk.newPlay({ ...b, who: 'Rook' });
    assert.equal((await talk.playSay({ playId, text: 'I wait.' })).ok, true);
    for (const { body } of await requests()) {
      noDefaults(body);
      const words = allWords(body);
      assert.ok(!words.includes('OWN VOICE:') && !words.includes('OWN WRITER:') && !words.includes('OWN NARRATOR:'));
      assert.ok(!words.includes('BATMAN LATE:') && !words.includes('HULK LATE:'));
    }
    assert.deepEqual(store.peek('house', 'house').instructions, saved.instructions);
  });
} catch (error) { failed++; console.error(error.stack); }
finally {
  if (store) await store.flush().catch(() => {});
  globalThis.fetch = fetchLocal;
  for (const child of children) { try { child.kill(); } catch (_) { /* stopped */ } }
  rmSync(personaHome, { recursive: true, force: true });
}
console.log(`\npersonas: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
