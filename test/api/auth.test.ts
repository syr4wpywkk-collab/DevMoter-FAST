import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApiServer, stopApiServer, type Database } from '../../src/api/server.ts';
import { createAuditLog, verifyAuditLog } from '../../src/audit/log.ts';
import { createKeyStore, type KeyStore } from '../../src/auth/keys.ts';
import { EngineError, type KeyValueAdapter, type SqlAdapter } from '../../src/engines/types.ts';
import { createLogger } from '../../src/logging/logger.ts';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

function call(port: number, method: string, urlPath: string, headers: Record<string, string> = {}, body?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('REST API with API keys and the audit log', () => {
  let dir: string;
  let auditFile: string;
  let store: KeyStore;
  let server: http.Server;
  let port: number;
  let key: string;
  let keyId: string;
  let ran = 0;
  const lines: string[] = [];
  const bearer = () => ({ Authorization: `Bearer ${key}` });
  const audit = async () => (await readFile(auditFile, 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-api-auth-'));
    auditFile = path.join(dir, 'audit.log');
    store = createKeyStore(path.join(dir, 'keys.json'));
    ({ key } = await store.create('test'));
    keyId = key.split('_')[1] as string;
    const sql: SqlAdapter = {
      engine: 'sqlite',
      kind: 'sql',
      async query(text) {
        ran += 1;
        if (text.startsWith('DROP')) throw new EngineError('query_failed', 'no such table: private_table');
        return { results: [{ columns: ['v'], rows: [{ v: 'private-row' }], rowCount: 1 }], durationMs: 1 };
      },
      health: async () => ({ status: 'ok', version: '1', latencyMs: 1 }),
      async close() {},
    };
    const keyvalue: KeyValueAdapter = {
      engine: 'valkey',
      kind: 'keyvalue',
      async command() {
        ran += 1;
        return { result: 'private-value', durationMs: 1 };
      },
      health: async () => ({ status: 'ok', version: '1', latencyMs: 1 }),
      async close() {},
    };
    const databases: Database[] = [
      { name: 'app', engine: 'sqlite', readOnly: false, adapter: sql },
      { name: 'cache', engine: 'valkey', readOnly: false, adapter: keyvalue },
    ];
    server = createApiServer({ databases, logger: createLogger({ sink: (line) => lines.push(line) }), auth: store, audit: createAuditLog(auditFile) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  test('liveness needs no key and is not audited', async () => {
    assert.equal((await call(port, 'GET', '/v1/health')).status, 200);
    await assert.rejects(readFile(auditFile, 'utf8'));
  });

  test('every other endpoint refuses a request without a valid key, before touching an engine', async () => {
    const wrong = `${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`;
    const attempts: [Record<string, string>, string, RegExp][] = [
      [{}, 'missing', /an API key is required/],
      [{ Authorization: 'Basic dXNlcjpwYXNz' }, 'malformed', /an API key is required/],
      [{ Authorization: `Bearer ${key} extra` }, 'malformed', /an API key is required/],
      [{ Authorization: 'Bearer nonsense' }, 'malformed', /not valid/],
      [{ Authorization: `Bearer ${wrong}` }, 'unknown', /not valid/],
      [{ Authorization: key }, 'malformed', /an API key is required/],
    ];
    for (const [headers, reason, message] of attempts) {
      const reply = await call(port, 'POST', '/v1/databases/app/query', headers, { sql: 'SELECT 1' });
      assert.equal(reply.status, 401, reason);
      assert.equal(reply.body.error.code, 'unauthorized');
      assert.match(reply.body.error.message, message);
      assert.equal(reply.headers['www-authenticate'], 'Bearer realm="devmoter-base"');
      assert.equal((await audit()).at(-1)?.event, 'auth.failed');
      assert.equal((await audit()).at(-1)?.reason, reason);
    }
    for (const urlPath of ['/v1/databases', '/v1/databases/app', '/v1/databases/app/health', '/v1/health/engines', '/v1/nope']) {
      assert.equal((await call(port, 'GET', urlPath)).status, 401, urlPath);
    }
    assert.equal(ran, 0);
  });

  test('a valid key is accepted and the request is audited with who, what and the outcome', async () => {
    assert.equal((await call(port, 'GET', '/v1/databases', bearer())).status, 200);
    const query = await call(port, 'POST', '/v1/databases/app/query', bearer(), { sql: "select 'private-sql'", params: ['private-param'] });
    assert.equal(query.status, 200);
    const failed = await call(port, 'POST', '/v1/databases/app/query', bearer(), { sql: 'DROP TABLE private_table' });
    assert.equal(failed.status, 422);
    assert.equal((await call(port, 'POST', '/v1/databases/cache/command', bearer(), { command: ['set', 'private-key', 'private-arg'] })).status, 200);
    assert.equal((await call(port, 'GET', '/v1/nope', bearer())).status, 404);

    const records = (await audit()).slice(-5).map(({ time, prev, durationMs, ...rest }) => {
      assert.match(time as string, /^\d{4}-\d\d-\d\dT/);
      assert.match(prev as string, /^[0-9a-f]{64}$/);
      assert.equal(typeof durationMs, 'number');
      return rest;
    });
    assert.deepEqual(records, [
      { event: 'api.request', requestId: records[0]?.requestId, method: 'GET', route: 'databases.list', keyId, status: 200 },
      { event: 'api.request', requestId: query.headers['x-request-id'], method: 'POST', keyId, route: 'databases.query', database: 'app', engine: 'sqlite', operation: 'SELECT', rows: 1, status: 200 },
      { event: 'api.request', requestId: failed.headers['x-request-id'], method: 'POST', keyId, route: 'databases.query', database: 'app', engine: 'sqlite', operation: 'DROP', error: 'query_failed', status: 422 },
      { event: 'api.request', requestId: records[3]?.requestId, method: 'POST', keyId, route: 'databases.command', database: 'cache', engine: 'valkey', operation: 'SET', status: 200 },
      { event: 'api.request', requestId: records[4]?.requestId, method: 'GET', keyId, error: 'not_found', status: 404 },
    ]);
  });

  test('reading one database or its health is audited with the database', async () => {
    const detail = await call(port, 'GET', '/v1/databases/app', bearer());
    const health = await call(port, 'GET', '/v1/databases/cache/health', bearer());
    const missing = await call(port, 'GET', '/v1/databases/nope', bearer());
    assert.deepEqual([detail.status, missing.status], [200, 404]);
    const records = (await audit()).slice(-3).map(({ route, database, engine, status }) => ({ route, database, engine, status }));
    assert.deepEqual(records, [
      { route: 'databases.get', database: 'app', engine: 'sqlite', status: 200 },
      { route: 'databases.health', database: 'cache', engine: 'valkey', status: health.status },
      { route: 'databases.get', database: undefined, engine: undefined, status: 404 },
    ]);
  });

  test('a revoked key is refused at once', async () => {
    const before = ran;
    await store.revoke(keyId);
    const reply = await call(port, 'POST', '/v1/databases/app/query', bearer(), { sql: 'SELECT 1' });
    assert.equal(reply.status, 401);
    assert.match(reply.body.error.message, /not valid/);
    assert.equal(ran, before);
    const last = (await audit()).at(-1);
    assert.deepEqual({ event: last?.event, reason: last?.reason, keyId: last?.keyId }, { event: 'auth.failed', reason: 'revoked', keyId });
  });

  test('neither the audit log nor the request log holds keys, SQL, parameters, commands or results', async () => {
    const secret = key.split('_').slice(2).join('_');
    for (const text of [await readFile(auditFile, 'utf8'), lines.join('\n')]) {
      assert.ok(!text.includes(secret));
      assert.ok(!text.includes('private-'));
      assert.ok(!text.includes('private_table'));
      assert.ok(!text.includes('dXNlcjpwYXNz'));
    }
    assert.equal((await verifyAuditLog(auditFile)).ok, true);
    const logged = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.msg === 'request');
    assert.ok(logged.some((entry) => entry.keyId === keyId && entry.operation === 'SELECT'));
  });

  test('a request is still answered when the audit record cannot be written, and the failure is logged', async () => {
    const broken = createApiServer({ databases: [], logger: createLogger({ sink: (line) => lines.push(line) }), audit: { record: () => Promise.reject(new Error('disk full')) } });
    await new Promise<void>((resolve) => broken.listen(0, '127.0.0.1', resolve));
    lines.length = 0;
    assert.equal((await call((broken.address() as AddressInfo).port, 'GET', '/v1/databases')).status, 200);
    assert.ok(lines.some((line) => line.includes('the audit record could not be written')));
    await new Promise<void>((resolve) => broken.close(() => resolve()));
  });
});

test('stopping the server waits for the audit record of a request whose caller has gone', async () => {
  let recording: (() => void) | undefined;
  const begun = new Promise<void>((resolve) => (recording = resolve));
  let written = false;
  const audit = {
    record: async () => {
      recording?.();
      await new Promise((resolve) => setTimeout(resolve, 300));
      written = true;
    },
  };
  const server = createApiServer({ databases: [], logger: createLogger({ level: 'silent' }), audit });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = http.request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, method: 'GET', path: '/v1/databases' });
  request.on('error', () => {});
  request.end();
  await begun;
  request.destroy();
  await stopApiServer(server, 50);
  assert.equal(written, true);
});
