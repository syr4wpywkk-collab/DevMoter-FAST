import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { expectedRequestOrigin, parseTrustedProxies } from "./auth.mjs";

const SOCKET_PATH = /^\/api\/browser\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/socket$/;
export const BROWSER_PROTOCOL = "devmoter-browser.v1";
const TICKET_PROTOCOL_PREFIX = "devmoter-ticket.";
export const BROWSER_TICKET_TTL_MS = 20 * 1000;
const MAX_PENDING_TICKETS = 32;
const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
const MAX_MESSAGES_PER_SECOND = 60;
const FRAME_HEADER_BYTES = 12;

// One-time WebSocket tickets: 32 random bytes, 20 s TTL, deleted before they
// are checked, bound to session, device, exact Origin and driver generation.
export function createBrowserSocketTickets({ now = Date.now, ttlMs = BROWSER_TICKET_TTL_MS, maxPending = MAX_PENDING_TICKETS } = {}) {
  const tickets = new Map();

  function prune() {
    const current = now();
    for (const [ticket, grant] of tickets) if (grant.expiresAt <= current) tickets.delete(ticket);
  }

  function issue({ sessionId, deviceId, origin, generation }) {
    prune();
    for (const [ticket, grant] of tickets) {
      if (grant.sessionId === sessionId && grant.deviceId === deviceId) tickets.delete(ticket);
    }
    if (tickets.size >= maxPending) {
      throw Object.assign(new Error("Too many pending browser connections"), { statusCode: 429, code: "ticket_limit" });
    }
    const ticket = randomBytes(32).toString("hex");
    tickets.set(ticket, { sessionId, deviceId, origin, generation, expiresAt: now() + ttlMs });
    return { ticket, expiresInMs: ttlMs };
  }

  function consume(ticket, { sessionId, origin }) {
    const grant = tickets.get(ticket);
    if (!grant) return null;
    tickets.delete(ticket);
    if (grant.sessionId !== sessionId || grant.origin !== origin || grant.expiresAt <= now()) return null;
    return grant;
  }

  function revokeDevice(deviceId) {
    for (const [ticket, grant] of tickets) if (grant.deviceId === deviceId) tickets.delete(ticket);
  }

  function revokeSession(sessionId) {
    for (const [ticket, grant] of tickets) if (grant.sessionId === sessionId) tickets.delete(ticket);
  }

  return { issue, consume, revokeDevice, revokeSession, get size() { prune(); return tickets.size; } };
}

// Binary frame: "DMBF" magic, uint32 seq, uint16 width, uint16 height, JPEG.
export function encodeFrame(frame) {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.write("DMBF", 0, "ascii");
  header.writeUInt32BE(frame.seq >>> 0, 4);
  header.writeUInt16BE(Math.min(frame.width, 0xffff), 8);
  header.writeUInt16BE(Math.min(frame.height, 0xffff), 10);
  return Buffer.concat([header, frame.data]);
}

function rejectUpgrade(socket, status = 403, message = "Forbidden") {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function parseProtocols(req) {
  return String(req.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : "action_failed";
}

export function bindBrowserViewer(webSocket, manager, grant, { now = Date.now } = {}) {
  let windowStart = now();
  let windowCount = 0;
  let handle = null;
  const send = value => {
    if (webSocket.readyState === webSocket.OPEN) webSocket.send(value);
  };
  const sink = {
    event: event => send(JSON.stringify(event)),
    frame: frame => send(encodeFrame(frame)),
    close: (code, reason) => webSocket.close(code, String(reason || "").slice(0, 120))
  };
  try {
    handle = manager.attachViewer(grant.sessionId, sink, { deviceId: grant.deviceId });
  } catch (error) {
    webSocket.close(4003, errorCode(error));
    return null;
  }
  webSocket.on("message", (data, isBinary) => {
    const current = now();
    if (current - windowStart >= 1000) {
      windowStart = current;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > MAX_MESSAGES_PER_SECOND) {
      webSocket.close(4029, "rate_limited");
      return;
    }
    if (isBinary || data.length > MAX_CLIENT_MESSAGE_BYTES) {
      webSocket.close(4400, "bad_message");
      return;
    }
    let message;
    try { message = JSON.parse(String(data)); } catch {
      webSocket.close(4400, "bad_message");
      return;
    }
    if (message?.t === "ack" && Number.isSafeInteger(message.seq)) {
      handle.ack(message.seq);
    } else if (message?.t === "act") {
      const id = Number.isSafeInteger(message.id) ? message.id : null;
      void manager.act(grant.sessionId, message.action, {
        holder: "user",
        generation: message.generation,
        deviceId: grant.deviceId
      }).then(result => {
        const { data: _data, ...rest } = result || {};
        send(JSON.stringify({ t: "result", id, ok: true, result: rest }));
      }, error => {
        send(JSON.stringify({ t: "result", id, ok: false, error: errorCode(error) }));
      });
    } else if (message?.t === "ping") {
      send(JSON.stringify({ t: "pong" }));
    } else {
      webSocket.close(4400, "bad_message");
    }
  });
  webSocket.on("close", () => handle.detach());
  webSocket.on("error", () => handle.detach());
  return handle;
}

export function installBrowserWebSocketEndpoint(
  server,
  manager,
  tickets,
  {
    publicOrigin = "",
    trustedProxies = parseTrustedProxies(process.env.DEVMOTER_TRUST_PROXY),
    isDeviceActive = async () => true
  } = {}
) {
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
    perMessageDeflate: false,
    handleProtocols(protocols) {
      return protocols.has(BROWSER_PROTOCOL) ? BROWSER_PROTOCOL : false;
    }
  });

  const onUpgrade = (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return;
    }
    const match = url.pathname.match(SOCKET_PATH);
    if (!match) return;
    socket.on("error", () => socket.destroy());
    if (req.method !== "GET") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = String(req.headers.origin || "");
    const expectedOrigin = expectedRequestOrigin(req, publicOrigin, { trustedProxies });
    let normalizedOrigin = "";
    try { normalizedOrigin = new URL(origin).origin; } catch { /* rejected below */ }
    if (!origin || origin === "null" || !expectedOrigin || normalizedOrigin !== expectedOrigin) {
      rejectUpgrade(socket);
      return;
    }
    const protocols = parseProtocols(req);
    const ticketValue = protocols.find(value => value.startsWith(TICKET_PROTOCOL_PREFIX)) || "";
    const ticket = ticketValue.slice(TICKET_PROTOCOL_PREFIX.length);
    if (!protocols.includes(BROWSER_PROTOCOL) || !/^[a-f0-9]{64}$/.test(ticket)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    const grant = tickets.consume(ticket, { sessionId: match[1], origin });
    if (!grant) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    void Promise.resolve(isDeviceActive(grant.deviceId)).then(active => {
      if (!active || socket.destroyed) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      let session;
      try {
        session = manager.get(grant.sessionId, { deviceId: grant.deviceId });
      } catch {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (session.driver.generation !== grant.generation) {
        rejectUpgrade(socket, 409, "Conflict");
        return;
      }
      webSockets.handleUpgrade(req, socket, head, webSocket => {
        bindBrowserViewer(webSocket, manager, grant);
      });
    }).catch(() => rejectUpgrade(socket));
  };

  server.on("upgrade", onUpgrade);
  return {
    close() {
      server.off("upgrade", onUpgrade);
      for (const client of webSockets.clients) client.terminate();
      webSockets.close();
    }
  };
}
