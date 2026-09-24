import { platform as nodePlatform, version as nodeVersion } from "node:process";
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
  const supported = platformName === "linux";
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
      node: { available: true, version: nodeVersion.replace(/^v/, "") },
      git
    },
    tools: detections
  };
}
