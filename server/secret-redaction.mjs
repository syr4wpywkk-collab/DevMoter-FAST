export function redactSecretsInText(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) {
    const normalized = String(secret || "");
    if (normalized) text = text.split(normalized).join("[REDACTED]");
  }
  return text;
}

/**
 * Redact known secret values plus common Authorization, Cookie, API key,
 * credentialed URL, and token patterns before writing errors to server logs.
 */
export function redactLogText(value, secrets = []) {
  let text = redactSecretsInText(value, secrets);
  text = text.replace(
    /\b(authorization\s*[:=]\s*["']?(?:bearer|basic)\s+)([^\s"',;]+)/gi,
    "$1[REDACTED]"
  );
  text = text.replace(
    /\b((?:set-)?cookie\s*[:=]\s*)([^\r\n]+)/gi,
    "$1[REDACTED]"
  );
  text = text.replace(
    /\b((?:x-api-key|x-devmoter-device-token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*["']?)([^\s"',;]+)/gi,
    "$1[REDACTED]"
  );
  text = text.replace(/(https?:\/\/)([^\s/@:]+:[^\s/@]+)@/gi, "$1[REDACTED]@");
  text = text.replace(
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
    "[REDACTED]"
  );
  // A Basic credential can also appear without an "Authorization:" label
  // (raw header dumps); redact the token in that form too.
  text = text.replace(/\b(basic\s+)([A-Za-z0-9+/=]{8,})/gi, "$1[REDACTED]");
  // Neutralize CR/LF and other control characters so attacker-influenced
  // error text cannot forge additional log lines (CWE-117). Redaction runs
  // first so multi-line secrets are still matched before lines are joined.
  text = text.replace(/[\u0000-\u001f\u007f]/g, (ch) => {
    if (ch === "\t") return ch;
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    return " ";
  });
  return text;
}
