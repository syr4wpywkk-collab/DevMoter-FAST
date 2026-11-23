import { remoteBrowserPolicy } from "./browser-session.mjs";
import { MAX_MANUAL_TOKEN_TTL_MS, browserActionClass, capabilitiesForAccess } from "./browser-agent.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const AGENT_TOKEN_PATH = /^\/api\/browser\/agent-tokens(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/;
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
export async function handleBrowserApiRequest(req, res, url, manager, { authenticateDevice, tickets, agentTokens, audit, resolveProject, mcpClientConfig } = {}) {
  const path = url.pathname;
  if (path !== "/api/browser" && !path.startsWith("/api/browser/")) return false;
  try {
    const device = typeof authenticateDevice === "function" ? await authenticateDevice(req) : null;
    if (!device?.id) {
      sendJson(res, 403, { error: "Trusted device required" });
      return true;
    }
    const log = entry => audit?.record({ actor: "user", deviceId: device.id, ...entry });
    const tokenMatch = path.match(AGENT_TOKEN_PATH);
    if (tokenMatch) {
      if (!agentTokens) {
        sendJson(res, 404, { error: "Browser agent tokens are not available" });
        return true;
      }
      const [, tokenId] = tokenMatch;
      if (!tokenId && req.method === "GET") {
        sendJson(res, 200, { tokens: agentTokens.list({ deviceId: device.id }) });
        return true;
      }
      if (!tokenId && req.method === "POST") {
        const payload = await readJson(req);
        const project = typeof resolveProject === "function"
          ? await Promise.resolve(resolveProject(String(payload.projectId || ""))).catch(() => null)
          : null;
        if (!project?.id) {
          sendJson(res, 404, { error: "Registered project not found", code: "project_not_found" });
          return true;
        }
        const minutes = Math.min(Math.max(Math.floor(Number(payload.ttlMinutes) || 30), 1), MAX_MANUAL_TOKEN_TTL_MS / 60000);
        const issued = agentTokens.issue({
          projectId: project.id,
          capabilities: capabilitiesForAccess(payload.access === "act" ? "act" : "read"),
          deviceId: device.id,
          ttlMs: minutes * 60 * 1000,
          label: "manual"
        });
        log({ event: "agent_token_issue", projectId: project.id, tokenId: issued.record.id, capability: issued.record.capabilities.join(","), ok: true });
        sendJson(res, 201, { token: issued.token, tokenRecord: issued.record, mcp: mcpClientConfig || null });
        return true;
      }
      if (tokenId && req.method === "DELETE") {
        const owned = agentTokens.list({ deviceId: device.id }).some(record => record.id === tokenId);
        const revoked = owned ? agentTokens.revoke(tokenId) : 0;
        log({ event: "agent_token_revoke", tokenId, ok: revoked > 0 });
        sendJson(res, revoked ? 200 : 404, revoked ? { ok: true } : { error: "Agent token not found" });
        return true;
      }
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }

    if (req.method === "GET" && path === "/api/browser") {
      sendJson(res, 200, { ...manager.status(url.searchParams.get("projectId") || "", { deviceId: device.id }), policy: remoteBrowserPolicy });
      return true;
    }

    if (req.method === "POST" && path === "/api/browser/sessions") {
      const payload = await readJson(req);
      const result = await manager.start(payload.projectId, { viewport: payload.viewport, deviceId: device.id });
      log({ event: "start", projectId: result.session?.projectId, sessionId: result.session?.id, ok: true });
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
      const stopped = await manager.stop(sessionId, "user_stopped", { deviceId: device.id });
      log({ event: "stop", sessionId, ok: true });
      sendJson(res, 200, stopped);
      return true;
    }
    if (sub === "driver" && req.method === "POST") {
      const payload = await readJson(req);
      if (payload.op === "acquire") {
        const driver = manager.acquireDriver(sessionId, { holder: "user", deviceId: device.id });
        log({ event: "driver_acquire", sessionId, ok: true, driverGeneration: driver.generation });
        sendJson(res, 200, { driver });
      } else if (payload.op === "release") {
        const driver = manager.releaseDriver(sessionId, { holder: "user", generation: payload.generation, deviceId: device.id });
        log({ event: "driver_release", sessionId, ok: true });
        sendJson(res, 200, { driver });
      } else {
        sendJson(res, 400, { error: "Driver op must be acquire or release", code: "invalid_driver" });
      }
      return true;
    }
    if (sub === "actions" && req.method === "POST") {
      const payload = await readJson(req);
      const action = payload.action && typeof payload.action === "object" ? payload.action : {};
      let result;
      try {
        result = await manager.act(sessionId, payload.action, {
          holder: "user",
          generation: payload.generation,
          deviceId: device.id
        });
      } catch (error) {
        log({ event: "action", sessionId, action, capability: browserActionClass(action.type), ok: false, code: error?.code || "action_failed" });
        throw error;
      }
      log({ event: "action", sessionId, action, capability: browserActionClass(action.type), ok: result.ok !== false });
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
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    // Unexpected failures may carry internal details; only deliberate HTTP errors are echoed.
    sendJson(res, safeStatus, safeStatus >= 500 && !error?.code ? { error: "Browser request failed" } : errorBody(error));
    return true;
  }
}
