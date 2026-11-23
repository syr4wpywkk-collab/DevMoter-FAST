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
const password = "integration-browser-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
const sessionPath = "/api/browser/sessions/00000000-0000-4000-8000-000000000000";

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function startServer(env) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-browser-api-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server not ready: " + output)), 8000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("DevMoter FAST:")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  const stop = async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  };
  return { origin: `http://127.0.0.1:${port}`, stop };
}

test("/api/browser requires owner auth, a trusted device, exact Origin and opt-in", async () => {
  const { origin, stop } = await startServer({ DEVMOTER_BROWSER_AUTOMATION: "" });
  try {
    assert.equal((await fetch(`${origin}/api/browser`)).status, 401);
    assert.equal((await fetch(`${origin}/api/browser`, { headers: { authorization } })).status, 401);

    const bootstrap = await fetch(`${origin}/api/devices/bootstrap`, {
      method: "POST",
      headers: { authorization, origin, "content-type": "application/json", "x-pocket-operation-id": "browser-device-bootstrap" },
      body: JSON.stringify({ label: "browser api test" })
    });
    assert.equal(bootstrap.status, 201);
    const device = (await bootstrap.json()).device;
    const cookie = String(bootstrap.headers.get("set-cookie") || "").split(";", 1)[0];

    const status = await fetch(`${origin}/api/browser?projectId=missing`, { headers: { authorization, cookie } });
    assert.equal(status.status, 200);
    const statusBody = await status.json();
    assert.equal(statusBody.capability.enabled, false);
    assert.equal(statusBody.session, null);
    assert.match(statusBody.policy.cdp, /private pipe/);

    const json = { authorization, cookie, "content-type": "application/json" };
    const crossOrigin = await fetch(`${origin}/api/browser/sessions`, {
      method: "POST", headers: { ...json, origin: "https://evil.example" }, body: JSON.stringify({ projectId: "p" })
    });
    assert.equal(crossOrigin.status, 403);
    const missingOrigin = await fetch(`${origin}/api/browser/sessions`, { method: "POST", headers: json, body: "{}" });
    assert.equal(missingOrigin.status, 403);

    const disabled = await fetch(`${origin}/api/browser/sessions`, {
      method: "POST", headers: { ...json, origin }, body: JSON.stringify({ projectId: "p" })
    });
    assert.equal(disabled.status, 409);
    assert.equal((await disabled.json()).code, "browser_disabled");

    const unknownSession = await fetch(`${origin}${sessionPath}/actions`, {
      method: "POST", headers: { ...json, origin }, body: JSON.stringify({ generation: 1, action: { type: "reload" } })
    });
    assert.equal(unknownSession.status, 404);
    const malformedId = await fetch(`${origin}/api/browser/sessions/not-a-uuid`, { headers: { authorization, cookie } });
    assert.equal(malformedId.status, 404);
    const badBody = await fetch(`${origin}${sessionPath}/driver`, {
      method: "POST", headers: { ...json, origin }, body: "[1]"
    });
    assert.equal(badBody.status, 400);

    const duplicateHeaders = { ...json, origin, "x-pocket-operation-id": "browser-dup-op" };
    await fetch(`${origin}${sessionPath}`, { method: "DELETE", headers: duplicateHeaders });
    const duplicate = await fetch(`${origin}${sessionPath}`, { method: "DELETE", headers: duplicateHeaders });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).duplicate, true);

    const revoke = await fetch(`${origin}/api/devices/${encodeURIComponent(device.id)}`, {
      method: "DELETE", headers: { authorization, cookie, origin, "x-pocket-operation-id": "browser-device-revoke" }
    });
    assert.equal(revoke.status, 200);
    assert.equal((await fetch(`${origin}/api/browser`, { headers: { authorization, cookie } })).status, 401);
  } finally {
    await stop();
  }
});
