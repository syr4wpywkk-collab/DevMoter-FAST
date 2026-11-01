import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenCodePermissionReply,
  buildOpenCodePromptBody,
  buildOpenCodeQuestionReject,
  buildOpenCodeQuestionReply,
  normalizeOpenCodeQuestions,
  openCodeGenerationFromVersion,
  openCodePermissionDecision,
  openCodePromptText,
  openCodeQuestionListPath,
  withOpenCodePromptText
} from "../src/opencode-api-shapes.mjs";

test("OpenCode API generation comes from the reported major version", () => {
  assert.equal(openCodeGenerationFromVersion("2.0.9"), "v2");
  assert.equal(openCodeGenerationFromVersion("v2.1.0-beta.1"), "v2");
  assert.equal(openCodeGenerationFromVersion("1.19.5"), "v1");
  assert.throws(() => openCodeGenerationFromVersion("0.9.0"), /older than the 1\.x/);
  assert.throws(() => openCodeGenerationFromVersion(""), /unrecognised version/);
  assert.throws(() => openCodeGenerationFromVersion(undefined), /unrecognised version/);
});

test("prompt bodies match each generation's request schema", () => {
  // 1.19.5: { prompt: { text } }   2.0.9: { text }  (both reject the other shape with HTTP 400)
  assert.deepEqual(buildOpenCodePromptBody("v1", { text: "hi" }), { prompt: { text: "hi" } });
  assert.deepEqual(buildOpenCodePromptBody("v2", { text: "hi" }), { text: "hi" });
  assert.deepEqual(buildOpenCodePromptBody("v2", { text: "hi", delivery: "queue" }), { text: "hi", delivery: "queue" });
  assert.deepEqual(buildOpenCodePromptBody("v1", { text: "hi", delivery: "bogus" }), { prompt: { text: "hi" } });
  assert.throws(() => buildOpenCodePromptBody(null, { text: "hi" }), /generation is unknown/);

  assert.equal(openCodePromptText("v1", { prompt: { text: "a" } }), "a");
  assert.equal(openCodePromptText("v2", { text: "b" }), "b");
  assert.equal(openCodePromptText("v2", { prompt: { text: "a" } }), null);
  assert.deepEqual(withOpenCodePromptText("v1", { prompt: { text: "a" }, delivery: "steer" }, "z"), { prompt: { text: "z" }, delivery: "steer" });
  assert.deepEqual(withOpenCodePromptText("v2", { text: "a", delivery: "steer" }, "z"), { text: "z", delivery: "steer" });
});

test("permission replies use reply (1.x) or decision (2.x)", () => {
  const request = { id: "per_1", sessionID: "ses_1" };
  assert.deepEqual(buildOpenCodePermissionReply("v1", request, "once"), {
    method: "POST",
    path: "/session/ses_1/permission/per_1/reply",
    body: { reply: "once" }
  });
  assert.deepEqual(buildOpenCodePermissionReply("v2", request, "always", "ok").body, { decision: "always", message: "ok" });
  assert.throws(() => buildOpenCodePermissionReply("v2", request, "maybe"), /Unsupported/);
  assert.equal(openCodePermissionDecision("v1", { reply: "reject" }), "reject");
  assert.equal(openCodePermissionDecision("v2", { decision: "reject" }), "reject");
  // A 1.x-shaped body sent to a 2.x server carries no decision at all.
  assert.equal(openCodePermissionDecision("v2", { reply: "reject" }), null);
});

test("1.x question requests normalize unchanged and reply with answers arrays", () => {
  const [question] = normalizeOpenCodeQuestions("v1", {
    data: [{
      id: "que_1",
      sessionID: "ses_1",
      questions: [{ question: "Which?", header: "Pick", options: [{ label: "A", description: "first" }], multiple: true }],
      tool: { messageID: "msg_1", callID: "call_1" }
    }]
  });
  assert.deepEqual(question, {
    id: "que_1",
    sessionID: "ses_1",
    questions: [{ header: "Pick", question: "Which?", options: [{ label: "A", description: "first" }], multiple: true, custom: true }]
  });
  assert.equal(openCodeQuestionListPath("v1", "ses_1"), "/session/ses_1/question");
  assert.deepEqual(buildOpenCodeQuestionReply("v1", question, [["A", "custom"]]), {
    method: "POST",
    path: "/session/ses_1/question/que_1/reply",
    body: { answers: [["A", "custom"]] }
  });
  assert.deepEqual(buildOpenCodeQuestionReject("v1", question), { method: "POST", path: "/session/ses_1/question/que_1/reject" });
});

// Shape produced by OpenCode 2.0.9's built-in question tool
// (packages/core/src/tool/plugin/question.ts toField): one field per question,
// key "q<index>", string or multiselect, custom answers allowed.
const QUESTION_TOOL_FORM = {
  id: "frm_1",
  sessionID: "ses_2",
  title: "Questions",
  metadata: { kind: "question", tool: { messageID: "msg_1", id: "call_1" } },
  fields: [
    { key: "q0", title: "Lang", description: "Which language?", type: "string", options: [{ value: "TS", label: "TS", description: "typed" }], custom: true },
    { key: "q1", title: "Extras", description: "Add what?", type: "multiselect", options: [{ value: "lint", label: "lint" }, { value: "tests", label: "tests" }], custom: true }
  ]
};

test("2.x forms normalize to the same question shape and keep field keys", () => {
  const [question] = normalizeOpenCodeQuestions("v2", [QUESTION_TOOL_FORM]);
  assert.equal(openCodeQuestionListPath("v2", "ses_2"), "/session/ses_2/form");
  assert.deepEqual(question, {
    id: "frm_1",
    sessionID: "ses_2",
    questions: [
      { header: "Lang", question: "Which language?", options: [{ label: "TS", description: "typed" }], multiple: false, custom: true },
      { header: "Extras", question: "Add what?", options: [{ label: "lint" }, { label: "tests" }], multiple: true, custom: true }
    ],
    fields: [{ key: "q0", type: "string" }, { key: "q1", type: "multiselect" }]
  });

  assert.deepEqual(buildOpenCodeQuestionReply("v2", question, [["Rust"], ["lint", "tests"]]), {
    method: "POST",
    path: "/session/ses_2/form/frm_1/reply",
    body: { answer: { q0: "Rust", q1: ["lint", "tests"] } }
  });
  assert.deepEqual(buildOpenCodeQuestionReject("v2", question), { method: "DELETE", path: "/session/ses_2/form/frm_1" });
});

test("2.x non-question form fields convert answers to their declared types", () => {
  const [question] = normalizeOpenCodeQuestions("v2", [{
    id: "frm_2",
    sessionID: "ses_2",
    title: "Settings",
    fields: [
      { key: "count", type: "integer", title: "Count" },
      { key: "on", type: "boolean", title: "Enabled" },
      { key: "secret", type: "string", hidden: true },
      { key: "mode", type: "string", options: [{ value: "fast", label: "Fast" }] }
    ]
  }]);
  assert.deepEqual(question.fields, [{ key: "count", type: "integer" }, { key: "on", type: "boolean" }, { key: "mode", type: "string" }]);
  assert.equal(question.questions[1].custom, false);
  assert.deepEqual(question.questions[1].options, [{ label: "true" }, { label: "false" }]);
  assert.equal(question.questions[2].custom, false, "closed option list without custom");
  assert.deepEqual(
    buildOpenCodeQuestionReply("v2", question, [["3"], ["false"], ["fast"]]).body,
    { answer: { count: 3, on: false, mode: "fast" } }
  );
  assert.throws(() => buildOpenCodeQuestionReply("v2", question, [["x"], ["false"], ["fast"]]), /not a number/);
  assert.throws(() => buildOpenCodeQuestionReply("v2", { id: "frm_3", sessionID: "ses_2" }, [["a"]]), /fields are missing/);
});
