export function createOperationRegistry({ ttlMs = 10 * 60 * 1000, maxEntries = 1000 } = {}) {
  const entries = new Map();

  function prune(now) {
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= now) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    claim(scope, id, now = Date.now()) {
      if (!id) return true;
      prune(now);
      const key = `${scope}:${id}`;
      if (entries.has(key)) return false;
      entries.set(key, now + ttlMs);
      prune(now);
      return true;
    },
    size() {
      return entries.size;
    }
  };
}
