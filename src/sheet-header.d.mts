export interface SheetHeaderPrimary { label: string; onClick: () => void }
export interface SheetHeaderOptions {
  title: string;
  subtitle?: string;
  titleId?: string;
  closeLabel?: string;
  onClose?: () => void;
  primary?: SheetHeaderPrimary | null;
}
export interface SheetHeader {
  element: HTMLElement;
  titleEl: HTMLHeadingElement;
  subtitleEl: HTMLParagraphElement;
  actions: HTMLDivElement;
  primaryButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  setTitle(text: string): void;
  setSubtitle(text: string): void;
  setPrimary(next: SheetHeaderPrimary | null): void;
}
export function createSheetHeader(doc: Document, options: SheetHeaderOptions): SheetHeader;
