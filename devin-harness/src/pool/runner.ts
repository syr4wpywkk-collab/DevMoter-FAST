// Default worker backend: `devin -p` (print mode) as a detached child process.
//
// The child runs with shell:false inside the task worktree. Combined
// stdout/stderr is appended to <runDir>/devin-output.log while only the last
// 8000 characters are kept in memory. On timeout the whole process group is
// SIGTERMed, then SIGKILLed 5s later. After exit, the ATIF export file (when
// Devin wrote one) is read defensively to recover the session id for
// gatekeeper `--resume` retries.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  RunContext,
  RunnerOutcome,
  TaskSpec,
  WorkerRunner,
} from "../types.js";

export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const OUTPUT_TAIL_CHARS = 8000;
const KILL_GRACE_MS = 5000;

/** Resolve the devin binary: explicit > $DEVIN_BIN > ~/.local/bin/devin > PATH. */
export function resolveDevinBin(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.DEVIN_BIN;
  if (fromEnv) return fromEnv;
  const local = join(homedir(), ".local", "bin", "devin");
  if (existsSync(local)) return local;
  return "devin";
}

/**
 * Build the exact `devin -p` argument vector for a run. Pure function.
 * The prompt itself is never part of argv (it travels via --prompt-file).
 */
export function buildDevinArgs(
  task: TaskSpec,
  ctx: RunContext,
  opts?: { resumeSessionId?: string; promptFile?: string },
): string[] {
  void task; // Task content reaches devin via the prompt file, not argv.
  const args: string[] = [
    "-p",
    "--prompt-file",
    opts?.promptFile ?? ctx.promptFile,
    "--respect-workspace-trust",
    "false",
    "--config",
    ctx.configPath,
    "--export",
    ctx.exportPath,
    "--model",
    ctx.model.modelId,
    "--permission-mode",
    ctx.policy.cliMode,
  ];
  if (ctx.policy.sandbox) args.push("--sandbox");
  if (opts?.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

/** Defensively extract session_id from an ATIF export file, if present. */
export function readExportSessionId(exportPath: string): string | null {
  try {
    if (!existsSync(exportPath)) return null;
    const parsed: unknown = JSON.parse(readFileSync(exportPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.session_id === "string" && rec.session_id) {
        return rec.session_id;
      }
      if (typeof rec.sessionId === "string" && rec.sessionId) {
        return rec.sessionId;
      }
    }
  } catch {
    // Corrupt/partial export — the session id is a nice-to-have only.
  }
  return null;
}

export class DevinPrintRunner implements WorkerRunner {
  readonly name = "print";
  private readonly devinBin: string;

  constructor(opts?: { devinBin?: string }) {
    this.devinBin = resolveDevinBin(opts?.devinBin);
  }

  run(
    task: TaskSpec,
    ctx: RunContext,
    opts?: { resumeSessionId?: string; promptFile?: string },
  ): Promise<RunnerOutcome> {
    const bin = this.devinBin;
    const args = buildDevinArgs(task, ctx, opts);
    const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    ctx.log(
      `launching devin (model=${ctx.model.modelId}, mode=${ctx.policy.cliMode}` +
        `${ctx.policy.sandbox ? ", sandbox" : ""}` +
        `${opts?.resumeSessionId ? ", resume" : ""})`,
    );

    return new Promise<RunnerOutcome>((resolve, reject) => {
      const child = spawn(bin, args, {
        shell: false,
        detached: true,
        cwd: ctx.worktree,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const logStream = createWriteStream(join(ctx.runDir, "devin-output.log"), {
        flags: "a",
      });
      let tail = "";
      let timedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;

      const onData = (chunk: Buffer): void => {
        logStream.write(chunk);
        tail = (tail + chunk.toString("utf8")).slice(-OUTPUT_TAIL_CHARS);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      const killGroup = (signal: NodeJS.Signals): void => {
        try {
          if (child.pid !== undefined) {
            process.kill(-child.pid, signal);
            return;
          }
        } catch {
          // Process group already gone; fall back to the child itself.
        }
        try {
          child.kill(signal);
        } catch {
          // already dead
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        ctx.log(`devin timed out after ${timeoutMs}ms; sending SIGTERM`);
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
        killTimer.unref();
      }, timeoutMs);
      timer.unref();

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        logStream.end();
        reject(new Error(`failed to launch devin (${bin}): ${err.message}`));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        logStream.end();
        const sessionId = readExportSessionId(ctx.exportPath);
        ctx.log(
          `devin exited (code=${code ?? "null"}${timedOut ? ", timed out" : ""}` +
            `${sessionId ? `, session=${sessionId}` : ""})`,
        );
        resolve({ exitCode: code, timedOut, sessionId, outputTail: tail });
      });
    });
  }
}
