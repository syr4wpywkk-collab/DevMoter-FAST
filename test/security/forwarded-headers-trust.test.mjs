import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAutomationApi } from "../../server/automation-api.mjs";
import { expectedRequestOrigin, mutationOriginMatches, resolveLocalAddress } from "../../server/auth.mjs";
import { deviceSessionCookie } from "../../server/system-features.mjs";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PASSWORD = "forwarded-headers-test-password-1";
const AUTHORIZATION = `Basic ${Buffer.from(`devmoter:${PASSWORD}`).toString("base64")}`;

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 60_000) {
  let output = "";
  let stderr = "";
  const onErr = chunk => { stderr += chunk.toString(); };
  child.stderr.on("data", onErr);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not become ready. stdout=${output} stderr=${stderr}`));
    }, timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onErr);
        child.stderr.resume();
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      child.stderr.off("data", onErr);
      reject(new Error(`Server exited early (${code}). stdout=${output} stderr=${stderr}`));
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
  if (child.exitCode === null && child.signalCode === null) {
    const killed = once(child, "exit");
    child.kill("SIGKILL");
    await killed;
  }
}

function startServer({ home, port, trustProxy = "", publicOrigin = "" }) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: PASSWORD,
      DEVMOTER_TRUST_PROXY: trustProxy,
      DEVMOTER_PUBLIC_ORIGIN: publicOrigin
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return child;
}

test("untrusted proxy cannot spoof control localAddress or bypass same-origin guard", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-forwarded-untrusted-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = startServer({ home, port, trustProxy: "", publicOrigin: "" });
  t.after(async () => {
    await stopServer(child);
    await rm(home, { recursive: true, force: true });
  });

  await waitForReady(child);

  const hostsRes = await fetch(`${origin}/api/control/hosts`, {
    headers: {
      authorization: AUTHORIZATION,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(hostsRes.status, 200);
  const hostsPayload = await hostsRes.json();
  assert.equal(hostsPayload.hosts[0].id, "local");
  assert.equal(hostsPayload.hosts[0].address, origin);
  assert.equal(JSON.stringify(hostsPayload).includes("evil.example"), false);

  const statusRes = await fetch(`${origin}/api/control/hosts/status`, {
    headers: {
      authorization: AUTHORIZATION,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(statusRes.status, 200);
  const statusPayload = await statusRes.json();
  assert.equal(statusPayload.hosts[0].host.id, "local");
  assert.equal(statusPayload.hosts[0].host.address, origin);
  assert.equal(statusPayload.hosts[0].status.state, "online");
  assert.equal(JSON.stringify(statusPayload).includes("evil.example"), false);

  const spoofedMutation = await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(spoofedMutation.status, 403);
});

test("untrusted non-matching DEVMOTER_TRUST_PROXY still ignores forwarded headers", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-forwarded-other-proxy-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = startServer({ home, port, trustProxy: "10.0.0.9", publicOrigin: "" });
  t.after(async () => {
    await stopServer(child);
    await rm(home, { recursive: true, force: true });
  });

  await waitForReady(child);

  const hostsRes = await fetch(`${origin}/api/control/hosts`, {
    headers: {
      authorization: AUTHORIZATION,
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(hostsRes.status, 200);
  const hostsPayload = await hostsRes.json();
  assert.equal(hostsPayload.hosts[0].address, origin);
  assert.equal(JSON.stringify(hostsPayload).includes("evil.example"), false);
});

test("forwarded origin uses the trusted proxy's last values only", () => {
  const req = {
    headers: {
      host: "internal.local",
      "x-forwarded-host": "evil.example, real.example",
      "x-forwarded-proto": "http, https"
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  const options = { trustedProxies: ["127.0.0.1"] };
  assert.equal(expectedRequestOrigin(req, "", options), "https://real.example");
  req.socket.remoteAddress = "203.0.113.5";
  assert.equal(expectedRequestOrigin(req, "", options), "http://internal.local");
});

test("trusted proxy honors valid forwarded headers, rejects anomalies, and keeps DEVMOTER_PUBLIC_ORIGIN precedence", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-forwarded-trusted-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child = startServer({ home, port, trustProxy: "127.0.0.1", publicOrigin: "" });
  t.after(async () => {
    await stopServer(child);
    await rm(home, { recursive: true, force: true });
  });

  await waitForReady(child);

  const hostsRes = await fetch(`${origin}/api/control/hosts`, {
    headers: {
      authorization: AUTHORIZATION,
      "x-forwarded-host": "proxy.example.test",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(hostsRes.status, 200);
  const hostsPayload = await hostsRes.json();
  assert.equal(hostsPayload.hosts[0].address, "https://proxy.example.test");

  const statusRes = await fetch(`${origin}/api/control/hosts/status`, {
    headers: {
      authorization: AUTHORIZATION,
      "x-forwarded-host": "evil.example, proxy.example.test:8443",
      "x-forwarded-proto": "http, https"
    }
  });
  assert.equal(statusRes.status, 200);
  const statusPayload = await statusRes.json();
  assert.equal(statusPayload.hosts[0].host.address, "https://proxy.example.test:8443");

  const proxiedMutation = await fetch(`${origin}/api/auth/logout`, {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      origin: "https://proxy.example.test",
      "x-forwarded-host": "proxy.example.test",
      "x-forwarded-proto": "https"
    }
  });
  assert.equal(proxiedMutation.status, 200);

  for (const [proto, host] of [
    ["javascript", "proxy.example.test"],
    ["https", "user:pass@evil.example"],
    ["https", "evil.example/steal"],
    ["https", "evil.example?q=1"]
  ]) {
    const anomalousRes = await fetch(`${origin}/api/control/hosts`, {
      headers: {
        authorization: AUTHORIZATION,
        "x-forwarded-proto": proto,
        "x-forwarded-host": host
      }
    });
    assert.equal(anomalousRes.status, 200);
    const payload = await anomalousRes.json();
    assert.equal(payload.hosts[0].address, origin);
  }

  await stopServer(child);
  child = startServer({
    home,
    port,
    trustProxy: "127.0.0.1",
    publicOrigin: "https://canonical.example.test"
  });
  await waitForReady(child);

  const canonicalRes = await fetch(`${origin}/api/control/hosts`, {
    headers: {
      authorization: AUTHORIZATION,
      "x-forwarded-host": "proxy.example.test",
      "x-forwarded-proto": "http"
    }
  });
  assert.equal(canonicalRes.status, 200);
  const canonicalPayload = await canonicalRes.json();
  assert.equal(canonicalPayload.hosts[0].address, "https://canonical.example.test");
});

test("automation open URL, origin matcher, and device cookie align on trusted proxy policy", async () => {
  const responses = [];
  const automation = createAutomationApi({
    readProjectRegistry: async () => [{ id: "p1", name: "Demo", path: "/safe/demo", addedAt: 1 }],
    getProjectById: async () => ({ id: "p1", name: "Demo", path: "/safe/demo", addedAt: 1 }),
    normalizeExistingProjectPath: async path => path,
    openCode: { fetchJson: async () => [], info: async () => ({}), pendingRequests: async () => ({}) },
    codex: Object.assign(new EventEmitter(), { request: async () => ({}) }),
    json: (_res, status, body) => responses.push({ status, body }),
    readJson: async () => ({}),
    operationId: () => "op-1",
    claimOperation: () => true,
    publicOrigin: "",
    trustedProxies: ["127.0.0.1"]
  });

  await automation.handle(
    {
      method: "GET",
      headers: { host: "127.0.0.1:8787", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      socket: { remoteAddress: "203.0.113.5" }
    },
    {},
    new URL("http://127.0.0.1:8787/api/automation/open?project=p1")
  );
  assert.equal(responses.at(-1).body.url, "http://127.0.0.1:8787/?project=p1");

  await automation.handle(
    {
      method: "GET",
      headers: { host: "127.0.0.1:8787", "x-forwarded-host": "proxy.example.test", "x-forwarded-proto": "https" },
      socket: { remoteAddress: "127.0.0.1" }
    },
    {},
    new URL("http://127.0.0.1:8787/api/automation/open?project=p1")
  );
  assert.equal(responses.at(-1).body.url, "https://proxy.example.test/?project=p1");

  const spoofedMutationReq = {
    method: "POST",
    headers: {
      host: "127.0.0.1:8787",
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https"
    },
    socket: { remoteAddress: "203.0.113.5", encrypted: false }
  };
  assert.equal(expectedRequestOrigin(spoofedMutationReq, "", { trustedProxies: ["127.0.0.1"] }), "http://127.0.0.1:8787");
  assert.equal(mutationOriginMatches(spoofedMutationReq, "", { trustedProxies: ["127.0.0.1"] }), false);
  assert.equal(
    deviceSessionCookie(spoofedMutationReq, "secret", 60, { trustedProxies: ["127.0.0.1"] }).includes("Secure"),
    false
  );
  assert.equal(
    deviceSessionCookie(
      { ...spoofedMutationReq, socket: { remoteAddress: "127.0.0.1", encrypted: false } },
      "secret",
      60,
      { trustedProxies: ["127.0.0.1"] }
    ).includes("Secure"),
    true
  );
  assert.equal(
    resolveLocalAddress({ headers: {}, socket: {} }, { publicOrigin: "ftp://bad.example" }),
    "http://localhost"
  );
});
