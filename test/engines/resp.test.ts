import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RespDecoder, RespError, RespProtocolError, encodeCommand } from '../../src/engines/resp.ts';

const decode = (wire: string | Buffer) => new RespDecoder().push(typeof wire === 'string' ? Buffer.from(wire, 'utf8') : wire);

test('commands are encoded as length-prefixed bulk strings, so no argument can inject a command', () => {
  assert.equal(encodeCommand(['SET', 'k', 'a\r\nb']).toString(), '*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$4\r\na\r\nb\r\n');
  assert.equal(encodeCommand(['GET', 'あ']).toString(), '*2\r\n$3\r\nGET\r\n$3\r\nあ\r\n');
  assert.deepEqual(encodeCommand(['SET', 'k', Buffer.from([0, 255])]), Buffer.concat([Buffer.from('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\n'), Buffer.from([0, 255]), Buffer.from('\r\n')]));
});

test('every reply type maps to JSON', () => {
  assert.deepEqual(decode('+OK\r\n'), ['OK']);
  assert.deepEqual(decode(':42\r\n:-7\r\n'), [42, -7]);
  assert.deepEqual(decode(':9007199254740993\r\n'), ['9007199254740993']);
  assert.deepEqual(decode('(3492890328409238509324850943850943825024385\r\n'), ['3492890328409238509324850943850943825024385']);
  assert.deepEqual(decode('$5\r\nhello\r\n$0\r\n\r\n$-1\r\n_\r\n*-1\r\n'), ['hello', '', null, null, null]);
  assert.deepEqual(decode('$4\r\na\r\nb\r\n'), ['a\r\nb']);
  assert.deepEqual(decode(Buffer.concat([Buffer.from('$2\r\n'), Buffer.from([0, 255]), Buffer.from('\r\n')])), [{ $base64: 'AP8=' }]);
  assert.deepEqual(decode('=7\r\ntxt:abc\r\n'), ['abc']);
  assert.deepEqual(decode(',1.5\r\n,inf\r\n,-inf\r\n,nan\r\n,10\r\n'), [1.5, 'Infinity', '-Infinity', 'NaN', 10]);
  assert.deepEqual(decode('#t\r\n#f\r\n'), [true, false]);
  assert.deepEqual(decode('*3\r\n:1\r\n$1\r\na\r\n*1\r\n_\r\n'), [[1, 'a', [null]]]);
  assert.deepEqual(decode('*0\r\n~2\r\n+a\r\n+b\r\n>1\r\n+p\r\n'), [[], ['a', 'b'], ['p']]);
  assert.deepEqual(decode('%2\r\n+a\r\n:1\r\n+b\r\n%0\r\n'), [{ a: 1, b: {} }]);
  assert.deepEqual(decode('%1\r\n:1\r\n+one\r\n'), [[[1, 'one']]]);
  // A repeated key would lose a value as an object.
  assert.deepEqual(decode('%2\r\n+a\r\n:1\r\n+a\r\n:2\r\n'), [[['a', 1], ['a', 2]]]);
  assert.deepEqual(decode('|1\r\n+ttl\r\n:10\r\n+value\r\n'), ['value']);
});

test('error replies are values, at the top level and inside aggregates', () => {
  const [top, nested, bulk] = decode('-ERR unknown command\r\n*2\r\n:1\r\n-WRONGTYPE bad\r\n!9\r\nERR multi\r\n');
  assert.ok(top instanceof RespError);
  assert.equal(top.error, 'ERR unknown command');
  assert.equal(JSON.stringify(nested), '[1,{"error":"WRONGTYPE bad"}]');
  assert.ok(bulk instanceof RespError && bulk.error === 'ERR multi');
});

test('a map key named __proto__ is an ordinary key', () => {
  const [value] = decode('%1\r\n+__proto__\r\n+x\r\n');
  assert.equal(JSON.stringify(value), '{"__proto__":"x"}');
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test('replies split at any byte boundary decode the same', () => {
  const wire = Buffer.from('*3\r\n$6\r\nhe\r\nlo\r\n%1\r\n+k\r\n,1.5\r\n:12345\r\n+OK\r\n$3\r\nあ\r\n');
  const whole = decode(wire);
  assert.deepEqual(whole, [['he\r\nlo', { k: 1.5 }, 12345], 'OK', 'あ']);
  for (let size = 1; size < wire.length; size += 1) {
    const decoder = new RespDecoder();
    const replies = [];
    for (let offset = 0; offset < wire.length; offset += size) replies.push(...decoder.push(wire.subarray(offset, offset + size)));
    assert.deepEqual(replies, whole, `chunk size ${size}`);
  }
});

test('a large bulk string arriving in many chunks is decoded once it is complete', () => {
  const decoder = new RespDecoder();
  const payload = 'x'.repeat(5_000_000);
  const wire = Buffer.from(`$${payload.length}\r\n${payload}\r\n:1\r\n`);
  const replies = [];
  const started = performance.now();
  for (let offset = 0; offset < wire.length; offset += 4096) replies.push(...decoder.push(wire.subarray(offset, offset + 4096)));
  assert.equal(replies.length, 2);
  assert.equal((replies[0] as string).length, payload.length);
  assert.equal(replies[1], 1);
  assert.ok(performance.now() - started < 5_000, 'decoding must not rescan the buffer on every chunk');
});

test('malformed replies are rejected', () => {
  for (const wire of ['?what\r\n', ':12a\r\n', '$x\r\n', '*x\r\n', '#y\r\n', ',abc\r\n', '(1.5\r\n', '*1\r\n'.repeat(100)]) {
    assert.throws(() => decode(wire), RespProtocolError, JSON.stringify(wire.slice(0, 20)));
  }
});
