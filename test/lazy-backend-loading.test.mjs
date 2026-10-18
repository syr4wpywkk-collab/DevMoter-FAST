import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project deep links are consumed before chat mounts and health polling is bounded", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  for (const module of ["opencode", "codex", "api-chat"]) {
    assert.match(source, new RegExp(`^import \\{ mount.* \\} from \\"\\./${module}\\";`, "m"));
  }
  const replace = source.indexOf("window.history.replaceState");
  const mount = source.indexOf("const openCodeRemote = mountOpenCodeRemote(");
  assert.ok(replace >= 0 && mount > replace, "the project deep link is removed before backend mounts");
  assert.match(source, /let healthCheckInFlight = false;/);
  assert.match(source, /if \(healthCheckInFlight\) return;/);
  assert.match(source, /window\.addEventListener\("online", \(\) => void checkHealth\(\)\)/);
  assert.match(source, /openCodeRemote\.setOnline\(false\);\s+codexRemote\.setOnline\(false\);/);
  assert.match(source, /finally \{\s*healthCheckInFlight = false;/);
});
