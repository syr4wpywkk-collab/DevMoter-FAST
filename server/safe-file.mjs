import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";

const NOFOLLOW = fsConstants.O_NOFOLLOW || 0;

/**
 * Open a file once and run `use(handle, info)` against that same open file.
 * `info` comes from fstat on the handle, so a check on it (size, type, mode,
 * owner) describes exactly the bytes later read from the handle: no
 * check-then-use race on the path. With `noFollow`, a symlink at `path` fails
 * to open (ELOOP) instead of being followed.
 */
export async function withOpenFile(path, { noFollow = false } = {}, use) {
  const handle = await open(path, fsConstants.O_RDONLY | (noFollow ? NOFOLLOW : 0));
  try {
    const info = await handle.stat();
    return await use(handle, info);
  } finally {
    await handle.close();
  }
}

/** Read at most `maxBytes` from an open handle; throws when the file is larger. */
export async function readHandle(handle, maxBytes = Number.POSITIVE_INFINITY, encoding = null) {
  const chunks = [];
  let total = 0;
  const chunkSize = 64 * 1024;
  for (;;) {
    const buffer = Buffer.allocUnsafe(chunkSize);
    const { bytesRead } = await handle.read(buffer, 0, chunkSize, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) {
      throw Object.assign(new Error("File exceeds its size limit"), { code: "EFBIG", statusCode: 413 });
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  const data = Buffer.concat(chunks, total);
  return encoding ? data.toString(encoding) : data;
}
