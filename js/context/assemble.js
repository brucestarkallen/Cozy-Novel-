import {
  makeScope,
  permitted,
  metadataAt,
  profileAt,
  mappedRange,
} from "./scope.js";
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
export async function assembleCaptured(
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
    replayBaseRevisionId,
    sourceText,
    sourceRecordId,
    sourceTextBlobId,
    sourceTurnSpans,
    readingSegment,
  },
) {
  if (exploration?.baseContextId && !exploration.baseContextRecords)
    exploration = {
      ...exploration,
      baseContextRecords: (await repo.get(exploration.baseContextId))?.body
        .records,
    };
  let n = await repo.get(novelId),
    current = await repo.sceneText(sceneId),
    lib = await repo.get("library", "meta");
  let { scene, revision, text } = current;
  if (replayBaseRevisionId) {
    revision = await repo.get(replayBaseRevisionId);
    text = await repo.text(revision.textBlobId);
  }
  if (exploration && ["rp", "analysis", "eventProposal"].includes(kind)) {
    revision = await repo.get(exploration.baseRevisionId);
    text = await repo.text(revision.textBlobId);
    scene = { ...scene, ...exploration.sceneSnapshot };
  }
  assert(
    scene.novelId === novelId,
    "Context scene belongs to a different novel.",
  );
  let records = await repo.query("novelId", novelId);
  if (
    exploration?.baseContextRecords &&
    ["rp", "analysis", "eventProposal"].includes(kind)
  ) {
    const saved = exploration.baseContextRecords;
    records = [
      ...saved,
      ...records.filter(
        (r) =>
          r.explorationId === exploration.id ||
          r.parentSessionId === exploration.id ||
          r.id === exploration.id,
      ),
    ];
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  if (sourceTextBlobId)
    assert(
      byId.get(sourceRecordId)?.textBlobId === sourceTextBlobId,
      "The reading source changed before its request. Original material remains recoverable.",
    );
  if (exploration?.baseContextRecords) {
    n = byId.get(novelId) || n;
    scene = { ...(byId.get(sceneId) || scene), ...exploration.sceneSnapshot };
  }
  const contextScope = makeScope(
      scene,
      revision,
      text,
      { kind, exploration, transcriptHeadId: sourceTurnSpans?.at(-1)?.id },
      records,
      lib,
    ),
    safeMeta = metadataAt(scene, contextScope);

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
        summary: safeMeta.summary,
        notes: safeMeta.notes,
      }),
    },
    {
      label:
        kind === "analysis"
          ? "Current manuscript excerpt, earlier originals retained"
          : "Current manuscript",
      body:
        kind === "analysis"
          ? text.slice(-4000)
          : kind === "rp" && exploration
            ? text.slice(0, exploration.boundary)
            : scope === "selection"
              ? selected
              : text,
      sourceId: revision.id,
      range:
        kind === "analysis"
          ? [Math.max(0, text.length - 4000), text.length]
          : kind === "rp" && exploration
            ? [0, exploration.boundary]
            : scope === "selection"
              ? range
              : [0, text.length],
    },
  ];
  if (kind === "revise")
    mandatory.push({ label: "Exact selected passage", body: selected });
  if (sourceText != null)
    mandatory.push({
      label: "Source segment for structured reading",
      body: sourceText,
      sourceId: sourceRecordId,
      range: readingSegment,
    });
  if (transcript)
    mandatory.push({
      label: "Exploration transcript, not novel canon",
      body: transcript,
    });
  if (candidateId && kind !== "analysis") {
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
      permitted(r, contextScope, byId),
  );
  const omitted = [],
    stale = records
      .filter((r) => r.type === "canon" && r.status === "stale")
      .map((r) => r.id);
  if (contextScope.historical && !safeMeta.summary && scene.summary)
    omitted.push({
      id: scene.id,
      reason: "Whole scene summary has no eligible source coverage",
    });
  if (contextScope.historical && !safeMeta.notes && scene.notes)
    omitted.push({
      id: scene.id,
      reason: "Scene notes have no eligible historical scope",
    });
  for (const r of records.filter(
    (r) =>
      r.type === "canon" &&
      r.status === "active" &&
      !permitted(r, contextScope, byId),
  ))
    omitted.push({
      id: r.id,
      reason: "Story record is outside this temporal or source boundary",
    });
  const terms = words(
    direction +
      " " +
      selected.slice(-4000) +
      " " +
      scene.title +
      " " +
      (safeMeta.summary || ""),
  );
  const optional = [];
  const alreadyInPrimary = (r) =>
    !contextScope.historical &&
    r.derived &&
    (r.sourceRefs || []).some(
      (ref) =>
        byId.get(ref.id)?.ownerId === scene.id ||
        byId.get(ref.id)?.sceneId === scene.id,
    );
  for (const r of canon) {
    if (kind !== "analysis" && alreadyInPrimary(r)) continue;
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
      : ["condition", "relationship", "location"].includes(r.recordKind)
        ? "The state of things"
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
  for (const e of records.filter(
    (r) => r.type === "entity" && !r.derivedHidden,
  )) {
    if (kind !== "analysis" && alreadyInPrimary(e)) continue;
    if (!permitted(e, contextScope, byId)) {
      omitted.push({
        id: e.id,
        reason: "Exploration only identity outside this branch",
      });
      continue;
    }
    const profile = profileAt(e, contextScope, byId);
    if (e.profile && !profile)
      omitted.push({
        id: e.id,
        reason:
          "Original freeform profile retained for author review; fictional scope is not established",
      });
    optional.push({
      label: "People and places",
      body: JSON.stringify({
        id: e.id,
        name: e.displayName,
        aliases: e.aliases,
        kind: e.kind,
        profile,
      }),
      sourceId: e.id,
      rank:
        (exploration?.playerCharacterId === e.id ? 2000 : 0) +
        score(e.displayName + " " + profile, terms),
    });
  }
  for (const a of records.filter(
    (r) =>
      r.type === "artifact" &&
      ["storySummary", "branchReading"].includes(r.kind) &&
      r.freshness !== "stale",
  ))
    if (
      permitted(a, contextScope, byId) &&
      !(
        !contextScope.historical &&
        a.sourceRefs?.some((ref) => byId.get(ref.id)?.ownerId === scene.id)
      )
    )
      optional.push({
        label:
          a.scope === "exploration"
            ? "Branch state, exploration only"
            : "What remains",
        body: JSON.stringify(a.body),
        sourceId: a.id,
        rank: 500,
      });
  for (const s of records.filter(
    (r) => r.type === "scene" && r.id !== sceneId,
  )) {
    if (!permitted(s, contextScope, byId)) {
      omitted.push({
        id: s.currentRevisionId,
        reason:
          "Original passage has no eligible temporal or continuation evidence",
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
      contextEpoch: repo.contextEpoch ?? null,
      contextScope,
      selectionOptions: {
        novelId,
        sceneId,
        kind,
        direction,
        connection: Object.fromEntries(
          Object.entries(connection).filter(([key]) =>
            [
              "id",
              "adapter",
              "endpoint",
              "model",
              "contextLimit",
              "outputLimit",
              "reasoningReserve",
              "capabilityConfirmed",
              "capabilities",
              "parameters",
              "inputPrice",
              "outputPrice",
              "allowLocal",
            ].includes(key),
          ),
        ),
        range,
        scope,
        sourceIds,
        candidateId,
        transcript,
        readingSegment,
        sourceText,
        sourceRecordId,
        sourceTextBlobId,
        sourceTurnSpans,
        exploration: exploration
          ? {
              id: exploration.id,
              activeBranchId: exploration.activeBranchId,
              playerCharacterId: exploration.playerCharacterId,
              narrativeViewpoint: exploration.narrativeViewpoint,
            }
          : null,
      },
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

export async function assemble(repo, options) {
  const captured = repo.captureNovel
    ? await repo.captureNovel(options.novelId)
    : repo;
  return assembleCaptured(captured, options);
}
export async function contextCheck(
  repo,
  snapshot,
  { allowAcceptedCandidate = false } = {},
) {
  const lib = await repo.get("library", "meta");
  if (lib.generation !== snapshot.libraryGeneration)
    return { current: false, reason: "Library generation changed" };
  if (!snapshot.selectionOptions) {
    const novel = await repo.get(snapshot.novelId);
    let current =
      JSON.stringify({
        premise: novel?.premise,
        styleProfile: novel?.styleProfile,
      }) === snapshot.authorContract;
    for (const v of snapshot.sourceVersions || []) {
      const r = await repo.get(v.id);
      current =
        current &&
        !!r &&
        (v.ownerId
          ? (await repo.get(v.ownerId))?.currentRevisionId === v.id
          : v.textBlobId
            ? r.textBlobId === v.textBlobId
            : JSON.stringify(r) === v.body);
    }
    return { current, precondition: null };
  }
  const opts = { ...snapshot.selectionOptions };
  const latestConnection = await repo.get(
    "connection." + opts.connection.id,
    "meta",
  );
  if (
    latestConnection?.profile &&
    JSON.stringify(providerIdentity(latestConnection.profile)) !==
      JSON.stringify(providerIdentity(opts.connection))
  )
    return {
      current: false,
      reason: "Provider serialization configuration changed",
    };
  let mapping;
  if (opts.exploration) {
    const ex = await repo.get(opts.exploration.id);
    if (
      !ex ||
      ex.activeBranchId !== opts.exploration.activeBranchId ||
      ex.playerCharacterId !== opts.exploration.playerCharacterId ||
      ex.narrativeViewpoint !== opts.exploration.narrativeViewpoint
    )
      return {
        current: false,
        reason: "Exploration control or branch changed",
      };
    opts.exploration = ex;
  }
  if (allowAcceptedCandidate && opts.candidateId) {
    const c = await repo.get(opts.candidateId),
      scene = await repo.get(snapshot.sceneId);
    if (c?.status === "kept") {
      const records = await repo.query("novelId", snapshot.novelId),
        mapped =
          c.acceptedRange &&
          mappedRange(
            { start: c.acceptedRange[0], end: c.acceptedRange[1] },
            c.acceptedRevisionId,
            scene.currentRevisionId,
            new Map(records.map((r) => [r.id, r])),
          );
      if (
        mapped &&
        (await repo.sceneText(scene.id)).text.slice(
          mapped.start,
          mapped.end,
        ) === (await repo.text(c.textBlobId))
      ) {
        if (snapshot.revisionId === c.baseRevisionId)
          opts.replayBaseRevisionId = c.baseRevisionId;
        mapping = {
          candidateId: c.id,
          textBlobId: c.textBlobId,
          sourceRevisionId: c.acceptedRevisionId,
          targetRevisionId: scene.currentRevisionId,
          range: [mapped.start, mapped.end],
        };
      }
    }
  }
  const rebuilt = await assemble(repo, opts);
  const current =
    rebuilt.snapshot.dependencyFingerprint === snapshot.dependencyFingerprint &&
    JSON.stringify(rebuilt.snapshot.contextScope.turnIds) ===
      JSON.stringify(snapshot.contextScope.turnIds) &&
    rebuilt.snapshot.contextScope.liveTranscriptHead ===
      snapshot.contextScope.liveTranscriptHead;
  return {
    current,
    reason: current
      ? null
      : "Selected story material, metadata or scope changed",
    precondition: {
      epoch: rebuilt.snapshot.contextEpoch,
      generation: lib.generation,
      mapping,
      provider: latestConnection?.profile
        ? {
            id: latestConnection.id,
            signature: JSON.stringify(
              providerIdentity(latestConnection.profile),
            ),
          }
        : null,
    },
  };
}
export async function snapshotCurrent(repo, snapshot, options) {
  return (await contextCheck(repo, snapshot, options)).current;
}

export function providerIdentity(c) {
  return {
    adapter: c.adapter,
    endpoint: c.endpoint,
    model: c.model,
    contextLimit: c.contextLimit,
    outputLimit: c.outputLimit,
    reasoningReserve: c.reasoningReserve || 0,
    capabilities: c.capabilities || {},
    parameters: c.parameters || {},
  };
}
