import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { JsonlUsageStore, summarizeUsage } from "../src/usage/store.js";
import { evaluateBudget, type BudgetConfig } from "../src/usage/budget.js";
import type { PricingTable } from "../src/usage/pricing.js";
import type { UsageRecord } from "../src/types.js";

const pricing: PricingTable = {
  default: { free: false, quotaWeight: 1 },
  models: {
    "swe-2-medium": { free: true, quotaWeight: 0 },
    adaptive: {
      free: false,
      quotaWeight: 1,
      inputPerM: 0.5,
      cachedPerM: 0.1,
      outputPerM: 2,
    },
  },
};

function rec(partial: Partial<UsageRecord>): UsageRecord {
  return {
    taskId: "t",
    sessionId: null,
    model: "swe-2-medium",
    modelDisplayName: null,
    effort: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: null,
    toolCalls: 0,
    durationMs: null,
    exitStatus: 0,
    timedOut: false,
    isFreeTierModel: false,
    startedAt: "2026-11-20T00:00:00.000Z",
    runDir: "/tmp/r",
    ...partial,
  };
}

test("JsonlUsageStore round-trips and skips corrupt lines", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-usage-"));
  const file = path.join(dir, "nested", "usage.jsonl");
  const store = new JsonlUsageStore(file);
  await store.append(rec({ taskId: "a", inputTokens: 10 }));
  await store.append(rec({ taskId: "b", inputTokens: 20 }));

  const all = await store.readAll();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.taskId), ["a", "b"]);

  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, "{broken line\n", "utf8");
  const after = await store.readAll();
  assert.equal(after.length, 2);

  const since = await store.readSince("2026-11-19T00:00:00.000Z");
  assert.equal(since.length, 2);
  const none = await store.readSince("2026-11-21T00:00:00.000Z");
  assert.equal(none.length, 0);
});

test("summarizeUsage separates free and paid tokens", () => {
  const records = [
    rec({ model: "swe-2-medium", inputTokens: 1000, outputTokens: 500 }),
    rec({
      model: "adaptive",
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 500,
    }),
  ];
  const summary = summarizeUsage(records, pricing);
  assert.equal(summary.runs, 2);
  assert.equal(summary.freeTokens, 1500);
  assert.equal(summary.paidTokens, 3000);
  assert.equal(summary.freeRatio, 1500 / 4500);
  // adaptive: (2000-500)*0.5 + 500*0.1 + 1000*2 = 750+50+2000 = 2800 / 1e6
  assert.ok(Math.abs(summary.estCostUsd - 0.0028) < 1e-9);
  assert.equal(summary.byModel.length, 2);
  assert.equal(
    summary.byModel.find((m) => m.model === "swe-2-medium")?.free,
    true,
  );

  const empty = summarizeUsage([], pricing);
  assert.equal(empty.freeRatio, 1);
});

const budget: BudgetConfig = {
  enabled: true,
  dailyTotalTokenLimit: 100_000,
  dailyPaidTokenLimit: 5_000,
  maxConsecutivePaidRuns: 3,
  onExceed: "downgrade",
};

test("evaluateBudget: paid limit exceeded", () => {
  const records = [
    rec({ model: "adaptive", inputTokens: 4000, outputTokens: 2000 }),
  ];
  const decision = evaluateBudget(records, budget, pricing);
  assert.equal(decision.exceeded, true);
  assert.equal(decision.scope, "paid");
  assert.equal(decision.action, "downgrade");
});

test("evaluateBudget: consecutive paid runs exceeded", () => {
  const small: BudgetConfig = {
    ...budget,
    dailyPaidTokenLimit: null,
    dailyTotalTokenLimit: null,
  };
  const records = [
    rec({ model: "swe-2-medium", inputTokens: 10, outputTokens: 10 }),
    rec({ model: "adaptive", inputTokens: 10, outputTokens: 10 }),
    rec({ model: "adaptive", inputTokens: 10, outputTokens: 10 }),
    rec({ model: "adaptive", inputTokens: 10, outputTokens: 10 }),
  ];
  const decision = evaluateBudget(records, small, pricing);
  assert.equal(decision.exceeded, true);
  assert.equal(decision.scope, "consecutive");

  const two = evaluateBudget(records.slice(0, 3), small, pricing);
  assert.equal(two.exceeded, false);
});

test("evaluateBudget: disabled never exceeds", () => {
  const records = [
    rec({ model: "adaptive", inputTokens: 10_000_000, outputTokens: 1 }),
  ];
  const decision = evaluateBudget(
    records,
    { ...budget, enabled: false },
    pricing,
  );
  assert.equal(decision.exceeded, false);
});
