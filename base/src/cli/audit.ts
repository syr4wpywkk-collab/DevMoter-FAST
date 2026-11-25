// Checks that the audit log has not been edited.
//
//   npm run audit:verify
//
// Exit code 0 when every record follows from the one before it, 1 otherwise.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyAuditLog } from '../audit/log.ts';
import { ConfigError, loadConfig } from '../config.ts';

async function main(): Promise<void> {
  try {
    const config = await loadConfig(path.resolve(process.env.DEVMOTER_BASE_CONFIG ?? 'devmoter-base.config.json'));
    if (!config.audit) throw new ConfigError('the configuration has no "audit": { "file": ... } setting');
    const result = await verifyAuditLog(config.audit.file).catch(() => {
      throw new ConfigError(`cannot read the audit log ${config.audit?.file}`);
    });
    process.stdout.write(result.ok ? `OK: ${result.records} records, the chain is whole\n` : `FAILED: the chain breaks at line ${result.brokenAt} of ${result.records}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
