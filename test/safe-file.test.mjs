import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHandle, withOpenFile } from "../server/safe-file.mjs";

test("withOpenFile checks and reads the same open file", async t => {
  const dir = await mkdtemp(join(tmpdir(), "safe-file-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "a.txt");
  await writeFile(file, "hello");
  const result = await withOpenFile(file, {}, async (handle, info) => ({ size: info.size, text: await readHandle(handle, 100, "utf8") }));
  assert.deepEqual(result, { size: 5, text: "hello" });
});

test("noFollow refuses a symlink instead of following it", async t => {
  const dir = await mkdtemp(join(tmpdir(), "safe-file-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "secret"), "s");
  await symlink(join(dir, "secret"), join(dir, "link"));
  await assert.rejects(withOpenFile(join(dir, "link"), { noFollow: true }, async () => "read"), error => error.code === "ELOOP");
  assert.equal(await withOpenFile(join(dir, "link"), {}, async handle => readHandle(handle, 10, "utf8")), "s");
});

test("readHandle enforces its byte limit even if the file grew after the size check", async t => {
  const dir = await mkdtemp(join(tmpdir(), "safe-file-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "big");
  await writeFile(file, "x".repeat(200_000));
  await assert.rejects(withOpenFile(file, {}, handle => readHandle(handle, 1000)), error => error.code === "EFBIG");
  await mkdir(join(dir, "d"));
  assert.equal(await withOpenFile(join(dir, "d"), {}, async (_handle, info) => info.isDirectory()), true);
});
