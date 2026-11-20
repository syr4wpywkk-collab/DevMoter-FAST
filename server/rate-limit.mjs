/**
 * Fixed-window request limiter with a per-key and a global budget. Memory is
 * bounded: once `maxKeys` distinct keys are tracked in a window, new keys are
 * refused until the window rolls over.
 */
export function createFixedWindowLimiter({ windowMs, perKey, global, maxKeys = 2048, now = Date.now }) {
  let windowStart = now();
  let total = 0;
  const counts = new Map();

  return function take(key) {
    const current = now();
    if (current - windowStart >= windowMs) {
      windowStart = current;
      total = 0;
      counts.clear();
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - current) / 1000));
    const used = counts.get(key) || 0;
    if (total >= global || used >= perKey || (used === 0 && counts.size >= maxKeys)) {
      return { ok: false, retryAfterSeconds };
    }
    counts.set(key, used + 1);
    total += 1;
    return { ok: true, retryAfterSeconds: 0 };
  };
}
