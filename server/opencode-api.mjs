// One client for DevMoter's server-side calls to the OpenCode HTTP API.
//
// It owns three things every caller needs to agree on:
//   1. fetchJson: authenticated JSON requests that fail clearly when OpenCode
//      answers with something other than JSON (OpenCode 2.x serves its web UI
//      for unknown paths, so a removed route looks like an HTML 200).
//   2. info(): the OpenCode API generation, detected from the version endpoint
//      each generation documents — GET /api/info (2.x) and GET /global/health
//      (1.x) — and cached until OpenCode goes offline or the cache expires.
//   3. The DevMoter session operations (prompt, context, status, interrupt,
//      permissions, questions), translated per generation by
//      server/opencode-adapter.mjs. Callers never see a generation.

import {
  buildOpenCodePermissionReply,
  buildOpenCodePromptRequests,
  buildOpenCodeQuestionReject,
  buildOpenCodeQuestionReply,
  classicMessagesToContext,
  listOf,
  mergeOpenCodeContexts,
  normalizeOpenCodeActive,
  normalizeOpenCodePermissions,
  normalizeOpenCodeQuestions,
  openCodeActivePath,
  openCodeEventPath,
  openCodeGenerationFromVersion,
  openCodeInterruptRequest,
  openCodePermissionListPath,
  openCodeQuestionDetailPath,
  openCodeQuestionListPath,
  OPENCODE_API_V1,
  OPENCODE_API_V2
} from "./opencode-adapter.mjs";

export { listOf };

export const OPENCODE_INFO_TTL_MS = 60_000;

// Each generation's own version endpoint. Both are probed together; whichever
// answers with a JSON `version` identifies the server.
const VERSION_ENDPOINTS = Object.freeze([
  { path: "/api/info", expects: OPENCODE_API_V2 },
  { path: "/global/health", expects: OPENCODE_API_V1 }
]);

function isJsonContentType(value) {
  const type = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}

function isConnectivityError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.status !== undefined) return false;
  return error.name === "TypeError" || error.name === "AbortError" || error.name === "TimeoutError" ||
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|fetch failed/i.test(String(error.message || "") + String(error.cause?.code || ""));
}

export function createOpenCodeClient({
  baseUrl,
  headers = extra => extra,
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  infoTtlMs = OPENCODE_INFO_TTL_MS
}) {
  let cached = null;
  let inflight = null;

  function invalidate() {
    cached = null;
  }

  async function fetchJson(path, init = {}) {
    const base = new URL(baseUrl);
    const rawPath = String(path || "");
    if (!rawPath.startsWith("/") || rawPath.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(rawPath)) {
      throw new Error(`Invalid OpenCode request path: ${rawPath}`);
    }
    const targetUrl = new URL(rawPath, base);
    if (targetUrl.origin !== base.origin) {
      throw new Error(`Invalid OpenCode request path: ${rawPath}`);
    }
    let upstream;
    try {
      upstream = await fetchImpl(targetUrl, {
        ...init,
        redirect: "error",
        headers: headers({ accept: "application/json", ...(init.headers || {}) }),
        signal: init.signal || AbortSignal.timeout(4000)
      });
    } catch (error) {
      if (isConnectivityError(error)) invalidate();
      throw error;
    }

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";

    let payload = null;
    if (text) {
      if (!isJsonContentType(contentType)) {
        const preview = text.slice(0, 160).replace(/\s+/g, " ");
        const error = new Error(
          `OpenCode answered ${path} with ${contentType || "an unknown content-type"} instead of JSON (HTTP ${upstream.status}); ` +
          `this route does not exist on the running OpenCode version: ${preview}`
        );
        error.status = upstream.status;
        error.contentType = contentType;
        throw error;
      }
      try {
        payload = JSON.parse(text);
      } catch {
        const preview = text.slice(0, 160).replace(/\s+/g, " ");
        const error = new Error(`OpenCode returned malformed JSON for ${path} (HTTP ${upstream.status}): ${preview}`);
        error.status = upstream.status;
        error.contentType = contentType;
        throw error;
      }
    }

    if (!upstream.ok) {
      const error = new Error(
        payload?.error?.data?.message ||
        payload?.error?.message ||
        payload?.message ||
        `OpenCode HTTP ${upstream.status} for ${path}`
      );
      error.status = upstream.status;
      throw error;
    }

    return payload;
  }

  async function detect() {
    const probes = await Promise.allSettled(
      VERSION_ENDPOINTS.map(endpoint => fetchJson(endpoint.path, { signal: AbortSignal.timeout(2500) }))
    );
    const failures = [];
    for (let index = 0; index < VERSION_ENDPOINTS.length; index += 1) {
      const endpoint = VERSION_ENDPOINTS[index];
      const probe = probes[index];
      if (probe.status === "rejected") {
        failures.push(`${endpoint.path}: ${probe.reason?.message || probe.reason}`);
        continue;
      }
      const version = probe.value?.version;
      if (typeof version !== "string" || !version) {
        failures.push(`${endpoint.path}: no version field`);
        continue;
      }
      const generation = openCodeGenerationFromVersion(version);
      if (generation !== endpoint.expects) {
        failures.push(`${endpoint.path}: reported ${version}, which is not a ${endpoint.expects} server`);
        continue;
      }
      return { generation, version, source: endpoint.path };
    }
    const error = new Error("Could not detect the OpenCode API version (" + failures.join("; ") + ")");
    error.status = 502;
    throw error;
  }

  async function info({ refresh = false } = {}) {
    if (!refresh && cached && now() - cached.at < infoTtlMs) return cached.value;
    if (!refresh && inflight) return inflight;
    const flight = detect().then(value => {
      cached = { at: now(), value };
      return value;
    });
    inflight = flight;
    try {
      return await flight;
    } finally {
      if (inflight === flight) inflight = null;
    }
  }

  async function send(spec, { headers: extra = {}, signal } = {}) {
    return fetchJson(spec.path, {
      method: spec.method,
      headers: { ...(spec.body ? { "content-type": "application/json" } : {}), ...extra },
      ...(spec.body ? { body: JSON.stringify(spec.body) } : {}),
      ...(signal ? { signal } : {})
    });
  }

  const sessionPath = sessionID => "/api/session/" + encodeURIComponent(String(sessionID));

  async function session(sessionID, options = {}) {
    const payload = await fetchJson(sessionPath(sessionID), { headers: options.headers || {}, ...(options.signal ? { signal: options.signal } : {}) });
    return payload?.data !== undefined ? payload.data : payload;
  }

  /** Create a session; `body` is { agent?, model?: { id, providerID } } on both generations. */
  async function createSession(body = {}, { headers: extra = {}, signal } = {}) {
    const payload = await send({ method: "POST", path: "/api/session", body }, { headers: extra, signal });
    return payload?.data !== undefined ? payload.data : payload;
  }

  /** Deliver a DevMoter prompt ({ text, model?, agent?, delivery? }). */
  async function prompt(sessionID, input, { headers: extra = {}, signal, readOnlyTools = null } = {}) {
    const { generation } = await info();
    // The session supplies the model/agent a prompt does not name (1.x), and
    // lets 2.x skip re-selecting what the session already uses.
    const needsSession = generation === OPENCODE_API_V2 ? Boolean(input.model || input.agent) : !(input.model && input.agent);
    const current = needsSession ? await session(sessionID, { headers: extra }).catch(() => null) : null;
    let result = null;
    for (const spec of buildOpenCodePromptRequests(generation, sessionID, input, { session: current, readOnlyTools })) {
      result = await send(spec, { headers: extra, signal });
    }
    return result;
  }

  async function active({ headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    const payload = await fetchJson(openCodeActivePath(generation), { headers: extra, ...(signal ? { signal } : {}) });
    return normalizeOpenCodeActive(generation, payload);
  }

  async function context(sessionID, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    const timeout = () => signal || AbortSignal.timeout(15000);
    if (generation === OPENCODE_API_V2) {
      return listOf(await fetchJson(sessionPath(sessionID) + "/context", { headers: extra, signal: timeout() }));
    }
    const [messages, status, earlier] = await Promise.all([
      fetchJson("/session/" + encodeURIComponent(String(sessionID)) + "/message", { headers: extra, signal: timeout() }),
      fetchJson(openCodeActivePath(generation), { headers: extra, signal: timeout() }).catch(() => ({})),
      // Turns an earlier DevMoter release sent through the 1.x new runner.
      fetchJson(sessionPath(sessionID) + "/context", { headers: extra, signal: timeout() }).then(listOf).catch(() => [])
    ]);
    const busy = Boolean(normalizeOpenCodeActive(generation, status)[String(sessionID)]);
    return mergeOpenCodeContexts(earlier, classicMessagesToContext(messages, { busy }));
  }

  async function interrupt(sessionID, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    await send(openCodeInterruptRequest(generation, sessionID), { headers: extra, signal });
  }

  async function permissions(sessionID, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    const payload = await fetchJson(openCodePermissionListPath(generation, sessionID), { headers: extra, signal: signal || AbortSignal.timeout(2500) });
    return normalizeOpenCodePermissions(generation, sessionID, payload);
  }

  async function replyPermission(sessionID, requestID, decision, message, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    await send(buildOpenCodePermissionReply(generation, sessionID, requestID, decision, message), { headers: extra, signal });
  }

  async function questions(sessionID, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    const payload = await fetchJson(openCodeQuestionListPath(generation, sessionID), { headers: extra, signal: signal || AbortSignal.timeout(2500) });
    return normalizeOpenCodeQuestions(generation, sessionID, payload);
  }

  async function replyQuestion(sessionID, requestID, answers, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    const detail = openCodeQuestionDetailPath(generation, sessionID, requestID);
    const form = detail ? await fetchJson(detail, { headers: extra, ...(signal ? { signal } : {}) }) : null;
    await send(buildOpenCodeQuestionReply(generation, sessionID, requestID, answers, form), { headers: extra, signal });
  }

  async function rejectQuestion(sessionID, requestID, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    await send(buildOpenCodeQuestionReject(generation, sessionID, requestID), { headers: extra, signal });
  }

  async function pendingRequests(sessionID, options = {}) {
    const [permissionList, questionList] = await Promise.all([permissions(sessionID, options), questions(sessionID, options)]);
    return { permissions: permissionList, questions: questionList };
  }

  /** Resolve once the session stops executing (or `signal` aborts). */
  async function waitForIdle(sessionID, { headers: extra = {}, signal, pollMs = 750 } = {}) {
    const id = String(sessionID);
    // A prompt is admitted before the run shows as active; give it a moment.
    let seenActive = false;
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted?.();
      const running = Boolean((await active({ headers: extra }))[id]);
      if (running) seenActive = true;
      else if (seenActive || attempt >= 3) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, pollMs);
        signal?.addEventListener?.("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("aborted"));
        }, { once: true });
      });
    }
  }

  async function eventPath() {
    return openCodeEventPath((await info()).generation);
  }

  // Catalog: the shared /api routes give model metadata on both generations;
  // /api/model/default is 2.x only. On 1.x DevMoter runs prompts on the classic
  // runner, so GET /provider (the runner's own catalog) says which models run.
  async function catalogInputs({ signal } = {}) {
    const { generation, version } = await info();
    const timeout = () => signal || AbortSignal.timeout(15000);
    const [providers, models, integrations, defaultModel, runnerCatalog] = await Promise.all([
      fetchJson("/api/provider", { signal: timeout() }),
      fetchJson("/api/model", { signal: timeout() }),
      fetchJson("/api/integration", { signal: timeout() }),
      generation === OPENCODE_API_V2 ? fetchJson("/api/model/default", { signal: timeout() }) : null,
      generation === OPENCODE_API_V1 ? fetchJson("/provider", { signal: timeout() }) : null
    ]);
    return { generation, version, providers, models, integrations, defaultModel, runnerCatalog };
  }

  return {
    fetchJson,
    info,
    invalidate,
    session,
    createSession,
    prompt,
    active,
    context,
    interrupt,
    permissions,
    replyPermission,
    questions,
    replyQuestion,
    rejectQuestion,
    pendingRequests,
    waitForIdle,
    eventPath,
    catalogInputs
  };
}
