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
