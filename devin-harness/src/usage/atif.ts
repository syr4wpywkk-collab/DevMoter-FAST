import type { Effort, UsageRecord } from "../types.js";

export interface AtifContext {
  taskId: string;
  model: string;
  effort: Effort | null;
  startedAt: string;
  durationMs: number | null;
  exitStatus: number | null;
  timedOut: boolean;
  runDir: string;
  isFreeTierModel: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface StepLike {
  timestamp?: unknown;
  tool_calls?: unknown;
  metrics?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    cached_tokens?: unknown;
  } | null;
}

/**
 * Parse a `devin --export` ATIF-v1.7 document into a UsageRecord.
 * Fully defensive: malformed JSON or missing fields yield null metrics,
 * never an exception. ATIF has no cache-write tokens and no USD amounts,
 * so cacheWriteTokens is always null.
 */
export function parseAtifExport(
  text: string | null,
  ctx: AtifContext,
): UsageRecord {
  const base: UsageRecord = {
    taskId: ctx.taskId,
    sessionId: null,
    model: ctx.model,
    modelDisplayName: null,
    effort: ctx.effort,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    toolCalls: null,
    durationMs: ctx.durationMs,
    exitStatus: ctx.exitStatus,
    timedOut: ctx.timedOut,
    isFreeTierModel: ctx.isFreeTierModel,
    startedAt: ctx.startedAt,
    runDir: ctx.runDir,
  };

  if (!text) return base;

  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return base;
    }
    doc = parsed as Record<string, unknown>;
  } catch {
    return base;
  }

  const sessionId =
    typeof doc.session_id === "string" ? doc.session_id : null;
  const agent =
    doc.agent && typeof doc.agent === "object"
      ? (doc.agent as Record<string, unknown>)
      : {};
  const modelDisplayName =
    typeof agent.model_name === "string" ? agent.model_name : null;

  const steps: StepLike[] = Array.isArray(doc.steps)
    ? (doc.steps as StepLike[])
    : [];

  // Token totals: final_metrics wins; otherwise sum per-step metrics.
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  const fm =
    doc.final_metrics && typeof doc.final_metrics === "object"
      ? (doc.final_metrics as Record<string, unknown>)
      : null;
  if (fm) {
    inputTokens = num(fm.total_prompt_tokens);
    outputTokens = num(fm.total_completion_tokens);
    cacheReadTokens = num(fm.total_cached_tokens);
  }
  if (inputTokens === null || outputTokens === null || cacheReadTokens === null) {
    let sumIn = 0;
    let sumOut = 0;
    let sumCache = 0;
    let any = false;
    for (const step of steps) {
      if (!step.metrics) continue;
      const p = num(step.metrics.prompt_tokens);
      const c = num(step.metrics.completion_tokens);
      const k = num(step.metrics.cached_tokens);
      if (p !== null) { sumIn += p; any = true; }
      if (c !== null) { sumOut += c; any = true; }
      if (k !== null) { sumCache += k; any = true; }
    }
    if (any) {
      if (inputTokens === null) inputTokens = sumIn;
      if (outputTokens === null) outputTokens = sumOut;
      if (cacheReadTokens === null) cacheReadTokens = sumCache;
    }
  }

  // Tool calls: total across steps (0 when steps exist but call none).
  let toolCalls: number | null = null;
  if (Array.isArray(doc.steps)) {
    toolCalls = 0;
    for (const step of steps) {
      if (Array.isArray(step.tool_calls)) toolCalls += step.tool_calls.length;
    }
  }

  // Duration: ctx wins; otherwise first-to-last step timestamps.
  let durationMs = ctx.durationMs;
  if (durationMs === null && steps.length > 0) {
    const times: number[] = [];
    for (const step of steps) {
      if (typeof step.timestamp === "string") {
        const t = Date.parse(step.timestamp);
        if (Number.isFinite(t)) times.push(t);
      }
    }
    if (times.length >= 2) {
      durationMs = Math.max(0, times[times.length - 1] - times[0]);
    } else if (times.length === 1) {
      durationMs = 0;
    }
  }

  return {
    ...base,
    sessionId,
    modelDisplayName,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens: null,
    toolCalls,
    durationMs,
  };
}
