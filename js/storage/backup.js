import { configurationIdentity } from "../connections/presets.js";
import { draftIdentity } from "./drafts.js";
import { publicConnection } from "../connections/library.js";
import { id, now, textBlob } from "../core/ids.js";
import { validateBackup, assert } from "../core/schema.js";
import { complete, request } from "./database.js";
import { APP } from "../config.js";
export async function exportBackup(repo, novelId = null) {
  const tx = repo.db.transaction([
    "records",
    "blobs",
    "meta",
    "operations",
    "outbox",
  ]);
  const [records, blobs, lib, operations, outbox, metadata] = await Promise.all(
    [
      request(tx.objectStore("records").getAll()),
      request(tx.objectStore("blobs").getAll()),
      request(tx.objectStore("meta").get("library")),
      request(tx.objectStore("operations").getAll()),
      request(tx.objectStore("outbox").getAll()),
      request(tx.objectStore("meta").getAll()),
    ],
  );
  const selected = novelId
    ? records.filter((r) => r.novelId === novelId)
    : records;
  const used = new Set(selected.map((r) => r.textBlobId).filter(Boolean));
  // Receipts contain immutable source references and prompt blocks, never connection secrets.
  return {
    format: "cozyNovel.backup",
    schemaVersion: APP.schema,
    exportedAt: now(),
    scope: novelId ? "novel" : "library",
    library: {
      id: lib.libraryId,
      generation: lib.generation,
      activeProjectId: lib.activeProjectId,
    },
    records: selected,
    blobs: blobs.filter((b) => used.has(b.id)),
    coverage: {
      libraryId: lib.libraryId,
      generation: lib.generation,
      localCommitSequence: lib.commitSequence || 0,
      operationIds: outbox
        .filter((o) => o.libraryGeneration === lib.generation)
        .map((o) => o.id),
    },
    configuration: {
      version: 1,
      appearance: metadata.find((m) => m.id === "appearance") || null,
      stylePresets: metadata.find((m) => m.id === "stylePresets") || null,
      connectionLibrary: (() => {
        const c = metadata.find((m) => m.id === "connectionLibrary");
        return c
          ? {
              ...c,
              profiles: c.profiles.map((p) => ({
                ...publicConnection(p),
                hasSecret: false,
                relaySaved: false,
              })),
            }
          : null;
      })(),
    },
    operations: operations.filter((o) => !novelId || o.novelId === novelId),
  };
}
export async function inspectBackup(data) {
  validateBackup(data);
  for (const b of data.blobs) {
    assert(
      (await textBlob(b.text)).id === b.id,
      "Text checksum mismatch. The original library is unchanged.",
    );
  }
  return {
    novels: data.records.filter((r) => r.type === "novel").map((r) => r.title),
    scenes: data.records.filter((r) => r.type === "scene").length,
    revisions: data.records.filter((r) => r.type === "revision").length,
  };
}
export async function restoreBackup(
  repo,
  data,
  { copy = false, locked = false } = {},
) {
  if (!locked)
    return repo.withSync(
      () =>
        repo.withMutation(() =>
          restoreBackup(repo, data, { copy, locked: true }),
        ),
      true,
    );
  await inspectBackup(data);
  const pendingRestore = await repo.get("restoreIntent", "meta");
  assert(
    !["committing", "unknown"].includes(pendingRestore?.phase),
    "Reconcile the pending device restore before replacing this browser library.",
  );
  const recovery = await exportBackup(repo),
    lib = await repo.get("library", "meta");
  if (copy) {
    const map = new Map(data.records.map((r) => [r.id, id(r.type)]));
    for (const record of data.records)
      for (const branch of record.branches || [])
        map.set(branch.id, id("branch"));
    for (const record of data.records.filter((r) => r.kind === "creativeDraft"))
      map.set(
        record.id,
        await draftIdentity({
          novelId: map.get(record.novelId),
          ownerId: map.get(record.ownerId) || record.ownerId,
          kind: record.draftKind,
          branchId: map.get(record.branchId) || record.branchId,
          actorId: map.get(record.actorId) || record.actorId,
          actionMode: record.actionMode,
        }),
      );
    const profileMap = new Map(),
      incoming = data.configuration?.connectionLibrary;
    const settings = (await repo.get("connectionLibrary", "meta")) || {
      id: "connectionLibrary",
      profiles: [],
      defaults: { writerId: null, helperId: null },
    };
    if (incoming) {
      for (const profile of incoming.profiles || []) {
        const existing = settings.profiles.find((p) => p.id === profile.id);
        if (
          existing &&
          configurationIdentity(existing) === configurationIdentity(profile)
        ) {
          profileMap.set(profile.id, existing.id);
          continue;
        }
        const key = existing ? id("connection") : profile.id;
        profileMap.set(profile.id, key);
        settings.profiles.push({
          ...publicConnection(profile),
          id: key,
          hasSecret: false,
          relaySaved: false,
          lastTest: null,
          health: null,
          importedProfileId: profile.id,
          importedLastTest: profile.lastTest || null,
        });
      }
    }
    map.set(data.library.id, lib.libraryId);
    map.set(data.library.generation, lib.generation);
    const referenceKeys = new Set([
      "id",
      "novelId",
      "libraryId",
      "libraryGeneration",
      "generation",
      "chapterId",
      "sceneId",
      "ownerId",
      "baseSceneId",
      "baseRevisionId",
      "baseContextId",
      "currentRevisionId",
      "parentRevisionId",
      "playerCharacterId",
      "actorId",
      "subjectId",
      "holderId",
      "profileRevisionId",
      "parentProfileRevisionId",
      "explorationId",
      "parentSessionId",
      "entityId",
      "activeBranchId",
      "branchId",
      "parentId",
      "priorStateRef",
      "resultingStateRef",
      "supersedes",
      "supersededBy",
      "supersededReadingBatch",
      "readingBatchId",
      "sourceId",
      "candidateId",
      "acceptedRevisionId",
      "templateId",
      "transcriptHeadId",
      "transcriptHead",
      "acceptedEventId",
      "promotedBy",
      "artifactId",
      "orderedChapterIds",
      "orderedSceneIds",
      "sourceIds",
      "coveredTurnIds",
      "fullyReadTurnIds",
      "turnIds",
      "unreadTurnIds",
      "appliedIds",
      "resultRefs",
      "affectedIds",
      "operationId",
      "jobId",
      "adaptedCandidateId",
      "acceptedCandidateId",
      "continuationOf",
    ]);
    const remap = (value, key = "") =>
      ["writerConnectionId", "helperConnectionId", "connectionId"].includes(
        key,
      ) && typeof value === "string"
        ? profileMap.get(value) || value
        : key === "connection" && value && typeof value === "object"
          ? { ...value, id: profileMap.get(value.id) || value.id }
          : typeof value === "string"
            ? referenceKeys.has(key)
              ? map.get(value) || value
              : value
            : Array.isArray(value)
              ? value.map((v) => remap(v, key))
              : value && typeof value === "object"
                ? Object.fromEntries(
                    Object.entries(value).map(([k, v]) => [k, remap(v, k)]),
                  )
                : value;
    const records = data.records.map((r) => remap(r));
    for (const n of records.filter((r) => r.type === "novel")) {
      n.title += " (copy)";
      n.contentVersion = 0;
      if (incoming) {
        n.writerConnectionId =
          profileMap.get(n.writerConnectionId || incoming.defaults?.writerId) ||
          n.writerConnectionId ||
          null;
        n.helperConnectionId =
          profileMap.get(n.helperConnectionId || incoming.defaults?.helperId) ||
          n.helperConnectionId ||
          null;
      }
      const original = data.records.find((r) => map.get(r.id) === n.id);
      n.importProvenance = {
        libraryId: data.library.id,
        novelId: original.id,
        importedAt: now(),
        operations: (data.operations || []).filter(
          (op) => op.novelId === original.id,
        ),
      };
      const owned = records.filter((r) => r.novelId === n.id);
      const keys = new Set(owned.map((r) => r.textBlobId));
      await repo.commitLocked({
        novelId: n.id,
        kind: "novel.import",
        expectedVersion: 0,
        localMetadata: incoming
          ? [
              settings,
              ...settings.profiles.map((profile) => ({
                id: "connection." + profile.id,
                profile,
              })),
            ]
          : [],
        records: owned,
        blobs: data.blobs.filter((b) => keys.has(b.id)),
      });
    }
    return records.find((r) => r.type === "novel")?.id;
  }
  const generation = id("generation");
  const tx = repo.db.transaction(
      ["records", "blobs", "operations", "outbox", "meta", "recovery"],
      "readwrite",
    ),
    done = complete(tx);
  tx.objectStore("recovery").put({
    id: id("recovery"),
    createdAt: now(),
    backup: recovery,
  });
  for (const s of ["records", "blobs", "operations", "outbox"])
    tx.objectStore(s).clear();
  for (const r of data.records)
    tx.objectStore("records").put(
      (r.type === "job" || ["readingQueue", "readingTask"].includes(r.kind)) &&
        ["running", "queued"].includes(r.state)
        ? {
            ...r,
            state: "interrupted",
            error:
              "Library restored. Paid requests are never restarted automatically.",
          }
        : r,
    );
  for (const b of data.blobs) tx.objectStore("blobs").put(b);
  for (const op of data.operations || []) tx.objectStore("operations").put(op);
  tx.objectStore("meta").put({
    ...lib,
    libraryId: data.library.id,
    generation,
    minimumWriter: APP.writerProtocol,
    commitSequence: (lib.commitSequence || 0) + 1,
    activeProjectId: data.records.some(
      (r) => r.id === data.library.activeProjectId,
    )
      ? data.library.activeProjectId
      : null,
  });
  tx.objectStore("meta").put({
    id: "sync",
    serverRevision: 0,
    queuedRevision: 0,
    needsRestore: true,
    reconciledProtocol: 0,
  });
  if (data.configuration) {
    for (const key of ["appearance", "stylePresets", "connectionLibrary"])
      if (data.configuration[key])
        tx.objectStore("meta").put({ ...data.configuration[key], id: key });
    for (const profile of data.configuration.connectionLibrary?.profiles || [])
      tx.objectStore("meta").put({
        id: "connection." + profile.id,
        profile: { ...profile, hasSecret: false, relaySaved: false },
      });
  }
  await done;
  repo.generation = generation;
  repo.emit({ kind: "library.restore", generation });
  repo.channel?.postMessage({ kind: "library.restore", generation });
  return generation;
}
export function download(name, text, type = "application/json") {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
