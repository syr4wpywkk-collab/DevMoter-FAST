// Manages API keys from the command line.
//
//   npm run keys -- create <name>   issue a key (the key is printed once)
//   npm run keys -- list            show the keys (never their secrets)
//   npm run keys -- revoke <id>     revoke a key; a running server refuses it from then on
//
// The key file and the audit log are the ones named in the configuration file
// (DEVMOTER_BASE_CONFIG, default ./devmoter-base.config.json). Keys are managed
// here and not over the API because there are no roles yet: any key holder
// could otherwise issue more keys.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuditLog, type AuditLog } from '../audit/log.ts';
import { createKeyStore, KeyStoreError, type ApiKeyInfo, type KeyStore } from '../auth/keys.ts';
import { ConfigError, loadConfig } from '../config.ts';

const USAGE = 'usage: npm run keys -- create <name> | list | revoke <id>';

const describe = (key: ApiKeyInfo): string => `${key.id}  ${key.revokedAt === null ? 'active ' : 'revoked'}  created ${key.createdAt}${key.revokedAt === null ? '' : `  revoked ${key.revokedAt}`}  ${key.name}`;

/** Runs one command. Returns the process exit code. */
export async function runKeysCommand(args: readonly string[], store: KeyStore, audit: AuditLog | undefined, print: (line: string) => void): Promise<number> {
  const [command, argument, ...extra] = args;
  if (extra.length > 0) {
    print(USAGE);
    return 2;
  }
  if (command === 'create' && argument !== undefined) {
    const { key, info } = await store.create(argument);
    await audit?.record({ event: 'key.created', keyId: info.id });
    print(`Created key ${info.id} (${info.name}). It is shown only this once:`);
    print(key);
    return 0;
  }
  if (command === 'list' && argument === undefined) {
    const keys = await store.list();
    for (const key of keys) print(describe(key));
    if (keys.length === 0) print('No keys.');
    return 0;
  }
  if (command === 'revoke' && argument !== undefined) {
    const before = (await store.list()).find((key) => key.id === argument);
    const revoked = await store.revoke(argument);
    if (!revoked) {
      print(`No key with the id ${argument}.`);
      return 1;
    }
    if (before?.revokedAt === null) await audit?.record({ event: 'key.revoked', keyId: revoked.id });
    print(before?.revokedAt === null ? `Revoked key ${revoked.id} (${revoked.name}).` : `Key ${revoked.id} was already revoked at ${revoked.revokedAt}.`);
    return 0;
  }
  print(USAGE);
  return 2;
}

async function main(): Promise<void> {
  const print = (line: string) => process.stdout.write(`${line}\n`);
  try {
    const config = await loadConfig(path.resolve(process.env.DEVMOTER_BASE_CONFIG ?? 'devmoter-base.config.json'));
    if (!config.auth) throw new ConfigError('the configuration has no "auth": { "keysFile": ... } setting');
    process.exitCode = await runKeysCommand(process.argv.slice(2), createKeyStore(config.auth.keysFile), config.audit ? createAuditLog(config.audit.file) : undefined, print);
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof KeyStoreError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
