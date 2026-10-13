import { textBlob } from "./ids.js";
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
export const digest = async (value) =>
  (await textBlob(JSON.stringify(stable(value)))).id;
export async function recordManifest(records) {
  return Promise.all(
    records
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(async (r) => ({ id: r.id, hash: await digest(r) })),
  );
}
