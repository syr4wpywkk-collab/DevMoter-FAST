// DuckDB adapter: runs the duckdb shell built from the vendored source, once per request.
//
// The shell runs in its safe mode, which locks the configuration and disables
// every file-system access outside the database (ATTACH, COPY, read_csv(),
// EXPORT, INSTALL/LOAD, getenv()), so a query can only reach the one database
// file it was given. Reading CSV/Parquet files is therefore not available
// through this adapter yet (feature #46).
//
// As with SQLite, one process per request means that connection state ends
// with the request and that the SQL travels as a program argument.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseResultSets } from './json-results.ts';
import { runEngineProcess } from './process.ts';
import { EngineError, resolveTimeout, sqlHealth, type QueryOptions, type QueryParam, type QueryResult, type SqlAdapter } from './types.ts';

export const MAX_SQL_BYTES = 64 * 1024;
export const MAX_PARAMS = 999;
export const MAX_PARAMS_BYTES = 48 * 1024;
export const MAX_RESULT_BYTES = 32 * 1024 * 1024;
const STATEMENT_NAME = 'devmoter_base_request';

export interface DuckdbAdapterOptions {
  /** Path of the duckdb shell built by `npm run build:engines -- duckdb`. */
  binary: string;
  /** Path of the database file. It is created on first use unless `readOnly` is set. */
  file: string;
  readOnly?: boolean;
}

/** Encodes a parameter as an SQL literal. Strings are written as hex, so no character of a value is ever interpreted as SQL. */
export function encodeDuckdbLiteral(param: QueryParam, position: number): string {
  if (param === null) return 'NULL';
  if (typeof param === 'boolean') return param ? 'true' : 'false';
  if (typeof param === 'number') {
    if (!Number.isFinite(param)) throw new EngineError('invalid_request', `parameter ${position} is not a finite number`);
    return Object.is(param, -0) ? '0' : String(param);
  }
  if (typeof param === 'string') {
    if (!param.isWellFormed()) throw new EngineError('invalid_request', `parameter ${position} is not valid Unicode`);
    if (param.includes('\0')) throw new EngineError('invalid_request', `parameter ${position} contains a NUL character`);
    return param === '' ? "''" : `decode(from_hex('${Buffer.from(param, 'utf8').toString('hex')}'))`;
  }
  if (typeof param === 'object' && !Array.isArray(param) && Object.keys(param).length === 1 && typeof param.$base64 === 'string') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(param.$base64)) {
      throw new EngineError('invalid_request', `parameter ${position} is not valid base64`);
    }
    return `from_hex('${Buffer.from(param.$base64, 'base64').toString('hex')}')`;
  }
  throw new EngineError('invalid_request', `parameter ${position} must be null, a boolean, a number, a string or {"$base64": "..."}`);
}

/** Builds the duckdb arguments for one request. */
export function duckdbArguments(options: DuckdbAdapterOptions, sql: string, params: readonly QueryParam[]): string[] {
  if (typeof sql !== 'string' || sql.trim() === '') throw new EngineError('invalid_request', 'sql must be a non-empty string');
  if (sql.includes('\0')) throw new EngineError('invalid_request', 'sql must not contain a NUL character');
  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) throw new EngineError('invalid_request', `sql is longer than ${MAX_SQL_BYTES} bytes`);
  if (!Array.isArray(params)) throw new EngineError('invalid_request', 'params must be an array');
  if (params.length > MAX_PARAMS) throw new EngineError('invalid_request', `more than ${MAX_PARAMS} parameters`);

  let text = sql;
  if (params.length > 0) {
    const values = params.map((param, index) => encodeDuckdbLiteral(param, index + 1)).join(',');
    if (values.length > MAX_PARAMS_BYTES) throw new EngineError('invalid_request', `the parameters are larger than ${MAX_PARAMS_BYTES} bytes once encoded`);
    // The newline ends a trailing "--" comment in the caller's SQL.
    text = `PREPARE ${STATEMENT_NAME} AS ${sql.replace(/[;\s]+$/, '')}\n; EXECUTE ${STATEMENT_NAME}(${values})`;
  }
  const args = ['-safe', '-batch', '-no-init', '-json'];
  if (options.readOnly) args.push('-readonly');
  // The shell treats text that starts with "." as a dot-command; the leading space makes it SQL.
  args.push(path.resolve(options.file), '-c', ` ${text}`);
  return args;
}

/** Turns the shell's error output into a message about the caller's SQL. */
export function duckdbErrorMessage(stderr: string): string {
  const text = stderr
    .split('\n')
    .filter((line) => !line.startsWith('hint: -agent '))
    .join('\n')
    .trim();
  return text === '' ? 'the query failed' : text;
}

export function createDuckdbAdapter(options: DuckdbAdapterOptions): SqlAdapter {
  let scratch: Promise<string> | undefined;
  let closed = false;

  return {
    engine: 'duckdb',
    kind: 'sql',

    async query(sql: string, params: readonly QueryParam[], queryOptions: QueryOptions = {}): Promise<QueryResult> {
      if (closed) throw new EngineError('engine_unavailable', 'the database is closed');
      const args = duckdbArguments(options, sql, params);
      const timeoutMs = resolveTimeout(queryOptions.timeoutMs);
      scratch ??= mkdtemp(path.join(os.tmpdir(), 'dmb-duckdb-'));
      const cwd = await scratch;
      const started = performance.now();
      const run = await runEngineProcess({
        command: options.binary,
        args,
        cwd,
        env: { HOME: cwd, XDG_CONFIG_HOME: cwd, TMPDIR: os.tmpdir(), LC_ALL: 'C.UTF-8', TZ: 'UTC', DUCKDB_AGENT_MODE: '0' },
        timeoutMs,
        maxOutputBytes: MAX_RESULT_BYTES,
        signal: queryOptions.signal,
        label: 'duckdb',
      });
      if (run.code !== 0 || run.stderr.trim() !== '') throw new EngineError('query_failed', duckdbErrorMessage(run.stderr));
      try {
        return { results: parseResultSets(run.stdout, { nonFinite: true }), durationMs: Math.round(performance.now() - started) };
      } catch (error) {
        throw new EngineError('query_failed', 'the engine returned output that could not be read', { cause: error });
      }
    },

    health() {
      return sqlHealth(this, 'SELECT version() AS version');
    },

    async close(): Promise<void> {
      closed = true;
      if (scratch) await rm(await scratch, { recursive: true, force: true });
    },
  };
}
