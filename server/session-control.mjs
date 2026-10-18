import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_BODY = 512 * 1024;
const MAX_QUEUE_TEXT = 16_000;
const MAX_QUEUE_ITEMS = 200;
const MAX_CHECKPOINT_MESSAGES = 80;
const MAX_CHECKPOINT_CHARS = 36_000;
const MAX_EVENTS = 400;
const MAX_CHECKPOINTS = 30;

function keyOf(backend, sessionId) {
  return `${backend}:${sessionId}`;
}

function isBackend(value) {
  return value === "codex" || value === "opencode";
}

function json(res, status, body) {
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
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function defaultState() {
  return {
    version: 1,
    queue: [],
    budgets: {},
    ownership: {},
    checkpoints: [],
    events: []
  };
}

function boundedMessages(value) {
  const input = Array.isArray(value) ? value.slice(-MAX_CHECKPOINT_MESSAGES) : [];
  const out = [];
  let remaining = MAX_CHECKPOINT_CHARS;
  for (const item of input) {
    const role = ["user", "assistant", "system"].includes(item?.role) ? item.role : "system";
    const text = String(item?.text || "").slice(0, remaining);
    if (!text) continue;
    remaining -= text.length;
    out.push({ role, text });
    if (remaining <= 0) break;
  }
  return out;
}

function boundedFiles(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || "").slice(0, 400)).filter(Boolean))].slice(0, 80);
}

function sanitizeState(raw) {
  const state = defaultState();
  if (!raw || raw.version !== 1) return state;
  state.queue = (Array.isArray(raw.queue) ? raw.queue.slice(-MAX_QUEUE_ITEMS) : [])
    .filter(item => item && isBackend(item.backend) && typeof item.sessionId === "string" &&
      item.sessionId.length > 0 && typeof item.text === "string" && item.text.trim().length > 0)
    .map(item => ({
      id: typeof item.id === "string" ? item.id : randomUUID(),
      backend: item.backend,
      sessionId: item.sessionId,
      sessionKey: keyOf(item.backend, item.sessionId),
      text: item.text.slice(0, MAX_QUEUE_TEXT),
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      // Any dispatch without a durable acknowledgment must be reviewed, never replayed silently.
      status: item.status === "dispatching" || item.status === "needs-review" ? "needs-review" : "pending"
    }));
  state.budgets = raw.budgets && typeof raw.budgets === "object" ? raw.budgets : {};
  state.ownership = raw.ownership && typeof raw.ownership === "object" ? raw.ownership : {};
  state.checkpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints.slice(-MAX_CHECKPOINTS) : [];
  state.events = Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [];
  return state;
}

export function createSessionControl({ homeDir, inspectSession, dispatchQueued, interruptSession }) {
  const stateFile = join(homeDir, ".local", "state", "devmoter-fast", "session-control.json");
  let state = null;
  let writeChain = Promise.resolve();
  let reconciling = false;

  async function ensureLoaded() {
    if (state) return state;
    try {
      state = sanitizeState(JSON.parse(await readFile(stateFile, "utf8")));
    } catch {
      state = defaultState();
    }
    return state;
  }

  function addEvent(target, event) {
    target.events.push({
      id: randomUUID(),
      createdAt: Date.now(),
      ...event
    });
    target.events = target.events.slice(-MAX_EVENTS);
  }

  async function persist() {
    const snapshot = JSON.stringify(await ensureLoaded(), null, 2);
    writeChain = writeChain.catch(() => {}).then(async () => {
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      const temp = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, stateFile);
    });
    await writeChain;
  }

  async function setBudget(backend, sessionId, payload) {
    const target = await ensureLoaded();
    const snapshot = await inspectSession(backend, sessionId);
    const maxTurns = payload.maxTurns === null || payload.maxTurns === "" ? null : Number(payload.maxTurns);
    const maxTokens = payload.maxTokens === null || payload.maxTokens === "" ? null : Number(payload.maxTokens);
    if (maxTurns !== null && (!Number.isFinite(maxTurns) || maxTurns < 0)) throw new Error("maxTurns must be a non-negative number or null");
    if (maxTokens !== null && (!Number.isFinite(maxTokens) || maxTokens < 0)) throw new Error("maxTokens must be a non-negative number or null");
    const key = keyOf(backend, sessionId);
    target.budgets[key] = {
      backend,
      sessionId,
      maxTurns,
      maxTokens,
      baseTurns: Number(snapshot?.turns || 0),
      baseTokens: Number(snapshot?.tokens || 0),
      createdAt: Date.now(),
      stopReason: null,
      inheritedFrom: payload.inheritedFrom || null
    };
    addEvent(target, { sessionKey: key, type: "budget", detail: `Budget set: ${maxTurns ?? "∞"} turns / ${maxTokens ?? "∞"} tokens` });
    await persist();
    return target.budgets[key];
  }

  async function inheritBudget(payload) {
    const target = await ensureLoaded();
    const sourceBackend = payload?.source?.backend;
    const sourceSessionId = String(payload?.source?.sessionId || "");
    const targetBackend = payload?.target?.backend;
    const targetSessionId = String(payload?.target?.sessionId || "");
    if (!isBackend(sourceBackend) || !isBackend(targetBackend) || !sourceSessionId || !targetSessionId) throw new Error("Valid source and target sessions are required");
    const sourceKey = keyOf(sourceBackend, sourceSessionId);
    const sourceBudget = target.budgets[sourceKey];
    if (!sourceBudget) return null;
    const metrics = await inspectSession(sourceBackend, sourceSessionId);
    const usedTurns = Math.max(0, Number(metrics?.turns || 0) - Number(sourceBudget.baseTurns || 0));
    const usedTokens = Math.max(0, Number(metrics?.tokens || 0) - Number(sourceBudget.baseTokens || 0));
    const remainingTurns = sourceBudget.maxTurns === null ? null : Math.max(0, sourceBudget.maxTurns - usedTurns);
    const remainingTokens = sourceBudget.maxTokens === null ? null : Math.max(0, sourceBudget.maxTokens - usedTokens);
    return setBudget(targetBackend, targetSessionId, {
      maxTurns: remainingTurns,
      maxTokens: remainingTokens,
      inheritedFrom: sourceKey
    });
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/session-control")) return false;
    try {
      const target = await ensureLoaded();
      if (req.method === "GET" && url.pathname === "/api/session-control/state") {
        json(res, 200, target);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/session-control/queue") {
        const payload = await readJson(req);
        const backend = payload.backend;
        const sessionId = String(payload.sessionId || "");
        const text = String(payload.text || "").trim().slice(0, MAX_QUEUE_TEXT);
        if (!isBackend(backend) || !sessionId || !text) throw new Error("backend, sessionId and text are required");
        const item = { id: randomUUID(), backend, sessionId, sessionKey: keyOf(backend, sessionId), text, createdAt: Date.now() };
        if (target.queue.length >= MAX_QUEUE_ITEMS) throw new Error("Queue limit reached");
        item.status = "pending";
        target.queue.push(item);
        addEvent(target, { sessionKey: item.sessionKey, type: "queue", detail: "Queued follow-up" });
        await persist();
        json(res, 201, { item });
        return true;
      }

      const queueMatch = url.pathname.match(/^\/api\/session-control\/queue\/([^/]+)$/);
      if (queueMatch && req.method === "PATCH") {
        const payload = await readJson(req);
        const index = target.queue.findIndex(item => item.id === queueMatch[1]);
        if (index < 0) throw new Error("Queue item not found");
        if (target.queue[index].status === "dispatching") throw new Error("Queue item is being dispatched");
        if (payload.retry === true) {
          if (target.queue[index].status !== "needs-review") throw new Error("Only unconfirmed sends can be retried");
          target.queue[index].status = "pending";
          addEvent(target, { sessionKey: target.queue[index].sessionKey, type: "queue", detail: "User explicitly retried unconfirmed follow-up" });
        }
        if (typeof payload.text === "string") {
          const text = payload.text.trim().slice(0, MAX_QUEUE_TEXT);
          if (!text) throw new Error("Queued text cannot be empty");
          target.queue[index].text = text;
        }
        if (Number.isInteger(payload.index)) {
          const [item] = target.queue.splice(index, 1);
          const next = Math.max(0, Math.min(target.queue.length, Number(payload.index)));
          target.queue.splice(next, 0, item);
        }
        await persist();
        json(res, 200, { item: target.queue.find(item => item.id === queueMatch[1]) });
        return true;
      }
      if (queueMatch && req.method === "DELETE") {
        const before = target.queue.length;
        if (target.queue.some(item => item.id === queueMatch[1] && item.status === "dispatching")) throw new Error("Queue item is being dispatched");
        target.queue = target.queue.filter(item => item.id !== queueMatch[1]);
        if (target.queue.length === before) throw new Error("Queue item not found");
        await persist();
        json(res, 200, { ok: true });
        return true;
      }

      const budgetMatch = url.pathname.match(/^\/api\/session-control\/budget\/(codex|opencode)\/([^/]+)$/);
      if (budgetMatch && req.method === "PUT") {
        const budget = await setBudget(budgetMatch[1], decodeURIComponent(budgetMatch[2]), await readJson(req));
        json(res, 200, { budget });
        return true;
      }
      if (budgetMatch && req.method === "DELETE") {
        delete target.budgets[keyOf(budgetMatch[1], decodeURIComponent(budgetMatch[2]))];
        await persist();
        json(res, 200, { ok: true });
        return true;
      }
      if (req.method === "POST" && url.pathname === "/api/session-control/budget/inherit") {
        json(res, 200, { budget: await inheritBudget(await readJson(req)) });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/session-control/ownership") {
        const payload = await readJson(req);
        const backend = payload.backend;
        const sessionId = String(payload.sessionId || "");
        const owner = payload.owner;
        const priorOwner = payload.priorOwner;
        if (!isBackend(backend) || !sessionId || !isBackend(owner) || (priorOwner && !isBackend(priorOwner))) throw new Error("Invalid ownership payload");
        const key = keyOf(backend, sessionId);
        target.ownership[key] = { owner, priorOwner: priorOwner || null, changedAt: Date.now() };
        addEvent(target, { sessionKey: key, type: "handoff", detail: `${priorOwner ? `${priorOwner} → ` : ""}${owner}` });
        await persist();
        json(res, 200, { ownership: target.ownership[key] });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/session-control/checkpoints") {
        const payload = await readJson(req);
        const backend = payload.backend;
        const sessionId = String(payload.sessionId || "");
        if (!isBackend(backend) || !sessionId) throw new Error("Invalid checkpoint session");
        const messages = boundedMessages(payload.messages);
        if (!messages.length) throw new Error("Checkpoint requires session messages");
        const checkpoint = {
          id: randomUUID(),
          backend,
          sessionId,
          sessionKey: keyOf(backend, sessionId),
          title: String(payload.title || "Checkpoint").slice(0, 180),
          project: String(payload.project || "").slice(0, 1000),
          projectId: payload.projectId ? String(payload.projectId).slice(0, 160) : null,
          sourcePoint: Number(payload.sourcePoint || messages.length),
          messages,
          files: boundedFiles(payload.files),
          createdAt: Date.now()
        };
        target.checkpoints.push(checkpoint);
        target.checkpoints = target.checkpoints.slice(-MAX_CHECKPOINTS);
        addEvent(target, { sessionKey: checkpoint.sessionKey, type: "checkpoint", detail: `Checkpoint created at message ${checkpoint.sourcePoint}` });
        await persist();
        json(res, 201, { checkpoint });
        return true;
      }

      const checkpointMatch = url.pathname.match(/^\/api\/session-control\/checkpoints\/([^/]+)$/);
      if (checkpointMatch && req.method === "DELETE") {
        target.checkpoints = target.checkpoints.filter(item => item.id !== checkpointMatch[1]);
        await persist();
        json(res, 200, { ok: true });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/session-control/events") {
        const payload = await readJson(req);
        const sessionKey = String(payload.sessionKey || "").slice(0, 300);
        const type = ["handoff", "queue", "budget", "checkpoint", "fork", "rewind", "side", "restore"].includes(payload.type) ? payload.type : "queue";
        if (!sessionKey) throw new Error("sessionKey is required");
        addEvent(target, {
          sessionKey,
          type,
          detail: String(payload.detail || "").slice(0, 1200),
          relatedSessionKey: payload.relatedSessionKey ? String(payload.relatedSessionKey).slice(0, 300) : null
        });
        await persist();
        json(res, 201, { ok: true });
        return true;
      }

      json(res, 404, { error: "Session control endpoint not found" });
      return true;
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }

  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      const target = await ensureLoaded();
      const keys = new Set([
        ...target.queue.filter(item => item.status === "pending").map(item => item.sessionKey),
        ...Object.keys(target.budgets).filter(key => !target.budgets[key]?.stopReason || target.budgets[key]?.interruptPending)
      ]);
      let dirty = false;
      for (const sessionKey of keys) {
        const colon = sessionKey.indexOf(":");
        if (colon < 1) continue;
        const backend = sessionKey.slice(0, colon);
        const sessionId = sessionKey.slice(colon + 1);
        if (!isBackend(backend) || !sessionId) continue;
        let snapshot;
        try {
          snapshot = await inspectSession(backend, sessionId);
        } catch {
          continue;
        }
        const budget = target.budgets[sessionKey];
        if (budget && !budget.stopReason) {
          const usedTurns = Math.max(0, Number(snapshot?.turns || 0) - Number(budget.baseTurns || 0));
          const usedTokens = Math.max(0, Number(snapshot?.tokens || 0) - Number(budget.baseTokens || 0));
          const reason = budget.maxTurns !== null && usedTurns >= budget.maxTurns
            ? `Turn budget reached (${usedTurns}/${budget.maxTurns})`
            : budget.maxTokens !== null && usedTokens >= budget.maxTokens
              ? `Token budget reached (${usedTokens}/${budget.maxTokens})`
              : null;
          if (reason) {
            budget.stopReason = reason;
            budget.interruptPending = Boolean(snapshot?.active);
            addEvent(target, { sessionKey, type: "budget", detail: reason });
            dirty = true;
          }
        }
        if (budget?.interruptPending) {
          if (!snapshot?.active) {
            budget.interruptPending = false;
            dirty = true;
          } else {
            try {
              await interruptSession(backend, sessionId, snapshot);
              budget.interruptPending = false;
              addEvent(target, { sessionKey, type: "budget", detail: "Stop request acknowledged by agent" });
              dirty = true;
            } catch {
              // Failed stop requests remain visible and are retried while the run is active.
              dirty = true;
            }
          }
        }
        if (budget?.stopReason) continue;

        if (!snapshot?.active) {
          const next = target.queue.find(item => item.sessionKey === sessionKey && item.status === "pending");
          if (next && !(budget?.stopReason)) {
            // Persist the intent before invoking an external agent: a crash must not silently resend.
            next.status = "dispatching";
            addEvent(target, { sessionKey, type: "queue", detail: "Dispatch started (awaiting acknowledgment)" });
            try {
              await persist();
              await dispatchQueued(backend, sessionId, next.text);
              target.queue = target.queue.filter(item => item.id !== next.id);
              addEvent(target, { sessionKey, type: "queue", detail: "Dispatched queued follow-up" });
              dirty = true;
            } catch {
              // The backend may have accepted the message before losing the response.
              // Fail closed: user must explicitly inspect the run before attempting a retry.
              next.status = "needs-review";
              addEvent(target, { sessionKey, type: "queue", detail: "Dispatch unconfirmed; manual review required before retry" });
              dirty = true;
            }
          }
        }
      }
      if (dirty) await persist();
    } finally {
      reconciling = false;
    }
  }

  return { handle, reconcile };
}
