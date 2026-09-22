import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_EXCLUDED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".nuxt", ".cache",
  ".venv", "venv", "vendor", "coverage", "target", "out"
]);

const DEFAULT_EXCLUDED_FILES = [
  /^\.env(?:\.|$)/i,
  /(?:^|\.)pem$/i,
  /(?:^|\.)key$/i,
  /(?:^|\.)p12$/i,
  /(?:^|\.)pfx$/i,
  /credentials/i,
  /secrets?/i,
  /id_rsa/i,
  /id_ed25519/i
];

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".py", ".rb", ".php", ".java", ".kt", ".kts", ".go", ".rs", ".swift",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".scala", ".sh", ".bash",
  ".zsh", ".fish", ".ps1", ".sql", ".html", ".htm", ".css", ".scss",
  ".sass", ".less", ".vue", ".svelte", ".md", ".mdx", ".txt", ".json",
  ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".xml", ".graphql", ".gql"
]);

const MAX_FILES = 2500;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_INDEXED_BYTES = 12 * 1024 * 1024;
const MAX_LINES_PER_FILE = 5000;

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

function slash(value) {
  return String(value || "").split(sep).join("/");
}

function languageFor(path) {
  const ext = extname(path).toLowerCase();
  return ext ? ext.slice(1) : "text";
}

function isProbablyText(path) {
  const base = basename(path);
  if (base === "Dockerfile" || base === "Makefile" || base === "Procfile") return true;
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function userExcluded(path, patterns) {
  const normalized = slash(path);
  return patterns.some(pattern => {
    const value = String(pattern || "").trim().replace(/^\.\//, "").replace(/\*+/g, "");
    if (!value) return false;
    return normalized === value ||
      normalized.startsWith(`${value}/`) ||
      normalized.includes(`/${value}/`) ||
      normalized.endsWith(`/${value}`);
  });
}

function defaultSensitive(path) {
  const base = basename(path);
  return DEFAULT_EXCLUDED_FILES.some(pattern => pattern.test(base));
}

function extractSymbols(lines, path) {
  const symbols = [];
  const patterns = [
    [/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, "function"],
    [/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
    [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
    [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, "type"],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, "binding"],
    [/^\s*def\s+([A-Za-z_]\w*)\s*\(/, "function"],
    [/^\s*class\s+([A-Za-z_]\w*)\s*[:(]/, "class"],
    [/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/, "function"],
    [/^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, "struct"],
    [/^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, "enum"],
    [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, "function"],
    [/^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?class\s+([A-Za-z_]\w*)/, "class"]
  ];

  for (let index = 0; index < lines.length && symbols.length < 120; index += 1) {
    const line = lines[index];
    for (const [pattern, kind] of patterns) {
      const match = line.match(pattern);
      if (match) {
        symbols.push({
          name: match[1],
          kind,
          line: index + 1,
          path
        });
        break;
      }
    }
  }
  return symbols;
}

function compactLines(text) {
  return text
    .split(/\r?\n/)
    .slice(0, MAX_LINES_PER_FILE)
    .map(line => line.slice(0, 1200));
}

export function createProjectIndex(options = {}) {
  const stateDir = options.stateDir;
  const resolveProject = options.resolveProject;
  if (!stateDir || typeof resolveProject !== "function") {
    throw new Error("Project index requires stateDir and resolveProject.");
  }

  function fileFor(projectId) {
    return join(stateDir, `${safeId(projectId)}.json`);
  }

  async function readIndex(projectId) {
    try {
      return JSON.parse(await readFile(fileFor(projectId), "utf8"));
    } catch {
      return null;
    }
  }

  async function writeIndex(projectId, payload) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const destination = fileFor(projectId);
    const temp = destination + "." + process.pid + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(payload), { mode: 0o600 });
    await rename(temp, destination);
  }

  async function walkProject(project, additionalExclude = []) {
    const canonicalRoot = await realpath(project.path);
    const previous = await readIndex(project.id);
    const reusable = new Map(
      Array.isArray(previous?.files)
        ? previous.files.map(file => [file.path, file])
        : []
    );

    const files = [];
    const skipped = [];
    let indexedBytes = 0;
    let reusedFiles = 0;

    async function walk(current) {
      if (files.length >= MAX_FILES || indexedBytes >= MAX_INDEXED_BYTES) return;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (files.length >= MAX_FILES || indexedBytes >= MAX_INDEXED_BYTES) break;
        if (entry.isSymbolicLink()) continue;

        const full = join(current, entry.name);
        const rel = slash(relative(canonicalRoot, full));

        if (userExcluded(rel, additionalExclude)) {
          skipped.push({ path: rel, reason: "user-excluded" });
          continue;
        }

        if (entry.isDirectory()) {
          if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) {
            skipped.push({ path: rel, reason: "vendor-or-build-directory" });
            continue;
          }
          await walk(full);
          continue;
        }

        if (!entry.isFile()) continue;
        if (defaultSensitive(rel)) {
          skipped.push({ path: rel, reason: "sensitive-file-default" });
          continue;
        }
        if (!isProbablyText(rel)) continue;

        let info;
        let target;
        try {
          const entryInfo = await lstat(full);
          if (entryInfo.isSymbolicLink() || !entryInfo.isFile()) continue;
          target = await realpath(full);
          const contained = relative(canonicalRoot, target);
          if (!contained || contained.startsWith("..") || isAbsolute(contained)) {
            skipped.push({ path: rel, reason: "path-escape" });
            continue;
          }
          info = await stat(target);
          if (!info.isFile()) continue;
        } catch {
          continue;
        }
        if (info.size > MAX_FILE_BYTES) {
          skipped.push({ path: rel, reason: "file-too-large" });
          continue;
        }
        if (indexedBytes + info.size > MAX_INDEXED_BYTES) {
          skipped.push({ path: rel, reason: "index-byte-budget" });
          continue;
        }

        const old = reusable.get(rel);
        if (old && old.size === info.size && old.mtimeMs === info.mtimeMs && Array.isArray(old.lines)) {
          files.push(old);
          indexedBytes += info.size;
          reusedFiles += 1;
          continue;
        }

        let text;
        try {
          text = await readFile(target, "utf8");
        } catch {
          skipped.push({ path: rel, reason: "not-utf8-readable" });
          continue;
        }
        if (text.includes("\u0000")) {
          skipped.push({ path: rel, reason: "binary-like" });
          continue;
        }

        const lines = compactLines(text);
        files.push({
          path: rel,
          size: info.size,
          mtimeMs: info.mtimeMs,
          language: languageFor(rel),
          symbols: extractSymbols(lines, rel),
          lines
        });
        indexedBytes += info.size;
      }
    }

    await walk(canonicalRoot);
    return { files, skipped: skipped.slice(0, 500), indexedBytes, reusedFiles };
  }

  async function rebuild(projectId, buildOptions = {}) {
    const project = await resolveProject(projectId);
    const exclude = Array.isArray(buildOptions.exclude)
      ? buildOptions.exclude.map(String).slice(0, 100)
      : [];
    const startedAt = Date.now();
    const result = await walkProject(project, exclude);
    const payload = {
      version: 1,
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      builtAt: Date.now(),
      durationMs: Date.now() - startedAt,
      exclude,
      limits: {
        maxFiles: MAX_FILES,
        maxFileBytes: MAX_FILE_BYTES,
        maxIndexedBytes: MAX_INDEXED_BYTES
      },
      ...result
    };
    await writeIndex(projectId, payload);
    return {
      projectId: project.id,
      builtAt: payload.builtAt,
      durationMs: payload.durationMs,
      files: payload.files.length,
      indexedBytes: payload.indexedBytes,
      reusedFiles: payload.reusedFiles,
      skipped: payload.skipped,
      exclude
    };
  }

  async function status(projectId) {
    const index = await readIndex(projectId);
    if (!index) return { ready: false, projectId };
    return {
      ready: true,
      projectId,
      builtAt: index.builtAt,
      files: index.files?.length || 0,
      indexedBytes: index.indexedBytes || 0,
      reusedFiles: index.reusedFiles || 0,
      exclude: index.exclude || [],
      limits: index.limits || null
    };
  }

  async function remove(projectId) {
    await rm(fileFor(projectId), { force: true });
    return { ok: true, projectId };
  }

  async function search(projectId, query, limit = 30) {
    const index = await readIndex(projectId);
    if (!index) throw new Error("Project index has not been built.");
    const terms = String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (!terms.length) return { query: String(query || ""), results: [] };

    const results = [];
    for (const file of index.files || []) {
      const symbolNames = (file.symbols || []).map(symbol => symbol.name.toLowerCase());
      for (let lineIndex = 0; lineIndex < (file.lines || []).length; lineIndex += 1) {
        const raw = file.lines[lineIndex];
        const lower = raw.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (lower.includes(term)) score += 4;
          if (file.path.toLowerCase().includes(term)) score += 2;
          if (symbolNames.some(name => name.includes(term))) score += 1;
        }
        if (!score) continue;
        results.push({
          path: file.path,
          line: lineIndex + 1,
          snippet: raw.trim().slice(0, 500),
          score
        });
      }
    }

    results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    return {
      query: String(query || ""),
      builtAt: index.builtAt,
      results: results.slice(0, Math.max(1, Math.min(100, Number(limit) || 30)))
    };
  }

  async function repoMap(projectId) {
    const index = await readIndex(projectId);
    if (!index) throw new Error("Project index has not been built.");

    const directories = new Map();
    const symbols = [];
    for (const file of index.files || []) {
      const parts = file.path.split("/");
      const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      directories.set(directory, (directories.get(directory) || 0) + 1);
      for (const symbol of file.symbols || []) {
        if (symbols.length >= 1200) break;
        symbols.push(symbol);
      }
    }

    return {
      projectId,
      builtAt: index.builtAt,
      files: (index.files || []).map(file => ({
        path: file.path,
        size: file.size,
        language: file.language,
        symbolCount: file.symbols?.length || 0
      })),
      directories: [...directories.entries()]
        .map(([path, fileCount]) => ({ path, fileCount }))
        .sort((a, b) => a.path.localeCompare(b.path)),
      symbols
    };
  }

  return { rebuild, status, remove, search, repoMap };
}
