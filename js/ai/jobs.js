import { branchTurns } from "../rp/session.js";
import { id, now, textBlob } from "../core/ids.js";
import {
  assemble,
  snapshotCurrent,
  contextCheck,
} from "../context/assemble.js";
import {
  serialize,
  validateConnection,
  consumeStream,
} from "./providers/adapters.js";
import { createCandidate, saveCandidate } from "../novel/operations.js";
import { assert } from "../core/schema.js";
export class Writer {
  constructor(repo, device) {
    this.repo = repo;
    this.disposed = false;
    this.device = device;
    this.foreground = null;
    this.helper = null;
  }
  cancel() {
    this.foreground?.abort();
    if (this.activeRequestId)
      this.device
        .api("cancel", {
          method: "POST",
          body: { requestId: this.activeRequestId },
        })
        .catch(() => {});
  }
  async run(options) {
    assert(
      !this.disposed,
      "This writer belongs to a closed library session. Original results are retained.",
    );
    if (globalThis.navigator?.locks && !options.lockHeld) {
      const lane = options.auxiliary ? "helper" : "foreground";
      return navigator.locks.request(
        "cozynovel." + lane,
        { ifAvailable: true },
        (lock) => {
          assert(
            lock,
            "A " + lane + " request is active in another Cozy Novel tab.",
          );
          return this.run({ ...options, lockHeld: true });
        },
      );
    }
    const {
      connection,
      onDelta = () => {},
      kind,
      sceneId,
      novelId,
      direction,
      auxiliary = false,
    } = options;
    validateConnection(connection);
    assert(
      this.device.token,
      "Start the local Cozy Novel server to connect a model. Manual writing works in browser only mode.",
    );
    if (auxiliary) {
      assert(!this.foreground && !this.helper, "The writing queue is busy.");
    } else {
      assert(!this.foreground, "A writing request is already running.");
      this.helper?.abort();
    }
    const controller = new AbortController();
    if (auxiliary) this.helper = controller;
    else this.foreground = controller;
    let candidate,
      job,
      receipt,
      text = "",
      result,
      lastSave = 0;
    try {
      const context = await assemble(this.repo, options),
        library = { generation: context.snapshot.libraryGeneration };
      assert(
        !options.libraryGeneration ||
          options.libraryGeneration === library.generation,
        "This request belongs to an earlier library generation.",
      );
      job = {
        id: id("job"),
        type: "job",
        novelId,
        sceneId,
        kind,
        state: "running",
        requestId: id("request"),
        attempts: 1,
        dependencyFingerprint: context.snapshot.dependencyFingerprint,
        libraryGeneration: library.generation,
        createdAt: now(),
      };
      if (options.exploration) {
        const turns = await branchTurns(this.repo, options.exploration);
        Object.assign(job, {
          explorationId: options.exploration.id,
          branchId: options.exploration.activeBranchId,
          targetSequence: (turns.at(-1)?.sequence || 0) + 1,
        });
      }
      if (!auxiliary) this.activeRequestId = job.requestId;
      if (["write", "continue", "revise", "adapt"].includes(kind))
        candidate = await createCandidate(this.repo, {
          sceneId,
          baseRevisionId: context.snapshot.revisionId,
          range: options.range,
          direction,
          kind,
          requestId: job.requestId,
          extra: {
            libraryGeneration: library.generation,
            contextSnapshot: context.snapshot,
            dependencyFingerprint: context.snapshot.dependencyFingerprint,
            ...options.candidateExtra,
          },
        });
      receipt = {
        id: id("receipt"),
        type: "receipt",
        novelId,
        sceneId,
        jobId: job.id,
        snapshot: context.snapshot,
        sourceRefs: context.snapshot.sourceIds.map((id) => ({ id })),
        candidateId: candidate?.id || null,
        startedAt: now(),
        state: "running",
        retries: 0,
        exactWireRetained: false,
      };
      await this.repo.withMutation(async () => {
        const initial = await contextCheck(this.repo, context.snapshot, {
          allowAcceptedCandidate: kind === "analysis",
        });
        assert(
          initial.current,
          "The request source changed before sending. The original work is retained.",
        );
        await this.repo.commitLocked({
          novelId,
          kind: "job.start",
          generation: library.generation,
          contextPrecondition: initial.precondition,
          records: [job, receipt],
        });
      });
      const response = await fetch(
        new URL("api/novel/generate", document.baseURI),
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-CozyNovel-Session": this.device.token,
          },
          body: JSON.stringify({
            connectionId: connection.id,
            requestId: job.requestId,
            adapter: connection.adapter,
            request: serialize(connection, context),
          }),
        },
      );
      result = await consumeStream(
        response,
        connection.adapter,
        async (delta) => {
          text += delta;
          onDelta(text, candidate);
          if (Date.now() - lastSave > 800) {
            lastSave = Date.now();
            if (candidate)
              candidate = await saveCandidate(
                this.repo,
                candidate,
                text,
                "streaming",
              );
            else {
              const checkpoint = await textBlob(text);
              job = { ...job, textBlobId: checkpoint.id };
              await this.repo.commit({
                novelId,
                kind: "job.checkpoint",
                generation: library.generation,
                records: [job],
                blobs: [checkpoint],
              });
            }
          }
        },
        controller.signal,
      );
      const check = await contextCheck(this.repo, context.snapshot, {
        allowAcceptedCandidate: kind === "analysis",
      });
      const current = await this.repo.get(sceneId);
      let stale =
        (!options.exploration &&
          current.currentRevisionId !== context.snapshot.revisionId) ||
        !check.current;
      if (candidate) {
        const status = stale
          ? "stale"
          : ["stop", "end_turn"].includes(result.finishReason)
            ? "ready"
            : "partial";
        try {
          candidate = await saveCandidate(this.repo, candidate, text, status, {
            ...(stale ? {} : { contextPrecondition: check.precondition }),
          });
        } catch (error) {
          if (
            !/context changed|configuration changed|passage changed/.test(
              error.message,
            )
          )
            throw error;
          candidate = await saveCandidate(this.repo, candidate, text, "stale", {
            staleReason: error.message,
          });
        }
      }
      stale = stale || candidate?.status === "stale";
      const body = await textBlob(text);
      await this.repo.commit({
        novelId,
        kind: "job.complete",
        generation: library.generation,
        records: [
          {
            ...job,
            state: stale ? "stale" : "completed",
            resultRefs: candidate ? [candidate.id] : [],
            textBlobId: body.id,
          },
          {
            ...receipt,
            state: "completed",
            finishedAt: now(),
            usage: result.usage,
            finishReason: result.finishReason,
            stale,
            cost: cost(result.usage, connection),
          },
        ],
        blobs: [body],
      });
      return {
        text,
        snapshot: context.snapshot,
        contextPrecondition: check.precondition,
        finishReason: result.finishReason,
        candidate,
        receiptId: receipt.id,
        stale: stale || candidate?.status === "stale",
        sourceRevisionId: context.snapshot.revisionId,
        jobId: job.id,
      };
    } catch (e) {
      if (job && !candidate && text) {
        const partial = await textBlob(text);
        job = { ...job, textBlobId: partial.id };
        await this.repo
          .commit({
            novelId,
            kind: "job.partial",
            generation: job.libraryGeneration,
            records: [job],
            blobs: [partial],
          })
          .catch(() => {});
      }
      if (candidate)
        await saveCandidate(
          this.repo,
          candidate,
          text,
          candidate.status === "stale" ? "stale" : text ? "partial" : "failed",
          { error: e.message },
        ).catch(() => {});
      if (job)
        await this.repo
          .commit({
            novelId,
            kind: "job.interrupted",
            generation: job.libraryGeneration,
            records: [
              {
                ...job,
                state: "interrupted",
                error:
                  e.name === "AbortError"
                    ? "Cancelled. Partial text is retained."
                    : e.message,
              },
              ...(receipt
                ? [
                    {
                      ...receipt,
                      state: "interrupted",
                      finishedAt: now(),
                      finishReason: e.finishReason || "failed",
                      usage: e.usage || null,
                      error: e.message,
                    },
                  ]
                : []),
            ],
          })
          .catch(() => {});
      e.candidate = candidate;
      e.jobId = job?.id;
      throw e;
    } finally {
      if (auxiliary) this.helper = null;
      else {
        this.foreground = null;
        this.activeRequestId = null;
      }
    }
  }
  async recoverInterrupted() {
    const jobs = await this.repo.query("type", "job");
    for (const job of jobs.filter((j) => j.state === "running")) {
      const held = await globalThis.navigator?.locks?.query();
      if (
        held?.held.some(
          (lock) =>
            lock.name ===
            "cozynovel." + (job.kind === "analysis" ? "helper" : "foreground"),
        )
      )
        continue;
      const records = [
        {
          ...job,
          state: "interrupted",
          error:
            "The application closed during this request. No paid request was restarted.",
        },
      ];
      const owned = await this.repo.query("novelId", job.novelId);
      for (const receipt of owned.filter(
        (r) =>
          r.type === "receipt" && r.jobId === job.id && r.state === "running",
      ))
        records.push({
          ...receipt,
          state: "interrupted",
          finishReason: "application_closed",
          finishedAt: now(),
        });
      for (const c of owned.filter(
        (r) =>
          r.type === "candidate" &&
          r.requestId === job.requestId &&
          r.status === "streaming",
      ))
        records.push({ ...c, status: "partial" });
      await this.repo.commit({
        novelId: job.novelId,
        kind: "job.recover",
        records,
      });
    }
  }
  dispose() {
    this.disposed = true;
    this.foreground?.abort();
    this.helper?.abort();
  }
}
function cost(u, c) {
  const input = u?.input_tokens ?? u?.prompt_tokens,
    output = u?.output_tokens ?? u?.completion_tokens;
  return input != null &&
    output != null &&
    c.inputPrice != null &&
    c.outputPrice != null
    ? (input * c.inputPrice + output * c.outputPrice) / 1000000
    : null;
}
