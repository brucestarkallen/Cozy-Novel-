/* Search bounds and responsiveness, without a provider or existing books. */
import assert from 'node:assert/strict';
import test from 'node:test';
const channel = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = undefined;
const { searchBook, searchBookAsync, findIn } = await import('../js/novel/search.js');
globalThis.BroadcastChannel = channel;

const passage = (id, text) => ({ id, by: 'you', pick: 0, versions: [{ id: 'v-' + id, text }] });
function book(passages) {
  return { novel: { id: 'n-perf', order: ['ch-perf'], notes: {}, plays: [] },
    chapters: { 'ch-perf': { id: 'ch-perf', passages } } };
}

test('a full result limit stops before reading unrelated later text', () => {
  let laterReads = 0;
  const later = Array.from({ length: 800 }, (_, i) => {
    const p = passage('later-' + i, '');
    Object.defineProperty(p.versions[0], 'text', { get() { laterReads++; return 'Unused later prose. '.repeat(500); } });
    return p;
  });
  const b = book([passage('first', 'lamp '.repeat(200)), ...later]);
  const found = searchBook({ ...b, query: 'lamp', limit: 100 });
  assert.equal(found.length, 100); assert.ok(found.every(f => f.passageId === 'first'));
  assert.equal(laterReads, 0, 'the already full search does not fold the rest of the novel');
  assert.deepEqual(searchBook({ ...b, query: 'lamp', limit: 0 }), []);
  assert.equal(laterReads, 0);
});

test('yielding search keeps the same ordered snippets and source links as synchronous search', async () => {
  const b = book(Array.from({ length: 80 }, (_, i) => passage('p' + i, `Mara found a lamp in room ${i}.`)));
  b.novel.notes.people = [{ id: 'mara', name: 'Mara', about: 'She guards the lamp.' }];
  b.novel.brief = 'A lost lamp.';
  b.talk = { turns: [passage('talk1', 'Where is the lamp?')] };
  b.plays = [{ id: 'scene1', who: 'Mara', turns: [passage('turn1', 'I take the lamp.')] }];
  const options = { ...b, query: 'lamp', limit: 300 };
  assert.deepEqual(await searchBookAsync(options), searchBook(options));
  assert.deepEqual(await searchBookAsync({ ...options, limit: 3 }), searchBook({ ...options, limit: 3 }));
});

test('a newer query or closed sheet cancels before scanning the rest of a long book', async () => {
  let active = true, read = 0;
  const list = Array.from({ length: 1000 }, (_, i) => {
    const p = passage('p' + i, '');
    Object.defineProperty(p.versions[0], 'text', { get() { read++; return `The quiet room ${i}.`; } });
    return p;
  });
  const searching = searchBookAsync({ ...book(list), query: 'absent words' }, () => active);
  setTimeout(() => { active = false; }, 0);
  assert.equal(await searching, null);
  assert.ok(read > 0 && read < 1000, `only the early batch was read: ${read}`);
});

test('long searches give pending input tasks a turn even when every record is already cached', async () => {
  const options = { ...book(Array.from({ length: 1000 }, (_, i) => passage('p' + i, `A quiet cached room ${i}.`))), query: 'not here' };
  searchBook(options);
  let taskRan = false;
  const searching = searchBookAsync(options);
  setTimeout(() => { taskRan = true; }, 0);
  assert.deepEqual(await searching, []);
  assert.equal(taskRan, true);
});

test('cache turnover preserves Unicode quote boundaries and original character positions', () => {
  const text = '“Éowyn — wait…” She nodded. 中文没有空格。';
  const expected = findIn(text, 'eowyn - wait...');
  for (let i = 0; i < 180; i++) findIn(`${i}: ` + 'The shore. '.repeat(1000), 'shore');
  assert.deepEqual(findIn(text, 'eowyn - wait...'), expected);
  assert.equal(text.slice(expected[0].start, expected[0].end), 'Éowyn — wait…');
});
