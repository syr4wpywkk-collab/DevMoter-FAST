/**
 * Display-only labels for OpenCode sessions. Stored titles are never changed:
 * OpenCode names a fresh session "New session - <ISO time>", which is noise in
 * a narrow history drawer, so the drawer shows the first prompt instead, or a
 * short local time when no prompt is known yet.
 */
const DEFAULT_TITLE = /^(?:new|child) session\s*-\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s*$/i;

export function isDefaultOpenCodeTitle(title) {
  const value = String(title ?? "").trim();
  return !value || DEFAULT_TITLE.test(value);
}

/** First line of a prompt, whitespace collapsed, cut on a character boundary. */
export function summarizePrompt(text, max = 40) {
  const line = String(text ?? "").split(/\r?\n/).map(part => part.trim()).find(Boolean) || "";
  const value = line.replace(/\s+/g, " ");
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, Math.max(1, max - 1)).join("").trimEnd() + "…";
}

/** "10/31 17:03" in the given (or local) time zone; "" for an invalid time. */
export function shortSessionTime(time, timeZone) {
  const date = time instanceof Date ? time : new Date(typeof time === "string" ? time : Number(time));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * @param {{ title?: string, time?: { created?: number } }} session
 * @param {{ firstPrompt?: string, timeZone?: string, max?: number }} [options]
 */
export function openCodeSessionLabel(session, options = {}) {
  const title = String(session?.title ?? "").trim();
  if (!isDefaultOpenCodeTitle(title)) return title;
  const prompt = summarizePrompt(options.firstPrompt, options.max ?? 40);
  if (prompt) return prompt;
  const stamp = title.match(DEFAULT_TITLE)?.[1];
  const time = shortSessionTime(stamp || session?.time?.created || 0, options.timeZone);
  return time || "New session";
}
