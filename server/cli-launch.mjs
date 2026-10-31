import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join, basename } from "node:path";
import { filteredEnvironment } from "./setup/detector.mjs";

// One row per CLI. Add Gemini CLI, Claude Code, or Cursor CLI by appending here.
export const cliDefinitions = Object.freeze([
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    install: "npm install -g @openai/codex"
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    install: "npm install -g @opencode/cli"
  }
]);

const LAUNCH_CODES = new Set(["not_installed", "not_executable", "failed"]);
const VERSION_TIMEOUT_MS = 4_000;

export class CliLaunchError extends Error {
  constructor(result) {
    super(result.message);
    this.name = "CliLaunchError";
    this.code = result.code;
    // The local CLI is missing or broken: the service is unavailable, not a bad gateway.
    this.status = 503;
    this.cli = publicCli(result);
  }
}

export function cliDefinition(commandOrId) {
  const raw = String(commandOrId || "");
  const name = basename(raw);
  return cliDefinitions.find(item => item.id === raw || item.command === raw || item.command === name) || null;
}

export function publicCli(result) {
  return {
    id: result.id,
    label: result.label,
    command: result.command,
    presence: result.presence,
    code: result.code,
    version: result.version,
    message: result.message
  };
}

function commandName(commandOrId, definition) {
  if (definition) return definition.command;
  const raw = String(commandOrId || "");
  return basename(raw) || raw;
}

function failure(definition, command, code, message) {
  return {
    id: definition?.id || command,
    label: definition?.label || command,
    command,
    install: definition?.install || null,
    presence: code === "not_installed" ? "missing" : "broken",
    code,
    version: null,
    message
  };
}

async function locate(commandOrId, env) {
  const raw = String(commandOrId || "");
  const definition = cliDefinition(raw);
  const command = commandName(raw, definition);
  const candidates = [];
  if (isAbsolute(raw)) candidates.push(raw);
  else if (!raw.includes("/") && !raw.includes("\\")) {
    for (const directory of String(env.PATH || "").split(delimiter)) {
      if (directory && isAbsolute(directory)) candidates.push(join(directory, command));
    }
  }

  let sawFile = false;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
    } catch {
      continue;
    }
    sawFile = true;
    try {
      await access(candidate, constants.X_OK);
      return { path: candidate, executable: true };
    } catch {
      return { path: candidate, executable: false };
    }
  }
  return sawFile ? { path: null, executable: false } : null;
}

function readVersion(executable, versionArgs, env, timeoutMs) {
  return new Promise(resolve => {
    let output = "";
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(executable, versionArgs, {
      env: filteredEnvironment(env),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const collect = chunk => {
      if (output.length < 400) output += chunk.toString("utf8");
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, timeoutMs);
    child.once("error", () => finish(null));
    child.once("close", code => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const line = output.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 80) || "";
      finish(line || null);
    });
  });
}

export async function inspectCli(commandOrId, options = {}) {
  const env = options.env || process.env;
  const definition = cliDefinition(commandOrId);
  const command = commandName(commandOrId, definition);
  const install = definition?.install || `${command} の公式の手順でインストールしてください`;
  const located = await locate(commandOrId, env);
  if (!located) {
    return failure(definition, command, "not_installed", `${command} が見つからないよ。入れ方: ${install}`);
  }
  if (!located.executable) {
    return failure(definition, command, "not_executable", `${command} はあるけど実行できないよ。入れ方: ${install}`);
  }

  const version = await readVersion(
    located.path,
    options.versionArgs || ["--version"],
    env,
    options.timeoutMs || VERSION_TIMEOUT_MS
  );
  if (!version) {
    return failure(definition, command, "failed", `${command} は動いてないよ。入れ方: ${install}`);
  }

  return {
    id: definition?.id || command,
    label: definition?.label || command,
    command,
    install: definition?.install || null,
    presence: "ready",
    code: null,
    version,
    resolvedPath: located.path,
    message: null
  };
}

export async function assertCliReady(commandOrId, options = {}) {
  const result = await inspectCli(commandOrId, options);
  if (result.code) throw new CliLaunchError(result);
  return result;
}

export async function inspectKnownClis(options = {}) {
  const results = [];
  for (const definition of cliDefinitions) {
    results.push(publicCli(await inspectCli(definition.id, options)));
  }
  return results;
}

export function launchCode(error) {
  return LAUNCH_CODES.has(error?.code) ? error.code : null;
}

const SPAWN_ERROR_CODES = Object.freeze({ ENOENT: "not_installed", EACCES: "not_executable", EPERM: "not_executable" });

/**
 * Turn a child_process spawn error (the CLI vanished or lost +x after the
 * readiness check) into the same CliLaunchError the readiness check throws.
 */
export function cliLaunchErrorFromSpawn(commandOrId, error) {
  if (error instanceof CliLaunchError) return error;
  const code = SPAWN_ERROR_CODES[error?.code];
  if (!code) return null;
  const definition = cliDefinition(commandOrId);
  const command = commandName(commandOrId, definition);
  const install = definition?.install || `${command} の公式の手順でインストールしてください`;
  const message = code === "not_installed"
    ? `${command} が見つからないよ。入れ方: ${install}`
    : `${command} はあるけど実行できないよ。入れ方: ${install}`;
  return new CliLaunchError(failure(definition, command, code, message));
}
