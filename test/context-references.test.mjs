import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listContextEntries, resolveContextReferences } from "../server/context-references.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "devmoter-context-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "hidden"), { recursive: true });
  await writeFile(join(root, "README.md"), "hello");
  await writeFile(join(root, "src", "app.ts"), "export const value = 1;");
  await writeFile(join(root, ".env"), "SECRET=1");
  await writeFile(join(root, "node_modules", "hidden", "bad.js"), "nope");
  return root;
}

test("context listing stays scoped and excludes sensitive/build paths", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const entries = await listContextEntries(root);
  const paths = entries.map(item => item.path);

  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("src"));
  assert.ok(paths.includes("src/app.ts"));
  assert.ok(!paths.includes(".env"));
  assert.ok(!paths.some(path => path.startsWith("node_modules")));
});

test("folder references expand to bounded text files", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await resolveContextReferences(root, [
    { kind: "folder", path: "src" }
  ]);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].path, "src/app.ts");
  assert.match(result.items[0].content, /value = 1/);
});

test("context references reject traversal and symlinks", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    resolveContextReferences(root, [{ kind: "file", path: "../outside.txt" }]),
    /invalid|project-relative|escapes/i
  );

  await symlink(join(root, "README.md"), join(root, "linked.md"));
  await assert.rejects(
    resolveContextReferences(root, [{ kind: "file", path: "linked.md" }]),
    /symbolic links/i
  );
});
