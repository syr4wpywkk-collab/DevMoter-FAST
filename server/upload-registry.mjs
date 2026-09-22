import { randomUUID } from "node:crypto";

export function createUploadRegistry({ ttlMs = 60 * 60 * 1000, maxEntries = 500 } = {}) {
  const entries = new Map();

  function sweep(now = Date.now()) {
    for (const [id, entry] of entries) {
      if (now - entry.createdAt > ttlMs) entries.delete(id);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (!oldest) break;
      entries.delete(oldest);
    }
  }

  return {
    add(metadata) {
      sweep();
      const id = randomUUID();
      entries.set(id, {
        ...metadata,
        createdAt: Date.now()
      });
      sweep();
      return id;
    },

    get(id) {
      sweep();
      const entry = entries.get(String(id || ""));
      if (!entry) throw new Error("Attachment is unavailable or expired");
      return { ...entry };
    },

    remove(id) {
      entries.delete(String(id || ""));
    }
  };
}
