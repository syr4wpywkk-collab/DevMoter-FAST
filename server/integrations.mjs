import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 8_000;
const ACTION_COOLDOWN_MS = 2_000;
const lastActionAt = new Map();

class IntegrationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
  }
}

export function sanitizeChildEnv(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (
      /^(DEVMOTER|POCKET|OPENCODE).*?(PASSWORD|TOKEN|SECRET|API_KEY|KEY)$/i.test(key) ||
      key === "OPENCODE_SERVER_PASSWORD"
    ) {
      delete env[key];
    }
  }
  return env;
}

function assertActionCooldown(key) {
  const now = Date.now();
  const previous = lastActionAt.get(key) || 0;
  if (now - previous < ACTION_COOLDOWN_MS) {
    throw new IntegrationError("Please wait before repeating this integration action.", 429);
  }
  lastActionAt.set(key, now);
}

export function publicIntegrationError(error) {
  if (error instanceof IntegrationError) {
    return { status: error.status, error: error.message };
  }
  return { status: 500, error: "Integration operation failed" };
}

const DEFINITIONS = {
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    bin: process.env.ANTIGRAVITY_BIN || process.env.AGY_BIN || "agy",
    versionArgs: ["--version"],
    webUrl: "https://antigravity.google.com",
    capabilities: {
      launch: true,
      openProject: true,
      remoteControl: true,
      remoteUrl: true,
      qrHandoff: true,
      agentChat: false
    }
  },
  claude: {
    id: "claude",
    name: "Claude Code",
    bin: process.env.CLAUDE_BIN || "claude",
    versionArgs: ["--version"],
    webUrl: "https://claude.ai/code",
    mobileUrl: "claude://code",
    capabilities: {
      launch: true,
      openProject: true,
      remoteControl: false,
      remoteUrl: false,
      qrHandoff: true,
      agentChat: false
    }
  }
};

export function compactOutput(value, limit = 2_000) {
  return String(value || "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, limit);
}

async function run(bin, args, options = {}) {
  const { stdout = "", stderr = "" } = await execFileAsync(bin, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs || COMMAND_TIMEOUT_MS,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    env: {
      ...sanitizeChildEnv(process.env),
      NO_COLOR: "1",
      TERM: process.env.TERM || "dumb"
    }
  });
  return {
    stdout: compactOutput(stdout),
    stderr: compactOutput(stderr)
  };
}

async function detect(definition) {
  try {
    const result = await run(definition.bin, definition.versionArgs, { timeoutMs: 4_000 });
    return {
      installed: true,
      version: compactOutput(result.stdout || result.stderr, 300) || "installed"
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { installed: false, version: null };
    }
    return {
      installed: true,
      version: null
    };
  }
}

export function validateAntigravityRemoteUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "antigravity.google.com") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractAntigravityRemoteUrl(text) {
  const matches = String(text || "").match(/https:\/\/[^\s<>"']+/gi) || [];
  for (const candidate of matches) {
    const normalized = validateAntigravityRemoteUrl(candidate.replace(/[),.;]+$/, ""));
    if (normalized) return normalized;
  }
  return null;
}

function parseAntigravityStatus(output) {
  const text = compactOutput(output, 4_000);
  const lower = text.toLowerCase();
  const explicitlyStopped =
    /not\s+running|not\s+registered|stopped|inactive|disabled/.test(lower);
  const running =
    !explicitlyStopped &&
    /running|active|registered|connected|online/.test(lower);
  const name =
    text.match(/(?:hostname|instance(?:\s+name)?|name)\s*:\s*([^\r\n]+)/i)?.[1]?.trim() ||
    null;

  return {
    running,
    name,
    remoteUrl: extractAntigravityRemoteUrl(text),
    output: text
  };
}

async function antigravityRemoteStatus() {
  const definition = DEFINITIONS.antigravity;
  const detection = await detect(definition);
  if (!detection.installed) {
    return {
      installed: false,
      running: false,
      name: null,
      remoteUrl: null,
      output: ""
    };
  }

  try {
    const result = await run(definition.bin, ["remote-control", "status"]);
    return {
      installed: true,
      ...parseAntigravityStatus([result.stdout, result.stderr].filter(Boolean).join("\n"))
    };
  } catch (error) {
    const output = compactOutput(
      [error?.stdout, error?.stderr, error instanceof Error ? error.message : String(error)]
        .filter(Boolean)
        .join("\n"),
      4_000
    );
    return {
      installed: true,
      ...parseAntigravityStatus(output),
      error: "Antigravity Remote Control status unavailable"
    };
  }
}

async function findExecutable(name) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await run(locator, [name], { timeoutMs: 2_000 });
    return Boolean(result.stdout);
  } catch {
    return false;
  }
}

async function spawnDetached(bin, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      env: sanitizeChildEnv(process.env)
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

async function launchInTerminal(command, cwd, extraArgs = []) {
  if (process.platform === "linux") {
    const candidates = [
      { bin: "x-terminal-emulator", args: ["-e", command, ...extraArgs] },
      { bin: "gnome-terminal", args: ["--", command, ...extraArgs] },
      { bin: "konsole", args: ["-e", command, ...extraArgs] },
      { bin: "kitty", args: [command, ...extraArgs] },
      { bin: "wezterm", args: ["start", "--", command, ...extraArgs] }
    ];

    for (const candidate of candidates) {
      if (!(await findExecutable(candidate.bin))) continue;
      await spawnDetached(candidate.bin, candidate.args, cwd);
      return { ok: true, terminal: candidate.bin };
    }

    throw new Error("No supported desktop terminal was found");
  }

  throw new Error(`Desktop launch is not implemented for ${process.platform} yet`);
}

export function publicDefinition(definition) {
  return {
    id: definition.id,
    name: definition.name,
    webUrl: definition.webUrl,
    ...(definition.mobileUrl ? { mobileUrl: definition.mobileUrl } : {}),
    capabilities: { ...definition.capabilities }
  };
}

export async function listIntegrations() {
  const [antigravityDetection, claudeDetection, remote] = await Promise.all([
    detect(DEFINITIONS.antigravity),
    detect(DEFINITIONS.claude),
    antigravityRemoteStatus()
  ]);

  return {
    integrations: [
      {
        ...publicDefinition(DEFINITIONS.antigravity),
        ...antigravityDetection,
        remote: {
          running: remote.running,
          name: remote.name,
          remoteUrl: remote.remoteUrl,
          dashboardUrl: DEFINITIONS.antigravity.webUrl,
          error: remote.error || null
        }
      },
      {
        ...publicDefinition(DEFINITIONS.claude),
        ...claudeDetection
      }
    ]
  };
}

export async function launchIntegration(id, cwd) {
  const definition = DEFINITIONS[id];
  if (!definition) throw new IntegrationError("Unknown integration");

  assertActionCooldown(`launch:${id}`);

  const detection = await detect(definition);
  if (!detection.installed) {
    throw new IntegrationError(`${definition.name} is not installed`);
  }

  try {
    const result = await launchInTerminal(definition.bin, cwd);
    return {
      ok: true,
      integration: id,
      ...result
    };
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError("Unable to launch the integration on this host.");
  }
}

export async function antigravityRemoteAction(action) {
  const definition = DEFINITIONS.antigravity;
  const detection = await detect(definition);
  if (!detection.installed) throw new IntegrationError("Antigravity CLI is not installed");

  if (action === "status") {
    return antigravityRemoteStatus();
  }

  const argsByAction = {
    start: ["remote-control", "start"],
    stop: ["remote-control", "stop"]
  };
  const args = argsByAction[action];
  if (!args) throw new IntegrationError("Unsupported Antigravity Remote Control action");

  assertActionCooldown("antigravity:remote");

  try {
    await run(definition.bin, args, { timeoutMs: 20_000 });
  } catch {
    throw new IntegrationError("Antigravity Remote Control command failed.");
  }
  const status = await antigravityRemoteStatus();

  return {
    ok: true,
    action,
    installed: status.installed,
    running: status.running,
    name: status.name,
    remoteUrl: status.remoteUrl,
    error: status.error || null,
    dashboardUrl: definition.webUrl
  };
}
