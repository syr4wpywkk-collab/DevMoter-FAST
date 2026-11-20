import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ImageInput,
  IngestedImage,
  RunContext,
  RunnerOutcome,
  TaskSpec,
  WorkerRunner,
} from "../src/types.js";
import type { ImgIngestOptions } from "../src/media/img-ingest.js";
import { runSingleTask } from "../src/pool/pool.js";

// These tests never invoke the real `devin` binary: the worker is a
// FakeRunner, and PoolOptions.devinBin points at a nonexistent path so the
// model-catalog fetch fails soft and the pool falls back gracefully.

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "harness-pool-repo-"));
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  };
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Harness Test"]);
  writeFileSync(join(repo, "README.md"), "# fixture\n", "utf8");
  git(["add", "."]);
  git(["commit", "-qm", "init"]);
  return repo;
}

function makeHarnessRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-pool-root-"));
  cpSync(join(projectRoot, "config"), join(root, "config"), { recursive: true });
  return root;
}

class FakeRunner implements WorkerRunner {
  readonly name = "fake";
  readonly calls: Array<{
    task: TaskSpec;
    resumeSessionId?: string;
    promptFile?: string;
  }> = [];
  sessionId = "sess-fake-1";

  async run(
    task: TaskSpec,
    ctx: RunContext,
    opts?: { resumeSessionId?: string; promptFile?: string },
  ): Promise<RunnerOutcome> {
    this.calls.push({
      task,
      resumeSessionId: opts?.resumeSessionId,
      promptFile: opts?.promptFile,
    });
    // Minimal ATIF-v1.7-shaped export at the path the pool reads.
    writeFileSync(
      ctx.exportPath,
      JSON.stringify({
        session_id: this.sessionId,
        agent: { model_name: "SWE-2 Medium" },
        final_metrics: {
          total_prompt_tokens: 100,
          total_completion_tokens: 50,
          total_cached_tokens: 10,
        },
      }),
      "utf8",
    );
    return {
      exitCode: 0,
      timedOut: false,
      sessionId: this.sessionId,
      outputTail: "fake worker done",
    };
  }
}

function usageLines(harnessRoot: string): string[] {
  const file = join(harnessRoot, ".harness-state", "usage.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
}

test("pool: runSingleTask creates worktree, records usage, cleans up", async () => {
  const repo = makeRepo();
  const harnessRoot = makeHarnessRoot();
  const runner = new FakeRunner();
  const result = await runSingleTask(
    { id: "task-ok", prompt: "do a thing" },
    {
      repoRoot: repo,
      harnessRoot,
      runner,
      devinBin: "/nonexistent/devin-bin",
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.exitCode, 0);
  assert.equal(result.attempts, 1);
  assert.equal(result.sessionId, "sess-fake-1");
  assert.equal(result.branch, "harness/task-ok");
  assert.equal(result.gatekeeper?.ok, true);
  assert.equal(runner.calls.length, 1);
  // Usage was appended exactly once for the single attempt.
  const lines = usageLines(harnessRoot);
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as { taskId: string; sessionId: string };
  assert.equal(record.taskId, "task-ok");
  assert.equal(record.sessionId, "sess-fake-1");
  // Worktree removed after the run (keepWorktree not set).
  assert.equal(existsSync(result.worktree), false);
  // active.json no longer lists the task.
  const active = JSON.parse(
    readFileSync(join(harnessRoot, ".harness-state", "active.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(active["task-ok"], undefined);
});

test("pool: gatekeeper failure resumes the session until maxRetries", async () => {
  const repo = makeRepo();
  const harnessRoot = makeHarnessRoot();
  const runner = new FakeRunner();
  const result = await runSingleTask(
    {
      id: "task-gk",
      prompt: "break things",
      gatekeeper: { commands: [["node", "-e", "process.exit(1)"]] },
    },
    {
      repoRoot: repo,
      harnessRoot,
      runner,
      devinBin: "/nonexistent/devin-bin",
      maxRetries: 2,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.gatekeeper?.ok, false);
  // 1 initial run + 2 resume retries, then it stops.
  assert.equal(result.attempts, 3);
  assert.equal(runner.calls.length, 3);
  assert.equal(runner.calls[0].resumeSessionId, undefined);
  assert.equal(runner.calls[1].resumeSessionId, "sess-fake-1");
  assert.equal(runner.calls[2].resumeSessionId, "sess-fake-1");
  // The resume prompt is the generated feedback file.
  assert.ok(runner.calls[1].promptFile?.endsWith("feedback.md"));
  const feedback = readFileSync(runner.calls[1].promptFile as string, "utf8");
  assert.match(feedback, /Gatekeeper feedback/);
  // One usage record per attempt.
  assert.equal(usageLines(harnessRoot).length, 3);
});

test("pool: ingested images land in the prompt and attachments are removed", async () => {
  const repo = makeRepo();
  const harnessRoot = makeHarnessRoot();
  const runner = new FakeRunner();
  const fakeIngest = async (
    opts: ImgIngestOptions,
    images: ImageInput[],
  ): Promise<IngestedImage[]> => {
    mkdirSync(opts.outDir, { recursive: true });
    return images.map((img, i) => {
      const path = join(opts.outDir, `img_fake${i}.png`);
      writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return {
        ok: true as const,
        path,
        mime: "image/png",
        width: 640,
        height: 480,
        bytes: 4,
        sha256: "deadbeef",
        label: img.label,
      };
    });
  };
  const result = await runSingleTask(
    {
      id: "task-img",
      prompt: "look at this",
      images: [{ base64: "iVBORw0KGgo=", label: "ui-bug" }],
      keepWorktree: true,
    },
    {
      repoRoot: repo,
      harnessRoot,
      runner,
      devinBin: "/nonexistent/devin-bin",
      ingestFn: fakeIngest,
    },
  );
  assert.equal(result.error, undefined);
  // Prompt file carries the attachment section with path + dimensions + label.
  const prompt = readFileSync(join(result.runDir, "task.md"), "utf8");
  assert.match(prompt, /## 添付画像/);
  assert.match(prompt, /img_fake0\.png \(640x480\) — ui-bug/);
  // Worktree kept (keepWorktree) but attachments always removed.
  assert.equal(existsSync(result.worktree), true);
  assert.equal(
    existsSync(join(result.worktree, ".harness_attachments")),
    false,
  );
  // Manual cleanup of the kept worktree.
  execFileSync(
    "git",
    ["-C", repo, "worktree", "remove", "--force", result.worktree],
    { stdio: "pipe" },
  );
});
