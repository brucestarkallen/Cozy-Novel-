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
  const { execFileSync } = await import("node:child_process");
  await page.route("**/legacy/**", (route) => {
    const file = new URL(route.request().url()).pathname.slice(
      "/legacy/".length,
    );
    if (!/^js\/[a-zA-Z0-9_./-]+\.js$/.test(file)) return route.abort();
    const body = execFileSync(
      "git",
      ["show", "66bc76f234689724105cc5acd495f3d5e5e8348a:" + file],
      { cwd: new URL("../../", import.meta.url) },
    );
    return route.fulfill({ body, contentType: "text/javascript" });
  });
  const result = await page.evaluate(async () => {
    const { Repository } = await import("/js/storage/repository.js");
    const { textBlob, id } = await import("/js/core/ids.js");
    const { revise, createCandidate, saveCandidate, acceptCandidate } =
      await import("/js/novel/operations.js");
    const { assemble, contextCheck } = await import("/js/context/assemble.js");
    const { serialize } = await import("/js/ai/providers/adapters.js");
    const { applyReading, undoReading } = await import("/js/story/reading.js");
    const {
      createExploration,
      addTurn,
      retryBranch,
      branchState,
      branchTurns,
      keepEvents,
      transcript,
      explorationCoverage,
    } = await import("/js/rp/session.js");
    const { exportBackup } = await import("/js/storage/backup.js");
    const { saveEntity } = await import("/js/story/entities.js");
    const check = (value, msg) => {
      if (!value) throw new Error(msg);
    };
    // Execute the exact baseline modules to seed the migration and mixed version case.
    const { Repository: OldRepository } = await import(
      "/legacy/js/storage/repository.js"
    );
    const old = await OldRepository.open("cozynovel.upgrade-test"),
      legacyNovel = await old.createNovel("Legacy", "Exact 雨 ☕\n  spaces  "),
      legacyScene = (await old.query("novelId", legacyNovel)).find(
        (r) => r.type === "scene",
      );
    const { revise: oldRevise } = await import(
      "/legacy/js/novel/operations.js"
    );
    await oldRevise(
      old,
      legacyScene.id,
      legacyScene.currentRevisionId,
      "Exact 雨 ☕\n  spaces  \nSecond recoverable revision.",
    );
    await old.update({
      id: id("canon"),
      type: "canon",
      novelId: legacyNovel,
      recordKind: "authorFact",
      proposition: "My manual fact exactly.",
      derived: false,
      status: "active",
      sourceRefs: [],
    });
    const { createCandidate: oldCreate, saveCandidate: oldSave } = await import(
      "/legacy/js/novel/operations.js"
    );
    let alternate = await oldCreate(old, {
      sceneId: legacyScene.id,
      direction: "Keep my alternate",
    });
    await oldSave(old, alternate, "ALTERNATIVE exact\n  text", "ready");
    const { saveEntity: oldEntity } = await import(
      "/legacy/js/story/entities.js"
    );
    const person = {
      id: id("entity"),
      type: "entity",
      novelId: legacyNovel,
      kind: "person",
      displayName: "B",
      aliases: [],
      profile: "Original unscoped biography",
      sourceRefs: [],
    };
    await oldEntity(old, person);
    await oldEntity(old, {
      ...(await old.get(person.id)),
      profile: "Later profile text",
    });
    const {
      createExploration: oldExplore,
      addTurn: oldTurn,
      retryBranch: oldRetry,
    } = await import("/legacy/js/rp/session.js");
    let legacyEx = await oldExplore(old, {
      sceneId: legacyScene.id,
      playerCharacterId: person.id,
      boundary: 3,
      narrativeViewpoint: "Third person",
    });
    await oldTurn(old, legacyEx, "player", "Exact dialogue");
    await oldTurn(old, legacyEx, "world", "Original response");
    legacyEx = await oldRetry(old, legacyEx);
    await oldTurn(old, legacyEx, "world", "Alternate response");
    const { keepEvents: oldKeepEvents } = await import(
      "/legacy/js/rp/session.js"
    );
    await oldKeepEvents(old, legacyEx, "Exact accepted event provenance.");
    await old.update({
      id: id("prompt"),
      type: "prompt",
      novelId: legacyNovel,
      kind: "write",
      version: 7,
      body: "My custom prompt exactly.",
    });
    await old.update({
      ...(await old.get(legacyNovel)),
      autoSuggestions: false,
    });
    const { exportBackup: oldExport } = await import(
      "/legacy/js/storage/backup.js"
    );
    const before = await oldExport(old);
    const draft = document.createElement("textarea");
    draft.value = "Unsaved visible old tab draft";
    document.body.append(draft);
    const upgraded = await Repository.open("cozynovel.upgrade-test"),
      after = await exportBackup(upgraded);
    check(
      JSON.stringify(before.records) === JSON.stringify(after.records),
      "Migration changed legacy records",
    );
    check(
      JSON.stringify(before.blobs) === JSON.stringify(after.blobs),
      "Migration changed exact bodies",
    );
    let oldBlocked = false;
    try {
      await old.update({
        ...before.records.find((r) => r.type === "novel"),
        title: "Old client write",
      });
    } catch {
      oldBlocked = true;
    }
    check(
      oldBlocked && draft.value === "Unsaved visible old tab draft",
      "Mixed version lost visible draft or allowed old write",
    );
    const { readingMode } = await import("/js/story/reading.js");
    check(
      (await readingMode(upgraded, legacyNovel)) === "off",
      "Disabled legacy preference changed",
    );
    upgraded.dispose();
    old.dispose();
    draft.remove();
    const migration = {
      exactRecords: before.records.length,
      exactBlobs: before.blobs.length,
      oldBlocked,
      disabledPreserved: true,
    };
    const r = await Repository.open("cozynovel.context-regression"),
      n = await r.createNovel("Temporal", "Opening. Ending revelation."),
      s = (await r.query("novelId", n)).find((r) => r.type === "scene");
    await r.update({
      ...s,
      fictionalTime: 1,
      summary: "FUTURE_SUMMARY",
      notes: "FUTURE_NOTE",
    });
    await saveEntity(r, {
      id: "entity_B",
      type: "entity",
      novelId: n,
      kind: "person",
      displayName: "B",
      aliases: [],
      profile: "FUTURE_PROFILE",
      invariantProfile: "STABLE_BIOGRAPHY",
      profileClaims: [
        {
          text: "FUTURE_CLAIM",
          validFrom: 20,
          sourceRefs: [{ id: s.currentRevisionId, start: 9, end: 26 }],
        },
      ],
      sourceRefs: [],
    });
    await saveEntity(r, {
      id: "entity_A",
      type: "entity",
      novelId: n,
      kind: "person",
      displayName: "A",
      aliases: [],
      profile: "",
      sourceRefs: [],
    });
    for (const [kind, prop, time, holder] of [
      ["knowledge", "FUTURE_KNOWLEDGE", 20, "entity_B"],
      ["relationship", "FUTURE_RELATIONSHIP", 20, null],
      ["condition", "FUTURE_CONDITION", 20, null],
      ["memory", "FUTURE_MEMORY", 20, null],
      ["secret", "ELIGIBLE_PRIVATE_SECRET", 0, "entity_A"],
      ["belief", "ELIGIBLE_FALSE_SUSPICION", 0, "entity_B"],
      ["plan", "CONDITIONAL_FUTURE_INTENTION if rain continues", 0, "entity_B"],
    ])
      await r.update({
        id: id("canon"),
        type: "canon",
        novelId: n,
        recordKind: kind,
        proposition: prop,
        holderId: holder,
        status: "active",
        validFrom: time,
        sourceRefs: [{ id: s.currentRevisionId, start: 0, end: 8 }],
      });
    await r.update({
      id: id("canon"),
      type: "canon",
      novelId: n,
      recordKind: "acceptedEvent",
      proposition: "FUTURE_EXPLORATION_EVENT",
      baseSceneId: s.id,
      entryBoundary: 20,
      status: "active",
      sourceRefs: [{ id: s.currentRevisionId, start: 9, end: 26 }],
    });
    const ex = await createExploration(r, {
      sceneId: s.id,
      playerCharacterId: "entity_B",
      boundary: 8,
      narrativeViewpoint: "B limited",
    });
    const connection = {
      adapter: "chat",
      model: "fixture",
      contextLimit: 32000,
      outputLimit: 1000,
    };
    const opts = {
      novelId: n,
      sceneId: s.id,
      kind: "rp",
      exploration: ex,
      direction: "Act",
      connection,
    };
    const earlier = await assemble(r, opts),
      wire = JSON.stringify(serialize(connection, earlier));
    for (const token of [
      "FUTURE_SUMMARY",
      "FUTURE_NOTE",
      "FUTURE_PROFILE",
      "FUTURE_CLAIM",
      "FUTURE_KNOWLEDGE",
      "FUTURE_RELATIONSHIP",
      "FUTURE_CONDITION",
      "FUTURE_MEMORY",
      "FUTURE_EXPLORATION_EVENT",
    ])
      check(!wire.includes(token), "Historical leak: " + token);
    for (const token of [
      "STABLE_BIOGRAPHY",
      "ELIGIBLE_PRIVATE_SECRET",
      "ELIGIBLE_FALSE_SUSPICION",
      "CONDITIONAL_FUTURE_INTENTION",
    ])
      check(
        wire.includes(token),
        "Eligible historical state missing: " + token,
      );
    // The exploration baseline remains stable after live novel changes.
    await r.update({
      ...(await r.get(s.id)),
      notes: "Changed live notes",
      fictionalTime: 40,
    });
    check(
      (await contextCheck(r, earlier.snapshot)).current,
      "Live edits changed saved exploration baseline",
    );
    const writing = {
      novelId: n,
      sceneId: s.id,
      kind: "write",
      direction: "Write",
      connection,
    };
    let snap = await assemble(r, writing);
    await r.update({
      ...(await r.get(s.id)),
      viewpoint: "Changed only metadata",
    });
    check(
      !(await contextCheck(r, snap.snapshot)).current,
      "Metadata freshness missed",
    );
    snap = await assemble(r, writing);
    await r.update({
      id: id("canon"),
      type: "canon",
      novelId: n,
      recordKind: "authorFact",
      proposition: "New applicable fact",
      status: "active",
      sourceRefs: [],
    });
    check(
      !(await contextCheck(r, snap.snapshot)).current,
      "New source freshness missed",
    );
    snap = await assemble(r, writing);
    await r.update({
      id: id("prompt"),
      type: "prompt",
      novelId: n,
      kind: "write",
      version: 99,
      body: "New prompt",
    });
    check(
      !(await contextCheck(r, snap.snapshot)).current,
      "Prompt freshness missed",
    );
    snap = await assemble(r, writing);
    await r.update({
      id: id("receipt"),
      type: "receipt",
      novelId: n,
      state: "completed",
      usage: { input: 42 },
    });
    check(
      (await contextCheck(r, snap.snapshot)).current,
      "Receipt self invalidated request",
    );
    const verified = await contextCheck(r, snap.snapshot);
    await r.update({
      ...(await r.get(s.id)),
      timeLabel: "A material change in the check/apply interval",
    });
    let fenced = false;
    try {
      await r.commit({
        novelId: n,
        kind: "test.publish",
        records: [
          {
            id: id("artifact"),
            type: "artifact",
            novelId: n,
            kind: "analysis",
            body: {},
          },
        ],
        contextPrecondition: verified.precondition,
      });
    } catch {
      fenced = true;
    }
    check(fenced, "Transactional freshness gap remained");
    const historical = {
      allSurfacesFiltered: true,
      stableBiographyRetained: true,
      privateOwnersRetained: true,
      savedBaselineStable: true,
      transactionFence: fenced,
      receiptDoesNotInvalidate: true,
    };
    // One typed source reading with more than three facts and an unresolved identity.
    const text =
      "D arrived. B promised help if rain continued. B finished ordering. C learned the letter was missing. D suspected coins. A felt tired. A trusted B.";
    const current = await r.sceneText(s.id);
    const rev = await revise(r, s.id, current.revision.id, text);
    const ids = ["entity_A", "entity_B"];
    await saveEntity(r, {
      id: "entity_C",
      type: "entity",
      novelId: n,
      kind: "person",
      displayName: "C",
      aliases: [],
      profile: "",
      sourceRefs: [],
    });
    const quotes = [
      "B promised help if rain continued.",
      "B finished ordering.",
      "C learned the letter was missing.",
      "D suspected coins.",
      "A felt tired.",
      "A trusted B.",
    ];
    const definitions = [
      ["plan", "entity_B", "entity_B"],
      ["acceptedEvent", null, "entity_B"],
      ["knowledge", "entity_C", "entity_C"],
      ["belief", "newD", "newD"],
      ["condition", null, "entity_A"],
      ["relationship", null, "entity_A"],
    ];
    const artifact = {
      id: id("artifact"),
      type: "artifact",
      novelId: n,
      sceneId: s.id,
      kind: "analysis",
      baseRevisionId: rev.id,
      freshness: "fresh",
      sourceRefs: [{ id: rev.id }],
      coverage: {
        start: 0,
        end: text.length,
        sourceLength: text.length,
        complete: true,
      },
      body: {
        suggestions: ["IGNORED_POSSIBILITY"],
        entities: [
          { key: "newD", name: "D", kind: "person", quote: "D arrived." },
        ],
        updates: definitions
          .map(([recordKind, holderRef, subjectRef], i) => ({
            recordKind,
            holderRef,
            subjectRef,
            quote: quotes[i],
            proposition: quotes[i],
            support: "explicit",
          }))
          .concat([
            {
              recordKind: "knowledge",
              holderRef: "unresolved",
              proposition: "Unknown person learns",
              quote: quotes[2],
              support: "explicit",
            },
          ]),
        summary: "Source linked summary",
      },
    };
    await r.update(artifact);
    const batch = await applyReading(r, artifact.id),
      duplicate = await applyReading(r, artifact.id);
    const applied = await Promise.all(
        batch.body.appliedIds.map((id) => r.get(id)),
      ),
      facts = applied.filter((r) => r.type === "canon");
    check(
      facts.length === 6 &&
        batch.body.reviews.length === 1 &&
        duplicate.id === batch.id,
      "Typed reading incomplete or duplicate",
    );
    check(
      !facts.some((r) => r.proposition === "IGNORED_POSSIBILITY"),
      "Suggestion became canon",
    );
    const completionText = text + " B completed the promised help.";
    const completionRevision = await revise(r, s.id, rev.id, completionText);
    const plan = facts.find((f) => f.recordKind === "plan");
    const completion = {
      ...artifact,
      id: id("artifact"),
      baseRevisionId: completionRevision.id,
      sourceRefs: [{ id: completionRevision.id }],
      coverage: {
        start: text.length,
        end: completionText.length,
        sourceLength: completionText.length,
        complete: true,
      },
      body: {
        entities: [],
        suggestions: [],
        updates: [
          {
            recordKind: "plan",
            subjectRef: "entity_B",
            holderRef: "entity_B",
            quote: "B completed the promised help.",
            proposition: "B completed the promised help.",
            support: "explicit",
            planState: "completed",
            supersedes: plan.id,
          },
        ],
        summary: "",
      },
    };
    await r.update(completion);
    const completedBatch = await applyReading(r, completion.id);
    check(
      (await r.get(plan.id)).status === "superseded" &&
        (
          await Promise.all(
            completedBatch.body.appliedIds.map((key) => r.get(key)),
          )
        ).some((f) => f.planState === "completed"),
      "Completed plan did not supersede its standing derived step",
    );
    await undoReading(r, completedBatch.id);
    check(
      (await r.get(plan.id)).status === "active",
      "Undo did not recover prior plan state",
    );
    await revise(r, s.id, completionRevision.id, text);
    await undoReading(r, batch.id);
    await applyReading(r, artifact.id);
    check((await r.get(batch.id)).state === "undone", "Undo was recreated");
    const changedArtifact = {
      ...artifact,
      baseRevisionId: (await r.get(s.id)).currentRevisionId,
      id: id("artifact"),
      body: {
        ...artifact.body,
        entities: [],
        updates: [
          {
            recordKind: "plan",
            subjectRef: "entity_B",
            quote: quotes[0],
            proposition: "Manually corrected promise",
            support: "explicit",
            supersedes: facts[0].id,
          },
        ],
        summary: "",
      },
    };
    await r.update({
      ...(await r.get(facts[0].id)),
      derived: false,
      status: "active",
      proposition: "Manual declaration",
    });
    await r.update(changedArtifact);
    const manual = await applyReading(r, changedArtifact.id);
    check(
      manual.body.reviews.length === 1 &&
        (await r.get(facts[0].id)).proposition === "Manual declaration",
      "Reading changed manual truth",
    );
    // Partial coverage stays explicit, and evidence outside the read segment is reviewable.
    const partial = {
      ...artifact,
      baseRevisionId: (await r.get(s.id)).currentRevisionId,
      id: id("artifact"),
      coverage: {
        start: 0,
        end: 10,
        sourceLength: text.length,
        complete: false,
      },
      body: {
        suggestions: [],
        entities: [],
        updates: [
          {
            recordKind: "condition",
            proposition: "Not yet read",
            quote: quotes[4],
            support: "explicit",
          },
        ],
      },
    };
    await r.update(partial);
    const pending = await applyReading(r, partial.id);
    check(
      !pending.body.coverage.complete && pending.body.reviews.length === 1,
      "Unprocessed coverage disappeared",
    );
    const story = {
      typedFacts: facts.length,
      newPersonWithoutBiography: true,
      unresolvedReview: batch.body.reviews.length,
      idempotent: true,
      undoDurable: true,
      manualCorrectionPreserved: true,
      pendingCoverageRetained: true,
      completedPlanAndUndo: true,
    };
    const { analyze } = await import("/js/ai/analysis.js");
    let malformed = false;
    try {
      await analyze(
        {
          repo: r,
          run: async () => ({
            text: "{invalid JSON",
            sourceRevisionId: (await r.get(s.id)).currentRevisionId,
          }),
        },
        { novelId: n, sceneId: s.id, connection },
      );
    } catch {
      malformed = true;
    }
    check(
      malformed &&
        (await r.query("novelId", n)).some(
          (a) =>
            a.kind === "readingTask" &&
            a.state === "failed" &&
            a.coverage.end === 0,
        ) &&
        (await r.sceneText(s.id)).text === text,
      "Malformed helper lost coverage or changed manuscript",
    );
    story.malformedHelperRetainsCoverage = true;
    // Branch ownership, scoped introduced people and exact event/adaptation boundaries.
    let explore = await createExploration(r, {
      sceneId: s.id,
      newPerson: "Exploration person",
      boundary: text.length,
      narrativeViewpoint: "Third person",
    });
    check(
      (await r.get(explore.playerCharacterId)).scope === "exploration",
      "Introductory person leaked",
    );
    await addTurn(r, explore, "player", "I ask about the letter.");
    const abandoned = await addTurn(
      r,
      explore,
      "world",
      "A person named Ghost arrived. ABANDONED_SECRET_RESPONSE",
    );
    const abandonedTurns = await branchTurns(r, explore),
      abandonedText = await transcript(r, explore, { full: true }),
      exBlob = await textBlob(abandonedText);
    const branchReading = {
      id: id("artifact"),
      type: "artifact",
      novelId: n,
      sceneId: s.id,
      kind: "analysis",
      explorationId: explore.id,
      branchId: explore.activeBranchId,
      coveredTurnIds: abandonedTurns.map((t) => t.id),
      baseRevisionId: explore.baseRevisionId,
      textBlobId: exBlob.id,
      freshness: "fresh",
      sourceRefs: [{ id: explore.id }],
      coverage: {
        start: 0,
        end: abandonedText.length,
        sourceLength: abandonedText.length,
        complete: true,
      },
      body: {
        suggestions: [],
        entities: [
          {
            key: "ghost",
            name: "Ghost",
            kind: "person",
            quote: "A person named Ghost arrived.",
          },
        ],
        updates: [
          {
            recordKind: "condition",
            subjectRef: explore.playerCharacterId,
            proposition: "ABANDONED_STATE",
            quote: "ABANDONED_SECRET_RESPONSE",
            support: "explicit",
          },
        ],
        summary: "ABANDONED_BRANCH_SUMMARY",
      },
    };
    await r.commit({
      novelId: n,
      kind: "test.branch.reading",
      records: [branchReading],
      blobs: [exBlob],
    });
    await applyReading(r, branchReading.id);
    check(
      (await branchState(r, explore, abandonedTurns)).claims.some(
        (c) => c.proposition === "ABANDONED_STATE",
      ),
      "Branch state was not structured",
    );
    explore = await retryBranch(r, explore);
    await addTurn(r, explore, "world", "Replacement response.");
    const chosen = await branchTurns(r, explore);
    check(
      !chosen.some((t) => t.id === abandoned.id),
      "Retry retained abandoned response",
    );
    const branchBefore = await branchState(r, explore, chosen);
    check(
      !branchBefore.claims.some((c) => c.proposition === "ABANDONED_STATE"),
      "Retry included abandoned knowledge or consequences",
    );
    await r.update({ ...explore, playerCharacterId: "entity_B" });
    explore = await r.get(explore.id);
    const branchAfter = await branchState(
      r,
      explore,
      await branchTurns(r, explore),
    );
    check(
      JSON.stringify(branchBefore.turnIds) ===
        JSON.stringify(branchAfter.turnIds) &&
        branchBefore.fictionalTime === branchAfter.fictionalTime,
      "Switch advanced story",
    );
    const coverage = await explorationCoverage(r, explore);
    const kept = await keepEvents(r, explore, "Author keeps selected events", {
      coverage,
    });
    check(
      (await r.sceneText(s.id)).text === text,
      "Keep events inserted prose",
    );
    await addTurn(
      r,
      explore,
      "player",
      "Later action outside accepted coverage",
    );
    check(
      JSON.stringify((await r.get(kept.id)).coveredTurnIds) ===
        JSON.stringify(coverage.coveredTurnIds),
      "Later continuation expanded provenance",
    );
    const long = await addTurn(
      r,
      explore,
      "world",
      "Long response ".repeat(3000),
    );
    const bounded = await transcript(r, explore, { budget: 8000 });
    check(
      bounded.length < 10000 && !bounded.includes("ABANDONED_SECRET_RESPONSE"),
      "Long transcript exceeded budget or included abandoned branch",
    );
    const fullSource = await transcript(r, explore, { full: true }),
      fullCoverage = await explorationCoverage(r, explore);
    let readingStart = 0,
      segments = 0,
      maxStoredSegment = 0;
    while (readingStart < fullSource.length) {
      const a = await analyze(
        {
          repo: r,
          run: async (opts) => ({
            text: JSON.stringify({
              suggestions: [],
              entities: [],
              updates: [],
              summary: "A bounded source segment.",
              coverageEnd: opts.readingSegment[1],
            }),
            sourceRevisionId: explore.baseRevisionId,
            finishReason: "stop",
          }),
        },
        {
          novelId: n,
          sceneId: s.id,
          exploration: explore,
          sourceText: fullSource,
          sourceTurnSpans: fullCoverage.sourceTurnSpans,
          coveredTurnIds: fullCoverage.coveredTurnIds,
          readingStart,
          connection,
        },
      );
      check(a.coverage.end > readingStart, "Coverage failed to advance");
      readingStart = a.coverage.end;
      segments++;
      maxStoredSegment = Math.max(
        maxStoredSegment,
        (await r.text(a.textBlobId)).length,
      );
      check(segments < 10, "Unbounded reading loop");
    }
    check(
      maxStoredSegment <= 12000 &&
        !(
          await branchState(r, explore, await branchTurns(r, explore))
        ).unreadTurnIds.includes(long.id),
      "Segment storage or merged turn coverage failed",
    );
    let adaptation = await createCandidate(r, {
      sceneId: s.id,
      direction: "Adapt only the kept boundary",
      kind: "adapt",
      extra: {
        explorationId: explore.id,
        ...coverage,
        transcriptSource: "Selected original branch prefix",
      },
    });
    adaptation = await saveCandidate(
      r,
      adaptation,
      "Accepted selected exploration events.",
      "ready",
    );
    await acceptCandidate(r, adaptation.id);
    const ghost = (await r.query("novelId", n)).find(
      (e) => e.type === "entity" && e.displayName === "Ghost",
    );
    check(
      ghost.scope === "exploration",
      "Adaptation promoted abandoned branch identity",
    );
    check(
      JSON.stringify((await r.get(adaptation.id)).coveredTurnIds) ===
        JSON.stringify(coverage.coveredTurnIds),
      "Adaptation source expanded",
    );
    const exploration = {
      introducedPersonScoped: true,
      retryExcludesAbandoned: true,
      structuredStateExcluded: true,
      abandonedIdentityNotPromoted: true,
      switchNoEvent: true,
      eventsDoNotInsertProse: true,
      exactCoverageStable: true,
      boundedTranscriptCharacters: bounded.length,
      readingSegments: segments,
      maximumStoredReadingCharacters: maxStoredSegment,
      completeTurnCoverageMerged: true,
    };
    await r.update({
      id: id("prompt"),
      type: "prompt",
      novelId: n,
      kind: "discuss",
      version: 1,
      body: n,
    });
    const { restoreBackup: copyBackup } = await import("/js/storage/backup.js");
    const copyData = await exportBackup(r, n),
      copied = await copyBackup(r, copyData, { copy: true });
    check(
      (await r.query("novelId", copied)).some(
        (p) => p.type === "prompt" && p.body === n,
      ),
      "Copy remapping changed literal text matching an ID",
    );
    const olderTab = await Repository.open("cozynovel.context-regression"),
      portable = await exportBackup(r),
      pointer = (await r.query("novelId", n)).find((s) => s.type === "scene");
    const { restoreBackup } = await import("/js/storage/backup.js");
    const untouched = JSON.stringify((await exportBackup(r)).records);
    let futureRejected = false;
    try {
      await restoreBackup(r, { ...portable, schemaVersion: 999 });
    } catch {
      futureRejected = true;
    }
    check(
      futureRejected &&
        JSON.stringify((await exportBackup(r)).records) === untouched,
      "Future backup changed existing work",
    );
    migration.futureRejected = true;
    await restoreBackup(r, portable);
    let oldGenerationBlocked = false;
    try {
      await revise(
        olderTab,
        pointer.id,
        pointer.currentRevisionId,
        "Old tab must retain this draft",
      );
    } catch {
      oldGenerationBlocked = true;
    }
    check(
      oldGenerationBlocked,
      "Old manual writer bypassed restored generation",
    );
    olderTab.dispose();
    migration.oldGenerationBlocked = true;
    r.dispose();
    return { migration, historical, story, exploration };
  });
  console.log(JSON.stringify(result, null, 2));
  await writeFile(
    new URL("corrections-regressions.json", artifacts),
    JSON.stringify(result, null, 2),
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
