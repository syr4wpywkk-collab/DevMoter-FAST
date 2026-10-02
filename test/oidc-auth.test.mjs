import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OidcAuth } from "../server/oidc-auth.mjs";
import { ExternalAuth } from "../server/external-auth.mjs";

const TENANT = "11111111-2222-4333-8444-555555555555";
const GOOGLE_ISSUER = "https://accounts.google.com";
const MICROSOFT_ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const PUBLIC_ORIGIN = "https://login.dev.test";

function request(cookie = "", host = "login.dev.test") {
  return {
    headers: { host, ...(cookie ? { cookie } : {}) },
    socket: { remoteAddress: "127.0.0.1" }
  };
}

function cookiePair(value) {
  return value.split(";", 1)[0];
}

function signedIdToken(privateKey, { issuer, clientId, nonce, subject = "subject-42", extra = {} }) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: issuer,
    aud: clientId,
    sub: subject,
    exp: now + 300,
    iat: now,
    nonce,
    email: "owner@example.test",
    email_verified: true,
    name: "DevMoter Owner",
    picture: "https://images.example.test/owner.png",
    ...extra
  })).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function providerHarness({ provider = "google", claims = {}, tenant = "common", wrongSignature = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongSigningKey = wrongSignature ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey : privateKey;
  const publicJwk = publicKey.export({ format: "jwk" });
  Object.assign(publicJwk, { kid: "test-key", alg: "RS256", use: "sig" });
  const clientId = provider === "google" ? "google-client-id" : "microsoft-client-id";
  const clientSecret = "server-only-test-secret";
  const defaultTenant = /^[0-9a-f-]{36}$/i.test(tenant) ? tenant.toLowerCase() : TENANT;
  const issuer = provider === "google" ? GOOGLE_ISSUER : `https://login.microsoftonline.com/${defaultTenant}/v2.0`;
  const authEndpoint = provider === "google"
    ? "https://accounts.example.test/authorize"
    : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
  const tokenEndpoint = provider === "google"
    ? "https://accounts.example.test/token"
    : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const signingTenant = String(claims.tid || defaultTenant).toLowerCase();
  const jwksUri = provider === "google" ? "https://accounts.example.test/keys" : `https://login.microsoftonline.com/${signingTenant}/discovery/v2.0/keys`;
  const metadata = metadataIssuer => ({
    issuer: metadataIssuer,
    authorization_endpoint: authEndpoint,
    token_endpoint: tokenEndpoint,
    jwks_uri: jwksUri,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"]
  });
  const fetchCalls = [];
  const fetchImpl = async (resource, options = {}) => {
    const url = new URL(String(resource));
    fetchCalls.push({ url: url.toString(), options });
    if (provider === "google" && url.toString() === `${GOOGLE_ISSUER}/.well-known/openid-configuration`) {
      return json(metadata(GOOGLE_ISSUER));
    }
    if (provider === "microsoft" && url.hostname === "login.microsoftonline.com" && url.pathname.endsWith("/.well-known/openid-configuration")) {
      const selectedTenant = url.pathname.split("/")[1];
      const metadataValue = selectedTenant === "common" || selectedTenant === "organizations" || selectedTenant === "consumers"
        ? metadata("https://login.microsoftonline.com/{tenantid}/v2.0")
        : metadata(`https://login.microsoftonline.com/${selectedTenant}/v2.0`);
      return json(metadataValue);
    }
    if (url.toString() === tokenEndpoint) {
      const form = new URLSearchParams(options.body);
      const verifier = form.get("code_verifier");
      assert.ok(verifier, "PKCE verifier sent to token endpoint");
      assert.equal(form.get("redirect_uri"), `https://login.dev.test/api/auth/${provider}/callback`);
      const tokenNonce = claims.nonce || harnessNonce;
      const idToken = signedIdToken(wrongSigningKey, {
        issuer: claims.issuer || issuer,
        clientId: claims.aud || clientId,
        nonce: tokenNonce,
        subject: claims.subject || "subject-42",
        extra: {
          ...(provider === "microsoft" ? { tid: claims.tid || defaultTenant, preferred_username: "microsoft@example.test" } : {}),
          ...(claims.extra || {})
        }
      });
      return json({ access_token: "transient-access-token", token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    if (url.toString() === jwksUri) return json({ keys: [publicJwk] });
    throw new Error(`Unexpected mocked OAuth request ${url}`);
  };
  let harnessNonce = "";
  const auth = new OidcAuth({
    publicOrigin: "https://login.dev.test",
    ...(provider === "google"
      ? { googleClientId: clientId, googleClientSecret: clientSecret }
      : { microsoftClientId: clientId, microsoftClientSecret: clientSecret, microsoftTenant: tenant }),
    fetchImpl
  });
  return { auth, clientId, fetchCalls, setNonce(value) { harnessNonce = value; } };
}

async function begin(harness, provider = "google", options = {}) {
  const started = await harness.auth.start(request(), provider, options);
  const authorizationUrl = new URL(started.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  const nonce = authorizationUrl.searchParams.get("nonce");
  harness.setNonce(nonce);
  const cookieName = started.setCookie.split("=", 1)[0];
  const cookieValue = started.setCookie.split(";", 1)[0];
  return { started, authorizationUrl, state, nonce, cookieName, cookieValue };
}

async function callback(harness, provider, flow) {
  return harness.auth.callback(
    request(flow.cookieValue),
    provider,
    new URL(`/api/auth/${provider}/callback?state=${flow.state}&code=one-use-authorization-code`, PUBLIC_ORIGIN)
  );
}

function oidcOwnerResolver(external) {
  return (ownerId, id, host) => external.sessionById(ownerId, id, new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, ""));
}

test("Google start uses OIDC code flow, random state, nonce, S256 PKCE and browser binding", async () => {
  const harness = providerHarness();
  const flow = await begin(harness);
  const query = flow.authorizationUrl.searchParams;
  assert.equal(query.get("response_type"), "code");
  assert.equal(query.get("scope"), "openid profile email");
  assert.equal(query.get("code_challenge_method"), "S256");
  assert.match(query.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(flow.state && flow.nonce);
  assert.match(flow.started.setCookie, /HttpOnly/);
  assert.match(flow.started.setCookie, /SameSite=Lax/);
  assert.match(flow.started.setCookie, /Secure/);
  assert.equal(query.has("client_secret"), false);
  assert.equal(harness.auth.flows.size, 1);
});

test("Google callback validates a signed identity and consumes the one-time flow", async () => {
  const harness = providerHarness();
  const flow = await begin(harness);
  const result = await harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${encodeURIComponent(flow.state)}&code=authorization-code`, "https://login.dev.test"));
  assert.equal(result.intent, "login");
  assert.equal(result.identity.provider, "google");
  assert.equal(result.identity.subject, "subject-42");
  assert.equal(result.identity.issuer, GOOGLE_ISSUER);
  assert.equal(result.identity.email, "owner@example.test");
  assert.match(result.clearCookie, /Max-Age=0/);
  assert.equal(JSON.stringify(result).includes("transient-access-token"), false);
  await assert.rejects(() => harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=again`, "https://login.dev.test")));
});

test("state mismatch and missing browser binding reject OAuth callbacks before token exchange", async () => {
  const harness = providerHarness();
  const flow = await begin(harness);
  await assert.rejects(() => harness.auth.callback(request(flow.cookieValue), "google", new URL("/api/auth/google/callback?state=attacker&code=code", "https://login.dev.test")), error => error?.status === 400);
  await assert.rejects(() => harness.auth.callback(request(), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=code`, "https://login.dev.test")), error => error?.status === 400);
  assert.equal(harness.fetchCalls.filter(call => call.url.endsWith("/token")).length, 0);
});

test("OIDC library rejects an ID token with wrong audience", async () => {
  const harness = providerHarness({ claims: { aud: "another-client" } });
  const flow = await begin(harness);
  await assert.rejects(() => harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401 && !String(error.message).includes("another-client"));
});

test("OIDC library rejects ID tokens with the wrong nonce or expired timestamp", async () => {
  const wrongNonce = providerHarness({ claims: { nonce: "attacker-nonce" } });
  const nonceFlow = await begin(wrongNonce);
  await assert.rejects(() => wrongNonce.auth.callback(request(nonceFlow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${nonceFlow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401);

  const expired = providerHarness({ claims: { extra: { exp: Math.floor(Date.now() / 1000) - 60 } } });
  const expiredFlow = await begin(expired);
  await assert.rejects(() => expired.auth.callback(request(expiredFlow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${expiredFlow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401);
});

test("OIDC ID-token signature is verified against issuer JWKS before identity is returned", async () => {
  const harness = providerHarness({ wrongSignature: true });
  const flow = await begin(harness);
  await assert.rejects(() => harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=code`, PUBLIC_ORIGIN)), error => error?.status === 401);
  assert.ok(harness.fetchCalls.some(call => call.url.endsWith("/keys")), "issuer JWKS was fetched for signature verification");
});

test("link intent captures and revalidates the same live owner session", async () => {
  let active = { id: "session-1", ownerId: "owner-1" };
  const harness = providerHarness();
  harness.auth.getOwnerSessionById = async (ownerId, sessionId) => active?.ownerId === ownerId && active?.id === sessionId ? active : null;
  const flow = await begin(harness, "google", { intent: "link", ownerSession: { id: "session-1", ownerId: "owner-1" } });
  active = null;
  await assert.rejects(() => harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401);
  assert.equal(harness.fetchCalls.filter(call => call.url.endsWith("/token")).length, 0);
});

test("successful account link result is bound to its owner and session and checks revocation after exchange", async () => {
  let active = { id: "session-2", ownerId: "owner-2" };
  const harness = providerHarness();
  harness.auth.getOwnerSessionById = async (ownerId, sessionId) => active?.ownerId === ownerId && active?.id === sessionId ? active : null;
  const baseFetch = harness.auth.fetchImpl;
  harness.auth.fetchImpl = async (url, options) => {
    const response = await baseFetch(url, options);
    if (String(url).endsWith("/token")) active = null;
    return response;
  };
  const flow = await begin(harness, "google", { intent: "link", ownerSession: { id: "session-2", ownerId: "owner-2" } });
  await assert.rejects(() => harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401);
});

test("linked identity result carries the bound owner, session and host", async () => {
  const harness = providerHarness();
  harness.auth.getOwnerSessionById = async (ownerId, sessionId, host) => ({ id: sessionId, ownerId, host });
  const flow = await begin(harness, "google", { intent: "link", ownerSession: { id: "session-3", ownerId: "owner-3" } });
  const result = await harness.auth.callback(request(flow.cookieValue), "google", new URL(`/api/auth/google/callback?state=${flow.state}&code=code`, "https://login.dev.test"));
  assert.equal(result.intent, "link");
  assert.equal(result.ownerId, "owner-3");
  assert.equal(result.sessionId, "session-3");
  assert.equal(result.host, "login.dev.test");
});

test("unauthenticated link start is rejected", async () => {
  const harness = providerHarness();
  await assert.rejects(() => harness.auth.start(request(), "google", { intent: "link" }), error => error?.status === 401);
});

test("Microsoft common tenant uses tenant-specific issuer verification and returns verified tid", async () => {
  const harness = providerHarness({ provider: "microsoft", tenant: "common" });
  const flow = await begin(harness, "microsoft");
  assert.equal(flow.authorizationUrl.searchParams.get("scope"), "openid profile email");
  assert.equal(flow.authorizationUrl.searchParams.get("response_mode"), "query");
  const result = await harness.auth.callback(request(flow.cookieValue), "microsoft", new URL(`/api/auth/microsoft/callback?state=${flow.state}&code=code`, "https://login.dev.test"));
  assert.equal(result.identity.provider, "microsoft");
  assert.equal(result.identity.issuer, MICROSOFT_ISSUER);
  assert.equal(result.identity.tenantId, TENANT);
  assert.equal(result.identity.subject, "subject-42");
  assert.ok(harness.fetchCalls.some(call => call.url.includes(`/${TENANT}/v2.0/.well-known/openid-configuration`)));
});

test("Microsoft invalid tid and wrong issuer are rejected", async () => {
  const invalidTid = providerHarness({ provider: "microsoft", tenant: "common", claims: { tid: "not-a-tenant" } });
  const flow = await begin(invalidTid, "microsoft");
  await assert.rejects(() => invalidTid.auth.callback(request(flow.cookieValue), "microsoft", new URL(`/api/auth/microsoft/callback?state=${flow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401);

  const wrongIssuer = providerHarness({ provider: "microsoft", tenant: "common", claims: { issuer: "https://attacker.example/tenant/v2.0" } });
  const wrongFlow = await begin(wrongIssuer, "microsoft");
  await assert.rejects(() => wrongIssuer.auth.callback(request(wrongFlow.cookieValue), "microsoft", new URL(`/api/auth/microsoft/callback?state=${wrongFlow.state}&code=code`, "https://login.dev.test")), error => error?.status === 401);
});

test("external hosts require explicit public origin and forwarded headers are ignored", async () => {
  const auth = new OidcAuth({ googleClientId: "id", googleClientSecret: "secret" });
  await assert.rejects(() => auth.start({ headers: { host: "evil.test", "x-forwarded-host": "login.dev.test", "x-forwarded-proto": "https" }, socket: { remoteAddress: "10.0.0.5" } }, "google"), error => error?.status === 503);
});

test("flow registry expires stale flows and enforces a bounded size", async () => {
  let now = 1000;
  const harness = providerHarness();
  harness.auth.now = () => now;
  const first = await begin(harness);
  const flow = harness.auth.flows.get(first.cookieName.slice("devmoter_oauth_".length));
  assert.equal(flow.expiresAt, now + 5 * 60 * 1000);
  now += 5 * 60 * 1000;
  harness.auth.cleanup();
  assert.equal(harness.auth.flows.size, 0);
  for (let index = 0; index < 129; index += 1) {
    await harness.auth.start(request(), "google");
  }
  assert.equal(harness.auth.flows.size, 128);
});

test("Google and Microsoft OIDC link and login use one persistent DevMoter owner session", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-oidc-owner-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const recovery = { username: "devmoter", password: "correct-horse-battery-staple" };
  const ownerAuth = new ExternalAuth({ configDir, publicOrigin: PUBLIC_ORIGIN });
  const local = await ownerAuth.localLogin(request(), recovery, recovery);
  const ownerId = local.session.ownerId;
  const ownerSession = { id: local.session.id, ownerId };
  let finalOwnerCookie = "";
  let previousMicrosoftHarness = null;
  let previousMicrosoftLogin = null;

  for (const provider of ["google", "microsoft"]) {
    const harness = providerHarness({ provider, tenant: "common" });
    harness.auth.getOwnerSessionById = oidcOwnerResolver(ownerAuth);
    assert.ok(await ownerAuth.sessionById(ownerId, ownerSession.id, "login.dev.test"));
    const linkFlow = await begin(harness, provider, { intent: "link", ownerSession });
    const verifiedLink = await callback(harness, provider, linkFlow);
    const linked = await ownerAuth.acceptOidc(request(), verifiedLink);
    assert.equal(linked.session.ownerId, ownerId, `${provider} link retained the local DevMoter owner`);
    assert.equal(linked.identity.provider, provider);

    const registry = await ownerAuth.load();
    assert.ok(registry.providers[provider], `${provider} identity was linked`);
    assert.equal(registry.providers[provider].subject, "subject-42");

    // The same verified provider identity can log in without being implicitly linked again.
    const loginFlow = await begin(harness, provider);
    const verifiedLogin = await callback(harness, provider, loginFlow);
    const signedIn = await ownerAuth.acceptOidc(request(), verifiedLogin);
    finalOwnerCookie = cookiePair(signedIn.cookie);
    if (provider === "microsoft") {
      previousMicrosoftHarness = harness;
      previousMicrosoftLogin = verifiedLogin;
    }
    assert.equal(signedIn.session.ownerId, ownerId, `${provider} login resolved to the same owner`);
    assert.equal(signedIn.identity.provider, provider);

    // A newly-created auth service instance must recover the same shared cookie session.
    const restarted = new ExternalAuth({ configDir, publicOrigin: PUBLIC_ORIGIN });
    const persistent = await restarted.session(request(cookiePair(signedIn.cookie)));
    assert.equal(persistent?.ownerId, ownerId);
    assert.equal(persistent?.identity?.provider, provider);
    assert.equal(persistent?.identity?.issuer, verifiedLogin.identity.issuer);
  }

  // Disconnecting invalidates existing provider sessions. Relinking the same `sub` under another
  // Microsoft tenant binds a distinct issuer namespace, so the old tenant cannot reuse the login.
  await ownerAuth.identities.unbindProvider("microsoft", { ownerId });
  await ownerAuth.sessions.revokeProvider(ownerId, "microsoft");
  const afterDisconnect = new ExternalAuth({ configDir, publicOrigin: PUBLIC_ORIGIN });
  assert.equal(await afterDisconnect.session(request(finalOwnerCookie)), null);
  await assert.rejects(() => ownerAuth.acceptOidc(request(), previousMicrosoftLogin), error => error?.status === 403);

  const nextTenant = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const nextMicrosoft = providerHarness({ provider: "microsoft", tenant: nextTenant });
  nextMicrosoft.auth.getOwnerSessionById = oidcOwnerResolver(ownerAuth);
  const relinkFlow = await begin(nextMicrosoft, "microsoft", { intent: "link", ownerSession });
  const verifiedRelink = await callback(nextMicrosoft, "microsoft", relinkFlow);
  assert.equal(verifiedRelink.identity.subject, previousMicrosoftLogin.identity.subject);
  assert.notEqual(verifiedRelink.identity.issuer, previousMicrosoftLogin.identity.issuer);
  const relinked = await ownerAuth.acceptOidc(request(), verifiedRelink);
  finalOwnerCookie = cookiePair(relinked.cookie);
  assert.equal(relinked.session.ownerId, ownerId);
  assert.equal(relinked.identity.tenantId, nextTenant);
  await assert.rejects(() => ownerAuth.acceptOidc(request(), previousMicrosoftLogin), error => error?.status === 403);

  const relinkedSession = await new ExternalAuth({ configDir, publicOrigin: PUBLIC_ORIGIN }).session(request(finalOwnerCookie));
  assert.equal(relinkedSession?.ownerId, ownerId);
  assert.equal(relinkedSession?.identity?.issuer, `https://login.microsoftonline.com/${nextTenant}/v2.0`);
  assert.equal(relinkedSession?.identity?.tenantId, nextTenant);

  const identityFile = await readFile(join(configDir, "auth-identities.json"), "utf8");
  const sessionFile = await readFile(join(configDir, "auth-sessions.json"), "utf8");
  const rawOwnerToken = decodeURIComponent(finalOwnerCookie.slice(finalOwnerCookie.indexOf("=") + 1));
  assert.equal(sessionFile.includes(rawOwnerToken), false);
  for (const stored of [identityFile, sessionFile]) {
    assert.equal(stored.includes("transient-access-token"), false);
    assert.equal(stored.includes("server-only-test-secret"), false);
    assert.equal(stored.includes("one-use-authorization-code"), false);
  }

  const restarted = new ExternalAuth({ configDir, publicOrigin: PUBLIC_ORIGIN });
  const logoutHeader = await restarted.logout(request(finalOwnerCookie));
  assert.match(logoutHeader, /Max-Age=0/);
  assert.equal(await restarted.session(request(finalOwnerCookie)), null);
});

test("unbound and wrong provider identities cannot log in or become linked implicitly", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-oidc-reject-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const recovery = { username: "devmoter", password: "another-correct-horse-battery" };
  const ownerAuth = new ExternalAuth({ configDir, publicOrigin: PUBLIC_ORIGIN });
  const local = await ownerAuth.localLogin(request(), recovery, recovery);
  const ownerSession = { id: local.session.id, ownerId: local.session.ownerId };
  const harness = providerHarness({ provider: "google", claims: { subject: "unbound-subject" } });
  harness.auth.getOwnerSessionById = oidcOwnerResolver(ownerAuth);

  // A login ceremony may produce a real, verified OIDC identity, but only link intent plus an
  // active owner session can add it to the registry.
  const unboundFlow = await begin(harness, "google");
  const unboundResult = await callback(harness, "google", unboundFlow);
  await assert.rejects(() => ownerAuth.acceptOidc(request(), unboundResult), error => error?.status === 403);
  assert.equal((await ownerAuth.load()).providers.google, null);

  const linkedFlow = await begin(harness, "google", { intent: "link", ownerSession });
  const linkedResult = await callback(harness, "google", linkedFlow);
  await ownerAuth.acceptOidc(request(cookiePair(local.cookie)), linkedResult);

  const wrongIdentity = providerHarness({ provider: "google", claims: { subject: "somebody-else" } });
  const wrongFlow = await begin(wrongIdentity, "google");
  const wrongResult = await callback(wrongIdentity, "google", wrongFlow);
  await assert.rejects(() => ownerAuth.acceptOidc(request(), wrongResult), error => error?.status === 403);
  assert.equal((await ownerAuth.load()).providers.google.subject, "unbound-subject");
});
