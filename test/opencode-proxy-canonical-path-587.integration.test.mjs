import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Issue #587: the OpenCode proxy must validate, classify, and forward ONE
// canonical (decoded, normalized) path. Encoded routes must behave exactly
// like their decoded forms, double-encoded paths are rejected, and encoded
// adapter actions must be dispatched to the adapter — never forwarded raw.
// Requests are sent byte-for-byte with http.request because fetch() would
// normalize the percent-encoded paths under test.

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 30000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not become ready: ${output}`)), timeoutMs);
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
      reject(new Error(`server exited early with code ${code}: ${output}`));
    });
  });
}

test("OpenCode proxy canonicalizes paths before policy checks and forwarding", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-oc-canonical-587-"));
  const upstreamPort = await freePort();
  const appPort = await freePort();
  const authPassword = "canonical-587-password-123";
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const path = req.url.split("?")[0];
    received.push({ method: req.method, path, body });
    const reply = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(value === undefined ? "" : JSON.stringify(value));
    };
    if (req.method === "GET" && path === "/global/health") return reply(200, { healthy: true, version: "1.19.5" });
    if (req.method === "POST" && path === "/api/session") {
      const id = body?.agent === "plan" ? "ses_ro" : "ses_rw";
      return reply(200, { id, agent: body?.agent || "build", model: { id: "mock-1", providerID: "mock", variant: "default" } });
    }
    if (req.method === "POST" && /^\/session\/[^/]+\/prompt_async$/.test(path)) return reply(204);
    if (req.method === "GET" && /^\/api\/session\/[^/]+\/context$/.test(path)) return reply(200, { data: [] });
    if (req.method === "GET" && /^\/api\/session\/[^/]+$/.test(path)) {
      return reply(200, { data: { id: path.split("/").at(-1), agent: "plan" } });
    }
    return reply(200, { ok: true, path: req.url });
  });
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(appPort),
      OPENCODE_URL: `http://127.0.0.1:${upstreamPort}`,
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let operationCounter = 0;
  const rawRequest = (method, path, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port: appPort,
      path,
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`,
        origin: `http://127.0.0.1:${appPort}`,
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        ...(method !== "GET" && method !== "HEAD" ? { "x-pocket-operation-id": `canonical-587-${++operationCounter}` } : {}),
        ...headers
      }
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = text;
        try { parsed = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error(`request timed out: ${method} ${path}`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

  const upstreamCalls = (method, path) => received.filter(item => item.method === method && item.path === path);

  try {
    await waitForReady(child);

    // Session creation through the proxy (happy path).
    const createRo = await rawRequest("POST", "/api/opencode/session", { body: { agent: "plan" } });
    assert.equal(createRo.status, 200, createRo.text);
    assert.equal(createRo.body.id, "ses_ro");
    const createRw = await rawRequest("POST", "/api/opencode/session", { body: { agent: "build" } });
    assert.equal(createRw.status, 200, createRw.text);
    assert.equal(createRw.body.id, "ses_rw");

    // Prime the read-only session's mode through the adapter surface.
    const prime = await rawRequest("POST", "/api/opencode/session/ses_ro/prompt", {
      body: { text: "inspect" },
      headers: { "x-pocket-agent-mode": "plan" }
    });
    assert.equal(prime.status, 200, prime.text);
    assert.equal(upstreamCalls("POST", "/session/ses_ro/prompt_async").length, 1);
    assert.equal(upstreamCalls("POST", "/session/ses_ro/prompt_async")[0].body.tools["*"], false);

    // Encoded, plain, and trailing-slash mutation routes on the read-only
    // session are all blocked identically and never reach upstream.
    for (const route of ["shell", "%73hell", "%63ommand", "shell/"]) {
      const blocked = await rawRequest("POST", `/api/opencode/session/ses_ro/${route}`, { body: { command: "id" } });
      assert.equal(blocked.status, 403, `${route} must be blocked, got ${blocked.status}: ${blocked.text}`);
    }
    assert.equal(upstreamCalls("POST", "/api/session/ses_ro/shell").length, 0, "shell must never reach upstream");
    assert.equal(upstreamCalls("POST", "/api/session/ses_ro/command").length, 0, "command must never reach upstream");

    // An encoded adapter action is dispatched to the adapter (which calls
    // prompt_async), never forwarded to the upstream as a raw proxy request.
    const encodedPrompt = await rawRequest("POST", "/api/opencode/session/ses_ro/%70rompt", { body: { text: "hi" } });
    assert.equal(encodedPrompt.status, 200, encodedPrompt.text);
    assert.equal(upstreamCalls("POST", "/session/ses_ro/prompt_async").length, 2, "adapter must translate the encoded prompt");
    assert.ok(!received.some(item => item.path.includes("%70rompt")), "encoded prompt must not be forwarded raw");
    assert.equal(upstreamCalls("POST", "/api/session/ses_ro/prompt").length, 0, "raw prompt route must not be used");

    // Double-encoded paths are rejected 400 before reaching upstream.
    for (const path of ["/api/opencode/session/ses_ro/%2573hell", "/api/opencode/%252f"]) {
      const rejected = await rawRequest("POST", path, { body: { command: "id" } });
      assert.equal(rejected.status, 400, `${path} must be rejected, got ${rejected.status}: ${rejected.text}`);
      assert.match(rejected.body.error, /OpenCode proxy path/);
    }
    assert.ok(!received.some(item => item.path.includes("%25")), "double-encoded paths must never reach upstream");

    // An encoded-but-legitimate session id decodes to a valid id and is
    // forwarded (and dispatched) in its canonical decoded form. (DevMoter
    // also fetches sessions on its own, so assert on the delta.)
    const sessionHitsBefore = upstreamCalls("GET", "/api/session/ses_ro").length;
    const encodedId = await rawRequest("GET", "/api/opencode/session/ses_%72o");
    assert.equal(encodedId.status, 200, encodedId.text);
    assert.equal(upstreamCalls("GET", "/api/session/ses_ro").length, sessionHitsBefore + 1, "upstream must see the canonical decoded id");
    assert.ok(!received.some(item => item.path.includes("%72o")), "the encoded id must never reach upstream");
    const contextHitsBefore = upstreamCalls("GET", "/api/session/ses_ro/context").length;
    const encodedContext = await rawRequest("GET", "/api/opencode/session/ses_%72o/context");
    assert.equal(encodedContext.status, 200, encodedContext.text);
    assert.equal(upstreamCalls("GET", "/api/session/ses_ro/context").length, contextHitsBefore + 1);

    // Happy paths on the build session: plain, encoded, and trailing-slash
    // shell all forward in canonical form; the adapter prompt still works.
    for (const route of ["shell", "%73hell", "shell/"]) {
      const okShell = await rawRequest("POST", `/api/opencode/session/ses_rw/${route}`, { body: { command: "pwd" } });
      assert.equal(okShell.status, 200, `${route} on a build session must pass, got ${okShell.status}: ${okShell.text}`);
    }
    assert.equal(upstreamCalls("POST", "/api/session/ses_rw/shell").length, 3, "all shell variants must arrive canonically");
    const rwPrompt = await rawRequest("POST", "/api/opencode/session/ses_rw/prompt", { body: { text: "hi" } });
    assert.equal(rwPrompt.status, 200, rwPrompt.text);
    assert.equal(upstreamCalls("POST", "/session/ses_rw/prompt_async").length, 1);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
