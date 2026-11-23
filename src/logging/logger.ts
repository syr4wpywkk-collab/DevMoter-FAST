// Structured logging: one JSON object per line, with secrets redacted.

import { REDACTED, isSensitiveKey, redactString } from './redact.ts';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogThreshold = LogLevel | 'silent';
export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogThreshold;
  isLevelEnabled(level: LogLevel): boolean;
  trace(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  fatal(msg: string, fields?: LogFields): void;
  /** Returns a logger that adds `bindings` to every record. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogThreshold;
  /** Receives one serialized record (no trailing newline). Defaults to stdout. */
  sink?: (line: string) => void;
  bindings?: LogFields;
  clock?: () => Date;
}

const MAX_DEPTH = 6;
const MAX_STRING = 8_192;
const MAX_ITEMS = 100;
const RESERVED = new Set(['time', 'level', 'msg']);

const severity = (level: LogThreshold): number =>
  level === 'silent' ? Number.POSITIVE_INFINITY : LOG_LEVELS.indexOf(level);

export function parseLogLevel(value: string | undefined, fallback: LogThreshold = 'info'): LogThreshold {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'silent') return 'silent';
  return (LOG_LEVELS as readonly string[]).includes(normalized ?? '') ? (normalized as LogLevel) : fallback;
}

function truncate(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated ${value.length - MAX_STRING} chars]` : value;
}

function sanitizeError(error: Error, depth: number, seen: WeakSet<object>): LogFields {
  const out: LogFields = { name: error.name, message: truncate(redactString(error.message)) };
  if (error.stack) out.stack = truncate(redactString(error.stack));
  for (const key of ['code', 'errno', 'syscall', 'severity', 'detail', 'hint', 'position'] as const) {
    const value = (error as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = sanitize(value, depth + 1, seen);
  }
  if (error.cause !== undefined) out.cause = sanitize(error.cause, depth + 1, seen);
  return out;
}

/** Converts any value into JSON-safe data with secrets masked. */
export function sanitize(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case 'string':
      return truncate(redactString(value));
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'symbol':
    case 'function':
      return `[${typeof value}]`;
    default:
      break;
  }
  const object = value as object;
  if (object instanceof Date) return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString();
  if (object instanceof Uint8Array) return `[bytes ${object.byteLength}]`;
  if (seen.has(object)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(object);
  try {
    if (object instanceof Error) return sanitizeError(object, depth, seen);
    if (Array.isArray(object)) {
      const items = object.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1, seen));
      if (object.length > MAX_ITEMS) items.push(`[${object.length - MAX_ITEMS} more items]`);
      return items;
    }
    const entries = object instanceof Map ? [...object.entries()] : Object.entries(object);
    const out: LogFields = {};
    for (const [rawKey, item] of entries.slice(0, MAX_ITEMS)) {
      const key = String(rawKey);
      out[key] = isSensitiveKey(key) && item !== undefined && item !== null ? REDACTED : sanitize(item, depth + 1, seen);
    }
    if (entries.length > MAX_ITEMS) out['…'] = `[${entries.length - MAX_ITEMS} more keys]`;
    return out;
  } finally {
    seen.delete(object);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const clock = options.clock ?? (() => new Date());
  const bindings = options.bindings ?? {};
  const threshold = severity(level);

  const write = (recordLevel: LogLevel, msg: string, fields?: LogFields): void => {
    if (severity(recordLevel) < threshold) return;
    const record: LogFields = { time: clock().toISOString(), level: recordLevel, msg: truncate(redactString(msg)) };
    const extra = sanitize({ ...bindings, ...fields }) as LogFields;
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      record[RESERVED.has(key) ? `field_${key}` : key] = value;
    }
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ time: record.time, level: recordLevel, msg: record.msg, logError: 'unserializable fields' });
    }
    try {
      sink(line);
    } catch {
      // Logging must never throw into the caller.
    }
  };

  return {
    level,
    isLevelEnabled: (candidate) => severity(candidate) >= threshold,
    trace: (msg, fields) => write('trace', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    fatal: (msg, fields) => write('fatal', msg, fields),
    child: (childBindings) =>
      createLogger({ level, sink, clock, bindings: { ...bindings, ...childBindings } }),
  };
}

/** Logger configured from the environment (`DEVMOTER_BASE_LOG_LEVEL`). */
export function createRootLogger(env: NodeJS.ProcessEnv = process.env, options: LoggerOptions = {}): Logger {
  return createLogger({
    level: parseLogLevel(env.DEVMOTER_BASE_LOG_LEVEL),
    bindings: { service: 'devmoter-base' },
    ...options,
  });
}
