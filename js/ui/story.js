import { readingSource } from "../rp/session.js";
import { undoReading, applyReading } from "../story/reading.js";
import { saveEntity } from "../story/entities.js";
import { $, el, button, field, formPanel, panel, notice } from "./dom.js";
import { id, now } from "../core/ids.js";
import { CANON_KINDS } from "../config.js";
import { acceptMemory } from "../ai/analysis.js";
export async function renderBible(app) {
  const records = await app.repo.query("novelId", app.novelId);
  const entities = records.filter(
      (r) =>
        r.type === "entity" &&
        !r.derivedHidden &&
        (!r.explorationId || r.scope === "novel"),
    ),
    canon = records.filter(
      (r) => r.type === "canon" && r.scope !== "exploration",
    );
  $("#storyRecords").replaceChildren(
    ...entities.map((e) =>
      el(
        "article",
        { class: "storycard" },
        el("span", { class: "tag" }, e.kind),
        el("h3", {}, e.displayName),
        el("p", {}, e.profile || "No biography needed to begin."),
        el("small", {}, (e.aliases || []).join(", ")),
        button("Edit profile", "editEntity", { id: e.id }),
      ),
    ),
    ...canon.map((r) =>
      el(
        "article",
        { class: "storycard" },
        el("span", { class: "tag" }, r.recordKind + " · " + r.status),
        el("p", {}, r.proposition),
        el(
          "small",
          {},
          (r.holderId
            ? "Held by " +
              entities.find((e) => e.id === r.holderId)?.displayName +
              ". "
            : "") +
            (r.proseInserted === false
              ? "Events kept. Prose not inserted. "
              : ""),
        ),
        button("Review record", "editCanon", { id: r.id }),
      ),
    ),
  );
  await readingDetails(app);
}
export async function readingDetails(app) {
  const records = await app.repo.query("novelId", app.novelId);
  for (const a of records.filter(
    (r) =>
      ["analysis", "readingTask"].includes(r.kind) &&
      (r.kind !== "readingTask" || r.state !== "completed") &&
      r.coverage &&
      !r.coverage.complete &&
      r.freshness !== "stale",
  )) {
    $("#storyRecords").append(
      el(
        "details",
        { class: "storycard" },
        el("summary", {}, "Story reading has unfinished coverage"),
        el(
          "p",
          {},
          `Read through ${a.coverage.end} of ${a.coverage.sourceLength} characters. Originals remain available. ${a.error || ""}`,
        ),
        button("Read remaining source", "readRemaining", { id: a.id }),
      ),
    );
  }
  for (const batch of records.filter((r) => r.kind === "readingBatch"))
    $("#storyRecords").append(
      el(
        "details",
        { class: "storycard" },
        el("summary", {}, "Story Brain batch, " + batch.state),
        el(
          "p",
          {},
          batch.body.appliedIds.length +
            " source linked updates. " +
            batch.body.reviews.length +
            " items need review. Source coverage " +
            (batch.body.coverage?.end || 0) +
            " of " +
            (batch.body.coverage?.sourceLength || 0) +
            " characters.",
        ),
        el(
          "pre",
          { class: "receipt" },
          JSON.stringify(batch.body.reviews, null, 2),
        ),
        batch.body.reviews.length
          ? button("Review this source reading", "reviewReading", {
              id: batch.body.artifactId,
            })
          : null,
        batch.state === "applied"
          ? button("Undo this derived batch", "undoReading", { id: batch.id })
          : null,
      ),
    );
}
export async function storyAction(app, action, target) {
  if (action === "reviewReading") {
    const a = await app.repo.get(target.dataset.id),
      source = await app.repo.get(
        a.explorationId || a.candidateId || a.baseRevisionId,
      );
    formPanel(
      "Review a derived source reading",
      [
        field(
          "Structured identities and updates, JSON",
          "reading",
          JSON.stringify(
            { entities: a.body.entities || [], updates: a.body.updates || [] },
            null,
            2,
          ),
          "textarea",
        ),
      ],
      async (v) => {
        const parsed = JSON.parse(v.reading);
        if (!Array.isArray(parsed.entities) || !Array.isArray(parsed.updates))
          throw new Error("Both identities and updates must be arrays.");
        await app.repo.update(
          { ...a, body: { ...a.body, ...parsed } },
          "reading.review",
        );
        await applyReading(app.repo, a.id, { reviewed: true });
        await renderBible(app);
      },
      {
        submit: "Apply reviewed reading",
        help: "Check meanings and evidence. Original prose and manual declarations remain primary. Unresolved source or identity references still need correction.",
      },
    );
    $("#modalBody").prepend(
      el(
        "pre",
        { class: "receipt" },
        await app.repo.text(a.explorationId ? a.textBlobId : source.textBlobId),
      ),
    );
    return true;
  }
  if (action === "readRemaining") {
    const a = await app.repo.get(target.dataset.id);
    const extra = { readingStart: a.coverage.end };
    if (
      !a.candidateId &&
      !a.explorationId &&
      (await app.repo.get(a.sceneId)).currentRevisionId !== a.baseRevisionId
    )
      throw new Error(
        "This pending source changed. Its original revision remains in History. Read the current scene or compare the earlier version first.",
      );
    if (a.explorationId) {
      const ex = await app.repo.get(a.explorationId);
      if (ex.activeBranchId !== a.branchId)
        throw new Error(
          "Select this reading's original branch in Quick RP before reading its remaining source.",
        );
      Object.assign(extra, {
        exploration: ex,
        sourceText: await readingSource(app.repo, a),
        coveredTurnIds: a.coveredTurnIds,
        sourceTurnSpans: a.sourceTurnSpans,
      });
    }
    await app.analyze(a.candidateId, extra);
    await renderBible(app);
    return true;
  }

  if (action === "newEntity" || action === "editEntity") {
    const e =
      action === "editEntity"
        ? await app.repo.get(target.dataset.id)
        : {
            id: id("entity"),
            type: "entity",
            novelId: app.novelId,
            kind: "person",
            displayName: "",
            aliases: [],
            profile: "",
            sourceRefs: [],
          };
    formPanel(
      "Person, place or other entity",
      [
        field("Name or label", "displayName", e.displayName),
        field("Kind", "kind", e.kind, "select", [
          "person",
          "place",
          "group",
          "descriptor",
          "title",
        ]),
        field("Aliases, separated by commas", "aliases", e.aliases.join(", ")),
        field(
          "What is established about them",
          "profile",
          e.profile,
          "textarea",
        ),
        field(
          "Stable biography, explicitly true across fictional times",
          "invariantProfile",
          e.invariantProfile || "",
          "textarea",
        ),
      ],
      async (v) => {
        await saveEntity(app.repo, e, {
          ...v,
          aliases: v.aliases
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        await renderBible(app);
        notice("Profile saved. Existing prose was not renamed.");
      },
      {
        help: "Names are labels. This entity keeps its identity when renamed. Profiles are author declarations, not an automatic rewrite of earlier scenes.",
      },
    );
    const history = (await app.repo.query("novelId", app.novelId)).filter(
      (r) =>
        r.type === "artifact" &&
        r.kind === "entityProfile" &&
        r.entityId === e.id,
    );
    if (history.length)
      $("#modalBody").append(
        el(
          "details",
          {},
          el("summary", {}, "Profile history"),
          ...history.map((r) =>
            el("pre", { class: "receipt" }, JSON.stringify(r.body, null, 2)),
          ),
        ),
      );
    return true;
  }
  if (action === "newCanon" || action === "editCanon") {
    const records = await app.repo.query("novelId", app.novelId),
      entities = records.filter(
        (r) =>
          r.type === "entity" &&
          !r.derivedHidden &&
          (!r.explorationId || r.scope === "novel"),
      ),
      people = [
        { value: "", label: "No specific person" },
        ...entities.map((e) => ({ value: e.id, label: e.displayName })),
      ];
    const r =
      action === "editCanon"
        ? await app.repo.get(target.dataset.id)
        : {
            id: id("canon"),
            type: "canon",
            novelId: app.novelId,
            recordKind: "authorFact",
            proposition: "",
            status: "active",
            certainty: "author established",
            sourceRefs: [],
            derived: false,
          };
    const sourceOptions = [
      { value: "", label: "Author declaration, no manuscript source" },
      ...records
        .filter((x) => x.type === "scene")
        .map((s) => ({ value: s.currentRevisionId, label: s.title })),
    ];
    formPanel(
      "Story record",
      [
        field(
          "Information class",
          "recordKind",
          r.recordKind,
          "select",
          CANON_KINDS,
        ),
        field("Status", "status", r.status, "select", [
          "active",
          "proposed",
          "disputed",
          "superseded",
          "stale",
        ]),
        field("Subject", "subjectId", r.subjectId || "", "select", people),
        field(
          "Who knows, believes or intends this",
          "holderId",
          r.holderId || "",
          "select",
          people,
        ),
        field(
          "Proposition, with all conditions intact",
          "proposition",
          r.proposition,
          "textarea",
        ),
        field("Certainty", "certainty", r.certainty),
        field(
          "Historical scope",
          "temporalScope",
          r.temporalScope || "source",
          "select",
          [
            { value: "source", label: "At its stated time or source boundary" },
            {
              value: "invariant",
              label: "Author invariant across fictional times",
            },
          ],
        ),
        field(
          "Effective fictional time, numeric and optional",
          "validFrom",
          r.validFrom ?? "",
          "number",
        ),
        field(
          "Valid until, optional",
          "validUntil",
          r.validUntil ?? "",
          "number",
        ),
        field(
          "Source scene revision",
          "sourceId",
          r.sourceRefs[0]?.id || "",
          "select",
          sourceOptions,
        ),
        field("Pin for context selection", "pinned", r.pinned, "checkbox"),
        ...(action === "editCanon"
          ? [
              field(
                "Correction scope",
                "correctionScope",
                "fromTime",
                "select",
                [
                  {
                    value: "fromTime",
                    label: "From the specified fictional time",
                  },
                  {
                    value: "retroactive",
                    label: "All fictional times, explicitly retroactive",
                  },
                ],
              ),
            ]
          : []),
      ],
      async (v) => {
        if (
          ["knowledge", "belief", "secret", "intention"].includes(
            v.recordKind,
          ) &&
          !v.holderId
        )
          throw new Error(
            "Choose the person who owns this knowledge, belief, secret or intention.",
          );
        if (!v.proposition.trim()) throw new Error("Enter the proposition.");
        const { sourceId, ...data } = v;
        const next = {
          ...r,
          ...data,
          holderId: v.holderId || null,
          subjectId: v.subjectId || null,
          validFrom: v.validFrom === "" ? null : Number(v.validFrom),
          validUntil: v.validUntil === "" ? null : Number(v.validUntil),
          sourceRefs: sourceId ? [{ id: sourceId }] : [],
          createdAt: now(),
          derived: false,
        };
        if (action === "editCanon") {
          if (v.correctionScope === "fromTime" && v.validFrom === "")
            throw new Error(
              "Set the fictional time where this correction begins, or explicitly choose all fictional times.",
            );
          if (v.correctionScope === "retroactive") next.validFrom = null;
          next.id = id("canon");
          next.supersedes = r.id;
          await app.repo.commit({
            novelId: app.novelId,
            kind: "canon.correct",
            records: [
              {
                ...r,
                status: "superseded",
                supersededFrom:
                  v.correctionScope === "fromTime" ? Number(v.validFrom) : null,
              },
              next,
            ],
          });
        } else await app.repo.update(next, "canon.author");
        await renderBible(app);
      },
      {
        help: "A plan is not an event. A belief can be false. Numeric time anchors determine eligibility across flashbacks. Leave unknown chronology blank. Corrections create new records and retain the superseded version.",
      },
    );
    return true;
  }
  if (action === "undoReading") {
    await undoReading(app.repo, target.dataset.id);
    await renderBible(app);
    notice("Derived batch undone. The same reading will not recreate it.");
    return true;
  }
  if (action === "applyReading") {
    await applyReading(app.repo, target.dataset.id, { reviewed: true });
    await renderBible(app);
    return true;
  }
  if (action === "continueReading") {
    const a = await app.repo.get(target.dataset.id);
    await app.analyze(a.candidateId || null, {
      readingStart: Number(target.dataset.start),
    });
    return true;
  }
  if (action === "acceptMemory") {
    await acceptMemory(
      app.repo,
      target.dataset.id,
      Number(target.dataset.index),
    );
    await renderBible(app);
    notice("Source reading accepted as a reversible derived memory.");
    return true;
  }
  if (action === "sideTab") {
    app.sideTab(target.dataset.tab);
    return true;
  }
  return false;
}
export async function showMemoryProposals(app, artifact) {
  $("#memoryProposals").replaceChildren();
  if (!artifact) return;
  if (artifact.coverage && !artifact.coverage.complete)
    $("#memoryProposals").append(
      el(
        "p",
        { class: "help" },
        "Source reading is pending after character " +
          artifact.coverage.end +
          " of " +
          artifact.coverage.sourceLength +
          ". Original text remains available.",
      ),
      button("Continue source reading", "continueReading", {
        start: artifact.coverage.end,
        id: artifact.id,
      }),
    );
  for (const [i, m] of (artifact.body.memories || []).entries())
    $("#memoryProposals").append(
      el(
        "article",
        { class: "storycard" },
        el("span", { class: "tag" }, "OPTIONAL SOURCE READING"),
        el("p", {}, m.proposition),
        el("p", { class: "quiet" }, m.quote || "No source excerpt supplied."),
        button("Accept derived memory", "acceptMemory", {
          id: artifact.id,
          index: i,
        }),
      ),
    );
}
