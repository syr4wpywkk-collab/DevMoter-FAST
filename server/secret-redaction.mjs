const REDACTED_MARKER = "[REDACTED]";
const REDACTED_MARKER_BUFFER = Buffer.from(REDACTED_MARKER, "utf8");

export function redactSecretsInText(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets) {
    const normalized = String(secret || "");
    if (normalized) text = text.split(normalized).join(REDACTED_MARKER);
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

export function expandRedactionSecrets(secrets = []) {
  const expanded = new Set();
  for (const secret of secrets) {
    const normalized = String(secret || "");
    if (!normalized) continue;
    expanded.add(normalized);
    const jsonEscaped = JSON.stringify(normalized).slice(1, -1);
    if (jsonEscaped && jsonEscaped !== normalized) {
      expanded.add(jsonEscaped);
    }
  }
  return [...expanded].sort((a, b) => b.length - a.length);
}

/**
 * Incremental text redactor that masks secrets even when split across stream
 * chunks while flushing non-matching suffixes immediately (preserving SSE latency).
 */
export function createStreamingTextRedactor(secrets = []) {
  const list = expandRedactionSecrets(secrets);
  const maxLen = list.reduce((max, item) => Math.max(max, item.length), 0);
  let pending = "";

  function longestPrefixSuffix(text) {
    if (maxLen <= 1 || !text) return 0;
    const limit = Math.min(text.length, maxLen - 1);
    for (let len = limit; len >= 1; len -= 1) {
      const tail = text.slice(text.length - len);
      for (const secret of list) {
        if (secret.length > len && secret.startsWith(tail)) {
          return len;
        }
      }
    }
    return 0;
  }

  return {
    push(chunk) {
      const text = chunk == null ? "" : String(chunk);
      if (!text) return "";
      if (!list.length) return text;
      const combined = redactSecretsInText(pending + text, list);
      const hold = longestPrefixSuffix(combined);
      pending = hold > 0 ? combined.slice(combined.length - hold) : "";
      return hold > 0 ? combined.slice(0, combined.length - hold) : combined;
    },
    flush() {
      if (!pending) return "";
      const out = redactSecretsInText(pending, list);
      pending = "";
      return out;
    }
  };
}

function replaceSecretBuffers(buf, patterns) {
  if (!buf.length || !patterns.length) return buf;
  const parts = [];
  let cursor = 0;
  while (cursor < buf.length) {
    let earliest = -1;
    let matchedPattern = null;
    for (const pat of patterns) {
      const idx = buf.indexOf(pat, cursor);
      if (idx === -1) continue;
      if (earliest === -1 || idx < earliest || (idx === earliest && pat.length > matchedPattern.length)) {
        earliest = idx;
        matchedPattern = pat;
      }
    }
    if (earliest === -1) {
      if (cursor === 0) return buf;
      parts.push(buf.subarray(cursor));
      break;
    }
    if (earliest > cursor) parts.push(buf.subarray(cursor, earliest));
    parts.push(REDACTED_MARKER_BUFFER);
    cursor = earliest + matchedPattern.length;
  }
  return parts.length ? Buffer.concat(parts) : Buffer.alloc(0);
}

/**
 * Incremental byte-stream redactor for binary/unknown proxied responses where
 * decoding UTF-8 could alter non-text bytes.
 */
export function createStreamingBufferRedactor(secrets = []) {
  const patterns = expandRedactionSecrets(secrets)
    .map(secret => Buffer.from(secret, "utf8"))
    .filter(buf => buf.length > 0);
  const maxLen = patterns.reduce((max, buf) => Math.max(max, buf.length), 0);
  let pending = Buffer.alloc(0);

  return {
    push(chunk) {
      if (!chunk || !chunk.length) return Buffer.alloc(0);
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (!patterns.length) return buf;
      const combined = pending.length ? Buffer.concat([pending, buf]) : buf;
      const replaced = replaceSecretBuffers(combined, patterns);
      let hold = 0;
      if (maxLen > 1 && replaced.length > 0) {
        const limit = Math.min(replaced.length, maxLen - 1);
        for (let len = limit; len >= 1; len -= 1) {
          const tail = replaced.subarray(replaced.length - len);
          if (patterns.some(pat => pat.length > len && pat.subarray(0, len).equals(tail))) {
            hold = len;
            break;
          }
        }
      }
      if (hold > 0) {
        pending = Buffer.from(replaced.subarray(replaced.length - hold));
        return replaced.subarray(0, replaced.length - hold);
      }
      pending = Buffer.alloc(0);
      return replaced;
    },
    flush() {
      if (!pending.length) return Buffer.alloc(0);
      const out = pending;
      pending = Buffer.alloc(0);
      return out;
    }
  };
}
