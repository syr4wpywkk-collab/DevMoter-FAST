import { CATALOG_VERSION } from "./catalog.mjs";
import { planOperation, explainResult } from "./planner.mjs";
import { safeText } from "./projection.mjs";
import { TERMINAL } from "./run-store.mjs";

export function createToolsAiService({ store, dispatch, prepareChat, authorize }) {
  const controllers = new Map();
  const publicRun = run => { const { ownerId: _owner, requestId: _request, ...rest } = run; return rest; };
  const owned = async (id, identity) => {
    await store.ready(); const run = store.get(id);
    if (run.ownerId !== identity.ownerId || run.context.deviceId !== identity.deviceId) throw Object.assign(new Error("Tools AI run scope denied"), { status: 403 });
    // Recorded results/cancellation remain accessible if a project was removed. Execution still revalidates its scope.
    await authorize({ ...run.context, project: null }, identity);
    return store.get(id);
  };
  const execute = async (run, prepared, controller, identity) => {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    const chat = (messages, currentSignal) => prepared.chat(messages, currentSignal);
    try {
      await authorize(run.context, identity);
      const proposal = await planOperation({ chat, goal: safeText(run.rawGoal, prepared.secrets, 8_000), context: run.context, signal });
      if (store.get(run.runId).cancellation.requested) throw new DOMException("Stopped", "AbortError");
      signal.throwIfAborted();
      await authorize(run.context, identity);
      await store.beginStep(run.runId, proposal);
      // A Stop may race with durable persistence. Recheck before the first helper.
      signal.throwIfAborted();
      const result = await dispatch(proposal, run.context, { signal, secrets: prepared.secrets });
      const current = store.get(run.runId);
      const steps = current.steps.map(s => ({ ...s, status: "completed", endedAt: Date.now(), result }));
      await store.update(run.runId, { steps });
      signal.throwIfAborted();
      await authorize(run.context, identity);
      const explanation = await explainResult({ chat, goal: safeText(run.rawGoal, prepared.secrets, 8_000), result, signal });
      signal.throwIfAborted();
      if (store.get(run.runId).cancellation.requested) throw new DOMException("Stopped", "AbortError");
      await store.update(run.runId, { status: "completed", explanation });
    } catch (error) {
      const current = store.get(run.runId);
      const stopped = current.cancellation.requested;
      const failure = stopped && signal.aborted ? null : safeText(error.message || String(error), prepared.secrets);
      await store.update(run.runId, {
        status: stopped ? "stopped" : "failed", failure,
        cancellation: { ...current.cancellation, stage: stopped ? "broker-stopped" : current.cancellation.stage },
        steps: current.steps.map(s => s.status === "running" ? { ...s, status: stopped ? "stopped" : "failed", failure, endedAt: Date.now() } : s)
      });
    } finally { controllers.delete(run.runId); }
  };
  return {
    async start(payload, identity) {
      if (!payload || Object.keys(payload).some(k => !["goal", "projectId", "providerId", "model", "requestId"].includes(k))) throw new Error("Unexpected Tools AI input");
      if (typeof payload.goal !== "string" || !payload.goal.trim() || Buffer.byteLength(payload.goal) > 8_000) throw new Error("Goal must be between 1 and 8000 bytes");
      if (typeof payload.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.requestId)) throw new Error("A stable request ID is required");
      const prepared = await prepareChat(payload, identity);
      const run = await store.create({ requestId: payload.requestId, ownerId: identity.ownerId, goal: payload.goal,
        context: prepared.context, catalogVersion: CATALOG_VERSION });
      // Request-ID reconciliation can find and stop a run while its initial write is awaiting disk.
      if (TERMINAL.has(run.status) || run.cancellation.requested) return publicRun(run);
      const controller = new AbortController(); controllers.set(run.runId, controller);
      void execute(run, prepared, controller, identity).catch(async error => {
        console.error("Tools AI persistence failure", safeText(error.message, prepared.secrets));
        controllers.delete(run.runId);
      });
      return publicRun(run);
    },
    async get(id, identity) { return publicRun(await owned(id, identity)); },
    async findRequest(requestId, identity) {
      await store.ready();
      const run = store.findRequest(requestId, identity.ownerId, identity.deviceId);
      return publicRun(await owned(run.runId, identity));
    },
    async stop(id, identity) {
      const run = await owned(id, identity);
      if (TERMINAL.has(run.status)) return publicRun(run);
      const controller = controllers.get(id);
      if (!controller) return publicRun(await store.update(id, { status: "unknown", failure: "実行状態を照合できません。開始待ちの処理は継続しません。",
        cancellation: { requested: true, stage: "unknown", providerMayContinue: true } }));
      // Memory state changes synchronously in update, before abort resolves model promises.
      const pending = store.update(id, { status: "stop_requested", cancellation: { requested: true, stage: run.status === "running" ? "waiting-for-bounded-read-or-model" : "aborting-model-request", providerMayContinue: true } });
      controller.abort(); await pending;
      return publicRun(store.get(id));
    }
  };
}
