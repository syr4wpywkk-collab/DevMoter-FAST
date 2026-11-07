import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";

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

/**
 * Write `data` to `path` without following a symbolic link at the final path
 * component. The file is opened once with O_NOFOLLOW (where the platform
 * supports it) and the returned info comes from fstat on that same handle.
 * A symlink at `path` is rejected instead of redirecting the write.
 */
export async function writeFileNoFollow(path, data, { mode = 0o600, encoding = "utf8" } = {}) {
  if (!NOFOLLOW) {
    const existing = await lstat(path).catch(error => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (existing?.isSymbolicLink()) throw symlinkWriteError();
  }
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | NOFOLLOW,
      mode
    );
  } catch (error) {
    if (error?.code === "ELOOP") throw symlinkWriteError();
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw Object.assign(new Error("Write target is not a regular file"), { code: "EINVAL", statusCode: 400 });
    }
    await handle.truncate(0);
    await handle.writeFile(data, typeof data === "string" ? { encoding } : undefined);
    return await handle.stat();
  } finally {
    await handle.close();
  }
}

function symlinkWriteError() {
  return Object.assign(new Error("Refusing to write through a symbolic link"), { code: "ELOOP", statusCode: 400 });
}
