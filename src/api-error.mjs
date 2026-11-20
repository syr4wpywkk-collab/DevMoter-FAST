// One user-facing message for a failed API call, whichever screen made it.
// Server text is translated when known and cut to one bounded line, so stack
// traces, HTML error pages and objects never reach the UI.

import { getLanguage, translate, translateServerMessage } from "./i18n-core.mjs";

const SERVER_TEXT_LIMIT = 300;

function serverText(payload) {
  const error = payload?.error;
  const raw = typeof error === "string" ? error
    : typeof error?.message === "string" ? error.message
      : typeof payload?.message === "string" ? payload.message
        : "";
  const line = raw.split(/\r?\n/, 1)[0].trim();
  if (!line || /^<!doctype|^<html/i.test(line)) return "";
  return Array.from(line).slice(0, SERVER_TEXT_LIMIT).join("");
}

function statusKey(status) {
  if (status === 401) return "common.error.unauthorized";
  if (status === 403) return "common.error.forbidden";
  if (status === 404) return "common.error.notFound";
  if (status === 408 || status === 504) return "common.error.timeout";
  if (status === 413) return "common.error.tooLarge";
  if (status === 429) return "common.error.rateLimited";
  if (status >= 500) return "common.error.server";
  return "common.error.requestFailed";
}

export function apiErrorMessage(payload, status, language = undefined) {
  const lang = language ?? getLanguage();
  const text = serverText(payload);
  if (text) return translateServerMessage(text, lang) || text;
  return translate(lang, statusKey(Number(status) || 0), { status: Number(status) || 0 });
}

// For a rejected fetch (offline, DNS, CORS) or any thrown value.
export function requestErrorMessage(error, language = undefined) {
  const lang = language ?? getLanguage();
  if (error?.name === "TimeoutError") return translate(lang, "common.error.timeout");
  if (error instanceof TypeError) return translate(lang, "common.error.network");
  if (error instanceof Error && error.message) return error.message;
  return translate(lang, "common.error.unknown");
}
