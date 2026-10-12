import { assert } from "../../core/schema.js";
export const ADAPTERS = ["responses", "chat", "anthropic", "openrouter"];
export function validateConnection(c) {
  assert(ADAPTERS.includes(c.adapter), "Choose a supported adapter.");
  assert(c.model?.trim(), "Enter a model identifier.");
  const u = new URL(c.endpoint);
  assert(
    ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search,
    "Use a full provider endpoint without credentials, a query, or a fragment.",
  );
  assert(
    Number.isFinite(Number(c.contextLimit)) &&
      Number.isFinite(Number(c.outputLimit)),
    "Invalid context limits.",
  );
  return c;
}
export function serialize(c, { system, user, outputLimit }) {
  const p = { model: c.model, stream: true };
  if (c.capabilities?.temperature && c.parameters?.temperature != null)
    p.temperature = Number(c.parameters.temperature);
  if (c.capabilities?.top_p && c.parameters?.top_p != null)
    p.top_p = Number(c.parameters.top_p);
  if (c.adapter === "responses") {
    return {
      ...p,
      instructions: system,
      input: [{ role: "user", content: [{ type: "input_text", text: user }] }],
      max_output_tokens: outputLimit,
      store: false,
      ...(c.capabilities?.reasoning && c.parameters?.reasoning
        ? { reasoning: { effort: c.parameters.reasoning } }
        : {}),
    };
  }
  if (c.adapter === "anthropic")
    return {
      ...p,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: outputLimit,
    };
  return {
    ...p,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    [c.capabilities?.maxCompletionTokens
      ? "max_completion_tokens"
      : "max_tokens"]: outputLimit,
    ...(c.capabilities?.usage
      ? { stream_options: { include_usage: true } }
      : {}),
    ...(c.capabilities?.storage ? { store: false } : {}),
  };
}
/** An incremental SSE decoder. Bytes can divide both UTF8 characters and delimiters. */
export async function* sseEvents(stream) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let m;
      while ((m = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        let event = "message";
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:"))
            data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) yield { event, data: data.join("\n") };
      }
      if (done) {
        assert(
          !buffer.trim() || buffer.trim().startsWith(":"),
          "The provider stream ended inside an event.",
        );
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function normalize(adapter, event) {
  if (event.data === "[DONE]") return { done: true };
  let d;
  try {
    d = JSON.parse(event.data);
  } catch {
    throw new Error("The provider sent a malformed streaming event.");
  }
  if (d.error || event.event === "error")
    return {
      error: "The provider reported an error during generation.",
      code: d.error?.code || d.error?.type || "stream_error",
    };
  if (adapter === "responses") {
    if (d.type === "response.output_text.delta")
      return { text: typeof d.delta === "string" ? d.delta : "" };
    if (
      d.type === "response.refusal.delta" ||
      d.type === "response.refusal.done"
    )
      return { refusal: true, error: "The provider declined this request." };
    if (
      ["response.completed", "response.incomplete", "response.failed"].includes(
        d.type,
      )
    ) {
      assert(
        d.response && typeof d.response === "object",
        "Malformed completed response.",
      );
      return {
        done: true,
        usage: d.response.usage,
        finishReason:
          d.type === "response.completed"
            ? "stop"
            : d.response.incomplete_details?.reason || "failed",
        error:
          d.type === "response.failed"
            ? "The provider failed to complete the response."
            : null,
      };
    }
    return {};
  }
  if (adapter === "anthropic") {
    if (d.type === "message_start") return { usage: d.message?.usage };
    if (d.type === "content_block_delta" && d.delta?.type === "text_delta")
      return { text: d.delta.text || "" };
    if (d.type === "message_delta") {
      if (d.delta?.stop_reason === "refusal")
        return { error: "The provider declined this request.", refusal: true };
      return { usage: d.usage, finishReason: d.delta?.stop_reason };
    }
    if (d.type === "message_stop") return { done: true };
    return {};
  }
  const choice = d.choices?.[0];
  if (["content_filter", "error"].includes(choice?.finish_reason))
    return {
      error:
        choice.finish_reason === "content_filter"
          ? "The provider declined this request."
          : "The provider reported an error during generation.",
      refusal: choice.finish_reason === "content_filter",
    };
  if (choice?.delta?.refusal)
    return { refusal: true, error: "The provider declined this request." };
  return {
    text:
      typeof choice?.delta?.content === "string" ? choice.delta.content : "",
    usage: d.usage,
    finishReason: choice?.finish_reason,
  };
}
export async function consumeStream(response, adapter, onDelta, signal) {
  assert(
    response.ok,
    "The provider request failed with HTTP " +
      response.status +
      ". Check the connection and quota.",
  );
  assert(response.body, "The provider returned no stream.");
  let done = false,
    finishReason = null,
    usage = {},
    text = "";
  try {
    for await (const event of sseEvents(response.body)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const n = normalize(adapter, event);
      if (n.text) {
        text += n.text;
        await onDelta(n.text);
      }
      if (n.usage) usage = { ...usage, ...n.usage };
      if (n.finishReason) finishReason = n.finishReason;
      if (n.error)
        throw Object.assign(new Error(n.error), {
          code: n.code,
          refusal: n.refusal,
        });
      if (n.done) {
        done = true;
        if (!finishReason) finishReason = "stop";
        break;
      }
    }
    assert(
      done,
      "The provider disconnected before confirming completion. Partial text has been preserved.",
    );
    return { text, usage, finishReason };
  } catch (e) {
    e.partialText = text;
    e.usage = usage;
    e.finishReason =
      e.name === "AbortError"
        ? "cancelled"
        : e.refusal
          ? "refusal"
          : "interrupted";
    throw e;
  }
}
