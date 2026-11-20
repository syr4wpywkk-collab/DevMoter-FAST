// style-src keeps 'unsafe-inline' for the login page's <style> block and
// element style attributes; data:/blob: cover attachment and file previews.
const CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'"
].join("; ");

export const STATIC_SECURITY_HEADERS = Object.freeze({
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), geolocation=(), payment=(), usb=(), serial=(), hid=()"
});

export const PROXY_SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer"
});

export function staticSecurityHeaders(contentType) {
  return {
    ...STATIC_SECURITY_HEADERS,
    "content-type": contentType
  };
}

const ALLOWED_PROXY_RESPONSE_HEADERS = new Set(["retry-after"]);

/** Restrict proxied Content-Type to JSON, SSE, or plain text; downgrade anything else. */
export function sanitizeProxyContentType(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const [rawType, ...rawParams] = raw.split(";");
  const mediaType = rawType.trim().toLowerCase();
  const allowed =
    mediaType === "application/json" ||
    /^application\/[a-z0-9._-]+\+json$/.test(mediaType) ||
    mediaType === "text/event-stream" ||
    mediaType === "text/plain";
  if (!allowed) return "application/octet-stream";

  let charset = null;
  for (const part of rawParams) {
    const match = part.trim().match(/^charset\s*=\s*"?([A-Za-z0-9._-]+)"?$/i);
    if (match) {
      charset = match[1].toLowerCase();
      break;
    }
  }
  return charset ? `${mediaType}; charset=${charset}` : mediaType;
}

export function isTextualProxyMediaType(rawValue) {
  const mediaType = String(rawValue || "").split(";", 1)[0].trim().toLowerCase();
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType.endsWith("+json") ||
    mediaType === "application/xml" ||
    mediaType.endsWith("+xml") ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-ndjson"
  );
}

/**
 * Build safe response headers for OpenCode proxy responses using an explicit
 * header allowlist, restricted Content-Type, and mandatory security headers.
 */
export function buildProxyResponseHeaders(upstreamHeaders, status, redact = value => value) {
  const getHeader = name => {
    if (!upstreamHeaders) return null;
    if (typeof upstreamHeaders.get === "function") return upstreamHeaders.get(name);
    const value = upstreamHeaders[name];
    return value == null ? null : String(value);
  };

  const headers = { ...PROXY_SECURITY_HEADERS };
  for (const key of ALLOWED_PROXY_RESPONSE_HEADERS) {
    const value = getHeader(key);
    if (value !== null && value !== "" && !/[\r\n]/.test(value)) {
      headers[key] = redact(value);
    }
  }

  const rawContentType = getHeader("content-type") || "";
  const sanitizedContentType = sanitizeProxyContentType(rawContentType);
  if (sanitizedContentType) {
    const mediaType = sanitizedContentType.split(";", 1)[0];
    const containsSecret = redact(rawContentType) !== rawContentType || redact(sanitizedContentType) !== sanitizedContentType;
    headers["content-type"] = containsSecret
      ? (mediaType.endsWith("+json") ? "application/json" : mediaType)
      : sanitizedContentType;
  } else if (status !== 204 && status !== 304) {
    headers["content-type"] = "application/octet-stream";
  }

  const mediaType = String(headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  headers["cache-control"] = mediaType === "text/event-stream"
    ? "no-cache, no-transform"
    : "no-store";

  return { headers, rawContentType, mediaType };
}
