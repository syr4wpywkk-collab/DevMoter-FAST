// Loads and validates the server configuration (a JSON file).
//
// {
//   "server": { "host": "127.0.0.1", "port": 8787 },
//   "databases": [
//     { "name": "app", "engine": "sqlite", "file": "data/app.sqlite" },
//     { "name": "analytics", "engine": "duckdb", "file": "data/analytics.duckdb", "readOnly": true },
//     { "name": "main", "engine": "postgresql", "host": "/run/postgresql", "port": 5432, "database": "app", "user": "app", "passwordEnv": "DMB_PG_PASSWORD" },
//     { "name": "cache", "engine": "valkey", "socketPath": "/run/valkey/valkey.sock", "db": 0 }
//   ],
//   "auth": { "keysFile": "data/api-keys.json" },
//   "audit": { "file": "data/audit.log" }
// }
//
// Relative file paths are resolved against the directory of the configuration file.
// `auth` turns on API keys (see src/auth/keys.ts); `audit` turns on the audit log
// (see src/audit/log.ts). Both are optional.
// PostgreSQL and Valkey are servers that must already be running; they are reached
// over a Unix socket or a loopback address only. Passwords are never written in the
// file: `passwordEnv` names the environment variable that holds one.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;
const DATABASE_NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const LOCAL_ONLY = 'only a Unix socket or a loopback address (127.0.0.1, ::1, localhost) is allowed: connections to other machines are not supported yet';
/** Engines that have an adapter. */
export const CONFIGURABLE_ENGINES = ['sqlite', 'duckdb', 'postgresql', 'valkey'] as const;

/** SQLite and DuckDB databases are single files. */
export interface FileDatabaseConfig {
  name: string;
  engine: 'sqlite' | 'duckdb';
  file: string;
  readOnly: boolean;
}

export interface PostgresqlDatabaseConfig {
  name: string;
  engine: 'postgresql';
  /** A loopback host, or the absolute path of the directory that holds the server's Unix socket. */
  host: string;
  port: number;
  database: string;
  user: string;
  /** Name of the environment variable that holds the password. */
  passwordEnv?: string;
  readOnly: boolean;
}

export interface ValkeyDatabaseConfig {
  name: string;
  engine: 'valkey';
  socketPath?: string;
  host?: string;
  port?: number;
  db: number;
  username?: string;
  passwordEnv?: string;
  readOnly: boolean;
}

export type DatabaseConfig = FileDatabaseConfig | PostgresqlDatabaseConfig | ValkeyDatabaseConfig;

export interface Config {
  server: { host: string; port: number };
  databases: DatabaseConfig[];
  /** API keys are required when set. */
  auth?: { keysFile: string };
  /** Requests and key changes are recorded when set. */
  audit?: { file: string };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ConfigError(`${where}: unknown setting ${unknown.map((key) => `"${key}"`).join(', ')}`);
}

/** API keys identify a caller but grant everything, so the API may only listen on this machine for now. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
}

export function parseConfig(value: unknown, baseDir: string): Config {
  if (!isRecord(value)) throw new ConfigError('the configuration must be a JSON object');
  onlyKeys(value, ['server', 'databases', 'auth', 'audit'], 'configuration');

  const server = value.server ?? {};
  if (!isRecord(server)) throw new ConfigError('server: must be an object');
  onlyKeys(server, ['host', 'port'], 'server');
  const host = server.host ?? DEFAULT_HOST;
  const port = server.port ?? DEFAULT_PORT;
  if (typeof host !== 'string' || !isLoopbackHost(host)) {
    throw new ConfigError('server.host: only loopback addresses (127.0.0.1, ::1, localhost) are allowed until user authentication and permissions are implemented');
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65_535) throw new ConfigError('server.port: must be a whole number between 0 and 65535');

  const list = value.databases ?? [];
  if (!Array.isArray(list)) throw new ConfigError('databases: must be an array');
  const databases: DatabaseConfig[] = [];
  for (const [index, entry] of list.entries()) {
    const where = `databases[${index}]`;
    if (!isRecord(entry)) throw new ConfigError(`${where}: must be an object`);
    const { name, engine, readOnly = false } = entry;
    if (typeof name !== 'string' || !DATABASE_NAME.test(name)) {
      throw new ConfigError(`${where}.name: must start with a lowercase letter and contain only lowercase letters, digits, "_" and "-" (at most 63 characters)`);
    }
    if (databases.some((database) => database.name === name)) throw new ConfigError(`${where}.name: "${name}" is used twice`);
    if (typeof readOnly !== 'boolean') throw new ConfigError(`${where}.readOnly: must be true or false`);

    const text = (key: string, pattern?: RegExp): string => {
      const value = entry[key];
      if (typeof value !== 'string' || value === '' || value.includes('\0') || (pattern && !pattern.test(value))) throw new ConfigError(`${where}.${key}: is missing or not valid`);
      return value;
    };
    const optionalText = (key: string, pattern?: RegExp): string | undefined => (entry[key] === undefined ? undefined : text(key, pattern));
    const tcpPort = (fallback: number): number => {
      const value = entry.port ?? fallback;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) throw new ConfigError(`${where}.port: must be a whole number between 1 and 65535`);
      return value;
    };
    const passwordEnv = (): { passwordEnv?: string } => {
      const value = optionalText('passwordEnv', ENV_NAME);
      return value === undefined ? {} : { passwordEnv: value };
    };

    if (engine === 'sqlite' || engine === 'duckdb') {
      onlyKeys(entry, ['name', 'engine', 'file', 'readOnly'], where);
      const { file } = entry;
      if (typeof file !== 'string' || file === '' || file.includes('\0')) throw new ConfigError(`${where}.file: must be a file path`);
      databases.push({ name, engine, file: path.resolve(baseDir, file), readOnly });
    } else if (engine === 'postgresql') {
      onlyKeys(entry, ['name', 'engine', 'host', 'port', 'database', 'user', 'passwordEnv', 'readOnly'], where);
      const dbHost = text('host');
      if (!path.isAbsolute(dbHost) && !isLoopbackHost(dbHost)) throw new ConfigError(`${where}.host: ${LOCAL_ONLY}`);
      databases.push({ name, engine, host: dbHost, port: tcpPort(5432), database: text('database'), user: text('user'), ...passwordEnv(), readOnly });
    } else if (engine === 'valkey') {
      onlyKeys(entry, ['name', 'engine', 'socketPath', 'host', 'port', 'db', 'username', 'passwordEnv', 'readOnly'], where);
      const socketPath = optionalText('socketPath');
      const dbHost = optionalText('host');
      if ((socketPath === undefined) === (dbHost === undefined)) throw new ConfigError(`${where}: set either socketPath or host`);
      if (socketPath !== undefined && !path.isAbsolute(socketPath)) throw new ConfigError(`${where}.socketPath: must be an absolute path`);
      if (socketPath !== undefined && entry.port !== undefined) throw new ConfigError(`${where}.port: cannot be combined with socketPath`);
      if (dbHost !== undefined && !isLoopbackHost(dbHost)) throw new ConfigError(`${where}.host: ${LOCAL_ONLY}`);
      const db = entry.db ?? 0;
      if (typeof db !== 'number' || !Number.isInteger(db) || db < 0 || db > 65_535) throw new ConfigError(`${where}.db: must be a whole number, 0 or greater`);
      const username = optionalText('username');
      const password = passwordEnv();
      if (username !== undefined && password.passwordEnv === undefined) throw new ConfigError(`${where}.username: needs passwordEnv`);
      databases.push({
        name,
        engine,
        ...(socketPath !== undefined ? { socketPath } : { host: dbHost as string, port: tcpPort(6379) }),
        db,
        ...(username === undefined ? {} : { username }),
        ...password,
        readOnly,
      });
    } else {
      throw new ConfigError(`${where}.engine: must be one of ${CONFIGURABLE_ENGINES.join(', ')}`);
    }
  }
  const fileSetting = (section: 'auth' | 'audit', key: string): string | undefined => {
    const settings = value[section];
    if (settings === undefined) return undefined;
    if (!isRecord(settings)) throw new ConfigError(`${section}: must be an object`);
    onlyKeys(settings, [key], section);
    const file = settings[key];
    if (typeof file !== 'string' || file === '' || file.includes('\0')) throw new ConfigError(`${section}.${key}: must be a file path`);
    return path.resolve(baseDir, file);
  };
  const keysFile = fileSetting('auth', 'keysFile');
  const auditFile = fileSetting('audit', 'file');
  return { server: { host, port }, databases, ...(keysFile === undefined ? {} : { auth: { keysFile } }), ...(auditFile === undefined ? {} : { audit: { file: auditFile } }) };
}

export async function loadConfig(file: string): Promise<Config> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new ConfigError(`cannot read the configuration file ${file}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError(`${file} is not valid JSON`);
  }
  return parseConfig(value, path.dirname(path.resolve(file)));
}
