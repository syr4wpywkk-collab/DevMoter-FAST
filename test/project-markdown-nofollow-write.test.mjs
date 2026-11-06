import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { writeFileNoFollow } from "../server/safe-file.mjs";

test("writeFileNoFollow creates and overwrites a regular file", async t => {
  const dir = await mkdtemp(join(tmpdir(), "md-nofollow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "note.md");
  const created = await writeFileNoFollow(file, "one");
  assert.equal(created.size, 3);
  const updated = await writeFileNoFollow(file, "two");
  assert.equal(updated.size, 3);
  assert.equal(await readFile(file, "utf8"), "two");
});

test("writeFileNoFollow refuses a symlink and a dangling symlink", async t => {
  const dir = await mkdtemp(join(tmpdir(), "md-nofollow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outside = join(dir, "outside.txt");
  await writeFile(outside, "secret");
  const link = join(dir, "note.md");
  await symlink(outside, link);
  await assert.rejects(writeFileNoFollow(link, "pwned"), error => error.code === "ELOOP");
  assert.equal(await readFile(outside, "utf8"), "secret");

  const dangling = join(dir, "missing.md");
  await symlink(join(dir, "does-not-exist.txt"), dangling);
  await assert.rejects(writeFileNoFollow(dangling, "pwned"), error => error.code === "ELOOP");
  await assert.rejects(readFile(join(dir, "does-not-exist.txt")), error => error.code === "ENOENT");
});

test("writeFileNoFollow refuses a non-regular final path", async t => {
  const dir = await mkdtemp(join(tmpdir(), "md-nofollow-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const nested = join(dir, "dir.md");
  await mkdir(nested);
  await assert.rejects(writeFileNoFollow(nested, "x"), error => error.code === "EISDIR" || error.code === "EINVAL");
});

test("project markdown save uses the no-follow writer", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function projectWriteFile"), source.indexOf("async function projectGitStatus"));
  assert.match(body, /writeFileNoFollow\(/);
  assert.doesNotMatch(body, /writeFile\(/);
});
