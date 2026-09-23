const RUN_STATES = new Set([
  "starting",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled"
]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled"]);
const CAPABILITY_GROUPS = Object.freeze(["read", "diagnostics", "tests", "git", "files", "commands", "network"]);
const CAPABILITY_SET = new Set(CAPABILITY_GROUPS);

function normalizeCapabilityPolicy(input) {
  if (input == null) {
    return {
      allow: [...CAPABILITY_GROUPS],
      deny: [],
      mutationPolicy: "approval-required"
    };
  }
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("capabilityPolicy must be an object");
  const normalizeList = (value, field, fallback) => {
    if (value === undefined) return [...fallback];
    if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
    const out = [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))];
    for (const group of out) {
      if (!CAPABILITY_SET.has(group)) throw new Error(`Unknown capability group: ${group}`);
    }
    return out;
  };
  const requestedAllow = normalizeList(input.allow, "capabilityPolicy.allow", CAPABILITY_GROUPS);
  const requestedDeny = normalizeList(input.deny, "capabilityPolicy.deny", []);
  const allow = requestedAllow.filter(group => !requestedDeny.includes(group));
  const mutationPolicy = String(input.mutationPolicy || "approval-required");
  if (!["approval-required", "read-only-until-explicit-transition"].includes(mutationPolicy)) {
    throw new Error(`Unsupported capability mutation policy: ${mutationPolicy}`);
  }
  return {
    allow,
    deny: CAPABILITY_GROUPS.filter(group => !allow.includes(group)),
    mutationPolicy
  };
}

function intersectCapabilityPolicies(parentInput, childInput) {
  const parent = normalizeCapabilityPolicy(parentInput);
  const child = childInput == null ? parent : normalizeCapabilityPolicy(childInput);
  const allow = child.allow.filter(group => parent.allow.includes(group));
  return {
    allow,
    deny: CAPABILITY_GROUPS.filter(group => !allow.includes(group)),
    mutationPolicy:
      parent.mutationPolicy === "read-only-until-explicit-transition" ||
      child.mutationPolicy === "read-only-until-explicit-transition"
        ? "read-only-until-explicit-transition"
        : "approval-required"
  };
}

function approvalCapability(method) {
  if (method === "item/fileChange/requestApproval") return "files";
  if (method === "item/commandExecution/requestApproval") return "commands";
  return null;
}


function defaultId() {
  return globalThis.crypto?.randomUUID?.() ??
    `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function taskFingerprint(task) {
  return String(task || "").trim().toLowerCase().replace(/\s+/g, " ");
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
    budget: structuredClone(run.budget),
    capabilityPolicy: structuredClone(run.capabilityPolicy),
    pendingApproval: run.pendingApproval ? structuredClone(run.pendingApproval) : null
  };
}

function fleetSnapshot(fleet) {
  return {
    id: fleet.id,
    concurrency: fleet.concurrency,
    state: fleet.state,
    queued: fleet.queue.length,
    runIds: [...fleet.runIds],
    errors: fleet.errors.map(error => ({ ...error })),
    createdAt: fleet.createdAt,
    updatedAt: fleet.updatedAt
  };
}

export class SubagentRuntime {
  constructor({ adapters = {}, idFactory = defaultId, policy = {} } = {}) {
    this.adapters = new Map(Object.entries(adapters));
    this.idFactory = idFactory;
    this.policy = {
      maxDepth: Math.max(0, Math.min(8, positiveInt(policy.maxDepth, 3))),
      tokenBudget: Math.max(1, positiveInt(policy.tokenBudget, 12000)),
      turnBudget: Math.max(1, positiveInt(policy.turnBudget, 8))
    };
    this.runs = new Map();
    this.fleets = new Map();
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

  listFleets() {
    return [...this.fleets.values()].map(fleetSnapshot);
  }

  getFleet(id) {
    const fleet = this.fleets.get(String(id));
    return fleet ? fleetSnapshot(fleet) : null;
  }

  async runFleet(specs, { id, concurrency = 2 } = {}) {
    if (!Array.isArray(specs) || specs.length === 0) throw new Error("Fleet requires at least one agent spec");
    if (specs.length > 24) throw new Error("Fleet is limited to 24 agents");
    const fleetId = String(id || this.idFactory());
    if (this.fleets.has(fleetId)) throw new Error(`Duplicate fleet id: ${fleetId}`);
    const fleet = {
      id: fleetId,
      concurrency: Math.max(1, Math.min(8, positiveInt(concurrency, 2))),
      state: "running",
      queue: specs.map(spec => structuredClone(spec)),
      runIds: [],
      errors: [],
      pumping: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.fleets.set(fleetId, fleet);
    await this.#pumpFleet(fleetId);
    return fleetSnapshot(fleet);
  }

  async cancelFleet(id) {
    const fleet = this.fleets.get(String(id));
    if (!fleet) throw new Error(`Unknown fleet: ${String(id)}`);
    fleet.queue = [];
    const active = fleet.runIds
      .map(runId => this.runs.get(runId))
      .filter(run => run && !TERMINAL_RUN_STATES.has(run.state));
    await Promise.all(active.map(run => this.cancel(run.id).catch(error => {
      fleet.errors.push({ runId: run.id, error: error instanceof Error ? error.message : String(error) });
    })));
    fleet.state = "cancelled";
    fleet.updatedAt = Date.now();
    return fleetSnapshot(fleet);
  }

  async spawn(spec = {}) {
    const backend = String(spec.backend || "codex");
    const adapter = this.adapters.get(backend);
    if (!adapter) throw new Error(`No subagent adapter registered for backend: ${backend}`);

    const task = String(spec.task || "").trim();
    if (!task) throw new Error("Subagent task is required");

    const parentSessionId = String(spec.parentSessionId || "").trim();
    if (!parentSessionId) throw new Error("parentSessionId is required");

    const parentRunId = spec.parentRunId ? String(spec.parentRunId) : null;
    const parentRun = parentRunId ? this.runs.get(parentRunId) : null;
    if (parentRunId && !parentRun) throw new Error(`Unknown parent run: ${parentRunId}`);

    const depth = parentRun ? parentRun.depth + 1 : 0;
    if (depth > this.policy.maxDepth) {
      throw new Error(`Maximum subagent nesting depth exceeded: ${depth} > ${this.policy.maxDepth}`);
    }

    const fingerprint = taskFingerprint(task);
    const lineage = parentRun
      ? [...parentRun.lineage, parentRun.id]
      : Array.isArray(spec.lineage) ? spec.lineage.map(String) : [];
    for (const ancestorId of lineage) {
      const ancestor = this.runs.get(ancestorId);
      if (ancestor?.fingerprint === fingerprint) {
        throw new Error(`Recursive delegation loop rejected: task already exists in lineage (${ancestorId})`);
      }
    }

    const capabilityPolicy = parentRun
      ? intersectCapabilityPolicies(parentRun.capabilityPolicy, spec.capabilityPolicy)
      : normalizeCapabilityPolicy(spec.capabilityPolicy);

    let tokenLimit = this.policy.tokenBudget;
    let turnLimit = this.policy.turnBudget;
    if (parentRun) {
      if (parentRun.budget.tokensRemaining < 1 || parentRun.budget.turnsRemaining < 1) {
        throw new Error("Parent subagent budget is exhausted");
      }
      tokenLimit = Math.min(
        positiveInt(spec.tokenBudget, Math.max(1, Math.floor(parentRun.budget.tokensRemaining / 2))),
        parentRun.budget.tokensRemaining
      );
      turnLimit = Math.min(
        positiveInt(spec.turnBudget, Math.max(1, Math.floor(parentRun.budget.turnsRemaining / 2))),
        parentRun.budget.turnsRemaining
      );
      parentRun.budget.tokensRemaining -= tokenLimit;
      parentRun.budget.turnsRemaining -= turnLimit;
      parentRun.updatedAt = Date.now();
      this.#emit(parentRun);
    } else {
      tokenLimit = Math.min(positiveInt(spec.tokenBudget, this.policy.tokenBudget), this.policy.tokenBudget);
      turnLimit = Math.min(positiveInt(spec.turnBudget, this.policy.turnBudget), this.policy.turnBudget);
    }

    const run = {
      id: String(spec.id || this.idFactory()),
      kind: String(spec.kind || "subagent"),
      backend,
      parentSessionId,
      parentRunId,
      fleetId: spec.fleetId ? String(spec.fleetId) : null,
      role: String(spec.role || "executor"),
      model: spec.model ? String(spec.model) : null,
      effectiveModel: null,
      task,
      fingerprint,
      context: cloneContext(spec.context),
      lineage,
      depth,
      budget: {
        tokenLimit,
        turnLimit,
        tokensRemaining: tokenLimit,
        turnsRemaining: turnLimit
      },
      capabilityPolicy,
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
      if (parentRun) {
        parentRun.budget.tokensRemaining += tokenLimit;
        parentRun.budget.turnsRemaining += turnLimit;
        parentRun.updatedAt = Date.now();
        this.#emit(parentRun);
      }
      this.update(run.id, {
        state: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async spawnSecondOpinion(parentRunId, options = {}) {
    const parent = this.runs.get(String(parentRunId));
    if (!parent) throw new Error(`Unknown parent run: ${String(parentRunId)}`);

    const share = options.share && typeof options.share === "object" ? options.share : {};
    const context = {};
    if (parent.context?.projectId) context.projectId = String(parent.context.projectId);
    if (share.task) context.parentTask = parent.task;
    if (share.output) context.parentOutput = parent.output;
    if (share.error && parent.error) context.parentError = parent.error;
    if (!Object.keys(context).length) {
      throw new Error("Select at least one parent context field for the second opinion");
    }

    const originalOwner = parent.role;
    context.originalOwner = originalOwner;
    const run = await this.spawn({
      kind: "second-opinion",
      backend: options.backend || parent.backend,
      parentSessionId: parent.sessionId || parent.parentSessionId,
      parentRunId: parent.id,
      role: options.role || "reviewer",
      model: options.model || null,
      task: String(options.task || "Give an independent second opinion on the explicitly shared context. State agreements, disagreements, risks, and recommended next steps."),
      context,
      tokenBudget: options.tokenBudget,
      turnBudget: options.turnBudget
    });

    if (this.runs.get(parent.id)?.role !== originalOwner) {
      throw new Error("Second opinion must not change the current owner");
    }
    return run;
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
    // Delegation authority is assigned by the runtime, never by backend callbacks.
    delete next.capabilityPolicy;
    delete next.parentRunId;
    delete next.lineage;
    delete next.depth;
    Object.assign(run, next, { updatedAt: Date.now() });
    this.#emit(run);
    if (run.fleetId && TERMINAL_RUN_STATES.has(run.state)) {
      void this.#pumpFleet(run.fleetId);
    }
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

  async #pumpFleet(id) {
    const fleet = this.fleets.get(String(id));
    if (!fleet || fleet.pumping || fleet.state !== "running") return;
    fleet.pumping = true;
    try {
      while (fleet.queue.length) {
        const activeCount = fleet.runIds
          .map(runId => this.runs.get(runId))
          .filter(run => run && !TERMINAL_RUN_STATES.has(run.state)).length;
        if (activeCount >= fleet.concurrency) break;

        const spec = fleet.queue.shift();
        const runId = String(spec.id || this.idFactory());
        fleet.runIds.push(runId);
        fleet.updatedAt = Date.now();
        try {
          await this.spawn({ ...spec, id: runId, fleetId: fleet.id });
        } catch (error) {
          fleet.errors.push({
            runId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const activeCount = fleet.runIds
        .map(runId => this.runs.get(runId))
        .filter(run => run && !TERMINAL_RUN_STATES.has(run.state)).length;
      if (fleet.queue.length === 0 && activeCount === 0) {
        fleet.state = fleet.errors.length ? "completed_with_failures" : "completed";
        fleet.updatedAt = Date.now();
      }
    } finally {
      fleet.pumping = false;
    }
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
  const contextRows = Object.entries(run.context || {})
    .filter(([key]) => key !== "projectId")
    .map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return [
    `[DevMoter bounded subagent · role=${run.role}]`,
    `Parent session: ${run.parentSessionId}`,
    `Delegation depth: ${run.depth}`,
    `Lineage: ${run.lineage.length ? run.lineage.join(" > ") : "root"}`,
    `Inherited budget: ${run.budget.tokenLimit} tokens / ${run.budget.turnLimit} turns`,
    `Effective capabilities: ${run.capabilityPolicy.allow.join(", ") || "none"}`,
    `Denied capabilities: ${run.capabilityPolicy.deny.join(", ") || "none"}`,
    `Mutation policy: ${run.capabilityPolicy.mutationPolicy}`,
    "The effective capability policy above is a hard ceiling inherited from the parent. Never request or use a denied capability. Do not delegate beyond the supplied depth/budget. Only use the explicitly shared context below. Do not assume access to unrelated parent conversation context.",
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
  const runPolicies = new Map();
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

  async function sendApproval(id, decision) {
    const res = await fetchImpl("/api/codex/approval", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pocket-operation-id": operationId()
      },
      body: JSON.stringify({ id, decision })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || `Approval failed (${res.status})`);
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
      const required = approvalCapability(request.method);
      const policy = runPolicies.get(runId);
      if (required && policy && !policy.allow.includes(required)) {
        void sendApproval(request.id, "decline").catch(error => {
          emitFor(runId, {
            state: "failed",
            error: `Failed to enforce denied ${required} capability: ${error instanceof Error ? error.message : String(error)}`,
            pendingApproval: null
          });
        });
        return;
      }
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
      runPolicies.set(run.id, structuredClone(run.capabilityPolicy));
      ensureEvents();

      const projectId = String(run.context?.projectId || "").trim();
      if (!projectId) throw new Error("A registered DevMoter Project is required for Codex subagents");
      const threadParams = { projectId };
      if (run.model) threadParams.model = run.model;

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
      const required = approvalCapability(approval.method);
      const policy = runPolicies.get(run.id) || run.capabilityPolicy;
      if (required && policy && !policy.allow.includes(required) && decision !== "decline" && decision !== "cancel") {
        throw new Error(`${required} capability is denied by the inherited subagent policy`);
      }
      await sendApproval(approval.id, decision);
    },

    dispose() {
      events?.close?.();
      events = null;
      callbacks.clear();
      threadToRun.clear();
      runPolicies.clear();
    }
  };
}

export { CAPABILITY_GROUPS, intersectCapabilityPolicies, normalizeCapabilityPolicy, scopedPrompt };
