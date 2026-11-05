// Pure formatting helpers for the Settings > 診断 page (#469, #470, #473).
// Only values the server returned are shown. Anything that does not look like a
// plain version / build identifier is shown as 不明 instead of being echoed, so
// an unexpected environment value can never leak into the UI.

export const UNKNOWN_LABEL = "不明";

const NODE_VERSION_PATTERN = /^v?\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z.]{1,32})?$/;
const BUILD_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function formatNodeVersion(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!NODE_VERSION_PATTERN.test(text)) return UNKNOWN_LABEL;
  return text.startsWith("v") ? text : `v${text}`;
}

export function formatBuildId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!BUILD_ID_PATTERN.test(text)) return UNKNOWN_LABEL;
  return FULL_SHA_PATTERN.test(text) ? text.slice(0, 12) : text;
}

function formatTime(timestamp, locale) {
  try {
    return new Date(timestamp).toLocaleString(locale || undefined, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch {
    return new Date(timestamp).toISOString();
  }
}

// state: { fetchedAt: number | null, failedAt: number | null, loading?: boolean }
export function describeHealthFetch(state, locale) {
  const fetchedAt = Number.isFinite(state?.fetchedAt) ? state.fetchedAt : null;
  const failedAt = Number.isFinite(state?.failedAt) ? state.failedAt : null;
  if (state?.loading) {
    return { tone: "info", text: "取得中…" };
  }
  if (failedAt !== null && (fetchedAt === null || failedAt >= fetchedAt)) {
    const last = fetchedAt === null ? "成功した取得はまだありません" : `最後に成功した取得: ${formatTime(fetchedAt, locale)}`;
    return { tone: "error", text: `取得に失敗しました（${formatTime(failedAt, locale)}）。表示中の状態は最新ではありません。${last}` };
  }
  if (fetchedAt !== null) {
    return { tone: "ok", text: `最終取得: ${formatTime(fetchedAt, locale)}` };
  }
  return { tone: "info", text: "まだ取得していません" };
}
