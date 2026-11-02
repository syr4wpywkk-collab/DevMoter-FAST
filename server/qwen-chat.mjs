import { execFile } from "node:child_process";
import { integrationChildEnv } from "./integrations.mjs";

const QWEN_TIMEOUT_MS = 10 * 60_000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class QwenChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function qwenChatArgs(prompt, sessionId) {
  const text = String(prompt || "").trim();
  if (!text) throw new QwenChatError("メッセージが空です");
  if (text.length > 20_000) throw new QwenChatError("メッセージが長すぎます");
  const args = ["--output-format", "json"];
  if (sessionId) {
    if (!SESSION_ID.test(String(sessionId))) throw new QwenChatError("セッションIDが不正です");
    args.push("--resume", String(sessionId));
  }
  // The prompt is a single argv entry (no shell), so it cannot inject flags.
  args.push("--prompt", text);
  return args;
}

export function parseQwenJson(stdout) {
  let messages;
  try {
    messages = JSON.parse(String(stdout || "").trim());
  } catch {
    throw new QwenChatError("Qwen Code の応答を読めませんでした", 502);
  }
  if (!Array.isArray(messages)) throw new QwenChatError("Qwen Code の応答を読めませんでした", 502);
  const result = [...messages].reverse().find(item => item?.type === "result");
  const sessionId = String(result?.session_id || messages.find(item => item?.session_id)?.session_id || "");
  if (result?.is_error) throw new QwenChatError(String(result.result || result.error || "Qwen Code エラー").slice(0, 2000), 502);
  const text = typeof result?.result === "string" ? result.result : "";
  return { text: text.slice(0, 200_000), sessionId: SESSION_ID.test(sessionId) ? sessionId : null };
}

export function runQwenChat({ prompt, sessionId, cwd, bin = process.env.QWEN_BIN || "qwen" }) {
  const args = qwenChatArgs(prompt, sessionId);
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      cwd,
      timeout: QWEN_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: { ...integrationChildEnv("qwen"), NO_COLOR: "1", TERM: "dumb" }
    }, (error, stdout) => {
      if (error?.code === "ENOENT") return reject(new QwenChatError("Qwen Code が未インストールです", 404));
      try {
        resolve(parseQwenJson(stdout));
      } catch (parseError) {
        if (error?.killed) return reject(new QwenChatError("Qwen Code がタイムアウトしました", 504));
        reject(error ? new QwenChatError("Qwen Code の実行に失敗しました", 502) : parseError);
      }
    });
  });
}

export function publicQwenChatError(error) {
  if (error instanceof QwenChatError) return { status: error.status, error: error.message };
  return { status: 500, error: "Qwen Code の実行に失敗しました" };
}
