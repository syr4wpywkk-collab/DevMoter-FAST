function eventProps(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload.data ?? payload.properties ?? payload;
}

export function normalizeOpenCodeEvent(payload) {
  const props = eventProps(payload);
  const type = typeof payload?.type === "string" ? payload.type : "";
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
    delta = typeof props?.delta === "string" ? props.delta : "";
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
