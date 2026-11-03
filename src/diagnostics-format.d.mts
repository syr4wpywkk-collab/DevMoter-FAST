export const UNKNOWN_LABEL: string;
export function formatNodeVersion(value: unknown): string;
export function formatBuildId(value: unknown): string;
export function describeHealthFetch(
  state: { fetchedAt: number | null; failedAt: number | null; loading?: boolean },
  locale?: string
): { tone: "ok" | "error" | "info"; text: string };
