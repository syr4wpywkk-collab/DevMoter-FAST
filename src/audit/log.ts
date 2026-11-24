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

/** The commands of the pinned Valkey (engines/valkey/src/commands), without their subcommands. */
const VALKEY_COMMANDS = new Set(
  (
    'ACL APPEND ASKING AUTH BGREWRITEAOF BGSAVE BITCOUNT BITFIELD BITFIELD_RO BITOP BITPOS BLMOVE BLMPOP BLPOP BRPOP BRPOPLPUSH BZMPOP BZPOPMAX BZPOPMIN ' +
    'CLIENT CLUSTER CLUSTERSCAN COMMAND COMMANDLOG CONFIG COPY DBSIZE DEBUG DECR DECRBY DEL DELEX DELIFEQ DISCARD DUMP ECHO EVAL EVALSHA EVALSHA_RO ' +
    'EVAL_RO EXEC EXISTS EXPIRE EXPIREAT EXPIRETIME FAILOVER FCALL FCALL_RO FLUSHALL FLUSHDB FUNCTION GEOADD GEODIST GEOHASH GEOPOS GEORADIUS ' +
    'GEORADIUSBYMEMBER GEORADIUSBYMEMBER_RO GEORADIUS_RO GEOSEARCH GEOSEARCHSTORE GET GETBIT GETDEL GETEX GETRANGE GETSET HDEL HELLO HEXISTS HEXPIRE ' +
    'HEXPIREAT HEXPIRETIME HGET HGETALL HGETDEL HGETEX HINCRBY HINCRBYFLOAT HKEYS HLEN HMGET HMSET HOTKEYS HPERSIST HPEXPIRE HPEXPIREAT HPEXPIRETIME HPTTL ' +
    'HRANDFIELD HSCAN HSET HSETEX HSETNX HSTRLEN HTTL HVALS INCR INCRBY INCRBYFLOAT INCREX INFO KEYS LASTSAVE LATENCY LCS LINDEX LINSERT LLEN LMOVE LMPOP ' +
    'LOLWUT LPOP LPOS LPUSH LPUSHX LRANGE LREM LSET LTRIM MEMORY MGET MIGRATE MODULE MONITOR MOVE MSET MSETEX MSETNX MULTI OBJECT PERSIST PEXPIRE ' +
    'PEXPIREAT PEXPIRETIME PFADD PFCOUNT PFDEBUG PFMERGE PFSELFTEST PHDEL PHGET PHGETALL PHMGET PHMSET PHPATHCOUNT PHPATHDEL PHPATHEXISTS PHPATHSCAN ' +
    'PHPREFIXES PHSCAN PHSET PING PSETEX PSUBSCRIBE PSYNC PTTL PUBLISH PUBSUB PUNSUBSCRIBE QUIT RANDOMKEY READONLY READWRITE RENAME RENAMENX REPLCONF ' +
    'REPLICAOF RESET RESTORE RESTORE-ASKING ROLE RPOP RPOPLPUSH RPUSH RPUSHX SADD SAVE SCAN SCARD SCRIPT SDIFF SDIFFSTORE SELECT SENTINEL SET SETBIT SETEX ' +
    'SETNX SETRANGE SHUTDOWN SINTER SINTERCARD SINTERSTORE SISMEMBER SLAVEOF SLOWLOG SMEMBERS SMISMEMBER SMOVE SORT SORT_RO SPOP SPUBLISH SRANDMEMBER SREM ' +
    'SSCAN SSUBSCRIBE STRLEN SUBSCRIBE SUBSTR SUNION SUNIONSTORE SUNSUBSCRIBE SWAPDB SYNC TIME TOUCH TTL TYPE UNLINK UNSUBSCRIBE UNWATCH WAIT WAITAOF ' +
    'WATCH XACK XACKDEL XADD XAUTOCLAIM XCLAIM XDEL XDELEX XGROUP XINFO XLEN XPENDING XRANGE XREAD XREADGROUP XREVRANGE XSETID XTRIM ZADD ZCARD ZCOUNT ' +
    'ZDIFF ZDIFFSTORE ZINCRBY ZINTER ZINTERCARD ZINTERSTORE ZLEXCOUNT ZMPOP ZMSCORE ZPOPMAX ZPOPMIN ZRANDMEMBER ZRANGE ZRANGEBYLEX ZRANGEBYSCORE ' +
    'ZRANGESTORE ZRANK ZREM ZREMRANGEBYLEX ZREMRANGEBYRANK ZREMRANGEBYSCORE ZREVRANGE ZREVRANGEBYLEX ZREVRANGEBYSCORE ZREVRANK ZSCAN ZSCORE ZUNION ' +
    'ZUNIONSTORE'
  ).split(' '),
);

/**
 * The kind of a key-value request: the command name when it is a Valkey command, or "OTHER".
 * Any other first word is part of the request (a secret sent by mistake, say), not its kind.
 */
export function commandOperation(command: readonly unknown[]): string {
  const name = command[0];
  if (typeof name !== 'string' || name.length > 64) return 'OTHER';
  const upper = name.toUpperCase();
  return VALKEY_COMMANDS.has(upper) ? upper : 'OTHER';
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
