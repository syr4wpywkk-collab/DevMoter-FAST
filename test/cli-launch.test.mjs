import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCliReady, inspectCli, inspectKnownClis } from "../server/cli-launch.mjs";

async function tempPath() {
  return mkdtemp(join(tmpdir(), "devmoter-cli-launch-"));
}

test("inspectCli reports a missing command with install instructions", async () => {
  const result = await inspectCli("codex", { env: { PATH: "/nonexistent-devmoter-path" } });
  assert.equal(result.presence, "missing");
  assert.equal(result.code, "not_installed");
  assert.match(result.message, /codex が見つからないよ。入れ方: npm install -g @openai\/codex/);
});

test("inspectCli separates a non-executable file from a missing one", async () => {
  const dir = await tempPath();
  const bin = join(dir, "codex");
  await writeFile(bin, "#!/bin/sh\necho 1\n");
  await chmod(bin, 0o644);
  const result = await inspectCli(bin, { env: { PATH: dir } });
  assert.equal(result.code, "not_executable");
  assert.equal(result.presence, "broken");
  assert.match(result.message, /実行できないよ/);
});

test("inspectCli reports a CLI that cannot print a version as broken", async () => {
  const dir = await tempPath();
  const bin = join(dir, "opencode");
  await writeFile(bin, "#!/bin/sh\nexit 1\n");
  await chmod(bin, 0o755);
  const result = await inspectCli("opencode", { env: { PATH: dir } });
  assert.equal(result.code, "failed");
  assert.equal(result.presence, "broken");
  assert.match(result.message, /動いてないよ/);
});

test("inspectCli returns ready when the command is executable and versioned", async () => {
  const dir = await tempPath();
  const bin = join(dir, "codex");
  await writeFile(bin, "#!/bin/sh\necho 9.9.9-test\n");
  await chmod(bin, 0o755);
  const result = await inspectCli("codex", { env: { PATH: dir } });
  assert.equal(result.presence, "ready");
  assert.equal(result.code, null);
  assert.equal(result.version, "9.9.9-test");
  assert.equal(result.resolvedPath, bin);
  const ready = await assertCliReady("codex", { env: { PATH: dir } });
  assert.equal(ready.resolvedPath, bin);
});

test("inspectKnownClis covers only the registered CLIs", async () => {
  const clis = await inspectKnownClis({ env: { PATH: "" } });
  assert.deepEqual(clis.map(cli => cli.id), ["codex", "opencode"]);
  assert.equal(clis.every(cli => cli.code === "not_installed"), true);
  assert.equal("resolvedPath" in clis[0], false);
});
