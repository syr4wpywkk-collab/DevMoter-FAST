import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { classicMessagesToContext, lastTurnFailure } from "../server/opencode-adapter.mjs";

const user = { info: { id: "u1", role: "user" }, parts: [{ type: "text", text: "go" }] };
const assistant = (info = {}, text = "done") => ({
  info: { id: "a1", role: "assistant", time: { completed: 2 }, ...info },
  parts: text ? [{ type: "text", text }] : []
});

test("a completed OpenCode turn is not a failure", () => {
  assert.equal(lastTurnFailure(classicMessagesToContext([user, assistant()])), null);
  assert.equal(lastTurnFailure([]), null);
  assert.equal(lastTurnFailure(null), null);
});

test("a turn that errors after starting is a failure with the backend's reason", () => {
  const context = classicMessagesToContext([
    user,
    assistant({ error: { name: "ProviderAuthError", data: { message: "Invalid API key" } } }, "partial")
  ]);
  assert.deepEqual(lastTurnFailure(context), { outcome: "failed", reason: "Invalid API key" });
});

test("an error without a message reports no reason instead of inventing one", () => {
  const context = classicMessagesToContext([user, assistant({ error: { name: "UnknownError" } }, "")]);
  assert.deepEqual(lastTurnFailure(context), { outcome: "failed", reason: "" });
});

test("an aborted turn is reported as interrupted", () => {
  const context = classicMessagesToContext([user, assistant({ error: { name: "MessageAbortedError" } }, "")]);
  assert.equal(lastTurnFailure(context).outcome, "interrupted");
});

test("an error from an earlier turn does not fail the latest one", () => {
  const context = classicMessagesToContext([
    user,
    assistant({ id: "a0", error: { name: "ProviderAuthError", data: { message: "old" } } }),
    { info: { id: "u2", role: "user" }, parts: [{ type: "text", text: "again" }] },
    assistant({ id: "a2" })
  ]);
  assert.equal(lastTurnFailure(context), null);
});

test("an idle marker with a failed outcome fails the turn", () => {
  assert.deepEqual(
    lastTurnFailure([{ type: "user", id: "u" }, { type: "assistant", id: "a", content: [] }, { type: "idle", id: "i", outcome: "failed" }]),
    { outcome: "failed", reason: "" }
  );
});

test("the control task throws on a failed OpenCode turn before reporting a summary", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function executeControlTaskCore");
  const body = source.slice(start, source.indexOf("\nasync function ", start + 1));
  const check = body.indexOf("lastTurnFailure(turnContext)");
  assert.ok(check > 0 && check < body.indexOf("lastAssistantText(turnContext)"));
  assert.match(body.slice(check, check + 400), /throw new Error/);
});
