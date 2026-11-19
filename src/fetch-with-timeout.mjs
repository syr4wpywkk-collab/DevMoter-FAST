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

// The deadline also covers the body: it is read before this resolves, so a body
// that stalls after the headers rejects here, where callers report it, instead
// of inside a json() call that a caller may treat as "no data".
export async function fetchReadWithTimeout(fetcher, input, init = {}, timeoutError, timeoutMs = READ_REQUEST_TIMEOUT_MS) {
  const method = String(init.method || "GET").toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || init.signal) return fetcher(input, init);
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  deadline.catch(() => {});
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(timeoutError());
  }, timeoutMs);
  const done = () => clearTimeout(timer);
  let request;
  try {
    request = Promise.resolve(fetcher(input, { ...init, signal: controller.signal }));
  } catch (error) {
    request = Promise.reject(error);
  }
  const settle = promise => Promise.resolve(promise).then(value => ({ value }), error => ({ error }));
  const unwrap = async result => {
    if ("error" in result) throw result.error;
    return result.value;
  };
  try {
    const response = await Promise.race([request, deadline]);
    if (typeof response?.arrayBuffer === "function") {
      const bytes = await Promise.race([settle(response.arrayBuffer()), deadline]);
      const type = response.headers?.get?.("content-type") ?? "";
      response.arrayBuffer = async () => (await unwrap(bytes)).slice(0);
      response.blob = async () => new Blob([await unwrap(bytes)], { type });
      response.text = async () => new TextDecoder().decode(await unwrap(bytes));
      response.json = async () => JSON.parse(await response.text());
    } else if (typeof response?.text === "function") {
      const text = await Promise.race([settle(response.text()), deadline]);
      response.text = () => unwrap(text);
      response.json = async () => JSON.parse(await unwrap(text));
    } else if (typeof response?.json === "function") {
      const json = await Promise.race([settle(response.json()), deadline]);
      response.json = () => unwrap(json);
    }
    return response;
  } finally {
    done();
  }
}
