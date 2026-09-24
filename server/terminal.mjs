import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { spawn as spawnPty } from "node-pty";
import { TerminalSessionStore } from "./terminal-session-store.mjs";

const OUTPUT_LIMIT_BYTES = 512 * 1024;
const OUTPUT_LIMIT_CHUNKS = 4000;
const OUTPUT_CHUNK_BYTES = 16 * 1024;
const SESSION_RETENTION_MS = 15 * 60 * 1000;
const SESSION_IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 4;
const MAX_SOCKET_CLIENTS_PER_SESSION = 2;
const MAX_PENDING_SOCKET_TICKETS = 32;
const SOCKET_TICKET_TTL_MS = 20_000;
const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 300;
const MAX_SESSION_NAME_LENGTH = 48;
const PERSISTENT_SESSION_TTL_MS = SESSION_IDLE_LIMIT_MS;
const execFileAsync = promisify(execFile);

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseBasicPassword(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Basic ")) return "";
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return "";
    return decoded.slice(separator + 1);
  } catch {
    return "";
  }
}

function terminalPasswordConfigured(password) {
  return typeof password === "string" && password.length >= 16;
}

export function authenticateTerminalRequest(req, configuredPassword) {
  if (!terminalPasswordConfigured(configuredPassword)) {
    return {
      ok: false,
      status: 503,
      error: "Terminal is disabled until DEVMOTER_AUTH_PASSWORD is configured with at least 16 characters."
    };
  }
  const supplied = parseBasicPassword(req);
  if (!supplied || !safeEqualText(supplied, configuredPassword)) {
    return {
      ok: false,
      status: 401,
      error: "DevMoter authentication required.",
      challenge: true
    };
  }
  return { ok: true };
}

function resolveShell(value) {
  const shell = String(value || "/bin/bash").trim();
  if (!isAbsolute(shell) || shell.includes("\u0000") || /\s/.test(shell)) {
    return "/bin/bash";
  }
  return shell;
}

function terminalCookieName(id) {
  return `devmoter_terminal_${id}`;
}

function cookieValue(req, name) {
  for (const item of String(req.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return ""; }
  }
  return "";
}

function sessionTokenFrom(req, id) {
  const header = String(req.headers["x-devmoter-terminal-token"] || "").trim();
  return header || cookieValue(req, terminalCookieName(id));
}

function setSessionCookie(req, res, id, token, maxAge) {
  const origin = String(req.headers.origin || "");
  const secure = origin.startsWith("https://") ? "; Secure" : "";
  const value = `${terminalCookieName(id)}=${encodeURIComponent(token)}; Path=/api/terminal/sessions/${id}; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAge}`;
  const current = typeof res.getHeader === "function" ? res.getHeader("set-cookie") : null;
  const cookies = Array.isArray(current) ? [...current, value] : current ? [String(current), value] : [value];
  res.setHeader("set-cookie", cookies);
}

function tokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeSessionName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > MAX_SESSION_NAME_LENGTH || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) {
    throw new Error("Session name must be 1-48 letters, numbers, spaces, dots, underscores, or hyphens.");
  }
  return name;
}

function appendOutput(session, stream, data) {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
  if (!text) return;
  let chunk = "";
  let chunkBytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (chunk && chunkBytes + size > OUTPUT_CHUNK_BYTES) {
      appendOutputChunk(session, stream, chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += size;
  }
  if (chunk) appendOutputChunk(session, stream, chunk);
}

function appendOutputChunk(session, stream, text) {
  const item = {
    seq: ++session.seq,
    at: Date.now(),
    stream,
    data: text
  };
  session.output.push(item);
  session.outputBytes += Buffer.byteLength(text, "utf8");

  while (
    session.output.length > OUTPUT_LIMIT_CHUNKS ||
    session.outputBytes > OUTPUT_LIMIT_BYTES
  ) {
    const removed = session.output.shift();
    if (!removed) break;
    session.outputBytes -= Buffer.byteLength(removed.data, "utf8");
  }

  for (const listener of session.listeners) {
    try {
      listener(item);
    } catch {
      session.listeners.delete(listener);
    }
  }
}

function publicSession(session) {
  return {
    id: session.id,
    name: session.name,
    persistent: Boolean(session.persistent),
    expiresAt: session.expiresAt || null,
    projectId: session.projectId,
    projectName: session.projectName,
    cwd: session.cwd,
    createdAt: session.createdAt,
    lastAttachedAt: session.lastAttachedAt,
    lastActivityAt: session.lastActivityAt,
    closed: session.closed,
    exitCode: session.exitCode,
    signal: session.signal,
    seq: session.seq
  };
}

export function createTerminalManager(options = {}) {
  const resolveProject = options.resolveProject;
  const password = String(options.authPassword || "");
  const authenticateDevice = typeof options.authenticateDevice === "function" ? options.authenticateDevice : null;
  const isDeviceActive = typeof options.isDeviceActive === "function" ? options.isDeviceActive : null;
  const spawnPtyImpl = options.spawnPty || spawnPty;
  const maxSessions = Math.max(1, Math.min(16, Math.floor(Number(options.maxSessions) || DEFAULT_MAX_SESSIONS)));
  const shell = resolveShell(options.shell || process.env.SHELL);
  const sessionStore = options.sessionStoreFile ? new TerminalSessionStore(options.sessionStoreFile) : null;
  const runTmux = options.runTmux || (args => execFileAsync("tmux", args, {
    timeout: 5000,
    maxBuffer: 64 * 1024,
    windowsHide: true
  }));
  const tmuxArgs = Array.isArray(options.tmuxArgs) && options.tmuxArgs.every(value => typeof value === "string")
    ? [...options.tmuxArgs]
    : ["-L", "devmoter-fast", "-f", "/dev/null"];
  const callTmux = args => runTmux([...tmuxArgs, ...args]);
  if (typeof resolveProject !== "function") {
    throw new Error("Terminal manager requires resolveProject.");
  }

  const sessions = new Map();
  const socketTickets = new Map();
  const revokedDeviceIds = new Set();
  let storeLoaded = false;
  let storeLoadPromise = null;

  async function ensureStoreLoaded() {
    if (storeLoaded || !sessionStore) return;
    if (!storeLoadPromise) {
      storeLoadPromise = sessionStore.load().then(async records => {
        const now = Date.now();
        let expired = false;
        for (const record of records) {
          if (record.expiresAt <= now) {
            expired = true;
            await callTmux(["kill-session", "-t", record.tmuxName]).catch(() => {});
            continue;
          }
          sessions.set(record.id, {
            ...record,
            token: null,
            persistent: true,
            process: null,
            closed: false,
            exitCode: null,
            signal: null,
            lastAttachedAt: null,
            seq: 0,
            output: [],
            outputBytes: 0,
            listeners: new Set(),
            sockets: new Set(),
            cleanupTimer: null,
            detaching: false
          });
        }
        storeLoaded = true;
        if (expired) await persistSessions();
      });
    }
    await storeLoadPromise;
  }

  async function persistSessions() {
    if (!sessionStore) throw new Error("Persistent terminal storage is unavailable.");
    const records = [...sessions.values()]
      .filter(session => session.persistent && !session.closed)
      .map(session => ({
        id: session.id,
        name: session.name,
        projectId: session.projectId,
        projectName: session.projectName,
        cwd: session.cwd,
        ownerDeviceId: session.ownerDeviceId,
        tmuxName: session.tmuxName,
        tokenHash: session.tokenHash,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        expiresAt: session.expiresAt
      }));
    await sessionStore.save(records);
  }

  async function removePersistedSession(session) {
    sessions.delete(session.id);
    if (session.persistent && sessionStore && storeLoaded) await persistSessions();
  }

  function bindProcess(session, child) {
    session.process = child;
    session.detaching = false;
    child.onData(chunk => {
      session.lastActivityAt = Date.now();
      appendOutput(session, "stdout", chunk);
    });
    child.onExit(({ exitCode, signal }) => {
      session.process = null;
      if (session.detaching && session.persistent) {
        session.detaching = false;
        return;
      }
      if (session.closed) return;
      session.closed = true;
      session.exitCode = exitCode;
      session.signal = signal ? String(signal) : null;
      session.lastActivityAt = Date.now();
      appendOutput(
        session,
        "system",
        `\r\n[terminal exited${exitCode === null ? "" : ` with code ${exitCode}`}${signal ? `, signal ${signal}` : ""}]\r\n`
      );
      closeSockets(session, 1000, "Terminal process exited.");
      session.cleanupTimer = setTimeout(() => void removePersistedSession(session), SESSION_RETENTION_MS);
      session.cleanupTimer.unref?.();
      if (session.persistent) void persistSessions().catch(() => {});
    });
  }

  async function attachPersistentProcess(session) {
    if (!session.persistent || session.process || session.closed) return Boolean(session.process);
    if (session.expiresAt <= Date.now()) {
      session.closed = true;
      await callTmux(["kill-session", "-t", session.tmuxName]).catch(() => {});
      await removePersistedSession(session).catch(() => {});
      return false;
    }
    try {
      const project = await resolveProject(session.projectId);
      if (project.path !== session.cwd) return false;
      await callTmux(["has-session", "-t", session.tmuxName]);
      const child = spawnPtyImpl("tmux", [...tmuxArgs, "attach-session", "-t", session.tmuxName], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: session.cwd,
        env: {
          ...process.env,
          TERM: process.env.TERM || "xterm-256color",
          COLORTERM: process.env.COLORTERM || "truecolor"
        }
      });
      bindProcess(session, child);
      return true;
    } catch {
      session.closed = true;
      session.exitCode = null;
      session.signal = null;
      appendOutput(session, "system", "\r\n[terminal session unavailable]\r\n");
      await removePersistedSession(session).catch(() => {});
      return false;
    }
  }

  function auth(req, res) {
    const result = authenticateTerminalRequest(req, password);
    if (result.ok) return true;
    if (result.challenge) {
      res.setHeader("www-authenticate", 'Basic realm="DevMoter Terminal"');
    }
    json(res, result.status, { error: result.error });
    return false;
  }

  async function trustedDevice(req, res) {
    if (!authenticateDevice) return null;
    try {
      const device = await authenticateDevice(req);
      if (!device?.id) throw new Error("Trusted device identity is missing.");
      if (revokedDeviceIds.has(device.id)) throw new Error("Trusted device has been revoked.");
      return device;
    } catch (error) {
      const status = error?.status === 503 ? 503 : 403;
      json(res, status, { error: status === 503 ? "Trusted device state is unavailable." : "A trusted device is required for terminal access." });
      return false;
    }
  }

  function sessionDeviceAllowed(session, res) {
    if (session.ownerDeviceId && revokedDeviceIds.has(session.ownerDeviceId)) {
      if (res) json(res, 403, { error: "Trusted device has been revoked." });
      return false;
    }
    return true;
  }

  async function getAuthorizedSession(req, res, id, { allowClosed = true } = {}) {
    if (!auth(req, res)) return null;
    try {
      await ensureStoreLoaded();
    } catch {
      json(res, 503, { error: "Persistent terminal state is unavailable." });
      return null;
    }
    const device = await trustedDevice(req, res);
    if (device === false) return null;
    const session = sessions.get(id);
    if (!session) {
      json(res, 404, { error: "Terminal session not found." });
      return null;
    }
    if (device && session.ownerDeviceId !== device.id) {
      json(res, 403, { error: "Terminal session is not owned by this trusted device. Claim it explicitly to transfer access." });
      return null;
    }
    const supplied = sessionTokenFrom(req, id);
    const expected = session.tokenHash || tokenHash(session.token);
    if (!supplied || !safeEqualText(tokenHash(supplied), expected)) {
      json(res, 403, { error: "Terminal session capability is invalid." });
      return null;
    }
    if (!allowClosed && session.closed) {
      json(res, 409, { error: "Terminal session is already closed.", session: publicSession(session) });
      return null;
    }

    try {
      const project = await resolveProject(session.projectId);
      if (project.path !== session.cwd) {
        json(res, 409, { error: "Project registration changed; terminal re-attach denied." });
        return null;
      }
    } catch {
      json(res, 409, { error: "Project is no longer registered; terminal re-attach denied." });
      return null;
    }
    if (session.persistent && !session.closed && !session.process) {
      const attached = await attachPersistentProcess(session);
      if (!attached) {
        json(res, 410, { error: "Persistent terminal session has expired or is unavailable." });
        return null;
      }
    }
    if (!sessionDeviceAllowed(session, res)) return null;
    return session;
  }

  async function create(req, res) {
    if (!auth(req, res)) return;
    try {
      await ensureStoreLoaded();
      if (String(req.headers["x-devmoter-terminal-entry"] || "") !== "explicit") {
        json(res, 400, { error: "Terminal entry must be explicit." });
        return;
      }
      const device = await trustedDevice(req, res);
      if (device === false) return;
      const payload = await readJson(req);
      const projectId = String(payload?.projectId || "").trim();
      if (!projectId) throw new Error("projectId is required.");
      const persistent = payload?.persistent === true;
      if (persistent && !sessionStore) {
        json(res, 501, { error: "Persistent sessions require tmux and private terminal session storage on this host." });
        return;
      }
      const name = payload?.name == null || payload.name === ""
        ? `terminal-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`
        : normalizeSessionName(payload.name);
      if ([...sessions.values()].some(session => !session.closed && session.projectId === projectId && session.name.toLowerCase() === name.toLowerCase())) {
        json(res, 409, { error: "A terminal session with that name already exists in this project." });
        return;
      }
      const project = await resolveProject(projectId);

      // No await occurs between this check and registering the new session, so
      // concurrent HTTP requests cannot race past the configured process cap.
      const activeSessions = [...sessions.values()].filter(session => !session.closed).length;
      if (activeSessions >= maxSessions) {
        json(res, 429, { error: "Terminal session limit reached.", maxSessions });
        return;
      }

      const id = randomBytes(18).toString("hex");
      const token = randomBytes(32).toString("hex");
      const tmuxName = persistent ? `devmoter-${randomBytes(12).toString("hex")}` : null;
      if (persistent) {
        try {
          await callTmux(["new-session", "-d", "-s", tmuxName, "-c", project.path, shell, "-l"]);
        } catch {
          json(res, 503, { error: "Persistent terminal sessions require an available tmux installation." });
          return;
        }
        if (device && revokedDeviceIds.has(device.id)) {
          await callTmux(["kill-session", "-t", tmuxName]).catch(() => {});
          json(res, 403, { error: "Trusted device has been revoked." });
          return;
        }
      }
      let child;
      try {
        child = spawnPtyImpl(
          persistent ? "tmux" : shell,
        persistent ? [...tmuxArgs, "attach-session", "-t", tmuxName] : ["-l"],
          {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: project.path,
            env: {
              ...process.env,
              TERM: process.env.TERM || "xterm-256color",
              COLORTERM: process.env.COLORTERM || "truecolor"
            }
          }
        );
      } catch (error) {
        if (persistent) await callTmux(["kill-session", "-t", tmuxName]).catch(() => {});
        throw error;
      }

      const session = {
        id,
        token: null,
        tokenHash: tokenHash(token),
        name,
        persistent,
        tmuxName,
        projectId: project.id,
        projectName: project.name,
        cwd: project.path,
        ownerDeviceId: device?.id || null,
        process: child,
        createdAt: Date.now(),
        lastAttachedAt: null,
        lastActivityAt: Date.now(),
        expiresAt: persistent ? Date.now() + PERSISTENT_SESSION_TTL_MS : null,
        closed: false,
        exitCode: null,
        signal: null,
        seq: 0,
        output: [],
        outputBytes: 0,
        listeners: new Set(),
        sockets: new Set(),
        cleanupTimer: null
      };
      sessions.set(id, session);
      bindProcess(session, child);

      appendOutput(session, "system", `[DevMoter terminal · ${project.name}]\r\n`);
      if (persistent) {
        try {
          await persistSessions();
        } catch (error) {
          sessions.delete(id);
          session.closed = true;
          child.kill();
          await callTmux(["kill-session", "-t", tmuxName]).catch(() => {});
          json(res, 503, { error: "Persistent terminal metadata could not be stored safely." });
          return;
        }
      }
      if (device && revokedDeviceIds.has(device.id)) {
        sessions.delete(id);
        session.closed = true;
        if (persistent) await callTmux(["kill-session", "-t", tmuxName]).catch(() => {});
        try { child.kill("SIGTERM"); } catch { /* The revoked device cannot retain the new PTY. */ }
        if (persistent) await persistSessions().catch(() => {});
        json(res, 403, { error: "Trusted device has been revoked." });
        return;
      }
      if (persistent) {
        setSessionCookie(req, res, id, token, Math.floor(PERSISTENT_SESSION_TTL_MS / 1000));
      }
      json(res, 201, {
        session: publicSession(session),
        ...(persistent ? {} : { token })
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function info(req, res, id) {
    const session = await getAuthorizedSession(req, res, id);
    if (!session) return;
    if (!sessionDeviceAllowed(session, res)) return;
    session.lastAttachedAt = Date.now();
    json(res, 200, { session: publicSession(session) });
  }

  async function input(req, res, id) {
    const session = await getAuthorizedSession(req, res, id);
    if (!session) return;
    try {
      const payload = await readJson(req, 48 * 1024);
      const data = String(payload?.data || "");
      if (!data) {
        json(res, 200, { ok: true });
        return;
      }
      if (Buffer.byteLength(data, "utf8") > 32 * 1024) {
        json(res, 413, { error: "Terminal input chunk is too large." });
        return;
      }
      if (!sessionDeviceAllowed(session, res)) return;
      session.lastActivityAt = Date.now();
      session.process.write(data);
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function issueSocketTicket(req, res, id) {
    const session = await getAuthorizedSession(req, res, id);
    if (!session) return;
    if (!sessionDeviceAllowed(session, res)) return;
    const origin = String(req.headers.origin || "");
    if (!origin) {
      json(res, 403, { error: "Terminal socket Origin is required." });
      return;
    }
    for (const [ticket, value] of socketTickets) {
      if (value.sessionId === id || value.expiresAt <= Date.now()) socketTickets.delete(ticket);
    }
    if (socketTickets.size >= MAX_PENDING_SOCKET_TICKETS) {
      json(res, 429, { error: "Too many pending terminal connections." });
      return;
    }
    const ticket = randomBytes(32).toString("hex");
    socketTickets.set(ticket, {
      sessionId: id,
      origin,
      deviceId: session.ownerDeviceId || null,
      expiresAt: Date.now() + SOCKET_TICKET_TTL_MS
    });
    json(res, 201, { ticket, expiresInMs: SOCKET_TICKET_TTL_MS });
  }

  async function listSessions(req, res) {
    if (!auth(req, res)) return;
    try {
      await ensureStoreLoaded();
      const device = await trustedDevice(req, res);
      if (device === false) return;
      const result = [];
      for (const session of sessions.values()) {
        if (session.persistent && !session.process && !session.closed) {
          if (session.expiresAt <= Date.now()) {
            session.closed = true;
            await callTmux(["kill-session", "-t", session.tmuxName]).catch(() => {});
            await removePersistedSession(session).catch(() => {});
          } else {
            try {
              await callTmux(["has-session", "-t", session.tmuxName]);
            } catch {
              session.closed = true;
              await removePersistedSession(session).catch(() => {});
            }
          }
        }
        result.push({
          ...publicSession(session),
          status: session.closed ? "exited" : session.process ? "attached" : "detached"
        });
      }
      if (device && revokedDeviceIds.has(device.id)) {
        json(res, 403, { error: "Trusted device has been revoked." });
        return;
      }
      json(res, 200, { sessions: result });
    } catch {
      json(res, 503, { error: "Persistent terminal state is unavailable." });
    }
  }

  async function claimSession(req, res, id) {
    if (!auth(req, res)) return;
    try {
      await ensureStoreLoaded();
      const device = await trustedDevice(req, res);
      if (device === false) return;
      const session = sessions.get(id);
      if (!session || !session.persistent || session.closed || session.expiresAt <= Date.now()) {
        json(res, 404, { error: "Persistent terminal session not found." });
        return;
      }
      if (String(req.headers["x-devmoter-terminal-entry"] || "") !== "explicit") {
        json(res, 400, { error: "Terminal session claim must be explicit." });
        return;
      }
      const project = await resolveProject(session.projectId);
      if (project.path !== session.cwd) {
        json(res, 409, { error: "Project registration changed; terminal re-attach denied." });
        return;
      }
      try {
        await callTmux(["has-session", "-t", session.tmuxName]);
      } catch {
        json(res, 410, { error: "Persistent terminal session is no longer running." });
        return;
      }
      if (device && revokedDeviceIds.has(device.id)) {
        json(res, 403, { error: "Trusted device has been revoked." });
        return;
      }
      const token = randomBytes(32).toString("hex");
      const previousTokenHash = session.tokenHash;
      const previousOwnerDeviceId = session.ownerDeviceId || null;
      session.tokenHash = tokenHash(token);
      if (device) session.ownerDeviceId = device.id;
      try {
        await persistSessions();
      } catch {
        session.tokenHash = previousTokenHash;
        session.ownerDeviceId = previousOwnerDeviceId;
        throw new Error("Persistent terminal state could not be updated safely.");
      }
      if (device && revokedDeviceIds.has(device.id)) {
        json(res, 403, { error: "Trusted device has been revoked." });
        return;
      }
      setSessionCookie(req, res, id, token, Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)));
      json(res, 200, { session: publicSession(session) });
    } catch {
      json(res, 503, { error: "Persistent terminal state is unavailable." });
    }
  }

  async function authorizeSocket(req, id, ticket, origin) {
    const grant = socketTickets.get(ticket);
    if (!grant || grant.sessionId !== id || grant.origin !== origin || grant.expiresAt <= Date.now()) {
      if (grant) socketTickets.delete(ticket);
      return null;
    }
    socketTickets.delete(ticket);
    const session = sessions.get(id);
    if (!session) return null;
    if ((grant.deviceId || null) !== (session.ownerDeviceId || null)) return null;
    if (grant.deviceId && isDeviceActive) {
      try {
        if (!(await isDeviceActive(grant.deviceId))) return null;
      } catch {
        return null;
      }
    }
    try {
      const project = await resolveProject(session.projectId);
      if (project.path !== session.cwd) return null;
    } catch {
      return null;
    }
    if (grant.deviceId && revokedDeviceIds.has(grant.deviceId)) return null;
    if (session.persistent && !session.process && !(await attachPersistentProcess(session))) return null;
    if (!sessionDeviceAllowed(session)) return null;
    return session;
  }

  function attachSocket(session, socket, after = 0) {
    if (!sessionDeviceAllowed(session)) {
      socket.close(1008, "Trusted device revoked.");
      return false;
    }
    if (session.sockets.size >= MAX_SOCKET_CLIENTS_PER_SESSION) {
      socket.close(1013, "Terminal connection limit reached.");
      return false;
    }
    session.lastAttachedAt = Date.now();
    session.sockets.add(socket);
    let inputWindowStartedAt = Date.now();
    let inputWindowMessages = 0;
    const write = item => {
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount > 256 * 1024) {
        socket.close(1013, "Terminal client is too slow.");
        return;
      }
      try { socket.send(JSON.stringify(item), error => { if (error) socket.terminate?.(); }); }
      catch { socket.terminate?.(); }
    };
    for (const item of session.output) {
      if (item.seq > after) write(item);
    }
    if (session.closed) {
      socket.close(1000, "Terminal process exited.");
      return true;
    }
    const listener = item => write(item);
    session.listeners.add(listener);
    socket.on("message", (message, isBinary) => {
      if (session.closed) {
        socket.close(1008, "Terminal session is closed.");
        return;
      }
      try {
        const now = Date.now();
        if (now - inputWindowStartedAt >= 1000) {
          inputWindowStartedAt = now;
          inputWindowMessages = 0;
        }
        if (++inputWindowMessages > 120 || isBinary) throw new Error("message_rate_or_type_limit");
        if (Buffer.byteLength(message) > 40 * 1024) throw new Error("message_too_large");
        const payload = JSON.parse(message.toString("utf8"));
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_message");
        if (payload.type === "input" && typeof payload.data === "string") {
          if (Buffer.byteLength(payload.data, "utf8") > 32 * 1024) throw new Error("input_too_large");
          if (payload.data) {
            session.lastActivityAt = Date.now();
            session.process.write(payload.data);
          }
          return;
        }
        if (payload.type === "resize" && Number.isInteger(payload.cols) && Number.isInteger(payload.rows)) {
          if (payload.cols < 1 || payload.cols > MAX_TERMINAL_COLS || payload.rows < 1 || payload.rows > MAX_TERMINAL_ROWS) {
            throw new Error("invalid_terminal_size");
          }
          session.process.resize(payload.cols, payload.rows);
          return;
        }
        throw new Error("unsupported_message");
      } catch {
        socket.close(1008, "Invalid terminal message.");
      }
    });
    const detach = () => {
      session.listeners.delete(listener);
      session.sockets.delete(socket);
    };
    socket.once("close", detach);
    socket.once("error", detach);
    return true;
  }

  function closeSockets(session, code, reason) {
    for (const socket of session.sockets) {
      try { socket.close(code, reason); } catch { socket.terminate?.(); }
    }
  }

  async function stream(req, res, id, after = 0) {
    const session = await getAuthorizedSession(req, res, id);
    if (!session) return;
    if (!sessionDeviceAllowed(session, res)) return;
    session.lastAttachedAt = Date.now();

    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });

    const write = item => {
      res.write(`${JSON.stringify(item)}\n`);
    };

    for (const item of session.output) {
      if (item.seq > Number(after || 0)) write(item);
    }

    if (session.closed) {
      res.end();
      return;
    }

    const listener = item => write(item);
    session.listeners.add(listener);
    const heartbeat = setInterval(() => {
      res.write(`${JSON.stringify({ type: "heartbeat", at: Date.now() })}\n`);
    }, 20000);
    heartbeat.unref?.();

    req.on("close", () => {
      clearInterval(heartbeat);
      session.listeners.delete(listener);
    });
  }

  async function close(req, res, id) {
    const session = await getAuthorizedSession(req, res, id);
    if (!session) return;
    if (!sessionDeviceAllowed(session, res)) return;
    if (!session.closed) {
      if (session.persistent) {
        await callTmux(["kill-session", "-t", session.tmuxName]).catch(() => {});
        session.closed = true;
        closeSockets(session, 1000, "Terminal session terminated.");
        if (session.process) session.process.kill("SIGTERM");
        await removePersistedSession(session).catch(() => {});
      } else {
        session.process.kill("SIGTERM");
        const force = setTimeout(() => {
          if (!session.closed) session.process?.kill("SIGKILL");
        }, 2000);
        force.unref?.();
      }
    }
    if (!sessionDeviceAllowed(session, res)) return;
    if (session.persistent) setSessionCookie(req, res, id, "", 0);
    json(res, 200, { ok: true, session: publicSession(session) });
  }

  async function revokeDeviceSessions(deviceId) {
    const id = String(deviceId || "");
    if (!id) return { terminated: 0 };
    revokedDeviceIds.add(id);
    let metadataUnavailable = false;
    try {
      await ensureStoreLoaded();
    } catch {
      // Continue revoking already loaded sessions even if saved metadata is corrupt.
      metadataUnavailable = true;
    }
    const affected = [...sessions.values()].filter(session => session.ownerDeviceId === id);
    for (const session of affected) {
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      session.closed = true;
      closeSockets(session, 1008, "Trusted device revoked.");
      if (session.persistent) await callTmux(["kill-session", "-t", session.tmuxName]).catch(() => {});
      try { session.process?.kill("SIGTERM"); } catch { /* Revocation still closes the session capability. */ }
      sessions.delete(session.id);
    }
    let metadataUpdated = true;
    if (affected.some(session => session.persistent) && sessionStore && storeLoaded) {
      try {
        await persistSessions();
      } catch {
        metadataUpdated = false;
      }
    }
    if (metadataUnavailable && !storeLoaded && sessionStore) {
      try {
        const { stdout = "" } = await callTmux(["list-sessions", "-F", "#{session_name}"]);
        const managedNames = String(stdout).split(/\r?\n/).filter(name => /^devmoter-[a-f0-9]{24}$/.test(name));
        for (const name of managedNames) await callTmux(["kill-session", "-t", name]).catch(() => {});
      } catch {
        // The unavailable private state cannot authorize keeping orphaned managed PTYs alive.
      }
    }
    for (const [ticket, grant] of socketTickets) {
      if (grant.deviceId === id) socketTickets.delete(ticket);
    }
    return { terminated: affected.length, metadataUpdated };
  }

  async function sweepIdle() {
    const now = Date.now();
    for (const [ticket, grant] of socketTickets) {
      if (grant.expiresAt <= now) socketTickets.delete(ticket);
    }
    for (const session of sessions.values()) {
      if (session.persistent && !session.closed && now >= session.expiresAt) {
        await callTmux(["kill-session", "-t", session.tmuxName]).catch(() => {});
        session.closed = true;
        closeSockets(session, 1000, "Terminal session expired.");
        if (session.process) session.process.kill("SIGTERM");
        await removePersistedSession(session).catch(() => {});
        continue;
      }
      if (!session.closed && now - session.lastActivityAt > SESSION_IDLE_LIMIT_MS) {
        session.process.kill("SIGTERM");
      }
    }
  }

  const sweepTimer = setInterval(() => void sweepIdle(), 15 * 60 * 1000);
  sweepTimer.unref?.();

  function shutdown() {
    clearInterval(sweepTimer);
    for (const session of sessions.values()) {
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      closeSockets(session, 1001, "DevMoter is shutting down.");
      if (!session.closed && session.process) {
        if (session.persistent) session.detaching = true;
        session.process.kill();
      }
    }
    socketTickets.clear();
  }

  return {
    configured: terminalPasswordConfigured(password),
    create,
    info,
    input,
    stream,
    listSessions,
    claimSession,
    revokeDeviceSessions,
    issueSocketTicket,
    authorizeSocket,
    attachSocket,
    close,
    shutdown
  };
}
