import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { EngineError, type CommandArg, type KeyValueAdapter } from '../../src/engines/types.ts';
import { MAX_ARGS, MAX_COMMAND_BYTES, createValkeyAdapter, encodeArguments, parseCommandInfo, refusal, takesBlockOption } from '../../src/engines/valkey.ts';
import { builtEngine, startValkey, type TestServer } from './helpers.ts';

const rejectsWith = (code: string, message?: RegExp) => (error: unknown) =>
  error instanceof EngineError && error.code === code && (message === undefined || message.test(error.message));

test('arguments are validated and converted', () => {
  assert.deepEqual(encodeArguments(['SET', 'k', 5, -0, { $base64: 'AP8=' }]), ['SET', 'k', '5', '0', Buffer.from([0, 255])]);
  const invalid = rejectsWith('invalid_request');
  assert.throws(() => encodeArguments(['SET', 'k', 2 ** 53]), rejectsWith('invalid_request', /argument 3 .* as a string/));
  assert.throws(() => encodeArguments(['SET', 'k', -1e21]), invalid);
  const bad: unknown[] = [[], 'GET k', [null], ['GET', null], ['GET', true], ['GET', Number.NaN], ['GET', '\ud800'], ['GET', { $base64: '!' }], ['GET', ['k']], [5], [{ $base64: 'R0VU' }], ['GET k'], ['']];
  for (const args of bad) assert.throws(() => encodeArguments(args as CommandArg[]), invalid, JSON.stringify(args));
  assert.throws(() => encodeArguments(new Array<CommandArg>(MAX_ARGS + 1).fill('x')), invalid);
  assert.throws(() => encodeArguments(['SET', 'k', 'x'.repeat(MAX_COMMAND_BYTES)]), rejectsWith('invalid_request', /larger than/));
});

test('what may run is decided from the flags and categories the server reports', () => {
  const info = (flags: string[], categories: string[], subcommands: unknown[] = []) => parseCommandInfo(['x', 1, flags, 0, 0, 0, categories, [], [], subcommands] as never);
  const get = info(['readonly', 'fast'], ['@read', '@string', '@fast']);
  const set = info(['write', 'denyoom'], ['@write', '@string', '@slow']);
  const config = info([], ['@slow'], [
    ['config|get', -3, ['admin', 'noscript'], 0, 0, 0, ['@admin', '@slow', '@dangerous'], [], [], []],
    ['config|help', 2, ['loading'], 0, 0, 0, ['@slow'], [], [], []],
  ]);
  assert.equal(refusal('GET', 'k', get, false), undefined);
  assert.equal(refusal('GET', 'k', get, true), undefined);
  assert.equal(refusal('SET', 'k', set, false), undefined);
  assert.ok(rejectsWith('command_not_allowed', /read-only/)(refusal('SET', 'k', set, true)));
  assert.ok(rejectsWith('query_failed', /unknown command "NOPE"/)(refusal('NOPE', undefined, undefined, false)));
  assert.ok(rejectsWith('command_not_allowed', /"CONFIG GET" is not allowed: administrative/)(refusal('CONFIG', 'GET', config, false)));
  assert.equal(refusal('config', 'HELP', config, false), undefined);
  assert.ok(rejectsWith('query_failed', /unknown subcommand/)(refusal('CONFIG', 'NOPE', config, false)));
  assert.ok(rejectsWith('query_failed', /unknown subcommand/)(refusal('CONFIG', undefined, config, false)));
  for (const category of ['@admin', '@dangerous', '@scripting', '@pubsub', '@transaction', '@connection']) {
    assert.ok(rejectsWith('command_not_allowed')(refusal('X', undefined, info(['readonly'], ['@read', category]), false)), category);
  }
  assert.ok(rejectsWith('command_not_allowed')(refusal('X', undefined, info(['admin'], []), false)));
  assert.ok(rejectsWith('command_not_allowed')(refusal('X', undefined, info(['pubsub'], []), false)));
  assert.equal(refusal('PING', undefined, info(['fast'], ['@connection', '@fast']), true), undefined);
  assert.equal(parseCommandInfo(null), undefined);
});

const valkey = builtEngine('valkey', 'valkey-server');

describe('Valkey adapter against the built engine', { skip: valkey.skip }, () => {
  let server: TestServer;
  let adapter: KeyValueAdapter;
  const run = async (...args: CommandArg[]) => (await adapter.command(args)).result;

  before(async () => {
    server = await startValkey(valkey.binary);
    adapter = createValkeyAdapter({ socketPath: server.socket });
  });
  after(async () => {
    await adapter.close();
    await server.stop();
  });

  test('strings, numbers and binary values round-trip; a value cannot inject a command', async () => {
    const hostile = "v'\r\n*1\r\n$8\r\nFLUSHALL\r\n";
    assert.equal(await run('SET', 'k', hostile), 'OK');
    assert.equal(await run('GET', 'k'), hostile);
    assert.equal(await run('SET', 'bin', { $base64: 'AP8=' }), 'OK');
    assert.deepEqual(await run('GET', 'bin'), { $base64: 'AP8=' });
    assert.equal(await run('SET', 'あ', '🙂'), 'OK');
    assert.equal(await run('GET', 'あ'), '🙂');
    assert.equal(await run('INCRBY', 'n', 5), 5);
    assert.equal(await run('GET', 'missing'), null);
    assert.equal(await run('DBSIZE'), 4);
  });

  test('aggregate replies keep their shape', async () => {
    await run('HSET', 'h', 'a', '1', 'b', '2');
    assert.deepEqual(await run('HGETALL', 'h'), { a: '1', b: '2' });
    await run('RPUSH', 'l', 'x', 'y');
    assert.deepEqual(await run('LRANGE', 'l', 0, -1), ['x', 'y']);
    await run('ZADD', 'z', 1.5, 'm');
    assert.deepEqual(await run('ZRANGE', 'z', 0, -1, 'WITHSCORES'), [['m', 1.5]]);
    assert.equal(await run('ZSCORE', 'z', 'm'), 1.5);
    assert.equal(await run('OBJECT', 'ENCODING', 'n'), 'int');
  });

  test('engine errors are reported with the engine message', async () => {
    await assert.rejects(adapter.command(['GET']), rejectsWith('query_failed', /wrong number of arguments/));
    await assert.rejects(adapter.command(['GET', 'h']), rejectsWith('query_failed', /^WRONGTYPE/));
    await assert.rejects(adapter.command(['NOSUCHCOMMAND']), rejectsWith('query_failed', /unknown command/));
    await assert.rejects(adapter.command(['OBJECT', 'NOSUCH', 'k']), rejectsWith('query_failed', /unknown subcommand/));
  });

  test('administrative, dangerous, scripting, pub/sub, transaction and connection commands are refused', async () => {
    const refused: CommandArg[][] = [
      ['FLUSHALL'], ['FLUSHDB'], ['KEYS', '*'], ['CONFIG', 'GET', '*'], ['config', 'set', 'dir', '/tmp'], ['EVAL', 'return 1', 0], ['FUNCTION', 'LIST'], ['SCRIPT', 'FLUSH'],
      ['MULTI'], ['EXEC'], ['SELECT', 1], ['SUBSCRIBE', 'c'], ['PUBLISH', 'c', 'm'], ['SHUTDOWN', 'NOSAVE'], ['DEBUG', 'SLEEP', 0], ['CLIENT', 'LIST'], ['INFO'],
      ['MIGRATE', '127.0.0.1', 1, 'k', 0, 1], ['HELLO', 2], ['AUTH', 'x'], ['ACL', 'LIST'], ['MONITOR'], ['REPLICAOF', '127.0.0.1', 1], ['SAVE'], ['BGSAVE'], ['MODULE', 'LIST'], ['SWAPDB', 0, 1],
    ];
    for (const command of refused) await assert.rejects(adapter.command(command), rejectsWith('command_not_allowed'), JSON.stringify(command));
    assert.equal(await run('GET', 'あ'), '🙂', 'the data and the server are untouched');
    assert.equal(await run('PING'), 'PONG');
    assert.equal(await run('ECHO', 'hi'), 'hi');
  });

  test('a read-only database allows only commands the server flags read-only', async () => {
    const readOnly = createValkeyAdapter({ socketPath: server.socket, readOnly: true });
    assert.equal((await readOnly.command(['GET', 'あ'])).result, '🙂');
    assert.equal((await readOnly.command(['PING'])).result, 'PONG');
    for (const command of [['SET', 'k', 'x'], ['DEL', 'k'], ['INCR', 'n'], ['EXPIRE', 'k', 1], ['GETDEL', 'k']]) {
      await assert.rejects(readOnly.command(command), rejectsWith('command_not_allowed', /read-only/), JSON.stringify(command));
    }
    await readOnly.close();
  });

  test('db selects the logical database', async () => {
    const other = createValkeyAdapter({ socketPath: server.socket, db: 1 });
    assert.equal((await other.command(['GET', 'k'])).result, null);
    await other.command(['SET', 'only-in-1', 'x']);
    assert.equal(await run('EXISTS', 'only-in-1'), 0);
    await other.close();
  });

  test('a command cannot reach a logical database other than the configured one', async () => {
    await run('SET', 'stays', 'here');
    await assert.rejects(adapter.command(['MOVE', 'stays', 1]), rejectsWith('command_not_allowed', /other logical database/));
    await assert.rejects(adapter.command(['COPY', 'stays', 'copy', 'db', 1]), rejectsWith('command_not_allowed', /other logical database/));
    await assert.rejects(adapter.command(['COPY', 'stays', 'copy', 'REPLACE', { $base64: 'REI=' }, 1]), rejectsWith('command_not_allowed'));
    // The server reads an option as a C string: what follows a NUL byte is not part of it.
    await assert.rejects(adapter.command(['COPY', 'stays', 'copy', 'db\0x', 1]), rejectsWith('command_not_allowed'));
    await assert.rejects(adapter.command(['COPY', 'stays', 'copy', { $base64: 'REIA/w==' }, 1]), rejectsWith('command_not_allowed'));
    assert.equal(await run('COPY', 'stays', 'copy'), 1);
    assert.equal(await run('GET', 'copy'), 'here');
    const other = createValkeyAdapter({ socketPath: server.socket, db: 1 });
    assert.equal((await other.command(['EXISTS', 'stays', 'copy'])).result, 0);
    await other.close();
  });

  test('a value or field name that starts with U+FEFF comes back unchanged', async () => {
    await run('SET', 'bom', '\ufeffvalue');
    assert.equal(await run('GET', 'bom'), '\ufeffvalue');
    await run('HSET', 'bom-hash', '\ufefff', '1', 'f', '2');
    assert.deepEqual(await run('HGETALL', 'bom-hash'), { '\ufefff': '1', f: '2' });
  });

  test('blocking commands are refused, so none holds a request slot waiting for data', async () => {
    const blocking: CommandArg[][] = [
      ['BLPOP', 'no-such-list', 0], ['BRPOP', 'no-such-list', 1], ['BLMOVE', 'a', 'b', 'LEFT', 'RIGHT', 0], ['BLMPOP', 0, 1, 'a', 'LEFT'], ['BRPOPLPUSH', 'a', 'b', 0],
      ['BZPOPMIN', 'z', 0], ['BZPOPMAX', 'z', 0], ['BZMPOP', 0, 1, 'z', 'MIN'], ['WAIT', 1, 0], ['XREAD', 'BLOCK', 0, 'STREAMS', 's', '$'], ['xread', 'COUNT', 1, 'block', 0, 'STREAMS', 's', '$'],
      ['XREADGROUP', 'GROUP', 'g', 'c', 'BLOCK', 0, 'STREAMS', 's', '>'],
    ];
    for (const command of blocking) await assert.rejects(adapter.command(command), rejectsWith('command_not_allowed', /blocking commands are not available/), JSON.stringify(command));
    assert.equal(await run('XADD', 'stream', '1-1', 'f', 'v'), '1-1');
    assert.deepEqual(await run('XREAD', 'COUNT', 1, 'STREAMS', 'stream', '0'), { stream: [['1-1', ['f', 'v']]] });
    assert.deepEqual(await run('XREAD', 'STREAMS', 'block', '0'), null, 'a stream named "block" is a key, not the option');
    assert.equal(await run('PING'), 'PONG');
  });

  test('health reports the engine version, or why the engine is unavailable', async () => {
    const health = await adapter.health();
    assert.equal(health.status, 'ok');
    assert.match(health.version ?? '', /^\d+\.\d+\.\d+$/);
    const down = await createValkeyAdapter({ socketPath: `${server.socket}.missing` }).health();
    assert.deepEqual({ ...down, latencyMs: 0 }, { status: 'unavailable', latencyMs: 0, message: 'cannot reach the Valkey server (ENOENT)' });
    await assert.rejects(createValkeyAdapter({ socketPath: `${server.socket}.missing` }).command(['PING']), rejectsWith('engine_unavailable'));
  });

  test('a closed adapter refuses commands', async () => {
    const closed = createValkeyAdapter({ socketPath: server.socket });
    await closed.close();
    await assert.rejects(closed.command(['PING']), rejectsWith('engine_unavailable'));
  });
});

test('the BLOCK option of XREAD and XREADGROUP is found before STREAMS only', () => {
  assert.equal(takesBlockOption(['XREAD', 'BLOCK', '0', 'STREAMS', 's', '$']), true);
  assert.equal(takesBlockOption(['XREADGROUP', 'GROUP', 'g', 'c', 'COUNT', '1', 'block', '5', 'STREAMS', 's', '>']), true);
  assert.equal(takesBlockOption(['XREAD', 'STREAMS', 'block', '0']), false);
  assert.equal(takesBlockOption(['XREAD', 'COUNT', '1', 'STREAMS', 's', '0']), false);
  assert.equal(takesBlockOption(['XREADGROUP', 'GROUP', 'streams', 'c', 'BLOCK', '0', 'STREAMS', 's', '>']), true);
  assert.equal(takesBlockOption(['XREADGROUP', 'GROUP', 'g', 'streams', 'BLOCK', '0', 'STREAMS', 's', '>']), true);
  assert.equal(takesBlockOption(['XREADGROUP', 'GROUP', 'block', 'block', 'NOACK', 'STREAMS', 's', '>']), false);
});

test('a command the server does not answer is stopped at the time limit or when cancelled', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-valkey-silent-'));
  const sockets = new Set<net.Socket>();
  const silent = net.createServer((socket) => sockets.add(socket));
  const socketPath = path.join(dir, 'silent.sock');
  await new Promise<void>((resolve) => silent.listen(socketPath, resolve));
  const adapter = createValkeyAdapter({ socketPath });
  try {
    await assert.rejects(adapter.command(['GET', 'k'], { timeoutMs: 200 }), rejectsWith('timeout'));
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 100);
    await assert.rejects(adapter.command(['GET', 'k'], { signal: abort.signal }), rejectsWith('cancelled'));
  } finally {
    await adapter.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('Valkey adapter against a server whose user may not run COMMAND INFO', { skip: valkey.skip }, () => {
  let server: TestServer;
  before(async () => {
    server = await startValkey(valkey.binary, ['--user', 'limited', 'on', '>test-only-password', '~*', '+ping', '+get', '+hello', '+auth', '+select']);
  });
  after(() => server.stop());

  test('health is unavailable, as every command would fail', async () => {
    const adapter = createValkeyAdapter({ socketPath: server.socket, username: 'limited', password: 'test-only-password' });
    await assert.rejects(adapter.command(['GET', 'k']), rejectsWith('engine_unavailable', /COMMAND INFO/));
    const health = await adapter.health();
    assert.equal(health.status, 'unavailable');
    assert.match(health.message ?? '', /COMMAND INFO/);
    await adapter.close();
  });
});

describe('Valkey adapter against a server that requires a password', { skip: valkey.skip }, () => {
  let server: TestServer;
  before(async () => {
    server = await startValkey(valkey.binary, ['--requirepass', 'test-only-password']);
  });
  after(() => server.stop());

  test('the password is required and never appears in errors', async () => {
    const right = createValkeyAdapter({ socketPath: server.socket, password: 'test-only-password' });
    assert.equal((await right.command(['PING'])).result, 'PONG');
    assert.equal((await right.health()).status, 'ok');

    for (const options of [{}, { password: 'wrong-password' }, { username: 'nobody', password: 'test-only-password' }]) {
      const adapter = createValkeyAdapter({ socketPath: server.socket, ...options });
      await assert.rejects(adapter.command(['PING']), (error: unknown) => rejectsWith('engine_unavailable')(error) && !/password\b.*(wrong|test-only)/.test((error as Error).message), JSON.stringify(options));
      const health = await adapter.health();
      assert.equal(health.status, 'unavailable');
      assert.ok(!JSON.stringify(health).includes('test-only-password') && !JSON.stringify(health).includes('wrong-password'));
    }
  });
});
