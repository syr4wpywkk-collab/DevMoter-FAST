function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

const APPROVAL_DECISIONS = new Set(["accept", "acceptForSession", "decline", "cancel"]);

export function createAgentRunApi({
  service,
  authenticateDevice,
  claimOperation = () => true
} = {}) {
  if (!service || typeof authenticateDevice !== "function") {
    throw new Error("Agent run API dependencies are required");
  }

  return {
    async handle(req, res, url) {
      if (
        !url.pathname.startsWith("/api/agent-runs") &&
        !url.pathname.startsWith("/api/agent-fleets")
      ) return false;

      try {
        const device = await authenticateDevice(req);
        if (!device?.id) {
          send(res, 401, { error: "Trusted device required" });
          return true;
        }

        if (req.method === "GET" && url.pathname === "/api/agent-runs") {
          send(res, 200, await service.list());
          return true;
        }

        if (req.method === "GET" && url.pathname === "/api/agent-runs/events") {
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "connection": "keep-alive"
          });
          const writeState = state => {
            res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
          };
          writeState(await service.list());
          const unsubscribe = service.subscribe(writeState);
          const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
          heartbeat.unref?.();
          req.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
          });
          return true;
        }

        if (req.method === "POST" && url.pathname === "/api/agent-runs") {
          if (!claimOperation(req, res, `agent-runs:${device.id}:spawn`)) return true;
          const body = await readBody(req);
          send(res, 201, { run: await service.spawn(body?.spec || body) });
          return true;
        }

        if (req.method === "POST" && url.pathname === "/api/agent-fleets") {
          if (!claimOperation(req, res, `agent-fleets:${device.id}:spawn`)) return true;
          const body = await readBody(req);
          const specs = Array.isArray(body?.specs) ? body.specs : [];
          send(res, 201, {
            fleet: await service.runFleet(specs, {
              id: body?.id,
              concurrency: body?.concurrency
            })
          });
          return true;
        }

        const secondOpinion = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/second-opinion$/);
        if (req.method === "POST" && secondOpinion) {
          const id = decodeURIComponent(secondOpinion[1]);
          if (!claimOperation(req, res, `agent-runs:${device.id}:${id}:second-opinion`)) return true;
          send(res, 201, {
            run: await service.spawnSecondOpinion(id, await readBody(req))
          });
          return true;
        }

        const runAction = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/(cancel|approval)$/);
        if (req.method === "POST" && runAction) {
          const id = decodeURIComponent(runAction[1]);
          const action = runAction[2];
          if (!claimOperation(req, res, `agent-runs:${device.id}:${id}:${action}`)) return true;

          if (action === "cancel") {
            send(res, 200, { run: await service.cancel(id) });
            return true;
          }

          const body = await readBody(req);
          const decision = String(body?.decision || "");
          if (!APPROVAL_DECISIONS.has(decision)) {
            send(res, 400, { error: "Unsupported approval decision" });
            return true;
          }
          send(res, 200, { run: await service.respondApproval(id, decision) });
          return true;
        }

        const fleetCancel = url.pathname.match(/^\/api\/agent-fleets\/([^/]+)\/cancel$/);
        if (req.method === "POST" && fleetCancel) {
          const id = decodeURIComponent(fleetCancel[1]);
          if (!claimOperation(req, res, `agent-fleets:${device.id}:${id}:cancel`)) return true;
          send(res, 200, { fleet: await service.cancelFleet(id) });
          return true;
        }

        send(res, 404, { error: "Unknown Agent Run endpoint" });
        return true;
      } catch (error) {
        send(
          res,
          Number(error?.status) || 400,
          { error: error instanceof Error ? error.message : "Agent Run operation failed" }
        );
        return true;
      }
    }
  };
}
