import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { diagnostic, sanitizedFailure } from "./diagnostics.mjs";

const OUTPUT_LIMIT = 64 * 1024;
const COMMAND_TIMEOUT_MS = 4_000;
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,})/i;
const VERSION_PATTERN = /(?:^|\b)v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)(?:\b|$)/;

export function filteredEnvironment(source = process.env) {
  const env = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "NO_COLOR"]) {
    if (typeof source[key] === "string" && source[key].length <= 4096) env[key] = source[key];
  }
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|PASSWD|API.?KEY|CREDENTIAL|PRIVATE.?KEY/i.test(key)) delete env[key];
  }
  env.NO_COLOR = "1";
  env.TERM ||= "dumb";
  return env;
}

export async function resolveExecutable(binary, env = process.env) {
  if (typeof binary !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(binary) || binary.includes("..")) return null;
  for (const directory of String(env.PATH || "").split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, binary);
    try {
      await access(candidate, constants.X_OK);
      const resolvedPath = await realpath(candidate);
      return { resolvedPath, binary };
    } catch {
      // Continue searching fixed PATH entries. No user supplied path is accepted.
    }
  }
  return null;
}

export function runSetupCommand(executable, argv, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isAbsolute(executable) || !Array.isArray(argv) || argv.some(arg => typeof arg !== "string" || arg.length > 128)) {
      reject(Object.assign(new Error("Invalid internal setup command"), { code: "EINVAL" }));
      return;
    }

    let stdout = "";
    let stderr = "";
    const child = spawn(executable, argv, {
      shell: false,
      cwd: options.cwd || options.env?.HOME || process.env.HOME || process.cwd(),
      env: filteredEnvironment(options.env),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const collect = target => chunk => {
      const remaining = OUTPUT_LIMIT - Buffer.byteLength(target.value);
      if (remaining > 0) target.value += chunk.toString("utf8").slice(0, remaining);
    };
    const out = { get value() { return stdout; }, set value(value) { stdout = value; } };
    const err = { get value() { return stderr; }, set value(value) { stderr = value; } };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs || COMMAND_TIMEOUT_MS);
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function versionFrom(result) {
  const candidate = String(result.stdout.trim() || result.stderr.trim()).split(/\r?\n/, 1)[0];
  if (!candidate || SECRET_PATTERN.test(candidate)) return null;
  return candidate.match(VERSION_PATTERN)?.[1]?.slice(0, 80) || null;
}

function authFrom(result, adapter) {
  if (!adapter.authCheck) return { authenticated: null, authState: "unknown" };
  if (result?.code === 0) return { authenticated: true, authState: "authenticated" };
  if (adapter.authCheck.failureMeansRequired && result?.code !== null) {
    return { authenticated: false, authState: "required" };
  }
  return { authenticated: null, authState: "unknown" };
}

export async function detectCliAdapter(adapter, context = {}) {
  const env = context.env || process.env;
  const resolved = await resolveExecutable(adapter.binary, env);
  if (!resolved) {
    return {
      state: "missing", installed: false, resolvedPath: null, version: null,
      authenticated: null, authState: "unknown", diagnostics: [diagnostic("executable_missing")]
    };
  }

  let versionResult;
  try {
    versionResult = await runSetupCommand(resolved.resolvedPath, adapter.versionArgs, { env, timeoutMs: context.timeoutMs });
  } catch (error) {
    return {
      state: "broken", installed: true, resolvedPath: resolved.resolvedPath, version: null,
      authenticated: null, authState: "unknown", diagnostics: [sanitizedFailure(error)]
    };
  }
  const version = versionResult.code === 0 ? versionFrom(versionResult) : null;
  if (!version) {
    return {
      state: "broken", installed: true, resolvedPath: resolved.resolvedPath, version: null,
      authenticated: null, authState: "unknown", diagnostics: [diagnostic("version_check_failed")]
    };
  }

  let auth = { authenticated: null, authState: "unknown" };
  let providerAuth = "unknown";
  const diagnostics = [];
  if (adapter.authCheck) {
    try {
      const result = await runSetupCommand(resolved.resolvedPath, adapter.authCheck.argv, { env, timeoutMs: context.timeoutMs });
      if (adapter.id === "opencode") {
        // The documented command is a human-readable credential list whose
        // output can vary and omits environment-backed providers. Do not infer
        // a universal provider state from its text.
        if (result.code !== 0) diagnostics.push(diagnostic("auth_check_failed"));
      } else {
        const ignoredEnvironmentCredentials = (adapter.authEnvKeys || []).some(key => typeof env[key] === "string" && env[key].length > 0);
        auth = ignoredEnvironmentCredentials && result.code !== 0
          ? { authenticated: null, authState: "unknown" }
          : authFrom(result, adapter);
        if (auth.authState === "unknown") diagnostics.push(diagnostic("auth_check_failed"));
        if (ignoredEnvironmentCredentials) {
          diagnostics.push(diagnostic("auth_env_ignored"));
        }
        if (adapter.id === "tailscale" && result.code === 0) {
          try {
            const status = JSON.parse(result.stdout);
            if (status.BackendState === "Running") auth = { authenticated: true, authState: "authenticated" };
            else if (status.BackendState === "NeedsLogin") auth = { authenticated: false, authState: "required" };
            else {
              auth = { authenticated: null, authState: "unknown" };
              diagnostics.push(diagnostic("status_unavailable"));
            }
          } catch {
            auth = { authenticated: null, authState: "unknown" };
            diagnostics.push(diagnostic("invalid_status"));
          }
        }
      }
    } catch (error) {
      auth = { authenticated: null, authState: "unknown" };
      diagnostics.push(sanitizedFailure(error));
    }
  }

  const state = auth.authState === "required" ? "auth_required" : auth.authenticated === true ? "ready" : "installed";
  return {
    state, installed: true, resolvedPath: resolved.resolvedPath, version,
    ...auth, providerAuth, diagnostics
  };
}
