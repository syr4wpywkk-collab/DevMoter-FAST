import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createOfficeStore } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-ai-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}
const identity = { ownerId: "owner:test" };
const aiWith = (store, reply, shared) =>
  createOfficeAi({
    store,
    authorize: async () => {},
    prepareChat: async () => ({
      context: { planner: { providerName: "Mock", model: "test" } },
      secrets: [],
      chat: async (messages) => {
        if (shared) shared.messages = messages;
        return typeof reply === "function" ? reply(messages) : reply;
      },
    }),
  });
const settled = async (ai, id, statuses) => {
  for (let i = 0; i < 200; i++) {
    const run = ai.get(id, identity);
    if (statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  return ai.get(id, identity);
};
test("Office AI generation builds an openable docx matching the spec structure", async (t) => {
  const { store } = await setup(t);
  const spec = {
    title: "Launch Plan",
    sections: [
      { heading: "Goals", level: 2, paragraphs: ["Ship the beta.", "Collect feedback."] },
      { heading: "Timeline", paragraphs: ["Week one: rollout."] },
    ],
  };
  const ai = aiWith(store, JSON.stringify(spec));
  const started = await ai.generate(
    { goal: "Write a launch plan", share: true },
    identity,
  );
  const run = await settled(ai, started.id, ["created", "failed", "stopped"]);
  assert.equal(run.status, "created", run.error);
  assert.equal(run.name, "Launch Plan.docx");
  const doc = await store.get(run.createdDocumentId);
  // Re-project the stored document: it must open and carry the spec's structure.
  const visible = doc.blocks.filter((b) => b.text);
  assert.deepEqual(
    visible.map((b) => [b.type, b.level ?? null, b.text]),
    [
      ["heading", 1, "Launch Plan"],
      ["heading", 2, "Goals"],
      ["paragraph", null, "Ship the beta."],
      ["paragraph", null, "Collect feedback."],
      ["heading", 2, "Timeline"],
      ["paragraph", null, "Week one: rollout."],
    ],
  );
  const { bytes } = await store.download(run.createdDocumentId);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /Launch Plan/);
});
test("Office AI generation rejects malformed model output without writing", async (t) => {
  const { store } = await setup(t);
  for (const raw of [
    "not json",
    '{"title":"","sections":[]}',
    '{"title":"T","sections":[{"heading":"H","paragraphs":[]}]}',
    '{"title":"T","sections":[{"heading":"H","paragraphs":["ok"]}],"extra":1}',
  ]) {
    const ai = aiWith(store, raw);
    const started = await ai.generate({ goal: "Draft", share: true }, identity);
    const run = await settled(ai, started.id, ["created", "failed"]);
    assert.equal(run.status, "failed", raw);
  }
  assert.equal((await store.list()).length, 0);
});
test("Office AI Q&A is read-only over the projection and performs no store writes", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("Notes.docx");
  const block = doc.blocks.find((b) => b.editable);
  const saved = await store.save(doc.id, doc.revision, [
    { id: block.id, type: "paragraph", runs: [{ text: "The launch is on Friday." }] },
  ]);
  let writes = 0;
  const counting = new Proxy(store, {
    get: (target, key) => {
      const value = target[key];
      if (["create", "blank", "save", "rename", "remove", "restore"].includes(key))
        return (...args) => {
          writes++;
          return value.apply(target, args);
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const shared = {};
  const ai = aiWith(counting, "It is on Friday.", shared);
  const started = await ai.ask(
    {
      documentId: saved.id,
      revision: saved.revision,
      goal: "When is the launch?",
      share: true,
    },
    identity,
  );
  const run = await settled(ai, started.id, ["answered", "failed"]);
  assert.equal(run.status, "answered", run.error);
  assert.equal(run.answer, "It is on Friday.");
  assert.equal(writes, 0);
  assert.equal((await store.get(doc.id)).revision, saved.revision);
  assert.match(JSON.stringify(shared.messages), /launch is on Friday/);
});
test("Office AI shaping proposes validated structure edits and rejects a stale revision", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("Report.docx");
  const block = doc.blocks.find((b) => b.editable);
  const saved = await store.save(doc.id, doc.revision, [
    { id: block.id, type: "paragraph", runs: [{ text: "Summary" }] },
    { type: "paragraph", runs: [{ text: "Details here." }] },
  ]);
  const target = saved.blocks.find((b) => b.text === "Summary");
  // Stale revision is rejected before the model is even called.
  const stale = aiWith(store, "{}");
  await assert.rejects(
    stale.start(
      {
        mode: "shape",
        documentId: saved.id,
        revision: doc.revision,
        goal: "Normalize headings",
        share: true,
      },
      identity,
    ),
    (e) => e.status === 409,
  );
  const ai = aiWith(
    store,
    JSON.stringify({ edits: [{ blockId: target.id, type: "heading", level: 2 }] }),
  );
  const started = await ai.start(
    {
      mode: "shape",
      documentId: saved.id,
      revision: saved.revision,
      goal: "Normalize headings",
      share: true,
    },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed"]);
  assert.equal(run.status, "proposed", run.error);
  assert.deepEqual(run.edits, [
    { blockId: target.id, type: "heading", level: 2 },
  ]);
  // A proposal is never a write: the stored document is unchanged.
  assert.equal((await store.get(doc.id)).revision, saved.revision);
  // Invalid shaping output fails validation instead of proposing.
  const bad = aiWith(
    store,
    JSON.stringify({ edits: [{ blockId: target.id, type: "heading", level: 42 }] }),
  );
  const failedStart = await bad.start(
    {
      mode: "shape",
      documentId: saved.id,
      revision: saved.revision,
      goal: "Normalize headings",
      share: true,
    },
    identity,
  );
  const failed = await settled(bad, failedStart.id, ["proposed", "failed"]);
  assert.equal(failed.status, "failed");
});
test("Office AI Q&A requires consent and a current revision", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("Doc.docx");
  const ai = aiWith(store, "answer");
  await assert.rejects(
    ai.ask(
      { documentId: doc.id, revision: doc.revision, goal: "q", share: false },
      identity,
    ),
  );
  await assert.rejects(
    ai.ask(
      { documentId: doc.id, revision: "stale", goal: "q", share: true },
      identity,
    ),
    (e) => e.status === 409,
  );
});
