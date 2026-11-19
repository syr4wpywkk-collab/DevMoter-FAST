import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readDistStaticFile } from "../server/security-helpers.mjs";
import { isLoopbackAddress, isLoopbackHost } from "../server/auth.mjs";
import { createSessionModeMap } from "../server/agent-mode-policy.mjs";
import { redactLogText } from "../server/secret-redaction.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

const PUBLIC_STATIC_PATHS = new Set([
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/sw.js"
]);

async function freePort(host = "127.0.0.1") {
  const probe = createNetServer();
  probe.listen(0, host);
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 45_000) {
  let output = "";
  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DevMoter did not become ready: ${output}\n${stderr}`)), timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`DevMoter exited early with code ${code}: ${output}\n${stderr}`));
    });
  });
  return { getStderr: () => stderr };
}

function rawHttpRequest({ host = "127.0.0.1", port, path, method = "GET", headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Sub-item 1: Static file containment, PUBLIC_STATIC_PATHS 404, SPA fallback

test("readDistStaticFile enforces DIST containment, symlinks, public-static 404, and SPA fallback", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-static-582-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const distDir = join(root, "dist");
  const assetsDir = join(distDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(root, "outside.txt"), "OUTSIDE-SECRET-DATA");
  await writeFile(join(distDir, "index.html"), "<!doctype html><html><body>SPA</body></html>");
  await writeFile(join(assetsDir, "app.js"), "console.log('ok');");
  await writeFile(join(distDir, "manifest.webmanifest"), '{"short_name":"DevMoter"}');

  // Symlink staying inside dist is allowed; symlink escaping dist is blocked.
  await symlink("./assets/app.js", join(distDir, "alias.js"));
  await symlink(join(root, "outside.txt"), join(distDir, "escape.txt"));
  await symlink(join(root, "nonexistent-outside.txt"), join(distDir, "broken-escape.txt"));
  // Fallback-eligible escape: no file extension, so only the realpath
  // containment check (not the non-fallback extension rule) can stop it.
  await symlink(join(root, "outside.txt"), join(distDir, "escape-route"));

  const opts = { publicPaths: PUBLIC_STATIC_PATHS, mimeTypes: MIME };

  // Existing static files return 200 with exact Content-Type.
  const indexRes = await readDistStaticFile(distDir, "/", opts);
  assert.equal(indexRes.status, 200);
  assert.equal(indexRes.contentType, "text/html; charset=utf-8");
  assert.match(indexRes.data.toString("utf8"), /SPA/);

  const jsRes = await readDistStaticFile(distDir, "/assets/app.js?v=1", opts);
  assert.equal(jsRes.status, 200);
  assert.equal(jsRes.contentType, "text/javascript; charset=utf-8");
  assert.equal(jsRes.data.toString("utf8"), "console.log('ok');");

  const manifestRes = await readDistStaticFile(distDir, "/manifest.webmanifest", { ...opts, allowSpaFallback: false });
  assert.equal(manifestRes.status, 200);
  assert.equal(manifestRes.contentType, "application/manifest+json");

  const internalSymlink = await readDistStaticFile(distDir, "/alias.js", opts);
  assert.equal(internalSymlink.status, 200);
  assert.equal(internalSymlink.contentType, "text/javascript; charset=utf-8");

  // Missing PUBLIC_STATIC_PATHS return 404, NEVER SPA index.html.
  for (const missingPublic of ["/sw.js", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) {
    const resPreAuth = await readDistStaticFile(distDir, missingPublic, { ...opts, allowSpaFallback: false });
    assert.equal(resPreAuth.status, 404, `${missingPublic} (pre-auth) must be 404`);
    const resAuthed = await readDistStaticFile(distDir, missingPublic, opts);
    assert.equal(resAuthed.status, 404, `${missingPublic} (authed) must be 404`);
  }

  // Missing static assets under /assets/ or known asset extensions return 404.
  for (const missingAsset of ["/assets/missing.js", "/missing.css", "/missing.png", "/missing.svg"]) {
    const res = await readDistStaticFile(distDir, missingAsset, opts);
    assert.equal(res.status, 404, `${missingAsset} must return 404, not SPA fallback`);
  }

  // Traversal, malformed encoding, NUL, backslash, and symlink escapes return 404 without SPA fallback.
  for (const unsafe of [
    "/../outside.txt",
    "/%2e%2e/outside.txt",
    "/%252e%252e/outside.txt",
    "/assets/../../outside.txt",
    "/..",
    "/escape.txt",
    "/escape-route",
    "/broken-escape.txt",
    "/outside\\..\\outside.txt",
    "/app%00.js",
    "/%E0%A4%A"
  ]) {
    const res = await readDistStaticFile(distDir, unsafe, opts);
    assert.equal(res.status, 404, `${unsafe} must return 404`);
    assert.equal(res.data, undefined, `${unsafe} must not leak file bytes or index.html`);
  }

  // Genuine app routes still fall back to dist/index.html.
  for (const appRoute of ["/workspace/session-1", "/settings", "/home?surface=codex"]) {
    const res = await readDistStaticFile(distDir, appRoute, opts);
    assert.equal(res.status, 200, `${appRoute} should fall back to SPA index.html`);
    assert.equal(res.contentType, "text/html; charset=utf-8");
    assert.match(res.data.toString("utf8"), /SPA/);
  }

  // Symlinked index.html escaping DIST must also be rejected.
  await rm(join(distDir, "index.html"));
  await symlink(join(root, "outside.txt"), join(distDir, "index.html"));
  const escapedIndex = await readDistStaticFile(distDir, "/workspace", opts);
  assert.equal(escapedIndex.status, 404);

  // Missing DIST directory reports not built cleanly.
  const missingDist = await readDistStaticFile(join(root, "no-such-dist"), "/", opts);
  assert.equal(missingDist.status, 404);
  assert.match(missingDist.error, /Not built yet/);
});

test("serveStatic HTTP boundary returns 404 for missing PUBLIC_STATIC_PATHS and keeps SPA fallback", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-static-http-"));
  const home = await mkdtemp(join(tmpdir(), "devmoter-static-home-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  // Mirror checkout with a custom dist/ missing /sw.js and containing an escaping symlink.
  for (const entry of await readdir(repoRoot)) {
    if (entry === "dist" || entry === ".git" || entry === "server.mjs") continue;
    await symlink(join(repoRoot, entry), join(root, entry));
  }
  await copyFile(join(repoRoot, "server.mjs"), join(root, "server.mjs"));
  await mkdir(join(root, "dist", "assets"), { recursive: true });
  await writeFile(join(root, "outside-secret.txt"), "TOP-SECRET");
  await writeFile(join(root, "dist", "index.html"), "<!doctype html><html><body>SPA-INDEX</body></html>");
  await writeFile(join(root, "dist", "assets", "bundle.js"), "export const ok = 1;");
  await symlink(join(root, "outside-secret.txt"), join(root, "dist", "escape.txt"));

  const port = await freePort();
  const password = "static-fallback-test-password-123";
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
  const child = spawn(process.execPath, [join(root, "server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password,
      DEVMOTER_PASSKEY_REQUIRED: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
  await waitForReady(child);

  // Pre-auth missing PUBLIC_STATIC_PATHS must return 404, not 200 index.html.
  const missingSw = await rawHttpRequest({ port, path: "/sw.js" });
  assert.equal(missingSw.status, 404);
  assert.doesNotMatch(missingSw.body, /SPA-INDEX/);

  const missingManifest = await rawHttpRequest({ port, path: "/manifest.webmanifest" });
  assert.equal(missingManifest.status, 404);
  assert.doesNotMatch(missingManifest.body, /SPA-INDEX/);

  // Authenticated traversal & symlink escapes must return 404.
  for (const path of ["/escape.txt", "/../outside-secret.txt", "/%2e%2e/outside-secret.txt", "/assets/missing.js"]) {
    const res = await rawHttpRequest({ port, path, headers: { authorization } });
    assert.equal(res.status, 404, `${path} must return 404`);
    assert.doesNotMatch(res.body, /TOP-SECRET|SPA-INDEX/);
  }

  // Genuine SPA app route returns 200 index.html.
  const spaRes = await rawHttpRequest({ port, path: "/workspace/demo-project", headers: { authorization } });
  assert.equal(spaRes.status, 200);
  assert.match(String(spaRes.headers["content-type"]), /text\/html/);
  assert.match(spaRes.body, /SPA-INDEX/);

  // Valid built asset returns 200 with JS content-type; HEAD omits body.
  const assetRes = await rawHttpRequest({ port, path: "/assets/bundle.js", headers: { authorization } });
  assert.equal(assetRes.status, 200);
  assert.match(String(assetRes.headers["content-type"]), /text\/javascript/);
  assert.equal(assetRes.body, "export const ok = 1;");

  const headRes = await rawHttpRequest({ port, path: "/assets/bundle.js", method: "HEAD", headers: { authorization } });
  assert.equal(headRes.status, 200);
  assert.equal(headRes.body, "");
});

// ---------------------------------------------------------------------------
// Sub-item 2: Log and multi-API error/output redaction

test("redactLogText masks known secrets, Authorization headers, Cookies, API keys, and tokens", () => {
  const configuredSecret = "configured-password-987654";
  const openAiKey = "sk-" + "proj-abcdefghijklmnopqrstuvwxyz1234";
  const raw = [
    `Auth failed with ${configuredSecret}`,
    "Authorization: Bearer tok_live_secret_abc",
    "authorization=Basic dXNlcjpwYXNz",
    "Cookie: devmoter_session=sid_123; devmoter_device=dev_456",
    "Set-Cookie: sid=xyz; HttpOnly",
    "x-api-key: provider-key-abc",
    "x-devmoter-device-token: device-tok-abc",
    "https://alice:s3cr3t@upstream.example.test/api",
    `token ${openAiKey}`,
    "ghp_abcdefghijklmnopqrstuvwxyz012345"
  ].join("\n");

  const redacted = redactLogText(raw, [configuredSecret]);
  for (const sensitive of [
    configuredSecret,
    "tok_live_secret_abc",
    "dXNlcjpwYXNz",
    "sid_123",
    "dev_456",
    "sid=xyz",
    "provider-key-abc",
    "device-tok-abc",
    "alice:s3cr3t",
    openAiKey,
    "ghp_abcdefghijklmnopqrstuvwxyz012345"
  ]) {
    assert.equal(redacted.includes(sensitive), false, `log output leaked ${sensitive}`);
  }
});

test("redactLogText neutralizes CRLF log injection and redacts unlabeled Basic credentials", () => {
  const forged = "upstream error\r\n2026-11-19T12:00:00Z ERROR admin login succeeded";
  const cleaned = redactLogText(forged);
  assert.equal(cleaned.includes("\n"), false, "log output must stay a single line");
  assert.equal(cleaned.includes("\r"), false, "raw CR must not survive redaction");
  assert.match(cleaned, /\\n/, "newline must be escaped, not preserved");

  const unlabeled = redactLogText("header dump: basic dXNlcjpwYXNzd29yZA==");
  assert.equal(unlabeled.includes("dXNlcjpwYXNzd29yZA=="), false, "unlabeled Basic credential leaked");
  assert.match(unlabeled, /basic \[REDACTED\]/i);
});

test("every console.error and console.warn call in server.mjs routes dynamic error details through redaction", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const logCalls = [...source.matchAll(/console\.(?:error|warn)\(([^;]+)\);/g)];
  assert.ok(logCalls.length >= 12, "expected console.error/warn inventory in server.mjs");
  for (const match of logCalls) {
    const call = match[0];
    assert.match(call, /redactLog\(/, `log call must route dynamic part through redactLog(): ${call}`);
    assert.doesNotMatch(call, /,\s*error\s*\)/, `log call must not pass raw error object: ${call}`);
  }
});

test("multi-API provider test and chat mask plaintext apiKey values in errors and responses", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-multiapi-redact-"));
  const projectPath = join(home, "workspace");
  await mkdir(projectPath);

  const plainKey = "plaintext-provider-api-key-must-be-masked-999";
  let upstreamMode = "error";

  const upstream = http.createServer(async (req, res) => {
    for await (const _chunk of req) {}
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") {
      if (upstreamMode === "error") {
        res.writeHead(401).end(JSON.stringify({ error: { message: `Invalid API key: ${plainKey}` } }));
        return;
      }
      res.end(JSON.stringify({ data: [{ id: `model-with-${plainKey}` }] }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      if (upstreamMode === "error") {
        res.writeHead(401).end(JSON.stringify({ error: { message: `Chat rejected key ${plainKey}` } }));
        return;
      }
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `echo:${plainKey}` } }] }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });
  const upstreamPort = await freePort();
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

  const port = await freePort();
  const password = "multi-api-redaction-password-123";
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CODEX_CWD: projectPath,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  await waitForReady(child);

  const post = async (path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": `op-${crypto.randomUUID()}`
      },
      body: JSON.stringify(body)
    });
    return { status: response.status, payload: await response.json() };
  };

  // /api/llm/test error masks plaintext apiKey.
  const testErr = await post("/api/llm/test", {
    presetId: "custom",
    name: "Local Test",
    protocol: "openai-compatible",
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: plainKey,
    models: []
  });
  assert.equal(testErr.status, 401);
  assert.equal(JSON.stringify(testErr.payload).includes(plainKey), false);
  assert.match(testErr.payload.error, /\[REDACTED\]/);

  // /api/llm/test success masks echoed plaintext apiKey in model names.
  upstreamMode = "ok";
  const testOk = await post("/api/llm/test", {
    presetId: "custom",
    name: "Local Test",
    protocol: "openai-compatible",
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: plainKey,
    models: []
  });
  assert.equal(testOk.status, 200);
  assert.equal(JSON.stringify(testOk.payload).includes(plainKey), false);

  // Save plaintext provider and test /api/llm/chat error & response redaction.
  const saved = await post("/api/llm/providers", {
    id: "local-plain",
    presetId: "custom",
    name: "Local Plain",
    protocol: "openai-compatible",
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: plainKey,
    models: ["plain-model"]
  });
  assert.equal(saved.status, 200);

  upstreamMode = "error";
  const chatErr = await post("/api/llm/chat", {
    providerId: "local-plain",
    model: "plain-model",
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(chatErr.status, 401);
  assert.equal(JSON.stringify(chatErr.payload).includes(plainKey), false);
  assert.match(chatErr.payload.error, /\[REDACTED\]/);

  upstreamMode = "ok";
  const chatOk = await post("/api/llm/chat", {
    providerId: "local-plain",
    model: "plain-model",
    messages: [{ role: "user", content: "hello" }]
  });
  assert.equal(chatOk.status, 200);
  assert.equal(JSON.stringify(chatOk.payload).includes(plainKey), false);
  assert.match(chatOk.payload.message.content, /\[REDACTED\]/);
});

// ---------------------------------------------------------------------------
// Sub-item 3: openCodeSessionModes bounded growth, TTL, and session cleanup

test("createSessionModeMap has checks expiry without renewing TTL", () => {
  let clock = 0;
  const store = createSessionModeMap({ ttlMs: 1000, now: () => clock });
  assert.equal(store.has("missing"), false);
  assert.equal(store.has(""), false);
  store.set("session", "plan");
  assert.equal(store.has("session"), true);
  clock = 999;
  assert.equal(store.has("session"), true);
  clock = 1000;
  assert.equal(store.has("session"), false);
  assert.equal(store.delete("session"), false);
  assert.equal(store.size, 0);
});

test("createSessionModeMap bounds size with oldest-first eviction, enforces TTL, and supports delete", () => {
  let clock = 100;
  const store = createSessionModeMap({ maxEntries: 3, ttlMs: 1000, now: () => clock });
  store.set("s1", "plan");
  store.set("s2", "ask");
  store.set("s3", "build");
  assert.equal(store.size, 3);

  // Accessing s1 refreshes its recency, so s2 is now the oldest entry.
  clock = 200;
  assert.equal(store.get("s1"), "plan");
  store.set("s4", "plan");
  assert.equal(store.size, 3);
  assert.equal(store.get("s2"), undefined, "oldest untouched entry s2 must be evicted");
  assert.equal(store.get("s1"), "plan");
  assert.equal(store.get("s3"), "build");
  assert.equal(store.get("s4"), "plan");

  // Explicit delete removes entry immediately.
  assert.equal(store.delete("s1"), true);
  assert.equal(store.get("s1"), undefined);

  // TTL expiry drops stale entries.
  clock = 1201;
  assert.equal(store.get("s3"), undefined);
  assert.equal(store.get("s4"), undefined);
  assert.equal(store.size, 0);
});

test("OpenCode session DELETE is denied without clearing modes; SSE session.deleted removes modes", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-session-mode-"));
  const projectPath = join(home, "workspace");
  await mkdir(projectPath);

  const upstreamRequests = [];
  let sseController = null;
  const upstream = http.createServer(async (req, res) => {
    for await (const _chunk of req) {}
    const path = req.url.split("?")[0];
    upstreamRequests.push({ method: req.method, path });

    if (path === "/api/info") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "2.0.9", pid: 1, urls: [] }));
      return;
    }
    if (path === "/api/event") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      sseController = res;
      res.write('data: {"type":"server.connected","data":{}}\n\n');
      return;
    }
    if (path === "/api/session/ses_del" && req.method === "DELETE") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: {} }));
  });
  const upstreamPort = await freePort();
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

  const port = await freePort();
  const password = "session-mode-cleanup-password-123";
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CODEX_CWD: projectPath,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${upstreamPort}`,
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    sseController?.end();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  await waitForReady(child);

  const api = async (method, path, body, extraHeaders = {}) => {
    const response = await fetch(`${origin}/api/opencode${path}`, {
      method,
      headers: {
        authorization,
        origin,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { "x-pocket-operation-id": `op-${crypto.randomUUID()}` } : {}),
        ...extraHeaders
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, payload: await response.json().catch(() => ({})) };
  };

  // 1. Set plan mode for ses_del via prompt, verify shell mutation is blocked.
  assert.equal((await api("POST", "/session/ses_del/prompt", { text: "hi", agent: "plan" })).status, 200);
  assert.equal((await api("POST", "/session/ses_del/shell", { command: "echo hi" })).status, 403);

  // 2. Denied DELETE leaves the cached plan mode intact without forwarding.
  assert.equal((await api("DELETE", "/session/ses_del")).status, 404);
  assert.ok(!upstreamRequests.some(r => r.method === "DELETE" && r.path === "/api/session/ses_del"));
  const beforeDeleteLookup = upstreamRequests.filter(r => r.method === "GET" && r.path === "/api/session/ses_del").length;
  const afterDelete = await api("POST", "/session/ses_del/shell", { command: "echo hi" });
  assert.equal(afterDelete.status, 403);
  assert.equal(upstreamRequests.filter(r => r.method === "GET" && r.path === "/api/session/ses_del").length, beforeDeleteLookup);
  assert.ok(!upstreamRequests.some(r => r.method === "POST" && r.path === "/api/session/ses_del/shell"));

  // 3. Set plan mode for ses_sse, receive SSE session.deleted event, verify mode entry is cleared.
  assert.equal((await api("POST", "/session/ses_sse/prompt", { text: "hi", agent: "plan" })).status, 200);
  assert.equal((await api("POST", "/session/ses_sse/shell", { command: "echo hi" })).status, 403);

  const eventStream = await fetch(`${origin}/api/opencode/event`, {
    headers: { authorization, accept: "text/event-stream" }
  });
  const reader = eventStream.body.getReader();
  const decoder = new TextDecoder();
  // Wait for initial server.connected frame, then send session.deleted.
  await reader.read();
  sseController.write('data: {"type":"session.deleted","data":{"info":{"id":"ses_sse"}}}\n\n');
  let seenDeleted = "";
  for (let i = 0; i < 5 && !seenDeleted.includes("session.deleted"); i += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    seenDeleted += decoder.decode(chunk.value);
  }
  assert.match(seenDeleted, /session\.deleted/);
  await reader.cancel();

  const beforeSseLookup = upstreamRequests.filter(r => r.method === "GET" && r.path === "/api/session/ses_sse").length;
  const afterSseDelete = await api("POST", "/session/ses_sse/shell", { command: "echo hi" });
  assert.equal(afterSseDelete.status, 403);
  assert.equal(upstreamRequests.filter(r => r.method === "GET" && r.path === "/api/session/ses_sse").length, beforeSseLookup + 1);
  assert.ok(!upstreamRequests.some(r => r.method === "POST" && r.path === "/api/session/ses_sse/shell"));
});

// ---------------------------------------------------------------------------
// Sub-item 4: IPv6 loopback detection

test("isLoopbackHost accepts loopback authorities and rejects non-loopback/spoofed hosts", () => {
  for (const host of ["[::1]:8787", "[::1]", "[0:0:0:0:0:0:0:1]", "127.0.0.1", "127.0.0.1:8787", "127.0.0.2", "127.255.255.254:8787", "localhost", "localhost:8787", "LOCALHOST"]) {
    assert.equal(isLoopbackHost(host), true, `expected loopback for ${JSON.stringify(host)}`);
  }

  for (const nonLoopback of [
    "192.168.0.1",
    "[2001:db8::1]",
    "[2001:db8::1]:8787",
    "2001:db8::1",
    "::1",
    "localhost.evil.com",
    "user:pass@localhost",
    "localhost/path",
    "localhost?x=1",
    "localhost#frag",
    "evil.com#@localhost",
    "::1:8787",
    "[::1]extra",
    "",
    null,
    undefined
  ]) {
    assert.equal(isLoopbackHost(nonLoopback), false, `expected non-loopback for ${JSON.stringify(nonLoopback)}`);
  }

  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("2001:db8::1"), false);
});

test("setup API honors IPv6 loopback Host headers and rejects non-loopback hosts", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-ipv6-loopback-"));
  const port = await freePort();
  const password = "ipv6-loopback-test-password-123";
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await rm(home, { recursive: true, force: true });
  });
  await waitForReady(child);

  for (const hostHeader of [`[::1]:${port}`, "[::1]", `127.0.0.1:${port}`, `127.0.0.2:${port}`, "localhost"]) {
    const res = await rawHttpRequest({
      port,
      path: "/api/setup/status",
      headers: { authorization, host: hostHeader }
    });
    assert.equal(res.status, 200, `Host ${hostHeader} should be accepted as loopback`);
  }

  for (const hostHeader of ["192.168.0.1", "[2001:db8::1]", "user@localhost", "evil.com#@localhost"]) {
    const res = await rawHttpRequest({
      port,
      path: "/api/setup/status",
      headers: { authorization, host: hostHeader }
    });
    assert.equal(res.status, 403, `Host ${hostHeader} must be rejected`);
  }
});
