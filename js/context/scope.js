export function makeScope(scene, revision, text, options, records, library) {
  const ex = options.exploration;
  const turns = records.filter(
    (r) => r.type === "turn" && r.parentSessionId === ex?.id,
  );
  const branchIds = new Map((ex?.branches || []).map((b) => [b.id, b]));
  const chosen = [];
  function ancestry(branchId, limit = Infinity) {
    const b = branchIds.get(branchId);
    if (!b) return;
    if (b.parentId) ancestry(b.parentId, Math.min(limit, b.forkSequence));
    chosen.push(
      ...turns.filter((t) => t.branchId === branchId && t.sequence <= limit),
    );
  }
  if (ex) ancestry(ex.activeBranchId);
  chosen.sort((a, b) => a.sequence - b.sequence);
  const liveTranscriptHead = chosen.at(-1)?.id || null;
  if (options.transcriptHeadId) {
    const head = chosen.find((t) => t.id === options.transcriptHeadId);
    if (head) chosen.splice(chosen.findIndex((t) => t.id === head.id) + 1);
  }
  const frames = records
    .filter(
      (r) =>
        r.kind === "branchFrame" &&
        r.explorationId === ex?.id &&
        r.freshness !== "stale" &&
        r.coveredTurnIds?.length &&
        r.coveredTurnIds.every((id) => chosen.some((t) => t.id === id)),
    )
    .sort(
      (a, b) =>
        Math.max(
          ...a.coveredTurnIds.map((id) => chosen.findIndex((t) => t.id === id)),
        ) -
        Math.max(
          ...b.coveredTurnIds.map((id) => chosen.findIndex((t) => t.id === id)),
        ),
    );
  const branchFrame = frames.at(-1)?.body;
  return {
    branchFictionalTime: branchFrame?.fictionalTime ?? null,
    branchRelativeTime: branchFrame?.relativeTime || "Not yet established",
    novelId: scene.novelId,
    libraryGeneration: library.generation,
    sceneId: scene.id,
    revisionId: revision.id,
    boundary: ex?.boundary ?? text.length,
    fullLength: text.length,
    fictionalTime: scene.fictionalTime,
    explorationId: ex?.id || null,
    branchId: ex?.activeBranchId || null,
    playerCharacterId: ex?.playerCharacterId || null,
    narrativeViewpoint: ex?.narrativeViewpoint || scene.viewpoint,
    turnIds: chosen.map((t) => t.id),
    transcriptHead: chosen.at(-1)?.id || null,
    liveTranscriptHead,
    historical: options.kind === "rp" || ex != null,
    authorOverview:
      ["discuss", "director", "editor", "recall"].includes(options.kind) && !ex,
  };
}
export function mappedRange(ref, source, target, byId) {
  if (ref.start == null || ref.end == null) return null;
  let cursor = byId.get(target),
    chain = [];
  while (cursor && cursor.id !== source) {
    chain.push(cursor);
    cursor = byId.get(cursor.parentRevisionId);
  }
  if (!cursor) return null;
  let start = ref.start,
    end = ref.end;
  for (const revision of chain.reverse()) {
    const edit = revision.edit;
    if (!edit) return null;
    if (end <= edit.start) continue;
    if (start >= edit.end) {
      const delta = edit.replacementLength - (edit.end - edit.start);
      start += delta;
      end += delta;
    } else return null;
  }
  return { start, end };
}
function preceding(sceneId, scope, byId, seen = new Set()) {
  if (sceneId === scope.sceneId) return true;
  if (seen.has(scope.sceneId)) return false;
  seen.add(scope.sceneId);
  const current = byId.get(scope.sceneId);
  if (!current?.continuationOf) return false;
  if (current.continuationOf === sceneId) return true;
  return preceding(
    sceneId,
    { ...scope, sceneId: current.continuationOf },
    byId,
    seen,
  );
}
function knownEarlierTime(scope, byId) {
  let scene = byId.get(scope.sceneId),
    seen = new Set(),
    time = null;
  while (scene && !seen.has(scene.id)) {
    seen.add(scene.id);
    if (scene.fictionalTime != null)
      time = Math.max(time ?? scene.fictionalTime, scene.fictionalTime);
    scene = byId.get(scene.continuationOf);
  }
  return time;
}
export function permitted(record, scope, byId) {
  if (
    scope.authorOverview &&
    record.scope !== "exploration" &&
    !(
      record.explorationId &&
      record.type === "entity" &&
      record.scope !== "novel"
    ) &&
    !["turn", "exploration"].includes(record.type)
  )
    return true;
  // A branch replacement is an overlay, never a mutation of the shared ancestor.
  if (
    record.scope === "exploration" &&
    [...byId.values()].some(
      (r) =>
        r.supersedes === record.id &&
        r.status === "active" &&
        r.explorationId === scope.explorationId &&
        r.coveredTurnIds?.length &&
        r.coveredTurnIds.every((id) => scope.turnIds.includes(id)) &&
        (r.validFrom == null ||
          scope.branchFictionalTime == null ||
          r.validFrom <= scope.branchFictionalTime),
    )
  )
    return false;
  if (
    scope.explorationId &&
    record.explorationId === scope.explorationId &&
    record.coveredTurnIds?.length &&
    !record.coveredTurnIds.every((id) => scope.turnIds.includes(id))
  )
    return false;
  if (record.scope === "exploration") {
    if (
      !(
        record.explorationId === scope.explorationId &&
        (
          record.coveredTurnIds ||
          record.sourceRefs?.map((s) => s.id) ||
          []
        ).every((id) => scope.turnIds.includes(id))
      )
    )
      return false;
  }
  if (
    record.explorationId &&
    record.type === "entity" &&
    record.scope !== "novel"
  )
    return false;
  const effectiveTime =
    record.scope === "exploration"
      ? scope.branchFictionalTime
      : scope.fictionalTime;
  if (
    record.validFrom != null &&
    (effectiveTime == null
      ? record.scope === "exploration"
        ? false
        : knownEarlierTime(scope, byId) == null ||
          record.validFrom > knownEarlierTime(scope, byId)
      : record.validFrom > effectiveTime)
  )
    return false;
  if (
    record.validUntil != null &&
    effectiveTime != null &&
    record.validUntil <= effectiveTime
  )
    return false;
  if (record.scope === "exploration") return true;
  if (record.temporalScope === "invariant") return true;
  if (record.type === "scene") {
    if (record.id === scope.sceneId) return true;
    if (record.fictionalTime != null && scope.fictionalTime != null)
      return record.fictionalTime <= scope.fictionalTime;
    return preceding(record.id, scope, byId);
  }
  for (const ref of record.sourceRefs || []) {
    const source = byId.get(ref.revisionId || ref.id);
    if (!source && record.derived) return false;
    const sourceExploration =
      source?.type === "turn"
        ? byId.get(source.parentSessionId)
        : source?.type === "exploration"
          ? source
          : null;
    const scene = byId.get(
      source?.ownerId ||
        source?.sceneId ||
        sourceExploration?.baseSceneId ||
        ref.sceneId,
    );
    if (!scene) continue;
    if (scene.id === scope.sceneId) {
      const end = ref.end ?? record.sourceCoverage?.end;
      if (
        scope.boundary < scope.fullLength &&
        (() => {
          const range =
            source?.id === scope.revisionId
              ? { end }
              : mappedRange(ref, source?.id, scope.revisionId, byId);
          return !range || range.end == null || range.end > scope.boundary;
        })()
      )
        return false;
    } else if (!permitted(scene, scope, byId)) return false;
  }
  if (
    record.entryBoundary != null &&
    record.baseSceneId === scope.sceneId &&
    (record.entryBoundary > scope.boundary ||
      (scope.historical && record.entryBoundary === scope.boundary))
  )
    return false;
  if (
    scope.historical &&
    record.type === "canon" &&
    record.validFrom == null &&
    !record.entryBoundary &&
    !(record.sourceRefs || []).some((ref) => {
      const source = byId.get(ref.revisionId || ref.id);
      return (
        source?.type === "revision" ||
        source?.type === "candidate" ||
        source?.type === "turn"
      );
    })
  )
    return false;
  if (record.derived && (record.sourceRefs || []).length === 0) return false;
  return true;
}
export function metadataAt(scene, scope) {
  const read = (name) => {
    const coverage = scene[name + "Coverage"];
    if (
      coverage?.revisionId === scope.revisionId &&
      coverage.end <= scope.boundary
    )
      return scene[name];
    if (scene[name + "Scope"] === "invariant") return scene[name];
    if (!scope.historical && scope.boundary === scope.fullLength)
      return scene[name];
    return "";
  };
  return { summary: read("summary"), notes: read("notes") };
}
export function profileAt(entity, scope, byId) {
  const claims = (entity.profileClaims || [])
    .filter((c) => permitted({ ...c, derived: true }, scope, byId))
    .map((c) => c.text);
  if (
    !scope.historical &&
    entity.profile &&
    entity.profileScope !== "invariant"
  )
    claims.unshift(
      "Author supplied profile, historical scope may be uncertain. Do not grant characters timed developments without eligible sources:\n" +
        entity.profile,
    );
  if (entity.invariantProfile) claims.unshift(entity.invariantProfile);
  if (entity.profileScope === "invariant") claims.unshift(entity.profile);
  else if (
    scope.historical &&
    entity.profileValidFrom != null &&
    permitted(
      {
        validFrom: entity.profileValidFrom,
        sourceRefs: entity.profileSourceRefs || [],
      },
      scope,
      byId,
    )
  )
    claims.unshift(entity.profile);
  return claims.filter(Boolean).join("\n");
}
