export const UNKNOWN_LABEL: string;
export function unknownLabel(language?: unknown): string;
export function formatNodeVersion(value: unknown, language?: unknown): string;
export function formatBuildId(value: unknown, language?: unknown): string;
export function buildsDiffer(hostBuild: unknown, deviceBuild: unknown): boolean;
export function describeHealthFetch(
  state: { fetchedAt: number | null; failedAt: number | null; loading?: boolean } | null | undefined,
  locale?: string
): { tone: "info" | "ok" | "error"; text: string };

export type FailureKind = "auth" | "offline" | "timeout" | "unknown";
export interface DiagnosticsConnection {
  id: string;
  state: "connected" | "failed" | "unknown";
  failure: FailureKind | null;
  httpStatus: number | null;
  checkedAt: string | null;
}
export const FAILURE_KINDS: FailureKind[];
export function listConnections(diagnostics: unknown, options?: { stale?: boolean }): DiagnosticsConnection[];
export function describeConnection(
  connection: DiagnosticsConnection,
  locale?: string
): { tone: "info" | "ok" | "error"; label: string; guide: string };
export function formatCheckedAt(value: unknown, locale?: string): string;
export function classifyFetchFailure(error: unknown, options?: { online?: boolean }): FailureKind;
export function describeFetchFailure(kind: unknown, locale?: string): { label: string; guide: string };
export function buildDiagnosticsReport(input: {
  diagnostics: unknown;
  fetchState: { fetchedAt: number | null; failedAt: number | null };
  fetchFailure?: FailureKind | null;
  clientBuild?: string;
  cliStatus?: unknown[];
  now?: number;
}): string;
