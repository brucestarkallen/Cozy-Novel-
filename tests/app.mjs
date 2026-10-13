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
const checker = await import(path.join(ROOT, 'js/novel/checker.js'));
const search = await import(path.join(ROOT, 'js/novel/search.js'));
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
async function makeBook(chapters, { title = 'Test Book', brief = 'A lighthouse keeper finds a letter.', manual = false } = {}) {
  const { novel, chapter } = shape.newNovel({ title, brief });
  /* manual: What it's about and How it reads set by hand — a test about the
   * readings alone, with nothing kept for an Automatic book */
  if (manual) novel.auto = { about: false, style: false };
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
  /* ONLY=words runs just the checks whose names hold them */
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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

await test('How much to write, Automatic: the writer judges it, stops where he would take the wheel; no range is asked; a long reply has room', async () => {
  const b = await makeBook([['The lamp was cold.', 'The sea came up the steps.']]);
  store.change('novel', b.novelId, shape.novelSteps.setPref('length', 'auto'), { now: true });
  await script([{ text: 'Mara struck a match.' }, { text: 'A bridge.' }]);
  const n = b.novel();
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She lights the lamp.', length: n.prefs.length });
  assert.equal(out.ok, true);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('yours to judge') && ask.includes('take the wheel') && ask.includes('all of what I asked for'), ask);
  assert.ok(!/\d[\d,]* to [\d,]+ words/.test(ask), 'no range is asked');
  /* written into the middle: as much as it takes to reach what follows */
  const first = store.peek('chapter', b.ids[0]).passages[0].id;
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'auto', after: first });
  const mid = (await requests())[1].body.messages.at(-1).content;
  assert.ok(mid.includes('to the text that follows it') && !mid.includes('take the wheel'), mid);
  /* Claude must be told a reply length: Automatic gets a long stretch's room, or exactly what he set */
  assert.equal(context.requiredLength({}, 'auto'), context.requiredLength({}, 'long'));
  assert.equal(context.requiredLength({ maxTokens: 1500 }, 'auto'), 1500);
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
await test('every page keeps how big its request was: the provider\'s own count, or the app\'s', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'Counted.', usage: { prompt_tokens: 4321, completion_tokens: 5 } }, { text: 'Not counted.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let v = picked(b.ch().passages[1]);
  assert.equal(v.tokensIn, 4321, 'the provider counted the request in full');
  assert.equal(v.tokensCounted, true);
  assert.equal(v.conn, 'Scripted', 'which connection wrote it is still kept (only the page line leaves it out)');
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  v = picked(b.ch().passages[2]);
  const sent = (await requests())[1].body;
  const size = sent.messages.reduce((a, m) => a + String(m.content).length, 0);
  assert.ok(Number.isFinite(v.tokensIn) && v.tokensIn > size / 8 && v.tokensIn < size, `${v.tokensIn} tokens for ${size} characters`);
  assert.equal(v.tokensCounted, undefined, 'no count from the provider: the app\'s own, said as "about"');
  await putAway(b);
});

/* the app's own words, never a machine's: his writer may be Batman */
const MACHINE = /\b(AI|assistant|language model|LLM|chatbot|system prompt|prompt|persona|role-?play|the user|the author|your role)\b|\b(you are|you're|you’re)\s+(an?|the|my|our|\w+['’]s)\b/i;
function appWordsOf(body, his) {
  const all = body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
  return all.split(his).join('');
}

await test('the writer, the narrator and the partner are told it is fiction for grown readers, in words that never name a machine', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const house = store.peek('house', 'house');
  const chapters = { [b.ids[0]]: b.ch() };
  const play = { who: 'Mara', from: '' };
  for (const [purpose, extra] of [['write', { request: prompts.writeRequest({ chapterLabel: 'Chapter One', direction: '', length: 'scene' }) }], ['play', { play, request: prompts.playOpening({ who: 'Mara' }) }], ['partner', { turns: [{ role: 'user', content: 'What do you think?' }] }]]) {
    const a = context.assemble({ house, novel: b.novel(), chapters, conn: CONN, purpose, target: { chapterId: b.ids[0] }, ...extra });
    const { body } = providers.buildRequest(CONN, { system: a.system, messages: a.messages });
    const his = purpose === 'play' ? prompts.DEFAULT_NARRATOR : 'HIS OWN WORDS FIRST';
    if (purpose !== 'partner') assert.ok(body.messages[0].content.startsWith(his), `${purpose}: his words first`);
    assert.ok(body.messages[0].content.includes('It’s fiction for grown readers, and we write it uncensored'), `${purpose}: the fiction is said`);
    const words = appWordsOf(body, his).replace(/Mara climbed to the lamp\./g, '');
    const hit = words.match(MACHINE);
    assert.equal(hit, null, `${purpose}: "${hit && hit[0]}" in "${hit && words.slice(Math.max(0, hit.index - 80), hit.index + 40)}"`);
  }
  await putAway(b);
});

await test('the book and its notes ride as a user message when he chooses it — his notes, before his request', async () => {
  const b = await makeBook([['THE CHAPTER WORDS.']]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'NOTED PERSON', about: 'x' })), { now: true });
  await setHouse({}, { notesAs: 'user' });
  await script([{ text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'THE DIRECTION.' });
  const body = (await requests())[0].body;
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user'], 'his notes and his request ride as one message of his');
  assert.ok(body.messages[0].content.startsWith('HIS OWN WORDS FIRST') && body.messages[0].content.includes('This is our novel'));
  assert.ok(!body.messages[0].content.includes('THE CHAPTER WORDS.') && !body.messages[0].content.includes('NOTED PERSON'), 'the book is not in the system message');
  const mine = body.messages[1].content;
  assert.ok(mine.startsWith('Bruce here. Here’s where our book stands'), mine.slice(0, 80));
  assert.ok(mine.indexOf('A lighthouse keeper finds a letter.') < mine.indexOf('NOTED PERSON') && mine.indexOf('NOTED PERSON') < mine.indexOf('THE DIRECTION.'), 'about, then the notes, then his request');
  assert.ok(mine.includes('THE CHAPTER WORDS.'));
  assert.ok(!('cacheSplit' in body.messages[1]), 'the app\'s own marks never go out');
  await setHouse();
  await putAway(b);
});

await test('…or as an assistant message: the writer\'s own notebook, after a line on his side', async () => {
  const b = await makeBook([['THE CHAPTER WORDS.']]);
  await setHouse({}, { notesAs: 'assistant' });
  await script([{ text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'THE DIRECTION.' });
  const body = (await requests())[0].body;
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(body.messages[1].content, prompts.PICK_UP);
  assert.ok(body.messages[2].content.startsWith('My notebook for “Test Book”') && body.messages[2].content.includes('THE CHAPTER WORDS.'));
  assert.ok(body.messages[3].content.includes('THE DIRECTION.'));
  await setHouse();
  await putAway(b);
});

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
  const b = await makeBook([['One.', 'Two.', 'Three.']], { manual: true });
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
  const b = await makeBook([['Mara Venn kept the light.']], { manual: true });
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
await test('a card he wrote stays his through every reading after — the helper keeps only where they are now', () => {
  const notes = { people: [{ id: 'pe-1', name: 'Mara Venn', aka: [], about: 'HIS OWN WORDS.', now: '', updated: { by: 'you', at: 1 } }], places: [], lore: [], threads: [] };
  const one = archivist.foldNotes(notes, { people: [{ name: 'Mara Venn', now: 'In the lantern room.', ties: 'Wary of Tom since the gate.' }] });
  const two = archivist.foldNotes(one.notes, { people: [{ name: 'Mara Venn', about: 'The helper would say this.', now: 'On the cliff.' }] });
  const card = two.notes.people[0];
  assert.equal(card.about, 'HIS OWN WORDS.', 'a second reading never takes his words');
  assert.equal(card.now, 'On the cliff.');
  assert.equal(card.ties, 'Wary of Tom since the gate.', 'how they stand with the others is kept');
  assert.equal(card.updated.by, 'you');
});

await test('how people stand with each other reaches the writer, beside who they are and where they are now', async () => {
  const b = await makeBook([['Mara met Tom at the gate.']]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.', ties: 'TIES WITH TOM.', now: 'At the gate.' })), { now: true });
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: CONN, target: { chapterId: b.ids[0] }, request: 'Go.' });
  assert.ok(a.system.includes('- Mara — The keeper.\n  With others: TIES WITH TOM.\n  Right now: At the gate.'), a.system.slice(a.system.indexOf('People'), a.system.indexOf('People') + 200));
  await putAway(b);
});

await test('the helper is told the book is fiction for grown readers, and to keep all of it plainly', async () => {
  const b = await makeBook([['Mara Venn kept the light.']], { manual: true });
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  const sys = (await requests()).find((x) => x.body.messages.at(-1).content.includes('Update the notes')).body.messages[0].content;
  assert.ok(sys.startsWith(prompts.FICTION_WORK), sys.slice(0, 120));
  await putAway(b);
});

await test('a passage written into the middle of a chapter: the helper is told the chapter goes on after it', async () => {
  const b = await makeBook([['One.', 'Two.', 'Three.']], { manual: true });
  markAllSeen(b);
  await script([{ text: 'THE MIDDLE PASSAGE.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], after: b.ch().passages[0].id });
  assert.equal(b.ch().passages.map((p) => picked(p).text).join('|'), 'One.|THE MIDDLE PASSAGE.|Two.|Three.');
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('between the text before it and the text that follows it'), 'the writer writes it to fit between');
  await reset();
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  const req = (await requests()).find((x) => x.body.messages.at(-1).content.includes('Update the notes')).body.messages.at(-1).content;
  assert.ok(req.includes('New in Chapter One:\n"""\nTHE MIDDLE PASSAGE.'), req.slice(0, 600));
  assert.ok(req.includes('This part sits in the middle of Chapter One: the chapter goes on after it'), 'and where people are now is not turned back');
  await putAway(b);
});

await test('Automatic: the helper keeps What it\'s about and How it reads beside his words, and the writer reads both', async () => {
  const b = await makeBook([['Mara Venn kept the light at Crane Point.']]);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.' }], about: 'KEPT ABOUT.', style: 'KEPT STYLE.' }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('You also keep what the book is about as it stands') && ask.includes('"about":') && ask.includes('"style":'), ask.slice(0, 300));
  const n = b.novel();
  assert.equal(n.kept.about.text, 'KEPT ABOUT.');
  assert.equal(n.kept.style.text, 'KEPT STYLE.');
  assert.equal((await requests()).filter((x) => x.body.messages.at(-1).content.includes('for the writer to read before every page')).length, 0, 'written in the reading itself — no call of its own');
  await reset();
  await script([{ text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const sys = (await requests())[0].body.messages[0].content;
  assert.ok(sys.includes("What it's about:\nA lighthouse keeper finds a letter.\n\nAnd as the book stands now (my words above win wherever the two differ):\nKEPT ABOUT."), sys.slice(sys.indexOf("What it's about"), sys.indexOf("What it's about") + 200));
  assert.ok(sys.includes('How it reads:\nKEPT STYLE.'));
  /* Manual: only his words */
  store.change('novel', b.novelId, shape.novelSteps.setAuto('about', false), { now: true });
  await reset();
  await script([{ text: 'Another page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const sys2 = (await requests())[0].body.messages[0].content;
  assert.ok(sys2.includes("What it's about:\nA lighthouse keeper finds a letter.") && !sys2.includes('KEPT ABOUT.'), 'Manual sends only his words');
  await putAway(b);
});

await test('his correction of what the helper keeps stands; written from the book again, it comes back once — never in a loop', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'MY CORRECTION.', at: 1, by: 'you' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'KEPT STYLE.', at: 1 }), { now: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'She trimmed the wick.' });
  await script([{ text: JSON.stringify({ about: 'THE HELPER WOULD SAY THIS.', style: 'NEW STYLE.' }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(!ask.includes('You also keep what the book is about'), 'his correction is not the helper\'s to keep');
  assert.equal(b.novel().kept.about.text, 'MY CORRECTION.');
  assert.equal(b.novel().kept.style.text, 'NEW STYLE.');
  /* Write it from the book again: it goes, and is written whole once */
  await reset();
  archivist.keepAgain(b.novelId, 'about');
  assert.equal(archivist.pendingWork(b.novelId), true, 'the light says it has work');
  await script([{ text: JSON.stringify({ about: 'WRITTEN FROM THE BOOK.' }) }]);
  await archivist.run(b.novelId);
  const r = await requests();
  assert.equal(r.length, 1);
  assert.ok(r[0].body.messages.at(-1).content.includes('for the writer to read before every page') && r[0].body.messages.at(-1).content.includes('She trimmed the wick.'), 'from the book itself');
  assert.equal(b.novel().kept.about.text, 'WRITTEN FROM THE BOOK.');
  assert.equal(b.novel().kept.about.by, undefined, 'the helper\'s again');
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'nothing more to do');
  await putAway(b);
});

await test('Undo the last reading puts back what it kept of the book too', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'BEFORE.', at: 1 }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'STYLE.', at: 1 }), { now: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'A storm came in.' });
  await script([{ text: JSON.stringify({ about: 'AFTER.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'AFTER.');
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.equal(b.novel().kept.about.text, 'BEFORE.');
  await putAway(b);
});

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
await test('a scene sends the narrator\'s own words first — his writing words when that box is empty — and says whose part he takes', async () => {
  const b = await makeBook([['Mina waited at the gate. Joon was beside her.']]);
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'THE NARRATOR\'S OWN WORDS', late: '', partner: '' } });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'The gate creaks.' }]);
  await talk.playSay({ playId: id, text: '' });
  let body = (await requests())[0].body;
  const sys = body.messages[0].content;
  assert.ok(sys.startsWith('THE NARRATOR\'S OWN WORDS') && !sys.includes('HIS OWN WORDS FIRST'), sys.slice(0, 80));
  assert.ok(sys.includes('I’m taking Joon’s part. Everything Joon says, does, thinks and feels comes from me'), 'whose part it is, in his own voice');
  assert.ok(sys.includes('if the book sees through Joon’s eyes') && sys.includes('if it sees through someone else’s, it stays theirs'), 'the book\'s own point of view stays');
  assert.ok(body.messages.at(-1).content.includes('If Joon isn’t there yet, bring Joon in'), 'never "bring them in" when they are there already');
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: '', late: '', partner: '' } });
  await reset();
  await script([{ text: 'Rain.' }]);
  await talk.playSay({ playId: id, text: 'I take her hand.' });
  body = (await requests())[0].body;
  assert.ok(body.messages[0].content.startsWith('HIS OWN WORDS FIRST'), 'the narrator box emptied: his writing words');
  await setHouse();
  await putAway(b);
});

await test('a line to the narrator rides after his move, in his voice, never as his character — and never into the prose', async () => {
  const b = await makeBook([['Mina waited at the gate.']]);
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'The gate creaks.' }, { text: 'Thunder.' }, { text: 'A stranger comes.' }]);
  await talk.playSay({ playId: id, text: '' });
  await talk.playSay({ playId: id, text: 'I take her hand.', tell: 'Bring the storm in now.' });
  let body = (await requests())[1].body;
  const sys = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sys.includes(`When a line of mine begins “(${prompts.TELL_LEAD} Joon says or does”`), 'the narrator is told what such a line is');
  assert.equal(body.messages.at(-1).content, `I take her hand.\n\n(${prompts.TELL_LEAD} Joon says or does — Bring the storm in now.)`);
  /* a line to the narrator alone is a move too */
  await talk.playSay({ playId: id, text: '', tell: 'Someone new arrives.' });
  body = (await requests())[2].body;
  assert.equal(body.messages.at(-1).content, `(${prompts.TELL_LEAD} Joon says or does — Someone new arrives.)`);
  assert.ok(body.messages.some((m) => m.role === 'user' && m.content.endsWith('Bring the storm in now.)')), 'the earlier line rides in the history as it was');
  const p = store.peek('play', id);
  assert.equal(picked(p.turns[1]).tell, 'Bring the storm in now.');
  const tr = talk.transcriptOf(p);
  assert.ok(tr.text.includes('Joon: I take her hand.') && !tr.text.includes('storm') && !tr.text.includes('Someone new'), tr.text);
  /* a send that fails hands both back, and keeps neither */
  await script([{ status: 500, message: 'boom' }]);
  const out = await talk.playSay({ playId: id, text: 'I wave.', tell: 'Make it night.' });
  assert.equal(out.ok, false);
  assert.equal(out.giveBack, 'I wave.');
  assert.equal(out.giveBackTell, 'Make it night.');
  await store.flush();
  assert.ok(!(await onPhone('play', id)).turns.some((t) => picked(t).tell === 'Make it night.'));
  await putAway(b);
});

await test('three choices: asked for only while it is on; offered apart from the story, never sent back as it or written into the prose', async () => {
  const b = await makeBook([['Mina waited at the gate.']]);
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'The gate creaks.' }]);
  await talk.playSay({ playId: id, text: '' });
  const sysOf = (body) => body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(!sysOf((await requests())[0].body).includes(prompts.CHOICES_OPEN), 'off: nothing asked');
  await setHouse({}, { sceneChoices: true });
  await reset();
  await script([{ text: 'Rain begins.\n\n<choices>\n1. Joon opens the gate.\n2) "Who’s there?"\n- Joon walks away.\n</choices>' }, { text: 'The gate swings in.' }]);
  await talk.playSay({ playId: id, text: 'I wait.' });
  assert.ok(sysOf((await requests())[0].body).includes(`three different things Joon might say or do next`), 'on: the narrator is asked for them');
  const last = picked(store.peek('play', id).turns.at(-1));
  assert.deepEqual(prompts.choicesIn(last.text), ['Joon opens the gate.', '"Who’s there?"', 'Joon walks away.']);
  assert.equal(prompts.sceneWords(last.text), 'Rain begins.');
  /* the one he picks is his move; the offers never go back as the story */
  await talk.playSay({ playId: id, text: 'Joon opens the gate.' });
  const told = (await requests())[1].body.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
  assert.ok(told.includes('Rain begins.') && !told.some((t) => /choices|walks away/.test(t)), JSON.stringify(told));
  const tr = talk.transcriptOf(store.peek('play', id));
  assert.ok(tr.text.includes('Narrator: Rain begins.') && !/choices|walks away/.test(tr.text), tr.text);
  /* while the answer streams, the block never shows — not even its first letters */
  assert.equal(prompts.sceneWords('The rain.\n\n<cho'), 'The rain.');
  assert.equal(prompts.sceneWords('The rain.\n\n<choices>\n1. Op'), 'The rain.');
  assert.deepEqual(prompts.choicesIn('Rain.\n<choices>\nOne\nTwo'), ['One', 'Two'], 'a finished answer whose closing tag never came');
  await setHouse();
  await putAway(b);
});

await test('the partner sees every passage numbered, and its change lands as a new version with its Undo', async () => {
  const b = await makeBook([['Rain hammered the glass.', 'The lamp was cold.']]);
  await script([{ text: '<changes>[{"passage": "1.2", "find": "was cold", "replace": "had gone out", "why": "darker"}]</changes>\n\nI put the lamp out.' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Make the lamp darker.' });
  assert.equal(out.ok, true);
  const sys = (await requests())[0].body.messages[0].content;
  assert.ok(sys.includes('[1.1] Rain hammered the glass.') && sys.includes('[1.2] The lamp was cold.'), 'numbered as on the page');
  const p = b.ch().passages[1];
  assert.equal(picked(p).text, 'The lamp had gone out.');
  assert.equal(picked(p).how, 'partner');
  assert.equal(p.versions.length, 2, 'his words one arrow away');
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  assert.equal(v.changes.length, 1);
  assert.equal(v.changes[0].status, 'made');
  assert.equal(v.changes[0].label, 'Chapter One, passage 2');
  const undo = talk.undoOneChange(b.novelId, turn.id, v.id, v.changes[0].id);
  assert.equal(undo.ok, true);
  const q = b.ch().passages[1];
  assert.equal(picked(q).text, 'The lamp was cold.');
  assert.equal(q.versions.length, 1, 'the partner\'s version goes with its Undo');
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0].status, 'undone');
  /* what came of it is told with his next message */
  await reset();
  await script([{ text: 'Understood.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thanks.' });
  const last = (await requests())[0].body.messages.at(-1).content;
  assert.ok(last.startsWith('(Of your changes: Chapter One, passage 2 — I undid it.)'), last.slice(0, 120));
  await putAway(b);
});

await test('a change whose words are not there — or are there twice — is refused, and nothing changes', async () => {
  const b = await makeBook([['The sea. The sea.']]);
  await script([{ text: '<changes>[{"passage": "1.1", "find": "NOT THERE", "replace": "x"}, {"passage": "1.1", "find": "The sea.", "replace": "x"}, {"passage": "9.1", "text": "x"}]</changes>\nTried.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Change it.' });
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['refused', 'refused', 'refused']);
  assert.match(v.changes[0].said, /not there/);
  assert.match(v.changes[1].said, /more than one place/);
  assert.match(v.changes[2].said, /no Chapter Nine/);
  assert.equal(b.ch().passages[0].versions.length, 1, 'the passage is as it was');
  await putAway(b);
});

await test('the partner changes the book\'s words, a chapter\'s name and a card in the notes — each with its Undo; set to wait, they wait for Apply', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  const block = '<changes>[{"book": "about", "find": "finds a letter", "replace": "finds a letter from the dead", "why": "the hook"}, {"chapter": 1, "name": "The Light", "why": "a name"}, {"note": "people", "name": "Mara Venn", "about": "The keeper, sixty, salt-white hair.", "ties": "Alone since her brother left.", "why": "first look"}]</changes>\nDone three things.';
  await script([{ text: block }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Sharpen it.' });
  let n = b.novel();
  assert.equal(n.brief, 'A lighthouse keeper finds a letter from the dead.');
  assert.equal(b.ch().name, 'The Light');
  assert.equal(b.ch().nameBy, 'you', 'named for him: the helper never renames it');
  const card = n.notes.people.find((c) => c.name === 'Mara Venn');
  assert.equal(card.ties, 'Alone since her brother left.');
  assert.equal(card.updated.by, 'you');
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  for (const c of v.changes) assert.equal(talk.undoOneChange(b.novelId, turn.id, v.id, c.id).ok, true, c.label);
  n = b.novel();
  assert.equal(n.brief, 'A lighthouse keeper finds a letter.');
  assert.equal(b.ch().name, '');
  assert.equal(n.notes.people.length, 0, 'a card it added goes with its Undo');
  /* he chose that its changes wait */
  await setHouse({}, { partnerApplies: 'wait' });
  await reset();
  await script([{ text: block }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Again.' });
  const t2 = store.peek('talk', b.novelId).turns.at(-1);
  const v2 = picked(t2);
  assert.deepEqual(v2.changes.map((c) => c.status), ['waiting', 'waiting', 'waiting']);
  assert.equal(b.novel().brief, 'A lighthouse keeper finds a letter.', 'nothing lands before Apply');
  assert.equal(talk.applyChange(b.novelId, t2.id, v2.id, v2.changes[1].id).ok, true);
  assert.equal(b.ch().name, 'The Light');
  assert.equal(talk.skipChange(b.novelId, t2.id, v2.id, v2.changes[0].id).ok, true);
  assert.deepEqual(picked(store.peek('talk', b.novelId).turns.at(-1)).changes.map((c) => c.status), ['skipped', 'made', 'waiting']);
  await setHouse();
  await putAway(b);
});

await test('the partner asks to read a chapter whole; it is sent, and the same answer goes on', async () => {
  const b = await makeBook([['THE FIRST CHAPTER, WHOLE.'], ['The second.']]);
  await script([{ text: 'Let me look first. <read>[1]</read>' }, { text: 'Having read it: it works.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[1], text: 'How is chapter one?' });
  const r = await requests();
  assert.equal(r.length, 2);
  const back = r[1].body.messages.at(-1).content;
  assert.ok(back.includes('[1.1] THE FIRST CHAPTER, WHOLE.') && back.includes('Here they are, whole. Go on with your answer.'), back.slice(0, 200));
  assert.equal(r[1].body.messages.at(-2).role, 'assistant');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.text, 'Having read it: it works.');
  assert.deepEqual(v.read, ['Chapter One']);
  await putAway(b);
});

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
await test('the book riding as a message of its own: Claude keeps its start ready; elsewhere the mark never goes out', async () => {
  const b = await makeBook([['EARLIER CHAPTER WORDS.'], ['NOW CHAPTER WORDS.']]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'NOTED PERSON', about: 'x' })), { now: true });
  const house = { ...store.peek('house', 'house'), notesAs: 'user' };
  const chapters = { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) };
  const a = context.assemble({ house, novel: b.novel(), chapters, conn: CONN, target: { chapterId: b.ids[1] }, request: 'Go.' });
  const claude = providers.buildRequest({ url: 'https://api.anthropic.com/v1', model: 'claude-x', key: 'k' }, { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: 2000 }).body;
  const first = claude.messages[0].content;
  assert.ok(Array.isArray(first) && first[0].cache_control && first[0].cache_control.type === 'ephemeral', JSON.stringify(first).slice(0, 200));
  assert.ok(first[0].text.includes('EARLIER CHAPTER WORDS.') && !first[0].text.includes('NOTED PERSON'), 'what stays the same is kept ready; the notes move');
  assert.ok(first[1].text.includes('NOTED PERSON') && first[1].text.includes('Go.'));
  const other = providers.buildRequest(CONN, { system: a.system, messages: a.messages }).body;
  assert.ok(other.messages.every((m) => !('cacheSplit' in m)));
  await putAway(b);
});

heading('the checker and words to avoid');

const AVOID = 'a testament to\n\n“Shivers down her spine”\nA TESTAMENT TO\ntar\n';
const HIS = (extra = {}) => ({ instructions: { system: 'HIS OWN WORDS FIRST', late: '', partner: '', ...extra } });

await test('his words to avoid reach the writer, the partner and the narrator right after his own words — and nothing when the list is empty', async () => {
  await setHouse({}, HIS({ avoid: AVOID, narrator: 'THE NARRATOR\'S OWN WORDS' }));
  const b = await makeBook([['The lamp was cold.']]);
  const LINE = 'Words and phrases I never want in the book: “a testament to”, “Shivers down her spine”, “tar”.';
  await script([{ text: 'Page.' }, { text: 'Talk.' }, { text: 'Scene.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello.' });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await talk.playSay({ playId: id, text: '' });
  const r = await requests();
  assert.equal(r.length, 3);
  const sysOf = (x) => x.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sysOf(r[0]).startsWith(`HIS OWN WORDS FIRST\n\n${LINE}`), sysOf(r[0]).slice(0, 200));
  assert.ok(sysOf(r[1]).startsWith(LINE), 'the partner (its own box empty): the list first');
  assert.ok(sysOf(r[2]).startsWith(`THE NARRATOR'S OWN WORDS\n\n${LINE}`), 'the narrator');
  await setHouse();
  await reset();
  await script([{ text: 'Page two.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '' });
  assert.ok(!JSON.stringify((await requests())[0].body).includes('never want in the book'), 'an empty list sends nothing');
  await putAway(b);
});

await test('the checker reads each finished passage once; only fixes that stand in the words are kept, and a word to avoid that slipped through is marked', async () => {
  await setHouse({}, { checksFrom: 0, ...HIS({ avoid: AVOID }) });
  const b = await makeBook([['The light was a testament to patience. She started up the stair.', 'Nobody writes letters anymore, she said. Nobody writes letters anymore.']]);
  assert.equal(checker.stateOf(b.novelId).state, 'waiting', 'words not yet checked: blue');
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'Grammar', find: 'up the stair', replace: 'up the stairs', why: 'the stairs of a tower' },
    { passage: '1.1', kind: 'style', find: 'She started', replace: 'She began', why: 'plainer' },
    { passage: '1.1', kind: 'grammar', find: 'started up', replace: 'went up', why: 'over the one before' },
    { passage: '1.1', kind: 'grammar', find: 'words that are not there', replace: 'x', why: 'nowhere' },
    { passage: '1.2', kind: 'grammar', find: 'Nobody writes letters anymore', replace: 'Nobody writes letters any more', why: 'stands twice' },
    { passage: '1.2', kind: 'grammar', find: 'she said', replace: 'she said', why: 'the same' },
    { passage: '9.9', kind: 'grammar', find: 'she', replace: 'he', why: 'no such passage' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const r = await requests();
  assert.equal(r.length, 1);
  const sys = r[0].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(!sys.includes('HIS OWN WORDS FIRST'), 'his writing words are the writer\'s');
  assert.ok(sys.includes('“a testament to”, “Shivers down her spine”, “tar”'), 'his list, each once');
  const ask = r[0].body.messages.at(-1).content;
  assert.ok(ask.includes('[1.1] The light was a testament to patience.') && ask.includes('[1.2] Nobody writes'), ask);
  const got = checker.suggestions(b.novelId).map((x) => [x.number, x.item.kind, x.item.find, x.item.replace]);
  assert.deepEqual(got, [
    [1, 'avoid', 'The light was a testament to patience.', null],
    [1, 'humanize', 'She started', 'She began'],
    [1, 'grammar', 'up the stair', 'up the stairs'],
  ], '"tar" inside "started" is no word of his list; nothing that is not there, twice there, the same, over another, or of another passage');
  assert.deepEqual({ ...checker.stateOf(b.novelId), words: '' }, { state: 'found', words: '', count: 3 }, 'yellow, with its number');
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 1, 'read once: nothing is sent again');
  /* kept on the phone, so every window and browser shows the same */
  await store.flush();
  const c = await onPhone('chapter', b.ids[0]);
  assert.equal(Object.keys(c.checks).length, 2);
  await setHouse();
  await putAway(b);
});

await test('writing from before the checker began, or brought in from a file, is checked only when he asks — a chapter, or the whole book', async () => {
  const b = await makeBook([['Old words from before.', { text: 'Brought in from a file.', how: 'imported' }], ['More old words.']]);
  await sleep(5);
  await setHouse({}, { checksFrom: Date.now() });
  await sleep(5);
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'New words of his.' });
  assert.equal(checker.waiting(b.novelId), 1);
  await checker.runCheck(b.novelId);
  let r = await requests();
  assert.equal(r.length, 1);
  let ask = r[0].body.messages.at(-1).content;
  assert.ok(ask.includes('New words of his.') && !ask.includes('Old words from before.') && !ask.includes('Brought in from a file.') && !ask.includes('More old words.'), ask);
  const st = checker.stateOf(b.novelId);
  assert.equal(st.state, 'clean');
  assert.match(st.words, /3 older passages are checked only when you ask/);
  assert.deepEqual(checker.unchecked(b.novelId, b.ids[0]), { passages: 2, words: 9 });
  await reset();
  checker.checkChapter(b.novelId, b.ids[0]);
  await checker.runCheck(b.novelId);
  r = await requests();
  assert.equal(r.length, 1);
  ask = r[0].body.messages.at(-1).content;
  assert.ok(ask.includes('Old words from before.') && ask.includes('Brought in from a file.') && !ask.includes('More old words.') && !ask.includes('New words of his.'), ask);
  await reset();
  checker.checkBook(b.novelId);
  await checker.runCheck(b.novelId);
  r = await requests();
  assert.equal(r.length, 1);
  assert.ok(r[0].body.messages.at(-1).content.includes('More old words.'));
  assert.equal(checker.stateOf(b.novelId).words, 'Everything is checked — nothing to change.');
  await sleep(350);
  assert.equal((await requests()).length, 1, 'the look he asked for, and nothing more');
  await setHouse();
  await putAway(b);
});

await test('Apply makes one new version for the whole checking, the words before one arrow away; Leave it changes nothing; Apply all', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Mara climbed the the stair. It was raining alot.', 'The sea was grey and and cold.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the stair', replace: 'the stair', why: 'doubled' },
    { passage: '1.1', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'two words' },
    { passage: '1.2', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' },
    { passage: '1.2', kind: 'humanize', find: 'grey', replace: 'slate', why: 'sharper' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const find = (words) => checker.suggestions(b.novelId).find((x) => x.item.find === words);
  const one = find('the the stair');
  assert.deepEqual(checker.applyOne(b.novelId, one.chapterId, one.passageId, one.item.id), { ok: true });
  let p = b.ch().passages[0];
  assert.equal(p.versions.length, 2);
  assert.equal(p.versions[0].text, 'Mara climbed the the stair. It was raining alot.', 'the words before stay');
  assert.equal(picked(p).text, 'Mara climbed the stair. It was raining alot.');
  assert.equal(picked(p).how, 'suggested');
  const two = find('alot');
  assert.equal(two.versionId, picked(p).id, 'what is left of the checking goes with the new words');
  checker.applyOne(b.novelId, two.chapterId, two.passageId, two.item.id);
  p = b.ch().passages[0];
  assert.equal(p.versions.length, 2, 'the same checking lands on the same new version');
  assert.equal(picked(p).text, 'Mara climbed the stair. It was raining a lot.');
  const grey = find('grey');
  checker.leaveOne(grey.chapterId, grey.passageId, grey.item.id);
  assert.equal(b.ch().passages[1].versions.length, 1, 'left as it was');
  assert.equal(checker.suggestions(b.novelId).length, 1);
  assert.equal(checker.applyAll(b.novelId), 1);
  assert.equal(picked(b.ch().passages[1]).text, 'The sea was grey and cold.');
  assert.equal(checker.stateOf(b.novelId).state, 'clean', 'green: nothing to look at, nothing waiting');
  await store.flush();
  assert.equal(picked((await onPhone('chapter', b.ids[0])).passages[0]).text, 'Mara climbed the stair. It was raining a lot.');
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 1, 'words it made itself are not checked again');
  /* one fix can leave another's words standing twice: that one is not applied, says why, and goes */
  await reset();
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'The day was cold. The rocks were damp.' });
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.3', kind: 'humanize', find: 'cold', replace: 'cold and damp', why: 'fuller' },
    { passage: '1.3', kind: 'humanize', find: 'damp', replace: 'wet', why: 'plainer' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const cold = find('cold');
  const damp = find('damp');
  assert.equal(checker.applyOne(b.novelId, cold.chapterId, cold.passageId, cold.item.id).ok, true);
  const out = checker.applyOne(b.novelId, damp.chapterId, damp.passageId, damp.item.id);
  assert.deepEqual(out, { ok: false, said: 'those words stand in more than one place now' });
  assert.equal(picked(b.ch().passages[2]).text, 'The day was cold and damp. The rocks were damp.', 'never put in the wrong place');
  assert.equal(checker.suggestions(b.novelId).length, 0, 'and it goes');
  await setHouse();
  await putAway(b);
});

await test('what he left as it is is never offered again for that passage — nor a word to avoid in a sentence he kept', async () => {
  await setHouse({}, { checksFrom: 0, ...HIS({ avoid: 'tar\nbrine' }) });
  const b = await makeBook([['The sea was grey. The rope smelled of tar and brine.']]);
  const answer = { text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'humanize', find: 'grey', replace: 'slate', why: 'sharper' }] }) };
  await script([answer, answer, answer]);
  await checker.runCheck(b.novelId);
  const list = checker.suggestions(b.novelId);
  assert.deepEqual(list.map((x) => [x.item.kind, x.item.find]), [['humanize', 'grey'], ['avoid', 'The rope smelled of tar and brine.']]);
  assert.deepEqual(list[1].item.phrases, ['tar', 'brine'], 'every word of his list in that sentence, named once');
  assert.equal(list[1].item.why, '“tar” and “brine” are on your list of words to avoid');
  for (const x of list) checker.leaveOne(x.chapterId, x.passageId, x.item.id);
  assert.equal(checker.stateOf(b.novelId).state, 'clean');
  const pid = b.ch().passages[0].id;
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'The sea was grey. The rope smelled of tar and brine. Gulls.' });
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 2, 'his new words are read');
  assert.equal(checker.suggestions(b.novelId).length, 0, 'nothing he left comes back');
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'The sea was grey. Tar on the rope, again.' });
  await checker.runCheck(b.novelId);
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.find), ['Tar on the rope, again.'], 'a sentence written anew is read anew');
  await setHouse();
  await putAway(b);
});

await test('a passage changed while it was being checked: what came back is not shown on the new words, which are checked in their turn', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['The lamp was cold and and dark.']]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' }] }), delay: 0.04 }]);
  const running = checker.runCheck(b.novelId);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(20);
  const pid = b.ch().passages[0].id;
  assert.ok(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'The lamp was cold, and dark.' }));
  await running;
  const r = await requests();
  assert.equal(r.length, 2, 'his new words are read in their turn, in the same look');
  assert.ok(r[1].body.messages.at(-1).content.includes('The lamp was cold, and dark.'));
  assert.equal(checker.suggestions(b.novelId).length, 0, 'what came back for the old words is not shown on the new ones');
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold, and dark.', 'his edit stands');
  assert.equal(checker.stateOf(b.novelId).state, 'clean');
  await setHouse();
  await putAway(b);
});

await test('the checker turned away for good is not asked again until its connection changes; an answer it cannot read is tried again by itself; Nobody sends nothing', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['One passage.']]);
  await script([{ status: 401, message: 'Invalid API key' }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.stateOf(b.novelId).state, 'trouble', 'red');
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 1, 'not asked again with the key it refused');
  await setHouse({ key: 'a-new-key' }, { checksFrom: 0 });
  await script([{ text: 'Not JSON at all.' }, { text: 'Still not.' }]);
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 3, 'asked once the key changed, and once more for JSON — never in a loop');
  const st = checker.stateOf(b.novelId);
  assert.equal(st.state, 'waiting');
  assert.match(st.words, /tries again by itself in a minute/);
  const t = checker.forTests();
  const due = t.timers.get(b.novelId).due - Date.now();
  assert.ok(due > 50000 && due <= 60000, `tried again in a minute (${due} ms)`);
  checker.schedule(b.novelId, 6000);
  assert.ok(t.timers.get(b.novelId).due - Date.now() > 50000, 'a change in the meantime does not ask sooner than the wait');
  clearTimeout(t.timers.get(b.novelId).t);
  t.timers.delete(b.novelId);
  t.failures.delete(b.novelId);
  t.states.delete(b.novelId);
  await setHouse({}, { checksFrom: 0, roles: { writer: 'c-w', checker: 'off' } });
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 3, 'nobody checks: nothing is sent');
  assert.equal(checker.stateOf(b.novelId).state, 'off', 'grey');
  await setHouse();
  await putAway(b);
});

await test('a look at the book comes soon after a change, and a later change never puts it off', async () => {
  const id = 'n-not-a-book';
  const t = checker.forTests();
  checker.schedule(id, 6000);
  const first = t.timers.get(id).due;
  await sleep(30);
  checker.schedule(id, 6000);
  assert.equal(t.timers.get(id).due, first, 'the look already coming stands');
  checker.schedule(id, 500);
  assert.ok(t.timers.get(id).due < first, 'one asked for sooner comes sooner');
  clearTimeout(t.timers.get(id).t);
  t.timers.delete(id);
});

await test('the checker uses its own connection when he picks one', async () => {
  await setHouse({}, { checksFrom: 0, roles: { writer: 'c-w', checker: 'c-x' } });
  store.change('house', 'house', (x) => { x.connections.push({ ...CONN, id: 'c-x', name: 'Checker', model: 'scripted-checker' }); }, { now: true });
  const b = await makeBook([['One passage.']]);
  await checker.runCheck(b.novelId);
  assert.equal((await requests())[0].body.model, 'scripted-checker');
  await setHouse();
  await putAway(b);
});

await test('a passage longer than the checker\'s model holds at once is read in parts, all of it kept for the passage; a model too small says so and is not asked', async () => {
  await setHouse({ context: 6000 }, { checksFrom: 0 });
  const para = (i) => `Paragraph ${i} goes on about the sea and the light and the long night watch, word after word, until the lamp burns low and the keeper sleeps.`;
  const b = await makeBook([[Array.from({ length: 36 }, (_, i) => para(i + 1)).join('\n\n'), 'A short one.']]);
  await script([
    { text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'Paragraph 2 goes', replace: 'Paragraph two goes', why: 'in words' }] }) },
    { text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'Paragraph 20 goes', replace: 'Paragraph twenty goes', why: 'in words' }] }) },
  ]);
  await checker.runCheck(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content);
  const parts = asks.filter((a) => a.includes('[1.1] '));
  assert.ok(parts.length >= 2 && parts.length <= 4, `${parts.length} parts`);
  assert.ok(parts[0].includes('[1.1] Paragraph 1 goes') && !parts[0].includes('Paragraph 36 goes') && parts.at(-1).includes('Paragraph 36 goes'), 'the passage in order, in parts');
  assert.ok(asks.some((a) => a.includes('[1.2] A short one.') && !a.includes('Paragraph')), 'the next passage in a checking of its own');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.replace).sort(), ['Paragraph twenty goes', 'Paragraph two goes']);
  assert.equal(checker.waiting(b.novelId), 0);
  await setHouse({ context: 4000 }, { checksFrom: 0 });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'One more.' });
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'not asked');
  const st = checker.stateOf(b.novelId);
  assert.equal(st.state, 'trouble');
  assert.match(st.words, /too few to check the book beside its notes/);
  checker.forTests().blocked.delete(b.novelId);
  checker.forTests().states.delete(b.novelId);
  await setHouse();
  await putAway(b);
});

heading('search');

await test('search finds words however they are written — capitals, accents, curly quotes, line breaks — at their place in the text', () => {
  const T = '“Nobody writes letters anymore,” she said.\n\nThe café was shut. 🌊 Waves.';
  const at = (q) => search.findIn(T, q).map((x) => T.slice(x.start, x.end));
  assert.deepEqual(at('"nobody WRITES'), ['“Nobody writes']);
  assert.deepEqual(at('anymore,"'), ['anymore,”']);
  assert.deepEqual(at('CAFE was'), ['café was']);
  assert.deepEqual(at('said.   the'), ['said.\n\nThe']);
  assert.deepEqual(at('🌊 waves'), ['🌊 Waves']);
  assert.deepEqual(at('was'), ['was']);
  assert.deepEqual(at('nowhere'), []);
});

await test('search reads the whole book as it shows: the words on the page, chapter names, the notes, what it is about, the partner and the scenes', async () => {
  const b = await makeBook([['The bottle smelled of tar.', 'A bottle, once.'], ['A second bottle.']], { brief: 'A keeper finds a bottle.' });
  store.change('chapter', b.ids[0], shape.chapterSteps.setName('The Bottle Shore', 'you'), { now: true });
  const second = b.ch().passages[1].id;
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: second, text: 'Old words.' });
  store.change('novel', b.novelId, (n) => { n.notes = n.notes || {}; n.notes.lore = [{ id: 'k-1', name: 'The bottle', about: 'Green glass.' }]; }, { now: true });
  await talk.ensureTalk(b.novelId);
  store.change('talk', b.novelId, shape.turnSteps.addTurn(shape.newTurn('you', 'Where is the bottle from?')), { now: true });
  store.change('talk', b.novelId, shape.turnSteps.addTurn(shape.newTurn('ai', 'Somewhere north.\n\n<changes>[{"find": "the bottle", "replace": "a jar"}]</changes>')), { now: true });
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  store.change('play', playId, shape.turnSteps.addTurn(shape.newTurn('you', 'I pick up the bottle.', { tell: 'Make the bottle glow.' })), { now: true });
  store.change('play', playId, shape.turnSteps.addTurn(shape.newTurn('ai', 'It is cold.\n\n<choices>\nThrow the bottle\n</choices>')), { now: true });
  const novel = b.novel();
  const found = search.searchBook({ novel, chapters: { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) }, talk: store.peek('talk', b.novelId), plays: [store.peek('play', playId)], query: 'BOTTLE' });
  assert.deepEqual(found.map((f) => [f.where, f.label]), [
    ['chapter', 'Chapter One’s name'], ['passage', 'Passage 1'], ['passage', 'Passage 1'],
    ['note', 'The bottle'], ['book', 'What it’s about'], ['talk', 'You'], ['play', 'Mara'], ['play', 'To the narrator'],
  ], 'not the words before an edit, nor what the partner or narrator keep out of sight');
  assert.ok(found.every((f) => f.text.slice(f.start, f.end).toLowerCase() === 'bottle'));
  assert.equal(found[1].passageId, b.ch().passages[0].id);
  assert.equal(found[2].chapterId, b.ids[1]);
  assert.deepEqual(found[1].snippet, { before: 'The ', match: 'bottle', after: ' smelled of tar.' });
  assert.equal(search.searchBook({ novel, chapters: {}, query: '   ' }).length, 0);
  await putAway(b);
});

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
