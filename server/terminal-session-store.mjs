import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 1024 * 1024;
const SESSION_ID = /^[a-f0-9]{36}$/;
const TMUX_NAME = /^devmoter-[a-f0-9]{24}$/;
const DEVICE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function ownedByCurrentUser(info) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return uid === null || info.uid === uid;
}

function normalizeSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const session = {
    id: String(value.id || ""),
    name: String(value.name || ""),
    projectId: String(value.projectId || ""),
    projectName: String(value.projectName || ""),
    cwd: String(value.cwd || ""),
    tmuxName: String(value.tmuxName || ""),
    tokenHash: String(value.tokenHash || ""),
    ownerDeviceId: value.ownerDeviceId == null ? null : String(value.ownerDeviceId),
    createdAt: Number(value.createdAt),
    lastActivityAt: Number(value.lastActivityAt),
    expiresAt: Number(value.expiresAt)
  };
  if (
    !SESSION_ID.test(session.id) || !TMUX_NAME.test(session.tmuxName) ||
    !session.name || session.name.length > 48 || !session.projectId ||
    !session.projectName || !session.cwd || !/^[a-f0-9]{64}$/.test(session.tokenHash) ||
    (session.ownerDeviceId !== null && !DEVICE_ID.test(session.ownerDeviceId)) ||
    !Number.isSafeInteger(session.createdAt) || !Number.isSafeInteger(session.lastActivityAt) ||
    !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= session.createdAt
  ) return null;
  return session;
}

export class TerminalSessionStore {
  constructor(file) {
    this.file = file;
    this.pendingWrite = Promise.resolve();
  }

  async prepareDirectory() {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const directory = await lstat(dirname(this.file));
    if (!directory.isDirectory() || directory.isSymbolicLink() || !ownedByCurrentUser(directory)) {
      throw new Error("Terminal session store directory is unsafe.");
    }
    await chmod(dirname(this.file), 0o700);
  }

  async load() {
    await this.prepareDirectory();
    let info;
    try {
      info = await lstat(this.file);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || !ownedByCurrentUser(info) || (info.mode & 0o077) !== 0) {
      throw new Error("Terminal session store must be a private regular file.");
    }
    if (info.size > MAX_STORE_BYTES) throw new Error("Terminal session store exceeds its size limit.");
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      throw new Error("Terminal session store is malformed.");
    }
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.sessions) || parsed.sessions.length > 64) {
      throw new Error("Terminal session store has an unsupported format.");
    }
    const sessions = parsed.sessions.map(normalizeSession);
    if (sessions.some(session => !session)) throw new Error("Terminal session store contains invalid state.");
    if (new Set(sessions.map(session => session.id)).size !== sessions.length) {
      throw new Error("Terminal session store contains duplicate session IDs.");
    }
    return sessions;
  }

  async save(sessions) {
    const normalized = sessions.map(normalizeSession);
    if (normalized.some(session => !session) || normalized.length > 64) {
      throw new Error("Refusing to persist invalid terminal session metadata.");
    }
    const operation = async () => {
      await this.prepareDirectory();
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: STORE_VERSION, sessions: normalized }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, this.file);
        await chmod(this.file, 0o600);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    };
    const write = this.pendingWrite.catch(() => {}).then(operation);
    this.pendingWrite = write;
    return write;
  }
}
