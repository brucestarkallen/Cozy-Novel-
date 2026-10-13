import { request, complete } from "../storage/database.js";
import { configurationIdentity } from "./presets.js";
import { validateConnection } from "../ai/providers/adapters.js";
import { id } from "../core/ids.js";
import { DEFAULT_CONNECTION } from "../config.js";
import { rememberDirect, forgetDirect, directHasKey } from "./transport.js";
const privateKeys = new Set(["secret", "apiKey", "token", "secretFromId"]);
export function publicConnection(profile) {
  return Object.fromEntries(
    Object.entries(profile).filter(([k]) => !privateKeys.has(k)),
  );
}
export class ConnectionLibrary {
  constructor(app) {
    this.app = app;
    this.profiles = [];
    this.defaults = { writerId: null, helperId: null };
    this.novels = new Map();
    this.pendingKeys = new Map();
  }
  async load(remote = []) {
    const saved = await this.app.repo.get("connectionLibrary", "meta");
    this.profiles = saved?.profiles || [];
    this.defaults = saved?.defaults || this.defaults;
    for (const slot of ["primary", "helper"]) {
      const legacy = await this.app.repo.get("connection." + slot, "meta");
      if (legacy?.profile && !this.profiles.some((p) => p.id === slot))
        this.profiles.push({
          ...legacy.profile,
          displayName:
            slot === "primary" ? "Writing connection" : "Helper connection",
          preset: "custom",
          transport: "relay",
        });
    }
    for (const c of remote) {
      const local = this.profiles.find((p) => p.id === c.id);
      if (
        local?.relaySaved === false &&
        configurationIdentity(local) !== configurationIdentity(c)
      ) {
        local.deviceProfile = c;
        continue;
      }
      this.profiles = this.profiles
        .filter((p) => p.id !== c.id)
        .concat({ ...c, relaySaved: true });
    }
    if (!saved) {
      this.defaults = {
        writerId:
          this.profiles.find((p) => p.id === "primary")?.id ||
          this.profiles[0]?.id ||
          null,
        helperId: this.profiles.find((p) => p.id === "helper")?.id || null,
      };
    }
    this.novels = new Map(
      (await this.app.repo.query("type", "novel")).map((n) => [n.id, n]),
    );
    await this.persist();
  }
  async persist({
    upserts = this.profiles,
    defaultsPatch = null,
    removeId = null,
  } = {}) {
    await this.app.repo.withMutation(async () => {
      const intent = await this.app.repo.get("restoreIntent", "meta");
      if (["committing", "unknown"].includes(intent?.phase))
        throw new Error(
          "Reconcile the device restore before saving assignments. Your form remains here.",
        );
      const tx = this.app.repo.db.transaction("meta", "readwrite"),
        done = complete(tx),
        meta = tx.objectStore("meta");
      const latest = await request(meta.get("connectionLibrary"));
      const profiles = new Map((latest?.profiles || []).map((p) => [p.id, p]));
      for (const p of upserts) {
        const prior = profiles.get(p.id);
        if (!prior || (p.profileVersion || 0) >= (prior.profileVersion || 0))
          profiles.set(p.id, publicConnection(p));
      }
      if (removeId) {
        profiles.delete(removeId);
        meta.put({ id: "connection." + removeId, profile: null });
      }
      this.profiles = [...profiles.values()];
      this.defaults = {
        ...(latest?.defaults || this.defaults),
        ...(defaultsPatch || {}),
      };
      if (!this.defaults.writerId && this.profiles[0])
        this.defaults.writerId = this.profiles[0].id;
      if (removeId && this.defaults.writerId === removeId)
        this.defaults.writerId = this.profiles[0]?.id || null;
      if (removeId && this.defaults.helperId === removeId)
        this.defaults.helperId = null;
      meta.put({
        id: "connectionLibrary",
        profiles: this.profiles,
        defaults: this.defaults,
      });
      for (const profile of this.profiles)
        meta.put({ id: "connection." + profile.id, profile });
      await done;
    });
    this.app.connections = this.profiles;
    this.app.updateModel();
    this.app.repo.channel?.postMessage({
      kind: "connections.changed",
      libraryGeneration: this.app.repo.generation,
    });
  }
  async refresh() {
    const saved = await this.app.repo.get("connectionLibrary", "meta");
    if (saved) {
      this.profiles = saved.profiles;
      this.defaults = saved.defaults;
      this.app.connections = this.profiles;
      this.app.updateModel();
    }
  }
  async forRequest(helper = false, novelId = this.app.novelId) {
    await this.selectionPending;
    const tx = this.app.repo.db.transaction(["meta", "records"]),
      done = complete(tx);
    const [settings, novel] = await Promise.all([
      request(tx.objectStore("meta").get("connectionLibrary")),
      request(tx.objectStore("records").get(novelId)),
    ]);
    await done;
    const defaults = settings?.defaults || this.defaults,
      profiles = settings?.profiles || this.profiles;
    const writer = novel?.writerConnectionId || defaults.writerId,
      chosen = helper
        ? novel?.helperConnectionId || defaults.helperId || writer
        : writer;
    return structuredClone(
      profiles.find((p) => p.id === chosen) ||
        profiles.find((p) => p.id === writer) ||
        DEFAULT_CONNECTION,
    );
  }
  resolve(helper = false, novelId = this.app.novelId) {
    const novel = this.novels.get(novelId),
      writerId = novel?.writerConnectionId || this.defaults.writerId;
    const helperId = novel?.helperConnectionId || this.defaults.helperId;
    const selected =
      this.profiles.find((p) => p.id === (helper ? helperId : writerId)) ||
      this.profiles.find((p) => p.id === writerId);
    return structuredClone(selected || DEFAULT_CONNECTION);
  }
  async save(profile) {
    const p = structuredClone(profile);
    validateConnection({ ...p, model: p.model || "Unselected model" });
    if (
      !Number.isInteger(p.contextLimit) ||
      !Number.isInteger(p.outputLimit) ||
      p.outputLimit < 1 ||
      p.outputLimit >= p.contextLimit
    )
      throw new Error("Choose valid context and output limits.");
    if (p.secret) this.pendingKeys.set(p.id, p.secret);
    else if (this.pendingKeys.has(p.id)) p.secret = this.pendingKeys.get(p.id);
    let saved;
    if (p.transport === "direct") {
      rememberDirect(p.id, p.secret, p.endpoint);
      p.persistSecret = false;
      delete p.secret;
    }
    if (this.app.device.token) {
      try {
        saved = await this.app.device.api("connections", {
          method: "POST",
          body: { ...p, connectionProtocol: 2 },
        });
        saved.relaySaved = true;
        this.pendingKeys.delete(p.id);
      } catch (e) {
        if (e.status) throw e;
        saved = { ...publicConnection(p), hasSecret: false, relaySaved: false };
      }
    } else
      saved = { ...publicConnection(p), hasSecret: false, relaySaved: false };
    this.profiles = this.profiles
      .filter((x) => x.id !== saved.id)
      .concat(saved);
    if (!this.defaults.writerId) this.defaults.writerId = saved.id;
    await this.persist({ upserts: [saved] });
    return saved;
  }
  use(identity, role = "writer", scope = "global") {
    const novelId = this.app.novelId;
    const task = (this.selectionPending || Promise.resolve())
      .catch(() => {})
      .then(() => this.assign(identity, role, scope, novelId));
    this.selectionPending = task;
    task
      .finally(() => {
        if (this.selectionPending === task) this.selectionPending = null;
      })
      .catch(() => {});
    return task;
  }
  async assign(
    identity,
    role = "writer",
    scope = "global",
    novelId = this.app.novelId,
  ) {
    if (identity && !this.profiles.some((p) => p.id === identity))
      throw new Error("Choose a saved connection.");
    if (scope === "novel") {
      await this.app.repo.withMutation(async () => {
        const n = await this.app.repo.get(novelId);
        if (!n) throw new Error("Open a novel first.");
        const next = {
          ...n,
          [role === "writer" ? "writerConnectionId" : "helperConnectionId"]:
            identity || null,
        };
        await this.app.repo.commitLocked({
          novelId: n.id,
          kind: "connection.assign",
          expectedRecord: { id: n.id, version: n.recordVersion || 0 },
          records: [next],
        });
        this.novels.set(n.id, next);
      });
      await this.persist({ upserts: [] });
    } else
      await this.persist({
        upserts: [],
        defaultsPatch: {
          [role === "writer" ? "writerId" : "helperId"]: identity || null,
        },
      });
  }
  async remove(identity) {
    if (this.app.device.token)
      await this.app.device.api("connections/remove", {
        method: "POST",
        body: { id: identity },
      });
    this.profiles = this.profiles.filter((c) => c.id !== identity);
    forgetDirect(identity);
    if (this.defaults.writerId === identity)
      this.defaults.writerId = this.profiles[0]?.id || null;
    if (this.defaults.helperId === identity) this.defaults.helperId = null;
    await this.app.repo.withMutation(async () => {
      for (const n of await this.app.repo.query("type", "novel"))
        if (
          n.writerConnectionId === identity ||
          n.helperConnectionId === identity
        ) {
          const updated = {
            ...n,
            ...(n.writerConnectionId === identity
              ? { writerConnectionId: null }
              : {}),
            ...(n.helperConnectionId === identity
              ? { helperConnectionId: null }
              : {}),
          };
          await this.app.repo.commitLocked({
            novelId: n.id,
            kind: "connection.remove.assignment",
            expectedRecord: { id: n.id, version: n.recordVersion || 0 },
            records: [updated],
          });
          this.novels.set(n.id, updated);
        }
    });
    await this.persist({ upserts: [], removeId: identity });
  }
  status(c) {
    if (!c.model) return "Choose a model";
    if (c.relaySaved === false && c.transport !== "direct")
      return "Saved locally, relay setup pending";
    if (
      c.transport === "direct" &&
      !directHasKey(c.id, c.endpoint) &&
      !c.allowLocal
    )
      return "Key needed";
    if (!c.hasSecret && c.transport !== "direct" && !c.allowLocal)
      return "Key needed";
    if (c.health === "failed")
      return (
        "Last test failed" +
        (c.observations?.code ? ": " + c.observations.code : "")
      );
    return c.lastTest?.ok
      ? (c.lastTest.configurationIdentity &&
        c.lastTest.configurationIdentity !== configurationIdentity(c)
          ? "Tested earlier settings "
          : "Tested ") + new Date(c.lastTest.at).toLocaleDateString()
      : "Not tested";
  }
}
