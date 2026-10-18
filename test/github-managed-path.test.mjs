import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGithubRepo, fetchGithubRepo } from "../server/github.mjs";

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-github-boundary-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, ".local", "share", "opencode-pocket", "repos");
  const projectApi = {
    read: async () => [],
    write: async () => { throw new Error("Must not register unsafe paths"); }
  };
  return { home, root, projectApi };
}

test("GitHub open rejects owner-directory symlinks before invoking gh", async t => {
  const { home, root, projectApi } = await fixture(t);
  const outside = join(home, "outside");
  await mkdir(outside);
  await mkdir(root, { recursive: true });
  await symlink(outside, join(root, "octocat"), "dir");
  await assert.rejects(openGithubRepo(home, projectApi, "octocat", "repo"), /symbolic links/);
});

test("GitHub fetch rejects repository-directory symlinks before invoking git", async t => {
  const { home, root } = await fixture(t);
  const outside = join(home, "outside");
  await mkdir(join(outside, ".git"), { recursive: true });
  await mkdir(join(root, "octocat"), { recursive: true });
  await symlink(outside, join(root, "octocat", "repo"), "dir");
  await assert.rejects(fetchGithubRepo(home, "octocat", "repo"), /symbolic links/);
});

test("GitHub open rejects a symlinked managed-root ancestor", async t => {
  const { home, projectApi } = await fixture(t);
  const outside = join(home, "outside");
  await mkdir(outside);
  await symlink(outside, join(home, ".local"), "dir");
  await assert.rejects(openGithubRepo(home, projectApi, "octocat", "repo"), /symbolic links/);
});

test("GitHub fetch rejects .git files that redirect metadata outside the checkout", async t => {
  const { home, root } = await fixture(t);
  const checkout = join(root, "octocat", "repo");
  await mkdir(checkout, { recursive: true });
  await writeFile(join(checkout, ".git"), "gitdir: /tmp/outside-git-metadata\n");
  await assert.rejects(fetchGithubRepo(home, "octocat", "repo"), /\.git must be a directory/);
});
