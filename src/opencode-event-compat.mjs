import { normalizeOpenCodeQuestions, OPENCODE_API_V1, OPENCODE_API_V2 } from "./opencode-api-shapes.mjs";

function eventProps(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload.data ?? payload.properties ?? payload;
}

// OpenCode 1.x (1.19.5) and 2.x (2.0.9) name the same SSE events differently.
// Map both onto one canonical vocabulary so the UI handles each event once:
//   1.x session.next.<x>            -> 2.x session.<x>
//   1.x session.next.agent/model.switched -> session.agent/model.selected
//   1.x permission.v2.asked/replied -> permission.asked/replied (2.x names)
//   1.x question.v2.asked, 2.x form.created  -> question.asked (props: normalized question)
//   1.x question.v2.replied/rejected, 2.x form.replied/cancelled -> question.resolved
const RENAMED_EVENTS = Object.freeze({
  "session.next.agent.switched": "session.agent.selected",
  "session.next.model.switched": "session.model.selected",
  "permission.v2.asked": "permission.asked",
  "permission.v2.replied": "permission.replied"
});

function canonicalEvent(rawType, rawProps) {
  if (RENAMED_EVENTS[rawType]) return { type: RENAMED_EVENTS[rawType], props: rawProps };
  if (rawType.startsWith("session.next.")) {
    const props = { ...rawProps };
    // 1.x identifies stream parts by textID/reasoningID; 2.x by ordinal.
    if (props.partID == null) props.partID = props.textID ?? props.reasoningID ?? props.ordinal;
    return { type: "session." + rawType.slice("session.next.".length), props };
  }
  if (rawType === "question.v2.asked") {
    const question = normalizeOpenCodeQuestions(OPENCODE_API_V1, [rawProps])[0] ?? null;
    return { type: "question.asked", props: question };
  }
  if (rawType === "form.created") {
    const question = normalizeOpenCodeQuestions(OPENCODE_API_V2, [rawProps?.form])[0] ?? null;
    return { type: "question.asked", props: question };
  }
  if (rawType === "question.v2.replied" || rawType === "question.v2.rejected") {
    return { type: "question.resolved", props: { sessionID: rawProps?.sessionID, requestID: rawProps?.requestID } };
  }
  if (rawType === "form.replied" || rawType === "form.cancelled") {
    return { type: "question.resolved", props: { sessionID: rawProps?.sessionID, requestID: rawProps?.id } };
  }
  return { type: rawType, props: rawProps };
}

export function normalizeOpenCodeEvent(payload) {
  const rawType = typeof payload?.type === "string" ? payload.type : "";
  const canonical = canonicalEvent(rawType, eventProps(payload));
  const { type, props } = canonical;
  const sessionID =
    props?.sessionID ??
    props?.sessionId ??
    props?.session?.id ??
    null;

  let category = "other";
  let kind = null;
  let phase = null;
  let messageID = null;
  let partID = null;
  let text = null;
  let delta = null;
  let executionState = null;

  if (type === "message.part.updated") {
    const part = props?.part;
    category = part?.type === "tool" ? "tool" : "part";
    kind = typeof part?.type === "string" ? part.type : null;
    phase = "updated";
    messageID = part?.messageID ?? null;
    partID = part?.id ?? null;
    text = typeof part?.text === "string" ? part.text : null;
    delta = typeof props?.delta === "string" ? props.delta : null;
  } else if (type === "message.part.delta") {
    category = "part";
    phase = "delta";
    messageID = props?.messageID ?? null;
    partID = props?.partID ?? null;
    // OpenCode may stream tool or metadata changes through this event too.
    // Only the text field belongs in the visible assistant transcript.
    delta =
      props?.field == null || props.field === "text"
        ? (typeof props?.delta === "string" ? props.delta : "")
        : null;
  } else if (
    type === "session.text.started" ||
    type === "session.text.delta" ||
    type === "session.text.ended" ||
    type === "session.reasoning.started" ||
    type === "session.reasoning.delta" ||
    type === "session.reasoning.ended"
  ) {
    category = "part";
    kind = type.includes(".reasoning.") ? "reasoning" : "text";
    phase = type.endsWith(".started") ? "started" : type.endsWith(".ended") ? "ended" : "delta";
    messageID = props?.assistantMessageID ?? props?.messageID ?? null;
    partID = props?.partID ?? props?.ordinal ?? null;
    text = typeof props?.text === "string" ? props.text : null;
    delta = typeof props?.delta === "string" ? props.delta : null;
  } else if (type === "session.status") {
    category = "status";
    const status = String(props?.status?.type || "");
    if (status === "busy" || status === "retry") executionState = "running";
    if (status === "idle") executionState = "completed";
  } else if (type === "session.idle") {
    category = "status";
    executionState = "completed";
  } else if (type === "session.error") {
    category = "status";
    executionState = "failed";
  }

  return {
    type,
    rawType,
    props,
    sessionID,
    category,
    kind,
    phase,
    messageID,
    partID,
    text,
    delta,
    executionState
  };
}

export function mergeOpenCodeStreamText(current, event) {
  const existing = String(current ?? "");
  if (typeof event?.text === "string") return event.text;
  if (typeof event?.delta === "string") return existing + event.delta;
  return existing;
}
