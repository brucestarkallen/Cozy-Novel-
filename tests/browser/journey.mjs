import { browserContracts } from "./contracts.mjs";
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
  const mock = await processLine("python", ["tests/fixtures/provider.py"]);
  const appPort = await port();
  const origin = "http://127.0.0.1:" + appPort;
  await processLine("python", [
    "serve.py",
    "--port",
    String(appPort),
    "--data-dir",
    directory,
  ]);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.COZYNOVEL_CHROMIUM || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.url());
  });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Start a novel", exact: true })
    .click();
  await page.getByLabel("Working title").fill("The Rainy Café");
  await page.getByRole("button", { name: "Create novel", exact: true }).click();
  await page.locator("#sceneTitle").waitFor();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByLabel("Model identifier").fill("synthetic-fixture");
  await page
    .getByLabel("Full endpoint URL")
    .fill(`http://127.0.0.1:${mock.line}/v1/chat/completions`);
  await page
    .getByLabel("API key, blank keeps the current key")
    .fill("SYNTHETIC_BROWSER_SECRET");
  await page
    .getByLabel("Explicitly allow a loopback local model endpoint")
    .check();
  await page.getByLabel("Model supports temperature", { exact: true }).check();
  await page.getByLabel("Temperature", { exact: true }).fill("0.7");
  await page
    .getByLabel("Input price per million tokens, optional", { exact: true })
    .fill("0.5");
  await page
    .getByLabel("Output price per million tokens, optional", { exact: true })
    .fill("1.5");
  await page
    .getByRole("button", { name: "Validate and save connection", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page
    .locator("#direction")
    .fill(
      "A, B, and C are childhood friends sitting in a café on a rainy afternoon. A is tired, B is cheerful, and C is unusually quiet.",
    );
  await page.getByRole("button", { name: "Write scene", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  assert.match(
    await page.locator("#candidateText").textContent(),
    /Rain tapped/,
  );
  assert.equal(await page.locator("#editor").inputValue(), "");
  await page.waitForFunction(
    () => document.querySelectorAll("#suggestions button").length === 3,
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await page.locator("#candidateBox").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector("#editor").value.includes("Rain tapped"),
  );
  await page.waitForFunction(
    () => document.querySelectorAll("#suggestions button").length === 3,
  );
  await page.waitForFunction(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const facts = await r.query("type", "canon");
    r.dispose();
    return facts.filter((f) => f.derived).length >= 6;
  });
  const automatic = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const facts = await r.query("type", "canon"),
      people = await r.query("type", "entity");
    r.dispose();
    return {
      kinds: facts.filter((f) => f.derived).map((f) => f.recordKind),
      people: people.map((p) => p.displayName),
      sourced: facts
        .filter((f) => f.derived)
        .every((f) => f.sourceRefs[0].start != null),
    };
  });
  assert.ok(automatic.people.includes("D") && automatic.sourced);
  for (const kind of [
    "condition",
    "plan",
    "knowledge",
    "belief",
    "relationship",
    "acceptedEvent",
  ])
    assert.ok(automatic.kinds.includes(kind));
  await page.locator("[data-action=sideTab][data-tab=bible]").click();
  await page.screenshot({
    path: new URL("story-brain-desktop.png", artifacts).pathname,
    fullPage: true,
  });
  await page.locator("#suggestions button").first().click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await page.locator("#candidateBox").waitFor({ state: "hidden" });
  await page
    .locator("#direction")
    .fill("The friends decide to get ice cream, without any confrontation.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await page.locator("#candidateBox").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector("#editor").value.includes("B suggested ice cream"),
  );
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page
    .getByLabel("Play as an established person")
    .selectOption({ label: "B" });
  await page
    .getByRole("button", { name: "Enter exploration", exact: true })
    .click();
  await page.getByLabel("Your character action").waitFor();
  await page
    .getByLabel("Your character action")
    .fill("B asked for chocolate ice cream.");
  await page.getByRole("button", { name: "Act", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#rpTranscript .rpturn").length === 2 &&
      document.querySelector("#rpTranscript").textContent.includes("Chocolate"),
  );
  await page
    .getByRole("button", { name: "Keep exploration", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  let before = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const ex = (await r.query("type", "exploration"))[0],
      scene = await r.get(ex.baseSceneId),
      text = await r.sceneText(scene.id);
    r.dispose();
    return { ex, scene, text: text.text };
  });
  assert.doesNotMatch(before.text, /B asked for chocolate/);
  // Switching a minimally described supporting character leaves time and manuscript revision unchanged.
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page.getByRole("button", { name: "B · kept", exact: true }).click();
  await page
    .getByLabel("You control", { exact: true })
    .selectOption({ label: "C" });
  await page
    .getByRole("button", { name: "Keep exploration", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  const switched = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const ex = (await r.query("type", "exploration"))[0],
      scene = await r.get(ex.baseSceneId),
      turns = await r.query("parentSessionId", ex.id);
    r.dispose();
    return { ex, scene, count: turns.length };
  });
  assert.equal(
    switched.scene.currentRevisionId,
    before.scene.currentRevisionId,
  );
  assert.equal(switched.count, 2);
  assert.notEqual(switched.ex.playerCharacterId, before.ex.playerCharacterId);
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page.getByRole("button", { name: "C · kept", exact: true }).click();
  await page.getByRole("button", { name: "Keep events", exact: true }).click();
  assert.match(
    await page.getByLabel("Author established event record").inputValue(),
    /B asked for chocolate/,
  );
  await page.screenshot({
    path: new URL("event-review-desktop.png", artifacts).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: new URL("event-review-phone.png", artifacts).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByLabel("Author established event record")
    .fill("B asked for chocolate ice cream. A asked a question and C waited.");
  await page
    .getByRole("button", { name: "Accept event record", exact: true })
    .click();
  await page.locator("#modal").waitFor({ state: "hidden" });
  const eventState = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const events = await r.query("type", "canon"),
      scenes = await r.query("type", "scene");
    const text = await r.sceneText(scenes[0].id);
    r.dispose();
    return { events, text: text.text };
  });
  assert.equal(
    eventState.events.filter(
      (r) => r.recordKind === "acceptedEvent" && r.explorationId,
    ).length,
    1,
  );
  assert.equal(
    eventState.events.find(
      (r) => r.explorationId && r.recordKind === "acceptedEvent",
    ).proseInserted,
    false,
  );
  assert.equal(eventState.text, before.text);
  assert.ok(
    eventState.events.some(
      (r) =>
        r.recordKind === "knowledge" &&
        !r.derived &&
        r.explorationId &&
        r.proposition.includes("chocolate"),
    ),
  );
  await page.getByRole("button", { name: "Quick RP", exact: true }).click();
  await page
    .getByRole("button", { name: "C · eventsKept", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Turn into prose", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#candidateState").textContent === "ready" &&
      document
        .querySelector("#candidateText")
        .textContent.includes("B asked for chocolate"),
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await page.locator("#candidateBox").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector("#editor").value.includes("B asked for chocolate"),
  );
  const accepted = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const r = await Repository.open();
    const events = await r.query("type", "canon"),
      scenes = await r.query("type", "scene"),
      revisions = await r.query("type", "revision");
    const text = await r.sceneText(scenes[0].id);
    r.dispose();
    return { events, text: text.text, revisions };
  });
  assert.equal(
    accepted.events.filter(
      (r) => r.recordKind === "acceptedEvent" && r.explorationId,
    ).length,
    1,
  );
  assert.equal(
    accepted.events.find(
      (r) => r.explorationId && r.recordKind === "acceptedEvent",
    ).proseInserted,
    true,
  );
  assert.ok(accepted.revisions.some((r) => r.explorationId));
  assert.ok(accepted.revisions.length >= 5);
  await page.reload();
  await page
    .getByRole("button", { name: "Continue writing", exact: true })
    .click();
  await page.waitForFunction(
    (expected) => document.querySelector("#editor").value === expected,
    accepted.text,
  );
  assert.equal(await page.locator("#editor").inputValue(), accepted.text);
  ok(
    "Complete café journey, explicit event acceptance, adaptation, ownership, provenance and reopening",
  );
  // Exact selection replacement with Unicode, multiline source and untouched outer text.
  await page
    .getByRole("button", { name: "Writing style", exact: true })
    .click();
  await page.getByLabel("Automatic suggestions and source reading").uncheck();
  await page.getByLabel("Story Brain", { exact: true }).selectOption("off");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const source =
    "PREFIX ☕\nKeep these spaces.  \nSELECT ME\nSUFFIX 雨\n  unchanged  ";
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page.locator("#editor").fill(source);

  await page.waitForFunction(
    () =>
      document.querySelector("#saveStatus").textContent === "Saved in browser",
  );

  await page.locator("#editor").evaluate((e) => {
    const start = e.value.indexOf("SELECT ME");
    e.focus();
    e.setSelectionRange(start, start + 9);
    e.dispatchEvent(new Event("select"));
  });
  await page.locator("#direction").fill("Replace this selected sentence only.");

  await page
    .getByRole("button", { name: "Revise selection", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "ready",
  );
  await page.getByRole("button", { name: "Keep passage", exact: true }).click();
  await page.locator("#candidateBox").waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector("#editor").value.includes("雨 lingered"),
  );
  const revised = await page.locator("#editor").inputValue();
  assert.ok(revised.startsWith(source.split("SELECT ME")[0]));
  assert.ok(revised.endsWith(source.split("SELECT ME")[1]));
  assert.match(revised, /雨 lingered/);
  ok(
    "Selection replacement preserves the exact unselected Unicode prefix and suffix",
  );
  // Edit during generation keeps late output separate and stale.
  await page.locator("#direction").fill("SLOW_TEST continue gently");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#candidateState").textContent === "Writing",
  );
  await page.locator("#editor").fill(revised + "\nNEW MANUAL ENDING");
  await page.waitForFunction(
    () =>
      document.querySelector("#saveStatus").textContent === "Saved in browser",
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#candidateState")
      .textContent.includes("Source changed"),
  );
  assert.match(
    await page.locator("#editor").inputValue(),
    /NEW MANUAL ENDING$/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Keep passage", exact: true })
      .isDisabled(),
    true,
  );
  ok("A late streamed candidate cannot replace a changed manuscript");
  // Restore history produces another revision, leaving later work recoverable.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore this version", exact: true })
    .last()
    .click();
  await page.waitForFunction(
    () => document.querySelector("#editor").value === "",
  );
  assert.equal(await page.locator("#editor").inputValue(), "");
  await page.getByRole("button", { name: "History", exact: true }).click();
  const later = page
    .locator(".storycard")
    .filter({ hasText: "NEW MANUAL ENDING" });
  await later
    .getByRole("button", { name: "Restore this version", exact: true })
    .first()
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#editor").value.endsWith("NEW MANUAL ENDING"),
  );
  assert.match(
    await page.locator("#editor").inputValue(),
    /NEW MANUAL ENDING$/,
  );
  ok("Restoring history retains later versions for recovery");
  // Portable backup roundtrip, invalid inputs and changed generation.
  const backup = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const { exportBackup } = await import("/js/storage/backup.js");
    const r = await Repository.open();
    const backup = await exportBackup(r);
    r.dispose();
    return backup;
  });
  assert.ok(!JSON.stringify(backup).includes("SYNTHETIC_BROWSER_SECRET"));
  const roundtrip = await page.evaluate(async (data) => {
    const { Repository } = await import("/js/storage/repository.js");
    const { restoreBackup, exportBackup } = await import(
      "/js/storage/backup.js"
    );
    const r = await Repository.open("cozynovel.roundtrip");
    await restoreBackup(r, data);
    const actual = await exportBackup(r);
    const generation = (await r.get("library", "meta")).generation;
    const before = JSON.stringify(actual.records);
    const bad = structuredClone(data);
    bad.blobs[0].text += "corrupt";
    let rejected = false;
    try {
      await restoreBackup(r, bad);
    } catch {
      rejected = true;
    }
    const after = await exportBackup(r);
    let foreign = false;
    try {
      await restoreBackup(r, { format: "cozytavern.v1" });
    } catch {
      foreign = true;
    }
    r.dispose();
    return {
      actual,
      generation,
      rejected,
      foreign,
      unchanged: before === JSON.stringify(after.records),
    };
  }, backup);
  assert.deepEqual(roundtrip.actual.records, backup.records);
  assert.deepEqual(roundtrip.actual.blobs, backup.blobs);
  assert.notEqual(roundtrip.generation, backup.library.generation);
  assert.ok(roundtrip.rejected && roundtrip.foreign && roundtrip.unchanged);
  ok(
    "Portable backup roundtrip preserves exact records, text, branches and provenance; invalid imports are harmless",
  );
  // Isolated foreign browser resources and inert manuscript output.
  await page.evaluate(async () => {
    localStorage.setItem("foreign.sentinel", "safe");
    await caches.open("foreign.cache");
    await new Promise((resolve, reject) => {
      const q = indexedDB.open("foreign.db", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("safe");
      q.onsuccess = () => {
        q.result.close();
        resolve();
      };
      q.onerror = reject;
    });
  });
  const malicious =
    '<img src=x onerror="window.storyExecuted=true">\n<script>window.storyExecuted=true</script>';
  await page.locator("#editor").fill(malicious);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page
    .getByRole("button", { name: "Read this scene", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#readingView").hidden &&
      document.querySelector("#readingView").textContent.includes("<img"),
  );
  assert.equal(
    await page.locator("#readingView").textContent(),
    (await page.locator("#sceneTitle").textContent()) + malicious,
  );
  assert.equal(await page.evaluate(() => window.storyExecuted), undefined);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const sentinels = await page.evaluate(async () => ({
    cache: (await caches.keys()).includes("foreign.cache"),
    key: localStorage.getItem("foreign.sentinel"),
    db: (await indexedDB.databases()).some((d) => d.name === "foreign.db"),
  }));
  assert.deepEqual(sentinels, { cache: true, key: "safe", db: true });
  assert.ok(requests.every((url) => url.includes("/api/novel/")));
  ok(
    "Malicious text stays inert and foreign browser resources survive service worker activation",
  );
  // Desktop and phone interactions, drafts and composition input.
  await page.locator("#editor").fill(accepted.text);
  await page.waitForFunction(
    () =>
      document.querySelector("#saveStatus").textContent === "Saved in browser",
  );
  await page.screenshot({
    path: new URL("desktop.png", artifacts).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#editor").evaluate((e) => {
    e.dispatchEvent(new CompositionEvent("compositionstart"));
    e.value += "\n入力中 ☕";
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new CompositionEvent("compositionend"));
  });
  await page.getByRole("button", { name: "Chapters", exact: true }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  assert.match(await page.locator("#editor").inputValue(), /入力中 ☕$/);
  await page.waitForFunction(
    () =>
      document.querySelector("#saveStatus").textContent === "Saved in browser",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: new URL("phone.png", artifacts).pathname,
    fullPage: true,
  });
  ok(
    "Desktop and phone layout, draft preservation and synthetic composition events",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector("#deviceStatus")
        .textContent.includes("Saved to device through checkpoint") ||
      document.querySelector("#deviceStatus").textContent ===
        "Device up to date",
    { timeout: 15000 },
  );
  const device = await page.evaluate(async () => {
    const status = await (await fetch("/api/novel/status")).json();
    let cursor = 0,
      records = [];
    do {
      const p = await (
        await fetch("/api/novel/snapshot?cursor=" + cursor)
      ).json();
      records.push(...p.records);
      cursor = p.nextCursor;
    } while (cursor != null);
    return { status, records };
  });
  assert.ok(device.status.serverRevision > 0);
  assert.ok(
    device.records.some((r) => r.type === "revision" && r.explorationId),
  );
  ok(
    "Actual local relay and SQLite device persistence with a deterministic mock upstream",
  );
  const contracts = await page.evaluate(browserContracts);
  for (const check of contracts.checks) ok(check);
  console.log("PERFORMANCE " + JSON.stringify(contracts.performance));
  await writeFile(
    new URL("contract-report.json", artifacts),
    JSON.stringify(contracts, null, 2),
  );
  await context.setOffline(true);
  await page.locator("#editor").fill("OFFLINE_MANUAL_WRITING ☕");
  await page.waitForFunction(
    () =>
      document.querySelector("#saveStatus").textContent === "Saved in browser",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Continue writing", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("#editor").value === "OFFLINE_MANUAL_WRITING ☕",
  );
  ok(
    "Offline shell reopens and manual writing persists without any AI connection",
  );
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("browser-report.json", artifacts),
    JSON.stringify(
      {
        passes,
        errors,
        requests: requests.length,
        browser: await browser.version(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passes: passes.length,
      browser: await browser.version(),
      requests: requests.length,
    }),
  );
} catch (error) {
  console.error(error);
  if (browser) {
    for (const c of browser.contexts())
      for (const p of c.pages()) {
        await p
          .screenshot({ path: new URL("failure.png", artifacts).pathname })
          .catch(() => {});
        console.error(
          "DEVICE",
          await p
            .locator("#deviceStatus")
            .textContent()
            .catch(() => ""),
        );
        console.error(
          "OUTBOX",
          await p
            .evaluate(async () => {
              const { Repository } = await import("/js/storage/repository.js");
              const r = await Repository.open();
              const o = await r.all("outbox"),
                m = await r.get("sync", "meta");
              r.dispose();
              return {
                count: o.length,
                kinds: o
                  .slice(0, 4)
                  .map((x) => [x.kind, x.expectedServerRevision]),
                m,
              };
            })
            .catch((e) => e.message),
        );
        console.error(
          await p
            .locator("#notice")
            .textContent()
            .catch(() => ""),
        );
      }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  if (!process.exitCode) await rm(directory, { recursive: true, force: true });
  else console.error("Fixture retained at", directory);
}
