import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfficeStore, formatForName } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";
import { buildBlankDocx } from "../server/office/engine.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-format-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}
const pdfBytes = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("Office format is decided from the extension", () => {
  assert.equal(formatForName("Report.docx"), "docx");
  assert.equal(formatForName("Deck.PPTX"), "pptx");
  assert.equal(formatForName("Scan.pdf"), "pdf");
  assert.equal(formatForName("Budget.xlsx"), "excel");
  assert.equal(formatForName("notes.txt"), null);
  assert.equal(formatForName("no-extension"), null);
});

test("Office stores each format with its own extension and reports it on read", async (t) => {
  const { store } = await setup(t);
  const zip = await buildBlankDocx();
  for (const [name, format, bytes] of [
    ["Doc.docx", "docx", zip],
    ["Deck.pptx", "pptx", zip],
    ["Sheet.xlsx", "excel", zip],
    ["Scan.pdf", "pdf", pdfBytes()],
  ]) {
    const doc = await store.create(name, bytes);
    assert.equal(doc.format, format);
    assert.equal(doc.name, name);
  }
  const list = await store.list();
  assert.deepEqual(
    list.map((d) => d.format).sort(),
    ["docx", "excel", "pdf", "pptx"],
  );
});

test("Office non-DOCX documents store originals read-only: list/download/rename work, edit paths reject", async (t) => {
  const { root, store } = await setup(t);
  const bytes = pdfBytes();
  const doc = await store.create("Scan.pdf", bytes);
  assert.equal(doc.format, "pdf");
  assert.deepEqual(doc.blocks, []);
  assert.ok(doc.warnings.length);
  // Original bytes round-trip untouched.
  const { meta, bytes: out } = await store.download(doc.id);
  assert.equal(meta.format, "pdf");
  assert.deepEqual(out, bytes);
  const file = (await readdir(join(root, doc.id))).find((f) => f.startsWith(doc.revision));
  assert.equal(file, `${doc.revision}.pdf`);
  const renamed = await store.rename(doc.id, "スキャン");
  assert.equal(renamed.name, "スキャン.pdf");
  // No parse/edit/AI surface yet.
  await assert.rejects(store.save(doc.id, doc.revision, [{ id: "x", type: "paragraph", runs: [{ text: "y" }] }]));
  await assert.rejects(store.validate(doc.id, doc.revision, [{ blockId: "x", text: "y" }]));
  await assert.rejects(store.restore(doc.id, doc.revision, doc.revision));
  const ai = createOfficeAi({ store, authorize: async () => {}, prepareChat: async () => ({ context: {}, secrets: [], chat: async () => "{}" }) });
  await assert.rejects(
    ai.start({ documentId: doc.id, revision: doc.revision, goal: "x", share: true }, { ownerId: "owner:test" }),
  );
});

test("Office rejects uploads whose content does not match the extension", async (t) => {
  const { store } = await setup(t);
  const zip = await buildBlankDocx();
  const pdf = pdfBytes();
  await assert.rejects(store.create("Fake.pdf", zip), /一致しません/);
  await assert.rejects(store.create("Fake.docx", pdf), /一致しません/);
  await assert.rejects(store.create("Fake.pptx", pdf), /一致しません/);
  await assert.rejects(store.create("Fake.xlsx", Buffer.from("plain text")), /一致しません/);
  await assert.rejects(store.create("Notes.txt", zip));
  assert.equal((await store.list()).length, 0, "rejected uploads leave nothing behind");
});

test("Office migrates documents stored before format classification to docx on read only", async (t) => {
  const { root, store } = await setup(t);
  const doc = await store.blank("Old.docx");
  const path = join(root, doc.id, "metadata.json");
  const meta = JSON.parse(await readFile(path, "utf8"));
  delete meta.format;
  await writeFile(path, JSON.stringify(meta), { mode: 0o600 });
  const listed = await store.list();
  assert.equal(listed.find((d) => d.id === doc.id).format, "docx");
  assert.equal((await store.get(doc.id)).format, "docx");
  // Normalization happens in the metadata layer; the stored file is untouched.
  const disk = JSON.parse(await readFile(path, "utf8"));
  assert.equal(disk.format, undefined);
});
