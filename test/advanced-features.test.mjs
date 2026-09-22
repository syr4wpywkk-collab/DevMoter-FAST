import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedResponseBody, resolveLivePreviewTarget } from "../server/advanced-api.mjs";
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


test("live preview target resolution cannot escape loopback with scheme-relative paths", () => {
  const safe = resolveLivePreviewTarget("127.0.0.1", 3000, "/assets/app.js", "?v=1");
  assert.equal(safe.hostname, "127.0.0.1");
  assert.equal(safe.port, "3000");
  assert.equal(safe.pathname, "/assets/app.js");
  assert.equal(safe.search, "?v=1");

  assert.throws(
    () => resolveLivePreviewTarget("127.0.0.1", 3000, "//169.254.169.254/latest"),
    /Invalid live preview path/
  );
  assert.throws(
    () => resolveLivePreviewTarget("127.0.0.1", 3000, "/\\\\169.254.169.254/latest"),
    /Invalid live preview path/
  );
});

test("live preview response bodies are bounded while streaming", async () => {
  const small = new Response(new Uint8Array(8));
  assert.equal((await readBoundedResponseBody(small, 16)).length, 8);

  const large = new Response(new Uint8Array(32));
  await assert.rejects(() => readBoundedResponseBody(large, 16), /too large/i);
});

test("provider failover skips models that do not meet requested capabilities", async () => {
  const env = {
    DEVMOTER_OLLAMA_URL: "http://127.0.0.1:11434",
    DEVMOTER_OLLAMA_MODELS: "vision-model",
    DEVMOTER_OLLAMA_CAPABILITIES: "vision",
    DEVMOTER_OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:8000/v1",
    DEVMOTER_OPENAI_COMPAT_MODELS: "text-only",
    DEVMOTER_OPENAI_COMPAT_CAPABILITIES: "tools",
    DEVMOTER_PROVIDER_FAILOVER: "openai-compatible/text-only",
    DEVMOTER_MODEL_ROUTES: JSON.stringify([
      { role: "coding", providerId: "ollama", model: "vision-model" }
    ])
  };
  const fetchImpl = async url => {
    const value = String(url);
    if (value.endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "vision-model" }] }), { status: 200 });
    }
    if (value.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "text-only" }] }), { status: 200 });
    }
    if (value.endsWith("/api/chat")) {
      return new Response(JSON.stringify({ error: "busy" }), { status: 503 });
    }
    if (value.endsWith("/chat/completions")) {
      throw new Error("incompatible fallback must not be called");
    }
    throw new Error("unexpected " + value);
  };

  await assert.rejects(
    () => runWithRouting({
      env, fetchImpl,
      messages: [{ role: "user", content: "describe image" }],
      role: "coding",
      requirements: { vision: true }
    }),
    /Ollama request failed/
  );
});

test("sandbox status is explicit that agent execution is not yet enforced", () => {
  const status = sandboxStatus({
    env: { DEVMOTER_SANDBOX: "required" },
    spawn: () => ({ status: 0, stdout: "bubblewrap 1.0" })
  });
  assert.equal(status.available, true);
  assert.equal(status.enforced, false);
  assert.equal(status.scope, "capability-only");
});
