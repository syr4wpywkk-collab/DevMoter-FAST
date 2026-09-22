import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBubblewrapCommand,
  chooseModel,
  createArtifactRegistry,
  createGrantRegistry,
  previewFile,
  resolveInsideRoot,
  runWithRouting
} from "../server/advanced-features.mjs";

test("safe preview treats HTML as inert text and images as image data", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-preview-"));
  await writeFile(join(root, "page.html"), "<script>alert(1)</script><h1>Hello</h1>");
  await writeFile(join(root, "tiny.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const html = await previewFile(root, "page.html");
  assert.equal(html.kind, "text");
  assert.match(html.content, /<script>/);
  assert.equal(html.language, "html");

  const image = await previewFile(root, "tiny.png");
  assert.equal(image.kind, "image");
  assert.equal(image.mime, "image/png");
});

test("path resolver blocks traversal and symlink escapes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "devmoter-root-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(root, "escape"));

  await assert.rejects(() => resolveInsideRoot(root, "../outside/secret.txt"), /relative path|escapes/i);
  await assert.rejects(() => resolveInsideRoot(root, "escape/secret.txt"), /Symlink escapes/i);
});

test("directory grants persist canonical path/mode and can be revoked", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-home-"));
  const shared = join(home, "shared");
  await mkdir(shared);
  const registry = createGrantRegistry({ file: join(home, ".config", "grants.json"), homeDir: home });
  const grant = await registry.add(shared, "read-write");
  assert.equal(grant.path, shared);
  assert.equal(grant.mode, "read-write");
  assert.equal((await registry.list()).length, 1);
  assert.equal(await registry.revoke(grant.id), true);
  assert.equal((await registry.list()).length, 0);
});

test("artifact registry only accepts files inside an approved root", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-artifact-"));
  await writeFile(join(root, "out.txt"), "ok");
  const registry = createArtifactRegistry({ file: join(root, ".state", "artifacts.json") });
  const artifact = await registry.register({
    sessionId: "s1", projectId: "p1", root, relativePath: "out.txt"
  });
  assert.equal(artifact.name, "out.txt");
  await assert.rejects(
    () => registry.register({
      sessionId: "s1", projectId: "p1", root, relativePath: "../nope"
    }),
    /relative path|escapes/i
  );
});

test("capability routing honors requirements and explicit override", () => {
  const models = [
    { id: "fast", providerId: "a", capabilities: { tools: true, vision: false } },
    { id: "vision", providerId: "b", capabilities: { tools: true, vision: true } }
  ];
  const routed = chooseModel({
    models,
    rules: [{ name: "vision", role: "review", providerId: "b", model: "vision" }],
    role: "review",
    requirements: { vision: true }
  });
  assert.equal(routed.model.id, "vision");
  assert.equal(routed.reason, "rule:vision");
  assert.throws(
    () => chooseModel({
      models, rules: [], role: "coding", requirements: { vision: true },
      override: { providerId: "a", model: "fast" }
    }),
    /does not meet/
  );
});

test("provider failover retries retryable failures and reports final provider", async () => {
  const env = {
    DEVMOTER_OLLAMA_URL: "http://127.0.0.1:11434",
    DEVMOTER_OLLAMA_MODELS: "a",
    DEVMOTER_OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8000/v1",
    DEVMOTER_OPENAI_COMPAT_MODELS: "b",
    DEVMOTER_PROVIDER_FAILOVER: "openai-compatible/b",
    DEVMOTER_MODEL_ROUTES: JSON.stringify([
      { role: "coding", providerId: "ollama", model: "a" }
    ])
  };
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "a" }] }), { status: 200 });
    }
    if (value.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "b" }] }), { status: 200 });
    }
    if (value.endsWith("/api/chat")) {
      return new Response(JSON.stringify({ error: "busy" }), { status: 503 });
    }
    if (value.endsWith("/chat/completions")) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "fallback ok" } }]
      }), { status: 200 });
    }
    throw new Error("unexpected " + value + " " + (options.method || "GET"));
  };
  const result = await runWithRouting({
    env, fetchImpl,
    messages: [{ role: "user", content: "hello" }],
    role: "coding", requirements: {}
  });
  assert.equal(result.providerId, "openai-compatible");
  assert.equal(result.model, "b");
  assert.equal(result.text, "fallback ok");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, 503);
});

test("required sandbox fails closed when bwrap is unavailable", () => {
  const spawn = () => ({ status: 127, stdout: "" });
  assert.throws(
    () => buildBubblewrapCommand({
      projectPath: "/tmp/project", command: "echo", args: ["ok"],
      env: { DEVMOTER_SANDBOX: "required" }, spawn
    }),
    /required.*unavailable/i
  );
});

test("available sandbox binds project and explicit grants", () => {
  const spawn = () => ({ status: 0, stdout: "bubblewrap 0.10.0" });
  const command = buildBubblewrapCommand({
    projectPath: "/work",
    grants: [{ path: "/shared", mode: "read" }],
    command: "node",
    args: ["script.js"],
    env: { DEVMOTER_SANDBOX: "required" },
    spawn
  });
  assert.equal(command.sandboxed, true);
  assert.equal(command.command, "bwrap");
  assert.ok(command.args.includes("--unshare-net"));
  assert.ok(command.args.includes("/shared"));
});


test("live preview target cannot escape the approved loopback endpoint", () => {
  const target = resolveLivePreviewTarget("127.0.0.1", 3000, "/app.js", "?v=1");
  assert.equal(target.origin, "http://127.0.0.1:3000");
  assert.equal(target.pathname, "/app.js");
  assert.throws(
    () => resolveLivePreviewTarget("127.0.0.1", 3000, "//169.254.169.254/latest/meta-data"),
    /Invalid live preview path/
  );
  assert.throws(
    () => resolveLivePreviewTarget("127.0.0.1", 3000, "/\\\\169.254.169.254"),
    /Invalid live preview path/
  );
});

test("live preview body is rejected while streaming once it exceeds the bound", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(12));
      controller.enqueue(new Uint8Array(12));
      controller.close();
    }
  }));
  await assert.rejects(() => readBoundedResponseBody(response, 16), /too large/);
});

test("failover never selects a model that misses the requested capabilities", async () => {
  const providers = [
    {
      id: "primary", label: "Primary", kind: "openai-compatible",
      baseUrl: "http://127.0.0.1:1/v1", apiKey: "", local: true,
      models: [{ id: "vision", capabilities: ["vision", "tools"], context: 32000 }]
    },
    {
      id: "fallback", label: "Fallback", kind: "openai-compatible",
      baseUrl: "http://127.0.0.1:2/v1", apiKey: "", local: true,
      models: [{ id: "text", capabilities: ["tools"], context: 32000 }]
    }
  ];
  await assert.rejects(
    () => runWithRouting({
      providers, routes: [], failover: ["fallback/text"], role: "coding",
      requirements: { vision: true },
      override: { providerId: "primary", model: "vision" },
      messages: [{ role: "user", content: "inspect image" }],
      fetchImpl: async () => new Response("retry", { status: 503 })
    }),
    /retry|failed|503/i
  );
});
