import test from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

test("first passkey registration requires a true loopback browser origin", async () => {
  const previous = process.env.DEVMOTER_PASSKEY_BOOTSTRAP;
  delete process.env.DEVMOTER_PASSKEY_BOOTSTRAP;
  const dir = await mkdtemp(join(tmpdir(), "devmoter-passkey-"));
  const auth = new PasskeyAuth({ configDir: dir });

  try {
    const local = await auth.registrationOptions(request());
    assert.equal(local.publicKey.rp.id, "localhost");

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

test("passkey registration and assertion verify challenge, origin, RP hash, UV, and signature", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-passkey-"));
  const auth = new PasskeyAuth({ configDir: dir });
  const req = request();

  try {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const spki = publicKey.export({ type: "spki", format: "der" });
    const credentialId = b64url(randomBytes(32));

    const registration = await auth.registrationOptions(req);
    const createClientData = Buffer.from(JSON.stringify({
      type: "webauthn.create",
      challenge: registration.publicKey.challenge,
      origin: "http://localhost:8787"
    }));

    const registered = await auth.verifyRegistration(req, {
      challengeId: registration.challengeId,
      credentialId,
      clientDataJSON: b64url(createClientData),
      publicKey: b64url(spki),
      algorithm: -7,
      transports: ["internal"]
    });
    assert.match(registered.cookie, /^devmoter_passkey=/);

    const login = await auth.loginOptions(req);
    assert.equal(login.publicKey.rpId, "localhost");
    assert.equal(login.publicKey.allowCredentials[0].id, credentialId);

    const getClientData = Buffer.from(JSON.stringify({
      type: "webauthn.get",
      challenge: login.publicKey.challenge,
      origin: "http://localhost:8787"
    }));
    const rpHash = createHash("sha256").update("localhost").digest();
    const flags = Buffer.from([0x05]);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(1);
    const authenticatorData = Buffer.concat([rpHash, flags, counter]);
    const clientHash = createHash("sha256").update(getClientData).digest();
    const signature = sign("sha256", Buffer.concat([authenticatorData, clientHash]), privateKey);

    const loggedIn = await auth.verifyLogin(req, {
      challengeId: login.challengeId,
      credentialId,
      clientDataJSON: b64url(getClientData),
      authenticatorData: b64url(authenticatorData),
      signature: b64url(signature)
    });
    assert.match(loggedIn.cookie, /^devmoter_passkey=/);

    const cookie = loggedIn.cookie.split(";")[0];
    const status = await auth.status(request({ cookie }));
    assert.equal(status.authenticated, true);
    assert.equal(status.credentialCount, 1);

    const alternateHostGate = await auth.require(request({
      host: "other.example.test",
      origin: "https://other.example.test",
      remoteAddress: "127.0.0.1"
    }));
    assert.equal(alternateHostGate.required, true);
    assert.equal(alternateHostGate.authenticated, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
