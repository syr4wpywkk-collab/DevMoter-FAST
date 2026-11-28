import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePairingQR, isPairingToken } from "../server/pairing-qr.mjs";
import { createSystemFeatures } from "../server/system-features.mjs";

test("QR is locally generated from a strict HTTPS origin, using an opaque 256-bit token", () => {
  for (const bad of ["http://localhost", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?q=x", "https://example.test/#x"]) assert.equal(makePairingQR(bad), null);
  const first = makePairingQR("https://example.test:8443"), second = makePairingQR("https://example.test:8443");
  assert.ok(isPairingToken(first.token));
  assert.notEqual(first.token, second.token);
  assert.equal(first.url, "https://example.test:8443/#devmoter-pair=" + first.token);
  assert.match(first.dataUrl, /^data:image\/gif;base64,/);
  assert.equal(Buffer.from(first.dataUrl.split(",")[1], "base64").subarray(0, 3).toString(), "GIF");
});

test("QR and manual code share single use, expiry and existing trusted-device authorization", async t => {
  const stateDir = await mkdtemp(join(tmpdir(), "devmoter-qr-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  let current = Date.now();
  const features = createSystemFeatures({stateDir, getProjects: async () => [], getBackendHealth: async () => ({}), now: () => current});
  const local = { headers: {host: "localhost"}, socket: {remoteAddress: "127.0.0.1"} };
  const trusted = await features.bootstrapDevice(local, "Owner");
  const remote = (host, cookie = "") => ({headers: {host, cookie}, socket: {remoteAddress: "100.64.0.2", encrypted: true}});
  const issuer = remote("example.test", "devmoter_device=" + trusted.token);
  const receiver = remote("example.test");
  await assert.rejects(features.createPairing(receiver), {status: 401});
  const created = await features.createPairing(issuer);
  const token = new URL(created.pairingUrl).hash.split("=")[1];
  await assert.rejects(features.claimPairing(token, "Other origin", remote("other.test")), {status: 400});
  const claims = await Promise.allSettled([features.claimPairing(token,"Phone",receiver),features.claimPairing(created.code,"Manual replay",receiver)]);
  assert.equal(claims.filter(x => x.status === "fulfilled").length,1);
  assert.equal(claims.filter(x => x.status === "rejected").length,1);
  const next = await features.createPairing(issuer);
  current = next.expiresAt;
  await assert.rejects(features.claimPairing(new URL(next.pairingUrl).hash.split("=")[1],"Expired",receiver),{status:400});
  const manual = await features.createPairing({...local,headers:{host:"localhost",cookie:"devmoter_device="+trusted.token}});
  assert.equal(manual.pairingUrl,undefined);
  assert.match(manual.code,/^\d{6}$/);
});
