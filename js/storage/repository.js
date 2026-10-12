import { indexText } from "../context/index.js";
import { openDatabase, request, complete } from "./database.js";
import { id, now, textBlob } from "../core/ids.js";
import { validateRecord, assert } from "../core/schema.js";
import { APP, DEFAULT_STYLE } from "../config.js";
export class Repository {
  constructor(db) {
    this.db = db;
    this.listeners = new Set();
    this.channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(
            APP.channel + (db.name === APP.database ? "" : "." + db.name),
          )
        : null;
    this.channel?.addEventListener("message", (e) => this.emit(e.data));
  }
  static async open(name) {
    const repo = new Repository(await openDatabase(name));
    const tx = repo.db.transaction("meta", "readwrite"),
      done = complete(tx);
    if (!(await request(tx.objectStore("meta").get("library"))))
      tx.objectStore("meta").put({
        id: "library",
        schemaVersion: APP.schema,
        libraryId: id("library"),
        generation: id("generation"),
        createdAt: now(),
        activeProjectId: null,
      });
    await done;
    return repo;
  }
  async get(key, store = "records") {
    return request(this.db.transaction(store).objectStore(store).get(key));
  }
  async all(store = "records") {
    return request(this.db.transaction(store).objectStore(store).getAll());
  }
  async query(index, key) {
    return request(
      this.db
        .transaction("records")
        .objectStore("records")
        .index(index)
        .getAll(key),
    );
  }
  async text(blobId) {
    return (await this.get(blobId, "blobs"))?.text ?? "";
  }
  async sceneText(sceneId) {
    const s = await this.get(sceneId);
    const r = await this.get(s.currentRevisionId);
    return { scene: s, revision: r, text: await this.text(r.textBlobId) };
  }
  async localPut(value, store = "meta") {
    const tx = this.db.transaction(store, "readwrite");
    const done = complete(tx);
    tx.objectStore(store).put(value);
    await done;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(change) {
    for (const fn of this.listeners) fn(change);
  }
  dispose() {
    this.channel?.close();
    this.listeners.clear();
    this.db.close();
  }
  /** Hashes and network work must finish before entering this transaction. */
  async commit({
    novelId,
    kind,
    records = [],
    blobs = [],
    expectedVersion,
    expectedScene,
    operationId = id("op"),
    generation,
  }) {
    records.forEach(validateRecord);
    assert(
      new Set(records.map((r) => r.id)).size === records.length,
      "Duplicate operation records rejected before saving.",
    );
    assert(
      new Set(blobs.map((b) => b.id)).size === blobs.length,
      "Duplicate text bodies in one operation.",
    );
    const tx = this.db.transaction(
      ["meta", "records", "blobs", "operations", "outbox"],
      "readwrite",
    );
    const done = complete(tx);
    done.catch(() => {});
    try {
      const meta = tx.objectStore("meta"),
        rs = tx.objectStore("records");
      const library = await request(meta.get("library"));
      assert(
        !generation || generation === library.generation,
        "This work belongs to an earlier library generation.",
      );
      const existing = await request(
        tx.objectStore("operations").get(operationId),
      );
      if (existing) {
        await done;
        return existing;
      }
      const novel = await request(rs.get(novelId));
      if (expectedVersion != null)
        assert(
          (novel?.contentVersion ?? 0) === expectedVersion,
          "The novel changed in another operation. Your draft is still visible.",
        );
      if (expectedScene) {
        const s = await request(rs.get(expectedScene.id));
        assert(
          s?.currentRevisionId === expectedScene.revisionId,
          "The manuscript changed. Compare the versions before choosing a new placement.",
        );
      }
      for (const r of records)
        assert(r.novelId === novelId, "Cross novel write rejected.");
      const newNovel = records.find((r) => r.type === "novel") || novel;
      assert(
        newNovel && newNovel.libraryId === library.libraryId,
        "Wrong library ownership.",
      );
      const version = (novel?.contentVersion || 0) + 1;
      const changed = records
        .filter((r) => r.type !== "novel")
        .concat({ ...newNovel, contentVersion: version, updatedAt: now() });
      const staged = new Map(changed.map((r) => [r.id, r])),
        stagedBlobs = new Map(blobs.map((b) => [b.id, b]));
      const getRecord = async (key, type) => {
        const value = staged.get(key) || (await request(rs.get(key)));
        assert(
          value && value.novelId === novelId && (!type || value.type === type),
          "Missing or foreign record reference.",
        );
        return value;
      };
      for (const r of changed) {
        const old = await request(rs.get(r.id));
        assert(
          !old || (old.novelId === novelId && old.type === r.type),
          "Record identity collision.",
        );
        assert(
          !old ||
            r.type !== "revision" ||
            JSON.stringify(old) === JSON.stringify(r),
          "Revision metadata is immutable.",
        );
        if (r.textBlobId)
          assert(
            stagedBlobs.has(r.textBlobId) ||
              (await request(tx.objectStore("blobs").get(r.textBlobId))),
            "Missing text body.",
          );
        if (r.type === "novel")
          for (const key of r.orderedChapterIds)
            await getRecord(key, "chapter");
        if (r.type === "chapter")
          for (const key of r.orderedSceneIds)
            assert(
              (await getRecord(key, "scene")).chapterId === r.id,
              "Wrong chapter ownership.",
            );
        if (r.type === "scene") {
          await getRecord(r.chapterId, "chapter");
          assert(
            (await getRecord(r.currentRevisionId, "revision")).ownerId === r.id,
            "Wrong revision ownership.",
          );
        }
        if (r.type === "revision") {
          await getRecord(r.ownerId, "scene");
          if (r.parentRevisionId)
            assert(
              (await getRecord(r.parentRevisionId, "revision")).ownerId ===
                r.ownerId,
              "Wrong revision ancestry.",
            );
        }
        for (const [field, type] of [
          ["baseRevisionId", "revision"],
          ["sceneId", "scene"],
          ["baseSceneId", "scene"],
          ["parentSessionId", "exploration"],
          ["explorationId", "exploration"],
          ["subjectId", "entity"],
          ["holderId", "entity"],
          ["actorId", "entity"],
          ["playerCharacterId", "entity"],
        ])
          if (r[field]) await getRecord(r[field], type);
        for (const source of r.sourceRefs || []) await getRecord(source.id);
        if (r.type === "candidate") {
          const base = await getRecord(r.baseRevisionId, "revision"),
            body =
              stagedBlobs.get(base.textBlobId) ||
              (await request(tx.objectStore("blobs").get(base.textBlobId)));
          assert(
            base.ownerId === r.sceneId &&
              r.insertionRange.length === 2 &&
              r.insertionRange.every(Number.isInteger) &&
              r.insertionRange[0] >= 0 &&
              r.insertionRange[1] >= r.insertionRange[0] &&
              r.insertionRange[1] <= body.text.length &&
              body.text.slice(...r.insertionRange) === r.originalSelection,
            "Candidate selection does not match its source.",
          );
        }
      }
      for (const r of changed) rs.put(r);
      for (const b of blobs) tx.objectStore("blobs").put(b);
      const sync = (await request(meta.get("sync"))) || {
        id: "sync",
        serverRevision: 0,
        queuedRevision: 0,
      };
      const op = {
        id: operationId,
        libraryId: library.libraryId,
        libraryGeneration: library.generation,
        novelId,
        kind,
        expectedVersion: novel?.contentVersion || 0,
        affectedIds: changed.map((r) => r.id),
        createdAt: now(),
        status: "committed",
      };
      const payload = {
        ...op,
        expectedServerRevision: sync.queuedRevision,
        records: changed,
        blobs,
        tombstones: [],
      };
      tx.objectStore("operations").put(op);
      tx.objectStore("outbox").put({ ...payload, acknowledgement: null });
      meta.put({ ...sync, queuedRevision: sync.queuedRevision + 1 });
      await done;
      this.emit(op);
      this.channel?.postMessage(op);
      return op;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  async createNovel(title = "Untitled novel", text = "") {
    const library = await this.get("library", "meta"),
      n = id("novel"),
      c = id("chapter"),
      s = id("scene"),
      r = id("revision"),
      blob = await textBlob(text);
    await this.commit({
      novelId: n,
      kind: "create",
      expectedVersion: 0,
      records: [
        {
          id: n,
          type: "novel",
          novelId: n,
          libraryId: library.libraryId,
          title,
          premise: "",
          styleProfile: { ...DEFAULT_STYLE },
          orderedChapterIds: [c],
          contentVersion: 0,
          archivedAt: null,
          createdAt: now(),
          autoSuggestions: true,
        },
        {
          id: c,
          type: "chapter",
          novelId: n,
          title: "Chapter one",
          orderedSceneIds: [s],
          notes: "",
          status: "draft",
        },
        {
          id: s,
          type: "scene",
          novelId: n,
          chapterId: c,
          title: "A new beginning",
          searchIndex: indexText(text),
          currentRevisionId: r,
          viewpoint: "",
          fictionalTime: null,
          timeLabel: "",
          notes: "",
          summary: "",
          status: "draft",
        },
        {
          id: r,
          type: "revision",
          novelId: n,
          ownerId: s,
          parentRevisionId: null,
          textBlobId: blob.id,
          sourceKind: "author",
          createdAt: now(),
        },
      ],
      blobs: [blob],
    });
    await this.localPut({ ...library, activeProjectId: n }, "meta");
    return n;
  }
  async update(record, kind = "metadata") {
    const n = await this.get(record.novelId);
    return this.commit({
      novelId: n.id,
      expectedVersion: n.contentVersion,
      kind,
      records: [record],
    });
  }
}
