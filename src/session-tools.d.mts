export type SessionSortMode = "recent" | "created" | "messages";

export function sortSessions<T extends { id?: string; time?: { created?: number; updated?: number }; messageCount?: number; messagesCount?: number; message_count?: number }>(
  sessions: T[],
  mode?: SessionSortMode,
  counts?: Map<string, number> | Record<string, number>
): T[];

export function redactSensitiveText(value: unknown): string;
export function countTranscriptMessages(context: unknown[]): number;
export function sessionContextToMarkdown(session: any, context: any[], options?: { maxToolChars?: number }): string;

export type ImportedThread = {
  id: string;
  title: string;
  origin: string;
  importedAt: number;
  messages: Array<{ role: string; text: string }>;
  unsupported: string[];
};

export function normalizeExternalThread(input: any): ImportedThread;
