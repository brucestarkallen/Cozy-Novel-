import { saveEntity } from "../story/entities.js";
import {
  $,
  el,
  button,
  field,
  formPanel,
  panel,
  notice,
  closePanel,
  values,
} from "./dom.js";
import {
  createExploration,
  branchTurns,
  transcript,
  addTurn,
  retryBranch,
  keepEvents,
} from "../rp/session.js";
import { id } from "../core/ids.js";
export async function rpAction(app, action, target) {
  if (action === "quickRP") {
    await app.flush();
    const records = await app.repo.query("novelId", app.novelId),
      people = records.filter(
        (r) => r.type === "entity" && r.kind === "person",
      ),
      sessions = records.filter((r) => r.type === "exploration");
    const form = formPanel(
      "Step into the scene",
      [
        field(
          "Play as an established person",
          "playerCharacterId",
          people[0]?.id || "",
          "select",
          people.map((e) => ({ value: e.id, label: e.displayName })),
        ),
        field("Or introduce a minimally described person", "newPerson", ""),
        field(
          "Narrative viewpoint",
          "narrativeViewpoint",
          "Third person limited",
        ),
      ],
      async (v) => {
        let person = v.playerCharacterId;
        if (v.newPerson.trim()) {
          const e = {
            id: id("entity"),
            type: "entity",
            novelId: app.novelId,
            kind: "person",
            displayName: v.newPerson,
            aliases: [],
            profile: "",
            sourceRefs: [],
          };
          await saveEntity(app.repo, e);
          person = e.id;
        }
        if (!person) throw new Error("Choose a person or enter a name.");
        const ex = await createExploration(app.repo, {
          sceneId: app.sceneId,
          playerCharacterId: person,
          boundary: app.selection?.[1] ?? app.editor.value.length,
          narrativeViewpoint: v.narrativeViewpoint,
        });
        setTimeout(() => openExploration(app, ex.id), 0);
      },
      {
        submit: "Enter exploration",
        help: "This is a separate branch from the selected scene boundary. You control your chosen person. Nothing becomes novel canon unless you explicitly keep it.",
      },
    );
    if (sessions.length)
      $("#modalBody").append(
        el("h3", {}, "Saved explorations"),
        ...sessions.map((e) =>
          button(
            (records.find((r) => r.id === e.playerCharacterId)?.displayName ||
              "Character") +
              " · " +
              e.status,
            "openExploration",
            { id: e.id },
          ),
        ),
      );
    return true;
  }
  if (action === "openExploration") {
    await openExploration(app, target.dataset.id);
    return true;
  }
  return false;
}
async function openExploration(app, exId) {
  let ex = await app.repo.get(exId);
  const people = (await app.repo.query("novelId", ex.novelId)).filter(
    (r) => r.type === "entity" && r.kind === "person",
  );
  const player = field(
      "You control",
      "player",
      ex.playerCharacterId,
      "select",
      people.map((e) => ({ value: e.id, label: e.displayName })),
    ),
    view = field("Narrative viewpoint", "view", ex.narrativeViewpoint);
  const branches = field(
    "Exploration branch",
    "branch",
    ex.activeBranchId,
    "select",
    ex.branches.map((b, i) => ({ value: b.id, label: "Branch " + (i + 1) })),
  );
  const turns = el("div", { class: "rptranscript", id: "rpTranscript" }),
    input = el("textarea", {
      "aria-label": "Your character action",
      rows: 3,
      placeholder: "Your words, thoughts or attempted action.",
    }),
    mode = field("Action mode", "mode", "player", "select", [
      { value: "player", label: "Act as character" },
      { value: "direct", label: "Direct, author instruction" },
    ]);
  const send = el("button", { class: "primary" }, "Act"),
    retry = el("button", {}, "Retry response"),
    stop = el("button", { onClick: () => app.writer.cancel() }, "Stop");
  const paint = async () => {
    turns.replaceChildren();
    for (const t of await branchTurns(app.repo, ex)) {
      const name = people.find((p) => p.id === t.actorId)?.displayName;
      turns.append(
        el(
          "div",
          { class: "rpturn", "data-role": t.role },
          el("small", { class: "tag" }, name || t.role),
          el("div", {}, await app.repo.text(t.textBlobId)),
        ),
      );
    }
    const savedTurns = await app.repo.query("parentSessionId", ex.id);
    const recoverable = (await app.repo.query("novelId", ex.novelId)).filter(
      (j) =>
        j.type === "job" &&
        j.explorationId === ex.id &&
        j.textBlobId &&
        j.state !== "running" &&
        !savedTurns.some((t) => t.jobId === j.id),
    );
    for (const job of recoverable)
      turns.append(
        el(
          "article",
          { class: "storycard" },
          el(
            "small",
            { class: "tag" },
            "Recovered response, not yet in transcript",
          ),
          el("div", {}, await app.repo.text(job.textBlobId)),
          el(
            "button",
            {
              onClick: async () => {
                try {
                  const fresh = await app.repo.get(ex.id),
                    branch = {
                      id: id("branch"),
                      parentId: job.branchId,
                      forkSequence: job.targetSequence - 1,
                    };
                  ex = {
                    ...fresh,
                    activeBranchId: branch.id,
                    branches: [...fresh.branches, branch],
                  };
                  await app.repo.update(ex, "exploration.recover.branch");
                  await addTurn(
                    app.repo,
                    ex,
                    "world",
                    await app.repo.text(job.textBlobId),
                    { jobId: job.id, interrupted: job.state !== "completed" },
                  );
                  await openExploration(app, ex.id);
                } catch (e) {
                  notice(e.message, true);
                }
              },
            },
            "Keep as a recovered branch",
          ),
        ),
      );
    turns.scrollTop = turns.scrollHeight;
  };
  player.querySelector("select").addEventListener("change", async (e) => {
    if (app.writer.foreground) return;
    ex = { ...(await app.repo.get(exId)), playerCharacterId: e.target.value };
    await app.repo.update(ex, "exploration.player");
    notice("Player changed. Time and character knowledge were not advanced.");
  });
  view.querySelector("input").addEventListener("change", async (e) => {
    ex = { ...(await app.repo.get(exId)), narrativeViewpoint: e.target.value };
    await app.repo.update(ex, "exploration.viewpoint");
  });
  branches.querySelector("select").addEventListener("change", async (e) => {
    ex = { ...(await app.repo.get(exId)), activeBranchId: e.target.value };
    await app.repo.update(ex, "exploration.branch.select");
    await paint();
  });
  const generate = async (isRetry = false) => {
    let preview,
      partial = "";
    send.disabled = true;
    retry.disabled = true;
    player.querySelector("select").disabled = true;
    branches.querySelector("select").disabled = true;
    try {
      ex = await app.repo.get(exId);
      if (isRetry) {
        ex = await retryBranch(app.repo, ex);
        const select = branches.querySelector("select");
        select.append(
          el(
            "option",
            { value: ex.activeBranchId },
            "Branch " + ex.branches.length,
          ),
        );
        select.value = ex.activeBranchId;
      } else {
        if (!input.value.trim())
          throw new Error("Write your action or direction first.");
        await addTurn(
          app.repo,
          ex,
          mode.querySelector("select").value,
          input.value,
        );
        input.value = "";
      }
      await paint();
      preview = el("div", { class: "rpturn", "data-role": "world" });
      turns.append(preview);
      const result = await app.writer.run({
        connection: app.connection(),
        novelId: ex.novelId,
        sceneId: ex.baseSceneId,
        kind: "rp",
        direction:
          "Respond to the last action in the transcript. Stop before choosing the player’s next intentional action.",
        exploration: ex,
        transcript: await transcript(app.repo, ex),
        onDelta: (text) => {
          partial = text;
          preview.textContent = text;
          turns.scrollTop = turns.scrollHeight;
        },
      });
      await addTurn(app.repo, ex, "world", result.text, {
        jobId: result.jobId,
      });
      await paint();
    } catch (e) {
      if (partial)
        await addTurn(app.repo, ex, "world", partial, {
          interrupted: true,
          jobId: e.jobId,
        }).catch(() => {});
      notice(e.message, true);
      await paint();
    } finally {
      send.disabled = false;
      retry.disabled = false;
      player.querySelector("select").disabled = false;
      branches.querySelector("select").disabled = false;
    }
  };
  send.addEventListener("click", () => generate());
  retry.addEventListener("click", () => generate(true));
  panel(
    "Quick RP",
    el(
      "p",
      { class: "help" },
      "Exploration only. Changing the player never changes who knows a secret. Direct gives an author instruction; an in character action is an attempt.",
    ),
    el("div", { class: "inlinefields" }, player, view, branches),
    turns,
    mode,
    input,
    el("div", { class: "actions" }, send, retry, stop),
    el(
      "div",
      { class: "actions" },
      el(
        "button",
        {
          onClick: async () => {
            ex = { ...(await app.repo.get(exId)), status: "kept" };
            await app.repo.update(ex, "exploration.keep");
            closePanel();
            notice("Exploration saved for later. The novel is unchanged.");
          },
        },
        "Keep exploration",
      ),
      el(
        "button",
        {
          onClick: async () => {
            ex = await app.repo.get(exId);
            formPanel(
              "Review events to keep",
              [
                field(
                  "Author established event record",
                  "proposition",
                  "",
                  "textarea",
                ),
              ],
              async (v) => {
                await keepEvents(app.repo, ex, v.proposition);
                notice(
                  "Events kept with transcript provenance. No manuscript prose has been inserted.",
                );
              },
              {
                submit: "Accept event record",
                help: "Write or paste the meaningful events you are establishing. Keeping this record is an explicit author declaration.",
              },
            );
            $("#modalBody").prepend(
              el("pre", { class: "receipt" }, await transcript(app.repo, ex)),
            );
          },
        },
        "Keep events",
      ),
      el("button", { onClick: () => adapt(app, exId) }, "Turn into prose"),
      el(
        "button",
        {
          onClick: async () => {
            await app.repo.update(
              { ...(await app.repo.get(exId)), status: "discarded" },
              "exploration.discard",
            );
            closePanel();
            notice(
              "Exploration removed from active work. It remains recoverable in Quick RP.",
            );
          },
        },
        "Discard exploration",
      ),
    ),
  );
  await paint();
}
async function adapt(app, exId) {
  try {
    const ex = await app.repo.get(exId),
      scene = await app.repo.get(ex.baseSceneId);
    const source = await transcript(app.repo, ex);
    const proceed = async (range) => {
      closePanel();
      if (app.sceneId !== ex.baseSceneId) await app.openScene(ex.baseSceneId);
      await app.generate("adapt", {
        direction:
          "Turn the exploration into prose, preserving meaningful actions, outcomes and quoted dialogue.",
        range,
        exploration: ex,
        transcript: source,
        candidateExtra: {
          explorationId: ex.id,
          branchId: ex.activeBranchId,
          transcriptSource: source,
        },
      });
    };
    if (scene.currentRevisionId !== ex.baseRevisionId) {
      const current = await app.repo.sceneText(ex.baseSceneId);
      panel(
        "The source scene changed",
        el(
          "p",
          { class: "help" },
          "The exploration is preserved. Compare it with the current manuscript, then explicitly choose to generate an adaptation at the current scene ending. The original exploration remains linked.",
        ),
        el(
          "div",
          { class: "compare" },
          el("pre", {}, current.text),
          el("pre", {}, source),
        ),
        el(
          "button",
          {
            class: "primary",
            onClick: () => proceed([current.text.length, current.text.length]),
          },
          "Use current scene ending for a new candidate",
        ),
      );
      return;
    }
    await proceed([ex.boundary, ex.boundary]);
  } catch (e) {
    notice(e.message, true);
  }
}
