import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "integration-auth-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;
const secretValue = "vault-provider-key-must-never-return";

async function freePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child) {
  let output = "";
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    throw new Error(`DevMoter Vault provider server exited before startup: ${stderr || output}`);
  }
  await new Promise((resolve, reject) => {
    const fail = error => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error(`DevMoter Vault provider server did not become ready: ${output}\n${stderr}`)), 8000);
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
      fail(new Error(`DevMoter Vault provider server exited with ${code}: ${output}\n${stderr}`));
    });
    child.once("error", error => fail(new Error(`Could not start DevMoter Vault provider server: ${error.message}\n${stderr}`)));
  });
}

test("API Chat resolves Vault-backed credentials only for the paired device and bound project", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-multi-api-vault-"));
  const projectPath = join(home, "workspace");
  await mkdir(projectPath);
  const port = await freePort();
  const upstreamPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;
  let upstreamMode = "success";
  const seenAuthorization = [];
  const seenRequestBodies = [];
  const upstream = createHttpServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    seenAuthorization.push(req.headers.authorization || req.headers["x-api-key"] || "");
    seenRequestBodies.push(body);
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") {
      if (upstreamMode === "echo-error") {
        res.writeHead(401).end(JSON.stringify({ error: { message: `Upstream echoed ${secretValue}` } }));
        return;
      }
      res.end(JSON.stringify({ data: [{ id: "vault-model" }] }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: `echo:${secretValue}` } }] }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

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
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => {});
    }
    await new Promise(resolve => upstream.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  await waitForReady(child);

  const json = async (path, { cookie = "", method = "GET", body, operationId = `vault-provider-${crypto.randomUUID()}` } = {}) => {
    const headers = {
      authorization,
      origin,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" ? { "x-pocket-operation-id": operationId } : {}),
      ...(cookie ? { cookie } : {})
    };
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { response, payload: await response.json().catch(() => ({})) };
  };

  const noDeviceSave = await json("/api/llm/providers", {
    method: "POST",
    body: { credentialMode: "vault", presetId: "openai", secretRef: "secret://openai/main", projectId: "project-one" }
  });
  assert.equal(noDeviceSave.response.status, 401);

  const bootstrap = await json("/api/devices/bootstrap", {
    method: "POST",
    body: { label: "Vault API Chat integration" }
  });
  assert.equal(bootstrap.response.status, 201);
  const deviceCookie = String(bootstrap.response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(deviceCookie, /^devmoter_device=/);
  assert.equal(Object.hasOwn(bootstrap.payload, "token"), false);
  assert.equal(Object.hasOwn(bootstrap.payload.device, "tokenHash"), false);
  const projects = await json("/api/projects");
  const projectId = projects.payload.projects[0].id;
  const legacyKey = "legacy-provider-key-to-migrate";
  const legacySave = await json("/api/llm/providers", {
    method: "POST",
    body: {
      id: "legacy-openai", presetId: "openai", name: "Legacy OpenAI", protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1", apiKey: legacyKey, models: ["legacy-model"]
    }
  });
  assert.equal(legacySave.response.status, 200);
  const noDeviceMigration = await json("/api/llm/providers/legacy-openai/migrate-to-vault", {
    method: "POST", body: { projectId, confirm: true }
  });
  assert.equal(noDeviceMigration.response.status, 401);
  const lockedMigration = await json("/api/llm/providers/legacy-openai/migrate-to-vault", { cookie: deviceCookie, method: "POST", body: { projectId, confirm: true }
  });
  assert.equal(lockedMigration.response.status, 409);
  const passphrase = "a correct and sufficiently long vault passphrase";
  const initialize = await json("/api/secrets/initialize", { cookie: deviceCookie, method: "POST", body: { passphrase } });
  assert.equal(initialize.response.status, 200);
  const wrongProjectMigration = await json("/api/llm/providers/legacy-openai/migrate-to-vault", { cookie: deviceCookie, method: "POST", body: { projectId: "not-a-project", confirm: true }
  });
  assert.equal(wrongProjectMigration.response.status, 400);
  const unconfirmedMigration = await json("/api/llm/providers/legacy-openai/migrate-to-vault", { cookie: deviceCookie, method: "POST", body: { projectId, confirm: false }
  });
  assert.equal(unconfirmedMigration.response.status, 400);
  const migratedLegacy = await json("/api/llm/providers/legacy-openai/migrate-to-vault", { cookie: deviceCookie, method: "POST", body: { projectId, confirm: true }
  });
  assert.equal(migratedLegacy.response.status, 200);
  assert.equal(migratedLegacy.payload.provider.credentialSource, "vault");
  assert.equal(migratedLegacy.payload.provider.projectId, projectId);
  assert.match(migratedLegacy.payload.provider.secretRef, /^secret:\/\/openai\/api-chat-[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(migratedLegacy.payload).includes(legacyKey), false);
  const repeatMigration = await json("/api/llm/providers/legacy-openai/migrate-to-vault", { cookie: deviceCookie, method: "POST", body: { projectId, confirm: true }
  });
  assert.equal(repeatMigration.response.status, 409);
  const providerConfigDirectory = join(home, ".config", "opencode-pocket");
  const migratedFile = await readFile(join(providerConfigDirectory, "llm-providers.json"), "utf8");
  assert.equal(migratedFile.includes(legacyKey), false);
  assert.equal(migratedFile.includes('"apiKey"'), false);
  assert.equal(migratedFile.includes(migratedLegacy.payload.provider.secretRef), true);
  const vaultMetadata = await json("/api/secrets", { cookie: deviceCookie });
  const migratedMetadata = vaultMetadata.payload.secrets.find(item => item.reference === migratedLegacy.payload.provider.secretRef);
  assert.ok(migratedMetadata);
  assert.deepEqual(migratedMetadata.projectIds, [projectId]);

  const setSecret = await json("/api/secrets", { cookie: deviceCookie, method: "PUT",
    body: { provider: "openai", name: "main", value: secretValue, projectIds: [projectId] }
  });
  assert.equal(setSecret.response.status, 200);

  const wrongPreset = await json("/api/llm/providers", { cookie: deviceCookie, method: "POST",
    body: {
      credentialMode: "vault", presetId: "gemini", name: "Mismatched provider", protocol: "openai-compatible",
      baseUrl: `${upstreamOrigin}/v1`, secretRef: "secret://openai/main", projectId, models: ["vault-model"]
    }
  });
  assert.equal(wrongPreset.response.status, 403);

  const customEndpoint = await json("/api/llm/providers", { cookie: deviceCookie, method: "POST",
    body: {
      credentialMode: "vault", presetId: "custom", name: "Custom endpoint", protocol: "openai-compatible",
      baseUrl: `${upstreamOrigin}/v1`, secretRef: "secret://openai/main", projectId, models: ["vault-model"]
    }
  });
  assert.equal(customEndpoint.response.status, 403);

  const overriddenPresetEndpoint = await json("/api/llm/providers", { cookie: deviceCookie, method: "POST",
    body: {
      credentialMode: "vault", presetId: "openai", name: "Overridden endpoint", protocol: "openai-compatible",
      baseUrl: `${upstreamOrigin}/v1`, secretRef: "secret://openai/main", projectId, models: ["vault-model"]
    }
  });
  assert.equal(overriddenPresetEndpoint.response.status, 403);

  const unknownReference = await json("/api/llm/providers", { cookie: deviceCookie, method: "POST",
    body: {
      credentialMode: "vault", presetId: "openai", name: "Unknown reference", protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1", secretRef: "secret://openai/missing", projectId, models: ["vault-model"]
    }
  });
  assert.equal(unknownReference.response.status, 403);

  const saveProvider = await json("/api/llm/providers", { cookie: deviceCookie, method: "POST",
    body: {
      credentialMode: "vault",
      presetId: "openai",
      name: "OpenAI Vault",
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      secretRef: "secret://openai/main",
      projectId,
      models: ["vault-model"]
    }
  });
  assert.equal(saveProvider.response.status, 200);
  assert.equal(saveProvider.payload.provider.ready, true);
  assert.equal(saveProvider.payload.provider.secretRef, "secret://openai/main");
  assert.equal(JSON.stringify(saveProvider.payload).includes(secretValue), false);
  const providerId = saveProvider.payload.provider.id;

  const noDeviceDelete = await json(`/api/llm/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" });
  assert.equal(noDeviceDelete.response.status, 401);

  const list = await json("/api/llm/providers");
  const publicProvider = list.payload.providers.find(item => item.id === providerId);
  assert.equal(publicProvider.credentialSource, "vault");
  assert.equal(publicProvider.secretRef, "secret://openai/main");
  assert.equal(JSON.stringify(list.payload).includes(secretValue), false);

  const noDeviceChat = await json("/api/llm/chat", {
    method: "POST",
    body: { providerId, projectId, model: "vault-model", messages: [{ role: "user", content: "hello" }] }
  });
  assert.equal(noDeviceChat.response.status, 401);

  const wrongProjectChat = await json("/api/llm/chat", { cookie: deviceCookie, method: "POST",
    body: { providerId, projectId: "another-project", model: "vault-model", messages: [{ role: "user", content: "hello" }] }
  });
  assert.equal(wrongProjectChat.response.status, 403);

  const noDeviceTest = await json("/api/llm/test", {
    method: "POST",
    body: {
      presetId: "openai", name: "OpenAI", protocol: "openai-compatible", baseUrl: `${upstreamOrigin}/v1`,
      secretRef: "secret://openai/main", projectId, models: []
    }
  });
  assert.equal(noDeviceTest.response.status, 401);

  const arbitraryEndpointTest = await json("/api/llm/test", { cookie: deviceCookie, method: "POST",
    body: {
      presetId: "openai", name: "OpenAI", protocol: "openai-compatible", baseUrl: `${upstreamOrigin}/v1`,
      secretRef: "secret://openai/main", projectId, models: []
    }
  });
  assert.equal(arbitraryEndpointTest.response.status, 403);
  assert.equal(seenAuthorization.length, 0);
  assert.equal(seenRequestBodies.length, 0);

  const providerFile = join(home, ".config", "opencode-pocket", "llm-providers.json");
  const disk = await readFile(providerFile, "utf8");
  assert.equal(disk.includes(secretValue), false);
  assert.equal(disk.includes('"apiKey"'), false);
  assert.equal(disk.includes("secret://openai/main"), true);
});
