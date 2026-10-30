import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

async function waitForReady(child, timeoutMs = 8000) {
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

// Send the path byte-for-byte: fetch() would normalize "..", "%2e%2e" and "\".
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

test("OpenCode proxy rejects SSRF/traversal paths before reaching upstream and keeps normal routes", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-opencode-ssrf-"));
  const projectDir = join(home, "project");
  await mkdir(projectDir);
  const authPassword = "ssrf-regression-password-123";

  const upstreamHits = [];
  const openCode = http.createServer((req, res) => {
    upstreamHits.push(req.url);
    res.setHeader("content-type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, path: req.url }));
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

    const rejected = [
      "/api/opencode//evil.example/x",
      "/api/opencode/api/../x",
      "/api/opencode/../x",
      "/api/opencode/%2e%2e/",
      "/api/opencode/session/%2e%2e/x",
      "/api/opencode/%252e%252e/x",
      "/api/opencode/http://evil",
      "/api/opencodehttp://evil",
      "/api/opencode/\\evil",
      "/api/opencode/%5Cevil",
      "/api/opencode/%2F%2Fevil.example/x",
      "/api/opencode/session%00x"
    ];
    // DevMoter polls OpenCode on its own; tag our probes so only they are checked.
    for (const [index, path] of rejected.entries()) {
      const response = await rawGet(port, `${path}?ssrf-probe=${index}`, headers);
      assert.equal(response.status, 400, `${path} should be rejected, got ${response.status}: ${response.body}`);
      assert.match(JSON.parse(response.body).error, /OpenCode proxy path/);
    }
    assert.deepEqual(
      upstreamHits.filter(hit => hit.includes("ssrf-probe")),
      [],
      "rejected paths must never reach OpenCode"
    );

    const allowed = [
      ["/api/opencode/location", "/api/location"],
      ["/api/opencode/api/session", "/api/session"],
      ["/api/opencode/session/ses_123/message?limit=20", "/api/session/ses_123/message?limit=20"],
      ["/api/opencode/session?directory=%2Ftmp%2Fproject", "/api/session?directory=%2Ftmp%2Fproject"],
      ["/api/opencode", "/api/"]
    ];
    for (const [path, expectedUpstream] of allowed) {
      const response = await rawGet(port, path, headers);
      assert.equal(response.status, 200, `${path} should be proxied, got ${response.status}: ${response.body}`);
      assert.equal(JSON.parse(response.body).path, expectedUpstream);
    }
    for (const [, expectedUpstream] of allowed) {
      assert.ok(upstreamHits.includes(expectedUpstream), `${expectedUpstream} should reach OpenCode`);
    }
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await new Promise(resolve => openCode.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
