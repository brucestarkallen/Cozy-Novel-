import { $, el, field, formPanel, panel, notice } from "./dom.js";
import { DEFAULT_CONNECTION } from "../config.js";
import { id, now } from "../core/ids.js";
import { TEMPLATES } from "../ai/prompts/templates.js";
const endpointDefaults = {
  responses: "https://api.openai.com/v1/responses",
  chat: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};
export async function settingsAction(app, action) {
  if (action === "appearance") {
    const prefs = (await app.repo.get("appearance", "meta")) || {
      theme: "dark",
      size: 20,
      width: 760,
    };
    formPanel(
      "A comfortable reading room",
      [
        field("Theme", "theme", prefs.theme, "select", ["dark", "light"]),
        field("Reading size in pixels", "size", prefs.size, "number"),
        field("Reading width in pixels", "width", prefs.width, "number"),
      ],
      async (v) => {
        const p = {
          id: "appearance",
          theme: v.theme,
          size: Math.max(14, Math.min(32, Number(v.size))),
          width: Math.max(400, Math.min(1100, Number(v.width))),
        };
        await app.repo.localPut(p);
        applyAppearance(p);
      },
    );
    return true;
  }
  if (action === "settings") {
    if (!app.device.token) {
      const status = await app.device.connect();
      if (status) app.connections = status.connections || [];
    }
    await connectionPanel(app, "primary");
    return true;
  }
  if (action === "style") {
    const n = await app.repo.get(app.novelId);
    formPanel(
      "Your novel’s writing style",
      Object.entries(n.styleProfile)
        .map(([key, value]) =>
          field(
            {
              person: "Narrative person",
              viewpoint: "Default viewpoint",
              tense: "Tense",
              voice: "Voice",
              dialogue: "Dialogue style",
              density: "Descriptive density",
              pacing: "Pacing",
              length: "Approximate passage length",
              genre: "Genre",
              tone: "Tone",
              freedom: "Creative freedom",
              instructions: "Important author instructions",
              voiceSamples: "Your voice samples, preserved exactly",
            }[key] || key,
            key,
            value,
            ["instructions", "voiceSamples"].includes(key)
              ? "textarea"
              : "text",
          ),
        )
        .concat(
          field(
            "Automatic suggestions and source reading",
            "autoSuggestions",
            n.autoSuggestions,
            "checkbox",
          ),
        ),
      async (v) => {
        const { autoSuggestions, ...styleProfile } = v;
        await app.repo.update(
          { ...(await app.repo.get(n.id)), styleProfile, autoSuggestions },
          "style.update",
        );
      },
      {
        help: "These instructions belong to this novel. Source samples are preserved as you enter them.",
      },
    );
    return true;
  }
  if (action === "prompts") {
    const select = el(
      "select",
      { "aria-label": "Prompt template" },
      Object.keys(TEMPLATES).map((k) => el("option", { value: k }, k)),
    );
    const area = el("textarea", { "aria-label": "Prompt text", rows: 14 });
    let version = 1;
    const load = async () => {
      const templates = (await app.repo.query("novelId", app.novelId))
        .filter((r) => r.type === "prompt" && r.kind === select.value)
        .sort((a, b) => b.version - a.version);
      area.value = templates[0]?.body || TEMPLATES[select.value];
      version = (templates[0]?.version || 0) + 1;
    };
    select.addEventListener("change", load);
    await load();
    panel(
      "Versioned prompt templates",
      el(
        "p",
        { class: "help" },
        "Saving creates a new version. Earlier versions remain in backups. Provider secrets are never part of a template.",
      ),
      select,
      area,
      el(
        "div",
        { class: "actions" },
        el(
          "button",
          {
            class: "primary",
            onClick: async () => {
              await app.repo.update(
                {
                  id: id("prompt"),
                  type: "prompt",
                  novelId: app.novelId,
                  kind: select.value,
                  body: area.value,
                  version,
                  createdAt: now(),
                },
                "prompt.version",
              );
              await load();
              notice("Prompt version saved.");
            },
          },
          "Save new version",
        ),
        el(
          "button",
          {
            onClick: () => {
              area.value = TEMPLATES[select.value];
            },
          },
          "Load default into editor",
        ),
      ),
    );
    return true;
  }
  return false;
}
export function applyAppearance(p) {
  if (!p) return;
  document.documentElement.dataset.theme = p.theme;
  document.documentElement.style.setProperty("--reading", p.size + "px");
  document.documentElement.style.setProperty("--measure", p.width + "px");
}
async function connectionPanel(app, slot) {
  const c = app.connections.find((x) => x.id === slot) || {
    ...structuredClone(DEFAULT_CONNECTION),
    id: slot,
  };
  const form = formPanel(
    slot === "primary" ? "Writing connection" : "Optional helper connection",
    [
      field("Adapter", "adapter", c.adapter, "select", [
        { value: "responses", label: "OpenAI Responses" },
        { value: "chat", label: "OpenAI compatible Chat Completions" },
        { value: "anthropic", label: "Anthropic Messages" },
        { value: "openrouter", label: "OpenRouter" },
      ]),
      field("Model identifier", "model", c.model),
      field("Full endpoint URL", "endpoint", c.endpoint),
      field("API key, blank keeps the current key", "secret", "", "password"),
      field(
        "Context limit including output",
        "contextLimit",
        c.contextLimit,
        "number",
      ),
      field("Maximum output tokens", "outputLimit", c.outputLimit, "number"),
      field(
        "Reasoning reserve tokens",
        "reasoningReserve",
        c.reasoningReserve || 0,
        "number",
      ),
      field(
        "Provider capability verified for this context limit",
        "capabilityConfirmed",
        c.capabilityConfirmed,
        "checkbox",
      ),
      field(
        "Explicitly allow a loopback local model endpoint",
        "allowLocal",
        c.allowLocal,
        "checkbox",
      ),
      field(
        "Persist key in a separate local file with restricted permissions",
        "persistSecret",
        c.persistSecret,
        "checkbox",
      ),
      field(
        "Model supports temperature",
        "temperatureEnabled",
        c.capabilities?.temperature,
        "checkbox",
      ),
      field(
        "Temperature",
        "temperature",
        c.parameters?.temperature ?? 0.8,
        "number",
      ),
      field(
        "Model supports top p",
        "topPEnabled",
        c.capabilities?.top_p,
        "checkbox",
      ),
      field("Top p", "topP", c.parameters?.top_p ?? 1, "number"),
      field(
        "Chat transport supports usage stream events",
        "usageEnabled",
        c.capabilities?.usage,
        "checkbox",
      ),
      field(
        "Chat transport supports disabling provider storage",
        "storageEnabled",
        c.capabilities?.storage,
        "checkbox",
      ),
      field(
        "Chat transport uses max completion tokens",
        "maxCompletionTokens",
        c.capabilities?.maxCompletionTokens,
        "checkbox",
      ),
      field(
        "Responses model supports reasoning effort",
        "reasoningEnabled",
        c.capabilities?.reasoning,
        "checkbox",
      ),
      field(
        "Reasoning effort",
        "reasoning",
        c.parameters?.reasoning || "medium",
        "select",
        ["minimal", "low", "medium", "high"],
      ),
      field(
        "Input price per million tokens, optional",
        "inputPrice",
        c.inputPrice ?? "",
        "number",
      ),
      field(
        "Output price per million tokens, optional",
        "outputPrice",
        c.outputPrice ?? "",
        "number",
      ),
    ],
    async (v) => {
      if (!app.device.token)
        throw new Error(
          "Start the local server first. Browser only mode does not expose provider keys.",
        );
      const profile = {
        id: slot,
        adapter: v.adapter,
        model: v.model,
        endpoint: v.endpoint,
        secret: v.secret,
        persistSecret: v.persistSecret,
        allowLocal: v.allowLocal,
        contextLimit: Number(v.contextLimit),
        outputLimit: Number(v.outputLimit),
        reasoningReserve: Number(v.reasoningReserve),
        capabilityConfirmed: v.capabilityConfirmed,
        capabilities: {
          temperature: v.temperatureEnabled,
          top_p: v.topPEnabled,
          usage: v.usageEnabled,
          storage: v.storageEnabled,
          maxCompletionTokens: v.maxCompletionTokens,
          reasoning: v.reasoningEnabled,
        },
        parameters: {
          temperature: Number(v.temperature),
          top_p: Number(v.topP),
          reasoning: v.reasoning,
        },
        inputPrice: v.inputPrice === "" ? null : Number(v.inputPrice),
        outputPrice: v.outputPrice === "" ? null : Number(v.outputPrice),
      };
      if (
        !Number.isInteger(profile.contextLimit) ||
        !Number.isInteger(profile.outputLimit) ||
        !Number.isInteger(profile.reasoningReserve) ||
        profile.reasoningReserve < 0 ||
        profile.contextLimit < 2048 ||
        profile.outputLimit < 64 ||
        profile.outputLimit >= profile.contextLimit
      )
        throw new Error("Choose valid context and output limits.");
      const saved = await app.device.api("connections", {
        method: "POST",
        body: profile,
      });
      app.connections = app.connections
        .filter((x) => x.id !== slot)
        .concat(saved);
      app.updateModel();
      notice("Connection configured. No paid model call was made.");
    },
    {
      help: "Use the local relay for model requests. Saving checks the profile and endpoint, without a paid model call. Context capability is your confirmation, not automatic model certification. Keys stay in memory unless you choose local persistence. File permissions are not encryption.",
      submit: "Validate and save connection",
    },
  );
  const adapter = form.elements.adapter;
  const refresh = () => {
    for (const name of ["temperature", "topP", "reasoning"]) {
      const enabled =
        form.elements[
          {
            temperature: "temperatureEnabled",
            topP: "topPEnabled",
            reasoning: "reasoningEnabled",
          }[name]
        ].checked;
      form.elements[name].disabled = !enabled;
    }
    form.elements.reasoningEnabled.disabled = adapter.value !== "responses";
    form.elements.reasoning.disabled =
      adapter.value !== "responses" || !form.elements.reasoningEnabled.checked;
    for (const name of [
      "usageEnabled",
      "storageEnabled",
      "maxCompletionTokens",
    ])
      form.elements[name].disabled = !["chat", "openrouter"].includes(
        adapter.value,
      );
  };
  form.addEventListener("change", refresh);
  refresh();
  $("#modalBody").append(
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          onClick: () => {
            form.elements.endpoint.value = endpointDefaults[adapter.value];
            notice(
              "The default endpoint was loaded. Your model and other settings are unchanged.",
            );
          },
        },
        "Use adapter default endpoint",
      ),
      el(
        "button",
        {
          onClick: () =>
            connectionPanel(app, slot === "primary" ? "helper" : "primary"),
        },
        slot === "primary" ? "Configure optional helper" : "Writing connection",
      ),
    ),
  );
}
