import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStore } from "../server/secret-store.mjs";

const PASSPHRASE = "correct horse battery staple for DevMoter";

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "devmoter-secret-store-"));
  const store = createSecretStore({ filePath: join(directory, "vault.json") });
  try { await run({ directory, store, filePath: join(directory, "vault.json") }); }
  finally { await store.lock(); await rm(directory, { recursive: true, force: true }); }
}

test("secret vault encrypts values at rest and returns metadata without secret material", async () => {
  await withStore(async ({ store, filePath }) => {
    assert.deepEqual(await store.status(), { initialized: false, unlocked: false, count: null });
    await store.initialize(PASSPHRASE);
    const metadata = await store.set({
      provider: "openrouter",
      name: "personal",
      value: "sk-live-secret-value",
      purpose: "API Chat",
      envName: "OPENROUTER_API_KEY",
      projectIds: ["project-1"]
    });

    assert.equal(metadata.reference, "secret://openrouter/personal");
    assert.equal(metadata.provider, "openrouter");
    assert.equal(metadata.envName, "OPENROUTER_API_KEY");
    assert.equal("value" in metadata, false);
    const stored = await readFile(filePath, "utf8");
    assert.equal(stored.includes("sk-live-secret-value"), false);
    assert.equal(stored.includes("OPENROUTER_API_KEY"), false);
    if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);

    await store.lock();
    assert.deepEqual(await store.status(), { initialized: true, unlocked: false, count: null });
    await assert.rejects(() => store.list(), /locked/);
    await store.unlock(PASSPHRASE);
    const [listed] = await store.list();
    assert.equal(listed.reference, metadata.reference);
    assert.equal("value" in listed, false);
    assert.equal(await store.resolve(metadata.reference, { provider: "openrouter", projectId: "project-1" }), "sk-live-secret-value");
    assert.equal((await store.list())[0].lastUsedAt > 0, true);
  });
});

test("secret vault rejects wrong passphrases, invalid references, and project/provider scope mismatches", async () => {
  await withStore(async ({ store }) => {
    await store.initialize(PASSPHRASE);
    await store.set({ provider: "anthropic", name: "work", value: "secret-value", projectIds: ["work-project"] });
    await store.set({ provider: "anthropic", name: "unbound", value: "other-secret" });
    await store.lock();
    await assert.rejects(() => store.unlock("wrong passphrase"), /could not be unlocked/);
    await store.unlock(PASSPHRASE);
    await assert.rejects(() => store.resolve("secret://anthropic/work", { provider: "openai", projectId: "work-project" }), /provider binding/);
    await assert.rejects(() => store.resolve("secret://anthropic/work", { provider: "anthropic", projectId: "personal-project" }), /not bound/);
    await assert.rejects(() => store.resolve("secret://anthropic/unbound", { provider: "anthropic", projectId: "work-project" }), /not bound/);
    await assert.rejects(() => store.resolve("secret://anthropic/work", { projectId: "work-project" }), /provider binding/);
    await assert.rejects(() => store.set({ provider: "../outside", name: "x", value: "bad" }), /invalid/);
    await assert.rejects(() => store.set({ provider: "x", name: "y", value: "\0" }), /invalid, empty, or too large/);
  });
});

test("secret vault detects duplicate values, replaces and deletes by opaque reference", async () => {
  await withStore(async ({ store }) => {
    await store.initialize(PASSPHRASE);
    await store.set({ provider: "openai", name: "primary", value: "shared" });
    await store.set({ provider: "openai", name: "backup", value: "shared" });
    assert.equal((await store.list()).every(item => item.duplicate), true);
    await store.set({ provider: "openai", name: "backup", value: "rotated" });
    assert.equal((await store.list()).find(item => item.name === "backup").duplicate, false);
    await store.remove("secret://openai/primary");
    assert.deepEqual((await store.list()).map(item => item.reference), ["secret://openai/backup"]);
    await assert.rejects(() => store.remove("secret://openai/missing"), /not found/);
  });
});

test("secret vault fails closed on broad file permissions and authenticated-data corruption", async () => {
  await withStore(async ({ store, filePath }) => {
    await store.initialize(PASSPHRASE);
    await store.lock();
    await chmod(filePath, 0o644);
    await assert.rejects(() => store.unlock(PASSPHRASE), /permissions are too broad/);
    await chmod(filePath, 0o600);
    const envelope = JSON.parse(await readFile(filePath, "utf8"));
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    await writeFile(filePath, JSON.stringify(envelope), { mode: 0o600 });
    await assert.rejects(() => store.unlock(PASSPHRASE), /could not be unlocked/);
  });
});

test("secret vault refuses to initialize over existing data and rejects a symlinked store", async () => {
  await withStore(async ({ directory, store, filePath }) => {
    const unrelated = join(directory, "existing.json");
    await writeFile(unrelated, "{}", { mode: 0o600 });
    await assert.rejects(() => createSecretStore({ filePath: unrelated }).initialize(PASSPHRASE), /already initialized/);
    await symlink(unrelated, filePath);
    await assert.rejects(() => store.initialize(PASSPHRASE), /symbolic link|too many levels|ELOOP/i);
  });
});
