import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { MAX_PARAMS, MAX_SQL_BYTES, createDuckdbAdapter, duckdbArguments, duckdbErrorMessage, encodeDuckdbLiteral } from '../../src/engines/duckdb.ts';
import { createSqliteAdapter } from '../../src/engines/sqlite.ts';
import { EngineError, type QueryParam, type SqlAdapter } from '../../src/engines/types.ts';
import { builtEngine } from './helpers.ts';

const rejectsWith = (code: string, message?: RegExp) => (error: unknown) =>
  error instanceof EngineError && error.code === code && (message === undefined || message.test(error.message));

test('parameters are encoded so that no character of a value is read as SQL', () => {
  assert.equal(encodeDuckdbLiteral(null, 1), 'NULL');
  assert.equal(encodeDuckdbLiteral(true, 1), 'true');
  assert.equal(encodeDuckdbLiteral(false, 1), 'false');
  assert.equal(encodeDuckdbLiteral(-1.5, 1), '-1.5');
  assert.equal(encodeDuckdbLiteral(-0, 1), '0');
  assert.equal(encodeDuckdbLiteral('', 1), "''");
  assert.equal(encodeDuckdbLiteral("a'b", 1), "decode(from_hex('612762'))");
  assert.equal(encodeDuckdbLiteral({ $base64: 'AP8=' }, 1), "from_hex('00ff')");
  const bad: unknown[] = [Number.NaN, Number.NEGATIVE_INFINITY, '\ud800', 'a\0b', { $base64: '!' }, { other: 1 }, [1], undefined];
  for (const param of bad) assert.throws(() => encodeDuckdbLiteral(param as QueryParam, 2), rejectsWith('invalid_request', /parameter 2/), String(param));
});

test('the shell runs in safe mode and the SQL can never be a dot-command', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  assert.deepEqual(duckdbArguments(options, '.shell id', []), ['-safe', '-batch', '-no-init', '-json', '/data/a.duckdb', '-c', ' .shell id']);
  assert.deepEqual(duckdbArguments({ ...options, readOnly: true }, 'SELECT 1', []).slice(0, 5), ['-safe', '-batch', '-no-init', '-json', '-readonly']);
  assert.equal(
    duckdbArguments(options, 'SELECT ?, ? -- note ;\n', ['a', 2]).at(-1),
    " PREPARE devmoter_base_request AS SELECT ?, ? -- note\n; EXECUTE devmoter_base_request(decode(from_hex('61')),2)",
  );
});

test('oversized or malformed requests are rejected before the engine starts', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  const invalid = rejectsWith('invalid_request');
  assert.throws(() => duckdbArguments(options, ' ', []), invalid);
  assert.throws(() => duckdbArguments(options, 'SELECT 1\0', []), invalid);
  assert.throws(() => duckdbArguments(options, `SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, []), invalid);
  assert.throws(() => duckdbArguments(options, 'SELECT 1', 'x' as unknown as QueryParam[]), invalid);
  assert.throws(() => duckdbArguments(options, 'SELECT 1', new Array<QueryParam>(MAX_PARAMS + 1).fill(1)), invalid);
  assert.throws(() => duckdbArguments(options, 'SELECT ?', ['x'.repeat(30_000)]), rejectsWith('invalid_request', /parameters are larger/));
});

test('error output is reduced to the engine message', () => {
  assert.equal(duckdbErrorMessage('Catalog Error: Table with name nope does not exist!\nhint: -agent renders errors as JSON and results compactly for AI coding agents (duckdb -help lists all options)\n'), 'Catalog Error: Table with name nope does not exist!');
  assert.equal(duckdbErrorMessage('\n'), 'the query failed');
});

const duckdb = builtEngine('duckdb', 'duckdb');

describe('DuckDB adapter against the built engine', { skip: duckdb.skip }, () => {
  let dir: string;
  let adapter: SqlAdapter;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-duckdb-test-'));
    adapter = createDuckdbAdapter({ binary: duckdb.binary, file: path.join(dir, 'a.duckdb') });
    await adapter.query('CREATE TABLE t(id INTEGER PRIMARY KEY, name VARCHAR, data BLOB, n DOUBLE, ok BOOLEAN)', []);
  });
  after(async () => {
    await adapter.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('writes and reads back every parameter type', async () => {
    const hostile = "Robert'); DROP TABLE t;--\n.shell id";
    const inserted = await adapter.query('INSERT INTO t VALUES (?, ?, ?, ?, ?), (2, ?, NULL, NULL, ?) RETURNING id -- trailing comment', [1, hostile, { $base64: 'AP8=' }, 1.5, true, 'あ🙂', false]);
    assert.deepEqual(inserted.results, [{ columns: ['id'], rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }]);
    const read = await adapter.query('SELECT id, name, hex(data) AS data, n, ok FROM t ORDER BY id; SELECT count(*) AS c FROM t', []);
    assert.deepEqual(read.results, [
      {
        columns: ['id', 'name', 'data', 'n', 'ok'],
        rows: [
          { id: 1, name: hostile, data: '00FF', n: 1.5, ok: true },
          { id: 2, name: 'あ🙂', data: null, n: null, ok: false },
        ],
        rowCount: 2,
      },
      { columns: ['c'], rows: [{ c: 2 }], rowCount: 1 },
    ]);
  });

  test('wide integers stay exact, non-finite doubles become strings, nested types stay nested', async () => {
    const { results } = await adapter.query("SELECT 9223372036854775807 AS big, 'inf'::DOUBLE AS inf, 'nan'::DOUBLE AS nan, 'NaN \"Infinity\"' AS text, [1, 2] AS list, {'k': 'v'} AS struct", []);
    assert.deepEqual(results[0]?.rows, [{ big: '9223372036854775807', inf: 'Infinity', nan: 'NaN', text: 'NaN "Infinity"', list: [1, 2], struct: { k: 'v' } }]);
  });

  test('an empty result is an empty result set; a statement without a result yields none', async () => {
    assert.deepEqual((await adapter.query('SELECT * FROM t WHERE false', [])).results, [{ columns: [], rows: [], rowCount: 0 }]);
    assert.deepEqual((await adapter.query('CREATE TABLE IF NOT EXISTS u(a INTEGER)', [])).results, []);
  });

  test('SQL errors are reported with the engine message, and a missing parameter is an error', async () => {
    await assert.rejects(adapter.query('SELECT nope FROM t', []), rejectsWith('query_failed', /^Binder Error: Referenced column "nope"/));
    await assert.rejects(adapter.query('INSERT INTO t(id) VALUES (1)', []), rejectsWith('query_failed', /Constraint Error/));
    await assert.rejects(adapter.query('SELECT $1 AS a, $2 AS b', ['only one']), rejectsWith('query_failed', /Values were not provided/));
  });

  test('a failed statement rolls back the transaction it is in', async () => {
    await assert.rejects(adapter.query('BEGIN; INSERT INTO t(id) VALUES (9); SELECT nope; COMMIT;', []), rejectsWith('query_failed'));
    assert.deepEqual((await adapter.query('SELECT count(*) AS c FROM t WHERE id = 9', [])).results[0]?.rows, [{ c: 0 }]);
  });

  test('a query cannot reach other files, the environment or programs', async () => {
    const outside = path.join(dir, 'outside');
    const attempts = [
      `ATTACH '${outside}.duckdb' AS o`,
      `COPY t TO '${outside}.csv'`,
      `EXPORT DATABASE '${outside}'`,
      "SELECT * FROM read_text('/etc/hostname')",
      "SELECT * FROM '/etc/passwd'",
      "SELECT getenv('HOME')",
      'INSTALL httpfs',
      'SET enable_external_access = true',
      `.shell touch ${outside}`,
      `.open ${outside}.duckdb`,
      `-init ${outside}`,
    ];
    for (const sql of attempts) await assert.rejects(adapter.query(sql, []), rejectsWith('query_failed'), sql);
    for (const suffix of ['', '.duckdb', '.csv']) assert.equal(existsSync(outside + suffix), false);
  });

  test('a read-only database refuses writes', async () => {
    const readOnly = createDuckdbAdapter({ binary: duckdb.binary, file: path.join(dir, 'a.duckdb'), readOnly: true });
    try {
      assert.deepEqual((await readOnly.query('SELECT count(*) AS c FROM t', [])).results[0]?.rows, [{ c: 2 }]);
      await assert.rejects(readOnly.query('DELETE FROM t', []), rejectsWith('query_failed', /read-only/));
    } finally {
      await readOnly.close();
    }
  });

  test('a runaway query is stopped at the time limit', async () => {
    await assert.rejects(adapter.query('SELECT count(*) FROM range(100000000000) a, range(1000) b', [], { timeoutMs: 400 }), rejectsWith('timeout'));
  });

  test('health reports the engine version, or why the engine is unavailable', async () => {
    const health = await adapter.health();
    assert.equal(health.status, 'ok');
    assert.match(health.version ?? '', /^v\d+\.\d+/);
    assert.ok(health.latencyMs >= 0);

    const missingFile = createDuckdbAdapter({ binary: duckdb.binary, file: path.join(dir, 'missing.duckdb'), readOnly: true });
    const broken = await missingFile.health();
    assert.equal(broken.status, 'unavailable');
    assert.ok(broken.message);
    await missingFile.close();

    const missingBinary = createDuckdbAdapter({ binary: path.join(dir, 'no-such-duckdb'), file: path.join(dir, 'a.duckdb') });
    assert.deepEqual({ ...(await missingBinary.health()), latencyMs: 0 }, { status: 'unavailable', latencyMs: 0, message: 'the duckdb engine is not built; run "npm run build:engines -- duckdb"' });
    await missingBinary.close();
  });
});

const sqlite = builtEngine('sqlite', 'sqlite3');

describe('SQLite health check against the built engine', { skip: sqlite.skip }, () => {
  test('reports the engine version, or why the engine is unavailable', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-sqlite-health-'));
    try {
      const adapter = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, 'a.sqlite') });
      const health = await adapter.health();
      assert.equal(health.status, 'ok');
      assert.match(health.version ?? '', /^3\.\d+\.\d+$/);
      await adapter.close();

      const unreachable = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, 'no-such-dir', 'a.sqlite') });
      const broken = await unreachable.health();
      assert.equal(broken.status, 'unavailable');
      assert.ok(broken.message);
      await unreachable.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
