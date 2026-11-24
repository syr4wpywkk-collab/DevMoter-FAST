// PostgreSQL adapter: connects to a running PostgreSQL server with the `pg` client.
//
// Unlike SQLite and DuckDB, PostgreSQL is a server, so this adapter does not
// start the engine: it connects to one that is already running, over a Unix
// socket or a loopback TCP port. Each request uses its own connection (there
// is no pool yet), so connection state ends with the request.
//
// Parameters are sent with the extended query protocol: the server receives
// them separately from the SQL text, so they are never parsed as SQL.

import pg from 'pg';

import { POSTGRESQL_SQL, sqlShape } from './sql-text.ts';
import { EngineError, resolveTimeout, sqlHealth, type QueryOptions, type QueryParam, type QueryResult, type ResultSet, type SqlAdapter } from './types.ts';

export const MAX_SQL_BYTES = 1024 * 1024;
export const MAX_PARAMS = 32_767;
export const MAX_RESULT_BYTES = 32 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;

export interface PostgresqlAdapterOptions {
  /** A loopback host name or address, or the absolute path of the directory that holds the server's Unix socket. */
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  /**
   * Starts every transaction read-only. This guards against accidents only: a
   * query can turn it off again. To enforce it, connect as a role without write privileges.
   */
  readOnly?: boolean;
}

/** Converts a parameter to what the `pg` client sends. Binary data goes as bytea. */
export function encodePostgresqlParam(param: QueryParam, position: number): string | Buffer | null {
  if (param === null) return null;
  if (typeof param === 'boolean') return param ? 'true' : 'false';
  if (typeof param === 'number') {
    if (!Number.isFinite(param)) throw new EngineError('invalid_request', `parameter ${position} is not a finite number`);
    if (Number.isInteger(param) && !Number.isSafeInteger(param)) throw new EngineError('invalid_request', `parameter ${position} is an integer too large to be exact as a number; send it as a string`);
    return Object.is(param, -0) ? '0' : String(param);
  }
  if (typeof param === 'string') {
    if (!param.isWellFormed()) throw new EngineError('invalid_request', `parameter ${position} is not valid Unicode`);
    if (param.includes('\0')) throw new EngineError('invalid_request', `parameter ${position} contains a NUL character`);
    return param;
  }
  if (typeof param === 'object' && !Array.isArray(param) && Object.keys(param).length === 1 && typeof param.$base64 === 'string') {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(param.$base64)) {
      throw new EngineError('invalid_request', `parameter ${position} is not valid base64`);
    }
    return Buffer.from(param.$base64, 'base64');
  }
  throw new EngineError('invalid_request', `parameter ${position} must be null, a boolean, a number, a string or {"$base64": "..."}`);
}

/**
 * Whether a statement is COPY ... TO STDOUT or COPY ... FROM STDIN, which move data over the
 * connection itself. The client cannot carry that data, and by the time the server announces
 * the copy a statement such as COPY (INSERT ... RETURNING ...) TO STDOUT has already written.
 */
export function copiesThroughClient(sql: string): boolean {
  let found = false;
  let first = true; // the next token opens a statement
  let copy = false;
  let depth = 0;
  let previous = '';
  sqlShape(sql, POSTGRESQL_SQL, (token) => {
    if (token === ';') {
      first = true;
      copy = false;
      depth = 0;
      previous = '';
      return;
    }
    const word = /^[A-Za-z_]/.test(token) ? token.toUpperCase() : '';
    if (first) copy = word === 'COPY';
    else if (copy && depth === 0 && (word === 'STDOUT' || word === 'STDIN') && (previous === 'TO' || previous === 'FROM')) found = true;
    first = false;
    if (token === '(') depth += 1;
    else if (token === ')') depth -= 1;
    previous = word;
  });
  return found;
}

export function validatePostgresqlRequest(sql: string, params: readonly QueryParam[]): (string | Buffer | null)[] {
  if (typeof sql !== 'string' || sql.trim() === '') throw new EngineError('invalid_request', 'sql must be a non-empty string');
  if (sql.includes('\0')) throw new EngineError('invalid_request', 'sql must not contain a NUL character');
  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) throw new EngineError('invalid_request', `sql is longer than ${MAX_SQL_BYTES} bytes`);
  if (copiesThroughClient(sql)) {
    throw new EngineError('invalid_request', 'COPY ... TO STDOUT and COPY ... FROM STDIN are not available through the API; use SELECT to read rows and INSERT to add them');
  }
  if (!Array.isArray(params)) throw new EngineError('invalid_request', 'params must be an array');
  if (params.length > MAX_PARAMS) throw new EngineError('invalid_request', `more than ${MAX_PARAMS} parameters`);
  return params.map((param, index) => encodePostgresqlParam(param, index + 1));
}

const OID = { bool: 16, int2: 21, int4: 23, oid: 26, json: 114, float4: 700, float8: 701, jsonb: 3802 } as const;
const float = (text: string): number | string => {
  const value = Number(text);
  return Number.isFinite(value) ? value : text;
};
const asText = (text: string): string => text;

/** A decimal literal as sign, significant digits and power of ten, so that equal values compare equal. */
function decimal(source: string): string | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  const digits = `${match[2]}${fraction}`.replace(/^0+/, '');
  const significant = digits.replace(/0+$/, '');
  if (significant === '') return '0';
  return `${match[1]}${significant}e${Number(match[4] ?? 0) - fraction.length + (digits.length - significant.length)}`;
}

/**
 * Reviver for json and jsonb values: a number stays a number only when JavaScript holds exactly the value
 * that was written; otherwise (more digits than a double has, or out of its range) it is returned as the text PostgreSQL sent.
 */
export function exactJsonNumbers(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== 'number' || context?.source === undefined) return value;
  const { source } = context;
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return source;
  return Number.isFinite(value) && decimal(source) === decimal(String(value)) ? value : source;
}

/**
 * How column values become JSON. Only types that JSON can hold exactly are
 * converted; everything else (bigint, numeric, dates, arrays, bytea, ...) stays
 * the text PostgreSQL sent, so no value is rounded or shifted to another time zone.
 */
export const postgresqlTypes = {
  getTypeParser(oid: number): (text: string) => unknown {
    switch (oid) {
      case OID.bool:
        return (text) => text === 't';
      case OID.int2:
      case OID.int4:
      case OID.oid:
        return Number;
      case OID.float4:
      case OID.float8:
        return float;
      case OID.json:
      case OID.jsonb:
        return (text) => (JSON.parse as (text: string, reviver: typeof exactJsonNumbers) => unknown)(text, exactJsonNumbers);
      default:
        return asText;
    }
  },
};

interface ServerError {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
  hint?: unknown;
  severity?: unknown;
}

/** SQLSTATE classes and codes that mean "the server cannot be used", not "this SQL is wrong". */
function isUnavailable(sqlState: string): boolean {
  return (sqlState.startsWith('08') && sqlState !== '08P01') || sqlState.startsWith('28') || sqlState === '3D000' || sqlState === '53300' || sqlState === '57P01' || sqlState === '57P02' || sqlState === '57P03';
}

/** Maps an error from the `pg` client to the common error shape. */
export function postgresqlError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  const { code, message, detail, hint, severity } = (typeof error === 'object' && error !== null ? error : {}) as ServerError;
  const text = typeof message === 'string' && message !== '' ? message : 'the query failed';
  if (typeof code === 'string' && typeof severity === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
    if (code === '57014' && /statement timeout/.test(text)) return new EngineError('timeout', 'the query did not finish within its time limit', { cause: error });
    if (isUnavailable(code)) return new EngineError('engine_unavailable', `the PostgreSQL server refused the connection: ${text} (SQLSTATE ${code})`, { cause: error });
    const extra = [typeof detail === 'string' ? `DETAIL: ${detail}` : '', typeof hint === 'string' ? `HINT: ${hint}` : ''].filter(Boolean);
    return new EngineError('query_failed', [`${text} (SQLSTATE ${code})`, ...extra].join('\n'), { cause: error });
  }
  // Not a server error: the connection could not be made or was lost.
  const reason = typeof code === 'string' ? code : text;
  return new EngineError('engine_unavailable', `cannot reach the PostgreSQL server (${reason})`, { cause: error });
}

function toResultSets(result: pg.QueryResult | pg.QueryResult[]): ResultSet[] {
  const sets: ResultSet[] = [];
  for (const one of Array.isArray(result) ? result : [result]) {
    // Statements that return no rows (DDL, INSERT without RETURNING) have no columns.
    if (one.fields.length === 0) continue;
    sets.push({ columns: one.fields.map((field) => field.name), rows: one.rows as Record<string, unknown>[], rowCount: one.rows.length });
  }
  return sets;
}

export function createPostgresqlAdapter(options: PostgresqlAdapterOptions): SqlAdapter {
  let closed = false;
  const active = new Set<() => void>();

  function connect(timeoutMs: number): pg.Client {
    return new pg.Client({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      // A function, so that the client never falls back to PGPASSWORD or ~/.pgpass.
      password: () => options.password ?? '',
      ssl: false,
      application_name: 'devmoter-base',
      connectionTimeoutMillis: Math.min(timeoutMs, CONNECT_TIMEOUT_MS),
      // The server stops a statement that outlives the request even if this process is gone.
      statement_timeout: timeoutMs,
      ...(options.readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
      types: postgresqlTypes as unknown as NonNullable<pg.ClientConfig['types']>,
    });
  }

  /** Asks the server to stop what `client` is running. Uses a second connection, as the protocol requires. */
  function cancel(client: pg.Client): void {
    const target = client as unknown as { processID: number | null; secretKey: number | null; connection: { stream: { destroy(): void } } };
    if (target.processID !== null && target.secretKey !== null) {
      const canceller = connect(CONNECT_TIMEOUT_MS) as unknown as { connection: { connect(...args: unknown[]): void; on(event: string, listener: (...args: unknown[]) => void): void; cancel(pid: number, key: number): void; stream: { destroy(): void } } };
      const { connection } = canceller;
      const { processID, secretKey } = target;
      connection.on('error', () => {});
      connection.on('connect', () => connection.cancel(processID, secretKey));
      if (options.host.startsWith('/')) connection.connect(`${options.host}/.s.PGSQL.${options.port}`);
      else connection.connect(options.port, options.host);
      setTimeout(() => connection.stream.destroy(), 2_000).unref();
    }
    target.connection.stream.destroy();
  }

  return {
    engine: 'postgresql',
    kind: 'sql',

    async query(sql: string, params: readonly QueryParam[], queryOptions: QueryOptions = {}): Promise<QueryResult> {
      if (closed) throw new EngineError('engine_unavailable', 'the database is closed');
      const values = validatePostgresqlRequest(sql, params);
      const timeoutMs = resolveTimeout(queryOptions.timeoutMs);
      const { signal } = queryOptions;
      if (signal?.aborted) throw new EngineError('cancelled', 'the query was cancelled');

      const started = performance.now();
      const client = connect(timeoutMs);
      // Connection-level errors also reject the pending promise; this listener only keeps them from being unhandled.
      client.on('error', () => {});

      let stop: (error: EngineError) => void = () => {};
      const stopped = new Promise<never>((_resolve, reject) => {
        let done = false;
        stop = (error) => {
          // Once: the rows already received keep arriving after the limit is passed, and each cancel opens a connection.
          if (done) return;
          done = true;
          reject(error);
          cancel(client);
        };
      });
      stopped.catch(() => {});
      const timer = setTimeout(() => stop(new EngineError('timeout', `the query did not finish within ${timeoutMs} ms`)), timeoutMs);
      const onAbort = () => stop(new EngineError('cancelled', 'the query was cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const onClose = () => stop(new EngineError('engine_unavailable', 'the database is closed'));
      active.add(onClose);

      try {
        await Promise.race([client.connect(), stopped]);
        let bytes = 0;
        (client as unknown as { connection: { on(event: 'dataRow', listener: (message: { length: number }) => void): void } }).connection.on('dataRow', (message) => {
          bytes += message.length;
          if (bytes > MAX_RESULT_BYTES) stop(new EngineError('result_too_large', `the result is larger than ${MAX_RESULT_BYTES} bytes`));
        });
        // The client drops COPY data, so a COPY ... TO STDOUT that got past the check on the text
        // would look like a statement that returned nothing. The server may have finished it by now.
        (client as unknown as { connection: { on(event: 'copyOutResponse', listener: () => void): void } }).connection.on('copyOutResponse', () =>
          stop(new EngineError('query_failed', 'COPY ... TO STDOUT is not available through the API; the statement may already have run, so check its effect before sending it again')),
        );
        // Without parameters the simple protocol is used, which accepts several statements.
        const result = await Promise.race([values.length > 0 ? client.query(sql, values) : client.query(sql), stopped]);
        return { results: toResultSets(result as pg.QueryResult | pg.QueryResult[]), durationMs: Math.round(performance.now() - started) };
      } catch (error) {
        throw postgresqlError(error);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        active.delete(onClose);
        client.end().catch(() => {});
      }
    },

    health() {
      return sqlHealth(this, "SELECT current_setting('server_version') AS version");
    },

    async close(): Promise<void> {
      closed = true;
      for (const stop of active) stop();
    },
  };
}
