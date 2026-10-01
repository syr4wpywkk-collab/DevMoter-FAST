const MAX_REASON_LENGTH = 320;
import { redactSensitiveText } from "./session-tools.mjs";

function redact(value) {
  let text = String(value ?? "").split(/[\r\n]/, 1)[0]
    .replace(/(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|credential|private[_-]?key)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1\"[redacted]\"")
    .replace(/([?&](?:access[_-]?token|token|key|api[_-]?key|password|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(?:^|\s)(?:\/(?:home|Users|srv|workspace|tmp|var|opt|etc)\/[^\s:]+)/g, " [local path]")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[local path]");
  text = redactSensitiveText(text)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_REASON_LENGTH);
  return text;
}

function scalarText(value) {
  return typeof value === "string" || typeof value === "number" ? redact(value) : "";
}

export function normalizeCodexSendError(error) {
  const candidate = error && typeof error === "object" ? error : {};
  const nativeError = candidate.error && typeof candidate.error === "object" ? candidate.error : {};
  const info = candidate.codexErrorInfo && typeof candidate.codexErrorInfo === "object"
    ? candidate.codexErrorInfo
    : nativeError.codexErrorInfo && typeof nativeError.codexErrorInfo === "object" ? nativeError.codexErrorInfo : {};
  const nested = Object.keys(nativeError).length ? nativeError : info;
  const rawMessage = typeof error === "string"
    ? error
    : candidate.message ?? nested.message ?? info.message ?? candidate.reason ?? info.reason ?? (typeof candidate.error === "string" ? candidate.error : "");
  const reason = redact(rawMessage);
  const code = scalarText(candidate.code ?? nested.code ?? info.code ?? "");
  const structuredCategory = info.category ?? candidate.category;
  const categoryName = typeof structuredCategory === "string"
    ? redact(structuredCategory)
    : structuredCategory && typeof structuredCategory === "object"
      ? Object.keys(structuredCategory).map(redact).join(" ")
      : "";
  const structuredStatus = scalarText(info.httpStatusCode ?? info.statusCode ?? nested.httpStatusCode ?? nested.statusCode ?? "");
  const probe = `${code} ${categoryName} ${structuredStatus} ${reason}`.toLowerCase();
  let category = categoryName || "Codex error";
  if (category !== "Codex error" && !/^(authentication|rate limit|usage limit|connection|request|service|model|codex error)$/i.test(category)) {
    if (/auth|credential|login/.test(category.toLowerCase())) category = "Authentication";
    else if (/rate.?limit/.test(category.toLowerCase())) category = "Rate limit";
    else if (/quota|usage/.test(category.toLowerCase())) category = "Usage limit";
    else if (/connection|network|offline/.test(category.toLowerCase())) category = "Connection";
    else if (/invalid|request/.test(category.toLowerCase())) category = "Request";
    else if (/service|server|http.*(?:503|502|500)/.test(category.toLowerCase()) || /^(500|502|503|504)$/.test(structuredStatus)) category = "Service";
    else if (/model/.test(category.toLowerCase())) category = "Model";
    else category = "Codex error";
  }
  if (category !== "Codex error") {
    return { category, reason: reason || "Codex did not provide a reason.", code };
  }
  if (/auth|unauthor|credential|login|sign.?in|401|403/.test(probe)) category = "Authentication";
  else if (/rate.?limit|too many requests|429/.test(probe)) category = "Rate limit";
  else if (/quota|usage limit|billing/.test(probe)) category = "Usage limit";
  else if (/network|fetch|connection|offline|timeout|timed out|econn|socket/.test(probe)) category = "Connection";
  else if (/invalid|bad request|unsupported|400|422/.test(probe)) category = "Request";
  else if (/server|service unavailable|500|502|503|504/.test(probe)) category = "Service";
  return { category, reason: reason || "Codex did not provide a reason.", code };
}
