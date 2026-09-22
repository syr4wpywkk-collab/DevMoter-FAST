import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystemFeatures } from "../server/system-features.mjs";

function localRequest(token = "") {
  return {
    headers: {
      host: "127.0.0.1:8787",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
}

test("device bootstrap, pairing, listing, and revocation use opaque tokens", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-system-"));
  const features = createSystemFeatures({
    stateDir,
    appRoot: process.cwd(),
    host: "127.0.0.1",
    version: "test",
    getProjects: async () => [],
    getBackendHealth: async () => ({ opencode: { online: true }, codex: { online: true } })
  });

  try {
    const first = await features.bootstrapDevice(localRequest(), "Laptop");
    assert.ok(first.token.length > 20);
    const pairing = await features.createPairing(localRequest(first.token));
    assert.match(pairing.code, /^\d{6}$/);

    const second = await features.claimPairing(pairing.code, "Phone");
    const list = await features.listDevices(localRequest(first.token));
    assert.equal(list.devices.length, 2);
    assert.equal(list.devices.some(device => Object.hasOwn(device, "tokenHash")), false);

    const revoked = await features.revokeDevice(localRequest(first.token), second.device.id);
    assert.equal(revoked.revokedCurrentDevice, false);
    await assert.rejects(
      features.listDevices(localRequest(second.token)),
      /Invalid or revoked device token/
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
