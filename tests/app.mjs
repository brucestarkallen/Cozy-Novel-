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
const namesjs = await import(path.join(ROOT, 'js/novel/names.js'));
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
/* the helper and the checker of the checks before go quiet first: no look of
 * theirs, booked for a book of another check, lands in this one's requests */
async function quietAll() {
  for (const w of [archivist.forTests(), checker.forTests()]) { for (const t of w.timers.values()) clearTimeout(t); w.timers.clear(); }
  for (let i = 0; i < 300 && (archivist.forTests().running.size || checker.forTests().running.size); i++) await sleep(20);
  for (const w of [archivist.forTests(), checker.forTests()]) { for (const t of w.timers.values()) clearTimeout(t); w.timers.clear(); }
}
async function test(name, fn) {
  /* ONLY=words runs just the checks whose names hold them */
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try {
    await quietAll();
    await reset();
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String((e && e.stack) || e).split('\n').slice(0, process.env.LONG ? 40 : 4).join('\n       ')}`);
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
  /* he is told too: the passage says the chapter was sent in part */
  assert.ok((picked(b.ch().passages[1]).notes || []).some((n) => n.includes('with the middle left out')), JSON.stringify(picked(b.ch().passages[1]).notes));
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
  /* a book with no words yet: nothing to pick up — it begins */
  const empty = await makeBook([[]]);
  await reset();
  await script([{ text: 'A first page.' }]);
  await writer.writeNext({ novelId: empty.novelId, chapterId: empty.ids[0], direction: 'BEGIN IT.' });
  assert.equal((await requests())[0].body.messages[1].content, prompts.PICK_UP_FIRST);
  await setHouse();
  await putAway(empty);
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

await test('a part read out of turn never moves where someone is "now" — it fills only one never written, and what lasts lands; the whole book read again from the start moves it chapter by chapter', async () => {
  const b = await makeBook([['Mara left the island in a storm.'], ['Mara came home at last.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'pe-m', name: 'Mara', about: 'The keeper.', now: 'Home at Crane Point, tired and glad.', updated: { at: 1 } }, { id: 'pe-a', name: 'Ana', about: 'Her sister.', now: '', updated: { at: 1 } }], places: [], lore: [], threads: [] }), { now: true });
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch(0).passages[0].id, text: 'Mara left the island in a storm, and Tom rowed, and Ana watched.' });
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper, who lost her lamp to the storm.', now: 'At sea in the storm.' }, { name: 'Tom', about: 'A rower.', now: 'Rowing Mara out.' }, { name: 'Ana', now: 'Watching from the pier.' }] }) }]);
  await archivist.run(b.novelId);
  let people = b.novel().notes.people;
  const mara = people.find((c) => c.name === 'Mara');
  assert.equal(mara.now, 'Home at Crane Point, tired and glad.', 'the newest chapter\'s "now" stands');
  assert.equal(mara.about, 'The keeper, who lost her lamp to the storm.', 'what lasts lands');
  assert.equal(people.find((c) => c.name === 'Tom').now, 'Rowing Mara out.', 'a "now" never written is filled');
  assert.equal(people.find((c) => c.name === 'Ana').now, 'Watching from the pier.', 'on a card that had none too');
  /* the whole book read again from the start: each chapter is the newest read so far (his card stays, and its "now" moves) */
  store.change('novel', b.novelId, (n) => { n.notes.people.find((c) => c.name === 'Tom').updated = { by: 'you', at: 1 }; }, { now: true });
  await reset();
  archivist.readAgain(b.novelId);
  await script([
    { text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.', now: 'At sea in the storm.' }, { name: 'Tom', now: 'Rowing back alone.' }] }) },
    { text: JSON.stringify({ people: [{ name: 'Mara', now: 'Home at Crane Point.' }] }) },
  ]);
  await archivist.run(b.novelId);
  const asked = (await requests()).map((x) => x.body.messages.at(-1).content).filter((t) => t.includes('Update the notes'));
  assert.ok(asked.length >= 2 && !asked[0].includes('the book goes on to Chapter Two'), 'never told the book goes on past what is read');
  people = b.novel().notes.people;
  assert.equal(people.find((c) => c.name === 'Mara').now, 'Home at Crane Point.');
  assert.equal(people.find((c) => c.name === 'Tom').now, 'Rowing back alone.', 'the first chapter read again is the newest read so far');
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

/* the helper's own timers put away between runs a check makes itself */
const quiet = (b) => { const t = archivist.forTests().timers; clearTimeout(t.get(b.novelId)); t.delete(b.novelId); };

await test('a card is found by the name the book gives: the one called that before one that also goes by it, a short or fuller form of a person’s name only when one card answers to it — and a name two cards answer to writes on neither', () => {
  const notes = { people: [
    { id: 'p1', name: 'Byakuya Kuchiki', aka: ['Kuchiki'], about: 'A captain.', now: '' },
    { id: 'p2', name: 'Rukia Kuchiki', aka: ['Kuchiki'], about: 'A lieutenant.', now: '' },
    { id: 'p3', name: 'Rias Wells', aka: [], about: 'A redhead.', now: '' },
    { id: 'p4', name: 'Toshiro Hitsugaya', aka: [], about: 'Captain of the tenth.', now: '' },
  ], places: [{ id: 'l1', name: 'The Wells Residence', about: 'A house.' }], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, {
    people: [
      { name: 'Kuchiki', now: 'At the gate.' },
      { name: 'Rias', now: 'In the hall.' },
      { name: 'Captain Hitsugaya', now: 'On the wall.' },
      { name: 'Rukia Kuchiki', about: 'A lieutenant of the thirteenth.' },
    ],
    places: [{ name: 'Wells Residence', about: 'A house with a red door.' }],
  });
  const p = (id) => out.notes.people.find((c) => c.id === id);
  assert.equal(out.notes.people.length, 4, 'no new card for a short form');
  assert.deepEqual([p('p1').now, p('p2').now], ['', ''], 'a name two cards answer to writes on neither');
  assert.deepEqual(out.aside, [{ kind: 'people', name: 'Kuchiki' }]);
  assert.equal(p('p3').now, 'In the hall.');
  assert.ok(p('p3').aka.includes('Rias'), 'the short form kept among its names');
  assert.equal(p('p4').now, 'On the wall.', 'a rank set aside');
  assert.equal(p('p2').about, 'A lieutenant of the thirteenth.');
  assert.equal(out.notes.places.length, 1);
  assert.equal(out.notes.places[0].about, 'A house with a red door.', 'a place called the same but for "the"');
});

await test('a card is taken out only by its own name — never his, never one the same answer gives whole, never one still in the book unless another card now carries its name; the card a repeat folds into keeps its names, and each change says why', () => {
  const notes = { people: [
    { id: 'a', name: 'Mara', aka: [], about: 'The keeper.', now: '' },
    { id: 'b', name: 'The Lighthouse Girl', aka: [], about: 'A girl at the light.', now: '' },
    { id: 'c', name: 'Tom Venn', aka: ['Tom'], about: 'HIS WORDS.', now: '', updated: { by: 'you', at: 1 } },
    { id: 'd', name: 'Jonas', aka: [], about: 'A sailor.', now: '' },
    { id: 'e', name: 'Old Pell', aka: [], about: 'From a take since rewritten.', now: '' },
    { id: 'f', name: 'Rias', aka: [], about: 'A redhead.', now: '' },
    { id: 'g', name: 'Rias Wells', aka: [], about: 'A redhead with a temper.', now: '' },
    { id: 'h', name: 'Old Hask', aka: [], about: 'HIS OLD HASK.', now: '', updated: { by: 'you', at: 1 } },
    { id: 'i', name: 'Byakuya Kuchiki', aka: ['Byakuya'], about: 'A captain.', now: '' },
  ], places: [], lore: [], threads: [] };
  const stands = namesjs.foldedText('Mara climbed the stair. Jonas sang below. Tom waved. Rias laughed.');
  const out = archivist.foldNotes(notes, {
    people: [{ name: 'Mara', aka: ['The Lighthouse Girl'], about: 'The keeper; the girl at the light.', why: 'the same person as the lighthouse girl' }, { name: 'Brann', about: 'A man new to the notes.' }],
    gone: [
      { kind: 'people', name: 'Old Hask' }, { kind: 'people', name: 'Brann' }, { kind: 'people', name: 'Byakuya' },
      { kind: 'people', name: 'The Lighthouse Girl', why: 'folded into Mara' },
      { kind: 'people', name: 'Tom' }, { kind: 'people', name: 'Tom Venn' },
      { kind: 'people', name: 'Jonas', why: 'not in the book' },
      { kind: 'people', name: 'Old Pell', why: 'only in a take since rewritten' },
      { kind: 'people', name: 'Rias', why: 'the same as Rias Wells' },
      { kind: 'people', name: 'Mara' },
    ],
  }, { audit: true, stands });
  const names = out.notes.people.map((c) => c.name);
  assert.deepEqual(names, ['Mara', 'Tom Venn', 'Jonas', 'Rias Wells', 'Old Hask', 'Byakuya Kuchiki', 'Brann'], 'his card, one the answer gives whole, and one that only goes by the name, never taken out — wherever their names stand');
  assert.ok(out.notes.people[0].aka.includes('The Lighthouse Girl'), 'the card it folded into keeps its name');
  assert.equal(out.notes.people[1].about, 'HIS WORDS.', 'his card: never taken out, by any of its names');
  const why = Object.fromEntries(out.cards.map((c) => [(c.after || c.before).name, out.whys[c.id]]));
  assert.deepEqual(why, { Mara: 'the same person as the lighthouse girl', 'The Lighthouse Girl': 'folded into Mara', 'Old Pell': 'only in a take since rewritten', Rias: 'the same as Rias Wells', Brann: undefined });
});

await test('a group given as a person is kept among the lore — a person’s card that is a group moves there too, and the reading’s Undo brings it back; a slip of the pen in a long name finds its card and is never kept as a name, a short name a letter off is someone else; a description a card was known by never takes a new row, nor a name another card answers to by its own', () => {
  const notes = { people: [
    { id: 'g', name: 'the guards', aka: [], about: 'Posted at the north gate.', now: 'At the gate.', ties: '', updated: { at: 1 } },
    { id: 'w', name: 'the night guards', aka: [], about: 'HIS NIGHT GUARDS.', now: '', ties: '', updated: { by: 'you', at: 1 } },
    { id: 'c', name: 'Marianne Cartwright', aka: [], about: 'A clerk.', now: '', ties: '' },
    { id: 'h', name: 'Toshiro Hitsugaya', aka: [], about: 'Captain of the tenth.', now: '', ties: '' },
    { id: 'm', name: 'Mira', aka: [], about: 'A healer.', now: '', ties: '' },
    { id: 'r', name: 'Rukia Kuchiki', aka: ['Kuchiki'], about: 'A lieutenant.', now: '', ties: '' },
    { id: 'b', name: 'Byakuya Kuchiki', aka: [], about: 'A captain.', now: '', ties: '' },
    { id: 'v', name: 'Vivi', aka: ['the girl'], about: 'A princess.', now: '', ties: '' },
  ], places: [], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, { people: [
    { name: 'the guards', about: 'Posted at the north gate; bribed by Venn.', now: 'Asleep.', why: 'they took the bribe' },
    { name: 'the night guards', now: 'On the wall.' },
    { name: 'Marianna Cartwrigt', about: 'Two names a letter off each: someone else.' },
    { name: 'several villagers', about: 'They watched the ship burn.' },
    { name: 'the onlookers' },
    { name: 'Toshiro Hitsugayo', now: 'On the roof.' },
    { name: 'Mina', about: 'A girl from the mill.' },
    { name: 'Kuchiki', now: 'At the gate.' },
    { name: 'the girl', about: 'A different girl, at the docks.' },
  ] });
  const p = (n) => out.notes.people.find((c) => c.name === n);
  const l = (n) => out.notes.lore.find((c) => c.name === n);
  assert.equal(p('the guards'), undefined, 'a group is no person’s card');
  assert.equal(l('the guards').about, 'Posted at the north gate; bribed by Venn.');
  assert.equal(l('several villagers').about, 'They watched the ship burn.');
  assert.equal(l('the onlookers'), undefined, 'nothing said of it: nothing kept');
  assert.equal(p('the night guards').now, 'On the wall.', 'his card stays where he put it');
  assert.equal(p('Marianne Cartwright').about, 'A clerk.', 'a slip in one word of the name only');
  assert.ok(p('Marianna Cartwrigt'));
  assert.equal(p('Toshiro Hitsugaya').now, 'On the roof.', 'a slip finds its card');
  assert.deepEqual(p('Toshiro Hitsugaya').aka, [], 'and is never kept as a name it goes by');
  assert.equal(p('Mira').about, 'A healer.');
  assert.equal(p('Mina').about, 'A girl from the mill.', 'a short name a letter off is someone else');
  assert.deepEqual([p('Rukia Kuchiki').now, p('Byakuya Kuchiki').now], ['', ''], 'a name another card answers to by its own: neither');
  assert.ok(out.aside.some((x) => x.name === 'Kuchiki'));
  assert.equal(p('Vivi').about, 'A princess.');
  assert.equal(p('the girl').about, 'A different girl, at the docks.', 'a description a card was known by never takes a new row');
  /* a change he makes through the partner names its card exactly — a name it goes by still finds it */
  assert.equal(shape.matchCard(notes.people, 'the girl', [], { kind: 'people', near: false }).card.name, 'Vivi');
  /* the reading's Undo: the person's card back where it was, the lore it became gone */
  const moved = out.cards.filter((c) => c.id === 'g' || (c.after && c.after.name === 'the guards'));
  assert.deepEqual(moved.map((c) => [c.kind, Boolean(c.before), Boolean(c.after)]).sort(), [['lore', false, true], ['people', true, false]]);
  assert.equal(out.whys.g, 'a group of people, not one person — kept among the lore');
  const n = { notes: JSON.parse(JSON.stringify(out.notes)) };
  shape.novelSteps.undoCards(out.cards)(n);
  assert.equal(n.notes.people.find((c) => c.id === 'g').about, 'Posted at the north gate.');
  assert.equal(n.notes.lore.length, 0);
  for (const [name, group] of [['the onlookers behind the taped line', true], ['several guards', true], ['The rest', true], ['Harbour runners', true], ['Captain of the guards', false], ['Squad Leader Hayes', false], ['the guards’s captain', false], ['Mara', false]]) assert.equal(namesjs.isGroupName(name), group, name);
});

await test('a thread is found by sense and closed however the answer says so — its copies close with it; threads that are not each other’s copies are never written on by a title both answer to; "TBD" is no thread; a change he makes through the partner closes one said "closed" too', async () => {
  const notes = { people: [], places: [], lore: [], threads: [
    { id: 't1', name: 'Tom’s promise to fix the roof', about: 'Before winter.', open: true },
    { id: 't2', name: 'Tom promises to fix the roof', about: 'A copy.', open: true },
    { id: 't3', name: 'Venn’s letter from the bank', about: 'Unopened.', open: true },
    { id: 't4', name: 'Venn’s letter from Claire', about: 'Hidden.', open: true },
    { id: 't5', name: 'Mara’s debt to the harbourmaster', about: 'Forty crowns.', open: true },
    { id: 't6', name: 'The lamp oil running low', about: 'A week left.', open: true },
  ] };
  const out = archivist.foldNotes(notes, { threads: [
    { name: 'Tom promised to fix the roof', about: 'He fixed it at last.', status: 'resolved' },
    { name: 'Venn’s letter', about: 'Read at last.', open: false },
    { name: 'Mara’s debt to the harbourmaster', open: 'closed' },
    { name: 'The lamp oil running low', resolved: 'yes' },
    { name: 'TBD', about: 'Nothing.' },
  ] });
  const t = (id) => out.notes.threads.find((c) => c.id === id);
  assert.equal(t('t1').about, 'He fixed it at last.', 'found in other words');
  assert.deepEqual([t('t1').open, t('t2').open], [false, false], 'its copy closes with it');
  assert.equal(out.whys.t2, 'the same thread as “Tom’s promise to fix the roof”, closed with it');
  assert.deepEqual([t('t3').open, t('t4').open, t('t3').about, t('t4').about], [true, true, 'Unopened.', 'Hidden.'], 'two threads one title answers to: neither');
  assert.ok(out.aside.some((x) => x.name === 'Venn’s letter'));
  assert.equal(t('t5').open, false, '"open": "closed" is closed');
  assert.equal(t('t6').open, false, '"resolved": "yes" is closed');
  assert.equal(out.notes.threads.length, 6, 'nothing opened for "TBD"');
  for (const [row, want] of [[{ open: 'Resolved.' }, false], [{ status: 'ongoing' }, true], [{ closed: true }, false], [{ open: 'maybe' }, undefined], [{ done: 'no' }, true]]) assert.equal(util.openOf(row), want, JSON.stringify(row));
  /* through the partner */
  const b = await makeBook([['Mara paid the harbourmaster.']]);
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [], places: [], lore: [], threads: [{ id: 'tp', name: 'Mara’s debt', about: 'Forty crowns.', open: true }] }), { now: true });
  const made = changes.makeChange(b.novelId, { note: 'threads', name: 'Mara’s debt', open: 'closed', why: 'she paid it' });
  assert.equal(made.status, 'made', JSON.stringify(made));
  assert.equal(b.novel().notes.threads[0].open, false);
  await putAway(b);
});

await test('the helper takes only words for a card: an object, a "none", "unchanged" or an excuse leaves it as it was; a long field ends on a whole sentence; a reading never thins who someone is — the check against the book may; a yes in words is a yes', () => {
  const about = 'The keeper of the light at Crane Point; dry, solitary, kind to gulls, counts every coin, will not be pitied.';
  const notes = { people: [{ id: 'm', name: 'Mara', aka: [], about, now: 'In the lantern room.', ties: 'Wary of Tom.' }], places: [], lore: [], threads: [{ id: 't', name: 'The oath', about: 'Sworn at the gate.', open: true }] };
  let out = archivist.foldNotes(notes, { people: [{ name: 'Mara', about: { looks: 'x' }, now: 'N/A', ties: 'unchanged' }], threads: [{ name: 'None', about: 'nothing' }, { name: 'N/A' }] });
  assert.equal(out.cards.length, 0, JSON.stringify(out.notes));
  out = archivist.foldNotes(notes, { people: [{ name: 'Mara', about: 'A girl.', now: "I'm sorry, but I can't help with that." }] });
  assert.equal(out.cards.length, 0, 'a thinner "who they are" and an excuse: nothing written');
  out = archivist.foldNotes(notes, { people: [{ name: 'Mara', about: 'A girl.' }] }, { audit: true });
  assert.equal(out.notes.people[0].about, 'A girl.', 'the check against the book may put it right');
  const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} about the keeper.`).join(' ');
  out = archivist.foldNotes(notes, { people: [{ name: 'Mara', about: about + ' ' + long }] });
  const kept = out.notes.people[0].about;
  assert.ok(kept.length <= 12000 && /keeper\.…$/.test(kept), kept.slice(-60));
  out = archivist.foldNotes(notes, { threads: [{ name: 'The oath', open: 'false' }] });
  assert.equal(out.notes.threads[0].open, false, '"false" in words closes it');
});

await test('an answer cut off is never a reading: its first whole card is not taken for the answer — asked again with room — and what it keeps of the book is not written over by a person’s words', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  await script([
    { text: '{"people": [{"name": "Mara Venn", "about": "PERSON ABOUT"}, {"name": "To', finish: 'length' },
    { text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.' }] }) },
  ]);
  await archivist.run(b.novelId);
  const asks = (await requests()).filter((x) => x.body.messages.some((m) => String(m.content).includes('Update the notes')));
  assert.equal(asks.length, 2, 'asked once more');
  assert.ok(asks[1].body.messages.at(-1).content.includes(prompts.JSON_CUT));
  const n = b.novel();
  assert.equal(n.notes.people[0].about, 'The keeper.');
  assert.notEqual(((n.kept || {}).about || {}).text, 'PERSON ABOUT', 'What it’s about is not a person’s card');
  await putAway(b);
});

await test('a passage the helper’s model will not read is set aside after a second run — the book read one passage at a time meanwhile — said in the notes with why, with Read it again; the rest of the book is read', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came up the path.', 'The sea was grey.']], { manual: true });
  const [, p2] = b.ch().passages;
  const sorry = { text: "I'm sorry, but I can't help with that." };
  /* together: not read — its model answers a harmless ask, so it is the words: one at a time */
  await script([sorry, sorry]);
  await archivist.run(b.novelId);
  quiet(b);
  assert.equal(archivist.pendingWork(b.novelId), true);
  assert.equal(archivist.forTests().narrow.has(b.novelId), true, 'read one at a time from now on');
  /* one at a time: the first read, the second not (its first run) */
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', about: 'Keeper.' }] }) }, sorry, sorry]);
  await archivist.run(b.novelId);
  quiet(b);
  assert.ok(b.novel().notes.people.some((c) => c.name === 'Mara'));
  assert.equal(Object.keys(b.novel().memory.aside || {}).length, 0, 'not set aside on its first run');
  /* its second run: set aside, and the third passage read */
  await script([sorry, sorry, { text: JSON.stringify({ places: [{ name: 'The sea', about: 'Grey.' }] }) }]);
  await archivist.run(b.novelId);
  quiet(b);
  const aside = b.novel().memory.aside || {};
  assert.deepEqual(Object.keys(aside), [p2.id]);
  assert.match(aside[p2.id].why, /I'm sorry, but I can't help/);
  assert.equal(aside[p2.id].label, 'Chapter One, passage 2');
  assert.ok(b.novel().notes.places.some((c) => c.name === 'The sea'), 'the rest of the book was read');
  assert.equal(archivist.pendingWork(b.novelId), false);
  assert.match(archivist.lightOf(b.novelId).words, /one part its model would not read/);
  /* Read it again */
  assert.equal(archivist.readAside(b.novelId, p2.id), true);
  assert.equal(archivist.pendingWork(b.novelId), true);
  assert.deepEqual(Object.keys(b.novel().memory.aside || {}), []);
  quiet(b);
  await script([{ text: JSON.stringify({ people: [{ name: 'Tom', about: 'A visitor.' }] }) }]);
  await archivist.run(b.novelId);
  quiet(b);
  assert.ok(b.novel().notes.people.some((c) => c.name === 'Tom'));
  await putAway(b);
});

await test('a helper whose model is down is waited out, never set aside: a passage is set aside only when its model answers a harmless ask', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  const sorry = { text: "I'm sorry, but I can't help with that." };
  for (let i = 0; i < 3; i++) {
    await script([sorry, sorry, { probe: true, status: 503, message: 'down' }]);
    await archivist.run(b.novelId);
    quiet(b);
  }
  assert.equal(Object.keys(b.novel().memory.aside || {}).length, 0);
  assert.equal(archivist.pendingWork(b.novelId), true, 'still to be read once its model is back');
  await putAway(b);
});

await test('the notes’ check: its verdict and each change’s why are kept for him to read, through the readings after it; cards that repeat each other are folded and his never changed; notes checked by the check of before are checked again once, by themselves', async () => {
  const b = await makeBook([['Mara lit the lamp three times that day, as the Gift allows.', 'The stranger would not give his name.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes({
    people: [{ id: 'pe-m', name: 'Mara', aka: [], about: 'HIS WORDS: the keeper.', now: '', updated: { by: 'you', at: 1 } }],
    places: [],
    lore: [{ id: 'lo-g', name: 'The Gift', about: 'Mara can light any lamp.' }, { id: 'lo-l', name: 'Gift limits', about: 'Three times a day.' }],
    threads: [],
  }), { now: true });
  markAllSeen(b);
  /* checked once by the check of before (no verdict, no folding): checked again by itself */
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: 0, fixed: 0 } }), { now: true });
  assert.equal(archivist.firstCheck(b.novelId), true);
  assert.equal(archivist.firstCheck(b.novelId), false, 'once');
  await script([{ text: JSON.stringify({
    lore: [{ name: 'The Gift', about: 'Mara can light any lamp, three times a day.', why: 'took in what Gift limits said' }],
    gone: [{ kind: 'lore', name: 'Gift limits', why: 'said the same as The Gift' }],
    people: [{ name: 'Mara', about: 'NOT HIS', why: 'tried' }],
    clear: true, verdict: 'Every card now holds true to the book.' }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('Cards that say the same thing') && ask.includes('"verdict"'), ask.slice(-900));
  let n = b.novel();
  assert.deepEqual(n.notes.lore.map((c) => c.name), ['The Gift']);
  assert.equal(n.notes.people[0].about, 'HIS WORDS: the keeper.');
  assert.equal(n.memory.audit.verdict, 'Every card now holds true to the book.');
  assert.equal(n.memory.audit.clear, true);
  assert.deepEqual(n.memory.audit.changes.map((c) => [c.name, c.how, c.why]), [['The Gift', 'changed', 'took in what Gift limits said'], ['Gift limits', 'gone', 'said the same as The Gift']]);
  assert.equal(n.memory.lit.changed.find((c) => c.name === 'The Gift').why, 'took in what Gift limits said');
  /* a reading after it: the report stays, one more reading counted */
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'She slept.' });
  await reset();
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  n = b.novel();
  assert.equal(n.memory.audit.verdict, 'Every card now holds true to the book.', 'kept through the readings after it');
  assert.equal(n.memory.audit.reads, 1);
  await putAway(b);
});

await test('Read the whole book again: his cards and his summaries stay; until it is done the writer is sent the notes as they were; the notes’ check never takes its Undo; Undo while it reads stops it and puts the readings back', async () => {
  const b = await makeBook([['Mara kept the light. Tom came.']], { manual: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'Tom', about: 'OLD TOM.' }] }) }]);
  await archivist.run(b.novelId);
  const mara = { id: 'pe-m', name: 'Mara', aka: [], about: 'HIS MARA.', now: '', updated: { by: 'you', at: 1 } };
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', mara), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: archivist.AUDIT_EVERY, v: archivist.AUDIT_V } }), { now: true });
  const seenBefore = JSON.stringify(b.novel().memory.seen);
  archivist.readAgain(b.novelId);
  assert.deepEqual(b.novel().notes.people.map((c) => c.name), ['Mara'], 'his card stays, the helper’s go');
  assert.equal(archivist.rereading(b.novelId), true);
  const house = store.peek('house', 'house');
  const a = context.assemble({ house, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Go on.' });
  assert.ok(a.system.includes('OLD TOM.') && a.system.includes('HIS MARA.'), 'the writer goes on with the notes as they were');
  /* Undo while it reads: stopped, what was read put back */
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.equal(archivist.rereading(b.novelId), false);
  assert.equal(JSON.stringify(b.novel().memory.seen), seenBefore, 'what was read before');
  assert.deepEqual(b.novel().notes.people.map((c) => c.name).sort(), ['Mara', 'Tom']);
  assert.equal(archivist.pendingWork(b.novelId), false);
  /* read again to the end: swapped in whole; the check does not run on its heels and take its Undo */
  archivist.readAgain(b.novelId);
  await reset();
  await script([{ text: JSON.stringify({ people: [{ name: 'Tom', about: 'NEW TOM.' }] }) }]);
  await archivist.run(b.novelId);
  const n = b.novel();
  assert.equal(archivist.rereading(b.novelId), false);
  assert.equal(n.notes.people.find((c) => c.name === 'Tom').about, 'NEW TOM.');
  assert.equal(n.memory.undo.label, 'the whole book', 'its Undo is still there');
  assert.ok(!(await requests()).some((r) => r.body.messages.at(-1).content.includes(prompts.AUDIT_ASK)), 'the check was not run on its heels');
  const a2 = context.assemble({ house, novel: n, chapters: { [b.ids[0]]: b.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Go on.' });
  assert.ok(a2.system.includes('NEW TOM.') && !a2.system.includes('OLD TOM.'));
  await putAway(b);
});

await test('an answer asked before the whole book began to be read again is not laid on the notes it began afresh', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'GHOST', about: 'From before.' }] }), delay: 0.05, chunk: 4 }, { text: JSON.stringify({ people: [{ name: 'Mara', about: 'Keeper.' }] }) }]);
  const run = archivist.run(b.novelId);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(20);
  archivist.readAgain(b.novelId);
  await run;
  await archivist.run(b.novelId);
  const names = b.novel().notes.people.map((c) => c.name);
  assert.ok(!names.includes('GHOST'), names.join(', '));
  assert.ok(names.includes('Mara'));
  assert.equal(archivist.pendingWork(b.novelId), false);
  await putAway(b);
});

await test('a chapter taken out is told to the helper whole — in parts when long, never cut from the front', async () => {
  const b = await makeBook([['Mara kept the light.'], Array.from({ length: 30 }, (_, i) => `Paragraph ${i} of the long chapter, where the sea talks to the rocks for a long while and nobody listens. ` .repeat(12) + (i === 29 ? 'THE LAST WORDS OF IT.' : ''))], { manual: true });
  markAllSeen(b);
  const gone = b.ch(1);
  archivist.retireChapter(b.novelId, gone);
  store.change('novel', b.novelId, shape.novelSteps.removeChapter(gone.id), { now: true });
  await setHouse({ context: 16000, maxTokens: 1500 });
  await archivist.run(b.novelId);
  const asks = (await helperAsks()).map((r) => r.body.messages.at(-1).content);
  assert.ok(asks.length >= 2, `read in parts: ${asks.length}`);
  assert.ok(asks.some((x) => x.includes('THE LAST WORDS OF IT.')), 'its end reached the helper');
  assert.ok(asks.some((x) => x.includes('of what it held)')));
  assert.equal(archivist.pendingWork(b.novelId), false);
  await setHouse();
  await putAway(b);
});

await test('his correction of an Automatic text rides to the helper as his own words, and every word the helper is told never names a machine', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']]);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'JOVAN IS SIXTEEN.', at: 1, by: 'you' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'KEPT STYLE.', at: 1 }), { now: true });
  const novel = b.novel();
  const house = store.peek('house', 'house');
  const words = [
    prompts.helperFrame(house, novel),
    prompts.notesRequest({ novel, chapterLabel: 'Chapter One', before: 'Before.', changes: [{ text: 'New.', old: 'Old.' }], removed: ['Gone.'], removedChapters: ['A chapter.'], at: 1, of: 2 }),
    prompts.auditRequest({ novel, bookText: 'The book.', his: ['Mara'], partial: true, others: ['Tom'] }),
    prompts.keepRequest({ novel, keeps: ['about', 'style'], bookText: 'The book.' }),
    prompts.summaryRequest({ novel, chapterLabel: 'Chapter One', text: 'Words.', needsName: true, words: 300, part: 1, parts: 2, soFar: 'So far.', known: ['Mara'] }),
  ].join('\n\n');
  assert.ok(words.includes('JOVAN IS SIXTEEN.'), 'his correction is his own words to it');
  const hit = words.match(MACHINE);
  assert.equal(hit, null, `"${hit && hit[0]}" in "${hit && words.slice(Math.max(0, hit.index - 80), hit.index + 40)}"`);
  await putAway(b);
});

await test('a summary: an empty answer is asked again; one he wrote through the partner while it was being written stands; and a version brought back brings his summary back, never the one he corrected', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came.']], { manual: true });
  markAllSeen(b);
  const old = Date.now() - 3600000;
  for (const p of b.ch().passages) store.change('chapter', b.ids[0], (c) => { for (const x of c.passages) for (const v of x.versions) v.at = old; }, { now: true });
  await script([{ text: '{"summary": ""}' }, { text: '{"summary": "HELPER SUMMARY."}' }]);
  await archivist.run(b.novelId);
  assert.equal(b.ch().summary.text, 'HELPER SUMMARY.');
  assert.equal((await requests()).length, 2, 'the empty one asked again');
  /* he corrects it through the partner */
  const made = changes.makeChange(b.novelId, { summary: 1, text: 'HIS SUMMARY.', why: 'his' });
  assert.equal(made.status, 'made');
  /* the chapter changes, then the version before is brought back */
  const p = b.ch().passages[1];
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'Tom came, wet.' });
  store.change('chapter', b.ids[0], (c) => { for (const x of c.passages) for (const v of x.versions) v.at = old; }, { now: true });
  await reset();
  await script([{ text: '{}' }, { text: '{"summary": "AFTER THE EDIT."}' }]);
  await archivist.run(b.novelId);
  assert.equal(b.ch().summary.text, 'AFTER THE EDIT.');
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(p.id, b.ch().passages[1].versions[0].id), { now: true });
  await reset();
  await archivist.run(b.novelId);
  assert.equal(b.ch().summary.text, 'HIS SUMMARY.', 'his comes back with the version');
  await putAway(b);
});

await test('a page waits a few seconds for a reading of passages on its way — never for a summary', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom came.']], { manual: true });
  markAllSeen(b);
  store.change('chapter', b.ids[0], (c) => { for (const x of c.passages) for (const v of x.versions) v.at = Date.now() - 3600000; }, { now: true });
  /* a slow summary in flight */
  await script([{ text: JSON.stringify({ summary: 'A slow summary.' }), delay: 0.2, chunk: 2 }, { text: 'The page.' }]);
  const run = archivist.run(b.novelId);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(20);
  const t0 = Date.now();
  const page = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'On.', length: 'scene' });
  for (let i = 0; i < 300 && (await requests()).length < 2; i++) await sleep(20);
  const waited = Date.now() - t0;
  assert.ok(waited < 2500, `the page went out after ${waited} ms`);
  await page;
  await run;
  await putAway(b);
});

await test('a reading’s card changes laid again over a newer copy (a save turned away) never write over his edit made meanwhile in another window', () => {
  const before = { id: 'a', name: 'Mara', aka: [], about: 'Old.', now: '' };
  const after = { ...before, about: 'The helper’s.' };
  const fresh = { id: 'b', name: 'Tom', aka: [], about: 'New.', now: '' };
  const n = { notes: { people: [{ ...before, about: 'HIS EDIT.', updated: { by: 'you', at: 2 } }], places: [], lore: [], threads: [] } };
  shape.novelSteps.applyCards([{ kind: 'people', id: 'a', before, after }, { kind: 'people', id: 'b', before: null, after: fresh }])(n);
  assert.equal(n.notes.people[0].about, 'HIS EDIT.', 'his edit stands');
  assert.deepEqual(n.notes.people.map((c) => c.name), ['Mara', 'Tom'], 'a card new in the reading still comes in');
  /* and where the card still reads as it did, the reading lands */
  const m = { notes: { people: [{ ...before }], places: [], lore: [], threads: [] } };
  shape.novelSteps.applyCards([{ kind: 'people', id: 'a', before, after }])(m);
  assert.equal(m.notes.people[0].about, 'The helper’s.');
});

await test('a check asked of notes with no cards in them is let go at the next look — the notes never say they are being checked for good', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ auditAsked: true }), { now: true });
  await archivist.run(b.novelId);
  assert.equal(b.novel().memory.auditAsked, false);
  assert.ok(!(await requests()).some((r) => r.body.messages.at(-1).content.includes(prompts.AUDIT_ASK)), 'nothing asked');
  await putAway(b);
});

await test('notes longer than the helper’s model holds are fitted, never refused: the cards the passage names ride whole, the rest by their first line; the check goes through them a group at a time, in turn, the others named so none is added twice', async () => {
  const b = await makeBook([['Mara met Card7 at the gate.']], { manual: true });
  const filler = Array.from({ length: 40 }, (_, i) => `Fact ${i} about this one, long and particular, kept for good.`).join(' ');
  const people = Array.from({ length: 30 }, (_, i) => ({ id: `pe-${i}`, name: `Card${i}`, aka: [], about: `Card${i} is a person. ${filler}`, now: '' }));
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people, places: [], lore: [], threads: [] }), { now: true });
  await setHouse({ context: 32000 });
  await script([{ text: '{}' }]);
  await archivist.run(b.novelId);
  const ask = (await helperAsks())[0].body.messages.at(-1).content;
  assert.ok(ask.includes(`Card7 is a person. ${filler}`), 'the card the passage names, whole');
  assert.ok(ask.includes('- Card3 — Card3 is a person. Fact 0 about this one, long and particular, kept for good. …\n'), 'the others by their first line');
  assert.ok(ask.includes('shown by their first line'));
  assert.equal(archivist.pendingWork(b.novelId), false, 'read, never refused');
  /* the check: a group at a time */
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'These hold.' }) }]);
  await archivist.run(b.novelId);
  const audit = (await requests()).find((r) => r.body.messages.at(-1).content.includes(prompts.AUDIT_ASK)).body.messages.at(-1).content;
  assert.ok(audit.includes('The other cards, checked another time'), audit.slice(0, 300));
  const a = b.novel().memory.audit;
  assert.ok(a.some && a.some.checked > 0 && a.some.checked < 30 && a.some.all === 30, JSON.stringify(a.some));
  assert.equal(a.from, a.some.checked, 'the next check starts after these');
  await setHouse();
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
  assert.ok(sys.includes("What it's about:\nA lighthouse keeper finds a letter.\n\nAnd as the book stands now (the words above are right wherever the two differ):\nKEPT ABOUT."), sys.slice(sys.indexOf("What it's about"), sys.indexOf("What it's about") + 200));
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
  /* a short form of a card's name is named back with the card's own name, so it is put right in the same answer (2.6) */
  assert.match(v.changes[3].said, /there is no Oda in the notes — the card is called Oda Jovan/);
  assert.deepEqual(b.novel().notes.people.map((c) => c.name), ['Oda Jovan'], 'no card under the old name');
  /* set to wait, the card not there is said at once */
  assert.equal(changes.whyNot(b.novelId, { note: 'people', name: 'Zed', newName: 'Jovan Oda' }), 'there is no Zed in the notes to rename');
  assert.equal(changes.whyNot(b.novelId, { replace_all: true, find: 'Ann', replace: 'Beth', chapters: 'all' }), 'those words stand nowhere in those chapters', 'Annual and Anna are not Ann');
  await putAway(b);
});

await test('an Undo that can put back only part of a change says so; a passage a name change put back reads as the helper read it before — unless a card keeps the new name, and then it is read again, told the words it takes away', async () => {
  const b = await makeBook([['Lily ran.', 'Lily hid.']], { manual: true });
  markAllSeen(b);
  await script([{ text: '<changes>[{"rename": {"from": "Lily", "to": "Rose"}, "why": "x"}]</changes>\nRenamed.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Rose.' });
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
  /* the one put back reads as the helper read it before the name changed: only his edit is new to it */
  let ch = archivist.changesIn(b.novel(), b.ch());
  assert.deepEqual(ch.changes.map((c) => c.pid), [b.ch().passages[0].id], JSON.stringify(ch.changes));
  await putAway(b);
  /* a card that took the new name and was changed since keeps it: the passages put back are read again, told the words they lose */
  const c = await makeBook([['Lily ran.', 'Lily hid.']], { manual: true });
  store.change('novel', c.novelId, shape.novelSteps.putNote('people', { id: 'pe-l', name: 'Lily', about: 'A girl.' }), { now: true });
  markAllSeen(c);
  const r = changes.makeChange(c.novelId, { rename: { from: 'Lily', to: 'Rose' } });
  assert.equal(r.status, 'made', r.said);
  assert.equal(archivist.pendingWork(c.novelId), false, 'read already, renamed');
  store.change('novel', c.novelId, shape.novelSteps.putNote('people', { ...c.novel().notes.people[0], now: 'Hiding.' }), { now: true });
  assert.equal(changes.undoChange(c.novelId, r).ok, true);
  assert.equal(c.novel().notes.people[0].name, 'Rose', 'the card changed since keeps its name');
  assert.equal(picked(c.ch().passages[1]).text, 'Lily hid.');
  ch = archivist.changesIn(c.novel(), c.ch());
  const back = ch.changes.find((x) => x.pid === c.ch().passages[1].id);
  assert.equal(back && back.old, 'Rose hid.', JSON.stringify(ch.changes));
  await putAway(c);
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
  assert.equal(r.length, 2, JSON.stringify(r.map((x) => String(x.body.messages.at(-1).content).slice(0, 120))));
  const back = r[1].body.messages.at(-1).content;
  assert.ok(back.includes('[1.1] THE FIRST CHAPTER, WHOLE.') && back.includes('Here they are, whole. Go on with your answer.'), back.slice(0, 200));
  assert.equal(r[1].body.messages.at(-2).role, 'assistant');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.text, 'Having read it: it works.');
  assert.deepEqual(v.read, ['Chapter One']);
  await putAway(b);
});

await test('the partner’s blocks are read as meant: a block named in its words before the real one, curly quotes, a quote left unescaped; a block that cannot be read is said and asked for again — never told it sent no block', async () => {
  const b = await makeBook([['The lamp was cold. He said, "Go."']], { manual: true });
  await script([{ text: 'I’ll put it in a <changes> block:\n<changes>[{“passage”: “1.1”, “find”: “The lamp”, “replace”: “The old lamp”, “why”: “older”}]</changes>\nI changed the lamp.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Older lamp.' });
  let v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['made']);
  assert.ok(changes.wordsOf(v.text).startsWith('I’ll put it in a <changes> block:'), changes.wordsOf(v.text));
  assert.equal(picked(b.ch().passages[0]).text, 'The old lamp was cold. He said, "Go."');
  /* a quote left unescaped is mended; one that cannot be told apart is said, and asked again */
  await reset();
  await script([
    { text: '<changes>[{"passage": "1.1", "find": "He said, "Go."", "replace": "He said, \\"Run.\\"", "why": "faster"}]</changes>\nDone.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Run.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'made', JSON.stringify(v.changes[0]));
  await reset();
  await script([{ text: '<changes>[{"passage": "1.1", "text": "She said "no", then left."}]</changes>\nWritten anew.' }, { text: 'Leaving that one.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Rewrite it.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'refused');
  assert.match(v.changes[0].said, /changes block could not be read \(it began: \[\{"passage"/);
  const asks = (await requests()).map((r) => r.body.messages.at(-1).content);
  assert.equal(asks.length, 2, 'asked once more');
  assert.ok(asks[1].includes('its changes block could not be read') && !asks[1].includes('it holds no changes block'), asks[1].slice(0, 300));
  await putAway(b);
});

await test('the partner reads Chapter Three asked for in words; a read block that cannot be read is answered once with how to ask; past three reads what it asked is sent, and it is told to answer now', async () => {
  const b = await makeBook([['ONE WHOLE.'], ['TWO WHOLE.'], ['THREE WHOLE.'], ['FOUR WHOLE.']]);
  await script([
    { text: '<read>Chapter Three</read>' },
    { text: '<read>the bit where she leaves</read>' },
    { text: '<read>[1]</read>' },
    { text: '<read>[2]</read>' },
    { text: '<read>[4]</read>' },
    { text: 'Done reading.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[3], text: 'Read them.' });
  const r = (await requests()).map((x) => x.body.messages.at(-1).content);
  assert.equal(r.length, 6, r.map((x) => x.slice(0, 60)).join(' | '));
  assert.ok(r[1].includes('THREE WHOLE.'), 'Chapter Three, asked for in words, was read');
  assert.ok(r[2].includes('That read block could not be read'), r[2].slice(0, 200));
  assert.ok(r[5].includes('FOUR WHOLE.') && r[5].includes('That is all of the book one answer can read'), r[5].slice(-200));
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).text, 'Done reading.');
  await putAway(b);
});

await test('a partner reply cut off is said to be cut, and why; its changes cut off with it make nothing; and its reply has room enough for a block whatever Longest reply says', async () => {
  const b = await makeBook([['The lamp was cold.']], { manual: true });
  await setHouse({ maxTokens: 2000 });
  await script([{ text: '<changes>[{"passage": "1.1", "text": "A whole new passage that goes on and', finish: 'length' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Rewrite it.' });
  const r = await requests();
  assert.equal(r[0].body.max_tokens, talk.PARTNER_FLOOR, 'room for a block');
  /* and the room for it is kept when the book is fitted: never more asked than the model holds */
  const big = await makeBook([Array.from({ length: 40 }, (_, i) => `Passage ${i}. ` + 'The storm came in off the water like a held breath let go. '.repeat(30))], { manual: true });
  await setHouse({ maxTokens: 2000, context: 16000 }, CRAFTS_OFF);
  await reset();
  await script([{ text: 'Fine.' }]);
  await talk.partnerSay({ novelId: big.novelId, chapterId: big.ids[0], text: 'How is it?' });
  const q = (await requests())[0].body;
  const sent = q.messages.reduce((n, m) => n + util.estimateTokens(String(m.content)) + 8, 0);
  assert.ok(sent + q.max_tokens <= 16000, `${sent} sent + ${q.max_tokens} for the answer, in a model of 16,000`);
  await putAway(big);
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.cut, true);
  assert.match(v.cutWhy, /ran out of room/);
  assert.equal(b.ch().passages[0].versions.length, 1, 'nothing made from a block cut off');
  assert.equal(changes.changesComing(v.text), true);
  /* the writer still sends his Longest reply as he set it */
  await reset();
  await script([{ text: 'The lamp flared.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'On.' });
  assert.equal((await requests())[0].body.max_tokens, 2000);
  await setHouse();
  await putAway(b);
});

await test('set to wait, every kind of change is looked at as it arrives; one written whole over a passage he changed since is said at Apply, never laid over his words; a newer answer’s change for the same passage leaves the older one', async () => {
  const b = await makeBook([['The lamp was cold.']], { manual: true });
  await setHouse({}, { partnerApplies: 'wait' });
  await script([{ text: '<changes>[{"summary": 9, "text": "x"}, {"module": "No Such Module", "text": "y"}, {"rename": {"from": "Zed", "to": "Zee"}}, {"passage": "1.1", "text": "PARTNER WHOLE."}]</changes>\nFour.' }, { text: 'Leaving those.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Changes.' });
  let turn = store.peek('talk', b.novelId).turns.at(-1);
  let v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['refused', 'refused', 'refused', 'waiting'], JSON.stringify(v.changes.map((c) => c.said)));
  /* a newer answer for the same passage: the older one is left */
  await reset();
  await script([{ text: '<changes>[{"passage": "1.1", "text": "PARTNER WHOLE AGAIN."}]</changes>\nAgain.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Again.' });
  v = picked(store.peek('talk', b.novelId).turns.find((t) => t.id === turn.id));
  assert.equal(v.changes[3].status, 'skipped');
  assert.equal(v.changes[3].aside, true);
  /* he changes the passage himself; the newer one, applied, is said and never laid over his words */
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id, text: 'HIS OWN WORDS.' });
  turn = store.peek('talk', b.novelId).turns.at(-1);
  v = picked(turn);
  const out = talk.applyChange(b.novelId, turn.id, v.id, v.changes[0].id);
  assert.equal(out.ok, false);
  assert.match(out.said, /changed since this was offered/);
  assert.equal(picked(b.ch().passages[0]).text, 'HIS OWN WORDS.');
  await setHouse();
  await putAway(b);
});

await test('the partner’s card change: its Undo puts back only what it wrote once the helper has moved where they are now; a card it made goes again', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mara', aka: [], about: 'The keeper.', now: 'At the lamp.' }), { now: true });
  await script([{ text: '<changes>[{"note": "people", "name": "Mara", "about": "PARTNER ABOUT."}, {"note": "places", "name": "Crane Point", "about": "A light."}]</changes>\nDone.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Cards.' });
  /* the helper moves where she is now */
  const card = b.novel().notes.people[0];
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { ...card, now: 'THE HELPER’S NOW.' }), { now: true });
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  assert.equal(talk.undoOneChange(b.novelId, turn.id, v.id, v.changes[0].id).ok, true);
  const back = b.novel().notes.people[0];
  assert.deepEqual([back.about, back.now], ['The keeper.', 'THE HELPER’S NOW.']);
  assert.equal(talk.undoOneChange(b.novelId, turn.id, v.id, v.changes[1].id).ok, true);
  assert.deepEqual(b.novel().notes.places, []);
  await putAway(b);
});

await test('a passage in a chapter the partner only had in short is never written anew nor taken out: it is told to read it whole first — and once it has, the change is made', async () => {
  const para = (n) => 'The storm came in off the water like a held breath let go. '.repeat(n);
  const b = await makeBook([[para(170) + ' ONE-END'], [para(230) + ' TWO-END'], ['The third chapter, open now.']], { manual: true });
  for (let i = 0; i < 2; i++) store.change('chapter', b.ids[i], shape.chapterSteps.setSummary({ text: `SUMMARY ${i + 1}`, fp: shape.chapterPrint(b.ch(i)), at: Date.now() }), { now: true });
  await setHouse({ context: 16000 }, CRAFTS_OFF);
  /* the book rides with the first chapter in short: what it holds beside the second, whole */
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters: Object.fromEntries(b.ids.map((id, i) => [id, b.ch(i)])), conn: { ...CONN, context: 16000 }, purpose: 'partner', target: { chapterId: b.ids[2] }, request: 'x' });
  assert.ok(a.stats.wholeIds.includes(b.ids[1]), 'the second whole');
  assert.deepEqual(a.stats.wholeIds.includes(b.ids[0]), false, 'the first chapter rides in short');
  await script([
    { text: '<changes>[{"passage": "1.1", "text": "NEW WHOLE PASSAGE."}]</changes>\nRewrote it.' },
    { text: '<read>[1]</read>' },
    { text: '<changes>[{"passage": "1.1", "text": "NEW WHOLE PASSAGE."}]</changes>\nNow rewritten, having read it.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[2], text: 'Rewrite the opening.' });
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  const first = v.changes.find((c) => c.status === 'refused');
  assert.ok(first && /only in short/.test(first.said), JSON.stringify(v.changes));
  assert.equal(first.superseded, true, 'made in a later round: no longer shown as missed');
  assert.ok(v.changes.some((c) => c.status === 'made'));
  assert.equal(picked(b.ch(0).passages[0]).text, 'NEW WHOLE PASSAGE.');
  assert.ok(!changes.outcomeWords(v.changes).includes('couldn’t be made'), changes.outcomeWords(v.changes));
  await setHouse();
  await putAway(b);
});

await test('the same paragraph is never added twice to what the book is about; a find in the Automatic words it reads is made there, as his correction, with Undo', async () => {
  const b = await makeBook([['Mara kept the light.']]);
  store.change('novel', b.novelId, (n) => { n.brief = ''; }, { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'A keeper and KEPT WORDS here.', at: 1 }), { now: true });
  let made = changes.makeChange(b.novelId, { book: 'about', add: 'A NEW PARAGRAPH.' });
  assert.equal(made.status, 'made');
  made = changes.makeChange(b.novelId, { book: 'about', add: 'A NEW PARAGRAPH.' });
  assert.equal(made.status, 'refused');
  assert.match(made.said, /there already/);
  made = changes.makeChange(b.novelId, { book: 'about', find: 'KEPT WORDS', replace: 'KEPT LINES' });
  assert.equal(made.status, 'made', made.said);
  assert.deepEqual([b.novel().kept.about.text, b.novel().kept.about.by], ['A keeper and KEPT LINES here.', 'you']);
  assert.equal(changes.undoChange(b.novelId, made).ok, true);
  assert.equal(b.novel().kept.about.text, 'A keeper and KEPT WORDS here.');
  await putAway(b);
});

await test('a rename everywhere reaches the scenes — who he plays, where it starts, every telling — with Undo; two cards it leaves with one name are folded by the notes’ check', async () => {
  const b = await makeBook([['Jovn waited at the gate.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'pe-a', name: 'Jovn', aka: [], about: 'A typo of him.' }, { id: 'pe-b', name: 'Jovan', aka: [], about: 'The stranger.' }], places: [], lore: [], threads: [] }), { now: true });
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Jovn', from: 'Jovn at the gate' });
  store.change('play', playId, shape.turnSteps.addTurn(shape.newTurn('ai', 'Jovn nods.')), { now: true });
  const made = changes.makeChange(b.novelId, { rename: { from: 'Jovn', to: 'Jovan' } });
  assert.equal(made.status, 'made', made.said);
  const pl = store.peek('play', playId);
  assert.deepEqual([pl.who, pl.from, picked(pl.turns[0]).text], ['Jovan', 'Jovan at the gate', 'Jovan nods.']);
  assert.match(made.said, /1 scene/);
  assert.match(made.said, /two cards are now called Jovan/);
  assert.equal(b.novel().memory.auditAsked, true, 'the notes’ check is asked to fold them');
  assert.equal(changes.undoChange(b.novelId, made).ok, true);
  const back = store.peek('play', playId);
  assert.deepEqual([back.who, back.from, picked(back.turns[0]).text], ['Jovn', 'Jovn at the gate', 'Jovn nods.']);
  await putAway(b);
});

await test('Edit and ask again, then no answer: what it let go comes back as it was; Another answer is asked only of the newest answer', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: 'First answer.' }, { text: 'Second answer.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'First.' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Second.' });
  const turns = () => store.peek('talk', b.novelId).turns.map((t) => picked(t).text);
  assert.deepEqual(turns(), ['First.', 'First answer.', 'Second.', 'Second answer.']);
  /* Another answer, of an older answer: no */
  const older = store.peek('talk', b.novelId).turns[1];
  const again = await talk.partnerAgain({ novelId: b.novelId, chapterId: b.ids[0], turnId: older.id });
  assert.equal(again.ok, false);
  assert.match(again.error, /only the newest answer/);
  /* Edit and ask again on the second message; the ask fails: it all comes back */
  const second = store.peek('talk', b.novelId).turns[2];
  const cut = await talk.editAndAskAgain(b.novelId, second.id);
  assert.equal(cut.ok, true);
  assert.deepEqual(turns(), ['First.', 'First answer.']);
  await reset();
  await script([{ status: 500, message: 'down' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Second, said better.' });
  assert.equal(out.ok, false);
  assert.equal(out.putBack, true);
  assert.deepEqual(turns(), ['First.', 'First answer.', 'Second.', 'Second answer.'], 'what Edit and ask again let go is back');
  assert.equal(out.giveBack, 'Second, said better.', 'and his new words come back to the box');
  await putAway(b);
});

await test('a copy or a branch of a conversation with a long name has a name of its own, never longer than a name may be — it never hangs', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: 'An answer.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello.' });
  assert.equal((await talk.renameConversation(b.novelId, 'A very long conversation name for forty!')).ok, true);
  const names = [];
  for (let i = 0; i < 3; i++) {
    const out = await talk.copyConversation(b.novelId);
    assert.equal(out.ok, true, out.error);
    names.push(out.name);
  }
  assert.deepEqual(names.slice(0, 2).map((n) => n.replace(/^.*\(/, '(')), ['(copy)', '(copy 2)'], names.join(' | '));
  assert.equal(new Set(names).size, names.length, names.join(' | '));
  assert.ok(names.every((n) => n.length <= 40 && n.startsWith('A very long conversation') && /\(copy( \d+)?\)$/.test(n)), names.join(' | '));
  await putAway(b);
});

await test('the partner and Ideas never carry his page’s started reply — the writer still does', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await setHouse({ prefill: 'Yuhuu Hulk is here', prefillFlagField: 'prefix' });
  await script([{ text: 'An answer.' }, { text: '<direction>She lights it.</direction>' }, { text: ' and the page.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello.' });
  await talk.nextIdeas({ novelId: b.novelId, chapterId: b.ids[0], count: 1 });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'On.' });
  const r = await requests();
  assert.equal(r[0].body.messages.at(-1).role, 'user', 'the partner: no started reply');
  assert.equal(r[1].body.messages.at(-1).role, 'user', 'Ideas: no started reply');
  assert.equal(r[2].body.messages.at(-1).role, 'assistant', 'the page: his started reply');
  assert.ok(String(r[2].body.messages.at(-1).content).includes('Yuhuu Hulk is here'));
  await setHouse();
  await putAway(b);
});

await test('the partner’s change read as meant: a passage given as a number is never guessed (2.10 is not 2.1); a yes in words takes a passage out', async () => {
  const b = await makeBook([['One.', 'Two.']], { manual: true });
  const n = changes.makeChange(b.novelId, { passage: 1.10, remove: true });
  assert.equal(n.status, 'refused');
  assert.match(n.said, /as words in quotes/);
  const yes = changes.makeChange(b.novelId, { passage: '1.2', remove: 'true' });
  assert.equal(yes.status, 'made', yes.said);
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['One.']);
  assert.equal(changes.makeChange(b.novelId, { book: 'toString', text: 'x' }).status, 'refused', 'no part of the book but its own');
  await putAway(b);
});

await test('every round of a partner’s answer keeps its thinking; a reply that only thought keeps it, with why no words came', async () => {
  const b = await makeBook([['ONE WHOLE.'], ['Two.']], { manual: true });
  await script([{ text: '<read>[1]</read>', think: 'FIRST THOUGHT.' }, { text: '<read>[2]</read>', think: 'SECOND THOUGHT.' }, { text: 'Read them.', think: 'THIRD THOUGHT.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[1], text: 'Read one.' });
  let v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.thinking, 'FIRST THOUGHT.\n\n— read Chapter One, then —\n\nSECOND THOUGHT.\n\n— read Chapter Two, then —\n\nTHIRD THOUGHT.', v.thinking);
  await reset();
  await script([{ text: '', think: 'ONLY THOUGHT, NO WORDS.' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[1], text: 'Think.' });
  assert.equal(out.ok, false);
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.thinking, 'ONLY THOUGHT, NO WORDS.');
  assert.match(v.cutWhy, /only thought/);
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-2)).text, 'Think.', 'his message stays with it');
  await putAway(b);
});

await test('the oldest talk let go for room is said to be left out', () => {
  const rec = { turns: Array.from({ length: 30 }, (_, i) => shape.newTurn(i % 2 ? 'ai' : 'you', `Turn ${i}. ` + 'words '.repeat(200))) };
  const out = talk.turnsFor(rec, { conn: { ...CONN, context: 8000 } });
  assert.ok(out.length < 30);
  assert.ok(out[0].content.startsWith('(The earliest part of our talk is left out here, to save room.)'), out[0].content.slice(0, 80));
});

await test('words the partner fixes in place keep what their passage was — cut short, its Go on stays; a passage written anew is new; and where the words it replaced still stand is said', async () => {
  const b = await makeBook([[{ text: 'Her green eyes were cold and', cut: true, cutWhy: 'length' }, 'His green eyes were warm.']], { manual: true });
  const made = changes.makeChange(b.novelId, { passage: '1.1', find: 'green eyes', replace: 'grey eyes' });
  assert.equal(made.status, 'made', made.said);
  const v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.cut], ['Her grey eyes were cold and', true]);
  assert.match(made.said, /still stand in 1\.2/);
  const anew = changes.makeChange(b.novelId, { passage: '1.1', text: 'A passage written anew.' });
  assert.equal(picked(b.ch().passages[0]).cut, undefined);
  void anew;
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
  assert.ok(duels[0].includes('How I want the book written') && duels[0].includes('HIS OWN WORDS FIRST'), 'what the writer is told');
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

await test('the checker and the judge are told what the writer is told: his words for how it is written, his note at the end, the chapters before by their summaries', async () => {
  await setHouse({}, { checksFrom: 0, instructions: { system: 'Short punchy fragments. Present tense.', late: 'Keep Mara quiet.', partner: '' } });
  const b = await makeBook([['The storm broke.'], ['Morning came.']]);
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: 'CHAPTER ONE SUMMARY: the storm, the bottle.', fp: shape.chapterPrint(b.ch(0)) }), { now: true });
  await checker.runCheck(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content);
  const two = asks.find((a) => a.includes('Check these passages from Chapter Two'));
  assert.ok(two.includes('How I want the book written — what the writer is told; nothing it asks for is ever a fault:\n"""\nShort punchy fragments. Present tense.\n\nKeep Mara quiet.\n"""'), two.slice(0, 600));
  assert.ok(two.includes('The story so far, chapter by chapter:') && two.includes('CHAPTER ONE SUMMARY: the storm, the bottle.'), 'the chapters before');
  assert.ok(two.includes('nothing I ask the writer for (above) is one'));
  assert.ok(!asks.find((a) => a.includes('Check these passages from Chapter One')).includes('The story so far'), 'the first chapter has none before it');
  await setHouse();
  await putAway(b);
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
  /* room enough for some of the chapter beside everything that must go (at 12,000 only the mark that the middle is left out fitted) */
  await setHouse({ context: 14000 }, CRAFTS_OFF);
  await script([{ text: 'Let me look first. <read>[1]</read>' }, { text: 'Having read it: it works.' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[1], text: 'How is chapter one?' });
  assert.equal(out.ok, true, out.error);
  const r = await requests();
  assert.equal(r.length, 2, JSON.stringify(r.map((x) => [x.body.max_tokens, String(x.body.messages.at(-1).content).slice(0, 100)])));
  const back = r[1].body.messages.at(-1).content;
  assert.ok(back.includes('THE OPENING OF ONE.') && back.includes('THE END OF ONE.') && back.includes('the middle of this chapter is left out here'), back.slice(0, 300));
  assert.ok(back.includes('as much of each as fits here'), back.slice(-200));
  const sent = r[1].body.messages.reduce((n, m) => n + util.estimateTokens(String(m.content)) + 8, 0);
  assert.ok(sent + 6000 <= 14000, `it fits the model's 14,000 with the answer's 6,000: ${sent} tokens sent`);
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

/* =================================================== Cozy Tavern's page fixes, made for a book */
heading('a page: what Cozy Tavern learned');

const usageMod = await import(path.join(ROOT, 'js/model/usage.js'));
const goodEnd = ' and the passage goes on long enough to clear the eighty characters the pattern asks for.';

await test('a structured answer whose text closed is let go at once — the padding after it is never waited for, and the provider is hung up on', async () => {
  await setHouse({ prefill: 'Mara [[w:1-3]]', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  await script([{ deltas: [{ content: '{"response":"Mara walked' }, { content: goodEnd + '"' }, { content: '}' }], pad_for: 4, pad: '   ' }]);
  const t0 = Date.now();
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const took = Date.now() - t0;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(took < 2500, `let go at once, never read to the provider's end (${took} ms)`);
  const v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara walked' + goodEnd);
  assert.ok(!v.cut, 'whole: it closed on a full stop');
  await sleep(600);
  assert.ok((await requests())[0].hung_up, 'the line to the provider was cut, so it stops writing (and billing) padding');
  await setHouse();
  await putAway(b);
});

await test('a structured answer that closed in the middle of a sentence is kept, cut short — and Go on carries it on with no template and no started reply', async () => {
  await setHouse({ prefill: 'Mara [[w:1-3]]', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  await script([{ deltas: [{ content: '{"response":"Mara walked' + goodEnd.replace(/\.$/, '') + ' and she said ' }, { content: '"}' }] }, { text: 'more words to end it.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true, JSON.stringify(r));
  let v = picked(b.ch().passages[0]);
  assert.equal(v.cut, true);
  assert.match(v.cutWhy, /closed mid-sentence/);
  const g = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id });
  assert.equal(g.ok, true, JSON.stringify(g));
  const sent = (await requests())[1].body;
  assert.ok(!sent.response_format, 'Go on is never held to the template: it would begin the passage again in its middle');
  assert.equal(sent.messages.at(-1).role, 'user', 'nor given a started reply');
  v = picked(b.ch().passages[0]);
  assert.ok(v.text.endsWith('and she said more words to end it.'), v.text);
  assert.ok(!v.cut);
  await setHouse();
  await putAway(b);
});

await test('a structured answer that keeps sending and never makes words is let go, and the page says why', async () => {
  globalThis.__cozyStructuredStallMs = 300;
  await setHouse({ prefill: 'Mara [[w:1-3]]', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  try {
    await script([{ pad_for: 5, pad: '                    ' }]);
    const t0 = Date.now();
    const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
    assert.ok(Date.now() - t0 < 3500, 'let go long before the provider would have stopped');
    assert.equal(r.ok, false);
    assert.match(r.error, /stopped making progress/);
    assert.equal(b.ch().passages.length, 0, 'no empty passage is left');
  } finally { delete globalThis.__cozyStructuredStallMs; }
  await setHouse();
  await putAway(b);
});

await test('a structured answer written in the thinking channel becomes the page, its own thinking kept as thinking', async () => {
  await setHouse({ prefill: 'Mara [[w:1-3]]', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  await script([{ deltas: [{ reasoning_content: 'I will write it now. ' }, { reasoning_content: JSON.stringify({ response: 'Mara walked' + goodEnd }) }] }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara walked' + goodEnd);
  assert.equal(v.thinking, 'I will write it now.');
  await setHouse();
  await putAway(b);
});

await test('a provider that does not hold the structured template is noticed: remembered for the model, said once, the next page goes as written', async () => {
  await setHouse({ prefill: 'Mara [[w:1-3]]', prefillMode: 'structured' });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'Hello there, here is a page that ignored the shape it was asked for.' }, { text: 'A page as written.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Hello there, here is a page that ignored the shape it was asked for.', 'its words are never lost');
  assert.ok((v.notes || []).join(' ').includes('did not hold the structured prefill'), JSON.stringify(v.notes));
  await store.flush('house', 'house');
  assert.ok(providers.learnedFacts(store.peek('house', 'house').connections[0]).structuredDown, 'kept for the model');
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(!(await requests())[1].body.response_format, 'the next page goes as written');
  /* a page held to it is never judged so */
  await setHouse({ prefill: 'Mara [[w:1-3]]', prefillMode: 'structured' });
  await reset();
  await script([{ text: JSON.stringify({ response: 'Mara walked' + goodEnd }) }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(!providers.learnedFacts(store.peek('house', 'house').connections[0]), 'held: nothing learned');
  await setHouse();
  await putAway(b);
});

await test('Go on and rewriting selected words never carry his started reply — only his thinking seed rides; a new page still gets both', async () => {
  await setHouse({ prefill: '<think>Seed words</think>Yuhuu Hulk is here', prefillFlagField: 'prefix' });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: ' the night was long', finish: 'length' }, { text: ' and then it was over.' }, { text: 'quiet' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const p = () => b.ch().passages[0];
  assert.equal(picked(p()).text, 'Yuhuu Hulk is here the night was long', 'a new page opens with his words');
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: p().id });
  const text = picked(p()).text;
  assert.equal(text, 'Yuhuu Hulk is here the night was long and then it was over.', 'never “Yuhuu” in the middle of the passage');
  const at = text.indexOf('night');
  await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: p().id, start: at, end: at + 5, note: 'calmer' });
  const [first, goOn, sel] = (await requests()).map((x) => x.body.messages.at(-1));
  assert.equal(first.role, 'assistant');
  assert.equal(first.content, 'Yuhuu Hulk is here');
  assert.equal(first.reasoning_content, 'Seed words');
  for (const m of [goOn, sel]) {
    assert.equal(m.role, 'assistant', 'the seed rides');
    assert.equal(m.content, '', 'his opening words do not');
    assert.equal(m.reasoning_content, 'Seed words');
  }
  const last = picked(p()).text;
  assert.ok(last.includes('the quiet was long') && last.split('Yuhuu').length === 2, last);
  await setHouse();
  await putAway(b);
});

await test('a control token a provider leaks is cut from the page, the words before kept and said', async () => {
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'Mara walked home in the rain.<|im_end|>\n<|im_start|>user\nWrite more.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true);
  const v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara walked home in the rain.');
  assert.ok((v.notes || []).some((n) => n.includes('leak')), JSON.stringify(v.notes));
  /* a page that was nothing but the leak leaves no passage, and says why */
  await script([{ text: '<|eot_id|>' }]);
  const e = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(e.ok, false);
  assert.match(e.error, /nothing before the provider’s own markers/);
  assert.equal(b.ch().passages.length, 1);
  await putAway(b);
});

await test('an answer that ran past its end and wrote his next message itself is cut where it began; his words quoted in the story stay', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  const line = 'Tell me honestly whether the lighthouse chapter drags in the middle part.';
  const story = 'It drags a little in the middle, where the storm waits too long. '.repeat(3);
  await script([{ text: `${story}\n\nUser: ${line}\n\nAssistant: It does not drag at all.` }, { text: `You asked: "${line}" — and it does, a little.` }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: line });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: line });
  const rec = store.peek('talk', b.novelId);
  const answers = rec.turns.filter((t) => t.by !== 'you').map((t) => picked(t));
  assert.equal(answers[0].text, story.trim(), 'the run-on goes');
  assert.ok((answers[0].notes || []).some((n) => n.includes('ran past the end')), JSON.stringify(answers[0].notes));
  assert.equal(answers[1].text, `You asked: "${line}" — and it does, a little.`, 'his words inside the answer are the answer');
  await putAway(b);
});

await test('a reply that thought aloud and closed a thought it never opened keeps only what follows — streamed, and stopped by hand too', async () => {
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'I should open on the rain and keep it short.</think>\n\nMara walked home in the rain.', chunk: 6 }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara walked home in the rain.');
  assert.equal(v.thinking, 'I should open on the rain and keep it short.');
  await script([{ hang_after: 'Plan the scene.</think>Rain fell on' }]);
  const going = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await sleep(500);
  writer.stop(b.novelId);
  const r = await going;
  assert.equal(r.ok, true, JSON.stringify(r));
  const w = picked(b.ch().passages[1]);
  assert.equal(w.text, 'Rain fell on');
  assert.equal(w.thinking, 'Plan the scene.');
  assert.equal(w.stopped, true);
  await putAway(b);
});

await test('thinking asked for, and none came back, is said quietly with the page', async () => {
  await setHouse({ thinking: 'high' });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'A page with no thinking.' }, { text: 'A page that thought.', think: 'It thought.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const [one, two] = b.ch().passages.map((p) => picked(p));
  assert.ok((one.notes || []).some((n) => n.includes('Thinking was asked for, and none came back')), JSON.stringify(one.notes));
  assert.ok(!(two.notes || []).some((n) => n.includes('none came back')));
  await setHouse({ thinking: 'off' });
  await script([{ text: 'Off: nothing to say.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(!(picked(b.ch().passages[2]).notes || []).some((n) => n.includes('none came back')));
  await setHouse();
  await putAway(b);
});

await test('a page that only thought, or was stopped while it thought, hands its thinking back with the reason — no empty passage', async () => {
  const b = await makeBook([[]], { manual: true });
  await script([{ text: '', think: 'A long thought about the storm that never became a page.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, false);
  assert.match(r.error, /only thought/);
  assert.equal(r.thought, 'A long thought about the storm that never became a page.');
  assert.equal(b.ch().passages.length, 0);
  await script([{ think: 'Still thinking about the harbour', hang_after: '' }]);
  const going = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await sleep(500);
  writer.stop(b.novelId);
  const s = await going;
  assert.equal(s.stopped, true);
  assert.equal(s.thought, 'Still thinking about the harbour');
  assert.equal(b.ch().passages.length, 0);
  await putAway(b);
});

await test('Go on keeps the first part’s thinking and its request beside its own; a Go on that brings nothing leaves both as they were', async () => {
  const b = await makeBook([[]], { manual: true });
  /* the last brings only space, slowly enough that the page keeps what it has meanwhile (with its thinking) */
  await script([{ text: 'Mara walked', think: 'FIRST THOUGHT', finish: 'length' }, { text: ' home.', think: 'SECOND THOUGHT' }, { text: '    ', think: 'FAILED THOUGHT', chunk: 1, delay: 1.1 }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She walks.' });
  const pid = b.ch().passages[0].id;
  const first = picked(b.ch().passages[0]);
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid });
  let v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara walked home.');
  assert.ok(v.thinking.startsWith('FIRST THOUGHT') && v.thinking.endsWith('SECOND THOUGHT') && v.thinking.includes('carrying it on'), v.thinking);
  assert.equal(v.sent, first.sent, 'the first part’s request stays its own');
  assert.equal((v.sentMore || []).length, 1);
  await sleep(200);
  const one = await (await realFetch(`${BASE}/api/sent/${b.novelId}/${v.sent}`)).json();
  const two = await (await realFetch(`${BASE}/api/sent/${b.novelId}/${v.sentMore[0]}`)).json();
  assert.ok(JSON.stringify(one.body.messages).includes('She walks.'), 'the first request kept as it went');
  assert.notEqual(JSON.stringify(one.body.messages), JSON.stringify(two.body.messages), 'and the Go on’s beside it');
  /* cut it again by hand, then a Go on that brings nothing */
  store.change('chapter', b.ids[0], shape.chapterSteps.setVersion(pid, v.id, { cut: true, cutWhy: 'test' }), { now: true });
  const g = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid });
  assert.equal(g.ok, false);
  v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara walked home.');
  assert.ok(!v.thinking.includes('FAILED THOUGHT'), 'never the thinking of the call that brought nothing');
  assert.ok(v.thinking.includes('SECOND THOUGHT'));
  assert.equal(v.cut, true, 'still cut, so Go on is still offered');
  await putAway(b);
});

await test('words changed inside a passage cut short keep its Go on — his edit, the checker’s fix — but an ending he wrote himself does not', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([[{ text: 'Mara climbed the the stair and looked out over the grey water toward the', cut: true, cutWhy: 'it reached the reply length' }]]);
  const pid = b.ch().passages[0].id;
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'Mara climbed the stair and looked out over the grey water toward the' });
  let v = picked(b.ch().passages[0]);
  assert.equal(v.how, 'edit');
  assert.equal(v.cut, true, 'a word fixed in the middle: it still stops where it stopped');
  assert.equal(v.cutWhy, 'it reached the reply length');
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'Mara climbed the stair and looked out over the grey water toward the lighthouse.' });
  assert.ok(!picked(b.ch().passages[0]).cut, 'he finished it himself');
  /* back to the cut version, and the checker's fix of a word inside it */
  const cutId = b.ch().passages[0].versions[1].id;
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(pid, cutId), { now: true });
  checker.checkBook(b.novelId);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'grey water', replace: 'gray water', why: 'spelling' }] }) }]);
  await checker.runCheck(b.novelId);
  const s = checker.suggestions(b.novelId).find((x) => x.item.find === 'grey water');
  assert.ok(s, JSON.stringify(checker.suggestions(b.novelId)));
  assert.equal(checker.applyOne(b.novelId, s.chapterId, s.passageId, s.item.id).ok, true);
  v = picked(b.ch().passages[0]);
  assert.equal(v.how, 'suggested');
  assert.equal(v.cut, true, 'the checker’s fix keeps its Go on');
  await setHouse();
  await putAway(b);
});

await test('a few words rewritten in a passage cut at its end leave it cut at its end — and Go on carries it on', async () => {
  const b = await makeBook([[{ text: 'Mara climbed the stair and looked out over the water toward the', cut: true, cutWhy: 'it reached the reply length' }]], { manual: true });
  const pid = b.ch().passages[0].id;
  const full = picked(b.ch().passages[0]).text;
  const at = full.indexOf('climbed');
  await script([{ text: 'ran up' }, { text: ' lighthouse.' }]);
  const r = await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, start: at, end: at + 'climbed'.length, note: 'faster' });
  assert.equal(r.ok, true, JSON.stringify(r));
  let v = picked(b.ch().passages[0]);
  assert.equal(v.how, 'selection');
  assert.equal(v.text, 'Mara ran up the stair and looked out over the water toward the');
  assert.equal(v.cut, true);
  assert.equal(v.endCut, true);
  const g = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid });
  assert.equal(g.ok, true, JSON.stringify(g));
  v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'Mara ran up the stair and looked out over the water toward the lighthouse.');
  assert.ok(!v.cut && !v.endCut);
  await putAway(b);
});

await test('a book or chapter removed while it is being written stops the writing at once — the provider is hung up on', async () => {
  const b = await makeBook([[], []], { manual: true });
  await script([{ hang_after: 'Some words and then' }]);
  const going = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[1] });
  await sleep(400);
  assert.equal(writer.stopIn(b.novelId, b.ids[0]), false, 'another chapter: the writing goes on');
  assert.equal(writer.busy(b.novelId), true);
  assert.equal(writer.stopIn(b.novelId, b.ids[1]), true);
  const r = await going;
  assert.equal(r.gone, true, JSON.stringify(r));
  await sleep(500);
  assert.ok((await requests())[0].hung_up, 'the provider stops writing (and billing)');
  await putAway(b);
});

await test('thinking under a field name of its own is read as thinking', async () => {
  const b = await makeBook([[]], { manual: true });
  await script([{ deltas: [{ reasoning_text: 'A thought in a new field.' }], text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const v = picked(b.ch().passages[0]);
  assert.equal(v.text, 'A page.');
  assert.equal(v.thinking, 'A thought in a new field.');
  await putAway(b);
});

await test('every call is counted the way its provider counts it: Kimi’s count inside the choice and what came from its cache, Claude’s writes into its cache, the prices it had', async () => {
  await realFetch(BASE + '/api/usage/clear', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  await setHouse({ priceIn: 1, priceOut: 2 });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'A page.', usage_in_choice: { prompt_tokens: 1000, completion_tokens: 20, cached_tokens: 600 } }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await sleep(300);
  let u = await (await realFetch(BASE + '/api/usage')).json();
  let row = Object.values(u.days).flatMap((d) => Object.entries(d)).find(([k]) => k.endsWith('|scripted'))[1];
  assert.equal(row.in, 1000);
  assert.equal(row.out, 20);
  assert.equal(row.cached, 600, 'Kimi’s cached tokens');
  assert.deepEqual(row.prices, { in: 1, out: 2 }, 'the prices it had, kept with the count');
  /* the connection let go: still priced as it was */
  assert.equal(usageMod.costOf(row, null), (400 * 1 + 600 * 1 + 20 * 2) / 1e6);
  /* Claude: its cache writes apart, at 1.25 times */
  const claude = { url: 'https://api.anthropic.com/v1', model: 'claude-x', priceIn: 3, priceOut: 15, priceCached: 0.3 };
  call.noteUsage(claude, call.countOf({ input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 400, output_tokens: 10 }), { tokens: 1 }, 'x');
  await sleep(300);
  u = await (await realFetch(BASE + '/api/usage')).json();
  row = Object.values(u.days).flatMap((d) => Object.entries(d)).find(([k]) => k.endsWith('|claude-x'))[1];
  assert.equal(row.in, 1500);
  assert.equal(row.cached, 1000);
  assert.equal(row.cacheWrite, 400);
  assert.equal(row.anthropic, true);
  assert.ok(Math.abs(usageMod.costOf(row, claude) - (100 * 3 + 1000 * 0.3 + 400 * 3 * 1.25 + 10 * 15) / 1e6) < 1e-12, String(usageMod.costOf(row, claude)));
  assert.equal(usageMod.costOf({ in: 10, out: 10 }, { priceIn: undefined }), null, 'no price, no money');
  await setHouse();
  await putAway(b);
});

async function setModels(data) { await realFetch(PROVIDER + '/models', { method: 'POST', body: JSON.stringify({ data }) }); }

await test('a model typed by hand is looked up on its provider’s list once: its room and its thinking levels, kept for that model at that address', async () => {
  await setModels([{ id: 'scripted', context_length: 500000, reasoning_parameters: { efforts: ['none', 'low', 'high'] } }]);
  await setHouse({ thinking: 'medium' });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'A page.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const conn = store.peek('house', 'house').connections[0];
  assert.equal(conn.identFor, `scripted@${PROVIDER}/v1`);
  assert.equal(providers.contextOf(conn), 500000, 'the room its provider reports');
  const body = (await requests())[0].body;
  assert.equal(body.reasoning_effort, 'low', 'one of the levels it declares, the nearest below medium');
  assert.ok(!('thinking' in body) && !('enable_thinking' in body), 'never a family’s own switch');
  /* the same connection pointed at another address: what was said of the model there is not this one's */
  assert.equal(providers.contextOf({ ...conn, url: 'https://elsewhere.example/v1' }), 128000);
  assert.equal(providers.declaredEfforts({ ...conn, url: 'https://elsewhere.example/v1' }), null);
  /* a room too small for his instructions and the craft: said before anything is sent */
  await setModels([{ id: 'scripted', context_length: 3000 }]);
  await setHouse();
  await reset();
  await setModels([{ id: 'scripted', context_length: 3000 }]);
  const small = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(small.ok, false);
  assert.match(small.error, /3,000/);
  assert.equal((await requests()).length, 0, 'nothing is sent to a model that cannot hold it');
  await setHouse();
  await putAway(b);
});

await test('the speed test times the writing from the first real word to the last, never the thinking it hid', async () => {
  await setHouse();
  /* a stream that opens with a chunk of only space — on the thinking channel, which nothing holds back — then a silence */
  await script([{ deltas: [{ reasoning_content: '\n' }], pause: 0.6, text: 'Rain on the window. '.repeat(30), chunk: 40, delay: 0.04,
    usage: { prompt_tokens: 20, completion_tokens: 1300, completion_tokens_details: { reasoning_tokens: 1000 } } }]);
  const m = await call.measureSpeed(store.peek('house', 'house').connections[0]);
  assert.ok(m.firstMs >= 550, `the clock starts on the first real word, not on a chunk of space (${m.firstMs} ms)`);
  assert.equal(m.tokens, 300, 'the thousand thinking tokens it never showed are not writing');
  assert.equal(m.estimated, false);
  assert.ok(m.tps > 0 && m.tps < 10000, String(m.tps));
});

await test('Claude gets the note at the end as a system message after his request — and a model that refuses it learns so once, the note riding with his request', async () => {
  await setHouse({ shape: 'anthropic' }, { instructions: { system: 'HIS OWN WORDS FIRST', late: 'THE NOTE AT THE END', partner: '' } });
  const b = await makeBook([[]], { manual: true });
  const page = [
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A page for Claude.' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
  await script([{ status: 400, message: 'messages: Unexpected role "system". The Messages API accepts a top-level `system` parameter, not "system" as an input message role.' }, { events: page }, { events: page }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [first, second] = (await requests()).map((x) => x.body);
  assert.equal(first.messages.at(-1).role, 'system', 'sent as a system message after his request');
  assert.equal(first.messages.at(-1).content, 'THE NOTE AT THE END');
  assert.ok(second.messages.every((m) => m.role !== 'system'), 'refused once: it rides with his request');
  assert.ok(JSON.stringify(second.messages.at(-1).content).includes('THE NOTE AT THE END'));
  assert.equal(picked(b.ch().passages[0]).text, 'A page for Claude.');
  assert.ok((picked(b.ch().passages[0]).notes || []).some((n) => n.includes('takes no system message after the request')));
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal((await requests()).length, 3, 'remembered: no refusal on the next page');
  await setHouse();
  await putAway(b);
});

await test('{{user}} and {{char}} from a SillyTavern preset never reach a model: his name, the one he plays, who the words are for', async () => {
  await setHouse({}, { checksFrom: 0, you: { name: 'Bruce' }, instructions: { system: 'Write for {{user}}, never as {{char}}.', late: 'Remember <USER>.', narrator: '{{user}} is mine; {{char}} tells the rest.', partner: '{{char}} talks with {{user}}.' } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const sent = JSON.stringify((await requests())[0].body.messages);
  assert.ok(sent.includes('Write for Bruce, never as the writer.') && sent.includes('Remember Bruce.'), sent.slice(0, 300));
  assert.ok(!/\{\{|<USER>|<BOT>/.test(sent));
  const house = store.peek('house', 'house');
  const chapters = { [b.ids[0]]: b.ch() };
  const scene = context.assemble({ house, novel: b.novel(), chapters, conn: CONN, purpose: 'play', target: { chapterId: b.ids[0] }, request: 'I walk.', play: { who: 'Mara' } });
  assert.ok(scene.system.includes('Mara is mine; the narrator tells the rest.'), scene.system.slice(0, 200));
  const partner = context.assemble({ house, novel: b.novel(), chapters, conn: CONN, purpose: 'partner', target: { chapterId: b.ids[0] }, request: 'Hi.' });
  assert.ok(partner.system.includes('my partner talks with Bruce.'), partner.system.slice(0, 200));
  /* with no name of his: plain words */
  assert.equal(prompts.withMacros('For {{user}}.', prompts.macroNames({ you: {} }, 'write')), 'For me.');
  /* the checker holds the page to his words as the writer is told them */
  await reset();
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  await checker.runCheck(b.novelId);
  const asked = (await requests()).map((x) => JSON.stringify(x.body.messages)).find((x) => x.includes('Check these passages'));
  assert.ok(asked && asked.includes('Write for Bruce') && !asked.includes('{{user}}'), String(asked).slice(0, 200));
  await setHouse();
  await putAway(b);
});

/* =================================================== the checker: what Cozy Tavern learned */
heading('the checker: what Cozy Tavern learned');

const checkAsk = async () => (await requests()).map((x) => String(x.body.messages.at(-1).content || '')).filter((m) => m.includes('Check these passages from'));
const checkedPart = (m) => m.slice(m.indexOf('Check these passages from'));

await test('by itself the checker never reads a page cut short or stopped — it waits for its Go on; asked to check the chapter, it reads it', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['A whole page that ends.', { text: 'A page cut short in the middle of', cut: true, cutWhy: 'it reached the reply length' }]]);
  await script([{ text: JSON.stringify({ edits: [] }) }, { text: JSON.stringify({ edits: [] }) }]);
  await checker.runCheck(b.novelId);
  let asked = await checkAsk();
  assert.equal(asked.length, 1);
  assert.ok(checkedPart(asked[0]).includes('A whole page that ends.') && !checkedPart(asked[0]).includes('cut short in the middle'), checkedPart(asked[0]).slice(0, 300));
  await reset();
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  checker.checkChapter(b.novelId, b.ids[0]);
  await checker.runCheck(b.novelId);
  asked = await checkAsk();
  assert.ok(asked.length === 1 && checkedPart(asked[0]).includes('cut short in the middle'), 'asked: it reads it');
  await setHouse();
  await putAway(b);
});

await test('the checker’s fixes put in by themselves never touch a page cut short', async () => {
  await setHouse({}, { checksFrom: 0, autoFix: { on: true, from: 0 } });
  const b = await makeBook([[{ text: 'Mara climbed the the stair toward the', cut: true, cutWhy: 'it reached the reply length' }]]);
  checker.checkChapter(b.novelId, b.ids[0]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the stair', replace: 'the stair', why: 'doubled' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(b.ch().passages[0].versions.length, 1, 'left for him: it waits for its Go on');
  assert.equal(checker.suggestions(b.novelId).length, 1, 'and the fix is still offered');
  await setHouse();
  await putAway(b);
});

await test('Apply all puts every fix in at once, on the words as they were checked — two fixes that swap words never undo each other, and none goes unseen', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['The grey sea met the black sky.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'humanize', find: 'grey', replace: 'black', why: 'darker' },
    { passage: '1.1', kind: 'humanize', find: 'black', replace: 'grey', why: 'paler' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.suggestions(b.novelId).length, 2);
  assert.equal(checker.applyAll(b.novelId), 2);
  assert.equal(picked(b.ch().passages[0]).text, 'The black sea met the grey sky.');
  assert.equal(b.ch().passages[0].versions.length, 2, 'one new version for the whole checking');
  await setHouse();
  await putAway(b);
});

await test('a fix the checker types with plain dashes and dots is found where the book has “—” and “…”', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['She waited — and then… the door opened slowly.']]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'humanize', find: 'waited -- and then... the door opened slowly', replace: 'waited, and the door opened', why: 'plainer' }] }) }]);
  await checker.runCheck(b.novelId);
  const s = checker.suggestions(b.novelId);
  assert.equal(s.length, 1, 'kept, not dropped for its typing');
  assert.equal(s[0].item.find, 'waited — and then… the door opened slowly', 'as the words stand in the book');
  assert.equal(checker.applyOne(b.novelId, s[0].chapterId, s[0].passageId, s[0].item.id).ok, true);
  assert.equal(picked(b.ch().passages[0]).text, 'She waited, and the door opened.');
  await setHouse();
  await putAway(b);
});

await test('the checker is told what he asked for in each passage, that the notes’ “right now” is the end of the book, and that a character’s lie is the story', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([[{ text: '“I’m nineteen,” Yuna said, grinning.', ask: { direction: 'Yuna lies about her age to get in.', length: 'scene' } }]]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Yuna', about: 'Seventeen.', now: 'At the harbour, years later.' })), { now: true });
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  await checker.runCheck(b.novelId);
  const [asked] = await checkAsk();
  assert.ok(asked.includes('[1.1] Yuna lies about her age to get in.'), asked.slice(0, 400));
  assert.ok(asked.includes('never at these passages') && asked.includes('Right now: At the harbour, years later.'));
  assert.ok(asked.includes('a lie, a joke'));
  assert.ok(!/Oda|Jovan|Yuki/.test(asked), 'no real-looking example names');
  /* nor in what the partner is told */
  await reset();
  await script([{ text: 'Fine.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello.' });
  const told = JSON.stringify((await requests())[0].body.messages);
  assert.ok(told.includes('Name Surname') && !/Oda|Jovan|Yuki/.test(told), 'the example is a placeholder, never a name a book could hold');
  await setHouse();
  await putAway(b);
});

await test('every Leave it is remembered while its words can still be offered — never the oldest forgotten past sixty', () => {
  const c = { passages: [{ id: 'p1', by: 'ai', pick: 0, versions: [{ id: 'v1', text: Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ') }] }], checks: {} };
  for (let i = 0; i < 80; i++) {
    const entry = { round: 'r', sig: util.hashText(c.passages[0].versions[0].text), at: 1, items: [{ id: `s${i}`, kind: 'humanize', find: `word${i}`, replace: `other${i}`, why: 'x' }] };
    shape.chapterSteps.setCheck('p1', 'v1', entry)(c);
    shape.chapterSteps.dropSuggestion('p1', 'v1', `s${i}`, { remember: true })(c);
  }
  const left = c.checksLeft.p1;
  assert.equal(left.length, 80);
  assert.ok(left.some((x) => x.find === 'word0'), 'the first he left is still left');
  /* words no version holds any more are what go */
  c.passages[0].versions[0].text = 'word79';
  shape.chapterSteps.setCheck('p1', 'v1', { round: 'r', sig: util.hashText('word79'), at: 1, items: [{ id: 'z', kind: 'humanize', find: 'word79', replace: 'w', why: 'x' }] })(c);
  shape.chapterSteps.dropSuggestion('p1', 'v1', 'z', { remember: true })(c);
  const kept = c.checksLeft.p1;
  assert.ok(kept.length < 80 && kept.every((x) => 'word79'.includes(x.find)), JSON.stringify(kept));
  assert.ok(kept.some((x) => x.find === 'word79' && x.replace === 'w'));
});

/* =================================================== two browsers on one book */
heading('two browsers on one book: what Cozy Tavern learned');

/* another browser, as the phone sees it: its own window id */
const other = (key, extra = {}) => realFetch(`${BASE}/api/lease`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'tab-other-browser' }, body: JSON.stringify({ key, ttl: 60000, ...extra }) }).then((r) => r.json());

await test('what was sent, looked up the moment a page lands, waits for the words on their way — and one the phone would not keep is said as not kept, never as gone', async () => {
  const b = await makeBook([['Mara kept the light.']]);
  let landed = false;
  const big = { model: 'scripted', messages: [{ role: 'user', content: 'x'.repeat(2_000_000) }] };
  store.keepSent(b.novelId, 'v-wait', { body: big }).then(() => { landed = true; });
  const kept = await store.sentKept(b.novelId, 'v-wait');
  assert.equal(landed, true, 'looked up only once it is on the phone');
  assert.equal(kept.failed, '');
  const got = await store.api('GET', `/api/sent/${b.novelId}/v-wait`);
  assert.equal(got.status, 200);
  assert.equal(got.data.body.messages[0].content.length, 2_000_000);
  /* the phone would not keep it: said as such */
  await store.keepSent('not a book!', 'v-bad', { body: big });
  assert.ok((await store.sentKept('not a book!', 'v-bad')).failed, 'a keep that failed says why');
  assert.deepEqual(await store.sentKept(b.novelId, 'never-kept'), { failed: '' }, 'one never asked to be kept is simply not there');
  await putAway(b);
});

await test('the helper and the checker work on a book in one browser at a time: another browser holding it means no call here — the light says so — and once it lets go this one reads; a tab frozen past its lease lays nothing over the other’s work', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Mara Venn kept the light at Crane Point.']], { manual: true });
  assert.deepEqual(await other(`helper:${b.novelId}`), { ok: true });
  assert.deepEqual(await other(`checker:${b.novelId}`), { ok: true });
  await reset();
  await archivist.run(b.novelId);
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'no call while another browser holds the book');
  assert.equal(archivist.lightOf(b.novelId).words, archivist.ELSEWHERE);
  assert.ok(archivist.pendingWork(b.novelId), 'still to read here — never marked read');
  /* it lets go: this one reads */
  await other(`helper:${b.novelId}`, { release: true });
  await other(`checker:${b.novelId}`, { release: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.' }] }) }, { text: JSON.stringify({ edits: [] }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().notes.people[0].name, 'Mara Venn');
  assert.equal(archivist.pendingWork(b.novelId), false);
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 2, 'and checks it');
  /* a tab frozen past its lease (no renewal ran): the other browser took the book; the answer that comes back is not written */
  await setHouse({}, { roles: { writer: 'c-w', checker: 'off' } });
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id, text: 'Mara Venn kept the light at Crane Point. Tom Hale came.' });
  globalThis.__cozyLeaseMs = 6000;
  const realSI = globalThis.setInterval;
  globalThis.setInterval = (fn, ms, ...a) => (ms === 2000 ? 0 : realSI(fn, ms, ...a));
  try {
    await reset();
    await script([{ pause: 9, text: JSON.stringify({ people: [{ name: 'Tom Hale', about: 'A stranger.' }] }) }]);
    const run = archivist.run(b.novelId);
    await sleep(7200);
    assert.deepEqual(await other(`helper:${b.novelId}`), { ok: true }, 'its lease ran out while it was frozen');
    await run;
  } finally { globalThis.setInterval = realSI; delete globalThis.__cozyLeaseMs; }
  assert.equal((await requests()).length, 1);
  assert.equal(b.novel().notes.people.some((c) => c.name === 'Tom Hale'), false, 'nothing laid over the other browser’s work');
  assert.equal(archivist.lightOf(b.novelId).words, archivist.ELSEWHERE);
  await other(`helper:${b.novelId}`, { release: true });
  /* the page going (closed, reloaded, an update landing) lets its leases go at once — the next page never waits them out */
  const mine = await store.lease(`helper:${b.novelId}`);
  assert.equal(mine.ok, true);
  assert.equal((await other(`helper:${b.novelId}`)).ok, false);
  store.letLeasesGo();
  await sleep(300);
  assert.deepEqual(await other(`helper:${b.novelId}`), { ok: true });
  assert.equal(await mine.confirm(), false, 'and what it was doing lays nothing down');
  await other(`helper:${b.novelId}`, { release: true });
  await setHouse();
  await putAway(b);
});

/* =================================================== the page and the app: what Cozy Tavern learned */
heading('the page and the app: what Cozy Tavern learned');

const textshape = await import(path.join(ROOT, 'js/novel/textshape.js'));
const story200 = 'The rain fell on Crane Point all night, and Mara kept the lamp burning until the glass sweated and the oil ran low. '.repeat(3).trim();

await test('a note to him after the story is taken off a new page and kept, and the passage’s menu puts it back as a new version; speech and the story stay', async () => {
  const b = await makeBook([[]], { manual: true });
  const note = 'I hope this captures the mood you wanted. Would you like me to continue?';
  await script([{ text: `${story200}\n\n---\n\n${note}` }, { text: `${story200}\n\nLet me know when you’re ready, she told him, and he said, “I will.”` }, { text: `${story200}\n\nAnd what would you have done, in her place?` }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let v = picked(b.ch().passages[0]);
  assert.equal(v.text, story200);
  assert.equal(v.tookOff, `---\n\n${note}`);
  assert.ok((v.notes || []).some((n) => n.includes('taken off')), JSON.stringify(v.notes));
  assert.equal(writer.putBackTail({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id }), true);
  v = picked(b.ch().passages[0]);
  assert.equal(v.text, `${story200}\n\n---\n\n${note}`);
  assert.equal(b.ch().passages[0].versions.length, 2, 'the page without it one arrow away');
  assert.equal(b.ch().passages[0].versions[0].text, story200);
  /* speech is story; so is a narrator's own question */
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(picked(b.ch().passages[1]).text.endsWith('he said, “I will.”'));
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(picked(b.ch().passages[2]).text.endsWith('in her place?'));
  assert.equal(picked(b.ch().passages[2]).tookOff, undefined);
  /* a word in brackets about the writing is a note; a narrator's aside in brackets is story */
  assert.equal(textshape.finishTail(`${story200}\n\n(I can make the next chapter darker if you prefer.)`).removed, '(I can make the next chapter darker if you prefer.)');
  assert.equal(textshape.finishTail(`${story200}\n\n(You could see the harbour from there, if you knew where to look.)`).removed, '');
  /* and never from a page that would be left too short */
  assert.equal(textshape.finishTail('A short page.\n\nWould you like me to continue?').removed, '');
  await putAway(b);
});

await test('the tracking a preset asks for comes off a page and a telling and is kept — the Plot Momentum block, {PULSE} and its kin wherever they stand, a block of tags at the end — and is put back from the menu; HTML a page truly carries and the narrator’s offered ways stay; Go on keeps what came off both parts', async () => {
  const b = await makeBook([[]], { manual: true });
  const momentum = '<details><summary>Plot Momentum</summary>\n- The lamp: low\n</details>';
  const tags = '<status>\n<Mara>tired, at the lamp</Mara>\n<Tom>rowing</Tom>\n</status>';
  await script([
    { text: `${story200}\n\n---\n\n${momentum}\n\nWould you like me to continue?` },
    { text: `${story200}\n\n{PULSE}\nMara: tired\n{/PULSE}\n\nThe oil burned on.\n\n${tags}`, finish: 'length' },
    { text: '\n\nAnd the tide turned.\n\n{WATCHLIST}\nTom\n{/WATCHLIST}' },
    { text: `${story200}\n\n<div>A letter, pinned to the door.</div>` },
  ]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let v = picked(b.ch().passages[0]);
  assert.equal(v.text, story200);
  assert.equal(v.tookOff, `---\n\n${momentum}\n\nWould you like me to continue?`);
  assert.ok((v.notes || []).includes('A block of tracking and a note to you after the story were taken off the page — the passage’s menu puts them back.'), JSON.stringify(v.notes));
  assert.equal(writer.putBackTail({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id }), true);
  assert.equal(picked(b.ch().passages[0]).text, `${story200}\n\n---\n\n${momentum}\n\nWould you like me to continue?`);
  /* the line of marks it stood under goes with it, with no note after it too */
  assert.deepEqual(textshape.finishTail(`${story200}\n\n* * *\n\n${momentum}`), { text: story200, removed: `* * *\n\n${momentum}`, kinds: ['tracking'] });
  /* wherever {PULSE} stands; a block of tags at the very end */
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  v = picked(b.ch().passages[1]);
  assert.equal(v.text, `${story200}\n\nThe oil burned on.`);
  assert.equal(v.tookOff, `{PULSE}\nMara: tired\n{/PULSE}\n\n${tags}`);
  /* carried on: what came off the first part stays beside what comes off now */
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[1].id });
  v = picked(b.ch().passages[1]);
  assert.equal(v.text, `${story200}\n\nThe oil burned on.\n\nAnd the tide turned.`, 'a new paragraph stays one');
  assert.equal(v.tookOff, `{PULSE}\nMara: tired\n{/PULSE}\n\n${tags}\n\n{WATCHLIST}\nTom\n{/WATCHLIST}`);
  /* HTML a page truly carries is the page's */
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(picked(b.ch().passages[2]).text, `${story200}\n\n<div>A letter, pinned to the door.</div>`);
  /* the narrator's telling: the tracking off, the ways it offers to the letter, and put back where it stood */
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: `${story200}\n\n{PULSE}\nMara: wary\n{/PULSE}\n\n<choices>\n- follow her\n- wait\n</choices>` }]);
  await talk.playSay({ playId: id, text: '' });
  let turn = store.peek('play', id).turns.at(-1);
  let tv = picked(turn);
  assert.equal(tv.text, `${story200}\n\n<choices>\n- follow her\n- wait\n</choices>`);
  assert.equal(tv.tookOff, '{PULSE}\nMara: wary\n{/PULSE}');
  assert.ok((tv.notes || []).some((n) => n.startsWith('A block of tracking after the telling was taken off')), JSON.stringify(tv.notes));
  assert.deepEqual(prompts.choicesIn(tv.text), ['follow her', 'wait']);
  assert.equal(talk.putBackTelling({ playId: id, turnId: turn.id }), true);
  turn = store.peek('play', id).turns.at(-1);
  assert.equal(turn.versions.length, 2, 'the one without it one arrow away');
  assert.equal(picked(turn).text, `${story200}\n\n{PULSE}\nMara: wary\n{/PULSE}\n\n<choices>\n- follow her\n- wait\n</choices>`);
  assert.equal(picked(turn).tookOff, undefined);
  await putAway(b);
});

await test('a soft wrap the model let through is joined on a new page — white space only; a scene break line is never joined', async () => {
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'The first paragraph ends here.\n\nShe walked closer to the towers than Dev liked —\n  and the thought followed her\nhome.\n    * * *\n  Morning came.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(picked(b.ch().passages[0]).text, 'The first paragraph ends here.\n\nShe walked closer to the towers than Dev liked — and the thought followed her home.\n    * * *\n  Morning came.');
  await putAway(b);
});

await test('a quotation the model left open is closed on a new page, a stray of another script stuck to a word comes off and is said — marks only; Go on never touches the words it carries on, a cut page keeps its unfinished end, and the narrator’s telling is made whole the same way', async () => {
  const b = await makeBook([[{ text: 'Old words, “left open by him\nHe said, "Go', cut: true, cutWhy: 'it reached the reply length' }]], { manual: true });
  const stray = 'The quiet morning came over the hills and the village woke slowly, each house lifting its shutters to the pale light. '.repeat(2).trim();
  await script([
    { text: `${stray}\n\nShe said, “Leave the lamp.\n\nHe heard a *thud and turned.\n\n"Well," she said, "maybe later.\n\nThey sat down to \u5403eat together.` },
    { text: ' on," she said.\n\nMara asked, “Is it far?\n\nFar enough.' },
    { text: `${stray}\n\nShe said, “Leave the lamp.\n\nHe began, “I don’t know what`, finish: 'length' },
  ]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const v = picked(b.ch().passages[1]);
  assert.equal(v.text, `${stray}\n\nShe said, “Leave the lamp.”\n\nHe heard a *thud and turned.*\n\n"Well," she said, "maybe later."\n\nThey sat down to eat together.`);
  assert.ok((v.notes || []).some((n) => n.includes('stray character of another script')), JSON.stringify(v.notes));
  /* Go on: the passage's own words — his — as they were; only what is new is mended */
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id });
  assert.equal(picked(b.ch().passages[0]).text, 'Old words, “left open by him\nHe said, "Go on," she said.\n\nMara asked, “Is it far?”\n\nFar enough.');
  /* cut: its last paragraph is not finished, and Go on finishes it — never closed for it */
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const cut = picked(b.ch().passages[2]);
  assert.equal(cut.cut, true);
  assert.ok(cut.text.endsWith('She said, “Leave the lamp.”\n\nHe began, “I don’t know what'), cut.text.slice(-60));
  /* the next paragraph speaking, or a later one closing, is a speech going on: left open */
  assert.equal(textshape.mendMarks('He said, “I will go.\n“And I will stay.”').changed, false);
  assert.equal(textshape.mendMarks('“Dear John,\nI miss you.\nLove, Mary”').changed, false);
  assert.equal(textshape.mendMarks('"Dear John,\nI miss you.\nLove, Mary"').changed, false);
  assert.equal(textshape.mendMarks('He was 6\'2" tall, and *softly* said so.\n* * *\n# Two').changed, false);
  assert.equal(textshape.mendMarks('He said "" and left.').text, 'He said and left.');
  /* a phrase a character speaks in another language is longer, and stays */
  assert.equal(textshape.dropGluedStrays(`${stray} こんにちはhello, she said.`).changed, false);
  /* more than four on one page is a page that mixes its languages: left as it is */
  assert.equal(textshape.dropGluedStrays(`${stray} 吃eat 喝drink 走walk 看see 听hear`).changed, false);
  /* the narrator: the telling mended, the ways it could go to the letter */
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'Mina turned and said, “Come with me.\n\nThe gate creaks.\n\n<choices>\n- say "wait\n- follow her\n</choices>' }]);
  await talk.playSay({ playId: id, text: '' });
  const told = picked(store.peek('play', id).turns.at(-1));
  assert.equal(told.text, 'Mina turned and said, “Come with me.”\n\nThe gate creaks.\n\n<choices>\n- say "wait\n- follow her\n</choices>');
  await putAway(b);
});

await test('a lone asterisk is a scene break and a run of asterisks is never emphasis — on the page’s rules and in the book sent out and brought in', async () => {
  for (const line of ['*', ' * * ', '＊', '**', '* * *', '***', '---']) assert.ok(textshape.isBreakLine(line), line);
  for (const line of ['*word*', 'a * b', '— and']) assert.ok(!textshape.isBreakLine(line), line);
  const b = await makeBook([['Before the break.\n\n*\n\nAfter it. *****, she typed, and **bold** stays bold.']]);
  const chapters = { [b.ids[0]]: b.ch() };
  const txt = files.toText(b.novel(), chapters);
  assert.ok(txt.includes('Before the break.\n\n* * *\n\nAfter it. *****, she typed, and bold stays bold.'), txt);
  assert.ok(files.toMarkdown(b.novel(), chapters).includes('Before the break.\n\n* * *\n\nAfter it.'));
  assert.equal(files.inlineMarks('After it. *****, she typed, and **bold** stays bold.'), 'After it. *****, she typed, and <strong>bold</strong> stays bold.');
  assert.equal(files.inlineMarks('She typed *** and stopped, *softly*.'), 'She typed *** and stopped, <em>softly</em>.');
  /* a file brought in: a lone asterisk parts its scenes */
  const { novel, chapters: cs } = files.fromText('Breaks.md', '# Breaks\n\n## Chapter 1\n\nOne.\n\n*\n\nTwo.\n');
  assert.deepEqual(cs[novel.order[0]].passages.map((p) => p.by), ['you', 'break', 'you']);
  await putAway(b);
});

await test('passages moved to a new chapter take what was kept for them: the checker’s findings, what he left, the head to head, their versions taken out', () => {
  const c = { passages: [{ id: 'p1' }, { id: 'p2' }], checks: { p1: { v1: { sig: 'a' } }, p2: { v2: { sig: 'b' } } }, checksLeft: { p1: [{ find: 'a', replace: 'b' }], p2: [{ find: 'x', replace: 'y' }] },
    duels: { k1: { pid: 'p1' }, k2: { pid: 'p2' } }, retired: [{ key: 'p1:v0', text: 'old' }, { key: 'p2:v9', text: 'older' }, { key: 'p3', text: 'gone' }] };
  const k = shape.keptFor(c, ['p2']);
  assert.deepEqual(Object.keys(k.checks), ['p2']);
  assert.deepEqual(k.checksLeft, { p2: [{ find: 'x', replace: 'y' }] });
  assert.deepEqual(Object.keys(k.duels), ['k2']);
  assert.deepEqual(k.retired.map((r) => r.key), ['p2:v9']);
  k.checks.p2.v2.sig = 'changed';
  assert.equal(c.checks.p2.v2.sig, 'b', 'a copy: the chapter it came from is not changed');
});

await test('what the partner’s own web search looked at is kept with its answer — only addresses on the web', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ deltas: [{ content: 'It checked. ', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/lighthouses', title: 'Lighthouses' } }, { type: 'url_citation', url_citation: { url: 'javascript:alert(1)', title: 'Bad' } }] }], text: 'Done.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Look up lighthouses.' });
  const answer = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual((answer.sources || []).map((x) => x.url), ['https://example.com/lighthouses']);
  assert.equal(call.webUrl('javascript:alert(1)'), false);
  assert.equal(call.webUrl('https://example.com'), true);
  await putAway(b);
});

await test('on Automatic, what the helper keeps beside his own words is written again once he rewrites them — never over his correction', async () => {
  const b = await makeBook([['Mara kept the light at Crane Point.']], { brief: 'A lighthouse keeper finds a letter.' });
  await script([{ text: JSON.stringify({ about: 'KEPT FIRST', style: 'STYLE FIRST' }) }]);
  markAllSeen(b);
  await archivist.run(b.novelId);
  assert.equal((b.novel().kept.about || {}).text, 'KEPT FIRST');
  /* nothing of his changed: nothing asked again */
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'his words as they were: nothing to write again');
  store.change('novel', b.novelId, shape.novelSteps.setField('brief', 'A lighthouse keeper finds a letter from her drowned brother.'), { now: true });
  await script([{ text: JSON.stringify({ about: 'KEPT AGAIN BESIDE HIS NEW WORDS' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'KEPT AGAIN BESIDE HIS NEW WORDS');
  assert.equal(b.novel().kept.style.text, 'STYLE FIRST', 'only the one beside the words he rewrote');
  /* his correction stands, whatever he rewrites */
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'HIS CORRECTION', at: Date.now(), by: 'you' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setField('brief', 'Something else again.'), { now: true });
  await reset();
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'HIS CORRECTION');
  assert.equal((await requests()).length, 0);
  await putAway(b);
});

await test('what was kept before his words were marked beside it is marked as they stand — so his next rewrite of them is seen', async () => {
  const b = await makeBook([['Mara kept the light at Crane Point.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'KEPT BEFORE 2.5', at: 1 }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'STYLE BEFORE 2.5', at: 1 }), { now: true });
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'nothing written again by itself');
  assert.equal(b.novel().kept.about.text, 'KEPT BEFORE 2.5');
  store.change('novel', b.novelId, shape.novelSteps.setField('brief', 'A lighthouse keeper finds a letter from her drowned brother.'), { now: true });
  await script([{ text: JSON.stringify({ about: 'BESIDE HIS NEW WORDS' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'BESIDE HIS NEW WORDS');
  assert.equal(b.novel().kept.style.text, 'STYLE BEFORE 2.5');
  await putAway(b);
});

await test('a search says what it could not read — the shelf, a book, a chapter — never that the words are not there', () => {
  const say = search.searchSaid;
  assert.equal(say({ q: 'heron', scope: 'book', total: 0 }), '“heron” isn’t anywhere in this book.');
  assert.equal(say({ q: 'heron', scope: 'all', total: 0, searched: 3 }), '“heron” isn’t anywhere in your books.');
  assert.equal(say({ q: 'heron', scope: 'all', total: 2, searched: 3 }), '2 places.');
  assert.equal(say({ q: 'heron', scope: 'all', total: 0, searched: 1, noShelf: true }), '“heron” isn’t anywhere in what could be read. The shelf could not be read just now, so only this book was searched — the phone did not answer.');
  assert.equal(say({ q: 'heron', scope: 'all', total: 1, searched: 2, unread: 2 }), '1 place. 2 books could not be read just now, so they were not searched — the phone did not answer.');
  assert.equal(say({ q: 'heron', scope: 'book', total: 0, searched: 1, lost: 1 }), '“heron” isn’t anywhere in what could be read. One chapter could not be read just now, so it was not searched.');
  assert.equal(say({ q: 'heron', scope: 'book', searched: 0, unread: 1 }), 'This book could not be read just now — the phone did not answer. Try again in a moment.');
  assert.equal(say({ q: 'heron', scope: 'all', searched: 0, noShelf: true, unread: 1 }), 'Your books could not be read just now — the phone did not answer. Try again in a moment.');
});

await test('every book is searched in the shelf’s order — this one first, the newest written or opened next, the archived last', () => {
  const rows = [{ id: 'a', meta: { written: 1 } }, { id: 'c', meta: { opened: 5 } }, { id: 'b', meta: { written: 99 } }, { id: 'd', meta: { written: 9, archived: true } }, { id: 'e', meta: { written: 3, opened: 2 } }, { id: 'f', meta: { archived: true } }];
  assert.deepEqual(search.searchOrder('b', rows), ['b', 'c', 'e', 'a', 'd', 'f']);
});

await test('a chapter’s summary that left out a name or a figure the chapter holds is asked once more for them, each where it stands — kept only when it holds more and reads as prose', async () => {
  const one = 'The rain fell on the lighthouse at Crane Point. Mara Venn climbed to the lamp while Corvin waited below with 40 men. At 3am Corvin rowed out alone.';
  const full = 'Mara Venn tends the lamp at Crane Point through a storm while Corvin waits below with 40 men, and at 3am Corvin rows out alone.';
  const card = (kind, name) => shape.novelSteps.putNote(kind, shape.newCard(kind, { name, about: 'Known.' }));
  let b = await makeBook([[one], ['Chapter two words.']]);
  store.change('novel', b.novelId, card('people', 'Mara Venn'), { now: true });
  store.change('novel', b.novelId, card('places', 'Crane Point'), { now: true });
  markAllSeen(b);
  await script([{ text: JSON.stringify({ summary: 'Mara Venn tends the lamp through a long storm until the morning.', name: 'The Storm' }) }, { text: JSON.stringify({ summary: full }) }]);
  await archivist.run(b.novelId);
  const again = (await requests()).map((r) => String(r.body.messages.at(-1).content)).find((m) => m.includes('nowhere in the summary'));
  assert.ok(again && ['the name Corvin', 'the name Crane Point', 'the figure 40 men', 'the figure 3am'].every((w) => again.includes(w)) && !again.includes('the name Mara Venn'), again);
  const line = (w) => (again.split('\n').find((l) => l.startsWith(`- ${w}`)) || '');
  assert.ok(line('the name Crane Point').includes('the lighthouse at Crane Point') && line('the figure 3am').includes('At 3am Corvin rowed out'), 'each one where it stands in the chapter');
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, full);
  await putAway(b);
  /* a second answer that pastes a list of words, or comes back thinner, is not kept: the first stands */
  b = await makeBook([[one], ['Chapter two words.']]);
  markAllSeen(b);
  await reset();
  await script([{ text: JSON.stringify({ summary: 'Mara Venn tends the lamp through a long storm until the morning comes.' }) }, { text: JSON.stringify({ summary: 'Mara Venn tends the lamp through a long storm until the morning. Also named: Corvin, 40 men, 3am.' }) }]);
  await archivist.run(b.novelId);
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'Mara Venn tends the lamp through a long storm until the morning comes.');
  await putAway(b);
  /* …and one much thinner than the first is not kept either, whatever it names */
  b = await makeBook([[one], ['Chapter two words.']]);
  markAllSeen(b);
  await reset();
  await script([{ text: JSON.stringify({ summary: 'Mara Venn tends the lamp through a long storm until the morning comes, alone in the lantern room.' }) }, { text: JSON.stringify({ summary: 'Corvin brings 40 men at 3am.' }) }]);
  await archivist.run(b.novelId);
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'Mara Venn tends the lamp through a long storm until the morning comes, alone in the lantern room.');
  await putAway(b);
  /* nothing lost: nothing asked again */
  b = await makeBook([[one], ['Chapter two words.']]);
  markAllSeen(b);
  await reset();
  await script([{ text: JSON.stringify({ summary: full }) }]);
  await archivist.run(b.novelId);
  assert.equal((await requests()).filter((r) => String(r.body.messages.at(-1).content).includes('nowhere in the summary')).length, 0);
  await putAway(b);
});

await test('a name his hand changed everywhere it stood in a passage is known as one — never a rewrite, two names at once, some places only, or an ordinary word at a sentence’s start', () => {
  const isName = (w) => ['Mara', 'Venn', 'Corvin'].includes(w);
  assert.deepEqual(namesjs.nameChange('Mara climbed. The lamp lit and Mara smiled at Mara\'s dog.', 'Mira climbed. The lamp lit and Mira smiled at Mira\'s dog.', isName), { from: 'Mara', to: 'Mira' });
  assert.deepEqual(namesjs.nameChange('Mara Venn climbed.', 'Mara Holt climbed.', isName), { from: 'Venn', to: 'Holt' });
  assert.equal(namesjs.nameChange('Mara climbed and Mara smiled.', 'Mira climbed and Mara smiled.', isName), null, 'some places only');
  assert.equal(namesjs.nameChange('Rain hammered the glass.', 'Snow hammered the glass.', isName), null, 'an ordinary word');
  assert.equal(namesjs.nameChange('Mara and Corvin left.', 'Mira and Dev left.', isName), null, 'two at once');
  assert.equal(namesjs.nameChange('Mara climbed the stair.', 'Mara climbed the stairs slowly.', isName), null, 'no name changed');
  assert.equal(namesjs.namedMidSentence('Rain fell. The rain was cold.', 'Rain'), false);
  assert.equal(namesjs.namedMidSentence('At dawn Mara walked.', 'Mara'), true);
  assert.equal(namesjs.namedMidSentence('“Mara,” she said.', 'Mara'), false);
});

await test('what a reading keeps while the book is being read for it stands — the answer that was on its way does not write over it', async () => {
  const b = await makeBook([['Mara kept the light at Crane Point.']]);
  markAllSeen(b);
  await script([{ text: JSON.stringify({ about: 'FROM THE BOOK', style: 'STYLE FROM THE BOOK' }), chunk: 3, delay: 0.03 }]);
  const reading = archivist.run(b.novelId);
  for (let i = 0; i < 200 && !(await requests()).length; i++) await sleep(10);
  await sleep(20);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'A READING WROTE THIS', at: Date.now() }), { now: true });
  await reading;
  assert.equal(b.novel().kept.about.text, 'A READING WROTE THIS');
  assert.equal(b.novel().kept.style.text, 'STYLE FROM THE BOOK');
  await putAway(b);
});

await test('what its model will not write beside his rewritten words is asked once more, then kept as tried — never in a loop; another book’s failure never counts toward this one', async () => {
  const stale = { text: 'OLD KEPT', at: 1, ownFp: 'written beside his older words' };
  const a = await makeBook([['Mara kept the light at Crane Point.']]);
  const b = await makeBook([['Dev kept the books at the harbour office.']]);
  for (const x of [a, b]) {
    markAllSeen(x);
    store.change('novel', x.novelId, shape.novelSteps.setKept('about', stale), { now: true });
    store.change('novel', x.novelId, shape.novelSteps.setKept('style', { text: 'STYLE', at: 1 }), { now: true });
  }
  await script([{ text: '{}' }, { text: '{}' }]);
  await archivist.run(a.novelId);
  assert.equal(archivist.pendingWork(a.novelId), true, 'once: asked again later');
  await script([{ text: '{}' }, { text: '{}' }]);
  await archivist.run(b.novelId);
  assert.equal(archivist.pendingWork(b.novelId), true, 'the other book’s failure is not this one’s');
  await script([{ text: '{}' }, { text: '{}' }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'OLD KEPT', 'what was kept stands');
  assert.equal(archivist.pendingWork(b.novelId), false, 'kept as tried for his words as they are now');
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'never in a loop');
  await putAway(a);
  await putAway(b);
});

/* =================================================== the helper and the checker: what Cozy Tavern learned */
heading('the helper and the checker: what Cozy Tavern learned');

await test('a helper’s call that hears nothing from its provider is let go on its leash — never sent again inside the same ask, which would hang the same way; the helper asks a passage at a time after it; a page is never leashed', async () => {
  globalThis.__cozyLeashQuietMs = 400;
  try {
    const build = () => ({ messages: [{ role: 'user', content: 'Answer with JSON.' }], maxTokens: 300 });
    await script([{ pause: 4, text: 'too late' }, { text: 'never asked for' }]);
    const t0 = Date.now();
    const out = await call.ask(CONN, { build, stream: true, worker: true, patient: true });
    assert.equal(out.ok, false, JSON.stringify(out).slice(0, 300));
    assert.equal(out.leashed, 'quiet');
    assert.match(out.error, /sent nothing/);
    assert.ok(Date.now() - t0 < 4000, 'let go well before the silence ended');
    assert.equal((await requests()).length, 1, 'not sent again inside the ask');
    /* the helper: a reading of two passages let go on its leash is asked one passage at a time after it — and nothing is set aside for it */
    const b = await makeBook([['MARA KEPT THE LIGHT.', 'TOM MENDED THE NETS.'], ['The sea rose.']], { manual: true });
    await reset();
    await script([{ pause: 4, text: '{}' }]);
    await archivist.run(b.novelId);
    let r = await requests();
    assert.equal(r.length, 1, 'no probe, no second try');
    const asked = JSON.stringify(r[0].body.messages);
    assert.ok(asked.includes('MARA KEPT') && asked.includes('TOM MENDED'), 'both passages were in the one ask');
    assert.ok(archivist.forTests().narrow.has(b.novelId), 'a passage at a time from now on');
    assert.ok(archivist.forTests().failures.get(b.novelId), 'tried again later, by itself');
    assert.deepEqual(Object.keys(b.novel().memory.aside || {}), [], 'nothing set aside for a hang');
    archivist.forTests().failures.delete(b.novelId);
    await reset();
    await script(Array.from({ length: 6 }, () => ({ text: '{"people": []}' })));
    await archivist.run(b.novelId);
    r = await requests();
    const first = JSON.stringify(r[0].body.messages);
    assert.ok(first.includes('MARA KEPT') && !first.includes('TOM MENDED'), 'one passage in the ask');
    assert.equal(archivist.pendingWork(b.novelId), false, 'and every one read');
    await putAway(b);
    /* no progress for its leash — the line kept open with nothing new in it — is let go too; an answer still coming never is, however long it runs */
    globalThis.__cozyLeashQuietMs = 2000;
    globalThis.__cozyLeashAllMs = 700;
    await reset();
    await script([{ hang_after: 'a first word' }, { text: 'x'.repeat(60), chunk: 3, delay: 0.1 }]);
    const stuck = await call.ask(CONN, { build, stream: true, worker: true, patient: true });
    assert.equal(stuck.leashed, 'long', JSON.stringify(stuck).slice(0, 300));
    assert.match(stuck.error, /made no progress/);
    const slow = await call.ask(CONN, { build, stream: true, worker: true, patient: true });
    assert.equal(slow.ok, true, slow.error);
    assert.equal(slow.text, 'x'.repeat(60), 'two seconds of words, never cut: it was making progress');
    /* a reading let go partway is not asked again as if it had run out of room */
    await reset();
    await script([{ hang_after: '{"people": [' }, { text: '{}' }]);
    const part = await archivist.askJson(CONN, 'Answer with JSON.', 'Go.');
    assert.equal(part.ok, false);
    assert.equal(part.leashed, 'long');
    assert.equal((await requests()).length, 1);
    /* a page waits as long as its provider takes: he has Stop */
    await reset();
    await script([{ pause: 1.2, text: 'slow but sure' }]);
    const page = await call.ask(CONN, { build, stream: true });
    assert.equal(page.ok, true);
    assert.equal(page.text, 'slow but sure');
    assert.equal((await requests()).length, 1);
  } finally {
    delete globalThis.__cozyLeashQuietMs;
    delete globalThis.__cozyLeashAllMs;
  }
});

await test('a provider that asks to be left alone for minutes is not asked again before then — the helper waits as long as it asked, and says so', async () => {
  const build = () => ({ messages: [{ role: 'user', content: 'Answer with JSON.' }], maxTokens: 300 });
  await script([{ status: 429, message: 'slow down', retry_after: '300' }]);
  const t0 = Date.now();
  const out = await call.ask(CONN, { build, stream: true, worker: true, patient: true });
  assert.equal(out.ok, false);
  assert.equal(out.retryAfterMs, 300000);
  assert.ok(Date.now() - t0 < 5000, 'never waited out inside the call');
  assert.equal((await requests()).length, 1, 'never asked again inside the wait');
  assert.equal(call.retryAfterMs('120'), 120000);
  assert.ok(Math.abs(call.retryAfterMs(new Date(Date.now() + 90000).toUTCString()) - 90000) < 2000, 'a date too');
  /* the helper's next try: no sooner than it asked */
  const b = await makeBook([['Mara kept the light.']]);
  await reset();
  await script([{ status: 429, message: 'slow down', retry_after: '300' }]);
  await archivist.run(b.novelId);
  const f = archivist.forTests().failures.get(b.novelId);
  assert.ok(f && f.until - Date.now() > 290000, JSON.stringify(f));
  assert.ok(archivist.lightOf(b.novelId).words.includes('five minutes'), archivist.lightOf(b.novelId).words);
  archivist.forTests().failures.delete(b.novelId);
  await putAway(b);
});

await test('a fix the checker puts in by itself is small: a big rewrite or a cut waits behind the bubble for him; the small ones go in', async () => {
  await setHouse({}, { checksFrom: 0, autoFix: { on: true, from: 0 } });
  const words = 'Mara climbed the the stair. The lamp was cold and the glass was grey with salt. She trimmed the wick and struck a match. The flame caught and steadied. Below, the sea worked at the rocks.';
  const b = await makeBook([[words]]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the stair', replace: 'the stair', why: 'doubled' },
    { passage: '1.1', kind: 'humanize', find: 'The lamp was cold and the glass was grey with salt. She trimmed the wick and struck a match. The flame caught and steadied.', replace: 'She lit it.', why: 'tighter' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const p = b.ch().passages[0];
  assert.equal(p.versions.length, 2, 'one new version, by itself');
  assert.equal(picked(p).text, words.replace('the the stair', 'the stair'));
  assert.equal(checker.suggestions(b.novelId).length, 1, 'the big one waits for him');
  /* and by his hand, Apply puts it in */
  const [sg] = checker.suggestions(b.novelId);
  assert.equal(checker.applyOne(b.novelId, sg.chapterId, sg.passageId, sg.item.id).ok, true);
  assert.ok(picked(b.ch().passages[0]).text.includes('She lit it.'));
  assert.equal(checker.smallMend(words, words.replace('Mara climbed', 'Mara went up')), true);
  assert.equal(checker.smallMend(words, 'Mara climbed the stair.'), false, 'most of it cut');
  /* fixes each small, together a big cut: none goes in by itself — all wait for him */
  const many = 'The lamp was cold. The glass was grey with salt. She trimmed the wick. She struck a match. The flame caught. The flame steadied. Below, the sea worked at the rocks. The gulls slept. The night was long. Morning came late.';
  const b2 = await makeBook([[many]]);
  await reset();
  await script([{ text: JSON.stringify({ edits: ['The glass was grey with salt. ', 'She struck a match. ', 'The flame steadied. ', 'The gulls slept. '].map((find) => ({ passage: '1.1', kind: 'humanize', find, replace: '', why: 'tighter' })) }) }]);
  await checker.runCheck(b2.novelId);
  assert.equal(b2.ch().passages[0].versions.length, 1, 'not one of them by itself');
  assert.equal(checker.suggestions(b2.novelId).length, 4, 'all four wait for him');
  await setHouse();
  await putAway(b2);
  await putAway(b);
});

await test('a passage read in parts that cannot be finished leaves nothing half in the notes; read whole later, one Undo takes back every part', async () => {
  await setHouse({ context: 6000 });
  const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: Mara walked the long shore past the rocks and the drowned boats, counting the gulls and the waves until the light went grey.`).join('\n\n');
  const b = await makeBook([[long, 'The next passage.']], { manual: true });
  const people = () => ((b.novel().notes || {}).people || []).map((c) => c.name);
  await script([{ text: JSON.stringify({ people: [{ name: 'Tomas', about: 'A fisherman on the shore.' }] }) }, { text: 'not json at all' }, { text: 'still not json' }]);
  await archivist.run(b.novelId);
  const asked = (await requests()).filter((r) => String(r.body.messages.at(-1).content).includes('(part 1 of'));
  assert.equal(asked.length, 1, 'read in parts');
  assert.deepEqual(people(), [], 'its first part taken back: nothing half in the notes');
  assert.equal(archivist.pendingWork(b.novelId), true, 'and it is read again later, from the start');
  assert.equal((b.novel().memory || {}).undo || null, null, 'the notes’ Undo as it was');
  /* read whole: every part kept, and one Undo takes them all back */
  archivist.forTests().failures.delete(b.novelId);
  await reset();
  await script([{ text: JSON.stringify({ people: [{ name: 'Tomas', about: 'A fisherman on the shore.' }] }) }, { text: JSON.stringify({ places: [{ name: 'The Long Shore', about: 'Rocks and drowned boats.' }] }) }]);
  await archivist.run(b.novelId);
  assert.deepEqual(people(), ['Tomas']);
  assert.deepEqual(((b.novel().notes || {}).places || []).map((c) => c.name), ['The Long Shore']);
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.deepEqual(people(), [], 'the first part’s card goes with the last part’s');
  assert.deepEqual(((b.novel().notes || {}).places || []).map((c) => c.name), []);
  await setHouse();
  await putAway(b);
});

await test('a passage taken out that is longer than one reading holds is told in parts, and done with at its last', async () => {
  await setHouse({ context: 6000 });
  const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}: Tomas mended the nets on the long shore past the rocks and the drowned boats until the light went grey.`).join('\n\n');
  const b = await makeBook([['Mara kept the light.', long, 'The tide turned.']], { manual: true });
  markAllSeen(b);
  const pid = b.ch().passages[1].id;
  archivist.retireIfSeen(b.novelId, b.ids[0], pid);
  store.change('chapter', b.ids[0], shape.chapterSteps.removePassage(pid), { now: true });
  await archivist.run(b.novelId);
  const told = (await requests()).map((r) => String(r.body.messages.at(-1).content)).filter((m) => m.includes('This part was taken out of'));
  assert.ok(told.length > 1 && told[0].includes('(part 1 of') && told.every((m) => m.length < 9000), told.map((m) => m.length));
  assert.equal(archivist.pendingWork(b.novelId), false, 'done with once its last part is told');
  assert.equal((b.ch().retired || []).length, 0);
  await setHouse();
  await putAway(b);
});

await test('the notes are never checked against no book, nor what it is about written from none: a helper too small says so and asks nothing', async () => {
  await setHouse({ context: 2600 });
  const b = await makeBook([['Mara kept the light at Crane Point.']]);
  markAllSeen(b);
  for (let i = 0; i < 6; i++) store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: `Keeper ${i}`, about: 'A keeper of the light. '.repeat(20) })), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ auditAsked: true }), { now: true });
  await archivist.run(b.novelId);
  const asked = (await requests()).map((r) => String(r.body.messages.at(-1).content));
  assert.ok(!asked.some((m) => m.includes('Check every card against the book') || m.includes('for the writer to read before every page')), asked.map((m) => m.slice(0, 60)));
  const audit = (b.novel().memory || {}).audit || {};
  assert.ok(audit.failed && audit.failed.includes('too few to read the book'), JSON.stringify(audit));
  assert.equal((b.novel().memory || {}).auditAsked, false);
  assert.equal((b.novel().kept.about || {}).text, '', 'kept as tried, never written from no book');
  /* a model with room for one card beside a sliver of the book: the notes' check still asks for its share of both */
  await setHouse({ context: 12000 });
  await reset();
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ auditAsked: true, audit: null }), { now: true });
  await archivist.run(b.novelId);
  const asked2 = (await requests()).map((r) => String(r.body.messages.at(-1).content));
  assert.ok(!asked2.some((m) => m.includes('Check every card against the book')), 'not with room for one card and a sliver of the book');
  assert.ok((((b.novel().memory || {}).audit) || {}).failed, JSON.stringify((b.novel().memory || {}).audit));
  await setHouse();
  await putAway(b);
});

await test('his own summary of a chapter is carried into the next one when the chapter changes — never lost to one written without it', async () => {
  const b = await makeBook([['Mara climbed to the lamp with her father’s keys.'], ['Chapter two words.']]);
  markAllSeen(b);
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: 'MY OWN: Mara is the keeper’s daughter, not his wife.', fp: 'an older chapter', at: 1, by: 'you' }), { now: true });
  await script([{ text: JSON.stringify({ summary: 'Mara, the keeper’s daughter, climbs to the lamp with her father’s keys.' }) }]);
  await archivist.run(b.novelId);
  const asked = (await requests()).map((r) => String(r.body.messages.at(-1).content)).find((m) => m.includes('for the book\'s notes'));
  assert.ok(asked && asked.includes('My own summary of this chapter') && asked.includes('MY OWN: Mara is the keeper’s daughter, not his wife.'), asked);
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'Mara, the keeper’s daughter, climbs to the lamp with her father’s keys.');
  await putAway(b);
});

await test('the notes never crowd out the chapter: past their share, the cards the chapter does not name ride by their first line — the request fits the model', async () => {
  const b = await makeBook([['Mara climbed to the lamp while Tomas mended the nets below. '.repeat(40)]]);
  for (let i = 0; i < 250; i++) store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: `Villager ${i}`, about: `A villager of Crane Point. ${'They keep goats and mend the walls and know every path. '.repeat(6)}` })), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Tomas', about: `The net-mender. ${'He knows the tides better than anyone at Crane Point. '.repeat(6)}TOMAS WHOLE.` })), { now: true });
  const chapters = { [b.ids[0]]: b.ch() };
  const conn = { ...CONN, context: 20000, maxTokens: 2000 };
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn, target: { chapterId: b.ids[0] }, request: 'Go on.' });
  assert.ok(a.stats.tokens < 20000 - 2000, `${a.stats.tokens} tokens for a room of 20,000`);
  assert.ok(a.system.includes('shown by their first line') && a.system.includes('TOMAS WHOLE.'), 'the one the chapter names, whole');
  assert.ok(a.system.includes('Mara climbed to the lamp'), 'the chapter rides');
  await putAway(b);
});

await test('a passage the partner writes whole at less than half its length is said so, with both counts — the words before one Undo away', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `Mara walked the shore at dawn for the ${i + 1}th time, counting the drowned boats.`).join(' ');
  const b = await makeBook([[long]], { manual: true });
  markAllSeen(b);
  const out = changes.makeChange(b.novelId, { passage: '1.1', text: 'Mara walked the shore at dawn.', why: 'shorter' });
  assert.equal(out.status, 'made');
  assert.match(out.said, /it is 6 words now, from 4\d\d/);
  assert.equal(b.ch().passages[0].versions.length, 2);
  const kept = changes.makeChange(b.novelId, { passage: '1.1', text: 'Mara walked the shore at dawn, alone.', why: 'a word more' });
  assert.ok(!String(kept.said || '').includes('words now'), 'not for one about as long');
  await putAway(b);
});

await test('another take of a passage read together with the ones before it: their notes go with it, and they are said to be not in the notes yet — the writer takes them from the page', async () => {
  const b = await makeBook([['Kael rowed in at dusk.', 'He tied the boat.', 'Mara watched him from the lamp.', 'The night came down.'], ['Chapter two begins.']], { manual: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'Kael', about: 'A sailor who rows in at dusk.' }] }) }, { text: '{}' }]);
  await archivist.run(b.novelId);
  assert.deepEqual((b.novel().notes.people || []).map((c) => c.name), ['Kael']);
  const ps = b.ch().passages;
  const chapters = { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) };
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters, conn: CONN, target: { chapterId: b.ids[0], before: ps[2].id }, request: 'Write it again.' });
  const told = [a.system, ...a.messages.map((m) => m.content)].join('\n');
  assert.ok(!told.includes('A sailor who rows in at dusk.'), 'the reading that holds the old take is taken back');
  assert.ok(told.includes('Not in these notes yet: Chapter One, passages 1 and 2'), told.slice(told.indexOf('Not in these'), told.indexOf('Not in these') + 120));
  await putAway(b);
});

/* =================================================== the second sweep: the partner */
heading('the partner: what the second sweep found');

await test('the partner’s passage numbers mean the page it was shown: two taken out are those two, one written anew after them is the one it named — and its row shows the number it has now', async () => {
  const b = await makeBook([['A one.', 'B two.', 'C three.', 'D four.', 'E five.', 'F six.']], { manual: true });
  await script([{ text: '<changes>[{"passage": "1.3", "remove": true, "why": "a"}, {"passage": "1.5", "remove": true, "why": "b"}, {"passage": "1.4", "text": "D, written anew.", "why": "c"}]</changes>\nDone.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Cut three and five, write four anew.' });
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['A one.', 'B two.', 'D, written anew.', 'F six.']);
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['made', 'made', 'made']);
  assert.equal(changes.labelNow(b.novelId, v.changes[2]), 'Chapter One, passage 3', 'the row names it as the page numbers it now');
  assert.equal(v.changes[2].label, 'Chapter One, passage 4', 'what the partner is told back is its own number');
  assert.equal(b.ch().passages[2].versions[0].text, 'D four.', 'the words before one arrow away');
  await putAway(b);
});

await test('set to wait, a change keeps the passage it named: Apply all after he writes one in takes out the two it meant; one he changed since, or took out, is said and left', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['A one.', 'B two.', 'C three.', 'D four.', 'E five.']], { manual: true });
  await script([{ text: '<changes>[{"passage": "1.3", "remove": true, "why": "a"}, {"passage": "1.4", "remove": true, "why": "b"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Cut three and four.' });
  let turn = store.peek('talk', b.novelId).turns.at(-1);
  let v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['waiting', 'waiting']);
  /* he writes a passage in after the first: every number after it moves */
  store.change('chapter', b.ids[0], shape.chapterSteps.addPassage(shape.newPassage('you', 'MINE.'), b.ch().passages[0].id), { now: true });
  const all = talk.settleAll(b.novelId, turn.id, v.id, 'apply');
  assert.equal(all.done, 2, JSON.stringify(all));
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['A one.', 'MINE.', 'B two.', 'E five.']);
  /* a removal waiting for a passage he has changed since is never made unseen */
  await script([{ text: '<changes>[{"passage": "1.3", "remove": true, "why": "c"}, {"passage": "1.4", "remove": true, "why": "d"}]</changes>\nTwo more.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Cut B and E.' });
  turn = store.peek('talk', b.novelId).turns.at(-1);
  v = picked(turn);
  const pB = b.ch().passages[2].id;
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pB, shape.newVersion({ text: 'B, CHANGED BY HIM.', how: 'edit' })), { now: true });
  store.change('chapter', b.ids[0], shape.chapterSteps.removePassage(b.ch().passages[3].id), { now: true });
  assert.match(talk.waitingWhy(b.novelId, picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0]), /changed since/);
  const one = talk.applyChange(b.novelId, turn.id, v.id, v.changes[0].id);
  assert.equal(one.ok, false);
  assert.match(one.said, /changed since this was offered/);
  const two = talk.applyChange(b.novelId, turn.id, v.id, v.changes[1].id);
  assert.equal(two.ok, false);
  assert.match(two.said, /not there any more/);
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['A one.', 'MINE.', 'B, CHANGED BY HIM.']);
  await setHouse();
  await putAway(b);
});

await test('the partner names a chapter in words — “Chapter Two”, “two” — as the page names it; a list of chapters is each one, never a range', async () => {
  const b = await makeBook([['One cat.'], ['Two cat.'], ['Three cat.'], ['Four cat.'], ['Five cat.']], { manual: true });
  const a = changes.makeChange(b.novelId, { chapter: 'Chapter Two', name: 'The Ferry' });
  assert.equal(a.status, 'made', a.said);
  assert.equal(b.ch(1).name, 'The Ferry');
  const s = changes.makeChange(b.novelId, { summary: 'two', text: 'Mara crosses on the ferry.' });
  assert.equal(s.status, 'made', s.said);
  assert.equal(b.ch(1).summary.text, 'Mara crosses on the ferry.');
  assert.equal(changes.labelOf({ chapter: 'Chapter Two', name: 'x' }), 'Chapter Two’s name');
  assert.match(changes.makeChange(b.novelId, { chapter: 'the ferry one', name: 'x' }).said, /not a chapter number/);
  /* [2, 5] is Chapters Two and Five — Three and Four are not touched */
  assert.equal(changes.labelOf({ replace_all: true, find: 'cat', replace: 'dog', chapters: [2, 5] }), '“cat” across Chapters Two and Five');
  assert.equal(changes.labelOf({ replace_all: true, find: 'cat', replace: 'dog', range: '3-4' }), '“cat” across Chapters Three to Four');
  const r = changes.makeChange(b.novelId, { replace_all: true, find: 'cat', replace: 'dog', chapters: [2, 5] });
  assert.equal(r.status, 'made', r.said);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => picked(b.ch(i).passages[0]).text), ['One cat.', 'Two dog.', 'Three cat.', 'Four cat.', 'Five dog.']);
  await putAway(b);
});

await test('the partner’s card change goes through the helper’s door: nothing, “…”, “(unchanged)” or an object changes nothing and “…” is no name; a short form or a thread said otherwise is named back with the card’s own name — never a second card; “dropAka” takes a name off', async () => {
  const b = await makeBook([['Rias Wells kept the lamp.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-r', name: 'Rias Wells', about: 'A healer.', ties: 'Owes Oren.', now: 'At the docks.', aka: [] }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('threads', { id: 'th-t', name: 'Tom promised to fix the roof', about: 'Before winter.', open: true }), { now: true });
  const r = changes.makeChange(b.novelId, { note: 'people', name: 'Rias Wells', now: 'In the cellar.', about: '', ties: null, newName: '…', aka: null });
  assert.equal(r.status, 'made', r.said);
  const card = b.novel().notes.people[0];
  assert.deepEqual([card.name, card.about, card.ties, card.now, card.aka], ['Rias Wells', 'A healer.', 'Owes Oren.', 'In the cellar.', []]);
  assert.deepEqual(card.updated.his, ['now'], 'his in the part it wrote, and only there');
  for (const about of ['…', '(unchanged)', 'Unchanged from before.', 'Not mentioned in this passage.', { text: 'x' }]) {
    assert.equal(changes.makeChange(b.novelId, { note: 'people', name: 'Rias Wells', about }).status, 'refused', JSON.stringify(about));
  }
  assert.equal(b.novel().notes.people[0].about, 'A healer.');
  assert.match(changes.makeChange(b.novelId, { note: 'people', name: '…', about: 'Someone.' }).said, /is no name/);
  assert.match(changes.makeChange(b.novelId, { note: 'people', name: 'Rias', now: 'Upstairs.' }).said, /there is no Rias in the notes — the card is called Rias Wells/);
  assert.match(changes.makeChange(b.novelId, { note: 'threads', name: "Tom's promise to fix the roof", open: false }).said, /the card is called Tom promised to fix the roof/);
  assert.equal(b.novel().notes.people.length, 1);
  assert.deepEqual(b.novel().notes.threads.map((t) => t.open), [true]);
  assert.equal(changes.makeChange(b.novelId, { note: 'threads', name: 'Tom promised to fix the roof', open: false }).status, 'made');
  changes.makeChange(b.novelId, { note: 'people', name: 'Rias Wells', aka: ['Wells', 'the healer'] });
  changes.makeChange(b.novelId, { note: 'people', name: 'Rias Wells', dropAka: 'Wells' });
  assert.deepEqual(b.novel().notes.people[0].aka, ['the healer']);
  /* the helper's door is one door */
  for (const nothing of ['Unchanged from before.', 'Unchanged since the last chapter.', 'No changes in this passage.', 'N/A (not in this passage)', '(unchanged)', '[unchanged]', 'No new information.', 'Nothing new to report.', 'None — the line is complete.', 'DETAIL: none', 'No update.', 'other names they go by']) assert.equal(archivist.cleanText(nothing), '', nothing);
  for (const real of ['Unknown to her, Tom had followed.', 'None of the guards saw her.', 'Same as ever — sharp-tongued and kind.', 'No change in her: still cold to Tom.', 'Nothing in the harbour moves.']) assert.equal(archivist.cleanText(real), real, real);
  await putAway(b);
});

await test('names changed everywhere in one answer are made together: a swap swaps, a chain is made as said; one Undo takes back both, and set to wait they are applied or left together', async () => {
  const b = await makeBook([['Kara laughed.', 'Mara wept.', 'Lena sang.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-k', name: 'Kara', about: 'The elder.' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mara', about: 'The younger.' }), { now: true });
  await script([{ text: '<changes>[{"rename": {"from": "Kara", "to": "Mara"}, "why": "swap"}, {"rename": {"from": "Mara", "to": "Kara"}, "why": "swap"}]</changes>\nSwapped.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Swap their names.' });
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['Mara laughed.', 'Kara wept.', 'Lena sang.']);
  assert.deepEqual(b.novel().notes.people.map((c) => [c.id, c.name]), [['pe-k', 'Mara'], ['pe-m', 'Kara']]);
  assert.equal(b.novel().memory && b.novel().memory.auditAsked, undefined, 'no two cards share a name, so nothing is folded');
  let turn = store.peek('talk', b.novelId).turns.at(-1);
  let v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['made', 'made']);
  assert.equal(v.changes[1].with, v.changes[0].id);
  /* Undo on the second takes back both */
  const u = talk.undoOneChange(b.novelId, turn.id, v.id, v.changes[1].id);
  assert.equal(u.ok, true, u.said);
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['Kara laughed.', 'Mara wept.', 'Lena sang.']);
  assert.deepEqual(picked(store.peek('talk', b.novelId).turns.at(-1)).changes.map((c) => c.status), ['undone', 'undone']);
  /* a chain, set to wait: Lena to Mara and Mara to Ilse — applied together from one */
  await setHouse({}, { partnerApplies: 'wait' });
  await script([{ text: '<changes>[{"rename": {"from": "Lena", "to": "Mara"}, "why": "a"}, {"rename": {"from": "Mara", "to": "Ilse"}, "why": "b"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Lena becomes Mara; Mara becomes Ilse.' });
  turn = store.peek('talk', b.novelId).turns.at(-1);
  v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['waiting', 'waiting']);
  assert.ok(v.changes[0].group && v.changes[0].group === v.changes[1].group);
  const a = talk.applyChange(b.novelId, turn.id, v.id, v.changes[1].id);
  assert.equal(a.ok, true, a.said);
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['Kara laughed.', 'Ilse wept.', 'Mara sang.']);
  assert.deepEqual(picked(store.peek('talk', b.novelId).turns.at(-1)).changes.map((c) => c.status), ['made', 'made']);
  await setHouse();
  await putAway(b);
});

await test('names that hold one another, changed in one answer, are each changed once — the longer name first', async () => {
  const b = await makeBook([['Mara Holt and Mara met.']], { manual: true });
  await script([{ text: '<changes>[{"rename": {"from": "Mara", "to": "Mira"}, "why": "a"}, {"rename": {"from": "Mara Holt", "to": "Mara Venn"}, "why": "b"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Rename them.' });
  assert.equal(picked(b.ch().passages[0]).text, 'Mara Venn and Mira met.');
  await putAway(b);
});

await test('a card change set to wait is watched only in the parts it writes: the helper moving where someone is now never stops a change to who they are; two changes to two parts of one card both land; a newer answer sets aside only the same part', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['Mira read by the fire.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mira', about: 'A reader.', ties: 'Owes Tom.', now: 'By the fire.', aka: [] }), { now: true });
  await script([{ text: '<changes>[{"note": "people", "name": "Mira", "about": "A reader, left-handed.", "why": "a"}, {"note": "people", "name": "Mira", "ties": "Owes Tom; trusts Kai.", "why": "b"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Fix Mira.' });
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  /* the helper moves where she is now */
  store.change('novel', b.novelId, (n) => { n.notes.people[0].now = 'Asleep upstairs.'; }, { now: true });
  assert.equal(talk.waitingWhy(b.novelId, v.changes[0]), '');
  /* a newer answer about where she is now leaves both waiting */
  await script([{ text: '<changes>[{"note": "people", "name": "Mira", "now": "On the road.", "why": "c"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Where is she?' });
  assert.deepEqual(picked(store.peek('talk', b.novelId).turns.find((t) => t.id === turn.id)).changes.map((c) => c.status), ['waiting', 'waiting']);
  const all = talk.settleAll(b.novelId, turn.id, v.id, 'apply');
  assert.equal(all.done, 2, JSON.stringify(all));
  const m = b.novel().notes.people[0];
  assert.deepEqual([m.about, m.ties, m.now], ['A reader, left-handed.', 'Owes Tom; trusts Kai.', 'Asleep upstairs.']);
  await setHouse();
  await putAway(b);
});

await test('a read block of more than one answer reads names back what was not sent — never “here they are, whole” over a cut', async () => {
  const b = await makeBook(Array.from({ length: 10 }, (_, i) => [`Chapter ${i + 1} words.`]), { manual: true });
  await script([{ text: '<read>[1,2,3,4,5,6,7,8,9,10]</read>' }, { text: 'Read them.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Read everything.' });
  const r = await requests();
  const back = r[1].body.messages.at(-1).content;
  assert.match(back, /Not sent: Chapter Nine, Chapter Ten — one answer reads eight at most/);
  await putAway(b);
});

await test('a change still waiting shows the words it would write over, as they stand now', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['One.'], ['Two.']], { manual: true });
  store.change('novel', b.novelId, (n) => { n.brief = 'HIS OLD WORDS.'; }, { now: true });
  await script([{ text: '<changes>[{"book": "about", "text": "New words.", "why": "a"}, {"chapter": "Chapter Two", "name": "The Ferry", "why": "b"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Change them.' });
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(changes.wordsNow(b.novelId, v.changes[0]), 'HIS OLD WORDS.');
  store.change('chapter', b.ids[1], shape.chapterSteps.setName('Old Name', 'you'), { now: true });
  assert.equal(changes.wordsNow(b.novelId, v.changes[1]), 'Old Name');
  await setHouse();
  await putAway(b);
});

await test('a change claimed only in words is asked for once — “Done — …”, “Updated …”; a thought aloud, a supposing or a change made before is never one; a second answer that comes back cut leaves the first standing, with what it made', async () => {
  for (const [t, want] of [['Done — Mira is nineteen now.', true], ['Mira’s card has been updated: she’s nineteen.', true], ['Updated Mira to nineteen.', true], ['Done — Mira is nineteen now, not seventeen.', true], ['I’ve changed her age to nineteen.', true],
    ['I’ve changed my mind about the ending — it works.', false], ['If I changed the ending, she would never forgive him.', false], ['Since I rewrote passage 2.3 earlier, the seam holds.', false],
    ['I have updated nothing yet.', false], ['If you cut the adverb, the opening now reads much more cleanly.', false], ['I cut a scene like this from my own first draft.', false], ['Should I change the ending?', false],
    ['Done.', true], ['All set!', true], ['Done reading.', false], ['Done with the chapters — here is what I think.', false]]) {
    assert.equal(talk.claimsChange(t), want, t);
  }
  const b = await makeBook([['Mira was seventeen.']], { manual: true });
  await script([{ text: 'Done — she is nineteen now.' }, { text: '<changes>[{"passage": "1.1", "find": "seventeen", "replace": "nineteen", "why": "her age"}]</changes>\nHere is the whole answer again, and it runs on and on', finish: 'length' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Make Mira nineteen.' });
  assert.equal((await requests()).length, 2, 'asked once more, no more');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.ok(v.text.startsWith('Done — she is nineteen now.'), v.text);
  assert.ok(v.text.includes('<changes>'), 'the block that made the change is kept with it');
  assert.equal(v.cut, undefined, 'the first answer came whole');
  assert.equal(picked(b.ch().passages[0]).text, 'Mira was nineteen.');
  await putAway(b);
});

await test('the partner is shown whole every card his message names, however many the notes hold; a card it saw only by its first line is read whole before it is written', async () => {
  const b = await makeBook([['Mara climbed to the lamp.']], { manual: true });
  for (let i = 0; i < 40; i++) store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: `Person ${i}`, about: `First line of person ${i}. ` + 'More about them, a long story told slowly. '.repeat(20), ties: `TIES OF PERSON ${i}` })), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Kai Storm', about: 'A fisherman of the north harbour, slow to speak. SECRET FACT ABOUT KAI.', ties: 'OWES MARA A BOAT.' })), { now: true });
  await setHouse({ context: 16000 }, CRAFTS_OFF);
  await script([{ text: 'He is a fisherman.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Tell me about Kai Storm.' });
  let r = await requests();
  const sent = [systemOf(r[0]), ...r[0].body.messages.map((m) => String(m.content))].join('\n');
  assert.ok(sent.includes('shown by their first line'), 'the notes were fitted');
  assert.ok(sent.includes('SECRET FACT ABOUT KAI') && sent.includes('OWES MARA A BOAT'), 'the card he named rides whole');
  assert.ok(!sent.includes('TIES OF PERSON 7'), 'a card he did not name rides by its first line');
  await reset();
  await script([
    { text: '<changes>[{"note": "people", "name": "Person 3", "about": "Only this now.", "why": "x"}]</changes>\nChanged.' },
    { text: '<read>["card: Person 3"]</read>' },
    { text: '<changes>[{"note": "people", "name": "Person 3", "about": "First line of person 3. All of it kept, and a new fact.", "why": "x"}]</changes>\nNow made.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Fix the notes.' });
  r = await requests();
  assert.equal(r.length, 3);
  assert.ok(String(r[2].body.messages.at(-1).content).includes('TIES OF PERSON 3'), 'the card came back whole');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.match(v.changes[0].said, /only by its first line/);
  assert.equal(b.novel().notes.people.find((c) => c.name === 'Person 3').about, 'First line of person 3. All of it kept, and a new fact.');
  await setHouse();
  await putAway(b);
});

await test('a passage the partner writes anew is made whole the way a page is: a stray of another script stuck to a word, a quotation left open', async () => {
  const story = 'The lamp burned low over the harbour as the boats came home, one by one, their sails grey against a darker sky. '.repeat(3);
  const b = await makeBook([[story]], { manual: true });
  const r = changes.makeChange(b.novelId, { passage: '1.1', text: `${story}She said, “Wait for me.\n\nThe 吃door opened and the wind came in off the water, cold and salt.` });
  assert.equal(r.status, 'made', r.said);
  const t = picked(b.ch().passages[0]).text;
  assert.ok(!t.includes('吃'), t.slice(-120));
  assert.ok(t.includes('“Wait for me.”'), t.slice(-160));
  assert.match(r.said, /stray character/);
  await putAway(b);
});

await test('a name changed everywhere is read, checked and summed up already: nothing is asked again, the summaries say the new name, and Undo puts it all back as it was', async () => {
  const b = await makeBook([['Mira lit the lamp.', 'The sea rose.'], ['Mira slept by the fire.']], { manual: true });
  markAllSeen(b);
  for (let i = 0; i < 2; i++) store.change('chapter', b.ids[i], shape.chapterSteps.setSummary({ text: `Summary ${i}: Mira does things.`, fp: shape.chapterPrint(b.ch(i)), at: Date.now() }), { now: true });
  const p11 = b.ch(0).passages[0];
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p11.id, picked(p11).id, { round: 'r1', sig: util.hashText(picked(p11).text), at: Date.now(), items: [{ id: 'i1', kind: 'grammar', find: 'Mira lit', replace: 'Mira lights', why: 'tense' }] }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mira', about: 'The keeper.' }), { now: true });
  assert.equal(archivist.pendingWork(b.novelId), false);
  const r = changes.makeChange(b.novelId, { rename: { from: 'Mira', to: 'Myra' } });
  assert.equal(r.status, 'made', r.said);
  assert.equal(picked(b.ch(0).passages[0]).text, 'Myra lit the lamp.');
  assert.equal(archivist.pendingWork(b.novelId), false, 'nothing for the helper to read again');
  assert.equal(b.ch(0).summary.text, 'Summary 0: Myra does things.');
  assert.equal(b.ch(0).summary.fp, shape.chapterPrint(b.ch(0)));
  const e = checker.entryFor(b.ch(0), b.ch(0).passages[0]);
  assert.ok(e, 'the finding follows the renamed version');
  assert.equal(e.items[0].find, 'Myra lit');
  assert.equal(changes.undoChange(b.novelId, r).ok, true);
  assert.equal(picked(b.ch(0).passages[0]).text, 'Mira lit the lamp.');
  assert.equal(archivist.pendingWork(b.novelId), false, 'nor after its Undo');
  assert.equal(b.ch(0).summary.text, 'Summary 0: Mira does things.');
  await putAway(b);
});

await test('work begun before a name changed everywhere is given the new name: a reading that lands after it makes no card under the old one', async () => {
  const b = await makeBook([['Mira lit the lamp.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mira', about: 'The keeper.', now: '' }), { now: true });
  await script([{ pause: 1.5, text: JSON.stringify({ people: [{ name: 'Mira', now: 'In the lamp room.' }] }) }]);
  const reading = archivist.run(b.novelId);
  await sleep(500);
  const r = changes.makeChange(b.novelId, { rename: { from: 'Mira', to: 'Mina' } });
  assert.equal(r.status, 'made', r.said);
  await reading;
  const people = b.novel().notes.people;
  assert.deepEqual(people.map((c) => [c.name, c.now]), [['Mina', 'In the lamp room.']]);
  assert.equal(archivist.pendingWork(b.novelId), false, 'the renamed passage counts as read');
  await putAway(b);
});

await test('the checker knows his own words and old writing by the version they came from: a fix he applies himself never lets the others go in by themselves, and a name changed everywhere sends the checker nothing', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 } });
  const b = await makeBook([[]], { manual: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own words alot and and more teh end.' });
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'x' },
    { passage: '1.1', kind: 'grammar', find: 'and and', replace: 'and', why: 'y' },
    { passage: '1.1', kind: 'grammar', find: 'teh', replace: 'the', why: 'z' }] }) }]);
  await checker.runCheck(b.novelId);
  const s = checker.suggestions(b.novelId);
  assert.equal(s.length, 3);
  assert.equal(checker.applyOne(b.novelId, s[0].chapterId, s[0].passageId, s[0].item.id).ok !== false, true);
  await checker.runCheck(b.novelId);
  assert.equal(picked(b.ch().passages[0]).text, 'My own words a lot and and more teh end.', 'the other two still wait for him');
  assert.equal(checker.suggestions(b.novelId).length, 2);
  await putAway(b);
  await setHouse({}, { checksFrom: Date.now(), judge: { on: false } });
  await reset();
  const c = await makeBook([[{ text: 'Jovan walked.', at: Date.now() - 100000 }, { text: 'Jovan ran.', at: Date.now() - 100000 }]], { manual: true });
  assert.equal(changes.makeChange(c.novelId, { rename: { from: 'Jovan', to: 'Jovann' } }).status, 'made');
  await checker.runCheck(c.novelId);
  assert.equal((await requests()).length, 0, 'writing from before the checker began is not checked by itself — renamed or not');
  await setHouse();
  await putAway(c);
});

await test('a scene whose prose was taken out of the book lets go of “written into the book”: what it covered rides again as the scene', async () => {
  const b = await makeBook([['The lamp was lit.']], { manual: true });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  store.change('play', id, (d) => { d.turns = [shape.newTurn('you', 'I climb the stair.'), shape.newTurn('ai', 'THE STAIR CREAKS.')]; }, { now: true });
  const prose = shape.newPassage('ai', 'Prose of the stair.', { how: 'play' });
  store.change('chapter', b.ids[0], shape.chapterSteps.addPassage(prose, b.ch().passages[0].id), { now: true });
  store.change('play', id, shape.turnSteps.set({ turned: store.peek('play', id).turns[1].id, after: prose.id }), { now: true });
  store.change('chapter', b.ids[0], shape.chapterSteps.removePassage(prose.id), { now: true });
  await script([{ text: 'The lamp gutters.' }]);
  await talk.playSay({ playId: id, text: 'I look up.' });
  const q = store.peek('play', id);
  assert.equal(q.turned, null);
  const sent = (await requests())[0].body.messages.map((m) => String(m.content)).join('\n');
  assert.ok(sent.includes('THE STAIR CREAKS.'), 'the talk it covered rides again');
  assert.equal(talk.transcriptOf(q).count, 4);
  await putAway(b);
});

await test('Ideas reads nothing more and changes nothing, so it is never told it could; New ideas is told the ones on show', async () => {
  const b = await makeBook([['The lamp was lit.']], { manual: true });
  await script([{ text: '<direction>She climbs.</direction>' }]);
  const out = await talk.nextIdeas({ novelId: b.novelId, chapterId: b.ids[0], count: 1, not: ['She sleeps.'] });
  assert.equal(out.ok, true, out.error);
  const r = await requests();
  const all = [systemOf(r[0]), ...r[0].body.messages.map((m) => String(m.content))].join('\n');
  assert.ok(!all.includes('<changes>') && !all.includes('<read>'), 'no changes block, no read block');
  assert.ok(all.includes('not these, which you gave me last time:\n- She sleeps.'), 'the ones on show are named');
  await putAway(b);
});

/* last of all: it lets go of every record this page holds, as a page does when a copy comes back */
await test('a copy brought back while the page was away: what it kept waiting is let go, never saved over the copy', async () => {
  const b = await makeBook([['Mara kept the light.']]);
  await store.flush();
  const gen = (await (await realFetch(BASE + '/api/version')).json()).generation;
  const { news } = store.forTests();
  /* the line greets the page with the library as it is */
  news(JSON.stringify({ hello: { commit: 'same', generation: gen } }));
  store.change('chapter', b.ids[0], (c) => { c.passages[0].versions[0].text = 'WRITTEN BEFORE THE COPY CAME BACK'; }, { delay: 60000 });
  assert.equal(store.hasPending(), true);
  /* back after a gap: a whole copy came back meanwhile */
  news(JSON.stringify({ hello: { commit: 'same', generation: gen + 1 } }));
  assert.equal(store.hasPending(), false, 'what it kept waiting is let go');
  await store.flush();
  await sleep(200);
  assert.equal((await onPhone('chapter', b.ids[0])).passages[0].versions[0].text, 'Mara kept the light.');
  assert.equal(await store.open('chapter', b.ids[0]).then((c) => c.passages[0].versions[0].text), 'Mara kept the light.', 'the page reads the phone again');
});

/* ------------------------------------------------------------ done */
console.log(`\napp: ${passed} passed, ${failed} failed`);
done(failed ? 1 : 0);
