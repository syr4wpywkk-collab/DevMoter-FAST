import { constants as FS, open, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

const DEFAULT_IGNORED = new Set([
  ".git", ".hg", ".svn", ".idea", ".vscode", "node_modules", "dist", "build",
  ".next", ".nuxt", ".venv", "venv", "coverage", ".cache"
]);

const TEXT_EXTENSIONS = new Set([
  "", ".c", ".cc", ".cpp", ".css", ".csv", ".go", ".h", ".hpp", ".html",
  ".java", ".js", ".json", ".jsx", ".kt", ".kts", ".md", ".mjs", ".py",
  ".rb", ".rs", ".sh", ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt",
  ".xml", ".yaml", ".yml"
]);

function normalizeRelativePath(value) {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error("Context path must be project-relative");
  }
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.some(part => part === "." || part === "..")) {
    throw new Error("Context path is invalid");
  }
  return parts.join("/");
}

function assertInside(root, target) {
  const rel = relative(root, target);
  if (rel === "") return;
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error("Context reference escapes the registered project");
  }
}

function isSensitiveName(name) {
  const lower = String(name || "").toLowerCase();
  return lower === ".env" ||
    lower.startsWith(".env.") ||
    lower === "id_rsa" ||
    lower === "id_ed25519" ||
    lower.endsWith(".pem") ||
    lower.endsWith(".key") ||
    lower === ".npmrc";
}

function isTextCandidate(name) {
  return TEXT_EXTENSIONS.has(extname(name).toLowerCase()) && !isSensitiveName(name);
}

async function secureEntry(projectRoot, relativePath, { kind = "any" } = {}) {
  const root = await realpath(projectRoot);
  const safe = normalizeRelativePath(relativePath);
  const candidate = resolve(root, safe);
  assertInside(root, candidate);

  let handle;
  try {
    handle = await open(candidate, FS.O_RDONLY | (FS.O_NOFOLLOW || 0));
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error("Symbolic links cannot be used as context references");
    throw error;
  }

  try {
    const info = await handle.stat();
    const actual = await realpath(candidate);
    assertInside(root, actual);
    if (kind === "file" && !info.isFile()) throw new Error(safe + " is not a file");
    if (kind === "folder" && !info.isDirectory()) throw new Error(safe + " is not a folder");
    return { root, safe, actual, info, handle };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function closeEntry(entry) {
  await entry?.handle?.close?.().catch(() => {});
}

async function secureDirectory(projectRoot, relativePath) {
  return secureEntry(projectRoot, relativePath, { kind: "folder" });
}

async function secureFile(projectRoot, relativePath) {
  return secureEntry(projectRoot, relativePath, { kind: "file" });
}

export async function listContextEntries(
  projectRoot,
  query = "",
  { limit = 80, maxDepth = 5 } = {}
) {
  const root = await realpath(projectRoot);
  const needle = String(query || "").trim().replace(/^@/, "").toLowerCase();
  const results = [];

  async function walk(relativeDir, depth) {
    if (depth > maxDepth || results.length >= limit) return;

    let directory;
    try {
      if (!relativeDir) {
        const handle = await open(root, FS.O_RDONLY | (FS.O_NOFOLLOW || 0));
        directory = { root, safe: "", actual: root, info: await handle.stat(), handle };
      } else {
        directory = await secureDirectory(root, relativeDir);
      }
      if (!directory.info.isDirectory()) return;
    } catch {
      return;
    }

    let entries;
    try {
      entries = await readdir(directory.actual, { withFileTypes: true });
    } finally {
      await closeEntry(directory);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of entries) {
      if (results.length >= limit) break;
      if (dirent.isSymbolicLink()) continue;
      if (DEFAULT_IGNORED.has(dirent.name) || isSensitiveName(dirent.name)) continue;

      const rel = [relativeDir, dirent.name].filter(Boolean).join("/");
      const matches = !needle || rel.toLowerCase().includes(needle);

      if (dirent.isDirectory()) {
        let verified;
        try {
          verified = await secureDirectory(root, rel);
        } catch {
          continue;
        }
        await closeEntry(verified);
        if (matches) results.push({ path: rel, name: dirent.name, kind: "folder" });
        await walk(rel, depth + 1);
        continue;
      }

      if (!dirent.isFile() || !isTextCandidate(dirent.name)) continue;
      let verified;
      try {
        verified = await secureFile(root, rel);
      } catch {
        continue;
      }
      const size = verified.info.size;
      await closeEntry(verified);
      if (matches) results.push({ path: rel, name: dirent.name, kind: "file", size });
    }
  }

  await walk("", 0);
  return results.slice(0, limit);
}

export async function resolveContextReferences(
  projectRoot,
  references,
  {
    maxFiles = 24,
    maxFileBytes = 128 * 1024,
    maxTotalBytes = 512 * 1024,
    maxDepth = 4
  } = {}
) {
  const refs = Array.isArray(references) ? references : [];
  if (!refs.length) return { items: [], totalBytes: 0, truncated: false };

  const files = [];
  const seen = new Set();
  let truncated = false;

  async function addFile(path) {
    if (seen.has(path) || files.length >= maxFiles) {
      if (files.length >= maxFiles) truncated = true;
      return;
    }
    const entry = await secureFile(projectRoot, path);
    if (!isTextCandidate(entry.safe)) {
      await closeEntry(entry);
      return;
    }
    if (entry.info.size > maxFileBytes) {
      await closeEntry(entry);
      throw new Error(entry.safe + " is larger than the context file limit");
    }
    seen.add(entry.safe);
    files.push(entry);
  }

  async function addFolder(path, depth = 0) {
    if (depth > maxDepth || files.length >= maxFiles) {
      truncated = true;
      return;
    }

    const folder = await secureDirectory(projectRoot, path);
    let entries;
    try {
      entries = await readdir(folder.actual, { withFileTypes: true });
    } finally {
      await closeEntry(folder);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      if (dirent.isSymbolicLink()) continue;
      if (DEFAULT_IGNORED.has(dirent.name) || isSensitiveName(dirent.name)) continue;
      const child = folder.safe + "/" + dirent.name;
      if (dirent.isDirectory()) await addFolder(child, depth + 1);
      else if (dirent.isFile()) await addFile(child);
    }
  }

  for (const ref of refs.slice(0, 16)) {
    const kind = ref?.kind === "folder" ? "folder" : "file";
    const path = normalizeRelativePath(ref?.path);
    if (kind === "folder") await addFolder(path);
    else await addFile(path);
  }

  const items = [];
  let totalBytes = 0;

  for (const file of files) {
    try {
      const data = await file.handle.readFile();
      if (data.includes(0)) continue;
      if (totalBytes + data.length > maxTotalBytes) {
        truncated = true;
        break;
      }
      totalBytes += data.length;
      items.push({
        path: file.safe,
        kind: "file",
        size: data.length,
        content: data.toString("utf8")
      });
    } finally {
      await closeEntry(file);
    }
  }

  for (const file of files) await closeEntry(file);
  return { items, totalBytes, truncated };
}

export const contextReferenceInternals = {
  normalizeRelativePath,
  isSensitiveName,
  secureEntry
};
