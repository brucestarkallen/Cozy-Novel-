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
    const { assemble, snapshotCurrent } = await import(
      "/js/context/assemble.js"
    );
    const { revise } = await import("/js/novel/operations.js");
    const r = await Repository.open("cozynovel.audit"),
      d = new DeviceSync(r);
    await d.connect();
    const n = await r.createNovel("Audit", "Before preview"),
      s = (await r.query("novelId", n)).find((x) => x.type === "scene");
    let release, started;
    const held = new Promise((resolve) => (release = resolve)),
      begun = new Promise((resolve) => (started = resolve));
    const api = d.api.bind(d);
    let sent = 0;
    d.api = async (path, options) => {
      if (path.includes("/operations") && sent++ === 0) {
        started();
        await held;
      }
      return api(path, options);
    };
    let busyObserved;
    const busyRun = new Promise((resolve) => (busyObserved = resolve)),
      flush = d.flush.bind(d);
    d.flush = async () => {
      if (d.busy) busyObserved();
      return flush();
    };
    const drain = d.flush();
    await begun;
    await revise(r, s.id, s.currentRevisionId, "B while upload held");
    await busyRun;
    release();
    await drain;
    const slow = {
      pending: (await r.all("outbox")).length,
      status: d.state,
      sent,
    };
    await d.flush();
    const prepared = await d.restoreDevice();
    const current = await r.sceneText(s.id);
    await revise(r, s.id, current.revision.id, "Important edit AFTER preview");
    let restoreRejected = false;
    try {
      await prepared.commit();
    } catch {
      restoreRejected = true;
    }
    const restore = {
      restoreRejected,
      pending: (await r.all("outbox")).length,
      browser: (await r.sceneText(s.id)).text,
      device: (await d.deviceSnapshot()).blobs.map((b) => b.text),
      status: d.state,
    };
    const currentScene = await r.get(s.id);
    await r.update(
      {
        ...currentScene,
        fictionalTime: 1,
        summary: "ENDING_REVELATION",
        notes: "LATER_NOTE",
      },
      "scene.details",
    );
    await r.update({
      id: "person_B",
      type: "entity",
      novelId: n,
      kind: "person",
      displayName: "B",
      aliases: [],
      profile: "LATER_PROFILE_DISCOVERY",
      sourceRefs: [],
    });
    await r.update({
      id: "late_knowledge",
      type: "canon",
      novelId: n,
      recordKind: "knowledge",
      holderId: "person_B",
      proposition: "LATER_KNOWLEDGE",
      status: "active",
      validFrom: 20,
      sourceRefs: [],
    });
    const options = {
      novelId: n,
      sceneId: s.id,
      kind: "rp",
      direction: "Act",
      connection: {
        adapter: "chat",
        model: "fixture",
        contextLimit: 32000,
        outputLimit: 1000,
      },
      exploration: {
        playerCharacterId: "person_B",
        baseRevisionId: (await r.get(s.id)).currentRevisionId,
        boundary: 3,
      },
    };
    const c = await assemble(r, options),
      historical = {
        profileLeak: c.user.includes("LATER_PROFILE_DISCOVERY"),
        summaryLeak: c.user.includes("ENDING_REVELATION"),
        dedicatedLeak: c.user.includes("LATER_KNOWLEDGE"),
      };
    const write = { ...options, kind: "write", exploration: undefined },
      before = await assemble(r, write);
    await r.update(
      {
        ...(await r.get(s.id)),
        viewpoint: "Changed viewpoint",
        fictionalTime: 2,
        notes: "Changed notes",
      },
      "scene.details",
    );
    await r.update({
      id: "new_fact",
      type: "canon",
      novelId: n,
      recordKind: "authorFact",
      proposition: "New author fact",
      status: "active",
      sourceRefs: [],
    });
    const freshness = {
      claimedCurrent: await snapshotCurrent(r, before.snapshot),
      differentFingerprint:
        (await assemble(r, write)).snapshot.dependencyFingerprint !==
        before.snapshot.dependencyFingerprint,
    };
    d.dispose();
    r.dispose();
    return { slow, restore, historical, freshness };
  });
  console.log(JSON.stringify(result, null, 2));
  await writeFile(
    new URL("audit-repaired.json", artifacts),
    JSON.stringify(result, null, 2),
  );
  assert.equal(result.slow.pending, 0);
  assert.equal(result.slow.sent, 2);
  assert.equal(result.restore.restoreRejected, true);
  assert.ok(result.restore.pending > 0);
  assert.equal(result.historical.profileLeak, false);
  assert.equal(result.historical.summaryLeak, false);
  assert.equal(result.freshness.claimedCurrent, false);
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
