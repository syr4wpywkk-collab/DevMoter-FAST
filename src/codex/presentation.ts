/** Pure Codex presentation helpers; no DOM, events, or session state. */

export function formatCodexResetTime(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function codexFeedbackKey(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `opencode-pocket-feedback-${(hash >>> 0).toString(36)}`;
}
