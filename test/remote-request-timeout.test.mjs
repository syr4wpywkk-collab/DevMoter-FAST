import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Codex and OpenCode API boundaries bound read and mutation requests", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);
  assert.match(codex, /fetchWithTimeout\([\s\S]{0,700}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,120}Project request timed out/);
  assert.match(codex, /fetchWithTimeout\([\s\S]{0,500}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,100}Codex RPC request timed out/);
  assert.match(codex, /Mutation outcome is unknown \(operation \$\{operationId\}\)/);
  assert.match(opencode, /fetchWithTimeout\([\s\S]{0,700}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,100}OpenCode request timed out/);
  assert.match(opencode, /fetchWithTimeout\([\s\S]{0,400}REMOTE_REQUEST_TIMEOUT_MS[\s\S]{0,100}DevMoter request timed out/);
  assert.match(opencode, /Mutation outcome is unknown \(operation \$\{opId\}\)/);
});
