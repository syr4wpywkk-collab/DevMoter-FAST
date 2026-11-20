// Git worktree isolation for worker tasks (SPEC §1).
// Every git invocation goes through util/exec with shell:false.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../util/exec.js";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate a task id for safe use in branch names and directory names.
 * Throws on anything outside /^[A-Za-z0-9][A-Za-z0-9._-]*$/ (no path
 * separators, no leading dot/dash, no git-ref-hostile characters).
 */
export function sanitizeTaskId(id: string): string {
  if (!TASK_ID_PATTERN.test(id)) {
    throw new Error(
      `invalid task id ${JSON.stringify(id)}: must match ${TASK_ID_PATTERN.source}`,
    );
  }
  return id;
}

export function worktreePathFor(repoRoot: string, taskId: string): string {
  return join(repoRoot, ".devin-harness-worktrees", taskId);
}

export function branchFor(taskId: string): string {
  return `harness/${taskId}`;
}

/**
 * Create an isolated worktree for a task on a fresh branch `harness/<taskId>`.
 * Throws if the worktree path already exists or git fails.
 */
export async function createTaskWorktree(opts: {
  repoRoot: string;
  taskId: string;
  baseRef?: string;
}): Promise<{ path: string; branch: string }> {
  const taskId = sanitizeTaskId(opts.taskId);
  const path = worktreePathFor(opts.repoRoot, taskId);
  const branch = branchFor(taskId);
  if (existsSync(path)) {
    throw new Error(`worktree already exists: ${path}`);
  }
  const args = ["-C", opts.repoRoot, "worktree", "add", "-b", branch, path];
  if (opts.baseRef) args.push(opts.baseRef);
  const res = await runCommand("git", args);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().slice(-500);
    throw new Error(`git worktree add failed for task ${taskId}: ${detail}`);
  }
  return { path, branch };
}

/**
 * Remove a task worktree and its branch. Best-effort: failures are swallowed
 * (cleanup must never mask the worker's real result).
 */
export async function removeTaskWorktree(opts: {
  repoRoot: string;
  path: string;
  branch: string;
}): Promise<void> {
  try {
    await runCommand("git", [
      "-C",
      opts.repoRoot,
      "worktree",
      "remove",
      "--force",
      opts.path,
    ]);
  } catch {
    // best effort
  }
  try {
    await runCommand("git", ["-C", opts.repoRoot, "branch", "-D", opts.branch]);
  } catch {
    // best effort
  }
}
