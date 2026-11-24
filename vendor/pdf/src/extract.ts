import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// Locate the standard-font files bundled with pdfjs-dist so font metrics are
// exact (otherwise pdf.js warns and falls back to approximations).
// Under Node, pdf.js reads this "URL" via fs, so it must be a plain path.
const standardFontDataUrl =
  join(
    dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
    "standard_fonts"
  ) + "/";

/**
 * Node/vitest worker setup (pdfjs-dist v4):
 * Plain Node has no Web Worker. In the `legacy` build, PDF.js detects Node
 * (`isNodeJS`), disables the real worker and defaults `workerSrc` to
 * "./pdf.worker.mjs" next to `pdf.mjs`; it then runs the parser in-process via
 * its "fake worker" dynamic import. So no explicit `GlobalWorkerOptions`
 * configuration is needed — we just must NOT set `workerPort`/`workerSrc`.
 * The `legacy` build is required: the modern build needs DOM APIs Node lacks.
 */

export interface ExtractedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
}

export interface ExtractedPage {
  page: number;
  text: string;
  items: ExtractedItem[];
}

export interface ExtractResult {
  pageCount: number;
  metadata?: { title?: string; author?: string };
  pages: ExtractedPage[];
}

/**
 * Line-joining heuristic: items are already returned by pdf.js roughly in
 * content order. Items whose `y` coordinates differ by less than `Y_TOLERANCE`
 * (a fraction of the item height, since transformed y varies with font size)
 * are treated as the same line and joined with a single space. A larger jump
 * starts a new line, joined with "\n".
 */
const Y_TOLERANCE_RATIO = 0.5;

function joinItems(items: ExtractedItem[]): string {
  let text = "";
  let lastY: number | undefined;
  let lastH = 0;
  for (const it of items) {
    if (it.str.length === 0) continue;
    const tol = Math.max(lastH, it.height) * Y_TOLERANCE_RATIO;
    if (lastY === undefined) {
      text += it.str;
    } else if (Math.abs(it.y - lastY) <= tol) {
      text += (text.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str;
    } else {
      text += "\n" + it.str;
    }
    lastY = it.y;
    lastH = it.height;
  }
  return text;
}

export async function extractText(data: Uint8Array): Promise<ExtractResult> {
  const doc = await getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl,
    // Avoids requiring system font/canvas packages under Node.
    disableFontFace: true,
  }).promise;

  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    const metadata =
      info.Title !== undefined || info.Author !== undefined
        ? { title: info.Title, author: info.Author }
        : undefined;

    const pages: ExtractedPage[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: ExtractedItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue; // skip marked-content items
        const it = raw as TextItem;
        // transform = [scaleX, skewY, skewX, scaleY, x, y] in user space.
        const x = it.transform[4];
        const y = it.transform[5];
        items.push({
          str: it.str,
          x,
          y,
          width: it.width,
          height: it.height,
          fontName: it.fontName,
        });
      }
      pages.push({ page: p, text: joinItems(items), items });
    }

    return { pageCount: doc.numPages, metadata, pages };
  } finally {
    await doc.destroy();
  }
}
