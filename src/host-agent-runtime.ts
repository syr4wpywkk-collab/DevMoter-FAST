import type { SubagentRun } from "./subagent-runtime.mjs";

type FleetSnapshot = {
  id: string;
  concurrency: number;
  state: string;
  queued: number;
  runIds: string[];
  errors: Array<{ runId?: string; error?: string }>;
  createdAt: number;
  updatedAt: number;
};

type AgentState = {
  runs: SubagentRun[];
  fleets: FleetSnapshot[];
};

function operationId() {
  return globalThis.crypto?.randomUUID?.() ??
    `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class HostAgentRuntime {
  private runs = new Map<string, SubagentRun>();
  private fleets = new Map<string, FleetSnapshot>();
  private listeners = new Set<(run: SubagentRun) => void>();
  private events: EventSource | null = null;
  private refreshInFlight: Promise<AgentState> | null = null;

  constructor() {
    this.connectEvents();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.refresh().catch(() => {});
    });
    window.addEventListener("pageshow", () => void this.refresh().catch(() => {}));
    window.addEventListener("online", () => {
      this.connectEvents();
      void this.refresh().catch(() => {});
    });
  }

  private applyState(state: AgentState) {
    this.runs = new Map(
      (Array.isArray(state?.runs) ? state.runs : []).map(run => [String(run.id), run])
    );
    this.fleets = new Map(
      (Array.isArray(state?.fleets) ? state.fleets : []).map(fleet => [String(fleet.id), fleet])
    );
    for (const run of this.runs.values()) {
      for (const listener of this.listeners) listener(run);
    }
    return { runs: this.listRuns(), fleets: this.listFleets() };
  }

  private upsertRun(run: SubagentRun | null | undefined) {
    if (!run?.id) return;
    this.runs.set(String(run.id), run);
    for (const listener of this.listeners) listener(run);
  }

  private connectEvents() {
    if (this.events || !navigator.onLine) return;
    const source = new EventSource("/api/agent-runs/events");
    this.events = source;
    source.addEventListener("state", event => {
      try {
        this.applyState(JSON.parse((event as MessageEvent).data));
      } catch {
        // Ignore malformed recovery frames; the next snapshot is authoritative.
      }
    });
    source.onerror = () => {
      source.close();
      if (this.events === source) this.events = null;
    };
  }

  private async request<T>(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers || {});
    if (init.method && init.method !== "GET") {
      headers.set("content-type", "application/json");
      headers.set("x-pocket-operation-id", operationId());
    }
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Agent request failed (${response.status})`);
    return payload as T;
  }

  async refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.request<AgentState>("/api/agent-runs")
      .then(state => this.applyState(state))
      .finally(() => { this.refreshInFlight = null; });
    return this.refreshInFlight;
  }

  subscribe(listener: (run: SubagentRun) => void) {
    this.listeners.add(listener);
    for (const run of this.runs.values()) listener(run);
    return () => this.listeners.delete(listener);
  }

  listRuns() {
    return [...this.runs.values()].map(run => structuredClone(run));
  }

  getRun(id: string) {
    const run = this.runs.get(String(id));
    return run ? structuredClone(run) : null;
  }

  listFleets() {
    return [...this.fleets.values()].map(fleet => structuredClone(fleet));
  }

  getFleet(id: string) {
    const fleet = this.fleets.get(String(id));
    return fleet ? structuredClone(fleet) : null;
  }

  async spawn(spec: Record<string, unknown>) {
    const payload = await this.request<{ run: SubagentRun }>("/api/agent-runs", {
      method: "POST",
      body: JSON.stringify({ spec })
    });
    this.upsertRun(payload.run);
    return payload.run;
  }

  async runFleet(specs: Array<Record<string, unknown>>, options: { id?: string; concurrency?: number } = {}) {
    const payload = await this.request<{ fleet: FleetSnapshot }>("/api/agent-fleets", {
      method: "POST",
      body: JSON.stringify({
        specs,
        id: options.id,
        concurrency: options.concurrency
      })
    });
    this.fleets.set(payload.fleet.id, payload.fleet);
    await this.refresh();
    return payload.fleet;
  }

  async spawnSecondOpinion(parentRunId: string, options: Record<string, unknown> = {}) {
    const payload = await this.request<{ run: SubagentRun }>(
      `/api/agent-runs/${encodeURIComponent(parentRunId)}/second-opinion`,
      { method: "POST", body: JSON.stringify(options) }
    );
    this.upsertRun(payload.run);
    return payload.run;
  }

  async cancel(id: string) {
    const payload = await this.request<{ run: SubagentRun }>(
      `/api/agent-runs/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: "{}" }
    );
    this.upsertRun(payload.run);
    return payload.run;
  }

  async cancelFleet(id: string) {
    const payload = await this.request<{ fleet: FleetSnapshot }>(
      `/api/agent-fleets/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: "{}" }
    );
    this.fleets.set(payload.fleet.id, payload.fleet);
    await this.refresh();
    return payload.fleet;
  }

  async respondApproval(id: string, decision: "accept" | "acceptForSession" | "decline" | "cancel") {
    const payload = await this.request<{ run: SubagentRun }>(
      `/api/agent-runs/${encodeURIComponent(id)}/approval`,
      { method: "POST", body: JSON.stringify({ decision }) }
    );
    this.upsertRun(payload.run);
    return payload.run;
  }

  dispose() {
    this.events?.close();
    this.events = null;
    this.listeners.clear();
  }
}
