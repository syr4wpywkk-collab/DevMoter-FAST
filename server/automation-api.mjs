import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { listContextEntries, resolveContextReferences } from "./context-references.mjs";

export const AUTOMATION_API_VERSION = 1;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

function httpError(message, status = 400, code = "bad_request") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeSessionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return status || "unknown";
}

function parseOpenCodeModel(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw httpError("OpenCode model must be provider/model", 400, "invalid_model");
  }
  return { providerID: text.slice(0, slash), modelID: text.slice(slash + 1) };
}

function extractOpenCodeOutput(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "string") return payload.text;
  if (typeof payload?.message === "string") return payload.message;
  if (Array.isArray(payload?.parts)) {
    return payload.parts
      .filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text)
      .join("");
  }
  return "";
}

function publicOriginForRequest(req, configuredOrigin = "") {
  if (configuredOrigin) return new URL(configuredOrigin).origin;
  const proto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0].trim() || (req.socket?.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0].trim() || String(req.headers.host || "");
  if (!host) throw httpError("Request host is unavailable", 400, "host_unavailable");
  return new URL(proto + "://" + host).origin;
}

function envelope(operationId, type, data) {
  return {
    version: AUTOMATION_API_VERSION,
    type,
    timestamp: new Date().toISOString(),
    operationId,
    data
  };
}

export function createAutomationApi({
  readProjectRegistry,
  getProjectById,
  normalizeExistingProjectPath,
  fetchOpenCodeJson,
  codex,
  json,
  readJson,
  operationId,
  claimOperation,
  publicOrigin = "",
  taskTimeoutMs = TASK_TIMEOUT_MS
}) {
  async function resolveRegisteredProject(selector) {
    const value = String(selector || "").trim();
    if (!value) throw httpError("Project is required", 400, "project_required");

    const projects = await readProjectRegistry();
    const byId = projects.find(project => project.id === value);
    if (byId) return getProjectById(byId.id);

    const matches = projects.filter(
      project => String(project.name || "").toLowerCase() === value.toLowerCase()
    );
    if (!matches.length) throw httpError("Project not found", 404, "project_not_found");
    if (matches.length > 1) {
      throw httpError("Project name is ambiguous; use its project ID", 409, "project_ambiguous");
    }
    return getProjectById(matches[0].id);
  }

  function projectIdForPath(projects, value) {
    const path = String(value || "");
    if (!path || !isAbsolute(path)) return null;
    const found = projects.find(project => {
      try {
        return resolve(project.path) === resolve(path);
      } catch {
        return false;
      }
    });
    return found?.id || null;
  }

  async function projects(res) {
    const registered = await readProjectRegistry();
    const safe = [];
    for (const project of registered) {
      let available = false;
      try {
        await normalizeExistingProjectPath(project.path);
        available = true;
      } catch {}
      safe.push({
        id: project.id,
        name: project.name,
        addedAt: project.addedAt ?? null,
        available
      });
    }
    json(res, 200, { apiVersion: AUTOMATION_API_VERSION, projects: safe });
  }

  async function openProject(req, url, res) {
    const project = await resolveRegisteredProject(url.searchParams.get("project"));
    const origin = publicOriginForRequest(req, publicOrigin);
    const target = new URL("/?project=" + encodeURIComponent(project.id), origin).toString();
    json(res, 200, {
      apiVersion: AUTOMATION_API_VERSION,
      project: { id: project.id, name: project.name },
      url: target
    });
  }

  async function sessions(url, res) {
    const selector = url.searchParams.get("project");
    const requestedProject = selector ? await resolveRegisteredProject(selector) : null;
    const agentFilter = String(url.searchParams.get("agent") || "").toLowerCase();
    const statusFilter = String(url.searchParams.get("status") || "").toLowerCase();
    const backendFilter = String(url.searchParams.get("backend") || "").toLowerCase();
    if (backendFilter && !["opencode", "codex"].includes(backendFilter)) {
      throw httpError("backend must be opencode or codex", 400, "invalid_backend");
    }

    const registered = await readProjectRegistry();
    const output = [];
    const errors = [];

    if (!backendFilter || backendFilter === "opencode") {
      try {
        const headers = requestedProject
          ? { "x-opencode-directory": requestedProject.path }
          : {};
        const payload = await fetchOpenCodeJson("/api/session?limit=100&order=desc", { headers });
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data) ? payload.data : [];

        for (const session of list) {
          const location = typeof session?.location === "string"
            ? session.location
            : session?.location?.directory;
          const projectId = requestedProject?.id || projectIdForPath(registered, location);
          output.push({
            backend: "opencode",
            id: String(session?.id || ""),
            title: String(session?.title || "Untitled session"),
            agent: String(session?.agent || ""),
            status: normalizeSessionStatus(session?.status || session?.state),
            projectId,
            updatedAt: session?.time?.updated ?? null
          });
        }
      } catch {
        errors.push({ backend: "opencode", state: "unavailable" });
      }
    }

    if (!backendFilter || backendFilter === "codex") {
      try {
        const payload = await codex.request("thread/list", { limit: 100 }, { timeoutMs: 8000 });
        const list = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.threads) ? payload.threads : [];

        for (const thread of list) {
          const projectId = projectIdForPath(registered, thread?.cwd);
          if (requestedProject && projectId !== requestedProject.id) continue;
          output.push({
            backend: "codex",
            id: String(thread?.id || ""),
            title: String(thread?.name || thread?.preview || "Untitled thread"),
            agent: "codex",
            status: normalizeSessionStatus(thread?.status || thread?.state),
            projectId,
            updatedAt: thread?.updatedAt ?? thread?.updated_at ?? null
          });
        }
      } catch {
        errors.push({ backend: "codex", state: "unavailable" });
      }
    }

    const filtered = output.filter(session =>
      (!agentFilter || session.agent.toLowerCase() === agentFilter) &&
      (!statusFilter || session.status.toLowerCase() === statusFilter)
    );

    json(res, 200, {
      apiVersion: AUTOMATION_API_VERSION,
      sessions: filtered,
      errors
    });
  }

  async function runOpenCodeTask(project, { agent, task, model }, onEvent) {
    const headers = {
      "content-type": "application/json",
      "x-opencode-directory": project.path
    };
    const agentsPayload = await fetchOpenCodeJson("/api/agent", { headers });
    const agents = Array.isArray(agentsPayload)
      ? agentsPayload
      : Array.isArray(agentsPayload?.data) ? agentsPayload.data : [];
    if (!agents.some(item => String(item?.id || "") === agent && item?.hidden !== true)) {
      throw httpError("OpenCode agent is unavailable", 400, "unsupported_agent");
    }

    const selectedModel = parseOpenCodeModel(model);
    const sessionBody = { agent };
    if (selectedModel) {
      sessionBody.model = {
        id: selectedModel.modelID,
        providerID: selectedModel.providerID
      };
    }

    const session = await fetchOpenCodeJson("/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify(sessionBody),
      signal: AbortSignal.timeout(10000)
    });
    const sessionId = String(session?.id || "");
    if (!sessionId) throw httpError("OpenCode did not return a session ID", 502, "backend_error");

    onEvent({ type: "session.created", data: { sessionId, backend: "opencode" } });
    onEvent({ type: "task.started", data: { sessionId } });

    let blocked = null;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, taskTimeoutMs);

    const poll = setInterval(() => {
      void Promise.all([
        fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/permission", {
          headers,
          signal: AbortSignal.timeout(2500)
        }).catch(() => []),
        fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/question", {
          headers,
          signal: AbortSignal.timeout(2500)
        }).catch(() => [])
      ]).then(([permissionPayload, questionPayload]) => {
        const permissions = Array.isArray(permissionPayload)
          ? permissionPayload
          : Array.isArray(permissionPayload?.data) ? permissionPayload.data : [];
        const questions = Array.isArray(questionPayload)
          ? questionPayload
          : Array.isArray(questionPayload?.data) ? questionPayload.data : [];
        if (!blocked && permissions.length) {
          blocked = { reason: "approval_required", approvalType: "permission" };
          controller.abort();
        } else if (!blocked && questions.length) {
          blocked = { reason: "input_required", approvalType: "question" };
          controller.abort();
        }
      }).catch(() => {});
    }, 750);
    poll.unref?.();

    try {
      const result = await fetchOpenCodeJson(
        "/api/session/" + encodeURIComponent(sessionId) + "/prompt",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ text: task }),
          signal: controller.signal
        }
      );

      const [permissionPayload, questionPayload] = await Promise.all([
        fetchOpenCodeJson(
          "/api/session/" + encodeURIComponent(sessionId) + "/permission",
          { headers, signal: AbortSignal.timeout(2500) }
        ).catch(() => []),
        fetchOpenCodeJson(
          "/api/session/" + encodeURIComponent(sessionId) + "/question",
          { headers, signal: AbortSignal.timeout(2500) }
        ).catch(() => [])
      ]);
      const permissions = Array.isArray(permissionPayload)
        ? permissionPayload
        : Array.isArray(permissionPayload?.data) ? permissionPayload.data : [];
      const questions = Array.isArray(questionPayload)
        ? questionPayload
        : Array.isArray(questionPayload?.data) ? questionPayload.data : [];
      if (permissions.length) {
        blocked = { reason: "approval_required", approvalType: "permission" };
        throw httpError("OpenCode is waiting for approval", 409, "approval_required");
      }
      if (questions.length) {
        blocked = { reason: "input_required", approvalType: "question" };
        throw httpError("OpenCode is waiting for input", 409, "input_required");
      }

      const output = extractOpenCodeOutput(result);
      onEvent({ type: "task.completed", data: { sessionId } });
      return {
        apiVersion: AUTOMATION_API_VERSION,
        backend: "opencode",
        status: "completed",
        project: { id: project.id, name: project.name },
        sessionId,
        output
      };
    } catch (error) {
      if (blocked) {
        onEvent({ type: "task.blocked", data: blocked });
        return {
          apiVersion: AUTOMATION_API_VERSION,
          backend: "opencode",
          status: "blocked",
          message: blocked.reason === "input_required"
            ? "Task is waiting for input in DevMoter"
            : "Task is waiting for approval in DevMoter",
          project: { id: project.id, name: project.name },
          sessionId,
          output: ""
        };
      }

      if (timedOut) {
        try {
          await fetchOpenCodeJson(
            "/api/session/" + encodeURIComponent(sessionId) + "/interrupt",
            {
              method: "POST",
              headers,
              body: "{}",
              signal: AbortSignal.timeout(5000)
            }
          );
        } catch {}
        throw httpError("OpenCode task timed out and was interrupted", 504, "task_timeout");
      }
      throw error;
    } finally {
      clearInterval(poll);
      clearTimeout(timeout);
    }
  }

  async function runCodexTask(project, { agent, task, model }, req, onEvent) {
    if (!["codex", "default"].includes(String(agent || "").toLowerCase())) {
      throw httpError("Codex supports the codex agent only", 400, "unsupported_agent");
    }

    const startParams = { cwd: project.path };
    if (model) startParams.model = model;
    const started = await codex.request("thread/start", startParams, { timeoutMs: 10000 });
    const thread = started?.thread ?? started;
    const threadId = String(thread?.id || "");
    if (!threadId) throw httpError("Codex did not return a thread ID", 502, "backend_error");

    const clientMessageId = operationId(req) || randomUUID();
    onEvent({ type: "session.created", data: { sessionId: threadId, backend: "codex" } });

    return new Promise((resolveTask, rejectTask) => {
      let settled = false;
      let turnId = "";
      let output = "";

      const cleanup = () => {
        codex.off("notification", onNotification);
        codex.off("server-request", onServerRequest);
        clearTimeout(timeout);
      };
      const finish = result => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveTask(result);
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectTask(error);
      };

      const onNotification = event => {
        const method = String(event?.method || "");
        const params = event?.params ?? {};
        const eventThreadId = params?.threadId ?? params?.thread?.id;
        if (eventThreadId && String(eventThreadId) !== threadId) return;

        if (method === "item/agentMessage/delta") {
          const delta = typeof params?.delta === "string" ? params.delta : "";
          if (delta) {
            output += delta;
            if (output.length > 256000) output = output.slice(-256000);
            onEvent({ type: "output.delta", data: { text: delta } });
          }
          return;
        }

        if (method !== "turn/completed") return;
        const statusRaw = String(params?.turn?.status || "completed").toLowerCase();
        const status = ["completed", "success", "succeeded"].includes(statusRaw)
          ? "completed"
          : "failed";
        onEvent({
          type: "task." + status,
          data: { turnId: turnId || params?.turn?.id || null, status: statusRaw }
        });
        finish({
          apiVersion: AUTOMATION_API_VERSION,
          backend: "codex",
          status,
          project: { id: project.id, name: project.name },
          sessionId: threadId,
          turnId: turnId || String(params?.turn?.id || ""),
          output
        });
      };

      const onServerRequest = event => {
        const method = String(event?.method || "");
        const params = event?.params ?? {};
        const eventThreadId = params?.threadId ?? params?.thread?.id;
        if (eventThreadId && String(eventThreadId) !== threadId) return;

        const blocked =
          method === "item/commandExecution/requestApproval" ? "command" :
          method === "item/fileChange/requestApproval" ? "file_change" :
          /question|user.?input|request.?input/i.test(method) ? "input" :
          null;
        if (!blocked) return;

        const reason = blocked === "input" ? "input_required" : "approval_required";
        onEvent({
          type: "task.blocked",
          data: { reason, approvalType: blocked }
        });
        finish({
          apiVersion: AUTOMATION_API_VERSION,
          backend: "codex",
          status: "blocked",
          message: reason === "input_required"
            ? "Task is waiting for input in DevMoter"
            : "Task is waiting for approval in DevMoter",
          project: { id: project.id, name: project.name },
          sessionId: threadId,
          turnId,
          output
        });
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        void (async () => {
          if (turnId) {
            try {
              await codex.request(
                "turn/interrupt",
                { threadId, turnId },
                { timeoutMs: 5000 }
              );
            } catch {}
          }
          rejectTask(
            httpError(
              "Codex task timed out and was interrupted",
              504,
              "task_timeout"
            )
          );
        })();
      }, taskTimeoutMs);
  
      codex.on("notification", onNotification);
      codex.on("server-request", onServerRequest);

      const turnParams = {
        threadId,
        input: [{ type: "text", text: task }],
        clientUserMessageId: clientMessageId
      };
      if (model) turnParams.model = model;

      codex.request("turn/start", turnParams, { timeoutMs: 10000 })
        .then(result => {
          turnId = String(result?.turn?.id || result?.turnId || "");
          if (!turnId) {
            fail(httpError("Codex did not return a turn ID", 502, "backend_error"));
            return;
          }
          onEvent({ type: "task.started", data: { turnId } });
        })
        .catch(fail);
    });
  }

  async function task(req, res) {
    const operation = operationId(req) || randomUUID();
    const wantsStream = String(req.headers.accept || "").includes("application/x-ndjson");
    let streamStarted = false;

    const emit = event => {
      if (!wantsStream) return;
      if (!streamStarted) {
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no"
        });
        streamStarted = true;
      }
      res.write(JSON.stringify(envelope(
        operation,
        event.type || "task.event",
        event.data ?? event
      )) + "\n");
    };

    try {
      const payload = await readJson(req, 512 * 1024);
      const project = await resolveRegisteredProject(payload?.project);
      const agent = String(payload?.agent || "").trim();
      const taskText = String(payload?.task || "").trim();
      const backend = String(payload?.backend || "opencode").trim().toLowerCase();
      const model = String(payload?.model || "").trim();

      if (!agent) throw httpError("Agent is required", 400, "agent_required");
      if (!taskText) throw httpError("Task is required", 400, "task_required");
      if (Buffer.byteLength(taskText, "utf8") > 256 * 1024) {
        throw httpError("Task is too large", 413, "task_too_large");
      }
      if (!["opencode", "codex"].includes(backend)) {
        throw httpError("backend must be opencode or codex", 400, "invalid_backend");
      }

      const result = backend === "opencode"
        ? await runOpenCodeTask(project, { agent, task: taskText, model }, emit)
        : await runCodexTask(project, { agent, task: taskText, model }, req, emit);

      if (wantsStream) {
        emit({ type: "task.result", data: result });
        res.end();
        return;
      }
      json(res, 200, result);
    } catch (error) {
      const failure = {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code || "task_failed"
      };
      if (wantsStream && streamStarted) {
        emit({ type: "task.error", data: failure });
        res.end();
        return;
      }
      json(res, Number(error?.status || 502), failure);
    }
  }

  async function contextList(projectId, url, res) {
    const project = await getProjectById(projectId);
    const entries = await listContextEntries(
      project.path,
      url.searchParams.get("q") || ""
    );
    json(res, 200, { projectId, entries });
  }

  async function contextResolve(projectId, req, res) {
    const payload = await readJson(req, 128 * 1024);
    const project = await getProjectById(projectId);
    const result = await resolveContextReferences(project.path, payload?.references);
    json(res, 200, { projectId, ...result });
  }

  async function handle(req, res, url) {
    try {
      if (req.method === "GET" && url.pathname === "/api/automation/projects") {
        await projects(res);
        return true;
      }
      if (req.method === "GET" && url.pathname === "/api/automation/open") {
        await openProject(req, url, res);
        return true;
      }
      if (req.method === "GET" && url.pathname === "/api/automation/sessions") {
        await sessions(url, res);
        return true;
      }
      if (req.method === "POST" && url.pathname === "/api/automation/tasks") {
        if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
        await task(req, res);
        return true;
      }

      const contextMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/context(?:\/(resolve))?$/
      );
      if (contextMatch) {
        const projectId = decodeURIComponent(contextMatch[1]);
        if (req.method === "GET" && !contextMatch[2]) {
          await contextList(projectId, url, res);
          return true;
        }
        if (req.method === "POST" && contextMatch[2] === "resolve") {
          if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
          await contextResolve(projectId, req, res);
          return true;
        }
      }
      return false;
    } catch (error) {
      json(res, Number(error?.status || 400), {
        error: error instanceof Error ? error.message : String(error),
        code: error?.code || "automation_error"
      });
      return true;
    }
  }

  return {
    handle,
    resolveRegisteredProject,
    runOpenCodeTask,
    runCodexTask
  };
}
