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
const password = "bind-guard-integration-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

function buildChildEnv(home, port, extra = {}) {
  const env = {
    ...process.env,
    HOME: home,
    POCKET_PORT: String(port),
    CODEX_BIN: "__devmoter_test_codex_not_started__",
    DEVMOTER_AUTH_PASSWORD: password
  };
  delete env.POCKET_HOST;
  delete env.DEVMOTER_ALLOW_INSECURE_HTTP;
  delete env.DEVMOTER_PUBLIC_ORIGIN;
  return { ...env, ...extra };
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
  if (child.exitCode === null && child.signalCode === null) {
    const killed = once(child, "exit");
    child.kill("SIGKILL");
    await killed;
  }
}

async function waitForReady(child, timeoutMs = 60_000) {
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DevMoter test server did not become ready. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);

    const onData = chunk => {
      stdout += chunk.toString();
      if (stdout.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };

    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`DevMoter test server exited early (${code}). stdout=${stdout} stderr=${stderr}`));
    });
  });

  return { stdout, getStderr: () => stderr };
}

test("server startup refuses non-loopback plain-HTTP bind without DEVMOTER_ALLOW_INSECURE_HTTP=1", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-bind-refuse-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const port = await freePort();

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: buildChildEnv(home, port, {
      POCKET_HOST: "0.0.0.0",
      DEVMOTER_PUBLIC_ORIGIN: "https://device.tailnet.ts.net"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk.toString(); });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });

  let timer;
  try {
    const [code] = await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Refusal check timed out. stdout=${stdout} stderr=${stderr}`)), 60_000);
      })
    ]);
    clearTimeout(timer);

    assert.notEqual(code, 0);
    assert.equal(stdout.includes("DevMoter FAST:"), false);
    assert.match(stderr, /Basic auth credentials will traverse the network unencrypted over plain HTTP/i);
    assert.match(stderr, /DEVMOTER_ALLOW_INSECURE_HTTP=1/);
  } finally {
    clearTimeout(timer);
    await stopChild(child);
  }
});

test("server startup emits explicit warning and runs on non-loopback bind when DEVMOTER_ALLOW_INSECURE_HTTP=1", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-bind-optin-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const port = await freePort();

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: buildChildEnv(home, port, {
      POCKET_HOST: "0.0.0.0",
      DEVMOTER_ALLOW_INSECURE_HTTP: "1"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const { getStderr } = await waitForReady(child);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { authorization },
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 200);
    await stopChild(child);

    const stderr = getStderr();
    assert.match(stderr, /\[SECURITY WARNING\]/);
    assert.match(stderr, /Basic auth credentials will traverse the network unencrypted over plain HTTP/i);
    assert.match(stderr, /DEVMOTER_ALLOW_INSECURE_HTTP=1/);
  } finally {
    await stopChild(child);
  }
});

test("server startup emits no bind warning or refusal on loopback Tailscale Serve setup", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-bind-loopback-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const port = await freePort();

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: buildChildEnv(home, port, {
      POCKET_HOST: "127.0.0.1",
      DEVMOTER_PUBLIC_ORIGIN: "https://device.tailnet.ts.net"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const { getStderr } = await waitForReady(child);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { authorization },
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 200);
    await stopChild(child);

    const stderr = getStderr();
    assert.doesNotMatch(stderr, /SECURITY WARNING/);
    assert.doesNotMatch(stderr, /DEVMOTER_ALLOW_INSECURE_HTTP/);
    assert.doesNotMatch(stderr, /unencrypted over plain HTTP/i);
  } finally {
    await stopChild(child);
  }
});
