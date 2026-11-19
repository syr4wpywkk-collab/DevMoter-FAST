import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const CACHE_DECLARATION = /^const CACHE = "(devmoter-fast-v\d+)";$/m;
const BUILD_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

// Ties the service worker cache name to the bundle being built, so every new
// build ships different sw.js bytes. The browser then installs the new worker
// and its activate step deletes the previous build's cache.
export function stampServiceWorkerCache(source, buildId) {
  const match = String(source).match(CACHE_DECLARATION);
  if (!match) throw new Error('sw.js must declare `const CACHE = "devmoter-fast-v<N>";`');
  const id = typeof buildId === "string" ? buildId.trim() : "";
  if (!BUILD_ID_PATTERN.test(id)) return String(source);
  return String(source).replace(CACHE_DECLARATION, `const CACHE = "${match[1]}-${id}";`);
}

export async function stampBuiltServiceWorker(root, outDir, buildId) {
  const path = resolve(root, outDir, "sw.js");
  await writeFile(path, stampServiceWorkerCache(await readFile(path, "utf8"), buildId));
}
