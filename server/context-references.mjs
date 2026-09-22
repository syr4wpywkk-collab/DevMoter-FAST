import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_IGNORED = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "coverage",
  ".cache"
]);

const TEXT_EXTENSIONS = new Set([
  "",
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
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
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Context reference escapes the registered project");
  }
}

function isSensitiveName(name) {
  const lower = name.toLowerCase();
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

async function secureEntry(projectRoot, relativePath) {
  const root = await realpath(projectRoot);
  const safe = normalizeRelativePath(relativePath);
  const candidate = resolve(root, safe);
  assertInside(root, candidate);

  const linkInfo = await lstat(candidate);
  if (linkInfo.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be used as context references");
  }

  const actual = await realpath(candidate);
  assertInside(root, actual);
  const info = await stat(actual);
  return { root, safe, actual, info };
}

export async function listContextEntries(
  projectRoot,
  query = "",
  { limit = 80, maxDepth = 5 } = {}
) {
  const root = await realpath(projectRoot);
  const needle = String(query || "").trim().replace(/^@/, "").toLowerCase();
  const results = [];

  async function walk(current, prefix, depth) {
    if (depth > maxDepth || results.length >= limit) return;

    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.isSymbolicLink()) continue;
      if (DEFAULT_IGNORED.has(entry.name) || isSensitiveName(entry.name)) continue;

      const rel = [prefix, entry.name].filter(Boolean).join("/");
      const matches = !needle || rel.toLowerCase().includes(needle);

      if (entry.isDirectory()) {
        if (matches) results.push({ path: rel, name: entry.name, kind: "folder" });
        await walk(resolve(current, entry.name), rel, depth + 1);
        continue;
      }

      if (entry.isFile() && isTextCandidate(entry.name) && matches) {
        let size = null;
        try {
          size = (await stat(resolve(current, entry.name))).size;
        } catch {}
        results.push({ path: rel, name: entry.name, kind: "file", size });
      }
    }
  }

  await walk(root, "", 0);
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

    const entry = await secureEntry(projectRoot, path);
    if (!entry.info.isFile()) return;
    if (!isTextCandidate(entry.safe)) return;
    if (entry.info.size > maxFileBytes) {
      throw new Error(`${entry.safe} is larger than the context file limit`);
    }
    seen.add(entry.safe);
    files.push(entry);
  }

  async function addFolder(path, depth = 0) {
    if (depth > maxDepth || files.length >= maxFiles) {
      truncated = true;
      return;
    }

    const folder = await secureEntry(projectRoot, path);
    if (!folder.info.isDirectory()) throw new Error(`${folder.safe} is not a folder`);

    const entries = await readdir(folder.actual, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      if (DEFAULT_IGNORED.has(entry.name) || isSensitiveName(entry.name)) continue;
      const child = `${folder.safe}/${entry.name}`.split(sep).join("/");
      if (entry.isDirectory()) await addFolder(child, depth + 1);
      else if (entry.isFile()) await addFile(child);
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
    const data = await readFile(file.actual);
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
  }

  return { items, totalBytes, truncated };
}
