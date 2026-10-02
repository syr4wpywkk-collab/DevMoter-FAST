import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as oauth from "oauth4webapi";

const FLOW_TTL_MS = 5 * 60 * 1000;
const FLOW_LIMIT = 128;
const COOKIE_PREFIX = "devmoter_oauth_";
const MICROSOFT_HOST = "login.microsoftonline.com";
const GOOGLE_ISSUER = "https://accounts.google.com";

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest();
}

function equalSecret(left, right) {
  const a = hash(left);
  const b = hash(right);
  return timingSafeEqual(a, b);
}

function cookieMap(req) {
  const values = new Map();
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const splitAt = part.indexOf("=");
    if (splitAt < 0) continue;
    const name = part.slice(0, splitAt).trim();
    const value = part.slice(splitAt + 1).trim();
    if (!values.has(name)) values.set(name, value);
  }
  return values;
}

function first(value) {
  return (Array.isArray(value) ? value[0] : value || "").toString().split(",", 1)[0].trim();
}

function loopbackAddress(value) {
  const address = String(value || "").replace(/^::ffff:/, "").toLowerCase();
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
}

function validatePublicOrigin(value) {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("OIDC public origin is invalid", 500);
  }
  if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw fail("OIDC public origin must be an origin without a path", 500);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol === "http:" && !(["localhost", "127.0.0.1", "::1"].includes(host))) {
    throw fail("OIDC public origin must use HTTPS", 500);
  }
  return url.origin;
}

function trustedOrigin(req, configuredOrigin) {
  if (configuredOrigin) return configuredOrigin;

  const hostHeader = first(req?.headers?.host).toLowerCase();
  if (!hostHeader || hostHeader.includes("/") || hostHeader.includes("\\") || hostHeader.includes("@")) {
    throw fail("OIDC login origin is not configured for this host", 503);
  }
  let parsed;
  try {
    parsed = new URL(`http://${hostHeader}`);
  } catch {
    throw fail("OIDC login origin is not configured for this host", 503);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const socketIsLoopback = loopbackAddress(req?.socket?.remoteAddress);
  const hostIsLoopback = hostname === "localhost" || hostname === "::1" || hostname === "127.0.0.1" || hostname.startsWith("127.");
  if (!socketIsLoopback || !hostIsLoopback) throw fail("OIDC login origin is not configured for this host", 503);
  const protocol = req?.socket?.encrypted ? "https:" : "http:";
  if (protocol === "https:" && hostname === "localhost") return `https://${hostHeader}`;
  return `${protocol}//${hostHeader}`;
}

function cookieHeader(name, value, origin, maxAge) {
  const secure = origin.startsWith("https:");
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAge}`
  ].filter(Boolean).join("; ");
}

function clearCookieHeader(name, origin) {
  return cookieHeader(name, "", origin, 0);
}

function oneParam(params, key) {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : "";
}

function safeTenant(value) {
  const tenant = String(value || "common").trim().toLowerCase();
  if (["common", "organizations", "consumers"].includes(tenant)) return tenant;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenant)) return tenant;
  throw fail("Microsoft tenant setting is invalid", 500);
}

function decodeUntrustedTenant(idToken) {
  const pieces = String(idToken || "").split(".");
  if (pieces.length !== 3) throw fail("OIDC identity could not be verified", 401);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(pieces[1], "base64url").toString("utf8"));
  } catch {
    throw fail("OIDC identity could not be verified", 401);
  }
  const tid = String(payload?.tid || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tid)) {
    throw fail("Microsoft identity has no valid tenant", 401);
  }
  // The unverified claim only selects a tenant-specific discovery document on Microsoft's fixed
  // host. oauth4webapi subsequently validates the signature and exact issuer before we trust it.
  return tid;
}

function responseError(message, status = 400) {
  return fail(message, status);
}

export class OidcAuth {
  constructor({
    publicOrigin = "",
    googleClientId = "",
    googleClientSecret = "",
    microsoftClientId = "",
    microsoftClientSecret = "",
    microsoftTenant = "common",
    fetchImpl = globalThis.fetch,
    getOwnerSessionById = async () => null,
    now = Date.now
  } = {}) {
    this.publicOrigin = validatePublicOrigin(String(publicOrigin || "").trim());
    this.providers = {
      google: { clientId: String(googleClientId || "").trim(), clientSecret: String(googleClientSecret || "") },
      microsoft: {
        clientId: String(microsoftClientId || "").trim(),
        clientSecret: String(microsoftClientSecret || ""),
        tenant: safeTenant(microsoftTenant)
      }
    };
    this.fetchImpl = fetchImpl;
    this.getOwnerSessionById = getOwnerSessionById;
    this.now = now;
    this.flows = new Map();
  }

  isConfigured(provider) {
    const config = this.providers[provider];
    return Boolean(config?.clientId && config?.clientSecret);
  }

  cleanup() {
    const now = this.now();
    for (const [id, flow] of this.flows) {
      if (flow.expiresAt <= now) this.flows.delete(id);
    }
    while (this.flows.size > FLOW_LIMIT) {
      const oldest = this.flows.keys().next().value;
      this.flows.delete(oldest);
    }
  }

  async start(req, provider, { intent = "login", ownerSession = null } = {}) {
    this.cleanup();
    if (!Object.hasOwn(this.providers, provider)) throw responseError("Sign-in provider is unavailable", 404);
    if (!this.isConfigured(provider)) throw responseError(`${provider === "google" ? "Google" : "Microsoft"} login is not available on this host`, 503);
    if (intent !== "login" && intent !== "link") throw responseError("Invalid sign-in request", 400);

    let owner = null;
    if (intent === "link") {
      if (!ownerSession?.id || !ownerSession?.ownerId) throw responseError("Sign in before connecting an account", 401);
      owner = { id: String(ownerSession.id), ownerId: String(ownerSession.ownerId) };
    }

    const origin = trustedOrigin(req, this.publicOrigin);
    const redirectUri = `${origin}/api/auth/${provider}/callback`;
    const authorizationServer = await this.discover(provider, this.providers[provider].tenant);
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();
    const verifier = oauth.generateRandomCodeVerifier();
    const challenge = await oauth.calculatePKCECodeChallenge(verifier);
    const browserBinding = randomBytes(32).toString("base64url");
    const id = randomBytes(18).toString("base64url");
    const cookieName = `${COOKIE_PREFIX}${id}`;
    const params = new URLSearchParams({
      client_id: this.providers[provider].clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    if (provider === "microsoft") params.set("response_mode", "query");
    const authorizationUrl = new URL(authorizationServer.authorization_endpoint);
    for (const [key, value] of params) authorizationUrl.searchParams.set(key, value);

    const expiresAt = this.now() + FLOW_TTL_MS;
    this.flows.set(id, {
      provider,
      intent,
      owner,
      state,
      browserBindingHash: hash(browserBinding).toString("hex"),
      nonce,
      verifier,
      redirectUri,
      host: new URL(origin).host.toLowerCase(),
      tenant: this.providers[provider].tenant,
      expiresAt
    });
    this.cleanup();
    return {
      authorizationUrl: authorizationUrl.toString(),
      setCookie: cookieHeader(cookieName, browserBinding, origin, Math.ceil(FLOW_TTL_MS / 1000))
    };
  }

  async callback(req, provider, callbackUrl) {
    this.cleanup();
    const url = callbackUrl instanceof URL ? callbackUrl : new URL(String(callbackUrl), "http://localhost");
    const origin = trustedOrigin(req, this.publicOrigin);
    const params = url.searchParams;
    const state = oneParam(params, "state");
    const code = oneParam(params, "code");
    const flowEntry = [...this.flows.entries()].find(([, flow]) => flow.provider === provider && flow.state === state);
    if (!flowEntry) throw responseError("Sign-in request expired or could not be verified", 400);

    const [flowId, flow] = flowEntry;
    const cookieName = `${COOKIE_PREFIX}${flowId}`;
    const clearCookie = clearCookieHeader(cookieName, origin);
    const rejectFlow = (message, status = 400) => {
      const error = responseError(message, status);
      error.clearCookie = clearCookie;
      return error;
    };
    // Consume before network I/O so a concurrent/replayed callback cannot redeem the same code.
    this.flows.delete(flowId);
    const browserCookie = cookieMap(req).get(cookieName) || "";
    const callbackHost = new URL(origin).host.toLowerCase();
    if (flow.expiresAt <= this.now() || flow.host !== callbackHost || !equalSecret(flow.state, state) || !equalSecret(flow.browserBindingHash, hash(browserCookie).toString("hex"))) {
      throw rejectFlow("Sign-in request expired or could not be verified", 400);
    }
    if (oneParam(params, "error")) throw rejectFlow("Sign-in was not completed", 401);
    if (!code || url.pathname !== `/api/auth/${provider}/callback`) throw rejectFlow("Sign-in response is invalid", 400);
    const ownerSessionStillActive = async () => {
      if (flow.intent !== "link") return true;
      let active;
      try {
        active = await this.getOwnerSessionById(flow.owner.ownerId, flow.owner.id, flow.host);
      } catch {
        active = null;
      }
      return Boolean(active && String(active.ownerId) === flow.owner.ownerId && String(active.id) === flow.owner.id);
    };
    if (!await ownerSessionStillActive()) {
      throw rejectFlow("Your DevMoter session expired; sign in again before connecting an account", 401);
    }

    try {
      const config = this.providers[provider];
      const initialAs = await this.discover(provider, flow.tenant);
      const client = { client_id: config.clientId, token_endpoint_auth_method: "client_secret_post" };
      const callbackParameters = new URLSearchParams(params);
      const validatedParameters = oauth.validateAuthResponse(initialAs, client, callbackParameters, flow.state);
      // oauth4webapi performs the PKCE exchange and validates the token response. For Microsoft
      // common/organizations/consumers, the tenant-specific issuer is selected from tid below,
      // then oauth4webapi validates JWT signature, issuer, audience, time and nonce using that
      // tenant's metadata and keys.
      const tokenResponse = await oauth.authorizationCodeGrantRequest(
        initialAs,
        client,
        oauth.ClientSecretPost(config.clientSecret),
        validatedParameters,
        flow.redirectUri,
        flow.verifier,
        this.requestOptions()
      );

      let validationAs = initialAs;
      if (provider === "microsoft" && !isTenantGuid(flow.tenant)) {
        const raw = await tokenResponse.clone().json();
        const tenantId = decodeUntrustedTenant(raw?.id_token);
        validationAs = await this.discover("microsoft", tenantId);
      }
      const tokenSet = await oauth.processAuthorizationCodeResponse(validationAs, client, tokenResponse, {
        expectedNonce: flow.nonce,
        requireIdToken: true,
        ...this.requestOptions()
      });
      // Processing validates token-response claims (iss/aud/time/nonce); oauth4webapi keeps JWS
      // signature verification as an explicit operation so applications can choose when to pay
      // the JWKS fetch cost. Do not trust any ID-token claim until its signature is verified.
      await oauth.validateApplicationLevelSignature(validationAs, tokenResponse, this.requestOptions());
      const claims = oauth.getValidatedIdTokenClaims(tokenSet);
      if (!claims?.sub || !claims.iss) throw responseError("Sign-in identity could not be verified", 401);

      if (provider === "microsoft") {
        const tid = String(claims.tid || "").toLowerCase();
        if (!isTenantGuid(tid) || claims.iss !== `https://${MICROSOFT_HOST}/${tid}/v2.0`) {
          throw responseError("Microsoft identity could not be verified", 401);
        }
      }
      if (provider === "google" && claims.iss !== GOOGLE_ISSUER) {
        throw responseError("Google identity could not be verified", 401);
      }

      const email = String(claims.email || "");
      const identity = {
        provider,
        issuer: String(claims.iss),
        subject: String(claims.sub),
        login: String(claims.preferred_username || claims.email || claims.login || ""),
        email,
        emailVerified: claims.email_verified === true,
        name: String(claims.name || ""),
        avatarUrl: String(claims.picture || ""),
        ...(provider === "microsoft" ? { tenantId: String(claims.tid) } : {})
      };
      // Revalidate after network calls so a session revoked while the browser was at the provider
      // cannot be used to finish an account link.
      if (!await ownerSessionStillActive()) {
        throw rejectFlow("Your DevMoter session expired; sign in again before connecting an account", 401);
      }
      return {
        identity,
        intent: flow.intent,
        ...(flow.owner ? { ownerId: flow.owner.ownerId, sessionId: flow.owner.id, host: flow.host } : {}),
        clearCookie
      };
    } catch (error) {
      if (error?.status) {
        if (!error.clearCookie) error.clearCookie = clearCookie;
        throw error;
      }
      // Provider responses may include authorization codes, token bodies or secrets. Never surface
      // the underlying library/network exception through the route.
      throw rejectFlow("Sign-in could not be completed. Please try again.", 401);
    }
  }

  requestOptions() {
    return {
      [oauth.customFetch]: (url, options) => this.fetchImpl(url, options),
      signal: AbortSignal.timeout(10_000)
    };
  }

  async discover(provider, tenant = "common") {
    if (provider === "google") {
      const issuer = new URL(GOOGLE_ISSUER);
      const response = await oauth.discoveryRequest(issuer, this.requestOptions());
      return oauth.processDiscoveryResponse(issuer, response);
    }
    const safe = safeTenant(tenant);
    const url = new URL(`https://${MICROSOFT_HOST}/${safe}/v2.0/.well-known/openid-configuration`);
    const response = await this.fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    let payload;
    try {
      payload = await response.clone().json();
    } catch {
      throw responseError("Microsoft sign-in is temporarily unavailable", 503);
    }
    const expectedIssuer = isTenantGuid(safe)
      ? `https://${MICROSOFT_HOST}/${safe}/v2.0`
      : `https://${MICROSOFT_HOST}/{tenantid}/v2.0`;
    if (payload?.issuer !== expectedIssuer) throw responseError("Microsoft sign-in metadata is invalid", 503);
    // Microsoft's common-authority metadata intentionally publishes an issuer template. We
    // validate that exact template here, then use tenant-specific metadata to verify each ID token.
    return oauth.processDiscoveryResponse(new URL(expectedIssuer), response);
  }
}

function isTenantGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(value || "").toLowerCase());
}

export const oidcAuthInternals = { cookieMap, trustedOrigin, safeTenant, decodeUntrustedTenant };
