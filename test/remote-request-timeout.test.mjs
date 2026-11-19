import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

test("Codex and OpenCode API boundaries bound read and mutation requests", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);
  assert.match(codex, /fetchWithTimeout\([\s\S]{0,700}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,120}t\("codex\.errors\.projectRequestTimeout"\)/);
  assert.match(codex, /fetchWithTimeout\([\s\S]{0,500}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,100}t\("codex\.errors\.rpcTimeout"\)/);
  assert.match(codex, /t\("codex\.errors\.mutationUnknown", \{ operationId: opId \}\)/);
  assert.match(opencode, /fetchWithTimeout\([\s\S]{0,700}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,100}t\("opencode\.errors\.timeout"\)/);
  assert.match(opencode, /fetchWithTimeout\([\s\S]{0,400}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,100}t\("opencode\.errors\.devmoterTimeout"\)/);
  assert.match(opencode, /t\("opencode\.errors\.mutationUnknown", \{ operationId: opId \}\)/);
  assert.match(DICTIONARIES.en["codex.errors.rpcTimeout"], /Codex RPC request timed out/);
  assert.match(DICTIONARIES.en["opencode.errors.timeout"], /OpenCode request timed out/);
  assert.match(DICTIONARIES.en["opencode.errors.devmoterTimeout"], /DevMoter request timed out/);
});
