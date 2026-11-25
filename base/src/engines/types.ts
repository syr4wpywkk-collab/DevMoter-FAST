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
  /** Rows the request inserted, updated or deleted, as the engine counts them. */
  changes?: number;
  durationMs: number;
}

export interface QueryOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface EngineHealth {
  status: 'ok' | 'unavailable';
  /** The engine's own version string, when it answered. */
  version?: string;
  latencyMs: number;
  /** Why the engine is unavailable. */
  message?: string;
}

export interface SqlAdapter {
  readonly engine: EngineName;
  readonly kind: 'sql';
  query(sql: string, params: readonly QueryParam[], options?: QueryOptions): Promise<QueryResult>;
  /** Asks the engine a trivial question through the same path queries take. Never throws. */
  health(): Promise<EngineHealth>;
  close(): Promise<void>;
}

export const HEALTH_TIMEOUT_MS = 5_000;

/** Health check for SQL engines: `versionSql` must return one row with a `version` column. */
export async function sqlHealth(adapter: Pick<SqlAdapter, 'query'>, versionSql: string): Promise<EngineHealth> {
  const started = performance.now();
  const latency = () => Math.round(performance.now() - started);
  try {
    const { results } = await adapter.query(versionSql, [], { timeoutMs: HEALTH_TIMEOUT_MS });
    const version = results[0]?.rows[0]?.version;
    if (typeof version !== 'string' || version === '') return { status: 'unavailable', latencyMs: latency(), message: 'the engine did not report its version' };
    return { status: 'ok', version, latencyMs: latency() };
  } catch (error) {
    return { status: 'unavailable', latencyMs: latency(), message: error instanceof EngineError ? error.message : 'the health check failed' };
  }
}

/** One argument of a key-value command. Binary data is `{ "$base64": "..." }`. */
export type CommandArg = string | number | { $base64: string };

export interface CommandResult {
  /** The engine's reply as JSON: see docs/api/v1.md for how reply types are mapped. */
  result: unknown;
  durationMs: number;
}

export interface KeyValueAdapter {
  readonly engine: EngineName;
  readonly kind: 'keyvalue';
  command(args: readonly CommandArg[], options?: QueryOptions): Promise<CommandResult>;
  /** Never throws. */
  health(): Promise<EngineHealth>;
  close(): Promise<void>;
}

export type Adapter = SqlAdapter | KeyValueAdapter;

export const ENGINE_ERROR_CODES = [
  'invalid_request',
  'query_failed',
  'timeout',
  'cancelled',
  'result_too_large',
  'engine_unavailable',
  'command_not_allowed',
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
