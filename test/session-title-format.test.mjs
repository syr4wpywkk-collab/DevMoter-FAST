import test from "node:test";
import assert from "node:assert/strict";
import { displaySessionTitle, isDefaultSessionTitle, shortSessionTime } from "../src/session-title-format.mjs";

// OpenCode's default title embeds the creation time as an ISO (UTC) string.
const at = Date.UTC(2026, 9, 30, 14, 24, 5, 120);
const fresh = "New session - " + new Date(at).toISOString();
const child = "Child session - " + new Date(at).toISOString();

test("only OpenCode's generated titles are treated as defaults", () => {
  assert.equal(isDefaultSessionTitle(fresh), true);
  assert.equal(isDefaultSessionTitle(child), true);
  assert.equal(isDefaultSessionTitle("  "), true);
  assert.equal(isDefaultSessionTitle(null), true);
  assert.equal(isDefaultSessionTitle("設定画面の文言を整理"), false);
  assert.equal(isDefaultSessionTitle("New session notes"), false);
  assert.equal(isDefaultSessionTitle("New session - tomorrow"), false);
});

test("a generated title becomes a localized label in the user's time zone", () => {
  assert.equal(displaySessionTitle(fresh, { timeZone: "Asia/Tokyo" }), "新しいセッション 10/30 23:24");
  assert.equal(displaySessionTitle(fresh, { language: "ja", timeZone: "UTC" }), "新しいセッション 10/30 14:24");
  assert.equal(displaySessionTitle(fresh, { language: "en", timeZone: "Asia/Tokyo" }), "New session 10/30 23:24");
  assert.equal(displaySessionTitle(fresh, { language: "zh-CN", timeZone: "Asia/Tokyo" }), "新会话 10/30 23:24");
  assert.equal(displaySessionTitle(child, { timeZone: "Asia/Tokyo" }), "子セッション 10/30 23:24");
  // Unknown languages fall back to Japanese, the app default.
  assert.equal(displaySessionTitle(fresh, { language: "fr", timeZone: "Asia/Tokyo" }), "新しいセッション 10/30 23:24");
});

test("timestamps with an explicit offset are honoured", () => {
  assert.equal(displaySessionTitle("New session - 2026-10-30T23:24:00+09:00", { timeZone: "UTC" }), "新しいセッション 10/30 14:24");
});

test("empty titles use the creation time, or just the label", () => {
  assert.equal(displaySessionTitle("", { created: at, timeZone: "Asia/Tokyo" }), "新しいセッション 10/30 23:24");
  assert.equal(displaySessionTitle(undefined, { language: "en" }), "New session");
});

test("real titles are shown exactly as stored", () => {
  assert.equal(displaySessionTitle("  Fix login timeout ", { language: "ja" }), "Fix login timeout");
});

test("shortSessionTime rejects invalid input", () => {
  assert.equal(shortSessionTime("not a date"), "");
  assert.equal(shortSessionTime(0), "");
  assert.equal(shortSessionTime(at, "Asia/Tokyo"), "10/30 23:24");
});
