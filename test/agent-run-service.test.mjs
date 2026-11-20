import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codexExecutionSettingsFor, createAgentRunService } from "../server/agent-run-service.mjs";

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

const resolveProject = async id => {
  if (id !== "project-1") throw new Error("Project not found");
  return { id, path: "/srv/projects/project-1" };
};

async function tempFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-agent-sec-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "agent-runs.json");
}

test("host agent service owns run lifecycle and persists authoritative capability policy", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-agent-host-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = join(dir, "agent-runs.json");
  const codex = new FakeCodex();
  const service = createAgentRunService({ filePath, codex, resolveProject });
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
  assert.deepEqual(codex.calls[0], {
    method: "thread/start",
    params: { cwd: "/srv/projects/project-1", sandbox: "read-only", approvalPolicy: "untrusted" }
  });
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

  const completed = await service.getRun(run.id);
  assert.equal(completed.output, "hello");
  assert.equal(completed.state, "completed");

  await service.flushPersistence();
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
    codex,
    resolveProject
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
  const first = createAgentRunService({ filePath, codex: firstCodex, resolveProject });
  const run = await first.spawn({
    parentSessionId: "parent",
    task: "long running",
    context: { projectId: "project-1" }
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  await first.dispose();

  const secondCodex = new FakeCodex();
  const second = createAgentRunService({ filePath, codex: secondCodex, resolveProject });
  t.after(() => second.dispose());
  await second.ready();

  const restored = await second.getRun(run.id);
  assert.equal(restored.state, "failed");
  assert.match(restored.error, /Host restarted/);
  assert.equal(secondCodex.calls.length, 0);
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.runs.find(item => item.id === run.id).state, "failed");
  assert.equal((await stat(filePath)).mode & 0o077, 0);
  // A background persist may still be renaming its temp file; wait for it to settle.
  let entries = await readdir(dir);
  for (let i = 0; i < 50 && entries.length !== 1; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 20));
    entries = await readdir(dir);
  }
  assert.deepEqual(entries, ["agent-runs.json"]);
});

test("a failed state replacement cleans up its temporary file and later writes can recover", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-agent-write-failure-"));
  const filePath = join(dir, "agent-runs.json");
  const service = createAgentRunService({ filePath, codex: new FakeCodex(), resolveProject });
  t.after(async () => {
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  await service.ready();
  await mkdir(filePath);
  const errors = t.mock.method(console, "error", () => {});

  const run = await service.spawn({
    parentSessionId: "parent",
    task: "Run with temporarily unavailable state storage",
    context: { projectId: "project-1" }
  });
  assert.equal(run.state, "running");
  assert.deepEqual(await readdir(dir), ["agent-runs.json"]);
  assert.ok(errors.mock.calls.some(({ arguments: args }) => args[0] === "Agent run state persistence failed"));

  await rmdir(filePath);
  await service.flushPersistence();
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.runs.find(item => item.id === run.id).state, "running");
  assert.deepEqual(await readdir(dir), ["agent-runs.json"]);
});

test("capability policy maps to an enforced Codex sandbox and approval policy", () => {
  assert.deepEqual(codexExecutionSettingsFor(undefined), {});
  assert.deepEqual(codexExecutionSettingsFor({ deny: ["files"] }), { sandbox: "read-only" });
  assert.deepEqual(
    codexExecutionSettingsFor({ deny: ["commands"] }),
    { sandbox: "read-only", approvalPolicy: "untrusted" }
  );
  assert.deepEqual(
    codexExecutionSettingsFor({ mutationPolicy: "read-only-until-explicit-transition" }),
    { sandbox: "read-only" }
  );
});

test("subagents only start in a registered project and never forward the project id to Codex", async t => {
  const codex = new FakeCodex();
  assert.throws(() => createAgentRunService({ filePath: "x", codex }), /project resolver/);
  const service = createAgentRunService({ filePath: await tempFile(t), codex, resolveProject });
  t.after(() => service.dispose());

  await assert.rejects(
    service.spawn({ parentSessionId: "parent", task: "escape", context: { projectId: "../../etc" } }),
    /Project not found/
  );
  assert.equal(codex.calls.length, 0);

  await service.spawn({ parentSessionId: "parent", task: "ok", context: { projectId: "project-1" } });
  const start = codex.calls.find(call => call.method === "thread/start");
  assert.equal(start.params.cwd, "/srv/projects/project-1");
  assert.equal("projectId" in start.params, false);
  // Unrestricted runs inherit the host's Codex sandbox and approval settings unchanged.
  assert.deepEqual(Object.keys(start.params), ["cwd"]);

  const spaced = createAgentRunService({
    filePath: await tempFile(t),
    codex,
    resolveProject: async () => ({ path: "/srv/projects/trailing " })
  });
  t.after(() => spaced.dispose());
  await spaced.spawn({ parentSessionId: "parent", task: "space", context: { projectId: "p" } });
  assert.equal(codex.calls.filter(call => call.method === "thread/start").at(-1).params.cwd, "/srv/projects/trailing ");
});

test("required sandbox mode blocks subagent start and approval acceptance", async t => {
  const codex = new FakeCodex();
  let blocked = true;
  const service = createAgentRunService({
    filePath: await tempFile(t),
    codex,
    resolveProject,
    assertExecutionAllowed: () => {
      if (blocked) throw new Error("DEVMOTER_SANDBOX=required blocks external backend agent execution");
    }
  });
  t.after(() => service.dispose());
  const spec = { parentSessionId: "parent", task: "work", context: { projectId: "project-1" } };

  await assert.rejects(service.spawn(spec), /DEVMOTER_SANDBOX=required/);
  assert.equal(codex.calls.length, 0);

  blocked = false;
  const run = await service.spawn(spec);
  codex.emit("server-request", {
    id: 7,
    method: "item/commandExecution/requestApproval",
    params: { threadId: run.sessionId, command: "npm test" }
  });
  assert.equal((await service.getRun(run.id)).state, "waiting_for_approval");

  await assert.rejects(service.respondApproval(run.id, "acceptForSession"), /one request at a time/);
  blocked = true;
  await assert.rejects(service.respondApproval(run.id, "accept"), /DEVMOTER_SANDBOX=required/);
  assert.deepEqual(codex.approvals, []);
  blocked = false;
  await service.respondApproval(run.id, "accept");
  assert.deepEqual(codex.approvals, [{ id: 7, decision: "accept" }]);
});

test("runs are bounded in wall-clock time and output size, and stay terminal", async t => {
  const codex = new FakeCodex();
  const service = createAgentRunService({ filePath: await tempFile(t), codex, resolveProject, maxRunMs: 30 });
  t.after(() => service.dispose());
  const run = await service.spawn({ parentSessionId: "parent", task: "loop", context: { projectId: "project-1" } });

  const chunk = "x".repeat(150_000);
  for (let i = 0; i < 4; i += 1) {
    codex.emit("notification", { method: "item/agentMessage/delta", params: { threadId: run.sessionId, delta: chunk } });
  }
  const capped = await service.getRun(run.id);
  assert.equal(capped.output.length, 400_000);
  assert.equal(capped.outputTruncated, true);

  await new Promise(resolve => setTimeout(resolve, 80));
  const timedOut = await service.getRun(run.id);
  assert.equal(timedOut.state, "failed");
  assert.match(timedOut.error, /execution time limit/);
  assert.ok(codex.calls.some(call => call.method === "turn/interrupt" && call.params.threadId === run.sessionId));

  codex.emit("notification", { method: "turn/started", params: { threadId: run.sessionId, turn: { id: "late" } } });
  codex.emit("server-request", {
    id: 9,
    method: "item/commandExecution/requestApproval",
    params: { threadId: run.sessionId, command: "rm -rf ." }
  });
  assert.equal((await service.getRun(run.id)).state, "failed");
  assert.deepEqual(codex.approvals, [{ id: 9, decision: "decline" }]);
});
