// A lock shared by the processes that change one file (the server and the
// command line tools): whoever holds it reads the file, changes it and writes
// it back with no other writer in between.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';

const LOCK_WAIT_MS = 5000;
const EMPTY_LOCK_STALE_MS = 30_000;
const RETRY_MS = 10;

// Tells this run of the program from an earlier one with the same process ID (a restarted container).
const INSTANCE = randomBytes(8).toString('hex');

interface LockOwner {
  devmoterBaseLock: 1;
  pid: number;
  host: string;
  instance: string;
}

const ownership = (): string => JSON.stringify({ devmoterBaseLock: 1, pid: process.pid, host: os.hostname(), instance: INSTANCE } satisfies LockOwner);

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Whether the lock file was left by a writer that no longer exists. Only a file this
 * module wrote counts: anything else at that path (another file, a directory) is not
 * ours to remove. A writer on another host, or one whose state cannot be told, is
 * taken to be alive.
 */
async function isAbandoned(lock: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(lock, 'utf8');
  } catch {
    return false;
  }
  if (text === '') {
    // Created but not yet signed: the writer is between the two steps, or died there.
    return stat(lock).then((info) => Date.now() - info.mtimeMs > EMPTY_LOCK_STALE_MS, () => false);
  }
  let owner: Partial<LockOwner>;
  try {
    owner = JSON.parse(text) as Partial<LockOwner>;
  } catch {
    return false;
  }
  if (typeof owner !== 'object' || owner === null || owner.devmoterBaseLock !== 1 || !Number.isSafeInteger(owner.pid) || owner.host !== os.hostname()) return false;
  if (owner.pid === process.pid) return owner.instance !== INSTANCE;
  return !isRunning(owner.pid as number);
}

/**
 * Removes an abandoned lock. One process at a time does this, and it looks again once
 * it is alone: otherwise a second one, acting on what it saw earlier, would remove the
 * lock the first has just taken for itself.
 */
async function reclaim(lock: string): Promise<void> {
  const guard = `${lock}.reclaim`;
  try {
    await mkdir(guard);
  } catch {
    return;
  }
  try {
    if (await isAbandoned(lock)) await unlink(lock).catch(() => {});
  } finally {
    await rmdir(guard).catch(() => {});
  }
}

/**
 * Runs `task` while holding the lock of `file`: a file beside it that only one
 * writer at a time can create. Fails when the lock cannot be had in time.
 */
export async function withFileLock<T>(file: string, task: () => Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await writeFile(lock, ownership(), { flag: 'wx', mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    // A writer that died while holding the lock must not block the file for good.
    if (await isAbandoned(lock)) await reclaim(lock);
    if (Date.now() > deadline) throw new Error(`${file} is locked by another writer; if none is running, remove ${lock}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  try {
    return await task();
  } finally {
    await unlink(lock).catch(() => {});
  }
}
