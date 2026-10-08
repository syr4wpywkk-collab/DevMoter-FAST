import type { ExecutionState } from "../execution-state.mjs";

export function openCodeStateLabel(state: ExecutionState) {
  switch (state) {
    case "running": return "running";
    case "waiting_for_approval": return "approval";
    case "waiting_for_input": return "question";
    case "completed": return "done";
    case "failed": return "failed";
    case "interrupted": return "stopped";
    case "offline": return "offline";
    case "reconnecting": return "syncing";
    default: return "idle";
  }
}

export function openCodeStateGlyph(state: ExecutionState) {
  switch (state) {
    case "running": return "●";
    case "waiting_for_approval": return "!";
    case "waiting_for_input": return "?";
    case "completed": return "✓";
    case "failed": return "×";
    case "interrupted": return "■";
    case "offline": return "○";
    case "reconnecting": return "↻";
    default: return "·";
  }
}
