// Synthetic regression guard, not a general-purpose data-loss prevention engine.
// Decoding coverage is bounded; body size, leaf and nesting limits fail closed.
const TOKEN_HEADER = "x-devmoter-device-token";
const READ_RPC = new Set(["thread/list", "thread/read", "model/list"]);
const MAX_TEXT = 1024 * 1024;

function normalize(input) {
  let value = String(input ?? "");
  for (let i = 0; i < 4; i++) {
    let next = value.replace(/\\u([\da-f]{4})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/\\x([\da-f]{2})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&#(?:x([\da-f]+)|(\d+));?/gi, (raw, h, d) => {
        const code = parseInt(h || d, h ? 16 : 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : raw;
      });
    // Decode valid runs independently: a stray %ZZ must not mask adjacent data.
    next = next.replace(/(?:%[\da-f]{2})+/gi, run => {
      try { return decodeURIComponent(run); } catch { return run; }
    });
    if (next === value) break;
    value = next;
  }
  return value;
}
function variants(value) {
  const result = new Set([String(value), normalize(value), normalize(String(value).replace(/\+/g, " "))]);
  let frontier = [...result];
  for (let depth = 0; depth < 4; depth++) {
    const next = [];
    for (const text of frontier) for (const match of text.matchAll(/[A-Za-z0-9+/_-]{4,}={0,2}/g)) {
      if (match[0].length > 65536) throw new Error("base64 size exceeded");
      const decoded = normalize(Buffer.from(match[0], "base64url").toString("utf8"));
      if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded) && !result.has(decoded)) {
        result.add(decoded);
        next.push(decoded);
      }
    }
    if (result.size > 256) throw new Error("normalization variant limit exceeded");
    frontier = next;
    if (!frontier.length) break;
  }
  return [...result];
}
function contains(values, sentinel, fragments) {
  if (!sentinel) return false;
  const targets = new Set([normalize(sentinel)]);
  let frontier = [...targets];
  // Compare encoded sentinel forms as well: individually undecodable Base64
  // chunks can span values or requests without an unbounded combination search.
  for (let depth = 0; depth < 4; depth++) {
    const next = [];
    for (const target of frontier) for (const encoding of ["base64", "base64url"]) {
      const encoded = Buffer.from(target).toString(encoding);
      if (!targets.has(encoded)) { targets.add(encoded); next.push(encoded); }
    }
    frontier = next;
  }
  const groups = values.map(value => {
    if (String(value).length > MAX_TEXT) throw new Error("normalization size exceeded");
    return variants(value).map(item => item.toLowerCase());
  });
  let found = false;
  for (const form of targets) {
    const target = form.toLowerCase();
    const progress = new Set(fragments?.get(target) || [0]);
    for (const candidates of groups) {
      const offsets = [...progress];
      for (const candidate of candidates) {
        if (candidate.includes(target)) found = true;
        // Keep decoding alternatives and skip unrelated leaves/field names.
        if (!candidate || candidate.length > target.length) continue;
        for (const offset of offsets) if (target.startsWith(candidate, offset)) {
          const end = offset + candidate.length;
          if (end === target.length) found = true;
          else progress.add(end);
        }
      }
    }
    fragments?.set(target, progress);
  }
  return found;
}
function parsedValues(raw, contentType = "", depth = 0) {
  if (depth > 16) throw new Error("normalization depth exceeded");
  const text = String(raw ?? "");
  if (text.length > MAX_TEXT) throw new Error("normalization size exceeded");
  const values = [text];
  const leaves = [];
  function visit(value, level) {
    if (level > 16) throw new Error("normalization depth exceeded");
    if (value == null) return;
    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) { values.push(key); visit(child, level + 1); }
    } else {
      const scalar = String(value);
      values.push(scalar);
      if (typeof value === "string") {
        let nested;
        try { nested = JSON.parse(scalar); } catch {
          try { nested = JSON.parse(normalize(scalar)); } catch { /* Plain scalar. */ }
        }
        if (nested && typeof nested === "object") { visit(nested, level + 1); return; }
      }
      leaves.push(scalar);
    }
    if (values.length > 4096) throw new Error("normalization leaf limit exceeded");
  }
  let json;
  try { json = JSON.parse(text); } catch {
    try { json = JSON.parse(normalize(text)); } catch { /* Non-JSON forms are handled below. */ }
  }
  if (json !== undefined) visit(json, depth);
  if (/application\/x-www-form-urlencoded/i.test(contentType) || /^[^\r\n{}]*=/.test(text)) {
    const form = new URLSearchParams(text);
    const fields = [];
    for (const [key, value] of form) { values.push(key, value); fields.push(value); }
    leaves.push(...fields);
  }
  if (/multipart\/form-data/i.test(contentType)) {
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (!boundary) throw new Error("multipart boundary missing");
    for (const part of text.split(`--${boundary[1] || boundary[2]}`)) {
      const separator = part.indexOf("\r\n\r\n");
      if (separator < 0) continue;
      const header = part.slice(0, separator);
      const field = part.slice(separator + 4).replace(/\r\n$/, "");
      values.push(header, field);
      leaves.push(field);
    }
  }
  if (leaves.length > 4096) throw new Error("normalization leaf limit exceeded");
  return [...values, leaves.map(normalize).join("")];
}
function urlOf(record) { return new URL(record.url || record.path, "http://localhost"); }
function headersOf(record) { return Object.entries(record.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]); }
function methodOf(record) { return String(record.method || "GET").toUpperCase(); }
export function isExpectedGet(record, options = {}) {
  if (methodOf(record) !== "GET" || record.body) return false;
  const url = urlOf(record);
  if (url.origin !== options.origin) return false;
  const noQuery = new Set([
    "/api/health", "/api/projects", "/api/auth/status", "/api/terminal/sessions",
    "/api/agent-runs", "/api/agent-runs/events", "/api/session-control/state",
    "/api/opencode/pocket/providers", "/api/opencode/agent", "/api/opencode/session/active",
    "/api/opencode/event", "/api/codex/events", "/api/llm/providers", "/api/llm/presets",
  ]);
  if (noQuery.has(url.pathname)) return !url.search;
  if (url.pathname === "/api/opencode/session") {
    return url.search === "?limit=80&order=desc";
  }
  // IDs are fixture values, never an arbitrary path suffix or user-controlled ID.
  return !url.search && (options.allowedSessionIds || []).some(id =>
    ["", "/context", "/permission", "/question"].some(suffix =>
      url.pathname === `/api/opencode/session/${encodeURIComponent(id)}${suffix}`));
}
export function createRequestGuard(options = {}) {
  const fragments = new Map();
  let count = 0;
  return record => {
    if (++count > (options.maxRequests ?? 4096)) return ["request audit limit exceeded"];
    return inspectRequest(record, { ...options, fragments });
  };
}
export function isStaticRequest(record) {
  if (methodOf(record) !== "GET") return false;
  const url = urlOf(record);
  const type = record.resourceType;
  if (!type) return false;
  if (url.pathname === "/" && type === "document") {
    return [...url.searchParams.keys()].every(key => ["surface", "unifiedUI"].includes(key));
  }
  if (type && !["script", "stylesheet", "image", "font", "other"].includes(type)) return false;
  if (["/@vite/client", "/@vite/env", "/node_modules/vite/dist/client/env.mjs", "/manifest.webmanifest", "/src/control-center", "/node_modules/@xterm/xterm/css/xterm.css"].includes(url.pathname)) return true;
  return /^\/(?:src\/|node_modules\/\.vite\/deps\/|assets\/|fonts\/|images\/|favicon)/.test(url.pathname)
    && /\.(?:[cm]?[jt]sx?|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|avif)$/.test(url.pathname);
}
export function isExpectedUpload(record, options = {}) {
  const url = urlOf(record);
  if (!record.preparingAttachment || methodOf(record) !== "POST" || url.pathname !== "/api/codex/upload" || url.search) return false;
  if (options.origin && url.origin !== options.origin) return false;
  const contentType = headersOf(record).find(([key]) => key === "content-type")?.[1] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return false;
  let json;
  try { json = JSON.parse(record.body); } catch { return false; }
  if (!json || Object.keys(json).sort().join(",") !== "data,name,type") return false;
  return json.name === options.attachmentName && json.type === "text/plain"
    && json.data === `data:text/plain;base64,${Buffer.from(options.attachmentContent || "").toString("base64")}`
    // Require the actual frontend serialization too: no duplicate/hidden keys.
    && record.body === JSON.stringify({ name: json.name, type: json.type, data: json.data });
}
export function inspectRequest(record, options = {}) {
  try {
    const url = urlOf(record);
    const headers = headersOf(record);
    const contentType = headers.find(([key]) => key === "content-type")?.[1] || "";
    const body = parsedValues(record.body, contentType);
    const queryValues = [...url.searchParams.values()];
    const urlValues = [url.href, ...url.searchParams.keys(), ...queryValues, queryValues.map(normalize).join(""), ...url.pathname.split("/")];
    const ordinaryHeaders = headers.filter(([key, value]) => !(key === TOKEN_HEADER && value === options.credential));
    const headerValues = [...ordinaryHeaders.flatMap(([key, value]) => [key, value]), ordinaryHeaders.map(([, value]) => normalize(value)).join("")];
    const violations = [];
    if (url.origin !== options.origin) violations.push("external origin forbidden");
    if (contains([...urlValues, ...body, ...headerValues, ...ordinaryHeaders.map(([, value]) => value)], options.credential, options.fragments)) violations.push("credential leaked outside authentication header");
    if (headers.some(([key, value]) => key === TOKEN_HEADER && value !== options.credential)) violations.push("unexpected device credential header value");
    const expectedUpload = isExpectedUpload(record, options);
    const allValues = [...urlValues, ...body, ...headerValues, ...ordinaryHeaders.map(([, value]) => value)];
    if (contains(allValues, options.draft, options.fragments)) violations.push("draft content leaked");
    // The sole exception is the exact known synthetic attachment body. URL and
    // unrelated headers remain subject to attachment checks during preparation.
    const attachmentValues = expectedUpload ? [...urlValues, ...headerValues] : allValues;
    if ([options.attachmentName, options.attachmentContent, options.uploadId].some(value => contains(attachmentValues, value, options.fragments))) violations.push("attachment data leaked");
    if (url.pathname === "/api/codex/upload" && !expectedUpload) violations.push("unexpected attachment upload request");
    let safeRpc = false;
    if (url.pathname === "/api/codex/rpc" && !url.search && methodOf(record) === "POST") {
      try {
        const rpc = JSON.parse(record.body);
        const params = rpc.params || {};
        const allowedParams = rpc.method === "thread/read" ? ["threadId", "includeTurns"] : ["limit"];
        safeRpc = READ_RPC.has(rpc.method)
          && Object.keys(rpc).every(key => ["method", "params"].includes(key))
          && typeof params === "object" && !Array.isArray(params)
          && Object.keys(params).every(key => allowedParams.includes(key))
          && (params.limit === undefined || (Number.isInteger(params.limit) && params.limit > 0 && params.limit <= 100))
          && (rpc.method !== "thread/read" || (options.allowedThreadIds || []).includes(params.threadId))
          && (params.includeTurns === undefined || typeof params.includeTurns === "boolean")
          && record.body === JSON.stringify(rpc);
      } catch { /* Reject malformed RPC. */ }
    }
    if (!isStaticRequest(record) && !isExpectedGet(record, options) && !expectedUpload && !safeRpc) violations.push("unexpected non-static request");
    return violations;
  } catch {
    return ["request normalization failed closed"];
  }
}
