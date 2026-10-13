import { id, now, textBlob } from "../core/ids.js";
import { assert } from "../core/schema.js";
import { contextCheck } from "../context/assemble.js";
import { applyReading } from "../story/reading.js";
export async function analyze(writer, options) {
  const scene = await writer.repo.get(options.sceneId),
    source = await writer.repo.get(
      options.exploration?.id || options.candidateId || scene.currentRevisionId,
    ),
    text = options.sourceText ?? (await writer.repo.text(source.textBlobId));
  const generation =
    options.libraryGeneration ||
    writer.repo.generation ||
    (await writer.repo.get("library", "meta")).generation;
  const start = options.readingStart || 0;
  let end = Math.min(text.length, start + 12000);
  if (end < text.length) {
    const boundary = text.lastIndexOf("\n", end);
    if (boundary > start) end = boundary + 1;
  }
  const segmentBlob = options.exploration
    ? await textBlob(text.slice(start, end))
    : null;
  const task = {
    id:
      "artifact_task_" +
      (
        await textBlob(
          JSON.stringify([
            source.id,
            options.exploration?.activeBranchId,
            start,
            text.slice(start, end),
          ]),
        )
      ).id.slice(5),
    type: "artifact",
    novelId: options.novelId,
    sceneId: scene.id,
    kind: "readingTask",
    state: "running",
    candidateId: options.candidateId || null,
    baseRevisionId: scene.currentRevisionId,
    sourceRefs: [{ id: source.id }],
    coverage: {
      start,
      end: start,
      segmentEnd: end,
      sourceLength: text.length,
      complete: false,
    },
    ...(options.exploration
      ? {
          explorationId: options.exploration.id,
          branchId: options.exploration.activeBranchId,
          sourceTurnSpans: options.sourceTurnSpans || [],
          textBlobId: segmentBlob.id,
          sourceTextOffset: start,
          coveredTurnIds: options.coveredTurnIds || [],
        }
      : {}),
    createdAt: now(),
  };
  await writer.repo.commit({
    novelId: options.novelId,
    kind: "reading.pending",
    generation,
    records: [task],
    blobs: segmentBlob ? [segmentBlob] : [],
  });
  let result, parsed;
  try {
    result = await writer.run({
      ...options,
      kind: "analysis",
      auxiliary: true,
      sourceRecordId: source.id,
      sourceTextBlobId: source.textBlobId,
      sourceText: text.slice(start, end),
      readingSegment: [start, end],
      direction:
        (options.direction ||
          "Read this source segment once. Return supported typed updates, coverage and three possibilities.") +
        `\nSource identity ${source.id}. Segment starts at ${start}, ends at ${end}. The full source length is ${text.length}. Quote exact evidence. Offsets use UTF16 units in the original source.`,
    });
    parsed = JSON.parse(result.text);
    assert(
      Array.isArray(parsed.suggestions) &&
        parsed.suggestions.every((s) => typeof s === "string"),
      "Invalid suggestions.",
    );
  } catch (error) {
    await writer.repo
      .commit({
        novelId: options.novelId,
        kind: "reading.failed",
        generation,
        records: [{ ...task, state: "failed", error: error.message }],
      })
      .catch(() => {});
    throw new Error(
      "The optional source reader did not complete. Pending coverage and original writing are retained. " +
        error.message,
    );
  }
  const candidate = options.candidateId
      ? await writer.repo.get(options.candidateId)
      : null,
    currentScene = await writer.repo.get(options.sceneId);
  const check = result.snapshot
    ? await contextCheck(writer.repo, result.snapshot, {
        allowAcceptedCandidate: true,
      })
    : {
        current:
          !result.stale &&
          currentScene.currentRevisionId === result.sourceRevisionId,
      };
  const updates = Array.isArray(parsed.updates)
    ? parsed.updates
    : Array.isArray(parsed.memories)
      ? parsed.memories.map((m) => ({
          ...m,
          recordKind: "memory",
          support: "review",
        }))
      : [];
  const partial =
    result.finishReason && !["stop", "end_turn"].includes(result.finishReason);
  const covered = partial
    ? start
    : Number.isInteger(parsed.coverageEnd)
      ? Math.max(start, Math.min(end, parsed.coverageEnd))
      : parsed.coverageComplete === true
        ? end
        : start;
  const sourceBlob = segmentBlob;
  const artifact = {
    id: id("artifact"),
    type: "artifact",
    novelId: options.novelId,
    sceneId: scene.id,
    kind: "analysis",
    ...(sourceBlob
      ? { textBlobId: sourceBlob.id, sourceTextOffset: start }
      : {}),
    ...(partial
      ? {
          error:
            "The reading stopped before confirmed completion. Coverage remains pending.",
        }
      : {}),
    body: {
      suggestions: parsed.suggestions.slice(0, 3),
      memories: parsed.memories || [],
      updates,
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    },
    candidateId: options.candidateId || null,
    baseRevisionId: result.sourceRevisionId,
    contextSnapshot: result.snapshot,
    sourceRefs: [{ id: source.id }],
    coverage: {
      sourceId: source.id,
      start,
      end: covered,
      segmentEnd: end,
      sourceLength: text.length,
      complete: covered === text.length,
    },
    freshness:
      check.current && candidate?.status !== "discarded" ? "fresh" : "stale",
    createdAt: now(),
    ...(options.exploration
      ? {
          explorationId: options.exploration.id,
          branchId: options.exploration.activeBranchId,
          sourceTurnSpans: options.sourceTurnSpans || [],
          coveredTurnIds: options.sourceTurnSpans
            ? options.sourceTurnSpans
                .filter((span) => span.end > start && span.start < covered)
                .map((span) => span.id)
            : options.coveredTurnIds || [],
          fullyReadTurnIds: options.sourceTurnSpans
            ? options.sourceTurnSpans
                .filter((span) => span.start >= start && span.end <= covered)
                .map((span) => span.id)
            : covered === text.length
              ? options.coveredTurnIds || []
              : [],
        }
      : {}),
  };
  try {
    await writer.repo.commit({
      novelId: artifact.novelId,
      kind: "analysis.result",
      generation,
      records: [artifact],
      blobs: sourceBlob ? [sourceBlob] : [],
      contextPrecondition: check.current ? check.precondition : undefined,
    });
  } catch (e) {
    artifact.freshness = "stale";
    artifact.error = e.message;
    await writer.repo.commit({
      novelId: artifact.novelId,
      kind: "analysis.stale",
      generation,
      records: [artifact],
      blobs: sourceBlob ? [sourceBlob] : [],
    });
  }
  await writer.repo.commit({
    novelId: options.novelId,
    kind: "reading.finished",
    generation,
    records: [
      {
        ...task,
        state: partial ? "failed" : "completed",
        coverage: artifact.coverage,
        error: artifact.error || null,
      },
    ],
  });
  if (artifact.freshness === "fresh" && !partial)
    await applyReading(writer.repo, artifact.id);
  return artifact;
}
// Retain the first release's individual manual memory review path.
export async function acceptMemory(repo, artifactId, index) {
  const a = await repo.get(artifactId),
    m = a.body.memories[index];
  assert(m, "Missing memory proposal.");
  const changed = {
    ...a,
    coverage: { ...a.coverage, end: a.coverage?.segmentEnd ?? a.coverage?.end },
    body: {
      ...a.body,
      updates: [{ ...m, recordKind: "memory", support: "explicit" }],
    },
  };
  await repo.update(changed, "memory.review");
  return applyReading(repo, a.id, { reviewed: true });
}
