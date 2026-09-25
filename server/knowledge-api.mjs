function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024 + 8192) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

export function createKnowledgeApi({ store, authenticateDevice, claimOperation = () => true } = {}) {
  if (!store || typeof authenticateDevice !== "function") throw new Error("Knowledge API dependencies are required");
  return {
    async handle(req, res, url) {
      if (url.pathname !== "/api/knowledge/notes" && !url.pathname.startsWith("/api/knowledge/notes/")) return false;
      try {
        const device = await authenticateDevice(req);
        if (!device?.id) { send(res, 401, { error: "Trusted device required" }); return true; }
        if (req.method === "GET" && url.pathname === "/api/knowledge/notes") {
          send(res, 200, { notes: await store.list() }); return true;
        }
        if (req.method === "POST" && url.pathname === "/api/knowledge/notes/rebuild") {
          if (!claimOperation(req, res, `knowledge:${device.id}:rebuild`)) return true;
          send(res, 200, await store.rebuild()); return true;
        }
        if (req.method === "POST" && url.pathname === "/api/knowledge/notes") {
          if (!claimOperation(req, res, `knowledge:${device.id}:create`)) return true;
          send(res, 201, { note: await store.create(await readBody(req)) }); return true;
        }
        const match = url.pathname.match(/^\/api\/knowledge\/notes\/([^/]+)$/);
        if (!match) { send(res, 404, { error: "Unknown Knowledge endpoint" }); return true; }
        let id;
        try { id = decodeURIComponent(match[1]); } catch { send(res, 400, { error: "Invalid note ID" }); return true; }
        if (req.method === "GET") { send(res, 200, { note: await store.read(id) }); return true; }
        if (req.method === "PATCH" || req.method === "PUT") {
          if (!claimOperation(req, res, `knowledge:${device.id}:${id}:update`)) return true;
          send(res, 200, { note: await store.update(id, await readBody(req)) }); return true;
        }
        if (req.method === "DELETE") {
          if (!claimOperation(req, res, `knowledge:${device.id}:${id}:delete`)) return true;
          send(res, 200, await store.remove(id)); return true;
        }
        send(res, 405, { error: "Method not allowed" }); return true;
      } catch (error) {
        send(res, Number(error?.status) || 400, { error: error instanceof Error ? error.message : "Knowledge operation failed" });
        return true;
      }
    }
  };
}
