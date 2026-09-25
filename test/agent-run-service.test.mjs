import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentRunService } from "../server/agent-run-service.mjs";

class FakeCodex extends EventEmitter {
  constructor() {
    super();
    this.thread = 0;
    this.turn = 0;
    this.calls = [];
    this.approvals = [];
  }

  async request(method, params = {}) {
    this.calls.push({ method, params });
    if (method === "thread/start") {
      this.thread += 1;
      return { thread: { id: `thread-${this.thread}` }, model: params.model || "model-x" };
    }
    if (method === "turn/start") {
      this.turn += 1;
      return { turn: { id: `turn-${this.turn}` } };
    }
    if (method === "turn/interrupt") return { ok: true };
    throw new Error("Unexpected Codex method: " + method);
  }

  respondApproval(id, decision) {
    this.approvals.push({ id, decision });
  }
}

test("host agent service owns run lifecycle and persists authoritative capability policy", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-agent-host-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = join(dir, "agent-runs.json");
  const codex = new FakeCodex();
  const service = createAgentRunService({ filePath, codex });
  t.after(() => service.dispose());

  const run = await service.spawn({
    backend: "codex",
    parentSessionId: "parent",
    role: "reviewer",
    task: "Review safely",
    context: { projectId: "project-1" },
    capabilityPolicy: {
      allow: ["read", "git"],
      deny: ["files", "commands", "network"],
      mutationPolicy: "read-only-until-explicit-transition"
    }
  });

  assert.equal(run.state, "running");
  assert.equal(run.sessionId, "thread-1");
  assert.deepEqual(run.capabilityPolicy.allow, ["read", "git"]);

  codex.emit("server-request", {
    id: 41,
    method: "item/commandExecution/requestApproval",
    params: { threadId: run.sessionId, command: "touch nope" }
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(codex.approvals, [{ id: 41, decision: "decline" }]);
  assert.equal((await service.getRun(run.id)).pendingApproval, null);

  codex.emit("notification", {
    method: "item/agentMessage/delta",
    params: { threadId: run.sessionId, delta: "hello" }
  });
  codex.emit("notification", {
    method: "turn/completed",
    params: { threadId: run.sessionId, turn: { id: run.turnId, status: "completed" } }
  });
  await new Promise(resolve => setTimeout(resolve, 10));

  const completed = await service.getRun(run.id);
  assert.equal(completed.output, "hello");
  assert.equal(completed.state, "completed");

  const persisted = JSON.parse(await readFile(filePath, "utf8"));
  const stored = persisted.runs.find(item => item.id === run.id);
  assert.deepEqual(stored.capabilityPolicy.allow, ["read", "git"]);
  assert.equal(stored.state, "completed");
});

test("host fleet scheduler starts queued siblings without a live browser", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-agent-fleet-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const codex = new FakeCodex();
  const service = createAgentRunService({
    filePath: join(dir, "agent-runs.json"),
    codex
  });
  t.after(() => service.dispose());

  const specs = ["one", "two", "three"].map(task => ({
    backend: "codex",
    parentSessionId: "parent",
    task,
    context: { projectId: "project-1" },
    capabilityPolicy: { allow: ["read"], deny: ["files", "commands", "network"] }
  }));

  const fleet = await service.runFleet(specs, { id: "fleet-host", concurrency: 1 });
  assert.equal(fleet.runIds.length, 1);
  assert.equal(fleet.queued, 2);

  const first = (await service.list()).runs.find(run => run.fleetId === "fleet-host");
  codex.emit("notification", {
    method: "turn/completed",
    params: { threadId: first.sessionId, turn: { id: first.turnId, status: "completed" } }
  });

  await new Promise(resolve => setTimeout(resolve, 15));
  const state = await service.list();
  const fleetAfter = state.fleets.find(item => item.id === "fleet-host");
  assert.equal(fleetAfter.runIds.length, 2);
  assert.equal(fleetAfter.queued, 1);
  assert.equal(state.runs.filter(run => run.fleetId === "fleet-host").length, 2);
});

test("persisted active runs fail closed after host restart instead of silently re-executing", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-agent-restart-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = join(dir, "agent-runs.json");

  const firstCodex = new FakeCodex();
  const first = createAgentRunService({ filePath, codex: firstCodex });
  const run = await first.spawn({
    parentSessionId: "parent",
    task: "long running",
    context: { projectId: "project-1" }
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  await first.dispose();

  const secondCodex = new FakeCodex();
  const second = createAgentRunService({ filePath, codex: secondCodex });
  t.after(() => second.dispose());
  await second.ready();

  const restored = await second.getRun(run.id);
  assert.equal(restored.state, "failed");
  assert.match(restored.error, /Host restarted/);
  assert.equal(secondCodex.calls.length, 0);
});
