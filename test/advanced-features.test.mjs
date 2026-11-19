import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdvancedApi, readBoundedResponseBody, resolveLivePreviewTarget, rewriteLivePreviewBody } from "../server/advanced-api.mjs";
import {
  IMAGE_PREVIEW_LIMIT,
  TEXT_PREVIEW_LIMIT,
  assertExternalBackendExecutionAllowed,
  buildBubblewrapCommand,
  chooseModel,
  createArtifactRegistry,
  createGrantRegistry,
  isRetryableProviderFailure,
  publicArtifact,
  listProjectDirectory,
  previewFile,
  externalBackendSandboxPolicy,
  resolveInsideRoot,
  runWithRouting,
  sandboxStatus
} from "../server/advanced-features.mjs";

test("safe preview treats HTML as inert text and images as image data", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-preview-"));
  await writeFile(join(root, "page.html"), "<script>alert(1)</script><h1>Hello</h1>");
  await writeFile(join(root, "tiny.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const html = await previewFile(root, "page.html");
  assert.equal(html.kind, "text");
  assert.equal(html.content, "<script>alert(1)</script><h1>Hello</h1>", "HTML is returned verbatim as inert text");
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
  assert.equal(typeof safe, "string", "fetch receives a string built from a fixed origin");
  assert.equal(safe, "http://127.0.0.1:3000/assets/app.js?v=1");
  const parsed = new URL(safe);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.port, "3000");
  assert.equal(parsed.pathname, "/assets/app.js");
  assert.equal(parsed.search, "?v=1");
  assert.equal(resolveLivePreviewTarget("::1", 5173, "/", ""), "http://[::1]:5173/");
  assert.equal(resolveLivePreviewTarget("localhost", 5173, "/x", "?q=<a b>"), "http://localhost:5173/x?q=%3Ca%20b%3E");
  for (const [host, port, path] of [
    ["169.254.169.254", 80, "/"],
    ["127.0.0.1.nip.io", 3000, "/"],
    ["127.0.0.1", "3000@evil.example", "/"],
    ["127.0.0.1", 70000, "/"]
  ]) {
    assert.throws(() => resolveLivePreviewTarget(host, port, path), /not allowed/, `${host}:${port}`);
  }
  for (const path of ["/%2f%2fevil.example/", "/%252e%252e/secret", "/../secret", "/http:/evil", "/a\u0000b", "/a b", "relative"]) {
    assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 3000, path), /Invalid live preview path/, path);
  }

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
    /busy/
  );
});

test("sandbox status reports enforced DevMoter-owned tool boundary", () => {
  const status = sandboxStatus({
    env: { DEVMOTER_SANDBOX: "required" },
    spawn: () => ({ status: 0, stdout: "bubblewrap 1.0" })
  });
  assert.equal(status.available, true);
  assert.equal(status.enforced, true);
  assert.equal(status.scope, "devmoter-owned-agent-tools");
  assert.equal(status.externalBackends, "blocked");
});

test("required sandbox fails closed for external agent backends", () => {
  const spawn = () => ({ status: 0, stdout: "bubblewrap 1.0" });
  const blocked = externalBackendSandboxPolicy("codex", {
    env: { DEVMOTER_SANDBOX: "required" },
    spawn
  });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /cannot guarantee|blocks external/i);
  assert.throws(
    () => assertExternalBackendExecutionAllowed("opencode", {
      env: { DEVMOTER_SANDBOX: "required" },
      spawn
    }),
    /required blocks external|cannot guarantee/i
  );

  const preferred = externalBackendSandboxPolicy("codex", {
    env: { DEVMOTER_SANDBOX: "preferred" },
    spawn
  });
  assert.equal(preferred.allowed, true);
});


test("read-only file browser hides sensitive dotfiles and blocks symlink escapes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "devmoter-browser-"));
  const root = join(parent, "project");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "main.js"), "console.log('ok')");
  await writeFile(join(root, ".env"), "SECRET=nope");
  await writeFile(join(outside, "secret.txt"), "outside");
  await symlink(outside, join(root, "escape"));

  const browser = await listProjectDirectory(root, "");
  assert.ok(browser.entries.some(item => item.name === "src" && item.kind === "directory"));
  assert.equal(browser.entries.some(item => item.name === ".env"), false);
  assert.equal(browser.entries.some(item => item.name === "escape"), false);

  const src = await listProjectDirectory(root, "src");
  assert.equal(src.entries[0].path, "src/main.js");
  assert.equal(src.entries[0].kind, "text");
  await symlink(join(root, "src"), join(root, "src-link"));
  await assert.rejects(() => listProjectDirectory(root, "src-link"), /not a regular project directory/i);
  await assert.rejects(() => listProjectDirectory(root, "../outside"), /stay inside|escapes/i);
});

test("live preview rewrites root-relative HTML/CSS/module assets through the authenticated proxy", () => {
  const html = Buffer.from('<html><head></head><body><script type="module" src="/src/main.js"></script><img src="/logo.png"><form action="/submit"></form></body></html>');
  const rewritten = rewriteLivePreviewBody(html, "text/html; charset=utf-8", "abc123").toString("utf8");
  assert.match(rewritten, /<base href="\/api\/live-preview\/proxy\/abc123\/">/);
  assert.match(rewritten, /src="\/api\/live-preview\/proxy\/abc123\/src\/main\.js"/);
  assert.match(rewritten, /action="\/api\/live-preview\/proxy\/abc123\/submit"/);
  assert.match(rewritten, /XMLHttpRequest/);

  const css = rewriteLivePreviewBody(Buffer.from('body{background:url("/bg.png")}'), "text/css", "abc123").toString("utf8");
  assert.match(css, /url\("\/api\/live-preview\/proxy\/abc123\/bg\.png/);

  const js = rewriteLivePreviewBody(Buffer.from('import x from "/src/x.js";'), "application/javascript", "abc123").toString("utf8");
  assert.match(js, /from "\/api\/live-preview\/proxy\/abc123\/src\/x\.js"/);
});

test("sensitive paths cannot be opened directly or through internal symlink aliases", async t => {
  const parent = await mkdtemp(join(tmpdir(), "devmoter-sensitive-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "project");
  await mkdir(root);
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".env"), "MY_API_KEY=private");
  await writeFile(join(root, ".git", "config"), "[core]");
  await writeFile(join(root, ".npmrc"), "//example.invalid/:_authToken=private");
  await writeFile(join(root, "report.txt"), "public");
  await symlink(join(root, ".env"), join(root, "alias.txt"));

  assert.equal((await previewFile(root, "report.txt")).content, "public");
  for (const path of [".env", ".git/config", ".npmrc", "alias.txt"]) {
    await assert.rejects(() => previewFile(root, path), /Sensitive paths/);
  }
  await assert.rejects(() => listProjectDirectory(root, ".git"), /Sensitive paths/);
  assert.equal((await listProjectDirectory(root)).entries.some(item => item.name === ".npmrc"), false);
});

test("artifact exports omit host roots and reject secret files", async t => {
  const parent = await mkdtemp(join(tmpdir(), "devmoter-artifact-policy-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(join(parent, "report.txt"), "report");
  await writeFile(join(parent, ".env"), "AUTH_SECRET=private");
  const registry = createArtifactRegistry({ file: join(parent, "state", "artifacts.json") });
  const artifact = await registry.register({
    sessionId: "test", projectId: "project", root: parent, relativePath: "report.txt"
  });
  assert.equal(artifact.root, parent);
  const safe = publicArtifact(artifact);
  assert.equal("root" in safe, false);
  assert.equal(safe.path, "report.txt");
  await assert.rejects(() => registry.register({
    sessionId: "test", projectId: "project", root: parent, relativePath: ".env"
  }), /Sensitive paths/);
});

test("provider failover does not retry semantic errors with missing status", () => {
  assert.equal(isRetryableProviderFailure(new Error("Invalid model response")), false);
  assert.equal(isRetryableProviderFailure({ status: 401 }), false);
  assert.equal(isRetryableProviderFailure({ status: 400 }), false);
  assert.equal(isRetryableProviderFailure({ status: 429 }), true);
  assert.equal(isRetryableProviderFailure({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableProviderFailure(Object.assign(new Error("fetch timed out"), { name: "AbortError", code: 20 })), true);
});

test("failover order follows configured chain rather than discovery order", async () => {
  const seen = [];
  const fetchImpl = async (_url, options = {}) => {
    if (!options.method) {
      return new Response(JSON.stringify({ models: [{ name: "first" }, { name: "second" }, { name: "third" }] }), { status: 200 });
    }
    const { model } = JSON.parse(options.body);
    seen.push(model);
    if (model !== "second") return new Response(JSON.stringify({ error: "busy" }), { status: 503 });
    return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
  };
  const env = {
    DEVMOTER_OLLAMA_URL: "http://127.0.0.1:11434",
    DEVMOTER_MODEL_ROUTES: JSON.stringify([{ role: "coding", providerId: "ollama", model: "first" }]),
    DEVMOTER_PROVIDER_FAILOVER: "ollama/third,ollama/second"
  };
  const result = await runWithRouting({
    env, fetchImpl, role: "coding", messages: [{ role: "user", content: "ping" }]
  });
  assert.deepEqual(seen, ["first", "third", "second"]);
  assert.equal(result.model, "second");
});

test("safe preview and file browser enforce consistent size/type limits and reject unreadable oversized/binary files", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-file-tap-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "subdir"));
  await writeFile(join(root, "subdir", "nested.js"), "export const nested = true;\n");
  await writeFile(join(root, "notes.txt"), "hello world\n");
  await writeFile(join(root, "medium.ts"), "export const x = 1;\n".repeat(1200)); // > 8KB sample size, <= 1MB limit
  await writeFile(join(root, "large"), Buffer.alloc(2_400_000, 0x61)); // ~2.4 MB > TEXT_PREVIEW_LIMIT
  await writeFile(join(root, "data.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
  await writeFile(join(root, "nul.txt"), Buffer.from([0x61, 0x00, 0x62]));
  const mediumPng = Buffer.alloc(2_000_000, 0x41);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(mediumPng, 0);
  await writeFile(join(root, "photo.png"), mediumPng); // > 1MB, <= IMAGE_PREVIEW_LIMIT
  const hugePng = Buffer.alloc(IMAGE_PREVIEW_LIMIT + 10, 0x41);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(hugePng, 0);
  await writeFile(join(root, "huge.png"), hugePng);

  const listing = await listProjectDirectory(root);
  assert.equal(listing.parent, null);
  assert.deepEqual(listing.limits, { textBytes: TEXT_PREVIEW_LIMIT, imageBytes: IMAGE_PREVIEW_LIMIT });

  const byName = new Map(listing.entries.map(item => [item.name, item]));
  assert.equal(byName.get("subdir")?.kind, "directory");
  assert.equal(byName.get("notes.txt")?.kind, "text");
  assert.equal(byName.get("notes.txt")?.previewable, true);
  assert.equal(byName.get("medium.ts")?.kind, "text");
  assert.equal(byName.get("medium.ts")?.previewable, true);
  assert.equal(byName.get("large")?.kind, "large");
  assert.equal(byName.get("large")?.previewable, false);
  assert.equal(byName.get("large")?.limit, TEXT_PREVIEW_LIMIT);
  assert.equal(byName.get("data.bin")?.kind, "binary");
  assert.equal(byName.get("data.bin")?.previewable, false);
  assert.equal(byName.get("nul.txt")?.kind, "binary");
  assert.equal(byName.get("nul.txt")?.previewable, false);
  assert.equal(byName.get("photo.png")?.kind, "image");
  assert.equal(byName.get("photo.png")?.previewable, true);
  assert.equal(byName.get("huge.png")?.kind, "large");
  assert.equal(byName.get("huge.png")?.previewable, false);
  assert.equal(byName.get("huge.png")?.limit, IMAGE_PREVIEW_LIMIT);

  const subListing = await listProjectDirectory(root, "subdir");
  assert.equal(subListing.path, "subdir");
  assert.equal(subListing.parent, "");
  assert.equal(subListing.entries[0]?.path, "subdir/nested.js");

  const largePreview = await previewFile(root, "large");
  assert.equal(largePreview.kind, "binary");
  assert.equal(largePreview.reason, "file-too-large");
  assert.equal(largePreview.limit, TEXT_PREVIEW_LIMIT);
  assert.equal(largePreview.size, 2_400_000);
  assert.equal("content" in largePreview, false);

  const hugeImgPreview = await previewFile(root, "huge.png");
  assert.equal(hugeImgPreview.kind, "binary");
  assert.equal(hugeImgPreview.reason, "image-too-large");
  assert.equal(hugeImgPreview.limit, IMAGE_PREVIEW_LIMIT);
  assert.equal("data" in hugeImgPreview, false);

  const binPreview = await previewFile(root, "data.bin");
  assert.equal(binPreview.kind, "binary");
  assert.equal(binPreview.reason, "binary-or-unsupported");

  const nulPreview = await previewFile(root, "nul.txt");
  assert.equal(nulPreview.kind, "binary");
  assert.equal(nulPreview.reason, "binary-or-unsupported");

  assert.equal((await previewFile(root, "medium.ts")).kind, "text");
  assert.equal((await previewFile(root, "photo.png")).kind, "image");
});

test("/api/projects/:id/files and /api/projects/:id/preview apply strict containment and limit validation", async t => {
  const parent = await mkdtemp(join(tmpdir(), "devmoter-api-preview-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "project");
  const configDir = join(parent, "config");
  await mkdir(root);
  await mkdir(configDir);
  await mkdir(join(root, "src"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "src", "app.js"), "console.log('ok');");
  await writeFile(join(root, "large"), Buffer.alloc(TEXT_PREVIEW_LIMIT + 100, 0x62));
  await writeFile(join(root, ".env"), "SECRET=1");
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main");
  await writeFile(join(parent, "outside.txt"), "outside secret");

  const api = createAdvancedApi({
    homeDir: parent,
    configDir,
    getProjectById: async id => {
      if (id !== "p1") throw Object.assign(new Error("Project not found"), { statusCode: 404 });
      return { id: "p1", name: "Proj", path: root };
    }
  });

  async function requestApi(rawUrl) {
    const req = { method: "GET", headers: {}, url: rawUrl };
    let statusCode = 0;
    let body = "";
    const res = {
      writeHead(code) { statusCode = code; },
      end(chunk = "") { body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk); }
    };
    const handled = await api.handle(req, res, new URL("http://127.0.0.1" + rawUrl));
    assert.equal(handled, true);
    return { statusCode, json: JSON.parse(body) };
  }

  const subRes = await requestApi("/api/projects/p1/files?path=src");
  assert.equal(subRes.statusCode, 200);
  assert.equal(subRes.json.browser.parent, "");
  assert.equal(subRes.json.browser.entries[0].path, "src/app.js");

  const tapText = await requestApi("/api/projects/p1/preview?path=" + encodeURIComponent(subRes.json.browser.entries[0].path));
  assert.equal(tapText.statusCode, 200);
  assert.equal(tapText.json.preview.kind, "text");
  assert.equal(tapText.json.preview.content, "console.log('ok');");

  const tapLarge = await requestApi("/api/projects/p1/preview?path=large");
  assert.equal(tapLarge.statusCode, 200);
  assert.equal(tapLarge.json.preview.kind, "binary");
  assert.equal(tapLarge.json.preview.reason, "file-too-large");
  assert.equal(tapLarge.json.preview.limit, TEXT_PREVIEW_LIMIT);

  const traversalPreview = await requestApi("/api/projects/p1/preview?path=" + encodeURIComponent("../outside.txt"));
  assert.equal(traversalPreview.statusCode, 400);

  const secretPreview = await requestApi("/api/projects/p1/preview?path=.env");
  assert.equal(secretPreview.statusCode, 403);

  const traversalFiles = await requestApi("/api/projects/p1/files?path=" + encodeURIComponent("../"));
  assert.equal(traversalFiles.statusCode, 400);

  const secretDir = await requestApi("/api/projects/p1/files?path=.git");
  assert.equal(secretDir.statusCode, 403);
});
