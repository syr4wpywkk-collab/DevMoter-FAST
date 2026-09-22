import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_FILE_LIMIT = 100;
const MAX_FILE_LIMIT = 200;
const MAX_DIFF_BYTES = 256 * 1024;
const MAX_DIFF_LINES = 2400;

async function runGit(cwd, args, { allowFailure = false, maxBuffer = 4 * 1024 * 1024 } = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer,
      windowsHide: true
    });
    return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    if (allowFailure) {
      return {
        ok: false,
        stdout: typeof error?.stdout === "string" ? error.stdout : "",
        stderr: typeof error?.stderr === "string" ? error.stderr : "",
        code: error?.code ?? null
      };
    }
    throw error;
  }
}

function splitZero(value) {
  return String(value || "").split("\0").filter(Boolean);
}

function safeRelativePath(root, input) {
  const raw = String(input || "").replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || isAbsolute(raw)) throw new Error("Invalid Git path");
  const target = resolve(root, raw);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Git path must stay inside the active project");
  }
  return rel.split("\\").join("/");
}

async function isGitRepository(projectPath) {
  const probe = await runGit(projectPath, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  return probe.ok && probe.stdout.trim() === "true";
}

async function branchName(projectPath) {
  const symbolic = await runGit(projectPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  if (symbolic.ok && symbolic.stdout.trim()) return symbolic.stdout.trim();
  const detached = await runGit(projectPath, ["rev-parse", "--short", "HEAD"], { allowFailure: true });
  return detached.ok && detached.stdout.trim() ? "detached@" + detached.stdout.trim() : "unknown";
}

async function upstreamCounts(projectPath) {
  const result = await runGit(projectPath, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { allowFailure: true });
  if (!result.ok) return { ahead: null, behind: null, upstream: null };
  const parts = result.stdout.trim().split(/\s+/).map(Number);
  const upstream = await runGit(projectPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFailure: true });
  return {
    ahead: Number.isFinite(parts[0]) ? parts[0] : 0,
    behind: Number.isFinite(parts[1]) ? parts[1] : 0,
    upstream: upstream.ok ? upstream.stdout.trim() || null : null
  };
}

async function nameSet(projectPath, args) {
  const result = await runGit(projectPath, args, { allowFailure: true });
  return new Set(result.ok ? splitZero(result.stdout) : []);
}

function statusFor(path, sets) {
  const labels = [];
  if (sets.conflicts.has(path)) labels.push("conflict");
  if (sets.staged.has(path)) labels.push("staged");
  if (sets.modified.has(path)) labels.push("modified");
  if (sets.untracked.has(path)) labels.push("untracked");
  return labels;
}

async function collectSets(projectPath) {
  const [staged, modified, untracked, conflicts] = await Promise.all([
    nameSet(projectPath, ["diff", "--cached", "--relative", "--name-only", "-z", "--", "."]),
    nameSet(projectPath, ["diff", "--relative", "--name-only", "-z", "--", "."]),
    nameSet(projectPath, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]),
    nameSet(projectPath, ["diff", "--relative", "--name-only", "--diff-filter=U", "-z", "--", "."])
  ]);
  return { staged, modified, untracked, conflicts };
}

async function numstatMap(projectPath) {
  const result = await runGit(projectPath, ["diff", "--relative", "--numstat", "HEAD", "--", "."], { allowFailure: true });
  const map = new Map();
  if (!result.ok) return map;
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const first = line.indexOf("\t");
    const second = first === -1 ? -1 : line.indexOf("\t", first + 1);
    if (first === -1 || second === -1) continue;
    const addRaw = line.slice(0, first);
    const delRaw = line.slice(first + 1, second);
    const path = line.slice(second + 1);
    map.set(path, {
      additions: addRaw === "-" ? null : Number(addRaw),
      deletions: delRaw === "-" ? null : Number(delRaw),
      binary: addRaw === "-" || delRaw === "-"
    });
  }
  return map;
}

export async function getGitStatus(projectPath) {
  const root = resolve(projectPath);
  if (!await isGitRepository(root)) {
    return {
      isGit: false,
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      staged: 0,
      modified: 0,
      untracked: 0,
      conflicts: 0
    };
  }

  const [branch, upstream, sets] = await Promise.all([
    branchName(root),
    upstreamCounts(root),
    collectSets(root)
  ]);

  return {
    isGit: true,
    branch,
    upstream: upstream.upstream,
    ahead: upstream.ahead,
    behind: upstream.behind,
    staged: sets.staged.size,
    modified: sets.modified.size,
    untracked: sets.untracked.size,
    conflicts: sets.conflicts.size
  };
}

export async function listChangedFiles(projectPath, { limit = DEFAULT_FILE_LIMIT, offset = 0 } = {}) {
  const root = resolve(projectPath);
  if (!await isGitRepository(root)) {
    return { isGit: false, files: [], total: 0, limit: 0, offset: 0, hasMore: false };
  }

  const boundedLimit = Math.max(1, Math.min(MAX_FILE_LIMIT, Number(limit) || DEFAULT_FILE_LIMIT));
  const boundedOffset = Math.max(0, Number(offset) || 0);
  const [sets, stats] = await Promise.all([collectSets(root), numstatMap(root)]);
  const paths = [...new Set([
    ...sets.conflicts,
    ...sets.staged,
    ...sets.modified,
    ...sets.untracked
  ])].sort((a, b) => a.localeCompare(b));

  const files = paths.slice(boundedOffset, boundedOffset + boundedLimit).map(path => {
    const stat = stats.get(path) || {};
    return {
      path,
      status: statusFor(path, sets),
      additions: stat.additions ?? null,
      deletions: stat.deletions ?? null,
      binary: Boolean(stat.binary)
    };
  });

  return {
    isGit: true,
    files,
    total: paths.length,
    limit: boundedLimit,
    offset: boundedOffset,
    hasMore: boundedOffset + files.length < paths.length
  };
}

function boundDiff(text) {
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = text.split("\n");
  const tooManyLines = lines.length > MAX_DIFF_LINES;
  const tooManyBytes = bytes > MAX_DIFF_BYTES;
  if (!tooManyLines && !tooManyBytes) return { diff: text, truncated: false };

  let output = "";
  let lineCount = 0;
  for (const line of lines) {
    const candidate = output + line + "\n";
    if (lineCount >= MAX_DIFF_LINES || Buffer.byteLength(candidate, "utf8") > MAX_DIFF_BYTES) break;
    output = candidate;
    lineCount += 1;
  }
  output += "\n[DevMoter: diff truncated for safe mobile rendering]\n";
  return { diff: output, truncated: true };
}

async function untrackedDiff(projectPath, path) {
  const root = await realpath(projectPath);
  const full = resolve(root, path);
  let content;
  try {
    const lexical = relative(root, full);
    if (!lexical || lexical.startsWith("..") || isAbsolute(lexical)) {
      throw new Error("Untracked path escapes the active project");
    }
    const entry = await lstat(full);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("Untracked path is not a regular file");
    }
    const actual = await realpath(full);
    const actualRelative = relative(root, actual);
    if (!actualRelative || actualRelative.startsWith("..") || isAbsolute(actualRelative)) {
      throw new Error("Untracked file escapes the active project");
    }
    const info = await stat(actual);
    if (!info.isFile() || info.size > MAX_DIFF_BYTES) {
      return "diff --git a/" + path + " b/" + path + "\nnew file mode 100644\nUntracked file is too large or not a regular file\n";
    }
    content = await readFile(actual, "utf8");
  } catch {
    return "diff --git a/" + path + " b/" + path + "\nnew file mode 100644\nBinary or unreadable untracked file\n";
  }
  if (content.includes("\0")) {
    return "diff --git a/" + path + " b/" + path + "\nnew file mode 100644\nBinary file\n";
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const body = lines.map(line => "+" + line).join("\n");
  return [
    "diff --git a/" + path + " b/" + path,
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/" + path,
    "@@ -0,0 +1," + lines.length + " @@",
    body
  ].join("\n") + "\n";
}

export async function getFileDiff(projectPath, inputPath, { scope = "all" } = {}) {
  const root = resolve(projectPath);
  if (!await isGitRepository(root)) {
    return { isGit: false, path: null, diff: "", truncated: false, scope };
  }

  const path = safeRelativePath(root, inputPath);
  const sets = await collectSets(root);
  let text = "";

  if (sets.untracked.has(path)) {
    text = await untrackedDiff(root, path);
  } else {
    const args = ["diff", "--no-ext-diff", "--no-color", "--relative", "--unified=3"];
    if (scope === "staged") args.push("--cached");
    else args.push("HEAD");
    args.push("--", path);
    const result = await runGit(root, args, { allowFailure: true, maxBuffer: 8 * 1024 * 1024 });
    text = result.stdout || "";
  }

  const bounded = boundDiff(text);
  return {
    isGit: true,
    path,
    scope: scope === "staged" ? "staged" : "all",
    diff: bounded.diff,
    truncated: bounded.truncated,
    status: statusFor(path, sets)
  };
}
