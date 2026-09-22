export type SubagentState = "starting" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
export type SubagentRun = {
  id: string;
  kind: string;
  backend: string;
  parentSessionId: string;
  parentRunId: string | null;
  fleetId: string | null;
  role: string;
  model: string | null;
  effectiveModel: string | null;
  task: string;
  fingerprint: string;
  context: Record<string, unknown>;
  lineage: string[];
  depth: number;
  budget: { tokenLimit: number; turnLimit: number; tokensRemaining: number; turnsRemaining: number };
  state: SubagentState;
  sessionId: string | null;
  turnId: string | null;
  output: string;
  error: string | null;
  pendingApproval: null | { id: string | number; method: string; params: Record<string, unknown> };
  createdAt: number;
  updatedAt: number;
};
export type SubagentAdapter = {
  start(run: SubagentRun, emit: (patch: Record<string, unknown>) => void): Promise<Record<string, unknown> | void>;
  cancel(run: SubagentRun): Promise<void>;
  respondApproval?(run: SubagentRun, decision: string): Promise<void>;
  dispose?(): void;
};
export class SubagentRuntime {
  constructor(options?: {
    adapters?: Record<string, SubagentAdapter>;
    idFactory?: () => string;
    policy?: { maxDepth?: number; tokenBudget?: number; turnBudget?: number };
  });
  registerAdapter(name: string, adapter: SubagentAdapter): void;
  subscribe(listener: (run: SubagentRun) => void): () => boolean;
  listRuns(): SubagentRun[];
  getRun(id: string): SubagentRun | null;
  spawn(spec: {
    id?: string;
    kind?: string;
    backend?: string;
    parentSessionId: string;
    parentRunId?: string;
    fleetId?: string;
    role?: string;
    model?: string;
    task: string;
    context?: Record<string, unknown>;
    lineage?: string[];
    tokenBudget?: number;
    turnBudget?: number;
  }): Promise<SubagentRun | null>;
  listFleets(): Array<{ id: string; concurrency: number; state: string; queued: number; runIds: string[]; errors: Array<{ runId: string; error: string }>; createdAt: number; updatedAt: number }>;
  getFleet(id: string): { id: string; concurrency: number; state: string; queued: number; runIds: string[]; errors: Array<{ runId: string; error: string }>; createdAt: number; updatedAt: number } | null;
  runFleet(specs: Array<Record<string, unknown>>, options?: { id?: string; concurrency?: number }): Promise<{ id: string; concurrency: number; state: string; queued: number; runIds: string[]; errors: Array<{ runId: string; error: string }>; createdAt: number; updatedAt: number }>;
  cancelFleet(id: string): Promise<{ id: string; concurrency: number; state: string; queued: number; runIds: string[]; errors: Array<{ runId: string; error: string }>; createdAt: number; updatedAt: number }>;
  spawnSecondOpinion(parentRunId: string, options?: {
    backend?: string;
    role?: string;
    model?: string;
    task?: string;
    share?: { task?: boolean; output?: boolean; error?: boolean };
    tokenBudget?: number;
    turnBudget?: number;
  }): Promise<SubagentRun | null>;
  update(id: string, patch?: Record<string, unknown>): SubagentRun;
  cancel(id: string): Promise<SubagentRun>;
  respondApproval(id: string, decision: string): Promise<SubagentRun>;
  dispose(): void;
}
export function createCodexSubagentAdapter(options?: {
  fetchImpl?: typeof fetch;
  eventSourceFactory?: (url: string) => EventSource;
}): SubagentAdapter;
