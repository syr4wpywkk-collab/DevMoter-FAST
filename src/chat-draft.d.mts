export type ChatDraftProvider = "codex" | "opencode" | "api-chat";
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const CHAT_DRAFT_PREFIX: string;
export const CHAT_DRAFT_MAX_CHARS: number;
export const CHAT_DRAFT_PROVIDERS: readonly ChatDraftProvider[];
export function chatDraftKey(provider: ChatDraftProvider, projectId: string | null | undefined): string;
export function readChatDraft(storage: DraftStorage | null | undefined, provider: ChatDraftProvider, projectId: string | null | undefined): string;
export function writeChatDraft(storage: DraftStorage | null | undefined, provider: ChatDraftProvider, projectId: string | null | undefined, text: string): boolean;
export function createChatDraftBinding<Extras = unknown>(options: {
  provider: ChatDraftProvider;
  input: HTMLTextAreaElement;
  storage: DraftStorage | null | undefined;
  getProjectId: () => string | null | undefined;
  takeExtras?: () => Extras;
  restoreExtras?: (extras: Extras | undefined) => void;
  onRestore?: () => void;
}): {
  /** Stores the input's current text for the bound project. */
  capture(): void;
  /** Swaps drafts when the active project changed. True when a swap happened. */
  sync(): boolean;
};
