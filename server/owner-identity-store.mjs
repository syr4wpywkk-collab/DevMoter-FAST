import { randomUUID, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const VERSION = 2;
const PROVIDERS = new Set(["github", "google", "microsoft"]);
const MAX_BYTES = 1024 * 1024;
const queues = new Map();

function fail(message) {
  const error = new Error(message);
  error.status = 500;
  return error;
}

function serialize(path, operation) {
  const prior = queues.get(path) || Promise.resolve();
  const result = prior.then(operation, operation);
  const queued = result.catch(() => {});
  queues.set(path, queued);
  return result.finally(() => {
    if (queues.get(path) === queued) queues.delete(path);
  });
}

function cleanString(value, max = 512) {
  if (value == null) return "";
  if (typeof value !== "string") throw fail("Owner identity metadata is malformed.");
  const result = value.trim();
  if (result.length > max || /[\u0000-\u001f\u007f]/.test(result)) throw fail("Owner identity metadata is malformed.");
  return result;
}

function sanitizeIdentity(provider, value, now) {
  if (!PROVIDERS.has(provider) || !value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("Owner identity is malformed.");
  }
  const subject = cleanString(value.subject, 512);
  if (!subject) throw fail("Verified provider subject is required.");
  const result = { subject };
  for (const key of ["issuer", "tenantId", "login", "email", "name", "avatarUrl"]) {
    const candidate = cleanString(value[key], key === "avatarUrl" ? 2048 : 512);
    if (candidate) result[key] = candidate;
  }
  const boundAt = value.boundAt == null ? now : Number(value.boundAt);
  if (!Number.isSafeInteger(boundAt) || boundAt < 0) throw fail("Owner identity timestamp is malformed.");
  result.boundAt = boundAt;
  return result;
}

function validateV2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== VERSION ||
      !(value.ownerId === null || (typeof value.ownerId === "string" && /^[0-9a-f-]{36}$/i.test(value.ownerId))) ||
      !value.providers || typeof value.providers !== "object" || Array.isArray(value.providers)) {
    throw fail("Owner identity registry is invalid; refusing to fail open.");
  }
  if (Object.keys(value).some(key => !["version", "ownerId", "providers"].includes(key))) {
    throw fail("Owner identity registry is invalid; refusing to fail open.");
  }
  const providers = { github: null, google: null, microsoft: null };
  for (const key of Object.keys(value.providers)) {
    if (!PROVIDERS.has(key)) throw fail("Owner identity registry is invalid; refusing to fail open.");
  }
  for (const provider of PROVIDERS) {
    const record = value.providers[provider];
    if (record == null) continue;
    if (Object.keys(record).some(key => !["subject", "issuer", "tenantId", "login", "email", "name", "avatarUrl", "boundAt"].includes(key))) {
      throw fail("Owner identity registry is invalid; refusing to fail open.");
    }
    try {
      providers[provider] = sanitizeIdentity(provider, record, 0);
    } catch {
      throw fail("Owner identity registry is invalid; refusing to fail open.");
    }
    if (!Number.isSafeInteger(Number(record.boundAt)) || Number(record.boundAt) < 0) {
      throw fail("Owner identity registry is invalid; refusing to fail open.");
    }
  }
  if (!value.ownerId && Object.values(providers).some(Boolean)) {
    throw fail("Owner identity registry is invalid; refusing to fail open.");
  }
  return { version: VERSION, ownerId: value.ownerId, providers };
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw fail("Owner identity directory is unsafe.");
  if (process.platform !== "win32") await chmod(directory, 0o700);
}

export function createOwnerIdentityStore({ configDir, filePath, now = Date.now } = {}) {
  if (!configDir && !filePath) throw new Error("configDir or filePath is required.");
  const file = resolve(filePath || join(configDir, "auth-identities.json"));
  const directory = dirname(file);

  async function read() {
    await ensurePrivateDirectory(directory);
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw fail("Owner identity registry is unreadable; refusing to fail open.");
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || stat.size > MAX_BYTES || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
        throw fail("Owner identity registry permissions or size are invalid.");
      }
      let parsed;
      try { parsed = JSON.parse((await handle.readFile()).toString("utf8")); }
      catch { throw fail("Owner identity registry is malformed; refusing to fail open."); }
      if (parsed?.version === VERSION) return validateV2(parsed);
      if (parsed?.version === 1) {
        const github = parsed.github;
        if (!(github === null || (github && typeof github === "object" && cleanString(String(github.subject || "")) && cleanString(String(github.login || "")) && Number.isSafeInteger(Number(github.boundAt)) && Number(github.boundAt) >= 0))) {
          throw fail("Legacy owner identity registry is invalid; refusing to fail open.");
        }
        const hasGithub = Boolean(github);
        return {
          version: VERSION,
          ownerId: hasGithub ? randomUUID() : null,
          providers: {
            github: hasGithub ? sanitizeIdentity("github", {
              subject: String(github.subject), login: String(github.login), name: String(github.name || ""),
              avatarUrl: String(github.avatarUrl || ""), boundAt: Number(github.boundAt)
            }, now()) : null,
            google: null,
            microsoft: null
          },
          migrated: true
        };
      }
      throw fail("Owner identity registry is invalid; refusing to fail open.");
    } finally { await handle.close(); }
  }

  async function write(state) {
    await ensurePrivateDirectory(directory);
    const temp = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ version: VERSION, ownerId: state.ownerId, providers: state.providers }, null, 2), "utf8");
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temp, file);
      if (process.platform !== "win32") await chmod(file, 0o600);
      const dirHandle = await open(directory, constants.O_RDONLY);
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async function current() {
    const state = await read();
    if (!state) return { version: VERSION, ownerId: null, providers: { github: null, google: null, microsoft: null } };
    if (state.migrated) {
      const clean = { version: VERSION, ownerId: state.ownerId, providers: state.providers };
      await write(clean);
      return clean;
    }
    return state;
  }

  return {
    filePath: file,
    load: () => serialize(file, current),
    getOwner: async () => {
      const state = await serialize(file, current);
      return state.ownerId ? structuredClone(state) : null;
    },
    ensureOwner: () => serialize(file, async () => {
      const state = await current();
      if (!state.ownerId) {
        state.ownerId = randomUUID();
        await write(state);
      }
      return state.ownerId;
    }),
    bindProvider: (provider, identity, { ownerId } = {}) => serialize(file, async () => {
      if (!PROVIDERS.has(provider)) throw fail("Unsupported owner identity provider.");
      const state = await current();
      if (!state.ownerId) throw fail("DevMoter owner must be initialized before linking credentials.");
      if (ownerId && ownerId !== state.ownerId) throw fail("Credential cannot be linked to a different DevMoter owner.");
      const record = sanitizeIdentity(provider, identity, now());
      const existing = state.providers[provider];
      if (existing && existing.subject !== record.subject) {
        const error = new Error("A different account is already linked for this provider."); error.status = 409; throw error;
      }
      if (existing && ((existing.issuer || "") !== (record.issuer || "") || (existing.tenantId || "") !== (record.tenantId || ""))) {
        const error = new Error("A different account is already linked for this provider."); error.status = 409; throw error;
      }
      state.providers[provider] = existing ? { ...record, boundAt: existing.boundAt } : record;
      await write(state);
      return structuredClone(state.providers[provider]);
    }),
    unbindProvider: (provider, { ownerId } = {}) => serialize(file, async () => {
      if (!PROVIDERS.has(provider)) throw fail("Unsupported owner identity provider.");
      const state = await current();
      if (!state.ownerId || (ownerId && ownerId !== state.ownerId)) throw fail("DevMoter owner authentication is required.");
      state.providers[provider] = null;
      await write(state);
      return structuredClone(state);
    }),
    findOwner: (provider, subject, { issuer = "", tenantId = "" } = {}) => serialize(file, async () => {
      if (!PROVIDERS.has(provider)) return null;
      const state = await current();
      const match = state.providers[provider];
      return match && match.subject === String(subject) && (match.issuer || "") === String(issuer) &&
        (match.tenantId || "") === String(tenantId) ? state.ownerId : null;
    })
  };
}
