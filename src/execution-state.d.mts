export type ExecutionState =
  | "offline"
  | "reconnecting"
  | "idle"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "interrupted";

export declare const TERMINAL_EXECUTION_STATES: Set<ExecutionState>;
export declare function isExecutionActive(state: ExecutionState): boolean;
export declare function isExecutionTerminal(state: ExecutionState): boolean;
export declare function codexTurnStatusToExecutionState(status: unknown): ExecutionState;
export declare function codexThreadStatusToExecutionState(status: unknown): ExecutionState;
export declare function openCodeIdleOutcomeToExecutionState(outcome: unknown): ExecutionState;
