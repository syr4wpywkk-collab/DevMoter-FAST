import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEventStore,
  createLockManager,
  createPolicyEngine,
  parseSymbols
} from "../server/control-plane.mjs";

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

test("locks expose owners and reject conflicting writers", () => {
  let now = 1000;
  const locks = createLockManager({ now: () => now, defaultTtlMs: 10000 });
  const first = locks.acquire({
    projectId: "p1",
    path: "src/a.ts",
    owner: "agent-a",
    reason: "edit"
  });
  assert.equal(first.ok, true);
  const conflict = locks.acquire({
    projectId: "p1",
    path: "src/a.ts",
    owner: "agent-b"
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict.owner, "agent-a");
  now += 11000;
  const recovered = locks.acquire({
    projectId: "p1",
    path: "src/a.ts",
    owner: "agent-b"
  });
  assert.equal(recovered.ok, true);
});

test("event store replays strictly after cursor and records compaction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-events-"));
  try {
    const events = createEventStore({ stateDir: dir });
    const a = await events.append("session-a", {
      type: "user",
      payload: { text: "one" }
    });
    const b = await events.append("session-a", {
      type: "assistant",
      payload: { text: "two" }
    });
    const replay = await events.after("session-a", a.cursor);
    assert.deepEqual(replay.events.map(item => item.id), [b.id]);
    const compacted = await events.compact("session-a", { keepRecent: 20 });
    assert.equal(compacted.event.type, "compaction");
    assert.ok(compacted.view.length >= 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  assert.equal(symbols[1].file, "src/run.ts");
});
