const RUN_STATES = new Set([
  "starting",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled"
]);

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ??
    `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cloneContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key && item !== undefined)
      .map(([key, item]) => [key, structuredClone(item)])
  );
}

function snapshot(run) {
  return {
    ...run,
    context: structuredClone(run.context),
    lineage: [...(run.lineage || [])],
    pendingApproval: run.pendingApproval ? structuredClone(run.pendingApproval) : null
  };
}

export class SubagentRuntime {
  constructor({ adapters = {}, idFactory = defaultId } = {}) {
    this.adapters = new Map(Object.entries(adapters));
    this.idFactory = idFactory;
    this.runs = new Map();
    this.listeners = new Set();
  }

  registerAdapter(name, adapter) {
    const key = String(name || "").trim();
    if (!key) throw new Error("Adapter name is required");
    if (!adapter || typeof adapter.start !== "function" || typeof adapter.cancel !== "function") {
      throw new Error("Adapter must implement start() and cancel()");
    }
    this.adapters.set(key, adapter);
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listRuns() {
    return [...this.runs.values()].map(snapshot);
  }

  getRun(id) {
    const run = this.runs.get(String(id));
    return run ? snapshot(run) : null;
  }

  async spawn(spec = {}) {
    const backend = String(spec.backend || "codex");
    const adapter = this.adapters.get(backend);
    if (!adapter) throw new Error(`No subagent adapter registered for backend: ${backend}`);

    const task = String(spec.task || "").trim();
    if (!task) throw new Error("Subagent task is required");

    const parentSessionId = String(spec.parentSessionId || "").trim();
    if (!parentSessionId) throw new Error("parentSessionId is required");

    const run = {
      id: String(spec.id || this.idFactory()),
      kind: String(spec.kind || "subagent"),
      backend,
      parentSessionId,
      parentRunId: spec.parentRunId ? String(spec.parentRunId) : null,
      role: String(spec.role || "executor"),
      model: spec.model ? String(spec.model) : null,
      effectiveModel: null,
      task,
      context: cloneContext(spec.context),
      lineage: Array.isArray(spec.lineage) ? spec.lineage.map(String) : [],
      state: "starting",
      sessionId: null,
      turnId: null,
      output: "",
      error: null,
      pendingApproval: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (this.runs.has(run.id)) throw new Error(`Duplicate subagent run id: ${run.id}`);
    this.runs.set(run.id, run);
    this.#emit(run);

    try {
      const started = await adapter.start(snapshot(run), patch => this.update(run.id, patch));
      if (started && typeof started === "object") this.update(run.id, started);
      if (this.runs.get(run.id)?.state === "starting") this.update(run.id, { state: "running" });
      return this.getRun(run.id);
    } catch (error) {
      this.update(run.id, {
        state: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  update(id, patch = {}) {
    const run = this.runs.get(String(id));
    if (!run) throw new Error(`Unknown subagent run: ${String(id)}`);
    if (patch.state && !RUN_STATES.has(patch.state)) {
      throw new Error(`Unknown subagent state: ${String(patch.state)}`);
    }
    if (patch.outputDelta) run.output += String(patch.outputDelta);
    const next = { ...patch };
    delete next.outputDelta;
    Object.assign(run, next, { updatedAt: Date.now() });
    this.#emit(run);
    return snapshot(run);
  }

  async cancel(id) {
    const run = this.runs.get(String(id));
    if (!run) throw new Error(`Unknown subagent run: ${String(id)}`);
    if (["completed", "failed", "cancelled"].includes(run.state)) return snapshot(run);
    const adapter = this.adapters.get(run.backend);
    await adapter.cancel(snapshot(run));
    return this.update(run.id, { state: "cancelled", pendingApproval: null });
  }

  async respondApproval(id, decision) {
    const run = this.runs.get(String(id));
    if (!run) throw new Error(`Unknown subagent run: ${String(id)}`);
    if (!run.pendingApproval) throw new Error("Subagent is not waiting for approval");
    const adapter = this.adapters.get(run.backend);
    if (typeof adapter.respondApproval !== "function") {
      throw new Error(`Backend does not support approval responses: ${run.backend}`);
    }
    await adapter.respondApproval(snapshot(run), decision);
    return this.update(run.id, { state: "running", pendingApproval: null });
  }

  dispose() {
    for (const adapter of this.adapters.values()) adapter.dispose?.();
    this.listeners.clear();
  }

  #emit(run) {
    const value = snapshot(run);
    for (const listener of this.listeners) listener(value);
  }
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() ??
    `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function scopedPrompt(run) {
  const contextRows = Object.entries(run.context || {}).map(
    ([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`
  );
  return [
    `[DevMoter bounded subagent · role=${run.role}]`,
    `Parent session: ${run.parentSessionId}`,
    "Only use the explicitly shared context below. Do not assume access to unrelated parent conversation context.",
    contextRows.length ? `Shared context:\n${contextRows.join("\n")}` : "Shared context: none",
    `Task:\n${run.task}`
  ].join("\n\n");
}

export function createCodexSubagentAdapter({
  fetchImpl = globalThis.fetch,
  eventSourceFactory = url => new EventSource(url)
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  const callbacks = new Map();
  const threadToRun = new Map();
  let events = null;

  async function rpc(method, params = {}) {
    const res = await fetchImpl("/api/codex/rpc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pocket-operation-id": operationId()
      },
      body: JSON.stringify({ method, params })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || `Codex RPC failed (${res.status})`);
    return payload.result;
  }

  function findRun(params = {}) {
    const threadId = String(
      params.threadId ||
      params.thread?.id ||
      params.turn?.threadId ||
      ""
    );
    return threadId ? threadToRun.get(threadId) : null;
  }

  function emitFor(runId, patch) {
    const emit = callbacks.get(runId);
    if (emit) emit(patch);
  }

  function ensureEvents() {
    if (events) return;
    events = eventSourceFactory("/api/codex/events");

    events.addEventListener("notification", raw => {
      const message = JSON.parse(raw.data);
      const { method, params = {} } = message;
      const runId = findRun(params);
      if (!runId) return;

      if (method === "turn/started") {
        emitFor(runId, {
          state: "running",
          turnId: params.turn?.id || params.turnId || null
        });
        return;
      }

      if (method === "item/agentMessage/delta") {
        if (typeof params.delta === "string" && params.delta) {
          emitFor(runId, { outputDelta: params.delta });
        }
        return;
      }

      if (method === "turn/completed") {
        const rawStatus = String(params.turn?.status || "").toLowerCase();
        const state =
          rawStatus === "failed" ? "failed" :
          rawStatus === "interrupted" ? "cancelled" :
          "completed";
        emitFor(runId, {
          state,
          turnId: params.turn?.id || params.turnId || null,
          error: params.turn?.error?.message || null,
          pendingApproval: null
        });
      }
    });

    events.addEventListener("server-request", raw => {
      const request = JSON.parse(raw.data);
      const runId = findRun(request.params || {});
      if (!runId) return;
      emitFor(runId, {
        state: "waiting_for_approval",
        pendingApproval: {
          id: request.id,
          method: request.method,
          params: request.params || {}
        }
      });
    });
  }

  return {
    async start(run, emit) {
      callbacks.set(run.id, emit);
      ensureEvents();

      const threadParams = {};
      if (run.model) threadParams.model = run.model;
      if (run.context?.cwd) threadParams.cwd = String(run.context.cwd);

      const startedThread = await rpc("thread/start", threadParams);
      const thread = startedThread?.thread;
      if (!thread?.id) throw new Error("Codex subagent did not return a thread id");
      threadToRun.set(String(thread.id), run.id);

      emit({
        sessionId: String(thread.id),
        effectiveModel: startedThread?.model || run.model || null,
        state: "running"
      });

      const input = [{ type: "text", text: scopedPrompt(run) }];
      const turnParams = {
        threadId: thread.id,
        input,
        clientUserMessageId: operationId()
      };
      if (run.model) turnParams.model = run.model;

      const startedTurn = await rpc("turn/start", turnParams);
      return {
        sessionId: String(thread.id),
        turnId: startedTurn?.turn?.id || null,
        effectiveModel: startedThread?.model || run.model || null,
        state: "running"
      };
    },

    async cancel(run) {
      if (!run.sessionId || !run.turnId) return;
      await rpc("turn/interrupt", {
        threadId: run.sessionId,
        turnId: run.turnId
      });
    },

    async respondApproval(run, decision) {
      const approval = run.pendingApproval;
      if (!approval) throw new Error("Approval request is no longer pending");
      const res = await fetchImpl("/api/codex/approval", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pocket-operation-id": operationId()
        },
        body: JSON.stringify({ id: approval.id, decision })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `Approval failed (${res.status})`);
    },

    dispose() {
      events?.close?.();
      events = null;
      callbacks.clear();
      threadToRun.clear();
    }
  };
}

export { scopedPrompt };
