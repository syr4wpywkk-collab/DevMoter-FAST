import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { readHandle, withOpenFile } from "./safe-file.mjs";

// ASCII control characters (C0 range and DEL). Shared by every path/target
// check that must reject them after percent-decoding.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Undo nested percent-encoding (e.g. %252e) so path checks see what the
// upstream will. Returns the fully decoded string, or null when the input is
// malformed or still changes after 4 rounds.
export function fullyDecodePath(value) {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return null;
}

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
      value.includes(String.fromCharCode(0)) || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
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
  const match = raw.match(/^data:([^;,\s]+)?(?:;charset=[^;,\s]+)?;base64,([A-Za-z0-9+/]+={0,2})$/);
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


const STATIC_NON_FALLBACK_EXTENSIONS = new Set([".ico", ".map", ".txt", ".woff", ".woff2"]);

/**
 * Static serving and SPA fallback contract:
 * 1. Request paths are decoded via `fullyDecodePath` and checked to remain
 *    lexically inside `distDir` (no NUL/control chars, backslashes, or `..`).
 * 2. Both `distDir` and the target file are canonicalized with `realpath` to
 *    reject any symlink escaping `distReal`, and opened with `noFollow: true`.
 * 3. Missing files under `publicPaths`, `/assets/*`, or non-HTML static asset
 *    extensions return 404 instead of falling back to `dist/index.html`.
 *    Invalid or escaping paths also return 404 without SPA fallback.
 * 4. Missing genuine app routes fall back to `dist/index.html` (`200`,
 *    `text/html; charset=utf-8`), verified to remain inside `distReal`.
 */
export async function readDistStaticFile(
  distDir,
  rawUrl,
  { publicPaths = new Set(), mimeTypes = {}, allowSpaFallback = true } = {}
) {
  const rawPathname = String(rawUrl || "/").split("?", 1)[0] || "/";
  const decoded = fullyDecodePath(rawPathname);
  if (
    decoded === null ||
    !decoded.startsWith("/") ||
    decoded.includes("\\") ||
    CONTROL_CHARS.test(decoded)
  ) {
    return { status: 404, error: "Not found" };
  }

  const segments = decoded.split("/");
  if (segments.includes("..")) {
    return { status: 404, error: "Not found" };
  }
  const hasTrailingSlash = decoded !== "/" && decoded.endsWith("/");
  const cleanSegments = segments.filter(segment => segment && segment !== ".");
  const pathname = cleanSegments.length === 0 ? "/" : "/" + cleanSegments.join("/");
  const normalizedPathname = hasTrailingSlash ? pathname + "/" : pathname;

  const distRoot = resolve(distDir);
  let distReal;
  try {
    distReal = await realpath(distRoot);
  } catch {
    return { status: 404, error: "Not built yet. Run npm run build." };
  }

  const distPrefix = distRoot.endsWith(sep) ? distRoot : distRoot + sep;
  const distRealPrefix = distReal.endsWith(sep) ? distReal : distReal + sep;
  const relPath = normalizedPathname === "/" ? "index.html" : normalizedPathname.slice(1);
  const candidate = resolve(distRoot, relPath);
  if (!candidate.startsWith(distPrefix)) {
    return { status: 404, error: "Not found" };
  }

  if (!hasTrailingSlash) {
    let resolved = null;
    try {
      resolved = await realpath(candidate);
    } catch {
      try {
        const info = await lstat(candidate);
        if (info.isSymbolicLink()) return { status: 404, error: "Not found" };
      } catch {
        // File does not exist; proceed to SPA fallback decision below.
      }
    }

    if (resolved !== null) {
      if (!resolved.startsWith(distRealPrefix)) {
        return { status: 404, error: "Not found" };
      }
      try {
        const data = await withOpenFile(resolved, { noFollow: true }, async (handle, info) => {
          if (!info.isFile()) throw new Error("not file");
          return readHandle(handle);
        });
        const ext = extname(resolved).toLowerCase();
        return {
          status: 200,
          contentType: mimeTypes[ext] || "application/octet-stream",
          data
        };
      } catch {
        // Non-file inside dist; fall through to fallback policy.
      }
    }
  }

  const ext = extname(pathname).toLowerCase();
  const nonFallbackStatic =
    !allowSpaFallback ||
    publicPaths.has(pathname) ||
    pathname === "/assets" ||
    pathname.startsWith("/assets/") ||
    (ext !== "" && ext !== ".html" && (Object.hasOwn(mimeTypes, ext) || STATIC_NON_FALLBACK_EXTENSIONS.has(ext)));

  if (nonFallbackStatic) {
    return { status: 404, error: "Not found" };
  }

  const indexCandidate = resolve(distRoot, "index.html");
  try {
    const realIndex = await realpath(indexCandidate);
    if (!realIndex.startsWith(distRealPrefix)) {
      return { status: 404, error: "Not found" };
    }
    const data = await withOpenFile(realIndex, { noFollow: true }, async (handle, info) => {
      if (!info.isFile()) throw new Error("not file");
      return readHandle(handle);
    });
    return {
      status: 200,
      contentType: "text/html; charset=utf-8",
      data
    };
  } catch {
    return { status: 404, error: "Not built yet. Run npm run build." };
  }
}
