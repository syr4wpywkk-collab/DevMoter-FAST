import { basename, dirname, isAbsolute, join, relative, resolve, normalize } from "node:path";
import { randomUUID } from "node:crypto";

export function isInsideHome(homeDir, path) {
  const rel = relative(resolve(homeDir), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function normalizeNewProjectPath(input, homeDir) {
  if (!input) throw new Error("Project path is required");
  const candidate = resolve(String(input).replace(/^~(?=\/|$)/, homeDir));
  if (!isInsideHome(homeDir, candidate)) throw new Error("Projects must be inside your home directory");
  if (candidate === resolve(homeDir)) throw new Error("Choose a project folder, not your whole home directory");
  return candidate;
}

export function assertSafeMarkdownRelativePath(value) {
  // Reject ambiguous input *before* path normalization. Stripping leading
  // separators would silently turn an absolute path into a relative one.
  if (typeof value !== "string" || !value || value.includes("\\") ||
      value.includes("\\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error("Invalid Markdown path");
  }
  const path = normalize(value);
  if (!path || path === "." || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("Invalid Markdown path");
  }
  if (!path.toLowerCase().endsWith(".md")) throw new Error("Only .md files can be edited");
  return path;
}

export function sanitizeUploadName(value) {
  return String(value || "attachment")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "attachment";
}

export function createUploadPath(uploadDir, originalName) {
  const safeName = sanitizeUploadName(originalName);
  return { path: join(uploadDir, `${Date.now()}-${randomUUID()}-${safeName}`), safeName };
}

export function decodeUploadDataUrl(data, maxBytes = 15 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid upload size limit");
  const raw = String(data || "");
  // Bound the encoded input before both the regex and Buffer.from. Without
  // this guard an oversized upload could allocate a much larger decoded Buffer.
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (raw.length > maxEncodedLength + 512) throw new Error("File is larger than 15MB");
  const match = raw.match(/^data:([^;,\\s]+)?(?:;charset=[^;,\\s]+)?;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("Expected a base64 data URL");
  const encoded = match[2];
  if (encoded.length > maxEncodedLength) throw new Error("File is larger than 15MB");
  if (encoded.length % 4 !== 0) throw new Error("Expected a base64 data URL");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length > maxBytes) throw new Error("File is larger than 15MB");
  return { mime: match[1] || "application/octet-stream", buffer };
}

export const CODEX_RPC_ALLOWLIST = new Set([
  "thread/list", "thread/read", "thread/start", "thread/resume", "thread/fork", "thread/loaded/list",
  "thread/settings/update", "turn/start", "turn/steer", "turn/interrupt", "model/list", "account/rateLimits/read",
  "plugin/list", "plugin/installed", "mcpServerStatus/list", "skills/list"
]);

export function isAllowedCodexRpc(method) {
  return typeof method === "string" && CODEX_RPC_ALLOWLIST.has(method);
}
