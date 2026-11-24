import { degrees, PDFDocument } from "pdf-lib";
import { loadPdf, createPdf, savePdf } from "./internal/io.js";

export interface PageRange {
  /** 1-based, inclusive */
  from: number;
  /** 1-based, inclusive */
  to: number;
}

export interface PageInfo {
  pageCount: number;
  pages: { width: number; height: number; rotation: number }[];
}

function assertNonEmpty(data: Uint8Array, what = "input PDF"): void {
  if (!data || data.length === 0) {
    throw new Error(`${what} is empty`);
  }
}

function assertPageIndex(page: number, pageCount: number): void {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new Error(
      `Page number ${page} is out of range (document has ${pageCount} page(s))`,
    );
  }
}

function assertUnique(pages: number[]): void {
  const seen = new Set<number>();
  for (const p of pages) {
    if (seen.has(p)) {
      throw new Error(`Duplicate page number ${p} in page list`);
    }
    seen.add(p);
  }
}

/** Merge multiple PDFs into a single document, in order. */
export async function mergePdfs(inputs: Uint8Array[]): Promise<Uint8Array> {
  if (!inputs || inputs.length === 0) {
    throw new Error("mergePdfs requires at least one input PDF");
  }
  const merged = await createPdf();
  for (let i = 0; i < inputs.length; i++) {
    assertNonEmpty(inputs[i], `input PDF at index ${i}`);
    const src = await loadPdf(inputs[i]);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return savePdf(merged);
}

/**
 * Split a PDF into multiple documents by 1-based inclusive page ranges.
 * Ranges may overlap and appear in any order; each range produces one output PDF.
 */
export async function splitPdf(
  data: Uint8Array,
  ranges: PageRange[],
): Promise<Uint8Array[]> {
  assertNonEmpty(data);
  if (!ranges || ranges.length === 0) {
    throw new Error("splitPdf requires at least one page range");
  }
  const src = await loadPdf(data);
  const pageCount = src.getPageCount();
  const results: Uint8Array[] = [];
  for (const range of ranges) {
    if (
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 1 ||
      range.to > pageCount ||
      range.from > range.to
    ) {
      throw new Error(
        `Invalid range {from: ${range.from}, to: ${range.to}} for a document with ${pageCount} page(s)`,
      );
    }
    const out = await createPdf();
    const indices: number[] = [];
    for (let p = range.from; p <= range.to; p++) indices.push(p - 1);
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    results.push(await savePdf(out));
  }
  return results;
}

/** Extract the given 1-based pages into a new PDF, preserving the given order. */
export async function extractPages(
  data: Uint8Array,
  pages: number[],
): Promise<Uint8Array> {
  assertNonEmpty(data);
  if (!pages || pages.length === 0) {
    throw new Error("extractPages requires a non-empty page list");
  }
  const src = await loadPdf(data);
  const pageCount = src.getPageCount();
  for (const p of pages) assertPageIndex(p, pageCount);
  assertUnique(pages);
  const out = await createPdf();
  const copied = await out.copyPages(src, pages.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return savePdf(out);
}

/**
 * Rotate pages clockwise by the given angle, relative to their current
 * rotation. `pages` is a list of 1-based page numbers or "all".
 * Returns the modified document as bytes.
 */
export async function rotatePages(
  data: Uint8Array,
  pages: number[] | "all",
  degrees_: 90 | 180 | 270,
): Promise<Uint8Array> {
  assertNonEmpty(data);
  if (degrees_ !== 90 && degrees_ !== 180 && degrees_ !== 270) {
    throw new Error(`Rotation must be 90, 180 or 270 degrees, got ${degrees_}`);
  }
  const doc = await loadPdf(data);
  const pageCount = doc.getPageCount();
  const targets = pages === "all" ? range1(pageCount) : pages;
  if (targets.length === 0) {
    throw new Error("rotatePages requires a non-empty page list");
  }
  assertUnique(targets);
  for (const p of targets) {
    assertPageIndex(p, pageCount);
    const page = doc.getPage(p - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + degrees_) % 360));
  }
  return savePdf(doc);
}

/**
 * Reorder pages. `order` must be a permutation of 1..pageCount (1-based):
 * order[i] is the original page number that becomes page i+1 in the output.
 */
export async function reorderPages(
  data: Uint8Array,
  order: number[],
): Promise<Uint8Array> {
  assertNonEmpty(data);
  const src = await loadPdf(data);
  const pageCount = src.getPageCount();
  if (!order || order.length !== pageCount) {
    throw new Error(
      `order must contain exactly ${pageCount} entries (a permutation of 1..${pageCount})`,
    );
  }
  const sorted = [...order].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      throw new Error(
        `order is not a valid permutation of 1..${pageCount} (got [${order.join(", ")}])`,
      );
    }
  }
  const out = await createPdf();
  const copied = await out.copyPages(src, order.map((p) => p - 1));
  for (const page of copied) out.addPage(page);
  return savePdf(out);
}

/** Delete the given 1-based pages. The remaining pages keep their order. */
export async function deletePages(
  data: Uint8Array,
  pages: number[],
): Promise<Uint8Array> {
  assertNonEmpty(data);
  if (!pages || pages.length === 0) {
    throw new Error("deletePages requires a non-empty page list");
  }
  const doc = await loadPdf(data);
  const pageCount = doc.getPageCount();
  assertUnique(pages);
  for (const p of pages) assertPageIndex(p, pageCount);
  for (const p of [...pages].sort((a, b) => b - a)) {
    doc.removePage(p - 1);
  }
  return savePdf(doc);
}

/** Return the page count and each page's width, height and rotation angle. */
export async function getPageInfo(data: Uint8Array): Promise<PageInfo> {
  assertNonEmpty(data);
  const doc = await loadPdf(data);
  const pages = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height, rotation: page.getRotation().angle };
  });
  return { pageCount: doc.getPageCount(), pages };
}

function range1(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}
