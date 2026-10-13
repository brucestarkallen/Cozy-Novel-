import { APP } from "../config.js";
import { request, complete } from "./database.js";
import { exportBackup, restoreBackup, inspectBackup } from "./backup.js";
import { assert } from "../core/schema.js";
import { id, textBlob } from "../core/ids.js";
import { recordManifest } from "../core/digest.js";
export class DeviceSync {
  constructor(repo, onStatus = () => {}) {
    this.repo = repo;
    this.onStatus = onStatus;
    this.token = null;
    this.busy = false;
    this.disposed = false;
    this.requested = false;
    this.attempts = 0;
    this.state = "Browser only";
    this.stop = repo.subscribe(() => {
      this.status("Device save pending");
      this.requested = true;
      this.schedule(250);
    });
    this.online = () => this.connect().then(() => this.flush());
    globalThis.addEventListener?.("online", this.online);
  }
  status(s) {
    if (this.disposed) return;
    this.state = s;
    this.onStatus(s);
  }
  schedule(delay) {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }
  async api(path, { method = "GET", body, signal } = {}) {
    const r = await fetch(new URL("api/novel/" + path, document.baseURI), {
      method,
      signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(this.token ? { "X-CozyNovel-Session": this.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw Object.assign(new Error(d.error || "Device service unavailable"), {
        status: r.status,
        code: d.code,
        parameter: d.parameter,
      });
    }
    return r.json();
  }
  async connect() {
    try {
      const s = await this.api("status");
      assert(
        s.service === "cozyNovel" && s.protocol === 1 && s.syncVersion === 3,
        "Update the local Cozy Novel service before device synchronization.",
      );
      this.token = s.sessionToken;
      this.server = s;
      this.attempts = 0;
      if (!this.disposed) await this.recoverRestore();
      const intent = await this.repo.get("restoreIntent", "meta");
      if (!["committing", "unknown"].includes(intent?.phase))
        this.status(s.libraryId ? "Device connected" : "Device ready");
      return s;
    } catch (e) {
      this.status("Device unavailable. Browser copy retained. " + e.message);
      return null;
    }
  }
  async flush() {
    this.requested = true;
    if (this.busy || !this.token || this.disposed) return;
    this.busy = true;
    clearTimeout(this.timer);
    try {
      await this.repo.withSync(async () => {
        while (!this.disposed) {
          this.requested = false;
          const lib = await this.repo.get("library", "meta"),
            sync = await this.repo.get("sync", "meta"),
            intent = await this.repo.get("restoreIntent", "meta");
          if (["committing", "unknown"].includes(intent?.phase)) {
            this.status(
              "Restore outcome needs reconciliation. Browser copy retained.",
            );
            return;
          }
          if (sync?.needsRestore) {
            this.status("Restored locally. Preview device restore in Backups.");
            return;
          }
          const server = await this.api("status");
          if (this.disposed) return;
          if (
            server.libraryId &&
            (server.libraryId !== lib.libraryId ||
              server.generation !== lib.generation)
          ) {
            this.status(
              "Device conflict. Both libraries retained. Open Backups.",
            );
            return;
          }
          const pending = (await this.repo.all("outbox"))
            .filter((o) => o.libraryGeneration === lib.generation)
            .sort(
              (a, b) => a.expectedServerRevision - b.expectedServerRevision,
            );
          if (!pending.length) {
            if (
              sync?.reconciledProtocol !== APP.writerProtocol ||
              sync?.serverRevision !== server.serverRevision
            ) {
              const equal = await this.reconcile(lib, server);
              if (!equal) return;
            }
            const drained = await this.repo.withMutation(async () => {
              const current = await this.repo.get("library", "meta"),
                latest = await this.repo.all("outbox");
              if (
                current.generation !== lib.generation ||
                latest.some((o) => o.libraryGeneration === lib.generation)
              )
                return false;
              this.status(
                "Saved to device through checkpoint " +
                  (server.serverRevision || 0),
              );
              this.attempts = 0;
              return true;
            });
            if (!drained) continue;
            return;
          }
          const item = pending[0];
          this.status("Saving to device");
          const ack = await this.api(
            "projects/" + encodeURIComponent(item.novelId) + "/operations",
            {
              method: "POST",
              body: { ...item, clientProtocol: APP.writerProtocol },
            },
          );
          if (this.disposed) return;
          await this.repo.withMutation(async () => {
            const tx = this.repo.db.transaction(
                ["outbox", "meta"],
                "readwrite",
              ),
              done = complete(tx);
            done.catch(() => {});
            try {
              const current = await request(
                tx.objectStore("meta").get("library"),
              );
              assert(
                current.libraryId === item.libraryId &&
                  current.generation === item.libraryGeneration,
                "The upload belongs to an earlier library.",
              );
              assert(
                ack.operationId === item.id &&
                  ack.libraryId === item.libraryId &&
                  ack.libraryGeneration === item.libraryGeneration &&
                  ack.expectedServerRevision === item.expectedServerRevision &&
                  ack.serverRevision === item.expectedServerRevision + 1,
                "Device acknowledgement does not match this operation.",
              );
              const queued = await request(
                tx.objectStore("outbox").get(item.id),
              );
              if (queued) {
                assert(
                  queued.id === item.id &&
                    queued.libraryId === item.libraryId &&
                    queued.libraryGeneration === item.libraryGeneration &&
                    queued.expectedServerRevision ===
                      item.expectedServerRevision,
                  "Pending operation ownership changed. Nothing was retired.",
                );
                tx.objectStore("outbox").delete(item.id);
              }
              const state = await request(tx.objectStore("meta").get("sync"));
              tx.objectStore("meta").put({
                ...state,
                id: "sync",
                serverRevision: Math.max(
                  state?.serverRevision || 0,
                  ack.serverRevision,
                ),
              });
              await done;
            } catch (e) {
              try {
                tx.abort();
              } catch {}
              await done.catch(() => {});
              throw e;
            }
          });
        }
      }, true);
    } catch (e) {
      this.requested = false;
      if (e.status === 409) {
        this.status("Device conflict. Both versions retained. " + e.message);
      } else {
        this.status("Device unavailable. Browser copy retained. " + e.message);
        if (this.attempts++ < 3)
          this.schedule([1000, 3000, 10000][this.attempts - 1]);
      }
    } finally {
      this.busy = false;
      if (this.requested && !this.disposed && !this.timer) this.schedule(250);
    }
  }
  async reconcile(lib, server) {
    const records = await this.repo.all("records"),
      sequence = lib.commitSequence || 0,
      local = await recordManifest(records);
    let cursor = 0,
      remote = [];
    do {
      const p = await this.api("manifest?cursor=" + cursor);
      if (p.serverRevision !== server.serverRevision)
        throw new Error(
          "Device changed during comparison. Retry after reconnecting.",
        );
      remote.push(...p.records);
      cursor = p.nextCursor;
    } while (cursor != null);
    const equal = JSON.stringify(local) === JSON.stringify(remote);
    if (!equal) {
      this.status(
        "Device content differs from browser. Both copies retained. Open Backups to compare and repair.",
      );
      return false;
    }
    return this.repo.withMutation(async () => {
      const current = await this.repo.get("library", "meta");
      if (
        current.generation !== lib.generation ||
        current.commitSequence !== sequence
      )
        return false;
      const tx = this.repo.db.transaction("meta", "readwrite"),
        done = complete(tx);
      tx.objectStore("meta").put({
        id: "sync",
        serverRevision: server.serverRevision,
        queuedRevision: server.serverRevision,
        reconciledProtocol: APP.writerProtocol,
      });
      await done;
      return true;
    });
  }
  async deviceSnapshot() {
    let cursor = 0,
      records = [],
      blobs = [],
      library,
      revision = null;
    do {
      const p = await this.api("snapshot?cursor=" + cursor);
      if (revision != null && revision !== p.serverRevision)
        throw new Error("Device changed during download. Retry the snapshot.");
      revision = p.serverRevision;
      library = p.library;
      records.push(...p.records);
      blobs.push(...p.blobs);
      cursor = p.nextCursor;
    } while (cursor != null);
    const data = {
      format: "cozyNovel.backup",
      schemaVersion: 1,
      library,
      records,
      blobs: [...new Map(blobs.map((b) => [b.id, b])).values()],
    };
    await inspectBackup(data);
    return data;
  }
  async restoreDevice() {
    assert(!this.disposed, "Device synchronization is closed.");
    const { intent, snapshotJson, snapshotDigest } =
      await this.repo.withMutation(async () => {
        const journal = await this.repo.get("restoreIntent", "meta");
        assert(
          !["committing", "unknown"].includes(journal?.phase),
          "Resolve the earlier device restore before preparing another. Both copies are retained.",
        );
        const data = await exportBackup(this.repo),
          snapshotJson = JSON.stringify(data),
          snapshotDigest = (await textBlob(snapshotJson)).id;
        const intent = {
          id: "restoreIntent",
          restoreOperationId: id("restore"),
          snapshotDigest,
          ...data.coverage,
          phase: "prepared",
        };
        await this.repo._localPut(intent);
        return { intent, snapshotJson, snapshotDigest };
      });
    const preview = await this.api("restore/preview", {
      method: "POST",
      body: {
        restoreOperationId: intent.restoreOperationId,
        snapshotDigest,
        snapshotJson,
        clientProtocol: APP.writerProtocol,
      },
    });
    return { preview, commit: () => this.commitRestore(intent, preview) };
  }
  async commitRestore(intent, preview) {
    return this.repo.withSync(
      () =>
        this.repo.withMutation(async () => {
          const lib = await this.repo.get("library", "meta");
          const journal = await this.repo.get("restoreIntent", "meta");
          assert(
            journal?.restoreOperationId === intent.restoreOperationId &&
              journal.phase === "prepared",
            "This preview was replaced or already submitted. Prepare a fresh preview.",
          );
          assert(
            lib.libraryId === intent.libraryId &&
              lib.generation === intent.generation &&
              (lib.commitSequence || 0) === intent.localCommitSequence,
            "The browser changed after this preview. New edits are retained. Prepare a fresh preview.",
          );
          const state = {
            ...intent,
            expectedServerRevision: preview.serverRevision,
            phase: "committing",
          };
          await this.repo._localPut(state);
          try {
            const ack = await this.api("restore/commit", {
              method: "POST",
              signal: AbortSignal.timeout(15000),
              body: {
                restoreOperationId: intent.restoreOperationId,
                snapshotDigest: intent.snapshotDigest,
                expectedServerRevision: preview.serverRevision,
                clientProtocol: APP.writerProtocol,
              },
            });
            await this.finishRestore(state, ack);
            this.status("Restored snapshot acknowledged by device");
            return ack;
          } catch (e) {
            await this.repo._localPut({
              ...state,
              phase:
                e.status === 409 || e.status === 400 ? "rejected" : "unknown",
              error: e.message,
            });
            this.status(
              e.status
                ? "Restore rejected. Browser copy retained."
                : "Restore outcome needs reconciliation. Browser copy retained.",
            );
            throw e;
          }
        }),
      true,
    );
  }
  async finishRestore(intent, ack) {
    assert(
      ack.restoreOperationId === intent.restoreOperationId &&
        ack.snapshotDigest === intent.snapshotDigest &&
        ack.libraryId === intent.libraryId &&
        ack.libraryGeneration === intent.generation &&
        ack.serverRevision === intent.expectedServerRevision + 1,
      "Restore acknowledgement does not match its snapshot.",
    );
    const tx = this.repo.db.transaction(["meta", "outbox"], "readwrite"),
      done = complete(tx);
    done.catch(() => {});
    try {
      const lib = await request(tx.objectStore("meta").get("library"));
      assert(
        lib.libraryId === intent.libraryId &&
          lib.generation === intent.generation &&
          (lib.commitSequence || 0) === intent.localCommitSequence,
        "Newer browser work exists. Restore needs reconciliation.",
      );
      const outbox = await request(tx.objectStore("outbox").getAll());
      assert(
        outbox.every((o) => intent.operationIds.includes(o.id)),
        "Uncovered pending work retained. Restore needs reconciliation.",
      );
      for (const op of outbox)
        if (
          intent.operationIds.includes(op.id) &&
          op.libraryGeneration === intent.generation
        )
          tx.objectStore("outbox").delete(op.id);
      tx.objectStore("meta").put({
        id: "sync",
        serverRevision: ack.serverRevision,
        queuedRevision: ack.serverRevision,
        needsRestore: false,
        reconciledProtocol: APP.writerProtocol,
      });
      tx.objectStore("meta").put({ ...intent, phase: "acknowledged", ack });
      await done;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw e;
    }
  }
  async recoverRestore() {
    const intent = await this.repo.get("restoreIntent", "meta");
    if (!["committing", "unknown"].includes(intent?.phase)) return;
    await this.repo.withSync(
      () =>
        this.repo.withMutation(async () => {
          const outcome = await this.api(
            "restore/operations/" +
              encodeURIComponent(intent.restoreOperationId),
          );
          if (outcome.phase === "committed")
            await this.finishRestore(intent, outcome.ack);
          else if (["prepared", "expired", "rejected"].includes(outcome.phase))
            await this.repo._localPut({
              ...intent,
              phase: "rejected",
              error:
                "Device replacement did not commit. Prepare a fresh preview.",
            });
          else
            this.status(
              "Restore outcome needs reconciliation. No pending saves were removed.",
            );
        }),
      true,
    );
  }
  async recoverDevice(asCopy = true) {
    return restoreBackup(this.repo, await this.deviceSnapshot(), {
      copy: asCopy,
    });
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.stop();
    globalThis.removeEventListener?.("online", this.online);
  }
}
