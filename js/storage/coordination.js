import { assert } from "../core/schema.js";
export async function coordinated(dbName, lane, fn, { required = false } = {}) {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    assert(
      !required,
      "This browser cannot coordinate a safe device restore. Download both copies and use a browser with Web Locks.",
    );
    return fn();
  }
  return locks.request("cozynovel." + dbName + "." + lane, fn);
}
export const semanticTypes = new Set([
  "scene",
  "chapter",
  "entity",
  "canon",
  "prompt",
  "exploration",
  "turn",
]);
export function material(record, previous) {
  if (semanticTypes.has(record.type))
    return JSON.stringify(record) !== JSON.stringify(previous);
  if (record.type === "novel")
    return (
      JSON.stringify([
        record.premise,
        record.styleProfile,
        record.orderedChapterIds,
      ]) !==
      JSON.stringify([
        previous?.premise,
        previous?.styleProfile,
        previous?.orderedChapterIds,
      ])
    );
  return (
    record.type === "artifact" &&
    ["entityProfile", "storySummary", "branchReading", "branchFrame"].includes(
      record.kind,
    )
  );
}
