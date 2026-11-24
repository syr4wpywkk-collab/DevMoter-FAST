/**
 * Extended deck specification: extended slide kinds (shapes, twoColumn, quote),
 * speaker notes, hyperlink bullets, and slide masters.
 *
 * This module is self-contained: it does not depend on spec.ts (owned by a
 * sibling track) so it can be built and merged independently.
 */

/** A bullet/list item: plain text, or text + hyperlink. */
export interface ExtBulletItem {
  text: string;
  /** External URL; rendered as a real OOXML hyperlink relationship. */
  url?: string;
}

export type Bullet = string | ExtBulletItem;

export interface ShapeStyle {
  /** Fill color, hex without '#'. */
  color?: string;
  /** Fill transparency, 0-100 percent. */
  transparency?: number;
}

export interface LineStyle {
  color?: string;
  /** Line width in points. */
  width?: number;
  dashType?: "solid" | "dash" | "dashDot" | "lgDash" | "lgDashDot" | "lgDashDotDot" | "sysDash" | "sysDot";
}

export interface ShapeItem {
  kind: "rect" | "roundRect" | "oval" | "line";
  /** Position/size in inches (slide coords). For "line", w/h describe the box the line spans. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fill style. Ignored for "line" (lines have no fill). */
  fill?: ShapeStyle;
  /** Outline style. For "line" this is the line's own stroke. */
  line?: LineStyle;
  /** Optional centered text inside the shape (not supported for "line"). */
  text?: string;
}

/** Base fields shared by every extended slide kind. */
interface SlideBase {
  /** Speaker notes; emitted into the slide's notesSlide part. */
  notes?: string;
  /** Name of a master defined in ExtDeckSpec.masters. */
  master?: string;
}

export interface ExtTitleSlide extends SlideBase {
  kind: "title";
  title: string;
  subtitle?: string;
}

export interface ExtBulletsSlide extends SlideBase {
  kind: "bullets";
  title?: string;
  bullets: Bullet[];
}

export interface ShapesSlide extends SlideBase {
  kind: "shapes";
  title?: string;
  shapes: ShapeItem[];
}

export interface TwoColumnSlide extends SlideBase {
  kind: "twoColumn";
  title?: string;
  left: Bullet[];
  right: Bullet[];
}

export interface QuoteSlide extends SlideBase {
  kind: "quote";
  text: string;
  attribution?: string;
}

export type ExtSlide =
  | ExtTitleSlide
  | ExtBulletsSlide
  | ShapesSlide
  | TwoColumnSlide
  | QuoteSlide;

/**
 * Slide master definition.
 *
 * NOTE (PptxGenJS gap): defineSlideMaster only supports placeholders of type
 * 'title' | 'body' | 'pic' | 'chart' | 'tbl' | 'media' — there is no real
 * 'ftr' (footer) placeholder type. `footerText` is therefore rendered as a
 * static text object on the master (same visual result, not user-editable as
 * a placeholder). `slideNumber` uses the native slide-number field, which
 * PptxGenJS does support on masters.
 */
export interface MasterSpec {
  /** Unique master name; referenced by slide.master. */
  name: string;
  /** Theme background color (hex without '#'). */
  background?: string;
  /** Footer text shown on every slide using this master. */
  footerText?: string;
  /** Show the slide-number field (defaults to true when footerText is set). */
  slideNumber?: boolean;
}

export interface ExtDeckSpec {
  title?: string;
  /** PptxGenJS layout name, e.g. 'LAYOUT_WIDE' (default) or 'LAYOUT_4x3'. */
  layout?: "LAYOUT_WIDE" | "LAYOUT_4x3" | "LAYOUT_16x9";
  masters?: MasterSpec[];
  slides: ExtSlide[];
}
