import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAutomationApi } from "../server/automation-api.mjs";

function apiWith(overrides = {}) {
  const codex = overrides.codex || new EventEmitter();
  codex.request ||= async () => ({});
  return createAutomationApi({
    readProjectRegistry: async () => [
      { id: "p1", name: "Demo", path: "/safe/demo", addedAt: 1 }
    ],
    getProjectById: async id => {
      if (id !== "p1") throw new Error("not found");
      return { id: "p1", name: "Demo", path: "/safe/demo", addedAt: 1 };
    },
    normalizeExistingProjectPath: async path => path,
    fetchOpenCodeJson: async () => [],
    codex,
    json: () => {},
    readJson: async () => ({}),
    operationId: () => "op-test",
    claimOperation: () => true,
    publicOrigin: "https://devmoter.example.test",
    taskTimeoutMs: overrides.taskTimeoutMs || 25
  });
}

test("automation project list and open URL do not expose host paths", async () => {
  const api = apiWith();
  const writes = [];
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { writes.push(body); }
  };
  // Use a fresh API with observable JSON helper.
  const observable = createAutomationApi({
    readProjectRegistry: async () => [
      { id: "p1", name: "Demo", path: "/home/private/demo", addedAt: 1 }
    ],
    getProjectById: async () => ({
      id: "p1", name: "Demo", path: "/home/private/demo", addedAt: 1
    }),
    normalizeExistingProjectPath: async path => path,
    fetchOpenCodeJson: async () => [],
    codex: Object.assign(new EventEmitter(), { request: async () => ({}) }),
    json(_res, status, body) {
      writes.push(JSON.stringify({ status, body }));
    },
    readJson: async () => ({}),
    operationId: () => "op-test",
    claimOperation: () => true,
    publicOrigin: "https://devmoter.example.test",
    taskTimeoutMs: 25
  });

  await observable.handle(
    { method: "GET", headers: {}, socket: {} },
    res,
    new URL("https://devmoter.example.test/api/automation/projects")
  );
  await observable.handle(
    { method: "GET", headers: { host: "devmoter.example.test" }, socket: {} },
    res,
    new URL("https://devmoter.example.test/api/automation/open?project=p1")
  );

  const output = writes.join("\n");
  assert.match(output, /"id":"p1"/);
  assert.match(output, /\?project=p1/);
  assert.doesNotMatch(output, /\/home\/private\/demo/);
  void api;
});

test("Codex timeout interrupts the known turn before rejecting", async () => {
  const calls = [];
  const codex = new EventEmitter();
  codex.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") return { turn: { id: "turn-1" } };
    if (method === "turn/interrupt") return { ok: true };
    return {};
  };
  const api = apiWith({ codex, taskTimeoutMs: 20 });

  await assert.rejects(
    api.runCodexTask(
      { id: "p1", name: "Demo", path: "/safe/demo" },
      { agent: "codex", task: "keep working", model: "" },
      { headers: {} },
      () => {}
    ),
    error => error?.status === 504 && error?.code === "task_timeout"
  );

  assert.deepEqual(
    calls.map(call => call.method),
    ["thread/start", "turn/start", "turn/interrupt"]
  );
  assert.deepEqual(calls[2].params, {
    threadId: "thread-1",
    turnId: "turn-1"
  });
});

test("Codex approval returns blocked without auto-approving", async () => {
  const calls = [];
  const codex = new EventEmitter();
  codex.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "turn/start") {
      queueMicrotask(() => {
        codex.emit("server-request", {
          method: "item/commandExecution/requestApproval",
          params: { threadId: "thread-1", command: "echo hi" }
        });
      });
      return { turn: { id: "turn-1" } };
    }
    return {};
  };
  const api = apiWith({ codex, taskTimeoutMs: 1000 });

  const result = await api.runCodexTask(
    { id: "p1", name: "Demo", path: "/safe/demo" },
    { agent: "codex", task: "run", model: "" },
    { headers: {} },
    () => {}
  );

  assert.equal(result.status, "blocked");
  assert.equal(calls.some(call => /approval/i.test(call.method)), false);
});
