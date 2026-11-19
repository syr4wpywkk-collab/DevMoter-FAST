import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ControlPlane,
  failureReasonSummary,
  nextCronRun,
  scheduleNextRun
} from "../server/control-plane.mjs";
import { filterRunsByResult, formatLocalRunTime, scheduleNextRunView } from "../src/automation-view.mjs";

async function tempPlane(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-automation-"));
  const plane = new ControlPlane({ configDir: dir, executeTask: async () => ({ summary: "ok" }), ...options });
  return { dir, plane, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) };
}

async function settle(plane, predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const runs = await plane.listRuns();
    if (predicate(runs)) return runs;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("runs did not settle");
}

// A run's endedAt becomes visible before its final state write and its
// concurrency slot release finish, so wait for those instead of racing them.
async function eventually(read, done) {
  let value;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      value = await read();
      if (done(value)) return value;
    } catch (error) {
      value = error;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (value instanceof Error) throw value;
  return value;
}

const definition = { name: "Nightly", cron: "0 21 * * *", timeZone: "Asia/Tokyo", backend: "codex", task: "Review" };

test("#462 next run is computed in the schedule timezone and shown in device-local time", () => {
  const from = new Date("2026-11-20T00:00:00Z");
  assert.equal(nextCronRun("0 21 * * *", "Asia/Tokyo", from), Date.parse("2026-11-20T12:00:00Z"));
  assert.equal(nextCronRun("0 21 * * *", "Asia/Tokyo", new Date("2026-11-20T12:00:00Z")), Date.parse("2026-11-21T12:00:00Z"));
  assert.equal(nextCronRun("30 2 1 1 *", "UTC", from), Date.parse("2027-01-01T02:30:00Z"));
  assert.equal(nextCronRun("0 0 31 2 *", "UTC", from), null);

  const text = formatLocalRunTime(Date.parse("2026-11-20T12:00:00Z"), "en-US", "America/New_York");
  assert.match(text, /Nov 20, 2026/);
  assert.match(text, /7:00/);
  assert.match(text, /EST/);
  assert.equal(formatLocalRunTime("not a date"), "");
});

test("#462 invalid rules are reported separately from paused schedules", () => {
  const now = new Date("2026-11-20T00:00:00Z");
  assert.equal(scheduleNextRun({ ...definition, enabled: true }, now).nextRunState, "scheduled");
  assert.deepEqual(scheduleNextRun({ ...definition, enabled: false }, now), { nextRunState: "paused", nextRunAt: null });
  assert.equal(scheduleNextRun({ ...definition, cron: "99 * * * *", enabled: false }, now).nextRunState, "invalid");
  assert.equal(scheduleNextRun({ ...definition, timeZone: "Nowhere/None", enabled: true }, now).nextRunState, "invalid");
  assert.equal(scheduleNextRun({ ...definition, cron: "0 0 31 2 *", enabled: true }, now).nextRunState, "none");

  assert.equal(scheduleNextRunView({ enabled: false, nextRunState: "invalid" }).state, "invalid");
  assert.equal(scheduleNextRunView({ enabled: false, nextRunState: "paused" }).state, "paused");
  assert.equal(scheduleNextRunView({ enabled: true, nextRunState: "scheduled", nextRunAt: 5 }).at, 5);
  assert.equal(scheduleNextRunView({ enabled: true }).state, "invalid");
});

test("#463 pause persists across a restart and a paused schedule never runs", async () => {
  const calls = [];
  const { dir, plane, cleanup } = await tempPlane({ executeTask: async task => { calls.push(task.task); return {}; } });
  try {
    const schedule = await plane.createSchedule(definition);
    assert.equal(schedule.nextRunState, "scheduled");
    await assert.rejects(plane.setScheduleEnabled(schedule.id, "false"), /true or false/);
    const paused = await plane.setScheduleEnabled(schedule.id, false);
    assert.equal(paused.nextRunState, "paused");
    assert.ok(paused.pausedAt);

    const reopened = new ControlPlane({ configDir: dir, executeTask: async task => { calls.push(task.task); return {}; } });
    const due = new Date("2026-11-20T12:00:00Z");
    await reopened.tick(due);
    assert.equal((await reopened.listSchedules())[0].enabled, false);
    assert.equal(calls.length, 0);
    assert.equal((await reopened.listRuns()).length, 0);

    const resumed = await reopened.setScheduleEnabled(schedule.id, true);
    assert.equal(resumed.pausedAt, null);
    assert.equal((await reopened.listSchedules()).length, 1);
    await reopened.tick(due);
    await settle(reopened, runs => runs.length === 1 && runs[0].status === "completed");
    assert.deepEqual(calls, ["Review"]);
  } finally {
    await cleanup();
  }
});

test("#464 preview describes the schedule without saving or running it", async () => {
  let executed = 0;
  const { plane, cleanup } = await tempPlane({
    executeTask: async () => { executed += 1; return {}; },
    resolveProject: async id => {
      if (id !== "p1") throw new Error("Project not found");
      return { id, name: "Demo", path: "/secret/path" };
    }
  });
  try {
    const preview = await plane.previewSchedule({ ...definition, projectId: "p1" }, new Date("2026-11-20T00:00:00Z"));
    assert.equal(preview.saved, false);
    assert.equal(preview.id, undefined);
    assert.deepEqual(preview.project, { id: "p1", name: "Demo" });
    assert.equal(preview.approvalPolicy, "normal");
    assert.deepEqual(preview.upcomingRuns, [
      Date.parse("2026-11-20T12:00:00Z"), Date.parse("2026-11-21T12:00:00Z"), Date.parse("2026-11-22T12:00:00Z")
    ]);
    assert.equal((await plane.previewSchedule({ ...definition, projectId: "gone" })).projectMissing, true);
    await assert.rejects(plane.previewSchedule({ ...definition, cron: "bad" }));
    await assert.rejects(plane.previewSchedule({ ...definition, timeZone: "Nowhere/None" }), /timezone/);
    await assert.rejects(plane.previewSchedule({ ...definition, task: "" }), /Task is required/);

    assert.equal((await plane.listSchedules()).length, 0);
    assert.equal((await plane.listRuns()).length, 0);
    assert.equal(executed, 0);
  } finally {
    await cleanup();
  }
});

test("#465 run history filters by result without changing stored history", async () => {
  const { dir, plane, cleanup } = await tempPlane({
    executeTask: async task => { if (task.task === "fail") throw new Error("boom"); return {}; }
  });
  try {
    await plane.createSchedule({ ...definition, task: "ok" });
    await plane.createSchedule({ ...definition, task: "fail" });
    await plane.tick(new Date("2026-11-20T12:00:00Z"));
    await settle(plane, runs => runs.length === 2 && runs.every(run => run.endedAt));
    const before = await eventually(
      () => readFile(join(dir, "control-plane.json"), "utf8"),
      text => JSON.parse(text).runs?.filter(run => run.endedAt).length === 2
    );

    assert.deepEqual((await plane.listRuns({ result: "success" })).map(run => run.status), ["completed"]);
    assert.deepEqual((await plane.listRuns({ result: "failed" })).map(run => run.status), ["failed"]);
    assert.equal((await plane.listRuns({ result: "running" })).length, 0);
    assert.equal((await plane.listRuns({ result: "all" })).length, 2);
    await assert.rejects(plane.listRuns({ result: "nope" }), /Unknown run result filter/);
    assert.equal(await readFile(join(dir, "control-plane.json"), "utf8"), before);

    const runs = [{ status: "completed" }, { status: "failed" }, { status: "running" }, { status: "queued" }, { status: "paused" }];
    assert.equal(filterRunsByResult(runs, "success").length, 1);
    assert.equal(filterRunsByResult(runs, "failed").length, 1);
    assert.equal(filterRunsByResult(runs, "running").length, 2);
    assert.equal(filterRunsByResult(runs, "all").length, 5);
    assert.equal(runs.length, 5);
  } finally {
    await cleanup();
  }
});

test("#466 failure summaries are redacted server-side and unknown reasons stay unknown", async () => {
  const configured = "configured-provider-secret";
  const redact = text => String(text).split(configured).join("[REDACTED]");
  assert.equal(failureReasonSummary("", redact), null);
  assert.equal(failureReasonSummary("Unexpected error", redact), null);
  const summary = failureReasonSummary(
    `Request failed: ${configured} Authorization: Bearer abcdefgh12345678 api_key=sk-abcdefghijklmnop url https://user:hunter2@example.com/x\nstack line`,
    redact
  );
  for (const leaked of [configured, "abcdefgh12345678", "sk-abcdefghijklmnop", "hunter2", "stack line"]) {
    assert.ok(!summary.includes(leaked), `${leaked} must be redacted`);
  }
  assert.match(summary, /^Request failed/);
  assert.ok(failureReasonSummary("x".repeat(1000)).length <= 240);

  const { plane, cleanup } = await tempPlane({
    redact,
    executeTask: async task => { throw new Error(task.task === "silent" ? "" : `upstream rejected token=ghp_abcdefghijklmnopqrstu ${configured}`); }
  });
  try {
    await plane.createSchedule({ ...definition, task: "loud" });
    await plane.createSchedule({ ...definition, task: "silent" });
    await plane.tick(new Date("2026-11-20T12:00:00Z"));
    const runs = await settle(plane, list => list.length === 2 && list.every(run => run.endedAt));
    const loud = runs.find(run => run.task === "loud");
    const silent = runs.find(run => run.task === "silent");
    assert.match(loud.failureReason, /^upstream rejected token=\[REDACTED\]/);
    assert.ok(!JSON.stringify(runs).includes(configured));
    assert.ok(!JSON.stringify(runs).includes("ghp_abcdefghijklmnopqrstu"));
    assert.equal(silent.failureReason, null);
  } finally {
    await cleanup();
  }
});

test("#467 a failed run is retried only once, on explicit confirmation", async () => {
  let attempts = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { plane, cleanup } = await tempPlane({
    executeTask: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("write outcome unknown");
      await gate;
      return { summary: "done" };
    }
  });
  try {
    await plane.createSchedule(definition);
    await plane.tick(new Date("2026-11-20T12:00:00Z"));
    const [failed] = await settle(plane, runs => runs.length === 1 && runs[0].status === "failed");
    assert.equal(failed.retryable, true);

    // Later ticks never re-run the failed minute by themselves.
    await plane.tick(new Date("2026-11-20T12:00:30Z"));
    assert.equal(attempts, 1);

    for (const confirm of [undefined, false, "true", 1]) {
      await assert.rejects(plane.retryRun(failed.id, { confirm }), error => error.confirmationRequired === true && error.status === 409);
    }
    await assert.rejects(plane.retryRun(failed.id), /explicit confirmation/);
    await assert.rejects(plane.retryRun("missing", { confirm: true }), /Run not found/);
    assert.equal(attempts, 1);

    const retry = await plane.retryRun(failed.id, { confirm: true });
    assert.equal(retry.retryOf, failed.id);
    await assert.rejects(plane.retryRun(failed.id, { confirm: true }), /already in progress/);
    assert.equal((await plane.listRuns()).find(run => run.id === failed.id).retryable, false);
    release();
    const runs = await settle(plane, list => list.length === 2 && list.every(run => run.endedAt));
    const rerun = runs.find(run => run.id === retry.runId);
    assert.equal(rerun.status, "completed");
    assert.equal(rerun.retryOf, failed.id);
    assert.equal(attempts, 2);
    await assert.rejects(plane.retryRun(rerun.id, { confirm: true }), /Only a failed run/);
    assert.equal(runs.find(run => run.id === failed.id).status, "failed");
  } finally {
    await cleanup();
  }
});

test("new automation routes stay inside the authenticated control router", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function controlRoute");
  const end = source.indexOf("\nasync function ", start + 1);
  const body = source.slice(start, end);
  assert.match(body, /\/api\/control\/schedules\/preview/);
  const retry = body.indexOf("runRetryMatch && req.method");
  assert.ok(retry > 0);
  const region = body.slice(retry, retry + 700);
  assert.ok(region.indexOf("payload?.confirm !== true") < region.indexOf("controlPlane.retryRun"), "confirmation is checked before the retry starts");
  assert.match(region, /claimOperation/);
  const preview = body.slice(body.indexOf("/api/control/schedules/preview"), body.indexOf("/api/control/schedules/preview") + 250);
  assert.doesNotMatch(preview, /createSchedule|tick\(|retryRun/);
});

test("next run stays in step with tick() across DST changes", () => {
  // Chatham Islands: 02:45 -> 03:45 on 2026-09-27 (UTC+12:45 -> +13:45).
  assert.equal(
    nextCronRun("45 3 * * *", "Pacific/Chatham", new Date("2026-09-26T12:00:00Z")),
    Date.parse("2026-09-26T14:00:00Z")
  );
  // New York: 01:30 happens twice on 2026-11-01; the second one never runs.
  const first = Date.parse("2026-11-01T05:30:00Z");
  assert.equal(nextCronRun("30 1 * * *", "America/New_York", new Date("2026-11-01T04:00:00Z")), first);
  assert.equal(
    scheduleNextRun({ cron: "30 1 * * *", timeZone: "America/New_York", enabled: true, lastRunKey: "2026-11-01T01:30" }, new Date(first)).nextRunAt,
    Date.parse("2026-11-02T06:30:00Z")
  );
});

test("retrying a trigger run respects the trigger's concurrency limit", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const { plane, cleanup } = await tempPlane({
    executeTask: async () => {
      calls += 1;
      if (calls === 1) throw new Error("first failed");
      await gate;
      return {};
    }
  });
  try {
    await plane.createTrigger({ source: "devmoter.lifecycle", event: "server.started", task: "Do it", maxConcurrency: 1, minIntervalMs: 1000 });
    await plane.dispatchEvent("devmoter.lifecycle", "server.started", {});
    const [failed] = await settle(plane, runs => runs.length === 1 && runs[0].status === "failed");
    await new Promise(resolve => setTimeout(resolve, 1100));
    await plane.dispatchEvent("devmoter.lifecycle", "server.started", {});
    await settle(plane, runs => runs.length === 2);
    await assert.rejects(plane.retryRun(failed.id, { confirm: true }), /concurrency limit/);
    assert.equal((await plane.listRuns()).length, 2);
    release();
    await settle(plane, runs => runs.every(run => run.endedAt));
    const retry = await eventually(() => plane.retryRun(failed.id, { confirm: true }), value => !(value instanceof Error));
    await settle(plane, runs => runs.find(run => run.id === retry.runId)?.status === "completed");
  } finally {
    await cleanup();
  }
});
