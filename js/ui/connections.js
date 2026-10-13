import { STRUCTURED_TEMPLATES } from "../connections/structured.js";
import {
  $,
  el,
  field,
  panel,
  notice,
  values,
  confirmation,
  closePanel,
} from "./dom.js";
import { id } from "../core/ids.js";
import {
  PRESETS,
  KNOBS,
  EFFORTS,
  presetProfile,
  endpointFor,
  normalizeModels,
  modelIdentity,
  supportedKnob,
} from "../connections/presets.js";
import { reasoning, prefillPlan } from "../connections/features.js";
import { testConnection, providerFetch } from "../connections/transport.js";
import { validateConnection } from "../ai/providers/adapters.js";
export async function connectionManager(app, selected = null) {
  const lib = app.connectionLibrary;
  const list = el("div", { class: "connectionList" });
  for (const c of lib.profiles)
    list.append(
      el(
        "article",
        { class: "connectionCard" },
        el("strong", {}, c.displayName),
        el("p", { class: "quiet" }, c.model || "Model needed"),
        el("small", {}, lib.status(c)),
        el(
          "div",
          { class: "actions" },
          el("button", { onClick: () => connectionEditor(app, c) }, "Change"),
          el(
            "button",
            {
              onClick: () =>
                connectionEditor(app, {
                  ...c,
                  id: id("connection"),
                  displayName: c.displayName + " copy",
                  secretFromId: c.id,
                  lastTest: null,
                  health: null,
                }),
            },
            "Copy",
          ),
          el(
            "button",
            {
              onClick: async () => {
                await runTest(app, c);
                await connectionManager(app, c.id);
              },
            },
            "Test",
          ),
          el(
            "button",
            {
              onClick: () =>
                panel(
                  c.displayName + " details",
                  el("pre", { class: "receipt" }, JSON.stringify(c, null, 2)),
                ),
            },
            "Details",
          ),
          el(
            "button",
            {
              onClick: async () => {
                await lib.use(c.id, "writer", app.novelId ? "novel" : "global");
                notice(
                  "Using " +
                    c.displayName +
                    " for " +
                    (app.novelId ? "this novel" : "the default writer") +
                    ".",
                );
                await connectionManager(app, c.id);
              },
            },
            "Use",
          ),
          el(
            "button",
            {
              onClick: async () => {
                const novels = await app.repo.query("type", "novel"),
                  uses = [];
                if (lib.defaults.writerId === c.id) uses.push("default writer");
                if (lib.defaults.helperId === c.id) uses.push("default helper");
                for (const n of novels) {
                  if (n.writerConnectionId === c.id)
                    uses.push(n.title + " writer");
                  if (n.helperConnectionId === c.id)
                    uses.push(n.title + " helper");
                }
                confirmation(
                  "Remove " + c.displayName + "?",
                  "Used by: " +
                    (uses.join(", ") || "no assigned role") +
                    ". This removes the saved profile. Historical receipts remain. Novels assigned to it will use the global writer, and a removed global writer will use the first remaining connection. Shared credentials used by another profile remain.",
                  async () => {
                    await lib.remove(c.id);
                    setTimeout(() => connectionManager(app), 0);
                  },
                  "Remove connection",
                );
              },
            },
            "Remove",
          ),
        ),
      ),
    );
  const roles = el("div", { class: "formgrid" });
  for (const scope of ["global", ...(app.novelId ? ["novel"] : [])])
    for (const role of ["writer", "helper"]) {
      const novel = lib.novels.get(app.novelId),
        value =
          scope === "global"
            ? lib.defaults[role + "Id"]
            : novel?.[
                role === "writer" ? "writerConnectionId" : "helperConnectionId"
              ];
      const f = field(
        (scope === "global" ? "Default " : "This novel’s ") + role,
        scope + role,
        value || "",
        "select",
        [
          {
            value: "",
            label:
              role === "helper"
                ? scope === "novel"
                  ? "Use global helper or this writer"
                  : "Use selected writer"
                : scope === "novel"
                  ? "Use global writer"
                  : "Choose a connection",
          },
          ...lib.profiles.map((c) => ({
            value: c.id,
            label: c.displayName + " · " + (c.model || "Model needed"),
          })),
        ],
      );
      f.querySelector("select").addEventListener("change", async (e) => {
        try {
          await lib.use(e.target.value, role, scope);
        } catch (e) {
          notice(e.message, true);
        }
      });
      roles.append(f);
    }
  panel(
    "Your connections",
    el(
      "button",
      {
        onClick: async () => {
          const status = await app.device.connect();
          if (status) {
            await lib.load(status.connections);
            notice("Local service reconnected. Profiles are retained.");
            await connectionManager(app);
          }
        },
      },
      "Reconnect local service",
    ),
    el(
      "p",
      { class: "help" },
      "Choose provider, enter a key, fetch or enter a model, test, save and use it. Tests may use a small number of billable tokens. Saving alone makes no provider request.",
    ),
    el(
      "button",
      {
        class: "primary",
        onClick: () =>
          connectionEditor(app, presetProfile("openai", id("connection"))),
      },
      "Add connection",
    ),
    roles,
    list,
  );
  if (!lib.profiles.length)
    await connectionEditor(app, presetProfile("custom", id("connection")));
}
async function runTest(app, c, prefill = false) {
  c = app.connectionLibrary.profiles.find((p) => p.id === c.id) || c;
  notice(
    "Testing " +
      c.displayName +
      ". Output allowance " +
      Math.min(
        c.outputLimit,
        Math.max(64, Number(c.thinkingBudget || 0) + 128),
      ) +
      " tokens, including any configured thinking budget. This can be billable.",
  );
  try {
    validateConnection(c);
    const result = await testConnection(app.device, c, { prefill });
    await app.connectionLibrary.save({
      ...c,
      lastTest: result,
      health: "tested",
    });
    notice(
      "Test succeeded for " +
        c.model +
        ". Endpoint, key, model and transport responded to this test.",
    );
    return result;
  } catch (error) {
    const diagnostic = {
      code:
        error.code ||
        (error.refusal
          ? "provider_refusal"
          : error.name === "AbortError"
            ? "timeout"
            : "invalid_response"),
      status: error.status || null,
      parameter: error.parameter || null,
      at: new Date().toISOString(),
      identity: modelIdentity(c),
    };
    await app.connectionLibrary
      .save({ ...c, health: "failed", observations: diagnostic })
      .catch(() => {});
    notice(
      error.name === "AbortError"
        ? "Connection test timed out. Settings remain saved."
        : error.message,
      true,
    );
    return { ok: false, diagnostic };
  }
}
export async function connectionEditor(app, initial) {
  let c = structuredClone(initial);
  const fields = el("div", { class: "formgrid" });
  const add = (...args) => {
    const f = field(...args);
    fields.append(f);
    return f;
  };
  const preset = add(
    "Provider",
    "preset",
    c.preset || "custom",
    "select",
    PRESETS.map((p) => ({ value: p.id, label: p.label })),
  );
  add("Connection name", "displayName", c.displayName || "My connection");
  add("Transport mode", "transport", c.transport || "relay", "select", [
    { value: "relay", label: "Local relay, preferred" },
    {
      value: "direct",
      label: "Browser direct, requires provider CORS permission",
    },
  ]);
  add("API key, blank keeps the current key", "secret", "", "password");
  add(
    "Remember this API key on this device",
    "persistSecret",
    c.persistSecret,
    "checkbox",
  );
  if (initial.secretFromId)
    add(
      "Reuse the original connection key for this provider",
      "reuseKey",
      true,
      "checkbox",
    );
  add("Provider base URL", "baseUrl", c.baseUrl || "");
  add("Adapter", "adapter", c.adapter, "select", [
    { value: "responses", label: "OpenAI Responses" },
    { value: "chat", label: "OpenAI compatible Chat Completions" },
    { value: "anthropic", label: "Anthropic Messages" },
    { value: "openrouter", label: "OpenRouter compatible transport" },
  ]);
  add("Full endpoint URL", "endpoint", c.endpoint);
  const endpointSettings = el(
    "details",
    {
      class: "endpointSettings",
      ...(["custom", "local", "hermes"].includes(c.preset) ? { open: "" } : {}),
    },
    el("summary", {}, "Endpoint and transport"),
  );
  const endpointFields = el("div", { class: "formgrid" });
  endpointSettings.append(endpointFields);
  for (const key of ["transport", "baseUrl", "adapter", "endpoint"])
    endpointFields.append(
      fields.querySelector('[name="' + key + '"]').parentElement,
    );
  fields.append(endpointSettings);
  const modelField = add("Model identifier", "model", c.model),
    models = el("datalist", { id: "connectionModels" });
  modelField.querySelector("input").setAttribute("list", models.id);
  fields.append(models);
  const modelPicker = el(
    "select",
    { "aria-label": "Discovered models" },
    el("option", { value: "" }, "Fetch models or enter a model manually"),
  );
  fields.append(modelPicker);
  const localField = add(
    "Explicitly allow a loopback local model endpoint",
    "allowLocal",
    c.allowLocal,
    "checkbox",
  );
  endpointFields.append(localField);
  const advanced = el(
    "details",
    { class: "connectionAdvanced" },
    el("summary", {}, "Model settings and capabilities"),
  );
  const advancedFields = el("div", { class: "formgrid" });
  advanced.append(advancedFields);
  const adv = (...args) => {
    const f = field(...args);
    advancedFields.append(f);
    return f;
  };
  adv(
    "Context limit including output",
    "contextLimit",
    c.contextLimit,
    "number",
  );
  adv("Maximum output tokens", "outputLimit", c.outputLimit, "number");
  adv(
    "Provider advertises or you confirmed this context limit",
    "capabilityConfirmed",
    c.capabilityConfirmed,
    "checkbox",
  );
  adv(
    "Reasoning reserve tokens",
    "reasoningReserve",
    c.reasoningReserve || 0,
    "number",
  );
  adv(
    "Reasoning effort",
    "reasoning",
    c.parameters?.reasoning || "",
    "select",
    [
      { value: "", label: "Provider default" },
      { value: "minimal", label: "Minimal, for supported legacy models" },
      ...EFFORTS.map((e) => ({
        value: e,
        label: e === "xhigh" ? "XHigh" : e[0].toUpperCase() + e.slice(1),
      })),
    ],
  );
  adv(
    "Reasoning protocol",
    "reasoningStyle",
    c.reasoningStyle || "openai",
    "select",
    [
      "openai",
      "anthropic",
      "openrouter",
      "deepseek",
      "zai",
      "gemini",
      "hermes",
      "qwen",
      "kimi",
      "kimi2",
    ],
  );
  adv(
    "Supported reasoning values, optional comma separated override",
    "reasoningLevels",
    (c.reasoningLevels || []).join(", "),
  );
  adv(
    "Thinking mode for Claude",
    "thinkingMode",
    c.thinkingMode || "adaptive",
    "select",
    ["adaptive", "budget", "effort only"],
  );
  adv(
    "Thinking token budget, optional",
    "thinkingBudget",
    c.thinkingBudget ?? "",
    "number",
  );
  for (const key of KNOBS) {
    const label = {
      temperature: "Temperature",
      top_p: "Top p",
      top_k: "Top k",
      min_p: "Min p",
      presence_penalty: "Presence penalty",
      frequency_penalty: "Frequency penalty",
      repetition_penalty: "Repetition penalty",
      seed: "Seed",
      stop: "Stop sequences, one per line",
    }[key];
    adv(
      "Model supports " +
        (key === "temperature"
          ? "temperature"
          : key === "top_p"
            ? "top p"
            : label.toLowerCase()),
      "cap_" + key,
      c.capabilities?.[key],
      "checkbox",
    );
    adv(
      label,
      key,
      key === "stop"
        ? (c.parameters?.stop || []).join("\n")
        : (c.parameters?.[key] ?? ""),
      key === "stop" ? "textarea" : "number",
    );
  }
  for (const [key, label] of Object.entries({
    reasoning: "Model supports reasoning controls",
    usage: "Chat transport supports usage stream events",
    storage: "Chat transport supports disabling provider storage",
    maxCompletionTokens: "Chat transport uses max completion tokens",
    prefill: "Model supports assistant prefill",
    thinkingSeed: "Model supports a public thinking seed field",
    prefix: "Model requires the assistant prefix flag",
    structured: "Model supports structured output constraints",
    web: "Model supports native web lookup",
    promptCache: "Claude supports ephemeral prompt caching",
    schemaExclusions: "Structured schema supports phrase exclusions",
    transportExtensions:
      "Custom endpoint explicitly supports additional sampling fields",
  }))
    adv(label, "cap_" + key, c.capabilities?.[key], "checkbox");
  adv("Prefill mode", "prefillMode", c.prefillMode || "off", "select", [
    { value: "off", label: "Off" },
    { value: "opening", label: "Assistant opening" },
    { value: "thinking", label: "Compatible thinking seed" },
    { value: "structured", label: "Structured opening" },
  ]);
  adv(
    "Prefill text, preserved exactly",
    "prefill",
    c.prefill || "",
    "textarea",
  );
  adv(
    "Structured minimum characters after opening",
    "prefillMinChars",
    c.prefillMinChars || 1,
    "number",
  );
  adv(
    "Structured excluded phrases, one per line",
    "prefillBanned",
    c.prefillBanned || "",
    "textarea",
  );
  adv("Enable native web lookup", "searchOn", c.searchOn, "checkbox");
  adv(
    "Maximum native lookup uses for Claude",
    "searchMaxUses",
    c.searchMaxUses || 3,
    "number",
  );
  adv(
    "Enable Claude ephemeral prompt caching",
    "promptCache",
    c.promptCache,
    "checkbox",
  );
  for (const [k, label] of Object.entries({
    inputPrice: "Input price per million tokens, optional",
    outputPrice: "Output price per million tokens, optional",
    cachedPrice: "Cached input price per million tokens, optional",
    cacheWritePrice: "Cache write price per million tokens, optional",
  }))
    adv(label, k, c[k] ?? "", "number");
  const templatePicker = field(
    "Structured template",
    "template",
    "opening",
    "select",
    STRUCTURED_TEMPLATES.map((p) => ({ value: p.id, label: p.label })),
  );
  advancedFields.append(templatePicker);
  const templateGuide = el(
    "p",
    { class: "help" },
    STRUCTURED_TEMPLATES[0].guide,
  );
  advancedFields.append(templateGuide);
  templatePicker.querySelector("select").addEventListener("change", (e) => {
    templateGuide.textContent = STRUCTURED_TEMPLATES.find(
      (p) => p.id === e.target.value,
    ).guide;
  });
  const hint = el("p", { class: "help", role: "status" }),
    error = el("pre", { class: "diagnostic", hidden: true });
  const form = el(
    "form",
    {},
    fields,
    el(
      "p",
      { class: "help" },
      "Unset parameters stay unset. Provider presets are starting points. Only enabled capabilities are sent. Remembered relay keys live in a separate local file with restricted permissions, which are not encryption. Browser direct keys live only in this page memory.",
    ),
    advanced,
    hint,
    error,
  );
  const read = () => {
    const v = values(form),
      parameters = {},
      capabilities = {};
    for (const key of KNOBS) {
      capabilities[key] = !!v["cap_" + key];
      if (v[key] !== "")
        parameters[key] =
          key === "stop" ? v[key].split("\n").filter(Boolean) : Number(v[key]);
    }
    if (v.reasoning) parameters.reasoning = v.reasoning;
    for (const [k, val] of Object.entries(v))
      if (k.startsWith("cap_")) capabilities[k.slice(4)] = val;
    const result = {
      ...c,
      ...Object.fromEntries(
        Object.entries(v).filter(
          ([k]) =>
            !k.startsWith("cap_") && !KNOBS.includes(k) && k !== "reasoning",
        ),
      ),
      parameters,
      capabilities,
    };
    if (initial.secretFromId && (!v.reuseKey || v.secret))
      delete result.secretFromId;
    result.reasoningLevels = v.reasoningLevels
      ? v.reasoningLevels
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : null;
    if (
      result.reasoningLevels?.some(
        (s) => !["off", "none", "minimal", ...EFFORTS].includes(s),
      )
    )
      throw new Error("Supported reasoning values must be named levels.");
    for (const k of [
      "contextLimit",
      "outputLimit",
      "reasoningReserve",
      "prefillMinChars",
      "searchMaxUses",
    ])
      result[k] = Number(v[k]);
    for (const k of [
      "thinkingBudget",
      "inputPrice",
      "outputPrice",
      "cachedPrice",
      "cacheWritePrice",
    ])
      result[k] = v[k] === "" ? null : Number(v[k]);
    if (v.contextLimit !== String(c.contextLimit))
      result.contextOverride = true;
    if (v.outputLimit !== String(c.outputLimit)) result.outputOverride = true;
    return result;
  };
  const save = async () => {
    const next = read();
    new URL(next.endpoint);
    c = await app.connectionLibrary.save(next);
    form.elements.secret.value = "";
    return c;
  };
  const refreshHint = () => {
    for (const key of KNOBS) {
      const supported =
        supportedKnob(form.elements.adapter.value, key) ||
        form.elements.cap_transportExtensions?.checked;
      form.elements["cap_" + key].disabled = !supported;
      form.elements[key].setAttribute(
        "title",
        supported
          ? "Sent when configured support is enabled"
          : "Saved but not sent on this native transport. A custom endpoint extension requires explicit support.",
      );
    }
    form.elements.persistSecret.disabled =
      form.elements.transport.value === "direct";
    form.elements.searchOn.disabled = !["responses", "anthropic"].includes(
      form.elements.adapter.value,
    );
    try {
      const p = read();
      hint.textContent =
        reasoning(p).note +
        ". " +
        prefillPlan(p).note +
        ". " +
        app.connectionLibrary.status(p);
    } catch (e) {
      hint.textContent = e.message;
    }
  };
  form.addEventListener("change", refreshHint);
  preset.querySelector("select").addEventListener("change", () => {
    const next = presetProfile(form.elements.preset.value, c.id);
    endpointSettings.open = ["custom", "local", "hermes"].includes(next.preset);
    c = {
      ...next,
      profileVersion: c.profileVersion,
      displayName: form.elements.displayName.value,
    };
    for (const [k, v] of Object.entries(next)) {
      if (form.elements[k]) {
        if (form.elements[k].type === "checkbox")
          form.elements[k].checked = !!v;
        else if (typeof v !== "object") form.elements[k].value = v ?? "";
      }
    }
    for (const cap of form.querySelectorAll('input[name^="cap_"]'))
      cap.checked = !!next.capabilities[cap.name.slice(4)];
    refreshHint();
  });
  form.elements.contextLimit.addEventListener("input", () => {
    c.contextOverride = true;
  });
  form.elements.outputLimit.addEventListener("input", () => {
    c.outputOverride = true;
  });
  form.elements.reasoningLevels.addEventListener("input", () => {
    c.reasoningLevelsOverride = true;
  });
  for (const cap of form.querySelectorAll('input[name^="cap_"]'))
    cap.addEventListener("change", () => {
      c.capabilityOverrides = [
        ...new Set([...(c.capabilityOverrides || []), cap.name.slice(4)]),
      ];
    });
  const chooseModel = () => {
    const found = c.discovery?.models?.find(
      (m) => m.id === form.elements.model.value,
    );
    if (!found) {
      if (c.discovery && c.model !== form.elements.model.value) {
        if (!c.contextOverride) {
          form.elements.contextLimit.value = 32000;
          form.elements.capabilityConfirmed.checked = false;
        }
        if (!c.reasoningLevelsOverride)
          form.elements.reasoningLevels.value = "";
      }
      return;
    }
    if (found.contextLimit && !c.contextOverride) {
      form.elements.contextLimit.value = found.contextLimit;
      form.elements.capabilityConfirmed.checked = true;
    }
    if (found.outputLimit && !c.outputOverride)
      form.elements.outputLimit.value = Math.min(
        found.outputLimit,
        Number(form.elements.outputLimit.value),
      );
    if (!c.reasoningLevelsOverride) {
      c.reasoningLevels = found.reasoningLevels;
      form.elements.reasoningLevels.value = (found.reasoningLevels || []).join(
        ", ",
      );
    }
    if (found.supportedParameters)
      for (const cap of form.querySelectorAll('input[name^="cap_"]'))
        if (
          KNOBS.includes(cap.name.slice(4)) &&
          !(c.capabilityOverrides || []).includes(cap.name.slice(4))
        )
          cap.checked = found.supportedParameters.includes(cap.name.slice(4));
    refreshHint();
  };
  modelPicker.addEventListener("change", () => {
    form.elements.model.value = modelPicker.value;
    chooseModel();
  });
  form.elements.model.addEventListener("change", chooseModel);
  const fetchModels = el(
    "button",
    {
      type: "button",
      onClick: async () => {
        const entered = form.elements.model.value;
        try {
          c = await save();
          let raw;
          if (c.transport === "direct") {
            const response = await providerFetch(app.device, c, null, {
              models: true,
              signal: AbortSignal.timeout(15000),
            });
            if (!response.ok)
              throw new Error(
                "Model discovery returned HTTP " + response.status,
              );
            raw = await response.json();
          } else
            raw = await app.device.api("connections/models", {
              method: "POST",
              body: { id: c.id },
            });
          const available = normalizeModels(raw.models || raw.data || []);
          c.discovery = {
            identity: c.adapter + "|" + c.endpoint,
            models: available,
            fetchedAt: new Date().toISOString(),
          };
          c = await app.connectionLibrary.save(c);
          models.replaceChildren(
            ...available.map((m) => el("option", { value: m.id }, m.label)),
          );
          modelPicker.replaceChildren(
            el("option", { value: "" }, "Choose a discovered model"),
            ...available.map((m) => el("option", { value: m.id }, m.id)),
          );
          form.elements.model.value = entered;
          chooseModel();
          notice(
            "Fetched " +
              available.length +
              " models. Your manual model remains available.",
          );
        } catch (e) {
          form.elements.model.value = entered;
          notice(e.message + ". Manual model entry remains available.", true);
        }
      },
    },
    "Fetch models",
  );
  form.append(
    el(
      "div",
      { class: "actions" },
      fetchModels,
      el(
        "button",
        {
          type: "button",
          onClick: async () => {
            c = await save();
            const result = await runTest(app, c);
            c = app.connectionLibrary.profiles.find((p) => p.id === c.id) || c;
            error.hidden = result.ok;
            if (!result.ok)
              error.textContent = JSON.stringify(result.diagnostic, null, 2);
            refreshHint();
          },
        },
        "Test connection",
      ),
      el(
        "button",
        {
          type: "button",
          onClick: async () => {
            c = await save();
            const r = await runTest(app, c, true);
            c = app.connectionLibrary.profiles.find((p) => p.id === c.id) || c;
            error.hidden = r.ok;
            if (!r.ok)
              error.textContent = JSON.stringify(r.diagnostic, null, 2);
          },
        },
        "Test prefill",
      ),
      el(
        "button",
        {
          type: "button",
          onClick: () => {
            form.elements.prefill.value =
              "The rain had softened the afternoon.";
            form.elements.prefillMode.value = "structured";
            refreshHint();
          },
        },
        "Load literary opening template",
      ),
      el(
        "button",
        {
          type: "button",
          onClick: () => {
            form.elements.endpoint.value = endpointFor(
              form.elements.baseUrl.value,
              form.elements.adapter.value,
            );
            refreshHint();
          },
        },
        "Build endpoint from base URL",
      ),
      el(
        "button",
        { type: "submit", class: "primary" },
        "Validate and save connection",
      ),
      el(
        "button",
        { type: "button", onClick: () => connectionManager(app) },
        "All connections",
      ),
    ),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await save();
      notice("Connection saved. No model call was made by Save.");
      closePanel();
    } catch (e) {
      notice(e.message, true);
    }
  });
  if (c.deviceProfile)
    form.append(
      el(
        "button",
        {
          type: "button",
          onClick: () =>
            panel(
              "Compare local and device profile metadata",
              el(
                "pre",
                { class: "receipt" },
                JSON.stringify({ local: c, device: c.deviceProfile }, null, 2),
              ),
              el(
                "p",
                { class: "help" },
                "The local copy is retained. Save it as a separate Copy to keep both configurations, or return to Connections and reconfigure deliberately.",
              ),
            ),
        },
        "Compare device configuration",
      ),
    );
  panel("Configure connection", form);
  refreshHint();
}
