export type OrchestrationChildState = "planned" | "approved" | "running" | "done" | "failed" | "cancelled";
export type OrchestrationChild = { id: string; title: string; owner: string; state: OrchestrationChildState; index: number };
export type OrchestrationPlan = { id: string; task: string; state: "awaiting_approval" | "approved"; requiresDelegationApproval: true; children: OrchestrationChild[] };
export function decomposeTask(task: string, options?: { maxChildren?: number }): string[];
export function createOrchestrationPlan(task: string, options?: { id?: string; maxChildren?: number }): OrchestrationPlan;
export function transitionChild(plan: OrchestrationPlan, childId: string, nextState: OrchestrationChildState, owner?: string): OrchestrationChild;
export function approveOrchestrationPlan(plan: OrchestrationPlan): OrchestrationPlan;
export function renderOrchestrationPrompt(plan: OrchestrationPlan): string;
