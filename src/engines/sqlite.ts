// SQLite adapter: runs the sqlite3 shell built from the vendored source, once per request.
//
// The shell runs in its safe mode, which refuses ATTACH, load_extension(),
// readfile()/writefile() and every dot-command that touches other files or
// runs programs, so a query can only reach the one database file it was given.
//
// Consequences of one process per request, until a pooled connection exists (feature #16):
// - connection state (PRAGMA settings, temp tables, open transactions) ends with the request;
//   a transaction must be sent as one request (BEGIN; ...; COMMIT;), and is rolled back if any statement fails;
// - the SQL text and the parameters travel as program arguments, hence the size limits below.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseResultSets } from './json-results.ts';
import { runEngineProcess } from './process.ts';
import { EngineError, resolveTimeout, type QueryOptions, type QueryParam, type QueryResult, type SqlAdapter } from './types.ts';

export const MAX_SQL_BYTES = 64 * 1024;
export const MAX_PARAMS = 999;
export const MAX_PARAMS_BYTES = 96 * 1024;
export const MAX_RESULT_BYTES = 32 * 1024 * 1024;
const BUSY_TIMEOUT_MS = 5_000;

export interface SqliteAdapterOptions {
  /** Path of the sqlite3 shell built by `npm run build:engines -- sqlite`. */
  binary: string;
  /** Path of the database file. It is created on first use unless `readOnly` is set. */
  file: string;
  readOnly?: boolean;
}

/**
 * Encodes a parameter as an SQL literal. Strings are written as hex, so no
 * character of a parameter value is ever interpreted as SQL.
 */
export function encodeSqliteLiteral(param: QueryParam, position: number): string {
  if (param === null) return 'NULL';
  if (typeof param === 'boolean') return param ? '1' : '0';
  if (typeof param === 'number') {
    if (!Number.isFinite(param)) throw new EngineError('invalid_request', `parameter ${position} is not a finite number`);
    return Object.is(param, -0) ? '0' : String(param);
  }
  if (typeof param === 'string') {
    if (!param.isWellFormed()) throw new EngineError('invalid_request', `parameter ${position} is not valid Unicode`);
    return param === '' ? "''" : `CAST(x'${Buffer.from(param, 'utf8').toString('hex')}' AS TEXT)`;
  }
  if (typeof param === 'object' && !Array.isArray(param) && Object.keys(param).length === 1 && typeof param.$base64 === 'string') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(param.$base64)) {
      throw new EngineError('invalid_request', `parameter ${position} is not valid base64`);
    }
    return `x'${Buffer.from(param.$base64, 'base64').toString('hex')}'`;
  }
  throw new EngineError('invalid_request', `parameter ${position} must be null, a boolean, a number, a string or {"$base64": "..."}`);
}

/** Builds the sqlite3 arguments for one request. */
export function sqliteArguments(options: SqliteAdapterOptions, sql: string, params: readonly QueryParam[]): string[] {
  if (typeof sql !== 'string' || sql.trim() === '') throw new EngineError('invalid_request', 'sql must be a non-empty string');
  if (sql.includes('\0')) throw new EngineError('invalid_request', 'sql must not contain a NUL character');
  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) throw new EngineError('invalid_request', `sql is longer than ${MAX_SQL_BYTES} bytes`);
  if (!Array.isArray(params)) throw new EngineError('invalid_request', 'params must be an array');
  if (params.length > MAX_PARAMS) throw new EngineError('invalid_request', `more than ${MAX_PARAMS} parameters`);

  const args = ['-safe', '-batch', '-noinit', '-json'];
  if (options.readOnly) args.push('-readonly');
  // ".explain off": without it the shell prints EXPLAIN output as formatted text, not JSON.
  args.push(path.resolve(options.file), `.timeout ${BUSY_TIMEOUT_MS}`, '.explain off');
  if (params.length > 0) {
    const values = params.map((param, index) => `('?${index + 1}',${encodeSqliteLiteral(param, index + 1)})`).join(',');
    if (values.length > MAX_PARAMS_BYTES) throw new EngineError('invalid_request', `the parameters are larger than ${MAX_PARAMS_BYTES} bytes once encoded`);
    args.push('.parameter init', `INSERT INTO temp.sqlite_parameters(key,value) VALUES${values}`);
  }
  // The shell treats an argument that starts with "." as a dot-command, one that starts with "-" as an
  // option and one that names a script file as a file to run. The leading space makes the text none of
  // these: it is always handed to the SQL parser.
  args.push(` ${sql}`);
  return args;
}

/** Turns the shell's error output into a message about the caller's SQL. */
export function sqliteErrorMessage(stderr: string): string {
  const text = stderr
    .trim()
    .replace(/^(?:Parse error|Runtime error|Error) in \d+\w* command line argument: /, '')
    .replace(/^(?:line \d+|argv\[\d+\]|<cmdline>:\d+): /, '')
    .replace(/^Error: /, '');
  return text === '' ? 'the query failed' : text;
}

export function createSqliteAdapter(options: SqliteAdapterOptions): SqlAdapter {
  let scratch: Promise<string> | undefined;
  let closed = false;
  const closing = new AbortController();
  const running = new Set<Promise<unknown>>();

  return {
    engine: 'sqlite',
    kind: 'sql',

    async query(sql: string, params: readonly QueryParam[], queryOptions: QueryOptions = {}): Promise<QueryResult> {
      if (closed) throw new EngineError('engine_unavailable', 'the database is closed');
      const args = sqliteArguments(options, sql, params);
      const timeoutMs = resolveTimeout(queryOptions.timeoutMs);
      // An empty private directory is the working directory and HOME, so the shell finds no init file and no relative path resolves.
      scratch ??= mkdtemp(path.join(os.tmpdir(), 'dmb-sqlite-'));
      const cwd = await scratch;
      const started = performance.now();
      const child = runEngineProcess({
        command: options.binary,
        args,
        cwd,
        env: { HOME: cwd, XDG_CONFIG_HOME: cwd, TMPDIR: os.tmpdir(), LC_ALL: 'C.UTF-8', TZ: 'UTC' },
        timeoutMs,
        maxOutputBytes: MAX_RESULT_BYTES,
        signal: queryOptions.signal ? AbortSignal.any([queryOptions.signal, closing.signal]) : closing.signal,
        label: 'sqlite',
      });
      running.add(child);
      const run = await child.finally(() => running.delete(child));
      if (run.code !== 0 || run.stderr.trim() !== '') throw new EngineError('query_failed', sqliteErrorMessage(run.stderr));
      try {
        return { results: parseResultSets(run.stdout), durationMs: Math.round(performance.now() - started) };
      } catch (error) {
        throw new EngineError('query_failed', 'the engine returned output that could not be read', { cause: error });
      }
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
