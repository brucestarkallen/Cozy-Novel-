/* Notes integrity through real helper/store requests. Temporary books and a
 * local scripted provider only; no paid calls. Run: node tests/notes_integrity.mjs */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_NOTES_PORT || 20550);
const PROV = Number(process.env.COZY_NOTES_PROVIDER || 20552);
const BASE = `http://127.0.0.1:${PORT}`, PROVIDER = `http://127.0.0.1:${PROV}`;
const notesHome = mkdtempSync(path.join(os.tmpdir(), 'cozy-notes-integrity-'));
const realFetch = globalThis.fetch;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const children = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: notesHome, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
let store, shape, helper, passed = 0, failed = 0;
const books = [];
const conn = { id: 'notes-local', url: PROVIDER + '/v1', model: 'scripted', key: 'test-only', context: 200000 };
async function until(check, message) {
  for (let i = 0; i < 250; i++) { if (await check()) return; await sleep(20); }
  throw new Error(message);
}
async function ready(url) { await until(async () => { try { return (await realFetch(url)).ok; } catch (_) { return false; } }, 'The local server did not start'); }
async function script(queue) {
  await realFetch(PROVIDER + '/reset');
  await realFetch(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) });
}
async function requests() { return (await (await realFetch(PROVIDER + '/requests')).json()).requests; }
function quiet() { for (const timer of helper.forTests().timers.values()) clearTimeout(timer); helper.forTests().timers.clear(); }
async function book(texts = ['Mara waits at the gate.']) {
  const { novel, chapter } = shape.newNovel({ title: 'Temporary notes book' });
  novel.auto = { about: false, style: false };
  for (const text of texts) chapter.passages.push(shape.newPassage('you', text));
  chapter.summary = { text: 'Mara waits.', fp: shape.chapterPrint(chapter), at: Date.now() };
  novel.memory.seen[chapter.id] = Object.fromEntries(chapter.passages.map(p => [p.id, helper.signature(shape.picked(p))]));
  novel.notes.people.push(shape.newCard('people', { name: 'Mara', about: 'The keeper.', now: 'At the gate.' }));
  await store.create('chapter', chapter.id, chapter);
  await store.create('novel', novel.id, novel);
  const b = { id: novel.id, cid: chapter.id, n: () => store.peek('novel', novel.id), c: () => store.peek('chapter', chapter.id) };
  books.push(b); return b;
}
async function test(name, work) {
  quiet();
  try { await work(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + (e.stack || e)); }
  finally { quiet(); await store.flush(); for (const b of books.splice(0)) await store.remove('novel', b.id); }
}
try {
  await Promise.all([ready(BASE + '/api/version'), ready(PROVIDER + '/requests')]);
  globalThis.fetch = (url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  [store, shape, helper] = await Promise.all(['store.js', 'novel/shape.js', 'novel/archivist.js'].map(file => import(path.join(ROOT, 'js', file))));
  await store.create('house', 'house', { connections: [conn], roles: { writer: conn.id }, instructions: { system: '', narrator: '', partner: '' }, you: {} });

  for (const malformed of [{ people: { name: 'Mara', now: 'At home.' } }, { people: [null] }, { gone: 'Mara' }]) {
    await test('a malformed notes list is repaired rather than silently accepted: ' + JSON.stringify(malformed), async () => {
      const repaired = { people: [{ name: 'Mara', now: 'At home.' }] };
      await script([{ text: JSON.stringify(malformed) }, { text: JSON.stringify(repaired) }]);
      const out = await helper.askJson(conn, 'Keep the book straight.', 'Update the notes.', { want: helper.notesShape });
      assert.equal(out.ok, true); assert.deepEqual(out.obj, repaired);
      assert.equal((await requests()).length, 2);
    });
  }
  await test('an empty audit verdict is repaired before the notes are declared checked', async () => {
    await script([{ text: '{"verdict":""}' }, { text: '{"clear":true,"verdict":"The notes hold."}' }]);
    const out = await helper.askJson(conn, 'Check the notes.', 'Check every card against the book.', { want: helper.auditShape });
    assert.equal(out.obj.clear, true); assert.equal((await requests()).length, 2);
  });

  for (const mutation of ['new passage', 'reordered passages', 'new chapter', 'changed notes', 'changed premise']) {
    await test('a delayed notes audit is rejected after ' + mutation, async () => {
      const b = await book(['Mara waits at the gate.', 'Mara returns home.']);
      store.change('novel', b.id, shape.novelSteps.setMemory({ auditAsked: true }));
      await script([{ text: '{"people":[{"name":"Mara","now":"At the gate."}],"clear":true,"verdict":"Old verdict."}', pause: 0.4 }]);
      const running = helper.run(b.id);
      await until(async () => (await requests()).length > 0, 'The audit did not start');
      if (mutation === 'new passage') store.change('chapter', b.cid, shape.chapterSteps.addPassage(shape.newPassage('you', 'Mara sails away.')));
      if (mutation === 'reordered passages') store.change('chapter', b.cid, c => { c.passages.reverse(); });
      if (mutation === 'new chapter') {
        const c = shape.newChapter(b.id); c.passages.push(shape.newPassage('you', 'Mara sails away.'));
        await store.create('chapter', c.id, c); store.change('novel', b.id, shape.novelSteps.addChapter(c.id));
      }
      if (mutation === 'changed notes') store.change('novel', b.id, n => { n.notes.people[0].about = 'My corrected account.'; });
      if (mutation === 'changed premise') store.change('novel', b.id, shape.novelSteps.setField('brief', 'Mara has already sailed away.'));
      await running;
      assert.notEqual(b.n().memory.audit?.verdict, 'Old verdict.', 'an old answer is not a current verdict');
      assert.equal(b.n().memory.auditAsked, true, 'a fresh check remains due');
    });
  }
  await test('a missing chapter blocks destructive notes work and remains visibly unfinished', async () => {
    const b = await book();
    const before = structuredClone(b.n().notes);
    store.change('novel', b.id, n => { n.order.push('ch-not-on-the-phone'); n.memory.auditAsked = true; });
    await script([{ text: '{"gone":[{"kind":"people","name":"Mara"}],"clear":true,"verdict":"Removed."}' }]);
    await helper.run(b.id);
    assert.deepEqual(b.n().notes, before);
    assert.equal((await requests()).length, 0, 'never ask a provider to judge a book missing a chapter');
    assert.equal(helper.pendingWork(b.id), true);
    assert.match(helper.lightOf(b.id).words, /chapter.*could not be read/);
  });

  await test('two rows in one answer can enrich the same newly made card', () => {
    const asked = { people: [], places: [], lore: [], threads: [] };
    const out = helper.foldNotes(asked, { people: [
      { name: 'Mara', about: 'The keeper.' },
      { name: 'Mara', about: 'The keeper, a patient gardener who tends the lamps.', now: 'At the harbor.' },
    ] }, { asked });
    assert.equal(out.notes.people.length, 1);
    assert.equal(out.notes.people[0].about, 'The keeper, a patient gardener who tends the lamps.');
    assert.equal(out.notes.people[0].now, 'At the harbor.');
  });
  await test('a duplicate row keeps the fuller account and first current location', () => {
    const asked = { people: [{ id: 'm', name: 'Mara', aka: ['Keeper'], about: 'The keeper.', now: 'At the gate.' }] };
    const out = helper.foldNotes(asked, { people: [
      { name: 'Mara', about: 'The keeper, a patient gardener.', now: 'At the harbor.' },
      { name: 'Keeper', about: 'The keeper, a patient gardener who tends the lamps through winter.', now: 'On the moon.' },
    ] }, { asked });
    assert.equal(out.notes.people[0].about, 'The keeper, a patient gardener who tends the lamps through winter.');
    assert.equal(out.notes.people[0].now, 'At the harbor.');
  });
  await test('an alias removed while the helper answers stays removed', () => {
    const asked = { people: [{ id: 'm', name: 'Mara', aka: ['Wrong name'], about: 'The keeper.' }] };
    const current = structuredClone(asked); current.people[0].aka = [];
    current.people[0].updated = { by: 'you', his: ['aka'], at: 2 };
    const out = helper.foldNotes(current, { people: [{ name: 'Mara', aka: ['Wrong name'], now: 'At home.' }] }, { asked });
    assert.deepEqual(out.notes.people[0].aka, []);
    assert.equal(out.notes.people[0].now, 'At home.');
  });
  await test('a stale removal cannot delete a card changed since the request', () => {
    const asked = { lore: [{ id: 'l', name: 'The key', about: 'A lost key.' }] };
    const current = structuredClone(asked); current.lore[0].about = 'The recovered key is now on the desk.';
    const out = helper.foldNotes(current, { gone: [{ kind: 'lore', name: 'The key' }] }, { asked });
    assert.deepEqual(out.notes.lore, current.lore);
    assert.ok(out.refused.some(r => /changed/.test(r.why)));
  });
  await test('partner card edits preserve unrelated remote fields when the server rebases the save', async () => {
    const b = await book(); await store.flush();
    const remote = await (await realFetch(`${BASE}/api/store/novel/${b.id}`)).json();
    remote.data.notes.people[0].now = 'At the harbor.';
    remote.data.notes.people[0].ties = 'Reconciled with Tom.';
    assert.equal((await realFetch(`${BASE}/api/store/novel/${b.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base': String(remote.rev) }, body: JSON.stringify({ data: remote.data }) })).status, 200);
    const changes = await import('../js/novel/changes.js');
    assert.equal(changes.makeChange(b.id, { note: 'people', name: 'Mara', about: 'My partner’s requested correction.' }).status, 'made');
    await store.flush();
    const saved = (await (await realFetch(`${BASE}/api/store/novel/${b.id}`)).json()).data.notes.people[0];
    assert.equal(saved.about, 'My partner’s requested correction.');
    assert.equal(saved.now, 'At the harbor.'); assert.equal(saved.ties, 'Reconciled with Tom.');
  });
  await test('a whole-book reread exposes only complete automatic texts and current manual corrections', async () => {
    const b = await book(); const prompts = await import('../js/novel/prompts.js');
    store.change('novel', b.id, n => { n.kept.about = { text: 'The complete old account.' }; });
    helper.readAgain(b.id); quiet();
    store.change('novel', b.id, n => { n.kept.about = { text: 'A partial new account.' }; });
    assert.equal(prompts.standingNotes(b.n()).kept.about.text, 'The complete old account.');
    store.change('novel', b.id, n => { n.kept.about = { text: 'My explicit new correction.', by: 'you' }; });
    assert.equal(prompts.standingNotes(b.n()).kept.about.text, 'My explicit new correction.');
  });
  await test('manual card corrections and removals reach the writer during a whole-book reread', async () => {
    const b = await book(); const prompts = await import('../js/novel/prompts.js');
    const card = structuredClone(b.n().notes.people[0]);
    card.updated = { by: 'you', his: ['about'], at: 1 };
    store.change('novel', b.id, shape.novelSteps.putNote('people', card));
    helper.readAgain(b.id); quiet();
    const edited = { ...card, about: 'My current correction.', updated: { at: 2 } };
    store.change('novel', b.id, shape.novelSteps.editNote('people', edited, ['about']));
    assert.equal(prompts.standingNotes(b.n()).notes.people[0].about, edited.about);
    assert.equal(helper.undoLast(b.id), true);
    assert.equal(b.n().notes.people[0].about, edited.about, 'Undo of a reread keeps later manual corrections');
    helper.readAgain(b.id); quiet();
    store.change('novel', b.id, shape.novelSteps.dropNote('people', card.id));
    assert.deepEqual(prompts.standingNotes(b.n()).notes.people, []);
  });
} catch (e) { failed++; console.error(e.stack || e); }
finally {
  if (helper) quiet(); if (store) store.quiet();
  globalThis.fetch = realFetch;
  for (const child of children) child.kill();
  rmSync(notesHome, { recursive: true, force: true });
}
console.log(`\nnotes integrity: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
