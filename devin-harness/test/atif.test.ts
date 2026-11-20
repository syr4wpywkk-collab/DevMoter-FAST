import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtifExport, type AtifContext } from "../src/usage/atif.js";

const ctx: AtifContext = {
  taskId: "task-1",
  model: "swe-2-medium",
  effort: "medium",
  startedAt: "2026-11-20T00:00:00.000Z",
  durationMs: null,
  exitStatus: 0,
  timedOut: false,
  runDir: "/tmp/run-1",
  isFreeTierModel: true,
};

const FIXTURE = JSON.stringify({
  schema_version: "ATIF-v1.7",
  session_id: "amusing-gadget",
  agent: { name: "devin", version: "3000.14.30821", model_name: "SWE-2 Medium" },
  steps: [
    {
      step_id: 1,
      timestamp: "2026-11-20T00:00:00.000Z",
      source: "system",
      message: "init",
    },
    {
      step_id: 2,
      timestamp: "2026-11-20T00:00:05.000Z",
      source: "agent",
      message: "working",
      model_name: "SWE-2 Medium",
      tool_calls: [{ name: "read" }, { name: "edit" }],
      metrics: { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 40 },
    },
    {
      step_id: 3,
      timestamp: "2026-11-20T00:00:10.000Z",
      source: "agent",
      message: "done",
      tool_calls: [{ name: "exec" }],
      metrics: { prompt_tokens: 50, completion_tokens: 10, cached_tokens: 10 },
    },
  ],
  final_metrics: {
    total_prompt_tokens: 150,
    total_completion_tokens: 30,
    total_cached_tokens: 50,
    total_steps: 3,
  },
});

test("parseAtifExport extracts final_metrics, session, tool calls", () => {
  const rec = parseAtifExport(FIXTURE, ctx);
  assert.equal(rec.sessionId, "amusing-gadget");
  assert.equal(rec.modelDisplayName, "SWE-2 Medium");
  assert.equal(rec.inputTokens, 150);
  assert.equal(rec.outputTokens, 30);
  assert.equal(rec.cacheReadTokens, 50);
  assert.equal(rec.cacheWriteTokens, null);
  assert.equal(rec.toolCalls, 3);
  assert.equal(rec.durationMs, 10_000);
  assert.equal(rec.taskId, "task-1");
  assert.equal(rec.isFreeTierModel, true);
});

test("parseAtifExport sums step metrics when final_metrics missing", () => {
  const doc = JSON.parse(FIXTURE);
  delete doc.final_metrics;
  const rec = parseAtifExport(JSON.stringify(doc), ctx);
  assert.equal(rec.inputTokens, 150);
  assert.equal(rec.outputTokens, 30);
  assert.equal(rec.cacheReadTokens, 50);
  assert.equal(rec.toolCalls, 3);
});

test("parseAtifExport prefers ctx durationMs", () => {
  const rec = parseAtifExport(FIXTURE, { ...ctx, durationMs: 42_000 });
  assert.equal(rec.durationMs, 42_000);
});

test("parseAtifExport survives broken JSON with null fields", () => {
  const rec = parseAtifExport("{not json", ctx);
  assert.equal(rec.sessionId, null);
  assert.equal(rec.inputTokens, null);
  assert.equal(rec.outputTokens, null);
  assert.equal(rec.cacheReadTokens, null);
  assert.equal(rec.cacheWriteTokens, null);
  assert.equal(rec.toolCalls, null);
  assert.equal(rec.model, "swe-2-medium");

  const recNull = parseAtifExport(null, ctx);
  assert.equal(recNull.inputTokens, null);
  assert.equal(recNull.sessionId, null);
});
