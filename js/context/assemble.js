import { textBlob } from "../core/ids.js";
import { terms as tokenize, relevance } from "./index.js";
import { TEMPLATES, PROMPT_VERSION } from "../ai/prompts/templates.js";
import { serialize } from "../ai/providers/adapters.js";
import { assert } from "../core/schema.js";
export const estimateTokens = (value) =>
  Math.ceil(
    new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value),
    ).length / 3,
  );
export function eligible(record, boundary) {
  if (
    record.validFrom != null &&
    (boundary == null || record.validFrom > boundary)
  )
    return false;
  if (
    record.validUntil != null &&
    boundary != null &&
    record.validUntil < boundary
  )
    return false;
  return true;
}
const words = (s) => new Set(tokenize(s));
function score(text, terms) {
  let score = 0;
  for (const w of words(text)) if (terms.has(w)) score++;
  return score;
}
/** Selection is independent of provider wire format. All inputs are immutable record snapshots. */
export async function assemble(
  repo,
  {
    novelId,
    sceneId,
    kind,
    direction,
    connection,
    range,
    exploration,
    scope = "scene",
    sourceIds = [],
    candidateId,
    transcript = "",
  },
) {
  const n = await repo.get(novelId),
    current = await repo.sceneText(sceneId),
    lib = await repo.get("library", "meta");
  let { scene, revision, text } = current;
  if (exploration && kind === "rp") {
    revision = await repo.get(exploration.baseRevisionId);
    text = await repo.text(revision.textBlobId);
    scene = { ...scene, ...exploration.sceneSnapshot };
  }
  assert(
    scene.novelId === novelId,
    "Context scene belongs to a different novel.",
  );
  const records = await repo.query("novelId", novelId),
    byId = new Map(records.map((r) => [r.id, r]));
  const template = records
    .filter(
      (r) =>
        r.type === "prompt" && r.kind === (TEMPLATES[kind] ? kind : "write"),
    )
    .sort((a, b) => b.version - a.version)[0];
  const system =
    (template?.body || TEMPLATES[kind] || TEMPLATES.write) +
    (kind === "revise" ? "\n" + TEMPLATES.write : "");
  const selected = range ? text.slice(...range) : text;
  const mandatory = [
    {
      label: "Writing contract",
      body: JSON.stringify({
        operation: kind,
        style: n.styleProfile,
        viewpoint: scene.viewpoint || n.styleProfile.viewpoint,
        scope,
        playerCharacterId: exploration?.playerCharacterId,
        narrativeViewpoint: exploration?.narrativeViewpoint,
      }),
    },
    {
      label: "Story Essentials",
      body: n.premise || "The author has not supplied a premise.",
    },
    {
      label: "The state of things",
      body: JSON.stringify({
        scene: scene.title,
        fictionalTime: scene.fictionalTime,
        timeLabel: scene.timeLabel,
        summary: scene.summary,
        notes: scene.notes,
      }),
    },
    {
      label: "Current manuscript",
      body:
        kind === "rp" && exploration
          ? text.slice(0, exploration.boundary)
          : scope === "selection"
            ? selected
            : text,
      sourceId: revision.id,
      range:
        kind === "rp" && exploration
          ? [0, exploration.boundary]
          : scope === "selection"
            ? range
            : [0, text.length],
    },
  ];
  if (kind === "revise")
    mandatory.push({ label: "Exact selected passage", body: selected });
  if (transcript)
    mandatory.push({
      label: "Exploration transcript, not novel canon",
      body: transcript,
    });
  if (candidateId) {
    const candidate = byId.get(candidateId);
    assert(candidate?.novelId === novelId, "Wrong candidate context.");
    mandatory.push({
      label: "Unaccepted candidate, not canon",
      body: await repo.text(candidate.textBlobId),
      sourceId: candidate.id,
    });
  }
  const canon = records.filter(
    (r) =>
      r.type === "canon" &&
      (r.status === "active" ||
        (r.status === "superseded" &&
          r.supersededFrom != null &&
          scene.fictionalTime != null &&
          scene.fictionalTime < r.supersededFrom)) &&
      eligible(r, scene.fictionalTime),
  );
  const omitted = [],
    stale = records
      .filter((r) => r.type === "canon" && r.status === "stale")
      .map((r) => r.id);
  const terms = words(
    direction +
      " " +
      selected.slice(-4000) +
      " " +
      scene.title +
      " " +
      (scene.summary || ""),
  );
  const optional = [];
  for (const r of canon) {
    if (
      kind === "rp" &&
      exploration &&
      exploration.boundary < text.length &&
      (r.sourceRefs || []).some((ref) => {
        const source = byId.get(ref.id);
        return (
          (source?.ownerId === scene.id || source?.sceneId === scene.id) &&
          !(ref.end != null && ref.end <= exploration.boundary)
        );
      })
    ) {
      omitted.push({
        id: r.id,
        reason:
          "Learning source is later than, or not bounded before, this exploration position",
      });
      continue;
    }
    const body = JSON.stringify({
      id: r.id,
      kind: r.recordKind,
      subject: r.subjectId ? byId.get(r.subjectId)?.displayName : null,
      holder: r.holderId ? byId.get(r.holderId)?.displayName : null,
      proposition: r.proposition,
      certainty: r.certainty,
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      sourceRefs: r.sourceRefs,
      authority: r.derived
        ? "Derived reading aid, original source outranks this"
        : "Author declaration",
      proseInserted: r.proseInserted,
    });
    const label = ["knowledge", "belief", "secret", "intention"].includes(
      r.recordKind,
    )
      ? "On their minds"
      : r.recordKind === "plan"
        ? "Plans standing"
        : r.recordKind === "futureIdea"
          ? "Future author ideas, not events"
          : "What remains";
    if (["authorFact", "worldRule"].includes(r.recordKind) && !r.derived)
      mandatory.push({ label: "Story Essentials", body, sourceId: r.id });
    else
      optional.push({
        label,
        body,
        sourceId: r.id,
        rank:
          (r.pinned ? 1000 : 0) +
          (["plan", "thread", "secret"].includes(r.recordKind) ? 15 : 0) +
          score(body, terms),
      });
  }
  for (const e of records.filter((r) => r.type === "entity"))
    optional.push({
      label: "People and places",
      body: JSON.stringify({
        id: e.id,
        name: e.displayName,
        aliases: e.aliases,
        kind: e.kind,
        profile: e.profile,
      }),
      sourceId: e.id,
      rank:
        (exploration?.playerCharacterId === e.id ? 2000 : 0) +
        score(e.displayName + " " + e.profile, terms),
    });
  for (const s of records.filter(
    (r) => r.type === "scene" && r.id !== sceneId,
  )) {
    if (
      s.fictionalTime != null &&
      (scene.fictionalTime == null || s.fictionalTime > scene.fictionalTime)
    ) {
      omitted.push({
        id: s.currentRevisionId,
        reason: "Later or ineligible fictional time",
      });
      continue;
    }
    // Unknown chronology is not proof of earlier occurrence. Never leak it into RP.
    if (
      kind === "rp" &&
      (s.fictionalTime == null || scene.fictionalTime == null)
    ) {
      omitted.push({
        id: s.currentRevisionId,
        reason: "Unknown chronology in character exploration",
      });
      continue;
    }
    if (
      ["selection", "sources"].includes(scope) &&
      !sourceIds.includes(s.currentRevisionId)
    )
      continue;
    const r = byId.get(s.currentRevisionId);
    let body;
    const index =
      s.searchIndex?.terms || tokenize((body = await repo.text(r.textBlobId)));
    const rank =
      (s.pinned || sourceIds.includes(r.id) ? 1500 : 0) +
      (scope === "chapter" && s.chapterId === scene.chapterId ? 500 : 0) +
      relevance(index, terms) +
      (s.chapterId === scene.chapterId ? 3 : 0) +
      (stale.some((cid) =>
        byId.get(cid)?.sourceRefs?.some((ref) => ref.id === r.id),
      )
        ? 300
        : 0);
    if (rank <= 0) {
      omitted.push({
        id: r.id,
        reason: "No current relevance or explicit pin",
      });
      continue;
    }
    optional.push({
      label:
        "Earlier moments in full" +
        (s.fictionalTime == null ? " (chronology unknown)" : ""),
      body,
      textBlobId: r.textBlobId,
      sourceId: r.id,
      rank,
    });
  }
  const max = Number(connection.contextLimit),
    out = Number(connection.outputLimit),
    reserve = Number(connection.reasoningReserve || 0),
    margin = Math.max(512, Math.ceil(max * 0.05));
  assert(
    max >= 2048 && out >= 64 && max > out + reserve + margin,
    "Context and output limits leave no room for a request.",
  );
  if (max > 32000)
    assert(
      connection.capabilityConfirmed,
      "Confirm the provider supports this context limit in Connections. A number alone is not evidence.",
    );
  const sections = [...mandatory];
  const render = () =>
    sections
      .map(
        (s) =>
          `[${s.label}${s.sourceId ? " | source " + s.sourceId : ""}]\n${s.body}`,
      )
      .join("\n\n") +
    "\n\n[Author direction]\n" +
    direction;
  const count = () =>
    estimateTokens(
      serialize(connection, { system, user: render(), outputLimit: out }),
    );
  assert(
    count() + out + reserve + margin <= max,
    "The selected passage and required author constraints exceed this context budget. Choose a smaller selection or increase the verified model limit.",
  );
  for (const item of optional.sort((a, b) => b.rank - a.rank)) {
    if (item.body == null) item.body = await repo.text(item.textBlobId);
    sections.push(item);
    if (count() + out + reserve + margin > max) {
      sections.pop();
      omitted.push({
        id: item.sourceId,
        reason: "Optional complete source does not fit",
      });
    }
  }
  const user = render(),
    inputEstimate = count();
  return {
    system,
    user,
    outputLimit: out,
    snapshot: {
      novelId,
      sceneId,
      revisionId: revision.id,
      dependencyFingerprint: (await textBlob(JSON.stringify({ system, user })))
        .id,
      authorContract: JSON.stringify({
        premise: n.premise,
        styleProfile: n.styleProfile,
      }),
      sourceVersions: sections
        .filter((s) => s.sourceId)
        .map((s) => {
          const r = byId.get(s.sourceId);
          return r?.type === "revision"
            ? { id: r.id, ownerId: r.ownerId }
            : r?.type === "candidate"
              ? { id: r.id, textBlobId: r.textBlobId }
              : { id: s.sourceId, body: JSON.stringify(r) };
        }),
      libraryGeneration: lib.generation,
      kind,
      fictionalTime: scene.fictionalTime,
      playerCharacterId: exploration?.playerCharacterId || null,
      narrativeViewpoint: exploration?.narrativeViewpoint || null,
      promptVersion: template?.version || PROMPT_VERSION,
      templateId: template?.id || null,
      sourceIds: sections.map((s) => s.sourceId).filter(Boolean),
      omitted,
      stale,
      inputEstimate,
      estimateMethod:
        "Estimated serialized UTF8 bytes divided by 3, rounded up. Not a provider tokenizer.",
      outputAllowance: out,
      reasoningReserve: reserve,
      safetyMargin: margin,
      scope,
      model: connection.model,
      adapter: connection.adapter,
      endpoint: connection.endpoint,
      sections: sections.map(({ sourceId, label, body, range }) =>
        sourceId && ["revision", "candidate"].includes(byId.get(sourceId)?.type)
          ? { sourceId, label, range }
          : { sourceId, label, body },
      ),
      systemPrompt: system,
      direction,
    },
  };
}

export async function snapshotCurrent(repo, snapshot) {
  const novel = await repo.get(snapshot.novelId);
  if (
    !novel ||
    JSON.stringify({
      premise: novel.premise,
      styleProfile: novel.styleProfile,
    }) !== snapshot.authorContract
  )
    return false;
  for (const version of snapshot.sourceVersions || []) {
    const r = await repo.get(version.id);
    if (!r) return false;
    if (version.ownerId) {
      if ((await repo.get(version.ownerId))?.currentRevisionId !== version.id)
        return false;
    } else if (version.textBlobId) {
      if (r.textBlobId !== version.textBlobId) return false;
    } else if (JSON.stringify(r) !== version.body) return false;
  }
  return true;
}
