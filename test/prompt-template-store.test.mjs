import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPromptTemplateStore, validatePromptTemplateBackup, MAX_TEMPLATE_BODY_BYTES } from "../server/prompt-template-store.mjs";

async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "devmoter-prompt-templates-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const rootDir = join(base, "store");
  const projects = new Set(["alpha", "beta"]);
  let tick = 0;
  const options = {
    rootDir,
    getProjectById: async id => projects.has(id) ? { id } : null,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
  };
  return { base, rootDir, projects, options, store: createPromptTemplateStore(options) };
}

test("templates are saved, reloaded from disk, edited one at a time and deleted", async t => {
  const { store, options, rootDir } = await fixture(t);
  const first = await store.create({ name: "Review", description: "Code review", body: "Review {{file}}" });
  const second = await store.create({ name: "Summarize", body: "Summarize this" });
  assert.equal(first.projectId, null);
  assert.equal((await stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(rootDir, "templates.json"))).mode & 0o777, 0o600);

  const reopened = createPromptTemplateStore(options);
  assert.deepEqual((await reopened.list()).map(item => item.name), ["Review", "Summarize"]);
  assert.equal((await reopened.read(first.id)).body, "Review {{file}}");

  const updated = await reopened.update(first.id, { name: "Review file" });
  assert.equal(updated.body, "Review {{file}}");
  assert.equal(updated.createdAt, first.createdAt);
  assert.notEqual(updated.updatedAt, first.updatedAt);
  assert.deepEqual(await reopened.read(second.id), second, "other templates are untouched");

  await reopened.remove(first.id);
  await assert.rejects(reopened.read(first.id), { status: 404 });
  await assert.rejects(reopened.remove(first.id), { status: 404 });
  assert.equal((await reopened.list()).length, 1);
});

test("invalid input is rejected without changing the store", async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.create({ name: "", body: "x" }));
  await assert.rejects(store.create({ name: "x", body: "" }));
  await assert.rejects(store.create({ name: "x", body: "a".repeat(MAX_TEMPLATE_BODY_BYTES + 1) }));
  await assert.rejects(store.create({ name: "x", body: "x", projectId: "../etc" }));
  await assert.rejects(store.create({ name: "x", body: "x", projectId: "unknown" }), { status: 404 });
  await assert.rejects(store.create([]));
  await assert.rejects(store.read("../templates"));
  assert.deepEqual(await store.list({ all: true }), []);
});

test("project templates stay in their project; global ones appear everywhere", async t => {
  const { store } = await fixture(t);
  await store.create({ name: "Global", body: "g" });
  const alpha = await store.create({ name: "Alpha only", body: "a", projectId: "alpha" });
  await store.create({ name: "Beta only", body: "b", projectId: "beta" });
  assert.deepEqual((await store.list()).map(item => item.name), ["Global"]);
  assert.deepEqual((await store.list({ projectId: "alpha" })).map(item => item.name), ["Alpha only", "Global"]);
  assert.deepEqual((await store.list({ projectId: "beta" })).map(item => item.name), ["Beta only", "Global"]);
  assert.equal((await store.list({ all: true })).length, 3);
  await assert.rejects(store.update(alpha.id, { projectId: "unknown" }), { status: 404 });
  assert.equal((await store.update(alpha.id, { projectId: null })).projectId, null);
});

test("backup restores only on request and never overwrites unless told to", async t => {
  const { store, projects } = await fixture(t);
  const kept = await store.create({ name: "Keep", body: "original" });
  const scoped = await store.create({ name: "Scoped", body: "s", projectId: "beta" });
  const backup = JSON.parse(JSON.stringify(await store.exportBackup()));
  assert.equal(backup.templates.length, 2);

  await store.update(kept.id, { body: "edited after backup" });
  await store.remove(scoped.id);
  projects.delete("beta");

  const skipped = await store.importBackup(backup);
  assert.equal(skipped.imported, 0);
  assert.deepEqual(skipped.skipped.map(item => item.reason).sort(), ["exists", "unknown-project"]);
  assert.equal((await store.read(kept.id)).body, "edited after backup");

  projects.add("beta");
  const overwritten = await store.importBackup(backup, { conflict: "overwrite" });
  assert.deepEqual({ imported: overwritten.imported, overwritten: overwritten.overwritten }, { imported: 1, overwritten: 1 });
  assert.equal((await store.read(kept.id)).body, "original");
  assert.equal((await store.read(scoped.id)).projectId, "beta");
});

test("malformed backups are rejected as a whole", async t => {
  const { store } = await fixture(t);
  const good = { id: "11111111-1111-4111-8111-111111111111", name: "A", description: "", body: "a", projectId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const wrap = templates => ({ format: "devmoter-prompt-templates", version: 1, templates });
  assert.equal(validatePromptTemplateBackup(wrap([good])).length, 1);
  const bad = [
    null, [], "text", { format: "other", version: 1, templates: [] }, { format: "devmoter-prompt-templates", version: 2, templates: [] },
    wrap("nope"), wrap([good, good]), wrap([{ ...good, id: "../x" }]), wrap([{ ...good, body: 5 }]),
    wrap([{ ...good, name: "" }]), wrap([{ ...good, projectId: 7 }]), wrap([{ ...good, extra: true }]), wrap([{ ...good, createdAt: "yesterday" }]),
    wrap([good, { ...good, id: "22222222-2222-4222-8222-222222222222", body: "" }])
  ];
  for (const backup of bad) await assert.rejects(store.importBackup(backup), undefined, JSON.stringify(backup));
  await assert.rejects(store.importBackup(wrap([good]), { conflict: "merge" }));
  assert.deepEqual(await store.list({ all: true }), []);
});

test("a corrupted or symlinked store fails closed", async t => {
  const { base, rootDir, store, options } = await fixture(t);
  await store.create({ name: "A", body: "a" });
  await writeFile(join(rootDir, "templates.json"), "{not json");
  await assert.rejects(createPromptTemplateStore(options).list(), { status: 500 });
  assert.equal(await readFile(join(rootDir, "templates.json"), "utf8"), "{not json");

  const link = join(base, "link");
  await symlink(rootDir, link);
  await assert.rejects(createPromptTemplateStore({ ...options, rootDir: link }).list(), { status: 500 });
  assert.throws(() => createPromptTemplateStore({ rootDir: "relative" }));
});

test("concurrent writes do not lose templates", async t => {
  const { store } = await fixture(t);
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.create({ name: `T${index}`, body: "x" })));
  assert.equal((await store.list()).length, 20);
});
