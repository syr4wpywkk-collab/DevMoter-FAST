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
import {
  DEVMOTER_API_VERSION,
  DevMoterClient,
  DevMoterError,
  createEventEnvelope
} from "../sdk/index.mjs";
import { EXIT, parseArgs } from "../cli/devmoter.mjs";

test("context references stay project-relative and exclude secrets/build output", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const answer = 42;\n");
  await writeFile(join(root, ".env"), "SECRET=never\n");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "ignored\n");

  const entries = await listContextEntries(root, "");
  assert.ok(entries.some(entry => entry.path === "src/app.ts" && entry.kind === "file"));
  assert.ok(entries.some(entry => entry.path === "src" && entry.kind === "folder"));
  assert.equal(entries.some(entry => entry.path.includes(".env")), false);
  assert.equal(entries.some(entry => entry.path.includes("node_modules")), false);

  const resolved = await resolveContextReferences(root, [
    { path: "src", kind: "folder" }
  ]);
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.items[0].path, "src/app.ts");
  assert.match(resolved.items[0].content, /answer = 42/);

  await assert.rejects(
    resolveContextReferences(root, [{ path: "../outside.txt", kind: "file" }]),
    /project-relative|invalid/
  );
});

test("context references reject symlinks and file size overflow", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-context-"));
  const outside = await mkdtemp(join(tmpdir(), "devmoter-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  await writeFile(join(outside, "secret.txt"), "outside\n");
  await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));
  await writeFile(join(root, "large.txt"), "x".repeat(256));

  await assert.rejects(
    resolveContextReferences(root, [{ path: "linked.txt", kind: "file" }]),
    /Symbolic links/
  );
  await assert.rejects(
    resolveContextReferences(
      root,
      [{ path: "large.txt", kind: "file" }],
      { maxFileBytes: 64 }
    ),
    /larger than/
  );
});

test("upload registry uses opaque IDs and supports removal", () => {
  const registry = createUploadRegistry({ ttlMs: 10000, maxEntries: 2 });
  const id = registry.add({ path: "/private/upload/file.txt", name: "file.txt" });
  assert.match(id, /^[0-9a-f-]{36}$/i);
  assert.equal(registry.get(id).name, "file.txt");
  registry.remove(id);
  assert.throws(() => registry.get(id), /unavailable|expired/);
});

test("SDK emits versioned envelopes and operation IDs", async () => {
  const calls = [];
  const client = new DevMoterClient({
    baseUrl: "http://127.0.0.1:8787",
    token: "test-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await client.runTask({
    project: "demo",
    agent: "build",
    task: "run tests"
  }, { operationId: "test-operation" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8787/api/automation/tasks");
  assert.equal(calls[0].init.headers["x-pocket-operation-id"], "test-operation");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-token");

  const event = createEventEnvelope("task.result", { ok: true }, {
    operationId: "test-operation",
    timestamp: "2026-09-22T00:00:00.000Z"
  });
  assert.equal(event.version, DEVMOTER_API_VERSION);
  assert.equal(event.operationId, "test-operation");
  assert.equal(event.type, "task.result");
});

test("SDK maps non-2xx responses to DevMoterError", async () => {
  const client = new DevMoterClient({
    fetchImpl: async () => new Response(
      JSON.stringify({ error: "missing", code: "project_not_found" }),
      { status: 404 }
    )
  });

  await assert.rejects(
    client.openProject("missing"),
    error => error instanceof DevMoterError &&
      error.status === 404 &&
      error.code === "project_not_found"
  );
});

test("CLI parsing keeps deterministic command arguments and exit codes", () => {
  const parsed = parseArgs([
    "task",
    "--project", "demo",
    "--agent", "build",
    "--task", "run tests",
    "--backend", "opencode",
    "--stream-json"
  ]);
  assert.equal(parsed.command, "task");
  assert.equal(parsed.options.project, "demo");
  assert.equal(parsed.options.agent, "build");
  assert.equal(parsed.options.task, "run tests");
  assert.equal(parsed.options["stream-json"], true);
  assert.deepEqual(EXIT, {
    OK: 0,
    USAGE: 2,
    NOT_FOUND: 4,
    SERVER: 5,
    TASK_FAILED: 6
  });
});
