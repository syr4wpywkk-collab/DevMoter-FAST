import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("audit-facing placeholders and Usage labels stay honest", async () => {
  const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.doesNotMatch(codex, /cxUsageLabel">0 tok/);
  assert.match(codex, /cxUsageLabel">Usage/);
  assert.match(codex, /ライブラリ · 準備中/);

  const integrations = await readFile(new URL("../src/integrations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(integrations, /claude:\/\/code/);
  assert.match(integrations, /Claudeアプリ（準備中）/);
});
