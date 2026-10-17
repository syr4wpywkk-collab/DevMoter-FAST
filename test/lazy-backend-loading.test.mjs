import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("chat backends load on demand and health polling can recover from timeout", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import \{ mount(?:OpenCodeRemote|CodexRemote|ApiChat) \} from/m);
  for (const [backend, mountTask] of [
    ["opencode", "openCodeMountTask"],
    ["codex", "codexMountTask"],
    ["api-chat", "apiMountTask"]
  ]) {
    assert.match(source, new RegExp(`${mountTask} \\?\\?= import\\(\\"\\./${backend === "api-chat" ? "api-chat" : backend}"`));
  }
  assert.match(source, /backendHealth = \{[\s\S]*?openCodeRemote\?\.setOnline\?\./);
  assert.match(source, /codexRemote\?\.setOnline\?\./);
  assert.match(source, /openCodeMountTask = null;/);
  assert.match(source, /codexMountTask = null;/);
  assert.match(source, /apiMountTask = null;/);
  assert.match(source, /画面を読み込めませんでした。接続を確認して再試行してください。/);
  assert.match(source, /retry\.addEventListener\("click", \(\) => requestBackendMount\(backend\)\)/);
  assert.match(source, /fetchWithTimeout\([\s\S]{0,180}"\/api\/health"[\s\S]{0,120}5_000/);
  assert.match(source, /finally \{\s*healthCheckInFlight = false;/);
});
