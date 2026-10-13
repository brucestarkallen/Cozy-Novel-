import test from "node:test";
import assert from "node:assert/strict";
import {
  presetProfile,
  endpointFor,
  normalizeModels,
  configurationIdentity,
} from "../../js/connections/presets.js";
import { serialize } from "../../js/ai/providers/adapters.js";
import {
  reasoning,
  decodeStructured,
  prefillPlan,
} from "../../js/connections/features.js";
const context = {
  system: "Story contract",
  user: "Exact 雨 source",
  outputLimit: 2000,
  kind: "write",
};
test("presets construct explicit endpoints and discovered limits preserve model identity", () => {
  for (const preset of [
    "claude",
    "openai",
    "openrouter",
    "gemini",
    "deepseek",
    "zai",
    "hermes",
    "local",
  ]) {
    const c = presetProfile(preset, "id");
    assert.equal(c.endpoint, endpointFor(c.baseUrl, c.adapter));
    assert.equal(c.model, "");
  }
  const models = normalizeModels([
    {
      id: "z",
      context_length: 500000,
      reasoning_parameters: { efforts: ["low", "high", "max"] },
    },
    { id: "a", inputTokenLimit: 200000 },
  ]);
  assert.deepEqual(
    models.map((m) => m.id),
    ["a", "z"],
  );
  const restoreProfile = {
    ...presetProfile("openai", "stable"),
    model: "fixture",
    contextLimit: 200000,
  };
  assert.notEqual(
    configurationIdentity(restoreProfile),
    configurationIdentity({ ...restoreProfile, contextLimit: 500000 }),
  );
  assert.notEqual(
    configurationIdentity(restoreProfile),
    configurationIdentity({ ...restoreProfile, inputPrice: 2 }),
  );
  assert.equal(models[1].contextLimit, 500000);
  assert.deepEqual(models[1].reasoningLevels, ["low", "high", "max"]);
});
test("unset sampling is absent and set decimals, seeds and stop text serialize through compatible capabilities", () => {
  const c = presetProfile("openrouter", "c");
  c.model = "fixture";
  assert.equal("temperature" in serialize(c, context), false);
  c.parameters = {
    temperature: 0.7321,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.023,
    presence_penalty: 0.25,
    frequency_penalty: 0.33,
    repetition_penalty: 1.12,
    seed: 2718,
    stop: ["End\n", "☕"],
  };
  const p = serialize(c, context);
  for (const [k, v] of Object.entries(c.parameters)) assert.deepEqual(p[k], v);
  const helper = serialize(c, { ...context, kind: "analysis" });
  assert.equal(helper.stop, undefined);
  assert.equal(helper.repetition_penalty, undefined);
  assert.equal(c.parameters.repetition_penalty, 1.12);
});
test("reasoning maps intentions only into configured levels and discloses models without off", () => {
  const c = presetProfile("deepseek", "c");
  c.model = "fixture";
  c.parameters.reasoning = "medium";
  assert.equal(serialize(c, context).reasoning_effort, "high");
  c.parameters.reasoning = "off";
  assert.deepEqual(serialize(c, context).thinking, { type: "disabled" });
  const glm = presetProfile("zai", "g");
  glm.model = "glm-5.3";
  glm.parameters.reasoning = "off";
  assert.equal(reasoning(glm).wire.reasoning_effort, "low");
  assert.match(reasoning(glm).note, /cannot disable/);
  const open = presetProfile("openai", "o");
  open.model = "custom";
  open.parameters.reasoning = "max";
  open.reasoningLevels = ["low", "medium", "high", "xhigh", "max"];
  assert.equal(serialize(open, context).reasoning.effort, "max");
  open.parameters.reasoning = "off";
  assert.equal(serialize(open, context).reasoning.effort, "low");
  open.reasoningLevels = ["high", "low", "medium"];
  open.parameters.reasoning = "max";
  assert.equal(reasoning(open).effort, "high");
  open.parameters.reasoning = "off";
  assert.equal(reasoning(open).effort, "low");
  const claude = presetProfile("claude", "a");
  claude.model = "fixture";
  claude.parameters.reasoning = "low";
  claude.thinkingMode = "budget";
  claude.thinkingBudget = 1024;
  assert.equal(serialize(claude, context).thinking.budget_tokens, 1024);
  assert.throws(
    () => serialize(claude, { ...context, outputLimit: 500 }),
    /allowance/,
  );
});
test("assistant opening, thinking seed and structured output have separate safe transports", () => {
  const c = presetProfile("hermes", "p");
  c.model = "fixture";
  c.prefill = "Rain. ";
  c.prefillMode = "opening";
  assert.equal(serialize(c, context).messages.at(-1).content, "Rain. ");
  c.prefillMode = "thinking";
  c.capabilities.reasoning = true;
  c.parameters.reasoning = "low";
  assert.equal(
    serialize(c, context).messages.at(-1).reasoning_content,
    "Rain. ",
  );
  c.prefillMode = "structured";
  const p = serialize(c, context);
  assert.equal(p.messages.at(-1).role, "user");
  assert.equal(p.response_format.type, "json_schema");
  assert.equal(
    decodeStructured('{"prose":"Rain. More prose"}', c),
    "Rain. More prose",
  );
  assert.throws(() => decodeStructured('{"prose":"Changed"}', c));
  assert.equal(prefillPlan(c, true).sent, false);
  const unsupported = presetProfile("openai", "x");
  unsupported.prefill = "Rain";
  unsupported.prefillMode = "opening";
  assert.throws(() => serialize(unsupported, context), /prefill support/);
});
test("native web and Claude cache controls affect only supported serialized requests", () => {
  const c = presetProfile("claude", "c");
  c.model = "fixture";
  c.searchOn = true;
  c.promptCache = true;
  const p = serialize(c, context);
  assert.equal(p.tools[0].type, "web_search_20250305");
  assert.equal(p.system[0].cache_control.type, "ephemeral");
  const o = presetProfile("openai", "o");
  o.model = "fixture";
  o.searchOn = true;
  assert.equal(serialize(o, context).tools[0].type, "web_search");
  const custom = presetProfile("custom", "x");
  custom.searchOn = true;
  assert.throws(() => serialize(custom, context), /unavailable/);
});

test("structured templates decode hidden headings, bounded words and stop markers without control text", async () => {
  const { structuredFormat, structuredText } = await import(
    "../../js/connections/structured.js"
  );
  const c = { prefill: "Scene: [[line]]\n[[keep]]Rain.", prefillMinChars: 1 };
  assert.ok(
    structuredFormat(c).json_schema.schema.properties.prose.pattern.includes(
      "Scene:",
    ),
  );
  assert.equal(
    structuredText(
      '{"prose":"Scene: A quiet café\\nRain. The cups cooled."}',
      c,
    ),
    "Rain. The cups cooled.",
  );
  const fixed = { prefill: "“[[words:2-4]],” B said.[[end]]" };
  assert.equal(
    structuredText('{"prose":"“Good afternoon,” B said."}', fixed),
    "“Good afternoon,” B said.",
  );
  assert.throws(() =>
    structuredText('{"prose":"“Good afternoon,” B said. More text"}', fixed),
  );
  assert.throws(() => structuredFormat({ prefill: "[[re:(a+)+]]" }), /bounded/);
  assert.throws(
    () =>
      structuredText('{"prose":"Rain. forbidden"}', {
        prefill: "Rain.",
        prefillBanned: "forbidden",
      }),
    /excluded/,
  );
});
test("usage retains reported cache boundaries and unknown pricing stays unknown", async () => {
  const { usageCounts, requestCost } = await import(
    "../../js/connections/usage.js"
  );
  const reported = {
    prompt_tokens: 100,
    completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 40 },
  };
  assert.deepEqual(usageCounts(reported), {
    input: 100,
    output: 10,
    cached: 40,
    cacheWrite: null,
  });
  assert.equal(requestCost(reported, { inputPrice: 1, outputPrice: 2 }), null);
  assert.equal(
    requestCost(reported, { inputPrice: 1, outputPrice: 2, cachedPrice: 0.5 }),
    (60 + 20 + 20) / 1000000,
  );
  assert.equal(
    requestCost(
      {
        input_tokens: 100,
        output_tokens: 10,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 20,
      },
      {
        adapter: "anthropic",
        inputPrice: 1,
        outputPrice: 2,
        cachedPrice: 0.5,
        cacheWritePrice: 1.25,
      },
    ),
    (100 + 20 + 20 + 25) / 1000000,
  );
});

test("Hermes, Gemini, Qwen and declared model settings use their distinct explicit protocols", () => {
  const hermes = presetProfile("hermes", "h");
  hermes.model = "hermes-agent";
  hermes.parameters.reasoning = "high";
  assert.deepEqual(serialize(hermes, context).model_options, {
    reasoning: { enabled: true, effort: "high" },
  });
  const gemini = presetProfile("gemini", "g");
  gemini.model = "gemini-3.1-pro";
  gemini.parameters.reasoning = "off";
  assert.equal(serialize(gemini, context).reasoning_effort, "low");
  gemini.model = "gemini-2.5-flash";
  gemini.thinkingBudget = 2048;
  gemini.parameters.reasoning = "low";
  const wire = serialize(gemini, context);
  assert.equal(wire.extra_body.google.thinking_config.thinking_budget, 2048);
  assert.equal(wire.reasoning_effort, undefined);
  const router = presetProfile("openrouter", "r");
  router.searchOn = true;
  router.model = "fixture";
  assert.deepEqual(serialize(router, context).plugins, [
    { id: "web", engine: "native", max_results: 3 },
  ]);
  assert.equal(
    serialize(router, { ...context, kind: "analysis" }).plugins,
    undefined,
  );
  const qwen = { ...hermes, reasoningStyle: "qwen" };
  assert.equal(serialize(qwen, context).enable_thinking, true);
  const claude = {
    ...presetProfile("claude", "c"),
    parameters: { seed: 42 },
    capabilities: { seed: true },
  };
  assert.equal(serialize(claude, context).seed, undefined);
  assert.equal(claude.parameters.seed, 42);
});

test("configuration validation rejects invented prices and negative reserves", async () => {
  const { validateConnection } = await import(
    "../../js/ai/providers/adapters.js"
  );
  const c = {
    ...presetProfile("custom", "v"),
    model: "fixture",
    endpoint: "https://example.org/v1/chat/completions",
  };
  assert.throws(() => validateConnection({ ...c, inputPrice: -1 }), /Prices/);
  assert.throws(
    () => validateConnection({ ...c, outputPrice: Infinity }),
    /Prices/,
  );
  assert.throws(
    () => validateConnection({ ...c, reasoningReserve: -1 }),
    /reserve/,
  );
  assert.equal(validateConnection({ ...c, inputPrice: null }).inputPrice, null);
});
test("remote error fields cannot insert arbitrary private strings into diagnostics", async () => {
  const { normalize, consumeStream } = await import(
    "../../js/ai/providers/adapters.js"
  );
  const privateValue = "SYNTHETIC_PRIVATE_KEY";
  assert.equal(
    normalize("chat", {
      data: JSON.stringify({
        error: { code: privateValue, message: privateValue },
      }),
    }).code,
    "stream_error",
  );
  try {
    await consumeStream(
      new Response(
        JSON.stringify({
          code: privateValue,
          parameter: privateValue,
          error: privateValue,
        }),
        { status: 400 },
      ),
      "chat",
      () => {},
    );
  } catch (e) {
    assert.equal(e.message.includes(privateValue), false);
    assert.equal(e.code, "provider_error");
    assert.equal(e.parameter, null);
    return;
  }
  assert.fail("Expected rejected provider response");
});
