import { id, now, textBlob } from "../core/ids.js";
import { assert } from "../core/schema.js";
export async function createExploration(
  repo,
  { sceneId, playerCharacterId, boundary, narrativeViewpoint },
) {
  const { scene, revision, text } = await repo.sceneText(sceneId),
    player = await repo.get(playerCharacterId);
  assert(
    player?.novelId === scene.novelId && player.kind === "person",
    "Choose a person from this novel.",
  );
  assert(
    boundary >= 0 && boundary <= text.length,
    "Invalid exploration boundary.",
  );
  const branch = id("branch");
  const e = {
    id: id("exploration"),
    type: "exploration",
    novelId: scene.novelId,
    baseSceneId: sceneId,
    baseRevisionId: revision.id,
    boundary,
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
  await repo.update(e, "exploration.create");
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
export async function transcript(repo, ex) {
  const turns = await branchTurns(repo, ex);
  const lines = [];
  for (const t of turns) {
    const actor = t.actorId ? await repo.get(t.actorId) : null;
    lines.push(
      `[${t.role}${actor ? " | " + actor.displayName : ""}]\n${await repo.text(t.textBlobId)}`,
    );
  }
  return lines.join("\n\n");
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
    priorStateRef: turns.at(-1)?.resultingStateRef || ex.baseRevisionId,
    resultingStateRef: stateId,
    createdAt: now(),
    ...extra,
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
        body: {
          transcriptHeadId: turn.id,
          playerCharacterId: ex.playerCharacterId,
          narrativeViewpoint: ex.narrativeViewpoint,
          fictionalTime: ex.sceneSnapshot?.fictionalTime ?? null,
          authority:
            "Exploration only. Consequences and learned information remain sourced to this transcript branch.",
        },
        sourceRefs: [{ id: turn.id }],
        createdAt: now(),
      },
    ],
    blobs: [blob],
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
export async function keepEvents(repo, ex, proposition) {
  assert(proposition.trim(), "Review and enter the event record first.");
  const existing = (await repo.query("novelId", ex.novelId)).find(
    (r) =>
      r.type === "canon" &&
      r.explorationId === ex.id &&
      r.branchId === ex.activeBranchId,
  );
  assert(!existing, "Events from this branch are already kept.");
  const scene = await repo.get(ex.baseSceneId);
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
    branchId: ex.activeBranchId,
    proseInserted: false,
    validFrom: scene.fictionalTime,
    sourceRefs: [{ id: ex.id }, { id: ex.baseRevisionId }],
    createdAt: now(),
  };
  await repo.commit({
    novelId: ex.novelId,
    kind: "exploration.events.accept",
    records: [event, { ...ex, status: "eventsKept" }],
  });
  return event;
}
