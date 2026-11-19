import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// #332: the service must come up healthy, stop cleanly on SIGTERM (what
// `systemctl --user restart` sends), and come back healthy on the same state.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function start(home, port) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: "http://127.0.0.1:9",
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: "restart-health-test-password",
      DEVMOTER_PASSKEY_REQUIRED: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.resume();
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server not ready: ${output}`)), 10_000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("DevMoter FAST:")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  return child;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const [code, signal] = await exited;
  return { code, signal };
}

async function health(port) {
  const authorization = `Basic ${Buffer.from("devmoter:restart-health-test-password").toString("base64")}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { authorization } });
  return { status: response.status, body: await response.json() };
}

test("#332: /api/health answers, and again after a SIGTERM restart on the same state", { timeout: 40_000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-restart-health-"));
  const port = await freePort();
  let child = null;
  t.after(async () => {
    if (child) await stop(child);
    await rm(home, { recursive: true, force: true });
  });

  child = await start(home, port);
  const first = await health(port);
  assert.equal(first.status, 200);
  assert.equal(typeof first.body.version, "string");
  assert.equal(typeof first.body.online, "boolean");
  assert.ok(first.body.backends?.opencode && first.body.backends?.codex);

  const exit = await stop(child);
  child = null;
  assert.ok(exit.code === 0 || exit.signal === "SIGTERM", `clean stop, got ${JSON.stringify(exit)}`);
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/health`), "port is released after stop");

  child = await start(home, port);
  const second = await health(port);
  assert.equal(second.status, 200);
  assert.equal(second.body.version, first.body.version);
});
