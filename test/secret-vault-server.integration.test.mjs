import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "integration-auth-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DevMoter Secret Vault server did not become ready: ${output}`)), 8000);
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
      reject(new Error(`DevMoter Secret Vault server exited with ${code}: ${output}`));
    });
  });
}

test("Secret Vault HTTP API requires trusted devices and never returns secret values", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-secret-vault-api-"));
  const projectPath = join(home, "workspace");
  await mkdir(projectPath);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CODEX_CWD: projectPath,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => {});
    await rm(home, { recursive: true, force: true });
  });

  await waitForReady(child);
  const endpoint = path => `${origin}/api/secrets${path}`;
  const mutation = (cookie, operationId, extra = {}) => ({
    authorization,
    origin,
    "content-type": "application/json",
    "x-pocket-operation-id": operationId,
    ...(cookie ? { cookie } : {}),
    ...extra
  });

  const noDevice = await fetch(endpoint("/status"), { headers: { authorization } });
  assert.equal(noDevice.status, 401);

  const missingOrigin = await fetch(endpoint("/initialize"), {
    method: "POST",
    headers: { authorization, "content-type": "application/json", "x-pocket-operation-id": "vault-no-origin" },
    body: JSON.stringify({ passphrase: "never processed" })
  });
  assert.equal(missingOrigin.status, 403);

  const bootstrap = await fetch(`${origin}/api/devices/bootstrap`, {
    method: "POST",
    headers: { authorization, origin, "content-type": "application/json", "x-pocket-operation-id": "vault-device-bootstrap" },
    body: JSON.stringify({ label: "Vault Test" })
  });
  assert.equal(bootstrap.status, 201);
  const paired = await bootstrap.json();
  const deviceCookie = String(bootstrap.headers.get("set-cookie") || "").split(";", 1)[0];
  const deviceId = paired.device.id;
  assert.match(deviceCookie, /^devmoter_device=/);
  assert.equal(Object.hasOwn(paired, "token"), false);
  assert.equal(Object.hasOwn(paired.device, "tokenHash"), false);

  const crossOrigin = await fetch(endpoint("/initialize"), {
    method: "POST",
    headers: mutation(deviceCookie, "vault-cross-origin", { origin: "https://attacker.example" }),
    body: JSON.stringify({ passphrase: "cross origin must not work" })
  });
  assert.equal(crossOrigin.status, 403);

  const projectResponse = await fetch(`${origin}/api/projects`, { headers: { authorization } });
  assert.equal(projectResponse.status, 200);
  const projectId = (await projectResponse.json()).projects[0].id;
  const passphrase = "correct horse battery staple for DevMoter Vault";

  const initialized = await fetch(endpoint("/initialize"), {
    method: "POST",
    headers: mutation(deviceCookie, "vault-initialize"),
    body: JSON.stringify({ passphrase })
  });
  assert.equal(initialized.status, 200);
  assert.equal(JSON.stringify(await initialized.json()).includes(passphrase), false);

  const value = "sk-test-never-return-this-value";
  const saved = await fetch(endpoint(""), {
    method: "PUT",
    headers: mutation(deviceCookie, "vault-set"),
    body: JSON.stringify({
      provider: "openai",
      name: "integration",
      value,
      purpose: "integration test",
      projectIds: [projectId]
    })
  });
  assert.equal(saved.status, 200);
  const savedPayload = await saved.json();
  assert.equal(savedPayload.secret.reference, "secret://openai/integration");
  assert.equal(JSON.stringify(savedPayload).includes(value), false);

  const overwriteWithoutConfirmation = await fetch(endpoint(""), {
    method: "PUT",
    headers: mutation(deviceCookie, "vault-overwrite-without-confirmation"),
    body: JSON.stringify({
      provider: "openai", name: "integration", value: "replacement-value", projectIds: [projectId]
    })
  });
  assert.equal(overwriteWithoutConfirmation.status, 409);

  const listed = await fetch(endpoint(""), { headers: { authorization, cookie: deviceCookie } });
  assert.equal(listed.status, 200);
  const listedPayload = await listed.json();
  assert.equal(listedPayload.secrets[0].projectIds[0], projectId);
  assert.equal(JSON.stringify(listedPayload).includes(value), false);

  const unbound = await fetch(endpoint(""), {
    method: "PUT",
    headers: mutation(deviceCookie, "vault-set-unbound"),
    body: JSON.stringify({ provider: "openai", name: "unbound", value, projectIds: [] })
  });
  assert.equal(unbound.status, 400);

  const publicResolve = await fetch(endpoint("/resolve"), {
    method: "POST",
    headers: mutation(deviceCookie, "vault-no-resolve"),
    body: JSON.stringify({ reference: "secret://openai/integration", projectId, provider: "openai" })
  });
  assert.equal(publicResolve.status, 404);

  const storeFile = join(home, ".local", "share", "devmoter-fast", "secrets", "vault.json");
  assert.equal((await readFile(storeFile, "utf8")).includes(value), false);

  const deleteWithoutConfirmation = await fetch(endpoint("/openai/integration"), {
    method: "DELETE",
    headers: mutation(deviceCookie, "vault-delete-without-confirmation")
  });
  assert.equal(deleteWithoutConfirmation.status, 400);
  const deleted = await fetch(endpoint("/openai/integration"), {
    method: "DELETE",
    headers: mutation(deviceCookie, "vault-delete-confirmed"),
    body: JSON.stringify({ confirmReference: "secret://openai/integration" })
  });
  assert.equal(deleted.status, 200);

  const revoked = await fetch(`${origin}/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    headers: mutation(deviceCookie, "vault-revoke-device")
  });
  assert.equal(revoked.status, 200);
  assert.match(String(revoked.headers.get("set-cookie") || ""), /Max-Age=0/);
  const afterRevoke = await fetch(endpoint("/status"), {
    headers: { authorization, cookie: deviceCookie }
  });
  assert.equal(afterRevoke.status, 401);
});
