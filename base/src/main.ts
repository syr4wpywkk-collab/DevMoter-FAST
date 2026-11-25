// Starts the DevMoter Base API server.
//
//   DEVMOTER_BASE_CONFIG       configuration file (default: ./devmoter-base.config.json)
//   DEVMOTER_BASE_ENGINES_DIR  where the built engines are (default: ./build/<arch>)
//   DEVMOTER_BASE_LOG_LEVEL    trace | debug | info | warn | error | fatal | silent

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiServer, stopApiServer, type Database } from './api/server.ts';
import { createAuditLog } from './audit/log.ts';
import { createKeyStore } from './auth/keys.ts';
import { ConfigError, isLoopbackHost, loadConfig, loopbackAddress, type DatabaseConfig } from './config.ts';
import { createDuckdbAdapter } from './engines/duckdb.ts';
import { defaultEnginesDir, engineBinary } from './engines/paths.ts';
import { createPostgresqlAdapter } from './engines/postgresql.ts';
import { createSqliteAdapter } from './engines/sqlite.ts';
import type { Adapter } from './engines/types.ts';
import { createValkeyAdapter } from './engines/valkey.ts';
import { createRootLogger } from './logging/logger.ts';

const SHUTDOWN_GRACE_MS = 10_000;

/** Reads the password a database entry points at. Passwords live in the environment, never in the configuration file. */
function password(config: { name: string; passwordEnv?: string }, env: NodeJS.ProcessEnv): { password?: string } {
  if (config.passwordEnv === undefined) return {};
  const value = env[config.passwordEnv];
  if (value === undefined || value === '') throw new ConfigError(`database "${config.name}": the environment variable ${config.passwordEnv} is not set`);
  return { password: value };
}

export function openDatabase(config: DatabaseConfig, enginesDir: string, env: NodeJS.ProcessEnv = process.env): Database {
  const { name, engine, readOnly } = config;
  let adapter: Adapter;
  switch (config.engine) {
    case 'sqlite':
      adapter = createSqliteAdapter({ binary: engineBinary(enginesDir, 'sqlite', 'sqlite3'), file: config.file, readOnly });
      break;
    case 'duckdb':
      adapter = createDuckdbAdapter({ binary: engineBinary(enginesDir, 'duckdb', 'duckdb'), file: config.file, readOnly });
      break;
    case 'postgresql':
      adapter = createPostgresqlAdapter({ host: config.host, port: config.port, database: config.database, user: config.user, ...password(config, env), readOnly });
      break;
    case 'valkey': {
      const { socketPath, host, port, db, username } = config;
      adapter = createValkeyAdapter({
        ...(socketPath === undefined ? {} : { socketPath }),
        ...(host === undefined ? {} : { host }),
        ...(port === undefined ? {} : { port }),
        db,
        ...(username === undefined ? {} : { username }),
        ...password(config, env),
        readOnly,
      });
      break;
    }
  }
  return { name, engine, readOnly, adapter };
}

async function main(): Promise<void> {
  const logger = createRootLogger();
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const configFile = path.resolve(process.env.DEVMOTER_BASE_CONFIG ?? 'devmoter-base.config.json');
  let config;
  try {
    config = await loadConfig(configFile);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.fatal('invalid configuration', { configFile, reason: error.message });
    process.exitCode = 1;
    return;
  }

  const enginesDir = defaultEnginesDir(repoRoot);
  let databases: Database[];
  try {
    databases = config.databases.map((database) => openDatabase(database, enginesDir));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    logger.fatal('invalid configuration', { configFile, reason: error.message });
    process.exitCode = 1;
    return;
  }
  const auth = config.auth ? createKeyStore(config.auth.keysFile) : undefined;
  const audit = config.audit ? createAuditLog(config.audit.file) : undefined;
  try {
    // Fail at startup, not on the first request, when the key file is unreadable or the audit log cannot be written.
    await auth?.list();
    await audit?.record({ event: 'server.started' });
  } catch (error) {
    logger.fatal('the API key file or the audit log cannot be used', { err: error });
    process.exitCode = 1;
    return;
  }
  if (!auth) logger.warn('API keys are not configured: every local process can use the API');
  if (!audit) logger.warn('the audit log is not configured: operations are not recorded');
  const server = createApiServer({ databases, logger, ...(auth ? { auth } : {}), ...(audit ? { audit } : {}) });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    void stopApiServer(server, SHUTDOWN_GRACE_MS)
      .then(() => Promise.allSettled(databases.map((database) => database.adapter.close())))
      .then(() => process.exit(0));
    // Only reached if cancelling the running queries did not end them.
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS + 5_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  server.on('error', (error) => {
    logger.fatal('the server could not start', { err: error });
    process.exit(1);
  });
  server.listen(config.server.port, loopbackAddress(config.server.host), () => {
    const address = server.address();
    const bound = address !== null && typeof address === 'object' ? address.address : '';
    if (!isLoopbackHost(bound)) {
      // Cannot happen with an address literal; checked because the API has no permissions yet.
      logger.fatal('the server is not listening on a loopback address', { address: bound });
      process.exit(1);
    }
    logger.info('listening', { host: bound, port: config.server.port, databases: databases.map((database) => database.name), enginesDir, apiKeys: auth !== undefined, auditLog: audit !== undefined });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
