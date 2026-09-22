import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    probe.close(error => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForReady(child, timeoutMs = 8000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DevMoter test server did not become ready. Output: ${output}`));
    }, timeoutMs);

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
      reject(new Error(`DevMoter test server exited early with code ${code}. Output: ${output}`));
    });
  });
}

test("backend POST routes reach handlers instead of crashing with an unexpected 500", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-server-smoke-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForReady(child);

    const operationId = "server-smoke-operation";
    const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pocket-operation-id": operationId
      },
      body: JSON.stringify({ path: "" }),
      signal: AbortSignal.timeout(4000)
    });

    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(String(payload.error || ""), /Project path is required/);

    const duplicate = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pocket-operation-id": operationId
      },
      body: JSON.stringify({ path: "" }),
      signal: AbortSignal.timeout(4000)
    });

    assert.equal(duplicate.status, 409);
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicatePayload.duplicate, true);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }

  assert.doesNotMatch(stderr, /ReferenceError/);
});
