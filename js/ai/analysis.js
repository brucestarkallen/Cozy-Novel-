import { id, now } from "../core/ids.js";
import { assert } from "../core/schema.js";
export async function analyze(writer, options) {
  const result = await writer.run({
    ...options,
    kind: "analysis",
    auxiliary: true,
  });
  let parsed;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(
      "The optional reader returned invalid JSON. Your prose is safe.",
    );
  }
  assert(
    Array.isArray(parsed.suggestions) &&
      parsed.suggestions.every((s) => typeof s === "string"),
    "Invalid suggestions.",
  );
  const scene = await writer.repo.get(options.sceneId),
    candidate = options.candidateId
      ? await writer.repo.get(options.candidateId)
      : null;
  const stale =
    result.stale ||
    scene.currentRevisionId !== result.sourceRevisionId ||
    (candidate && ["discarded", "stale"].includes(candidate.status));
  const artifact = {
    id: id("artifact"),
    type: "artifact",
    novelId: options.novelId,
    sceneId: scene.id,
    kind: "analysis",
    body: {
      suggestions: parsed.suggestions.slice(0, 3),
      memories: Array.isArray(parsed.memories)
        ? parsed.memories.slice(0, 3)
        : [],
    },
    candidateId: options.candidateId || null,
    baseRevisionId: result.sourceRevisionId,
    sourceRefs: [{ id: options.candidateId || result.sourceRevisionId }],
    freshness: stale ? "stale" : "fresh",
    createdAt: now(),
  };
  await writer.repo.update(artifact, "analysis.result");
  return artifact;
}
export async function acceptMemory(repo, artifactId, index) {
  const a = await repo.get(artifactId),
    m = a.body.memories[index],
    scene = await repo.get(a.sceneId);
  assert(
    a.freshness === "fresh",
    "This reading is stale. Review its original evidence.",
  );
  if (a.candidateId) {
    const c = await repo.get(a.candidateId);
    assert(
      c.status === "kept",
      "Keep the passage before establishing a memory from it.",
    );
  } else
    assert(
      scene.currentRevisionId === a.baseRevisionId,
      "This reading is stale.",
    );
  assert(
    m &&
      typeof m.proposition === "string" &&
      typeof m.quote === "string" &&
      m.quote.length > 0,
    "The memory needs a proposition and source excerpt.",
  );
  const source = await repo.get(m.sourceId);
  assert(
    source?.novelId === a.novelId &&
      [a.baseRevisionId, a.candidateId].includes(source.id),
    "The memory does not point to its actual source.",
  );
  const text = await repo.text(source.textBlobId);
  assert(
    text.includes(m.quote),
    "The proposed source excerpt does not match. Review it manually.",
  );
  const r = {
    id: id("canon"),
    type: "canon",
    novelId: a.novelId,
    recordKind: "memory",
    proposition: m.proposition,
    status: "active",
    certainty: "derived",
    derived: true,
    sourceRefs: [{ id: source.id }],
    evidence: m.quote,
    validFrom: scene.fictionalTime,
    createdAt: now(),
    applicationReceipt: { artifactId: a.id, index, authorReviewed: true },
  };
  await repo.update(r, "memory.review.accept");
  return r;
}
