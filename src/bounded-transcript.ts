const TRUNCATION_CLASS = "devmoter-transcript-truncated";

export function enforceTranscriptLimit(container: HTMLElement, maxNodes = 500) {
  const contentNodes = Array.from(container.children)
    .filter(node => !node.classList.contains(TRUNCATION_CLASS));

  const removeCount = Math.max(0, contentNodes.length - maxNodes);
  if (!removeCount) return 0;

  for (const node of contentNodes.slice(0, removeCount)) node.remove();

  let notice = container.querySelector<HTMLElement>(`.${TRUNCATION_CLASS}`);
  if (!notice) {
    notice = document.createElement("div");
    notice.className = TRUNCATION_CLASS;
    container.prepend(notice);
  }

  const previous = Number(notice.dataset.trimmed || 0);
  const total = previous + removeCount;
  notice.dataset.trimmed = String(total);
  notice.textContent = `Older rendered output was hidden to keep this session responsive (${total} blocks). Reopen/reload the session to replay recent canonical history.`;
  return removeCount;
}
