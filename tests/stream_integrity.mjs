/* Actual call decoding with local, scripted fetch responses. No credentials or models. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ask, finalWords, snapshotBody } from '../js/model/call.js';

const base = { url: 'https://example.test/v1', model: 'fixture', prefillFlagField: 'prefix' };
const realFetch = globalThis.fetch;
const bytes = new TextEncoder();
function fixture(deltas, { stop = false, fail = false, signal } = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const delta of deltas) controller.enqueue(bytes.encode('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n'));
      if (stop) signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      else if (fail) {
        controller.enqueue(bytes.encode('data: ' + JSON.stringify({ error: { message: 'The connection broke.', code: 503 } }) + '\n\n'));
        controller.close();
      } else {
        controller.enqueue(bytes.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'));
        controller.close();
      }
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}
async function run(conn, deltas, options = {}) {
  const abort = new AbortController();
  let streamed = '', thoughts = '';
  globalThis.fetch = async (url, init) => url === '/api/usage' ? new Response('{}') : fixture(deltas, { ...options, signal: init.signal });
  try {
    const out = await ask({ ...base, ...conn }, { messages: [{ role: 'user', content: 'Carry on.' }], signal: abort.signal,
      onText: s => { streamed += s; if (options.stop) queueMicrotask(() => abort.abort()); },
      onThinking: s => { thoughts += s; },
    });
    return { out, streamed, thoughts };
  } finally { globalThis.fetch = realFetch; }
}

test('an echoed prose opening is not doubled at any stream boundary', async () => {
  const opening = 'The lantern keeper';
  const answer = opening + ' smiled at the small brave dragon.';
  for (let cut = 1; cut <= opening.length; cut++) {
    const { out, streamed } = await run({ prefill: opening + ' ' }, [{ content: answer.slice(0, cut) }, { content: answer.slice(cut) }]);
    assert.equal(out.text, answer, 'split at ' + cut);
    assert.equal(streamed, answer);
  }
});
test('an echoed thinking seed is not doubled across deltas', async () => {
  const seed = 'Hulk remembers the tiny dragon';
  const thought = seed + ' likes its tea warm.';
  const { out, thoughts } = await run({ prefill: '<think>' + seed }, [...thought].map(reasoning_content => ({ reasoning_content })).concat({ content: 'The kettle hummed.' }));
  assert.equal(out.thinking, thought);
  assert.equal(thoughts, thought);
  assert.equal(out.text, 'The kettle hummed.');
});
test('a continuation that only shares the opening’s first letters retains every word', async () => {
  const { out, streamed } = await run({ prefill: 'The lantern ' }, [{ content: 'T' }, { content: 'houghtful faces waited.' }]);
  assert.equal(out.text, 'The lantern Thoughtful faces waited.');
  assert.equal(streamed, out.text);
});
test('an echo cut inside the opening stays partial without inventing the unsent remainder', async () => {
  const { out, streamed } = await run({ prefill: 'The lantern keeper ' }, [{ content: 'The lant' }], { fail: true });
  assert.equal(out.text, 'The lant');
  assert.equal(streamed, out.text);
  assert.equal(out.cut, true);
});
test('a stopped answer containing only a late closing thought stays out of the prose', async () => {
  const { out, streamed } = await run({}, [{ content: 'Thinking about the next gentle moment.</think>' }], { stop: true });
  assert.equal(out.stopped, true);
  assert.equal(out.text, '');
  assert.match(out.thinking, /next gentle moment/);
  assert.equal(finalWords(out, streamed), '', 'the authoritative empty prose wins over the raw stream');
  assert.equal(finalWords(undefined, 'A recovered fragment.'), 'A recovered fragment.');
});
test('the kept request is an independent copy of all nested message blocks', () => {
  const body = { messages: [{ role: 'system', content: [{ type: 'text', text: 'Keep these words.', cache_control: { type: 'ephemeral' } }] }], stop: ['END'] };
  const kept = snapshotBody(body);
  body.messages[0].content[0].text = 'A changed direction.';
  body.messages[0].content[0].cache_control.type = 'changed';
  body.stop.push('OTHER');
  assert.deepEqual(kept, { messages: [{ role: 'system', content: [{ type: 'text', text: 'Keep these words.', cache_control: { type: 'ephemeral' } }] }], stop: ['END'] });
});
