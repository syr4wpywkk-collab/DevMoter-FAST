/**
 * Display-only formatting for auto-generated session titles. Stored titles are
 * never changed. OpenCode names a fresh session "New session - <ISO time>"
 * (or "Child session - …"); shown raw that is a UTC timestamp, so the UI shows
 * "新しいセッション 10/30 23:24" in the user's local time instead.
 */
const DEFAULT_TITLE = /^(new|child) session\s*-\s*(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)\s*$/i;

const PREFIX = {
  ja: { new: "新しいセッション", child: "子セッション" },
  en: { new: "New session", child: "Child session" },
  "zh-CN": { new: "新会话", child: "子会话" }
};

/** True for an empty title or one OpenCode generated from the creation time. */
export function isDefaultSessionTitle(title) {
  const value = String(title ?? "").trim();
  return !value || DEFAULT_TITLE.test(value);
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
 * @param {unknown} title stored title
 * @param {{ language?: string, timeZone?: string, created?: number | string | Date }} [options]
 * @returns {string} the stored title when it is a real one, otherwise "<prefix> <M/D HH:mm>"
 */
export function displaySessionTitle(title, options = {}) {
  const value = String(title ?? "").trim();
  if (!isDefaultSessionTitle(value)) return value;
  const match = value.match(DEFAULT_TITLE);
  const prefix = (PREFIX[options.language] || PREFIX.ja)[match?.[1]?.toLowerCase() === "child" ? "child" : "new"];
  const time = shortSessionTime(match?.[2] || 0, options.timeZone) || shortSessionTime(options.created ?? 0, options.timeZone);
  return time ? `${prefix} ${time}` : prefix;
}
