/* Checker answers and choices at asynchronous boundaries. Real server,
 * temporary books and a scripted local provider; no paid model calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_TEST_PORT) || 20250;
const PROV = Number(process.env.COZY_TEST_PROVIDER_PORT) || 20252;
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = `http://127.0.0.1:${PROV}`;
const home = mkdtempSync(path.join(os.tmpdir(), 'cozy-checker-edges-'));
const children = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
const fetchLocal = globalThis.fetch;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetchLocal(url)).ok) return; } catch (_) { /* starting */ }
    await sleep(50);
  }
  throw new Error(`No test server at ${url}`);
}
let failed = 0, passed = 0;
let store, checker, archivist;
function quiet() {
  for (const module of [checker, archivist]) if (module) {
    for (const timer of module.forTests().timers.values()) clearTimeout(timer && timer.t !== undefined ? timer.t : timer);
    module.forTests().timers.clear();
  }
}
try {
  await Promise.all([ready(`${BASE}/api/version`), ready(`${PROVIDER}/requests`)]);
  globalThis.fetch = (url, init) => fetchLocal(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  store = await import('../js/store.js');
  checker = await import('../js/novel/checker.js');
  archivist = await import('../js/novel/archivist.js');
  const writer = await import('../js/novel/writer.js');
  const shape = await import('../js/novel/shape.js');
  const { JUDGE_CHECKS } = await import('../js/novel/prompts.js');
  const yes = () => Object.fromEntries(JUDGE_CHECKS.map(([key]) => [key, 'yes']));
  const conn = { id: 'edge-checker', name: 'Local checker', url: `${PROVIDER}/v1`, model: 'scripted', key: 'test-key' };
  async function house(extra = {}) {
    const data = { connections: [conn], roles: { writer: conn.id }, checksFrom: 0, instructions: { system: 'Keep my point of view and tense.', late: '' }, ...extra };
    if (await store.open('house', 'house')) store.change('house', 'house', h => { for (const key of Object.keys(h)) delete h[key]; Object.assign(h, data); });
    else await store.create('house', 'house', data);
    await store.flush('house', 'house');
  }
  async function book(texts) {
    const { novel, chapter } = shape.newNovel({ title: 'The Checker at the Boundary', brief: 'Mara tends the light.' });
    novel.order = [];
    const chapters = [];
    for (const [i, text] of texts.entries()) {
      const c = i === 0 ? chapter : shape.newChapter(novel.id);
      c.passages.push(shape.newPassage('ai', text, { how: 'write', ask: { direction: '', length: 'scene' } }));
      novel.order.push(c.id); chapters.push(c.id);
      await store.create('chapter', c.id, c);
    }
    await store.create('novel', novel.id, novel);
    return { id: novel.id, chapters };
  }
  const script = async queue => fetchLocal(`${PROVIDER}/script`, { method: 'POST', body: JSON.stringify({ queue }) });
  const requests = async () => (await (await fetchLocal(`${PROVIDER}/requests`)).json()).requests;
  const grade = checks => ({ passage: '1.1', checks, faults: [] });
  async function test(name, fn) {
    quiet();
    await fetchLocal(`${PROVIDER}/reset`);
    try { await fn(); passed++; console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error); }
    quiet();
  }

  await test('a partial grade is repaired once instead of becoming ten passes', async () => {
    await house();
    const b = await book(['Mara trimmed the wick and put the scissors away.']);
    await script([
      { text: JSON.stringify({ edits: [], grades: [grade({ opening: 'yes' })] }) },
      { text: JSON.stringify({ grades: [grade(yes())] }) },
    ]);
    await checker.runCheck(b.id);
    assert.equal((await requests()).length, 2, 'the missing checks must actually be asked');
    assert.deepEqual(checker.gradesOf(b.id).rows.map(row => row.overall), [10]);
  });

  await test('unknown yes/no answers never become passes or an endless grading loop', async () => {
    await house();
    const b = await book(['Mara trimmed the the wick and put the scissors away.']);
    const incomplete = grade({ ...yes(), ending: 'perhaps' });
    await script([
      { text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }], grades: [incomplete] }) },
      { text: JSON.stringify({ grades: [incomplete] }) },
    ]);
    await checker.runCheck(b.id);
    await checker.runCheck(b.id);
    assert.equal(checker.gradesOf(b.id).rows.length, 0);
    assert.equal((await requests()).length, 2, 'one bounded attempt to repair the grade');
    assert.equal(checker.suggestions(b.id).filter(row => row.item.kind === 'grammar').length, 1, 'the valid correction stays');
  });

  await test('an incomplete part cannot give an entire long passage a perfect grade', async () => {
    await house();
    const paragraph = Array.from({ length: 170 }, (_, i) => `Mara set lamp ${i + 1} beside the western window.`).join(' ');
    const b = await book([`${paragraph}\n\n${paragraph.replaceAll('Mara', 'Tomas')}`]);
    await script([
      { text: JSON.stringify({ edits: [], grades: [grade(yes())] }) },
      { text: JSON.stringify({ edits: [], grades: [grade({ opening: 'yes' })] }) },
    ]);
    await checker.runCheck(b.id);
    assert.equal((await requests()).length, 2, 'the two passage parts are checked once each');
    assert.equal(checker.gradesOf(b.id).rows.length, 0, 'unanswered checks in either part are not passes');
  });

  await test('switching the checker off while it reads stops subsequent chapters', async () => {
    await house({ judge: { on: false } });
    const b = await book(['Mara trimmed the wick.', 'Tomas opened the shutters.']);
    await script([{ pause: .35, text: JSON.stringify({ edits: [] }) }]);
    const running = checker.runCheck(b.id);
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1, 'the first chapter is in flight');
    store.change('house', 'house', h => { h.roles.checker = 'off'; });
    await running;
    assert.equal((await requests()).length, 1, 'no chapter is sent after Nobody is chosen');
    assert.equal(checker.stateOf(b.id).state, 'off');
    assert.equal(store.peek('chapter', b.chapters[1]).checks?.[store.peek('chapter', b.chapters[1]).passages[0].id], undefined);
  });

  await test('switching the checker off between parts never marks the unread remainder checked', async () => {
    await house({ judge: { on: false } });
    const paragraph = 'Mara set another lamp beside the western window. '.repeat(180);
    const b = await book([`${paragraph}\n\n${paragraph.replaceAll('Mara', 'Tomas')}`]);
    await script([{ pause: .35, text: JSON.stringify({ edits: [] }) }]);
    const running = checker.runCheck(b.id);
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1);
    store.change('house', 'house', h => { h.roles.checker = 'off'; });
    await running;
    assert.equal((await requests()).length, 1);
    const c = store.peek('chapter', b.chapters[0]);
    assert.equal(checker.entryFor(c, c.passages[0]), null);
  });

  await test('editing the selected connection in place stops the old batch before the next chapter', async () => {
    await house({ judge: { on: false } });
    const b = await book(['Mara trimmed the wick.', 'Tomas opened the shutters.']);
    await script([{ pause: .35, text: JSON.stringify({ edits: [] }) }]);
    const running = checker.runCheck(b.id);
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1);
    store.change('house', 'house', h => { h.connections[0].model = 'new-checker'; h.connections[0].key = 'new-test-key'; });
    await running;
    assert.equal((await requests()).length, 1, 'the captured connection does not silently become the newly edited one');
    await checker.runCheck(b.id);
    assert.equal((await requests()).length, 2);
    assert.equal((await requests())[1].body.model, 'new-checker', 'the remaining chapter follows the new choice');
  });

  await test('switching the checker off also stops its internal JSON repair request', async () => {
    await house({ judge: { on: false } });
    const b = await book(['Mara trimmed the wick.']);
    await script([{ pause: .35, text: 'This is not the requested JSON answer.' }]);
    const running = checker.runCheck(b.id);
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1);
    store.change('house', 'house', h => { h.roles.checker = 'off'; });
    await running;
    assert.equal((await requests()).length, 1, 'the repair is another request and must respect Nobody too');
    const c = store.peek('chapter', b.chapters[0]);
    assert.equal(checker.entryFor(c, c.passages[0]), null);
  });

  await test('turning the judge off between duel readings stops the second and leaves the pair eligible', async () => {
    await house({ duelsFrom: 0 });
    const b = await book(['Mara trimmed the wick.']);
    store.change('chapter', b.chapters[0], c => {
      const p = c.passages[0];
      p.versions[0].model = 'writer-one';
      p.versions.push(shape.newVersion({ text: 'Mara trimmed the wick with the small scissors.', how: 'another', model: 'writer-two', ask: { direction: '', length: 'scene' } }));
      c.checks = { [p.id]: Object.fromEntries(p.versions.map(v => [v.id, { sig: checker.sigOf(v), items: [], grade: { overall: 10, of: 10, faults: [] } }])) };
    });
    await script([{ pause: .35, text: JSON.stringify({ better: 'A', why: 'The action is clear.' }) }]);
    const running = checker.runCheck(b.id);
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1);
    store.change('house', 'house', h => { h.judge = { on: false }; });
    await running;
    assert.equal((await requests()).length, 1, 'the opposite-order reading is not sent after the judge is turned off');
    assert.deepEqual(store.peek('chapter', b.chapters[0]).duels || {}, {});
    store.change('house', 'house', h => { h.judge = { on: true }; });
    assert.equal(checker.duelsDue(b.id).length, 1, 'an interrupted duel can be judged when enabled again');
  });

  await test('an unrecognized duel verdict is repaired instead of recorded as a tie', async () => {
    await house({ duelsFrom: 0 });
    const b = await book(['Mara trimmed the wick.']);
    store.change('chapter', b.chapters[0], c => {
      const p = c.passages[0];
      p.versions[0].model = 'writer-one';
      p.versions.push(shape.newVersion({ text: 'Mara trimmed the wick with the small scissors.', how: 'another', model: 'writer-two', ask: { direction: '', length: 'scene' } }));
      c.checks = { [p.id]: Object.fromEntries(p.versions.map(v => [v.id, { sig: checker.sigOf(v), items: [], grade: { overall: 10, of: 10, faults: [] } }])) };
    });
    await script([
      { text: JSON.stringify({ better: 'undecided nonsense', why: 'No usable decision.' }) },
      { text: JSON.stringify({ better: 'Page A', why: 'The action is clear.' }) },
      { text: JSON.stringify({ better: 'B', why: 'The action is clear.' }) },
    ]);
    await checker.runCheck(b.id);
    assert.equal((await requests()).length, 3, 'one repair, then the reversed comparison');
    const rows = Object.values(store.peek('chapter', b.chapters[0]).duels || {});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].winner, 'x', 'both valid readings choose the same version');
  });
  for (const kind of ['lift', 'span']) await test(`turning automatic ${kind} off while its reply is in flight keeps the original words`, async () => {
    const setting = kind === 'lift' ? 'autoLift' : 'autoFix';
    await house({ [setting]: { on: true, from: 0 } });
    const original = 'Mara trimmed the wick. Tomas opened the shutters.';
    const b = await book([original]);
    const chapterId = b.chapters[0];
    const p = store.peek('chapter', chapterId).passages[0];
    const source = shape.picked(p);
    await script([{ pause: .35, text: 'Mara shielded the flame.' }]);
    const running = kind === 'lift'
      ? writer.rewrite({ novelId: b.id, chapterId, passageId: p.id, note: 'Keep the action precise.', lift: 1 })
      : writer.rewriteSelection({ novelId: b.id, chapterId, passageId: p.id, start: 0, end: 'Mara trimmed the wick.'.length, note: 'Keep the action precise.', auto: true });
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1, 'the request is running before its switch changes');
    store.change('house', 'house', h => { h[setting].on = false; });
    const result = await running;
    const after = store.peek('chapter', chapterId).passages[0];
    assert.equal(shape.picked(after).id, source.id, 'an unwanted automatic result does not replace the selected version');
    assert.equal(shape.picked(after).text, original);
    assert.equal(after.versions.length, 1, 'the stopped automatic attempt is removed whole');
    assert.equal(result.stopped, true);
    assert.equal((await requests()).length, 1);
  });

  await test('stopping an automatic lift preserves a different version chosen during its request', async () => {
    await house({ autoLift: { on: true, from: 0 } });
    const b = await book(['Mara trimmed the wick.']);
    const chapterId = b.chapters[0];
    const p = store.peek('chapter', chapterId).passages[0];
    const source = shape.picked(p);
    const chosen = shape.newVersion({ text: 'Mara closed the lantern door.', how: 'edit' });
    store.change('chapter', chapterId, shape.chapterSteps.addVersion(p.id, chosen));
    store.change('chapter', chapterId, shape.chapterSteps.pick(p.id, source.id));
    await script([{ pause: .35, text: 'Mara shielded the flame.' }]);
    const running = writer.rewrite({ novelId: b.id, chapterId, passageId: p.id, note: 'Keep the action precise.', lift: 1 });
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1);
    store.change('chapter', chapterId, shape.chapterSteps.choose(p.id, chosen.id));
    writer.stop(b.id);
    await running;
    const after = store.peek('chapter', chapterId).passages[0];
    assert.equal(shape.picked(after).id, chosen.id, 'Stop must not undo the explicit version choice');
    assert.equal(shape.picked(after).text, chosen.text);
    assert.equal(after.versions.length, 2, 'only the automatic attempt is removed');
  });

  for (const kind of ['lift', 'span']) await test(`a finishing automatic ${kind} leaves a manually selected version on show`, async () => {
    await house({ [kind === 'lift' ? 'autoLift' : 'autoFix']: { on: true, from: 0 } });
    const b = await book(['Mara trimmed the wick.']);
    const chapterId = b.chapters[0];
    const p = store.peek('chapter', chapterId).passages[0];
    const source = shape.picked(p);
    const chosen = shape.newVersion({ text: 'Mara closed the lantern door.', how: 'edit' });
    store.change('chapter', chapterId, shape.chapterSteps.addVersion(p.id, chosen));
    store.change('chapter', chapterId, shape.chapterSteps.pick(p.id, source.id));
    await script([{ pause: .35, text: 'Mara shielded the flame.' }]);
    const running = kind === 'lift'
      ? writer.rewrite({ novelId: b.id, chapterId, passageId: p.id, note: 'Keep the action precise.', lift: 1 })
      : writer.rewriteSelection({ novelId: b.id, chapterId, passageId: p.id, start: 0, end: source.text.length, note: 'Keep the action precise.', auto: true });
    for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(10);
    assert.equal((await requests()).length, 1);
    store.change('chapter', chapterId, shape.chapterSteps.choose(p.id, chosen.id));
    await running;
    const after = store.peek('chapter', chapterId).passages[0];
    assert.equal(shape.picked(after).id, chosen.id);
    assert.equal(shape.picked(after).text, chosen.text);
    assert(after.versions.every(v => !v.streaming), 'no attempt is left marked as running');
  });
} catch (error) {
  failed++; console.error(error);
} finally {
  quiet();
  if (store) await store.flush().catch(() => {});
  globalThis.fetch = fetchLocal;
  for (const child of children) child.kill();
  rmSync(home, { recursive: true, force: true });
}
console.log(`\nchecker edges: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
