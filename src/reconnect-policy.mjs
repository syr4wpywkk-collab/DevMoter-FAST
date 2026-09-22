export const DEFAULT_RECONNECT_BASE_MS = 1000;
export const DEFAULT_RECONNECT_MAX_MS = 15000;

export function reconnectDelay(
  attempt,
  { baseMs = DEFAULT_RECONNECT_BASE_MS, maxMs = DEFAULT_RECONNECT_MAX_MS } = {}
) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const safeBase = Number.isFinite(baseMs) ? Math.max(1, Math.floor(baseMs)) : DEFAULT_RECONNECT_BASE_MS;
  const safeMax = Number.isFinite(maxMs) ? Math.max(safeBase, Math.floor(maxMs)) : DEFAULT_RECONNECT_MAX_MS;
  return Math.min(safeBase * 2 ** safeAttempt, safeMax);
}

export function shouldScheduleReconnect(online, hasTimer) {
  return Boolean(online) && !Boolean(hasTimer);
}

export function shouldOpenEventSource(online, hasSource) {
  return Boolean(online) && !Boolean(hasSource);
}
