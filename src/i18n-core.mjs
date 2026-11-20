import { en } from "./locales/en.mjs";
import { ja } from "./locales/ja.mjs";
import { zhHans } from "./locales/zh-Hans.mjs";
import { zhHant } from "./locales/zh-Hant.mjs";

export const STORAGE_KEY = "devmoter-language";
export const SUPPORTED_LANGUAGES = Object.freeze(["ja", "en", "zh-Hans", "zh-Hant"]);

export const DICTIONARIES = Object.freeze({
  en: Object.freeze({ ...en }),
  ja: Object.freeze({ ...ja }),
  "zh-Hans": Object.freeze({ ...zhHans }),
  "zh-Hant": Object.freeze({ ...zhHant })
});

const LOCALE_TAGS = Object.freeze({
  ja: "ja-JP",
  en: "en-US",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW"
});

const SERVER_MESSAGE_KEYS = Object.freeze({
  "Authentication required": "errors.server.authRequired",
  "DevMoter authentication required.": "errors.server.authRequired",
  "Too many authentication attempts. Try again later.": "errors.server.rateLimited",
  "Trusted device required": "errors.server.trustedDeviceRequired",
  "Name must be 1–120 characters on one line": "promptTemplates.error.nameInvalid",
  "Description must be 500 characters or fewer": "promptTemplates.error.descriptionInvalid",
  "Template body is required": "promptTemplates.error.bodyRequired",
  "Template body is too large": "promptTemplates.error.bodyTooLarge",
  "Project is not registered": "promptTemplates.error.projectNotRegistered",
  "Template not found": "promptTemplates.error.notFound",
  "Template limit reached": "promptTemplates.error.limitReached",
  "Backup holds too many templates": "promptTemplates.error.backupTooMany",
  "Not a DevMoter prompt template backup": "promptTemplates.error.backupWrongFormat",
  "Unsupported backup version": "promptTemplates.error.backupWrongVersion",
  "Prompt template operation failed": "promptTemplates.error.failed",
  "Backup contains duplicate template IDs": "promptTemplates.error.backupInvalid",
  "Backup must be a JSON object": "promptTemplates.error.backupInvalid",
  "Backup templates must be a list": "promptTemplates.error.backupInvalid",
  "Invalid template timestamp": "promptTemplates.error.backupInvalid",
  "Template entry must be an object": "promptTemplates.error.backupInvalid",
  "Invalid template ID": "promptTemplates.error.backupInvalid",
  "Invalid project ID": "promptTemplates.error.backupInvalid",
  "Trusted device token required": "errors.server.trustedDeviceRequired",
  "A trusted device is required for terminal access.": "errors.server.trustedDeviceRequired",
  "Trusted device state is unavailable.": "errors.server.trustedDeviceStateUnavailable",
  "Invalid or revoked device token": "errors.server.trustedDeviceRevoked",
  "Trusted device has been revoked.": "errors.server.trustedDeviceRevoked",
  "A trusted device already exists; use pairing instead": "errors.server.trustedDeviceAlreadyExists",
  "The pairing device has been revoked": "errors.server.pairingDeviceRevoked",
  "First trusted device must be created from http://127.0.0.1 or http://localhost": "errors.server.firstTrustedDeviceLocalOnly",
  "Too many failed pairing attempts; try again later": "errors.server.pairingRateLimited",
  "Pairing code is invalid or expired": "errors.server.pairingCodeInvalid",
  "Device not found": "errors.server.deviceNotFound",
  "Owner authentication is required": "errors.server.authRequired",
  "Confirm this sign-in with a Passkey": "errors.server.passkeyStepUpRequired",
  "Terminal is disabled until DEVMOTER_AUTH_PASSWORD is configured with at least 16 characters.": "errors.server.terminalDisabled",
  "Persistent terminal state is unavailable.": "errors.server.terminalStateUnavailable",
  "Terminal session not found.": "errors.server.terminalNotFound",
  "Persistent terminal session not found.": "errors.server.terminalNotFound",
  "Terminal session is not owned by this trusted device. Claim it explicitly to transfer access.": "errors.server.terminalNotOwned",
  "Terminal session capability is invalid.": "errors.server.terminalCapabilityInvalid",
  "Terminal session is already closed.": "errors.server.terminalAlreadyClosed",
  "Project registration changed; terminal re-attach denied.": "errors.server.terminalProjectChanged",
  "Project is no longer registered; terminal re-attach denied.": "errors.server.terminalProjectRemoved",
  "Persistent terminal session has expired or is unavailable.": "errors.server.terminalExpired",
  "Persistent terminal session is no longer running.": "errors.server.terminalNotRunning",
  "Terminal entry must be explicit.": "errors.server.terminalExplicitEntry",
  "Terminal session claim must be explicit.": "errors.server.terminalExplicitClaim",
  "Persistent sessions require tmux and private terminal session storage on this host.": "errors.server.terminalTmuxRequired",
  "A terminal session with that name already exists in this project.": "errors.server.terminalDuplicateName",
  "Terminal session limit reached.": "errors.server.terminalLimitReached",
  "Persistent terminal sessions require an available tmux installation.": "errors.server.terminalNoTmux",
  "Persistent terminal metadata could not be stored safely.": "errors.server.terminalMetadataError",
  "Terminal input chunk is too large.": "errors.server.terminalInputTooLarge",
  "Terminal socket Origin is required.": "errors.server.terminalOriginRequired",
  "Too many pending terminal connections.": "errors.server.terminalTooManyPending",
  "Operation ID must be 160 characters or fewer": "errors.server.operationIdTooLong",
  "Duplicate operation suppressed; previous outcome is unknown": "errors.server.duplicateOperation",
  "Project not found": "errors.server.projectNotFound",
  "OpenCode provider discovery failed": "errors.server.opencodeDiscoveryFailed",
  "Cross-origin mutation rejected": "errors.server.crossOriginRejected",
  "Integration status unavailable": "errors.server.integrationStatusUnavailable",
  "Integration operation failed": "errors.server.integrationFailed",
  "Antigravity Remote Control status unavailable": "errors.server.antigravityRemoteUnavailable",
  "Qwen Code のモデル一覧を読めませんでした": "errors.server.qwenModelsFailed",
  "Qwen Code の実行に失敗しました": "errors.server.qwenRunFailed",
  "実行IDが不正です": "errors.server.invalidRunId",
  "停止できませんでした": "errors.server.stopFailed",
  "この実行は照合できません。ホスト再起動後は自動再開しません。": "errors.server.runCannotResume",
  "保存先に接続できません。": "errors.server.officeSaveConnectionFailed",
  "APIキーが未設定です": "errors.server.apiKeyNotConfigured",
  "DevMoter server error": "errors.server.devmoterServerError",
  "Host restarted while this agent run was active": "errors.server.hostRestartedDuringRun",
  "Unsupported approval decision": "errors.server.unsupportedApproval",
  "No trusted verification commands are configured in DevMoter user settings.": "errors.server.noVerifyCommands",
  "Verification deadline exceeded before all configured commands completed.": "errors.server.verifyTimeout",
  "Repair loop is disabled in trusted DevMoter user settings.": "errors.server.repairDisabled",
  "Verification still fails after the configured repair limit.": "errors.server.repairLimitExceeded",
  "Preview is stopped or token is invalid": "errors.server.previewStopped",
  "Live preview proxy is read-only": "errors.server.previewReadOnly",
  "Preview host is not allowed": "errors.server.previewHostDisallowed",
  "Grant not found": "errors.server.grantNotFound"
});

const listeners = new Set();
let storageSyncInstalled = false;

function normalizeChineseLanguage(normalized) {
  const subtags = normalized.split("-").slice(1);
  const extIdx = subtags.indexOf("x");
  const tags = extIdx === -1 ? subtags : subtags.slice(0, extIdx);
  if (tags.includes("hant")) return "zh-Hant";
  if (tags.includes("hans")) return "zh-Hans";
  if (tags.includes("tw") || tags.includes("hk") || tags.includes("mo")) return "zh-Hant";
  return "zh-Hans";
}

export function normalizeLanguage(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "zh" || normalized.startsWith("zh-")) return normalizeChineseLanguage(normalized);
  return null;
}

export function detectBrowserLanguage(nav = globalThis.navigator) {
  if (!nav) return "en";
  const candidates = [];
  if (Array.isArray(nav.languages) || (nav.languages && typeof nav.languages[Symbol.iterator] === "function")) {
    candidates.push(...nav.languages);
  }
  if (typeof nav.language === "string") candidates.push(nav.language);
  for (const candidate of candidates) {
    const match = normalizeLanguage(candidate);
    if (match) return match;
  }
  return "en";
}

export function resolveLanguage(value) {
  const explicit = normalizeLanguage(value);
  if (explicit) return explicit;
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    const normalized = normalizeLanguage(stored);
    if (normalized) {
      if (normalized === "zh-Hans" && typeof stored === "string" && stored.trim().toLowerCase() === "zh") {
        try {
          globalThis.localStorage?.setItem?.(STORAGE_KEY, "zh-Hans");
        } catch {
          // Ignore storage write restrictions.
        }
      }
      return normalized;
    }
  } catch {
    // Ignore storage read restrictions.
  }
  return detectBrowserLanguage();
}

export function getLanguage() {
  return resolveLanguage();
}

export function localeTag(language = getLanguage()) {
  const normalized = normalizeLanguage(language) ?? "en";
  return LOCALE_TAGS[normalized] || LOCALE_TAGS.en;
}

export function speechRecognitionLanguage(language = getLanguage()) {
  return localeTag(language);
}

export function applyDocumentLocale(language = getLanguage(), doc = globalThis.document) {
  const normalized = normalizeLanguage(language) ?? "en";
  if (doc?.documentElement) {
    doc.documentElement.lang = normalized;
  }
  return normalized;
}

export function syncLanguageSelectors(root = globalThis.document, language = getLanguage()) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const active = normalizeLanguage(language) ?? "en";
  for (const select of root.querySelectorAll("[data-language-select]")) {
    ensureSelectOptions(select);
    select.value = active;
  }
}

export function ensureSelectOptions(select) {
  if (!select || !select.ownerDocument) return;
  const currentValues = Array.from(select.options || []).map(option => option.value);
  if (
    currentValues.length === SUPPORTED_LANGUAGES.length &&
    SUPPORTED_LANGUAGES.every((lang, index) => currentValues[index] === lang)
  ) {
    return;
  }
  const doc = select.ownerDocument;
  select.replaceChildren();
  for (const lang of SUPPORTED_LANGUAGES) {
    const option = doc.createElement("option");
    option.value = lang;
    option.textContent = translate(lang, `language.${lang}`);
    select.appendChild(option);
  }
}

export function onLanguageChange(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(language, options = {}) {
  const next = normalizeLanguage(language) ?? "en";
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore storage write failures (e.g. private mode).
  }
  applyDocumentLocale(next);
  syncLanguageSelectors(globalThis.document, next);
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // Listener errors should not abort language persistence.
    }
  }
  if (options?.reload && typeof globalThis.window?.location?.reload === "function") {
    globalThis.window.location.reload();
  }
  return next;
}

export function interpolate(template, params) {
  if (typeof template !== "string") return "";
  if (!params || typeof params !== "object") return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (full, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return full;
    const value = params[name];
    return value === undefined || value === null ? full : String(value);
  });
}

export function translate(language, key, params) {
  if (typeof key !== "string") return "";
  const normalized = normalizeLanguage(language) ?? "en";
  const selected = DICTIONARIES[normalized]?.[key];
  const fallback = DICTIONARIES.en?.[key];
  const template = typeof selected === "string" ? selected : typeof fallback === "string" ? fallback : key;
  return interpolate(template, params);
}

export function t(key, params) {
  return translate(getLanguage(), key, params);
}

export function formatDateTime(value, options = undefined, language = undefined) {
  const date =
    value instanceof Date
      ? value
      : value && typeof value === "object" && typeof value.getTime === "function"
        ? new Date(value.getTime())
        : new Date(typeof value === "string" || typeof value === "number" ? value : NaN);
  if (!Number.isFinite(date.getTime())) return "";
  const tag = localeTag(language ?? getLanguage());
  try {
    return options === undefined ? date.toLocaleString(tag) : new Intl.DateTimeFormat(tag, options).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatTime(value, options = { hour: "2-digit", minute: "2-digit" }, language = undefined) {
  return formatDateTime(value, options, language);
}

export function formatNumber(value, options = undefined, language = undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const tag = localeTag(language ?? getLanguage());
  try {
    return new Intl.NumberFormat(tag, options).format(numeric);
  } catch {
    return String(numeric);
  }
}

export function formatRelativeTime(timestamp, now = Date.now(), language = undefined) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const lang = normalizeLanguage(language) ?? getLanguage();
  const tag = localeTag(lang);
  const diff = Math.max(0, now - numeric);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= 7 * day) {
    return formatDateTime(numeric, { month: "numeric", day: "numeric" }, lang);
  }
  try {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    if (diff < minute) return rtf.format(0, "second");
    if (diff < hour) return rtf.format(-Math.floor(diff / minute), "minute");
    if (diff < day) return rtf.format(-Math.floor(diff / hour), "hour");
    return rtf.format(-Math.floor(diff / day), "day");
  } catch {
    return formatDateTime(numeric, { month: "numeric", day: "numeric" }, lang);
  }
}

export function translateServerMessage(raw, language = undefined) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const key = SERVER_MESSAGE_KEYS[trimmed];
  if (!key) return raw;
  return translate(language ?? getLanguage(), key);
}

const APP_KEY_IDS = {
  "mission-control": "missionControl",
  "developer-workflows": "developerWorkflows"
};

export function tApp(appId, field = "title", language = undefined) {
  const normalizedId = APP_KEY_IDS[appId] || appId;
  const key = `apps.${normalizedId}.${field}`;
  const value = translate(language ?? getLanguage(), key);
  return value === key ? "" : value;
}

export function bindLanguageSelectors(root = globalThis.document, options = {}) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const reload = options?.reload !== false;
  const current = getLanguage();
  for (const select of root.querySelectorAll("[data-language-select]")) {
    ensureSelectOptions(select);
    select.value = current;
    if (select.dataset.i18nBound === "1") continue;
    select.dataset.i18nBound = "1";
    select.addEventListener("change", () => {
      setLanguage(select.value, { reload });
    });
  }
}

export function startI18n(options = {}) {
  const current = applyDocumentLocale(getLanguage());
  bindLanguageSelectors(globalThis.document, options);
  if (!storageSyncInstalled && typeof globalThis.window?.addEventListener === "function") {
    storageSyncInstalled = true;
    globalThis.window.addEventListener("storage", event => {
      if (event.key !== STORAGE_KEY) return;
      const next = applyDocumentLocale(getLanguage());
      syncLanguageSelectors(globalThis.document, next);
      for (const listener of listeners) {
        try {
          listener(next);
        } catch {
          // Ignore listener failures during storage sync.
        }
      }
    });
  }
  return current;
}
