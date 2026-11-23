import { remoteBrowserPolicy } from "./browser-session.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const SESSION_PATH = /^\/api\/browser\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(actions|driver|screenshot|ticket))?$/;

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw Object.assign(new Error("Request body must be a JSON object"), { statusCode: 400 });
  }
}

function errorBody(error) {
  return { error: String(error?.message || error || "Browser request failed").slice(0, 500), code: error?.code || undefined };
}

/**
 * /api/browser routes. Every route requires an active trusted device (same as
 * workspace control); the composition root has already enforced owner auth,
 * same-origin mutation checks and operation-id de-duplication.
 */
export async function handleBrowserApiRequest(req, res, url, manager, { authenticateDevice, tickets } = {}) {
  const path = url.pathname;
  if (path !== "/api/browser" && !path.startsWith("/api/browser/")) return false;
  try {
    const device = typeof authenticateDevice === "function" ? await authenticateDevice(req) : null;
    if (!device?.id) {
      sendJson(res, 403, { error: "Trusted device required" });
      return true;
    }

    if (req.method === "GET" && path === "/api/browser") {
      sendJson(res, 200, { ...manager.status(url.searchParams.get("projectId") || "", { deviceId: device.id }), policy: remoteBrowserPolicy });
      return true;
    }

    if (req.method === "POST" && path === "/api/browser/sessions") {
      const payload = await readJson(req);
      const result = await manager.start(payload.projectId, { viewport: payload.viewport, deviceId: device.id });
      sendJson(res, 201, result);
      return true;
    }

    const match = path.match(SESSION_PATH);
    if (!match) {
      sendJson(res, 404, { error: "Browser route not found" });
      return true;
    }
    const [, sessionId, sub] = match;

    if (!sub && req.method === "GET") {
      sendJson(res, 200, { session: manager.get(sessionId, { deviceId: device.id }) });
      return true;
    }
    if (!sub && req.method === "DELETE") {
      sendJson(res, 200, await manager.stop(sessionId, "user_stopped", { deviceId: device.id }));
      return true;
    }
    if (sub === "driver" && req.method === "POST") {
      const payload = await readJson(req);
      if (payload.op === "acquire") {
        sendJson(res, 200, { driver: manager.acquireDriver(sessionId, { holder: "user", deviceId: device.id }) });
      } else if (payload.op === "release") {
        sendJson(res, 200, { driver: manager.releaseDriver(sessionId, { holder: "user", generation: payload.generation, deviceId: device.id }) });
      } else {
        sendJson(res, 400, { error: "Driver op must be acquire or release", code: "invalid_driver" });
      }
      return true;
    }
    if (sub === "actions" && req.method === "POST") {
      const payload = await readJson(req);
      const result = await manager.act(sessionId, payload.action, {
        holder: "user",
        generation: payload.generation,
        deviceId: device.id
      });
      if (Buffer.isBuffer(result.data)) result.data = result.data.toString("base64");
      sendJson(res, 200, result);
      return true;
    }
    if (sub === "ticket" && req.method === "POST") {
      const origin = String(req.headers.origin || "");
      if (!origin || !tickets) {
        sendJson(res, 403, { error: "Browser socket Origin is required" });
        return true;
      }
      const session = manager.get(sessionId, { deviceId: device.id });
      sendJson(res, 201, tickets.issue({ sessionId, deviceId: device.id, origin, generation: session.driver.generation }));
      return true;
    }
    if (sub === "screenshot" && req.method === "GET") {
      const format = url.searchParams.get("format") === "png" ? "png" : "jpeg";
      const quality = url.searchParams.get("quality");
      const result = await manager.act(sessionId, { type: "screenshot", format, quality: quality ?? undefined }, { deviceId: device.id });
      res.writeHead(200, {
        "content-type": result.mime,
        "content-length": result.data.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      res.end(result.data);
      return true;
    }
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 500);
    sendJson(res, status >= 400 && status < 600 ? status : 500, errorBody(error));
    return true;
  }
}
