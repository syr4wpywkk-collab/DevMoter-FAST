import { randomUUID } from "node:crypto";

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

function normalizeBaseUrl(value) {
  const raw = String(value || "http://127.0.0.1:8787").trim();
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("DevMoter URL must use http or https");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}

function operationId(prefix = "devmoter") {
  return `${prefix}-${randomUUID()}`;
}

export class DevMoterClient {
  constructor({
    baseUrl = process.env.DEVMOTER_URL || "http://127.0.0.1:8787",
    token = process.env.DEVMOTER_TOKEN || "",
    fetchImpl = globalThis.fetch
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("fetch is required");
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = String(token || "");
    this.fetchImpl = fetchImpl;
  }

  async request(path, {
    method = "GET",
    body,
    headers = {},
    operationId: requestedOperationId,
    signal
  } = {}) {
    const url = new URL(String(path).replace(/^\//, ""), this.baseUrl);
    const requestHeaders = { accept: "application/json", ...headers };
    if (body !== undefined) requestHeaders["content-type"] = "application/json";
    if (requestedOperationId) requestHeaders["x-pocket-operation-id"] = requestedOperationId;
    if (this.token) requestHeaders.authorization = `Bearer ${this.token}`;

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal
      });
    } catch (cause) {
      throw new DevMoterError(
        cause instanceof Error ? cause.message : String(cause),
        { code: "network_error" }
      );
    }

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
        payload?.error || `DevMoter HTTP ${response.status}`,
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
    return this.request(`/api/automation/open?project=${encodeURIComponent(project)}`);
  }

  sessions({ project = "", agent = "", status = "", backend = "" } = {}) {
    const params = new URLSearchParams();
    if (project) params.set("project", project);
    if (agent) params.set("agent", agent);
    if (status) params.set("status", status);
    if (backend) params.set("backend", backend);
    const suffix = params.size ? `?${params}` : "";
    return this.request(`/api/automation/sessions${suffix}`);
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
    const url = new URL("api/automation/tasks", this.baseUrl);
    const headers = {
      accept: "application/x-ndjson",
      "content-type": "application/json",
      "x-pocket-operation-id": id
    };
    if (this.token) headers.authorization = "Bearer " + this.token;

    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ project, agent, task, backend, model }),
        signal: options.signal
      });
    } catch (cause) {
      throw new DevMoterError(
        cause instanceof Error ? cause.message : String(cause),
        { code: "network_error" }
      );
    }

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
      `/api/projects/${encodeURIComponent(projectId)}/context?q=${encodeURIComponent(query)}`
    );
  }

  resolveContext(projectId, references) {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}/context/resolve`, {
      method: "POST",
      operationId: operationId("context"),
      body: { references }
    });
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
