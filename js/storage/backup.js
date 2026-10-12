import { id, now, textBlob } from "../core/ids.js";
import { validateBackup, assert } from "../core/schema.js";
import { complete, request } from "./database.js";
import { APP } from "../config.js";
export async function exportBackup(repo, novelId = null) {
  const tx = repo.db.transaction(["records", "blobs", "meta", "operations"]);
  const [records, blobs, lib, operations] = await Promise.all([
    request(tx.objectStore("records").getAll()),
    request(tx.objectStore("blobs").getAll()),
    request(tx.objectStore("meta").get("library")),
    request(tx.objectStore("operations").getAll()),
  ]);
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
export async function restoreBackup(repo, data, { copy = false } = {}) {
  await inspectBackup(data);
  const recovery = await exportBackup(repo),
    lib = await repo.get("library", "meta");
  if (copy) {
    const map = new Map(data.records.map((r) => [r.id, id(r.type)]));
    for (const record of data.records)
      for (const branch of record.branches || [])
        map.set(branch.id, id("branch"));
    map.set(data.library.id, lib.libraryId);
    const remap = (v) =>
      typeof v === "string"
        ? map.get(v) || v
        : Array.isArray(v)
          ? v.map(remap)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, remap(x)]),
              )
            : v;
    const records = data.records.map(remap);
    for (const n of records.filter((r) => r.type === "novel")) {
      n.title += " (copy)";
      n.contentVersion = 0;
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
      await repo.commit({
        novelId: n.id,
        kind: "novel.import",
        expectedVersion: 0,
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
      r.type === "job" && ["running", "queued"].includes(r.state)
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
  });
  await done;
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
