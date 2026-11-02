// Decide whether the latest OpenCode turn in a persisted context has finished.
// An `idle` item only belongs to the current turn when no user prompt follows
// it; otherwise it is the previous turn's idle and must not end the new run.
export function latestTurnIdle(list) {
  const items = Array.isArray(list) ? list : [];
  for (let index = items.length - 1; index >= 0; index--) {
    const type = items[index]?.type;
    if (type === "idle") return items[index];
    if (type === "user") return null;
  }
  return null;
}

// While a sent prompt has not produced its idle yet, the session may simply
// not show as busy (prompt_async admitted, slow free model). Keep the run
// alive so the polling fallback keeps reconciling until the reply lands.
export function shouldKeepAwaitingReply({ awaitingUntil, now, turnIdle, busy }) {
  if (busy) return true;
  if (turnIdle) return false;
  return Number.isFinite(awaitingUntil) && now < awaitingUntil;
}
