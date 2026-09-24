import { WebSocketServer } from "ws";
import { expectedRequestOrigin } from "./auth.mjs";

const TERMINAL_SOCKET_PATH = /^\/api\/terminal\/sessions\/([a-f0-9]{36})\/socket$/;
const TERMINAL_PROTOCOL = "devmoter-terminal.v1";
const TICKET_PROTOCOL_PREFIX = "devmoter-ticket.";

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

export function installTerminalWebSocketEndpoint(server, terminal, { publicOrigin = "" } = {}) {
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 40 * 1024,
    perMessageDeflate: false,
    handleProtocols(protocols) {
      return protocols.has(TERMINAL_PROTOCOL) ? TERMINAL_PROTOCOL : false;
    }
  });

  const onUpgrade = (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    const match = url.pathname.match(TERMINAL_SOCKET_PATH);
    if (!match || req.method !== "GET") {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const origin = String(req.headers.origin || "");
    const expectedOrigin = expectedRequestOrigin(req, publicOrigin);
    let normalizedOrigin = "";
    try { normalizedOrigin = new URL(origin).origin; } catch { /* rejected below */ }
    if (!origin || origin === "null" || !expectedOrigin || normalizedOrigin !== expectedOrigin) {
      rejectUpgrade(socket);
      return;
    }

    const protocols = parseProtocols(req);
    const ticketValue = protocols.find(value => value.startsWith(TICKET_PROTOCOL_PREFIX)) || "";
    const ticket = ticketValue.slice(TICKET_PROTOCOL_PREFIX.length);
    if (!protocols.includes(TERMINAL_PROTOCOL) || !/^[a-f0-9]{64}$/.test(ticket)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    let id;
    try { id = decodeURIComponent(match[1]); } catch {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    void terminal.authorizeSocket(req, id, ticket, origin).then(session => {
      if (!session || socket.destroyed) {
        rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      const afterValue = Number(url.searchParams.get("after") || 0);
      const after = Number.isSafeInteger(afterValue) && afterValue > 0
        ? Math.min(afterValue, session.seq)
        : 0;
      webSockets.handleUpgrade(req, socket, head, webSocket => {
        terminal.attachSocket(session, webSocket, after);
      });
    }).catch(() => rejectUpgrade(socket));
  };

  server.on("upgrade", onUpgrade);
  return {
    close() {
      server.off("upgrade", onUpgrade);
      webSockets.close();
    }
  };
}
