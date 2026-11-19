// Qwen Code chat history kept on this device: several conversations, each
// with the qwen session id used for `--resume`. Pure helpers so tests can load
// them standalone.

import { formatRelativeTime, t } from "./i18n-core.mjs";

export const QWEN_CHATS_KEY = "devmoter-qwen-chats";
// The first Qwen Code chat (#530) kept one resume id under this key.
export const LEGACY_QWEN_SESSION_KEY = "devmoter-qwen-session";
// Unreadable history is copied here before the next save overwrites it.
export const QWEN_CHATS_DAMAGED_KEY = "devmoter-qwen-chats:damaged";
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
  if (!clean) return t("qwenStore.newChat");
  const chars = Array.from(clean);
  return chars.length > TITLE_LIMIT ? `${chars.slice(0, TITLE_LIMIT - 1).join("")}…` : clean;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createQwenChat(projectId = "", now = Date.now()) {
  return { id: newId(), title: t("qwenStore.newChat"), sessionId: null, projectId: String(projectId || ""), updatedAt: now, messages: [] };
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

// One record per id; a duplicate (two tabs, an old bug) keeps the newest copy.
function uniqueChats(chats) {
  const byId = new Map();
  for (const chat of chats) {
    const seen = byId.get(chat.id);
    if (!seen || chat.updatedAt > seen.updatedAt) byId.set(chat.id, chat);
  }
  return [...byId.values()];
}

// `damaged` is true when saved history could not be read as a whole; the raw
// text is kept under QWEN_CHATS_DAMAGED_KEY so it is not silently lost.
export function readQwenHistory(storage) {
  let chats = [];
  let damaged = false;
  let raw = null;
  try {
    raw = storage.getItem(QWEN_CHATS_KEY);
  } catch {
    raw = null;
  }
  if (raw !== null) {
    try {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved?.chats)) chats = uniqueChats(saved.chats.map(cleanChat).filter(Boolean));
      else damaged = true;
    } catch {
      damaged = true;
    }
  }
  if (damaged) {
    try {
      if (storage.getItem(QWEN_CHATS_DAMAGED_KEY) === null) storage.setItem(QWEN_CHATS_DAMAGED_KEY, raw);
    } catch {
      // Nothing more to keep; the notice still tells the user.
    }
  }
  try {
    const legacy = storage.getItem(LEGACY_QWEN_SESSION_KEY);
    if (legacy !== null) {
      storage.removeItem(LEGACY_QWEN_SESSION_KEY);
      if (isQwenSessionId(legacy) && !chats.some(chat => chat.sessionId === legacy)) {
        chats.push({ ...createQwenChat(), title: t("qwenStore.previousChat"), sessionId: legacy, updatedAt: 1 });
      }
    }
  } catch {
    // Storage can be unavailable (private mode); history stays in memory.
  }
  return { chats: sortQwenChats(chats).slice(0, QWEN_CHAT_LIMIT), damaged };
}

export function loadQwenChats(storage) {
  return readQwenHistory(storage).chats;
}

// Another tab saved history: take its copy, but keep what only this tab has —
// the chat still streaming here, chats with nothing saved yet, and chats this
// tab changed later than the stored copy (e.g. its own save was refused).
export function mergeStoredQwenChats(stored, current, liveChatId = null) {
  const currentById = new Map(current.map(chat => [chat.id, chat]));
  const storedIds = new Set(stored.map(chat => chat.id));
  const merged = stored.map(chat => {
    const local = currentById.get(chat.id);
    return local && (local.id === liveChatId || local.updatedAt > chat.updatedAt) ? local : chat;
  });
  const localOnly = current.filter(chat =>
    !storedIds.has(chat.id) && (chat.id === liveChatId || (!chat.messages.length && !chat.sessionId)));
  return sortQwenChats([...merged, ...localOnly]).slice(0, QWEN_CHAT_LIMIT);
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
export function qwenChatTime(updatedAt, now = Date.now(), locale = undefined) {
  return formatRelativeTime(updatedAt, now, locale);
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
