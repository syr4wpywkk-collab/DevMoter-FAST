import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { credentialsMatch } from "./auth.mjs";

const COOKIE_NAME = "devmoter_session";
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FLOW_MAX_TTL_MS = 20 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 5_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function firstHeader(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").split(",")[0].trim();
  return String(value || "").split(",")[0].trim();
}

function requestOrigin(req) {
  const proto = firstHeader(req, "x-forwarded-proto") || (req?.socket?.encrypted ? "https" : "http");
  const host = firstHeader(req, "x-forwarded-host") || firstHeader(req, "host") || "localhost";
  return new URL(`${proto}://${host}`).origin;
}

function requestHost(req) {
  return new URL(requestOrigin(req)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function cookie(req, token, maxAgeSeconds) {
  const secure = requestOrigin(req).startsWith("https://");
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean).join("; ");
}

function authError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function publicIdentity(identity) {
  if (!identity) return null;
  return {
    provider: String(identity.provider || ""),
    subject: String(identity.subject || ""),
    login: String(identity.login || ""),
    name: String(identity.name || ""),
    avatarUrl: String(identity.avatarUrl || "")
  };
}

export class ExternalAuth {
  constructor({
    configDir,
    githubClientId = "",
    fetchImpl = globalThis.fetch,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS
  }) {
    this.configDir = configDir;
    this.file = join(configDir, "auth-identities.json");
    this.githubClientId = String(githubClientId || "").trim();
    this.fetchImpl = fetchImpl;
    this.sessionTtlMs = sessionTtlMs;
    this.state = null;
    this.sessions = new Map();
    this.githubFlows = new Map();
  }

  async load() {
    if (this.state) return this.state;
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });

    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw authError("Auth identity registry is unreadable or malformed; refusing to fail open", 500);
      }
      this.state = { version: 1, github: null };
      return this.state;
    }

    const github = parsed?.github;
    if (
      Number(parsed?.version) !== 1 ||
      !(
        github === null ||
        (
          github &&
          String(github.subject || "") &&
          String(github.login || "") &&
          Number.isFinite(Number(github.boundAt))
        )
      )
    ) {
      throw authError("Auth identity registry is invalid; refusing to fail open", 500);
    }

    this.state = {
      version: 1,
      github: github
        ? {
            subject: String(github.subject),
            login: String(github.login),
            name: String(github.name || ""),
            avatarUrl: String(github.avatarUrl || ""),
            boundAt: Number(github.boundAt)
          }
        : null
    };
    return this.state;
  }

  async save() {
    const state = await this.load();
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const temp = this.file + "." + process.pid + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
    for (const [key, flow] of this.githubFlows) {
      if (flow.expiresAt <= now) this.githubFlows.delete(key);
    }
  }

  async session(req) {
    this.cleanup();
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    const session = this.sessions.get(sha256(token));
    if (!session || session.expiresAt <= Date.now() || session.host !== requestHost(req)) return null;
    return {
      id: session.id,
      identity: publicIdentity(session.identity),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };
  }

  createSession(req, identity) {
    this.cleanup();
    const token = randomBytes(32).toString("base64url");
    const record = {
      id: randomUUID(),
      host: requestHost(req),
      identity: publicIdentity(identity),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTtlMs
    };
    this.sessions.set(sha256(token), record);
    return {
      ok: true,
      identity: record.identity,
      cookie: cookie(req, token, Math.floor(this.sessionTtlMs / 1000))
    };
  }

  async localLogin(req, input, expected) {
    const credentials = {
      username: String(input?.username || ""),
      password: String(input?.password || "")
    };
    if (!credentialsMatch(credentials, expected)) {
      throw authError("Invalid local recovery credentials", 401);
    }
    return this.createSession(req, {
      provider: "local",
      subject: credentials.username,
      login: credentials.username,
      name: "Local recovery"
    });
  }

  async status(req) {
    const state = await this.load();
    const session = await this.session(req);
    return {
      authenticated: Boolean(session),
      identity: session?.identity || null,
      localRecovery: true,
      github: {
        configured: Boolean(this.githubClientId),
        bound: Boolean(state.github)
      }
    };
  }

  async startGithub(req, { bootstrapAuthorized = false } = {}) {
    const state = await this.load();
    if (!this.githubClientId) {
      throw authError("GitHub login is not configured. Set DEVMOTER_GITHUB_CLIENT_ID.", 503);
    }
    if (!state.github && !bootstrapAuthorized) {
      throw authError("First GitHub account binding requires local recovery authentication", 403);
    }

    const response = await this.fetchImpl("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "DevMoter-FAST"
      },
      body: new URLSearchParams({ client_id: this.githubClientId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.device_code || !payload?.user_code || !payload?.verification_uri) {
      throw authError("GitHub device authorization could not be started", 502);
    }

    const id = randomUUID();
    const expiresIn = Math.max(1, Math.min(Number(payload.expires_in) || 900, FLOW_MAX_TTL_MS / 1000));
    const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, (Number(payload.interval) || 5) * 1000);
    this.githubFlows.set(id, {
      id,
      deviceCode: String(payload.device_code),
      userCode: String(payload.user_code),
      verificationUri: String(payload.verification_uri),
      bootstrapBinding: !state.github,
      expiresAt: Date.now() + expiresIn * 1000,
      intervalMs,
      nextPollAt: Date.now()
    });

    return {
      flowId: id,
      userCode: String(payload.user_code),
      verificationUri: String(payload.verification_uri),
      expiresIn,
      interval: Math.ceil(intervalMs / 1000)
    };
  }

  async pollGithub(req, flowId) {
    this.cleanup();
    const id = String(flowId || "");
    const flow = this.githubFlows.get(id);
    if (!flow) throw authError("GitHub login flow expired or is unknown", 400);
    if (flow.expiresAt <= Date.now()) {
      this.githubFlows.delete(id);
      throw authError("GitHub login flow expired", 400);
    }

    const now = Date.now();
    if (now < flow.nextPollAt) {
      return {
        status: "pending",
        retryAfterMs: flow.nextPollAt - now
      };
    }
    flow.nextPollAt = now + flow.intervalMs;

    const response = await this.fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "DevMoter-FAST"
      },
      body: new URLSearchParams({
        client_id: this.githubClientId,
        device_code: flow.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    const tokenPayload = await response.json().catch(() => ({}));

    if (tokenPayload?.error === "authorization_pending") {
      return { status: "pending", retryAfterMs: flow.intervalMs };
    }
    if (tokenPayload?.error === "slow_down") {
      flow.intervalMs += 5_000;
      flow.nextPollAt = Date.now() + flow.intervalMs;
      return { status: "pending", retryAfterMs: flow.intervalMs };
    }
    if (tokenPayload?.error) {
      this.githubFlows.delete(id);
      const denied = tokenPayload.error === "access_denied";
      throw authError(denied ? "GitHub login was denied" : "GitHub login failed", denied ? 401 : 400);
    }

    const accessToken = String(tokenPayload?.access_token || "");
    if (!response.ok || !accessToken) {
      throw authError("GitHub login token exchange failed", 502);
    }

    // The OAuth access token is intentionally kept only in this stack frame.
    // It is used once to resolve the GitHub identity and is never persisted or returned.
    const identityResponse = await this.fetchImpl("https://api.github.com/user", {
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": `Bearer ${accessToken}`,
        "user-agent": "DevMoter-FAST",
        "x-github-api-version": "2022-11-28"
      }
    });
    const identityPayload = await identityResponse.json().catch(() => ({}));
    if (!identityResponse.ok || !identityPayload?.id || !identityPayload?.login) {
      throw authError("GitHub identity lookup failed", 502);
    }

    const identity = {
      provider: "github",
      subject: String(identityPayload.id),
      login: String(identityPayload.login),
      name: String(identityPayload.name || identityPayload.login),
      avatarUrl: String(identityPayload.avatar_url || "")
    };

    const state = await this.load();
    if (state.github && state.github.subject !== identity.subject) {
      this.githubFlows.delete(id);
      throw authError("This GitHub account is not the bound DevMoter owner", 403);
    }
    if (!state.github) {
      if (!flow.bootstrapBinding) {
        this.githubFlows.delete(id);
        throw authError("GitHub owner binding requires local recovery authentication", 403);
      }
      state.github = {
        subject: identity.subject,
        login: identity.login,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        boundAt: Date.now()
      };
      await this.save();
    }

    this.githubFlows.delete(id);
    const session = this.createSession(req, identity);
    return {
      status: "complete",
      identity: session.identity,
      cookie: session.cookie
    };
  }

  async logout(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) this.sessions.delete(sha256(token));
    return cookie(req, "", 0);
  }
}

export const externalAuthInternals = {
  COOKIE_NAME,
  parseCookies,
  requestHost,
  requestOrigin
};
