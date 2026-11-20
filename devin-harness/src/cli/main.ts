#!/usr/bin/env node
// Devin harness CLI (SPEC §2/§3/§4 control plane).
//
// Commands:
//   harness run            run one task (--id/--prompt/...) or a batch (--tasks file.json)
//   harness perm show|set  inspect / update permission profiles and the default mode
//   harness model list|set inspect the model catalog / update role routing
//   harness usage          ATIF usage summary [--live] [--since YYYY-MM-DD] [--json]
//   harness attach-image   ingest an image into a worktree's .harness_attachments
//   harness doctor         devin preflight checks
//
// The harness root is resolved from this file's location (dist/src/cli ->
// package root); $HARNESS_ROOT overrides it (used by tests).

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  EffectivePolicy,
  Effort,
  Role,
  SpecPermissionMode,
  TaskSpec,
} from "../types.js";
import { findImgIngestBin, ingestImages } from "../media/img-ingest.js";
import {
  buildEffectivePolicy,
  loadBaseDeny,
  loadProfiles,
  type ProfileDef,
} from "../policy/policy.js";
import { fetchCatalog } from "../router/models.js";
import { JsonlUsageStore, summarizeUsage } from "../usage/store.js";
import { loadPricing } from "../usage/pricing.js";
import { runTasks } from "../pool/pool.js";
import { resolveDevinBin } from "../pool/runner.js";
import { devinPreflight } from "./preflight.js";

/* ------------------------------------------------------------ arg parsing */

export interface ParsedArgs {
  command: string | null;
  subcommand: string | null;
  flags: Record<string, string | string[] | boolean>;
  positionals: string[];
}

const BOOLEAN_FLAGS = new Set([
  "json",
  "refresh",
  "live",
  "yes-human-confirm",
  "keep-worktree",
  "help",
  "sandbox",
]);
const MULTI_FLAGS = new Set(["image", "allow", "deny", "ask"]);
const SUBCOMMANDS: Record<string, Set<string>> = {
  perm: new Set(["show", "set"]),
  model: new Set(["list", "set"]),
};

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | string[] | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--") && arg.length > 2) {
      const eq = arg.indexOf("=");
      const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      let value: string;
      if (eq >= 0) {
        value = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new Error(`flag --${name} requires a value`);
        }
        value = next;
        i += 1;
      }
      if (MULTI_FLAGS.has(name)) {
        const prev = flags[name];
        flags[name] = Array.isArray(prev) ? [...prev, value] : [value];
      } else {
        flags[name] = value;
      }
      continue;
    }
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    positionals.push(arg);
  }
  const command = positionals[0] ?? null;
  let subcommand: string | null = null;
  let rest = positionals.slice(1);
  if (command && SUBCOMMANDS[command]?.has(rest[0] ?? "")) {
    subcommand = rest[0];
    rest = rest.slice(1);
  }
  return { command, subcommand, flags, positionals: rest };
}

function flagStr(
  flags: ParsedArgs["flags"],
  name: string,
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}
function flagList(
  flags: ParsedArgs["flags"],
  name: string,
): string[] {
  const v = flags[name];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}
function flagBool(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true;
}

/* ------------------------------------------------------------ root / paths */

export function resolveHarnessRoot(): string {
  const fromEnv = process.env.HARNESS_ROOT;
  if (fromEnv) return resolve(fromEnv);
  // dist/src/cli/main.js -> package root is three levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..");
}

function configDirOf(root: string): string {
  return join(root, "config");
}
function stateDirOf(root: string): string {
  return join(root, ".harness-state");
}

/* ------------------------------------------------------------------- help */

const USAGE = `harness — Devin CLI autonomous parallel development harness

Usage:
  harness run --tasks <file.json> [--repo <dir>] [--concurrency <n>] [--max-retries <n>]
  harness run --id <task-id> (--prompt <text> | --prompt-file <file>)
              [--role <role>] [--model <id>] [--effort <level>] [--mode <mode>]
              [--profile <name>] [--image <file> ...] [--repo <dir>] [--keep-worktree]
  harness perm show [--profile <name>] [--mode <mode>] [--json]
  harness perm set --profile <name> [--mode <mode>] [--allow <rule> ...]
                   [--deny <rule> ...] [--ask <rule> ...] [--yes-human-confirm]
  harness perm set --mode <mode>            (updates defaultMode)
  harness model list [--json] [--refresh]
  harness model set --role <implement|plan|audit|default> --model <id> [--effort <level>]
  harness usage [--json] [--since <YYYY-MM-DD>] [--live]
  harness attach-image --worktree <path> (--file <img> | --base64-file <file>)
                       [--label <label>] [--max-dim <n>]
  harness doctor [--sandbox]
`;

/* --------------------------------------------------------------- run cmd */

interface ProfilesShape {
  defaultMode?: SpecPermissionMode;
  profiles?: Record<string, ProfileDef>;
  [key: string]: unknown;
}

async function cmdRun(root: string, args: ParsedArgs): Promise<number> {
  const f = args.flags;
  const repoRoot = resolve(flagStr(f, "repo") ?? process.cwd());
  let tasks: TaskSpec[];

  const tasksFile = flagStr(f, "tasks");
  if (tasksFile) {
    const parsed: unknown = JSON.parse(await readFile(tasksFile, "utf8"));
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(arr)) {
      throw new Error(`--tasks file must contain a TaskSpec array: ${tasksFile}`);
    }
    tasks = arr as TaskSpec[];
  } else {
    const id = flagStr(f, "id");
    if (!id) throw new Error("harness run: --id is required for a single task");
    const task: TaskSpec = { id };
    const prompt = flagStr(f, "prompt");
    const promptFile = flagStr(f, "prompt-file");
    if (prompt !== undefined) task.prompt = prompt;
    if (promptFile !== undefined) task.promptFile = resolve(promptFile);
    if (!task.prompt && !task.promptFile) {
      throw new Error("harness run: --prompt or --prompt-file is required");
    }
    const role = flagStr(f, "role");
    if (role) task.role = role as Role;
    const model = flagStr(f, "model");
    if (model) task.model = model;
    const effort = flagStr(f, "effort");
    if (effort) task.effort = effort as Effort;
    const mode = flagStr(f, "mode");
    if (mode) task.mode = mode as SpecPermissionMode;
    const profile = flagStr(f, "profile");
    if (profile) task.profile = profile;
    const images: TaskSpec["images"] = [];
    for (const imgPath of flagList(f, "image")) {
      const data = await readFile(imgPath);
      images.push({ base64: data.toString("base64"), label: basename(imgPath) });
    }
    if (images.length > 0) task.images = images;
    if (flagBool(f, "keep-worktree")) task.keepWorktree = true;
    tasks = [task];
  }

  // Preflight: sandbox is needed when any task resolves to autonomous mode.
  let profiles: Awaited<ReturnType<typeof loadProfiles>> | null = null;
  try {
    profiles = await loadProfiles(join(configDirOf(root), "profiles.json"));
  } catch {
    profiles = null;
  }
  const needSandbox = tasks.some((t) => {
    if (t.mode) return t.mode === "autonomous";
    if (t.profile && profiles?.profiles?.[t.profile]?.mode) {
      return profiles.profiles[t.profile].mode === "autonomous";
    }
    return false;
  });
  const devinBin = resolveDevinBin(flagStr(f, "devin-bin"));
  await devinPreflight({ devinBin, needSandbox });

  const concurrency = flagStr(f, "concurrency");
  const maxRetries = flagStr(f, "max-retries");
  const results = await runTasks(tasks, {
    repoRoot,
    harnessRoot: root,
    devinBin,
    concurrency: concurrency ? Number(concurrency) : undefined,
    maxRetries: maxRetries ? Number(maxRetries) : undefined,
  });

  let anyFailure = false;
  for (const r of results) {
    const failed =
      r.error !== undefined ||
      r.timedOut ||
      (r.exitCode !== null && r.exitCode !== 0) ||
      (r.gatekeeper !== null && !r.gatekeeper.ok);
    if (failed) anyFailure = true;
    const status = r.error
      ? `error: ${r.error}`
      : r.timedOut
        ? "timed out"
        : `exit=${r.exitCode ?? "?"}`;
    const gk =
      r.gatekeeper === null ? "gk=n/a" : r.gatekeeper.ok ? "gk=ok" : "gk=NG";
    console.log(
      `${failed ? "✗" : "✓"} ${r.taskId} ${status} attempts=${r.attempts} ${gk}` +
        `${r.sessionId ? ` session=${r.sessionId}` : ""} runDir=${r.runDir}`,
    );
  }
  return anyFailure ? 1 : 0;
}

/* -------------------------------------------------------------- perm cmds */

/** Compose the EffectivePolicy shown by `harness perm show`. */
export async function permShowPolicy(
  root: string,
  opts: { profile?: string; mode?: SpecPermissionMode },
): Promise<EffectivePolicy> {
  const configDir = configDirOf(root);
  const base = await loadBaseDeny(join(configDir, "base-deny.json"));
  const profiles = await loadProfiles(join(configDir, "profiles.json"));
  const profile = opts.profile ? profiles.profiles[opts.profile] : undefined;
  if (opts.profile && !profile) {
    throw new Error(`unknown profile: ${opts.profile}`);
  }
  const mode: SpecPermissionMode =
    opts.mode ?? profile?.mode ?? profiles.defaultMode;
  return buildEffectivePolicy({ mode, base, profile });
}

async function cmdPermShow(root: string, args: ParsedArgs): Promise<number> {
  const policy = await permShowPolicy(root, {
    profile: flagStr(args.flags, "profile"),
    mode: flagStr(args.flags, "mode") as SpecPermissionMode | undefined,
  });
  if (flagBool(args.flags, "json")) {
    console.log(JSON.stringify(policy, null, 2));
    return 0;
  }
  console.log(
    `mode: ${policy.specMode} (cli: ${policy.cliMode}${policy.sandbox ? ", sandbox" : ""})`,
  );
  for (const kind of ["allow", "deny", "ask"] as const) {
    console.log(`${kind}:`);
    for (const rule of policy.rules[kind]) console.log(`  ${rule}`);
    if (policy.rules[kind].length === 0) console.log("  (none)");
  }
  return 0;
}

async function cmdPermSet(root: string, args: ParsedArgs): Promise<number> {
  const f = args.flags;
  const file = join(configDirOf(root), "profiles.json");
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  const data = raw as ProfilesShape & {
    profiles: Record<string, ProfileDef>;
  };
  const profileName = flagStr(f, "profile");
  const mode = flagStr(f, "mode") as SpecPermissionMode | undefined;

  if (!profileName) {
    if (!mode) {
      throw new Error("harness perm set: --profile or --mode is required");
    }
    if (
      flagList(f, "allow").length ||
      flagList(f, "deny").length ||
      flagList(f, "ask").length
    ) {
      throw new Error(
        "harness perm set: --allow/--deny/--ask require --profile <name>",
      );
    }
    if (mode === "dangerous" && !flagBool(f, "yes-human-confirm")) {
      throw new Error(
        "refusing to set defaultMode=dangerous without --yes-human-confirm",
      );
    }
    data.defaultMode = mode;
    await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`defaultMode set to ${mode}`);
    return 0;
  }

  const existing: ProfileDef = data.profiles[profileName] ?? {
    mode: data.defaultMode ?? "smart",
    allow: [],
    deny: [],
    ask: [],
  };
  const next: ProfileDef = { ...existing };
  if (mode) next.mode = mode;
  const allow = flagList(f, "allow");
  const deny = flagList(f, "deny");
  const ask = flagList(f, "ask");
  if (allow.length > 0) next.allow = allow;
  if (deny.length > 0) next.deny = deny;
  if (ask.length > 0) next.ask = ask;
  if (next.mode === "dangerous" && !flagBool(f, "yes-human-confirm")) {
    throw new Error(
      `refusing to save profile "${profileName}" with mode=dangerous ` +
        "without --yes-human-confirm",
    );
  }
  data.profiles[profileName] = next;
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`profile "${profileName}" saved`);
  return 0;
}

/* ------------------------------------------------------------- model cmds */

async function cmdModelList(root: string, args: ParsedArgs): Promise<number> {
  const catalog = await fetchCatalog({
    devinBin: resolveDevinBin(flagStr(args.flags, "devin-bin")),
    stateDir: stateDirOf(root),
    refresh: flagBool(args.flags, "refresh"),
  });
  if (flagBool(args.flags, "json")) {
    console.log(JSON.stringify(catalog, null, 2));
    return 0;
  }
  for (const m of catalog) {
    const price = m.free
      ? "free"
      : m.price
        ? `$${m.price.inputPerM}/$${m.price.outputPerM} per 1M (in/out)`
        : "paid";
    console.log(`${m.id}\t${m.displayName}\t${price}`);
  }
  return 0;
}

const VALID_ROLES: Role[] = ["implement", "plan", "audit", "default"];
const VALID_EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];

async function cmdModelSet(root: string, args: ParsedArgs): Promise<number> {
  const f = args.flags;
  const role = flagStr(f, "role");
  const model = flagStr(f, "model");
  const effort = flagStr(f, "effort");
  if (!role || !VALID_ROLES.includes(role as Role)) {
    throw new Error(
      `harness model set: --role must be one of ${VALID_ROLES.join("|")}`,
    );
  }
  if (!model) throw new Error("harness model set: --model is required");
  if (effort && !VALID_EFFORTS.includes(effort as Effort)) {
    throw new Error(
      `harness model set: --effort must be one of ${VALID_EFFORTS.join("|")}`,
    );
  }
  const file = join(configDirOf(root), "routing.json");
  const data = JSON.parse(await readFile(file, "utf8")) as {
    roles: Record<string, { model: string; effort?: string }>;
    [key: string]: unknown;
  };
  const entry: { model: string; effort?: string } = { model };
  if (effort) entry.effort = effort;
  data.roles[role] = entry;
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`routing: ${role} -> ${model}${effort ? ` (effort ${effort})` : ""}`);
  return 0;
}

/* ------------------------------------------------------------- usage cmds */

export interface UsageSummary {
  records: number;
  totalTokens: number;
  freeTokens: number;
  paidTokens: number;
  freeRatio: number;
  estimatedCostUsd: number;
  byModel: Array<{
    model: string;
    runs: number;
    tokens: number;
    freeTokens: number;
    estimatedCostUsd: number;
  }>;
}

export async function computeUsageSummary(
  root: string,
  since?: string,
): Promise<UsageSummary> {
  const store = new JsonlUsageStore(join(stateDirOf(root), "usage.jsonl"));
  const pricing = await loadPricing(join(configDirOf(root), "pricing.json"));
  let records = await store.readAll();
  if (since) {
    const sinceMs = new Date(`${since}T00:00:00`).getTime();
    records = records.filter((r) => new Date(r.startedAt).getTime() >= sinceMs);
  }
  const roll = summarizeUsage(records, pricing);
  const totalTokens = roll.inputTokens + roll.outputTokens + roll.cacheReadTokens;
  return {
    records: roll.runs,
    totalTokens,
    freeTokens: roll.freeTokens,
    paidTokens: roll.paidTokens,
    freeRatio: roll.freeRatio,
    estimatedCostUsd: roll.estCostUsd,
    byModel: roll.byModel
      .map((m) => ({
        model: m.model,
        runs: m.runs,
        tokens: m.inputTokens + m.outputTokens + m.cacheReadTokens,
        freeTokens: m.free ? m.inputTokens + m.outputTokens : 0,
        estimatedCostUsd: m.estCostUsd,
      }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

async function cmdUsage(root: string, args: ParsedArgs): Promise<number> {
  const f = args.flags;
  const since = flagStr(f, "since");
  const summary = await computeUsageSummary(root, since);

  if (flagBool(f, "live")) {
    let active: Record<string, { startedAt?: string; phase?: string }> = {};
    try {
      active = JSON.parse(
        await readFile(join(stateDirOf(root), "active.json"), "utf8"),
      ) as typeof active;
    } catch {
      active = {};
    }
    const ids = Object.keys(active);
    console.log(`active workers: ${ids.length}`);
    for (const id of ids) {
      console.log(
        `  ${id} phase=${active[id].phase ?? "?"} since=${active[id].startedAt ?? "?"}`,
      );
    }
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todaySummary = await computeUsageSummary(root, todayStr);
    console.log(
      `today: ${todaySummary.records} run(s), ${todaySummary.totalTokens} tokens ` +
        `(free ${(todaySummary.freeRatio * 100).toFixed(1)}%), ` +
        `est. $${todaySummary.estimatedCostUsd.toFixed(4)}`,
    );
    return 0;
  }

  if (flagBool(f, "json")) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  console.log(
    `runs: ${summary.records}, tokens: ${summary.totalTokens} ` +
      `(free ${summary.freeTokens} / paid ${summary.paidTokens}, ` +
      `free ratio ${(summary.freeRatio * 100).toFixed(1)}%), ` +
      `est. cost $${summary.estimatedCostUsd.toFixed(4)}`,
  );
  console.log("model\truns\ttokens\tfree tokens\test. cost");
  for (const m of summary.byModel) {
    console.log(
      `${m.model}\t${m.runs}\t${m.tokens}\t${m.freeTokens}\t$${m.estimatedCostUsd.toFixed(4)}`,
    );
  }
  return 0;
}

/* ------------------------------------------------------- attach-image cmd */

async function cmdAttachImage(root: string, args: ParsedArgs): Promise<number> {
  const f = args.flags;
  const worktree = flagStr(f, "worktree");
  if (!worktree) throw new Error("harness attach-image: --worktree is required");
  const bin = findImgIngestBin(root);
  if (!existsSync(bin)) {
    throw new Error(
      `img-ingest binary not found at ${bin}. ` +
        "Build it first with scripts/build-img-ingest.sh.",
    );
  }
  let base64: string;
  let label = flagStr(f, "label");
  const file = flagStr(f, "file");
  const base64File = flagStr(f, "base64-file");
  if (file) {
    base64 = (await readFile(file)).toString("base64");
    label = label ?? basename(file);
  } else if (base64File) {
    base64 = (await readFile(base64File, "utf8")).trim();
    label = label ?? basename(base64File);
  } else {
    throw new Error("harness attach-image: --file or --base64-file is required");
  }
  const maxDim = flagStr(f, "max-dim");
  const results = await ingestImages(
    {
      binPath: bin,
      outDir: join(resolve(worktree), ".harness_attachments"),
      maxDim: maxDim ? Number(maxDim) : undefined,
    },
    [{ base64, label }],
  );
  console.log(JSON.stringify(results, null, 2));
  return 0;
}

/* ------------------------------------------------------------- doctor cmd */

async function cmdDoctor(root: string, args: ParsedArgs): Promise<number> {
  void root;
  const { version, doctorOutput } = await devinPreflight({
    devinBin: resolveDevinBin(flagStr(args.flags, "devin-bin")),
    needSandbox: flagBool(args.flags, "sandbox"),
  });
  console.log(`devin version: ${version}`);
  console.log(doctorOutput);
  return 0;
}

/* ------------------------------------------------------------------ main */

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 2;
  }
  if (!args.command || flagBool(args.flags, "help")) {
    console.log(USAGE);
    return 0;
  }
  const root = resolveHarnessRoot();
  try {
    switch (args.command) {
      case "run":
        return await cmdRun(root, args);
      case "perm":
        if (args.subcommand === "set") return await cmdPermSet(root, args);
        return await cmdPermShow(root, args);
      case "model":
        if (args.subcommand === "set") return await cmdModelSet(root, args);
        return await cmdModelList(root, args);
      case "usage":
        return await cmdUsage(root, args);
      case "attach-image":
        return await cmdAttachImage(root, args);
      case "doctor":
        return await cmdDoctor(root, args);
      default:
        console.error(`unknown command: ${args.command}`);
        console.error(USAGE);
        return 2;
    }
  } catch (err) {
    console.error(`harness: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
