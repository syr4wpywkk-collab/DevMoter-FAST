// ACP runner adapter — STUB (v1).
//
// Future mapping plan: `devin acp` speaks JSON-RPC 2.0 over stdio
// (Agent Client Protocol). The intended implementation is:
//   1. spawn `devin acp` (shell:false, cwd = task worktree) and perform the
//      ACP `initialize` handshake, advertising the harness's capabilities.
//   2. `session/new` with the task worktree as cwd and the generated
//      --config-equivalent permission state applied via session modes.
//   3. `session/prompt` streaming: forward `session/update` notifications
//      (agent_message_chunk / tool_call / plan) into the run log, answer
//      `session/request_permission` from the EffectivePolicy instead of a
//      human, and honour the same timeout/kill discipline as the print
//      runner.
//   4. Map the final stop reason + session id onto RunnerOutcome, and rely on
//      the same ATIF --export artefact for usage accounting.
// Until that lands, the print runner (pool/runner.ts) is the only backend;
// this class exists so WorkerRunner call sites can already name the "acp"
// backend and fail loudly instead of silently degrading.

import type {
  RunContext,
  RunnerOutcome,
  TaskSpec,
  WorkerRunner,
} from "../types.js";

export class AcpRunner implements WorkerRunner {
  readonly name = "acp";

  async run(
    task: TaskSpec,
    ctx: RunContext,
    opts?: { resumeSessionId?: string; promptFile?: string },
  ): Promise<RunnerOutcome> {
    void task;
    void ctx;
    void opts;
    throw new Error(
      "AcpRunner is a stub: the ACP (JSON-RPC over stdio, `devin acp`) " +
        "backend is not implemented yet. Use the default print runner.",
    );
  }
}
