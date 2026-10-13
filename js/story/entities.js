import { id, now } from "../core/ids.js";
export async function saveEntity(repo, entity, changes = {}) {
  const previous = await repo.get(entity.id),
    records = [];
  let parent = previous?.profileRevisionId || null;
  if (previous && !parent) {
    parent = id("artifact");
    records.push({
      id: parent,
      type: "artifact",
      novelId: entity.novelId,
      kind: "entityProfile",
      entityId: entity.id,
      body: {
        displayName: previous.displayName,
        aliases: previous.aliases,
        kind: previous.kind,
        profile: previous.profile,
        invariantProfile: previous.invariantProfile,
        profileClaims: previous.profileClaims,
        profileScope: previous.profileScope,
      },
      createdAt: now(),
      sourceRefs: [],
    });
  }
  const next = { ...entity, ...changes },
    revisionId = id("artifact");
  records.push(
    { ...next, profileRevisionId: revisionId },
    {
      id: revisionId,
      type: "artifact",
      novelId: entity.novelId,
      kind: "entityProfile",
      entityId: entity.id,
      parentProfileRevisionId: parent,
      body: {
        displayName: next.displayName,
        aliases: next.aliases,
        kind: next.kind,
        profile: next.profile,
        invariantProfile: next.invariantProfile,
        profileClaims: next.profileClaims,
        profileScope: next.profileScope,
      },
      createdAt: now(),
      sourceRefs: [],
    },
  );
  await repo.commit({
    novelId: entity.novelId,
    kind: previous ? "entity.profile" : "entity.create",
    expectedRecord: previous
      ? { id: entity.id, version: entity.recordVersion || 0 }
      : undefined,
    records,
  });
  return records.at(-2);
}
