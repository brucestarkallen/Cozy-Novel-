import { request, complete } from "./database.js";
import { exportBackup, restoreBackup, inspectBackup } from "./backup.js";
import { assert } from "../core/schema.js";
export class DeviceSync {
  constructor(repo, onStatus = () => {}) {
    this.repo = repo;
    this.onStatus = onStatus;
    this.token = null;
    this.busy = false;
    this.state = "Browser only";
    this.timer = null;
    this.stop = repo.subscribe(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(
        () => this.flush().catch((e) => this.status(e.message)),
        1000,
      );
    });
  }
  status(s) {
    this.state = s;
    this.onStatus(s);
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
      const e = new Error(d.error || "Device service unavailable");
      e.status = r.status;
      throw e;
    }
    return r.json();
  }
  async connect() {
    try {
      const s = await this.api("status");
      assert(
        s.service === "cozyNovel" && s.protocol === 1,
        "This is not a compatible Cozy Novel device service.",
      );
      this.token = s.sessionToken;
      this.server = s;
      this.status(s.libraryId ? "Device connected" : "Device ready");
      return s;
    } catch (e) {
      this.status("Browser only. Local device service unavailable.");
      return null;
    }
  }
  async flush() {
    if (this.busy || !this.token) return;
    this.busy = true;
    try {
      const lib = await this.repo.get("library", "meta"),
        sync = await this.repo.get("sync", "meta");
      const server = await this.api("status");
      if (sync?.needsRestore) {
        this.status("Restored locally. Preview device restore in Backups.");
        return;
      }
      if (
        server.libraryId &&
        (server.libraryId !== lib.libraryId ||
          server.generation !== lib.generation)
      ) {
        this.status(
          "Device has a different library. Open Backups to recover or compare.",
        );
        return;
      }
      const pending = await this.repo.all("outbox");
      pending.sort(
        (a, b) => a.expectedServerRevision - b.expectedServerRevision,
      );
      for (const item of pending) {
        if (item.libraryGeneration !== lib.generation) continue;
        this.status("Saving to device");
        const ack = await this.api(
          "projects/" + encodeURIComponent(item.novelId) + "/operations",
          { method: "POST", body: item },
        );
        const tx = this.repo.db.transaction(["outbox", "meta"], "readwrite"),
          done = complete(tx);
        const current = await request(tx.objectStore("meta").get("library"));
        if (current.generation !== item.libraryGeneration) {
          tx.abort();
          await done.catch(() => {});
          return;
        }
        tx.objectStore("outbox").delete(item.id);
        const state = await request(tx.objectStore("meta").get("sync"));
        tx.objectStore("meta").put({
          ...state,
          serverRevision: Math.max(
            state.serverRevision || 0,
            ack.serverRevision,
          ),
        });
        await done;
      }
      this.status(
        pending.length ? "Saved to browser and device" : "Device up to date",
      );
    } catch (e) {
      this.status(
        e.status === 409
          ? "Device conflict. Both versions are retained. Open Backups."
          : `Browser saved. ${e.message}`,
      );
    } finally {
      this.busy = false;
    }
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
    const data = await exportBackup(this.repo);
    const preview = await this.api("restore/preview", {
      method: "POST",
      body: { backup: data },
    });
    return {
      preview,
      commit: async () => {
        const ack = await this.api("restore/commit", {
          method: "POST",
          body: {
            previewId: preview.previewId,
            expectedServerRevision: preview.serverRevision,
          },
        });
        const tx = this.repo.db.transaction(["meta", "outbox"], "readwrite"),
          done = complete(tx);
        tx.objectStore("outbox").clear();
        tx.objectStore("meta").put({
          id: "sync",
          serverRevision: ack.serverRevision,
          queuedRevision: ack.serverRevision,
          needsRestore: false,
        });
        await done;
        this.status("Restored library saved to device");
      },
    };
  }
  async recoverDevice(asCopy = true) {
    const data = await this.deviceSnapshot();
    if (asCopy) return restoreBackup(this.repo, data, { copy: true });
    await restoreBackup(
      this.repo,
      data,
    ); /* generation changes deliberately; explicit device preview follows */
  }
  dispose() {
    clearTimeout(this.timer);
    this.stop();
  }
}
