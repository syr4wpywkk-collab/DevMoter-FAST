export function normalizeCodexThreadHistory(result) {
  const thread = result?.thread;
  if (!thread || typeof thread !== "object" || !Array.isArray(thread.turns)) {
    throw new Error("Codex returned an invalid conversation history");
  }

  for (const turn of thread.turns) {
    if (!turn || typeof turn !== "object" || (turn.items !== undefined && !Array.isArray(turn.items))) {
      throw new Error("Codex returned an invalid conversation history");
    }
  }

  return thread;
}
