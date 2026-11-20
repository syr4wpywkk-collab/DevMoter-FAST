// Shared conversation-history trigger for the Codex, OpenCode and API Chat headers.
// ☰ (data-workspace-menu-button) switches screens and AI; this history icon only
// opens the current provider's own conversation list, so the two never look alike.
export const CHAT_HISTORY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>';

const escapeAttribute = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function chatHistoryTriggerMarkup({ id, className, ariaLabel, title }) {
  return `<button id="${escapeAttribute(id)}" class="${escapeAttribute(className)}" type="button" data-chat-history-trigger aria-label="${escapeAttribute(ariaLabel)}" title="${escapeAttribute(title)}">${CHAT_HISTORY_ICON}</button>`;
}
