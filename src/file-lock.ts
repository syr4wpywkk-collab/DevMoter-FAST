// A lock shared by the processes that change one file (the server and the
// command line tools): whoever holds it reads the file, changes it and writes
// it back with no other writer in between.

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, rmdir, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import os from 'node:os';

const LOCK_WAIT_MS = 5000;
const RETRY_MS = 10;
const MAX_LOCK_BYTES = 1024;

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

/** What the lock file says, when it is a small regular file; undefined for anything else at that path. */
async function readLock(lock: string): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    // Without waiting: a named pipe at that path would hold the caller until something wrote to it.
    handle = await open(lock, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_LOCK_BYTES) return undefined;
    return await handle.readFile('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Whether the lock was written by a writer that no longer exists. Only a lock this
 * module wrote counts: anything else is not ours to remove. A writer on another
 * host, or one whose state cannot be told, is taken to be alive.
 */
function ownerIsGone(text: string | undefined): text is string {
  if (text === undefined) return false;
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
 * lock the first has just taken for itself. A process that dies in here leaves the
 * guard behind, and locks are then no longer taken over until it is removed by hand:
 * taking the guard over as well would let two processes in.
 */
async function reclaim(lock: string): Promise<void> {
  const guard = `${lock}.reclaim`;
  try {
    await mkdir(guard);
  } catch {
    return;
  }
  try {
    const seen = await readLock(lock);
    if (!ownerIsGone(seen)) return;
    // The writer may have been alive when the file was read, and have released the lock and
    // gone since; the file is then another writer's. One that was already gone cannot release
    // anything: if the file still says the same, it is the abandoned lock.
    if ((await readLock(lock)) === seen) await unlink(lock).catch(() => {});
  } finally {
    await rmdir(guard).catch(() => {});
  }
}

let drafts = 0;

/**
 * Creates the lock with its owner already written in it, or reports that there is one.
 * The lock is a second name for a finished file: a process that dies in here leaves no
 * lock without an owner, which nobody could tell from one that is about to be signed.
 */
async function createLock(lock: string): Promise<boolean> {
  const draft = `${lock}.${process.pid}.${INSTANCE}.${(drafts += 1)}`;
  await writeFile(draft, ownership(), { flag: 'wx', mode: 0o600 });
  try {
    await link(draft, lock);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
  } finally {
    await unlink(draft).catch(() => {});
  }
  // No second names on this file system (app storage on Android, some network shares).
  try {
    await writeFile(lock, ownership(), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Runs `task` while holding the lock of `file`: a file beside it that only one
 * writer at a time can create. Fails when the lock cannot be had in time.
 */
export async function withFileLock<T>(file: string, task: () => Promise<T>, waitMs = LOCK_WAIT_MS): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + waitMs;
  while (!(await createLock(lock))) {
    // A writer that died while holding the lock must not block the file for good.
    if (ownerIsGone(await readLock(lock))) await reclaim(lock);
    if (Date.now() > deadline) throw new Error(`${file} is locked by another writer; if none is running, remove ${lock} and ${lock}.reclaim`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  try {
    return await task();
  } finally {
    await unlink(lock).catch(() => {});
  }
}
