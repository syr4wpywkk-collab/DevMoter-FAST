import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenCodePermissionReply,
  buildOpenCodePromptRequests,
  buildOpenCodeQuestionReject,
  buildOpenCodeQuestionReply,
  canonicalOpenCodeEvent,
  classicMessagesToContext,
  createSseReader,
  lastAssistantText,
  mergeOpenCodeContexts,
  normalizeOpenCodeActive,
  normalizeOpenCodeQuestions,
  openCodeActivePath,
  openCodeEventPath,
  openCodeGenerationFromVersion,
  openCodeInterruptRequest,
  openCodeQuestionDetailPath,
  parseDevMoterPrompt,
  parseQuestionAnswers
} from "../server/opencode-adapter.mjs";

// Shapes below were captured from real OpenCode 1.19.5 and 2.0.9 servers
// driving a local OpenAI-compatible mock model (text reply, a bash/shell tool
// call that asks for permission, and a question tool call).

test("OpenCode API generation comes from the reported major version", () => {
  assert.equal(openCodeGenerationFromVersion("2.0.9"), "v2");
  assert.equal(openCodeGenerationFromVersion("v2.1.0-beta.1"), "v2");
  assert.equal(openCodeGenerationFromVersion("1.19.5"), "v1");
  assert.throws(() => openCodeGenerationFromVersion("0.9.0"), /older than the 1\.x/);
  assert.throws(() => openCodeGenerationFromVersion(""), /unrecognised version/);
  assert.throws(() => openCodeGenerationFromVersion(undefined), /unrecognised version/);
});

test("DevMoter prompt bodies are validated once, independent of the generation", () => {
  assert.deepEqual(parseDevMoterPrompt({ text: "hi" }), { text: "hi" });
  assert.deepEqual(
    parseDevMoterPrompt({ text: "hi", agent: " plan ", model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" }, delivery: "queue" }),
    { text: "hi", agent: "plan", model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" }, delivery: "queue" }
  );
  assert.deepEqual(parseDevMoterPrompt({ text: "hi", delivery: "bogus", agent: "" }), { text: "hi" });
  assert.throws(() => parseDevMoterPrompt({ prompt: { text: "hi" } }), /text is required/);
  assert.throws(() => parseDevMoterPrompt({ text: "hi", model: { providerID: "x" } }), /providerID and modelID/);
  assert.throws(() => parseDevMoterPrompt([]), /JSON object/);
});

test("1.x prompts run on the classic runner with the selected model and agent", () => {
  const prompt = { text: "hi", model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" }, agent: "build" };
  assert.deepEqual(buildOpenCodePromptRequests("v1", "ses_1", prompt), [{
    method: "POST",
    path: "/session/ses_1/prompt_async",
    body: {
      parts: [{ type: "text", text: "hi" }],
      model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" },
      agent: "build"
    }
  }]);
  // Model and agent the prompt does not name come from the session.
  const session = { id: "ses_1", agent: "plan", model: { id: "mock-1", providerID: "mock", variant: "default" } };
  const [fromSession] = buildOpenCodePromptRequests("v1", "ses_1", { text: "hi" }, { session, readOnlyTools: { "*": false, read: true } });
  assert.deepEqual(fromSession.body, {
    parts: [{ type: "text", text: "hi" }],
    model: { providerID: "mock", modelID: "mock-1" },
    agent: "plan",
    tools: { "*": false, read: true }
  });
});

test("2.x prompts use /api/session/{id}/prompt and only re-select what changed", () => {
  const session = { id: "ses_2", agent: "build", model: { id: "mock-1", providerID: "mock" } };
  assert.deepEqual(
    buildOpenCodePromptRequests("v2", "ses_2", { text: "hi", agent: "build", model: { providerID: "mock", modelID: "mock-1" } }, { session }),
    [{ method: "POST", path: "/api/session/ses_2/prompt", body: { text: "hi" } }]
  );
  assert.deepEqual(
    buildOpenCodePromptRequests("v2", "ses_2", { text: "hi", agent: "plan", model: { providerID: "opencode", modelID: "big-pickle" }, delivery: "steer" }, { session, readOnlyTools: { "*": false } }),
    [
      { method: "POST", path: "/api/session/ses_2/model", body: { model: { id: "big-pickle", providerID: "opencode" } } },
      { method: "POST", path: "/api/session/ses_2/agent", body: { agent: "plan" } },
      { method: "POST", path: "/api/session/ses_2/prompt", body: { text: "hi", delivery: "steer" } }
    ]
  );
  assert.throws(() => buildOpenCodePromptRequests(null, "ses", { text: "x" }), /generation is unknown/);
  assert.throws(() => buildOpenCodePromptRequests("v2", "", { text: "x" }), /session id is required/);
});

test("status and interrupt map to the runner each generation uses", () => {
  assert.equal(openCodeActivePath("v1"), "/session/status");
  assert.equal(openCodeActivePath("v2"), "/api/session/active");
  assert.deepEqual(
    normalizeOpenCodeActive("v1", {
      ses_a: { type: "busy" },
      ses_b: { type: "retry", attempt: 2, message: "Upstream request failed: Invalid credential", next: 1793529290055 },
      ses_c: { type: "idle" }
    }),
    {
      ses_a: { type: "running" },
      // 1.19.5 retries a failing upstream call instead of failing the turn.
      ses_b: { type: "running", retry: { attempt: 2, message: "Upstream request failed: Invalid credential", next: 1793529290055 } }
    }
  );
  assert.deepEqual(normalizeOpenCodeActive("v2", { data: { ses_d: { type: "running" } } }), { ses_d: { type: "running" } });
  assert.deepEqual(openCodeInterruptRequest("v1", "ses_1"), { method: "POST", path: "/session/ses_1/abort" });
  assert.deepEqual(openCodeInterruptRequest("v2", "ses_1"), { method: "POST", path: "/api/session/ses_1/interrupt" });
});

// 1.19.5 GET /session/{id}/message after a bash tool call was approved.
const classicMessages = [
  { info: { id: "msg_u1", sessionID: "ses_1", role: "user", time: { created: 100 } }, parts: [
    { id: "prt_1", type: "text", text: "please RUN_BASH now" },
    { id: "prt_2", type: "text", text: "<system-reminder>", synthetic: true }
  ] },
  { info: { id: "msg_a1", sessionID: "ses_1", role: "assistant", time: { created: 110, completed: 120 }, modelID: "mock-1", providerID: "mock", agent: "build", cost: 0, tokens: { input: 10, output: 5 }, finish: "tool-calls" }, parts: [
    { type: "step-start" },
    { type: "tool", tool: "bash", callID: "call_1", state: { status: "completed", input: { command: "echo mock-tool-ok", description: "Print a marker" }, output: "mock-tool-ok\n", title: "echo mock-tool-ok", metadata: { exit: 0 } } },
    { type: "step-finish" }
  ] },
  { info: { id: "msg_a2", sessionID: "ses_1", role: "assistant", time: { created: 130, completed: 140 }, modelID: "mock-1", providerID: "mock", agent: "build", cost: 0.25, tokens: { input: 10, output: 5 } }, parts: [
    { type: "reasoning", text: "thinking" },
    { type: "text", text: "Tool finished: mock-tool-ok\n" }
  ] }
];

test("classic 1.x messages become the same context items 2.x returns", () => {
  const context = classicMessagesToContext(classicMessages);
  assert.deepEqual(context, [
    { id: "msg_u1", type: "user", text: "please RUN_BASH now", time: { created: 100 } },
    {
      id: "msg_a1", type: "assistant", time: { created: 110, completed: 120 }, agent: "build",
      model: { id: "mock-1", providerID: "mock" },
      content: [{ type: "tool", id: "call_1", name: "bash", state: { status: "completed", input: { command: "echo mock-tool-ok", description: "Print a marker" }, result: "mock-tool-ok\n", title: "echo mock-tool-ok", metadata: { exit: 0 } } }],
      cost: 0, tokens: { input: 10, output: 5 }, finish: "tool-calls"
    },
    {
      id: "msg_a2", type: "assistant", time: { created: 130, completed: 140 }, agent: "build",
      model: { id: "mock-1", providerID: "mock" },
      content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "Tool finished: mock-tool-ok\n" }],
      cost: 0.25, tokens: { input: 10, output: 5 }
    },
    { id: "msg_a2:idle", type: "idle", time: { created: 140 }, outcome: "succeeded" }
  ]);
  assert.equal(lastAssistantText(context), "Tool finished: mock-tool-ok\n");

  // While the classic runner is busy there is no idle marker yet.
  assert.equal(classicMessagesToContext(classicMessages, { busy: true }).at(-1).type, "assistant");

  // Abort and failure outcomes, and a rejected tool call.
  const aborted = classicMessagesToContext([{
    info: { id: "msg_x", role: "assistant", time: { created: 1, completed: 2 }, error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
    parts: [{ type: "tool", tool: "bash", callID: "c", state: { status: "error", input: {}, error: "The user rejected permission to use this specific tool call." } }]
  }]);
  assert.deepEqual(aborted[0].error, { name: "MessageAbortedError", message: "Aborted" });
  assert.deepEqual(aborted[0].content[0].state, { status: "error", input: {}, error: "The user rejected permission to use this specific tool call." });
  assert.equal(aborted.at(-1).outcome, "interrupted");
  const failed = classicMessagesToContext([{ info: { id: "msg_f", role: "assistant", time: { created: 1, completed: 2 }, error: { name: "APIError", data: { message: "Free usage limit reached" } } }, parts: [] }]);
  assert.equal(failed.at(-1).outcome, "failed");
  assert.equal(failed[0].error.message, "Free usage limit reached");
});

test("1.x keeps earlier new-runner turns in the transcript, in time order", () => {
  const earlier = [
    { id: "msg_n1", type: "user", text: "x", time: { created: 50 } },
    { id: "msg_n2", type: "idle", outcome: "succeeded", time: { created: 60 } }
  ];
  const merged = mergeOpenCodeContexts(earlier, classicMessagesToContext(classicMessages));
  assert.deepEqual(merged.map(item => item.id), ["msg_n1", "msg_n2", "msg_u1", "msg_a1", "msg_a2", "msg_a2:idle"]);
});

test("permission replies: classic reply (1.x) or session decision (2.x)", () => {
  assert.deepEqual(buildOpenCodePermissionReply("v1", "ses_1", "per_1", "once"), {
    method: "POST", path: "/permission/per_1/reply", body: { reply: "once" }
  });
  assert.deepEqual(buildOpenCodePermissionReply("v2", "ses_1", "per_1", "always", "ok"), {
    method: "POST", path: "/api/session/ses_1/permission/per_1/reply", body: { decision: "always", message: "ok" }
  });
  assert.throws(() => buildOpenCodePermissionReply("v2", "ses_1", "per_1", "maybe"), /Unsupported/);
  assert.throws(() => buildOpenCodePermissionReply("v1", "ses_1", "", "once"), /permission request id is required/);
});

test("1.x questions and 2.x forms normalize to one question shape; answers map back", () => {
  const classic = normalizeOpenCodeQuestions("v1", "ses_1", [
    { id: "que_1", sessionID: "ses_1", questions: [{ question: "Pick a color", header: "Color", options: [{ label: "red", description: "warm" }, { label: "blue", description: "cool" }] }], tool: { messageID: "m", callID: "c" } },
    { id: "que_9", sessionID: "ses_2", questions: [] }
  ]);
  const form = {
    id: "frm_1", sessionID: "ses_1", title: "Questions",
    fields: [
      { key: "q0", type: "string", title: "Color", description: "Pick a color", options: [{ value: "red", label: "red", description: "warm" }, { value: "blue", label: "blue", description: "cool" }], custom: true },
      { key: "hidden", type: "string", hidden: true }
    ]
  };
  const forms = normalizeOpenCodeQuestions("v2", "ses_1", { data: [form] });
  const expected = { header: "Color", question: "Pick a color", options: [{ label: "red", description: "warm" }, { label: "blue", description: "cool" }], multiple: false, custom: true };
  assert.deepEqual(classic, [{ id: "que_1", sessionID: "ses_1", questions: [expected] }]);
  assert.deepEqual(forms, [{ id: "frm_1", sessionID: "ses_1", questions: [expected] }]);

  assert.deepEqual(buildOpenCodeQuestionReply("v1", "ses_1", "que_1", [["blue"]]), {
    method: "POST", path: "/question/que_1/reply", body: { answers: [["blue"]] }
  });
  assert.equal(openCodeQuestionDetailPath("v1", "ses_1", "que_1"), null);
  assert.equal(openCodeQuestionDetailPath("v2", "ses_1", "frm_1"), "/api/session/ses_1/form/frm_1");
  assert.deepEqual(buildOpenCodeQuestionReply("v2", "ses_1", "frm_1", [["blue"]], { data: form }), {
    method: "POST", path: "/api/session/ses_1/form/frm_1/reply", body: { answer: { q0: "blue" } }
  });
  assert.throws(() => buildOpenCodeQuestionReply("v2", "ses_1", "frm_1", [["blue"]], {}), /form fields are missing/);
  assert.deepEqual(buildOpenCodeQuestionReject("v1", "ses_1", "que_1"), { method: "POST", path: "/question/que_1/reject" });
  assert.deepEqual(buildOpenCodeQuestionReject("v2", "ses_1", "frm_1"), { method: "DELETE", path: "/api/session/ses_1/form/frm_1" });

  assert.deepEqual(parseQuestionAnswers([["a"], "x", [1]]), [["a"], [], ["1"]]);
  assert.throws(() => parseQuestionAnswers("a"), /answers must be an array/);
});

test("2.x non-question form fields convert answers to their declared types", () => {
  const form = { id: "frm_2", sessionID: "ses_1", fields: [
    { key: "count", type: "integer", title: "Count" },
    { key: "ok", type: "boolean", title: "OK?" },
    { key: "tags", type: "multiselect", options: [{ value: "a" }, { value: "b" }] },
    { key: "note", type: "string" }
  ] };
  const [question] = normalizeOpenCodeQuestions("v2", "ses_1", [form]);
  assert.deepEqual(question.questions[1].options, [{ label: "true" }, { label: "false" }]);
  assert.equal(question.questions[1].custom, false);
  assert.equal(question.questions[2].multiple, true);
  assert.deepEqual(
    buildOpenCodeQuestionReply("v2", "ses_1", "frm_2", [["3"], ["true"], ["a", "b"], []], form).body,
    { answer: { count: 3, ok: true, tags: ["a", "b"] } }
  );
  assert.throws(() => buildOpenCodeQuestionReply("v2", "ses_1", "frm_2", [["x"]], form), /not a number/);
  assert.throws(() => buildOpenCodeQuestionReply("v2", "ses_1", "frm_2", [["1"], ["maybe"]], form), /not true or false/);
});

test("both generations' SSE streams become one canonical event vocabulary", () => {
  assert.equal(openCodeEventPath("v1"), "/event");
  assert.equal(openCodeEventPath("v2"), "/api/event");

  // 1.19.5 classic /event frames.
  const v1Delta = canonicalOpenCodeEvent("v1", { type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "msg_a", partID: "prt_t", field: "text", delta: "Hello from " } });
  assert.deepEqual(v1Delta, { type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "msg_a", partID: "prt_t", field: "text", delta: "Hello from " } });
  const v1Asked = canonicalOpenCodeEvent("v1", { type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["echo mock-tool-ok"], metadata: { command: "echo mock-tool-ok" }, always: ["echo *"], tool: { messageID: "msg_a", callID: "call_1" } } });
  // 2.0.9 /api/event frames.
  const v2Asked = canonicalOpenCodeEvent("v2", { id: "evt_1", type: "permission.asked", location: {}, data: { id: "per_1", sessionID: "ses_1", action: "shell", resources: ["echo mock-tool-ok"], save: ["echo *"], source: { type: "tool", messageID: "msg_a", id: "call_1" } } });
  assert.deepEqual(v1Asked.properties, { ...v2Asked.properties, action: "bash" });
  assert.equal(v2Asked.id, "evt_1");
  assert.equal(v2Asked.properties.metadata.command, "echo mock-tool-ok");

  for (const [generation, payload] of [
    ["v1", { type: "permission.replied", properties: { sessionID: "ses_1", requestID: "per_1", reply: "reject" } }],
    ["v2", { type: "permission.replied", data: { sessionID: "ses_1", requestID: "per_1", reply: "reject" } }]
  ]) {
    assert.deepEqual(canonicalOpenCodeEvent(generation, payload).properties, { sessionID: "ses_1", requestID: "per_1", decision: "reject" });
  }

  const v1Question = canonicalOpenCodeEvent("v1", { type: "question.asked", properties: { id: "que_1", sessionID: "ses_1", questions: [{ question: "Pick a color", header: "Color", options: [{ label: "red" }] }] } });
  const v2Question = canonicalOpenCodeEvent("v2", { type: "form.created", data: { form: { id: "que_1", sessionID: "ses_1", fields: [{ key: "q0", type: "string", title: "Color", description: "Pick a color", options: [{ value: "red" }], custom: true }] } } });
  assert.equal(v1Question.type, "question.asked");
  assert.deepEqual(v1Question.properties, v2Question.properties);
  assert.deepEqual(canonicalOpenCodeEvent("v1", { type: "question.replied", properties: { sessionID: "ses_1", requestID: "que_1", answers: [["red"]] } }), { type: "question.resolved", properties: { sessionID: "ses_1", requestID: "que_1" } });
  assert.deepEqual(canonicalOpenCodeEvent("v1", { type: "question.rejected", properties: { sessionID: "ses_1", requestID: "que_1" } }).type, "question.resolved");
  for (const type of ["form.replied", "form.cancelled"]) {
    assert.deepEqual(canonicalOpenCodeEvent("v2", { type, data: { id: "frm_1", sessionID: "ses_1" } }), { type: "question.resolved", properties: { sessionID: "ses_1", requestID: "frm_1" } });
  }
  // 2.x stream events pass through with their data as properties.
  assert.deepEqual(canonicalOpenCodeEvent("v2", { type: "session.text.delta", data: { sessionID: "ses_1", delta: "hi" } }), { type: "session.text.delta", properties: { sessionID: "ses_1", delta: "hi" } });
  assert.equal(canonicalOpenCodeEvent("v1", { type: "permission.asked", properties: {} }), null);
});

test("SSE reader yields complete JSON frames across chunk boundaries", () => {
  const read = createSseReader();
  assert.deepEqual(read('data: {"type":"a"}\n\ndata: {"ty'), [{ type: "a" }]);
  assert.deepEqual(read('pe":"b"}\r\n\r\n: comment\n\nevent: x\ndata: not-json\n\n'), [{ type: "b" }]);
  assert.deepEqual(read("data: {\"type\":\ndata: \"c\"}\n\n"), [{ type: "c" }]);
});
