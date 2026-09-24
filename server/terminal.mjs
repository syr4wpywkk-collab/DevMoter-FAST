import { randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { spawn as spawnPty } from "node-pty";

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

function sessionTokenFrom(req) {
  return String(req.headers["x-devmoter-terminal-token"] || "").trim();
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
  const spawnPtyImpl = options.spawnPty || spawnPty;
  const maxSessions = Math.max(1, Math.min(16, Math.floor(Number(options.maxSessions) || DEFAULT_MAX_SESSIONS)));
  const shell = resolveShell(options.shell || process.env.SHELL);
  if (typeof resolveProject !== "function") {
    throw new Error("Terminal manager requires resolveProject.");
  }

  const sessions = new Map();
  const socketTickets = new Map();

  function auth(req, res) {
    const result = authenticateTerminalRequest(req, password);
    if (result.ok) return true;
    if (result.challenge) {
      res.setHeader("www-authenticate", 'Basic realm="DevMoter Terminal"');
    }
    json(res, result.status, { error: result.error });
    return false;
  }

  async function getAuthorizedSession(req, res, id, { allowClosed = true } = {}) {
    if (!auth(req, res)) return null;
    const session = sessions.get(id);
    if (!session) {
      json(res, 404, { error: "Terminal session not found." });
      return null;
    }
    const supplied = sessionTokenFrom(req);
    if (!supplied || !safeEqualText(supplied, session.token)) {
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
    return session;
  }

  async function create(req, res) {
    if (!auth(req, res)) return;
    try {
      if (String(req.headers["x-devmoter-terminal-entry"] || "") !== "explicit") {
        json(res, 400, { error: "Terminal entry must be explicit." });
        return;
      }
      const payload = await readJson(req);
      const projectId = String(payload?.projectId || "").trim();
      if (!projectId) throw new Error("projectId is required.");
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
      const child = spawnPtyImpl(shell, ["-l"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: project.path,
        env: {
          ...process.env,
          TERM: process.env.TERM || "xterm-256color",
          COLORTERM: process.env.COLORTERM || "truecolor"
        }
      });

      const session = {
        id,
        token,
        projectId: project.id,
        projectName: project.name,
        cwd: project.path,
        process: child,
        createdAt: Date.now(),
        lastAttachedAt: null,
        lastActivityAt: Date.now(),
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

      child.onData(chunk => {
        session.lastActivityAt = Date.now();
        appendOutput(session, "stdout", chunk);
      });
      child.onExit(({ exitCode, signal }) => {
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
        session.cleanupTimer = setTimeout(() => sessions.delete(id), SESSION_RETENTION_MS);
        session.cleanupTimer.unref?.();
      });

      appendOutput(session, "system", `[DevMoter terminal · ${project.name}]\r\n`);
      json(res, 201, {
        session: publicSession(session),
        token
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function info(req, res, id) {
    const session = await getAuthorizedSession(req, res, id);
    if (!session) return;
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
    socketTickets.set(ticket, { sessionId: id, origin, expiresAt: Date.now() + SOCKET_TICKET_TTL_MS });
    json(res, 201, { ticket, expiresInMs: SOCKET_TICKET_TTL_MS });
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
    try {
      const project = await resolveProject(session.projectId);
      if (project.path !== session.cwd) return null;
    } catch {
      return null;
    }
    return session;
  }

  function attachSocket(session, socket, after = 0) {
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
    if (!session.closed) {
      session.process.kill("SIGTERM");
      const force = setTimeout(() => {
        if (!session.closed) session.process.kill("SIGKILL");
      }, 2000);
      force.unref?.();
    }
    json(res, 200, { ok: true, session: publicSession(session) });
  }

  async function sweepIdle() {
    const now = Date.now();
    for (const [ticket, grant] of socketTickets) {
      if (grant.expiresAt <= now) socketTickets.delete(ticket);
    }
    for (const session of sessions.values()) {
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
      if (!session.closed) session.process.kill();
    }
    socketTickets.clear();
  }

  return {
    configured: terminalPasswordConfigured(password),
    create,
    info,
    input,
    stream,
    issueSocketTicket,
    authorizeSocket,
    attachSocket,
    close,
    shutdown
  };
}
