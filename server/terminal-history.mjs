export function createTerminalHistory({ maxEntries = 400, maxBytes = 512 * 1024 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be a positive integer");
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error("maxBytes must be at least 1024");

  const sessions = new Map();

  function ensure(id) {
    const key = String(id || "").trim();
    if (!key) throw new Error("terminal id is required");
    if (!sessions.has(key)) {
      sessions.set(key, {
        entries: [],
        bytes: 0,
        truncated: false,
        sequence: 0,
        listeners: new Set()
      });
    }
    return sessions.get(key);
  }

  function fitText(value) {
    const buffer = Buffer.from(String(value ?? ""), "utf8");
    if (buffer.byteLength <= maxBytes) return buffer.toString("utf8");
    return buffer.subarray(buffer.byteLength - maxBytes).toString("utf8");
  }

  function append(id, value) {
    const session = ensure(id);
    const text = fitText(value);
    const entry = {
      sequence: ++session.sequence,
      text,
      timestamp: Date.now()
    };
    const bytes = Buffer.byteLength(text, "utf8");

    session.entries.push(entry);
    session.bytes += bytes;

    while (session.entries.length > maxEntries || session.bytes > maxBytes) {
      const removed = session.entries.shift();
      if (!removed) break;
      session.bytes -= Buffer.byteLength(removed.text, "utf8");
      session.truncated = true;
    }

    for (const listener of session.listeners) listener(entry);
    return entry;
  }

  function snapshot(id) {
    const session = ensure(id);
    return {
      entries: session.entries.map(entry => ({ ...entry })),
      truncated: session.truncated,
      maxEntries,
      maxBytes,
      latestSequence: session.sequence
    };
  }

  function subscribe(id, listener) {
    if (typeof listener !== "function") throw new Error("listener must be a function");
    const session = ensure(id);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  function clear(id) {
    sessions.delete(String(id || "").trim());
  }

  return { append, snapshot, subscribe, clear };
}
