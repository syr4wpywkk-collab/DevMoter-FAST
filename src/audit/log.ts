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
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

import { DUCKDB_SQL, POSTGRESQL_SQL, SQLITE_SQL, sqlShape, type SqlDialect } from '../engines/sql-text.ts';
import { withFileLock } from '../file-lock.ts';

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

// The words an SQL statement of the four engines can start with. Any other
// first word is part of the request, not its kind, and is recorded as "OTHER".
const SQL_KEYWORDS = new Set(
  ('ABORT ALTER ANALYSE ANALYZE ATTACH BEGIN CALL CHECKPOINT CLOSE CLUSTER COMMENT COMMIT COPY CREATE DEALLOCATE DECLARE DELETE DESCRIBE DETACH DISCARD DO DROP END ' +
    'EXECUTE EXPLAIN EXPORT FETCH FORCE FROM GRANT IMPORT INSERT INSTALL LISTEN LOAD LOCK MERGE MOVE NOTIFY PIVOT PRAGMA PREPARE REASSIGN REFRESH REINDEX RELEASE ' +
    'REPLACE RESET REVOKE ROLLBACK SAVEPOINT SECURITY SELECT SET SHOW START SUMMARIZE TABLE TRUNCATE UNLISTEN UNPIVOT UPDATE USE VACUUM VALUES WITH').split(' '),
);

// Each engine has its own idea of where a comment ends and what blank space is.
const DIALECTS: Record<string, SqlDialect> = { sqlite: SQLITE_SQL, duckdb: DUCKDB_SQL, postgresql: POSTGRESQL_SQL };

/**
 * The kind of a SQL request: the keyword its first statement starts with as `engine` reads
 * the text, or "OTHER". Never any other part of the text.
 */
export function sqlOperation(sql: string, engine: string): string {
  const { firstKeyword } = sqlShape(sql, DIALECTS[engine] ?? {});
  return SQL_KEYWORDS.has(firstKeyword) ? firstKeyword : 'OTHER';
}

/** The kind of a key-value request: the command name when it looks like one, or "OTHER". */
export function commandOperation(command: readonly unknown[]): string {
  const name = command[0];
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(name) ? name.toUpperCase() : 'OTHER';
}

const TAIL_BYTES = 64 * 1024;

export function createAuditLog(file: string, now: () => Date = () => new Date()): AuditLog {
  // Hash of the last line and the file size after it; re-read when another process has appended since.
  let last: { hash: string; size: number } | undefined;
  let queue: Promise<void> = Promise.resolve();

  async function append(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    // The server and the key command line tool may write to the same log; the lock keeps the hash chain whole.
    await withFileLock(file, async () => {
      const handle = await open(file, 'a+', 0o600);
      try {
        const { size } = await handle.stat();
        // Also for a file that already has records: it may have been created by hand, readable by others.
        await handle.chmod(0o600);
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
