// Independently owned provider starting points. Model availability is discovered or tested, never assumed.
export const PRESETS = [
  {
    id: "claude",
    label: "Claude",
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    reasoningStyle: "anthropic",
    caps: ["temperature", "top_p", "top_k", "reasoning", "web", "promptCache"],
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "responses",
    baseUrl: "https://api.openai.com/v1",
    reasoningStyle: "openai",
    caps: ["reasoning", "web"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoningStyle: "openrouter",
    caps: [
      "temperature",
      "top_p",
      "top_k",
      "min_p",
      "presence_penalty",
      "frequency_penalty",
      "repetition_penalty",
      "seed",
      "stop",
      "reasoning",
      "usage",
      "structured",
      "web",
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    adapter: "chat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    reasoningStyle: "gemini",
    caps: ["temperature", "top_p", "reasoning", "usage"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    adapter: "chat",
    baseUrl: "https://api.deepseek.com/v1",
    reasoningStyle: "deepseek",
    caps: [
      "temperature",
      "top_p",
      "presence_penalty",
      "frequency_penalty",
      "stop",
      "reasoning",
      "usage",
    ],
  },
  {
    id: "zai",
    label: "Z.ai GLM",
    adapter: "chat",
    baseUrl: "https://api.z.ai/api/paas/v4",
    reasoningStyle: "zai",
    caps: ["temperature", "top_p", "stop", "reasoning", "usage"],
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    adapter: "chat",
    baseUrl: "http://127.0.0.1:8642/v1",
    reasoningStyle: "hermes",
    allowLocal: true,
    caps: [
      "temperature",
      "top_p",
      "top_k",
      "min_p",
      "presence_penalty",
      "frequency_penalty",
      "repetition_penalty",
      "seed",
      "stop",
      "usage",
      "reasoning",
      "prefill",
      "thinkingSeed",
      "structured",
    ],
  },
  {
    id: "local",
    label: "Local model",
    adapter: "chat",
    baseUrl: "http://127.0.0.1:8000/v1",
    allowLocal: true,
    caps: ["temperature", "top_p", "usage"],
  },
  {
    id: "custom",
    label: "Custom compatible endpoint",
    adapter: "chat",
    baseUrl: "",
    caps: ["usage"],
  },
];
export const KNOBS = [
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "presence_penalty",
  "frequency_penalty",
  "repetition_penalty",
  "seed",
  "stop",
];
export const EFFORTS = ["off", "low", "medium", "high", "xhigh", "max"];
export function endpointFor(base, adapter) {
  return (
    base.replace(/\/+$/, "") +
    (adapter === "anthropic"
      ? "/messages"
      : adapter === "responses"
        ? "/responses"
        : "/chat/completions")
  );
}
export function presetProfile(preset, id) {
  const p = PRESETS.find((p) => p.id === preset) || PRESETS.at(-1);
  return {
    id,
    displayName: p.label,
    preset: p.id,
    adapter: p.adapter,
    baseUrl: p.baseUrl,
    endpoint: p.baseUrl ? endpointFor(p.baseUrl, p.adapter) : "",
    model: "",
    transport: "relay",
    contextLimit: 32000,
    outputLimit: 2000,
    reasoningReserve: 0,
    capabilityConfirmed: false,
    parameters: {},
    capabilities: Object.fromEntries((p.caps || []).map((c) => [c, true])),
    reasoningStyle: p.reasoningStyle || "openai",
    allowLocal: !!p.allowLocal,
    persistSecret: false,
    inputPrice: null,
    outputPrice: null,
    prefillMode: "off",
  };
}
export function modelIdentity(c) {
  return [c.adapter, c.endpoint, c.model].join("|");
}
export function normalizeModels(raw) {
  return raw
    .filter((m) => m && typeof (m.id || m.name) === "string")
    .map((m) => ({
      id: m.id || m.name.replace(/^models\//, ""),
      label: m.display_name || m.displayName || m.name || m.id,
      contextLimit: positive(
        m.context_length,
        m.max_model_len,
        m.context_window,
        m.max_context_length,
        m.inputTokenLimit,
        m.top_provider?.context_length,
        m.limits?.context,
      ),
      outputLimit: positive(
        m.max_output_tokens,
        m.outputTokenLimit,
        m.top_provider?.max_completion_tokens,
      ),
      reasoningLevels: m.reasoning_parameters?.efforts || null,
      supportedParameters: m.supported_parameters || null,
      weights: m.hugging_face_id || m.canonical_slug || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function positive(...values) {
  return values.map(Number).find((n) => Number.isFinite(n) && n > 0) || null;
}

export function configurationIdentity(c) {
  return JSON.stringify([
    c.displayName,
    c.preset,
    c.baseUrl,
    c.transport,
    c.contextLimit,
    c.reasoningReserve,
    c.capabilityConfirmed,
    c.contextOverride,
    c.outputOverride,
    c.persistSecret,
    c.inputPrice,
    c.outputPrice,
    c.cachedPrice,
    c.cacheWritePrice,
    c.searchMaxUses,
    c.adapter,
    c.endpoint,
    c.model,
    c.capabilities,
    c.parameters,
    c.outputLimit,
    c.prefill,
    c.prefillMode,
    c.prefillMinChars,
    c.prefillBanned,
    c.reasoningStyle,
    c.reasoningLevels,
    c.thinkingBudget,
    c.thinkingMode,
    c.searchOn,
    c.promptCache,
  ]);
}

export function supportedKnob(adapter, key) {
  return adapter === "responses"
    ? ["temperature", "top_p"].includes(key)
    : adapter === "anthropic"
      ? ["temperature", "top_p", "top_k", "stop"].includes(key)
      : true;
}
