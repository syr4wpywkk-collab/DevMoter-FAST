// API keys: issue, list, revoke and verify.
//
// A key looks like dmb_<id>_<secret>. The id is public and names the key in
// logs and the audit log; the secret is 32 random bytes and is shown once,
// when the key is created. Only a SHA-256 hash of the secret is stored (the
// secret is random, so a slow password hash would add nothing).
//
// Keys live in one JSON file that only its owner can read. Writes replace the
// file atomically, and a running server re-reads it when it changes, so a
// revocation takes effect without a restart.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** SHA-256 of the secret, hex. */
  hash: string;
  createdAt: string;
  revokedAt: string | null;
}

/** A key as it may be shown: without the hash. */
export type ApiKeyInfo = Omit<ApiKeyRecord, 'hash'>;

export type Verification = { ok: true; key: ApiKeyInfo } | { ok: false; reason: 'malformed' | 'unknown' | 'revoked'; keyId?: string };

export class KeyStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyStoreError';
  }
}

const KEY_PATTERN = /^dmb_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

const hashSecret = (secret: string): Buffer => createHash('sha256').update(secret, 'utf8').digest();
const publicInfo = ({ id, name, createdAt, revokedAt }: ApiKeyRecord): ApiKeyInfo => ({ id, name, createdAt, revokedAt });

function parseStore(text: string, file: string): ApiKeyRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new KeyStoreError(`${file} is not valid JSON`);
  }
  const keys = (value as { version?: unknown; keys?: unknown } | null)?.keys;
  if ((value as { version?: unknown } | null)?.version !== 1 || !Array.isArray(keys)) throw new KeyStoreError(`${file} is not an API key file`);
  return keys.map((entry: unknown) => {
    const { id, name, hash, createdAt, revokedAt } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id) || typeof name !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || typeof createdAt !== 'string' || (revokedAt !== null && typeof revokedAt !== 'string')) {
      throw new KeyStoreError(`${file} holds an entry that is not an API key`);
    }
    return { id, name, hash, createdAt, revokedAt };
  });
}

export interface KeyStore {
  /** Issues a key. `key` is the only time the secret is available. */
  create(name: string): Promise<{ key: string; info: ApiKeyInfo }>;
  list(): Promise<ApiKeyInfo[]>;
  /** Revokes a key. Returns undefined when there is no such key; revoking twice keeps the first time. */
  revoke(id: string): Promise<ApiKeyInfo | undefined>;
  verify(presented: string): Promise<Verification>;
}

export function createKeyStore(file: string, now: () => Date = () => new Date()): KeyStore {
  let cache: { stamp: string; keys: ApiKeyRecord[] } | undefined;

  async function load(): Promise<ApiKeyRecord[]> {
    let stamp: string;
    try {
      const info = await stat(file);
      stamp = `${info.mtimeMs}:${info.size}:${info.ino}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new KeyStoreError(`cannot read ${file}`);
    }
    if (cache?.stamp !== stamp) cache = { stamp, keys: parseStore(await readFile(file, 'utf8'), file) };
    return cache.keys;
  }

  async function save(keys: ApiKeyRecord[]): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, keys }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    cache = undefined;
  }

  return {
    async create(name) {
      if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new KeyStoreError('the key name must be 1 to 64 letters, digits, spaces, ".", "_" or "-", starting with a letter or digit');
      const keys = [...(await load())];
      let id = randomBytes(6).toString('hex');
      while (keys.some((key) => key.id === id)) id = randomBytes(6).toString('hex');
      const secret = randomBytes(32).toString('base64url');
      const record: ApiKeyRecord = { id, name, hash: hashSecret(secret).toString('hex'), createdAt: now().toISOString(), revokedAt: null };
      await save([...keys, record]);
      return { key: `dmb_${id}_${secret}`, info: publicInfo(record) };
    },

    async list() {
      return (await load()).map(publicInfo);
    },

    async revoke(id) {
      const keys = await load();
      const found = keys.find((key) => key.id === id);
      if (!found) return undefined;
      if (found.revokedAt !== null) return publicInfo(found);
      const revoked = { ...found, revokedAt: now().toISOString() };
      await save(keys.map((key) => (key === found ? revoked : key)));
      return publicInfo(revoked);
    },

    async verify(presented) {
      const match = typeof presented === 'string' ? KEY_PATTERN.exec(presented) : null;
      if (!match) return { ok: false, reason: 'malformed' };
      const [, id, secret] = match as unknown as [string, string, string];
      const record = (await load()).find((key) => key.id === id);
      // Hash and compare even for an unknown id, so that timing does not reveal which ids exist.
      const matches = timingSafeEqual(hashSecret(secret), Buffer.from(record?.hash ?? '0'.repeat(64), 'hex'));
      if (!record || !matches) return { ok: false, reason: 'unknown', keyId: id };
      if (record.revokedAt !== null) return { ok: false, reason: 'revoked', keyId: id };
      return { ok: true, key: publicInfo(record) };
    },
  };
}
