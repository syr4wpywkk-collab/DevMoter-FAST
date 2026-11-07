import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { writeFileNoFollow } from "../server/safe-file.mjs";

test("writeFileNoFollow creates and overwrites a regular file", async t => {
  const dir = await mkdtemp(join(tmpdir(), "nofollow-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "note.md");
  const created = await writeFileNoFollow(file, "first version");
  assert.equal(created.size, "first version".length);
  assert.equal(await readFile(file, "utf8"), "first version");
  const updated = await writeFileNoFollow(file, "short");
  assert.equal(updated.size, 5);
  assert.equal(await readFile(file, "utf8"), "short");
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
});

test("writeFileNoFollow refuses a symlink at the target and leaves its destination unchanged", async t => {
  const dir = await mkdtemp(join(tmpdir(), "nofollow-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outside = join(dir, "outside.txt");
  await writeFile(outside, "SYNTHETIC_ORIGINAL");
  await mkdir(join(dir, "project"));
  const link = join(dir, "project", "note.md");
  await symlink(outside, link);
  await assert.rejects(writeFileNoFollow(link, "replaced"), error => error.code === "ELOOP");
  assert.equal(await readFile(outside, "utf8"), "SYNTHETIC_ORIGINAL");
  assert.equal((await lstat(link)).isSymbolicLink(), true);
});

test("writeFileNoFollow refuses a dangling symlink without creating its destination", async t => {
  const dir = await mkdtemp(join(tmpdir(), "nofollow-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = join(dir, "missing.txt");
  const link = join(dir, "note.md");
  await symlink(missing, link);
  await assert.rejects(writeFileNoFollow(link, "x"), error => error.code === "ELOOP");
  await assert.rejects(lstat(missing), error => error.code === "ENOENT");
});

test("writeFileNoFollow refuses a non-regular target", async t => {
  const dir = await mkdtemp(join(tmpdir(), "nofollow-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(writeFileNoFollow(dir, "x"));
});

test("project Markdown saves go through the no-follow writer", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function projectWriteFile(");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("\n}\n", start));
  assert.match(body, /writeFileNoFollow\(resolved\.target/);
  assert.doesNotMatch(body, /\bwriteFile\(resolved\.target/);
});
