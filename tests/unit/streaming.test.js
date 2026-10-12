import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeStream,
  normalize,
  serialize,
} from "../../js/ai/providers/adapters.js";
function response(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (i >= bytes.length) {
          c.close();
          return;
        }
        c.enqueue(bytes.slice(i, i + size));
        i += size;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const data = (x) => "data: " + JSON.stringify(x) + "\r\n\r\n";
test("Chat streaming preserves split UTF8, comments, empty deltas and usage only chunks", async () => {
  const stream =
    ": alive\n\n" +
    data({ choices: [{ delta: { content: "雨☕ café" } }] }) +
    data({ choices: [{ delta: {} }] }) +
    data({ choices: [], usage: { prompt_tokens: 13, completion_tokens: 4 } }) +
    data({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
    "data: [DONE]\n\n";
  let text = "";
  const r = await consumeStream(response(stream), "chat", (d) => {
    text += d;
  });
  assert.equal(text, "雨☕ café");
  assert.equal(r.usage.prompt_tokens, 13);
  assert.equal(r.finishReason, "stop");
});
test("Responses excludes reasoning and requires a valid completion object", async () => {
  let text = "";
  const r = await consumeStream(
    response(
      data({
        type: "response.reasoning_summary_text.delta",
        delta: "PRIVATE REASONING",
      }) +
        data({ type: "response.output_text.delta", delta: "Prose" }) +
        data({
          type: "response.completed",
          response: { usage: { input_tokens: 9, output_tokens: 2 } },
        }),
      7,
    ),
    "responses",
    (d) => (text += d),
  );
  assert.equal(text, "Prose");
  assert.equal(r.usage.input_tokens, 9);
  assert.throws(
    () =>
      normalize("responses", {
        data: JSON.stringify({ type: "response.completed" }),
      }),
    /Malformed/,
  );
});
test("Anthropic event dialect keeps usage and output limit", async () => {
  const r = await consumeStream(
    response(
      data({
        type: "message_start",
        message: { usage: { input_tokens: 12 } },
      }) +
        data({
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hidden" },
        }) +
        data({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "hello" },
        }) +
        data({
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 2 },
        }) +
        data({ type: "message_stop" }),
      10000,
    ),
    "anthropic",
    () => {},
  );
  assert.equal(r.text, "hello");
  assert.equal(r.finishReason, "max_tokens");
  assert.deepEqual(r.usage, { input_tokens: 12, output_tokens: 2 });
});
test("errors after text, refusals, malformed events and disconnect retain honest status", async () => {
  for (const tail of [
    data({ error: { code: "upstream" } }),
    "data: {bad}\n\n",
    "",
    data({ choices: [{ delta: { refusal: "No" } }] }),
  ]) {
    let kept = "";
    await assert.rejects(
      consumeStream(
        response(data({ choices: [{ delta: { content: "partial" } }] }) + tail),
        "openrouter",
        (d) => (kept += d),
      ),
      (e) => e.partialText === "partial",
    );
    assert.equal(kept, "partial");
  }
});
test("abort preserves partial text", async () => {
  const ctrl = new AbortController();
  let calls = 0;
  await assert.rejects(
    consumeStream(
      response(
        data({ choices: [{ delta: { content: "first" } }] }) +
          data({ choices: [{ delta: { content: "second" } }] }) +
          "data: [DONE]\n\n",
      ),
      "chat",
      () => {
        if (++calls === 1) ctrl.abort();
      },
      ctrl.signal,
    ),
    (e) => e.name === "AbortError" && e.partialText === "first",
  );
});
test("parameters are explicitly gated and requests are stateless", () => {
  for (const adapter of ["responses", "chat", "anthropic", "openrouter"]) {
    const p = serialize(
      {
        adapter,
        model: "test",
        parameters: { temperature: 0.1, reasoning: "high" },
        capabilities: {},
      },
      { system: "sys", user: "usr", outputLimit: 200 },
    );
    assert.equal(p.temperature, undefined);
    assert.equal(p.previous_response_id, undefined);
    assert.equal(p.conversation, undefined);
    if (adapter === "responses") assert.equal(p.store, false);
  }
});

test("Chat output limit survives the final DONE marker", async () => {
  const r = await consumeStream(
    response(
      data({
        choices: [{ delta: { content: "short" }, finish_reason: "length" }],
      }) + "data: [DONE]\n\n",
    ),
    "chat",
    () => {},
  );
  assert.equal(r.finishReason, "length");
});
