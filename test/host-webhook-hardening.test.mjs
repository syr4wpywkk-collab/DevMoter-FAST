import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostValidator, parseAllowedHosts, parseHostHeader } from "../server/host-validation.mjs";
import { createFixedWindowLimiter } from "../server/rate-limit.mjs";
import { STATIC_SECURITY_HEADERS } from "../server/security-headers.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "host-hardening-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

const check = (validator, host) => validator({ headers: host === undefined ? {} : { host } });

test("Host headers are parsed strictly", () => {
  assert.equal(parseHostHeader("LocalHost:8787"), "localhost");
  assert.equal(parseHostHeader("127.0.0.1"), "127.0.0.1");
  assert.equal(parseHostHeader("[::1]:8787"), "::1");
  assert.equal(parseHostHeader("device.tailnet.ts.net."), "device.tailnet.ts.net");
  for (const bad of [undefined, "", "user@localhost", "localhost/path", "localhost:99999", "a b", "[::1", "exa_mple.com", "localhost:80:80"]) {
    assert.equal(parseHostHeader(bad), null, String(bad));
  }
});

test("without a public origin only local, Tailscale and allowed names are accepted", () => {
  const validate = createHostValidator({
    allowedHosts: parseAllowedHosts("pocket.example.com, .lan.example.org, bad host"),
    machineHostname: "devbox"
  });
  for (const host of [
    "localhost:8787", "127.0.0.1:8787", "[::1]:8787", "192.168.1.20:8787",
    "devbox", "devbox.local:8787", "device.tailnet.ts.net",
    "pocket.example.com", "a.lan.example.org"
  ]) {
    assert.deepEqual(check(validate, host), { ok: true }, host);
  }
  for (const host of ["attacker.example", "localhost.attacker.example", "ts.net.attacker.example", "xpocket.example.com", "lan.example.org"]) {
    assert.equal(check(validate, host).status, 421, host);
  }
  assert.equal(check(validate, undefined).status, 400);
  assert.equal(check(validate, "evil.example/@localhost").status, 400);
});

test("a configured public origin leaves the Host name to the proxy but still rejects malformed values", () => {
  const validate = createHostValidator({ publicOrigin: "https://pocket.example.com", machineHostname: "devbox" });
  assert.deepEqual(check(validate, "internal-upstream:8787"), { ok: true });
  assert.equal(check(validate, "bad host").status, 400);
});

test("the fixed-window limiter enforces per-key, global and key-count budgets", () => {
  let time = 1000;
  const take = createFixedWindowLimiter({ windowMs: 60_000, perKey: 2, global: 3, maxKeys: 2, now: () => time });
  assert.equal(take("a").ok, true);
  assert.equal(take("a").ok, true);
  const blocked = take("a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(take("b").ok, true);
  assert.equal(take("b").ok, false, "global budget");
  time += 60_000;
  assert.equal(take("a").ok, true);
  assert.equal(take("b").ok, true);
  assert.equal(take("c").ok, false, "key-count bound");
});

test("the static asset policy falls back to same-origin for every resource type", () => {
  const csp = STATIC_SECURITY_HEADERS["content-security-policy"];
  assert.match(csp, /(^|; )default-src 'self'(;|$)/);
  assert.match(csp, /(^|; )connect-src 'self'(;|$)/);
  assert.match(csp, /(^|; )frame-src 'self'(;|$)/);
  assert.match(csp, /(^|; )script-src 'self'(;|$)/);
  assert.match(csp, /(^|; )object-src 'none'(;|$)/);
  assert.doesNotMatch(csp, /https?:|\*/);
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

// fetch() cannot override Host, so send it with node:http.
function requestWithHost(port, path, host, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { ...headers, host } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("the server rejects foreign Host names and rate-limits the webhook", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-host-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password,
      DEVMOTER_PUBLIC_ORIGIN: "",
      DEVMOTER_ALLOWED_HOSTS: "pocket.example.com"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);

    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "pocket.example.com", "device.tailnet.ts.net"]) {
      const ok = await requestWithHost(port, "/api/projects", host, { headers: { authorization } });
      assert.equal(ok.status, 200, host);
    }

    const rebound = await requestWithHost(port, "/api/projects", "attacker.example", { headers: { authorization } });
    assert.equal(rebound.status, 421);
    assert.deepEqual(JSON.parse(rebound.body), { error: "Host not allowed" });
    assert.equal(rebound.headers["x-content-type-options"], "nosniff");

    const login = await requestWithHost(port, "/login", "attacker.example");
    assert.equal(login.status, 421, "public pages are covered too");

    const malformed = await requestWithHost(port, "/api/projects", "attacker.example/@localhost", { headers: { authorization } });
    assert.equal(malformed.status, 400);

    const webhook = () => requestWithHost(port, "/api/control/events/github", `127.0.0.1:${port}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const results = [];
    for (let index = 0; index < 125; index += 1) results.push(await webhook());
    assert.equal(results.slice(0, 120).every(result => result.status === 400), true, "unsigned deliveries are rejected, not limited");
    for (const limited of results.slice(120)) {
      assert.equal(limited.status, 429);
      assert.match(limited.headers["retry-after"], /^\d+$/);
    }

    const stillServed = await requestWithHost(port, "/api/projects", `127.0.0.1:${port}`, { headers: { authorization } });
    assert.equal(stillServed.status, 200, "the webhook limit does not affect other routes");
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await rm(home, { recursive: true, force: true });
  }
});
