import { now } from "../core/ids.js";
import { analyze } from "./analysis.js";
import { applyReading, readingMode } from "../story/reading.js";
// Durable source owned work. Navigation is never a source selector for this queue.
export class ReadingQueue {
  constructor(app) {
    this.app = app;
    this.repo = app.repo;
    this.disposed = false;
    this.busy = false;
    this.requested = false;
  }
  async recoverOnOpen() {
    const held = await globalThis.navigator?.locks?.query();
    if (held?.held.some((lock) => lock.name === "cozynovel.helper")) return;
    const tasks = (await this.repo.query("type", "artifact")).filter(
      (a) =>
        ["readingQueue", "readingTask"].includes(a.kind) &&
        ["queued", "running"].includes(a.state),
    );
    for (const a of tasks)
      await this.repo.withMutation(async () => {
        const latest = await this.repo.get(a.id);
        if (!["queued", "running"].includes(latest?.state)) return;
        await this.repo.commitLocked({
          novelId: a.novelId,
          kind: "reading.recover",
          expectedRecord: { id: a.id, version: latest.recordVersion || 0 },
          records: [
            {
              ...latest,
              state: "pending",
              error:
                "Library reopened. Resume this exact source reading when ready. No paid request was restarted.",
            },
          ],
        });
      });
  }
  async enqueue(op) {
    if (op.libraryGeneration !== this.repo.generation) return;
    const owned = await this.repo.query("novelId", op.novelId);
    if ((await readingMode(this.repo, op.novelId)) === "off") return;
    const revisions = owned.filter(
      (r) => r.type === "revision" && op.affectedIds?.includes(r.id),
    );
    for (const r of revisions) {
      if (
        ![
          "author",
          "candidate.accept",
          "selection.replace",
          "revision.restore",
        ].includes(op.kind)
      )
        continue;
      const key = "artifact_readqueue_" + r.id;
      const existing = await this.repo.get(key);
      const prior = owned.filter(
        (a) =>
          a.kind === "analysis" &&
          a.freshness === "fresh" &&
          (r.candidateId
            ? a.candidateId === r.candidateId
            : a.baseRevisionId === r.id),
      );
      for (const a of prior) await applyReading(this.repo, a.id);
      if (existing) continue;
      const end = Math.max(0, ...prior.map((a) => a.coverage?.end || 0));
      const sourceRecord = r.candidateId
        ? await this.repo.get(r.candidateId)
        : r;
      const sourceLength = (await this.repo.text(sourceRecord.textBlobId))
        .length;
      await this.repo.commit({
        novelId: r.novelId,
        kind: "reading.queue",
        records: [
          {
            id: key,
            type: "artifact",
            novelId: r.novelId,
            sceneId: r.ownerId,
            kind: "readingQueue",
            libraryGeneration: this.repo.generation,
            state: prior.some((a) => a.coverage?.complete)
              ? "completed"
              : "queued",
            baseRevisionId: r.id,
            candidateId: r.candidateId || null,
            coverage: {
              start: end,
              end,
              sourceLength,
              complete: prior.some((a) => a.coverage?.complete),
            },
            sourceRefs: [{ id: r.id }],
            createdAt: now(),
          },
        ],
      });
    }
    this.schedule(op.kind === "author" ? 2000 : 100);
  }
  schedule(delay = 100) {
    if (this.disposed) return;
    this.requested = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.drain().catch((e) => this.app.readingNotice?.(e)),
      delay,
    );
  }
  async drain() {
    if (this.disposed || this.busy) return;
    if (this.app.writer.foreground || this.app.writer.helper) {
      this.schedule(500);
      return;
    }
    this.busy = true;
    this.requested = false;
    try {
      const queue = (await this.repo.query("type", "artifact"))
        .filter((t) => t.kind === "readingQueue" && t.state === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (let task of queue) {
        if (this.disposed || this.app.writer.foreground) break;
        const scene = await this.repo.get(task.sceneId);
        if (
          !task.candidateId &&
          scene.currentRevisionId !== task.baseRevisionId
        ) {
          await this.repo.update(
            { ...task, state: "superseded" },
            "reading.queue.obsolete",
          );
          continue;
        }
        if ((await readingMode(this.repo, task.novelId)) === "off") {
          await this.repo.update(
            { ...task, state: "paused" },
            "reading.queue.paused",
          );
          continue;
        }
        const connection = await this.app.requestConnection(true, task.novelId);
        if (!connection.model) {
          await this.repo.update(
            {
              ...task,
              state: "paused",
              error: "Select a connection, then resume this source reading.",
            },
            "reading.queue.paused",
          );
          continue;
        }
        task = { ...task, state: "running" };
        await this.repo.update(task, "reading.queue.start");
        let start = task.coverage.end || 0;
        try {
          for (let i = 0; i < 3; i++) {
            const a = await analyze(this.app.writer, {
              novelId: task.novelId,
              sceneId: task.sceneId,
              candidateId: task.candidateId,
              sourceRevisionId: task.baseRevisionId,
              readingStart: start,
              connection: await this.app.requestConnection(true, task.novelId),
            });
            task = {
              ...(await this.repo.get(task.id)),
              coverage: a.coverage,
              state: a.coverage.complete ? "completed" : "pending",
              artifactId: a.id,
            };
            await this.repo.update(task, "reading.queue.progress");
            this.app.readingUpdated?.(a);
            if (
              a.freshness === "stale" ||
              a.error ||
              a.coverage.complete ||
              a.coverage.end <= start
            )
              break;
            start = a.coverage.end;
            if (this.app.writer.foreground) break;
          }
        } catch (e) {
          await this.repo.update(
            {
              ...(await this.repo.get(task.id)),
              state: "pending",
              error: e.message,
            },
            "reading.queue.interrupted",
          );
          this.app.readingNotice?.(e);
        }
      }
    } finally {
      this.busy = false;
      if (this.requested) this.schedule();
    }
  }
  async resume(a) {
    if (a.kind === "readingQueue") {
      await this.repo.update(
        {
          ...a,
          state: "queued",
          libraryGeneration: this.repo.generation,
          error: null,
        },
        "reading.queue.resume",
      );
      this.schedule();
      return;
    }
    const scene = await this.repo.get(a.sceneId);
    if (
      !a.candidateId &&
      !a.explorationId &&
      scene.currentRevisionId !== a.baseRevisionId
    )
      throw new Error(
        "The original reading source changed. Compare its preserved revision before reading the current scene.",
      );
    return analyze(this.app.writer, {
      novelId: a.novelId,
      sceneId: a.sceneId,
      sourceRevisionId: a.baseRevisionId,
      candidateId: a.candidateId,
      readingStart: a.coverage.end || 0,
      connection: await this.app.requestConnection(true, a.novelId),
    });
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
