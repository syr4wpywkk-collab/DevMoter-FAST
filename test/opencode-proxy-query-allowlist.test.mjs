import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    const timer = setTimeout(() => reject(new Error(`DevMoter did not become ready: ${output}`)), timeoutMs);
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
      reject(new Error(`DevMoter exited early with code ${code}: ${output}`));
    });
  });
}

// Send the path byte-for-byte so encoded variants reach the server untouched.
function rawGet(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function rawPost(port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("OpenCode proxy forwards only allowlisted query parameters (#590)", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-opencode-query-"));
  const projectDir = join(home, "project");
  await mkdir(projectDir);
  const authPassword = "query-allowlist-password-123";
  const fixture = JSON.parse(await readFile(new URL("./fixtures/opencode/opencode-v1.19.5.json", import.meta.url), "utf8"));

  const upstreamHits = [];
  const openCode = http.createServer((req, res) => {
    upstreamHits.push(req.url);
    res.setHeader("content-type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(fixture[req.url] ?? { ok: true, path: req.url }));
  });
  openCode.listen(0, "127.0.0.1");
  await once(openCode, "listening");
  const openCodePort = openCode.address().port;

  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${openCodePort}`,
      OPENCODE_DIRECTORY: projectDir,
      CODEX_CWD: projectDir,
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);
    const headers = {
      authorization: `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`,
      origin: `http://127.0.0.1:${port}`
    };

    // Legitimate client queries reach upstream with exactly those parameters.
    const allowed = [
      ["/api/opencode/session?limit=80&order=desc", "/api/session?limit=80&order=desc"],
      ["/api/opencode/session?order=desc&limit=80", "/api/session?order=desc&limit=80"],
      // Boundary values of the limit range are accepted.
      ["/api/opencode/session?limit=1", "/api/session?limit=1"],
      ["/api/opencode/session?limit=200", "/api/session?limit=200"],
      ["/api/opencode/session", "/api/session"]
    ];
    for (const [path, expectedUpstream] of allowed) {
      const response = await rawGet(port, path, headers);
      assert.equal(response.status, 200, `${path} should be proxied, got ${response.status}: ${response.body}`);
      assert.equal(JSON.parse(response.body).path, expectedUpstream);
    }
    for (const [, expectedUpstream] of allowed) {
      assert.ok(upstreamHits.includes(expectedUpstream), `${expectedUpstream} should reach OpenCode`);
    }

    const providerPath = "/api/opencode/pocket/providers";
    const initialCatalog = await rawGet(port, providerPath, headers);
    assert.equal(initialCatalog.status, 200, initialCatalog.body);
    const catalogLoads = () => upstreamHits.filter(path => path === "/api/provider").length;
    assert.equal(catalogLoads(), 1);
    const cachedCatalog = await rawGet(port, `${providerPath}?refresh=0`, headers);
    assert.equal(cachedCatalog.status, 200, cachedCatalog.body);
    assert.equal(catalogLoads(), 1);
    const providersRefresh = await rawGet(port, `${providerPath}?refresh=1`, headers);
    assert.equal(providersRefresh.status, 200, providersRefresh.body);
    assert.equal(catalogLoads(), 2);

    const hitsBeforeRejected = upstreamHits.length;
    const rejected = [
      // Directory/project selection is never taken from the client.
      "/api/opencode/session?directory=/etc",
      "/api/opencode/session?directory=%2Fetc",
      "/api/opencode/session?Directory=%2Fetc",
      "/api/opencode/session?projectId=other-project",
      // Unknown parameters are rejected, not silently stripped.
      "/api/opencode/session?foo=bar",
      "/api/opencode/session?limit=80&foo=bar",
      // Allowlisted names still need valid values.
      "/api/opencode/session?limit=0",
      "/api/opencode/session?limit=99999",
      "/api/opencode/session?limit=abc",
      "/api/opencode/session?limit=201",
      "/api/opencode/session?order=sideways",
      "/api/opencode/session?refresh=2",
      // The allowlist is scoped per route: refresh is not a session-list
      // parameter, and limit/order belong to the list route only.
      "/api/opencode/session?refresh=1",
      "/api/opencode/session?refresh=0",
      "/api/opencode/session/ses_detail?limit=10",
      "/api/opencode/session/ses_detail?order=asc",
      // Routes absent from the table take no query parameters at all.
      "/api/opencode/session/ses_detail?refresh=1",
      "/api/opencode/agent?refresh=1",
      // A repeated allowlisted parameter is rejected instead of letting
      // the upstream pick a winner.
      "/api/opencode/session?limit=1&limit=2",
      "/api/opencode/session?order=asc&order=desc",
      // Abuse caps: too many parameters, or an over-long raw query.
      "/api/opencode/session?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9",
      `/api/opencode/session?limit=${"1".repeat(1100)}`
    ];
    for (const path of rejected) {
      const response = await rawGet(port, path, headers);
      assert.equal(response.status, 400, `${path} should be rejected, got ${response.status}: ${response.body}`);
      assert.match(JSON.parse(response.body).error, /OpenCode proxy query/);
    }
    for (const query of ["refresh=2", "refresh=0&refresh=1", "limit=10"]) {
      const invalid = await rawGet(port, `${providerPath}?${query}`, headers);
      assert.equal(invalid.status, 400, invalid.body);
      assert.match(JSON.parse(invalid.body).error, /OpenCode proxy query/);
    }
    for (const path of ["/api/opencode/session?limit=10", `${providerPath}?refresh=1`]) {
      const invalid = await rawPost(port, path, headers);
      assert.equal(invalid.status, 400, invalid.body);
      assert.match(JSON.parse(invalid.body).error, /OpenCode proxy query/);
    }
    assert.equal(
      upstreamHits.length,
      hitsBeforeRejected,
      "rejected queries must never reach OpenCode"
    );
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await new Promise(resolve => openCode.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
