import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFileDiff, getGitStatus, listChangedFiles } from "../server/git-workspace.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  await execFileAsync("git", args, { cwd, encoding: "utf8" });
}

test("git workspace reports read-only status, files and bounded diffs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-git-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.email", "test@example.com");
    await git(dir, "config", "user.name", "DevMoter Test");
    await writeFile(join(dir, "modified.txt"), "one\n");
    await writeFile(join(dir, "staged.txt"), "one\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "init");

    await writeFile(join(dir, "modified.txt"), "one\ntwo\n");
    await writeFile(join(dir, "staged.txt"), "one\ntwo\n");
    await git(dir, "add", "staged.txt");
    await writeFile(join(dir, "untracked.txt"), "new\n");

    const status = await getGitStatus(dir);
    assert.equal(status.isGit, true);
    assert.equal(status.staged, 1);
    assert.equal(status.modified, 1);
    assert.equal(status.untracked, 1);
    assert.equal(status.conflicts, 0);

    const changed = await listChangedFiles(dir, { limit: 2, offset: 0 });
    assert.equal(changed.total, 3);
    assert.equal(changed.files.length, 2);
    assert.equal(changed.hasMore, true);

    const all = await listChangedFiles(dir, { limit: 10, offset: 0 });
    const byPath = new Map(all.files.map(file => [file.path, file]));
    assert.ok(byPath.get("modified.txt")?.status.includes("modified"));
    assert.ok(byPath.get("staged.txt")?.status.includes("staged"));
    assert.ok(byPath.get("untracked.txt")?.status.includes("untracked"));

    const modifiedDiff = await getFileDiff(dir, "modified.txt");
    assert.match(modifiedDiff.diff, /\+two/);

    const untrackedDiff = await getFileDiff(dir, "untracked.txt");
    assert.match(untrackedDiff.diff, /--- \/dev\/null/);

    await assert.rejects(() => getFileDiff(dir, "../escape.txt"), /inside the active project/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("untracked diffs never follow symlinks outside the project", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-git-root-"));
  const outside = await mkdtemp(join(tmpdir(), "devmoter-git-outside-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.email", "test@example.com");
    await git(dir, "config", "user.name", "DevMoter Test");
    await writeFile(join(dir, "tracked.txt"), "safe\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "init");

    const secret = "outside-secret-should-never-leak";
    await writeFile(join(outside, "secret.txt"), secret);
    await symlink(join(outside, "secret.txt"), join(dir, "leak.txt"));

    const diff = await getFileDiff(dir, "leak.txt");
    assert.doesNotMatch(diff.diff, new RegExp(secret));
    assert.match(diff.diff, /unreadable|Binary/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("large untracked files are bounded before content is read into the diff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-git-large-"));
  try {
    await git(dir, "init");
    await git(dir, "config", "user.email", "test@example.com");
    await git(dir, "config", "user.name", "DevMoter Test");
    await writeFile(join(dir, "tracked.txt"), "safe\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "init");
    await writeFile(join(dir, "large.txt"), "x".repeat(300 * 1024));

    const diff = await getFileDiff(dir, "large.txt");
    assert.match(diff.diff, /too large/i);
    assert.ok(diff.diff.length < 2048);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
