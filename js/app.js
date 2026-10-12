import { Repository } from "./storage/repository.js";
import { DeviceSync } from "./storage/sync.js";
import { Writer } from "./ai/jobs.js";
import { analyze } from "./ai/analysis.js";
import { revise, acceptCandidate, reorder } from "./novel/operations.js";
import { $, el, button, notice, closePanel } from "./ui/dom.js";
import { renderLibrary, libraryAction } from "./ui/library.js";
import { renderNav, manuscriptAction } from "./ui/manuscript.js";
import { settingsAction, applyAppearance } from "./ui/settings.js";
import { renderBible, storyAction, showMemoryProposals } from "./ui/story.js";
import { rpAction } from "./ui/rp.js";
import { partnerAction, renderDiscussion } from "./ui/partner.js";
import { DEFAULT_CONNECTION } from "./config.js";
export const moduleDescriptor = Object.freeze({
  moduleId: "cozyNovel",
  protocolVersion: 1,
  displayName: "Cozy Novel",
  standaloneEntry: "./index.html",
  importSchemas: ["cozyNovel.backup/1", "text/plain", "text/markdown"],
  exportSchemas: [
    "cozyNovel.backup/1",
    "text/plain",
    "text/markdown",
    "text/html",
  ],
  mount,
  dispose: (app) => app.dispose(),
});
export async function mount(root = document.querySelector("#app")) {
  if (!root) throw new Error("Cozy Novel requires its own application root.");
  const app = new Studio(root);
  await app.start();
  return Object.freeze({
    moduleId: "cozyNovel",
    dispose: () => app.dispose(),
    setTheme: (theme) => {
      if (["light", "dark"].includes(theme))
        document.documentElement.dataset.theme = theme;
    },
  });
}
class Studio {
  constructor(root) {
    this.root = root;
    this.events = new AbortController();
    this.editor = $("#editor");
    this.novelId = null;
    this.sceneId = null;
    this.revisionId = null;
    this.selection = null;
    this.candidateId = null;
    this.dirty = false;
    this.composing = false;
    this.savePromise = Promise.resolve();
    this.connections = [];
    this.sourceIds = [];
    this.drag = null;
  }
  async start() {
    this.repo = await Repository.open();
    this.device = new DeviceSync(
      this.repo,
      (s) => ($("#deviceStatus").textContent = s),
    );
    this.writer = new Writer(this.repo, this.device);
    await applyAppearance(await this.repo.get("appearance", "meta"));
    await renderLibrary(this);
    await this.writer.recoverInterrupted();
    const signal = this.events.signal;
    this.root.addEventListener(
      "click",
      (e) => {
        const b = e.target.closest("[data-action]");
        if (b)
          this.action(b.dataset.action, b).catch((err) =>
            notice(err.message, true),
          );
      },
      { signal },
    );
    $("#homeButton").addEventListener(
      "click",
      () => this.action("library", {}).catch((e) => notice(e.message, true)),
      { signal },
    );
    $("#closeModal").addEventListener("click", closePanel, { signal });
    $("#showArchived").addEventListener("change", () => renderLibrary(this), {
      signal,
    });
    this.editor.addEventListener(
      "compositionstart",
      () => {
        this.composing = true;
      },
      { signal },
    );
    this.editor.addEventListener(
      "compositionend",
      () => {
        this.composing = false;
        this.input();
      },
      { signal },
    );
    this.editor.addEventListener("input", () => this.input(), { signal });
    for (const event of ["select", "keyup", "pointerup"])
      this.editor.addEventListener(
        event,
        () => {
          this.selection = [
            this.editor.selectionStart,
            this.editor.selectionEnd,
          ];
        },
        { signal },
      );
    window.addEventListener(
      "beforeunload",
      (e) => {
        if (this.dirty) {
          e.preventDefault();
          e.returnValue = "";
        }
      },
      { signal },
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") this.flush().catch(() => {});
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (!this.root.contains(document.activeElement)) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          this.flush().catch((err) => notice(err.message, true));
        }
        if (e.key === "Escape") document.body.classList.remove("immersive");
      },
      { signal },
    );
    $("#chapterList").addEventListener(
      "dragstart",
      (e) => {
        const s = e.target.closest("[data-scene]");
        if (s) {
          this.drag = { id: s.dataset.scene, owner: s.dataset.owner };
          e.dataTransfer.setData("text/plain", s.dataset.scene);
        }
      },
      { signal },
    );
    $("#chapterList").addEventListener(
      "dragover",
      (e) => {
        if (e.target.closest("[data-scene]")) e.preventDefault();
      },
      { signal },
    );
    $("#chapterList").addEventListener(
      "drop",
      async (e) => {
        const s = e.target.closest("[data-scene]");
        if (!s || !this.drag) return;
        e.preventDefault();
        if (s.dataset.owner !== this.drag.owner) {
          notice(
            "Use scene details to keep chapter ownership explicit. Dragging reorders within a chapter.",
          );
          return;
        }
        try {
          await this.flush();
          const c = await this.repo.get(this.drag.owner);
          await reorder(
            this.repo,
            c.id,
            "orderedSceneIds",
            this.drag.id,
            c.orderedSceneIds.indexOf(s.dataset.scene) -
              c.orderedSceneIds.indexOf(this.drag.id),
          );
          await this.renderNav();
        } catch (err) {
          notice(err.message, true);
        }
      },
      { signal },
    );
    this.unsubscribe = this.repo.subscribe((op) => {
      if (op.kind === "library.restore" && op.generation) {
        this.writer.dispose();
      }
      if (op.novelId === this.novelId && this.sceneId)
        this.checkExternal().catch(() => {});
    });
    const status = await this.device.connect();
    this.connections = status?.connections || [];
    this.updateModel();
    await this.device.flush();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(new URL("../sw.js", import.meta.url), {
          scope: new URL("../", import.meta.url).pathname,
        })
        .then((reg) => {
          this.registration = reg;
          const waiting = () => {
            if (reg.waiting) {
              notice(
                "An application update is ready. Save and refresh when you are ready.",
              );
              const b = button("Save and refresh", "updateApp");
              $("#notice").append(" ", b);
            }
          };
          waiting();
          reg.addEventListener(
            "updatefound",
            () => {
              reg.installing?.addEventListener("statechange", waiting);
            },
            { signal },
          );
        })
        .catch(() => {});
    }
  }
  input() {
    this.dirty = true;
    $("#saveStatus").textContent = "Unsaved changes";
    $("#wordCount").textContent =
      (this.editor.value.match(/\S+/g) || []).length + " words";
    $("#suggestions").replaceChildren();
    clearTimeout(this.saveTimer);
    if (!this.composing)
      this.saveTimer = setTimeout(
        () => this.flush().catch((e) => notice(e.message, true)),
        850,
      );
  }
  async flush() {
    clearTimeout(this.saveTimer);
    if (this.composing)
      throw new Error(
        "Finish the current text composition before switching work.",
      );
    this.savePromise = this.savePromise
      .catch(() => {})
      .then(async () => {
        if (!this.dirty || !this.sceneId) return;
        const sceneId = this.sceneId,
          base = this.revisionId,
          text = this.editor.value;
        $("#saveStatus").textContent = "Saving";
        try {
          const revision = await revise(this.repo, sceneId, base, text);
          if (this.sceneId === sceneId) {
            this.revisionId = revision.id;
            this.dirty = this.editor.value !== text;
            $("#saveStatus").textContent = this.dirty
              ? "Unsaved changes"
              : "Saved in browser";
          }
        } catch (e) {
          this.dirty = true;
          $("#saveStatus").textContent = "Save failed. Text is still here.";
          notice(
            e.message +
              " Copy your visible text or use the emergency download below.",
            true,
          );
          const b = el(
            "button",
            {
              onClick: () => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(
                  new Blob([this.editor.value], { type: "text/plain" }),
                );
                a.download = "CozyNovel-visible-draft.txt";
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              },
            },
            "Download visible draft",
          );
          $("#notice").append(" ", b);
          throw e;
        }
      });
    await this.savePromise;
    if (this.dirty) await this.flush();
  }
  async checkExternal() {
    if (!this.sceneId) return;
    const s = await this.repo.get(this.sceneId);
    if (s && s.currentRevisionId !== this.revisionId && this.dirty)
      $("#saveStatus").textContent =
        "Changed elsewhere. Your visible draft is retained.";
  }
  async openNovel(id) {
    await this.flush();
    if (this.sceneId) await this.saveDirection();
    const n = await this.repo.get(id);
    if (!n || n.type !== "novel") throw new Error("Novel not found.");
    this.novelId = id;
    this.sourceIds = [];
    const lib = await this.repo.get("library", "meta");
    await this.repo.localPut({ ...lib, activeProjectId: id });
    let first = (await this.repo.get("activeScene." + id, "meta"))?.sceneId;
    if (first && !(await this.repo.get(first))) first = null;
    for (const cid of n.orderedChapterIds) {
      const c = await this.repo.get(cid);
      if (!first && c.orderedSceneIds.length) {
        first = c.orderedSceneIds[0];
        break;
      }
    }
    if (!first) throw new Error("This novel has no scenes.");
    $("#home").hidden = true;
    $("#studio").hidden = false;
    await this.loadScene(first);
    await renderDiscussion(this);
    await renderBible(this);
  }
  async saveDirection() {
    if (this.sceneId)
      await this.repo.localPut({
        id: "direction." + this.sceneId,
        value: $("#direction").value,
        selection: this.selection,
        scrollTop: $(".writingSurface").scrollTop,
        editorScrollTop: this.editor.scrollTop,
      });
  }
  async openScene(id) {
    await this.flush();
    await this.saveDirection();
    await this.loadScene(id);
  }
  async loadScene(id) {
    const switching = id !== this.sceneId;
    const { scene, revision, text } = await this.repo.sceneText(id);
    if (scene.novelId !== this.novelId)
      throw new Error("Scene belongs to another novel.");
    this.sceneId = id;
    this.revisionId = revision.id;
    this.editor.value = text;
    this.editor.hidden = false;
    this.dirty = false;
    this.selection = [text.length, text.length];
    this.candidateId = null;
    $("#readingView").hidden = true;
    $("#candidateBox").hidden = true;
    $("#suggestions").replaceChildren();
    $("#memoryProposals").replaceChildren();
    $("#sceneTitle").textContent = scene.title;
    const chapter = await this.repo.get(scene.chapterId);
    $("#scenePath").textContent = chapter.title;
    $("#sceneNumber").textContent =
      scene.status.toUpperCase() +
      " · " +
      (scene.timeLabel || "A MOMENT IN YOUR STORY");
    const position = await this.repo.get("direction." + id, "meta");
    if (switching) $("#direction").value = position?.value || "";
    $("#saveStatus").textContent = "Saved in browser";
    $("#wordCount").textContent = (text.match(/\S+/g) || []).length + " words";
    this.panel("manuscript");
    await this.renderNav();
    const candidates = (await this.repo.query("sceneId", id))
      .filter(
        (r) =>
          r.type === "candidate" &&
          ["ready", "partial", "stale"].includes(r.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (candidates[0]) await this.showCandidate(candidates[0].id);
    else await this.renderSuggestions();
    if (switching) {
      $(".writingSurface").scrollTop = position?.scrollTop || 0;
      this.editor.scrollTop = position?.editorScrollTop || 0;
      if (position?.selection) {
        this.selection = position.selection.map((x) =>
          Math.min(text.length, x),
        );
        this.editor.setSelectionRange(...this.selection);
      }
    }
    await this.repo.localPut({
      id: "activeScene." + this.novelId,
      sceneId: id,
    });
  }
  renderNav() {
    return renderNav(this);
  }
  panel(name) {
    $(".workspace").dataset.panel = name;
    if (["partner", "bible"].includes(name)) this.sideTab(name);
  }
  sideTab(name) {
    $("#partner").hidden = name !== "partner";
    $("#bible").hidden = name !== "bible";
    for (const b of this.root.querySelectorAll("[data-action=sideTab]"))
      b.setAttribute("aria-selected", b.dataset.tab === name);
  }
  connection(helper = false) {
    return (
      (helper ? this.connections.find((c) => c.id === "helper") : null) ||
      this.connections.find((c) => c.id === "primary") || {
        ...DEFAULT_CONNECTION,
      }
    );
  }
  updateModel() {
    $("#modelStatus").textContent =
      this.connection().model || "No model connected";
  }
  async generate(kind, options = {}) {
    await this.flush();
    await this.saveDirection();
    const novelId = this.novelId,
      sceneId = this.sceneId;
    const direction = options.direction ?? $("#direction").value;
    if (!direction.trim() && kind === "write")
      throw new Error("Give the writer a glimpse of your scene first.");
    $("#cancelGeneration").hidden = false;
    $("#candidateBox").hidden = false;
    $("#candidateText").textContent = "";
    $("#candidateState").textContent = "Writing";
    $("#suggestions").replaceChildren();
    try {
      const result = await this.writer.run({
        connection: this.connection(),
        novelId,
        sceneId,
        kind,
        direction:
          direction || "Continue the current scene by one meaningful beat.",
        ...options,
        onDelta: (text, c) => {
          if (sceneId === this.sceneId && novelId === this.novelId) {
            this.candidateId = c?.id;
            $("#candidateBox").hidden = false;
            $("#candidateText").textContent = text;
          }
        },
      });
      if (sceneId === this.sceneId && novelId === this.novelId) {
        await this.showCandidate(result.candidate.id);
        notice("A new passage is ready for your review.");
        const n = await this.repo.get(novelId);
        if (n.autoSuggestions)
          this.analyze(result.candidate.id).catch((e) =>
            notice("Passage saved. Optional suggestions: " + e.message),
          );
      }
    } catch (e) {
      if (e.candidate && sceneId === this.sceneId)
        await this.showCandidate(e.candidate.id);
      else if (sceneId === this.sceneId) $("#candidateBox").hidden = true;
      throw e;
    } finally {
      $("#cancelGeneration").hidden = true;
    }
  }
  async showCandidate(id) {
    const c = await this.repo.get(id);
    this.candidateId = id;
    $("#candidateBox").hidden = false;
    $("#candidateText").textContent = await this.repo.text(c.textBlobId);
    const scene = await this.repo.get(c.sceneId);
    const stale = scene.currentRevisionId !== c.baseRevisionId;
    $("#candidateState").textContent =
      stale && c.status !== "kept"
        ? "Source changed. Compare first."
        : c.status;
    const keep = this.root.querySelector("[data-action=acceptCandidate]");
    keep.disabled = stale || !["ready", "partial"].includes(c.status);
    await this.renderSuggestions();
  }
  async analyze(candidateId = null) {
    const novelId = this.novelId,
      sceneId = this.sceneId;
    const artifact = await analyze(this.writer, {
      connection: this.connection(true),
      novelId,
      sceneId,
      direction:
        "Suggest three possible next directions and at most three directly sourced observations.",
      candidateId,
    });
    if (novelId === this.novelId && sceneId === this.sceneId) {
      await this.renderSuggestions(artifact);
      await showMemoryProposals(this, artifact);
    }
  }
  async renderSuggestions(artifact = null) {
    const records = await this.repo.query("sceneId", this.sceneId);
    if (!artifact)
      artifact = records
        .filter(
          (r) =>
            r.type === "artifact" &&
            r.kind === "analysis" &&
            r.freshness === "fresh",
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    $("#suggestions").replaceChildren();
    if (!artifact || artifact.freshness !== "fresh") return;
    const source = artifact.candidateId
      ? await this.repo.get(artifact.candidateId)
      : null;
    const scene = await this.repo.get(this.sceneId);
    const acceptance =
      source?.status === "kept"
        ? (await this.repo.get(scene.currentRevisionId)).candidateId ===
          source.id
        : false;
    if (source && source.id !== this.candidateId && !acceptance) return;
    if (source && !["ready", "kept"].includes(source.status)) return;
    if (!acceptance && scene.currentRevisionId !== artifact.baseRevisionId)
      return;
    for (const text of artifact.body.suggestions) {
      const needsKeep = source && source.status === "ready";
      const b = el(
        "button",
        {
          onClick: async () => {
            try {
              await this.flush();
              if (needsKeep) {
                await acceptCandidate(this.repo, source.id);
                await this.loadScene(this.sceneId);
              }
              $("#direction").value = text;
              await this.generate("continue", { direction: text });
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        (needsKeep ? "Keep this passage and continue: " : "Continue: ") + text,
      );
      $("#suggestions").append(b);
    }
    await showMemoryProposals(this, artifact);
  }
  async action(action, target) {
    if (action === "panel") {
      this.panel(target.dataset.panel);
      return;
    }
    if (action === "updateApp") {
      await this.flush();
      if (this.writer.foreground)
        throw new Error("Finish or stop generation before refreshing.");
      this.registration?.waiting?.postMessage({
        type: "activate",
        owner: "cozyNovel",
      });
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => location.reload(),
        { once: true },
      );
      return;
    }
    for (const handler of [
      libraryAction,
      settingsAction,
      manuscriptAction,
      storyAction,
      rpAction,
      partnerAction,
    ])
      if (await handler(this, action, target)) return;
  }
  async dispose() {
    await this.flush();
    await this.saveDirection();
    clearTimeout(this.saveTimer);
    this.writer.dispose();
    this.device.dispose();
    this.unsubscribe();
    this.events.abort();
    this.repo.dispose();
  }
}
if (document.querySelector("#app"))
  mount().catch((e) =>
    notice("Cozy Novel could not open its working store. " + e.message, true),
  );
