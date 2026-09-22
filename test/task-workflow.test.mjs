import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createTaskWorkflow, workflowInternals } from "../server/task-workflow.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync("git", args, { cwd });
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "devmoter-workflow-"));
  const project = join(home, "project");
  await mkdir(project);
  await git(project, ["init", "-b", "main"]);
  await git(project, ["config", "user.email", "test@example.invalid"]);
  await git(project, ["config", "user.name", "DevMoter Test"]);
  await writeFile(join(project, "sample.txt"), "one\ntwo\nthree\nfour\n");
  await git(project, ["add", "."]);
  await git(project, ["commit", "-m", "fixture"]);
  const projectRecord = { id: "p1", name: "fixture", path: project, github: "example/repo" };
  const workflow = createTaskWorkflow({
    homeDir: home,
    getProjectById: async id => {
      if (id !== projectRecord.id) throw new Error("Project not found");
      return projectRecord;
    }
  });
  return {
    home,
    project,
    workflow,
    async cleanup() { await rm(home, { recursive: true, force: true }); }
  };
}

test("hunk selection is deterministic and independently applicable", () => {
  const before = "a\nb\nc\nd\ne\n";
  const after = "a\nB\nc\nd\nE\n";
  const hunks = workflowInternals.lcsHunks(before, after);
  assert.equal(hunks.length, 2);
  assert.equal(workflowInternals.applyHunks(before, hunks, [hunks[0].id]), "a\nB\nc\nd\ne\n");
  assert.equal(workflowInternals.applyHunks(before, hunks, [hunks[1].id]), "a\nb\nc\nd\nE\n");
});

test("large previews are explicitly truncated", () => {
  const preview = workflowInternals.trimPreview("x\n".repeat(100), 20, 4);
  assert.equal(preview.truncated, true);
  assert.equal(preview.lines, 4);
  assert.ok(preview.totalLines > preview.lines);
});

test("unsafe branch names are rejected", () => {
  assert.equal(workflowInternals.validBranch("feature/review"), "feature/review");
  for (const value of ["", "../escape", "bad branch", "-oops", "a..b", "x@{y"]) {
    assert.throws(() => workflowInternals.validBranch(value));
  }
});

test("review stays pending until explicit apply and rejected files remain untouched", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeFile(join(f.project, "reject.txt"), "keep\n");
  await git(f.project, ["add", "reject.txt"]);
  await git(f.project, ["commit", "-m", "add reject fixture"]);

  const proposal = await f.workflow.createChange("p1", {
    source: "test-agent",
    files: [
      { path: "sample.txt", content: "one\nTWO\nthree\nfour\n" },
      { path: "reject.txt", content: "replace\n" }
    ]
  });
  assert.equal(await readFile(join(f.project, "sample.txt"), "utf8"), "one\ntwo\nthree\nfour\n");

  await f.workflow.review("p1", proposal.id, {
    files: [
      { path: "sample.txt", decision: "accept" },
      { path: "reject.txt", decision: "reject" }
    ]
  });
  assert.equal(await readFile(join(f.project, "sample.txt"), "utf8"), "one\ntwo\nthree\nfour\n");

  const result = await f.workflow.applyChange("p1", proposal.id);
  assert.deepEqual(result.change.appliedFiles, ["sample.txt"]);
  assert.equal(await readFile(join(f.project, "sample.txt"), "utf8"), "one\nTWO\nthree\nfour\n");
  assert.equal(await readFile(join(f.project, "reject.txt"), "utf8"), "keep\n");
});

test("partial hunk review applies only accepted hunks", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const proposal = await f.workflow.createChange("p1", {
    files: [{ path: "sample.txt", content: "ONE\ntwo\nthree\nFOUR\n" }]
  });
  assert.equal(proposal.files[0].hunks.length, 2);
  await f.workflow.review("p1", proposal.id, {
    files: [{
      path: "sample.txt",
      hunks: [
        { id: proposal.files[0].hunks[0].id, decision: "accept" },
        { id: proposal.files[0].hunks[1].id, decision: "reject" }
      ]
    }]
  });
  await f.workflow.applyChange("p1", proposal.id);
  assert.equal(await readFile(join(f.project, "sample.txt"), "utf8"), "ONE\ntwo\nthree\nfour\n");
});

test("context drift fails safely before writing", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const proposal = await f.workflow.createChange("p1", {
    files: [{ path: "sample.txt", content: "one\nTWO\nthree\nfour\n" }]
  });
  await f.workflow.review("p1", proposal.id, { files: [{ path: "sample.txt", decision: "accept" }] });
  await writeFile(join(f.project, "sample.txt"), "user edit\n");
  await assert.rejects(() => f.workflow.applyChange("p1", proposal.id), /Context drift/);
  assert.equal(await readFile(join(f.project, "sample.txt"), "utf8"), "user edit\n");
});

test("dirty worktree cleanup is blocked and clean cleanup requires confirmation", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const worktree = await f.workflow.createWorktree("p1", {
    baseBranch: "main",
    branch: "issue-57",
    sessionId: "session-test",
    agent: "codex"
  });
  assert.match(worktree.branch, /^devmoter\/issue-57/);
  await writeFile(join(worktree.path, "dirty.txt"), "do not lose me\n");

  const blocked = await f.workflow.cleanupWorktree("p1", worktree.id, { confirm: true });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.path, worktree.path);
  assert.equal(blocked.branch, worktree.branch);

  await rm(join(worktree.path, "dirty.txt"));
  const preview = await f.workflow.cleanupWorktree("p1", worktree.id);
  assert.equal(preview.confirmationRequired, true);
  assert.equal(preview.preview.path, worktree.path);
  const removed = await f.workflow.cleanupWorktree("p1", worktree.id, { confirm: true });
  assert.equal(removed.removed, true);
});

test("commit is previewed first and unrelated dirty changes block it", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const proposal = await f.workflow.createChange("p1", {
    files: [{ path: "sample.txt", content: "one\nTWO\nthree\nfour\n" }]
  });
  await f.workflow.review("p1", proposal.id, { files: [{ path: "sample.txt", decision: "accept" }] });
  await f.workflow.applyChange("p1", proposal.id);

  const preview = await f.workflow.commitChange("p1", proposal.id, { message: "feat: reviewed change" });
  assert.equal(preview.committed, false);
  assert.deepEqual(preview.preview.files, ["sample.txt"]);
  assert.equal(preview.preview.message, "feat: reviewed change");

  await writeFile(join(f.project, "unrelated.txt"), "user work\n");
  await assert.rejects(
    () => f.workflow.commitChange("p1", proposal.id, { message: "feat: reviewed change", confirm: true }),
    /Unrelated dirty changes/
  );
});

test("bounded git diff reports truncation and supports offset windows", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  await writeFile(join(f.project, "sample.txt"), "changed\n".repeat(100));
  const params = new URLSearchParams({ lines: "4", bytes: "4096", offset: "0" });
  const first = await f.workflow.diff("p1", params);
  assert.equal(first.truncated, true);
  assert.equal(first.returnedLines, 4);
  assert.match(first.notice, /truncated/i);

  const next = await f.workflow.diff("p1", new URLSearchParams({ lines: "4", bytes: "4096", offset: "4" }));
  assert.equal(next.offsetLines, 4);
});
