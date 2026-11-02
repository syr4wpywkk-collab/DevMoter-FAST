import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyQwenFailure,
  createQwenRunRegistry,
  createQwenStreamParser,
  handleQwenChatRequest,
  qwenChatArgs,
  runQwenChat
} from "../server/qwen-chat.mjs";

const SID = "123e4567-e89b-12d3-a456-426614174000";
const RUN = "9b2f7c1e-2a4d-4e6f-8a1b-3c5d7e9f1a2b";
const line = value => JSON.stringify(value);
const delta = (text, parent = null) => ({ type: "stream_event", session_id: SID, parent_tool_use_id: parent, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
const start = () => ({ type: "stream_event", session_id: SID, parent_tool_use_id: null, event: { type: "message_start", message: {} } });

async function fakeQwen(script) {
  const dir = await mkdtemp(join(tmpdir(), "qwen-"));
  const bin = join(dir, "qwen");
  await writeFile(bin, `#!/usr/bin/env node\nconst dir = ${JSON.stringify(dir)};\n${script}\n`);
  await chmod(bin, 0o755);
  return { dir, bin };
}

test("qwen args stream JSON, keep the prompt as one argv entry and validate resume ids", () => {
  assert.deepEqual(qwenChatArgs("--yolo hi", SID), ["--output-format", "stream-json", "--include-partial-messages", "--resume", SID, "--prompt", "--yolo hi"]);
  assert.deepEqual(qwenChatArgs(" hi "), ["--output-format", "stream-json", "--include-partial-messages", "--prompt", "hi"]);
  assert.throws(() => qwenChatArgs("hi", "../x"), /セッションID/);
  assert.throws(() => qwenChatArgs("hi", `${SID} --yolo`), /セッションID/);
  assert.throws(() => qwenChatArgs("  "), /空/);
  assert.throws(() => qwenChatArgs("x".repeat(20_001)), /長すぎ/);
});

test("stream parser relays main-agent text deltas, tools and the session once", () => {
  const parser = createQwenStreamParser();
  const events = [
    line({ type: "system", subtype: "session_start", session_id: SID }),
    "not json: a CLI warning",
    line(start()),
    line(delta("Hel")),
    line(delta("lo")),
    line({ type: "stream_event", session_id: SID, parent_tool_use_id: null, event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "run_shell_command" } } }),
    line({ type: "assistant", session_id: SID, parent_tool_use_id: null, message: { content: [{ type: "text", text: "Hello" }, { type: "tool_use", name: "run_shell_command" }] } }),
    line(delta("subagent noise", "tool-1")),
    line(start()),
    line(delta("Done")),
    line({ type: "result", session_id: SID, is_error: false, result: "Done" })
  ].flatMap(item => parser.push(item));
  assert.deepEqual(events, [
    { type: "session", sessionId: SID },
    { type: "delta", text: "Hel" },
    { type: "delta", text: "lo" },
    { type: "tool", name: "run_shell_command" },
    { type: "delta", text: "\n\nDone" }
  ]);
  assert.deepEqual({ text: parser.finish().text, sessionId: parser.finish().sessionId }, { text: "Hello\n\nDone", sessionId: SID });
});

test("stream parser falls back to whole assistant messages and the result text", () => {
  const parser = createQwenStreamParser();
  const events = [
    line({ type: "assistant", session_id: SID, parent_tool_use_id: null, message: { content: [{ type: "text", text: "Paris" }, { type: "tool_use", name: "read_file" }] } })
  ].flatMap(item => parser.push(item));
  assert.deepEqual(events, [{ type: "session", sessionId: SID }, { type: "delta", text: "Paris" }, { type: "tool", name: "read_file" }]);
  const resultOnly = createQwenStreamParser();
  resultOnly.push(line({ type: "result", session_id: "bad id", is_error: false, result: "Only result" }));
  assert.deepEqual({ text: resultOnly.finish().text, sessionId: resultOnly.finish().sessionId }, { text: "Only result", sessionId: null });
});

test("failures are classified: sign-in problems point to setup, others stay short", () => {
  assert.equal(classifyQwenFailure("Error: No API key found. Please run qwen to log in").code, "auth");
  assert.equal(classifyQwenFailure("401 Unauthorized").status, 401);
  const generic = classifyQwenFailure("model overloaded ".repeat(100));
  assert.equal(generic.code, "failed");
  assert.ok(generic.message.length < 440);
});

test("runQwenChat streams events from the CLI without leaking unrelated secrets", async () => {
  const { dir, bin } = await fakeQwen(`
require("fs").writeFileSync(require("path").join(dir, "seen.json"), JSON.stringify({ argv: process.argv.slice(2), secret: process.env.GITHUB_TOKEN || null, key: process.env.DASHSCOPE_API_KEY || null, cwd: process.cwd() }));
const out = l => process.stdout.write(JSON.stringify(l) + "\\n");
out({ type: "system", session_id: "${SID}" });
out(${line(start())});
out(${line(delta("o"))});
out(${line(delta("k"))});
out({ type: "result", session_id: "${SID}", is_error: false, result: "ok" });`);
  process.env.GITHUB_TOKEN = "should-not-leak";
  process.env.DASHSCOPE_API_KEY = "allowed";
  try {
    const events = [];
    const reply = await runQwenChat({ prompt: "hi", cwd: dir, bin, onEvent: event => events.push(event) });
    assert.deepEqual(reply, { text: "ok", sessionId: SID });
    assert.deepEqual(events.map(event => event.type), ["session", "delta", "delta"]);
    const seen = JSON.parse(await readFile(join(dir, "seen.json"), "utf8"));
    assert.deepEqual(seen.argv, ["--output-format", "stream-json", "--include-partial-messages", "--prompt", "hi"]);
    assert.equal(seen.secret, null);
    assert.equal(seen.key, "allowed");
  } finally {
    delete process.env.GITHUB_TOKEN;
    delete process.env.DASHSCOPE_API_KEY;
  }
});

test("missing CLI reports not installed; an error result about sign-in reports auth", async () => {
  await assert.rejects(runQwenChat({ prompt: "hi", cwd: tmpdir(), bin: "/nonexistent/qwen" }), error => error.code === "not_installed" && /未インストール/.test(error.message));
  const { dir, bin } = await fakeQwen(`process.stdout.write(JSON.stringify({ type: "result", session_id: "${SID}", is_error: true, result: "Please set an Auth method in settings" }) + "\\n"); process.exit(1);`);
  await assert.rejects(runQwenChat({ prompt: "hi", cwd: dir, bin }), error => error.code === "auth");
  const crash = await fakeQwen(`process.stderr.write("boom"); process.exit(2);`);
  await assert.rejects(runQwenChat({ prompt: "hi", cwd: crash.dir, bin: crash.bin }), error => error.code === "failed" && /boom/.test(error.message));
});

test("abort kills the qwen process group instead of waiting for it", async () => {
  const { dir, bin } = await fakeQwen(`
const { spawn } = require("child_process");
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
require("fs").writeFileSync(require("path").join(dir, "pids.json"), JSON.stringify([process.pid, child.pid]));
process.stdout.write(JSON.stringify({ type: "system", session_id: "${SID}" }) + "\\n");
setTimeout(() => {}, 60000);`);
  const controller = new AbortController();
  const began = Date.now();
  const running = runQwenChat({ prompt: "hi", cwd: dir, bin, signal: controller.signal, onEvent: event => { if (event.type === "session") controller.abort(); } });
  await assert.rejects(running, error => error.code === "cancelled" && error.status === 499);
  assert.ok(Date.now() - began < 10_000);
  const pids = JSON.parse(await readFile(join(dir, "pids.json"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 200));
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), /ESRCH/, `pid ${pid} is gone`);
});

test("a run past the wall-clock cap times out", async () => {
  const { dir, bin } = await fakeQwen(`setTimeout(() => {}, 60000);`);
  await assert.rejects(runQwenChat({ prompt: "hi", cwd: dir, bin, maxRunMs: 150 }), error => error.code === "timeout");
});

function fakeResponse() {
  const res = new EventEmitter();
  Object.assign(res, {
    body: "", status: 0, headers: null, writableEnded: false, writableFinished: false, destroyed: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { this.body += chunk; },
    end() { this.writableEnded = true; this.writableFinished = true; this.emit("close"); }
  });
  return res;
}

test("the chat route answers NDJSON, redacts strings and finishes with done", async () => {
  const res = fakeResponse();
  const registry = createQwenRunRegistry();
  await handleQwenChatRequest({
    res, registry, cwd: "/p", payload: { prompt: "hi", runId: RUN, sessionId: SID }, redact: value => value.replace("secret", "[redacted]"),
    run: async ({ sessionId, onEvent }) => { assert.equal(sessionId, SID); onEvent({ type: "delta", text: "a secret" }); return { text: "a secret", sessionId: SID }; }
  });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/x-ndjson/);
  const events = res.body.trim().split("\n").map(item => JSON.parse(item));
  assert.deepEqual(events.map(event => event.type), ["start", "delta", "done"]);
  assert.equal(events[2].text, "a [redacted]");
  assert.equal(registry.size, 0);
});

test("the chat route stops qwen when the client disconnects and reports errors in-stream", async () => {
  const res = fakeResponse();
  const registry = createQwenRunRegistry();
  let aborted = false;
  await handleQwenChatRequest({
    res, registry, cwd: "/p", payload: { prompt: "hi", runId: RUN },
    run: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("x"), { name: "QwenChatError" })); });
      setTimeout(() => { res.destroyed = true; res.emit("close"); }, 10);
    })
  });
  assert.equal(aborted, true);
  const failed = fakeResponse();
  await handleQwenChatRequest({
    res: failed, registry, cwd: "/p", payload: { prompt: "hi", runId: RUN },
    run: async () => { throw classifyQwenFailure("not logged in"); }
  });
  assert.deepEqual(JSON.parse(failed.body.trim().split("\n").at(-1)), { type: "error", error: "Qwen Code にログインできていません。ローカル連携で設定してください", code: "auth" });
});

test("the chat route validates before streaming and allows one turn per session", async () => {
  const registry = createQwenRunRegistry();
  await assert.rejects(handleQwenChatRequest({ res: fakeResponse(), registry, cwd: "/p", payload: { prompt: "hi", runId: "nope" } }), /実行ID/);
  await assert.rejects(handleQwenChatRequest({ res: fakeResponse(), registry, cwd: "/p", payload: { prompt: "", runId: RUN } }), /空/);
  let release;
  const first = handleQwenChatRequest({ res: fakeResponse(), registry, cwd: "/p", payload: { prompt: "hi", runId: RUN, sessionId: SID }, run: () => new Promise(resolve => { release = resolve; }) });
  await assert.rejects(handleQwenChatRequest({ res: fakeResponse(), registry, cwd: "/p", payload: { prompt: "hi", runId: "1b2f7c1e-2a4d-4e6f-8a1b-3c5d7e9f1a2b", sessionId: SID } }), error => error.status === 409);
  assert.equal(registry.cancel("1b2f7c1e-2a4d-4e6f-8a1b-3c5d7e9f1a2b"), false);
  release({ text: "", sessionId: SID });
  await first;
  assert.equal(registry.size, 0);
});

test("server keeps the Qwen chat behind the operation claim and adds a cancel route", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const chat = server.indexOf('url.pathname === "/api/qwen/chat")');
  const cancel = server.indexOf('url.pathname === "/api/qwen/chat/cancel")');
  assert.ok(chat > 0 && cancel > chat);
  assert.match(server.slice(chat, chat + 200), /claimOperation\(req, res/);
  assert.match(server.slice(cancel, cancel + 200), /claimOperation\(req, res/);
  assert.match(server.slice(chat, cancel), /handleQwenChatRequest\(\{ res, payload, cwd: project\.path, registry: qwenRuns, redact: redactText \}\)/);
});

test("Qwen Code is in the AI selector and the Home Qwen Code Mobile app is gone", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const nav = await read("src/unified-workspace-nav.ts");
  assert.match(nav, /<option value="qwen">Qwen Code<\/option>/);
  for (const path of ["src/app-registry.ts", "src/home.ts", "src/app-shell.ts", "server.mjs"]) {
    assert.doesNotMatch(await read(path), /qwen-mobile|Qwen Code Mobile/i, path);
  }
  await assert.rejects(read("public/qwen-mobile/index.html"), /ENOENT/);
});
