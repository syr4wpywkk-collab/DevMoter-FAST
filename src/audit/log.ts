// The audit log: who did what, to which database, and how it ended.
//
// One JSON object per line, appended to a file only its owner can read. Each
// record carries the hash of the previous line, so a removed or edited line
// breaks the chain and `verifyAuditLog` reports where. (Lines removed from the
// end are not detectable from the file alone.)
//
// Records never contain SQL text, parameters, command arguments, results or
// key secrets. An operation is described by its kind only: the first keyword
// of the SQL (SELECT, INSERT, ...) or the Valkey command name.

import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface AuditEvent {
  /** What happened: "api.request", "auth.failed", "key.created", "key.revoked", "server.started". */
  event: string;
  requestId?: string;
  /** Id of the API key that acted; absent when the API runs without authentication. */
  keyId?: string;
  method?: string;
  route?: string;
  database?: string;
  engine?: string;
  /** SQL statement keyword or Valkey command name. */
  operation?: string;
  status?: number;
  error?: string;
  durationMs?: number;
  rows?: number;
  reason?: string;
}

export interface AuditRecord extends AuditEvent {
  time: string;
  /** SHA-256 of the previous line; 64 zeros for the first record. */
  prev: string;
}

export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
}

const GENESIS = '0'.repeat(64);
const hashLine = (line: string): string => createHash('sha256').update(line, 'utf8').digest('hex');

/** The kind of a SQL request: its first keyword, or "OTHER". Never any other part of the text. */
export function sqlOperation(sql: string): string {
  const match = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*([A-Za-z]{1,16})\b/.exec(sql);
  return match?.[1] ? match[1].toUpperCase() : 'OTHER';
}

/** The kind of a key-value request: the command name when it looks like one, or "OTHER". */
export function commandOperation(command: readonly unknown[]): string {
  const name = command[0];
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name) ? name.toUpperCase() : 'OTHER';
}

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;
const TAIL_BYTES = 64 * 1024;

/**
 * Runs `task` while holding the log's lock. The server and the key command
 * line tool may write to the same log; the lock keeps the hash chain whole.
 */
async function withLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A writer that died while holding the lock must not block the log for good.
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) await rmdir(lock).catch(() => {});
      else if (Date.now() > deadline) throw new Error('the audit log is locked by another writer');
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    return await task();
  } finally {
    await rmdir(lock).catch(() => {});
  }
}

export function createAuditLog(file: string, now: () => Date = () => new Date()): AuditLog {
  // Hash of the last line and the file size after it; re-read when another process has appended since.
  let last: { hash: string; size: number } | undefined;
  let queue: Promise<void> = Promise.resolve();

  async function append(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await withLock(file, async () => {
      const handle = await open(file, 'a+', 0o600);
      try {
        const { size } = await handle.stat();
        if (size === 0) await chmod(file, 0o600);
        if (last?.size !== size) {
          const length = Math.min(size, TAIL_BYTES);
          const tail = Buffer.alloc(length);
          await handle.read(tail, 0, length, size - length);
          const line = tail.toString('utf8').split('\n').filter((part) => part !== '').at(-1);
          last = { hash: line === undefined ? GENESIS : hashLine(line), size };
        }
        const record: AuditRecord = { time: now().toISOString(), ...event, prev: last.hash };
        const line = JSON.stringify(record);
        await handle.appendFile(`${line}\n`);
        last = { hash: hashLine(line), size: size + Buffer.byteLength(line) + 1 };
      } finally {
        await handle.close();
      }
    });
  }

  return {
    // Records are written one after another, in the order they were made.
    record(event) {
      const written = queue.then(() => append(event));
      queue = written.catch(() => {});
      return written;
    },
  };
}

/** Checks the hash chain of an audit log. `brokenAt` is the 1-based line where it first fails. */
export async function verifyAuditLog(file: string): Promise<{ ok: true; records: number } | { ok: false; records: number; brokenAt: number }> {
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line !== '');
  let previous = GENESIS;
  for (const [index, line] of lines.entries()) {
    let prev: unknown;
    try {
      prev = (JSON.parse(line) as { prev?: unknown }).prev;
    } catch {
      prev = undefined;
    }
    if (prev !== previous) return { ok: false, records: lines.length, brokenAt: index + 1 };
    previous = hashLine(line);
  }
  return { ok: true, records: lines.length };
}
