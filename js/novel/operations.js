import { indexText } from "../context/index.js";
import { id, now, textBlob } from "../core/ids.js";
import { assert } from "../core/schema.js";
export async function revise(
  repo,
  sceneId,
  baseRevisionId,
  text,
  sourceKind = "author",
  extra = {},
) {
  const scene = await repo.get(sceneId),
    n = await repo.get(scene.novelId),
    blob = await textBlob(text),
    op = id("op");
  const revision = {
    id: id("revision"),
    type: "revision",
    novelId: n.id,
    ownerId: sceneId,
    parentRevisionId: baseRevisionId,
    textBlobId: blob.id,
    sourceKind,
    operationId: op,
    createdAt: now(),
    ...extra.provenance,
  };
  const owned = await repo.query("novelId", n.id),
    sourceIds = new Set(
      owned
        .filter(
          (r) =>
            (r.type === "revision" && r.ownerId === sceneId) ||
            (r.type === "candidate" && r.sceneId === sceneId),
        )
        .map((r) => r.id),
    );
  const dependents = owned.filter(
    (r) =>
      ["canon", "artifact"].includes(r.type) &&
      (r.type === "artifact" || r.derived) &&
      (r.sourceRefs || []).some(
        (x) =>
          x.id === baseRevisionId ||
          x.revisionId === baseRevisionId ||
          (["author", "selection.replace", "revision.restore"].includes(
            sourceKind,
          ) &&
            (sourceIds.has(x.id) || sourceIds.has(x.revisionId))),
      ),
  );
  const stale = dependents.map((r) => ({
    ...r,
    ...(r.type === "canon"
      ? { status: r.derived ? "stale" : r.status }
      : { freshness: "stale" }),
  }));
  await repo.commit({
    novelId: n.id,
    kind: sourceKind,
    expectedScene: { id: sceneId, revisionId: baseRevisionId },
    operationId: op,
    records: [
      revision,
      {
        ...scene,
        currentRevisionId: revision.id,
        searchIndex: indexText(text),
      },
      ...stale.filter((r) => !(extra.records || []).some((x) => x.id === r.id)),
      ...(extra.records || []),
    ],
    blobs: [blob],
  });
  return revision;
}
export async function createCandidate(
  repo,
  {
    sceneId,
    baseRevisionId,
    range,
    direction,
    kind = "write",
    requestId,
    extra = {},
  },
) {
  const current = await repo.sceneText(sceneId),
    scene = current.scene;
  const revision = baseRevisionId
    ? await repo.get(baseRevisionId)
    : current.revision;
  assert(
    revision?.ownerId === sceneId,
    "Candidate source belongs to another scene.",
  );
  const text = baseRevisionId
    ? await repo.text(revision.textBlobId)
    : current.text;
  range = range || [text.length, text.length];
  assert(
    range[0] >= 0 && range[1] >= range[0] && range[1] <= text.length,
    "Invalid selection.",
  );
  const blob = await textBlob("");
  const c = {
    id: id("candidate"),
    type: "candidate",
    novelId: scene.novelId,
    sceneId,
    baseRevisionId: revision.id,
    insertionRange: range,
    originalSelection: text.slice(...range),
    textBlobId: blob.id,
    status: "streaming",
    direction,
    kind,
    requestId,
    createdAt: now(),
    ...extra,
  };
  await repo.commit({
    novelId: scene.novelId,
    kind: "candidate.create",
    records: [c],
    blobs: [blob],
  });
  return c;
}
export async function saveCandidate(repo, c, text, status, extra = {}) {
  const current = await repo.get(c.id);
  if (!current || ["kept", "discarded"].includes(current.status))
    return current;
  const blob = await textBlob(text),
    scene = await repo.get(c.sceneId);
  const record = {
    ...current,
    ...extra,
    textBlobId: blob.id,
    status: scene.currentRevisionId === c.baseRevisionId ? status : "stale",
  };
  await repo.commit({
    novelId: c.novelId,
    kind: "candidate.progress",
    records: [record],
    blobs: [blob],
    generation: c.libraryGeneration,
  });
  return record;
}
export async function acceptCandidate(repo, candidateId) {
  const c = await repo.get(candidateId);
  assert(
    c && ["ready", "partial"].includes(c.status),
    "This candidate needs comparison or is not ready.",
  );
  const { scene, revision, text } = await repo.sceneText(c.sceneId);
  assert(
    revision.id === c.baseRevisionId &&
      text.slice(...c.insertionRange) === c.originalSelection,
    "The manuscript changed. This candidate is preserved for comparison.",
  );
  const passage = await repo.text(c.textBlobId);
  assert(passage.length > 0, "There is no passage to keep.");
  const prefix = text.slice(0, c.insertionRange[0]),
    suffix = text.slice(c.insertionRange[1]);
  const separator =
    c.kind === "revise" ? "" : prefix && !prefix.endsWith("\n") ? "\n\n" : "";
  const records = [{ ...c, status: "kept", acceptedAt: now() }];
  if (c.explorationId) {
    const ex = await repo.get(c.explorationId);
    records.push({ ...ex, status: "adapted" });
    const events = (await repo.query("novelId", c.novelId)).filter(
      (x) =>
        x.type === "canon" &&
        x.explorationId === ex.id &&
        x.branchId === c.branchId,
    );
    for (const event of events) records.push({ ...event, proseInserted: true });
    if (!events.length)
      records.push({
        id: id("canon"),
        type: "canon",
        novelId: c.novelId,
        recordKind: "acceptedEvent",
        proposition: "Events in the accepted exploration adaptation",
        status: "active",
        certainty: "established",
        explorationId: ex.id,
        branchId: c.branchId,
        proseInserted: true,
        sourceRefs: [{ id: c.id }],
        validFrom: scene.fictionalTime,
        derived: false,
      });
  }
  return revise(
    repo,
    c.sceneId,
    c.baseRevisionId,
    prefix + separator + passage + suffix,
    c.kind === "revise" ? "selection.replace" : "candidate.accept",
    {
      records,
      provenance: {
        candidateId: c.id,
        explorationId: c.explorationId || null,
        sourceRefs: [{ id: c.id }],
      },
    },
  );
}
export async function placeCandidate(repo, candidateId, range) {
  const c = await repo.get(candidateId),
    { revision, text } = await repo.sceneText(c.sceneId);
  assert(
    range[0] >= 0 && range[1] >= range[0] && range[1] <= text.length,
    "Invalid new placement.",
  );
  const placed = {
    ...c,
    id: id("candidate"),
    baseRevisionId: revision.id,
    insertionRange: range,
    originalSelection: text.slice(...range),
    status: "ready",
    repositionedFrom: c.id,
  };
  await repo.update(placed, "candidate.reposition");
  return placed;
}
export async function addChapter(repo, novelId, title) {
  const n = await repo.get(novelId),
    c = {
      id: id("chapter"),
      type: "chapter",
      novelId,
      title,
      orderedSceneIds: [],
      notes: "",
      status: "draft",
    };
  await repo.commit({
    novelId,
    kind: "chapter.create",
    expectedVersion: n.contentVersion,
    records: [c, { ...n, orderedChapterIds: [...n.orderedChapterIds, c.id] }],
  });
  return c;
}
export async function addScene(repo, chapterId, title) {
  const c = await repo.get(chapterId),
    s = id("scene"),
    r = id("revision"),
    blob = await textBlob("");
  const scene = {
    id: s,
    type: "scene",
    novelId: c.novelId,
    chapterId,
    title,
    currentRevisionId: r,
    viewpoint: "",
    fictionalTime: null,
    timeLabel: "",
    status: "draft",
    notes: "",
    summary: "",
  };
  const n = await repo.get(c.novelId);
  await repo.commit({
    novelId: c.novelId,
    kind: "scene.create",
    expectedVersion: n.contentVersion,
    records: [
      scene,
      {
        id: r,
        type: "revision",
        novelId: c.novelId,
        ownerId: s,
        parentRevisionId: null,
        textBlobId: blob.id,
        sourceKind: "author",
        createdAt: now(),
      },
      { ...c, orderedSceneIds: [...c.orderedSceneIds, s] },
    ],
    blobs: [blob],
  });
  return scene;
}
export async function reorder(repo, ownerId, key, itemId, delta) {
  const owner = await repo.get(ownerId),
    a = [...owner[key]],
    from = a.indexOf(itemId),
    to = Math.min(a.length - 1, Math.max(0, from + delta));
  assert(from >= 0, "Item is no longer in this order.");
  a.splice(from, 1);
  a.splice(to, 0, itemId);
  await repo.update({ ...owner, [key]: a }, "order.change");
}

export async function updateScene(repo, scene, changes) {
  const next = { ...scene, ...changes };
  if (next.chapterId === scene.chapterId)
    return repo.update(next, "scene.details");
  const before = await repo.get(scene.chapterId),
    after = await repo.get(next.chapterId),
    novel = await repo.get(scene.novelId);
  assert(
    after?.novelId === scene.novelId && after.type === "chapter",
    "Choose a chapter in this novel.",
  );
  return repo.commit({
    novelId: scene.novelId,
    kind: "scene.move",
    expectedVersion: novel.contentVersion,
    expectedScene: { id: scene.id, revisionId: scene.currentRevisionId },
    records: [
      next,
      {
        ...before,
        orderedSceneIds: before.orderedSceneIds.filter((id) => id !== scene.id),
      },
      { ...after, orderedSceneIds: [...after.orderedSceneIds, scene.id] },
    ],
  });
}
