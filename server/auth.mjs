import { createHash, timingSafeEqual } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

function firstHeaderValue(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.split(",", 1)[0].trim() : "";
}

export function assertAuthPassword(value) {
  const password = String(value || "");
  if (password.length < 16) {
    throw new Error("DEVMOTER_AUTH_PASSWORD must be set to at least 16 characters");
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
  const userMatches = timingSafeEqual(
    digest(credentials.username),
    digest(expected.username)
  );
  const passwordMatches = timingSafeEqual(
    digest(credentials.password),
    digest(expected.password)
  );
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

export function expectedRequestOrigin(req, publicOrigin = "") {
  if (publicOrigin) {
    try {
      return new URL(publicOrigin).origin;
    } catch {
      return null;
    }
  }

  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const host = forwardedHost || firstHeaderValue(req.headers.host);
  if (!host) return null;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

export function isMutationMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}

export function mutationOriginMatches(req, publicOrigin = "") {
  if (!isMutationMethod(req.method)) return true;

  const origin = firstHeaderValue(req.headers.origin);
  const expected = expectedRequestOrigin(req, publicOrigin);
  if (!origin || origin === "null" || !expected) return false;

  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

export function requireSameOriginMutation(req, res, publicOrigin = "") {
  if (mutationOriginMatches(req, publicOrigin)) return true;

  res.writeHead(403, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify({ error: "Cross-origin mutation rejected" }));
  return false;
}
