// Shared contracts for the Devin CLI orchestrator harness.
// All modules (policy / router / usage / pool / cli) build against these types.
// Imports must use NodeNext style with explicit ".js" extensions.

/** Permission modes as named by the harness spec (SPEC §2). */
export type SpecPermissionMode =
  | "normal"
  | "accept-edits"
  | "smart"
  | "autonomous"
  | "dangerous";

/** Permission modes that actually exist in Devin CLI (`devin --help`, v3000.14.30821). */
export type CliPermissionMode = "auto" | "accept-edits" | "smart" | "dangerous";

export interface PolicyRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface ResolvedMode {
  specMode: SpecPermissionMode;
  cliMode: CliPermissionMode;
  /** True when the spec mode maps to `--sandbox` (only "autonomous"). */
  sandbox: boolean;
}

export interface EffectivePolicy extends ResolvedMode {
  rules: PolicyRules;
}

export interface ModelPrice {
  inputPerM: number;
  cachedPerM: number;
  outputPerM: number;
}

export interface ModelInfo {
  /** Full model UID passed to `devin --model`, e.g. "swe-2-medium". */
  id: string;
  displayName: string;
  /** Family display name, e.g. "SWE-2". */
  family: string;
  /** Family id from the `devin models` header, e.g. "swe-2". */
  familyId: string;
  /** e.g. "262K context", or null when the catalog line has none. */
  contextLabel: string | null;
  free: boolean;
  price: ModelPrice | null;
}

export type Effort = "low" | "medium" | "high" | "xhigh";
export type Role = "implement" | "plan" | "audit" | "default";

export interface ResolvedModel {
  /** Model UID to pass to `devin --model`. */
  modelId: string;
  /** What the user/routing originally asked for. */
  requestedModel: string;
  effort: Effort | null;
  warnings: string[];
  free: boolean;
}

export interface UsageRecord {
  taskId: string;
  sessionId: string | null;
  /** Model UID the worker was launched with. */
  model: string;
  /** Display name reported by ATIF (`agent.model_name`), when available. */
  modelDisplayName: string | null;
  effort: Effort | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  /** ATIF-v1.7 does not expose cache-write tokens; stays null. */
  cacheWriteTokens: number | null;
  toolCalls: number | null;
  durationMs: number | null;
  exitStatus: number | null;
  timedOut: boolean;
  isFreeTierModel: boolean;
  /** ISO-8601 start time of the worker run. */
  startedAt: string;
  runDir: string;
}

export interface ImageInput {
  base64: string;
  label?: string;
  id?: string;
}

export interface IngestedImage {
  ok: true;
  path: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  label?: string;
}

export interface TaskSpec {
  id: string;
  prompt?: string;
  promptFile?: string;
  role?: Role;
  model?: string;
  effort?: Effort;
  mode?: SpecPermissionMode;
  profile?: string;
  extraAllow?: string[];
  extraDeny?: string[];
  extraAsk?: string[];
  images?: ImageInput[];
  timeoutMs?: number;
  gatekeeper?: {
    /** argv arrays executed with shell:false inside the worktree. */
    commands?: string[][];
    /** Run an AI diff review (role "audit") as an extra gatekeeper check. */
    aiReview?: boolean;
  };
  keepWorktree?: boolean;
}

export interface GateCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GatekeeperResult {
  ok: boolean;
  checks: GateCheck[];
  /** Human-readable feedback fed back to the worker on `--resume`. */
  feedback: string;
}

export interface WorkerResult {
  taskId: string;
  sessionId: string | null;
  exitCode: number | null;
  timedOut: boolean;
  /** 1 = first run, +1 per gatekeeper resume retry. */
  attempts: number;
  usage: UsageRecord | null;
  gatekeeper: GatekeeperResult | null;
  worktree: string;
  branch: string;
  runDir: string;
  error?: string;
}

export interface RunContext {
  repoRoot: string;
  worktree: string;
  branch: string;
  runDir: string;
  /** Generated per-worker Devin config file passed via `--config`. */
  configPath: string;
  policy: EffectivePolicy;
  model: ResolvedModel;
  promptFile: string;
  exportPath: string;
  images: IngestedImage[];
  log: (msg: string) => void;
}

export interface RunnerOutcome {
  exitCode: number | null;
  timedOut: boolean;
  sessionId: string | null;
  /** Tail of the worker stdout (capped), used by the AI gatekeeper review. */
  outputTail: string;
}

/**
 * Worker execution backend abstraction (SPEC §1).
 * The default implementation shells out to `devin -p` (print mode);
 * `devin acp` (ACP over stdio) is provided as a stub adapter.
 */
export interface WorkerRunner {
  name: string;
  run(
    task: TaskSpec,
    ctx: RunContext,
    opts?: { resumeSessionId?: string; promptFile?: string },
  ): Promise<RunnerOutcome>;
}
