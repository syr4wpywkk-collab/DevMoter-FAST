// DuckDB adapter: runs the duckdb shell built from the vendored source, once per request.
//
// The shell runs in its safe mode, which locks the configuration and disables
// every file-system access outside the database (ATTACH, COPY, read_csv(),
// EXPORT, INSTALL/LOAD, getenv()), so a query can only reach the one database
// file it was given. Reading CSV/Parquet files is therefore not available
// through this adapter yet (feature #46).
//
// As with SQLite, one process per request means that connection state ends with
// the request, and the SQL and the parameters reach the shell on its standard
// input, never as program arguments (those are visible to every user of the machine).

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseResultSets, takeChanges } from './json-results.ts';
import { runEngineProcess } from './process.ts';
import { DUCKDB_SQL, sqlShape } from './sql-text.ts';
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

export interface DuckdbInvocation {
  /** Program arguments: options and the database file only, nothing of the request. */
  args: string[];
  /** The script for the shell's standard input. */
  input: string;
  /** The request is one EXPLAIN statement: the shell prints its plan as text, whatever the output mode. */
  explain: boolean;
}

/** Builds the duckdb arguments and input for one request. */
export function duckdbInvocation(options: DuckdbAdapterOptions, sql: string, params: readonly QueryParam[]): DuckdbInvocation {
  if (typeof sql !== 'string' || sql.trim() === '') throw new EngineError('invalid_request', 'sql must be a non-empty string');
  if (sql.includes('\0')) throw new EngineError('invalid_request', 'sql must not contain a NUL character');
  // A lone surrogate has no UTF-8 form; it would reach the engine as U+FFFD, other text than was sent.
  if (!sql.isWellFormed()) throw new EngineError('invalid_request', 'sql is not valid Unicode');
  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) throw new EngineError('invalid_request', `sql is longer than ${MAX_SQL_BYTES} bytes`);
  // The shell reads a line that starts with "." as one of its dot-commands when no statement is open.
  // Whether one is open cannot be told without parsing the SQL, so such a line is refused wherever it is.
  if (/^\./m.test(sql)) {
    throw new EngineError('invalid_request', 'a line of sql must not start with "."; indent the line, or pass the text as a parameter');
  }
  if (!Array.isArray(params)) throw new EngineError('invalid_request', 'params must be an array');
  if (params.length > MAX_PARAMS) throw new EngineError('invalid_request', `more than ${MAX_PARAMS} parameters`);

  const shape = sqlShape(sql, DUCKDB_SQL);
  let text = sql;
  if (params.length > 0) {
    // The statement is prepared, then executed with the values. A second statement would run on its own,
    // before the values are even checked, so its changes would stay when the request then fails.
    if (shape.statements !== 1) throw new EngineError('invalid_request', 'sql must be a single statement when params are given');
    const values = params.map((param, index) => encodeDuckdbLiteral(param, index + 1)).join(',');
    if (values.length > MAX_PARAMS_BYTES) throw new EngineError('invalid_request', `the parameters are larger than ${MAX_PARAMS_BYTES} bytes once encoded`);
    // The newline ends a trailing "--" comment in the caller's SQL.
    text = `PREPARE ${STATEMENT_NAME} AS ${sql.replace(/[;\s]+$/, '')}\n; EXECUTE ${STATEMENT_NAME}(${values});`;
  }
  // -bail: stop at the first error, as the caller expects of one request.
  const args = ['-safe', '-batch', '-no-init', '-bail', '-json'];
  if (options.readOnly) args.push('-readonly');
  args.push(path.resolve(options.file));
  // The shell drops one carriage return before each line feed it reads. Doubling it keeps a
  // CRLF inside a string literal as it was sent; outside a literal it is blank space either way.
  // ".changes on": the shell reports the rows each statement changed, which -json alone leaves out.
  return { args, input: `.changes on\n${text}\n`.replaceAll('\r\n', '\r\r\n'), explain: shape.firstKeyword === 'EXPLAIN' && shape.statements === 1 && params.length === 0 };
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
  const closing = new AbortController();
  const running = new Set<Promise<unknown>>();

  return {
    engine: 'duckdb',
    kind: 'sql',

    async query(sql: string, params: readonly QueryParam[], queryOptions: QueryOptions = {}): Promise<QueryResult> {
      if (closed) throw new EngineError('engine_unavailable', 'the database is closed');
      const { args, input, explain } = duckdbInvocation(options, sql, params);
      const timeoutMs = resolveTimeout(queryOptions.timeoutMs);
      scratch ??= mkdtemp(path.join(os.tmpdir(), 'dmb-duckdb-'));
      const cwd = await scratch;
      const started = performance.now();
      const child = runEngineProcess({
        command: options.binary,
        args,
        input,
        cwd,
        env: { HOME: cwd, XDG_CONFIG_HOME: cwd, TMPDIR: os.tmpdir(), LC_ALL: 'C.UTF-8', TZ: 'UTC', DUCKDB_AGENT_MODE: '0' },
        timeoutMs,
        maxOutputBytes: MAX_RESULT_BYTES,
        signal: queryOptions.signal ? AbortSignal.any([queryOptions.signal, closing.signal]) : closing.signal,
        label: 'duckdb',
      });
      running.add(child);
      const run = await child.finally(() => running.delete(child));
      if (run.code !== 0 || run.stderr.trim() !== '') throw new EngineError('query_failed', duckdbErrorMessage(run.stderr));
      const durationMs = () => Math.round(performance.now() - started);
      const { text, total } = takeChanges(run.stdout);
      const changes = total ?? 0;
      if (explain) return { results: [{ columns: ['plan'], rows: [{ plan: text.trimEnd() }], rowCount: 1 }], changes, durationMs: durationMs() };
      try {
        return { results: parseResultSets(text, { nonFinite: true }), changes, durationMs: durationMs() };
      } catch (error) {
        throw new EngineError('query_failed', 'the engine returned output that could not be read', { cause: error });
      }
    },

    health() {
      return sqlHealth(this, 'SELECT version() AS version');
    },

    async close(): Promise<void> {
      closed = true;
      // No engine process outlives the adapter: the ones still running are killed and waited for.
      closing.abort();
      await Promise.allSettled(running);
      if (scratch) await rm(await scratch, { recursive: true, force: true });
    },
  };
}
