import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  buildEffectivePolicy,
  resolveMode,
} from "../src/policy/policy.js";
import { generateDevinConfig } from "../src/policy/config-gen.js";
import type { PolicyRules } from "../src/types.js";

const empty: PolicyRules = { allow: [], deny: [], ask: [] };

test("resolveMode maps all spec modes", () => {
  assert.deepEqual(resolveMode("normal"), {
    specMode: "normal",
    cliMode: "auto",
    sandbox: false,
  });
  assert.deepEqual(resolveMode("accept-edits"), {
    specMode: "accept-edits",
    cliMode: "accept-edits",
    sandbox: false,
  });
  assert.deepEqual(resolveMode("smart"), {
    specMode: "smart",
    cliMode: "smart",
    sandbox: false,
  });
  assert.deepEqual(resolveMode("autonomous"), {
    specMode: "autonomous",
    cliMode: "smart",
    sandbox: true,
  });
  assert.deepEqual(resolveMode("dangerous"), {
    specMode: "dangerous",
    cliMode: "dangerous",
    sandbox: false,
  });
});

test("monotonic decrease: base deny strips covered allows", () => {
  const base: PolicyRules = {
    allow: [],
    deny: ["Read(.env*)", "Read(**/.env*)", "Write(**/.env*)"],
    ask: [],
  };
  const policy = buildEffectivePolicy({
    mode: "smart",
    base,
    profile: {
      allow: ["Read(.env)", "Read(**)", "Read(src/index.ts)"],
      deny: [],
      ask: ["Read(.env)"],
    },
  });
  assert.ok(!policy.rules.allow.includes("Read(.env)"));
  assert.ok(!policy.rules.allow.includes("Read(**)"));
  assert.ok(policy.rules.allow.includes("Read(src/index.ts)"));
  assert.ok(!policy.rules.ask.includes("Read(.env)"));
  // Deny only ever grows.
  assert.ok(policy.rules.deny.includes("Read(.env*)"));
});

test("sandbox worktree: Write(worktree/**) added, .env inside worktree denied", () => {
  const base: PolicyRules = {
    allow: [],
    deny: ["Read(**/.env*)", "Write(**/.env*)"],
    ask: [],
  };
  const wt = "/tmp/worktree-x";
  const policy = buildEffectivePolicy({
    mode: "autonomous",
    base,
    profile: empty,
    worktree: wt,
  });
  assert.equal(policy.sandbox, true);
  assert.equal(policy.cliMode, "smart");
  assert.ok(policy.rules.allow.includes(`Write(${wt}/**)`));
  assert.ok(policy.rules.allow.includes(`Read(${wt}/**)`));

  // A read of a .env inside the worktree must still be denied: the broad
  // worktree allow must not resurrect it. Verify by attempting to add it.
  const policy2 = buildEffectivePolicy({
    mode: "autonomous",
    base,
    profile: {
      allow: [`Read(${wt}/.env)`, `Read(${wt}/**/.env)`],
      deny: [],
      ask: [],
    },
    worktree: wt,
  });
  assert.ok(!policy2.rules.allow.includes(`Read(${wt}/.env)`));
  assert.ok(!policy2.rules.allow.includes(`Read(${wt}/**/.env)`));
});

test("config-gen preserves other keys and unions deny", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "harness-cfg-"));
  const userConfig = path.join(dir, "user-config.json");
  await writeFile(
    userConfig,
    JSON.stringify({
      theme: "dark",
      permissions: {
        allow: ["Read(docs/**)"],
        deny: ["Exec(curl)"],
        ask: ["Exec(ssh)"],
      },
    }),
    "utf8",
  );
  const policy = buildEffectivePolicy({
    mode: "smart",
    base: { allow: [], deny: ["Read(.env*)"], ask: [] },
    profile: {
      allow: ["Read(.env)", "Read(src/**)"],
      deny: ["Write(.env*)"],
      ask: ["Exec(git push)"],
    },
  });
  const dest = path.join(dir, "out", "config.json");
  const returned = await generateDevinConfig({
    policy,
    destPath: dest,
    userConfigPath: userConfig,
  });
  assert.equal(returned, dest);
  const written = JSON.parse(await readFile(dest, "utf8"));
  assert.equal(written.theme, "dark");
  assert.ok(written.permissions.deny.includes("Exec(curl)"));
  assert.ok(written.permissions.deny.includes("Read(.env*)"));
  assert.ok(written.permissions.deny.includes("Write(.env*)"));
  assert.ok(written.permissions.allow.includes("Read(docs/**)"));
  assert.ok(written.permissions.allow.includes("Read(src/**)"));
  assert.ok(!written.permissions.allow.includes("Read(.env)"));
  assert.deepEqual(written.permissions.ask, ["Exec(git push)"]);
});
