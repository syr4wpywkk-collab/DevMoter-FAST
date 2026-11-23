import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { MAX_PARAMS, MAX_SQL_BYTES, createPostgresqlAdapter, encodePostgresqlParam, postgresqlError, postgresqlTypes, validatePostgresqlRequest } from '../../src/engines/postgresql.ts';
import { EngineError, type QueryParam, type SqlAdapter } from '../../src/engines/types.ts';
import { builtEngine, startPostgresql, type TestServer } from './helpers.ts';

const rejectsWith = (code: string, message?: RegExp) => (error: unknown) =>
  error instanceof EngineError && error.code === code && (message === undefined || message.test(error.message));

test('parameters are converted to what the client sends separately from the SQL', () => {
  assert.equal(encodePostgresqlParam(null, 1), null);
  assert.equal(encodePostgresqlParam(true, 1), 'true');
  assert.equal(encodePostgresqlParam(-1.5, 1), '-1.5');
  assert.equal(encodePostgresqlParam(-0, 1), '0');
  assert.equal(encodePostgresqlParam("a'b", 1), "a'b");
  assert.deepEqual(encodePostgresqlParam({ $base64: 'AP8=' }, 1), Buffer.from([0, 255]));
  const bad: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, '\ud800', 'a\0b', { $base64: '!' }, { other: 1 }, [1], undefined];
  for (const param of bad) assert.throws(() => encodePostgresqlParam(param as QueryParam, 2), rejectsWith('invalid_request', /parameter 2/), String(param));
});

test('oversized or malformed requests are rejected before connecting', () => {
  const invalid = rejectsWith('invalid_request');
  assert.throws(() => validatePostgresqlRequest(' ', []), invalid);
  assert.throws(() => validatePostgresqlRequest('SELECT 1\0', []), invalid);
  assert.throws(() => validatePostgresqlRequest(`SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, []), invalid);
  assert.throws(() => validatePostgresqlRequest('SELECT 1', 'x' as unknown as QueryParam[]), invalid);
  assert.throws(() => validatePostgresqlRequest('SELECT 1', new Array<QueryParam>(MAX_PARAMS + 1).fill(1)), invalid);
});

test('only types JSON holds exactly are converted; the rest stay text', () => {
  const parse = (oid: number, text: string) => postgresqlTypes.getTypeParser(oid)(text);
  assert.equal(parse(16, 't'), true);
  assert.equal(parse(16, 'f'), false);
  assert.equal(parse(23, '-42'), -42);
  assert.equal(parse(701, '1.5'), 1.5);
  assert.equal(parse(701, 'NaN'), 'NaN');
  assert.equal(parse(700, '-Infinity'), '-Infinity');
  assert.deepEqual(parse(3802, '{"a":[1,9007199254740993]}'), { a: [1, '9007199254740993'] });
  assert.equal(parse(20, '9223372036854775807'), '9223372036854775807');
  assert.equal(parse(1700, '1.10'), '1.10');
  assert.equal(parse(1184, '2026-01-02 03:04:05+09'), '2026-01-02 03:04:05+09');
});

test('errors are mapped to the common codes', () => {
  const server = (code: string, message: string, extra: object = {}) => postgresqlError({ code, message, severity: 'ERROR', ...extra });
  assert.ok(rejectsWith('query_failed', /^relation "t" does not exist \(SQLSTATE 42P01\)$/)(server('42P01', 'relation "t" does not exist')));
  assert.ok(rejectsWith('query_failed', /\(SQLSTATE 23505\)\nDETAIL: Key \(id\)=\(1\) already exists\.\nHINT: try another$/)(server('23505', 'duplicate key', { detail: 'Key (id)=(1) already exists.', hint: 'try another' })));
  assert.ok(rejectsWith('timeout')(server('57014', 'canceling statement due to statement timeout')));
  assert.ok(rejectsWith('query_failed')(server('57014', 'canceling statement due to user request')));
  assert.ok(rejectsWith('query_failed')(server('08P01', 'bind message supplies 1 parameters, but prepared statement "" requires 2')));
  for (const code of ['28P01', '28000', '3D000', '53300', '57P03', '08006']) assert.ok(rejectsWith('engine_unavailable', new RegExp(code))(server(code, 'refused')), code);
  assert.ok(rejectsWith('engine_unavailable', /ECONNREFUSED/)(postgresqlError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }))));
  assert.ok(rejectsWith('engine_unavailable', /Connection terminated unexpectedly/)(postgresqlError(new Error('Connection terminated unexpectedly'))));
  const own = new EngineError('cancelled', 'x');
  assert.equal(postgresqlError(own), own);
});

const postgres = builtEngine('postgresql', 'postgres');
// The server refuses to run as root.
const skip = postgres.skip || (process.getuid?.() === 0 ? 'the PostgreSQL server cannot run as root' : false);

describe('PostgreSQL adapter against the built engine', { skip }, () => {
  let server: TestServer;
  let adapter: SqlAdapter;
  const connection = () => ({ host: server.socket, port: 5432, database: 'postgres', user: 'devmoter' });

  before(async () => {
    server = await startPostgresql(path.dirname(postgres.binary));
    adapter = createPostgresqlAdapter(connection());
    await adapter.query('CREATE TABLE t(id int PRIMARY KEY, name text, data bytea, n float8, ok boolean, big bigint, doc jsonb, at timestamptz, tags int[])', []);
  });
  after(async () => {
    await adapter.close();
    await server.stop();
  });

  test('writes and reads back every parameter type', async () => {
    const hostile = "Robert'); DROP TABLE t;--";
    const inserted = await adapter.query('INSERT INTO t VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9), (2, $10, NULL, NULL, $11, NULL, NULL, NULL, NULL) RETURNING id', [
      1, hostile, { $base64: 'AP8=' }, 1.5, true, '9223372036854775807', '{"a":[1,9007199254740993]}', '2026-01-02T03:04:05+09:00', '{1,2}', 'あ🙂', false,
    ]);
    assert.deepEqual(inserted.results, [{ columns: ['id'], rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }]);
    const read = await adapter.query('SELECT * FROM t ORDER BY id', []);
    assert.deepEqual(read.results[0]?.columns, ['id', 'name', 'data', 'n', 'ok', 'big', 'doc', 'at', 'tags']);
    assert.deepEqual(read.results[0]?.rows, [
      { id: 1, name: hostile, data: '\\x00ff', n: 1.5, ok: true, big: '9223372036854775807', doc: { a: [1, '9007199254740993'] }, at: '2026-01-01 18:04:05+00', tags: '{1,2}' },
      { id: 2, name: 'あ🙂', data: null, n: null, ok: false, big: null, doc: null, at: null, tags: null },
    ]);
  });

  test('several statements return one result set per statement that has columns', async () => {
    const { results } = await adapter.query("CREATE TEMP TABLE u(a int); SELECT 'NaN'::float8 AS nan, 1.10::numeric AS num; SELECT id FROM t WHERE false", []);
    assert.deepEqual(results, [
      { columns: ['nan', 'num'], rows: [{ nan: 'NaN', num: '1.10' }], rowCount: 1 },
      { columns: ['id'], rows: [], rowCount: 0 },
    ]);
  });

  test('SQL errors carry the engine message and SQLSTATE', async () => {
    await assert.rejects(adapter.query('SELECT nope', []), rejectsWith('query_failed', /^column "nope" does not exist \(SQLSTATE 42703\)$/));
    await assert.rejects(adapter.query('INSERT INTO t(id) VALUES (1)', []), rejectsWith('query_failed', /SQLSTATE 23505\)\nDETAIL: Key \(id\)=\(1\) already exists/));
    await assert.rejects(adapter.query('SELECT $1::int + $2::int', [1]), rejectsWith('query_failed', /requires 2/));
    await assert.rejects(adapter.query('SELECT 1; SELECT $1::int', [1]), rejectsWith('query_failed', /multiple commands/));
  });

  test('a failed statement rolls back the transaction it is in', async () => {
    await assert.rejects(adapter.query('BEGIN; INSERT INTO t(id) VALUES (9); SELECT nope; COMMIT;', []), rejectsWith('query_failed'));
    assert.deepEqual((await adapter.query('SELECT count(*)::int AS c FROM t WHERE id = 9', [])).results[0]?.rows, [{ c: 0 }]);
  });

  const running = async () => (await adapter.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(%' AND state = 'active' AND pid <> pg_backend_pid()", [])).results[0]?.rows[0]?.c;

  test('a runaway query is stopped at the time limit, on the server too', async () => {
    await assert.rejects(adapter.query('SELECT pg_sleep(30)', [], { timeoutMs: 300 }), rejectsWith('timeout'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await running(), 0);
  });

  test('cancelling a request stops the query on the server', async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 200);
    await assert.rejects(adapter.query('SELECT pg_sleep(30)', [], { signal: abort.signal }), rejectsWith('cancelled'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await running(), 0);
    abort.abort();
    await assert.rejects(adapter.query('SELECT 1', [], { signal: abort.signal }), rejectsWith('cancelled'));
  });

  test('a result larger than the limit is refused', async () => {
    await assert.rejects(adapter.query("SELECT repeat('x', 1000) FROM generate_series(1, 40000)", []), rejectsWith('result_too_large'));
  });

  test('a read-only database starts every transaction read-only', async () => {
    const readOnly = createPostgresqlAdapter({ ...connection(), readOnly: true });
    assert.deepEqual((await readOnly.query('SELECT count(*)::int AS c FROM t', [])).results[0]?.rows, [{ c: 2 }]);
    await assert.rejects(readOnly.query('DELETE FROM t', []), rejectsWith('query_failed', /read-only transaction \(SQLSTATE 25006\)/));
    await readOnly.close();
  });

  test('health reports the engine version, or why the engine is unavailable', async () => {
    const health = await adapter.health();
    assert.equal(health.status, 'ok');
    assert.match(health.version ?? '', /^\d+/);

    const noServer = await createPostgresqlAdapter({ ...connection(), host: path.join(server.socket, 'missing') }).health();
    assert.deepEqual({ ...noServer, latencyMs: 0 }, { status: 'unavailable', latencyMs: 0, message: 'cannot reach the PostgreSQL server (ENOENT)' });
    const noDatabase = await createPostgresqlAdapter({ ...connection(), database: 'missing' }).health();
    assert.equal(noDatabase.status, 'unavailable');
    assert.match(noDatabase.message ?? '', /database "missing" does not exist \(SQLSTATE 3D000\)/);
  });

  test('a closed adapter refuses queries', async () => {
    const closed = createPostgresqlAdapter(connection());
    await closed.close();
    await assert.rejects(closed.query('SELECT 1', []), rejectsWith('engine_unavailable'));
  });
});
