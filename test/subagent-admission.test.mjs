import assert from "node:assert/strict";
import test from "node:test";
import { SubagentRuntime } from "../src/subagent-runtime.mjs";

const spec = id => ({ id, parentSessionId: "parent", task: "Task " + id });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(policy) {
  const starts = [];
  const runtime = new SubagentRuntime({
    policy,
    adapters: {
      codex: {
        async start(run) {
          starts.push(run.id);
          return { state: "running", sessionId: run.id, turnId: run.id };
        },
        async cancel() {}
      }
    }
  });
  return { runtime, starts };
}

test("global admission counts concurrent direct starts and approval waits", async () => {
  const { runtime, starts } = fixture({ maxActiveRuns: 2 });
  const attempts = await Promise.allSettled(["a", "b", "c"].map(id => runtime.spawn(spec(id))));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 2);
  const denied = attempts.find(result => result.status === "rejected");
  assert.equal(denied.reason.status, 429);
  assert.equal(starts.length, 2);
  runtime.update("a", { state: "waiting_for_approval" });
  await assert.rejects(runtime.spawn(spec("d")), { status: 429 });
  runtime.update("a", { state: "completed" });
  await runtime.spawn(spec("d"));
  assert.equal(starts.length, 3);
  assert.equal(runtime.update("a", { state: "running" }).state, "completed");
  await assert.rejects(runtime.spawn(spec("e")), { status: 429 });
});

test("multiple fleets share host capacity and a direct completion wakes queued work", async () => {
  const { runtime, starts } = fixture({ maxActiveRuns: 2, maxActiveFleets: 2 });
  await runtime.spawn(spec("direct"));
  await runtime.runFleet([spec("a"), spec("b")], { id: "f1", concurrency: 2 });
  const waiting = await runtime.runFleet([spec("c")], { id: "f2", concurrency: 2 });
  assert.equal(waiting.queued, 1);
  assert.deepEqual(starts, ["direct", "a"]);
  await assert.rejects(runtime.runFleet([spec("extra")], { id: "f3" }), { status: 429 });
  runtime.update("direct", { state: "completed" });
  await tick();
  assert.deepEqual(starts, ["direct", "a", "b"]);
  runtime.update("a", { state: "completed" });
  await tick();
  assert.deepEqual(starts, ["direct", "a", "b", "c"]);
  assert.equal(runtime.getFleet("f2").queued, 0);
  await runtime.cancelFleet("f2");
  assert.equal(runtime.getFleet("f2").state, "cancelled");
});

test("cancelling a queued fleet does not start its work later", async () => {
  const { runtime, starts } = fixture({ maxActiveRuns: 1 });
  await runtime.spawn(spec("direct"));
  await runtime.runFleet([spec("queued")], { id: "f" });
  await runtime.cancelFleet("f");
  runtime.update("direct", { state: "completed" });
  await tick();
  assert.deepEqual(starts, ["direct"]);
  assert.equal(runtime.getFleet("f").state, "cancelled");
});

test("a rejected nested run does not consume the parent's delegation budget", async () => {
  const { runtime } = fixture({ maxActiveRuns: 1 });
  await runtime.spawn(spec("parent"));
  const before = runtime.getRun("parent").budget;
  await assert.rejects(runtime.spawn({ ...spec("child"), parentRunId: "parent" }), { status: 429 });
  assert.deepEqual(runtime.getRun("parent").budget, before);
});

test("backend start failure releases admission capacity", async () => {
  const runtime = new SubagentRuntime({
    policy: { maxActiveRuns: 1 },
    adapters: { codex: {
      async start(run) {
        if (run.id === "fail") throw new Error("simulated start failure");
        return { state: "running" };
      },
      async cancel() {}
    } }
  });
  await assert.rejects(runtime.spawn(spec("fail")), /simulated start failure/);
  assert.equal((await runtime.spawn(spec("ok"))).state, "running");
});
