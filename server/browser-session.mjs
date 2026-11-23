import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildBubblewrapCommand } from "./advanced-features.mjs";
import { browserAutomationStatus, browserProcessEnv, detectBrowserBinary, loopbackHost } from "./browser-tool.mjs";
import { createCdpPipeConnection } from "./browser-cdp.mjs";

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
  maxFrameBytes: 2 * 1024 * 1024,
  frameAckTimeoutMs: 10 * 1000,
  screencastQuality: 60
});

const SCREENCAST_FRAMES_IN_FLIGHT = 2;
const SCREENCAST_REFRESH_MS = 250;
const SYSTEM_MOUNTS = ["/usr", "/bin", "/lib", "/lib64", "/etc", "/run"];
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
  const type = String(input.type || "");
  switch (type) {
    case "navigate": {
      if (typeof input.url !== "string") throw httpError("navigate requires url", 400, "invalid_action");
      return { type, url: input.url };
    }
    case "click": {
      if (input.selector !== undefined) {
        const selector = String(input.selector);
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
      const key = String(input.key || "");
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

function resolveExecutable(binary, env) {
  if (!binary) return null;
  const candidates = isAbsolute(binary)
    ? [binary]
    : String(env.PATH || "").split(delimiter).filter(Boolean).map(dir => join(dir, binary));
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return realpathSync(candidate);
    } catch {
      // Keep searching PATH entries.
    }
  }
  return null;
}

function binaryGrant(binary, env) {
  const real = resolveExecutable(binary, env);
  if (!real) return null;
  if (SYSTEM_MOUNTS.some(root => real === root || real.startsWith(root + "/"))) return null;
  return { path: dirname(real), mode: "read-only" };
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
export function createBrowserSessionManager({
  configDir,
  resolveProject,
  getPreview,
  env = process.env,
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  now = Date.now,
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
      if (!screencast.running || screencast.seq !== seq || !session.cdp || session.cdp.closed) return;
      const { data = "" } = await session.cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: limits.screencastQuality,
        captureBeyondViewport: false
      }, { sessionId: session.cdpSessionId }).catch(() => ({}));
      const bytes = Buffer.from(String(data), "base64");
      if (!screencast.running || screencast.seq !== seq || !bytes.length || bytes.length > limits.maxFrameBytes) return;
      screencast.latest = { seq: screencast.seq += 1, data: bytes, width: session.viewport.width, height: session.viewport.height };
      deliverFrame(session);
    }, SCREENCAST_REFRESH_MS);
    screencast.refreshTimer.unref?.();
  }

  function deliverFrame(session) {
    const frame = session.screencast.latest;
    if (frame) {
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

  function attachViewer(sessionId, sink, { deviceId } = {}) {
    const session = requireSession(sessionId, deviceId);
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
    const current = now();
    for (const session of [...sessions.values()]) {
      sweepViewers(session, current);
      if (!await resolveProject(session.projectId).then(Boolean, () => false)) await stopSession(session, "project_removed");
      else if (current - session.startedAt >= limits.maxLifetimeMs) await stopSession(session, "max_lifetime");
      else if (current - session.lastActivityAt >= limits.idleMs) await stopSession(session, "idle");
    }
    if (!sessions.size && sweepTimer) {
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
      session.stoppedAt = session.stoppedAt || now();
      session.stopReason = session.stopReason || reason;
      if (sessions.get(session.projectId) === session) sessions.delete(session.projectId);
      for (const viewer of [...session.viewers]) {
        try { viewer.sink.event({ t: "closed", reason: session.stopReason }); } catch { /* Socket may already be closed. */ }
        detachViewer(session, viewer, { code: 4001, reason: session.stopReason });
      }
      if (session.cdp && !session.cdp.closed) {
        await session.cdp.send("Browser.close", {}, { timeout: 2000 }).catch(() => {});
        session.cdp.close(reason);
      }
      // Chromium keeps writing to its profile until it exits, so delete only after exit.
      if (!await waitForExit(session, 2000)) {
        try { session.child?.kill?.("SIGTERM"); } catch { /* Process may already be gone. */ }
        if (!await waitForExit(session, 3000)) {
          try { session.child?.kill?.("SIGKILL"); } catch { /* Process may already be gone. */ }
          await waitForExit(session, 2000);
        }
      }
      await rm(session.profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      if (wasActive) notify(session, { t: "closed", reason: session.stopReason });
      session.listeners.clear();
      return publicSession(session);
    })();
    return session.stopping;
  }

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

  // deviceId undefined means a host-side caller (e.g. the PR4 agent bridge);
  // any trusted-device caller must be the device that started the session.
  function requireSession(sessionId, deviceId) {
    const session = findSession(sessionId);
    if (!session || !session.active) throw httpError("Browser session not found", 404, "session_not_found");
    if (deviceId !== undefined && session.ownerDeviceId && deviceId !== session.ownerDeviceId) {
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
      (session.previewToken && preview.token !== session.previewToken)
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

  // A device revoked while its start is in flight is caught after the
  // browser is registered, so the ticket exists from the first await.
  async function start(projectId, options = {}) {
    const startTicket = { deviceId: options.deviceId ?? null, revoked: false };
    pendingStarts.add(startTicket);
    try {
      return await startSession(projectId, options, startTicket);
    } finally {
      pendingStarts.delete(startTicket);
    }
  }

  async function startSession(projectId, { viewport, deviceId = null, driver: initialDriver = "user" } = {}, startTicket) {
    const status = browserAutomationStatus({ env, spawnSyncImpl });
    if (!status.enabled) throw httpError("Browser automation is disabled; set DEVMOTER_BROWSER_AUTOMATION=1 to opt in", 409, "browser_disabled");
    if (!status.available) throw httpError("Browser automation is enabled but no supported Chromium/Chrome binary is available", 503, "browser_unavailable");
    const project = await resolveProject(String(projectId || ""));
    const { preview, policy } = contextFor(project);
    if (starting.has(project.id)) throw httpError("A browser session is already starting for this project", 409, "session_starting");
    const existing = sessions.get(project.id);
    if (existing && existing.ownerDeviceId && existing.ownerDeviceId !== deviceId) {
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
      const grants = [{ path: profileDir, mode: "read-write" }];
      const extra = binaryGrant(detected.binary, env);
      if (extra) grants.push(extra);
      let wrapped;
      try {
        wrapped = buildBubblewrapCommand({
          projectPath: project.path,
          grants,
          command: detected.binary,
          args: remoteBrowserArgs(profileDir, policy),
          allowNetwork: true,
          failClosed: true,
          env,
          spawn: spawnSyncImpl
        });
      } catch (error) {
        await rm(profileDir, { recursive: true, force: true }).catch(() => {});
        throw Object.assign(error, { statusCode: 409, code: "sandbox_required" });
      }
      const child = spawnImpl(wrapped.command, wrapped.args, {
        cwd: project.path,
        env: browserProcessEnv(env, profileDir),
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        windowsHide: true
      });
      const current = now();
      const session = {
        id: randomUUID(),
        projectId: project.id,
        ownerDeviceId: deviceId,
        active: true,
        stopping: null,
        startedAt: current,
        lastActivityAt: current,
        stoppedAt: null,
        stopReason: null,
        url: "about:blank",
        title: "",
        viewport: normalizeViewport(viewport),
        driver: initialDriver === "agent" ? { holder: "agent", generation: 1, deviceId: null } : { holder: "user", generation: 1, deviceId },
        sandboxed: wrapped.sandboxed === true,
        browser: { binary: resolveExecutable(detected.binary, env) || detected.binary, version: detected.version },
        blockedRequests: 0,
        policy,
        previewToken: preview.token || null,
        child,
        profileDir,
        cdp: null,
        cdpSessionId: null,
        targetId: null,
        listeners: new Set(),
        viewers: new Set(),
        screencast: { running: false, latest: null, seq: 0, pendingAcks: [], refreshTimer: null },
        exited: null
      };
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
      try {
        const writable = child.stdio?.[3];
        const readable = child.stdio?.[4];
        session.cdp = createCdpPipeConnection({ writable, readable, timeoutMs: limits.commandTimeoutMs });
        installEventHandlers(session);
        await configureBrowser(session);
        const first = await session.cdp.send("Page.navigate", { url: policy.origin + "/" }, { sessionId: session.cdpSessionId });
        if (first?.errorText) throw new Error("Preview did not load: " + first.errorText);
        if (startTicket.revoked) throw httpError("Device authorization revoked", 403, "device_revoked");
      } catch (error) {
        if (error?.code === "device_revoked") {
          await stopSession(session, "device_revoked");
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

  function acquireDriver(sessionId, { holder = "user", deviceId } = {}) {
    const session = requireSession(sessionId, deviceId);
    if (!DRIVER_HOLDERS.includes(holder)) throw httpError("Unknown driver holder", 400, "invalid_driver");
    // The user always wins: acquiring as user is an immediate takeover.
    if (holder === "agent" && session.driver.holder === "user") {
      throw httpError("The user is driving this browser session", 409, "driver_busy");
    }
    session.driver = { holder, generation: session.driver.generation + 1, deviceId: holder === "user" ? deviceId ?? session.ownerDeviceId : null };
    session.lastActivityAt = now();
    notify(session, { t: "driver", ...publicDriver(session) });
    return publicDriver(session);
  }

  function releaseDriver(sessionId, { holder = "user", generation, deviceId } = {}) {
    const session = requireSession(sessionId, deviceId);
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

  async function centerOfSelector(session, selector) {
    const opts = { sessionId: session.cdpSessionId };
    const { root } = await session.cdp.send("DOM.getDocument", { depth: 0 }, opts);
    const { nodeId } = await session.cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector }, opts)
      .catch(() => ({ nodeId: 0 }));
    if (!nodeId) throw httpError("No element matches the selector", 404, "selector_not_found");
    await session.cdp.send("DOM.scrollIntoViewIfNeeded", { nodeId }, opts).catch(() => {});
    const { model } = await session.cdp.send("DOM.getBoxModel", { nodeId }, opts)
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

  async function historyNavigate(session, offset) {
    const opts = { sessionId: session.cdpSessionId };
    const { currentIndex, entries = [] } = await session.cdp.send("Page.getNavigationHistory", {}, opts);
    const entry = entries[currentIndex + offset];
    if (!entry) return { ok: false, error: "no_history_entry" };
    if (!session.policy.allows(entry.url)) throw httpError("History entry is outside the approved live preview", 403, "navigation_blocked");
    await session.cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, opts);
    return { ok: true };
  }

  async function runAction(session, action) {
    const send = (method, params) => session.cdp.send(method, params, { sessionId: session.cdpSessionId });
    const { width, height } = session.viewport;
    switch (action.type) {
      case "navigate": {
        const url = session.policy.resolveNavigation(action.url);
        const result = await send("Page.navigate", { url });
        return result.errorText ? { ok: false, error: String(result.errorText).slice(0, 200) } : { ok: true };
      }
      case "click": {
        const point = action.selector ? await centerOfSelector(session, action.selector) : action;
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
        return historyNavigate(session, -1);
      case "forward":
        return historyNavigate(session, 1);
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
  async function act(sessionId, rawAction, { holder = "user", generation, deviceId } = {}) {
    const session = requireSession(sessionId, deviceId);
    const action = normalizeBrowserAction(rawAction, limits);
    const mutating = BROWSER_ACT_ACTIONS.includes(action.type);
    if (mutating) assertDriver(session, { holder, generation, deviceId });
    assertPreviewUnchanged(session);
    const result = await runAction(session, action);
    if (mutating) session.lastActivityAt = now();
    // Viewers show where an agent clicked or scrolled.
    if (holder === "agent" && Number.isFinite(result?.x) && Number.isFinite(result?.y)) {
      notify(session, { t: "action", source: "agent", type: action.type, x: result.x, y: result.y });
    }
    return { ...result, action: action.type, session: publicSession(session) };
  }

  function status(projectId, { deviceId, capability = true } = {}) {
    const session = sessions.get(String(projectId || "")) || null;
    const visible = session && (deviceId === undefined || !session.ownerDeviceId || session.ownerDeviceId === deviceId);
    return {
      capability: capability ? browserAutomationStatus({ env, spawnSyncImpl }) : undefined,
      session: visible ? publicSession(session) : null,
      otherDeviceSession: Boolean(session && !visible),
      limits: { maxSessions: limits.maxSessions, idleMs: limits.idleMs, maxLifetimeMs: limits.maxLifetimeMs }
    };
  }

  function get(sessionId, { deviceId } = {}) {
    return publicSession(requireSession(sessionId, deviceId));
  }

  async function stop(sessionId, reason = "stopped", { deviceId } = {}) {
    const session = requireSession(sessionId, deviceId);
    return { ok: true, session: await stopSession(session, reason) };
  }

  async function stopProject(projectId, reason = "preview_changed") {
    const session = sessions.get(String(projectId || ""));
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

  async function stopAll(reason = "shutdown") {
    await Promise.all([...sessions.values()].map(session => stopSession(session, reason)));
  }

  function subscribe(sessionId, listener, { deviceId } = {}) {
    const session = requireSession(sessionId, deviceId);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  return { start, stop, stopProject, stopDevice, stopAll, get, status, act, acquireDriver, releaseDriver, subscribe, attachViewer, sweep };
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
