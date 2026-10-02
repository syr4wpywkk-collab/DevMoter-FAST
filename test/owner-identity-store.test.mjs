import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnerIdentityStore } from "../server/owner-identity-store.mjs";

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-owner-identities-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("owner identity store migrates v1 GitHub binding once and preserves the owner", async t => {
  const dir = await tempDir(t);
  const file = join(dir, "auth-identities.json");
  await writeFile(file, JSON.stringify({ version: 1, github: {
    subject: "gh-321", login: "owner", name: "Owner", avatarUrl: "https://img.test/a", boundAt: 123
  }}), { mode: 0o600 });
  const store = createOwnerIdentityStore({ configDir: dir });
  const first = await store.load();
  const second = await createOwnerIdentityStore({ configDir: dir }).load();
  assert.equal(first.ownerId, second.ownerId);
  assert.equal(first.providers.github.subject, "gh-321");
  assert.equal(first.providers.github.login, "owner");
  assert.equal(first.providers.google, null);
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 2);
  if (process.platform !== "win32") assert.equal((await lstat(file)).mode & 0o777, 0o600);
});

test("owner can bind multiple providers; identity metadata is whitelisted and collision rejected", async t => {
  const dir = await tempDir(t);
  const store = createOwnerIdentityStore({ configDir: dir, now: () => 500 });
  const ownerId = await store.ensureOwner();
  const github = await store.bindProvider("github", {
    subject: "42", login: "octo", name: "Octo", accessToken: "do-not-store", refresh_token: "secret"
  }, { ownerId });
  const google = await store.bindProvider("google", {
    subject: "google-sub", issuer: "https://accounts.google.com", email: "owner@example.test", email_verified: true
  }, { ownerId });
  assert.equal(github.boundAt, 500);
  assert.equal(google.subject, "google-sub");
  assert.equal(await store.findOwner("google", "google-sub", { issuer: "https://accounts.google.com" }), ownerId);
  assert.equal(await store.findOwner("google", "owner@example.test", { issuer: "https://accounts.google.com" }), null);
  await assert.rejects(store.bindProvider("github", { subject: "other", login: "other" }, { ownerId }), /different account/);
  const disk = await readFile(store.filePath, "utf8");
  assert.doesNotMatch(disk, /do-not-store|refresh_token|email_verified/);
  assert.match(disk, /owner@example.test/);
});

test("concurrent bind and unbind operations are serialized and owner mismatch is rejected", async t => {
  const dir = await tempDir(t);
  const a = createOwnerIdentityStore({ configDir: dir });
  const b = createOwnerIdentityStore({ configDir: dir });
  const ownerId = await a.ensureOwner();
  await Promise.all([
    a.bindProvider("google", { subject: "g-1", issuer: "issuer" }, { ownerId }),
    b.bindProvider("microsoft", { subject: "m-1", issuer: "issuer", tenantId: "tenant" }, { ownerId })
  ]);
  const state = await a.load();
  assert.equal(state.providers.google.subject, "g-1");
  assert.equal(state.providers.microsoft.subject, "m-1");
  await assert.rejects(a.bindProvider("microsoft", { subject: "m-1", issuer: "issuer", tenantId: "other-tenant" }, { ownerId }), /different account/);
  await assert.rejects(a.unbindProvider("google", { ownerId: "wrong-owner" }), /authentication is required/);
  await a.unbindProvider("google", { ownerId });
  assert.equal((await b.load()).providers.google, null);
});

test("corrupt and insecure identity registry fail closed", async t => {
  const dir = await tempDir(t);
  const file = join(dir, "auth-identities.json");
  await writeFile(file, "{broken", { mode: 0o600 });
  const store = createOwnerIdentityStore({ configDir: dir });
  await assert.rejects(store.load(), /malformed|unreadable/);
  await writeFile(file, JSON.stringify({ version: 2, ownerId: null, providers: { github: null, google: null, microsoft: null } }), { mode: 0o600 });
  if (process.platform !== "win32") {
    await chmod(file, 0o644);
    await assert.rejects(store.load(), /permissions/);
  }
});

test("registry symlink is rejected", async t => {
  if (process.platform === "win32") return t.skip("symlink permissions differ on Windows");
  const dir = await tempDir(t);
  const target = join(dir, "target.json");
  const linkPath = join(dir, "auth-identities.json");
  await writeFile(target, JSON.stringify({ version: 1, github: null }), { mode: 0o600 });
  await symlink(target, linkPath);
  await assert.rejects(createOwnerIdentityStore({ configDir: dir }).load());
});
