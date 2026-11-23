// Minimal Chrome DevTools Protocol client over --remote-debugging-pipe.
// The pipe transport keeps CDP off every TCP port: only the DevMoter process
// that spawned Chromium holds the file descriptors, so agents and other local
// processes cannot attach to the browser directly.

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_OUTGOING_BYTES = 1024 * 1024;
const MAX_PENDING = 256;

export class CdpError extends Error {
  constructor(message, { code = "cdp_error", statusCode = 502, method = null } = {}) {
    super(message);
    this.name = "CdpError";
    this.code = code;
    this.statusCode = statusCode;
    this.method = method;
  }
}

/**
 * Creates a CDP connection over a NUL-delimited JSON pipe pair (Chromium's
 * --remote-debugging-pipe: the browser reads fd 3 and writes fd 4).
 */
export function createCdpPipeConnection({
  writable,
  readable,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
  maxOutgoingBytes = DEFAULT_MAX_OUTGOING_BYTES
}) {
  if (!writable || typeof writable.write !== "function" || !readable || typeof readable.on !== "function") {
    throw new Error("CDP pipe connection requires readable and writable streams");
  }
  let nextId = 1;
  let closed = false;
  let closeReason = null;
  let buffered = [];
  let bufferedBytes = 0;
  const pending = new Map();
  const listeners = new Map();
  const closeListeners = new Set();

  function emit(method, params, sessionId) {
    const handlers = listeners.get(method);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try { handler(params || {}, sessionId || null); } catch { /* Event handlers must not break the reader. */ }
    }
  }

  function close(reason = "closed") {
    if (closed) return;
    closed = true;
    closeReason = reason;
    buffered = [];
    bufferedBytes = 0;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new CdpError("CDP connection closed: " + reason, { code: "cdp_closed", method: entry.method }));
    }
    pending.clear();
    readable.off?.("data", onData);
    readable.off?.("end", onEnd);
    for (const handler of [...closeListeners]) {
      try { handler(reason); } catch { /* Close handlers are best-effort. */ }
    }
    closeListeners.clear();
  }

  function dispatch(text) {
    let message;
    try { message = JSON.parse(text); } catch {
      close("invalid_message");
      return;
    }
    if (!message || typeof message !== "object") return;
    if (Number.isSafeInteger(message.id)) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new CdpError(String(message.error.message || "CDP command failed").slice(0, 500), {
          code: "cdp_command_failed",
          method: entry.method
        }));
      } else {
        entry.resolve(message.result || {});
      }
      return;
    }
    if (typeof message.method === "string") emit(message.method, message.params, message.sessionId);
  }

  function onData(chunk) {
    if (closed) return;
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    let start = 0;
    let index;
    while ((index = data.indexOf(0, start)) !== -1) {
      const part = data.subarray(start, index);
      if (bufferedBytes + part.length > maxMessageBytes) {
        close("message_too_large");
        return;
      }
      buffered.push(part);
      const text = Buffer.concat(buffered).toString("utf8");
      buffered = [];
      bufferedBytes = 0;
      dispatch(text);
      if (closed) return;
      start = index + 1;
    }
    if (start < data.length) {
      const rest = data.subarray(start);
      bufferedBytes += rest.length;
      if (bufferedBytes > maxMessageBytes) {
        close("message_too_large");
        return;
      }
      buffered.push(rest);
    }
  }
  function onEnd() { close("pipe_ended"); }
  function onError() { close("pipe_error"); }

  readable.on("data", onData);
  readable.once?.("end", onEnd);
  // Error listeners stay attached after close: a pipe that errors later
  // (EPIPE/ECONNRESET when Chromium exits) must not crash the server.
  readable.on?.("error", onError);
  writable.on?.("error", onError);

  function send(method, params = {}, { sessionId = null, timeout = timeoutMs } = {}) {
    if (closed) return Promise.reject(new CdpError("CDP connection closed: " + closeReason, { code: "cdp_closed", method }));
    if (typeof method !== "string" || !/^[A-Z][A-Za-z]+\.[a-zA-Z]+$/.test(method)) {
      return Promise.reject(new CdpError("Invalid CDP method", { code: "cdp_invalid_method", statusCode: 500, method }));
    }
    if (pending.size >= MAX_PENDING) {
      return Promise.reject(new CdpError("Too many pending CDP commands", { code: "cdp_backpressure", statusCode: 503, method }));
    }
    const id = nextId++;
    const message = { id, method, params: params || {} };
    if (sessionId) message.sessionId = sessionId;
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload, "utf8") > maxOutgoingBytes) {
      return Promise.reject(new CdpError("CDP command too large", { code: "cdp_message_too_large", statusCode: 413, method }));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new CdpError("CDP command timed out: " + method, { code: "cdp_timeout", statusCode: 504, method }));
      }, timeout);
      pending.set(id, { resolve, reject, timer, method });
      try {
        writable.write(payload + "\0");
      } catch {
        pending.delete(id);
        clearTimeout(timer);
        close("write_failed");
        reject(new CdpError("CDP write failed", { code: "cdp_closed", method }));
      }
    });
  }

  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
    return () => listeners.get(method)?.delete(handler);
  }

  function onClose(handler) {
    if (closed) {
      queueMicrotask(() => handler(closeReason));
      return () => {};
    }
    closeListeners.add(handler);
    return () => closeListeners.delete(handler);
  }

  return {
    send,
    on,
    onClose,
    close,
    get closed() { return closed; },
    get pendingCount() { return pending.size; }
  };
}
