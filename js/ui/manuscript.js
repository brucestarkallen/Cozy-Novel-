import {
  $,
  el,
  button,
  field,
  formPanel,
  panel,
  notice,
  closePanel,
} from "./dom.js";
import { id, now } from "../core/ids.js";
import {
  addChapter,
  updateScene,
  addScene,
  reorder,
  revise,
  acceptCandidate,
  placeCandidate,
} from "../novel/operations.js";
export async function renderNav(app) {
  const n = await app.repo.get(app.novelId);
  $("#novelTitle").textContent = n.title;
  $("#chapterList").replaceChildren();
  for (const cid of n.orderedChapterIds) {
    const c = await app.repo.get(cid);
    const section = el(
      "section",
      { class: "chapter", "data-chapter": cid },
      el(
        "div",
        { class: "chapterhead" },
        button(c.title, "chapterDetails", { id: cid }),
        button(
          "↑",
          "reorder",
          { owner: n.id, key: "orderedChapterIds", id: cid, delta: -1 },
          "orderbutton",
        ),
        button(
          "↓",
          "reorder",
          { owner: n.id, key: "orderedChapterIds", id: cid, delta: 1 },
          "orderbutton",
        ),
      ),
    );
    for (const sid of c.orderedSceneIds) {
      const s = await app.repo.get(sid);
      section.append(
        el(
          "div",
          {
            class: "sceneitem" + (sid === app.sceneId ? " active" : ""),
            draggable: "true",
            "data-scene": sid,
            "data-owner": cid,
          },
          button(s.title, "openScene", { id: sid }),
          button(
            "↑",
            "reorder",
            { owner: cid, key: "orderedSceneIds", id: sid, delta: -1 },
            "orderbutton",
          ),
          button(
            "↓",
            "reorder",
            { owner: cid, key: "orderedSceneIds", id: sid, delta: 1 },
            "orderbutton",
          ),
        ),
      );
    }
    $("#chapterList").append(section);
  }
}
export async function manuscriptAction(app, action, target) {
  const repo = app.repo;
  if (action === "openScene") {
    await app.openScene(target.dataset.id);
    return true;
  }
  if (action === "newChapter") {
    await app.flush();
    formPanel(
      "A new chapter",
      [
        field("Chapter title", "title", "New chapter"),
        field(
          "Continue from the current scene in fictional time",
          "continues",
          true,
          "checkbox",
        ),
      ],
      async (v) => {
        const c = await addChapter(repo, app.novelId, v.title);
        const s = await addScene(repo, c.id, "A new scene", {
          continuationOf: v.continues ? app.sceneId : null,
        });
        await app.openScene(s.id);
      },
    );
    return true;
  }
  if (action === "newScene") {
    await app.flush();
    const scene = await repo.get(app.sceneId),
      n = await repo.get(app.novelId),
      chapters = await Promise.all(
        n.orderedChapterIds.map((id) => repo.get(id)),
      );
    formPanel(
      "A new scene",
      [
        field("Scene title", "title", "A new scene"),
        field(
          "Continue from the current scene in fictional time",
          "continues",
          true,
          "checkbox",
        ),
        field(
          "Chapter",
          "chapterId",
          scene.chapterId,
          "select",
          chapters.map((c) => ({ value: c.id, label: c.title })),
        ),
      ],
      async (v) => {
        const s = await addScene(repo, v.chapterId, v.title, {
          continuationOf: v.continues ? scene.id : null,
        });
        await app.openScene(s.id);
      },
    );
    return true;
  }
  if (action === "reorder") {
    await app.flush();
    await reorder(
      repo,
      target.dataset.owner,
      target.dataset.key,
      target.dataset.id,
      Number(target.dataset.delta),
    );
    await renderNav(app);
    return true;
  }
  if (action === "chapterDetails") {
    const c = await repo.get(target.dataset.id);
    formPanel(
      "Chapter details",
      [
        field("Title", "title", c.title),
        field("Notes", "notes", c.notes, "textarea"),
        field("Draft status", "status", c.status, "select", [
          "draft",
          "revising",
          "complete",
        ]),
      ],
      async (v) => {
        await repo.update({ ...c, ...v }, "chapter.details");
        await renderNav(app);
      },
    );
    return true;
  }
  if (action === "sceneDetails") {
    await app.flush();
    const s = await repo.get(app.sceneId);
    const chapters = (await repo.query("novelId", app.novelId)).filter(
      (r) => r.type === "chapter",
    );
    formPanel(
      "Scene details",
      [
        field("Title", "title", s.title),
        field(
          "Chapter",
          "chapterId",
          s.chapterId,
          "select",
          chapters.map((c) => ({ value: c.id, label: c.title })),
        ),
        field("Viewpoint", "viewpoint", s.viewpoint),
        field(
          "Continues an earlier scene",
          "continuationOf",
          s.continuationOf || "",
          "select",
          [
            { value: "", label: "No stated continuation" },
            ...(await repo.query("novelId", app.novelId))
              .filter((r) => r.type === "scene" && r.id !== s.id)
              .map((r) => ({ value: r.id, label: r.title })),
          ],
        ),
        field("Time label", "timeLabel", s.timeLabel),
        field(
          "Fictional time order, optional number",
          "fictionalTime",
          s.fictionalTime ?? "",
          "number",
        ),
        field("Summary", "summary", s.summary, "textarea"),
        field("Notes", "notes", s.notes, "textarea"),
        field("Draft status", "status", s.status, "select", [
          "draft",
          "revising",
          "complete",
        ]),
        field("Pin original scene for context", "pinned", s.pinned, "checkbox"),
      ],
      async (v) => {
        await updateScene(repo, await repo.get(s.id), {
          ...v,
          continuationOf: v.continuationOf || null,
          fictionalTime:
            v.fictionalTime === "" ? null : Number(v.fictionalTime),
          summaryCoverage: {
            revisionId: s.currentRevisionId,
            end: (await repo.sceneText(s.id)).text.length,
          },
          notesCoverage: {
            revisionId: s.currentRevisionId,
            end: (await repo.sceneText(s.id)).text.length,
          },
        });
        await app.renderNav();
        $("#sceneTitle").textContent = v.title;
      },
      {
        help: "Fictional time and chapter order are separate. Use the same numeric scale throughout a novel. A lower number can place a flashback earlier. Unknown time stays unknown.",
      },
    );
    return true;
  }
  if (action === "write" || action === "continue") {
    if (
      action === "continue" &&
      app.candidateId &&
      !$("#candidateBox").hidden
    ) {
      const c = await repo.get(app.candidateId);
      if (["ready", "partial"].includes(c.status)) {
        panel(
          "Keep this passage and continue",
          el(
            "p",
            {},
            "The next passage will follow the visible candidate after you keep it.",
          ),
          el(
            "button",
            {
              class: "primary",
              onClick: async () => {
                await app.action("acceptCandidate", {});
                closePanel();
                await app.generate("continue");
              },
            },
            "Keep passage and continue",
          ),
        );
        return true;
      }
    }
    await app.generate(action);
    return true;
  }
  if (action === "reviseSelection" || action === "partnerEdit") {
    await app.flush();
    const range = app.selection;
    if (!range || range[0] === range[1])
      throw new Error("Select the passage to revise in the manuscript first.");
    await app.generate("revise", {
      range,
      direction:
        action === "partnerEdit"
          ? $("#discussionInput").value
          : $("#direction").value,
    });
    return true;
  }
  if (action === "cancel") {
    app.writer.cancel();
    return true;
  }
  if (action === "acceptCandidate") {
    await app.flush();
    const c = await repo.get(app.candidateId);
    if (
      c.status === "partial" &&
      !confirm(
        "This passage stopped before confirmed completion. Keep its visible text?",
      )
    )
      return true;
    app.editor.readOnly = true;
    try {
      app.acceptingPassage = (async () => {
        await acceptCandidate(repo, c.id);
        await app.loadScene(app.sceneId);
      })();
      await app.acceptingPassage;
    } finally {
      app.acceptingPassage = null;
      app.editor.readOnly = false;
    }
    notice("Passage kept. The earlier revision is preserved.");
    return true;
  }
  if (action === "discardCandidate") {
    const c = await repo.get(app.candidateId);
    await repo.update({ ...c, status: "discarded" }, "candidate.discard");
    $("#candidateBox").hidden = true;
    $("#suggestions").replaceChildren();
    notice("Candidate discarded from view. It remains in Earlier candidates.");
    return true;
  }
  if (action === "retryCandidate") {
    const c = await repo.get(app.candidateId);
    if ((await repo.get(c.sceneId)).currentRevisionId !== c.baseRevisionId)
      throw new Error(
        "The source changed. Compare this candidate and choose its placement before trying another version.",
      );
    await app.generate(c.kind, {
      direction: c.direction,
      range: c.insertionRange,
      ...(c.explorationId
        ? {
            transcript: c.transcriptSource,
            candidateExtra: {
              explorationId: c.explorationId,
              branchId: c.branchId,
              transcriptSource: c.transcriptSource,
            },
          }
        : {}),
    });
    return true;
  }
  if (action === "reviseCandidate") {
    const c = await repo.get(app.candidateId),
      text = await repo.text(c.textBlobId);
    if ((await repo.get(c.sceneId)).currentRevisionId !== c.baseRevisionId)
      throw new Error(
        "Compare the changed source and choose a new placement first.",
      );
    const revisionForm = formPanel(
      "Revise this candidate",
      [field("Revision direction", "direction", "", "textarea")],
      async (v) => {
        setTimeout(
          () =>
            app
              .generate(c.kind, {
                direction:
                  c.direction +
                  "\nRevise this unaccepted alternative as follows: " +
                  v.direction +
                  "\nUnaccepted alternative:\n" +
                  text,
                range: c.insertionRange,
                ...(c.explorationId
                  ? {
                      transcript: c.transcriptSource,
                      candidateExtra: {
                        explorationId: c.explorationId,
                        branchId: c.branchId,
                        transcriptSource: c.transcriptSource,
                      },
                    }
                  : {}),
              })
              .catch((e) => notice(e.message, true)),
          0,
        );
      },
      { submit: "Generate revised alternative" },
    );
    await app.drafts.bind(revisionForm.elements.direction, {
      novelId: c.novelId,
      ownerId: c.id,
      kind: "candidateInstructions",
    });
    return true;
  }
  if (action === "compareCandidate") {
    await comparison(app, app.candidateId);
    return true;
  }
  if (action === "candidates") {
    const candidates = (await repo.query("sceneId", app.sceneId))
      .filter((r) => r.type === "candidate")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    panel(
      "Earlier candidates",
      ...(await Promise.all(
        candidates.map(async (c) =>
          el(
            "article",
            { class: "storycard" },
            el("small", {}, c.status + " · " + c.createdAt),
            el("p", {}, (await repo.text(c.textBlobId)).slice(0, 400)),
            el(
              "button",
              {
                onClick: async () => {
                  closePanel();
                  await app.showCandidate(c.id);
                },
              },
              "Open candidate",
            ),
          ),
        ),
      )),
    );
    return true;
  }
  if (action === "history") {
    await app.flush();
    const revisions = (await repo.query("ownerId", app.sceneId))
      .filter((r) => r.type === "revision")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    panel(
      "Scene revision history",
      el(
        "p",
        { class: "help" },
        "Restoring creates a new revision. Later versions remain available.",
      ),
      ...(await Promise.all(
        revisions.map(async (r) =>
          el(
            "article",
            { class: "storycard" },
            el("small", {}, r.sourceKind + " · " + r.createdAt),
            el("pre", { class: "receipt" }, await repo.text(r.textBlobId)),
            el(
              "button",
              {
                onClick: async () => {
                  try {
                    await app.flush();
                    const s = await repo.get(app.sceneId);
                    await revise(
                      repo,
                      s.id,
                      s.currentRevisionId,
                      await repo.text(r.textBlobId),
                      "revision.restore",
                      { provenance: { restoredFrom: r.id } },
                    );
                    closePanel();
                    await app.loadScene(s.id);
                  } catch (e) {
                    notice(e.message, true);
                  }
                },
              },
              "Restore this version",
            ),
          ),
        ),
      )),
    );
    return true;
  }
  if (action === "read") {
    await app.flush();
    if (!$("#readingView").hidden) {
      $("#readingView").hidden = true;
      app.editor.hidden = false;
      return true;
    }
    const s = await repo.get(app.sceneId);
    panel(
      "Reading view",
      el(
        "div",
        { class: "actions" },
        el("button", { onClick: () => read(app, [s.id]) }, "Read this scene"),
        el(
          "button",
          {
            onClick: async () =>
              read(app, (await repo.get(s.chapterId)).orderedSceneIds),
          },
          "Read this chapter",
        ),
      ),
    );
    return true;
  }
  if (action === "immersive") {
    await app.flush();
    await app.drafts.flush();
    if (document.body.dataset.focus === "writing")
      delete document.body.dataset.focus;
    else document.body.dataset.focus = "writing";
    return true;
  }
  if (action === "focusReading") {
    await app.flush();
    await app.drafts.flush();
    app.focusPosition = {
      selection: [app.editor.selectionStart, app.editor.selectionEnd],
      scroll: app.editor.scrollTop,
      surfaceScroll: $("#writingSurface").scrollTop,
    };
    if (!app.editor.hidden) {
      $("#readingView").replaceChildren(readingText(app.editor.value));
      $("#readingView").hidden = false;
      app.editor.hidden = true;
      app.focusMadeReading = true;
    }
    document.body.dataset.focus = "reading";
    return true;
  }
  if (action === "exitFocus") {
    delete document.body.dataset.focus;
    if (app.focusMadeReading) {
      $("#readingView").hidden = true;
      app.editor.hidden = false;
      app.focusMadeReading = false;
      app.editor.setSelectionRange(...app.focusPosition.selection);
      app.editor.scrollTop = app.focusPosition.scroll;
      $("#writingSurface").scrollTop = app.focusPosition.surfaceScroll;
    }
    return true;
  }
  if (action === "toggleNavigator") {
    document.body.classList.toggle("collapsedNavigator");
    return true;
  }
  if (action === "togglePartner") {
    document.body.classList.toggle("collapsedPartner");
    return true;
  }
  if (action === "search") {
    const input = el("input", {
        type: "search",
        "aria-label": "Search your novel",
        placeholder: "Find a word, promise or moment",
      }),
      results = el("div");
    let request = 0;
    input.addEventListener("input", async () => {
      const current = ++request,
        q = input.value.toLowerCase();
      results.replaceChildren();
      if (!q) return;
      const scenes = (await repo.query("novelId", app.novelId)).filter(
        (r) => r.type === "scene",
      );
      for (const s of scenes) {
        const { text } = await repo.sceneText(s.id),
          at = text.toLowerCase().indexOf(q);
        if (request !== current) return;
        if (at >= 0)
          results.append(
            el(
              "button",
              {
                class: "searchhit",
                onClick: async () => {
                  closePanel();
                  await app.openScene(s.id);
                  app.editor.focus();
                  app.editor.setSelectionRange(at, at + q.length);
                  app.selection = [at, at + q.length];
                },
              },
              s.title +
                ": " +
                text.slice(Math.max(0, at - 50), at + q.length + 100),
            ),
          );
      }
    });
    panel("Search the novel", input, results);
    return true;
  }
  if (action === "bookmarks") {
    const marks = (await repo.query("novelId", app.novelId)).filter(
      (r) => r.type === "bookmark",
    );
    panel(
      "Bookmarks",
      el(
        "button",
        {
          onClick: async () => {
            await repo.update(
              {
                id: id("bookmark"),
                type: "bookmark",
                novelId: app.novelId,
                sceneId: app.sceneId,
                baseRevisionId: app.revisionId,
                offset: app.selection?.[0] || 0,
                label: $("#sceneTitle").textContent,
                createdAt: now(),
              },
              "bookmark",
            );
            notice("Bookmark saved with its original revision.");
          },
        },
        "Bookmark this position",
      ),
      ...marks.map((b) =>
        el(
          "button",
          {
            class: "searchhit",
            onClick: async () => {
              await app.openScene(b.sceneId);
              closePanel();
              app.editor.focus();
              app.editor.setSelectionRange(b.offset, b.offset);
              if (app.revisionId !== b.baseRevisionId)
                notice(
                  "This scene changed since the bookmark. The original revision is still in History.",
                );
            },
          },
          b.label,
        ),
      ),
    );
    return true;
  }
  return false;
}
async function comparison(app, id) {
  const c = await app.repo.get(id),
    { text } = await app.repo.sceneText(c.sceneId),
    candidate = await app.repo.text(c.textBlobId);
  panel(
    "Compare before keeping",
    el(
      "p",
      { class: "help" },
      "The current manuscript is on the left. The proposed passage is on the right. New placement preserves the original candidate.",
    ),
    el(
      "div",
      { class: "compare" },
      el("pre", {}, text),
      el("pre", {}, candidate),
    ),
    c.transcriptSource
      ? el(
          "details",
          {},
          el("summary", {}, "Original exploration transcript"),
          el("pre", { class: "receipt" }, c.transcriptSource),
        )
      : null,
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          onClick: async () => {
            const placed = await placeCandidate(app.repo, id, [
              text.length,
              text.length,
            ]);
            closePanel();
            await app.showCandidate(placed.id);
            notice(
              "A separate candidate is now attached to the current ending. Review it and Keep passage when ready.",
            );
          },
        },
        "Place a new candidate at current ending",
      ),
      el(
        "button",
        {
          onClick: async () => {
            if (!app.selection || app.selection[0] === app.selection[1]) {
              notice(
                "Select the intended replacement range in the manuscript first.",
                true,
              );
              return;
            }
            const placed = await placeCandidate(app.repo, id, app.selection);
            await app.repo.update(
              { ...placed, kind: "revise" },
              "candidate.placement",
            );
            closePanel();
            await app.showCandidate(placed.id);
          },
        },
        "Target the current selection",
      ),
    ),
  );
}
async function read(app, sceneIds) {
  closePanel();
  $("#readingView").replaceChildren();
  for (const sid of sceneIds) {
    const { scene, text } = await app.repo.sceneText(sid);
    $("#readingView").append(el("h2", {}, scene.title), readingText(text));
  }
  app.editor.hidden = true;
  $("#readingView").hidden = false;
  $("#candidateBox").hidden = true;
}

function readingText(text) {
  return el(
    "div",
    {},
    ...text
      .split(/(?<=\n)/)
      .map((line) =>
        el("span", { class: /^\s*[“"]/.test(line) ? "dialogue" : "" }, line),
      ),
  );
}
