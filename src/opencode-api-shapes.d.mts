export type OpenCodeApiGeneration = "v1" | "v2";

export const OPENCODE_API_V1: "v1";
export const OPENCODE_API_V2: "v2";

export type OpenCodeRequestSpec = {
  method: "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
};

export type OpenCodeQuestionInfo = {
  header: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiple: boolean;
  custom: boolean;
};

export type OpenCodePendingQuestion = {
  id: string;
  sessionID: string;
  questions: OpenCodeQuestionInfo[];
  fields?: Array<{ key: string; type: string }>;
};

export function openCodeGenerationFromVersion(version: unknown): OpenCodeApiGeneration;
export function assertOpenCodeGeneration(generation: unknown): OpenCodeApiGeneration;

export function buildOpenCodePromptBody(
  generation: OpenCodeApiGeneration,
  input: { text: string; delivery?: "steer" | "queue" }
): Record<string, unknown>;
export function openCodePromptText(generation: OpenCodeApiGeneration, body: unknown): string | null;
export function withOpenCodePromptText<T extends Record<string, unknown>>(
  generation: OpenCodeApiGeneration,
  body: T,
  text: string
): T;

export function buildOpenCodePermissionReply(
  generation: OpenCodeApiGeneration,
  request: { id: string; sessionID: string },
  decision: "once" | "always" | "reject",
  message?: string
): OpenCodeRequestSpec;
export function openCodePermissionDecision(
  generation: OpenCodeApiGeneration,
  body: unknown
): "once" | "always" | "reject" | null;
export function openCodePermissionListPath(sessionID: string): string;

export function openCodeQuestionListPath(generation: OpenCodeApiGeneration, sessionID: string): string;
export function normalizeOpenCodeQuestions(
  generation: OpenCodeApiGeneration,
  payload: unknown
): OpenCodePendingQuestion[];
export type OpenCodeQuestionRef = {
  id: string;
  sessionID: string;
  fields?: Array<{ key: string; type: string }>;
};

export function buildOpenCodeQuestionReply(
  generation: OpenCodeApiGeneration,
  request: OpenCodeQuestionRef,
  answers: string[][]
): OpenCodeRequestSpec;
export function buildOpenCodeQuestionReject(
  generation: OpenCodeApiGeneration,
  request: OpenCodeQuestionRef
): OpenCodeRequestSpec;
