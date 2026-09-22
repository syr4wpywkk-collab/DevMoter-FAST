const CHILD_STATES = new Set(["planned", "approved", "running", "done", "failed", "cancelled"]);

function cleanChunks(task) {
  const text = String(task || "").trim();
  if (!text) throw new Error("Task is required");
  const lineChunks = text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (lineChunks.length > 1) return lineChunks;
  const sentenceChunks = text.split(/(?<=[.!?。！？])\s+/).map(value => value.trim()).filter(Boolean);
  if (sentenceChunks.length > 1) return sentenceChunks;
  return [
    `Inspect current state, constraints, and evidence for: ${text}`,
    `Implement the smallest bounded change for: ${text}`,
    `Validate tests, regressions, and risks for: ${text}`
  ];
}

export function decomposeTask(task, { maxChildren = 6 } = {}) {
  const limit = Math.max(1, Math.min(12, Number(maxChildren) || 6));
  const chunks = cleanChunks(task);
  if (chunks.length <= limit) return chunks;
  if (limit === 1) {
    return [`Approved requirements: ${chunks.join(" | ")}`];
  }
  return [
    ...chunks.slice(0, limit - 1),
    `Remaining approved requirements: ${chunks.slice(limit - 1).join(" | ")}`
  ];
}

export function createOrchestrationPlan(task, options = {}) {
  const children = decomposeTask(task, options);
  const roles = ["planner", "executor", "reviewer"];
  return {
    id: options.id || `plan-${Date.now().toString(36)}`,
    task: String(task).trim(),
    state: "awaiting_approval",
    requiresDelegationApproval: true,
    children: children.map((title, index) => ({
      id: `child-${index + 1}`,
      title,
      owner: roles[Math.min(index, roles.length - 1)],
      state: "planned",
      index
    }))
  };
}

export function transitionChild(plan, childId, nextState, owner) {
  if (!CHILD_STATES.has(nextState)) throw new Error(`Unknown child state: ${nextState}`);
  const child = plan?.children?.find(item => item.id === childId);
  if (!child) throw new Error(`Unknown child task: ${childId}`);
  const allowed = {
    planned: ["approved", "cancelled"],
    approved: ["running", "cancelled"],
    running: ["done", "failed", "cancelled"],
    done: [],
    failed: [],
    cancelled: []
  };
  if (!allowed[child.state]?.includes(nextState)) {
    throw new Error(`Invalid child transition: ${child.state} -> ${nextState}`);
  }
  child.state = nextState;
  if (owner) child.owner = String(owner);
  return child;
}

export function approveOrchestrationPlan(plan) {
  if (!plan || plan.state !== "awaiting_approval") throw new Error("Plan is not awaiting approval");
  plan.state = "approved";
  for (const child of plan.children) {
    if (child.state === "planned") child.state = "approved";
  }
  return plan;
}

export function renderOrchestrationPrompt(plan) {
  if (!plan || plan.state !== "approved") {
    throw new Error("Orchestration plan must be explicitly approved before execution");
  }
  const rows = plan.children.map(child =>
    `- [${child.state}] ${child.id} · owner=${child.owner}: ${child.title}`
  );
  return [
    "[DevMoter mode: Orchestrator]",
    "Execute this approved decomposition. Keep each child task bounded and report state changes.",
    "Do not silently create additional paid/costly agents. Any extra delegation beyond this approved plan requires explicit user approval.",
    "All commands and file mutations must continue through the normal backend approval/diff flow.",
    `Parent task: ${plan.task}`,
    "Approved child tasks:",
    ...rows
  ].join("\n");
}
