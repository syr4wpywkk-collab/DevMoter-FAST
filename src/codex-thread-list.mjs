export function normalizeCodexThreadList(result) {
  if (!result || !Array.isArray(result.data)) {
    throw new Error("Codex returned an invalid conversation list");
  }
  const threads = result.data.filter(thread =>
    thread && typeof thread.id === "string" && thread.id.length > 0
  );
  if (result.data.length > 0 && threads.length === 0) {
    throw new Error("Codex returned an invalid conversation list");
  }

  const ids = new Set();
  for (const thread of threads) {
    if (ids.has(thread.id)) throw new Error("Codex returned duplicate conversation identities");
    ids.add(thread.id);
  }
  return threads;
}
