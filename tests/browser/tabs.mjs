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
    page = await context.newPage(),
    other = await context.newPage();
  await Promise.all([page.goto(origin), other.goto(origin)]);
  await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const { DeviceSync } = await import("/js/storage/sync.js");
    const r = await Repository.open("cozynovel.two-tabs"),
      d = new DeviceSync(r);
    d.schedule = () => {};
    await d.connect();
    const n = await r.createNovel("Two tabs", "First operation"),
      s = (await r.query("novelId", n)).find((r) => r.type === "scene");
    globalThis.testSync = { r, d, n, s };
  });
  let release, started;
  const held = new Promise((r) => (release = r)),
    begun = new Promise((r) => (started = r));
  let requests = 0;
  await page.route("**/projects/*/operations", async (route) => {
    requests++;
    if (requests === 1) {
      started();
      await held;
    }
    await route.continue();
  });
  const first = page.evaluate(() => testSync.d.flush());
  await begun;
  await other.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const { DeviceSync } = await import("/js/storage/sync.js");
    const { revise } = await import("/js/novel/operations.js");
    const r = await Repository.open("cozynovel.two-tabs"),
      d = new DeviceSync(r);
    d.schedule = () => {};
    await d.connect();
    const s = (await r.query("type", "scene"))[0];
    await revise(r, s.id, s.currentRevisionId, "Second tab newer operation");
    globalThis.testSync = { r, d };
  });
  const second = other.evaluate(() => testSync.d.flush());
  release();
  await Promise.all([first, second]);
  const coordinated = await page.evaluate(async () => ({
    pending: (await testSync.r.all("outbox")).length,
    serverRevision: (await testSync.d.api("status")).serverRevision,
    local: (await testSync.r.query("type", "scene"))[0].currentRevisionId,
  }));
  assert.equal(coordinated.pending, 0);
  assert.equal(coordinated.serverRevision, 2);
  assert.equal(requests, 2);
  const failures = await page.evaluate(async () => {
    const { revise } = await import("/js/novel/operations.js");
    const { DeviceSync } = await import("/js/storage/sync.js");
    const { r, d } = testSync;
    const current = await r.sceneText(testSync.s.id);
    await revise(
      r,
      current.scene.id,
      current.revision.id,
      "Lost acknowledgement operation",
    );
    const api = d.api.bind(d);
    let lost = true;
    d.api = async (path, opt) => {
      const response = await api(path, opt);
      if (path.includes("/operations") && lost) {
        lost = false;
        throw new Error("Synthetic lost acknowledgement");
      }
      return response;
    };
    await d.flush();
    const retained = await r.all("outbox"),
      committed = (await api("status")).serverRevision;
    await d.flush();
    const after = (await api("status")).serverRevision;
    const resend = {
      retained: retained.length,
      sameOperationId: retained[0].id,
      serverRevision: after,
      notReapplied: committed === after,
      pending: (await r.all("outbox")).length,
    };
    const latest = await r.sceneText(current.scene.id);
    await revise(
      r,
      latest.scene.id,
      latest.revision.id,
      "Disposed upload still recoverable",
    );
    let release, committedSignal;
    const held = new Promise((res) => (release = res)),
      begun = new Promise((res) => (committedSignal = res));
    d.api = async (path, opt) => {
      const response = await api(path, opt);
      if (path.includes("/operations")) {
        committedSignal();
        await held;
      }
      return response;
    };
    const upload = d.flush();
    await begun;
    d.dispose();
    const state = d.state;
    release();
    await upload;
    const disposedPending = (await r.all("outbox")).length;
    const replacement = new DeviceSync(r);
    replacement.schedule = () => {};
    await replacement.connect();
    await replacement.flush();
    const disposal = {
      retained: disposedPending,
      statusUnchanged: state === d.state,
      recovered: (await r.all("outbox")).length === 0,
    };
    replacement.dispose();
    return { resend, disposal };
  });
  assert.equal(failures.resend.retained, 1);
  assert.ok(failures.resend.notReapplied);
  assert.equal(failures.resend.pending, 0);
  assert.equal(failures.disposal.retained, 1);
  assert.ok(failures.disposal.statusUnchanged && failures.disposal.recovered);
  const result = { coordinated, requests, ...failures };
  console.log(JSON.stringify(result, null, 2));
  await writeFile(
    new URL("tab-regressions.json", artifacts),
    JSON.stringify(result, null, 2),
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
