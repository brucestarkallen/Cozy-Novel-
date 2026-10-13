import { id, now, textBlob } from "../core/ids.js";
import { assert } from "../core/schema.js";
import { makeScope, permitted } from "../context/scope.js";
import { CANON_KINDS } from "../config.js";
import { contextCheck } from "../context/assemble.js";
export async function createExploration(
  repo,
  { sceneId, playerCharacterId, boundary, narrativeViewpoint, newPerson },
) {
  const captured = repo.captureNovel
    ? await repo.captureNovel((await repo.get(sceneId)).novelId)
    : repo;
  const { scene, revision, text } = await captured.sceneText(sceneId),
    exId = id("exploration");
  const player = newPerson
    ? {
        id: id("entity"),
        type: "entity",
        novelId: scene.novelId,
        kind: "person",
        displayName: newPerson,
        aliases: [],
        profile: "",
        sourceRefs: [],
        scope: "exploration",
        explorationId: exId,
      }
    : await captured.get(playerCharacterId);
  playerCharacterId = player?.id;
  assert(
    player?.novelId === scene.novelId && player.kind === "person",
    "Choose a person from this novel.",
  );
  assert(
    boundary >= 0 && boundary <= text.length,
    "Invalid exploration boundary.",
  );
  const branch = id("branch");
  const baselineId = id("artifact");
  const e = {
    id: exId,
    type: "exploration",
    novelId: scene.novelId,
    baseSceneId: sceneId,
    baseRevisionId: revision.id,
    boundary,
    baseContextId: baselineId,
    sceneSnapshot: {
      fictionalTime: scene.fictionalTime,
      timeLabel: scene.timeLabel,
      viewpoint: scene.viewpoint,
      summary: scene.summary,
      notes: scene.notes,
    },
    playerCharacterId,
    narrativeViewpoint,
    activeBranchId: branch,
    branches: [{ id: branch, parentId: null, forkSequence: 0 }],
    status: "active",
    createdAt: now(),
  };
  await repo.commit({
    novelId: scene.novelId,
    kind: "exploration.create",
    expectedScene: { id: sceneId, revisionId: revision.id },
    generation: captured.library?.generation,
    contextPrecondition:
      captured.contextEpoch != null
        ? {
            generation: captured.library.generation,
            epoch: captured.contextEpoch,
          }
        : undefined,
    records: [
      ...(newPerson ? [player] : []),
      e,
      {
        id: baselineId,
        type: "artifact",
        novelId: scene.novelId,
        kind: "explorationBase",
        explorationId: e.id,
        sourceRefs: [{ id: revision.id }],
        body: {
          records: (await captured.query("novelId", scene.novelId)).filter(
            (r) =>
              [
                "novel",
                "chapter",
                "scene",
                "revision",
                "entity",
                "canon",
                "prompt",
              ].includes(r.type) ||
              (r.type === "artifact" &&
                ["storySummary", "entityProfile"].includes(r.kind)),
          ),
        },
      },
    ],
  });
  return e;
}
export async function branchTurns(repo, ex, branchId = ex.activeBranchId) {
  const turns = await repo.query("parentSessionId", ex.id),
    branch = ex.branches.find((b) => b.id === branchId);
  assert(branch, "Unknown exploration branch.");
  const ancestors = branch.parentId
    ? (await branchTurns(repo, ex, branch.parentId)).filter(
        (t) => t.sequence <= branch.forkSequence,
      )
    : [];
  return ancestors
    .concat(turns.filter((t) => t.branchId === branchId))
    .sort((a, b) => a.sequence - b.sequence);
}
export async function sourceTranscript(
  repo,
  ex,
  { fromSequence = 1, toSequence = Infinity } = {},
) {
  const turns = (await branchTurns(repo, ex)).filter(
      (t) => t.sequence >= fromSequence && t.sequence <= toSequence,
    ),
    spans = [];
  let text = "";
  for (const turn of turns) {
    const actor = turn.actorId ? await repo.get(turn.actorId) : null;
    const line = `[${turn.role}${actor ? " | " + actor.displayName : ""}]\n${await repo.text(turn.textBlobId)}`;
    if (text) text += "\n\n";
    const start = text.length;
    text += line;
    spans.push({
      id: turn.id,
      start,
      bodyStart: start + line.indexOf("\n") + 1,
      end: text.length,
      sequence: turn.sequence,
      header: line.slice(0, line.indexOf("\n") + 1),
      textBlobId: turn.textBlobId,
    });
  }
  return { text, spans };
}
export async function readingSource(repo, artifact) {
  if (artifact.sourceTurnSpans?.length) {
    const lines = [];
    for (const span of artifact.sourceTurnSpans)
      lines.push(span.header + (await repo.text(span.textBlobId)));
    return lines.join("\n\n");
  }
  return repo.text(artifact.textBlobId);
}
export async function transcript(
  repo,
  ex,
  {
    full = false,
    fromSequence = 1,
    toSequence = Infinity,
    budget = 16000,
  } = {},
) {
  if (full)
    return (await sourceTranscript(repo, ex, { fromSequence, toSequence }))
      .text;
  const turns = await branchTurns(repo, ex);
  const lines = [];
  let selected = turns.filter(
    (t) => t.sequence >= fromSequence && t.sequence <= toSequence,
  );
  let summary = "";
  if (!full) {
    const readings = (await repo.query("novelId", ex.novelId)).filter(
      (r) =>
        r.kind === "branchReading" &&
        r.explorationId === ex.id &&
        r.freshness !== "stale" &&
        (r.coveredTurnIds || []).every((id) => turns.some((t) => t.id === id)),
    );
    summary = readings
      .map(
        (r) =>
          `[sources ${(r.coveredTurnIds || []).join(", ")}] ${r.body.summary}`,
      )
      .join("\n");
    // Budget actual source bodies, preserving whole turns whenever possible.
    let remaining = Math.max(
      1000,
      budget - Math.min(summary.length, budget / 3),
    );
    const recent = [];
    for (const t of selected.slice().reverse()) {
      const text = await repo.text(t.textBlobId);
      if (text.length + 200 > remaining) {
        if (!recent.length)
          recent.push({
            ...t,
            excerpt: text.slice(-Math.max(0, remaining - 300)),
            omittedPrefix: true,
          });
        break;
      }
      recent.push(t);
      remaining -= text.length + 200;
    }
    selected = recent.reverse();
    const omitted = turns.filter((t) => !selected.some((s) => s.id === t.id));
    if (omitted.length)
      lines.push(
        `[Earlier turn originals retained outside this request: ${omitted.map((t) => t.id).join(", ")}. A missing summary is not evidence these events never happened.]`,
      );
    if (summary.length > budget / 3)
      summary =
        summary.slice(-Math.floor(budget / 3)) +
        "\n[Some optional branch readings omitted for budget]";
  }
  for (const t of selected) {
    const actor = t.actorId ? await repo.get(t.actorId) : null;
    lines.push(
      `[${t.role}${actor ? " | " + actor.displayName : ""}]\n${t.omittedPrefix ? "[Earlier part of this turn omitted]\n" : ""}${t.excerpt ?? (await repo.text(t.textBlobId))}`,
    );
  }
  return (
    (summary
      ? "[Source linked branch reading, earlier originals retained]\n" +
        summary +
        "\n\n"
      : "") + lines.join("\n\n")
  );
}
export async function branchState(repo, ex, turns) {
  const records = await repo.query("novelId", ex.novelId),
    saved =
      ex.baseContextRecords ||
      (ex.baseContextId
        ? (await repo.get(ex.baseContextId))?.body.records
        : null) ||
      records;
  const all = [
    ...saved,
    ...records.filter(
      (r) => r.scope === "exploration" && r.explorationId === ex.id,
    ),
    ...turns,
  ];
  const byId = new Map(all.map((r) => [r.id, r])),
    scene = { ...byId.get(ex.baseSceneId), ...ex.sceneSnapshot };
  const revision = await repo.get(ex.baseRevisionId),
    text = await repo.text(revision.textBlobId);
  const scope = makeScope(
    scene,
    revision,
    text,
    { kind: "rp", exploration: ex },
    [...all, ex],
    await repo.get("library", "meta"),
  );
  const claims = all.filter(
    (r) =>
      r.type === "canon" && r.status === "active" && permitted(r, scope, byId),
  );
  const covered = new Set(
    records
      .filter(
        (r) =>
          r.kind === "branchReading" &&
          r.explorationId === ex.id &&
          r.freshness !== "stale" &&
          (r.coveredTurnIds || []).every((id) =>
            turns.some((t) => t.id === id),
          ),
      )
      .flatMap(
        (r) =>
          r.fullyReadTurnIds || (r.body.complete ? r.coveredTurnIds || [] : []),
      ),
  );
  for (const turn of turns) {
    const parts = records
      .filter(
        (r) =>
          r.kind === "branchReading" &&
          r.explorationId === ex.id &&
          r.freshness !== "stale" &&
          (r.coveredTurnIds || []).every((id) =>
            turns.some((t) => t.id === id),
          ),
      )
      .flatMap((r) => r.turnCoverage || [])
      .filter((p) => p.id === turn.id)
      .sort((a, b) => a.start - b.start);
    let end = 0;
    for (const part of parts) {
      if (part.start > end) break;
      end = Math.max(end, part.end);
      if (end >= part.fullLength) covered.add(turn.id);
    }
  }
  return {
    baseRevisionId: ex.baseRevisionId,
    entryBoundary: ex.boundary,
    branchId: ex.activeBranchId,
    turnIds: turns.map((t) => t.id),
    transcriptHeadId: turns.at(-1)?.id || null,
    playerCharacterId: ex.playerCharacterId,
    narrativeViewpoint: ex.narrativeViewpoint,
    fictionalTime: ex.sceneSnapshot?.fictionalTime ?? null,
    claims: claims.map((r) => ({
      id: r.id,
      kind: r.recordKind,
      holderId: r.holderId,
      subjectId: r.subjectId,
      proposition: r.proposition,
      certainty: r.certainty,
      planState: r.planState,
      sourceRefs: r.sourceRefs,
    })),
    unreadTurnIds: turns.filter((t) => !covered.has(t.id)).map((t) => t.id),
    authority:
      "Exploration only. Eligible base state and actual branch turns remain primary; readings are reversible interpretations.",
  };
}
export async function addTurn(repo, ex, role, text, extra = {}) {
  const fresh = await repo.get(ex.id);
  assert(
    fresh.activeBranchId === ex.activeBranchId,
    "The exploration branch changed.",
  );
  const turns = await branchTurns(repo, ex),
    blob = await textBlob(text);
  const stateId = id("artifact");
  const turn = {
    id: id("turn"),
    type: "turn",
    novelId: ex.novelId,
    parentSessionId: ex.id,
    branchId: ex.activeBranchId,
    sequence: (turns.at(-1)?.sequence || 0) + 1,
    role,
    actorId: role === "player" ? ex.playerCharacterId : null,
    textBlobId: blob.id,
    estimatedCharacters: text.length,
    priorStateRef: turns.at(-1)?.resultingStateRef || ex.baseRevisionId,
    resultingStateRef: stateId,
    createdAt: now(),
    ...Object.fromEntries(
      Object.entries(extra).filter(([k]) => k !== "contextPrecondition"),
    ),
  };
  await repo.commit({
    novelId: ex.novelId,
    kind: "exploration.turn",
    records: [
      turn,
      {
        id: stateId,
        type: "artifact",
        novelId: ex.novelId,
        kind: "explorationState",
        scope: "exploration",
        explorationId: ex.id,
        branchId: ex.activeBranchId,
        body: await branchState(repo, ex, [...turns, turn]),
        sourceRefs: [{ id: turn.id }],
        createdAt: now(),
      },
    ],
    blobs: [blob],
    contextPrecondition: extra.contextPrecondition,
  });
  return turn;
}
export async function retryBranch(repo, ex) {
  const turns = await branchTurns(repo, ex),
    last = turns.at(-1);
  const fork = last?.role === "world" ? last.sequence - 1 : last?.sequence || 0;
  const branch = {
    id: id("branch"),
    parentId: ex.activeBranchId,
    forkSequence: fork,
  };
  const next = {
    ...ex,
    activeBranchId: branch.id,
    branches: [...ex.branches, branch],
  };
  await repo.update(next, "exploration.branch");
  return next;
}
export async function explorationCoverage(
  repo,
  ex,
  fromSequence = 1,
  toSequence = Infinity,
) {
  const turns = (await branchTurns(repo, ex)).filter(
    (t) => t.sequence >= fromSequence && t.sequence <= toSequence,
  );
  return {
    coveredTurnIds: turns.map((t) => t.id),
    transcriptHeadId: turns.at(-1)?.id || null,
    branchId: ex.activeBranchId,
    entryBoundary: ex.boundary,
    sourceTurnSpans: (
      await sourceTranscript(repo, ex, { fromSequence, toSequence })
    ).spans,
    fromSequence,
    toSequence: turns.at(-1)?.sequence || 0,
  };
}
export async function keepEvents(
  repo,
  ex,
  proposition,
  extra = {},
  held = false,
) {
  if (!held)
    return repo.withMutation(() =>
      keepEvents(repo, ex, proposition, extra, true),
    );
  const check = extra.contextSnapshot
    ? await contextCheck(repo, extra.contextSnapshot)
    : { current: true };
  assert(
    check.current,
    "The exploration changed during review. The proposal is retained; select its original branch or prepare a new proposal.",
  );
  assert(proposition.trim(), "Review the event record first.");
  const coverage = extra.coverage || (await explorationCoverage(repo, ex));
  const owned = await repo.query("novelId", ex.novelId),
    existing = owned.filter(
      (r) =>
        r.type === "canon" &&
        r.explorationId === ex.id &&
        r.recordKind === "acceptedEvent",
    );
  if (
    existing.some(
      (r) =>
        JSON.stringify(r.coveredTurnIds) ===
        JSON.stringify(coverage.coveredTurnIds),
    )
  )
    return existing.find(
      (r) =>
        JSON.stringify(r.coveredTurnIds) ===
        JSON.stringify(coverage.coveredTurnIds),
    );
  const current = await repo.get(ex.id);
  assert(
    current.activeBranchId === coverage.branchId,
    "The exploration branch changed during event review.",
  );
  const covered = new Set(existing.flatMap((r) => r.coveredTurnIds || [])),
    remaining = coverage.coveredTurnIds.filter((id) => !covered.has(id));
  assert(remaining.length, "These events have already been kept.");
  const event = {
    id: id("canon"),
    type: "canon",
    novelId: ex.novelId,
    recordKind: "acceptedEvent",
    proposition,
    status: "active",
    certainty: "author established",
    derived: false,
    explorationId: ex.id,
    baseSceneId: ex.baseSceneId,
    branchId: coverage.branchId,
    coveredTurnIds: remaining,
    transcriptHeadId: coverage.transcriptHeadId,
    entryBoundary: ex.boundary,
    proseInserted: false,
    validFrom: ex.sceneSnapshot?.fictionalTime ?? null,
    sourceRefs: [{ id: ex.id }, { id: ex.baseRevisionId }],
    proposal: extra.proposal || null,
    createdAt: now(),
  };
  const promoted = owned
    .filter(
      (r) =>
        r.type === "entity" &&
        r.explorationId === ex.id &&
        r.scope === "exploration" &&
        (r.id === ex.playerCharacterId ||
          remaining.some(
            (id) => owned.find((t) => t.id === id)?.actorId === r.id,
          )),
    )
    .map((r) => ({ ...r, scope: "novel", promotedBy: event.id }));
  const typed = [],
    turns = await branchTurns(repo, ex);
  for (const item of extra.proposal?.stateChanges || []) {
    if (
      !CANON_KINDS.includes(item.recordKind) ||
      !item.proposition ||
      !item.quote
    )
      continue;
    const sourceTurn = turns.find(
      (t) =>
        remaining.includes(t.id) &&
        (!item.turnId || t.id === item.turnId) &&
        t.role !== "player",
    );
    const matched = item.turnId
      ? sourceTurn
      : turns.find(
          (t) =>
            remaining.includes(t.id) &&
            t.role !== "player" &&
            item.quote &&
            t.id,
        );
    const candidates = item.turnId
      ? [matched].filter(Boolean)
      : turns.filter((t) => remaining.includes(t.id));
    let evidenceTurn;
    for (const t of candidates)
      if ((await repo.text(t.textBlobId)).includes(item.quote)) {
        evidenceTurn = t;
        break;
      }
    if (!evidenceTurn) continue;
    const holder =
        item.holderId &&
        owned.find((r) => r.id === item.holderId && r.type === "entity"),
      subject =
        item.subjectId &&
        owned.find((r) => r.id === item.subjectId && r.type === "entity");
    if (
      (item.holderId && !holder) ||
      (item.subjectId && !subject) ||
      (["knowledge", "belief", "secret", "intention"].includes(
        item.recordKind,
      ) &&
        !holder)
    )
      continue;
    typed.push({
      id: id("canon"),
      type: "canon",
      novelId: ex.novelId,
      recordKind: item.recordKind,
      proposition: item.proposition,
      holderId: holder?.id || null,
      subjectId: subject?.id || null,
      certainty: item.certainty || "author established",
      derived: false,
      status: "active",
      explorationId: ex.id,
      baseSceneId: ex.baseSceneId,
      branchId: coverage.branchId,
      coveredTurnIds: [evidenceTurn.id],
      transcriptHeadId: coverage.transcriptHeadId,
      entryBoundary: ex.boundary,
      validFrom: ex.sceneSnapshot?.fictionalTime ?? null,
      sourceRefs: [{ id: evidenceTurn.id }],
      acceptedEventId: event.id,
      proseInserted: false,
    });
    for (const entity of [holder, subject].filter(Boolean))
      if (
        entity.scope === "exploration" &&
        !promoted.some((r) => r.id === entity.id)
      )
        promoted.push({ ...entity, scope: "novel", promotedBy: event.id });
  }
  await repo.commitLocked({
    novelId: ex.novelId,
    contextPrecondition: check.precondition,
    kind: "exploration.events.accept",
    records: [event, ...typed, { ...ex, status: "eventsKept" }, ...promoted],
  });
  return event;
}
