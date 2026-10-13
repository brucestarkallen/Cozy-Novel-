import { id, now, textBlob } from "../core/ids.js";
import { assert } from "../core/schema.js";
import { contextCheck } from "../context/assemble.js";
import { mappedRange } from "../context/scope.js";
export async function readingMode(repo, novelId) {
  const n = await repo.get(novelId);
  return n.storyMode ?? (n.autoSuggestions === false ? "off" : "auto");
}
function evidence(update, text, start, end, offset = 0) {
  if (typeof update.quote !== "string" || !update.quote) return null;
  const at = Number.isInteger(update.start)
    ? update.start
    : (() => {
        const found = text.indexOf(update.quote, Math.max(0, start - offset));
        return found < 0 ? -1 : found + offset;
      })();
  if (
    at < start ||
    at + update.quote.length > end ||
    text.slice(at - offset, at - offset + update.quote.length) !== update.quote
  )
    return null;
  return { start: at, end: at + update.quote.length };
}
export async function applyReading(
  repo,
  artifactId,
  { reviewed = false, held = false } = {},
) {
  if (!held)
    return repo.withMutation(() =>
      applyReading(repo, artifactId, { reviewed, held: true }),
    );
  const a = await repo.get(artifactId);
  assert(a?.kind === "analysis", "Missing source reading.");
  const mode = await readingMode(repo, a.novelId);
  if (mode === "off" && !reviewed) return a;
  if (a.freshness === "stale") return a;
  const source = await repo.get(
    a.explorationId || a.candidateId || a.baseRevisionId,
  );
  let scene = await repo.get(a.sceneId);
  if (a.explorationId) scene = { ...scene, ...source.sceneSnapshot };
  let revisionId = source.id,
    offset = 0,
    mapping;
  if (source.type === "candidate") {
    if (source.status !== "kept") return a;
    const records = await repo.query("novelId", a.novelId),
      range =
        source.acceptedRange &&
        mappedRange(
          { start: source.acceptedRange[0], end: source.acceptedRange[1] },
          source.acceptedRevisionId,
          scene.currentRevisionId,
          new Map(records.map((r) => [r.id, r])),
        );
    if (
      !range ||
      (await repo.sceneText(scene.id)).text.slice(range.start, range.end) !==
        (await repo.text(source.textBlobId))
    )
      return a;
    revisionId = scene.currentRevisionId;
    offset = range.start;
    mapping = {
      candidateId: source.id,
      textBlobId: source.textBlobId,
      sourceRevisionId: source.acceptedRevisionId,
      targetRevisionId: scene.currentRevisionId,
      range: [range.start, range.end],
    };
  } else if (!a.explorationId && scene.currentRevisionId !== source.id)
    return a;
  const check = a.contextSnapshot
    ? await contextCheck(repo, a.contextSnapshot, {
        allowAcceptedCandidate: true,
      })
    : { current: true };
  if (!check.current) return a;
  const sourceText = await repo.text(
      a.explorationId ? a.textBlobId : source.textBlobId,
    ),
    coverage = a.coverage || {
      start: 0,
      end: sourceText.length,
      complete: true,
    };
  const batchId =
    "artifact_batch_" +
    (
      await textBlob(
        JSON.stringify([
          a.novelId,
          source.id,
          a.branchId,
          a.coveredTurnIds,
          coverage.start,
          coverage.end,
        ]),
      )
    ).id.slice(5) +
    (reviewed ? "_reviewed" : "");
  const prior = await repo.get(batchId);
  if (prior) return prior;
  const owned = await repo.query("novelId", a.novelId),
    refs = new Map(
      owned.filter((r) => r.type === "entity").map((r) => [r.id, r.id]),
    ),
    records = [],
    reviews = [],
    beforeRecords = [];
  const coverageTurns = (range) =>
    a.sourceTurnSpans?.length
      ? a.sourceTurnSpans
          .filter((span) => span.end > range.start && span.start < range.end)
          .map((span) => span.id)
      : a.coveredTurnIds || [];
  const sourceRef = (range) =>
    a.explorationId
      ? { id: coverageTurns(range)[0] || a.explorationId }
      : {
          id: revisionId,
          start: offset + range.start,
          end: offset + range.end,
        };
  for (const e of a.body.entities || []) {
    const range = evidence(
      e,
      sourceText,
      coverage.start,
      coverage.end,
      a.sourceTextOffset || 0,
    );
    if (
      !range ||
      !["person", "place", "group", "descriptor", "title"].includes(e.kind) ||
      typeof e.key !== "string" ||
      !e.key ||
      typeof e.name !== "string" ||
      !e.name
    ) {
      reviews.push({
        item: e,
        reason: "Identity needs a supported source and kind",
      });
      continue;
    }
    if (e.existingId) {
      const found = owned.find(
        (r) => r.id === e.existingId && r.type === "entity",
      );
      if (!found) {
        reviews.push({
          item: e,
          reason: "Referenced identity is not established",
        });
        continue;
      }
      refs.set(e.key, found.id);
      continue;
    }
    if (mode === "review" && !reviewed) {
      reviews.push({ item: e, reason: "Identity awaits author review" });
      continue;
    }
    if (e.ambiguous) {
      reviews.push({ item: e, reason: "Identity is ambiguous" });
      continue;
    }
    const entityId =
      "entity_" +
      (
        await textBlob(
          JSON.stringify([
            a.novelId,
            source.id,
            a.branchId,
            coverageTurns(range)[0],
            e.key,
          ]),
        )
      ).id.slice(5);
    refs.set(e.key, entityId);
    if (!owned.some((r) => r.id === entityId))
      records.push({
        id: entityId,
        type: "entity",
        novelId: a.novelId,
        kind: e.kind,
        displayName: e.name,
        aliases: [],
        profile: "",
        sourceRefs: [sourceRef(range)],
        derived: true,
        ...(a.explorationId
          ? {
              scope: "exploration",
              explorationId: a.explorationId,
              branchId: a.branchId,
              coveredTurnIds: coverageTurns(range),
            }
          : {}),
        readingBatchId: batchId,
      });
  }
  for (const u of a.body.updates || []) {
    const range = evidence(
        u,
        sourceText,
        coverage.start,
        coverage.end,
        a.sourceTextOffset || 0,
      ),
      holder = u.holderRef ? refs.get(u.holderRef) : null,
      subject = u.subjectRef ? refs.get(u.subjectRef) : null;
    let reason = !range
      ? "Source location is missing or does not match"
      : ![
            "biography",
            "location",
            "acceptedEvent",
            "relationship",
            "knowledge",
            "belief",
            "secret",
            "plan",
            "intention",
            "condition",
            "thread",
            "memory",
          ].includes(u.recordKind)
        ? "Unsupported information class"
        : (u.validFrom != null && !Number.isFinite(u.validFrom)) ||
            (u.validUntil != null && !Number.isFinite(u.validUntil))
          ? "Fictional time is invalid"
          : typeof u.proposition !== "string" || !u.proposition
            ? "Missing proposition"
            : (u.holderRef && !holder) || (u.subjectRef && !subject)
              ? "Identity prerequisite is unresolved"
              : ["knowledge", "belief", "secret", "intention"].includes(
                    u.recordKind,
                  ) && !holder
                ? "The information needs its owner"
                : null;
    // Source location is structural evidence. Only a direct reading is eligible for automatic application;
    // interpretation, conflict and identity uncertainty remain visible for author review.
    if (
      !reviewed &&
      (mode === "review" ||
        u.support !== "explicit" ||
        u.requiresReview ||
        u.conflict)
    )
      reason = reason || "Interpretation needs author review";
    if (u.supersedes && owned.find((r) => r.id === u.supersedes && !r.derived))
      reason = "A derived reading cannot replace an author declaration";
    if (reason) {
      reviews.push({ item: u, reason });
      continue;
    }
    const recordId =
      "canon_" +
      (
        await textBlob(
          JSON.stringify([
            a.novelId,
            source.id,
            a.branchId,
            coverageTurns(range),
            range.start,
            range.end,
            u.recordKind,
            holder,
            subject,
            u.proposition,
          ]),
        )
      ).id.slice(5);
    if (owned.some((r) => r.id === recordId)) continue;
    if (u.supersedes) {
      const previous = owned.find(
        (r) => r.id === u.supersedes && r.type === "canon",
      );
      if (
        !previous ||
        previous.scope !== (a.explorationId ? "exploration" : undefined) ||
        records.some((r) => r.id === previous.id)
      ) {
        reviews.push({
          item: u,
          reason:
            "Superseded record is missing, differently scoped or already changed in this reading",
        });
        continue;
      }
      beforeRecords.push(previous);
      records.push({
        ...previous,
        status: "superseded",
        supersededFrom: u.validFrom ?? scene.fictionalTime,
        supersededBy: recordId,
        supersededReadingBatch: batchId,
      });
    }
    records.push({
      id: recordId,
      type: "canon",
      novelId: a.novelId,
      recordKind: u.recordKind,
      proposition: u.proposition,
      holderId: holder,
      subjectId: subject,
      certainty: u.certainty || "source reading",
      status: "active",
      derived: true,
      sourceRefs: [sourceRef(range)],
      evidence: u.quote,
      validFrom:
        u.temporalScope === "invariant"
          ? null
          : (u.validFrom ?? scene.fictionalTime),
      temporalScope: u.temporalScope || "source",
      planState: u.planState || null,
      supersedes: u.supersedes || null,
      readingBatchId: batchId,
      sourceCoverage: { start: range.start, end: range.end },
      ...(a.explorationId
        ? {
            scope: "exploration",
            explorationId: a.explorationId,
            branchId: a.branchId,
            coveredTurnIds: coverageTurns(range),
          }
        : {}),
      applicationReceipt: {
        artifactId: a.id,
        interpretation: "direct source reading",
        reviewed,
      },
    });
  }
  if (
    a.body.summary &&
    coverage.end > coverage.start &&
    (mode === "auto" || reviewed)
  ) {
    const range = { start: coverage.start, end: coverage.end };
    records.push({
      id: id("artifact"),
      type: "artifact",
      novelId: a.novelId,
      sceneId: a.sceneId,
      kind: a.explorationId ? "branchReading" : "storySummary",
      freshness: "fresh",
      body: {
        summary: a.body.summary,
        state: records
          .filter((r) => r.type === "canon")
          .map((r) => ({
            id: r.id,
            kind: r.recordKind,
            holderId: r.holderId,
            subjectId: r.subjectId,
            proposition: r.proposition,
            certainty: r.certainty,
            planState: r.planState,
          })),
        complete: coverage.complete,
      },
      sourceRefs: [sourceRef(range)],
      sourceCoverage: { revisionId, end: offset + coverage.end },
      readingBatchId: batchId,
      ...(a.explorationId
        ? {
            scope: "exploration",
            explorationId: a.explorationId,
            branchId: a.branchId,
            coveredTurnIds: a.coveredTurnIds,
            fullyReadTurnIds: a.fullyReadTurnIds || [],
            turnCoverage: (a.sourceTurnSpans || [])
              .filter(
                (span) =>
                  span.end > coverage.start && span.start < coverage.end,
              )
              .map((span) => ({
                id: span.id,
                start: Math.max(
                  0,
                  coverage.start - (span.bodyStart ?? span.start),
                ),
                end: Math.max(
                  0,
                  Math.min(coverage.end, span.end) -
                    (span.bodyStart ?? span.start),
                ),
                fullLength: span.end - (span.bodyStart ?? span.start),
              })),
          }
        : {}),
      createdAt: now(),
    });
  }
  const batch = {
    id: batchId,
    type: "artifact",
    novelId: a.novelId,
    sceneId: a.sceneId,
    kind: "readingBatch",
    body: {
      artifactId: a.id,
      appliedIds: records.map((r) => r.id),
      reviews,
      beforeRecords,
      coverage,
    },
    state: "applied",
    sourceRefs: [{ id: source.id }],
    createdAt: now(),
  };
  const prepared = check.precondition
    ? { ...check.precondition, mapping }
    : undefined;
  try {
    await repo.commitLocked({
      novelId: a.novelId,
      kind: "reading.apply",
      contextPrecondition: prepared,
      records: [...records, batch],
    });
  } catch (e) {
    if (prepared) {
      await repo.commitLocked({
        novelId: a.novelId,
        kind: "reading.stale",
        records: [{ ...a, freshness: "stale", applicationError: e.message }],
      });
      return a;
    }
    throw e;
  }
  return batch;
}
export async function undoReading(repo, batchId) {
  const batch = await repo.get(batchId);
  assert(batch?.kind === "readingBatch", "Missing reading batch.");
  const records = [];
  for (const key of batch.body.appliedIds) {
    const r = await repo.get(key);
    if (!r || r.readingBatchId !== batchId) continue;
    if (r.type === "canon")
      records.push({ ...r, status: "superseded", rejectedByAuthor: true });
    else if (r.type === "artifact") records.push({ ...r, freshness: "stale" });
    else if (r.type === "entity") records.push({ ...r, derivedHidden: true });
  }
  for (const before of batch.body.beforeRecords || []) {
    const current = await repo.get(before.id);
    if (
      current?.supersededReadingBatch === batchId &&
      current.status === "superseded"
    )
      records.push(before);
  }
  records.push({ ...batch, state: "undone" });
  await repo.commit({ novelId: batch.novelId, kind: "reading.undo", records });
}
