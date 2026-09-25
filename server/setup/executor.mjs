import { access, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { resolveExecutable, runSetupCommand } from "./detector.mjs";

const INSTALL_TIMEOUT_MS = 3 * 60 * 1000;
const EXECUTORS = Object.freeze({
  codex: {
    packageName: "@openai/codex",
    binary: "codex",
    versionArgs: ["--version"]
  },
  opencode: {
    packageName: "@opencode/cli",
    binary: "opencode",
    versionArgs: ["--version"]
  }
});

function inside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function publicFailure(errorCode, summary, nextAction) {
  return {
    status: "needs_user_action",
    errorCode,
    summary,
    nextAction
  };
}

async function userOwnedNpmPrefix(env, runtime = {}) {
  const resolveExecutableFn = runtime.resolveExecutable || resolveExecutable;
  const runCommand = runtime.runSetupCommand || runSetupCommand;
  const realpathFn = runtime.realpath || realpath;
  const accessFn = runtime.access || access;

  const npm = await resolveExecutableFn("npm", env);
  if (!npm?.resolvedPath) {
    return { ok: false, errorCode: "npm_unavailable" };
  }

  let prefixResult;
  try {
    prefixResult = await runCommand(npm.resolvedPath, ["prefix", "-g"], {
      env,
      timeoutMs: 10_000
    });
  } catch {
    return { ok: false, errorCode: "npm_prefix_unavailable" };
  }
  if (prefixResult?.code !== 0) {
    return { ok: false, errorCode: "npm_prefix_unavailable" };
  }

  const prefix = String(prefixResult.stdout || "")
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(Boolean);
  const home = String(env?.HOME || "");
  if (!prefix || !home || !isAbsolute(prefix) || !isAbsolute(home)) {
    return { ok: false, errorCode: "npm_prefix_invalid" };
  }

  let canonicalHome;
  let canonicalPrefix;
  try {
    canonicalHome = await realpathFn(home);
    canonicalPrefix = await realpathFn(prefix);
  } catch {
    return { ok: false, errorCode: "npm_prefix_unavailable" };
  }

  if (!inside(canonicalHome, canonicalPrefix)) {
    return { ok: false, errorCode: "npm_prefix_not_user_owned" };
  }

  try {
    await accessFn(canonicalPrefix, fsConstants.W_OK);
  } catch {
    return { ok: false, errorCode: "npm_prefix_not_writable" };
  }

  return {
    ok: true,
    npmPath: npm.resolvedPath,
    prefix: canonicalPrefix
  };
}

async function verifyBinary(executor, prefix, env, runtime = {}) {
  const runCommand = runtime.runSetupCommand || runSetupCommand;
  const realpathFn = runtime.realpath || realpath;
  const accessFn = runtime.access || access;
  const expected = join(prefix, "bin", executor.binary);

  let binary;
  try {
    await accessFn(expected, fsConstants.X_OK);
    binary = await realpathFn(expected);
  } catch {
    return false;
  }
  if (!inside(prefix, binary)) return false;

  try {
    const result = await runCommand(binary, executor.versionArgs, {
      env,
      timeoutMs: 10_000
    });
    return result?.code === 0;
  } catch {
    return false;
  }
}

export function supportedAutomaticInstaller(toolId) {
  return Object.hasOwn(EXECUTORS, String(toolId || ""));
}

export async function executeApprovedInstall(toolId, options = {}) {
  const id = String(toolId || "");
  const executor = EXECUTORS[id];
  if (!executor) {
    return publicFailure(
      "executor_unavailable",
      "No reviewed automatic installer is enabled for this tool.",
      "Use the official source shown in the setup review, then rescan."
    );
  }

  const env = options.env || process.env;
  const prefix = await userOwnedNpmPrefix(env, options.runtime);
  if (!prefix.ok) {
    return publicFailure(
      prefix.errorCode,
      "Automatic installation requires a writable npm global prefix owned by the current user.",
      "Configure a user-owned npm global prefix, then rescan and retry."
    );
  }

  const runCommand = options.runtime?.runSetupCommand || runSetupCommand;
  let installResult;
  try {
    installResult = await runCommand(
      prefix.npmPath,
      ["install", "--global", "--prefix", prefix.prefix, executor.packageName],
      { env, timeoutMs: INSTALL_TIMEOUT_MS }
    );
  } catch {
    return {
      status: "failed",
      errorCode: "install_failed",
      summary: "The official npm installation did not complete.",
      nextAction: "Review the local npm setup, then retry."
    };
  }

  if (installResult?.code !== 0) {
    return {
      status: "failed",
      errorCode: "install_failed",
      summary: "The official npm installation returned an error.",
      nextAction: "Review the local npm setup, then retry."
    };
  }

  const verified = await verifyBinary(executor, prefix.prefix, env, options.runtime);
  if (!verified) {
    return {
      status: "failed",
      errorCode: "verification_failed",
      summary: "Installation completed but the expected CLI could not be verified.",
      nextAction: "Rescan the machine and review the local npm prefix."
    };
  }

  return {
    status: "succeeded",
    errorCode: null,
    summary: `${id === "codex" ? "Codex CLI" : "OpenCode CLI"} was installed and verified.`,
    nextAction: null
  };
}
