import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CodexBridge } from "../server/codex-bridge.mjs";

function fakeChild() {
  const child = new PassThrough();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

const readyCli = async () => ({ resolvedPath: "codex" });

test("Codex bridge reports a missing CLI before spawn", async () => {
  let spawned = false;
  const bridge = new CodexBridge({
    prepareCli: async () => {
      const error = new Error("codex が見つからないよ。入れ方: npm install -g @openai/codex");
      error.code = "not_installed";
      throw error;
    },
    spawnImpl: () => {
      spawned = true;
      return fakeChild();
    }
  });
  await assert.rejects(bridge.start(), /見つからないよ/);
  assert.equal(spawned, false);
  const health = await bridge.health();
  assert.equal(health.online, false);
  assert.equal(health.code, "not_installed");
});

test("Codex bridge rejects an unanswered RPC on timeout", async () => {
  const bridge = new CodexBridge({ prepareCli: readyCli, spawnImpl: fakeChild });
  const child = fakeChild();
  bridge.child = child;
  await assert.rejects(bridge.request("thread/list", {}, { skipStart: true, timeoutMs: 5 }), /RPC timeout/);
});

test("Codex bridge rejects pending requests when the CLI exits non-zero", async () => {
  const child = fakeChild();
  const bridge = new CodexBridge({ prepareCli: readyCli, spawnImpl: () => {
    queueMicrotask(() => child.emit("exit", 7, null));
    return child;
  }});
  await assert.rejects(bridge.start(), /exited \(code=7/);
  assert.equal(bridge.ready, false);
});
