// Worker Pool (SPEC §1/§4): run TaskSpecs as isolated Devin CLI workers.
//
// Per task: validate id → allocate runDir → create git worktree → ingest
// image attachments into <worktree>/.harness_attachments → build the prompt
// file → compose the effective permission policy → generate the per-worker
// Devin config → resolve the model → budget guard → register in active.json →
// run the worker → collect ATIF usage → gatekeeper → resume-retry loop on
// gatekeeper failure → cleanup (attachments always, worktree unless kept).
//
// Logs and results only ever contain paths and counts — never prompt text or
// Base64 image data. A failing task produces a WorkerResult with `error` set;
// it never rejects the whole batch.

import { appendFileSync, existsSync } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  EffectivePolicy,
  ModelInfo,
  ResolvedModel,
  RunnerOutcome,
  SpecPermissionMode,
  TaskSpec,
  UsageRecord,
  WorkerResult,
  WorkerRunner,
} from "../types.js";
import { findImgIngestBin, ingestImages } from "../media/img-ingest.js";
import {
  buildEffectivePolicy,
  loadBaseDeny,
  loadProfiles,
  type ProfileDef,
} from "../policy/policy.js";
import { generateDevinConfig } from "../policy/config-gen.js";
import { fetchCatalog } from "../router/models.js";
import { loadRouting, resolveModel } from "../router/router.js";
import { parseAtifExport } from "../usage/atif.js";
import { JsonlUsageStore } from "../usage/store.js";
import { isFreeTier, loadPricing, type PricingTable } from "../usage/pricing.js";
import {
  evaluateBudget,
  loadBudget,
  type BudgetConfig,
} from "../usage/budget.js";
import { runGatekeeper, type GatekeeperDeps } from "./gatekeeper.js";
import { DevinPrintRunner, resolveDevinBin } from "./runner.js";
import {
  createTaskWorktree,
  removeTaskWorktree,
  sanitizeTaskId,
} from "./worktree.js";

export interface PoolOptions {
  repoRoot: string;
  harnessRoot: string;
  concurrency?: number;
  maxRetries?: number;
  devinBin?: string;
  runner?: WorkerRunner;
  ingestFn?: typeof ingestImages;
  now?: () => Date;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DOWNGRADE_MODEL = "swe-2-medium";

/* ---------------------------------------------------------------- helpers */

class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];
  constructor(n: number) {
    this.permits = Math.max(1, n);
  }
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits += 1;
  }
}

function stamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

type ProfilesFile = Awaited<ReturnType<typeof loadProfiles>>;

/* active.json bookkeeping (serialized in-process to avoid lost updates) */
let activeChain: Promise<void> = Promise.resolve();
function withActiveLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = activeChain.then(fn, fn);
  activeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function updateActive(
  stateDir: string,
  taskId: string,
  entry: { startedAt: string; phase: string } | null,
): Promise<void> {
  const file = join(stateDir, "active.json");
  await withActiveLock(async () => {
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (parsed && typeof parsed === "object") {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // missing/corrupt — start fresh
    }
    if (entry === null) delete data[taskId];
    else data[taskId] = { taskId, ...entry };
    await mkdir(stateDir, { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  });
}

/* ------------------------------------------------------------ single task */

interface SharedCatalog {
  catalog: ModelInfo[] | null;
  error: string | null;
}

async function runSingleTaskInternal(
  task: TaskSpec,
  opts: PoolOptions,
  shared: SharedCatalog,
  gatekeeperDeps?: GatekeeperDeps,
): Promise<WorkerResult> {
  const now = opts.now ?? (() => new Date());
  const harnessRoot = opts.harnessRoot;
  const configDir = join(harnessRoot, "config");
  const stateDir = join(harnessRoot, ".harness-state");
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const runner: WorkerRunner =
    opts.runner ?? new DevinPrintRunner({ devinBin: opts.devinBin });
  const ingest = opts.ingestFn ?? ingestImages;

  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  let runDir = join(stateDir, "runs", `${task.id}-${stamp(startedAtDate)}`);
  let worktree = "";
  let branch = "";
  let attempts = 0;

  const baseResult: WorkerResult = {
    taskId: task.id,
    sessionId: null,
    exitCode: null,
    timedOut: false,
    attempts: 0,
    usage: null,
    gatekeeper: null,
    worktree: "",
    branch: "",
    runDir,
  };

  let log: (msg: string) => void = () => undefined;
  let attachmentsDir: string | null = null;
  let worktreeCreated = false;

  try {
    sanitizeTaskId(task.id);

    // Unique runDir even for repeated runs within the same second.
    for (let suffix = 2; existsSync(runDir); suffix += 1) {
      runDir = join(stateDir, "runs", `${task.id}-${stamp(startedAtDate)}-${suffix}`);
    }
    baseResult.runDir = runDir;
    await mkdir(runDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    const logFile = join(runDir, "harness.log");
    log = (msg: string): void => {
      try {
        appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
      } catch {
        // logging must never break a run
      }
    };
    log(`task ${task.id} starting (runner=${runner.name})`);

    await updateActive(stateDir, task.id, { startedAt, phase: "setup" });

    /* worktree isolation */
    const wt = await createTaskWorktree({ repoRoot: opts.repoRoot, taskId: task.id });
    worktree = wt.path;
    branch = wt.branch;
    worktreeCreated = true;
    baseResult.worktree = worktree;
    baseResult.branch = branch;
    log(`worktree created at ${worktree} (branch ${branch})`);

    /* image attachments via img-ingest */
    let ingested: Awaited<ReturnType<typeof ingestImages>> = [];
    if (task.images && task.images.length > 0) {
      attachmentsDir = join(worktree, ".harness_attachments");
      ingested = await ingest(
        { binPath: findImgIngestBin(harnessRoot), outDir: attachmentsDir },
        task.images,
      );
      log(`ingested ${ingested.length} image attachment(s) into ${attachmentsDir}`);
    }

    /* prompt file (copy or inline) + attachment section */
    const promptPath = join(runDir, "task.md");
    if (task.promptFile) {
      await copyFile(task.promptFile, promptPath);
    } else if (task.prompt !== undefined) {
      await writeFile(promptPath, task.prompt, "utf8");
    } else {
      throw new Error(`task ${task.id} has neither prompt nor promptFile`);
    }
    if (ingested.length > 0) {
      const lines = ingested.map(
        (img) =>
          `- ${img.path} (${img.width}x${img.height})${img.label ? ` — ${img.label}` : ""}`,
      );
      await appendFile(
        promptPath,
        `\n\n## 添付画像\n\n${lines.join("\n")}\n`,
        "utf8",
      );
    }

    /* policy composition (base-deny floor + profile + task extras) */
    const base = await loadBaseDeny(join(configDir, "base-deny.json"));
    const profiles: ProfilesFile = await loadProfiles(
      join(configDir, "profiles.json"),
    );
    const profile: ProfileDef | undefined = task.profile
      ? profiles.profiles[task.profile]
      : undefined;
    if (task.profile && !profile) {
      throw new Error(`unknown profile: ${task.profile}`);
    }
    const mode: SpecPermissionMode =
      task.mode ?? profile?.mode ?? profiles.defaultMode;
    const taskRules = {
      allow: [
        ...(task.extraAllow ?? []),
        ...(attachmentsDir !== null
          ? [`Read(${attachmentsDir}/**)`]
          : []),
      ],
      deny: [...(task.extraDeny ?? [])],
      ask: [...(task.extraAsk ?? [])],
    };
    const policy: EffectivePolicy = buildEffectivePolicy({
      mode,
      base,
      profile,
      task: taskRules,
      worktree,
    });

    /* per-worker devin config */
    const configPath = await generateDevinConfig({
      policy,
      destPath: join(runDir, "devin-config.json"),
    });

    /* pricing / budget context (best effort — missing files disable guards) */
    let pricing: PricingTable | null = null;
    try {
      pricing = await loadPricing(join(configDir, "pricing.json"));
    } catch {
      pricing = null;
    }

    /* model resolution (catalog fetched once per batch by runTasks) */
    const routing = await loadRouting(join(configDir, "routing.json"));
    let resolved: ResolvedModel;
    if (shared.catalog) {
      resolved = resolveModel(shared.catalog, routing, {
        role: task.role,
        model: task.model,
        effort: task.effort,
      });
    } else {
      const fallbackId = task.model ?? DOWNGRADE_MODEL;
      resolved = {
        modelId: fallbackId,
        requestedModel: fallbackId,
        effort: task.effort ?? null,
        warnings: [
          `model catalog unavailable (${shared.error ?? "unknown error"}); using ${fallbackId}`,
        ],
        free: pricing ? isFreeTier(pricing, fallbackId) : fallbackId.startsWith("swe-2"),
      };
      log(`warning: ${resolved.warnings[0]}`);
    }

    /* usage store + budget guard */
    const store = new JsonlUsageStore(join(stateDir, "usage.jsonl"));
    let budget: BudgetConfig | null = null;
    try {
      budget = await loadBudget(join(configDir, "budget.json"));
    } catch {
      budget = null;
    }
    if (budget && budget.enabled && pricing) {
      const dayStart = new Date(now());
      dayStart.setHours(0, 0, 0, 0);
      const all = await store.readAll();
      const todayRecords = all.filter(
        (r) => new Date(r.startedAt).getTime() >= dayStart.getTime(),
      );
      const decision = evaluateBudget(todayRecords, budget, pricing);
      if (decision.exceeded) {
        const action = decision.action ?? budget.onExceed;
        if (action === "stop") {
          throw new Error(`budget exceeded: ${decision.reason}`);
        }
        const warning =
          `budget exceeded (${decision.reason}); downgrading model ` +
          `${resolved.modelId} -> ${DOWNGRADE_MODEL}`;
        log(`warning: ${warning}`);
        console.warn(`[harness] task ${task.id}: ${warning}`);
        resolved = {
          ...resolved,
          modelId: DOWNGRADE_MODEL,
          free: isFreeTier(pricing, DOWNGRADE_MODEL),
          warnings: [...resolved.warnings, warning],
        };
      }
    }

    /* run context */
    const exportPath = join(runDir, `atif-${task.id}.json`);
    const ctx = {
      repoRoot: opts.repoRoot,
      worktree,
      branch,
      runDir,
      configPath,
      policy,
      model: resolved,
      promptFile: promptPath,
      exportPath,
      images: ingested,
      log,
    };

    await updateActive(stateDir, task.id, { startedAt, phase: "running" });

    /* attempt loop: run → ATIF → gatekeeper → resume on failure */
    let outcome: RunnerOutcome = await runner.run(task, ctx);
    attempts = 1;
    let usage: UsageRecord | null = null;
    let gatekeeper: WorkerResult["gatekeeper"] = null;

    for (;;) {
      usage = await collectUsage({
        store,
        exportPath,
        task,
        resolved,
        outcome,
        startedAt,
        runDir,
        pricing,
      });
      baseResult.sessionId = outcome.sessionId ?? usage?.sessionId ?? null;
      baseResult.exitCode = outcome.exitCode;
      baseResult.timedOut = outcome.timedOut;

      await updateActive(stateDir, task.id, { startedAt, phase: "gatekeeper" });
      gatekeeper = await runGatekeeper({ worktree, task, deps: gatekeeperDeps });
      baseResult.gatekeeper = gatekeeper;
      log(
        `gatekeeper ${gatekeeper.ok ? "passed" : "FAILED"} ` +
          `(${gatekeeper.checks.length} check(s), attempt ${attempts})`,
      );

      const resumeId: string | null = outcome.sessionId;
      if (gatekeeper.ok || resumeId === null || attempts > maxRetries) break;

      const feedbackPath = join(runDir, "feedback.md");
      const failedDetails = gatekeeper.checks
        .filter((c) => !c.ok)
        .map((c) => `### ${c.name}\n\n${c.detail}`)
        .join("\n\n");
      await writeFile(
        feedbackPath,
        `# Gatekeeper feedback\n\n${gatekeeper.feedback}\n\n## 詳細\n\n${failedDetails}\n`,
        "utf8",
      );
      log(`gatekeeper failed; resuming session for attempt ${attempts + 1}`);
      await updateActive(stateDir, task.id, { startedAt, phase: "running" });
      outcome = await runner.run(task, ctx, {
        resumeSessionId: resumeId,
        promptFile: feedbackPath,
      });
      attempts += 1;
    }

    baseResult.attempts = attempts;
    baseResult.usage = usage;
    log(`task ${task.id} finished (attempts=${attempts})`);
    return baseResult;
  } catch (err) {
    baseResult.attempts = attempts;
    baseResult.error = err instanceof Error ? err.message : String(err);
    log(`task ${task.id} error: ${baseResult.error}`);
    return baseResult;
  } finally {
    try {
      await updateActive(stateDir, task.id, null);
    } catch {
      // best effort
    }
    if (attachmentsDir) {
      await rm(attachmentsDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (worktreeCreated && !task.keepWorktree) {
      await removeTaskWorktree({ repoRoot: opts.repoRoot, path: worktree, branch });
    }
  }
}

/** Parse the ATIF export (defensively) and append the record to the store. */
async function collectUsage(args: {
  store: JsonlUsageStore;
  exportPath: string;
  task: TaskSpec;
  resolved: ResolvedModel;
  outcome: RunnerOutcome;
  startedAt: string;
  runDir: string;
  pricing: PricingTable | null;
}): Promise<UsageRecord | null> {
  const { store, exportPath, task, resolved, outcome } = args;
  let text: string | null = null;
  try {
    if (existsSync(exportPath)) {
      text = await readFile(exportPath, "utf8");
    }
  } catch {
    text = null;
  }
  // parseAtifExport never throws: missing/corrupt exports yield a record
  // with null metrics, so every attempt is accounted for exactly once.
  const record = parseAtifExport(text, {
    taskId: task.id,
    model: resolved.modelId,
    effort: resolved.effort,
    startedAt: args.startedAt,
    durationMs: null,
    exitStatus: outcome.exitCode,
    timedOut: outcome.timedOut,
    runDir: args.runDir,
    isFreeTierModel: args.pricing
      ? isFreeTier(args.pricing, resolved.modelId)
      : resolved.free,
  });
  try {
    await store.append(record);
  } catch {
    // Usage persistence is best effort; never fail a completed run over it.
  }
  return record;
}

/* -------------------------------------------------------------- batch API */

export async function runSingleTask(
  task: TaskSpec,
  opts: PoolOptions,
): Promise<WorkerResult> {
  const shared: SharedCatalog = { catalog: null, error: null };
  try {
    shared.catalog = await fetchCatalog({
      devinBin: resolveDevinBin(opts.devinBin),
      stateDir: join(opts.harnessRoot, ".harness-state"),
    });
  } catch (err) {
    shared.error = err instanceof Error ? err.message : String(err);
  }
  return runSingleTaskInternal(task, opts, shared);
}

export async function runTasks(
  tasks: TaskSpec[],
  opts: PoolOptions,
): Promise<WorkerResult[]> {
  const shared: SharedCatalog = { catalog: null, error: null };
  if (tasks.length > 0) {
    try {
      shared.catalog = await fetchCatalog({
        devinBin: resolveDevinBin(opts.devinBin),
        stateDir: join(opts.harnessRoot, ".harness-state"),
      });
    } catch (err) {
      shared.error = err instanceof Error ? err.message : String(err);
    }
  }
  const semaphore = new Semaphore(opts.concurrency ?? DEFAULT_CONCURRENCY);
  return Promise.all(
    tasks.map(async (task) => {
      await semaphore.acquire();
      try {
        return await runSingleTaskInternal(task, opts, shared);
      } finally {
        semaphore.release();
      }
    }),
  );
}

/** Attachment directory name inside a worktree (used by the CLI too). */
export const ATTACHMENTS_DIRNAME = ".harness_attachments";
