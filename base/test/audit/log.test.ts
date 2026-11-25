import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { commandOperation, createAuditLog, sqlOperation, verifyAuditLog } from '../../src/audit/log.ts';

const VALKEY_COMMANDS_DIR = path.join(import.meta.dirname, '../../engines/valkey/src/commands');

test('an operation is described by its kind only', () => {
  assert.equal(sqlOperation('select * from secrets', 'postgresql'), 'SELECT');
  assert.equal(sqlOperation('  -- note\n /* a\n b */ Insert INTO t VALUES (1)', 'postgresql'), 'INSERT');
  assert.equal(sqlOperation('WITH x AS (SELECT 1) DELETE FROM t', 'postgresql'), 'WITH');
  assert.equal(sqlOperation("'password=hunter2'", 'postgresql'), 'OTHER');
  assert.equal(sqlOperation('hunter2hunter2hunter2 x', 'postgresql'), 'OTHER');
  assert.equal(sqlOperation('', 'postgresql'), 'OTHER');
  assert.equal(sqlOperation('\ufeffSELECT 1', 'sqlite'), 'SELECT');
  assert.equal(sqlOperation('-- note\rUPDATE t SET a = 1', 'postgresql'), 'UPDATE');
  assert.equal(sqlOperation('analyse t', 'postgresql'), 'ANALYSE');
  // A word that is not an SQL statement keyword is part of the request, not its kind.
  assert.equal(sqlOperation('hunter x', 'postgresql'), 'OTHER');
  assert.equal(sqlOperation('swordfish', 'postgresql'), 'OTHER');
  assert.equal(sqlOperation('/* a */ -- b\n explain select 1', 'postgresql'), 'EXPLAIN');
  // Read as the engine reads it: an SQLite comment ends at the first "*/", DuckDB takes a no-break space as a space.
  assert.equal(sqlOperation('/* a /* b */ INSERT INTO t VALUES (1)', 'sqlite'), 'INSERT');
  assert.equal(sqlOperation('/* a /* b */ INSERT INTO t VALUES (1) */ SELECT 1', 'postgresql'), 'SELECT');
  assert.equal(sqlOperation('/* a /* b */ INSERT INTO t VALUES (1) */ SELECT 1', 'sqlite'), 'INSERT');
  assert.equal(sqlOperation('/* never closed', 'sqlite'), 'OTHER');
  assert.equal(sqlOperation('DELETE\u00a0FROM t', 'duckdb'), 'DELETE');
  assert.equal(commandOperation(['set', 'private-key', 'v']), 'SET');
  assert.equal(commandOperation(['CLIENT', 'LIST']), 'CLIENT');
  assert.equal(commandOperation([{ $base64: 'AA==' }]), 'OTHER');
  assert.equal(commandOperation(['SET\r\nFLUSHALL']), 'OTHER');
  assert.equal(commandOperation([]), 'OTHER');
  // A word that is not a command is not recorded: it may be a secret sent in the wrong place.
  assert.equal(commandOperation(['hunter2hunter2', 'x']), 'OTHER');
  assert.equal(commandOperation(['sk_live_abcdef']), 'OTHER');
  assert.equal(commandOperation(['restore-asking', 'k']), 'RESTORE-ASKING');
});

test('the kind of a request made of many comments is found at once', () => {
  const started = performance.now();
  assert.equal(sqlOperation(`${'/**/'.repeat(5000)}1`, 'postgresql'), 'OTHER');
  assert.equal(sqlOperation(`${'/**/'.repeat(5000)}select 1`, 'postgresql'), 'SELECT');
  assert.ok(performance.now() - started < 1000);
});

describe('audit log', () => {
  let dir: string;
  let file: string;
  const now = () => new Date('2026-11-24T00:00:00Z');
  const records = async () => (await readFile(file, 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-audit-'));
    file = path.join(dir, 'nested', 'audit.log');
  });
  after(() => rm(dir, { recursive: true, force: true }));

  test('records are appended in order, chained, and private to the owner', async () => {
    const log = createAuditLog(file, now);
    await Promise.all([1, 2, 3].map((n) => log.record({ event: 'api.request', requestId: `r${n}`, keyId: 'abc', route: 'databases.query', database: 'app', operation: 'SELECT', status: 200 })));
    const written = await records();
    assert.deepEqual(written.map((record) => record.requestId), ['r1', 'r2', 'r3']);
    assert.deepEqual(written[0], { time: '2026-11-24T00:00:00.000Z', event: 'api.request', requestId: 'r1', keyId: 'abc', route: 'databases.query', database: 'app', operation: 'SELECT', status: 200, prev: '0'.repeat(64) });
    assert.match(written[1]?.prev as string, /^[0-9a-f]{64}$/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await verifyAuditLog(file), { ok: true, records: 3 });
  });

  test('a log file that others could read is made private before a record is added', async () => {
    const shared = path.join(dir, 'shared.log');
    const first = JSON.stringify({ time: '2026-11-23T00:00:00.000Z', event: 'server.started', prev: '0'.repeat(64) });
    await writeFile(shared, `${first}\n`, { mode: 0o644 });
    await chmod(shared, 0o644);
    await createAuditLog(shared, now).record({ event: 'api.request', requestId: 'r1' });
    assert.equal((await stat(shared)).mode & 0o777, 0o600);
    assert.deepEqual(await verifyAuditLog(shared), { ok: true, records: 2 });
  });

  test('several writers keep one chain', async () => {
    const server = createAuditLog(file, now);
    const cli = createAuditLog(file, now);
    await server.record({ event: 'api.request', requestId: 'r4' });
    await cli.record({ event: 'key.revoked', keyId: 'abc' });
    await Promise.all([...Array(20).keys()].map((n) => (n % 2 ? server : cli).record({ event: 'api.request', requestId: `p${n}` })));
    assert.deepEqual(await verifyAuditLog(file), { ok: true, records: 25 });
    await assert.rejects(stat(`${file}.lock`));
  });

  test('an edited or removed record breaks the chain at that point', async () => {
    const original = await readFile(file, 'utf8');
    const lines = original.trimEnd().split('\n');

    await writeFile(file, `${lines.map((line, index) => (index === 1 ? line.replace('"status":200', '"status":403') : line)).join('\n')}\n`);
    assert.deepEqual(await verifyAuditLog(file), { ok: false, records: 25, brokenAt: 3 });

    await writeFile(file, `${lines.filter((_, index) => index !== 4).join('\n')}\n`);
    assert.deepEqual(await verifyAuditLog(file), { ok: false, records: 24, brokenAt: 5 });

    await writeFile(file, `${lines.slice(0, 3).join('\n')}\nnot json\n`);
    assert.deepEqual(await verifyAuditLog(file), { ok: false, records: 4, brokenAt: 4 });

    await writeFile(file, original);
    assert.deepEqual(await verifyAuditLog(file), { ok: true, records: 25 });
  });

  test('a write that fails is reported and does not stop later writes', async () => {
    const blocked = createAuditLog(path.join(file, 'not-a-directory', 'audit.log'), now);
    await assert.rejects(blocked.record({ event: 'api.request' }));
    await assert.rejects(blocked.record({ event: 'api.request' }));
  });
});

test('every command of the pinned Valkey has a kind', { skip: !existsSync(VALKEY_COMMANDS_DIR) && 'engines/ is not checked out' }, () => {
  const files = readdirSync(VALKEY_COMMANDS_DIR).filter((file) => file.endsWith('.json'));
  assert.ok(files.length > 400);
  for (const file of files) {
    for (const [name, info] of Object.entries(JSON.parse(readFileSync(path.join(VALKEY_COMMANDS_DIR, file), 'utf8')) as Record<string, { container?: string }>)) {
      const command = (info.container ?? name).toUpperCase();
      assert.equal(commandOperation([command.toLowerCase()]), command, file);
    }
  }
});
