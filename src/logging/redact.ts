// Redaction applied to every log record before it is written.

export const REDACTED = '[REDACTED]';

// URL-valued keys are not listed: credentials inside URLs are masked by redactString.
const SENSITIVE_KEY =
  /pass(word|wd|phrase)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|connection[-_]?string|^dsn$/i;

// scheme://user:password@host -> scheme://user:[REDACTED]@host
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]*):[^\s/@]+@/gi;
// DevMoter Base API keys (see docs/architecture.md).
const API_KEY = /\bdmb_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactString(value: string): string {
  return value
    .replace(URL_CREDENTIALS, `$1:${REDACTED}@`)
    .replace(API_KEY, REDACTED)
    .replace(BEARER, `$1 ${REDACTED}`);
}
