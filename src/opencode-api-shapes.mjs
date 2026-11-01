// Request/response shapes that differ between OpenCode HTTP API generations.
//
// OpenCode 1.x (verified against 1.19.5) and 2.x (verified against 2.0.9)
// expose the same `/api/...` surface for most routes, but a few request bodies
// and the question flow changed shape. This module is the single place that
// knows those differences. It is pure and isomorphic: the DevMoter server
// (server/opencode-api.mjs, the proxy, automation) and the browser UI
// (src/opencode.ts, src/session-control.ts) both build their OpenCode requests
// through it, keyed by the generation the server detected from OpenCode's own
// version endpoint.
//
//   generation "v1": OpenCode 1.x  (version from GET /global/health)
//   generation "v2": OpenCode 2.x  (version from GET /api/info)

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

// Paths are relative to OpenCode's `/api` root: the DevMoter server prefixes
// "/api", the browser sends them through the "/api/opencode" proxy.
function sessionPath(sessionID, suffix = "") {
  const id = String(sessionID ?? "");
  if (!id) throw new Error("OpenCode session id is required");
  return "/session/" + encodeURIComponent(id) + suffix;
}

// ---------------------------------------------------------------------------
// Prompt
//   v1: { prompt: { text, files?, agents? }, delivery?, resume? }
//   v2: { text, files?, agents?, skills?, delivery?, ... }

export function buildOpenCodePromptBody(generation, { text, delivery } = {}) {
  assertOpenCodeGeneration(generation);
  const value = String(text ?? "");
  const body = generation === OPENCODE_API_V1 ? { prompt: { text: value } } : { text: value };
  if (delivery === "steer" || delivery === "queue") body.delivery = delivery;
  return body;
}

export function openCodePromptText(generation, body) {
  assertOpenCodeGeneration(generation);
  const text = generation === OPENCODE_API_V1 ? body?.prompt?.text : body?.text;
  return typeof text === "string" ? text : null;
}

export function withOpenCodePromptText(generation, body, text) {
  assertOpenCodeGeneration(generation);
  if (generation === OPENCODE_API_V1) {
    return { ...body, prompt: { ...(body?.prompt ?? {}), text } };
  }
  return { ...body, text };
}

// ---------------------------------------------------------------------------
// Permission reply
//   v1: POST .../permission/{id}/reply { reply: "once"|"always"|"reject", message? }
//   v2: POST .../permission/{id}/reply { decision: "once"|"always"|"reject", message? }

const PERMISSION_DECISIONS = new Set(["once", "always", "reject"]);

export function buildOpenCodePermissionReply(generation, request, decision, message) {
  assertOpenCodeGeneration(generation);
  if (!PERMISSION_DECISIONS.has(decision)) throw new Error(`Unsupported OpenCode permission decision: ${decision}`);
  const requestID = String(request?.id ?? "");
  if (!requestID) throw new Error("OpenCode permission request id is required");
  const body = generation === OPENCODE_API_V1 ? { reply: decision } : { decision };
  if (typeof message === "string" && message) body.message = message;
  return {
    method: "POST",
    path: sessionPath(request?.sessionID, "/permission/" + encodeURIComponent(requestID) + "/reply"),
    body
  };
}

export function openCodePermissionDecision(generation, body) {
  assertOpenCodeGeneration(generation);
  const value = generation === OPENCODE_API_V1 ? body?.reply : body?.decision;
  return PERMISSION_DECISIONS.has(value) ? value : null;
}

export function openCodePermissionListPath(sessionID) {
  return sessionPath(sessionID, "/permission");
}

// ---------------------------------------------------------------------------
// Questions
//   v1: GET .../question -> QuestionV2Request[]; POST .../question/{id}/reply
//       { answers: string[][] }; POST .../question/{id}/reject
//   v2: questions are forms. GET .../form -> Form.Info[]; POST
//       .../form/{id}/reply { answer: { [fieldKey]: value } }; DELETE
//       .../form/{id} cancels. The built-in question tool creates one field per
//       question (key "q<index>", string or multiselect, custom answers on).
//
// DevMoter's UI works with one normalized shape:
//   { id, sessionID, questions: [{ header, question, options, multiple, custom }],
//     fields?: [{ key, type }] }   // fields only for v2 forms

export function openCodeQuestionListPath(generation, sessionID) {
  assertOpenCodeGeneration(generation);
  return sessionPath(sessionID, generation === OPENCODE_API_V1 ? "/question" : "/form");
}

function normalizeV1Question(request) {
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

function normalizeV2Form(form) {
  if (!form || typeof form !== "object" || !form.id) return null;
  const fields = (Array.isArray(form.fields) ? form.fields : []).filter(field => field && field.hidden !== true);
  return {
    id: String(form.id),
    sessionID: String(form.sessionID ?? ""),
    questions: fields.map(formFieldQuestion),
    fields: fields.map(field => ({ key: String(field.key ?? ""), type: String(field.type ?? "string") }))
  };
}

function listPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function normalizeOpenCodeQuestions(generation, payload) {
  assertOpenCodeGeneration(generation);
  const normalize = generation === OPENCODE_API_V1 ? normalizeV1Question : normalizeV2Form;
  return listPayload(payload).map(normalize).filter(Boolean);
}

function formValue(type, answer) {
  const values = Array.isArray(answer) ? answer.map(value => String(value)) : [];
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

export function buildOpenCodeQuestionReply(generation, request, answers) {
  assertOpenCodeGeneration(generation);
  const requestID = String(request?.id ?? "");
  if (!requestID) throw new Error("OpenCode question id is required");
  const list = Array.isArray(answers) ? answers : [];
  if (generation === OPENCODE_API_V1) {
    return {
      method: "POST",
      path: sessionPath(request?.sessionID, "/question/" + encodeURIComponent(requestID) + "/reply"),
      body: { answers: list.map(answer => (Array.isArray(answer) ? answer.map(value => String(value)) : [])) }
    };
  }
  const fields = Array.isArray(request?.fields) ? request.fields : [];
  if (!fields.length) throw new Error("OpenCode form fields are missing; reload the question");
  const answer = {};
  fields.forEach((field, index) => {
    const value = formValue(field.type, list[index]);
    if (value !== undefined) answer[field.key] = value;
  });
  return {
    method: "POST",
    path: sessionPath(request?.sessionID, "/form/" + encodeURIComponent(requestID) + "/reply"),
    body: { answer }
  };
}

export function buildOpenCodeQuestionReject(generation, request) {
  assertOpenCodeGeneration(generation);
  const requestID = String(request?.id ?? "");
  if (!requestID) throw new Error("OpenCode question id is required");
  if (generation === OPENCODE_API_V1) {
    return {
      method: "POST",
      path: sessionPath(request?.sessionID, "/question/" + encodeURIComponent(requestID) + "/reject")
    };
  }
  return {
    method: "DELETE",
    path: sessionPath(request?.sessionID, "/form/" + encodeURIComponent(requestID))
  };
}
