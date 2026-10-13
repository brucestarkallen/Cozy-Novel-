import { textBlob, now, id } from "../core/ids.js";
export async function draftIdentity(owner) {
  return (
    "artifact_draft_" +
    (
      await textBlob(
        JSON.stringify([
          owner.novelId,
          owner.ownerId,
          owner.kind,
          owner.branchId || null,
          owner.actorId || null,
          owner.actionMode || null,
        ]),
      )
    ).id.slice(5)
  );
}
// Creative input is recoverable working material, never an established story source.
export class Drafts {
  constructor(repo, onError = () => {}, onStatus = () => {}) {
    this.repo = repo;
    this.onError = onError;
    this.onStatus = onStatus;
    this.bindings = new Set();
  }
  async bind(input, owner) {
    const initialText = input.value;
    const key = await draftIdentity(owner);
    for (const b of [...this.bindings].filter((b) => b.key === key)) {
      await b.save();
      clearTimeout(b.timer);
      b.input.removeEventListener("input", b.changed);
      this.bindings.delete(b);
    }
    const binding = {
      input,
      owner,
      key,
      pending: false,
      serial: Promise.resolve(),
      version: 0,
    };
    const prior = await this.repo.get(key);
    binding.version = prior?.recordVersion || 0;
    const stored = prior ? await this.repo.text(prior.textBlobId) : null;
    const changedDuringLoad = input.value !== initialText;
    if (stored != null && !changedDuringLoad) input.value = stored;
    this.bindings.add(binding);
    const save = async () => {
      clearTimeout(binding.timer);
      if (!binding.pending) return binding.serial;
      const text = input.value;
      binding.pending = false;
      binding.saving = true;
      binding.serial = binding.serial
        .catch(() => {})
        .then(async () => {
          const blob = await textBlob(text);
          await this.repo.withMutation(async () => {
            const latest = await this.repo.get(key);
            if (latest?.textBlobId === blob.id) {
              binding.version = latest.recordVersion || 0;
              return;
            }
            if (latest && (latest.recordVersion || 0) !== binding.version) {
              const conflict = {
                id: id("artifact"),
                type: "artifact",
                novelId: owner.novelId,
                kind: "creativeDraftConflict",
                ownerId: owner.ownerId,
                draftKind: owner.kind,
                textBlobId: blob.id,
                sourceRefs: [],
                createdAt: now(),
              };
              await this.repo.commitLocked({
                novelId: owner.novelId,
                kind: "draft.conflict",
                records: [conflict],
                blobs: [blob],
              });
              throw new Error(
                "This creative draft changed in another tab. Both inputs are retained in Draft recovery. Your visible input stays here.",
              );
            }
            const record = {
              id: key,
              type: "artifact",
              novelId: owner.novelId,
              kind: "creativeDraft",
              ownerId: owner.ownerId,
              draftKind: owner.kind,
              ...(owner.actorId ? { actorId: owner.actorId } : {}),
              ...(owner.actionMode ? { actionMode: owner.actionMode } : {}),
              textBlobId: blob.id,
              sourceRefs: [],
              updatedAt: now(),
              ...(owner.explorationId
                ? {
                    explorationId: owner.explorationId,
                    branchId: owner.branchId,
                  }
                : {}),
            };
            await this.repo.commitLocked({
              novelId: owner.novelId,
              kind: "draft.save",
              records: [record],
              blobs: [blob],
            });
            binding.version = (await this.repo.get(key)).recordVersion;
            this.onStatus("Creative draft saved in browser");
          });
        })
        .catch((e) => {
          binding.pending = true;
          this.onStatus("Draft save failed, visible input retained");
          this.onError(e);
          throw e;
        })
        .finally(() => {
          binding.saving = false;
        });
      return binding.serial;
    };
    binding.save = save;
    binding.changed = () => {
      binding.pending = true;
      this.onStatus("Creative draft saving");
      clearTimeout(binding.timer);
      binding.timer = setTimeout(() => save().catch(() => {}), 250);
    };
    input.addEventListener("input", binding.changed);
    if (changedDuringLoad) binding.changed();
    return {
      save,
      mark: binding.changed,
      release: async () => {
        await save();
        clearTimeout(binding.timer);
        input.removeEventListener("input", binding.changed);
        this.bindings.delete(binding);
      },
    };
  }
  async flush() {
    await Promise.all([...this.bindings].map((b) => b.save()));
  }
  get pending() {
    return [...this.bindings].some((b) => b.pending || b.saving);
  }
  dispose() {
    for (const b of this.bindings) {
      clearTimeout(b.timer);
      b.input.removeEventListener("input", b.changed);
    }
    this.bindings.clear();
  }
}
