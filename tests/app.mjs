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
/* APP_PORT=… runs a second copy beside the first without the two sharing a server (the provider is the port after next) */
const PORT = Number(process.env.APP_PORT) || 18650;
const PROV = PORT + 2;
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
const mend = await import(path.join(ROOT, 'js/novel/mend.js'));
const inplace = await import(path.join(ROOT, 'js/novel/inplace.js'));
const { picked } = shape;

async function script(queue) { await realFetch(PROVIDER + '/script', { method: 'POST', body: JSON.stringify({ queue }) }); }
async function reset() { await realFetch(PROVIDER + '/reset'); }
/* since 2.12.27 a page in a book with a bibliography may first have the helper pick what it needs from it (bibpick.js):
 * what a page, the partner or the helper sent leaves those picks out, and the picks are read by themselves */
const isPickAsk = (x) => ((x.body && x.body.messages) || []).some((m) => String(m.content || '').includes('Answer with only this: {"entries": [the numbers]}'));
async function everyRequest() { return (await (await realFetch(PROVIDER + '/requests')).json()).requests; }
async function requests() { return (await everyRequest()).filter((x) => !isPickAsk(x)); }
async function pickAsks() { return (await everyRequest()).filter(isPickAsk); }
/* since 2.11.3 every new summary is held once against its words in the same run (the summary check): a count of
 * what the helper asked about a summary leaves those checks out, and the checks are counted by themselves */
const isCheckAsk = (x) => x.body.messages.some((m) => String(m.content || '').includes('Its summary, as it stands'));
async function notChecks() { return (await requests()).filter((x) => !isCheckAsk(x)); }
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
 * a small room, with nothing else in it (the crafts alone are ~18,000 tokens) */
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
/* (2.12: a passage the helper reads now has its bibliography facts kept with it — none here — so a book marked read is
 * not one read before the bibliography was kept; markReadBefore212 is that book) */
function markAllSeen(b, { facts = true } = {}) {
  const n = b.novel();
  for (const id of n.order) {
    const c = store.peek('chapter', id);
    const map = {};
    for (const p of c.passages) if (p.by !== 'break') map[p.id] = archivist.signature(picked(p));
    store.change('novel', b.novelId, shape.novelSteps.seen(id, map));
    if (facts) store.change('chapter', id, (ch) => { for (const p of ch.passages) { const v = picked(p); if (p.by !== 'break' && v && !v.codex) v.codex = { schema: 1, fp: util.hashText(v.text || ''), facts: [], complete: true }; } });
  }
}
const markReadBefore212 = (b) => markAllSeen(b, { facts: false });
/* a book done with: its helper has nothing to come back for */
async function putAway(b) { try { await store.flush(); await store.remove('novel', b.novelId); } catch (_) { /* gone */ } }

/* ------------------------------------------------------------ checks */

let passed = 0;
let failed = 0;
let section = '';
/* the helper and the checker of the checks before go quiet first: no look of
 * theirs, booked for a book of another check, lands in this one's requests */
async function quietAll() {
  /* (the checker keeps {due, t} for each book, the helper the timer itself) */
  const stop = (t) => clearTimeout(t && t.due !== undefined ? t.t : t);
  for (const w of [archivist.forTests(), checker.forTests()]) { for (const t of w.timers.values()) stop(t); w.timers.clear(); }
  for (let i = 0; i < 300 && (archivist.forTests().running.size || checker.forTests().running.size); i++) await sleep(20);
  for (const w of [archivist.forTests(), checker.forTests()]) { for (const t of w.timers.values()) stop(t); w.timers.clear(); }
}
async function test(name, fn) {
  /* ONLY=words runs just the checks whose names hold them; SECTION=words, just the checks under a heading that holds them */
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  if (process.env.SECTION && !section.includes(process.env.SECTION)) return;
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
  /* he is told too: the passage says the chapter was sent in part — the part that was (2.11: what follows the point here; it said the middle before it was left out) */
  const said = picked(b.ch().passages[1]).notes || [];
  assert.ok(said.some((n) => n.includes('What follows this point in the chapter was sent only in part')) && !said.some((n) => n.includes('middle left out')), JSON.stringify(said));
  await setHouse();
  await putAway(b);
});

/* (through 2.12.1 an edit made a version of its own — his word, 2.12.2: "new version is only for rewrite or another
 * take": an edit goes on the page itself, the words before kept on it, and Put back the words before brings them) */
await test('an edit goes on the page itself — no new version; the words before are kept on it and Put back the words before brings them, one at a time', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  const p = b.ch().passages[0];
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'The lamp was warm.' }), true);
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'The lamp was warm.' }), false, 'nothing changed');
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: '   ' }), false, 'an emptied passage is not kept');
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'The lamp was hot.' }), true);
  await store.flush();
  let c = await onPhone('chapter', b.ids[0]);
  assert.deepEqual(c.passages[0].versions.map((v) => v.text), ['The lamp was hot.'], 'one version, his words on it');
  const v = picked(c.passages[0]);
  assert.deepEqual([v.how, v.hands, v.written, v.before.map((x) => [x.text, x.by])], ['write', ['you'], 'The lamp was cold.', [['The lamp was cold.', 'you'], ['The lamp was warm.', 'you']]]);
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).ok, true);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was warm.');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).ok, true);
  await store.flush();
  c = await onPhone('chapter', b.ids[0]);
  const back = picked(c.passages[0]);
  assert.deepEqual([back.text, back.before, back.hands, back.written], ['The lamp was cold.', undefined, undefined, undefined], 'back to his first words: no longer changed by anyone');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).said, 'there are no words before to put back');
  await putAway(b);
});

await test('many changes on one page: Put back the words before always comes back to the words as first written — the newest four changes kept, and the first words never let go', async () => {
  const b = await makeBook([[{ text: 'The lamp was cold.', model: 'model-a' }]]);
  const p = b.ch().passages[0];
  const words = ['The lamp was warm.', 'The lamp was hot.', 'The lamp burned.', 'The lamp burned low.', 'The lamp flickered.', 'The lamp went out.', 'The lamp was dark.'];
  const by = ['checker', 'you', 'partner', 'checker', 'you', 'checker', 'you'];
  words.forEach((t, i) => assert.ok(inplace.changeInPlace({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, next: t, by: by[i] })));
  await store.flush();
  const v = picked((await onPhone('chapter', b.ids[0])).passages[0]);
  assert.equal(b.ch().passages[0].versions.length, 1, 'still one version');
  assert.deepEqual(v.before.map((x) => x.text), ['The lamp was cold.', 'The lamp burned.', 'The lamp burned low.', 'The lamp flickered.', 'The lamp went out.'], 'the first words, then the newest four');
  const seen = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).ok, true);
    seen.push(picked(b.ch().passages[0]).text);
  }
  assert.deepEqual(seen, ['The lamp went out.', 'The lamp flickered.', 'The lamp burned low.', 'The lamp burned.', 'The lamp was cold.']);
  const back = picked(b.ch().passages[0]);
  assert.deepEqual([back.before, back.hands, back.written], [undefined, undefined, undefined], 'its first words: the writer’s own again, changed by no one');
  assert.deepEqual(checker.gradesOf(b.novelId).models.filter((m) => m.mixed), [], 'no Mixed row for it now');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).said, 'there are no words before to put back');
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

await test('a finished chapter gets a summary; stale summaries give way to current excerpts', async () => {
  const b = await makeBook([['Chapter one words.'], ['Chapter two words.']]);
  markAllSeen(b);
  await script([{ text: JSON.stringify({ summary: 'Mara finds the letter.', name: 'The Letter' }) }]);
  await archivist.run(b.novelId);
  const c1 = await onPhone('chapter', b.ids[0]);
  assert.equal(c1.summary.text, 'Mara finds the letter.');
  assert.equal(c1.name, 'The Letter');
  /* the chapter changes: current excerpts replace obsolete summary facts until it is read again */
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'A line added later. '.repeat(3000) });
  const n = b.novel();
  const chapters = { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) };
  const a = context.assemble({ house: quietHouse(), novel: n, chapters, conn: { ...CONN, context: 9000, maxTokens: 500 }, target: { chapterId: b.ids[1] }, request: 'Go.' });
  assert.ok(a.system.includes('current opening and close'), a.system.slice(0, 2000));
  assert.ok(!a.system.includes('Mara finds the letter.'), 'obsolete summary facts never reach the writer');
  assert.ok(a.system.includes('A line added later.'), 'current chapter words reach the writer');
  assert.equal(a.stats.short, 1, 'one earlier chapter sent only in short');
  assert.equal(a.stats.whole, 1, 'only the current chapter sent whole');
  await putAway(b);
});

await test('a long chapter is summed up in parts that fit the helper\'s model', async () => {
  const para = 'The storm came in off the water like a held breath let go. '.repeat(40);
  const big = Array.from({ length: 12 }, () => para).join('\n\n');
  const b = await makeBook([[big], ['Next chapter.']]);
  markAllSeen(b);
  /* the helper on a small model of its own; the writer's room holds the chapter whole, so it is never kept in stretches (2.11) — summed up in parts */
  await setHouse({ context: 200000 }, { connections: [{ ...CONN, context: 200000 }, { ...CONN, id: 'c-h', context: 12000 }], roles: { writer: 'c-w', helper: 'c-h' } });
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
  /* a name two cards answer to writes on neither — what it says is kept on a card of its own, for the notes' check to fold where it belongs (2.6: never lost) */
  assert.equal(out.notes.people.length, 5, 'no new card for a short form; one for the name two cards answer to');
  assert.deepEqual([p('p1').now, p('p2').now], ['', ''], 'a name two cards answer to writes on neither');
  const own = out.notes.people.find((c) => c.name === 'Kuchiki');
  assert.equal(own.now, 'At the gate.');
  assert.deepEqual(out.aside, [{ kind: 'people', name: 'Kuchiki', own: own.id }]);
  assert.equal(out.whys[own.id], 'two cards answer to this name (Byakuya Kuchiki, Rukia Kuchiki) — the notes’ check folds it where it belongs');
  assert.equal(p('p3').now, 'In the hall.');
  assert.ok(p('p3').aka.includes('Rias'), 'the short form kept among its names');
  assert.equal(p('p4').now, 'On the wall.', 'a rank set aside');
  assert.equal(p('p2').about, 'A lieutenant of the thirteenth.');
  assert.equal(out.notes.places.length, 1);
  assert.equal(out.notes.places[0].about, 'A house with a red door.', 'a place called the same but for "the"');
});

await test('a whole book folded in one pass says what the regexes say, letter for letter — and asked again for the same words, it is kept (2.12.6)', () => {
  /* the fold as the regexes define it (what short names still go through) */
  const loose = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tight = (t) => loose(t.replace(/([\p{L}\p{M}])['’‘ʼ](?=\p{L})/gu, '$1'));
  const pieces = [
    'Mara Venn carried the lantern; Rowan O’Hale and Mrs O\'Brien waited — “there’s time,” said Suì-Fēng.',
    'Kyōraku-san, Chloé, Zoë, José, naïve café, Dvořák, Ǳ and ǅ; 9’s not enough, ninety-nine’s is; Oʼ Brien, aʼʼb, a\'b\'c.',
    'nn‘̧𝔄İ — ςéʼ́ǅá — a’̧Å — 漢字とひらがな。한국어 ٣ Ⅻ ² 😀 𝔄𝟘 — é\'a, ²́\'म, नमस्ते',
    '  leading and trailing spaces, tabs\t and\n\nbreaks  ',
  ];
  for (const piece of pieces) {
    const long = `${'x'.repeat(260)} ${piece} ${'y'.repeat(260)}`;
    const got = namesjs.foldedText(long);
    assert.equal(got.loose, ` ${loose(long)} `, `loose: ${piece}`);
    assert.equal(got.tight, ` ${tight(long)} `, `tight: ${piece}`);
    /* the same text, long or short, folds the same way: a name asked of the book is found as it is of a line */
    const short = namesjs.foldedText(piece);
    assert.equal(short.loose, ` ${loose(piece)} `);
    assert.equal(short.tight, ` ${tight(piece)} `);
  }
  const book = `${pieces.join('\n\n')}\n\n`.repeat(400);
  const folded = namesjs.foldedText(book);
  assert.ok(namesjs.nameInText(folded, 'O’Brien') && namesjs.nameInText(folded, 'Suì-Fēng') && namesjs.nameInText(folded, 'Rowan O’Hale') && !namesjs.nameInText(folded, 'Byakuya'));
  /* asked again for the same words in a new string: the same answer, from what was kept — cheaper than folding by far */
  const t0 = performance.now(); const again = namesjs.foldedText(`${book}`.slice(0)); const kept = performance.now() - t0;
  assert.equal(again.loose, folded.loose);
  const t1 = performance.now(); namesjs.foldedText(`${book}z`); const fresh = performance.now() - t1;
  assert.ok(kept < fresh, `kept ${kept.toFixed(1)} ms, fresh ${fresh.toFixed(1)} ms`);
  /* the cased fold is untouched */
  assert.equal(namesjs.foldedText('x'.repeat(300) + ' Zoë', { cased: true }).cased, 'x'.repeat(300) + ' Zoe');
});

await test('words and tokens counted once for the same text: the same answer for the same words however the string was made, another for other words', () => {
  const text = 'Mara Venn kept the light; 漢字 and ٣ figures. '.repeat(50);
  const words = util.countWords(text), tokens = util.estimateTokens(text);
  assert.equal(words, util.countWords(text.split('').join('')), 'the same words, a new string');
  assert.equal(tokens, util.estimateTokens(`${text}`));
  assert.equal(util.countWords('Mara Venn kept the light; 漢字 and ٣ figures. '), 10, 'eight words, two CJK letters');
  assert.notEqual(util.countWords(`${text} more`), words);
  assert.equal(util.countWords(''), 0);
  assert.equal(util.estimateTokens(''), 0);
  assert.ok(util.estimateTokens(`${text}${text}`) > tokens);
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
  /* what it said is kept on a thread of its own, as it said it, for the notes' check to fold (2.6) */
  const own = out.notes.threads.find((c) => c.name === 'Venn’s letter');
  assert.deepEqual([own.about, own.open], ['Read at last.', false]);
  assert.ok(out.aside.some((x) => x.name === 'Venn’s letter' && x.own === own.id));
  assert.equal(t('t5').open, false, '"open": "closed" is closed');
  assert.equal(t('t6').open, false, '"resolved": "yes" is closed');
  assert.equal(out.notes.threads.length, 7, 'nothing opened for "TBD"');
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
  /* what it gives of his card rides beside his words, never over them (2.6) */
  assert.equal(n.notes.people[0].since, 'NOT HIS');
  assert.equal(n.notes.people[0].updated.by, 'you', 'still his');
  assert.equal(n.memory.audit.verdict, 'Every card now holds true to the book.');
  assert.equal(n.memory.audit.clear, true);
  assert.deepEqual(n.memory.audit.changes.map((c) => [c.name, c.how, c.why]), [['Mara', 'changed', 'tried'], ['The Gift', 'changed', 'took in what Gift limits said'], ['Gift limits', 'gone', 'said the same as The Gift']]);
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
  assert.equal((await notChecks()).length, 2, 'the empty one asked again');
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
  /* (an edit goes on the page itself since 2.12.2: the words before come back by Put back the words before, not the arrows) */
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).ok, true);
  await reset();
  await archivist.run(b.novelId);
  assert.equal(b.ch().summary.text, 'HIS SUMMARY.', 'his comes back with the words');
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

await test('the partner is told the bibliography is the world behind the book, made up when he asks — written whole in the block, never asked about first, never refused as invention (2.12.6)', () => {
  const frame = prompts.partnerFrame({}, { meta: { title: 'T' }, brief: '' });
  const entry = frame.split('\n').find((l) => l.startsWith('- "entry"'));
  assert.ok(entry, 'the entry change is explained');
  assert.ok(entry.includes('whether or not a page has said it yet') && entry.includes('inventing freely wherever the pages have not spoken') && entry.includes('never against what they have said'), entry);
  assert.ok(entry.includes('Never ask me for the particulars first') && entry.includes('whole, in the block, in that same answer'), entry);
  assert.ok(!/never inventing/.test(frame) && !/never make up a passage or a fact/.test(frame), 'no line that reads as a refusal to make the world up');
  assert.ok(frame.includes('is ours to make up, so make it'), 'what he asks for is made, not described');
  /* Ideas (no changes) is told none of this */
  assert.ok(!prompts.partnerFrame({}, { meta: { title: 'T' }, brief: '' }, { tools: false }).includes('"entry"'));
  /* the pages already written are its to change when asked — never a premise handed back for a page that exists; a question about the story gets its view and an offer to rewrite the passages it would touch (2.12.8) */
  assert.ok(frame.includes('The pages already written are yours to change when I ask') && frame.includes('never hand me one for a page that exists') && frame.includes('Say rewrite and I hand'), 'rewriting an existing page is its job, offered when he only asks');
  assert.ok(frame.includes('["about"]</read>'), 'it can read the book’s own words before changing them');
});

await test('the partner can read About this book whole — what it’s about, how it reads, where it’s headed, as they stand now — and change it quoting from that (2.12.8)', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true, brief: 'The White Bride is a marriage that is a border treaty. Jovan chose her from a shortlist.' });
  store.change('novel', b.novelId, (n) => { n.style = 'Close third, dry.'; n.plans = 'The merger closes in chapter nine.'; }, { now: true });
  await script([
    { text: 'Let me see the words as they stand.\n<read>["about"]</read>' },
    { text: '<changes>[{"book": "about", "find": "Jovan chose her from a shortlist.", "replace": "Reginald chose her; Jovan was told.", "why": "the father’s ambition, not Jovan’s choice"}]</changes>\nReginald is the author of the merger now.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Make it the father’s ambition, not Jovan choosing.' });
  const r = await requests();
  assert.equal(r.length, 2, 'read, then answered');
  const back = String(r[1].body.messages.at(-1).content);
  assert.ok(back.includes('About this book, as it stands now') && back.includes('What it\'s about ("about"):\nThe White Bride is a marriage that is a border treaty. Jovan chose her from a shortlist.') && back.includes('How it reads ("style"):\nClose third, dry.') && back.includes('Where it\'s headed ("plans"):\nThe merger closes in chapter nine.'), back);
  assert.equal(b.novel().brief, 'The White Bride is a marriage that is a border treaty. Reginald chose her; Jovan was told.');
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes.map((c) => c.status).join(), 'made');
  assert.deepEqual(changes.readAsks('<read>["about"]</read>'), [{ about: true }]);
  assert.deepEqual(changes.readAsks('<read>["book: about", "about this book", 2]</read>'), [{ about: true }, 2]);
  await putAway(b);
});

await test('his words on a card, contradicted by words he changed himself — a rewrite from his note, his partner’s passage, his hand on the page — are put right from the book; a writer’s fresh page that says the opposite leaves them standing, a slip for the checker; a quote that stands nowhere changes nothing (2.12.10)', async () => {
  const b = await makeBook([['Jovan chose Emilia from the shortlist, and said so to his father.']], { manual: true });
  markAllSeen(b);
  const thread = { id: 'th-1', name: 'Jovan’s choice to ask for Emilia', about: 'Jovan asked his father “If it’s going to be me, let it be her,” and chose Emilia from a shortlist.', open: true, updated: { by: 'you', at: 1 } };
  store.change('novel', b.novelId, shape.novelSteps.putNote('threads', thread), { now: true });
  const card = () => b.novel().notes.threads.find((c) => c.id === 'th-1');
  const row = (contradicts, more = '') => ({ threads: [{ name: thread.name, about: `The marriage was arranged by Reginald and Harrison; Jovan was told of it as a decision already made.${more}`, ...(contradicts ? { contradicts } : {}) }] });
  /* the writer's own next page says the opposite: his words stand, the book's account beside them — and the check is not asked */
  store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('ai', 'Reginald had arranged it all; Jovan was told of the marriage as a decision already made.', { how: 'write', ask: { direction: '', length: 'scene' } })); }, { now: true });
  await script([{ text: JSON.stringify(row('Jovan was told of the marriage as a decision already made')) }]);
  await archivist.run(b.novelId);
  assert.equal(card().about, thread.about, 'his words stand against the writer’s page');
  assert.ok(String(card().since || '').includes('arranged by Reginald'), 'what the book now says rides beside them');
  assert.equal(Boolean(b.novel().memory.auditAsked), false, 'a writer’s page asks no check');
  /* the same, from a passage written again from his note: the book is his newer word — the card says what it says now, "Since then" folded in, his mark off that field; the thread stays his by name */
  const p1 = b.ch().passages[0];
  await script([{ text: 'Reginald Wayne and Harrison Vanderbilt arranged the marriage between them; Jovan learned of it as a decision already made, with a signature space and a calendar.' }]);
  const out = await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1.id, note: 'The fathers arrange it; Jovan is told, never asked.' });
  assert.equal(out.ok, true);
  assert.equal(picked(b.ch().passages[0]).how, 'rewrite');
  /* a reading sees one passage: it never rewrites his words, whatever it claims (2.12.16 — the whole-book check does, below) */
  await script([{ text: JSON.stringify(row('Jovan learned of it as a decision already made', ' A signature space waited.')) }]);
  await archivist.run(b.novelId);
  assert.equal(card().about, thread.about, 'his words stand through a reading');
  assert.ok(String(card().since || '').includes('A signature space waited.'), 'the reading’s account beside them');
  assert.equal(shape.hisField(card(), 'about'), true);
  /* "about" given with the notes' own lines in it: those lines never stay in a card's words (2.12.16) */
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-d', name: 'Damien Thorne', aka: [], about: 'Alaric’s father.', ties: '', now: '' }); }, { now: true });
  store.change('novel', b.novelId, (n) => { delete n.memory.seen[b.ids[0]][p1.id]; }, { now: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'Damien Thorne', about: 'Alaric’s father; head of the Thorne group.\n  With others: Alaric Thorne (his son): beside him.\n  Right now: In St. Aldrich.' }] }) }]);
  await archivist.run(b.novelId);
  const d = () => b.novel().notes.people.find((c) => c.id === 'pe-d');
  assert.deepEqual([d().about, d().ties, d().now], ['Alaric’s father; head of the Thorne group.', 'Alaric Thorne (his son): beside him.', 'In St. Aldrich.']);
  /* a card left so by an earlier version is put right at open */
  store.change('novel', b.novelId, (n) => { n.notes.people.find((c) => c.id === 'pe-d').about = 'Alaric’s father.\n  With others: his son.\n  Now: At the wedding.'; }, { now: true });
  archivist.firstCheck(b.novelId);
  assert.deepEqual([d().about, d().ties, d().now], ['Alaric’s father.', 'Alaric Thorne (his son): beside him.', 'In St. Aldrich.'], 'cleaned, and what the card already says stays');
  await putAway(b);
});

await test('the notes’ check puts right a card of his that the book he changed contradicts — quoted from a passage his partner wrote or he changed by hand — and takes out a thread of his about a thing the book no longer has; without the quote, or quoted from the writer’s own page, his card stands; a book opened under 2.12.10 with “Since then” on a card of his is checked once (2.12.10)', async () => {
  const b = await makeBook([['Jovan chose Emilia from the shortlist.', 'Mara kept the light.']], { manual: true });
  markAllSeen(b);
  const his = (c) => ({ ...c, updated: { by: 'you', at: 1 } });
  store.change('novel', b.novelId, (n) => {
    n.notes.threads.push(his({ id: 'th-1', name: 'Jovan’s choice to ask for Emilia', about: 'Jovan chose Emilia from a shortlist.', since: 'The marriage was arranged by the fathers.', open: true }));
    n.notes.lore.push(his({ id: 'lo-1', name: 'The shortlist', about: 'A list of five brides Jovan chose from.' }));
    n.notes.lore.push(his({ id: 'lo-2', name: 'The lamp', about: 'Mara’s lamp, which she keeps.' }));
    n.notes.people.push(his({ id: 'pe-1', name: 'Mara', about: 'The keeper of the light.', now: 'At the lamp.' }));
  }, { now: true });
  /* a book from before, with Since then on a card of his: opened under 2.12.10, a check is asked once */
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: 0, v: 3, checked: true } }), { now: true });
  assert.equal(archivist.firstCheck(b.novelId), true);
  assert.deepEqual([b.novel().memory.audit.v, b.novel().memory.audit.owed, b.novel().memory.auditAsked], [archivist.AUDIT_V, undefined, true]);
  /* the partner wrote the first passage anew (how 'partner'): the book he changed */
  store.change('chapter', b.ids[0], (c) => { const p = c.passages[0]; p.versions.push(shape.newVersion({ text: 'Reginald and Harrison arranged the marriage; there was no shortlist, and Jovan was told.', how: 'partner', from: p.versions[0].id })); p.pick = 1; }, { now: true });
  markAllSeen(b);
  const notes = () => b.novel().notes;
  await script([{ text: JSON.stringify({
    threads: [{ name: 'Jovan’s choice to ask for Emilia', about: 'The marriage was arranged by Reginald and Harrison; Jovan was told.', contradicts: 'Reginald and Harrison arranged the marriage', why: 'the book no longer has him choosing' }],
    people: [{ name: 'Mara', about: 'A woman who hates the light.', contradicts: 'Mara kept the light', why: 'x' }],
    gone: [{ kind: 'lore', name: 'The shortlist', contradicts: 'there was no shortlist', why: 'nothing of it is in the book' }, { kind: 'lore', name: 'The lamp', why: 'tidy' }],
    clear: true, verdict: 'Put right.' }) }]);
  await archivist.run(b.novelId);
  const a = b.novel().memory.audit;
  assert.equal(a.checked, true, JSON.stringify(a));
  assert.equal(notes().threads[0].about, 'The marriage was arranged by Reginald and Harrison; Jovan was told.', 'his thread put right from the book he changed');
  assert.equal(notes().threads[0].since, undefined);
  assert.deepEqual(notes().threads[0].updated.his.includes('about'), false);
  assert.equal(notes().lore.some((c) => c.id === 'lo-1'), false, 'his thing the book no longer has is taken out, quoted');
  assert.equal(notes().lore.some((c) => c.id === 'lo-2'), true, 'his card never taken out without the book’s word against it');
  assert.equal(notes().people[0].about, 'The keeper of the light.', 'quoted from the writer’s own page: his words stand');
  const refused = (a.refused || []).map((r) => `${r.name}: ${r.why}`).join(' | ');
  assert.ok(/The lamp: yours — never taken out/.test(refused), refused);
  await putAway(b);
});

await test('every card of his with “Since then” is judged by the notes’ check, by name: the opposite, quoted from the book and from what Since then holds, puts it right or takes it out; held, it is not asked again; unanswered, asked three times at most; a quote that is not the book’s changes nothing (2.12.12)', async () => {
  const b = await makeBook([['Reginald and Harrison arranged the marriage; Jovan learned of it as a decision already made.', 'Mara kept the light. She was the duke’s daughter.']], { manual: true });
  markAllSeen(b);
  const his = (c) => ({ ...c, updated: { by: 'you', at: 1 } });
  store.change('novel', b.novelId, (n) => {
    n.notes.threads.push(his({ id: 'th-1', name: 'Jovan’s choice to ask for Emilia', about: 'Jovan chose Emilia from a shortlist.', since: 'Jovan did not choose her; the marriage was arranged and he learned of it as a decision already made.', open: false }));
    n.notes.people.push(his({ id: 'pe-1', name: 'Emilia', about: 'The bride.', since: 'Jovan did not choose her; the marriage was arranged and he learned of it as a decision already made.' }));
    n.notes.people.push(his({ id: 'pe-2', name: 'Mara', about: 'A kitchen maid.', since: 'She was the duke’s daughter.' }));
    n.notes.lore.push(his({ id: 'lo-1', name: 'The lamp', about: 'Mara’s lamp.', since: 'Mara kept the light.' }));
  }, { now: true });
  const ask = async (answer) => { await reset(); archivist.askAudit(b.novelId); await script([{ text: JSON.stringify({ clear: true, verdict: 'Checked.', ...answer }) }]); await archivist.run(b.novelId); return (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((c) => c.includes(prompts.AUDIT_ASK)) || ''; };
  const n = () => b.novel().notes;
  /* asked by name, every one */
  let sent = await ask({ mine: [
    { kind: 'threads', name: 'Jovan’s choice to ask for Emilia', holds: false, contradicts: 'Jovan learned of it as a decision already made', gone: true, why: 'he never chose' },
    { kind: 'people', name: 'Emilia', holds: false, contradicts: 'the fathers sold her', about: 'The bride the fathers chose.' },
    { kind: 'people', name: 'Mara', holds: true },
  ] });
  assert.ok(sent.includes('Judge each one, and answer in "mine" for every one of them') && sent.includes('Jovan’s choice to ask for Emilia (threads)') && sent.includes('Mara (people)') && sent.includes('The lamp (lore)'), sent.slice(sent.indexOf('My cards with'), sent.indexOf('My cards with') + 400));
  assert.equal(n().threads.some((c) => c.id === 'th-1'), false, 'the thread about a thing that no longer happens: gone, though his');
  assert.equal(n().people.find((c) => c.id === 'pe-1').about, 'The bride.', 'a quote that is not the book’s changes nothing');
  assert.equal(n().people.find((c) => c.id === 'pe-2').about, 'A kitchen maid.', 'held: his words stand');
  const m = b.novel().memory.mine;
  assert.deepEqual([m['th-1'], m['pe-2'].held, m['pe-1'].n, m['lo-1'].n], [undefined, true, 1, 1]);
  /* the next check: Mara is not asked again; Emilia put right from the book, Since then folded in, his mark off who she is */
  sent = await ask({ mine: [{ kind: 'people', name: 'Emilia', holds: false, contradicts: 'Jovan learned of it as a decision already made', about: 'The bride the fathers chose for Jovan.' }] });
  assert.ok(!sent.includes('Mara (people)') && sent.includes('Emilia (people)'));
  const em = n().people.find((c) => c.id === 'pe-1');
  assert.deepEqual([em.about, em.since, shape.hisField(em, 'about'), shape.hisField(em, 'name')], ['The bride the fathers chose for Jovan.', undefined, false, true]);
  /* the check's Undo puts his words back */
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.equal(n().people.find((c) => c.id === 'pe-1').about, 'The bride.');
  /* unanswered: asked three times, then it waits for its Since then to change */
  for (let i = 0; i < 3; i++) await ask({});
  assert.equal(b.novel().memory.mine['lo-1'].n, 3);
  sent = await ask({});
  assert.ok(!sent.includes('The lamp (lore)'), 'not asked a fourth time');
  /* a thread of his already rewritten into the book's account (as 2.12.12 could leave one): judged for itself; overturned, it goes — whatever "about" it offers (2.12.13) */
  store.change('novel', b.novelId, (d) => { d.notes.threads.push({ id: 'th-2', name: 'Jovan’s choice to ask for Emilia', about: 'Jovan did not ask for Emilia and did not choose her. The marriage was arranged and presented as a decision already made.', open: false, updated: { by: 'you', his: ['name', 'open'], chapterId: '', at: 2 } }); }, { now: true });
  sent = await ask({ mine: [{ kind: 'threads', name: 'Jovan’s choice to ask for Emilia', holds: false, contradicts: 'Jovan learned of it as a decision already made', about: 'The marriage was arranged.', why: 'he never chose' }] });
  assert.ok(sent.includes('Jovan’s choice to ask for Emilia (threads)') && sent.includes('— it goes'));
  assert.equal(n().threads.some((c) => c.id === 'th-2'), false, 'a thread overturned goes');
  /* a thread of his whose words the book bears out but whose name and "closed" are the old story's — judged held under 2.12.13 — is judged whole again; overturned, it goes: the check never names or writes a storyline in its place (2.12.16) */
  store.change('novel', b.novelId, (d) => {
    d.notes.threads.push({ id: 'th-3', name: 'Jovan’s choice to ask for Emilia', about: 'Jovan did not choose her; the marriage was arranged as a decision already made. Still unaddressed between Jovan and Emilia.', open: false, updated: { by: 'you', his: ['name', 'open'], chapterId: '', at: 3 } });
    d.memory.mine = { ...(d.memory.mine || {}), 'th-3': { h: util.hashText(['Jovan’s choice to ask for Emilia', 'Jovan did not choose her; the marriage was arranged as a decision already made. Still unaddressed between Jovan and Emilia.', ''].join('\n')), held: true } };
  }, { now: true });
  sent = await ask({ mine: [{ kind: 'threads', name: 'Jovan’s choice to ask for Emilia', holds: false, contradicts: 'Jovan learned of it as a decision already made', newName: 'The marriage they were both handed', about: 'Arranged by the fathers; still unaddressed between Jovan and Emilia.', open: true, why: 'he never chose, and it is unaddressed' }] });
  assert.ok(sent.includes('Jovan’s choice to ask for Emilia (threads)') && sent.includes('It holds only when all of it does'));
  assert.equal(n().threads.some((c) => c.id === 'th-3'), false, 'gone — never renamed into a storyline the check wrote');
  assert.equal(n().threads.some((c) => c.name === 'The marriage they were both handed'), false);
  /* a book checked under 2.12.11: opened, nothing left to judge asks nothing; a Since then that changed is judged again, at open */
  assert.deepEqual(archivist.mineToJudge(b.novel()).map((x) => x.id), [], 'nothing left to judge');
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { ...b.novel().memory.audit, v: 4 }, auditAsked: false }), { now: true });
  archivist.firstCheck(b.novelId);
  assert.equal(b.novel().memory.auditAsked, false, 'every one judged or asked three times');
  store.change('novel', b.novelId, (d) => { d.notes.people.find((c) => c.id === 'pe-2').since = 'She was the duke’s daughter, and she ran.'; d.memory.audit.v = 4; }, { now: true });
  archivist.firstCheck(b.novelId);
  assert.equal(b.novel().memory.auditAsked, true, 'a Since then that changed is judged again');
  await putAway(b);
});

await test('every thread is held to the book’s own words that set it up: one no words of the book set up goes, whoever wrote it; one partly told from nowhere keeps only what the book sets up; one held without its words is not taken as held; an evidence quote that is not the book’s changes nothing (2.12.16)', async () => {
  const b = await makeBook([['Harrison Vanderbilt signed the merger papers in Reginald Wayne’s study. Nobody spoke of Georgia.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => {
    n.notes.threads.push({ id: 't-g', name: 'The Georgia-led pressure on Harrison Vanderbilt', about: 'Harrison has a railroad’s worth of leverage pressed against his cattle country’s throat, and Reginald has been the one pressing it.', open: true });
    n.notes.threads.push({ id: 't-m', name: 'The merger', about: 'Harrison signed the merger papers, pushed into it by debts in Georgia.', open: true, updated: { by: 'you', his: ['about'], at: 1 } });
    n.notes.threads.push({ id: 't-h', name: 'Who called the meeting', about: 'The meeting in the study.', open: true });
    n.notes.threads.push({ id: 't-x', name: 'The signing', about: 'Harrison signed the papers.', open: true });
  }, { now: true });
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Checked.', mine: [
    { kind: 'threads', name: 'The Georgia-led pressure on Harrison Vanderbilt', never: true, why: 'no railroad, no cattle, no pressure in the book' },
    { kind: 'threads', name: 'The merger', holds: false, evidence: 'Harrison Vanderbilt signed the merger papers', about: 'Harrison signed the merger papers.', why: 'the debts in Georgia are not in the book' },
    { kind: 'threads', name: 'Who called the meeting', holds: true },
    { kind: 'threads', name: 'The signing', holds: false, evidence: 'they signed in blood', about: 'Signed in blood.' },
  ] }) }]);
  await archivist.run(b.novelId);
  const sent = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((c) => c.includes(prompts.AUDIT_ASK)) || '';
  assert.ok(sent.includes('every thread, whoever wrote it') && sent.includes('The Georgia-led pressure on Harrison Vanderbilt (threads)') && sent.includes('nothing the notes or anyone added from nowhere'));
  const th = (id) => b.novel().notes.threads.find((c) => c.id === id);
  assert.equal(th('t-g'), undefined, 'set up by no words of the book: gone');
  assert.deepEqual([th('t-m').about, shape.hisField(th('t-m'), 'about')], ['Harrison signed the merger papers.', false], 'his thread, partly from nowhere: cut down to what the book sets up');
  assert.equal(th('t-h').about, 'The meeting in the study.', 'held without its words: left as it is');
  assert.equal(th('t-x').about, 'Harrison signed the papers.', 'an evidence quote that is not the book’s changes nothing');

  const m = b.novel().memory.mine;
  assert.deepEqual([m['t-h'].n, m['t-h'].held, m['t-x'].n], [1, undefined, 1], 'not taken as held: asked again');
  assert.ok((b.novel().memory.audit.changes || []).some((c) => c.name === 'The Georgia-led pressure on Harrison Vanderbilt' && c.how === 'gone'));
  /* the check's Undo brings them back */
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.ok(th('t-g') && th('t-m').about.includes('debts in Georgia'));
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Checked.', mine: [
    { kind: 'threads', name: 'The signing', never: true, why: 'x' },
    { kind: 'threads', name: 'Who called the meeting', holds: false, evidence: 'Harrison Vanderbilt signed the merger papers', about: 'Reginald called the meeting to force the vote at midnight.' },
  ] }) }]);
  await archivist.run(b.novelId);
  assert.equal(th('t-x').about, 'Harrison signed the papers.', '“never set up”, but its words stand in the book: kept');
  assert.equal(th('t-h').about, 'The meeting in the study.', 'a cut that brings words of its own: refused — the check never writes a thread');

  await putAway(b);
});

await test('a card in his words or his partner’s with no Since then is judged against the book once too: the opposite, quoted from the book and naming it, puts it right; a quote about someone else changes nothing; held, it is not asked again (2.12.17)', async () => {
  const b = await makeBook([['Damien Thorne had never bid for Vanderbilt Pharmaceuticals; he sold ships.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => {
    n.notes.people.push({ id: 'pe-d', name: 'Damien Thorne', aka: [], about: 'Lost the bid for Vanderbilt Pharmaceuticals.', ties: '', now: '', updated: { by: 'you', at: 1 } });
    n.notes.people.push({ id: 'pe-a', name: 'Alaric Thorne', aka: [], about: 'His son.', ties: '', now: '', updated: { by: 'you', at: 1 } });
    n.notes.lore.push({ id: 'lo-s', name: 'The ships', about: 'Damien’s fleet.', updated: { by: 'you', at: 1 } });
  }, { now: true });
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Checked.', mine: [
    { kind: 'people', name: 'Damien Thorne', holds: false, contradicts: 'Damien Thorne had never bid for Vanderbilt Pharmaceuticals', about: 'Never bid for Vanderbilt Pharmaceuticals; sells ships.' },
    { kind: 'people', name: 'Alaric Thorne', holds: false, contradicts: 'he sold ships', about: 'A shipping man.' },
    { kind: 'lore', name: 'The ships', holds: true },
  ] }) }]);
  await archivist.run(b.novelId);
  const sent = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((c) => c.includes(prompts.AUDIT_ASK)) || '';
  assert.ok(sent.includes('Damien Thorne (people)') && sent.includes('Alaric Thorne (people)') && sent.includes('The ships (lore)') && sent.includes('or has not come to it yet'));
  const p = (id) => b.novel().notes.people.find((c) => c.id === id);
  assert.deepEqual([p('pe-d').about, shape.hisField(p('pe-d'), 'about')], ['Never bid for Vanderbilt Pharmaceuticals; sells ships.', false]);
  assert.equal(p('pe-a').about, 'His son.', 'a quote that does not name him is no ground');
  assert.equal(b.novel().memory.mine['lo-s'].held, true);
  assert.equal(archivist.mineToJudge(b.novel()).some((x) => x.id === 'lo-s'), false, 'held: not asked again');
  await putAway(b);
});

await test('what the writer reads as notes (2.12.18): plans carried out never told as not having happened; closed threads give way before anyone; during a reread an old place is said as last seen; the last chapter’s open threads are the notes as of the point, names filled', async () => {
  /* plans */
  const about = prompts.aboutTheBook({ plans: 'Mara finds her father alive.', meta: { title: 'T' } }, { plans: true });
  assert.ok(about.includes('None of it has happened unless the pages say so') && !about.includes('none of this has happened yet'), about);
  /* the fit: 4 people with how they stand, 30 closed threads — the people keep their lines */
  const people = ['Mara', 'Joren', 'Ilse', 'Tobin'].map((nm, i) => ({ id: `p${i}`, name: nm, aka: [], about: `${nm} is a keeper of the light at the edge of the sea.`, ties: `${nm} trusts the others less every night.`, now: `At the lamp, the ${i + 1}st watch.` }));
  const threads = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: `The matter of the red key number ${i + 1}`, about: `Long settled: the red key number ${i + 1} was found under the stair and given back to the harbourmaster.`, open: false }));
  const novel = { notes: { people, places: [], lore: [], threads }, order: [], memory: {} };
  const full = prompts.notesText(novel);
  const fit = util.estimateTokens(prompts.notesText({ ...novel, notes: { ...novel.notes, threads: [] } })) + 120;
  const fitted = prompts.notesText(novel, { fit });
  assert.ok(util.estimateTokens(fitted) <= fit + 40, `${util.estimateTokens(fitted)} of ${fit}`);
  assert.equal((fitted.match(/With others:/g) || []).length, 4, 'every person keeps how they stand: ' + fitted.slice(0, 400));
  assert.ok(util.estimateTokens(full) > fit && !fitted.includes('Long settled'), 'the closed threads gave way');
  assert.ok(prompts.notesText(novel, { fit, forHelper: true }) !== fitted, 'the helper’s own reading keeps the order it had');
  /* a reread: the notes as they stood, with what had been read then */
  const b = await makeBook([['Mara kept the light.'], ['Mara walked to the harbour.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-i', name: 'Ilse', aka: [], about: 'A doctor.', now: 'At her surgery in Holm.', nowAt: n.order[0] }); }, { now: true });
  const seenBefore = JSON.parse(JSON.stringify(b.novel().memory.seen));
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ rereadFrom: { notes: JSON.parse(JSON.stringify(b.novel().notes)), kept: {} }, reread: Date.now(), seen: {}, undo: { keep: true, seen: seenBefore } }), { now: true });
  const shown = prompts.notesText(prompts.standingNotes(b.novel()));
  assert.ok(shown.includes('Last seen (Chapter One): At her surgery in Holm.') && !shown.includes('Right now: At her surgery'), shown);
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ rereadFrom: null, reread: 0, seen: seenBefore, undo: null }), { now: true });
  /* the last chapter: its open threads from the notes as of the point, {{user}} filled */
  await setHouse({}, { you: { name: 'Bruce' } });
  store.change('novel', b.novelId, (n) => { n.prefs = { ...(n.prefs || {}), endsAt: n.order[1] }; n.ending = 'They part at the harbour.'; n.notes.threads.push({ id: 'th-k', name: 'The widow’s key', about: 'The widow gave {{user}} a key.', open: true }); }, { now: true });
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters: { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) }, conn: CONN, purpose: 'write', target: { chapterId: b.ids[1] }, request: 'On.' });
  const t = a.system + '\n' + a.messages.map((m) => m.content).join('\n');
  assert.ok(t.includes('Threads still open') && t.includes('The widow gave Bruce a key') && !t.includes('{{user}}'), t.slice(t.indexOf('Threads still open'), t.indexOf('Threads still open') + 200));
  await setHouse();
  await putAway(b);
});

await test('a reading’s answer laid on the notes (2.12.18): the notes’ own display given back is taken off every field — no second card, no fact lost; a description never takes a name’s place; two tellings of one person both kept; a row that says nothing makes no card; an earlier part read out of turn never reopens a thread a later part closed', () => {
  const his = { by: 'you', at: 1 };
  const notes = () => ({ people: [{ id: 'p-t', name: 'Thomas Hale', aka: ['Tom'], about: 'A fisherman.', ties: 'Owes the harbourmaster.', now: 'At the docks.' }, { id: 'p-m', name: 'Mira', aka: [], about: 'A kitchen maid.', since: 'She is the lost princess.', now: '', updated: his }, { id: 'p-h', name: 'Hachigorō', aka: [], about: 'A courier from the north.', now: 'At the inn.' }],
    places: [{ id: 'pl-a', name: 'The Anchor', aka: [], about: 'A busy tavern by the docks.' }], lore: [], threads: [{ id: 'th-o', name: 'Tom’s oath to come back', about: 'Kept — he came back in the spring.', open: false }] });
  const fold = (ans, o = {}) => archivist.foldNotes(notes(), ans, { chapterId: 'c1', at: 5, ...o }).notes;
  /* the display given back */
  let n = fold({ people: [{ name: 'Thomas Hale (also Tom)', now: 'Hauling nets on the pier.' }] });
  assert.deepEqual(n.people.filter((c) => /Thomas/.test(c.name)).map((c) => [c.name, c.now]), [['Thomas Hale', 'Hauling nets on the pier.']]);
  n = fold({ people: [{ name: 'Mira', about: 'A kitchen maid. (my words)\n  Since then: She is the lost princess. She rules the north now.' }] });
  assert.equal(n.people.find((c) => c.id === 'p-m').since, 'She is the lost princess. She rules the north now.');
  n = fold({ places: [{ name: 'The Anchor', about: 'A busy tavern by the docks.\nNow: Burned to the ground in the night.' }] });
  assert.ok(n.places[0].about.includes('Burned to the ground in the night.'), n.places[0].about);
  n = fold({ people: [{ name: 'Thomas Hale', ties: 'With others: Owes the harbourmaster.\n  Right now: On the pier.', now: '' }] });
  assert.deepEqual([n.people[0].ties, n.people[0].now], ['Owes the harbourmaster.', 'On the pier.']);
  /* a description never takes a name's place */
  n = fold({ people: [{ name: 'the courier', aka: ['Hachigorō'], now: 'At the north gate with the satchel.' }] });
  const h = n.people.find((c) => c.id === 'p-h');
  assert.deepEqual([h.name, h.aka, h.now], ['Hachigorō', ['the courier'], 'At the north gate with the satchel.']);
  /* two tellings of one person in one reading: both kept, whatever their order */
  n = fold({ people: [{ name: 'Thomas Hale', ties: 'Paid the harbourmaster back at last, and they shook hands.' }, { name: 'Tom', ties: 'Close to his sister in the hills, who writes every week.' }] });
  assert.ok(n.people[0].ties.includes('shook hands') && n.people[0].ties.includes('his sister'), n.people[0].ties);
  /* a row that says nothing */
  n = archivist.foldNotes(notes(), { people: [{ name: 'Old Pell', about: 'N/A', ties: 'none', now: 'unknown' }, { name: 'Kessa', about: '', ties: '', now: '' }], threads: [{ name: 'Mara’s grief', about: 'none' }] }, { chapterId: 'c1', at: 5, named: namesjs.foldedText('Mara thought of Old Pell, dead these ten years.') }).notes;
  assert.deepEqual([n.people.length, n.threads.length], [3, 1], 'no card made of nothing');
  /* out of turn: a closed thread stays closed */
  n = fold({ threads: [{ name: 'Tom’s oath to come back', about: 'Sworn at dusk.', open: true }] }, { outOfTurn: true });
  assert.equal(n.threads[0].open, false);
  n = fold({ threads: [{ name: 'Tom’s oath to come back', about: 'Sworn at dusk.', open: true }] });
  assert.equal(n.threads[0].open, true, 'read in turn, as before');
});

await test('an earlier passage he changed, read in the same pass as a new one: where someone is now, written by a passage after it, is never moved back (2.12.18)', async () => {
  const b = await makeBook([['Mara and Tom met at the harbour.', 'They walked the wall.', 'Tom left for the station.', 'Tom took the dawn train to the city.']], { manual: true });
  markAllSeen(b);
  const ps = b.ch().passages;
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-t', name: 'Tom', aka: [], about: 'A fisherman.', now: 'On the dawn train to the city.', nowAt: n.order[0], nowPid: ps[3].id, updated: { chapterId: n.order[0], at: 1 } }); }, { now: true });
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: ps[1].id, text: 'They walked the wall, mending nets as they went.' });
  store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('ai', 'Mara mended nets alone.', { how: 'write', ask: { direction: '', length: 'scene' } })); }, { now: true });
  await script([
    { text: JSON.stringify({ people: [{ name: 'Tom', now: 'On the harbour wall with Mara, mending nets.' }] }) },
    { text: JSON.stringify({ people: [{ name: 'Mara', now: 'Alone on the wall, mending nets.' }] }) },
  ]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().notes.people.find((c) => c.id === 'pe-t').now, 'On the dawn train to the city.');
  await putAway(b);
});

await test('his card’s Since then (2.12.18): judged again when he changes his words; held, and what of Since then the book no longer says is cut — never new words', async () => {
  const b = await makeBook([[{ text: 'Mara was blind from birth; the surgery failed.', how: 'partner' }]], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-m', name: 'Mara', aka: [], about: 'Mara is blind.', since: 'Her sight came back after the surgery. She reads at night.', now: '', updated: { by: 'you', at: 1 } }); }, { now: true });
  const h0 = archivist.mineToJudge(b.novel()).find((x) => x.id === 'pe-m').h;
  store.change('novel', b.novelId, (d) => { d.memory.mine = { 'pe-m': { h: h0, held: true } }; }, { now: true });
  assert.equal(archivist.mineToJudge(b.novel()).some((x) => x.id === 'pe-m'), false);
  store.change('novel', b.novelId, (d) => { d.notes.people[0].about = 'Mara is blind from birth; the surgery failed.'; }, { now: true });
  assert.equal(archivist.mineToJudge(b.novel()).some((x) => x.id === 'pe-m'), true, 'his words changed: judged again');
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'ok', mine: [{ kind: 'people', name: 'Mara', holds: true, since: 'She reads at night.' }] }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().notes.people[0].since, 'She reads at night.');
  assert.equal(b.novel().notes.people[0].about, 'Mara is blind from birth; the surgery failed.');
  await putAway(b);
});

await test('what the helper keeps of the book, frozen before 2.12.19 by a correction typed into it, is handed back at open: its words used until the helper’s new ones land, and kept on record; on Manual it is left alone (2.12.19)', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'JOVAN CHOSE HER FROM A FIELD.', at: 1, by: 'you' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'HIS STYLE CORRECTION.', at: 1, by: 'you' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setAuto('style', false), { now: true });
  archivist.firstCheck(b.novelId);
  const k = b.novel().kept;
  assert.deepEqual([k.about.text, k.about.again, k.about.by, k.about.was.text], ['JOVAN CHOSE HER FROM A FIELD.', true, undefined, 'JOVAN CHOSE HER FROM A FIELD.']);
  assert.deepEqual([k.style.text, k.style.by], ['HIS STYLE CORRECTION.', 'you'], 'Manual: not the helper’s to keep');
  await script([{ text: JSON.stringify({ about: 'The fathers arranged the marriage between their houses. Neither heir was asked.' }) }]);
  await archivist.run(b.novelId);
  assert.deepEqual([b.novel().kept.about.text, Boolean(b.novel().kept.about.again), b.novel().kept.about.by], ['The fathers arranged the marriage between their houses. Neither heir was asked.', false, undefined]);
  await putAway(b);
});

await test('his other words the writer reads as true — What it’s about, Where it’s headed, a chapter’s plan, an entry for a name the book has — are judged by the notes’ check: overturned and quoted from the book, given whole as the book has them; held, left; unfounded, left; Undo puts them back (2.12.15)', async () => {
  /* (the page as his partner wrote it anew: the story he changed — his own words are put right only from those, never from the writer's own page) */
  const b = await makeBook([[{ text: 'Reginald and Harrison arranged the marriage; Jovan learned of it as a decision already made.', how: 'partner' }], ['']], { brief: 'Jovan chose Emilia from a shortlist, to spite his father.', manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => {
    n.plans = 'The wedding in the spring.';
    n.notes.people.push({ id: 'pe-j', name: 'Jovan', aka: [], about: 'The heir.', now: '' });
    n.bibliography = [{ id: 'bb-j', name: 'Jovan', aka: [], kind: 'people', line: '', text: 'Heir of the Wayne line. He picked Emilia himself from his father’s shortlist.', rides: 'named', at: 1 }, { id: 'bb-n', name: 'Nobody Here', aka: [], kind: 'people', line: '', text: 'Never named in the book.', rides: 'named', at: 1 }];
  }, { now: true });
  store.change('chapter', b.ids[1], shape.chapterSteps.setPlan('Jovan confronts his father over the choice he made.'), { now: true });
  /* (chapter one finished: its summary his, so the helper's one answer is the check's) */
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: 'The fathers arrange it.', fp: shape.chapterPrint(b.ch(0)), at: Date.now(), by: 'you' }), { now: true });
  const entry = () => b.novel().bibliography.find((e) => e.name === 'Jovan');
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Checked.', mine: [
    { kind: 'book', name: 'about', holds: false, contradicts: 'Jovan learned of it as a decision already made', text: 'The fathers arranged the marriage; Jovan was told, never asked.', why: 'he never chose' },
    { kind: 'book', name: 'plans', holds: true },
    { kind: 'plan', name: '2', holds: false, contradicts: 'the fathers wept', text: '' },
    { kind: 'entry', name: 'Jovan', holds: false, contradicts: 'Reginald and Harrison arranged the marriage', text: 'Heir of the Wayne line. The marriage to Emilia was arranged for him.' },
  ] }) }]);
  await archivist.run(b.novelId);
  const sent = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((c) => c.includes(prompts.AUDIT_ASK)) || '';
  assert.ok(sent.includes('My own words the writer reads as true on every page') && sent.includes('"entry" "Jovan"') && sent.includes('"plan" "2"') && sent.includes('"book" "about"') && !sent.includes('Nobody Here'), sent.slice(sent.indexOf('My own words'), sent.indexOf('My own words') + 600));
  assert.equal(b.novel().brief, 'The fathers arranged the marriage; Jovan was told, never asked.', 'What it’s about, put right from the book');
  assert.equal(b.novel().plans, 'The wedding in the spring.', 'held: left');
  assert.equal(b.ch(1).plan, 'Jovan confronts his father over the choice he made.', 'a quote that is not the book’s changes nothing');
  assert.equal(entry().text, 'Heir of the Wayne line. The marriage to Emilia was arranged for him.', 'the entry put right');
  const m = b.novel().memory.mine;
  assert.deepEqual([m['book:plans'].held, m[`plan:${b.ids[1]}`].n, m['book:about'], m[`entry:${entry().id}`]], [true, 1, undefined, undefined]);
  assert.ok((b.novel().memory.audit.changes || []).some((c) => c.kind === 'book' && c.name === 'What it’s about' && c.why === 'he never chose'));
  /* the check's Undo puts his words back */
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.equal(b.novel().brief, 'Jovan chose Emilia from a shortlist, to spite his father.');
  assert.equal(entry().text, 'Heir of the Wayne line. He picked Emilia himself from his father’s shortlist.');
  /* the partner is told the same */
  assert.ok(prompts.partnerFrame({}, { meta: { title: 'T' }, brief: '' }).includes('What it\'s about and Where it\'s headed, and the plans of the chapters ahead'));
  await putAway(b);
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
  /* (the edit is on the page itself since 2.12.2: the chapter reads as it did once Put back the words before brings them) */
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id }).ok, true);
  assert.equal(picked(b.ch(0).passages[0]).text, first.text);
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
  /* (2.11.1) the helper's account of how the pages read is said as that — "so far" — so the craft's
   * My Style Comes First never takes it for the voice he chose */
  assert.ok(sys.includes('How it reads so far:\nKEPT STYLE.') && !sys.includes('How it reads:\nKEPT STYLE.'));
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
  /* (2.6: kept texts of a few sentences — a one-line answer is no longer taken for the whole, nor a thinner one over a fuller) */
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'KEPT STYLE. Close on Mara.', at: 1 }), { now: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'She trimmed the wick.' });
  await script([{ text: JSON.stringify({ about: 'THE HELPER WOULD SAY THIS.', style: 'NEW STYLE. Third person, past tense, close on Mara and the sea.' }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(!ask.includes('You also keep what the book is about'), 'his correction is not the helper\'s to keep');
  assert.equal(b.novel().kept.about.text, 'MY CORRECTION.');
  assert.equal(b.novel().kept.style.text, 'NEW STYLE. Third person, past tense, close on Mara and the sea.');
  /* Write it from the book again: written whole once — his words in use until the new ones land (2.6) */
  await reset();
  archivist.keepAgain(b.novelId, 'about');
  assert.deepEqual([b.novel().kept.about.text, b.novel().kept.about.again, b.novel().kept.about.by], ['MY CORRECTION.', true, undefined]);
  assert.equal(archivist.pendingWork(b.novelId), true, 'the light says it has work');
  await script([{ text: JSON.stringify({ about: 'WRITTEN FROM THE BOOK. A keeper and her light.' }) }]);
  await archivist.run(b.novelId);
  const r = await requests();
  assert.equal(r.length, 1);
  assert.ok(r[0].body.messages.at(-1).content.includes('for the writer to read before every page') && r[0].body.messages.at(-1).content.includes('She trimmed the wick.'), 'from the book itself');
  assert.equal(b.novel().kept.about.text, 'WRITTEN FROM THE BOOK. A keeper and her light.');
  assert.equal(b.novel().kept.about.again, undefined);
  assert.equal(b.novel().kept.about.by, undefined, 'the helper\'s again');
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'nothing more to do');
  await putAway(b);
});

await test('Undo the last reading puts back what it kept of the book too', async () => {
  const b = await makeBook([['Mara Venn kept the light.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'BEFORE. A keeper.', at: 1 }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'STYLE.', at: 1 }), { now: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'A storm came in.' });
  await script([{ text: JSON.stringify({ about: 'AFTER. A keeper, and a storm at sea.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'AFTER. A keeper, and a storm at sea.');
  assert.equal(archivist.undoLast(b.novelId), true);
  assert.equal(b.novel().kept.about.text, 'BEFORE. A keeper.');
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
  assert.ok(body.messages.at(-1).content.includes('where the book and my description of the start put Joon'), 'the opening respects the established position');
  assert.ok(body.messages.at(-1).content.includes('if neither settles how Joon arrives or comes in, leave that to me'), 'an unsupplied arrival remains the player’s choice');
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: '', late: '', partner: '' } });
  await reset();
  await script([{ text: 'Rain.' }]);
  await talk.playSay({ playId: id, text: 'I take her hand.' });
  body = (await requests())[0].body;
  const emptied = body.messages[0].content;
  assert.ok(!emptied.includes('HIS OWN WORDS FIRST'), 'the narrator box emptied: not his writing words');
  assert.ok(emptied.startsWith(crafts.SCENE_CRAFT), `nothing of his: the scene craft comes first — ${emptied.slice(0, 120)}`);
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

/* (through 2.12.1 its change made a version of its own — his word, 2.12.2: "Why partner edit create new version???
 * … new version is only for rewrite or another take": words it changes go in on the page itself) */
await test('the partner sees every passage numbered, and its change goes in on the page itself with its Undo — a passage it writes anew is a version of its own', async () => {
  const b = await makeBook([['Rain hammered the glass.', 'The lamp was cold.']]);
  await script([{ text: '<changes>[{"passage": "1.2", "find": "was cold", "replace": "had gone out", "why": "darker"}]</changes>\n\nI put the lamp out.' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Make the lamp darker.' });
  assert.equal(out.ok, true);
  const sys = (await requests())[0].body.messages[0].content;
  assert.ok(sys.includes('[1.1] Rain hammered the glass.') && sys.includes('[1.2] The lamp was cold.'), 'numbered as on the page');
  const p = b.ch().passages[1];
  assert.equal(picked(p).text, 'The lamp had gone out.');
  assert.deepEqual([picked(p).how, picked(p).hands, picked(p).before.map((x) => [x.text, x.by, x.why])], ['write', ['partner'], [['The lamp was cold.', 'partner', 'darker']]]);
  assert.equal(p.versions.length, 1, 'no new version: the words before are kept on it');
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  assert.equal(v.changes.length, 1);
  assert.equal(v.changes[0].status, 'made');
  assert.equal(v.changes[0].label, 'Chapter One, passage 2');
  const undo = talk.undoOneChange(b.novelId, turn.id, v.id, v.changes[0].id);
  assert.equal(undo.ok, true);
  const q = b.ch().passages[1];
  assert.equal(picked(q).text, 'The lamp was cold.');
  assert.deepEqual([q.versions.length, picked(q).hands, picked(q).before], [1, undefined, undefined], 'its Undo puts his words back, as they were');
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0].status, 'undone');
  /* a passage written anew: a rewrite, its own version */
  await reset();
  await script([{ text: '<changes>[{"passage": "1.2", "text": "The lamp guttered and died.", "why": "anew"}]</changes>\nWritten anew.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Write it anew.' });
  assert.deepEqual(b.ch().passages[1].versions.map((x) => [x.text, x.how]), [['The lamp was cold.', 'write'], ['The lamp guttered and died.', 'partner']]);
  const anew = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(talk.undoOneChange(b.novelId, store.peek('talk', b.novelId).turns.at(-1).id, anew.id, anew.changes[0].id).ok, true);
  assert.equal(b.ch().passages[1].versions.length, 1, 'its Undo takes the version away');
  /* what came of it is told with his next message */
  await reset();
  await script([{ text: 'Understood.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thanks.' });
  const last = (await requests())[0].body.messages.at(-1).content;
  /* (2.12.2: what each change wrote is named with it — "made" five times could not tell it which landed) */
  assert.ok(last.startsWith('(Of your changes: Chapter One, passage 2 (written anew) — I undid it.)'), last.slice(0, 120));
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
  assert.ok(r2[1].body.messages.at(-1).content.startsWith('Your last answer reads as if it made a change, but it holds no changes block'), r2[1].body.messages.at(-1).content.slice(0, 80));
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp burned blue.');
  /* the block came: it is laid beside its first words, which stand — the second try's prose is not the answer (2.12.7) */
  const v2 = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.ok(v2.text.startsWith('I’ve changed the lamp to burn blue.') && v2.text.includes('<changes>') && !v2.text.includes('Now it is in the book.'), v2.text);
  assert.equal(v2.changes.map((c) => c.status).join(), 'made');
  /* his question answered at length, in words that read like a claim — asked for the block, it says NOTHING was meant: the answer stands as it was, nothing added, nothing changed (2.12.7: it was written over by the second try) */
  await reset();
  const analysis = 'Updated thinking on the premise, as you asked.\n\nThe father’s ambition is the stronger engine: a merger forces the marriage and neither heir chooses, which keeps Jovan from looking like a man who picked his own cage. Name the companies and what they make — a hospital group and a robotics firm give the merger a reason a reader can hold.\n\nI agree with the change; say the word and I will make it.';
  await script([{ text: analysis }, { text: 'NOTHING' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Is it possible to edit — the father’s ambition, not Jovan choosing? You agree?' });
  const r3 = await requests();
  assert.equal(r3.length, 2, 'asked once for the block');
  assert.ok(r3[1].body.messages.at(-1).content.includes('reply with the one word NOTHING'), 'told how to say no change was meant');
  const v3 = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v3.text, analysis, 'the analysis stands, untouched');
  assert.deepEqual(v3.changes || [], []);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp burned blue.', 'nothing changed');
  /* a short line beginning with it is the same answer */
  await reset();
  await script([{ text: analysis }, { text: 'Nothing — you asked a question.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And the companies?' });
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).text, analysis);
  /* asked for the block, it says in a line that it cannot be made: the line is added under its words, which stand */
  await reset();
  await script([{ text: 'Done — the lamp is green now.' }, { text: 'That cannot be made: the chapter has no words about the lamp’s colour to quote.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Make it green.' });
  const v4 = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v4.text, 'Done — the lamp is green now.\n\nThat cannot be made: the chapter has no words about the lamp’s colour to quote.');
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp burned blue.');
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

await test('the partner hands a passage to the writer to write again from its note: the writer writes it (his model, his instructions), the card follows — writing, then written with Undo; set to wait, Apply starts it; words named in the wrong passage are changed where they stand (2.12.9)', async () => {
  const b = await makeBook([['The lamp was cold. Jovan chose her from the shortlist.', 'Mara slept.']], { manual: true });
  const until = async (test, ms = 15000) => { const t0 = Date.now(); while (!test()) { if (Date.now() - t0 > ms) throw new Error('took too long'); await sleep(100); } };
  /* the partner's answer, then the writer's rewrite */
  await script([
    { text: '<changes>[{"passage": "1.1", "rewrite": "Reginald made the match; Jovan was told, never asked. The shortlist is gone.", "why": "the father’s ambition"}]</changes>\nHanded to the writer.' },
    { text: 'The lamp was cold. Reginald had made the match; Jovan was told of it on a Tuesday.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Rewrite it so the father chose.' });
  let v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.ok(['writing', 'made'].includes(v.changes[0].status), v.changes[0].status);
  assert.ok(v.changes[0].status !== 'writing' || v.changes[0].rewrite.note.startsWith('Reginald made the match'));
  await until(() => picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0].status === 'made');
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  const c = v.changes[0];
  assert.equal(c.status, 'made');
  assert.equal(c.undo.what, 'passage');
  const p = b.ch().passages[0];
  assert.equal(p.versions.length, 2, 'a new version, the words before one arrow away');
  assert.equal(picked(p).text, 'The lamp was cold. Reginald had made the match; Jovan was told of it on a Tuesday.');
  assert.equal(picked(p).how, 'rewrite', 'written by the writer, as his own Rewrite is');
  assert.equal(picked(p).ask.note, 'Reginald made the match; Jovan was told, never asked. The shortlist is gone.');
  const r = (await requests())[1];
  assert.ok(String(r.body.messages.at(-1).content).includes('Reginald made the match'), 'the writer was handed the note');
  /* the partner is told it was written again by the writer */
  assert.ok(changes.outcomeWords(v.changes).includes('written again by the writer from your note'), changes.outcomeWords(v.changes));
  /* Undo: the words before, back on show */
  assert.equal(talk.undoOneChange(b.novelId, store.peek('talk', b.novelId).turns.at(-1).id, v.id, c.id).ok, true);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold. Jovan chose her from the shortlist.');
  assert.equal(b.ch().passages[0].versions.length, 1);
  /* set to wait: the card waits; Apply hands it to the writer */
  await setHouse({}, { partnerApplies: 'wait' });
  await script([
    { text: '<changes>[{"passage": "1.1", "rewrite": "Shorter, colder.", "why": "x"}]</changes>\nWaiting.' },
    { text: 'The lamp was cold. Reginald chose.' },
  ]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Again, waiting.' });
  let turn = store.peek('talk', b.novelId).turns.at(-1);
  v = picked(turn);
  assert.equal(v.changes[0].status, 'waiting');
  assert.equal(talk.waitingWhy(b.novelId, v.changes[0]), '', 'a note never drifts');
  assert.deepEqual(changes.editableOf(v.changes[0].op).map((f) => f.key), ['rewrite'], 'the note is his to edit');
  assert.equal(talk.applyChange(b.novelId, turn.id, v.id, v.changes[0].id).ok, true);
  assert.equal(picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0].status, 'writing');
  await until(() => picked(store.peek('talk', b.novelId).turns.at(-1)).changes[0].status === 'made');
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold. Reginald chose.');
  await setHouse();
  /* words named in the wrong passage — "1.2" for words that stand in 1.1 (a passage holds many paragraphs): changed where they stand, said */
  await script([{ text: '<changes>[{"passage": "1.2", "find": "Reginald chose", "replace": "Reginald had chosen", "why": "tense"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Fix the tense.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'made', v.changes[0].said);
  assert.ok(/the words stand in passage 1, not 2/.test(v.changes[0].said), v.changes[0].said);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp was cold. Reginald had chosen.');
  /* …and "1.3" where the chapter has two passages: found in 1 */
  await script([{ text: '<changes>[{"passage": "1.3", "find": "Mara slept", "replace": "Mara slept badly", "why": "x"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And that.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'made', v.changes[0].said);
  assert.ok(/the words stand in passage 2/.test(v.changes[0].said), v.changes[0].said);
  assert.equal(picked(b.ch().passages[1]).text, 'Mara slept badly.');
  /* words that stand in two passages, or nowhere: never guessed */
  await script([{ text: '<changes>[{"passage": "1.3", "find": "The lamp", "replace": "A lamp", "why": "x"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hm.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'made', 'The lamp stands in one passage only');
  await script([{ text: '<changes>[{"passage": "1.3", "find": "nowhere words", "replace": "x", "why": "x"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hm.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'refused');
  assert.match(v.changes[0].said, /has no passage 3/);
  /* a find with nothing to put in its place is never made: nothing is taken out by a quote */
  await script([{ text: '<changes>[{"passage": "1.1", "find": "Reginald had chosen", "why": "quoted so you can see"}]</changes>\nQuoted.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Show me.' });
  v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(v.changes[0].status, 'refused');
  assert.equal(picked(b.ch().passages[0]).text, 'A lamp was cold. Reginald had chosen.');
  /* the frame says it: rewrite hands the passage to the writer; never its own prose unless asked; a passage is not a paragraph */
  const frame = prompts.partnerFrame({}, { meta: { title: 'T' }, brief: '' });
  assert.ok(frame.includes('"rewrite": "what must change in it and what must stay') && frame.includes('Never write the passage yourself unless I ask for your words') && frame.includes('never a paragraph’s'), 'the frame');
  /* a window closed while the writer wrote: at open, the card is settled from the chapter — its version there with words, made (cut short, said so); nothing there, said */
  const written = store.peek('talk', b.novelId).turns.find((x) => (picked(x).changes || []).some((c) => c.op && c.op.rewrite === 'Shorter, colder.'));
  const wv = picked(written);
  const back = (patch) => store.change('talk', b.novelId, (d) => { const x = d.turns.find((y) => y.id === written.id); const vv = x.versions.find((y) => y.id === wv.id); vv.changes = vv.changes.map((c) => ({ ...c, ...patch })); }, { now: true });
  back({ status: 'writing', undo: undefined, after: undefined, said: '' });
  const p0 = b.ch().passages[0];
  const mine = p0.versions.find((x) => x.how === 'rewrite' && x.ask && x.ask.note === 'Shorter, colder.');
  store.change('chapter', b.ids[0], shape.chapterSteps.setVersion(p0.id, mine.id, { cut: true, cutWhy: 'the writing stopped when its window closed' }), { now: true });
  assert.equal(talk.settleWriting(b.novelId), 1);
  let sc = picked(store.peek('talk', b.novelId).turns.find((x) => x.id === written.id)).changes[0];
  assert.equal(sc.status, 'made');
  assert.deepEqual([sc.undo.what, sc.undo.versionId, sc.undo.from], ['passage', mine.id, mine.from]);
  assert.equal(sc.said, 'cut short — the writing stopped when its window closed');
  store.change('chapter', b.ids[0], shape.chapterSteps.setVersion(p0.id, mine.id, { cut: undefined, cutWhy: undefined }), { now: true });
  back({ status: 'writing', undo: undefined, after: undefined, said: '' });
  store.change('chapter', b.ids[0], shape.chapterSteps.removeVersion(p0.id, mine.id), { now: true });
  assert.equal(talk.settleWriting(b.novelId), 1);
  sc = picked(store.peek('talk', b.novelId).turns.find((x) => x.id === written.id)).changes[0];
  assert.equal(sc.status, 'refused');
  assert.match(sc.said, /interrupted before it was written/);
  await putAway(b);
});

await test('everything waiting in the conversation, from every answer, at once: Apply all makes them oldest answer first; a newer answer that writes the same thing whole replaces the older proposal; Leave all leaves them all (2.12.9)', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['The lamp was cold. The sea was grey.', 'Mara slept.']]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-m', name: 'Mara', about: 'The keeper.' }), { now: true });
  /* wave one: three proposals */
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "had died", "why": "a"}, {"note": "people", "name": "Mara", "about": "The keeper, tired.", "why": "b"}, {"passage": "1.2", "text": "Mara slept badly.", "why": "c"}]</changes>\nThree.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Change things.' });
  assert.equal(talk.waitingAll(b.novelId).length, 3);
  /* wave two: passage 1.2 written whole again (replaces wave one's), and a new one */
  await script([{ text: '<changes>[{"passage": "1.2", "text": "Mara did not sleep at all.", "why": "d"}, {"passage": "1.1", "find": "was grey", "replace": "was black", "why": "e"}]</changes>\nTwo more.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'More.' });
  const turns = store.peek('talk', b.novelId).turns.filter((t) => t.by === 'ai');
  assert.equal(turns.length, 2);
  const first = picked(turns[0]);
  assert.deepEqual(first.changes.map((c) => c.status), ['waiting', 'waiting', 'skipped'], 'the older whole rewrite of 1.2 is set aside by the newer');
  assert.ok(first.changes[2].aside && /replaced by a newer answer/.test(first.changes[2].said), first.changes[2].said);
  const all = talk.waitingAll(b.novelId);
  assert.equal(all.length, 4, 'two from the first answer, two from the second');
  assert.deepEqual(all.map((w) => w.turnId), [turns[0].id, turns[0].id, turns[1].id, turns[1].id], 'oldest answer first');
  assert.ok(all.every((w) => !w.stale));
  /* one Apply all for the lot */
  const out = talk.settleWaiting(b.novelId, 'apply');
  assert.equal(out.done, 4, JSON.stringify(out));
  assert.deepEqual(out.failed, []);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp had died. The sea was black.');
  assert.equal(picked(b.ch().passages[1]).text, 'Mara did not sleep at all.');
  assert.equal(b.novel().notes.people[0].about, 'The keeper, tired.');
  assert.equal(talk.waitingAll(b.novelId).length, 0);
  assert.deepEqual(picked(store.peek('talk', b.novelId).turns.filter((t) => t.by === 'ai')[0]).changes.map((c) => c.status), ['made', 'made', 'skipped']);
  /* Leave all, across answers too */
  await script([{ text: '<changes>[{"passage": "1.1", "find": "had died", "replace": "x", "why": "a"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Again.' });
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was black", "replace": "y", "why": "b"}]</changes>\nAnd one.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And again.' });
  assert.equal(talk.waitingAll(b.novelId).length, 2);
  assert.equal(talk.settleWaiting(b.novelId, 'skip').done, 2);
  assert.equal(talk.waitingAll(b.novelId).length, 0);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp had died. The sea was black.');
  /* a waiting change whose words have gone since is counted as one that cannot be made now, and Apply all passes it by, saying so */
  await script([{ text: '<changes>[{"passage": "1.1", "find": "had died", "replace": "went out", "why": "a"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Once more.' });
  store.change('chapter', b.ids[0], (c) => { picked(c.passages[0]).text = 'The lamp was lit. The sea was black.'; }, { now: true });
  const left = talk.waitingAll(b.novelId);
  assert.equal(left.length, 1);
  assert.equal(left[0].stale, true);
  const gone = talk.settleWaiting(b.novelId, 'apply');
  assert.equal(gone.done, 0);
  assert.equal(gone.failed.length, 1, JSON.stringify(gone));
  /* the partner, set to wait, is told what waits is not in the book and the newer proposal for a thing replaces the older */
  const frame = prompts.partnerFrame({ partnerApplies: 'wait' }, { meta: { title: 'T' }, brief: '' });
  assert.ok(frame.includes('what waits is not in the book') && frame.includes('the newer proposal replaces the older one waiting') && frame.includes('I apply everything waiting at once'), 'told how waiting works');
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
  await setHouse({ context: 17000 }, CRAFTS_OFF);
  /* the book rides with the first chapter in short: what it holds beside the second, whole */
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters: Object.fromEntries(b.ids.map((id, i) => [id, b.ch(i)])), conn: { ...CONN, context: 17000 }, purpose: 'partner', target: { chapterId: b.ids[2] }, request: 'x' });
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
  /* (put right, and still the helper's — kept current from the book, never frozen as his own: 2.12.19) */
  assert.deepEqual([b.novel().kept.about.text, b.novel().kept.about.by], ['A keeper and KEPT LINES here.', undefined]);
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
  /* the crafts ride (the default): about 18,000 tokens before any of the book */
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
/* a checking with nothing to fix, every check of these passages passed — as the judge asks */
const GRADED_NONE = (...ns) => JSON.stringify({ edits: [], grades: ns.map((n) => ({ passage: n, checks: Object.fromEntries(prompts.JUDGE_CHECKS.map(([k]) => [k, 'yes'])), faults: [] })) });

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
  /* (the judge off: this is the fixes — with it on, an answer with no grades is asked once more for them) */
  await setHouse({}, { checksFrom: 0, judge: { on: false }, ...HIS({ avoid: AVOID }) });
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
  await setHouse({}, { checksFrom: Date.now(), judge: { on: false } });
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
  /* (2.6.3: it says too how many are checked but not graded — none here, the new one graded) */
  assert.deepEqual(checker.unchecked(b.novelId, b.ids[0]), { passages: 2, words: 9, ungraded: 0 });
  await reset();
  checker.checkChapter(b.novelId, b.ids[0]);
  await checker.runCheck(b.novelId);
  r = await requests();
  /* (2.12.33: Check this chapter reads the chapter whole too, once its passages are checked — one more request) */
  const whole = r.filter((x) => String(x.body.messages.at(-1).content).includes(prompts.WHOLE_ASK));
  assert.equal(whole.length, 1, 'and the chapter read whole');
  r = r.filter((x) => !whole.includes(x));
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

/* (through 2.12.1 Apply made one new version for the checking — his word, 2.12.2: "Grammarly always change directly
 * the page … rewrite is the only thing who create new version": a fix goes in on the page itself, with its Undo) */
await test('Apply puts a fix in on the page itself — no new version, the words before kept on it, its Undo takes it back out; Leave it changes nothing; Apply all', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
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
  const firstId = picked(b.ch().passages[0]).id;
  const put = checker.applyOne(b.novelId, one.chapterId, one.passageId, one.item.id);
  assert.deepEqual(put, { ok: true, before: 'Mara climbed the the stair. It was raining alot.', after: 'Mara climbed the stair. It was raining alot.', versionId: firstId });
  let p = b.ch().passages[0];
  assert.equal(p.versions.length, 1, 'no new version');
  assert.equal(picked(p).text, 'Mara climbed the stair. It was raining alot.');
  assert.deepEqual([picked(p).how, picked(p).hands, picked(p).written, picked(p).before.map((x) => x.text)], ['write', ['checker'], 'Mara climbed the the stair. It was raining alot.', ['Mara climbed the the stair. It was raining alot.']], 'the words before stay, on it');
  const two = find('alot');
  assert.equal(two.versionId, firstId, 'what is left of the checking goes with the new words');
  /* its Undo takes it back out — and what the checker found in those words comes back with them */
  const put2 = checker.applyOne(b.novelId, two.chapterId, two.passageId, two.item.id);
  assert.equal(picked(b.ch().passages[0]).text, 'Mara climbed the stair. It was raining a lot.');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, versionId: put2.versionId, expect: put2.after, before: put2.before }).ok, true);
  assert.equal(picked(b.ch().passages[0]).text, 'Mara climbed the stair. It was raining alot.');
  assert.equal(find('alot').versionId, firstId, 'offered again on the words it came back to');
  checker.applyOne(b.novelId, two.chapterId, two.passageId, find('alot').item.id);
  p = b.ch().passages[0];
  assert.equal(p.versions.length, 1, 'still one version');
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
  await setHouse({}, { checksFrom: 0, judge: { on: false }, ...HIS({ avoid: 'tar\nbrine' }) });
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
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
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
  /* (and a harmless ask, to tell whether its model is there: it is, so it is these words — asked again by themselves in a minute, set aside after a second run) */
  assert.equal((await requests()).length, 4, 'asked once the key changed, once more for JSON, and the harmless ask — never in a loop');
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
  assert.equal((await requests()).length, 4, 'nobody checks: nothing is sent');
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
    { passage: '1.3', checks: { ...yes, moves: 'no', specific: 'no' }, faults: [{ check: 'moves', words: 'The tide went out.', why: 'nothing changes' }, { check: 'specific', words: 'Gulls wheeled.', why: 'any shore' }] }] }) }]);
  await checker.runCheck(b.novelId);
  const ask = (await requests())[0].body.messages.at(-1).content;
  assert.ok(ask.includes('Then judge each passage’s craft') && ask.includes('A passage with more than one “no” is under my mark of 8.5'), 'his mark, as checks');
  for (const [k] of prompts.JUDGE_CHECKS) assert.ok(ask.includes(`\n- ${k}: `), k);
  const s = checker.suggestions(b.novelId);
  const grades = s.filter((x) => x.item.kind === 'grade');
  /* (a "no" whose words are not in the passage is shown, never counted — held to its evidence, Cozy Tavern M644: 2.5.0 counted it) */
  assert.deepEqual(grades.map((x) => [x.number, x.item.grade.overall]), [[2, 8], [3, 8]], 'ten checks: two failed that the page bears out, and two; the one that passed all is not offered');
  const two = grades[0].item;
  assert.deepEqual(two.grade.faults.map((f) => [f.check, f.words || '', Boolean(f.unverified)]), [['shown', 'a look that meant he was sorry', false], ['people', '', true], ['ending', 'And she knew, at last', false]],
    'in the order of the checks; the words as they stand in the passage, a part of them when they were cut, none when they are not there — shown, not counted');
  assert.equal(two.lift, 'Let the look stand; end on what Mara does.');
  assert.equal(grades[1].item.lift, 'Fix what falls short — specific: any shore; moves: nothing changes.', 'a complete grade without lift derives it from the verified faults, and say what would lift it');
  assert.ok(s.some((x) => x.item.kind === 'craft'), 'its fixes that lift it');
  const g = checker.gradesOf(b.novelId);
  assert.equal(g.rows.length, 3);
  assert.deepEqual(g.models.map((m) => [m.model, m.n, m.average]), [['your own words', 3, 8.7]]);
  assert.deepEqual(g.fails.map((f) => [f.name, f.n]), [['Shown', 1], ['Specific', 1], ['Moves', 1], ['Ending', 1]], 'a fail not counted is not among those it fails most');
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
  /* the first reading says page B (writer-a's, shown second); the second, swapped, says page A — writer-a's again
   * (the checking graded, as the judge asks: an answer with no grades is asked once more for them) */
  await script([{ text: GRADED_NONE('1.1') }, { text: JSON.stringify({ better: 'B', why: 'it acts' }) }, { text: JSON.stringify({ better: 'A', why: 'it acts' }) }]);
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
  await script([{ text: GRADED_NONE('1.1') }, { text: JSON.stringify({ better: 'A', why: 'x' }) }, { text: JSON.stringify({ better: 'A', why: 'y' }) }, { text: JSON.stringify({ better: 'A', why: 'x' }) }, { text: JSON.stringify({ better: 'A', why: 'y' }) }]);
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

/* (2.6.2, his word: "automatically change my word — my own writing is ok too": the old test held his own words
 * and the sentences to write again behind the bubble with the switch on; with it on they now go in by themselves —
 * writing from before he switched it on still never does) */
/* (through 2.12.1 each passage's fixes made one new version, and writing from before it was switched on stayed behind
 * the bubble — his word, 2.12.2: "Apply the checker's fixes by themselves on doesn't work I've 27 suggestions and it
 * doesn't automatically change it"; "Grammarly always change directly the page": the fixes go in on the page itself,
 * on every passage checked, from the moment it is on) */
await test('Apply the checker’s fixes by themselves: every passage checked gets its fixes on the page itself — the writer’s, his own, and writing from before it was switched on — and a sentence with his word to avoid is written again by itself, on the page too', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 }, ...HIS({ avoid: 'tar' }) });
  const b = await makeBook([['Mara climbed the the stair.', 'The sea was grey and and cold. It smelled of tar.', { text: 'Old words here alot.', at: Date.now() - 100000 }]]);
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own words alot.' });
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' },
    { passage: '1.2', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' },
    { passage: '1.3', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'two words' },
    { passage: '1.4', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'two words' },
  ] }) }, { text: 'It smelled of the harbour.' }]);
  await checker.runCheck(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  const ps = b.ch().passages;
  assert.deepEqual(ps.map((p) => [picked(p).text, picked(p).how, picked(p).hands]), [
    ['Mara climbed the stair.', 'write', ['checker']],
    ['The sea was grey and cold. It smelled of the harbour.', 'write', ['checker']],
    ['Old words here a lot.', 'write', ['checker']],
    ['My own words a lot.', 'mine', ['checker']],
  ], 'every passage checked fixed by itself, on the page itself');
  assert.deepEqual(ps.map((p) => p.versions.length), [1, 1, 1, 1], 'no new version anywhere');
  assert.deepEqual(picked(ps[3]).before.map((x) => [x.text, x.by]), [['My own words alot.', 'checker']], 'his own words before, kept on it');
  assert.deepEqual(picked(ps[1]).before.map((x) => x.text), ['The sea was grey and and cold. It smelled of tar.', 'The sea was grey and cold. It smelled of tar.'], 'the fix first, then the sentence written again on the fixed words — each to put back');
  assert.equal(picked(ps[1]).spans, 1, 'the sentence written again by itself counted on the version');
  const asked = (await requests()).map((x) => x.body.messages.at(-1).content).find((t) => t.includes('What I want different: Write it again without'));
  assert.ok(asked && asked.includes('“tar”') && asked.includes('It smelled of tar.'), String(asked).slice(0, 400));
  assert.deepEqual(checker.suggestions(b.novelId), [], 'nothing left behind the bubble');
  await setHouse();
  await putAway(b);
});

await test('what the app writes by itself is written off the page: the words on show never change while a sentence is written again, nothing of it is painted, and it goes in once, whole; words that break off partway change nothing; words changed meanwhile keep their change (his report, 2.12.3: “blinking and jagged and flashing”, “broke my passage 2”)', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 }, ...HIS({ avoid: 'tar' }) });
  const TEXT = 'The sea was grey. It smelled of tar. The gulls slept.';
  const watch = (b) => {
    const pid = b.ch().passages[0].id;
    const seen = [];
    const lives = [];
    const offs = [store.subscribe('chapter', b.ids[0], () => { const p = b.ch().passages[0]; seen.push([picked(p).id, picked(p).text, Boolean(picked(p).streaming)]); }),
      writer.onLive((ev) => { if (ev.passageId === pid && !ev.done) lives.push(ev); })];
    return { seen, lives, off: () => offs.forEach((f) => f()) };
  };
  /* written whole: the words on show, then the words with the new sentence — nothing between, nothing painted */
  const b = await makeBook([[TEXT]]);
  const first = picked(b.ch().passages[0]).id;
  let w = watch(b);
  await script([{ text: JSON.stringify({ edits: [] }) }, { text: 'It smelled of the harbour.', delay: 0.02, chunk: 3 }]);
  await checker.runCheck(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  w.off();
  assert.deepEqual([...new Set(w.seen.map((x) => x[0]))], [first], 'the version on show never changes');
  assert.deepEqual([...new Set(w.seen.map((x) => x[1]))], [TEXT, 'The sea was grey. It smelled of the harbour. The gulls slept.'], 'the words, then the words with it');
  assert.ok(w.seen.every((x) => !x[2]), 'never a page being written on show');
  assert.ok(w.lives.length > 1 && w.lives.every((ev) => ev.hidden), `nothing of it painted (${w.lives.length} live words, all off the page)`);
  assert.equal(b.ch().passages[0].versions.length, 1);
  await putAway(b);
  /* broken off partway — the provider fails mid-answer, or the reply runs out: nothing changes, nothing left behind */
  for (const [how, answer] of [['fails partway', { midstream_error: 'It smelled of the', message: 'boom' }], ['runs out', { text: 'It smelled of the', finish: 'length' }]]) {
    const c = await makeBook([[TEXT]]);
    w = watch(c);
    await script([{ text: JSON.stringify({ edits: [] }) }, answer]);
    await checker.runCheck(c.novelId);
    await checker.forTests().lifting.get(c.novelId);
    w.off();
    const p = c.ch().passages[0];
    assert.deepEqual([p.versions.length, picked(p).text], [1, TEXT], `${how}: the passage as it was`);
    assert.deepEqual([...new Set(w.seen.map((x) => x[1]))], [TEXT], `${how}: never another word on show`);
    await putAway(c);
  }
  /* the words changed while it was written (his edit further on): the new sentence goes in where the old one stands, his change kept */
  const d = await makeBook([[TEXT]]);
  await script([{ text: JSON.stringify({ edits: [] }) }, { text: 'It smelled of the harbour.', pause: 0.6 }]);
  const run = checker.runCheck(d.novelId);
  for (let i = 0; i < 300 && !writer.autoBusy(d.novelId); i++) await sleep(10);
  assert.ok(writer.autoBusy(d.novelId), 'being written');
  const pd = d.ch().passages[0];
  assert.ok(inplace.changeInPlace({ novelId: d.novelId, chapterId: d.ids[0], passageId: pd.id, next: 'The sea was grey. It smelled of tar. The gulls woke.', by: 'you' }));
  await run;
  await checker.forTests().lifting.get(d.novelId);
  const q = d.ch().passages[0];
  assert.deepEqual([q.versions.length, picked(q).text], [1, 'The sea was grey. It smelled of the harbour. The gulls woke.'], 'his change kept, the sentence in where it stood');
  assert.deepEqual(picked(q).before.map((x) => x.by), ['you', 'checker'], 'each to put back');
  await putAway(d);
  await setHouse();
});

await test('some words written again that broke off partway, kept on show through 2.12.3, are taken back when the book opens — the words they were written from on show; one he changed since or put on show himself stays', async () => {
  const b = await makeBook([['The sea was grey. It smelled of tar.', 'The lamp was cold.', 'The rope was wet.']], { manual: true });
  const ps = b.ch().passages;
  const add = (p, fields) => { const v = shape.newVersion({ words: 4, ...fields }); store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p.id, v), { now: true }); return v; };
  const base = (i) => picked(b.ch().passages[i]);
  const v0 = base(0);
  add(ps[0], { text: 'The sea was grey. It smelled of the', how: 'selection', base: v0.id, spanAuto: true, cut: true, cutWhy: 'something went wrong partway' });
  const v1 = base(1);
  const kept1 = add(ps[1], { text: 'The lamp was', how: 'selection', base: v1.id, cut: true, cutWhy: 'the writing stopped when its window closed', hands: ['you'] });
  const v2 = base(2);
  const kept2 = add(ps[2], { text: 'The rope', how: 'selection', base: v2.id, cut: true, cutWhy: 'it reached the reply length', chosen: Date.now() });
  assert.equal(writer.repairBrokenWords(b.novelId), 1);
  const now = b.ch().passages;
  assert.deepEqual([now[0].versions.length, picked(now[0]).id, picked(now[0]).text], [1, v0.id, 'The sea was grey. It smelled of tar.'], 'the words it was written from, on show');
  assert.deepEqual([picked(now[1]).id, picked(now[2]).id], [kept1.id, kept2.id], 'changed since by him, or put on show by him: as they are');
  assert.equal(writer.repairBrokenWords(b.novelId), 0, 'once');
  await putAway(b);
});

await test('a sentence to write again, with the fixes going in by themselves: his own words too, twice at most for a passage; never for a word he took off his list; never again after a real failure; it gives way to him; and with the switch off it waits', async () => {
  const on = () => ({ on: true, from: Date.now() - 50000 });
  /* the writer asked (the checker after it is told what the version was asked for, too) */
  const spans = async () => (await requests()).map((x) => x.body.messages.at(-1).content).filter((t) => t.includes('What I want different: Write it again without'));
  /* switched off: the sentence waits behind the bubble, nothing asked */
  await setHouse({}, { checksFrom: 0, judge: { on: false }, ...HIS({ avoid: 'tar' }) });
  const b = await makeBook([[]], { manual: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'The harbour smelled of tar.' });
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal((await spans()).length, 0, 'switched off: not written again');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.kind), ['avoid']);
  /* a word he took off his list: not written again by itself, though the switch is on */
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: on(), ...HIS({ avoid: 'salt' }) });
  checker.forTests().autoAfter(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'tar is no longer on his list');
  /* on, with the word on his list: his own sentence written again — and again while the word stays — never a third time */
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: on(), ...HIS({ avoid: 'tar' }) });
  await reset();
  await script([{ text: 'The harbour smelled of tar and salt.' }]);
  checker.forTests().autoAfter(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  assert.equal((await spans()).length, 1);
  await script([{ text: JSON.stringify({ edits: [] }) }, { text: 'The tar was everywhere.' }]);
  await checker.runCheck(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'never a third');
  const p = b.ch().passages[0];
  /* (through 2.12.1 each made a version of its own — since 2.12.2 a sentence the checker has written again is a fix: on the page itself, each to put back) */
  assert.deepEqual([p.versions.length, picked(p).text, picked(p).spans, picked(p).before.map((x) => x.text)], [1, 'The tar was everywhere.', 2, ['The harbour smelled of tar.', 'The harbour smelled of tar and salt.']], 'each on the page itself, the words before to put back');
  assert.equal(shape.howOf(picked(p)), 'mine', 'still his own words');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.kind), ['avoid'], 'what it could not mend waits for him');
  assert.equal((await spans()).length, 2);
  await putAway(b);
  /* a real failure: kept on the version, never tried by itself again */
  await reset();
  const c = await makeBook([[]], { manual: true });
  writer.addMine({ novelId: c.novelId, chapterId: c.ids[0], text: 'The rope smelled of tar.' });
  const refused = { status: 400, message: 'Invalid request: the prompt was refused' };
  await script([{ text: JSON.stringify({ edits: [] }) }, refused, refused, refused]);
  await checker.runCheck(c.novelId);
  const out = await checker.forTests().lifting.get(c.novelId);
  assert.equal(out && out.ok, false);
  const q = c.ch().passages[0];
  assert.deepEqual([q.versions.length, picked(q).spanFailed], [1, ['The rope smelled of tar.']], 'the page as it was, the failure kept on it');
  await reset();
  checker.forTests().spanTried.clear();
  checker.forTests().autoAfter(c.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'past this page’s own memory of what it tried');
  assert.equal((await requests()).length, 0);
  await putAway(c);
  /* anything he asks the writer meanwhile goes first: taken away whole, the words it was written from on show */
  const d = await makeBook([[]], { manual: true });
  writer.addMine({ novelId: d.novelId, chapterId: d.ids[0], text: 'The deck smelled of tar.' });
  await script([{ text: JSON.stringify({ edits: [] }) }, { text: 'The deck smelled of the sea, word after word after word after word.', delay: 0.15, chunk: 3 }]);
  await checker.runCheck(d.novelId);
  for (let i = 0; i < 100 && !writer.autoBusy(d.novelId); i++) await sleep(10);
  assert.ok(writer.autoBusy(d.novelId), 'the app is writing it again');
  const job = checker.forTests().lifting.get(d.novelId);
  await writer.yieldAuto(d.novelId);
  const gave = await job;
  assert.ok(gave && gave.yielded, JSON.stringify(gave));
  const r = d.ch().passages[0];
  assert.deepEqual([r.versions.length, picked(r).text, writer.busy(d.novelId), picked(r).spanFailed], [1, 'The deck smelled of tar.', false, undefined], 'taken away whole, nothing held against it');
  checker.forTests().autoAfter(d.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'not started again on this page by itself');
  await setHouse();
  await putAway(d);
});

await test('a word on his list in a sentence a fix shared is offered once the fix is in — never left unsaid; a fix that came back for the whole sentence is the fix, and the checking finishes', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, ...HIS({ avoid: 'tar\na testament to' }) });
  const b = await makeBook([['The the harbour smelled of tar. The sea was cold. It smelled of tar again. The rope was black with tar.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'The the', replace: 'The', why: 'doubled' },
    { passage: '1.1', kind: 'avoid', find: 'It smelled of tar again.', replace: 'It smelled of pitch again.', why: 'on your list' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.stateOf(b.novelId).state, 'found', JSON.stringify(checker.stateOf(b.novelId)));
  const s = checker.suggestions(b.novelId);
  assert.deepEqual(s.map((x) => [x.item.kind, x.item.replace]), [['grammar', 'The'], ['avoid', 'It smelled of pitch again.'], ['avoid', null]], 'the fixes as they came — the sentence the first shares waits for it');
  assert.equal(checker.applyOne(b.novelId, s[0].chapterId, s[0].passageId, s[0].item.id).ok, true);
  const t = checker.suggestions(b.novelId);
  assert.deepEqual(t.map((x) => [x.item.kind, x.item.find, x.item.replace]), [['avoid', 'The harbour smelled of tar.', null], ['avoid', 'It smelled of tar again.', 'It smelled of pitch again.'], ['avoid', 'The rope was black with tar.', null]], 'found again in the words the fix made');
  assert.equal(t[0].item.why, '“tar” is on your list of words to avoid');
  assert.deepEqual([t[1].item.id, t[2].item.id], [s[1].item.id, s[2].item.id], 'what still waits keeps its card');
  /* a sentence he left is not offered again in the new words either */
  checker.leaveOne(t[0].chapterId, t[0].passageId, t[0].item.id);
  checker.leaveOne(t[2].chapterId, t[2].passageId, t[2].item.id);
  assert.equal(checker.applyOne(b.novelId, t[1].chapterId, t[1].passageId, t[1].item.id).ok, true);
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.kind), [], 'left stays left');
  assert.equal(picked(b.ch().passages[0]).text, 'The harbour smelled of tar. The sea was cold. It smelled of pitch again. The rope was black with tar.');
  await setHouse();
  await putAway(b);
});

await test('the checker reads as Grammarly does, made for a book: clarity its own kind, shown by its name; consistency and the wrong word asked for', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['The decision was made by her to go, which was a decision that she made quickly in a hurry.']]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'Clarity', find: 'The decision was made by her to go, which was a decision that she made quickly in a hurry.', replace: 'She decided to go, quickly.', why: 'passive and padded' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => [x.item.kind, x.item.replace]), [['clarity', 'She decided to go, quickly.']], 'its own kind, a whole sentence written again');
  const asked = (await requests()).map((x) => x.body.messages.at(-1).content).find((t) => t.includes('Suggest only what is worth changing'));
  for (const w of ['"clarity"', 'grey/gray', 'their/there', 'a weak passive', 'a whole sentence written again']) assert.ok(asked.includes(w), w);
  await setHouse();
  await putAway(b);
});

/* a grade answer: the first n checks failed — each on words the passage holds (a "no" is held to its
 * evidence: 2.5.0's empty words now count for nothing) — with what would lift it */
const failing = (n, lift = 'Make it move.', words = 'Mara lit the lamp') => {
  const checks = Object.fromEntries(prompts.JUDGE_CHECKS.map(([k], i) => [k, i < n ? 'no' : 'yes']));
  return { passage: '1.1', checks, faults: prompts.JUDGE_CHECKS.slice(0, n).map(([k]) => ({ check: k, words, why: 'falls short' })), lift };
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

/* (through 2.12.1 he went back to his own words with the arrows, the fixes being versions — since 2.12.2 they are on
 * the page itself, and Put back the words before is how he takes them back: on words he put back, nothing goes in
 * by itself) */
await test('words he puts back himself stay as he put them: their fixes wait for him and nothing is written again by itself from them — a take he puts on show with the arrows gets its fixes like any other, and the best try the app puts on show is not his', async () => {
  const on = { on: true, from: Date.now() - 1000 };
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: on, ...HIS({ avoid: 'tar' }) });
  const b = await makeBook([[]], { manual: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'The the harbour smelled of tar.' });
  /* (the sentence is written again by itself after the fix: he goes back to his own words) */
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'The the', replace: 'The', why: 'doubled' }] }) }, { text: 'The harbour smelled of the sea.' }]);
  await checker.runCheck(b.novelId);
  await checker.forTests().lifting.get(b.novelId);
  const p = () => b.ch().passages[0];
  assert.deepEqual([p().versions.length, picked(p()).text, picked(p()).before.map((x) => x.text)], [1, 'The harbour smelled of the sea.', ['The the harbour smelled of tar.', 'The harbour smelled of tar.']], 'in by itself, on the page: the fix, then the sentence the fix shared');
  for (let k = 0; k < 2; k++) assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p().id }).ok, true);
  assert.equal(picked(p()).text, 'The the harbour smelled of tar.', 'his own words back');
  await reset();
  checker.forTests().spanTried.clear();
  checker.forTests().autoAfter(b.novelId);
  await checker.runCheck(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'nothing written again from words he put back');
  assert.equal(picked(p()).text, 'The the harbour smelled of tar.', 'the fix not made again');
  assert.equal((await requests()).length, 0, 'nothing checked again: what was found in them came back with them');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.kind), ['grammar'], 'its suggestions wait for him (the word on his list is offered once the fix sharing its sentence is in)');
  assert.match(checker.waitsWhy(b.ids[0], p().id, checker.suggestions(b.novelId).find((x) => x.item.kind === 'grammar').item), /you put these words back yourself/);
  /* his own edit after: the fixes are the app's again to put in */
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p().id, text: 'The the harbour smelled of salt.' });
  assert.equal(picked(p()).fixesBack, undefined, 'his edit is new words: nothing held on them');
  await putAway(b);
  /* the best try put on show by the app is not his choice: its fixes go in by themselves */
  await setHouse({}, { checksFrom: 0, judge: { target: 9 }, autoLift: on, autoFix: on });
  await reset();
  const ask = { direction: 'She lights it.', length: 'scene' };
  const c = await makeBook([[{ text: 'Mara lit the lamp.', model: 'scripted', how: 'write', ask }]]);
  const q = () => c.ch().passages[0];
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(3, 'Closer.', 'Mara lit the lamp')] }) }, { text: 'Mara lit the the lamp. It caught.' }]);
  await checker.runCheck(c.novelId);
  await checker.forTests().lifting.get(c.novelId);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }], grades: [failing(2, 'Closer.', 'It caught')] }) }, { text: 'Mara lit the lamp. It caught, and the dark went.' }]);
  await checker.runCheck(c.novelId);
  await checker.forTests().lifting.get(c.novelId);
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(4, 'Closer.', 'the dark went')] }) }]);
  await checker.runCheck(c.novelId);
  assert.deepEqual(q().versions.map((v) => v.text), ['Mara lit the lamp.', 'Mara lit the lamp. It caught.', 'Mara lit the lamp. It caught, and the dark went.'], 'the first try was best: put on show by the app, and its fix went in by itself, on the page');
  assert.deepEqual([picked(q()).how, picked(q()).hands, picked(q()).lift], ['rewrite', ['checker'], 1]);
  await setHouse();
  await putAway(c);
});

/* (2.6.2, his word: "automatically change my word — my own writing is ok too": his own page under the mark, once
 * held back, is now written again by itself like any other; a grade he left and writing from before still never are) */
await test('never written again by itself: a grade he left, writing from before it was switched on — his own words are, toward the mark; and anything he asks the writer meanwhile goes first — the app’s page taken away whole', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 9 } });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'A writer’s page.', model: 'scripted', how: 'write', ask }, { text: 'An old page.', model: 'scripted', how: 'write', ask, at: Date.now() - 100000 }]]);
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own page.' });
  await script([{ text: JSON.stringify({ edits: [], grades: [{ ...failing(3, undefined, 'page'), passage: '1.1' }, { ...failing(3, undefined, 'page'), passage: '1.2' }, { ...failing(3, undefined, 'page'), passage: '1.3' }] }) }]);
  await checker.runCheck(b.novelId);
  const card = checker.suggestions(b.novelId).find((x) => x.number === 1 && x.item.kind === 'grade');
  checker.leaveOne(card.chapterId, card.passageId, card.item.id);
  await setHouse({}, { checksFrom: 0, judge: { target: 9 }, autoLift: { on: true, from: Date.now() - 50000 } });
  await reset();
  await script([{ text: 'My own page, and the lamp, and the night.' }]);
  checker.forTests().autoAfter(b.novelId);
  assert.equal(checker.forTests().lifting.size, 1, 'one of the three');
  await checker.forTests().lifting.get(b.novelId);
  const sent = (await requests()).map((x) => x.body.messages.at(-1).content);
  assert.equal(sent.length, 1, 'only his own page is asked for');
  assert.ok(sent[0].includes('My own page.') && sent[0].includes('Make it move.'), sent[0].slice(0, 400));
  const ps = b.ch().passages;
  assert.deepEqual(ps.map((p) => picked(p).text), ['A writer’s page.', 'An old page.', 'My own page, and the lamp, and the night.'], 'the grade he left and the old page as they were');
  assert.deepEqual(ps[2].versions.map((v) => [v.text, v.lift || 0]), [['My own page.', 0], ['My own page, and the lamp, and the night.', 1]], 'his own words one arrow away');
  /* a lift on its way when he asks the writer for something: his goes first */
  const b2 = await makeBook([[{ text: 'Another writer’s page.', model: 'scripted', how: 'write', ask }]]);
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(3, undefined, 'page')] }) }, { text: 'A slow page written again, word after word after word after word.', delay: 0.15, chunk: 3 }]);
  await checker.runCheck(b2.novelId);
  for (let i = 0; i < 100 && !writer.autoBusy(b2.novelId); i++) await sleep(10);
  assert.ok(writer.autoBusy(b2.novelId), 'the app is writing it again');
  /* written off the page: the words he is reading stay on show while it is written (2.12.4) */
  assert.deepEqual([picked(b2.ch().passages[0]).text, picked(b2.ch().passages[0]).streaming], ['Another writer’s page.', undefined], 'the page he reads, untouched while the lift is written');
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
    prompts.checkRequest({ novel: b.novel(), chapterLabel: 'Chapter One', numbered: '[1.1] Words.', avoid: ['tar'], before: 'Before.', beforeFrom: 'last', judge: { target: 9 }, stock: { '1.1': ['a testament to'] }, strays: { '1.1': ['the 틀 door'] }, sofar: 'Chapter One: the storm.', left: 3, asked: [{ n: '1.1', words: 'She lights it. '.repeat(500) }] }),
    prompts.checkRequest({ novel: b.novel(), chapterLabel: 'Chapter One', numbered: '[1.1] Words.', judge: { target: 9 }, gradesOnly: true, left: 1 }),
    prompts.duelRequest({ novel: b.novel(), chapterLabel: 'Chapter One', before: 'Before.', asked: 'She lights it.', first: 'Page one.', second: 'Page two.', cut: true, sofar: 'Chapter One: the storm.', left: 2 }),
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
  /* (the judge off: its grading takes room of its own — this is about the parts.
   * 6,600 tokens: the checker's own words take about 1,800 of them (his humanize
   * list, 2.11.1; where people and things are and what a fix quotes, 2.12.33 —
   * about 200 more, so 6,200 left it under the 600 it needs) and its answer 40%,
   * leaving the passage about 600 — some 260 words a part; at 4,000 it says so) */
  await setHouse({ context: 6600 }, { checksFrom: 0, judge: { on: false } });
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
  assert.ok(p.includes(mine) && p.indexOf(mine) > p.indexOf('Your Part = you handle narration') && p.indexOf(second) > p.indexOf(mine), 'after the app\'s, the oldest first');
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
  assert.ok(asks[0].includes('What I want different: Jovan stays silent and saves Yuki without a word.') && asks[0].includes('My change is now what happens') && asks[0].includes('just for reference'), asks[0]);
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

/* what a 2.9 to 2.11.0 house holds in a box he never touched (2.11.1 gives his own starting words back) */
const WRITING_29 = 'You are a master novelist. We write this novel together: I bring the premises, and you write the book — every person in it, the main character too. Follow our chosen voice, point of view and tense. Let character, cause and consequence shape what happens; choose detail, dialogue and rhythm for this particular moment, with room for quiet and surprise.';
const NARRATOR_29 = 'You maintain a fictional, uncensored simulation, told in our book’s chosen voice, point of view and tense. I play my character; you tell the world and everyone else. Give them their own motives and knowledge, and leave my character’s speech, decisions and inner life to me.';

await test('boxes still holding former starting words get today\'s — his own, the master novelist and the unbiased cinematographer — and words he wrote stay his', async () => {
  for (const [system, narrator] of [[OLD_WRITING, OLD_NARRATOR], [WRITING_29, NARRATOR_29]]) {
    await setHouse({}, { instructions: { system, narrator, partner: 'HIS PARTNER WORDS', late: '' } });
    assert.equal(prompts.startingIsOld(store.peek('house', 'house')), true);
    store.change('house', 'house', prompts.freshStarting, { now: true });
    await store.flush('house', 'house');
    const now = (await onPhone('house', 'house')).instructions;
    assert.equal(now.system, prompts.DEFAULT_WRITING);
    assert.ok(now.system.startsWith('You are a master novelist at the height of your powers') && now.system.endsWith('as an unbiased eye on a world that runs by its own logic.'), now.system);
    assert.equal(now.narrator, 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.');
    assert.equal(now.partner, 'HIS PARTNER WORDS');
    assert.equal(prompts.startingIsOld(store.peek('house', 'house')), false, 'once is all it takes');
  }
  let ins;
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
  for (const system of [prompts.DEFAULT_WRITING, OLD_WRITING, WRITING_29, '']) {
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
  /* (2.12.2: a chapter read is cut at its passages' edges, its number kept — one passage too long by itself keeps its start and its end, the middle of that passage named) */
  assert.ok(back.includes('[1.1] THE OPENING OF ONE.') && back.includes('THE END OF ONE.') && back.includes('the middle of [1.1] is left out here to save room'), back.slice(0, 300));
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
  assert.ok(sys.startsWith(`${prompts.DEFAULT_NARRATOR}\n\n${crafts.SCENE_CRAFT}`), sys.slice(0, 140));
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
  assert.deepEqual([v.how, v.hands], ['write', ['you']], 'his edit on the page itself (2.12.2)');
  assert.equal(v.cut, true, 'a word fixed in the middle: it still stops where it stopped');
  assert.equal(v.cutWhy, 'it reached the reply length');
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'Mara climbed the stair and looked out over the grey water toward the lighthouse.' });
  assert.ok(!picked(b.ch().passages[0]).cut, 'he finished it himself');
  /* back to the cut words — Put back the words before brings its Go on back with them — and the checker's fix of a word inside it */
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid }).ok, true);
  assert.deepEqual([picked(b.ch().passages[0]).cut, picked(b.ch().passages[0]).cutWhy], [true, 'it reached the reply length'], 'stopped where it stopped, as it was');
  checker.checkBook(b.novelId);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'grey water', replace: 'gray water', why: 'spelling' }] }) }]);
  await checker.runCheck(b.novelId);
  const s = checker.suggestions(b.novelId).find((x) => x.item.find === 'grey water');
  assert.ok(s, JSON.stringify(checker.suggestions(b.novelId)));
  assert.equal(checker.applyOne(b.novelId, s.chapterId, s.passageId, s.item.id).ok, true);
  v = picked(b.ch().passages[0]);
  assert.deepEqual([v.how, v.hands, b.ch().passages[0].versions.length], ['write', ['you', 'checker'], 1]);
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
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
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
  /* (one new version through 2.12.1 — on the page itself since 2.12.2, one change to put back) */
  assert.deepEqual([b.ch().passages[0].versions.length, picked(b.ch().passages[0]).before.map((x) => x.text)], [1, ['The grey sea met the black sky.']], 'all at once, one change to put back');
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
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara Venn kept the light at Crane Point.']], { manual: true });
  assert.deepEqual(await other(`helper:${b.novelId}`), { ok: true });
  assert.deepEqual(await other(`checker:${b.novelId}`), { ok: true });
  await reset();
  await archivist.run(b.novelId);
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'no call while another browser holds the book');
  assert.equal(archivist.lightOf(b.novelId).words, archivist.ELSEWHERE);
  assert.ok(checker.stateOf(b.novelId).words.startsWith('Another window or browser open on this book is checking it'), 'the checker’s bubble says so too, never “in a moment”');
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
  assert.ok(!checker.stateOf(b.novelId).words.startsWith('Another window'), 'and says so no more');
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

/* (put back as a new version through 2.12.1 — on the page itself since 2.12.2, Put back the words before takes it off again) */
await test('a note to him after the story is taken off a new page and kept, and the passage’s menu puts it back on the page itself — Put back the words before takes it off again; speech and the story stay', async () => {
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
  assert.deepEqual([b.ch().passages[0].versions.length, v.tookOff], [1, undefined], 'on the page itself: nothing kept aside now');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id }).ok, true);
  v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.tookOff], [story200, `---\n\n${note}`], 'taken off again, kept again — the menu offers it again');
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
  await script([{ text: JSON.stringify({ about: 'KEPT FIRST. Mara keeps the light.', style: 'STYLE FIRST. Close third.' }) }]);
  markAllSeen(b);
  await archivist.run(b.novelId);
  assert.equal((b.novel().kept.about || {}).text, 'KEPT FIRST. Mara keeps the light.');
  /* nothing of his changed: nothing asked again */
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'his words as they were: nothing to write again');
  store.change('novel', b.novelId, shape.novelSteps.setField('brief', 'A lighthouse keeper finds a letter from her drowned brother.'), { now: true });
  await script([{ text: JSON.stringify({ about: 'KEPT AGAIN BESIDE HIS NEW WORDS. The letter is her brother’s.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'KEPT AGAIN BESIDE HIS NEW WORDS. The letter is her brother’s.');
  assert.equal(b.novel().kept.style.text, 'STYLE FIRST. Close third.', 'only the one beside the words he rewrote');
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
  await script([{ text: JSON.stringify({ about: 'BESIDE HIS NEW WORDS. The letter is from her drowned brother.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'BESIDE HIS NEW WORDS. The letter is from her drowned brother.');
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
  await script([{ text: JSON.stringify({ about: 'FROM THE BOOK. A keeper and a letter.', style: 'STYLE FROM THE BOOK. Close third, quiet.' }), chunk: 3, delay: 0.03 }]);
  const reading = archivist.run(b.novelId);
  for (let i = 0; i < 200 && !(await requests()).length; i++) await sleep(10);
  await sleep(20);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'A READING WROTE THIS', at: Date.now() }), { now: true });
  await reading;
  assert.equal(b.novel().kept.about.text, 'A READING WROTE THIS');
  assert.equal(b.novel().kept.style.text, 'STYLE FROM THE BOOK. Close third, quiet.');
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
  assert.deepEqual([p.versions.length, picked(p).hands], [1, ['checker']], 'by itself, on the page itself (2.12.2)');
  assert.equal(picked(p).text, words.replace('the the stair', 'the stair'));
  assert.equal(checker.suggestions(b.novelId).length, 1, 'the big one waits for him');
  assert.equal(checker.waitsWhy(b.ids[0], p.id, checker.suggestions(b.novelId)[0].item), 'it rewrites a large stretch of the passage', 'and says why');
  /* and by his hand, Apply puts it in */
  const [sg] = checker.suggestions(b.novelId);
  assert.equal(checker.applyOne(b.novelId, sg.chapterId, sg.passageId, sg.item.id).ok, true);
  assert.ok(picked(b.ch().passages[0]).text.includes('She lit it.'));
  assert.equal(checker.smallMend(words, words.replace('Mara climbed', 'Mara went up')), true);
  assert.equal(checker.smallMend(words, 'Mara climbed the stair.'), false, 'most of it cut');
  /* fixes each small, together a big cut: the passage never changes much by itself — those that go in together stay a
   * small change, from the top; the rest wait for him (through 2.12.1 one too many held every one back: his report,
   * 2.12.2, "27 suggestions and it doesn't automatically change it") */
  const many = 'The lamp was cold. The glass was grey with salt. She trimmed the wick. She struck a match. The flame caught. The flame steadied. Below, the sea worked at the rocks. The gulls slept. The night was long. Morning came late.';
  const b2 = await makeBook([[many]]);
  await reset();
  await script([{ text: JSON.stringify({ edits: ['The glass was grey with salt. ', 'She struck a match. ', 'The flame steadied. ', 'The gulls slept. '].map((find) => ({ passage: '1.1', kind: 'humanize', find, replace: '', why: 'tighter' })) }) }]);
  await checker.runCheck(b2.novelId);
  assert.equal(picked(b2.ch().passages[0]).text, many.replace('The glass was grey with salt. ', ''), 'the first went in: still a small change');
  assert.equal(checker.smallMend(many, picked(b2.ch().passages[0]).text), true);
  const left = checker.suggestions(b2.novelId);
  assert.deepEqual(left.map((x) => x.item.find), ['She struck a match. ', 'The flame steadied. ', 'The gulls slept. '], 'the other three wait for him');
  assert.ok(left.every((x) => checker.waitsWhy(x.chapterId, x.passageId, x.item) === 'with the fixes put in by themselves already, it would change too much of the passage'), JSON.stringify(left.map((x) => checker.waitsWhy(x.chapterId, x.passageId, x.item))));
  /* and the next look puts no more in: what goes in by itself is measured from the words before any of it */
  await reset();
  await script([{ text: '{"edits": []}' }]);
  checker.checkBook(b2.novelId);
  await checker.runCheck(b2.novelId);
  checker.forTests().autoAfter(b2.novelId);
  assert.equal(picked(b2.ch().passages[0]).text, many.replace('The glass was grey with salt. ', ''), 'never drifts further, a look at a time');
  assert.equal(checker.suggestions(b2.novelId).length, 3);
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
  assert.deepEqual(people.map((c) => [c.name, c.now]), [['Mina', 'In the lamp room.']], JSON.stringify(people));
  assert.equal(archivist.pendingWork(b.novelId), false, 'the renamed passage counts as read');
  await putAway(b);
});

/* (2.6.2: his own words, once held back from what happens by itself, now go in by themselves — his word; 2.12.2:
 * writing from before it was switched on too — his report, "27 suggestions and it doesn't automatically change it";
 * the test keeps what still holds: words brought in are known by the version they came from) */
await test('the checker knows words brought in by the version they came from: old writing and his own new words are fixed by themselves, imported words he asks to have checked wait for him, and a name changed everywhere sends the checker nothing', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 } });
  const b = await makeBook([[{ text: 'Old words alot and and more teh end.', at: Date.now() - 100000 }]], { manual: true });
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own words alot.' });
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'x' },
    { passage: '1.1', kind: 'grammar', find: 'and and', replace: 'and', why: 'y' },
    { passage: '1.1', kind: 'grammar', find: 'teh', replace: 'the', why: 'z' },
    { passage: '1.2', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'x' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(picked(b.ch().passages[1]).text, 'My own words a lot.', 'his own new words: in by themselves');
  assert.equal(picked(b.ch().passages[0]).text, 'Old words a lot and more the end.', 'the old writing too');
  assert.deepEqual(checker.suggestions(b.novelId), []);
  await putAway(b);
  /* words brought in, checked because he asked: never changed by themselves, however recently they came */
  await reset();
  const m = await makeBook([[]], { manual: true });
  store.change('chapter', m.ids[0], shape.chapterSteps.addPassage(shape.newPassage('you', 'Brought in alot, teh end.', { how: 'imported' })), { now: true });
  checker.checkChapter(m.novelId, m.ids[0]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'alot', replace: 'a lot', why: 'x' }, { passage: '1.1', kind: 'grammar', find: 'teh', replace: 'the', why: 'y' }] }) }]);
  await checker.runCheck(m.novelId);
  assert.equal(picked(m.ch().passages[0]).text, 'Brought in alot, teh end.', 'as it came');
  const wait = checker.suggestions(m.novelId);
  assert.deepEqual(wait.map((x) => x.item.replace), ['a lot', 'the'], 'waiting for him');
  /* one he applies himself: the version it makes is still words brought in — the other waits */
  assert.equal(checker.applyOne(m.novelId, wait[0].chapterId, wait[0].passageId, wait[0].item.id).ok, true);
  checker.forTests().autoAfter(m.novelId);
  assert.equal(picked(m.ch().passages[0]).text, 'Brought in a lot, teh end.', 'the other still waits for him');
  assert.deepEqual(checker.suggestions(m.novelId).map((x) => x.item.replace), ['the']);
  await putAway(m);
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

heading('the notes: what the second sweep found');

await test('his hand is kept field by field: a card he touched only in its other names still takes who they are from the book; one whose words are his keeps them, and what the book adds rides beside them as Since then — shown to the writer, the helper told whose they are', () => {
  const notes = { people: [
    { id: 'a', name: 'Mara', aka: ['Mar'], about: 'A kitchen maid.', now: '', ties: '', updated: { by: 'you', at: 1, his: ['aka'] } },
    { id: 'b', name: 'Mira', aka: [], about: 'A kitchen maid.', now: '', ties: '', updated: { by: 'you', at: 1, his: ['about'] } },
    { id: 'c', name: 'Old Hask', aka: [], about: 'A ferryman.', now: '', ties: '', updated: { by: 'you', at: 1 } },
  ], places: [], lore: [], threads: [] };
  let out = archivist.foldNotes(notes, { people: [
    { name: 'Mara', about: 'A kitchen maid, and the duke’s daughter.' },
    { name: 'Mira', about: 'She is the lost princess.' },
    { name: 'Old Hask', about: 'A ferryman. He drowned the tax man.' },
  ] }, { chapterId: 'c1', at: 5 });
  const p = (id) => out.notes.people.find((c) => c.id === id);
  assert.equal(p('a').about, 'A kitchen maid, and the duke’s daughter.', 'who she is was never his: written');
  assert.deepEqual(p('a').aka, ['Mar'], 'the names he gave stand');
  assert.deepEqual(p('a').updated, { by: 'you', his: ['aka'], chapterId: 'c1', at: 5 }, 'still his where it was');
  assert.equal(p('b').about, 'A kitchen maid.', 'his words stand');
  assert.equal(p('b').since, 'She is the lost princess.', 'what the book added rides beside them');
  assert.equal(p('c').about, 'A ferryman.', 'a card his before fields were told apart is his whole');
  /* a name he gave stays the card's name: the one the book now uses joins the others */
  const named = archivist.foldNotes({ people: [{ id: 'n', name: 'Kit', aka: [], about: '', now: '', updated: { by: 'you', at: 1, his: ['name'] } }, { id: 'o', name: 'Wren', aka: [], about: '', now: '' }], places: [], lore: [], threads: [] },
    { people: [{ name: 'Katherine Vale', aka: ['Kit'] }, { name: 'Wren Ashby', aka: ['Wren'] }] });
  assert.deepEqual([named.notes.people[0].name, named.notes.people[0].aka], ['Kit', ['Katherine Vale']]);
  assert.deepEqual([named.notes.people[1].name, named.notes.people[1].aka], ['Wren Ashby', ['Wren']], 'a name not his: the one the story goes by now');
  assert.equal(p('c').since, 'He drowned the tax man.', 'his own sentence never repeated beside it');
  /* the next reading gives the whole of what was added since, his words never repeated */
  out = archivist.foldNotes(out.notes, { people: [{ name: 'Mira', about: 'A kitchen maid. She is the lost princess. She rules the north now.' }] });
  assert.equal(out.notes.people.find((c) => c.id === 'b').since, 'She is the lost princess. She rules the north now.');
  /* the writer reads both; the helper is told which are his */
  const novel = { notes: out.notes, order: [], memory: {} };
  const forWriter = prompts.notesText(novel);
  assert.ok(forWriter.includes('- Mira — A kitchen maid.\n  Since then: She is the lost princess. She rules the north now.'), forWriter);
  assert.ok(prompts.notesText(novel, { forHelper: true }).includes('- Mira — A kitchen maid. (my words)'));
  assert.ok(!prompts.notesText(novel, { forHelper: true }).includes('- Mara — A kitchen maid, and the duke’s daughter. (my words)'), 'only where the words are his');
});

await test('a card shown by its first line keeps the lines it was never shown; how someone stands with the others is added to whenever a reading would thin it, or the lines are his — the notes’ check gives them whole; a place, a thing or a thread says where it stands now', () => {
  const notes = { people: [
    { id: 'm', name: 'Mara', aka: [], about: 'A healer of the north. Keeps bees. Fears fire.', now: '', ties: 'Owes Tom a debt from the winter.' },
    { id: 't', name: 'Tom', aka: [], about: 'A fisherman.', now: '', ties: 'Grew up with Mara; owes her his boat; quarrelled with Venn over the nets.' },
    { id: 'v', name: 'Venn', aka: [], about: 'A smith.', now: '', ties: 'HIS TIES: Venn hates the sea.', updated: { by: 'you', at: 1, his: ['ties'] } },
  ], places: [{ id: 'pl', name: 'The Anchor', about: 'A busy tavern by the docks, with a red door and twelve rooms above the bar.' }], lore: [], threads: [] };
  let out = archivist.foldNotes(notes, { people: [
    { name: 'Mara', about: 'A healer of the north, now blind.', ties: 'Quarrelled with Tom over the toll.' },
    { name: 'Tom', ties: 'Made peace with Venn.' },
    { name: 'Venn', ties: 'Made peace with Tom.' },
  ], places: [{ name: 'The Anchor', about: 'Burned down in the night.' }] }, { short: new Set(['m']) });
  const p = (id) => out.notes.people.find((c) => c.id === id);
  assert.equal(p('m').about, 'A healer of the north, now blind. Keeps bees. Fears fire.', 'the lines it was never shown stand after what it gave for the first');
  assert.equal(p('m').ties, 'Owes Tom a debt from the winter. Quarrelled with Tom over the toll.', 'never shown, added to');
  assert.equal(p('t').ties, 'Grew up with Mara; owes her his boat; quarrelled with Venn over the nets. Made peace with Venn.', 'a thinner telling is added to');
  assert.equal(p('v').ties, 'HIS TIES: Venn hates the sea. Made peace with Tom.', 'his lines added to, never written over');
  assert.equal(out.notes.places[0].about, 'Burned down in the night.', 'a place as it is now');
  /* a fuller telling stands in place of the old */
  out = archivist.foldNotes(notes, { people: [{ name: 'Tom', ties: 'Grew up with Mara and owes her his boat; quarrelled with Venn over the nets, then made peace with him at the wake.' }] });
  assert.equal(out.notes.people.find((c) => c.id === 't').ties, 'Grew up with Mara and owes her his boat; quarrelled with Venn over the nets, then made peace with him at the wake.');
  /* the notes' check gives them whole */
  out = archivist.foldNotes(notes, { people: [{ name: 'Tom', ties: 'Made peace with Venn.' }] }, { audit: true });
  assert.equal(out.notes.people.find((c) => c.id === 't').ties, 'Made peace with Venn.');
});

await test('a person’s "now" knows the chapter and the passage it is as of: a part read out of turn moves only the ones no later part wrote; one with no such mark stays while anything later has been read', () => {
  const out = archivist.foldNotes({ people: [{ id: 'a', name: 'Ann', now: 'Asleep.' }] }, { people: [{ name: 'Ann', now: 'At the well.' }] }, { chapterId: 'c2', nowPid: 'p3' });
  assert.deepEqual([out.notes.people[0].now, out.notes.people[0].nowAt, out.notes.people[0].nowPid], ['At the well.', 'c2', 'p3']);
  const chapter = { id: 'c2', passages: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id })) };
  const novel = { order: ['c1', 'c2', 'c3'], notes: { people: [
    { id: 'A', now: 'x', nowAt: 'c3' }, { id: 'B', now: 'x', nowAt: 'c1' }, { id: 'C', now: 'x', nowAt: 'c2', nowPid: 'p4' }, { id: 'D', now: 'x', nowAt: 'c2', nowPid: 'p1' },
    { id: 'E', now: 'x' }, { id: 'F', now: 'x', nowAt: 'c2' }, { id: 'G', now: '' },
  ] } };
  assert.equal(archivist.nowWrittenLater(novel, chapter, 'p2', {}), false, 'nothing later read: every one may move');
  assert.deepEqual([...archivist.nowWrittenLater(novel, chapter, 'p2', { goesOn: true, laterRead: true })].sort(), ['A', 'C', 'E', 'F']);
  assert.deepEqual([...archivist.nowWrittenLater(novel, chapter, 'p5', { laterRead: true })].sort(), ['A', 'E'], 'the chapter read to its end');
  const held = archivist.foldNotes({ people: [{ id: 'a', name: 'Ann', now: 'In the tower.' }, { id: 'b', name: 'Bo', now: 'In the yard.' }] }, { people: [{ name: 'Ann', now: 'In the cellar.' }, { name: 'Bo', now: 'In the cellar.' }] }, { nowStays: new Set(['a']) });
  assert.deepEqual(held.notes.people.map((c) => c.now), ['In the tower.', 'In the cellar.']);
});

await test('what changed while the helper was asked stands: a field he (or his partner) wrote since is never written over by what was read before it, a card he took out meanwhile is never made again', () => {
  const asked = { people: [{ id: 'm', name: 'Mara', about: 'A maid.', now: 'In the cellar.', ties: '' }, { id: 'o', name: 'Old Pell', about: 'A ferryman.', now: '', ties: '' }], places: [], lore: [], threads: [] };
  const notes = { people: [
    { id: 'm', name: 'Mara', about: 'A maid.', now: 'In the garden (HIS).', ties: '', updated: { by: 'you', at: 9, his: ['now'] } },
    { id: 'n', name: 'Nell', about: '', now: '', ties: 'Made since, by the partner.' },
  ], places: [], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, { people: [
    { name: 'Mara', about: 'A maid, sharp-tongued.', now: 'In the kitchen.' },
    { name: 'Old Pell', about: 'A ferryman.', now: 'Drowned.' },
    { name: 'Nell', about: 'A weaver.', ties: 'Read from before it.' },
  ] }, { asked });
  const p = (n) => out.notes.people.find((c) => c.name === n);
  assert.equal(p('Mara').now, 'In the garden (HIS).', 'his newer words stand');
  assert.equal(p('Mara').about, 'A maid, sharp-tongued.', 'what he did not touch is written');
  assert.equal(p('Old Pell'), undefined, 'taken out meanwhile: not made again');
  assert.ok(out.refused.some((x) => x.name === 'Old Pell' && /while this was being read/.test(x.why)));
  assert.deepEqual([p('Nell').about, p('Nell').ties], ['A weaver.', 'Made since, by the partner.'], 'a card made since: only what is empty is filled');
});

await test('a name the words read hold is someone’s own, never a slip of the pen for another’s; a thread is never closed by the reading that opens it, nor by the notes’ check when the newest passage opened it', () => {
  const notes = { people: [{ id: 'r', name: 'Roberta Vance', aka: [], about: 'A clerk.', now: '' }], places: [], lore: [], threads: [{ id: 't', name: 'Tom’s promise to fix the roof', about: 'Before winter.', open: true }, { id: 'u', name: 'Tom promises to fix the roof', about: 'A copy.', open: true }] };
  let out = archivist.foldNotes(notes, { people: [{ name: 'Robert Vance', about: 'Her brother, a soldier.' }] }, { named: namesjs.foldedText('Robert Vance came home from the war.') });
  assert.equal(out.notes.people.length, 2, 'Robert is not Roberta');
  assert.equal(out.notes.people[0].about, 'A clerk.');
  const hitch = { people: [{ id: 'h', name: 'Roberta Hitchcock', aka: [], about: 'A clerk.', now: '' }], places: [], lore: [], threads: [] };
  out = archivist.foldNotes(hitch, { people: [{ name: 'Roberta Hitchcok', now: 'At the desk.' }] }, { named: namesjs.foldedText('Roberta came in.') });
  assert.equal(out.notes.people[0].now, 'At the desk.', 'a slip the words do not hold still finds its card');
  out = archivist.foldNotes(notes, { threads: [{ name: 'Venn’s debt to the bank', about: 'Paid at once.', open: false }] });
  assert.equal(out.notes.threads.length, 2, 'a thread new to the notes, already closed, is not made');
  assert.ok(out.refused.some((x) => /already closed/.test(x.why)));
  out = archivist.foldNotes(notes, { threads: [{ name: 'Venn’s debt to the bank', about: 'Paid long ago.', open: false }] }, { audit: true });
  assert.equal(out.notes.threads.find((c) => c.name === 'Venn’s debt to the bank').open, false, 'the check may add one the notes miss, as the book has it');
  out = archivist.foldNotes(notes, { threads: [{ name: 'Tom’s promise to fix the roof', open: false }] }, { audit: true, keepOpen: new Set(['t', 'u']) });
  assert.deepEqual(out.notes.threads.map((c) => c.open), [true, true], 'opened by the newest passage: only what comes after it can close it');
  assert.ok(out.refused.some((x) => /newest passage/.test(x.why)));
});

await test('the notes’ check gives the other names a person goes by whole — a wrong one comes off — never his, never the name it was just renamed from; a reading only adds, and an echo of the request is no name', () => {
  const notes = { people: [
    { id: 'r', name: 'Rias', aka: ['Wells', 'Red'], about: 'A redhead.', now: '' },
    { id: 'j', name: 'Jovan Wells', aka: ['Wells'], about: 'A smith.', now: '', updated: { by: 'you', at: 1, his: ['aka'] } },
  ], places: [], lore: [], threads: [] };
  let out = archivist.foldNotes(notes, { people: [{ name: 'Rias', aka: ['Red'], why: 'Wells is Jovan’s surname' }, { name: 'Jovan Wells', aka: [], why: 'x' }] }, { audit: true });
  assert.deepEqual(out.notes.people[0].aka, ['Red']);
  assert.equal(out.whys.r, 'Wells is Jovan’s surname');
  assert.deepEqual(out.notes.people[1].aka, ['Wells'], 'his names stand');
  out = archivist.foldNotes(notes, { people: [{ name: 'Rias', aka: ['every other name they go by'] }] }, { audit: true });
  assert.deepEqual(out.notes.people[0].aka, ['Wells', 'Red'], 'the request’s own words given back change nothing');
  out = archivist.foldNotes(notes, { people: [{ name: 'Rias', aka: [] }] });
  assert.deepEqual(out.notes.people[0].aka, ['Wells', 'Red'], 'a reading only adds');
  out = archivist.foldNotes(notes, { people: [{ name: 'Rias', aka: ['other names they go by'] }] });
  assert.deepEqual(out.notes.people[0].aka, ['Wells', 'Red'], 'an echo is no name');
  out = archivist.foldNotes(notes, { people: [{ name: 'Rias Gremory', aka: ['Rias'], why: 'her full name' }] }, { audit: true });
  assert.deepEqual([out.notes.people[0].name, out.notes.people[0].aka], ['Rias Gremory', ['Rias']], 'renamed: the old name stays among the others');
});

await test('nothing true is lost in a folding: a card folded into another goes only once the other holds what it held; a thing with a name of its own stands while the book names it; a check that saw some chapters only in short neither thins a person nor takes out what they may still tell of — and every refusal is said', () => {
  const notes = { people: [
    { id: 'm', name: 'Mara', aka: ['The Lighthouse Girl'], about: 'The keeper.', now: '' },
    { id: 'g', name: 'The Lighthouse Girl', aka: [], about: 'Sings to the gulls at dawn; lost her mother at sea.', now: '' },
    { id: 'h', name: 'Old Hask', aka: [], about: 'HIS.', now: '', updated: { by: 'you', at: 1 } },
    { id: 'k', name: 'Kai', aka: [], about: 'A fisherman of the north harbour who mends nets and sings.', now: '' },
  ], places: [], lore: [{ id: 'b', name: 'The Batwing', about: 'His car.' }, { id: 'l', name: 'the letter', about: 'From Claire.' }, { id: 'x', name: 'the hidden ledger', about: 'Under the chapel floor.' }], threads: [] };
  const stands = archivist.bookFolded({ order: [] });
  const book = namesjs.foldedText('He drove the Batwing home and burned the letter.', { cased: true });
  let out = archivist.foldNotes(notes, { gone: [{ kind: 'people', name: 'The Lighthouse Girl', why: 'folded into Mara' }, { kind: 'people', name: 'Old Hask' }, { kind: 'lore', name: 'The Batwing' }, { kind: 'lore', name: 'the letter' }] }, { audit: true, stands: book });
  const names = (o, k) => o.notes[k].map((c) => c.name);
  assert.ok(names(out, 'people').includes('The Lighthouse Girl'), 'what it held is on no other card yet');
  assert.deepEqual(names(out, 'lore'), ['The Batwing', 'the hidden ledger'], 'a named thing stands; a description goes');
  assert.deepEqual(out.refused.map((x) => [x.name, x.why]), [['The Lighthouse Girl', 'what it holds is not on Mara yet'], ['Old Hask', 'yours — never taken out'], ['The Batwing', 'its name still stands in the book']]);
  out = archivist.foldNotes(notes, { people: [{ name: 'Mara', about: 'The keeper; sings to the gulls at dawn; lost her mother at sea.' }], gone: [{ kind: 'people', name: 'The Lighthouse Girl' }] }, { audit: true, stands: book });
  assert.ok(!names(out, 'people').includes('The Lighthouse Girl'), 'folded once Mara holds it');
  /* some chapters seen only in short */
  const unseen = namesjs.foldedText('The ledger lay hidden. Kai mended nets and sang.');
  out = archivist.foldNotes(notes, { people: [{ name: 'Kai', about: 'A fisherman.' }], gone: [{ kind: 'lore', name: 'the hidden ledger' }] }, { audit: true, stands, unseen });
  assert.equal(out.notes.people.find((c) => c.id === 'k').about, 'A fisherman of the north harbour who mends nets and sings.', 'not thinned from a part view');
  assert.ok(names(out, 'lore').includes('the hidden ledger'));
  assert.ok(out.refused.some((x) => x.name === 'the hidden ledger' && /only in short/.test(x.why)));
  out = archivist.foldNotes(notes, { people: [{ name: 'Kai', about: 'A fisherman.' }], gone: [{ kind: 'lore', name: 'the hidden ledger' }] }, { audit: true, stands });
  assert.equal(out.notes.people.find((c) => c.id === 'k').about, 'A fisherman.', 'with the whole book read, as before');
  assert.ok(!names(out, 'lore').includes('the hidden ledger'));
});

await test('a row two cards answer to is kept on a card of its own, never lost — and the notes’ check is owed; the check, which names cards exactly, makes no such card and says so', async () => {
  const notes = { people: [{ id: 'a', name: 'Tom Wells', aka: [], about: 'A sailor.', now: 'At the docks.' }, { id: 'b', name: 'Tim Wells', aka: [], about: 'His brother.', now: 'At the docks.' }], places: [], lore: [], threads: [] };
  let out = archivist.foldNotes(notes, { people: [{ name: 'Captain Wells', now: 'Shot in the shoulder, carried to the infirmary.' }] });
  const own = out.notes.people.find((c) => c.name === 'Captain Wells');
  assert.equal(own.now, 'Shot in the shoulder, carried to the infirmary.');
  assert.equal(out.whys[own.id], 'two cards answer to this name (Tom Wells, Tim Wells) — the notes’ check folds it where it belongs');
  out = archivist.foldNotes(notes, { people: [{ name: 'Captain Wells', now: 'Shot.' }] }, { audit: true });
  assert.equal(out.notes.people.length, 2);
  assert.ok(out.refused.some((x) => x.name === 'Captain Wells' && /two cards answer/.test(x.why)));
  /* a reading that keeps one owes the check */
  const b = await makeBook([['Captain Wells was shot in the shoulder.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes(notes), { now: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'Captain Wells', now: 'Shot in the shoulder.' }] }) }, { text: JSON.stringify({ clear: true, verdict: 'Folded.' }) }]);
  await archivist.run(b.novelId);
  assert.ok(b.novel().notes.people.some((c) => c.name === 'Captain Wells'));
  const r = await requests();
  assert.equal(r.length, 2, 'the check came after the reading');
  assert.ok(String(r[1].body.messages.at(-1).content).includes('Check every card against the book'));
  await putAway(b);
});

await test('the notes’ check is honest: "false" in words is not clear; a change it gave that did not hold is said, and it is not clear; an empty answer is asked again; one that lands after a passage it read was written again is never laid on, and it checks again', async () => {
  const b = await makeBook([['Mara lit the lamp.', 'Tom slept.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'h', name: 'Hask', aka: [], about: 'HIS.', now: '', updated: { by: 'you', at: 1 } }, { id: 'm', name: 'Mara', aka: [], about: 'The keeper.', now: '' }], places: [], lore: [], threads: [] }), { now: true });
  markAllSeen(b);
  archivist.askAudit(b.novelId);
  await script([{ text: '{}' }, { text: JSON.stringify({ gone: [{ kind: 'people', name: 'Hask', why: 'not in the book' }], clear: 'true', verdict: 'Took out Hask.' }) }]);
  await archivist.run(b.novelId);
  let a = b.novel().memory.audit;
  assert.equal((await requests()).length, 2, 'an empty answer is asked again');
  assert.equal(a.clear, false, 'a change that did not hold is never "clear"');
  assert.deepEqual(a.refused, [{ kind: 'people', name: 'Hask', why: 'yours — never taken out' }]);
  assert.ok(b.novel().notes.people.some((c) => c.name === 'Hask'));
  /* "false" in words */
  archivist.askAudit(b.novelId);
  await reset();
  await script([{ text: JSON.stringify({ clear: 'false.', verdict: 'Mara’s lamp is unclear.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().memory.audit.clear, false);
  /* the book changes under it: never laid on */
  archivist.askAudit(b.novelId);
  await reset();
  await script([{ pause: 1.5, text: JSON.stringify({ people: [{ name: 'Mara', about: 'FROM THE OLD WORDS.', why: 'x' }], clear: true, verdict: 'Fine.' }) }, { text: '{"people": []}' }, { text: JSON.stringify({ clear: true, verdict: 'Fine now.' }) }]);
  const running = archivist.run(b.novelId);
  await new Promise((r) => setTimeout(r, 400));
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id, text: 'Mara broke the lamp.' });
  await running;
  assert.notEqual(b.novel().notes.people.find((c) => c.name === 'Mara').about, 'FROM THE OLD WORDS.', 'not laid on');
  assert.equal(b.novel().memory.auditAsked, true, 'checked again once the change is read');
  await putAway(b);
});

await test('the notes’ report says how many cards a check of some of them looked at, never “you can carry on” for those alone; what it left open stays said through the round; a group it could not check is passed by, never asked forever', async () => {
  const b = await makeBook([['Mara lit the lamp.']], { manual: true });
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, aka: [], about: `Someone of the harbour, number ${i}, who keeps to themselves and mends the nets at dusk.`, now: '' }));
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: many, places: [], lore: [], threads: [] }), { now: true });
  markAllSeen(b);
  await setHouse({ context: 16000 });
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: false, verdict: 'Person 2 contradicts the book.' }) }]);
  await archivist.run(b.novelId);
  let a = b.novel().memory.audit;
  assert.ok(a.some && a.some.checked < 120, JSON.stringify(a.some));
  const first = a.some.checked;
  assert.equal(a.from, first);
  archivist.askAudit(b.novelId);
  await reset();
  await script([{ text: JSON.stringify({ clear: true, verdict: 'These hold.' }) }]);
  await archivist.run(b.novelId);
  a = b.novel().memory.audit;
  assert.deepEqual(a.earlier.map((x) => x.verdict), ['Person 2 contradicts the book.'], 'what the first group left open is still said');
  /* a group its model will not check is passed by */
  archivist.askAudit(b.novelId);
  const from = a.from;
  const sorry = { text: "I'm sorry, but I can't help with that." };
  await reset();
  await script([sorry, sorry]);
  await archivist.run(b.novelId);
  archivist.forTests().failures.delete(b.novelId);
  await script([sorry, sorry]);
  await archivist.run(b.novelId);
  a = b.novel().memory.audit;
  assert.ok(a.failed, JSON.stringify(a));
  assert.notEqual(a.from, from, 'the next check goes on to the next group');
  await setHouse();
  await putAway(b);
});

await test('a chapter the helper does not have in hand is never read as empty: the book given to a reader says so, and the helper waits for it', () => {
  const novel = { order: ['c1', 'c2'], chapterNames: {}, meta: {} };
  const chapters = { c2: { id: 'c2', passages: [{ id: 'p', by: 'writer', versions: [{ id: 'v', text: 'Words.' }], pick: 0 }] } };
  const fit = context.fitBook({ novel, chapters, chapterId: null, current: null, room: 100000 });
  const all = [...fit.book.summaries, ...fit.book.whole].map((x) => x.text).join('\n');
  assert.ok(all.includes('(this chapter could not be read just now)'), all);
  assert.ok(!all.includes('(nothing written in it yet)'));
});

await test('a summary goes through the helper’s door: a refusal is no summary — asked again, never kept — and one kept before is written again; “known from earlier” names only who came before this chapter', async () => {
  const b = await makeBook([['Mara Venn kept the light.'], ['Mara Venn met Corvin Hale at the quay.'], ['The sea rose.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara Venn', about: 'The keeper.' })), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Corvin Hale', about: 'A smuggler.' })), { now: true });
  markAllSeen(b);
  /* a refusal kept as the first chapter's summary by a version before the door */
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: "I'm sorry, but I can't summarize this.", fp: shape.chapterPrint(b.ch(0)), at: Date.now() }), { now: true });
  const sorry = { text: JSON.stringify({ summary: "I'm sorry, but I can't help with that." }) };
  await script([sorry, { text: JSON.stringify({ summary: 'Mara Venn keeps the light alone.' }) }, { text: JSON.stringify({ summary: 'Mara Venn meets Corvin Hale at the quay.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.ch(0).summary.text, 'Mara Venn keeps the light alone.', 'the refusal kept before is written again; a new refusal is asked again');
  const r = (await requests()).map((x) => String(x.body.messages.at(-1).content));
  const second = r.find((m) => m.includes('Mara Venn met Corvin Hale'));
  assert.ok(second && second.includes('already known from earlier: Mara Venn)'), second && second.slice(-900));
  assert.ok(!/already known from earlier: [^)]*Corvin/.test(second), 'the chapter’s own newcomer is never called known');
  await putAway(b);
});

await test('a summary’s names and figures asked for while its model is down: the summary stands, and they are asked for again later — never let go', async () => {
  const one = 'The rain fell on the lighthouse at Crane Point. Mara Venn climbed to the lamp while Corvin waited below with 40 men.';
  const b = await makeBook([[one], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  await script([{ text: JSON.stringify({ summary: 'Mara Venn tends the lamp through a long storm until the morning.' }) }, { status: 503, message: 'overloaded' }, { status: 503, message: 'overloaded' }, { status: 503, message: 'overloaded' }, { status: 503, message: 'overloaded' }]);
  await archivist.run(b.novelId);
  assert.equal(b.ch(0).summary.text, 'Mara Venn tends the lamp through a long storm until the morning.', 'the summary stands meanwhile');
  assert.equal(b.ch(0).summary.again, true);
  assert.ok(archivist.forTests().failures.get(b.novelId), 'tried again later, by itself');
  archivist.forTests().failures.delete(b.novelId);
  await reset();
  await script([{ text: JSON.stringify({ summary: 'Mara Venn tends the lamp at Crane Point through a long storm while Corvin waits below with 40 men.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.ch(0).summary.text, 'Mara Venn tends the lamp at Crane Point through a long storm while Corvin waits below with 40 men.');
  assert.equal(b.ch(0).summary.again, undefined);
  assert.equal((await notChecks()).length, 1, 'only the names and figures asked for, not the whole summary again');
  await putAway(b);
});

await test('what the helper keeps of the book: only what an answer gave is written, and only a whole of it; a reading’s thinner one never replaces a fuller; written beside his words as they were asked, so his rewriting them meanwhile is seen', async () => {
  const b = await makeBook([['Mara kept the light at Crane Point.']]);
  markAllSeen(b);
  const STYLE = 'Close third person on Mara, past tense. Quiet, salt-worn sentences, long on weather and short on talk.';
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: STYLE, at: 1, ownFp: 'old words' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'OLD ABOUT. A keeper.', at: 1, ownFp: 'old words' }), { now: true });
  /* both due; the answer gives only one */
  await script([{ text: JSON.stringify({ about: 'A keeper on Crane Point finds a letter. It pulls her toward the family she left.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'A keeper on Crane Point finds a letter. It pulls her toward the family she left.');
  assert.equal(b.novel().kept.style.text, STYLE, 'one the answer left out keeps what stands');
  /* a reading’s one line never replaces it */
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'Mira confronted Tom at the gate.' });
  await reset();
  await script([{ text: JSON.stringify({ about: 'Mira confronts Tom.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().kept.about.text, 'A keeper on Crane Point finds a letter. It pulls her toward the family she left.');
  /* his words rewritten while it was being written: what lands is still due again for them */
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', null), { now: true });
  await reset();
  await script([{ text: JSON.stringify({ about: 'WRITTEN FROM HIS OLD WORDS. A keeper and her light.' }), chunk: 3, delay: 0.02 }, { text: JSON.stringify({ about: 'WRITTEN FROM HIS NEW WORDS. A keeper and the letter.' }) }]);
  const run = archivist.run(b.novelId);
  for (let i = 0; i < 200 && !(await requests()).length; i++) await sleep(10);
  store.change('novel', b.novelId, shape.novelSteps.setField('brief', 'A keeper finds a letter from her drowned brother.'), { now: true });
  await run;
  assert.equal(b.novel().kept.about.text, 'WRITTEN FROM HIS OLD WORDS. A keeper and her light.');
  assert.equal(archivist.pendingWork(b.novelId), true, 'due again beside his new words');
  await putAway(b);
});

await test('threads are one only when their titles say the same: a narrower or wider one is kept beside it, said, and closing it closes nothing else; whose vow it is decides', () => {
  const notes = { people: [], places: [], lore: [], threads: [{ id: 'k', name: 'Who killed the king', about: 'The king lies dead.', open: true }, { id: 'v', name: 'Jovan’s vow to protect Yuki', about: 'Sworn at the gate.', open: true }] };
  let out = archivist.foldNotes(notes, { threads: [{ name: 'Who killed the king’s guard', about: 'The steward did it.', open: false }] });
  const t = (n) => out.notes.threads.find((c) => c.name === n);
  assert.deepEqual([t('Who killed the king').open, t('Who killed the king').about], [true, 'The king lies dead.']);
  assert.equal(t('Who killed the king’s guard').open, false);
  assert.match(out.whys[t('Who killed the king’s guard').id], /may be the same thread as “Who killed the king”/);
  out = archivist.foldNotes(notes, { threads: [{ name: 'Yuki’s vow to protect Jovan', about: 'Sworn in return.' }] });
  assert.equal(out.notes.threads.length, 3, 'a mirror is another thread');
  assert.equal(out.notes.threads.find((c) => c.id === 'v').about, 'Sworn at the gate.');
  assert.equal(shape.sameThreadTitle('Tom promised to fix the roof', 'Tom’s promise to fix the roof'), true, 'the same words in other forms are one');
});

await test('how someone stands with the others is added to when a reading’s telling would drop a person the old one named', () => {
  const notes = { people: [
    { id: 'm', name: 'Mira', aka: [], about: 'A healer.', now: '', ties: 'Sara — her sister, close since childhood. Tom — rivals since the trial.' },
    { id: 's', name: 'Sara', aka: [], about: 'Her sister.', now: '' }, { id: 't', name: 'Tom', aka: [], about: 'A rival.', now: '' },
  ], places: [], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, { people: [{ name: 'Mira', ties: 'Tom — the argument at the gate broke their truce, and each blames the other for the fire at the mill.' }] });
  assert.equal(out.notes.people[0].ties, 'Sara — her sister, close since childhood. Tom — rivals since the trial. Tom — the argument at the gate broke their truce, and each blames the other for the fire at the mill.');
});

await test('an answer cut off inside its object is never taken for the answer — a map of ties found in it is no reading — and is asked again with room; an answer written only in the thinking is read from there', async () => {
  const b = await makeBook([['Mira hid in the ferryman’s hut.']], { manual: true });
  await script([
    { text: '{"people":[{"name":"Mira","about":"A healer.","ties":{"Aldric":"her father, estranged","Bren":"an old friend"},"now":"Hiding in the ferryman\'s hut while the wolves', finish: 'length' },
    { text: JSON.stringify({ people: [{ name: 'Mira', now: 'Hiding in the ferryman’s hut.' }] }) },
  ]);
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 2);
  assert.equal(b.novel().notes.people.find((c) => c.name === 'Mira').now, 'Hiding in the ferryman’s hut.');
  /* a cut answer whose first whole inner object looks like an answer of its own — {"about": …} — is never taken for it */
  const k = await makeBook([['The mill stood by the river.']]);
  markAllSeen(k);
  store.change('chapter', k.ids[0], (c) => { c.passages[0].versions[0].text = 'The mill stood by the river, burned.'; }, { now: true });
  await reset();
  await script([{ text: '{"places":[{"about":"The old mill by the river, burned to its stones."}],"people":[{"name":"Mi', finish: 'length' }, { text: '{"places": [{"name": "The mill", "about": "Burned."}]}' }]);
  await archivist.run(k.novelId);
  assert.notEqual((k.novel().kept.about || {}).text, 'The old mill by the river, burned to its stones.', 'no inner piece taken for what the book is about');
  assert.ok(k.novel().notes.places.some((c) => c.name === 'The mill'), 'the second, whole answer read');
  await putAway(k);
  assert.equal(archivist.notesShape({ Aldric: 'x', Bren: 'y' }), false);
  assert.equal(archivist.notesShape({}), true, 'an answer with nothing to change is one');
  /* the thinking */
  const c = await makeBook([['Tom mended the nets.']], { manual: true });
  await reset();
  await script([{ think: 'Let me draft: {"people": []}. Final: {"people": [{"name": "Tom", "about": "A fisherman."}]}', text: '' }]);
  await archivist.run(c.novelId);
  assert.equal(c.novel().notes.people[0].about, 'A fisherman.');
  await putAway(b);
  await putAway(c);
});

await test('Go on of a passage the helper read keeps what it read, so the next reading is told what the passage used to say — never all of it read again as new', async () => {
  const b = await makeBook([['Mara climbed to the lamp.', 'The storm']], { manual: true });
  store.change('chapter', b.ids[0], (c) => { const v = c.passages[1].versions[0]; v.cut = true; v.by = 'ai'; }, { now: true });
  markAllSeen(b);
  await script([{ text: ' broke over Crane Point at dusk.' }]);
  const out = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[1].id });
  assert.equal(out.ok, true, out.error);
  const ch = archivist.changesIn(b.novel(), b.ch());
  assert.equal(ch.changes.length, 1);
  assert.equal(ch.changes[0].old, 'The storm', 'told what it used to say');
  await putAway(b);
});

await test('a reading that lands after its chapter was taken out lays nothing on the notes and never says an id; passages moved to a new chapter while they were read are read there — never told as taken out', async () => {
  const b = await makeBook([['Mara kept the light.'], ['Ilsa came ashore.']], { manual: true });
  markAllSeen(b);
  store.change('chapter', b.ids[1], (c) => { c.passages[0].versions[0].text = 'Ilsa came ashore at night.'; }, { now: true });
  await script([{ pause: 1, text: JSON.stringify({ people: [{ name: 'Ilsa', about: 'A stranger from the sea.' }] }) }]);
  const run = archivist.run(b.novelId);
  for (let i = 0; i < 200 && !(await requests()).length; i++) await sleep(10);
  store.change('novel', b.novelId, (n) => { n.order = n.order.filter((id) => id !== b.ids[1]); }, { now: true });
  await store.remove('chapter', b.ids[1]).catch(() => {});
  await run;
  assert.ok(!b.novel().notes.people.some((c) => c.name === 'Ilsa'), 'nothing laid on');
  assert.ok(!/not open|ch-/.test(archivist.lightOf(b.novelId).words), archivist.lightOf(b.novelId).words);
  await putAway(b);
});

await test('a passage read in parts left half read when a window closed: its earlier parts are taken back before anything else is read', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  markAllSeen(b);
  /* what an earlier part left in the notes, recorded as it is kept on the book */
  const card = { id: 'pe-x', name: 'Half Read', about: 'From part one only.', now: '' };
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', card), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ inParts: { cards: [{ kind: 'people', id: 'pe-x', before: null, after: card }], kept: {}, from: { undo: null, lit: null }, at: Date.now() } }), { now: true });
  await archivist.run(b.novelId);
  assert.ok(!b.novel().notes.people.some((c) => c.id === 'pe-x'), 'taken back');
  assert.equal(b.novel().memory.inParts, null);
  await putAway(b);
});

await test('a passage its model would not read is said to the writer as never in the notes; it is labelled where it stands now, let go when it is taken out, read again under another connection, and all of them at once', async () => {
  const b = await makeBook([['Mara kept the light.', 'Tom sang.', 'The sea rose.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  markAllSeen(b);
  const [p1, p2] = b.ch().passages;
  store.change('novel', b.novelId, shape.novelSteps.setAside({ [p2.id]: { chapterId: b.ids[0], sig: archivist.signature(picked(p2)), label: 'Chapter One, passage 2', why: 'refused', at: 1, conn: 'another connection' } }), { now: true });
  const a = context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Go on.' });
  assert.ok(a.system.includes('Never in these notes: Chapter One, passage 2'), 'said to the writer');
  /* the passage before it taken out: it is passage 1 now */
  store.change('chapter', b.ids[0], (c) => { c.passages = c.passages.filter((x) => x.id !== p1.id); }, { now: true });
  assert.equal(archivist.asideNow(b.novel())[0].label, 'Chapter One, passage 1');
  /* another connection: read again by itself */
  await script([{ text: '{"people": [{"name": "Tom", "about": "A singer."}]}' }, { text: '{}' }, { text: '{}' }]);
  await archivist.run(b.novelId);
  assert.deepEqual(Object.keys(b.novel().memory.aside || {}), []);
  assert.ok(b.novel().notes.people.some((c) => c.name === 'Tom'));
  /* taken out: let go */
  store.change('novel', b.novelId, shape.novelSteps.setAside({ gone: { chapterId: b.ids[0], sig: 'x', label: 'Chapter One, passage 9', why: 'refused', at: 1 } }), { now: true });
  assert.equal(archivist.asideNow(b.novel()).length, 0);
  await reset();
  await archivist.run(b.novelId);
  assert.deepEqual(Object.keys(b.novel().memory.aside || {}), []);
  await putAway(b);
});

await test('while the whole book is read again, a change to the notes or a name changed everywhere waits — the notes are being written afresh', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  markAllSeen(b);
  archivist.readAgain(b.novelId);
  assert.match(changes.makeChange(b.novelId, { note: 'people', name: 'Mara', now: 'Asleep.' }).said, /being read again/);
  assert.match(changes.makeChange(b.novelId, { rename: { from: 'Mara', to: 'Myra' } }).said, /being read again/);
  assert.equal(picked(b.ch().passages[0]).text, 'Mara kept the light.');
  archivist.undoLast(b.novelId);
  await putAway(b);
});

await test('cards kept before today’s door are put through it once: a field of the helper’s that says nothing goes; his words are never touched', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [
    { id: 'a', name: 'Mara', aka: ['…'], about: 'The keeper.', now: 'unchanged', ties: '[object Object]' },
    { id: 'h', name: 'Hask', aka: [], about: 'none', now: '', updated: { by: 'you', at: 1 } },
  ], places: [], lore: [], threads: [] }), { now: true });
  assert.equal(archivist.healCards(b.novelId), 1);
  const [m, h] = b.novel().notes.people;
  assert.deepEqual([m.now, m.ties, m.aka, m.about], ['', '', [], 'The keeper.']);
  assert.equal(h.about, 'none', 'his words stand');
  assert.equal(archivist.healCards(b.novelId), 0, 'once');
  await putAway(b);
});

await test('the first Cozy Novel’s notes come in as his — his Story Bible, the facts he kept, his notes on chapters and scenes', () => {
  const records = [
    { id: 'n1', type: 'novel', title: 'Old Book', orderedChapterIds: ['c1'] },
    { id: 'c1', type: 'chapter', title: 'The Light', notes: 'HIS CHAPTER NOTE.', orderedSceneIds: ['s1'] },
    { id: 's1', type: 'scene', currentRevisionId: 'r1', title: 'Opening', notes: 'HIS SCENE NOTE.' },
    { id: 'r1', type: 'revision', textBlobId: 'b1' },
    { id: 'e1', type: 'entity', novelId: 'n1', kind: 'person', displayName: 'Mara', profile: 'The keeper.' },
    { id: 'k1', type: 'canon', novelId: 'n1', status: 'active', recordKind: 'authorFact', proposition: 'Mara is thirty.' },
  ];
  const [book] = files.fromLegacy({ records, blobs: [{ id: 'b1', text: 'Mara kept the light.' }] });
  const all = shape.NOTE_KINDS.flatMap((k) => book.novel.notes[k] || []);
  assert.ok(all.length >= 3, JSON.stringify(all));
  assert.ok(all.every((c) => c.updated && c.updated.by === 'you'), JSON.stringify(all.map((c) => [c.name, c.updated])));
});

await test('notes far past their room never crowd out the chapter: by their names, then the ones that matter least left out — said, his and the ones the words name always whole', () => {
  const people = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `Mender${i}`, about: `Someone of the harbour, number ${i}, who keeps to themselves and mends the nets at dusk.`, now: 'At the docks.', updated: { at: i } }));
  people.push({ id: 'his', name: 'Hask', about: 'HIS WHOLE CARD.', now: '', updated: { by: 'you', at: 1 } });
  const threads = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, name: `Old matter ${i}`, about: 'Long settled.', open: false }));
  const novel = { notes: { people, places: [], lore: [], threads }, order: [], memory: {} };
  const ids = new Map();
  const text = prompts.notesText(novel, { fit: 900, focus: 'Mender7 came.', shortIds: ids });
  assert.ok(util.estimateTokens(text) <= 900 + 60, String(util.estimateTokens(text)));
  /* by their names when that is enough */
  const names = prompts.notesText(novel, { fit: 2400, focus: 'Mender7 came.' });
  assert.match(names, /shown by their names only\.\)$/);
  assert.ok(names.includes('- Mender12\n') && names.includes('Old matter 3'), 'every card by its name');
  assert.ok(text.includes('HIS WHOLE CARD.') && text.includes('who keeps to themselves and mends the nets at dusk.\n  Right now: At the docks.'), 'his card and the one named, whole');
  assert.match(text, /left out here\.\)$/);
  assert.ok(!text.includes('Old matter 3'), 'closed threads go first');
  assert.equal(ids.get('p7'), undefined);
  assert.ok([...ids.values()].every((v) => v >= 2));
  /* what matters least goes first: closed threads before open ones, whatever was touched last */
  const few = { notes: { people: [], places: [], lore: [],
    threads: [...Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, name: `An open matter that still waits, number ${i}`, open: true, updated: { at: 1 } })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `A closed matter long settled, number ${i}`, open: false, updated: { at: 1000 } }))] }, order: [], memory: {} };
  const half = util.estimateTokens(prompts.notesText(few, { fit: 100000 })) * 0.6;
  const shed = prompts.notesText(few, { fit: half });
  assert.ok(shed.includes('An open matter that still waits, number 3') && !shed.includes('A closed matter long settled, number 3'), shed.slice(0, 400));
});

await test('the notes’ check holds what the helper keeps of the book against it too; Read the whole book again owes a check once it is done', async () => {
  const b = await makeBook([['Mara kept the light at Crane Point.']]);
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setKept('about', { text: 'A DRIFTED ABOUT. Mara is a sailor.', at: 1, ownFp: 'x' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setKept('style', { text: 'STYLE. Close third.', at: 1, ownFp: 'x' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  const brief = b.novel().brief;
  store.change('novel', b.novelId, (n) => { for (const k of ['about', 'style']) n.kept[k].ownFp = util.hashText(String(k === 'about' ? n.brief : n.style || '').trim()); }, { now: true });
  assert.ok(brief !== undefined);
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ about: 'Mara keeps the light at Crane Point. A letter changes everything.', clear: true, verdict: 'What it is about had drifted.' }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests()).map((r) => String(r.body.messages.at(-1).content)).find((m) => m.includes('Check every card'));
  assert.ok(ask && ask.includes('A DRIFTED ABOUT'), 'it is shown');
  assert.equal(b.novel().kept.about.text, 'Mara keeps the light at Crane Point. A letter changes everything.');
  assert.ok(b.novel().memory.audit.changes.some((c) => c.name === 'What it’s about'));
  await putAway(b);
  /* read again: a check owed once it is done */
  const c = await makeBook([['Tom mended the nets.']], { manual: true });
  store.change('novel', c.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Tom', about: 'A fisherman.' })), { now: true });
  markAllSeen(c);
  archivist.readAgain(c.novelId);
  await reset();
  await script([{ text: '{"people": [{"name": "Tom", "about": "A fisherman."}]}' }]);
  await archivist.run(c.novelId);
  assert.equal(archivist.rereading(c.novelId), false, 'done');
  assert.equal(c.novel().memory.auditAsked, true, 'a check owed');
  await reset();
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Holds.' }) }]);
  await archivist.run(c.novelId);
  assert.ok((await requests()).some((r) => String(r.body.messages.at(-1).content).includes('Check every card')), 'the check came after');
  await putAway(c);
});

await test('a place or a thing named near another is kept beside it, said — never written on as the same', () => {
  const notes = { people: [], places: [{ id: 'a', name: 'The Rusty Anchor Inn', about: 'A tavern.' }], lore: [{ id: 'l', name: 'Claire’s letter', about: 'Unopened.' }], threads: [] };
  const out = archivist.foldNotes(notes, { places: [{ name: 'The Anchor', about: 'Burned down.' }], lore: [{ name: 'the letter', about: 'Read at last.' }] });
  assert.equal(out.notes.places[0].about, 'A tavern.');
  assert.match(out.whys[out.notes.places[1].id], /may be the same place as “The Rusty Anchor Inn”/);
  assert.equal(out.notes.lore[0].about, 'Unopened.');
  assert.ok(out.aside.every((x) => x.near));
});

await test('a helper whose model is too small for his own words is asked again once he shortens them, and says which words fill it', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true, brief: 'A lighthouse keeper finds a letter. '.repeat(900) });
  await setHouse({ context: 8000 });
  await archivist.run(b.novelId);
  assert.match(archivist.lightOf(b.novelId).words, /your words in What it’s about and How it reads/);
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'not asked again as they stand');
  store.change('novel', b.novelId, shape.novelSteps.setField('brief', 'A lighthouse keeper finds a letter.'), { now: true });
  await script([{ text: '{"people": [{"name": "Mara", "about": "The keeper."}]}' }]);
  await archivist.run(b.novelId);
  assert.ok(b.novel().notes.people.some((c) => c.name === 'Mara'), 'shortened: read');
  await setHouse();
  await putAway(b);
});

await test('a passage that alone makes a reading stall for minutes is set aside after a second run — never asked for ever, and no harmless ask needed to tell', async () => {
  globalThis.__cozyLeashQuietMs = 2000;
  globalThis.__cozyLeashAllMs = 700;
  try {
    const b = await makeBook([['Mara kept the light.']], { manual: true });
    await script([{ hang_after: '{"people": [' }]);
    await archivist.run(b.novelId);
    assert.deepEqual(Object.keys(b.novel().memory.aside || {}), [], 'not on its first run');
    archivist.forTests().failures.delete(b.novelId);
    await reset();
    await script([{ hang_after: '{"people": [' }]);
    await archivist.run(b.novelId);
    assert.equal(Object.keys(b.novel().memory.aside || {}).length, 1, 'set aside');
    assert.equal((await requests()).length, 1, 'no harmless ask');
    assert.equal(archivist.pendingWork(b.novelId), false);
    await putAway(b);
  } finally {
    delete globalThis.__cozyLeashQuietMs;
    delete globalThis.__cozyLeashAllMs;
  }
});

/* =================================================== the checker: what the second sweep found */
heading('the checker: what the second sweep found');

const CK_SORRY = { text: "I'm sorry, but I can't help with that." };
const CK_NONE = { text: '{"edits": []}' };
const ALL_YES = () => Object.fromEntries(prompts.JUDGE_CHECKS.map(([k]) => [k, 'yes']));
/* the checker's next look let go of: nothing of it runs into the next step of a check */
const hush = (id) => { const t = checker.forTests(); const x = t.timers.get(id); if (x) clearTimeout(x.t); t.timers.delete(id); t.failures.delete(id); t.states.delete(id); };

await test('a passage the checker’s model will not check: the book is read one passage at a time at once, it is set aside after a second run — said, with Check it again — and the passages after it are checked', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.', 'Tom came up the path.', 'The sea was grey.']]);
  const [, p2] = b.ch().passages;
  const t = checker.forTests();
  /* together: not checked — its model answers a harmless ask, so it is these words: one at a time, in a moment */
  await script([CK_SORRY, CK_SORRY]);
  await checker.runCheck(b.novelId);
  assert.equal(t.narrow.has(b.novelId), true, 'one passage at a time from now on');
  assert.match(checker.stateOf(b.novelId).words, /reads one passage at a time now/);
  assert.ok(t.timers.get(b.novelId).due - Date.now() <= 1500, 'again in a moment, not in a minute');
  hush(b.novelId);
  /* one at a time: the first checked, the second not (its first run) */
  await reset();
  await script([CK_NONE, CK_SORRY, CK_SORRY]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.setAsideList(b.novelId).length, 0, 'not set aside on its first run');
  assert.equal(checker.stateOf(b.novelId).state, 'waiting', 'tried again by itself');
  hush(b.novelId);
  /* its second run: set aside — and the third passage checked */
  await reset();
  await script([CK_SORRY, CK_SORRY, CK_NONE]);
  await checker.runCheck(b.novelId);
  const aside = checker.setAsideList(b.novelId);
  assert.deepEqual(aside.map((x) => [x.passageId, x.number]), [[p2.id, 2]]);
  assert.match(aside[0].why, /I'm sorry, but I can't help/);
  assert.ok(checkedPart((await checkAsk()).at(-1)).includes('The sea was grey.'), 'the passage after it is checked');
  const st = checker.stateOf(b.novelId);
  assert.equal(st.state, 'clean');
  assert.match(st.words, /One passage its model would not check — in Suggestions, with Check it again\./);
  assert.equal(t.narrow.has(b.novelId), false, 'nothing left to check: together again');
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'never asked for ever');
  /* Check it again */
  assert.equal(checker.checkAgain(b.novelId, b.ids[0], p2.id), true);
  hush(b.novelId);
  assert.deepEqual([checker.setAsideList(b.novelId).length, checker.waiting(b.novelId)], [0, 1]);
  await script([CK_NONE]);
  await checker.runCheck(b.novelId);
  assert.ok(checkedPart((await checkAsk())[0]).includes('Tom came up the path.'));
  assert.equal(checker.waiting(b.novelId), 0);
  await setHouse();
  await putAway(b);
});

await test('a refusal while its model is down is waited out — never a stop for good, for the checker or the helper; a model that answers a harmless ask in words of its own is there, so it is the words, set aside after a second run', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  const refused = { status: 400, message: 'Content Exists Risk' };
  const probes = async () => (await requests()).filter((x) => String(x.body.messages.at(-1).content).includes('Answer with {"ok": true}'));
  await script([refused, refused, { probe: true, status: 503, message: 'down' }]);
  await checker.runCheck(b.novelId);
  assert.equal((await probes()).length, 1, 'the harmless ask was made');
  assert.notEqual(checker.stateOf(b.novelId).state, 'trouble', checker.stateOf(b.novelId).words);
  assert.equal(checker.forTests().blocked.has(b.novelId), false, 'never turned away for good');
  hush(b.novelId);
  /* the helper the same */
  await reset();
  await script([refused, refused, { probe: true, status: 503, message: 'down' }]);
  await archivist.run(b.novelId);
  assert.equal((await probes()).length, 1);
  assert.notEqual(archivist.lightOf(b.novelId).state, 'trouble', archivist.lightOf(b.novelId).words);
  assert.equal(archivist.pendingWork(b.novelId), true, 'still to be read once its model is back');
  quiet(b);
  /* its model back, answering the harmless ask in words of its own: it is there — so it is these words,
   * set aside after a second run of their own (the run its model was down for is not one of them) */
  for (let i = 0; i < 2; i++) {
    await reset();
    await script([refused, refused, { probe: true, text: 'Ready.' }]);
    await checker.runCheck(b.novelId);
    hush(b.novelId);
    assert.equal(checker.setAsideList(b.novelId).length, i, i ? 'set aside after a second run — not waited for ever' : 'not on its first');
  }
  await setHouse();
  await putAway(b);
});

await test('a pair of versions the checker’s model will not read head to head is let go — never a stop for the checker; a key refused for good stops it', async () => {
  await setHouse({}, { checksFrom: 0 });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const two = async () => {
    const b = await makeBook([[{ text: 'Mara lit the lamp.', model: 'writer-a', how: 'write', ask }]]);
    const pid = b.ch().passages[0].id;
    store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text: 'Mara looked at the lamp.', model: 'writer-b', how: 'another', ask: { ...ask } })), { now: true });
    return b;
  };
  const b = await two();
  await script([{ text: GRADED_NONE('1.1') }, CK_SORRY, CK_SORRY]);
  await checker.runCheck(b.novelId);
  const duels = (await requests()).filter((x) => String(x.body.messages.at(-1).content).includes('Which is the better page'));
  assert.equal(duels.length, 1, 'asked');
  assert.equal(checker.stateOf(b.novelId).state, 'clean', 'nothing to wait out: the checking went on and finished');
  assert.equal(checker.forTests().blocked.has(b.novelId), false);
  assert.equal(checker.gradesOf(b.novelId).duels, 0, 'the pair let go');
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'never asked in a loop');
  /* the key refused: the connection's fault stops it, as any refusal for good does */
  const c = await two();
  await reset();
  await script([{ text: GRADED_NONE('1.1') }, { status: 401, message: 'Invalid API key' }]);
  await checker.runCheck(c.novelId);
  assert.equal(checker.stateOf(c.novelId).state, 'trouble');
  hush(c.novelId);
  await setHouse();
  await putAway(b);
  await putAway(c);
});

await test('the checker’s notes are fitted to its model’s room as the helper’s are — a book with long notes is still checked', async () => {
  await setHouse({ context: 20000 }, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']]);
  const people = Array.from({ length: 200 }, (_, i) => shape.newCard('people', { name: `Keeper ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`, about: 'A keeper of the light who walks the long stair each night and counts the ships. '.repeat(5).trim() }));
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people, places: [], lore: [], threads: [] }), { now: true });
  assert.ok(util.estimateTokens(JSON.stringify(people)) > 20000, 'the notes alone are more than its model holds');
  await script([CK_NONE]);
  await checker.runCheck(b.novelId);
  assert.notEqual(checker.stateOf(b.novelId).state, 'trouble', checker.stateOf(b.novelId).words);
  const r = await requests();
  assert.equal(r.length, 1, 'checked');
  const sent = r[0].body.messages.map((m) => m.content).join('\n');
  assert.ok(util.estimateTokens(sent) < 20000 - 6000, `the request fits beside the answer (${util.estimateTokens(sent)} tokens)`);
  assert.ok(sent.includes('Keeper A0'), 'the notes are there, fitted');
  await setHouse();
  await putAway(b);
});

await test('while the whole book is read again, the checker reads the notes as they stood — never the half-built ones', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']]);
  const old = { people: [shape.newCard('people', { name: 'Mara', about: 'AS THEY STOOD: the keeper of Crane Point.' })], places: [], lore: [], threads: [] };
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [shape.newCard('people', { name: 'Mara', about: 'HALF BUILT.' })], places: [], lore: [], threads: [] }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ rereadFrom: { notes: old, kept: {} }, undo: { keep: true } }), { now: true });
  await script([CK_NONE]);
  await checker.runCheck(b.novelId);
  const [asked] = await checkAsk();
  assert.ok(asked.includes('AS THEY STOOD: the keeper of Crane Point.') && !asked.includes('HALF BUILT.'), asked.slice(0, 600));
  await setHouse();
  await putAway(b);
});

await test('the judge’s answer is read by its first word — “No — …”, “N”, “✗”, false, 0 fail; a fault on a check answered a plain yes passes, one on a check not answered fails — and a “no” whose words are not in the passage is shown, never counted or written again for', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 9 } });
  const b = await makeBook([['Mara climbed the stair and lit the lamp. The sea below was grey. She waited for the ship.']]);
  const { people: _people, ...checks } = ALL_YES();
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1',
    checks: { ...checks, opening: 'No — it repeats the last line', canon: 'N', shown: '✗', pacing: false, specific: 0, fresh: '❌', sentences: 'No — the rhythm never varies', ending: 'yes — but it sags', moves: 'Yes.' },
    faults: [
      { check: 'opening', words: 'Mara climbed the stair', why: 'told twice' },
      { check: 'canon', words: 'The sea below was grey.', why: 'the notes say blue' },
      { check: 'shown', words: 'words that are nowhere in it', why: 'told' },
      { check: 'ending', words: 'She waited for the ship.', why: 'sags' },
      { check: 'People', words: 'She waited', why: 'nobody wants anything' },
    ] }] }) }]);
  await checker.runCheck(b.novelId);
  const card = checker.suggestions(b.novelId).find((x) => x.item.kind === 'grade');
  const g = card.item.grade;
  assert.deepEqual(g.faults.map((f) => [f.check, Boolean(f.unverified)]), [['opening', false], ['canon', false], ['shown', true], ['pacing', true], ['specific', true], ['fresh', true], ['sentences', true], ['people', false]],
    'each "no" by its first word; "ending" answered yes stands; "people", not answered, fails on its fault; a "no" with no words on the page is shown, not counted');
  assert.equal(g.overall, 7, 'ten checks, three failed that the page bears out');
  assert.equal(card.item.lift, 'Fix what falls short — opening: told twice; true to the book: the notes say blue; people: nobody wants anything.', 'what would lift it, only from what the page bears out');
  assert.deepEqual(checker.gradesOf(b.novelId).fails.map((f) => f.name), ['Opening', 'True to the book', 'People']);
  /* what would lift it, as long as it was written — cut at a word */
  const c = await makeBook([['Mara lit the lamp.']]);
  await reset();
  await script([{ text: JSON.stringify({ edits: [], grades: [{ ...failing(3), lift: 'Slow the moment she lights it and let the wick fight her. '.repeat(40).trim() }] }) }]);
  await checker.runCheck(c.novelId);
  const lift = checker.suggestions(c.novelId).find((x) => x.item.kind === 'grade').item.lift;
  assert.ok(lift.length <= 1200 && lift.endsWith('…') && !lift.includes('undefined'), lift.slice(-60));
  await setHouse();
  await putAway(b);
  await putAway(c);
});

await test('the judge’s head to head is read by the page it names, however it names it — “Page B.”, “a (the first)” — and is told the passages before it the notes have not read, as the checker is', async () => {
  await setHouse({}, { checksFrom: 0 });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([['Mara slept.', { text: 'Mara lit the lamp.', model: 'writer-a', how: 'write', ask }]]);
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  const pid = b.ch().passages[1].id;
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text: 'Mara looked at the lamp for a long time.', model: 'writer-b', how: 'another', ask: { ...ask } })), { now: true });
  /* as in the head to head above: page B the first time, page A the second — writer-a's both times */
  await script([{ text: GRADED_NONE('1.1', '1.2') }, { text: JSON.stringify({ better: 'Page B.', why: 'it acts' }) }, { text: JSON.stringify({ better: 'a (the first)', why: 'it acts' }) }]);
  await checker.runCheck(b.novelId);
  const duel = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((m) => m.includes('Which is the better page'));
  assert.ok(duel.includes('Not in these notes yet: Chapter One, passage 1'), duel.slice(0, 500));
  const g = checker.gradesOf(b.novelId);
  const rec = (m) => { const r = g.models.find((x) => x.model === m) || {}; return [r.win, r.loss, r.tie]; };
  assert.deepEqual([rec('writer-a'), rec('writer-b')], [[1, 0, 0], [0, 1, 0]], 'never read as a tie for how it was written');
  await setHouse();
  await putAway(b);
});

await test('the checker’s answer names a passage however it names it — “Chapter One, passage 1”, “[1.2]”, 3 — and a passage it left ungraded is asked for its grades once more; one whose asking again failed is graded on a later look; one it would not grade is never asked in a loop', async () => {
  assert.deepEqual([checker.refOf(2.1, new Set(['2.1', '2.10'])), checker.refOf(2.1, new Set(['2.10'])), checker.refOf('Chapter Two, passage 3', new Set(['2.3'])), checker.refOf(3, new Set(['1.2', '1.3'])), checker.refOf('3', new Set(['1.3', '2.3']))],
    [null, '2.10', '2.3', '1.3', null], 'a JSON 2.1 is 2.10 only when there is no 2.1 (both there: it names neither for sure); a bare number names a passage only when one chapter has it');
  await setHouse({}, { checksFrom: 0, judge: { target: 9 } });
  const b = await makeBook([['Mara climbed the the stair.', 'Tom came up the the path.', 'The sea was grey and and cold.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: 'Chapter One, passage 1', kind: 'grammar', find: 'the the stair', replace: 'the stair', why: 'doubled' },
    { passage: '[1.2]', kind: 'grammar', find: 'the the path', replace: 'the path', why: 'doubled' },
    { passage: 3, kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' },
  ], grades: [{ passage: 1.1, checks: ALL_YES(), faults: [] }] }) },
  { text: JSON.stringify({ grades: [{ passage: '1.2', checks: ALL_YES(), faults: [] }, { passage: '1.3', checks: ALL_YES(), faults: [] }] }) }]);
  await checker.runCheck(b.novelId);
  const asks = await checkAsk();
  assert.equal(asks.length, 2, 'asked once more, for the grades alone');
  assert.ok(checkedPart(asks[1]).includes('[1.2] Tom came') && checkedPart(asks[1]).includes('[1.3] The sea') && !checkedPart(asks[1]).includes('[1.1]'), 'only the passages left ungraded');
  assert.ok(!asks[1].includes('Suggest only what is worth changing'), 'no fixes asked for again');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => [x.number, x.item.find]), [[1, 'the the stair'], [2, 'the the path'], [3, 'and and']]);
  assert.equal(checker.gradesOf(b.novelId).rows.length, 3, 'every passage graded');
  /* its asking again stopped by a fault: graded on a later look */
  const c = await makeBook([['Mara kept the light.']]);
  await reset();
  await script([CK_NONE, { text: 'Not JSON at all.' }, { text: 'Still not.' }]);
  await checker.runCheck(c.novelId);
  assert.equal(checker.gradesOf(c.novelId).rows.length, 0);
  assert.equal(checker.waiting(c.novelId), 1, 'still to be graded');
  await reset();
  await checker.runCheck(c.novelId);
  assert.equal(checker.gradesOf(c.novelId).rows.length, 1, 'graded on the later look');
  assert.equal(checker.waiting(c.novelId), 0);
  /* answered, and still no grade: its model will not grade it — checked, never asked in a loop */
  const d = await makeBook([['Mara kept the light.']]);
  await reset();
  await script([CK_NONE, { text: '{"grades": []}' }]);
  await checker.runCheck(d.novelId);
  assert.deepEqual([checker.waiting(d.novelId), checker.stateOf(d.novelId).state, (await requests()).length], [0, 'clean', 2]);
  await setHouse();
  await putAway(b);
  await putAway(c);
  await putAway(d);
});

await test('the chapters before that its room leaves out are said to the checker — never left out without a word', async () => {
  await setHouse({ context: 16000 }, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook(Array.from({ length: 6 }, (_, i) => [`The words of chapter ${i + 1}.`]));
  for (let i = 0; i < 5; i++) store.change('chapter', b.ids[i], shape.chapterSteps.setSummary({ text: `SUMMARY ${i + 1}: ${'The sea rose and fell all night. '.repeat(120).trim()}`, fp: shape.chapterPrint(b.ch(i)) }), { now: true });
  await checker.runCheck(b.novelId);
  const six = (await checkAsk()).find((a) => a.includes('Check these passages from Chapter Six'));
  const shown = [1, 2, 3, 4, 5].filter((n) => six.includes(`SUMMARY ${n}:`));
  assert.ok(shown.length >= 1 && shown.length < 5 && shown.every((n, i) => n === 5 - shown.length + 1 + i), `the nearest chapters (${shown})`);
  const left = 5 - shown.length;
  const said = left === 1 ? 'The first chapter is left out here to save room' : `The first ${util.numberWords(left).toLowerCase()} chapters are left out here to save room`;
  assert.ok(six.includes(said), six.slice(six.indexOf('The story so far'), six.indexOf('The story so far') + 300));
  await setHouse();
  await putAway(b);
});

await test('what he asked the writer for reaches the checker whole — a very long ask cut at a word, and said', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const mid = 'She climbs the tower slowly, counting every step. '.repeat(40).trim();
  const long = 'Mara waits at the window for the ship and does not sleep. '.repeat(120).trim();
  const b = await makeBook([[{ text: 'Mara climbed the stair.', ask: { direction: mid, length: 'scene' } }, { text: 'Mara waited.', ask: { direction: long, length: 'scene' } }]]);
  await script([CK_NONE]);
  await checker.runCheck(b.novelId);
  const [asked] = await checkAsk();
  assert.ok(asked.includes(`[1.1] ${mid}`), 'a long ask whole (2.5.0 cut it at 400 characters, without a word)');
  const at = asked.indexOf('[1.2] ');
  const end = asked.indexOf(' (the rest of what I asked is left out here to save room)');
  assert.ok(at > 0 && end > at, 'a very long one cut, and said');
  const cut = asked.slice(at + 6, end);
  assert.ok(cut.length <= prompts.ASK_ROOM && cut.endsWith('…') && long.startsWith(cut.slice(0, -1).trim()), cut.slice(-50));
  await setHouse();
  await putAway(b);
});

await test('a passage written again by itself that fails for a real reason is never tried by itself again — kept on the version, said on its grade', async () => {
  const on = { on: true, from: Date.now() - 1000 };
  await setHouse({}, { checksFrom: 0, judge: { target: 9 }, autoLift: on });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'Mara lit the lamp and waited.', model: 'scripted', how: 'write', ask }]]);
  const refused = { status: 400, message: 'Invalid request: the prompt was refused' };
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(3)] }) }, refused, refused, refused]);
  await checker.runCheck(b.novelId);
  const out = await checker.forTests().lifting.get(b.novelId);
  assert.equal(out && out.ok, false);
  const p = b.ch().passages[0];
  assert.equal(p.versions.length, 1, 'the page as it was');
  const v = picked(p);
  assert.ok(v.liftFailed && v.liftFailed.why && Number.isFinite(v.liftFailed.at), JSON.stringify(v.liftFailed));
  const card = checker.suggestions(b.novelId).find((x) => x.item.kind === 'grade');
  assert.equal(card.item.liftFailed.why, v.liftFailed.why, 'said on its grade');
  /* never by itself again — kept on the version, past this page's own memory of what it tried (a reload forgets that) */
  await reset();
  checker.forTests().liftTried.clear();
  checker.forTests().autoAfter(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0);
  assert.equal((await requests()).length, 0);
  await setHouse();
  await putAway(b);
});

await test('a new page that stopped partway is said to wait for its Go on — never called older writing checked only when he asks', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['A whole page.', { text: 'A page cut short in the middle of', cut: true, cutWhy: 'it reached the reply length' }]]);
  await script([CK_NONE]);
  await checker.runCheck(b.novelId);
  const st = checker.stateOf(b.novelId);
  assert.equal(st.state, 'clean');
  assert.match(st.words, /A passage that stopped partway is checked once Go on finishes it\./);
  assert.doesNotMatch(st.words, /older passage/);
  /* (2.6.3: it says too how many are checked but not graded — none: the judge is off) */
  assert.deepEqual(checker.unchecked(b.novelId), { passages: 0, words: 0, ungraded: 0 });
  await setHouse();
  await putAway(b);
});

await test('a fix put in by itself is measured by the words it changes — a comma mended in each of two short paragraphs goes in; a paragraph written anew waits', async () => {
  assert.ok(checker.changeShare('Mara climbed the the stair.', 'Mara climbed the stair.') < 0.25);
  assert.equal(checker.smallMend('Mara climbed the stair slowly.\nThe sea was grey.', 'Mara climbed the stair slowly.\nWaves broke white on the black rock.'), false, 'a paragraph written anew');
  const on = { on: true, from: Date.now() - 1000 };
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: on });
  const b = await makeBook([['Mara climbed the stair she was tired.\nTom waited below he was cold.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'stair she', replace: 'stair; she', why: 'two sentences' },
    { passage: '1.1', kind: 'grammar', find: 'below he', replace: 'below; he', why: 'two sentences' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.hands], ['Mara climbed the stair; she was tired.\nTom waited below; he was cold.', ['checker']], 'put in by itself (2.5.0, by lines: “half the passage rewritten”, never) — on the page itself (2.12.2)');
  await setHouse();
  await putAway(b);
});

await test('Suggestions follow his settings as they stand now: a word taken off his list is no longer offered, and a grade is under his mark only while it is under the mark he has now', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 9 }, ...HIS({ avoid: 'tar' }) });
  const b = await makeBook([['The rope smelled of tar. Mara lit the lamp.']]);
  await script([{ text: JSON.stringify({ edits: [], grades: [failing(2)] }) }]);
  await checker.runCheck(b.novelId);
  let s = checker.suggestions(b.novelId);
  assert.deepEqual(s.map((x) => [x.item.kind, x.item.target]).sort(), [['avoid', undefined], ['grade', 9]]);
  await setHouse({}, { checksFrom: 0, judge: { target: 8.5 }, ...HIS({ avoid: '' }) });
  s = checker.suggestions(b.novelId);
  assert.deepEqual(s.map((x) => [x.item.kind, x.item.target]), [['grade', 8.5]], 'the word is off his list; the 8 is under his 8.5');
  await setHouse({}, { checksFrom: 0, judge: { target: 7 } });
  assert.deepEqual(checker.suggestions(b.novelId), [], 'an 8 is not under a 7');
  assert.equal(checker.stateOf(b.novelId).state, 'clean');
  await setHouse();
  await putAway(b);
});

await test('a character of another script standing loose on an English page goes to the checker to be mended, fails “sentences”, and is offered to be written again when no fix takes it out — never inside quotes', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 9 } });
  const page = `Mara climbed the long stair of the lighthouse, counting each step as the wind pulled at the old 틀 door below. ${'The sea was grey and the gulls were loud over the rocks, and she did not look down. '.repeat(3)}“안녕,” the stranger said at the top.`;
  const b = await makeBook([[page]]);
  await script([{ text: GRADED_NONE('1.1') }]);
  await checker.runCheck(b.novelId);
  const [asked] = await checkAsk();
  assert.ok(asked.includes('A stray character of another script stands in these passages, among words in the Latin alphabet') && asked.includes('the old 틀 door'), asked.slice(asked.indexOf('A stray character'), asked.indexOf('A stray character') + 300));
  assert.ok(!asked.includes('…안녕'), 'a line spoken in another language stays');
  const stray = checker.suggestions(b.novelId).find((x) => x.item.stray);
  assert.ok(stray && stray.item.find.includes('the old 틀 door') && stray.item.replace === null, JSON.stringify(stray && stray.item));
  const g = checker.gradesOf(b.novelId).rows[0];
  assert.deepEqual([g.overall, g.faults.map((f) => [f.check, Boolean(f.counted)])], [9, [['sentences', true]]]);
  await setHouse();
  await putAway(b);
});

await test('stock wording inside single quotes is someone speaking, not the telling — never counted; an apostrophe in the telling opens no quote; and a kind his ask names, in quotes or not, is his', () => {
  assert.deepEqual(stock.stockIn('‘Her voice barely above a whisper,’ he said.'), []);
  assert.deepEqual(stock.stockIn("'Her voice barely above a whisper,' he said."), []);
  assert.deepEqual(stock.stockIn("Mara's voice barely above a whisper. Tom's heart hammered against his ribs.").map((h) => h.words), ['voice barely above a whisper', 'heart hammered against his ribs']);
  const page = 'Mara climbed the stair, her voice barely above a whisper. Her heart hammered against her ribs.';
  assert.deepEqual(stock.stockIn(page, { not: 'Have her say it with her voice barely above a whisper.' }).map((h) => h.words), ['heart hammered against her ribs']);
  assert.deepEqual(stock.stockIn(page, { not: 'Use “her voice barely above a whisper” here.' }).map((h) => h.words), ['heart hammered against her ribs'], 'named in quotes');
});

await test('stock wording his own ask called for is never counted against the passage — not sent, not offered, not failed', async () => {
  await setHouse({}, { checksFrom: 0, judge: { target: 9 } });
  const b = await makeBook([[{ text: 'Mara climbed the stair, her voice barely above a whisper.', ask: { direction: 'Have her speak with her voice barely above a whisper.', length: 'scene' } }]]);
  await script([{ text: GRADED_NONE('1.1') }]);
  await checker.runCheck(b.novelId);
  const [asked] = await checkAsk();
  assert.ok(!asked.includes('Stock wording counted in these passages'));
  assert.deepEqual(checker.suggestions(b.novelId), []);
  const g = checker.gradesOf(b.novelId);
  assert.deepEqual([g.rows[0].overall, g.models[0].stock], [10, 0]);
  await setHouse();
  await putAway(b);
});

await test('a passage moved to a new chapter while it was checked: what came back lands where it stands now; a chapter taken out meanwhile takes nothing', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara climbed the the stair.', 'Tom came up the the path.']]);
  const [p1, p2] = b.ch().passages;
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the stair', replace: 'the stair', why: 'doubled' },
    { passage: '1.2', kind: 'grammar', find: 'the the path', replace: 'the path', why: 'doubled' }] }), delay: 0.15 }]);
  const running = checker.runCheck(b.novelId);
  for (let i = 0; i < 100 && !(await checkAsk()).length; i++) await sleep(20);
  /* A new chapter from here, as the page makes it */
  const c = b.ch();
  const moving = JSON.parse(JSON.stringify(c.passages.slice(1)));
  const fresh = shape.newChapter(b.novelId);
  fresh.passages = moving;
  Object.assign(fresh, shape.keptFor(c, moving.map((m) => m.id)));
  await store.create('chapter', fresh.id, fresh);
  store.change('novel', b.novelId, shape.novelSteps.addChapter(fresh.id, c.id), { now: true });
  store.change('chapter', c.id, shape.chapterSteps.cutFrom(p2.id), { now: true });
  await running;
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => [x.chapterId, x.passageId, x.item.find]), [[b.ids[0], p1.id, 'the the stair'], [fresh.id, p2.id, 'the the path']]);
  /* a chapter taken out while its passages are checked: nothing lands, nothing breaks */
  const d = await makeBook([['Mara slept.'], ['Tom came up the the path.']]);
  await reset();
  await script([CK_NONE, { text: JSON.stringify({ edits: [{ passage: '2.1', kind: 'grammar', find: 'the the path', replace: 'the path', why: 'doubled' }] }), delay: 0.15 }]);
  const run2 = checker.runCheck(d.novelId);
  for (let i = 0; i < 100 && (await checkAsk()).length < 2; i++) await sleep(20);
  store.change('novel', d.novelId, shape.novelSteps.removeChapter(d.ids[1]), { now: true });
  await run2;
  assert.deepEqual(checker.suggestions(d.novelId), []);
  assert.notEqual(checker.stateOf(d.novelId).state, 'trouble');
  await setHouse();
  await putAway(b);
  await putAway(d);
});

await test('a passage taken out and put back with Undo brings back what the checker found, what he left and the head to head — a version too; what was kept aside goes after two days', () => {
  const v1 = { id: 'v1', text: 'Mara climbed the the stair.' };
  const v2 = { id: 'v2', text: 'Mara climbed.' };
  const c = { passages: [{ id: 'p1', by: 'ai', pick: 0, versions: [v1, v2] }, { id: 'p2', by: 'ai', pick: 0, versions: [{ id: 'w1', text: 'Tom.' }] }] };
  const found = { round: 'r', sig: util.hashText(v1.text), at: 1, items: [{ id: 's1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }] };
  shape.chapterSteps.setCheck('p1', 'v1', found)(c);
  shape.chapterSteps.setCheck('p1', 'v1', { ...found, items: [...found.items, { id: 's2', kind: 'humanize', find: 'climbed', replace: 'went', why: 'x' }] })(c);
  shape.chapterSteps.dropSuggestion('p1', 'v1', 's2', { remember: true })(c);
  shape.chapterSteps.setDuel('p1:v1|v2', { pid: 'p1', x: 'v1', y: 'v2', xModel: 'a', yModel: 'b', winner: 'x', at: 1 })(c);
  const passage = JSON.parse(JSON.stringify(c.passages[0]));
  const now = Date.now();
  /* taken out: what was kept for it goes aside */
  shape.chapterSteps.removePassage('p1')(c);
  shape.chapterSteps.pruneChecks(now)(c);
  assert.deepEqual([c.checks, c.checksLeft, c.duels], [{}, {}, {}]);
  /* Undo */
  shape.chapterSteps.addPassage(passage, '^')(c);
  assert.deepEqual(c.checks.p1.v1.items.map((x) => x.id), ['s1'], 'what it found');
  assert.deepEqual(c.checksLeft.p1, [{ find: 'climbed', replace: 'went' }], 'what he left');
  assert.deepEqual(Object.keys(c.duels), ['p1:v1|v2'], 'the head to head');
  assert.equal(c.checksGone.p1, undefined);
  /* a version taken out and put back */
  shape.chapterSteps.removeVersion('p1', 'v2')(c);
  shape.chapterSteps.pruneChecks(now)(c);
  assert.deepEqual(c.duels, {});
  shape.chapterSteps.putVersionsBack('p1', [v1, v2], 'v1')(c);
  assert.deepEqual(Object.keys(c.duels), ['p1:v1|v2']);
  /* aside past two days: gone */
  shape.chapterSteps.removePassage('p1')(c);
  shape.chapterSteps.pruneChecks(now)(c);
  assert.ok(c.checksGone.p1);
  shape.chapterSteps.pruneChecks(now + 3 * 86400000)(c);
  assert.equal(c.checksGone.p1, undefined);
});

await test('fixes put in by themselves never hold the page to the notes — a continuity fix waits for him — and a passage under his mark only for being untrue to the book is never written again by itself', async () => {
  const on = { on: true, from: Date.now() - 1000 };
  await setHouse({}, { checksFrom: 0, judge: { target: 10 }, autoFix: on, autoLift: on });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'Mara lit the green lamp and and waited.', model: 'scripted', how: 'write', ask }]]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'continuity', find: 'green lamp', replace: 'red lamp', why: 'the notes say red' },
    { passage: '1.1', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' },
  ], grades: [{ passage: '1.1', checks: { ...ALL_YES(), canon: 'no' }, faults: [{ check: 'canon', words: 'the green lamp', why: 'the notes say red' }], lift: 'Make the lamp red.' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.forTests().lifting.size, 0, 'not written again for the notes’ sake');
  const v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.hands], ['Mara lit the green lamp and waited.', ['checker']], 'the grammar went in by itself, on the page; the continuity fix did not');
  const cont = checker.suggestions(b.novelId).find((x) => x.item.kind === 'continuity' && x.item.replace === 'red lamp');
  assert.ok(cont, 'it waits for him');
  assert.equal(checker.waitsWhy(cont.chapterId, cont.passageId, cont.item), 'it holds the page to the notes, and the notes may be what is wrong', 'and says why');
  await setHouse();
  await putAway(b);
});

/* his report, 2.12.20: "Tense slip: the sentence is in past tense … Not put in by itself: it holds the page to the notes"
 * with Apply the checker's fixes by themselves on — the checker was told to file a slip of the book's tense under
 * continuity, and every continuity fix waited for him */
await test('a fix that only puts a verb back in the book’s tense goes in by itself, even filed under continuity — one already waiting goes in at the next look — and a fact held to the notes still waits', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara lit the green lamp, which is the way she always did it. Then she waits by the door.']]);
  await reset();
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'continuity', find: 'which is the way she always did it', replace: 'which was the way she always did it', why: 'Tense slip: the sentence is in past tense.' },
    { passage: '1.1', kind: 'continuity', find: 'she waits by', replace: 'she waited by', why: 'Tense slip.' },
    { passage: '1.1', kind: 'continuity', find: 'green lamp', replace: 'red lamp', why: 'the notes say red' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const asked = (await requests()).map((x) => x.body.messages.map((m) => String(m.content || '')).join('\n')).find((m) => m.includes('Check these passages from'));
  assert.ok(asked && /"grammar": [^\n]*a tense slip, inside a sentence or from the tense the book is told in; a slip from the point of view the book is told in/.test(asked), 'the checker is told a slip of the book’s tense is grammar');
  assert.ok(!/"continuity": [^\n]*tense/.test(asked), 'and continuity is facts alone');
  const waiting = checker.suggestions(b.novelId);
  assert.equal(waiting.length, 3, 'with nothing by itself, all three wait');
  assert.equal(picked(b.ch().passages[0]).text, 'Mara lit the green lamp, which is the way she always did it. Then she waits by the door.');
  /* he switches it on: the tense goes in at the next look, with nothing new to check — the lamp waits */
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 } });
  const tense = waiting.find((x) => x.item.replace.startsWith('which was'));
  assert.equal(checker.waitsWhy(tense.chapterId, tense.passageId, tense.item), '', 'the card says nothing holds it back');
  await checker.runCheck(b.novelId);
  const v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.hands], ['Mara lit the green lamp, which was the way she always did it. Then she waited by the door.', ['checker']], 'both tense fixes went in by themselves, on the page');
  const left = checker.suggestions(b.novelId);
  assert.deepEqual(left.map((x) => x.item.replace), ['red lamp'], 'the lamp the notes call red still waits');
  assert.equal(checker.waitsWhy(left[0].chapterId, left[0].passageId, left[0].item), 'it holds the page to the notes, and the notes may be what is wrong');
  /* what is read as a change of tense alone, and what is not */
  const t = checker.tenseOnly;
  assert.deepEqual([t('which is the way', 'which was the way'), t('She walks in', 'She walked in'), t('he moves', 'he moved'), t('it tries', 'it tried'),
    t('they don’t know', 'they didn’t know'), t('She was here.', 'She is here.')], [true, true, true, true, true, true], 'a verb moved between present and past');
  assert.deepEqual([t('green lamp', 'red lamp'), t('Mara is', 'Tom was'), t('the wan light', 'the wand light'), t('he is', 'he is'), t('is', 'was there')],
    [false, false, false, false, false], 'a word that is not a verb’s tense, a name, a new word, nothing changed, more words — never');
  await setHouse();
  await putAway(b);
});

/* (a fix that came meanwhile was a version one arrow back through 2.12.1 — since 2.12.2 it is on the page itself, and his
 * edit over it keeps it among the words before) */
await test('his edit is made on the version his box was opened on — a fix that came meanwhile is kept among the words before — and nothing goes in by itself under his open box', async () => {
  const on = { on: true, from: Date.now() - 1000 };
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: on });
  const b = await makeBook([['Mara climbed the the stair.', 'Tom came up the the path.']]);
  const p = (i) => b.ch().passages[i];
  const opened = picked(p(0)).id;
  checker.setEditing(p(0).id, true);
  checker.setEditing(p(1).id, true);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' },
    { passage: '1.2', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.deepEqual([p(0).versions.length, p(1).versions.length], [1, 1], 'nothing goes in by itself under his open box');
  assert.equal(checker.suggestions(b.novelId).length, 2, 'the fixes wait behind the bubble');
  /* meanwhile a version comes (Apply from Suggestions in another window, his partner) */
  const s = checker.suggestions(b.novelId).find((x) => x.passageId === p(0).id);
  checker.applyOne(b.novelId, s.chapterId, s.passageId, s.item.id);
  assert.deepEqual([p(0).versions.length, picked(p(0)).text], [1, 'Mara climbed the stair.']);
  /* a Save with nothing changed in the box takes nothing away that came meanwhile */
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p(0).id, text: 'Mara climbed the the stair.', fromId: opened, opened: 'Mara climbed the the stair.' }), false);
  assert.equal(picked(p(0)).text, 'Mara climbed the stair.');
  /* his Save: on the version he opened — the fix that came meanwhile among the words before */
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p(0).id, text: 'Mara climbed the the old stair.', fromId: opened, opened: 'Mara climbed the the stair.' }), true);
  checker.setEditing(p(0).id, false);
  assert.deepEqual([p(0).versions.length, picked(p(0)).id, picked(p(0)).text, picked(p(0)).before.map((x) => [x.text, x.by])],
    [1, opened, 'Mara climbed the the old stair.', [['Mara climbed the the stair.', 'checker'], ['Mara climbed the stair.', 'you']]]);
  /* the other box closed without a change: what waited for it goes in */
  checker.setEditing(p(1).id, false);
  checker.forTests().autoAfter(b.novelId);
  assert.deepEqual([picked(p(1)).text, picked(p(1)).hands], ['Tom came up the path.', ['checker']]);
  await setHouse();
  await putAway(b);
});

await test('a passage set aside by one connection’s model is checked afresh, by itself, once the checker’s connection changes', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']]);
  for (let i = 0; i < 2; i++) { await reset(); await script([CK_SORRY, CK_SORRY]); await checker.runCheck(b.novelId); hush(b.novelId); }
  assert.equal(checker.setAsideList(b.novelId).length, 1);
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'the same connection: not asked again');
  await setHouse({ model: 'another-model' }, { checksFrom: 0, judge: { on: false } });
  await script([CK_NONE]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.setAsideList(b.novelId).length, 0);
  assert.equal((await checkAsk()).length, 1, 'checked afresh');
  await setHouse();
  await putAway(b);
});

/* =================================================== the page: what the second sweep found */
heading('the page: what the second sweep found');

await test('a version that goes unkept gives back the one he was on — Another take that brings nothing, Stop before a word, a scene’s answer the same — never simply the newest', async () => {
  const b = await makeBook([['Mara lit the lamp.']], { manual: true });
  const pid = b.ch().passages[0].id;
  const take = (text) => store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text, how: 'another', ask: { direction: '', length: 'scene' } })), { now: true });
  take('Mara lit the second lamp.');
  take('Mara lit the third lamp.');
  const [v1] = b.ch().passages[0].versions;
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(pid, v1.id), { now: true });
  /* Another take, and nothing comes */
  await script([{ text: '' }, { text: '' }]);
  const out = await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid });
  assert.equal(out.ok, false);
  assert.deepEqual([b.ch().passages[0].versions.length, picked(b.ch().passages[0]).id], [3, v1.id], 'the take he was on, on show again (2.5.0: the newest)');
  /* the same for a scene's answer taken away */
  const d = { turns: [{ id: 't1', by: 'ai', pick: 0, versions: [{ id: 'a', text: 'One.' }, { id: 'b', text: 'Two.' }] }] };
  shape.turnSteps.addVersion('t1', shape.newVersion({ text: '', streaming: true }))(d);
  const fresh = d.turns[0].versions[2].id;
  assert.equal(d.turns[0].versions[2].was, 'a', 'it knows the answer on show when it came');
  shape.turnSteps.removeVersion('t1', fresh)(d);
  assert.equal(picked(d.turns[0]).id, 'a');
  await putAway(b);
});

await test('what was taken off a page stays with a version made from it in place — a fix applied, his partner’s words, a few words written again, his edit that keeps its end — so Put back still brings it back, with the fix', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([[{ text: `${story200} The the lamp burned.`, tookOff: 'Would you like me to continue?' }]], { manual: true });
  const pid = b.ch().passages[0].id;
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'The the lamp', replace: 'The lamp', why: 'doubled' }] }) }]);
  await checker.runCheck(b.novelId);
  const s = checker.suggestions(b.novelId)[0];
  assert.equal(checker.applyOne(b.novelId, s.chapterId, s.passageId, s.item.id).ok, true);
  let v = picked(b.ch().passages[0]);
  assert.deepEqual([v.hands, v.tookOff, b.ch().passages[0].versions.length], [['checker'], 'Would you like me to continue?', 1], 'the fix, on the page itself, keeps what came off');
  assert.equal(writer.putBackTail({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid }), true);
  v = picked(b.ch().passages[0]);
  assert.equal(v.text, `${story200} The lamp burned.\n\nWould you like me to continue?`, 'put back: the fixed words and what came off');
  /* his partner's words changed in place */
  const c = await makeBook([[{ text: `${story200} Rain hammered the glass.`, tookOff: 'TAIL' }]], { manual: true });
  const made = changes.makeChange(c.novelId, { passage: '1.1', find: 'Rain hammered', replace: 'Rain lashed', why: 'harder' });
  assert.equal((made || {}).status, 'made', JSON.stringify(made));
  assert.equal(picked(c.ch().passages[0]).tookOff, 'TAIL');
  /* his edit that keeps the page's end; one that changes its end lets it go */
  const cp = c.ch().passages[0].id;
  writer.saveEdit({ novelId: c.novelId, chapterId: c.ids[0], passageId: cp, text: `Snow. ${picked(c.ch().passages[0]).text}` });
  assert.equal(picked(c.ch().passages[0]).tookOff, 'TAIL', 'the same end: kept');
  writer.saveEdit({ novelId: c.novelId, chapterId: c.ids[0], passageId: cp, text: 'A page he wrote anew, end and all.' });
  assert.equal(picked(c.ch().passages[0]).tookOff, undefined, 'a new end: it is his page now');
  /* a few words written again keep their passage's */
  const e = await makeBook([[{ text: story200, tookOff: 'TAIL', tookOffTop: '# Chapter One' }]], { manual: true });
  await script([{ text: 'all night long' }]);
  const ep = e.ch().passages[0].id;
  await writer.rewriteSelection({ novelId: e.novelId, chapterId: e.ids[0], passageId: ep, start: story200.indexOf('all night'), end: story200.indexOf('all night') + 'all night'.length, note: 'longer' });
  v = picked(e.ch().passages[0]);
  assert.deepEqual([v.how, v.tookOff, v.tookOffTop], ['selection', 'TAIL', '# Chapter One']);
  await setHouse();
  await putAway(b);
  await putAway(c);
  await putAway(e);
});

await test('a narrator’s own question at a page’s end is story — “How do you forgive a man who never asked to be forgiven?” — while a note’s question still comes off', () => {
  for (const q of ['How do you forgive a man who never asked to be forgiven?', 'What do you say to a mother who has buried her son?', 'Where do you go when there is nowhere left to go?', 'What do you do when the next storm comes?']) {
    assert.equal(textshape.finishTail(`${story200}\n\n${q}`).removed, '', q);
  }
  for (const q of ['What will you do?', 'What do you want to happen next?', 'How would you like to proceed?', 'Would you like me to continue?', 'Where would you like the story to go next?', 'What should happen in the next scene, do you think?']) {
    assert.equal(textshape.finishTail(`${story200}\n\n${q}`).removed, q, q);
  }
});

await test('a soft wrap is joined, but a book’s own line breaks are kept — a letter, verse set in, a run of short lines', () => {
  const letter = 'She read it twice.\n\nDear Kara,\nyou were right about the river,\nand wrong about me.\n\nShe folded it.';
  assert.equal(textshape.joinSoftWraps(letter), letter, 'a letter');
  const song = 'He sang.\n\n    the river runs, the river bends,\n    the river never meets its ends.\n\nThen silence.';
  assert.equal(textshape.joinSoftWraps(song), song, 'verse set in');
  const list = 'She wrote it down.\n\nsalt for the lamp,\noil for the wick,\nbread for the road\n\nAnd went.';
  assert.equal(textshape.joinSoftWraps(list), list, 'a run of short lines');
  assert.equal(textshape.joinSoftWraps('She walked\ninto the rain.\n\nThe door shut.'), 'She walked into the rain.\n\nThe door shut.', 'a wrap is joined');
  const wrapped = 'Mara climbed the long stair to the lamp room, where the wind\nhammered at the glass and the old lamp ticked as it cooled in the dark,\nand she stood there a long while, listening.\n\nNext.';
  assert.equal(textshape.joinSoftWraps(wrapped), 'Mara climbed the long stair to the lamp room, where the wind hammered at the glass and the old lamp ticked as it cooled in the dark, and she stood there a long while, listening.\n\nNext.');
});

await test('a heading above a new page is taken off and kept — said, and Put back puts it back at the top; never a line of story, a time line in bold, or a heading in what Go on carries on', async () => {
  const b = await makeBook([[]], { manual: true });
  await script([{ text: `# Chapter Three: The Storm\n\n${story200}` }, { text: `**Three days later.**\n\n${story200}` }, { text: `\n\n## The Scene\n\n${story200}` }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.tookOffTop], [story200, '# Chapter Three: The Storm']);
  assert.ok((v.notes || []).some((n) => n.includes('A heading the writer put above the page was taken off')), JSON.stringify(v.notes));
  assert.equal(writer.putBackTail({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id }), true);
  v = picked(b.ch().passages[0]);
  assert.equal(v.text, `# Chapter Three: The Storm\n\n${story200}`, 'back at the top');
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(picked(b.ch().passages[1]).text.startsWith('**Three days later.**'), 'a line of the story in bold stays');
  /* Go on: what it carries on is never a page's top */
  store.change('chapter', b.ids[0], shape.chapterSteps.setVersion(b.ch().passages[1].id, picked(b.ch().passages[1]).id, { cut: true, cutWhy: 'it reached the reply length' }), { now: true });
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[1].id });
  v = picked(b.ch().passages[1]);
  assert.ok(v.text.includes('## The Scene') && !v.tookOffTop, v.text.slice(0, 300));
  assert.equal(textshape.dropHeading(`Chapter three of her life began the day she left.\n\n${story200}`).removed, '', 'a sentence that begins with "Chapter"');
  assert.equal(textshape.dropHeading(`The Storm\n\n${story200}`, { names: ['The Storm'] }).removed, 'The Storm', 'the chapter’s own name');
  await putAway(b);
});

await test('a stray of another script standing loose on a new page is said under it — the checker offers the mend, or Edit takes it out', async () => {
  await setHouse({}, { judge: { on: false } });
  const b = await makeBook([[]], { manual: true });
  const page = `${story200} The old 틀 door banged below.`;
  await script([{ text: page }, { text: page }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const said = (picked(b.ch().passages[0]).notes || []).find((n) => n.includes('A stray character of another script stands in it'));
  assert.ok(said && said.includes('old 틀 door') && said.includes('the checker offers to mend it'), said);
  await setHouse({}, { roles: { writer: 'c-w', checker: 'off' } });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const alone = (picked(b.ch().passages[1]).notes || []).find((n) => n.includes('A stray character of another script stands in it'));
  assert.ok(alone && alone.endsWith('— Edit takes it out.'), alone);
  await setHouse();
  await putAway(b);
});

await test('markup of a web page or code left in the story (“…paid for.</code>”, his report) comes off a new page, a Go on’s new words, a passage the partner writes anew and its new words, and the narrator’s telling — said each time; a page kept from before loses it once when the book opens; in his own words the checker offers the sentence without it; a game’s window and a heart stay', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const end = 'Row twenty leans forward because the real estate of forgiveness is priced in intangibles, the price of things that nobody has but everybody paid for.';
  const b = await makeBook([[{ text: `${story200} He kept the lamp lit.`, how: 'mine' }]], { manual: true });
  await script([
    { text: `${story200}\n\n${end}</code>` },
    { text: ' She said <em>nothing</em> &mdash; then left.<br>The door shut.' },
    { text: `${story200} A window opened: <Level Up!> and <Skill: Fireball>. She typed <3 back.` },
  ]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let v = picked(b.ch().passages[1]);
  assert.equal(v.text, `${story200}\n\n${end}`);
  assert.ok((v.notes || []).includes('Web page or code markup the writer left in the story (“</code>”) was taken off.'), JSON.stringify(v.notes));
  /* Go on: only the new words */
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[1].id });
  v = picked(b.ch().passages[1]);
  assert.equal(v.text, `${story200}\n\n${end} She said *nothing* — then left.\nThe door shut.`);
  /* a game's window, a heart: the story */
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  v = picked(b.ch().passages[2]);
  assert.equal(v.text, `${story200} A window opened: <Level Up!> and <Skill: Fireball>. She typed <3 back.`);
  assert.ok(!(v.notes || []).some((n) => n.includes('markup')), JSON.stringify(v.notes));
  /* the partner: a passage written anew, and new words for some */
  let made = changes.makeChange(b.novelId, { passage: '1.3', text: 'Mara <span style="color:red">ran</span>.</span>&nbsp;She was gone.\n```' });
  assert.equal(made.status, 'made', made.said);
  assert.equal(picked(b.ch().passages[2]).text, 'Mara <span style="color:red">ran</span>. She was gone.', 'HTML the page carries, opened and closed, stays; what stands loose goes');
  assert.ok(made.said.includes('web page or code markup taken off'), made.said);
  made = changes.makeChange(b.novelId, { passage: '1.1', find: 'kept the lamp lit', replace: 'kept the <b>lamp</b> lit' });
  assert.equal(made.status, 'made', made.said);
  assert.ok(picked(b.ch().passages[0]).text.endsWith('He kept the **lamp** lit.'), picked(b.ch().passages[0]).text.slice(-40));
  /* the narrator's telling */
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mina' });
  await script([{ text: 'Mina said, “Come.”</p>\n<p>The gate creaks.' }]);
  await talk.playSay({ playId: id, text: '' });
  const told = store.peek('play', id).turns.at(-1);
  assert.equal(picked(told).text, 'Mina said, “Come.”\n\nThe gate creaks.');
  await putAway(b);

  /* a book from before: its writer's page mended once, his own words never touched by the mend — the checker offers the sentence */
  const old = await makeBook([[`${story200}\n\n${end}</code>`, { text: `${story200} He paid.</code>`, how: 'mine' }]], { manual: true });
  store.change('novel', old.novelId, shape.novelSteps.setMemory({ mended: 2 }), { now: true });
  markAllSeen(old);
  assert.deepEqual(await mend.mendBook(old.novelId), { pages: 1, tellings: 0, versions: 0 });
  assert.equal(picked(old.ch().passages[0]).text, `${story200}\n\n${end}`);
  assert.equal(picked(old.ch().passages[1]).text, `${story200} He paid.</code>`, 'his own words, as he wrote them');
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  await checker.runCheck(old.novelId);
  const offered = checker.suggestions(old.novelId).filter((x) => x.item.markup);
  assert.deepEqual(offered.map((x) => [x.item.find, x.item.replace, x.item.why]), [['He paid.</code>', 'He paid.', 'web page or code markup (“</code>”) stands in the story']]);
  await setHouse();
  await putAway(old);
});

await test('the oldest chapters left out of the writer’s room even as summaries are said under the page and the partner’s answer — never a silent cut', async () => {
  await setHouse({ context: 12000 }, CRAFTS_OFF);
  /* chapters too long to go whole, their summaries too many to go all */
  const b = await makeBook([...Array.from({ length: 7 }, (_, i) => [`Chapter ${i + 1}. ${'The sea rose and fell all night over the black rocks. '.repeat(250).trim()}`]), []], { manual: true });
  for (let i = 0; i < 7; i++) store.change('chapter', b.ids[i], shape.chapterSteps.setSummary({ text: `SUMMARY ${i + 1}: ${'The keeper watched the sea rise and fall over the black rocks. '.repeat(55).trim()}`, fp: shape.chapterPrint(b.ch(i)) }), { now: true });
  await script([{ text: 'A page.' }, { text: 'An answer.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[7] });
  const asked = JSON.stringify((await requests())[0].body.messages);
  const shown = [1, 2, 3, 4, 5, 6, 7].filter((n) => asked.includes(`SUMMARY ${n}:`));
  const gone = 7 - shown.length;
  assert.ok(gone > 0 && shown.length > 0 && shown.every((n) => n > gone), `the nearest summaries go, the oldest are left out (${shown})`);
  const note = (picked(b.ch(7).passages[0]).notes || []).find((n) => n.includes('did not fit the writer’s room'));
  assert.equal(note, prompts.leftOutWords(gone));
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[7], text: 'How is it going?' });
  const t = store.peek('talk', b.novelId);
  const answer = picked(t.turns[t.turns.length - 1]);
  assert.ok((answer.notes || []).some((n) => n.includes('did not fit your partner’s room')), JSON.stringify(answer.notes));
  await setHouse();
  await putAway(b);
});

await test('thinking asked for, and none came back, is kept with what was sent — never said under the page', async () => {
  await setHouse({ thinking: 'high' });
  const b = await makeBook([[]], { manual: true });
  await script([{ text: 'A page with no thinking.' }, { text: 'A page that thought.', think: 'It thought.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  const [one, two] = b.ch().passages.map((p) => picked(p));
  assert.ok(!(one.notes || []).some((n) => n.includes('none came back')), JSON.stringify(one.notes));
  await store.flush();
  const sent = async (v) => (await (await realFetch(`${BASE}/api/sent/${b.novelId}/${v.sent}`)).json());
  assert.equal((await sent(one)).thought, 'Thinking was asked for, and none came back — this model or its provider may not think at this setting.');
  assert.equal((await sent(two)).thought, undefined);
  /* off: nothing to say (this replaces 2.5.0's check of the line under the page — Cozy Tavern M521 moved it to the receipt) */
  await setHouse({ thinking: 'off' });
  await script([{ text: 'Off: nothing to say.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await store.flush();
  const three = picked(b.ch().passages[2]);
  assert.ok(!(three.notes || []).some((n) => n.includes('none came back')));
  assert.equal((await sent(three)).thought, undefined);
  await setHouse();
  await putAway(b);
});

await test('pages kept from before are made whole once, when the book opens — what came off kept with each, nothing read or checked again for it; his own words, a telling he put back whole and a page cut short keep theirs', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const block = '{PULSE}\nMara: tired\n{/PULSE}';
  const b = await makeBook([[
    `${story200} Gulls cried.\n\n${block}\n\nI hope this captures the scene.`,
    { text: `${story200} “Wait,\n\nshe said.`, how: 'mine' },
    { text: `${story200}\n\nWould you like me to continue?`, cut: true, cutWhy: 'it reached the reply length' },
  ]], { manual: true });
  const [p1, p2, p3] = b.ch().passages;
  markAllSeen(b);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'Gulls cried', replace: 'Gulls cried out', why: 'x' },
    { passage: '1.1', kind: 'grammar', find: 'I hope this captures', replace: 'x', why: 'in the note' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal(checker.suggestions(b.novelId).length, 2);
  /* a scene's tellings: one kept from before with tracking after it, one he put back whole */
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  store.change('play', playId, shape.turnSteps.addTurn(shape.newTurn('ai', `${story200}\n\n${block}`)), { now: true });
  store.change('play', playId, shape.turnSteps.addTurn(shape.newTurn('ai', `${story200}\n\nI hope this captures the scene.`, { asIs: true })), { now: true });
  const out = await mend.mendBook(b.novelId);
  /* (2.12.2: the mend counts the versions it put back on the page they came from too — none here) */
  assert.deepEqual(out, { pages: 1, tellings: 1, versions: 0 });
  const turns = store.peek('play', playId).turns.filter((t) => t.by === 'ai').map((t) => picked(t));
  assert.deepEqual(turns.map((v) => [v.text, v.tookOff]), [[story200, block], [`${story200}\n\nI hope this captures the scene.`, undefined]]);
  const v1 = picked(b.ch().passages[0]);
  assert.equal(v1.text, `${story200} Gulls cried.`);
  assert.equal(v1.tookOff, `${block}\n\nI hope this captures the scene.`);
  assert.equal(picked(b.ch().passages[1]).text, `${story200} “Wait,\n\nshe said.`, 'his own words, as he wrote them');
  assert.ok(picked(b.ch().passages[2]).text.endsWith('Would you like me to continue?'), 'a page cut short keeps its end');
  assert.equal(archivist.pendingWork(b.novelId), false, 'nothing read again');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => x.item.find), ['Gulls cried'], 'what it found still stands — but for what was in the note');
  assert.equal(b.novel().memory.mended, mend.MEND_V);
  /* once: a version made since is shaped at its own door, never again by the mend */
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p3.id, shape.newVersion({ text: `${story200}\n\nWould you like me to continue?`, how: 'partner' })), { now: true });
  assert.deepEqual(await mend.mendBook(b.novelId), { pages: 0, tellings: 0, versions: 0 }, 'once');
  assert.ok(picked(b.ch().passages[2]).text.endsWith('Would you like me to continue?'));
  /* Put back */
  assert.equal(writer.putBackTail({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1.id }), true);
  assert.equal(picked(b.ch().passages[0]).text, `${story200} Gulls cried.\n\n${block}\n\nI hope this captures the scene.`);
  void p2;
  await setHouse();
  await putAway(b);
});

/* =================================================== the rest: what the second sweep found */
heading('the rest: what the second sweep found');

await test('a number typed the way people write it is the number they mean — "8,000", "200.000", "128k"; a decimal in a box for a whole number is no number; his mark reads "8/10", "8 of 10", "80%"', () => {
  const whole = (x) => util.numberTyped(x, { whole: true });
  assert.deepEqual(['8,000', '200.000', '1 048 576', '128k', '16 000', '8000', '-1'].map(whole), [8000, 200000, 1048576, 128000, 16000, 8000, -1]);
  assert.ok(['8.5', '0,3', 'abc', ''].every((x) => Number.isNaN(whole(x))), 'not kept as another number');
  assert.deepEqual(['0,3', '0.3', '2,50', '1,234.56', '1.234,56', '15', '-0.5'].map((x) => util.numberTyped(x)), [0.3, 0.3, 2.5, 1234.56, 1234.56, 15, -0.5]);
  assert.deepEqual(['8', '8,5', '8/10', '8 of 10', '8 out of 10', '80%'].map(util.markTyped), [8, 8.5, 8, 8, 8, 8]);
  assert.ok(Number.isNaN(util.markTyped('eight')));
});

await test('a book brought in reads every common chapter heading — "Ch. 1", "Chapter 1, The Letter", "Chapter 1 (The Letter)", "Chapter 1 The Letter", "**Chapter 1**", "Part One" — never leaving a heading inside the chapter before', () => {
  for (const [h, name] of [['Ch. 1', ''], ['Chapter 1, The Letter', 'The Letter'], ['Chapter 1 (The Letter)', 'The Letter'], ['Chapter 1 The Letter', 'The Letter'], ['**Chapter 1**', ''], ['Part One', 'Part One'], ['CHAPTER ONE', '']]) {
    const second = h.replace(/1|One|ONE/, (x) => ({ 1: '2', One: 'Two', ONE: 'TWO' })[x]);
    const { novel, chapters } = files.fromText('book.txt', `Before it all.\n\n${h}\n\nShe found the letter.\n\n${second}\n\nHe read it.`);
    const got = novel.order.map((id) => [chapters[id].name, chapters[id].passages.map((p) => picked(p).text).join('|')]);
    assert.deepEqual(got, [['', 'Before it all.'], [name, 'She found the letter.'], [name.replace('One', 'Two'), 'He read it.']], h);
  }
  const plain = files.fromText('t.txt', 'Words.\n\nChapter 1 was long, she thought.\n\nNot a heading.');
  assert.equal(plain.novel.order.length, 1, 'a sentence that begins like a heading stays a sentence');
  /* words that begin with "ch" and go on in a numeral's letters are words: "Chill.", "Child Of The Stars", "Chic", "CHILI" */
  const words = files.fromText('w.txt', 'Chapter 1\n\nShe came in from the cold.\n\nChill.\n\nThe wind kept on.\n\nChild Of The Stars\n\nA song she knew.\n\nChic\n\nCHILI\n\nCh.2\n\nMorning.\n\nChapter3\n\nNight.');
  assert.deepEqual(words.novel.order.map((id) => words.chapters[id].passages.map((p) => picked(p).text).join('\n\n').split(/\n\n+/)), [['She came in from the cold.', 'Chill.', 'The wind kept on.', 'Child Of The Stars', 'A song she knew.', 'Chic', 'CHILI'], ['Morning.'], ['Night.']], 'only "Ch.2" and "Chapter3" are headings');
  const parts = files.fromText('p.txt', 'Part One\n\nChapter 1\n\nA.\n\nChapter 2\n\nB.\n\nPart Two\n\nChapter 3\n\nC.');
  assert.deepEqual(parts.novel.order.map((id) => parts.chapters[id].passages.map((p) => picked(p).text).join('|')), ['A.', 'B.', 'C.'], 'a part heading with nothing of its own is only a heading');
});

await test('an act said not to happen wakes nothing — "they kiss but don’t have sex", "he refuses to fight", "Jovan never hits her" — while "didn’t hesitate to attack" does', () => {
  for (const t of ['They kiss goodnight but don\'t have sex.', 'Mina refuses to sleep together before the wedding.', 'Jun won\'t make love to her while she\'s drunk; he tucks her in.', 'Jovan refuses to fight him and walks away.', 'They decide not to fight Kenji tonight.', 'Jovan never hits her.']) {
    assert.deepEqual(crafts.wakesOn(t), { intimate: false, fight: false }, t);
  }
  assert.equal(crafts.wakesOn('She won\'t attack him; she draws her sword and lunges.').fight, true, 'the next clause is the act');
  assert.equal(crafts.wakesOn('He didn\'t hesitate to attack him.').fight, true);
  assert.equal(crafts.wakesOn('She could not believe he would attack her.').fight, true, 'a "not" about something else');
  assert.equal(crafts.wakesOn('He didn\'t mean to hit her, but he did.').fight, true);
  assert.equal(crafts.wakesOn('Jovan, who never fights, draws his sword and charges.').fight, true, 'the act in its own clause');
  assert.equal(crafts.wakesOn('It was not long before he attacked them.').fight, true);
  assert.equal(crafts.wakesOn('He won\'t stop her from attacking.').fight, true);
  assert.equal(crafts.wakesOn('Jovan is no longer able to fight them.').fight, false);
  assert.equal(crafts.wakesOn('She doesn\'t even want to hit him.').fight, false);
  assert.equal(crafts.wakesOn('They plan not to, then attack him anyway.').fight, true, 'a word between that is more than a link ends the "not"');
  assert.equal(crafts.wakesOn('She would never, ever hit him.').fight, false, 'a comma among the links is no break');
  assert.equal(crafts.wakesOn('Jovan is not going to be able to fight them.').fight, false);
  assert.equal(crafts.wakesOn('Rias asks if he will. He won\'t. Hit him, she tells herself.').fight, true, 'a full stop ends it');
  assert.equal(crafts.wakesOn('They have sex. She doesn\'t stop him.').intimate, true);
});

await test('a fight told in a phrase wakes the fight rule; a verb that only begins like a fight’s does not — "the stable", "slash prices", "dodges the puddles", "lunges for the phone"', async () => {
  for (const t of ['Mara slits the guard’s throat', 'He puts a bullet in the man by the door', 'She knocks him out cold with the lamp', 'Jovan snaps the assassin’s wrist', 'Rias pulls the trigger', 'He brings the bottle down on the bandit’s head', 'Jovan unleashes Mahoraga on Sukuna', 'She kills him', 'Kenji crushes the guard’s windpipe', 'Take him down — Tom goes for the knees', 'The two of them trade blows in the alley']) {
    assert.equal(crafts.wakesOn(t).fight, true, t);
  }
  for (const t of ['Mara brushes down the horse in the stable', 'They slash prices at the market', 'She dodges the puddles on the way to the bakery', 'Jovan draws the curtains and lunges for the ringing phone', 'She kills time at the cafe.']) {
    assert.equal(crafts.wakesOn(t).fight, false, t);
  }
  /* and what rides with the page */
  const b = await makeBook([['Now.']]);
  const sys = (direction) => context.assemble({ house: store.peek('house', 'house'), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: CONN, purpose: 'write', target: { chapterId: b.ids[0] }, request: direction, moment: direction }).system;
  assert.ok(sys('Mara slits the guard’s throat.').includes('How A Fight Sounds'));
  assert.ok(!sys('Mara brushes down the horse in the stable.').includes('How A Fight Sounds'));
  await putAway(b);
});

await test('how an intimate scene sounds rides with his own rule for it too — never only with the app’s', () => {
  const novel = { prefs: {} };
  const own = { modules: { intimate: { rides: 'off' }, 'm-heat': { custom: true, at: 1, name: 'My heat', text: 'MY OWN HEAT RULE.', to: ['writer'], rides: 'intimate' } } };
  const r = modules.ridingFor(own, novel, 'write', { intimate: true });
  assert.ok(r.woken.includes('MY OWN HEAT RULE.') && r.woken.includes(crafts.SOUND.comic.intimate), JSON.stringify(r.woken.map((x) => x.slice(0, 30))));
  const none = modules.ridingFor({ modules: { intimate: { rides: 'off' } } }, novel, 'write', { intimate: true });
  assert.ok(!none.woken.includes(crafts.SOUND.comic.intimate), 'with every intimate rule off, nothing of it rides');
  const app = modules.ridingFor({}, novel, 'write', { intimate: true });
  assert.ok(app.woken.includes(crafts.SOUND.comic.intimate), 'the app’s own, as before');
  assert.ok(!modules.ridingFor({}, novel, 'partner', { intimate: true }).woken.includes(crafts.SOUND.comic.intimate), 'never for the partner');
  const talking = modules.ridingFor({ modules: { 'm-talk': { custom: true, at: 2, name: 'Heat talk', text: 'HOW WE TALK OF HEAT.', to: ['partner'], rides: 'intimate' } } }, novel, 'partner', { intimate: true });
  assert.ok(talking.woken.includes('HOW WE TALK OF HEAT.') && !talking.woken.includes(crafts.SOUND.comic.intimate), 'his own rule for the partner rides; the sound law, which is for telling the story, does not');
});

await test('{{user}} and {{char}} in the book’s own words are never sent raw — his name, and the name he gives {{char}} in About this book — to the writer, the partner, the helper and the checker', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, you: { name: 'Jovan' } });
  const b = await makeBook([['Rias kept the light.']], { brief: '{{char}} is {{user}}\'s older sister, sworn to protect him.' });
  store.change('novel', b.novelId, shape.novelSteps.setMeta({ char: 'Rias' }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Rias', about: 'Guards <USER> with her life.' })), { now: true });
  await script([{ text: 'A page.' }, { text: 'An answer.' }, { text: JSON.stringify({ people: [] }) }, CK_NONE]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello.' });
  await archivist.run(b.novelId);
  await checker.runCheck(b.novelId);
  const r = await requests();
  assert.ok(r.length >= 4, r.length);
  for (const x of r) {
    const all = JSON.stringify(x.body.messages);
    assert.ok(!/\{\{\s*(?:user|char)\s*\}\}|<USER>|<BOT>/i.test(all), all.slice(0, 300));
  }
  assert.ok(JSON.stringify(r[0].body.messages).includes('Rias is Jovan\'s older sister'), 'the writer reads the names');
  assert.ok(JSON.stringify(r[0].body.messages).includes('Guards Jovan with her life.'), 'and the cards’ words');
  assert.equal(b.novel().brief, '{{char}} is {{user}}\'s older sister, sworn to protect him.', 'his words are kept as he wrote them');
  /* the partner quotes them as it read them: found where the marks stand */
  let made = changes.makeChange(b.novelId, { book: 'about', find: 'Rias is Jovan\'s older sister', replace: 'Rias is Jovan\'s younger sister' });
  assert.equal(made.status, 'made', made.said);
  assert.equal(b.novel().brief, 'Rias is Jovan\'s younger sister, sworn to protect him.');
  assert.equal(changes.undoChange(b.novelId, made).ok, true);
  made = changes.makeChange(b.novelId, { book: 'about', find: 'sworn to protect him', replace: 'sworn to guard him' });
  assert.equal(b.novel().brief, '{{char}} is {{user}}\'s older sister, sworn to guard him.', 'a quote that takes in no mark leaves every mark as he wrote it');
  made = changes.makeChange(b.novelId, { book: 'about', add: 'Rias is Jovan\'s older sister, sworn to guard him.' });
  assert.equal(made.status, 'refused', 'the same words with the names in are there already');
  /* a quote that begins and ends inside the names keeps the names whole */
  made = changes.makeChange(b.novelId, { book: 'about', find: 'ias is Jov', replace: 'ias, cousin of Jov' });
  assert.equal(made.status, 'made', made.said);
  assert.equal(b.novel().brief, 'Rias, cousin of Jovan\'s older sister, sworn to guard him.');
  await setHouse();
  await putAway(b);
});

await test('the judge reading two writers’ takes head to head reads the book’s words with the names in too', async () => {
  await setHouse({}, { checksFrom: 0, you: { name: 'Jovan' } });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const b = await makeBook([[{ text: 'Rias lit the lamp.', model: 'writer-a', how: 'write', ask }]], { brief: '{{char}} is {{user}}\'s older sister.' });
  store.change('novel', b.novelId, shape.novelSteps.setMeta({ char: 'Rias' }), { now: true });
  const pid = b.ch().passages[0].id;
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text: 'Rias looked at the lamp for a long time.', model: 'writer-b', how: 'another', ask: { ...ask } })), { now: true });
  await script([{ text: GRADED_NONE('1.1') }, { text: JSON.stringify({ better: 'B', why: 'it acts' }) }, { text: JSON.stringify({ better: 'A', why: 'it acts' }) }]);
  await checker.runCheck(b.novelId);
  const duels = (await requests()).filter((x) => x.body.messages.at(-1).content.includes('Which is the better page'));
  assert.equal(duels.length, 2);
  for (const x of duels) {
    const all = JSON.stringify(x.body.messages);
    assert.ok(all.includes('Rias is Jovan\'s older sister') && !/\{\{\s*(?:user|char)\s*\}\}/i.test(all), all.slice(0, 300));
  }
  await setHouse();
  await putAway(b);
});

await test('with no Longest reply set, a request is refused only when its answer would have less than an answer’s floor — never for the larger room it keeps for fitting the book', async () => {
  const b = await makeBook([['Now.']]);
  const hs = store.peek('house', 'house');
  const build = (conn, length) => context.assemble({ house: hs, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Go.', length });
  const big = (n) => build({ ...CONN, context: n }, 'chapter');
  /* find a room where the whole chapter's 12,000 does not fit beside his words but 4,096 does */
  const base = build({ ...CONN, context: 200000 }, 'chapter').stats;
  const fixed = base.least - 4096;
  const room = fixed + 8000;
  const out = big(room);
  assert.equal(out.refuse, '', `about ${(room - fixed).toLocaleString()} tokens free for the answer: sent`);
  assert.ok(big(fixed + 3000).refuse.includes('the room for its answer (about 4,096)'), 'below the floor: refused, the floor said');
  /* his own Longest reply is held to as he set it */
  assert.ok(build({ ...CONN, context: room, maxTokens: 12000 }, 'chapter').refuse.includes('your Longest reply'));
  await putAway(b);
  /* what of the book has to go counts too: a long What it's about that leaves less than the floor is refused, and said so */
  const long = await makeBook([['Now.']], { brief: 'The keeper of the light. '.repeat(500) });
  const at = (n) => context.assemble({ house: hs, novel: long.novel(), chapters: { [long.ids[0]]: long.ch() }, conn: { ...CONN, context: n }, purpose: 'write', target: { chapterId: long.ids[0] }, request: 'Go.', length: 'chapter' });
  const whole = at(200000).stats.tokens;
  const tight = at(whole + 4096 - 600);
  assert.ok(tight.refuse.includes('what of the book has to go with them at the least') && tight.refuse.includes('make What it’s about shorter'), tight.refuse);
  assert.equal(at(whole + 4096 + 600).refuse, '', 'with the floor left beside it: sent');
  await putAway(long);
});

await test('a plan or drafts above a new page, and its check of its own work after it, are taken off and kept — said, and Put back brings them; a story that only begins like a plan stays; the narrator’s telling the same; a page from before is mended once', async () => {
  const b = await makeBook([[]], { manual: true });
  const plan = 'Plan:\n- Mara finds the letter\n- she reads it twice\n- the lamp gutters';
  const check = 'Let me check: ✓ sound ✓ dialogue ✓ the lamp\nShip it.';
  await script([
    { text: `${plan}\n\n---\n\n${story200}\n\n${check}` },
    { text: `Draft 1:\nMara found it. She read it.\n\nFinal:\n${story200}` },
    { text: `Planning the escape had taken weeks. ${story200}` },
  ]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  let v = picked(b.ch().passages[0]);
  assert.deepEqual([v.text, v.tookOffTop, v.tookOff], [story200, `${plan}\n\n---`, check]);
  assert.ok((v.notes || []).some((n) => n.includes('The writer’s plan for the page, written above it, was taken off')), JSON.stringify(v.notes));
  assert.equal(writer.putBackTail({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id }), true);
  v = picked(b.ch().passages[0]);
  assert.ok(v.text.startsWith('Plan:\n- Mara') && v.text.endsWith('Ship it.'), v.text);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(picked(b.ch().passages[1]).text, story200, 'drafts: the page is what follows the last of them');
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.ok(picked(b.ch().passages[2]).text.startsWith('Planning the escape had taken weeks.'), 'a story that only begins like a plan stays');
  /* the narrator's telling too */
  const told = talk.shapeTelling(`Outline:\n1. The bridge\n2. The mist\n\n${story200}`);
  assert.deepEqual([told.text, told.tookOffTop], [story200, 'Outline:\n1. The bridge\n2. The mist']);
  /* each sign of its check of its own work comes off on its own — never a narrator's own line, a game's "Check —", a story line that begins like one */
  for (const note of ['Let me check: the sound holds, the lamp is lit.', 'Let me verify the scene against the rules.', '✓ sound ✓ dialogue', 'Ship it.']) assert.equal(textshape.finishTail(`${story200}\n\n${note}`).removed, note, note);
  for (const line of ['Let me check whether the door is locked, I thought.', 'Check — and mate.', 'Ship it to the coast by Friday, he decided.']) assert.equal(textshape.finishTail(`${story200}\n\n${line}`).removed, '', line);
  /* a story that opens on a line shaped like a plan keeps it; a plan with too little story after it stays whole */
  for (const page of [`My plan: wait for dark.\n\n${story200}`, `Plan: wait for dark.\n\n${story200}`, `The plan:\n\n${story200}`, `My plan:\n- wait for dark\n- take the boat\n\n${story200}`]) assert.equal(textshape.dropPlan(page).removed, '', page.slice(0, 30));
  assert.equal(textshape.dropPlan('Plan:\n- she runs\n\n---\n\nShe ran.').removed, '', 'too little story after it');
  /* a story whose first scene opens on a label, a scene break after it: the scene stays */
  const scene = 'The harbour slept under the fog while the boats knocked together. '.repeat(10).trim();
  assert.equal(textshape.dropPlan(`Thinking: that was the trouble with Mara.\n\n${scene}\n\n* * *\n\n${story200}\n\n${story200}\n\n${story200}`).removed, '', 'a first scene is never a plan');
  assert.equal(textshape.dropPlan(`Plan: Mara finds the letter, reads it twice.\n\n---\n\n${story200}`).removed, 'Plan: Mara finds the letter, reads it twice.\n\n---', 'a plan of a line above a line parting it from the story');
  await putAway(b);
  /* a page kept from before this repair: mended once when the book opens */
  const old = await makeBook([[{ text: `Beats:\n- the storm\n- the lamp\n\n* * *\n\n${story200}` }]], { manual: true });
  store.change('novel', old.novelId, (n) => { n.memory = { ...(n.memory || {}), mended: 1 }; }, { now: true });
  const got = await mend.mendBook(old.novelId);
  v = picked(old.ch().passages[0]);
  assert.deepEqual([got.pages, v.text, v.tookOffTop], [1, story200, 'Beats:\n- the storm\n- the lamp\n\n* * *']);
  assert.deepEqual(await mend.mendBook(old.novelId), { pages: 0, tellings: 0, versions: 0 }, 'once');
  await putAway(old);
});

await test('the first Cozy Novel’s partner talk comes in in the order it was said — one with no time stays where the file has it, never first', () => {
  const records = [
    { id: 'n1', type: 'novel', title: 'Old Book', orderedChapterIds: ['c1'] },
    { id: 'c1', type: 'chapter', title: 'The Light', orderedSceneIds: [] },
    { id: 'd1', type: 'discussion', novelId: 'n1', role: 'author', textBlobId: 't1', createdAt: '2025-01-01T10:00:00Z' },
    { id: 'd2', type: 'discussion', novelId: 'n1', role: 'assistant', textBlobId: 't2' },
    { id: 'd3', type: 'discussion', novelId: 'n1', role: 'author', textBlobId: 't3', createdAt: '2025-01-01T10:05:00Z' },
  ];
  const [book] = files.fromLegacy({ records, blobs: [{ id: 't1', text: 'First.' }, { id: 't2', text: 'Its answer.' }, { id: 't3', text: 'Second.' }] });
  assert.deepEqual(book.talk.turns.map((t) => [t.by, t.versions[0].text]), [['you', 'First.'], ['ai', 'Its answer.'], ['you', 'Second.']]);
});

await test('a lift the judge of 2.4 echoed from its own example (“Slow the moment Yuki falls…”) in a book with no Yuki is said again from the checks the page failed when the book opens; a book with a Yuki keeps it', async () => {
  const mk = async (text, opts = {}) => {
    const b = await makeBook([[text]], { manual: true, ...opts });
    const p = b.ch().passages[0];
    const v = picked(p);
    const grade = { overall: 8, of: 10, faults: [{ check: 'pacing', why: 'it rushes the fall' }], lift: 'Slow the moment Yuki falls…' };
    store.change('chapter', b.ids[0], (c) => { c.checks = { [p.id]: { [v.id]: { sig: util.hashText(v.text), at: 1, items: [{ id: 'sg1', kind: 'grade', find: '', replace: null, why: '', lift: grade.lift, target: 9, grade: { ...grade } }], grade } } }; }, { now: true });
    store.change('novel', b.novelId, (n) => { n.memory = { ...(n.memory || {}), mended: 1 }; }, { now: true });
    await mend.mendBook(b.novelId);
    return [b, b.ch().checks[p.id][v.id]];
  };
  const [b1, e1] = await mk('Mara kept the light through the long night, and the sea broke on the rocks below the tower.');
  assert.deepEqual([e1.grade.lift, e1.items[0].lift, e1.items[0].grade.lift], Array(3).fill('Fix what falls short — pacing: it rushes the fall.'));
  const [b2, e2] = await mk('Yuki kept the light through the long night, and the sea broke on the rocks below the tower.');
  assert.equal(e2.items[0].lift, 'Slow the moment Yuki falls…', 'a book with a Yuki keeps it');
  const [b3, e3] = await mk('She kept the light through the long night, and the sea broke on the rocks below the tower.', { brief: 'Yuki keeps a lighthouse on a stormy coast.' });
  assert.equal(e3.items[0].lift, 'Slow the moment Yuki falls…', 'a Yuki only in About this book is one too');
  await putAway(b1);
  await putAway(b2);
  await putAway(b3);
});

await test('a description the helper gives as a person, standing beside the one name it is in the words read (“the courier, Hachigorō”), is that person’s card — never a second one; “the courier and Hachigorō” are two, and so are “Hachigorō, the courier’s son”', () => {
  const notes = { people: [{ id: 'h', name: 'Hachigorō', about: 'A runner for the Guild.', aka: [] }], places: [], lore: [], threads: [] };
  const answer = { people: [{ name: 'the courier', now: 'At the north gate.' }] };
  const one = archivist.foldNotes(notes, answer, { chapterId: 'c1', named: namesjs.foldedText('The courier, Hachigorō, waited at the north gate with the satchel.') });
  assert.deepEqual(one.notes.people.map((c) => [c.name, c.now, c.aka]), [['Hachigorō', 'At the north gate.', ['the courier']]]);
  const after = archivist.foldNotes(notes, answer, { chapterId: 'c1', named: namesjs.foldedText('Hachigorō the courier waited at the north gate.') });
  assert.equal(after.notes.people.length, 1, 'the name first, then the description');
  const two = archivist.foldNotes(notes, answer, { chapterId: 'c1', named: namesjs.foldedText('The courier and Hachigorō waited at the north gate.') });
  assert.equal(two.notes.people.length, 2, 'side by side is not beside the name');
  const son = archivist.foldNotes(notes, answer, { chapterId: 'c1', named: namesjs.foldedText('Hachigorō, the courier’s son, waited at the north gate.') });
  assert.equal(son.notes.people.length, 2, 'the courier’s son is someone else');
  /* only a description: a name of someone's own beside his is someone else */
  const own = archivist.foldNotes(notes, { people: [{ name: 'Tomas', now: 'At the north gate.' }] }, { chapterId: 'c1', named: namesjs.foldedText('“Tomas,” Hachigorō said, “is late.” Tomas came at last to the north gate.') });
  assert.deepEqual(own.notes.people.map((c) => c.name), ['Hachigorō', 'Tomas']);
});

await test('“now”: “Unknown.” for someone the words read name means nobody knows where they are — never the inn they left; for someone they never name it is a filler and changes nothing', () => {
  const notes = { people: [{ id: 'm', name: 'Mara', about: 'The keeper.', now: 'At the inn by the harbour.' }], places: [], lore: [], threads: [] };
  const answer = { people: [{ name: 'Mara', now: 'Unknown.' }] };
  const named = archivist.foldNotes(notes, answer, { chapterId: 'c1', named: namesjs.foldedText('By morning Mara was gone, and nobody at the inn could say where.') });
  assert.equal(named.notes.people[0].now, 'Whereabouts unknown.');
  const filler = archivist.foldNotes(notes, answer, { chapterId: 'c1', named: namesjs.foldedText('The harbour slept under the fog.') });
  assert.equal(filler.notes.people[0].now, 'At the inn by the harbour.');
});

await test('a page refused as too many while the helper asks on the same connection: the helper’s call makes way and the page goes once more — said; refused with nothing of the app’s in the way, the page is refused', async () => {
  await script([{ hang_after: 'Reading the book' }, { status: 429, message: 'Too many requests at once' }, { text: 'The page, written.' }]);
  const worker = archivist.askJson(CONN, 'Answer with JSON only.', 'Read the book.');
  for (let i = 0; i < 100 && (await requests()).length < 1; i++) await sleep(30);
  await sleep(200);
  const page = await call.ask(CONN, { messages: [{ role: 'user', content: 'Write the page.' }] });
  const w = await worker;
  assert.equal(page.ok, true, page.error);
  assert.equal(page.text, 'The page, written.');
  assert.ok(page.notes.some((n) => n.includes('busy with the helper’s or the checker’s request')), JSON.stringify(page.notes));
  assert.deepEqual([w.ok, w.leashed, w.error], [false, 'gaveway', call.GAVE_WAY], 'the helper’s ask is a passing fault it reads again after');
  assert.equal(call.workersBusy(CONN), 0, 'nothing of the app’s left on the line');
  /* nothing of the app's in the way: refused, never sent again by itself */
  await reset();
  await script([{ status: 429, message: 'Too many requests at once' }]);
  const alone = await call.ask(CONN, { messages: [{ role: 'user', content: 'Write the page.' }] });
  assert.equal(alone.ok, false);
  assert.equal((await requests()).length, 1);
});

await test('a scene is written into the chapter where it was set — before passages written on while it was open, leading into them; set at the end, at the end', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await script([{ text: 'The narrator opens on the stair.' }, { text: 'Prose of the scene on the stair.' }]);
  await talk.playSay({ playId, text: '' });
  /* he writes on in the chapter while the scene is open */
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'Morning came, grey and still.' });
  const p = store.peek('play', playId);
  const tr = talk.transcriptOf(p);
  const out = await writer.playToProse({ novelId: b.novelId, chapterId: b.ids[0], play: p, transcript: tr.text });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(b.ch().passages.map((x) => picked(x).text), ['The lamp was cold.', 'Prose of the scene on the stair.', 'Morning came, grey and still.']);
  const ask = (await requests()).at(-1).body.messages.at(-1).content;
  assert.ok(ask.includes('at the point in Chapter One where it was set') && ask.includes('What comes after it is already written'), ask.slice(0, 400));
  /* another take of it is written for the same place */
  await script([{ text: 'The stair, told again.' }]);
  const again = await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[1].id });
  assert.equal(again.ok, true, again.error);
  const retold = (await requests()).map((x) => String(x.body.messages.at(-1).content)).filter((c) => c.includes('We played a scene')).at(-1);
  assert.ok(retold.includes('at the point in Chapter One where it was set') && retold.includes('What comes after it is already written'), retold.slice(0, 300));
  await putAway(b);
  /* set at the end of the chapter, nothing written since: at the end, as ever */
  const c = await makeBook([['The lamp was cold.']]);
  const id2 = await talk.newPlay({ novelId: c.novelId, chapterId: c.ids[0], who: 'Mara' });
  await script([{ text: 'The narrator opens.' }, { text: 'Prose of the second scene.' }]);
  await talk.playSay({ playId: id2, text: '' });
  const p2 = store.peek('play', id2);
  await writer.playToProse({ novelId: c.novelId, chapterId: c.ids[0], play: p2, transcript: talk.transcriptOf(p2).text });
  assert.deepEqual(c.ch().passages.map((x) => picked(x).text), ['The lamp was cold.', 'Prose of the second scene.']);
  assert.ok((await requests()).at(-1).body.messages.at(-1).content.includes('where Chapter One leaves off'));
  await putAway(c);
});

await test('the checker is told the words a passage copies from the pages right before it, word for word — never speech, never how anyone talks', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([[
    'The wind came round to the west and the glass sang in its frame. Mara counted the ships. And then he said that it was up to them.',
    'Night fell over Crane Point. The wind came round to the west and the glass sang in its frame. “The wind came round to the west and the glass sang,” she said. And then he said that it was up to them.',
  ]]);
  await checker.runCheck(b.novelId);
  const ask = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Check these passages from'));
  assert.ok(ask.includes('Words copied from the pages right before, word for word') && ask.includes('[1.2] “The wind came round to the west and the glass sang in its frame”.'), ask.slice(ask.indexOf('Words copied') - 20, ask.indexOf('Words copied') + 300));
  assert.ok(!/“and then he said/i.test(ask), 'how anyone talks is no copy');
  await setHouse();
  await putAway(b);
});

await test('a page whose every word stood before a stray “</think>” is said so — kept to copy under What it thought, never blamed on the model', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'Mara struck a match and the wick took.\n</think>' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  assert.equal(out.ok, false);
  assert.ok(out.error.includes('stood before a closing thinking mark') && !out.error.includes('only thought'), out.error);
  assert.equal(out.thought, 'Mara struck a match and the wick took.');
  assert.equal(b.ch().passages.length, 1, 'no page with a stray mark on it, and no thinking that is the page twice');
  /* the partner's answer the same: kept as its thinking — and nothing it only thought is acted on */
  await reset();
  await script([{ text: `I should look at the chapter first. ${prompts.READ_OPEN}[1]${prompts.READ_CLOSE}\n</think>` }]);
  const said = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'What next?' });
  assert.ok(!said.ok && String(said.error).includes('stood before a closing thinking mark'), JSON.stringify(said));
  const tv = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.equal(tv.text, '');
  assert.ok(tv.thinking.startsWith('I should look at the chapter first.'), tv.thinking);
  assert.equal((await requests()).length, 1, 'no chapter read for words it only thought');
  await putAway(b);
});

await test('how someone stands with the others, past its room, keeps its newest turns — the oldest let go, said by its “…”; never his own lines', () => {
  const old = Array.from({ length: 260 }, (_, i) => `On day ${i + 1} Mara and Tomas argued about the lamp.`).join(' ');
  const notes = { people: [{ id: 'm', name: 'Mara', about: 'The keeper.', ties: old }], places: [], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, { people: [{ name: 'Mara', ties: `${old} Now Mara trusts Tomas at last.` }] }, { chapterId: 'c1' });
  const t = out.notes.people[0].ties;
  assert.ok(t.endsWith('Now Mara trusts Tomas at last.') && t.startsWith('… On day ') && t.length <= 12002, `${t.length} ${t.slice(0, 40)} … ${t.slice(-40)}`);
  /* the newest turn alone, added to a telling already past its room */
  const added = archivist.foldNotes(notes, { people: [{ name: 'Mara', ties: 'Now Mara trusts Tomas at last.' }] }, { chapterId: 'c1' }).notes.people[0].ties;
  assert.ok(added.endsWith('Now Mara trusts Tomas at last.') && added.startsWith('… ') && added.length <= 12002, `${added.length} ${added.slice(-40)}`);
  /* someone new, told at length: the newest kept too */
  const fresh = archivist.foldNotes({ people: [], places: [], lore: [], threads: [] }, { people: [{ name: 'Mara', about: 'The keeper.', ties: `${old} Now Mara trusts Tomas at last.` }] }, { chapterId: 'c1', named: namesjs.foldedText('Mara kept the light.') }).notes.people[0].ties;
  assert.ok(fresh.endsWith('Now Mara trusts Tomas at last.') && fresh.length <= 12002, `${fresh.length} ${fresh.slice(-40)}`);
  const his = { people: [{ id: 'm', name: 'Mara', about: 'The keeper.', ties: old, updated: { by: 'you', his: ['ties'], at: 1 } }], places: [], lore: [], threads: [] };
  const kept = archivist.foldNotes(his, { people: [{ name: 'Mara', ties: 'Now Mara trusts Tomas at last.' }] }, { chapterId: 'c1' });
  assert.ok(kept.notes.people[0].ties.startsWith('On day 1 Mara'), 'his lines are never the ones let go');
});

await test('the partner is told the notes look after themselves only while they do — with the helper’s connection turned away, it is asked to say when a card is out of date', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'An answer.' }, { text: 'Another answer.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Hello.' });
  archivist.forTests().blocked.set(b.novelId, { conn: 'x' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And now?' });
  archivist.forTests().blocked.delete(b.novelId);
  const sys = (await requests()).map((x) => x.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'));
  assert.ok(sys[0].includes('The notes look after themselves') && !sys[0].includes('Nothing reads the new pages'), 'kept');
  assert.ok(sys[1].includes('Nothing reads the new pages into the notes just now') && !sys[1].includes('The notes look after themselves'), 'turned away');
  await putAway(b);
});

await test('one name is a longer one only where the longer adds a name’s own words — “Kaelen Stahl”, “Captain Holt” — never role words (“Red Guard captain”), and two names that share a start are two people (“Mei Lin”, “Mei Ling”; “John Smith”, “John Smithson”) unless one is cut short on purpose (“Rukia K.”)', () => {
  const same = (a, b) => namesjs.samePersonName(a, b);
  assert.deepEqual([['Kaelen', 'Kaelen Stahl'], ['Holt', 'Captain Holt'], ['Hale', 'Thomas Hale'], ['Leonardo', 'Leonardo da Vinci'], ['Rukia K.', 'Rukia Kuchiki']].map(([a, b]) => same(a, b)), [true, true, true, true, true]);
  assert.deepEqual([['Red', 'Red Guard captain'], ['Mei Lin', 'Mei Ling'], ['John Smith', 'John Smithson'], ['Red Guard captain', 'Red']].map(([a, b]) => same(a, b)), [false, false, false, false]);
  /* and so a reading's row for the captain is a card of its own */
  const notes = { people: [{ id: 'r', name: 'Red', about: 'A fox spirit.' }], places: [], lore: [], threads: [] };
  const out = archivist.foldNotes(notes, { people: [{ name: 'Red Guard captain', about: 'Commands the gate.' }] }, { chapterId: 'c1' });
  assert.deepEqual(out.notes.people.map((c) => c.name), ['Red', 'Red Guard captain']);
});

await test('a check of the notes whose answer outgrows its room, asked again with more, checks half the cards at once — at once, and from then on; never the same whole for ever', async () => {
  const b = await makeBook([['Mara met Card1 at the gate.']], { manual: true });
  const people = Array.from({ length: 6 }, (_, i) => ({ id: `pe-${i}`, name: `Card${i}`, aka: [], about: `Card${i} is a person of the harbour.`, now: '' }));
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people, places: [], lore: [], threads: [] }), { now: true });
  markAllSeen(b);
  archivist.askAudit(b.novelId);
  await script([{ text: '{"people": [{"name": "Card0", "about": "', finish: 'length' }, { text: '{"people": [{"name": "Card0", "about": "', finish: 'length' }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().memory.audit.groupMax, 3, 'six cards, then three at once');
  assert.equal(b.novel().memory.auditAsked, true, 'asked again at once');
  await reset();
  await script([{ text: JSON.stringify({ clear: true, verdict: 'These hold.' }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests()).map((r) => r.body.messages.at(-1).content).find((c) => c.includes(prompts.AUDIT_ASK));
  assert.ok(ask && ask.includes('The other cards, checked another time'), (ask || '').slice(0, 300));
  const a = b.novel().memory.audit;
  assert.deepEqual([a.some && a.some.checked, a.groupMax], [3, 3], 'three checked, and three at once from then on');
  await putAway(b);
});

await test('a provider that went silent past the helper’s leash — a model thinking unseen — is given twice the time from then on, kept on the connection', async () => {
  globalThis.__cozyLeashQuietMs = 300;
  try {
    const conn = { ...CONN, id: 'c-quiet', learned: undefined };
    const build = () => ({ messages: [{ role: 'user', content: 'Answer with JSON.' }], maxTokens: 300 });
    await script([{ pause: 0.5, text: '{"ok": true}' }, { pause: 0.5, text: '{"ok": true}' }]);
    const first = await call.ask(conn, { build, stream: true, worker: true, patient: true });
    assert.equal(first.leashed, 'quiet', JSON.stringify(first).slice(0, 200));
    assert.equal(conn.learned.quietMs, 600, 'twice the time, kept with what it taught');
    const second = await call.ask(conn, { build, stream: true, worker: true, patient: true });
    assert.equal(second.ok, true, second.error);
    assert.equal(second.text, '{"ok": true}');
  } finally {
    delete globalThis.__cozyLeashQuietMs;
  }
});

await test('a change he made by hand before applying it is told to the partner as made in his own words — never as made in its own', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['The lamp was cold. The sea was grey.']]);
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "had died", "why": "a"}]</changes>\nDone.' }, { text: 'Fine.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Change it.' });
  const turn = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(turn);
  assert.equal(talk.applyEdited(b.novelId, turn.id, v.id, v.changes[0].id, { replace: 'burned blue' }).ok, true);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And now?' });
  const told = JSON.stringify((await requests()).at(-1).body.messages);
  assert.ok(told.includes('made, in my own words instead of yours'), told.slice(told.indexOf('Of your changes') - 10, told.indexOf('Of your changes') + 200));
  await setHouse();
  await putAway(b);
});

await test('one answer giving one card the same field twice — by its name and by a name it goes by — keeps the fuller telling and the first “now”, and says so; never the later winning silently', () => {
  const notes = { people: [{ id: 't', name: 'Thomas Hale', aka: ['Tom'], about: 'A dockhand.', now: 'At the docks.' }], places: [], lore: [], threads: [] };
  const whole = 'A dockhand of Crane Point who hauls the night nets, owes the harbourmaster, and keeps a sister in the hills.';
  const ties = 'Owes the harbourmaster a season’s wages; close to his sister in the hills, who writes every week.';
  const out = archivist.foldNotes(notes, { people: [{ name: 'Thomas Hale', about: whole, now: 'On the pier.', ties }, { name: 'Tom', about: 'A dockhand.', now: 'At home.', ties: 'Owes money.' }] }, { chapterId: 'c1', audit: true });
  const t = out.notes.people[0];
  assert.deepEqual([t.about, t.now, t.ties], [whole, 'On the pier.', ties]);
  /* said on the card's one line */
  assert.deepEqual(out.refused.filter((r) => r.name === 'Thomas Hale').map((r) => r.why), ['who they are given twice in one answer — the fuller telling kept; where they are now given twice in one answer — the first kept; how they stand given twice in one answer — the fuller telling kept']);
});

await test('a reading is measured with the notes as they are sent — every card what is read names, whole — so it never outgrows the helper’s model; when they cannot all ride whole, they ride by their first line, and it is read', async () => {
  const filler = Array.from({ length: 24 }, (_, i) => `Fact ${i} about this one, long and particular, kept for good.`).join(' ');
  const people = Array.from({ length: 60 }, (_, i) => ({ id: `pe-${i}`, name: `Card${i}`, aka: [], about: `Card${i} is a person. ${filler}`, now: '' }));
  const named = Array.from({ length: 60 }, (_, i) => `Card${i}`).join(', ');
  const b = await makeBook([[`At the gate stood ${named}, every one of them soaked through.`]], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people, places: [], lore: [], threads: [] }), { now: true });
  await setHouse({ context: 32000 });
  await script(Array.from({ length: 4 }, () => ({ text: '{"people": []}' })));
  await archivist.run(b.novelId);
  const r = await requests();
  /* read, never refused for the cards it names: past the room they ride by their first line, as the others do */
  assert.ok(r.length >= 1, archivist.lightOf(b.novelId).words);
  assert.equal(archivist.pendingWork(b.novelId), false, 'and read');
  const conn = store.peek('house', 'house').connections[0];
  for (const x of r) {
    const size = util.estimateTokens(x.body.messages.map((m) => m.content).join('\n'));
    const reply = Number(x.body.max_tokens || x.body.max_completion_tokens) || 0;
    assert.ok(reply > 0 && size + reply <= providers.contextOf(conn), `${size} + ${reply} > ${providers.contextOf(conn)}`);
  }
  await setHouse();
  await putAway(b);
});

await test('a scene is written into the book only as far as the narrator has told it — his move it has not answered stays in the scene, never written in as done', async () => {
  const b = await makeBook([['The lamp was lit.']], { manual: true });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  store.change('play', id, (d) => { d.turns = [shape.newTurn('you', 'I climb the stair.'), shape.newTurn('ai', 'THE STAIR CREAKS.'), shape.newTurn('you', 'I TRY TO OPEN THE DOOR.')]; }, { now: true });
  const p = store.peek('play', id);
  const tr = talk.transcriptOf(p);
  assert.ok(tr.text.includes('THE STAIR CREAKS.') && !tr.text.includes('I TRY TO OPEN THE DOOR.'), tr.text);
  assert.deepEqual([tr.count, tr.waiting, tr.lastId], [2, 1, p.turns[1].id]);
  /* turned up to there, the move rides on as the scene */
  store.change('play', id, shape.turnSteps.set({ turned: tr.lastId }), { now: true });
  await script([{ text: 'The door gives.' }]);
  await talk.playSay({ playId: id, text: '' });
  const sent = (await requests())[0].body.messages.map((m) => String(m.content)).join('\n');
  assert.ok(sent.includes('I TRY TO OPEN THE DOOR.') && !sent.includes('THE STAIR CREAKS.'), 'his move goes to the narrator; what was turned rides as the book');
  await putAway(b);
});

await test('what each one is told, as Cozy Tavern learned it: the writer may jump with his move, marked; the checker’s passages are never their own proof and something new is never a slip; the helper and the check keep a mention, a memory and a claim apart from where anyone is and what happened', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  await script([{ text: 'Three days later, the funeral.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Three days later, at the funeral.' });
  const write = (await requests())[0].body.messages.at(-1).content;
  assert.ok(write.includes('If what happens next starts somewhere else, or later, mark the jump'), write.slice(0, 400));
  await reset();
  await checker.runCheck(b.novelId);
  const check = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Check these passages from'));
  assert.ok(check.includes('the passages being read here are never their own proof') && check.includes('is the story growing, never a slip'), check.slice(0, 300));
  await reset();
  await script([{ text: JSON.stringify({ people: [] }) }]);
  await archivist.run(b.novelId);
  const read = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Include only entries that are new or changed'));
  assert.ok(read && read.includes('someone only talked about, thought of or written to is not there'), (read || '').slice(0, 200));
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Fine.' }) }]);
  await archivist.run(b.novelId);
  const audit = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes(prompts.AUDIT_ASK));
  assert.ok(audit && audit.includes('puts no one anywhere') && audit.includes('never what happened, until the book shows it'), (audit || '').slice(0, 200));
  await putAway(b);
  /* a check given some chapters only in short is told a chapter in short is a telling of it, not its words */
  await reset();
  await setHouse({ context: 20000 }, { checksFrom: 0, judge: { on: false } });
  const long = (who) => Array.from({ length: 400 }, (_, i) => `${who} walked the shore at dawn and counted the boats again, ${i + 1}.`).join(' ');
  const p = await makeBook([[long('Mara')], [long('Tom')], ['Mara kept the light.']], { manual: true });
  for (const [k, id] of p.ids.slice(0, 2).entries()) store.change('chapter', id, (c) => { c.summary = { text: `SUMMARY-${k + 1}.`, at: Date.now(), fp: shape.chapterPrint(c), by: 'you' }; }, { now: true });
  store.change('novel', p.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  markAllSeen(p);
  archivist.askAudit(p.novelId);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Fine.' }) }]);
  await archivist.run(p.novelId);
  const inShort = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes(prompts.AUDIT_ASK));
  assert.ok(inShort && inShort.includes('SUMMARY-1.') && inShort.includes('A chapter in short is a telling of it, not its words'), (inShort || archivist.lightOf(p.novelId).words).slice(0, 300));
  await setHouse();
  await putAway(p);
});

await test('the helper made way for his page reads on a little later — never a passage at a time for it, never counted against the book, and its light says why', async () => {
  /* (two passages read together: a chapter before the newest, whose last passage is read on its own) */
  const b = await makeBook([['MARA KEPT THE LIGHT.', 'TOM MENDED THE NETS.'], ['THE SEA ROSE.']], { manual: true });
  await script([{ hang_after: '{"people": [' }, { status: 503, message: 'busy' }, { text: 'The page, written.' }]);
  const reading = archivist.run(b.novelId);
  for (let i = 0; i < 100 && (await requests()).length < 1; i++) await sleep(30);
  await sleep(200);
  const page = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0] });
  await reading;
  assert.equal(page.ok, true, page.error);
  assert.ok(archivist.lightOf(b.novelId).words.includes('made way for your page'), archivist.lightOf(b.novelId).words);
  assert.ok(!archivist.forTests().narrow.has(b.novelId), 'never a passage at a time for it');
  assert.ok(!archivist.forTests().failures.get(b.novelId), 'never counted as a failure');
  await putAway(b);
});

await test('the checker made way for his page checks on a little later — never a passage at a time for it, never counted, never “couldn’t finish”; a head to head it was reading is read again, never let go for good', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['MARA KEPT THE LIGHT.', 'TOM MENDED THE NETS.']], { manual: true });
  const other = await makeBook([['The other book.']], { manual: true });
  await script([{ hang_after: '{"edits": [' }, { status: 503, message: 'busy' }, { text: 'The page, written.' }]);
  const checking = checker.runCheck(b.novelId);
  for (let i = 0; i < 100 && (await requests()).length < 1; i++) await sleep(30);
  await sleep(200);
  const page = await writer.writeNext({ novelId: other.novelId, chapterId: other.ids[0] });
  await checking;
  assert.equal(page.ok, true, page.error);
  const t = checker.forTests();
  assert.ok(!t.narrow.has(b.novelId), 'never a passage at a time for it');
  assert.ok(!t.failures.get(b.novelId), 'never counted as a failure');
  assert.ok(!/couldn’t finish|stopped/.test(checker.stateOf(b.novelId).words || ''), checker.stateOf(b.novelId).words);
  await putAway(b);
  /* a head to head it was reading when it made way */
  await reset();
  await setHouse({}, { checksFrom: 0 });
  const ask = { direction: 'She lights it.', length: 'scene' };
  const d = await makeBook([[{ text: 'Mara lit the lamp.', model: 'writer-a', how: 'write', ask }]], { manual: true });
  const pid = d.ch().passages[0].id;
  store.change('chapter', d.ids[0], shape.chapterSteps.addVersion(pid, shape.newVersion({ text: 'Mara looked at the lamp for a long time.', model: 'writer-b', how: 'another', ask: { ...ask } })), { now: true });
  await script([{ text: GRADED_NONE('1.1') }, { hang_after: '{"better": ' }, { status: 503, message: 'busy' }, { text: 'The page, written.' }]);
  const judging = checker.runCheck(d.novelId);
  for (let i = 0; i < 200 && (await requests()).length < 2; i++) await sleep(30);
  await sleep(200);
  assert.equal((await writer.writeNext({ novelId: other.novelId, chapterId: other.ids[0] })).ok, true);
  await judging;
  await reset();
  await script([{ text: JSON.stringify({ better: 'B', why: 'it acts' }) }, { text: JSON.stringify({ better: 'A', why: 'it acts' }) }]);
  await checker.runCheck(d.novelId);
  const duels = (await requests()).filter((x) => String(x.body.messages.at(-1).content).includes('Which is the better page'));
  assert.equal(duels.length, 2, 'the pair is read again');
  await setHouse();
  await putAway(d);
  await putAway(other);
});

await test('two asks to check one book at once, from one page, are one checking — never the same passages asked twice, never said to be another window’s', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: JSON.stringify({ edits: [] }) }, { text: JSON.stringify({ edits: [] }) }]);
  const seen = [];
  const off = checker.onChecks((id) => { if (id === b.novelId) seen.push(checker.stateOf(id).words); });
  await Promise.all([checker.runCheck(b.novelId), checker.runCheck(b.novelId)]);
  off();
  assert.equal((await requests()).length, 1);
  assert.ok(!seen.some((w) => String(w).startsWith('Another window')), JSON.stringify(seen));
  await setHouse();
  await putAway(b);
});

await test('a checking whose book another browser took over while it was asked says so — never “in a moment” for as long as the other holds it, nothing laid over its work', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara Venn kept the light at Crane Point.']], { manual: true });
  globalThis.__cozyLeaseMs = 6000;
  const realSI = globalThis.setInterval;
  globalThis.setInterval = (fn, ms, ...a) => (ms === 2000 ? 0 : realSI(fn, ms, ...a));
  try {
    await script([{ pause: 9, text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'kept', replace: 'KEPT', why: 'x' }] }) }]);
    const run = checker.runCheck(b.novelId);
    await sleep(7200);
    assert.deepEqual(await other(`checker:${b.novelId}`), { ok: true }, 'its lease ran out while it was frozen');
    await run;
  } finally { globalThis.setInterval = realSI; delete globalThis.__cozyLeaseMs; }
  assert.ok(checker.stateOf(b.novelId).words.startsWith('Another window or browser open on this book is checking it'), checker.stateOf(b.novelId).words);
  assert.equal(checker.suggestions(b.novelId).length, 0, 'nothing laid over the other browser’s work');
  await other(`checker:${b.novelId}`, { release: true });
  await setHouse();
  await putAway(b);
});

await test('an owner’s possessive is not a thing’s name — “Bruce’s Batwing” is the Batwing a reading writes to, never a second card; two owners stay two; a thing told by what it is (“Claire’s letter”, “the letter”) stays near, never the same; a thread’s owner is what it is about', () => {
  const lore = (cards, name) => shape.matchCard(cards, name, [], { kind: 'lore' });
  const bat = [{ id: 'b', name: 'the Batwing', about: 'His car.' }];
  assert.deepEqual([lore(bat, 'Bruce’s Batwing').card, lore(bat, "Bruce's Batwing").card].map((c) => c && c.id), ['b', 'b']);
  assert.equal(lore([{ id: 'x', name: 'Bruce’s Batwing' }], 'the Batwing').card.id, 'x', 'and the other way round');
  const files2 = [{ id: 'g', name: 'Gordon’s Case File' }, { id: 'c', name: 'Barbara’s Case File' }];
  assert.equal(lore([files2[0]], 'Barbara’s Case File').card, null, 'two owners are two things');
  assert.equal(lore(files2, 'the Case File').ambiguous, true, 'and the Case File names neither');
  assert.equal(shape.matchCard([{ id: 'h', name: 'the Lantern House' }], 'James’ Lantern House', [], { kind: 'places' }).card.id, 'h');
  assert.equal(lore([{ id: 'l', name: 'Claire’s letter' }], 'the letter').card, null, 'a thing told by what it is may be another of its kind');
  assert.equal(shape.matchCard([{ id: 'h', name: 'the house' }], 'James’ house', [], { kind: 'places' }).card, null);
  assert.equal(shape.matchCard([{ id: 't', name: 'Tom’s promise' }], 'the promise', [], { kind: 'threads' }).card, null, 'a thread keeps its owner');
  assert.equal(shape.matchCard([{ id: 't2', name: 'Tom’s Vow' }], 'the Vow', [], { kind: 'threads' }).card, null, 'a thread keeps its owner before a name of its own too: Tom’s Vow is not any vow');
  /* a reading's row */
  const out = archivist.foldNotes({ people: [], places: [], lore: [{ id: 'b', name: 'the Batwing', about: 'His car, kept under the manor.' }], threads: [] },
    { lore: [{ name: 'Bruce’s Batwing', about: 'His car, kept under the manor, now with a cracked windscreen.' }] }, { chapterId: 'c1' });
  assert.deepEqual(out.notes.lore.map((c) => [c.id, c.about]), [['b', 'His car, kept under the manor, now with a cracked windscreen.']]);
  /* a card of it under the owner's name, folded into the Batwing, goes only once the Batwing holds what it held */
  const fold = archivist.foldNotes({ people: [], places: [], lore: [{ id: 'b', name: 'the Batwing', about: 'His car.' }, { id: 'o', name: 'Bruce’s Batwing', about: 'Armoured, with a cracked windscreen.' }], threads: [] }, { gone: [{ kind: 'lore', name: 'Bruce’s Batwing' }] }, { audit: true });
  assert.deepEqual(fold.notes.lore.map((c) => c.id), ['b', 'o']);
  assert.ok(fold.refused.some((r) => r.why === 'what it holds is not on the Batwing yet'), JSON.stringify(fold.refused));
});

heading('the newest of Cozy Tavern (M752-008 to -017)');

await test('marks nobody reads are no words — emphasis, a zero-width space, a dash however typed, an ellipsis as dots — for his search, the partner’s quotes and the judge’s evidence; and the judge’s words with a comma left out are still the page’s', async () => {
  const words = 'She *knew* it was over — and the lamp​ went out… Tom said, quietly, that it was done.';
  const b = await makeBook([[words]], { manual: true });
  const found = (q) => search.searchBook({ novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, query: q }).length;
  assert.deepEqual(['she knew it was over', 'over--and the lamp went out...', 'lamp went out'].map(found), [1, 1, 1]);
  assert.equal(found('Tom said quietly'), 0, 'his search keeps the commas he types');
  assert.deepEqual(changes.locate('The lamp​ went out.', 'lamp went out'), { start: 4, end: 18 });
  /* the judge's "no", its words quoted without the commas: still the page's, and counted */
  await setHouse({}, { checksFrom: 0, judge: { target: 10 } });
  const yes = Object.fromEntries(prompts.JUDGE_CHECKS.map(([k]) => [k, 'yes']));
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks: { ...yes, sentences: 'no' }, faults: [{ check: 'sentences', words: 'Tom said quietly that it was done', why: 'flat' }] }] }) }]);
  await checker.runCheck(b.novelId);
  const g = checker.suggestions(b.novelId).find((x) => x.item.kind === 'grade');
  assert.deepEqual(g && g.item.grade.faults.map((f) => [f.check, f.words, Boolean(f.unverified)]), [['sentences', 'Tom said, quietly, that it was done', false]]);
  await setHouse();
  await putAway(b);
});

await test('a quote of the partner’s that is not on the page is told back with where it parts from the page and what the page says there — never a blind “not there” to guess at again', async () => {
  const b = await makeBook([['Mara kept the light through the long night, and the sea broke on the rocks below the tower.']], { manual: true });
  const r = changes.makeChange(b.novelId, { passage: '1.1', find: 'Mara kept the light through the night, and the sea', replace: 'Mara kept the lamp', why: 'x' }, { dry: true });
  assert.equal(r.status, 'refused');
  assert.equal(r.said, 'those words are not there — the page agrees up to “Mara kept the light through the”, and from there reads “long night, and the sea broke on the rocks below…”');
  const none = changes.makeChange(b.novelId, { passage: '1.1', find: 'The gulls were silent that winter', replace: 'x', why: 'x' }, { dry: true });
  assert.equal(none.said, 'those words are not there', 'nothing of it stands anywhere: nothing more to say');
  /* a start of it that stands in two places says nothing it cannot be sure of */
  const twice = await makeBook([['The sea was grey. The sea was grey and cold.']], { manual: true });
  assert.equal(changes.makeChange(twice.novelId, { passage: '1.1', find: 'The sea was blue', replace: 'x', why: 'x' }, { dry: true }).said, 'those words are not there');
  await putAway(twice);
  /* a summary's words, and the book's own, the same */
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: 'Mara keeps the light all night while the sea breaks below.', at: 1, by: 'you' }), { now: true });
  assert.ok(changes.makeChange(b.novelId, { summary: 1, find: 'Mara keeps the light all day', replace: 'x', why: 'x' }, { dry: true }).said.includes('the page agrees up to “Mara keeps the light all”, and from there reads “night while'));
  assert.ok(changes.makeChange(b.novelId, { book: 'about', find: 'A lighthouse keeper finds the bottle', replace: 'x', why: 'x' }, { dry: true }).said.includes('the page agrees up to “A lighthouse keeper finds”, and from there reads “a letter.”'));
  await putAway(b);
});

await test('a helper or a checker waiting out a failure, or stopped for a connection turned away, tries again the moment he asks — and stops again only if the trouble is still there', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  const A = archivist.forTests();
  A.failures.set(b.novelId, { n: 3, until: Date.now() + 600000 });
  assert.equal(archivist.stalled(b.novelId), true);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper.' }] }) }]);
  assert.equal(archivist.tryNow(b.novelId), true);
  for (let i = 0; i < 100 && archivist.pendingWork(b.novelId); i++) await sleep(50);
  assert.equal(archivist.pendingWork(b.novelId), false, 'read at once, never ten minutes on');
  assert.equal(archivist.stalled(b.novelId), false);
  /* stopped for good: tried again too */
  await reset();
  A.blocked.set(b.novelId, { conn: archivist.connPrint(writer.connFor(store.peek('house', 'house'), 'helper')), words: null });
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id, text: 'Mara kept the light. Tom came.' });
  await archivist.run(b.novelId);
  await quietAll();
  assert.equal(archivist.pendingWork(b.novelId), true, 'stopped: nothing read by itself');
  assert.equal((await requests()).length, 0);
  await script([{ text: JSON.stringify({ people: [{ name: 'Tom', about: 'A stranger.' }] }) }]);
  archivist.tryNow(b.novelId);
  for (let i = 0; i < 100 && archivist.pendingWork(b.novelId); i++) await sleep(50);
  assert.equal(archivist.pendingWork(b.novelId), false);
  /* the checker the same */
  await quietAll();
  await reset();
  const C = checker.forTests();
  C.blocked.set(b.novelId, archivist.connPrint(checker.checkerConn(store.peek('house', 'house'))));
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'stopped: nothing asked by itself');
  assert.equal(checker.stalled(b.novelId), true);
  await script([{ text: JSON.stringify({ edits: [] }) }]);
  assert.equal(checker.tryNow(b.novelId), true);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(50);
  for (let i = 0; i < 100 && C.running.size; i++) await sleep(50);
  assert.equal((await requests()).length, 1, 'asked at once');
  assert.equal(checker.stalled(b.novelId), false);
  await setHouse();
  await putAway(b);
});

await test('the notes’ check puts a card right only with names and figures the book gives — never one it made up; in its own words, and from his About this book too', async () => {
  const grounds = namesjs.foldedText('Mara kept the light at Crane Point. She was forty that winter. Tom came on the third night.\n\nMara: the keeper of the light. Her sister Ilse lives inland.');
  const notes = { people: [{ id: 'm', name: 'Mara', about: 'The keeper.', now: 'At the lamp.' }], places: [], lore: [], threads: [] };
  const fold = (row) => archivist.foldNotes(notes, { people: [row] }, { audit: true, grounds });
  /* in its own words, from the book: stands */
  assert.equal(fold({ name: 'Mara', about: 'The keeper of the light at Crane Point, aged 40, sister of Ilse.' }).notes.people[0].about, 'The keeper of the light at Crane Point, aged 40, sister of Ilse.');
  /* a figure and a name the book never gives: left as it was, and said */
  const made = fold({ name: 'Mara', about: 'The keeper, aged 34, who loves Kessa.' });
  assert.equal(made.notes.people[0].about, 'The keeper.');
  assert.ok(made.refused.some((r) => r.why === 'a name or a figure the book never gives (“34”) — left as it was'), JSON.stringify(made.refused));
  assert.equal(fold({ name: 'Mara', now: 'Gone to Kessa’s farm.' }).notes.people[0].now, 'At the lamp.');
  assert.equal(fold({ name: 'Mara', now: 'In the lamp room, as of Chapter 3.' }).notes.people[0].now, 'In the lamp room, as of Chapter 3.', 'where in the book is no figure of the story');
  /* someone it adds must be someone the book gives */
  const added = archivist.foldNotes(notes, { people: [{ name: 'Kessa', about: 'A friend.' }, { name: 'Tom', about: 'Came on the third night.' }] }, { audit: true, grounds });
  assert.deepEqual(added.notes.people.map((c) => c.name), ['Mara', 'Tom']);
  /* a thread's title is a telling: its own first word needs no grounding, a name in it does */
  const threads = archivist.foldNotes(notes, { threads: [{ name: 'Whether Mara forgives Tom', about: 'Open since the third night.' }, { name: 'Whether Kessa comes back', about: 'x' }] }, { audit: true, grounds });
  assert.deepEqual(threads.notes.threads.map((c) => c.name), ['Whether Mara forgives Tom']);
  assert.equal(fold({ name: 'Mara', ties: 'Close to Ilse; owes Kessa a debt.' }).notes.people[0].ties, undefined, 'how she stands, the same');
  /* a reading, from the passage it read, is not held to this */
  assert.equal(archivist.foldNotes(notes, { people: [{ name: 'Mara', about: 'The keeper, aged 34.' }] }, { chapterId: 'c1', grounds }).notes.people[0].about, 'The keeper, aged 34.');
  /* a name with a figure in it is one name — given by the book, it stands; one the book never gives is still left out */
  const droid = namesjs.foldedText('Mara kept the light with C3PO beside her.');
  assert.equal(archivist.foldNotes(notes, { people: [{ name: 'Mara', about: 'The keeper, with C3PO.' }] }, { audit: true, grounds: droid }).notes.people[0].about, 'The keeper, with C3PO.');
  assert.equal(archivist.foldNotes(notes, { people: [{ name: 'Mara', about: 'The keeper, with R2-D2.' }] }, { audit: true, grounds: droid }).notes.people[0].about, 'The keeper.');
  /* the check itself, against a book on the phone */
  await setHouse();
  const b = await makeBook([['Mara kept the light at Crane Point. She was forty that winter.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'The keeper.' })), { now: true });
  markAllSeen(b);
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', about: 'The keeper of Crane Point, aged 34.', why: 'her age' }], clear: false, verdict: 'Her age was missing.' }) }]);
  await archivist.run(b.novelId);
  assert.equal(b.novel().notes.people[0].about, 'The keeper.');
  assert.deepEqual(b.novel().memory.audit.refused.map((r) => r.why), ['a name or a figure the book never gives (“34”) — left as it was']);
  await putAway(b);
});

await test('notes longer than the helper’s model holds are checked a group at a time, one group straight after another until every card is checked — one check: what it put right counted together, one Undo for all of it, nothing more asked once the round is done', async () => {
  const b = await makeBook([['Mara met Card7 at the gate.']], { manual: true });
  const filler = Array.from({ length: 40 }, (_, i) => `Fact ${i} about this one, long and particular, kept for good.`).join(' ');
  const people = Array.from({ length: 30 }, (_, i) => ({ id: `pe-${i}`, name: `Card${i}`, aka: [], about: `Card${i} is a person. ${filler}`, now: '' }));
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people, places: [], lore: [], threads: [] }), { now: true });
  markAllSeen(b);
  await setHouse({ context: 32000 });
  archivist.askAudit(b.novelId);
  /* the first group puts Card0 right */
  await script([{ text: JSON.stringify({ people: [{ name: 'Card0', about: 'Card0 is a person who mends nets.', why: 'the book says so' }], clear: true, verdict: 'These hold.' }) }]);
  await archivist.run(b.novelId);
  let a = b.novel().memory.audit;
  assert.ok(a.some && a.some.checked < 30 && a.roundLeft === 30 - a.some.checked, JSON.stringify({ some: a.some, left: a.roundLeft }));
  assert.equal(b.novel().memory.auditAsked, true, 'the next group is due at once — never readings later');
  let checked = a.some.checked;
  const second = a.from;
  /* the next group, by itself: it puts the first card of its own group right */
  await script([{ text: JSON.stringify({ people: [{ name: `Card${second}`, about: `Card${second} is a person who mends nets.`, why: 'the book says so' }], clear: true, verdict: 'These hold.' }) }]);
  await archivist.run(b.novelId);
  checked += b.novel().memory.audit.some.checked;
  /* and on to the end of the round */
  for (let i = 0; i < 10 && b.novel().memory.auditAsked; i++) {
    await script([{ text: JSON.stringify({ clear: true, verdict: 'These hold.' }) }]);
    await archivist.run(b.novelId);
    checked += b.novel().memory.audit.some.checked;
  }
  a = b.novel().memory.audit;
  assert.equal(b.novel().memory.auditAsked, false, 'the round done, nothing more is asked');
  assert.equal(checked, 30, 'every card checked once in the round');
  assert.deepEqual([a.roundLeft, a.roundAll, a.roundFixed], [0, 30, 2], JSON.stringify({ left: a.roundLeft, all: a.roundAll, fixed: a.roundFixed }));
  assert.deepEqual(a.roundChanges.map((c) => c.name), ['Card0', `Card${second}`]);
  /* one Undo puts back what every group of it changed */
  const about = (n) => b.novel().notes.people.find((c) => c.name === `Card${n}`).about;
  assert.deepEqual([about(0), about(second)], ['Card0 is a person who mends nets.', `Card${second} is a person who mends nets.`]);
  assert.ok(archivist.undoLast(b.novelId));
  assert.ok(about(0).startsWith('Card0 is a person. Fact 0') && about(second).startsWith(`Card${second} is a person. Fact 0`), [about(0), about(second)].join(' | ').slice(0, 200));
  await setHouse();
  await putAway(b);
});

await test('a book added from a copy keeps what the helper read and paid for — named by its new chapters — and where he was, and the partner’s Undo; nothing read again', async () => {
  const b = await makeBook([['Mara kept the light.'], ['Tom came at dawn.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, shape.novelSteps.setPref('at', b.ids[1]), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setAside({ ['summary:' + b.ids[0]]: { chapterId: b.ids[0], fp: 'x', label: 'the summary of Chapter One', why: 'no', at: 1 } }), { now: true });
  await store.flush();
  const talkData = { id: b.novelId, novelId: b.novelId, turns: [{ id: 't1', by: 'ai', versions: [{ id: 'v1', text: 'Done.', changes: [{ id: 'cg1', status: 'made', undo: { what: 'passage', chapterId: b.ids[1], passageId: b.ch(1).passages[0].id } }] }] }] };
  const records = [{ kind: 'novel', id: b.novelId, data: b.novel() }, ...b.ids.map((id) => ({ kind: 'chapter', id, data: store.peek('chapter', id) })), { kind: 'talk', id: b.novelId, data: talkData }];
  const [copy] = files.booksFromLibrary({ records });
  const [c1, c2] = copy.novel.order;
  assert.ok(c1 !== b.ids[0] && c2 !== b.ids[1] && copy.novel.id !== b.novelId, 'new names');
  assert.deepEqual(Object.keys(copy.novel.memory.seen).sort(), [c1, c2].sort(), 'what was read, named by the new chapters');
  assert.equal(copy.novel.prefs.at, c2);
  assert.deepEqual(Object.keys(copy.novel.memory.aside), ['summary:' + c1]);
  assert.equal(copy.talk.turns[0].versions[0].changes[0].undo.chapterId, c2);
  for (const id of copy.novel.order) await store.create('chapter', id, copy.chapters[id]);
  await store.create('novel', copy.novel.id, copy.novel);
  assert.equal(archivist.pendingWork(copy.novel.id), false, 'nothing to read again');
  await putAway(b);
  await putAway({ novelId: copy.novel.id });
});

heading('the checker: a grade kept through its fixes, and graded when he asks (2.6.3)');

await test('a grade stays with the words its fixes made — applied by his hand or by themselves: the score, the average and the card still there', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Mara climbed the the stair.', 'Tom came up the the path.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' },
    { passage: '1.2', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' },
  ], grades: [{ passage: '1.1', checks: ALL_YES(), faults: [] }, { ...failing(3, 'Make it move.', 'Tom came up'), passage: '1.2' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.deepEqual(checker.gradesOf(b.novelId).rows.map((r) => r.overall), [10, 7]);
  /* by his hand: the fix to the passage under the mark, and Apply all for the rest */
  const s = checker.suggestions(b.novelId);
  const fix2 = s.find((x) => x.number === 2 && x.item.kind === 'grammar');
  assert.equal(checker.applyOne(b.novelId, fix2.chapterId, fix2.passageId, fix2.item.id).ok, true);
  checker.applyAll(b.novelId);
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['Mara climbed the stair.', 'Tom came up the path.']);
  assert.deepEqual(checker.gradesOf(b.novelId).rows.map((r) => r.overall), [10, 7], 'the grades stay with the fixed words');
  assert.deepEqual(checker.suggestions(b.novelId).map((x) => [x.number, x.item.kind, x.item.grade && x.item.grade.overall]), [[2, 'grade', 7]], 'the card and the grade agree');
  assert.equal(checker.stateOf(b.novelId).state, 'found');
  await putAway(b);
  /* by themselves */
  await setHouse({}, { checksFrom: 0, autoFix: { on: true, from: Date.now() - 1000 } });
  await reset();
  const c = await makeBook([['Mara climbed the the stair.']]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }], grades: [{ passage: '1.1', checks: ALL_YES(), faults: [] }] }) }]);
  await checker.runCheck(c.novelId);
  assert.deepEqual([picked(c.ch().passages[0]).text, picked(c.ch().passages[0]).hands], ['Mara climbed the stair.', ['checker']], 'on the page itself (2.12.2)');
  assert.deepEqual(checker.gradesOf(c.novelId).rows.map((r) => r.overall), [10], 'in by itself, the grade kept');
  await setHouse();
  await putAway(c);
});

await test('a grade a fix lost before 2.6.3 is put back from the version the fix was made from — on opening the book and before each look, no model asked', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Mara climbed the the stair and and waited.']]);
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' },
    { passage: '1.1', kind: 'grammar', find: 'and and', replace: 'and', why: 'doubled' },
  ], grades: [{ ...failing(2, 'Closer.', 'Mara climbed'), passage: '1.1' }] }) }]);
  await checker.runCheck(b.novelId);
  /* two fixes, one at a time: a chain of fixed versions, as 2.12.1 and before made them (since 2.12.2 a fix is on the
   * page itself — the chain is laid down here as a book kept from then holds it) */
  const p = () => b.ch().passages[0];
  const first = picked(p());
  const e0 = b.ch().checks[p().id][first.id];
  const one = shape.newVersion({ text: 'Mara climbed the stair and and waited.', how: 'suggested', round: e0.round, from: first.id, ...shape.rootOf(first) });
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p().id, one), { now: true });
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p().id, one.id, { ...(({ grade: _g, ...x }) => x)(e0), sig: util.hashText(one.text), items: [] }), { now: true });
  const two = shape.newVersion({ text: 'Mara climbed the stair and waited.', how: 'suggested', round: e0.round, from: one.id, ...shape.rootOf(first) });
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p().id, two), { now: true });
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p().id, two.id, { ...e0, sig: util.hashText(two.text), items: [] }), { now: true });
  const v = picked(p());
  assert.equal(v.text, 'Mara climbed the stair and waited.');
  /* as 2.6.2 and before kept it: the fixed version's checking with no grade */
  const e = b.ch().checks[p().id][v.id];
  const { grade: _gone, ...lost } = e;
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p().id, v.id, lost), { now: true });
  assert.equal(checker.gradesOf(b.novelId).rows.length, 0, 'lost, as he saw it');
  await reset();
  assert.equal(checker.keepGrades(b.novelId), 1);
  assert.deepEqual(checker.gradesOf(b.novelId).rows.map((r) => r.overall), [8], 'put back from two versions before');
  assert.equal((await requests()).length, 0, 'no model asked');
  assert.equal(checker.keepGrades(b.novelId), 0, 'once');
  /* before each look too */
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p().id, v.id, lost), { now: true });
  await checker.runCheck(b.novelId);
  assert.deepEqual(checker.gradesOf(b.novelId).rows.map((r) => r.overall), [8]);
  assert.equal((await requests()).length, 0);
  /* never from a checking that no longer reads as its version does */
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p().id, v.id, lost), { now: true });
  store.change('chapter', b.ids[0], (c) => { for (const x of c.passages[0].versions) if (x.id !== v.id && c.checks[c.passages[0].id][x.id]) c.checks[c.passages[0].id][x.id].sig = 'other words'; }, { now: true });
  assert.equal(checker.keepGrades(b.novelId), 0);
  assert.equal(checker.gradesOf(b.novelId).rows.length, 0);
  await setHouse();
  await putAway(b);
});

await test('checked with the judge off, or graded before the ten checks: said, never asked by itself — Check this chapter asks for the grade alone, what it found kept; a model that will not grade it is not asked again', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara climbed the the stair.', 'Tom came up the path.']]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }] }) }]);
  await checker.runCheck(b.novelId);
  const before = checker.suggestions(b.novelId).map((x) => x.item.id);
  assert.equal(before.length, 1);
  /* the judge switched on: nothing is sent by itself — the bubble says so, and the button is there */
  await setHouse({}, { checksFrom: 0 });
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await requests()).length, 0, 'never asked by itself');
  assert.deepEqual(checker.unchecked(b.novelId, b.ids[0]), { passages: 0, words: 0, ungraded: 2 });
  /* (with nothing left to look at, the green line says it) */
  const leave = checker.suggestions(b.novelId)[0];
  checker.leaveOne(leave.chapterId, leave.passageId, leave.item.id);
  assert.match(checker.stateOf(b.novelId).words, /2 passages are checked but not graded yet — Check this chapter, or Check the whole book, grades them\./);
  /* Check this chapter: the grades alone */
  await putAway(b);
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  await reset();
  const c = await makeBook([['Mara climbed the the stair.', 'Tom came up the path.']]);
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }] }) }]);
  await checker.runCheck(c.novelId);
  const ids = checker.suggestions(c.novelId).map((x) => x.item.id);
  await setHouse({}, { checksFrom: 0 });
  await reset();
  checker.checkChapter(c.novelId, c.ids[0]);
  await script([{ text: JSON.stringify({ grades: [{ passage: '1.1', checks: ALL_YES(), faults: [] }, { ...failing(3, 'Make it move.', 'Tom came up'), passage: '1.2' }] }) }]);
  await checker.runCheck(c.novelId);
  const asks = await checkAsk();
  assert.equal(asks.length, 1, 'one checking');
  assert.ok(asks[0].includes('Answer every check of every passage') && !asks[0].includes('Suggest only what is worth changing'), 'the grades alone');
  assert.deepEqual(checker.gradesOf(c.novelId).rows.map((r) => r.overall), [10, 7]);
  const now = checker.suggestions(c.novelId);
  assert.deepEqual(now.map((x) => [x.number, x.item.kind]), [[1, 'grammar'], [2, 'grade']], 'what it found kept, and the card for the one under the mark');
  assert.equal(now[0].item.id, ids[0], 'the same suggestion');
  assert.deepEqual(checker.unchecked(c.novelId), { passages: 0, words: 0, ungraded: 0 });
  await putAway(c);
  /* in one chapter, an older passage never checked and one checked but not graded: each its own checking */
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  await reset();
  const m = await makeBook([['Mara climbed the stair.', { text: 'Old words from before.', at: 0 }]]);
  await setHouse({}, { checksFrom: Date.now() - 60000, judge: { on: false } });
  await script([CK_NONE]);
  await checker.runCheck(m.novelId);
  await setHouse({}, { checksFrom: Date.now() - 60000 });
  assert.deepEqual(checker.unchecked(m.novelId), { passages: 1, words: 4, ungraded: 1 });
  await reset();
  checker.checkChapter(m.novelId, m.ids[0]);
  await checker.runCheck(m.novelId);
  const two = await checkAsk();
  assert.equal(two.length, 2, 'two checkings');
  const whole = two.find((x) => x.includes('Suggest only what is worth changing'));
  const alone = two.find((x) => !x.includes('Suggest only what is worth changing'));
  assert.ok(whole && checkedPart(whole).includes('[1.2] Old words') && !checkedPart(whole).includes('[1.1]'), 'the one never checked, checked whole');
  assert.ok(alone && checkedPart(alone).includes('[1.1] Mara climbed') && !checkedPart(alone).includes('[1.2]'), 'the other, its grade alone');
  assert.equal(checker.gradesOf(m.novelId).rows.length, 2);
  await putAway(m);
  /* a grade from before the ten checks (one number on another scale) is graded again the same way */
  await reset();
  const d = await makeBook([['Mara kept the light.']]);
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks: ALL_YES(), faults: [] }] }) }]);
  await checker.runCheck(d.novelId);
  const dp = d.ch().passages[0];
  const de = d.ch().checks[dp.id][picked(dp).id];
  store.change('chapter', d.ids[0], shape.chapterSteps.setCheck(dp.id, picked(dp).id, { ...de, grade: { overall: 7, prose: 7 } }), { now: true });
  assert.equal(checker.unchecked(d.novelId).ungraded, 1);
  /* a model that answers without a grade: kept as checked, not asked again */
  checker.checkChapter(d.novelId, d.ids[0]);
  await reset();
  await script([{ text: '{"grades": []}' }]);
  await checker.runCheck(d.novelId);
  assert.equal((await checkAsk()).length, 1);
  assert.deepEqual([checker.unchecked(d.novelId).ungraded, checker.waiting(d.novelId)], [0, 0], 'never asked in a loop');
  await reset();
  await checker.runCheck(d.novelId);
  assert.equal((await requests()).length, 0);
  await setHouse();
  await putAway(d);
});

heading('the note at the end as he chooses, and words in the storyteller’s own voice (2.6.4)');

const claudePage = (text) => [
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
];

await test('the note at the end rides as he chose it — the setup’s words, his, or the storyteller’s own voice — for the book and for scenes alike', async () => {
  const ins = (extra) => ({ instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'NARR', late: 'BOOK NOTE', lateNarrator: 'SCENE NOTE', partner: '', ...extra } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  const roles = async () => (await requests()).map((x) => x.body.messages.slice(-2).map((m) => [m.role, m.content]));
  /* his for the book, the storyteller's own for scenes — each note its own */
  await setHouse({}, ins({ lateAs: 'user', lateNarratorAs: 'assistant' }));
  await reset();
  await script([{ text: 'A page.' }, { text: 'The gate creaks.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mina' });
  await talk.playSay({ playId: id, text: 'I wait.' });
  let [w, p] = (await requests()).map((x) => x.body.messages.at(-1));
  assert.ok(w.role === 'user' && w.content.includes('She waits.') && w.content.endsWith('BOOK NOTE'), 'the book: with his request, last');
  assert.deepEqual([p.role, p.content], ['assistant', 'SCENE NOTE'], 'a scene: in the narrator’s own voice, last');
  /* the other way round */
  await setHouse({}, ins({ lateAs: 'assistant', lateNarratorAs: 'user' }));
  await reset();
  await script([{ text: 'Another page.' }, { text: 'The gate shuts.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits more.' });
  await talk.playSay({ playId: id, text: 'I wait more.' });
  const own = await roles();
  assert.deepEqual(own[0][1], ['assistant', 'BOOK NOTE'], 'the book: last, in the writer’s own voice');
  assert.equal(own[0][0][0], 'user', 'right after what he asks');
  assert.ok(own[1][1][0] === 'user' && own[1][1][1].includes('I wait more.') && own[1][1][1].endsWith('SCENE NOTE'), 'a scene: with his move');
  /* the setup's, as before */
  await setHouse({}, ins({}));
  await reset();
  await script([{ text: 'A third page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She sleeps.' });
  [w] = (await requests()).map((x) => x.body.messages.at(-1));
  assert.deepEqual([w.role, w.content], ['system', 'BOOK NOTE']);
  assert.equal(prompts.lateRoleFor({ lateAs: 'nonsense' }, 'write'), 'system', 'anything else: the setup’s words');
  await setHouse();
  await putAway(b);
});

await test('the storyteller’s own voice refused: sent again as the setup’s words, remembered — and the setup’s words refused there too: his', async () => {
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', late: 'BOOK NOTE', partner: '', lateAs: 'assistant' } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ status: 400, message: 'Invalid request: the last message must be a user message, not assistant.' }, { text: 'A page.' }, { text: 'Next page.' }]);
  const r = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  assert.equal(r.ok, true, JSON.stringify(r));
  let sent = (await requests()).map((x) => x.body.messages.at(-1));
  assert.deepEqual(sent.map((m) => [m.role, m.content]), [['assistant', 'BOOK NOTE'], ['system', 'BOOK NOTE']]);
  const p = b.ch().passages.at(-1);
  assert.ok((picked(p).notes || []).some((n) => n.includes('storyteller’s own voice') && n.includes('setup’s words')), JSON.stringify(picked(p).notes));
  await reset();
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits more.' });
  sent = (await requests()).map((x) => x.body.messages.at(-1));
  assert.deepEqual(sent.map((m) => m.role), ['system'], 'remembered: the setup’s words at once');
  /* a model that takes no system message there either: with his request */
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', late: 'BOOK NOTE', partner: '', lateAs: 'assistant' } });
  await reset();
  await script([{ status: 400, message: 'The final message must be a user message (assistant prefill is not supported).' }, { status: 400, message: 'A system message is not allowed after the first message.' }, { text: 'A page.' }]);
  assert.equal((await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She rests.' })).ok, true);
  sent = (await requests()).map((x) => x.body.messages.at(-1));
  assert.deepEqual(sent.map((m) => m.role), ['assistant', 'system', 'user']);
  assert.ok(sent[2].content.includes('She rests.') && sent[2].content.endsWith('BOOK NOTE'), 'with his request');
  await setHouse();
  await putAway(b);
});

await test('the storyteller’s own voice on Claude: his prefill begins the page after it; with thinking set it rides as the setup’s words, and says why', async () => {
  await setHouse({ shape: 'anthropic', prefill: 'Mara' }, { instructions: { system: 'HIS OWN WORDS FIRST', late: 'BOOK NOTE', partner: '', lateAs: 'assistant' } });
  const b = await makeBook([['The lamp was cold.']], { manual: true });
  await script([{ events: claudePage(' lit the lamp.') }]);
  assert.equal((await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She lights it.' })).ok, true);
  let [body] = (await requests()).map((x) => x.body);
  assert.deepEqual(body.messages.at(-1), { role: 'assistant', content: 'BOOK NOTE\n\nMara' }, 'one started reply: his words, then his prefill');
  assert.equal(picked(b.ch().passages.at(-1)).text, 'Mara lit the lamp.', 'the page: his prefill and what followed — never the note');
  await setHouse({ shape: 'anthropic', thinking: 'high' }, { instructions: { system: 'HIS OWN WORDS FIRST', late: 'BOOK NOTE', partner: '', lateAs: 'assistant' } });
  await reset();
  await script([{ events: claudePage('A page for Claude.') }]);
  assert.equal((await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' })).ok, true);
  [body] = (await requests()).map((x) => x.body);
  assert.deepEqual([body.messages.at(-1).role, body.messages.at(-1).content], ['system', 'BOOK NOTE']);
  assert.ok((picked(b.ch().passages.at(-1)).notes || []).some((n) => n.includes('skip its thinking') && n.includes('high')));
  await setHouse();
  await putAway(b);
});

await test('words in the storyteller’s own voice ride where he put them, whose he said, to whom he said — off or empty, nothing changes', async () => {
  const own = [
    { id: 'ow1', name: 'Stay Batman', role: 'teller', place: 'before-pages', to: 'both', text: '{{char}} here, still me.' },
    { id: 'ow2', name: 'Mine', role: 'you', place: 'before-your-message', to: 'write', text: 'BEFORE MY ASK' },
    { id: 'ow3', name: 'House', role: 'house', place: 'after-your-message', to: 'play', text: 'AFTER HIS MOVE' },
    { id: 'ow4', on: false, role: 'teller', place: 'after-your-message', to: 'both', text: 'SWITCHED OFF' },
    { id: 'ow5', role: 'teller', place: 'after-your-message', to: 'both', text: '   ' },
  ];
  await setHouse({}, { ownWords: own, instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'NARR', late: '', partner: '' } });
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  await script([{ text: 'A page.' }, { text: 'The gate creaks.' }, { text: 'Talk.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mina' });
  await talk.playSay({ playId: id, text: 'I wait.' });
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thoughts?' });
  const [w, p, t] = (await requests()).map((x) => x.body.messages.filter((m) => m.role !== 'system' || x.body.messages.indexOf(m) > 0));
  const flat = (list) => JSON.stringify(list);
  /* the writer: his line first (the request opens on the storyteller's words), the words before the story, his own before his request */
  assert.deepEqual(w.slice(0, 2).map((m) => [m.role, m.content]), [['user', prompts.PICK_UP], ['assistant', 'the writer here, still me.']]);
  const ask = w.at(-1);
  assert.ok(ask.role === 'user' && ask.content.startsWith('BEFORE MY ASK') && ask.content.includes('She waits.'), ask.content.slice(0, 120));
  assert.ok(!flat(w).includes('AFTER HIS MOVE') && !flat(w).includes('SWITCHED OFF'));
  /* the narrator: its own words with the narrator's name, the setup's after his move — never the writer's own */
  assert.ok(flat(p).includes('the narrator here, still me.') && !flat(p).includes('BEFORE MY ASK'));
  assert.deepEqual([p.at(-1).role, p.at(-1).content], ['system', 'AFTER HIS MOVE']);
  /* the partner: none of it */
  assert.ok(!flat(t).includes('still me') && !flat(t).includes('BEFORE MY ASK') && !flat(t).includes('AFTER HIS MOVE'));
  /* all off: the requests are what they were */
  await setHouse({}, { ownWords: own.map((x) => ({ ...x, on: false })), instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'NARR', late: '', partner: '' } });
  await reset();
  await script([{ text: 'Another page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She waits.' });
  const [w2] = (await requests()).map((x) => x.body.messages);
  assert.ok(!flat(w2).includes('still me') && !flat(w2).includes('BEFORE MY ASK') && w2.find((m) => m.role !== 'system').role === 'user' && w2.find((m) => m.role !== 'system').content !== prompts.PICK_UP);
  await setHouse();
  await putAway(b);
});

await test('a preset keeps his words in the storyteller’s own voice, and puts them back; one saved before keeps his as they are', async () => {
  const mine = [{ id: 'ow1', on: true, name: 'Stay Batman', role: 'teller', place: 'before-pages', to: 'both', text: 'Batman here.' }];
  const house = { instructions: { system: 'BATMAN WORDS' }, you: { name: 'Bruce' }, ownWords: mine };
  const v = presetsMod.voiceOf(house);
  assert.deepEqual(v.own.map((w) => w.text), ['Batman here.']);
  const other = { instructions: { system: 'OTHER' }, ownWords: [] };
  presetsMod.presetSteps.use(v)(other);
  assert.deepEqual([other.instructions.system, other.ownWords.map((w) => w.text)], ['BATMAN WORDS', ['Batman here.']]);
  /* a preset from before keeps his */
  const old = { boxes: { system: 'OLD', narrator: '', partner: '', late: '', lateNarrator: '', avoid: '' }, name: 'Bruce' };
  presetsMod.presetSteps.use(old)(other);
  assert.deepEqual([other.instructions.system, other.ownWords.map((w) => w.text)], ['OLD', ['Batman here.']]);
  assert.equal(presetsMod.sameVoice(presetsMod.cleanVoice(old), presetsMod.voiceOf(other)), true, 'the old one is the one in use');
  assert.equal(presetsMod.sameVoice(v, presetsMod.voiceOf({ ...house, ownWords: [] })), false, 'different words: not the same voice');
});

heading('what wrote a page stays with it, and the judge read as it answers (2.6.5)');

/* (through 2.12.1 each change made a version of its own that took the request and thinking but never the model — since
 * 2.12.2 the words change on the page itself: the version keeps all it had, the writer's own words kept beside them,
 * and whose hands changed it says what is still the writer's) */
await test('words changed on a page keep what wrote them — What the writer was sent and its thinking, the writer’s own words and its model: the checker’s fixes by his tap or by themselves, his edit, his partner’s words; and the grade counts for the writer only while it is the writer’s', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 }, instructions: { system: 'HIS OWN WORDS FIRST', late: '', partner: '' } });
  const b = await makeBook([['The lamp was cold.']], { manual: true });
  const pid = b.ch().passages[0].id;
  /* his Rewrite, then its fix in by itself */
  await script([{ text: 'Mara lit the the lamp.', think: 'She should light it at once.' }, { text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }] }) }]);
  assert.equal((await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, note: 'She lights it.' })).ok, true);
  const written = picked(b.ch().passages[0]);
  assert.ok(written.sent && written.thinking, 'the rewrite has its request and thinking');
  await checker.runCheck(b.novelId);
  let v = picked(b.ch().passages[0]);
  assert.deepEqual([v.id, v.how, v.text, v.sent, v.thinking, v.model, v.written, v.hands], [written.id, 'rewrite', 'Mara lit the lamp.', written.sent, written.thinking, written.model, 'Mara lit the the lamp.', ['checker']], 'fixed on the page: the same request, thinking and model; the writer’s own words kept');
  assert.deepEqual(checker.gradesOf(b.novelId).models.map((m) => [m.model, m.mixed, m.words]), [[written.model, false, 5]], 'with the checker’s fixes in, still the writer’s — counted on its own words');
  /* his edit of it */
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, text: 'Mara lit the lamp at last.' });
  v = picked(b.ch().passages[0]);
  assert.deepEqual([v.how, v.sent, v.thinking, v.hands], ['rewrite', written.sent, written.thinking, ['checker', 'you']]);
  assert.deepEqual(checker.gradesOf(b.novelId).models.map((m) => [m.model, m.mixed]), [['', true]], 'his words in it: no longer the writer’s alone');
  /* his partner's words in it */
  const made = changes.makeChange(b.novelId, { passage: '1.1', find: 'at last', replace: 'quickly' });
  assert.equal(made.status, 'made', JSON.stringify(made));
  v = picked(b.ch().passages[0]);
  assert.deepEqual([v.how, v.text, v.sent, v.thinking, v.hands], ['rewrite', 'Mara lit the lamp quickly.', written.sent, written.thinking, ['checker', 'you', 'partner']]);
  /* and what was sent is still there to read */
  const r = await realFetch(`${BASE}/api/sent/${b.novelId}/${encodeURIComponent(v.sent)}`);
  assert.equal(r.status, 200, 'the request kept on the phone');
  await setHouse();
  await putAway(b);
});

await test('the judge’s checks read by their names in any form — “Opening”, “True to the book”, true_to_the_book — never taken for a pass; an answer naming none of them is no grade', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Mara climbed the stair slowly and looked out at the grey sea below the light.']]);
  const named = { Opening: 'yes', 'True to the book': 'No', Shown: 'yes', pacing: 'yes', SPECIFIC: 'yes', fresh: 'yes', sentences: 'yes', People: 'yes', moves: 'no', Ending: 'yes' };
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks: named, faults: [
    { check: 'True to the book', words: 'the grey sea', why: 'the notes say green' },
    { check: 'Moves', words: 'looked out at the grey sea', why: 'nothing changes' }] }] }) }]);
  await checker.runCheck(b.novelId);
  const [row] = checker.gradesOf(b.novelId).rows;
  assert.deepEqual([row.overall, row.faults.map((f) => [f.check, f.words])], [8, [['canon', 'the grey sea'], ['moves', 'looked out at the grey sea']]]);
  /* an answer whose checks name none of the ten: asked again for the grades, never ten of ten */
  const c = await makeBook([['Mara kept the light.']]);
  await reset();
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks: { style: 'yes', vibe: 'yes' } }] }) }, { text: JSON.stringify({ grades: [{ passage: '1.1', checks: ALL_YES(), faults: [] }] }) }]);
  await checker.runCheck(c.novelId);
  assert.equal((await checkAsk()).length, 2, 'asked once more');
  assert.equal(checker.gradesOf(c.novelId).rows.length, 1);
  await setHouse();
  await putAway(b);
  await putAway(c);
});

await test('a “no” quoted with a word of its own counts by the page’s own words — six or more of them in a row; a quote the page does not hold is kept, shown and not counted', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['She climbed the narrow stair to the lamp room and waited for the storm to break over the rocks.']]);
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks: { ...ALL_YES(), pacing: 'no', ending: 'no' }, faults: [
    { check: 'pacing', words: 'she climbed the steep stair to the lamp room and waited for the storm', why: 'rushed' },
    { check: 'ending', words: 'the weather turned', why: 'ends on the weather' }] }] }) }]);
  await checker.runCheck(b.novelId);
  const [row] = checker.gradesOf(b.novelId).rows;
  assert.equal(row.overall, 9, 'the near quote counts; the one the page does not hold does not');
  const pacing = row.faults.find((f) => f.check === 'pacing');
  assert.equal(pacing.words, 'stair to the lamp room and waited for the storm', 'the longest stretch of the page’s own words');
  const ending = row.faults.find((f) => f.check === 'ending');
  assert.deepEqual([ending.unverified, ending.said], [true, 'the weather turned'], 'kept with what it quoted, to be shown');
  await setHouse();
  await putAway(b);
});

heading('what his words and the notes explain is the writer’s, never everyone’s in the story (2.6.6)');

/* his report: Jovan uses one of his two powers a day to save Yuki, and Kenjaku asks "How many of those do you have left?" */
await test('what his words explain stays the writer’s — said with every request that carries his words: a new page, another take, a rewrite, a part rewritten, Go on; never asked of what each person “knows” because of a change', async () => {
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', late: '', partner: '' } });
  const b = await makeBook([['Jovan watched from the roof.']]);
  const all = (r) => r.body.messages.map((m) => String(m.content || '')).join('\n');
  const ASK = 'Jovan uses one of his two powers a day to save Yuki.';
  await script([{ text: 'He dropped from the roof.' }, { text: 'Rain on the roof.' }, { text: 'He fell like a stone.' }, { text: 'He fell again.' }, { text: 'He fell once more.' }, { text: 'Jovan ⟦jumped⟧ from the roof.' }, { text: 'Jovan ⟦leapt⟧ from the roof.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: ASK });
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '' });
  const p2 = b.ch().passages[1].id;
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2 });
  await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2, note: 'He spends his second power of the day on her.' });
  await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2, note: '' });
  const p1 = b.ch().passages[0].id;
  await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1, start: 6, end: 13, note: 'with his power' });
  await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1, start: 6, end: 13, note: '' });
  const r = await requests();
  const asks = r.map(askOf);
  const said = asks.map((a) => a.includes(prompts.YOURS_ONLY));
  assert.deepEqual(said, [true, false, true, true, false, true, false], 'his words: a new page, another take of it, a rewrite with his note, a part with his note — none where he gave no words');
  assert.ok(asks[0].indexOf(ASK) < asks[0].indexOf(prompts.YOURS_ONLY), 'right after what he asked');
  assert.ok(prompts.YOURS_ONLY.includes('how a power works, its rules and limits, how many') && prompts.YOURS_ONLY.includes('nobody says it, guesses it or acts on it') && prompts.YOURS_ONLY.includes('unless I say someone learns more'));
  for (const x of r) {
    const t = all(x);
    assert.ok(!/knows,? and feels because of it|knows and feels because/.test(t), 'nothing asks what each person knows because of the change');
  }
  assert.ok(asks[3].includes('what each person who meets it does, says and feels'), asks[3]);
  /* the novel craft says it the same way */
  const sys = r[0].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(sys.includes('A Rewrite Carries Its Change') && sys.includes('knowing only what they see of it'), 'the craft’s rewrite law');
  assert.ok(sys.includes(prompts.NOTES_KNOW), 'the notes, in the system message: who knows what in the story');
  /* Go on of a page stopped partway that he gave words to */
  await reset();
  await script([{ hang_after: 'Jovan raised his hand and' }, { text: 'his hand and the light came.' }]);
  const run = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: ASK });
  await sleep(900);
  writer.stop(b.novelId);
  await run;
  const p = b.ch().passages.at(-1);
  assert.equal((await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id })).ok, true);
  const on = (await requests()).map(askOf).at(-1);
  assert.ok(on.includes('What I asked for in it: ' + ASK) && on.includes(prompts.YOURS_ONLY), on);
  await setHouse();
  await putAway(b);
});

await test('the notes are the teller’s wherever they ride — the setup’s words, his notes, the writer’s notebook, a scene; the narrator keeps his character’s thoughts; the partner writes a passage the same way', async () => {
  const b = await makeBook([['Mina waited at the gate. Joon was beside her.']]);
  const all = (x) => x.body.messages.map((m) => String(m.content || '')).join('\n');
  const count = (t, w) => t.split(w).length - 1;
  for (const as of ['user', 'assistant']) {
    await setHouse({}, { notesAs: as });
    await reset();
    await script([{ text: 'A page.' }]);
    await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Mina opens the gate.' });
    const x = (await requests())[0];
    const notes = x.body.messages.find((m) => m.role === as && String(m.content).includes('Mina waited at the gate.'));
    assert.ok(notes && notes.content.includes(prompts.NOTES_KNOW), `the notes as ${as} say it`);
    assert.equal(count(all(x), prompts.NOTES_KNOW), 1, 'said once');
  }
  /* a scene: in the system message, and his character's thoughts are the narrator's alone */
  await setHouse({}, { instructions: { system: 'HIS OWN WORDS FIRST', narrator: 'THE NARRATOR', late: '', partner: '' } });
  await reset();
  const id = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Joon' });
  await script([{ text: 'The gate creaks.' }]);
  await talk.playSay({ playId: id, text: 'I use my last charm. (Two a day, and this is my second.)' });
  const play = (await requests())[0];
  const psys = play.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.ok(psys.includes('What I write of Joon’s thoughts, and anything my lines explain') && psys.includes('everyone else knows only what Joon lets them see and hear'), psys.slice(0, 200));
  assert.equal(count(all(play), prompts.NOTES_KNOW), 1, 'the notes, for the narrator alone');
  /* the partner: told for a passage it writes; the notes as it talks them over are not fenced off from it */
  await reset();
  await script([{ text: 'Fine as it is.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'How is it?' });
  const part = (await requests())[0];
  assert.ok(all(part).includes('A passage you write is the book: in it, people know only what they have lived, seen or been told'), 'its passages');
  assert.equal(count(all(part), prompts.NOTES_KNOW), 0, 'it talks the book over knowing all of it');
  await setHouse();
  await putAway(b);
});

await test('the checker and the judge look for someone knowing what they never lived, saw or were told — what his words to the writer explain included', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Jovan raised a hand and the blade stopped in the air. “Stranger. How many of those do you have left?” Kenjaku asked.']]);
  await script([{ text: JSON.stringify({ edits: [], grades: [{ passage: '1.1', checks: ALL_YES(), faults: [] }] }) }]);
  await checker.runCheck(b.novelId);
  const [x] = (await requests()).filter((q) => String(q.body.messages.at(-1).content).includes('Check these passages from'));
  const t = x.body.messages.map((m) => String(m.content || '')).join('\n');
  assert.ok(t.includes('But someone knowing what they never lived, saw or were told — a secret, how another’s power works or its limits, what my words to the writer explain — beyond what anyone there would plainly make of it, is a slip.'), 'the checker');
  assert.ok(t.includes('who knows what (nobody knows what they never lived, saw or were told)'), 'the judge’s True to the book');
  await setHouse();
  await putAway(b);
});

heading('the chapter so far, the story map, and what was put right after 2.10 (2.11)');

const stretchesMod = await import(path.join(ROOT, 'js/novel/stretches.js'));
const structuredM = await import(path.join(ROOT, 'js/model/structured.js'));

/* his report: "how can I make a novel with so many words in chapter one?" — the middle of a long open chapter was "left out here to save room", and the chapters before it went whole */
await test('the chapter so far: a chapter longer than the model holds rides by its earliest stretches’ summaries and its newest words whole — and the chapters before it keep their summaries beside it', async () => {
  const { novel, chapter: c1 } = shape.newNovel({ title: 'Long Book', brief: 'A sorcerer school.' });
  const c2 = shape.newChapter(novel.id);
  novel.order = [c1.id, c2.id];
  c1.passages = [shape.newPassage('ai', 'Chapter one words go on. '.repeat(3000) + 'CHAPTERONE')];
  /* a summary of some length, as a long chapter's is: room is kept for it beside the long chapter, not just what is left over */
  c1.summary = { text: 'CHAPTER ONE SUMMARY: the gate opened. ' + 'Mara walked the long hall and counted the doors. '.repeat(120), fp: shape.chapterPrint(c1), at: 1 };
  const para = (i) => `Passage ${i}: the hall went on and the lantern swung. EVENT${i} happened here in full.`;
  c2.passages = Array.from({ length: 120 }, (_, i) => shape.newPassage('ai', Array.from({ length: 22 }, () => para(i + 1)).join(' ')));
  const plan = stretchesMod.stretchPlan(c2);
  /* the first ten stretches summed up, the rest not yet */
  plan.stretches.forEach((st, k) => { if (k < 10) { st.text = `STRETCH SUMMARY ${k + 1}.`; st.at = 1; } });
  c2.stretches = stretchesMod.keptStretches(plan);
  const chapters = { [c1.id]: c1, [c2.id]: c2 };
  const all = (a) => a.system + '\n' + a.messages.map((m) => m.content).join('\n');
  const a = context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: 40000, maxTokens: 2000 }, target: { chapterId: c2.id }, request: 'Go on.' });
  const t = all(a);
  const events = [...new Set([...t.matchAll(/EVENT(\d+) happened/g)].map((m) => +m[1]))];
  assert.ok(t.includes('CHAPTER ONE SUMMARY'), 'the chapter before keeps its summary beside the long one');
  const shown = [...t.matchAll(/STRETCH SUMMARY (\d+)\./g)].map((m) => +m[1]);
  assert.ok(t.includes('The chapter so far, in short:') && shown.length && shown.every((x, i) => x === i + 1), `its earliest stretches by their summaries, in order: ${shown}`);
  /* word for word from inside the last stretch in short (what room is left takes its last passages) to the end, every passage between */
  const lastIn = plan.stretches[shown.length - 1];
  const from = c2.passages.findIndex((x) => x.id === lastIn.from) + 1, to = c2.passages.findIndex((x) => x.id === lastIn.to) + 1;
  assert.ok(t.includes('From here on, word for word:') && Math.min(...events) > from && Math.min(...events) <= to + 1 && Math.max(...events) === 120 && events.length === 121 - Math.min(...events), `its newest words whole: ${Math.min(...events)}–${Math.max(...events)}, after stretch ${shown.length} (${from}–${to})`);
  assert.ok(!/left out here to save room/.test(t), 'nothing left out unsaid');
  assert.ok(a.stats.tokens < 40000 - 2000 && a.stats.tokens > 40000 * 0.8, `it fits, and uses the room it has: ${a.stats.tokens}`);
  assert.deepEqual(a.stats.chapterFit, { before: 'stretches', after: 'whole' }, 'told how, for the line under the page');
  /* a smaller model, the helper still behind: every summary, the stretches not summed up yet by their opening and close, the one right before the words kept whole by its opening — its end joining them word for word */
  const smaller = all(context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: 16000, maxTokens: 2000 }, target: { chapterId: c2.id }, request: 'Go on.' }));
  const tail = smaller.slice(smaller.indexOf('From here on, word for word:'));
  const tailEvents = [...new Set([...tail.matchAll(/EVENT(\d+) happened/g)].map((m) => +m[1]))];
  assert.ok(smaller.includes('STRETCH SUMMARY 10.') && smaller.includes('(not summed up yet — its opening and close)') && smaller.includes('(not summed up yet — its opening, then its end word for word)') && !/left out here to save room/.test(smaller), 'a smaller model: summaries, then openings and closes, then the newest words');
  assert.ok(Math.max(...tailEvents) === 120 && tailEvents.length === 121 - Math.min(...tailEvents), `every passage from ${Math.min(...tailEvents)} to the point whole`);
  const told = [...smaller.matchAll(/Passage (\d+): the hall/g)].map((m) => +m[1]);
  const opened = smaller.slice(smaller.indexOf('its opening, then its end word for word'), smaller.indexOf('From here on, word for word:'));
  assert.ok(![...opened.matchAll(/Passage (\d+): the hall/g)].some((m) => tailEvents.includes(+m[1])), 'nothing told twice: the opening stops where the words kept whole begin');
  assert.ok(told.length, 'passages read');
  /* one the helper could not sum up, between ones it did: it rides by its opening and close, the summaries after it still in place */
  const gap = structuredClone(c2);
  gap.stretches = gap.stretches.map((x, k) => (k === 3 ? { from: x.from, to: x.to } : x));
  const g = all(context.assemble({ house: quietHouse(), novel, chapters: { ...chapters, [c2.id]: gap }, conn: { ...CONN, context: 16000, maxTokens: 2000 }, target: { chapterId: c2.id }, request: 'Go on.' }));
  const gs = [...g.matchAll(/STRETCH SUMMARY (\d+)\./g)].map((m) => +m[1]);
  assert.ok(g.includes('(not summed up yet — its opening and close)') && !gs.includes(4) && gs.includes(5) && gs.includes(10), `the gap rides by its opening and close: ${gs}`);
  /* a model too small for even the summaries and the stretches after them: what is left out is said */
  const tiny = all(context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: 5000, maxTokens: 1000 }, target: { chapterId: c2.id }, request: 'Go on.' }));
  assert.ok(/left out here to save room/.test(tiny) && tiny.includes('EVENT120 happened'), 'a tiny model: the newest words, what is left out said');
  /* the partner sees which passages each summary stands for */
  const p = all(context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: 40000, maxTokens: 2000 }, purpose: 'partner', target: { chapterId: c2.id }, request: 'Hi', turns: [] }));
  assert.ok(p.includes(`[2.1–2.${plan.stretches[0].ids.length}, in short]\nSTRETCH SUMMARY 1.`), 'the partner knows which passages a summary stands for');
});

await test('the chapter so far: a page written in a long chapter says under it how the chapter was sent — its earlier stretches in short, the words before the point whole', async () => {
  const para = (i) => `Passage ${i}: the hall went on and the lantern swung. EVENT${i} happened here in full.`;
  const b = await makeBook([Array.from({ length: 60 }, (_, i) => Array.from({ length: 22 }, () => para(i + 1)).join(' '))]);
  const plan = stretchesMod.stretchPlan(b.ch());
  plan.stretches.forEach((st, k) => { st.text = `STRETCH SUMMARY ${k + 1}.`; st.at = 1; });
  store.change('chapter', b.ids[0], (c) => { c.stretches = stretchesMod.keptStretches(plan); }, { now: true });
  await setHouse({ context: 16000 }, CRAFTS_OFF);
  await script([{ text: 'The lantern went out.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'The lantern goes out.' });
  assert.equal(out.ok, true, JSON.stringify(out));
  const sent = (await requests())[0].body.messages.map((m) => m.content).join('\n');
  assert.ok(sent.includes('The chapter so far, in short:') && sent.includes('EVENT60 happened'), 'sent by its stretches, the newest words whole');
  const said = picked(b.ch().passages.at(-1)).notes || [];
  assert.ok(said.some((n) => n.includes('its earlier stretches were sent by their summaries')) && !said.some((n) => n.includes('middle left out')), JSON.stringify(said));
  await setHouse();
  await putAway(b);
});

await test('the chapter so far: a stretch keeps its bounds as the chapter grows, and is summed up again only when its own words change', () => {
  const c = shape.newChapter('n');
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  c.passages = Array.from({ length: 7 }, () => shape.newPassage('ai', words(1000)));
  let plan = stretchesMod.stretchPlan(c);
  assert.deepEqual(plan.stretches.map((x) => x.ids.length), [3, 3], 'three passages of a thousand words make a stretch');
  assert.equal(plan.open.length, 1, 'the newest passage waits for its stretch');
  plan.stretches[0].text = 'ONE.'; plan.stretches[1].text = 'TWO.';
  c.stretches = stretchesMod.keptStretches(plan);
  c.passages.push(shape.newPassage('ai', words(400)));
  plan = stretchesMod.stretchPlan(c);
  assert.deepEqual(plan.stretches.map((x) => x.text), ['ONE.', 'TWO.'], 'a passage added later keeps the summaries');
  /* the words of the first stretch change: only it is due again, its bounds the same */
  picked(c.passages[1]).text += ' changed';
  plan = stretchesMod.stretchPlan(c);
  assert.deepEqual(plan.stretches.map((x) => x.text), ['', 'TWO.'], 'only the stretch whose words changed is due again');
  assert.deepEqual(plan.stretches.map((x) => x.ids.length), [3, 3], 'its bounds kept');
  /* a chapter the writing moved past: its last words make a stretch too */
  assert.equal(stretchesMod.stretchPlan(c, { closeLast: true }).open.length, 0);
});

await test('the helper sums up a long chapter stretch by stretch — the one before carried in — and keeps them on the chapter; a changed stretch is asked again alone', async () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  const b = await makeBook([Array.from({ length: 9 }, (_, i) => words(1000, `w${i}x`))]);
  markAllSeen(b);
  /* the writer's model small, so the chapter is kept in stretches; the helper's with room to read a stretch whole (a smaller one reads it in parts — tests/archivist_reliability.mjs) */
  await setHouse({ context: 12000 }, { connections: [{ ...CONN, context: 12000 }, { ...CONN, id: 'c-h', context: 32000 }], roles: { writer: 'c-w', helper: 'c-h' } });
  await script([{ text: '{"summary": "the first stretch summed up."}' }, { text: '{"summary": "the second stretch summed up."}' }, { text: '{"summary": "the third stretch summed up."}' }]);
  await archivist.run(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content).filter((m) => m.includes('Sum up this stretch alone'));
  assert.equal(asks.length, 3, 'three stretches, three asks');
  assert.ok(asks[1].includes('The stretch before this one, in short:') && asks[1].includes('the first stretch summed up.'), 'the one before carried in');
  assert.ok(asks[0].includes('w0x') && !asks[0].includes('w3x'), 'each stretch its own words');
  await store.flush();
  const kept = (await onPhone('chapter', b.ids[0])).stretches;
  assert.deepEqual(kept.map((x) => x.text), ['the first stretch summed up.', 'the second stretch summed up.', 'the third stretch summed up.']);
  /* the second stretch's words change: it alone is asked again */
  await reset();
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[4].id, text: words(1000, 'w4x') + ' Changed.' });
  markAllSeen(b);
  await script([{ text: '{"summary": "the second stretch, again."}' }]);
  await archivist.run(b.novelId);
  const again = (await requests()).map((x) => x.body.messages.at(-1).content).filter((m) => m.includes('Sum up this stretch alone'));
  assert.equal(again.length, 1, 'only the changed stretch');
  await store.flush();
  assert.deepEqual((await onPhone('chapter', b.ids[0])).stretches.map((x) => x.text), ['the first stretch summed up.', 'the second stretch, again.', 'the third stretch summed up.']);
  /* a chapter the writing has moved past is summed up from its stretches — the whole of it read, nothing squeezed away part by part */
  await reset();
  await store.create('chapter', 'ch-next-' + b.novelId, { ...shape.newChapter(b.novelId), id: 'ch-next-' + b.novelId, passages: [shape.newPassage('ai', 'the next chapter begins.')] });
  store.change('novel', b.novelId, shape.novelSteps.addChapter('ch-next-' + b.novelId), { now: true });
  markAllSeen(b);
  await script([{ text: '{"summary": "the whole chapter, from its stretches."}' }]);
  await archivist.run(b.novelId);
  const whole = (await requests()).map((x) => x.body.messages.at(-1).content).find((m) => m.includes('is a long chapter, kept in stretches. Here is every stretch of it'));
  assert.ok(whole && whole.includes('the first stretch summed up.') && whole.includes('the second stretch, again.') && !whole.includes('w0x0 w0x1'), 'summed up from its stretches, not its pages');
  await store.flush();
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'the whole chapter, from its stretches.');
  await setHouse();
  await putAway(b);
});

await test('a stretch whose words change while the helper sums it up is never given that summary — it is asked again as it reads now', async () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  const b = await makeBook([Array.from({ length: 9 }, (_, i) => words(1000, `u${i}x`))], { manual: true });
  markAllSeen(b);
  await setHouse({ context: 12000 }, { connections: [{ ...CONN, context: 12000 }, { ...CONN, id: 'c-h', context: 32000 }], roles: { writer: 'c-w', helper: 'c-h' } });
  await script([{ text: '{"summary": "FROM THE OLD WORDS."}', delay: 0.8 }, { text: '{"summary": "the second stretch."}' }, { text: '{"summary": "the third stretch."}' }]);
  const running = archivist.run(b.novelId);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(20);
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[1].id, text: words(1000, 'u1x') + ' Changed while it was read.' });
  await running;
  await store.flush();
  const kept = (await onPhone('chapter', b.ids[0])).stretches || [];
  assert.ok(!kept.some((x) => x.text === 'FROM THE OLD WORDS.'), `a summary of words that changed is not kept: ${JSON.stringify(kept.map((x) => x.text))}`);
  assert.deepEqual(kept.slice(1).map((x) => x.text), ['the second stretch.', 'the third stretch.'], 'the others are kept');
  await reset();
  markAllSeen(b);
  await script([{ text: '{"summary": "FROM THE WORDS AS THEY READ NOW."}' }]);
  await archivist.run(b.novelId);
  const asked = (await requests()).map((x) => x.body.messages.at(-1).content).find((m) => m.includes('Sum up this stretch alone'));
  assert.ok(asked && asked.includes('Changed while it was read.'), 'asked again with the words as they read now');
  await store.flush();
  assert.equal(((await onPhone('chapter', b.ids[0])).stretches || [])[0].text, 'FROM THE WORDS AS THEY READ NOW.');
  await setHouse();
  await putAway(b);
});

await test('a stretch its helper will not sum up is asked twice, then passed by — never asked again on every run', async () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  const b = await makeBook([Array.from({ length: 4 }, (_, i) => words(1000, `r${i}x`))], { manual: true });
  markAllSeen(b);
  await setHouse({ context: 12000 }, { connections: [{ ...CONN, context: 12000 }, { ...CONN, id: 'c-h', context: 32000 }], roles: { writer: 'c-w', helper: 'c-h' } });
  const stretchAsks = async () => (await requests()).filter((x) => x.body.messages.some((m) => typeof m.content === 'string' && m.content.startsWith("Here's a stretch of"))).length;
  const asked = [];
  for (let run = 0; run < 3; run++) {
    await reset();
    await script(Array.from({ length: 6 }, () => ({ text: 'I would rather not.' })).map((x, i) => (i % 3 === 2 ? { text: '{"ok": true}' } : x)));
    await archivist.run(b.novelId);
    asked.push(await stretchAsks());
  }
  assert.ok(asked[0] > 0 && asked[1] > 0 && asked[2] === 0, `asked on the first two runs, not the third: ${asked}`);
  await setHouse();
  await putAway(b);
});

await test('the chapter still being written, once quiet, is summed up from its stretches and its newest words as they stand — never read again page by page', async () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  const old = Date.now() - 3600000;
  const b = await makeBook([Array.from({ length: 7 }, (_, i) => ({ text: words(1000, `v${i}x`), at: old, done: old }))], { manual: true });
  markAllSeen(b);
  /* the writer's model small, so the chapter is kept in stretches; the helper's with room to read a stretch whole (a smaller one reads it in parts — tests/archivist_reliability.mjs) */
  await setHouse({ context: 12000 }, { connections: [{ ...CONN, context: 12000 }, { ...CONN, id: 'c-h', context: 32000 }], roles: { writer: 'c-w', helper: 'c-h' } });
  await script([{ text: '{"summary": "stretch one."}' }, { text: '{"summary": "stretch two."}' }, { text: '{"summary": "the chapter so far, from its stretches and its newest words."}' }]);
  await archivist.run(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content);
  assert.equal(asks.filter((m) => m.includes('Sum up this stretch alone')).length, 2, 'two stretches, the newest words still open');
  const sum = asks.find((m) => m.includes('Here is every stretch of it, in order, summed up, and then its newest words as they stand'));
  assert.ok(sum && sum.includes('stretch one.') && sum.includes('stretch two.') && sum.includes('Its newest words, after the last stretch:') && sum.includes('v6x0') && !sum.includes('v0x0'), (sum || asks.join('\n---\n')).slice(0, 900));
  assert.equal(asks.filter((m) => !m.includes('Its summary, as it stands')).length, 3, 'nothing else asked');
  assert.equal(asks.filter((m) => m.includes('Its summary, as it stands')).length, 3, 'and each summary checked once: the two stretches and the chapter');
  await store.flush();
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'the chapter so far, from its stretches and its newest words.');
  await setHouse();
  await putAway(b);
});

await test('a long chapter changed since its summary rides by its stretches — each unchanged one by its summary, the changed one by its own opening and close — never by the summary from before', () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');
  const d = shape.newChapter('n');
  d.passages = Array.from({ length: 9 }, (_, i) => shape.newPassage('ai', words(1000, `s${i}w`)));
  d.summary = { text: 'OLD HELPER SUMMARY: the gardener was murdered.', fp: shape.chapterPrint(d), at: 1 };
  const plan = stretchesMod.stretchPlan(d, { closeLast: true });
  plan.stretches.forEach((st, k) => { st.text = `CURRENT STRETCH ${k + 1}.`; st.at = 1; });
  d.stretches = stretchesMod.keptStretches(plan);
  assert.equal(context.shortOf(d), 'OLD HELPER SUMMARY: the gardener was murdered.', 'a current summary rides');
  /* words in the middle stretch taken out: the summary is from before, and so is that stretch's */
  picked(d.passages[4]).text = words(1000, 's4w').replace('s4w500', 'REWRITTEN');
  const short = context.shortOf(d);
  assert.ok(!short.includes('gardener'), 'the summary from before never rides');
  assert.ok(short.startsWith('CURRENT STRETCH 1.\n\n(not summed up as it reads now — its opening and close)\n') && short.endsWith('CURRENT STRETCH 3.'), short.slice(0, 300));
  assert.ok(short.includes('s3w0') && !short.includes('CURRENT STRETCH 2.'), 'the changed stretch by its own words as they read now');
  /* a short chapter has no stretches: its current opening and close */
  const c = shape.newChapter('n');
  c.passages = [shape.newPassage('ai', 'The gate opened at dawn.')];
  c.summary = { text: 'HIS OWN SUMMARY.', fp: 'older', by: 'you', at: 1 };
  assert.ok(context.shortOf(c).includes('The gate opened at dawn.') && !context.shortOf(c).includes('HIS OWN SUMMARY.'), context.shortOf(c));
});

await test('the story map: a chapter’s plan rides only while writing in it; the partner sees the whole map; the last chapter is told how it ends and what is still open', async () => {
  const { novel, chapter: c1 } = shape.newNovel({ title: 'Map Book', brief: 'A school of sorcery.' });
  const c2 = shape.newChapter(novel.id), c3 = shape.newChapter(novel.id);
  novel.order = [c1.id, c2.id, c3.id];
  c1.passages = [shape.newPassage('ai', 'Jovan arrived at the gate.')];
  shape.chapterSteps.setPlan('PLAN ONE: he arrives.')(c1);
  shape.chapterSteps.setPlan('PLAN TWO: the duel.')(c2);
  shape.chapterSteps.setPlan('PLAN THREE: the finale.')(c3);
  novel.ending = 'ENDING: he leaves the school.';
  novel.notes.threads = [shape.newCard('threads', { name: 'The sealed letter', about: 'Nobody has opened it.' }), shape.newCard('threads', { name: 'Old debt', open: false })];
  const chapters = { [c1.id]: c1, [c2.id]: c2, [c3.id]: c3 };
  const all = (a) => a.system + '\n' + a.messages.map((m) => m.content).join('\n');
  const ask = (purpose, chapterId) => all(context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: 64000, maxTokens: 2000 }, purpose, target: { chapterId }, request: 'Go on.', turns: [] }));
  let t = ask('write', c1.id);
  assert.ok(t.includes(prompts.planWords('PLAN ONE: he arrives.')), 'its own plan, said to be where it is going');
  assert.ok(!t.includes('PLAN TWO') && !t.includes('PLAN THREE') && !t.includes('ENDING:'), 'never a plan ahead, never the ending');
  assert.ok(t.includes('What comes later in the book:') && !t.includes('What comes later in the book (already written)'), 'chapters made ahead are not called written');
  t = ask('partner', c1.id);
  assert.ok(t.includes('Planned: PLAN TWO: the duel.') && t.includes('Planned: PLAN THREE') && t.includes('ENDING: he leaves the school.'), 'the partner plans with the whole map');
  novel.prefs.endsAt = c3.id;
  t = ask('write', c3.id);
  const ending = prompts.endingWords('ENDING: he leaves the school.', [novel.notes.threads[0]]);
  assert.ok(t.includes(ending) && ending.includes('- The sealed letter — Nobody has opened it.') && !ending.includes('Old debt'), 'the last chapter: how it ends, the threads still open');
  assert.ok(!ask('write', c2.id).includes('ENDING:'), 'only the last chapter');
  /* nothing set: nothing sent */
  const bare = shape.newNovel({ title: 'Bare' });
  const bt = all(context.assemble({ house: quietHouse(), novel: bare.novel, chapters: { [bare.chapter.id]: bare.chapter }, conn: { ...CONN, context: 64000 }, purpose: 'write', target: { chapterId: bare.chapter.id }, request: 'Go.' }));
  assert.ok(!bt.includes('What I mean this chapter to do') && !bt.includes('last chapter'), 'no plan, no ending: not a word of it');
});

await test('the partner writes the map: a chapter’s plan, and the chapter after the last made to hold one — Undo puts both back', async () => {
  const b = await makeBook([['Jovan arrived.'], ['Kenjaku waited.']]);
  let made = changes.makeChange(b.novelId, { plan: 2, text: 'The duel at the gate.', why: 'asked' });
  assert.equal(made.status, 'made', JSON.stringify(made));
  assert.equal(b.ch(1).plan, 'The duel at the gate.');
  assert.equal(changes.labelOf({ plan: 2 }), 'What Chapter Two is for');
  assert.equal(changes.undoChange(b.novelId, made).ok, true);
  assert.equal(b.ch(1).plan, undefined, 'Undo: no plan again');
  made = changes.makeChange(b.novelId, { plan: 3, text: 'The finale.', why: 'mapping ahead' });
  assert.equal(made.status, 'made', JSON.stringify(made));
  const order = b.novel().order;
  assert.equal(order.length, 3, 'a new chapter after the last');
  assert.equal(store.peek('chapter', order[2]).plan, 'The finale.');
  assert.equal(changes.undoChange(b.novelId, made).ok, true);
  assert.equal(b.novel().order.length, 2, 'Undo takes the empty chapter out again');
  assert.equal(changes.makeChange(b.novelId, { plan: 9, text: 'x' }).status, 'refused', 'never a chapter far past the end');
  assert.ok(prompts.partnerFrame({}, b.novel()).includes('"plan": 4'), 'the partner is told it can');
  await putAway(b);
});

await test('Go on carries his rewrite’s note as a change — a note some words were written again with (the checker’s own included) holds as how it is told, never as what happens', async () => {
  const b = await makeBook([['The lamp was cold and the stair was long.']]);
  const pid = b.ch().passages[0].id;
  await script([{ text: 'The lamp was cold and the ⟦stair was steep⟧ and long.' }]);
  await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, start: 22, end: 39, note: 'Write it again without “a testament to” — say it the way this book would.' });
  store.change('chapter', b.ids[0], (c) => { const v = picked(c.passages[0]); v.cut = true; v.endCut = true; }, { now: true });
  await reset();
  await script([{ text: 'and long. Mara climbed.' }]);
  await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid });
  const ask = (await requests()).map((x) => x.body.messages.at(-1).content).find((m) => m.includes('stopped partway'));
  assert.ok(ask && !ask.includes('It was written again with a change'), ask);
  assert.ok(ask.includes('Some of its words were written again with this note — what it asks holds for the rest of it too:\n- Write it again without “a testament to”'), ask);
  await putAway(b);
});

await test('put right after 2.10: whole-word evidence finds a match beside one it turned away; an answer in {"content": …} is the page; a refusal before sending is not a passing fault; a started reply never ends on a space', async () => {
  assert.deepEqual(search.findIn('xa a a', 'a a', { whole: true }), [{ start: 3, end: 6 }]);
  assert.equal(search.findIn('she said he said he', 'he said he', { whole: true }).length, 1);
  assert.equal(structuredM.unwrapStructured('{"content":"Words here."}\n\nDone.'), 'Words here.');
  assert.equal(structuredM.unwrapStructured('{"meta":{"text":"nope"},"response":"real words"}'), 'real words');
  /* a field other than "response" waits for the end (a "response" after it would be the page — tests/provider_edges.mjs), then is the page */
  const d = structuredM.makeStructuredDecoder({}); let out = ''; for (const ch of '{"content":"stream me"}\nDone.') out += d.feed(ch);
  assert.equal(out + d.end(), 'stream me', 'the words of the object a few words trail after');
  const none = await call.ask({ id: 'x', url: '', model: '' }, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(none.permanent, true, 'no connection: nothing to wait out');
  const small = await call.ask({ ...CONN }, { build: () => ({ refuse: 'too small for your instructions' }) });
  assert.deepEqual([small.ok, small.permanent, small.error], [false, true, 'too small for your instructions']);
  const req = providers.buildRequest({ ...CONN, shape: 'anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-x' }, { system: 'S', messages: [{ role: 'user', content: 'Go.' }, { role: 'assistant', content: 'Stay in her head.\n\n', voice: true }], maxTokens: 500 });
  const last = req.body.messages.at(-1);
  assert.ok(typeof last.content === 'string' && last.content.endsWith('head.'), JSON.stringify(last));
});

await test('Stop ends the reading of a reply at once — even when the line never closes after its last words (a reply that lost its place used to wait for ever)', async () => {
  const ctl = new AbortController();
  const enc = new TextEncoder();
  /* its words come, and then the line simply stays open */
  const body = new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Some words"}}]}\n\n')); } });
  const res = new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  let heard = '';
  const got = await Promise.race([
    call.readReply('openai', res, { onText: (t) => { heard += t; ctl.abort(); }, signal: ctl.signal }).then(() => 'read to the end', (e) => e.name),
    sleep(3000).then(() => 'still waiting'),
  ]);
  assert.equal(heard, 'Some words');
  assert.equal(got, 'AbortError');
  /* and a reading stopped before it began never waits either */
  const early = new AbortController();
  early.abort();
  const never = new Response(new ReadableStream({ start() {} }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  assert.equal(await Promise.race([call.readReply('openai', never, { signal: early.signal }).then(() => 'read', (e) => e.name), sleep(3000).then(() => 'still waiting')]), 'AbortError');
});

await test('put right after 2.10: a chapter the phone no longer holds never stops the page; a lesson the model teaches is the same choice of helper', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  store.change('novel', b.novelId, (n) => { n.order.push('ch-not-there'); }, { now: true });
  await store.flush();
  await script([{ text: 'Mara climbed the stair.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She climbs.' });
  assert.equal(out.ok, true, JSON.stringify(out));
  /* never silently: the writer is told in its place, and he under the page */
  assert.ok((await requests())[0].body.messages.map((m) => m.content).join('\n').includes('(this chapter could not be read just now)'));
  assert.ok((picked(b.ch().passages.at(-1)).notes || []).some((n) => n.includes('One chapter in the book’s list is not on the phone')), JSON.stringify(picked(b.ch().passages.at(-1)).notes));
  const conn = { ...CONN };
  assert.equal(archivist.choicePrint(conn), archivist.choicePrint({ ...conn, learned: { context: 8000, maxOut: 900 } }), 'what it learned is the same choice');
  assert.notEqual(archivist.choicePrint(conn), archivist.choicePrint({ ...conn, model: 'another' }), 'another model is another');
  await putAway(b);
});

await test('the helper names each passage as the page does for the timeline — never by the app’s own mark', async () => {
  const b = await makeBook([['Mara found the letter.', 'Rowan read it aloud.']]);
  await script([{ text: JSON.stringify({ people: [], timeline: [{ source: 'Passage 1', events: [] }, { source: 'Passage 2', events: [] }] }) }]);
  await archivist.run(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content).filter((m) => m.includes('Update the notes')).join('\n');
  assert.ok(/Passage 1\nNew in Chapter One:\n"{3}\nMara found/.test(asks) && /Passage 2\nNew in Chapter One:\n"{3}\nRowan read/.test(asks), asks.slice(0, 600));
  for (const p of b.ch().passages) assert.ok(!asks.includes(p.id), 'no passage id sent');
  await store.flush();
  const v = picked((await onPhone('chapter', b.ids[0])).passages[0]);
  assert.ok(v.continuity && v.continuity.complete !== false, JSON.stringify(v.continuity));
  await putAway(b);
});

await test('his length goal: each quarter said once — never twice when words go and come back — and a new goal counted afresh', async () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const b = await makeBook([[words(300)]]);
  store.change('novel', b.novelId, shape.novelSteps.setMeta({ goal: 1000 }), { now: true });
  const said = [];
  const off = writer.onMilestone((x) => { if (x.novelId === b.novelId) said.push(`${x.reached}:${x.words}/${x.goal}`); });
  try {
    await writer.recount(b.novelId);
    assert.deepEqual(said, ['1:300/1000'], 'a quarter of the way');
    await writer.recount(b.novelId);
    assert.deepEqual(said, ['1:300/1000'], 'said once');
    store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('you', words(300))); }, { now: true });
    await writer.recount(b.novelId);
    assert.deepEqual(said, ['1:300/1000', '2:600/1000'], 'halfway');
    store.change('chapter', b.ids[0], (c) => { c.passages.pop(); }, { now: true });
    await writer.recount(b.novelId);
    store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('you', words(300))); }, { now: true });
    await writer.recount(b.novelId);
    assert.deepEqual(said, ['1:300/1000', '2:600/1000'], 'taken out and written again: not said twice');
    store.change('novel', b.novelId, shape.novelSteps.setMeta({ goal: 600 }), { now: true });
    await writer.recount(b.novelId);
    assert.deepEqual(said, ['1:300/1000', '2:600/1000', '4:600/600'], 'a new goal, reached');
    await store.flush();
    assert.deepEqual((await onPhone('novel', b.novelId)).meta.reached, { goal: 600, n: 4 }, 'kept with the book');
  } finally { off(); }
  await putAway(b);
});

await test('a phone whose library number went backwards is believed after three answers — a page never asks again for ever, every save refused', async () => {
  const b = await makeBook([['Mara kept the light.']]);
  await store.flush();
  const gen = (await (await realFetch(BASE + '/api/version')).json()).generation;
  const { news } = store.forTests();
  /* the page holds a number the phone no longer has (its folder put back by hand) */
  news(JSON.stringify({ hello: { commit: 'same', generation: gen + 5 } }));
  const t0 = Date.now();
  const got = await Promise.race([store.open('chapter', b.ids[0], { fresh: true }), sleep(6000).then(() => 'stuck')]);
  const took = Date.now() - t0;
  assert.notEqual(got, 'stuck', 'the read finishes');
  assert.equal(got.passages[0].versions[0].text, 'Mara kept the light.');
  assert.ok(took >= 500, `it waited between asking, never a tight loop: ${took} ms`);
  store.change('chapter', b.ids[0], (c) => { c.passages[0].versions[0].text = 'Saved after it.'; }, { now: true });
  await store.flush();
  assert.equal((await onPhone('chapter', b.ids[0])).passages[0].versions[0].text, 'Saved after it.', 'and his saves land again');
  await putAway(b);
});

heading('what a summary keeps, and the level between a chapter and its summary (2.11.2)');

/* his question: is the novel's summary as good as Cozy Tavern's? Its record keeps Summaryception's whole list; the novel's had dropped part of it */
const SUMMARY_KEEPS = ['a grudging yes stays grudging', 'a quarrel left open is said to be open', 'never folded into “the others”', 'the moment that shifted it', 'a line they won’t cross', 'a private joke', 'turns out false, or has changed, say so plainly', 'both wordings where a line is misquoted or disputed', 'never a person, a cause, how a thing was done, a promise, a first description or a figure', 'one they never give has no place in it'];
await test('a chapter’s summary and a stretch’s are asked for everything Cozy Tavern’s record keeps — how a thing was done, what moved two people, each person by name, the small particulars, a belief shown false, a disputed line — and told what to cut when they run long', async () => {
  const b = await makeBook([['Mara said yes, grudgingly, and did not forgive Tom.'], ['Chapter two words.']]);
  markAllSeen(b);
  await setHouse({ context: 200000 });
  await script([{ text: '{"summary": "Mara agrees to it grudgingly and does not forgive Tom.", "name": "The Yes"}' }]);
  await archivist.run(b.novelId);
  const ask = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((m) => m.includes("for the book's notes"));
  assert.ok(ask, 'the summary was asked for');
  const lost = SUMMARY_KEEPS.filter((w) => !ask.includes(w));
  assert.deepEqual(lost, [], 'everything the record keeps is asked for');
  assert.ok(ask.includes('keeping the chapter’s actual closing situation clear') && ask.includes('mark flashbacks and dreams'), 'the novel’s own rows stay');
  await putAway(b);
  /* a stretch of a long chapter: the same list, and where everyone stands at its end */
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  const c = await makeBook([Array.from({ length: 4 }, (_, i) => words(1000, `k${i}x`))], { manual: true });
  markAllSeen(c);
  await reset();
  await setHouse({ context: 12000 }, { connections: [{ ...CONN, context: 12000 }, { ...CONN, id: 'c-h', context: 32000 }], roles: { writer: 'c-w', helper: 'c-h' } });
  await script([{ text: '{"summary": "the first stretch summed up."}' }]);
  await archivist.run(c.novelId);
  const st = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((m) => m.includes('Sum up this stretch alone'));
  assert.ok(st, 'a stretch was asked for');
  assert.deepEqual(SUMMARY_KEEPS.filter((w) => !st.includes(w)), [], 'the stretch is asked for the same');
  assert.ok(st.includes('where everyone stands at its last line'), 'and where everyone stands at its end');
  await setHouse();
  await putAway(c);
});

await test('a summary runs to about a twelfth of its chapter at every length, up to 1,200 words — no step where 10,001 words got almost twice the summary of 9,999', async () => {
  const b = await makeBook([[Array.from({ length: 9000 }, (_, i) => `w${i % 97}`).join(' ') + '.'], ['Chapter two words.']]);
  markAllSeen(b);
  await setHouse({ context: 200000 });
  await script([{ text: '{"summary": "A long day.", "name": "Long"}' }]);
  await archivist.run(b.novelId);
  const ask = (await requests()).map((x) => String(x.body.messages.at(-1).content)).find((m) => m.includes("for the book's notes"));
  assert.ok(ask && ask.includes('Plain prose, about 750 words'), (ask || '').slice(-900));
  assert.ok(Math.abs(prompts.summarySize(10001) - prompts.summarySize(9999)) <= 1, `${prompts.summarySize(9999)} → ${prompts.summarySize(10001)}`);
  assert.deepEqual([prompts.summarySize(600), prompts.summarySize(6000), prompts.summarySize(40000)], [120, 500, 1200]);
  await setHouse();
  await putAway(b);
});

await test('a summary that gives a figure its chapter never does — seventeen where the chapter says sixteen — is asked once more with it named, and the answer kept only when it puts it right', async () => {
  const one = 'Jovan was sixteen the winter the gate fell. Mara Venn counted the riders at the ford.';
  let b = await makeBook([[one], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  await setHouse({ context: 200000 });
  await script([{ text: JSON.stringify({ summary: 'Jovan, seventeen, watches the gate fall while Mara Venn counts the riders at the ford.', name: 'The Ford' }) }, { text: JSON.stringify({ summary: 'Jovan, sixteen, watches the gate fall while Mara Venn counts the riders at the ford.' }) }]);
  await archivist.run(b.novelId);
  const again = (await requests()).map((r) => String(r.body.messages.at(-1).content)).find((m) => m.includes('nowhere in the chapter'));
  assert.ok(again && again.includes('These figures stand in the summary and nowhere in the chapter:\n- seventeen'), again);
  assert.ok(!again.includes('nowhere in the summary'), 'nothing was left out, so nothing is asked for');
  await store.flush();
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'Jovan, sixteen, watches the gate fall while Mara Venn counts the riders at the ford.');
  await putAway(b);
  /* an answer that keeps the wrong figure is not kept: the first stands, and it is not asked a third time */
  b = await makeBook([[one], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  await reset();
  await script([{ text: JSON.stringify({ summary: 'Jovan, 17, watches the gate fall while Mara Venn counts the riders at the ford.' }) }, { text: JSON.stringify({ summary: 'Jovan, seventeen, watches the gate fall while Mara Venn counts riders at the ford.' }) }]);
  await archivist.run(b.novelId);
  await store.flush();
  assert.equal((await onPhone('chapter', b.ids[0])).summary.text, 'Jovan, 17, watches the gate fall while Mara Venn counts the riders at the ford.');
  const asked = (await notChecks()).map((r) => String(r.body.messages.at(-1).content));
  assert.equal(asked.filter((m) => m.includes('nowhere in the chapter')).length, 1, 'asked once more, never a third time');
  assert.equal(asked.length, 2, asked.map((m) => m.slice(0, 120)).join('\n---\n'));
  await putAway(b);
  /* the chapter's own figures, in words or in digits, and its own number, are no wrong figure */
  assert.deepEqual(namesjs.figuresInvented('Jovan was sixteen; twenty-one riders came at 3am with 1,200 crowns.', 'In Chapter Twelve Jovan (16) meets 21 riders carrying 1200 crowns.'), []);
  assert.deepEqual(namesjs.figuresInvented('In 1874 the gate fell.', 'In 1847 the gate fell.'), ['1847']);
  await setHouse();
});

await test('a long chapter is summed up in parts that fit the helper’s model with his own summary beside the last — that part kept short enough to hold it, the parts before it as long as ever', async () => {
  const para = 'The storm came in off the water like a held breath let go. '.repeat(20);
  const chapterWords = Array.from({ length: 10 }, () => para).join('\n\n');
  const helper8k = { connections: [{ ...CONN, context: 200000 }, { ...CONN, id: 'c-h', context: 8000 }], roles: { writer: 'c-w', helper: 'c-h' } };
  const run = async (his) => {
    const b = await makeBook([[chapterWords], ['Next chapter.']], { manual: true });
    markAllSeen(b);
    /* his own summary, from before the chapter's latest change: it rides with the last part */
    if (his) store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: his, by: 'you', fp: 'before-the-change', at: 1 }), { now: true });
    await reset();
    await setHouse({ context: 200000 }, helper8k);
    await script(Array.from({ length: 30 }, (_, i) => ({ text: JSON.stringify({ summary: `The storm, part ${i + 1}.` }) })));
    await archivist.run(b.novelId);
    const r = (await requests()).filter((x) => String(x.body.messages.at(-1).content).includes("for the book's notes"));
    await putAway(b);
    return r;
  };
  const words = (x) => { const m = String(x.body.messages.at(-1).content); const a = m.indexOf('"""\n') + 4; return m.slice(a, m.indexOf('\n"""', a)); };
  const his = 'MY OWN SUMMARY. ' + 'Mara keeps the lamp lit through the long storm while Tom rows out to the wreck and back. '.repeat(140);
  const withHis = await run(his);
  const without = await run('');
  assert.ok(without.length >= 2 && withHis.length > without.length, `${without.length} parts without his summary, ${withHis.length} with it`);
  assert.ok(String(withHis.at(-1).body.messages.at(-1).content).includes('MY OWN SUMMARY.') && !withHis.slice(0, -1).some((x) => String(x.body.messages.at(-1).content).includes('MY OWN SUMMARY.')), 'his summary rides with the last part alone');
  for (const x of withHis) {
    const used = util.estimateTokens(x.body.messages.map((m) => String(m.content)).join('\n')) + (x.body.max_tokens || 0);
    assert.ok(used < 8000, `a part asks ${used} tokens of a model that holds 8,000`);
  }
  assert.equal(words(withHis[0]), words(without[0]), 'the parts before the last are as long as they are without it');
  await setHouse();
});

/* the level between: Cozy Tavern's record keeps its finer lines while the room holds them */
function longChapterBook(n = 1) {
  const { novel, chapter: first } = shape.newNovel({ title: 'Long Book', brief: 'A sorcerer school.' });
  const chapters = {};
  const longs = [first];
  for (let i = 1; i < n; i++) longs.push(shape.newChapter(novel.id));
  const now = shape.newChapter(novel.id);
  novel.order = [...longs.map((c) => c.id), now.id];
  longs.forEach((c, j) => {
    const para = (i) => `Chapter ${j + 1} passage ${i}: the hall went on and the lantern swung. WORDS${j + 1}X${i} happened here in full.`;
    c.passages = Array.from({ length: 40 }, (_, i) => shape.newPassage('ai', Array.from({ length: 20 }, () => para(i + 1)).join(' ')));
    const plan = stretchesMod.stretchPlan(c, { closeLast: true });
    plan.stretches.forEach((st, k) => { st.text = `C${j + 1} STRETCH ${k + 1}: ` + 'Mara crossed the hall and opened another door. '.repeat(30); st.at = 1; });
    c.stretches = stretchesMod.keptStretches(plan);
    c.summary = { text: `C${j + 1} ONE SUMMARY: the hall, the doors, the lantern.`, fp: shape.chapterPrint(c), at: 1 };
    chapters[c.id] = c;
  });
  now.passages = [shape.newPassage('ai', 'The chapter being written begins.')];
  chapters[now.id] = now;
  return { novel, chapters, longs, now };
}
const sentOf = (a) => a.system + '\n' + a.messages.map((m) => m.content).join('\n');
await test('the level between: a long chapter that cannot ride whole rides by its stretches’ summaries while the room holds them, and by its one summary only past that', () => {
  const { novel, chapters, longs, now } = longChapterBook(1);
  const at = (room, purpose = 'write') => sentOf(context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: room, maxTokens: 1000 }, ...(purpose === 'partner' ? { purpose, turns: [] } : {}), target: { chapterId: now.id }, request: 'Go on.' }));
  /* 2.11.5: between whole and its stretches, the newest chapter in short may ride partly whole — its earliest stretches in short, the rest word for word */
  const level = (t) => (t.includes('WORDS1X1 happened') && t.includes('WORDS1X40 happened') ? 'whole' : t.includes('C1 STRETCH 1:') && t.includes('The rest of it, word for word:') ? 'partly' : t.includes('C1 STRETCH 1:') ? 'stretches' : t.includes('C1 ONE SUMMARY') ? 'summary' : 'none');
  const stretches = stretchesMod.stretchPlan(longs[0], { closeLast: true }).stretches.length;
  assert.ok(stretches >= 4, `${stretches} stretches`);
  assert.equal(level(at(60000)), 'whole', 'room for its words: whole');
  /* as the room shrinks: whole, then partly whole, then its stretches, then its one summary — never back */
  const rank = { none: 0, summary: 1, stretches: 2, partly: 3, whole: 4 };
  const seen = [];
  let stretchRoom = 0;
  for (let room = 60000; room >= 3000; room -= 500) {
    const l = level(at(room));
    if (!seen.length || seen.at(-1) !== l) seen.push(l);
    if (l === 'stretches' && !stretchRoom) stretchRoom = room;
  }
  /* (on the very smallest model even its one summary goes, and that is said) */
  assert.deepEqual(seen.filter((l) => l !== 'none'), ['whole', 'partly', 'stretches', 'summary'], seen.join(' → '));
  assert.ok(!seen.includes('none') || seen.at(-1) === 'none', seen.join(' → '));
  assert.ok(seen.every((l, i) => !i || rank[l] < rank[seen[i - 1]]));
  const part = at(20000);
  if (level(part) === 'partly') assert.ok(part.indexOf('C1 STRETCH 1:') < part.indexOf('The rest of it, word for word:') && part.includes('WORDS1X40 happened') && !part.includes('C1 ONE SUMMARY'), 'its earliest stretches in short, then its last words whole');
  const mid = at(stretchRoom);
  assert.equal(level(mid), 'stretches', 'no room for its words, room for its stretches: by them');
  assert.ok(Array.from({ length: stretches }, (_, k) => `C1 STRETCH ${k + 1}:`).every((w) => mid.includes(w)) && !mid.includes('C1 ONE SUMMARY'), 'every stretch, in order, and never its summary beside them');
  assert.ok(mid.indexOf('C1 STRETCH 1:') < mid.indexOf(`C1 STRETCH ${stretches}:`), 'in order');
  assert.equal(level(at(4000)), 'summary', 'no room for its stretches: its one summary');
  /* the partner sees which passages each stretch stands for (its own room: the partner's request carries more beside the book) */
  let p = '';
  for (let room = 60000; room >= 3000 && !p.includes('C1 STRETCH 1:'); room -= 500) p = at(room, 'partner');
  assert.ok(/\[1\.1–1\.\d+, in short\]\nC1 STRETCH 1:/.test(p), 'the partner knows which passages a stretch stands for');
  /* a stretch not summed up as its words read now: never half by stretches — its one summary */
  const gap = structuredClone(longs[0]);
  gap.stretches = gap.stretches.map((x, k) => (k === 1 ? { from: x.from, to: x.to } : x));
  const g = sentOf(context.assemble({ house: quietHouse(), novel, chapters: { ...chapters, [gap.id]: gap }, conn: { ...CONN, context: stretchRoom, maxTokens: 1000 }, target: { chapterId: now.id }, request: 'Go on.' }));
  assert.equal(level(g), 'summary', 'a gap among its stretches: its one summary, never partly by stretches');
});

await test('the level between goes to the newest chapter told in short first, and never at the cost of a chapter told whole', () => {
  const { novel, chapters, longs, now } = longChapterBook(3);
  const sent = (room, book = chapters) => sentOf(context.assemble({ house: quietHouse(), novel, chapters: book, conn: { ...CONN, context: room, maxTokens: 1000 }, target: { chapterId: now.id }, request: 'Go on.' }));
  const level = (t, j) => (t.includes(`WORDS${j}X1 happened`) && t.includes(`WORDS${j}X40 happened`) ? 'whole' : t.includes(`C${j} STRETCH 1:`) && t.includes(`WORDS${j}X40 happened`) ? 'partly' : t.includes(`C${j} STRETCH 1:`) ? 'stretches' : t.includes(`C${j} ONE SUMMARY`) ? 'summary' : 'none');
  /* the same book with no stretches kept: what the room told whole before the level between */
  const bare = Object.fromEntries(Object.entries(chapters).map(([id, c]) => [id, { ...c, stretches: [] }]));
  const rank = { none: 0, summary: 1, stretches: 2, partly: 3, whole: 4 };
  const patterns = new Set();
  for (const room of [...Array.from({ length: 78 }, (_, i) => 3000 + i * 1000), 200000]) {
    const t = sent(room);
    const l = [1, 2, 3].map((j) => level(t, j));
    patterns.add(l.join(','));
    /* the chapters are the same length: a newer one is never told more briefly than an older one */
    assert.ok(rank[l[0]] <= rank[l[1]] && rank[l[1]] <= rank[l[2]], `${room}: ${l}`);
    /* never at the cost of a chapter told whole */
    const b = sent(room, bare);
    assert.deepEqual(l.map((x) => x === 'whole'), [1, 2, 3].map((j) => level(b, j) === 'whole'), `${room}: ${l}`);
  }
  for (const want of ['summary,summary,stretches', 'summary,stretches,stretches', 'stretches,stretches,stretches', 'whole,whole,whole']) assert.ok(patterns.has(want), `${want} among ${[...patterns].join(' | ')}`);
  assert.ok([...patterns].some((p) => p.endsWith('whole') && p.includes('stretches')), `a chapter whole and the one before it by its stretches: ${[...patterns].join(' | ')}`);
  /* asked twice, told the same: the start of the request stays the same page after page */
  assert.equal(sent(9000), sent(9000));
  assert.equal(longs.length, 3);
});

heading('the summary check, and a long scene in short (2.11.3)');

const summaryCheckMod = await import(path.join(ROOT, 'js/novel/summarycheck.js'));
const NOTHING_WRONG = { text: '{"wrong": [], "missing": []}' };
const checkAsks = async () => (await requests()).map((x) => String(x.body.messages.at(-1).content)).filter((m) => m.includes('Its summary, as it stands'));
const GATE = 'Jovan was sixteen the winter the gate fell. Mara refused the ring, coldly, and Tom swore he would come back for it before the thaw.';

/* his question: with a quick, fast model as the helper, what makes sure a summary is right? Cozy Tavern's continuous audit and its keeper's detail check */
await test('the summary check: a summary is held once against its chapter, and a wrong fact is put right only where the summary holds the wrong words and the chapter the right ones — what it left out added only where the chapter says it', async () => {
  let b = await makeBook([[GATE], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  await setHouse({ context: 200000 });
  await script([{ text: JSON.stringify({ summary: 'Jovan, sixteen, watches the gate fall. Mara accepts the ring.', name: 'The Gate' }) },
    { text: JSON.stringify({ wrong: [{ summary: 'accepts the ring', words: 'refused the ring' }], missing: [{ after: 'Mara accepts the ring.', add: 'Tom swears he will come back for the ring before the thaw.', words: 'swore he would come back for it before the thaw' }] }) }]);
  await archivist.run(b.novelId);
  const asks = await checkAsks();
  assert.equal(asks.length, 1, 'held against its chapter once');
  assert.ok(asks[0].includes(GATE) && asks[0].includes('Mara accepts the ring.') && asks[0].includes('a grudging yes made a plain yes'), asks[0].slice(0, 600));
  await store.flush();
  let s = (await onPhone('chapter', b.ids[0])).summary;
  assert.equal(s.text, 'Jovan, sixteen, watches the gate fall. Mara refused the ring. Tom swears he will come back for the ring before the thaw.');
  assert.deepEqual(s.checked.fixed, [{ from: 'accepts the ring', to: 'refused the ring' }]);
  assert.deepEqual(s.checked.added, ['Tom swears he will come back for the ring before the thaw.']);
  assert.ok(summaryCheckMod.checkedNow(s), 'the mark is on the words it made');
  /* checked once: the next run asks nothing */
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'never checked twice');
  await putAway(b);
  /* a check that says what the chapter does not: nothing of it is taken, and the summary is marked as checked all the same */
  b = await makeBook([[GATE], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  await reset();
  await script([{ text: JSON.stringify({ summary: 'Jovan, sixteen, watches the gate fall. Mara refused the ring.', name: 'The Gate' }) },
    { text: JSON.stringify({ wrong: [{ summary: 'refused the ring', words: 'threw the ring into the sea' }, { summary: 'not in it at all', words: 'the gate' }], missing: [{ add: 'Rhea saw all of it from the tower.', words: 'Mara refused the ring' }, { add: 'Tom waited 40 days.', words: 'swore he would come back' }] }) }]);
  await archivist.run(b.novelId);
  await store.flush();
  s = (await onPhone('chapter', b.ids[0])).summary;
  assert.equal(s.text, 'Jovan, sixteen, watches the gate fall. Mara refused the ring.', 'the summary keeps its words');
  assert.ok(summaryCheckMod.checkedNow(s) && !s.checked.fixed && !s.checked.added, JSON.stringify(s.checked));
  await setHouse();
  await putAway(b);
});

await test('the summary check’s own rule: one bad addition is refused alone and the good mends stand; mends that would leave the summary with fewer of the chapter’s names are all refused', () => {
  const r = summaryCheckMod.applyCheck('Jovan watches the gate fall. Mara accepts the ring.', { wrong: [{ summary: 'accepts the ring', words: 'refused the ring' }], missing: [{ add: 'Tom waited 40 days by the gate.', words: 'Tom swore he would come back' }] }, GATE);
  assert.equal(r.text, 'Jovan watches the gate fall. Mara refused the ring.');
  assert.ok(r.refused.some((w) => w.includes('a figure the words never give')), r.refused.join(' | '));
  /* a "mend" that drops a name the chapter holds: nothing of that answer is taken */
  const s = summaryCheckMod.applyCheck('Mara refused the ring; Tom swore to come back.', { wrong: [{ summary: 'Mara refused the ring; Tom swore', words: 'swore' }] }, GATE);
  assert.equal(s.text, 'Mara refused the ring; Tom swore to come back.');
  assert.equal(s.fixed.length, 0);
  /* …and one that keeps its length but loses a name it gave */
  const u = summaryCheckMod.applyCheck('Mara refused the ring and Tom swore to come back before the thaw.', { wrong: [{ summary: 'Tom swore to come back', words: 'he would come back' }] }, GATE);
  assert.equal(u.text, 'Mara refused the ring and Tom swore to come back before the thaw.', 'Tom is never mended out of it');
});

await test('the summary check never touches his own summary, and checks a summary again only when its words change', async () => {
  const b = await makeBook([[GATE], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  const fp = shape.chapterPrint(b.ch());
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: 'MY OWN: Mara says no to the ring.', by: 'you', fp, at: 1 }), { now: true });
  await setHouse({ context: 200000 });
  await archivist.run(b.novelId);
  assert.equal((await checkAsks()).length, 0, 'his own words are never checked');
  /* the helper's, checked; then its words changed by the partner's change — checked again */
  store.change('chapter', b.ids[0], shape.chapterSteps.setSummary({ text: 'Mara says no to the ring.', fp, at: 2 }), { now: true });
  await reset();
  await script([NOTHING_WRONG]);
  await archivist.run(b.novelId);
  assert.equal((await checkAsks()).length, 1);
  store.change('chapter', b.ids[0], (c) => { c.summary.text = 'Mara says no to the ring, coldly.'; }, { now: true });
  await reset();
  await script([NOTHING_WRONG]);
  await archivist.run(b.novelId);
  assert.equal((await checkAsks()).length, 1, 'new words, checked again');
  await setHouse();
  await putAway(b);
});

await test('summaries kept before the check are checked too — a few a run, the book’s stretches and chapters oldest first — and the helper comes back for the rest by itself', async () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  const b = await makeBook([Array.from({ length: 9 }, (_, i) => words(1000, `q${i}x`)), ['The next chapter.']], { manual: true });
  markAllSeen(b);
  const c = b.ch();
  const plan = stretchesMod.stretchPlan(c, { closeLast: true });
  plan.stretches.forEach((st, k) => { st.text = `OLD STRETCH ${k + 1}, from q${k * 2}x1.`; st.at = 1; });
  store.change('chapter', b.ids[0], (x) => { x.stretches = stretchesMod.keptStretches(plan); x.summary = { text: 'OLD CHAPTER SUMMARY.', fp: shape.chapterPrint(x), at: 1 }; }, { now: true });
  await setHouse({ context: 200000 });
  await script(Array.from({ length: 10 }, () => NOTHING_WRONG));
  await archivist.run(b.novelId);
  let asks = await checkAsks();
  assert.equal(asks.length, archivist.CHECKS_PER_RUN, `${asks.length} checks in the first run`);
  assert.ok(asks[0].includes('OLD STRETCH 1,') && asks[0].includes('q0x0') && !asks[0].includes('q4x0'), 'the first stretch first, against its own words');
  await reset();
  await script(Array.from({ length: 10 }, () => NOTHING_WRONG));
  await archivist.run(b.novelId);
  asks = await checkAsks();
  assert.equal(asks.length, plan.stretches.length + 1 - archivist.CHECKS_PER_RUN, 'the rest the next run');
  assert.ok(asks.at(-1).includes('OLD CHAPTER SUMMARY.'), 'the chapter’s own summary after its stretches');
  await store.flush();
  const kept = await onPhone('chapter', b.ids[0]);
  assert.ok(kept.stretches.every((x) => summaryCheckMod.checkedNow(x)) && summaryCheckMod.checkedNow(kept.summary), 'every one marked');
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await checkAsks()).length, 0, 'and nothing asked again');
  await setHouse();
  await putAway(b);
});

await test('a summary its model will not check is asked on two runs, then passed by with its mark saying so — never asked on every run', async () => {
  const b = await makeBook([[GATE], ['Chapter two words.']], { manual: true });
  markAllSeen(b);
  store.change('chapter', b.ids[0], (x) => { x.summary = { text: 'Mara refused the ring.', fp: shape.chapterPrint(x), at: 1 }; }, { now: true });
  await setHouse({ context: 200000 });
  const asked = [];
  for (let run = 0; run < 3; run++) {
    await reset();
    await script(Array.from({ length: 6 }, (_, i) => (i % 3 === 2 ? { text: '{"ok": true}' } : { text: 'I would rather not.' })));
    await archivist.run(b.novelId);
    asked.push((await checkAsks()).length);
  }
  assert.ok(asked[0] > 0 && asked[1] > 0 && asked[2] === 0, `asked on the first two runs, not the third: ${asked}`);
  await store.flush();
  const s = (await onPhone('chapter', b.ids[0])).summary;
  assert.ok(s.checked && s.checked.unread && s.text === 'Mara refused the ring.', JSON.stringify(s));
  await setHouse();
  await putAway(b);
});

/* his question: a scene played long — "just in case, isn't it needed?" */
function longScene(n = 60, words = 100) {
  const turns = [];
  for (let i = 0; i < n; i++) {
    const tag = `T${i + 1}X`;
    turns.push(shape.newTurn(i % 2 ? 'ai' : 'you', `${tag} ` + Array.from({ length: words }, (_, k) => `${tag.toLowerCase()}w${k % 20}`).join(' ') + '.'));
  }
  return { id: 'pl-long', novelId: 'n', chapterId: 'c', who: 'Mara', turns };
}
await test('a long scene: its earliest turns ride as the summaries of their stretches — the fewest that fit — never just left out; without them, what is left out is said', () => {
  const p = longScene();
  const plan = stretchesMod.scenePlan(p);
  assert.ok(plan.stretches.length >= 2, `${plan.stretches.length} stretches`);
  plan.stretches.forEach((st, k) => { st.text = `SCENE STRETCH ${k + 1}: Mara and the narrator, in short.`; st.at = 1; });
  p.stretches = stretchesMod.keptStretches(plan);
  const conn = { ...CONN, context: 16000 };
  const all = (out) => out.map((m) => m.content).join('\n');
  const got = talk.turnsFor(p, { conn });
  const t = all(got);
  assert.ok(got[0].role === 'user' && got[0].content.startsWith(talk.SCENE_SHORT), got[0].content.slice(0, 120));
  const shown = [...t.matchAll(/SCENE STRETCH (\d+):/g)].map((m) => +m[1]);
  assert.ok(shown.length >= 1 && shown.every((x, i) => x === i + 1), `its earliest stretches, in order: ${shown}`);
  const lastIn = plan.stretches[shown.length - 1];
  const after = p.turns.findIndex((x) => x.id === lastIn.to) + 1;
  assert.ok(!t.includes('T1X ') && t.includes(`T${after + 1}X `) && t.includes(`T${p.turns.length}X `), 'the turns it stands for not sent, every turn after it whole');
  assert.ok(!/left out here/.test(t), 'nothing left out');
  assert.ok(util.estimateTokens(t) <= 16000 * 0.25 + 50, `it fits the narrator's share: ${util.estimateTokens(t)}`);
  /* no summaries kept: as before, what is left out is said */
  const bare = all(talk.turnsFor({ ...p, stretches: [] }, { conn }));
  assert.ok(bare.includes('(The earliest turns of this scene are left out here, to save room.)') && !bare.includes(talk.SCENE_SHORT));
  /* a turn changed inside the first stretch: its summary no longer stands, and none after it is used out of order */
  const changed = structuredClone(p);
  changed.turns[1].versions[0].text += ' CHANGED.';
  const c = all(talk.turnsFor(changed, { conn }));
  assert.ok(!c.includes('SCENE STRETCH') && c.includes('(The earliest turns of this scene are left out here, to save room.)'), 'a summary of words that changed is never sent');
  /* a turn asked again at the end of the second stretch, on a narrator with less room: only the stretches before it, never one that holds it */
  const endOfSecond = p.turns.findIndex((x) => x.id === plan.stretches[1].to);
  const again = all(talk.turnsFor(p, { conn: { ...CONN, context: 12000 }, upto: p.turns[endOfSecond].id }));
  assert.ok(again.includes('SCENE STRETCH 1:') && !again.includes('SCENE STRETCH 2:') && !again.includes(`T${endOfSecond + 1}X `), 'never a summary of the turn being answered again');
});

await test('the helper sums a long scene up in stretches — as its transcript, the one before carried in — only once it grows long for the narrator, and checks each summary', async () => {
  const b = await makeBook([['The lamp was cold.']], { manual: true });
  markAllSeen(b);
  /* a narrator with room for it: a scene of thirty turns — a stretch already closed in it — is read whole, nothing summed up */
  await setHouse({ context: 64000 }, CRAFTS_OFF);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  const add = (turns) => { for (const x of turns) store.change('play', playId, shape.turnSteps.addTurn(x), { now: true }); };
  add(longScene(30, 100).turns);
  assert.ok(stretchesMod.scenePlan(store.peek('play', playId)).stretches.length >= 1, 'a stretch of it closed');
  await reset();
  await archivist.run(b.novelId);
  const sceneAsks = async () => (await requests()).map((x) => String(x.body.messages.at(-1).content)).filter((m) => m.includes('Sum up this stretch of the scene alone'));
  assert.equal((await sceneAsks()).length, 0, 'a scene the narrator holds well is read whole: nothing summed up');
  /* the narrator's room smaller, the scene longer: summed up */
  await setHouse({ context: 16000 }, CRAFTS_OFF);
  add(longScene(60, 100).turns.slice(30));
  await reset();
  await script([{ text: '{"summary": "the first stretch of the scene."}' }, { text: '{"summary": "the second stretch of the scene."}' }, NOTHING_WRONG, NOTHING_WRONG]);
  await archivist.run(b.novelId);
  const asks = await sceneAsks();
  assert.ok(asks.length >= 1, 'summed up');
  assert.ok(asks[0].includes('I play Mara') && asks[0].includes('Mara: T1X') && asks[0].includes('Narrator: T2X') && asks[0].includes('never more of Mara'), asks[0].slice(0, 700));
  if (asks[1]) assert.ok(asks[1].includes('The stretch before this one, in short:') && asks[1].includes('the first stretch of the scene.'), 'the one before carried in');
  await store.flush();
  const p = await onPhone('play', playId);
  assert.equal(p.stretches[0].text, 'the first stretch of the scene.');
  const checks = await checkAsks();
  assert.ok(checks.length >= 1 && checks[0].includes('the narrator reads in place of these turns') && checks[0].includes('Mara: T1X'), 'checked against its turns');
  assert.ok(summaryCheckMod.checkedNow(p.stretches[0]), 'and marked');
  /* the narrator's next request: the scene told from these */
  await reset();
  await script([{ text: 'The narrator goes on.' }]);
  const said = await talk.playSay({ playId, text: 'I LIGHT THE LAMP.' });
  assert.equal(said.ok, true, JSON.stringify(said));
  const sent = (await requests())[0].body.messages.map((m) => String(m.content)).join('\n');
  assert.ok(sent.includes(talk.SCENE_SHORT) && sent.includes('the first stretch of the scene.') && sent.includes('I LIGHT THE LAMP.') && !sent.includes('left out here'), 'the narrator reads the scene so far in short');
  await setHouse();
  await putAway(b);
});

heading('a long chapter kept in stretches on any model (2.11.4)');

/* his question: chapter one reaches 100k tokens — does it become one summary, or per passage like Summaryception? On a model that holds it
 * whole it had no stretches, so once the book outgrew the room it fell to its one summary: 1,200 words for 60,000 */
await test('a chapter past 14,400 words is kept in stretches whatever the writer’s room — its one summary stops growing there — and summed up from them; a shorter one on a large model is not', async () => {
  const words = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i % 50}`).join(' ') + '.';
  /* 15,000 words, on models that hold it whole many times over */
  let b = await makeBook([Array.from({ length: 15 }, (_, i) => words(1000, `L${i}x`)), ['The next chapter.']], { manual: true });
  markAllSeen(b);
  await setHouse({ context: 500000 });
  const n = stretchesMod.stretchPlan(b.ch(0), { closeLast: true }).stretches.length;
  assert.equal(n, 5, 'five stretches of about 2,500–3,000 words, on passage boundaries');
  await script(Array.from({ length: n }, (_, k) => ({ text: JSON.stringify({ summary: `long stretch ${k + 1}.` }) })));
  await archivist.run(b.novelId);
  const asks = (await requests()).map((x) => String(x.body.messages.at(-1).content));
  assert.equal(asks.filter((m) => m.includes('Sum up this stretch alone')).length, n, 'each stretch summed up');
  const sum = asks.find((m) => m.includes('is a long chapter, kept in stretches. Here is every stretch of it'));
  assert.ok(sum && sum.includes('long stretch 1.') && sum.includes('long stretch 5.') && !sum.includes('L0x0 L0x1'), 'its one summary made from them, not from its pages');
  await store.flush();
  const kept = (await onPhone('chapter', b.ids[0])).stretches;
  assert.deepEqual(kept.map((x) => x.text), Array.from({ length: n }, (_, k) => `long stretch ${k + 1}.`));
  /* the level between is there for it once the book outgrows the room: by its stretches, not its 1,250-word summary */
  const novel = b.novel();
  const chapters = { [b.ids[0]]: b.ch(0), [b.ids[1]]: b.ch(1) };
  const fit = context.fitBook({ novel, chapters, chapterId: b.ids[1], current: null, room: 1500 });
  assert.ok(fit.book.summaries.length === 1 && fit.book.summaries[0].text.includes('long stretch 1.') && fit.book.summaries[0].text.includes('long stretch 5.'), JSON.stringify(fit.book.summaries).slice(0, 300));
  /* with more room left, the rest of it word for word after its earliest stretches (2.11.5) */
  const more = context.fitBook({ novel, chapters, chapterId: b.ids[1], current: null, room: 6000 }).book.summaries[0].text;
  assert.ok(more.startsWith('long stretch 1.') && more.includes('The rest of it, word for word:') && more.includes('L14x49.') && !more.includes('long stretch 5.'), more.slice(0, 200));
  await putAway(b);
  /* 12,000 words on the same models: its one summary holds it at a twelfth — no stretches */
  b = await makeBook([Array.from({ length: 12 }, (_, i) => words(1000, `S${i}x`)), ['The next chapter.']], { manual: true });
  markAllSeen(b);
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).map((x) => String(x.body.messages.at(-1).content)).filter((m) => m.includes('Sum up this stretch alone')).length, 0);
  await setHouse();
  await putAway(b);
});

heading('the newest chapter in short, partly whole (2.11.5)');

/* his question: what happens on a 200k model? Chapter one of 100k beside a chapter two of 80k went by its stretches' summaries alone (11k tokens) and left some 80k of the room unused */
await test('when the chapter before cannot ride whole, the room left takes as much of its end word for word as fits — its earliest stretches in short, cut at a stretch’s edge — and the request uses the room it has', () => {
  const { novel, chapters, longs, now } = longChapterBook(1);
  const c1 = longs[0];
  const plan = stretchesMod.stretchPlan(c1, { closeLast: true });
  const make = (room) => context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: room, maxTokens: 1000 }, target: { chapterId: now.id }, request: 'Go on.' });
  let found = null;
  for (let room = 40000; room >= 4000 && !found; room -= 500) {
    const a = make(room);
    const t = sentOf(a);
    if (t.includes('The rest of it, word for word:') && !t.includes('WORDS1X1 happened')) found = { room, a, t };
  }
  assert.ok(found, 'a room where chapter one rides partly whole');
  const { room, a, t } = found;
  const inShort = [...t.matchAll(/C1 STRETCH (\d+):/g)].map((m) => +m[1]);
  assert.ok(inShort.length >= 1 && inShort.every((x, i) => x === i + 1) && inShort.length < plan.stretches.length, `its earliest stretches in short, in order: ${inShort}`);
  const whole = [...t.slice(t.indexOf('The rest of it, word for word:')).matchAll(/WORDS1X(\d+) happened/g)].map((m) => +m[1]);
  const edge = c1.passages.findIndex((p) => p.id === plan.stretches[inShort.length].from) + 1;
  assert.equal(Math.min(...whole), edge, 'the words kept whole start at a stretch’s edge');
  assert.equal(Math.max(...whole), 40, 'to its last passage');
  assert.ok(!t.includes(`C1 STRETCH ${inShort.length + 1}:`) && !t.includes('C1 ONE SUMMARY'), 'nothing told twice');
  assert.ok(a.stats.tokens > (room - 1000) * 0.75, `the room is used: ${a.stats.tokens} of ${room}`);
  /* asked twice, told the same */
  assert.equal(sentOf(make(room)), t);
  /* the partner sees which passages its summaries stand for */
  let p = '';
  for (let r = 40000; r >= 4000 && !p.includes('The rest of it, word for word:'); r -= 500) p = sentOf(context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: r, maxTokens: 1000 }, purpose: 'partner', turns: [], target: { chapterId: now.id }, request: 'Hi' }));
  assert.ok(p.includes('The rest of it, word for word:'), 'a room where the partner has it partly whole');
  assert.ok(/\[1\.1–1\.\d+, in short\]\nC1 STRETCH 1:/.test(p) && /\[1\.\d+\] Chapter 1 passage/.test(p) && p.includes('[1.40] Chapter 1 passage 40'), 'numbered for the partner');
});

/* a book whose one long chapter is kept in stretches, every one summed up and checked: on a helper too small for its words it rides partly whole */
async function partlyBook() {
  const para = (i) => `Mara walked passage ${i} of the long hall and counted its lamps. WORDSP${i} happened here. `.repeat(16).trim();
  /* an anvil rings in its first passage only, a kettle sings in its last only */
  const b = await makeBook([Array.from({ length: 40 }, (_, i) => para(i + 1) + (i === 0 ? ' An anvil rang.' : i === 39 ? ' A kettle sang.' : '')), ['The second chapter, open now.']], { manual: true });
  store.change('chapter', b.ids[0], (c) => {
    const plan = stretchesMod.stretchPlan(c, { closeLast: true });
    plan.stretches.forEach((x, k) => { x.text = `P STRETCH ${k + 1}: Mara walked the hall.`; x.at = 1; x.checked = { sig: summaryCheckMod.checkSig(x.text), at: 2 }; });
    c.stretches = stretchesMod.keptStretches(plan);
  }, { now: true });
  return b;
}

/* the audit and the partner are handed the same fit: the part told word for word is read as words, the part in short as a telling */
await test('the notes’ check given the end of the book partly whole reads its end word for word: it may say where someone is now, and is never told the end is only in short', async () => {
  await reset();
  const b = await partlyBook();
  store.change('novel', b.novelId, (n) => { n.order = [b.ids[0]]; }, { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', shape.newCard('people', { name: 'Mara', about: 'Walks the hall.', now: 'At the gate.' })), { now: true });
  for (const name of ['the old anvil', 'the old kettle']) store.change('novel', b.novelId, shape.novelSteps.putNote('lore', shape.newCard('lore', { name, about: 'It is in the hall.' })), { now: true });
  markAllSeen(b);
  await setHouse({ context: 14000 }, { checksFrom: 0, judge: { on: false } });
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', now: 'At the far end of the hall.' }], gone: [{ kind: 'lore', name: 'the old anvil', why: 'x' }, { kind: 'lore', name: 'the old kettle', why: 'x' }], verdict: 'Moved.' }) }]);
  await archivist.run(b.novelId);
  const audit = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes(prompts.AUDIT_ASK));
  assert.ok(audit, archivist.lightOf(b.novelId).words + ' ' + JSON.stringify((await requests()).map((x) => x.body.messages.at(-1).content.slice(0, 120))) + JSON.stringify((b.novel().memory || {}).audit || null));
  assert.ok(audit.includes('P STRETCH 1:') && audit.includes('The rest of it, word for word:') && audit.includes('WORDSP40 happened'), 'the end chapter rides partly whole, its end word for word');
  assert.ok(!audit.includes('given here only in short'), 'never told the end is only in short');
  assert.equal(b.novel().notes.people[0].now, 'At the far end of the hall.', 'where she is now, read from the end of the book');
  /* what it read word for word it may judge; what it read only in short may still tell of a thing */
  assert.deepEqual(b.novel().notes.lore.map((c) => c.name), ['the old anvil'], 'the kettle, told of only in the words it read, may go; the anvil, in the part in short, stays');
  /* the same book with its stretches not summed up: the end in short, and where she is now stays */
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { ...b.novel().notes.people[0], now: 'At the gate.' }), { now: true });
  store.change('chapter', b.ids[0], (c) => { c.stretches = []; c.summary = { text: 'MARA WALKED THE HALL.', fp: shape.chapterPrint(c), at: 1, by: 'you' }; }, { now: true });
  await reset();
  archivist.askAudit(b.novelId);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara', now: 'At the far end of the hall.' }], verdict: 'Moved.' }) }]);
  await archivist.run(b.novelId);
  const inShort = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes(prompts.AUDIT_ASK));
  assert.ok(inShort && inShort.includes('given here only in short') && !inShort.includes('The rest of it, word for word:'), (inShort || '').slice(0, 300));
  assert.equal(b.novel().notes.people[0].now, 'At the gate.');
  await setHouse();
  await putAway(b);
});

await test('the partner may write anew a passage it had word for word in a chapter told partly whole — never one it had only in short', async () => {
  await reset();
  const b = await partlyBook();
  await setHouse({ context: 15000 }, CRAFTS_OFF);
  const a = context.assemble({ house: quietHouse(), novel: b.novel(), chapters: Object.fromEntries(b.ids.map((id, i) => [id, b.ch(i)])), conn: { ...CONN, context: 15000 }, purpose: 'partner', turns: [], target: { chapterId: b.ids[1] }, request: 'x' });
  const t = sentOf(a);
  assert.ok(t.includes('The rest of it, word for word:') && t.includes('[1.40]'), 'chapter one rides partly whole for the partner ' + JSON.stringify({ tokens: a.stats.tokens, room: a.stats.room, short: a.stats.short, whole: a.stats.whole, fixed: a.stats.fixed, s: t.includes('P STRETCH 1'), w: t.includes('WORDSP1 ') }));
  assert.ok(a.stats.wholePassages.includes(b.ch(0).passages[39].id) && !a.stats.wholePassages.includes(b.ch(0).passages[0].id));
  await script([{ text: '<changes>[{"passage": "1.40", "text": "THE LAST PASSAGE, ANEW."}, {"passage": "1.1", "text": "THE FIRST PASSAGE, ANEW."}]</changes>\nDone.' }, { text: 'Fine.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[1], text: 'Rewrite them.' });
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  const last = v.changes.find((c) => c.op && c.op.passage === '1.40');
  const first = v.changes.find((c) => c.op && c.op.passage === '1.1');
  assert.equal(last && last.status, 'made', JSON.stringify(v.changes));
  assert.equal(picked(b.ch(0).passages[39]).text, 'THE LAST PASSAGE, ANEW.');
  assert.ok(first && first.status === 'refused' && /only in short/.test(first.said), JSON.stringify(v.changes));
  assert.notEqual(picked(b.ch(0).passages[0]).text, 'THE FIRST PASSAGE, ANEW.');
  await setHouse();
  await putAway(b);
});

heading('the bibliography (2.12)');

const bib = await import(path.join(ROOT, 'js/novel/bibliography.js'));

await test('a name is found as it is written: with its capitals (or shouted), a word of his in small letters however written, a person by a name of theirs alone — never inside another word, a hyphened name or a description', () => {
  const entries = [bib.tidyEntry(bib.newEntry({ name: 'Rukia Kuchiki', kind: 'people', line: 'x' })), bib.tidyEntry(bib.newEntry({ name: 'bankai', kind: 'lore', line: 'x' })), bib.tidyEntry(bib.newEntry({ name: 'Will Turner', kind: 'people', line: 'x' }))];
  const cards = { people: [{ id: 'p1', name: 'Mary', aka: [] }, { id: 'p2', name: 'the girl', aka: [] }], lore: [{ id: 'l1', name: 'the letter' }, { id: 'l2', name: 'the Hollow Crown' }] };
  const f = bib.makeFinder(bib.nameForms(entries, cards));
  const t = 'RUKIA ran. Rukia Kuchiki stood. Kuchiki bowed. She will go. Will came. Bankai! bankai. Mary-Jane met Mary. the girl read the letter by the Hollow Crown. Rukias.';
  const found = f.find(t).map((x) => t.slice(x.start, x.end));
  assert.deepEqual(found, ['RUKIA', 'Rukia Kuchiki', 'Kuchiki', 'Will', 'Bankai', 'bankai', 'Mary', 'Hollow Crown']);
});

await test('a fact is kept for the bibliography only with the words of its passage that say it, about a name the passage gives — loose about quote marks and dashes, never about the words themselves', () => {
  const text = 'Hae-won set her glass square to the table’s edge. “No,” she said — firmly.';
  const c = bib.codexOf([
    { name: 'Hae-won', kind: 'people', fact: 'She squares her glass with the table’s edge.', evidence: "set her glass square to the table's edge" },
    { name: 'Hae-won', kind: 'people', fact: 'She is a nurse.', evidence: 'she worked nights at the hospital' },
    { name: 'Mina', kind: 'people', fact: 'Mina is tall.', evidence: 'set her glass square' },
    { name: 'Hae-won', kind: 'people', fact: '', evidence: 'set her glass' },
  ], { text });
  assert.deepEqual(c.facts.map((x) => x.fact), ['She squares her glass with the table’s edge.']);
  assert.equal(c.complete, false, 'what was refused leaves it incomplete');
  assert.equal(c.fp, util.hashText(text));
});

/* a book in hand, pure: chapter one with a fact kept on its first passage, his entries, and a chapter being written */
function bibBook() {
  const { novel, chapter: c1 } = shape.newNovel({ title: 'Soul Gate', brief: 'A reaper story.' });
  const c2 = shape.newChapter(novel.id);
  const c3 = shape.newChapter(novel.id);
  novel.order = [c1.id, c2.id, c3.id];
  const filler = (tag) => `${tag} The hall was long and the lanterns swung. `.repeat(300);
  c1.passages = [shape.newPassage('ai', 'Rukia Kuchiki stood at the gate. Her eyes were a deep violet. ' + filler('C1A')), shape.newPassage('ai', 'Later, Rukia cut her hair short. ' + filler('C1B'))];
  c2.passages = [shape.newPassage('ai', filler('C2'))];
  c3.passages = [shape.newPassage('ai', 'The chapter being written begins.')];
  const v1 = picked(c1.passages[0]);
  v1.codex = bib.codexOf([{ name: 'Rukia Kuchiki', kind: 'people', fact: 'Her eyes are violet.', evidence: 'Her eyes were a deep violet' }], { text: v1.text });
  const v2 = picked(c1.passages[1]);
  v2.codex = bib.codexOf([{ name: 'Rukia', kind: 'people', fact: 'She cut her hair short.', evidence: 'Rukia cut her hair short' }], { text: v2.text });
  novel.bibliography = [
    bib.tidyEntry(bib.newEntry({ name: 'Gotei 13', kind: 'groups', rides: 'always', text: 'THE THIRTEEN SQUADS.' })),
    bib.tidyEntry(bib.newEntry({ name: 'bankai', kind: 'lore', line: 'THE FINAL RELEASE' })),
    bib.tidyEntry(bib.newEntry({ name: 'Secret Ending', kind: 'lore', rides: 'never', text: 'SPOILER WORDS' })),
  ];
  return { novel, chapters: { [c1.id]: c1, [c2.id]: c2, [c3.id]: c3 }, c1, c2, c3 };
}

await test('the writer reads the whole bibliography while it fits — Always first, never one kept for him — and the book’s facts only from chapters it is not reading word for word, never from after the point', () => {
  const b = bibBook();
  const sent = (room, request, target = { chapterId: b.c3.id }, purpose = 'write') => {
    const a = context.assemble({ house: quietHouse(), novel: b.novel, chapters: b.chapters, conn: { ...CONN, context: room, maxTokens: 1000 }, purpose, ...(purpose === 'partner' ? { turns: [] } : {}), target, request });
    return { t: sentOf(a), a };
  };
  let { t } = sent(200000, 'They walk on.');
  assert.ok(t.includes('THE THIRTEEN SQUADS.'), 'always rides');
  /* (2.12.28: "what if it's only mentioned but it's important, and not sent?" — the room holds it: it goes) */
  assert.ok(t.includes('THE FINAL RELEASE') && t.includes(prompts.BIB_LEAD_WHOLE), 'not named, and the room holds it: the whole bibliography goes, said so');
  assert.ok(t.indexOf('THE THIRTEEN SQUADS.') < t.indexOf('THE FINAL RELEASE'), 'Always first');
  assert.ok(!t.includes('SPOILER WORDS'), 'his alone: never the writer’s');
  ({ t } = sent(200000, 'Rukia uses her bankai.'));
  assert.ok(t.includes('THE FINAL RELEASE'), 'named in his words, in small letters or with a capital: sent');
  assert.ok(!t.includes('Her eyes are violet.'), 'chapter one rides word for word: its facts are not sent again');
  let a;
  ({ t, a } = sent(9000, 'Rukia uses her bankai.'));
  assert.ok(!a.stats.wholeIds.includes(b.c1.id), 'chapter one is not word for word in this room');
  assert.ok(t.includes('Her eyes are violet. (Chapter One)') && t.includes('She cut her hair short. (Chapter One)'), 'its facts about the name come back');
  /* writing again the first passage of chapter one: nothing after it has happened yet — a fact chapter two tells is not sent */
  const v3 = picked(b.c2.passages[0]);
  v3.text = 'Rukia took the captain’s white coat that winter. ' + v3.text;
  v3.codex = bib.codexOf([{ name: 'Rukia', kind: 'people', fact: 'She became a captain.', evidence: 'Rukia took the captain’s white coat' }], { text: v3.text });
  let small = 0;
  for (let room = 9000; room >= 3000 && !small; room -= 250) { ({ a } = sent(room, 'Rukia waits.')); if (!a.stats.wholeIds.includes(b.c2.id)) small = room; }
  assert.ok(small, 'a room where chapter two rides in short');
  ({ t } = sent(small, 'Rukia waits.', { chapterId: b.c3.id }));
  assert.ok(t.includes('She became a captain. (Chapter Two)'), 'written after chapter two, which rides in short: its fact is sent');
  ({ t } = sent(small, 'Rukia waits.', { chapterId: b.c1.id, mark: b.c1.passages[0].id }));
  assert.ok(!t.includes('She became a captain.') && !t.includes('She cut her hair short.'), 'never a fact from after the point');
  /* his entry kept for him alone is never the writer's, even named */
  ({ t } = sent(200000, 'The Secret Ending comes.'));
  assert.ok(!t.includes('SPOILER WORDS'), 'kept for him: never the writer’s, even named');
  /* the partner: every entry of his by name and line, the one kept for him marked, and the ones named whole */
  const p = sent(200000, 'What about the Secret Ending?', { chapterId: b.c3.id }, 'partner');
  assert.ok(p.t.includes(prompts.BIB_INDEX) && p.t.includes('- Secret Ending [only for me — the writer never reads it]') && p.t.includes('SPOILER WORDS'), p.t.slice(p.t.indexOf(prompts.BIB_INDEX), p.t.indexOf(prompts.BIB_INDEX) + 400));
});

await test('past its share, the bibliography keeps his words’ names, then the nearest, then the rest that shares the most words with the moment — and says when all of it went', () => {
  const long = 'WORD '.repeat(3000);
  const novel = { bibliography: ['Ann', 'Bo', 'Cy', 'Dee'].map((n) => bib.tidyEntry(bib.newEntry({ name: n, kind: 'people', text: `${n.toUpperCase()}-ENTRY ${n === 'Bo' ? 'lantern harbour ' : ''}${long}` }))) };
  const items = bib.bibItems(novel, {}, { facts: false });
  const cost = (name) => util.estimateTokens(bib.itemWords(items.find((x) => x.name === name), { facts: [] })) + 4;
  const args = { his: 'Cy lights the lantern.', near: 'Ann sat by the harbour.', rest: true };
  let ride = bib.ridingItems(items, { ...args, budget: cost('Cy') + cost('Ann') + cost('Bo') + 2 });
  assert.deepEqual(ride.items.map((x) => x.name), ['Cy', 'Ann', 'Bo'], 'his words, the nearest, then the one sharing “lantern” and “harbour” — Dee gives way');
  assert.deepEqual([ride.whole, ride.rest, ride.left], [false, 1, 1]);
  ride = bib.ridingItems(items, { ...args, budget: cost('Cy') + cost('Ann') + cost('Bo') + cost('Dee') + 4 });
  assert.deepEqual([ride.items.map((x) => x.name), ride.whole, ride.left], [['Cy', 'Ann', 'Bo', 'Dee'], true, 0], 'all of it, said so');
  /* without the rest (the checker, the partner): only what is named */
  ride = bib.ridingItems(items, { his: args.his, near: args.near, budget: 1e9 });
  assert.deepEqual(ride.items.map((x) => x.name), ['Cy', 'Ann']);
});

await test('an entry crowds out nothing: past its share of the room the farthest named entries give way, his words’ names first, the nearest next', () => {
  const b = bibBook();
  const long = 'WORD '.repeat(3000);
  b.novel.bibliography = ['Ann', 'Bo', 'Cy'].map((n) => bib.tidyEntry(bib.newEntry({ name: n, kind: 'people', text: `${n.toUpperCase()}-ENTRY ${long}` })));
  const ride = bib.ridingItems(bib.bibItems(b.novel, b.chapters), { his: 'Cy speaks.', near: 'Ann sat. Bo stood.', budget: 9000 });
  assert.deepEqual(ride.items.map((x) => x.name), ['Cy', 'Bo'], 'his words first, then the nearest');
  assert.equal(ride.left, 1);
});

await test('the helper fills the bibliography as it reads, each fact on the version that says it — a fact with no words of its passage is never kept; another version takes its facts with it and the arrows bring them back', async () => {
  const b = await makeBook([['Hae-won set her glass square to the table’s edge.']]);
  await script([{ text: JSON.stringify({ people: [{ name: 'Hae-won', about: 'An old friend.' }], bibliography: [{ source: 'Passage 1', facts: [
    { name: 'Hae-won', kind: 'people', fact: 'She squares her glass with the edge of the table.', evidence: 'set her glass square to the table’s edge' },
    { name: 'Hae-won', kind: 'people', fact: 'She is a nurse.', evidence: 'she was a nurse' }] }] }) }]);
  await archivist.run(b.novelId);
  const ask = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Update the notes'));
  assert.ok(ask.includes(prompts.BIB_FACTS_RULE), 'it is asked for the facts as it reads');
  await store.flush();
  const kept = picked((await onPhone('chapter', b.ids[0])).passages[0]).codex;
  assert.deepEqual(kept.facts.map((f) => f.fact), ['She squares her glass with the edge of the table.']);
  const items = () => bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) });
  assert.deepEqual(items().map((it) => [it.name, it.facts.length]), [['Hae-won', 1]]);
  /* another version on show: its facts are its own (none yet) */
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(b.ch(0).passages[0].id, shape.newVersion({ text: 'Hae-won left early.', how: 'edit' })), { now: true });
  assert.deepEqual(items(), [], 'the old words’ facts go with them');
  store.change('chapter', b.ids[0], shape.chapterSteps.pick(b.ch(0).passages[0].id, picked(b.ch(0).passages[0]) && b.ch(0).passages[0].versions[0].id), { now: true });
  assert.deepEqual(items().map((it) => it.name), ['Hae-won'], 'the arrows bring them back');
  await putAway(b);
});

await test('pages read before the bibliography was kept are filled in a few at a time, from their own words — and never asked for again', async () => {
  const b = await makeBook([['Mina wore a red scarf her mother knitted.', 'Joon laughed.']], { manual: true });
  markReadBefore212(b);
  await script([{ bib: true, text: JSON.stringify({ bibliography: [{ source: 'Chapter One, passage 1', facts: [{ name: 'Mina', kind: 'people', fact: 'Her red scarf was knitted by her mother.', evidence: 'a red scarf her mother knitted' }] }, { source: 'Chapter One, passage 2', facts: [] }] }) }]);
  assert.equal(archivist.bibDue(b.novelId).length, 2, 'both pages are due');
  await archivist.run(b.novelId);
  const asks = (await requests()).filter((x) => x.body.messages.at(-1).content.includes('were read into the notes before the book’s bibliography was kept'));
  assert.equal(asks.length, 1, 'one ask for both');
  assert.equal(archivist.bibDue(b.novelId).length, 0, 'none due after');
  assert.deepEqual(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) }).map((it) => [it.name, it.facts[0].fact]), [['Mina', 'Her red scarf was knitted by her mother.']]);
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).filter((x) => x.body.messages.at(-1).content.includes('bibliography was kept')).length, 0, 'never asked again');
  /* filled by hand only: not asked */
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibAuto', 'off'), { now: true });
  store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('ai', 'Mina sang.')); }, { now: true });
  await script([{ text: JSON.stringify({ people: [] }) }]);
  await archivist.run(b.novelId);
  const read = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Update the notes'));
  assert.ok(read && !read.includes(prompts.BIB_FACTS_RULE), 'off: the reading never asks for it');
  await putAway(b);
});

await test('a person’s card is kept a short portrait: a shorter “who they are” is taken only when what it leaves out is kept in the bibliography — never a word of the book lost', async () => {
  const long = 'An old friend of Mina from school. Holds her shoulders up as if bracing against cold. Has fine lines at the corners of her eyes. Squares her glass with the table edge when she has decided something.';
  const short = 'An old friend of Mina from school, precise and unhurried.';
  const notes = { people: [{ id: 'p1', name: 'Hae-won', aka: [], about: long, ties: '', now: '' }] };
  const answer = { people: [{ name: 'Hae-won', about: short }] };
  const without = archivist.foldNotes(JSON.parse(JSON.stringify(notes)), answer, { keptElsewhere: () => '' });
  assert.equal(without.notes.people[0].about, long, 'nothing keeps what it drops: the card stays as it was');
  const kept = 'Holds her shoulders up as if bracing against cold. Has fine lines at the corners of her eyes. She squares her glass with the table edge when she has decided something.';
  const withFacts = archivist.foldNotes(JSON.parse(JSON.stringify(notes)), answer, { keptElsewhere: () => kept });
  assert.equal(withFacts.notes.people[0].about, short, 'the bibliography keeps it: the portrait is taken');
});

await test('with the bibliography kept from the book, the helper is asked for a short portrait; filled by hand only, for who they are whole as before', () => {
  const novel = shape.newNovel({ title: 'T' }).novel;
  const on = prompts.notesRequest({ novel, chapterLabel: 'Chapter One', before: '', changes: [], removed: [], removedChapters: [], codex: true });
  const off = prompts.notesRequest({ novel, chapterLabel: 'Chapter One', before: '', changes: [], removed: [], removedChapters: [], codex: false });
  assert.ok(on.includes('is a short portrait of who they are for good') && on.includes('"bibliography"'));
  assert.ok(!off.includes('short portrait') && !off.includes('"bibliography"') && off.includes('keep everything already in it'));
});

await test('his partner writes an entry when he asks — kind, line, words, other names, when the writer reads it — renamed and taken out with Undo; never a second entry for a name another goes by', async () => {
  const b = await makeBook([['Rukia stood.']]);
  let r = changes.makeChange(b.novelId, { entry: 'Rukia Kuchiki', kind: 'person', line: 'Lieutenant of the 13th', text: 'She wields Sode no Shirayuki.', aka: ['Rukia'], why: 'asked' });
  assert.equal(r.status, 'made', r.said);
  let e = bib.entriesOf(b.novel())[0];
  assert.deepEqual([e.name, e.kind, e.line, e.text, e.aka, e.rides, e.by], ['Rukia Kuchiki', 'people', 'Lieutenant of the 13th', 'She wields Sode no Shirayuki.', ['Rukia'], 'named', 'partner']);
  r = changes.makeChange(b.novelId, { entry: 'Rukia', add: 'Her eyes are violet.', rides: 'always' });
  assert.equal(r.status, 'made', r.said);
  e = bib.entriesOf(b.novel())[0];
  assert.equal(e.text, 'She wields Sode no Shirayuki.\n\nHer eyes are violet.');
  assert.equal(e.rides, 'always');
  assert.equal(changes.undoChange(b.novelId, r).ok, true);
  assert.equal(bib.entriesOf(b.novel())[0].text, 'She wields Sode no Shirayuki.', 'Undo puts the entry back as it was');
  assert.equal(changes.makeChange(b.novelId, { entry: 'Byakuya', text: 'Her brother.', aka: ['Rukia'] }).status, 'refused', 'a name another entry goes by');
  assert.equal(changes.makeChange(b.novelId, { entry: 'Nobody', line: 'x', kind: 'spaceship drive' }).status, 'refused', 'no such kind');
  r = changes.makeChange(b.novelId, { entry: 'Rukia Kuchiki', remove: true });
  assert.equal(r.status, 'made');
  assert.equal(bib.entriesOf(b.novel()).length, 0);
  assert.equal(changes.undoChange(b.novelId, r).ok, true);
  assert.equal(bib.entriesOf(b.novel()).length, 1, 'taken out and put back');
  /* it reads one whole when it asks */
  assert.deepEqual(changes.readAsks('<read>["entry: Rukia"]</read>'), [{ entry: 'Rukia' }]);
  await putAway(b);
});

await test('Continue — his box empty — hands the writer what happens next, to choose for the best novel it can be; his premise, when he gives one, is what happens', () => {
  const chosen = prompts.writeRequest({ chapterLabel: 'Chapter Two', direction: '', length: 'auto' });
  assert.ok(chosen.includes(prompts.CHOSEN_NEXT) && chosen.includes('carry what you chose through'), chosen);
  assert.ok(!chosen.includes('Never begin a new turn of the story I didn’t ask for'), 'never told not to begin what it chose');
  const his = prompts.writeRequest({ chapterLabel: 'Chapter Two', direction: 'They fight.', length: 'auto' });
  assert.ok(his.includes('What happens next: They fight.') && !his.includes(prompts.CHOSEN_NEXT) && his.includes('Never begin a new turn of the story I didn’t ask for'));
  const open = prompts.writeRequest({ chapterLabel: 'Chapter One', direction: '', length: 'auto', empty: true, firstOfBook: true });
  assert.ok(open.includes(prompts.CHOSEN_OPEN));
});

await test('a SillyTavern lorebook comes in as entries — its first key the name, the others and its title names it goes by, a pattern no name, constant always and switched off never — and goes out the same way', () => {
  const wi = { entries: { 0: { uid: 0, key: ['Gotei 13', 'the Thirteen'], comment: 'Court Guard', content: 'Thirteen squads.', constant: true }, 1: { uid: 1, key: ['/sword/i', 'Zanpakuto'], content: 'A soul-cutter.', disable: true }, 2: { uid: 2, key: [], comment: '', content: 'no name' } } };
  const rows = bib.entriesFromLorebook(JSON.stringify(wi));
  assert.deepEqual(rows.map((e) => [e.name, e.aka, e.text, e.rides]), [['Gotei 13', ['Court Guard', 'the Thirteen'], 'Thirteen squads.', 'always'], ['Zanpakuto', [], 'A soul-cutter.', 'never']]);
  const card = { data: { character_book: { entries: [{ keys: ['Ichigo'], content: 'A substitute.', enabled: true }] } } };
  assert.deepEqual(bib.entriesFromLorebook(card).map((e) => [e.name, e.rides]), [['Ichigo', 'named']]);
  const out = bib.lorebookOf(rows);
  assert.deepEqual(bib.entriesFromLorebook(out).map((e) => [e.name, e.rides]), [['Gotei 13', 'always'], ['Zanpakuto', 'never']], 'out and back in, the same');
});

await test('the checker reads the bibliography for who and what its passages name — the book’s facts from before them and his entries — so a slip against a chapter it has only in short is caught', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([['Rukia’s eyes were a deep violet.'], ['Rukia looked up with her blue eyes.']]);
  store.change('chapter', b.ids[0], (c) => { const v = picked(c.passages[0]); v.codex = bib.codexOf([{ name: 'Rukia', kind: 'people', fact: 'Her eyes are violet.', evidence: 'eyes were a deep violet' }], { text: v.text }); }, { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putEntry(bib.tidyEntry(bib.newEntry({ name: 'Rukia', kind: 'people', line: 'HIS LINE FOR RUKIA' }))), { now: true });
  await checker.runCheck(b.novelId);
  const asks = (await requests()).map((x) => x.body.messages.at(-1).content);
  const two = asks.find((a) => a.includes('Check these passages from Chapter Two'));
  assert.ok(two && two.includes(prompts.BIB_FOR_A_READER) && two.includes('Her eyes are violet. (Chapter One)') && two.includes('HIS LINE FOR RUKIA'), (two || '').slice(0, 900));
  const one = asks.find((a) => a.includes('Check these passages from Chapter One'));
  assert.ok(one && !one.includes('Her eyes are violet.'), 'never a fact from the passages it checks');
  await setHouse();
  await putAway(b);
});

await test('Search finds his entries in the bibliography', () => {
  const b = bibBook();
  const hits = search.searchBook({ novel: b.novel, chapters: b.chapters, query: 'final release' });
  assert.ok(hits.some((x) => x.where === 'entry' && x.group === 'Bibliography' && x.label === 'bankai'), JSON.stringify(hits.map((x) => [x.where, x.label])));
});

/* what a review of 2.12 found, each run as it happens */
await test('a portrait made shorter is held to what the bibliography really keeps: words of its own that keep none of what the card leaves out never let the card be cut', () => {
  const long = 'An old friend of Mina from school. Holds her shoulders up as if bracing against cold. Has fine lines at the corners of her eyes. Squares her glass with the table edge when she has decided something.';
  const short = 'An old friend of Mina from school, precise and unhurried.';
  const notes = { people: [{ id: 'p1', name: 'Hae-won', aka: [], about: long, ties: '', now: '' }] };
  const answer = { people: [{ name: 'Hae-won', about: short }] };
  const other = 'The lanterns swung in the long hall at night, and the rain kept on against the shutters until morning came grey. '.repeat(3);
  const fold = (kept) => archivist.foldNotes(JSON.parse(JSON.stringify(notes)), answer, { keptElsewhere: () => kept }).notes.people[0].about;
  assert.equal(fold(other), long, 'the bibliography holds none of it, however long its words: the card stands');
  assert.equal(fold('Holds her shoulders up as if bracing against cold.'), long, 'one of three details kept: the card stands');
  assert.equal(fold(`${other} Holds her shoulders up as if bracing against cold. Fine lines at the corners of her eyes. She squares her glass with the table edge once she has decided.`), short, 'all of it kept there: the portrait is taken');
});

await test('what rides of the bibliography keeps to its share however much the book has told — an entry set to always as well — his own words first, then a fact for each in turn, so the one told of most is never the one left out', () => {
  const facts = (tag, n) => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, fact: `${tag} detail number ${i}, a lasting one about the ${['sword', 'eyes', 'coat', 'rank', 'squad', 'past'][i % 6]}.`, evidence: [`${tag} ${i}`], passageId: `p${i}`, label: `Chapter ${['One', 'Two', 'Three'][i % 3]}, passage ${i + 1}` }));
  const item = (ref, name, kind, entry, n, rides = 'named') => ({ ref, name, aka: [], kind, rides, line: '', text: '', entry, card: null, facts: facts(name.toUpperCase(), n), kinds: {} });
  const items = [
    item('e:r', 'Rukia Kuchiki', 'people', { name: 'Rukia Kuchiki', line: 'HIS LINE', text: 'HIS WORDS FOR RUKIA', rides: 'named' }, 600),
    item('e:g', 'Gotei 13', 'groups', { name: 'Gotei 13', line: '', text: 'HIS WORDS FOR THE SQUADS', rides: 'always' }, 600, 'always'),
    item('n:byakuya', 'Byakuya', 'people', null, 3),
  ];
  for (const budget of [1500, 4000, 12000]) {
    const ride = bib.ridingItems(items, { his: 'Rukia Kuchiki draws.', near: 'Byakuya watched.', budget });
    const words = ride.words.join('\n\n');
    assert.ok(ride.cost <= budget && util.estimateTokens(words) <= budget * 1.05, `${budget}: ${ride.cost} / ${util.estimateTokens(words)}`);
    assert.deepEqual(ride.items.map((x) => x.name), ['Gotei 13', 'Rukia Kuchiki', 'Byakuya'], `${budget}: every one rides`);
    assert.ok(words.includes('HIS WORDS FOR RUKIA') && words.includes('HIS WORDS FOR THE SQUADS'), 'his own words ride whole');
    assert.ok(words.includes('BYAKUYA detail number 2') && words.includes('RUKIA KUCHIKI detail number 0') && words.includes('GOTEI 13 detail number 0'), 'each told of in turn');
    /* (never all six hundred — counted: the newest of them rides beside the first since 2.12.18) */
    assert.ok((words.match(/RUKIA KUCHIKI detail number \d+/g) || []).length < 600, 'never all six hundred');
  }
});

/* chapter one in short at 9,000 (as above): what the writer reads of a name */
function sentBib(b, room, request) {
  const a = context.assemble({ house: quietHouse(), novel: b.novel, chapters: b.chapters, conn: { ...CONN, context: room, maxTokens: 1000 }, target: { chapterId: b.c3.id }, request });
  return { t: sentOf(a), a };
}
await test('an entry he keeps for himself hides his words, never what the book itself says of the name; and with Fill it from the book off, what the helper found still rides', () => {
  const b = bibBook();
  b.novel.bibliography.push(bib.tidyEntry(bib.newEntry({ name: 'Rukia Kuchiki', aka: ['THE TRAITOR'], kind: 'people', rides: 'never', line: 'HIS SECRET LINE', text: 'SHE BETRAYS THEM IN BOOK TWO.' })));
  let { t, a } = sentBib(b, 9000, 'Rukia waits.');
  assert.ok(!a.stats.wholeIds.includes(b.c1.id), 'chapter one rides in short');
  assert.ok(t.includes('Her eyes are violet. (Chapter One)'), 'the book’s own words about her ride');
  assert.ok(!t.includes('SHE BETRAYS') && !t.includes('THE TRAITOR') && !t.includes('HIS SECRET LINE'), 'his never');
  b.novel.prefs = { ...(b.novel.prefs || {}), bibAuto: 'off' };
  ({ t } = sentBib(b, 9000, 'Rukia waits.'));
  assert.ok(t.includes('Her eyes are violet. (Chapter One)'), 'the helper adds nothing more — what it found stays');
});

await test('the facts that ride are those of the chapters the request carries in short: fitted together, a chapter is never sent as neither its words nor its facts — nor a passage of the chapter open that is not there word for word', () => {
  /* thirty short chapters, a fact of hers in each: the room her facts take moves the line between whole and in short */
  const { novel, chapter: first } = shape.newNovel({ title: 'Soul Gate', brief: 'A reaper story.' });
  const chapters = {};
  novel.order = [];
  for (let i = 0; i < 31; i++) {
    const c = i === 0 ? first : shape.newChapter(novel.id);
    const line = `Rukia kept the token of chapter ${i + 1}.`;
    c.passages = [shape.newPassage('ai', `${line} ${`C${i + 1} The hall was long and the lanterns swung. `.repeat(50)}`)];
    c.summary = { text: `Chapter ${i + 1} in short.` };
    if (i < 30) { const v = picked(c.passages[0]); v.codex = bib.codexOf([{ name: 'Rukia', kind: 'people', fact: `In chapter ${i + 1} she keeps a token.`, evidence: line }], { text: v.text }); }
    novel.order.push(c.id);
    chapters[c.id] = c;
  }
  const now = novel.order[30];
  let mixed = 0;
  for (let room = 6000; room <= 20000; room += 20) {
    const a = context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: room, maxTokens: 1000 }, target: { chapterId: now }, request: 'Rukia waits.' });
    if (a.over) continue;
    const t = sentOf(a);
    const row = novel.order.slice(0, 30).map((id, i) => ({ whole: a.stats.wholeIds.includes(id) || t.includes(`Rukia kept the token of chapter ${i + 1}.`), told: t.includes(`In chapter ${i + 1} she keeps a token.`) }));
    row.forEach((x, i) => assert.ok(x.whole || x.told, `room ${room}: chapter ${i + 1} is in neither its words nor its facts`));
    if (row.some((x) => x.told) && row.some((x) => x.whole)) mixed++;
  }
  assert.ok(mixed > 100, `rooms where some chapters ride whole and others by their facts: ${mixed}`);
  /* the chapter open, longer than the room: the passages of it that are not there word for word give their facts; those after the point never */
  const open = novel.order[30];
  chapters[open].passages = Array.from({ length: 40 }, (_, k) => {
    const line = `Rukia kept the charm of passage ${k + 1}.`;
    const p = shape.newPassage('ai', `${line} ${`P${k + 1} The rain went on and on against the shutters. `.repeat(25)}`);
    const v = picked(p);
    v.codex = bib.codexOf([{ name: 'Rukia', kind: 'people', fact: `By passage ${k + 1} she keeps a charm.`, evidence: line }], { text: v.text });
    return p;
  });
  const a = context.assemble({ house: quietHouse(), novel, chapters, conn: { ...CONN, context: 9000, maxTokens: 1000 }, target: { chapterId: open, mark: chapters[open].passages[36].id }, request: 'Rukia waits.' });
  const t = sentOf(a);
  /* there word for word: the whole of it (a passage cut at the edge of what is told is not) */
  const there = (k) => t.includes(picked(chapters[open].passages[k - 1]).text.trim());
  const told = (k) => t.includes(`By passage ${k} she keeps a charm.`);
  const missing = Array.from({ length: 36 }, (_, k) => k + 1).filter((k) => !there(k));
  assert.ok(missing.length > 5, `the chapter is told in part: ${missing.length} passages not there`);
  /* the share they fit in may run out: then what waits is the middle — the first told and the latest told ride (2.12.18: through 2.12.17 the
   * latest waited, so a long book's newest lasting facts — a lost hand, a new rank — were the ones the writer never saw) */
  const toldOnes = missing.filter(told);
  assert.ok(toldOnes.length >= 5, `told: ${toldOnes.join(',')} of ${missing.join(',')}`);
  /* (both ends of what the book has told of her: its first facts from the earliest chapters, its latest from the passages just before the
   * point — in the chapter open, the latest ride, none of them skipped) */
  assert.deepEqual(toldOnes, missing.slice(missing.length - toldOnes.length), 'the latest of the chapter open, none skipped');
  assert.ok(toldOnes.includes(missing[missing.length - 1]), 'the one just before what rides whole is told');
  for (let k = 1; k <= 36; k++) if (there(k)) assert.ok(!told(k), `passage ${k} is there word for word: its fact is not sent again`);
  for (let k = 37; k <= 40; k++) assert.ok(!told(k), `passage ${k} is after the point`);
});

await test('switched on while a reading is on its way, the bibliography leaves no gap: what that reading was not asked for is filled in after it', async () => {
  const b = await makeBook([['Mina wore a red scarf her mother knitted.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibAuto', 'off'), { now: true });
  await script([{ text: JSON.stringify({ people: [{ name: 'Mina', about: 'A girl with a red scarf.' }] }), delay: 0.15, chunk: 2 },
    { bib: true, text: JSON.stringify({ bibliography: [{ source: 'Chapter One, passage 1', facts: [{ name: 'Mina', kind: 'people', fact: 'Her mother knitted her red scarf.', evidence: 'a red scarf her mother knitted' }] }] }) }]);
  const run = archivist.run(b.novelId);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(20);
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibAuto', ''), { now: true });
  await run;
  for (let i = 0; i < 3 && archivist.bibDue(b.novelId).length; i++) await archivist.run(b.novelId);
  assert.deepEqual(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) }).map((it) => [it.name, it.facts.map((f) => f.fact)]), [['Mina', ['Her mother knitted her red scarf.']]]);
  assert.equal(archivist.bibDue(b.novelId).length, 0);
  await putAway(b);
});

await test('changes waiting for Apply to one entry or one card — made, then added to, in one answer — both land, each watched only in the parts it writes; a newer answer adding to it leaves an older change of another part waiting; a paragraph is never added twice', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['Rukia stood. Kai worked the forge.']], { manual: true });
  await script([{ text: '<changes>[{"entry": "Rukia", "kind": "people", "line": "A reaper.", "text": "She fights with ice.", "why": "a"}, {"entry": "Rukia", "add": "Her eyes are violet.", "why": "b"}, {"note": "people", "name": "Kai", "about": "A smith.", "why": "c"}, {"note": "people", "name": "Kai", "now": "At the forge.", "why": "d"}]</changes>\nFour.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Write Rukia and Kai.' });
  let turn = store.peek('talk', b.novelId).turns.at(-1);
  let v = picked(turn);
  assert.deepEqual(v.changes.map((c) => c.status), ['waiting', 'waiting', 'waiting', 'waiting'], JSON.stringify(v.changes.map((c) => c.said || '')));
  const all = talk.settleAll(b.novelId, turn.id, v.id, 'apply');
  assert.equal(all.done, 4, JSON.stringify(all));
  const e = bib.entriesOf(b.novel())[0];
  assert.deepEqual([e.name, e.line, e.text], ['Rukia', 'A reaper.', 'She fights with ice.\n\nHer eyes are violet.']);
  const kai = b.novel().notes.people.find((c) => c.name === 'Kai');
  assert.deepEqual([kai.about, kai.now], ['A smith.', 'At the forge.']);
  /* an older answer's change of when it rides waits on through a newer one that only adds to it */
  await script([{ text: '<changes>[{"entry": "Rukia", "rides": "always", "why": "e"}]</changes>\nOne.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Always Rukia.' });
  const older = store.peek('talk', b.novelId).turns.at(-1);
  await script([{ text: '<changes>[{"entry": "Rukia", "add": "She hates the rain.", "why": "f"}]</changes>\nTwo.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Add the rain.' });
  turn = store.peek('talk', b.novelId).turns.at(-1);
  v = picked(turn);
  assert.equal(talk.applyChange(b.novelId, turn.id, v.id, v.changes[0].id).ok, true);
  const o = picked(store.peek('talk', b.novelId).turns.find((t) => t.id === older.id));
  assert.equal(o.changes[0].status, 'waiting', 'not set aside');
  assert.equal(talk.waitingWhy(b.novelId, o.changes[0]), '', 'nor changed since, for the part it writes');
  assert.equal(talk.applyChange(b.novelId, older.id, o.id, o.changes[0].id).ok, true);
  assert.equal(bib.entriesOf(b.novel())[0].rides, 'always');
  /* the same paragraph never twice */
  const again = changes.makeChange(b.novelId, { entry: 'Rukia', add: 'She hates the rain.' });
  assert.equal(again.status, 'refused');
  assert.match(again.said, /there already/);
  assert.equal(bib.entriesOf(b.novel())[0].text, 'She fights with ice.\n\nHer eyes are violet.\n\nShe hates the rain.');
  await setHouse();
  await putAway(b);
});

await test('an entry he keeps for himself never tells the writer his name for it, nor which names he puts together under it — the book’s facts ride under the name the book gives, found by that name', () => {
  const { novel, chapter } = shape.newNovel({ title: 'Soul Gate', brief: 'A reaper story.' });
  novel.order = [chapter.id];
  chapter.passages = [shape.newPassage('ai', 'The Masked Man wore a white mask. Kira bowed to the captain.')];
  const v = picked(chapter.passages[0]);
  v.codex = bib.codexOf([{ name: 'The Masked Man', kind: 'people', fact: 'He wears a white mask.', evidence: 'The Masked Man wore a white mask' }], { text: v.text });
  novel.bibliography = [bib.tidyEntry(bib.newEntry({ name: 'Kira', aka: ['The Masked Man'], kind: 'people', rides: 'never', text: 'HIS SECRET: KIRA IS THE MASKED MAN.' }))];
  const items = bib.bibItems(novel, { [chapter.id]: chapter });
  let ride = bib.ridingItems(items, { near: 'The Masked Man waited.', budget: 4000 });
  let words = ride.words.join('\n');
  assert.ok(words.includes('The Masked Man') && words.includes('He wears a white mask.'), words);
  assert.ok(!words.includes('Kira') && !words.includes('SECRET'), words);
  ride = bib.ridingItems(items, { near: 'Kira waited.', budget: 4000 });
  assert.equal(ride.words.join('\n'), '', 'by his own name for it, nothing');
  /* the partner plans with him: it sees his entry */
  ride = bib.ridingItems(items, { near: 'Kira waited.', budget: 4000, purpose: 'partner' });
  assert.ok(ride.words.join('\n').includes('HIS SECRET'));
});

await test('a name the book alone tells of takes room only with a fact of its own: never an entry of his left out for one that then says nothing; the other names a card goes by are counted as sent', () => {
  const entry = { ref: 'e:a', name: 'Ann', aka: [], kind: 'people', rides: 'named', line: '', text: '', entry: { name: 'Ann', line: '', text: 'HIS WORDS FOR ANN, A FEW OF THEM.' }, card: null, facts: [], kinds: {} };
  const own = util.estimateTokens(bib.itemWords(entry, { facts: [] })) + 4;
  const book = { ref: 'n:bo', name: 'Bo', aka: [], kind: 'people', rides: 'named', line: '', text: '', entry: null, card: null, facts: [{ id: 'f', fact: 'Bo is tall and has a long scar across the left cheek from the war.', passageId: 'p', label: 'Chapter One, passage 1' }], kinds: {} };
  const ride = bib.ridingItems([entry, book], { near: 'Ann sat. Bo stood.', budget: own + 2 });
  assert.deepEqual(ride.items.map((x) => x.name), ['Ann'], 'Bo, nearer, could not say anything in the room left: Ann rides');
  const card = { ref: 'c:people:k', name: 'Kai', aka: Array.from({ length: 12 }, (_, i) => `Kai the Smith of the North Gate ${i}`), kind: 'people', rides: 'named', line: '', text: '', entry: null, card: { kind: 'people', id: 'k' }, facts: book.facts.map((f) => ({ ...f, fact: 'Kai forges blades.' })), kinds: {} };
  for (const budget of [40, 120, 400]) {
    const r = bib.ridingItems([card], { near: 'Kai worked.', budget });
    assert.ok(util.estimateTokens(r.words.join('\n\n')) <= budget, `${budget}: ${util.estimateTokens(r.words.join('\n\n'))}`);
  }
});

await test('the partner’s list of every entry is the same whether or not the book has told facts that do not ride', () => {
  const b = bibBook();
  /* the chapter open far longer than the room: little is left for the chapters before */
  b.c3.passages = Array.from({ length: 60 }, (_, i) => shape.newPassage('ai', `Passage ${i} of a long chapter. ${'The rain went on against the shutters. '.repeat(80)}`));
  b.novel.bibliography.push(...Array.from({ length: 60 }, (_, i) => bib.tidyEntry(bib.newEntry({ name: `Name${i} Zeta`, kind: 'people', line: `The line of entry ${i}, which says who they are.` }))));
  const index = (novel) => {
    const t = sentOf(context.assemble({ house: quietHouse(), novel, chapters: b.chapters, conn: { ...CONN, context: 32000, maxTokens: 1000 }, purpose: 'partner', turns: [], target: { chapterId: b.c3.id }, request: 'Talk.' }));
    return t.slice(t.indexOf(prompts.BIB_INDEX)).split('\n').filter((l) => l.startsWith('- Name')).length;
  };
  const withFacts = index(b.novel);
  for (const c of Object.values(b.chapters)) for (const p of c.passages) delete picked(p).codex;
  assert.equal(withFacts, index(b.novel));
  assert.ok(withFacts > 10, String(withFacts));
});

await test('a fact said again in other words of the name is said once; one that says otherwise — a “no”, a “can’t”, who did what to whom — never', () => {
  const { novel, chapter } = shape.newNovel({ title: 'Soul Gate', brief: 'x' });
  novel.order = [chapter.id];
  const pairs = [['Rukia carries Sode no Shirayuki.', 'Rukia Kuchiki carries Sode no Shirayuki'], ['Rukia can swim.', 'Rukia can’t swim.'], ['Rukia has a sister.', 'Rukia has no sister.'], ['Rukia stabbed Ichigo.', 'Ichigo stabbed Rukia.'], ['Rukia is older than Ichigo.', 'Ichigo is older than Rukia.']];
  chapter.passages = pairs.flat().map((t) => shape.newPassage('ai', `${t} Rukia Kuchiki nodded.`));
  chapter.passages.forEach((p, k) => { const v = picked(p); v.codex = bib.codexOf([{ name: k % 2 ? 'Rukia Kuchiki' : 'Rukia', kind: 'people', fact: pairs.flat()[k], evidence: pairs.flat()[k].replace(/\.$/, '') }], { text: v.text }); });
  novel.bibliography = [bib.tidyEntry(bib.newEntry({ name: 'Rukia Kuchiki', aka: ['Rukia'], kind: 'people', line: 'x' }))];
  const facts = bib.bibItems(novel, { [chapter.id]: chapter })[0].facts.map((f) => f.fact);
  assert.deepEqual(facts, ['Rukia carries Sode no Shirayuki.', ...pairs.slice(1).flat()]);
});

await test('a name with or without its “the” is placed alike, whatever the book read before', () => {
  const { novel, chapter } = shape.newNovel({ title: 'Soul Gate', brief: 'x' });
  novel.order = [chapter.id];
  const lay = (p, name, fact, ev) => { const v = picked(p); v.codex = bib.codexOf([{ name, kind: 'groups', fact, evidence: ev }], { text: v.text }); };
  const p1 = shape.newPassage('ai', 'The Order met at dawn.');
  const p2 = shape.newPassage('ai', 'Order keeps its oaths.');
  lay(p1, 'The Order', 'It meets at dawn.', 'The Order met at dawn');
  lay(p2, 'Order', 'It keeps its oaths.', 'Order keeps its oaths');
  novel.bibliography = [bib.tidyEntry(bib.newEntry({ name: 'Order', kind: 'groups', line: 'HIS LINE' }))];
  chapter.passages = [p1, p2];
  const where = () => bib.bibItems(novel, { [chapter.id]: chapter }).map((it) => [it.ref.slice(0, 2), it.facts.map((f) => f.fact)]);
  assert.deepEqual(where(), [['e:', ['It meets at dawn.', 'It keeps its oaths.']]]);
  chapter.passages = [p2];
  assert.deepEqual(where(), [['e:', ['It keeps its oaths.']]]);
});

await test('one answer’s changes waiting for Apply: one it takes out leaves the next to it said as changed since; Undo of one gives the others back what they were watched from; one renamed and then changed under its new name both land; a newer answer’s paragraph sets aside an older one’s', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['Rukia stood. Kai worked the forge.']], { manual: true });
  const ask = async (block, said) => {
    await script([{ text: `<changes>${JSON.stringify(block)}</changes>\nDone.` }]);
    await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: said });
    const turn = store.peek('talk', b.novelId).turns.at(-1);
    return { turn, v: () => picked(store.peek('talk', b.novelId).turns.find((t) => t.id === turn.id)) };
  };
  store.change('novel', b.novelId, shape.novelSteps.putEntry(bib.tidyEntry(bib.newEntry({ name: 'Rukia', kind: 'people', text: 'A reaper.', by: 'you' }))), { now: true });
  /* taken out, then added to: the paragraph is never a new entry */
  let a = await ask([{ entry: 'Rukia', remove: true, why: 'a' }, { entry: 'Rukia', add: 'She fights with ice.', why: 'b' }], 'Out, then add.');
  assert.equal(talk.applyChange(b.novelId, a.turn.id, a.v().id, a.v().changes[0].id).ok, true);
  const second = talk.applyChange(b.novelId, a.turn.id, a.v().id, a.v().changes[1].id);
  assert.equal(second.ok, false);
  assert.match(second.said, /changed since/);
  assert.equal(bib.entriesOf(b.novel()).length, 0, 'no entry made of the paragraph alone');
  assert.equal(talk.undoOneChange(b.novelId, a.turn.id, a.v().id, a.v().changes[0].id).ok, true);
  /* made, undone, then the other: it lands on the card as it was offered */
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-k', name: 'Kai', about: 'A smith.', now: 'At the forge.', ties: '', aka: [] }), { now: true });
  a = await ask([{ note: 'people', name: 'Kai', now: 'At the well.', why: 'c' }, { note: 'people', name: 'Kai', now: 'Asleep.', why: 'd' }], 'Where is Kai?');
  assert.equal(talk.applyChange(b.novelId, a.turn.id, a.v().id, a.v().changes[0].id).ok, true);
  assert.equal(talk.undoOneChange(b.novelId, a.turn.id, a.v().id, a.v().changes[0].id).ok, true);
  assert.equal(talk.waitingWhy(b.novelId, a.v().changes[1]), '');
  assert.equal(talk.applyChange(b.novelId, a.turn.id, a.v().id, a.v().changes[1].id).ok, true);
  assert.equal(b.novel().notes.people.find((c) => c.id === 'pe-k').now, 'Asleep.');
  /* renamed, then added to under the new name */
  a = await ask([{ entry: 'Rukia', newName: 'Rukia Kuchiki', why: 'e' }, { entry: 'Rukia Kuchiki', add: 'Her eyes are violet.', why: 'f' }], 'Her full name.');
  const all = talk.settleAll(b.novelId, a.turn.id, a.v().id, 'apply');
  assert.equal(all.done, 2, JSON.stringify(all));
  const e = bib.entriesOf(b.novel())[0];
  assert.deepEqual([e.name, e.aka, e.text], ['Rukia Kuchiki', ['Rukia'], 'A reaper.\n\nHer eyes are violet.']);
  /* a newer answer's paragraph sets aside an older one's still waiting */
  const older = await ask([{ entry: 'Rukia Kuchiki', add: 'She hates the rain.', why: 'g' }], 'Rain.');
  await ask([{ entry: 'Rukia Kuchiki', add: 'She loves the rain.', why: 'h' }], 'No — rain.');
  assert.equal(older.v().changes[0].status, 'skipped');
  await setHouse();
  await putAway(b);
});

await test('a short portrait asked for is held to what the bibliography keeps even when Fill it from the book is switched off while it is on its way', async () => {
  const b = await makeBook([['Hae-won held her shoulders up as if bracing against cold. Fine lines sat at the corners of her eyes. She squared her glass with the table edge.']]);
  const long = 'An old friend of Mina from school. Holds her shoulders up as if bracing against cold. Has fine lines at the corners of her eyes. Squares her glass with the table edge when she has decided something.';
  store.change('novel', b.novelId, shape.novelSteps.putNote('people', { id: 'pe-h', name: 'Hae-won', aka: [], about: long, ties: '', now: '' }), { now: true });
  await script([{ delay: 0.15, chunk: 2, text: JSON.stringify({ people: [{ name: 'Hae-won', about: 'An old friend of Mina from school, precise and unhurried.' }], bibliography: [{ source: 'Passage 1', facts: [
    { name: 'Hae-won', kind: 'people', fact: 'Holds her shoulders up as if bracing against cold.', evidence: 'held her shoulders up as if bracing against cold' },
    { name: 'Hae-won', kind: 'people', fact: 'Fine lines at the corners of her eyes.', evidence: 'Fine lines sat at the corners of her eyes' },
    { name: 'Hae-won', kind: 'people', fact: 'Squares her glass with the table edge.', evidence: 'She squared her glass with the table edge' }] }] }) }]);
  const run = archivist.run(b.novelId);
  for (let i = 0; i < 100 && !(await requests()).length; i++) await sleep(20);
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibAuto', 'off'), { now: true });
  await run;
  assert.equal(b.novel().notes.people.find((c) => c.id === 'pe-h').about, 'An old friend of Mina from school, precise and unhurried.');
  assert.equal(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) })[0].facts.length, 3, 'and what it leaves to them is kept');
  await putAway(b);
});

/* a codex laid on a passage's version on show, as the helper's reading lays it */
function layFacts(b, ci, pi, rows) {
  store.change('chapter', b.ids[ci], (c) => { const v = picked(c.passages[pi]); v.codex = bib.codexOf(rows, { text: v.text }); }, { now: true });
}
await test('a name changed everywhere takes the book’s facts with it, their words changed too — nothing read or paid for again', async () => {
  const b = await makeBook([['Rukia’s eyes were a deep violet.', 'Rukia cut her hair short.']], { manual: true });
  markAllSeen(b);
  layFacts(b, 0, 0, [{ name: 'Rukia', kind: 'people', fact: 'Rukia’s eyes are violet.', evidence: 'Rukia’s eyes were a deep violet' }]);
  layFacts(b, 0, 1, [{ name: 'Rukia', kind: 'people', fact: 'Rukia cut her hair short.', evidence: 'Rukia cut her hair short' }]);
  assert.equal(changes.makeChange(b.novelId, { rename: { from: 'Rukia', to: 'Ilse' } }).status, 'made');
  assert.deepEqual(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) }).map((it) => [it.name, it.facts.map((f) => f.fact)]), [['Ilse', ['Ilse’s eyes are violet.', 'Ilse cut her hair short.']]]);
  assert.equal(archivist.bibDue(b.novelId).length, 0, 'never due again');
  await putAway(b);
});

await test('a passage further back read as a change keeps what its version before established that the new words still say, whatever the answer lists', async () => {
  const b = await makeBook([['Rukia’s eyes were a deep violet. She carried a white sword.', 'Tom came.']]);
  markAllSeen(b);
  layFacts(b, 0, 0, [{ name: 'Rukia', kind: 'people', fact: 'Her eyes are violet.', evidence: 'Rukia’s eyes were a deep violet' }, { name: 'Rukia', kind: 'people', fact: 'She carries a white sword.', evidence: 'She carried a white sword' }]);
  const p = b.ch().passages[0];
  writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, text: 'Rukia’s eyes were a deep violet. She carried a white sword. Snow fell.' });
  await script([{ text: JSON.stringify({ people: [], bibliography: [{ source: 'Passage 1', facts: [{ name: 'Rukia', kind: 'people', fact: 'She walks in snow.', evidence: 'Snow fell' }] }] }) }]);
  await archivist.run(b.novelId);
  const asked = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Update the notes'));
  assert.ok(asked && asked.includes('It used to read'), 'read as a change');
  const facts = bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) }).flatMap((it) => it.facts.map((f) => f.fact));
  assert.ok(facts.includes('Her eyes are violet.') && facts.includes('She carries a white sword.'), JSON.stringify(facts));
  await putAway(b);
});

await test('a page mended in place keeps its facts where every one still stands in the mended words', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([[`${story200} Gulls cried over Crane Point.\n\nI hope this captures the scene.`]], { manual: true });
  markAllSeen(b);
  layFacts(b, 0, 0, [{ name: 'Crane Point', kind: 'places', fact: 'Gulls cry over it.', evidence: 'Gulls cried over Crane Point' }]);
  store.change('novel', b.novelId, (n) => { n.memory.mended = 0; }, { now: true });
  assert.deepEqual(await mend.mendBook(b.novelId), { pages: 1, tellings: 0, versions: 0 });
  assert.ok(!picked(b.ch().passages[0]).text.includes('I hope this captures'));
  assert.deepEqual(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) }).map((it) => [it.name, it.facts.map((f) => f.fact)]), [['Crane Point', ['Gulls cry over it.']]]);
  assert.equal(archivist.bibDue(b.novelId).length, 0);
  await setHouse();
  await putAway(b);
});

await test('pages filled in after: a source the answer names its own way is still its own; a batch its model will not read is read a page at a time, each tried twice at most', async () => {
  const b = await makeBook([['Mina wore a red scarf her mother knitted.', 'Joon laughed at the sea.']], { manual: true });
  markReadBefore212(b);
  await script([{ bib: true, text: JSON.stringify({ bibliography: [{ source: 'Chapter 1, Passage 1.', facts: [{ name: 'Mina', kind: 'people', fact: 'Her mother knitted her red scarf.', evidence: 'a red scarf her mother knitted' }] }, { source: 'chapter one passage 2', facts: [] }] }) }]);
  await archivist.run(b.novelId);
  assert.deepEqual(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) }).map((it) => it.facts[0].fact), ['Her mother knitted her red scarf.']);
  assert.equal(archivist.bibDue(b.novelId).length, 0);
  /* its model will not read two at once: one at a time, and each passed by after two tries */
  const c = await makeBook([['Kai forged a blade of black iron.', 'Rin sang by the well.']], { manual: true });
  markReadBefore212(c);
  const tooLong = { bib: true, status: 400, message: "This model's maximum context length is 4000 tokens. However, your messages resulted in 9000 tokens." };
  await reset();
  await script([tooLong, { bib: true, text: JSON.stringify({ bibliography: [{ source: 'Chapter One, passage 1', facts: [{ name: 'Kai', kind: 'people', fact: 'He forged a black iron blade.', evidence: 'Kai forged a blade of black iron' }] }] }) }, tooLong, tooLong]);
  for (let i = 0; i < 6 && archivist.bibDue(c.novelId).length; i++) { archivist.forTests().failures.delete(c.novelId); await archivist.run(c.novelId); }
  const asks = (await requests()).filter((x) => x.body.messages.at(-1).content.includes('bibliography was kept'));
  assert.ok(asks.length <= 4, `asked ${asks.length} times`);
  /* (a too-long answer is fitted and sent once more by the call itself, as every ask is: the second ask is that one) */
  const sourcesIn = (x) => (x.body.messages.at(-1).content.match(/^Chapter One, passage \d+:$/gm) || []).length;
  assert.deepEqual(asks.map(sourcesIn), [2, 2, 1, 1], 'two together, then the one left a page at a time');
  assert.equal(archivist.bibDue(c.novelId).length, 0, 'and done');
  assert.deepEqual(bib.bibItems(c.novel(), { [c.ids[0]]: c.ch(0) }).map((it) => it.name), ['Kai']);
  await putAway(b);
  await putAway(c);
});

await test('a chapter’s summary whose ask stalls on its words is asked once more, then set aside — never asked for ever', async () => {
  globalThis.__cozyLeashQuietMs = 2000;
  globalThis.__cozyLeashAllMs = 700;
  try {
    const b = await makeBook([['Mara kept the light.', 'Tom came.']], { manual: true });
    markAllSeen(b);
    store.change('chapter', b.ids[0], (c) => { for (const x of c.passages) for (const v of x.versions) v.at = Date.now() - 3600000; }, { now: true });
    for (let k = 0; k < 2; k++) {
      archivist.forTests().failures.delete(b.novelId);
      await reset();
      await script([{ hang_after: '{"summary": "Mara' }]);
      await archivist.run(b.novelId);
    }
    assert.ok(Object.keys(b.novel().memory.aside || {}).some((k) => k.startsWith('summary:')), JSON.stringify(b.novel().memory.aside || {}));
    await putAway(b);
  } finally {
    delete globalThis.__cozyLeashQuietMs;
    delete globalThis.__cozyLeashAllMs;
  }
});

await test('a lorebook taken out and brought back in keeps each entry’s kind and line; with the bibliography kept, a first description goes to it, and Continue’s outcome speaks of what the writer chose', () => {
  const es = [bib.tidyEntry(bib.newEntry({ name: 'Rukia', kind: 'people', line: 'A reaper.', text: 'She fights with ice.' })), bib.tidyEntry(bib.newEntry({ name: 'Gotei 13', kind: 'groups', text: 'Thirteen squads.' }))];
  assert.deepEqual(bib.entriesFromLorebook(JSON.stringify(bib.lorebookOf(es))).map((e) => [e.name, e.kind, e.line, e.text]), [['Rukia', 'people', 'A reaper.', 'She fights with ice.'], ['Gotei 13', 'groups', '', 'Thirteen squads.']]);
  const b = bibBook();
  const on = prompts.notesRequest({ novel: b.novel, chapterLabel: 'Chapter One', before: '', changes: [{ pid: 'p', text: 'x', source: 'Passage 1' }], removed: [], removedChapters: [], at: 0, of: 1, codex: true });
  assert.ok(on.includes('what they wear or carry — in "bibliography"') && on.includes('on its card, or in "bibliography"'), on.slice(0, 1600));
  const off = prompts.notesRequest({ novel: b.novel, chapterLabel: 'Chapter One', before: '', changes: [{ pid: 'p', text: 'x', source: 'Passage 1' }], removed: [], removedChapters: [], at: 0, of: 1, codex: false });
  assert.ok(off.includes('what they wear or carry. It can') && !off.includes('"bibliography"'));
  const chosen = prompts.writeRequest({ chapterLabel: 'Chapter Two', direction: '', length: 'auto' });
  assert.ok(chosen.includes('Carry what you choose through') && !chosen.includes('Carry what I asked for'), chosen);
  assert.ok(prompts.writeRequest({ chapterLabel: 'Chapter Two', direction: 'They fight.', length: 'auto' }).includes('Carry what I asked for'));
});

await test('a book written before the bibliography heals by itself when it opens: its pages’ facts are filled in first, then its notes are checked once — a card grown into a record of scenes becomes a portrait, every lasting detail kept in the bibliography; never asked again', async () => {
  const b = await makeBook([['Hae-won held her shoulders up as if bracing against cold.', 'Fine lines sat at the corners of Hae-won’s eyes.', 'Hae-won squared her glass with the table edge. She did the water-bottle trick and said nothing.']], { manual: true });
  const record = 'An old friend of Mina from school. Holds her shoulders up as if bracing against cold. Has fine lines at the corners of her eyes. Squares her glass with the table edge. Did the water-bottle trick at the bar and said nothing.';
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'pe-h', name: 'Hae-won', aka: [], about: record, ties: '', now: '' }], places: [], lore: [], threads: [] }), { now: true });
  markReadBefore212(b);
  /* checked by the check of 2.4–2.11 already */
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: 0, v: 2, checked: true } }), { now: true });
  assert.equal(archivist.firstCheck(b.novelId), true, 'a check is owed');
  assert.equal(archivist.firstCheck(b.novelId), false, 'once');
  const portrait = 'Mina’s old friend from school — guarded, exact, and quiet about what she feels.';
  await script([
    { bib: true, text: JSON.stringify({ bibliography: [
      { source: 'Chapter One, passage 1', facts: [{ name: 'Hae-won', kind: 'people', fact: 'Holds her shoulders up as if bracing against cold.', evidence: 'held her shoulders up as if bracing against cold' }] },
      { source: 'Chapter One, passage 2', facts: [{ name: 'Hae-won', kind: 'people', fact: 'Fine lines at the corners of her eyes.', evidence: 'Fine lines sat at the corners of Hae-won’s eyes' }] },
      { source: 'Chapter One, passage 3', facts: [{ name: 'Hae-won', kind: 'people', fact: 'Squares her glass with the table edge.', evidence: 'Hae-won squared her glass with the table edge' }] }] }) },
    { text: JSON.stringify({ people: [{ name: 'Hae-won', about: portrait, why: 'a record of one evening, its details in the bibliography' }], clear: true, verdict: 'The notes hold true to the book.' }) }]);
  for (let i = 0; i < 3; i++) await archivist.run(b.novelId);
  const asks = (await requests()).map((r) => r.body.messages.at(-1).content);
  const fill = asks.findIndex((a) => a.includes('bibliography was kept'));
  const check = asks.findIndex((a) => a.includes(prompts.AUDIT_ASK));
  assert.ok(fill >= 0 && check > fill, `filled first, then checked: ${fill}, ${check}`);
  assert.equal(asks.filter((a) => a.includes(prompts.AUDIT_ASK)).length, 1, 'checked once');
  assert.equal(b.novel().notes.people[0].about, portrait, 'the card is a portrait now');
  assert.deepEqual(bib.bibItems(b.novel(), { [b.ids[0]]: b.ch(0) })[0].facts.map((f) => f.fact), ['Holds her shoulders up as if bracing against cold.', 'Fine lines at the corners of her eyes.', 'Squares her glass with the table edge.']);
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'never asked again');
  await putAway(b);
});

await test('with Fill it from the book off, a book checked by the check of before is not checked again for a portrait it has nothing to leave its details to; notes from before any check still are', async () => {
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'pe-m', name: 'Mara', aka: [], about: 'A keeper.', ties: '', now: '' }], places: [], lore: [], threads: [] }), { now: true });
  markReadBefore212(b);
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibAuto', 'off'), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: 0, v: 2, checked: true } }), { now: true });
  assert.equal(archivist.firstCheck(b.novelId), true);
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'nothing asked');
  assert.equal(b.novel().memory.audit.owed, undefined, 'and nothing owed');
  /* notes from before any check: checked, bibliography or not */
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: null }), { now: true });
  assert.equal(archivist.firstCheck(b.novelId), true);
  await script([{ text: JSON.stringify({ clear: true, verdict: 'The notes hold true to the book.' }) }]);
  await archivist.run(b.novelId);
  assert.equal((await requests()).filter((r) => r.body.messages.at(-1).content.includes(prompts.AUDIT_ASK)).length, 1);
  await putAway(b);
});

await test('a check that runs while the old pages’ facts are still being filled in leaves the owed one owed: it is made again once they are in', async () => {
  const long = (k) => `Mara walked the long shore of passage ${k}. ${'The tide came in and went out again over the grey stones. '.repeat(230)}`;
  const b = await makeBook([[1, 2, 3, 4, 5].map(long)], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people: [{ id: 'pe-m', name: 'Mara', aka: [], about: 'A keeper.', ties: '', now: '' }], places: [], lore: [], threads: [] }), { now: true });
  markReadBefore212(b);
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: 0, v: 2, checked: true } }), { now: true });
  archivist.firstCheck(b.novelId);
  /* a check due meanwhile (six readings, or his asking) */
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ auditAsked: true }), { now: true });
  await script([{ text: JSON.stringify({ clear: true, verdict: 'Held true.' }) }, { text: JSON.stringify({ clear: true, verdict: 'Held true again.' }) }]);
  await archivist.run(b.novelId);
  assert.ok(archivist.bibDue(b.novelId).length > 0, 'still filling');
  assert.equal(b.novel().memory.audit.owed, 'portrait', 'the owed check stays owed');
  for (let i = 0; i < 4 && b.novel().memory.audit.owed; i++) await archivist.run(b.novelId);
  const checks = (await requests()).filter((r) => r.body.messages.at(-1).content.includes(prompts.AUDIT_ASK));
  assert.equal(checks.length, 2, 'the one due, then the one owed');
  assert.equal(b.novel().memory.audit.owed, undefined);
  assert.equal(archivist.bibDue(b.novelId).length, 0);
  await putAway(b);
});

await test('a name in italics written with underscores is still the name: marked in the page, changed everywhere with it, and found by the same words across chapters', async () => {
  const f = bib.makeFinder(bib.nameForms([bib.tidyEntry(bib.newEntry({ name: 'Rukia', kind: 'people', line: 'x' }))], {}));
  const t = '_Rukia_ ran. Rukia_Kuchiki is no name.';
  assert.deepEqual(f.find(t).map((x) => t.slice(x.start, x.end)), ['Rukia', 'Rukia', 'Kuchiki'].slice(0, f.find(t).length));
  assert.equal(t.slice(f.find(t)[0].start, f.find(t)[0].end), 'Rukia');
  const b = await makeBook([['_Mara_ waited by _Ann_. Mara left.']], { manual: true });
  assert.equal(changes.makeChange(b.novelId, { rename: { from: 'Mara', to: 'Ilse' } }).status, 'made');
  assert.equal(changes.makeChange(b.novelId, { replace_all: true, find: 'Ann', replace: 'Beth', chapters: 'all' }).status, 'made');
  assert.equal(picked(b.ch().passages[0]).text, '_Ilse_ waited by _Beth_. Ilse left.');
  await putAway(b);
});

/* =================================================== words changed on the page itself (2.12.2) */
heading('words changed on the page itself (2.12.2)');

await test('a change on the page itself is read by the helper — further back as a change, the newest passage afresh — and Put back the words before brings the notes back as they stood: no reading, the reading of the words before kept beside the newer one', async () => {
  const b = await makeBook([['Mara Venn kept the light at Crane Point.', 'The sea rose in the night.']], { manual: true });
  const [p1, p2] = b.ch().passages.map((p) => p.id);
  await script([{ text: JSON.stringify({ people: [{ name: 'Mara Venn', about: 'The keeper.', now: 'In the lamp room.' }] }) }, { text: JSON.stringify({ lore: [{ name: 'The night sea', about: 'It rises.' }] }) }]);
  await archivist.run(b.novelId);
  const names = () => [...b.novel().notes.people, ...b.novel().notes.lore].map((c) => c.name).sort();
  const vid = picked(b.ch().passages[0]).id;
  /* further back: read as a change */
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1, text: 'Mara Venn kept the light at Crane Point, and Tom Reed rowed out to her.' }), true);
  await reset();
  await script([{ text: JSON.stringify({ people: [{ name: 'Tom Reed', about: 'Rows out to the light.' }] }) }]);
  await archivist.run(b.novelId);
  const asked = (await requests()).map((x) => x.body.messages.at(-1).content).find((c) => c.includes('Update the notes'));
  assert.ok(asked && asked.includes('It used to read'), 'read as a change');
  assert.deepEqual(names(), ['Mara Venn', 'The night sea', 'Tom Reed']);
  const r = b.novel().memory.readings[p1][vid];
  assert.deepEqual([r.mode, r.prior.length, r.prior[0].mode], ['change', 1, 'new'], 'the reading of the words before kept beside it');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1 }).ok, true);
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'no reading for it');
  assert.deepEqual(names(), ['Mara Venn', 'The night sea'], 'what the change brought is gone with it');
  /* the newest passage: its words before taken back, the new read afresh — and put back, laid on again */
  assert.equal(writer.saveEdit({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2, text: 'The sea rose in the night, and the bell rang.' }), true);
  await reset();
  await script([{ text: JSON.stringify({ lore: [{ name: 'The bell', about: 'It rang in the night.' }] }) }]);
  await archivist.run(b.novelId);
  assert.deepEqual(names(), ['Mara Venn', 'The bell'], 'the newest read afresh: what the words before made taken back');
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: p2 }).ok, true);
  await reset();
  await archivist.run(b.novelId);
  assert.equal((await requests()).length, 0, 'no reading for it');
  assert.deepEqual(names(), ['Mara Venn', 'The night sea'], 'its own notes back as they were');
  assert.equal(archivist.pendingWork(b.novelId), false);
  await putAway(b);
});

await test('versions made only to hold fixes before 2.12.2 go on the version they were made from once, when the book opens — what the helper read, the checker found and its grade move with them; one he went back from, a sibling made from words since changed, and a passage his partner wrote anew stay versions', async () => {
  await setHouse({}, { checksFrom: 0 });
  const b = await makeBook([[{ text: 'Mara climbed the the stair and and waited.', model: 'model-a' }, 'Tom came up the the path.', 'Rain hammered the glass all night.', 'The sea was grey and and cold.']], { manual: true });
  const [p1, p2, p3, p4] = b.ch().passages.map((p) => p.id);
  const ch = () => b.ch();
  const ver = (pid) => ch().passages.find((p) => p.id === pid);
  const add = (pid, fields) => { const v = shape.newVersion({ words: 1, ...fields }); store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(pid, v), { now: true }); return v; };
  const grade = { overall: 8, of: 10, faults: [{ check: 'pacing', words: 'waited', why: 'slow' }, { check: 'fresh', words: 'stair', why: 'plain' }] };
  const v1 = picked(ver(p1));
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p1, v1.id, { round: 'r1', sig: util.hashText(v1.text), at: 1, items: [], grade }), { now: true });
  /* 1: a chain of two, the last on show — its checking with no grade, as before 2.6.3 */
  const s1 = add(p1, { text: 'Mara climbed the stair and and waited.', how: 'suggested', round: 'r1', from: v1.id, ...shape.rootOf(v1) });
  const s2 = add(p1, { text: 'Mara climbed the stair and waited.', how: 'suggested', round: 'r1', from: s1.id, ...shape.rootOf(v1) });
  store.change('chapter', b.ids[0], shape.chapterSteps.setCheck(p1, s2.id, { round: 'r1', sig: util.hashText(s2.text), at: 2, items: [] }), { now: true });
  /* 2: he went back to the words without the fix */
  const v2 = picked(ver(p2));
  add(p2, { text: 'Tom came up the path.', how: 'suggested', round: 'r2', from: v2.id, ...shape.rootOf(v2) });
  store.change('chapter', b.ids[0], shape.chapterSteps.choose(p2, v2.id), { now: true });
  /* 3: his partner's few words, then a passage it wrote anew on show */
  const v3 = picked(ver(p3));
  add(p3, { text: 'Rain lashed the glass all night.', how: 'partner', from: v3.id, why: 'harder', ...shape.rootOf(v3) });
  const anew = add(p3, { text: 'The storm broke over the tower.', how: 'partner', from: v3.id });
  /* 4: two made from the same words */
  const v4 = picked(ver(p4));
  add(p4, { text: 'The sea was grey and cold.', how: 'suggested', round: 'r4', from: v4.id, ...shape.rootOf(v4) });
  const sib = add(p4, { text: 'The sea was gray and and cold.', how: 'suggested', round: 'r5', from: v4.id, ...shape.rootOf(v4) });
  markAllSeen(b);
  assert.equal(archivist.pendingWork(b.novelId), false);
  assert.deepEqual(checker.gradesOf(b.novelId).models.filter((m) => !m.mixed && m.n), [], 'the table empty, as he saw it (the fix on show was no one writer’s)');
  store.change('novel', b.novelId, (n) => { n.memory.mended = 2; }, { now: true });
  const out = await mend.mendBook(b.novelId);
  assert.equal(out.versions, 4, JSON.stringify(ch().passages.map((p) => p.versions.map((v) => [v.how, v.text]))));
  assert.deepEqual(ver(p1).versions.map((v) => [v.id, v.text, v.hands]), [[v1.id, 'Mara climbed the stair and waited.', ['checker']]]);
  assert.deepEqual(picked(ver(p1)).before.map((x) => x.text), ['Mara climbed the the stair and and waited.', 'Mara climbed the stair and and waited.'], 'each to put back');
  assert.equal(picked(ver(p1)).written, 'Mara climbed the the stair and and waited.');
  assert.deepEqual(ver(p2).versions.map((v) => v.how), ['write', 'suggested'], 'he went back from it: both stay');
  assert.equal(picked(ver(p2)).id, v2.id);
  assert.deepEqual(ver(p3).versions.map((v) => [v.text, v.how]), [['Rain lashed the glass all night.', 'write'], ['The storm broke over the tower.', 'partner']], 'his partner’s few words on the page they changed; the passage it wrote anew a version of its own, on show');
  assert.equal(picked(ver(p3)).id, anew.id);
  assert.deepEqual(ver(p4).versions.map((v) => v.text), ['The sea was grey and cold.', 'The sea was gray and and cold.'], 'the sibling was made from words that are not these any more: its own version');
  assert.equal(ver(p4).versions[1].id, sib.id);
  /* what moved with them */
  assert.equal(archivist.pendingWork(b.novelId), false, 'nothing for the helper to read again');
  assert.equal(b.novel().memory.seen[b.ids[0]][p1], archivist.signature(picked(ver(p1))));
  const e = checker.entryFor(ch(), ver(p1));
  assert.ok(e && e.grade && e.grade.overall === 8, 'the grade of the words it was made from, with it');
  const rows = checker.gradesOf(b.novelId).models.filter((m) => m.n);
  assert.deepEqual(rows.map((m) => [m.model, m.n, m.average]), [['model-a', 1, 8]], 'the writer’s row: its words, its grade');
  assert.deepEqual(await mend.mendBook(b.novelId), { pages: 0, tellings: 0, versions: 0 }, 'once');
  await setHouse();
  await putAway(b);
});

await test('a take he puts on show with the arrows gets its fixes by themselves like any other — on the page itself', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 } });
  const b = await makeBook([['Mara climbed the the stair.']]);
  const p = () => b.ch().passages[0];
  const first = picked(p());
  store.change('chapter', b.ids[0], shape.chapterSteps.addVersion(p().id, shape.newVersion({ text: 'Mara ran up the stair.', how: 'another', model: 'scripted' })), { now: true });
  store.change('chapter', b.ids[0], shape.chapterSteps.choose(p().id, first.id), { now: true });
  await script([{ text: JSON.stringify({ edits: [{ passage: '1.1', kind: 'grammar', find: 'the the', replace: 'the', why: 'doubled' }] }) }]);
  await checker.runCheck(b.novelId);
  assert.deepEqual([p().versions.length, picked(p()).id, picked(p()).text], [2, first.id, 'Mara climbed the stair.']);
  await setHouse();
  await putAway(b);
});

await test('an empty changes block from the partner — [] or {} — is no change, never one that “could not be read”', async () => {
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'Nothing to change there.\n\n<changes>[]</changes>' }, { text: 'Still nothing.\n<changes>{}</changes>' }, { text: 'One I cannot read.\n<changes>[no]</changes>' }]);
  for (let i = 0; i < 3; i++) await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: `Look ${i}.` });
  const answers = store.peek('talk', b.novelId).turns.filter((t) => t.by === 'ai').map((t) => (picked(t).changes || []).map((c) => c.status));
  assert.deepEqual(answers, [[], [], ['refused']], 'only what truly cannot be read is said');
  assert.deepEqual(changes.opsOf('<changes>[]</changes><changes>{}</changes>'), []);
  await putAway(b);
});

await test('the partner is sent the chapter open cut only at its passages’ edges — each passage left out named where it stood, with how to read it, and said under its answer; a passage with no words yet is named too (his report: “[1.2], which you did not send this time”)', async () => {
  const words = (tag, n) => `${tag} ` + Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + ` END-${tag}.`;
  const b = await makeBook([[words('ONE', 80), words('TWO', 2500), words('THREE', 2500), words('FOUR', 300), '']]);
  await setHouse({ context: 16000 }, CRAFTS_OFF);
  await script([{ text: 'I see the chapter.' }]);
  const out = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'How is it?' });
  assert.equal(out.ok, true, out.error);
  const r = (await requests())[0];
  const sent = r.body.messages.map((m) => String(m.content)).join('\n');
  const texts = b.ch().passages.map((p) => picked(p).text);
  /* every passage: its words whole, or named where it stood — never cut inside, never missing without a word */
  const left = [];
  texts.forEach((t, k) => {
    const label = `[1.${k + 1}]`;
    if (!t) { assert.ok(sent.includes(`${label} (no words yet)`), `${label} named though empty`); return; }
    if (sent.includes(`${label} ${t}`)) return;
    left.push(label);
    assert.ok(!sent.includes(`END-${['ONE', 'TWO', 'THREE', 'FOUR'][k]}.`), `${label} is never cut inside: its end is not there without its start`);
  });
  assert.ok(left.length > 0, 'the room is too small for all of it');
  assert.match(sent, /\[1\.\d\](–\[1\.\d\])? — (one|two|three) ?(passages )?left out here to save room \([\d,]+ words\): <read>\[1\]<\/read> sends this chapter whole/, sent.slice(sent.indexOf('[1.1]'), sent.indexOf('[1.1]') + 900));
  assert.ok(sent.includes(`[1.1] ${texts[0]}`), 'its short first passage stays');
  assert.ok(sent.includes(`[1.4] ${texts[3]}`), 'the newest stays');
  assert.ok(!sent.includes('The start of this chapter is left out'), 'never the old wording');
  const notes = picked(store.peek('talk', b.novelId).turns.at(-1)).notes || [];
  assert.ok(notes.some((n) => n.includes('left out of what it was sent') && left.every((l) => n.includes(l.slice(1, -1)))), JSON.stringify(notes));
  /* and it is told the book comes fresh with every message, as it reads now */
  assert.ok(sent.includes('The book comes to you fresh with every message of mine, just as it reads right now'), 'the frame says so');
  await setHouse();
  await putAway(b);
});

await test('the book open comes before old talk: when the chapter would be cut, the earliest talk gives way first — said — and the passages go whole', async () => {
  const words = (tag, n) => `${tag} ` + Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + ` END-${tag}.`;
  const b = await makeBook([[words('ONE', 2300), words('TWO', 2300), words('THREE', 2300)]]);
  await setHouse({ context: 24000 }, CRAFTS_OFF);
  /* a long talk before: three long answers */
  const old = Array.from({ length: 3 }, (_, i) => ({ text: `Answer ${i}. ` + 'The harbour light and the long night and the rope. '.repeat(260) }));
  await script([...old, { text: 'Now I see all of it.' }]);
  for (let i = 0; i < 3; i++) await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: `Question ${i}.` });
  await reset();
  await script([{ text: 'Now I see all of it.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And the chapter?' });
  const r = (await requests())[0];
  const sent = r.body.messages.map((m) => String(m.content)).join('\n');
  for (const tag of ['ONE', 'TWO', 'THREE']) assert.ok(sent.includes(`END-${tag}.`) && sent.includes(`] ${tag} w0`), `${tag} whole`);
  assert.ok(sent.includes('(The earliest part of our talk is left out here, to save room.'), 'the talk gave way, said');
  assert.ok(!(picked(store.peek('talk', b.novelId).turns.at(-1)).notes || []).some((n) => n.includes('left out of what it was sent')), 'no passage left out');
  await setHouse();
  await putAway(b);
});

await test('what came of the partner’s changes is told with his next message and kept as told — applied after, put back after, each is told once as news; the talk before is never rewritten', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['The lamp was cold.']]);
  const pid = b.ch().passages[0].id;
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "had gone out", "why": "darker"}]</changes>\nDarker.' }, { text: 'Fine.' }, { text: 'Good.' }, { text: 'Noted.' }, { text: 'Yes.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Darker.' });
  const first = store.peek('talk', b.novelId).turns.at(-1);
  assert.equal(picked(first).changes[0].status, 'waiting');
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thoughts?' });
  const lastOf = async (k) => String((await requests())[k].body.messages.at(-1).content);
  const WAITING = '(Of your changes: Chapter One, passage 1 (“was cold” → “had gone out”) — waiting for me to apply it.)';
  assert.ok((await lastOf(1)).startsWith(WAITING), await lastOf(1));
  /* applied after his message: told as news with the next — the message before still says what it said */
  assert.equal(talk.applyChange(b.novelId, first.id, picked(first).id, picked(first).changes[0].id).ok, true);
  assert.equal(picked(b.ch().passages[0]).text, 'The lamp had gone out.');
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And now?' });
  let msgs = (await requests())[2].body.messages.map((m) => String(m.content));
  assert.ok(msgs.some((m) => m.startsWith(WAITING) && m.endsWith('Thoughts?')), 'the talk before is never rewritten');
  assert.ok(msgs.at(-1).includes('(Since then, of your earlier changes: Chapter One, passage 1 (“was cold” → “had gone out”) — I applied it: the book has it now.)'), msgs.at(-1));
  assert.ok(msgs.join('\n').includes('[1.1] The lamp had gone out.'), 'and the book it is sent reads that way');
  /* put back since: told it is no longer on the page */
  assert.equal(inplace.putBackWords({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid }).ok, true);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Again?' });
  assert.ok((await lastOf(3)).includes('— made, but the page no longer reads that way — the words before it were put back'), await lastOf(3));
  /* once */
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Last.' });
  assert.ok(!(await lastOf(4)).includes('Since then'), await lastOf(4));
  await setHouse();
  await putAway(b);
});

await test('a swap set to wait and a change he applies in his own words, applied after his next message, are told as news too — each of the swap, his words as his', async () => {
  await setHouse({}, { partnerApplies: 'wait' });
  const b = await makeBook([['Kara laughed.', 'Mara wept.', 'The lamp was cold.']], { manual: true });
  await script([{ text: '<changes>[{"rename": {"from": "Kara", "to": "Mara"}, "why": "swap"}, {"rename": {"from": "Mara", "to": "Kara"}, "why": "swap"}, {"passage": "1.3", "find": "was cold", "replace": "had gone out", "why": "darker"}]</changes>\nThree.' }, { text: 'Fine.' }, { text: 'Good.' }, { text: 'Yes.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Swap them, and darker.' });
  const first = store.peek('talk', b.novelId).turns.at(-1);
  const v = picked(first);
  assert.deepEqual(v.changes.map((c) => c.status), ['waiting', 'waiting', 'waiting']);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Thoughts?' });
  assert.equal(talk.applyChange(b.novelId, first.id, v.id, v.changes[0].id).ok, true);
  assert.equal(talk.applyEdited(b.novelId, first.id, v.id, v.changes[2].id, { replace: 'burned blue' }).ok, true);
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['Mara laughed.', 'Kara wept.', 'The lamp burned blue.']);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And now?' });
  const last = String((await requests())[2].body.messages.at(-1).content);
  assert.ok(last.startsWith('(Since then, of your earlier changes: '), last);
  const news = last.slice(0, last.indexOf('.)') + 2);
  assert.equal((news.match(/— I applied it: the book has it now/g) || []).length, 2, `each of the swap: ${news}`);
  assert.ok(news.includes('(“was cold” → “burned blue”) — I applied it in my own words instead of yours: the book has them now'), news);
  /* told once */
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Last.' });
  assert.ok(!String((await requests())[3].body.messages.at(-1).content).includes('Since then'));
  /* his own edit over those words since: told as changed since, never as put back */
  const p3 = b.ch().passages[2];
  assert.ok(inplace.changeInPlace({ novelId: b.novelId, chapterId: b.ids[0], passageId: p3.id, next: 'The lamp burned low.', by: 'you' }));
  await script([{ text: 'Seen.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Mine now.' });
  const mineNow = String((await requests())[4].body.messages.at(-1).content);
  assert.ok(mineNow.includes('(“was cold” → “burned blue”) — made, but the page no longer reads that way — those words were changed since'), mineNow);
  assert.ok(!mineNow.includes('were put back'), mineNow);
  /* and where his own-words change is the answer before's, it is told the same way */
  const edited = picked(store.peek('talk', b.novelId).turns.find((t) => t.id === first.id)).changes[2];
  assert.equal(edited.edited, true);
  assert.equal(changes.outcomeWords([edited], b.novelId), `(Of your changes: ${edited.label} — made, in my own words instead of yours, but the page no longer reads that way — those words were changed since.)`);
  await setHouse();
  await putAway(b);
});

await test('asked again, the partner is told what its earlier answer changed and the book has now', async () => {
  await setHouse();
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: '<changes>[{"passage": "1.1", "find": "was cold", "replace": "had gone out", "why": "darker"}]</changes>\nDone.' }, { text: 'Another answer.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Darker.' });
  const t = store.peek('talk', b.novelId).turns.at(-1);
  assert.equal((await talk.partnerAgain({ novelId: b.novelId, chapterId: b.ids[0], turnId: t.id })).ok, true);
  const last = String((await requests())[1].body.messages.at(-1).content);
  assert.ok(last.startsWith('(From your earlier answer to this, these changes were made and are in the book as it reads now: Chapter One, passage 1 (“was cold” → “had gone out”).)'), last);
  await putAway(b);
});

/* last of all: it lets go of every record this page holds, as a page does when a copy comes back */
await test('a copy brought back while the page was away: what it kept waiting is let go, never saved over the copy', async () => {
  const b = await makeBook([['Mara kept the light.']]);
  await store.flush();
  const gen = (await (await realFetch(BASE + '/api/version')).json()).generation;
  const snapshot = await (await realFetch(BASE + '/api/backup')).json();
  const { news } = store.forTests();
  /* the line greets the page with the library as it is */
  news(JSON.stringify({ hello: { commit: 'same', generation: gen } }));
  store.change('chapter', b.ids[0], (c) => { c.passages[0].versions[0].text = 'WRITTEN BEFORE THE COPY CAME BACK'; }, { delay: 60000 });
  assert.equal(store.hasPending(), true);
  const restored = await realFetch(BASE + '/api/restore', { method: 'POST', body: JSON.stringify(snapshot) });
  assert.equal(restored.status, 200);
  /* back after a gap: a whole copy came back meanwhile */
  news(JSON.stringify({ hello: { commit: 'same', generation: gen + 1 } }));
  assert.equal(store.hasPending(), false, 'what it kept waiting is let go');
  await store.flush();
  await sleep(200);
  assert.equal((await onPhone('chapter', b.ids[0])).passages[0].versions[0].text, 'Mara kept the light.');
  assert.equal(await store.open('chapter', b.ids[0]).then((c) => c.passages[0].versions[0].text), 'Mara kept the light.', 'the page reads the phone again');
});

/* ============================================ the notes' check, audited (2.12.18) */
const agcSent = async () => (await requests()).map((x) => x.body.messages.map((m) => String(m.content || '')).join('\n')).filter((c) => c.includes(prompts.AUDIT_ASK));
const agcQuiet = () => { for (const w of [archivist.forTests(), checker.forTests()]) { for (const t of w.timers.values()) clearTimeout(t && t.due !== undefined ? t.t : t); w.timers.clear(); } };
const agcChapters = (b) => Object.fromEntries(b.novel().order.map((id) => [id, store.peek('chapter', id)]));
const agcAudit = async (b, answer) => { agcQuiet(); await reset(); archivist.askAudit(b.novelId); agcQuiet(); await script([{ text: JSON.stringify({ clear: true, verdict: 'Checked.', ...answer }) }]); await archivist.run(b.novelId); agcQuiet(); return (await agcSent())[0] || ''; };
const PARTNER_PAGE = { text: 'Reginald and Harrison arranged the marriage; Jovan learned of it as a decision already made.', how: 'partner' };
const QUOTE = 'Jovan learned of it as a decision already made';

await test('the check shows his long Where it’s headed whole, and what comes back keeps all of it (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([[PARTNER_PAGE]], { manual: true });
  markAllSeen(b);
  const head = 'Jovan chose Emilia from a shortlist, to spite his father.';
  const beats = Array.from({ length: 40 }, (_, i) => `Beat ${i + 1}: the house readies the wedding in its own slow way.`).join(' ');
  const tail = 'TAILPLAN: in the last chapter Mara sails for Orrin and never comes back.';
  const plans = `${head} ${beats} ${tail}`;
  store.change('novel', b.novelId, (n) => { n.plans = plans; n.notes.people.push({ id: 'pe-j', name: 'Jovan', aka: [], about: 'The heir.', now: '' }); }, { now: true });
  /* the best a model can do: give back whole what it was shown, the overturned sentence put right */
  const given = plans.replace(head, 'The fathers arranged the marriage; Jovan was told, never asked.');
  const sent = await agcAudit(b, { mine: [{ kind: 'book', name: 'plans', holds: false, contradicts: QUOTE, text: given, why: 'he never chose' }] });
  assert.ok(sent.includes('TAILPLAN'), 'shown whole');
  assert.ok(b.novel().plans.startsWith('The fathers arranged the marriage') && b.novel().plans.includes('TAILPLAN'), 'put right, and none of his words lost');
  /* a reply that gives back only part of a long telling is never laid in: his words are not cut short */
  const whole = b.novel().plans;
  store.change('novel', b.novelId, (d) => { d.memory.mine = {}; }, { now: true });
  await agcAudit(b, { mine: [{ kind: 'book', name: 'plans', holds: false, contradicts: QUOTE, text: whole.slice(0, 900), why: 'x' }] });
  assert.equal(b.novel().plans, whole, 'cut short: refused');
  await putAway(b);
});

await test('his What it’s about is never put right with a name or a figure the book never gives (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([[PARTNER_PAGE]], { brief: 'Jovan chose Emilia from a shortlist, to spite his father.', manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-j', name: 'Jovan', aka: [], about: 'The heir.', now: '' }); }, { now: true });
  await agcAudit(b, {
    people: [{ name: 'Jovan', about: 'The heir, sold to Count Vorlak for 900 crowns.', why: 'x' }],
    mine: [{ kind: 'book', name: 'about', holds: false, contradicts: QUOTE, text: 'Count Vorlak paid 900 crowns for the marriage; Jovan was told, never asked.', why: 'he never chose' }],
  });
  const a = b.novel().memory.audit;
  assert.equal(/Vorlak|900/.test(b.novel().brief), false, 'a name or a figure the book never gives is never laid into his words');
  await putAway(b);
});

await test('a thread the newest passage opened is never closed by the check’s judgment, as by a thread row (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([['Mara kept the light.']], { manual: true });
  markAllSeen(b);
  store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('ai', 'A letter came from Orrin, sealed in black. Mara set it on the sill and did not open it.', { how: 'write', ask: { direction: '', length: 'scene' } })); }, { now: true });
  agcQuiet();
  await script([{ text: JSON.stringify({ threads: [{ name: 'The black letter', about: 'A letter from Orrin, sealed in black, that Mara has not opened.', open: true }] }) }]);
  await archivist.run(b.novelId);
  agcQuiet();
  const th = () => b.novel().notes.threads.find((c) => c.name === 'The black letter');
  assert.ok(th() && th().open === true, JSON.stringify(b.novel().notes.threads));
  await agcAudit(b, { threads: [{ name: 'The black letter', open: false, why: 'resolved' }] });
  await agcAudit(b, { mine: [{ kind: 'threads', name: 'The black letter', holds: false, evidence: 'A letter came from Orrin, sealed in black', about: 'A letter from Orrin, sealed in black, that Mara has not opened.', open: false, why: 'resolved' }] });
  assert.equal(th().open, true, 'opened by the newest passage: only what comes after it can close it');
  await putAway(b);
});

await test('a thread is never cut of words the book gives (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([['Tom owed Mara a debt. At the harbour he swore to repay it by winter.']], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.threads.push({ id: 't-d', name: 'The debt', about: 'Tom owes Mara a debt. He swore at the harbour to repay it by winter.', open: true }); }, { now: true });
  const th = () => b.novel().notes.threads.find((c) => c.id === 't-d');
  await agcAudit(b, { mine: [{ kind: 'threads', name: 'The debt', never: true, why: 'x' }] });
  await agcAudit(b, { mine: [{ kind: 'threads', name: 'The debt', holds: false, evidence: 'Tom owed Mara a debt', about: 'Tom owes Mara a debt.', why: 'the harbour oath is not in the book' }] });
  assert.ok(th() && th().about.includes('repay it by winter'), 'what the book gives is never cut from a thread');
  await putAway(b);
});

await test('notes checked a group at a time: his own words are judged with each round’s first group, wherever the round starts (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([[{ text: 'Mara met Tom, Ann, Bea and Cal at the gate.', how: 'partner' }]], { manual: true, brief: 'Mara at the gate.' });
  markAllSeen(b);
  const people = ['Mara', 'Zed', 'Tom', 'Ann', 'Bea', 'Cal'].map((nm, i) => ({ id: `pe-${i}`, name: nm, aka: [], about: `${nm} is someone at the gate.`, now: '' }));
  store.change('novel', b.novelId, shape.novelSteps.setNotes({ people, places: [], lore: [], threads: [] }), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setMemory({ audit: { at: 1, reads: 0, v: archivist.AUDIT_V, checked: true, groupMax: 2 } }), { now: true });
  const WORDS = 'My own words the writer reads as true';
  const round = async (first) => {
    agcQuiet();
    archivist.askAudit(b.novelId);
    const out = [];
    for (let i = 0; i < 8 && b.novel().memory.auditAsked; i++) {
      agcQuiet();
      await reset();
      const from = (b.novel().memory.audit || {}).from || 0;
      await script([{ text: JSON.stringify(i === 0 && first ? first : { clear: true, verdict: 'These hold.' }) }]);
      await archivist.run(b.novelId);
      agcQuiet();
      const s = (await agcSent())[0] || '';
      out.push(`from ${from}${s.includes(WORDS) ? ' +his words' : ''}`);
    }
    return out;
  };
  const r1 = await round({ gone: [{ kind: 'people', name: 'Zed', why: 'no one of that name in the book' }] });
  const r2 = await round(null);
  const r3 = await round(null);
  assert.ok([...r2, ...r3].some((x) => x.includes('his words')), 'his words are judged again in a later round');
  await putAway(b);
});

await test('the check’s Undo sticks: what he undid is not changed again by the next check (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([[PARTNER_PAGE]], { brief: 'Jovan chose Emilia from a shortlist, to spite his father.', manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-j', name: 'Jovan', aka: [], about: 'The heir.', now: '' }); }, { now: true });
  const answer = { mine: [{ kind: 'book', name: 'about', holds: false, contradicts: QUOTE, text: 'The fathers arranged the marriage; Jovan was told, never asked.', why: 'he never chose' }] };
  await agcAudit(b, answer);
  const after1 = b.novel().brief;
  assert.equal(archivist.undoLast(b.novelId), true);
  const undone = b.novel().brief;
  const listed = archivist.wordsToJudge(b.novel(), agcChapters(b)).map((x) => x.key);
  await agcAudit(b, answer);
  assert.equal(b.novel().brief, undone, 'what he undid stays undone');
  await putAway(b);
});

await test('the check’s request and its reply fit its model, his chapters’ plans counted (2.12.18)', async () => {
  await setHouse();
  await setHouse({ context: 16000 });
  try {
    const chapters = Array.from({ length: 12 }, (_, i) => [Array.from({ length: 60 }, (_, k) => `In chapter ${i + 1} the keeper climbed stair ${k + 1} and counted the gulls.`).join(' ')]);
    const b = await makeBook(chapters, { manual: true });
    markAllSeen(b);
    for (const id of b.ids) store.change('chapter', id, shape.chapterSteps.setSummary({ text: 'The keeper climbs and counts the gulls.', fp: shape.chapterPrint(store.peek('chapter', id)), at: Date.now(), by: 'you' }), { now: true });
    store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-m', name: 'Mara', aka: [], about: 'The keeper.', now: '' }); }, { now: true });
    const measure = async () => {
      agcQuiet(); await reset(); archivist.askAudit(b.novelId); agcQuiet();
      await script([{ text: JSON.stringify({ clear: true, verdict: 'ok', mine: [] }) }]);
      await archivist.run(b.novelId); agcQuiet();
      const r = (await requests()).find((x) => x.body.messages.some((m) => String(m.content).includes(prompts.AUDIT_ASK)));
      const input = util.estimateTokens(r.body.messages.map((m) => String(m.content || '')).join('\n'));
      return { input, reply: r.body.max_tokens || r.body.max_completion_tokens || 0 };
    };
    const without = await measure();
    for (const id of b.ids) store.change('chapter', id, shape.chapterSteps.setPlan(Array.from({ length: 18 }, (_, k) => `Plan step ${k + 1}: the keeper learns one more thing about the letter.`).join(' ')), { now: true });
    const withPlans = await measure();
    assert.ok(withPlans.input + withPlans.reply <= 16000, 'the request and its reply fit the model');
    await putAway(b);
  } finally { await setHouse(); }
});

await test('a card of his judged overturned with words refused keeps his words and his mark (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([[{ text: 'The lamp had been smashed years ago, and Mara swept the glass.', how: 'partner' }]], { manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.lore.push({ id: 'lo-l', name: 'The lamp', about: 'Mara’s lamp, lit each night at the top of the stair.', updated: { by: 'you', at: 1 } }); }, { now: true });
  const lamp = () => b.novel().notes.lore.find((c) => c.id === 'lo-l');
  await agcAudit(b, { mine: [{ kind: 'lore', name: 'The lamp', holds: false, contradicts: 'The lamp had been smashed years ago', about: 'A lamp smashed by Count Vorlak.', why: 'the book says it was smashed' }] });
  const hisNow = shape.hisField(lamp(), 'about');
  /* a later reading of a new passage */
  store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('ai', 'Mara found a cracked lamp in the cellar.', { how: 'write', ask: { direction: '', length: 'scene' } })); }, { now: true });
  agcQuiet();
  await script([{ text: JSON.stringify({ lore: [{ name: 'The lamp', about: 'A cracked lamp in the cellar.' }] }) }]);
  await archivist.run(b.novelId);
  agcQuiet();
  assert.equal(hisNow, true, 'an answer that changes nothing of his words never takes his mark off them');
  await putAway(b);
});

await test('a thread the newest passage opened is never taken out by the check: by gone, or by its judgment (2.12.18)', async () => {
  await setHouse();
  for (const how of ['gone', 'contradicts']) {
    const b = await makeBook([['Mara kept the light.']], { manual: true });
    markAllSeen(b);
    store.change('chapter', b.ids[0], (c) => { c.passages.push(shape.newPassage('ai', 'A letter came from Orrin, sealed in black. Mara set it on the sill and did not open it.', { how: 'write', ask: { direction: '', length: 'scene' } })); }, { now: true });
    agcQuiet();
    await script([{ text: JSON.stringify({ threads: [{ name: 'The black letter', about: 'A letter from Orrin, sealed in black, that Mara has not opened.', open: true }] }) }]);
    await archivist.run(b.novelId);
    agcQuiet();
    const th = () => b.novel().notes.threads.find((c) => c.name === 'The black letter');
    assert.ok(th() && th().open === true);
    await agcAudit(b, how === 'gone' ? { gone: [{ kind: 'threads', name: 'The black letter', why: 'resolved' }] } : { mine: [{ kind: 'threads', name: 'The black letter', holds: false, contradicts: 'A letter came from Orrin, sealed in black', why: 'resolved' }] });
    assert.ok(th() && th().open === true, `by ${how}: ${JSON.stringify(b.novel().memory.audit.refused)}`);
    await putAway(b);
  }
});

await test('his What it’s about judged held is judged again once he changes the book (2.12.18)', async () => {
  await setHouse();
  const b = await makeBook([['Jovan chose Emilia from the shortlist, and said so to his father.']], { brief: 'Jovan chose Emilia from a shortlist, to spite his father.', manual: true });
  markAllSeen(b);
  store.change('novel', b.novelId, (n) => { n.notes.people.push({ id: 'pe-j', name: 'Jovan', aka: [], about: 'The heir.', now: '' }); }, { now: true });
  const WORDS = 'My own words the writer reads as true';
  let sent = await agcAudit(b, { mine: [{ kind: 'book', name: 'about', holds: true }] });
  /* he has his partner write the passage anew: the fathers arranged it */
  store.change('chapter', b.ids[0], (c) => { const p = c.passages[0]; p.versions.push(shape.newVersion({ text: 'Reginald and Harrison arranged the marriage; Jovan learned of it as a decision already made.', how: 'partner', from: p.versions[0].id })); p.pick = 1; }, { now: true });
  agcQuiet();
  await script([{ text: JSON.stringify({ people: [{ name: 'Jovan', about: 'The heir, told of an arranged marriage.' }] }) }]);
  await archivist.run(b.novelId);
  agcQuiet();
  const ch = agcChapters(b);
  sent = await agcAudit(b, { mine: [{ kind: 'book', name: 'about', holds: false, contradicts: 'Jovan learned of it as a decision already made', text: 'The fathers arranged the marriage; Jovan was told, never asked.', why: 'he never chose' }] });
  assert.equal(sent.includes(WORDS), true, 'his words are judged again once the words he changed himself say otherwise');
  await putAway(b);
});
/* ------------------------------------------------------------ who is telling (2.12.22) */
heading('who is telling: the teller’s name, its grounding phrase, the person it thinks in (2.12.22)');
const tellerjs = await import(path.join(ROOT, 'js/novel/teller.js'));
const plainvoice = await import(path.join(ROOT, 'js/novel/plainvoice.js'));
/* (a model name of its own: what a provider teaches about one model never reaches the tests after these) */
const SEEDED = { model: 'scripted-teller', thinking: 'high', prefillFlagField: 'prefix', prefillReasoningField: 'reasoning_content' };
const lastBody = async () => (await requests()).at(-1).body;
const tellerSystem = (body) => body.messages.filter((m) => m.role === 'system').map((m) => m.content);

await test('a named teller is greeted in its turn and is {{char}} in his words; its grounding phrase is woven in twice and planted as the first words of its thinking; Say it again at the end puts his box once more before the note at the end', async () => {
  await setHouse(SEEDED, {
    you: { name: 'Bruce' },
    instructions: { system: 'You are Tony Stark — {{char}} to Bruce. You write this story the way you talk.', narrator: '', late: 'Keep it close on Tony.', partner: '' },
    tellers: { write: { name: 'Tony Stark', phrase: 'Jarvis, wake up.', echo: true } },
  });
  const b = await makeBook([['Tony tightened the last bolt. Pepper said nothing from the doorway.']]);
  await script([{ text: 'Tony looked up.', think: 'and she has the test' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Pepper finds the blood test.' });
  assert.equal(out.ok, true, out.error);
  const body = await lastBody();
  const sys = tellerSystem(body);
  assert.ok(sys[0].startsWith('You are Tony Stark — Tony Stark to Bruce.'), 'his box first, {{char}} by its name');
  assert.equal(sys[0].split('You open every thought with “Jarvis, wake up.”').length - 1, 2, 'the phrase woven into the standing words twice');
  const ask = body.messages.filter((m) => m.role === 'user').at(-1).content;
  assert.ok(ask.startsWith('Tony Stark — pick Chapter One up right where it stops.'), ask.slice(0, 80));
  const tail = body.messages.slice(-3);
  assert.deepEqual(tail.map((m) => m.role), ['system', 'system', 'assistant'], 'his box again, the note at the end, then the started thought');
  assert.ok(tail[0].content.includes('You are Tony Stark — Tony Stark to Bruce.') && tail[1].content === 'Keep it close on Tony.');
  assert.deepEqual([tail[2].content, tail[2].reasoning_content, tail[2].prefix], ['', 'Jarvis, wake up.', true], 'the thinking begins with his phrase');
  const v = picked(b.ch().passages.at(-1));
  assert.ok(String(v.thinking || '').startsWith('Jarvis, wake up.'), 'and the thinking he reads opens with it');
  /* his own prefill on the connection wins on a page: no phrase planted over it */
  store.change('house', 'house', (h) => { h.connections[0].prefill = 'Tony:'; }, { now: true });
  await reset();
  await script([{ text: ' Right.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'He answers.' });
  const own = (await lastBody()).messages.at(-1);
  assert.equal(own.content, 'Tony:', 'his prefill as he wrote it');
  assert.ok(own.reasoning_content !== 'Jarvis, wake up.', 'never the phrase over it');
  /* thinking off: nothing planted, the phrase still woven in */
  store.change('house', 'house', (h) => { h.connections[0].prefill = ''; h.connections[0].thinking = 'off'; }, { now: true });
  await reset();
  await script([{ text: 'Quiet.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Silence.' });
  const off = await lastBody();
  assert.ok(off.messages.at(-1).role !== 'assistant', 'no started thought for a model that does not think');
  assert.ok(tellerSystem(off)[0].includes('You open every thought with “Jarvis, wake up.”'));
  /* nothing set: every word as it was */
  await setHouse(SEEDED, { you: { name: '' }, instructions: { system: 'You are Tony Stark — {{char}} to Bruce.', narrator: '', late: '', partner: '' } });
  await reset();
  await script([{ text: 'Plain.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Plain.' });
  const plain = await lastBody();
  assert.ok(tellerSystem(plain)[0].startsWith('You are Tony Stark — the writer to Bruce.') && !tellerSystem(plain)[0].includes('every thought with'));
  assert.ok(plain.messages.filter((m) => m.role === 'user').at(-1).content.startsWith('Pick Chapter One up right where it stops.'));
  assert.ok(plain.messages.at(-1).role !== 'assistant');
  await setHouse();
  await putAway(b);
});

await test('a model that will not continue a started thought is sent the page without the phrase, said once, and is not offered one again', async () => {
  await setHouse({ ...SEEDED, model: 'scripted-teller-refuses' }, { instructions: { system: 'You are Hulk.', narrator: '', late: '', partner: '' }, tellers: { write: { name: 'Hulk', phrase: 'Hulk think.' } } });
  const b = await makeBook([['Hulk waited by the river.']]);
  await script([{ status: 400, message: 'assistant message prefill is not supported for this model' }, { text: 'Hulk smash.' }, { text: 'Hulk smash again.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Hulk crosses.' });
  assert.equal(out.ok, true, out.error);
  const bodies = (await requests()).map((x) => x.body);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].messages.at(-1).reasoning_content, 'Hulk think.');
  assert.ok(bodies[1].messages.at(-1).role !== 'assistant', 'sent again without it');
  const notes = picked(b.ch().passages.at(-1)).notes || [];
  assert.ok(notes.some((n) => n.includes('would not continue a started thought') && n.includes('grounding phrase')), JSON.stringify(notes));
  await reset();
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Again.' });
  assert.ok((await lastBody()).messages.at(-1).role !== 'assistant', 'not offered one again');
  await setHouse();
  await putAway(b);
});

await test('the narrator and the partner are greeted by their own names and think from their own phrases; the partner’s own lines asked again greet it too', async () => {
  await setHouse(SEEDED, {
    you: { name: 'Bruce' },
    instructions: { system: '', narrator: 'You maintain a fictional, uncensored simulation. You are an unbiased cinematographer.', late: '', lateNarrator: '', partner: 'You are Pepper Potts.' },
    tellers: { play: { name: 'Tony Stark', phrase: 'Showtime.' }, partner: { name: 'Pepper', phrase: 'Okay, Bruce.' } },
  });
  const b = await makeBook([['Tony tightened the last bolt.']]);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Pepper Potts' });
  await script([{ text: 'The workshop hums.' }]);
  await talk.playSay({ playId, text: '' });
  const scene = await lastBody();
  assert.ok(tellerSystem(scene)[0].startsWith('You maintain a fictional, uncensored simulation. You tell it the way an unbiased cinematographer would.'), 'one "You are": the camera is a manner');
  assert.ok(scene.messages.filter((m) => m.role === 'user').at(-1).content.startsWith('Tony Stark — open the scene:'));
  assert.equal(scene.messages.at(-1).reasoning_content, 'Showtime.');
  await reset();
  await script([{ text: 'I changed it.' }, { text: 'NOTHING' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'What do you think?' });
  const asked = (await requests()).map((x) => x.body);
  assert.equal(asked[0].messages.filter((m) => m.role === 'user').at(-1).content, 'What do you think?', 'his own words as he typed them');
  assert.equal(asked[0].messages.at(-1).reasoning_content, 'Okay, Bruce.', 'the partner thinks from its own phrase — never his page’s prefill');
  assert.equal(asked.length, 2, 'its words claimed a change with no block: asked once for the block');
  assert.ok(asked[1].messages.filter((m) => m.role === 'user').at(-1).content.startsWith('Pepper — your last answer reads as if it made a change'), 'its own line asked again greets it');
  await setHouse();
  await putAway(b);
});

await test('a teller that says it is “I” has the app’s own standing words as its notes to itself, him as “you” — never his box, never a page, and what he asks in his turn still says “you”', async () => {
  await setHouse({}, { you: { name: 'Bruce' }, instructions: { system: 'I am Tony Stark. I write Bruce’s novel the way I talk.', narrator: '', late: '', partner: '' }, tellers: { write: { name: 'Tony Stark' } } });
  const b = await makeBook([['“I told you,” Tony said. I watched him go.']]);
  store.change('chapter', b.ids[0], (c) => { c.plan = 'Pepper finds the test.'; }, { now: true });
  await script([{ text: 'Next.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Pepper finds the test.' });
  const body = await lastBody();
  const sys = tellerSystem(body)[0];
  assert.ok(sys.startsWith('I am Tony Stark. I write Bruce’s novel the way I talk.'), 'his box untouched');
  assert.ok(sys.includes('You bring me premises') && sys.includes('and I write the novel'), 'the craft as the teller’s own notes');
  assert.ok(sys.includes('Stay myself while we work — my own voice') && sys.includes('the voice and point of view you chose for the book'));
  assert.ok(sys.includes("(the chapter I'm writing now)") && sys.includes('What you mean this chapter to do — your plan for it.'));
  assert.ok(sys.includes('“I told you,” Tony said. I watched him go.'), 'the page word for word');
  assert.ok(sys.includes('turn it over in my head the way I would'), 'turned over like a person, in the first person');
  assert.ok(body.messages.filter((m) => m.role === 'user').at(-1).content.includes('My words are for you, not for anyone in the story'), 'his turn says you');
  /* his own instructions in his voice are his, not a self: "Keep my voice" never turns the words */
  await setHouse({}, { instructions: { system: 'Keep my lyrical voice. I want it slow.', narrator: '', late: '', partner: '' } });
  await reset();
  await script([{ text: 'Slow.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Slow.' });
  const his = tellerSystem(await lastBody())[0];
  assert.ok(his.includes('I bring you premises') && his.includes('Before a word reaches the page, in your own head and never on it:'), 'his voice, and no teller named: every word as it was');
  /* a teller named: it turns the scene over like a person, speaking to it as "you" */
  await setHouse({}, { instructions: { system: 'Keep my lyrical voice. I want it slow.', narrator: '', late: '', partner: '' }, tellers: { write: { name: 'Tony' } } });
  await reset();
  await script([{ text: 'Slow.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Slower.' });
  const named = tellerSystem(await lastBody())[0];
  assert.ok(named.includes('I bring you premises') && named.includes('turn it over in your head the way you would') && !named.includes('in your own head and never on it'), 'named: turned over like a person');
  /* the swap itself: be and pronouns trade places once, quotes and a mentioned pronoun stay */
  assert.equal(tellerjs.swapPerson('I am the writer you work for; you were told. Tell me if you are unsure — “I hate you,” she said. The I of it.'), 'You are the writer I work for; I was told. Tell you if I am unsure — “I hate you,” she said. The I of it.');
  await setHouse();
  await putAway(b);
});

await test('presets keep who is telling — the name, the phrase, how it thinks, said again at the end — and one saved before keeps them as they are', async () => {
  const presets = await import(path.join(ROOT, 'js/novel/presets.js'));
  const h = { instructions: { system: 'You are Hulk.' }, you: { name: 'Bruce' }, tellers: { write: { name: 'Hulk', phrase: 'Hulk think.', person: 'second', echo: true } } };
  const saved = presets.voiceOf(h);
  assert.deepEqual(saved.tellers, { write: { name: 'Hulk', phrase: 'Hulk think.', person: 'second', echo: true } });
  assert.ok(presets.voiceLine(saved).includes('Hulk telling'));
  const other = { instructions: { system: 'You are Iron Man.' }, tellers: { write: { name: 'Tony' } } };
  presets.presetSteps.use(saved)(other);
  assert.deepEqual(other.tellers, saved.tellers, 'used: every teller as it was saved');
  const before = { boxes: { system: 'You are Hulk.' }, name: 'Bruce' };
  presets.presetSteps.use(before)(other);
  assert.deepEqual(other.tellers, saved.tellers, 'a preset of before keeps them');
});

await test('Read my standing words for an assistant’s voice names his lines that name the machine — and nothing in the app’s own modules is his to fix', () => {
  const found = plainvoice.readStandingWords([
    { name: 'How you like it written', text: 'You are Tony Stark.\nAs an AI assistant, respond to the user.' },
    { name: 'The novel craft', text: 'Write the scene.', mine: false },
  ]);
  const g = plainvoice.groupFindings(found);
  assert.equal(g.machine.length, 1);
  assert.ok(g.machine[0].line.includes('As an AI assistant') && g.machine[0].where === 'How you like it written');
  assert.ok(plainvoice.findingsText(found).includes('As an AI assistant, respond to the user.'));
});

/* ------------------------------------------------------------ a scene played as his tales are (2.12.23) */
heading('a scene played as his tales are: edit, try again, another version (2.12.23)');
await test('in a scene his move is changed where it stands and a telling by his hand as a new version, each with Undo; Try again answers his move afresh — the telling after it another version, what came after let go with Undo; nothing already in the book', async () => {
  await setHouse();
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await script([{ text: 'The lamp room is cold.' }, { text: 'He takes it, warm.' }, { text: 'The rain eases.' }]);
  await talk.playSay({ playId, text: '' });
  await talk.playSay({ playId, text: 'I take his hand.' });
  await talk.playSay({ playId, text: 'I wait.' });
  const turns = () => store.peek('play', playId).turns;
  const said = () => turns().map((t) => `${t.by}:${picked(t).text}`);
  assert.deepEqual(said(), ['ai:The lamp room is cold.', 'you:I take his hand.', 'ai:He takes it, warm.', 'you:I wait.', 'ai:The rain eases.']);
  /* his move, changed where it stands — with his line to the narrator */
  const move = turns()[1];
  const e1 = talk.editPlayTurn({ playId, turnId: move.id, text: 'I take his cold hand.', tell: 'Slow it down.' });
  assert.equal(e1.ok, true);
  assert.deepEqual([picked(turns()[1]).text, picked(turns()[1]).tell, turns()[1].versions.length], ['I take his cold hand.', 'Slow it down.', 1]);
  e1.undo();
  assert.deepEqual([picked(turns()[1]).text, picked(turns()[1]).tell], ['I take his hand.', undefined], 'Undo: his words as they were');
  assert.equal(talk.editPlayTurn({ playId, turnId: move.id, text: '  ', tell: '' }).ok, false, 'a move needs words');
  /* the narrator's telling, by his hand: a new version, the one before one arrow back */
  const e2 = talk.editPlayTurn({ playId, turnId: turns()[2].id, text: 'He takes it, warm, and does not let go.' });
  assert.equal(e2.ok, true);
  assert.deepEqual([turns()[2].versions.length, picked(turns()[2]).text, picked(turns()[2]).how], [2, 'He takes it, warm, and does not let go.', 'edited']);
  e2.undo();
  assert.deepEqual([turns()[2].versions.length, picked(turns()[2]).text], [1, 'He takes it, warm.']);
  /* Try again on his first move: the telling after it is written again; what came after it is let go, with Undo */
  await reset();
  await script([{ text: 'He takes it, and the lamp gutters.' }]);
  let cut = 0;
  let undo = null;
  const out = await talk.playRetry({ playId, turnId: move.id, onCut: (u, n) => { cut = n; undo = u; } });
  assert.equal(out.ok, true, out.error);
  assert.equal(cut, 2, 'his later move and its telling let go');
  assert.deepEqual(said(), ['ai:The lamp room is cold.', 'you:I take his hand.', 'ai:He takes it, and the lamp gutters.']);
  assert.equal(turns()[2].versions.length, 2, 'the telling before one arrow back');
  const sent = (await requests())[0].body.messages.map((m) => m.content).join('\n');
  assert.ok(sent.includes('I take his hand.') && !sent.includes('I wait.') && !sent.includes('He takes it, warm.'), 'answered from his move, never from what came after it');
  undo();
  assert.deepEqual(said().slice(3), ['you:I wait.', 'ai:The rain eases.'], 'Undo puts back what came after');
  /* Try again on his newest move: only another version of the telling after it */
  await reset();
  await script([{ text: 'The rain stops.' }]);
  let cutLast = -1;
  await talk.playRetry({ playId, turnId: turns()[3].id, onCut: (u, n) => { cutLast = n; } });
  assert.equal(cutLast, -1, 'nothing let go');
  assert.deepEqual([turns().length, turns()[4].versions.length, picked(turns()[4]).text], [5, 2, 'The rain stops.']);
  /* a telling with choices: he edits the telling as it is drawn, and its choices stay with it */
  const last = turns()[4];
  const choices = '<choices>\n1. Mara opens the door.\n2. Mara waits.\n3. Mara calls out.\n</choices>';
  store.change('play', playId, shape.turnSteps.setVersion(last.id, picked(last).id, { text: `The rain stops.\n\n${choices}` }), { now: true });
  assert.equal(talk.editPlayTurn({ playId, turnId: last.id, text: 'The rain stops.' }).same, true, 'the words as drawn, unchanged: nothing new');
  assert.equal(talk.editPlayTurn({ playId, turnId: last.id, text: 'The rain stops at last.' }).ok, true);
  assert.equal(picked(turns()[4]).text, `The rain stops at last.\n\n${choices}`, 'the choices kept under his words');
  /* written into the book up to here: that part is the book's */
  store.change('play', playId, (d) => { d.turned = d.turns[2].id; }, { now: true });
  assert.equal(talk.editPlayTurn({ playId, turnId: move.id, text: 'Changed.' }).ok, false);
  assert.equal((await talk.playRetry({ playId, turnId: move.id })).ok, false);
  assert.equal(talk.editPlayTurn({ playId, turnId: turns()[3].id, text: 'I wait, and listen.' }).ok, true, 'what comes after the marker is still his to change');
  await setHouse();
  await putAway(b);
});

/* ------------------------------------------------------------ his lines in a scene written into prose (2.12.24) */
heading('his lines in a scene written into prose (2.12.24)');
await test('a scene written into prose: his character’s lines go to the writer as said and done, not as ideas — and so when it goes on from where it stopped', async () => {
  await setHouse();
  const b = await makeBook([['Mara climbed to the lamp.']]);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await script([{ text: 'A stranger waits at the foot of the steps.' }, { text: 'He smiles. "Someone who read your letter."' }]);
  await talk.playSay({ playId, text: '' });
  await talk.playSay({ playId, text: '"Who are you?" I ask, stepping closer.' });
  await reset();
  await script([{ text: 'The stranger waited at the foot of the steps. "Who are you?" Mara asked, and', finish: 'length' }, { text: 'and he smiled.' }]);
  const tr = talk.transcriptOf(store.peek('play', playId));
  const out = await writer.playToProse({ novelId: b.novelId, chapterId: b.ids[0], play: store.peek('play', playId), transcript: tr.text, mine: tr.mine });
  assert.equal(out.ok, true, out.error);
  const page = b.ch().passages.find((x) => x.id === out.passageId);
  assert.equal(picked(page).cut, true, 'the page stopped partway');
  const on = await writer.goOn({ novelId: b.novelId, chapterId: b.ids[0], passageId: out.passageId });
  assert.equal(on.ok, true, on.error);
  const asks = (await requests()).map(askOf);
  assert.equal(asks.length, 2);
  for (const ask of asks) {
    assert.ok(ask.includes('Mara: "Who are you?" I ask, stepping closer.'), 'his line rides in the scene');
    assert.ok(ask.includes('My lines are what Mara actually said and did in the scene — not ideas for it') && ask.includes('everything Mara said is said on the page in Mara’s own words') && ask.includes('don’t give Mara words I didn’t write') && ask.includes('write it once'), ask);
  }
  assert.ok(picked(b.ch().passages.find((x) => x.id === out.passageId)).text.endsWith('and he smiled.'), 'it went on from where it stopped');
  await setHouse();
  await putAway(b);
});

/* ------------------------------------------------------------ the world before the opening (2.12.27) */
heading('the world built before the opening, and what a page needs from it by what it means (2.12.27)');
const bibpick = await import(path.join(ROOT, 'js/novel/bibpick.js'));
const WORLD = '<changes>['
  + '{"entry": "The Iron Covenant", "kind": "groups", "line": "The knightly order that rules the port", "text": "COVENANT ENTRY: grey cloaks and an oath sworn on cold iron; the city guard answers to it.", "why": "a"},'
  + '{"entry": "Kael Varro", "kind": "people", "line": "A smuggler", "text": "KAEL ENTRY: quick hands, a debt to the harbourmaster.", "why": "b"},'
  + '{"entry": "Saltmarket", "kind": "places", "line": "The harbour market", "text": "SALTMARKET ENTRY: fish stalls under tarred canvas.", "why": "c"},'
  + '{"entry": "The Weave", "kind": "lore", "line": "How magic works", "text": "WEAVE ENTRY: every working costs the caster warmth.", "rides": "always", "why": "d"},'
  + '{"entry": "The Tide Choir", "kind": "groups", "line": "Singers who calm the storms", "text": "CHOIR ENTRY: they sing from the lighthouse at the harbour mouth.", "why": "e"}'
  + ']</changes>\nThe world, in five entries.';
const sentWords = (x) => x.body.messages.map((m) => String(m.content || '')).join('\n');
/* A ROOM TOO SMALL FOR THE WHOLE BIBLIOGRAPHY (2.12.28): the share's least, 600 tokens — the always entry and his words'
 * names fit, and of the two long entries nobody names only one: the one sharing words with the moment, "the city guard" */
const SMALL_ROOM = [{ context: 4000, maxTokens: 500 }, CRAFTS_OFF];
const LONG = (tag) => `${tag}: ` + 'grey cloaks and the old oaths of the port '.repeat(30);
async function portBook({ always = true } = {}) {
  const b = await makeBook([['The harbour bell rang twice.']], { title: 'Salt and Iron' });
  for (const e of [
    { name: 'The Weave', kind: 'lore', line: 'How magic works', rides: always ? 'always' : 'named', text: 'WEAVE ENTRY.' },
    { name: 'Kael Varro', kind: 'people', line: 'A smuggler', text: 'KAEL ENTRY.' },
    { name: 'The Iron Covenant', kind: 'groups', line: 'The order that rules the port', text: LONG('COVENANT ENTRY') + ' The city guard answers to it.' },
    { name: 'The Tide Choir', kind: 'groups', line: 'Singers who calm the storms', text: LONG('CHOIR ENTRY') },
  ]) store.change('novel', b.novelId, shape.novelSteps.putEntry(bib.tidyEntry(bib.newEntry(e))), { now: true });
  return b;
}

await test('before the opening the partner builds the world into the bibliography; the opening page takes the whole of it while it fits — no helper asked, no wait — said as the whole; another take the same', async () => {
  await setHouse();
  const b = await makeBook([[]], { title: 'Salt and Iron', brief: 'A port city ruled by an order of iron-sworn knights.' });
  await reset();
  await script([{ text: WORLD }]);
  const built = await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'Build the world with me before the opening: the order that rules the port, a smuggler, the market, how magic works, and the singers.' });
  assert.equal(built.ok, true, built.error);
  const v = picked(store.peek('talk', b.novelId).turns.at(-1));
  assert.deepEqual(v.changes.map((c) => c.status), ['made', 'made', 'made', 'made', 'made'], JSON.stringify(v.changes.map((c) => c.said || '')));
  assert.deepEqual(bib.entriesOf(b.novel()).map((e) => [e.name, e.kind, e.rides]), [['The Iron Covenant', 'groups', 'named'], ['Kael Varro', 'people', 'named'], ['Saltmarket', 'places', 'named'], ['The Weave', 'lore', 'always'], ['The Tide Choir', 'groups', 'named']]);
  assert.equal((await pickAsks()).length, 0, 'the partner sees every entry: it never asks for a pick');
  /* the opening: his words name Kael and the Saltmarket, the Weave rides always — and the room holds all five */
  await reset();
  await script([{ text: 'The opening page.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro slips through the Saltmarket at dawn while the city guard searches the stalls.', length: 'scene' });
  assert.equal(out.ok, true, out.error);
  assert.equal((await pickAsks()).length, 0, 'the whole bibliography goes: nothing to pick, nobody asked');
  const sent = sentWords((await requests()).find((x) => x.body.messages.at(-1).content.includes('Kael Varro slips')));
  for (const w of ['COVENANT ENTRY', 'KAEL ENTRY', 'SALTMARKET ENTRY', 'WEAVE ENTRY', 'CHOIR ENTRY']) assert.ok(sent.includes(w), w);
  assert.ok(sent.includes(prompts.BIB_LEAD_WHOLE), 'said to be the whole of it');
  assert.ok(sent.indexOf('WEAVE ENTRY') < sent.indexOf('KAEL ENTRY') && sent.indexOf('KAEL ENTRY') < sent.indexOf('SALTMARKET ENTRY') && sent.indexOf('SALTMARKET ENTRY') < sent.indexOf('COVENANT ENTRY'), 'always, then his words’ names, then the rest');
  assert.equal(picked(b.ch().passages[0]).text, 'The opening page.');
  /* another take of the same page: the whole of it again, and no call */
  await reset();
  await script([{ text: 'Another opening.' }]);
  const again = await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages[0].id });
  assert.equal(again.ok, true, again.error);
  assert.equal((await pickAsks()).length, 0);
  assert.ok(sentWords((await requests()).find((x) => sentWords(x).includes('WEAVE ENTRY'))).includes('CHOIR ENTRY'));
  await setHouse();
  await putAway(b);
});

await test('a bibliography bigger than its share: Always and his words’ names first, then what the helper picks for the page, then the rest as there is room — the helper asked only of the entries that would be left out; another take asks nothing again', async () => {
  await setHouse(...SMALL_ROOM);
  const b = await portBook();
  await reset();
  await script([{ pick: true, text: '{"entries": [1]}' }, { text: 'A page.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro runs for the boats while the city guard searches the stalls.', length: 'scene' });
  assert.equal(out.ok, true, out.error);
  const asks = await pickAsks();
  assert.equal(asks.length, 1, 'one pick, before the page');
  const ask = asks[0].body.messages.at(-1).content;
  assert.ok(ask.includes('Kael Varro runs for the boats'), 'it reads his words for the page');
  assert.ok(ask.includes('1. The Tide Choir — group: Singers who calm the storms') && !/\d\. (The Iron Covenant|Kael Varro|The Weave)/.test(ask), 'only the one the page would go without: the Covenant goes as the rest, sharing “the city guard”');
  assert.ok(/Entries the writer has with it already: .*Kael Varro/.test(ask) && /already: .*The Iron Covenant/.test(ask), ask);
  const sent = sentWords((await requests()).at(-1));
  assert.ok(sent.includes('WEAVE ENTRY') && sent.includes('KAEL ENTRY') && sent.includes('CHOIR ENTRY'), 'Always, his words’ names, what the page needs');
  assert.ok(!sent.includes('COVENANT ENTRY'), 'what the helper picked goes before the rest: the rest gives way');
  assert.ok(sent.includes(prompts.BIB_LEAD_PICKED), 'said as named here and what else this part needs');
  assert.ok(sent.indexOf('KAEL ENTRY') < sent.indexOf('CHOIR ENTRY'));
  /* another take: the same moment — what it named, no second call */
  await reset();
  await script([{ text: 'Another page.' }]);
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: b.ch().passages.at(-1).id });
  assert.equal((await pickAsks()).length, 0, 'asked nothing again');
  assert.ok(sentWords((await requests()).at(-1)).includes('CHOIR ENTRY'));
  await setHouse();
  await putAway(b);
});

await test('a pick that fails, answers nothing it can read or is slow leaves the page as it would have gone; nothing left out, or no bibliography, and nothing is asked at all', async () => {
  await setHouse(...SMALL_ROOM);
  const b = await portBook();
  /* refused */
  await reset();
  await script([{ pick: true, status: 500, message: 'down' }, { text: 'A page.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro runs for the boats while the city guard searches the stalls.', length: 'scene' });
  assert.equal(out.ok, true, out.error);
  assert.equal((await pickAsks()).length, 1, 'it was asked');
  let sent = sentWords((await requests()).at(-1));
  assert.ok(sent.includes('KAEL ENTRY') && sent.includes('COVENANT ENTRY') && !sent.includes('CHOIR ENTRY'), 'as it would go without it: the rest by its shared words');
  assert.ok(!sent.includes(prompts.BIB_LEAD_PICKED) && !sent.includes(prompts.BIB_LEAD_WHOLE), 'never said to be what the page needs, nor the whole');
  assert.equal(picked(b.ch().passages.at(-1)).text, 'A page.');
  /* an answer it cannot read: nothing */
  await reset();
  await script([{ pick: true, text: 'The singers, I think.' }, { text: 'Another page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro hides under the pier while the city guard searches.', length: 'scene' });
  sent = sentWords((await requests()).at(-1));
  assert.ok(!sent.includes('CHOIR ENTRY') && sent.includes('KAEL ENTRY'), 'unreadable: none');
  /* an answer written only in its thinking is read from there */
  await reset();
  await script([{ pick: true, think: 'The page needs the singers: {"entries": [1]}', text: 'Done.' }]);
  const house = store.peek('house', 'house');
  const conn = house.connections[0];
  const thought = await bibpick.pickEntries({ conn, house, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'x', moment: 'Grey cloaks fill the square while the city guard watches.',
    dry: () => context.assemble({ house, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'x', moment: 'Grey cloaks fill the square while the city guard watches.' }).stats });
  assert.deepEqual(thought.refs, [bib.entriesOf(b.novel()).find((e) => e.name === 'The Tide Choir')].map((e) => `e:${e.id}`), JSON.stringify(thought));
  /* slow: it waits as long as it is given, then the page goes without it */
  await reset();
  await script([{ pick: true, hang_after: '{"entries": [' }]);
  const t0 = Date.now();
  const slow = await bibpick.pickEntries({ conn, house, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'x', moment: 'The bell rings a third time.', timeoutMs: 400 });
  assert.deepEqual(slow.refs, []);
  assert.ok(Date.now() - t0 < 4000, `it waited ${Date.now() - t0} ms`);
  /* a room that holds them all: nothing left out, nothing asked */
  await setHouse();
  await reset();
  await script([{ text: 'Room for all.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro bows to the Iron Covenant.', length: 'scene' });
  assert.equal((await pickAsks()).length, 0, 'the whole of it goes: nothing asked');
  sent = sentWords((await requests()).at(-1));
  assert.ok(sent.includes('COVENANT ENTRY') && sent.includes('CHOIR ENTRY') && sent.includes(prompts.BIB_LEAD_WHOLE));
  /* nor in a book with no bibliography */
  const plain = await makeBook([['A quiet morning.']]);
  await reset();
  await script([{ text: 'Plain page.' }]);
  await writer.writeNext({ novelId: plain.novelId, chapterId: plain.ids[0], direction: 'She makes tea.', length: 'scene' });
  assert.equal((await pickAsks()).length, 0, 'no bibliography: nothing asked');
  await putAway(plain);
  await putAway(b);
});

await test('Stop while the helper picks: the page stops right there — never asked, nothing left behind — and the next page goes', async () => {
  await setHouse(...SMALL_ROOM);
  const b = await portBook();
  await reset();
  await script([{ pick: true, hang_after: '{"entries": [' }, { text: 'NEVER WRITTEN.' }]);
  const run = writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro runs for the boats.', length: 'scene' });
  await sleep(700);
  assert.equal(writer.busy(b.novelId), true, 'the page is being written while the helper picks');
  const t0 = Date.now();
  writer.stop(b.novelId);
  const out = await run;
  assert.ok(Date.now() - t0 < 2000, `stopped in ${Date.now() - t0} ms`);
  assert.equal(out.ok, false);
  assert.equal(writer.busy(b.novelId), false);
  assert.equal((await requests()).filter((x) => sentWords(x).includes('Kael Varro runs for the boats.')).length, 0, 'the page was never asked');
  assert.deepEqual(b.ch().passages.map((p) => picked(p).text), ['The harbour bell rang twice.'], 'no empty passage left');
  await reset();
  await script([{ pick: true, text: '{"entries": []}' }, { text: 'The next page.' }]);
  const next = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro runs for the boats.', length: 'scene' });
  assert.equal(next.ok, true, next.error);
  assert.equal(picked(b.ch().passages.at(-1)).text, 'The next page.');
  await setHouse();
  await putAway(b);
});

await test('Smart recall off for a book: no pick is asked, the page goes with what fits, and the writer and the partner are told an entry rides by its name when the room is short', async () => {
  await setHouse(...SMALL_ROOM);
  const b = await portBook();
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibRecall', 'off'), { now: true });
  assert.equal(bib.recallOn(b.novel()), false);
  await reset();
  await script([{ text: 'A page.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'Kael Varro runs for the boats.', length: 'scene' });
  assert.equal(out.ok, true, out.error);
  assert.equal((await pickAsks()).length, 0, 'off: nothing asked');
  await setHouse();
  await reset();
  await script([{ text: 'Talk.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'What rules the port?' });
  const partner = sentWords((await requests()).at(-1));
  assert.ok(partner.includes('The writer reads an entry with every page while there’s room beside the book — and when there isn’t, first when its name comes up, unless I say always or never:') && !partner.includes('or a page needs it'), 'told as it is: by name when the room is short');
  /* on again: the partner is told a page's needs bring entries in too */
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibRecall', ''), { now: true });
  await reset();
  await script([{ text: 'Talk again.' }]);
  await talk.partnerSay({ novelId: b.novelId, chapterId: b.ids[0], text: 'And now?' });
  const again = sentWords((await requests()).at(-1));
  assert.ok(again.includes(prompts.BIB_INDEX) && again.includes('first when its name comes up or a page needs it, and writes from it'), 'on: said so');
  await putAway(b);
});

await test('a scene’s telling takes what it needs from the bibliography by what his move means — the pick reads his move', async () => {
  await setHouse(...SMALL_ROOM);
  const b = await portBook();
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Kael' });
  await reset();
  await script([{ pick: true, text: '{"entries": []}' }, { text: 'The stalls are quiet.' }, { pick: true, text: '{"entries": [1]}' }, { text: 'The guard turns, and sees the grey cloth.' }]);
  await talk.playSay({ playId, text: '' });
  await talk.playSay({ playId, text: 'I sing the old storm song over the stalls.' });
  const asks = await pickAsks();
  assert.equal(asks.length, 2, 'one pick before each telling');
  assert.ok(asks[1].body.messages.at(-1).content.includes('My newest moves in it:') && asks[1].body.messages.at(-1).content.includes('I sing the old storm song over the stalls.'), asks[1].body.messages.at(-1).content);
  const tellings = (await requests()).filter((x) => sentWords(x).includes('Kael'));
  const picked1 = asks[1].body.messages.at(-1).content.match(/^1\. (.+?) —/m)[1];
  assert.ok(sentWords(tellings.at(-1)).includes(picked1 === 'The Tide Choir' ? 'CHOIR ENTRY' : 'COVENANT ENTRY'), 'his move: what it means brings it in');
  assert.deepEqual(store.peek('play', playId).turns.map((t) => picked(t).text), ['The stalls are quiet.', 'I sing the old storm song over the stalls.', 'The guard turns, and sees the grey cloth.']);
  await setHouse();
  await putAway(b);
});

await test('what the helper names is read carefully — only numbers on its list, each once, five at most, its last list; and the list leaves out what rides anyway, the shared words first when it must be cut', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, ref: `e:${i + 1}` }));
  assert.deepEqual(bib.readPick('{"entries": [2, 2, 9, 3]}', rows), ['e:2', 'e:3']);
  assert.deepEqual(bib.readPick('I could say {"entries": [1]} — but: {"entries": [4, 5]}', rows), ['e:4', 'e:5']);
  assert.equal(bib.readPick('{"entries": [1, 2, 3, 4, 5, 6, 7]}', rows).length, 5);
  assert.deepEqual(bib.readPick('The order, I think.', rows), []);
  assert.deepEqual(bib.readPick('{"entries": []}', rows), []);
  const novel = { bibliography: [
    bib.tidyEntry(bib.newEntry({ name: 'Rukia', kind: 'people', line: 'A reaper', text: 'R.' })),
    bib.tidyEntry(bib.newEntry({ name: 'Zanpakuto', kind: 'things', line: 'A soul-cutting sword', text: 'Z.' })),
    bib.tidyEntry(bib.newEntry({ name: 'Gotei', kind: 'groups', line: 'The thirteen squads', rides: 'always', text: 'G.' })),
    bib.tidyEntry(bib.newEntry({ name: 'Secret', kind: 'lore', line: 'The ending', rides: 'never', text: 'S.' })),
    bib.tidyEntry(bib.newEntry({ name: 'Hollow', aka: ['the masked ones'], kind: 'lore', line: 'Fallen souls that hunger', text: 'H.' })),
    bib.tidyEntry(bib.newEntry({ name: 'Soul Society', kind: 'places', line: 'Where the dead go', text: 'SS.' })),
  ] };
  const items = bib.bibItems(novel, {}, { facts: false });
  /* a name with its article is its name wherever it stands — the article in small letters mid-sentence too; a description in small letters keeps its own */
  const named = bib.makeFinder(bib.itemForms(bib.bibItems({ bibliography: [bib.tidyEntry(bib.newEntry({ name: 'The Iron Covenant', kind: 'groups', line: 'x' })), bib.tidyEntry(bib.newEntry({ name: 'the old road', kind: 'places', line: 'y' }))] }, {}, { facts: false })));
  const said = 'The Iron Covenant marched. They bowed to the Iron Covenant, and an Iron Covenant knight took the old road.';
  assert.deepEqual(named.find(said).map((x) => said.slice(x.start, x.end)), ['Iron Covenant', 'Iron Covenant', 'Iron Covenant', 'the old road']);
  let got = bib.pickRows(items, { his: 'Rukia draws her sword.', near: 'One of the masked ones waited at the gate.' });
  assert.deepEqual(got.rows.map((r) => r.name), ['Soul Society', 'Zanpakuto'].sort((a, b) => a.localeCompare(b)), 'named (by name or another name), always, never: not on the list');
  assert.deepEqual(got.riding.map((it) => it.name).sort(), ['Gotei', 'Hollow', 'Rukia']);
  /* cut to its room — one row's worth: the one sharing words with the moment ("sword") stays */
  got = bib.pickRows(items, { his: 'Rukia draws her sword.', near: '', cap: util.estimateTokens('Zanpakuto — thing: A soul-cutting sword') + 4 });
  assert.deepEqual(got.rows.map((r) => r.name), ['Zanpakuto']);
  /* and a picked entry rides after his words' names, before the ones near the point */
  const ride = bib.ridingItems(items, { his: 'Rukia waits.', near: 'In the Soul Society the bells rang.', picked: [items.find((it) => it.name === 'Zanpakuto').ref], budget: 100000 });
  assert.deepEqual(ride.items.map((it) => it.name), ['Gotei', 'Rukia', 'Zanpakuto', 'Soul Society']);
  /* the partner is never handed picks */
  const forPartner = bib.ridingItems(items, { his: 'Rukia waits.', near: '', picked: [items.find((it) => it.name === 'Zanpakuto').ref], budget: 100000, purpose: 'partner' });
  assert.ok(!forPartner.items.some((it) => it.name === 'Zanpakuto'));
});

heading('Super automatic, and the chapters by themselves (2.12.28)');
const auto = await import(path.join(ROOT, 'js/novel/auto.js'));
const SUPER = () => ({ superAuto: { on: true, from: Date.now() } });
/* the page's own request: its last message (his request for the page) */
const pageAsk = async () => String((await requests()).at(-1).body.messages.at(-1).content);

await test('one switch reads before every book’s own: What it’s about and How it reads Automatic, the bibliography filled, Smart recall on, the checker checking where he said Nobody, the fixes going in from when it was switched on, the partner’s changes landing at once — off again, everything as he set it, nothing of his changed', async () => {
  await setHouse({}, { roles: { writer: 'c-w', checker: 'off' }, partnerApplies: 'wait' });
  const b = await makeBook([['The lamp was cold.']], { manual: true });
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibAuto', 'off'), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.setPref('bibRecall', 'off'), { now: true });
  const read = () => {
    const n = b.novel();
    const hs = store.peek('house', 'house');
    return { about: prompts.autoOn(n, 'about'), style: prompts.autoOn(n, 'style'), kept: prompts.keptByHelper(n), fill: context.bibAutoOn(n), recall: bib.recallOn(n),
      checker: (checker.checkerConn(hs) || {}).id || null, holds: (writer.holderOf(hs, 'checker') || {}).id || null, applies: auto.appliesOf(hs), fix: checker.autoOf(hs).fix, lift: checker.autoOf(hs).lift };
  };
  const off = { about: false, style: false, kept: [], fill: false, recall: false, checker: null, holds: null, applies: 'wait', fix: null, lift: null };
  assert.deepEqual(read(), off);
  const from = Date.now();
  store.change('house', 'house', (x) => { x.superAuto = { on: true, from }; }, { now: true });
  assert.deepEqual(read(), { about: true, style: true, kept: ['about', 'style'], fill: true, recall: true, checker: 'c-w', holds: 'c-w', applies: 'now', fix: from, lift: null });
  /* his own switches stand as he set them underneath */
  const n = b.novel();
  const hs = store.peek('house', 'house');
  assert.deepEqual([n.auto, n.prefs.bibAuto, n.prefs.bibRecall, hs.roles.checker, hs.partnerApplies, hs.autoFix], [{ about: false, style: false }, 'off', 'off', 'off', 'wait', undefined]);
  /* his own fixes switch from earlier: the earlier of the two; a passage under his mark stays his own switch */
  store.change('house', 'house', (x) => { x.autoFix = { on: true, from: from - 5000 }; }, { now: true });
  assert.equal(checker.autoOf(store.peek('house', 'house')).fix, from - 5000);
  store.change('house', 'house', (x) => { x.superAuto = { on: false }; delete x.autoFix; }, { now: true });
  assert.deepEqual(read(), off, 'off: as he set it');
  await setHouse();
  await putAway(b);
});

await test('Super automatic checking where he chose Nobody begins when it is switched on: a page written before waits to be asked for, a page after is checked by itself', async () => {
  const long = Date.now() - 100000;
  await setHouse({}, { roles: { writer: 'c-w', checker: 'off' }, checksFrom: long, judge: { on: false } });
  const b = await makeBook([['An old page from before.']]);
  await sleep(5);
  const from = Date.now();
  store.change('house', 'house', (x) => { x.superAuto = { on: true, from }; }, { now: true });
  const hs = () => store.peek('house', 'house');
  assert.equal(checker.checksFromOf(hs()), from, 'Nobody chosen: it begins with Super automatic');
  await sleep(5);
  await checker.runCheck(b.novelId);
  const isCheck = (x) => String(x.body.messages.at(-1).content).includes('Check these passages from');
  assert.equal((await requests()).filter(isCheck).length, 0, 'the page from before is not checked by itself');
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'A new page of mine.' });
  await reset();
  await checker.runCheck(b.novelId);
  const asks = (await requests()).filter(isCheck);
  assert.equal(asks.length, 1);
  const ask = String(asks[0].body.messages.at(-1).content);
  assert.ok(ask.includes('[1.2] A new page of mine.') && !ask.includes('[1.1]'), ask.slice(-400));
  /* a checker of his own: its own start, as ever */
  store.change('house', 'house', (x) => { x.roles.checker = 'c-w'; }, { now: true });
  assert.equal(checker.checksFromOf(hs()), long);
  await setHouse();
  await putAway(b);
});

await test('with Super automatic on, a sentence the checker has written again by itself runs to its end and goes in on the page — with neither switch on it is let go at once, nothing changed', async () => {
  await setHouse({}, SUPER());
  const b = await makeBook([['She walked slowly to the door and waited.']]);
  const p = b.ch().passages[0];
  const text = picked(p).text;
  const start = text.indexOf('slowly');
  await script([{ text: 'quietly' }]);
  const out = await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, start, end: start + 'slowly'.length, note: 'Write it again without “slowly”.', auto: true, fix: true });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(picked(b.ch().passages[0]).text, 'She walked quietly to the door and waited.');
  /* off: the house without Super automatic and without the checker's fixes switched on */
  await setHouse();
  await script([{ text: 'softly' }]);
  const now = picked(b.ch().passages[0]).text;
  const at = now.indexOf('quietly');
  const out2 = await writer.rewriteSelection({ novelId: b.novelId, chapterId: b.ids[0], passageId: p.id, start: at, end: at + 'quietly'.length, note: 'x', auto: true, fix: true });
  assert.equal(out2.ok, false);
  assert.equal(out2.yielded, true, JSON.stringify(out2));
  assert.equal(picked(b.ch().passages[0]).text, 'She walked quietly to the door and waited.');
  await putAway(b);
});

await test('Super automatic: the writer is asked to end the chapter where the story would; its END OF CHAPTER comes off the page, the page is kept as the one that ends it, and the next page goes in a new chapter — made once, found again while it is empty, and not once the chapter after it is written', async () => {
  await setHouse({}, SUPER());
  const b = await makeBook([['The lamp was cold.']]);
  await script([{ text: 'She closed the door behind her.\n\nEND OF CHAPTER' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: 'She leaves the lighthouse.', length: 'scene' });
  assert.equal(out.ok, true, out.error);
  const ask = await pageAsk();
  assert.ok(ask.includes('If this part brings Chapter One to where it should end') && ask.includes(`put ${prompts.CHAPTER_ENDS} on a line of its own`), ask);
  assert.ok(ask.includes(`nothing before or after it but ${prompts.CHAPTER_ENDS} where it ends the chapter`), 'the story-only line carries the one line it may');
  const v = picked(b.ch().passages.at(-1));
  assert.equal(v.text, 'She closed the door behind her.');
  assert.equal(v.closes, true);
  assert.equal(shape.chapterClosed(b.ch()), true);
  assert.deepEqual(writer.closedGoesOn(b.novelId, b.ids[0]), { fresh: true, number: 2 });
  const next = await writer.chapterAfterClose(b.novelId, b.ids[0]);
  assert.ok(next && next !== b.ids[0]);
  assert.deepEqual(b.novel().order, [b.ids[0], next]);
  /* asked again while it is empty: the same one, nothing new made */
  assert.equal(await writer.chapterAfterClose(b.novelId, b.ids[0]), next);
  assert.deepEqual(writer.closedGoesOn(b.novelId, b.ids[0]), { chapterId: next, number: 2 });
  assert.equal(b.novel().order.length, 2);
  /* the page in the new chapter: its opening — no close asked of it */
  await script([{ text: 'Morning on the cliffs.' }]);
  const o2 = await writer.writeNext({ novelId: b.novelId, chapterId: next, direction: '', length: 'scene' });
  assert.equal(o2.ok, true, o2.error);
  assert.ok(!(await pageAsk()).includes(prompts.CHAPTER_ENDS), 'an opening page is never asked to end its chapter');
  assert.equal(writer.closedGoesOn(b.novelId, b.ids[0]), null, 'the chapter after it is written: the next page goes where he is');
  await setHouse();
  await putAway(b);
});

await test('nothing is asked about the chapter’s end with Super automatic off, between two passages, or on a chapter’s opening page; the rest of a chapter written whole ends it with nothing said', async () => {
  await setHouse();
  const b = await makeBook([['The lamp was cold.', 'The sea was grey.']]);
  await script([{ text: 'A page.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'scene' });
  assert.ok(!(await pageAsk()).includes(prompts.CHAPTER_ENDS), 'off: not asked');
  assert.equal(picked(b.ch().passages.at(-1)).closes, undefined);
  await setHouse({}, SUPER());
  await reset();
  await script([{ text: 'Between them.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'scene', after: b.ch().passages[0].id });
  assert.ok(!(await pageAsk()).includes(prompts.CHAPTER_ENDS), 'between two passages: not asked');
  /* the rest of the chapter: written to its end — it ends it, with no line asked */
  await reset();
  await script([{ text: 'The rest of it.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'chapter' });
  assert.ok(!(await pageAsk()).includes(prompts.CHAPTER_ENDS));
  assert.equal(picked(b.ch().passages.at(-1)).closes, true);
  /* an empty chapter's opening page, at a page's length: not asked; the whole of a chapter at once: it ends it */
  const c = await makeBook([[]]);
  await reset();
  await script([{ text: 'The first page.' }]);
  await writer.writeNext({ novelId: c.novelId, chapterId: c.ids[0], direction: '', length: 'scene' });
  assert.ok(!(await pageAsk()).includes(prompts.CHAPTER_ENDS));
  assert.equal(picked(c.ch().passages[0]).closes, undefined);
  const d = await makeBook([[]]);
  await reset();
  await script([{ text: 'A whole chapter.' }]);
  await writer.writeNext({ novelId: d.novelId, chapterId: d.ids[0], direction: '', length: 'chapter' });
  assert.equal(picked(d.ch().passages[0]).closes, true);
  await setHouse();
  for (const x of [b, c, d]) await putAway(x);
});

await test('the end line is never the story: story written after it stays on the page and the chapter goes on; the writer’s tracking after it comes off and the chapter ends; a page cut short never ends one', async () => {
  await setHouse({}, SUPER());
  const b = await makeBook([['The lamp was cold.']]);
  const more = 'Morning came over the hills and the town woke slowly to the sound of gulls. '.repeat(6).trim();
  await script([{ text: `She closed the door.\n\nEND OF CHAPTER\n\n${more}` }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'scene' });
  let v = picked(b.ch().passages.at(-1));
  assert.equal(v.text, `She closed the door.\n\n${more}`, 'every word of the story kept, the line off');
  assert.equal(v.closes, undefined);
  const story = 'She closed the door behind her and stood a long moment in the dark hallway, listening to the rain against the glass and the far bell of the harbour. Somewhere below, the keeper’s dog turned in its sleep, and the lamp at the top of the stairs went on burning.';
  const pulse = '{PULSE}\n' + 'Mara: tired, worried, alone at the inn, thinking of the letter and of her brother far away. '.repeat(4).trim() + '\n{/PULSE}';
  await reset();
  await script([{ text: `${story}\n\nEND OF CHAPTER\n\n${pulse}` }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'scene' });
  v = picked(b.ch().passages.at(-1));
  assert.equal(v.text, story);
  assert.equal(v.closes, true, 'what followed the line was the writer’s tracking: it ended there');
  await reset();
  await script([{ text: 'She ran for the cliff path.\n\nEND OF CHAPTER', finish: 'length' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'scene' });
  v = picked(b.ch().passages.at(-1));
  assert.equal(v.cut, true);
  assert.equal(v.closes, undefined, 'cut short: it never ends the chapter');
  assert.equal(shape.chapterClosed(b.ch()), false);
  await setHouse();
  await putAway(b);
});

await test('a rewrite of the page that ends a chapter ends it too; another take that does not end it lets the chapter go on', async () => {
  await setHouse({}, SUPER());
  const b = await makeBook([['The lamp was cold.', { text: 'She closed the door.', closes: true }]]);
  assert.equal(shape.chapterClosed(b.ch()), true);
  const pid = b.ch().passages[1].id;
  await script([{ text: 'She shut the door.' }]);
  const r = await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, note: 'Shorter.' });
  assert.equal(r.ok, true, r.error);
  assert.equal(picked(b.ch().passages[1]).text, 'She shut the door.');
  assert.equal(picked(b.ch().passages[1]).closes, true, 'rewritten: it still ends the chapter');
  assert.equal(shape.chapterClosed(b.ch()), true);
  /* another take of a page that ended it, which does not */
  const c = await makeBook([['The lamp was cold.', { text: 'She closed the door.', closes: true }]]);
  await reset();
  await script([{ text: 'She left the door open and went on down.' }]);
  const t = await writer.anotherTake({ novelId: c.novelId, chapterId: c.ids[0], passageId: c.ch().passages[1].id });
  assert.equal(t.ok, true, t.error);
  assert.ok((await pageAsk()).includes(prompts.CHAPTER_ENDS), 'another take of the last page may end it as the page could');
  assert.equal(picked(c.ch().passages[1]).closes, undefined);
  assert.equal(shape.chapterClosed(c.ch()), false, 'the take on show does not end it: the chapter goes on');
  assert.equal(writer.closedGoesOn(c.novelId, c.ids[0]), null);
  await setHouse();
  for (const x of [b, c]) await putAway(x);
});

await test('a scene played where an ended chapter ends goes in as the next chapter’s opening, told so; a scene set before its end goes in where it was set', async () => {
  await setHouse({}, SUPER());
  const b = await makeBook([['The lamp was cold.', { text: 'She closed the door.', closes: true }]]);
  const playId = await talk.newPlay({ novelId: b.novelId, chapterId: b.ids[0], who: 'Mara' });
  await script([{ text: 'The narrator opens on the stair.' }]);
  await talk.playSay({ playId, text: '' });
  const p = store.peek('play', playId);
  assert.equal(writer.setAtEnd(b.ch(), p), true);
  const next = await writer.chapterAfterClose(b.novelId, b.ids[0]);
  assert.ok(next);
  await script([{ text: 'Prose of the stair.' }]);
  const out = await writer.playToProse({ novelId: b.novelId, chapterId: next, play: p, transcript: talk.transcriptOf(p).text });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(store.peek('chapter', next).passages.map((x) => picked(x).text), ['Prose of the stair.']);
  assert.equal(b.ch().passages.length, 2, 'the ended chapter keeps its end');
  const ask = await pageAsk();
  assert.ok(ask.includes('the opening of Chapter Two') && ask.includes('where the chapter before stops') && ask.includes('where the chapter before Chapter Two leaves off'), ask.slice(0, 600));
  /* set before its end: in the middle of the chapter, never sent on */
  const c = await makeBook([['One.', 'Two.', { text: 'Three.', closes: true }]]);
  const id2 = await talk.newPlay({ novelId: c.novelId, chapterId: c.ids[0], who: 'Mara' });
  store.change('play', id2, (d) => { d.after = c.ch().passages[0].id; }, { now: true });
  assert.equal(writer.setAtEnd(c.ch(), store.peek('play', id2)), false);
  await setHouse();
  for (const x of [b, c]) await putAway(x);
});

await test('the bibliography past its share: what the page names, with the book’s facts of it, before any of the rest; then his other entries, then the book’s own names; all of it said only when all of it went', () => {
  const novel = { bibliography: ['Ann', 'Bo'].map((n) => bib.tidyEntry(bib.newEntry({ name: n, kind: 'people', text: `${n.toUpperCase()}-ENTRY ` + 'word '.repeat(200) }))) };
  const base = bib.bibItems(novel, {}, { facts: false });
  const fact = (name, i) => ({ id: `f${name}${i}`, name, fact: `${name} FACT ${i}: ` + 'told '.repeat(20), label: 'Chapter One, passage 1', passageId: 'p1' });
  const ann = { ...base.find((x) => x.name === 'Ann'), facts: [1, 2, 3, 4].map((i) => fact('Ann', i)) };
  const bo = base.find((x) => x.name === 'Bo');
  const cy = { ref: 'n:cy', name: 'Cy', aka: [], kind: 'people', rides: 'named', line: '', text: '', entry: null, card: null, facts: [1, 2].map((i) => fact('Cy', i)), kinds: {} };
  const items = [ann, bo, cy];
  const near = 'Ann waited by the door.';
  const all = bib.ridingItems(items, { near, rest: true, budget: 1e9 });
  assert.deepEqual(all.items.map((x) => x.name), ['Ann', 'Bo', 'Cy'], 'named, his other entry, the book’s own name');
  assert.deepEqual([all.whole, all.allEntries, all.rest, all.left], [true, true, 2, 0]);
  assert.ok(all.words[0].includes('Ann FACT 4'));
  /* room for Ann with every fact of hers, and not for Bo: Bo gives way — never a fact of the one on the page */
  const annFull = bib.ridingItems([ann], { near, budget: 1e9 }).cost;
  const boOwn = bib.ridingItems([bo], { his: 'Bo', budget: 1e9 }).cost;
  const tight = bib.ridingItems(items, { near, rest: true, budget: annFull + boOwn - 1 });
  assert.deepEqual(tight.items.map((x) => x.name), ['Ann', 'Cy'], 'Bo gives way; the book’s two facts of Cy still fit beside');
  assert.ok([1, 2, 3, 4].every((i) => tight.words[0].includes(`Ann FACT ${i}`)), 'every fact of the one on the page');
  assert.deepEqual([tight.whole, tight.allEntries, tight.left], [false, false, 1]);
  /* every entry of his went, the book’s own name did not: no pick is owed, but it is not the whole */
  const mine = bib.ridingItems(items, { near, rest: true, budget: annFull + boOwn + 2 });
  assert.deepEqual(mine.items.map((x) => x.name), ['Ann', 'Bo']);
  assert.deepEqual([mine.whole, mine.allEntries], [false, true]);
  /* without the rest (the checker, the partner): only what is named, whatever the room */
  assert.deepEqual(bib.ridingItems(items, { near, budget: 1e9 }).items.map((x) => x.name), ['Ann']);
});

await test('Super automatic decides each entry page by page: Always is not first — what the page names or needs goes first, an Always entry left out can be picked like any other, Never stays his; off again, Always first as he set it', () => {
  const text = (tag) => `${tag} ` + 'the old oaths of the port and the grey cloaks '.repeat(20);
  const novel = { bibliography: [
    bib.tidyEntry(bib.newEntry({ name: 'The Weave', kind: 'lore', line: 'How magic works', rides: 'always', text: text('WEAVE-ENTRY') })),
    bib.tidyEntry(bib.newEntry({ name: 'Kael', kind: 'people', line: 'A smuggler', text: text('KAEL-ENTRY') })),
    bib.tidyEntry(bib.newEntry({ name: 'Secret', kind: 'lore', line: 'The ending', rides: 'never', text: 'SECRET-ENTRY' })),
  ] };
  const items = bib.bibItems(novel, {}, { facts: false });
  /* room for one of the two, never both */
  const costOf = (name) => bib.ridingItems(items.filter((it) => it.name === name), { his: name, budget: 1e9 }).cost;
  const one = Math.max(costOf('Kael'), costOf('The Weave'));
  assert.ok(costOf('Kael') + costOf('The Weave') > one + 2);
  const args = { his: 'Kael runs for the boats.', rest: true, budget: one + 2 };
  assert.deepEqual(bib.ridingItems(items, args).items.map((x) => x.name), ['The Weave'], 'his setting: Always first, and the page’s own name gives way');
  assert.deepEqual(bib.ridingItems(items, { ...args, byPage: true }).items.map((x) => x.name), ['Kael'], 'page by page: the name the page says first');
  /* the pick: an Always entry the page went without is on its list like any other; Never never is */
  const pick = bib.pickRows(items, { his: 'Kael runs.', rode: new Set([items.find((x) => x.name === 'Kael').ref]), byPage: true });
  assert.deepEqual(pick.rows.map((r) => r.name), ['The Weave']);
  assert.deepEqual(pick.riding.map((x) => x.name), ['Kael']);
  const asSet = bib.pickRows(items, { his: 'Kael runs.', rode: new Set([items.find((x) => x.name === 'Kael').ref]) });
  assert.deepEqual([asSet.rows.length, asSet.riding.map((x) => x.name).sort()], [0, ['Kael', 'The Weave']], 'as he set it: Always is riding, nothing to pick');
});

await test('with Super automatic on the writer’s request and the partner say each entry goes page by page; the partner is never asked to set always — and is, as before, with it off', async () => {
  await setHouse({}, SUPER());
  const b = await makeBook([['The harbour bell rang twice.']], { title: 'Salt and Iron' });
  store.change('novel', b.novelId, shape.novelSteps.putEntry(bib.tidyEntry(bib.newEntry({ name: 'The Weave', kind: 'lore', line: 'How magic works', rides: 'always', text: 'WEAVE ENTRY.' }))), { now: true });
  store.change('novel', b.novelId, shape.novelSteps.putEntry(bib.tidyEntry(bib.newEntry({ name: 'Kael Varro', kind: 'people', line: 'A smuggler', text: 'KAEL ENTRY.' }))), { now: true });
  const frame = (house) => prompts.partnerFrame(house, b.novel());
  const on = frame(store.peek('house', 'house'));
  assert.ok(on.includes('"rides" only as "never", when I ask to keep an entry for myself') && !on.includes('"always" (what every page needs'), 'the partner: page by page');
  assert.ok(on.includes('first when the page names it or needs it'));
  /* the writer: the whole of it goes (it fits), Kael — named — before the Always entry */
  const a = context.assemble({ house: { ...store.peek('house', 'house'), ...CRAFTS_OFF }, novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: { ...CONN, context: 200000, maxTokens: 1000 }, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Kael Varro runs for the boats.' });
  const t = sentOf(a);
  assert.ok(t.includes('KAEL ENTRY.') && t.includes('WEAVE ENTRY.') && t.indexOf('KAEL ENTRY.') < t.indexOf('WEAVE ENTRY.'), 'page by page: the named one first');
  await setHouse();
  const off = frame(store.peek('house', 'house'));
  assert.ok(off.includes('"always" (what every page needs') && !off.includes('"rides" only as "never"'), 'off: as before');
  const a2 = context.assemble({ house: quietHouse(), novel: b.novel(), chapters: { [b.ids[0]]: b.ch() }, conn: { ...CONN, context: 200000, maxTokens: 1000 }, purpose: 'write', target: { chapterId: b.ids[0] }, request: 'Kael Varro runs for the boats.' });
  const t2 = sentOf(a2);
  assert.ok(t2.indexOf('WEAVE ENTRY.') < t2.indexOf('KAEL ENTRY.'), 'off: Always first, as he set it');
  assert.equal(bib.entriesOf(b.novel()).find((e) => e.name === 'The Weave').rides, 'always', 'his setting never changed');
  await putAway(b);
});

heading('his premise kept with the page it wrote (2.12.30)');

await test('the premise he typed stays with its page — through another take and a rewrite, whole as he typed it; Continue, his own words, a scene break: none', async () => {
  await setHouse();
  const b = await makeBook([['The lamp was cold.']]);
  const premise = 'Mara reads the letter twice.\nThen she burns it.';
  await script([{ text: 'A page.' }]);
  const out = await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: premise, length: 'scene' });
  assert.equal(out.ok, true, out.error);
  const pid = b.ch().passages.at(-1).id;
  const p = () => b.ch().passages.find((x) => x.id === pid);
  assert.equal(shape.premiseOf(p()), premise, 'whole, as typed');
  await script([{ text: 'Another page.' }]);
  await writer.anotherTake({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid });
  assert.equal(picked(p()).how, 'another');
  assert.equal(shape.premiseOf(p()), premise, 'another take: the same premise');
  await script([{ text: 'A page, rewritten.' }]);
  await writer.rewrite({ novelId: b.novelId, chapterId: b.ids[0], passageId: pid, note: 'Colder.' });
  assert.equal(picked(p()).how, 'rewrite');
  assert.equal(shape.premiseOf(p()), premise, 'rewritten: the page’s premise still');
  /* Continue with the box empty, his own words, a scene break: nothing of his to show */
  await script([{ text: 'The writer chose.' }]);
  await writer.writeNext({ novelId: b.novelId, chapterId: b.ids[0], direction: '', length: 'scene' });
  assert.equal(shape.premiseOf(b.ch().passages.at(-1)), '');
  writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: 'My own lines.' });
  assert.equal(shape.premiseOf(b.ch().passages.at(-1)), '');
  assert.equal(shape.premiseOf(shape.newPassage('break')), '');
  assert.equal(shape.premiseOf(b.ch().passages[0]), '', 'a page made without a premise');
  await putAway(b);
});

heading('the book held to itself: what a fix quotes, and the chapter read whole (2.12.33)');
const wholeAsks = async () => (await requests()).map((x) => String(x.body.messages.at(-1).content || '')).filter((m) => m.includes(prompts.WHOLE_ASK));
const checkingAsks = async () => (await requests()).map((x) => String(x.body.messages.at(-1).content || '')).filter((m) => m.includes('Check these passages from'));
const unique = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ') + '.';

await test('a continuity fix that quotes the book before it, found there, goes in by itself; one quoting words that are not there, or only after it, or nothing but the notes, waits — each saying why — and the checker is asked where people and things are, words said again and time', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, autoFix: { on: true, from: Date.now() - 1000 } });
  const b = await makeBook([['Mara set the brass key on the kitchen table and sat down by the fire.', 'She stood at the window, the brass key in her pocket, and the lamp was green.']]);
  await reset();
  await script([{ text: JSON.stringify({ edits: [
    { passage: '1.2', kind: 'continuity', find: 'She stood at the window', replace: 'She sat by the fire', why: 'she sat down by the fire', says: 'sat down by the fire' },
    { passage: '1.2', kind: 'continuity', find: 'the brass key in her pocket', replace: 'the brass key on the table', why: 'she left it on the table', says: 'she left the key on the shelf' },
    { passage: '1.2', kind: 'continuity', find: 'the lamp was green', replace: 'the lamp was red', why: 'the notes say red' },
    { passage: '1.1', kind: 'continuity', find: 'on the kitchen table', replace: 'in her pocket', why: 'she has it in her pocket', says: 'the brass key in her pocket' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const [ask] = await checkingAsks();
  assert.ok(ask.includes('what each holds, wears or carries, and in which hand') && ask.includes('words said again (a line remembered, quoted or answered back is the line as it was said)') && ask.includes('and time (what came first, how long ago)'), 'the checker is asked where people and things are, words said again and time');
  assert.ok(ask.includes('For a "continuity" or "seam" fix, "says" is the words of the story before it that the fix holds to') && ask.includes('"kind": "continuity", "find": "…", "replace": "…", "why": "…", "says": "…"'), 'and to quote what a fix holds to');
  assert.equal((await wholeAsks()).length, 0, 'the chapter being written, short: not read whole yet');
  assert.equal(picked(b.ch().passages[1]).text, 'She sat by the fire, the brass key in her pocket, and the lamp was green.', 'the fix that holds to the book went in by itself, on the page');
  const left = checker.suggestions(b.novelId);
  const by = (r) => left.find((x) => x.item.replace === r);
  assert.deepEqual(left.map((x) => x.item.replace).sort(), ['in her pocket', 'the brass key on the table', 'the lamp was red'].sort());
  assert.equal(by('the brass key on the table').item.unheld, 'she left the key on the shelf');
  assert.equal(checker.waitsWhy(b.ids[0], by('the brass key on the table').passageId, by('the brass key on the table').item), 'the words it quotes from the book before it are not there, so it may be wrong');
  assert.equal(checker.waitsWhy(b.ids[0], by('the lamp was red').passageId, by('the lamp was red').item), 'it holds the page to the notes, and the notes may be what is wrong');
  assert.ok(by('in her pocket').item.unheld && !by('in her pocket').item.held, 'words from after the passage are never what it holds to');
  /* the one that went in kept what it held to, as the page says it */
  const v2 = picked(b.ch().passages[1]);
  assert.deepEqual(v2.hands, ['checker']);
  await setHouse();
  await putAway(b);
});

await test('a chapter is read whole once it has ended and every passage in it is checked: one request with the whole chapter, its fix laid beside what each passage’s checking found, put in by itself under Super automatic, the chapter not read again for that — and again, after a while, once his own words change it', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false }, ...SUPER() });
  const b = await makeBook([[
    'She set the cup down on the sill and looked out at the rain.',
    'The wind had come up off the sea.',
    'She turned back to the room, the cup still warm in her hand.',
  ], ['Morning came grey over the cliffs.']]);
  await reset();
  await script([{ whole: true, text: JSON.stringify({ edits: [
    { passage: '1.3', kind: 'continuity', find: 'the cup still warm in her hand', replace: 'the cup cooling on the sill', why: 'she set it down', says: 'She set the cup down on the sill' },
    { passage: '1.9', kind: 'continuity', find: 'x', replace: 'y', why: 'no such passage' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  const asks = await wholeAsks();
  assert.equal(asks.length, 1, 'Chapter One read whole once; Chapter Two, one passage and the one being written, not');
  const a = asks[0];
  assert.ok(a.includes('Chapter One, whole — each passage numbered as it is on the page:') && a.includes('[1.1] She set the cup down') && a.includes('[1.2] The wind') && a.includes('[1.3] She turned back'), a.slice(-3000));
  assert.ok(a.includes('who holds, wears or carries what') || a.includes('what each holds, wears or carries, and in which hand'), 'where people and things are');
  assert.ok(a.includes('never the earlier words to fit one later line') && a.includes('Never change what happens'), 'never the story');
  assert.ok(!a.includes('Check these passages from') && !a.includes('Morning came grey'), 'its own ask, and nothing after the chapter');
  const c = b.ch();
  assert.equal(picked(c.passages[2]).text, 'She turned back to the room, the cup cooling on the sill.', 'put in by itself, on the page');
  assert.equal(c.wholeRead.sig, checker.wholeSig(c), 'read as it stands: its own fix going in never asks for another read');
  assert.equal(c.wholeRead.n, 1);
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, 0, 'nothing changed: not read again');
  /* his own edit of the first passage: read again — once it is checked, and not within ten minutes of the last */
  const p1 = c.passages[0];
  inplace.changeInPlace({ novelId: b.novelId, chapterId: b.ids[0], passageId: p1.id, versionId: picked(p1).id, next: 'She set the cup down on the sill and looked out at the dark rain.', by: 'you' });
  await checker.runCheck(b.novelId);
  assert.equal((await checkingAsks()).length, 1, 'his words checked');
  assert.equal((await wholeAsks()).length, 0, 'not read whole again so soon');
  const due = checker.forTests().wholeDue(b.novelId);
  assert.ok(due && due.wait > 9 * 60000 && due.wait <= 10 * 60000, JSON.stringify(due));
  store.change('chapter', b.ids[0], (x) => { x.wholeRead.at -= 11 * 60000; }, { now: true });
  await reset();
  await checker.runCheck(b.novelId);
  const again = await wholeAsks();
  assert.equal(again.length, 1, 'read whole again once the while is over');
  assert.ok(again[0].includes('[1.1] She set the cup down on the sill and looked out at the dark rain.') && again[0].includes('the cup cooling on the sill'), 'as it stands now');
  assert.equal(b.ch().wholeRead.n, 2, 'twice that day');
  await setHouse();
  await putAway(b);
});

await test('without its fixes going in by themselves, what the chapter read whole found waits like any suggestion — what it holds to and where it was found said on its card; never over a fix already there, never one he left, never on a passage changed since', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([[
    'She set the cup down on the sill and looked out at the rain.',
    'The wind had come up off the sea.',
    'She turned back to the room, the cup still warm in her hand.',
  ], ['Morning came grey over the cliffs.']]);
  await reset();
  await script([
    { text: JSON.stringify({ edits: [{ passage: '1.3', kind: 'grammar', find: 'warm in her hand', replace: 'warm in her hands', why: 'both hands' }] }) },
    { whole: true, text: JSON.stringify({ edits: [
      { passage: '1.3', kind: 'continuity', find: 'the cup still warm in her hand', replace: 'the cup cooling on the sill', why: 'she set it down', says: 'She set the cup down on the sill' },
      { passage: '1.2', kind: 'seam', find: 'The wind had come up', replace: 'Outside, the wind had come up', why: 'she was looking out', says: 'looked out at the rain' },
    ] }) },
  ]);
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, 1);
  const list = checker.suggestions(b.novelId);
  assert.deepEqual(list.map((x) => [x.number, x.item.kind, x.item.replace]), [[2, 'seam', 'Outside, the wind had come up'], [3, 'grammar', 'warm in her hands']], 'the one over the grammar fix’s words is not laid beside it');
  const seam = list[0].item;
  assert.deepEqual([seam.whole, seam.held], [true, 'looked out at the rain']);
  assert.equal(picked(b.ch().passages[1]).text, 'The wind had come up off the sea.', 'nothing changed by itself');
  /* he leaves it — and his edit of the chapter has it read whole again: not offered again */
  checker.leaveOne(b.ids[0], list[0].passageId, seam.id);
  const p3 = b.ch().passages[2];
  inplace.changeInPlace({ novelId: b.novelId, chapterId: b.ids[0], passageId: p3.id, versionId: picked(p3).id, next: 'She turned back to the room at last, the cup still warm in her hand.', by: 'you' });
  store.change('chapter', b.ids[0], (x) => { x.wholeRead.at -= 11 * 60000; }, { now: true });
  await reset();
  await script([{ whole: true, text: JSON.stringify({ edits: [
    { passage: '1.2', kind: 'seam', find: 'The wind had come up', replace: 'Outside, the wind had come up', why: 'she was looking out', says: 'looked out at the rain' },
  ] }) }]);
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, 1, 'read whole again');
  assert.ok(!checker.suggestions(b.novelId).some((x) => x.item.kind === 'seam'), 'what he left stays left');
  await setHouse();
  await putAway(b);
});

await test('the chapter being written is read whole when he asks (Check this chapter), and by itself once it has grown by four thousand words since — not before; a chapter longer than its model holds is read in parts, each told the chapter up to it', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara climbed the stairs.', 'The lamp room was cold.']]);
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, 0, 'the chapter being written, short: not by itself');
  assert.equal(checker.wholeOwed(b.novelId, b.ids[0]), true, 'Check this chapter offers it');
  checker.checkChapter(b.novelId, b.ids[0]);
  assert.equal(b.ch().wholeAsked, true);
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, 1, 'asked: read whole');
  assert.equal(b.ch().wholeAsked, undefined, 'and his asking answered');
  assert.equal(checker.wholeOwed(b.novelId, b.ids[0]), false);
  /* it grows: three long pages of his — past four thousand words since — read whole once the while is over, in parts */
  for (const tag of ['a', 'b', 'c']) writer.addMine({ novelId: b.novelId, chapterId: b.ids[0], text: unique(tag, 3000) });
  await reset();
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, 0, 'within the while after the last read');
  store.change('chapter', b.ids[0], (x) => { x.wholeRead.at -= 11 * 60000; }, { now: true });
  await reset();
  await checker.runCheck(b.novelId);
  const parts = await wholeAsks();
  assert.ok(parts.length >= 2, `in parts (${parts.length})`);
  assert.ok(parts[0].includes(`Chapter One, part 1 of ${parts.length}`) && parts[0].includes('[1.1] Mara climbed the stairs.'), parts[0].slice(-600));
  const last = parts.at(-1);
  assert.ok(last.includes(`Chapter One, part ${parts.length} of ${parts.length}`) && last.includes('Chapter One up to these passages, as it stands:'), 'the next part is told the chapter up to it');
  assert.ok(last.includes('c2999.'), 'the last words read');
  assert.equal(b.ch().wholeRead.sig, checker.wholeSig(b.ch()));
  await setHouse();
  await putAway(b);
});

await test('a chapter its model will not read whole is let be after two tries until its words change — never asked in a loop — and a passing fault is waited out', async () => {
  await setHouse({}, { checksFrom: 0, judge: { on: false } });
  const b = await makeBook([['Mara climbed the stairs.', 'The lamp room was cold.'], ['Morning.']]);
  await reset();
  await script([1, 2, 3, 4].map(() => ({ whole: true, status: 503, message: 'overloaded' })));
  await checker.runCheck(b.novelId);
  const t = checker.forTests();
  const key = `${b.ids[0]}:${checker.wholeSig(b.ch())}`;
  assert.ok(t.wholeWait.get(key) && t.wholeWait.get(key).until > Date.now(), 'a passing fault: waited out');
  const due = t.wholeDue(b.novelId);
  assert.ok(due && due.wait > 0, JSON.stringify(due));
  assert.equal(b.ch().wholeRead, undefined, 'not marked read');
  /* its model answers, but never this: twice, and the chapter is let be */
  t.wholeWait.clear();
  await reset();
  await script([1, 2, 3, 4, 5, 6].map(() => ({ whole: true, text: 'I would rather not read this one.' })));
  await checker.runCheck(b.novelId);
  assert.equal(b.ch().wholeRead, undefined, 'once: tried again on a later look');
  assert.equal(t.wholeMiss.get(`${b.ids[0]}:${checker.wholeSig(b.ch())}`), 1);
  await checker.runCheck(b.novelId);
  assert.ok(b.ch().wholeRead && b.ch().wholeRead.missed && b.ch().wholeRead.sig === checker.wholeSig(b.ch()), JSON.stringify(b.ch().wholeRead));
  const asked = (await wholeAsks()).length;
  assert.ok(asked >= 2, String(asked));
  await checker.runCheck(b.novelId);
  assert.equal((await wholeAsks()).length, asked, 'never asked in a loop');
  assert.equal(checker.wholeOwed(b.novelId, b.ids[0]), false, 'and not offered while its words stand');
  await setHouse();
  await putAway(b);
});

/* ------------------------------------------------------------ done */
console.log(`\napp: ${passed} passed, ${failed} failed`);
done(failed ? 1 : 0);
