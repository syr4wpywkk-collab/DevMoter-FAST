import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const recoveryPassword = "auth-v2-recovery-fixture-123";
const recovery = { username: "devmoter", password: recoveryPassword };
const providerEnv = {
  DEVMOTER_GOOGLE_CLIENT_ID: "google-test-client-id",
  DEVMOTER_GOOGLE_CLIENT_SECRET: "google-test-client-secret",
  DEVMOTER_MICROSOFT_CLIENT_ID: "microsoft-test-client-id",
  DEVMOTER_MICROSOFT_CLIENT_SECRET: "microsoft-test-client-secret",
  DEVMOTER_MICROSOFT_TENANT: "common"
};

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 10_000) {
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

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2500))]);
  if (child.exitCode === null && child.signalCode === null) {
    const killed = once(child, "exit");
    child.kill("SIGKILL");
    await killed;
  }
}

function startServer({ home, port, passkeyRequired = false, publicOrigin = `http://127.0.0.1:${port}`, bindHost = "127.0.0.1" }) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: bindHost,
      POCKET_PORT: String(port),
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: recoveryPassword,
      DEVMOTER_PUBLIC_ORIGIN: publicOrigin,
      DEVMOTER_PASSKEY_REQUIRED: passkeyRequired ? "1" : "0",
      ...providerEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.resume();
  return child;
}

function cookieFrom(response, name = "devmoter_session") {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  const line = cookies.find(value => value.startsWith(`${name}=`));
  assert.ok(line, `expected ${name} cookie; received ${cookies.join(" | ")}`);
  return line.split(";", 1)[0];
}

async function localLogin(origin, cookie = "") {
  const response = await fetch(`${origin}/api/auth/local/login`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(recovery)
  });
  return response;
}

async function seedPasskey(home) {
  const configDir = join(home, ".config", "opencode-pocket");
  const credential = {
    id: "auth-v2-integration-credential",
    rpId: "127.0.0.1",
    publicKey: Buffer.from([1, 2, 3, 4]).toString("base64url"),
    counter: 0,
    transports: ["internal"],
    deviceType: "multiDevice",
    backedUp: true,
    label: "integration fixture",
    createdAt: Date.now(),
    lastUsedAt: 0
  };
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const file = join(configDir, "passkeys.json");
  await writeFile(file, JSON.stringify({
    version: 2,
    userId: Buffer.alloc(32, 7).toString("base64url"),
    credentials: [credential]
  }), { mode: 0o600 });
  await chmod(file, 0o600);
}

test("owner session survives a real server restart and logout revokes the persistent cookie", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-auth-v2-restart-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child = startServer({ home, port, publicOrigin: "", bindHost: "0.0.0.0" });
  let ownerCookie;

  try {
    await waitForReady(child);
    const login = await localLogin(origin);
    assert.equal(login.status, 200);
    ownerCookie = cookieFrom(login);
    assert.match(ownerCookie, /^devmoter_session=/);

    const registryPath = join(home, ".config", "opencode-pocket", "auth-sessions.json");
    const beforeRestart = await readFile(registryPath, "utf8");
    const token = decodeURIComponent(ownerCookie.slice(ownerCookie.indexOf("=") + 1));
    assert.equal(beforeRestart.includes(token), false, "raw owner token must not be persisted");
    assert.match(beforeRestart, /"tokenHash"\s*:\s*"[a-f0-9]{64}"/);

    await stop(child);
    child = startServer({ home, port, publicOrigin: "", bindHost: "0.0.0.0" });
    await waitForReady(child);
    const status = await fetch(`${origin}/api/auth/status`, { headers: { cookie: ownerCookie } });
    assert.equal(status.status, 200);
    const statusPayload = await status.json();
    assert.equal(statusPayload.authenticated, true);
    assert.equal(statusPayload.ownerAuthenticated, true);

    const differentHost = await fetch(`http://127.0.0.2:${port}/api/auth/status`, { headers: { cookie: ownerCookie } });
    assert.equal(differentHost.status, 200);
    assert.equal((await differentHost.json()).authenticated, false, "owner cookie must stay bound to its original host");

    const logout = await fetch(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { origin, cookie: ownerCookie }
    });
    assert.equal(logout.status, 200);
    assert.match(String(logout.headers.get("set-cookie") || ""), /devmoter_session=.*Max-Age=0/);
    assert.match(String(logout.headers.get("set-cookie") || ""), /devmoter_passkey=.*Max-Age=0/);
    const fileAfterLogout = await readFile(registryPath, "utf8");
    assert.equal(JSON.parse(fileAfterLogout).sessions.length, 0);

    await stop(child);
    child = startServer({ home, port });
    await waitForReady(child);
    const loggedOut = await fetch(`${origin}/api/auth/status`, { headers: { cookie: ownerCookie } });
    assert.equal(loggedOut.status, 200);
    assert.equal((await loggedOut.json()).authenticated, false);
    const revokedApi = await fetch(`${origin}/api/projects`, { headers: { cookie: ownerCookie } });
    assert.equal(revokedApi.status, 401);
  } finally {
    await stop(child);
    await rm(home, { recursive: true, force: true });
  }
});

test("public auth status and passkey login routes preserve auth, origin, and provider boundaries", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-auth-v2-public-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = startServer({ home, port, publicOrigin: origin });

  try {
    await waitForReady(child);
    const loginScript = await fetch(`${origin}/login.js`, { redirect: "manual" });
    assert.equal(loginScript.status, 200, "login script must be public before owner authentication");
    assert.match(String(loginScript.headers.get("content-type") || ""), /javascript/);
    assert.match(await loginScript.text(), /loadStatus/);

    const noOwner = await fetch(`${origin}/api/auth/account`);
    assert.equal(noOwner.status, 401);
    const basic = `Basic ${Buffer.from(`devmoter:${recoveryPassword}`).toString("base64")}`;
    const basicAccount = await fetch(`${origin}/api/auth/account`, { headers: { authorization: basic } });
    assert.equal(basicAccount.status, 200);

    const statusResponse = await fetch(`${origin}/api/auth/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.authenticated, false);
    assert.equal(status.providers.google.configured, true);
    assert.equal(status.providers.microsoft.configured, true);
    assert.equal(JSON.stringify(status).includes(providerEnv.DEVMOTER_GOOGLE_CLIENT_SECRET), false);
    assert.equal(JSON.stringify(status).includes(providerEnv.DEVMOTER_MICROSOFT_CLIENT_SECRET), false);

    const passkeyStatus = await fetch(`${origin}/api/auth/passkey/status`);
    assert.equal(passkeyStatus.status, 200);
    const passkeyLoginOptions = await fetch(`${origin}/api/auth/passkey/login/options`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(passkeyLoginOptions.status, 400, "no credential should produce an ordinary ceremony error, not auth 401");

    const unboundLogin = await fetch(`${origin}/api/auth/google/start`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ intent: "login" })
    });
    assert.equal(unboundLogin.status, 403);
    const unboundMicrosoftLogin = await fetch(`${origin}/api/auth/microsoft/start`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ intent: "login" })
    });
    assert.equal(unboundMicrosoftLogin.status, 403);
    const unauthenticatedLink = await fetch(`${origin}/api/auth/google/start`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ intent: "link" })
    });
    assert.equal(unauthenticatedLink.status, 401);

    const noOriginLoginOptions = await fetch(`${origin}/api/auth/passkey/login/options`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    });
    assert.equal(noOriginLoginOptions.status, 403);
    const crossOriginLoginOptions = await fetch(`${origin}/api/auth/passkey/login/options`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(crossOriginLoginOptions.status, 403);

    const unauthenticatedRegistration = await fetch(`${origin}/api/auth/passkey/register/options`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}"
    });
    assert.equal(unauthenticatedRegistration.status, 401);
    const crossOriginRegistration = await fetch(`${origin}/api/auth/passkey/register/options`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(crossOriginRegistration.status, 403);
  } finally {
    await stop(child);
    await rm(home, { recursive: true, force: true });
  }
});

test("owner account lists safe session metadata and revokes other sessions", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-auth-v2-sessions-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child = startServer({ home, port });

  try {
    await waitForReady(child);
    const first = await localLogin(origin);
    assert.equal(first.status, 200);
    const currentCookie = cookieFrom(first);
    const second = await localLogin(origin);
    assert.equal(second.status, 200);
    const otherCookie = cookieFrom(second);

    const accountResponse = await fetch(`${origin}/api/auth/account`, { headers: { cookie: currentCookie } });
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.equal(typeof account.ownerId, "string");
    assert.ok(account.sessions.length >= 2);
    const current = account.sessions.find(session => session.current);
    const other = account.sessions.find(session => !session.current);
    assert.ok(current && other);
    assert.equal(current.provider, "local");
    assert.equal(typeof current.host, "string");
    assert.equal(typeof current.createdAt, "number");
    assert.equal(typeof current.lastUsedAt, "number");
    assert.equal(typeof current.expiresAt, "number");
    assert.equal(Object.hasOwn(current, "tokenHash"), false);
    assert.equal(Object.hasOwn(other, "token"), false);
    const serialized = JSON.stringify(account);
    assert.equal(serialized.includes(decodeURIComponent(currentCookie.split("=", 2)[1])), false);
    assert.equal(serialized.includes(decodeURIComponent(otherCookie.split("=", 2)[1])), false);

    const revoked = await fetch(`${origin}/api/auth/sessions/${encodeURIComponent(other.id)}`, {
      method: "DELETE", headers: { origin, cookie: currentCookie }
    });
    assert.equal(revoked.status, 200);
    const otherStatus = await fetch(`${origin}/api/auth/status`, { headers: { cookie: otherCookie } });
    const otherStatusPayload = await otherStatus.json();
    assert.equal(otherStatusPayload.authenticated, false, JSON.stringify(otherStatusPayload));

    const revokeOthers = await fetch(`${origin}/api/auth/sessions/revoke-others`, {
      method: "POST", headers: { origin, cookie: currentCookie }
    });
    assert.equal(revokeOthers.status, 200);
    const stillCurrent = await fetch(`${origin}/api/auth/status`, { headers: { cookie: currentCookie } });
    assert.equal((await stillCurrent.json()).authenticated, true);

    const registry = JSON.parse(await readFile(join(home, ".config", "opencode-pocket", "auth-sessions.json"), "utf8"));
    assert.equal(registry.sessions.length, 1);
    assert.equal(registry.sessions.some(session => Object.hasOwn(session, "token")), false);

    const revokeCurrent = await fetch(`${origin}/api/auth/sessions/${encodeURIComponent(current.id)}`, {
      method: "DELETE", headers: { origin, cookie: currentCookie }
    });
    assert.equal(revokeCurrent.status, 200);
    assert.equal((await revokeCurrent.json()).revoked, true);
    const clearedCookies = revokeCurrent.headers.getSetCookie?.() || [revokeCurrent.headers.get("set-cookie") || ""];
    assert.match(clearedCookies.join(";"), /devmoter_session=.*Max-Age=0/);
    assert.match(clearedCookies.join(";"), /devmoter_passkey=.*Max-Age=0/);
    const emptyRegistry = JSON.parse(await readFile(join(home, ".config", "opencode-pocket", "auth-sessions.json"), "utf8"));
    assert.equal(emptyRegistry.sessions.length, 0);

    await stop(child);
    child = startServer({ home, port });
    await waitForReady(child);
    const revokedAfterRestart = await fetch(`${origin}/api/auth/status`, { headers: { cookie: currentCookie } });
    assert.equal((await revokedAfterRestart.json()).authenticated, false);
  } finally {
    await stop(child);
    await rm(home, { recursive: true, force: true });
  }
});

test("passkey ceremony remains available before owner login while registration and required mode stay gated", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-auth-v2-passkey-"));
  await seedPasskey(home);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = startServer({ home, port, passkeyRequired: true });

  try {
    await waitForReady(child);
    const options = await fetch(`${origin}/api/auth/passkey/login/options`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}"
    });
    assert.equal(options.status, 200, "passkey options must be reachable before an owner session exists");
    const optionsPayload = await options.json();
    assert.ok(optionsPayload.publicKey.challenge);
    assert.equal(optionsPayload.publicKey.rpId, "127.0.0.1");

    const local = await localLogin(origin);
    const ownerCookie = cookieFrom(local);
    const gated = await fetch(`${origin}/api/projects`, { headers: { cookie: ownerCookie } });
    assert.equal(gated.status, 401, "required mode still requires a passkey step-up");

    const registration = await fetch(`${origin}/api/auth/passkey/register/options`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}"
    });
    assert.equal(registration.status, 401, "registration must remain unavailable before owner authentication");
  } finally {
    await stop(child);
    await rm(home, { recursive: true, force: true });
  }
});
