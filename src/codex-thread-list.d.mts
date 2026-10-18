export type CodexThreadSummary = {
  id: string;
  name?: string | null;
  preview?: string | null;
  updatedAt?: number | null;
  cwd?: string | null;
};
export function normalizeCodexThreadList(result: unknown): CodexThreadSummary[];
