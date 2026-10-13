import { structuredFormat, structuredText } from "./structured.js";
import { EFFORTS, KNOBS, modelIdentity, supportedKnob } from "./presets.js";
import { assert } from "../core/schema.js";
export function reasoning(c) {
  if (!c.capabilities?.reasoning || !c.parameters?.reasoning)
    return { wire: {}, note: "No reasoning setting sent" };
  const requested = c.parameters.reasoning;
  assert(
    EFFORTS.includes(requested) || requested === "minimal",
    "Choose a supported reasoning intention.",
  );
  const style =
    c.reasoningStyle ||
    (c.adapter === "anthropic"
      ? "anthropic"
      : c.adapter === "openrouter"
        ? "openrouter"
        : "openai");
  const glm = /glm[-_.]?(\d+)(?:[._](\d+))?/i.exec(c.model || "");
  const version = glm ? Number(glm[1] + "." + (glm[2] || 0)) : 0;
  let effort = requested;
  if (["deepseek", "zai", "kimi"].includes(style))
    effort = { medium: "high", xhigh: "max" }[effort] || effort;
  let levels = c.reasoningLevels;
  if (!levels?.length && /^gpt[-_.]?6/i.test(c.model || ""))
    levels = ["low", "medium", "high", "xhigh", "max"];
  if (!levels?.length && style === "gemini")
    levels = /gemini-(?:[3-9]|2\.5-pro)/i.test(c.model || "")
      ? ["low", "medium", "high"]
      : ["off", "low", "medium", "high"];
  if (!levels?.length)
    levels =
      style === "kimi"
        ? ["low", "high", "max"]
        : style === "deepseek"
          ? ["off", "low", "high", "max"]
          : style === "zai"
            ? version >= 5.3
              ? ["low", "high", "max"]
              : version >= 5.2
                ? ["off", "high", "max"]
                : ["off", "low", "medium", "high"]
            : c.adapter === "responses"
              ? ["off", "minimal", "low", "medium", "high", "xhigh"]
              : ["off", "low", "medium", "high"];
  const rank = (value) =>
    value === "minimal" ? 0.5 : value === "none" ? 0 : EFFORTS.indexOf(value);
  levels = [...levels].sort((a, b) => rank(a) - rank(b));
  if (requested === "off")
    effort = levels.includes("none")
      ? "none"
      : levels.includes("off")
        ? "off"
        : levels[0];
  else if (!levels.includes(effort))
    effort =
      levels
        .filter(
          (l) =>
            EFFORTS.indexOf(l) <= EFFORTS.indexOf(effort) &&
            !["off", "none"].includes(l),
        )
        .at(-1) || levels.find((l) => !["off", "none"].includes(l));
  const off = ["off", "none"].includes(effort);
  let wire = {};
  if (style === "anthropic") {
    if (!off) {
      if (c.thinkingMode === "budget") {
        const budget = Number(
          c.thinkingBudget ||
            { low: 2048, medium: 8192, high: 24576, xhigh: 49152, max: 98304 }[
              effort
            ],
        );
        assert(
          Number.isInteger(budget) && budget >= 1024 && budget < c.outputLimit,
          "Thinking budget must be at least 1024 and smaller than the output allowance.",
        );
        wire.thinking = { type: "enabled", budget_tokens: budget };
      } else {
        if (c.thinkingMode !== "effort only")
          wire.thinking = { type: "adaptive" };
        wire.output_config = { effort };
      }
    } else wire.thinking = { type: "disabled" };
  } else if (style === "hermes") {
    if (!off) wire.model_options = { reasoning: { enabled: true, effort } };
  } else if (style === "gemini") {
    if (c.thinkingBudget != null && !off) {
      assert(
        /gemini-2\.5/i.test(c.model || ""),
        "This Gemini model uses effort levels on the compatible transport. Its configured token budget is retained, but choose a supported model or clear it.",
      );
      assert(
        Number.isInteger(c.thinkingBudget) && c.thinkingBudget >= 0,
        "Use a supported integer thinking budget.",
      );
      wire.extra_body = {
        google: { thinking_config: { thinking_budget: c.thinkingBudget } },
      };
    } else wire.reasoning_effort = off ? "none" : effort;
  } else if (style === "qwen") wire.enable_thinking = !off;
  else if (style === "kimi") wire.reasoning_effort = effort;
  else if (style === "kimi2")
    wire.thinking = { type: off ? "disabled" : "enabled" };
  else if (style === "deepseek" || style === "zai") {
    wire.thinking = { type: off ? "disabled" : "enabled" };
    if (!off && (style === "deepseek" || version >= 5.2))
      wire.reasoning_effort = effort;
  } else if (style === "openrouter")
    wire.reasoning = off
      ? { enabled: false }
      : c.thinkingBudget
        ? { max_tokens: Number(c.thinkingBudget) }
        : { effort };
  else if (c.adapter === "responses")
    wire.reasoning = { effort: off ? "none" : effort };
  else wire.reasoning_effort = off ? "none" : effort;
  return {
    wire,
    note:
      requested === effort
        ? "Reasoning: " + effort
        : "Requested " +
          requested +
          ", sent " +
          effort +
          ". " +
          (requested === "off" && !off
            ? "This configured model cannot disable reasoning."
            : ""),
    effort,
    ...(style === "hermes" && off
      ? {
          note: "Hermes Agent received no reasoning option. Disabling its default is not confirmed.",
        }
      : {}),
  };
}
export function prefillPlan(c, helper = false) {
  if (helper || !c.prefill || c.prefillMode === "off")
    return { sent: false, note: "No prefill sent" };
  if (c.prefillMode === "structured") {
    assert(
      c.capabilities?.structured && ["chat", "openrouter"].includes(c.adapter),
      "Structured prefill requires a compatible Chat transport with confirmed structured output support.",
    );
    return {
      sent: true,
      structured: true,
      note: "Structured opening and constraints sent as an output schema",
    };
  }
  assert(
    c.capabilities?.prefill && c.adapter !== "responses",
    "This transport has no confirmed assistant prefill support. Test a supported endpoint or disable prefill.",
  );
  if (c.prefillMode === "thinking")
    assert(
      c.capabilities?.thinkingSeed &&
        ["chat", "openrouter"].includes(c.adapter) &&
        c.parameters?.reasoning &&
        c.parameters.reasoning !== "off",
      "A thinking seed needs a configured reasoning channel and compatible Chat endpoint.",
    );
  return {
    sent: true,
    note:
      c.prefillMode === "thinking"
        ? "Thinking seed sent through the configured public reasoning field"
        : "Assistant opening sent",
    opening: c.prefillMode === "thinking" ? "" : c.prefill,
  };
}
export const structuredSchema = structuredFormat;
export function requestFeatures(c, { helper = false, outputLimit } = {}) {
  const wire = {},
    notes = [];
  for (const key of KNOBS) {
    const value = c.parameters?.[key];
    if (value == null || value === "") continue;
    if (
      helper &&
      [
        "stop",
        "presence_penalty",
        "frequency_penalty",
        "repetition_penalty",
      ].includes(key)
    )
      continue;
    if (
      !supportedKnob(c.adapter, key) &&
      !c.capabilities?.transportExtensions
    ) {
      notes.push(key + " retained but unavailable on this native transport");
      continue;
    }
    if (!c.capabilities?.[key]) {
      notes.push(key + " retained but not sent because support is disabled");
      continue;
    }
    if (key === "stop") {
      assert(
        Array.isArray(value) && value.every((s) => typeof s === "string"),
        "Stop sequences must be text.",
      );
      wire[c.adapter === "anthropic" ? "stop_sequences" : key] = value;
    } else {
      assert(Number.isFinite(value), key + " must be a finite number.");
      if (["top_k", "seed"].includes(key))
        assert(
          Number.isSafeInteger(value),
          key +
            " needs an exact safe integer. The entered value is retained in the form.",
        );
      wire[key] = value;
    }
  }
  const thinking = reasoning(c);
  Object.assign(wire, thinking.wire);
  notes.push(thinking.note);
  if (c.adapter === "anthropic" && wire.thinking?.type === "enabled")
    assert(
      wire.thinking.budget_tokens < outputLimit,
      "The effective output allowance cannot fit the thinking budget. Increase it or reduce thinking.",
    );
  if (
    c.adapter === "anthropic" &&
    ["enabled", "adaptive"].includes(wire.thinking?.type)
  ) {
    assert(
      wire.top_p == null && wire.temperature == null,
      "Claude thinking requires unset sampling controls. Your saved values are retained; clear them or disable thinking.",
    );
  }
  if (c.searchOn && helper)
    notes.push("Native lookup retained but omitted for source reading");
  if (c.searchOn && !helper) {
    assert(
      c.capabilities?.web &&
        ["responses", "anthropic", "openrouter"].includes(c.adapter),
      "Native web lookup is unavailable on this configured transport.",
    );
    if (c.adapter === "openrouter")
      wire.plugins = [
        {
          id: "web",
          engine: "native",
          max_results: Number(c.searchMaxUses || 3),
        },
      ];
    else
      wire.tools =
        c.adapter === "responses"
          ? [{ type: "web_search" }]
          : [
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: Number(c.searchMaxUses || 3),
              },
            ];
  }
  const pf = prefillPlan(c, helper);
  notes.push(pf.note);
  if (pf.structured) wire.response_format = structuredSchema(c);
  return { wire, notes, prefill: pf, identity: modelIdentity(c) };
}
export const decodeStructured = structuredText;
