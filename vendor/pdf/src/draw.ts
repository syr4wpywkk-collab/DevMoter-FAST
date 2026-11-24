import fontkit from "@pdf-lib/fontkit";
import {
  degrees,
  PDFDocument,
  PDFFont,
  rgb,
  StandardFonts,
  type RGB,
} from "pdf-lib";
import { loadPdf } from "./internal/io.js";

/** RGB color with components in the 0..1 range. */
export interface Color {
  r: number;
  g: number;
  b: number;
}

const BLACK: RGB = rgb(0, 0, 0);

function toRgb(color?: Color): RGB {
  return color ? rgb(color.r, color.g, color.b) : BLACK;
}

function getPageAt(doc: PDFDocument, page: number) {
  const pages = doc.getPages();
  if (page < 0 || page >= pages.length) {
    throw new RangeError(
      `Page index ${page} out of range (document has ${pages.length} pages)`,
    );
  }
  return pages[page];
}

export interface DrawTextOptions {
  text: string;
  x: number;
  y: number;
  size?: number;
  color?: Color;
}

/**
 * Draw text using one of the 14 standard PDF fonts (Helvetica).
 *
 * Standard fonts use WinAnsiEncoding and support Latin characters only.
 * Non-Latin text (CJK, Cyrillic beyond WinAnsi, emoji, etc.) cannot be
 * encoded — use {@link embedFont} + {@link drawTextWithFont} with TTF/OTF
 * font bytes for those scripts.
 */
export async function drawText(
  data: Uint8Array,
  page: number,
  opts: DrawTextOptions,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  getPageAt(doc, page).drawText(opts.text, {
    x: opts.x,
    y: opts.y,
    size: opts.size ?? 12,
    font,
    color: toRgb(opts.color),
  });
  return doc.save();
}

/**
 * Handle for a font embedded into a document, produced by {@link embedFont}.
 * Carry `data` forward between calls; `fontBytes` are re-embedded on each
 * drawTextWithFont call (pdf-lib embeds per loaded document).
 */
export interface EmbeddedFontHandle {
  data: Uint8Array;
  fontBytes: Uint8Array;
}

/**
 * Embed a custom font (TTF/OTF) into the document. Registers fontkit so
 * pdf-lib can embed and subset the font. Returns a handle to pass to
 * {@link drawTextWithFont}.
 */
export async function embedFont(
  data: Uint8Array,
  fontBytes: Uint8Array,
): Promise<EmbeddedFontHandle> {
  const doc = await loadPdf(data);
  doc.registerFontkit(fontkit);
  await doc.embedFont(fontBytes);
  return { data: await doc.save(), fontBytes };
}

/** Draw text with a font embedded via {@link embedFont} (supports Unicode). */
export async function drawTextWithFont(
  handle: EmbeddedFontHandle,
  page: number,
  opts: DrawTextOptions,
): Promise<EmbeddedFontHandle> {
  const doc = await loadPdf(handle.data);
  doc.registerFontkit(fontkit);
  const font: PDFFont = await doc.embedFont(handle.fontBytes);
  getPageAt(doc, page).drawText(opts.text, {
    x: opts.x,
    y: opts.y,
    size: opts.size ?? 12,
    font,
    color: toRgb(opts.color),
  });
  return { data: await doc.save(), fontBytes: handle.fontBytes };
}

export interface DrawImageOptions {
  image: { data: Uint8Array; type: "png" | "jpg" };
  x: number;
  y: number;
  /** Defaults to the image's natural width. */
  width?: number;
  /** Defaults to the image's natural height. */
  height?: number;
  /** 0..1; applied via the ExtGState opacity entry written by pdf-lib. */
  opacity?: number;
}

export async function drawImage(
  data: Uint8Array,
  page: number,
  opts: DrawImageOptions,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  const embedded =
    opts.image.type === "png"
      ? await doc.embedPng(opts.image.data)
      : await doc.embedJpg(opts.image.data);
  getPageAt(doc, page).drawImage(embedded, {
    x: opts.x,
    y: opts.y,
    width: opts.width ?? embedded.width,
    height: opts.height ?? embedded.height,
    opacity: opts.opacity,
  });
  return doc.save();
}

export interface StampTextOptions {
  text: string;
  /** 0-based page indices, or "all". Defaults to "all". */
  pages?: number[] | "all";
  position: "header" | "footer" | "diagonal";
  /** 0..1 translucency; passed to pdf-lib's draw opacity (ExtGState CA/ca). */
  opacity?: number;
}

/**
 * Stamp repeated text on pages. "header" centers near the top, "footer" near
 * the bottom, "diagonal" draws rotated 45° through the page center.
 * Translucency uses pdf-lib's `opacity` option, which emits a graphics state
 * (ExtGState) — true alpha compositing, not a fake lighter color.
 *
 * Uses Helvetica (standard font → Latin-only text).
 */
export async function stampText(
  data: Uint8Array,
  opts: StampTextOptions,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = opts.position === "diagonal" ? 60 : 14;
  const opacity = opts.opacity ?? 0.5;
  const targets =
    opts.pages === undefined || opts.pages === "all"
      ? doc.getPages()
      : opts.pages.map((i) => getPageAt(doc, i));

  for (const p of targets) {
    const { width, height } = p.getSize();
    if (opts.position === "diagonal") {
      const tw = font.widthOfTextAtSize(opts.text, size);
      p.drawText(opts.text, {
        x: width / 2 - tw / 2,
        y: height / 2,
        size,
        font,
        color: rgb(0.8, 0.1, 0.1),
        opacity,
        rotate: degrees(45),
      });
    } else {
      const tw = font.widthOfTextAtSize(opts.text, size);
      p.drawText(opts.text, {
        x: width / 2 - tw / 2,
        y: opts.position === "header" ? height - 40 : 30,
        size,
        font,
        color: rgb(0.8, 0.1, 0.1),
        opacity,
      });
    }
  }
  return doc.save();
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
}

export async function getMetadata(data: Uint8Array): Promise<PdfMetadata> {
  const doc = await loadPdf(data);
  return {
    title: doc.getTitle() || undefined,
    author: doc.getAuthor() || undefined,
    subject: doc.getSubject() || undefined,
    keywords: doc.getKeywords()?.split(/\s+/).filter(Boolean),
    creator: doc.getCreator() || undefined,
  };
}

export async function setMetadata(
  data: Uint8Array,
  meta: PdfMetadata,
): Promise<Uint8Array> {
  const doc = await loadPdf(data);
  if (meta.title !== undefined) doc.setTitle(meta.title);
  if (meta.author !== undefined) doc.setAuthor(meta.author);
  if (meta.subject !== undefined) doc.setSubject(meta.subject);
  if (meta.keywords !== undefined) doc.setKeywords(meta.keywords);
  if (meta.creator !== undefined) doc.setCreator(meta.creator);
  return doc.save();
}
