// PPTX store + outline projection + ops: a deck rendered by the vendored
// @devmoter/pptx engine is stored, outlined, edited via ops (replaceText,
// add/duplicate/move/remove slide) and re-outlined; AI edit/shape/generate
// run through the same proposal boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfficeStore } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";
import { renderPlan, readOutline } from "../server/office/pptx-engine.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-pptx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}

const PLAN = {
  title: "Quarterly Review",
  slides: [
    { intent: "title", heading: "Quarterly Review", bullets: ["FY26 Q3"], notes: "Open with wins." },
    { intent: "concept", heading: "Highlights", bullets: ["Revenue up 12%", "Churn down"] },
    {
      intent: "data",
      heading: "Numbers",
      table: { header: ["KPI", "Value"], rows: [["ARR", "1.2M"], ["NPS", "54"]] },
    },
    { intent: "closing", heading: "Next steps", bullets: ["Hire two SREs"] },
  ],
};
const fixture = () => renderPlan(PLAN);
const textsOf = (doc) => doc.slides.map((s) => s.texts.map((t) => t.text).join("\n"));

const identity = { ownerId: "owner:test" };
const aiWith = (store, reply) =>
  createOfficeAi({
    store,
    authorize: async () => {},
    prepareChat: async () => ({
      context: { planner: { providerName: "Mock", model: "test" } },
      secrets: [],
      chat: async () => reply,
    }),
  });
const settled = async (ai, id, statuses) => {
  for (let i = 0; i < 400; i++) {
    const run = ai.get(id, identity);
    if (statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  return ai.get(id, identity);
};

test("PPTX upload is stored, outlined and projected as slides", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("review.pptx", Buffer.from(await fixture()));
  assert.equal(doc.format, "pptx");
  assert.equal(doc.slideCount, 4);
  const texts = textsOf(doc);
  assert.match(texts[0], /Quarterly Review/);
  assert.match(texts[1], /Revenue up 12%/);
  assert.deepEqual(doc.slides[2].tables[0].rows, [
    ["KPI", "Value"],
    ["ARR", "1.2M"],
    ["NPS", "54"],
  ]);
  assert.equal(doc.slides[0].notes, "Open with wins.");
  const opened = await store.open(doc.id);
  assert.equal(opened.slideCount, 4);
});

test("PPTX replaceText op round-trips through a new revision", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("review.pptx", Buffer.from(await fixture()));
  const saved = await store.saveOps(doc.id, doc.revision, [
    { type: "replaceText", from: "Revenue up 12%", to: "Revenue up 15%" },
  ]);
  assert.notEqual(saved.revision, doc.revision);
  assert.equal(saved.history.at(-1).source, "edit");
  assert.match(textsOf(saved)[1], /Revenue up 15%/);
  // Re-open the stored bytes and outline them: the new text survives.
  const { bytes } = await store.download(doc.id);
  const outline = await readOutline(new Uint8Array(bytes));
  assert.match(JSON.stringify(outline), /Revenue up 15%/);
});

test("PPTX slide ops: add, duplicate, move, remove", async (t) => {
  const { store } = await setup(t);
  let doc = await store.create("review.pptx", Buffer.from(await fixture()));
  doc = await store.saveOps(doc.id, doc.revision, [{ type: "addSlide" }]);
  assert.equal(doc.slideCount, 5);
  doc = await store.saveOps(doc.id, doc.revision, [{ type: "duplicateSlide", index: 0 }]);
  assert.equal(doc.slideCount, 6);
  assert.deepEqual(textsOf(doc)[1], textsOf(doc)[0]);
  doc = await store.saveOps(doc.id, doc.revision, [{ type: "moveSlide", from: 0, to: 2 }]);
  assert.match(textsOf(doc)[2], /Quarterly Review/);
  doc = await store.saveOps(doc.id, doc.revision, [{ type: "removeSlide", index: 0 }]);
  assert.equal(doc.slideCount, 5);
  assert.match(textsOf(doc)[1], /Quarterly Review/);
  await assert.rejects(
    () => store.saveOps(doc.id, doc.revision, [{ type: "moveSlide", from: 0, to: 99 }]),
    /移動/,
  );
});

test("PPTX generation from a fixed DeckPlan produces a readable deck", async (t) => {
  const { store } = await setup(t);
  const ai = aiWith(store, JSON.stringify(PLAN));
  const started = await ai.generate(
    { goal: "Make a quarterly review deck", share: true, format: "pptx" },
    identity,
  );
  const run = await settled(ai, started.id, ["created", "failed", "stopped"]);
  assert.equal(run.status, "created", run.error);
  assert.equal(run.name, "Quarterly Review.pptx");
  const doc = await store.get(run.createdDocumentId);
  assert.equal(doc.format, "pptx");
  assert.equal(doc.slideCount, 4);
  assert.match(textsOf(doc)[0], /Quarterly Review/);
  // Re-outline the stored bytes independently.
  const { bytes } = await store.download(run.createdDocumentId);
  const outline = await readOutline(new Uint8Array(bytes));
  assert.equal(outline.slideCount, 4);
});

test("PPTX AI text proposals become validated ops; stale revisions are rejected", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("review.pptx", Buffer.from(await fixture()));
  const ai = aiWith(
    store,
    JSON.stringify({
      ops: [{ type: "replaceText", from: "Churn down", to: "Churn down 3pt" }],
    }),
  );
  const started = await ai.start(
    {
      goal: "Tighten the highlights slide",
      share: true,
      mode: "edit",
      documentId: doc.id,
      revision: doc.revision,
    },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed", "stopped"]);
  assert.equal(run.status, "proposed", run.error);
  assert.deepEqual(run.edits, [
    { type: "replaceText", from: "Churn down", to: "Churn down 3pt" },
  ]);
  // A concurrent edit makes the proposal's revision stale: apply is rejected.
  await store.saveOps(doc.id, doc.revision, [{ type: "addSlide" }]);
  await assert.rejects(
    () => store.validateOps(doc.id, doc.revision, run.edits),
    (error) => error.status === 409,
  );
  await assert.rejects(
    () => store.saveOps(doc.id, doc.revision, run.edits),
    (error) => error.status === 409,
  );
});

test("PPTX AI ask answers over the outline without writes", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("review.pptx", Buffer.from(await fixture()));
  const ai = aiWith(store, "Revenue is up 12% and churn is down.");
  const started = await ai.ask(
    { goal: "How is the quarter?", share: true, documentId: doc.id, revision: doc.revision },
    identity,
  );
  const run = await settled(ai, started.id, ["answered", "failed", "stopped"]);
  assert.equal(run.status, "answered", run.error);
  assert.match(run.answer, /Revenue/);
});
