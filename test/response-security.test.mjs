import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_SECURITY_HEADERS,
  HSTS_HEADER_VALUE,
  applyBaselineSecurityHeaders
} from "../server/response-security.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "response-security-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

function fakeResponse() {
  const headers = new Map();
  return { headers, setHeader: (name, value) => headers.set(name, value) };
}

test("baseline headers are applied and HSTS is limited to HTTPS deployments", () => {
  const plain = fakeResponse();
  applyBaselineSecurityHeaders({ socket: {}, headers: { "x-forwarded-proto": "https" } }, plain);
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    assert.equal(plain.headers.get(name), value);
  }
  assert.equal(plain.headers.has("strict-transport-security"), false);

  const configured = fakeResponse();
  applyBaselineSecurityHeaders({ socket: {}, headers: {} }, configured, { publicOrigin: "https://devmoter.example" });
  assert.equal(configured.headers.get("strict-transport-security"), HSTS_HEADER_VALUE);

  const encrypted = fakeResponse();
  applyBaselineSecurityHeaders({ socket: { encrypted: true }, headers: {} }, encrypted);
  assert.equal(encrypted.headers.get("strict-transport-security"), HSTS_HEADER_VALUE);

  const httpOrigin = fakeResponse();
  applyBaselineSecurityHeaders({ socket: { encrypted: true }, headers: {} }, httpOrigin, { publicOrigin: "http://127.0.0.1:8787" });
  assert.equal(httpOrigin.headers.has("strict-transport-security"), false);

  const invalidOrigin = fakeResponse();
  applyBaselineSecurityHeaders({ socket: {}, headers: {} }, invalidOrigin, { publicOrigin: "not a url" });
  assert.equal(invalidOrigin.headers.has("strict-transport-security"), false);
});

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 8000) {
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

function assertBaseline(response, label) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", label);
  assert.equal(response.headers.get("x-frame-options"), "DENY", label);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer", label);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin", label);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, label);
  assert.equal(response.headers.get("strict-transport-security"), null, label);
}

test("every response class carries baseline security headers", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-headers-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password,
      DEVMOTER_PUBLIC_ORIGIN: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);

    const unauthenticated = await fetch(`${origin}/api/projects`);
    assert.equal(unauthenticated.status, 401);
    assertBaseline(unauthenticated, "401 JSON");
    assert.equal(unauthenticated.headers.get("content-security-policy"), BASELINE_SECURITY_HEADERS["content-security-policy"]);

    const redirect = await fetch(`${origin}/`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assertBaseline(redirect, "login redirect");

    const crossOrigin = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { authorization, origin: "http://evil.example", "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(crossOrigin.status, 403);
    assertBaseline(crossOrigin, "403 CSRF rejection");

    const api = await fetch(`${origin}/api/projects`, { headers: { authorization } });
    assert.equal(api.status, 200);
    assertBaseline(api, "authenticated JSON");

    const moduleApi = await fetch(`${origin}/api/terminal/sessions`, { headers: { authorization } });
    assertBaseline(moduleApi, "feature-module JSON");

    const login = await fetch(`${origin}/login.html`);
    assert.equal(login.status, 200);
    assertBaseline(login, "login page");
    assert.match(login.headers.get("content-security-policy"), /script-src 'self'/);

    const malformed = await fetch(`${origin}/api/terminal/sessions/%E0%A4%A`, { headers: { authorization } });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Malformed request path" });
    assertBaseline(malformed, "malformed path");
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await rm(home, { recursive: true, force: true });
  }
});
