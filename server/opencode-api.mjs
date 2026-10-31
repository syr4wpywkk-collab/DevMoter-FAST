// One client for DevMoter's server-side calls to the OpenCode HTTP API.
//
// It owns three things every caller needs to agree on:
//   1. fetchJson: authenticated JSON requests that fail clearly when OpenCode
//      answers with something other than JSON (OpenCode 2.x serves its web UI
//      for unknown paths, so a removed route looks like an HTML 200).
//   2. info(): the OpenCode API generation, detected from the version endpoint
//      each generation documents — GET /api/info (2.x) and GET /global/health
//      (1.x) — and cached until OpenCode goes offline or the cache expires.
//   3. Generation-aware helpers built on src/opencode-api-shapes.mjs.

import {
  normalizeOpenCodeQuestions,
  openCodeGenerationFromVersion,
  openCodePermissionListPath,
  openCodeQuestionListPath,
  OPENCODE_API_V1,
  OPENCODE_API_V2
} from "../src/opencode-api-shapes.mjs";

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

export function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
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
    let upstream;
    try {
      upstream = await fetchImpl(new URL(path, baseUrl), {
        ...init,
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

  async function pendingRequests(sessionId, { headers: extra = {}, signal } = {}) {
    const { generation } = await info();
    const timeout = () => signal || AbortSignal.timeout(2500);
    const [permissions, questions] = await Promise.all([
      fetchJson("/api" + openCodePermissionListPath(sessionId), { headers: extra, signal: timeout() }).then(listOf),
      fetchJson("/api" + openCodeQuestionListPath(generation, sessionId), { headers: extra, signal: timeout() })
        .then(payload => normalizeOpenCodeQuestions(generation, payload))
    ]);
    return { permissions, questions };
  }

  // Catalog routes shared by both generations; /api/model/default is 2.x only.
  async function catalogInputs({ signal } = {}) {
    const { generation, version } = await info();
    const timeout = () => signal || AbortSignal.timeout(15000);
    const [providers, models, integrations, defaultModel] = await Promise.all([
      fetchJson("/api/provider", { signal: timeout() }),
      fetchJson("/api/model", { signal: timeout() }),
      fetchJson("/api/integration", { signal: timeout() }),
      generation === OPENCODE_API_V2 ? fetchJson("/api/model/default", { signal: timeout() }) : null
    ]);
    return { generation, version, providers, models, integrations, defaultModel };
  }

  return { fetchJson, info, invalidate, pendingRequests, catalogInputs };
}
