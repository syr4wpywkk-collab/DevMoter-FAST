// A lock shared by the processes that change one file (the server and the
// command line tools): whoever holds it reads the file, changes it and writes
// it back with no other writer in between.

import { mkdir, rmdir, stat } from 'node:fs/promises';

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30_000;

/**
 * Runs `task` while holding the lock of `file`: a directory beside it that
 * only one writer at a time can create.
 */
export async function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
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
      else if (Date.now() > deadline) throw new Error(`${file} is locked by another writer`);
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try {
    return await task();
  } finally {
    await rmdir(lock).catch(() => {});
  }
}
