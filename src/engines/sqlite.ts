// SQLite adapter: runs the sqlite3 shell built from the vendored source, once per request.
//
// The shell runs in its safe mode, which refuses ATTACH, load_extension(),
// readfile()/writefile() and every dot-command that touches other files or
// runs programs, so a query can only reach the one database file it was given.
//
// Consequences of one process per request, until a pooled connection exists (feature #16):
// - connection state (PRAGMA settings, temp tables, open transactions) ends with the request;
//   a transaction must be sent as one request (BEGIN; ...; COMMIT;), and is rolled back if any statement fails.
//
// The SQL text and the parameters reach the shell on its standard input, never as program
// arguments: the arguments of a process are visible to every user of the machine.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseResultSets } from './json-results.ts';
import { runEngineProcess } from './process.ts';
import { EngineError, resolveTimeout, sqlHealth, type QueryOptions, type QueryParam, type QueryResult, type SqlAdapter } from './types.ts';

export const MAX_SQL_BYTES = 64 * 1024;
export const MAX_PARAMS = 999;
// A string takes up to twice the room it took as hex, so this is more than twice the 96 KiB of before.
export const MAX_PARAMS_BYTES = 256 * 1024;
export const MAX_RESULT_BYTES = 32 * 1024 * 1024;
const BUSY_TIMEOUT_MS = 5_000;

export interface SqliteAdapterOptions {
  /** Path of the sqlite3 shell built by `npm run build:engines -- sqlite`. */
  binary: string;
  /** Path of the database file. It is created on first use unless `readOnly` is set. */
  file: string;
  readOnly?: boolean;
}

/** How many code points one char() call carries: under the limit on function arguments of any SQLite. */
const CHAR_ARGUMENTS = 100;
/** How many char() calls are joined in one group, so that the longest parameter stays far from the limit on expression depth. */
const CHAR_CALLS_PER_GROUP = 32;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/**
 * Encodes a parameter as an SQL literal. A string is written as the code points of its
 * characters, so no character of a value is ever interpreted as SQL, and the text is the
 * same whatever encoding the database stores text in (the bytes of a hex literal would be
 * read in that encoding).
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
    if (param === '') return "''";
    const points = Array.from(param, (character) => character.codePointAt(0));
    const calls = chunks(points, CHAR_ARGUMENTS).map((part) => `char(${part.join(',')})`);
    return chunks(calls, CHAR_CALLS_PER_GROUP)
      .map((group) => (group.length > 1 ? `(${group.join('||')})` : group[0]))
      .join('||');
  }
  if (typeof param === 'object' && !Array.isArray(param) && Object.keys(param).length === 1 && typeof param.$base64 === 'string') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(param.$base64)) {
      throw new EngineError('invalid_request', `parameter ${position} is not valid base64`);
    }
    return `x'${Buffer.from(param.$base64, 'base64').toString('hex')}'`;
  }
  throw new EngineError('invalid_request', `parameter ${position} must be null, a boolean, a number, a string or {"$base64": "..."}`);
}

export interface SqliteInvocation {
  /** Program arguments: options and the database file only, nothing of the request. */
  args: string[];
  /** The script for the shell's standard input: the settings, the parameters, then the caller's SQL. */
  input: string;
}

/** Builds the sqlite3 arguments and input for one request. */
export function sqliteInvocation(options: SqliteAdapterOptions, sql: string, params: readonly QueryParam[]): SqliteInvocation {
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

  // -bail: stop at the first error, as the caller expects of one request.
  const args = ['-safe', '-batch', '-noinit', '-bail', '-json'];
  if (options.readOnly) args.push('-readonly');
  args.push(path.resolve(options.file));
  // ".explain off": without it the shell prints EXPLAIN output as formatted text, not JSON.
  const lines = [`.timeout ${BUSY_TIMEOUT_MS}`, '.explain off'];
  if (params.length > 0) {
    const values = params.map((param, index) => `('?${index + 1}',${encodeSqliteLiteral(param, index + 1)})`).join(',');
    if (values.length > MAX_PARAMS_BYTES) throw new EngineError('invalid_request', `the parameters are larger than ${MAX_PARAMS_BYTES} bytes once encoded`);
    lines.push('.parameter init', `INSERT INTO temp.sqlite_parameters(key,value) VALUES${values};`);
  }
  lines.push(sql, '');
  // The shell drops one carriage return before each line feed it reads. Doubling it keeps a
  // CRLF inside a string literal as it was sent; outside a literal it is blank space either way.
  return { args, input: lines.join('\n').replaceAll('\r\n', '\r\r\n') };
}

/** Turns the shell's error output into a message about the caller's SQL. */
export function sqliteErrorMessage(stderr: string): string {
  const text = stderr
    .trim()
    .replace(/^(?:Parse error|Runtime error|Error) near line \d+: /, '')
    .replace(/^(?:line \d+|<stdin>:\d+): /, '')
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
      const { args, input } = sqliteInvocation(options, sql, params);
      const timeoutMs = resolveTimeout(queryOptions.timeoutMs);
      // An empty private directory is the working directory and HOME, so the shell finds no init file and no relative path resolves.
      scratch ??= mkdtemp(path.join(os.tmpdir(), 'dmb-sqlite-'));
      const cwd = await scratch;
      const started = performance.now();
      const child = runEngineProcess({
        command: options.binary,
        args,
        input,
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

    health() {
      return sqlHealth(this, 'SELECT sqlite_version() AS version');
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
