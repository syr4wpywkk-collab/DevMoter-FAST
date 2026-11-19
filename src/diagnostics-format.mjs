// Pure formatting helpers for the Settings > 診断 page (#469, #470, #473).
// Only values the server returned are shown. Anything that does not look like a
// plain version / build identifier is shown as 不明 instead of being echoed, so
// an unexpected environment value can never leak into the UI.

import { formatDateTime, getLanguage, normalizeLanguage, t, translate } from "./i18n-core.mjs";

export const UNKNOWN_LABEL = "Unknown";

export function unknownLabel(language) {
  return translate(language ?? getLanguage(), "diagnostics.unknown");
}

const NODE_VERSION_PATTERN = /^v?\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z.]{1,32})?$/;
const BUILD_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function formatNodeVersion(value, language) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!NODE_VERSION_PATTERN.test(text)) return unknownLabel(language);
  return text.startsWith("v") ? text : `v${text}`;
}

export function formatBuildId(value, language) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!BUILD_ID_PATTERN.test(text)) return unknownLabel(language);
  return FULL_SHA_PATTERN.test(text) ? text.slice(0, 12) : text;
}

function formatTime(timestamp, locale) {
  const formatted = formatDateTime(timestamp, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }, locale);
  return formatted || new Date(timestamp).toISOString();
}

// state: { fetchedAt: number | null, failedAt: number | null, loading?: boolean }
export function describeHealthFetch(state, locale) {
  const lang = normalizeLanguage(locale) ?? getLanguage();
  const fetchedAt = Number.isFinite(state?.fetchedAt) ? state.fetchedAt : null;
  const failedAt = Number.isFinite(state?.failedAt) ? state.failedAt : null;
  if (state?.loading) {
    return { tone: "info", text: translate(lang, "diagnostics.fetching") };
  }
  if (failedAt !== null && (fetchedAt === null || failedAt >= fetchedAt)) {
    const last = fetchedAt === null
      ? translate(lang, "diagnostics.noSuccessfulFetch")
      : translate(lang, "diagnostics.lastSuccessfulFetch", { time: formatTime(fetchedAt, lang) });
    return {
      tone: "error",
      text: translate(lang, "diagnostics.fetchFailed", { time: formatTime(failedAt, lang), last })
    };
  }
  if (fetchedAt !== null) {
    return { tone: "ok", text: translate(lang, "diagnostics.lastFetched", { time: formatTime(fetchedAt, lang) }) };
  }
  return { tone: "info", text: translate(lang, "diagnostics.neverFetched") };
}
