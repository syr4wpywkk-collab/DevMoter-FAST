import test from "node:test";
import assert from "node:assert/strict";
import {
  countTranscriptMessages,
  normalizeExternalThread,
  redactSensitiveText,
  sessionContextToMarkdown,
  sortSessions
} from "../src/session-tools.mjs";

test("sortSessions supports recent, created, messages and stable fallback", () => {
  const sessions = [
    { id: "b", time: { created: 10, updated: 20 } },
    { id: "a", time: { created: 30, updated: 10 } },
    { id: "c", time: { created: 10, updated: 20 } }
  ];
  assert.deepEqual(sortSessions(sessions, "recent").map(x => x.id), ["b", "c", "a"]);
  assert.deepEqual(sortSessions(sessions, "created").map(x => x.id), ["a", "b", "c"]);
  assert.deepEqual(
    sortSessions(sessions, "messages", new Map([["c", 9], ["a", 2]])).map(x => x.id),
    ["c", "a", "b"]
  );
});

test("session export redacts secret-like content and omits hidden reasoning", () => {
  const context = [
    { type: "user", text: "use Bearer abcdefghijklmnop" },
    { type: "assistant", text: "done" },
    { type: "reasoning", text: "private chain" },
    { type: "tool", name: "fetch", state: { status: "completed", result: { apiKey: "supersecret", value: "ok" } } }
  ];
  const markdown = sessionContextToMarkdown(
    { id: "s1", title: "Demo", agent: "build", model: { modelID: "m1" } },
    context,
    { maxToolChars: 500 }
  );
  assert.match(markdown, /# Demo/);
  assert.match(markdown, /\[REDACTED\]/);
  assert.doesNotMatch(markdown, /abcdefghijklmnop/);
  assert.doesNotMatch(markdown, /supersecret/);
  assert.doesNotMatch(markdown, /private chain/);
  assert.equal(countTranscriptMessages(context), 3);
  assert.equal(redactSensitiveText("token=abcdefghijkl"), "[REDACTED]");
});

test("external thread import records origin, surfaces unsupported items and keeps tools inert", () => {
  const imported = normalizeExternalThread({
    id: "external-1",
    origin: "example-agent",
    turns: [{
      items: [
        { type: "userMessage", content: [{ type: "text", text: "hello" }] },
        { type: "toolCall", name: "shell", arguments: { command: "echo hi" } },
        { type: "agentMessage", text: "hi" },
        { type: "mysteryEvent", value: 1 }
      ]
    }]
  });
  assert.equal(imported.origin, "example-agent");
  assert.equal(imported.messages[0].role, "user");
  assert.equal(imported.messages[1].role, "tool");
  assert.match(imported.messages[1].text, /will not be executed/);
  assert.ok(imported.unsupported.includes("mysteryEvent"));
});
