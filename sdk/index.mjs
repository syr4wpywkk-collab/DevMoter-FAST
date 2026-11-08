import { randomUUID } from "node:crypto";

// Capture the runtime fetch once; SDK callers cannot replace the credentialed transport per client.
const sdkNativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

export const DEVMOTER_API_VERSION = 1;

export class DevMoterError extends Error {
  constructor(message, { status = 0, code = "request_failed", data = null } = {}) {
    super(message);
    this.name = "DevMoterError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function assertSafePathSyntax(pathname) {
  if (pathname.includes("\\") || pathname.includes("\0")) {
    throw new Error("Backslashes and NUL are not allowed in API paths");
  }
  let decoded = pathname;
  for (let depth = 0; depth < 8; depth += 1) {
    if (/%(?![0-9a-f]{2})/i.test(decoded)) throw new Error("Malformed percent-encoding in API path");
    if (/%(?:2e|2f|5c)/i.test(decoded)) throw new Error("Encoded dot, slash, or backslash is not allowed in API paths");
    let next;
    try { next = decodeURIComponent(decoded); }
    catch { throw new Error("Malformed percent-encoding in API path"); }
    if (next.includes("\\") || next.includes("\0") || next.split("/").some(part => part === "." || part === "..")) {
      throw new Error("Dot segments and backslashes are not allowed in API paths");
    }
    if (next === decoded) return;
    decoded = next;
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) throw new Error("Nested percent-encoding is not allowed in API paths");
}

function buildApiUrl(baseUrl, path) {
  const raw = String(path);
  if (!raw || raw !== raw.trim() || /[\u0000-\u001f\u007f]/.test(raw) || raw.includes("#")) {
    throw new Error("Invalid API request path");
  }
  const queryIndex = raw.indexOf("?");
  let pathname = queryIndex < 0 ? raw : raw.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : raw.slice(queryIndex);
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathname)) throw new Error("Absolute API URLs are not allowed");
  if (pathname.startsWith("//") || pathname.startsWith("\\\\")) throw new Error("Network-path API URLs are not allowed");
  if (pathname.startsWith("/")) pathname = pathname.slice(1);
  assertSafePathSyntax(pathname);
  if (pathname.split("/").some(part => part === "")) throw new Error("Empty API path segments are not allowed");

  const url = new URL(pathname + query, baseUrl);
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
    throw new Error("DevMoter request path must stay within the configured origin and base path");
  }
  return url;
}

function assertNoRedirect(response, requestedUrl) {
  // Credentialed requests use the module-captured transport and explicitly reject redirects.
  if (REDIRECT_STATUSES.has(response?.status) || response?.type === "opaqueredirect" || response?.redirected === true) {
    throw new DevMoterError("DevMoter redirects are not allowed for credentialed requests", {
      status: response?.status || 0,
      code: "redirect_rejected"
    });
  }
  if (response?.url) {
    try {
      if (new URL(response.url).href !== requestedUrl.href) {
        throw new DevMoterError("SDK transport followed a redirect; refusing its response", {
          status: response?.status || 0,
          code: "redirect_rejected"
        });
      }
    } catch (error) {
      if (error instanceof DevMoterError) throw error;
      throw new DevMoterError("SDK transport returned an invalid response URL", { code: "invalid_response_url" });
    }
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function normalizeBaseUrl(value) {
  const raw = String(value || "http://127.0.0.1:8787").trim();
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("DevMoter URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Do not embed DevMoter credentials in the URL");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error("Remote DevMoter automation requires HTTPS");
  }
  url.hash = "";
  url.search = "";
  assertSafePathSyntax(url.pathname);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}

function operationId(prefix = "devmoter") {
  return prefix + "-" + randomUUID();
}

function basicAuthorization(username, password) {
  if (!password) return "";
  return "Basic " + Buffer.from(String(username || "devmoter") + ":" + String(password), "utf8").toString("base64");
}

function isMutation(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "GET").toUpperCase());
}

export class DevMoterClient {
  constructor(options = {}) {
    if (options != null && "fetchImpl" in Object(options)) {
      throw new TypeError("Custom fetchImpl is not supported for credentialed SDK requests");
    }
    const {
      baseUrl = process.env.DEVMOTER_URL || "http://127.0.0.1:8787",
      username = process.env.DEVMOTER_AUTH_USERNAME || "devmoter",
      password = process.env.DEVMOTER_AUTH_PASSWORD || ""
    } = options ?? {};
    if (typeof sdkNativeFetch !== "function") throw new Error("native fetch is required");
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.username = String(username || "devmoter");
    this.password = String(password || "");
  }

  authHeader() {
    return basicAuthorization(this.username, this.password);
  }

  async request(path, {
    method = "GET",
    body,
    headers = {},
    operationId: requestedOperationId,
    signal
  } = {}) {
    const normalizedMethod = String(method || "GET").toUpperCase();
    let url;
    try { url = buildApiUrl(this.baseUrl, path); }
    catch {
      throw new DevMoterError("DevMoter request path must stay on the configured origin", {
        code: "invalid_request_path"
      });
    }
    const requestHeaders = new Headers(headers);
    requestHeaders.set("accept", requestHeaders.get("accept") || "application/json");
    if (body !== undefined && !requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }

    const authorization = this.authHeader();
    if (authorization) requestHeaders.set("authorization", authorization);

    if (isMutation(normalizedMethod)) {
      requestHeaders.set("origin", this.baseUrl.origin);
      if (!requestHeaders.has("x-pocket-operation-id")) {
        requestHeaders.set(
          "x-pocket-operation-id",
          requestedOperationId || operationId("sdk")
        );
      }
    } else if (requestedOperationId && !requestHeaders.has("x-pocket-operation-id")) {
      requestHeaders.set("x-pocket-operation-id", requestedOperationId);
    }

    let response;
    try {
      response = await sdkNativeFetch(url, {
        method: normalizedMethod,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: "manual"
      });
    } catch (cause) {
      throw new DevMoterError(
        cause instanceof Error ? cause.message : String(cause),
        { code: "network_error" }
      );
    }

    assertNoRedirect(response, url);

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 500) };
      }
    }

    if (!response.ok) {
      throw new DevMoterError(
        payload?.error || "DevMoter HTTP " + response.status,
        {
          status: response.status,
          code: payload?.code || "http_error",
          data: payload
        }
      );
    }
    return payload;
  }

  health() {
    return this.request("/api/health");
  }

  projects() {
    return this.request("/api/automation/projects");
  }

  openProject(project) {
    return this.request("/api/automation/open?project=" + encodeURIComponent(project));
  }

  sessions({ project = "", agent = "", status = "", backend = "" } = {}) {
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (agent) params.set("agent", agent);
    if (status) params.set("status", status);
    if (backend) params.set("backend", backend);
    const suffix = params.size ? "?" + params : "";
    return this.request("/api/automation/sessions" + suffix);
  }

  runTask({ project, agent, task, backend = "opencode", model = "" }, options = {}) {
    return this.request("/api/automation/tasks", {
      method: "POST",
      operationId: options.operationId || operationId("task"),
      signal: options.signal,
      body: { project, agent, task, backend, model }
    });
  }

  async *streamTask({ project, agent, task, backend = "opencode", model = "" }, options = {}) {
    const id = options.operationId || operationId("task");
    const url = buildApiUrl(this.baseUrl, "/api/automation/tasks");
    const headers = new Headers({
      accept: "application/x-ndjson",
      "content-type": "application/json",
      "x-pocket-operation-id": id,
      origin: this.baseUrl.origin
    });
    const authorization = this.authHeader();
    if (authorization) headers.set("authorization", authorization);

    let response;
    try {
      response = await sdkNativeFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ project, agent, task, backend, model }),
        signal: options.signal,
        redirect: "manual"
      });
    } catch (cause) {
      throw new DevMoterError(
        cause instanceof Error ? cause.message : String(cause),
        { code: "network_error" }
      );
    }

    assertNoRedirect(response, url);

    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {}
      throw new DevMoterError(
        payload?.error || "DevMoter HTTP " + response.status,
        {
          status: response.status,
          code: payload?.code || "http_error",
          data: payload
        }
      );
    }
    if (!response.body) {
      throw new DevMoterError("DevMoter returned no task stream", {
        code: "empty_stream"
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch {
          throw new DevMoterError("Invalid stream-JSON event", {
            code: "invalid_stream_event",
            data: { line: trimmed.slice(0, 500) }
          });
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim());
      } catch {
        throw new DevMoterError("Invalid final stream-JSON event", {
          code: "invalid_stream_event"
        });
      }
    }
  }

  listContext(projectId, query = "") {
    return this.request(
      "/api/projects/" + encodeURIComponent(projectId) +
      "/context?q=" + encodeURIComponent(query)
    );
  }

  resolveContext(projectId, references) {
    return this.request(
      "/api/projects/" + encodeURIComponent(projectId) + "/context/resolve",
      {
        method: "POST",
        operationId: operationId("context"),
        body: { references }
      }
    );
  }
}

export function createEventEnvelope(type, data, {
  operationId: id = null,
  timestamp = new Date().toISOString()
} = {}) {
  return {
    version: DEVMOTER_API_VERSION,
    type,
    timestamp,
    operationId: id,
    data
  };
}

export const sdkInternals = {
  normalizeBaseUrl,
  buildApiUrl,
  assertSafePathSyntax,
  assertNoRedirect,
  basicAuthorization,
  isMutation
};
