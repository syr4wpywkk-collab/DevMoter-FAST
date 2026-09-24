const MAX_BODY_BYTES = 256 * 1024;
const UNLOCK_WINDOW_MS = 10 * 60_000;
const MAX_UNLOCK_ATTEMPTS = 5;

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function httpStatus(error) {
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) return error.status;
  return 400;
}

export function createSecretVaultApi({ store, authenticateDevice, resolveProject, now = Date.now } = {}) {
  if (!store || typeof authenticateDevice !== "function" || typeof resolveProject !== "function") {
    throw new Error("Secret Vault API dependencies are required.");
  }
  const unlockAttempts = new Map();

  function assertUnlockRateLimit(deviceId) {
    const cutoff = now() - UNLOCK_WINDOW_MS;
    const recent = (unlockAttempts.get(deviceId) || []).filter(timestamp => timestamp > cutoff);
    if (recent.length >= MAX_UNLOCK_ATTEMPTS) {
      unlockAttempts.set(deviceId, recent);
      throw Object.assign(new Error("Too many vault unlock attempts; try again later."), { status: 429 });
    }
    recent.push(now());
    unlockAttempts.set(deviceId, recent);
    if (unlockAttempts.size > 512) {
      for (const [id, attempts] of unlockAttempts) {
        if (!attempts.some(timestamp => timestamp > cutoff)) unlockAttempts.delete(id);
      }
    }
  }

  return {
    async handle(req, res, url) {
      const path = url.pathname;
      if (path !== "/api/secrets" && !path.startsWith("/api/secrets/")) return false;

      try {
        const device = await authenticateDevice(req);
        if (!device?.id) {
          sendJson(res, 401, { error: "Trusted device required" });
          return true;
        }

        if (req.method === "GET" && path === "/api/secrets/status") {
          sendJson(res, 200, await store.status());
          return true;
        }

        if (req.method === "GET" && path === "/api/secrets") {
          sendJson(res, 200, { secrets: await store.list() });
          return true;
        }

        if (req.method === "POST" && ["/api/secrets/initialize", "/api/secrets/unlock"].includes(path)) {
          assertUnlockRateLimit(device.id);
          const payload = await readJson(req);
          if (typeof payload.passphrase !== "string") {
            throw Object.assign(new Error("Vault passphrase is required."), { status: 400 });
          }
          const result = path.endsWith("/initialize")
            ? await store.initialize(payload.passphrase)
            : await store.unlock(payload.passphrase);
          unlockAttempts.delete(device.id);
          sendJson(res, 200, result);
          return true;
        }

        if (req.method === "POST" && path === "/api/secrets/lock") {
          sendJson(res, 200, await store.lock());
          return true;
        }

        if (req.method === "PUT" && path === "/api/secrets") {
          const payload = await readJson(req);
          if (!Array.isArray(payload.projectIds) || payload.projectIds.length === 0) {
            throw Object.assign(new Error("Bind each secret to at least one registered project."), { status: 400 });
          }
          const projectIds = [...new Set(payload.projectIds)];
          if (projectIds.length > 100 || projectIds.some(id => typeof id !== "string" || !id || id.length > 128)) {
            throw Object.assign(new Error("Secret project binding is invalid."), { status: 400 });
          }
          await Promise.all(projectIds.map(id => resolveProject(id)));
          const reference = `secret://${payload.provider}/${payload.name}`;
          const existing = (await store.list()).find(item => item.reference === reference);
          if (existing && payload.confirmReplace !== true) {
            throw Object.assign(new Error("Secret already exists; explicit replacement confirmation is required."), { status: 409 });
          }
          const { confirmReplace: _confirmReplace, ...secretInput } = payload;
          const metadata = await store.set({ ...secretInput, projectIds });
          sendJson(res, 200, { secret: metadata });
          return true;
        }

        const secretMatch = path.match(/^\/api\/secrets\/([^/]+)\/([^/]+)$/);
        if (req.method === "DELETE" && secretMatch) {
          const provider = decodeURIComponent(secretMatch[1]);
          const name = decodeURIComponent(secretMatch[2]);
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(provider) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name)) {
            throw Object.assign(new Error("Secret reference is invalid."), { status: 400 });
          }
          const reference = `secret://${provider}/${name}`;
          const payload = await readJson(req);
          if (payload.confirmReference !== reference) {
            throw Object.assign(new Error("Explicit secret deletion confirmation is required."), { status: 400 });
          }
          sendJson(res, 200, await store.remove(reference));
          return true;
        }

        sendJson(res, 404, { error: "Unknown Secret Vault endpoint" });
        return true;
      } catch (error) {
        sendJson(res, httpStatus(error), {
          error: error instanceof Error ? error.message : "Secret Vault operation failed"
        });
        return true;
      }
    }
  };
}
