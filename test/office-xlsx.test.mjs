// XLSX store + projection: a workbook is stored, parsed by the vendored
// @devmoter/xlsx engine and exposed as a read-only sheet/cell projection.
// Editing and calc wiring are a later track; save() stays DOCX-only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createOfficeStore } from "../server/office/store.mjs";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-xlsx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}

/** Small real .xlsx: shared strings, a formula, a merge, a second sheet. */
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
      `<sheet name="Summary" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Raw" sheetId="2" r:id="rId2"/>` +
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
      `<si><t>Revenue</t></si><si><t>Note</t></si></sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><dimension ref="A1:B3"/><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200.5</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>B1*2</f><v>2401</v></c></row>` +
      `<row r="3"><c r="A3" t="b"><v>1</v></c></row>` +
      `</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><dimension ref="A1"/><sheetData>` +
      `<row r="1"><c r="A1"><v>-4</v></c></row></sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

test("Office stores an xlsx and projects sheets and cells read-only", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Report.xlsx", await fixture());
  assert.equal(doc.format, "xlsx");
  assert.equal(doc.blocks, undefined);
  assert.deepEqual(
    doc.sheets.map((s) => [s.name, s.ref, s.editable]),
    [
      ["Summary", "A1:B3", false],
      ["Raw", "A1", false],
    ],
  );
  const cells = new Map(doc.sheets[0].cells.map((c) => [c.ref, c]));
  assert.equal(cells.get("A1").value, "Revenue");
  assert.equal(cells.get("B1").value, 1200.5);
  assert.deepEqual(
    { formula: cells.get("B2").formula, value: cells.get("B2").value },
    { formula: "B1*2", value: 2401 },
  );
  assert.equal(cells.get("A3").value, true);
  assert.equal(cells.get("A1").row, 1);
  assert.equal(cells.get("B2").col, 2);
  assert.deepEqual(doc.sheets[0].merges, ["A1:B1"]);
  assert.equal(doc.sheets[0].rows, 3);
  assert.equal(doc.sheets[0].cols, 2);
  assert.ok(doc.warnings.length > 0);
});

test("Office xlsx download/open/reload keep identical bytes", async (t) => {
  const { root, store } = await setup(t);
  const bytes = await fixture();
  const doc = await store.create("Book.xlsx", bytes);
  const files = await readdir(join(root, doc.id));
  assert.ok(files.some((f) => f.endsWith(".xlsx")));
  assert.deepEqual((await store.download(doc.id)).bytes, Buffer.from(bytes));
  const opened = await store.open(doc.id);
  assert.equal(opened.sheets.length, 2);
  const reloaded = await createOfficeStore({ rootDir: root }).get(doc.id);
  assert.equal(reloaded.revision, doc.revision);
  assert.equal(reloaded.sheets[1].cells[0].value, -4);
});

test("Office xlsx restore copies a revision without touching the original", async (t) => {
  const { store } = await setup(t);
  const bytes = await fixture();
  const doc = await store.create("Book.xlsx", bytes);
  const restored = await store.restore(doc.id, doc.revision, doc.revision);
  assert.equal(restored.history.length, 2);
  assert.equal(restored.history[1].source, "restore");
  assert.deepEqual(
    (await store.download(doc.id)).bytes,
    (await store.download(doc.id, doc.revision)).bytes,
  );
  assert.equal((await store.get(doc.id)).sheets.length, 2);
});

test("Office xlsx is read-only: save and validate are rejected", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Book.xlsx", await fixture());
  await assert.rejects(store.save(doc.id, doc.revision, []));
  await assert.rejects(store.validate(doc.id, doc.revision, []));
});

test("Office xlsx rename keeps the xlsx extension", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Book.xlsx", await fixture());
  assert.equal((await store.rename(doc.id, "Renamed")).name, "Renamed.xlsx");
  assert.equal((await store.rename(doc.id, "Again.xlsx")).name, "Again.xlsx");
  await assert.rejects(store.rename(doc.id, "Wrong.docx"));
  assert.equal((await store.get(doc.id)).name, "Again.xlsx");
});

test("Office create rejects bad names and corrupt xlsx bytes", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(store.create("Sheet.txt", new Uint8Array([1, 2, 3])));
  await assert.rejects(store.create("Sheet.xlsx", new Uint8Array([1, 2, 3])));
  await assert.rejects(
    store.create("Sheet.xlsx", Buffer.alloc(13 * 1024 * 1024)),
  );
});

test("Office docx behavior is unchanged alongside xlsx support", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("Doc.docx");
  assert.equal(doc.format, "docx");
  assert.ok(Array.isArray(doc.blocks));
  await assert.rejects(store.rename(doc.id, "Sheet.xlsx"));
});
