import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ConfigError, isLoopbackHost, loadConfig, loopbackAddress, parseConfig } from '../src/config.ts';

test('defaults to a loopback server with no databases', () => {
  assert.deepEqual(parseConfig({}, '/etc/dmb'), { server: { host: '127.0.0.1', port: 8787 }, databases: [] });
});

test('resolves database files against the configuration directory', () => {
  const config = parseConfig(
    {
      server: { host: 'localhost', port: 0 },
      databases: [
        { name: 'app', engine: 'sqlite', file: 'data/app.sqlite' },
        { name: 'archive-2026', engine: 'sqlite', file: '/var/lib/dmb/archive.sqlite', readOnly: true },
        { name: 'analytics', engine: 'duckdb', file: 'analytics.duckdb' },
      ],
    },
    '/etc/dmb',
  );
  assert.deepEqual(config, {
    server: { host: 'localhost', port: 0 },
    databases: [
      { name: 'app', engine: 'sqlite', file: '/etc/dmb/data/app.sqlite', readOnly: false },
      { name: 'archive-2026', engine: 'sqlite', file: '/var/lib/dmb/archive.sqlite', readOnly: true },
      { name: 'analytics', engine: 'duckdb', file: '/etc/dmb/analytics.duckdb', readOnly: false },
    ],
  });
});

test('only loopback hosts are accepted while there is no authentication', () => {
  for (const host of ['127.0.0.1', '127.1.2.3', '::1', 'localhost']) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.1', 'example.com', '127.0.0.1.example.com', '128.0.0.1', '', '127.0.0.256']) {
    assert.equal(isLoopbackHost(host), false, host);
    assert.throws(() => parseConfig({ server: { host } }, '/'), ConfigError, host);
  }
});

test('invalid configurations are rejected with the offending setting', () => {
  const cases: [unknown, RegExp][] = [
    [[], /JSON object/],
    [{ sever: {} }, /unknown setting "sever"/],
    [{ server: { port: 70_000 } }, /server\.port/],
    [{ server: { port: '8787' } }, /server\.port/],
    [{ server: { tls: true } }, /unknown setting "tls"/],
    [{ databases: {} }, /databases: must be an array/],
    [{ databases: [{ name: 'App', engine: 'sqlite', file: 'a' }] }, /databases\[0\]\.name/],
    [{ databases: [{ name: '../x', engine: 'sqlite', file: 'a' }] }, /databases\[0\]\.name/],
    [{ databases: [{ name: 'a', engine: 'mysql', file: 'a' }] }, /databases\[0\]\.engine/],
    [{ databases: [{ name: 'a', engine: 'sqlite' }] }, /databases\[0\]\.file/],
    [{ databases: [{ name: 'a', engine: 'sqlite', file: 'a', readOnly: 'yes' }] }, /databases\[0\]\.readOnly/],
    [{ databases: [{ name: 'a', engine: 'sqlite', file: 'a', password: 'x' }] }, /unknown setting "password"/],
    [{ databases: [{ name: 'a', engine: 'sqlite', file: 'a' }, { name: 'a', engine: 'sqlite', file: 'b' }] }, /"a" is used twice/],
  ];
  for (const [value, message] of cases) {
    assert.throws(() => parseConfig(value, '/'), (error: unknown) => error instanceof ConfigError && message.test(error.message), JSON.stringify(value));
  }
});

test('loadConfig reads a file and reports unreadable or malformed ones', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-config-'));
  try {
    const file = path.join(dir, 'config.json');
    await writeFile(file, JSON.stringify({ databases: [{ name: 'app', engine: 'sqlite', file: 'app.sqlite' }] }));
    assert.deepEqual((await loadConfig(file)).databases, [{ name: 'app', engine: 'sqlite', file: path.join(dir, 'app.sqlite'), readOnly: false }]);
    await writeFile(file, '{ not json');
    await assert.rejects(loadConfig(file), /not valid JSON/);
    await assert.rejects(loadConfig(path.join(dir, 'missing.json')), /cannot read/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PostgreSQL and Valkey entries describe a running server on this machine', () => {
  const config = parseConfig(
    {
      databases: [
        { name: 'main', engine: 'postgresql', host: '/run/postgresql', database: 'app', user: 'app', passwordEnv: 'DMB_PG_PASSWORD' },
        { name: 'tcp', engine: 'postgresql', host: '127.0.0.1', port: 5433, database: 'app', user: 'app', readOnly: true },
        { name: 'cache', engine: 'valkey', socketPath: '/run/valkey/valkey.sock' },
        { name: 'cache-tcp', engine: 'valkey', host: 'localhost', db: 2, username: 'app', passwordEnv: 'DMB_VALKEY_PASSWORD', readOnly: true },
      ],
    },
    '/etc/dmb',
  );
  assert.deepEqual(config.databases, [
    { name: 'main', engine: 'postgresql', host: '/run/postgresql', port: 5432, database: 'app', user: 'app', passwordEnv: 'DMB_PG_PASSWORD', readOnly: false },
    { name: 'tcp', engine: 'postgresql', host: '127.0.0.1', port: 5433, database: 'app', user: 'app', readOnly: true },
    { name: 'cache', engine: 'valkey', socketPath: '/run/valkey/valkey.sock', db: 0, readOnly: false },
    { name: 'cache-tcp', engine: 'valkey', host: 'localhost', port: 6379, db: 2, username: 'app', passwordEnv: 'DMB_VALKEY_PASSWORD', readOnly: true },
  ]);
});

test('server engines must be local, and passwords never go in the file', () => {
  const pg = { name: 'main', engine: 'postgresql', host: '/run/postgresql', database: 'app', user: 'app' };
  const valkey = { name: 'cache', engine: 'valkey' };
  const cases: [object, RegExp][] = [
    [{ ...pg, host: 'db.example.com' }, /host: only a Unix socket or a loopback address/],
    [{ ...pg, host: '10.0.0.5' }, /host: only a Unix socket or a loopback address/],
    [{ ...pg, host: 'run/postgresql' }, /host: only a Unix socket or a loopback address/],
    [{ ...pg, host: undefined }, /host: is missing/],
    [{ ...pg, database: '' }, /database: is missing/],
    [{ ...pg, user: 5 }, /user: is missing/],
    [{ ...pg, port: 0 }, /port/],
    [{ ...pg, password: 'hunter2' }, /unknown setting "password"/],
    [{ ...pg, passwordEnv: 'lower case' }, /passwordEnv/],
    [{ ...pg, file: 'x' }, /unknown setting "file"/],
    [{ ...valkey }, /set either socketPath or host/],
    [{ ...valkey, socketPath: '/s', host: 'localhost' }, /set either socketPath or host/],
    [{ ...valkey, socketPath: 'relative.sock' }, /socketPath: must be an absolute path/],
    [{ ...valkey, socketPath: '/s', port: 6379 }, /port: cannot be combined/],
    [{ ...valkey, host: '192.168.0.9' }, /host: only a Unix socket or a loopback address/],
    [{ ...valkey, socketPath: '/s', db: -1 }, /db/],
    [{ ...valkey, socketPath: '/s', username: 'app' }, /username: needs passwordEnv/],
    [{ ...valkey, socketPath: '/s', password: 'hunter2' }, /unknown setting "password"/],
  ];
  for (const [entry, message] of cases) {
    assert.throws(() => parseConfig({ databases: [entry] }, '/'), (error: unknown) => error instanceof ConfigError && message.test(error.message), JSON.stringify(entry));
  }
});

test('API key and audit log files are optional and resolved against the configuration directory', () => {
  assert.deepEqual(parseConfig({}, '/etc/dmb').auth, undefined);
  assert.deepEqual(parseConfig({}, '/etc/dmb').audit, undefined);
  const config = parseConfig({ auth: { keysFile: 'data/api-keys.json' }, audit: { file: '/var/log/dmb/audit.log' } }, '/etc/dmb');
  assert.deepEqual(config.auth, { keysFile: '/etc/dmb/data/api-keys.json' });
  assert.deepEqual(config.audit, { file: '/var/log/dmb/audit.log' });
  const cases: [object, RegExp][] = [
    [{ auth: 'keys.json' }, /auth: must be an object/],
    [{ auth: {} }, /auth\.keysFile: must be a file path/],
    [{ auth: { keysFile: 'k', keys: ['dmb_x'] } }, /auth: unknown setting "keys"/],
    [{ audit: { file: '' } }, /audit\.file: must be a file path/],
    [{ audit: { file: 'a', level: 'all' } }, /audit: unknown setting "level"/],
    // Keys do not lift the loopback restriction: there are no permissions yet.
    [{ server: { host: '0.0.0.0' }, auth: { keysFile: 'k' } }, /server\.host: only loopback addresses/],
    // The audit log is appended to; sharing its file would destroy the other one.
    [{ auth: { keysFile: 'data/x' }, audit: { file: './data/../data/x' } }, /audit\.file: \/data\/x is also auth\.keysFile/],
    [{ databases: [{ name: 'app', engine: 'sqlite', file: 'app.db' }], audit: { file: 'app.db' } }, /audit\.file: \/app\.db is also databases\[0\]\.file/],
    [{ databases: [{ name: 'app', engine: 'duckdb', file: 'k' }], auth: { keysFile: 'k' } }, /auth\.keysFile: \/k is also databases\[0\]\.file/],
  ];
  for (const [value, message] of cases) {
    assert.throws(() => parseConfig(value, '/'), (error: unknown) => error instanceof ConfigError && message.test(error.message), JSON.stringify(value));
  }
  assert.throws(() => parseConfig({ audit: { file: 'dmb.json' } }, '/etc/dmb', '/etc/dmb/dmb.json'), /audit\.file: \/etc\/dmb\/dmb\.json is also the configuration file/);
  assert.throws(() => parseConfig({ auth: { keysFile: 'dmb.json' } }, '/etc/dmb', '/etc/dmb/dmb.json'), /auth\.keysFile: .* is also the configuration file/);
});

test('"localhost" is bound as 127.0.0.1, never through the resolver', () => {
  assert.equal(loopbackAddress('localhost'), '127.0.0.1');
  assert.equal(loopbackAddress('127.0.0.2'), '127.0.0.2');
  assert.equal(loopbackAddress('::1'), '::1');
  for (const host of ['localhost', '127.0.0.1', '::1']) assert.equal(isLoopbackHost(loopbackAddress(host)), true);
});

test('lets SQLite databases share a file, and nothing else', () => {
  const config = parseConfig(
    {
      databases: [
        { name: 'app', engine: 'sqlite', file: 'app.sqlite' },
        { name: 'app-readonly', engine: 'sqlite', file: 'app.sqlite', readOnly: true },
      ],
    },
    '/etc/dmb',
  );
  assert.deepEqual(config.databases.map((database) => 'file' in database && database.file), ['/etc/dmb/app.sqlite', '/etc/dmb/app.sqlite']);
  assert.throws(
    () => parseConfig({ databases: [{ name: 'a', engine: 'sqlite', file: 'x' }, { name: 'b', engine: 'duckdb', file: 'x' }] }, '/etc/dmb'),
    /databases\[1\]\.file: .* is also databases\[0\]\.file/,
  );
  assert.throws(
    () => parseConfig({ databases: [{ name: 'a', engine: 'sqlite', file: 'x' }], audit: { file: 'x' } }, '/etc/dmb'),
    /audit\.file: .* is also databases\[0\]\.file/,
  );
});

test('the example configuration loads', async () => {
  const config = await loadConfig(path.join(import.meta.dirname, '..', 'devmoter-base.config.example.json'));
  assert.deepEqual(config.databases.map((database) => database.name), ['app', 'app-readonly', 'analytics']);
});
