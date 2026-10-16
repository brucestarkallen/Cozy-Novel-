/* Synthetic, isolated writer / scene / partner handoff regressions. */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_FINAL_WORKFLOW_PORT || 22650);
const PROV = Number(process.env.COZY_FINAL_WORKFLOW_PROVIDER_PORT || 22652);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = `http://127.0.0.1:${PROV}`;
const home = mkdtempSync(path.join(os.tmpdir(), 'cozynovel-final-workflows-'));
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


  const { convSteps } = await import('../js/novel/conversations.js');
  async function remoteChange(kind, id, step) {
    const record = await (await realFetch(`${BASE}/api/store/${kind}/${id}`)).json();
    step(record.data);
    const response = await realFetch(`${BASE}/api/store/${kind}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base': String(record.rev) }, body: JSON.stringify({ data: record.data }) });
    assert.equal(response.status, 200);
  }
  async function conversations() {
    const b = await makeBook(['Mara keeps the lamp.']);
    const first = shape.newTurn('you', 'First conversation words.');
    const second = shape.newTurn('you', 'Second conversation words.');
    await store.create('talk', b.novelId, { id: b.novelId, novelId: b.novelId, convId: 'first', name: 'First', turns: [first], convs: [{ id: 'second', name: 'Second', turns: [second], at: Date.now() }] });
    await remoteChange('talk', b.novelId, convSteps.open({ id: 'second', spareId: 'first', spareName: 'First', at: Date.now() }));
    return { ...b, first, second };
  }
  await test('new and legacy partner conversations keep a stable identity for their drafts', async () => {
    const fresh = await makeBook();
    const created = await talk.ensureTalk(fresh.novelId);
    assert.ok(created.convId);
    assert.equal((await talk.ensureTalk(fresh.novelId)).convId, created.convId);
    const legacy = await makeBook();
    const words = shape.newTurn('you', 'The old conversation stays whole.');
    await store.create('talk', legacy.novelId, { id: legacy.novelId, novelId: legacy.novelId, turns: [words] });
    const migrated = await talk.ensureTalk(legacy.novelId);
    assert.ok(migrated.convId);
    assert.equal((await talk.ensureTalk(legacy.novelId)).convId, migrated.convId);
    assert.deepEqual(migrated.turns, [words]);
  });
  await test('giving a legacy conversation its identity preserves a newer window identity', async () => {
    const b = await makeBook();
    const words = shape.newTurn('you', 'The old words stay.');
    await store.create('talk', b.novelId, { id: b.novelId, novelId: b.novelId, turns: [words] });
    await remoteChange('talk', b.novelId, d => { d.convId = 'already-named-elsewhere'; });
    const got = await talk.ensureTalk(b.novelId);
    assert.equal(got.convId, 'already-named-elsewhere');
    assert.deepEqual(got.turns, [words]);
  });
  for (const action of ['start over', 'remove', 'copy', 'rename', 'fresh']) {
    await test(`${action} cannot target another conversation when its save replays`, async () => {
      const b = await conversations();
      let out;
      if (action === 'start over') out = await talk.startOver(b.novelId);
      if (action === 'remove') out = await talk.removeConversation(b.novelId);
      if (action === 'copy') out = await talk.copyConversation(b.novelId);
      if (action === 'rename') out = await talk.renameConversation(b.novelId, 'Renamed first');
      if (action === 'fresh') out = await talk.newConversation(b.novelId);
      await store.flush('talk', b.novelId);
      const saved = (await (await realFetch(`${BASE}/api/store/talk/${b.novelId}`)).json()).data;
      assert.equal(saved.convId, 'second');
      assert.equal(saved.name, 'Second');
      assert.deepEqual(saved.turns, [b.second]);
      assert.deepEqual(saved.convs.find(c => c.id === 'first').turns, [b.first]);
      assert.equal(out.ok, false, 'a save that stood down must say the action did not happen');
    });
  }
  for (const action of ['start over', 'remove', 'edit and ask again']) {
    await test(`${action} preserves new messages added to the same conversation before a save replay`, async () => {
      const b = await makeBook(['Mara keeps the lamp.']);
      const first = shape.newTurn('you', 'The first message.');
      const newest = shape.newTurn('you', 'Important newer words from another window.');
      await store.create('talk', b.novelId, { id: b.novelId, novelId: b.novelId, convId: 'original', name: 'Original', turns: [first], convs: [] });
      await remoteChange('talk', b.novelId, shape.turnSteps.addTurn(newest));
      const out = action === 'start over' ? await talk.startOver(b.novelId)
        : action === 'remove' ? await talk.removeConversation(b.novelId)
          : await talk.editAndAskAgain(b.novelId, first.id);
      await store.flush('talk', b.novelId);
      const saved = store.peek('talk', b.novelId);
      assert.equal(saved.convId, 'original');
      assert.deepEqual(saved.turns, [first, newest]);
      assert.equal(out.ok, false);
    });
  }
  await test('a message never crosses conversations after a refused save and returns to the box', async () => {
    const b = await conversations();
    await script([{ pause: .3, text: 'This answer belongs to the first conversation.' }]);
    const out = await talk.partnerSay({ ...b, text: 'My original question.' });
    await store.flush('talk', b.novelId);
    const saved = store.peek('talk', b.novelId);
    assert.deepEqual(saved.turns, [b.second]);
    assert.equal(out.giveBack, 'My original question.');
    assert.equal(out.ok, false);
  });
  await test('a partner message stays with the conversation selected before scene loading', async () => {
    const b = await makeBook(['Mara keeps the lamp.']);
    await store.create('talk', b.novelId, { id: b.novelId, novelId: b.novelId, convId: 'initial', name: 'Initial', turns: [shape.newTurn('you', 'Already here.')] });
    const missing = 'pl-opening-' + b.novelId;
    store.change('novel', b.novelId, n => { n.plays.push(missing); });
    const originalFetch = globalThis.fetch;
    let reached, release;
    const waiting = new Promise(r => { reached = r; });
    const gate = new Promise(r => { release = r; });
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/store/play/' + missing)) { reached(); await gate; }
      return originalFetch(url, init);
    };
    try {
      const asking = talk.partnerSay({ ...b, text: 'For the initial conversation only.' });
      await waiting;
      assert.equal((await talk.newConversation(b.novelId)).ok, true);
      release();
      const out = await asking;
      assert.equal(out.ok, false);
      assert.equal(out.giveBack, 'For the initial conversation only.');
      assert.equal(store.peek('talk', b.novelId).turns.length, 0);
      assert.equal((await requests()).length, 0);
    } finally { release(); globalThis.fetch = originalFetch; }
  });
  await test('a partner message returns intact when its book disappears while scenes load', async () => {
    const b = await makeBook();
    await talk.ensureTalk(b.novelId);
    const missing = 'pl-opening-' + b.novelId;
    store.change('novel', b.novelId, n => { n.plays.push(missing); });
    const originalFetch = globalThis.fetch;
    let reached, release;
    const waiting = new Promise(r => { reached = r; });
    const gate = new Promise(r => { release = r; });
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/store/play/' + missing)) { reached(); await gate; }
      return originalFetch(url, init);
    };
    try {
      const asking = talk.partnerSay({ ...b, text: 'Keep this question safe.' });
      await waiting;
      await store.remove('novel', b.novelId);
      release();
      const out = await asking;
      assert.equal(out.ok, false);
      assert.equal(out.giveBack, 'Keep this question safe.');
      assert.equal((await requests()).length, 0);
    } finally { release(); globalThis.fetch = originalFetch; }
  });
  await test('a scene follows its moved anchor before being converted to prose', async () => {
    const b = await makeBook(['Mara enters the garden.']);
    const playId = await talk.newPlay({ ...b, who: 'Mara' });
    const moved = b.chapter().passages[0];
    const next = shape.newChapter(b.novelId);
    next.passages.push(moved);
    await store.create('chapter', next.id, next);
    store.change('novel', b.novelId, shape.novelSteps.addChapter(next.id));
    store.change('chapter', b.chapterId, shape.chapterSteps.removePassage(moved.id));
    assert.equal(talk.mendScene(playId), true);
    assert.equal(store.peek('play', playId).chapterId, next.id);
    await script([{ text: 'Jun waits beside the garden gate.' }]);
    assert.equal((await talk.playSay({ playId, text: 'I look for Jun.' })).ok, true);
    const request = await lastRequest();
    assert.ok(request.includes('Mara enters the garden.'));
    assert.ok(request.includes('Chapter Two'));
  });
  await test('a removed initial scene anchor is repaired instead of lingering forever', async () => {
    const b = await makeBook(['Mara enters the garden.']);
    const playId = await talk.newPlay({ ...b, who: 'Mara' });
    store.change('chapter', b.chapterId, shape.chapterSteps.removePassage(b.chapter().passages[0].id));
    assert.equal(talk.mendScene(playId), true);
    assert.equal(store.peek('play', playId).after, null);
    assert.equal(talk.mendScene(playId), false);
  });
  /* 2.11: a chapter the phone answers it no longer holds (its record gone, the book's list still naming it) is not part of
   * the book — it used to stop every page for good, "open the book again" changing nothing (tests/app.mjs). A chapter the
   * phone could not be asked about still stops the page, before anything is added or asked. */
  const unreadable = async (fn) => {
    const before = globalThis.fetch;
    globalThis.fetch = (url, init) => (String(url).includes('/api/store/chapter/unreadable-') ? Promise.resolve(new Response(JSON.stringify({ error: 'the phone could not read it' }), { status: 500 })) : before(url, init));
    try { return await fn(); } finally { globalThis.fetch = before; }
  };
  await test('a chapter that cannot be read stops new prose before adding an empty passage or asking a provider', async () => {
    const b = await makeBook(['Mara enters the garden.']);
    store.change('novel', b.novelId, n => n.order.unshift('unreadable-chapter'));
    await script([{ text: 'Prose written without the missing chapter.' }]);
    const out = await unreadable(() => writer.writeNext({ ...b, direction: 'Continue the story.' }));
    assert.equal(out.ok, false);
    assert.match(out.error, /chapter.*could not be read/i);
    assert.equal((await requests()).length, 0);
    assert.equal(b.chapter().passages.length, 1);
  });
  await test('every rewrite and scene conversion refuses a chapter that cannot be read without altering existing versions', async () => {
    const b = await makeBook(['Mara enters the garden.']);
    const passage = b.chapter().passages[0];
    store.change('novel', b.novelId, n => n.order.push('unreadable-later-chapter'));
    const actions = [
      () => writer.anotherTake({ ...b, passageId: passage.id }),
      () => writer.rewrite({ ...b, passageId: passage.id, note: 'Make the hesitation tender.' }),
      () => writer.rewriteSelection({ ...b, passageId: passage.id, start: 0, end: 4, note: 'Keep her voice.' }),
      () => writer.goOn({ ...b, passageId: passage.id }),
      () => writer.playToProse({ ...b, play: { who: 'Mara', after: passage.id }, transcript: 'Narrator: Jun offers his umbrella.' }),
    ];
    for (const action of actions) assert.equal((await unreadable(action)).ok, false);
    assert.equal((await requests()).length, 0);
    assert.equal(b.chapter().passages.length, 1);
    assert.equal(b.chapter().passages[0].versions.length, 1);
    assert.equal(picked(b.chapter().passages[0]).text, 'Mara enters the garden.');
  });
  await test('a missing book gives a normal failure without an uncaught rejection', async () => {
    const out = await writer.writeNext({ novelId: 'missing-book', chapterId: 'missing-chapter', direction: 'My careful direction.' });
    assert.equal(out.ok, false);
    assert.match(out.error, /book.*shelf/i);
    assert.equal((await requests()).length, 0);
  });
  await test('a scene move to a removed scene returns both the move and narrator instruction', async () => {
    const out = await talk.playSay({ playId: 'missing-play', text: 'I offer Jun my umbrella.', tell: 'Keep the awkward tenderness.' });
    assert.equal(out.ok, false);
    assert.equal(out.giveBack, 'I offer Jun my umbrella.');
    assert.equal(out.giveBackTell, 'Keep the awkward tenderness.');
    assert.equal((await requests()).length, 0);
  });
  await store.flush();
} catch (error) {
  console.error(error.stack); failed++;
} finally {
  globalThis.fetch = realFetch;
  for (const child of children) { try { child.kill(); } catch (_) {} }
  rmSync(home, { recursive: true, force: true });
}
console.log(`\n${passed} final workflow checks passed; ${failed} failed.`);
process.exit(failed ? 1 : 0);
