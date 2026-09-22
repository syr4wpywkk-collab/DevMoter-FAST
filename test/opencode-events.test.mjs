import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  mergeOpenCodeStreamText,
  normalizeOpenCodeEvent
} from "../src/opencode-event-compat.mjs";

test("normalizes current OpenCode message.part.updated events", () => {
  const event = normalizeOpenCodeEvent({
    type: "message.part.updated",
    properties: {
      sessionID: "session-1",
      part: {
        id: "part-1",
        messageID: "message-1",
        type: "text",
        text: "Hello"
      }
    }
  });

  assert.equal(event.sessionID, "session-1");
  assert.equal(event.category, "part");
  assert.equal(event.kind, "text");
  assert.equal(event.phase, "updated");
  assert.equal(event.messageID, "message-1");
  assert.equal(event.partID, "part-1");
  assert.equal(mergeOpenCodeStreamText("stale live text", event), "Hello");
});

test("normalizes current OpenCode message.part.delta events", () => {
  const event = normalizeOpenCodeEvent({
    type: "message.part.delta",
    data: {
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      delta: " world"
    }
  });

  assert.equal(event.category, "part");
  assert.equal(event.phase, "delta");
  assert.equal(event.sessionID, "session-1");
  assert.equal(mergeOpenCodeStreamText("Hello", event), "Hello world");
});

test("normalizes session.status and session.idle execution state", () => {
  assert.equal(
    normalizeOpenCodeEvent({
      type: "session.status",
      properties: { status: { type: "busy" } }
    }).executionState,
    "running"
  );

  assert.equal(
    normalizeOpenCodeEvent({
      type: "session.status",
      properties: { status: { type: "idle" } }
    }).executionState,
    "completed"
  );

  assert.equal(
    normalizeOpenCodeEvent({ type: "session.idle", properties: {} }).executionState,
    "completed"
  );
});

test("keeps compatibility with legacy projected text and reasoning events", () => {
  const textDelta = normalizeOpenCodeEvent({
    type: "session.text.delta",
    properties: {
      assistantMessageID: "assistant-1",
      partID: 2,
      delta: "abc"
    }
  });
  assert.equal(textDelta.kind, "text");
  assert.equal(textDelta.phase, "delta");

  const reasoningEnd = normalizeOpenCodeEvent({
    type: "session.reasoning.ended",
    properties: {
      assistantMessageID: "assistant-1",
      partID: 3,
      text: "done thinking"
    }
  });
  assert.equal(reasoningEnd.kind, "reasoning");
  assert.equal(reasoningEnd.phase, "ended");
  assert.equal(reasoningEnd.text, "done thinking");
});

test("fallback reconciliation replaces persisted context instead of appending duplicate live output", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  const loadContext = source.slice(
    source.indexOf("async function loadContext()"),
    source.indexOf("async function loadLocation()")
  );
  const fallback = source.slice(
    source.indexOf("function startLiveFallback()"),
    source.indexOf("function handleEvent(")
  );

  assert.match(fallback, /await loadContext\(\)/);
  assert.match(loadContext, /transcript\.replaceChildren\(\)/);
  assert.match(loadContext, /clearLiveStreams\(\)/);

  const resetIndex = loadContext.indexOf("transcript.replaceChildren()");
  const renderIndex = loadContext.indexOf("renderMessage(message)");
  assert.ok(resetIndex >= 0 && renderIndex > resetIndex);
});
