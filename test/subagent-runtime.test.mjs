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
