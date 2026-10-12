import { saveEntity } from "../story/entities.js";
import { $, el, button, field, formPanel, panel, notice } from "./dom.js";
import { id, now } from "../core/ids.js";
import { CANON_KINDS } from "../config.js";
import { acceptMemory } from "../ai/analysis.js";
export async function renderBible(app) {
  const records = await app.repo.query("novelId", app.novelId);
  const entities = records.filter((r) => r.type === "entity"),
    canon = records.filter((r) => r.type === "canon");
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
}
export async function storyAction(app, action, target) {
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
      entities = records.filter((r) => r.type === "entity"),
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
