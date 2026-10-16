/* Real helper/store requests against a local scripted provider. Synthetic
 * books only; isolated ports, temporary storage, and no paid calls.
 * Run: node tests/archivist_reliability.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_RELIABILITY_PORT || 19650);
const PROV = Number(process.env.COZY_RELIABILITY_PROVIDER || 19652);
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = `http://127.0.0.1:${PROV}`;
const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = mkdtempSync(path.join(os.tmpdir(), 'cozynovel-reliability-'));
const kids = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
let failures = 0;
let passed = 0;
let store, shape, archivist, readings, util;
const books = [];
async function until(check, message) {
  for (let i = 0; i < 250; i++) { if (await check()) return; await sleep(20); }
  throw new Error(message);
}
async function ready(url) { await until(async () => { try { return (await realFetch(url)).status < 500; } catch (_) { return false; } }, 'Nothing answered at ' + url); }
async function reset(queue = []) {
  await realFetch(PROVIDER + '/reset');
  await realFetch(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) });
}
async function requests() { return (await (await realFetch(PROVIDER + '/requests')).json()).requests; }
/* since 2.11.3 a new summary is held once against its words in the same run (the summary check): what a test asks
 * about a summary is counted without those checks */
const isCheckAsk = (x) => x.body.messages.some((m) => String(m.content || '').includes('Its summary, as it stands'));
async function notChecks() { return (await requests()).filter((x) => !isCheckAsk(x)); }
async function phone(kind, id) { return (await (await realFetch(`${BASE}/api/store/${kind}/${id}`)).json()).data; }
function quiet() { for (const t of archivist.forTests().timers.values()) clearTimeout(t); archivist.forTests().timers.clear(); }
async function test(name, fn) {
  try { quiet(); await reset(); await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failures++; console.error('FAIL ' + name + '\n' + (e.stack || e)); }
  finally { quiet(); for (const b of books.splice(0)) { await store.flush(); await store.remove('novel', b.novelId); } }
}
const CONN = { id: 'test', name: 'Local only', url: PROVIDER + '/v1', model: 'scripted', key: 'test-key' };
async function house(extra = {}) {
  const value = { connections: [{ ...CONN, ...extra }], roles: { writer: 'test' }, instructions: { system: '', late: '', partner: '' }, you: {}, look: {} };
  if (!store.peek('house', 'house')) await store.create('house', 'house', value);
  else store.change('house', 'house', (h) => { for (const k of Object.keys(h)) delete h[k]; Object.assign(h, value); });
  await store.flush('house', 'house');
}
async function book(text = 'The keeper watches the quiet water.') {
  const { novel, chapter } = shape.newNovel({ title: 'Temporary reliability book' });
  novel.auto = { about: false, style: false };
  chapter.passages.push(shape.newPassage('you', text, { at: Date.now() - 3600000 }));
  await store.create('chapter', chapter.id, chapter);
  await store.create('novel', novel.id, novel);
  const b = { novelId: novel.id, chapterId: chapter.id, n: () => store.peek('novel', novel.id), c: () => store.peek('chapter', chapter.id) };
  books.push(b); seen(b); return b;
}
function seen(b) {
  store.change('novel', b.novelId, shape.novelSteps.seen(b.chapterId, Object.fromEntries(b.c().passages.map((p) => [p.id, archivist.signature(shape.picked(p))]))));
}
function setSummary(b, summary) { store.change('chapter', b.chapterId, shape.chapterSteps.setSummary(summary)); }
function edit(b, text) {
  const v = shape.newVersion({ text, at: Date.now() - 3600000 });
  store.change('chapter', b.chapterId, shape.chapterSteps.addVersion(b.c().passages[0].id, v)); seen(b);
  return v;
}
const reply = (summary, extra = {}) => ({ text: JSON.stringify({ summary }), ...extra });
async function started(n = 1) { await until(async () => (await requests()).length >= n, 'The helper never started the expected request'); }
const source = 'Mara Venn tends the lamp at Crane Point while Corvin waits below with 40 men.';
const short = 'Mara Venn tends the lamp through a long storm until the morning.';
const whole = 'Mara Venn tends the lamp at Crane Point through a long storm while Corvin waits below with 40 men.';
async function longChange() {
  const old = 'Mara watched the lamp above the quiet water. '.repeat(450);
  const text = 'Mara reaches the harbor before dawn. '.repeat(450);
  const b = await book(old);
  const pid = b.c().passages[0].id;
  const oldSig = archivist.signature(shape.picked(b.c().passages[0]));
  const card = shape.newCard('people', { name: 'Mara', about: 'The keeper of the lamp.', now: 'At the lamp.', updated: { by: 'helper', at: 1 } });
  const mine = shape.newCard('people', { name: 'My own keeper note', about: 'My words stay exactly here.', updated: { by: 'you', at: 1 } });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', card));
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', mine));
  const before = structuredClone(b.n().notes);
  const v = shape.newVersion({ text });
  store.change('chapter', b.chapterId, shape.chapterSteps.addVersion(pid, v));
  return { ...b, pid, oldSig, sig: archivist.signature(v), old, text, before };
}

try {
  await Promise.all([ready(BASE + '/api/version'), ready(PROVIDER + '/requests')]);
  globalThis.fetch = (url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
  [store, shape, archivist, readings, util] = await Promise.all(['js/store.js', 'js/novel/shape.js', 'js/novel/archivist.js', 'js/novel/readings.js', 'js/util.js'].map((file) => import(path.join(ROOT, file))));
  await house();

  await test('an oversized paragraph is split without losing English or unspaced CJK words', async () => {
    for (const text of ['“The keeper’s lamp—still lit!” '.repeat(900), '海风吹过灯塔。'.repeat(700)]) {
      const parts = archivist.partsOf(text, 200);
      assert.ok(parts.length > 1);
      assert.equal(parts.join(''), text, 'all characters survive, including punctuation and spaces');
      assert.ok(parts.every((p) => util.countWords(p) <= 200));
    }
  });

  await test('a single long paragraph is summarised in bounded requests, carrying the summary forward', async () => {
    await house({ context: 12000 });
    const b = await book('The keeper watched the quiet water beside the lamp. '.repeat(900));
    await reset(Array.from({ length: 20 }, () => reply('The keeper watched the quiet water beside the lamp.')));
    await archivist.run(b.novelId);
    const calls = (await requests()).filter((r) => r.body.messages.at(-1).content.includes("for the book's notes"));
    assert.ok(calls.length > 1, 'a single paragraph still takes several bounded requests');
    for (const call of calls) assert.ok(util.estimateTokens(call.body.messages.map((m) => m.content).join('\n')) + (call.body.max_tokens || 0) < 12000);
    /* 2.11: a chapter longer than the writer reads beside the book is kept in stretches; this paragraph is one stretch, read in parts, each carrying the summary so far — and the chapter's summary is made from it */
    const last = (r) => r.body.messages.at(-1).content;
    const parts = calls.filter((r) => last(r).startsWith("Here's a stretch of"));
    assert.ok(parts.length > 1 && parts.slice(1).every((r) => last(r).includes("This stretch's parts before this one") && last(r).includes('The keeper watched the quiet water beside the lamp.')), 'the stretch in parts, the summary carried forward');
    const fenced = (r) => [...last(r).matchAll(/"{3}\n([\s\S]*?)\n"{3}/g)].map((m) => m[1]).at(-1);
    assert.equal(parts.map(fenced).join(' ').replace(/\s+/g, ' ').trim(), b.c().passages[0].versions[0].text.replace(/\s+/g, ' ').trim(), 'every word of the paragraph read');
    assert.ok(calls.some((r) => last(r).includes('Here is every stretch of it')), 'the chapter summed up from its stretch');
    assert.equal((await phone('chapter', b.chapterId)).summary.text, 'The keeper watched the quiet water beside the lamp.');
    await house();
  });

  await test('a delayed summary cannot overwrite a user summary for newly edited words', async () => {
    const b = await book();
    await reset([{ text: JSON.stringify({ summary: 'The old event.', name: 'Old Name' }), chunk: 10000, delay: 0.3 }]);
    const running = archivist.run(b.novelId); await started();
    edit(b, 'The keeper leaves the lamp and returns home.');
    const mine = { text: 'My current account of the keeper returning home.', fp: shape.chapterPrint(b.c()), at: Date.now(), by: 'you' };
    setSummary(b, mine);
    await running; await store.flush();
    assert.deepEqual((await phone('chapter', b.chapterId)).summary, mine);
    assert.equal(b.c().name, '', 'the old answer cannot name the changed chapter either');
  });

  await test('a summary step rebased over a remote edit preserves its user summary and name', async () => {
    const b = await book(); await store.flush();
    await reset([{ text: JSON.stringify({ summary: 'The old event.', name: 'Old Name' }), chunk: 10000, delay: 0.3 }]);
    const running = archivist.run(b.novelId); await started();
    const remote = await (await realFetch(`${BASE}/api/store/chapter/${b.chapterId}`)).json();
    shape.picked(remote.data.passages[0]).text = 'The keeper has gone home.';
    remote.data.summary = { text: 'My remote correction.', fp: shape.chapterPrint(remote.data), at: Date.now(), by: 'you' };
    remote.data.name = 'My chapter name'; remote.data.nameBy = 'you';
    const changed = await realFetch(`${BASE}/api/store/chapter/${b.chapterId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base': String(remote.rev) }, body: JSON.stringify({ data: remote.data }) });
    assert.equal(changed.status, 200);
    await running; await store.flush();
    const saved = await phone('chapter', b.chapterId);
    assert.deepEqual(saved.summary, remote.data.summary); assert.equal(saved.name, 'My chapter name');
    assert.ok(!(saved.summaries || []).some((x) => x.text === 'The old event.'));
  });

  await test('a version changed during a summary is retried and only the current version is saved', async () => {
    const b = await book();
    await reset([reply('The old event.', { chunk: 10000, delay: 0.3 })]);
    const running = archivist.run(b.novelId); await started();
    edit(b, 'The keeper goes home.');
    await running;
    assert.equal(b.c().summary, null);
    assert.ok(archivist.forTests().timers.has(b.novelId), 'current words are scheduled to be summed up');
    quiet(); await reset([reply('The keeper goes home.')]); await archivist.run(b.novelId);
    assert.equal(b.c().summary.text, 'The keeper goes home.');
    assert.equal(b.c().summary.fp, shape.chapterPrint(b.c()));
  });

  await test('a chapter removed during a summary receives no summary or generated name', async () => {
    const b = await book();
    await reset([{ text: JSON.stringify({ summary: 'The old event.', name: 'Old Name' }), chunk: 10000, delay: 0.3 }]);
    const running = archivist.run(b.novelId); await started();
    store.change('novel', b.novelId, (n) => { n.order = []; });
    await running;
    assert.equal(b.c().summary, null); assert.equal(b.c().name, '');
  });

  await test('starting a whole-book reread rejects a summary from the previous reading', async () => {
    const b = await book();
    await reset([reply('The old event.', { chunk: 10000, delay: 0.3 })]);
    const running = archivist.run(b.novelId); await started();
    archivist.readAgain(b.novelId);
    await running;
    assert.equal(b.c().summary, null);
    assert.ok(archivist.forTests().timers.has(b.novelId));
  });

  await test('empty chapters lose generated summaries but preserve cached versions and user summaries', async () => {
    const b = await book();
    const old = { text: 'The keeper watches the water.', fp: shape.chapterPrint(b.c()), at: Date.now() };
    setSummary(b, old); store.change('chapter', b.chapterId, shape.chapterSteps.keepSummary(old));
    store.change('chapter', b.chapterId, (c) => { c.passages = []; }); seen(b);
    await archivist.run(b.novelId); await store.flush();
    assert.equal((await phone('chapter', b.chapterId)).summary, null);
    assert.deepEqual(b.c().summaries, [old]);
    const mine = { ...old, text: 'My chapter outline.', by: 'you' }; setSummary(b, mine);
    await archivist.run(b.novelId); assert.deepEqual(b.c().summary, mine);
    assert.equal((await requests()).length, 0);
  });

  await test('a delayed name-and-figure repair cannot replace a newer summary', async () => {
    const b = await book(source);
    const fp = shape.chapterPrint(b.c());
    setSummary(b, { text: short, fp, at: Date.now(), again: true });
    await reset([reply(whole, { chunk: 10000, delay: 0.3 })]);
    const running = archivist.run(b.novelId); await started();
    const newer = { text: 'A newer complete account of the storm and everyone present.', fp, at: Date.now() };
    setSummary(b, newer); await running;
    /* the newer stands — and what the check after it marked is the newer's own words */
    const { checked, ...kept } = b.c().summary;
    assert.deepEqual(kept, newer);
    assert.ok(!checked || checked.sig === (await import('../js/novel/summarycheck.js')).checkSig(newer.text));
  });

  await test('a repaired summary is cached and follows its version back without a model call', async () => {
    const b = await book(source);
    const fp = shape.chapterPrint(b.c());
    const version = shape.picked(b.c().passages[0]).id;
    const pending = { text: short, fp, at: Date.now(), again: true };
    setSummary(b, pending); store.change('chapter', b.chapterId, shape.chapterSteps.keepSummary(pending));
    await reset([reply(whole)]); await archivist.run(b.novelId);
    assert.equal(b.c().summaries.find((x) => x.fp === fp).text, whole);
    assert.equal(b.c().summaries.find((x) => x.fp === fp).again, undefined);
    edit(b, 'The keeper returns home.'); setSummary(b, { text: 'The keeper returns home.', fp: shape.chapterPrint(b.c()), at: Date.now() });
    store.change('chapter', b.chapterId, shape.chapterSteps.pick(b.c().passages[0].id, version)); seen(b);
    await reset(); await archivist.run(b.novelId);
    assert.equal(b.c().summary.text, whole); assert.equal((await requests()).length, 0);
  });

  await test('restoring a cached summary with unfinished name-and-figure work retries that work', async () => {
    const b = await book(source);
    const fp = shape.chapterPrint(b.c());
    store.change('chapter', b.chapterId, shape.chapterSteps.keepSummary({ text: short, fp, at: Date.now(), again: true }));
    await reset([reply(whole)]); await archivist.run(b.novelId);
    assert.equal(b.c().summary.text, whole); assert.equal(b.c().summary.again, undefined);
    assert.equal((await notChecks()).length, 1);
    assert.ok((await notChecks())[0].body.messages.at(-1).content.includes('nowhere in the summary'));
  });

  await test('numeric and truncated nested summaries are rejected and asked again', async () => {
    for (const bad of [{ text: '{"summary": 42}' }, { text: '{"draft":{"summary":"Unfinished draft."},"summary":"cut', finish: 'length' }, { text: '', think: '{"draft":{"summary":"Unfinished draft."},"summary":"cut', finish: 'length' }]) {
      const b = await book();
      await reset([bad, reply('The keeper watches the quiet water.')]); await archivist.run(b.novelId);
      assert.equal(b.c().summary.text, 'The keeper watches the quiet water.');
      assert.equal((await notChecks()).length, 2);
    }
  });

  await test('losing a helper lease during its failure probe never sets a summary aside', async () => {
    const b = await book();
    const invalid = { text: 'This is not a JSON answer.' };
    await reset([invalid, invalid, { text: '{"ok":true}' }]); await archivist.run(b.novelId); quiet();
    await reset([invalid, invalid, { text: '{"ok":true}', probe: true, chunk: 10000, delay: 0.3 }]);
    const running = archivist.run(b.novelId); await started(3);
    store.letLeasesGo(); await running;
    assert.equal(b.n().memory.aside?.['summary:' + b.chapterId], undefined);
    assert.ok(archivist.lightOf(b.novelId).text?.includes('another') || archivist.lightOf(b.novelId).state === 'waiting');
  });

  await test('changing the helper while it reads stops subsequent calls and keeps the completed reading', async () => {
    for (const change of ['nobody', 'model', 'same-settings']) {
      await house();
      const b = await book(); store.change('novel', b.novelId, shape.novelSteps.seen(b.chapterId, {}));
      await reset([{ text: '{"people":[]}', chunk: 10000, delay: 0.3 }]);
      const running = archivist.run(b.novelId); await started();
      store.change('house', 'house', (h) => {
        if (change === 'nobody') h.roles = {};
        else if (change === 'model') h.connections[0].model = 'another-model';
        else { h.connections.push({ ...h.connections[0], id: 'different-connection' }); h.roles.helper = 'different-connection'; }
      });
      await running;
      assert.equal((await requests()).length, 1, 'no summary is sent using the old connection');
      assert.equal(b.n().memory.seen[b.chapterId][b.c().passages[0].id], archivist.signature(shape.picked(b.c().passages[0])));
      assert.equal(b.c().summary, null);
      assert.equal(archivist.forTests().failures.has(b.novelId), false, 'changing a connection is not a provider failure');
      quiet();
    }
    await house();
  });

  await test('changing the model during an invalid answer prevents its JSON retry', async () => {
    const b = await book();
    await reset([{ text: 'Invalid answer.', chunk: 10000, delay: 0.3 }]);
    const running = archivist.run(b.novelId); await started();
    store.change('house', 'house', (h) => { h.connections[0].model = 'another-model'; });
    await running;
    assert.equal((await requests()).length, 1);
    assert.equal(archivist.forTests().failures.has(b.novelId), false);
    assert.ok(archivist.forTests().timers.has(b.novelId), 'work resumes with the newly chosen connection');
    await house();
  });

  await test('a very long old version and replacement are read whole in bounded parts with one Undo', async () => {
    await house({ context: 12000 });
    const b = await longChange();
    const update = { text: JSON.stringify({ people: [{ name: 'Mara', now: 'At the harbor.' }] }) };
    await reset(Array.from({ length: 30 }, () => update)); await archivist.run(b.novelId);
    const calls = await requests();
    const messages = calls.map((r) => r.body.messages.at(-1).content);
    const oldParts = messages.map((m) => m.match(/previous version[\s\S]*?:\n"""\n([\s\S]*?)\n"""/)?.[1]).filter(Boolean);
    const newParts = messages.map((m) => m.match(/New in Chapter[^\n]*:\n"""\n([\s\S]*?)\n"""/)?.[1]?.replace(/\n\n\(part \d+ of \d+\)$/, '')).filter(Boolean);
    const words = (s) => s.replace(/\s+/g, ' ').trim();
    assert.ok(oldParts.length > 1 && newParts.length > 1);
    assert.equal(words(oldParts.join(' ')), words(b.old), 'every old word is accounted for');
    assert.equal(words(newParts.join(' ')), words(b.text), 'every replacement word is accounted for');
    for (const call of calls) assert.ok(util.estimateTokens(call.body.messages.map((m) => m.content).join('\n')) + (call.body.max_tokens || 0) < 12000);
    assert.ok(messages.slice(0, oldParts.length).every((m) => m.includes('previous version')));
    assert.equal(b.n().memory.seen[b.chapterId][b.pid], b.sig);
    const reading = readings.readingOf(b.n(), b.pid, b.sig);
    assert.equal(reading.mode, 'change'); assert.equal(reading.fromSig, b.oldSig);
    assert.equal(b.n().notes.people.find((c) => c.name === 'Mara').now, 'At the harbor.');
    assert.equal(b.n().memory.inParts, null);
    assert.equal(archivist.undoLast(b.novelId), true);
    assert.deepEqual(b.n().notes, b.before, 'one Undo restores every provisional change and preserves his card');
    await house();
  });

  await test('an unreadable middle part rolls back the whole replacement and stays visibly set aside', async () => {
    await house({ context: 12000 });
    const b = await longChange();
    const update = { text: JSON.stringify({ people: [{ name: 'Mara', now: 'Between readings.' }] }) };
    const invalid = { text: 'This is not JSON.' };
    for (let round = 0; round < 2; round++) {
      quiet(); await reset([update, invalid, invalid]); await archivist.run(b.novelId);
      assert.deepEqual(b.n().notes, b.before, 'earlier removal parts never remain as half-built notes');
      assert.equal(b.n().memory.inParts, null);
      /* the reading's own requests: summing up the chapter's stretch (2.11) is a job of its own, after the reading */
      const all = await requests();
      const stretchAt = all.findIndex((r) => r.body.messages.some((m) => typeof m.content === 'string' && m.content.startsWith("Here's a stretch of")));
      const reading = stretchAt < 0 ? all : all.slice(0, stretchAt);
      assert.equal(reading.length, 4, 'later parts are not sent after this refusal');
    }
    assert.ok(b.n().memory.aside[b.pid], 'the whole passage remains visibly unread');
    assert.equal(readings.readingOf(b.n(), b.pid, b.sig), null, 'no completed reading is invented');
    await house();
  });

  await test('selecting Nobody midway through a long replacement rolls its provisional notes back', async () => {
    await house({ context: 12000 });
    const b = await longChange();
    await reset([{ text: JSON.stringify({ people: [{ name: 'Mara', now: 'Between readings.' }] }), chunk: 10000, delay: 0.3 }]);
    const running = archivist.run(b.novelId); await started();
    store.change('house', 'house', (h) => { h.roles = {}; });
    await running;
    assert.equal((await requests()).length, 1);
    assert.deepEqual(b.n().notes, b.before);
    assert.equal(b.n().memory.inParts, null);
    assert.equal(b.n().memory.seen[b.chapterId][b.pid], b.oldSig);
    await house();
  });

  await test('a scene before the first passage receives earlier notes and preserves a user card', async () => {
    const b = await book('The keeper departs.');
    const p = b.c().passages[0], v = shape.picked(p), sig = archivist.signature(v);
    const before = { id: 'keeper', name: 'Keeper', now: 'At the lamp.' };
    const after = { ...before, now: 'At home.' };
    const mine = { id: 'mine', name: 'My keeper note', about: 'These are my own words.', updated: { by: 'you' } };
    const n = { ...b.n(), notes: { people: [after, mine] }, memory: { seen: { [b.chapterId]: { [p.id]: sig } }, readings: { [p.id]: { [v.id]: { sig, mode: 'new', at: 1, cards: [{ kind: 'people', id: before.id, before, after }], covers: [p.id] } } } } };
    const atStart = readings.notesAtPoint(n, { [b.chapterId]: b.c() }, b.chapterId, { through: '^' });
    assert.equal(atStart.clean, true); assert.equal(atStart.later, true);
    assert.deepEqual(atStart.notes.people, [before, mine]);
    assert.deepEqual(n.notes.people, [after, mine], 'the stored notes are untouched');
  });

  await test('an empty chapter-start boundary excludes unread and set-aside future passages', async () => {
    const b = await book();
    const p = b.c().passages[0], sig = archivist.signature(shape.picked(p));
    const n = { ...b.n(), order: ['empty', b.chapterId], memory: { aside: { [p.id]: { sig } } } };
    for (const chapters of [{ empty: { passages: [] }, [b.chapterId]: b.c() }, { [b.chapterId]: b.c() }]) {
      assert.deepEqual(readings.unread(n, chapters, { chapterId: 'empty', before: '^' }), []);
      assert.deepEqual(readings.asideRows(n, chapters, { chapterId: 'empty', before: '^' }), []);
    }
  });
} catch (e) { failures++; console.error(e.stack || e); }
finally {
  if (archivist) quiet();
  if (store) store.letLeasesGo();
  for (const k of kids) k.kill();
  rmSync(home, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
