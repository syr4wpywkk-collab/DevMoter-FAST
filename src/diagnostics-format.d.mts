export const UNKNOWN_LABEL: string;
export function unknownLabel(language?: unknown): string;
export function formatNodeVersion(value: unknown, language?: unknown): string;
export function formatBuildId(value: unknown, language?: unknown): string;
export function describeHealthFetch(
  state: { fetchedAt: number | null; failedAt: number | null; loading?: boolean } | null | undefined,
  locale?: string
): { tone: "info" | "ok" | "error"; text: string };
