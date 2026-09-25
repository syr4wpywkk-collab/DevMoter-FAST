import test from "node:test";
import assert from "node:assert/strict";
import { executeApprovedInstall, supportedAutomaticInstaller } from "../server/setup/executor.mjs";

function fakeRuntime({ prefix = "/home/test/.local/npm", installCode = 0, verifyCode = 0 } = {}) {
  const calls = [];
  return {
    calls,
    runtime: {
      resolveExecutable: async name => name === "npm" ? { resolvedPath: "/usr/bin/npm", binary: "npm" } : null,
      realpath: async value => value,
      access: async () => {},
      runSetupCommand: async (executable, argv) => {
        calls.push({ executable, argv: [...argv] });
        if (executable === "/usr/bin/npm" && argv.join(" ") === "prefix -g") {
          return { code: 0, stdout: prefix + "\n", stderr: "" };
        }
        if (executable === "/usr/bin/npm" && argv[0] === "install") {
          return { code: installCode, stdout: "", stderr: "" };
        }
        return { code: verifyCode, stdout: "1.2.3\n", stderr: "" };
      }
    }
  };
}

test("automatic installer allowlist contains only reviewed user npm tools", () => {
  assert.equal(supportedAutomaticInstaller("codex"), true);
  assert.equal(supportedAutomaticInstaller("opencode"), true);
  assert.equal(supportedAutomaticInstaller("claude"), false);
  assert.equal(supportedAutomaticInstaller("antigravity"), false);
  assert.equal(supportedAutomaticInstaller("github"), false);
  assert.equal(supportedAutomaticInstaller("tailscale"), false);
});

test("Codex uses only the fixed official npm package and user-owned prefix", async () => {
  const fake = fakeRuntime();
  const result = await executeApprovedInstall("codex", {
    env: { HOME: "/home/test", PATH: "/usr/bin" },
    runtime: fake.runtime
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(fake.calls, [
    { executable: "/usr/bin/npm", argv: ["prefix", "-g"] },
    {
      executable: "/usr/bin/npm",
      argv: ["install", "--global", "--prefix", "/home/test/.local/npm", "@openai/codex"]
    },
    { executable: "/home/test/.local/npm/bin/codex", argv: ["--version"] }
  ]);
});

test("OpenCode uses only the fixed official npm package and verifies the expected binary", async () => {
  const fake = fakeRuntime();
  const result = await executeApprovedInstall("opencode", {
    env: { HOME: "/home/test", PATH: "/usr/bin" },
    runtime: fake.runtime
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(fake.calls[1], {
    executable: "/usr/bin/npm",
    argv: ["install", "--global", "--prefix", "/home/test/.local/npm", "@opencode/cli"]
  });
  assert.deepEqual(fake.calls[2], {
    executable: "/home/test/.local/npm/bin/opencode",
    argv: ["--version"]
  });
});

test("automatic install refuses npm prefixes outside the current user's home", async () => {
  const fake = fakeRuntime({ prefix: "/usr/local" });
  const result = await executeApprovedInstall("codex", {
    env: { HOME: "/home/test", PATH: "/usr/bin" },
    runtime: fake.runtime
  });

  assert.equal(result.status, "needs_user_action");
  assert.equal(result.errorCode, "npm_prefix_not_user_owned");
  assert.equal(fake.calls.some(call => call.argv[0] === "install"), false);
});

test("automatic install fails closed when npm is unavailable", async () => {
  const result = await executeApprovedInstall("codex", {
    env: { HOME: "/home/test", PATH: "" },
    runtime: {
      resolveExecutable: async () => null
    }
  });
  assert.equal(result.status, "needs_user_action");
  assert.equal(result.errorCode, "npm_unavailable");
});

test("installer reports command and verification failures without returning child output", async () => {
  const installFailure = fakeRuntime({ installCode: 1 });
  const failed = await executeApprovedInstall("codex", {
    env: { HOME: "/home/test", PATH: "/usr/bin" },
    runtime: installFailure.runtime
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "install_failed");
  assert.equal(JSON.stringify(failed).includes("/home/test"), false);

  const verifyFailure = fakeRuntime({ verifyCode: 1 });
  const unverified = await executeApprovedInstall("codex", {
    env: { HOME: "/home/test", PATH: "/usr/bin" },
    runtime: verifyFailure.runtime
  });
  assert.equal(unverified.status, "failed");
  assert.equal(unverified.errorCode, "verification_failed");
});

test("unreviewed installers remain manual instead of guessing commands", async () => {
  const result = await executeApprovedInstall("tailscale", {
    env: { HOME: "/home/test", PATH: "/usr/bin" }
  });
  assert.equal(result.status, "needs_user_action");
  assert.equal(result.errorCode, "executor_unavailable");
});
