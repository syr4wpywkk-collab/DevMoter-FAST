// Unsent composer text, kept per provider and per project so a draft typed
// for one never appears in (or is sent from) another. Drafts are only ever
// written back into the input: nothing here sends a message.
export const CHAT_DRAFT_PREFIX = "devmoter-chat-draft:v1:";
export const CHAT_DRAFT_MAX_CHARS = 20000;
export const CHAT_DRAFT_PROVIDERS = Object.freeze(["codex", "opencode", "api-chat", "deepseek-chat", "qwen"]);

const NO_PROJECT = "_";

export function chatDraftKey(provider, projectId) {
  if (!CHAT_DRAFT_PROVIDERS.includes(provider)) throw new TypeError("Unknown chat draft provider");
  const project = typeof projectId === "string" && projectId ? projectId : NO_PROJECT;
  return CHAT_DRAFT_PREFIX + provider + ":" + encodeURIComponent(project);
}

export function readChatDraft(storage, provider, projectId) {
  try {
    const value = storage?.getItem(chatDraftKey(provider, projectId));
    return typeof value === "string" && value.length <= CHAT_DRAFT_MAX_CHARS ? value : "";
  } catch {
    return "";
  }
}

// Returns false when nothing is stored. An oversized draft is dropped instead
// of truncated, so a partial prompt is never restored as if it were complete.
export function writeChatDraft(storage, provider, projectId, text) {
  try {
    const key = chatDraftKey(provider, projectId);
    if (typeof text !== "string" || !text.trim() || text.length > CHAT_DRAFT_MAX_CHARS) {
      storage?.removeItem(key);
      return false;
    }
    storage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function createChatDraftBinding({
  provider,
  input,
  storage,
  getProjectId,
  takeExtras,
  restoreExtras,
  onRestore
}) {
  const project = () => {
    try {
      return String(getProjectId() || "");
    } catch {
      return "";
    }
  };
  // Attachments and context references are not persisted; they stay in memory
  // with the project they were added for.
  const extras = new Map();
  let boundProject = project();

  function capture() {
    writeChatDraft(storage, provider, boundProject, input.value);
  }

  function sync() {
    const next = project();
    if (next === boundProject) return false;
    capture();
    if (takeExtras) extras.set(boundProject, takeExtras());
    boundProject = next;
    input.value = readChatDraft(storage, provider, next);
    if (restoreExtras) restoreExtras(extras.get(next));
    extras.delete(next);
    onRestore?.();
    return true;
  }

  const restored = readChatDraft(storage, provider, boundProject);
  if (restored && !input.value) {
    input.value = restored;
    onRestore?.();
  }

  input.addEventListener("input", capture);
  input.addEventListener("blur", capture);
  input.addEventListener("focus", sync);
  // Voice input and command expansion set the value without an input event.
  input.ownerDocument?.defaultView?.addEventListener("pagehide", capture);

  return { capture, sync };
}
