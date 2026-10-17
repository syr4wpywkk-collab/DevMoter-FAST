export function normalizeCodexThreadList(result) {
  if (!result || !Array.isArray(result.data)) {
    throw new Error("Codex returned an invalid conversation list");
  }
  return result.data.filter(thread =>
    thread && typeof thread.id === "string" && thread.id.length > 0
  );
}
