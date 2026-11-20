import { readFile } from "node:fs/promises";
import type { UsageRecord } from "../types.js";
import { isFreeTier, type PricingTable } from "./pricing.js";

export interface BudgetConfig {
  enabled: boolean;
  dailyTotalTokenLimit: number | null;
  dailyPaidTokenLimit: number | null;
  maxConsecutivePaidRuns: number | null;
  onExceed: "downgrade" | "stop";
}

export interface BudgetDecision {
  exceeded: boolean;
  scope: "paid" | "total" | "consecutive" | null;
  action: "downgrade" | "stop" | null;
  reason: string;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function loadBudget(path: string): Promise<BudgetConfig> {
  const data = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  return {
    enabled: data.enabled !== false,
    dailyTotalTokenLimit: numOrNull(data.dailyTotalTokenLimit),
    dailyPaidTokenLimit: numOrNull(data.dailyPaidTokenLimit),
    maxConsecutivePaidRuns: numOrNull(data.maxConsecutivePaidRuns),
    onExceed: data.onExceed === "downgrade" ? "downgrade" : "stop",
  };
}

function tokensOf(rec: UsageRecord): number {
  return (rec.inputTokens ?? 0) + (rec.outputTokens ?? 0);
}

export function evaluateBudget(
  recordsToday: UsageRecord[],
  budget: BudgetConfig,
  pricing: PricingTable,
): BudgetDecision {
  if (!budget.enabled) {
    return {
      exceeded: false,
      scope: null,
      action: null,
      reason: "budget guard disabled",
    };
  }

  let totalTokens = 0;
  let paidTokens = 0;
  for (const rec of recordsToday) {
    const t = tokensOf(rec);
    totalTokens += t;
    if (!isFreeTier(pricing, rec.model)) paidTokens += t;
  }

  if (
    budget.dailyPaidTokenLimit !== null &&
    paidTokens >= budget.dailyPaidTokenLimit
  ) {
    return {
      exceeded: true,
      scope: "paid",
      action: budget.onExceed,
      reason: `paid tokens today ${paidTokens} >= daily paid limit ${budget.dailyPaidTokenLimit}`,
    };
  }

  if (
    budget.dailyTotalTokenLimit !== null &&
    totalTokens >= budget.dailyTotalTokenLimit
  ) {
    return {
      exceeded: true,
      scope: "total",
      action: budget.onExceed,
      reason: `total tokens today ${totalTokens} >= daily total limit ${budget.dailyTotalTokenLimit}`,
    };
  }

  if (budget.maxConsecutivePaidRuns !== null) {
    let consecutive = 0;
    for (let i = recordsToday.length - 1; i >= 0; i--) {
      if (isFreeTier(pricing, recordsToday[i].model)) break;
      consecutive++;
    }
    if (consecutive >= budget.maxConsecutivePaidRuns) {
      return {
        exceeded: true,
        scope: "consecutive",
        action: budget.onExceed,
        reason: `${consecutive} consecutive paid runs >= limit ${budget.maxConsecutivePaidRuns}`,
      };
    }
  }

  return {
    exceeded: false,
    scope: null,
    action: null,
    reason: "within budget",
  };
}
