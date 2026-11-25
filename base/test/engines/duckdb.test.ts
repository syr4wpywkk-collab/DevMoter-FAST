import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { MAX_PARAMS, MAX_SQL_BYTES, createDuckdbAdapter, duckdbErrorMessage, duckdbInvocation, encodeDuckdbLiteral, isReturningWrite } from '../../src/engines/duckdb.ts';
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

test('the shell runs in safe mode and nothing of the request is a program argument', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  assert.deepEqual(duckdbInvocation(options, "SELECT 'sql-secret'", []), {
    args: ['-safe', '-batch', '-no-init', '-bail', '-json', '/data/a.duckdb'],
    input: ".changes on\nSELECT 'sql-secret'\n",
    explain: false,
  });
  assert.deepEqual(duckdbInvocation({ ...options, readOnly: true }, 'SELECT 1', []).args, ['-safe', '-batch', '-no-init', '-bail', '-json', '-readonly', '/data/a.duckdb']);
  const prepared = duckdbInvocation(options, 'SELECT ?, ? -- note ;\n', ['a', 2]);
  assert.deepEqual(prepared.args, ['-safe', '-batch', '-no-init', '-bail', '-json', '/data/a.duckdb']);
  assert.equal(prepared.input, ".changes on\nPREPARE devmoter_base_request AS SELECT ?, ? -- note\n; EXECUTE devmoter_base_request(decode(from_hex('61')),2);\n");
});

test('the SQL can never be a dot-command of the shell', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  for (const sql of ['.shell id', 'SELECT 1;\n.open /tmp/x', "SELECT '\n.text'"]) {
    assert.throws(() => duckdbInvocation(options, sql, []), rejectsWith('invalid_request', /must not start with "\."/), sql);
  }
  for (const sql of ['SELECT 1;\n .5 + 1', 'SELECT t\n  .id FROM t', '-init x']) assert.equal(duckdbInvocation(options, sql, []).input, `.changes on\n${sql}\n`);
  assert.doesNotMatch(duckdbInvocation(options, 'SELECT ?', ['a\n.shell id']).input, /^\.shell/m);
});

test('with parameters only one statement is accepted: a second one would run before the values are checked', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  const single = rejectsWith('invalid_request', /single statement/);
  assert.throws(() => duckdbInvocation(options, 'SELECT ?; DELETE FROM t', [1]), single);
  assert.throws(() => duckdbInvocation(options, 'SELECT $1; -- c\n INSERT INTO t VALUES (1);', [1]), single);
  // DuckDB ends a "--" comment at a lone carriage return too.
  assert.throws(() => duckdbInvocation(options, 'SELECT $1; -- c\rINSERT INTO t VALUES (1);', [1]), single);
  assert.doesNotThrow(() => duckdbInvocation(options, "SELECT ?, 'a;b' /* ; */ ; -- ;\n", [1]));
  assert.doesNotThrow(() => duckdbInvocation(options, 'SELECT 1; SELECT 2', []));
});

test('a single EXPLAIN statement is marked: its output is a plan, not rows', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  assert.equal(duckdbInvocation(options, '-- why\n explain analyze SELECT 1;', []).explain, true);
  assert.equal(duckdbInvocation(options, 'SELECT 1; EXPLAIN SELECT 1', []).explain, false);
  assert.equal(duckdbInvocation(options, 'EXPLAIN SELECT 1; SELECT 1', []).explain, false);
});

test('oversized or malformed requests are rejected before the engine starts', () => {
  const options = { binary: '/x/duckdb', file: '/data/a.duckdb' };
  const invalid = rejectsWith('invalid_request');
  assert.throws(() => duckdbInvocation(options, ' ', []), invalid);
  assert.throws(() => duckdbInvocation(options, 'SELECT 1\0', []), invalid);
  assert.throws(() => duckdbInvocation(options, "SELECT '\udc00'", []), invalid);
  assert.throws(() => duckdbInvocation(options, `SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, []), invalid);
  assert.throws(() => duckdbInvocation(options, 'SELECT 1', 'x' as unknown as QueryParam[]), invalid);
  assert.throws(() => duckdbInvocation(options, 'SELECT 1', new Array<QueryParam>(MAX_PARAMS + 1).fill(1)), invalid);
  assert.throws(() => duckdbInvocation(options, 'SELECT ?', ['x'.repeat(30_000)]), rejectsWith('invalid_request', /parameters are larger/));
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

  test('a request with parameters and a second statement changes nothing', async () => {
    await assert.rejects(adapter.query('SELECT $1 AS a, $2 AS b; CREATE TABLE leaked(a INTEGER)', ['only one']), rejectsWith('invalid_request', /single statement/));
    assert.deepEqual((await adapter.query("SELECT count(*) AS c FROM duckdb_tables() WHERE table_name = 'leaked'", [])).results[0]?.rows, [{ c: 0 }]);
  });

  test('a CRLF inside a string literal is stored as sent', async () => {
    const { results } = await adapter.query("SELECT hex('a\r\nb') AS crlf, hex('a\rb') AS cr,\r\n hex($1::VARCHAR) AS param", ['x\r\ny']);
    assert.deepEqual(results[0]?.rows, [{ crlf: '610D0A62', cr: '610D62', param: '780D0A79' }]);
  });

  test('EXPLAIN returns the plan as text', async () => {
    const { results } = await adapter.query('EXPLAIN SELECT count(*) FROM t', []);
    assert.deepEqual(results[0]?.columns, ['plan']);
    assert.equal(results[0]?.rowCount, 1);
    assert.match(String(results[0]?.rows[0]?.plan), /Scan/);
    // DuckDB reads a no-break space as a space, so this is an EXPLAIN too.
    const spaced = await adapter.query('EXPLAIN\u00a0SELECT count(*) FROM t', []);
    assert.deepEqual(spaced.results[0]?.columns, ['plan']);
    const json = await adapter.query('EXPLAIN (FORMAT JSON) SELECT count(*) FROM t', []);
    assert.equal(Array.isArray(JSON.parse(String(json.results[0]?.rows[0]?.plan))), true);
  });

  test('the SQL and the parameters are not visible in the process list', { skip: process.platform !== 'linux' }, async () => {
    const endless = adapter.query("SELECT 'sql-secret', $1, count(*) FROM range(100000000000) a, range(1000) b", ['param-secret'], { timeoutMs: 1_500 });
    const outcome = assert.rejects(endless, rejectsWith('timeout'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const commandLines = readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map((pid) => {
        try {
          return readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        } catch {
          return ''; // the process ended meanwhile
        }
      });
    const shells = commandLines.filter((line) => line.includes(path.join(dir, 'a.duckdb')));
    await outcome;
    assert.ok(shells.length >= 1, 'the running shell was found');
    for (const line of commandLines) assert.doesNotMatch(line, /sql-secret|param-secret|706172616d2d736563726574/);
  });

  test('closing the adapter stops the queries still running, so no engine process outlives it', async () => {
    const closing = createDuckdbAdapter({ binary: duckdb.binary, file: path.join(dir, 'closing.duckdb') });
    const outcome = assert.rejects(closing.query('SELECT count(*) FROM range(100000000000) a, range(1000) b', [], { timeoutMs: 60_000 }), rejectsWith('cancelled'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const begun = performance.now();
    await closing.close();
    await outcome;
    assert.ok(performance.now() - begun < 5_000);
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
      ` .shell touch ${outside}`,
      `-init ${outside}`,
    ];
    for (const sql of attempts) await assert.rejects(adapter.query(sql, []), rejectsWith('query_failed'), sql);
    for (const sql of [`.shell touch ${outside}`, `.open ${outside}.duckdb`, `SELECT 1;\n.shell touch ${outside}`]) {
      await assert.rejects(adapter.query(sql, []), rejectsWith('invalid_request'), sql);
    }
    for (const suffix of ['', '.duckdb', '.csv']) assert.equal(existsSync(outside + suffix), false);
  });

  test('reports the rows a request inserted, updated or deleted', async () => {
    assert.equal((await adapter.query('CREATE TABLE changes_probe (a int)', [])).changes, 0);
    assert.equal((await adapter.query('INSERT INTO changes_probe VALUES (?), (?), (?)', [1, 2, 3])).changes, 3);
    const both = await adapter.query('UPDATE changes_probe SET a = a + 10 WHERE a > 1; DELETE FROM changes_probe WHERE a = 1; SELECT count(*)::int AS c FROM changes_probe', []);
    assert.equal(both.changes, 3);
    assert.deepEqual(both.results, [{ columns: ['c'], rows: [{ c: 2 }], rowCount: 1 }]);
    assert.equal((await adapter.query('SELECT 1 AS x', [])).changes, 0);
    assert.equal((await adapter.query('INSERT INTO changes_probe VALUES (7), (8) RETURNING a', [])).changes, 2);
    assert.equal((await adapter.query('INSERT INTO changes_probe VALUES (?) RETURNING a', [9])).changes, 1);
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

test('isReturningWrite finds a single write with RETURNING', () => {
  assert.equal(isReturningWrite('INSERT INTO t VALUES (1) RETURNING a;'), true);
  assert.equal(isReturningWrite('delete from t returning *'), true);
  assert.equal(isReturningWrite("SELECT 'returning' AS returning"), false);
  assert.equal(isReturningWrite('UPDATE t SET a = 1 -- returning'), false);
  assert.equal(isReturningWrite('INSERT INTO t VALUES (1) RETURNING a; SELECT 1'), false);
});
