import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ScopedPermissionStore,
  compactAgentContext,
  createLoopDetector,
  evaluatePreExecutionGuard,
  scanHighRiskCommand
} from "../server/safety.mjs";

test("high-risk scanner reports exact command and advisory reasons", () => {
  const command = "git reset --hard HEAD~1";
  const result = scanHighRiskCommand(command);
  assert.equal(result.command, command);
  assert.equal(result.dangerous, true);
  assert.equal(result.risk, "high");
  assert.ok(result.reasons.some(reason => reason.includes("Git reset")));
  assert.equal(result.advisory, true);

  const safe = scanHighRiskCommand("npm test");
  assert.equal(safe.dangerous, false);
  assert.equal(safe.risk, "normal");
});

test("loop detector pauses on bounded repeated actions and exposes history", () => {
  const detector = createLoopDetector({ threshold: 3, windowSize: 6 });
  const action = { tool: "shell", action: "npm test", details: { cwd: "/repo" } };

  assert.equal(detector.record("run-1", action).paused, false);
  assert.equal(detector.record("run-1", action).paused, false);
  const paused = detector.record("run-1", action);
  assert.equal(paused.paused, true);
  assert.match(paused.reason, /Repeated/);
  assert.equal(paused.recentActions.length, 3);

  const resumed = detector.continueRun("run-1");
  assert.equal(resumed.paused, false);
});

test("pre-execution guard blocks silent scope expansion", () => {
  const result = evaluatePreExecutionGuard({
    task: "Update src only",
    requestedPaths: ["src"],
    plannedMutations: ["src/app.ts", "server.mjs"]
  });
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some(item => item.code === "scope-expansion"));
});

test("remembered approvals are exact-scope, revocable, and reject dangerous grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-safety-"));
  try {
    const store = new ScopedPermissionStore(join(root, "approvals.json"));
    const scope = {
      backend: "codex",
      tool: "item/commandExecution/requestApproval",
      action: "npm test",
      projectId: "project-1",
      sessionId: "thread-1"
    };

    const rule = await store.grant({ scope, ttlMs: 60_000 });
    assert.ok(rule.id);

    const match = await store.match({ scope, command: "npm test" });
    assert.equal(match.matched, true);

    const mismatch = await store.match({
      scope: { ...scope, action: "npm run build" },
      command: "npm run build"
    });
    assert.equal(mismatch.matched, false);

    await assert.rejects(
      store.grant({ scope: { ...scope, action: "git reset --hard HEAD" }, dangerous: true }),
      /cannot be remembered/
    );

    assert.equal(await store.revoke(rule.id), true);
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context compaction keeps critical state and supports dedicated summarizer hook", async () => {
  const messages = [
    { kind: "system", text: "system rules" },
    { kind: "project-rule", text: "project rules" },
    ...Array.from({ length: 20 }, (_, index) => ({ kind: "message", text: `old ${index}` })),
    { kind: "plan", text: "active plan" },
    { kind: "approval", text: "unresolved", resolved: false },
    { kind: "tool-state", text: "latest tool state" },
    ...Array.from({ length: 8 }, (_, index) => ({ kind: "message", text: `recent ${index}` }))
  ];

  let summarizerModel = null;
  const result = await compactAgentContext(messages, {
    maxItems: 12,
    summarizerModel: "small-summarizer",
    summarize: async (_dropped, options) => {
      summarizerModel = options.model;
      return "summary";
    }
  });

  assert.equal(result.compacted, true);
  assert.equal(result.event.visible, true);
  assert.equal(summarizerModel, "small-summarizer");
  assert.ok(result.messages.some(item => item.kind === "compaction-summary"));
  assert.ok(result.messages.some(item => item.kind === "system"));
  assert.ok(result.messages.some(item => item.kind === "project-rule"));
  assert.ok(result.messages.some(item => item.kind === "plan"));
  assert.ok(result.messages.some(item => item.kind === "approval"));
  assert.ok(result.messages.some(item => item.kind === "tool-state"));
});
