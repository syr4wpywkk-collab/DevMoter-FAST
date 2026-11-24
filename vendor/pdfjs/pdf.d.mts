// Minimal typings for the vendored pdfjs-dist legacy browser build
// (vendor/pdfjs/pdf.mjs). Covers only what src/office.ts uses for viewing.
export interface PDFDocumentProxy {
  numPages: number;
  getPage(n: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
}
export interface PDFPageProxy {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void>; cancel(): void };
}
export interface PDFDocumentLoadingTask {
  promise: Promise<PDFDocumentProxy>;
  destroy(): Promise<void>;
}
export function getDocument(options: {
  data: Uint8Array;
  isEvalSupported?: boolean;
}): PDFDocumentLoadingTask;
export const GlobalWorkerOptions: { workerSrc?: string };
export const version: string;
