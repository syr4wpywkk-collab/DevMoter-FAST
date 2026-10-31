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

test("non-text OpenCode part deltas never become assistant text", async () => {
  for (const field of ["state", "state.input", "metadata", "time"]) {
    const event = normalizeOpenCodeEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "session-1",
        messageID: "assistant-1",
        partID: "tool-part-1",
        field,
        delta: '{"command":"private-tool-input"}'
      }
    });

    assert.equal(event.delta, null, field);
    assert.equal(mergeOpenCodeStreamText("visible assistant text", event), "visible assistant text");
  }

  // Both the current text-field schema and field-less legacy payloads remain supported.
  for (const field of ["text", undefined]) {
    const event = normalizeOpenCodeEvent({
      type: "message.part.delta",
      properties: { messageID: "assistant-1", partID: "text-1", field, delta: " world" }
    });
    assert.equal(mergeOpenCodeStreamText("Hello", event), "Hello world");
  }

  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('if (type === "message.part.delta")'));
  assert.match(handler, /if \(normalized\.delta === null\) \{[\s\S]*?scheduleRefresh\(220\);[\s\S]*?return;/);
});

test("OpenCode 1.x and 2.x SSE names map onto one canonical event vocabulary", () => {
  // 2.0.9 permission events already use the canonical names.
  assert.equal(normalizeOpenCodeEvent({ type: "permission.asked", data: { id: "per_1", sessionID: "ses_1" } }).type, "permission.asked");
  // 1.19.5 names them permission.v2.*.
  const replied = normalizeOpenCodeEvent({ type: "permission.v2.replied", data: { sessionID: "ses_1", requestID: "per_1", reply: "once" } });
  assert.equal(replied.type, "permission.replied");
  assert.equal(replied.rawType, "permission.v2.replied");
  assert.equal(replied.props.requestID, "per_1");

  // 2.0.9 questions are forms.
  const asked = normalizeOpenCodeEvent({
    type: "form.created",
    data: { form: { id: "frm_1", sessionID: "ses_1", title: "Questions", fields: [{ key: "q0", type: "string", title: "Pick", description: "Which?", options: [{ value: "A", label: "A" }], custom: true }] } }
  });
  assert.equal(asked.type, "question.asked");
  assert.equal(asked.sessionID, "ses_1");
  assert.equal(asked.props.id, "frm_1");
  assert.deepEqual(asked.props.fields, [{ key: "q0", type: "string" }]);
  assert.equal(asked.props.questions[0].question, "Which?");
  for (const type of ["form.replied", "form.cancelled"]) {
    const resolved = normalizeOpenCodeEvent({ type, data: { id: "frm_1", sessionID: "ses_1" } });
    assert.equal(resolved.type, "question.resolved");
    assert.equal(resolved.props.requestID, "frm_1");
  }

  // 1.19.5 question events.
  const v1Asked = normalizeOpenCodeEvent({ type: "question.v2.asked", data: { id: "que_1", sessionID: "ses_1", questions: [{ question: "Q", header: "H", options: [] }] } });
  assert.equal(v1Asked.type, "question.asked");
  assert.equal(v1Asked.props.questions[0].header, "H");
  assert.equal(normalizeOpenCodeEvent({ type: "question.v2.rejected", data: { sessionID: "ses_1", requestID: "que_1" } }).props.requestID, "que_1");

  // 1.19.5 session.next.* stream events become the 2.x session.* names.
  const delta = normalizeOpenCodeEvent({ type: "session.next.text.delta", data: { sessionID: "ses_1", assistantMessageID: "msg_1", textID: "t1", delta: "hi" } });
  assert.equal(delta.type, "session.text.delta");
  assert.equal(delta.partID, "t1");
  assert.equal(delta.messageID, "msg_1");
  assert.equal(mergeOpenCodeStreamText("", delta), "hi");
  assert.equal(normalizeOpenCodeEvent({ type: "session.next.agent.switched", data: { sessionID: "ses_1", agent: "plan" } }).type, "session.agent.selected");
  assert.equal(normalizeOpenCodeEvent({ type: "session.next.model.switched", data: { sessionID: "ses_1" } }).type, "session.model.selected");
});
