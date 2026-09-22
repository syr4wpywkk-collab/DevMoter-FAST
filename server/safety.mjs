import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_LOOP_THRESHOLD = 3;
const DEFAULT_LOOP_WINDOW = 20;
const MAX_HISTORY = 80;

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stableValue(value[key])])
  );
}

function signatureFor(action) {
  return JSON.stringify(stableValue({
    action: String(action?.action || ""),
    tool: String(action?.tool || ""),
    details: action?.details ?? null
  }));
}

export function scanHighRiskCommand(command) {
  const exact = String(command || "").trim();
  const normalized = exact.replace(/\s+/g, " ").trim();
  const reasons = [];

  const checks = [
    [/(^|[;&|]\s*)rm\s+[^\n]*(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r|--recursive)[^\n]*(?:\/|~|\$HOME)(?:\s|$)/i, "recursive forced deletion targeting a broad path"],
    [/\b(?:mkfs(?:\.[a-z0-9]+)?|wipefs)\b/i, "filesystem formatting or signature removal"],
    [/\bdd\s+[^\n]*\bof=\/dev\//i, "raw block-device write"],
    [/\b(?:shutdown|reboot|poweroff|halt)\b/i, "host power-state change"],
    [/\bgit\s+reset\s+--hard\b/i, "destructive Git reset"],
    [/\bgit\s+clean\s+-[^\s]*[fdx][^\s]*\b/i, "destructive Git clean"],
    [/\bgit\s+push\b[^\n]*\s--force(?:-with-lease)?\b/i, "forced remote Git update"],
    [/\bchmod\s+(?:-R\s+)?777\b/i, "world-writable permission change"],
    [/\bchown\s+-R\b[^\n]*\s\/(?:\s|$)/i, "recursive ownership change from filesystem root"],
    [/(?:curl|wget)[^\n|]*(?:\||\|&)\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i, "download piped directly into a shell"],
    [/\bsudo\s+\S+/i, "privileged command"]
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(normalized)) reasons.push(reason);
  }

  const dangerous = reasons.length > 0;
  return {
    command: exact,
    dangerous,
    risk: dangerous ? "high" : "normal",
    reasons,
    advisory: true,
    note: dangerous
      ? "This scanner is advisory. The normal approval boundary remains authoritative."
      : "No high-risk pattern matched. This is not a guarantee that the command is safe."
  };
}

export function createLoopDetector(options = {}) {
  const threshold = clampInt(options.threshold, DEFAULT_LOOP_THRESHOLD, 2, 12);
  const windowSize = clampInt(options.windowSize, DEFAULT_LOOP_WINDOW, threshold, 100);
  const runs = new Map();

  function stateFor(runId) {
    const key = String(runId || "global").slice(0, 200);
    if (!runs.has(key)) {
      runs.set(key, { key, history: [], paused: false, reason: null, pausedAt: null });
    }
    return runs.get(key);
  }

  function record(runId, action) {
    const state = stateFor(runId);
    const entry = {
      at: Date.now(),
      signature: signatureFor(action),
      action: String(action?.action || ""),
      tool: String(action?.tool || ""),
      details: action?.details ?? null
    };
    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);

    const recentWindow = state.history.slice(-windowSize);
    const repeated = recentWindow.filter(item => item.signature === entry.signature);
    const tail = [];
    for (let index = recentWindow.length - 1; index >= 0; index -= 1) {
      if (recentWindow[index].signature !== entry.signature) break;
      tail.unshift(recentWindow[index]);
    }

    if (tail.length >= threshold || repeated.length >= threshold + 1) {
      state.paused = true;
      state.pausedAt = Date.now();
      state.reason =
        tail.length >= threshold
          ? `Repeated the same action ${tail.length} times in a row.`
          : `Repeated the same action ${repeated.length} times inside the recent action window.`;
    }

    return inspect(runId);
  }

  function inspect(runId) {
    const state = stateFor(runId);
    return {
      runId: state.key,
      threshold,
      windowSize,
      paused: state.paused,
      reason: state.reason,
      pausedAt: state.pausedAt,
      recentActions: state.history.slice(-Math.max(threshold + 2, 8)).map(({ signature, ...item }) => item)
    };
  }

  function continueRun(runId) {
    const state = stateFor(runId);
    state.paused = false;
    state.reason = null;
    state.pausedAt = null;
    return inspect(runId);
  }

  function clear(runId) {
    runs.delete(String(runId || "global").slice(0, 200));
  }

  return { threshold, windowSize, record, inspect, continueRun, clear };
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathInScope(path, scope) {
  const normalizedPath = normalizePath(path);
  const normalizedScope = normalizePath(scope);
  if (!normalizedScope || normalizedScope === ".") return true;
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

export function evaluatePreExecutionGuard(input = {}, policy = {}) {
  const task = String(input.task || "").trim();
  const plannedMutations = Array.isArray(input.plannedMutations) ? input.plannedMutations.map(String) : [];
  const requestedPaths = Array.isArray(input.requestedPaths) ? input.requestedPaths.map(String) : [];
  const findings = [];

  if (!task || task.length < 4 || /^(fix|do it|continue|same|これ|それ|お願い|やって)$/i.test(task)) {
    findings.push({
      code: "ambiguous-task",
      severity: "warn",
      message: "The task is too ambiguous to safely broaden into autonomous mutations."
    });
  }

  if (/\b(?:rewrite|redesign|architecture|architectural|migrate|migration|schema|database|entire repo|whole repo|all files)\b/i.test(task)) {
    findings.push({
      code: "design-risk",
      severity: "warn",
      message: "The request may carry architectural or broad design risk; keep the plan explicit before mutating."
    });
  }

  if (plannedMutations.length > 0 && requestedPaths.length > 0) {
    const outside = plannedMutations.filter(path => !requestedPaths.some(scope => pathInScope(path, scope)));
    if (outside.length) {
      findings.push({
        code: "scope-expansion",
        severity: "block",
        message: "Planned mutations extend outside the explicitly requested scope.",
        paths: outside.slice(0, 20)
      });
    }
  }

  if (input.repeatRisk === true) {
    findings.push({
      code: "repeat-risk",
      severity: policy.repeatRisk === "block" ? "block" : "warn",
      message: "Recent actions indicate a possible loop or doomed repeated attempt."
    });
  }

  const configured = {
    ambiguity: policy.ambiguity || "warn",
    design: policy.design || "warn",
    scope: policy.scope || "block"
  };

  for (const finding of findings) {
    if (finding.code === "ambiguous-task" && configured.ambiguity === "block") finding.severity = "block";
    if (finding.code === "design-risk" && configured.design === "block") finding.severity = "block";
    if (finding.code === "scope-expansion" && configured.scope === "warn") finding.severity = "warn";
  }

  return {
    decision: findings.some(item => item.severity === "block")
      ? "block"
      : findings.some(item => item.severity === "warn")
        ? "warn"
        : "allow",
    findings,
    policy: configured
  };
}

function normalizedScope(input = {}) {
  return {
    backend: String(input.backend || "").slice(0, 80),
    tool: String(input.tool || "").slice(0, 240),
    action: String(input.action || "").slice(0, 2000),
    projectId: String(input.projectId || "").slice(0, 200),
    sessionId: String(input.sessionId || "").slice(0, 240)
  };
}

function exactScopeMatch(rule, candidate) {
  for (const key of ["backend", "tool", "action", "projectId", "sessionId"]) {
    if (rule.scope[key] && rule.scope[key] !== candidate[key]) return false;
  }
  return true;
}

export class ScopedPermissionStore {
  constructor(file) {
    this.file = file;
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      const rules = Array.isArray(parsed?.rules) ? parsed.rules : [];
      return rules.filter(rule => !rule.expiresAt || rule.expiresAt > Date.now());
    } catch {
      return [];
    }
  }

  async write(rules) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, rules }, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
  }

  async list() {
    return this.read();
  }

  async grant(input = {}) {
    const scope = normalizedScope(input.scope);
    if (!scope.backend || !scope.tool || !scope.action) {
      throw new Error("Remembered approval requires backend, tool, and exact action scope.");
    }
    if (input.dangerous) {
      throw new Error("High-risk approvals cannot be remembered.");
    }

    const rules = await this.read();
    const ttlMs = clampInt(input.ttlMs, 24 * 60 * 60 * 1000, 60 * 1000, 30 * 24 * 60 * 60 * 1000);
    const duplicate = rules.find(rule => exactScopeMatch(rule, scope));
    if (duplicate) return duplicate;

    const rule = {
      id: randomUUID(),
      scope,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      note: String(input.note || "").slice(0, 500)
    };
    rules.unshift(rule);
    await this.write(rules.slice(0, 300));
    return rule;
  }

  async revoke(id) {
    const rules = await this.read();
    const next = rules.filter(rule => rule.id !== id);
    await this.write(next);
    return next.length !== rules.length;
  }

  async match(input = {}) {
    const candidate = normalizedScope(input.scope);
    const commandScan = input.command ? scanHighRiskCommand(input.command) : null;
    if (commandScan?.dangerous) {
      return { matched: false, rule: null, blockedByRisk: true, commandScan };
    }
    const rules = await this.read();
    const rule = rules.find(item => exactScopeMatch(item, candidate)) || null;
    return { matched: Boolean(rule), rule, blockedByRisk: false, commandScan };
  }
}

function messageKind(message) {
  return String(message?.kind || message?.type || message?.role || "").toLowerCase();
}

function isCriticalMessage(message) {
  const kind = messageKind(message);
  if (["system", "project-rule", "project_rule", "plan"].includes(kind)) return true;
  if (kind.includes("approval") && message?.resolved !== true) return true;
  if (kind.includes("tool-state") || kind.includes("tool_state")) return true;
  return message?.critical === true;
}

function deterministicSummary(messages) {
  const fragments = messages.slice(0, 24).map(message => {
    const kind = messageKind(message) || "message";
    const text = String(message?.text || message?.content || message?.summary || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    return text ? `[${kind}] ${text}` : `[${kind}] preserved event`;
  });
  return fragments.join("\n");
}

export async function compactAgentContext(messages, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const maxItems = clampInt(options.maxItems, 40, 8, 500);
  if (list.length <= maxItems) {
    return {
      compacted: false,
      event: null,
      messages: list,
      droppedCount: 0
    };
  }

  const criticalIndexes = new Set();
  list.forEach((message, index) => {
    if (isCriticalMessage(message)) criticalIndexes.add(index);
  });

  for (let index = Math.max(0, list.length - Math.floor(maxItems / 2)); index < list.length; index += 1) {
    criticalIndexes.add(index);
  }

  const keptIndexes = [...criticalIndexes].sort((a, b) => a - b);
  const dropped = list.filter((_, index) => !criticalIndexes.has(index));
  let summary = "";

  if (dropped.length) {
    if (typeof options.summarize === "function") {
      summary = String(await options.summarize(dropped, {
        model: options.summarizerModel || null
      }));
    } else {
      summary = deterministicSummary(dropped);
    }
  }

  const summaryMessage = {
    kind: "compaction-summary",
    visible: true,
    createdAt: Date.now(),
    text: summary,
    droppedCount: dropped.length,
    summarizerModel: options.summarizerModel || null
  };

  const kept = keptIndexes.map(index => list[index]);
  const result = summary ? [summaryMessage, ...kept] : kept;

  return {
    compacted: true,
    event: {
      type: "context.compacted",
      visible: true,
      at: summaryMessage.createdAt,
      droppedCount: dropped.length,
      keptCount: kept.length,
      summarizerModel: options.summarizerModel || null
    },
    // Critical state must never be silently discarded just to satisfy the soft item target.
    messages: result,
    droppedCount: dropped.length
  };
}

export function createSafetyService(options = {}) {
  const loopDetector = createLoopDetector({
    threshold: options.loopThreshold,
    windowSize: options.loopWindow
  });
  const permissions = new ScopedPermissionStore(options.permissionFile);

  return {
    loopDetector,
    permissions,
    scanCommand: scanHighRiskCommand,
    guard(input) {
      return evaluatePreExecutionGuard(input, options.guardPolicy);
    },
    compact(messages, compactOptions = {}) {
      return compactAgentContext(messages, {
        ...compactOptions,
        summarizerModel: compactOptions.summarizerModel || options.summarizerModel || null
      });
    }
  };
}
