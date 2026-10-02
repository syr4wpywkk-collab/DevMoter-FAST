export function normalizeModelPricing(value: unknown): Partial<Record<"input" | "output" | "cache_read" | "cache_write", number>> | null;
export function describeModelPricing(value: unknown): { label: string; detail: string };
