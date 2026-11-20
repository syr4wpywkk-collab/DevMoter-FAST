import assert from "node:assert/strict";
import { test } from "node:test";
import type { EffectivePolicy, ResolvedModel, RunContext, TaskSpec } from "../src/types.js";
import { buildDevinArgs } from "../src/pool/runner.js";

function makeCtx(policy?: Partial<EffectivePolicy>): RunContext {
  const fullPolicy: EffectivePolicy = {
    specMode: "smart",
    cliMode: "smart",
    sandbox: false,
    rules: { allow: [], deny: [], ask: [] },
    ...policy,
  };
  const model: ResolvedModel = {
    modelId: "swe-2-medium",
    requestedModel: "swe-2-medium",
    effort: "medium",
    warnings: [],
    free: true,
  };
  return {
    repoRoot: "/repo",
    worktree: "/repo/.devin-harness-worktrees/t1",
    branch: "harness/t1",
    runDir: "/state/runs/t1-20261120170000",
    configPath: "/state/runs/t1-20261120170000/devin-config.json",
    policy: fullPolicy,
    model,
    promptFile: "/state/runs/t1-20261120170000/task.md",
    exportPath: "/state/runs/t1-20261120170000/atif-t1.json",
    images: [],
    log: () => undefined,
  };
}

const task: TaskSpec = { id: "t1", prompt: "do something" };

test("buildDevinArgs: base vector without sandbox/resume", () => {
  const args = buildDevinArgs(task, makeCtx());
  assert.deepEqual(args, [
    "-p",
    "--prompt-file",
    "/state/runs/t1-20261120170000/task.md",
    "--respect-workspace-trust",
    "false",
    "--config",
    "/state/runs/t1-20261120170000/devin-config.json",
    "--export",
    "/state/runs/t1-20261120170000/atif-t1.json",
    "--model",
    "swe-2-medium",
    "--permission-mode",
    "smart",
  ]);
  assert.ok(!args.includes("--sandbox"));
  assert.ok(!args.includes("--resume"));
});

test("buildDevinArgs: sandbox policy appends --sandbox", () => {
  const args = buildDevinArgs(
    task,
    makeCtx({ specMode: "autonomous", cliMode: "smart", sandbox: true }),
  );
  assert.ok(args.includes("--sandbox"));
  assert.equal(args[args.length - 1], "--sandbox");
});

test("buildDevinArgs: resume appends --resume <sessionId>", () => {
  const args = buildDevinArgs(task, makeCtx(), { resumeSessionId: "sess-42" });
  assert.deepEqual(args.slice(-2), ["--resume", "sess-42"]);
});

test("buildDevinArgs: promptFile override replaces ctx prompt file", () => {
  const args = buildDevinArgs(task, makeCtx(), {
    promptFile: "/state/runs/t1-20261120170000/feedback.md",
    resumeSessionId: "sess-42",
  });
  const idx = args.indexOf("--prompt-file");
  assert.equal(args[idx + 1], "/state/runs/t1-20261120170000/feedback.md");
  assert.deepEqual(args.slice(-2), ["--resume", "sess-42"]);
});
