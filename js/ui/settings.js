import { connectionManager } from "./connections.js";
import { $, el, field, formPanel, panel, notice } from "./dom.js";
import { id, now } from "../core/ids.js";
import { TEMPLATES } from "../ai/prompts/templates.js";
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
        field("Line spacing", "leading", prefs.leading || 1.8, "number"),
        field("Manuscript surface", "paper", prefs.paper || "cream", "select", [
          "cream",
          "night",
        ]),
        field(
          "Room background",
          "background",
          prefs.background || "room",
          "select",
          [
            { value: "room", label: "Rainy window" },
            { value: "cat", label: "Library and cat on mobile" },
            { value: "none", label: "Solid colour, minimal decoration" },
          ],
        ),
        field(
          "Tint dialogue in reading view",
          "dialogue",
          prefs.dialogue,
          "checkbox",
        ),
      ],
      async (v) => {
        const p = {
          id: "appearance",
          theme: v.theme,
          leading: Math.max(1.3, Math.min(2.4, Number(v.leading))),
          paper: v.paper,
          background: v.background,
          dialogue: v.dialogue,
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
    await connectionManager(app);
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
          field(
            "Story Brain",
            "storyMode",
            n.storyMode ?? (n.autoSuggestions === false ? "off" : "auto"),
            "select",
            [
              {
                value: "auto",
                label: "Maintain clear derived state automatically",
              },
              { value: "review", label: "Review proposals before applying" },
              { value: "off", label: "Off" },
            ],
          ),
        ),
      async (v) => {
        const { autoSuggestions, storyMode, ...styleProfile } = v;
        await app.repo.withMutation(async () => {
          const current = await app.repo.get(n.id);
          await app.repo.commitLocked({
            novelId: n.id,
            kind: "style.update",
            expectedRecord: { id: n.id, version: current.recordVersion || 0 },
            records: [{ ...current, styleProfile, autoSuggestions, storyMode }],
          });
        });
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
  document.documentElement.dataset.background = p.background || "room";
  document.documentElement.dataset.paper = p.paper || "cream";
  document.documentElement.style.setProperty("--leading", p.leading || 1.8);
  document.documentElement.style.setProperty(
    "--dialogueink",
    p.dialogue
      ? p.paper === "night"
        ? "#e7c892"
        : "#795423"
      : "var(--paperink)",
  );
  document.documentElement.style.setProperty("--reading", p.size + "px");
  document.documentElement.style.setProperty("--measure", p.width + "px");
}
