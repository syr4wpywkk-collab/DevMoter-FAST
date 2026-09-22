import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
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

test("PWA shell declares an installable manifest and service worker keeps API requests out of cache", async () => {
  const [index, manifestText, sw] = await Promise.all([
    readFile(join(repoRoot, "index.html"), "utf8"),
    readFile(join(repoRoot, "public/manifest.webmanifest"), "utf8"),
    readFile(join(repoRoot, "public/sw.js"), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(index, /rel=["']manifest["']/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.match(sw, /pathname\.startsWith\(["']\/api\/["']\)/);
  assert.match(sw, /cache:\s*["']no-store["']/);
});

test("health and OpenCode SSE proxy are live without a real OpenCode account", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-pwa-"));
  const upstreamPort = await freePort();
  const appPort = await freePort();
  const authPassword = "pwa-integration-password-123";

  const upstream = http.createServer((req, res) => {
    if (req.url === "/api/location") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ directory: home }));
      return;
    }
    if (req.url === "/api/event") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      });
      res.end('event: ready\ndata: {"ok":true}\n\n');
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
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

  try {
    await waitForReady(child);

    const authorization = `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`;

    const health = await fetch(`http://127.0.0.1:${appPort}/api/health`, {
      headers: { authorization },
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(health.status, 200);
    const healthPayload = await health.json();
    assert.equal(healthPayload.backends.opencode.online, true);
    assert.equal(healthPayload.online, true);

    const events = await fetch(`http://127.0.0.1:${appPort}/api/opencode/event`, {
      headers: { accept: "text/event-stream", authorization },
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(events.status, 200);
    assert.match(events.headers.get("content-type") || "", /text\/event-stream/);
    assert.match(await events.text(), /event: ready/);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
