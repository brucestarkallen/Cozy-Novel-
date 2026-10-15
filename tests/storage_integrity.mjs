/* Restore races and whole-book imports, against a temporary real server.
 * No model calls or existing library files. Run: node tests/storage_integrity.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_STORAGE_PORT || 21661), BASE = `http://127.0.0.1:${PORT}`;
const home = mkdtempSync(path.join(os.tmpdir(), 'cozynovel-storage-'));
const server = spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' });
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = () => { let release; const wait = new Promise((r) => { release = r; }); return { wait, release }; };
let intercept = null, store, passed = 0, failed = 0, serial = 0;
globalThis.fetch = async (url, init = {}) => (intercept && await intercept(String(url), init)) || realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
async function ask(method, url, body, headers = {}) {
  const r = await realFetch(BASE + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, data: await r.json() };
}
async function restored(id, value = 'restored copy', tell = false) {
  const r = await ask('POST', '/api/restore', { format: 'cozynovel-library', records: [{ kind: 'novel', id, data: { id, meta: { title: 'Restore test' }, value } }] });
  assert.equal(r.status, 200);
  const gen = (await ask('GET', '/api/version')).data.generation;
  if (tell) store.forTests().news(JSON.stringify({ reload: true, generation: gen }));
  return gen;
}
async function book() {
  const gen = (await ask('GET', '/api/version')).data.generation;
  store.forTests().news(JSON.stringify({ hello: { commit: '', generation: gen } }));
  const id = 'n-storage-' + ++serial;
  await store.create('novel', id, { id, meta: { title: 'Restore test' }, value: 'before restore' });
  return id;
}
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + (e.stack || e)); }
  finally { intercept = null; }
}
try {
  for (let i = 0; ; i++) {
    try { if ((await realFetch(BASE + '/api/version')).ok) break; } catch (_) { /* starting */ }
    if (i > 100) throw new Error('Temporary server did not start'); await sleep(50);
  }
  store = await import(path.join(ROOT, 'js/store.js'));
  await test('a first save waits for the library number when the opening version request fails', async () => {
    const entered = gate(), finish = gate(); let versions = 0, puts = 0;
    intercept = async (url, init) => {
      if (init.method === 'PUT') puts++;
      if (url === '/api/version') {
        if (++versions === 1) return new Response('{"error":"temporarily unavailable"}', { status: 503 });
        entered.release(); await finish.wait;
      }
    };
    const creating = store.create('novel', 'n-first-save', { id: 'n-first-save', value: 'first words' });
    await entered.wait;
    try { assert.equal(puts, 0); } finally { finish.release(); }
    await creating; assert.equal(puts, 1);
    assert.equal((await ask('GET', '/api/store/novel/n-first-save')).data.data.value, 'first words');
  });
  await test('a save waiting to reach the phone cannot overwrite a restored library before its news arrives', async () => {
    const id = await book(), entered = gate(), finish = gate(); let held = false;
    intercept = async (url, init) => { if (!held && url === '/api/store/novel/' + id && init.method === 'PUT') { held = true; entered.release(); await finish.wait; } };
    store.change('novel', id, (d) => { d.value = 'old pending words'; }, { now: true }); await entered.wait;
    try { await restored(id); } finally { finish.release(); }
    await store.flush();
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'restored copy');
    assert.equal((await store.open('novel', id)).value, 'restored copy');
  });
  await test('a deletion travelling before a whole-copy restore cannot delete the restored book', async () => {
    const id = await book(), entered = gate(), finish = gate();
    intercept = async (url, init) => { if (url === '/api/store/novel/' + id && init.method === 'DELETE') { entered.release(); await finish.wait; } };
    const deleting = store.remove('novel', id).catch(() => null); await entered.wait;
    try { await restored(id); } finally { finish.release(); }
    await deleting;
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data?.value, 'restored copy');
  });
  await test('a record read already travelling cannot bring pre-restore words back onto the page', async () => {
    const id = await book(), entered = gate(), finish = gate(); let held = false;
    intercept = async (url, init) => { if (!held && url === '/api/store/novel/' + id && init.method === 'GET') { held = true; const r = await realFetch(BASE + url, init); entered.release(); await finish.wait; return r; } };
    const opening = store.open('novel', id, { fresh: true }); await entered.wait;
    try { await restored(id, 'restored copy', true); } finally { finish.release(); }
    assert.equal((await opening).value, 'restored copy');
    assert.equal(store.peek('novel', id).value, 'restored copy');
  });
  await test('concurrent first reads reject an older library reply after the newer reply arrives', async () => {
    const id = await book(), entered = gate(), finish = gate(); let held = false;
    const freshStore = await import(path.join(ROOT, 'js/store.js') + '?startup-reads');
    intercept = async (url, init) => { if (!held && url === '/api/store/novel/' + id && init.method === 'GET') { held = true; const r = await realFetch(BASE + url, init); entered.release(); await finish.wait; return r; } };
    const opening = freshStore.open('novel', id); await entered.wait;
    try {
      await restored(id);
      await freshStore.open('novel', 'n-missing-after-restore');
    } finally { finish.release(); }
    assert.equal((await opening).value, 'restored copy');
    freshStore.change('novel', id, (d) => { d.added = 'fresh change'; }, { now: true });
    await freshStore.flush();
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'restored copy');
  });
  await test('journal startup cannot rewind a library number learned while its version reply travels', async () => {
    const id = await book(), before = (await ask('GET', '/api/store/novel/' + id)).data;
    const freshStore = await import(path.join(ROOT, 'js/store.js') + '?startup-journal');
    const { Journal } = freshStore.forTests();
    Journal.all = async () => [{ k: 'closed|' + id, tab: 'closed-tab', kind: 'novel', id, base: before.rev,
      baseJson: JSON.stringify(before.data), json: JSON.stringify({ ...before.data, value: 'old journal words' }), gen: before.generation, at: 1 }];
    Journal.del = async () => {};
    const entered = gate(), finish = gate(); let held = false;
    intercept = async (url, init) => { if (!held && url === '/api/version') { held = true; const r = await realFetch(BASE + url, init); entered.release(); await finish.wait; return r; } };
    const replaying = freshStore.replayJournal(); await entered.wait;
    try {
      await restored(id); await freshStore.open('novel', id);
      freshStore.change('novel', id, (d) => { d.value = 'fresh words during recovery'; }, { delay: 60000 });
    } finally { finish.release(); }
    await replaying; await freshStore.flush();
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'fresh words during recovery');
  });
  await test('an old save acknowledgement cannot consume a new edit made after restoration', async () => {
    const id = await book(), entered = gate(), finish = gate(); let held = false;
    intercept = async (url, init) => { if (!held && url === '/api/store/novel/' + id && init.method === 'PUT') { held = true; const r = await realFetch(BASE + url, init); entered.release(); await finish.wait; return r; } };
    store.change('novel', id, (d) => { d.value = 'old sent words'; }, { now: true }); await entered.wait;
    try {
      await restored(id, 'restored copy', true); await store.open('novel', id);
      store.change('novel', id, (d) => { d.value = 'new edit after restore'; }, { delay: 60000 });
    } finally { finish.release(); }
    await store.flush();
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'new edit after restore');
  });
  await test('a damaged copy with duplicate record names is refused before changing the library', async () => {
    const id = await book();
    const snap = { format: 'cozynovel-library', records: [{ kind: 'novel', id, data: { value: 'first' } }, { kind: 'novel', id, data: { value: 'second' } }] };
    assert.equal((await ask('POST', '/api/restore', snap)).status, 400);
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'before restore');
  });
  await test('a delayed restore notification cannot discard words typed after the restored book was opened', async () => {
    const id = await book(), gen = await restored(id, 'restored copy', true);
    await store.open('novel', id);
    store.change('novel', id, (d) => { d.value = 'new words after restore'; }, { delay: 60000 });
    store.forTests().news(JSON.stringify({ reload: true, generation: gen }));
    await store.flush();
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'new words after restore');
  });
  await test('an older greeting cannot count the library backwards or discard new words', async () => {
    const id = await book(), gen = await restored(id, 'restored copy', true);
    await store.open('novel', id);
    store.change('novel', id, (d) => { d.value = 'words after new greeting'; }, { delay: 60000 });
    store.forTests().news(JSON.stringify({ hello: { commit: '', generation: gen - 1 } }));
    await store.flush();
    assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'words after new greeting');
  });
  await test('journal recovery travelling during a restore cannot replay old work over its new library', async () => {
    const id = await book(), before = (await ask('GET', '/api/store/novel/' + id)).data;
    const { Journal } = store.forTests(), oldAll = Journal.all, oldDel = Journal.del;
    Journal.all = async () => [{ k: 'closed|' + id, tab: 'closed-tab', kind: 'novel', id, base: before.rev,
      baseJson: JSON.stringify(before.data), json: JSON.stringify({ ...before.data, value: 'old recovered words' }), gen: before.generation, at: 1 }];
    Journal.del = async () => {};
    const entered = gate(), finish = gate(); let held = false;
    intercept = async (url, init) => { if (!held && url === '/api/store/novel/' + id && init.method === 'GET') { held = true; const r = await realFetch(BASE + url, init); entered.release(); await finish.wait; return r; } };
    try {
      const recovering = store.replayJournal(); await entered.wait;
      try { await restored(id, 'restored copy', true); } finally { finish.release(); }
      await recovering;
      assert.equal((await ask('GET', '/api/store/novel/' + id)).data.data.value, 'restored copy');
    } finally { Journal.all = oldAll; Journal.del = oldDel; }
  });
  await test('adding books from a whole copy carries every unsent draft with its scene names remapped', async () => {
    const { booksFromLibrary } = await import(path.join(ROOT, 'js/novel/files.js'));
    const records = [
      { kind: 'novel', id: 'n-old', data: { id: 'n-old', meta: { title: 'Kept words' }, order: ['ch-old'], plays: ['pl-old'] } },
      { kind: 'chapter', id: 'ch-old', data: { id: 'ch-old', novelId: 'n-old', passages: [] } },
      { kind: 'play', id: 'pl-old', data: { id: 'pl-old', novelId: 'n-old', chapterId: 'ch-old', turns: [] } },
      { kind: 'draft', id: 'n-old', data: { id: 'n-old', novelId: 'n-old', direction: 'A quiet ending.', partner: 'Keep the teacup.', play: { 'pl-old': 'I hug him.' }, cards: { 'people:card1': { name: 'Mara', about: 'A careful friend.' } },
        composers: { 'talk:n-old:conv-one': { value: '  Keep her promise.  ' }, 'play:pl-old': { value: 'I hug him.', tell: 'Let the room go quiet.', tellOpen: true } } } },
    ];
    const [b] = booksFromLibrary({ records });
    assert.ok(b.draft);
    assert.equal(b.draft.id, b.novel.id); assert.equal(b.draft.novelId, b.novel.id);
    assert.equal(b.draft.direction, 'A quiet ending.'); assert.equal(b.draft.partner, 'Keep the teacup.');
    assert.deepEqual(b.draft.play, { [b.plays[0].id]: 'I hug him.' });
    assert.deepEqual(b.draft.cards, records[3].data.cards);
    assert.deepEqual(b.draft.composers, { [`talk:${b.novel.id}:conv-one`]: { value: '  Keep her promise.  ' }, [`play:${b.plays[0].id}`]: { value: 'I hug him.', tell: 'Let the room go quiet.', tellOpen: true } });
  });
} finally {
  intercept = null; store?.quiet(); server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve)); rmSync(home, { recursive: true, force: true });
  console.log(`\nstorage integrity: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
