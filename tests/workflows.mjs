/* Synthetic, isolated writer / scene / partner handoff regressions. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_WORKFLOW_PORT || 19250);
const PROV = Number(process.env.COZY_WORKFLOW_PROVIDER_PORT || 19252);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = `http://127.0.0.1:${PROV}`;
const home = mkdtempSync(path.join(os.tmpdir(), 'cozynovel-workflows-'));
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { try { if (await fn()) return; } catch (_) {} await sleep(50); }
  throw new Error('Timed out waiting for the isolated test server');
}
let passed = 0, failed = 0;
async function test(name, fn) {
  await realFetch(PROVIDER + '/reset');
  try { await fn(); console.log('PASS ' + name); passed++; }
  catch (error) { console.error('FAIL ' + name + '\n' + error.stack); failed++; }
}
try {
  await waitFor(async () => (await realFetch(BASE + '/api/version')).ok);
  await waitFor(async () => (await realFetch(PROVIDER + '/requests')).ok);
  globalThis.fetch = (url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  const store = await import('../js/store.js');
  const shape = await import('../js/novel/shape.js');
  const writer = await import('../js/novel/writer.js');
  const talk = await import('../js/novel/talk.js');
  const { picked } = shape;
  const CONN = { id: 'test-writer', name: 'Stand-in writer', url: PROVIDER + '/v1', model: 'scripted', key: 'test-only' };
  await store.create('house', 'house', { connections: [CONN], roles: { writer: CONN.id, checker: 'off' }, instructions: { system: 'MY EXACT WRITING WORDS', narrator: 'MY EXACT NARRATOR WORDS', partner: 'MY EXACT PARTNER WORDS', late: '', sceneLate: '' }, modules: Object.fromEntries(['novel-craft', 'scene-craft', 'voice', 'intimate', 'contested'].map((id) => [id, { rides: 'off' }])) });
  const script = (queue) => realFetch(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) });
  const requests = async () => (await (await realFetch(PROVIDER + '/requests')).json()).requests;
  const lastRequest = async () => (await requests()).at(-1).body.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  async function makeBook(passages = []) {
    const { novel, chapter } = shape.newNovel({ title: 'Synthetic workflow book', brief: 'Mara keeps a lighthouse.' });
    novel.auto = { about: false, style: false };
    for (const p of passages) chapter.passages.push(typeof p === 'string' ? shape.newPassage('ai', p, { how: 'write', ask: { direction: 'Mara tends the light.', length: 'scene' } }) : p);
    await store.create('chapter', chapter.id, chapter);
    await store.create('novel', novel.id, novel);
    return { novelId: novel.id, chapterId: chapter.id, chapter: () => store.peek('chapter', chapter.id) };
  }

  await test('a scene opened in an empty chapter stays before prose written later', async () => {
    const b = await makeBook();
    const playId = await talk.newPlay({ ...b, who: 'Mara', from: 'At dusk.' });
    writer.addMine({ ...b, text: 'LATER: The first dawn train leaves.' });
    await script([{ text: 'Mara lights the lamp.' }, { text: 'AT DUSK: Mara lit the lamp.' }]);
    assert.equal((await talk.playSay({ playId, text: 'I light the lamp.' })).ok, true);
    const request = await lastRequest();
    assert.ok(request.includes('LATER: The first dawn train leaves.'), 'later prose remains available');
    assert.ok(request.includes('What comes right after it in the chapter (already written — keep it consistent):\n\nLATER:'), 'later prose is labelled as later, not preceding the scene');
    const play = store.peek('play', playId);
    const transcript = talk.transcriptOf(play);
    assert.equal((await writer.playToProse({ ...b, play, transcript: transcript.text, mine: transcript.mine })).ok, true);
    assert.deepEqual(b.chapter().passages.map((p) => picked(p).text), ['AT DUSK: Mara lit the lamp.', 'LATER: The first dawn train leaves.']);
  });

  await test('scene conversion keeps its anchor before a later scene break', async () => {
    const b = await makeBook(['The first line.']);
    const playId = await talk.newPlay({ ...b, who: 'Mara' });
    writer.addBreak({ chapterId: b.chapterId });
    await script([{ text: 'The scene belongs before the break.' }]);
    assert.equal((await writer.playToProse({ ...b, play: store.peek('play', playId), transcript: 'Narrator: The scene belongs before the break.' })).ok, true);
    assert.equal(picked(b.chapter().passages[1]).text, 'The scene belongs before the break.');
    assert.equal(b.chapter().passages[2].by, 'break');
  });

  await test('a partner response whose turn disappeared never changes the book', async () => {
    const b = await makeBook(['The lamp is amber.']);
    await script([{ pause: .45, text: 'I changed the lamp.\n<changes>[{"passage":"1.1","find":"amber","replace":"violet","why":"a new color"}]</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Change amber to violet.' });
    await waitFor(async () => (await requests()).length > 0);
    store.change('talk', b.novelId, (rec) => { rec.turns = []; }, { now: true });
    const out = await reply;
    assert.equal(picked(b.chapter().passages[0]).text, 'The lamp is amber.');
    assert.equal(store.peek('talk', b.novelId).turns.length, 0);
    assert.equal(out.ok, false);
  });

  await test('an answer never lands in a copied conversation that reuses its turn IDs', async () => {
    const b = await makeBook(['The lamp is amber.']);
    await script([{ pause: .4, text: 'I changed the lamp.\n<changes>[{"passage":"1.1","find":"amber","replace":"violet"}]</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Change amber to violet.' });
    await waitFor(async () => (await requests()).length > 0);
    store.change('talk', b.novelId, (rec) => { rec.convId = 'another-conversation'; for (const turn of rec.turns) for (const v of turn.versions) delete v.streaming; }, { now: true });
    const before = JSON.stringify(store.peek('talk', b.novelId).turns);
    const out = await reply;
    assert.equal(out.gone, true);
    assert.equal(picked(b.chapter().passages[0]).text, 'The lamp is amber.');
    assert.equal(JSON.stringify(store.peek('talk', b.novelId).turns), before);
  });

  await test('writing removed in another window stops without returning a successful missing passage', async () => {
    const b = await makeBook();
    await script([{ pause: .4, text: 'This page was removed while it was being written.' }]);
    const reply = writer.writeNext({ ...b, direction: 'Mara lights the lantern.' });
    await waitFor(async () => (await requests()).length > 0);
    store.change('chapter', b.chapterId, (chapter) => { chapter.passages = []; }, { now: true });
    const out = await reply;
    assert.equal(out.gone, true);
    assert.equal(out.ok, false);
    assert.equal(b.chapter().passages.length, 0);
  });

  await test('Go on carries a rewrite note through a hand edit without restoring outcome autonomy', async () => {
    const note = 'Mara refuses the crown and leaves with Jun.';
    const p = shape.newPassage('ai', 'At dawn, Mara held the crown while the old clock struck its final', { how: 'rewrite', ask: { note }, cut: true });
    const b = await makeBook([p]);
    writer.saveEdit({ ...b, passageId: p.id, text: 'At dusk, Mara held the crown while the old clock struck its final' });
    await script([{ text: 'hour.' }]);
    assert.equal((await writer.goOn({ ...b, passageId: p.id })).ok, true);
    const request = await lastRequest();
    assert.ok(request.includes(note), 'the exact rewrite direction rides');
    assert.ok(!request.includes('How it turns out is yours to decide'), 'a rewrite already settled the outcome');
    assert.ok(request.includes('MY EXACT WRITING WORDS'));
    assert.equal(p.versions[0].text, 'At dawn, Mara held the crown while the old clock struck its final');
  });

  await test('Go on carries the originating premise and latest selection instruction together', async () => {
    const direction = 'Mara refuses the crown and leaves with Jun.';
    const p = shape.newPassage('ai', 'Mara raised the bronze lamp while the old clock struck its final', { how: 'write', ask: { direction }, cut: true });
    const b = await makeBook([p]);
    const selected = shape.newVersion({ text: 'Mara raised the silver lamp while the old clock struck its final', how: 'selection', ask: { note: 'The lamp is silver, never bronze.', from: 16, to: 22 }, base: p.versions[0].id, cut: true, endCut: true });
    store.change('chapter', b.chapterId, shape.chapterSteps.addVersion(p.id, selected), { now: true });
    await script([{ text: 'hour.' }]);
    assert.equal((await writer.goOn({ ...b, passageId: p.id })).ok, true);
    const request = await lastRequest();
    assert.ok(request.includes(direction), 'the original premise rides');
    assert.ok(request.includes('The lamp is silver, never bronze.'), 'the selected rewrite note rides');
  });

  await test('Go on retains the played scene when its prose was cut, even after an edit', async () => {
    const transcript = 'Narrator: Mara lifts the lantern.\n\nMara: I enter the garden.\n\nNarrator: Jun waits beside the locked iron gate.';
    const p = shape.newPassage('ai', 'At dawn, Mara raised the lamp while the old clock struck its final', { how: 'play', ask: { transcript, who: 'Mara', length: 'scene' }, cut: true });
    const b = await makeBook([p]);
    writer.saveEdit({ ...b, passageId: p.id, text: 'At dusk, Mara raised the lamp while the old clock struck its final' });
    await script([{ text: 'hour. She entered the garden; Jun waited by the locked iron gate.' }]);
    assert.equal((await writer.goOn({ ...b, passageId: p.id })).ok, true);
    const request = await lastRequest();
    assert.ok(request.includes(transcript), 'the whole played scene rides unchanged');
    assert.ok(!request.includes('How it turns out is yours to decide'), 'the played scene already settled the outcome');
  });

  await test('request ancestry follows the selected branch and keeps no superseded rewrite note', async () => {
    const first = shape.newPassage('ai', 'The king stood.', { how: 'write', ask: { direction: 'The king faces Mara.' } });
    const b = await makeBook([first]);
    const abandoned = shape.newVersion({ text: 'Mara takes the crown.', how: 'rewrite', ask: { note: 'Mara takes the crown.' }, from: first.versions[0].id });
    const chosen = shape.newVersion({ text: 'Mara refuses the crown.', how: 'rewrite', ask: { note: 'Mara refuses the crown.' }, from: first.versions[0].id });
    store.change('chapter', b.chapterId, shape.chapterSteps.addVersion(first.id, abandoned));
    store.change('chapter', b.chapterId, shape.chapterSteps.addVersion(first.id, chosen));
    writer.saveEdit({ ...b, passageId: first.id, text: 'Mara quietly refuses the crown.' });
    const passage = b.chapter().passages[0];
    assert.equal(shape.requestOf(passage).ask.note, 'Mara refuses the crown.');
    const words = shape.hisWordsIn(passage);
    assert.ok(words.includes('Mara refuses the crown.'));
    assert.ok(!words.includes('Mara takes the crown.'));
  });

  await test('a closed scene window retains thinking that arrived before any story words', async () => {
    const b = await makeBook();
    const playId = await talk.newPlay({ ...b, who: 'Mara' });
    const turn = shape.newTurn('ai', '', { streaming: true, thinking: 'Mara sees the locked gate before choosing what to do.', beat: 1, browser: 'closed-browser', tab: 'closed-tab', at: 1 });
    store.change('play', playId, shape.turnSteps.addTurn(turn), { now: true });
    assert.equal(await talk.repairStaleTurns('play', playId), 1);
    const recovered = store.peek('play', playId).turns.find((t) => t.id === turn.id);
    assert.ok(recovered, 'thinking remains available beside the scene');
    assert.equal(picked(recovered).thinking, 'Mara sees the locked gate before choosing what to do.');
    assert.equal(picked(recovered).streaming, undefined);
    assert.equal(picked(recovered).cut, true);
  });

  await test('a delayed partner reply preserves newer custom instructions, summary, card, chapter and passage', async () => {
    const b = await makeBook(['The lamp is amber.']);
    const moduleId = 'workflow-custom';
    store.change('house', 'house', (h) => { h.modules[moduleId] = { custom: true, name: 'My careful voice', text: 'Original custom voice.', to: ['writer', 'partner'], rides: 'always' }; });
    store.change('novel', b.novelId, (n) => { n.plans = 'Original book instruction.'; n.notes.people = [{ id: 'mara', name: 'Mara', about: 'Original character description.', now: 'At the lamp.' }]; });
    store.change('chapter', b.chapterId, (c) => { c.name = 'Original chapter'; c.summary = { text: 'Original summary.' }; });
    const ops = [
      { module: 'My careful voice', text: 'Late model voice.' }, { book: 'plans', text: 'Late model instruction.' },
      { summary: '1', text: 'Late model summary.' }, { note: 'people', name: 'Mara', about: 'Late model description.' },
      { passage: '1.1', text: 'Late model passage.' }, { chapter: '1', name: 'Late model chapter' },
    ];
    await script([{ pause: .4, text: 'Here are the changes.\n<changes>' + JSON.stringify(ops) + '</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Revise the voice and the book.' });
    await waitFor(async () => (await requests()).length > 0);
    const mine = 'My EXACT new voice.\nKeep this line, too.';
    store.change('house', 'house', (h) => { h.modules[moduleId].text = mine; }, { now: true });
    store.change('novel', b.novelId, (n) => { n.plans = 'My new book instruction.'; n.notes.people[0].about = 'My new character description.'; }, { now: true });
    store.change('chapter', b.chapterId, (c) => { c.name = 'My new chapter'; c.summary = { text: 'My new summary.' }; }, { now: true });
    writer.saveEdit({ ...b, passageId: b.chapter().passages[0].id, text: 'My new passage.' });
    assert.equal((await reply).ok, true);
    assert.equal(store.peek('house', 'house').modules[moduleId].text, mine);
    assert.equal(store.peek('novel', b.novelId).plans, 'My new book instruction.');
    assert.equal(store.peek('novel', b.novelId).notes.people[0].about, 'My new character description.');
    assert.equal(b.chapter().summary.text, 'My new summary.');
    assert.equal(b.chapter().name, 'My new chapter');
    assert.equal(picked(b.chapter().passages[0]).text, 'My new passage.');
    const changes = picked(store.peek('talk', b.novelId).turns.at(-1)).changes;
    assert.equal(changes.length, ops.length);
    assert.ok(changes.every((c) => c.status === 'refused' && c.said.includes('changed while this reply was on the way')));
    assert.equal((await requests()).length, 1, 'newer words are never silently asked away');
  });

  await test('a delayed partner reply cannot replace a module created while it was answering', async () => {
    const b = await makeBook(['Mara lights the lamp.']);
    const moduleId = 'workflow-created-later';
    await script([{ pause: .4, text: 'A new voice.\n<changes>[{"module":"My newly created voice","text":"Late model instructions."}]</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Review my custom voice.' });
    await waitFor(async () => (await requests()).length > 0);
    store.change('house', 'house', (h) => { h.modules[moduleId] = { custom: true, name: 'My newly created voice', text: 'My exact new instructions.', to: ['writer', 'partner'], rides: 'always' }; }, { now: true });
    assert.equal((await reply).ok, true);
    assert.equal(store.peek('house', 'house').modules[moduleId].text, 'My exact new instructions.');
    const changes = picked(store.peek('talk', b.novelId).turns.at(-1)).changes;
    assert.equal(changes[0].status, 'refused');
    assert.ok(changes[0].said.includes('changed while this reply was on the way'));
    assert.equal((await requests()).length, 1);
  });

  await test('extra quote or addition fields cannot disguise a delayed whole change', async () => {
    const b = await makeBook(['The lamp is amber.']);
    const moduleId = 'workflow-extra-fields';
    store.change('house', 'house', (h) => { h.modules[moduleId] = { custom: true, name: 'My guarded voice', text: 'Original voice.', to: ['writer', 'partner'], rides: 'always' }; });
    store.change('novel', b.novelId, (n) => { n.notes.people = [{ id: 'mara', name: 'Mara', about: 'Original character description.' }]; });
    store.change('chapter', b.chapterId, (c) => { c.name = 'Original chapter'; });
    const ops = [
      { passage: '1.1', remove: true, find: 'The lamp is amber.' },
      { module: 'My guarded voice', text: 'Late model voice.', add: 'Extra words.' },
      { chapter: '1', name: 'Late model chapter', find: 'Original chapter' },
      { note: 'people', name: 'Mara', about: 'Late model description.', find: 'Original character description.' },
    ];
    await script([{ pause: .4, text: 'Here are the changes.\n<changes>' + JSON.stringify(ops) + '</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Revise these details.' });
    await waitFor(async () => (await requests()).length > 0);
    store.change('house', 'house', (h) => { h.modules[moduleId].text = 'My new voice.'; }, { now: true });
    store.change('novel', b.novelId, (n) => { n.notes.people[0].about = 'My new character description.'; }, { now: true });
    store.change('chapter', b.chapterId, (c) => { c.name = 'My new chapter'; }, { now: true });
    writer.saveEdit({ ...b, passageId: b.chapter().passages[0].id, text: 'My new passage.' });
    assert.equal((await reply).ok, true);
    assert.equal(b.chapter().passages.length, 1);
    assert.equal(picked(b.chapter().passages[0]).text, 'My new passage.');
    assert.equal(store.peek('house', 'house').modules[moduleId].text, 'My new voice.');
    assert.equal(store.peek('novel', b.novelId).notes.people[0].about, 'My new character description.');
    assert.equal(b.chapter().name, 'My new chapter');
    const changes = picked(store.peek('talk', b.novelId).turns.at(-1)).changes;
    assert.ok(changes.every((c) => c.status === 'refused' && c.said.includes('changed while this reply was on the way')));
    assert.equal((await requests()).length, 1);
  });

  await test('a waiting whole deletion with an extra quote preserves a later hand edit', async () => {
    const b = await makeBook(['The lamp is amber.']);
    store.change('house', 'house', (h) => { h.partnerApplies = 'wait'; });
    try {
      await script([{ text: 'Take out the passage.\n<changes>[{"passage":"1.1","remove":true,"find":"The lamp is amber."}]</changes>' }]);
      assert.equal((await talk.partnerSay({ ...b, text: 'Take out this passage.' })).ok, true);
      const turn = store.peek('talk', b.novelId).turns.at(-1);
      const version = picked(turn);
      assert.equal(version.changes[0].status, 'waiting');
      writer.saveEdit({ ...b, passageId: b.chapter().passages[0].id, text: 'My newer passage stays.' });
      talk.applyChange(b.novelId, turn.id, version.id, version.changes[0].id);
      assert.equal(picked(b.chapter().passages[0]).text, 'My newer passage stays.');
      const change = picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0];
      assert.equal(change.status, 'refused');
      assert.ok(change.said.includes('changed since this was offered'));
    } finally {
      store.change('house', 'house', (h) => { delete h.partnerApplies; });
    }
  });

  await test('a partner card change still lands when only an unrelated card field changed', async () => {
    const b = await makeBook(['Mara lights the lamp.']);
    store.change('novel', b.novelId, (n) => { n.notes.people = [{ id: 'mara', name: 'Mara', about: 'Keeps the lamp.', now: 'At the lamp.' }]; });
    await script([{ pause: .4, text: 'A fuller description.\n<changes>[{"note":"people","name":"Mara","about":"Keeps the lamp and tends the garden."}]</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Add her gardening to her description.' });
    await waitFor(async () => (await requests()).length > 0);
    store.change('novel', b.novelId, (n) => { n.notes.people[0].now = 'In the garden.'; }, { now: true });
    assert.equal((await reply).ok, true);
    const card = store.peek('novel', b.novelId).notes.people[0];
    assert.equal(card.about, 'Keeps the lamp and tends the garden.');
    assert.equal(card.now, 'In the garden.');
  });

  await test('same-answer operations and a partner follow-up round may refine their own changes', async () => {
    const b = await makeBook(['The lamp is amber.']);
    await script([
      { text: 'First, the plan.\n<changes>[{"book":"plans","text":"First plan."},{"book":"plans","text":"Second plan."},{"passage":"1.1","find":"a missing phrase","replace":"the lamp"}]</changes>' },
      { text: 'The final plan.\n<changes>[{"book":"plans","text":"Final plan."}]</changes>' },
    ]);
    assert.equal((await talk.partnerSay({ ...b, text: 'Refine the plan.' })).ok, true);
    assert.equal(store.peek('novel', b.novelId).plans, 'Final plan.');
    const changes = picked(store.peek('talk', b.novelId).turns.at(-1)).changes;
    assert.equal(changes.filter((c) => c.op.book === 'plans' && c.status === 'made').length, 3);
    assert.equal((await requests()).length, 2);
  });

  await test('quoted changes preserve unrelated newer wording while matching the current text', async () => {
    const b = await makeBook(['The lamp is amber.']);
    await script([{ pause: .4, text: 'A silver lamp.\n<changes>[{"passage":"1.1","find":"amber","replace":"silver"}]</changes>' }]);
    const reply = talk.partnerSay({ ...b, text: 'Make the lamp silver.' });
    await waitFor(async () => (await requests()).length > 0);
    writer.saveEdit({ ...b, passageId: b.chapter().passages[0].id, text: 'Mara carries the amber lamp into the garden.' });
    assert.equal((await reply).ok, true);
    assert.equal(picked(b.chapter().passages[0]).text, 'Mara carries the silver lamp into the garden.');
  });
  await store.flush();
} catch (error) {
  console.error(error.stack); failed++;
} finally {
  globalThis.fetch = realFetch;
  for (const child of children) { try { child.kill(); } catch (_) {} }
  rmSync(home, { recursive: true, force: true });
}
console.log(`\n${passed} workflow checks passed; ${failed} failed.`);
process.exit(failed ? 1 : 0);
