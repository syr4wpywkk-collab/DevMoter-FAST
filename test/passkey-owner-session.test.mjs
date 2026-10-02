import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeCBOR } from "@levischuck/tiny-cbor";
import { ExternalAuth } from "../server/external-auth.mjs";
import { PasskeyAuth } from "../server/passkey-auth.mjs";
const digest = input => createHash("sha256").update(input).digest();
const req = (cookie = "", origin = "https://devmoter.test") => ({ headers: { host: new URL(origin).host, origin, cookie }, socket: {} });

test("a cryptographically verified passkey alone issues a durable Owner session with UV and replay protection", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-passkey-owner-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]]));
  const id = randomBytes(32).toString("base64url");
  await writeFile(join(configDir, "passkeys.json"), JSON.stringify({ version: 2, userId: randomBytes(32).toString("base64url"), credentials: [{
    id, rpId: "devmoter.test", publicKey: Buffer.from(cose).toString("base64url"), counter: 0, createdAt: Date.now(), label: "test authenticator"
  }] }), { mode: 0o600 });
  const owner = new ExternalAuth({ configDir });
  const auth = new PasskeyAuth({ configDir, sessionIssuer: request => owner.passkeyLogin(request), sessionResolver: request => owner.session(request), ownerAuthorized: async request => Boolean(await owner.session(request)) });
  await assert.rejects(() => auth.registrationOptions(req()), /Owner authentication/);
  const options = await auth.loginOptions(req());
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.publicKey.challenge, origin: "https://devmoter.test", crossOrigin: false }));
  const counter = Buffer.alloc(4); counter.writeUInt32BE(1);
  const authenticatorData = Buffer.concat([digest("devmoter.test"), Buffer.from([0x05]), counter]);
  const response = { id, rawId: id, type: "public-key", clientExtensionResults: {}, response: {
    clientDataJSON: clientDataJSON.toString("base64url"), authenticatorData: authenticatorData.toString("base64url"),
    signature: sign("sha256", Buffer.concat([authenticatorData, digest(clientDataJSON)]), privateKey).toString("base64url"), userHandle: null
  } };
  const result = await auth.verifyLogin(req(), { challengeId: options.challengeId, response });
  assert.match(result.cookie, /^devmoter_session=/);
  assert.doesNotMatch(result.cookie, /devmoter_passkey/);
  const cookie = result.cookie.split(";", 1)[0];
  const restarted = new ExternalAuth({ configDir });
  const session = await restarted.session(req(cookie));
  assert.equal(session.identity.provider, "passkey");
  assert.equal(session.assurance, "passkey");
  assert.equal((await restarted.status(req(cookie))).authenticated, true);
  await assert.rejects(() => auth.verifyLogin(req(), { challengeId: options.challengeId, response }), /challenge expired or invalid/);
  assert.equal(await restarted.session(req(cookie, "https://other.test")), null);
  const stored = JSON.parse(await readFile(join(configDir, "passkeys.json"), "utf8"));
  assert.equal(stored.credentials[0].counter, 1);
  await restarted.logout(req(cookie));
  assert.equal(await new ExternalAuth({ configDir }).session(req(cookie)), null);
});

test("passkey registry symlinks and unsafe permissions fail closed", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-passkey-private-")); t.after(() => rm(configDir, { recursive: true, force: true }));
  const path = join(configDir, "passkeys.json");
  await writeFile(path, JSON.stringify({ version: 2, userId: "user", credentials: [] })); await chmod(path, 0o644);
  await assert.rejects(() => new PasskeyAuth({ configDir }).load(), /refusing to fail open/);
  await unlink(path);
  const target = join(configDir, "target.json");
  await writeFile(target, JSON.stringify({ version: 2, userId: "user", credentials: [] }), { mode: 0o600 });
  await symlink(target, path);
  await assert.rejects(() => new PasskeyAuth({ configDir }).load(), /refusing to fail open/);
});
