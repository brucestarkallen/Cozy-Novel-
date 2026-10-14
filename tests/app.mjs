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
const modules = await import(path.join(ROOT, 'js/novel/modules.js'));
const crafts = await import(path.join(ROOT, 'js/novel/crafts.js'));
const util = await import(path.join(ROOT, 'js/util.js'));
const changes = await import(path.join(ROOT, 'js/novel/changes.js'));
const conversations = await import(path.join(ROOT, 'js/novel/conversations.js'));
const stock = await import(path.join(ROOT, 'js/novel/stock.js'));
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

/* the app's crafts and rules switched off — for a check of how the book fits
 * a small room, with nothing else in it (the crafts alone are ~17,000 tokens) */
const CRAFTS_OFF = { modules: Object.fromEntries(['novel-craft', 'scene-craft', 'voice', 'intimate', 'contested'].map((id) => [id, { rides: 'off' }])) };
const quietHouse = () => ({ ...store.peek('house', 'house'), ...CRAFTS_OFF });

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
  await setHouse({ context: 7000 }, CRAFTS_OFF);
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
  /* the book's newest passage: what its old words made is taken back out of the notes, and the new words are read from there, as new (readings.js) */
  assert.ok(second.includes('New in Chapter One') && second.includes('The lamp was warm.') && !second.includes('The lamp was cold.'), second.slice(0, 400));
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
  const a = context.assemble({ house: quietHouse(), novel: n, chapters, conn: { ...CONN, context: 9000, maxTokens: 500 }, target: { chapterId: b.ids[1] }, request: 'Go.' });
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

/* =================================================== connections as Cozy Tavern carries them */
heading('connections as Cozy Tavern carries them');

const structuredMod = await import(path.join(ROOT, 'js/model/structured.js'));
const presetsMod = await import(path.join(ROOT, 'js/novel/presets.js'));
const pad = ' and the passage goes on for a good while, long enough to clear the eighty characters the pattern asks for.';

await test('structured prefill: the opening is asked through the answer\'s schema, never handed over; the page reads the words out of the JSON, and a written <think> goes to the thinking', async () => {
  await setHouse({ prefill: 'Yuhuu [[w:1-3]]', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: JSON.stringify({ response: 'Yuhuu the storm' + pad }), chunk: 5 }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'A storm.' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const body = (await requests())[0].body;
  assert.equal(body.response_format.type, 'json_schema');
  assert.ok(body.response_format.json_schema.schema.properties.response.pattern.startsWith('^(?:Yuhuu '), body.response_format.json_schema.schema.properties.response.pattern);
  assert.notEqual(body.messages.at(-1).role, 'assistant', 'nothing is handed to it');
  assert.equal(picked(b.ch().passages[0]).text, 'Yuhuu the storm' + pad);
  /* a template that makes it think first */
  await setHouse({ prefill: '<think>Bruce wants [[w:2-4]]</think>\n', prefillMode: 'structured' });
  await reset();
  await script([{ text: JSON.stringify({ response: '<think>Bruce wants a storm now</think>\nThe storm came' + pad }), chunk: 6 }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const v = picked(b.ch().passages[1]);
  assert.equal(v.text, 'The storm came' + pad);
  assert.ok(String(v.thinking || '').includes('Bruce wants a storm now'), JSON.stringify(v.thinking));
  await setHouse();
  await putAway(b);
});

await test('a model that refuses a structured prefill is remembered for its model: the page goes again as written, and so does every page after', async () => {
  await setHouse({ prefill: 'Opening', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  await script([{ status: 400, message: 'response_format json_schema is not supported by this model' }, { text: 'A page as written.' }, { text: 'Another.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [first, second] = (await requests()).map((x) => x.body);
  assert.ok(first.response_format && !second.response_format, 'asked structured, then as written');
  assert.ok((picked(b.ch().passages[0]).notes || []).join(' ').includes('would not take a structured prefill'));
  await store.flush('house', 'house');
  const conn = (store.peek('house', 'house').connections || [])[0];
  assert.ok(providers.learnedFacts(conn).structuredDown, 'kept on the connection');
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal((await requests()).length, 3, 'no refusal round on the next page');
  assert.ok(!(await requests())[2].body.response_format);
  await setHouse();
  await putAway(b);
});

await test('looking things up: Claude\'s own search tool or OpenRouter\'s web plugin, only when ticked, never for a helper — and what it looked at comes back', async () => {
  const claude = { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', key: 'k', searchOn: true, searchMaxUses: 3 };
  const page = providers.buildRequest(claude, { messages: [{ role: 'user', content: 'go' }], maxTokens: 500 });
  assert.deepEqual(page.body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
  assert.equal(providers.buildRequest(claude, { messages: [{ role: 'user', content: 'go' }], maxTokens: 500, worker: true }).body.tools, undefined, 'never a helper');
  assert.equal(providers.buildRequest({ ...claude, searchOn: undefined }, { messages: [{ role: 'user', content: 'go' }], maxTokens: 500 }).body.tools, undefined, 'not ticked: nothing');
  const or = providers.buildRequest({ url: 'https://openrouter.ai/api/v1', model: 'x/y', key: 'k', searchOn: true, searchMaxUses: 4 }, { messages: [{ role: 'user', content: 'go' }] });
  assert.deepEqual(or.body.plugins, [{ id: 'web', max_results: 4 }]);
  /* how many look-ups, left empty: not sent — the provider decides */
  assert.deepEqual(providers.buildRequest({ ...claude, searchMaxUses: undefined }, { messages: [{ role: 'user', content: 'go' }], maxTokens: 500 }).body.tools, [{ type: 'web_search_20250305', name: 'web_search' }]);
  assert.deepEqual(providers.buildRequest({ url: 'https://openrouter.ai/api/v1', model: 'x/y', key: 'k', searchOn: true }, { messages: [{ role: 'user', content: 'go' }] }).body.plugins, [{ id: 'web' }]);
  assert.equal(providers.buildRequest({ url: 'https://api.deepseek.com/v1', model: 'd', searchOn: true }, { messages: [{ role: 'user', content: 'go' }] }).body.plugins, undefined, 'an address with no search of its own: the switch rests');
  /* Claude's stream, its search results read for their pages */
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', name: 'web_search' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.org/a', title: 'A page' }] } },
    { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'The words.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
  ];
  const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const notes = [];
  const out = await call.readReply('anthropic', new Response(sse), { onNote: (n) => notes.push(n) });
  assert.equal(out.text, 'The words.');
  assert.deepEqual(out.sources, [{ url: 'https://example.org/a', title: 'A page' }]);
  assert.deepEqual(notes, ['Searching the web…']);
});

await test('a structured template that goes as written sends only its plain opening — never its markers', async () => {
  const msgs = [{ role: 'user', content: 'go' }];
  const tpl = '<plan>The last passage ended with: [[w:4-30]]. This passage will: [[w:6-40]]</plan>\n[[keep]]Hello there, [[w:5-20]]';
  /* an address that takes no JSON-schema answers (DeepSeek), thinking off so a started reply rides */
  const ds = { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'k', thinking: 'off', prefill: tpl, prefillMode: 'structured' };
  const last = providers.buildRequest(ds, { messages: msgs }).body.messages.at(-1);
  assert.equal(last.role, 'assistant');
  assert.equal(last.content, 'Hello there,', 'the shown part, up to its first marker, no trailing space');
  assert.equal(providers.prefillGap(ds), ' ', 'the space before the marker comes back with the words');
  assert.ok(!JSON.stringify(providers.buildRequest(ds, { messages: msgs }).body).includes('[['), 'no marker goes out');
  /* a thinking block in the template, as a seed: up to its first marker */
  const or = { url: 'https://openrouter.ai/api/v1', model: 'moonshotai/kimi-k2', key: 'k', prefill: '<think>Right, where were we [[w:10-150]]</think>\n[[keep]]The page:', prefillMode: 'structured' };
  const plan = providers.prefillPlan(or);
  assert.equal(plan.seed, 'Right, where were we');
  assert.equal(plan.content, 'The page:');
  /* a template's markers in a prefill set to As written are read the same */
  assert.equal(providers.prefillPlan({ ...ds, prefillMode: undefined, prefill: 'Sure. [[w:3-9]]' }).content, 'Sure.');
  /* a prefill with no markers is as it always was */
  assert.equal(providers.prefillPlan({ ...ds, prefillMode: undefined, prefill: 'Sure, here it is: ' }).content, 'Sure, here it is:');
  assert.equal(providers.prefillGap({ ...ds, prefillMode: undefined, prefill: 'Sure, here it is: ' }), ' ');
});

await test('the prefill rides with a helper only when "Workers riding this connection get it too" is ticked', () => {
  const conn = { url: 'https://api.moonshot.ai/v1', model: 'kimi-k2', key: 'k', prefill: 'Sure.' };
  const msgs = [{ role: 'user', content: 'go' }];
  assert.equal(providers.buildRequest(conn, { messages: msgs, worker: true }).body.messages.at(-1).role, 'user', 'a helper: no prefill');
  const w = providers.buildRequest({ ...conn, prefillForWorkers: true }, { messages: msgs, worker: true }).body.messages.at(-1);
  assert.equal(w.role, 'assistant');
  assert.equal(w.content, 'Sure.');
  assert.equal(providers.buildRequest(conn, { messages: msgs }).body.messages.at(-1).role, 'assistant', 'a page: as always');
});

await test('Test it reads what came back: structured held to its pattern, a thinking seed thought on from — and a refusal is kept', async () => {
  const base = { ...CONN, id: 'c-t' };
  await script([{ text: JSON.stringify({ response: 'Yuhuu the gate at dawn' + pad }) }]);
  const s1 = await call.testPrefill({ ...base, prefill: 'Yuhuu [[w:1-3]]', prefillMode: 'structured' });
  assert.equal(s1.ok, true, s1.words);
  assert.ok(s1.words.startsWith('Structured works on this model — its answer opened with “Yuhuu”'), s1.words);
  assert.ok((await requests()).at(-1).body.response_format, 'asked the structured way');
  await script([{ text: 'Not JSON at all.' }]);
  const s2 = await call.testPrefill({ ...base, prefill: 'Yuhuu [[w:1-3]]', prefillMode: 'structured' });
  assert.equal(s2.ok, false);
  assert.ok(s2.words.includes('not in the shape asked'), s2.words);
  await script([{ text: 'B', think: 'and on it goes' }]);
  const s3 = await call.testPrefill({ ...base, prefill: '<think>Right, where were we' });
  assert.equal(s3.ok, true, s3.words);
  assert.ok(s3.words.includes('took your seed and thought on from it'), s3.words);
  const sent = (await requests()).at(-1).body;
  assert.equal(sent.messages.at(-1).role, 'assistant');
  assert.equal(sent.messages.at(-1).reasoning_content, 'Right, where were we');
  /* a refusal of a started reply is kept on the connection, as on a page */
  await script([{ status: 400, message: 'assistant message prefill is not supported for this model' }]);
  const seedConn = { ...base, prefill: '<think>Right, where were we' };
  const s4 = await call.testPrefill(seedConn);
  assert.equal(s4.ok, false);
  assert.equal(s4.words, 'Won’t take a prefill — sent without it from here on, until the model changes.');
  assert.ok(providers.learnedFacts(seedConn).prefillDown, 'kept');
  /* and a fresh yes is not stopped by it: the probe asks afresh */
  await script([{ text: 'B', think: 'thinking again' }]);
  const s5 = await call.testPrefill(seedConn);
  assert.equal(s5.ok, true, s5.words);
  assert.equal(s5.clearDown, true);
  const empty = await call.testPrefill({ ...base, prefill: '   ' });
  assert.equal(empty.words, 'There’s no prefill to try — write one first.');
});

await test('Test says whether thinking came back, asks again at the top when it did not, and times one answer', async () => {
  await script([{ text: 'ready' }, { text: 'ready', think: 'top-level thought' }, { text: 'Rain on the window. '.repeat(40), usage: { prompt_tokens: 20, completion_tokens: 300 }, delay: 0.01, chunk: 20 }]);
  const out = await call.tryConnection({ ...CONN, thinking: 'low' });
  assert.equal(out.ok, true, out.words);
  assert.ok(out.words.includes('Asked again at “max”') && out.words.includes('So it is this LEVEL that gives none here'), out.words);
  assert.ok(/Speed: first words after [\d.]+ s · \d+ tokens a second \(300 tokens in [\d.]+ s\)\./.test(out.words), out.words);
  const bodies = (await requests()).map((x) => x.body);
  assert.ok(!bodies.some((b) => b.response_format || b.plugins || b.tools), 'never the page\'s schema or search');
});

await test('every call is counted on the phone for Usage and cost — the provider\'s own count, or the app\'s', async () => {
  await realFetch(BASE + '/api/usage/clear', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'A page.', usage: { prompt_tokens: 1234, completion_tokens: 56 } }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await sleep(200);
  const u = await (await realFetch(BASE + '/api/usage')).json();
  const rows = Object.values(u.days).flatMap((d) => Object.entries(d));
  const mine = rows.find(([k]) => k.endsWith('|scripted'));
  assert.ok(mine, JSON.stringify(u));
  assert.equal(mine[1].calls, 1);
  assert.equal(mine[1].in, 1234);
  assert.equal(mine[1].out, 56);
  assert.equal(mine[1].estimated, 0);
  await putAway(b);
});

await test('a note at the end switched off keeps its words and sends nothing — each of the two on its own', async () => {
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'NARR', late: 'BOOK NOTE', lateNarrator: 'SCENE NOTE', partner: '', lateOff: true } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const sent = (await requests())[0].body.messages;
  assert.ok(!JSON.stringify(sent).includes('BOOK NOTE'), 'off: not sent');
  const late = prompts.lateFor(store.peek('house', 'house').instructions, 'play');
  assert.equal(late, 'SCENE NOTE', 'the scenes\' note is its own');
  assert.equal(prompts.lateFor({ ...store.peek('house', 'house').instructions, lateNarratorOff: true }, 'play'), '');
  assert.equal(prompts.lateFor({ ...store.peek('house', 'house').instructions, lateOff: false }, 'write'), 'BOOK NOTE', 'on again: sent');
  await setHouse();
  await putAway(b);
});

await test('presets: Save current preset keeps every box, both notes, words to avoid and his name; Use writes them all back exactly; the switches and modules stay', () => {
  const house = { instructions: { system: 'BATMAN WORDS', narrator: 'GOTHAM NARRATOR', partner: 'ALFRED', late: 'NOTE A', lateNarrator: 'NOTE B', avoid: 'ozone', lateOff: true }, you: { name: 'Bruce' }, modules: { 'novel-craft': { rides: 'off' } } };
  const v = presetsMod.voiceOf(house);
  presetsMod.presetSteps.save('vp-1', 'Batman', v, 1)(house);
  assert.equal(presetsMod.presetInUse(house).name, 'Batman');
  /* another voice */
  presetsMod.presetSteps.use(presetsMod.startingVoice('Bruce'))(house);
  assert.equal(house.instructions.system, prompts.DEFAULT_WRITING);
  assert.equal(house.instructions.late, '');
  assert.equal(presetsMod.presetInUse(house), null);
  assert.equal(house.instructions.lateOff, true, 'the switch stays');
  assert.deepEqual(house.modules, { 'novel-craft': { rides: 'off' } }, 'the modules stay');
  /* back to Batman */
  presetsMod.presetSteps.use(house.presets[0].voice, 'vp-1')(house);
  assert.deepEqual([house.instructions.system, house.instructions.narrator, house.instructions.partner, house.instructions.late, house.instructions.lateNarrator, house.instructions.avoid, house.you.name],
    ['BATMAN WORDS', 'GOTHAM NARRATOR', 'ALFRED', 'NOTE A', 'NOTE B', 'ozone', 'Bruce']);
  assert.equal(presetsMod.presetInUse(house).id, 'vp-1');
  /* a file brought back in holds only what a preset holds */
  assert.equal(presetsMod.cleanVoice({ boxes: { evil: 'x' } }), null);
  const back = presetsMod.cleanVoice(JSON.parse(JSON.stringify(house.presets[0].voice)));
  assert.equal(back.boxes.system, 'BATMAN WORDS');
  presetsMod.presetSteps.rename('vp-1', '  The Bat  ')(house);
  assert.equal(house.presets[0].name, 'The Bat');
  presetsMod.presetSteps.remove('vp-1')(house);
  assert.equal(house.presets.length, 0);
  assert.equal(house.presetOn, undefined);
});

/* =================================================== each version its own notes */
heading('each version its own notes');

const helperAsks = async () => (await requests()).filter((x) => x.body.messages.at(-1).content.includes('Update the notes'));
const writerAsks = async () => (await requests()).filter((x) => !x.body.messages.at(-1).content.includes('Update the notes') && !x.body.messages.at(-1).content.includes("for the book's notes"));
const sysText = (r) => r.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
const names = (n, kind = 'people') => ((n.notes && n.notes[kind]) || []).map((c) => c.name).sort();

await test('another take of the newest passage: the writer is sent the notes as they stood before it, the old take\'s notes go, and the new take is read as new', async () => {
  const b = await makeBook([['Mara Venn kept the light at Crane Point.', 'A stranger came up the path and said, "Oda Jovan." Mara knew the name.']], { manual: true });
  const [p1, p2] = b.ch().passages;
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.', now: 'In the lamp room.' }] }) },
    { text: JSON.stringify({ people: [{ name: 'Jovan', about: 'Says his name aloud: Oda Jovan.' }, { name: 'Mara Venn', now: 'Knows the stranger is Oda Jovan.' }], lore: [{ name: 'Jovan named himself', about: 'Mara heard him say “Oda Jovan”.' }] }) },
  ]);
  await archivist.run(b.novelId);
  const asks1 = await helperAsks();
  assert.equal(asks1.length, 2, 'the newest passage is read on its own');
  assert.ok(asks1[1].body.messages.at(-1).content.includes('Oda Jovan') && !asks1[1].body.messages.at(-1).content.includes('Crane Point.\n"""\nNew in'), 'second reading is the newest passage');
  let n = b.novel();
  assert.deepEqual(names(n), ['Jovan', 'Mara Venn']);
  assert.deepEqual(names(n, 'lore'), ['Jovan named himself']);
  const takeA = picked(b.ch().passages[1]);
  /* another take, the stranger silent this time */
  await reset();
  await script([{ text: 'The stranger said nothing at all.' }]);
  const r = await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  const sent = sysText((await requests())[0]);
  assert.ok(sent.includes('Mara Venn') && sent.includes('In the lamp room.'), 'the notes before it ride');
  assert.ok(!sent.includes('Oda Jovan') && !sent.includes('Jovan named himself') && !sent.includes('Knows the stranger'), 'nothing the old take made: ' + sent.slice(sent.indexOf('Who and what'), sent.indexOf('Who and what') + 600));
  /* the helper: the old take's notes taken back, the new one read as new */
  await reset();
  await script([{ text: JSON.stringify({ people: [{ name: 'The stranger', about: 'Silent; gives no name.' }] }) }]);
  await archivist.run(b.novelId);
  const asks2 = await helperAsks();
  assert.equal(asks2.length, 1, 'one reading');
  const req = asks2[0].body.messages.at(-1).content;
  assert.ok(req.includes('New in Chapter One') && req.includes('The stranger said nothing at all.') && !req.includes('It used to read:'), req.slice(0, 600));
  assert.ok(!req.includes('Oda Jovan'), 'the notes it is shown no longer hold the old take');
  n = b.novel();
  assert.deepEqual(names(n), ['Mara Venn', 'The stranger']);
  assert.equal(n.notes.people.find((c) => c.name === 'Mara Venn').now, 'In the lamp room.');
  assert.deepEqual(names(n, 'lore'), []);
  /* the arrows back to the first take: its notes come back at once, with no reading */
  await reset();
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p2.id, takeA.id), { now: true });
  await archivist.settle(b.novelId);
  n = b.novel();
  assert.deepEqual(names(n), ['Jovan', 'Mara Venn']);
  assert.equal(n.notes.people.find((c) => c.name === 'Mara Venn').now, 'Knows the stranger is Oda Jovan.');
  assert.deepEqual(names(n, 'lore'), ['Jovan named himself']);
  assert.equal(archivist.pendingWork(b.novelId), false, 'nothing left to read');
  /* and forward again */
  const takeB = b.ch().passages[1].versions.at(-1);
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p2.id, takeB.id), { now: true });
  await archivist.settle(b.novelId);
  assert.deepEqual(names(b.novel()), ['Mara Venn', 'The stranger']);
  await archivist.run(b.novelId);
  assert.equal((await helperAsks()).length, 0, 'swapping versions read before costs no reading');
  await store.flush();
  const onDisk = await onPhone('novel', b.novelId);
  assert.deepEqual(onDisk.notes.people.map((c) => c.name).sort(), ['Mara Venn', 'The stranger'], 'and it is on the phone');
  void p1;
  await putAway(b);
});

await test('a card he wrote or changed himself stays as he left it through every version', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came up the path with a red scarf.']], { manual: true });
  const p2 = b.ch().passages[1];
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.' }] }) },
    { text: JSON.stringify({ people: [{ name: 'Tom', about: 'Wears a red scarf.' }] }) },
  ]);
  await archivist.run(b.novelId);
  const tom = b.novel().notes.people.find((c) => c.name === 'Tom');
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { ...tom, about: 'HIS WORDS: Tom, a fisherman.', updated: { by: 'you', at: Date.now() } }), { now: true });
  await reset();
  await script([{ text: 'Tom came up the path, scarfless.' }, { text: JSON.stringify({ people: [{ name: 'Tom', about: 'No scarf.', now: 'At the door.' }] }) }]);
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2.id });
  const sent = sysText((await requests())[0]);
  assert.ok(sent.includes('HIS WORDS: Tom, a fisherman.'), 'his card rides with the take');
  await archivist.run(b.novelId);
  const card = b.novel().notes.people.find((c) => c.name === 'Tom');
  assert.equal(card.about, 'HIS WORDS: Tom, a fisherman.', 'his words stand');
  assert.equal(card.updated.by, 'you');
  await putAway(b);
});

await test('a passage in the middle changed: the helper is told what it used to say — later readings are never written over', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came.', 'Tom stayed the night.']], { manual: true });
  const [p1, p2] = b.ch().passages;
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.' }, { name: 'Tom', about: 'A visitor.', now: 'Arrived.' }] }) },
    { text: JSON.stringify({ people: [{ name: 'Tom', now: 'Staying the night.' }] }) },
  ]);
  await archivist.run(b.novelId);
  await reset();
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2.id, text: 'Tom came, soaked through.' });
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  const req = (await helperAsks())[0].body.messages.at(-1).content;
  assert.ok(req.includes('It used to read:') && req.includes('Tom came.') && req.includes('Tom came, soaked through.'), req.slice(0, 500));
  assert.equal(b.novel().notes.people.find((c) => c.name === 'Tom').now, 'Staying the night.', 'the later reading stands');
  void p1;
  await putAway(b);
});

await test('the notes say which passages they have not read yet, up to the point being written', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came.', 'Tom stayed.']], { manual: true });
  const [p1, p2] = b.ch().passages;
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mara', about: 'The keeper.' }), { now: true });
  /* only the first passage read */
  store.change('novel', b.novelId, shape.novelSteps.seen(b.ids[0], { [p1.id]: archivist.signature(picked(p1)) }));
  const chapters = { [b.ids[0]]: b.ch() };
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn: CONN, target: { chapterId: b.ids[0], before: 'new-one' }, request: 'Go on.' });
  assert.ok(a.system.includes('Not in these notes yet: Chapter One, passages 2 and 3'), a.system.slice(a.system.indexOf('Who and what'), a.system.indexOf('Who and what') + 400));
  /* a take of passage 2: only what comes before it counts, and itself never */
  const t = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn: CONN, target: { chapterId: b.ids[0], before: p2.id }, request: 'Go on.' });
  assert.ok(!t.system.includes('Not in these notes yet'), 'everything before passage 2 is read');
  /* all read: nothing said */
  markAllSeen(b);
  const c = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn: CONN, target: { chapterId: b.ids[0], before: 'new-one' }, request: 'Go on.' });
  assert.ok(!c.system.includes('Not in these notes yet'));
  await putAway(b);
});

await test('a passage taken out that was the newest read: its notes go with it, with no reading', async () => {
  const b = await makeBook([['Mara kept the light.', 'A wolf came to the door.']], { manual: true });
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.' }] }) },
    { text: JSON.stringify({ lore: [{ name: 'The wolf', about: 'Came to the door.' }] }) },
  ]);
  await archivist.run(b.novelId);
  assert.deepEqual(names(b.novel(), 'lore'), ['The wolf']);
  const p2 = b.ch().passages[1];
  archivist.retireIfSeen(b.novelId, b.ids[0], p2.id);
  store.change('chapter', b.ids[0], shape.chapterSteps.removePassage(p2.id), { now: true });
  await reset();
  await archivist.settle(b.novelId);
  assert.deepEqual(names(b.novel(), 'lore'), [], 'the wolf goes from the notes');
  assert.deepEqual(names(b.novel()), ['Mara']);
  assert.equal(archivist.pendingWork(b.novelId), false);
  assert.equal((await requests()).length, 0, 'no reading');
  await putAway(b);
});

await test('a passage taken out while another chapter is being read keeps its reading: taken back after, with no call', async () => {
  const b = await makeBook([['Mara kept the light.'], ['A wolf came to the door.']], { manual: true });
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.' }] }) },
    { text: JSON.stringify({ lore: [{ name: 'The wolf', about: 'Came to the door.' }] }) },
  ]);
  await archivist.run(b.novelId);
  assert.deepEqual(names(b.novel(), 'lore'), ['The wolf']);
  const p1 = b.ch(0).passages[0];
  const wolf = b.ch(1).passages[0];
  /* his edit of chapter one is read as a change (slowly); meanwhile the wolf's passage is taken out */
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1.id, text: 'Mara kept the light alone.' });
  await reset();
  await script([{ text: '{"people": []}', delay: 0.15, chunk: 2 }, { text: '{}' }]);
  const run = archivist.run(b.novelId);
  await sleep(350);
  archivist.retireIfSeen(b.novelId, b.ids[1], wolf.id);
  store.change('chapter', b.ids[1], shape.chapterSteps.removePassage(wolf.id), { now: true });
  assert.equal(await archivist.settle(b.novelId), 0, 'nothing is settled while a reading is on its way');
  await run;
  assert.deepEqual(names(b.novel(), 'lore'), [], 'the wolf goes from the notes');
  assert.equal((await helperAsks()).length, 1, 'only the change was read: the passage taken out cost no reading');
  assert.equal(archivist.pendingWork(b.novelId), false);
  /* Undo, as the page does it: the passage back in its place — its notes come back at once, with no call */
  await reset();
  store.change('chapter', b.ids[1], shape.chapterSteps.addPassage(wolf, '^'), { now: true });
  store.change('chapter', b.ids[1], shape.chapterSteps.clearRetired([wolf.id]), { now: true });
  assert.equal(await archivist.settle(b.novelId), 1);
  assert.deepEqual(names(b.novel(), 'lore'), ['The wolf'], 'Undo brings its notes back');
  assert.equal(archivist.pendingWork(b.novelId), false);
  assert.equal((await requests()).length, 0, 'no reading');
  assert.deepEqual(b.ch(1).retired || [], [], 'nothing of it is kept as taken out');
  await putAway(b);
});

await test('the readings kept stay within bounds: six newest versions of a passage, the one on show and the one read', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came.']], { manual: true });
  const [p1] = b.ch().passages;
  const vids = [picked(p1).id];
  for (let i = 2; i <= 9; i++) { const v = shape.newVersion({ text: `Mara kept the light, take ${i}.` }); store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p1.id, v), { now: true }); vids.push(v.id); }
  /* the first take on show and read; every take with a reading kept */
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p1.id, vids[0]), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.seen(b.ids[0], { [p1.id]: archivist.signature(picked(b.ch().passages[0])) }), { now: true });
  for (const vid of vids) store.change('novel', b.novelId, shape.novelSteps.putReading(p1.id, vid, { sig: `${vid}:x`, mode: 'mixed', cards: [], kept: {}, covers: [p1.id], at: 1 }), { now: true });
  /* and one for a passage no longer anywhere in the book */
  store.change('novel', b.novelId, shape.novelSteps.putReading('p-gone', 'v-gone', { sig: 'v-gone:x', mode: 'new', cards: [], kept: {}, covers: ['p-gone'], at: 1 }), { now: true });
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  const all = b.novel().memory.readings;
  assert.deepEqual(Object.keys(all[p1.id]).sort(), [vids[0], ...vids.slice(-6)].sort(), 'takes 2 and 3 go');
  assert.equal(all['p-gone'], undefined, 'a passage no longer in the book keeps none');
  await putAway(b);
});

await test('the notes\' auditor: notes kept before it are checked against the book once, by themselves — what an old version left goes, his own cards stay, with Undo', async () => {
  const b = await makeBook([['Mara kept the light.', 'The stranger said nothing at all.']], { manual: true });
  /* notes from before 2.4: an old take's facts, with no reading kept to take them back */
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'pe-j', name: 'Jovan', about: 'Says his name aloud: Oda Jovan.' }, { id: 'pe-m', name: 'Mara', about: 'HIS WORDS: the keeper.', updated: { by: 'you', at: 1 } }], places: [], lore: [{ id: 'lo-1', name: 'Jovan named himself', about: 'Mara heard him say Oda Jovan.' }], threads: [] }), { now: true });
  markAllSeen(b);
  assert.equal(archivist.firstCheck(b.novelId), true, 'notes from before the auditor: checked once');
  assert.equal(archivist.firstCheck(b.novelId), false, 'only once');
  await script([{ text: JSON.stringify({ people: [{ name: 'Jovan', about: 'A stranger who gives no name.' }, { name: 'Mara', about: 'NOT HIS' }], gone: [{ kind: 'lore', name: 'Jovan named himself' }, { kind: 'people', name: 'Mara' }] }) }]);
  await archivist.run(b.novelId);
  const asks = (await requests()).map((r) => r.body.messages.at(-1).content);
  assert.equal(asks.length, 1);
  assert.ok(asks[0].includes(prompts.AUDIT_ASK) && asks[0].includes('The stranger said nothing at all.') && asks[0].includes('Says his name aloud') && asks[0].includes('Mara — this card is mine, written or changed by me'), asks[0].slice(-1200));
  const n = b.novel();
  assert.equal(n.notes.people.find((c) => c.name === 'Jovan').about, 'A stranger who gives no name.');
  assert.deepEqual(n.notes.lore, [], 'the old take\'s fact goes');
  assert.equal(n.notes.people.find((c) => c.name === 'Mara').about, 'HIS WORDS: the keeper.', 'his card: never taken out, never his words changed');
  assert.equal(n.memory.auditAsked, false);
  assert.equal(n.memory.audit.reads, 0);
  /* with the reading's Undo */
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.equal(b.novel().notes.lore[0].name, 'Jovan named himself');
  /* not again until it is due: every few readings, or when he asks */
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0);
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: archivist.AUDIT_EVERY } }), { now: true });
  assert.equal(archivist.auditDue(b.novel()), true, 'due after enough readings');
  await putAway(b);
});

await test('Ideas: a few premises for what happens next, asked with the whole book, read from their blocks — never kept in the conversation', async () => {
  const b = await makeBook([['Mara kept the light. A stranger waited at the gate.']]);
  await script([{ text: 'Here.\n<direction>Mara lets him in.</direction>\n<direction>Mara bars the door.</direction>\n<direction>The stranger leaves a letter.</direction>' }]);
  const out = await talk.nextIdeas({ novelId: b.novelId, chapterId: b.ids[0], count: 3 });
  assert.deepEqual(out.ideas, ['Mara lets him in.', 'Mara bars the door.', 'The stranger leaves a letter.']);
  const r = (await requests())[0].body;
  const all = r.messages.map((m) => String(m.content)).join('\n');
  assert.ok(all.includes('three genuinely different premises') && all.includes('A stranger waited at the gate.'), all.slice(-400));
  assert.equal((store.peek('talk', b.novelId) || { turns: [] }).turns.length, 0, 'nothing kept in the conversation');
  await putAway(b);
});

await test('the partner offers each premise in its own block, shown with Use as the next direction; its words read whole elsewhere', () => {
  const text = 'Two ways.\n\n<direction>Jovan says nothing and pulls Yuki clear.</direction>\n\nOr:\n<direction>Yuki runs.</direction>';
  assert.deepEqual(changes.partsOf(text).map((x) => [x.kind, x.text]), [['words', 'Two ways.'], ['direction', 'Jovan says nothing and pulls Yuki clear.'], ['words', 'Or:'], ['direction', 'Yuki runs.']]);
  assert.deepEqual(changes.directionsIn(text), ['Jovan says nothing and pulls Yuki clear.', 'Yuki runs.']);
  assert.ok(!changes.wordsOf(text).includes('<direction>') && changes.wordsOf(text).includes('Yuki runs.'));
  assert.deepEqual(changes.directionsIn('Coming: <direction>half'), [], 'one still coming is not offered yet');
  const frame = prompts.partnerFrame({}, { meta: { title: 'T' }, brief: '' });
  assert.ok(frame.includes('you as my writing partner') && frame.includes('<direction>') && frame.includes('You don’t write the next pages'));
});

await test('the readings listed newest first; Put back takes out only what one reading changed; Read again reads that passage afresh', async () => {
  const b = await makeBook([['Mara kept the light.', 'A wolf came to the door.']], { manual: true });
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.' }] }) },
    { text: JSON.stringify({ lore: [{ name: 'The wolf', about: 'At the door.' }], people: [{ name: 'Mara', now: 'Facing the wolf.' }] }) },
  ]);
  await archivist.run(b.novelId);
  const list = archivist.readingsList(b.novelId);
  assert.equal(list.length, 2);
  assert.equal(list[0].label, 'Chapter One, passage 2', 'newest first');
  assert.ok(list[0].live && list[0].shown);
  assert.deepEqual(list[0].changed.map((c) => c.name).sort(), ['Mara', 'The wolf']);
  /* he changes Mara himself; Put back takes out the wolf and leaves his Mara */
  const mara = b.novel().notes.people[0];
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { ...mara, now: 'HIS NOW.', updated: { by: 'you', at: Date.now() } }), { now: true });
  assert.equal(archivist.putBackReading(b.novelId, list[0].pid, list[0].vid), true);
  assert.deepEqual(names(b.novel(), 'lore'), []);
  assert.equal(b.novel().notes.people[0].now, 'HIS NOW.', 'his change stays');
  assert.equal(archivist.readingsList(b.novelId).length, 1, 'that reading is no longer what the notes hold');
  assert.equal(archivist.pendingWork(b.novelId), false, 'the passage still counts as read');
  /* Read again: the first passage read afresh */
  const first = archivist.readingsList(b.novelId)[0];
  await reset();
  assert.equal(archivist.putBackReading(b.novelId, first.pid, first.vid, { readAgain: true }), true);
  assert.equal(archivist.pendingWork(b.novelId), true);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper, read again.' }] }) }]);
  await archivist.run(b.novelId);
  const req = (await helperAsks())[0].body.messages.at(-1).content;
  assert.ok(req.includes('New in Chapter One') && req.includes('Mara kept the light.'), req.slice(0, 300));
  assert.equal(b.novel().notes.people[0].about, 'The keeper.', 'a card he changed is his: read again, its words stand');
  assert.equal(archivist.pendingWork(b.novelId), false, 'and it is read');
  await putAway(b);
});

await test('each version keeps all of its own: the notes and what the helper keeps of the book (about, how it reads) come back with it', async () => {
  const b = await makeBook([['A stranger came up the path and said, "Oda Jovan."']]);
  const p = b.ch().passages[0];
  const takeA = picked(p);
  await script([{ text: JSON.stringify({ people: [{ name: 'Jovan', about: 'Says his name aloud.' }], about: 'ABOUT A', style: 'STYLE A' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'ABOUT A');
  await reset();
  await script([{ text: 'The stranger said nothing at all.' }, { text: JSON.stringify({ people: [{ name: 'The stranger', about: 'Silent.' }], about: 'ABOUT B', style: 'STYLE B' }) }]);
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id });
  await archivist.run(b.novelId);
  let n = b.novel();
  assert.equal(n.kept.about.text, 'ABOUT B');
  assert.deepEqual(names(n), ['The stranger']);
  /* the arrows back to the first take: everything of it back, with no call */
  await reset();
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p.id, takeA.id), { now: true });
  await archivist.settle(b.novelId);
  n = b.novel();
  assert.equal(n.kept.about.text, 'ABOUT A');
  assert.equal(n.kept.style.text, 'STYLE A');
  assert.deepEqual(names(n), ['Jovan']);
  assert.equal((await requests()).length, 0);
  await putAway(b);
});

await test('several versions taken out at once come back in their places with Undo, the one on show on show again', () => {
  const vs = ['one', 'two', 'three', 'four', 'five'].map((t) => shape.newVersion({ text: t }));
  const c = { passages: [{ id: 'p1', by: 'ai', pick: 3, versions: JSON.parse(JSON.stringify(vs)) }] };
  const before = JSON.parse(JSON.stringify(c.passages[0].versions));
  for (const v of vs.slice(0, 3)) shape.chapterSteps.removeVersion('p1', v.id)(c);
  assert.deepEqual(c.passages[0].versions.map((v) => v.text), ['four', 'five']);
  assert.equal(picked(c.passages[0]).text, 'four', 'the one on show stays on show');
  shape.chapterSteps.putVersionsBack('p1', before, vs[3].id)(c);
  assert.deepEqual(c.passages[0].versions.map((v) => v.text), ['one', 'two', 'three', 'four', 'five']);
  assert.equal(picked(c.passages[0]).text, 'four');
});

await test('a chapter read as it was once before gets its summary from then back, with no call', async () => {
  const b = await makeBook([['Chapter one words.'], ['Chapter two words.']]);
  markAllSeen(b);
  await script([{ text: JSON.stringify({ summary: 'The first summary.', name: 'One' }) }]);
  await archivist.run(b.novelId);
  const p = b.ch(0).passages[0];
  const first = picked(p);
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'Chapter one, written again.' });
  markAllSeen(b);
  await reset();
  await script([{ text: JSON.stringify({ summary: 'The second summary.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.ch(0).summary.text, 'The second summary.');
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p.id, first.id), { now: true });
  markAllSeen(b);
  await reset();
  await archivist.run(b.novelId);
  assert.equal(b.ch(0).summary.text, 'The first summary.');
  assert.equal((await requests()).length, 0, 'no call for it');
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
/* An emptied narrator box sends nothing of his (2.3; it used to send "How
 * you like it written", which now tells the writer it writes everyone, the
 * main character too — what the narrator of a scene he plays must never do). */
await test('a scene sends the narrator\'s own words first — nothing of his when that box is empty — and says whose part he takes', async () => {
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
  const emptied = body.messages[0].content;
  assert.ok(!emptied.includes('HIS OWN WORDS FIRST'), 'the narrator box emptied: not his writing words');
  assert.ok(emptied.startsWith('## The Telling\nProse is grounded, concrete, literal. You tell the world around my character.'), `nothing of his: the scene craft comes first — ${emptied.slice(0, 120)}`);
  await setHouse();
  await putAway(b);
});

await test('a note at the end for the book and one for scenes: each rides last for its own, never for the partner; a house with the one note of before keeps it for both, then they are apart', async () => {
  const b = await makeBook([['Mina waited at the gate.']]);
  const lastSys = (r) => { const m = r.body.messages.at(-1); return m.role === 'system' ? m.content : ''; };
  const has = (r, words) => JSON.stringify(r.body.messages).includes(words);
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'NARR', late: 'BOOK NOTE', lateNarrator: 'SCENE NOTE', partner: '' } });
  await reset();
  await script([{ text: 'A page.' }, { text: 'The gate creaks.' }, { text: 'An answer.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mina' });
  await talk.playSay({ playId: id, text: 'I wait.' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thoughts?' });
  const [w, p, t] = await requests();
  assert.equal(lastSys(w), 'BOOK NOTE', 'the writer: the book\'s note, last');
  assert.ok(!has(w, 'SCENE NOTE'), 'never the scenes\' note');
  assert.equal(lastSys(p), 'SCENE NOTE', 'the narrator: the scenes\' note, last');
  assert.ok(!has(p, 'BOOK NOTE'), 'never the book\'s note');
  assert.ok(!has(t, 'BOOK NOTE') && !has(t, 'SCENE NOTE') && !lastSys(t), 'the partner: neither');
  /* a scene turned into prose is the writer writing the book */
  await reset();
  await script([{ text: 'Prose.' }]);
  const tr = talk.transcriptOf(store.peek('play', id));
  await writer.playToProse({ novelId: b.novelId, chapterId: b.ids[0], play: store.peek('play', id), transcript: tr.text, mine: tr.mine });
  const [prose] = await requests();
  assert.ok(lastSys(prose) === 'BOOK NOTE' && !has(prose, 'SCENE NOTE'), 'a scene into prose: the book\'s note');
  /* a house from before: one note, for both — the scenes keep it, once */
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'NARR', late: 'OLD NOTE', partner: '' } });
  assert.equal(prompts.lateSplitDue(store.peek('house', 'house')), true);
  await reset();
  await script([{ text: 'Rain.' }]);
  await talk.playSay({ playId: id, text: 'I listen.' });
  assert.equal(lastSys((await requests())[0]), 'OLD NOTE', 'before the split the scene is sent the one note, as before');
  store.change('house', 'house', prompts.splitLate, { now: true });
  await store.flush('house', 'house');
  let ins = (await onPhone('house', 'house')).instructions;
  assert.equal(ins.late, 'OLD NOTE');
  assert.equal(ins.lateNarrator, 'OLD NOTE', 'the scenes\' box holds what the one box held');
  assert.equal(prompts.lateSplitDue(store.peek('house', 'house')), false, 'once is all it takes');
  /* from then on they are apart: the scenes' box emptied stays empty, and the book keeps its note */
  store.change('house', 'house', (x) => { x.instructions.lateNarrator = ''; }, { now: true });
  store.change('house', 'house', prompts.splitLate, { now: true });
  await store.flush('house', 'house');
  ins = (await onPhone('house', 'house')).instructions;
  assert.equal(ins.lateNarrator, '', 'an emptied scenes box is never filled again');
  await reset();
  await script([{ text: 'Thunder.' }, { text: 'A page more.' }]);
  await talk.playSay({ playId: id, text: 'I go in.' });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Night.' });
  const [p2, w2] = await requests();
  assert.ok(!lastSys(p2) && !has(p2, 'OLD NOTE'), 'the scene: nothing at the end');
  assert.equal(lastSys(w2), 'OLD NOTE', 'the book: its note still');
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

await test('the partner renames someone everywhere at once — passages, chapter names, the notes, the book\'s words — and never an ordinary word; Undo puts each back', async () => {
  const b = await makeBook([['Oda Jovan stood at the gate. "ODA JOVAN!" she called.', 'Jovan Odacious was someone else.'], ['Oda Jovan rode north.']]);
  store.change('chapter', b.ids[1], shape.chapterSteps.setName('Oda Jovan Rides', 'you'), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-oj', name: 'Oda Jovan', aka: [], about: 'Oda Jovan is a swordsman.', now: '' }), { now: true });
  await script([{ text: '<changes>[{"rename": {"from": "Oda Jovan", "to": "Jovan Oda"}, "why": "his name, the right way round"}]</changes>\nRenamed him everywhere.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'His name is Jovan Oda.' });
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'made', JSON.stringify(v.changes[0]));
  assert.equal(picked(b.ch(0).passages[0]).text, 'Jovan Oda stood at the gate. "JOVAN ODA!" she called.');
  assert.equal(picked(b.ch(0).passages[1]).text, 'Jovan Odacious was someone else.', 'only the whole name');
  assert.equal(b.ch(0).passages[1].versions.length, 1, 'a passage without it is not touched');
  assert.equal(picked(b.ch(1).passages[0]).text, 'Jovan Oda rode north.');
  assert.equal(b.ch(1).name, 'Jovan Oda Rides');
  assert.equal(b.novel().notes.people[0].name, 'Jovan Oda');
  assert.equal(b.novel().notes.people[0].about, 'Jovan Oda is a swordsman.');
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  assert.equal(talk.undoOneChange(b.novelId, turn.id, picked(turn).id, v.changes[0].id).ok, true);
  assert.equal(picked(b.ch(0).passages[0]).text, 'Oda Jovan stood at the gate. "ODA JOVAN!" she called.');
  assert.equal(b.ch(1).name, 'Oda Jovan Rides');
  assert.equal(b.novel().notes.people[0].name, 'Oda Jovan');
  /* an ordinary word is never changed everywhere */
  const c = await makeBook([['Will said he will come.']]);
  await reset();
  await script([{ text: '<changes>[{"rename": {"from": "Will", "to": "Bill"}, "why": "x"}]</changes>\nOk.' }, { text: 'Leaving it.' }]);
  await talk.partnerSay({ novelId: c.novelId, chapterId: c.ids[0], text: 'Rename Will.' });
  const w = picked(store.peek('talk', c.novelId).turns.at(-1));
  assert.equal(w.changes[0].status, 'refused');
  assert.match(w.changes[0].said, /ordinary word/);
  assert.equal(picked(c.ch().passages[0]).text, 'Will said he will come.');
  await putAway(b); await putAway(c);
});

await test('the partner changes the same words across chapters, takes a passage out, renames a card, writes a summary and a module\'s words — each with its Undo', async () => {
  const b = await makeBook([['The lantern hissed.', 'A gull cried.'], ['The lantern hissed again.']]);
  markAllSeen(b);
  const gull = b.ch(0).passages[1].id;
  store.change('novel', b.novelId, shape.novelSteps.putNote('places', { id: 'pl-1', name: 'The Point', about: 'A lighthouse.' }), { now: true });
  const block = '<changes>[{"replace_all": true, "find": "lantern", "replace": "lamp", "chapters": "all", "why": "one word"}, {"passage": "1.2", "remove": true, "why": "too quiet"}, {"note": "places", "name": "The Point", "newName": "Crane Point", "why": "its name"}, {"summary": 1, "text": "The lamp hisses.", "why": "short"}, {"module": "The sound of a voice", "text": "MY VOICE RULE", "why": "asked"}]</changes>\nFive changes.';
  await script([{ text: block }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Do all of it.' });
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['made', 'made', 'made', 'made', 'made'], JSON.stringify(v.changes.map((c) => c.said)));
  assert.equal(picked(b.ch(0).passages[0]).text, 'The lamp hissed.');
  assert.equal(picked(b.ch(1).passages[0]).text, 'The lamp hissed again.');
  assert.equal(b.ch(0).passages.length, 1, 'the gull passage is out');
  assert.ok((b.ch(0).retired || []).some((r) => r.key === gull), 'its words kept for the helper');
  const card = b.novel().notes.places[0];
  assert.equal(card.name, 'Crane Point');
  assert.equal(b.ch(0).summary.text, 'The lamp hisses.');
  assert.equal(b.ch(0).summary.by, 'you');
  const voice = modules.listModules(store.peek('house', 'house')).find((m) => m.id === 'voice');
  assert.equal(voice.text, 'MY VOICE RULE');
  for (const c of [...v.changes].reverse()) assert.equal(talk.undoOneChange(b.novelId, turn.id, v.id, c.id).ok, true, c.label);
  assert.equal(picked(b.ch(0).passages[0]).text, 'The lantern hissed.');
  assert.equal(b.ch(0).passages.length, 2, 'the passage is back');
  assert.equal(picked(b.ch(0).passages[1]).text, 'A gull cried.');
  assert.ok(!(b.ch(0).retired || []).some((r) => r.key === gull), 'back in its place, nothing of it is kept as taken out');
  assert.equal(b.novel().notes.places[0].name, 'The Point');
  assert.equal(b.ch(0).summary, null);
  assert.equal(modules.listModules(store.peek('house', 'house')).find((m) => m.id === 'voice').ownWords, false, 'the app\'s words again');
  await putAway(b);
});

await test('a change that missed its words is told back once in the same answer, and the corrected one lands; a change only said to be made is asked for once', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([
    { text: '<changes>[{"passage": "1.1", "find": "lamp is cold", "replace": "lamp had died", "why": "x"}]</changes>\nI made the lamp darker.' },
    { text: '<changes>[{"passage": "1.1", "find": "lamp was cold", "replace": "lamp had died", "why": "quoted right this time"}]</changes>\nFixed.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Darker.' });
  const r = await requests();
  assert.equal(r.length, 2, 'asked once more');
  assert.ok(r[1].body.messages.at(-1).content.startsWith('Some of your changes couldn’t be made: Chapter One, passage 1 — those words are not there.'), r[1].body.messages.at(-1).content.slice(0, 160));
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp had died.');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['refused', 'made']);
  assert.ok(v.text.includes('I made the lamp darker.') && v.text.includes('Fixed.'), 'the answer keeps both');
  /* said, with no block */
  await reset();
  await script([{ text: 'I’ve changed the lamp to burn blue.' }, { text: '<changes>[{"passage": "1.1", "find": "had died", "replace": "burned blue", "why": "as I said"}]</changes>\nNow it is in the book.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Make it blue.' });
  const r2 = await requests();
  assert.equal(r2.length, 2);
  assert.ok(r2[1].body.messages.at(-1).content.startsWith('Your answer says a change was made, but it holds no changes block'), r2[1].body.messages.at(-1).content.slice(0, 80));
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp burned blue.');
  /* the whole answer came again, with its block: it stands in place of the first */
  const v2 = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.ok(v2.text.includes('Now it is in the book.') && !v2.text.includes('I’ve changed the lamp to burn blue.'), v2.text);
  /* an answer that changes nothing and says nothing of the kind is left alone — talk that only sounds like a claim too */
  for (const said of ['It reads well as it is.', 'I’ve added four directions below:\n1. She leaves.', 'That’s done well — everything’s changed for Oda now.', 'Mara said, “I’ve changed the passage,” and laughed.']) {
    await reset();
    await script([{ text: said }]);
    await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'How does it read?' });
    assert.equal((await requests()).length, 1, said);
    assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).text, said.replace(/\s+$/, ''));
  }
  await putAway(b);
});

await test('every answer\'s block is made, the third too; what it reads in a round is sent; a round that brings nothing keeps the answer', async () => {
  const b = await makeBook([['The lamp was cold.'], ['Mara slept by the stove.']]);
  /* missed, missed again, then right: three answers, the third's block made */
  await script([
    { text: '<changes>[{"passage": "1.1", "find": "lamp is cold", "replace": "lamp had died", "why": "x"}]</changes>\nDarker.' },
    { text: '<changes>[{"passage": "1.1", "find": "lamp iz cold", "replace": "lamp had died", "why": "y"}]</changes>\nAgain.' },
    { text: '<changes>[{"passage": "1.1", "find": "lamp was cold", "replace": "lamp had died", "why": "z"}]</changes>\nNow it is right.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Darker.' });
  assert.equal((await requests()).length, 3);
  assert.equal(picked(b.ch(0).passages[0]).text, 'The lamp had died.', 'the third answer\'s block is made');
  let v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['refused', 'refused', 'made']);
  /* a round can read: the chapter it only had in short is sent, and the fix lands */
  await reset();
  await script([
    { text: '<changes>[{"passage": "2.1", "find": "by the fire", "replace": "by the hearth", "why": "x"}]</changes>\nDone.' },
    { text: 'Let me read it. <read>[2]</read>' },
    { text: '<changes>[{"passage": "2.1", "find": "by the stove", "replace": "by the hearth", "why": "read it"}]</changes>\nRight.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hearth, please.' });
  const r = await requests();
  assert.equal(r.length, 3);
  assert.ok(r[2].body.messages.at(-1).content.includes('Mara slept by the stove.'), 'the chapter it asked for in the round is sent');
  assert.equal(picked(b.ch(1).passages[0]).text, 'Mara slept by the hearth.');
  /* a round that fails: the answer in hand, its change made, stays — never taken back, never asked again */
  await reset();
  await script([
    { text: '<changes>[{"passage": "1.1", "find": "had died", "replace": "burned low", "why": "a"}, {"passage": "1.1", "find": "NOT THERE", "replace": "x", "why": "b"}]</changes>\nTwo changes.' },
    { status: 500, message: 'boom' },
  ]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Lower.' });
  assert.equal(picked(b.ch(0).passages[0]).text, 'The lamp burned low.', 'the change made stays');
  const turns = store.peek('talk', b.novelId).turns;
  v = picked(turns.at(-1));
  assert.ok(v.text.includes('Two changes.') && !v.streaming, v.text);
  assert.deepEqual(v.changes.map((c) => c.status), ['made', 'refused']);
  assert.equal(turns.at(-2).by, 'you', 'his message stays');
  assert.ok(!out.giveBack, 'nothing is handed back to be sent twice');
  await putAway(b);
});

await test('the partner\'s changes: a name inside another name, a hyphened name, words inside words, a card not there to rename', async () => {
  const b = await makeBook([['Oda Jovan walked in. Oda sat. Mary-Jane waved at Mary. Annual rites: Ann and Anna sang.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-oj', name: 'Oda Jovan', about: 'A stranger.' }), { now: true });
  await script([{ text: '<changes>[{"rename": {"from": "Oda", "to": "Oda Jovan"}, "why": "full name"}, {"rename": {"from": "Mary", "to": "Rose"}, "why": "x"}, {"replace_all": true, "find": "Ann", "replace": "Beth", "chapters": "all", "why": "y"}, {"note": "people", "name": "Oda", "newName": "Jovan Oda", "why": "z"}]</changes>\nFour.' }, { text: 'Leaving that one.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Names.' });
  assert.equal(picked(b.ch().passages[0]).text, 'Oda Jovan walked in. Oda Jovan sat. Mary-Jane waved at Rose. Annual rites: Beth and Anna sang.');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['made', 'made', 'made', 'refused']);
  assert.match(v.changes[3].said, /there is no Oda in the notes to rename/);
  assert.deepEqual(b.novel().notes.people.map((c) => c.name), ['Oda Jovan'], 'no card under the old name');
  /* set to wait, the card not there is said at once */
  assert.equal(changes.whyNot(b.novelId, { note: 'people', name: 'Oda', newName: 'Jovan Oda' }), 'there is no Oda in the notes to rename');
  assert.equal(changes.whyNot(b.novelId, { replace_all: true, find: 'Ann', replace: 'Beth', chapters: 'all' }), 'those words stand nowhere in those chapters', 'Annual and Anna are not Ann');
  await putAway(b);
});

await test('an Undo that can put back only part of a change says so, and keeps for the helper the words it takes away', async () => {
  const b = await makeBook([['Lily ran.', 'Lily hid.']], { manual: true });
  markAllSeen(b);
  await script([{ text: '<changes>[{"rename": {"from": "Lily", "to": "Rose"}, "why": "x"}]</changes>\nRenamed.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Rose.' });
  /* the helper reads the renamed passages */
  markAllSeen(b);
  /* he edits the first since */
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id, text: 'Rose ran fast.' });
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  const out = talk.undoOneChange(b.novelId, turn.id, v.id, v.changes[0].id);
  assert.equal(out.ok, true);
  assert.equal(out.partly, true);
  assert.match(out.said, /^1 put back; 1 changed since, kept as they are$/);
  assert.equal(picked(b.ch().passages[1]).text, 'Lily hid.');
  assert.equal(picked(b.ch().passages[0]).text, 'Rose ran fast.', 'his edit stays');
  assert.match(picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0].undoneSaid, /1 changed since/);
  /* the renamed words the helper read are kept for it: it is told what the passage used to say */
  const ch = archivist.changesIn(b.novel(), b.ch());
  const back = ch.changes.find((c) => c.pid === b.ch().passages[1].id);
  assert.equal(back.old, 'Rose hid.', JSON.stringify(ch.changes));
  await putAway(b);
});

await test('conversations with the partner: new, open, copy, branch from an answer, rename, remove and Start over — each with its Undo where it takes something', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "had died", "why": "x"}]</changes>\nDarker now.' }, { text: 'Plans: she leaves.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Darker.' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'What next?' });
  let t = store.peek('talk', b.novelId);
  assert.equal(t.turns.length, 4);
  assert.equal(talk.partnerConversations(b.novelId).open.name, 'Conversation 1');
  /* New: this one stays in the list */
  assert.equal((await talk.newConversation(b.novelId)).name, 'Conversation 2');
  t = store.peek('talk', b.novelId);
  assert.equal(t.turns.length, 0);
  assert.deepEqual(talk.partnerConversations(b.novelId).others.map((x) => [x.name, x.n]), [['Conversation 1', 4]]);
  assert.equal((await talk.newConversation(b.novelId)).ok, false, 'an empty one is new already');
  /* talk in the second, then open the first again: the second waits in the list */
  await script([{ text: 'Second talk.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello again.' });
  const first = talk.partnerConversations(b.novelId).others[0];
  assert.equal((await talk.openConversation(b.novelId, first.id)).ok, true);
  t = store.peek('talk', b.novelId);
  assert.equal(t.name, 'Conversation 1');
  assert.equal(t.turns.length, 4);
  assert.deepEqual(talk.partnerConversations(b.novelId).others.map((x) => x.name), ['Conversation 2']);
  /* the partner is asked with the open conversation only */
  await reset();
  await script([{ text: 'Back in one.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And now?' });
  const msgs = (await requests())[0].body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  assert.ok(msgs.includes('What next?') && !msgs.includes('Hello again.'), 'only this conversation rides');
  /* Branch from here: up to the first answer, its change in the copy is the first one's to undo */
  t = store.peek('talk', b.novelId);
  const answer1 = t.turns[1];
  const br = await talk.copyConversation(b.novelId, answer1.id);
  assert.equal(br.name, 'Conversation 1 (branch)');
  t = store.peek('talk', b.novelId);
  assert.equal(t.turns.length, 2);
  const cv = picked(t.turns[1]);
  assert.equal(cv.changes[0].copied, true);
  const refused = talk.undoOneChange(b.novelId, t.turns[1].id, cv.id, cv.changes[0].id);
  assert.equal(refused.ok, false);
  assert.match(refused.said, /the conversation’s it was made in/);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp had died.', 'nothing undone from the copy');
  /* rename; a name another one has is refused */
  assert.equal((await talk.renameConversation(b.novelId, 'Endings')).ok, true);
  assert.equal(store.peek('talk', b.novelId).name, 'Endings');
  assert.equal((await talk.renameConversation(b.novelId, 'Conversation 2')).ok, false);
  /* Remove: the newest used of the others opens; Undo opens it again */
  const before = talk.partnerConversations(b.novelId);
  const rm = await talk.removeConversation(b.novelId);
  assert.equal(rm.name, 'Endings');
  assert.equal(talk.partnerConversations(b.novelId).open.name, before.others[0].name);
  assert.ok(!talk.partnerConversations(b.novelId).others.some((x) => x.name === 'Endings'));
  rm.undo();
  assert.equal(store.peek('talk', b.novelId).name, 'Endings');
  assert.equal(store.peek('talk', b.novelId).turns.length, 2);
  assert.equal(talk.partnerConversations(b.novelId).others.length, 2);
  /* Start over: its talk goes, the changes it made stay; Undo brings the talk back */
  await talk.openConversation(b.novelId, talk.partnerConversations(b.novelId).others.find((x) => x.name === 'Conversation 1').id);
  const so = await talk.startOver(b.novelId);
  assert.equal(store.peek('talk', b.novelId).turns.length, 0);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp had died.');
  so.undo();
  assert.equal(store.peek('talk', b.novelId).turns.length, 6);
  /* kept on the phone, every conversation */
  await store.flush('talk', b.novelId);
  const disk = await onPhone('talk', b.novelId);
  assert.deepEqual([disk.name, ...disk.convs.map((c) => c.name)].sort(), ['Conversation 1', 'Conversation 2', 'Endings']);
  /* search finds words in a conversation that is not open, and says which */
  const hits = search.searchBook({ novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, talk: store.peek('talk', b.novelId), query: 'Second talk' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].group, 'Partner — Conversation 2');
  assert.ok(hits[0].convId);
  /* nothing of it while a reply is on its way */
  await reset();
  await script([{ text: 'Slow words here.', delay: 0.1, chunk: 3 }]);
  const going = talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Slowly.' });
  await sleep(150);
  assert.equal((await talk.newConversation(b.novelId)).ok, false);
  assert.equal((await talk.openConversation(b.novelId, talk.partnerConversations(b.novelId).others[0].id)).ok, false);
  await going;
  await putAway(b);
});

await test('Edit and ask again lets go of his message and what came after, words back for the box, with Undo', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'One.' }, { text: 'Two.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'First question.' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Second question.' });
  const t = store.peek('talk', b.novelId);
  const out = await talk.editAndAskAgain(b.novelId, t.turns[2].id);
  assert.equal(out.ok, true);
  assert.equal(out.text, 'Second question.');
  assert.deepEqual(store.peek('talk', b.novelId).turns.map((x) => picked(x).text), ['First question.', 'One.']);
  out.undo();
  assert.deepEqual(store.peek('talk', b.novelId).turns.map((x) => picked(x).text), ['First question.', 'One.', 'Second question.', 'Two.']);
  /* Undo only while the conversation still ends where it was cut */
  const again = await talk.editAndAskAgain(b.novelId, store.peek('talk', b.novelId).turns[2].id);
  await script([{ text: 'Three.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Changed question.' });
  again.undo();
  assert.deepEqual(store.peek('talk', b.novelId).turns.map((x) => picked(x).text), ['First question.', 'One.', 'Changed question.', 'Three.']);
  assert.equal((await talk.editAndAskAgain(b.novelId, store.peek('talk', b.novelId).turns[1].id)).ok, false, 'only his own messages');
  await putAway(b);
});

await test('waiting changes: Edit by hand makes one with his words; Apply all, Leave all; Undo all puts back every one, newest first', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['The lamp was cold. The sea was grey.']]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mara', about: 'The keeper.' }), { now: true });
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "had died", "why": "a"}, {"note": "people", "name": "Mara", "about": "The keeper, tired.", "why": "b"}, {"passage": "1.1", "find": "was grey", "replace": "was black", "why": "c"}]</changes>\nThree.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Change things.' });
  let turn = store.peek('talk', b.novelId).turns.at(-1);
  let v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['waiting', 'waiting', 'waiting']);
  /* what can be edited is what the change writes */
  assert.deepEqual(changes.editableOf(v.changes[0].op).map((f) => f.key), ['replace']);
  assert.deepEqual(changes.editableOf(v.changes[1].op).map((f) => [f.key, f.value]), [['about', 'The keeper, tired.']]);
  assert.deepEqual(changes.editableOf({ rename: { from: 'A', to: 'B' } }).map((f) => [f.key, f.value]), [['to', 'B']]);
  const ed = talk.applyEdited(b.novelId, turn.id, v.id, v.changes[0].id, { replace: 'burned blue' });
  assert.equal(ed.ok, true);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp burned blue. The sea was grey.');
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].edited, true);
  assert.equal(v.changes[0].op.replace, 'burned blue', 'what was made is what is kept');
  /* Apply all: the rest */
  const all = talk.settleAll(b.novelId, turn.id, v.id, 'apply');
  assert.equal(all.done, 2);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp burned blue. The sea was black.');
  assert.equal(b.novel().notes.people[0].about, 'The keeper, tired.');
  /* Undo all: newest first, every one back */
  const back = talk.settleAll(b.novelId, turn.id, v.id, 'undo');
  assert.equal(back.done, 3, JSON.stringify(back));
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold. The sea was grey.');
  assert.equal(b.novel().notes.people[0].about, 'The keeper.');
  /* Leave all */
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "x", "why": "a"}, {"passage": "1.1", "find": "was grey", "replace": "y", "why": "b"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Again.' });
  turn = store.peek('talk', b.novelId).turns.at(-1);
  v = picked(turn);
  assert.equal(talk.settleAll(b.novelId, turn.id, v.id, 'skip').done, 2);
  assert.deepEqual(picked(store.peek('talk', b.novelId).turns.at(-1)).changes.map((c) => c.status), ['skipped', 'skipped']);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold. The sea was grey.');
  await setHouse();
  await putAway(b);
});

await test('set to wait, a change that cannot land is said at once — not when he presses Apply', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: '<changes>[{"passage": "1.1", "find": "NOT THERE", "replace": "x", "why": "a"}, {"passage": "1.1", "find": "was cold", "replace": "had died", "why": "b"}]</changes>\nTwo.' }, { text: 'Leaving that one.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Change it.' });
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['refused', 'waiting']);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold.', 'nothing lands before Apply');
  await setHouse();
  await putAway(b);
});

await test('the partner can ask where words stand, and read a module, before it answers', async () => {
  const b = await makeBook([['Mara lit the lamp.', 'The lamp guttered.'], ['Mara slept.']]);
  await script([{ text: '<read>["find: the lamp", "module: The sound of a voice"]</read>' }, { text: 'The lamp is in two places.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Where is the lamp?' });
  const r = await requests();
  assert.equal(r.length, 2);
  const back = r[1].body.messages.at(-1).content;
  assert.ok(back.includes('Where “the lamp” stands (2 places)') && back.includes('[1.1]') && back.includes('[1.2]'), back.slice(0, 500));
  assert.ok(back.includes('The module “The sound of a voice”'), 'the module comes back whole');
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
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn: { ...CONN, context: 8000, maxTokens: 500 }, target: { chapterId: b.ids[5] }, request: 'Go.' });
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
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn: { ...CONN, context: 9000, maxTokens: 500 }, target: { chapterId: b.ids[0] }, request: 'Go.' });
  assert.match(a.system, /more chapters? comes? after .*left out here to save room/);
  await putAway(b);
});

await test('the chapter being written, too long for the room, keeps its opening and the words right before the point', async () => {
  const filler = Array.from({ length: 400 }, (_, i) => `Line ${i} of a very long chapter.`).join(' ');
  const b = await makeBook([['THE OPENING LINE. ' + filler + ' THE LAST WORDS BEFORE.']]);
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: { ...CONN, context: 6000, maxTokens: 500 }, target: { chapterId: b.ids[0] }, request: 'Go.' });
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
  await setHouse({}, CRAFTS_OFF);
  await script([{ status: 400, message: "This model's maximum context length is 4000 tokens. However, your messages resulted in 9000 tokens." }, { text: 'It fits now.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[3] });
  assert.equal(out.ok, true);
  const r = await requests();
  assert.equal(r.length, 2);
  const size = (x) => JSON.stringify(x.body.messages).length;
  assert.ok(size(r[1]) < size(r[0]) * 0.8, `${size(r[0])} -> ${size(r[1])}`);
  assert.ok(out.notes.some((n) => /fitted to/.test(n)), out.notes.join(' | '));
  await setHouse();
  await putAway(b);
});

await test('a model too small for his instructions and the modules is told so in plain words — once it said its size, nothing more is sent', async () => {
  const b = await makeBook([['Now.']]);
  /* the crafts ride (the default): about 17,000 tokens before any of the book */
  await script([{ status: 400, message: "This model's maximum context length is 8000 tokens. However, your messages resulted in 19000 tokens." }, { text: 'Never asked.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  assert.equal(out.ok, false);
  assert.equal((await requests()).length, 1, 'the one the model refused, and no other');
  /* the model's own number, what takes it, and the ways out */
  assert.match(out.error, /^this model holds about 8,000 tokens, but your instructions with the modules for the writer \(about ([\d,]+)\) and the room for its answer \(about 4,000\) need about ([\d,]+) before any of the book/);
  const [, mine, need] = out.error.match(/\(about ([\d,]+)\) and .* need about ([\d,]+)/).map((x) => x && Number(String(x).replace(/,/g, '')));
  assert.equal(need, mine + 4000, 'the parts add up to what it says they need');
  assert.match(out.error, /give the writer a model with more room \(Settings → Who does what → The writer\), or switch off a module the writer reads \(Settings → Your instructions → Modules\)$/);
  assert.equal(b.ch().passages.length, 1, 'no empty passage is left on the page');
  /* a room he set himself is believed at once: nothing is sent at all */
  await reset();
  await setHouse({ context: 8000 });
  const again = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  assert.equal(again.ok, false);
  assert.equal((await requests()).length, 0);
  /* with the crafts off, the same small room writes the page */
  await setHouse({ context: 8000 }, CRAFTS_OFF);
  await script([{ text: 'She waited.' }]);
  const fine = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  assert.equal(fine.ok, true, fine.error);
  await setHouse();
  await putAway(b);
});

await test('too small, said for what really takes the room: his Longest reply first when it tips it; a partner with no modules is not told to switch one off; a scene\'s narrator is the writer\'s connection', async () => {
  const b = await makeBook([['Now.']]);
  const hs = store.peek('house', 'house');
  const build = (conn, purpose, house = hs) => context.assemble({ house, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn, purpose, target: { chapterId: b.ids[0] }, play: { who: 'Mara' }, request: 'Go.' });
  /* the instructions fit his 32,000; with his Longest reply of 16,000 on top they do not */
  const tips = build({ ...CONN, context: 32000, maxTokens: 16000 }, 'write');
  assert.match(tips.refuse, /^this model holds about 32,000 tokens, but your instructions with the modules for the writer \(about [\d,]+\) and the room for its answer \(about 16,000, your Longest reply\) need about [\d,]+ before any of the book — lower Longest reply on its connection \(Settings → Connections\), give the writer a model/);
  assert.equal(build({ ...CONN, context: 32000, maxTokens: 4000 }, 'write').refuse, '', 'a smaller Longest reply fits');
  /* a thinking model's room to think is named as that — lowering Longest reply would not help */
  const thinks = build({ ...CONN, context: 32000, maxTokens: 4000, thinking: 'high' }, 'write');
  assert.match(thinks.refuse, /the room for its answer \(about 16,000, with its thinking\)/, thinks.refuse);
  assert.ok(!thinks.refuse.includes('Longest reply'), thinks.refuse);
  /* his instructions alone are more than it holds: lowering Longest reply is not offered */
  const huge = build({ ...CONN, context: 16000, maxTokens: 3000 }, 'write');
  assert.ok(huge.refuse && !huge.refuse.includes('Longest reply on its connection'), huge.refuse);
  /* the partner reads no module of the app's: none to switch off */
  const partner = build({ ...CONN, context: 1600 }, 'partner');
  assert.match(partner.refuse, /your instructions for your partner \(about [\d,]+\) and the room for its answer/);
  assert.match(partner.refuse, /give your partner a model with more room \(Settings → Who does what → The partner\)$/);
  assert.ok(!partner.refuse.includes('module'), partner.refuse);
  /* a module of his that rides for the partner: that one can be switched off */
  const withMine = { ...hs, modules: { 'm-p': { custom: true, at: 1, name: 'Mine', text: 'MY PARTNER RULES. '.repeat(40), to: ['partner'], rides: 'always' } } };
  assert.match(build({ ...CONN, context: 1600 }, 'partner', withMine).refuse, /your instructions with the modules for your partner .* or switch off a module your partner reads/);
  /* a scene: the narrator, told by the writer's connection */
  assert.match(build({ ...CONN, context: 8000 }, 'play').refuse, /for the narrator \(about [\d,]+\).*give the writer, who tells your scenes, a model with more room \(Settings → Who does what → The writer\), or switch off a module the narrator reads/);
  /* a long talk is named when it is what takes the room */
  const talkBig = context.assemble({ house: { ...hs, ...CRAFTS_OFF }, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: { ...CONN, context: 6000 }, purpose: 'partner', target: { chapterId: b.ids[0] },
    turns: [{ role: 'user', content: 'Read this. ' + 'A long pasted page of words. '.repeat(700) }], request: '' });
  assert.match(talkBig.refuse, /, the talk so far \(about [\d,]+\) and the room for its answer .* or send a shorter message, or Start over$/);
  await putAway(b);
});

await test('"too long" at the size the model says it holds: the book is fitted smaller and sent, never refused with a number of the app\'s own guessing', async () => {
  const para = 'The storm came in off the water like a held breath let go. '.repeat(60);
  const b = await makeBook([[para], [para], [para], [para], [para], [para], [para], [para], [para], [para], ['Now.']]);
  /* the crafts ride: the instructions alone are most of 32,768 */
  await setHouse({ context: 32768 });
  await script([{ status: 400, message: "This model's maximum context length is 32768 tokens. However, your messages resulted in 33500 tokens." }, { text: 'It fits now.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[10], direction: 'She waits.' });
  assert.equal(out.ok, true, out.error);
  const r = await requests();
  assert.equal(r.length, 2);
  const size = (x) => JSON.stringify(x.body.messages).length;
  assert.ok(size(r[1]) < size(r[0]), `${size(r[0])} -> ${size(r[1])}`);
  const sys = r[1].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sys.includes(modules.builtinOf('novel-craft').text), 'his instructions and the craft went whole');
  const learned = store.peek('house', 'house').connections[0].learned.context;
  assert.ok(learned < 32768 && learned > 24576, `fitted to ${learned}: never below what has to go`);
  /* and the next page fits from the start */
  await reset();
  await script([{ text: 'Again.' }, { text: 'A long one.' }]);
  const next = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[10], direction: 'She waits.' });
  assert.equal(next.ok, true, next.error);
  assert.equal((await requests()).length, 1);
  /* a longer page needs more answer room than that guess leaves: it is sent, never refused for a number of the app's own guessing */
  const longer = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[10], direction: 'She waits.', length: 'chapter' });
  assert.equal(longer.ok, true, longer.error);
  assert.equal((await requests()).length, 2);
  await setHouse();
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
  /* what is checked: the passages under "Check these passages" — the story before them rides as context */
  const checked = (m) => m.slice(m.indexOf('Check these passages from'));
  let ask = checked(r[0].body.messages.at(-1).content);
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
  ask = checked(r[0].body.messages.at(-1).content);
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

await test('the judge holds each passage to ten checks: its grade the number passed, each failed check named with its words as they stand; under his mark, behind the bubble with what would lift it; off, nothing is judged', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 8.5 } });
  const b = await makeBook([['Mara kept the light.', 'The sea was grey and the sea was grey. He gave her a look that meant he was sorry. And she knew, at last, that she was home.', 'Gulls wheeled. The tide went out.']]);
  const yes = Object.fromEntries(prompts.JUDGE_CHECKS.map(([k]) => [k, 'yes']));
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.2', kind: 'craft', find: 'and the sea was grey', replace: 'and colder than it looked', why: 'said once' }], grades: [
    { passage: '1.1', checks: yes, faults: [] },
    { passage: '1.2', checks: { ...yes, shown: 'no', people: 'No.', ending: false }, faults: [
      { check: 'shown', words: '“a look that MEANT he was sorry”', why: 'says what the look meant' },
      { check: 'Ending', words: 'And she knew, at last … that she was home.', why: 'closes on what it meant' },
      { check: 'people', words: 'words that are not there', why: 'nobody wants anything' }], lift: 'Let the look stand; end on what Mara does.' },
    /* no lift given: what would lift it is said from what it fails */
    { passage: '1.3', faults: [{ check: 'moves', words: 'The tide went out.', why: 'nothing changes' }, { check: 'specific', words: 'Gulls wheeled.', why: 'any shore' }] }] }) }]);
  await checker.runCheck(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('Then judge each passage’s craft') && ask.includes('A passage with more than one “no” is under my mark of 8.5'), 'his mark, as checks');
  for (const [k] of prompts.JUDGE_CHECKS) assert.ok(ask.includes(`\n- ${k}: `), k);
  const s = checker.suggestions(b.novelId);
  const grades = s.filter((x) => x.item.kind === 'grade');
  assert.deepEqual(grades.map((x) => [x.number, x.item.grade.overall]), [[2, 7], [3, 8]], 'ten checks: three failed, two failed; the one that passed all is not offered');
  const two = grades[0].item;
  assert.deepEqual(two.grade.faults.map((f) => [f.check, f.words || '']), [['shown', 'a look that meant he was sorry'], ['people', ''], ['ending', 'And she knew, at last']],
    'in the order of the checks; the words as they stand in the passage, a part of them when they were cut, none when they are not there — and still failed');
  assert.equal(two.lift, 'Let the look stand; end on what Mara does.');
  assert.equal(grades[1].item.lift, 'Fix what falls short — specific: any shore; moves: nothing changes.', 'faults alone are a grade, and say what would lift it');
  assert.ok(s.some((x) => x.item.kind === 'craft'), 'its fixes that lift it');
  const g = checker.gradesOf(b.novelId);
  assert.equal(g.rows.length, 3);
  assert.deepEqual(g.models.map((m) => [m.model, m.n, m.average]), [['your own words', 3, 8.3]]);
  assert.deepEqual(g.fails.map((f) => [f.name, f.n]), [['Shown', 1], ['Specific', 1], ['People', 1], ['Moves', 1], ['Ending', 1]]);
  /* Apply all puts in the fixes and leaves the grades to him */
  assert.equal(checker.applyAll(b.novelId), 1);
  /* off: nothing judged */
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  await reset();
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'One more.' });
  await script([{ text: '{"edits": []}' }]);
  await checker.runCheck(b.novelId);
  assert.ok(!(await requests())[0].body.messages.at(-1).content.includes('Then judge each passage'));
  await setHouse();
  await putAway(b);
});

await test('a grade from before the ten checks still shows its card, but is not averaged with grades by the checks', async () => {
  const b = await makeBook([['Mara kept the light.']]);
  const p = b.ch().passages[0];
  const v = picked(p);
  const old = { overall: 5.5, prose: 5, people: 6, continuity: 7, pacing: 5, pull: 4, why: 'Flat.', model: '' };
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p.id, v.id, { round: 'ck-old', sig: util.hashText(v.text), at: Date.now(), grade: old,
    items: [{ id: 'sg-old', kind: 'grade', find: '', replace: null, why: 'Flat.', lift: 'Give it a turn.', target: 9, grade: old }] }), { now: true });
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => [x.item.kind, x.item.grade.overall]), [['grade', 5.5]], 'its card stays');
  assert.equal(checker.gradesOf(b.novelId).rows.length, 0, 'one number on another scale is not averaged with checks passed');
  await putAway(b);
});

await test('stock wording is counted, in the narration only — the phrases machine-made fiction leans on, never the ones people use as much', () => {
  const T = '“Her voice was barely above a whisper,” he said. She answered, her voice barely above a whisper. It wasn’t fear. It was relief. She took a deep breath and took a step back. Her heart skipped a beat; then her heart hammered against her ribs.';
  const hits = stock.stockIn(T);
  assert.deepEqual(hits.map((h) => h.words), ['voice barely above a whisper', 'It wasn’t fear. It was', 'heart hammered against her ribs'], 'not what he said in quotes; not “took a deep breath”, “took a step back” or “skipped a beat”');
  for (const h of hits) assert.equal(T.slice(h.start, h.end), h.words, 'at its place in the text');
  for (const t of ['He did not answer, but she knew.', 'The trees cast long shadows.', 'It wasn’t until dawn that she slept. It was cold.', 'Not that it mattered, but she asked.', 'He had a strange sense of humour.', 'The smell hung in the air.']) assert.deepEqual(stock.stockIn(t), [], t);
  assert.deepEqual(stock.stockRate('The air was thick with smoke. ' + 'word '.repeat(94)), { hits: 1, words: 100, per1000: 10 });
});

await test('stock wording counted in a passage goes to the checker to be said another way; what no fix takes away is offered to be written again, never again once left; and "fresh" fails on it whatever the judge said', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Mara climbed the stair, her voice barely above a whisper. The lamp was cold, and her heart hammered against her ribs.']]);
  const yes = Object.fromEntries(prompts.JUDGE_CHECKS.map(([k]) => [k, 'yes']));
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'humanize', find: 'her voice barely above a whisper', replace: 'saying nothing', why: 'stock' }], grades: [{ passage: '1.1', checks: yes, faults: [] }] }) }]);
  await checker.runCheck(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('Stock wording counted in these passages') && ask.includes('[1.1] “voice barely above a whisper”, “heart hammered against her ribs”'), ask.slice(ask.indexOf('Stock wording'), ask.indexOf('Stock wording') + 260));
  let s = checker.suggestions(b.novelId);
  assert.deepEqual(s.map((x) => [x.item.kind, x.item.find, x.item.replace, Boolean(x.item.stock)]), [
    ['humanize', 'her voice barely above a whisper', 'saying nothing', false],
    ['humanize', 'The lamp was cold, and her heart hammered against her ribs.', null, true],
  ], 'its own fix for the first; the sentence of the second, to write again');
  assert.equal(s[1].item.why, '“heart hammered against her ribs” is stock wording — far more common in machine-made fiction than in books people write');
  const g = checker.gradesOf(b.novelId);
  assert.equal(g.rows[0].overall, 9, 'every check said yes — but stock wording stands in it');
  assert.deepEqual(g.rows[0].faults.map((f) => [f.check, f.words, Boolean(f.counted)]), [['fresh', 'voice barely above a whisper', true]]);
  assert.equal(g.models[0].stock, 2, 'counted for the benchmark too');
  checker.leaveOne(s[1].chapterId, s[1].passageId, s[1].item.id);
  const pid = b.ch().passages[0].id;
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'Mara climbed the stair. The lamp was cold, and her heart hammered against her ribs.' });
  await script([{ text: '{"edits": []}' }]);
  await checker.runCheck(b.novelId);
  s = checker.suggestions(b.novelId);
  assert.deepEqual(s.map((x) => x.item.find), [], 'a sentence he left as it is is not offered again');
  await setHouse();
  await putAway(b);
});

await test('the first passage of a chapter is checked with the end of the chapter before, for the seam', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['The storm broke over Crane Point.'], ['Morning came grey and still.']]);
  await checker.runCheck(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content);
  assert.equal(asks.length, 2, 'a checking for each chapter');
  assert.ok(!asks[0].includes('The end of the chapter before'), 'the book’s first page has nothing before it');
  assert.ok(asks[1].includes('The end of the chapter before, for where Chapter Two picks up:\n"""\nThe storm broke over Crane Point.\n"""'), asks[1].slice(0, 400));
  await setHouse();
  await putAway(b);
});

await test('two versions of one passage by two writers for the same moment are read head to head — blind, both ways round, a win only when both agree; one carried on by another writer is not; the pair goes when a version goes', async () => {
  await setHouse({}, { checksFrom: 0 });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'Mara lit the lamp.', model: 'writer-a', how: 'write', ask }]]);
  const pid = b.ch().passages[0].id;
  const take = (text, model, extra = {}) => store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text, model, how: 'another', ask: { ...ask }, ...extra })), { now: true });
  take('Mara looked at the lamp for a long time.', 'writer-b');
  /* the first reading says page B (writer-a's, shown second); the second, swapped, says page A — writer-a's again */
  await script([{ text: '{"edits": []}' }, { text: JSON.stringify({ better: 'B', why: 'it acts' }) }, { text: JSON.stringify({ better: 'A', why: 'it acts' }) }]);
  await checker.runCheck(b.novelId);
  let duels = (await requests()).map((x) => x.body.messages.at(-1).content).filter((c) => c.includes('Which is the better page'));
  assert.equal(duels.length, 2, 'asked twice');
  assert.ok(!duels.join('').includes('writer-a') && !duels.join('').includes('writer-b'), 'blind: no writer named');
  const at = (c, t) => c.indexOf(t);
  assert.ok(at(duels[0], 'Mara looked at the lamp') < at(duels[0], 'Mara lit the lamp.') && at(duels[1], 'Mara lit the lamp.') < at(duels[1], 'Mara looked at the lamp'), 'both ways round');
  assert.ok(duels[0].includes('What I asked for here:\n"""\nShe lights it.\n"""'), 'what he asked for that moment');
  let g = checker.gradesOf(b.novelId);
  const rec = (m) => { const r = g.models.find((x) => x.model === m) || {}; return [r.win, r.loss, r.tie]; };
  assert.deepEqual([rec('writer-a'), rec('writer-b'), g.duels], [[1, 0, 0], [0, 1, 0], 1]);
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'a pair is read once');
  /* a third writer: the readings disagree — even */
  take('Mara lit the lamp and waited.', 'writer-c');
  await script([{ text: '{"edits": []}' }, { text: JSON.stringify({ better: 'A', why: 'x' }) }, { text: JSON.stringify({ better: 'A', why: 'y' }) }, { text: JSON.stringify({ better: 'A', why: 'x' }) }, { text: JSON.stringify({ better: 'A', why: 'y' }) }]);
  await checker.runCheck(b.novelId);
  duels = (await requests()).map((x) => x.body.messages.at(-1).content).filter((c) => c.includes('Which is the better page'));
  assert.equal(duels.length, 4, 'the new one against each other writer’s newest');
  g = checker.gradesOf(b.novelId);
  assert.deepEqual([rec('writer-c'), g.duels], [[0, 0, 2], 3], 'a judge that only ever says “A” wins nothing');
  /* carried on by another writer: not one writer's words */
  await reset();
  take('Mara lit the lamp, then the stove.', 'writer-d', { carried: true });
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).filter((x) => x.body.messages.at(-1).content.includes('Which is the better page')).length, 0);
  /* a version taken out: its pairs go with it */
  const a = b.ch().passages[0].versions.find((v) => v.model === 'writer-a');
  store.change('chapter', b.ids[0], shape.chapterSteps.removeVersion(pid, a.id), { now: true });
  await checker.runCheck(b.novelId);
  assert.deepEqual(Object.values(b.ch().duels || {}).map((d) => [d.xModel, d.yModel].sort().join(' v ')), ['writer-b v writer-c'], 'only the pair whose versions are both there');
  await setHouse();
  await putAway(b);
});

await test('takes written before the judge began reading them head to head are never sent unasked', async () => {
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'Mara lit the lamp.', model: 'writer-a', how: 'write', ask }]]);
  const pid = b.ch().passages[0].id;
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text: 'Mara looked at the lamp.', model: 'writer-b', how: 'another', ask: { ...ask } })), { now: true });
  await setHouse({}, { checksFrom: 0, duelsFrom: Date.now() + 60000 });
  assert.equal(checker.duelsDue(b.novelId).length, 0, 'both takes from before');
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).filter((x) => x.body.messages.at(-1).content.includes('Which is the better page')).length, 0, 'not asked');
  await setHouse({}, { checksFrom: 0, duelsFrom: Date.now() - 60000 });
  assert.equal(checker.duelsDue(b.novelId).length, 1, 'written since: read');
  await setHouse();
  await putAway(b);
});

await test('Apply the checker’s fixes by themselves: a writer’s passage gets its fixes as one new version; his own words, sentences to write again and writing from before it was switched on stay behind the bubble', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 }, ...HIS({ avoid: 'tar' }) });
  const b = await makeBook([['Mara climbed the the stair.', 'The sea was grey and and cold. It smelled of tar.', { text: 'Old words here alot.', at: Date.now() - 100000 }]]);
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own words alot.' });
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' },
    { passage: '1.2', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' },
    { passage: '1.3', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'two words' },
    { passage: '1.4', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'two words' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const ps = b.ch().passages;
  assert.deepEqual(ps.map((p) => [picked(p).text, picked(p).how]), [
    ['Mara climbed the stair.', 'suggested'],
    ['The sea was grey and cold. It smelled of tar.', 'suggested'],
    ['Old words here alot.', 'write'],
    ['My own words alot.', 'mine'],
  ], 'the writer’s new passages fixed by themselves; the old one and his own words as they were');
  assert.equal(ps[0].versions.length, 2, 'the words before one arrow away');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => [x.number, x.item.kind, x.item.replace]), [[2, 'avoid', null], [3, 'grammar', 'a lot'], [4, 'grammar', 'a lot']], 'what is his to decide stays behind the bubble');
  await setHouse();
  await putAway(b);
});

/* a grade answer: the first n checks failed, with what would lift it */
const failing = (n, lift = 'Make it move.') => {
  const checks = Object.fromEntries(prompts.JUDGE_CHECKS.map(([k], i) => [k, i < n ? 'no' : 'yes']));
  return { passage: '1.1', checks, faults: prompts.JUDGE_CHECKS.slice(0, n).map(([k]) => ({ check: k, words: '', why: 'falls short' })), lift };
};

await test('Write a passage under his mark again by itself: toward the mark with what the judge said, twice at most, its fixes waiting; then the best-graded stays on show, once', async () => {
  const on = { on: true, from: Date.now() - 1000 };
  await setHouse({}, { checksFrom: 0, judge: { target: 9 }, autoLift: on, autoFix: on });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'Mara lit the lamp and and waited.', model: 'scripted', how: 'write', ask }]]);
  const p = () => b.ch().passages[0];
  const rewrites = async () => (await requests()).filter((x) => x.body.messages.at(-1).content.includes('Make it move.') || x.body.messages.at(-1).content.includes('Closer still.'));
  /* graded 7: written again — the fix for the words it replaces waits */
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' }], grades: [failing(3)] }) }, { text: 'Mara lit the lamp. The wick caught.' }]);
  await checker.runCheck(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  assert.equal((await rewrites()).length, 1, 'written again, with what the judge said it needs');
  assert.deepEqual(p().versions.map((v) => [v.text, v.lift || 0]), [['Mara lit the lamp and and waited.', 0], ['Mara lit the lamp. The wick caught.', 1]], 'its fix was not put in: the words it was for are written again');
  assert.equal(picked(p()).lift, 1);
  /* the first try graded 8: once more */
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(2, 'Closer still.')] }) }, { text: 'Mara lit the lamp. The wick caught, and the room was hers.' }]);
  await checker.runCheck(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  assert.deepEqual(p().versions.map((v) => v.lift || 0), [0, 1, 2]);
  /* the second try graded 6: no third — the best (the first try, 8) stays on show */
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(4)] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'never a third');
  assert.equal(picked(p()).text, 'Mara lit the lamp. The wick caught.', 'the best-graded of the tries');
  assert.ok(p().versions.find((v) => v.lift === 2).settled);
  /* a version he picks afterwards is his: never put back */
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p().id, p().versions[2].id), { now: true });
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal(picked(p()).lift, 2, 'his pick stands');
  assert.equal((await requests()).length, 0, 'nothing more is asked');
  await setHouse();
  await putAway(b);
});

await test('never written again by itself: his own words, a grade he left, writing from before it was switched on; and anything he asks the writer meanwhile goes first — the app’s page taken away whole', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 9 } });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'A writer’s page.', model: 'scripted', how: 'write', ask }, { text: 'An old page.', model: 'scripted', how: 'write', ask, at: Date.now() - 100000 }]]);
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own page.' });
  await script([{ text: JSON.stringify({ edits: [], grades: [{ ...failing(3), passage: '1.1' }, { ...failing(3), passage: '1.2' }, { ...failing(3), passage: '1.3' }] }) }]);
  await checker.runCheck(b.novelId);
  const card = checker.suggestions(b.novelId).find((x) => x.number === 1 && x.item.kind === 'grade');
  checker.leaveOne(card.chapterId, card.passageId, card.item.id);
  await setHouse({}, { checksFrom: 0, judge: { target: 9 }, autoLift: { on: true, from: Date.now() - 50000 } });
  await reset();
  checker.forTests().autoAfter(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'none of the three');
  assert.equal((await requests()).length, 0);
  /* a lift on its way when he asks the writer for something: his goes first */
  const b2 = await makeBook([[{ text: 'Another writer’s page.', model: 'scripted', how: 'write', ask }]]);
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(3)] }) }, { text: 'A slow page written again, word after word after word after word.', delay: 0.15, chunk: 3 }]);
  await checker.runCheck(b2.novelId);
  for (let i = 0; i < 100 && !writer.autoBusy(b2.novelId); i++) await sleep(10);
  assert.ok(writer.autoBusy(b2.novelId), 'the app is writing it again');
  const lift = checker.forTests().lifting.get(b2.novelId);
  await writer.yieldAuto(b2.novelId);
  const out = await lift;
  assert.ok(out && out.yielded, JSON.stringify(out));
  const q = b2.ch().passages[0];
  assert.deepEqual([q.versions.length, picked(q).text, writer.busy(b2.novelId)], [1, 'Another writer’s page.', false], 'taken away whole, the page it lifted from on show, the writer free');
  await setHouse();
  await putAway(b);
  await putAway(b2);
});

await test('the checker and the judge speak in words that never name a machine', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const house = store.peek('house', 'house');
  const words = [
    prompts.checkerFrame(house, b.novel()),
    prompts.checkRequest({ novel: b.novel(), chapterLabel: 'Chapter One', numbered: '[1.1] Words.', avoid: ['tar'], before: 'Before.', beforeFrom: 'last', judge: { target: 9 }, stock: { '1.1': ['a testament to'] } }),
    prompts.duelRequest({ novel: b.novel(), chapterLabel: 'Chapter One', before: 'Before.', asked: 'She lights it.', first: 'Page one.', second: 'Page two.', cut: true }),
  ].join('\n\n');
  const hit = words.match(MACHINE);
  assert.equal(hit, null, `"${hit && hit[0]}" in "${hit && words.slice(Math.max(0, hit.index - 80), hit.index + 40)}"`);
  await putAway(b);
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
  /* (the judge off: its grading takes room of its own — this is about the parts) */
  await setHouse({ context: 6000 }, { checksFrom: 0, judge: { on: false } });
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
  /* the checked passages: under "Check these passages" (the story before them rides as context) */
  assert.ok(asks.some((a) => { const c = a.slice(a.indexOf('Check these passages from')); return c.includes('[1.2] A short one.') && !c.includes('Paragraph'); }), 'the next passage in a checking of its own');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.replace).sort(), ['Paragraph twenty goes', 'Paragraph two goes']);
  assert.equal(checker.waiting(b.novelId), 0);
  await setHouse({ context: 4000 }, { checksFrom: 0, judge: { on: false } });
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

/* =================================================== the crafts and modules */
heading('the crafts and modules, who decides how it turns out, how it sounds');

const systemOf = (r) => r.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
const askOf = (r) => r.body.messages.at(-1).content;

await test('the writer reads the novel craft right after his own words, in the part that stays the same; the narrator reads the scene craft; the partner neither', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  await script([{ text: 'A page.' }, { text: 'The gate creaks.' }, { text: 'An answer.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She lights the lamp.' });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await talk.playSay({ playId: id, text: '' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thoughts?' });
  const [w, p, t] = (await requests()).map(systemOf);
  const novelCraft = modules.builtinOf('novel-craft').text;
  const sceneCraft = modules.builtinOf('scene-craft').text;
  assert.ok(w.startsWith(`HIS OWN WORDS FIRST\n\n${novelCraft}`), w.slice(0, 160));
  assert.ok(!w.includes(sceneCraft.slice(0, 300)), 'not the scene craft');
  assert.ok(p.startsWith(`${prompts.DEFAULT_NARRATOR}\n\n${sceneCraft}`), p.slice(0, 160));
  assert.ok(!p.includes(novelCraft.slice(0, 300)), 'not the novel craft');
  assert.ok(w.includes('## The Sound Law') && p.includes('## The Sound Law') && !t.includes('## The Sound Law'), 'the sound law for the two who tell it');
  assert.ok(!t.includes('## The Telling'), 'the partner reads neither craft');
  /* Claude keeps the part with his words and the craft ready */
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Go.' });
  const { body } = providers.buildRequest({ url: 'https://api.anthropic.com/v1', model: 'claude-x', key: 'k' }, { system: a.system, systemParts: a.systemParts, messages: a.messages, maxTokens: 2000 });
  assert.ok(body.system[0].text.includes(novelCraft) && body.system[0].cache_control, 'the craft is in the kept part');
  assert.deepEqual(a.stats.modules, ['The novel craft', 'The sound of a voice']);
  await putAway(b);
});

await test('a rule wakes from his own words only — what he asks for, the premise he is carrying on, a passage of his, his moves — never from the prose; nearer the page, never in the kept part', async () => {
  const FIGHT = '## How A Fight Sounds';
  const HEAT = '## When The Scene Turns Intimate';
  const woke = (sys) => ({ fight: sys.includes(FIGHT), heat: sys.includes(HEAT) });
  const b = await makeBook([['Mara climbed to the lamp.']]);
  await script([{ text: 'Quiet.' }, { text: 'Steel.' }, { text: 'Heat.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She lights the lamp.' });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Jovan fights Kenjaku.' });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'They make love by the fire.' });
  const [quiet, fight, heat] = (await requests()).map(systemOf);
  assert.deepEqual(woke(quiet), { fight: false, heat: false }, 'a quiet premise wakes nothing');
  assert.ok(fight.includes(FIGHT) && !fight.includes(HEAT), 'a fight in his words');
  assert.ok(!fight.includes("## When Words Won't Carry It"), 'the contest\'s board is the narrator\'s; the writer\'s is in its craft');
  assert.ok(heat.includes(HEAT) && heat.includes('## How It Sounds') && heat.indexOf('## How It Sounds') > heat.indexOf(HEAT), 'intimacy: the rule, then how it sounds');
  /* the writer's prose never wakes one — however it reads */
  const b2 = await makeBook([['Kenjaku lunged, and Yuki parried the blow. He shot him a look and cocked his head; the cat curled up between her legs.']]);
  await reset();
  await script([{ text: 'More.' }]);
  await writer.writeNext({ novelId: b2.novelId, chapterId: b2.ids[0] });
  assert.deepEqual(woke(systemOf((await requests())[0])), { fight: false, heat: false }, 'the page is not his words');
  /* asking for nothing new, the premise he is still carrying on: through every page written from it, until a scene break */
  const b3 = await makeBook([['Mara climbed to the lamp.', { text: 'Steel rang on steel.', ask: { direction: 'Jovan fights Kenjaku.', length: 'scene' } }]]);
  await reset();
  await script([{ text: 'More steel.' }, { text: 'And more.' }, { text: 'A new morning.' }, { text: 'Rewritten.' }, { text: 'Taken again.' }]);
  await writer.writeNext({ novelId: b3.novelId, chapterId: b3.ids[0] });
  await writer.writeNext({ novelId: b3.novelId, chapterId: b3.ids[0] });
  writer.addBreak({ chapterId: b3.ids[0] });
  await writer.writeNext({ novelId: b3.novelId, chapterId: b3.ids[0] });
  const fought = b3.ch().passages[1].id;
  /* a rewrite of the fight with a quiet note is still the fight; Another take of a page carried on from it too */
  await writer.rewrite({ novelId: b3.novelId, chapterId: b3.ids[0], passageId: fought, note: 'He never says a word.' });
  await writer.anotherTake({ novelId: b3.novelId, chapterId: b3.ids[0], passageId: b3.ch().passages[2].id });
  const [on1, on2, after, rewritten, again] = (await requests()).map(systemOf).map(woke);
  assert.ok(on1.fight && on2.fight, 'carried on from his premise, page after page');
  assert.ok(!after.fight, 'a scene break begins a new scene');
  assert.ok(rewritten.fight && again.fight, 'a rewrite and another take of the fight');
  /* a passage of his own is his words; one brought in from a file is his book, not words for this moment */
  const b4 = await makeBook([['A quiet start.']]);
  writer.addMine({ novelId: b4.novelId, chapterId: b4.ids[0], text: 'She straddled him.' });
  await reset();
  await script([{ text: 'Then.' }, { text: 'Later.' }, { text: 'Rewritten, with the fight.' }, { text: 'After the fight.' }]);
  await writer.writeNext({ novelId: b4.novelId, chapterId: b4.ids[0] });
  store.change('chapter', b4.ids[0], shape.chapterSteps.addPassage(shape.newPassage('you', 'He cocked the pistol and drew his sword; she straddled the wall.', { how: 'imported' })), { now: true });
  await writer.writeNext({ novelId: b4.novelId, chapterId: b4.ids[0] });
  /* — but the note he gives it in a rewrite is his: for the rewrite, and for the pages carried on after it */
  const brought4 = b4.ch().passages.at(-2);
  assert.equal(picked(brought4).how, 'imported');
  await writer.rewrite({ novelId: b4.novelId, chapterId: b4.ids[0], passageId: brought4.id, note: 'Jovan fights Kenjaku.' });
  await writer.writeNext({ novelId: b4.novelId, chapterId: b4.ids[0] });
  const [mine, brought, broughtRewrite, broughtAfter] = (await requests()).map(systemOf).map(woke);
  assert.ok(mine.heat, 'his own passage');
  assert.deepEqual(brought, { fight: false, heat: false }, 'a passage brought in from a file is not read for it');
  assert.deepEqual(broughtRewrite, { fight: true, heat: false }, 'his note in a rewrite of it is his words');
  assert.deepEqual(broughtAfter, { fight: true, heat: false }, 'and is carried on, as a premise is');
  /* a direction rides with what he carries on; a rewrite of a passage of his reads his words in it, and no further back */
  const b5 = await makeBook([[{ text: 'Morning.', ask: { direction: 'They make love by the fire.', length: 'scene' } }, 'Later.']]);
  writer.addMine({ novelId: b5.novelId, chapterId: b5.ids[0], text: 'Jovan draws his sword and attacks Kenjaku.' });
  await reset();
  await script([{ text: 'Slowly.' }, { text: 'More vivid.' }]);
  await writer.writeNext({ novelId: b5.novelId, chapterId: b5.ids[0], direction: 'Go slowly.' });
  const his = b5.ch().passages.find((x) => x.by === 'you').id;
  await writer.rewrite({ novelId: b5.novelId, chapterId: b5.ids[0], passageId: his, note: 'more vivid' });
  const [carried, ownRewrite] = (await requests()).map(systemOf).map(woke);
  assert.ok(carried.fight && !carried.heat, 'his direction, with his passage right before it');
  assert.ok(ownRewrite.fight && !ownRewrite.heat, 'his own words in the passage he rewrites — never a premise further back');
  /* where it rides: in the part that moves, before the notes and the chapter */
  store.change('novel', b2.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'NOTED PERSON', about: 'x' })), { now: true });
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b2.novel(), chapters: { [b2.ids[0]]: b2.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b2.ids[0] }, request: 'Go.', moment: 'Jovan fights Kenjaku.' });
  assert.ok(!a.systemParts[0].includes(FIGHT), 'never in the kept part');
  assert.ok(a.systemParts[1].startsWith(FIGHT) && a.systemParts[1].indexOf('NOTED PERSON') > 0, 'woken rules, then the notes');
  /* the book as his notes: still the system's, as its last part */
  const a2 = context.assemble({ house: { ...store.peek('house', 'house'), notesAs: 'user' }, novel: b2.novel(), chapters: { [b2.ids[0]]: b2.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b2.ids[0] }, request: 'Go.', moment: 'Jovan fights Kenjaku.' });
  assert.equal(a2.systemParts.length, 2);
  assert.ok(a2.systemParts[1].startsWith(FIGHT) && a2.system.endsWith(a2.systemParts[1]));
  assert.ok(!a2.messages.some((m) => m.role !== 'system' && m.content.includes(FIGHT)), 'a rule never rides as his words');
  /* a scene: his move wakes the narrator's board and how a fight sounds; the narrator's telling never does */
  /* where he said a scene starts is his first word in it */
  const duel = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Jovan', from: 'A duel on the bridge at dawn.' });
  await reset();
  await script([{ text: 'Mist on the bridge.' }, { text: 'He waits too.' }, { text: 'The wind.' }, { text: 'Still.' }, { text: 'The duel at dawn, in prose.' }]);
  await talk.playSay({ playId: duel, text: '' });
  for (const move of ['I wait.', 'I watch him.', 'I breathe.']) await talk.playSay({ playId: duel, text: move });
  const duelAsks = (await requests()).map(systemOf);
  assert.ok(duelAsks[0].includes(FIGHT) && duelAsks[0].includes("## When Words Won't Carry It"), 'the narrator opens a duel with the board and how a fight sounds');
  assert.ok(duelAsks[3].includes(FIGHT) && duelAsks[3].includes("## When Words Won't Carry It"), 'and keeps them for the whole scene, three quiet moves on');
  const duelTr = talk.transcriptOf(store.peek('play', duel));
  await writer.playToProse({ novelId: b.novelId, chapterId: b.ids[0], play: store.peek('play', duel), transcript: duelTr.text, mine: duelTr.mine });
  assert.equal((await requests()).length, 5);
  assert.ok(systemOf((await requests())[4]).includes(FIGHT), 'and so does the duel written into prose');
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Jovan' });
  await reset();
  await script([{ text: 'He shot him a look; she cocked her head, the cat curled up between her legs.' }, { text: 'The wind.' }, { text: 'Steel rings.' }, { text: 'Steel again.' }]);
  await talk.playSay({ playId: id, text: '' });
  await talk.playSay({ playId: id, text: 'I wait.' });
  await talk.playSay({ playId: id, text: 'I draw my sword and attack him.' });
  await talk.playSay({ playId: id, text: 'I keep going.' });
  const [p0, p1, p2, p3] = (await requests()).map(systemOf);
  assert.ok(!p0.includes("## When Words Won't Carry It") && !p1.includes(FIGHT) && !p1.includes(HEAT), 'the narrator\'s words woke nothing');
  assert.ok(p2.includes("## When Words Won't Carry It") && p2.includes(FIGHT), 'his move did');
  assert.ok(p3.includes(FIGHT), 'and his last moves still do');
  /* a scene written into prose: his moves in it */
  await reset();
  await script([{ text: 'The duel, in prose.' }]);
  const tr = talk.transcriptOf(store.peek('play', id));
  assert.ok(tr.mine.includes('I draw my sword and attack him.') && !tr.mine.includes('shot him a look'), tr.mine);
  await writer.playToProse({ novelId: b.novelId, chapterId: b.ids[0], play: store.peek('play', id), transcript: tr.text, mine: tr.mine });
  assert.ok(systemOf((await requests())[0]).includes(FIGHT), 'his moves in the scene');
  assert.equal(picked(b.ch().passages.at(-1)).ask.mine, tr.mine, 'kept beside it, for another take');
  await putAway(b); await putAway(b2); await putAway(b3); await putAway(b4); await putAway(b5);
});

await test('the words that wake a rule: premises and moves wake it; plain English that only sounds like a fight or sex never does', () => {
  const fight = ['Jovan fights Kenjaku.', 'Jovan and Kenjaku fight.', 'They fight.', 'They fought.', 'Jovan keeps fighting.', 'The battle begins at dawn.', 'Kenjaku attacks Yuki.', 'He draws his sword.', 'She punches him.', 'They duel on the bridge.', 'A fight breaks out in the tavern.', 'Jovan fought Kenjaku to a standstill.', 'I draw my sword and attack him.', 'Jovan fights to the death.', 'She fires at him.', 'She shot him.', 'Kenjaku lunges.', 'Jovan fights the demons at the gate.',
    /* real premises that only start like an idiom */
    'Kenjaku stabs at Jovan\'s throat.', 'They mount an attack on the castle.', 'She fights the fear demon.', 'Jovan fights the Grief Curse.', 'He fights a cold-blooded assassin.', 'He fights the tear-stained soldier.', 'Jovan fights panic-stricken guards.', 'They have a fight to the death.'];
  const calm = ['He shot him a look.', 'It hit her then.', 'It struck him that she was gone.', 'A stab of guilt.', 'She had a panic attack.', 'He died of a heart attack.', 'He dodged the question.', 'She was fighting a smile.', 'He fought with his conscience.', 'They had a fight about money.', 'She is fighting a cold.', 'They tackled the problem together.', 'She fired him.', 'He fights back tears.', 'She fights the urge to call.', 'He cocks his head.', 'She mounts her horse.', 'She undressed and slipped into the bath.', 'He graduated summa cum laude.', 'Dick laughed.', 'Jovan fights his demons.', 'Jovan talks about his sensei, and Sano cries.', 'Jovan stays silent and saves Yuki without a word.',
    /* arguments are not fights */
    'They fought about money.', 'They fought over the will.', 'Her parents fought.', 'Mara and her mother clashed.', 'They clash over the wedding plans.', 'They had a big fight.', 'It was a long fight.', 'She keeps fighting for custody.', 'They had a fight.', 'He took a stab at the answer.', 'She undressed for bed.'];
  const heat = ['They make love by the fire.', 'She straddles him.', 'He undresses her slowly.', 'They had sex.', 'She mounts him.', 'They sleep together.', 'He thrusts into her.', 'Mara undresses Jovan.', 'He undresses the girl slowly.', 'Yuki undressed Jovan and pulled him to the bed.'];
  for (const t of fight) assert.deepEqual(crafts.wakesOn(t), { intimate: false, fight: true }, t);
  for (const t of calm) assert.deepEqual(crafts.wakesOn(t), { intimate: false, fight: false }, t);
  for (const t of heat) assert.equal(crafts.wakesOn(t).intimate, true, t);
  /* the app's own words around his never wake one */
  for (const t of [prompts.playOpening({ who: 'Jovan' }), prompts.playOnwards({ who: 'Jovan' })]) assert.deepEqual(crafts.wakesOn(t), { intimate: false, fight: false }, t);
  /* and they read a long text in a blink */
  const long = 'He shot him a look and the stab of guilt came back. '.repeat(4000);
  const t0 = Date.now();
  crafts.wakesOn(long);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

await test('Sound: Comic sends his law with sound effects in asterisks; Novel the same two lanes, the sounds written into the sentences — each book its own, and the checker is told it is the book\'s style', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const b2 = await makeBook([['Mara climbed to the lamp.']]);
  store.change('novel', b2.novelId, shape.novelSteps.setPref('sound', 'novel'), { now: true });
  await script([{ text: 'One.' }, { text: 'Two.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'He draws his sword.' });
  await writer.writeNext({ novelId: b2.novelId, chapterId: b2.ids[0], direction: 'He draws his sword.' });
  const [comic, novel] = (await requests()).map(systemOf);
  assert.ok(comic.includes('Sound As Onomatopoeia') && comic.includes('*CLANG!*') && !comic.includes('Sound In The Prose'), 'Comic');
  assert.ok(novel.includes('Sound In The Prose') && !/\*[A-Z][A-Za-z!—-]*\*/.test(novel) && !novel.includes('Sound As Onomatopoeia'), 'Novel: no sound effect in asterisks anywhere');
  assert.equal((await onPhone('novel', b2.novelId)).prefs.sound, 'novel', 'kept on the phone');
  const told = (n) => prompts.checkRequest({ novel: n, chapterLabel: 'Chapter One', numbered: '[1.1] Words.' });
  assert.ok(told(b.novel()).includes('sound effects in asterisks'), 'the checker leaves Comic sound effects be');
  assert.ok(!told(b2.novel()).includes('asterisks') && told(b2.novel()).includes('written out in quotes'), 'and Novel\'s voices');
  await putAway(b); await putAway(b2);
});

await test('his own modules ride word for word to whom he chose, after the app\'s, oldest first; Off and empty send nothing; one of the app\'s he changed sends his words, and keeps only what he changed', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const mine = 'MY PERSONAL MODULE: the rain never stops.';
  const second = 'MY SECOND MODULE: gulls everywhere.';
  store.change('house', 'house', modules.moduleSteps.add('m-mine', { at: 1, name: 'Rain', text: mine, to: ['partner', 'narrator'], rides: 'always' }), { now: true });
  store.change('house', 'house', modules.moduleSteps.add('m-two', { at: 2, name: 'Gulls', text: second, to: ['narrator'], rides: 'always' }), { now: true });
  store.change('house', 'house', modules.moduleSteps.set('novel-craft', { text: 'MY NOVEL CRAFT.' }), { now: true });
  store.change('house', 'house', modules.moduleSteps.set('voice', { rides: 'off' }), { now: true });
  await store.flush('house', 'house');
  const hs = await onPhone('house', 'house');
  assert.deepEqual(hs.modules['novel-craft'], { text: 'MY NOVEL CRAFT.' }, 'only his words are kept for it');
  assert.deepEqual(hs.modules.voice, { rides: 'off' }, 'only when it rides — its words still follow the app\'s');
  assert.deepEqual(hs.modules['m-mine'].to, ['narrator', 'partner'], 'who reads it, in one order');
  await script([{ text: 'A page.' }, { text: 'The gate creaks.' }, { text: 'An answer.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await talk.playSay({ playId: id, text: '' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thoughts?' });
  const [w, p, t] = (await requests()).map(systemOf);
  assert.ok(w.startsWith('HIS OWN WORDS FIRST\n\nMY NOVEL CRAFT.'), w.slice(0, 80));
  assert.ok(!w.includes(mine) && !w.includes('## The Sound Of A Voice'), 'not his narrator\'s module; the voice rule is off');
  assert.ok(p.includes(mine) && p.indexOf(mine) > p.indexOf('Role = you handle narration') && p.indexOf(second) > p.indexOf(mine), 'after the app\'s, the oldest first');
  assert.ok(t.includes(mine) && !t.includes(second), 'and to his partner, as he ticked');
  /* the app's words again: the row goes; Off and empty: nothing */
  store.change('house', 'house', modules.moduleSteps.set('novel-craft', { text: modules.builtinOf('novel-craft').text }), { now: true });
  store.change('house', 'house', modules.moduleSteps.set('voice', { rides: 'always' }), { now: true });
  store.change('house', 'house', modules.moduleSteps.set('m-mine', { rides: 'off' }), { now: true });
  store.change('house', 'house', modules.moduleSteps.set('m-two', { text: '   ' }), { now: true });
  await store.flush('house', 'house');
  const hs2 = await onPhone('house', 'house');
  assert.equal(hs2.modules['novel-craft'], undefined);
  assert.equal(hs2.modules.voice, undefined);
  await reset();
  await script([{ text: 'Again.' }, { text: 'Rain.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await talk.playSay({ playId: id, text: 'I wait.' });
  const [w2, p2] = (await requests()).map(systemOf);
  assert.ok(w2.startsWith(`HIS OWN WORDS FIRST\n\n${modules.builtinOf('novel-craft').text}`) && w2.includes('## The Sound Of A Voice'), 'the app\'s again');
  assert.ok(!p2.includes(mine) && !p2.includes('MY SECOND MODULE'), 'Off and empty send nothing');
  /* taken out, and put back with Undo */
  const row = JSON.parse(JSON.stringify(store.peek('house', 'house').modules['m-mine']));
  store.change('house', 'house', modules.moduleSteps.remove('m-mine'), { now: true });
  assert.equal(modules.moduleOf(store.peek('house', 'house'), 'm-mine'), null);
  store.change('house', 'house', modules.moduleSteps.set('m-mine', { rides: 'always' }), { now: true });
  assert.equal(modules.moduleOf(store.peek('house', 'house'), 'm-mine'), null, 'a step on one taken out does not bring it back');
  store.change('house', 'house', modules.moduleSteps.restore('m-mine', row), { now: true });
  assert.equal(modules.moduleOf(store.peek('house', 'house'), 'm-mine').text, mine);
  await setHouse();
  await putAway(b);
});

await test('who decides how it turns out: the writer, or him — said with a new page and with Go on, as the chip says now; never between two passages, nor in a rewrite', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const b3 = await makeBook([['Mara climbed to the lamp.', { text: 'The storm broke over the', cut: true, ask: { direction: 'Jovan fights Kenjaku.', length: 'scene' } }]]);
  await script([{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }, { text: 'Four.' }, { text: 'rocks.' }, { text: 'Five.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Jovan fights Kenjaku.', length: 'auto' });
  store.change('novel', b.novelId, shape.novelSteps.setPref('outcome', 'me'), { now: true });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Jovan fights Kenjaku.', length: 'scene' });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], after: b.ch().passages[0].id, length: 'scene' });
  const two = b.ch().passages.find((x) => picked(x).text === 'Two.').id;
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: two });
  store.change('novel', b3.novelId, shape.novelSteps.setPref('outcome', 'me'), { now: true });
  await writer.goOn({ novelId: b3.novelId, chapterId: b3.ids[0], passageId: b3.ch().passages[1].id });
  await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: two, note: 'Kenjaku wins.' });
  const asks = (await requests()).map(askOf);
  assert.ok(asks[0].includes('How it turns out is yours to decide') && asks[0].includes('take the wheel again with my next premise') && asks[0].includes('Never begin a new turn'), asks[0]);
  assert.ok(asks[1].includes('How it turns out is mine to decide') && asks[1].includes('stop on the moment it hangs') && asks[1].includes('shorter is right'), asks[1]);
  assert.ok(!asks[2].includes('How it turns out'), 'between two passages, what follows settles it');
  assert.ok(asks[3].includes('How it turns out is mine to decide'), 'another take asks as the chip says now');
  assert.ok(asks[4].includes('What I asked for in it: Jovan fights Kenjaku.') && asks[4].includes('How it turns out is mine to decide'), asks[4]);
  assert.ok(!asks[5].includes('How it turns out'), 'a rewrite: his note and the pages settle it');
  assert.equal(picked(b3.ch().passages[1]).text, 'The storm broke over the rocks.', 'carried on where it stopped');
  await store.flush();
  assert.equal((await onPhone('novel', b.novelId)).prefs.outcome, 'me', 'the book keeps it');
  store.change('novel', b.novelId, shape.novelSteps.setPref('outcome', ''), { now: true });
  assert.equal(shape.outcomeOf(b.novel()), 'writer', 'and back to the writer');
  await putAway(b); await putAway(b3);
});

await test('a rewrite with his note carries the change through — the old words only a reference; the last passage ends where the change takes it, one with more after it leads in, and his change wins', async () => {
  const b = await makeBook([['Jovan stepped in and said his name.', 'Kenjaku smiled.'], ['A later chapter.']]);
  const b2 = await makeBook([['Jovan stepped in and said his name.', 'Kenjaku smiled.']]);
  await script([{ text: 'New one.' }, { text: 'New two.' }, { text: 'New last.' }, { text: 'Fresh.' }]);
  const [p1, p2] = b.ch().passages.map((p) => p.id);
  const last = b2.ch().passages[1].id;
  await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1, note: 'Jovan stays silent and saves Yuki without a word.' });
  await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2, note: 'He never says a word.' });
  await writer.rewrite({ novelId: b2.novelId, chapterId: b2.ids[0], passageId: last, note: 'He never says a word.' });
  await writer.rewrite({ novelId: b2.novelId, chapterId: b2.ids[0], passageId: last, note: '' });
  const asks = (await requests()).map(askOf);
  assert.ok(asks[0].includes('What I want different: Jovan stays silent and saves Yuki without a word.') && asks[0].includes('My change is now what happens') && asks[0].includes('there only for reference'), asks[0]);
  assert.ok(asks[0].includes('my change wins') && !asks[0].includes('end wherever'), 'more comes after it in its chapter');
  assert.ok(asks[1].includes('my change wins'), 'a later chapter with words comes after it');
  assert.ok(asks[2].includes('can end wherever the change takes it') && !asks[2].includes('my change wins'), 'the last passage of the book');
  assert.ok(asks[3].includes('a fresh take on the same moment') && !asks[3].includes('My change'), 'no note: a fresh take');
  assert.equal(picked(b.ch().passages[0]).text, 'New one.');
  assert.equal(b.ch().passages[0].versions.length, 2, 'the old words one arrow away');
  await putAway(b); await putAway(b2);
});

/* what a 2.2 house holds in a box he never touched */
const OLD_WRITING = `You write fiction the way good published novels read: concrete, sensory detail; real feeling under the surface; dialogue that sounds like people actually talking; a pace that gives quiet moments room to breathe and lets big moments land.

Stay true to the characters and to everything already written — never contradict it. Show rather than summarise. Don't rush to wrap things up, don't end on a neat moral, and don't reach for a cliffhanger unless the story calls for one. Avoid stock phrases and repeating yourself.`;
const OLD_NARRATOR = `You tell the scene the way the book itself is told — its voice, its point of view, its tense — a few paragraphs at a time: the place, the weather of the moment, the other people and what they say and do, what happens next.

The people in it have their own minds. They want things, they push back, they lie, they surprise; nobody waits politely for a turn or exists only to agree. The world keeps moving around the scene. Keep it concrete and alive, let quiet moments breathe and big ones land, and end each telling at a moment that asks for an answer.`;

await test('boxes still holding the starting words of before get today\'s — the master novelist, his preset\'s own opening — and words he wrote stay his', async () => {
  await setHouse({}, { instructions: { system: OLD_WRITING, narrator: OLD_NARRATOR, partner: 'HIS PARTNER WORDS', late: '' } });
  assert.equal(prompts.startingIsOld(store.peek('house', 'house')), true);
  store.change('house', 'house', prompts.freshStarting, { now: true });
  await store.flush('house', 'house');
  let ins = (await onPhone('house', 'house')).instructions;
  assert.equal(ins.system, prompts.DEFAULT_WRITING);
  assert.ok(ins.system.startsWith('You are a master novelist') && ins.system.includes('New York Times bestseller'), ins.system);
  assert.equal(ins.narrator, 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.');
  assert.equal(ins.partner, 'HIS PARTNER WORDS');
  assert.equal(prompts.startingIsOld(store.peek('house', 'house')), false, 'once is all it takes');
  /* a box he wrote in — one letter is enough — keeps his words */
  await setHouse({}, { instructions: { system: OLD_WRITING + ' Mine.', narrator: '', partner: '', late: '' } });
  assert.equal(prompts.startingIsOld(store.peek('house', 'house')), false);
  store.change('house', 'house', prompts.freshStarting, { now: true });
  await store.flush('house', 'house');
  ins = (await onPhone('house', 'house')).instructions;
  assert.equal(ins.system, OLD_WRITING + ' Mine.');
  assert.equal(ins.narrator, '', 'an emptied box stays empty');
  await setHouse();
});

await test('a scene break or an empty page after a passage is not text to bridge to: another take and a page written there are asked as the chip says', async () => {
  const b = await makeBook([['Mara climbed to the lamp.', { text: 'Steel rang.', ask: { direction: 'Jovan fights Kenjaku.', length: 'scene' } }, '---']]);
  store.change('novel', b.novelId, shape.novelSteps.setPref('outcome', 'me'), { now: true });
  await script([{ text: 'Again.' }, { text: 'After it.' }, { text: 'Between.' }]);
  const steel = b.ch().passages[1].id;
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: steel });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], after: steel });
  /* with words after it, it is between */
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], after: b.ch().passages[0].id });
  const asks = (await requests()).map(askOf);
  for (const a of asks.slice(0, 2)) {
    assert.ok(a.includes('How it turns out is mine to decide') && !a.includes('between the text before it and the text that follows it'), a);
  }
  assert.ok(asks[2].includes('between the text before it and the text that follows it') && !asks[2].includes('How it turns out'), asks[2]);
  await putAway(b);
});

await test('a narrator box he emptied before 2.3 gets his own writing words, once — never the starting words — and one emptied after stays empty', async () => {
  await setHouse({}, { instructions: { system: 'MY OWN VOICE FOR EVERY PAGE.', narrator: '', partner: '', late: '' } });
  assert.equal(prompts.narratorCarryDue(store.peek('house', 'house')), true);
  store.change('house', 'house', prompts.carryNarrator, { now: true });
  await store.flush('house', 'house');
  let hs = await onPhone('house', 'house');
  assert.equal(hs.instructions.narrator, 'MY OWN VOICE FOR EVERY PAGE.', 'his scenes keep the voice they had');
  assert.equal(hs.narratorCarried, true);
  /* emptied again from now on: it stays empty, and sends nothing of his */
  store.change('house', 'house', (x) => { x.instructions.narrator = ''; }, { now: true });
  assert.equal(prompts.narratorCarryDue(store.peek('house', 'house')), false);
  store.change('house', 'house', prompts.carryNarrator, { now: true });
  await store.flush('house', 'house');
  hs = await onPhone('house', 'house');
  assert.equal(hs.instructions.narrator, '', 'done once');
  const b = await makeBook([['Mina waited at the gate.']]);
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'The gate creaks.' }]);
  await talk.playSay({ playId: id, text: '' });
  const sys = systemOf((await requests())[0]);
  assert.ok(sys.startsWith('## The Telling') && !sys.includes('MY OWN VOICE'), sys.slice(0, 80));
  /* the starting words in his writing box are never carried: they say the writer writes the main character too */
  for (const system of [prompts.DEFAULT_WRITING, OLD_WRITING, '']) {
    await setHouse({}, { instructions: { system, narrator: '', partner: '', late: '' } });
    store.change('house', 'house', prompts.carryNarrator, { now: true });
    assert.equal(store.peek('house', 'house').instructions.narrator, '', system.slice(0, 30));
  }
  /* a box of spaces was empty to 2.2 too */
  await setHouse({}, { instructions: { system: 'MY OWN VOICE.', narrator: '   ', partner: '', late: '' } });
  store.change('house', 'house', prompts.carryNarrator, { now: true });
  assert.equal(store.peek('house', 'house').instructions.narrator, 'MY OWN VOICE.');
  /* a box he wrote in is his */
  await setHouse({}, { instructions: { system: 'MY OWN VOICE.', narrator: 'MY NARRATOR.', partner: '', late: '' } });
  store.change('house', 'house', prompts.carryNarrator, { now: true });
  assert.equal(store.peek('house', 'house').instructions.narrator, 'MY NARRATOR.');
  await setHouse();
  await putAway(b);
});

await test('the room for the chapters the partner asked for: the short ones whole, the long ones sharing what is left — never more than the budget', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const rows = [{ label: 'Chapter One', text: words(150) }, { label: 'Chapter Two', text: words(20000) }, { label: 'Chapter Three', text: words(9000) }];
  const cost = rows.map((r) => util.estimateTokens(r.text));
  const f = talk.fitRead(rows, 20000);
  assert.equal(f.cut, true);
  assert.equal(f.rows[0].text, rows[0].text, 'the short one whole');
  const got = f.rows.map((r) => util.estimateTokens(r.text));
  assert.ok(f.tokens <= 20000 && got.reduce((a, b) => a + b, 0) <= 20000, `${got} within 20,000`);
  assert.ok(got[1] > 9000 && got[2] > 9000, `what the short one left is shared: ${got}`);
  assert.ok(f.rows[1].text.startsWith('word0 word1') && f.rows[1].text.includes('left out here') && f.rows[1].text.endsWith(`word${19999}`), 'its opening and its end');
  /* many asked for, little room: never past the budget */
  const many = Array.from({ length: 30 }, (_, i) => ({ label: `Chapter ${i}`, text: words(3000) }));
  const g = talk.fitRead(many, 3000);
  assert.ok(g.rows.reduce((a, r) => a + util.estimateTokens(r.text), 0) <= 3000 + 30 * 40, 'within the budget, a short line each at most');
  assert.equal(talk.fitRead(rows, 1e9).cut, false, 'room enough: all whole');
  assert.deepEqual(cost.length, 3);
});

await test('chapters the partner asks to read, more than its model holds beside everything else, are sent cut to fit — their openings and ends — and the answer goes on', async () => {
  const long = Array.from({ length: 500 }, (_, i) => `Line ${i} of a long chapter, said slowly.`).join(' ');
  const b = await makeBook([['THE OPENING OF ONE. ' + long + ' THE END OF ONE.'], ['The second.']]);
  /* What it's about and the notes are long too: they go whatever happens, and the reading fits beside them */
  store.change('novel', b.novelId, (n) => { n.brief = 'A BRIEF. ' + 'The keeper and the sea and the letter. '.repeat(120); }, { now: true });
  for (let i = 0; i < 12; i++) store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: `PERSON ${i}`, about: 'Someone the keeper knows from the harbour, with a long story. '.repeat(6) })), { now: true });
  await setHouse({ context: 12000 }, CRAFTS_OFF);
  await script([{ text: 'Let me look first. <read>[1]</read>' }, { text: 'Having read it: it works.' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[1], text: 'How is chapter one?' });
  assert.equal(out.ok, true, out.error);
  const r = await requests();
  assert.equal(r.length, 2);
  const back = r[1].body.messages.at(-1).content;
  assert.ok(back.includes('THE OPENING OF ONE.') && back.includes('THE END OF ONE.') && back.includes('the middle of this chapter is left out here'), back.slice(0, 300));
  assert.ok(back.includes('as much of each as fits here'), back.slice(-200));
  const sent = r[1].body.messages.reduce((n, m) => n + util.estimateTokens(String(m.content)) + 8, 0);
  assert.ok(sent + 6000 <= 12000, `it fits the model's 12,000 with the answer's 6,000: ${sent} tokens sent`);
  assert.ok(systemOf(r[1]).includes('PERSON 11') || r[1].body.messages.some((m) => String(m.content).includes('PERSON 11')), 'the notes went with it');
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).text, 'Having read it: it works.');
  await setHouse();
  await putAway(b);
});

await test('every module of the app\'s, woken or not, speaks in words that never name a machine', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const all = Object.fromEntries(modules.BUILTIN.map((m) => [m.id, { rides: 'always', to: ['writer', 'narrator', 'partner'] }]));
  for (const sound of ['comic', 'novel']) {
    store.change('novel', b.novelId, shape.novelSteps.setPref('sound', sound === 'comic' ? '' : sound), { now: true });
    for (const purpose of ['write', 'play', 'partner']) {
      const a = context.assemble({ house: { ...store.peek('house', 'house'), modules: all }, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: CONN, purpose, target: { chapterId: b.ids[0] },
        play: { who: 'Mara' }, request: 'Go.', moment: 'He draws his sword. They make love.' });
      const his = purpose === 'play' ? prompts.DEFAULT_NARRATOR : purpose === 'write' ? 'HIS OWN WORDS FIRST' : '';
      const words = (his ? a.system.split(his).join('') : a.system).replace(/Mara climbed to the lamp\./g, '');
      for (const m of modules.BUILTIN) assert.ok(a.system.includes(m.text), `${purpose}: ${m.name} rides`);
      const hit = words.match(MACHINE);
      assert.equal(hit, null, `${sound} ${purpose}: "${hit && hit[0]}" in "${hit && words.slice(Math.max(0, hit.index - 80), hit.index + 40)}"`);
    }
  }
  await putAway(b);
});

await test('a scene with the narrator\'s starting words: his preset\'s opening, then the scene craft — nothing of the writer\'s', async () => {
  const b = await makeBook([['Mina waited at the gate.']]);
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', late: '', partner: '' } });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'The gate creaks.' }]);
  await talk.playSay({ playId: id, text: '' });
  const sys = systemOf((await requests())[0]);
  assert.ok(sys.startsWith('You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.\n\n## The Telling'), sys.slice(0, 140));
  assert.ok(!sys.includes('HIS OWN WORDS FIRST'));
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

await test('a book being removed takes no new steps, and a save on its way lands before it goes — the phone never has to turn one away as deleted', async () => {
  const b = await makeBook([['One.']]);
  const seen = [];
  const was = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const res = await was(url, init);
    if (String(url).includes(`/api/store/novel/${b.novelId}`)) seen.push(`${(init && init.method) || 'GET'} ${res.status}`);
    return res;
  };
  try {
    /* a save on its way (the helper's reading, say) as he removes the book */
    store.change('novel', b.novelId, shape.novelSteps.touchWritten(Date.now()), { now: true });
    const going = store.remove('novel', b.novelId);
    assert.equal(store.change('novel', b.novelId, shape.novelSteps.touchWritten(Date.now() + 1), { now: true }), undefined, 'no new step while it goes');
    await going;
    await sleep(300);
  } finally {
    globalThis.fetch = was;
  }
  assert.deepEqual(seen, ['PUT 200', 'DELETE 200'], 'the save first, then the removal — nothing after');
  assert.ok(!(await onPhone('novel', b.novelId)), 'gone from the phone');
});

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
