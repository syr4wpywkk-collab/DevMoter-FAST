import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect as connectTcp, createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildBubblewrapCommand, sandboxStatus } from "./advanced-features.mjs";
import { SANDBOX_SYSTEM_MOUNTS as SYSTEM_MOUNTS, binaryGrant, browserAutomationStatus, browserProcessEnv, detectBrowserBinary, loopbackHost, resolveExecutable } from "./browser-tool.mjs";
import { createCdpPipeConnection } from "./browser-cdp.mjs";
import { listenerConnectHost, readListenerIdentity } from "./listener-identity.mjs";

const RELAY_SCRIPT = fileURLToPath(new URL("./browser-netns-relay.mjs", import.meta.url));
const MAX_UNIX_SOCKET_PATH = 100;

// Host end of the sandbox's network: each connection Chromium opens to the
// preview address inside its empty network namespace arrives here, and is
// forwarded only while the session is live and the same process still owns
// the preview port.
export async function startPreviewRelay({ socketPath, host, port, allow }) {
  const targetHost = String(host).replace(/^\[|\]$/g, "");
  const server = createNetServer(client => {
    client.on("error", () => {});
    if (!allow()) {
      client.destroy();
      return;
    }
    const upstream = connectTcp({ host: targetHost, port });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    client.pipe(upstream).pipe(client);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600).catch(() => {});
  server.unref();
  return server;
}

const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 2,
  idleMs: 10 * 60 * 1000,
  maxLifetimeMs: 2 * 60 * 60 * 1000,
  sweepMs: 30 * 1000,
  commandTimeoutMs: 15000,
  maxTextLength: 2000,
  maxDomBytes: 512 * 1024,
  maxScreenshotBytes: 8 * 1024 * 1024,
  maxViewers: 2,
  maxQueuedActions: 8,
  maxFrameBytes: 2 * 1024 * 1024,
  frameAckTimeoutMs: 10 * 1000,
  screencastQuality: 60
});

const SCREENCAST_FRAMES_IN_FLIGHT = 2;
const SCREENCAST_REFRESH_MS = 250;
const DENIED_PERMISSIONS = Object.freeze([
  "geolocation", "notifications", "videoCapture", "audioCapture", "clipboardReadWrite",
  "clipboardSanitizedWrite", "midi", "midiSysex", "sensors", "displayCapture", "idleDetection",
  "durableStorage", "backgroundSync", "paymentHandler", "storageAccess", "windowManagement",
  "localFonts", "nfc", "wakeLockScreen", "wakeLockSystem"
]);
const KEY_DEFINITIONS = Object.freeze({
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  Escape: { code: "Escape", keyCode: 27 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 }
});
export const BROWSER_READ_ACTIONS = Object.freeze(["screenshot", "dom"]);
export const BROWSER_ACT_ACTIONS = Object.freeze(["navigate", "click", "type", "press", "scroll", "back", "forward", "reload"]);
export const DRIVER_HOLDERS = Object.freeze(["user", "agent"]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// Hostile JSON such as {"toString": 1} must not turn validation into a TypeError.
function stringField(value) {
  return typeof value === "string" ? value : "";
}

function readProcessTable() {
  const table = [];
  let entries = [];
  try { entries = readdirSync("/proc"); } catch { return null; }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync("/proc/" + name + "/stat", "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cmdline = readFileSync("/proc/" + name + "/cmdline", "utf8");
      table.push({ pid: Number(name), ppid: Number(fields[1]), startTime: fields[19], cmdline });
    } catch {
      // The process exited while the table was being read.
    }
  }
  return table;
}

/** Every descendant of `rootPid` (pid + start time, so a reused pid is never killed). */
export function processDescendants(rootPid, table) {
  if (!Number.isSafeInteger(rootPid) || !Array.isArray(table)) return [];
  const children = new Map();
  for (const entry of table) {
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry);
  }
  const result = [];
  const queue = [rootPid];
  while (queue.length) {
    for (const entry of children.get(queue.shift()) || []) {
      result.push({ pid: entry.pid, startTime: entry.startTime });
      queue.push(entry.pid);
    }
  }
  return result;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (typeof value === "boolean" || value === null || value === "" || !Number.isFinite(number)) {
    throw httpError(label + " must be a finite number", 400, "invalid_action");
  }
  return number;
}

function previewHostForUrl(host) {
  return host === "::1" || host === "[::1]" ? "[::1]" : host;
}

/**
 * Builds the navigation/request policy for a registered loopback live preview:
 * only that exact host and port may load, over http(s)/ws(s).
 */
export function createPreviewNavigationPolicy(preview) {
  if (!preview || !loopbackHost(preview.host)) throw httpError("Start an approved loopback live preview for this project first", 409, "preview_required");
  const port = Number(preview.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw httpError("Live preview port is invalid", 409, "preview_required");
  const host = previewHostForUrl(String(preview.host));
  const origin = "http://" + host + ":" + port;

  function allows(rawUrl) {
    let url;
    try { url = new URL(String(rawUrl || "")); } catch { return false; }
    if (!["http:", "ws:"].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    if (url.hostname !== host) return false;
    return Number(url.port || 80) === port;
  }

  function resolveNavigation(input) {
    const text = String(input ?? "");
    if (!text || text.length > 2048 || CONTROL_CHARS.test(text)) throw httpError("Navigation URL is invalid", 400, "invalid_action");
    let url;
    try { url = new URL(text, origin + "/"); } catch { throw httpError("Navigation URL is invalid", 400, "invalid_action"); }
    if (url.protocol !== "http:" || !allows(url.href)) {
      throw httpError("Navigation is limited to the approved live preview origin", 403, "navigation_blocked");
    }
    url.hash = url.hash.slice(0, 256);
    return url.href;
  }

  return Object.freeze({ origin, host, port, allows, resolveNavigation });
}

/** Chromium flags for a CDP-controlled session limited to one preview origin. */
export function remoteBrowserArgs(profileDir, policy) {
  const bypass = policy.host === "[::1]" ? "[::1]:" + policy.port : policy.host + ":" + policy.port;
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-client-side-phishing-detection",
    "--disable-breakpad",
    "--disable-quic",
    "--disable-features=OptimizationHints,AutofillServerCommunication,MediaRouter,Translate,InterestFeedContentSuggestions",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    // Network wall: every request goes to a dead loopback proxy except the
    // approved preview host:port. <-loopback> removes Chromium's implicit
    // loopback bypass so DevMoter itself and other local ports stay blocked.
    "--proxy-server=http://127.0.0.1:1",
    "--proxy-bypass-list=<-loopback>;" + bypass,
    "--remote-debugging-pipe",
    "--user-data-dir=" + profileDir,
    "about:blank"
  ];
}

/** Validates an action against the fixed schema; free-form commands are never accepted. */
export function normalizeBrowserAction(input, { maxTextLength = DEFAULT_LIMITS.maxTextLength, maxDomBytes = DEFAULT_LIMITS.maxDomBytes } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError("Browser action must be an object", 400, "invalid_action");
  const type = stringField(input.type);
  switch (type) {
    case "navigate": {
      if (typeof input.url !== "string") throw httpError("navigate requires url", 400, "invalid_action");
      return { type, url: input.url };
    }
    case "click": {
      if (input.selector !== undefined) {
        const selector = stringField(input.selector);
        if (!selector || selector.length > 512 || CONTROL_CHARS.test(selector)) throw httpError("click selector is invalid", 400, "invalid_action");
        return { type, selector };
      }
      return { type, x: finiteNumber(input.x, "x"), y: finiteNumber(input.y, "y") };
    }
    case "type": {
      if (typeof input.text !== "string" || !input.text) throw httpError("type requires text", 400, "invalid_action");
      if (input.text.length > maxTextLength) throw httpError("type text is too long", 413, "invalid_action");
      return { type, text: input.text };
    }
    case "press": {
      const key = stringField(input.key);
      if (!Object.hasOwn(KEY_DEFINITIONS, key)) throw httpError("press key is not allowed", 400, "invalid_action");
      return { type, key };
    }
    case "scroll": {
      const scroll = {
        type,
        dx: clamp(finiteNumber(input.dx ?? 0, "dx"), -10000, 10000),
        dy: clamp(finiteNumber(input.dy ?? 0, "dy"), -10000, 10000)
      };
      // Optional wheel origin in viewport CSS px, so the element under the finger scrolls.
      if (input.x !== undefined || input.y !== undefined) {
        scroll.x = finiteNumber(input.x, "x");
        scroll.y = finiteNumber(input.y, "y");
      }
      return scroll;
    }
    case "back":
    case "forward":
    case "reload":
      return { type };
    case "screenshot": {
      const format = input.format === "png" ? "png" : "jpeg";
      const quality = clamp(Math.round(Number(input.quality ?? 60)) || 60, 10, 90);
      return format === "png" ? { type, format } : { type, format, quality };
    }
    case "dom": {
      const limit = clamp(positiveInt(input.maxBytes, maxDomBytes), 1024, maxDomBytes);
      return { type, maxBytes: limit };
    }
    default:
      throw httpError("Unknown browser action", 400, "invalid_action");
  }
}

export function normalizeViewport(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const width = clamp(Math.round(Number(value.width)) || 390, 240, 1920);
  const height = clamp(Math.round(Number(value.height)) || 844, 240, 2400);
  const deviceScaleFactor = clamp(Number(value.deviceScaleFactor ?? value.dpr) || 2, 1, 3);
  return { width, height, deviceScaleFactor, mobile: value.mobile !== false };
}

function publicUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

/**
 * Manages CDP-controlled Chromium sessions limited to approved loopback live
 * previews. CDP stays on a private pipe; callers only get fixed-schema actions
 * gated by a driver generation number.
 */
// No project mount, its own PID namespace and an empty network namespace:
// the relay is Chromium's only way out, and it only reaches the preview.
export function buildRemoteBrowserSandbox({ projectPath, profileDir, relaySocket, binary, browserArgs, policy, env, spawnSyncImpl = spawnSync }) {
  if (relaySocket.length > MAX_UNIX_SOCKET_PATH) throw new Error("Sandbox relay socket path is too long");
  const relayDir = dirname(relaySocket);
  const grants = [
    { path: profileDir, mode: "read-write" },
    { path: relayDir, mode: "read-write" },
    { path: RELAY_SCRIPT, mode: "read-only" }
  ];
  for (const executable of [binary, process.execPath]) {
    const extra = binaryGrant(executable, env);
    if (extra && !grants.some(grant => grant.path === extra.path)) grants.push(extra);
  }
  return buildBubblewrapCommand({
    projectPath,
    projectMount: "none",
    chdir: profileDir,
    grants,
    command: process.execPath,
    args: [
      RELAY_SCRIPT, "--host", policy.host, "--port", String(policy.port), "--socket", relaySocket,
      "--", binary, ...browserArgs
    ],
    allowNetwork: false,
    unsharePid: true,
    failClosed: true,
    env,
    spawn: spawnSyncImpl
  });
}

export function createBrowserSessionManager({
  configDir,
  resolveProject,
  getPreview,
  env = process.env,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  now = Date.now,
  readPreviewListener = readListenerIdentity,
  resolvePreviewHost = listenerConnectHost,
  listProcesses = readProcessTable,
  killProcess = (pid, signal) => process.kill(pid, signal),
  limits: limitOverrides = {}
}) {
  if (typeof resolveProject !== "function" || typeof getPreview !== "function") {
    throw new Error("Browser sessions require project and preview resolvers");
  }
  const limits = {
    ...DEFAULT_LIMITS,
    maxSessions: positiveInt(env.DEVMOTER_BROWSER_MAX_SESSIONS, DEFAULT_LIMITS.maxSessions),
    ...limitOverrides
  };
  const profilesDir = join(configDir, "browser-profiles");
  const sessions = new Map();
  const starting = new Map();
  const pendingStarts = new Set();
  // Profiles kept because their Chromium could not be confirmed dead.
  const retainedProfiles = new Map();
  let sweepTimer = null;

  function publicDriver(session) {
    return { holder: session.driver.holder, generation: session.driver.generation };
  }

  function publicSession(session) {
    if (!session) return null;
    return {
      id: session.id,
      projectId: session.projectId,
      active: session.active,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      stoppedAt: session.stoppedAt,
      stopReason: session.stopReason,
      ...(session.cleanup ? { cleanup: session.cleanup } : {}),
      url: publicUrl(session.url),
      title: session.title ? String(session.title).slice(0, 300) : "",
      viewport: { ...session.viewport },
      driver: publicDriver(session),
      sandboxed: session.sandboxed,
      browser: session.browser,
      blockedRequests: session.blockedRequests,
      target: "approved-live-preview",
      profile: "ephemeral-isolated",
      transport: "cdp-pipe"
    };
  }

  function notify(session, event) {
    for (const listener of [...session.listeners]) {
      try { listener(event); } catch { /* Subscribers must not break the session. */ }
    }
    for (const viewer of [...session.viewers]) {
      try { viewer.sink.event(event); } catch { detachViewer(session, viewer); }
    }
  }

  // Frame flow control: Chromium sends the next screencast frame only after
  // its ack, and DevMoter acks only once every viewer has acked the frame it
  // was sent. A slow viewer therefore pauses capture instead of queueing frames.
  async function startScreencast(session) {
    const screencast = session.screencast;
    if (screencast.running || !session.active || !session.cdp) return;
    screencast.running = true;
    try {
      await session.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: limits.screencastQuality,
        maxWidth: session.viewport.width,
        maxHeight: session.viewport.height,
        everyNthFrame: 1
      }, { sessionId: session.cdpSessionId });
    } catch {
      screencast.running = false;
    }
  }

  function stopScreencast(session) {
    const screencast = session.screencast;
    if (!screencast.running) return;
    screencast.running = false;
    screencast.pendingAcks = [];
    clearTimeout(screencast.refreshTimer);
    if (session.cdp && !session.cdp.closed) {
      void session.cdp.send("Page.stopScreencast", {}, { sessionId: session.cdpSessionId }).catch(() => {});
    }
  }

  function ackChromiumWhenDrained(session) {
    const screencast = session.screencast;
    if (!screencast.pendingAcks.length) return;
    for (const viewer of session.viewers) if (viewer.inflight !== null) return;
    const ackIds = screencast.pendingAcks;
    screencast.pendingAcks = [];
    if (session.cdp && !session.cdp.closed) {
      for (const ackId of ackIds) {
        void session.cdp.send("Page.screencastFrameAck", { sessionId: ackId }, { sessionId: session.cdpSessionId }).catch(() => {});
      }
    }
    // Chromium drops frames while its in-flight budget is full; if the page
    // then goes still no new frame comes, so capture the final screen once.
    if (ackIds.length >= SCREENCAST_FRAMES_IN_FLIGHT) scheduleRefresh(session);
  }

  function scheduleRefresh(session) {
    const screencast = session.screencast;
    clearTimeout(screencast.refreshTimer);
    const seq = screencast.seq;
    screencast.refreshTimer = setTimeout(async () => {
      screencast.refreshTimer = null;
      if (!session.active || !screencast.running || screencast.seq !== seq || !session.cdp || session.cdp.closed) return;
      const { data = "" } = await session.cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: limits.screencastQuality,
        captureBeyondViewport: false
      }, { sessionId: session.cdpSessionId }).catch(() => ({}));
      const bytes = Buffer.from(String(data), "base64");
      if (!session.active || !screencast.running || screencast.seq !== seq || !bytes.length || bytes.length > limits.maxFrameBytes) return;
      screencast.latest = { seq: screencast.seq += 1, data: bytes, width: session.viewport.width, height: session.viewport.height };
      deliverFrame(session);
    }, SCREENCAST_REFRESH_MS);
    screencast.refreshTimer.unref?.();
  }

  function deliverFrame(session) {
    const frame = session.screencast.latest;
    if (frame && session.active) {
      for (const viewer of [...session.viewers]) {
        if (viewer.inflight !== null || viewer.lastSeq >= frame.seq) continue;
        viewer.inflight = frame.seq;
        viewer.lastSeq = frame.seq;
        viewer.sentAt = now();
        clearTimeout(viewer.ackTimer);
        viewer.ackTimer = setTimeout(() => {
          if (viewer.inflight !== null) detachViewer(session, viewer, { code: 4008, reason: "slow_consumer" });
        }, limits.frameAckTimeoutMs);
        viewer.ackTimer.unref?.();
        try { viewer.sink.frame(frame); } catch { detachViewer(session, viewer); }
      }
    }
    ackChromiumWhenDrained(session);
  }

  function detachViewer(session, viewer, { code, reason } = {}) {
    if (!session.viewers.delete(viewer)) return;
    clearTimeout(viewer.ackTimer);
    if (code) {
      try { viewer.sink.close(code, reason); } catch { /* Socket may already be closed. */ }
    }
    if (!session.viewers.size) stopScreencast(session);
    else ackChromiumWhenDrained(session);
  }

  function attachViewer(sessionId, sink, { deviceId, agentId } = {}) {
    const session = requireSession(sessionId, { deviceId, agentId });
    if (session.viewers.size >= limits.maxViewers) {
      throw httpError("Too many viewers for this browser session", 429, "viewer_limit");
    }
    const viewer = { sink, inflight: null, lastSeq: 0, sentAt: 0, ackTimer: null };
    session.viewers.add(viewer);
    session.lastActivityAt = now();
    sink.event({ t: "hello", session: publicSession(session) });
    void startScreencast(session);
    deliverFrame(session);
    return {
      ack(seq) {
        if (!session.viewers.has(viewer) || viewer.inflight !== seq) return false;
        viewer.inflight = null;
        clearTimeout(viewer.ackTimer);
        deliverFrame(session);
        return true;
      },
      detach() { detachViewer(session, viewer); }
    };
  }

  function sweepViewers(session, current) {
    for (const viewer of [...session.viewers]) {
      if (viewer.inflight !== null && current - viewer.sentAt >= limits.frameAckTimeoutMs) {
        detachViewer(session, viewer, { code: 4008, reason: "slow_consumer" });
      }
    }
  }

  function ensureSweep() {
    if (sweepTimer || !limits.sweepMs) return;
    sweepTimer = setInterval(() => { void sweep(); }, limits.sweepMs);
    sweepTimer.unref?.();
  }

  async function sweep() {
    await retryRetainedProfiles();
    const current = now();
    for (const session of [...sessions.values()]) {
      sweepViewers(session, current);
      if (!await resolveProject(session.projectId).then(Boolean, () => false)) await stopSession(session, "project_removed");
      else if (current - session.startedAt >= limits.maxLifetimeMs) await stopSession(session, "max_lifetime");
      else if (current - session.lastActivityAt >= limits.idleMs) await stopSession(session, "idle");
    }
    if (!sessions.size && !retainedProfiles.size && sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  function waitForExit(session, timeoutMs) {
    if (!session.exited) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      session.exited.then(() => { clearTimeout(timer); resolve(true); });
    });
  }

  async function stopSession(session, reason = "stopped") {
    if (!session || session.stopping) return session?.stopping || null;
    session.stopping = (async () => {
      const wasActive = session.active;
      session.active = false;
      session.cdp?.drain?.(["Browser.close", "Page.stopScreencast", "Page.screencastFrameAck"]);
      session.stoppedAt = session.stoppedAt || now();
      session.stopReason = session.stopReason || reason;
      if (sessions.get(session.projectId) === session) sessions.delete(session.projectId);
      for (const viewer of [...session.viewers]) {
        try { viewer.sink.event({ t: "closed", reason: session.stopReason }); } catch { /* Socket may already be closed. */ }
        detachViewer(session, viewer, { code: 4001, reason: session.stopReason });
      }
      // Chromium keeps writing to its profile until every process in its
      // tree exits, so the profile is deleted only after that is confirmed.
      // The tree is captured before Browser.close: once the browser exits its
      // children are reparented and can no longer be found from its pid.
      const tree = processDescendants(session.child?.pid, listProcesses());
      if (session.cdp && !session.cdp.closed) {
        await session.cdp.send("Browser.close", {}, { timeout: 2000 }).catch(() => {});
        session.cdp.close(reason);
      }
      let exited = await waitForExit(session, 2000);
      if (!exited) {
        try { session.child?.kill?.("SIGTERM"); } catch { /* Process may already be gone. */ }
        exited = await waitForExit(session, 3000);
        if (!exited) {
          try { session.child?.kill?.("SIGKILL"); } catch { /* Process may already be gone. */ }
          exited = await waitForExit(session, 2000);
        }
      }
      const survivors = await killSurvivors(tree);
      session.cleanup = exited && !survivors.length ? "complete" : "process_alive";
      if (session.cleanup === "complete") {
        await rm(session.profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      } else {
        const retained = { child: session.child, exited, tree: survivors };
        if (!exited) session.exited?.then(() => { retained.exited = true; });
        retainedProfiles.set(session.profileDir, retained);
      }
      if (wasActive) notify(session, { t: "closed", reason: session.stopReason });
      session.listeners.clear();
      return publicSession(session);
    })();
    return session.stopping;
  }

  function alive({ pid, startTime }) {
    const table = listProcesses();
    if (!table) return false;
    return table.some(entry => entry.pid === pid && entry.startTime === startTime);
  }

  // Renderer and zygote processes can outlive the browser process, so the
  // tree captured before shutdown is killed and checked again.
  async function killSurvivors(tree) {
    let survivors = tree.filter(alive);
    if (!survivors.length) return [];
    for (const entry of survivors) {
      try { killProcess(entry.pid, "SIGKILL"); } catch { /* Already gone. */ }
    }
    for (let attempt = 0; attempt < 10 && survivors.length; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      survivors = survivors.filter(alive);
    }
    return survivors;
  }

  // Retries deletion of profiles whose Chromium was still alive at stop.
  async function retryRetainedProfiles() {
    for (const [profileDir, retained] of [...retainedProfiles]) {
      if (!retained.exited) {
        try { retained.child?.kill?.("SIGKILL"); } catch { /* Already gone. */ }
        continue;
      }
      retained.tree = await killSurvivors(retained.tree);
      if (retained.tree.length) continue;
      await rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      retainedProfiles.delete(profileDir);
    }
  }

  // A previous server instance may have left Chromium processes and profiles
  // behind (crash, SIGKILL). They are killed and deleted before any start.
  async function reclaimOrphans() {
    const marker = "--user-data-dir=" + join(profilesDir, "remote-");
    const table = listProcesses() || [];
    const orphans = table.filter(entry => String(entry.cmdline || "").split("\0").some(arg => arg.startsWith(marker)));
    const survivors = await killSurvivors(orphans.map(({ pid, startTime }) => ({ pid, startTime })));
    let names = [];
    try { names = await readdir(profilesDir); } catch { /* No profiles yet. */ }
    const busy = new Set(survivors.map(entry => table.find(row => row.pid === entry.pid)?.cmdline || ""));
    let removed = 0;
    for (const name of names) {
      if (!name.startsWith("remote-")) continue;
      const dir = join(profilesDir, name);
      if ([...busy].some(cmdline => cmdline.includes("--user-data-dir=" + dir))) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      removed += 1;
    }
    return { killed: orphans.length - survivors.length, survivors: survivors.length, removedProfiles: removed };
  }
  const reclaimed = reclaimOrphans().catch(() => ({ killed: 0, survivors: 0, removedProfiles: 0 }));

  function contextFor(project) {
    const preview = getPreview(project.id);
    const policy = createPreviewNavigationPolicy(preview);
    return { preview, policy };
  }

  function findSession(sessionId) {
    const id = String(sessionId || "");
    for (const session of sessions.values()) if (session.id === id) return session;
    return null;
  }

  // A session belongs to exactly one principal: the trusted device that
  // started it, or, for an Agent Run with no device, that agent. A caller
  // naming neither is a host-side caller. An owner is never shared: a
  // session without a device owner is not visible to every device.
  function ownsSession(session, caller) {
    if (!caller || (caller.deviceId === undefined && caller.agentId === undefined)) return true;
    const deviceId = caller.deviceId ?? null;
    const agentId = deviceId ? null : caller.agentId ?? null;
    if (!deviceId && !agentId) return false;
    return session.ownerDeviceId === deviceId && session.ownerAgentId === agentId;
  }

  function requireSession(sessionId, caller) {
    const session = findSession(sessionId);
    if (!session || !session.active) throw httpError("Browser session not found", 404, "session_not_found");
    if (!ownsSession(session, caller)) {
      throw httpError("This browser session belongs to another device", 403, "session_forbidden");
    }
    return session;
  }

  function assertPreviewUnchanged(session) {
    const preview = getPreview(session.projectId);
    if (
      !preview || !loopbackHost(preview.host) ||
      previewHostForUrl(String(preview.host)) !== session.policy.host ||
      Number(preview.port) !== session.policy.port ||
      (session.previewToken && preview.token !== session.previewToken) ||
      readPreviewListener(preview.host, preview.port) !== session.previewListener
    ) {
      void stopSession(session, "preview_changed");
      throw httpError("The approved live preview changed; start a new browser session", 409, "preview_changed");
    }
  }

  async function configureBrowser(session) {
    const { cdp } = session;
    const timeout = limits.commandTimeoutMs;
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }, { timeout });
    await cdp.send("Target.setDiscoverTargets", { discover: true }, { timeout });
    const created = await cdp.send("Target.createTarget", { url: "about:blank" }, { timeout });
    if (!created?.targetId) throw httpError("Chromium did not create a page target", 502, "cdp_no_page");
    session.targetId = created.targetId;
    const { targetInfos = [] } = await cdp.send("Target.getTargets", {}, { timeout });
    for (const info of targetInfos) {
      if (info.type === "page" && info.targetId !== session.targetId) void cdp.send("Target.closeTarget", { targetId: info.targetId }).catch(() => {});
    }
    const attached = await cdp.send("Target.attachToTarget", { targetId: session.targetId, flatten: true }, { timeout });
    session.cdpSessionId = attached.sessionId;
    const opts = { sessionId: session.cdpSessionId, timeout };
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, opts);
    await cdp.send("Page.enable", {}, opts);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: session.viewport.width,
      height: session.viewport.height,
      deviceScaleFactor: session.viewport.deviceScaleFactor,
      mobile: session.viewport.mobile
    }, opts);
    for (const name of DENIED_PERMISSIONS) {
      await cdp.send("Browser.setPermission", {
        permission: { name },
        setting: "denied",
        origin: session.policy.origin
      }, { timeout }).catch(() => {});
    }
  }

  function installEventHandlers(session) {
    const { cdp } = session;
    const ownSession = sessionId => sessionId === session.cdpSessionId;
    cdp.on("Fetch.requestPaused", (params, sessionId) => {
      const allowed = session.policy.allows(params?.request?.url);
      if (!allowed) session.blockedRequests += 1;
      void cdp.send(
        allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
        allowed ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: "BlockedByClient" },
        { sessionId }
      ).catch(() => {});
    });
    cdp.on("Target.targetCreated", params => {
      const info = params?.targetInfo;
      if (!info || !session.targetId || info.targetId === session.targetId) return;
      if (["page", "tab", "background_page", "webview"].includes(info.type)) {
        void cdp.send("Target.closeTarget", { targetId: info.targetId }).catch(() => {});
      }
    });
    cdp.on("Target.targetDestroyed", params => {
      if (params?.targetId === session.targetId) void stopSession(session, "page_closed");
    });
    cdp.on("Page.javascriptDialogOpening", (_params, sessionId) => {
      if (!ownSession(sessionId)) return;
      void cdp.send("Page.handleJavaScriptDialog", { accept: false }, { sessionId }).catch(() => {});
    });
    // data:, blob: and similar schemes never reach Fetch, so main-frame
    // navigations are also checked here and pulled back to the preview.
    const outsidePreview = url => {
      const text = String(url || "");
      return !session.policy.allows(text) && text !== "about:blank" && !text.startsWith("chrome-error://");
    };
    cdp.on("Page.screencastFrame", (params, sessionId) => {
      if (!ownSession(sessionId)) return;
      const screencast = session.screencast;
      if (!screencast.running || !Number.isSafeInteger(params?.sessionId)) return;
      const data = Buffer.from(String(params.data || ""), "base64");
      // Every held frame is acked once viewers drain, so a slow viewer
      // pauses capture without losing Chromium's in-flight budget.
      screencast.pendingAcks.push(params.sessionId);
      if (!data.length || data.length > limits.maxFrameBytes) {
        ackChromiumWhenDrained(session);
        return;
      }
      screencast.latest = {
        seq: screencast.seq += 1,
        data,
        width: Math.round(Number(params.metadata?.deviceWidth) || session.viewport.width),
        height: Math.round(Number(params.metadata?.deviceHeight) || session.viewport.height)
      };
      deliverFrame(session);
    });
    cdp.on("Page.frameRequestedNavigation", (params, sessionId) => {
      if (!ownSession(sessionId) || !outsidePreview(params?.url)) return;
      session.blockedRequests += 1;
      void cdp.send("Page.stopLoading", {}, { sessionId }).catch(() => {});
    });
    cdp.on("Page.navigatedWithinDocument", (params, sessionId) => {
      if (!ownSession(sessionId) || (params?.frameId && session.mainFrameId && params.frameId !== session.mainFrameId)) return;
      if (!session.policy.allows(params?.url)) return;
      session.url = params.url;
      notify(session, { t: "meta", url: publicUrl(session.url) });
    });
    cdp.on("Page.frameNavigated", (params, sessionId) => {
      if (!ownSession(sessionId) || params?.frame?.parentId) return;
      if (outsidePreview(params.frame.url)) {
        session.blockedRequests += 1;
        void cdp.send("Page.navigate", { url: session.policy.origin + "/" }, { sessionId }).catch(() => {});
        return;
      }
      session.mainFrameId = params.frame.id || session.mainFrameId;
      session.url = params.frame.url || session.url;
      notify(session, { t: "meta", url: publicUrl(session.url) });
    });
    cdp.on("Page.loadEventFired", (_params, sessionId) => {
      if (!ownSession(sessionId)) return;
      void cdp.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }, { sessionId })
        .then(result => { session.title = String(result?.result?.value || "").slice(0, 300); })
        .catch(() => {});
    });
    cdp.onClose(reason => { void stopSession(session, "cdp_" + reason); });
  }

  // Checked before a start publishes its session: the owner must still be
  // authorized and the preview must be the one the start was for.
  function assertStartCurrent(ticket, preview) {
    if (ticket.revoked) {
      throw ticket.agentId
        ? httpError("Agent browser access revoked", 403, "agent_revoked")
        : httpError("Device authorization revoked", 403, "device_revoked");
    }
    const current = getPreview(ticket.projectId);
    if (
      ticket.cancelled || !current || current.token !== preview.token ||
      current.host !== preview.host || Number(current.port) !== Number(preview.port) ||
      readPreviewListener(current.host, current.port) !== ticket.previewListener
    ) {
      throw httpError("The approved live preview changed; start a new browser session", 409, "preview_changed");
    }
  }

  // A device revoked while its start is in flight is caught after the
  // browser is registered, so the ticket exists from the first await.
  async function start(projectId, options = {}) {
    const deviceId = options.deviceId ?? null;
    const startTicket = {
      projectId: String(projectId || ""),
      deviceId,
      agentId: deviceId ? null : options.agentId ?? null,
      revoked: false,
      cancelled: null
    };
    pendingStarts.add(startTicket);
    try {
      return await startSession(projectId, options, startTicket);
    } finally {
      pendingStarts.delete(startTicket);
    }
  }

  async function startSession(projectId, { viewport, deviceId = null, driver: initialDriver = "user", tokenId = null } = {}, startTicket) {
    await reclaimed;
    const agentId = startTicket.agentId;
    if (!deviceId && !agentId) throw httpError("A browser session needs a trusted device or an agent owner", 403, "owner_required");
    const status = browserAutomationStatus({ env, spawnSyncImpl });
    if (!status.enabled) throw httpError("Browser automation is disabled; set DEVMOTER_BROWSER_AUTOMATION=1 to opt in", 409, "browser_disabled");
    if (!status.available) throw httpError("Browser automation is enabled but no supported Chromium/Chrome binary is available", 503, "browser_unavailable");
    const project = await resolveProject(String(projectId || ""));
    startTicket.projectId = project.id;
    const { preview, policy } = contextFor(project);
    // The session is bound to the process listening on the preview port now,
    // which must be the one the preview was registered for.
    const previewListener = readPreviewListener(preview.host, preview.port);
    if (!previewListener || !preview.listener || preview.listener !== previewListener) {
      throw httpError("The approved live preview changed; start a new browser session", 409, "preview_changed");
    }
    // The relay dials this exact address: for "localhost" it is the family
    // whose listener was identified, never one picked again by DNS.
    const previewConnectHost = resolvePreviewHost(preview.host, preview.port);
    if (!previewConnectHost) {
      throw httpError("The approved live preview changed; start a new browser session", 409, "preview_changed");
    }
    startTicket.previewListener = previewListener;
    assertStartCurrent(startTicket, preview);
    if (starting.has(project.id)) throw httpError("A browser session is already starting for this project", 409, "session_starting");
    const existing = sessions.get(project.id);
    if (existing && !ownsSession(existing, { deviceId, agentId })) {
      throw httpError("Another device is using the browser for this project", 409, "session_owned_by_other_device");
    }
    // Starts still in flight count against the limit.
    const inFlight = [...starting.keys()].filter(id => !sessions.has(id)).length;
    if (sessions.size - (existing ? 1 : 0) + inFlight >= limits.maxSessions) {
      throw httpError("Too many browser sessions are running", 429, "session_limit");
    }
    starting.set(project.id, startTicket);
    try {
      if (existing) await stopSession(existing, "replaced");
      const detected = detectBrowserBinary({ env, spawnSyncImpl });
      await mkdir(profilesDir, { recursive: true, mode: 0o700 });
      const profileDir = join(profilesDir, "remote-" + randomUUID());
      await mkdir(profileDir, { recursive: true, mode: 0o700 });
      // Unix socket paths are short (108 bytes), so the relay lives in its own
      // 0700 directory under the host temp dir rather than in the profile.
      const relayDir = await mkdtemp(join(tmpdir().length < 60 ? tmpdir() : "/tmp", "devmoter-relay-"));
      await chmod(relayDir, 0o700);
      const relaySocket = join(relayDir, "s");
      const cleanupStartFiles = () => Promise.all([
        rm(profileDir, { recursive: true, force: true }).catch(() => {}),
        rm(relayDir, { recursive: true, force: true }).catch(() => {})
      ]);
      let wrapped;
      try {
        wrapped = buildRemoteBrowserSandbox({
          projectPath: project.path, profileDir, relaySocket, binary: detected.binary,
          browserArgs: remoteBrowserArgs(profileDir, policy), policy, env, spawnSyncImpl
        });
      } catch (error) {
        await cleanupStartFiles();
        throw Object.assign(error, { statusCode: 409, code: "sandbox_required" });
      }
      const owner = { session: null };
      let relay;
      try {
        relay = await startPreviewRelay({
          socketPath: relaySocket,
          host: previewConnectHost,
          port: policy.port,
          allow: () => Boolean(owner.session?.active) && readPreviewListener(preview.host, preview.port) === previewListener
        });
      } catch (error) {
        await cleanupStartFiles();
        throw httpError("Chromium could not be prepared: " + String(error?.message || error).slice(0, 300), 502, "browser_start_failed");
      }
      const child = spawnImpl(wrapped.command, wrapped.args, {
        cwd: profileDir,
        env: browserProcessEnv(env, profileDir),
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        windowsHide: true
      });
      const current = now();
      const session = {
        id: randomUUID(),
        projectId: project.id,
        ownerDeviceId: deviceId,
        ownerAgentId: agentId,
        active: true,
        stopping: null,
        startedAt: current,
        lastActivityAt: current,
        stoppedAt: null,
        stopReason: null,
        url: "about:blank",
        title: "",
        viewport: normalizeViewport(viewport),
        driver: initialDriver === "agent" ? { holder: "agent", generation: 1, deviceId: null, tokenId } : { holder: "user", generation: 1, deviceId },
        sandboxed: wrapped.sandboxed === true,
        browser: { binary: resolveExecutable(detected.binary, env) || detected.binary, version: detected.version },
        blockedRequests: 0,
        policy,
        previewToken: preview.token || null,
        previewListener,
        relay,
        child,
        profileDir,
        cdp: null,
        cdpSessionId: null,
        targetId: null,
        listeners: new Set(),
        viewers: new Set(),
        screencast: { running: false, latest: null, seq: 0, pendingAcks: [], refreshTimer: null },
        exited: null,
        cleanup: null,
        actionChain: Promise.resolve(),
        queuedActions: 0
      };
      owner.session = session;
      sessions.set(project.id, session);
      ensureSweep();
      session.exited = typeof child.once === "function"
        ? new Promise(resolve => {
          child.once("exit", resolve);
          child.once("error", resolve);
        })
        : null;
      child.once?.("error", () => { void stopSession(session, "process_error"); });
      child.once?.("exit", () => { void stopSession(session, "process_exit"); });
      const closeRelay = () => {
        relay.close();
        void rm(relayDir, { recursive: true, force: true }).catch(() => {});
      };
      if (session.exited) void session.exited.then(closeRelay);
      else child.once?.("close", closeRelay);
      try {
        const writable = child.stdio?.[3];
        const readable = child.stdio?.[4];
        session.cdp = createCdpPipeConnection({ writable, readable, timeoutMs: limits.commandTimeoutMs });
        installEventHandlers(session);
        await configureBrowser(session);
        const first = await session.cdp.send("Page.navigate", { url: policy.origin + "/" }, { sessionId: session.cdpSessionId });
        if (first?.errorText) throw new Error("Preview did not load: " + first.errorText);
        assertStartCurrent(startTicket, preview);
      } catch (caught) {
        // A start cancelled mid-way (its preview stopped, its owner revoked)
        // reports why, not the CDP failure the cancellation caused.
        let error = caught;
        try { assertStartCurrent(startTicket, preview); } catch (stale) { error = stale; }
        if (["device_revoked", "preview_changed", "agent_revoked"].includes(error?.code)) {
          await stopSession(session, error.code);
          throw error;
        }
        await stopSession(session, "start_failed");
        throw httpError("Chromium could not be prepared: " + String(error?.message || error).slice(0, 300), 502, "browser_start_failed");
      }
      return { session: publicSession(session) };
    } finally {
      starting.delete(project.id);
    }
  }

  function acquireDriver(sessionId, { holder = "user", deviceId, agentId, tokenId = null } = {}) {
    const session = requireSession(sessionId, { deviceId, agentId });
    if (!DRIVER_HOLDERS.includes(holder)) throw httpError("Unknown driver holder", 400, "invalid_driver");
    // The user always wins: acquiring as user is an immediate takeover.
    if (holder === "agent" && session.driver.holder === "user") {
      throw httpError("The user is driving this browser session", 409, "driver_busy");
    }
    session.driver = {
      holder,
      generation: session.driver.generation + 1,
      deviceId: holder === "user" ? session.ownerDeviceId : null,
      tokenId: holder === "agent" ? tokenId : null
    };
    session.lastActivityAt = now();
    notify(session, { t: "driver", ...publicDriver(session) });
    return publicDriver(session);
  }

  function releaseDriver(sessionId, { holder = "user", generation, deviceId, agentId } = {}) {
    const session = requireSession(sessionId, { deviceId, agentId });
    if (session.driver.holder !== holder || Number(generation) !== session.driver.generation) {
      throw httpError("Driver generation is stale", 409, "driver_stale");
    }
    session.driver = { holder: null, generation: session.driver.generation + 1, deviceId: null };
    notify(session, { t: "driver", ...publicDriver(session) });
    return publicDriver(session);
  }

  function assertDriver(session, { holder, generation, deviceId }) {
    const driver = session.driver;
    if (
      driver.holder !== holder ||
      !Number.isSafeInteger(Number(generation)) ||
      Number(generation) !== driver.generation ||
      (holder === "user" && driver.deviceId && deviceId !== undefined && deviceId !== driver.deviceId)
    ) {
      throw httpError("Driver generation is stale; take control again", 409, "driver_stale");
    }
  }

  async function centerOfSelector(session, selector, send) {
    const { root } = await send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector })
      .catch(() => ({ nodeId: 0 }));
    if (!nodeId) throw httpError("No element matches the selector", 404, "selector_not_found");
    await send("DOM.scrollIntoViewIfNeeded", { nodeId }).catch(() => {});
    const { model } = await send("DOM.getBoxModel", { nodeId })
      .catch(() => ({ model: null }));
    const quad = model?.content;
    if (!Array.isArray(quad) || quad.length < 8) throw httpError("Element has no visible box", 409, "selector_not_visible");
    const point = {
      x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
      y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
    };
    const { width, height } = session.viewport;
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
      throw httpError("Element is outside the viewport", 409, "selector_not_visible");
    }
    return point;
  }

  async function historyNavigate(session, offset, send) {
    const { currentIndex, entries = [] } = await send("Page.getNavigationHistory", {});
    const entry = entries[currentIndex + offset];
    if (!entry) return { ok: false, error: "no_history_entry" };
    if (!session.policy.allows(entry.url)) throw httpError("History entry is outside the approved live preview", 403, "navigation_blocked");
    await send("Page.navigateToHistoryEntry", { entryId: entry.id });
    return { ok: true };
  }

  async function runAction(session, action, guard = () => {}) {
    // Re-checked before every CDP command, so a takeover, stop or preview
    // change between two input events stops the rest of the action.
    const send = (method, params) => {
      guard();
      return session.cdp.send(method, params, { sessionId: session.cdpSessionId });
    };
    const { width, height } = session.viewport;
    switch (action.type) {
      case "navigate": {
        const url = session.policy.resolveNavigation(action.url);
        const result = await send("Page.navigate", { url });
        return result.errorText ? { ok: false, error: String(result.errorText).slice(0, 200) } : { ok: true };
      }
      case "click": {
        const point = action.selector ? await centerOfSelector(session, action.selector, send) : action;
        const x = clamp(point.x, 0, width - 1);
        const y = clamp(point.y, 0, height - 1);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        return { ok: true, x, y };
      }
      case "type":
        await send("Input.insertText", { text: action.text });
        return { ok: true, length: action.text.length };
      case "press": {
        const key = KEY_DEFINITIONS[action.key];
        const base = { key: action.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
        await send("Input.dispatchKeyEvent", key.text ? { ...base, type: "keyDown", text: key.text } : { ...base, type: "rawKeyDown" });
        await send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
        return { ok: true };
      }
      case "scroll": {
        const x = action.x === undefined ? Math.floor(width / 2) : clamp(action.x, 0, width - 1);
        const y = action.y === undefined ? Math.floor(height / 2) : clamp(action.y, 0, height - 1);
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: action.dx, deltaY: action.dy });
        return { ok: true, x, y };
      }
      case "back":
        return historyNavigate(session, -1, send);
      case "forward":
        return historyNavigate(session, 1, send);
      case "reload":
        await send("Page.reload", { ignoreCache: false });
        return { ok: true };
      case "screenshot": {
        const params = { format: action.format, captureBeyondViewport: false };
        if (action.quality) params.quality = action.quality;
        const { data = "" } = await send("Page.captureScreenshot", params);
        const bytes = Buffer.from(String(data), "base64");
        if (bytes.length > limits.maxScreenshotBytes) throw httpError("Screenshot is too large", 413, "screenshot_too_large");
        return { ok: true, mime: action.format === "png" ? "image/png" : "image/jpeg", data: bytes };
      }
      case "dom": {
        // A navigation between the two calls invalidates the root node id.
        let outerHTML = "";
        for (let attempt = 1; ; attempt += 1) {
          try {
            const { root } = await send("DOM.getDocument", { depth: 0 });
            ({ outerHTML = "" } = await send("DOM.getOuterHTML", { nodeId: root.nodeId }));
            break;
          } catch (error) {
            if (attempt >= 3 || error?.code !== "cdp_command_failed") throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        const buffer = Buffer.from(String(outerHTML), "utf8");
        const truncated = buffer.length > action.maxBytes;
        return {
          ok: true,
          kind: "dom",
          trust: "untrusted-page-content",
          content: truncated ? buffer.subarray(0, action.maxBytes).toString("utf8") : buffer.toString("utf8"),
          truncated
        };
      }
      default:
        throw httpError("Unknown browser action", 400, "invalid_action");
    }
  }

  /**
   * Runs one fixed-schema action. Mutating actions require the caller to hold
   * the current driver generation; reads only require an active session.
   */
  async function act(sessionId, rawAction, { holder = "user", generation, deviceId, agentId, authorize = null } = {}) {
    const session = requireSession(sessionId, { deviceId, agentId });
    const action = normalizeBrowserAction(rawAction, limits);
    const mutating = BROWSER_ACT_ACTIONS.includes(action.type);
    // `authorize` re-checks the caller's credential (an agent token), so a
    // queued read never runs or returns page content after it is revoked.
    const assertAuthorized = () => {
      if (authorize && !authorize()) throw httpError("A valid browser agent token is required", 401, "agent_token_invalid");
    };
    const guard = () => {
      assertAuthorized();
      if (!session.active) throw httpError("Browser session not found", 404, "session_not_found");
      if (mutating) assertDriver(session, { holder, generation, deviceId });
    };
    guard();
    assertPreviewUnchanged(session);
    if (session.queuedActions >= limits.maxQueuedActions) throw httpError("Too many browser actions are queued", 429, "browser_busy");
    // One action at a time per session: a queued action re-checks its driver
    // generation when its turn comes, so a takeover cancels everything queued.
    session.queuedActions += 1;
    const run = session.actionChain.then(() => {
      guard();
      assertPreviewUnchanged(session);
      return runAction(session, action, guard);
    });
    session.actionChain = run.then(() => {}, () => {});
    let result;
    try {
      result = await run;
    } finally {
      session.queuedActions -= 1;
    }
    assertAuthorized();
    if (mutating) session.lastActivityAt = now();
    // Viewers show where an agent clicked or scrolled.
    if (holder === "agent" && Number.isFinite(result?.x) && Number.isFinite(result?.y)) {
      notify(session, { t: "action", source: "agent", type: action.type, x: result.x, y: result.y });
    }
    return { ...result, action: action.type, session: publicSession(session) };
  }

  function status(projectId, { deviceId, agentId, capability = true } = {}) {
    const session = sessions.get(String(projectId || "")) || null;
    const visible = Boolean(session && ownsSession(session, { deviceId, agentId }));
    return {
      capability: capability ? browserAutomationStatus({ env, spawnSyncImpl }) : undefined,
      session: visible ? publicSession(session) : null,
      otherDeviceSession: Boolean(session && !visible),
      limits: { maxSessions: limits.maxSessions, idleMs: limits.idleMs, maxLifetimeMs: limits.maxLifetimeMs }
    };
  }

  function get(sessionId, { deviceId, agentId } = {}) {
    return publicSession(requireSession(sessionId, { deviceId, agentId }));
  }

  async function stop(sessionId, reason = "stopped", { deviceId, agentId } = {}) {
    const session = requireSession(sessionId, { deviceId, agentId });
    return { ok: true, session: await stopSession(session, reason) };
  }

  async function stopProject(projectId, reason = "preview_changed") {
    const id = String(projectId || "");
    // Starts still in flight for the old preview never publish a session.
    for (const ticket of pendingStarts) if (ticket.projectId === id) ticket.cancelled = reason;
    const session = sessions.get(id);
    if (session) await stopSession(session, reason);
    return { ok: true };
  }

  async function stopDevice(deviceId, reason = "device_revoked") {
    if (!deviceId) return { ok: true, stopped: 0 };
    for (const ticket of pendingStarts) if (ticket.deviceId === deviceId) ticket.revoked = true;
    const owned = [...sessions.values()].filter(session => session.ownerDeviceId === deviceId);
    await Promise.all(owned.map(session => stopSession(session, reason)));
    return { ok: true, stopped: owned.length };
  }

  // A revoked agent token stops driving at once: sessions an Agent Run owns
  // are stopped, and an agent driving a device's session with that token
  // loses the driver. Other tokens of the same device keep theirs.
  async function revokeAgent({ projectId, agentId = null, deviceId = null, tokenId = null } = {}, reason = "agent_revoked") {
    const project = String(projectId || "");
    if (agentId) for (const ticket of pendingStarts) if (ticket.agentId === agentId) ticket.revoked = true;
    const owned = agentId ? [...sessions.values()].filter(session => session.ownerAgentId === agentId) : [];
    for (const session of sessions.values()) {
      if (owned.includes(session) || session.projectId !== project || session.driver.holder !== "agent") continue;
      if (deviceId && session.ownerDeviceId !== deviceId) continue;
      if (tokenId && session.driver.tokenId && session.driver.tokenId !== tokenId) continue;
      session.driver = { holder: null, generation: session.driver.generation + 1, deviceId: null };
      notify(session, { t: "driver", ...publicDriver(session) });
    }
    await Promise.all(owned.map(session => stopSession(session, reason)));
    return { ok: true, stopped: owned.length };
  }

  async function stopAll(reason = "shutdown") {
    await Promise.all([...sessions.values()].map(session => stopSession(session, reason)));
  }

  function subscribe(sessionId, listener, { deviceId, agentId } = {}) {
    const session = requireSession(sessionId, { deviceId, agentId });
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  return { start, stop, stopProject, stopDevice, revokeAgent, stopAll, get, status, act, acquireDriver, releaseDriver, subscribe, attachViewer, sweep };
}

export const REMOTE_BROWSER_HOST_FEATURES = Object.freeze([
  "preview-origin-only",
  "ephemeral-profile",
  "bubblewrap",
  "screencast-websocket",
  "driver-takeover",
  "agent-mcp"
]);

// `bwrap --version` succeeds even where user namespaces are blocked, so start
// a trivial sandbox with the same namespace and mount setup sessions use.
function bubblewrapCanStart(spawnSyncImpl) {
  // Same namespaces as a real session, so hosts that block them report unavailable.
  const args = ["--die-with-parent", "--new-session", "--unshare-net", "--unshare-pid", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
  for (const path of SYSTEM_MOUNTS) args.push("--ro-bind-try", path, path);
  try {
    return spawnSyncImpl("bwrap", [...args, "--", "true"], { encoding: "utf8", timeout: 5000 })?.status === 0;
  } catch {
    return false;
  }
}

/**
 * Host Protocol descriptor for the remote browser, probed once at server
 * start: available only when the opt-in is set and both a Chromium/Chrome
 * binary and a working bubblewrap sandbox are present, because sessions refuse
 * to start otherwise.
 */
export function remoteBrowserHostCapability({ env = process.env, spawnSyncImpl = spawnSync } = {}) {
  const status = browserAutomationStatus({ env, spawnSyncImpl });
  if (!status.enabled) return { state: "unavailable", reason: "browser_automation_disabled" };
  if (!status.available) return { state: "unavailable", reason: "browser_binary_not_found" };
  const sandbox = sandboxStatus({ env, spawn: spawnSyncImpl });
  if (sandbox.mode === "off") return { state: "unavailable", reason: "sandbox_disabled" };
  if (!sandbox.available || !bubblewrapCanStart(spawnSyncImpl)) return { state: "unavailable", reason: "sandbox_unavailable" };
  try {
    binaryGrant(detectBrowserBinary({ env, spawnSyncImpl }).binary, env);
  } catch {
    return { state: "unavailable", reason: "sandbox_unavailable" };
  }
  return { state: "available", features: [...REMOTE_BROWSER_HOST_FEATURES] };
}

export const remoteBrowserPolicy = Object.freeze({
  optIn: "Remote browser sessions are disabled unless DEVMOTER_BROWSER_AUTOMATION=1.",
  target: "Only the user-started loopback live preview registered for the project may load; every other origin, including other loopback ports, is blocked.",
  network: "Chromium routes all traffic to a dead proxy except the preview host:port, and CDP Fetch interception fails any request outside that origin.",
  cdp: "CDP runs over a private pipe owned by DevMoter; no remote debugging port is opened and agents never receive CDP access.",
  credentials: "Each session uses a fresh 0700 profile directory that is deleted on stop; the personal browser profile is never mounted.",
  sandbox: "Remote browser sessions always run under bubblewrap and refuse to start without it; Chromium's own sandbox is never disabled.",
  device: "A session is bound to the trusted device that started it; other devices cannot read, drive or stop it.",
  driver: "Mutating actions require the current driver generation; a takeover invalidates every older generation.",
  downloads: "Downloads, popups, JavaScript dialogs and permission prompts are denied.",
  stream: "Screen frames go only over a WebSocket opened with a one-time 20-second ticket bound to the session, device, Origin and driver generation; frames are paced by viewer ACKs."
});
