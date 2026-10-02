import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerSessionStore } from "../server/owner-session-store.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-owner-sessions-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const options = { ownerId: "owner-1", host: "DevMoter.Test", identity: { provider: "local", subject: "devmoter", login: "devmoter" } };

test("owner sessions persist only token hashes and survive store recreation", async t => {
  const configDir = await fixture(t);
  const first = new OwnerSessionStore({ configDir });
  const created = await first.create(options);
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.session.host, "devmoter.test");

  const second = new OwnerSessionStore({ configDir });
  const restored = await second.get(created.token, "devmoter.test");
  assert.equal(restored?.id, created.session.id);
  assert.equal(restored.ownerId, "owner-1");
  assert.equal("tokenHash" in restored, false);
  const contents = await readFile(join(configDir, "auth-sessions.json"), "utf8");
  assert.equal(contents.includes(created.token), false);
  assert.equal((await lstat(join(configDir, "auth-sessions.json"))).mode & 0o777, 0o600);
  assert.equal((await lstat(configDir)).mode & 0o777, 0o700);
});

test("routine authentication coalesces last-used writes while revocation remains durable", async t => {
  const configDir = await fixture(t);
  let time = 1_800_000_000_000;
  const store = new OwnerSessionStore({ configDir, now: () => time });
  const { token } = await store.create(options);
  const file = join(configDir, "auth-sessions.json");
  const initial = await readFile(file, "utf8");

  time += 60_000;
  assert.ok(await store.get(token, "devmoter.test"));
  assert.equal((await store.list({ ownerId: "owner-1", currentToken: token })).length, 1);
  assert.equal(await readFile(file, "utf8"), initial, "hot-path auth checks should not rewrite the session registry");

  time += 5 * 60_000;
  const touched = await store.get(token, "devmoter.test");
  const afterTouch = await readFile(file, "utf8");
  assert.notEqual(afterTouch, initial, "last-used metadata should eventually be checkpointed");
  assert.equal(JSON.parse(afterTouch).sessions[0].lastUsedAt, time);
  assert.equal(touched.lastUsedAt, time);

  assert.equal(await store.revoke(token), true);
  assert.equal(JSON.parse(await readFile(file, "utf8")).sessions.length, 0, "revocation must persist immediately");
});

test("logout revoke survives restart and sessions are host-bound", async t => {
  const configDir = await fixture(t);
  const store = new OwnerSessionStore({ configDir });
  const { token } = await store.create(options);
  assert.equal(await store.get(token, "other.test"), null);
  assert.equal(await new OwnerSessionStore({ configDir }).get(token, "devmoter.test") !== null, true);
  assert.equal(await store.revoke(token), true);
  assert.equal(await new OwnerSessionStore({ configDir }).get(token, "devmoter.test"), null);
});

test("expired entries are removed during lookup and rejected after restart", async t => {
  const configDir = await fixture(t);
  let time = 1_800_000_000_000;
  const store = new OwnerSessionStore({ configDir, ttlMs: 60_000, now: () => time });
  const { token } = await store.create(options);
  time += 60_001;
  assert.equal(await store.get(token, "devmoter.test"), null);
  assert.deepEqual(await new OwnerSessionStore({ configDir, now: () => time }).list({ ownerId: "owner-1" }), []);
});

test("corrupt or unsafe registry fails closed", async t => {
  const configDir = await fixture(t);
  const file = join(configDir, "auth-sessions.json");
  await writeFile(file, "not json", { mode: 0o600 });
  await assert.rejects(new OwnerSessionStore({ configDir }).ready(), /corrupt|invalid/i);

  const other = await mkdtemp(join(tmpdir(), "devmoter-owner-symlink-"));
  t.after(() => rm(other, { recursive: true, force: true }));
  const linkedDir = join(other, "linked");
  await (await import("node:fs/promises")).mkdir(linkedDir);
  await writeFile(join(other, "target.json"), JSON.stringify({ version: 1, sessions: [] }), { mode: 0o600 });
  await symlink(join(other, "target.json"), join(linkedDir, "auth-sessions.json"));
  await assert.rejects(new OwnerSessionStore({ configDir: linkedDir }).ready(), /unsafe/i);
});

test("listing and revocation expose safe metadata and protect owner boundaries", async t => {
  const configDir = await fixture(t);
  const first = new OwnerSessionStore({ configDir });
  const current = await first.create(options);
  const other = await first.create({ ...options, identity: { provider: "google", subject: "google-sub" } });
  const listed = await first.list({ ownerId: "owner-1", currentToken: current.token });
  assert.equal(listed.length, 2);
  assert.equal(listed.find(session => session.current).id, current.session.id);
  assert.equal(JSON.stringify(listed).includes(current.token), false);
  assert.equal(await first.revokeById(other.session.id, { ownerId: "wrong-owner" }), false);
  assert.equal(await first.revokeById(current.session.id, { ownerId: "owner-1", currentToken: current.token }), true);
  assert.equal(await first.get(current.token, "devmoter.test"), null);
  assert.equal(await first.revokeProvider("owner-1", "google"), 1);
  assert.equal(await first.revokeOthers({ ownerId: "owner-1", currentToken: current.token }), 0);
});

test("concurrent store instances serialize mutations and enforce bounded retention", async t => {
  const configDir = await fixture(t);
  const stores = Array.from({ length: 3 }, () => new OwnerSessionStore({ configDir, maxSessions: 2 }));
  const created = await Promise.all(stores.map((store, index) => store.create({ ...options, identity: { provider: "local", subject: `user-${index}` } })));
  const sessions = await new OwnerSessionStore({ configDir }).list({ ownerId: "owner-1" });
  assert.equal(sessions.length, 2);
  assert.equal(await chmod(join(configDir, "auth-sessions.json"), 0o600).then(() => true), true);
  assert.ok(created.every(item => item.token));
});

test("persisted identity corruption and unexpected secret fields fail closed", async t => {
  const configDir = await fixture(t);
  const store = new OwnerSessionStore({ configDir });
  await store.create(options);
  const file = join(configDir, "auth-sessions.json");
  const valid = JSON.parse(await readFile(file, "utf8"));
  for (const identity of [{}, { provider: "local", subject: "" }, { provider: "google", subject: "devmoter" }, { ...options.identity, accessToken: "must-not-persist" }]) {
    const invalid = structuredClone(valid);
    invalid.sessions[0].identity = identity;
    await writeFile(file, JSON.stringify(invalid), { mode: 0o600 });
    await assert.rejects(new OwnerSessionStore({ configDir }).ready(), /invalid state/i);
  }
});
