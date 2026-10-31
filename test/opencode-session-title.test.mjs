import test from "node:test";
import assert from "node:assert/strict";
import { isDefaultOpenCodeTitle, openCodeSessionLabel, shortSessionTime, summarizePrompt } from "../src/opencode-session-title.mjs";

test("default OpenCode titles are recognised; real titles are not", () => {
  assert.equal(isDefaultOpenCodeTitle("New session - 2026-10-31T17:03:18.156Z"), true);
  assert.equal(isDefaultOpenCodeTitle("Child session - 2026-10-31T17:03:18.156Z"), true);
  assert.equal(isDefaultOpenCodeTitle(""), true);
  assert.equal(isDefaultOpenCodeTitle(undefined), true);
  assert.equal(isDefaultOpenCodeTitle("Fix login timeout"), false);
  assert.equal(isDefaultOpenCodeTitle("New session notes"), false);
});

test("a real title is shown as stored", () => {
  assert.equal(openCodeSessionLabel({ title: "Fix login timeout" }, { firstPrompt: "ignored" }), "Fix login timeout");
});

test("a default title shows the first prompt, summarised to one short line", () => {
  const session = { title: "New session - 2026-10-31T17:03:18.156Z" };
  assert.equal(openCodeSessionLabel(session, { firstPrompt: "  READMEを直して\n詳細は後で  " }), "READMEを直して");
  const long = "a".repeat(30) + " " + "b".repeat(30);
  const label = openCodeSessionLabel(session, { firstPrompt: long });
  assert.equal(Array.from(label).length, 40);
  assert.ok(label.endsWith("…"));
  assert.equal(summarizePrompt("日本語".repeat(20), 10), "日本語日本語日本語…");
  assert.equal(summarizePrompt("   \n  "), "");
});

test("without a prompt a default title becomes a short local time", () => {
  const session = { title: "New session - 2026-10-31T17:03:18.156Z" };
  assert.equal(openCodeSessionLabel(session, { timeZone: "UTC" }), "10/31 17:03");
  assert.equal(openCodeSessionLabel(session, { timeZone: "Asia/Tokyo" }), "11/1 02:03");
  assert.equal(openCodeSessionLabel({ title: "", time: { created: Date.UTC(2026, 0, 5, 9, 7) } }, { timeZone: "UTC" }), "1/5 09:07");
  assert.equal(openCodeSessionLabel({ title: "" }), "New session");
  assert.equal(shortSessionTime("not a date"), "");
});

test("the stored session object is never mutated", () => {
  const session = Object.freeze({ title: "New session - 2026-10-31T17:03:18.156Z", time: Object.freeze({ created: 1 }) });
  openCodeSessionLabel(session, { firstPrompt: "hello" });
  assert.equal(session.title, "New session - 2026-10-31T17:03:18.156Z");
});
