import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerSessionStore } from "../server/owner-session-store.mjs";
import { PasskeyAuth } from "../server/passkey-auth.mjs";
import { ExternalAuth } from "../server/external-auth.mjs";

const sessionInput = { ownerId: "owner", host: "localhost", identity: { provider: "local", subject: "devmoter" } };
async function directory(t) {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-auth-availability-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  return configDir;
}

test("unknown logout tokens do not write the registry; real revocation remains durable", async t => {
  const configDir = await directory(t);
  const store = new OwnerSessionStore({ configDir });
  const { token } = await store.create(sessionInput);
  const persist = store.persist.bind(store);
  let writes = 0;
  store.persist = async sessions => { writes++; return persist(sessions); };
  const before = await readFile(store.file, "utf8");
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.revoke(`unrecognized-fixture-${i}`)));
  assert.equal(writes, 0);
  assert.equal(await readFile(store.file, "utf8"), before);
  assert.equal(await store.revoke(token), true);
  assert.equal(writes, 1);
  assert.equal(await new OwnerSessionStore({ configDir }).get(token, "localhost"), null);
  assert.equal(await store.revoke(token), false);
  assert.equal(writes, 1, "repeated logout is also a no-op");
});

test("unknown logout still durably cleans up expired sessions", async t => {
  const configDir = await directory(t);
  let now = 1_800_000_000_000;
  const store = new OwnerSessionStore({ configDir, ttlMs: 60_000, now: () => now });
  await store.create(sessionInput);
  now += 60_001;
  assert.equal(await store.revoke("unrecognized-fixture"), false);
  assert.deepEqual(JSON.parse(await readFile(store.file, "utf8")).sessions, []);
});

test("concurrent public Passkey ceremonies are bounded without evicting active challenges", async t => {
  const configDir = await directory(t);
  await writeFile(join(configDir, "passkeys.json"), JSON.stringify({
    version: 2, userId: Buffer.alloc(32, 7).toString("base64url"), credentials: [{
      id: "availability-fixture", rpId: "localhost", publicKey: "AQIDBA", counter: 0, transports: ["internal"]
    }]
  }), { mode: 0o600 });
  const auth = new PasskeyAuth({ configDir, ownerAuthorized: async () => true });
  const req = { headers: { host: "localhost:8787", origin: "http://localhost:8787" }, socket: { remoteAddress: "127.0.0.1" } };
  const results = await Promise.allSettled(Array.from({ length: 140 }, () => auth.loginOptions(req)));
  const admitted = results.filter(result => result.status === "fulfilled");
  assert.equal(admitted.length, 128);
  assert.equal(auth.challenges.size, 128);
  for (const result of results.filter(result => result.status === "rejected")) assert.equal(result.reason.status, 429);
  const firstId = admitted[0].value.challengeId;
  await assert.rejects(auth.registrationOptions(req), error => error.status === 429);
  assert.equal(auth.challenges.has(firstId), true);
  auth.challenges.get(firstId).expiresAt = 0;
  const next = await auth.loginOptions(req);
  assert.equal(auth.challenges.size, 128);
  assert.equal(auth.challenges.has(firstId), false);
  assert.equal(auth.challenges.has(next.challengeId), true);
});

test("GitHub admission includes in-flight starts and releases reservations on failure", async t => {
  const configDir = await directory(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0, settled = 0, fail = false;
  const auth = new ExternalAuth({ configDir, githubClientId: "fixture-client", fetchImpl: async () => {
    calls++;
    await gate;
    if (fail) throw new Error("fixture provider unavailable");
    return { ok: true, json: async () => ({ device_code: "fixture-device", user_code: "FIXT-1234", verification_uri: "https://github.com/login/device", expires_in: 900 }) };
  } });
  const ownerId = await auth.identities.ensureOwner();
  await auth.identities.bindProvider("github", { subject: "1", login: "fixture" }, { ownerId });
  for (let i = 0; i < 127; i++) auth.githubFlows.set(`fixture-${i}`, { expiresAt: Date.now() + 900_000 });
  const req = { headers: { host: "localhost" } };
  const pending = Promise.allSettled([auth.startGithub(req), auth.startGithub(req)].map(promise => promise.finally(() => settled++)));
  try {
    for (let i = 0; i < 200 && calls + settled < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 1, "only the remaining slot may start provider I/O");
  } finally { release(); }
  const results = await pending;
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 429);
  assert.equal(auth.githubFlows.size, 128);
  assert.equal(auth.githubStarts, 0);
  auth.githubFlows.get("fixture-0").expiresAt = 0;
  fail = true;
  await assert.rejects(auth.startGithub(req), error => error.status === 502);
  assert.equal(auth.githubStarts, 0);
  fail = false;
  await auth.startGithub(req);
  assert.equal(auth.githubFlows.size, 128);
});
