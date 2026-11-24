// PDF store + ops + AI boundary: a PDF is stored, projected (pages, metadata,
// extracted text, form fields), edited only through validated ops that write
// new revisions, and read by AI for Q&A / metadata+stamp proposals. Body text
// is never edited in place.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createOfficeStore } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-pdf-"));
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

/** Small real .pdf: two pages of drawn text, metadata, one AcroForm field. */
async function fixture() {
  const doc = await PDFDocument.create();
  doc.setTitle("Quarterly Report");
  doc.setAuthor("Fixture Author");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of ["Alpha page one", "Beta page two"]) {
    const page = doc.addPage([400, 300]);
    page.drawText(label, { x: 40, y: 200, size: 18, font });
  }
  const form = doc.getForm();
  const field = form.createTextField("applicant.name");
  field.setText("");
  field.addToPage(doc.getPage(0), { x: 40, y: 80, width: 200, height: 20 });
  const check = form.createCheckBox("agree.tos");
  check.addToPage(doc.getPage(0), { x: 40, y: 50, width: 16, height: 16 });
  return doc.save();
}

test("Office stores a pdf and projects pages, metadata, text and form fields", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Report.pdf", await fixture());
  assert.equal(doc.format, "pdf");
  assert.equal(doc.pageCount, 2);
  assert.equal(doc.metadata.title, "Quarterly Report");
  assert.equal(doc.metadata.author, "Fixture Author");
  assert.equal(doc.pages.length, 2);
  assert.match(doc.pages[0].text, /Alpha page one/);
  assert.match(doc.pages[1].text, /Beta page two/);
  assert.deepEqual(
    doc.fields.map((f) => [f.name, f.type]).sort(),
    [
      ["agree.tos", "checkbox"],
      ["applicant.name", "text"],
    ],
  );
  assert.equal(doc.formSupported, true);
  assert.ok(doc.warnings.length > 0);
});

test("Office pdf page ops round-trip through new revisions", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Pages.pdf", await fixture());
  const rotated = await store.pdfOp(doc.id, doc.revision, {
    kind: "rotate",
    pages: [1],
    degrees: 90,
  });
  assert.notEqual(rotated.revision, doc.revision);
  assert.equal(rotated.pageInfo[0].rotation, 90);
  assert.equal(rotated.pageInfo[1].rotation, 0);
  const reordered = await store.pdfOp(doc.id, rotated.revision, {
    kind: "reorder",
    order: [2, 1],
  });
  assert.match(reordered.pages[0].text, /Beta page two/);
  assert.match(reordered.pages[1].text, /Alpha page one/);
  const deleted = await store.pdfOp(doc.id, reordered.revision, {
    kind: "delete",
    pages: [2],
  });
  assert.equal(deleted.pageCount, 1);
  assert.match(deleted.pages[0].text, /Beta page two/);
  const extracted = await store.pdfOp(doc.id, deleted.revision, {
    kind: "extract",
    pages: [1],
  });
  assert.equal(extracted.pageCount, 1);
  // Every op appended an edit revision; the original is untouched.
  const { bytes: original } = await store.download(
    doc.id,
    doc.history[0].revision,
  );
  const originalDoc = await PDFDocument.load(original);
  assert.equal(originalDoc.getPageCount(), 2);
  assert.ok(deleted.history.length > doc.history.length);
});

test("Office pdf form fill persists across reload as a revision", async (t) => {
  const { root, store } = await setup(t);
  const doc = await store.create("Form.pdf", await fixture());
  const filled = await store.pdfOp(doc.id, doc.revision, {
    kind: "fillForm",
    values: { "applicant.name": "Taro Yamada", "agree.tos": true },
  });
  const fields = new Map(filled.fields.map((f) => [f.name, f.value]));
  assert.equal(fields.get("applicant.name"), "Taro Yamada");
  assert.equal(fields.get("agree.tos"), true);
  const reloaded = await createOfficeStore({ rootDir: root }).get(doc.id);
  assert.equal(reloaded.revision, filled.revision);
  const again = new Map(reloaded.fields.map((f) => [f.name, f.value]));
  assert.equal(again.get("applicant.name"), "Taro Yamada");
  const { bytes } = await store.download(doc.id);
  const raw = await PDFDocument.load(bytes);
  assert.equal(
    raw.getForm().getTextField("applicant.name").getText(),
    "Taro Yamada",
  );
});

test("Office pdf stamp and metadata ops apply and re-project", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Stamp.pdf", await fixture());
  const stamped = await store.pdfOp(doc.id, doc.revision, {
    kind: "stamp",
    text: "DRAFT",
    pages: "all",
    position: "diagonal",
  });
  assert.match(stamped.pages[0].text, /DRAFT/);
  const renamed = await store.pdfOp(doc.id, stamped.revision, {
    kind: "metadata",
    title: "Retitled",
  });
  assert.equal(renamed.metadata.title, "Retitled");
  assert.equal(renamed.metadata.author, "Fixture Author");
});

test("Office pdf ops reject invalid input and stale revisions", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Guard.pdf", await fixture());
  for (const op of [
    { kind: "rotate", pages: [9], degrees: 90 },
    { kind: "rotate", pages: "all", degrees: 45 },
    { kind: "delete", pages: [1, 2] },
    { kind: "delete", pages: [] },
    { kind: "reorder", order: [1, 1] },
    { kind: "extract", pages: [3] },
    { kind: "stamp", text: "x".repeat(300), position: "header" },
    { kind: "fillForm", values: { "no.such.field": "x" } },
    { kind: "fillForm", values: { "agree.tos": "yes" } },
    { kind: "unknown" },
    "not-an-object",
  ]) {
    await assert.rejects(store.pdfOp(doc.id, doc.revision, op));
  }
  await assert.rejects(
    store.pdfOp(doc.id, "not-the-revision", { kind: "delete", pages: [2] }),
    /409|更新されています/,
  );
  // Block-editor save stays DOCX-only for pdf documents.
  await assert.rejects(
    store.save(doc.id, doc.revision, [
      { id: "x", type: "paragraph", runs: [{ text: "y" }] },
    ]),
  );
});

test("Office AI ask answers over extracted pdf text without writing", async (t) => {
  const { root, store } = await setup(t);
  const doc = await store.create("Ask.pdf", await fixture());
  const shared = {};
  const ai = aiWith(store, "It is a quarterly report.", shared);
  const before = (await readdir(join(root, doc.id))).sort();
  const started = await ai.ask(
    {
      documentId: doc.id,
      revision: doc.revision,
      goal: "What is this document?",
      share: true,
    },
    identity,
  );
  const run = await settled(ai, started.id, ["answered", "failed", "stopped"]);
  assert.equal(run.status, "answered", run.error);
  assert.equal(run.answer, "It is a quarterly report.");
  // The model saw the extracted page text.
  assert.match(shared.messages[1].content, /Alpha page one/);
  assert.match(shared.messages[1].content, /Beta page two/);
  // Read-only: no new revision, no new files, metadata unchanged.
  const after = (await readdir(join(root, doc.id))).sort();
  assert.deepEqual(after, before);
  assert.equal((await store.get(doc.id)).revision, doc.revision);
});

test("Office AI pdf shaping proposes validated metadata/stamp ops only", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Shape.pdf", await fixture());
  const proposal = {
    edits: [
      { kind: "metadata", title: "Proposed Title" },
      { kind: "stamp", text: "REVIEW", pages: "all", position: "header" },
    ],
  };
  const ai = aiWith(store, JSON.stringify(proposal));
  const started = await ai.start(
    {
      mode: "shape",
      documentId: doc.id,
      revision: doc.revision,
      goal: "Retitle and mark for review",
      share: true,
    },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed", "stopped"]);
  assert.equal(run.status, "proposed", run.error);
  assert.deepEqual(run.edits, [
    { kind: "metadata", metadata: { title: "Proposed Title" } },
    { kind: "stamp", text: "REVIEW", pages: "all", position: "header" },
  ]);
  // Proposal validated only — nothing written until applied via ops.
  assert.equal((await store.get(doc.id)).revision, doc.revision);
  const applied = await store.pdfOp(doc.id, doc.revision, run.edits[0]);
  assert.equal(applied.metadata.title, "Proposed Title");
  // Text edits are still rejected for pdf.
  await assert.rejects(
    ai.start(
      {
        mode: "edit",
        documentId: doc.id,
        revision: doc.revision,
        goal: "rewrite",
        share: true,
      },
      identity,
    ),
    /AI編集に対応していません/,
  );
});

test("Office AI pdf shaping rejects non-metadata/stamp proposals", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("BadShape.pdf", await fixture());
  const ai = aiWith(
    store,
    JSON.stringify({ edits: [{ kind: "delete", pages: [1] }] }),
  );
  const started = await ai.start(
    {
      mode: "shape",
      documentId: doc.id,
      revision: doc.revision,
      goal: "x",
      share: true,
    },
    identity,
  );
  const run = await settled(ai, started.id, ["proposed", "failed", "stopped"]);
  assert.equal(run.status, "failed");
});
