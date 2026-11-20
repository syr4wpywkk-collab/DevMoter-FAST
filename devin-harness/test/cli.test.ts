import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, permShowPolicy } from "../src/cli/main.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("parseArgs: run with single-task flags and repeated --image", () => {
  const parsed = parseArgs([
    "run",
    "--id",
    "t1",
    "--prompt",
    "hello",
    "--image",
    "a.png",
    "--image",
    "b.png",
    "--keep-worktree",
    "--concurrency",
    "2",
  ]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.subcommand, null);
  assert.equal(parsed.flags.id, "t1");
  assert.equal(parsed.flags.prompt, "hello");
  assert.deepEqual(parsed.flags.image, ["a.png", "b.png"]);
  assert.equal(parsed.flags["keep-worktree"], true);
  assert.equal(parsed.flags.concurrency, "2");
});

test("parseArgs: perm show with --json and --profile", () => {
  const parsed = parseArgs(["perm", "show", "--profile", "readonly-audit", "--json"]);
  assert.equal(parsed.command, "perm");
  assert.equal(parsed.subcommand, "show");
  assert.equal(parsed.flags.profile, "readonly-audit");
  assert.equal(parsed.flags.json, true);
});

test("parseArgs: model set with --flag=value form", () => {
  const parsed = parseArgs([
    "model",
    "set",
    "--role",
    "plan",
    "--model=swe-2-high",
    "--effort",
    "high",
  ]);
  assert.equal(parsed.command, "model");
  assert.equal(parsed.subcommand, "set");
  assert.equal(parsed.flags.role, "plan");
  assert.equal(parsed.flags.model, "swe-2-high");
  assert.equal(parsed.flags.effort, "high");
});

test("parseArgs: usage --since/--live and attach-image flags", () => {
  const usage = parseArgs(["usage", "--since", "2026-11-01", "--live"]);
  assert.equal(usage.command, "usage");
  assert.equal(usage.flags.since, "2026-11-01");
  assert.equal(usage.flags.live, true);

  const attach = parseArgs([
    "attach-image",
    "--worktree",
    "/wt",
    "--file",
    "x.png",
    "--max-dim",
    "1024",
  ]);
  assert.equal(attach.command, "attach-image");
  assert.equal(attach.flags.worktree, "/wt");
  assert.equal(attach.flags.file, "x.png");
  assert.equal(attach.flags["max-dim"], "1024");
});

test("perm show composition always includes the base-deny floor", async () => {
  const root = mkdtempSync(join(tmpdir(), "harness-cli-root-"));
  cpSync(join(projectRoot, "config"), join(root, "config"), { recursive: true });

  const policy = await permShowPolicy(root, {});
  assert.ok(
    policy.rules.deny.includes("Read(.env*)"),
    "base deny Read(.env*) must survive composition",
  );
  assert.ok(policy.rules.deny.includes("Exec(sudo)"));

  const audit = await permShowPolicy(root, { profile: "readonly-audit" });
  assert.ok(audit.rules.deny.includes("Read(.env*)"));
  assert.ok(audit.rules.deny.includes("Write(**)"));
});
