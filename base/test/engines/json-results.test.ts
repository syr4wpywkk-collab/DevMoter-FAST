import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseResultSets, quoteNonFinite, splitJsonValues } from '../../src/engines/json-results.ts';

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

test('columns keep the order the engine wrote them, also when a name looks like a number', () => {
  const [set] = parseResultSets('[{"2024":1,"2023":2,"b":{"x":[1,{"y":2}],"z":"q"},"a\\"\\\\":"},{","10":null},\n{"2024":3,"2023":4,"b":null,"a\\"\\\\":"","10":1}]');
  assert.deepEqual(set?.columns, ['2024', '2023', 'b', 'a"\\', '10']);
  assert.equal(set?.rows[0]?.['2023'], 2);
  assert.deepEqual(parseResultSets('[]')[0]?.columns, []);
});

test('non-finite numbers are quoted only outside strings', () => {
  assert.equal(quoteNonFinite('[{"a":Infinity,"b":-Infinity,"c":NaN,"d":"NaN, Infinity \\"NaN\\"","NaN":1}]'), '[{"a":"Infinity","b":"-Infinity","c":"NaN","d":"NaN, Infinity \\"NaN\\"","NaN":1}]');
  assert.deepEqual(parseResultSets('[{"a":Infinity,"b":"x"}]', { nonFinite: true })[0]?.rows, [{ a: 'Infinity', b: 'x' }]);
  assert.throws(() => parseResultSets('[{"a":Infinity}]'), SyntaxError);
});

test('a large result with non-finite numbers is converted without copying it character by character', () => {
  const row = '{"id":123456,"name":"some \\"text\\" NaN","v":1.5,"w":NaN},';
  const source = `[${row.repeat(100_000)}{"z":-Infinity}]`;
  const started = performance.now();
  const out = quoteNonFinite(source);
  assert.ok(performance.now() - started < 2_000);
  assert.equal(out.length, source.length + 2 * 100_001);
  assert.equal(out.endsWith('"w":"NaN"},{"z":"-Infinity"}]'), true);
  assert.equal(quoteNonFinite('[{"a":"NaN"}]'), '[{"a":"NaN"}]');
});

test('numbers a double cannot hold are returned as written, at any depth', () => {
  const rows = (text: string) => parseResultSets(text, { nonFinite: true })[0]?.rows;
  // DuckDB prints a DECIMAL inside a list or struct as a bare number.
  assert.deepEqual(rows('[{"l":[1.234567890123456789012345678],"s":{"a":12345678901234567.891},"u":[18446744073709551615]}]'), [
    { l: ['1.234567890123456789012345678'], s: { a: '12345678901234567.891' }, u: ['18446744073709551615'] },
  ]);
  assert.deepEqual(rows('[{"a":0.12345678901234567,"b":12345678901234567890.0}]'), [{ a: '0.12345678901234567', b: '12345678901234567890.0' }]);
  // Also when the nearest double is a whole number.
  assert.deepEqual(rows('[{"l":[0.999999999999999999,12345678901234.99999999,-2.0000000000000000001,1.0,2.50,1e3,3.000000000000000000]}]'), [
    { l: ['0.999999999999999999', '12345678901234.99999999', '-2.0000000000000000001', 1, 2.5, 1000, 3] },
  ]);
  // Doubles stay numbers however the engine writes them: shortest form, 17 digits, exponents, exact long expansions.
  assert.deepEqual(rows('[{"v":[0.1,0.30000000000000004,1.0e+300,1e-7,5e-324,1.7976931348623157e308,0.5000000000000000000,0.1000000000000000055511151231257827,-0.0,0.000,1.5]}]'), [
    { v: [0.1, 0.30000000000000004, 1e300, 1e-7, 5e-324, 1.7976931348623157e308, 0.5, 0.1, -0, 0, 1.5] },
  ]);
});

test('values too large for a double are "Infinity" and "-Infinity", not null', () => {
  // SQLite prints infinity as 9.0e+999.
  const [set] = parseResultSets('[{"a":9.0e+999,"b":-9.0e+999,"c":[1e400]}]');
  assert.deepEqual(set?.rows, [{ a: 'Infinity', b: '-Infinity', c: ['Infinity'] }]);
  assert.equal(JSON.stringify(set?.rows), '[{"a":"Infinity","b":"-Infinity","c":["Infinity"]}]');
});
