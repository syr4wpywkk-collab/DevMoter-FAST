export interface KnowledgeNote {
  id: string;
  title: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  content: string;
}
export type MarkdownImport =
  | { ok: true; title: string; content: string }
  | { ok: false; reason: "tooLarge" | "notUtf8" | "notText" };
export const MAX_IMPORT_BYTES: number;
export const MAX_TITLE_LENGTH: number;
export function normalizeNote(raw: unknown): KnowledgeNote;
export function sortNotes(notes: KnowledgeNote[]): KnowledgeNote[];
export function filterNotes(notes: KnowledgeNote[], filter?: { query?: string; projectId?: string }): KnowledgeNote[];
export function cleanTitle(value: unknown, fallback?: string): string;
export function duplicateTitle(title: string, suffix: string): string;
export function exportFileName(title: string, fallback?: string): string;
export function exportMarkdown(note: { title: string; content: string }): string;
export function decodeMarkdownFile(bytes: Uint8Array, fileName?: string): MarkdownImport;
