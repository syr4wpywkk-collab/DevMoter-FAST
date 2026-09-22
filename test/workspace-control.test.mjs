import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEventStore,
  createLockManager,
  createPolicyEngine,
  createWorkspaceControl,
  parseSymbols,
  structuralSearch,
  workspaceControlInternals
} from "../server/workspace-control.mjs";

test("policy engine is deterministic and deny wins", () => {
  const policy = createPolicyEngine([
    { id: "allow-read", effect: "allow", action: "read", reason: "safe read" },
    { id: "deny-secret", effect: "deny", action: "read", path: ".env", reason: "secret" }
  ]);
  assert.equal(policy.decide({ action: "read", path: "README.md" }).decision, "allow");
  const blocked = policy.decide({ action: "read", path: ".env" });
  assert.equal(blocked.decision, "deny");
  assert.equal(blocked.ruleId, "deny-secret");
  assert.equal(policy.decide({ action: "write" }).decision, "ask");
});

test("lock aliases normalize to one conflict key", () => {
  let now = 1000;
  const locks = createLockManager({ now: () => now, defaultTtlMs: 10000 });
  const first = locks.acquire({
    projectId: "p1",
    path: "src/a.ts",
    owner: "agent-a",
    reason: "edit"
  });
  assert.equal(first.ok, true);

  const aliases = ["src/./a.ts", "src\\a.ts"];
  for (const path of aliases) {
    const conflict = locks.acquire({ projectId: "p1", path, owner: "agent-b" });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.conflict.owner, "agent-a");
    assert.equal(conflict.conflict.path, "src/a.ts");
  }

  assert.throws(
    () => workspaceControlInternals.normalizeLockPath("../outside"),
    /escapes project/
  );

  now += 11000;
  assert.equal(
    locks.acquire({ projectId: "p1", path: "src/a.ts", owner: "agent-b" }).ok,
    true
  );
});

test("concurrent first event appends receive unique monotonic cursors", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-workspace-events-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = createEventStore({ stateDir: dir });

  const appended = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      events.append("session-a", {
        type: "assistant",
        payload: { index }
      })
    )
  );

  assert.deepEqual(
    appended.map(item => item.seq).sort((a, b) => a - b),
    Array.from({ length: 30 }, (_, index) => index + 1)
  );
  assert.equal(new Set(appended.map(item => item.cursor)).size, 30);

  const replay = await events.after("session-a", "session-a:0", 100);
  assert.deepEqual(replay.events.map(item => item.seq), Array.from({ length: 30 }, (_, index) => index + 1));

  const rows = (await readFile(join(dir, "workspace-events", "session-a.jsonl"), "utf8"))
    .trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(rows.map(item => item.seq), Array.from({ length: 30 }, (_, index) => index + 1));
});

test("event compaction is non-destructive and records source/retained counts", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-workspace-compact-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const events = createEventStore({ stateDir: dir });
  for (let i = 0; i < 30; i += 1) {
    await events.append("session-a", {
      type: i === 0 ? "approval" : "assistant",
      payload: { i }
    });
  }
  const compacted = await events.compact("session-a", { keepRecent: 20 });
  assert.equal(compacted.event.type, "compaction");
  assert.equal(compacted.event.payload.sourceEvents, 30);
  assert.ok(compacted.event.payload.retainedEvents >= 20);
  const replay = await events.after("session-a", 0, 100);
  assert.equal(replay.events.length, 31);
});

test("structural parser locates common symbols without whole-file context", () => {
  const source =
    "export class Runner {}\n" +
    "export async function execute(task) { return task }\n" +
    "const helper = (value) => value;";
  const symbols = parseSymbols(source, ".ts", "src/run.ts");
  assert.deepEqual(
    symbols.map(item => [item.kind, item.name]),
    [
      ["class", "Runner"],
      ["function", "execute"],
      ["function", "helper"]
    ]
  );
});

test("structural search rejects symlink escapes and stays inside canonical project root", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-structural-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const outside = join(root, "outside");
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(project, "src", "inside.ts"), "export function insideSymbol() {}\n");
  await writeFile(join(outside, "escape.ts"), "export function escapedSecretSymbol() {}\n");
  await symlink(outside, join(project, "src", "linked"));

  const inside = await structuralSearch(project, "insideSymbol");
  assert.equal(inside.symbols[0]?.name, "insideSymbol");

  const escaped = await structuralSearch(project, "escapedSecretSymbol");
  assert.equal(escaped.symbols.length, 0);

  await assert.rejects(
    () => workspaceControlInternals.secureReadSource(project, join(project, "src", "linked", "escape.ts")),
    /escapes registered project|Unsafe structural-search/
  );
});

test("workspace settings fail closed when persisted state is malformed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-workspace-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "workspace-control.json"), "{bad-json");

  const control = createWorkspaceControl({
    stateDir: dir,
    resolveProject: async id => ({ id, name: id, path: dir })
  });

  await assert.rejects(
    () => control.getOverview(),
    /unreadable or malformed/
  );
});
