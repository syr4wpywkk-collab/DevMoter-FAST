import assert from "node:assert/strict";
import test from "node:test";
import { SubagentRuntime } from "../src/subagent-runtime.mjs";

function fakeAdapter() {
  const starts = [];
  const cancels = [];
  let emit = null;
  return {
    starts,
    cancels,
    adapter: {
      async start(run, callback) {
        starts.push(run);
        emit = callback;
        return { sessionId: "child-session", turnId: "turn-1", state: "running" };
      },
      async cancel(run) {
        cancels.push(run.id);
      }
    },
    push(patch) {
      emit?.(patch);
    }
  };
}

test("subagent spawn records explicit parent, scoped context, role and model", async () => {
  const fake = fakeAdapter();
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => "run-1"
  });
  const run = await runtime.spawn({
    parentSessionId: "parent-7",
    role: "reviewer",
    model: "model-x",
    task: "Review the diff",
    context: { diff: "a -> b" }
  });
  assert.equal(run.id, "run-1");
  assert.equal(run.parentSessionId, "parent-7");
  assert.equal(run.role, "reviewer");
  assert.equal(run.model, "model-x");
  assert.deepEqual(run.context, { diff: "a -> b" });
  assert.equal(run.sessionId, "child-session");
  assert.equal(run.state, "running");
});

test("completion and failure are surfaced independently", async () => {
  const fake = fakeAdapter();
  const runtime = new SubagentRuntime({ adapters: { codex: fake.adapter }, idFactory: () => "run-2" });
  await runtime.spawn({ parentSessionId: "parent", task: "test" });
  fake.push({ outputDelta: "hello" });
  fake.push({ state: "completed" });
  assert.equal(runtime.getRun("run-2").output, "hello");
  assert.equal(runtime.getRun("run-2").state, "completed");
  runtime.update("run-2", { state: "failed", error: "late failure" });
  assert.equal(runtime.getRun("run-2").error, "late failure");
});

test("cancel delegates to the selected backend and surfaces cancelled state", async () => {
  const fake = fakeAdapter();
  const runtime = new SubagentRuntime({ adapters: { codex: fake.adapter }, idFactory: () => "run-3" });
  await runtime.spawn({ parentSessionId: "parent", task: "test" });
  const run = await runtime.cancel("run-3");
  assert.deepEqual(fake.cancels, ["run-3"]);
  assert.equal(run.state, "cancelled");
});

test("missing parent, task, or adapter fails closed", async () => {
  const runtime = new SubagentRuntime();
  await assert.rejects(() => runtime.spawn({ parentSessionId: "p", task: "x" }), /No subagent adapter/);
  const fake = fakeAdapter();
  runtime.registerAdapter("codex", fake.adapter);
  await assert.rejects(() => runtime.spawn({ parentSessionId: "", task: "x" }), /parentSessionId/);
  await assert.rejects(() => runtime.spawn({ parentSessionId: "p", task: "" }), /task is required/i);
});

test("nested delegation inherits bounded budget and exposes lineage", async () => {
  const fake = fakeAdapter();
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => `nested-${++index}`,
    policy: { maxDepth: 2, tokenBudget: 100, turnBudget: 4 }
  });
  const root = await runtime.spawn({ parentSessionId: "parent", task: "root task" });
  const child = await runtime.spawn({
    parentSessionId: root.sessionId,
    parentRunId: root.id,
    task: "child task",
    tokenBudget: 30,
    turnBudget: 1
  });
  assert.equal(child.depth, 1);
  assert.deepEqual(child.lineage, [root.id]);
  assert.equal(child.budget.tokenLimit, 30);
  assert.equal(child.budget.turnLimit, 1);
  assert.equal(runtime.getRun(root.id).budget.tokensRemaining, 70);
  assert.equal(runtime.getRun(root.id).budget.turnsRemaining, 3);
});

test("maximum nesting depth rejects deeper delegation", async () => {
  const fake = fakeAdapter();
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => `depth-${++index}`,
    policy: { maxDepth: 1, tokenBudget: 100, turnBudget: 4 }
  });
  const root = await runtime.spawn({ parentSessionId: "p", task: "root" });
  const child = await runtime.spawn({ parentSessionId: root.sessionId, parentRunId: root.id, task: "child" });
  await assert.rejects(
    () => runtime.spawn({ parentSessionId: child.sessionId, parentRunId: child.id, task: "grandchild" }),
    /Maximum subagent nesting depth/
  );
});

test("recursive delegation loops are rejected using ancestor fingerprints", async () => {
  const fake = fakeAdapter();
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => `loop-${++index}`
  });
  const root = await runtime.spawn({ parentSessionId: "p", task: "Repeat this exact task" });
  await assert.rejects(
    () => runtime.spawn({
      parentSessionId: root.sessionId,
      parentRunId: root.id,
      task: "  repeat   this exact TASK "
    }),
    /Recursive delegation loop rejected/
  );
});

test("failed nested spawn refunds reserved parent budget", async () => {
  let starts = 0;
  const adapter = {
    async start() {
      starts += 1;
      if (starts > 1) throw new Error("backend failed");
      return { sessionId: "root-session", turnId: "root-turn", state: "running" };
    },
    async cancel() {}
  };
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    idFactory: () => `refund-${++index}`,
    policy: { tokenBudget: 100, turnBudget: 4 }
  });
  const root = await runtime.spawn({ parentSessionId: "p", task: "root" });
  await assert.rejects(
    () => runtime.spawn({ parentSessionId: root.sessionId, parentRunId: root.id, task: "child", tokenBudget: 25, turnBudget: 1 }),
    /backend failed/
  );
  assert.equal(runtime.getRun(root.id).budget.tokensRemaining, 100);
  assert.equal(runtime.getRun(root.id).budget.turnsRemaining, 4);
});
