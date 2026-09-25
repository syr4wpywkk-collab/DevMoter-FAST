import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKnowledgeStore, MAX_NOTE_BYTES } from "../server/knowledge-store.mjs";

async function fixture(t, options = {}) {
  const base = await mkdtemp(join(tmpdir(), "devmoter-knowledge-"));
  const rootDir = join(base, "knowledge");
  const project = { id: "project-1", path: join(base, "project") };
  await mkdir(project.path);
  const store = createKnowledgeStore({ rootDir, getProjectById: async id => id === project.id ? project : null, ...options });
  t.after(async () => { store.close(); await rm(base, { recursive: true, force: true }); });
  return { base, rootDir, store, project };
}

test("Knowledge notes keep stable opaque identity, support duplicate Unicode titles and CRUD", async t => {
  const { store, rootDir, project } = await fixture(t);
  const first = await store.create({ title: "数学 ✨", content: "沖縄のノート\n", projectId: project.id });
  const second = await store.create({ title: "数学 ✨", content: "別の内容" });
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first.id, second.id);
  assert.equal((await store.read(first.id)).content, "沖縄のノート\n");
  const changed = await store.update(first.id, { title: "名前変更", content: "更新済み" });
  assert.equal(changed.id, first.id);
  assert.equal(changed.projectId, project.id);
  assert.match(await readFile(join(rootDir, first.canonicalPath), "utf8"), /devmoter-knowledge/);
  assert.equal((await store.list()).length, 2);
  assert.deepEqual(await store.remove(first.id), { ok: true, id: first.id, semantics: "permanent" });
  await assert.rejects(store.read(first.id), { status: 404 });
});

test("Knowledge validates project identity and note size boundaries", async t => {
  const { store } = await fixture(t);
  const atLimit = await store.create({ title: "境界", content: "x".repeat(MAX_NOTE_BYTES) });
  assert.equal((await store.read(atLimit.id)).content.length, MAX_NOTE_BYTES);
  await assert.rejects(store.create({ title: "too big", content: "x".repeat(MAX_NOTE_BYTES + 1) }), { status: 413 });
  await assert.rejects(store.create({ title: "invalid project", projectId: "../../project" }), { status: 404 });
  await assert.rejects(store.read("../outside"), { status: 400 });
});

test("Knowledge rejects symlink escapes and rebuilds a deleted index from Markdown", async t => {
  const { base, rootDir, store } = await fixture(t);
  const note = await store.create({ title: "Durable", content: "source text" });
  const outside = join(base, "outside.md");
  await writeFile(outside, "secret");
  await rm(join(rootDir, note.canonicalPath));
  await symlink(outside, join(rootDir, note.canonicalPath));
  await assert.rejects(store.read(note.id), { status: 403 });
  await assert.rejects(store.update(note.id, { content: "overwrite attempt" }), { status: 403 });
  assert.equal(await readFile(outside, "utf8"), "secret");
  await rm(join(rootDir, note.canonicalPath));
  await store.close();
  for (const name of ["index.sqlite", "index.sqlite-shm", "index.sqlite-wal"]) await rm(join(rootDir, name), { force: true });
  const rebuilt = createKnowledgeStore({ rootDir });
  t.after(() => rebuilt.close());
  const recovered = await rebuilt.rebuild();
  assert.equal(recovered.notes, 0);
});

test("Knowledge index rebuild recovers valid and malformed metadata without losing Markdown", async t => {
  const { rootDir, store } = await fixture(t);
  const good = await store.create({ title: "再構築", content: "canonical body" });
  const malformedId = "123e4567-e89b-42d3-a456-426614174000";
  await writeFile(join(rootDir, "notes", `${malformedId}.md`), "<!-- devmoter-knowledge {broken -->\n\nrecover this text", "utf8");
  await store.close();
  for (const name of ["index.sqlite", "index.sqlite-shm", "index.sqlite-wal"]) await rm(join(rootDir, name), { force: true });
  const rebuilt = createKnowledgeStore({ rootDir });
  t.after(() => rebuilt.close());
  assert.equal((await rebuilt.rebuild()).notes, 2);
  assert.equal((await rebuilt.read(good.id)).content, "canonical body");
  assert.equal((await rebuilt.read(malformedId)).content, "<!-- devmoter-knowledge {broken -->\n\nrecover this text");
  assert.equal((await readdir(join(rootDir, "notes"))).length, 2);
});

test("Knowledge rebuild replaces a corrupt SQLite index from canonical note files", async t => {
  const { rootDir, store } = await fixture(t);
  const note = await store.create({ title: "Index recovery", content: "still here" });
  await store.close();
  await writeFile(join(rootDir, "index.sqlite"), "not a sqlite database", "utf8");
  const rebuilt = createKnowledgeStore({ rootDir });
  t.after(() => rebuilt.close());
  assert.equal((await rebuilt.rebuild()).notes, 1);
  assert.equal((await rebuilt.read(note.id)).content, "still here");
});

test("Knowledge API requires a trusted device and applies operation deduplication", async () => {
  const { createKnowledgeApi } = await import("../server/knowledge-api.mjs");
  const api = createKnowledgeApi({ store: { create: async () => ({ id: "x" }) }, authenticateDevice: async req => req.device ? { id: "device" } : null, claimOperation: (_req, res) => { res.writeHead(409); res.end(JSON.stringify({ error: "duplicate" })); return false; } });
  const response = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });
  const unauthorized = response();
  await api.handle({ method: "GET", device: false }, unauthorized, new URL("http://localhost/api/knowledge/notes"));
  assert.equal(unauthorized.status, 401);
  const duplicate = response();
  await api.handle({ method: "POST", device: true, headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from('{"title":"x"}'); } }, duplicate, new URL("http://localhost/api/knowledge/notes"));
  assert.equal(duplicate.status, 409);
});
