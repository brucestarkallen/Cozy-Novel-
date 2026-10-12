import test from "node:test";
import assert from "node:assert/strict";
import {
  assemble,
  eligible,
  estimateTokens,
} from "../../js/context/assemble.js";
import { DEFAULT_STYLE } from "../../js/config.js";
import { serialize } from "../../js/ai/providers/adapters.js";
function fixture(count = 4, size = 300) {
  const records = [
    {
      id: "n",
      type: "novel",
      styleProfile: DEFAULT_STYLE,
      premise: "A quiet town",
      novelId: "n",
    },
    {
      id: "s",
      type: "scene",
      novelId: "n",
      chapterId: "ch",
      currentRevisionId: "r",
      title: "Café",
      fictionalTime: 10,
      notes: "",
      summary: "",
    },
    { id: "r", type: "revision", novelId: "n", textBlobId: "b", ownerId: "s" },
    {
      id: "a",
      type: "entity",
      novelId: "n",
      kind: "person",
      displayName: "A",
      profile: "",
    },
    {
      id: "bPerson",
      type: "entity",
      novelId: "n",
      kind: "person",
      displayName: "B",
      profile: "",
    },
    {
      id: "c",
      type: "entity",
      novelId: "n",
      kind: "person",
      displayName: "C",
      profile: "",
    },
    {
      id: "kA",
      type: "canon",
      novelId: "n",
      status: "active",
      recordKind: "knowledge",
      holderId: "a",
      proposition: "The locked box contains a letter.",
      validFrom: 1,
      certainty: "certain",
    },
    {
      id: "kB",
      type: "canon",
      novelId: "n",
      status: "active",
      recordKind: "belief",
      holderId: "bPerson",
      proposition: "B suspects the box contains coins.",
      validFrom: 2,
      certainty: "suspicion",
    },
    {
      id: "kC",
      type: "canon",
      novelId: "n",
      status: "active",
      recordKind: "knowledge",
      holderId: "c",
      proposition: "C learns the hidden letter is in the box.",
      validFrom: 20,
      certainty: "certain",
    },
    {
      id: "plan",
      type: "canon",
      novelId: "n",
      status: "active",
      recordKind: "plan",
      proposition: "A will return the umbrella only if B arrives before dusk.",
      validFrom: 1,
    },
  ];
  const blobs = { b: "A and B met C at the café." };
  for (let i = 0; i < count; i++) {
    records.push(
      {
        id: "s" + i,
        type: "scene",
        novelId: "n",
        chapterId: "old",
        title: "Earlier",
        fictionalTime: i === 0 ? 1 : 5,
        currentRevisionId: "r" + i,
      },
      {
        id: "r" + i,
        type: "revision",
        novelId: "n",
        textBlobId: "b" + i,
        ownerId: "s" + i,
      },
    );
    blobs["b" + i] =
      i === 0
        ? "A promised to return the umbrella only if B arrived before dusk."
        : "Unrelated garden descriptions. ".repeat(size);
  }
  return {
    records,
    repo: {
      get: async (id) =>
        id === "library"
          ? { generation: "g" }
          : records.find((r) => r.id === id),
      query: async () => records,
      sceneText: async () => ({
        scene: records[1],
        revision: records[2],
        text: blobs.b,
      }),
      text: async (id) => blobs[id],
    },
    blobs,
  };
}
const connection = {
  adapter: "chat",
  model: "fixture",
  contextLimit: 32000,
  outputLimit: 2000,
  capabilityConfirmed: true,
  capabilities: {},
};
test("earlier knowledge, suspicion, future learning and conditional plans remain distinct in wire payload", async () => {
  const { repo } = fixture();
  const c = await assemble(repo, {
    novelId: "n",
    sceneId: "s",
    kind: "rp",
    direction: "What about the umbrella?",
    connection,
    exploration: {
      playerCharacterId: "bPerson",
      narrativeViewpoint: "B",
      baseRevisionId: "r",
      boundary: 100,
    },
  });
  const wire = JSON.stringify(serialize(connection, c));
  assert.match(wire, /B suspects/);
  assert.match(wire, /suspicion/);
  assert.match(wire, /locked box/);
  assert.doesNotMatch(wire, /C learns the hidden letter/);
  assert.match(wire, /only if B arrives before dusk/);
  assert.match(wire, /umbrella only if B arrived/);
});
test("flashback excludes later learning and unknown chronology", () => {
  assert.equal(eligible({ validFrom: 20 }, 10), false);
  assert.equal(eligible({ validFrom: 20 }, null), false);
  assert.equal(eligible({ validFrom: 20 }, 25), true);
});
test("mandatory author requirements cannot be silently truncated", async () => {
  const { repo, records } = fixture();
  records[0].premise = "Required constraint ".repeat(5000);
  await assert.rejects(
    assemble(repo, {
      novelId: "n",
      sceneId: "s",
      kind: "write",
      direction: "Go",
      connection: { ...connection, contextLimit: 2048, outputLimit: 500 },
    }),
    /exceed/,
  );
});
test("large synthetic selection retains old promise within 200k and 500k budgets", async (t) => {
  const { repo, blobs } = fixture(100, 1000);
  for (const limit of [200000, 500000]) {
    const start = performance.now(),
      c = await assemble(repo, {
        novelId: "n",
        sceneId: "s",
        kind: "write",
        direction: "Resolve the old umbrella promise",
        connection: { ...connection, contextLimit: limit },
      });
    assert.ok(c.snapshot.sourceIds.includes("r0"));
    assert.ok(
      c.snapshot.inputEstimate +
        c.snapshot.outputAllowance +
        c.snapshot.reasoningReserve +
        c.snapshot.safetyMargin <=
        limit,
    );
    assert.equal(
      c.snapshot.inputEstimate,
      estimateTokens(serialize({ ...connection, contextLimit: limit }, c)),
    );
    t.diagnostic(
      JSON.stringify({
        fixtureCharacters: Object.values(blobs).reduce(
          (n, s) => n + s.length,
          0,
        ),
        limit,
        inputEstimate: c.snapshot.inputEstimate,
        selectedSources: c.snapshot.sourceIds.length,
        elapsedMs: Math.round(performance.now() - start),
      }),
    );
  }
});

test("dense pinned sources respect large budgets, while unpinned irrelevance stays omitted", async (t) => {
  const { repo, records, blobs } = fixture(100, 1000);
  for (const r of records)
    if (r.type === "scene" && r.id !== "s") r.pinned = true;
  for (const limit of [200000, 500000]) {
    const start = performance.now();
    const c = await assemble(repo, {
      novelId: "n",
      sceneId: "s",
      kind: "write",
      direction: "Resolve the old umbrella promise",
      connection: { ...connection, contextLimit: limit },
    });
    assert.ok(c.snapshot.sourceIds.includes("r0"));
    assert.ok(
      c.snapshot.inputEstimate +
        c.snapshot.outputAllowance +
        c.snapshot.reasoningReserve +
        c.snapshot.safetyMargin <=
        limit,
    );
    t.diagnostic(
      JSON.stringify({
        fixtureCharacters: Object.values(blobs).reduce(
          (n, s) => n + s.length,
          0,
        ),
        pinned: true,
        limit,
        inputEstimate: c.snapshot.inputEstimate,
        selectedSources: c.snapshot.sourceIds.length,
        elapsedMs: Math.round(performance.now() - start),
      }),
    );
  }
});

test("author corrections respect their effective fictional time", async () => {
  const { repo, records } = fixture();
  records.push(
    {
      id: "oldFact",
      type: "canon",
      novelId: "n",
      status: "superseded",
      supersededFrom: 20,
      recordKind: "authorFact",
      proposition: "OLD_SCOPED_FACT",
      validFrom: 1,
    },
    {
      id: "newFact",
      type: "canon",
      novelId: "n",
      status: "active",
      recordKind: "authorFact",
      proposition: "NEW_SCOPED_FACT",
      validFrom: 20,
    },
  );
  const early = await assemble(repo, {
    novelId: "n",
    sceneId: "s",
    kind: "write",
    direction: "Continue",
    connection,
  });
  assert.match(early.user, /OLD_SCOPED_FACT/);
  assert.doesNotMatch(early.user, /NEW_SCOPED_FACT/);
  records[1].fictionalTime = 25;
  const later = await assemble(repo, {
    novelId: "n",
    sceneId: "s",
    kind: "write",
    direction: "Continue",
    connection,
  });
  assert.match(later.user, /NEW_SCOPED_FACT/);
  assert.doesNotMatch(later.user, /OLD_SCOPED_FACT/);
});
test("an exploration inside a scene excludes unbounded knowledge from later in that scene", async () => {
  const { repo, records } = fixture();
  records.push({
    id: "revelation",
    type: "canon",
    novelId: "n",
    status: "active",
    recordKind: "knowledge",
    holderId: "c",
    proposition: "LATER_WITHIN_SCENE_SECRET",
    validFrom: 10,
    sourceRefs: [{ id: "r", start: 15, end: 25 }],
  });
  const c = await assemble(repo, {
    novelId: "n",
    sceneId: "s",
    kind: "rp",
    direction: "Continue",
    connection,
    exploration: {
      playerCharacterId: "bPerson",
      baseRevisionId: "r",
      boundary: 5,
    },
  });
  assert.doesNotMatch(c.user, /LATER_WITHIN_SCENE_SECRET/);
  assert.ok(c.snapshot.omitted.some((x) => x.id === "revelation"));
});
