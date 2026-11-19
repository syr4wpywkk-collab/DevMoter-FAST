// Read-only diagnosis of the public Origin configuration (#477).
//
// Mutations are accepted only when the browser's Origin equals the expected
// origin: DEVMOTER_PUBLIC_ORIGIN when set, otherwise the one derived from
// X-Forwarded-Proto / X-Forwarded-Host / Host. A reverse proxy that changes
// the visible origin without matching configuration makes every write fail
// with "Cross-origin mutation rejected". This explains which part disagrees.
//
// The result holds status codes and booleans only: neither the configured
// origin, the browser origin, nor any header value is echoed back, and
// nothing is changed.

import { expectedRequestOrigin } from "./auth.mjs";

export const CLIENT_ORIGIN_HEADER = "x-devmoter-client-origin";

function firstValue(value) {
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

function parseOrigin(value) {
  const text = firstValue(value);
  if (!text || text.length > 512) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function effectivePort(url) {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function differingParts(left, right) {
  const parts = [];
  if (left.protocol !== right.protocol) parts.push("scheme");
  if (left.hostname !== right.hostname) parts.push("host");
  if (effectivePort(left) !== effectivePort(right)) parts.push("port");
  return parts;
}

/**
 * status:
 *   "ok"                    browser origin equals the expected origin
 *   "invalid"               DEVMOTER_PUBLIC_ORIGIN is set but is not an http(s) origin
 *   "configured-mismatch"   DEVMOTER_PUBLIC_ORIGIN differs from the origin the browser uses
 *   "proxy-mismatch"        not configured, and the proxy's forwarded headers disagree with the browser
 *   "unverified"            the browser origin was not supplied, so nothing could be compared
 */
export function diagnosePublicOrigin(req, publicOrigin = "") {
  const configured = Boolean(String(publicOrigin || "").trim());
  const headers = req?.headers || {};
  const forwarded = Boolean(firstValue(headers["x-forwarded-host"]) || firstValue(headers["x-forwarded-proto"]));
  const result = { configured, forwardedHeaders: forwarded, status: "unverified", differs: [], writesBlocked: false };

  const configuredUrl = configured ? parseOrigin(publicOrigin) : null;
  if (configured && !configuredUrl) return { ...result, status: "invalid", writesBlocked: true };

  const expected = req ? parseOrigin(expectedRequestOrigin(req, publicOrigin) || "") : null;
  const client = parseOrigin(headers[CLIENT_ORIGIN_HEADER]);
  if (!expected || !client) return result;

  const differs = differingParts(expected, client);
  if (!differs.length) return { ...result, status: "ok" };
  return {
    ...result,
    status: configured ? "configured-mismatch" : "proxy-mismatch",
    differs,
    writesBlocked: true
  };
}
