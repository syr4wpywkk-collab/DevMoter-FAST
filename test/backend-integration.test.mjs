import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("DevMoter integrates with mocked OpenCode and Codex happy/failure paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-backend-integration-"));

  const openCode = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/location") {
      res.writeHead(200);
      res.end(JSON.stringify({ directory: "/tmp/mock-project", project: { name: "mock" } }));
      return;
    }
    if (req.url === "/api/fail") {
      res.writeHead(503);
      res.end(JSON.stringify({ message: "synthetic OpenCode failure" }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ message: "not found" }));
  });
  const openCodePort = await listen(openCode);

  const fakeCodex = join(home, "fake-codex.mjs");
  await writeFile(fakeCodex, `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { server: "fake-codex" } }) + "\\n");
    return;
  }
  if (message.method === "thread/list") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + "\\n");
    return;
  }
  if (message.method === "thread/read") {
    process.stdout.write(JSON.stringify({ id: message.id, error: { message: "synthetic Codex failure" } }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
});
`);
  await chmod(fakeCodex, 0o755);

  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${openCodePort}`,
      OPENCODE_DIRECTORY: "/tmp/mock-project",
      CODEX_BIN: fakeCodex
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);

    const openCodeOk = await fetch(`http://127.0.0.1:${port}/api/opencode/location`);
    assert.equal(openCodeOk.status, 200);
    assert.equal((await openCodeOk.json()).directory, "/tmp/mock-project");

    const openCodeFailure = await fetch(`http://127.0.0.1:${port}/api/opencode/fail`);
    assert.equal(openCodeFailure.status, 503);
    assert.match(JSON.stringify(await openCodeFailure.json()), /synthetic OpenCode failure/);

    const codexOk = await fetch(`http://127.0.0.1:${port}/api/codex/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pocket-operation-id": "codex-happy" },
      body: JSON.stringify({ method: "thread/list", params: {} })
    });
    assert.equal(codexOk.status, 200);
    assert.deepEqual((await codexOk.json()).result, { data: [] });

    const codexFailure = await fetch(`http://127.0.0.1:${port}/api/codex/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pocket-operation-id": "codex-failure" },
      body: JSON.stringify({ method: "thread/read", params: { threadId: "missing" } })
    });
    assert.equal(codexFailure.status, 502);
    assert.match((await codexFailure.json()).error, /synthetic Codex failure/);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => openCode.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
