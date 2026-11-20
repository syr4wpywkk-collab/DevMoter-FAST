import { readFile } from "node:fs/promises";
import type { UsageRecord } from "../types.js";

export interface PricingEntry {
  free: boolean;
  quotaWeight: number;
  inputPerM?: number;
  cachedPerM?: number;
  outputPerM?: number;
}

export interface PricingTable {
  models: Record<string, PricingEntry>;
  default: PricingEntry;
}

function normalizeEntry(raw: unknown): PricingEntry {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const entry: PricingEntry = {
    free: obj.free === true,
    quotaWeight: typeof obj.quotaWeight === "number" ? obj.quotaWeight : 1,
  };
  if (typeof obj.inputPerM === "number") entry.inputPerM = obj.inputPerM;
  if (typeof obj.cachedPerM === "number") entry.cachedPerM = obj.cachedPerM;
  if (typeof obj.outputPerM === "number") entry.outputPerM = obj.outputPerM;
  return entry;
}

export async function loadPricing(path: string): Promise<PricingTable> {
  const data = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  const rawModels = (data.models ?? {}) as Record<string, unknown>;
  const models: Record<string, PricingEntry> = {};
  for (const [id, raw] of Object.entries(rawModels)) {
    models[id] = normalizeEntry(raw);
  }
  return {
    models,
    default: data.default
      ? normalizeEntry(data.default)
      : { free: false, quotaWeight: 1 },
  };
}

export function priceFor(pricing: PricingTable, modelId: string): PricingEntry {
  return pricing.models[modelId] ?? pricing.default;
}

export function isFreeTier(pricing: PricingTable, modelId: string): boolean {
  return priceFor(pricing, modelId).free;
}

/**
 * Estimate USD cost. Free models cost 0. Returns null when the model has
 * no unit prices or the record has no token counts. Cached tokens are
 * billed at the cached rate; the rest of the input at the input rate.
 * If cacheRead exceeds input, the whole input is treated as cached.
 */
export function estimateCostUsd(
  rec: UsageRecord,
  pricing: PricingTable,
): number | null {
  const entry = priceFor(pricing, rec.model);
  if (entry.free) return 0;
  if (entry.inputPerM === undefined || entry.outputPerM === undefined) {
    return null;
  }
  if (rec.inputTokens === null || rec.outputTokens === null) return null;

  const input = Math.max(0, rec.inputTokens);
  const output = Math.max(0, rec.outputTokens);
  let cacheRead = Math.max(0, rec.cacheReadTokens ?? 0);
  if (cacheRead > input) cacheRead = input;
  const cachedRate = entry.cachedPerM ?? entry.inputPerM;

  return (
    ((input - cacheRead) * entry.inputPerM +
      cacheRead * cachedRate +
      output * entry.outputPerM) /
    1_000_000
  );
}
