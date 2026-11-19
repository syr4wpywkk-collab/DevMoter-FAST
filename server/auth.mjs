import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const ALLOW_INSECURE_HTTP_ENV = "DEVMOTER_ALLOW_INSECURE_HTTP";

export function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const raw = address.trim().toLowerCase();
  if (!raw) return false;
  const bracketed = raw.startsWith("[") && raw.endsWith("]");
  const value = bracketed ? raw.slice(1, -1) : raw;
  if (!bracketed && isIP(value) === 4) {
    return value.startsWith("127.");
  }
  if (isIP(value) === 6) {
    try {
      const canonical = new URL(`http://[${value}]`).hostname;
      return canonical === "[::1]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(canonical);
    } catch {
      return false;
    }
  }
  return false;
}

export function isLoopbackBindHost(host) {
  if (typeof host !== "string") return false;
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "localhost") return true;
  return isLoopbackAddress(normalized);
}

/**
 * Validate whether binding plain HTTP to `host` is safe to start without
 * an explicit operator opt-in. `DEVMOTER_PUBLIC_ORIGIN` is never treated as
 * proof of TLS termination because DevMoter itself still speaks plain HTTP.
 */
export function evaluateHttpBindSafety(host, env = process.env) {
  const normalizedHost = typeof host === "string" ? host.trim() : "";
  if (isLoopbackBindHost(normalizedHost)) {
    return { ok: true, loopback: true, warning: null, error: null };
  }

  const displayHost = normalizedHost.replace(/[\u0000-\u001f\u007f]/g, "") || "(empty)";
  const allowInsecureHttp = env?.[ALLOW_INSECURE_HTTP_ENV] === "1";
  const warning =
    `[SECURITY WARNING] DevMoter FAST is configured to bind plain HTTP to non-loopback host "${displayHost}"` +
    `${allowInsecureHttp ? ` (${ALLOW_INSECURE_HTTP_ENV}=1)` : ""}. ` +
    `HTTP Basic auth credentials will traverse the network unencrypted over plain HTTP unless TLS ` +
    `or an encrypted tunnel protects every hop (DEVMOTER_PUBLIC_ORIGIN does not enable or verify TLS).`;

  if (!allowInsecureHttp) {
    const error =
      `Refusing to start plain HTTP server on non-loopback host "${displayHost}": ` +
      `HTTP Basic auth credentials will traverse the network unencrypted over plain HTTP without TLS. ` +
      `Keep POCKET_HOST bound to a loopback address (such as 127.0.0.1) behind Tailscale Serve or a local TLS reverse proxy, ` +
      `or set ${ALLOW_INSECURE_HTTP_ENV}=1 if an external TLS/encrypted tunnel boundary is verified ` +
      `(DEVMOTER_PUBLIC_ORIGIN alone does not satisfy this check).`;
    return { ok: false, loopback: false, warning, error };
  }

  return { ok: true, loopback: false, warning, error: null };
}

export function assertSafeHttpBind(host, env = process.env, { warn = console.warn } = {}) {
  const result = evaluateHttpBindSafety(host, env);
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (result.warning) warn(result.warning);
  return result;
}

// Credentials are compared, never stored, so no hashing is involved: both
// sides are copied into fixed-size buffers and compared in constant time.
// Anything longer than the cap never matches.
export const MAX_CREDENTIAL_BYTES = 1024;

function constantTimeEqual(actual, expected) {
  const left = Buffer.from(String(actual ?? ""), "utf8");
  const right = Buffer.from(String(expected ?? ""), "utf8");
  const a = Buffer.alloc(MAX_CREDENTIAL_BYTES);
  const b = Buffer.alloc(MAX_CREDENTIAL_BYTES);
  left.copy(a, 0, 0, MAX_CREDENTIAL_BYTES);
  right.copy(b, 0, 0, MAX_CREDENTIAL_BYTES);
  const sameBytes = timingSafeEqual(a, b);
  const sameLength = left.length === right.length;
  const withinCap = left.length <= MAX_CREDENTIAL_BYTES && right.length <= MAX_CREDENTIAL_BYTES;
  return sameBytes && sameLength && withinCap;
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.split(",", 1)[0].trim() : "";
}

function lastHeaderValue(value) {
  const raw = Array.isArray(value) ? value.at(-1) : value;
  return typeof raw === "string" ? raw.split(",").at(-1).trim() : "";
}

export function expandIpv6(ip) {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = Math.max(0, 8 - h.length - t.length);
  const groups = [...h, ...Array(fill).fill("0"), ...t];
  return groups.map((g) => g.padStart(4, "0"));
}

function normalizeProxyIp(address) {
  const ip = String(address ?? "").trim().toLowerCase();
  if (ip.startsWith("::ffff:") && ip.includes(".")) return ip.slice(7);
  if (ip.includes(":")) {
    try { return expandIpv6(ip).join(":"); } catch { return ip; }
  }
  return ip || "unknown";
}

export function parseTrustedProxies(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createTrustedProxyMatcher(trustedProxies = []) {
  // Trust is an exact peer identity check; never reuse the /64 rate-limit bucket.
  const list = Array.isArray(trustedProxies) ? trustedProxies : parseTrustedProxies(trustedProxies);
  const trusted = new Set(list.map(normalizeProxyIp).filter((ip) => ip !== "unknown"));
  return function isTrustedProxy(req) {
    if (trusted.size === 0) return false;
    return trusted.has(normalizeProxyIp(req?.socket?.remoteAddress));
  };
}

export function isTrustedProxyRequest(req, trustedProxies = []) {
  const list = Array.isArray(trustedProxies) ? trustedProxies : parseTrustedProxies(trustedProxies);
  if (list.length === 0) return false;
  const peer = normalizeProxyIp(req?.socket?.remoteAddress);
  if (peer === "unknown") return false;
  return list.some((proxy) => normalizeProxyIp(proxy) === peer);
}

function parseConfiguredOrigin(publicOrigin) {
  const raw = String(publicOrigin || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseAuthorityOrigin(protocol, rawHost) {
  const proto = String(protocol || "").trim().toLowerCase();
  if (proto !== "http" && proto !== "https") return null;

  const trimmed = String(rawHost || "").trim();
  const host = trimmed === "::1" ? "[::1]" : trimmed;
  if (!host || host.endsWith(":") || /[\u0000-\u001f\u007f\s,/\\@?#%]/.test(host)) return null;

  try {
    const parsed = new URL(`${proto}://${host}`);
    if (
      parsed.protocol !== `${proto}:` ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function assertAuthPassword(value) {
  const password = String(value || "");
  if (password.length < 16) {
    throw new Error("DEVMOTER_AUTH_PASSWORD must be set to at least 16 characters");
  }
  if (Buffer.byteLength(password, "utf8") > MAX_CREDENTIAL_BYTES) {
    throw new Error(`DEVMOTER_AUTH_PASSWORD must be at most ${MAX_CREDENTIAL_BYTES} bytes`);
  }
  return password;
}

export function parseBasicAuthorization(value) {
  const raw = firstHeaderValue(value);
  const match = raw.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;

  let decoded;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return null;

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

export function credentialsMatch(credentials, expected) {
  if (!credentials) return false;
  const userMatches = constantTimeEqual(credentials.username, expected.username);
  const passwordMatches = constantTimeEqual(credentials.password, expected.password);
  return userMatches && passwordMatches;
}

export function authorizeBasicRequest(req, res, expected) {
  const credentials = parseBasicAuthorization(req.headers.authorization);
  if (credentialsMatch(credentials, expected)) return true;

  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "www-authenticate": 'Basic realm="DevMoter FAST", charset="UTF-8"'
  });
  res.end(JSON.stringify({ error: "Authentication required" }));
  return false;
}

export function expectedRequestOrigin(req, publicOrigin = "", options = {}) {
  if (publicOrigin) {
    return parseConfiguredOrigin(publicOrigin);
  }

  const trustedProxies = options?.trustedProxies ?? parseTrustedProxies(process.env.DEVMOTER_TRUST_PROXY);
  const fallbackProto = req?.socket?.encrypted ? "https" : "http";
  const requestHost = firstHeaderValue(req?.headers?.host);

  if (isTrustedProxyRequest(req, trustedProxies)) {
    const forwardedProto = lastHeaderValue(req?.headers?.["x-forwarded-proto"]).toLowerCase();
    const forwardedHost = lastHeaderValue(req?.headers?.["x-forwarded-host"]);
    if (forwardedProto || forwardedHost) {
      const forwardedOrigin = parseAuthorityOrigin(
        forwardedProto || fallbackProto,
        forwardedHost || requestHost
      );
      if (forwardedOrigin) return forwardedOrigin;
    }
  }

  return parseAuthorityOrigin(fallbackProto, requestHost);
}

export function resolveLocalAddress(req, { publicOrigin = "", trustedProxies } = {}) {
  const configured = parseConfiguredOrigin(publicOrigin);
  if (configured) return configured;

  const resolved = expectedRequestOrigin(req, "", { trustedProxies });
  if (resolved) return resolved;

  const fallbackProto = req?.socket?.encrypted ? "https" : "http";
  return `${fallbackProto}://localhost`;
}

export function isMutationMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}

export function mutationOriginMatches(req, publicOrigin = "", options = {}) {
  if (!isMutationMethod(req.method)) return true;

  const origin = firstHeaderValue(req.headers.origin);
  const expected = expectedRequestOrigin(req, publicOrigin, options);
  if (!origin || origin === "null" || !expected) return false;

  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

export function requireSameOriginMutation(req, res, publicOrigin = "", options = {}) {
  if (mutationOriginMatches(req, publicOrigin, options)) return true;

  res.writeHead(403, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify({ error: "Cross-origin mutation rejected" }));
  return false;
}
