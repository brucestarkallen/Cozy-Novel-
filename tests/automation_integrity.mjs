/* Automatic work across failures and simultaneous starts. Real modules,
 * temporary books and a local scripted provider; no paid calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSig } from '../js/novel/summarycheck.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_AUTOMATION_PORT || 22150);
const PROV = Number(process.env.COZY_AUTOMATION_PROVIDER || 22152);
const BASE = `http://127.0.0.1:${PORT}`, PROVIDER = `http://127.0.0.1:${PROV}`;
const dataHome = mkdtempSync(path.join(os.tmpdir(), 'cozy-automation-integrity-'));
const realFetch = globalThis.fetch;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: dataHome, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
let store, shape, helper, checker, writer, passed = 0, failed = 0;
const books = [];
const conn = { id: 'automation-local', name: 'Local only', url: PROVIDER + '/v1', model: 'scripted', key: 'test-only', context: 200000 };
async function until(check, message) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await sleep(20); }
  throw new Error(message);
}
async function ready(url) { await until(async () => { try { return (await realFetch(url)).ok; } catch (_) { return false; } }, 'The local server did not start'); }
async function script(queue) {
  await realFetch(PROVIDER + '/reset');
  await realFetch(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) });
}
async function requests() { return (await (await realFetch(PROVIDER + '/requests')).json()).requests; }
function quiet() {
  for (const mod of [helper, checker].filter(Boolean)) {
    for (const timer of mod.forTests().timers.values()) clearTimeout(timer && timer.t !== undefined ? timer.t : timer);
    mod.forTests().timers.clear();
  }
}
async function house(extra = {}) {
  const value = { connections: [conn], roles: { writer: conn.id }, instructions: { system: '', late: '', narrator: '', partner: '' }, checksFrom: 0, you: {}, ...extra };
  if (!store.peek('house', 'house')) await store.create('house', 'house', value);
  else store.change('house', 'house', h => { for (const key of Object.keys(h)) delete h[key]; Object.assign(h, value); });
  await store.flush('house', 'house');
}
async function book(text = 'Mara tucked the blanket around the sleeping dragon.') {
  const { novel, chapter } = shape.newNovel({ title: 'Temporary automatic work book' });
  novel.auto = { about: false, style: false };
  chapter.passages.push(shape.newPassage('ai', text, { how: 'write', ask: { direction: 'A quiet moment of kindness.', length: 'scene' } }));
  /* a summary that has had its check (2.11.3): a test of readings counts readings, never the summary's one check */
  chapter.summary = { text: 'Mara tends the sleeping dragon.', fp: shape.chapterPrint(chapter), at: Date.now(), checked: { sig: checkSig('Mara tends the sleeping dragon.'), at: Date.now() } };
  novel.memory.seen[chapter.id] = Object.fromEntries(chapter.passages.map(p => [p.id, helper.signature(shape.picked(p))]));
  await store.create('chapter', chapter.id, chapter);
  await store.create('novel', novel.id, novel);
  const b = { id: novel.id, cid: chapter.id, n: () => store.peek('novel', novel.id), c: () => store.peek('chapter', chapter.id) };
  books.push(b); return b;
}
async function test(name, fn) {
  quiet();
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + (e.stack || e)); }
  finally { quiet(); await store.flush(); for (const b of books.splice(0)) await store.remove('novel', b.id); }
}
function prepareAutomatic(b, kind) {
  const p = b.c().passages[0], v = shape.picked(p);
  const grade = { overall: 8, of: 10, lift: 'Let the small kindness speak through the action.', faults: [{ check: 'precision', quote: v.text }] };
  const item = kind === 'lift'
    ? { id: 'grade', kind: 'grade', find: '', replace: null, lift: grade.lift, grade }
    : { id: 'avoid', kind: 'avoid', find: v.text, replace: null, phrase: 'tucked', phrases: ['tucked'] };
  store.change('chapter', b.cid, shape.chapterSteps.setCheck(p.id, v.id, { sig: checker.sigOf(v), items: [item], ...(kind === 'lift' ? { grade } : {}) }));
  return v;
}

try {
  await Promise.all([ready(BASE + '/api/version'), ready(PROVIDER + '/requests')]);
  globalThis.fetch = (url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  [store, shape, helper, checker, writer] = await Promise.all(['store.js', 'novel/shape.js', 'novel/archivist.js', 'novel/checker.js', 'novel/writer.js'].map(file => import(path.join(ROOT, 'js', file))));

  for (const locks of [true, false]) await test(`simultaneous helper starts read a passage once ${locks ? 'with' : 'without'} browser locks`, async () => {
    await house();
    const b = await book();
    store.change('novel', b.id, n => { n.memory.seen = {}; });
    await script([{ pause: .25, text: '{"people":[{"name":"Mara","about":"A patient keeper."}]}' }]);
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    if (!locks) Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    try { await Promise.all([helper.run(b.id), helper.run(b.id), helper.run(b.id)]); }
    finally { if (!locks) { if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else delete navigator.locks; } }
    assert.equal((await requests()).length, 1, 'one reading owns the helper even while its lease is being obtained');
    assert.equal(b.n().notes.people.filter(card => card.name === 'Mara').length, 1);
    assert.equal(helper.pendingWork(b.id), false);
  });

  for (const kind of ['lift', 'span']) await test(`a temporary automatic ${kind} failure becomes eligible again after its retry delay`, async () => {
    await house({ [kind === 'lift' ? 'autoLift' : 'autoFix']: { on: true, from: 0 }, ...(kind === 'span' ? { judge: { on: false }, instructions: { system: '', late: '', avoid: 'tucked' } } : {}) });
    const b = await book();
    const source = prepareAutomatic(b, kind);
    await script([{ status: 503, message: 'Temporarily unavailable.', ...(kind === 'span' ? { retry_after: '240' } : {}) }]);
    checker.forTests().autoAfter(b.id);
    const job = checker.forTests().lifting.get(b.id);
    assert(job, 'the automatic attempt starts');
    const out = await job;
    assert.equal(out.passing, true, 'the simulated provider failure is temporary');
    assert.equal(b.c().passages[0].versions.length, 1, 'failed work never changes the story');
    assert.equal(shape.picked(b.c().passages[0]).id, source.id);
    assert(checker.forTests().timers.has(b.id), 'another automatic look is scheduled');
    assert.equal(checker.stalled(b.id), true, 'the retry has a Try again now action');
    assert.match(checker.stateOf(b.id).words, /automatic rewrite.*tries again/i, 'the wait is visible');
    checker.forTests().autoAfter(b.id);
    assert.equal(checker.forTests().lifting.has(b.id), false, 'ordinary nudges cannot bypass the retry delay');
    const due = checker.forTests().timers.get(b.id).due;
    if (kind === 'span') {
      assert.equal(out.retryAfterMs, 240000, 'the writer preserves the provider’s requested delay');
      assert(due >= Date.now() + 235000, 'automatic retries respect a longer provider delay');
    }
    quiet();
    await script([{ text: 'Mara drew the blanket over the sleeping dragon, leaving its warm nose free.' }]);
    const now = Date.now;
    Date.now = () => Math.max(now(), due + 1);
    try {
      checker.forTests().autoAfter(b.id);
      const retry = checker.forTests().lifting.get(b.id);
      assert(retry, 'the same version is retried after the provider recovers');
      assert.equal((await retry).ok, true);
    } finally { Date.now = now; }
    assert.equal((await requests()).length, 1, 'one fresh writing call succeeds');
    assert.match(shape.picked(b.c().passages[0]).text, /warm nose free/);
    assert.equal(b.c().passages[0].versions.length, 2, 'the original remains one version away');
  });

  const { JUDGE_CHECKS } = await import('../js/novel/prompts.js');
  for (const row of [
    { text: 'She left the tower before dawn.', quote: 'he left', verified: false },
    { text: 'Mara ranted at the broken latch.', quote: 'Mara ran', verified: false },
    { text: 'She left quietly. He left with the dog.', quote: 'he left', verified: true },
    { text: 'Mara, tired, closed the door.', quote: 'Mara tired closed', verified: true },
  ]) await test('a grading quote names whole words: ' + row.quote + ' / ' + row.text, async () => {
    await house();
    const b = await book(row.text);
    const checks = Object.fromEntries(JUDGE_CHECKS.map(([key]) => [key, key === 'opening' ? 'no' : 'yes']));
    await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks, faults: [{ check: 'opening', words: row.quote, why: 'The quoted wording is the claimed fault.' }] }] }) }]);
    await checker.runCheck(b.id);
    const grade = checker.entryFor(b.c(), b.c().passages[0]).grade;
    assert.equal(grade.overall, row.verified ? 9 : 10);
    assert.equal(Boolean(grade.faults[0].unverified), !row.verified);
  });

  await test('restarting the whole-book reread discards an older generated description', async () => {
    await house();
    const b = await book();
    store.change('novel', b.id, shape.novelSteps.setAuto('about', true));
    const old = 'Mara keeps the dragon company. Its home is the old tower.';
    await script([{ pause: .25, text: JSON.stringify({ about: old }) }]);
    const running = helper.run(b.id);
    await until(async () => (await requests()).length > 0, 'The description never started');
    helper.readAgain(b.id);
    await running;
    assert.notEqual(b.n().kept.about?.text, old, 'an answer from before the restart cannot populate the replacement notes');
    assert.equal(helper.pendingWork(b.id), true);
  });

  for (const stage of ['reading', 'whole description', 'audit']) await test('a remote manual description survives a save conflict during ' + stage, async () => {
    await house();
    const b = await book();
    const { hashText } = await import('../js/util.js');
    const offered = 'Mara is a patient keeper of the dragon. Her home stands beside the old tower.';
    store.change('novel', b.id, n => {
      n.auto.about = true;
      if (stage === 'reading') n.memory.seen = {};
      if (stage === 'audit') {
        n.kept.about = { text: 'Mara tends the dragon. They live together.', ownFp: hashText(n.brief.trim()), at: Date.now() };
        n.notes.people.push(shape.newCard('people', { name: 'Mara', about: 'The keeper.' }));
        n.memory.auditAsked = true;
      }
    });
    await store.flush();
    await script([{ pause: .25, text: JSON.stringify({ about: offered, ...(stage === 'audit' ? { clear: true, verdict: 'The notes hold.' } : {}) }) }]);
    const running = helper.run(b.id);
    await until(async () => (await requests()).length > 0, 'The helper never started');
    const remote = await (await realFetch(`${BASE}/api/store/novel/${b.id}`)).json();
    const mine = { text: 'My correction from the other window: the dragon is Mara’s guest.', by: 'you', at: Date.now() };
    remote.data.kept.about = mine;
    assert.equal((await realFetch(`${BASE}/api/store/novel/${b.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base': String(remote.rev) }, body: JSON.stringify({ data: remote.data }) })).status, 200);
    await running; await store.flush();
    const saved = (await (await realFetch(`${BASE}/api/store/novel/${b.id}`)).json()).data;
    assert.deepEqual(saved.kept.about, mine, 'a replayed helper step must preserve the remote manual correction');
    assert.deepEqual(b.n().kept.about, mine);
  });

  function preparePair(b) {
    store.change('chapter', b.cid, c => {
      const p = c.passages[0];
      p.versions[0].model = 'first-writer';
      p.versions.push(shape.newVersion({ text: 'Mara laid the blanket over the sleeping dragon.', how: 'another', model: 'second-writer', ask: { direction: 'A quiet moment of kindness.', length: 'scene' } }));
      c.checks = { [p.id]: Object.fromEntries(p.versions.map(v => [v.id, { sig: checker.sigOf(v), items: [], grade: { overall: 10, of: 10, faults: [] } }])) };
    });
    return b.c().passages[0];
  }
  for (const when of ['first', 'second', 'after']) await test('a head-to-head verdict follows the actual words changed ' + when, async () => {
    await house({ duelsFrom: 0 });
    const b = await book();
    const p = preparePair(b);
    await script([
      { ...(when === 'first' ? { pause: .25 } : {}), text: '{"better":"A","why":"The action is specific."}' },
      { ...(when === 'second' ? { pause: .25 } : {}), text: '{"better":"B","why":"The action is specific."}' },
    ]);
    const running = checker.runCheck(b.id);
    if (when === 'after') await running;
    else await until(async () => (await requests()).length >= (when === 'second' ? 2 : 1), 'The comparison never started');
    store.change('chapter', b.cid, shape.chapterSteps.setVersion(p.id, p.versions[1].id, { text: 'Mara left the dragon cold and alone.' }));
    await running;
    assert.equal(checker.gradesOf(b.id).duels, 0, 'changed words cannot retain the old verdict');
    assert.equal(checker.duelsDue(b.id).length, 1, 'the changed pair remains available for a fresh comparison');
  });
} catch (e) { failed++; console.error(e); }
finally {
  quiet();
  if (store) await store.flush().catch(() => {});
  globalThis.fetch = realFetch;
  for (const child of children) child.kill();
  rmSync(dataHome, { recursive: true, force: true });
}
console.log(`\nautomation integrity: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
