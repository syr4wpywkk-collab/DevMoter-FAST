import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reconnectAfterSync } from "../src/reconnect-after-sync.mjs";

test("successful resume sync reconnects events and returns its value", async () => {
  const calls = [];
  const result = await reconnectAfterSync(async () => {
    calls.push("sync");
    return "current-state";
  }, () => calls.push("reconnect"));

  assert.deepEqual(calls, ["sync", "reconnect"]);
  assert.deepEqual(result, { error: null, value: "current-state" });
});

test("failed resume sync still reconnects events and returns the failure", async () => {
  const calls = [];
  const failure = new Error("history unavailable");
  const result = await reconnectAfterSync(async () => {
    calls.push("sync");
    throw failure;
  }, () => calls.push("reconnect"));

  assert.deepEqual(calls, ["sync", "reconnect"]);
  assert.equal(result.error, failure);
  assert.equal(result.value, undefined);
});

test("both chat backends use the failure-safe resume boundary", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);
  assert.match(codex, /reconnectAfterSync\(async \(\) => \{\s*if \(!\(await refresh\(\)\)\)/);
  assert.match(opencode, /reconnectAfterSync\(\(\) => refresh\(\), \(\) => connectEvents\(\)\)/);
  for (const source of [codex, opencode]) assert.match(source, /if \(sync\.error\)/);
});
