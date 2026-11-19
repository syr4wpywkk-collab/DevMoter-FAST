// The one place that knows how OpenCode generations differ.
//
// DevMoter's browser UI, automation API and session control speak a single
// DevMoter shape (below) to the DevMoter server. This module translates that
// shape to the routes of the OpenCode generation that is running and turns
// every OpenCode answer and SSE event back into the same DevMoter shape, so the
// screen and behaviour never depend on the OpenCode version.
//
//   generation "v1": OpenCode 1.x (verified against 1.19.5; version from GET /global/health)
//   generation "v2": OpenCode 2.x (verified against 2.0.9;  version from GET /api/info)
//
// OpenCode 1.x ships two session runners. The `/api/session/{id}/prompt` route
// runs the new runner, which only drives AI SDK models: a model whose catalog
// entry is `api.type: "native"` (most OpenCode Zen / Go models) is accepted and
// then fails inside the runner without ever answering. The classic runner
// (`/session/{id}/prompt_async`, the one the 1.x TUI uses) runs every model the
// 1.x provider catalog (`GET /provider`) resolves, native ones included, and it
// streams its messages, permissions and questions on the classic `GET /event`
// stream. So on 1.x DevMoter drives sessions through the classic runner; on 2.x
// through `/api/session/{id}/prompt`.
//
// DevMoter shapes
//   prompt:      { text, model?: { providerID, modelID }, agent?, delivery? }
//   context:     [{ type: "user", id, text, time } | { type: "assistant", id, time,
//                  agent, model: { id, providerID }, content: [text|reasoning|tool],
//                  cost, tokens, finish?, error? } | { type: "idle", id, time, outcome } | ...]
//   active:      { [sessionID]: { type: "running", retry?: { attempt, message, next? } } }
//   permission:  { id, sessionID, action, resources, save, metadata, tool? }
//   decision:    "once" | "always" | "reject"
//   question:    { id, sessionID, questions: [{ header, question, options, multiple, custom }] }
//   answers:     string[][]  (one array of labels per question)
//   event:       { type, properties } in the canonical vocabulary handled by
//                src/opencode-event-compat.mjs

export const OPENCODE_API_V1 = "v1";
export const OPENCODE_API_V2 = "v2";

export function openCodeGenerationFromVersion(version) {
  const match = String(version ?? "").trim().match(/^v?(\d+)\./);
  if (!match) throw new Error(`OpenCode reported an unrecognised version: ${JSON.stringify(version ?? null)}`);
  const major = Number(match[1]);
  if (major >= 2) return OPENCODE_API_V2;
  if (major === 1) return OPENCODE_API_V1;
  throw new Error(`OpenCode ${version} is older than the 1.x HTTP API DevMoter supports`);
}

export function assertOpenCodeGeneration(generation) {
  if (generation !== OPENCODE_API_V1 && generation !== OPENCODE_API_V2) {
    throw new Error("OpenCode API generation is unknown; DevMoter could not read OpenCode's version endpoint");
  }
  return generation;
}

const enc = value => encodeURIComponent(String(value ?? ""));

function requireId(value, label) {
  const id = String(value ?? "");
  if (!id) throw new Error(`OpenCode ${label} is required`);
  return id;
}

export function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function objectOf(payload) {
  const value = payload?.data !== undefined ? payload.data : payload;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// ---------------------------------------------------------------------------
// Prompt

const DELIVERIES = new Set(["steer", "queue"]);

/** Validate a DevMoter prompt body and return its normalized form. */
export function parseDevMoterPrompt(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Prompt body must be a JSON object");
  if (typeof body.text !== "string") throw new Error("Prompt text is required");
  const prompt = { text: body.text };
  const model = body.model;
  if (model !== undefined && model !== null) {
    const providerID = String(model?.providerID ?? "").trim();
    const modelID = String(model?.modelID ?? model?.id ?? "").trim();
    if (!providerID || !modelID) throw new Error("Prompt model needs providerID and modelID");
    prompt.model = { providerID, modelID };
  }
  if (typeof body.agent === "string" && body.agent.trim()) prompt.agent = body.agent.trim();
  if (DELIVERIES.has(body.delivery)) prompt.delivery = body.delivery;
  return prompt;
}

function sessionModel(session) {
  const model = session?.model;
  const providerID = String(model?.providerID ?? "");
  const modelID = String(model?.modelID ?? model?.id ?? "");
  return providerID && modelID ? { providerID, modelID } : null;
}

/**
 * The OpenCode requests that deliver one DevMoter prompt. `session` is the
 * session as GET /api/session/{id} returns it (both generations), used for the
 * model/agent the prompt does not name. `readOnlyTools` restricts the tools a
 * 1.x run may call (the classic runner honours a per-prompt tool map; 2.x has
 * no such field, so a read-only run there relies on the read-only agent).
 */
export function buildOpenCodePromptRequests(generation, sessionID, prompt, { session = null, readOnlyTools = null } = {}) {
  assertOpenCodeGeneration(generation);
  const id = requireId(sessionID, "session id");
  const model = prompt.model ?? sessionModel(session);
  const agent = prompt.agent ?? (typeof session?.agent === "string" && session.agent ? session.agent : null);

  if (generation === OPENCODE_API_V1) {
    const body = { parts: [{ type: "text", text: prompt.text }] };
    if (model) body.model = { providerID: model.providerID, modelID: model.modelID };
    if (agent) body.agent = agent;
    if (readOnlyTools) body.tools = { ...readOnlyTools };
    return [{ method: "POST", path: "/session/" + enc(id) + "/prompt_async", body }];
  }

  const requests = [];
  const current = sessionModel(session);
  if (prompt.model && (!current || current.providerID !== prompt.model.providerID || current.modelID !== prompt.model.modelID)) {
    requests.push({
      method: "POST",
      path: "/api/session/" + enc(id) + "/model",
      body: { model: { id: prompt.model.modelID, providerID: prompt.model.providerID } }
    });
  }
  if (prompt.agent && prompt.agent !== session?.agent) {
    requests.push({ method: "POST", path: "/api/session/" + enc(id) + "/agent", body: { agent: prompt.agent } });
  }
  const body = { text: prompt.text };
  if (prompt.delivery) body.delivery = prompt.delivery;
  requests.push({ method: "POST", path: "/api/session/" + enc(id) + "/prompt", body });
  return requests;
}

// ---------------------------------------------------------------------------
// Session status and interrupt

export function openCodeActivePath(generation) {
  assertOpenCodeGeneration(generation);
  return generation === OPENCODE_API_V1 ? "/session/status" : "/api/session/active";
}

function classicRetry(status) {
  return {
    attempt: Number.isFinite(Number(status?.attempt)) ? Number(status.attempt) : null,
    message: typeof status?.message === "string" ? status.message : "",
    ...(Number.isFinite(Number(status?.next)) ? { next: Number(status.next) } : {})
  };
}

/**
 * { [sessionID]: { type: "running", retry? } } for every session that is
 * executing; `retry` is set while OpenCode 1.x waits to retry an upstream error.
 */
export function normalizeOpenCodeActive(generation, payload) {
  assertOpenCodeGeneration(generation);
  const raw = objectOf(payload);
  const active = {};
  for (const [sessionID, status] of Object.entries(raw)) {
    if (generation === OPENCODE_API_V1) {
      const type = String(status?.type ?? "");
      if (type === "busy") active[sessionID] = { type: "running" };
      // The 1.x classic runner retries a failing upstream call (quota,
      // credentials, overload) with backoff instead of failing the turn; keep
      // the upstream message so the run is not a silent spinner.
      if (type === "retry") active[sessionID] = { type: "running", retry: classicRetry(status) };
    } else if (status) {
      active[sessionID] = { type: "running" };
    }
  }
  return active;
}

export function openCodeInterruptRequest(generation, sessionID) {
  assertOpenCodeGeneration(generation);
  const id = requireId(sessionID, "session id");
  return generation === OPENCODE_API_V1
    ? { method: "POST", path: "/session/" + enc(id) + "/abort" }
    : { method: "POST", path: "/api/session/" + enc(id) + "/interrupt" };
}

// ---------------------------------------------------------------------------
// Context (transcript)

function classicToolPart(part) {
  const state = part?.state ?? {};
  const next = { status: String(state.status ?? "pending"), input: state.input ?? {} };
  if (state.status === "completed" && state.output !== undefined) next.result = state.output;
  if (state.status === "error" && state.error !== undefined) next.error = state.error;
  if (typeof state.title === "string" && state.title) next.title = state.title;
  if (state.metadata && typeof state.metadata === "object") next.metadata = state.metadata;
  return { type: "tool", id: String(part?.callID ?? part?.id ?? ""), name: String(part?.tool ?? "tool"), state: next };
}

function classicError(error) {
  if (!error || typeof error !== "object") return null;
  const message = typeof error.data?.message === "string" && error.data.message
    ? error.data.message
    : String(error.name || "error");
  return { name: String(error.name || "Error"), message };
}

function classicOutcome(info) {
  const error = info?.error;
  if (!error) return "succeeded";
  return error.name === "MessageAbortedError" ? "interrupted" : "failed";
}

/**
 * Convert classic 1.x messages ({ info, parts }) into DevMoter context items.
 * `busy` tells whether the classic runner is still working on the session; a
 * finished last turn gets the same trailing idle marker 2.x context carries.
 */
export function classicMessagesToContext(messages, { busy = false } = {}) {
  const items = [];
  const list = listOf(messages);
  for (const message of list) {
    const info = message?.info;
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    if (!info?.id) continue;
    if (info.role === "user") {
      const text = parts
        .filter(part => part?.type === "text" && part.synthetic !== true)
        .map(part => String(part.text ?? ""))
        .join("");
      items.push({ id: info.id, type: "user", text, time: { created: info.time?.created ?? 0 } });
      continue;
    }
    if (info.role !== "assistant") continue;
    const content = [];
    for (const part of parts) {
      if (part?.type === "text" && part.synthetic !== true) content.push({ type: "text", text: String(part.text ?? "") });
      else if (part?.type === "reasoning") content.push({ type: "reasoning", text: String(part.text ?? "") });
      else if (part?.type === "tool") content.push(classicToolPart(part));
    }
    const item = {
      id: info.id,
      type: "assistant",
      time: { ...(info.time ?? {}) },
      agent: info.agent ?? info.mode ?? null,
      model: info.modelID ? { id: String(info.modelID), providerID: String(info.providerID ?? "") } : null,
      content,
      cost: Number.isFinite(info.cost) ? info.cost : 0,
      tokens: info.tokens ?? null
    };
    if (info.finish) item.finish = info.finish;
    const error = classicError(info.error);
    if (error) item.error = error;
    items.push(item);
  }

  const last = list.at(-1)?.info;
  if (!busy && last?.role === "assistant" && last.time?.completed) {
    items.push({
      id: last.id + ":idle",
      type: "idle",
      time: { created: last.time.completed },
      outcome: classicOutcome(last)
    });
  }
  return items;
}

const itemTime = item => Number(item?.time?.created ?? 0);

/**
 * 1.x keeps two transcripts: the classic runner's messages and whatever an
 * earlier DevMoter release sent through the new runner. Show both, in time order.
 */
export function mergeOpenCodeContexts(...lists) {
  return lists
    .flat()
    .map((item, index) => ({ item, index }))
    .sort((a, b) => itemTime(a.item) - itemTime(b.item) || a.index - b.index)
    .map(entry => entry.item);
}

/** The text of the last assistant turn, for callers that only want the answer. */
export function lastAssistantText(context) {
  const list = listOf(context);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (item?.type !== "assistant") continue;
    const text = (Array.isArray(item.content) ? item.content : [])
      .filter(part => part?.type === "text")
      .map(part => String(part.text ?? ""))
      .join("");
    if (text) return text;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Permissions
//   v1 classic: GET /permission -> [{ id, sessionID, permission, patterns, metadata, always, tool }]
//               POST /permission/{id}/reply { reply, message? }
//   v2:         GET /api/session/{id}/permission -> [{ id, sessionID, action, resources, save, source, metadata? }]
//               POST /api/session/{id}/permission/{id}/reply { decision, message? }

const PERMISSION_DECISIONS = new Set(["once", "always", "reject"]);

export function parsePermissionDecision(value) {
  return PERMISSION_DECISIONS.has(value) ? value : null;
}

const SHELL_ACTIONS = new Set(["bash", "shell"]);
const strings = value => (Array.isArray(value) ? value.map(item => String(item)) : []);

export function normalizeOpenCodePermission(generation, raw) {
  assertOpenCodeGeneration(generation);
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const v1 = generation === OPENCODE_API_V1;
  const action = String((v1 ? raw.permission : raw.action) ?? "permission");
  const resources = strings(v1 ? raw.patterns : raw.resources);
  const save = strings(v1 ? raw.always : raw.save);
  const metadata = raw.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {};
  if (typeof metadata.command !== "string" && SHELL_ACTIONS.has(action) && resources.length === 1) {
    metadata.command = resources[0];
  }
  const tool = v1
    ? (raw.tool?.callID ? { messageID: String(raw.tool.messageID ?? ""), callID: String(raw.tool.callID) } : null)
    : (raw.source?.type === "tool" ? { messageID: String(raw.source.messageID ?? ""), callID: String(raw.source.id ?? "") } : null);
  return {
    id: String(raw.id),
    sessionID: String(raw.sessionID ?? ""),
    action,
    resources,
    save,
    metadata,
    ...(tool ? { tool } : {})
  };
}

export function openCodePermissionListPath(generation, sessionID) {
  assertOpenCodeGeneration(generation);
  return generation === OPENCODE_API_V1 ? "/permission" : "/api/session/" + enc(requireId(sessionID, "session id")) + "/permission";
}

export function normalizeOpenCodePermissions(generation, sessionID, payload) {
  const id = String(sessionID ?? "");
  return listOf(payload)
    .map(raw => normalizeOpenCodePermission(generation, raw))
    .filter(permission => permission && (!id || permission.sessionID === id));
}

export function buildOpenCodePermissionReply(generation, sessionID, requestID, decision, message) {
  assertOpenCodeGeneration(generation);
  if (!parsePermissionDecision(decision)) throw new Error(`Unsupported OpenCode permission decision: ${decision}`);
  const session = requireId(sessionID, "session id");
  const request = requireId(requestID, "permission request id");
  const note = typeof message === "string" && message ? { message } : {};
  if (generation === OPENCODE_API_V1) {
    return { method: "POST", path: "/permission/" + enc(request) + "/reply", body: { reply: decision, ...note } };
  }
  return {
    method: "POST",
    path: "/api/session/" + enc(session) + "/permission/" + enc(request) + "/reply",
    body: { decision, ...note }
  };
}

// ---------------------------------------------------------------------------
// Questions
//   v1 classic: GET /question -> [{ id, sessionID, questions: [{ header, question, options, multiple?, custom? }] }]
//               POST /question/{id}/reply { answers: string[][] }; POST /question/{id}/reject
//   v2 forms:   GET /api/session/{id}/form -> Form.Info[]; GET .../form/{id};
//               POST .../form/{id}/reply { answer: { [fieldKey]: value } }; DELETE .../form/{id}
//               The built-in question tool creates one field per question.

function normalizeClassicQuestion(request) {
  if (!request || typeof request !== "object" || !request.id) return null;
  const questions = Array.isArray(request.questions) ? request.questions : [];
  return {
    id: String(request.id),
    sessionID: String(request.sessionID ?? ""),
    questions: questions.map(question => ({
      header: typeof question?.header === "string" ? question.header : "",
      question: String(question?.question ?? ""),
      options: Array.isArray(question?.options)
        ? question.options.map(option => ({
            label: String(option?.label ?? ""),
            ...(typeof option?.description === "string" ? { description: option.description } : {})
          }))
        : [],
      multiple: question?.multiple === true,
      custom: question?.custom !== false
    }))
  };
}

const visibleFields = form => (Array.isArray(form?.fields) ? form.fields : []).filter(field => field && field.hidden !== true);

function formFieldQuestion(field) {
  const type = String(field?.type ?? "");
  const title = typeof field?.title === "string" ? field.title : "";
  const description = typeof field?.description === "string" ? field.description : "";
  const key = String(field?.key ?? "");
  if (type === "external") {
    return {
      header: title || key,
      question: [description || title || key, field?.url ? String(field.url) : ""].filter(Boolean).join("\n"),
      options: [],
      multiple: false,
      custom: true
    };
  }
  const options = type === "boolean"
    ? [{ label: "true" }, { label: "false" }]
    : Array.isArray(field?.options)
      ? field.options.map(option => ({
          label: String(option?.value ?? option?.label ?? ""),
          ...(typeof option?.description === "string" ? { description: option.description } : {})
        }))
      : [];
  return {
    header: title || key,
    question: description || title || key,
    options,
    multiple: type === "multiselect",
    // A closed choice list (options without custom) is the only case where
    // free text would be rejected by OpenCode's form validation.
    custom: type === "boolean" ? false : options.length === 0 || field?.custom === true
  };
}

function normalizeForm(form) {
  if (!form || typeof form !== "object" || !form.id) return null;
  return {
    id: String(form.id),
    sessionID: String(form.sessionID ?? ""),
    questions: visibleFields(form).map(formFieldQuestion)
  };
}

export function normalizeOpenCodeQuestion(generation, raw) {
  assertOpenCodeGeneration(generation);
  return generation === OPENCODE_API_V1 ? normalizeClassicQuestion(raw) : normalizeForm(raw);
}

export function openCodeQuestionListPath(generation, sessionID) {
  assertOpenCodeGeneration(generation);
  return generation === OPENCODE_API_V1 ? "/question" : "/api/session/" + enc(requireId(sessionID, "session id")) + "/form";
}

export function normalizeOpenCodeQuestions(generation, sessionID, payload) {
  const id = String(sessionID ?? "");
  return listOf(payload)
    .map(raw => normalizeOpenCodeQuestion(generation, raw))
    .filter(question => question && (!id || question.sessionID === id));
}

/** Validate DevMoter answers: one array of strings per question. */
export function parseQuestionAnswers(value) {
  if (!Array.isArray(value)) throw new Error("answers must be an array with one entry per question");
  return value.map(answer => (Array.isArray(answer) ? answer.map(item => String(item)) : []));
}

function formValue(type, answer) {
  const values = Array.isArray(answer) ? answer : [];
  if (type === "multiselect") return values;
  const first = values[0];
  if (first === undefined) return undefined;
  if (type === "number" || type === "integer") {
    const number = Number(first);
    if (!Number.isFinite(number)) throw new Error(`Answer "${first}" is not a number`);
    return number;
  }
  if (type === "boolean") {
    if (first === "true") return true;
    if (first === "false") return false;
    throw new Error(`Answer "${first}" is not true or false`);
  }
  return first;
}

/** Path of the single pending request a 2.x reply needs (its form fields); null on 1.x. */
export function openCodeQuestionDetailPath(generation, sessionID, requestID) {
  assertOpenCodeGeneration(generation);
  if (generation === OPENCODE_API_V1) return null;
  return "/api/session/" + enc(requireId(sessionID, "session id")) + "/form/" + enc(requireId(requestID, "question id"));
}

/** `form` is the raw 2.x form (GET .../form/{id}); unused on 1.x. */
export function buildOpenCodeQuestionReply(generation, sessionID, requestID, answers, form = null) {
  assertOpenCodeGeneration(generation);
  const session = requireId(sessionID, "session id");
  const request = requireId(requestID, "question id");
  const list = parseQuestionAnswers(answers);
  if (generation === OPENCODE_API_V1) {
    return { method: "POST", path: "/question/" + enc(request) + "/reply", body: { answers: list } };
  }
  const fields = visibleFields(objectOf(form));
  if (!fields.length) throw new Error("OpenCode form fields are missing");
  const answer = {};
  fields.forEach((field, index) => {
    const value = formValue(String(field.type ?? "string"), list[index]);
    if (value !== undefined) answer[String(field.key ?? "")] = value;
  });
  return {
    method: "POST",
    path: "/api/session/" + enc(session) + "/form/" + enc(request) + "/reply",
    body: { answer }
  };
}

export function buildOpenCodeQuestionReject(generation, sessionID, requestID) {
  assertOpenCodeGeneration(generation);
  const session = requireId(sessionID, "session id");
  const request = requireId(requestID, "question id");
  if (generation === OPENCODE_API_V1) return { method: "POST", path: "/question/" + enc(request) + "/reject" };
  return { method: "DELETE", path: "/api/session/" + enc(session) + "/form/" + enc(request) };
}

// ---------------------------------------------------------------------------
// Events
//   v1: the classic runner publishes on GET /event ({ type, properties }).
//   v2: GET /api/event ({ type, data }).
// Both are rewritten to { type, properties } in one vocabulary:
//   message.part.updated / message.part.delta / session.status / session.idle /
//   session.error (1.x classic stream), session.text.* / session.reasoning.* /
//   session.execution.* / session.tool.* (2.x stream), session.created/updated/
//   deleted (both), permission.asked (props: DevMoter permission),
//   permission.replied { sessionID, requestID, decision },
//   question.asked (props: DevMoter question), question.resolved { sessionID, requestID }.

export function openCodeEventPath(generation) {
  assertOpenCodeGeneration(generation);
  return generation === OPENCODE_API_V1 ? "/event" : "/api/event";
}

function rawProps(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload.data ?? payload.properties ?? {};
}

export function canonicalOpenCodeEvent(generation, payload) {
  assertOpenCodeGeneration(generation);
  const type = typeof payload?.type === "string" ? payload.type : "";
  const props = rawProps(payload);
  const event = (nextType, properties) => ({
    ...(typeof payload?.id === "string" ? { id: payload.id } : {}),
    type: nextType,
    properties
  });

  if (type === "permission.asked") {
    const permission = normalizeOpenCodePermission(generation, props);
    return permission ? event("permission.asked", permission) : null;
  }
  if (type === "permission.replied") {
    return event("permission.replied", {
      sessionID: String(props?.sessionID ?? ""),
      requestID: String(props?.requestID ?? props?.permissionID ?? ""),
      decision: parsePermissionDecision(props?.reply ?? props?.response ?? props?.decision)
    });
  }
  if ((generation === OPENCODE_API_V1 && type === "question.asked") || (generation === OPENCODE_API_V2 && type === "form.created")) {
    const question = normalizeOpenCodeQuestion(generation, generation === OPENCODE_API_V1 ? props : props?.form);
    return question ? event("question.asked", question) : null;
  }
  if (generation === OPENCODE_API_V1 && (type === "question.replied" || type === "question.rejected")) {
    return event("question.resolved", { sessionID: String(props?.sessionID ?? ""), requestID: String(props?.requestID ?? "") });
  }
  if (generation === OPENCODE_API_V2 && (type === "form.replied" || type === "form.cancelled")) {
    return event("question.resolved", { sessionID: String(props?.sessionID ?? ""), requestID: String(props?.id ?? "") });
  }
  return event(type, props);
}

/**
 * Incremental SSE frame reader: feed it text chunks, it returns the JSON
 * payloads of the complete `data:` frames seen so far.
 */
export function createSseReader() {
  let buffer = "";
  return function read(chunk) {
    buffer += chunk;
    const frames = [];
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
      const data = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        frames.push(JSON.parse(data));
      } catch {
        // Not a JSON event; OpenCode only sends JSON frames.
      }
    }
    return frames;
  };
}
