import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SubagentRuntime,
  normalizeCapabilityPolicy,
  scopedPrompt
} from "../src/subagent-runtime.mjs";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const APPROVAL_CAPABILITY = new Map([
  ["item/fileChange/requestApproval", "files"],
  ["item/commandExecution/requestApproval", "commands"]
]);

function threadIdFromParams(params = {}) {
  return String(
    params?.threadId ||
    params?.thread?.id ||
    params?.turn?.threadId ||
    params?.item?.threadId ||
    ""
  ).slice(0, 200);
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, filePath);
}

export function createAgentRunService({
  filePath,
  codex,
  policy = { maxDepth: 3, tokenBudget: 12000, turnBudget: 8 }
} = {}) {
  if (!filePath || !codex) throw new Error("Agent run service dependencies are required");

  const events = new EventEmitter();
  const threadToRun = new Map();
  let persistTimer = null;
  let persistChain = Promise.resolve();
  let disposed = false;

  const adapter = {
    async start(run, emit) {
      const projectId = String(run.context?.projectId || "").trim();
      if (!projectId) throw new Error("A registered DevMoter Project is required for Codex subagents");

      const threadParams = { projectId };
      if (run.model) threadParams.model = run.model;
      const startedThread = await codex.request("thread/start", threadParams);
      const thread = startedThread?.thread;
      if (!thread?.id) throw new Error("Codex subagent did not return a thread id");

      threadToRun.set(String(thread.id), run.id);
      emit({
        sessionId: String(thread.id),
        effectiveModel: startedThread?.model || run.model || null,
        state: "running"
      });

      const turnParams = {
        threadId: thread.id,
        input: [{ type: "text", text: scopedPrompt(run) }],
        clientUserMessageId: randomUUID()
      };
      if (run.model) turnParams.model = run.model;
      const startedTurn = await codex.request("turn/start", turnParams);

      return {
        sessionId: String(thread.id),
        turnId: startedTurn?.turn?.id || null,
        effectiveModel: startedThread?.model || run.model || null,
        state: "running"
      };
    },

    async cancel(run) {
      if (!run.sessionId || !run.turnId) return;
      await codex.request("turn/interrupt", {
        threadId: run.sessionId,
        turnId: run.turnId
      });
    },

    async respondApproval(run, decision) {
      const approval = run.pendingApproval;
      if (!approval) throw new Error("Approval request is no longer pending");
      const required = APPROVAL_CAPABILITY.get(String(approval.method || ""));
      const effective = normalizeCapabilityPolicy(run.capabilityPolicy);
      if (
        required &&
        !effective.allow.includes(required) &&
        decision !== "decline" &&
        decision !== "cancel"
      ) {
        throw new Error(`${required} capability is denied by the inherited subagent policy`);
      }
      codex.respondApproval(approval.id, decision);
    }
  };

  const runtime = new SubagentRuntime({
    adapters: { codex: adapter },
    policy
  });

  function publicState() {
    return {
      runs: runtime.listRuns(),
      fleets: runtime.listFleets()
    };
  }

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistChain = persistChain
      .then(() => atomicWriteJson(filePath, runtime.exportState()))
      .catch(error => {
        console.error("Agent run state persistence failed", error instanceof Error ? error.message : String(error));
      });
    return persistChain;
  }

  function schedulePersistAndBroadcast() {
    if (disposed) return;
    events.emit("state", publicState());
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow();
    }, 150);
    persistTimer.unref?.();
  }

  runtime.subscribe(schedulePersistAndBroadcast);

  function rebuildThreadIndex() {
    threadToRun.clear();
    for (const run of runtime.listRuns()) {
      if (run.sessionId) threadToRun.set(String(run.sessionId), run.id);
    }
  }

  const readyPromise = (async () => {
    const persisted = await readJsonFile(filePath);
    if (!persisted) return;

    const sanitized = {
      ...persisted,
      fleets: (Array.isArray(persisted.fleets) ? persisted.fleets : []).map(fleet => {
        if (fleet?.state !== "running") return fleet;
        return { ...fleet, state: "cancelled", queue: [], pumping: false };
      })
    };
    runtime.restoreState(sanitized);
    rebuildThreadIndex();

    for (const run of runtime.listRuns()) {
      if (!TERMINAL_STATES.has(run.state)) {
        runtime.update(run.id, {
          state: "failed",
          error: "Host restarted while this agent run was active",
          pendingApproval: null
        });
      }
    }
    await atomicWriteJson(filePath, runtime.exportState());
  })();

  function runIdForParams(params) {
    const threadId = threadIdFromParams(params);
    return threadId ? threadToRun.get(threadId) : null;
  }

  function onNotification(event) {
    const runId = runIdForParams(event?.params || {});
    if (!runId) return;
    const method = String(event?.method || "");
    const params = event?.params || {};

    try {
      if (method === "turn/started") {
        runtime.update(runId, {
          state: "running",
          turnId: params?.turn?.id || params?.turnId || runtime.getRun(runId)?.turnId || null
        });
        return;
      }

      if (method === "item/agentMessage/delta") {
        if (typeof params?.delta === "string" && params.delta) {
          runtime.update(runId, { outputDelta: params.delta });
        }
        return;
      }

      if (method === "serverRequest/resolved") {
        const run = runtime.getRun(runId);
        if (run?.pendingApproval) runtime.update(runId, { state: "running", pendingApproval: null });
        return;
      }

      if (method === "turn/completed") {
        const rawStatus = String(params?.turn?.status || "").toLowerCase();
        const state =
          rawStatus === "failed" ? "failed" :
          rawStatus === "interrupted" ? "cancelled" :
          "completed";
        runtime.update(runId, {
          state,
          turnId: params?.turn?.id || params?.turnId || runtime.getRun(runId)?.turnId || null,
          error: params?.turn?.error?.message || null,
          pendingApproval: null
        });
      }
    } catch (error) {
      console.error("Agent run event update failed", error instanceof Error ? error.message : String(error));
    }
  }

  function onServerRequest(request) {
    const runId = runIdForParams(request?.params || {});
    if (!runId) return;
    const method = String(request?.method || "");
    const required = APPROVAL_CAPABILITY.get(method);
    if (!required) return;

    try {
      const run = runtime.getRun(runId);
      if (!run) return;
      const effective = normalizeCapabilityPolicy(run.capabilityPolicy);
      if (!effective.allow.includes(required)) {
        codex.respondApproval(request.id, "decline");
        return;
      }
      runtime.update(runId, {
        state: "waiting_for_approval",
        pendingApproval: {
          id: request.id,
          method,
          params: request.params || {}
        }
      });
    } catch (error) {
      console.error("Agent approval routing failed", error instanceof Error ? error.message : String(error));
    }
  }

  codex.on("notification", onNotification);
  codex.on("server-request", onServerRequest);

  async function withReady(fn) {
    await readyPromise;
    return fn();
  }

  return {
    ready: () => readyPromise,

    list() {
      return withReady(() => publicState());
    },

    getRun(id) {
      return withReady(() => runtime.getRun(id));
    },

    spawn(spec) {
      return withReady(async () => {
        const run = await runtime.spawn(spec);
        await persistNow();
        return run;
      });
    },

    runFleet(specs, options) {
      return withReady(async () => {
        const fleet = await runtime.runFleet(specs, options);
        await persistNow();
        return fleet;
      });
    },

    spawnSecondOpinion(parentRunId, options) {
      return withReady(async () => {
        const run = await runtime.spawnSecondOpinion(parentRunId, options);
        await persistNow();
        return run;
      });
    },

    cancel(id) {
      return withReady(async () => {
        const run = await runtime.cancel(id);
        await persistNow();
        return run;
      });
    },

    cancelFleet(id) {
      return withReady(async () => {
        const fleet = await runtime.cancelFleet(id);
        await persistNow();
        return fleet;
      });
    },

    respondApproval(id, decision) {
      return withReady(async () => {
        const run = await runtime.respondApproval(id, decision);
        await persistNow();
        return run;
      });
    },

    subscribe(listener) {
      events.on("state", listener);
      return () => events.off("state", listener);
    },

    async dispose() {
      disposed = true;
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        await persistNow();
      }
      await persistChain.catch(() => {});
      codex.off("notification", onNotification);
      codex.off("server-request", onServerRequest);
      runtime.dispose();
      events.removeAllListeners();
    }
  };
}
