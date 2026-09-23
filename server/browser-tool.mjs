import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildBubblewrapCommand } from "./advanced-features.mjs";

const OUTPUT_LIMIT = 512 * 1024;
const PROCESS_TIMEOUT_MS = 15000;

function loopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function browserCandidates(env = process.env) {
  return [
    String(env.DEVMOTER_BROWSER_BIN || "").trim(),
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable"
  ].filter(Boolean);
}

function detectBrowserBinary({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  if (String(env.DEVMOTER_BROWSER_AUTOMATION || "") !== "1") return { binary: null, version: null };
  for (const candidate of browserCandidates(env)) {
    try {
      const probe = spawnSyncImpl(candidate, ["--version"], { encoding: "utf8", timeout: 3000 });
      if (probe?.status === 0) {
        return {
          binary: candidate,
          version: String(probe.stdout || probe.stderr || "").trim().slice(0, 240) || null
        };
      }
    } catch {
      // Continue probing allowlisted browser binaries.
    }
  }
  return { binary: null, version: null };
}

export function browserAutomationStatus({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  const enabled = String(env.DEVMOTER_BROWSER_AUTOMATION || "") === "1";
  const detected = detectBrowserBinary({ env, spawnSyncImpl });
  return {
    enabled,
    available: Boolean(detected.binary),
    binary: detected.binary ? String(detected.binary).split("/").pop() : null,
    version: detected.version,
    scope: "approved-live-preview-only",
    profile: "ephemeral-isolated",
    credentials: "personal-browser-profile-not-mounted"
  };
}

function browserArgs(profileDir, target, { dumpDom = false } = {}) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-features=OptimizationHints,AutofillServerCommunication,MediaRouter",
    "--no-proxy-server",
    "--user-data-dir=" + profileDir
  ];
  if (dumpDom) args.push("--dump-dom");
  else args.push("--remote-debugging-port=0");
  args.push(target);
  return args;
}

function boundedProcess(spawnImpl, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let truncated = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill?.("SIGTERM");
      settled = true;
      reject(new Error("Browser inspection timed out"));
    }, options.timeoutMs || PROCESS_TIMEOUT_MS);
    timer.unref?.();

    const append = (stream, chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      if (!text) return stream;
      const next = stream + text;
      if (Buffer.byteLength(next, "utf8") <= OUTPUT_LIMIT) return next;
      truncated = true;
      return Buffer.from(next, "utf8").subarray(0, OUTPUT_LIMIT).toString("utf8");
    };
    child.stdout?.on?.("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on?.("data", chunk => { stderr = append(stderr, chunk); });
    child.once?.("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once?.("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error((stderr || "Browser inspection failed").slice(0, 2000)));
        return;
      }
      resolve({ stdout, stderr, truncated });
    });
  });
}

export function createBrowserAutomation({
  configDir,
  resolveProject,
  getPreview,
  env = process.env,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync
}) {
  if (typeof resolveProject !== "function" || typeof getPreview !== "function") {
    throw new Error("Browser automation requires project and preview resolvers");
  }
  const sessions = new Map();
  const profilesDir = join(configDir, "browser-profiles");

  function publicSession(session) {
    return session ? {
      id: session.id,
      projectId: session.projectId,
      active: session.active,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt || null,
      exitCode: session.exitCode ?? null,
      sandboxed: session.sandboxed,
      target: "approved-live-preview",
      profile: "ephemeral-isolated"
    } : null;
  }

  async function contextFor(projectId) {
    const status = browserAutomationStatus({ env, spawnSyncImpl });
    if (!status.enabled) throw Object.assign(new Error("Browser automation is disabled; set DEVMOTER_BROWSER_AUTOMATION=1 to opt in"), { statusCode: 409 });
    if (!status.available) throw Object.assign(new Error("Browser automation is enabled but no supported Chromium/Chrome binary is available"), { statusCode: 503 });
    const project = await resolveProject(String(projectId || ""));
    const preview = getPreview(project.id);
    if (!preview || !loopbackHost(preview.host)) {
      throw Object.assign(new Error("Start an approved loopback live preview for this project first"), { statusCode: 409 });
    }
    const detected = detectBrowserBinary({ env, spawnSyncImpl });
    return {
      status,
      binary: detected.binary,
      project,
      preview,
      target: "http://" + (preview.host === "::1" ? "[::1]" : preview.host) + ":" + preview.port + "/"
    };
  }

  async function prepare(profileDir, ctx, args) {
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    const wrapped = buildBubblewrapCommand({
      projectPath: ctx.project.path,
      grants: [{ path: profileDir, mode: "read-write" }],
      command: ctx.binary,
      args,
      allowNetwork: true,
      env,
      spawn: spawnSyncImpl
    });
    return wrapped;
  }

  async function stop(projectId) {
    const key = String(projectId || "");
    const session = sessions.get(key);
    if (!session) return { ok: true, session: null };
    session.active = false;
    session.stoppedAt = Date.now();
    try { session.child?.kill?.("SIGTERM"); } catch {}
    sessions.delete(key);
    await rm(session.profileDir, { recursive: true, force: true }).catch(() => {});
    return { ok: true, session: publicSession(session) };
  }

  async function start(projectId) {
    const ctx = await contextFor(projectId);
    await stop(ctx.project.id);
    await mkdir(profilesDir, { recursive: true, mode: 0o700 });
    const profileDir = join(profilesDir, randomUUID());
    const args = browserArgs(profileDir, ctx.target);
    const wrapped = await prepare(profileDir, ctx, args);
    const browserEnv = {
      ...process.env,
      HOME: profileDir,
      XDG_CONFIG_HOME: profileDir,
      XDG_CACHE_HOME: join(profileDir, "cache")
    };
    const child = spawnImpl(wrapped.command, wrapped.args, {
      cwd: ctx.project.path,
      env: browserEnv,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true
    });
    const session = {
      id: randomUUID(),
      projectId: ctx.project.id,
      active: true,
      startedAt: Date.now(),
      stoppedAt: null,
      exitCode: null,
      sandboxed: wrapped.sandboxed === true,
      child,
      profileDir
    };
    sessions.set(ctx.project.id, session);
    child.once?.("error", () => {
      session.active = false;
      session.stoppedAt = Date.now();
    });
    child.once?.("exit", code => {
      session.active = false;
      session.exitCode = code;
      session.stoppedAt = Date.now();
      if (sessions.get(ctx.project.id) === session) sessions.delete(ctx.project.id);
      void rm(profileDir, { recursive: true, force: true }).catch(() => {});
    });
    return { session: publicSession(session), status: ctx.status };
  }

  async function inspect(projectId) {
    const ctx = await contextFor(projectId);
    const active = sessions.get(ctx.project.id);
    if (!active?.active) throw Object.assign(new Error("Start browser automation before inspecting the page"), { statusCode: 409 });
    const profileDir = join(profilesDir, "inspect-" + randomUUID());
    const args = browserArgs(profileDir, ctx.target, { dumpDom: true });
    const wrapped = await prepare(profileDir, ctx, args);
    try {
      const result = await boundedProcess(spawnImpl, wrapped.command, wrapped.args, {
        cwd: ctx.project.path,
        env: {
          ...process.env,
          HOME: profileDir,
          XDG_CONFIG_HOME: profileDir,
          XDG_CACHE_HOME: join(profileDir, "cache")
        }
      });
      return {
        projectId: ctx.project.id,
        kind: "dom",
        content: result.stdout,
        truncated: result.truncated,
        sandboxed: wrapped.sandboxed === true,
        source: "approved-live-preview"
      };
    } finally {
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function status(projectId) {
    return {
      capability: browserAutomationStatus({ env, spawnSyncImpl }),
      session: publicSession(sessions.get(String(projectId || "")) || null)
    };
  }

  return { start, stop, inspect, status };
}

export const browserAutomationPolicy = Object.freeze({
  optIn: "Browser automation is disabled unless DEVMOTER_BROWSER_AUTOMATION=1.",
  target: "Only a user-started loopback live preview registered for the selected project may be opened.",
  credentials: "DevMoter uses an ephemeral profile and never mounts the user's personal browser profile or cookies.",
  filesystem: "When sandboxing is enabled, only the registered project and ephemeral profile are mounted into the browser process.",
  stop: "Every active browser session has an explicit stop operation."
});
