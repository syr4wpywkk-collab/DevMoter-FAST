// Cross-format AI entry + end-to-end coverage (INT-7): for each of the four
// classified formats a fixture is ingested, projected, run through a stubbed
// AI proposal, applied and saved, then re-projected and asserted. Generation
// covers all four formats through the single create-with-AI entry, and the
// library classification filter reports all four.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createOfficeStore } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";
import { renderPlan, readOutline } from "../server/office/pptx-engine.mjs";
import { writeWorkbook } from "../server/office/xlsx-engine.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-ai-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}
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

const DECK_PLAN = {
  title: "Status Deck",
  slides: [
    { intent: "title", heading: "Status Deck", bullets: ["Week 12"] },
    { intent: "concept", heading: "Progress", bullets: ["Milestone reached"] },
  ],
};
const pptxFixture = () => renderPlan(DECK_PLAN);
const xlsxFixture = () =>
  writeWorkbook({
    sheets: [
      {
        name: "Summary",
        cells: new Map([
          ["A1", { value: "Item" }],
          ["B1", { value: "Qty" }],
          ["A2", { value: "Bolts" }],
          ["B2", { value: 12 }],
        ]),
      },
    ],
  });
const pdfFixture = async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText("Alpha report body", { x: 40, y: 200, size: 14, font });
  return doc.save();
};

test("DOCX end-to-end: ingest, project, AI-propose, apply, save, re-project", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("Memo.docx");
  const seeded = await store.save(doc.id, doc.revision, [
    { type: "paragraph", runs: [{ text: "The launch is Tuseday." }] },
  ]);
  const target = seeded.blocks.find((b) => b.editable);
  const ai = aiWith(
    store,
    JSON.stringify({ edits: [{ blockId: target.id, text: "The launch is Tuesday." }] }),
  );
  const started = await ai.start(
    { documentId: seeded.id, revision: seeded.revision, goal: "Fix the typo", share: true },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed"]);
  assert.equal(run.status, "proposed", run.error);
  const saved = await store.save(
    seeded.id,
    seeded.revision,
    seeded.blocks.map((b) =>
      b.id === run.edits[0].blockId
        ? { id: b.id, type: "paragraph", runs: [{ text: run.edits[0].text }] }
        : { id: b.id },
    ),
  );
  const again = await store.get(seeded.id);
  assert.equal(again.revision, saved.revision);
  assert.match(again.blocks.map((b) => b.text).join("\n"), /Tuesday/);
});

test("PPTX end-to-end: ingest, project, AI-propose, apply ops, re-project", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("status.pptx", Buffer.from(await pptxFixture()));
  const ai = aiWith(
    store,
    JSON.stringify({
      ops: [{ type: "replaceText", from: "Milestone reached", to: "Milestone reached early" }],
    }),
  );
  const started = await ai.start(
    { documentId: doc.id, revision: doc.revision, goal: "Update progress", share: true, mode: "edit" },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed"]);
  assert.equal(run.status, "proposed", run.error);
  const saved = await store.saveOps(doc.id, doc.revision, run.edits);
  const again = await store.get(doc.id);
  assert.equal(again.revision, saved.revision);
  assert.match(
    again.slides.flatMap((s) => s.texts.map((x) => x.text)).join("\n"),
    /Milestone reached early/,
  );
  const { bytes } = await store.download(doc.id);
  assert.match(JSON.stringify(await readOutline(new Uint8Array(bytes))), /early/);
});

test("XLSX end-to-end: ingest, project, AI-propose, apply cells, re-project", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("stock.xlsx", Buffer.from(await xlsxFixture()));
  assert.equal(doc.format, "xlsx");
  const ai = aiWith(
    store,
    JSON.stringify({ edits: [{ cell: "Summary!B2", text: "15" }, { cell: "Summary!B3", text: "=B2*2" }] }),
  );
  const started = await ai.start(
    { documentId: doc.id, revision: doc.revision, goal: "Update the count and total", share: true },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed"]);
  assert.equal(run.status, "proposed", run.error);
  const saved = await store.saveCells(doc.id, doc.revision, run.edits);
  const again = await store.get(doc.id);
  assert.equal(again.revision, saved.revision);
  const cells = new Map(again.sheets[0].cells.map((c) => [c.ref, c]));
  assert.equal(cells.get("B2").value, 15);
  assert.equal(cells.get("B3").formula, "B2*2");
  assert.equal(cells.get("B3").value, 30, "recalculated formula value is projected");
});

test("PDF end-to-end: ingest, project, AI shape proposal, apply ops, re-project", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("report.pdf", await pdfFixture());
  assert.equal(doc.format, "pdf");
  const ai = aiWith(
    store,
    JSON.stringify({
      edits: [
        { kind: "metadata", title: "Alpha Report" },
        { kind: "stamp", text: "DRAFT", pages: "all", position: "header" },
      ],
    }),
  );
  const started = await ai.start(
    { documentId: doc.id, revision: doc.revision, goal: "Title it and mark draft", share: true, mode: "shape" },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed"]);
  assert.equal(run.status, "proposed", run.error);
  let current = doc;
  for (const op of run.edits)
    current = await store.pdfOp(doc.id, current.revision, op);
  const again = await store.get(doc.id);
  assert.equal(again.revision, current.revision);
  assert.equal(again.metadata.title, "Alpha Report");
  assert.match(again.pages[0].text, /DRAFT/);
  assert.match(again.pages[0].text, /Alpha report body/, "body text is untouched");
});

test("AI generation creates an openable xlsx from a workbook spec", async (t) => {
  const { store } = await setup(t);
  const spec = {
    title: "Inventory",
    sheets: [
      {
        name: "Summary",
        cells: [
          { cell: "A1", text: "Item" },
          { cell: "B1", text: "Qty" },
          { cell: "A2", text: "Bolts" },
          { cell: "B2", text: "15" },
          { cell: "B3", text: "=B2*2" },
        ],
      },
    ],
  };
  const ai = aiWith(store, JSON.stringify(spec));
  const started = await ai.generate({ goal: "Make an inventory sheet", share: true, format: "excel" }, identity);
  const run = await settled(ai, started.id, ["created", "failed", "stopped"]);
  assert.equal(run.status, "created", run.error);
  assert.equal(run.name, "Inventory.xlsx");
  const doc = await store.get(run.createdDocumentId);
  assert.equal(doc.format, "xlsx");
  assert.equal(doc.sheets[0].name, "Summary");
  const cells = new Map(doc.sheets[0].cells.map((c) => [c.ref, c]));
  assert.equal(cells.get("A2").value, "Bolts");
  assert.equal(cells.get("B2").value, 15);
  assert.equal(cells.get("B3").formula, "B2*2");
  assert.equal(cells.get("B3").value, 30);
});

test("AI generation creates an openable pdf from a document spec", async (t) => {
  const { store } = await setup(t);
  const spec = {
    title: "Field Guide",
    sections: [
      { heading: "Overview", paragraphs: ["A short guide to the survey area."] },
      { heading: "Hazards", paragraphs: ["Loose rock on the north ridge."] },
    ],
  };
  const ai = aiWith(store, JSON.stringify(spec));
  const started = await ai.generate({ goal: "Write a field guide", share: true, format: "pdf" }, identity);
  const run = await settled(ai, started.id, ["created", "failed", "stopped"]);
  assert.equal(run.status, "created", run.error);
  assert.equal(run.name, "Field Guide.pdf");
  const doc = await store.get(run.createdDocumentId);
  assert.equal(doc.format, "pdf");
  assert.equal(doc.metadata.title, "Field Guide");
  const text = doc.pages.map((p) => p.text).join("\n");
  assert.match(text, /Field Guide/);
  assert.match(text, /survey area/);
  assert.match(text, /Loose rock/);
});

test("AI generation rejects malformed excel/pdf specs without writing", async (t) => {
  const { store } = await setup(t);
  for (const [format, raw] of [
    ["excel", "not json"],
    ["excel", JSON.stringify({ title: "T", sheets: [] })],
    ["excel", JSON.stringify({ title: "T", sheets: [{ name: "S", cells: [{ cell: "bad ref", text: "x" }] }] })],
    ["excel", JSON.stringify({ title: "T", sheets: [{ name: "a/b", cells: [{ cell: "A1", text: "x" }] }] })],
    ["pdf", JSON.stringify({ title: "", sections: [] })],
    ["pdf", JSON.stringify({ title: "T", sections: [{ heading: "H", paragraphs: ["ok"] }], extra: 1 })],
  ]) {
    const ai = aiWith(store, raw);
    const started = await ai.generate({ goal: "Draft", share: true, format }, identity);
    const run = await settled(ai, started.id, ["created", "failed"]);
    assert.equal(run.status, "failed", `${format}: ${raw}`);
  }
  assert.equal((await store.list()).length, 0);
});

test("Library classification reports all four formats for the format filter", async (t) => {
  const { store } = await setup(t);
  await store.blank("Doc.docx");
  await store.create("Deck.pptx", Buffer.from(await pptxFixture()));
  await store.create("Sheet.xlsx", Buffer.from(await xlsxFixture()));
  await store.create("Scan.pdf", await pdfFixture());
  const list = await store.list();
  assert.deepEqual(
    list.map((d) => d.format).sort(),
    ["docx", "excel", "pdf", "pptx"],
  );
});
