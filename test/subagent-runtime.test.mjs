import assert from "node:assert/strict";
import test from "node:test";
import { SubagentRuntime, createCodexSubagentAdapter } from "../src/subagent-runtime.mjs";

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

test("fleet enforces concurrency and starts queued siblings after completion", async () => {
  const starts = [];
  const adapter = {
    async start(run) {
      starts.push(run.id);
      return { sessionId: `session-${run.id}`, turnId: `turn-${run.id}`, state: "running" };
    },
    async cancel() {}
  };
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    idFactory: () => `fleet-id-${++index}`
  });
  const specs = [1, 2, 3].map(value => ({
    parentSessionId: "parent",
    task: `task-${value}`
  }));
  const fleet = await runtime.runFleet(specs, { id: "fleet-a", concurrency: 2 });
  assert.equal(fleet.concurrency, 2);
  assert.equal(starts.length, 2);
  runtime.update(fleet.runIds[0], { state: "completed" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts.length, 3);
});

test("one fleet failure does not stop sibling scheduling", async () => {
  const starts = [];
  const adapter = {
    async start(run) {
      starts.push(run.task);
      if (run.task === "bad") throw new Error("bad child");
      return { sessionId: `session-${run.id}`, turnId: `turn-${run.id}`, state: "running" };
    },
    async cancel() {}
  };
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    idFactory: () => `isolation-${++index}`
  });
  const fleet = await runtime.runFleet([
    { parentSessionId: "p", task: "bad" },
    { parentSessionId: "p", task: "good" }
  ], { id: "fleet-b", concurrency: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ["bad", "good"]);
  const goodRun = runtime.listRuns().find(run => run.task === "good");
  assert.equal(goodRun.state, "running");
  assert.equal(runtime.getFleet("fleet-b").errors.length, 1);
});

test("fleet cancellation clears queue and cancels active runs independently", async () => {
  const cancelled = [];
  const adapter = {
    async start(run) {
      return { sessionId: `s-${run.id}`, turnId: `t-${run.id}`, state: "running" };
    },
    async cancel(run) {
      cancelled.push(run.id);
    }
  };
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    idFactory: () => `cancel-${++index}`
  });
  await runtime.runFleet([
    { parentSessionId: "p", task: "one" },
    { parentSessionId: "p", task: "two" },
    { parentSessionId: "p", task: "three" }
  ], { id: "fleet-c", concurrency: 1 });
  const fleet = await runtime.cancelFleet("fleet-c");
  assert.equal(fleet.state, "cancelled");
  assert.equal(fleet.queued, 0);
  assert.equal(cancelled.length, 1);
});

test("Codex adapter shares one EventSource across multiple live agents", async () => {
  let thread = 0;
  const sources = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.method === "thread/start") {
      thread += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: { thread: { id: `thread-${thread}` }, model: "model-x" } };
        }
      };
    }
    if (request.method === "turn/start") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: { turn: { id: `turn-${thread}` } } };
        }
      };
    }
    throw new Error(`unexpected RPC: ${request.method}`);
  };
  const eventSourceFactory = url => {
    const listeners = new Map();
    const source = {
      url,
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      close() {}
    };
    sources.push(source);
    return source;
  };
  let id = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: createCodexSubagentAdapter({ fetchImpl, eventSourceFactory }) },
    idFactory: () => `live-${++id}`
  });
  await runtime.spawn({ parentSessionId: "parent", task: "one", context: { projectId: "project-1" } });
  await runtime.spawn({ parentSessionId: "parent", task: "two", context: { projectId: "project-1" } });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "/api/codex/events");
});

test("second opinion keeps current owner unchanged and shares only selected context", async () => {
  const adapter = {
    async start(run) {
      return { sessionId: `session-${run.id}`, turnId: `turn-${run.id}`, state: "running" };
    },
    async cancel() {}
  };
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    idFactory: () => `opinion-${++index}`,
    policy: { tokenBudget: 1000, turnBudget: 6 }
  });
  const parent = await runtime.spawn({
    parentSessionId: "parent-session",
    role: "executor",
    task: "Implement auth"
  });
  runtime.update(parent.id, { outputDelta: "implemented result", error: "hidden error" });
  const opinion = await runtime.spawnSecondOpinion(parent.id, {
    role: "reviewer",
    task: "Review independently",
    share: { task: true, output: true, error: false },
    tokenBudget: 200,
    turnBudget: 1
  });
  assert.equal(runtime.getRun(parent.id).role, "executor");
  assert.equal(opinion.role, "reviewer");
  assert.equal(opinion.kind, "second-opinion");
  assert.equal(opinion.context.parentTask, "Implement auth");
  assert.equal(opinion.context.parentOutput, "implemented result");
  assert.equal("parentError" in opinion.context, false);
  assert.equal(opinion.context.originalOwner, "executor");
});

test("second opinion requires an explicit context selection", async () => {
  const adapter = {
    async start(run) {
      return { sessionId: `session-${run.id}`, turnId: `turn-${run.id}`, state: "running" };
    },
    async cancel() {}
  };
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    idFactory: () => `no-share-${++index}`
  });
  const parent = await runtime.spawn({ parentSessionId: "p", task: "parent" });
  await assert.rejects(
    () => runtime.spawnSecondOpinion(parent.id, { share: {} }),
    /Select at least one parent context field/
  );
});


test("Codex adapter starts subagents with registered Project id and never caller cwd", async () => {
  const calls = [];
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.method === "thread/start") {
      assert.equal(body.params.projectId, "project-1");
      assert.equal(Object.prototype.hasOwnProperty.call(body.params, "cwd"), false);
      return new Response(JSON.stringify({ result: { thread: { id: "thread-1" }, model: "m" } }), { status: 200 });
    }
    if (body.method === "turn/start") {
      return new Response(JSON.stringify({ result: { turn: { id: "turn-1" } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ result: {} }), { status: 200 });
  };
  class FakeEvents {
    addEventListener() {}
    close() {}
  }
  const adapter = createCodexSubagentAdapter({ fetchImpl: fakeFetch, eventSourceFactory: () => new FakeEvents() });
  await adapter.start({
    id: "r1", role: "executor", parentSessionId: "p", depth: 0, lineage: [],
    budget: { tokenLimit: 10, turnLimit: 2 }, context: { projectId: "project-1", cwd: "/tmp/hostile" },
    task: "test", model: null
  }, () => {});
  assert.equal(calls[0].method, "thread/start");
});


test("nested subagents can never exceed a restrictive parent capability ceiling", async () => {
  const fake = fakeAdapter();
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => `cap-${++index}`
  });
  const root = await runtime.spawn({
    parentSessionId: "parent",
    task: "review root",
    capabilityPolicy: {
      allow: ["read", "diagnostics", "git"],
      deny: ["files", "commands", "network"],
      mutationPolicy: "read-only-until-explicit-transition"
    }
  });
  const child = await runtime.spawn({
    parentSessionId: root.sessionId,
    parentRunId: root.id,
    task: "try executor child",
    capabilityPolicy: {
      allow: ["read", "files", "commands", "network"],
      deny: [],
      mutationPolicy: "approval-required"
    }
  });
  assert.deepEqual(child.capabilityPolicy.allow, ["read"]);
  assert.ok(child.capabilityPolicy.deny.includes("files"));
  assert.ok(child.capabilityPolicy.deny.includes("commands"));
  assert.ok(child.capabilityPolicy.deny.includes("network"));
  assert.equal(child.capabilityPolicy.mutationPolicy, "read-only-until-explicit-transition");
});

test("capability ceiling remains monotonic across deeper delegation", async () => {
  const fake = fakeAdapter();
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => `deep-cap-${++index}`,
    policy: { maxDepth: 3 }
  });
  const root = await runtime.spawn({
    parentSessionId: "p",
    task: "root",
    capabilityPolicy: { allow: ["read", "git"], deny: ["files", "commands", "network"] }
  });
  const child = await runtime.spawn({
    parentSessionId: root.sessionId,
    parentRunId: root.id,
    task: "child",
    capabilityPolicy: { allow: ["read"], deny: [] }
  });
  const grandchild = await runtime.spawn({
    parentSessionId: child.sessionId,
    parentRunId: child.id,
    task: "grandchild",
    capabilityPolicy: { allow: ["read", "git", "files", "commands"], deny: [] }
  });
  assert.deepEqual(child.capabilityPolicy.allow, ["read"]);
  assert.deepEqual(grandchild.capabilityPolicy.allow, ["read"]);
});

test("second opinions inherit the parent capability ceiling", async () => {
  const fake = fakeAdapter();
  let index = 0;
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => `op-cap-${++index}`
  });
  const parent = await runtime.spawn({
    parentSessionId: "p",
    task: "review",
    capabilityPolicy: {
      allow: ["read", "diagnostics"],
      deny: ["files", "commands", "network"],
      mutationPolicy: "read-only-until-explicit-transition"
    }
  });
  const opinion = await runtime.spawnSecondOpinion(parent.id, {
    share: { task: true },
    task: "independent review"
  });
  assert.deepEqual(opinion.capabilityPolicy.allow, ["read", "diagnostics"]);
  assert.equal(opinion.capabilityPolicy.mutationPolicy, "read-only-until-explicit-transition");
});

test("legacy unrestricted roots preserve all capability groups", async () => {
  const fake = fakeAdapter();
  const runtime = new SubagentRuntime({
    adapters: { codex: fake.adapter },
    idFactory: () => "legacy-cap"
  });
  const run = await runtime.spawn({ parentSessionId: "p", task: "legacy" });
  assert.deepEqual(
    run.capabilityPolicy.allow,
    ["read", "diagnostics", "tests", "git", "files", "commands", "network"]
  );
  assert.deepEqual(run.capabilityPolicy.deny, []);
});

test("Codex adapter auto-declines approvals for denied inherited capabilities", async () => {
  const listeners = new Map();
  const approvals = [];
  const fetchImpl = async (url, init) => {
    if (url === "/api/codex/approval") {
      approvals.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const request = JSON.parse(init.body);
    if (request.method === "thread/start") {
      return new Response(JSON.stringify({ result: { thread: { id: "thread-policy" }, model: "m" } }), { status: 200 });
    }
    if (request.method === "turn/start") {
      return new Response(JSON.stringify({ result: { turn: { id: "turn-policy" } } }), { status: 200 });
    }
    throw new Error("unexpected RPC " + request.method);
  };
  const eventSourceFactory = () => ({
    addEventListener(name, listener) { listeners.set(name, listener); },
    close() {}
  });
  const runtime = new SubagentRuntime({
    adapters: { codex: createCodexSubagentAdapter({ fetchImpl, eventSourceFactory }) },
    idFactory: () => "policy-run"
  });
  const run = await runtime.spawn({
    parentSessionId: "parent",
    task: "read only",
    context: { projectId: "project-1" },
    capabilityPolicy: {
      allow: ["read"],
      deny: ["files", "commands", "network"],
      mutationPolicy: "read-only-until-explicit-transition"
    }
  });

  listeners.get("server-request")({
    data: JSON.stringify({
      id: 44,
      method: "item/commandExecution/requestApproval",
      params: { threadId: run.sessionId, command: "touch nope" }
    })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(approvals, [{ id: 44, decision: "decline" }]);
  assert.equal(runtime.getRun(run.id).pendingApproval, null);
  assert.equal(runtime.getRun(run.id).state, "running");
});
