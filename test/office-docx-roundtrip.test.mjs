// DOCX round-trip for the whole-document editor: open a real DOCX, edit it the
// way the browser editor does (ordered block list), save, reopen, and check
// both the editor model and the OOXML that Word will read.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createOfficeStore } from "../server/office/store.mjs";
import { buildBlankDocx } from "../server/office/engine.mjs";
import { alignText } from "../server/office/docx-model.mjs";

const fixture = (name) => readFile(new URL(`./fixtures/office/${name}`, import.meta.url));
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-rt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}
/** The model the browser editor reads back from what the server described. */
const model = (b) =>
  b.editable
    ? {
        id: b.id,
        type: b.type === "heading" || b.type === "listItem" ? b.type : "paragraph",
        ...(b.type === "heading" ? { level: b.level } : {}),
        ...(b.type === "listItem" ? { list: b.list.kind, ilvl: b.list.ilvl } : {}),
        ...(b.align ? { align: b.align } : {}),
        runs: b.runs.map((r) => ({ text: r.text, bold: !!r.bold, italic: !!r.italic, underline: !!r.underline, ...(r.href ? { href: r.href } : {}) })),
      }
    : { id: b.id };
const text = (b) => b.runs.map((r) => r.text).join("");
const byText = (doc, value) => doc.blocks.find((b) => b.text === value);
const zipOf = async (store, id, revision) => JSZip.loadAsync((await store.download(id, revision)).bytes);
const part = async (zip, path) => zip.file(path)?.async("string");
const bodyOf = (xml) => xml.slice(xml.indexOf("<w:body>"), xml.indexOf("</w:body>"));
/** The whole <w:p> element containing `needle`. */
const paragraphXml = (xml, needle) => {
  const at = xml.indexOf(needle);
  assert.notEqual(at, -1, needle);
  return xml.slice(Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at)), xml.indexOf("</w:p>", at) + 6);
};
const runsOf = (b) => b.runs.map((r) => [r.text, !!r.bold, !!r.italic, !!r.underline, r.href || null]);

for (const name of ["word-report.docx", "pandoc-minutes.docx", "word-sections.docx"]) {
  test(`Office round-trip keeps ${name} byte-identical when nothing changed`, async (t) => {
    const { store } = await setup(t);
    const bytes = await fixture(name);
    const doc = await store.create(name, bytes);
    const saved = await store.save(doc.id, doc.revision, doc.blocks.map(model));
    const before = await JSZip.loadAsync(bytes);
    const after = await zipOf(store, doc.id, saved.revision);
    for (const path of Object.keys(before.files).filter((p) => !before.files[p].dir))
      assert.equal(await part(after, path), await part(before, path), path);
    assert.deepEqual(saved.blocks.map(model).map(({ id, ...rest }) => rest), doc.blocks.map(model).map(({ id, ...rest }) => rest));
  });
}

test("Office round-trip writes runs, headings, lists, alignment, links and paragraph add/delete/reorder to DOCX", async (t) => {
  const { root, store } = await setup(t);
  const bytes = await fixture("word-report.docx");
  const doc = await store.create("Report.docx", bytes);
  const rich = doc.blocks.find((b) => b.text.startsWith("Bold "));
  const details = byText(doc, "Details");
  const centered = byText(doc, "Centered line");
  const second = byText(doc, "Second bullet");
  const closing = byText(doc, "Closing paragraph.");
  const stepTwo = byText(doc, "Step two");
  const table = doc.blocks.find((b) => b.type === "table");
  assert.ok(rich && details && centered && second && closing && table);

  const blocks = doc.blocks.map(model);
  const at = (b) => blocks.findIndex((x) => x.id === b.id);
  // text edit inside the coloured run + bold/italic/underline changes + a new link
  blocks[at(rich)] = {
    ...blocks[at(rich)],
    runs: [
      { text: "Bold ", bold: true, italic: false, underline: false },
      { text: "now plain ", bold: false, italic: false, underline: false },
      { text: "underlined", bold: false, italic: true, underline: true },
      { text: " red text edited", bold: false, italic: false, underline: false },
      { text: " site", bold: false, italic: false, underline: false, href: "https://example.com/docs" },
    ],
  };
  blocks[at(details)] = { ...blocks[at(details)], level: 3 }; // H2 -> H3
  blocks[at(centered)] = { ...blocks[at(centered)], align: "right" };
  blocks[at(stepTwo)] = { id: stepTwo.id, type: "paragraph", runs: [{ text: "Step two", bold: false, italic: false, underline: false }] }; // ordered -> paragraph
  blocks.splice(at(second), 1); // delete a paragraph
  const closingModel = blocks.splice(at(closing), 1)[0];
  blocks.splice(1, 0, closingModel); // reorder: closing paragraph moves under the title
  blocks.splice(blocks.findIndex((x) => x.id === table.id) + 1, 0,
    { base: rich.id, type: "paragraph", runs: [{ text: "Typed after Enter", bold: false, italic: false, underline: false }] },
    { type: "listItem", list: "ordered", runs: [{ text: "New step 1", bold: false, italic: false, underline: false }] },
    { type: "listItem", list: "ordered", runs: [{ text: "New step 2", bold: false, italic: false, underline: false }] },
    { type: "heading", level: 1, align: "center", runs: [{ text: "Appendix", bold: false, italic: false, underline: false }] },
  );
  const saved = await store.save(doc.id, doc.revision, blocks);

  // reopen from disk with a fresh store, exactly as after a server restart
  const again = await createOfficeStore({ rootDir: root }).get(doc.id);
  assert.equal(again.revision, saved.revision);
  assert.deepEqual(
    again.blocks.filter((b) => b.type !== "passthrough").map((b) => [b.type, b.level ?? null, b.list?.kind ?? null, b.align ?? null, b.text]),
    [
      ["heading", 1, null, null, "Quarterly report"],
      ["paragraph", null, null, null, "Closing paragraph."],
      ["paragraph", null, null, null, "Bold now plain underlined red text edited site"],
      ["paragraph", null, null, "right", "Centered line"],
      ["heading", 3, null, null, "Details"],
      ["listItem", null, "bullet", null, "First bullet"],
      ["listItem", null, "ordered", null, "Step one"],
      ["paragraph", null, null, null, "Step two"],
      ["table", null, null, null, ""],
      ["paragraph", null, null, null, "Typed after Enter"],
      ["listItem", null, "ordered", null, "New step 1"],
      ["listItem", null, "ordered", null, "New step 2"],
      ["heading", 1, null, "center", "Appendix"],
    ],
  );
  const reRich = again.blocks.find((b) => b.text.startsWith("Bold now"));
  assert.deepEqual(runsOf(reRich), [
    ["Bold ", true, false, false, null],
    ["now plain ", false, false, false, null],
    ["underlined", false, true, true, null],
    [" red text edited", false, false, false, null],
    [" site", false, false, false, "https://example.com/docs"],
  ]);
  // formatting the editor does not show (colour, size) stays on the edited text
  assert.equal(reRich.runs.find((r) => r.text === " red text edited").color, "C00000");
  assert.equal(reRich.runs.find((r) => r.text === " red text edited").sizeHalfPoints, 28);
  // a paragraph created with Enter continues the formatting of the end of the one it came from
  assert.deepEqual(byText(again, "Typed after Enter").runs.map((r) => [r.text, r.color]), [["Typed after Enter", "C00000"]]);
  // the new numbered list is its own list, not a continuation of "Step one"
  const steps = again.blocks.filter((b) => b.text.startsWith("New step"));
  assert.equal(steps[0].list.numId, steps[1].list.numId);
  assert.notEqual(steps[0].list.numId, byText(again, "Step one").list.numId);

  const zip = await zipOf(store, doc.id);
  const original = await JSZip.loadAsync(bytes);
  const xml = await part(zip, "word/document.xml");
  const oldXml = await part(original, "word/document.xml");
  // untouched paragraphs and the table keep their original bytes
  for (const needle of ["Quarterly report", "First bullet", "Step one", "Closing paragraph."])
    assert.equal(paragraphXml(xml, needle), paragraphXml(oldXml, needle), needle);
  assert.ok(xml.includes(oldXml.slice(oldXml.indexOf("<w:tbl>"), oldXml.indexOf("</w:tbl>") + 8)));
  assert.match(paragraphXml(xml, "Details"), /<w:pStyle w:val="Heading3"\/>/);
  assert.match(paragraphXml(xml, "Centered line"), /<w:jc w:val="right"\/>/);
  assert.match(paragraphXml(xml, "Appendix"), /<w:pStyle w:val="Heading1"\/>.*<w:jc w:val="center"\/>/);
  assert.doesNotMatch(paragraphXml(xml, "Step two"), /ListNumber|numPr/);
  assert.doesNotMatch(xml, /Second bullet/);
  assert.match(xml, /<w:r><w:rPr><w:i\/>(?:<w:iCs\/>)?<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">underlined<\/w:t><\/w:r>/);
  const rels = await part(zip, "word/_rels/document.xml.rels");
  const rId = /<w:hyperlink r:id="(rId\d+)"/.exec(xml)[1];
  assert.match(rels, new RegExp(`Id="${rId}"[^>]*Target="https://example.com/docs"[^>]*TargetMode="External"|Target="https://example.com/docs"[^>]*Id="${rId}"`));
  const numbering = await part(zip, "word/numbering.xml");
  assert.match(numbering, new RegExp(`<w:num w:numId="${steps[0].list.numId}">`));
  assert.ok(numbering.startsWith((await part(original, "word/numbering.xml")).slice(0, 200)));
  // parts the editor never touches stay byte-identical
  for (const path of ["word/styles.xml", "word/header1.xml", "word/settings.xml", "word/theme/theme1.xml", "docProps/app.xml"])
    if (original.file(path)) assert.equal(await part(zip, path), await part(original, path), path);
  // the original revision is still downloadable unchanged
  assert.deepEqual((await store.download(doc.id, doc.revision)).bytes, Buffer.from(bytes));
});

test("Office round-trip keeps an existing hyperlink, bookmarks and numbering of a pandoc DOCX", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Minutes.docx", await fixture("pandoc-minutes.docx"));
  const link = doc.blocks.find((b) => b.runs?.some((r) => r.href));
  const heading = byText(doc, "決定事項");
  const blocks = doc.blocks.map(model);
  const at = (b) => blocks.findIndex((x) => x.id === b.id);
  // edit text around the existing link, rename the bookmarked heading, add a list item to the bullet list
  blocks[at(link)] = { ...blocks[at(link)], runs: blocks[at(link)].runs.map((r) => (r.href ? r : { ...r, text: r.text.replace("参照。", "参照してください。") })) };
  blocks[at(heading)] = { ...blocks[at(heading)], runs: [{ text: "決定事項（更新）", bold: false, italic: false, underline: false }] };
  const lastBullet = byText(doc, "二つ目の項目");
  blocks.splice(at(lastBullet) + 1, 0, { base: lastBullet.id, type: "listItem", list: "bullet", ilvl: 0, runs: [{ text: "三つ目の項目", bold: false, italic: false, underline: false }] });
  const saved = await store.save(doc.id, doc.revision, blocks);
  const again = await store.get(doc.id);
  assert.equal(again.revision, saved.revision);
  const relink = again.blocks.find((b) => b.runs?.some((r) => r.href));
  assert.equal(relink.runs.find((r) => r.href).href, "https://example.com/devmoter");
  assert.match(text(relink), /参照してください。$/);
  const third = byText(again, "三つ目の項目");
  assert.deepEqual([third.type, third.list.kind, third.list.numId], ["listItem", "bullet", byText(again, "一つ目の項目").list.numId]);
  const xml = await part(await zipOf(store, doc.id), "word/document.xml");
  // pandoc's hyperlink keeps its original relationship id (no new relationship)
  const original = await part(await JSZip.loadAsync(await fixture("pandoc-minutes.docx")), "word/document.xml");
  assert.equal(/<w:hyperlink r:id="(rId\d+)"/.exec(xml)[1], /<w:hyperlink r:id="(rId\d+)"/.exec(original)[1]);
  assert.match(xml, /<w:bookmarkStart w:id="21" w:name="決定事項" \/>/);
  assert.equal((xml.match(/<w:bookmarkEnd w:id="21" \/>/g) || []).length, 1);
});

test("Office round-trip builds headings, lists and links in a blank document", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("New.docx");
  const first = doc.blocks.find((b) => b.editable);
  const saved = await store.save(doc.id, doc.revision, [
    ...doc.blocks.filter((b) => !b.editable).map(model),
    { id: first.id, type: "heading", level: 2, runs: [{ text: "見出し" }] },
    { type: "listItem", list: "bullet", runs: [{ text: "点" }] },
    { type: "listItem", list: "ordered", runs: [{ text: "番号" }] },
    { type: "paragraph", align: "justify", runs: [{ text: "mail", href: "mailto:a@example.com" }, { text: " ", }, { text: "太", bold: true }] },
  ]);
  assert.deepEqual(
    saved.blocks.filter((b) => b.editable).map((b) => [b.type, b.level ?? null, b.list?.kind ?? null, b.align ?? null, b.text]),
    [
      ["heading", 2, null, null, "見出し"],
      ["listItem", null, "bullet", null, "点"],
      ["listItem", null, "ordered", null, "番号"],
      ["paragraph", null, null, "justify", "mail 太"],
    ],
  );
  assert.equal(saved.blocks.at(-1).runs[0].href, "mailto:a@example.com");
});

test("Office save rejects unsafe or impossible block lists", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Sections.docx", await fixture("word-sections.docx"));
  const sectionBreak = doc.blocks.find((b) => b.required);
  assert.ok(sectionBreak, "the section-break paragraph is marked required");
  assert.equal(sectionBreak.editable, false);
  const editable = doc.blocks.find((b) => b.editable);
  const all = doc.blocks.map(model);
  const cases = [
    all.filter((b) => b.id !== sectionBreak.id), // removing a section break
    all.map((b) => (b.id === sectionBreak.id ? { id: b.id, type: "paragraph", runs: [{ text: "x" }] } : b)), // rewriting a locked block
    [...all, { base: sectionBreak.id, type: "paragraph", runs: [] }], // copying a locked block
    all.map((b) => (b.id === editable.id ? { ...b, runs: [{ text: "x", href: "javascript:alert(1)" }] } : b)),
    all.map((b) => (b.id === editable.id ? { ...b, runs: [{ text: "a\u0001b" }] } : b)),
    all.map((b) => (b.id === editable.id ? { ...b, type: "heading", level: 12 } : b)),
    all.map((b) => (b.id === editable.id ? { ...b, type: "listItem", list: "star" } : b)),
    all.map((b) => (b.id === editable.id ? { ...b, align: "middle" } : b)),
    all.map((b) => (b.id === editable.id ? { ...b, runs: [{ text: "x", color: "ff0000" }] } : b)),
    [...all, { id: editable.id }],
  ];
  for (const blocks of cases) await assert.rejects(store.save(doc.id, doc.revision, blocks), (e) => e.status === 400);
  assert.equal((await store.get(doc.id)).history.length, 1);
  // moving the section break is allowed
  const moved = [all[1], all[0], ...all.slice(2)];
  await store.save(doc.id, doc.revision, moved);
});

test("Office autosave replaces the latest edit revision and history stays bounded", async (t) => {
  const { root, store } = await setup(t);
  let doc = await store.blank("Auto.docx");
  for (let i = 0; i < 5; i++) {
    const current = doc.blocks.find((b) => b.editable).id;
    doc = await store.save(doc.id, doc.revision, doc.blocks.map((b) => (b.id === current ? { id: current, type: "paragraph", runs: [{ text: `v${i}` }] } : { id: b.id })));
  }
  assert.deepEqual(doc.history.map((h) => h.source), ["original", "edit"]);
  const files = (await readdir(join(root, doc.id))).filter((f) => f.endsWith(".docx"));
  assert.equal(files.length, 2, "replaced autosave revisions are removed from disk");
  assert.equal((await store.get(doc.id)).blocks.find((b) => b.editable).text, "v4");
});

test("Office lists documents by last opened and supports rename and delete", async (t) => {
  const { store } = await setup(t);
  const a = await store.blank("A.docx");
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.blank("B.docx");
  assert.deepEqual((await store.list()).map((d) => d.name), ["B.docx", "A.docx"]);
  await new Promise((r) => setTimeout(r, 5));
  await store.open(a.id);
  assert.deepEqual((await store.list()).map((d) => d.name), ["A.docx", "B.docx"]);
  assert.equal((await store.rename(a.id, " 議事録 ")).name, "議事録.docx");
  await assert.rejects(store.rename(a.id, "a/b"), /文書名/);
  await assert.rejects(store.rename(a.id, ""), /文書名/);
  await store.remove(b.id);
  assert.deepEqual((await store.list()).map((d) => d.name), ["議事録.docx"]);
  await assert.rejects(store.remove(b.id));
  await assert.rejects(store.remove("../../etc"));
});

test("Office blank template still has heading styles for generated headings", async () => {
  const zip = await JSZip.loadAsync(await buildBlankDocx());
  assert.match(await part(zip, "word/styles.xml"), /w:styleId="Heading3"/);
  assert.ok(bodyOf(await part(zip, "word/document.xml")).length > 0);
});

test("Office text alignment keeps runs on kept text and ignores scattered letters", () => {
  const map = alignText("Bold italic underlined red text", "Bold now plain underlined red text edited site");
  assert.deepEqual(map.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.ok(map.slice(5, 14).every((v) => v === -1));
  assert.equal(map[14], 11); // " underlined red text" kept from the original
  assert.ok(alignText("abcdef", "xaxbxcx").every((v) => v === -1));
  assert.deepEqual(alignText("同じ文章", "同じ文章"), [0, 1, 2, 3]);
});
