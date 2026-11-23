import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { MAX_PARAMS, MAX_SQL_BYTES, createSqliteAdapter, encodeSqliteLiteral, sqliteArguments, sqliteErrorMessage } from '../../src/engines/sqlite.ts';
import { EngineError, type QueryParam, type SqlAdapter } from '../../src/engines/types.ts';
import { builtEngine } from './helpers.ts';

const rejectsWith = (code: string, message?: RegExp) => (error: unknown) =>
  error instanceof EngineError && error.code === code && (message === undefined || message.test(error.message));

test('parameters are encoded so that no character of a value is read as SQL', () => {
  assert.equal(encodeSqliteLiteral(null, 1), 'NULL');
  assert.equal(encodeSqliteLiteral(true, 1), '1');
  assert.equal(encodeSqliteLiteral(false, 1), '0');
  assert.equal(encodeSqliteLiteral(42, 1), '42');
  assert.equal(encodeSqliteLiteral(-1.5, 1), '-1.5');
  assert.equal(encodeSqliteLiteral(-0, 1), '0');
  assert.equal(encodeSqliteLiteral(1e21, 1), '1e+21');
  assert.equal(encodeSqliteLiteral('', 1), "''");
  assert.equal(encodeSqliteLiteral("a'b", 1), "CAST(x'612762' AS TEXT)");
  assert.equal(encodeSqliteLiteral({ $base64: 'AP8=' }, 1), "x'00ff'");
  assert.equal(encodeSqliteLiteral({ $base64: '' }, 1), "x''");
  for (const text of ["'); DROP TABLE t;--", 'line\n.shell id', '\u0000', 'あ🙂']) {
    assert.match(encodeSqliteLiteral(text, 1), /^CAST\(x'[0-9a-f]+' AS TEXT\)$/);
  }
});

test('invalid parameters are rejected', () => {
  const bad: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, '\ud800', { $base64: 'not base64!' }, { $base64: 'AP8' }, { $base64: 'AP8=', extra: 1 }, { other: 1 }, [1], undefined, 10n];
  for (const param of bad) {
    assert.throws(() => encodeSqliteLiteral(param as QueryParam, 3), rejectsWith('invalid_request', /parameter 3/), String(param));
  }
});

test('the shell runs in safe mode and the SQL can never be an option, a dot-command or a script file', () => {
  const options = { binary: '/x/sqlite3', file: '/data/app.sqlite' };
  assert.deepEqual(sqliteArguments(options, 'SELECT 1', []), ['-safe', '-batch', '-noinit', '-json', '/data/app.sqlite', '.timeout 5000', '.explain off', ' SELECT 1']);
  assert.deepEqual(sqliteArguments({ ...options, readOnly: true }, '.shell id', []).slice(0, 5), ['-safe', '-batch', '-noinit', '-json', '-readonly']);
  for (const sql of ['.shell id', '-version', '--help', '/etc/hosts.txt', 'script.sql']) {
    assert.equal(sqliteArguments(options, sql, []).at(-1), ` ${sql}`);
  }
  assert.deepEqual(sqliteArguments(options, 'SELECT ?1, ?2', ['a', 2]).slice(-3), [
    '.parameter init',
    "INSERT INTO temp.sqlite_parameters(key,value) VALUES('?1',CAST(x'61' AS TEXT)),('?2',2)",
    ' SELECT ?1, ?2',
  ]);
  assert.equal(sqliteArguments({ binary: '/x/sqlite3', file: 'relative.sqlite' }, 'SELECT 1', [])[4], path.resolve('relative.sqlite'));
});

test('oversized or malformed requests are rejected before the engine starts', () => {
  const options = { binary: '/x/sqlite3', file: '/data/app.sqlite' };
  const invalid = rejectsWith('invalid_request');
  assert.throws(() => sqliteArguments(options, '', []), invalid);
  assert.throws(() => sqliteArguments(options, '  \n', []), invalid);
  assert.throws(() => sqliteArguments(options, 'SELECT 1\0', []), invalid);
  assert.throws(() => sqliteArguments(options, 123 as unknown as string, []), invalid);
  assert.throws(() => sqliteArguments(options, `SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, []), invalid);
  assert.throws(() => sqliteArguments(options, 'SELECT 1', {} as unknown as QueryParam[]), invalid);
  assert.throws(() => sqliteArguments(options, 'SELECT 1', new Array<QueryParam>(MAX_PARAMS + 1).fill(1)), invalid);
  assert.throws(() => sqliteArguments(options, 'SELECT ?1', ['x'.repeat(60_000)]), rejectsWith('invalid_request', /parameters are larger/));
});

test('error output is reduced to the engine message', () => {
  assert.equal(sqliteErrorMessage('Parse error in 7th command line argument: no such column: nope\n   SELECT nope\n          ^--- error here\n'), 'no such column: nope\n   SELECT nope\n          ^--- error here');
  assert.equal(sqliteErrorMessage('Error in 8th command line argument: attempt to write a readonly database\n'), 'attempt to write a readonly database');
  assert.equal(sqliteErrorMessage('Runtime error in 21st command line argument: UNIQUE constraint failed: t.id (19)\n'), 'UNIQUE constraint failed: t.id (19)');
  assert.equal(sqliteErrorMessage('<cmdline>:0: cannot run ATTACH in safe mode\n'), 'cannot run ATTACH in safe mode');
  assert.equal(sqliteErrorMessage('  \n'), 'the query failed');
});

const sqlite = builtEngine('sqlite', 'sqlite3');

describe('SQLite adapter against the built engine', { skip: sqlite.skip }, () => {
  let dir: string;
  let adapter: SqlAdapter;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-sqlite-test-'));
    adapter = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, 'app.sqlite') });
    await adapter.query('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, data BLOB, n REAL)', []);
  });
  after(async () => {
    await adapter.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('writes and reads back every parameter type', async () => {
    const hostile = "Robert'); DROP TABLE t;--\n.shell id";
    const inserted = await adapter.query('INSERT INTO t(name, data, n) VALUES (?1, ?2, ?3), (?4, ?5, ?6) RETURNING id', [hostile, { $base64: 'AP8=' }, 1.5, 'あ🙂', null, true]);
    assert.deepEqual(inserted.results, [{ columns: ['id'], rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }]);
    const read = await adapter.query('SELECT id, name, hex(data) AS data, n FROM t ORDER BY id; SELECT count(*) AS c FROM t', []);
    assert.deepEqual(read.results, [
      {
        columns: ['id', 'name', 'data', 'n'],
        rows: [
          { id: 1, name: hostile, data: '00FF', n: 1.5 },
          { id: 2, name: 'あ🙂', data: '', n: 1 },
        ],
        rowCount: 2,
      },
      { columns: ['c'], rows: [{ c: 2 }], rowCount: 1 },
    ]);
    assert.ok(read.durationMs >= 0);
  });

  test('64-bit integers come back exact', async () => {
    const { results } = await adapter.query('-- leading comment\nSELECT 9223372036854775807 AS big, ?1 AS small', [7]);
    assert.deepEqual(results[0]?.rows, [{ big: '9223372036854775807', small: 7 }]);
  });

  test('a statement without rows yields no result set', async () => {
    assert.deepEqual((await adapter.query('SELECT * FROM t WHERE 0', [])).results, []);
    // EXPLAIN output is rows like any other result, not the shell's formatted text.
    const plan = await adapter.query('EXPLAIN QUERY PLAN SELECT * FROM t WHERE id = ?1', [1]);
    assert.match(String(plan.results[0]?.rows[0]?.detail), /SEARCH t USING INTEGER PRIMARY KEY/);
    assert.equal((await adapter.query('EXPLAIN SELECT 1', [])).results[0]?.columns[1], 'opcode');
  });

  test('SQL errors are reported with the engine message', async () => {
    await assert.rejects(adapter.query('SELECT nope FROM t', []), rejectsWith('query_failed', /^no such column: nope/));
    await assert.rejects(adapter.query('INSERT INTO t(id) VALUES (1)', []), rejectsWith('query_failed', /UNIQUE constraint failed/));
  });

  test('a failed statement rolls back the transaction it is in', async () => {
    await assert.rejects(adapter.query("BEGIN; INSERT INTO t(name) VALUES ('tx'); SELECT nope; COMMIT;", []), rejectsWith('query_failed'));
    assert.deepEqual((await adapter.query("SELECT count(*) AS c FROM t WHERE name = 'tx'", [])).results[0]?.rows, [{ c: 0 }]);
  });

  test('a query cannot reach other files or run programs', async () => {
    const outside = path.join(dir, 'outside.sqlite');
    const script = path.join(dir, 'script.sql');
    const marker = path.join(dir, 'marker');
    await writeFile(script, `ATTACH '${outside}' AS o; CREATE TABLE o.x(a);\n`);
    const attempts = [
      `ATTACH '${outside}' AS o`,
      `VACUUM INTO '${outside}'`,
      `SELECT writefile('${marker}', 'x')`,
      "SELECT readfile('/etc/hostname')",
      "SELECT load_extension('/tmp/x')",
      `.shell touch ${marker}`,
      `SELECT 1;\n.shell touch ${marker}`,
      `.open ${outside}`,
      `.read ${script}`,
      script,
      `-init ${script}`,
    ];
    for (const sql of attempts) {
      await assert.rejects(adapter.query(sql, []), rejectsWith('query_failed'), sql);
    }
    assert.equal(existsSync(outside), false);
    assert.equal(existsSync(marker), false);
  });

  test('a read-only database refuses writes', async () => {
    const readOnly = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, 'app.sqlite'), readOnly: true });
    try {
      assert.deepEqual((await readOnly.query('SELECT count(*) AS c FROM t', [])).results[0]?.rows, [{ c: 2 }]);
      await assert.rejects(readOnly.query('DELETE FROM t', []), rejectsWith('query_failed', /readonly/));
    } finally {
      await readOnly.close();
    }
  });

  test('a runaway query is stopped at the time limit', async () => {
    const endless = 'WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r) SELECT count(*) FROM r';
    await assert.rejects(adapter.query(endless, [], { timeoutMs: 300 }), rejectsWith('timeout'));
    await assert.rejects(adapter.query('SELECT 1', [], { timeoutMs: 0 }), rejectsWith('invalid_request'));
  });

  test('concurrent writers wait for each other instead of failing', async () => {
    const writes = Array.from({ length: 8 }, (_, index) => adapter.query('INSERT INTO t(name) VALUES (?1)', [`writer-${index}`]));
    await Promise.all(writes);
    assert.deepEqual((await adapter.query("SELECT count(*) AS c FROM t WHERE name LIKE 'writer-%'", [])).results[0]?.rows, [{ c: 8 }]);
  });

  test('a closed adapter refuses queries', async () => {
    const closing = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, 'other.sqlite') });
    await closing.query('SELECT 1', []);
    await closing.close();
    await assert.rejects(closing.query('SELECT 1', []), rejectsWith('engine_unavailable'));
  });
});
