import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildBubblewrapCommand } from "./advanced-features.mjs";

const OUTPUT_LIMIT = 512 * 1024;
const PROCESS_TIMEOUT_MS = 15000;

const BROWSER_ENV_KEYS = ["PATH", "LANG", "LANGUAGE", "TZ", "FONTCONFIG_PATH", "FONTCONFIG_FILE", "TMPDIR"];

// Chromium handles untrusted page content, so it gets an allowlisted
// environment instead of the server's (API keys and tokens stay out).
export function browserProcessEnv(env, profileDir) {
  const result = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value !== "string") continue;
    if (BROWSER_ENV_KEYS.includes(key) || key.startsWith("LC_")) result[key] = value;
  }
  return {
    ...result,
    HOME: profileDir,
    XDG_CONFIG_HOME: profileDir,
    XDG_CACHE_HOME: join(profileDir, "cache")
  };
}

export function deadProxyArgs(host, port) {
  const bypassHost = String(host).includes(":") && !String(host).startsWith("[") ? "[" + host + "]" : String(host);
  return [
    "--proxy-server=http://127.0.0.1:1",
    "--proxy-bypass-list=<-loopback>;" + bypassHost + ":" + port,
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp"
  ];
}

export function loopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export function browserCandidates(env = process.env) {
  return [
    String(env.DEVMOTER_BROWSER_BIN || "").trim(),
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable"
  ].filter(Boolean);
}

export function detectBrowserBinary({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
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

function browserArgs(profileDir, target, { dumpDom = false, preview } = {}) {
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
    ...deadProxyArgs(preview.host, preview.port),
    "--user-data-dir=" + profileDir
  ];
  // No TCP debugging port: the long-running browser keeps a private CDP pipe.
  if (dumpDom) args.push("--dump-dom");
  else args.push("--remote-debugging-pipe");
  args.push(target);
  return args;
}

function watchExit(child) {
  let done = false;
  const exited = new Promise(resolve => {
    const finish = () => { done = true; resolve(); };
    child?.once?.("exit", finish);
    child?.once?.("error", finish);
  });
  return { exited, get done() { return done; } };
}

function waitWithin(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

// SIGTERM, then SIGKILL; resolves true only once the process has exited.
export async function terminateProcess(child, watcher, { termMs = 3000, killMs = 2000 } = {}) {
  if (!child || watcher.done) return true;
  try { child.kill?.("SIGTERM"); } catch { /* Already gone. */ }
  if (await waitWithin(watcher.exited, termMs)) return true;
  try { child.kill?.("SIGKILL"); } catch { /* Already gone. */ }
  return waitWithin(watcher.exited, killMs);
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
    const watcher = watchExit(child);
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      // The caller deletes the profile after rejection, so wait for exit first.
      const exited = await terminateProcess(child, watcher, options.termination);
      reject(Object.assign(new Error("Browser inspection timed out"), { exited }));
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
  spawnSyncImpl = spawnSync,
  inspectTimeoutMs = PROCESS_TIMEOUT_MS,
  termination = { termMs: 3000, killMs: 2000 }
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
    try {
      return buildBubblewrapCommand({
        projectPath: ctx.project.path,
        grants: [{ path: profileDir, mode: "read-write" }],
        command: ctx.binary,
        args,
        allowNetwork: true,
        failClosed: true,
        env,
        spawn: spawnSyncImpl
      });
    } catch (error) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  // start/stop for one project run one at a time so a stop cannot race a
  // half-started browser and a start cannot reuse a profile being deleted.
  const locks = new Map();
  function serialized(projectId, task) {
    const key = String(projectId || "");
    const previous = locks.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    const tail = next.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return next;
  }

  async function stopUnlocked(key) {
    const session = sessions.get(key);
    if (!session) return { ok: true, session: null };
    session.active = false;
    session.stoppedByUser = true;
    session.stoppedAt = Date.now();
    const exited = await terminateProcess(session.child, session.watcher, termination);
    if (sessions.get(key) === session) sessions.delete(key);
    if (!exited) {
      // Chromium is still writing to the profile; keep it and report the failure.
      return { ok: false, cleanup: "process_alive", session: publicSession(session) };
    }
    await rm(session.profileDir, { recursive: true, force: true }).catch(() => {});
    return { ok: true, session: publicSession(session) };
  }

  function stop(projectId) {
    const key = String(projectId || "");
    return serialized(key, () => stopUnlocked(key));
  }

  async function start(projectId) {
    const ctx = await contextFor(projectId);
    return serialized(ctx.project.id, () => startUnlocked(ctx));
  }

  async function startUnlocked(ctx) {
    const stopped = await stopUnlocked(ctx.project.id);
    if (stopped.ok === false) {
      throw Object.assign(new Error("The previous browser process did not exit"), { statusCode: 409, code: "process_alive" });
    }
    await mkdir(profilesDir, { recursive: true, mode: 0o700 });
    const profileDir = join(profilesDir, randomUUID());
    const args = browserArgs(profileDir, ctx.target, { preview: ctx.preview });
    const wrapped = await prepare(profileDir, ctx, args);
    const child = spawnImpl(wrapped.command, wrapped.args, {
      cwd: ctx.project.path,
      env: browserProcessEnv(process.env, profileDir),
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
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
      watcher: watchExit(child),
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
      if (!session.stoppedByUser) void rm(profileDir, { recursive: true, force: true }).catch(() => {});
    });
    return { session: publicSession(session), status: ctx.status };
  }

  async function inspect(projectId) {
    const ctx = await contextFor(projectId);
    const active = sessions.get(ctx.project.id);
    if (!active?.active) throw Object.assign(new Error("Start browser automation before inspecting the page"), { statusCode: 409 });
    const profileDir = join(profilesDir, "inspect-" + randomUUID());
    const args = browserArgs(profileDir, ctx.target, { dumpDom: true, preview: ctx.preview });
    const wrapped = await prepare(profileDir, ctx, args);
    let keepProfile = false;
    try {
      const result = await boundedProcess(spawnImpl, wrapped.command, wrapped.args, {
        cwd: ctx.project.path,
        env: browserProcessEnv(process.env, profileDir),
        timeoutMs: inspectTimeoutMs,
        termination
      }).catch(error => {
        if (error.exited === false) keepProfile = true;
        throw error;
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
      if (!keepProfile) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
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
  network: "All traffic except the approved preview host:port goes to a dead proxy; no TCP remote debugging port is opened.",
  sandbox: "The browser refuses to start without bubblewrap.",
  credentials: "DevMoter uses an ephemeral profile and never mounts the user's personal browser profile or cookies.",
  filesystem: "When sandboxing is enabled, only the registered project and ephemeral profile are mounted into the browser process.",
  stop: "Every active browser session has an explicit stop operation."
});
