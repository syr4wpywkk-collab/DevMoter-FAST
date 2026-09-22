import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = "devmoter_passkey";
const SUPPORTED_ALGORITHMS = [-7, -257];

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromB64url(value) {
  return new Uint8Array(Buffer.from(String(value || ""), "base64url"));
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function firstHeader(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || "").split(",")[0].trim();
  return String(value || "").split(",")[0].trim();
}

function requestOrigin(req) {
  const direct = firstHeader(req, "origin");
  if (direct) {
    const parsed = new URL(direct);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported passkey origin");
    return parsed.origin;
  }

  const proto = firstHeader(req, "x-forwarded-proto") || "http";
  const host = firstHeader(req, "x-forwarded-host") || firstHeader(req, "host") || "localhost";
  const parsed = new URL(`${proto}://${host}`);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported passkey origin");
  return parsed.origin;
}

function requestHost(req) {
  return new URL(requestOrigin(req)).hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopback(req) {
  const address = String(req?.socket?.remoteAddress || "");
  const host = requestHost(req);
  const localAddress =
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return localAddress && localHost && !firstHeader(req, "x-forwarded-for");
}

function explicitBootstrapEnabled() {
  return process.env.DEVMOTER_PASSKEY_BOOTSTRAP === "1";
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

function sessionCookie(req, token, maxAgeSeconds) {
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

function validCredential(input) {
  if (!input || typeof input !== "object") return false;
  if (!String(input.id || "") || !String(input.rpId || "") || !String(input.publicKey || "")) return false;
  if (!Number.isFinite(Number(input.counter)) || Number(input.counter) < 0) return false;
  return true;
}

export class PasskeyAuth {
  constructor({ configDir }) {
    this.file = join(configDir, "passkeys.json");
    this.configDir = configDir;
    this.state = null;
    this.challenges = new Map();
    this.sessions = new Map();
  }

  async load() {
    if (this.state) return this.state;
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });

    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new Error("Passkey registry is unreadable or malformed; refusing to fail open");
      }
      this.state = {
        version: 2,
        userId: b64url(randomBytes(32)),
        credentials: []
      };
      await this.save();
      return this.state;
    }

    if (
      Number(parsed?.version) !== 2 ||
      !String(parsed?.userId || "") ||
      !Array.isArray(parsed?.credentials) ||
      !parsed.credentials.every(validCredential)
    ) {
      throw new Error("Passkey registry is invalid; refusing to fail open");
    }

    this.state = {
      version: 2,
      userId: String(parsed.userId),
      credentials: parsed.credentials.map(item => ({
        id: String(item.id),
        rpId: String(item.rpId),
        publicKey: String(item.publicKey),
        counter: Number(item.counter),
        transports: Array.isArray(item.transports) ? item.transports.map(String).slice(0, 12) : [],
        deviceType: String(item.deviceType || ""),
        backedUp: Boolean(item.backedUp),
        label: String(item.label || "Passkey").slice(0, 80),
        createdAt: Number(item.createdAt || 0),
        lastUsedAt: Number(item.lastUsedAt || 0)
      }))
    };
    return this.state;
  }

  async save() {
    if (!this.state) throw new Error("Passkey registry is not loaded");
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const temp = this.file + "." + process.pid + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.challenges) {
      if (value.expiresAt <= now) this.challenges.delete(key);
    }
    for (const [key, value] of this.sessions) {
      if (value.expiresAt <= now) this.sessions.delete(key);
    }
  }

  async credentialsFor(req) {
    const state = await this.load();
    const rpId = requestHost(req);
    return state.credentials.filter(item => item.rpId === rpId);
  }

  async session(req) {
    this.cleanup();
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    const session = this.sessions.get(sha256(Buffer.from(token)));
    if (!session || session.expiresAt <= Date.now() || session.rpId !== requestHost(req)) return null;
    return session;
  }

  async status(req) {
    const state = await this.load();
    const credentials = await this.credentialsFor(req);
    const session = await this.session(req);
    return {
      enabled: credentials.length > 0,
      authenticated: Boolean(session),
      credentialCount: credentials.length,
      anyCredentialCount: state.credentials.length,
      rpId: requestHost(req),
      origin: requestOrigin(req),
      canRegister:
        Boolean(session) ||
        (credentials.length === 0 && (isLoopback(req) || explicitBootstrapEnabled())),
      bootstrapEnabled: explicitBootstrapEnabled(),
      recovery:
        "Use another registered passkey for this host. For a new/recovery origin, temporarily enable DEVMOTER_PASSKEY_BOOTSTRAP=1, register the passkey, then disable it."
    };
  }

  rememberChallenge(kind, req, value) {
    this.cleanup();
    const id = randomUUID();
    this.challenges.set(id, {
      id,
      kind,
      value,
      rpId: requestHost(req),
      origin: requestOrigin(req),
      expiresAt: Date.now() + CHALLENGE_TTL_MS
    });
    return id;
  }

  takeChallenge(id, kind, req) {
    this.cleanup();
    const key = String(id || "");
    const record = this.challenges.get(key);
    this.challenges.delete(key);
    if (!record || record.kind !== kind || record.expiresAt <= Date.now()) {
      throw new Error("Passkey challenge expired or invalid");
    }
    if (record.rpId !== requestHost(req) || record.origin !== requestOrigin(req)) {
      throw new Error("Passkey origin changed during the ceremony");
    }
    return record;
  }

  async registrationOptions(req) {
    const state = await this.load();
    const existing = await this.credentialsFor(req);
    const session = await this.session(req);

    if (existing.length > 0 && !session) {
      throw new Error("Authenticate with an existing passkey before registering another");
    }
    if (existing.length === 0 && !isLoopback(req) && !explicitBootstrapEnabled()) {
      throw new Error(
        "First passkey registration for this origin requires localhost or temporary DEVMOTER_PASSKEY_BOOTSTRAP=1"
      );
    }

    const rpId = requestHost(req);
    const publicKey = await generateRegistrationOptions({
      rpName: "DevMoter FAST",
      rpID: rpId,
      userName: "devmoter",
      userDisplayName: "DevMoter user",
      userID: fromB64url(state.userId),
      attestationType: "none",
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
      excludeCredentials: existing.map(item => ({
        id: item.id,
        transports: item.transports
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required"
      }
    });
    const challengeId = this.rememberChallenge("register", req, publicKey.challenge);
    return { challengeId, publicKey };
  }

  async verifyRegistration(req, payload) {
    const record = this.takeChallenge(payload?.challengeId, "register", req);
    const response = payload?.response;
    if (!response || typeof response !== "object") {
      throw new Error("A standards-compliant WebAuthn registration response is required");
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: record.value,
      expectedOrigin: record.origin,
      expectedRPID: record.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration verification failed");
    }

    const credential = verification.registrationInfo.credential;
    if (!credential?.id || !credential?.publicKey) {
      throw new Error("Verified passkey credential data is missing");
    }

    const state = await this.load();
    if (state.credentials.some(item => item.id === credential.id && item.rpId === record.rpId)) {
      throw new Error("Passkey is already registered");
    }

    state.credentials.push({
      id: String(credential.id),
      rpId: record.rpId,
      publicKey: b64url(credential.publicKey),
      counter: Number(credential.counter || 0),
      transports: Array.isArray(credential.transports) ? credential.transports.map(String).slice(0, 12) : [],
      deviceType: String(verification.registrationInfo.credentialDeviceType || ""),
      backedUp: Boolean(verification.registrationInfo.credentialBackedUp),
      label: String(payload?.label || "Passkey").slice(0, 80),
      createdAt: Date.now(),
      lastUsedAt: 0
    });
    await this.save();
    return this.createSession(req);
  }

  async loginOptions(req) {
    const credentials = await this.credentialsFor(req);
    if (!credentials.length) throw new Error("No passkeys are registered for this host");

    const rpId = requestHost(req);
    const publicKey = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: "required",
      allowCredentials: credentials.map(item => ({
        id: item.id,
        transports: item.transports
      }))
    });
    const challengeId = this.rememberChallenge("login", req, publicKey.challenge);
    return { challengeId, publicKey };
  }

  async verifyLogin(req, payload) {
    const record = this.takeChallenge(payload?.challengeId, "login", req);
    const response = payload?.response;
    if (!response || typeof response !== "object") {
      throw new Error("A standards-compliant WebAuthn authentication response is required");
    }

    const state = await this.load();
    const credential = state.credentials.find(
      item => item.id === String(response.id || "") && item.rpId === record.rpId
    );
    if (!credential) throw new Error("Unknown passkey");

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: record.value,
      expectedOrigin: record.origin,
      expectedRPID: record.rpId,
      credential: {
        id: credential.id,
        publicKey: fromB64url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports
      },
      requireUserVerification: true
    });
    if (!verification.verified) throw new Error("Passkey authentication verification failed");

    credential.counter = Number(verification.authenticationInfo.newCounter || 0);
    credential.lastUsedAt = Date.now();
    await this.save();
    return this.createSession(req);
  }

  createSession(req) {
    const token = b64url(randomBytes(32));
    this.sessions.set(sha256(Buffer.from(token)), {
      id: randomUUID(),
      rpId: requestHost(req),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    return {
      ok: true,
      cookie: sessionCookie(req, token, Math.floor(SESSION_TTL_MS / 1000))
    };
  }

  async logout(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) this.sessions.delete(sha256(Buffer.from(token)));
    return sessionCookie(req, "", 0);
  }

  async require(req) {
    const state = await this.load();
    if (!state.credentials.length) return { required: false, authenticated: true };
    const session = await this.session(req);
    return { required: true, authenticated: Boolean(session) };
  }
}

export const passkeyInternals = {
  requestHost,
  requestOrigin,
  isLoopback
};
