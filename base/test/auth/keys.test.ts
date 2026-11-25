import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createKeyStore, KeyStoreError } from '../../src/auth/keys.ts';
import { redactString } from '../../src/logging/redact.ts';

describe('API keys', () => {
  let dir: string;
  let file: string;
  let clock = Date.parse('2026-11-24T00:00:00Z');
  const now = () => new Date((clock += 1000));

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-keys-'));
    file = path.join(dir, 'nested', 'api-keys.json');
  });
  after(() => rm(dir, { recursive: true, force: true }));

  test('a store without a file has no keys and accepts none', async () => {
    const store = createKeyStore(file, now);
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(await store.verify(`dmb_${'0'.repeat(12)}_${'A'.repeat(43)}`), { ok: false, reason: 'unknown', keyId: '0'.repeat(12) });
  });

  test('a created key verifies; the file holds only a hash and is private', async () => {
    const store = createKeyStore(file, now);
    const { key, info } = await store.create('FAST agent');
    assert.match(key, /^dmb_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(info, { id: key.split('_')[1], name: 'FAST agent', createdAt: '2026-11-24T00:00:01.000Z', revokedAt: null });
    assert.deepEqual(await store.verify(key), { ok: true, key: info });
    assert.deepEqual(await store.list(), [info]);

    const text = await readFile(file, 'utf8');
    const secret = key.split('_').slice(2).join('_');
    assert.ok(!text.includes(secret));
    assert.match(text, /"hash": "[0-9a-f]{64}"/);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    // The logger masks keys, so one that reaches a log line by accident is not readable there.
    assert.ok(!redactString(`key=${key}`).includes(secret));
  });

  test('wrong, malformed and tampered keys are refused', async () => {
    const store = createKeyStore(file, now);
    const { key, info } = await store.create('second');
    const flipped = `${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`;
    assert.deepEqual(await store.verify(flipped), { ok: false, reason: 'unknown', keyId: info.id });
    const other = (await store.list())[0]?.id as string;
    assert.deepEqual(await store.verify(key.replace(info.id, other)), { ok: false, reason: 'unknown', keyId: other });
    for (const bad of ['', 'dmb_', key.slice(4), `${key}x`, ` ${key}`, key.toUpperCase(), 'Bearer x']) {
      assert.deepEqual(await store.verify(bad), { ok: false, reason: 'malformed' }, bad);
    }
    assert.deepEqual(await store.verify(undefined as unknown as string), { ok: false, reason: 'malformed' });
  });

  test('a revoked key stops working, in a store that is already open too', async () => {
    const server = createKeyStore(file, now);
    const cli = createKeyStore(file, now);
    const { key, info } = await cli.create('to-revoke');
    assert.equal((await server.verify(key)).ok, true);

    const revoked = await cli.revoke(info.id);
    assert.deepEqual(revoked, { ...info, revokedAt: revoked?.revokedAt });
    assert.match(revoked?.revokedAt ?? '', /^2026-11-24T/);
    assert.deepEqual(await server.verify(key), { ok: false, reason: 'revoked', keyId: info.id });
    // Revoking again keeps the first time; an unknown id is reported.
    assert.deepEqual(await cli.revoke(info.id), revoked);
    assert.equal(await cli.revoke('ffffffffffff'), undefined);
    // The other keys are untouched.
    assert.equal((await server.list()).filter((entry) => entry.revokedAt === null).length, 2);
  });

  test('changes made at the same time through several stores are all kept', async () => {
    const shared = path.join(dir, 'shared.json');
    const stores = [createKeyStore(shared, now), createKeyStore(shared, now), createKeyStore(shared, now)];
    const first = await (stores[0] as ReturnType<typeof createKeyStore>).create('first');
    for (const store of stores) await store.list();

    const [, ...created] = await Promise.all([
      (stores[1] as ReturnType<typeof createKeyStore>).revoke(first.info.id),
      ...Array.from({ length: 12 }, (_, n) => (stores[n % 3] as ReturnType<typeof createKeyStore>).create(`key ${n}`)),
    ]);

    const fresh = createKeyStore(shared, now);
    assert.deepEqual(await fresh.verify(first.key), { ok: false, reason: 'revoked', keyId: first.info.id });
    assert.equal((await fresh.list()).length, 13);
    for (const { key } of created) assert.equal((await fresh.verify(key)).ok, true);
    assert.equal((await stat(shared)).mode & 0o777, 0o600);
  });

  test('key names are checked', async () => {
    const store = createKeyStore(file, now);
    for (const name of ['', ' x', 'a\nb', 'x'.repeat(65), '<script>', 5 as unknown as string]) {
      await assert.rejects(store.create(name), KeyStoreError, String(name));
    }
    assert.equal((await store.create('日本語の名前 1.0')).info.name, '日本語の名前 1.0');
  });

  test('a damaged key file is an error, never an empty key list', async () => {
    const damaged = path.join(dir, 'damaged.json');
    for (const text of ['{', '[]', '{"version":2,"keys":[]}', '{"version":1,"keys":[{"id":"x"}]}']) {
      await writeFile(damaged, text);
      await assert.rejects(createKeyStore(damaged).list(), KeyStoreError, text);
      await assert.rejects(createKeyStore(damaged).verify(`dmb_${'0'.repeat(12)}_${'A'.repeat(43)}`), KeyStoreError, text);
    }
  });
});
