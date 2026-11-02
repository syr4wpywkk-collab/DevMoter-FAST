// Qwen Code chat: runs the local `qwen` CLI in headless mode
// (`--output-format stream-json --include-partial-messages`) in the selected
// project and relays its text as NDJSON events to the browser.
//
// Security: no shell (spawn with an argv array), the prompt is one argv entry
// after `--prompt`, resume ids must be UUIDs, the child only sees the
// integration's allow-listed env, and a run is killed when the client
// disconnects, presses Stop, or the wall-clock cap is reached.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { integrationChildEnv } from "./integrations.mjs";

export const QWEN_MAX_RUN_MS = 30 * 60_000;
export const QWEN_PROMPT_LIMIT = 20_000;
const TEXT_LIMIT = 200_000;
const STDERR_LIMIT = 16 * 1024;
const KILL_GRACE_MS = 3_000;
const HEARTBEAT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_FAILURE = /auth|api[ _-]?key|unauthori[sz]ed|\b401\b|\b403\b|credential|log(?:ged)? ?in|sign(?:ed)? ?in|oauth|token (?:is )?(?:invalid|expired)/i;

export function isQwenId(value) {
  return typeof value === "string" && UUID.test(value);
}

export class QwenChatError extends Error {
  constructor(message, status = 400, code = "invalid") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function qwenChatArgs(prompt, sessionId) {
  const text = String(prompt || "").trim();
  if (!text) throw new QwenChatError("メッセージが空です");
  if (text.length > QWEN_PROMPT_LIMIT) throw new QwenChatError("メッセージが長すぎます");
  const args = ["--output-format", "stream-json", "--include-partial-messages"];
  if (sessionId) {
    if (!isQwenId(String(sessionId))) throw new QwenChatError("セッションIDが不正です");
    args.push("--resume", String(sessionId));
  }
  // The prompt is a single argv entry (no shell), so it cannot inject flags.
  args.push("--prompt", text);
  return args;
}

// Turns qwen stream-json lines into the small event set the UI needs:
// session / delta / tool. Only the main agent (parent_tool_use_id null) is
// shown; subagent chatter stays out of the transcript.
export function createQwenStreamParser() {
  let text = "";
  let sessionId = null;
  let result = null;
  let messageHasDelta = false;
  let sawStreamEvents = false;
  let needsSeparator = false;

  const appendText = (fragment, events) => {
    if (!fragment || text.length >= TEXT_LIMIT) return;
    let piece = fragment;
    if (needsSeparator && text) piece = `\n\n${piece}`;
    needsSeparator = false;
    piece = piece.slice(0, TEXT_LIMIT - text.length);
    text += piece;
    events.push({ type: "delta", text: piece });
  };

  function push(line) {
    const events = [];
    let message;
    try {
      message = JSON.parse(String(line || "").trim());
    } catch {
      return events; // CLI warnings and other non-JSON lines are ignored.
    }
    if (!message || typeof message !== "object") return events;
    if (!sessionId && isQwenId(message.session_id)) {
      sessionId = message.session_id;
      events.push({ type: "session", sessionId });
    }
    if (message.parent_tool_use_id) return events;

    if (message.type === "stream_event") {
      sawStreamEvents = true;
      const event = message.event || {};
      if (event.type === "message_start") {
        messageHasDelta = false;
        needsSeparator = Boolean(text);
      } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        messageHasDelta = true;
        appendText(String(event.delta.text || ""), events);
      } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        events.push({ type: "tool", name: String(event.content_block.name || "tool").slice(0, 80) });
      }
    } else if (message.type === "assistant") {
      const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
      if (!messageHasDelta) {
        if (text) needsSeparator = true;
        appendText(blocks.filter(block => block?.type === "text").map(block => String(block.text || "")).join(""), events);
      }
      if (!sawStreamEvents) {
        for (const block of blocks) {
          if (block?.type === "tool_use") events.push({ type: "tool", name: String(block.name || "tool").slice(0, 80) });
        }
      }
      messageHasDelta = false;
    } else if (message.type === "result") {
      result = {
        isError: Boolean(message.is_error),
        text: typeof message.result === "string" ? message.result : String(message.error?.message || message.error || "")
      };
    }
    return events;
  }

  function finish() {
    return { text: text || (result && !result.isError ? result.text.slice(0, TEXT_LIMIT) : ""), sessionId, result };
  }

  return { push, finish };
}

export function classifyQwenFailure(detail) {
  const message = String(detail || "").replace(/\s+/g, " ").trim();
  if (AUTH_FAILURE.test(message)) {
    return new QwenChatError("Qwen Code にログインできていません。ローカル連携で設定してください", 401, "auth");
  }
  return new QwenChatError(message ? `Qwen Code エラー: ${message.slice(0, 400)}` : "Qwen Code の実行に失敗しました", 502, "failed");
}

const OWN_GROUP = process.platform !== "win32";

// qwen runs its tools (shell commands) as children, so on POSIX it gets its
// own process group and Stop signals the whole group.
function signalRun(child, sig) {
  try {
    if (OWN_GROUP && child.pid) process.kill(-child.pid, sig);
    else child.kill(sig);
  } catch {
    try { child.kill(sig); } catch { /* already gone */ }
  }
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalRun(child, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalRun(child, "SIGKILL");
  }, KILL_GRACE_MS);
  timer.unref?.();
}

// Runs one qwen turn. `onEvent` receives parser events as they arrive.
// Resolves { text, sessionId }; rejects QwenChatError (code cancelled when
// `signal` aborts, timeout when maxRunMs passes).
export function runQwenChat({
  prompt,
  sessionId = null,
  cwd,
  bin = process.env.QWEN_BIN || "qwen",
  onEvent = () => {},
  signal,
  maxRunMs = QWEN_MAX_RUN_MS,
  env = { ...integrationChildEnv("qwen"), NO_COLOR: "1", TERM: "dumb" }
}) {
  const args = qwenChatArgs(prompt, sessionId);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new QwenChatError("停止しました", 499, "cancelled"));
    const parser = createQwenStreamParser();
    let stderr = "";
    let stopped = null;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };

    let child;
    try {
      child = spawn(bin, args, { cwd, env, shell: false, detached: OWN_GROUP, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return reject(new QwenChatError("Qwen Code の実行に失敗しました", 502, "failed"));
    }
    const stop = reason => {
      if (stopped) return;
      stopped = reason;
      killTree(child);
    };
    const onAbort = () => stop("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => stop("timeout"), maxRunMs);
    timer.unref?.();

    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", line => {
      for (const event of parser.push(line)) {
        try { onEvent(event); } catch { /* a broken listener must not kill the run */ }
      }
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < STDERR_LIMIT) stderr += String(chunk).slice(0, STDERR_LIMIT - stderr.length);
    });
    child.on("error", error => {
      if (error?.code === "ENOENT") settle(reject, new QwenChatError("Qwen Code が未インストールです", 404, "not_installed"));
      else settle(reject, new QwenChatError("Qwen Code の実行に失敗しました", 502, "failed"));
    });
    child.on("close", code => {
      if (stopped === "cancelled") return settle(reject, new QwenChatError("停止しました", 499, "cancelled"));
      if (stopped === "timeout") return settle(reject, new QwenChatError("Qwen Code がタイムアウトしました", 504, "timeout"));
      const outcome = parser.finish();
      if (outcome.result?.isError) return settle(reject, classifyQwenFailure(outcome.result.text || stderr));
      if (outcome.result) return settle(resolve, { text: outcome.text, sessionId: outcome.sessionId });
      if (code !== 0) return settle(reject, classifyQwenFailure(stderr));
      settle(reject, new QwenChatError("Qwen Code の応答を読めませんでした", 502, "failed"));
    });
  });
}

// One running turn per resume id, plus Stop by run id.
export function createQwenRunRegistry() {
  const runs = new Map();
  return {
    begin(runId, sessionId, controller) {
      if (runs.has(runId)) throw new QwenChatError("同じ実行が進行中です", 409, "busy");
      if (sessionId && [...runs.values()].some(run => run.sessionId === sessionId)) {
        throw new QwenChatError("このチャットはまだ応答中です", 409, "busy");
      }
      runs.set(runId, { sessionId, controller });
    },
    cancel(runId) {
      const run = runs.get(runId);
      if (!run) return false;
      run.controller.abort();
      return true;
    },
    end(runId) {
      runs.delete(runId);
    },
    get size() {
      return runs.size;
    }
  };
}

// POST /api/qwen/chat body: { projectId, prompt, sessionId?, runId }.
// Validation errors are plain JSON; once qwen starts the response is NDJSON:
// {type:"start"} {type:"session"} {type:"delta"} {type:"tool"} {type:"ping"}
// and one final {type:"done"} or {type:"error"}.
export async function handleQwenChatRequest({ res, payload, cwd, registry, redact = value => value, run = runQwenChat, heartbeatMs = HEARTBEAT_MS }) {
  const runId = String(payload?.runId || "");
  if (!isQwenId(runId)) throw new QwenChatError("実行IDが不正です");
  const sessionId = payload?.sessionId ? String(payload.sessionId) : null;
  qwenChatArgs(payload?.prompt, sessionId); // validate before any output
  const controller = new AbortController();
  registry.begin(runId, sessionId, controller);
  const write = event => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`${JSON.stringify(event, (_key, value) => (typeof value === "string" ? redact(value) : value))}\n`);
  };
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on("close", onClose);
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no"
  });
  write({ type: "start", runId });
  const heartbeat = setInterval(() => write({ type: "ping" }), heartbeatMs);
  heartbeat.unref?.();
  try {
    const reply = await run({ prompt: payload.prompt, sessionId, cwd, signal: controller.signal, onEvent: write });
    write({ type: "done", text: reply.text, sessionId: reply.sessionId });
  } catch (error) {
    const safe = publicQwenChatError(error);
    write({ type: "error", error: safe.error, code: safe.code });
  } finally {
    clearInterval(heartbeat);
    registry.end(runId);
    res.off?.("close", onClose);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

export function publicQwenChatError(error) {
  if (error instanceof QwenChatError) return { status: error.status, error: error.message, code: error.code };
  return { status: 500, error: "Qwen Code の実行に失敗しました", code: "failed" };
}
