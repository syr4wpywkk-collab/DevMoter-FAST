import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseResultSets, splitJsonValues } from '../../src/engines/json-results.ts';

test('splits back-to-back JSON arrays, ignoring brackets inside strings', () => {
  assert.deepEqual(splitJsonValues('[{"a":1}]\n[{"b":"]\\"[{"}]\n'), ['[{"a":1}]', '[{"b":"]\\"[{"}]']);
  assert.deepEqual(splitJsonValues(''), []);
  assert.deepEqual(splitJsonValues('  \n'), []);
});

test('rejects truncated or stray output', () => {
  for (const text of ['[{"a":1}', '[{"a":"x}]', 'oops', '[1]]', '"text"']) {
    assert.throws(() => splitJsonValues(text), SyntaxError, text);
  }
});

test('parses one result set per statement with its columns', () => {
  assert.deepEqual(parseResultSets('[{"id":1,"name":"a"},\n{"id":2,"name":null}]\n[{"c":2}]'), [
    { columns: ['id', 'name'], rows: [{ id: 1, name: 'a' }, { id: 2, name: null }], rowCount: 2 },
    { columns: ['c'], rows: [{ c: 2 }], rowCount: 1 },
  ]);
  assert.deepEqual(parseResultSets('[]'), [{ columns: [], rows: [], rowCount: 0 }]);
});

test('keeps integers beyond 2^53 exact by returning them as strings', () => {
  const [set] = parseResultSets('[{"big":9007199254740993,"neg":-9223372036854775808,"safe":9007199254740991,"real":1.5e300,"nested":[18446744073709551615]}]');
  assert.deepEqual(set?.rows[0], { big: '9007199254740993', neg: '-9223372036854775808', safe: 9007199254740991, real: 1.5e300, nested: ['18446744073709551615'] });
});

test('rejects output that is not rows', () => {
  assert.throws(() => parseResultSets('[1,2]'), SyntaxError);
  assert.throws(() => parseResultSets('{"a":1}'), SyntaxError);
});
