export type NormalizedOpenCodeEvent = {
  type: string;
  props: any;
  sessionID: any;
  category: "other" | "part" | "tool" | "status";
  kind: string | null;
  phase: string | null;
  messageID: any;
  partID: any;
  text: string | null;
  delta: string | null;
  executionState: "running" | "completed" | "failed" | null;
};

export function normalizeOpenCodeEvent(payload: any): NormalizedOpenCodeEvent;
export function mergeOpenCodeStreamText(
  current: string | null | undefined,
  event: { text?: unknown; delta?: unknown } | null | undefined
): string;
