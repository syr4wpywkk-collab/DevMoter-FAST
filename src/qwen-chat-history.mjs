// Qwen Code chat history kept on this device: several conversations, each
// with the qwen session id used for `--resume`. Pure helpers so tests can load
// them standalone.

export const QWEN_CHATS_KEY = "devmoter-qwen-chats";
// The first Qwen Code chat (#530) kept one resume id under this key.
export const LEGACY_QWEN_SESSION_KEY = "devmoter-qwen-session";
export const QWEN_CHAT_LIMIT = 30;
export const QWEN_MESSAGE_LIMIT = 100;
const MESSAGE_TEXT_LIMIT = 200_000;
const TITLE_LIMIT = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// "note": a quiet line such as "ここから <model> で応答します".
const ROLES = new Set(["user", "assistant", "error", "note"]);

export function isQwenSessionId(value) {
  return typeof value === "string" && UUID.test(value);
}

export function qwenChatTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "新しいチャット";
  const chars = Array.from(clean);
  return chars.length > TITLE_LIMIT ? `${chars.slice(0, TITLE_LIMIT - 1).join("")}…` : clean;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createQwenChat(projectId = "", now = Date.now()) {
  return { id: newId(), title: "新しいチャット", sessionId: null, projectId: String(projectId || ""), updatedAt: now, messages: [] };
}

function cleanMessage(value) {
  if (!value || !ROLES.has(value.role) || typeof value.text !== "string") return null;
  const message = { role: value.role, text: value.text.slice(0, MESSAGE_TEXT_LIMIT) };
  if (value.role === "error" && typeof value.code === "string") message.code = value.code.slice(0, 40);
  return message;
}

function cleanChat(value) {
  if (!value || typeof value.id !== "string" || !value.id || value.id.length > 80) return null;
  const messages = Array.isArray(value.messages) ? value.messages.map(cleanMessage).filter(Boolean).slice(-QWEN_MESSAGE_LIMIT) : [];
  return {
    id: value.id,
    title: qwenChatTitle(value.title),
    sessionId: isQwenSessionId(value.sessionId) ? value.sessionId : null,
    projectId: typeof value.projectId === "string" ? value.projectId.slice(0, 200) : "",
    // Model key of the last turn ("" = Qwen Code default); absent on old chats.
    ...(typeof value.model === "string" ? { model: value.model.slice(0, 260) } : {}),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    messages
  };
}

export function sortQwenChats(chats) {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadQwenChats(storage) {
  let chats = [];
  try {
    const saved = JSON.parse(storage.getItem(QWEN_CHATS_KEY) || "null");
    if (Array.isArray(saved?.chats)) chats = saved.chats.map(cleanChat).filter(Boolean);
  } catch {
    chats = [];
  }
  try {
    const legacy = storage.getItem(LEGACY_QWEN_SESSION_KEY);
    if (legacy !== null) {
      storage.removeItem(LEGACY_QWEN_SESSION_KEY);
      if (isQwenSessionId(legacy) && !chats.some(chat => chat.sessionId === legacy)) {
        chats.push({ ...createQwenChat(), title: "以前のチャット", sessionId: legacy, updatedAt: 1 });
      }
    }
  } catch {
    // Storage can be unavailable (private mode); history stays in memory.
  }
  return sortQwenChats(chats).slice(0, QWEN_CHAT_LIMIT);
}

// Returns false when the browser refused to store (quota, private mode).
export function saveQwenChats(storage, chats) {
  const kept = sortQwenChats(chats)
    .filter(chat => chat.messages.length || chat.sessionId)
    .slice(0, QWEN_CHAT_LIMIT)
    .map(chat => ({ ...chat, messages: chat.messages.slice(-QWEN_MESSAGE_LIMIT) }));
  try {
    storage.setItem(QWEN_CHATS_KEY, JSON.stringify({ version: 1, chats: kept }));
    return true;
  } catch {
    return false;
  }
}

// Relative time for the last week, then an absolute date.
export function qwenChatTime(updatedAt, now = Date.now(), locale = "ja") {
  const diff = Math.max(0, now - updatedAt);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (diff >= 7 * day) {
    return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(new Date(updatedAt));
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < minute) return rtf.format(0, "second");
  if (diff < hour) return rtf.format(-Math.floor(diff / minute), "minute");
  if (diff < day) return rtf.format(-Math.floor(diff / hour), "hour");
  return rtf.format(-Math.floor(diff / day), "day");
}

// Splits a streamed NDJSON body into parsed objects across chunk boundaries.
export function createNdjsonReader() {
  let buffer = "";
  const parse = line => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.map(parse).filter(Boolean);
    },
    flush() {
      const last = parse(buffer);
      buffer = "";
      return last ? [last] : [];
    }
  };
}
