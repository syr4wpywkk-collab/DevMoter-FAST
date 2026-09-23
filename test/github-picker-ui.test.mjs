import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");

test("GitHub branch picker prefers refreshed branch metadata over stale repo-list metadata", () => {
  const functionStart = source.indexOf("async function showGithubRepo(repo: GithubRepo)");
  const functionEnd = source.indexOf("function showProjectAddForm", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const body = source.slice(functionStart, functionEnd);

  assert.match(body, /result\.defaultBranch/);
  assert.match(body, /branches\.find\(\(branch: \{ default\?: boolean \}\) => branch\.default\)\?\.name/);
  assert.match(body, /repo\.defaultBranch/);
  assert.match(body, /option\.selected = branch\.name === refreshedDefaultBranch/);

  assert.ok(
    body.indexOf("result.defaultBranch") < body.indexOf("repo.defaultBranch"),
    "refreshed API metadata must take precedence over stale repository-list metadata"
  );
});
