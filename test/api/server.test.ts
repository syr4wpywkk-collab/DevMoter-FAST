import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApiServer, isLocalHostHeader, stopApiServer, type Database } from '../../src/api/server.ts';
import { createSqliteAdapter } from '../../src/engines/sqlite.ts';
import { EngineError, type CommandArg, type KeyValueAdapter, type QueryOptions, type QueryParam, type SqlAdapter } from '../../src/engines/types.ts';
import { createLogger } from '../../src/logging/logger.ts';
import { builtEngine } from '../engines/helpers.ts';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

function call(port: number, method: string, urlPath: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: options.headers ?? {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let healthy = true;

/** An adapter that records what it was asked and answers from a script. */
function fakeAdapter(handler: (sql: string, params: readonly QueryParam[], options?: QueryOptions) => Promise<Record<string, unknown>[]>): SqlAdapter {
  return {
    engine: 'sqlite',
    kind: 'sql',
    async query(sql, params, options) {
      const rows = await handler(sql, params, options);
      return { results: [{ columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length }], durationMs: 1 };
    },
    health: async () => (healthy ? { status: 'ok', version: '1.2.3', latencyMs: 1 } : { status: 'unavailable', latencyMs: 1, message: 'the sqlite engine is not built' }),
    async close() {},
  };
}

const commands: { args: readonly CommandArg[]; timeoutMs: number | undefined }[] = [];
const cache: KeyValueAdapter = {
  engine: 'valkey',
  kind: 'keyvalue',
  async command(args, options) {
    commands.push({ args, timeoutMs: options?.timeoutMs });
    if (args[0] === 'FLUSHALL') throw new EngineError('command_not_allowed', '"FLUSHALL" is not allowed');
    if (args[0] === 'NOPE') throw new EngineError('query_failed', 'unknown command "NOPE"');
    return { result: { value: 'private-result' }, durationMs: 1 };
  },
  health: async () => ({ status: 'ok', version: '9.9.9', latencyMs: 1 }),
  async close() {},
};

describe('REST API', () => {
  const lines: string[] = [];
  const seen: { sql: string; params: readonly QueryParam[]; timeoutMs: number | undefined }[] = [];
  let release: (() => void) | undefined;
  let aborted = false;
  let server: http.Server;
  let port: number;

  before(async () => {
    const adapter = fakeAdapter(async (sql, params, options) => {
      seen.push({ sql, params, timeoutMs: options?.timeoutMs });
      if (sql === 'FAIL') throw new EngineError('query_failed', 'no such table: nope');
      if (sql === 'SLOW') throw new EngineError('timeout', 'the query did not finish within 5 ms');
      if (sql === 'MISSING') throw new EngineError('engine_unavailable', 'the sqlite engine is not built');
      if (sql === 'BUG') throw new TypeError('secret detail: password=hunter2');
      if (sql === 'WAIT') {
        await new Promise<void>((resolve) => {
          release = resolve;
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        });
      }
      return [{ answer: 42 }];
    });
    const databases: Database[] = [
      { name: 'app', engine: 'sqlite', readOnly: false, adapter },
      { name: 'archive', engine: 'sqlite', readOnly: true, adapter },
      { name: 'cache', engine: 'valkey', readOnly: false, adapter: cache },
    ];
    server = createApiServer({ databases, logger: createLogger({ sink: (line) => lines.push(line) }), maxBodyBytes: 2048, maxConcurrentQueries: 1 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  test('health and database listing', async () => {
    const health = await call(port, 'GET', '/v1/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok' });
    assert.equal(health.headers['cache-control'], 'no-store');
    assert.equal(health.headers['x-content-type-options'], 'nosniff');
    assert.match(String(health.headers['x-request-id']), /^[0-9a-f-]{36}$/);
    assert.equal(health.headers['access-control-allow-origin'], undefined);

    const list = await call(port, 'GET', '/v1/databases?x=1');
    assert.deepEqual(list.body, {
      databases: [
        { name: 'app', engine: 'sqlite', kind: 'sql', readOnly: false },
        { name: 'archive', engine: 'sqlite', kind: 'sql', readOnly: true },
        { name: 'cache', engine: 'valkey', kind: 'keyvalue', readOnly: false },
      ],
    });
    assert.deepEqual((await call(port, 'GET', '/v1/databases/archive')).body, { name: 'archive', engine: 'sqlite', kind: 'sql', readOnly: true });
  });

  test('engine health is 200 when every engine answers and 503 otherwise', async () => {
    const ok = await call(port, 'GET', '/v1/health/engines');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, {
      status: 'ok',
      databases: [
        { name: 'app', engine: 'sqlite', status: 'ok', version: '1.2.3', latencyMs: 1 },
        { name: 'archive', engine: 'sqlite', status: 'ok', version: '1.2.3', latencyMs: 1 },
        { name: 'cache', engine: 'valkey', status: 'ok', version: '9.9.9', latencyMs: 1 },
      ],
    });
    assert.deepEqual((await call(port, 'GET', '/v1/databases/app/health')).body, { name: 'app', engine: 'sqlite', status: 'ok', version: '1.2.3', latencyMs: 1 });
    healthy = false;
    try {
      const degraded = await call(port, 'GET', '/v1/health/engines');
      assert.equal(degraded.status, 503);
      assert.equal(degraded.body.status, 'degraded');
      assert.equal(degraded.body.databases[0].message, 'the sqlite engine is not built');
      assert.equal((await call(port, 'GET', '/v1/databases/app/health')).status, 503);
      assert.equal((await call(port, 'GET', '/v1/health')).status, 200, 'the API process itself is still alive');
    } finally {
      healthy = true;
    }
    assert.equal((await call(port, 'GET', '/v1/databases/missing/health')).status, 404);
    assert.equal((await call(port, 'POST', '/v1/health/engines')).status, 405);
  });

  test('runs a query and passes sql, params and timeout to the adapter', async () => {
    const reply = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'SELECT ?1', params: ['x', 2, null], timeoutMs: 1500 }));
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { database: 'app', engine: 'sqlite', results: [{ columns: ['answer'], rows: [{ answer: 42 }], rowCount: 1 }], durationMs: 1 });
    assert.deepEqual(seen.at(-1), { sql: 'SELECT ?1', params: ['x', 2, null], timeoutMs: 1500 });
  });

  test('runs a command on a key-value database and keeps it out of the log', async () => {
    lines.length = 0;
    const reply = await call(port, 'POST', '/v1/databases/cache/command', json({ command: ['SET', 'private-key', { $base64: 'AP8=' }, 'EX', 60], timeoutMs: 500 }));
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { database: 'cache', engine: 'valkey', result: { value: 'private-result' }, durationMs: 1 });
    assert.deepEqual(commands.at(-1), { args: ['SET', 'private-key', { $base64: 'AP8=' }, 'EX', 60], timeoutMs: 500 });
    const record = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((entry) => entry.msg === 'request');
    assert.equal(record?.route, 'databases.command');
    assert.equal(record?.database, 'cache');
    assert.ok(!lines.join('\n').includes('private-'));
  });

  test('query and command are refused on the wrong kind of database, before reaching the engine', async () => {
    const before = commands.length + seen.length;
    const cases: [string, unknown, number, string][] = [
      ['/v1/databases/cache/query', { sql: 'SELECT 1' }, 400, 'unsupported_operation'],
      ['/v1/databases/app/command', { command: ['GET', 'k'] }, 400, 'unsupported_operation'],
      ['/v1/databases/cache/command', { command: 'GET k' }, 400, 'invalid_request'],
      ['/v1/databases/cache/command', { command: ['GET', 'k'], sql: 'x' }, 400, 'invalid_request'],
      ['/v1/databases/cache/command', { command: ['GET', 'k'], timeoutMs: '5' }, 400, 'invalid_request'],
      ['/v1/databases/missing/command', { command: ['GET', 'k'] }, 404, 'database_not_found'],
    ];
    for (const [urlPath, body, status, code] of cases) {
      const reply = await call(port, 'POST', urlPath, json(body));
      assert.equal(reply.status, status, urlPath);
      assert.equal(reply.body.error.code, code);
    }
    assert.match((await call(port, 'POST', '/v1/databases/cache/query', json({ sql: 'SELECT 1' }))).body.error.message, /use \/v1\/databases\/cache\/command/);
    assert.equal(commands.length + seen.length, before);
    assert.equal((await call(port, 'GET', '/v1/databases/cache/command')).status, 405);

    const refused = await call(port, 'POST', '/v1/databases/cache/command', json({ command: ['FLUSHALL'] }));
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'command_not_allowed');
    assert.equal((await call(port, 'POST', '/v1/databases/cache/command', json({ command: ['NOPE'] }))).status, 422);
  });

  test('errors use one shape and the right status', async () => {
    const cases: [string, string, Parameters<typeof call>[3], number, string][] = [
      ['GET', '/v1/nope', {}, 404, 'not_found'],
      ['GET', '/', {}, 404, 'not_found'],
      ['GET', '/v1/databases/missing', {}, 404, 'database_not_found'],
      ['POST', '/v1/databases/missing/query', json({ sql: 'SELECT 1' }), 404, 'database_not_found'],
      ['DELETE', '/v1/databases/app', {}, 405, 'method_not_allowed'],
      ['GET', '/v1/databases/app/query', {}, 405, 'method_not_allowed'],
      ['POST', '/v1/databases/app/query', { body: '{"sql":"SELECT 1"}' }, 415, 'unsupported_media_type'],
      ['POST', '/v1/databases/app/query', { headers: { 'Content-Type': 'text/plain' }, body: '{"sql":"SELECT 1"}' }, 415, 'unsupported_media_type'],
      ['POST', '/v1/databases/app/query', { headers: { 'Content-Type': 'application/json' }, body: '{oops' }, 400, 'invalid_json'],
      ['POST', '/v1/databases/app/query', json(['SELECT 1']), 400, 'invalid_request'],
      // 2^53 + 1 would reach the engine as 2^53: refused, not rounded.
      ['POST', '/v1/databases/app/query', { headers: { 'Content-Type': 'application/json' }, body: '{"sql":"SELECT ?1","params":[9007199254740993]}' }, 400, 'invalid_request'],
      ['POST', '/v1/databases/app/query', { headers: { 'Content-Type': 'application/json' }, body: '{"sql":"SELECT ?1","params":[-9223372036854775808]}' }, 400, 'invalid_request'],
      ['POST', '/v1/databases/app/query', json({ sql: 1 }), 400, 'invalid_request'],
      ['POST', '/v1/databases/app/query', json({ sql: 'SELECT 1', params: {} }), 400, 'invalid_request'],
      ['POST', '/v1/databases/app/query', json({ sql: 'SELECT 1', timeoutMs: '5' }), 400, 'invalid_request'],
      ['POST', '/v1/databases/app/query', json({ sql: 'SELECT 1', database: 'other' }), 400, 'invalid_request'],
      ['POST', '/v1/databases/app/query', json({ sql: `SELECT '${'x'.repeat(4096)}'` }), 413, 'body_too_large'],
      ['POST', '/v1/databases/app/query', json({ sql: 'FAIL' }), 422, 'query_failed'],
      ['POST', '/v1/databases/app/query', json({ sql: 'SLOW' }), 504, 'timeout'],
      ['POST', '/v1/databases/app/query', json({ sql: 'MISSING' }), 503, 'engine_unavailable'],
      ['POST', '/v1/databases/app/query', json({ sql: 'BUG' }), 500, 'internal_error'],
    ];
    for (const [method, urlPath, options, status, code] of cases) {
      const reply = await call(port, method, urlPath, options);
      assert.equal(reply.status, status, `${method} ${urlPath} ${code}`);
      assert.equal(reply.body.error.code, code);
      assert.equal(typeof reply.body.error.message, 'string');
      assert.equal(reply.body.error.requestId, reply.headers['x-request-id']);
    }
    assert.equal((await call(port, 'DELETE', '/v1/databases/app')).headers.allow, 'GET');
  });

  test('internal errors do not leak details to the client', async () => {
    const reply = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'BUG' }));
    assert.deepEqual(reply.body.error.message, 'an internal error occurred');
    assert.ok(!JSON.stringify(reply.body).includes('hunter2'));
  });

  test('requests a web page could send are refused', async () => {
    const refused: [Record<string, string>, string][] = [
      [{ Host: 'evil.example' }, 'forbidden_host'],
      [{ Host: 'evil.example:8787' }, 'forbidden_host'],
      [{ Host: '127.0.0.1.evil.example' }, 'forbidden_host'],
      [{ Origin: 'http://evil.example' }, 'cross_origin_forbidden'],
      [{ Origin: 'null' }, 'cross_origin_forbidden'],
      [{ 'Sec-Fetch-Site': 'cross-site' }, 'cross_origin_forbidden'],
      [{ 'Sec-Fetch-Site': 'same-site' }, 'cross_origin_forbidden'],
    ];
    for (const [headers, code] of refused) {
      const reply = await call(port, 'POST', '/v1/databases/app/query', { headers: { 'Content-Type': 'application/json', ...headers }, body: '{"sql":"SELECT 1"}' });
      assert.equal(reply.status, 403, JSON.stringify(headers));
      assert.equal(reply.body.error.code, code);
    }
    const before = seen.length;
    await call(port, 'POST', '/v1/databases/app/query', { headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: '{"sql":"SELECT 1"}' });
    assert.equal(seen.length, before, 'a refused request must not reach the engine');
    assert.equal((await call(port, 'GET', '/v1/health', { headers: { Host: 'localhost:9' } })).status, 200);
  });

  test('Host header check', () => {
    for (const host of ['localhost', 'localhost:8787', 'LOCALHOST:1', '127.0.0.1', '127.0.0.1:8787', '[::1]', '[::1]:8787']) assert.equal(isLocalHostHeader(host), true, host);
    for (const host of [undefined, '', 'example.com', 'localhost.example.com', '127.0.0.1.example.com', '192.168.0.2:8787', '[::2]:8787']) assert.equal(isLocalHostHeader(host), false, String(host));
  });

  test('queries beyond the concurrency limit get 429, and a disconnect cancels the running query', async () => {
    const waiting = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/databases/app/query', headers: { 'Content-Type': 'application/json' } });
    waiting.on('error', () => {});
    waiting.end('{"sql":"WAIT"}');
    while (release === undefined) await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'SELECT 1' }));
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, 'too_many_requests');
    assert.equal(second.headers['retry-after'], '1');

    waiting.destroy();
    while (!aborted) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'SELECT 1' }))).status, 200);
  });

  test('request logs carry the outcome but never SQL, parameters or rows', async () => {
    lines.length = 0;
    await call(port, 'POST', '/v1/databases/app/query', json({ sql: "SELECT 'private-sql-text'", params: ['private-param'] }));
    await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'FAIL' }));
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((record) => record.msg === 'request');
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map(({ method, route, database, engine, status, rows, error }) => ({ method, route, database, engine, status, rows, error })),
      [
        { method: 'POST', route: 'databases.query', database: 'app', engine: 'sqlite', status: 200, rows: 1, error: undefined },
        { method: 'POST', route: 'databases.query', database: 'app', engine: 'sqlite', status: 422, rows: undefined, error: 'query_failed' },
      ],
    );
    assert.ok(!lines.join('\n').includes('private-'));
  });
});

const sqlite = builtEngine('sqlite', 'sqlite3');

describe('REST API over the built SQLite engine', { skip: sqlite.skip }, () => {
  let dir: string;
  let server: http.Server;
  let port: number;
  let databases: Database[];

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-api-test-'));
    const file = path.join(dir, 'app.sqlite');
    databases = [
      { name: 'app', engine: 'sqlite', readOnly: false, adapter: createSqliteAdapter({ binary: sqlite.binary, file }) },
      { name: 'app-ro', engine: 'sqlite', readOnly: true, adapter: createSqliteAdapter({ binary: sqlite.binary, file, readOnly: true }) },
    ];
    server = createApiServer({ databases, logger: createLogger({ level: 'silent' }) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(databases.map((database) => database.adapter.close()));
    await rm(dir, { recursive: true, force: true });
  });

  test('creates, writes, reads and reports engine errors end to end', async () => {
    const created = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL)' }));
    assert.equal(created.status, 200);
    assert.deepEqual(created.body.results, []);

    const inserted = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'INSERT INTO notes(body) VALUES (?1), (?2) RETURNING id', params: ["it's; DROP TABLE notes", 'second'] }));
    assert.deepEqual(inserted.body.results[0].rows, [{ id: 1 }, { id: 2 }]);

    const read = await call(port, 'POST', '/v1/databases/app-ro/query', json({ sql: 'SELECT id, body FROM notes ORDER BY id' }));
    assert.deepEqual(read.body.results, [{ columns: ['id', 'body'], rows: [{ id: 1, body: "it's; DROP TABLE notes" }, { id: 2, body: 'second' }], rowCount: 2 }]);

    const denied = await call(port, 'POST', '/v1/databases/app-ro/query', json({ sql: 'DELETE FROM notes' }));
    assert.equal(denied.status, 422);
    assert.match(denied.body.error.message, /readonly/);

    const failed = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'INSERT INTO notes(body) VALUES (NULL)' }));
    assert.equal(failed.status, 422);
    assert.match(failed.body.error.message, /NOT NULL constraint failed: notes\.body/);

    const slow = await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r) SELECT count(*) FROM r', timeoutMs: 200 }));
    assert.equal(slow.status, 504);
    assert.equal((await call(port, 'POST', '/v1/databases/app/query', json({ sql: 'SELECT 1', timeoutMs: 999_999_999 }))).status, 400);
  });
});

test('stopping the server cancels the queries still running after the grace period', async () => {
  let started: (() => void) | undefined;
  const running = new Promise<void>((resolve) => (started = resolve));
  let cancelled = false;
  const adapter = fakeAdapter(
    (_sql, _params, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          cancelled = true;
          reject(new EngineError('cancelled', 'the request was cancelled'));
        });
        started?.();
      }),
  );
  const server = createApiServer({ databases: [{ name: 'app', engine: 'sqlite', readOnly: false, adapter }], logger: createLogger({ level: 'silent' }) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const pending = call(port, 'POST', '/v1/databases/app/query', json({ sql: 'ENDLESS' })).then(
    () => 'answered',
    () => 'connection closed',
  );
  await running;
  const begun = performance.now();
  await stopApiServer(server, 100);
  assert.equal(await pending, 'connection closed');
  for (let waited = 0; !cancelled && waited < 2000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cancelled, true);
  assert.ok(performance.now() - begun >= 90, 'running requests get the grace period');
  assert.equal(server.listening, false);
});
