/** Render untrusted Markdown without using the rendered DOM as message state. */
export function renderChatMarkdown(
  target: HTMLElement,
  rawText: string,
  onCopy: (text: string) => void
): void;
