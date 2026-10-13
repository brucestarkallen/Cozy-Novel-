import { configurationIdentity } from "./presets.js";
import { serialize, consumeStream } from "../ai/providers/adapters.js";
import { decodeStructured, prefillPlan } from "./features.js";
const directSecrets = new Map();
export function rememberDirect(id, key, endpoint) {
  if (key) directSecrets.set(id, { key, origin: new URL(endpoint).origin });
}
export function forgetDirect(id) {
  directSecrets.delete(id);
}
export function directHasKey(id, endpoint) {
  const entry = directSecrets.get(id);
  return !!entry && (!endpoint || entry.origin === new URL(endpoint).origin);
}
export function directURL(c, models = false) {
  const u = new URL(c.endpoint);
  if (
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !["https:", "http:"].includes(u.protocol)
  )
    throw new Error("Invalid direct destination.");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if ((u.protocol !== "https:" || local) && !(c.allowLocal && local))
    throw new Error(
      "Browser direct requests require HTTPS or explicit loopback permission.",
    );
  if (models) {
    const next = u.pathname.replace(
      /\/(chat\/completions|messages|responses)$/,
      "/models",
    );
    if (next === u.pathname)
      throw new Error("Model discovery needs a compatible models endpoint.");
    u.pathname = next;
  }
  return u;
}
export async function providerFetch(
  device,
  c,
  payload,
  { signal, requestId, models = false } = {},
) {
  if (c.transport === "direct") {
    const entry = directSecrets.get(c.id),
      key = entry?.origin === new URL(c.endpoint).origin ? entry.key : null;
    if (!key && !c.allowLocal)
      throw Object.assign(
        new Error(
          "API key needed for browser direct mode. It is held only in this page memory.",
        ),
        { code: "key_needed" },
      );
    const headers = { "Content-Type": "application/json" };
    if (c.adapter === "anthropic")
      Object.assign(headers, {
        "x-api-key": key || "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      });
    else if (key) headers.Authorization = "Bearer " + key;
    try {
      return await fetch(directURL(c, models), {
        method: models ? "GET" : "POST",
        headers,
        body: models ? undefined : JSON.stringify(payload),
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      throw Object.assign(
        new Error(
          "Browser direct request failed. Check connectivity and provider CORS permission. The browser does not disclose which one failed.",
        ),
        { code: "browser_transport" },
      );
    }
  }
  if (!device.token)
    throw Object.assign(
      new Error("Local service unavailable. Start Cozy Novel, then reconnect."),
      { code: "local_service_unavailable" },
    );
  return fetch(new URL("api/novel/generate", document.baseURI), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-CozyNovel-Session": device.token,
    },
    body: JSON.stringify({
      connectionId: c.id,
      profileVersion: c.profileVersion,
      endpointIdentity: c.endpoint,
      adapter: c.adapter,
      requestId,
      request: payload,
    }),
  });
}
export async function consumeOutput(
  response,
  c,
  onDelta,
  signal,
  { helper = false } = {},
) {
  const pf = prefillPlan(c, helper);
  if (pf.structured) {
    const result = await consumeStream(response, c.adapter, () => {}, signal);
    try {
      result.text = decodeStructured(result.text, c);
    } catch (e) {
      e.rawOutput = result.text;
      e.partialText = "";
      throw e;
    }
    await onDelta(result.text);
    return { ...result, prefill: pf.note };
  }
  let first = true;
  const result = await consumeStream(
    response,
    c.adapter,
    async (delta) => {
      if (first) {
        first = false;
        if (pf.opening && !delta.startsWith(pf.opening))
          await onDelta(pf.opening);
      }
      await onDelta(delta);
    },
    signal,
  );
  if (pf.opening && !result.text.startsWith(pf.opening))
    result.text = pf.opening + result.text;
  return { ...result, prefill: pf.note };
}
export async function testConnection(device, c, { prefill = false } = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000),
    start = performance.now();
  try {
    const profile = prefill ? c : { ...c, prefillMode: "off", searchOn: false };
    const context = {
      system: "This is a connection test. Reply with a short greeting.",
      user: "Reply with one brief sentence.",
      outputLimit: Math.min(
        c.outputLimit,
        Math.max(64, Number(c.thinkingBudget || 0) + 128),
      ),
      kind: "test",
    };
    const result = await consumeOutput(
      await providerFetch(device, profile, serialize(profile, context), {
        signal: controller.signal,
        requestId: crypto.randomUUID(),
      }),
      profile,
      () => {},
      controller.signal,
    );
    if (!result.text || !["stop", "end_turn"].includes(result.finishReason))
      throw new Error(
        "The provider did not complete the connection test. " +
          result.finishReason,
      );
    return {
      ok: true,
      configurationIdentity: configurationIdentity(c),
      at: new Date().toISOString(),
      durationMs: Math.round(performance.now() - start),
      model: c.model,
      endpoint: c.endpoint,
      adapter: c.adapter,
      usage: result.usage,
      finishReason: result.finishReason,
      prefill: result.prefill,
    };
  } finally {
    clearTimeout(timer);
  }
}
