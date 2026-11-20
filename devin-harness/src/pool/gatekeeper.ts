// Gatekeeper (SPEC §1/§4): post-run verification inside the task worktree.
//
// Runs the task's configured commands (default: `npm test` when the worktree
// has a package.json test script) plus an optional AI diff review, and turns
// every result into a GateCheck. `feedback` is a compact summary of the failed
// checks; the pool appends full check details when it writes feedback.md for
// the `--resume` retry.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCheck, GatekeeperResult, TaskSpec } from "../types.js";
import { runCommand } from "../util/exec.js";

export interface GatekeeperDeps {
  reviewFn?: (diff: string) => Promise<{ ok: boolean; feedback: string }>;
}

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const DETAIL_TAIL_CHARS = 2000;
const FEEDBACK_SNIPPET_CHARS = 300;

function tail(text: string, max: number): string {
  return text.length > max ? text.slice(-max) : text;
}

function defaultCommands(worktree: string): string[][] {
  try {
    const pkgPath = join(worktree, "package.json");
    if (!existsSync(pkgPath)) return [];
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    const scripts = (pkg as { scripts?: Record<string, unknown> })?.scripts;
    if (scripts && typeof scripts.test === "string" && scripts.test) {
      return [["npm", "test"]];
    }
  } catch {
    // Unreadable package.json — no default checks.
  }
  return [];
}

export async function runGatekeeper(opts: {
  worktree: string;
  task: TaskSpec;
  deps?: GatekeeperDeps;
}): Promise<GatekeeperResult> {
  const { worktree, task } = opts;
  const commands = task.gatekeeper?.commands ?? defaultCommands(worktree);
  const checks: GateCheck[] = [];

  for (const argv of commands) {
    if (argv.length === 0) continue;
    const name = argv.join(" ");
    const res = await runCommand(argv[0], argv.slice(1), {
      cwd: worktree,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    const combined = [res.stdout, res.stderr].filter(Boolean).join("\n");
    const ok = res.code === 0 && !res.timedOut;
    checks.push({
      name,
      ok,
      detail: tail(
        res.timedOut
          ? `timed out after ${COMMAND_TIMEOUT_MS}ms\n${combined}`
          : combined,
        DETAIL_TAIL_CHARS,
      ),
    });
  }

  if (task.gatekeeper?.aiReview && opts.deps?.reviewFn) {
    const reviewFn = opts.deps.reviewFn;
    const diffRes = await runCommand("git", ["-C", worktree, "diff", "HEAD"]);
    if (diffRes.code !== 0) {
      checks.push({
        name: "ai-review",
        ok: false,
        detail: tail(
          `git diff failed: ${diffRes.stderr || diffRes.stdout}`,
          DETAIL_TAIL_CHARS,
        ),
      });
    } else {
      try {
        const review = await reviewFn(diffRes.stdout);
        checks.push({
          name: "ai-review",
          ok: review.ok,
          detail: tail(review.feedback, DETAIL_TAIL_CHARS),
        });
      } catch (err) {
        checks.push({
          name: "ai-review",
          ok: false,
          detail: `review failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const feedback =
    failed.length === 0
      ? ""
      : failed
          .map((c) => {
            const snippet = c.detail.replace(/\s+/g, " ").trim();
            return `- ${c.name}: FAILED${snippet ? ` — ${snippet.slice(0, FEEDBACK_SNIPPET_CHARS)}` : ""}`;
          })
          .join("\n");

  return { ok: failed.length === 0, checks, feedback };
}
