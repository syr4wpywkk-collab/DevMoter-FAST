export function latestAssistantText(entries: Iterable<string | null | undefined> | null | undefined): string;
export function createHistoryRetryNotice(doc: Document, options: {
  className: string;
  message: string;
  retryLabel: string;
  onRetry: () => unknown | Promise<unknown>;
}): HTMLDivElement;
