export async function browserContracts() {
  const { Repository } = await import("/js/storage/repository.js");
  const {
    createCandidate,
    saveCandidate,
    acceptCandidate,
    revise,
    addChapter,
    updateScene,
  } = await import("/js/novel/operations.js");
  const { createExploration, addTurn, retryBranch, transcript, keepEvents } =
    await import("/js/rp/session.js");
  const { saveEntity } = await import("/js/story/entities.js");
  const { assemble } = await import("/js/context/assemble.js");
  const { analyze } = await import("/js/ai/analysis.js");
  const { id } = await import("/js/core/ids.js");
  const { exportBackup, restoreBackup } = await import("/js/storage/backup.js");
  const r = await Repository.open("cozynovel.contracts");
  const checks = [];
  const check = (ok, name) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
  try {
    const n = await r.createNovel("Contracts", "Original ☕\n"),
      scene = (await r.query("novelId", n)).find((x) => x.type === "scene"),
      original = scene.currentRevisionId;
    let first = await createCandidate(r, {
      sceneId: scene.id,
      requestId: "one",
      direction: "first",
    });
    first = await saveCandidate(r, first, "ALPHA kept prose", "ready");
    let second = await createCandidate(r, {
      sceneId: scene.id,
      requestId: "two",
      direction: "another",
    });
    second = await saveCandidate(r, second, "UNACCEPTED_BETA", "ready");
    await acceptCandidate(r, first.id);
    let rejected = false;
    try {
      await acceptCandidate(r, second.id);
    } catch {
      rejected = true;
    }
    check(
      rejected &&
        (await r.text((await r.get(second.id)).textBlobId)) ===
          "UNACCEPTED_BETA",
      "Alternate candidate remains recoverable after stale insertion is rejected",
    );
    let late = await createCandidate(r, {
      sceneId: scene.id,
      baseRevisionId: original,
      requestId: "late",
      direction: "old snapshot",
    });
    late = await saveCandidate(r, late, "LATE_RESULT", "ready");
    check(
      late.baseRevisionId === original && late.status === "stale",
      "Candidate creation stays attached to the assembled source even after intervening edits",
    );
    const entity = {
      id: id("entity"),
      type: "entity",
      novelId: n,
      kind: "person",
      displayName: "B",
      aliases: [],
      profile: "",
      sourceRefs: [],
    };
    await saveEntity(r, entity);
    await saveEntity(r, await r.get(entity.id), {
      displayName: "Bee",
      profile: "Observant",
    });
    check(
      (await r.query("novelId", n)).filter((x) => x.kind === "entityProfile")
        .length === 2 && (await r.get(entity.id)).displayName === "Bee",
      "Entity rename retains identity and immutable profile history",
    );
    const current = await r.sceneText(scene.id);
    let ex = await createExploration(r, {
      sceneId: scene.id,
      playerCharacterId: entity.id,
      boundary: current.text.length,
      narrativeViewpoint: "Third person",
    });
    await addTurn(r, ex, "player", "Ask about the garden");
    await addTurn(r, ex, "world", "EXPLORATION_SECRET_abc");
    const branch = ex.activeBranchId;
    ex = await retryBranch(r, ex);
    await addTurn(r, ex, "world", "ALTERNATE_EXPLORATION_xyz");
    check(
      (await transcript(r, ex)).includes("ALTERNATE_EXPLORATION_xyz") &&
        !(await transcript(r, ex)).includes("EXPLORATION_SECRET_abc"),
      "Retry branches from the correct prior turn",
    );
    check(
      (await transcript(r, { ...ex, activeBranchId: branch })).includes(
        "EXPLORATION_SECRET_abc",
      ),
      "Earlier exploration continuation remains recoverable",
    );
    await r.update({ ...ex, status: "discarded" }, "exploration.discard");
    const conn = {
      id: "primary",
      adapter: "chat",
      model: "fixture",
      contextLimit: 32000,
      outputLimit: 1000,
      capabilities: {},
    };
    const context = await assemble(r, {
      novelId: n,
      sceneId: scene.id,
      kind: "write",
      direction: "Continue",
      connection: conn,
    });
    check(
      !context.user.includes("EXPLORATION_SECRET_abc") &&
        !context.user.includes("ALTERNATE_EXPLORATION_xyz") &&
        !context.user.includes("UNACCEPTED_BETA"),
      "Discarded branches and unaccepted candidates never become ordinary writing context",
    );
    const memory = {
      id: id("canon"),
      type: "canon",
      novelId: n,
      recordKind: "memory",
      proposition: "The original passage contained a cup.",
      status: "active",
      derived: true,
      sourceRefs: [{ id: first.id }],
    };
    const fact = {
      id: id("canon"),
      type: "canon",
      novelId: n,
      recordKind: "authorFact",
      proposition: "The town is near the sea.",
      status: "active",
      derived: false,
      sourceRefs: [],
    };
    await r.commit({
      novelId: n,
      kind: "fixture.records",
      records: [memory, fact],
    });
    const before = await r.sceneText(scene.id);
    await revise(r, scene.id, before.revision.id, "Changed accepted source");
    check(
      (await r.get(memory.id)).status === "stale" &&
        (await r.get(fact.id)).status === "active",
      "Source edits stale candidate linked derived memories and retain explicit author facts",
    );
    const staleAnalysis = await analyze(
      {
        repo: r,
        run: async () => ({
          text: JSON.stringify({
            suggestions: ["IGNORED_SUGGESTION_abc"],
            memories: [],
          }),
          stale: false,
          sourceRevisionId: before.revision.id,
        }),
      },
      { novelId: n, sceneId: scene.id, connection: conn },
    );
    check(
      staleAnalysis.freshness === "stale",
      "Late analysis cannot replace the newer story state",
    );
    const newContext = await assemble(r, {
      novelId: n,
      sceneId: scene.id,
      kind: "write",
      direction: "Continue",
      connection: conn,
    });
    check(
      !newContext.user.includes("IGNORED_SUGGESTION_abc") &&
        !newContext.user.includes(memory.proposition),
      "Ignored suggestions and stale memory are excluded from novel truth",
    );
    const opCount = (await r.query("type", "job")).length;
    check(
      opCount === 0,
      "Minimally described people do not trigger an audit or paid job loop",
    );
    const snapshot = await exportBackup(r, n);
    const copy = await restoreBackup(r, snapshot, { copy: true });
    const copied = await r.query("novelId", copy);
    check(
      copy !== n &&
        copied.every((x) => x.novelId === copy) &&
        copied.filter((x) => x.type === "turn").length === 3,
      "Import as a copy remaps ownership while retaining exploration branches",
    );
    const tx = await r.get("library", "meta");
    let oldRejected = false;
    try {
      await r.commit({
        novelId: n,
        kind: "old",
        records: [],
        generation: "old-generation",
      });
    } catch {
      oldRejected = true;
    }
    check(
      oldRejected &&
        (await r.get("library", "meta")).generation === tx.generation,
      "Old generation jobs cannot write into a restored library",
    );
    const beforeForeign = (await r.query("type", "novel")).length;
    let foreign = false;
    try {
      await r.commit({
        novelId: n,
        kind: "foreign",
        records: [{ ...(await r.get(copy)), title: "Wrong owner" }],
      });
    } catch {
      foreign = true;
    }
    check(
      foreign && (await r.query("type", "novel")).length === beforeForeign,
      "Cross novel writes are rejected atomically",
    );
    const { Writer } = await import("/js/ai/jobs.js");
    const server = await (await fetch("/api/novel/status")).json();
    const writer = new Writer(r, {
      token: server.sessionToken,
      api: async (path, { body }) =>
        fetch("/api/novel/" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CozyNovel-Session": server.sessionToken,
          },
          body: JSON.stringify(body),
        }),
    });
    let cancelled;
    try {
      await writer.run({
        connection: server.connections.find((c) => c.id === "primary"),
        novelId: n,
        sceneId: scene.id,
        kind: "rp",
        direction: "SLOW_TEST",
        exploration: ex,
        transcript: "SLOW_TEST player action",
        onDelta: () => writer.cancel(),
      });
    } catch (e) {
      cancelled = e;
    }
    const partialJob = (await r.query("novelId", n)).find(
      (j) => j.type === "job" && j.id === cancelled?.jobId,
    );
    check(
      partialJob?.state === "interrupted" &&
        !!(await r.text(partialJob.textBlobId)),
      "Cancelled exploration output is checkpointed with its original branch ownership",
    );
    const interrupted = {
      ...partialJob,
      id: id("job"),
      requestId: id("request"),
      state: "running",
    };
    await r.update(interrupted, "fixture.crash");
    await writer.recoverInterrupted();
    check(
      (await r.get(interrupted.id)).state === "interrupted" &&
        !!(await r.text((await r.get(interrupted.id)).textBlobId)),
      "Reopening exposes interrupted jobs and preserves their partial text without retrying",
    );
    const start = performance.now();
    const perf = await r.createNovel(
      "Performance fixture",
      "Rain at the window. ".repeat(10000),
    );
    const perfScene = (await r.query("novelId", perf)).find(
      (x) => x.type === "scene",
    );
    const openStart = performance.now();
    await r.sceneText(perfScene.id);
    const openMs = performance.now() - openStart;
    const editStart = performance.now();
    await revise(
      r,
      perfScene.id,
      perfScene.currentRevisionId,
      "Rain at the window. ".repeat(10000) + "END",
    );
    const editMs = performance.now() - editStart;
    const beforeMove = await r.sceneText(perfScene.id),
      oldChapter = await r.get(perfScene.chapterId),
      newChapter = await addChapter(r, perf, "Moved chapter");
    await updateScene(r, await r.get(perfScene.id), {
      chapterId: newChapter.id,
    });
    const afterMove = await r.sceneText(perfScene.id);
    check(
      afterMove.text === beforeMove.text &&
        afterMove.revision.id === beforeMove.revision.id &&
        !(await r.get(oldChapter.id)).orderedSceneIds.includes(perfScene.id) &&
        (await r.get(newChapter.id)).orderedSceneIds.includes(perfScene.id),
      "Moving a scene updates both chapter orders atomically without changing text or chronology",
    );
    return {
      checks,
      performance: {
        fixtureCharacters: 200000,
        sceneOpenMs: Math.round(openMs * 100) / 100,
        revisionSaveMs: Math.round(editMs * 100) / 100,
        setupAndChecksMs: Math.round(performance.now() - start),
      },
    };
  } finally {
    r.dispose();
  }
}
