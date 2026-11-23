import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DUCKDB_SQL, sqlShape } from '../../src/engines/sql-text.ts';

test('counts statements and finds the first word', () => {
  const cases: [string, number, string][] = [
    ['SELECT 1', 1, 'SELECT'],
    ['  select 1;  ', 1, 'SELECT'],
    ['SELECT 1; SELECT 2', 2, 'SELECT'],
    ['SELECT 1;;\n ; -- only a comment\n /* and another */', 1, 'SELECT'],
    ['-- c\n/* c /* nested ; */ ; */ explain SELECT 1', 1, 'EXPLAIN'],
    ['', 0, ''],
    [' ; -- nothing', 0, ''],
    ['(SELECT 1)', 1, ''],
    ["'text' ; x", 2, ''],
  ];
  for (const [sql, statements, firstKeyword] of cases) assert.deepEqual(sqlShape(sql), { statements, firstKeyword }, sql);
});

test('characters an engine reads as blank space end a word only for that engine', () => {
  for (const blank of ['\u00a0', '\u2003', '\u200b', '\u3000', '\ufeff']) {
    assert.equal(sqlShape(`EXPLAIN${blank}SELECT 1`, DUCKDB_SQL).firstKeyword, 'EXPLAIN');
    assert.equal(sqlShape(`${blank}EXPLAIN SELECT 1`, DUCKDB_SQL).firstKeyword, 'EXPLAIN');
    assert.deepEqual(sqlShape(`${blank};${blank}`, DUCKDB_SQL), { statements: 0, firstKeyword: '' });
    assert.equal(sqlShape(`EXPLAIN${blank}SELECT 1`).firstKeyword, `EXPLAIN${blank}SELECT`);
  }
  // Not blank space to DuckDB: part of the word.
  assert.equal(sqlShape('EXPLAIN\u1680SELECT 1', DUCKDB_SQL).firstKeyword, 'EXPLAIN\u1680SELECT');
  assert.equal(sqlShape('SÉLECT 1', DUCKDB_SQL).firstKeyword, 'SÉLECT');
});

test('a ";" inside quoted text or a comment does not end a statement', () => {
  for (const sql of [
    "SELECT 'a;b', 'it''s; fine'",
    'SELECT "a;b" FROM "t""; x"',
    'SELECT $$a;b$$, $tag$ c; $$ d $tag$',
    'SELECT 1 -- ; SELECT 2',
    'SELECT /* ; */ 1',
    "SELECT E'a\\';b'",
    "SELECT 'unterminated; text",
    'SELECT a$b$c; -- an identifier, not a dollar quote',
    'SELECT $1 + $2',
  ]) {
    assert.equal(sqlShape(sql).statements, 1, sql);
  }
  for (const sql of ["SELECT 'a\\'; SELECT 2", 'SELECT a$b$c; SELECT $b$ x', 'SELECT $1; SELECT $2', "SELECT '--'; SELECT 2", 'SELECT 1 /* */; SELECT 2']) {
    assert.equal(sqlShape(sql).statements, 2, sql);
  }
});

test('a long hostile text is read in linear time', () => {
  const started = performance.now();
  assert.equal(sqlShape(`${'/*'.repeat(30_000)}${'-- x\n'.repeat(10_000)}${"'".repeat(20_001)}`).statements, 0);
  assert.equal(sqlShape(`SELECT ${'$a'.repeat(30_000)}`).statements, 1);
  assert.ok(performance.now() - started < 1_000);
});
