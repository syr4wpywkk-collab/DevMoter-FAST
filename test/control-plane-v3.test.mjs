import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ControlPlane,
  cronMatches,
  parseCron,
  verifyGithubSignature
} from "../server/control-plane.mjs";

async function tempControlPlane(executeTask = async () => ({ complete: true, cost: 0 })) {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-control-"));
  const plane = new ControlPlane({ configDir: dir, executeTask });
  return {
    dir,
    plane,
    cleanup: async () => {\n      let lastError;\n      for (let attempt = 0; attempt < 5; attempt += 1) {\n        try {\n          await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });\n          return;\n        } catch (error) {\n          lastError = error;\n          if (error?.code !== "ENOTEMPTY" && error?.code !== "EBUSY") throw error;\n          await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));\n        }\n      }\n      throw lastError;\n    }
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

test("cron parser matches a five-field rule in the requested timezone", () => {
  const date = new Date("2026-09-22T12:30:00.000Z");
  assert.equal(cronMatches("30 12 22 9 2", date, "UTC"), true);
  assert.equal(cronMatches("31 12 22 9 2", date, "UTC"), false);
  assert.throws(() => parseCron("* * *"), /five fields/);
  assert.throws(() => parseCron("60 * * * *"), /out of range/);
});

test("GitHub webhook HMAC verification rejects tampering", () => {
  const secret = "test-secret";
  const body = Buffer.from(JSON.stringify({ action: "opened", number: 111 }));
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyGithubSignature(secret, body, signature), true);
  assert.equal(verifyGithubSignature(secret, Buffer.from("{}"), signature), false);
  assert.equal(verifyGithubSignature(secret, body, "sha256=deadbeef"), false);
});

test("host registry rejects embedded credentials and keeps explicit trust state", async () => {
  const { plane, cleanup } = await tempControlPlane();
  try {
    await assert.rejects(
      () => plane.addHost({ label: "bad", address: "https://user:pass@example.com" }),
      /Credentials must not be embedded/
    );

    const host = await plane.addHost({
      label: "Laptop",
      address: "https://devmoter.example/",
      trustState: "trusted"
    });
    assert.equal(host.address, "https://devmoter.example");
    assert.equal(host.trustState, "trusted");

    const hosts = await plane.listHosts("http://localhost:8787");
    assert.equal(hosts[0].id, "local");
    assert.equal(hosts[1].id, host.id);
  } finally {
    await cleanup();
  }
});

test("remote host health probes run in parallel and expose no credential storage", async () => {
  const { plane, cleanup } = await tempControlPlane();
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  try {
    await plane.addHost({ label: "A", address: "https://a.example", trustState: "unverified" });
    await plane.addHost({ label: "B", address: "https://b.example", trustState: "trusted" });

    globalThis.fetch = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 40));
      active -= 1;
      return new Response(JSON.stringify({ online: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const statuses = await plane.listHostStatuses("http://localhost:8787", { force: true });
    assert.equal(statuses.length, 3);
    assert.ok(maxActive >= 2, "remote health probes should overlap");
    const saved = await plane.listHosts();
    assert.equal(Object.prototype.hasOwnProperty.call(saved[1], "password"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(saved[1], "token"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
  }
});

test("schedules are explicit, pausable, and deletable", async () => {
  const { plane, cleanup } = await tempControlPlane();
  try {
    const schedule = await plane.createSchedule({
      name: "Nightly",
      cron: "0 21 * * *",
      timeZone: "Asia/Tokyo",
      backend: "codex",
      projectId: "project-1",
      model: "gpt-test",
      task: "Review the project"
    });

    assert.equal(schedule.enabled, true);
    assert.equal(schedule.approvalPolicy, "normal");
    assert.equal((await plane.listSchedules()).length, 1);

    const paused = await plane.setScheduleEnabled(schedule.id, false);
    assert.equal(paused.enabled, false);

    await plane.deleteSchedule(schedule.id);
    assert.equal((await plane.listSchedules()).length, 0);
  } finally {
    await cleanup();
  }
});

test("signed event triggers wrap payload as untrusted data and obey rate limits", async () => {
  const executions = [];
  const { plane, cleanup } = await tempControlPlane(async definition => {
    executions.push(definition);
    return { complete: true, cost: 0, summary: "ok" };
  });

  try {
    const created = await plane.createTrigger({
      name: "Issue opened",
      source: "github.webhook",
      event: "issues",
      backend: "codex",
      task: "Triage the issue",
      minIntervalMs: 60_000,
      maxConcurrency: 1
    });

    const listed = await plane.listTriggers();
    assert.equal(Object.prototype.hasOwnProperty.call(listed[0], "secret"), false);

    const raw = Buffer.from(JSON.stringify({ action: "opened", issue: { title: "hello" } }));
    const signature = "sha256=" + createHmac("sha256", created.secret).update(raw).digest("hex");

    const first = await plane.dispatchEvent("github.webhook", "issues", JSON.parse(raw), {
      rawBody: raw,
      signature
    });
    assert.equal(first.length, 1);

    await waitFor(() => executions.length === 1);
    assert.match(executions[0].task, /untrusted data/i);
    assert.match(executions[0].task, /"action":"opened"/);

    const second = await plane.dispatchEvent("github.webhook", "issues", JSON.parse(raw), {
      rawBody: raw,
      signature
    });
    assert.equal(second.length, 0);

    await assert.rejects(
      () => plane.dispatchEvent("github.webhook", "issues", JSON.parse(raw), {
        rawBody: raw,
        signature: "sha256=bad"
      }),
      /GitHub webhook signature verification failed/
    );
  } finally {
    await cleanup();
  }
});

test("autopilot reuses the same backend context across turns", async () => {
  const seen = [];
  const { plane, cleanup } = await tempControlPlane(async (_definition, context) => {
    seen.push(context.backendContext || null);
    const backendContext = context.backendContext || { backend: "codex", threadId: "thread-1" };
    context.setBackendContext?.(backendContext);
    return {
      complete: seen.length >= 2,
      cost: 0,
      summary: "turn " + seen.length,
      context: backendContext
    };
  });

  try {
    const started = await plane.startAutopilot({
      backend: "codex",
      task: "Keep context",
      maxTurns: 4,
      maxMinutes: 5,
      maxBudget: 0
    });

    const completed = await waitFor(async () => {
      const run = (await plane.listRuns()).find(item => item.id === started.id);
      return run && !["queued", "running"].includes(run.status) ? run : null;
    });

    assert.equal(completed.status, "completed");
    assert.equal(completed.turnsCompleted, 2);
    assert.equal(seen[0], null);
    assert.deepEqual(seen[1], { backend: "codex", threadId: "thread-1" });
    assert.equal(Object.prototype.hasOwnProperty.call(completed, "backendContext"), false);
  } finally {
    await cleanup();
  }
});

test("autopilot stops at turn bounds and fails safe when cost telemetry is unavailable", async () => {
  const { plane, cleanup } = await tempControlPlane(async () => ({
    complete: false,
    cost: null,
    summary: "continue"
  }));

  try {
    const boundedTurns = await plane.startAutopilot({
      backend: "codex",
      task: "Do bounded work",
      maxTurns: 3,
      maxMinutes: 5,
      maxBudget: 0
    });

    const completed = await waitFor(async () => {
      const run = (await plane.listRuns()).find(item => item.id === boundedTurns.id);
      return run && !["queued", "running"].includes(run.status) ? run : null;
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.turnsCompleted, 3);

    const budgeted = await plane.startAutopilot({
      backend: "opencode",
      task: "Do budgeted work",
      maxTurns: 10,
      maxMinutes: 5,
      maxBudget: 1
    });

    const stopped = await waitFor(async () => {
      const run = (await plane.listRuns()).find(item => item.id === budgeted.id);
      return run && !["queued", "running"].includes(run.status) ? run : null;
    });
    assert.equal(stopped.status, "bounded");
    assert.equal(stopped.turnsCompleted, 1);
    assert.match(stopped.summary, /did not report cost telemetry/);
  } finally {
    await cleanup();
  }
});

test("malformed control-plane state fails closed instead of resetting triggers and schedules", async () => {
  const { dir, plane, cleanup } = await tempControlPlane();
  try {
    await writeFile(join(dir, "control-plane.json"), "{not-json");
    await assert.rejects(() => plane.listHosts(), /refusing to reset automation state/i);
  } finally {
    await cleanup();
  }
});
