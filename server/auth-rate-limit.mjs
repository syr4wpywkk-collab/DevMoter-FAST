const DEFAULT_WINDOW_MS = 10 * 60_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_MAX_CLIENTS = 4096;

function clientKey(req) {
  const address = req?.socket?.remoteAddress;
  return typeof address === "string" && address ? address.slice(0, 128) : "unknown";
}

export function createAuthFailureLimiter({
  maxFailures = DEFAULT_MAX_FAILURES,
  windowMs = DEFAULT_WINDOW_MS,
  maxClients = DEFAULT_MAX_CLIENTS,
  now = Date.now
} = {}) {
  const failures = new Map();

  function recentFailures(key, currentTime = now()) {
    const cutoff = currentTime - windowMs;
    const recent = (failures.get(key) || []).filter(timestamp => timestamp > cutoff);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
    return recent;
  }

  function prune(currentTime) {
    const cutoff = currentTime - windowMs;
    for (const [key, timestamps] of [...failures]) {
      const recent = timestamps.filter(timestamp => timestamp > cutoff);
      if (recent.length) failures.set(key, recent);
      else failures.delete(key);
    }
    while (failures.size > maxClients) {
      failures.delete(failures.keys().next().value);
    }
  }

  return {
    isBlocked(req) {
      return recentFailures(clientKey(req)).length >= maxFailures;
    },
    recordFailure(req) {
      const key = clientKey(req);
      const currentTime = now();
      const recent = recentFailures(key, currentTime);
      recent.push(currentTime);
      failures.delete(key);
      failures.set(key, recent);
      if (failures.size > maxClients) prune(currentTime);
    },
    clear(req) {
      failures.delete(clientKey(req));
    }
  };
}
