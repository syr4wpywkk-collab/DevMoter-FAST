/**
 * Display-only labels for OpenCode sessions. Stored titles are never changed:
 * OpenCode names a fresh session "New session - <ISO time>", which is noise in
 * a narrow history drawer, so the drawer shows the first prompt instead, or
 * "新しいセッション 10/30 23:24" (session-title-format.mjs) when no prompt is known yet.
 */
import { displaySessionTitle, isDefaultSessionTitle, shortSessionTime } from "./session-title-format.mjs";

export { shortSessionTime };

export function isDefaultOpenCodeTitle(title) {
  return isDefaultSessionTitle(title);
}

/** First line of a prompt, whitespace collapsed, cut on a character boundary. */
export function summarizePrompt(text, max = 40) {
  const line = String(text ?? "").split(/\r?\n/).map(part => part.trim()).find(Boolean) || "";
  const value = line.replace(/\s+/g, " ");
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, Math.max(1, max - 1)).join("").trimEnd() + "…";
}

/**
 * @param {{ title?: string, time?: { created?: number } }} session
 * @param {{ firstPrompt?: string, language?: string, timeZone?: string, max?: number }} [options]
 */
export function openCodeSessionLabel(session, options = {}) {
  const title = String(session?.title ?? "").trim();
  if (!isDefaultOpenCodeTitle(title)) return title;
  const prompt = summarizePrompt(options.firstPrompt, options.max ?? 40);
  if (prompt) return prompt;
  return displaySessionTitle(title, { language: options.language, timeZone: options.timeZone, created: session?.time?.created });
}
