export type RunResultFilter = "all" | "success" | "failed" | "running";
export const RUN_RESULT_STATUSES: Readonly<Record<"success" | "failed" | "running", string[]>>;
export const RUN_RESULT_FILTERS: readonly RunResultFilter[];
export function filterRunsByResult<T extends { status?: unknown }>(runs: T[], filter: string): T[];
export function formatLocalRunTime(value: unknown, locale?: string, timeZone?: string): string;
export function scheduleNextRunView(schedule: unknown): {
  state: "scheduled" | "paused" | "invalid" | "none";
  at: number | null;
};
