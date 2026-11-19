export function fetchWithTimeout(fetcher, input, init, timeoutMs, timeoutError) {
  const controller = new AbortController();
  let rejectTimeout;
  const timeout = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectTimeout(timeoutError());
  }, timeoutMs);

  let request;
  try {
    request = Promise.resolve(fetcher(input, { ...init, signal: controller.signal }));
  } catch (error) {
    request = Promise.reject(error);
  }
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

// Reads have no side effects, so a hung GET/HEAD is cut off instead of leaving
// the screen loading forever. Writes and caller-managed requests (own signal)
// are passed through: they may legitimately run long and are not safe to cut.
export const READ_REQUEST_TIMEOUT_MS = 30_000;

export function fetchReadWithTimeout(fetcher, input, init = {}, timeoutError, timeoutMs = READ_REQUEST_TIMEOUT_MS) {
  const method = String(init.method || "GET").toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || init.signal) return fetcher(input, init);
  return fetchWithTimeout(fetcher, input, init, timeoutMs, timeoutError);
}
