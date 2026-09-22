import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  listContextEntries,
  resolveContextReferences
} from "../server/context-references.mjs";
import { createUploadRegistry } from "../server/upload-registry.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "devmoter-context-v3-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "hidden"), { recursive: true });
  await writeFile(join(root, "README.md"), "hello\n");
  await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n");
  await writeFile(join(root, ".env"), "SECRET=never\n");
  await writeFile(join(root, ".npmrc"), "//registry:_authToken=never\n");
  await writeFile(join(root, "node_modules", "hidden", "bad.js"), "ignored\n");
  return root;
}

test("context autocomplete stays inside the registered project and excludes secrets/build output", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const entries = await listContextEntries(root);
  const paths = entries.map(item => item.path);
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("src"));
  assert.ok(paths.includes("src/app.ts"));
  assert.equal(paths.includes(".env"), false);
  assert.equal(paths.includes(".npmrc"), false);
  assert.equal(paths.some(path => path.startsWith("node_modules")), false);
});

test("context resolution rejects traversal, symlink escapes and oversized files", async t => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "devmoter-context-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  await writeFile(join(outside, "secret.txt"), "outside\n");
  await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));
  await writeFile(join(root, "large.txt"), "x".repeat(256));

  await assert.rejects(
    resolveContextReferences(root, [{ kind: "file", path: "../outside.txt" }]),
    /project-relative|invalid|escapes/i
  );
  await assert.rejects(
    resolveContextReferences(root, [{ kind: "file", path: "linked.txt" }]),
    /symbolic links/i
  );
  await assert.rejects(
    resolveContextReferences(
      root,
      [{ kind: "file", path: "large.txt" }],
      { maxFileBytes: 64 }
    ),
    /larger than/i
  );
});

test("folder context expansion is bounded and deterministic", async t => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let index = 0; index < 8; index += 1) {
    await writeFile(join(root, "src", `f${index}.ts`), `export const f${index} = ${index};\n`);
  }

  const result = await resolveContextReferences(
    root,
    [{ kind: "folder", path: "src" }],
    { maxFiles: 3, maxTotalBytes: 1024 }
  );
  assert.equal(result.items.length, 3);
  assert.equal(result.truncated, true);
  assert.deepEqual(
    result.items.map(item => item.path),
    [...result.items.map(item => item.path)].sort()
  );
});

test("upload registry exposes opaque IDs and evicts/removes entries without leaking paths", () => {
  const registry = createUploadRegistry({ maxEntries: 2, ttlMs: 60_000 });
  const first = registry.add({ path: "/private/one", name: "one.txt", size: 1 });
  const second = registry.add({ path: "/private/two", name: "two.txt", size: 2 });
  const third = registry.add({ path: "/private/three", name: "three.txt", size: 3 });

  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first, second);
  assert.throws(() => registry.get(first), /unavailable|expired/i);
  assert.equal(registry.get(second).name, "two.txt");
  assert.equal(registry.get(third).name, "three.txt");

  registry.remove(second);
  assert.throws(() => registry.get(second), /unavailable|expired/i);
});
