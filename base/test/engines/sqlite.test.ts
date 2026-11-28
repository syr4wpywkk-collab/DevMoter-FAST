import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { MAX_PARAMS, MAX_SQL_BYTES, checkSqliteParameters, createSqliteAdapter, encodeSqliteLiteral, sqliteErrorMessage, sqliteInvocation } from '../../src/engines/sqlite.ts';
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
  assert.equal(encodeSqliteLiteral("a'b", 1), 'char(97,39,98)');
  assert.equal(encodeSqliteLiteral({ $base64: 'AP8=' }, 1), "x'00ff'");
  assert.equal(encodeSqliteLiteral({ $base64: '' }, 1), "x''");
  for (const text of ["'); DROP TABLE t;--", 'line\n.shell id', '\u0000', 'あ🙂']) {
    assert.match(encodeSqliteLiteral(text, 1), /^char\(\d+(?:,\d+)*\)$/);
  }
});

test('invalid parameters are rejected', () => {
  const bad: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, '\ud800', { $base64: 'not base64!' }, { $base64: 'AP8' }, { $base64: 'AP8=', extra: 1 }, { other: 1 }, [1], undefined, 10n];
  for (const param of bad) {
    assert.throws(() => encodeSqliteLiteral(param as QueryParam, 3), rejectsWith('invalid_request', /parameter 3/), String(param));
  }
});

test('the shell runs in safe mode and nothing of the request is a program argument', () => {
  const options = { binary: '/x/sqlite3', file: '/data/app.sqlite' };
  assert.deepEqual(sqliteInvocation(options, 'SELECT 1', []), {
    args: ['-safe', '-batch', '-noinit', '-bail', '-json', '/data/app.sqlite'],
    input: '.timeout 5000\n.explain off\nSELECT 1\n',
  });
  assert.deepEqual(sqliteInvocation({ ...options, readOnly: true }, 'SELECT 1', []).args, ['-safe', '-batch', '-noinit', '-bail', '-json', '-readonly', '/data/app.sqlite']);
  const secret = sqliteInvocation(options, "SELECT 'sql-secret', ?1, ?2", ['a', 2]);
  assert.deepEqual(secret.args, ['-safe', '-batch', '-noinit', '-bail', '-json', '/data/app.sqlite']);
  assert.equal(
    secret.input,
    ".timeout 5000\n.explain off\n.parameter init\nINSERT INTO temp.sqlite_parameters(key,value) VALUES('?1',char(97)),('?2',2);\nSELECT 'sql-secret', ?1, ?2\n",
  );
  assert.equal(sqliteInvocation({ binary: '/x/sqlite3', file: 'relative.sqlite' }, 'SELECT 1', []).args.at(-1), path.resolve('relative.sqlite'));
});

test('the SQL can never be a dot-command of the shell', () => {
  const options = { binary: '/x/sqlite3', file: '/data/app.sqlite' };
  for (const sql of ['.shell id', 'SELECT 1;\n.output /tmp/x', 'SELECT 1;\r\n.mode csv', "SELECT '\n.text'"]) {
    assert.throws(() => sqliteInvocation(options, sql, []), rejectsWith('invalid_request', /must not start with "\."/), sql);
  }
  // Only the first character of a line makes a dot-command; these are plain SQL (and parameters are one line of hex).
  for (const sql of ['SELECT 1;\n .5 + 1', 'SELECT t\n  .id FROM t', 'SELECT 1.5', '-version', '--help']) {
    assert.equal(sqliteInvocation(options, sql, []).input.endsWith(`\n${sql}\n`), true, sql);
  }
  assert.doesNotMatch(sqliteInvocation(options, 'SELECT ?1', ['a\n.shell id']).input, /^\.shell/m);
});

test('oversized or malformed requests are rejected before the engine starts', () => {
  const options = { binary: '/x/sqlite3', file: '/data/app.sqlite' };
  const invalid = rejectsWith('invalid_request');
  assert.throws(() => sqliteInvocation(options, '', []), invalid);
  assert.throws(() => sqliteInvocation(options, '  \n', []), invalid);
  assert.throws(() => sqliteInvocation(options, 'SELECT 1\0', []), invalid);
  assert.throws(() => sqliteInvocation(options, "SELECT '\ud800'", []), rejectsWith('invalid_request', /not valid Unicode/));
  assert.throws(() => sqliteInvocation(options, 123 as unknown as string, []), invalid);
  assert.throws(() => sqliteInvocation(options, `SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, []), invalid);
  assert.throws(() => sqliteInvocation(options, 'SELECT 1', {} as unknown as QueryParam[]), invalid);
  assert.throws(() => sqliteInvocation(options, 'SELECT 1', new Array<QueryParam>(MAX_PARAMS + 1).fill(1)), invalid);
  assert.throws(() => sqliteInvocation(options, 'SELECT ?1', ['x'.repeat(70_000)]), rejectsWith('invalid_request', /parameters are larger/));
});

test('error output is reduced to the engine message', () => {
  assert.equal(sqliteErrorMessage('Parse error near line 3: no such column: nope\n  SELECT nope\n         ^--- error here\n'), 'no such column: nope\n  SELECT nope\n         ^--- error here');
  assert.equal(sqliteErrorMessage('Error near line 3: attempt to write a readonly database\n'), 'attempt to write a readonly database');
  assert.equal(sqliteErrorMessage('Runtime error near line 5: UNIQUE constraint failed: t.id (19)\n'), 'UNIQUE constraint failed: t.id (19)');
  assert.equal(sqliteErrorMessage('line 3: cannot run ATTACH in safe mode\n'), 'cannot run ATTACH in safe mode');
  assert.equal(sqliteErrorMessage('  \n'), 'the query failed');
});

const sqlite = builtEngine('sqlite', 'sqlite3');

test('a string parameter is written as code points, the same for every text encoding of a database', () => {
  assert.equal(encodeSqliteLiteral('hé🙂', 1), 'char(104,233,128578)');
  assert.equal(encodeSqliteLiteral('', 1), "''");
  // Long text is split over several calls, each within SQLite's limit on function arguments, joined in groups.
  const long = encodeSqliteLiteral('ab'.repeat(125), 1);
  assert.match(long, /^\(char\((?:\d+,){99}\d+\)\|\|char\((?:\d+,){99}\d+\)\|\|char\((?:\d+,){49}\d+\)\)$/);
  const longer = encodeSqliteLiteral('a'.repeat(3300), 1);
  assert.equal(longer.split('||').length, 33);
  assert.match(longer, /^\((?:char\([\d,]+\)(?:\|\|)?){32}\)\|\|char\([\d,]+\)$/);
});

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

  test('a CRLF inside a string literal is stored as sent', async () => {
    const { results } = await adapter.query("SELECT hex('a\r\nb') AS crlf, hex('a\rb') AS cr, hex('a\nb') AS lf,\r\n hex(?1) AS param", ['x\r\ny']);
    assert.deepEqual(results[0]?.rows, [{ crlf: '610D0A62', cr: '610D62', lf: '610A62', param: '780D0A79' }]);
  });

  test('the longest string parameter that fits is within the expression depth SQLite allows', async () => {
    // Tabs encode shortest ("9,"), so they make the most char() calls for the size limit.
    const text = '\t'.repeat(125_000) + '\u0000\n.shell id\n' + "'";
    const { results } = await adapter.query('SELECT ?1 = ?2 AS same, length(CAST(?1 AS BLOB)) AS n', [text, 'x']);
    assert.deepEqual(results[0]?.rows, [{ same: 0, n: text.length }]);
    await assert.rejects(adapter.query('SELECT ?1', ['\t'.repeat(132_000)]), rejectsWith('invalid_request', /parameters are larger/));
  });

  test('ASCII text that fitted the limit as hex still fits as code points', async () => {
    const text = 'z'.repeat(49_000);
    const { results } = await adapter.query('SELECT length(?1) AS n, substr(?1, 48999) AS tail', [text]);
    assert.deepEqual(results[0]?.rows, [{ n: 49_000, tail: 'zz' }]);
  });

  test('string parameters keep their text in a UTF-16 database, also one in WAL mode', async () => {
    for (const [encoding, journal] of [['UTF-16le', 'DELETE'], ['UTF-16be', 'DELETE'], ['UTF-16le', 'WAL']]) {
      const wide = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, `${encoding}-${journal}.sqlite`) });
      try {
        await wide.query(`PRAGMA encoding = '${encoding}'; PRAGMA journal_mode = ${journal}; CREATE TABLE w(s TEXT)`, []);
        const text = 'hé🙂'.repeat(120);
        const { results } = await wide.query('INSERT INTO w VALUES (?1), (?2); SELECT s, length(s) AS n FROM w ORDER BY rowid', [text, 'abc']);
        assert.deepEqual(results[0]?.rows, [{ s: text, n: 360 }, { s: 'abc', n: 3 }], `${encoding} ${journal}`);
        const { results: found } = await wide.query('SELECT count(*) AS c FROM w WHERE s = ?1', [text]);
        assert.deepEqual(found[0]?.rows, [{ c: 1 }], `${encoding} ${journal}`);
      } finally {
        await wide.close();
      }
    }
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
      ` .shell touch ${marker}`,
      `SELECT 1;\n\t.shell touch ${marker}`,
      script,
      `-init ${script}`,
    ];
    for (const sql of attempts) {
      await assert.rejects(adapter.query(sql, []), rejectsWith('query_failed'), sql);
    }
    for (const sql of [`.shell touch ${marker}`, `SELECT 1;\n.shell touch ${marker}`, `.open ${outside}`, `.read ${script}`, `/* c */\n.shell touch ${marker}`]) {
      await assert.rejects(adapter.query(sql, []), rejectsWith('invalid_request'), sql);
    }
    assert.equal(existsSync(outside), false);
    assert.equal(existsSync(marker), false);
  });

  test('the SQL and the parameters are not visible in the process list', { skip: process.platform !== 'linux' }, async () => {
    const endless = adapter.query("WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r) SELECT 'sql-secret', ?1, count(*) FROM r", ['param-secret'], { timeoutMs: 1_000 });
    const outcome = assert.rejects(endless, rejectsWith('timeout'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const commandLines = readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map((pid) => {
        try {
          return readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        } catch {
          return ''; // the process ended meanwhile
        }
      });
    const shells = commandLines.filter((line) => line.includes(path.join(dir, 'app.sqlite')));
    await outcome;
    assert.ok(shells.length >= 1, 'the running shell was found');
    for (const line of commandLines) assert.doesNotMatch(line, /sql-secret|param-secret|706172616d2d736563726574/);
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

  test('closing the adapter stops the queries still running, so no engine process outlives it', async () => {
    const closing = createSqliteAdapter({ binary: sqlite.binary, file: path.join(dir, 'closing.sqlite') });
    const endless = closing.query('WITH RECURSIVE r(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM r) SELECT count(*) FROM r', [], { timeoutMs: 60_000 });
    const outcome = assert.rejects(endless, rejectsWith('cancelled'));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const begun = performance.now();
    await closing.close();
    await outcome;
    assert.ok(performance.now() - begun < 5_000);
  });
});

test('refuses placeholders that have no parameter, and named ones', () => {
  for (const [sql, count] of [
    ['SELECT ?1, ?2', 2],
    ['SELECT ?, ?', 2],
    ['SELECT ?2, ?', 3],
    ['SELECT ?1; SELECT ?1', 1],
    ["SELECT ':name', '?3', \"@x\", $$ $$ -- ?9\n", 0],
    ['SELECT 1 /* :x */', 0],
    ['SELECT ?1', 2],
    ['SELECT [?], [:name] FROM t', 0],
    ['SELECT `?`, `:a``?` FROM t', 0],
  ] as const) {
    assert.doesNotThrow(() => checkSqliteParameters(sql, count), sql);
  }
  const unbound = rejectsWith('invalid_request', /uses parameter \?/);
  assert.throws(() => checkSqliteParameters('SELECT ?', 0), unbound);
  assert.throws(() => checkSqliteParameters('SELECT ?1, ?2', 1), rejectsWith('invalid_request', /uses parameter \?2 but 1 parameter was given/));
  assert.throws(() => checkSqliteParameters('SELECT ?2, ?', 2), rejectsWith('invalid_request', /uses parameter \?3/));
  assert.throws(() => checkSqliteParameters('SELECT ?12', 2), rejectsWith('invalid_request', /uses parameter \?12/));
  assert.throws(() => checkSqliteParameters('SELECT [a], ?', 0), unbound);
  assert.throws(() => checkSqliteParameters('SELECT $foo$, ?2', 2), rejectsWith('invalid_request', /named parameters such as \$foo/));
  for (const sql of ['SELECT :name', 'SELECT @x', 'SELECT $v', 'UPDATE t SET a = 1 WHERE id = :id']) {
    assert.throws(() => checkSqliteParameters(sql, 1), rejectsWith('invalid_request', /named parameters/), sql);
  }
  assert.throws(() => sqliteInvocation({ binary: '/x/sqlite3', file: '/data/app.sqlite' }, 'SELECT :name AS n', ['a']), rejectsWith('invalid_request', /named parameters such as :name/));
});
