import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { findCiEnforcementGaps, REQUIRED_CI_COMMANDS } from "../scripts/ci-required-checks.mjs";

const root = new URL("../", import.meta.url);
const ci = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

test("CI runs install, typecheck, lint, build and tests on every push and pull request", () => {
  assert.deepEqual(findCiEnforcementGaps(ci), []);
});

test("removing a required step is reported", () => {
  for (const command of REQUIRED_CI_COMMANDS) {
    const without = ci.replace(new RegExp(`\\n\\s+- run: ${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`), "\n");
    assert.notEqual(without, ci, command);
    assert.deepEqual(findCiEnforcementGaps(without), [`CI does not run \`${command}\``]);
  }
});

test("steps that can be skipped or ignored are reported", () => {
  const conditional = ci.replace("      - run: npm run lint\n", "      - if: github.event_name == 'push'\n        run: npm run lint\n");
  assert.deepEqual(findCiEnforcementGaps(conditional), ["CI runs `npm run lint` only conditionally"]);

  const softFail = ci.replace("      - run: npm run build\n", "      - run: npm run build\n        continue-on-error: true\n");
  assert.deepEqual(findCiEnforcementGaps(softFail), ["CI uses continue-on-error, so a failing step can still pass"]);

  const filtered = ci.replace("  pull_request:\n", "  pull_request:\n    paths-ignore:\n      - '**.md'\n");
  assert.deepEqual(findCiEnforcementGaps(filtered), ["CI triggers are filtered, so some changes skip the checks"]);

  const pushOnly = ci.replace("  pull_request:\n", "");
  assert.deepEqual(findCiEnforcementGaps(pushOnly), ["CI does not run on pull_request"]);
});

async function testFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await testFiles(path));
    else if (entry.name.endsWith(".test.mjs")) found.push(path);
  }
  return found;
}

test("npm test covers every test file at any depth", async () => {
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.mjs"');
  const { globSync } = await import("node:fs");
  const base = new URL(".", root).pathname;
  const expected = (await testFiles(join(base, "test"))).map(path => relative(base, path)).sort();
  const matched = globSync("test/**/*.test.mjs", { cwd: base }).sort();
  assert.deepEqual(matched, expected);
  assert.ok(expected.some(path => path.split("/").length > 2), "nested test directories exist");
});

test("lint checks the CLI, browser tests and Vite config too", async () => {
  const lint = await readFile(new URL("scripts/lint.mjs", root), "utf8");
  for (const dir of ["src", "server", "test", "scripts", "public", "cli", "e2e"]) assert.match(lint, new RegExp(`"${dir}"`));
  assert.match(lint, /"vite\.config\.ts"/);
});
