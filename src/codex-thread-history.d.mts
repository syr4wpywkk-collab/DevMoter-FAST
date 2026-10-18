export function normalizeCodexThreadHistory(result: unknown): {
  status?: Record<string, any>;
  turns: Array<{ id?: string; status?: string; error?: unknown; items?: Record<string, any>[] }>;
};
