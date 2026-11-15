import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { recoverAfterEventOpen } from "../src/event-recovery.mjs";

test("event recovery reports sync success", async () => {
  const reports = [];
  await recoverAfterEventOpen(async () => "ok", error => reports.push(error));
  assert.deepEqual(reports, [null]);
});

test("event recovery catches refresh rejection and reports it without rejecting", async () => {
  const failure = new Error("history unavailable");
  const reports = [];
  await assert.doesNotReject(recoverAfterEventOpen(async () => { throw failure; }, error => reports.push(error)));
  assert.deepEqual(reports, [failure]);
});

test("Codex and OpenCode only show recovered after successful refresh", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);
  for (const source of [codex, opencode]) {
    assert.match(source, /recoverAfterEventOpen\(async \(\) =>/);
    assert.match(source, /showToast\(error\s*\?/);
    assert.match(source, /t\("(?:codex|opencode)\.reconnect\.syncAfterOpenFailed"\)/);
    assert.match(source, /t\("(?:codex\.reconnect\.reconnected|opencode\.reconnect\.recovered)"\)/);
  }
  assert.match(codex, /if \(!\(await loadThreads\(\)\)\) return false;/);
  assert.match(codex, /if \(!\(await loadThreadHistory\(threadBeforeRefresh\)\)\) return false;/);
  assert.match(opencode, /if \(!sessionsLoaded\) throw new Error\(t\("opencode\.sessions\.refreshHistoryFailed"\)\)/);
  assert.match(opencode, /setActivity\(t\("opencode\.activity\.error"\), "error"\)[\s\S]*?return false;/);
});
