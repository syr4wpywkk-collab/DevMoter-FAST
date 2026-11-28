import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger, createRootLogger, parseLogLevel, sanitize } from '../../src/logging/logger.ts';

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (line) => lines.push(line),
    clock: () => new Date('2026-11-24T00:00:00.000Z'),
    ...options,
  });
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

// Built at runtime so the repository contains no key-shaped literal.
const fakeApiKey = ['dmb', 'k1a2b3c4', 'x'.repeat(32)].join('_');

test('writes one JSON object per line with time, level and msg', () => {
  const { logger, lines, records } = capture();
  logger.info('server started', { port: 8765 });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes('\n'));
  assert.deepEqual(records()[0], {
    time: '2026-11-24T00:00:00.000Z',
    level: 'info',
    msg: 'server started',
    port: 8765,
  });
});

test('filters records below the configured level', () => {
  const { logger, records } = capture({ level: 'warn' });
  logger.debug('hidden');
  logger.info('hidden');
  logger.warn('shown');
  logger.error('shown');
  assert.deepEqual(records().map((record) => record.level), ['warn', 'error']);
  assert.equal(logger.isLevelEnabled('info'), false);
  assert.equal(logger.isLevelEnabled('fatal'), true);
});

test('silent level writes nothing', () => {
  const { logger, lines } = capture({ level: 'silent' });
  logger.fatal('nothing');
  assert.equal(lines.length, 0);
});

test('child loggers add bindings and keep the parent sink and level', () => {
  const { logger, records } = capture({ bindings: { service: 'devmoter-base' } });
  const child = logger.child({ component: 'api', requestId: 'r-1' });
  child.info('handled', { status: 200 });
  assert.deepEqual(records()[0], {
    time: '2026-11-24T00:00:00.000Z',
    level: 'info',
    msg: 'handled',
    service: 'devmoter-base',
    component: 'api',
    requestId: 'r-1',
    status: 200,
  });
});

test('fields cannot overwrite time, level or msg', () => {
  const { logger, records } = capture();
  logger.info('real', { msg: 'fake', level: 'fatal', time: 'never' });
  const record = records()[0]!;
  assert.equal(record.msg, 'real');
  assert.equal(record.level, 'info');
  assert.equal(record.time, '2026-11-24T00:00:00.000Z');
  assert.equal(record.field_msg, 'fake');
});

test('redacts values under sensitive keys at any depth', () => {
  const { logger, lines, records } = capture();
  logger.info('config loaded', {
    password: 'hunter2',
    apiKey: 'abc',
    headers: { Authorization: 'Bearer abcdefghijkl', 'x-api-key': 'zzz', accept: 'application/json' },
    nested: [{ clientSecret: 's3cret', name: 'ok' }],
  });
  const record = records()[0]!;
  assert.equal(record.password, '[REDACTED]');
  assert.equal(record.apiKey, '[REDACTED]');
  assert.deepEqual(record.headers, {
    Authorization: '[REDACTED]',
    'x-api-key': '[REDACTED]',
    accept: 'application/json',
  });
  assert.deepEqual(record.nested, [{ clientSecret: '[REDACTED]', name: 'ok' }]);
  for (const secret of ['hunter2', 'abcdefghijkl', 's3cret', 'zzz']) assert.ok(!lines[0]!.includes(secret));
});

test('keeps boolean flags under sensitive keys, which carry no secret', () => {
  const { logger, records } = capture();
  logger.info('listening', { apiKeys: true, password: false, token: 'abc' });
  const record = records()[0]!;
  assert.equal(record.apiKeys, true);
  assert.equal(record.password, false);
  assert.equal(record.token, '[REDACTED]');
});

test('masks credentials inside strings: URLs, bearer tokens and API keys', () => {
  const { logger, lines, records } = capture();
  logger.error(`connect failed for postgres://app:p%40ss@db.internal:5432/app using ${fakeApiKey}`, {
    url: 'valkey://default:topsecret@127.0.0.1:6379/0',
    note: 'sent Authorization: Bearer abc.def.ghi-jkl',
  });
  const record = records()[0]!;
  assert.equal(record.msg, 'connect failed for postgres://app:[REDACTED]@db.internal:5432/app using [REDACTED]');
  assert.equal(record.url, 'valkey://default:[REDACTED]@127.0.0.1:6379/0');
  assert.equal(record.note, 'sent Authorization: Bearer [REDACTED]');
  for (const secret of ['p%40ss', 'topsecret', 'abc.def.ghi-jkl', fakeApiKey]) assert.ok(!lines[0]!.includes(secret));
});

test('serializes errors with redacted message, code and cause', () => {
  const { logger, records } = capture();
  const cause = new Error('socket closed');
  const error = Object.assign(new Error('auth failed for postgres://u:pw123456@h/db', { cause }), { code: '28P01' });
  logger.error('query failed', { err: error });
  const err = records()[0]!.err as Record<string, unknown>;
  assert.equal(err.name, 'Error');
  assert.equal(err.message, 'auth failed for postgres://u:[REDACTED]@h/db');
  assert.equal(err.code, '28P01');
  assert.equal((err.cause as Record<string, unknown>).message, 'socket closed');
  assert.ok(!String(err.stack).includes('pw123456'));
});

test('handles circular references, bigint, dates, bytes and depth limits', () => {
  const circular: Record<string, unknown> = { name: 'loop' };
  circular.self = circular;
  const value = sanitize({
    circular,
    big: 2n ** 64n,
    when: new Date('2026-01-02T03:04:05.000Z'),
    bytes: new Uint8Array(4),
    nan: Number.NaN,
    deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
  }) as Record<string, any>;
  assert.equal(value.circular.self, '[Circular]');
  assert.equal(value.big, '18446744073709551616');
  assert.equal(value.when, '2026-01-02T03:04:05.000Z');
  assert.equal(value.bytes, '[bytes 4]');
  assert.equal(value.nan, 'NaN');
  assert.equal(value.deep.a.b.c.d.e, '[MaxDepth]');
});

test('truncates very long strings', () => {
  const { logger, records } = capture();
  logger.info('big', { payload: 'x'.repeat(20_000) });
  const payload = records()[0]!.payload as string;
  assert.ok(payload.length < 9_000);
  assert.match(payload, /truncated 11808 chars/);
});

test('a throwing sink never propagates to the caller', () => {
  const logger = createLogger({
    sink: () => {
      throw new Error('disk full');
    },
  });
  assert.doesNotThrow(() => logger.info('still fine'));
});

test('parseLogLevel accepts known levels and falls back otherwise', () => {
  assert.equal(parseLogLevel('DEBUG'), 'debug');
  assert.equal(parseLogLevel(' silent '), 'silent');
  assert.equal(parseLogLevel('verbose'), 'info');
  assert.equal(parseLogLevel(undefined, 'warn'), 'warn');
});

test('createRootLogger reads the level from the environment and tags the service', () => {
  const lines: string[] = [];
  const logger = createRootLogger({ DEVMOTER_BASE_LOG_LEVEL: 'debug' }, { sink: (line) => lines.push(line) });
  logger.debug('hello');
  const record = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(record.level, 'debug');
  assert.equal(record.service, 'devmoter-base');
});
