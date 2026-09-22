export type GuardFinding = {
  code: string;
  severity: "warn" | "block";
  message: string;
  paths?: string[];
};

export type GuardResult = {
  decision: "allow" | "warn" | "block";
  findings: GuardFinding[];
};

export type CommandScan = {
  command: string;
  dangerous: boolean;
  risk: "high" | "normal";
  reasons: string[];
  advisory: boolean;
  note: string;
};

export type LoopResult = {
  runId: string;
  threshold: number;
  windowSize: number;
  paused: boolean;
  reason: string | null;
  recentActions: Array<{
    at: number;
    action: string;
    tool: string;
    details: unknown;
  }>;
};

export type PermissionScope = {
  backend: string;
  tool: string;
  action: string;
  projectId?: string;
  sessionId?: string;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

export function runPreExecutionGuard(task: string): Promise<GuardResult> {
  return postJson<GuardResult>("/api/safety/guard", { task });
}

export function scanCommand(command: string): Promise<CommandScan> {
  return postJson<CommandScan>("/api/safety/command-scan", { command });
}

export function recordAgentAction(input: {
  runId: string;
  action: string;
  tool: string;
  details?: unknown;
}): Promise<LoopResult> {
  return postJson<LoopResult>("/api/safety/actions", input);
}

export function continueAgentRun(runId: string): Promise<LoopResult> {
  return postJson<LoopResult>(
    `/api/safety/actions/${encodeURIComponent(runId)}/continue`,
    {}
  );
}

export function matchRememberedPermission(
  scope: PermissionScope,
  command?: string
): Promise<{ matched: boolean; blockedByRisk: boolean; commandScan?: CommandScan }> {
  return postJson("/api/safety/permissions/match", { scope, command });
}

export async function rememberPermission(
  scope: PermissionScope,
  options: { dangerous?: boolean; note?: string; ttlMs?: number } = {}
): Promise<void> {
  const response = await fetch("/api/safety/permissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pocket-operation-id": `remember-permission-${crypto.randomUUID?.() || Date.now()}`
    },
    body: JSON.stringify({
      scope,
      dangerous: options.dangerous === true,
      note: options.note,
      ttlMs: options.ttlMs
    })
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
}

export function guardMessage(result: GuardResult) {
  return result.findings.map(item => `• ${item.message}`).join("\n");
}

export function loopMessage(result: LoopResult) {
  const recent = result.recentActions
    .slice(-6)
    .map(item => `• ${item.tool}: ${item.action}`)
    .join("\n");
  return [result.reason || "Repeated action detected.", recent].filter(Boolean).join("\n");
}
