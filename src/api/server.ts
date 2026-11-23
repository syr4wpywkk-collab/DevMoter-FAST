// The unified REST API (v1).
//
//   GET  /v1/health                    liveness of the API process
//   GET  /v1/databases                 configured databases
//   GET  /v1/databases/:name           one database
//   POST /v1/databases/:name/query     { "sql": "...", "params": [...], "timeoutMs": 30000 }
//
// There is no authentication yet. Until there is, the server only listens on
// loopback addresses and refuses requests that a web page could make the
// browser send (cross-origin requests, DNS rebinding).

import { randomUUID } from 'node:crypto';
import http from 'node:http';

import type { Logger } from '../logging/logger.ts';
import { EngineError, type Adapter, type EngineErrorCode, type EngineName, type QueryParam } from '../engines/types.ts';

export interface Database {
  name: string;
  engine: EngineName;
  readOnly: boolean;
  adapter: Adapter;
}

export interface ApiOptions {
  databases: readonly Database[];
  logger: Logger;
  maxBodyBytes?: number;
  /** Queries allowed to run at the same time; further ones get 429. */
  maxConcurrentQueries?: number;
}

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_CONCURRENT_QUERIES = 8;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const ENGINE_ERROR_STATUS: Record<EngineErrorCode, number> = {
  invalid_request: 400,
  query_failed: 422,
  result_too_large: 422,
  timeout: 504,
  cancelled: 499,
  engine_unavailable: 503,
};

/** True when the Host header names this machine: stops DNS rebinding from a web page. */
export function isLocalHostHeader(header: string | undefined): boolean {
  if (header === undefined) return false;
  const host = header.replace(/:\d{1,5}$/, '').toLowerCase();
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function describe(database: Database): Record<string, unknown> {
  return { name: database.name, engine: database.engine, kind: database.adapter.kind, readOnly: database.readOnly };
}

/**
 * A JSON number is read as a double, so an integer beyond 2^53 would silently become a
 * neighbouring value before it reaches the engine. Such a request is refused instead.
 */
function exactIntegersOnly(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source !== undefined && /^-?\d+$/.test(context.source)) {
    throw new HttpError(400, 'invalid_request', `the integer ${context.source.slice(0, 40)} cannot be read exactly as a JSON number; send it as a string`);
  }
  return value;
}

async function readJsonBody(request: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'the request body must be application/json');
  if (Number(request.headers['content-length'] ?? 0) > maxBytes) throw new HttpError(413, 'body_too_large', `the request body is larger than ${maxBytes} bytes`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'body_too_large', `the request body is larger than ${maxBytes} bytes`);
    chunks.push(chunk);
  }
  try {
    return (JSON.parse as (text: string, reviver: typeof exactIntegersOnly) => unknown)(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), exactIntegersOnly);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_json', 'the request body is not valid JSON');
  }
}

function parseQueryBody(body: unknown): { sql: string; params: QueryParam[]; timeoutMs: number | undefined } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'invalid_request', 'the request body must be a JSON object');
  const { sql, params = [], timeoutMs, ...rest } = body as Record<string, unknown>;
  const unknown = Object.keys(rest);
  if (unknown.length > 0) throw new HttpError(400, 'invalid_request', `unknown field "${unknown[0]}"; allowed fields: sql, params, timeoutMs`);
  if (typeof sql !== 'string') throw new HttpError(400, 'invalid_request', 'sql must be a string');
  if (!Array.isArray(params)) throw new HttpError(400, 'invalid_request', 'params must be an array');
  if (timeoutMs !== undefined && typeof timeoutMs !== 'number') throw new HttpError(400, 'invalid_request', 'timeoutMs must be a number');
  return { sql, params: params as QueryParam[], timeoutMs };
}

export function createApiServer(options: ApiOptions): http.Server {
  const databases = new Map(options.databases.map((database) => [database.name, database]));
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxConcurrentQueries = options.maxConcurrentQueries ?? DEFAULT_MAX_CONCURRENT_QUERIES;
  let runningQueries = 0;

  const findDatabase = (name: string): Database => {
    const database = databases.get(name);
    if (!database) throw new HttpError(404, 'database_not_found', 'no database with this name is configured');
    return database;
  };

  async function route(request: http.IncomingMessage, response: http.ServerResponse, log: Record<string, unknown>): Promise<unknown> {
    if (!isLocalHostHeader(request.headers.host)) throw new HttpError(403, 'forbidden_host', 'the Host header must name this machine (localhost, 127.0.0.1 or [::1])');
    const site = request.headers['sec-fetch-site'];
    if (request.headers.origin !== undefined || (site !== undefined && site !== 'none')) {
      throw new HttpError(403, 'cross_origin_forbidden', 'requests from web pages are not accepted');
    }

    const pathname = (request.url ?? '/').split('?')[0] ?? '/';
    const segments = pathname.split('/').slice(1);
    const allow = (...methods: string[]) => {
      if (!methods.includes(request.method ?? '')) {
        throw new HttpError(405, 'method_not_allowed', `${request.method} is not supported here`, { Allow: methods.join(', ') });
      }
    };

    if (pathname === '/v1/health') {
      log.route = 'health';
      allow('GET');
      return { status: 'ok' };
    }
    if (pathname === '/v1/databases') {
      log.route = 'databases.list';
      allow('GET');
      return { databases: [...databases.values()].map(describe) };
    }
    if (segments[0] === 'v1' && segments[1] === 'databases' && segments[2] !== undefined && segments.length === 3) {
      log.route = 'databases.get';
      allow('GET');
      return describe(findDatabase(segments[2]));
    }
    if (segments[0] === 'v1' && segments[1] === 'databases' && segments[2] !== undefined && segments[3] === 'query' && segments.length === 4) {
      log.route = 'databases.query';
      allow('POST');
      const database = findDatabase(segments[2]);
      log.database = database.name;
      log.engine = database.engine;
      const { sql, params, timeoutMs } = parseQueryBody(await readJsonBody(request, maxBodyBytes));
      if (runningQueries >= maxConcurrentQueries) {
        throw new HttpError(429, 'too_many_requests', 'too many queries are running; try again shortly', { 'Retry-After': '1' });
      }
      const abort = new AbortController();
      const onClose = () => {
        if (!response.writableEnded) abort.abort();
      };
      response.on('close', onClose);
      runningQueries += 1;
      try {
        const result = await database.adapter.query(sql, params, { signal: abort.signal, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
        log.rows = result.results.reduce((total, set) => total + set.rowCount, 0);
        return { database: database.name, engine: database.engine, ...result };
      } finally {
        runningQueries -= 1;
        response.off('close', onClose);
      }
    }
    throw new HttpError(404, 'not_found', 'no such endpoint');
  }

  return http.createServer((request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    const log: Record<string, unknown> = { requestId, method: request.method };

    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      log.status = status;
      log.durationMs = Math.round(performance.now() - started);
      if (response.destroyed) return;
      const payload = JSON.stringify(body);
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId,
        ...headers,
      });
      response.end(payload);
    };

    route(request, response, log)
      .then((body) => send(200, body))
      .catch((error: unknown) => {
        const fail = (status: number, code: string, message: string, headers?: Record<string, string>) => {
          log.error = code;
          // A request that failed before its body was read must not be kept alive with the unread body in the stream.
          send(status, { error: { code, message, requestId } }, { ...headers, ...(request.complete ? {} : { Connection: 'close' }) });
        };
        if (error instanceof HttpError) fail(error.status, error.code, error.message, error.headers);
        else if (error instanceof EngineError) fail(ENGINE_ERROR_STATUS[error.code], error.code, error.message);
        else {
          options.logger.error('unhandled error in request', { requestId, err: error });
          fail(500, 'internal_error', 'an internal error occurred');
        }
      })
      .finally(() => {
        // Never log SQL text, parameters or rows: they are user data.
        options.logger.info('request', log);
      });
  });
}

/**
 * Stops `server`: no new connections at once, and requests still running after `graceMs`
 * lose their connection, which cancels their queries (an engine process must not outlive the server).
 * Resolves once every connection is gone.
 */
export function stopApiServer(server: http.Server, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}
