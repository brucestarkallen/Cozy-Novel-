/* Cozy Novel — tests/app.mjs
 *
 * The app's own modules (store, writer, helper, partner, scenes, context,
 * files, the model layer) run in node against the real serve.py and a stand-in
 * model that does what each test tells it. Every check runs the feature and
 * looks at what came back — the book on the phone, the request that went out.
 *
 *   node tests/app.mjs
 *
 * Synthetic books in a temporary folder; nothing paid is ever called.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18650;
const PROV = 18652;
const BASE = `http://127.0.0.1:${PORT}`;
const PROVIDER = `http://127.0.0.1:${PROV}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ the rig */

const home = mkdtempSync(path.join(os.tmpdir(), 'cozynovel-app-'));
const kids = [
  spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' }),
  spawn('python3', [path.join(ROOT, 'tests/scripted_provider.py'), String(PROV)], { stdio: 'ignore' }),
];
const realFetch = globalThis.fetch;
function done(code) {
  for (const k of kids) { try { k.kill(); } catch (_) { /* gone */ } }
  try { rmSync(home, { recursive: true, force: true }); } catch (_) { /* fine */ }
  process.exit(code);
}
async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try { const r = await realFetch(url); if (r.status < 500) return; } catch (_) { /* not yet */ }
    await sleep(100);
  }
  throw new Error('nothing answered at ' + url);
}
await waitFor(BASE + '/api/version');
await waitFor(PROVIDER + '/requests');
/* the page's own addresses go to the server */
globalThis.fetch = (url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);

const store = await import(path.join(ROOT, 'js/store.js'));
const shape = await import(path.join(ROOT, 'js/novel/shape.js'));
const writer = await import(path.join(ROOT, 'js/novel/writer.js'));
const archivist = await import(path.join(ROOT, 'js/novel/archivist.js'));
const talk = await import(path.join(ROOT, 'js/novel/talk.js'));
const context = await import(path.join(ROOT, 'js/novel/context.js'));
const files = await import(path.join(ROOT, 'js/novel/files.js'));
const jsonutil = await import(path.join(ROOT, 'js/novel/jsonutil.js'));
const prompts = await import(path.join(ROOT, 'js/novel/prompts.js'));
const providers = await import(path.join(ROOT, 'js/model/providers.js'));
const call = await import(path.join(ROOT, 'js/model/call.js'));
const { picked } = shape;

async function script(queue) { await realFetch(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) }); }
async function reset() { await realFetch(PROVIDER + '/reset'); }
async function requests() { return (await (await realFetch(PROVIDER + '/requests')).json()).requests; }
async function onPhone(kind, id) { return (await (await realFetch(`${BASE}/api/store/${kind}/${id}`)).json()).data; }

const CONN = { id: 'c-w', name: 'Scripted', url: PROVIDER + '/v1', model: 'scripted', key: 'test-key' };
async function setHouse(conn = {}, extra = {}) {
  const data = { connections: [{ ...CONN, ...conn }], roles: { writer: 'c-w' }, you: { name: 'Bruce' },
    instructions: { system: 'HIS OWN WORDS FIRST', late: '', partner: '' }, look: {}, created: Date.now(), ...extra };
  const h = await store.open('house', 'house');
  if (!h) await store.create('house', 'house', data);
  else { store.change('house', 'house', (x) => { for (const k of Object.keys(x)) delete x[k]; Object.assign(x, JSON.parse(JSON.stringify(data))); }, { now: true }); }
  await store.flush('house', 'house');
}

/* a book on the phone: chapters = [[passage, ...], ...]; a passage is a text,
 * '---' for a scene break, or {text, ...version fields} */
async function makeBook(chapters, { title = 'Test Book', brief = 'A lighthouse keeper finds a letter.' } = {}) {
  const { novel, chapter } = shape.newNovel({ title, brief });
  novel.order = [];
  const ids = [];
  for (let i = 0; i < chapters.length; i++) {
    const c = i === 0 ? chapter : shape.newChapter(novel.id);
    for (const p of chapters[i]) {
      if (p === '---') { c.passages.push(shape.newPassage('break')); continue; }
      const f = typeof p === 'string' ? { text: p } : p;
      const { text, ...rest } = f;
      c.passages.push(shape.newPassage('ai', text, { how: 'write', ask: { direction: '', length: 'scene' }, ...rest }));
    }
    novel.order.push(c.id);
    ids.push(c.id);
    await store.create('chapter', c.id, c);
  }
  await store.create('novel', novel.id, novel);
  return { novelId: novel.id, ids, ch: (i = 0) => store.peek('chapter', ids[i]), novel: () => store.peek('novel', novel.id) };
}
/* a book read by the helper as it stands */
function markAllSeen(b) {
  const n = b.novel();
  for (const id of n.order) {
    const c = store.peek('chapter', id);
    const map = {};
    for (const p of c.passages) if (p.by !== 'break') map[p.id] = archivist.signature(picked(p));
    store.change('novel', b.novelId, shape.novelSteps.seen(id, map));
  }
}
/* a book done with: its helper has nothing to come back for */
async function putAway(b) { try { await store.flush(); await store.remove('novel', b.novelId); } catch (_) { /* gone */ } }

/* ------------------------------------------------------------ checks */

let passed = 0;
let failed = 0;
let section = '';
async function test(name, fn) {
  try {
    await reset();
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String((e && e.stack) || e).split('\n').slice(0, 4).join('\n       ')}`);
  }
}
function heading(s) { section = s; console.log(s); }

await setHouse();

/* =================================================== writing a page */
heading('writing');

await test('Write sends his own words first, the book, and his request last — all above it as system', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'Mara struck a match.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She lights the lamp.' });
  assert.equal(out.ok, true);
  const body = (await requests())[0].body;
  const roles = body.messages.map((m) => m.role);
  assert.equal(roles[roles.length - 1], 'user');
  assert.ok(roles.slice(0, -1).every((r) => r === 'system'), roles.join(','));
  const sys = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sys.startsWith('HIS OWN WORDS FIRST'), sys.slice(0, 60));
  assert.ok(sys.includes('The lamp was cold.') && sys.includes('A lighthouse keeper finds a letter.'));
  assert.ok(body.messages.at(-1).content.includes('She lights the lamp.'));
  const c = await onPhone('chapter', b.ids[0]);
  assert.equal(picked(c.passages[1]).text, 'Mara struck a match.');
  assert.equal(picked(c.passages[1]).streaming, undefined);
  await putAway(b);
});

await test('what he left empty is not sent; what he set is sent exactly', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'One.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let body = (await requests())[0].body;
  for (const k of ['temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'repetition_penalty', 'reasoning_effort', 'thinking', 'max_tokens', 'max_completion_tokens']) assert.ok(!(k in body), `${k} was sent`);
  await setHouse({ temperature: 0.73, topP: 0.91, maxTokens: 1234 });
  await reset();
  await script([{ text: 'Two.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  body = (await requests())[0].body;
  assert.equal(body.temperature, 0.73);
  assert.equal(body.top_p, 0.91);
  assert.equal(body.max_tokens, 1234);
  await setHouse();
  await putAway(b);
});

await test('a reply cut by the provider\'s filter keeps its words and says so', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'Some words came.', finish: 'content_filter' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(out.ok, true);
  const v = picked(b.ch().passages[1]);
  assert.equal(v.text, 'Some words came.');
  assert.equal(v.cut, true);
  assert.match(v.cutWhy, /the provider stopped it/);
  await putAway(b);
});

await test('an empty answer leaves no empty passage and gives the provider\'s reason', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: '', finish: 'content_filter' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(out.ok, false);
  assert.match(out.error, /blocked the answer \(its reason: content_filter\)/);
  assert.equal((await onPhone('chapter', b.ids[0])).passages.length, 1);
  await putAway(b);
});

await test('a stream that just stops is kept and said to be possibly cut', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ abrupt: 'Words, then the line closed' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const v = picked(b.ch().passages[1]);
  assert.equal(v.text, 'Words, then the line closed');
  assert.equal(v.cut, true);
  assert.match(v.cutWhy, /ended without the provider saying it was finished/);
  await putAway(b);
});

await test('a break in the middle of the stream keeps what came, as cut', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ midstream_error: 'Half a page', message: 'overloaded' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(out.ok, true);
  const v = picked(b.ch().passages[1]);
  assert.equal(v.text, 'Half a page');
  assert.equal(v.cut, true);
  assert.match(v.cutWhy, /the provider broke off/);
  await putAway(b);
});

await test('Stop keeps what came; Go on joins the last word without doubling it', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ hang_after: 'Mara climbed the stairs and' }, { text: 'the stairs and opened the lantern room.' }]);
  const run = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await sleep(900);
  writer.stop(b.novelId);
  const out = await run;
  assert.equal(out.ok, true);
  const p = b.ch().passages[1];
  assert.equal(picked(p).text, 'Mara climbed the stairs and');
  assert.equal(picked(p).stopped, true);
  const on = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id });
  assert.equal(on.ok, true);
  const v = picked(b.ch().passages[1]);
  assert.equal(v.text, 'Mara climbed the stairs and opened the lantern room.');
  assert.equal(v.cut, undefined);
  const req = (await requests())[1].body.messages.at(-1).content;
  assert.ok(req.includes('Mara climbed the stairs and'), 'the request carries its last words');
  await putAway(b);
});

await test('Go on stopped before any words keeps the passage exactly, still cut', async () => {
  const b = await makeBook([[{ text: 'The lamp was cold. Mara lit it', cut: true, cutWhy: 'it reached the reply length' }]]);
  const p = b.ch().passages[0];
  await script([{ hang_after: '' }]);
  const run = writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id });
  await sleep(900);
  writer.stop(b.novelId);
  const out = await run;
  assert.equal(out.stopped, true);
  const v = picked((await onPhone('chapter', b.ids[0])).passages[0]);
  assert.equal(v.text, 'The lamp was cold. Mara lit it');
  assert.equal(v.cut, true);
  assert.equal(v.cutWhy, 'it reached the reply length');
  assert.equal(v.streaming, undefined);
  await putAway(b);
});

await test('a selection rewrite that stopped partway is never carried on from the passage end', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  const p = b.ch().passages[0];
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p.id, shape.newVersion({ text: 'The lamp was half', how: 'selection', cut: true, ask: { from: 9, to: 18 } })), { now: true });
  const out = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id });
  assert.equal(out.ok, false);
  assert.match(out.error, /can’t be carried on/);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was half');
  assert.equal((await requests()).length, 0);
  await putAway(b);
});

await test('only the selected words are rewritten, however the model answers', async () => {
  const full = 'The lamp was cold. Mara lit it with shaking hands. Outside, the sea kept on.';
  const s = full.indexOf('Mara lit');
  const e = full.indexOf(' Outside');
  const want = 'The lamp was cold. Mara struck a match. Outside, the sea kept on.';
  assert.equal(writer.spliceSelection(full, s, e, 'Mara struck a match.').text, want);
  assert.equal(writer.spliceSelection(full, s, e, 'The lamp was cold. ⟦Mara struck a match.⟧ Outside, the sea kept on.').text, want);
  assert.equal(writer.spliceSelection(full, s, e, 'The lamp was cold. Mara struck a match. Outside, the sea kept on.').text, want);
  assert.equal(writer.spliceSelection(full, s, e, '“Mara struck a match.”').text, want);
  const talkAnswer = '“Here,” Mara said, and struck a match.';
  assert.equal(writer.spliceSelection(full, s, e, talkAnswer).text, `The lamp was cold. ${talkAnswer} Outside, the sea kept on.`);
  /* and through the writer, against the phone */
  const b = await makeBook([[full]]);
  await script([{ text: 'The lamp was cold. ⟦Mara struck a match.⟧ Outside, the sea kept on.' }]);
  const out = await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id, start: s, end: e, note: 'quicker' });
  assert.equal(out.ok, true);
  const c = await onPhone('chapter', b.ids[0]);
  assert.equal(picked(c.passages[0]).text, want);
  assert.equal(c.passages[0].versions[0].text, full, 'the words before stay one arrow away');
  const req = (await requests())[0].body.messages.at(-1).content;
  assert.ok(req.includes('⟦Mara lit it with shaking hands.⟧') && req.includes('quicker'));
  await putAway(b);
});

await test('carrying on joins at word boundaries and keeps a paragraph the model began', () => {
  assert.equal('She climbed the stairs and' + writer.joinOn('She climbed the stairs and', 'the stairs and opened the door.'), 'She climbed the stairs and opened the door.');
  assert.equal('She climbed the sta' + writer.joinOn('She climbed the sta', 'climbed the stairs.'), 'She climbed the stairs.');
  assert.equal(writer.joinOn('The end of a paragraph.', '\nA new one.'), '\n\nA new one.');
  assert.equal(writer.joinOn('He said', ', quietly.'), ', quietly.');
  assert.equal(writer.joinOn('He said', 'nothing.'), ' nothing.');
  assert.equal(writer.joinOn('“Wait', '“Wait for me,” she called.'), ' for me,” she called.');
});

await test('a page left "being written" by a closed window is set right', async () => {
  const old = Date.now() - 5 * 60 * 1000;
  const b = await makeBook([['The lamp was cold.', { text: 'Half a page', streaming: true, beat: old, tab: 'gone', browser: 'another-browser' }, { text: '', streaming: true, beat: old, browser: 'another-browser' }]]);
  const fixed = await writer.repairStale(b.novelId);
  assert.equal(fixed, 2);
  await store.flush();
  const c = await onPhone('chapter', b.ids[0]);
  assert.equal(c.passages.length, 2, 'the one that never got a word goes');
  const v = picked(c.passages[1]);
  assert.equal(v.streaming, undefined);
  assert.equal(v.cut, true);
  assert.match(v.cutWhy, /window closed/);
  /* one still beating is left alone */
  const b2 = await makeBook([[{ text: 'Still coming', streaming: true, beat: Date.now(), browser: 'another-browser' }]]);
  assert.equal(await writer.repairStale(b2.novelId), 0);
  await putAway(b); await putAway(b2);
});

await test('writing from the middle: the request says between, and what follows rides too — trimmed when long', async () => {
  const after = Array.from({ length: 900 }, (_, i) => `Later line ${i}.`).join(' ');
  const b = await makeBook([['THE FIRST PASSAGE.', 'AFTER STARTS HERE. ' + after]]);
  const first = b.ch().passages[0];
  await setHouse({ context: 7000 });
  await script([{ text: 'In between.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], after: first.id });
  assert.equal(out.ok, true);
  const body = (await requests())[0].body;
  assert.match(body.messages.at(-1).content, /between the text before it and the text that follows it/);
  const sys = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sys.includes('THE FIRST PASSAGE.') && sys.includes('AFTER STARTS HERE.'), 'both sides of the point ride');
  assert.ok(sys.includes('left out here to save room'), 'what follows is trimmed to fit');
  assert.ok(JSON.stringify(body.messages).length / 4 < 7000, 'and it fits the room');
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text.slice(0, 12)), ['THE FIRST PA', 'In between.', 'AFTER STARTS']);
  await setHouse();
  await putAway(b);
});

await test('an edit is a new version; the words before stay one arrow away', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  const p = b.ch().passages[0];
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'The lamp was warm.' }), true);
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'The lamp was warm.' }), false, 'nothing changed: no version');
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: '   ' }), false, 'an emptied passage is not kept');
  await store.flush();
  const c = await onPhone('chapter', b.ids[0]);
  assert.deepEqual(c.passages[0].versions.map((v) => v.text), ['The lamp was cold.', 'The lamp was warm.']);
  assert.equal(picked(c.passages[0]).how, 'edit');
  await putAway(b);
});

/* =================================================== the helper */
heading('the helper (notes and summaries)');

await test('a reading keeps the notes, and Undo puts back only what it changed', async () => {
  const b = await makeBook([['Mara Venn kept the light at Crane Point. A stranger named Tom came up the path.']]);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.' }, { name: 'Tom', about: 'A stranger.' }], places: [{ name: 'Crane Point', about: 'A lighthouse.' }] }) }]);
  await archivist.run(b.novelId);
  let n = b.novel();
  assert.deepEqual(n.notes.people.map((c) => c.name), ['Mara Venn', 'Tom']);
  /* he edits one card himself after the reading */
  const mara = n.notes.people.find((c) => c.name === 'Mara Venn');
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { ...mara, about: 'HIS OWN WORDS about Mara.', updated: { by: 'you', at: Date.now() } }), { now: true });
  assert.equal(archivist.undoLast(b.novelId), true);
  await store.flush();
  n = await onPhone('novel', b.novelId);
  assert.deepEqual(n.notes.people.map((c) => c.name), ['Mara Venn'], 'Tom (new in that reading) goes');
  assert.equal(n.notes.people[0].about, 'HIS OWN WORDS about Mara.', 'his edit stays');
  assert.equal(n.notes.places.length, 0);
  await putAway(b);
});

await test('Read the whole book again, then Undo, brings the notes back', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.' }] }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().notes.people.length, 1);
  archivist.readAgain(b.novelId);
  assert.equal(b.novel().notes.people.length, 0);
  assert.equal(archivist.undoLast(b.novelId), true);
  await store.flush();
  const n = await onPhone('novel', b.novelId);
  assert.deepEqual(n.notes.people.map((c) => c.name), ['Mara Venn']);
  await putAway(b);
});

await test('the helper keeps his own names, casing and words on a card', () => {
  const notes = { people: [{ id: 'pe-1', name: 'Mara Venn', aka: [], about: 'HIS OWN WORDS.', now: '', updated: { by: 'you', at: 1 } }], places: [], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, { people: [{ name: 'mara venn', about: 'The helper would say this.', now: 'In the lantern room.' }] });
  const card = out.notes.people[0];
  assert.equal(out.notes.people.length, 1);
  assert.equal(card.name, 'Mara Venn');
  assert.equal(card.about, 'HIS OWN WORDS.');
  assert.equal(card.now, 'In the lantern room.', 'where she is now is still kept current');
});

await test('a passage changed while it was being read is read again, told what it used to say', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  const p = b.ch().passages[0];
  await script([{ text: '{"people": []}', delay: 0.15, chunk: 2 }, { text: '{}' }]);
  const run = archivist.run(b.novelId);
  await sleep(350);
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'The lamp was warm.' });
  await run;
  const r = (await requests()).filter((x) => x.body.messages.at(-1).content.includes('Update the notes'));
  assert.equal(r.length, 2, 'read, then read again');
  const second = r[1].body.messages.at(-1).content;
  assert.ok(second.includes('It used to read:') && second.includes('The lamp was cold.') && second.includes('It now reads:') && second.includes('The lamp was warm.'), second.slice(0, 400));
  const n = b.novel();
  assert.equal(n.memory.seen[b.ids[0]][p.id], archivist.signature(picked(b.ch().passages[0])), 'and marked read as it is now');
  assert.equal(archivist.pendingWork(b.novelId), false);
  await putAway(b);
});

await test('a change to an early chapter is read as such: where people are "now" stays as of the end of the book', async () => {
  const b = await makeBook([['Mara left the island.'], ['Mara came home at last.']]);
  markAllSeen(b);
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch(0).passages[0].id, text: 'Mara left the island in a storm.' });
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  const req = (await requests()).find((x) => x.body.messages.at(-1).content.includes('Update the notes')).body.messages.at(-1).content;
  assert.ok(req.includes('This part is from Chapter One; the book goes on to Chapter Two.'), req.slice(0, 500));
  assert.ok(req.includes('It used to read:') && req.includes('Mara left the island.'));
  await putAway(b);
});

await test('a chapter split from a passage tells the helper nothing new', async () => {
  const b = await makeBook([['One.', 'Two.', 'Three.']]);
  markAllSeen(b);
  const c1 = b.ch();
  const moving = JSON.parse(JSON.stringify(c1.passages.slice(1)));
  const fresh = shape.newChapter(b.novelId);
  fresh.passages = moving;
  await store.create('chapter', fresh.id, fresh);
  store.change('novel', b.novelId, shape.novelSteps.addChapter(fresh.id, c1.id), { now: true });
  archivist.moveSeen(b.novelId, c1.id, fresh.id, moving.map((m) => m.id));
  store.change('chapter', c1.id, shape.chapterSteps.cutFrom(moving[0].id), { now: true });
  const n = b.novel();
  for (const c of [store.peek('chapter', c1.id), store.peek('chapter', fresh.id)]) {
    const ch = archivist.changesIn(n, c);
    assert.equal(ch.changes.length + ch.removed.length, 0, JSON.stringify(ch));
  }
  assert.equal(archivist.pendingWork(b.novelId), false);
  await putAway(b);
});

await test('a passage taken out is told to the helper with its words', async () => {
  const b = await makeBook([['Mara met Tom at the gate.', 'The sea was grey.']]);
  markAllSeen(b);
  const p = b.ch().passages[0];
  archivist.retireIfSeen(b.novelId, b.ids[0], p.id);
  store.change('chapter', b.ids[0], shape.chapterSteps.removePassage(p.id), { now: true });
  const ch = archivist.changesIn(b.novel(), b.ch());
  assert.equal(ch.removed.length, 1);
  assert.equal(ch.removed[0].text, 'Mara met Tom at the gate.');
  await script([{ text: JSON.stringify({ gone: [{ kind: 'people', name: 'Tom' }] }) }]);
  await archivist.run(b.novelId);
  const req = (await requests())[0].body.messages.at(-1).content;
  assert.ok(req.includes('taken out') && req.includes('Mara met Tom at the gate.'), req.slice(0, 300));
  assert.equal(archivist.pendingWork(b.novelId), false);
  await putAway(b);
});

await test('a helper answer cut off is asked for once more, shorter — never in a loop', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  await script([{ text: '{"people": [{"name": "Mara', finish: 'length' }, { text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'Keeper.' }] }) }]);
  await archivist.run(b.novelId);
  const r = await requests();
  const notesCalls = r.filter((x) => x.body.messages.some((m) => String(m.content).includes('Update the notes')));
  assert.equal(notesCalls.length, 2);
  assert.ok(notesCalls[1].body.messages.at(-1).content.includes(prompts.JSON_CUT));
  assert.deepEqual(b.novel().notes.people.map((c) => c.name), ['Mara Venn']);
  await putAway(b);
});

await test('a helper turned away for good (its key) is not asked again until the connection changes', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  await script([{ status: 401, message: 'Invalid API key' }]);
  await archivist.run(b.novelId);
  assert.equal(archivist.lightOf(b.novelId).state, 'trouble');
  assert.match(archivist.lightOf(b.novelId).words, /key was refused/);
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 1, 'no second request with the same refused key');
  await setHouse({ key: 'a-new-key' });
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 2, 'asked again once the key changed');
  await setHouse();
  await putAway(b);
});

await test('the light is green only when nothing is left unread', async () => {
  const b = await makeBook([['One.']]);
  assert.equal(archivist.lightOf(b.novelId).state, 'waiting', 'unread words: amber');
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  assert.equal(archivist.lightOf(b.novelId).state, 'idle');
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'Two.' });
  assert.equal(archivist.lightOf(b.novelId).state, 'waiting', 'a new passage turns it amber at once');
  await putAway(b);
});

await test('a chapter he named — or cleared — is never renamed by the helper', async () => {
  const long = Array.from({ length: 100 }, (_, i) => `Sentence number ${i} of the chapter goes on.`).join(' ');
  const b = await makeBook([[long], [long]]);
  store.change('chapter', b.ids[0], shape.chapterSteps.setName('', 'you'), { now: true });
  await script([{ text: JSON.stringify({ chapterName: 'Helper Name One' }) }, { text: JSON.stringify({ chapterName: 'Helper Name Two' }) }]);
  await archivist.run(b.novelId);
  await store.flush();
  assert.equal((await onPhone('chapter', b.ids[0])).name, '', 'cleared by him: stays without a name');
  assert.equal((await onPhone('chapter', b.ids[1])).name, 'Helper Name Two', 'unnamed: named');
  await putAway(b);
});

await test('a finished chapter gets a summary; a summary older than its chapter is said to be', async () => {
  const b = await makeBook([['Chapter one words.'], ['Chapter two words.']]);
  markAllSeen(b);
  await script([{ text: JSON.stringify({ summary: 'Mara finds the letter.', name: 'The Letter' }) }]);
  await archivist.run(b.novelId);
  const c1 = await onPhone('chapter', b.ids[0]);
  assert.equal(c1.summary.text, 'Mara finds the letter.');
  assert.equal(c1.name, 'The Letter');
  /* the chapter changes: its summary rides marked as older, until summed up again */
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'A line added later. '.repeat(3000) });
  const n = b.novel();
  const chapters = { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) };
  const a = context.assemble({ house: store.peek('house', 'house'), novel: n, chapters, conn: { ...CONN, context: 9000, maxTokens: 500 }, target: { chapterId: b.ids[1] }, request: 'Go.' });
  assert.ok(a.system.includes("(This summary was written before the chapter's latest changes.)\nMara finds the letter."), a.system.slice(0, 2000));
  assert.ok(!a.system.includes('A line added later. A line added later. A line added later. A line added later.'), 'never the chapter both whole and in short');
  await putAway(b);
});

await test('a long chapter is summed up in parts that fit the helper\'s model', async () => {
  const para = 'The storm came in off the water like a held breath let go. '.repeat(40);
  const big = Array.from({ length: 12 }, () => para).join('\n\n');
  const b = await makeBook([[big], ['Next chapter.']]);
  markAllSeen(b);
  await setHouse({ context: 12000 });
  await script([{ text: '{"summary": "Part one."}' }, { text: '{"summary": "Parts one and two."}' }, { text: '{"summary": "All of it."}' }, { text: '{"summary": "All of it, again."}' }]);
  await archivist.run(b.novelId);
  const r = (await requests()).filter((x) => x.body.messages.at(-1).content.includes("for the book's notes"));
  assert.ok(r.length >= 2, `summed up in ${r.length} part(s)`);
  for (const x of r) assert.ok(providers.contextOf({ ...CONN, context: 12000 }) > JSON.stringify(x.body.messages).length / 4, 'each part fits');
  assert.ok(r[1].body.messages.at(-1).content.includes('Part one.'), 'the summary so far rides into the next part');
  const s = (await onPhone('chapter', b.ids[0])).summary.text;
  assert.ok(/All of it/.test(s), s);
  await setHouse();
  await putAway(b);
});

/* =================================================== partner and scenes */
heading('the partner and scenes');

await test('a message whose answer did not come is taken off and handed back — never sent twice', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ status: 500, message: 'boom' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Who sent the letter?' });
  assert.equal(out.ok, false);
  assert.equal(out.giveBack, 'Who sent the letter?');
  await store.flush();
  assert.equal((await onPhone('talk', b.novelId)).turns.length, 0);
  await script([{ text: 'Her brother, maybe.' }]);
  const again = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Who sent the letter?' });
  assert.equal(again.ok, true);
  const msgs = (await requests())[1].body.messages.filter((m) => m.role === 'user');
  assert.equal(msgs.filter((m) => m.content.includes('Who sent the letter?')).length, 1);
  assert.deepEqual((await onPhone('talk', b.novelId)).turns.map((t) => picked(t).text), ['Who sent the letter?', 'Her brother, maybe.']);
  await putAway(b);
});

await test('a scene goes on from the prose it was turned into, not from the talk again', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await script([{ text: 'THE NARRATOR OPENS.' }, { text: 'Prose of the scene.' }, { text: 'The scene goes on.' }]);
  await talk.playSay({ playId, text: '' });
  await talk.playSay({ playId, text: 'I WALK DOWN THE STEPS.' }).catch(() => {});
  /* only two scripted answers so far are used by the scene: the first, and the narrator's reply */
  const p = store.peek('play', playId);
  const tr = talk.transcriptOf(p);
  const out = await writer.playToProse({ novelId: b.novelId, chapterId: b.ids[0], play: p, transcript: tr.text });
  assert.equal(out.ok, true);
  store.change('play', playId, shape.turnSteps.set({ turned: tr.lastId, updated: Date.now(), after: out.passageId }), { now: true });
  await reset();
  await script([{ text: 'Onwards.' }]);
  await talk.playSay({ playId, text: '' });
  const body = (await requests())[0].body;
  const all = body.messages.map((m) => m.content).join('\n');
  const talkPart = body.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
  assert.ok(!talkPart.includes('I WALK DOWN THE STEPS.') && !talkPart.includes('THE NARRATOR OPENS.'), 'the turned scene is not sent again as talk');
  assert.ok(all.includes(picked(b.ch().passages.at(-1)).text), 'it rides as the book');
  assert.equal(body.messages.at(-1).content, prompts.playOnwards({ who: 'Mara' }));
  await putAway(b);
});

await test('a reply that breaks partway is kept as cut, never left "being written"', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ midstream_error: 'Half an answer', message: 'overloaded' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello?' });
  assert.equal(out.ok, true);
  await store.flush();
  const t = (await onPhone('talk', b.novelId)).turns[1];
  assert.equal(picked(t).text, 'Half an answer');
  assert.equal(picked(t).cut, true);
  assert.equal(picked(t).streaming, undefined);
  await putAway(b);
});

/* =================================================== what each one reads */
heading('what each one reads');

await test('a book longer than the model holds rides older chapters as summaries — never both', async () => {
  const para = 'The storm came in off the water like a held breath let go. '.repeat(60);
  const chs = Array.from({ length: 6 }, (_, i) => [para + ` CHAPTER-${i + 1}-END`]);
  const b = await makeBook(chs);
  for (let i = 0; i < 5; i++) store.change('chapter', b.ids[i], shape.chapterSteps.setSummary({ text: `SUMMARY-${i + 1}`, fp: shape.chapterPrint(b.ch(i)), at: Date.now() }));
  const chapters = Object.fromEntries(b.ids.map((id, i) => [id, b.ch(i)]));
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters, conn: { ...CONN, context: 8000, maxTokens: 500 }, target: { chapterId: b.ids[5] }, request: 'Go.' });
  for (let i = 1; i <= 5; i++) {
    const whole = a.system.includes(`CHAPTER-${i}-END`);
    const short = a.system.includes(`SUMMARY-${i}`);
    assert.ok(!(whole && short), `chapter ${i} rides once`);
  }
  assert.ok(a.system.includes('SUMMARY-1'), 'the oldest in short');
  assert.ok(a.system.includes('CHAPTER-5-END'), 'the newest whole');
  assert.ok(a.system.includes('CHAPTER-6-END'), 'the chapter being written whole');
  assert.ok(a.stats.tokens < 8000, `fits: ${a.stats.tokens}`);
  await putAway(b);
});

await test('later chapters that do not fit are said to be left out', async () => {
  const para = 'Later things happen here at some length. '.repeat(120);
  const b = await makeBook([['Now.'], [para], [para], [para], [para]]);
  for (let i = 1; i < 5; i++) store.change('chapter', b.ids[i], shape.chapterSteps.setSummary({ text: para, fp: shape.chapterPrint(b.ch(i)), at: Date.now() }));
  const chapters = Object.fromEntries(b.ids.map((id, i) => [id, b.ch(i)]));
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters, conn: { ...CONN, context: 9000, maxTokens: 500 }, target: { chapterId: b.ids[0] }, request: 'Go.' });
  assert.match(a.system, /more chapters? comes? after .*left out here to save room/);
  await putAway(b);
});

await test('the chapter being written, too long for the room, keeps its opening and the words right before the point', async () => {
  const filler = Array.from({ length: 400 }, (_, i) => `Line ${i} of a very long chapter.`).join(' ');
  const b = await makeBook([['THE OPENING LINE. ' + filler + ' THE LAST WORDS BEFORE.']]);
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: { ...CONN, context: 6000, maxTokens: 500 }, target: { chapterId: b.ids[0] }, request: 'Go.' });
  assert.ok(a.system.includes('THE OPENING LINE.'));
  assert.ok(a.system.includes('THE LAST WORDS BEFORE.'));
  assert.ok(a.system.includes('left out here to save room'));
  assert.ok(a.stats.tokens < 6000, `fits: ${a.stats.tokens}`);
  await putAway(b);
});

/* =================================================== the model layer */
heading('the model layer');

await test('"too long" from the model: the book is fitted smaller and sent once more', async () => {
  const para = 'The storm came in off the water like a held breath let go. '.repeat(60);
  const b = await makeBook([[para], [para], [para], ['Now.']]);
  await script([{ status: 400, message: "This model's maximum context length is 4000 tokens. However, your messages resulted in 9000 tokens." }, { text: 'It fits now.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[3] });
  assert.equal(out.ok, true);
  const r = await requests();
  assert.equal(r.length, 2);
  const size = (x) => JSON.stringify(x.body.messages).length;
  assert.ok(size(r[1]) < size(r[0]) * 0.8, `${size(r[0])} -> ${size(r[1])}`);
  assert.ok(out.notes.some((n) => /fitted to/.test(n)), out.notes.join(' | '));
  await putAway(b);
});

await test('a model that wants max_completion_tokens gets his length under that name', async () => {
  await setHouse({ maxTokens: 700 });
  const b = await makeBook([['Now.']]);
  await script([{ status: 400, message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." }, { text: 'Fine.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(out.ok, true);
  const r = await requests();
  assert.equal(r[0].body.max_tokens, 700);
  assert.equal(r[1].body.max_completion_tokens, 700);
  assert.ok(!('max_tokens' in r[1].body));
  await setHouse();
  await putAway(b);
});

await test('Claude: thinking gets room to think and write, and takes no top-k or other temperature', () => {
  const conn = { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', key: 'k', thinking: 'high', topK: 40, temperature: 0.5 };
  const { body } = providers.buildRequest(conn, { system: 'S', messages: [{ role: 'user', content: 'x' }], maxTokens: 4096 });
  assert.equal(body.max_tokens, providers.thinkingFloor(conn));
  assert.ok(body.max_tokens >= 16000);
  assert.ok(body.thinking && (body.thinking.type === 'adaptive' || body.thinking.type === 'enabled'));
  assert.ok(!('top_k' in body) && !('top_p' in body));
  assert.equal(body.temperature, 1);
});

await test('Claude keeps the start of the request ready: the part that stays the same page after page is cached', async () => {
  const b = await makeBook([['EARLIER CHAPTER WORDS.'], ['NOW CHAPTER WORDS.']]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'NOTED PERSON', about: 'x' })), { now: true });
  const chapters = { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) };
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters, conn: CONN, target: { chapterId: b.ids[1] }, request: 'Go.' });
  assert.ok(a.systemParts[0].includes('HIS OWN WORDS FIRST') && a.systemParts[0].includes('EARLIER CHAPTER WORDS.'));
  assert.ok(!a.systemParts[0].includes('NOTED PERSON'), 'the notes move, so they come after the cached part');
  assert.ok(a.systemParts[1].includes('NOTED PERSON') && a.systemParts[1].includes('NOW CHAPTER WORDS.'));
  const { body } = providers.buildRequest({ url: 'https://api.anthropic.com/v1', model: 'claude-x', key: 'k' }, { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: 2000 });
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  assert.equal(body.system[1].cache_control, undefined);
  await putAway(b);
});

await test('the levels a model said it takes reach Claude\'s effort too', () => {
  const conn = { url: 'https://api.anthropic.com/v1', model: 'claude-x', key: 'k', thinking: 'max' };
  conn.learned = { for: providers.learnKey(conn), at: Date.now(), efforts: ['low', 'medium'], drop: [] };
  const { body } = providers.buildRequest(conn, { system: 'S', messages: [{ role: 'user', content: 'x' }], maxTokens: 4096 });
  assert.ok(body.output_config && ['low', 'medium'].includes(body.output_config.effort), JSON.stringify(body.output_config));
});

await test('"too long" is read in each provider\'s words, with its number', () => {
  const cases = [
    ["This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", 8192],
    ['prompt is too long: 205000 tokens > 200000 maximum', 200000],
    ['The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).', 1048576],
    ['Invalid request: exceeded model token limit: 8192', 8192],
  ];
  for (const [words, n] of cases) {
    assert.ok(providers.CONTEXT_REFUSAL.test(words), words);
    assert.equal(providers.contextFrom(words), n, words);
  }
});

await test('each provider\'s usual room, and DeepSeek\'s started reply goes to its beta address', () => {
  assert.equal(providers.contextOf({ url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), 1000000);
  assert.equal(providers.contextOf({ url: 'https://api.anthropic.com/v1', model: 'claude-x' }), 200000);
  assert.equal(providers.contextOf({ url: 'https://example.com/v1', model: 'm' }), 128000);
  assert.equal(providers.contextOf({ url: 'https://example.com/v1', model: 'm', context: 32000 }), 32000, 'his own number first');
  const { url, body } = providers.buildRequest({ url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'k', prefill: 'The night', thinking: 'off' }, { system: 'S', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(url, 'https://api.deepseek.com/beta/chat/completions');
  assert.equal(body.messages.at(-1).role, 'assistant');
  assert.equal(body.messages.at(-1).prefix, true);
});

await test('Off that still thinks is learned — but not when his own <think> seed opened the thinking', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await setHouse({ thinking: 'off' });
  await script([{ text: 'A page.', think: 'It thought anyway.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let conn = store.peek('house', 'house').connections[0];
  assert.equal(Boolean(conn.learned && conn.learned.offThinks), true, 'thinking with Off is learned');
  await setHouse({ thinking: 'off', prefill: '<think>Let me consider' });
  await reset();
  await script([{ text: 'A page.', think: 'the scene carefully.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  conn = store.peek('house', 'house').connections[0];
  assert.equal(Boolean(conn.learned && conn.learned.offThinks), false, 'his seed opened it: nothing learned about Off');
  const sent = (await requests())[0].body;
  assert.equal(sent.messages.at(-1).role, 'assistant');
  assert.equal(sent.messages.at(-1).reasoning_content, 'Let me consider');
  await setHouse();
  await putAway(b);
});

await test('turns of one role side by side go as one message', () => {
  const out = providers.foldTurns([{ role: 'system', content: 'S' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'assistant', content: 'd' }, { role: 'system', content: 'late' }]);
  assert.deepEqual(out, [{ role: 'system', content: 'S' }, { role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c\n\nd' }, { role: 'system', content: 'late' }]);
});

await test('provider errors read as plain words', () => {
  assert.equal(call.plainError('<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>', 502), 'the provider had trouble on its side (502: 502 Bad Gateway)');
  assert.equal(call.plainError('[{"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}}]', 400), 'the key was refused (400: API key not valid. Please pass a valid API key.)');
  assert.equal(call.plainError('{"error":{"message":"Provider returned error","metadata":{"provider_name":"Chutes","raw":"{\\"error\\":{\\"message\\":\\"model is overloaded\\"}}"}}}', 503), 'the provider had trouble on its side (503: Chutes said: model is overloaded)');
  assert.equal(call.plainError('[Errno 111] Connection refused', 0, { transport: true }), 'nothing answered at that address — is the server there running?');
});

await test('the helper\'s JSON is found among other words', () => {
  assert.deepEqual(jsonutil.parseFirstObject('Sure! { not json at all } and then {"a": 1}'), { a: 1 });
  assert.deepEqual(jsonutil.parseFirstObject('<think>{"x": 2}</think>```json\n{"summary": "S"}\n```', (o) => typeof o.summary === 'string'), { summary: 'S' });
  assert.equal(jsonutil.parseFirstObject('nothing here'), null);
});

/* =================================================== files */
heading('files');

await test('a text file comes in with its chapters, names and scene breaks', () => {
  const { novel, chapters } = files.fromText('The Salt Road.md', '# The Salt Road\n\n## Chapter 1: Departure\n\nThey left at dawn.\n\n"Keep up," said Ines.\n\n## Chapter 2: The Pass\n\nSnow on the pass.\n\n***\n\nNight fell.\n');
  assert.equal(novel.meta.title, 'The Salt Road');
  const cs = novel.order.map((id) => chapters[id]);
  assert.deepEqual(cs.map((c) => c.name), ['Departure', 'The Pass']);
  assert.ok(cs[1].passages.some((p) => p.by === 'break'));
  assert.ok(shape.chapterText(cs[0]).includes('"Keep up," said Ines.'));
});

await test('the book goes out as text, Markdown and EPUB with its breaks and nothing that breaks a reader', async () => {
  const b = await makeBook([['Once \u0001upon a time.', '---', 'After the break.']]);
  const n = b.novel();
  const chapters = { [b.ids[0]]: b.ch() };
  const txt = files.toText(n, chapters);
  assert.ok(txt.includes('* * *') && txt.includes('After the break.'));
  const md = files.toMarkdown(n, chapters);
  assert.ok(md.includes('After the break.'));
  const epub = new Uint8Array(await (await files.toEpub(n, chapters)).arrayBuffer());
  const s = new TextDecoder().decode(epub);
  assert.ok(s.startsWith('PK') && s.includes('mimetypeapplication/epub+zip'));
  assert.ok(s.includes('<p>Once upon a time.</p>'), 'the control character is gone from the XHTML');
  assert.ok(s.includes('<p class="brk">❦</p>'));
  await putAway(b);
});

/* ------------------------------------------------------------ done */
console.log(`\napp: ${passed} passed, ${failed} failed`);
done(failed ? 1 : 0);
