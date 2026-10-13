import { $, el, button, panel, notice, closePanel } from "./dom.js";
import { id, now, textBlob } from "../core/ids.js";
export async function renderDiscussion(app) {
  const messages = (await app.repo.query("novelId", app.novelId))
    .filter((r) => r.type === "discussion")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $("#discussion").replaceChildren(
    ...(await Promise.all(
      messages.map(async (m) =>
        el(
          "article",
          { "data-role": m.role },
          await app.repo.text(m.textBlobId),
        ),
      ),
    )),
  );
  const existing = messages.map((m) => m.jobId).filter(Boolean);
  const jobs = (await app.repo.query("novelId", app.novelId)).filter(
    (j) =>
      j.type === "job" &&
      j.kind === "discuss" &&
      j.textBlobId &&
      j.state !== "running" &&
      !existing.includes(j.id),
  );
  for (const job of jobs)
    $("#discussion").append(
      el(
        "article",
        { "data-role": "partner" },
        el("small", { class: "tag" }, "Recovered conversation response"),
        el("div", {}, await app.repo.text(job.textBlobId)),
      ),
    );
}
export async function partnerAction(app, action) {
  if (action === "discuss") {
    await app.flush();
    const direction = $("#discussionInput").value;
    if (!direction.trim()) throw new Error("Write your question first.");
    const novelId = app.novelId,
      sceneId = app.sceneId;
    const previous = (await app.repo.query("novelId", novelId))
      .filter((r) => r.type === "discussion")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-10);
    let history = "";
    for (const m of previous)
      history += `\n${m.role}: ${await app.repo.text(m.textBlobId)}`;
    const blob = await textBlob(direction);
    await app.repo.commit({
      novelId,
      kind: "discussion.author",
      records: [
        {
          id: id("discussion"),
          type: "discussion",
          novelId,
          role: "author",
          textBlobId: blob.id,
          createdAt: now(),
        },
      ],
      blobs: [blob],
    });
    await renderDiscussion(app);
    if (novelId === app.novelId) {
      $("#discussionInput").value = "";
      app.partnerDraft?.mark();
      await app.partnerDraft?.save();
    }
    const preview = el("article", { "data-role": "partner" });
    $("#discussion").append(preview);
    let partial = "";
    try {
      const result = await app.writer.run({
        connection: await app.requestConnection(false, novelId),
        novelId,
        sceneId,
        kind: "discuss",
        direction:
          "Previous author conversation, not established story facts:\n" +
          history +
          "\nCurrent question:\n" +
          direction,
        scope: $("#discussionScope").value,
        sourceIds: app.sourceIds,
        range: app.selection,
        onDelta: (text) => {
          partial = text;
          preview.textContent = text;
        },
      });
      const text = await textBlob(result.text);
      await app.repo.commit({
        novelId,
        kind: "discussion.partner",
        records: [
          {
            id: id("discussion"),
            type: "discussion",
            novelId,
            role: "partner",
            textBlobId: text.id,
            createdAt: now(),
            receiptId: result.receiptId,
            jobId: result.jobId,
          },
        ],
        blobs: [text],
      });
      if (novelId === app.novelId) await renderDiscussion(app);
    } catch (e) {
      if (partial) {
        const text = await textBlob(partial);
        await app.repo.commit({
          novelId,
          kind: "discussion.partial",
          records: [
            {
              id: id("discussion"),
              type: "discussion",
              novelId,
              role: "partner",
              textBlobId: text.id,
              interrupted: true,
              jobId: e.jobId,
              createdAt: now(),
            },
          ],
          blobs: [text],
        });
      }
      throw e;
    }
    return true;
  }
  if (action === "selectSources") {
    const scenes = (await app.repo.query("novelId", app.novelId)).filter(
      (r) => r.type === "scene" || r.kind === "reference",
    );
    const checks = scenes.map((s) =>
      el(
        "label",
        {},
        el("input", {
          type: "checkbox",
          value: s.currentRevisionId || s.id,
          checked: app.sourceIds.includes(s.currentRevisionId || s.id),
        }),
        " " + (s.kind === "reference" ? "Reference: " : "") + s.title,
      ),
    );
    panel(
      "Choose original sources",
      el(
        "p",
        { class: "help" },
        "Selected originals receive priority. Required author constraints and the selected scene remain included. The request receipt lists omissions.",
      ),
      checks,
      el(
        "button",
        {
          onClick: () => {
            app.sourceIds = checks
              .filter((c) => c.firstChild.checked)
              .map((c) => c.firstChild.value);
            closePanel();
          },
        },
        "Use selected sources",
      ),
    );
    return true;
  }
  if (action === "receipts") {
    if (!app.novelId) {
      notice("Open a novel to inspect its requests.");
      return true;
    }
    const receipts = (await app.repo.query("novelId", app.novelId))
      .filter((r) => r.type === "receipt")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    panel(
      "What the writer received",
      el(
        "p",
        { class: "help" },
        "These receipts record the immutable selection and prompt blocks used at request time. They are not reconstructed from today’s manuscript. Exact HTTP wire content is not retained. Counts are estimates unless the provider reported usage.",
      ),
      ...receipts.map((r) =>
        el(
          "article",
          { class: "storycard" },
          el(
            "h3",
            {},
            (r.connectionName || r.connectionId || "Saved connection") +
              " · " +
              r.snapshot.model,
          ),
          el(
            "small",
            {},
            (r.auxiliary
              ? "Optional Story Brain or helper: "
              : "Foreground: ") + r.snapshot.kind,
          ),
          el(
            "p",
            {},
            "Reported input " +
              (r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? "unknown") +
              ", output " +
              (r.usage?.output_tokens ??
                r.usage?.completion_tokens ??
                "unknown") +
              ", cached " +
              (r.usage?.cache_read_input_tokens ??
                r.usage?.input_tokens_details?.cached_tokens ??
                r.usage?.prompt_tokens_details?.cached_tokens ??
                "not reported") +
              ", cache write " +
              (r.usage?.cache_creation_input_tokens ?? "not reported") +
              ". Duration " +
              (r.durationMs ?? "unknown") +
              " ms. Finish " +
              (r.finishReason || r.state) +
              ".",
          ),
          el(
            "p",
            {},
            `${r.state}. Input estimate ${r.snapshot.inputEstimate}. Output allowance ${r.snapshot.outputAllowance}. Estimated cost ${r.cost == null ? "unknown" : "$" + r.cost.toFixed(5)}.`,
          ),
          el(
            "button",
            {
              onClick: async () => {
                const blocks = [];
                for (const block of r.snapshot.sections) {
                  const source = block.sourceId
                    ? await app.repo.get(block.sourceId)
                    : null;
                  blocks.push(
                    block.label +
                      "\n" +
                      (block.body ??
                        (source?.textBlobId
                          ? block.range
                            ? (await app.repo.text(source.textBlobId)).slice(
                                ...block.range,
                              )
                            : await app.repo.text(source.textBlobId)
                          : JSON.stringify(source))),
                  );
                }
                panel(
                  "Request receipt",
                  el("pre", { class: "receipt" }, JSON.stringify(r, null, 2)),
                  ...(await app.repo.query("novelId", r.novelId))
                    .filter(
                      (a) =>
                        a.kind === "invalidStructuredOutput" &&
                        a.jobId === r.jobId,
                    )
                    .map((a) =>
                      el(
                        "button",
                        {
                          onClick: async () =>
                            panel(
                              "Original structured provider output, outside the manuscript",
                              el(
                                "pre",
                                { class: "receipt" },
                                await app.repo.text(a.textBlobId),
                              ),
                            ),
                        },
                        "Inspect retained structured output",
                      ),
                    ),
                  el("h3", {}, "Selected original sources and stored blocks"),
                  el("pre", { class: "receipt" }, blocks.join("\n\n")),
                );
              },
            },
            "Inspect request",
          ),
        ),
      ),
    );
    return true;
  }
  if (action === "analyze") {
    await app.flush();
    await app.analyze(null, { force: true });
    return true;
  }
  return false;
}
