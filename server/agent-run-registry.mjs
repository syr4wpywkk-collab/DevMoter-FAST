import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const RUN_STATES = new Set([
  "starting",
  "running",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled"
]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const CAPABILITY_GROUPS = Object.freeze([
  "read",
  "diagnostics",
  "tests",
  "git",
  "files",
  "commands",
  "network"
]);
const CAPABILITY_SET = new Set(CAPABILITY_GROUPS);
const APPROVAL_CAPABILITY = new Map([
  ["item/fileChange/requestApproval", "files"],
  ["item/commandExecution/requestApproval", "commands"]
]);
const MAX_RUNS = 240;
const MAX_FLEETS = 60;
const MAX_FLEET_SIZE = 24;
const MAX_TASK_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 80_000;
const MAX_CONTEXT_CHARS = 20_000;

function cleanString(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanId(value, field = "id") {
  const id = cleanString(value, 200);
  if (!id || !/^[A-Za-z0-9._:-]+$/.test(id)) throw Object.assign(new Error(`Invalid ${field}`), { status: 400 });
  return id;
}

function normalizeList(value, field, fallback) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw Object.assign(new Error(`${field} must be an array`), { status: 400 });
  const out = [...new Set(value.map(item => cleanString(item, 40)).filter(Boolean))];
  for (const group of out) {
    if (!CAPABILITY_SET.has(group)) throw Object.assign(new Error(`Unknown capability group: ${group}`), { status: 400 });
  }
  return out;
}

export function normalizeAgentCapabilityPolicy(input) {
  if (input == null) {
    return {
      allow: [...CAPABILITY_GROUPS],
      deny: [],
      mutationPolicy: "approval-required"
    };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("capabilityPolicy must be an object"), { status: 400 });
  }
  const requestedAllow = normalizeList(input.allow, "capabilityPolicy.allow", CAPABILITY_GROUPS);
  const requestedDeny = normalizeList(input.deny, "capabilityPolicy.deny", []);
  const allow = requestedAllow.filter(group => !requestedDeny.includes(group));
  const mutationPolicy = cleanString(input.mutationPolicy || "approval-required", 80);
  if (!["approval-required", "read-only-until-explicit-transition"].includes(mutationPolicy)) {
    throw Object.assign(new Error("Unsupported capability mutation policy"), { status: 400 });
  }
  return {
    allow,
    deny: CAPABILITY_GROUPS.filter(group => !allow.includes(group)),
    mutationPolicy
  };
}

export function intersectAgentCapabilityPolicies(parentInput, childInput) {
  const parent = normalizeAgentCapabilityPolicy(parentInput);
  const child = normalizeAgentCapabilityPolicy(childInput);
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

function normalizeContext(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  for (const key of [
    "projectId",
    "parentTask",
    "parentOutput",
    "parentError",
    "modePolicy",
    "approvedPlanId",
    "originalOwner"
  ]) {
    const value = cleanString(source[key], key === "projectId" || key === "approvedPlanId" ? 200 : MAX_CONTEXT_CHARS);
    if (value) out[key] = value;
  }
  return out;
}

function normalizeBudget(input, parent = null) {
  const source = input && typeof input === "object" ? input : {};
  const parentToken = Number(parent?.tokenBudget || 12_000);
  const parentTurn = Number(parent?.turnBudget || 8);
  const tokenBudget = Math.max(1, Math.min(parentToken, Number(source.tokenBudget) || parentToken, 50_000));
  const turnBudget = Math.max(1, Math.min(parentTurn, Number(source.turnBudget) || parentTurn, 24));
  return { tokenBudget, turnBudget };
}

function normalizeRunSpec(input, parentRun = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("Run spec must be an object"), { status: 400 });
  }
  const backend = cleanString(input.backend || "codex", 40);
  if (backend !== "codex") throw Object.assign(new Error("Only the codex subagent backend is supported"), { status: 400 });

  const task = cleanString(input.task, MAX_TASK_CHARS);
  if (!task) throw Object.assign(new Error("Subagent task is required"), { status: 400 });

  const context = normalizeContext(input.context);
  const projectId = cleanString(context.projectId || input.projectId, 200);
  if (!projectId) throw Object.assign(new Error("A registered DevMoter Project is required"), { status: 400 });
  context.projectId = projectId;

  const requestedPolicy = normalizeAgentCapabilityPolicy(input.capabilityPolicy);
  const capabilityPolicy = parentRun
    ? intersectAgentCapabilityPolicies(parentRun.capabilityPolicy, requestedPolicy)
    : requestedPolicy;

  const depth = parentRun ? Number(parentRun.depth || 0) + 1 : Math.max(0, Number(input.depth) || 0);
  if (depth > 3) throw Object.assign(new Error("Maximum subagent nesting depth exceeded"), { status: 400 });

  return {
    backend,
    kind: cleanString(input.kind || "subagent", 40),
    parentSessionId: cleanString(input.parentSessionId || parentRun?.sessionId, 200),
    parentRunId: parentRun?.id || (input.parentRunId ? cleanId(input.parentRunId, "parentRunId") : null),
    role: cleanString(input.role || "executor", 80),
    model: cleanString(input.model, 200) || null,
    task,
    context,
    depth,
    budget: normalizeBudget(input.budget, parentRun?.budget),
    capabilityPolicy
  };
}

function queuedSpec(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("Fleet entries must be objects"), { status: 400 });
  }
  return {
    backend: cleanString(input.backend || "codex", 40),
    kind: cleanString(input.kind || "subagent", 40),
    parentSessionId: cleanString(input.parentSessionId, 200),
    parentRunId: input.parentRunId ? cleanId(input.parentRunId, "parentRunId") : null,
    role: cleanString(input.role || "executor", 80),
    model: cleanString(input.model, 200) || null,
    task: cleanString(input.task, MAX_TASK_CHARS),
    context: normalizeContext(input.context),
    budget: normalizeBudget(input.budget),
    capabilityPolicy: normalizeAgentCapabilityPolicy(input.capabilityPolicy)
  };
}

function scopedPrompt(run) {
  const contextRows = [];
  const context = run.context || {};
  if (context.projectId) contextRows.push(`Project: ${context.projectId}`);
  if (context.parentTask) contextRows.push(`Parent task: ${context.parentTask}`);
  if (context.parentOutput) contextRows.push(`Parent output: ${context.parentOutput}`);
  if (context.parentError) contextRows.push(`Parent error: ${context.parentError}`);
  if (context.modePolicy) contextRows.push(`Mode policy: ${context.modePolicy}`);
  if (context.approvedPlanId) contextRows.push(`Approved plan: ${context.approvedPlanId}`);
  if (context.originalOwner) contextRows.push(`Original owner: ${context.originalOwner}`);

  return [
    `You are a bounded DevMoter subagent. Role: ${run.role}.`,
    `Effective capabilities: ${run.capabilityPolicy.allow.join(", ") || "none"}`,
    `Denied capabilities: ${run.capabilityPolicy.deny.join(", ") || "none"}`,
    `Mutation policy: ${run.capabilityPolicy.mutationPolicy}`,
    "The effective capability policy above is a hard ceiling inherited from the parent. Never request or use a denied capability. Do not delegate beyond the supplied depth/budget. Only use the explicitly shared context below. Do not assume access to unrelated parent conversation context.",
    contextRows.length ? `Shared context:\n${contextRows.join("\n")}` : "Shared context: none",
    `Task:\n${run.task}`
  ].join("\n\n");
}

function threadIdFromParams(params = {}) {
  return cleanString(
    params?.threadId ||
    params?.thread?.id ||
    params?.turn?.threadId ||
    params?.item?.threadId,
    200
  );
}

function statusToState(value) {
  const raw = cleanString(value?.type || value?.status || value?.state || value, 100).toLowerCase();
  if (/fail|error/.test(raw)) return "failed";
  if (/interrupt|cancel|abort|stop/.test(raw)) return "cancelled";
  if (/complete|success|done|finish/.test(raw)) return "completed";
  if (/wait|approval|question|input/.test(raw)) return "waiting_for_approval";
  if (/run|work|progress|active|start/.test(raw)) return "running";
  return "running";
}

function publicRun(run) {
  return structuredClone(run);
}

function publicFleet(fleet) {
  return structuredClone(fleet);
}

async function readState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return {
      version: 1,
      runs: Array.isArray(parsed?.runs) ? parsed.runs : [],
      fleets: Array.isArray(parsed?.fleets) ? parsed.fleets : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, runs: [], fleets: [] };
    throw new Error("Agent run registry is unreadable or malformed");
  }
}

export function createAgentRunRegistry({
  stateFile,
  codex,
  resolveProject,
  idFactory = randomUUID,
  now = () => Date.now()
} = {}) {
  if (!stateFile || !codex || typeof resolveProject !== "function") {
    throw new Error("Agent run registry dependencies are required");
  }

  const runs = new Map();
  const fleets = new Map();
  const sessionToRun = new Map();
  const pumping = new Set();
  let loaded = false;
  let loadPromise = null;
  let persistQueue = Promise.resolve();

  async function load() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        const state = await readState(stateFile);
        for (const raw of state.runs.slice(-MAX_RUNS)) {
          if (!raw?.id || !RUN_STATES.has(raw.state)) continue;
          const run = {
            ...raw,
            id: cleanId(raw.id),
            sessionId: cleanString(raw.sessionId, 200) || null,
            turnId: cleanString(raw.turnId, 200) || null,
            capabilityPolicy: normalizeAgentCapabilityPolicy(raw.capabilityPolicy),
            pendingApproval: raw.pendingApproval && typeof raw.pendingApproval === "object"
              ? raw.pendingApproval
              : null
          };
          runs.set(run.id, run);
          if (run.sessionId) sessionToRun.set(run.sessionId, run.id);
        }
        for (const raw of state.fleets.slice(-MAX_FLEETS)) {
          if (!raw?.id) continue;
          fleets.set(cleanId(raw.id), {
            ...raw,
            id: cleanId(raw.id),
            queue: Array.isArray(raw.queue) ? raw.queue.map(queuedSpec) : [],
            runIds: Array.isArray(raw.runIds) ? raw.runIds.map(id => cleanId(id, "runId")) : [],
            errors: Array.isArray(raw.errors) ? raw.errors.slice(-50) : []
          });
        }
        loaded = true;
      })().finally(() => { loadPromise = null; });
    }
    await loadPromise;
  }

  function stateObject() {
    return {
      version: 1,
      runs: [...runs.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).slice(-MAX_RUNS),
      fleets: [...fleets.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).slice(-MAX_FLEETS)
    };
  }

  function persist() {
    persistQueue = persistQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
      const temp = `${stateFile}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await writeFile(temp, JSON.stringify(stateObject(), null, 2), { mode: 0o600 });
      await rename(temp, stateFile);
    });
    return persistQueue;
  }

  function touch(run) {
    run.updatedAt = now();
  }

  async function markRun(run, patch) {
    Object.assign(run, patch);
    touch(run);
    if (run.sessionId) sessionToRun.set(run.sessionId, run.id);
    await persist();
    return publicRun(run);
  }

  async function failRun(run, error) {
    return markRun(run, {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
      pendingApproval: null
    });
  }

  async function createRun(input = {}, { fleetId = null } = {}) {
    await load();
    const parentRun = input.parentRunId ? runs.get(cleanId(input.parentRunId, "parentRunId")) : null;
    if (input.parentRunId && !parentRun) throw Object.assign(new Error("Unknown parent run"), { status: 404 });
    const spec = normalizeRunSpec(input, parentRun);

    await resolveProject(spec.context.projectId);

    const id = input.id ? cleanId(input.id) : cleanId(idFactory());
    if (runs.has(id)) throw Object.assign(new Error("Duplicate agent run id"), { status: 409 });

    const run = {
      id,
      ...spec,
      fleetId: fleetId ? cleanId(fleetId, "fleetId") : null,
      sessionId: null,
      turnId: null,
      state: "starting",
      output: "",
      error: null,
      pendingApproval: null,
      createdAt: now(),
      updatedAt: now()
    };
    runs.set(id, run);
    await persist();

    try {
      const threadParams = { projectId: spec.context.projectId };
      if (spec.model) threadParams.model = spec.model;
      const startedThread = await codex.request("thread/start", threadParams);
      const thread = startedThread?.thread;
      if (!thread?.id) throw new Error("Codex subagent did not return a thread id");

      run.sessionId = cleanString(thread.id, 200);
      run.state = "running";
      run.model = cleanString(startedThread?.model || run.model, 200) || null;
      sessionToRun.set(run.sessionId, run.id);
      await persist();

      const turnParams = {
        threadId: run.sessionId,
        input: [{ type: "text", text: scopedPrompt(run) }],
        clientUserMessageId: randomUUID()
      };
      if (run.model) turnParams.model = run.model;
      const startedTurn = await codex.request("turn/start", turnParams);
      run.turnId = cleanString(startedTurn?.turn?.id, 200) || null;
      touch(run);
      await persist();
      return publicRun(run);
    } catch (error) {
      await failRun(run, error);
      throw error;
    }
  }

  async function activeFleetRuns(fleet) {
    return fleet.runIds
      .map(id => runs.get(id))
      .filter(run => run && !TERMINAL_STATES.has(run.state));
  }

  async function pumpFleet(fleetId) {
    await load();
    const fleet = fleets.get(cleanId(fleetId, "fleetId"));
    if (!fleet || pumping.has(fleet.id) || fleet.state !== "running") return fleet ? publicFleet(fleet) : null;
    pumping.add(fleet.id);
    try {
      while (fleet.queue.length) {
        const active = await activeFleetRuns(fleet);
        if (active.length >= fleet.concurrency) break;
        const spec = fleet.queue.shift();
        fleet.updatedAt = now();
        await persist();
        try {
          const run = await createRun(spec, { fleetId: fleet.id });
          fleet.runIds.push(run.id);
        } catch (error) {
          fleet.errors.push({
            at: now(),
            error: error instanceof Error ? error.message : String(error)
          });
          fleet.errors = fleet.errors.slice(-50);
        }
        fleet.updatedAt = now();
        await persist();
      }

      const active = await activeFleetRuns(fleet);
      if (!fleet.queue.length && !active.length) {
        fleet.state = fleet.errors.length ? "completed_with_errors" : "completed";
        fleet.updatedAt = now();
        await persist();
      }
      return publicFleet(fleet);
    } finally {
      pumping.delete(fleet.id);
    }
  }

  async function startFleet(specs, { id, concurrency = 2 } = {}) {
    await load();
    if (!Array.isArray(specs) || !specs.length) throw Object.assign(new Error("Fleet requires at least one run"), { status: 400 });
    if (specs.length > MAX_FLEET_SIZE) throw Object.assign(new Error("Fleet is limited to 24 runs"), { status: 400 });
    const fleetId = id ? cleanId(id, "fleetId") : cleanId(idFactory());
    if (fleets.has(fleetId)) throw Object.assign(new Error("Duplicate fleet id"), { status: 409 });
    const fleet = {
      id: fleetId,
      concurrency: Math.max(1, Math.min(8, Number(concurrency) || 2)),
      state: "running",
      queue: specs.map(queuedSpec),
      runIds: [],
      errors: [],
      createdAt: now(),
      updatedAt: now()
    };
    fleets.set(fleetId, fleet);
    await persist();
    await pumpFleet(fleetId);
    return publicFleet(fleet);
  }

  async function list({ parentSessionId = "", limit = 100 } = {}) {
    await load();
    const parent = cleanString(parentSessionId, 200);
    return [...runs.values()]
      .filter(run => !parent || run.parentSessionId === parent)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)))
      .map(publicRun);
  }

  async function listFleets({ limit = 50 } = {}) {
    await load();
    return [...fleets.values()]
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, MAX_FLEETS)))
      .map(publicFleet);
  }

  async function get(id) {
    await load();
    const run = runs.get(cleanId(id));
    if (!run) throw Object.assign(new Error("Unknown agent run"), { status: 404 });
    return publicRun(run);
  }

  async function cancel(id) {
    await load();
    const run = runs.get(cleanId(id));
    if (!run) throw Object.assign(new Error("Unknown agent run"), { status: 404 });
    if (TERMINAL_STATES.has(run.state)) return publicRun(run);
    if (run.sessionId && run.turnId) {
      await codex.request("turn/interrupt", {
        threadId: run.sessionId,
        turnId: run.turnId
      });
    }
    return markRun(run, { state: "cancelled", pendingApproval: null });
  }

  async function respondApproval(id, decision) {
    await load();
    const run = runs.get(cleanId(id));
    if (!run) throw Object.assign(new Error("Unknown agent run"), { status: 404 });
    const approval = run.pendingApproval;
    if (!approval) throw Object.assign(new Error("Approval request is no longer pending"), { status: 409 });
    const normalized = cleanString(decision, 40);
    if (!["accept", "decline", "cancel"].includes(normalized)) {
      throw Object.assign(new Error("Unsupported approval decision"), { status: 400 });
    }
    const required = APPROVAL_CAPABILITY.get(approval.method);
    if (required && !run.capabilityPolicy.allow.includes(required) && normalized === "accept") {
      throw Object.assign(new Error(`${required} capability is denied by the inherited subagent policy`), { status: 403 });
    }
    codex.respondApproval(approval.id, normalized);
    return markRun(run, {
      state: normalized === "cancel" ? "cancelled" : "running",
      pendingApproval: null
    });
  }

  async function onCodexNotification(event = {}) {
    await load();
    const sessionId = threadIdFromParams(event.params || {});
    const runId = sessionId ? sessionToRun.get(sessionId) : null;
    if (!runId) return null;
    const run = runs.get(runId);
    if (!run) return null;
    const method = cleanString(event.method, 120);

    if (method === "turn/started") {
      return markRun(run, {
        state: "running",
        turnId: cleanString(event.params?.turn?.id || event.params?.turnId, 200) || run.turnId
      });
    }

    if (method === "item/agentMessage/delta") {
      const delta = typeof event.params?.delta === "string" ? event.params.delta : "";
      if (!delta) return publicRun(run);
      run.output = (String(run.output || "") + delta).slice(-MAX_OUTPUT_CHARS);
      touch(run);
      await persist();
      return publicRun(run);
    }

    if (method === "serverRequest/resolved") {
      return markRun(run, {
        state: "running",
        pendingApproval: null
      });
    }

    if (method === "turn/completed") {
      const state = statusToState(event.params?.turn?.status || "completed");
      const updated = await markRun(run, {
        state,
        turnId: cleanString(event.params?.turn?.id || event.params?.turnId, 200) || run.turnId,
        error: cleanString(event.params?.turn?.error?.message, 2000) || null,
        pendingApproval: null
      });
      if (run.fleetId) void pumpFleet(run.fleetId).catch(() => {});
      return updated;
    }
    return publicRun(run);
  }

  async function onCodexServerRequest(request = {}) {
    await load();
    const sessionId = threadIdFromParams(request.params || {});
    const runId = sessionId ? sessionToRun.get(sessionId) : null;
    if (!runId) return null;
    const run = runs.get(runId);
    if (!run) return null;
    const required = APPROVAL_CAPABILITY.get(request.method);

    if (required && !run.capabilityPolicy.allow.includes(required)) {
      try {
        codex.respondApproval(request.id, "decline");
      } catch (error) {
        return failRun(run, error);
      }
      return markRun(run, {
        state: "running",
        pendingApproval: null,
        lastPolicyDecision: {
          at: now(),
          capability: required,
          decision: "decline"
        }
      });
    }

    if (required) {
      return markRun(run, {
        state: "waiting_for_approval",
        pendingApproval: {
          id: request.id,
          method: request.method,
          params: request.params || {}
        }
      });
    }
    return publicRun(run);
  }

  async function reconcileRun(run) {
    if (!run.sessionId || TERMINAL_STATES.has(run.state)) return;
    try {
      const result = await codex.request("thread/read", {
        threadId: run.sessionId,
        includeTurns: true
      });
      const turns = result?.thread?.turns || [];
      const latest = turns.at(-1);
      if (latest?.id) run.turnId = cleanString(latest.id, 200);
      const state = statusToState(latest?.status || result?.thread?.status || run.state);
      run.state = state;
      if (TERMINAL_STATES.has(state)) run.pendingApproval = null;
      touch(run);
    } catch {
      // Keep persisted state. A later Codex online/reconcile can retry.
    }
  }

  async function resume() {
    await load();
    for (const run of runs.values()) {
      if (run.sessionId) sessionToRun.set(run.sessionId, run.id);
      await reconcileRun(run);
    }
    await persist();
    for (const fleet of fleets.values()) {
      if (fleet.state === "running") void pumpFleet(fleet.id).catch(() => {});
    }
    return {
      runs: await list({ limit: 200 }),
      fleets: await listFleets({ limit: MAX_FLEETS })
    };
  }

  return {
    createRun,
    startFleet,
    pumpFleet,
    list,
    listFleets,
    get,
    cancel,
    respondApproval,
    onCodexNotification,
    onCodexServerRequest,
    resume,
    state: async () => {
      await load();
      return stateObject();
    }
  };
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512 * 1024) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

export function createAgentRunApi({
  registry,
  authenticateDevice,
  claimOperation = () => true
} = {}) {
  if (!registry || typeof authenticateDevice !== "function") {
    throw new Error("Agent run API dependencies are required");
  }

  return {
    async handle(req, res, url) {
      if (url.pathname !== "/api/agent-runs" && !url.pathname.startsWith("/api/agent-runs/")) return false;
      try {
        const device = await authenticateDevice(req);
        if (!device?.id) {
          send(res, 401, { error: "Trusted device required" });
          return true;
        }

        if (req.method === "GET" && url.pathname === "/api/agent-runs") {
          send(res, 200, {
            runs: await registry.list({
              parentSessionId: url.searchParams.get("parentSessionId") || "",
              limit: url.searchParams.get("limit") || 100
            })
          });
          return true;
        }

        if (req.method === "GET" && url.pathname === "/api/agent-runs/fleets") {
          send(res, 200, {
            fleets: await registry.listFleets({
              limit: url.searchParams.get("limit") || 50
            })
          });
          return true;
        }

        if (req.method === "POST" && url.pathname === "/api/agent-runs") {
          if (!claimOperation(req, res, `agent-runs:${device.id}:create`)) return true;
          send(res, 201, { run: await registry.createRun(await readBody(req)) });
          return true;
        }

        if (req.method === "POST" && url.pathname === "/api/agent-runs/fleets") {
          if (!claimOperation(req, res, `agent-runs:${device.id}:fleet`)) return true;
          const payload = await readBody(req);
          send(res, 201, {
            fleet: await registry.startFleet(payload?.specs, {
              id: payload?.id,
              concurrency: payload?.concurrency
            })
          });
          return true;
        }

        const match = url.pathname.match(/^\/api\/agent-runs\/([^/]+)(?:\/(cancel|approval))?$/);
        if (!match) {
          send(res, 404, { error: "Unknown agent run endpoint" });
          return true;
        }
        const id = decodeURIComponent(match[1]);
        const action = match[2] || "";

        if (req.method === "GET" && !action) {
          send(res, 200, { run: await registry.get(id) });
          return true;
        }
        if (req.method === "POST" && action === "cancel") {
          if (!claimOperation(req, res, `agent-runs:${device.id}:${id}:cancel`)) return true;
          send(res, 200, { run: await registry.cancel(id) });
          return true;
        }
        if (req.method === "POST" && action === "approval") {
          if (!claimOperation(req, res, `agent-runs:${device.id}:${id}:approval`)) return true;
          const payload = await readBody(req);
          send(res, 200, { run: await registry.respondApproval(id, payload?.decision) });
          return true;
        }

        send(res, 405, { error: "Method not allowed" });
        return true;
      } catch (error) {
        send(res, Number(error?.status) || 400, {
          error: error instanceof Error ? error.message : "Agent run operation failed"
        });
        return true;
      }
    }
  };
}

export { CAPABILITY_GROUPS, TERMINAL_STATES };
