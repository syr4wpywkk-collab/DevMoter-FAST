import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystemFeatures, systemFeatureInternals } from "../server/system-features.mjs";

function request({ token = "", host = "127.0.0.1:8787", remoteAddress = "127.0.0.1", authorization = "" } = {}) {
  return {
    headers: {
      host,
      ...(token ? { "x-devmoter-device-token": token } : {}),
      ...(authorization ? { authorization } : {})
    },
    socket: { remoteAddress }
  };
}

test("IPv6 localhost bootstrap, pairing, list and revoke use a separate opaque device token", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-system-v3-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const revokedCallbacks = [];
  const features = createSystemFeatures({
    stateDir,
    appRoot: process.cwd(),
    host: "::1",
    version: "test",
    getProjects: async () => [],
    getBackendHealth: async () => ({ opencode: { online: true }, codex: { online: true } }),
    pushSender: async () => ({ ok: true, status: 201 }),
    onDeviceRevoked: async deviceId => { revokedCallbacks.push(deviceId); }
  });

  assert.equal(systemFeatureInternals.requestHostname(request({ host: "[::1]:8787" })), "::1");
  assert.equal(systemFeatureInternals.isLocalBootstrapRequest(request({ host: "[::1]:8787", remoteAddress: "::1" })), true);

  const first = await features.bootstrapDevice(
    request({ host: "[::1]:8787", remoteAddress: "::1" }),
    "Laptop"
  );
  assert.ok(first.token.length > 20);

  await assert.rejects(
    features.listDevices(request({ authorization: `Bearer ${first.token}` })),
    /Trusted device token required/
  );

  const pairing = await features.createPairing(request({ token: first.token }));
  assert.match(pairing.code, /^\d{6}$/);
  const second = await features.claimPairing(pairing.code, "Phone");
  assert.equal(await features.isDeviceActive(second.device.id), true);
  const list = await features.listDevices(request({ token: first.token }));
  assert.equal(list.devices.length, 2);
  assert.equal(list.devices.some(device => Object.hasOwn(device, "tokenHash")), false);

  const revoked = await features.revokeDevice(request({ token: first.token }), second.device.id);
  assert.equal(revoked.revokedCurrentDevice, false);
  assert.equal(await features.isDeviceActive(second.device.id), false);
  assert.deepEqual(revokedCallbacks, [second.device.id]);
  await assert.rejects(features.listDevices(request({ token: second.token })), /Invalid or revoked/);
});

test("concurrent bootstrap is single-winner and revoking a pairing approver invalidates pending codes", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-device-race-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const features = createSystemFeatures({
    stateDir,
    appRoot: process.cwd(),
    version: "test",
    getProjects: async () => [],
    getBackendHealth: async () => ({ opencode: { online: true }, codex: { online: true } })
  });

  const bootstrapResults = await Promise.allSettled([
    features.bootstrapDevice(request(), "Laptop A"),
    features.bootstrapDevice(request(), "Laptop B")
  ]);
  assert.equal(bootstrapResults.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(bootstrapResults.filter(result => result.status === "rejected").length, 1);
  const first = bootstrapResults.find(result => result.status === "fulfilled").value;
  const pairing = await features.createPairing(request({ token: first.token }));
  await features.revokeDevice(request({ token: first.token }), first.device.id);
  await assert.rejects(features.claimPairing(pairing.code, "Phone"), /invalid or expired|pairing device has been revoked/i);

  const replacement = await features.bootstrapDevice(request(), "Recovery browser");
  assert.equal(await features.isDeviceActive(replacement.device.id), true);
});

test("server-side push is generic, deep-linked, opt-in, and suppressed for a visible session", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-push-v3-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const sent = [];
  const features = createSystemFeatures({
    stateDir,
    appRoot: process.cwd(),
    version: "test",
    getProjects: async () => [],
    getBackendHealth: async () => ({ opencode: { online: true }, codex: { online: true } }),
    pushSender: async subscription => {
      sent.push(subscription.endpoint);
      return { ok: true, status: 201 };
    }
  });

  const first = await features.bootstrapDevice(request(), "Laptop");
  const trusted = request({ token: first.token });
  const endpoint = "https://push.example.test/device-1";

  await features.subscribePush(trusted, { endpoint });
  await features.updateVisibility(trusted, { endpoint, sessionId: "thread-1", visible: true });
  const suppressed = await features.notifyAgentState({
    backend: "codex",
    sessionId: "thread-1",
    state: "completed"
  });
  assert.equal(suppressed.sent, 0);
  assert.equal(sent.length, 0);

  await features.updateVisibility(trusted, { endpoint, sessionId: "thread-1", visible: false });
  const delivered = await features.notifyAgentState({
    backend: "codex",
    sessionId: "thread-1",
    state: "waiting_for_approval"
  });
  assert.equal(delivered.sent, 1);
  assert.deepEqual(sent, [endpoint]);

  const pending = await features.takePendingPush({ endpoint });
  assert.equal(pending.notification.title, "DevMoter");
  assert.equal(pending.notification.body, "Approval needed");
  assert.match(pending.notification.url, /backend=codex/);
  assert.match(pending.notification.url, /session=thread-1/);
  assert.deepEqual(
    Object.keys(pending.notification).sort(),
    ["body", "createdAt", "title", "url"]
  );
});


test("malformed persisted device state fails closed instead of allowing a new bootstrap", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-state-failclosed-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "devices.json"), "{not-json");

  const features = createSystemFeatures({
    stateDir,
    appRoot: process.cwd(),
    version: "test",
    getProjects: async () => [],
    getBackendHealth: async () => ({ opencode: { online: true }, codex: { online: true } }),
    pushSender: async () => ({ ok: true, status: 201 })
  });

  await assert.rejects(
    features.bootstrapDevice(request(), "Laptop"),
    /unreadable or malformed/i
  );
});
