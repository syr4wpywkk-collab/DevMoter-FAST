/**
 * Shared UI visibility gates.
 *
 * Qwen Code UI was hidden on 2026-11-15 by owner decision while keeping all
 * Qwen implementation code (server integration, SDK, src/qwen* chat UI, CSS,
 * and all i18n dictionary keys) intact behind this gate.
 * To re-enable Qwen Code everywhere in the UI, change QWEN_UI_ENABLED to true.
 */
export const QWEN_UI_ENABLED = false;

/**
 * DeepSeek UI was hidden on 2026-11-20 by owner decision ("for now") while
 * keeping all DeepSeek implementation code (the dedicated API Chat mount in
 * src/main.ts, i18n dictionary keys, and provider presets) intact behind
 * this gate.
 * To re-enable DeepSeek everywhere in the UI, change DEEPSEEK_UI_ENABLED to true.
 */
export const DEEPSEEK_UI_ENABLED = false;

export const DEFAULT_VISIBLE_BACKEND = "opencode";

export const VISIBLE_CHAT_BACKENDS = Object.freeze([
  "codex",
  "opencode",
  "api",
  ...(DEEPSEEK_UI_ENABLED ? ["deepseek"] : []),
  "devin",
  ...(QWEN_UI_ENABLED ? ["qwen"] : [])
]);

const VISIBLE_CHAT_BACKEND_SET = new Set(VISIBLE_CHAT_BACKENDS);

export function isVisibleChatBackend(value) {
  return typeof value === "string" && VISIBLE_CHAT_BACKEND_SET.has(value);
}

export function normalizeVisibleBackend(value, fallback = DEFAULT_VISIBLE_BACKEND) {
  return isVisibleChatBackend(value) ? value : fallback;
}

export function isHiddenQwenTarget(value) {
  return !QWEN_UI_ENABLED && value === "qwen";
}

export function isHiddenDeepseekTarget(value) {
  return !DEEPSEEK_UI_ENABLED && value === "deepseek";
}

export function normalizeVisibleSurface(value, fallback = "home") {
  if (value === "home" || value === "integrations") return value;
  return normalizeVisibleBackend(value, isHiddenQwenTarget(value) || isHiddenDeepseekTarget(value) ? DEFAULT_VISIBLE_BACKEND : fallback);
}

export function isVisibleIntegration(id) {
  return typeof id === "string" && id.length > 0 && (QWEN_UI_ENABLED || id !== "qwen");
}
