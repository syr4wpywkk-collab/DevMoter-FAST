import { createHash, randomBytes, randomUUID } from "node:crypto";
import { credentialsMatch } from "./auth.mjs";
import { OwnerSessionStore, OWNER_SESSION_DEFAULT_TTL_MS } from "./owner-session-store.mjs";
import { createOwnerIdentityStore } from "./owner-identity-store.mjs";

const COOKIE_NAME = "devmoter_session";
const FLOW_MAX_TTL_MS = 20 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 5_000;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const authError = (message, status = 400) => Object.assign(new Error(message), { status });
const firstHeader = (req, name) => String(req?.headers?.[name] || "").split(",", 1)[0].trim();

// Authentication cookies use a pinned origin when configured. Forwarded headers
// are deliberately not used to manufacture OAuth/owner host bindings.
function requestOrigin(req, publicOrigin = "") {
  const parsed = new URL(publicOrigin || `${req?.socket?.encrypted ? "https" : "http"}://${firstHeader(req, "host") || "localhost"}`);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw authError("Invalid authentication origin");
  return parsed.origin;
}
function requestHost(req, publicOrigin = "") {
  return new URL(requestOrigin(req, publicOrigin)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
}
function parseCookies(req) {
  const result = Object.create(null);
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    try { result[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* Invalid cookies never authenticate. */ }
  }
  return result;
}
function cookie(req, token, maxAgeSeconds, publicOrigin = "", name = COOKIE_NAME) {
  return [`${name}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict",
    requestOrigin(req, publicOrigin).startsWith("https://") ? "Secure" : "", `Max-Age=${maxAgeSeconds}`].filter(Boolean).join("; ");
}
function publicIdentity(identity) {
  if (!identity) return null;
  const result = {};
  for (const key of ["provider", "subject", "login", "email", "name", "avatarUrl", "issuer", "tenantId"]) result[key] = String(identity[key] || "").slice(0, 2048);
  return result;
}

export class ExternalAuth {
  constructor({ configDir, githubClientId = "", fetchImpl = globalThis.fetch, sessionTtlMs = OWNER_SESSION_DEFAULT_TTL_MS, publicOrigin = "" }) {
    this.configDir = configDir;
    this.githubClientId = String(githubClientId || "").trim();
    this.fetchImpl = fetchImpl;
    this.publicOrigin = publicOrigin;
    this.sessionTtlMs = sessionTtlMs;
    this.identities = createOwnerIdentityStore({ configDir });
    this.sessions = new OwnerSessionStore({ configDir, ttlMs: sessionTtlMs });
    this.githubFlows = new Map();
  }
  async load() { return this.identities.load(); }
  token(req) { return parseCookies(req)[COOKIE_NAME] || ""; }
  host(req) { return requestHost(req, this.publicOrigin); }
  cleanup() {
    for (const [id, flow] of this.githubFlows) if (flow.expiresAt <= Date.now()) this.githubFlows.delete(id);
  }
  async session(req) {
    const token = this.token(req); if (!token) return null;
    const session = await this.sessions.get(token, this.host(req));
    if (!session) return null;
    const state = await this.load();
    if (session.ownerId !== state.ownerId) return null;
    // Disconnect takes effect even if revocation persistence races or fails.
    if (["github", "google", "microsoft"].includes(session.provider)) {
      if (!await this.identities.findOwner(session.provider, session.identity.subject, { issuer: session.identity.issuer || "", tenantId: session.identity.tenantId || "" })) return null;
    }
    return session;
  }
  async sessionById(ownerId, id, host) {
    const state = await this.load(); if (state.ownerId !== ownerId) return null;
    const session = (await this.sessions.list({ ownerId })).find(s => s.id === id && s.host === host) || null;
    if (session && ["github", "google", "microsoft"].includes(session.provider) && !await this.identities.findOwner(session.provider, session.identity.subject, { issuer: session.identity.issuer || "", tenantId: session.identity.tenantId || "" })) return null;
    return session;
  }
  async createSession(req, identity, { ownerId, assurance = "external" } = {}) {
    const owner = ownerId || await this.identities.ensureOwner();
    const result = await this.sessions.create({ ownerId: owner, host: this.host(req), identity: publicIdentity(identity), assurance });
    // Rotation prevents retaining an old owner bearer after reauthentication.
    const old = this.token(req); if (old) await this.sessions.revoke(old);
    return { ok: true, identity: result.session.identity, session: result.session, cookie: cookie(req, result.token, Math.floor(this.sessionTtlMs / 1000), this.publicOrigin) };
  }
  async localLogin(req, input, expected) {
    const credentials = { username: String(input?.username || ""), password: String(input?.password || "") };
    if (!credentialsMatch(credentials, expected)) throw authError("Invalid local recovery credentials", 401);
    return this.createSession(req, { provider: "local", subject: credentials.username, login: credentials.username, name: "Local recovery" }, { assurance: "password" });
  }
  async passkeyLogin(req) {
    return this.createSession(req, { provider: "passkey", subject: await this.identities.ensureOwner(), name: "Passkey" }, { assurance: "passkey" });
  }
  async status(req) {
    const state = await this.load(); const session = await this.session(req);
    return { authenticated: Boolean(session), identity: session?.identity || null, localRecovery: true,
      github: { configured: Boolean(this.githubClientId), bound: Boolean(state.providers.github) } };
  }
  async fetchGithub(url, init) {
    try { return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(10_000) }); }
    catch { throw authError("GitHub login is temporarily unavailable", 502); }
  }
  async startGithub(req, { bootstrapAuthorized = false, intent = bootstrapAuthorized ? "link" : "login", ownerSession = null } = {}) {
    this.cleanup(); const state = await this.load();
    if (!this.githubClientId) throw authError("GitHub login is not available on this host", 503);
    if (!["login", "link"].includes(intent)) throw authError("Invalid sign-in intent");
    if (intent === "login" && !state.providers.github) throw authError("First GitHub account binding requires local recovery authentication", 403);
    if (intent === "link" && !bootstrapAuthorized && !ownerSession) throw authError("Owner authentication is required to connect GitHub", 403);
    if (this.githubFlows.size >= 128) throw authError("Too many sign-in attempts; try again shortly", 429);
    const response = await this.fetchGithub("https://github.com/login/device/code", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "DevMoter-FAST" },
      body: new URLSearchParams({ client_id: this.githubClientId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.device_code || !payload?.user_code || payload.verification_uri !== "https://github.com/login/device") throw authError("GitHub device authorization could not be started", 502);
    const id = randomUUID(); const binding = randomBytes(32).toString("base64url");
    const expiresIn = Math.max(1, Math.min(Number(payload.expires_in) || 900, FLOW_MAX_TTL_MS / 1000));
    const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, (Number(payload.interval) || 5) * 1000);
    const ownerId = intent === "link" ? await this.identities.ensureOwner() : state.ownerId;
    this.githubFlows.set(id, { id, intent, ownerId, sessionId: ownerSession?.id || null, host: this.host(req), bindingHash: sha256(binding),
      deviceCode: String(payload.device_code), expiresAt: Date.now() + expiresIn * 1000, intervalMs, nextPollAt: Date.now(), polling: false });
    return { flowId: id, userCode: String(payload.user_code), verificationUri: payload.verification_uri, expiresIn, interval: Math.ceil(intervalMs / 1000),
      flowCookie: cookie(req, binding, expiresIn, this.publicOrigin, `devmoter_github_${id}`) };
  }
  async pollGithub(req, flowId) {
    this.cleanup(); const id = String(flowId || ""); const flow = this.githubFlows.get(id);
    if (!flow) throw authError("GitHub login flow expired or is unknown");
    const binding = parseCookies(req)[`devmoter_github_${id}`];
    if (!binding || sha256(binding) !== flow.bindingHash || this.host(req) !== flow.host) throw authError("GitHub login browser changed", 403);
    if (flow.polling || Date.now() < flow.nextPollAt) return { status: "pending", retryAfterMs: Math.max(1000, flow.nextPollAt - Date.now()) };
    flow.polling = true; flow.nextPollAt = Date.now() + flow.intervalMs;
    try {
      const response = await this.fetchGithub("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "DevMoter-FAST" },
        body: new URLSearchParams({ client_id: this.githubClientId, device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" })
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.error === "authorization_pending") return { status: "pending", retryAfterMs: flow.intervalMs };
      if (payload.error === "slow_down") { flow.intervalMs += 5000; flow.nextPollAt = Date.now() + flow.intervalMs; return { status: "pending", retryAfterMs: flow.intervalMs }; }
      this.githubFlows.delete(id); // Every terminal result is one-use, including verification failures.
      if (payload.error) throw authError(payload.error === "access_denied" ? "GitHub login was denied" : "GitHub login failed", 401);
      const accessToken = String(payload.access_token || "");
      if (!response.ok || !accessToken) throw authError("GitHub login token exchange failed", 502);
      const identityResponse = await this.fetchGithub("https://api.github.com/user", { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}`, "user-agent": "DevMoter-FAST", "x-github-api-version": "2022-11-28" } });
      const value = await identityResponse.json().catch(() => ({}));
      if (!identityResponse.ok || !Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.login !== "string" || !value.login) throw authError("GitHub identity lookup failed", 502);
      const identity = { provider: "github", subject: String(value.id), login: value.login, name: String(value.name || value.login), avatarUrl: String(value.avatar_url || "") };
      if (flow.intent === "link") {
        if (flow.sessionId && !await this.sessionById(flow.ownerId, flow.sessionId, flow.host)) throw authError("Owner session expired before GitHub linking", 401);
        const current = await this.load();
        if (current.providers.github && current.providers.github.subject !== identity.subject) throw authError("This GitHub account is not the bound DevMoter owner", 403);
        await this.identities.bindProvider("github", identity, { ownerId: flow.ownerId });
      } else if (!await this.identities.findOwner("github", identity.subject)) throw authError("This GitHub account is not the bound DevMoter owner", 403);
      const session = await this.createSession(req, identity, { ownerId: flow.ownerId });
      return { status: "complete", identity: session.identity, cookie: [session.cookie, cookie(req, "", 0, this.publicOrigin, `devmoter_github_${id}`)] };
    } finally { flow.polling = false; }
  }
  async acceptOidc(req, result) {
    const { identity, intent, ownerId } = result;
    if (intent === "link") {
      const host = new URL(`http://${result.host}`).hostname.replace(/^\[|\]$/g, "");
      if (!result.sessionId || !await this.sessionById(ownerId, result.sessionId, host)) throw authError("Owner session expired before account linking", 401);
      await this.identities.bindProvider(identity.provider, identity, { ownerId });
    }
    const owner = await this.identities.findOwner(identity.provider, identity.subject, { issuer: identity.issuer || "", tenantId: identity.tenantId || "" });
    if (!owner) throw authError("This account is not connected to the DevMoter owner", 403);
    return this.createSession(req, identity, { ownerId: owner });
  }
  async logout(req) { await this.sessions.revoke(this.token(req)); return cookie(req, "", 0, this.publicOrigin); }
  async ownerScope(username) {
    const state = await this.load(); const ownerId = await this.identities.ensureOwner();
    return { ownerId: `owner:${ownerId}`, legacyOwnerIds: [`basic:${username}`, `owner:local:${username}`,
      ...Object.entries(state.providers).filter(([, identity]) => identity).map(([provider, identity]) => `owner:${provider}:${identity.subject}`)] };
  }
}
export const externalAuthInternals = { COOKIE_NAME, parseCookies, requestHost, requestOrigin };
