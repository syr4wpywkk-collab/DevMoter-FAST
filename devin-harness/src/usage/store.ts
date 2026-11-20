import { appendFile, mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import type { UsageRecord } from "../types.js";
import { estimateCostUsd, isFreeTier, type PricingTable } from "./pricing.js";

export class JsonlUsageStore {
  constructor(private readonly filePath: string) {}

  async append(rec: UsageRecord): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(rec) + "\n", "utf8");
  }

  async readAll(): Promise<UsageRecord[]> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const out: UsageRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          out.push(parsed as UsageRecord);
        }
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  async readSince(isoDate: string): Promise<UsageRecord[]> {
    const since = Date.parse(isoDate);
    const all = await this.readAll();
    if (!Number.isFinite(since)) return all;
    return all.filter((rec) => {
      const t = Date.parse(rec.startedAt);
      return Number.isFinite(t) && t >= since;
    });
  }
}

export interface UsageSummary {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCalls: number;
  estCostUsd: number;
  freeTokens: number;
  paidTokens: number;
  freeRatio: number;
  byModel: Array<{
    model: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estCostUsd: number;
    free: boolean;
  }>;
}

export function summarizeUsage(
  records: UsageRecord[],
  pricing: PricingTable,
): UsageSummary {
  const summary: UsageSummary = {
    runs: records.length,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    toolCalls: 0,
    estCostUsd: 0,
    freeTokens: 0,
    paidTokens: 0,
    freeRatio: 1,
    byModel: [],
  };
  const groups = new Map<string, UsageSummary["byModel"][number]>();

  for (const rec of records) {
    const input = rec.inputTokens ?? 0;
    const output = rec.outputTokens ?? 0;
    const cacheRead = rec.cacheReadTokens ?? 0;
    const cost = estimateCostUsd(rec, pricing) ?? 0;
    const free = isFreeTier(pricing, rec.model);

    summary.inputTokens += input;
    summary.outputTokens += output;
    summary.cacheReadTokens += cacheRead;
    summary.toolCalls += rec.toolCalls ?? 0;
    summary.estCostUsd += cost;
    if (free) summary.freeTokens += input + output;
    else summary.paidTokens += input + output;

    let group = groups.get(rec.model);
    if (!group) {
      group = {
        model: rec.model,
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        estCostUsd: 0,
        free,
      };
      groups.set(rec.model, group);
    }
    group.runs += 1;
    group.inputTokens += input;
    group.outputTokens += output;
    group.cacheReadTokens += cacheRead;
    group.estCostUsd += cost;
  }

  summary.byModel = [...groups.values()];
  const total = summary.freeTokens + summary.paidTokens;
  summary.freeRatio = total === 0 ? 1 : summary.freeTokens / total;
  return summary;
}
