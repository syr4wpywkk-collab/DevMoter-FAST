import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRelayArgs } from "../server/browser-netns-relay.mjs";

const RELAY = fileURLToPath(new URL("../server/browser-netns-relay.mjs", import.meta.url));

test("relay arguments put the browser command after --", () => {
  assert.deepEqual(parseRelayArgs(["--host", "127.0.0.1", "--port", "3000", "--socket", "/tmp/s", "--", "chrome", "--flag"]),
    { host: "127.0.0.1", port: 3000, socket: "/tmp/s", command: "chrome", args: ["--flag"] });
  assert.throws(() => parseRelayArgs(["--host", "127.0.0.1", "--port", "0", "--socket", "/tmp/s", "--", "chrome"]), /Invalid relay/);
});

test("the relay runs from an install path that contains spaces", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter relay "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "Dev Moter", "server");
  await mkdir(dir, { recursive: true });
  const script = join(dir, "browser-netns-relay.mjs");
  await copyFile(RELAY, script);
  const result = spawnSync(process.execPath, [script, "--host", "127.0.0.1"], { encoding: "utf8" });
  assert.equal(result.status, 1, "main() ran and rejected the missing -- separator");
  assert.match(result.stderr, /browser relay: Missing --/);
});
