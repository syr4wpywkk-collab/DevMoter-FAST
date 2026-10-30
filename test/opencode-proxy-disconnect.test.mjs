import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
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

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
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

test("OpenCode proxy survives an upstream stream disconnect and aborts the upstream fetch when the client closes", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-proxy-disconnect-"));
  const authPassword = "proxy-disconnect-password-123";
  let upstreamClosed = false;

  const openCode = http.createServer((req, res) => {
    if (req.url === "/api/cut") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write("data: partial\n\n");
      setTimeout(() => req.socket.destroy(), 150);
      return;
    }
    if (req.url === "/api/hold") {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write("data: hold\n\n");
      req.on("aborted", () => {
        upstreamClosed = true;
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const openCodePort = await listen(openCode);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${openCodePort}`,
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForReady(child);
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      authorization: `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`,
      origin: baseUrl,
      accept: "text/event-stream"
    };

    const cut = await fetch(`${baseUrl}/api/opencode/cut`, {
      headers,
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(cut.status, 200);
    assert.match(await cut.text(), /data: partial/);
    assert.equal(child.exitCode, null);

    const controller = new AbortController();
    const held = await fetch(`${baseUrl}/api/opencode/hold`, {
      headers,
      signal: controller.signal
    });
    assert.equal(held.status, 200);
    const reader = held.body.getReader();
    const first = await reader.read();
    assert.match(Buffer.from(first.value).toString("utf8"), /data: hold/);
    assert.equal(upstreamClosed, false);
    controller.abort();
    await reader.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(upstreamClosed, true);
    assert.equal(child.exitCode, null);

    const health = await fetch(`${baseUrl}/api/health`, {
      headers,
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(health.status, 200);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => openCode.close(resolve));
    await rm(home, { recursive: true, force: true });
  }

  assert.doesNotMatch(stderr, /ERR_HTTP_HEADERS_SENT/);
  assert.doesNotMatch(stderr, /uncaughtException|Unhandled/);
});
