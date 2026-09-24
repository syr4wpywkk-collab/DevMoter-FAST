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
    assert.equal(unauthenticated.headers.get("www-authenticate"), null);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    const unauthenticatedPayload = await unauthenticated.json();
    assert.equal(unauthenticatedPayload.login, "/login.html");

    const rootRedirect = await fetch(origin + "/", { redirect: "manual" });
    assert.equal(rootRedirect.status, 302);
    assert.equal(rootRedirect.headers.get("location"), "/login.html");

    const wrong = await fetch(`${origin}/api/projects`, {
      headers: {
        authorization: `Basic ${Buffer.from("devmoter:wrong-password-value").toString("base64")}`
      }
    });
    assert.equal(wrong.status, 401);


    const unauthenticatedIntegrations = await fetch(`${origin}/api/integrations/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(unauthenticatedIntegrations.status, 401);

    const inventoryMissingOrigin = await fetch(`${origin}/api/integrations/status`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json"
      },
      body: "{}"
    });
    assert.equal(inventoryMissingOrigin.status, 403);

    const inventoryCrossOrigin = await fetch(`${origin}/api/integrations/status`, {
      method: "POST",
      headers: {
        authorization,
        origin: "https://evil.example",
        "content-type": "application/json"
      },
      body: "{}"
    });
    assert.equal(inventoryCrossOrigin.status, 403);

    const authenticatedIntegrations = await fetch(`${origin}/api/integrations/status`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "integration-status-test"
      },
      body: "{}"
    });
    assert.equal(authenticatedIntegrations.status, 200);
    const integrationInventory = await authenticatedIntegrations.json();
    assert.equal(Array.isArray(integrationInventory.integrations), true);
    assert.equal(JSON.stringify(integrationInventory).includes('"bin"'), false);
    assert.equal(JSON.stringify(integrationInventory).includes("versionArgs"), false);

    const integrationMissingOrigin = await fetch(`${origin}/api/integrations/claude/launch`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json"
      },
      body: JSON.stringify({ projectId: "does-not-matter" })
    });
    assert.equal(integrationMissingOrigin.status, 403);

    const integrationCrossOrigin = await fetch(`${origin}/api/integrations/antigravity/remote/start`, {
      method: "POST",
      headers: {
        authorization,
        origin: "https://evil.example",
        "content-type": "application/json"
      },
      body: "{}"
    });
    assert.equal(integrationCrossOrigin.status, 403);

    const integrationSameOrigin = await fetch(`${origin}/api/integrations/claude/launch`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json"
      },
      body: JSON.stringify({ projectId: "missing-project" })
    });
    assert.equal(integrationSameOrigin.status, 500);
    const integrationError = await integrationSameOrigin.json();
    assert.equal(integrationError.error, "Integration operation failed");

    const authenticated = await fetch(`${origin}/api/projects`, {
      headers: { authorization }
    });
    assert.equal(authenticated.status, 200);
    assert.equal(authenticated.headers.get("cache-control"), "no-store");

    const unauthenticatedHost = await fetch(`${origin}/api/host`);
    assert.equal(unauthenticatedHost.status, 401);

    const hostResponse = await fetch(`${origin}/api/host`, {
      headers: { authorization }
    });
    assert.equal(hostResponse.status, 200);
    const hostSnapshot = await hostResponse.json();
    assert.equal(hostSnapshot.protocolVersion, "1.0");
    assert.equal(typeof hostSnapshot.host.id, "string");
    assert.equal(typeof hostSnapshot.host.platform, "string");
    assert.deepEqual(Object.keys(hostSnapshot.capabilities).sort(), [
      "agents", "browser", "files", "git", "notifications", "ports", "processes", "secrets", "services", "terminal"
    ]);
    assert.equal(JSON.stringify(hostSnapshot).includes(process.env.HOME || "/home/"), false);
    assert.equal(Object.hasOwn(hostSnapshot.host, "hostname"), false);

    const terminalSessionsUnauthorized = await fetch(`${origin}/api/terminal/sessions`);
    assert.equal(terminalSessionsUnauthorized.status, 401);
    const terminalSessionsUntrusted = await fetch(`${origin}/api/terminal/sessions`, { headers: { authorization } });
    assert.equal(terminalSessionsUntrusted.status, 403);
    const bootstrappedDevice = await fetch(`${origin}/api/devices/bootstrap`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "terminal-trusted-device-bootstrap"
      },
      body: JSON.stringify({ label: "terminal integration test" })
    });
    assert.equal(bootstrappedDevice.status, 201);
    const devicePayload = await bootstrappedDevice.json();
    const deviceCookie = String(bootstrappedDevice.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.match(deviceCookie, /^devmoter_device=/);
    assert.equal(Object.hasOwn(devicePayload, "token"), false);
    assert.equal(Object.hasOwn(devicePayload.device, "tokenHash"), false);
    const terminalSessions = await fetch(`${origin}/api/terminal/sessions`, {
      headers: { authorization, cookie: deviceCookie }
    });
    assert.equal(terminalSessions.status, 200);
    assert.deepEqual((await terminalSessions.json()).sessions, []);

    const terminalClaimMissingOrigin = await fetch(`${origin}/api/terminal/sessions/${"a".repeat(36)}/claim`, {
      method: "POST",
      headers: {
        authorization,
        cookie: deviceCookie,
        "content-type": "application/json",
        "x-devmoter-terminal-entry": "explicit",
        "x-pocket-operation-id": "terminal-claim-missing-origin"
      },
      body: "{}"
    });
    assert.equal(terminalClaimMissingOrigin.status, 403);

    const terminalClaimSameOrigin = await fetch(`${origin}/api/terminal/sessions/${"a".repeat(36)}/claim`, {
      method: "POST",
      headers: {
        authorization,
        cookie: deviceCookie,
        origin,
        "content-type": "application/json",
        "x-devmoter-terminal-entry": "explicit",
        "x-pocket-operation-id": "terminal-claim-same-origin"
      },
      body: "{}"
    });
    assert.equal(terminalClaimSameOrigin.status, 404);

    const revokeTrustedDevice = await fetch(`${origin}/api/devices/${encodeURIComponent(devicePayload.device.id)}`, {
      method: "DELETE",
      headers: {
        authorization,
        cookie: deviceCookie,
        origin,
        "x-pocket-operation-id": "terminal-device-revoke"
      }
    });
    assert.equal(revokeTrustedDevice.status, 200);
    assert.match(String(revokeTrustedDevice.headers.get("set-cookie") || ""), /Max-Age=0/);
    const sessionsAfterDeviceRevoke = await fetch(`${origin}/api/terminal/sessions`, {
      headers: { authorization, cookie: deviceCookie }
    });
    assert.equal(sessionsAfterDeviceRevoke.status, 403);

    const automationUnauthenticated = await fetch(`${origin}/api/automation/projects`);
    assert.equal(automationUnauthenticated.status, 401);

    const automationProjects = await fetch(`${origin}/api/automation/projects`, {
      headers: { authorization }
    });
    assert.equal(automationProjects.status, 200);
    const automationProjectPayload = await automationProjects.json();
    assert.equal(Array.isArray(automationProjectPayload.projects), true);
    assert.equal(JSON.stringify(automationProjectPayload).includes('"path"'), false);

    const automationMutationMissingOrigin = await fetch(`${origin}/api/automation/tasks`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        project: "missing-project",
        agent: "build",
        task: "test",
        backend: "opencode"
      })
    });
    assert.equal(automationMutationMissingOrigin.status, 403);

    const automationMutationSameOrigin = await fetch(`${origin}/api/automation/tasks`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "automation-auth-boundary"
      },
      body: JSON.stringify({
        project: "missing-project",
        agent: "build",
        task: "test",
        backend: "opencode"
      })
    });
    assert.equal(automationMutationSameOrigin.status, 404);

    const upload = await fetch(`${origin}/api/codex/upload`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "opaque-upload-test"
      },
      body: JSON.stringify({
        name: "tiny.txt",
        type: "text/plain",
        data: "data:text/plain;base64,aGVsbG8="
      })
    });
    assert.equal(upload.status, 200);
    const uploadPayload = await upload.json();
    assert.match(String(uploadPayload.uploadId || ""), /^[0-9a-f-]{36}$/i);
    assert.equal(Object.hasOwn(uploadPayload, "path"), false);

    const directPathAttachment = await fetch(`${origin}/api/codex/rpc`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-pocket-operation-id": "direct-path-rejection"
      },
      body: JSON.stringify({
        method: "turn/start",
        params: {
          threadId: "thread-does-not-matter",
          input: [{ type: "localImage", path: "/etc/passwd" }]
        }
      })
    });
    assert.equal(directPathAttachment.status, 400);
    const directPathPayload = await directPathAttachment.json();
    assert.match(String(directPathPayload.error || ""), /Direct attachment paths are not accepted/);

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
