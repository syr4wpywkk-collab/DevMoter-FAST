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

test("Codex bridge reports CLI spawn failures", async () => {
  const bridge = new CodexBridge({ spawnImpl: () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("error", new Error("codex missing")));
    return child;
  }});
  await assert.rejects(bridge.start(), /codex missing/);
  assert.equal((await bridge.health()).online, false);
});

test("Codex bridge rejects an unanswered RPC on timeout", async () => {
  const bridge = new CodexBridge({ spawnImpl: fakeChild });
  const child = fakeChild();
  bridge.child = child;
  await assert.rejects(bridge.request("thread/list", {}, { skipStart: true, timeoutMs: 5 }), /RPC timeout/);
});

test("Codex bridge rejects pending requests when the CLI exits non-zero", async () => {
  const child = fakeChild();
  const bridge = new CodexBridge({ spawnImpl: () => {
    queueMicrotask(() => child.emit("exit", 7, null));
    return child;
  }});
  await assert.rejects(bridge.start(), /exited \(code=7/);
  assert.equal(bridge.ready, false);
});
