/* Imported branch families keep their own addresses and every authored word.
 * Pure synthetic records: no server, providers or existing books. */
import assert from 'node:assert/strict';
import { booksFromLibrary } from '../js/novel/files.js';
import { continuityOf, timelineOf } from '../js/novel/timeline.js';
import { hashText } from '../js/util.js';

let passed = 0;
function test(name, run) { run(); passed++; console.log('ok   ' + name); }
const rec = (kind, data) => ({ kind, id: data.id, data });
function fixture() {
  const text = 'Mara named the locked room ch-old and hid the letter from Tom.';
  const notes = { people: [{ id: 'mara', name: 'Mara', about: 'n-old is written on her key.', since: 'She remembers ch-old.' }, { id: 'tom', name: 'Tom' }], threads: [] };
  const continuity = continuityOf([{ kind: 'relationship', cards: [{ kind: 'people', name: 'Mara' }, { kind: 'people', name: 'Tom' }], text: 'Mara conceals the letter.', why: 'She locks it inside ch-old.', evidence: [text], stance: 'fact' }], notes, { text });
  const version = { id: 'v1', text, continuity, ask: { play: 'pl-old', direction: 'Keep n-old and ch-old exactly.' } };
  return { records: [
    rec('novel', { id: 'n-old', meta: { title: 'The n-old book' }, order: ['ch-old'], plays: ['pl-old'], notes,
      prefs: { at: 'ch-old' }, memory: { seen: { 'ch-old': { p1: 'v1:' + hashText(text) } }, aside: { 'summary:ch-old': 'Keep n-old.', 'out:chapter:ch-old': true }, readings: {} } }),
    rec('chapter', { id: 'ch-old', novelId: 'n-old', passages: [{ id: 'p1', by: 'you', pick: 'v1', versions: [version] }] }),
    rec('play', { id: 'pl-old', novelId: 'n-old', chapterId: 'ch-old', from: 'Enter ch-old.', turns: [] }),
    rec('talk', { id: 'n-old', novelId: 'n-old', turns: [{ id: 't1', versions: [{ id: 'tv1', text: 'The room is ch-old.', changes: [{ undo: { chapterId: 'ch-old', before: 'ch-old', after: 'n-old' } }] }] }] }),
    rec('draft', { id: 'n-old', novelId: 'n-old', direction: 'ch-old', play: { 'pl-old': 'Knock on ch-old.' }, composers: { 'talk:n-old:conv': { value: '  n-old  ' }, 'play:pl-old': { value: 'pl-old' } } }),
  ] };
}

test('literal IDs in authored prose, notes, requests and drafts survive import byte for byte', () => {
  const snap = fixture(), before = JSON.stringify(snap), [b] = booksFromLibrary(snap), ch = b.chapters[b.novel.order[0]];
  assert.notEqual(b.novel.id, 'n-old'); assert.notEqual(ch.id, 'ch-old');
  assert.equal(ch.passages[0].versions[0].text, snap.records[1].data.passages[0].versions[0].text);
  assert.equal(b.novel.meta.title, 'The n-old book');
  assert.deepEqual(b.novel.notes, snap.records[0].data.notes);
  assert.equal(b.plays[0].from, 'Enter ch-old.');
  assert.equal(ch.passages[0].versions[0].ask.direction, 'Keep n-old and ch-old exactly.');
  assert.equal(b.talk.turns[0].versions[0].text, 'The room is ch-old.');
  assert.equal(b.draft.direction, 'ch-old');
  assert.equal(b.draft.composers[`talk:${b.novel.id}:conv`].value, '  n-old  ');
  assert.equal(b.draft.composers[`play:${b.plays[0].id}`].value, 'pl-old');
  assert.equal(JSON.stringify(snap), before, 'import never mutates its backup');
});
test('paid readings, source addresses, aside keys and conversation Undo point at imported records', () => {
  const [b] = booksFromLibrary(fixture()), cid = b.novel.order[0], ch = b.chapters[cid];
  assert.equal(b.novel.prefs.at, cid);
  assert.ok(b.novel.memory.seen[cid].p1);
  assert.equal(b.novel.memory.aside[`summary:${cid}`], 'Keep n-old.');
  assert.equal(b.novel.memory.aside[`out:chapter:${cid}`], true);
  assert.equal(ch.novelId, b.novel.id);
  assert.equal(ch.passages[0].versions[0].ask.play, b.plays[0].id);
  assert.equal(b.plays[0].chapterId, cid);
  assert.equal(b.draft.play[b.plays[0].id], 'Knock on ch-old.');
  const change = b.talk.turns[0].versions[0].changes[0];
  assert.equal(change.undo.chapterId, cid); assert.equal(change.undo.before, 'ch-old'); assert.equal(change.undo.after, 'n-old');
  assert.equal(change.copied, undefined, 'a backup keeps its own actionable changes');
});
test('Timeline evidence stays valid and jumps to the imported chapter', () => {
  const [b] = booksFromLibrary(fixture()), out = timelineOf(b.novel, b.chapters);
  assert.equal(out.coverage.complete, true); assert.equal(out.events.length, 1);
  assert.equal(out.events[0].chapterId, b.novel.order[0]);
  assert.equal(out.events[0].why, 'She locks it inside ch-old.');
  assert.ok(out.events[0].evidence[0].includes('ch-old'));
});
test('a family imported together shares its new original and remaps its source point', () => {
  const snap = fixture();
  snap.records.push(rec('novel', { id: 'n-child', meta: { title: 'Alternative' }, order: ['ch-child'], plays: [], branch: { rootId: 'n-old', fromId: 'n-old', name: 'Leave ch-old closed', point: { kind: 'scene', chapterId: 'ch-old', playId: 'pl-old', through: 'p1' } } }), rec('chapter', { id: 'ch-child', novelId: 'n-child', passages: [] }));
  const [parent, child] = booksFromLibrary(snap);
  assert.equal(child.novel.branch.rootId, parent.novel.id); assert.equal(child.novel.branch.fromId, parent.novel.id);
  assert.equal(child.novel.branch.point.chapterId, parent.novel.order[0]); assert.equal(child.novel.branch.point.playId, parent.plays[0].id);
  assert.equal(child.novel.branch.point.through, 'p1'); assert.equal(child.novel.branch.name, 'Leave ch-old closed');
  assert.equal(child.chapters[child.novel.order[0]].novelId, child.novel.id);
});
test('a missing original stays missing; imported siblings get a fresh shared family', () => {
  const records = ['a', 'b'].map(id => rec('novel', { id: 'n-' + id, meta: { title: id }, order: [], plays: [], branch: { rootId: 'n-absent', fromId: 'n-absent', point: { chapterId: 'ch-absent' } } }));
  const imported = booksFromLibrary({ records }), again = booksFromLibrary({ records });
  assert.notEqual(imported[0].novel.branch.rootId, 'n-absent');
  assert.equal(imported[0].novel.branch.rootId, imported[1].novel.branch.rootId);
  assert.equal(imported[0].novel.branch.fromId, imported[0].novel.branch.rootId);
  assert.equal(imported[0].novel.branch.point.chapterId, imported[1].novel.branch.point.chapterId);
  assert.notEqual(imported[0].novel.branch.point.chapterId, 'ch-absent');
  assert.notEqual(imported[0].novel.branch.rootId, again[0].novel.branch.rootId);
  assert.ok(imported.every(b => b.novel.id !== b.novel.branch.rootId));
});

test('conflicting chapter or scene owners are rejected before returning any imported books', () => {
  for (const field of ['order', 'plays']) {
    const snap = fixture(), original = snap.records[0].data;
    snap.records.push(rec('novel', { id: 'n-another', meta: { title: 'Another' }, order: [], plays: [], [field]: [...original[field]] }));
    const before = JSON.stringify(snap);
    assert.throws(() => booksFromLibrary(snap), /conflicting owners/);
    assert.equal(JSON.stringify(snap), before);
  }
  const snap = fixture(); snap.records[1].data.novelId = 'n-unrelated';
  assert.throws(() => booksFromLibrary(snap), /conflicting owners/);
});
test('duplicate records and colliding book/page addresses cannot produce shared imported records', () => {
  const snap = fixture(); snap.records.push(structuredClone(snap.records[1]));
  assert.throws(() => booksFromLibrary(snap), /conflicting owners/);
  const collision = fixture(); collision.records[0].data.order = ['n-old'];
  collision.records[1].id = collision.records[1].data.id = 'n-old';
  assert.throws(() => booksFromLibrary(collision), /conflicting owners/);
});

console.log(`\n${passed} passed`);
