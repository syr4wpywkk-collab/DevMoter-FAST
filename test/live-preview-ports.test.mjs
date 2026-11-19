import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createAdvancedApi, resolveLivePreviewTarget } from "../server/advanced-api.mjs";

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

async function waitForReady(child, timeoutMs = 15000) {
  let output = "";
  let stderr = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`DevMoter did not become ready. stdout=${output} stderr=${stderr}`)),
      timeoutMs
    );
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`DevMoter exited early with code ${code}. stdout=${output} stderr=${stderr}`));
    });
  });
}

async function createApiFixture(t, env, fetchImpl) {
  const parent = await mkdtemp(join(tmpdir(), "devmoter-live-preview-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const projectDir = join(parent, "project");
  const configDir = join(parent, "config");
  await mkdir(projectDir);
  await mkdir(configDir);

  const api = createAdvancedApi({
    homeDir: parent,
    configDir,
    env,
    fetchImpl,
    getProjectById: async id => {
      if (id !== "p1") throw Object.assign(new Error("Project not found"), { statusCode: 404 });
      return { id: "p1", name: "Proj", path: projectDir };
    }
  });

  async function request(method, rawUrl, body) {
    const stream = body === undefined
      ? Readable.from([])
      : Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
    stream.method = method;
    stream.headers = body === undefined ? {} : { "content-type": "application/json" };
    stream.url = rawUrl;
    let statusCode = 0;
    let headers = {};
    const chunks = [];
    const res = {
      writeHead(code, hdrs = {}) {
        statusCode = code;
        headers = hdrs;
      },
      end(chunk = "") {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    };
    const handled = await api.handle(stream, res, new URL("http://127.0.0.1" + rawUrl));
    assert.equal(handled, true);
    const text = Buffer.concat(chunks).toString("utf8");
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML or empty HEAD response */ }
    return { statusCode, headers, text, json };
  }

  return { api, request };
}

test("live preview registration is fail-closed: self ports and any port without an allowlist are rejected", async t => {
  const defaultFixture = await createApiFixture(t, {}, async () => new Response("ok"));
  for (const port of [8787, 49374, 3100]) {
    const res = await defaultFixture.request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port });
    assert.ok(res.statusCode === 400 || res.statusCode === 403, `expected 400/403 for port ${port}, got ${res.statusCode}`);
    assert.match(String(res.json?.error || ""), /not allowed/i);
  }
  const stored = await defaultFixture.request("GET", "/api/projects/p1/web-preview");
  assert.equal(stored.json?.preview, null);

  const customFixture = await createApiFixture(
    t,
    { POCKET_PORT: "9100", OPENCODE_PORT: "41000", OPENCODE_URL: "http://127.0.0.1:42000" },
    async () => new Response("ok")
  );
  // Custom self ports are denied, and the former defaults (8787/49374) are
  // still denied here because no allowlist is configured at all.
  for (const port of [9100, 41000, 42000, 8787, 49374]) {
    const res = await customFixture.request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port });
    assert.ok(res.statusCode === 400 || res.statusCode === 403, `expected 400/403 for port ${port}, got ${res.statusCode}`);
    assert.match(String(res.json?.error || ""), /not allowed/i);
  }
});

test("DEVMOTER_PREVIEW_ALLOWED_PORTS restricts registration to listed ports and still blocks self ports", async t => {
  const { request } = await createApiFixture(
    t,
    {
      POCKET_PORT: "9100",
      OPENCODE_PORT: "41000",
      DEVMOTER_PREVIEW_ALLOWED_PORTS: "3100, 3200, 9100, 41000, 80, invalid"
    },
    async () => new Response("ok")
  );

  for (const allowedPort of [3100, 3200]) {
    const ok = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port: allowedPort });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json?.preview?.port, allowedPort);
  }

  for (const deniedPort of [3300, 9100, 41000]) {
    const denied = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port: deniedPort });
    assert.ok(denied.statusCode === 400 || denied.statusCode === 403, `port ${deniedPort} should be rejected`);
  }

  const privileged = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port: 80 });
  assert.equal(privileged.statusCode, 400);

  const emptyValidAllowlist = await createApiFixture(
    t,
    { DEVMOTER_PREVIEW_ALLOWED_PORTS: "invalid,80" },
    async () => new Response("ok")
  );
  const blocked = await emptyValidAllowlist.request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port: 3100 });
  assert.equal(blocked.statusCode, 403);
});

test("live preview re-validates port policy at proxy-serve time when configuration changes or preview is pre-stored", async t => {
  const env = { POCKET_PORT: "9100", OPENCODE_PORT: "41000", DEVMOTER_PREVIEW_ALLOWED_PORTS: "3100" };
  let upstreamHits = 0;
  const { api, request } = await createApiFixture(t, env, async () => {
    upstreamHits++;
    return new Response("<html><body>ok</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  });

  const reg = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port: 3100 });
  assert.equal(reg.statusCode, 200);
  const proxyUrl = reg.json.preview.url;
  // Registration probes the target once; only count proxy-serve fetches below.
  upstreamHits = 0;

  const first = await request("GET", proxyUrl);
  assert.equal(first.statusCode, 200);
  assert.equal(upstreamHits, 1);

  env.DEVMOTER_PREVIEW_ALLOWED_PORTS = "3200";
  const afterAllowlistChange = await request("GET", proxyUrl);
  assert.equal(afterAllowlistChange.statusCode, 403);
  assert.equal(upstreamHits, 1);
  const headAfterChange = await request("HEAD", proxyUrl);
  assert.equal(headAfterChange.statusCode, 403);
  assert.equal(upstreamHits, 1);

  delete env.DEVMOTER_PREVIEW_ALLOWED_PORTS;
  env.POCKET_PORT = "3100";
  const afterPocketChange = await request("GET", proxyUrl);
  assert.equal(afterPocketChange.statusCode, 403);
  assert.equal(upstreamHits, 1);

  env.POCKET_PORT = "9100";
  env.OPENCODE_PORT = "3100";
  const afterOpenCodeChange = await request("GET", proxyUrl);
  assert.equal(afterOpenCodeChange.statusCode, 403);
  assert.equal(upstreamHits, 1);

  const storedToken = "a".repeat(48);
  api.previews.set("p1", {
    projectId: "p1",
    host: "127.0.0.1",
    port: 9100,
    token: storedToken,
    startedAt: Date.now()
  });
  const storedRejected = await request("GET", `/api/live-preview/proxy/${storedToken}/`);
  assert.equal(storedRejected.statusCode, 403);
  assert.equal(upstreamHits, 1);
});

test("resolveLivePreviewTarget enforces self-port deny list and allowlist", () => {
  assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 8787, "/"), /not allowed/);
  assert.throws(() => resolveLivePreviewTarget("127.0.0.1", 49374, "/"), /not allowed/);
  // Fail closed: with no allowlist configured, even a normal port is denied.
  assert.throws(
    () => resolveLivePreviewTarget("127.0.0.1", 3000, "/", "", { env: {} }),
    /not allowed/
  );
  assert.throws(
    () => resolveLivePreviewTarget("127.0.0.1", 3000, "/", "", { env: { DEVMOTER_PREVIEW_ALLOWED_PORTS: "5173" } }),
    /not allowed/
  );
  assert.equal(
    resolveLivePreviewTarget("127.0.0.1", 5173, "/", "", { env: { DEVMOTER_PREVIEW_ALLOWED_PORTS: "5173" } }),
    "http://127.0.0.1:5173/"
  );
});

async function stopServer(server) {
  await new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

async function startHttpServer(t, body = "<html><body>live preview</body></html>") {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => stopServer(server).catch(() => {}));
  return { server, port: server.address().port };
}

test("with no allowlist, a live arbitrary loopback port cannot be registered or proxied", async t => {
  const { port } = await startHttpServer(t);
  const { request } = await createApiFixture(t, {}, fetch);

  const reg = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port });
  assert.equal(reg.statusCode, 403);
  assert.match(String(reg.json?.error || ""), /not allowed/i);

  const stored = await request("GET", "/api/projects/p1/web-preview");
  assert.equal(stored.json?.preview, null);

  const fabricated = await request("GET", `/api/live-preview/proxy/${"b".repeat(48)}/`);
  assert.equal(fabricated.statusCode, 404);
});

test("registration probes the target: an allowlisted port with nothing listening is rejected and not stored", async t => {
  const deadPort = await freePort();
  const { request } = await createApiFixture(
    t,
    { DEVMOTER_PREVIEW_ALLOWED_PORTS: String(deadPort) },
    fetch
  );

  const reg = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port: deadPort });
  assert.equal(reg.statusCode, 502);
  assert.match(String(reg.json?.error || ""), /not reachable/i);

  const stored = await request("GET", "/api/projects/p1/web-preview");
  assert.equal(stored.json?.preview, null);
});

test("proxying a stopped preview fails with 502 and removes the registration", async t => {
  const { server, port } = await startHttpServer(t);
  const { request } = await createApiFixture(
    t,
    { DEVMOTER_PREVIEW_ALLOWED_PORTS: String(port) },
    fetch
  );

  const reg = await request("POST", "/api/projects/p1/web-preview", { host: "127.0.0.1", port });
  assert.equal(reg.statusCode, 200);
  const proxyUrl = reg.json.preview.url;

  const first = await request("GET", proxyUrl);
  assert.equal(first.statusCode, 200);
  assert.match(first.text, /live preview/);

  await stopServer(server);

  const afterStop = await request("GET", proxyUrl);
  assert.equal(afterStop.statusCode, 502);
  assert.match(String(afterStop.json?.error || ""), /not reachable/i);

  const stored = await request("GET", "/api/projects/p1/web-preview");
  assert.equal(stored.json?.preview, null);

  const again = await request("GET", proxyUrl);
  assert.equal(again.statusCode, 404);
});

test("server.mjs live preview proxy serves listed preview and rejects self ports and non-listed ports", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-preview-e2e-"));
  const projectDir = join(home, "project");
  await mkdir(projectDir);

  let previewHits = 0;
  const previewServer = http.createServer((req, res) => {
    previewHits++;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.method === "HEAD") { res.end(); return; }
    res.end('<html><head></head><body><script src="/app.js"></script><p>hello preview</p></body></html>');
  });
  previewServer.listen(0, "127.0.0.1");
  await once(previewServer, "listening");
  const previewPort = previewServer.address().port;

  let openCodePreviewProbes = 0;
  const openCodeServer = http.createServer((req, res) => {
    if (req.url === "/probe-secret") openCodePreviewProbes++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  openCodeServer.listen(0, "127.0.0.1");
  await once(openCodeServer, "listening");
  const openCodePort = openCodeServer.address().port;

  const pocketPort = await freePort();
  const unlistedPort = await freePort();
  const password = "live-preview-test-password-123";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(pocketPort),
      OPENCODE_URL: `http://127.0.0.1:${openCodePort}`,
      OPENCODE_PORT: String(openCodePort),
      OPENCODE_DIRECTORY: projectDir,
      CODEX_BIN: "__devmoter_test_missing_codex__",
      CODEX_CWD: projectDir,
      DEVMOTER_AUTH_PASSWORD: password,
      DEVMOTER_PREVIEW_ALLOWED_PORTS: String(previewPort)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  t.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => previewServer.close(() => resolve()));
    await new Promise(resolve => openCodeServer.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });

  await waitForReady(child);

  const origin = `http://127.0.0.1:${pocketPort}`;
  const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
  let opCounter = 0;
  const mutationHeaders = () => ({
    authorization,
    origin,
    "content-type": "application/json",
    "x-pocket-operation-id": `preview-ports-op-${++opCounter}`
  });

  const projectRes = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ path: projectDir, name: "PreviewProj" }),
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(projectRes.status, 200);
  const { project } = await projectRes.json();

  for (const rejectedPort of [pocketPort, openCodePort, unlistedPort]) {
    const res = await fetch(`${origin}/api/projects/${encodeURIComponent(project.id)}/web-preview`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ host: "127.0.0.1", port: rejectedPort }),
      signal: AbortSignal.timeout(4000)
    });
    assert.ok(res.status === 400 || res.status === 403, `expected 400/403 for port ${rejectedPort}, got ${res.status}`);
  }
  assert.equal(openCodePreviewProbes, 0);

  const registerRes = await fetch(`${origin}/api/projects/${encodeURIComponent(project.id)}/web-preview`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({ host: "127.0.0.1", port: previewPort }),
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(registerRes.status, 200);
  const { preview } = await registerRes.json();
  assert.match(preview.url, /^\/api\/live-preview\/proxy\/[a-f0-9]{48}\/$/);

  const proxyGet = await fetch(`${origin}${preview.url}`, {
    headers: { authorization },
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(proxyGet.status, 200);
  assert.match(proxyGet.headers.get("content-security-policy") || "", /sandbox allow-scripts/);
  const html = await proxyGet.text();
  assert.match(html, /hello preview/);
  assert.ok(html.includes(`src="${preview.url}app.js"`));
  // One hit from the registration liveness probe, one from this proxy GET.
  assert.equal(previewHits, 2);

  const proxyHead = await fetch(`${origin}${preview.url}`, {
    method: "HEAD",
    headers: { authorization },
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(proxyHead.status, 200);
  assert.equal(await proxyHead.text(), "");

  const proxyPost = await fetch(`${origin}${preview.url}`, {
    method: "POST",
    headers: mutationHeaders(),
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(proxyPost.status, 405);

  const stopRes = await fetch(`${origin}/api/projects/${encodeURIComponent(project.id)}/web-preview`, {
    method: "DELETE",
    headers: mutationHeaders(),
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(stopRes.status, 200);

  const afterStop = await fetch(`${origin}${preview.url}`, {
    headers: { authorization },
    signal: AbortSignal.timeout(4000)
  });
  assert.equal(afterStop.status, 404);
});
