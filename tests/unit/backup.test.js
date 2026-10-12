import test from "node:test";
import assert from "node:assert/strict";
import { validateBackup } from "../../js/core/schema.js";
import { textBlob } from "../../js/core/ids.js";
test("portable validation rejects wrong source ownership and invalid selection ranges", async () => {
  const b = await textBlob("Rain ☕\n"),
    records = [
      {
        id: "n",
        type: "novel",
        novelId: "n",
        libraryId: "l",
        orderedChapterIds: ["c"],
        contentVersion: 1,
      },
      { id: "c", type: "chapter", novelId: "n", orderedSceneIds: ["s"] },
      {
        id: "s",
        type: "scene",
        novelId: "n",
        chapterId: "c",
        currentRevisionId: "r",
      },
      {
        id: "r",
        type: "revision",
        novelId: "n",
        ownerId: "s",
        textBlobId: b.id,
        parentRevisionId: null,
      },
      {
        id: "x",
        type: "candidate",
        novelId: "n",
        sceneId: "s",
        baseRevisionId: "r",
        insertionRange: [0, 4],
        originalSelection: "Rain",
        textBlobId: b.id,
        status: "ready",
      },
    ];
  const backup = {
    format: "cozyNovel.backup",
    schemaVersion: 1,
    library: { id: "l", generation: "g" },
    records,
    blobs: [b],
  };
  assert.equal(validateBackup(backup), backup);
  const bad = structuredClone(backup);
  bad.records.at(-1).insertionRange = [0, 999];
  assert.throws(() => validateBackup(bad), /range/);
  const cross = structuredClone(backup);
  cross.records.at(-1).novelId = "other";
  assert.throws(() => validateBackup(cross), /reference/);
});

test("restore rejects cyclic revision ancestry before writing", async () => {
  const b = await textBlob("source");
  const backup = {
    format: "cozyNovel.backup",
    schemaVersion: 1,
    library: { id: "l", generation: "g" },
    blobs: [b],
    records: [
      {
        id: "n",
        type: "novel",
        novelId: "n",
        libraryId: "l",
        orderedChapterIds: ["c"],
        contentVersion: 1,
      },
      { id: "c", type: "chapter", novelId: "n", orderedSceneIds: ["s"] },
      {
        id: "s",
        type: "scene",
        novelId: "n",
        chapterId: "c",
        currentRevisionId: "r",
      },
      {
        id: "r",
        type: "revision",
        novelId: "n",
        ownerId: "s",
        textBlobId: b.id,
        parentRevisionId: "r",
      },
    ],
  };
  assert.throws(() => validateBackup(backup), /Cyclic revision/);
});
