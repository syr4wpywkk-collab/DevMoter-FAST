import { platform as nodePlatform, version as nodeVersion } from "node:process";
import { readFile } from "node:fs/promises";
import { resolveExecutable, runSetupCommand } from "./detector.mjs";
import { diagnostic } from "./diagnostics.mjs";
import { publicToolResult } from "./state.mjs";
import { antigravityAdapter } from "./adapters/antigravity.mjs";
import { claudeAdapter } from "./adapters/claude.mjs";
import { codexAdapter } from "./adapters/codex.mjs";
import { githubAdapter } from "./adapters/github.mjs";
import { opencodeAdapter } from "./adapters/opencode.mjs";
import { tailscaleAdapter } from "./adapters/tailscale.mjs";

export const setupAdapters = Object.freeze([
  codexAdapter, opencodeAdapter, claudeAdapter, antigravityAdapter, githubAdapter, tailscaleAdapter
]);

const OS_RELEASE_FIELDS = new Set(["ID", "ID_LIKE", "VERSION_ID"]);

function parseOsRelease(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match || !OS_RELEASE_FIELDS.has(match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (/^[A-Za-z0-9._ -]{0,100}$/.test(value)) values[match[1]] = value;
  }
  return values;
}

export async function detectLinuxEnvironment(options = {}) {
  if ((options.platform || nodePlatform) !== "linux") {
    return { distro: "unknown", version: null, family: "unknown", packageManager: null, environment: "unknown", supported: false };
  }
  let release = {};
  try { release = parseOsRelease(await (options.readOsRelease || readFile)("/etc/os-release", "utf8")); } catch { /* Unknown distro fails closed. */ }
  const id = String(release.ID || "").toLowerCase();
  const like = String(release.ID_LIKE || "").toLowerCase().split(/\s+/);
  const ids = new Set([id, ...like]);
  let family = "unknown";
  let packageManager = null;
  if (["debian", "ubuntu", "linuxmint", "pop", "raspbian"].some(value => ids.has(value))) { family = "debian"; packageManager = "apt"; }
  else if (["fedora", "rhel", "centos", "rocky", "almalinux"].some(value => ids.has(value))) { family = "rhel"; packageManager = "dnf"; }
  else if (["opensuse", "opensuse-leap", "opensuse-tumbleweed", "sles"].some(value => ids.has(value))) { family = "suse"; packageManager = "zypper"; }
  const crostiniMarker = options.env ? options.env.CROSTINI : process.env.CROSTINI;
  const environment = options.environment || (crostiniMarker ? "crostini" : "linux");
  return {
    distro: id || "unknown",
    version: typeof release.VERSION_ID === "string" ? release.VERSION_ID : null,
    family,
    packageManager,
    environment: /^[a-z0-9_-]{1,32}$/i.test(environment) ? environment : "unknown",
    supported: family === "debian" && (environment === "linux" || environment === "crostini")
  };
}

async function environmentGit(env) {
  const executable = await resolveExecutable("git", env);
  if (!executable) return { installed: false, version: null };
  try {
    const result = await runSetupCommand(executable.resolvedPath, ["--version"], { env });
    const match = result.code === 0 ? result.stdout.match(/^git version ([0-9][\w.+-]{0,39})/i) : null;
    return { installed: Boolean(match), version: match?.[1] || null };
  } catch {
    return { installed: false, version: null };
  }
}

export async function createSetupStatus(options = {}) {
  const env = options.env || process.env;
  const platformName = options.platform || nodePlatform;
  const linux = await detectLinuxEnvironment(options);
  const supported = linux.supported;
  const context = { env, timeoutMs: options.timeoutMs };
  const detections = await Promise.all(setupAdapters.map(async adapter => {
    try {
      if (!supported) {
        return publicToolResult({
          state: "unsupported", installed: false, authenticated: null, authState: "unknown",
          diagnostics: [diagnostic("unsupported_platform")]
        }, adapter);
      }
      return publicToolResult(await adapter.detect(context), adapter);
    } catch {
      return publicToolResult({
        state: "unknown", installed: false, authenticated: null, authState: "unknown",
        diagnostics: [diagnostic("adapter_failed")]
      }, adapter);
    }
  }));

  const git = supported ? await environmentGit(env) : { installed: false, version: null };
  return {
    phase: "experimental-phase-1",
    platform: {
      os: platformName,
      supported,
      distro: linux.distro,
      distroVersion: linux.version,
      packageManager: linux.packageManager,
      environment: linux.environment,
      node: { available: true, version: nodeVersion.replace(/^v/, "") },
      git
    },
    tools: detections
  };
}
