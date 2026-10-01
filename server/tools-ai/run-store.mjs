import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const TERMINAL = new Set(["completed", "failed", "stopped", "unknown"]);
export function createRunStore({ filePath, maxRuns = 50 }) {
  let runs = new Map();
  const persist = async candidate => {
    const snapshot = JSON.stringify({ version: 1, runs: [...candidate.values()] });
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, filePath);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  };
  const ready = (async () => {
    let parsed;
    try { parsed = JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) throw new Error("Invalid Tools AI run store");
    const restored = new Map();
    for (const stored of parsed.runs.slice(-maxRuns)) {
      const run = structuredClone(stored);
      if (!TERMINAL.has(run.status)) {
        run.status = "unknown"; run.updatedAt = Date.now();
        run.failure = "Host再起動後の実行状態は照合できません。自動再開していません。";
        run.cancellation = { ...run.cancellation, stage: "unknown" };
        run.steps = run.steps.map(step => step.status === "running" ? { ...step, status: "unknown" } : step);
      }
      restored.set(run.runId, run);
    }
    // Recovery is durable before any restored state becomes observable.
    await persist(restored);
    runs = restored;
  })();

  let mutations = ready.then(() => undefined, () => undefined);
  const commit = mutator => {
    const task = mutations.then(async () => {
      await ready;
      const draft = new Map([...runs].map(([id, run]) => [id, structuredClone(run)]));
      const outcome = mutator(draft) || {};
      if (outcome.changed === false) return structuredClone(outcome.value);
      // Publish the new in-memory snapshot only after the atomic rename succeeds.
      await persist(draft);
      runs = draft;
      return structuredClone(outcome.value);
    });
    mutations = task.catch(() => {});
    return task;
  };

  const get = id => { const run = runs.get(id); if (!run) throw Object.assign(new Error("Tools AI run not found"), { status: 404 }); return structuredClone(run); };
  return {
    ready: () => ready,
    get,
    findRequest(requestId, ownerId, deviceId) {
      const run = [...runs.values()].find(r => r.requestId === requestId && r.ownerId === ownerId && r.context.deviceId === deviceId);
      if (!run) throw Object.assign(new Error("Request outcome not recorded; do not assume execution or success"), { status: 404 });
      return get(run.runId);
    },
    async create({ requestId, ownerId, goal, context, catalogVersion }) {
      return commit(draft => {
        const duplicate = [...draft.values()].find(r => r.requestId === requestId && r.ownerId === ownerId && r.context.deviceId === context.deviceId);
        if (duplicate) throw Object.assign(new Error("Duplicate Tools AI request; inspect the original run, do not assume success"), { status: 409, runId: duplicate.runId, outcome: duplicate.status });
        while (draft.size >= maxRuns) {
          const oldest = [...draft.values()].find(r => TERMINAL.has(r.status));
          if (!oldest) throw Object.assign(new Error("Too many active Tools AI runs"), { status: 429 });
          draft.delete(oldest.runId);
        }
        const run = { runId: randomUUID(), requestId, ownerId, createdAt: Date.now(), updatedAt: Date.now(), status: "planning", rawGoal: goal,
          planner: context.planner, context, catalogVersion, steps: [], explanation: null, failure: null,
          cancellation: { requested: false, stage: null, providerMayContinue: false }, unresolvedQuestion: null, pendingApprovalReference: null };
        draft.set(run.runId, run);
        return { value: run };
      });
    },
    async update(id, patch) {
      return commit(draft => {
        const run = draft.get(id);
        if (!run) throw new Error("Tools AI run not found");
        // Terminal outcomes are immutable; a late Stop or failure path must not roll them back.
        if (TERMINAL.has(run.status)) return { changed: false, value: run };
        const next = typeof patch === "function" ? patch(structuredClone(run)) : patch;
        if (next == null) return { changed: false, value: run };
        Object.assign(run, next, { updatedAt: Math.max(Date.now(), run.updatedAt + 1) });
        return { value: run };
      });
    },
    async beginStep(id, proposal, stepOperationId = randomUUID()) {
      return commit(draft => {
        const run = draft.get(id);
        if (!run) throw new Error("Tools AI run not found");
        if (run.cancellation.requested || TERMINAL.has(run.status)) throw new Error("Run cannot start another operation");
        if (run.steps.some(s => s.stepOperationId === stepOperationId)) throw Object.assign(new Error("Duplicate step operation ID; outcome must be inspected"), { status: 409 });
        const step = { stepOperationId, operationId: proposal.operationId, validatedInput: proposal.input, reason: proposal.reason,
          status: "running", startedAt: Date.now(), resultReference: `${id}:${stepOperationId}`, result: null, failure: null, cancellationCapability: "non-cancellable" };
        run.status = "running";
        run.steps = [...run.steps, step];
        run.updatedAt = Math.max(Date.now(), run.updatedAt + 1);
        return { value: run };
      });
    }
  };
}
