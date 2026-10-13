import {
  $,
  el,
  button,
  field,
  formPanel,
  panel,
  notice,
  confirmation,
  closePanel,
} from "./dom.js";
import {
  exportBackup,
  restoreBackup,
  download,
  inspectBackup,
} from "../storage/backup.js";
import { manuscriptExport } from "../export/manuscript.js";
export async function renderLibrary(app) {
  const novels = await app.repo.query("type", "novel"),
    archived = $("#showArchived").checked;
  $("#novelList").replaceChildren(
    ...novels
      .filter((n) => archived || !n.archivedAt)
      .filter((n) => {
        const term = $("#librarySearch")?.value.toLocaleLowerCase() || "";
        return (n.title + " " + (n.premise || ""))
          .toLocaleLowerCase()
          .includes(term);
      })
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((n) =>
        el(
          "article",
          { class: "novelcard" },
          el(
            "p",
            { class: "eyebrow" },
            n.archivedAt ? "ARCHIVED" : "A WORK IN PROGRESS",
          ),
          el("h3", {}, n.title),
          el("p", { class: "quiet" }, n.orderedChapterIds.length + " chapters"),
          el(
            "div",
            { class: "actions" },
            button(
              n.archivedAt ? "Recover" : "Open",
              n.archivedAt ? "recoverNovel" : "openNovel",
              { id: n.id },
              "primary",
            ),
            button("•••", "manageNovel", { id: n.id }),
          ),
        ),
      ),
  );
  if (!novels.length)
    $("#novelList").append(
      el("p", { class: "empty" }, "Your first story can start anywhere."),
    );
  const lib = await app.repo.get("library", "meta");
  $("#continueNovel").hidden = !novels.some(
    (n) => n.id === lib.activeProjectId && !n.archivedAt,
  );
}
export async function libraryAction(app, action, target) {
  const repo = app.repo;
  if (action === "newNovel") {
    await app.flush();
    formPanel(
      "A new novel",
      [field("Working title", "title", "Untitled novel")],
      async (v) =>
        app.openNovel(await repo.createNovel(v.title || "Untitled novel")),
      { submit: "Create novel" },
    );
    return true;
  }
  if (action === "openNovel") {
    await app.openNovel(target.dataset.id);
    return true;
  }
  if (action === "continueNovel") {
    await app.openNovel((await repo.get("library", "meta")).activeProjectId);
    return true;
  }
  if (action === "library") {
    await app.flush();
    $("#studio").hidden = true;
    $("#home").hidden = false;
    document.body.classList.remove("immersive");
    await renderLibrary(app);
    return true;
  }
  if (action === "manageNovel" || action === "novelDetails") {
    const n = await repo.get(target.dataset.id || app.novelId);
    formPanel(
      "Novel details",
      [
        field("Title", "title", n.title),
        field("Premise and author intent", "premise", n.premise, "textarea"),
      ],
      async (v) => {
        await repo.update({ ...(await repo.get(n.id)), ...v }, "novel.details");
        await renderLibrary(app);
        if (n.id === app.novelId) await app.renderNav();
      },
    );
    $("#modalBody").append(
      el(
        "div",
        { class: "actions" },
        button("Duplicate novel", "duplicateNovel", { id: n.id }),
        button(
          n.archivedAt ? "Recover novel" : "Archive novel",
          n.archivedAt ? "recoverNovel" : "archiveNovel",
          { id: n.id },
        ),
      ),
    );
    return true;
  }
  if (action === "duplicateNovel") {
    const data = await exportBackup(repo, target.dataset.id);
    const n = await restoreBackup(repo, data, { copy: true });
    closePanel();
    await app.openNovel(n);
    notice(
      "A separate copy was created with new identities and preserved history.",
    );
    return true;
  }
  if (action === "archiveNovel" || action === "recoverNovel") {
    const n = await repo.get(target.dataset.id);
    await repo.update(
      {
        ...n,
        archivedAt: action === "archiveNovel" ? new Date().toISOString() : null,
      },
      action,
    );
    closePanel();
    await renderLibrary(app);
    notice(
      action === "archiveNovel"
        ? "Novel archived. It can be recovered from the library."
        : "Novel recovered.",
    );
    return true;
  }
  if (action === "importText") {
    await app.flush();
    const input = el("input", {
      type: "file",
      accept: ".txt,.md,text/plain,text/markdown",
      "aria-label": "Plain text or Markdown source",
    });
    panel(
      "Import writing",
      el(
        "p",
        { class: "help" },
        "The original file stays unchanged. Its exact text becomes the first scene in a new novel.",
      ),
      input,
    );
    input.addEventListener("change", async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const n = await repo.createNovel(
          f.name.replace(/\.(txt|md)$/i, ""),
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            await f.arrayBuffer(),
          ),
        );
        closePanel();
        await app.openNovel(n);
      } catch (e) {
        notice(e.message, true);
      }
    });
    return true;
  }
  if (action === "exports") {
    await app.flush();
    panel(
      "Export manuscript",
      el(
        "p",
        { class: "help" },
        "These exports contain accepted manuscript text with chapter and scene boundaries. For history, explorations and all other records, use a full backup.",
      ),
      el(
        "div",
        { class: "actions" },
        ...["txt", "md", "html"].map((format) =>
          el(
            "button",
            {
              onClick: async () => {
                try {
                  const text = await manuscriptExport(
                    repo,
                    app.novelId,
                    format,
                  );
                  download(
                    "novel." + format,
                    text,
                    format === "html" ? "text/html" : "text/plain",
                  );
                } catch (e) {
                  notice(e.message, true);
                }
              },
            },
            format === "txt"
              ? "Plain text"
              : format === "md"
                ? "Markdown"
                : "Printable HTML",
          ),
        ),
      ),
    );
    return true;
  }
  if (action === "backups") {
    await app.flush();
    await app.drafts.flush();
    await backupPanel(app);
    return true;
  }
  return false;
}
async function backupPanel(app) {
  const repo = app.repo,
    device = app.device;
  if (!device.token) {
    const status = await device.connect();
    if (status) {
      app.connections = status.connections || [];
      app.updateModel();
    }
  }

  const readFile = el("input", {
    type: "file",
    accept: ".json,application/json",
    "aria-label": "Cozy Novel backup",
  });
  panel(
    "Backups and recovery",
    el(
      "p",
      { class: "help" },
      "A full backup keeps exact text, revision history, candidates, Story Bible records and exploration branches. Credentials are excluded. Browser storage is not an independent backup.",
    ),
    el("p", {}, device.state),
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          class: "primary",
          onClick: async () =>
            download(
              "CozyNovel-backup.json",
              JSON.stringify(await exportBackup(repo)),
            ),
        },
        "Download full backup",
      ),
      el(
        "button",
        {
          onClick: async () =>
            download(
              "CozyNovel-novel.json",
              JSON.stringify(await exportBackup(repo, app.novelId)),
            ),
        },
        "Back up this novel",
      ),
      el(
        "button",
        {
          onClick: async () => {
            try {
              const result = await device.api("backups", {
                method: "POST",
                body: {},
              });
              notice("Device snapshot created: " + result.snapshot);
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        "Create device snapshot",
      ),
    ),
    el("h3", {}, "Restore or import a copy"),
    readFile,
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          onClick: async () => {
            try {
              const data = await device.deviceSnapshot();
              download("CozyNovel-device.json", JSON.stringify(data));
              notice(
                "Device version downloaded. Your browser version remains intact.",
              );
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        "Download device version",
      ),
      el(
        "button",
        {
          onClick: async () => {
            try {
              const data = await device.deviceSnapshot();
              await showRestore(app, data, "Device library");
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        "Recover from device",
      ),
      el(
        "button",
        {
          onClick: async () => {
            try {
              await device.recoverRestore();
              await app.flush();
              await device.flush();
              await backupPanel(app);
            } catch (error) {
              notice(error.message, true);
            }
          },
        },
        "Check interrupted device restore",
      ),
      el(
        "button",
        {
          onClick: async () => {
            try {
              const staged = await device.restoreDevice();
              confirmation(
                "Replace device library?",
                "This will replace the device library with your browser library. A device recovery snapshot will be created first. Novels: " +
                  staged.preview.titles.join(", "),
                staged.commit,
                "Save browser library to device",
              );
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        "Preview device restore",
      ),
    ),
    el("h3", {}, "Browser recovery snapshots"),
    el(
      "p",
      { class: "help" },
      "A snapshot is retained here before each browser restore.",
    ),
    el("div", { id: "recoveryList" }),
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          onClick: async () => {
            const persisted = await navigator.storage?.persist?.();
            const estimate = await navigator.storage?.estimate?.();
            notice(
              `Persistent browser storage: ${persisted ? "granted" : "not granted or unavailable"}. Used ${Math.round((estimate?.usage || 0) / 1024 / 1024)} MB of about ${Math.round((estimate?.quota || 0) / 1024 / 1024)} MB.`,
            );
          },
        },
        "Request persistent browser storage",
      ),
      el(
        "button",
        {
          onClick: async () => {
            const jobs = await repo.query("type", "job");
            download(
              "CozyNovel-diagnostic.json",
              JSON.stringify({
                application: "cozyNovel",
                version: "1.0.0",
                device: device.state,
                counts: {
                  novels: (await repo.query("type", "novel")).length,
                  jobs: jobs.length,
                },
                jobStates: jobs.map((j) => ({ kind: j.kind, state: j.state })),
                browser: navigator.userAgent,
              }),
            );
          },
        },
        "Redacted diagnostic",
      ),
    ),
  );
  for (const r of await repo.all("recovery"))
    $("#recoveryList").append(
      el(
        "button",
        { onClick: () => showRestore(app, r.backup, "Browser snapshot") },
        r.createdAt,
      ),
    );
  readFile.addEventListener("change", async () => {
    try {
      const f = readFile.files[0];
      if (f) await showRestore(app, JSON.parse(await f.text()), f.name);
    } catch (e) {
      notice(e.message, true);
    }
  });
}
async function showRestore(app, data, label) {
  const info = await inspectBackup(data);
  panel(
    "Review " + label,
    el(
      "p",
      {},
      `${info.novels.join(", ")}. ${info.scenes} scenes and ${info.revisions} revisions.`,
    ),
    el(
      "p",
      { class: "help" },
      "Import a copy gives every record a new identity. Restore replaces the current browser library after saving a recovery snapshot, and changes its generation. Device replacement requires a separate preview.",
    ),
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          class: "primary",
          onClick: async () => {
            try {
              const n = await restoreBackup(app.repo, data, { copy: true });
              closePanel();
              await app.openNovel(n);
            } catch (e) {
              notice(e.message, true);
            }
          },
        },
        "Import as separate copies",
      ),
      el(
        "button",
        {
          onClick: () =>
            confirmation(
              "Restore this library?",
              "Replace the browser library with " +
                info.novels.join(", ") +
                "? A recovery snapshot of your current work will be retained.",
              async () => {
                app.writer.dispose();
                await restoreBackup(app.repo, data);
                app.sceneId = null;
                app.novelId = null;
                app.dirty = false;
                $("#studio").hidden = true;
                $("#home").hidden = false;
                await renderLibrary(app);
                notice(
                  "Browser library restored. Open Backups to review device synchronization.",
                );
              },
              "Restore library",
            ),
        },
        "Restore browser library",
      ),
    ),
  );
}
