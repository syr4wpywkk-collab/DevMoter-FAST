import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

const VERSION = 1;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 32;
const MAX_REGISTRY_BYTES = 256 * 1024;
const mutationsByPath = new Map();
const IDENTITY_FIELDS = ["provider", "subject", "login", "email", "name", "avatarUrl", "issuer", "tenantId"];

function digest(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

function validHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host || host.length > 253 || /[\s/@?#]/.test(host)) throw new Error("A valid session host is required.");
  return host;
}

function publicSession(session) {
  const { id, ownerId, host, identity, provider, assurance, createdAt, lastUsedAt, expiresAt } = session;
  return structuredClone({ id, ownerId, host, identity, provider, assurance, createdAt, lastUsedAt, expiresAt });
}

function normalizeSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["id", "tokenHash", "ownerId", "host", "identity", "provider", "assurance", "createdAt", "lastUsedAt", "expiresAt"].includes(key))) return null;
  if (!value.identity || typeof value.identity !== "object" || Array.isArray(value.identity) || Object.entries(value.identity).some(([key, field]) => !IDENTITY_FIELDS.includes(key) || typeof field !== "string" || field.length > 2048)) return null;
  if (!value.identity.provider || !value.identity.subject || value.provider !== value.identity.provider) return null;
  const session = {
    id: String(value.id || ""),
    tokenHash: String(value.tokenHash || ""),
    ownerId: String(value.ownerId || ""),
    host: String(value.host || ""),
    identity: value.identity,
    provider: String(value.provider || value.identity?.provider || ""),
    assurance: value.assurance == null ? null : String(value.assurance),
    createdAt: Number(value.createdAt),
    lastUsedAt: Number(value.lastUsedAt),
    expiresAt: Number(value.expiresAt)
  };
  if (!/^[0-9a-f-]{36}$/i.test(session.id) || !/^[a-f0-9]{64}$/.test(session.tokenHash) ||
    !session.ownerId || session.ownerId.length > 200 || !session.host || session.host.length > 253 ||
    !session.identity || typeof session.identity !== "object" || Array.isArray(session.identity) || !session.provider ||
    (session.assurance !== null && session.assurance.length > 64) ||
    !Number.isSafeInteger(session.createdAt) || !Number.isSafeInteger(session.lastUsedAt) ||
    !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= session.createdAt ||
    session.expiresAt - session.createdAt > MAX_TTL_MS) return null;
  try { validHost(session.host); } catch { return null; }
  return session;
}

function normalizeIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("Session identity is required.");
  const result = {};
  for (const key of IDENTITY_FIELDS) {
    if (identity[key] != null) result[key] = String(identity[key]).slice(0, 1000);
  }
  if (!result.provider || !result.subject) throw new Error("Session identity requires provider and subject.");
  return result;
}

function ownedByCurrentUser(info) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return uid === null || info.uid === uid;
}

export class OwnerSessionStore {
  constructor({ configDir, ttlMs = DEFAULT_TTL_MS, maxSessions = MAX_SESSIONS, now = Date.now } = {}) {
    if (!configDir) throw new Error("configDir is required.");
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl < 60_000 || ttl > MAX_TTL_MS) throw new Error("Session TTL must be between one minute and 90 days.");
    const maximum = Number(maxSessions);
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_SESSIONS) throw new Error("maxSessions must be between 1 and 32.");
    this.configDir = configDir;
    this.file = join(configDir, "auth-sessions.json");
    this.ttlMs = ttl;
    this.maxSessions = maximum;
    this.now = now;
    this.state = null;
    this.readyPromise = null;
  }

  async prepareDirectory() {
    await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const info = await lstat(this.configDir);
    if (!info.isDirectory() || info.isSymbolicLink() || !ownedByCurrentUser(info)) throw new Error("Auth session directory is unsafe.");
    await chmod(this.configDir, 0o700);
  }

  async readState() {
    await this.prepareDirectory();
    let handle;
    try { handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
    catch (error) { if (error?.code === "ENOENT") return { version: VERSION, sessions: [] }; throw new Error("Auth session registry is unsafe; refusing to fail open."); }
    let parsed;
    try {
      const info = await handle.stat();
      if (!info.isFile() || !ownedByCurrentUser(info) || (info.mode & 0o077) !== 0 || info.size > MAX_REGISTRY_BYTES) throw new Error("Auth session registry is unsafe; refusing to fail open.");
      try { parsed = JSON.parse(await handle.readFile("utf8")); }
      catch { throw new Error("Auth session registry is corrupt; refusing to fail open."); }
    } finally { await handle.close(); }
    if (!parsed || Object.keys(parsed).some(key => !["version", "sessions"].includes(key)) || parsed.version !== VERSION || !Array.isArray(parsed.sessions) || parsed.sessions.length > MAX_SESSIONS) {
      throw new Error("Auth session registry is invalid; refusing to fail open.");
    }
    const sessions = parsed.sessions.map(normalizeSession);
    if (sessions.some(session => !session) || new Set(sessions.map(session => session.id)).size !== sessions.length ||
      new Set(sessions.map(session => session.tokenHash)).size !== sessions.length) {
      throw new Error("Auth session registry contains invalid state; refusing to fail open.");
    }
    return { version: VERSION, sessions };
  }

  async ready() {
    if (!this.readyPromise) {
      this.readyPromise = this.readState().then(state => {
        this.state = state;
        return this;
      });
    }
    return this.readyPromise;
  }

  async persist(sessions) {
    await this.prepareDirectory();
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: VERSION, sessions }));
      await handle.sync();
    } finally { await handle.close(); }
    try {
      await rename(temp, this.file);
      await chmod(this.file, 0o600);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async mutate(fn) {
    await this.ready();
    const prior = mutationsByPath.get(this.file) || Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
      // Reload under the process-wide path queue so separate service objects do not overwrite each other.
      const state = await this.readState();
      const sessions = state.sessions;
      const now = this.now();
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].expiresAt <= now) sessions.splice(index, 1);
      }
      const result = await fn(sessions);
      await this.persist(sessions);
      this.state = { version: VERSION, sessions };
      return result;
    });
    mutationsByPath.set(this.file, task.catch(() => {}));
    return task;
  }

  async create({ ownerId, host, identity, provider = null, assurance = null }) {
    const normalizedHost = validHost(host);
    const normalizedIdentity = normalizeIdentity(identity);
    if (!ownerId || String(ownerId).length > 200) throw new Error("ownerId is required.");
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const record = {
      id: randomUUID(), tokenHash: digest(token), ownerId: String(ownerId), host: normalizedHost,
      identity: normalizedIdentity, provider: String(provider || normalizedIdentity.provider),
      assurance: assurance == null ? null : String(assurance), createdAt: now, lastUsedAt: now, expiresAt: now + this.ttlMs
    };
    const session = await this.mutate(sessions => {
      const alive = sessions.filter(item => item.expiresAt > now);
      alive.push(record);
      while (alive.length > this.maxSessions) alive.shift();
      sessions.splice(0, sessions.length, ...alive);
      return publicSession(record);
    });
    return { token, session };
  }

  async get(token, host) {
    if (!token) return null;
    const tokenHash = digest(token);
    const normalizedHost = validHost(host);
    return this.mutate(sessions => {
      const now = this.now();
      const index = sessions.findIndex(item => item.tokenHash === tokenHash);
      const session = index < 0 ? null : sessions[index];
      const live = sessions.filter(item => item.expiresAt > now);
      sessions.splice(0, sessions.length, ...live);
      if (!session || session.expiresAt <= now || session.host !== normalizedHost) return null;
      session.lastUsedAt = now;
      return publicSession(session);
    });
  }

  async revoke(token) {
    if (!token) return false;
    const tokenHash = digest(token);
    return this.mutate(sessions => {
      const index = sessions.findIndex(item => item.tokenHash === tokenHash);
      if (index < 0) return false;
      sessions.splice(index, 1);
      return true;
    });
  }

  async list({ ownerId, currentToken = null } = {}) {
    const now = this.now();
    const currentHash = currentToken ? digest(currentToken) : null;
    return this.mutate(sessions => sessions.filter(session => session.ownerId === String(ownerId || "") && session.expiresAt > now)
      .map(session => ({ ...publicSession(session), current: session.tokenHash === currentHash })));
  }

  async revokeOthers({ ownerId, currentToken }) {
    const id = String(ownerId || "");
    const currentHash = currentToken ? digest(currentToken) : "";
    return this.mutate(sessions => {
      let revoked = 0;
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].ownerId === id && sessions[index].tokenHash !== currentHash) {
          sessions.splice(index, 1);
          revoked += 1;
        }
      }
      return revoked;
    });
  }

  async revokeById(id, { ownerId, currentToken = null } = {}) {
    return this.mutate(sessions => {
      const index = sessions.findIndex(session => session.id === String(id) && session.ownerId === String(ownerId || ""));
      if (index < 0) return false;
      sessions.splice(index, 1);
      return true;
    });
  }

  async revokeProvider(ownerId, provider) {
    const owner = String(ownerId || "");
    const method = String(provider || "");
    return this.mutate(sessions => {
      let revoked = 0;
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (sessions[index].ownerId === owner && sessions[index].provider === method) {
          sessions.splice(index, 1);
          revoked += 1;
        }
      }
      return revoked;
    });
  }

  async revokeOwner(ownerId) {
    const id = String(ownerId || "");
    return this.mutate(sessions => {
      const before = sessions.length;
      for (let index = sessions.length - 1; index >= 0; index -= 1) if (sessions[index].ownerId === id) sessions.splice(index, 1);
      return before - sessions.length;
    });
  }
}

export const OWNER_SESSION_DEFAULT_TTL_MS = DEFAULT_TTL_MS;
