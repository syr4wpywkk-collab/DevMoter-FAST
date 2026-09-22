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
const password = "integration-auth-password-1234";
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

async function waitForReady(child, timeoutMs = 8000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DevMoter auth test server did not become ready: ${output}`)), timeoutMs);
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
      reject(new Error(`DevMoter auth test server exited early with code ${code}: ${output}`));
    });
  });
}

test("server requires auth and exact Origin for mutations", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-auth-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);

    const unauthenticated = await fetch(`${origin}/api/projects`);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("www-authenticate") || "", /^Basic /);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");

    const wrong = await fetch(`${origin}/api/projects`, {
      headers: {
        authorization: `Basic ${Buffer.from("devmoter:wrong-password-value").toString("base64")}`
      }
    });
    assert.equal(wrong.status, 401);

    const authenticated = await fetch(`${origin}/api/projects`, {
      headers: { authorization }
    });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.headers.get("cache-control"), "no-store");

    const missingOrigin = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json"
      },
      body: JSON.stringify({ path: "" })
    });
    assert.equal(missingOrigin.status, 403);

    const sameOrigin = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json"
      },
      body: JSON.stringify({ path: "" })
    });
    assert.equal(sameOrigin.status, 400);
    const payload = await sameOrigin.json();
    assert.match(String(payload.error || ""), /Project path is required/);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }
});

test("server fails closed when DevMoter auth password is missing", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0);
  assert.match(stderr, /DEVMOTER_AUTH_PASSWORD must be set to at least 16 characters/);
});
