import { MAX_BACKUP_BYTES } from "./prompt-template-store.mjs";

const BASE = "/api/prompt-templates";

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

export function isPromptTemplatePath(pathname) {
  return pathname === BASE || pathname.startsWith(BASE + "/");
}

// Templates are stored text only: no route here sends, runs or expands one.
export function createPromptTemplateApi({ store, authenticateDevice, claimOperation = () => true } = {}) {
  if (!store || typeof authenticateDevice !== "function") throw new Error("Prompt template API dependencies are required");
  return {
    async handle(req, res, url) {
      if (!isPromptTemplatePath(url.pathname)) return false;
      try {
        const device = await authenticateDevice(req);
        if (!device?.id) { send(res, 401, { error: "Trusted device required" }); return true; }
        if (url.pathname === BASE) {
          if (req.method === "GET") {
            const all = url.searchParams.get("scope") === "all";
            send(res, 200, { templates: await store.list({ all, projectId: url.searchParams.get("projectId") }) });
            return true;
          }
          if (req.method === "POST") {
            if (!claimOperation(req, res, `prompt-templates:${device.id}:create`)) return true;
            send(res, 201, { template: await store.create(await readBody(req, 256 * 1024)) });
            return true;
          }
          send(res, 405, { error: "Method not allowed" }); return true;
        }
        if (url.pathname === `${BASE}/export`) {
          if (req.method !== "GET") { send(res, 405, { error: "Method not allowed" }); return true; }
          send(res, 200, await store.exportBackup()); return true;
        }
        if (url.pathname === `${BASE}/import`) {
          if (req.method !== "POST") { send(res, 405, { error: "Method not allowed" }); return true; }
          if (!claimOperation(req, res, `prompt-templates:${device.id}:import`)) return true;
          const payload = await readBody(req, MAX_BACKUP_BYTES);
          const conflict = payload?.conflict === undefined ? "skip" : payload.conflict;
          send(res, 200, await store.importBackup(payload?.backup, { conflict })); return true;
        }
        const match = url.pathname.match(/^\/api\/prompt-templates\/([^/]+)$/);
        if (!match) { send(res, 404, { error: "Unknown prompt template endpoint" }); return true; }
        let id;
        try { id = decodeURIComponent(match[1]); } catch { send(res, 400, { error: "Invalid template ID" }); return true; }
        if (req.method === "GET") { send(res, 200, { template: await store.read(id) }); return true; }
        if (req.method === "PATCH" || req.method === "PUT") {
          if (!claimOperation(req, res, `prompt-templates:${device.id}:${id}:update`)) return true;
          send(res, 200, { template: await store.update(id, await readBody(req, 256 * 1024)) }); return true;
        }
        if (req.method === "DELETE") {
          if (!claimOperation(req, res, `prompt-templates:${device.id}:${id}:delete`)) return true;
          send(res, 200, await store.remove(id)); return true;
        }
        send(res, 405, { error: "Method not allowed" }); return true;
      } catch (error) {
        const status = Number(error?.status) || 400;
        send(res, status, { error: status >= 500 ? "Prompt template operation failed" : (error instanceof Error ? error.message : "Prompt template operation failed") });
        return true;
      }
    }
  };
}
