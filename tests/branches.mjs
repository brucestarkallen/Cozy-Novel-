/* Story branches: pure continuity checks and saves on an isolated server.
 * No model calls, no existing library, no paid connection. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBranch, remapBranchData } from '../js/novel/branches.js';
import { sigOf } from '../js/novel/readings.js';
import { assemble } from '../js/novel/context.js';

let passed = 0, failed = 0, serial = 0;
const copy = (value) => JSON.parse(JSON.stringify(value));
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
const rowsOf = (result, kind) => result.records.filter((r) => r.kind === kind).map((r) => r.data);
const novelOf = (result) => rowsOf(result, 'novel')[0];
const options = (extra = {}) => ({ novelId: 'n-source', name: 'The other road', makeId: (prefix) => `${prefix}-new-${++serial}`, at: 500, ...extra });

function fixture() {
  const passage = (id, text) => ({ id, by: 'ai', pick: 0, versions: [{ id: 'v-' + id, text, at: 10, how: 'write', sent: 'sent-' + id, ask: { direction: 'Keep n-source and ch-one exactly as written.' } }] });
  const p1 = passage('p-one', 'Mara waited by the gate.');
  const p2 = passage('p-two', 'FUTURE: Mara crossed the sea.');
  const p3 = passage('p-three', 'FUTURE: Mara became queen.');
  p1.versions[0].continuity = { schema: 1, events: [{ id: 'event-one', cards: ['person-mara'], text: 'Mara waits at the gate.' }] };
  const card = (now, at) => ({ id: 'person-mara', name: 'Mara', about: 'A traveler.', now, nowAt: at === 3 ? 'ch-two' : 'ch-one', nowPid: at === 3 ? 'p-three' : at === 2 ? 'p-two' : 'p-one', updated: { at, chapterId: at === 3 ? 'ch-two' : 'ch-one' } });
  const c1 = card('At the gate.', 1), c2 = card('FUTURE: across the sea.', 2), c3 = card('FUTURE: queen.', 3);
  const reading = (p, before, after, at) => ({ sig: sigOf(p.versions[0]), mode: 'new', cards: [{ kind: 'people', id: 'person-mara', before, after }], kept: {}, covers: [p.id], at });
  const novel = { id: 'n-source', meta: { title: 'A road through dusk', words: 99, chapters: 2, created: 1, archived: true },
    brief: 'My exact premise n-source.', style: 'My exact style.', plans: 'My exact plans.', auto: { about: true, style: true }, kept: { about: { text: 'FUTURE: the queen’s whole journey.', by: 'you' } },
    order: ['ch-one', 'ch-two'], plays: ['pl-source'], prefs: { at: 'ch-two', length: 'scene' },
    notes: { people: [c3], places: [], lore: [], threads: [] },
    memory: { seen: { 'ch-one': { 'p-one': sigOf(p1.versions[0]), 'p-two': sigOf(p2.versions[0]) }, 'ch-two': { 'p-three': sigOf(p3.versions[0]) } },
      readings: { 'p-one': { 'v-p-one': reading(p1, null, c1, 1) }, 'p-two': { 'v-p-two': reading(p2, c1, c2, 2) }, 'p-three': { 'v-p-three': reading(p3, c2, c3, 3) } },
      aside: { 'summary:ch-two': { chapterId: 'ch-two' } }, audit: { verdict: 'FUTURE: all held true.' }, undo: { cards: [{ after: c3 }] }, removed: [] } };
  const chapter1 = { id: 'ch-one', novelId: novel.id, name: 'The gate', passages: [p1, p2], summary: { text: 'FUTURE: the sea crossing.' }, summaries: [{ text: 'FUTURE: an old sea crossing.' }],
    checks: { 'p-one': { 'v-p-one': { findings: [{ text: 'Gate.' }] } }, 'p-two': { 'v-p-two': { findings: [{ text: 'FUTURE.' }] } } }, checksLeft: { 'p-one': ['keep this'], 'p-two': ['leave future'] }, duels: { one: { pid: 'p-one' }, two: { pid: 'p-two' } }, retired: [] };
  const chapter2 = { id: 'ch-two', novelId: novel.id, name: 'The crown', passages: [p3], summary: { text: 'FUTURE: the crown.' }, retired: [] };
  const turn = (id, text, by = 'ai') => ({ id, by, pick: 0, versions: [{ id: 'v-' + id, text, sent: 'sent-' + id, changes: [{ id: 'change-' + id, status: 'made', undo: { what: 'chapter', chapterId: 'ch-one', before: { name: 'The gate' }, after: 'Another name' } }] }] });
  const talk = { id: novel.id, novelId: novel.id, convId: 'cv-one', name: 'A conversation', turns: [turn('t-one', 'First answer.'), turn('t-two', 'FUTURE: discuss the crown.')], convs: [{ id: 'cv-two', name: 'A second talk', turns: [turn('t-other', 'Another answer.')] }] };
  const play = { id: 'pl-source', novelId: novel.id, chapterId: 'ch-one', after: 'p-one', from: 'My scene premise.', who: 'Mara', turned: null,
    turns: [turn('a-one', 'The gate opens.\n\n[CHOICES]\n1. Wait.\n2. Go.\n3. Ask.\n[/CHOICES]'), turn('u-two', 'I enter.', 'you'), turn('a-two', 'FUTURE: the sea takes her.')] };
  const draft = { id: novel.id, novelId: novel.id, direction: 'My unsent page.', cards: { 'n-source:people:person-mara': { about: 'My unsent card.' } },
    composers: { 'talk:n-source:cv-one': { value: 'My partner words.', tell: '' }, 'talk:n-source:cv-two': { value: 'Other partner words.' }, 'play:pl-source': { value: 'My move.', tell: 'My narrator line.', tellOpen: true } } };
  return { generation: 1, records: [['novel', novel], ['chapter', chapter1], ['chapter', chapter2], ['talk', talk], ['play', play], ['draft', draft]].map(([kind, data]) => ({ kind, id: data.id, rev: 1, data })) };
}

await test('a whole branch owns every record, keeps paid history, and changes no authored words', () => {
  const source = fixture(), before = copy(source);
  const result = buildBranch(source, options());
  const novel = novelOf(result), chapters = rowsOf(result, 'chapter'), play = rowsOf(result, 'play')[0], draft = rowsOf(result, 'draft')[0];
  assert.notEqual(novel.id, 'n-source'); assert.equal(novel.meta.title, before.records[0].data.meta.title);
  assert.deepEqual(novel.order, chapters.map((c) => c.id)); assert.deepEqual(novel.plays, [play.id]);
  assert.equal(play.chapterId, chapters[0].id); assert.equal(novel.prefs.at, chapters[1].id);
  assert.equal(novel.notes.people[0].nowAt, chapters[1].id);
  assert.equal(novel.notes.people[0].updated.chapterId, chapters[1].id);
  assert.ok(novel.memory.seen[chapters[0].id]['p-one']); assert.ok(novel.memory.aside['summary:' + chapters[1].id]);
  assert.equal(chapters[0].passages[0].versions[0].ask.direction, 'Keep n-source and ch-one exactly as written.');
  assert.equal(chapters[0].passages[0].versions[0].sent, 'sent-p-one');
  assert.deepEqual(chapters[0].passages[0].versions[0].continuity, before.records[1].data.passages[0].versions[0].continuity);
  assert.ok(draft.composers[`talk:${novel.id}:cv-one`]); assert.ok(draft.composers['play:' + play.id]);
  assert.ok(draft.cards[`${novel.id}:people:person-mara`]);
  for (const talk of rowsOf(result, 'talk')) for (const conversation of [talk, ...talk.convs]) for (const t of conversation.turns) {
    assert.equal(t.versions[0].changes[0].copied, true); assert.equal(t.versions[0].changes[0].undo.chapterId, chapters[0].id);
  }
  assert.equal(novel.branch.rootId, 'n-source'); assert.equal(novel.branch.fromId, 'n-source');
  assert.equal(novel.meta.archived, false); assert.equal(result.notesRebuild, false);
  assert.deepEqual(source, before);
});

await test('a passage branch removes its future from prose, notes, summaries, talks and drafts', () => {
  const result = buildBranch(fixture(), options({ chapterId: 'ch-one', through: 'p-one' }));
  const novel = novelOf(result), chapter = rowsOf(result, 'chapter')[0];
  assert.equal(result.early, true); assert.equal(novel.order.length, 1);
  assert.deepEqual(chapter.passages.map((p) => p.id), ['p-one']);
  assert.equal(novel.notes.people[0].now, 'At the gate.'); assert.deepEqual(novel.kept, {});
  assert.equal(chapter.summary, null); assert.deepEqual(chapter.summaries, []);
  assert.deepEqual(Object.keys(chapter.checks), ['p-one']); assert.deepEqual(Object.keys(chapter.duels), ['one']);
  assert.deepEqual(Object.keys(novel.memory.readings), ['p-one']);
  assert.equal(novel.memory.audit, undefined); assert.equal(novel.memory.undo, null);
  assert.deepEqual(rowsOf(result, 'talk'), []); assert.deepEqual(rowsOf(result, 'play'), []); assert.deepEqual(rowsOf(result, 'draft'), []);
  assert.equal(novel.branch.point.through, 'p-one'); assert.equal(novel.branch.point.chapterId, 'ch-one');
  const request = assemble({ house: { instructions: {}, modules: {} }, novel, chapters: { [chapter.id]: chapter }, conn: { model: 'stand-in', context: 32000 }, purpose: 'write', target: { chapterId: chapter.id }, request: 'Continue.' });
  assert.ok(!JSON.stringify(request).includes('FUTURE:'), 'future words must never enter a branch request');
});

await test('a reading spanning the branch point is undone and retained passages become unread', () => {
  const source = fixture(), novel = source.records[0].data;
  const shared = copy(novel.memory.readings['p-two']['v-p-two']);
  shared.covers = ['p-one', 'p-two']; shared.cards[0].before = null;
  novel.memory.readings['p-two']['v-p-two'] = shared;
  novel.memory.readings['p-one']['v-p-one'] = { sig: novel.memory.seen['ch-one']['p-one'], in: { pid: 'p-two', vid: 'v-p-two', sig: shared.sig } };
  const result = buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' })), branch = novelOf(result);
  assert.equal(result.notesRebuild, true); assert.deepEqual(branch.notes.people, []);
  assert.deepEqual(branch.memory.seen[result.chapterId], {}); assert.deepEqual(branch.memory.readings, {});
});

await test('missing readings keep only explicit card fields and cannot keep the other future', () => {
  const source = fixture(), novel = source.records[0].data;
  novel.memory.readings = {};
  novel.notes.people.push({ id: 'manual', name: 'My character', about: 'My exact words.', now: 'FUTURE: knows the queen.', since: 'FUTURE: aftermath.', updated: { by: 'you', his: ['about'], at: 9 } });
  const result = buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' })), branch = novelOf(result);
  assert.equal(result.notesRebuild, true); assert.equal(branch.notes.people.length, 1);
  assert.equal(branch.notes.people[0].about, 'My exact words.'); assert.equal(branch.notes.people[0].now, undefined); assert.equal(branch.notes.people[0].since, undefined);
  assert.deepEqual(branch.memory.seen, {}); assert.deepEqual(branch.kept, {});
  assert.equal(branch.brief, novel.brief); assert.equal(branch.style, novel.style); assert.equal(branch.plans, novel.plans);
});

await test('cards edited in one field do not preserve helper-written future fields after a clean rollback', () => {
  const source = fixture(), novel = source.records[0].data;
  novel.notes.people[0].updated = { by: 'you', his: ['about'], at: 10 };
  novel.notes.people[0].about = 'My correction.';
  const branch = novelOf(buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' })));
  assert.equal(branch.notes.people[0].about, 'My correction.'); assert.equal(branch.notes.people[0].now, undefined);
});

await test('legacy or imported notes without current readings cannot leak a later outcome', () => {
  const source = fixture(), novel = source.records[0].data;
  novel.memory = { seen: {}, readings: {} };
  const result = buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' }));
  assert.equal(result.notesRebuild, true); assert.deepEqual(novelOf(result).notes.people, []);
  /* A historical reading not currently marked read is not a checkpoint
   * for today's notes, even when it happens to have the same card. */
  novel.memory.readings = fixture().records[0].data.memory.readings;
  assert.deepEqual(novelOf(buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' }))).notes.people, []);
});

await test('partially authored cards recover earlier names without inheriting a future revealed identity', () => {
  const source = fixture(), novel = source.records[0].data;
  const card = novel.notes.people[0]; card.name = 'FUTURE: Queen Mara'; card.about = 'My own description.'; card.updated = { by: 'you', his: ['about'] };
  const result = buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' }));
  assert.equal(novelOf(result).notes.people[0].name, 'Mara'); assert.equal(novelOf(result).notes.people[0].about, 'My own description.');
  novel.memory = { seen: {}, readings: {} };
  const legacy = novelOf(buildBranch(source, options({ chapterId: 'ch-one', through: 'p-one' })));
  assert.equal(legacy.notes.people[0].name, 'A person in your notes'); assert.equal(legacy.notes.people[0].about, 'My own description.');
});

await test('a scene branch cuts original conversion prose and keeps the chosen telling and draft', () => {
  const source = fixture(), chapter = source.records.find((r) => r.id === 'ch-one').data, play = source.records.find((r) => r.kind === 'play').data;
  chapter.passages[1].versions[0].ask.play = play.id; play.after = 'p-two'; play.turned = 'a-two';
  const result = buildBranch(source, options({ playId: play.id, turnId: 'a-one' }));
  const scene = rowsOf(result, 'play')[0], copiedChapter = rowsOf(result, 'chapter')[0], draft = rowsOf(result, 'draft')[0];
  assert.deepEqual(copiedChapter.passages.map((p) => p.id), ['p-one']);
  assert.deepEqual(scene.turns.map((t) => t.id), ['a-one']); assert.equal(scene.turned, null); assert.equal(scene.after, 'p-one');
  assert.equal(scene.chapterId, copiedChapter.id); assert.equal(scene.from, play.from);
  assert.ok(scene.turns[0].versions[0].text.includes('[CHOICES]'), 'choices remain part of the saved telling, not story prose');
  assert.deepEqual(Object.keys(draft.composers), ['play:' + scene.id]); assert.equal(draft.direction, undefined);
  assert.deepEqual(rowsOf(result, 'talk'), []); assert.equal(result.playId, scene.id);
});

await test('a branch from an old partner answer keeps the current book and only that talk prefix', () => {
  const source = fixture();
  const result = buildBranch(source, options({ conversationId: 'cv-one', conversationTurnId: 't-one' }));
  const novel = novelOf(result), talk = rowsOf(result, 'talk')[0];
  assert.equal(novel.order.length, 2); assert.equal(novel.notes.people[0].now, 'FUTURE: queen.');
  assert.deepEqual(talk.turns.map((t) => t.id), ['t-one']); assert.deepEqual(talk.convs, []);
  assert.equal(result.conversationId, 'cv-one'); assert.equal(talk.turns[0].versions[0].changes[0].copied, true);
  assert.equal(novel.branch.point.kind, 'conversation');
  const draft = rowsOf(result, 'draft')[0]; assert.ok(draft.composers[`talk:${novel.id}:cv-one`]); assert.equal(draft.composers[`talk:${novel.id}:cv-two`], undefined);
});

await test('legacy conversation drafts follow the copied conversation identity', () => {
  const source = fixture(), talk = source.records.find((r) => r.kind === 'talk').data, draft = source.records.find((r) => r.kind === 'draft').data;
  delete talk.convId; draft.composers['talk:n-source:current'] = draft.composers['talk:n-source:cv-one']; delete draft.composers['talk:n-source:cv-one'];
  const result = buildBranch(source, options({ conversationId: 'current', conversationTurnId: 't-one' }));
  assert.ok(rowsOf(result, 'draft')[0].composers[`talk:${result.novelId}:${result.conversationId}`]);
});

await test('branch ancestry stays in the source family and structural imports leave prose verbatim', () => {
  const source = fixture(); source.records[0].data.branch = { rootId: 'n-grandparent', fromId: 'n-parent', name: 'Earlier' };
  const result = buildBranch(source, options()); assert.equal(novelOf(result).branch.rootId, 'n-grandparent'); assert.equal(novelOf(result).branch.fromId, 'n-source');
  const mapped = remapBranchData({ id: 'n-source', text: 'ch-one', brief: 'n-source', since: 'ch-one', from: 'ch-one', before: 'ch-one', after: 'ch-one', prefs: { at: 'ch-one' }, branch: { rootId: 'n-source', point: { chapterId: 'ch-one' } }, memory: { aside: { 'out:chapter:ch-one': { chapterId: 'ch-one' } } } }, new Map([['n-source', 'n-copy'], ['ch-one', 'ch-copy']]));
  for (const field of ['text', 'since', 'from', 'before', 'after']) assert.equal(mapped[field], 'ch-one');
  assert.equal(mapped.brief, 'n-source'); assert.equal(mapped.id, 'n-copy'); assert.equal(mapped.prefs.at, 'ch-copy');
  assert.equal(mapped.branch.rootId, 'n-copy'); assert.equal(mapped.branch.point.chapterId, 'ch-copy'); assert.ok(mapped.memory.aside['out:chapter:ch-copy']);
  assert.equal(novelOf(buildBranch(source, options({ name: 'B'.repeat(120) }))).branch.name, 'B'.repeat(120));
});

await test('missing chapters, missing anchors and unfinished work never produce a partial branch', () => {
  const source = fixture();
  assert.throws(() => buildBranch(source, options({ chapterId: 'ch-one', through: 'missing' })), /not there/);
  assert.throws(() => buildBranch({ records: source.records.filter((r) => r.id !== 'ch-two') }, options()), /could not be read/);
  const streaming = copy(source); streaming.records.find((r) => r.kind === 'talk').data.convs[0].turns[0].versions[0].streaming = true;
  assert.throws(() => buildBranch(streaming, options()), /still being written/);
  const partial = copy(source); partial.records[0].data.memory.inParts = { at: 1 };
  assert.throws(() => buildBranch(partial, options()), /still reading/);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.COZY_BRANCHES_PORT || 21772), BASE = `http://127.0.0.1:${PORT}`;
const home = mkdtempSync(path.join(os.tmpdir(), 'cozy-branches-'));
const server = spawn('python3', [path.join(ROOT, 'serve.py')], { env: { ...process.env, COZYNOVEL_HOME: home, COZYNOVEL_PORT: String(PORT) }, stdio: 'ignore' });
const realFetch = globalThis.fetch;
let intercept = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = async (method, url, body, headers = {}) => {
  const response = await realFetch(BASE + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
};
globalThis.fetch = async (url, init = {}) => (intercept && await intercept(String(url), init)) || realFetch(typeof url === 'string' && url.startsWith('/') ? BASE + url : url, init);
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await realFetch(BASE + '/api/version')).ok) break; } catch (_) {}
    if (attempt > 100) throw new Error('The isolated branch server did not start'); await sleep(50);
  }
  const store = await import('../js/store.js');
  const { branchStory } = await import('../js/novel/branching.js');
  const source = fixture();
  for (const record of [...source.records.filter((r) => r.kind !== 'novel'), ...source.records.filter((r) => r.kind === 'novel')]) await store.create(record.kind, record.id, record.data);
  await store.keepSent('n-source', 'sent-p-one', { messages: [{ content: 'The exact paid request.' }] });

  await test('the service keeps pending source edits and sent words in a complete independent book', async () => {
    store.change('chapter', 'ch-one', (chapter) => { chapter.passages[0].versions[0].text = 'My newest saved line.'; });
    const result = await branchStory({ novelId: 'n-source', name: 'A saved fork' }); assert.equal(result.ok, true, result.error);
    const novel = store.peek('novel', result.novelId);
    const chapter = await store.open('chapter', novel.order[0]); assert.equal(chapter.passages[0].versions[0].text, 'My newest saved line.');
    const sent = await request('GET', `/api/sent/${result.novelId}/sent-p-one`); assert.equal(sent.status, 200); assert.ok(JSON.stringify(sent.data).includes('The exact paid request.'));
    store.change('chapter', chapter.id, (c) => { c.passages[0].versions[0].text = 'Only in the branch.'; }); await store.flush('chapter', chapter.id);
    assert.equal(store.peek('chapter', 'ch-one').passages[0].versions[0].text, 'My newest saved line.');
  });

  await test('an acknowledgement lost after commit retries one branch and opens subsequent edits', async () => {
    let first = true, target, attempts = 0;
    intercept = async (url, init) => {
      if (url !== '/api/branches' || init.method !== 'POST') return null;
      attempts++; if (!first) return null; first = false;
      const response = await realFetch(BASE + url, init); assert.equal(response.status, 200); const saved = await response.json(); target = saved.novelId;
      const standing = await request('GET', `/api/store/novel/${target}`); standing.data.data.meta.subtitle = 'Edited after creation.';
      assert.equal((await request('PUT', `/api/store/novel/${target}`, { data: standing.data.data }, { 'X-Base': String(standing.data.rev) })).status, 200);
      throw new Error('Synthetic lost acknowledgement');
    };
    try {
      const result = await branchStory({ novelId: 'n-source', name: 'The lost reply' }); assert.equal(result.ok, true, result.error); assert.equal(result.novelId, target); assert.equal(attempts, 2);
      assert.equal(store.peek('novel', target).meta.subtitle, 'Edited after creation.');
      const shelf = await request('GET', '/api/novels'); assert.equal(shelf.data.novels.filter((n) => n.branch?.name === 'The lost reply').length, 1);
    } finally { intercept = null; }
  });

  await test('an uncertain operation is reused when its two acknowledgements were lost', async () => {
    let target;
    intercept = async (url, init) => {
      if (url !== '/api/branches' || init.method !== 'POST') return null;
      const response = await realFetch(BASE + url, init); const result = await response.json(); assert.equal(response.status, 200); target = result.novelId;
      throw new Error('Synthetic unavailable acknowledgement');
    };
    const params = { novelId: 'n-source', name: 'Twice lost' };
    try { const result = await branchStory(params); assert.equal(result.ok, false); assert.equal(result.uncertain, true); }
    finally { intercept = null; }
    const recovered = await branchStory(params); assert.equal(recovered.ok, true, recovered.error); assert.equal(recovered.novelId, target);
  });

  await test('a changed source refuses the branch without publishing any of its records', async () => {
    let target;
    intercept = async (url, init) => {
      if (url !== '/api/branches' || init.method !== 'POST') return null;
      target = JSON.parse(init.body).requestId;
      const current = await request('GET', '/api/store/novel/n-source'); current.data.data.meta.subtitle = 'Changed in another window.';
      await request('PUT', '/api/store/novel/n-source', { data: current.data.data }, { 'X-Base': String(current.data.rev) });
      return null;
    };
    try { const result = await branchStory({ novelId: 'n-source', name: 'The racing change' }); assert.equal(result.ok, false); assert.match(result.error, /changed|again/i); }
    finally { intercept = null; }
    assert.equal((await request('GET', `/api/store/novel/${target}`)).data.data, null);
    const backup = await request('GET', '/api/backup'); assert.ok(!backup.data.records.some((r) => r.data.novelId === target));
  });

  await test('a destination removed after commit is reported as removed instead of ready to open', async () => {
    let target;
    intercept = async (url, init) => {
      if (url !== '/api/branches' || init.method !== 'POST') return null;
      const response = await realFetch(BASE + url, init); const saved = await response.clone().json(); target = saved.novelId;
      assert.equal(response.status, 200); await request('DELETE', `/api/store/novel/${target}`); return response;
    };
    try {
      const result = await branchStory({ novelId: 'n-source', name: 'Removed before opening' });
      assert.equal(result.ok, false); assert.equal(result.saved, true); assert.match(result.error, /removed or replaced/);
    } finally { intercept = null; }
    assert.equal((await request('GET', `/api/store/novel/${target}`)).data.data, null);
  });

  await test('a whole-copy restore while opening prevents a jump even when it preserves the target IDs', async () => {
    let target;
    intercept = async (url, init) => {
      if (url !== '/api/branches' || init.method !== 'POST') return null;
      const response = await realFetch(BASE + url, init); const saved = await response.clone().json(); target = saved.novelId;
      assert.equal(response.status, 200);
      const backup = await request('GET', '/api/backup');
      assert.equal((await request('POST', '/api/restore', backup.data)).status, 200);
      return response;
    };
    try {
      const result = await branchStory({ novelId: 'n-source', name: 'Restored while opening' });
      assert.equal(result.ok, false); assert.equal(result.saved, true); assert.match(result.error, /whole copy was brought back/);
    } finally { intercept = null; }
    assert.equal((await request('GET', `/api/store/novel/${target}`)).data.data.id, target, 'the restored records remain untouched');
  });

  await test('a source deleted while copying cannot be resurrected by the branch request', async () => {
    let target;
    intercept = async (url, init) => {
      if (url !== '/api/branches' || init.method !== 'POST') return null;
      target = JSON.parse(init.body).requestId; await request('DELETE', '/api/store/novel/n-source'); return null;
    };
    try { const result = await branchStory({ novelId: 'n-source', name: 'The deleted source' }); assert.equal(result.ok, false); }
    finally { intercept = null; }
    assert.equal((await request('GET', `/api/store/novel/${target}`)).data.data, null);
    assert.equal((await request('GET', '/api/store/novel/n-source')).data.data, null);
    const shelf = await request('GET', '/api/novels'); assert.ok(shelf.data.novels.length >= 3, 'independent successful branches survive source deletion');
  });
} catch (error) { failed++; console.error(error.stack); }
finally {
  globalThis.fetch = realFetch; server.kill('SIGTERM'); await sleep(100); rmSync(home, { recursive: true, force: true });
}
console.log(`\n${passed} branch checks passed; ${failed} failed.`);
process.exit(failed ? 1 : 0);
