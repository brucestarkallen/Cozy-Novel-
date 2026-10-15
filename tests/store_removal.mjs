/* Local store removal against the real server, with deterministic transport
 * gates. Temporary books only; no model calls. Run: node tests/store_removal.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_REMOVAL_PORT || 19561);
const BASE = `http://127.0.0.1:${PORT}`;
const home = mkdtempSync(path.join(os.tmpdir(), 'cozynovel-removal-'));
const server = spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' });
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gate = () => { let release; const wait = new Promise((r) => { release = r; }); return { wait, release }; };
let intercept = null, store, serial = 0, passed = 0, failed = 0;
const trace = [];
globalThis.fetch = async (url, init = {}) => {
  const hit = intercept && await intercept(String(url), init);
  const res = hit || await realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  trace.push({ method: init.method || 'GET', url: String(url), status: res.status });
  return res;
};
async function until(check, message) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await sleep(20); }
  throw new Error(message);
}
async function read(kind, id) { return (await (await realFetch(`${BASE}/api/store/${kind}/${id}`)).json()).data; }
async function family() {
  const id = 'n-removal-' + (++serial);
  const children = [['chapter', 'ch-removal-' + serial, { novelId: id }], ['talk', id, {}], ['play', 'pl-removal-' + serial, { novelId: id }], ['draft', id, {}], ['talk', 'talk-extra-' + serial, { novelId: id }]];
  await store.create('novel', id, { id, meta: { title: 'Temporary book' }, order: [children[0][1]], plays: [children[2][1]], value: 'saved' });
  for (const [kind, rid, fields] of children) await store.create(kind, rid, { id: rid, ...fields, value: 'saved', ...(kind === 'chapter' ? { passages: [] } : {}) });
  const all = [['novel', id], ...children.map(([kind, rid]) => [kind, rid])];
  return { id, children, all };
}
async function restore(id) {
  const trash = (await (await realFetch(BASE + '/api/trash')).json()).trash.find((t) => t.kind === 'novel' && t.id === id);
  assert.ok(trash, 'the whole book waits in Recently deleted');
  const res = await realFetch(`${BASE}/api/trash/${trash.name}/restore`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 200);
}
async function test(name, fn) {
  intercept = null; trace.length = 0;
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + (e.stack || e)); }
  finally { intercept = null; }
}

try {
  await until(async () => { try { return (await realFetch(BASE + '/api/version')).ok; } catch (_) { return false; } }, 'The temporary server did not start');
  store = await import(path.join(ROOT, 'js/store.js'));

  await test('removing a book saves and freezes every owned child before the cascade, then restores their edits', async () => {
    const b = await family(), entered = gate(), finish = gate();
    const deletedEvents = [];
    const off = store.subscribe(b.children[0][0], b.children[0][1], (_data, why) => { if (why === 'deleted') deletedEvents.push(why); });
    for (const [kind, id] of b.all) store.change(kind, id, (d) => { d.value = 'pending words'; }, { delay: 60000 });
    intercept = async (url, init) => {
      if (url === `/api/store/novel/${b.id}` && init.method === 'DELETE') {
        entered.release(); await finish.wait;
        const res = await realFetch(BASE + url, init);
        for (const [kind, id] of b.all) store.forTests().news(JSON.stringify({ kind, id, deleted: true, by: store.CLIENT }));
        assert.deepEqual(deletedEvents, [], 'own cascade news does not navigate before the local removal finishes');
        return res;
      }
    };
    const removing = store.remove('novel', b.id); await entered.wait;
    try {
      for (const [kind, id] of b.all) {
        assert.equal((await read(kind, id)).value, 'pending words', `${kind} is saved before deletion`);
        assert.equal(store.change(kind, id, (d) => { d.value = 'late worker result'; return true; }, { now: true }), undefined);
      }
    } finally { finish.release(); }
    await removing; await store.flush();
    const deletedAt = trace.findIndex((r) => r.method === 'DELETE');
    assert.ok(deletedAt >= 0);
    assert.ok(!trace.slice(deletedAt + 1).some((r) => r.method === 'PUT'), 'no owned save is sent after deletion');
    assert.ok(!trace.some((r) => r.status === 410));
    for (const [kind, id] of b.all) { assert.equal(await read(kind, id), null); assert.equal(store.peek(kind, id), undefined); }
    await restore(b.id);
    for (const [kind, id] of b.all) {
      assert.equal((await store.open(kind, id)).value, 'pending words');
      store.change(kind, id, (d) => { d.value = 'edited after restore'; });
    }
    await store.flush();
    for (const [kind, id] of b.all) assert.equal((await read(kind, id)).value, 'edited after restore');
    off();
  });

  await test('a child save already travelling finishes before the novel DELETE is sent', async () => {
    const b = await family(), entered = gate(), finish = gate();
    const [kind, id] = b.children[0];
    let deleteStarted = false;
    intercept = async (url, init) => {
      if (url === `/api/store/${kind}/${id}` && init.method === 'PUT') { entered.release(); await finish.wait; }
      if (url === `/api/store/novel/${b.id}` && init.method === 'DELETE') deleteStarted = true;
    };
    store.change(kind, id, (d) => { d.value = 'save in flight'; }, { now: true }); await entered.wait;
    const removing = store.remove('novel', b.id);
    try { await realFetch(BASE + '/api/version'); assert.equal(deleteStarted, false, 'the cascade waits for the child'); }
    finally { finish.release(); }
    await removing;
    const put = trace.findLastIndex((r) => r.url === `/api/store/${kind}/${id}` && r.method === 'PUT');
    const del = trace.findIndex((r) => r.url === `/api/store/novel/${b.id}` && r.method === 'DELETE');
    assert.ok(put >= 0 && del > put); assert.equal(trace[put].status, 200);
    await restore(b.id); assert.equal((await read(kind, id)).value, 'save in flight');
  });

  await test('a failed deletion preserves all pending words and releases every record for editing', async () => {
    const b = await family();
    for (const [kind, id] of b.all) store.change(kind, id, (d) => { d.value = 'words before failed deletion'; }, { delay: 60000 });
    intercept = async (url, init) => url === `/api/store/novel/${b.id}` && init.method === 'DELETE' ? new Response('{"error":"simulated failure"}', { status: 503 }) : null;
    await assert.rejects(store.remove('novel', b.id), /could not delete/);
    for (const [kind, id] of b.all) {
      assert.equal((await read(kind, id)).value, 'words before failed deletion');
      assert.equal(store.peek(kind, id).value, 'words before failed deletion');
      assert.equal(store.change(kind, id, (d) => { d.value = 'continued editing'; return true; }), true);
    }
    intercept = null; await store.flush();
    for (const [kind, id] of b.all) assert.equal((await read(kind, id)).value, 'continued editing');
  });

  await test('cascade ownership matches the server and leaves unrelated records editable', async () => {
    const b = await family(), other = await family(), entered = gate(), finish = gate();
    intercept = async (url, init) => { if (url === `/api/store/novel/${b.id}` && init.method === 'DELETE') { entered.release(); await finish.wait; } };
    const removing = store.remove('novel', b.id); await entered.wait;
    try {
      for (const [kind, id] of other.all) assert.equal(store.change(kind, id, (d) => { d.value = 'another book stays editable'; return true; }), true);
    } finally { finish.release(); }
    await removing; await store.flush();
    for (const [kind, id] of other.all) assert.equal((await read(kind, id)).value, 'another book stays editable');
  });

  await test('own deletion news closes a child opened outside the removal snapshot', async () => {
    const b = await family();
    const [kind, id] = b.children[0];
    const events = [];
    const off = store.subscribe(kind, id, (_data, why) => events.push(why));
    const removed = await store.api('DELETE', `/api/store/novel/${b.id}`); assert.equal(removed.status, 200);
    store.forTests().news(JSON.stringify({ kind, id, deleted: true, by: store.CLIENT }));
    assert.ok(events.includes('deleted'));
    assert.equal(store.change(kind, id, (d) => { d.value = 'late result'; return true; }), undefined);
    await store.flush(); assert.ok(!trace.some((r) => r.status === 410));
    off();
  });

  await test('watched records catch up after restoration while the news connection was away', async () => {
    const b = await family();
    const offs = b.all.map(([kind, id]) => store.subscribe(kind, id, () => {}));
    await store.remove('novel', b.id);
    await restore(b.id); // no restore events delivered: reconnect must discover it
    store.forTests().news(JSON.stringify({ resync: true }));
    await until(() => b.all.every(([kind, id]) => store.peek(kind, id)?.value === 'saved'), 'watched deleted records did not discover the restored book');
    for (const [kind, id] of b.all) store.change(kind, id, (d) => { d.value = 'editing after missed restore'; });
    await store.flush();
    for (const [kind, id] of b.all) assert.equal((await read(kind, id)).value, 'editing after missed restore');
    for (const off of offs) off();
  });
} catch (e) { failed++; console.error(e.stack || e); }
finally { if (store) store.quiet(); server.kill(); rmSync(home, { recursive: true, force: true }); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
