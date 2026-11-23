import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createAuditLog, verifyAuditLog } from '../../src/audit/log.ts';
import { createKeyStore } from '../../src/auth/keys.ts';
import { runKeysCommand } from '../../src/cli/keys.ts';

describe('key command line tool', () => {
  let dir: string;
  let auditFile: string;
  const run = async (...args: string[]) => {
    const out: string[] = [];
    const code = await runKeysCommand(args, createKeyStore(path.join(dir, 'keys.json')), createAuditLog(auditFile), (line) => out.push(line));
    return { code, out };
  };

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'dmb-cli-'));
    auditFile = path.join(dir, 'audit.log');
  });
  after(() => rm(dir, { recursive: true, force: true }));

  test('create, list and revoke, with each change in the audit log but never the key itself', async () => {
    assert.deepEqual(await run('list'), { code: 0, out: ['No keys.'] });

    const created = await run('create', 'FAST agent');
    assert.equal(created.code, 0);
    const key = created.out[1] as string;
    const id = key.split('_')[1] as string;
    assert.match(key, /^dmb_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    assert.equal((await createKeyStore(path.join(dir, 'keys.json')).verify(key)).ok, true);

    const listed = await run('list');
    assert.equal(listed.out.length, 1);
    assert.match(listed.out[0] as string, new RegExp(`^${id}  active   created \\S+  FAST agent$`));
    assert.ok(!listed.out.join('\n').includes(key));

    assert.deepEqual(await run('revoke', id), { code: 0, out: [`Revoked key ${id} (FAST agent).`] });
    assert.equal((await createKeyStore(path.join(dir, 'keys.json')).verify(key)).ok, false);
    assert.match((await run('revoke', id)).out[0] as string, /was already revoked at/);
    assert.match((await run('list')).out[0] as string, /revoked {2}created \S+ {2}revoked \S+ {2}FAST agent$/);

    const audit = await readFile(auditFile, 'utf8');
    assert.deepEqual(audit.trimEnd().split('\n').map((line) => { const { event, keyId } = JSON.parse(line) as Record<string, unknown>; return { event, keyId }; }), [
      { event: 'key.created', keyId: id },
      { event: 'key.revoked', keyId: id },
    ]);
    assert.ok(!audit.includes(key.split('_').slice(2).join('_')));
    assert.deepEqual(await verifyAuditLog(auditFile), { ok: true, records: 2 });
  });

  test('unknown ids and wrong usage are reported', async () => {
    assert.deepEqual(await run('revoke', 'ffffffffffff'), { code: 1, out: ['No key with the id ffffffffffff.'] });
    for (const args of [[], ['create'], ['revoke'], ['list', 'x'], ['create', 'a', 'b'], ['delete', 'x']]) {
      const result = await run(...args);
      assert.equal(result.code, 2, args.join(' '));
      assert.match(result.out[0] as string, /^usage:/);
    }
  });
});
