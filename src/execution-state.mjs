export const TERMINAL_EXECUTION_STATES = new Set([
  "completed",
  "failed",
  "interrupted"
]);

export function isExecutionActive(state) {
  return (
    state === "running" ||
    state === "waiting_for_approval" ||
    state === "waiting_for_input"
  );
}

export function isExecutionTerminal(state) {
  return TERMINAL_EXECUTION_STATES.has(state);
}

export function codexTurnStatusToExecutionState(status) {
  switch (String(status || "").toLowerCase()) {
    case "completed":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "failed":
      return "failed";
    case "inprogress":
    case "in_progress":
    case "in-progress":
      return "running";
    default:
      return "completed";
  }
}

export function codexThreadStatusToExecutionState(status) {
  if (!status || typeof status !== "object") return "idle";

  const value = status;
  const type = String(value.type || "").toLowerCase();

  if (type === "systemerror" || type === "system_error" || type === "system-error") {
    return "failed";
  }

  if (type !== "active") return "idle";

  const rawFlags = Array.isArray(value.activeFlags)
    ? value.activeFlags
    : Array.isArray(value.active_flags)
      ? value.active_flags
      : [];
  const flags = rawFlags.map(flag => String(flag).toLowerCase());

  if (flags.some(flag =>
    flag === "waitingonapproval" ||
    flag === "waiting_on_approval" ||
    flag === "waiting-on-approval"
  )) {
    return "waiting_for_approval";
  }

  if (flags.some(flag =>
    flag === "waitingonuserinput" ||
    flag === "waiting_on_user_input" ||
    flag === "waiting-on-user-input"
  )) {
    return "waiting_for_input";
  }

  return "running";
}

export function openCodeIdleOutcomeToExecutionState(outcome) {
  switch (String(outcome || "").toLowerCase()) {
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "idle";
  }
}
