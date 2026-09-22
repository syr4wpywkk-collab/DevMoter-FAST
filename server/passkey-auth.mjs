import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = "devmoter_passkey";

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromB64url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function parseClientData(value) {
  const raw = fromB64url(value);
  return { raw, data: JSON.parse(raw.toString("utf8")) };
}

function requestHost(req) {
  const forwarded = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwarded || String(req.headers.host || "localhost");
  try {
    return new URL("http://" + host).hostname;
  } catch {
    return host.split(":")[0] || "localhost";
  }
}

function requestOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (origin) return origin;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  return `${proto}://${String(req.headers.host || "localhost")}`;
}

function isLoopback(req) {
  const address = String(req.socket?.remoteAddress || "");
  const host = requestHost(req).toLowerCase();
  const loopbackAddress = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const loopbackHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return loopbackAddress && loopbackHost;
}

function explicitBootstrapEnabled() {
  return process.env.DEVMOTER_PASSKEY_BOOTSTRAP === "1";
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
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

function sha256(input) {
  return createHash("sha256").update(input).digest();
}

function equalBuffers(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function authenticatorInfo(value, rpId) {
  const data = fromB64url(value);
  if (data.length < 37) throw new Error("Authenticator data is too short");
  const rpHash = data.subarray(0, 32);
  if (!equalBuffers(rpHash, sha256(Buffer.from(rpId, "utf8")))) throw new Error("Passkey RP ID mismatch");
  const flags = data[32];
  if ((flags & 0x01) === 0) throw new Error("User presence was not verified");
  if ((flags & 0x04) === 0) throw new Error("User verification is required");
  return { data, flags, signCount: data.readUInt32BE(33) };
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
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      this.state = {
        version: 1,
        userId: String(parsed?.userId || b64url(randomBytes(24))),
        credentials: Array.isArray(parsed?.credentials) ? parsed.credentials : []
      };
    } catch {
      this.state = { version: 1, userId: b64url(randomBytes(24)), credentials: [] };
      await this.save();
    }
    return this.state;
  }

  async save() {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    await writeFile(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
  }

  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.challenges) if (value.expiresAt <= now) this.challenges.delete(key);
    for (const [key, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(key);
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
    const session = this.sessions.get(sha256(Buffer.from(token)).toString("hex"));
    if (!session || session.rpId !== requestHost(req) || session.expiresAt <= Date.now()) return null;
    return session;
  }

  async status(req) {
    const credentials = await this.credentialsFor(req);
    const session = await this.session(req);
    return {
      enabled: credentials.length > 0,
      authenticated: Boolean(session),
      credentialCount: credentials.length,
      rpId: requestHost(req),
      origin: requestOrigin(req),
      canRegister: Boolean(session) || (credentials.length === 0 && (isLoopback(req) || explicitBootstrapEnabled())),
      bootstrapEnabled: explicitBootstrapEnabled(),
      recovery: "Use another registered passkey for this host. For a new/recovery origin, temporarily enable DEVMOTER_PASSKEY_BOOTSTRAP=1, register the passkey, then disable it."
    };
  }

  challenge(kind, req) {
    this.cleanup();
    const id = randomUUID();
    const value = b64url(randomBytes(32));
    this.challenges.set(id, {
      id,
      kind,
      value,
      rpId: requestHost(req),
      origin: requestOrigin(req),
      expiresAt: Date.now() + CHALLENGE_TTL_MS
    });
    return { id, value };
  }

  takeChallenge(id, kind) {
    this.cleanup();
    const record = this.challenges.get(String(id || ""));
    this.challenges.delete(String(id || ""));
    if (!record || record.kind !== kind || record.expiresAt <= Date.now()) throw new Error("Passkey challenge expired or invalid");
    return record;
  }

  async registrationOptions(req) {
    const state = await this.load();
    const existing = await this.credentialsFor(req);
    const session = await this.session(req);
    if (existing.length > 0 && !session) throw new Error("Authenticate with an existing passkey before registering another");
    if (existing.length === 0 && !isLoopback(req) && !explicitBootstrapEnabled()) {
      throw new Error("First passkey registration for this origin requires localhost or temporary DEVMOTER_PASSKEY_BOOTSTRAP=1");
    }
    const challenge = this.challenge("register", req);
    return {
      challengeId: challenge.id,
      publicKey: {
        challenge: challenge.value,
        rp: { id: requestHost(req), name: "DevMoter FAST" },
        user: { id: state.userId, name: "devmoter", displayName: "DevMoter user" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        timeout: 60_000,
        attestation: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          requireResidentKey: false,
          userVerification: "required"
        }
      }
    };
  }

  async verifyRegistration(req, payload) {
    const record = this.takeChallenge(payload?.challengeId, "register");
    const { data: client } = parseClientData(payload?.clientDataJSON);
    if (client.type !== "webauthn.create") throw new Error("Invalid WebAuthn ceremony type");
    if (client.challenge !== record.value) throw new Error("Passkey challenge mismatch");
    if (client.origin !== record.origin) throw new Error("Passkey origin mismatch");
    if (record.rpId !== requestHost(req)) throw new Error("Passkey host changed during registration");

    const credentialId = String(payload?.credentialId || "");
    const publicKey = String(payload?.publicKey || "");
    const algorithm = Number(payload?.algorithm);
    if (!credentialId || !publicKey) throw new Error("Credential public key is required");
    if (![-7, -257].includes(algorithm)) throw new Error("Unsupported passkey algorithm");

    createPublicKey({ key: fromB64url(publicKey), format: "der", type: "spki" });

    const state = await this.load();
    const existing = state.credentials.find(item => item.id === credentialId && item.rpId === record.rpId);
    if (existing) throw new Error("Passkey is already registered");
    state.credentials.push({
      id: credentialId,
      rpId: record.rpId,
      publicKey,
      algorithm,
      signCount: 0,
      transports: Array.isArray(payload?.transports) ? payload.transports.map(String).slice(0, 8) : [],
      label: String(payload?.label || "Passkey").slice(0, 80),
      createdAt: Date.now()
    });
    await this.save();
    return this.createSession(req);
  }

  async loginOptions(req) {
    const credentials = await this.credentialsFor(req);
    if (!credentials.length) throw new Error("No passkeys are registered for this host");
    const challenge = this.challenge("login", req);
    return {
      challengeId: challenge.id,
      publicKey: {
        challenge: challenge.value,
        rpId: requestHost(req),
        timeout: 60_000,
        userVerification: "required",
        allowCredentials: credentials.map(item => ({
          type: "public-key",
          id: item.id,
          transports: item.transports
        }))
      }
    };
  }

  async verifyLogin(req, payload) {
    const record = this.takeChallenge(payload?.challengeId, "login");
    if (record.rpId !== requestHost(req)) throw new Error("Passkey host changed during login");
    const { raw: clientRaw, data: client } = parseClientData(payload?.clientDataJSON);
    if (client.type !== "webauthn.get") throw new Error("Invalid WebAuthn ceremony type");
    if (client.challenge !== record.value) throw new Error("Passkey challenge mismatch");
    if (client.origin !== record.origin) throw new Error("Passkey origin mismatch");

    const state = await this.load();
    const credential = state.credentials.find(item => item.id === String(payload?.credentialId || "") && item.rpId === record.rpId);
    if (!credential) throw new Error("Unknown passkey");

    const auth = authenticatorInfo(payload?.authenticatorData, record.rpId);
    const signed = Buffer.concat([auth.data, sha256(clientRaw)]);
    const key = createPublicKey({ key: fromB64url(credential.publicKey), format: "der", type: "spki" });
    const signature = fromB64url(payload?.signature);
    const valid = verifySignature("sha256", signed, key, signature);
    if (!valid) throw new Error("Passkey signature verification failed");
    if (credential.signCount > 0 && auth.signCount > 0 && auth.signCount <= credential.signCount) {
      throw new Error("Passkey signature counter did not advance");
    }
    credential.signCount = Math.max(credential.signCount || 0, auth.signCount);
    credential.lastUsedAt = Date.now();
    await this.save();
    return this.createSession(req);
  }

  createSession(req) {
    const token = b64url(randomBytes(32));
    const key = sha256(Buffer.from(token)).toString("hex");
    this.sessions.set(key, {
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
    if (token) this.sessions.delete(sha256(Buffer.from(token)).toString("hex"));
    return sessionCookie(req, "", 0);
  }

  async require(req) {
    const state = await this.load();
    if (!state.credentials.length) return { required: false, authenticated: true };
    const session = await this.session(req);
    return { required: true, authenticated: Boolean(session) };
  }
}
