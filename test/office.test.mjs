import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createOfficeStore } from "../server/office/store.mjs";
import { createOfficeAi } from "../server/office/ai.mjs";
import { buildBlankDocx } from "../server/office/engine.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "office-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createOfficeStore({ rootDir: root }) };
}
async function fixture() {
  const zip = await JSZip.loadAsync(await buildBlankDocx());
  const xml = await zip.file("word/document.xml").async("string");
  zip.file(
    "word/document.xml",
    xml.replace(
      "<w:p/>",
      '<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>',
    ),
  );
  zip.file(
    "word/header1.xml",
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Preserve header</w:t></w:r></w:p></w:hdr>',
  );
  zip.file("customXml/item1.xml", "<custom>Unknown extension</custom>");
  return zip.generateAsync({ type: "uint8array" });
}
test("Office opens, edits, preserves untouched parts and reloads after restart", async (t) => {
  const { root, store } = await setup(t);
  const bytes = await fixture();
  const doc = await store.create("Example.docx", bytes);
  const block = doc.blocks.find((b) => b.editable);
  assert.equal(block.text, "Hello world");
  assert.equal(block.runs[0].bold, true);
  const saved = await store.save(doc.id, doc.revision, [
    { blockId: block.id, text: "Hello friend" },
  ]);
  assert.equal(saved.blocks.find((b) => b.editable).text, "Hello friend");
  assert.equal(saved.history.length, 2);
  const output = await JSZip.loadAsync((await store.download(doc.id)).bytes);
  const original = await JSZip.loadAsync(bytes);
  for (const path of [
    "word/styles.xml",
    "word/header1.xml",
    "customXml/item1.xml",
  ])
    assert.equal(
      await output.file(path).async("string"),
      await original.file(path).async("string"),
    );
  const xml = await output.file("word/document.xml").async("string");
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:keepNext\/>/);
  assert.equal(
    (await createOfficeStore({ rootDir: root }).get(doc.id)).revision,
    saved.revision,
  );
  assert.deepEqual(
    (await store.download(doc.id, doc.revision)).bytes,
    Buffer.from(bytes),
  );
  const disk = JSON.parse(
    await readFile(join(root, doc.id, "metadata.json"), "utf8"),
  );
  assert.equal(disk.history[0].source, "original");
});
test("Office blank document supports first edit and prevents XML injection", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("New.docx");
  const block = doc.blocks.find((b) => b.editable);
  const saved = await store.save(doc.id, doc.revision, [
    { blockId: block.id, text: "<script>& hi" },
  ]);
  assert.equal(saved.blocks.find((b) => b.editable).text, "<script>& hi");
});
test("Office Enter adds paragraphs while preserving existing package parts", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Paragraphs.docx", await fixture());
  const saved = await store.save(doc.id, doc.revision, [
    {
      blockId: doc.blocks.find((b) => b.editable).id,
      text: "First paragraph\nSecond paragraph\n第三段落",
    },
  ]);
  assert.deepEqual(
    saved.blocks.filter((b) => b.editable).map((b) => b.text),
    ["First paragraph", "Second paragraph", "第三段落"],
  );
});
test("Office rejects stale, duplicate, unknown, oversized and path inputs atomically", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Test.docx", await fixture());
  const block = doc.blocks.find((b) => b.editable);
  for (const edits of [
    [{ blockId: "unknown", text: "x" }],
    [
      { blockId: block.id, text: "x" },
      { blockId: block.id, text: "y" },
    ],
    [{ blockId: block.id, text: "x", command: "whoami" }],
    [{ blockId: block.id, text: "x".repeat(16001) }],
  ])
    await assert.rejects(store.save(doc.id, doc.revision, edits));
  await assert.rejects(
    store.save(doc.id, "stale", [{ blockId: block.id, text: "x" }]),
    (e) => e.status === 409,
  );
  await assert.rejects(store.create("../Test.docx", await fixture()));
  await assert.rejects(store.get("../../etc/passwd"));
  assert.equal((await store.get(doc.id)).history.length, 1);
});
test("Office AI produces validated proposal without changing saved document", async (t) => {
  const { store } = await setup(t);
  const doc = await store.create("Test.docx", await fixture());
  const block = doc.blocks.find((b) => b.editable);
  const ai = createOfficeAi({
    store,
    authorize: async () => {},
    prepareChat: async () => ({
      context: { planner: { providerName: "Mock", model: "test" } },
      secrets: [],
      chat: async () =>
        JSON.stringify({ edits: [{ blockId: block.id, text: "AI proposal" }] }),
    }),
  });
  const identity = { ownerId: "owner:test" };
  const run = await ai.start(
    {
      documentId: doc.id,
      revision: doc.revision,
      goal: "Improve",
      share: true,
    },
    identity,
  );
  for (let i = 0; i < 20 && ai.get(run.id, identity).status === "planning"; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ai.get(run.id, identity).status, "proposed");
  assert.equal((await store.get(doc.id)).revision, doc.revision);
  assert.throws(() => ai.get(run.id, { ownerId: "another" }));
  assert.equal(ai.get("missing", identity).status, "unknown");
});
test("Office AI Stop prevents late response from becoming a proposal", async (t) => {
  const { store } = await setup(t);
  const doc = await store.blank("Test.docx");
  let resolve;
  const ai = createOfficeAi({
    store,
    authorize: async () => {},
    prepareChat: async () => ({
      context: { planner: {} },
      secrets: [],
      chat: () =>
        new Promise((r) => {
          resolve = r;
        }),
    }),
  });
  const identity = { ownerId: "owner:test" };
  const run = await ai.start(
    {
      documentId: doc.id,
      revision: doc.revision,
      goal: "Improve",
      share: true,
    },
    identity,
  );
  assert.equal(ai.stop(run.id, identity).status, "stop_requested");
  resolve('{"edits":[]}');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ai.get(run.id, identity).status, "stopped");
  assert.deepEqual(ai.get(run.id, identity).edits, []);
});
test("Office rejects corrupt revision paths and symlink document storage", async (t) => {
  const { root, store } = await setup(t);
  const doc = await store.blank("Test.docx");
  const path = join(root, doc.id, "metadata.json");
  const meta = JSON.parse(await readFile(path, "utf8"));
  meta.revision = "../../outside";
  meta.history[0].revision = meta.revision;
  await writeFile(path, JSON.stringify(meta), { mode: 0o600 });
  await assert.rejects(store.get(doc.id), /破損/);
  const other = await store.blank("Other.docx");
  const rev = join(root, other.id, `${other.revision}.docx`);
  await rm(rev);
  await symlink(path, rev);
  await assert.rejects(store.get(other.id), /読み込めません/);
});
test("Office ZIP inflation is bounded before loading oversized parts", async (t) => {
  const { store } = await setup(t);
  const zip = await JSZip.loadAsync(await buildBlankDocx());
  zip.file("customXml/huge.xml", "x".repeat(17 * 1024 * 1024));
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  await assert.rejects(store.create("Bomb.docx", bytes), /zip rejected/);
});
test("Office rejects document-defined DTD entities before XML parsing", async (t) => {
  const { store } = await setup(t);
  const zip = await JSZip.loadAsync(await buildBlankDocx());
  zip.file(
    "customXml/item.xml",
    '<!DOCTYPE x [<!ENTITY danger "payload">]><x>&danger;</x>',
  );
  await assert.rejects(
    store.create(
      "Entities.docx",
      await zip.generateAsync({ type: "uint8array" }),
    ),
    /DTD/,
  );
});
test("Office AI excludes secret content and rejects malformed/out-of-scope proposals", async (t) => {
  const { store } = await setup(t);
  let doc = await store.create("Test.docx", await fixture());
  doc = await store.save(doc.id, doc.revision, [
    {
      blockId: doc.blocks.find((b) => b.editable).id,
      text: "Visible text\napi_key=sk-secretcredentialvalue",
    },
  ]);
  for (const raw of [
    "not json",
    '{"edits":[{"blockId":"unknown","text":"No"}]}',
    '{"edits":[],"command":"whoami"}',
  ]) {
    let shared;
    const ai = createOfficeAi({
      store,
      authorize: async () => {},
      prepareChat: async () => ({
        context: { planner: {} },
        secrets: [],
        chat: async (messages) => {
          shared = messages;
          return raw;
        },
      }),
    });
    const identity = { ownerId: "owner:test" };
    const run = await ai.start(
      {
        documentId: doc.id,
        revision: doc.revision,
        goal: "Improve",
        share: true,
      },
      identity,
    );
    for (
      let i = 0;
      i < 20 && ai.get(run.id, identity).status === "planning";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(ai.get(run.id, identity).status, "failed");
    assert.equal(ai.get(run.id, identity).sharing.excluded, 1);
    assert.equal(
      JSON.stringify(shared).includes("sk-secretcredentialvalue"),
      false,
    );
  }
});
