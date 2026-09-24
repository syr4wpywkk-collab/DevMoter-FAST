import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";

const OUTPUT_LIMIT_BYTES = 512 * 1024;
const OUTPUT_LIMIT_CHUNKS = 4000;
const SESSION_RETENTION_MS = 15 * 60 * 1000;
const SESSION_IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 4;

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
  const spawnImpl = options.spawnImpl || spawn;
  const maxSessions = Math.max(1, Math.min(16, Math.floor(Number(options.maxSessions) || DEFAULT_MAX_SESSIONS)));
  const shell = resolveShell(options.shell || process.env.SHELL);
  if (typeof resolveProject !== "function") {
    throw new Error("Terminal manager requires resolveProject.");
  }

  const sessions = new Map();

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
      const command = `exec ${shell} -l`;
      const child = spawnImpl("script", ["-qefc", command, "/dev/null"], {
        cwd: project.path,
        env: {
          ...process.env,
          TERM: process.env.TERM || "xterm-256color",
          COLORTERM: process.env.COLORTERM || "truecolor"
        },
        stdio: ["pipe", "pipe", "pipe"]
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
        cleanupTimer: null
      };
      sessions.set(id, session);

      child.stdout.on("data", chunk => {
        session.lastActivityAt = Date.now();
        appendOutput(session, "stdout", chunk);
      });
      child.stderr.on("data", chunk => {
        session.lastActivityAt = Date.now();
        appendOutput(session, "stderr", chunk);
      });
      child.on("error", error => {
        if (session.closed) return;
        session.lastActivityAt = Date.now();
        appendOutput(session, "system", `\r\n[terminal error] ${error.message}\r\n`);
        session.closed = true;
        session.exitCode = null;
        session.signal = null;
        session.cleanupTimer = setTimeout(() => sessions.delete(id), SESSION_RETENTION_MS);
        session.cleanupTimer.unref?.();
      });
      child.on("exit", (code, signal) => {
        if (session.closed) return;
        session.closed = true;
        session.exitCode = code;
        session.signal = signal;
        session.lastActivityAt = Date.now();
        appendOutput(
          session,
          "system",
          `\r\n[terminal exited${code === null ? "" : ` with code ${code}`}${signal ? `, signal ${signal}` : ""}]\r\n`
        );
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
    const session = await getAuthorizedSession(req, res, id, { allowClosed: false });
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
      session.process.stdin.write(data);
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
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
      if (!session.closed) session.process.kill("SIGTERM");
    }
  }

  return {
    configured: terminalPasswordConfigured(password),
    create,
    info,
    input,
    stream,
    close,
    shutdown
  };
}
