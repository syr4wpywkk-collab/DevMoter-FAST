// Pure formatting helpers for the Settings > 診断 page (#468-#473).
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

const CONNECTION_IDS = ["opencode", "codex"];
const CONNECTION_STATES = new Set(["connected", "failed", "unknown"]);
export const FAILURE_KINDS = ["auth", "offline", "timeout", "unknown"];

function failureKind(value) {
  return FAILURE_KINDS.includes(value) ? value : "unknown";
}

function isoTime(value) {
  const time = typeof value === "number" ? value : Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// #468: one entry per backend. `stale` (the latest fetch failed or never ran) turns every
// state into "unknown", so an old success is never presented as the current connection.
export function listConnections(diagnostics, { stale = false } = {}) {
  const reported = Array.isArray(diagnostics?.connections) ? diagnostics.connections : null;
  return CONNECTION_IDS.map(id => {
    const entry = reported?.find(item => item?.id === id);
    const legacy = diagnostics?.backends?.[id];
    let state = "unknown";
    let failure = null;
    let httpStatus = null;
    let checkedAt = null;
    if (entry && CONNECTION_STATES.has(entry.state)) {
      state = entry.state;
      failure = state === "failed" ? failureKind(entry.failure) : null;
      httpStatus = Number.isInteger(entry.httpStatus) ? entry.httpStatus : null;
      checkedAt = isoTime(entry.checkedAt);
    } else if (!reported && legacy && typeof legacy.online === "boolean") {
      state = legacy.online ? "connected" : "failed";
      failure = legacy.online ? null : "unknown";
      checkedAt = isoTime(diagnostics?.generatedAt);
    }
    if (stale || !checkedAt) return { id, state: "unknown", failure: null, httpStatus: null, checkedAt: null };
    return { id, state, failure, httpStatus, checkedAt };
  });
}

export function describeConnection(connection, locale) {
  const lang = normalizeLanguage(locale) ?? getLanguage();
  if (connection?.state === "connected") {
    return { tone: "ok", label: translate(lang, "diagnostics.connection.connected"), guide: "" };
  }
  if (connection?.state === "failed") {
    const kind = failureKind(connection.failure);
    return {
      tone: "error",
      label: translate(lang, `diagnostics.failure.${kind}`),
      guide: translate(lang, `diagnostics.guide.${kind}`)
    };
  }
  return { tone: "info", label: unknownLabel(lang), guide: "" };
}

export function formatCheckedAt(value, locale) {
  const iso = isoTime(value);
  const lang = normalizeLanguage(locale) ?? getLanguage();
  return iso ? translate(lang, "diagnostics.checkedAt", { time: formatTime(Date.parse(iso), lang) }) : translate(lang, "diagnostics.notChecked");
}

// #472: why the request from this device to the DevMoter host failed.
export function classifyFetchFailure(error, { online = true } = {}) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504 || error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  if (online === false) return "offline";
  if (!Number.isFinite(status) && error?.name === "TypeError") return "offline";
  return "unknown";
}

export function describeFetchFailure(kind, locale) {
  const lang = normalizeLanguage(locale) ?? getLanguage();
  const safe = failureKind(kind);
  return { label: translate(lang, `diagnostics.failure.${safe}`), guide: translate(lang, `diagnostics.hostGuide.${safe}`) };
}

function plainVersion(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^v?\d{1,4}(?:\.\d{1,4}){0,3}(?:[-+][0-9A-Za-z.]{1,32})?$/.test(text) ? text : "unknown";
}

function plainName(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/.test(text) ? text : null;
}

// #471: support report built from an allowlist of fields. It never includes tokens, passwords,
// error text, host names, paths, device or owner ids, project names or file contents.
// Always English so support can read it regardless of the UI language.
export function buildDiagnosticsReport({ diagnostics, fetchState, fetchFailure, clientBuild, cliStatus, now = Date.now() } = {}) {
  const stale = !Number.isFinite(fetchState?.fetchedAt)
    || (Number.isFinite(fetchState?.failedAt) && fetchState.failedAt >= fetchState.fetchedAt);
  const build = value => {
    const text = formatBuildId(value, "en");
    return text === UNKNOWN_LABEL ? "unknown" : text;
  };
  const node = formatNodeVersion(diagnostics?.app?.node, "en");
  const lines = [
    "DevMoter FAST diagnostics",
    `Copied at: ${isoTime(now) ?? "unknown"}`,
    `Last successful fetch: ${isoTime(fetchState?.fetchedAt) ?? "never"}`,
    `Latest fetch: ${stale ? `failed (${failureKind(fetchFailure)})` : "ok"}`,
    `App version: ${plainVersion(diagnostics?.app?.version)}`,
    `Host build: ${build(diagnostics?.app?.build)}`,
    `Device build: ${build(clientBuild)}`,
    `Node.js: ${node === UNKNOWN_LABEL ? "unknown" : node}`,
    "Connections:"
  ];
  for (const connection of listConnections(diagnostics, { stale })) {
    const detail = connection.state === "failed"
      ? `failed (${connection.failure}${connection.httpStatus ? `, HTTP ${connection.httpStatus}` : ""})`
      : connection.state;
    lines.push(`- ${connection.id}: ${detail}${connection.checkedAt ? ` @ ${connection.checkedAt}` : ""}`);
  }
  const clis = (Array.isArray(cliStatus) ? cliStatus : [])
    .map(cli => ({ name: plainName(cli?.command) , presence: cli?.presence, version: cli?.version }))
    .filter(cli => cli.name);
  if (clis.length) {
    lines.push("CLI:");
    for (const cli of clis) {
      const presence = cli.presence === "ready" ? `ready ${plainVersion(cli.version)}` : cli.presence === "missing" ? "missing" : "error";
      lines.push(`- ${cli.name}: ${presence}`);
    }
  }
  const required = diagnostics?.prerequisites?.required;
  if (required && typeof required === "object") {
    const names = Object.keys(required).map(plainName).filter(Boolean);
    lines.push(`Prerequisites: ${names.map(name => `${name}=${required[name]?.available ? "ok" : "missing"}`).join(", ") || "unknown"}`);
  }
  const projects = Number(diagnostics?.projects?.count);
  lines.push(`Projects: ${Number.isInteger(projects) && projects >= 0 ? projects : "unknown"}`);
  const localhost = diagnostics?.network?.localhostFirst;
  lines.push(`Bind: ${typeof localhost === "boolean" ? (localhost ? "localhost" : "custom") : "unknown"}`);
  return `${lines.join("\n")}\n`;
}
