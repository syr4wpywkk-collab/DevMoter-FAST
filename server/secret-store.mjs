import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt
} from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const FORMAT_VERSION = 1;
const CIPHER = "aes-256-gcm";
const KDF = "scrypt";
const SCRYPT_OPTIONS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_SECRET_BYTES = 16 * 1024;
const AAD = Buffer.from("devmoter-secret-store:v1", "utf8");

function deriveKey(passphrase, salt) {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, 32, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function validatePassphrase(value) {
  const passphrase = String(value || "");
  if (Buffer.byteLength(passphrase, "utf8") < 12 || Buffer.byteLength(passphrase, "utf8") > 1024) {
    throw new Error("Vault passphrase must be between 12 and 1024 bytes.");
  }
  return passphrase;
}

function decodeBase64(value, expectedLength, name) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid vault ${name}.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedLength && decoded.length !== expectedLength) throw new Error(`Invalid vault ${name}.`);
  return decoded;
}

function validateEnvelope(value) {
  if (
    !value || value.version !== FORMAT_VERSION || value.cipher !== CIPHER || value.kdf !== KDF ||
    typeof value.ciphertext !== "string"
  ) throw new Error("Unsupported or malformed vault file.");
  const salt = decodeBase64(value.salt, 16, "salt");
  const iv = decodeBase64(value.iv, 12, "nonce");
  const tag = decodeBase64(value.tag, 16, "authentication tag");
  const ciphertext = decodeBase64(value.ciphertext, null, "ciphertext");
  if (ciphertext.length > MAX_STORE_BYTES) throw new Error("Vault file exceeds its size limit.");
  return { salt, iv, tag, ciphertext };
}

function validateSecretState(value) {
  if (!value || value.version !== FORMAT_VERSION || !Array.isArray(value.secrets) || value.secrets.length > 1000) {
    throw new Error("Vault contents are malformed.");
  }
  const refs = new Set();
  for (const record of value.secrets) {
    if (!record || typeof record !== "object" || typeof record.value !== "string") throw new Error("Vault contents are malformed.");
    const reference = secretReference(record.provider, record.name);
    if (refs.has(reference)) throw new Error("Vault contains duplicate references.");
    refs.add(reference);
    if (Buffer.byteLength(record.value, "utf8") > MAX_SECRET_BYTES) throw new Error("Vault contains an oversized secret.");
    if (!Array.isArray(record.projectIds) || !record.projectIds.every(id => typeof id === "string" && id.length <= 128)) {
      throw new Error("Vault project bindings are malformed.");
    }
  }
  return value.secrets;
}

function secretReference(provider, name) {
  const validPart = value => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(value || ""));
  if (!validPart(provider) || !validPart(name)) throw new Error("Secret provider or name is invalid.");
  return `secret://${provider}/${name}`;
}

function publicMetadata(record, duplicate = false) {
  return {
    reference: secretReference(record.provider, record.name),
    provider: record.provider,
    name: record.name,
    purpose: record.purpose,
    envName: record.envName || null,
    projectIds: [...record.projectIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt || null,
    configured: true,
    duplicate
  };
}

async function readPrivateFile(filePath) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_STORE_BYTES) throw new Error("Vault file is invalid or too large.");
    const bytes = await handle.readFile();
    if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
      throw new Error("Vault file permissions are too broad; expected owner-only access.");
    }
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Vault file is malformed.");
    return parsed;
  } finally {
    await handle.close();
  }
}

async function writePrivateFile(filePath, content) {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
    if (process.platform !== "win32") await chmod(filePath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export function createSecretStore({ filePath, now = Date.now } = {}) {
  if (!filePath) throw new Error("Secret store filePath is required.");
  let key = null;
  let secrets = [];
  let queue = Promise.resolve();

  function serialize(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }

  function requireUnlocked() {
    if (!key) throw new Error("Secret vault is locked.");
  }

  async function encryptState(nextSecrets, salt, keyBytes = key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(CIPHER, keyBytes, iv);
    cipher.setAAD(AAD);
    const serialized = Buffer.from(JSON.stringify({ version: FORMAT_VERSION, secrets: nextSecrets }), "utf8");
    try {
      const ciphertext = Buffer.concat([cipher.update(serialized), cipher.final()]);
      const envelope = {
        version: FORMAT_VERSION,
        cipher: CIPHER,
        kdf: KDF,
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
      };
      const output = JSON.stringify(envelope);
      if (Buffer.byteLength(output, "utf8") > MAX_STORE_BYTES) throw new Error("Vault file exceeds its size limit.");
      await writePrivateFile(filePath, output);
    } finally {
      serialized.fill(0);
    }
  }

  async function initialize(passphraseValue) {
    return serialize(async () => {
      if ((await readPrivateFile(filePath)) !== null) throw new Error("Secret vault is already initialized.");
      const passphrase = validatePassphrase(passphraseValue);
      const salt = randomBytes(16);
      const derived = await deriveKey(passphrase, salt);
      try {
        await encryptState([], salt, derived);
        key = derived;
        secrets = [];
      } catch (error) {
        derived.fill(0);
        throw error;
      }
      return { initialized: true, unlocked: true };
    });
  }

  async function unlock(passphraseValue) {
    return serialize(async () => {
      const envelope = await readPrivateFile(filePath);
      if (!envelope) throw new Error("Secret vault is not initialized.");
      const parsed = validateEnvelope(envelope);
      const passphrase = validatePassphrase(passphraseValue);
      const derived = await deriveKey(passphrase, parsed.salt);
      let cleartext;
      try {
        const decipher = createDecipheriv(CIPHER, derived, parsed.iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(parsed.tag);
        cleartext = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
        const state = JSON.parse(cleartext.toString("utf8"));
        const nextSecrets = validateSecretState(state);
        key?.fill(0);
        key = derived;
        secrets = nextSecrets;
        return { initialized: true, unlocked: true, count: secrets.length };
      } catch {
        derived.fill(0);
        throw new Error("Vault could not be unlocked; passphrase or encrypted data is invalid.");
      } finally {
        cleartext?.fill(0);
        parsed.ciphertext.fill(0);
      }
    });
  }

  async function lock() {
    return serialize(async () => {
      key?.fill(0);
      key = null;
      secrets = [];
      return { locked: true };
    });
  }

  async function list() {
    return serialize(async () => {
      requireUnlocked();
      return secrets.map((record, index) => publicMetadata(
        record,
        secrets.some((other, otherIndex) => otherIndex !== index && other.value === record.value)
      ));
    });
  }

  async function set(input) {
    return serialize(async () => {
      requireUnlocked();
      const provider = String(input?.provider || "");
      const name = String(input?.name || "");
      const reference = secretReference(provider, name);
      const value = String(input?.value ?? "");
      if (!value || value.includes("\u0000") || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) {
        throw new Error("Secret value is invalid, empty, or too large.");
      }
      const envName = input?.envName ? String(input.envName) : "";
      if (envName && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(envName)) throw new Error("Secret environment name is invalid.");
      const rawProjectIds = Array.isArray(input?.projectIds) ? input.projectIds : [];
      if (rawProjectIds.some(id => typeof id !== "string")) throw new Error("Secret project binding is invalid.");
      const projectIds = [...new Set(rawProjectIds)];
      if (projectIds.length > 100 || projectIds.some(id => !id || id.length > 128)) throw new Error("Secret project binding is invalid.");
      const timestamp = now();
      const index = secrets.findIndex(record => secretReference(record.provider, record.name) === reference);
      const existing = index >= 0 ? secrets[index] : null;
      const record = {
        provider,
        name,
        value,
        purpose: String(input?.purpose || "").trim().slice(0, 200),
        envName: envName || null,
        projectIds,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        lastUsedAt: existing?.lastUsedAt || null
      };
      const next = [...secrets];
      if (index >= 0) next[index] = record;
      else {
        if (next.length >= 1000) throw new Error("Secret vault is full.");
        next.push(record);
      }
      const envelope = await readPrivateFile(filePath);
      if (!envelope) throw new Error("Secret vault file disappeared.");
      const { salt } = validateEnvelope(envelope);
      await encryptState(next, salt);
      secrets = next;
      return publicMetadata(record, next.some(other => other !== record && other.value === record.value));
    });
  }

  async function resolve(referenceValue, { projectId = "", provider = "" } = {}) {
    return serialize(async () => {
      requireUnlocked();
      const reference = String(referenceValue || "");
      const match = reference.match(/^secret:\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})$/);
      if (!match) throw new Error("Secret reference is invalid.");
      const record = secrets.find(item => secretReference(item.provider, item.name) === reference);
      if (!record) throw new Error("Secret reference was not found.");
      if (!provider || record.provider !== provider) throw new Error("Secret provider binding does not match.");
      if (!projectId || !record.projectIds.includes(String(projectId))) {
        throw new Error("Secret is not bound to this project.");
      }
      record.lastUsedAt = now();
      const envelope = await readPrivateFile(filePath);
      if (!envelope) throw new Error("Secret vault file disappeared.");
      const { salt } = validateEnvelope(envelope);
      await encryptState(secrets, salt);
      return record.value;
    });
  }

  async function remove(referenceValue) {
    return serialize(async () => {
      requireUnlocked();
      const reference = String(referenceValue || "");
      const next = secrets.filter(record => secretReference(record.provider, record.name) !== reference);
      if (next.length === secrets.length) throw new Error("Secret reference was not found.");
      const envelope = await readPrivateFile(filePath);
      if (!envelope) throw new Error("Secret vault file disappeared.");
      const { salt } = validateEnvelope(envelope);
      await encryptState(next, salt);
      secrets = next;
      return { ok: true };
    });
  }

  async function status() {
    const envelope = await readPrivateFile(filePath);
    return { initialized: Boolean(envelope), unlocked: Boolean(key), count: key ? secrets.length : null };
  }

  return { initialize, unlock, lock, list, set, resolve, remove, status };
}
