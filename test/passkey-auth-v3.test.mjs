import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PasskeyAuth } from "../server/passkey-auth.mjs";

function request({
  host = "localhost:8787",
  origin = "http://localhost:8787",
  remoteAddress = "127.0.0.1",
  cookie = ""
} = {}) {
  return {
    headers: { host, origin, cookie },
    socket: { remoteAddress }
  };
}

test("registration options are generated for true loopback and reject proxy-only bootstrap", async () => {
  const previous = process.env.DEVMOTER_PASSKEY_BOOTSTRAP;
  delete process.env.DEVMOTER_PASSKEY_BOOTSTRAP;
  const dir = await mkdtemp(join(tmpdir(), "devmoter-passkey-v3-"));
  const auth = new PasskeyAuth({ configDir: dir });

  try {
    const local = await auth.registrationOptions(request());
    assert.equal(local.publicKey.rp.id, "localhost");
    assert.equal(local.publicKey.authenticatorSelection.userVerification, "required");
    assert.ok(local.publicKey.challenge);

    await assert.rejects(
      () => auth.registrationOptions(request({
        host: "mari-opencode.example.test",
        origin: "https://mari-opencode.example.test",
        remoteAddress: "127.0.0.1"
      })),
      /requires localhost/
    );
  } finally {
    if (previous === undefined) delete process.env.DEVMOTER_PASSKEY_BOOTSTRAP;
    else process.env.DEVMOTER_PASSKEY_BOOTSTRAP = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy client-supplied public-key registration is rejected before persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-passkey-v3-"));
  const auth = new PasskeyAuth({ configDir: dir });
  const req = request();

  try {
    const options = await auth.registrationOptions(req);
    await assert.rejects(
      () => auth.verifyRegistration(req, {
        challengeId: options.challengeId,
        credentialId: "attacker-chosen",
        publicKey: "attacker-chosen",
        algorithm: -7,
        clientDataJSON: "attacker-chosen"
      }),
      /standards-compliant WebAuthn registration response/i
    );

    const state = JSON.parse(await readFile(join(dir, "passkeys.json"), "utf8"));
    assert.equal(state.credentials.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed passkey registry fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-passkey-v3-"));
  await writeFile(join(dir, "passkeys.json"), "{bad-json");
  const auth = new PasskeyAuth({ configDir: dir });

  try {
    await assert.rejects(
      () => auth.status(request()),
      /refusing to fail open/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("once any passkey exists, an unrelated host cannot bypass the optional gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-passkey-v3-"));
  const fakeKey = Buffer.from([1, 2, 3, 4]).toString("base64url");
  await writeFile(join(dir, "passkeys.json"), JSON.stringify({
    version: 2,
    userId: Buffer.alloc(32, 7).toString("base64url"),
    credentials: [{
      id: "credential-one",
      rpId: "localhost",
      publicKey: fakeKey,
      counter: 0,
      transports: ["internal"],
      deviceType: "multiDevice",
      backedUp: true,
      label: "test",
      createdAt: Date.now(),
      lastUsedAt: 0
    }]
  }));
  const auth = new PasskeyAuth({ configDir: dir });

  try {
    const gate = await auth.require(request({
      host: "other.example.test",
      origin: "https://other.example.test",
      remoteAddress: "127.0.0.1"
    }));
    assert.equal(gate.required, true);
    assert.equal(gate.authenticated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
