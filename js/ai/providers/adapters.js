import { requestFeatures } from "../../connections/features.js";
import { assert } from "../../core/schema.js";
const SAFE_CODES = new Set([
  "invalid_credentials",
  "permission_denied",
  "unknown_model",
  "rate_limited",
  "quota_restricted",
  "unsupported_parameter",
  "unsupported_endpoint",
  "invalid_request",
  "provider_error",
  "connection_unavailable",
  "connection_changed",
  "local_service_unavailable",
  "dns_failure",
  "tls_failure",
  "timeout",
  "key_needed",
  "stream_error",
  "server_error",
  "rate_limit_exceeded",
]);
const safeCode = (value, fallback) =>
  SAFE_CODES.has(value) ? value : fallback;
const SAFE_PARAMETERS = new Set([
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "presence_penalty",
  "frequency_penalty",
  "repetition_penalty",
  "seed",
  "stop",
  "thinking",
  "reasoning",
  "reasoning_effort",
  "response_format",
  "prefix",
]);
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
  for (const key of [
    "inputPrice",
    "outputPrice",
    "cachedPrice",
    "cacheWritePrice",
  ])
    if (c[key] != null)
      assert(
        typeof c[key] === "number" && Number.isFinite(c[key]) && c[key] >= 0,
        "Prices must be finite nonnegative numbers or left unknown.",
      );
  if (c.reasoningReserve != null)
    assert(
      Number.isSafeInteger(c.reasoningReserve) && c.reasoningReserve >= 0,
      "Use a nonnegative integer reasoning reserve.",
    );
  return c;
}
export function serialize(c, { system, user, outputLimit, kind }) {
  const features = requestFeatures(c, {
    outputLimit,
    helper: ["analysis", "eventProposal", "recall"].includes(kind),
  });
  if (c.prefillBanned && features.prefill.sent)
    system +=
      "\nExclude these phrases from new prose: " +
      JSON.stringify(c.prefillBanned.split("\n").filter(Boolean));
  const p = { model: c.model, stream: true, ...features.wire };
  let messages = [{ role: "user", content: user }];
  if (features.prefill.sent && !features.prefill.structured)
    messages.push({
      role: "assistant",
      content: c.prefillMode === "thinking" ? "" : c.prefill,
      ...(c.prefillMode === "thinking" ? { reasoning_content: c.prefill } : {}),
      ...(c.capabilities?.prefix ? { prefix: true } : {}),
    });
  if (c.adapter === "responses")
    return {
      ...p,
      instructions: system,
      input: [{ role: "user", content: [{ type: "input_text", text: user }] }],
      max_output_tokens: outputLimit,
      store: false,
    };
  if (c.adapter === "anthropic")
    return {
      ...p,
      system:
        c.promptCache && c.capabilities?.promptCache
          ? [
              {
                type: "text",
                text: system,
                cache_control: { type: "ephemeral" },
              },
            ]
          : system,
      messages,
      max_tokens: outputLimit,
    };
  return {
    ...p,
    messages: [{ role: "system", content: system }, ...messages],
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
    throw Object.assign(
      new Error("The provider sent a malformed streaming event."),
      { code: "malformed_response" },
    );
  }
  if (d.error || event.event === "error")
    return {
      error: "The provider reported an error during generation.",
      code: safeCode(d.error?.code || d.error?.type, "stream_error"),
    };
  if (adapter === "responses") {
    if (d.type === "response.reasoning_summary_text.delta")
      return { reasoning: typeof d.delta === "string" ? d.delta : "" };
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
    if (d.type === "content_block_delta" && d.delta?.type === "thinking_delta")
      return { reasoning: d.delta.thinking || "" };
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
    reasoning:
      typeof choice?.delta?.reasoning_content === "string"
        ? choice.delta.reasoning_content
        : typeof choice?.delta?.reasoning === "string"
          ? choice.delta.reasoning
          : "",
    finishReason: choice?.finish_reason,
  };
}
export async function consumeStream(response, adapter, onDelta, signal) {
  if (!response.ok) {
    let diagnostic;
    try {
      diagnostic = await response.json();
    } catch {}
    const code =
      safeCode(diagnostic?.code, null) ||
      {
        401: "invalid_credentials",
        403: "permission_denied",
        404: "unknown_model",
        429: "rate_limited",
      }[response.status] ||
      "provider_error";
    const safeMessages = {
      invalid_credentials: "Provider authentication failed. Reenter the key.",
      permission_denied: "Provider permission denied.",
      unknown_model: "Model or endpoint not found.",
      rate_limited: "Provider rate limited this request.",
    };
    throw Object.assign(
      new Error(
        response.url &&
        new URL(response.url).origin === globalThis.location?.origin &&
        diagnostic?.error
          ? diagnostic.error
          : safeMessages[code] ||
            "Provider returned HTTP " + response.status + ".",
      ),
      {
        code,
        status: response.status,
        parameter: SAFE_PARAMETERS.has(diagnostic?.parameter)
          ? diagnostic.parameter
          : null,
      },
    );
  }
  assert(response.body, "The provider returned no stream.");
  let done = false,
    finishReason = null,
    usage = {},
    text = "",
    reasoning = "";
  try {
    for await (const event of sseEvents(response.body)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const n = normalize(adapter, event);
      if (n.text) {
        text += n.text;
        await onDelta(n.text);
      }
      if (n.reasoning) reasoning += n.reasoning;
      if (n.usage) usage = { ...usage, ...n.usage };
      if (n.finishReason) finishReason = n.finishReason;
      if (n.error)
        throw Object.assign(new Error(n.error), {
          code: n.code || (n.refusal ? "provider_refusal" : "stream_error"),
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
    return { text, usage, finishReason, reasoning };
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
