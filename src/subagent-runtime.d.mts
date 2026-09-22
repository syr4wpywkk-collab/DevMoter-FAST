export type SubagentState = "starting" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
export type SubagentRun = {
  id: string;
  kind: string;
  backend: string;
  parentSessionId: string;
  parentRunId: string | null;
  role: string;
  model: string | null;
  effectiveModel: string | null;
  task: string;
  context: Record<string, unknown>;
  lineage: string[];
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
  constructor(options?: { adapters?: Record<string, SubagentAdapter>; idFactory?: () => string });
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
    role?: string;
    model?: string;
    task: string;
    context?: Record<string, unknown>;
    lineage?: string[];
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
