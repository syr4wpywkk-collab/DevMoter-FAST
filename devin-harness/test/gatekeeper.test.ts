import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGatekeeper } from "../src/pool/gatekeeper.js";

function tmpWorktree(): string {
  return mkdtempSync(join(tmpdir(), "harness-gk-"));
}

test("gatekeeper: passing command produces ok check", async () => {
  const worktree = tmpWorktree();
  const result = await runGatekeeper({
    worktree,
    task: {
      id: "gk-ok",
      gatekeeper: { commands: [["node", "-e", "process.exit(0)"]] },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].ok, true);
  assert.equal(result.checks[0].name, "node -e process.exit(0)");
  assert.equal(result.feedback, "");
});

test("gatekeeper: failing command is checked and summarized in feedback", async () => {
  const worktree = tmpWorktree();
  const result = await runGatekeeper({
    worktree,
    task: {
      id: "gk-ng",
      gatekeeper: {
        commands: [
          ["node", "-e", "console.error('boom'); process.exit(1)"],
          ["node", "-e", "process.exit(0)"],
        ],
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[0].ok, false);
  assert.match(result.checks[0].detail, /boom/);
  assert.equal(result.checks[1].ok, true);
  assert.match(result.feedback, /FAILED/);
  assert.match(result.feedback, /boom/);
});

test("gatekeeper: defaults to npm test when package.json has a test script", async () => {
  const worktree = tmpWorktree();
  writeFileSync(
    join(worktree, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: { test: "node -e \"process.exit(0)\"" },
    }),
    "utf8",
  );
  const result = await runGatekeeper({ worktree, task: { id: "gk-default" } });
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].name, "npm test");
  assert.equal(result.ok, true);
});

test("gatekeeper: no commands and no package.json means no checks, ok", async () => {
  const worktree = tmpWorktree();
  const result = await runGatekeeper({ worktree, task: { id: "gk-none" } });
  assert.deepEqual(result.checks, []);
  assert.equal(result.ok, true);
});
