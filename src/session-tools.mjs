const SECRET_KEY = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|credential|private[_-]?key)/i;
const SECRET_TEXT_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/g,
  /\b[A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s,"']{6,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
];

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function messageCountFor(session, counts) {
  const direct = asNumber(session?.messageCount ?? session?.messagesCount ?? session?.message_count);
  if (direct > 0) return direct;
  if (counts instanceof Map) return asNumber(counts.get(session?.id));
  if (counts && typeof counts === "object") return asNumber(counts[session?.id]);
  return 0;
}

export function sortSessions(sessions, mode = "recent", counts = {}) {
  const items = Array.isArray(sessions) ? [...sessions] : [];
  const compareStable = (a, b) => {
    const updated = asNumber(b?.time?.updated) - asNumber(a?.time?.updated);
    if (updated) return updated;
    const created = asNumber(b?.time?.created) - asNumber(a?.time?.created);
    if (created) return created;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  };

  items.sort((a, b) => {
    if (mode === "created") {
      const value = asNumber(b?.time?.created) - asNumber(a?.time?.created);
      return value || compareStable(a, b);
    }
    if (mode === "messages") {
      const value = messageCountFor(b, counts) - messageCountFor(a, counts);
      return value || compareStable(a, b);
    }
    return compareStable(a, b);
  });
  return items;
}

export function redactSensitiveText(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated object]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1));
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    result[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeValue(item, depth + 1);
  }
  return result;
}

function safeJson(value) {
  try {
    return JSON.stringify(sanitizeValue(value), null, 2);
  } catch {
    return "[unserializable]";
  }
}

function truncate(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: value.slice(0, maxChars) + "\n\n[DevMoter: output truncated]",
    truncated: true
  };
}

function projectedRole(message) {
  if (message?.type === "user") return "user";
  if (message?.type === "assistant") return "assistant";
  const role = message?.info?.role;
  return role === "user" || role === "assistant" ? role : null;
}

function messageText(message) {
  if (typeof message?.text === "string") return message.text;
  const content = Array.isArray(message?.content) ? message.content : [];
  const current = content
    .filter(part => part?.type === "text" || typeof part === "string")
    .map(part => typeof part === "string" ? part : String(part?.text || ""))
    .join("");
  if (current) return current;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter(part => part?.type === "text")
    .map(part => String(part?.text || ""))
    .join("");
}

export function countTranscriptMessages(context) {
  const list = Array.isArray(context) ? context : [];
  let count = 0;
  for (const item of list) {
    if (projectedRole(item)) count += 1;
    else if (item?.type === "tool" || item?.type === "tool-call" || item?.type === "tool_result") count += 1;
  }
  return count;
}

function toolMarkdown(item, maxToolChars) {
  const name = String(item?.name || item?.tool || item?.part?.name || "tool");
  const state = item?.state ?? item?.part?.state ?? {};
  const status = String(state?.status || item?.status || "event");
  const raw = state?.result ?? state?.structured ?? state?.error ?? state?.content ?? item?.result ?? null;
  const lines = ["### Tool: " + redactSensitiveText(name), "", "- Status: " + redactSensitiveText(status)];
  if (raw !== null && raw !== undefined) {
    const serialized = typeof raw === "string" ? redactSensitiveText(raw) : safeJson(raw);
    const bounded = truncate(serialized, maxToolChars);
    lines.push("", "~~~text", bounded.text, "~~~");
  }
  return lines.join("\n");
}

export function sessionContextToMarkdown(session, context, options = {}) {
  const maxToolChars = Math.max(256, Number(options.maxToolChars) || 4000);
  const title = redactSensitiveText(session?.title || "Untitled session");
  const model = session?.model?.modelID || session?.model?.id || "default";
  const directory = typeof session?.location === "string"
    ? session.location
    : session?.location?.directory || "workspace";
  const lines = [
    "# " + title,
    "",
    "- Session: " + redactSensitiveText(session?.id || "unknown"),
    "- Agent: " + redactSensitiveText(session?.agent || "unknown"),
    "- Model: " + redactSensitiveText(model),
    "- Directory: " + redactSensitiveText(directory)
  ];

  if (session?.time?.created) lines.push("- Created: " + new Date(session.time.created).toISOString());
  if (session?.time?.updated) lines.push("- Updated: " + new Date(session.time.updated).toISOString());
  lines.push("", "> Exported by DevMoter. Secret-like values are redacted. Hidden reasoning is not exported.", "");

  const list = Array.isArray(context) ? context : [];
  for (const item of list) {
    const role = projectedRole(item);
    if (role === "user" || role === "assistant") {
      const text = redactSensitiveText(messageText(item)).trim();
      if (!text) continue;
      lines.push("## " + (role === "user" ? "User" : "Assistant"), "", text, "");
      continue;
    }

    if (item?.type === "tool" || item?.type === "tool-call" || item?.type === "tool_result" || item?.part?.type === "tool") {
      lines.push(toolMarkdown(item, maxToolChars), "");
      continue;
    }

    if (item?.type === "agent-switched") {
      lines.push("### Agent changed", "", redactSensitiveText(item?.agent || "unknown"), "");
    } else if (item?.type === "model-switched") {
      lines.push("### Model changed", "", redactSensitiveText(item?.model?.modelID || item?.model?.id || "unknown"), "");
    }
  }

  return lines.join("\n").trim() + "\n";
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part?.type === "text" || typeof part === "string")
      .map(part => typeof part === "string" ? part : String(part?.text || ""))
      .join("");
  }
  return "";
}

function pushMessage(result, role, content) {
  if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") return false;
  const text = redactSensitiveText(contentText(content)).trim();
  if (!text && role !== "tool") return false;
  result.messages.push({ role, text });
  return true;
}

export function normalizeExternalThread(input) {
  if (!input || typeof input !== "object") throw new Error("Thread JSON must be an object");
  const result = {
    id: String(input.id || "import-" + Date.now()),
    title: String(input.title || input.name || "Imported thread"),
    origin: String(input.origin || input.provider || input.source || "external"),
    importedAt: Date.now(),
    messages: [],
    unsupported: []
  };

  const messages = Array.isArray(input.messages) ? input.messages : null;
  if (messages) {
    for (const message of messages) {
      const role = String(message?.role || message?.type || "");
      if (!pushMessage(result, role, message?.content ?? message?.text ?? "")) {
        result.unsupported.push(role || "unknown");
      }
    }
    return result;
  }

  const turns = Array.isArray(input.turns) ? input.turns : null;
  if (turns) {
    for (const turn of turns) {
      for (const item of Array.isArray(turn?.items) ? turn.items : []) {
        if (item?.type === "userMessage") {
          if (!pushMessage(result, "user", item?.content)) result.unsupported.push("userMessage");
        } else if (item?.type === "agentMessage") {
          if (!pushMessage(result, "assistant", item?.text || "")) result.unsupported.push("agentMessage");
        } else if (item?.type === "tool" || item?.type === "toolCall" || item?.type === "toolResult") {
          result.messages.push({
            role: "tool",
            text: "[Historical tool event retained as inert text; it will not be executed.]"
          });
        } else {
          result.unsupported.push(String(item?.type || "unknown"));
        }
      }
    }
    return result;
  }

  const events = Array.isArray(input.events) ? input.events : null;
  if (events) {
    for (const event of events) {
      const role = String(event?.role || event?.type || "");
      if (role === "tool" || role === "tool_call" || role === "tool_result") {
        result.messages.push({
          role: "tool",
          text: "[Historical tool event retained as inert text; it will not be executed.]"
        });
      } else if (!pushMessage(result, role, event?.content ?? event?.text ?? "")) {
        result.unsupported.push(role || "unknown");
      }
    }
    return result;
  }

  throw new Error("No compatible messages, turns, or events array found");
}
