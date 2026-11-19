// Text of the most recent assistant answer in one conversation, or "" when
// there is none. Only the entries handed in are considered.
export function latestAssistantText(entries) {
  const list = Array.from(entries ?? []);
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const text = list[index];
    if (typeof text === "string" && text.trim()) return text;
  }
  return "";
}

// Inline notice for a failed history load. Retrying only re-reads history:
// the callback receives no draft and the notice never submits the composer.
export function createHistoryRetryNotice(doc, { className, message, retryLabel, onRetry }) {
  const notice = doc.createElement("div");
  notice.className = className;
  notice.setAttribute("role", "alert");
  notice.dataset.historyRetry = "true";

  const text = doc.createElement("p");
  text.textContent = message;

  const retry = doc.createElement("button");
  retry.type = "button";
  retry.textContent = retryLabel;
  retry.addEventListener("click", async () => {
    if (retry.disabled) return;
    retry.disabled = true;
    try {
      await onRetry();
    } finally {
      retry.disabled = false;
    }
  });

  notice.append(text, retry);
  return notice;
}
