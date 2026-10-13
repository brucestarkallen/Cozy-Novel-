import { providerIdentity } from "../context/assemble.js";
import { coordinated, material } from "./coordination.js";
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
        minimumWriter: APP.writerProtocol,
        commitSequence: 0,
      });
    await done;
    repo.generation = (await repo.get("library", "meta")).generation;
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
    const body = await this.get(blobId, "blobs");
    assert(
      body && typeof body.text === "string",
      "The stored text body is missing. Your visible draft is retained; recover from a backup rather than saving an empty replacement.",
    );
    return body.text;
  }
  async sceneText(sceneId) {
    const s = await this.get(sceneId);
    const r = await this.get(s.currentRevisionId);
    return { scene: s, revision: r, text: await this.text(r.textBlobId) };
  }
  withMutation(fn) {
    return coordinated(this.db.name, "mutation", fn);
  }
  withSync(fn, required = false) {
    return coordinated(this.db.name, "sync", fn, { required });
  }
  async captureNovel(novelId) {
    const tx = this.db.transaction(["records", "blobs", "meta"]),
      done = complete(tx),
      rs = tx.objectStore("records");
    const [records, library, epoch] = await Promise.all([
      request(rs.index("novelId").getAll(novelId)),
      request(tx.objectStore("meta").get("library")),
      request(tx.objectStore("meta").get("context." + novelId)),
    ]);
    await done;
    const map = new Map(records.map((r) => [r.id, r])),
      bodies = new Map();
    const readText = async (key) => {
      if (!bodies.has(key)) {
        const body = await this.get(key, "blobs");
        assert(
          body,
          "The captured source body is unavailable. The library may have changed; no incomplete context was sent.",
        );
        bodies.set(key, body.text);
      }
      return bodies.get(key);
    };
    return {
      records,
      library,
      contextEpoch: epoch?.epoch || 0,
      get: async (key, store) =>
        store === "meta" ? (key === "library" ? library : epoch) : map.get(key),
      query: async () => records,
      text: readText,
      sceneText: async (key) => {
        const scene = map.get(key),
          revision = map.get(scene.currentRevisionId);
        return { scene, revision, text: await readText(revision.textBlobId) };
      },
    };
  }
  async localPut(value, store = "meta") {
    return this.withMutation(() => this._localPut(value, store));
  }
  async _localPut(value, store = "meta") {
    const tx = this.db.transaction(store, "readwrite");
    const done = complete(tx);
    if (store === "meta" && value.id === "library") {
      const current = await request(tx.objectStore(store).get("library"));
      value = { ...current, activeProjectId: value.activeProjectId };
    }
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
  async commit(options) {
    return this.withMutation(() => this.commitLocked(options));
  }
  async commitLocked({
    novelId,
    kind,
    records = [],
    blobs = [],
    expectedVersion,
    expectedScene,
    expectedRecord,
    operationId = id("op"),
    generation,
    contextPrecondition,
    localMetadata = [],
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
        !this.generation || this.generation === library.generation,
        "This tab belongs to an earlier library generation. Its visible draft is retained; refresh before committing to the restored library.",
      );
      assert(
        !generation || generation === library.generation,
        "This work belongs to an earlier library generation.",
      );
      assert(
        (library.minimumWriter || 1) <= APP.writerProtocol,
        "A newer Cozy Novel version owns this library. Your visible draft is retained.",
      );
      const epoch = (await request(meta.get("context." + novelId))) || {
        id: "context." + novelId,
        epoch: 0,
      };
      if (contextPrecondition) {
        assert(
          contextPrecondition.generation === library.generation &&
            contextPrecondition.epoch === epoch.epoch,
          "Story context changed before application. The result is preserved for comparison.",
        );
        if (contextPrecondition.provider) {
          const connection = await request(
            meta.get(contextPrecondition.provider.id),
          );
          assert(
            JSON.stringify(providerIdentity(connection?.profile || {})) ===
              contextPrecondition.provider.signature,
            "Provider configuration changed before application. The result is retained.",
          );
        }
        if (contextPrecondition.mapping) {
          const c = await request(
              rs.get(contextPrecondition.mapping.candidateId),
            ),
            scene = await request(rs.get(c?.sceneId));
          assert(
            c?.acceptedRevisionId ===
              contextPrecondition.mapping.sourceRevisionId &&
              scene?.currentRevisionId ===
                contextPrecondition.mapping.targetRevisionId &&
              c.textBlobId === contextPrecondition.mapping.textBlobId,
            "The accepted passage changed before its reading could transfer.",
          );
        }
      }
      const restoreIntent = await request(meta.get("restoreIntent"));
      assert(
        !["committing", "unknown"].includes(restoreIntent?.phase),
        "Device restore outcome needs reconciliation. Your visible draft is retained until it is known.",
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
      if (expectedRecord) {
        const current = await request(rs.get(expectedRecord.id));
        assert(
          (current?.recordVersion || 0) === expectedRecord.version,
          "This record changed in another operation. Reopen it before applying your change.",
        );
      }
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
      if (kind === "candidate.progress")
        for (const candidate of records.filter((r) => r.type === "candidate")) {
          const scene = await request(rs.get(candidate.sceneId));
          if (scene?.currentRevisionId !== candidate.baseRevisionId)
            candidate.status = "stale";
        }
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
          const seen = new Set([r.id]);
          let prior = r.continuationOf;
          while (prior) {
            assert(
              !seen.has(prior),
              "A fictional continuation cannot contain a cycle.",
            );
            seen.add(prior);
            prior = (await getRecord(prior, "scene")).continuationOf;
          }
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
          ["baseContextId", "artifact"],
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
      let semantic = false;
      for (const r of changed) {
        const previous = await request(rs.get(r.id));
        if (material(r, previous)) semantic = true;
        if (!["revision", "turn"].includes(r.type))
          r.recordVersion = (previous?.recordVersion || 0) + 1;
        rs.put(r);
      }
      if (semantic) meta.put({ ...epoch, epoch: epoch.epoch + 1 });
      meta.put({
        ...library,
        commitSequence: (library.commitSequence || 0) + 1,
      });
      for (const b of blobs) {
        const existingBody = await request(tx.objectStore("blobs").get(b.id));
        assert(
          !existingBody || existingBody.text === b.text,
          "Text bodies are immutable.",
        );
        tx.objectStore("blobs").put(b);
      }
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
        localCommitSequence: (library.commitSequence || 0) + 1,
        clientProtocol: APP.writerProtocol,
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
      for (const value of localMetadata) {
        assert(
          value.id === "connectionLibrary" ||
            value.id.startsWith("connection."),
          "Unsupported imported configuration metadata.",
        );
        meta.put(value);
      }
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
          storyMode: "auto",
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
    return this.withMutation(async () => {
      const n = await this.get(record.novelId),
        current = await this.get(record.id);
      return this.commitLocked({
        novelId: n.id,
        expectedVersion: n.contentVersion,
        expectedRecord: current
          ? { id: record.id, version: record.recordVersion || 0 }
          : undefined,
        kind,
        records: [record],
      });
    });
  }
}
