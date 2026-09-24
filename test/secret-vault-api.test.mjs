import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createSecretVaultApi } from "../server/secret-vault-api.mjs";

function request(method = "GET", body = "") {
  const req = new EventEmitter();
  req.method = method;
  req.consumed = false;
  req[Symbol.asyncIterator] = async function* () {
    req.consumed = true;
    if (body) yield Buffer.from(body);
  };
  return req;
}

function response() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); }
  };
}

function url(path) {
  return new URL(`http://localhost${path}`);
}

test("Secret Vault API denies requests without an active trusted device before reading bodies", async () => {
  const api = createSecretVaultApi({
    store: { status: async () => ({ initialized: false, unlocked: false, count: null }) },
    authenticateDevice: async () => null,
    resolveProject: async () => ({ id: "project-1" })
  });
  const req = request("POST", JSON.stringify({ passphrase: "never-read" }));
  const res = response();

  assert.equal(await api.handle(req, res, url("/api/secrets/initialize")), true);
  assert.equal(res.status, 401);
  assert.equal(req.consumed, false);
  assert.deepEqual(res.body, { error: "Trusted device required" });
});

test("Secret Vault API preserves trusted-device authentication status", async () => {
  const api = createSecretVaultApi({
    store: {},
    authenticateDevice: async () => { throw Object.assign(new Error("Device revoked"), { status: 401 }); },
    resolveProject: async () => ({ id: "project-1" })
  });
  const res = response();
  await api.handle(request(), res, url("/api/secrets/status"));
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { error: "Device revoked" });
});

test("Secret Vault API returns metadata only and requires registered project bindings", async () => {
  let storedInput = null;
  const metadata = [];
  let resolveCalls = 0;
  let secretResolveCalls = 0;
  const api = createSecretVaultApi({
    store: {
      set: async input => {
        storedInput = input;
        const result = { reference: `secret://${input.provider}/${input.name}`, provider: input.provider, name: input.name, projectIds: input.projectIds };
        const index = metadata.findIndex(item => item.reference === result.reference);
        if (index >= 0) metadata[index] = result;
        else metadata.push(result);
        return result;
      },
      list: async () => metadata,
      resolve: async () => { secretResolveCalls += 1; return "raw-secret"; }
    },
    authenticateDevice: async () => ({ id: "paired-device-1" }),
    resolveProject: async id => {
      resolveCalls += 1;
      if (id !== "project-1") throw new Error("Project not found");
      return { id };
    }
  });

  const valid = response();
  await api.handle(request("PUT", JSON.stringify({
    provider: "openai", name: "main", value: "sk-test-secret", projectIds: ["project-1"]
  })), valid, url("/api/secrets"));
  assert.equal(valid.status, 200);
  assert.deepEqual(valid.body.secret, {
    reference: "secret://openai/main", provider: "openai", name: "main", projectIds: ["project-1"]
  });
  assert.equal(JSON.stringify(valid.body).includes("sk-test-secret"), false);
  assert.equal(resolveCalls, 1);
  assert.deepEqual(storedInput.projectIds, ["project-1"]);

  const overwrite = response();
  await api.handle(request("PUT", JSON.stringify({
    provider: "openai", name: "main", value: "replacement", projectIds: ["project-1"]
  })), overwrite, url("/api/secrets"));
  assert.equal(overwrite.status, 409);
  assert.equal(storedInput.value, "sk-test-secret");

  const confirmedOverwrite = response();
  await api.handle(request("PUT", JSON.stringify({
    provider: "openai", name: "main", value: "replacement", projectIds: ["project-1"], confirmReplace: true
  })), confirmedOverwrite, url("/api/secrets"));
  assert.equal(confirmedOverwrite.status, 200);
  assert.equal("confirmReplace" in storedInput, false);

  const callsBeforeUnbound = resolveCalls;
  const unbound = response();
  await api.handle(request("PUT", JSON.stringify({ provider: "openai", name: "orphan", value: "secret", projectIds: [] })), unbound, url("/api/secrets"));
  assert.equal(unbound.status, 400);
  assert.equal(resolveCalls, callsBeforeUnbound);

  const unknownProject = response();
  await api.handle(request("PUT", JSON.stringify({ provider: "openai", name: "orphan", value: "secret", projectIds: ["missing"] })), unknownProject, url("/api/secrets"));
  assert.equal(unknownProject.status, 400);
  assert.equal(storedInput.name, "main");

  const expose = response();
  await api.handle(request("POST", "{}"), expose, url("/api/secrets/resolve"));
  assert.equal(expose.status, 404);
  assert.equal(secretResolveCalls, 0);
});

test("Secret Vault deletion requires confirmation for the exact reference", async () => {
  const removed = [];
  const api = createSecretVaultApi({
    store: { remove: async reference => { removed.push(reference); return { ok: true }; } },
    authenticateDevice: async () => ({ id: "paired-device-1" }),
    resolveProject: async () => ({ id: "project-1" })
  });

  const denied = response();
  await api.handle(request("DELETE", "{}"), denied, url("/api/secrets/openai/main"));
  assert.equal(denied.status, 400);
  assert.deepEqual(removed, []);

  const allowed = response();
  await api.handle(request("DELETE", JSON.stringify({ confirmReference: "secret://openai/main" })), allowed, url("/api/secrets/openai/main"));
  assert.equal(allowed.status, 200);
  assert.deepEqual(removed, ["secret://openai/main"]);
});

test("Secret Vault unlock attempts are bounded per trusted device", async () => {
  let now = 1000;
  const api = createSecretVaultApi({
    store: { unlock: async () => { throw new Error("Vault could not be unlocked; passphrase or encrypted data is invalid."); } },
    authenticateDevice: async () => ({ id: "paired-device-1" }),
    resolveProject: async () => ({ id: "project-1" }),
    now: () => now
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = response();
    await api.handle(request("POST", JSON.stringify({ passphrase: "wrong" })), res, url("/api/secrets/unlock"));
    assert.equal(res.status, 400);
  }
  const limited = response();
  await api.handle(request("POST", JSON.stringify({ passphrase: "wrong" })), limited, url("/api/secrets/unlock"));
  assert.equal(limited.status, 429);

  now += 10 * 60_000;
  const afterWindow = response();
  await api.handle(request("POST", JSON.stringify({ passphrase: "wrong" })), afterWindow, url("/api/secrets/unlock"));
  assert.equal(afterWindow.status, 400);
});

test("Secret Vault API rejects oversized bodies and does not return passphrases", async () => {
  let receivedPassphrase = null;
  const api = createSecretVaultApi({
    store: {
      initialize: async passphrase => {
        receivedPassphrase = passphrase;
        return { initialized: true, unlocked: true };
      }
    },
    authenticateDevice: async () => ({ id: "paired-device-1" }),
    resolveProject: async () => ({ id: "project-1" })
  });
  const passphrase = "correct horse battery staple";
  const initialized = response();
  await api.handle(request("POST", JSON.stringify({ passphrase })), initialized, url("/api/secrets/initialize"));
  assert.equal(receivedPassphrase, passphrase);
  assert.equal(JSON.stringify(initialized.body).includes(passphrase), false);

  const oversized = response();
  await api.handle(request("PUT", JSON.stringify({ value: "x".repeat(300_000) })), oversized, url("/api/secrets"));
  assert.equal(oversized.status, 413);
});
