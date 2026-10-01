import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const TERMINAL = new Set(["completed", "failed", "stopped", "unknown"]);
export function createRunStore({ filePath, maxRuns = 50 }) {
  const runs = new Map(); let writes = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify({ version: 1, runs: [...runs.values()] });
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const temp = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 }); await rename(temp, filePath);
    });
    return writes;
  };
  const ready = (async () => {
    let parsed;
    try { parsed = JSON.parse(await readFile(filePath, "utf8")); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) throw new Error("Invalid Tools AI run store");
    for (const run of parsed.runs.slice(-maxRuns)) {
      if (!TERMINAL.has(run.status)) {
        run.status = "unknown"; run.updatedAt = Date.now();
        run.failure = "Host再起動後の実行状態は照合できません。自動再開していません。";
        run.cancellation = { ...run.cancellation, stage: "unknown" };
        run.steps = run.steps.map(step => step.status === "running" ? { ...step, status: "unknown" } : step);
      }
      runs.set(run.runId, run);
    }
    await save();
  })();
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
      await ready;
      const duplicate = [...runs.values()].find(r => r.requestId === requestId && r.ownerId === ownerId && r.context.deviceId === context.deviceId);
      if (duplicate) throw Object.assign(new Error("Duplicate Tools AI request; inspect the original run, do not assume success"), { status: 409, runId: duplicate.runId, outcome: duplicate.status });
      while (runs.size >= maxRuns) {
        const oldest = [...runs.values()].find(r => TERMINAL.has(r.status));
        if (!oldest) throw Object.assign(new Error("Too many active Tools AI runs"), { status: 429 });
        runs.delete(oldest.runId);
      }
      const run = { runId: randomUUID(), requestId, ownerId, createdAt: Date.now(), updatedAt: Date.now(), status: "planning", rawGoal: goal,
        planner: context.planner, context, catalogVersion, steps: [], explanation: null, failure: null,
        cancellation: { requested: false, stage: null, providerMayContinue: false }, unresolvedQuestion: null, pendingApprovalReference: null };
      runs.set(run.runId, run); await save(); return get(run.runId);
    },
    async update(id, patch) {
      const run = runs.get(id); if (!run) throw new Error("Tools AI run not found");
      Object.assign(run, patch, { updatedAt: Math.max(Date.now(), run.updatedAt + 1) }); await save(); return get(id);
    },
    async beginStep(id, proposal, stepOperationId = randomUUID()) {
      const run = get(id);
      if (run.cancellation.requested || TERMINAL.has(run.status)) throw new Error("Run cannot start another operation");
      if (run.steps.some(s => s.stepOperationId === stepOperationId)) throw Object.assign(new Error("Duplicate step operation ID; outcome must be inspected"), { status: 409 });
      const step = { stepOperationId, operationId: proposal.operationId, validatedInput: proposal.input, reason: proposal.reason,
        status: "running", startedAt: Date.now(), resultReference: `${id}:${stepOperationId}`, result: null, failure: null, cancellationCapability: "non-cancellable" };
      return this.update(id, { status: "running", steps: [...run.steps, step] });
    }
  };
}
