import { APP, CANON_KINDS } from "../config.js";
export const TYPES = [
  "novel",
  "chapter",
  "scene",
  "revision",
  "candidate",
  "entity",
  "canon",
  "exploration",
  "turn",
  "artifact",
  "job",
  "receipt",
  "discussion",
  "prompt",
  "bookmark",
];
export function assert(ok, message) {
  if (!ok) throw new Error(message);
}
export function validateRecord(r) {
  assert(r && typeof r === "object" && !Array.isArray(r), "Invalid record.");
  assert(
    typeof r.id === "string" && r.id.length < 160,
    "Invalid record identity.",
  );
  assert(TYPES.includes(r.type), "Unsupported record kind.");
  assert(typeof r.novelId === "string", "Missing novel ownership.");
  if (r.type === "novel")
    assert(
      r.novelId === r.id &&
        Array.isArray(r.orderedChapterIds) &&
        Number.isInteger(r.contentVersion),
      "Invalid novel.",
    );
  if (r.type === "scene")
    assert(
      typeof r.chapterId === "string" &&
        typeof r.currentRevisionId === "string",
      "Invalid scene.",
    );
  if (r.type === "chapter")
    assert(Array.isArray(r.orderedSceneIds), "Invalid chapter.");
  if (r.type === "revision")
    assert(
      typeof r.ownerId === "string" && typeof r.textBlobId === "string",
      "Invalid revision.",
    );
  if (r.type === "candidate")
    assert(
      [
        "streaming",
        "ready",
        "partial",
        "failed",
        "stale",
        "kept",
        "discarded",
      ].includes(r.status) &&
        typeof r.baseRevisionId === "string" &&
        Array.isArray(r.insertionRange),
      "Invalid candidate.",
    );
  if (r.type === "canon")
    assert(
      CANON_KINDS.includes(r.recordKind) &&
        typeof r.proposition === "string" &&
        ["active", "stale", "proposed", "superseded", "disputed"].includes(
          r.status,
        ),
      "Invalid story record.",
    );
  if (r.type === "entity")
    assert(
      ["person", "place", "group", "descriptor", "title"].includes(r.kind) &&
        typeof r.displayName === "string",
      "Invalid entity.",
    );
  if (r.type === "exploration")
    assert(
      typeof r.baseRevisionId === "string" &&
        typeof r.activeBranchId === "string",
      "Invalid exploration.",
    );
  return r;
}
/** Validate the entire graph before any restore transaction opens. */
export function validateBackup(data) {
  assert(
    data?.format === "cozyNovel.backup" && data.schemaVersion === APP.schema,
    "This is not a supported Cozy Novel backup. RP backups cannot be restored here.",
  );
  assert(
    data.library?.id &&
      data.library?.generation &&
      Array.isArray(data.records) &&
      Array.isArray(data.blobs),
    "Incomplete backup.",
  );
  assert(
    data.records.length <= 1000000 && data.blobs.length <= 1000000,
    "Backup has too many records.",
  );
  const records = new Map(),
    blobs = new Map();
  for (const r of data.records) {
    validateRecord(r);
    assert(!records.has(r.id), "Duplicate record identity.");
    records.set(r.id, r);
  }
  for (const b of data.blobs) {
    assert(
      typeof b.id === "string" &&
        typeof b.text === "string" &&
        !blobs.has(b.id),
      "Invalid text body.",
    );
    blobs.set(b.id, b);
  }
  const ref = (key, type, novelId) => {
    const v = records.get(key);
    assert(
      v && (!type || v.type === type) && (!novelId || v.novelId === novelId),
      `Missing or foreign reference: ${key}`,
    );
    return v;
  };
  for (const r of records.values()) {
    const n = ref(r.novelId, "novel");
    assert(n.libraryId === data.library.id, "Foreign library ownership.");
    if (r.textBlobId) assert(blobs.has(r.textBlobId), "Missing text body.");
    if (r.type === "novel") {
      for (const c of r.orderedChapterIds) ref(c, "chapter", n.id);
    }
    if (r.type === "chapter") {
      for (const s of r.orderedSceneIds)
        assert(
          ref(s, "scene", n.id).chapterId === r.id,
          "Scene in wrong chapter.",
        );
    }
    if (r.type === "scene") {
      ref(r.chapterId, "chapter", n.id);
      assert(
        ref(r.currentRevisionId, "revision", n.id).ownerId === r.id,
        "Wrong revision owner.",
      );
    }
    if (r.type === "revision") {
      ref(r.ownerId, "scene", n.id);
      if (r.parentRevisionId)
        assert(
          ref(r.parentRevisionId, "revision", n.id).ownerId === r.ownerId,
          "Wrong revision ancestry.",
        );
    }
    if (r.baseRevisionId) ref(r.baseRevisionId, "revision", n.id);
    if (r.sceneId) ref(r.sceneId, "scene", n.id);
    if (r.baseSceneId)
      assert(
        ref(r.baseRevisionId, "revision", n.id).ownerId ===
          ref(r.baseSceneId, "scene", n.id).id,
        "Wrong exploration source.",
      );
    if (r.type === "candidate") {
      const rev = ref(r.baseRevisionId, "revision", n.id),
        txt = blobs.get(rev.textBlobId).text;
      assert(
        rev.ownerId === r.sceneId &&
          r.insertionRange.length === 2 &&
          r.insertionRange.every(Number.isInteger) &&
          r.insertionRange[0] >= 0 &&
          r.insertionRange[1] >= r.insertionRange[0] &&
          r.insertionRange[1] <= txt.length,
        "Invalid candidate range.",
      );
      assert(
        txt.slice(...r.insertionRange) === r.originalSelection,
        "Candidate selection does not match.",
      );
    }
    if (r.type === "exploration") {
      const branches = new Map((r.branches || []).map((b) => [b.id, b]));
      assert(
        branches.size === (r.branches || []).length &&
          branches.has(r.activeBranchId),
        "Invalid exploration branches.",
      );
      const original = ref(r.baseRevisionId, "revision", n.id);
      assert(
        Number.isInteger(r.boundary) &&
          r.boundary >= 0 &&
          r.boundary <= blobs.get(original.textBlobId).text.length,
        "Invalid exploration boundary.",
      );
      for (const branch of branches.values()) {
        const seen = new Set();
        let cursor = branch;
        while (cursor) {
          assert(!seen.has(cursor.id), "Cyclic exploration branch.");
          seen.add(cursor.id);
          assert(
            Number.isInteger(cursor.forkSequence) && cursor.forkSequence >= 0,
            "Invalid branch sequence.",
          );
          if (!cursor.parentId) break;
          cursor = branches.get(cursor.parentId);
          assert(cursor, "Missing parent branch.");
        }
      }
    }
    if (r.type === "turn") {
      const ex = ref(r.parentSessionId, "exploration", n.id);
      assert(
        ex.branches.some((b) => b.id === r.branchId) &&
          Number.isInteger(r.sequence) &&
          r.sequence > 0,
        "Invalid exploration turn.",
      );
    }
    if (r.profileRevisionId) ref(r.profileRevisionId, "artifact", n.id);
    if (r.parentProfileRevisionId)
      ref(r.parentProfileRevisionId, "artifact", n.id);
    if (r.parentSessionId) ref(r.parentSessionId, "exploration", n.id);
    if (r.explorationId) ref(r.explorationId, "exploration", n.id);
    for (const k of ["subjectId", "holderId", "playerCharacterId", "actorId"])
      if (r[k]) ref(r[k], "entity", n.id);
    for (const s of r.sourceRefs || []) {
      const v = ref(s.id, null, n.id);
      if (s.revisionId) ref(s.revisionId, "revision", n.id);
      if (s.start != null) {
        const rev = ref(s.revisionId || s.id, "revision", n.id);
        const t = blobs.get(rev.textBlobId)?.text;
        assert(
          Number.isInteger(s.start) &&
            Number.isInteger(s.end) &&
            s.start >= 0 &&
            s.end >= s.start &&
            s.end <= t.length,
          "Invalid source range.",
        );
      }
    }
  }
  for (const revision of records.values())
    if (revision.type === "revision") {
      const seen = new Set();
      let cursor = revision;
      while (cursor) {
        assert(!seen.has(cursor.id), "Cyclic revision history.");
        seen.add(cursor.id);
        cursor = cursor.parentRevisionId
          ? records.get(cursor.parentRevisionId)
          : null;
      }
    }
  return data;
}
