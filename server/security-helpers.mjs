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
  const path = normalize(String(value || "")).replace(/^[/\\]+/, "");
  if (!path || path === "." || path.startsWith("..") || isAbsolute(path)) throw new Error("Invalid Markdown path");
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
  const match = String(data || "").match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s);
  if (!match) throw new Error("Expected a base64 data URL");
  const buffer = Buffer.from(match[2], "base64");
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
