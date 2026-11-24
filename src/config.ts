// Loads and validates the server configuration (a JSON file).
//
// {
//   "server": { "host": "127.0.0.1", "port": 8787 },
//   "databases": [
//     { "name": "app", "engine": "sqlite", "file": "data/app.sqlite" },
//     { "name": "archive", "engine": "sqlite", "file": "data/archive.sqlite", "readOnly": true }
//   ]
// }
//
// Relative `file` paths are resolved against the directory of the configuration file.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;
const DATABASE_NAME = /^[a-z][a-z0-9_-]{0,62}$/;
/** Engines that have an adapter. */
export const CONFIGURABLE_ENGINES = ['sqlite'] as const;

export interface SqliteDatabaseConfig {
  name: string;
  engine: 'sqlite';
  file: string;
  readOnly: boolean;
}

export type DatabaseConfig = SqliteDatabaseConfig;

export interface Config {
  server: { host: string; port: number };
  databases: DatabaseConfig[];
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

/** The API has no authentication yet, so it may only listen on this machine. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
}

export function parseConfig(value: unknown, baseDir: string): Config {
  if (!isRecord(value)) throw new ConfigError('the configuration must be a JSON object');
  onlyKeys(value, ['server', 'databases'], 'configuration');

  const server = value.server ?? {};
  if (!isRecord(server)) throw new ConfigError('server: must be an object');
  onlyKeys(server, ['host', 'port'], 'server');
  const host = server.host ?? DEFAULT_HOST;
  const port = server.port ?? DEFAULT_PORT;
  if (typeof host !== 'string' || !isLoopbackHost(host)) {
    throw new ConfigError('server.host: only loopback addresses (127.0.0.1, ::1, localhost) are allowed until authentication is implemented');
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65_535) throw new ConfigError('server.port: must be a whole number between 0 and 65535');

  const list = value.databases ?? [];
  if (!Array.isArray(list)) throw new ConfigError('databases: must be an array');
  const databases: DatabaseConfig[] = [];
  for (const [index, entry] of list.entries()) {
    const where = `databases[${index}]`;
    if (!isRecord(entry)) throw new ConfigError(`${where}: must be an object`);
    const { name, engine, file, readOnly = false } = entry;
    if (typeof name !== 'string' || !DATABASE_NAME.test(name)) {
      throw new ConfigError(`${where}.name: must start with a lowercase letter and contain only lowercase letters, digits, "_" and "-" (at most 63 characters)`);
    }
    if (databases.some((database) => database.name === name)) throw new ConfigError(`${where}.name: "${name}" is used twice`);
    if (engine !== 'sqlite') {
      throw new ConfigError(`${where}.engine: must be one of ${CONFIGURABLE_ENGINES.join(', ')}`);
    }
    onlyKeys(entry, ['name', 'engine', 'file', 'readOnly'], where);
    if (typeof file !== 'string' || file === '' || file.includes('\0')) throw new ConfigError(`${where}.file: must be a file path`);
    if (typeof readOnly !== 'boolean') throw new ConfigError(`${where}.readOnly: must be true or false`);
    databases.push({ name, engine, file: path.resolve(baseDir, file), readOnly });
  }
  return { server: { host, port }, databases };
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
