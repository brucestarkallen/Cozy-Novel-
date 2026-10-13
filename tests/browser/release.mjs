import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
const dir = await mkdtemp(tmpdir() + "/cozynovel-release-"),
  children = [],
  passes = [],
  errors = [];
let browser;
const evidence = new URL("../../test-results/release/", import.meta.url);
await mkdir(evidence, { recursive: true });
async function start(args) {
  const p = spawn("python", args, {
    cwd: new URL("../../", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(p);
  const line = await new Promise((resolve, reject) => {
    let data = "",
      err = "";
    p.stdout.on("data", (b) => {
      data += b;
      if (data.includes("\n")) resolve(data.split("\n")[0]);
    });
    p.stderr.on("data", (b) => (err += b));
    p.on("exit", (c) => {
      if (!data) reject(new Error(err || "Server exit " + c));
    });
  });
  return { process: p, line };
}
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
let page;
async function until(fn, arg) {
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(fn, arg)) return;
    await page.waitForTimeout(50);
  }
  throw new Error("Durable browser predicate did not become true");
}
const pass = (n) => {
  passes.push(n);
  console.log("PASS " + n);
};
try {
  const mock = await start(["tests/fixtures/provider.py"]),
    p = await port(),
    origin = "http://127.0.0.1:" + p;
  let local = await start(["serve.py", "--port", String(p), "--data-dir", dir]);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.COZYNOVEL_CHROMIUM,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1536, height: 1024 },
    }),
    newPage = await context.newPage();
  page = newPage;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Start a novel", exact: true })
    .click();
  await page.getByLabel("Working title").fill("The Rainy Café");
  await page.getByRole("button", { name: "Create novel", exact: true }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("claude");
  await page.getByLabel("Connection name").fill("Claude writing");
  await page.getByText("Endpoint and transport", { exact: true }).click();
  await page
    .getByLabel("Full endpoint URL")
    .fill("http://127.0.0.1:" + mock.line + "/v1/messages");
  await page
    .getByLabel("Explicitly allow a loopback local model endpoint")
    .check();
  await page
    .getByLabel("API key, blank keeps the current key")
    .fill("SYNTHETIC_RELEASE_KEY");
  await page.getByLabel("Remember this API key on this device").check();
  await page.getByRole("button", { name: "Fetch models", exact: true }).click();
  await page.getByLabel("Discovered models").selectOption("synthetic-fixture");
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#connectionHealth")
      .textContent.startsWith("Tested"),
  );
  await page
    .getByRole("button", { name: "Validate and save connection", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  const writerId = await page.locator("#connectionPicker").inputValue();
  assert.ok(writerId.startsWith("connection_"));
  pass(
    "UI provider selection, key entry, real model discovery, minimal Test, save and active picker",
  );
  const created = await page.evaluate(
    async ({ endpoint, writerId }) => {
      const { presetProfile } = await import("/js/connections/presets.js"),
        status = await (await fetch("/api/novel/status")).json();
      const api = async (path, body) => {
        const r = await fetch("/api/novel/" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CozyNovel-Session": status.sessionToken,
          },
          body: JSON.stringify({ ...body, connectionProtocol: 2 }),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      };
      const profiles = [];
      for (const [preset, model, persist] of [
        ["openrouter", "helper-model", true],
        ["deepseek", "second-model", false],
        ["custom", "custom-model", true],
        ["claude", "second-model", true],
      ]) {
        profiles.push(
          await api("connections", {
            ...presetProfile(preset, crypto.randomUUID()),
            displayName: preset + " " + model,
            endpoint: endpoint + "/v1/chat/completions",
            adapter: preset === "openrouter" ? "openrouter" : "chat",
            allowLocal: true,
            model,
            persistSecret: persist,
            secret: "SYNTHETIC_" + preset,
          }),
        );
      }
      return { profiles, writerId };
    },
    { endpoint: "http://127.0.0.1:" + mock.line, writerId },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Continue writing", exact: true })
    .click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  assert.equal(await page.locator(".connectionCard").count(), 5);
  await page
    .getByLabel("Default helper", { exact: true })
    .selectOption(created.profiles[0].id);
  await page
    .getByLabel("This novel’s writer", { exact: true })
    .selectOption(writerId);
  await page.locator("#closeModal").click();
  // UI copy and removal preserve independent profiles and role assignments.
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .locator(".connectionCard")
    .filter({ hasText: "Claude writing" })
    .getByRole("button", { name: "Copy", exact: true })
    .click();
  await page.getByLabel("Connection name").fill("Copied writer");
  await page.getByLabel("Model identifier").fill("copy-model");
  await page
    .getByText("Model settings and capabilities", { exact: true })
    .click();
  await page.getByLabel("Temperature", { exact: true }).fill("0.7131");
  await page.getByLabel("Model supports temperature", { exact: true }).check();
  await page
    .getByRole("button", { name: "Validate and save connection", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  const copies = await page.evaluate(async () => {
    const status = await (await fetch("/api/novel/status")).json();
    return status.connections;
  });
  assert.equal(copies.length, 6);
  assert.equal(
    copies.find((c) => c.id === writerId).model,
    "synthetic-fixture",
  );
  assert.equal(
    copies.find((c) => c.displayName === "Copied writer").parameters
      .temperature,
    0.7131,
  );
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .locator(".connectionCard")
    .filter({ hasText: "Copied writer" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await until(() => document.querySelectorAll(".connectionCard").length === 5);
  await page
    .getByLabel("Default writer", { exact: true })
    .selectOption(created.profiles[2].id);
  await page.locator("#closeModal").click();
  assert.equal(await page.locator("#connectionPicker").inputValue(), writerId);
  pass(
    "UI Copy, Change and Remove preserve stable independent configurations; a global default leaves the novel override intact",
  );
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  for (let i = 0; i < 2; i++) {
    const previous = await page.evaluate(async (id) => {
      const status = await (await fetch("/api/novel/status")).json();
      return status.connections.find((c) => c.id === id).profileVersion;
    }, writerId);
    await page
      .locator(".connectionCard")
      .filter({ hasText: "Claude writing" })
      .getByRole("button", { name: "Test", exact: true })
      .click();
    await until(
      async ({ id, version }) => {
        const { Repository } = await import("/js/storage/repository.js"),
          r = await Repository.open(),
          settings = await r.get("connectionLibrary", "meta"),
          c = settings.profiles.find((c) => c.id === id);
        r.dispose();
        return c.profileVersion > version && c.health === "tested";
      },
      { id: writerId, version: previous },
    );
    await page
      .locator(".connectionCard")
      .filter({ hasText: "Claude writing" })
      .getByText(/^Tested /)
      .waitFor();
  }
  await page.locator("#closeModal").click();
  pass(
    "Connection manager Test can be repeated explicitly without stale profile writes and updates the displayed health",
  );
  // Drafts across reload, novel navigation and exploration reopen.
  const draft =
    "A, B, and C are childhood friends sitting in a café on a rainy afternoon. 雨\nThey discuss ordinary things.";
  await page.locator("#direction").fill(draft);
  await page
    .locator("#discussionInput")
    .fill("Unsent partner question ☕\nKeep this exactly.");
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const drafts = (await r.query("type", "artifact")).filter(
      (a) => a.kind === "creativeDraft",
    );
    r.dispose();
    return drafts.length >= 2;
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Continue writing", exact: true })
    .click();
  await page.waitForFunction(
    (value) => document.querySelector("#direction").value === value,
    draft,
  );
  assert.equal(await page.locator("#direction").inputValue(), draft);
  await page.waitForFunction(
    () =>
      document.querySelector("#discussionInput").value ===
      "Unsent partner question ☕\nKeep this exactly.",
  );
  assert.equal(
    await page.locator("#discussionInput").inputValue(),
    "Unsent partner question ☕\nKeep this exactly.",
  );
  pass(
    "CN04 durable scene direction and Partner draft survive reload with exact Unicode and lines",
  );
  await page.getByRole("button", { name: "Write scene", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  await page.waitForFunction(
    () => document.querySelectorAll("#suggestions button").length === 3,
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const records = await r.all();
    r.dispose();
    return (
      records.some((r) => r.kind === "readingQueue") &&
      records.filter((r) => r.type === "canon").length >= 6
    );
  });
  const routes = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const receipts = await r.query("type", "receipt");
    r.dispose();
    return receipts.map((x) => ({
      id: x.connectionId,
      model: x.model,
      purpose: x.purpose,
    }));
  });
  assert.ok(routes.some((r) => r.id === writerId && r.purpose === "write"));
  assert.ok(
    routes.some(
      (r) => r.id === created.profiles[0].id && r.purpose === "analysis",
    ),
  );
  pass(
    "Named writer and helper route actual requests and receipts; more than three typed facts are maintained automatically",
  );
  await page.locator("#direction").fill("They decide to buy ice cream.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page.getByLabel("Play as an established person").waitFor();
  const options = await page
    .getByLabel("Play as an established person")
    .locator("option")
    .allTextContents();
  const bIndex = options.indexOf("B");
  assert.ok(bIndex >= 0);
  await page
    .getByLabel("Play as an established person")
    .selectOption({ index: bIndex });
  await page
    .getByRole("button", { name: "Enter exploration", exact: true })
    .click();
  await page
    .getByLabel("Your character action")
    .fill("Unsent RP action, exact 雨");
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const found = (await r.query("type", "artifact")).some(
      (a) => a.kind === "creativeDraft" && a.draftKind === "rp",
    );
    r.dispose();
    return found;
  });
  await page.locator("#closeModal").click();
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page
    .locator("#modalBody [data-action=openExploration]")
    .first()
    .click();
  assert.equal(
    await page.getByLabel("Your character action").inputValue(),
    "Unsent RP action, exact 雨",
  );
  await page
    .getByLabel("Your character action")
    .fill("SLOW_TEST B asks a small question.");
  await page.getByRole("button", { name: "Act", exact: true }).click();
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const jobs = (await r.query("type", "job")).filter((j) => j.kind === "rp");
    const j = jobs.at(-1);
    const streaming = !!j?.textBlobId && j.state === "running";
    r.dispose();
    return streaming;
  });
  const exId = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const ex = (await r.query("type", "exploration"))[0];
    await r.update(
      { ...ex, narrativeViewpoint: "Changed during response" },
      "test.changed.viewpoint",
    );
    r.dispose();
    return ex.id;
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("#modalBody button")).find(
        (b) => b.textContent === "Act",
      ).disabled,
  );
  const stale = await page.evaluate(async (exId) => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const turns = await r.query("parentSessionId", exId),
      jobs = (await r.query("type", "job")).filter(
        (j) => j.explorationId === exId && j.kind === "rp",
      );
    const result = {
      world: turns.filter((t) => t.role === "world").length,
      job: jobs.at(-1),
      text: await r.text(jobs.at(-1).textBlobId),
    };
    r.dispose();
    return result;
  }, exId);
  assert.equal(stale.world, 0);
  assert.ok(stale.text);
  assert.equal(stale.job.state, "stale");
  pass(
    "CN06 stale real streamed RP output remains in its owning job and creates zero active world turns",
  );
  await page.evaluate(async (exId) => {
    const { Repository } = await import("/js/storage/repository.js");
    const { textBlob, id } = await import("/js/core/ids.js");
    const r = await Repository.open(),
      ex = await r.get(exId),
      blob = await textBlob('{"not":"world dialogue"}');
    for (const kind of ["analysis", "eventProposal"])
      await r.commit({
        novelId: ex.novelId,
        kind: "test.helper",
        records: [
          {
            id: id("job"),
            type: "job",
            novelId: ex.novelId,
            kind,
            explorationId: ex.id,
            branchId: ex.activeBranchId,
            textBlobId: blob.id,
            state: "completed",
            targetSequence: 2,
          },
        ],
        blobs: [blob],
      });
    r.dispose();
  }, exId);
  await page.locator("#closeModal").click();
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page
    .locator("#modalBody [data-action=openExploration]")
    .first()
    .click();
  await until(
    () =>
      Array.from(document.querySelectorAll("#modalBody button")).filter(
        (b) => b.textContent === "Keep as a recovered branch",
      ).length === 1,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Keep as a recovered branch", exact: true })
      .count(),
    1,
  );
  assert.ok(
    !(await page.locator("#rpTranscript").textContent()).includes(
      "world dialogue",
    ),
  );
  pass(
    "CN07 only true RP response jobs appear in transcript recovery; helper JSON stays outside",
  );
  await page.locator("#closeModal").click();
  // Durable reading continues for the original source after the visible workspace changes.
  const sourceSceneId = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const n = (await r.get("library", "meta")).activeProjectId;
    const scene = (await r.query("novelId", n)).find((r) => r.type === "scene");
    r.dispose();
    return scene.id;
  });
  await page.locator("#direction").fill("SLOW_TEST A quiet continuation.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#candidateText").textContent.length > 10,
  );
  await page.locator("#connectionPicker").selectOption(created.profiles[2].id);
  await page.getByRole("button", { name: "＋ Scene", exact: true }).click();
  await page.getByLabel("Scene title", { exact: true }).fill("Elsewhere");
  await page.locator("#modal form [type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#sceneTitle").textContent === "Elsewhere",
  );
  await until(async (id) => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const cs = (await r.query("sceneId", id)).filter(
      (c) => c.type === "candidate",
    );
    const candidate = cs.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    const done = (await r.query("sceneId", id)).some(
      (a) => a.kind === "analysis" && a.candidateId === candidate?.id,
    );
    r.dispose();
    return candidate?.status === "ready" && done;
  }, sourceSceneId);
  await page
    .locator(
      '#chapterList [data-action=openScene][data-id="' + sourceSceneId + '"]',
    )
    .click();
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await until(async (id) => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const tasks = (await r.query("sceneId", id)).filter(
      (a) => a.kind === "readingQueue",
    );
    r.dispose();
    return tasks.length >= 2;
  }, sourceSceneId);
  pass(
    "CN12 candidate generation and reading retain their original source while another scene is visible; acceptance creates durable work",
  );
  await page
    .locator("#editor")
    .fill(
      (await page.locator("#editor").inputValue()) +
        "\nA quiet manually written ending.",
    );
  await until(async (id) => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const scene = await r.get(id),
      tasks = await r.query("sceneId", id);
    const task = tasks.find(
      (a) =>
        a.kind === "readingQueue" &&
        a.baseRevisionId === scene.currentRevisionId,
    );
    r.dispose();
    return !!task;
  }, sourceSceneId);
  pass(
    "CN12 accepted manual edits coalesce into revision owned reading tasks without a panel audit",
  );
  // Exercise direct mode and redacted connection failures through the actual relay boundary.
  const transportChecks = await page.evaluate(async (endpoint) => {
    const { presetProfile } = await import("/js/connections/presets.js"),
      { testConnection, rememberDirect, providerFetch } = await import(
        "/js/connections/transport.js"
      ),
      { serialize } = await import("/js/ai/providers/adapters.js");
    const status = await (await fetch("/api/novel/status")).json(),
      device = { token: status.sessionToken };
    const save = async (c) => {
      const response = await fetch("/api/novel/connections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CozyNovel-Session": device.token,
        },
        body: JSON.stringify({ ...c, connectionProtocol: 2 }),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const checks = [];
    for (const [model, code] of [
      ["auth-error", "invalid_credentials"],
      ["permission-error", "permission_denied"],
      ["missing-model", "unknown_model"],
      ["parameter-error", "unsupported_parameter"],
      ["rate-error", "rate_limited"],
      ["quota-error", "quota_restricted"],
      ["malformed-test", null],
      ["disconnect-test", null],
      ["timeout-test", null],
    ]) {
      const c = await save({
        ...presetProfile("custom", "test_" + model),
        endpoint: endpoint + "/v1/chat/completions",
        model,
        allowLocal: true,
        secret: "SYNTHETIC_TEST_KEY",
      });
      let error;
      try {
        await testConnection(device, c);
      } catch (e) {
        error = e;
      }
      if (
        !error ||
        (code && error.code !== code) ||
        error.message.includes("PRIVATE")
      )
        throw new Error(
          "Incorrect redacted failure classification for " +
            model +
            ": " +
            error?.message,
        );
      if (model === "timeout-test" && error.name !== "AbortError")
        throw new Error("Test deadline did not abort local consumption");
      checks.push(model + ": " + (error.code || error.message));
      await fetch("/api/novel/connections/remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CozyNovel-Session": device.token,
        },
        body: JSON.stringify({ id: c.id }),
      });
    }
    const captured = await save({
      ...presetProfile("custom", "captured_snapshot"),
      endpoint: endpoint + "/v1/chat/completions",
      model: "synthetic-fixture",
      allowLocal: true,
      secret: "SYNTHETIC_SNAPSHOT_KEY",
    });
    await save({
      ...captured,
      endpoint: endpoint + "/v1/chat/completions/changed",
    });
    const beforeForward = (await (await fetch(endpoint + "/requests")).json())
      .requests.length;
    let snapshotError;
    try {
      await testConnection(device, captured);
    } catch (e) {
      snapshotError = e;
    }
    if (
      snapshotError?.code !== "connection_changed" ||
      (await (await fetch(endpoint + "/requests")).json()).requests.length !==
        beforeForward
    )
      throw new Error(
        "A changed relay profile retargeted an original request snapshot",
      );
    await fetch("/api/novel/connections/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CozyNovel-Session": device.token,
      },
      body: JSON.stringify({ id: captured.id }),
    });
    const direct = {
      ...presetProfile("custom", "direct_test"),
      endpoint: endpoint + "/v1/chat/completions",
      model: "synthetic-fixture",
      allowLocal: true,
      transport: "direct",
    };
    rememberDirect(direct.id, "SYNTHETIC_DIRECT_KEY", direct.endpoint);
    await testConnection(device, direct);
    let corsFailure;
    try {
      await testConnection(device, { ...direct, model: "cors-error" });
    } catch (e) {
      corsFailure = e;
    }
    if (corsFailure?.code !== "browser_transport")
      throw new Error("Browser CORS failure was disguised or bypassed");
    let prevented = false;
    try {
      await providerFetch(
        device,
        {
          ...direct,
          allowLocal: false,
          endpoint: "https://unrelated.invalid/v1/chat/completions",
        },
        serialize(direct, { system: "Test", user: "Hello", outputLimit: 64 }),
        { requestId: crypto.randomUUID() },
      );
    } catch (e) {
      prevented = e.code === "key_needed";
    }
    if (!prevented) throw new Error("Credential origin binding failed");
    const structured = await save({
      ...presetProfile("hermes", "structured_test"),
      endpoint: endpoint + "/v1/chat/completions",
      model: "synthetic-fixture",
      allowLocal: true,
      prefill: "Rain.",
      prefillMode: "structured",
    });
    await testConnection(device, structured, { prefill: true });
    await fetch("/api/novel/connections/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CozyNovel-Session": device.token,
      },
      body: JSON.stringify({ id: structured.id }),
    });
    return checks;
  }, "http://127.0.0.1:" + mock.line);
  pass(
    "Real synthetic HTTP connection failures are classified and redacted; browser direct and structured prefill use their selected transports",
  );
  // Real IDB regressions on disposable clients, with transport only mocked at its boundary.
  const contracts = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js"),
      { textBlob, id } = await import("/js/core/ids.js"),
      { revise, addChapter, addScene } = await import(
        "/js/novel/operations.js"
      ),
      { applyReading, undoReading } = await import("/js/story/reading.js"),
      { saveEntity } = await import("/js/story/entities.js"),
      { createExploration, addTurn, branchState, branchTurns } = await import(
        "/js/rp/session.js"
      ),
      { assemble } = await import("/js/context/assemble.js"),
      { serialize } = await import("/js/ai/providers/adapters.js"),
      { exportBackup, restoreBackup } = await import("/js/storage/backup.js");
    const r = await Repository.open("cozynovel.release.contracts"),
      r2 = await Repository.open("cozynovel.release.contracts"),
      checks = [];
    const check = (v, n) => {
      if (!v) throw new Error(n);
      checks.push(n);
    };
    const n = await r.createNovel(
        "Preservation",
        "B is injured. B learns a secret. FUTURE_REVELATION",
      ),
      scene = (await r.query("novelId", n)).find((s) => s.type === "scene");
    let release, started;
    const wait = new Promise((res) => (release = res)),
      ready = new Promise((res) => (started = res)),
      digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      if (new TextDecoder().decode(args[1]) === "NEW PROSE") {
        started();
        await wait;
      }
      return digest(...args);
    };
    try {
      const pending = revise(r, scene.id, scene.currentRevisionId, "NEW PROSE");
      await ready;
      await r2.update(
        {
          ...(await r2.get(scene.id)),
          notes: "New notes from second client",
          viewpoint: "New viewpoint",
        },
        "scene.notes",
      );
      release();
      await pending;
    } finally {
      crypto.subtle.digest = digest;
    }
    const durableRevision = (await r.get(scene.id)).currentRevisionId;
    check(
      (await r.get("artifact_readqueue_" + durableRevision))?.baseRevisionId ===
        durableRevision,
      "Accepted text and its reading task commit atomically without a visible workspace or subscriber",
    );
    check(
      (await r.get(scene.id)).notes === "New notes from second client" &&
        (await r.sceneText(scene.id)).text === "NEW PROSE",
      "CN03 delayed manuscript hashing preserves newer metadata from another actual IndexedDB client",
    );
    await revise(
      r,
      scene.id,
      (await r.get(scene.id)).currentRevisionId,
      "B is injured. B learns a secret. FUTURE_REVELATION",
    );
    let rev = (await r.get(scene.id)).currentRevisionId;
    const blob = await textBlob("B is injured.");
    const a = {
      id: id("artifact"),
      type: "artifact",
      novelId: n,
      sceneId: scene.id,
      kind: "analysis",
      baseRevisionId: rev,
      body: {
        entities: [
          { key: "b", name: "B", kind: "person", quote: "B is injured." },
        ],
        updates: [
          {
            recordKind: "condition",
            subjectRef: "b",
            proposition: "Temporary injury",
            quote: "B is injured.",
            support: "explicit",
            validFrom: 1,
            validUntil: 5,
          },
        ],
      },
      coverage: { start: 0, end: 13, complete: false },
    };
    await r.update(a, "test.analysis");
    const batch = await applyReading(r, a.id),
      entity = (await r.query("novelId", n)).find((e) => e.type === "entity");
    await saveEntity(r, entity, { profile: "Author biography, exact 雨" });
    await r.update(
      {
        id: id("canon"),
        type: "canon",
        novelId: n,
        recordKind: "relationship",
        subjectId: entity.id,
        proposition: "Author established friendship",
        status: "active",
        derived: false,
        temporalScope: "invariant",
        sourceRefs: [],
      },
      "canon.author",
    );
    await undoReading(r, batch.id);
    check(
      !(await r.get(entity.id)).derivedHidden &&
        (await r.get(entity.id)).profile === "Author biography, exact 雨" &&
        (await r.get(batch.id)).undoReceipt.partial,
      "CN05 reading undo preserves adopted profile history and independent relationship",
    );
    const nextRevision = await revise(
      r,
      scene.id,
      (await r.get(scene.id)).currentRevisionId,
      (await r.sceneText(scene.id)).text + "\nAn unrelated later paragraph.",
    );
    const reread = {
      ...a,
      id: id("artifact"),
      baseRevisionId: nextRevision.id,
      body: {
        updates: [
          {
            recordKind: "condition",
            subjectRef: entity.id,
            proposition: "Temporary injury",
            quote: "B is injured.",
            support: "explicit",
            validFrom: 1,
            validUntil: 5,
          },
        ],
      },
    };
    await r.update(reread, "test.reread");
    const reapplication = await applyReading(r, reread.id);
    check(
      !reapplication.body.appliedIds.some((k) => k.startsWith("canon_")) &&
        reapplication.body.reviews.some((x) => x.reason.includes("undid")),
      "An unrelated paragraph edit does not recreate an undone interpretation of unchanged source evidence",
    );
    await r.update(
      { ...(await r.get(scene.id)), fictionalTime: 1 },
      "scene.time",
    );
    const expiryRecord = batch.body.appliedIds
      .map((k) => k)
      .find((k) => k.startsWith("canon_"));
    check(
      (await r.get(expiryRecord)).validUntil === 5,
      "CN09 expiry survives typed reading storage",
    );
    await r.update(
      { ...(await r.get(expiryRecord)), status: "active" },
      "test.expiry",
    );
    const connection = {
      id: "synthetic",
      adapter: "chat",
      endpoint: "https://example.org/v1/chat/completions",
      model: "fixture",
      contextLimit: 32000,
      outputLimit: 1000,
      capabilities: {},
      parameters: {},
    };
    for (const time of [1, 5, 10]) {
      await r.update(
        { ...(await r.get(scene.id)), fictionalTime: time },
        "scene.time",
      );
      const ctx = await assemble(r, {
        novelId: n,
        sceneId: scene.id,
        kind: "rp",
        direction: "injury",
        connection,
      });
      check(
        ctx.user.includes("Temporary injury") === time < 5,
        "CN09 expiry is exclusive at " + time,
      );
    }
    await r.update(
      { ...(await r.get(scene.id)), fictionalTime: 1 },
      "scene.time",
    );
    const ex = await createExploration(r, {
      sceneId: scene.id,
      playerCharacterId: entity.id,
      boundary: 13,
      narrativeViewpoint: "B",
    });
    for (const kind of ["rp", "analysis", "eventProposal"]) {
      const ctx = await assemble(r, {
        novelId: n,
        sceneId: scene.id,
        kind,
        direction: "Read the current boundary only",
        connection,
        exploration: ex,
        sourceText: kind === "analysis" ? "B is injured." : undefined,
      });
      check(
        !JSON.stringify(serialize(connection, ctx)).includes(
          "FUTURE_REVELATION",
        ),
        "CN10 " + kind + " serialized context excludes later revelation",
      );
    }
    const laterChapter = await addChapter(r, n, "Later"),
      laterScene = await addScene(r, laterChapter.id, "Later revelation");
    const laterRevision = await revise(
      r,
      laterScene.id,
      laterScene.currentRevisionId,
      "ONLY_LATER_CHAPTER_SECRET",
    );
    await r.update(
      { ...(await r.get(laterScene.id)), fictionalTime: 20 },
      "scene.time",
    );
    const author = await assemble(r, {
      novelId: n,
      sceneId: scene.id,
      kind: "discuss",
      direction: "Discuss the ending",
      connection,
      scope: "sources",
      sourceIds: [laterRevision.id],
    });
    check(
      author.user.includes("FUTURE_REVELATION") &&
        author.user.includes("ONLY_LATER_CHAPTER_SECRET") &&
        author.user.includes("Author biography"),
      "CN11 author context retains later originals and freeform profile",
    );
    await addTurn(r, ex, "world", "B is injured.");
    let fresh = await r.get(ex.id);
    const turns = await r.query("parentSessionId", ex.id),
      turn = turns[0];
    const injBlob = await textBlob("B is injured.");
    const rpRead = {
      id: id("artifact"),
      type: "artifact",
      novelId: n,
      sceneId: scene.id,
      kind: "analysis",
      explorationId: ex.id,
      branchId: ex.activeBranchId,
      textBlobId: injBlob.id,
      coveredTurnIds: [turn.id],
      body: {
        updates: [
          {
            recordKind: "condition",
            proposition: "Branch injury",
            subjectRef: entity.id,
            quote: "B is injured.",
            support: "explicit",
          },
        ],
      },
      coverage: { start: 0, end: 13, complete: true },
    };
    await r.commit({
      novelId: n,
      kind: "test.rpread",
      records: [rpRead],
      blobs: [injBlob],
    });
    const parentBatch = await applyReading(r, rpRead.id),
      injury = parentBatch.body.appliedIds.find((k) => k.startsWith("canon_"));
    const child = id("branch"),
      sibling = id("branch");
    fresh = {
      ...(await r.get(ex.id)),
      activeBranchId: child,
      branches: [
        ...fresh.branches,
        { id: child, parentId: ex.activeBranchId, forkSequence: 1 },
        { id: sibling, parentId: ex.activeBranchId, forkSequence: 1 },
      ],
    };
    await r.update(fresh, "exploration.branch");
    await addTurn(r, fresh, "world", "At time 4, B healed.");
    const childTurn = (await r.query("parentSessionId", ex.id)).find(
        (t) => t.branchId === child,
      ),
      healBlob = await textBlob("At time 4, B healed.");
    const heal = {
      ...rpRead,
      id: id("artifact"),
      branchId: child,
      textBlobId: healBlob.id,
      coveredTurnIds: [turn.id, childTurn.id],
      body: {
        frame: {
          relativeTime: "After tending the injury",
          fictionalTime: 4,
          quote: "At time 4, B healed.",
          support: "explicit",
        },
        updates: [
          {
            recordKind: "condition",
            proposition: "Branch healed",
            subjectRef: entity.id,
            quote: "B healed.",
            support: "explicit",
            supersedes: injury,
          },
        ],
      },
      coverage: {
        start: 0,
        end: "At time 4, B healed.".length,
        complete: true,
      },
    };
    await r.commit({
      novelId: n,
      kind: "test.heal",
      records: [heal],
      blobs: [healBlob],
    });
    await applyReading(r, heal.id);
    check(
      (await r.get(injury)).status === "active",
      "CN08 shared ancestor record remains active",
    );
    for (const [branch, healed] of [
      [ex.activeBranchId, false],
      [sibling, false],
      [child, true],
    ]) {
      await r.update(
        { ...(await r.get(ex.id)), activeBranchId: branch },
        "exploration.branch",
      );
      const selected = await r.get(ex.id);
      const state = await branchState(
        r,
        selected,
        await branchTurns(r, selected),
      );
      check(
        state.currentFictionalTime === (healed ? 4 : null),
        "Branch clock stays attached to its evidenced transcript ancestry",
      );
      check(
        state.claims.some((c) => c.proposition === "Branch healed") === healed,
        "CN08 healing visible only on its selected branch " + branch,
      );
      check(
        state.claims.some((c) => c.proposition === "Branch injury") === !healed,
        "CN08 predecessor eligibility preserved outside child",
      );
    }
    const clockText = "At time 10, everyone waits.";
    const clockEx = await r.get(ex.id),
      clockTurn = await addTurn(r, clockEx, "world", clockText),
      clockBlob = await textBlob(clockText);
    const clockReading = {
      ...rpRead,
      id: id("artifact"),
      branchId: child,
      textBlobId: clockBlob.id,
      coveredTurnIds: [clockTurn.id],
      body: {
        updates: [],
        frame: {
          relativeTime: "Later on this branch",
          fictionalTime: 10,
          quote: clockText,
          support: "explicit",
        },
      },
      coverage: { start: 0, end: clockText.length, complete: true },
    };
    await r.commit({
      novelId: n,
      kind: "test.clock",
      records: [clockReading],
      blobs: [clockBlob],
    });
    await applyReading(r, clockReading.id);
    const atTen = await branchState(
      r,
      await r.get(ex.id),
      await branchTurns(r, await r.get(ex.id)),
    );
    check(
      atTen.currentFictionalTime === 10 &&
        !atTen.claims.some((c) => c.proposition === "Temporary injury"),
      "Known entry condition expires as the branch clock advances without admitting later manuscript revelations",
    );
    const { ConnectionLibrary } = await import("/js/connections/library.js"),
      { presetProfile } = await import("/js/connections/presets.js");
    const deviceProfile = {
        ...presetProfile("openai", "restored_profile"),
        model: "fixture",
        contextLimit: 500000,
      },
      localProfile = {
        ...deviceProfile,
        contextLimit: 200000,
        inputPrice: 1.23,
        relaySaved: false,
        hasSecret: false,
      };
    await r.localPut({
      id: "connectionLibrary",
      profiles: [localProfile],
      defaults: { writerId: localProfile.id, helperId: null },
    });
    const restoredConnections = new ConnectionLibrary({
      repo: r,
      novelId: n,
      device: { token: null },
      updateModel() {},
    });
    await restoredConnections.load([deviceProfile]);
    check(
      restoredConnections.resolve().contextLimit === 200000 &&
        restoredConnections.resolve().inputPrice === 1.23 &&
        restoredConnections.profiles[0].deviceProfile.contextLimit === 500000,
      "Restored connection limits and pricing remain owned locally while a differing device profile stays available for comparison",
    );
    const backup = await exportBackup(r);
    const restored = await Repository.open("cozynovel.release.restore");
    await restoreBackup(restored, backup);
    check(
      JSON.stringify(await restored.get(expiryRecord)) ===
        JSON.stringify(await r.get(expiryRecord)),
      "CN09 expiry and provenance survive complete backup and fresh database restore",
    );
    const { ReadingQueue } = await import("/js/ai/reading-queue.js"),
      queue = new ReadingQueue({ repo: r });
    await queue.recoverOnOpen();
    check(
      (await r.query("type", "artifact"))
        .filter((a) => a.kind === "readingQueue")
        .every((a) => !["queued", "running"].includes(a.state)),
      "Opening leaves unfinished source tasks explicitly resumable instead of automatically making paid requests",
    );
    queue.dispose();
    r.dispose();
    r2.dispose();
    restored.dispose();
    return checks;
  });
  contracts.forEach(pass);
  // Supporting author tools are real controls and retain their source ownership.
  const originalForTools = await page.locator("#editor").inputValue();
  await page
    .getByRole("button", { name: "Writing style", exact: true })
    .click();
  const sample = "  My exact voice sample 雨.\nNo punctuation is rewritten.  ";
  await page.getByLabel("Your voice samples, preserved exactly").fill(sample);
  await page.locator("#modal form [type=submit]").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Plans, craft and references", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reusable styles", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save current style", exact: true })
    .click();
  await page.getByLabel("Style name").fill("Quiet rain voice");
  await page.locator("#modal form [type=submit]").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Plans, craft and references", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add reference", exact: true })
    .click();
  await page.getByLabel("Reference title").fill("Window notes");
  await page
    .getByLabel("Reference text, preserved exactly")
    .fill("  REFERENCE ONLY, not a story fact. 雨\n<script>inert()</script>  ");
  await page.locator("#modal form [type=submit]").click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Plans, craft and references", exact: true })
    .click();
  await page
    .getByLabel("Guidance or craft question")
    .fill("Help this quiet café beat continue naturally.");
  await page
    .getByRole("button", { name: "Ask the Director", exact: true })
    .click();
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const found = (await r.all()).some((x) => x.kind === "sceneGuidance");
    r.dispose();
    return found;
  });
  await page.getByRole("button", { name: "Smart recall", exact: true }).click();
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const found = (await r.all()).some((x) => x.kind === "recallSelection");
    r.dispose();
    return found;
  });
  await page.locator("#closeModal").click();
  await page.locator("#editor").evaluate((e) => {
    e.focus();
    e.setSelectionRange(0, 12);
    e.dispatchEvent(new Event("select"));
  });
  await page
    .getByRole("button", { name: "Plans, craft and references", exact: true })
    .click();
  await page
    .getByLabel("Guidance or craft question")
    .fill("Review only this opening.");
  await page
    .getByRole("button", { name: "Ask the Literary Editor", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Propose reviewed selection revision",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .locator("#modal .prose")
      .evaluate((e) => getComputedStyle(e).color),
    await page.locator("#modal").evaluate((e) => getComputedStyle(e).color),
  );
  await page.screenshot({
    path: new URL("author-tools.png", evidence).pathname,
  });
  await page
    .getByRole("button", {
      name: "Propose reviewed selection revision",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  assert.equal(await page.locator("#editor").inputValue(), originalForTools);
  const toolsState = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const { exportBackup } = await import("/js/storage/backup.js");
    const r = await Repository.open(),
      records = await r.all(),
      backup = await exportBackup(r),
      styles = (await r.get("stylePresets", "meta")).items;
    const reference = records.find((x) => x.kind === "reference");
    const out = {
      sample: styles[0].profile.voiceSamples,
      reference: await r.text(reference.textBlobId),
      guidance: records
        .filter((x) =>
          ["sceneGuidance", "craftReview", "recallSelection"].includes(x.kind),
        )
        .map((x) => x.kind),
      backupConfiguration: backup.configuration,
      canon: records
        .filter((x) => x.type === "canon")
        .map((x) => x.proposition),
    };
    r.dispose();
    return out;
  });
  assert.equal(toolsState.sample, sample);
  assert.ok(toolsState.reference.includes("<script>inert()</script>"));
  assert.equal(
    toolsState.canon.some((x) => x.includes("REFERENCE ONLY")),
    false,
  );
  assert.equal(toolsState.guidance.length, 3);
  assert.equal(
    toolsState.backupConfiguration.stylePresets.items[0].profile.voiceSamples,
    sample,
  );
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  pass(
    "Real UI named styles preserve exact samples, references stay inert and outside canon, Director and Editor retain review, Smart recall selects original IDs, and an Editor proposal remains a candidate",
  );
  const firstNovel = await page.evaluate(async () => {
      const { Repository } = await import("/js/storage/repository.js");
      const r = await Repository.open(),
        id = (await r.get("library", "meta")).activeProjectId;
      r.dispose();
      return id;
    }),
    firstDirection = await page.locator("#direction").inputValue();
  await page.locator("#homeButton").click();
  await page
    .getByRole("button", { name: "Start a novel", exact: true })
    .click();
  await page.getByLabel("Working title").fill("Second writing room");
  await page.getByRole("button", { name: "Create novel", exact: true }).click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      document.querySelector("#novelTitle").textContent ===
      "Second writing room",
  );
  await page.locator("#connectionPicker").selectOption(created.profiles[3].id);
  await page.locator("#direction").fill("Another quiet café moment.");
  await page.getByRole("button", { name: "Write scene", exact: true }).click();
  await until(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open(),
      n = (await r.get("library", "meta")).activeProjectId;
    const found = (await r.query("novelId", n)).some(
      (x) =>
        x.type === "receipt" &&
        x.purpose === "write" &&
        x.state === "completed",
    );
    r.dispose();
    return found;
  });
  const secondRoute = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open(),
      n = (await r.get("library", "meta")).activeProjectId,
      receipt = (await r.query("novelId", n)).find(
        (x) => x.type === "receipt" && x.purpose === "write",
      );
    r.dispose();
    return receipt;
  });
  assert.equal(secondRoute.connectionId, created.profiles[3].id);
  assert.equal(secondRoute.model, "second-model");
  assert.notEqual(secondRoute.novelId, firstNovel);
  await page.locator("#homeButton").click();
  await page
    .locator('#novelList [data-action=openNovel][data-id="' + firstNovel + '"]')
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#novelTitle").textContent === "The Rainy Café" &&
      !document.querySelector("#direction").disabled,
  );
  assert.equal(await page.locator("#direction").inputValue(), firstDirection);
  pass(
    "A second novel uses its own selected model in the actual receipt and creative drafts survive novel navigation",
  );
  // Upgrade the exact published 1.1 modules, preserving records and fencing their old writer.
  await page.route("**/legacy1_1/**", (route) => {
    const file = new URL(route.request().url()).pathname.slice(
      "/legacy1_1/".length,
    );
    if (!/^js\/[a-zA-Z0-9_./-]+\.js$/.test(file)) return route.abort();
    return route.fulfill({
      body: execFileSync(
        "git",
        ["show", "cd8d2ffb0320c02f493cfa66387de505b71568c4:" + file],
        { cwd: new URL("../../", import.meta.url) },
      ),
      contentType: "text/javascript",
    });
  });
  const upgrade = await page.evaluate(async () => {
    const { Repository: Old } = await import(
        "/legacy1_1/js/storage/repository.js"
      ),
      { revise, createCandidate, saveCandidate } = await import(
        "/legacy1_1/js/novel/operations.js"
      ),
      { saveEntity } = await import("/legacy1_1/js/story/entities.js"),
      { createExploration, addTurn, retryBranch, keepEvents } = await import(
        "/legacy1_1/js/rp/session.js"
      ),
      { exportBackup: oldBackup } = await import(
        "/legacy1_1/js/storage/backup.js"
      );
    const { Repository } = await import("/js/storage/repository.js"),
      { exportBackup, inspectBackup } = await import("/js/storage/backup.js"),
      { ConnectionLibrary } = await import("/js/connections/library.js");
    const old = await Old.open("cozynovel.upgrade1_1"),
      n = await old.createNovel(
        "1.1 preserved",
        "Exact manuscript 雨\n  spaces  ",
      ),
      s = (await old.query("novelId", n)).find((x) => x.type === "scene");
    await revise(
      old,
      s.id,
      s.currentRevisionId,
      "Exact manuscript 雨\n  spaces  \nSecond version.",
    );
    const c = await createCandidate(old, {
      sceneId: s.id,
      direction: "Keep alternative",
    });
    await saveCandidate(old, c, "ALTERNATIVE exact.", "ready");
    await saveEntity(old, {
      id: "entity_B_upgrade",
      type: "entity",
      novelId: n,
      kind: "person",
      displayName: "B",
      aliases: [],
      profile: "Exact old biography",
      sourceRefs: [],
    });
    await saveEntity(old, {
      ...(await old.get("entity_B_upgrade")),
      profile: "Exact developed biography",
    });
    let ex = await createExploration(old, {
      sceneId: s.id,
      playerCharacterId: "entity_B_upgrade",
      boundary: 5,
      narrativeViewpoint: "B",
    });
    await addTurn(old, ex, "player", "Exact action");
    await addTurn(old, ex, "world", "Original response");
    ex = await retryBranch(old, await old.get(ex.id));
    await addTurn(old, ex, "world", "Retained branch response");
    await keepEvents(old, await old.get(ex.id), "Exact kept event");
    await old.update({
      id: "canon_manual_upgrade",
      type: "canon",
      novelId: n,
      recordKind: "authorFact",
      proposition: "My manual declaration",
      status: "active",
      derived: false,
      sourceRefs: [],
    });
    await old.update({
      id: "prompt_custom_upgrade",
      type: "prompt",
      novelId: n,
      kind: "write",
      version: 7,
      body: "My exact custom prompt",
    });
    await old.update({
      ...(await old.get(n)),
      storyMode: "off",
      styleProfile: {
        ...(await old.get(n)).styleProfile,
        voiceSamples: "Original sample exact",
      },
    });
    const originalProfile = {
      id: "primary",
      adapter: "chat",
      endpoint: "https://example.org/v1/chat/completions",
      model: "legacy-custom",
      contextLimit: 200000,
      outputLimit: 2000,
      parameters: { temperature: 0.321 },
      capabilities: { temperature: true },
      persistSecret: true,
      inputPrice: 1.23,
      outputPrice: 4.56,
    };
    await old.localPut({ id: "connection.primary", profile: originalProfile });
    await old.localPut({
      id: "connection.helper",
      profile: {
        ...originalProfile,
        id: "helper",
        model: "legacy-helper",
        persistSecret: false,
      },
    });
    const before = await oldBackup(old);
    await inspectBackup(before);
    const visible = document.createElement("textarea");
    visible.value = "Visible old tab input exact";
    document.body.append(visible);
    const r = await Repository.open("cozynovel.upgrade1_1"),
      after = await exportBackup(r);
    if (
      JSON.stringify(before.records) !== JSON.stringify(after.records) ||
      JSON.stringify(before.blobs) !== JSON.stringify(after.blobs)
    )
      throw new Error(
        "1.1 upgrade changed primary records or exact text bodies",
      );
    let fenced = false;
    try {
      await old.update({
        ...before.records.find((x) => x.type === "novel"),
        title: "Unsafe old writer",
      });
    } catch {
      fenced = true;
    }
    if (!fenced || visible.value !== "Visible old tab input exact")
      throw new Error("Old writer fence lost draft");
    const app = {
        repo: r,
        novelId: n,
        connections: [],
        updateModel() {},
        device: { token: null },
      },
      lib = new ConnectionLibrary(app);
    await lib.load();
    if (
      lib.resolve().model !== "legacy-custom" ||
      lib.resolve(true).model !== "legacy-helper" ||
      lib.resolve().parameters.temperature !== 0.321
    )
      throw new Error("Legacy profile migration lost roles or settings");
    if ((await r.get(n)).storyMode !== "off")
      throw new Error("Story preference changed");
    const result = {
      records: before.records.length,
      blobs: before.blobs.length,
      profiles: lib.profiles.map((p) => p.id),
      oldWriterFenced: fenced,
    };
    visible.remove();
    old.dispose();
    r.dispose();
    return result;
  });
  pass(
    "Exact 1.1 database and backup upgrade preserves " +
      upgrade.records +
      " records, " +
      upgrade.blobs +
      " immutable bodies, branches, profile history, prompts, declarations, preferences and legacy connection IDs; old writer is fenced",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Continue writing", exact: true })
    .click();
  // Real desktop and narrow viewport states, with actual decorative assets.
  const imageSizes = await page.evaluate(async () => {
    const out = [];
    for (const name of ["desktop", "mobile", "cat"]) {
      const image = new Image();
      image.src = "/assets/room/" + name + ".webp";
      await image.decode();
      out.push([image.naturalWidth, image.naturalHeight]);
    }
    return out;
  });
  assert.deepEqual(imageSizes, [
    [1920, 1080],
    [1080, 1920],
    [1080, 1920],
  ]);
  await page.screenshot({ path: new URL("desktop.png", evidence).pathname });
  await page
    .getByRole("button", { name: "Focus writing", exact: true })
    .click();
  assert.equal(await page.locator("#direction").isVisible(), true);
  await page
    .getByRole("button", { name: "Return to studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Focus reading", exact: true })
    .click();
  assert.equal(await page.locator("#direction").isVisible(), false);
  await page
    .getByRole("button", { name: "Return to studio", exact: true })
    .click();
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("button", { name: "Partner", exact: true }).click();
    await page
      .getByRole("button", { name: "Write", exact: true })
      .last()
      .click();
    assert.ok(await page.locator("#direction").isVisible());
    const boxes = await page.evaluate(() =>
      ["connectionPicker", "direction"].map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return {
          id,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          viewport: innerHeight,
        };
      }),
    );
    assert.ok(
      boxes.every((r) => r.top >= 0 && r.bottom <= r.viewport && r.height > 0),
      JSON.stringify(boxes),
    );
    await page.screenshot({
      path: new URL("phone" + width + ".png", evidence).pathname,
    });
  }
  await page.setViewportSize({ width: 390, height: 560 });
  assert.ok(await page.locator("#direction").isVisible());
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  pass(
    "Real approved room assets, separate focused writing and reading, and 360 and 390 pixel layouts",
  );
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.screenshot({
    path: new URL("connections.png", evidence).pathname,
  });
  await page.locator("#closeModal").click();
  // Restart service and retain metadata plus only intentionally persisted keys.
  local.process.kill("SIGTERM");
  await new Promise((r) => local.process.once("exit", r));
  local = await start(["serve.py", "--port", String(p), "--data-dir", dir]);
  await page.reload();
  await page
    .getByRole("button", { name: "Continue writing", exact: true })
    .click();
  const restarted = await page.evaluate(async () => {
    const s = await (await fetch("/api/novel/status")).json();
    return s.connections;
  });
  assert.equal(restarted.length, 5);
  assert.ok(restarted.find((c) => c.id === writerId).hasSecret);
  assert.equal(
    restarted.find((c) => c.id === created.profiles[1].id).hasSecret,
    false,
  );
  pass(
    "Browser and server restart preserve all profile metadata and deliberately retained keys; memory only key is needed again",
  );
  local.process.kill("SIGTERM");
  await new Promise((r) => local.process.once("exit", r));
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page.getByLabel("Provider", { exact: true }).selectOption("custom");
  await page.getByLabel("Connection name").fill("Offline preserved profile");
  await page
    .getByLabel("Full endpoint URL")
    .fill("https://offline.invalid/v1/chat/completions");
  await page.getByLabel("Model identifier").fill("manual-offline-model");
  await page
    .getByLabel("API key, blank keeps the current key")
    .fill("SYNTHETIC_OFFLINE_ONLY_KEY");
  await page
    .getByRole("button", { name: "Validate and save connection", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  const offline = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js"),
      { exportBackup } = await import("/js/storage/backup.js");
    const r = await Repository.open(),
      settings = await r.get("connectionLibrary", "meta"),
      backup = await exportBackup(r);
    r.dispose();
    return {
      profile: settings.profiles.find(
        (p) => p.displayName === "Offline preserved profile",
      ),
      containsKey: JSON.stringify(backup).includes(
        "SYNTHETIC_OFFLINE_ONLY_KEY",
      ),
    };
  });
  assert.equal(offline.profile.model, "manual-offline-model");
  assert.equal(offline.profile.relaySaved, false);
  assert.equal(offline.containsKey, false);
  pass(
    "Actual UI saves named nonsecret metadata during a local service outage without DNS, false connection success or a key in the portable backup",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("report.json", evidence),
    JSON.stringify(
      {
        passes,
        errors,
        browser: await browser.version(),
        provider: "synthetic local HTTP boundary",
        liveProvider: false,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(e);
  if (browser)
    for (const c of browser.contexts())
      for (const page of c.pages()) {
        console.error(
          "NOTICE",
          await page
            .locator("#notice")
            .textContent()
            .catch(() => ""),
        );
        await page
          .screenshot({ path: new URL("failure.png", evidence).pathname })
          .catch(() => {});
      }
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const p of children) p.kill("SIGTERM");
  if (!process.exitCode) await rm(dir, { recursive: true, force: true });
  else console.error("Synthetic fixture retained at " + dir);
}
