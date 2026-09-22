import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  listContextEntries,
  resolveContextReferences
} from "../server/context-references.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "devmoter-context-v3-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "hidden"), { recursive: true });
  await writeFile(join(root, "README.md"), "hello\n");
  await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".env"), "SECRET=never\n");
  await writeFile(join(root, "node_modules", "hidden", "bad.js"), "ignored\n");
  return root;
}

test("context listing and folder expansion stay bounded inside the project", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const entries = await listContextEntries(root);
  const paths = entries.map(item => item.path);
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("src"));
  assert.ok(paths.includes("src/app.ts"));
  assert.equal(paths.includes(".env"), false);
  assert.equal(paths.some(path => path.startsWith("node_modules")), false);

  const resolved = await resolveContextReferences(root, [
    { kind: "folder", path: "src" }
  ]);
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.items[0].path, "src/app.ts");
  assert.match(resolved.items[0].content, /value = 1/);
});

test("context references reject traversal, symlink files and symlink folders", async t => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "devmoter-context-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  await writeFile(join(outside, "secret.txt"), "outside\n");
  await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));
  await symlink(outside, join(root, "linked-dir"));

  await assert.rejects(
    resolveContextReferences(root, [{ kind: "file", path: "../outside.txt" }]),
    /project-relative|invalid|escape/i
  );
  await assert.rejects(
    resolveContextReferences(root, [{ kind: "file", path: "linked.txt" }]),
    /symbolic|symlink|escape/i
  );
  await assert.rejects(
    resolveContextReferences(root, [{ kind: "folder", path: "linked-dir" }]),
    /symbolic|symlink|escape/i
  );
});

test("context file and total-size limits fail safely", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "src", "large.txt"), "x".repeat(512));

  await assert.rejects(
    resolveContextReferences(
      root,
      [{ kind: "file", path: "src/large.txt" }],
      { maxFileBytes: 64, maxTotalBytes: 1024 }
    ),
    /larger|limit/i
  );
});
