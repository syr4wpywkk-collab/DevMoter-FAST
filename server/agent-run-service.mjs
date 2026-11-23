import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  SubagentRuntime,
  normalizeCapabilityPolicy,
  scopedPrompt
} from "../src/subagent-runtime.mjs";
import { errorMessage } from "./error-message.mjs";

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
  const handle = await open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, filePath);
  } catch (error) {
    try {
      await unlink(temp);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        throw new AggregateError([error, cleanupError], "Agent run state write and temporary file cleanup failed");
      }
    }
    throw error;
  }
}

const DEFAULT_MAX_RUN_MS = 30 * 60 * 1000;

/**
 * Codex execution settings for a run, derived from its capability policy.
 * The scoped prompt only asks the model to stay inside the policy; the sandbox
 * and approval policy are what actually stop a prompt-injected subagent.
 */
export function codexExecutionSettingsFor(capabilityPolicy) {
  const effective = normalizeCapabilityPolicy(capabilityPolicy);
  const allows = group => effective.allow.includes(group);
  const readOnly =
    !allows("files") ||
    !allows("commands") ||
    effective.mutationPolicy === "read-only-until-explicit-transition";
  // Only ever tighten: an unrestricted run inherits the host's Codex configuration, which
  // may itself be read-only or "untrusted" and must not be widened by a delegated run.
  const settings = {};
  if (readOnly) settings.sandbox = "read-only";
  // "untrusted" asks before anything but known-safe read commands.
  if (!allows("commands")) settings.approvalPolicy = "untrusted";
  return settings;
}

export function createAgentRunService({
  filePath,
  codex,
  resolveProject,
  assertExecutionAllowed = () => {},
  maxRunMs = DEFAULT_MAX_RUN_MS,
  policy = { maxDepth: 3, tokenBudget: 12000, turnBudget: 8 },
  browserAgent = null
} = {}) {
  if (!filePath || !codex) throw new Error("Agent run service dependencies are required");
  if (typeof resolveProject !== "function") throw new Error("Agent run service requires a project resolver");
  const runDeadlineMs = Number.isFinite(Number(maxRunMs)) && Number(maxRunMs) > 0
    ? Math.min(Number(maxRunMs), 24 * 60 * 60 * 1000)
    : DEFAULT_MAX_RUN_MS;
  const deadlines = new Map();

  const events = new EventEmitter();
  const threadToRun = new Map();
  let persistTimer = null;
  let persistChain = Promise.resolve();
  let disposed = false;

  const adapter = {
    async start(run, emit) {
      const projectId = String(run.context?.projectId || "").trim();
      if (!projectId) throw new Error("A registered DevMoter Project is required for Codex subagents");

      assertExecutionAllowed();
      // Only a registered project selects the working directory; the id itself is never sent to Codex.
      const project = await resolveProject(projectId);
      const cwd = typeof project?.path === "string" ? project.path : "";
      if (!cwd.trim()) throw new Error("Registered project not found or unavailable");

      const threadParams = { cwd, ...codexExecutionSettingsFor(run.capabilityPolicy) };
      if (run.model) threadParams.model = run.model;
      const browserAccess = browserAgent ? browserAccessFor(run) : null;
      if (browserAccess) {
        if (TERMINAL_STATES.has(runtime.getRun(run.id)?.state)) throw new Error("Agent run ended before it started");
        const browser = await browserAgent.forRun({
          runId: run.id,
          projectId,
          access: browserAccess,
          deviceId: run.context?.browserDeviceId ? String(run.context.browserDeviceId) : null,
          ttlMs: runDeadlineMs
        });
        if (browser) threadParams.config = { ...browser.config };
      }
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
      if (decision === "acceptForSession") {
        throw new Error("Subagent approvals are granted one request at a time");
      }
      if (decision === "accept") assertExecutionAllowed();
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
        console.error("Agent run state persistence failed", errorMessage(error));
      });
    return persistChain;
  }

  function schedulePersistAndBroadcast(run) {
    if (disposed) return;
    events.emit("state", publicState());

    // Terminal transitions are durability boundaries. Keep noisy streaming
    // updates debounced, but do not leave a completed/failed/cancelled run
    // represented as active on disk if the host exits immediately after.
    if (run && TERMINAL_STATES.has(run.state)) {
      void persistNow();
      return;
    }

    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow();
    }, 150);
    persistTimer.unref?.();
  }

  function clearDeadline(runId) {
    const timer = deadlines.get(runId);
    if (timer) clearTimeout(timer);
    deadlines.delete(runId);
  }

  // A run that never reaches a terminal state (looping model, lost event) would hold its
  // fleet slot and keep consuming the backend forever; bound it by wall-clock time.
  function trackDeadline(run) {
    if (!run) return;
    if (TERMINAL_STATES.has(run.state)) {
      clearDeadline(run.id);
      return;
    }
    if (deadlines.has(run.id)) return;
    const timer = setTimeout(() => {
      deadlines.delete(run.id);
      const current = runtime.getRun(run.id);
      if (!current || TERMINAL_STATES.has(current.state)) return;
      if (current.pendingApproval) {
        try { codex.respondApproval(current.pendingApproval.id, "cancel"); } catch {}
      }
      if (current.sessionId && current.turnId) {
        void codex.request("turn/interrupt", { threadId: current.sessionId, turnId: current.turnId }).catch(() => {});
      }
      try {
        runtime.update(run.id, {
          state: "failed",
          error: "Agent run exceeded its execution time limit",
          pendingApproval: null
        });
      } catch (error) {
        console.error("Agent run deadline enforcement failed", errorMessage(error));
      }
    }, runDeadlineMs);
    timer.unref?.();
    deadlines.set(run.id, timer);
  }

  // Browser access is opt-in per run (context.browser = "read" | "act"), never
  // wider than the run's own read/mutation policy or its parent run's access.
  function browserAccessFor(run, depth = 0) {
    const requested = run?.context?.browser;
    let access = requested === "act" ? "act" : requested === "read" ? "read" : null;
    if (!access || depth > 8) return null;
    const effective = normalizeCapabilityPolicy(run.capabilityPolicy);
    if (!effective.allow.includes("read")) return null;
    if (effective.mutationPolicy === "read-only-until-explicit-transition") access = "read";
    if (run.parentRunId) {
      const parentAccess = browserAccessFor(runtime.getRun(run.parentRunId), depth + 1);
      if (!parentAccess) return null;
      if (parentAccess === "read") access = "read";
    }
    return access;
  }

  runtime.subscribe(run => {
    if (run && TERMINAL_STATES.has(run.state)) browserAgent?.revokeRun(run.id);
    if (!disposed) trackDeadline(run);
    schedulePersistAndBroadcast(run);
  });

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
    // Marking runs failed above already queued writes. Write through the same
    // queue so startup never has two writes in flight and `ready()` resolves
    // only after all of them, while a failed startup write still rejects.
    const startupWrite = persistChain.then(() => atomicWriteJson(filePath, runtime.exportState()));
    persistChain = startupWrite.catch(() => {});
    await startupWrite;
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
    // Late backend events must not revive a run that was cancelled, failed or timed out.
    if (TERMINAL_STATES.has(runtime.getRun(runId)?.state)) return;

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
      console.error("Agent run event update failed", errorMessage(error));
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
      if (TERMINAL_STATES.has(run.state) || !effective.allow.includes(required)) {
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
      console.error("Agent approval routing failed", errorMessage(error));
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

    flushPersistence() {
      return withReady(() => persistNow());
    },

    subscribe(listener) {
      events.on("state", listener);
      return () => events.off("state", listener);
    },

    async dispose() {
      disposed = true;
      browserAgent?.revokeAllRuns?.();
      for (const runId of [...deadlines.keys()]) clearDeadline(runId);
      await persistNow();
      await persistChain.catch(() => {});
      codex.off("notification", onNotification);
      codex.off("server-request", onServerRequest);
      runtime.dispose();
      events.removeAllListeners();
    }
  };
}
