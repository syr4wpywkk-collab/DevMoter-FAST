import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const codexSource = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");

test("GitHub picker prefers refreshed branch endpoint default over stale repository-list metadata", () => {
  assert.match(codexSource, /result\?\.defaultBranch/);
  assert.match(codexSource, /find\(\(branch: \{ default\?: boolean \}\) => branch\?\.default\)/);
  assert.match(codexSource, /option\.selected = branch\.name === refreshedDefaultBranch/);

  const refreshed = codexSource.indexOf("result?.defaultBranch");
  const staleFallback = codexSource.indexOf("repo.defaultBranch", refreshed);
  assert.ok(refreshed >= 0 && staleFallback > refreshed);
});
