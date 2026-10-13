import { $, el, field, panel, formPanel, notice, closePanel } from "./dom.js";
import { id, now, textBlob } from "../core/ids.js";
export async function authorToolsAction(app, action) {
  if (!["authorTools", "draftRecovery", "styles"].includes(action))
    return false;
  if (!app.novelId) throw new Error("Open a novel first.");
  await app.flush();
  await app.drafts.flush();
  if (action === "styles") {
    await styles(app);
    return true;
  }
  const records = await app.repo.query("novelId", app.novelId);
  if (action === "draftRecovery") {
    const drafts = records.filter((r) =>
      ["creativeDraft", "creativeDraftConflict"].includes(r.kind),
    );
    panel(
      "Creative draft recovery",
      el(
        "p",
        { class: "help" },
        "Unsent directions, questions and actions stay outside the manuscript and story facts. These copies are included in full backups.",
      ),
      ...(await Promise.all(
        drafts.map(async (r) =>
          el(
            "article",
            { class: "storycard" },
            el("h3", {}, r.draftKind || r.kind),
            el("small", {}, r.ownerId),
            el("pre", { class: "receipt" }, await app.repo.text(r.textBlobId)),
          ),
        ),
      )),
    );
    return true;
  }
  const refs = records.filter((r) => r.kind === "reference");
  const director = el("textarea", {
    "aria-label": "Guidance or craft question",
    rows: 3,
    placeholder: "A chapter goal, a pacing question, or a passage to review.",
  });
  await app.drafts.bind(director, {
    novelId: app.novelId,
    ownerId: app.sceneId,
    kind: "craft",
  });
  const scope = field("Author tool scope", "craftScope", "scene", "select", [
    "selection",
    "scene",
    "chapter",
    "overview",
    "sources",
  ]);
  const resultArea = el("div");
  const run = async (kind) => {
    const novelId = app.novelId,
      sceneId = app.sceneId,
      direction = director.value;
    if (!direction.trim()) throw new Error("Describe the guidance you want.");
    const preview = el("div", { class: "prose" });
    resultArea.replaceChildren(preview);
    const result = await app.writer.run({
      novelId,
      sceneId,
      kind,
      direction,
      scope: scope.querySelector("select").value,
      sourceIds: app.sourceIds,
      range: app.selection,
      connection: await app.requestConnection(false, novelId),
      onDelta: (t) => (preview.textContent = t),
    });
    const blob = await textBlob(result.text);
    await app.repo.commit({
      novelId,
      kind: "craft.review",
      records: [
        {
          id: id("artifact"),
          type: "artifact",
          novelId,
          sceneId,
          kind: kind === "director" ? "sceneGuidance" : "craftReview",
          textBlobId: blob.id,
          sourceRefs: result.snapshot.sourceIds.map((id) => ({ id })),
          contextSnapshot: result.snapshot,
          receiptId: result.receiptId,
          freshness: result.stale ? "stale" : "fresh",
          createdAt: now(),
        },
      ],
      blobs: [blob],
    });
    if (
      kind === "editor" &&
      result.snapshot.selectionOptions?.range?.[1] >
        result.snapshot.selectionOptions?.range?.[0]
    )
      resultArea.append(
        el(
          "button",
          {
            onClick: async () => {
              if (app.novelId !== novelId || app.sceneId !== sceneId)
                throw new Error(
                  "Open this review's original scene before proposing its edit.",
                );
              const current = await app.repo.get(sceneId);
              if (current.currentRevisionId !== result.snapshot.revisionId)
                throw new Error(
                  "The reviewed source changed. History preserves the original; compare it and deliberately select a new target.",
                );
              closePanel();
              await app.generate("revise", {
                range: result.snapshot.selectionOptions.range,
                expectedRevisionId: result.snapshot.revisionId,
                direction:
                  "Propose a replacement for only the selected passage using these optional craft notes:\n" +
                  result.text,
              });
            },
          },
          "Propose reviewed selection revision",
        ),
      );
    notice(
      "Saved for author review. Guidance does not establish events or rewrite text.",
    );
  };
  const addReference = () => {
    const file = el("input", {
        type: "file",
        accept: ".txt,.md,text/plain,text/markdown",
        "aria-label": "Reference file",
      }),
      title = field("Reference title", "title", ""),
      text = field("Reference text, preserved exactly", "body", "", "textarea");
    const form = formPanel(
      "Add a deliberate reference",
      [title, text],
      async (v) => {
        const novelId = app.novelId,
          blob = await textBlob(v.body);
        await app.repo.commit({
          novelId,
          kind: "reference.add",
          records: [
            {
              id: id("artifact"),
              type: "artifact",
              novelId,
              kind: "reference",
              title: v.title || "Reference",
              textBlobId: blob.id,
              sourceRefs: [],
              importProvenance: {
                fileName: file.files?.[0]?.name || null,
                importedAt: now(),
                textIdentity: blob.id,
              },
              createdAt: now(),
            },
          ],
          blobs: [blob],
        });
        notice(
          "Reference saved. Choose it as a source when useful. It is not story canon.",
        );
      },
      {
        help: "Plain text and Markdown remain inert reference material. No source file is changed.",
      },
    );
    form.prepend(file);
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (f) {
        form.elements.title.value = f.name;
        form.elements.body.value = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await f.arrayBuffer());
      }
    });
  };
  const recall = async () => {
    const novelId = app.novelId,
      sceneId = app.sceneId;
    const scenes = records.filter((r) => r.type === "scene");
    const catalog = [];
    for (const s of scenes) {
      const r = await app.repo.get(s.currentRevisionId);
      catalog.push({
        id: r.id,
        title: s.title,
        summary: s.summary || "",
        originalExcerpt: (await app.repo.text(r.textBlobId)).slice(0, 1600),
      });
    }
    const result = await app.writer.run({
      novelId,
      sceneId,
      kind: "recall",
      connection: await app.requestConnection(true, novelId),
      auxiliary: true,
      direction:
        "Author search: " +
        director.value +
        "\nReturn only relevant IDs from this catalogue. Excerpts are original fragments, not complete readings.\n" +
        JSON.stringify(catalog),
      scope: "selection",
      range: [0, 0],
    });
    if (result.stale)
      throw new Error(
        "The search sources changed. The original selector output is retained in its job; choose sources again before applying it.",
      );
    const output = JSON.parse(result.text),
      ids = Array.isArray(output.sourceIds) ? output.sourceIds : [];
    const allowed = new Set(catalog.map((s) => s.id));
    if (!ids.every((id) => allowed.has(id)))
      throw new Error(
        "The selector returned an unknown source. Existing choices remain.",
      );
    app.sourceIds = ids;
    await app.repo.update(
      {
        id: id("artifact"),
        type: "artifact",
        novelId,
        sceneId,
        kind: "recallSelection",
        body: { sourceIds: ids, question: director.value },
        sourceRefs: ids.map((id) => ({ id })),
        createdAt: now(),
      },
      "recall.selection",
    );
    notice(
      "Selected " +
        ids.length +
        " original sources. Writing still applies temporal eligibility and its normal budget. Inspect or change these through Choose sources.",
    );
  };
  panel(
    "Plans, craft and references",
    el(
      "p",
      { class: "help" },
      "The Director suggests possibilities. The Editor offers optional craft observations. Neither changes your manuscript or established story. Smart recall is an explicit optional helper request and may use tokens.",
    ),
    director,
    scope,
    el(
      "div",
      { class: "actions" },
      el("button", { onClick: () => run("director") }, "Ask the Director"),
      el("button", { onClick: () => run("editor") }, "Ask the Literary Editor"),
      el("button", { onClick: recall }, "Smart recall"),
      el(
        "button",
        { onClick: () => app.action("selectSources", {}) },
        "Choose original sources",
      ),
      el("button", { onClick: addReference }, "Add reference"),
      el("button", { onClick: () => styles(app) }, "Reusable styles"),
    ),
    resultArea,
    el("h3", {}, "Reference library"),
    ...refs.map((r) =>
      el(
        "article",
        { class: "storycard" },
        el("strong", {}, r.title),
        el(
          "button",
          {
            onClick: async () =>
              panel(
                r.title,
                el(
                  "pre",
                  { class: "receipt" },
                  await app.repo.text(r.textBlobId),
                ),
                el(
                  "button",
                  {
                    onClick: () => {
                      app.sourceIds = [...new Set([...app.sourceIds, r.id])];
                      notice(
                        "Reference selected for the next scoped request. It remains reference material.",
                      );
                      closePanel();
                    },
                  },
                  "Use as reference source",
                ),
              ),
          },
          "Read reference",
        ),
      ),
    ),
    el("h3", {}, "Saved guidance and craft reviews"),
    ...(await Promise.all(
      records
        .filter((r) => ["sceneGuidance", "craftReview"].includes(r.kind))
        .map(async (r) =>
          el(
            "details",
            { class: "storycard" },
            el(
              "summary",
              {},
              r.kind === "sceneGuidance"
                ? "Director guidance"
                : "Literary Editor review",
            ),
            el("pre", { class: "receipt" }, await app.repo.text(r.textBlobId)),
          ),
        ),
    )),
  );
  return true;
}
async function styles(app) {
  const stored = (await app.repo.get("stylePresets", "meta")) || {
    id: "stylePresets",
    items: [],
  };
  panel(
    "Reusable literary styles",
    el(
      "p",
      { class: "help" },
      "A style changes future writing instructions. Existing prose and original voice samples stay exact.",
    ),
    el(
      "button",
      {
        class: "primary",
        onClick: () =>
          formPanel(
            "Save this novel’s style",
            [field("Style name", "name", "")],
            async (v) => {
              const n = await app.repo.get(app.novelId);
              const latest = (await app.repo.get("stylePresets", "meta")) || {
                id: "stylePresets",
                items: [],
              };
              latest.items.push({
                id: id("style"),
                name: v.name || "My literary style",
                profile: structuredClone(n.styleProfile),
              });
              await app.repo.localPut(latest);
              notice("Style saved.");
            },
          ),
      },
      "Save current style",
    ),
    ...stored.items.map((p) =>
      el(
        "article",
        { class: "storycard" },
        el("h3", {}, p.name),
        el(
          "button",
          {
            onClick: async () => {
              const n = await app.repo.get(app.novelId);
              await app.repo.update(
                { ...n, styleProfile: structuredClone(p.profile) },
                "style.preset",
              );
              notice("Style applied to future requests.");
              closePanel();
            },
          },
          "Apply style",
        ),
        el(
          "button",
          {
            onClick: () =>
              formPanel(
                "Rename style",
                [field("Style name", "name", p.name)],
                async (v) => {
                  p.name = v.name;
                  await app.repo.localPut(stored);
                },
              ),
          },
          "Rename",
        ),
        el(
          "button",
          {
            onClick: async () => {
              stored.items = stored.items.filter((x) => x.id !== p.id);
              await app.repo.localPut(stored);
              await styles(app);
            },
          },
          "Remove",
        ),
      ),
    ),
  );
}
