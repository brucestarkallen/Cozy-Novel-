import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
  ));
}
const directory = await mkdtemp(join(tmpdir(), "cozynovel-browser-"));
const artifacts = new URL("../../test-results/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const children = [];
let browser;
const passes = [];
const errors = [];
const requests = [];
function processLine(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: new URL("../../", import.meta.url),
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("\n")) resolve({ child, line: out.split("\n")[0] });
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("exit", (code) => {
      if (!out) reject(new Error(cmd + " exited " + code + " " + err));
    });
  });
}
async function port() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
const ok = (name) => {
  passes.push(name);
  console.log("PASS " + name);
};
try {
  const appPort = await port(),
    origin = "http://127.0.0.1:" + appPort;
  await processLine("python", [
    "serve.py",
    "--port",
    String(appPort),
    "--data-dir",
    directory,
  ]);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.COZYNOVEL_CHROMIUM,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const { DeviceSync } = await import("/js/storage/sync.js");
    const { revise, createCandidate, saveCandidate } = await import(
      "/js/novel/operations.js"
    );
    const { request, complete } = await import("/js/storage/database.js");
    let r = await Repository.open("cozynovel.restore-test");
    const r2 = await Repository.open("cozynovel.restore-test"),
      d = new DeviceSync(r);
    d.schedule = () => {};
    await d.connect();
    const n = await r.createNovel("Restore", "A committed snapshot"),
      s = (await r.query("novelId", n)).find((r) => r.type === "scene");
    const candidate = await createCandidate(r, {
      sceneId: s.id,
      direction: "Pending candidate",
    });
    await d.flush();
    const preview = await d.restoreDevice();
    const api = d.api.bind(d);
    let release, committed;
    const held = new Promise((r) => (release = r)),
      known = new Promise((r) => (committed = r));
    d.api = async (path, opt) => {
      const result = await api(path, opt);
      if (path === "restore/commit") {
        committed();
        await held;
      }
      return result;
    };
    const restore = preview.commit();
    await known;
    let writeFinished = false;
    const edit = revise(
      r2,
      s.id,
      s.currentRevisionId,
      "Deferred newer edit",
    ).then(() => (writeFinished = true));
    let checkpointFinished = false;
    const checkpointWrite = saveCandidate(
      r2,
      candidate,
      "Partial candidate arriving behind the barrier",
      "streaming",
    ).then(() => (checkpointFinished = true));
    await Promise.resolve();
    const blocked = !writeFinished && !checkpointFinished;
    release();
    await restore;
    await edit;
    await checkpointWrite;
    const remaining = await r.all("outbox");
    const checkpoint = await r.get("sync", "meta");
    const deferred = {
      blocked,
      pending: remaining.length,
      expected: Math.min(...remaining.map((o) => o.expectedServerRevision)),
      revisionSequence: remaining
        .map((o) => o.expectedServerRevision)
        .sort((a, b) => a - b),
      serverRevision: checkpoint.serverRevision,
    };
    await d.flush();
    d.api = api;
    const next = await d.restoreDevice();
    d.api = async (path, opt) => {
      const result = await api(path, opt);
      if (path === "restore/commit") throw new Error("Lost acknowledgement");
      return result;
    };
    let lost = false;
    try {
      await next.commit();
    } catch {
      lost = true;
    }
    const journal = await r.get("restoreIntent", "meta");
    let fenced = false;
    try {
      const text = await r.sceneText(s.id);
      await revise(
        r,
        s.id,
        text.revision.id,
        "Must remain a visible queued draft",
      );
    } catch {
      fenced = true;
    }
    d.dispose();
    r.dispose();
    r2.dispose();
    r = await Repository.open("cozynovel.restore-test");
    const reopened = new DeviceSync(r);
    reopened.schedule = () => {};
    await reopened.connect();
    d.api = reopened.api.bind(reopened);
    await reopened.recoverRestore();
    const recovered = await r.get("restoreIntent", "meta");
    const again = await api("restore/commit", {
      method: "POST",
      body: {
        restoreOperationId: recovered.restoreOperationId,
        snapshotDigest: recovered.snapshotDigest,
        expectedServerRevision: recovered.expectedServerRevision,
        clientProtocol: 2,
      },
    });
    const recovery = {
      lost,
      unknown: journal.phase,
      fenced,
      recovered: recovered.phase,
      sameAck: again.serverRevision === recovered.ack.serverRevision,
    };
    // A legacy empty outbox is not proof of content equality.
    const c = await r.sceneText(s.id);
    await revise(r, s.id, c.revision.id, "Missing legacy outbox payload");
    await r.withMutation(async () => {
      const tx = r.db.transaction(["outbox", "meta"], "readwrite"),
        done = complete(tx);
      tx.objectStore("outbox").clear();
      tx.objectStore("meta").put({
        id: "sync",
        serverRevision: again.serverRevision,
        queuedRevision: again.serverRevision,
      });
      await done;
    });
    await reopened.flush();
    const reconciliation = {
      status: reopened.state,
      text: (await r.sceneText(s.id)).text,
    };
    reopened.dispose();
    d.dispose();
    const prior = d.state;
    const upload = d.flush();
    await upload;
    const disposed = { unchanged: d.state === prior };
    r.dispose();
    r2.dispose();
    return { deferred, recovery, reconciliation, disposed };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.deferred.blocked);
  assert.equal(result.deferred.pending, 2);
  assert.equal(result.deferred.expected, result.deferred.serverRevision);
  assert.ok(
    result.recovery.lost && result.recovery.fenced && result.recovery.sameAck,
  );
  assert.equal(result.recovery.unknown, "unknown");
  assert.equal(result.recovery.recovered, "acknowledged");
  assert.match(result.reconciliation.status, /differs/);
  assert.equal(result.reconciliation.text, "Missing legacy outbox payload");
  assert.ok(result.disposed.unchanged);
  await writeFile(
    new URL("restore-regressions.json", artifacts),
    JSON.stringify(result, null, 2),
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
