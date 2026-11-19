import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatDateTime, formatRelativeTime } from "../src/i18n-core.mjs";

const source = file => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

// #343: every persistent history list shows the same relative time, with the exact time on hover.
test("#343: Codex, OpenCode and Qwen history rows share one relative time format", async () => {
  const [codex, opencode, qwen, qwenHistory] = await Promise.all(["codex.ts", "opencode.ts", "qwen-chat.ts", "qwen-chat-history.mjs"].map(source));
  assert.match(codex, /thread\.updatedAt < 1e12 \? thread\.updatedAt \* 1000 : thread\.updatedAt/, "Codex seconds become milliseconds");
  assert.match(codex, /stamp\.textContent = formatRelativeTime\(updatedMs\)/);
  assert.match(codex, /stamp\.title = formatDateTime\(updatedMs\)/);
  assert.doesNotMatch(codex, /codex\.threads\.age/);
  assert.match(opencode, /historyTime \? formatRelativeTime\(historyTime\)/);
  assert.match(opencode, /meta\.title = formatDateTime\(historyTime\)/);
  const openSidebar = opencode.slice(opencode.indexOf("function openSidebar()"), opencode.indexOf("function closeSidebar("));
  assert.match(openSidebar, /renderSessions\(\)/, "opening history refreshes relative ages");
  assert.match(qwenHistory, /return formatRelativeTime\(updatedAt, now, locale\)/);
  assert.match(qwen, /meta\.title = formatDateTime\(chat\.updatedAt\)/);
});

test("#343: the shared format is relative for a week, then a date", () => {
  const now = Date.UTC(2026, 10, 20, 12);
  assert.match(formatRelativeTime(now - 5 * 60_000, now, "en"), /5 minutes ago/);
  assert.match(formatRelativeTime(now - 3 * 3_600_000, now, "en"), /3 hours ago/);
  assert.equal(formatRelativeTime(now - 10 * 86_400_000, now, "en"), formatDateTime(now - 10 * 86_400_000, { month: "numeric", day: "numeric" }, "en"));
  assert.equal(formatRelativeTime(0, now, "en"), "");
});
