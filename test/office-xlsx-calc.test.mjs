// Excel surface: the vendored calc-wasm engine recalculates formula cells for
// the API projection, grid cell edits save as new revisions through
// saveCells(), and AI proposals validate {cell, text} edits against the
// current revision without writing.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createOfficeStore } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-xlsx-calc-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}

/**
 * Workbook with a formula chain (A3 -> A4) plus a v3-set function
 * (SUMIF) and a VLOOKUP across a label/value table.
 */
async function fixture() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>` +
      `<sheet name="Data" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Other" sheetId="2" r:id="rId2"/>` +
      `</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst xmlns="${MAIN}" count="2" uniqueCount="2">` +
      `<si><t>a</t></si><si><t>b</t></si></sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><dimension ref="A1:D4"/><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>5</v></c><c r="D1"><f>VLOOKUP("a",A1:B2,2,FALSE)</f><v>5</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>9</v></c></row>` +
      `<row r="3"><c r="A3"><f>SUMIF(A1:A2,"a",B1:B2)</f><v>5</v></c></row>` +
      `<row r="4"><c r="A4"><f>A3*2</f><v>10</v></c></row>` +
      `</sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><dimension ref="A1"/><sheetData>` +
      `<row r="1"><c r="A1"><v>-4</v></c></row></sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const cellOf = (doc, sheet, ref) =>
  doc.sheets.find((s) => s.name === sheet).cells.find((c) => c.ref === ref);

test("Office xlsx projection carries computed values from the calc engine", async (t) => {
  const { store } = await setup(t);
  // Deliberately wrong cached values: the projection must show computed ones.
  const doc = await store.create("Calc.xlsx", await fixture());
  assert.equal(doc.calculated, true);
  assert.equal(cellOf(doc, "Data", "A3").value, 5);
  assert.equal(cellOf(doc, "Data", "A3").formula, 'SUMIF(A1:A2,"a",B1:B2)');
  assert.equal(cellOf(doc, "Data", "A4").value, 10);
  assert.equal(cellOf(doc, "Data", "D1").value, 5);
  assert.equal(doc.sheets[0].editable, true);
});

test("Office xlsx cell edits recalculate and save as a new revision", async (t) => {
  const { store } = await setup(t);
  const original = await fixture();
  const doc = await store.create("Calc.xlsx", original);
  const saved = await store.saveCells(doc.id, doc.revision, [
    { cell: "Data!B1", text: "20" },
    { cell: "Data!C1", text: "=B1+B2" },
    { cell: "Other!A1", text: "7" },
  ]);
  assert.notEqual(saved.revision, doc.revision);
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[1].source, "edit");
  // The chain recalculates: A3 = 20, A4 = 40, D1 = 20.
  assert.equal(cellOf(saved, "Data", "A3").value, 20);
  assert.equal(cellOf(saved, "Data", "A4").value, 40);
  assert.equal(cellOf(saved, "Data", "D1").value, 20);
  assert.equal(cellOf(saved, "Data", "C1").value, 29);
  assert.equal(cellOf(saved, "Data", "C1").formula, "B1+B2");
  assert.equal(cellOf(saved, "Other", "A1").value, 7);
  // The original revision bytes are untouched.
  assert.deepEqual(
    (await store.download(doc.id, doc.revision)).bytes,
    Buffer.from(original),
  );
  // The saved revision parses and recalculates identically on reopen.
  const reopened = await store.get(doc.id);
  assert.equal(cellOf(reopened, "Data", "A4").value, 40);
});

test("Office xlsx edits reject stale revisions, bad cells and bad text", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Calc.xlsx", await fixture());
  await assert.rejects(
    store.saveCells(doc.id, "00000000-0000-0000-0000-000000000000", [{ cell: "Data!B1", text: "1" }]),
    /再読み込み/,
  );
  await assert.rejects(
    store.saveCells(doc.id, doc.revision, [{ cell: "Nope!A1", text: "1" }]),
  );
  await assert.rejects(
    store.saveCells(doc.id, doc.revision, [{ cell: "Data!A0", text: "1" }]),
  );
  await assert.rejects(
    store.saveCells(doc.id, doc.revision, [{ cell: "Data!A1", text: 5 }]),
  );
  await assert.rejects(
    store.saveCells(doc.id, doc.revision, [{ cell: "Data!A1", text: "x", nope: 1 }]),
  );
  await assert.rejects(store.saveCells(doc.id, doc.revision, []));
  // The DOCX save path stays DOCX-only.
  await assert.rejects(store.save(doc.id, doc.revision, []));
});

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
const aiPayload = (doc, extra = {}) => ({
  goal: "Double the a-row value",
  share: true,
  documentId: doc.id,
  revision: doc.revision,
  ...extra,
});

test("Office AI proposes validated cell edits for xlsx without writing", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Calc.xlsx", await fixture());
  const shared = {};
  const ai = aiWith(
    store,
    JSON.stringify({ edits: [{ cell: "Data!B1", text: "12" }] }),
    shared,
  );
  const started = await ai.start(aiPayload(doc), identity);
  const run = await settled(ai, started.id, ["proposed", "failed", "stopped"]);
  assert.equal(run.status, "proposed", run.error);
  assert.deepEqual(run.edits, [{ cell: "Data!B1", text: "12" }]);
  // The workbook projection was shared, not written.
  const sent = JSON.stringify(shared.messages);
  assert.match(sent, /Data!B1/);
  assert.equal(cellOf(await store.get(doc.id), "Data", "B1").value, 5);
  // Validation rejects cells outside the shared workbook.
  const bad = aiWith(
    store,
    JSON.stringify({ edits: [{ cell: "Ghost!Z9", text: "1" }] }),
  );
  const started2 = await bad.start(aiPayload(doc), identity);
  const run2 = await settled(bad, started2.id, ["proposed", "failed", "stopped"]);
  assert.equal(run2.status, "failed");
});

test("Office AI xlsx proposals reject a stale revision", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Calc.xlsx", await fixture());
  const ai = aiWith(store, JSON.stringify({ edits: [{ cell: "Data!B1", text: "1" }] }));
  await assert.rejects(
    ai.start(
      aiPayload(doc, { revision: "00000000-0000-0000-0000-000000000000" }),
      identity,
    ),
    /再読み込み/,
  );
});

test("Office AI answers questions over the xlsx value+formula projection", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Calc.xlsx", await fixture());
  const shared = {};
  const ai = aiWith(store, "A4 equals 10.", shared);
  const started = await ai.ask(
    { goal: "What is A4?", share: true, documentId: doc.id, revision: doc.revision },
    identity,
  );
  const run = await settled(ai, started.id, ["answered", "failed", "stopped"]);
  assert.equal(run.status, "answered", run.error);
  assert.equal(run.answer, "A4 equals 10.");
  const sent = JSON.stringify(shared.messages);
  assert.match(sent, /A3\*2/);
  assert.equal(run.edits, undefined);
});
