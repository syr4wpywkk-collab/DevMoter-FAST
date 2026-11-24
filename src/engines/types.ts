// What every engine adapter exposes to the unified API.
// The adapters share a shape, not a dialect: SQL text and data types are passed
// through to the engine as they are.

export const ENGINE_NAMES = ['postgresql', 'sqlite', 'duckdb', 'valkey'] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];

/** A positional query parameter. Binary data is `{ "$base64": "..." }`. */
export type QueryParam = null | boolean | number | string | { $base64: string };

export interface ResultSet {
  /** Column names, in order. Empty when the engine reports no rows and no column names. */
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface QueryResult {
  /** One entry per statement that produced a result set. */
  results: ResultSet[];
  durationMs: number;
}

export interface QueryOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SqlAdapter {
  readonly engine: EngineName;
  readonly kind: 'sql';
  query(sql: string, params: readonly QueryParam[], options?: QueryOptions): Promise<QueryResult>;
  close(): Promise<void>;
}

export type Adapter = SqlAdapter;

export const ENGINE_ERROR_CODES = [
  'invalid_request',
  'query_failed',
  'timeout',
  'cancelled',
  'result_too_large',
  'engine_unavailable',
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EngineError';
    this.code = code;
  }
}

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
export const MAX_QUERY_TIMEOUT_MS = 300_000;

export function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_QUERY_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_QUERY_TIMEOUT_MS) {
    throw new EngineError('invalid_request', `timeoutMs must be a whole number between 1 and ${MAX_QUERY_TIMEOUT_MS}`);
  }
  return timeoutMs;
}
