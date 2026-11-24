/**
 * Declarative slide-deck specification consumed by the PPTX generator.
 * The union is discriminated on `SlideSpec.type`; chart slides additionally
 * carry `kind` ("bar" | "line" | "pie") selecting the chart type.
 */

export type DeckSize = "16:9" | "4:3";

export interface DeckMeta {
  title?: string;
  author?: string;
}

/** Theme colors are 6-digit hex strings without '#', e.g. "1A2B3C". */
export interface DeckTheme {
  primary?: string;
  accent?: string;
  background?: string;
  font?: string;
}

export interface DeckSpec {
  meta?: DeckMeta;
  size?: DeckSize;
  theme?: DeckTheme;
  slides: SlideSpec[];
}

export type SlideSpec =
  | TitleSlide
  | SectionSlide
  | BulletsSlide
  | TextSlide
  | ImageSlide
  | TableSlide
  | ChartSlide;

export const SLIDE_TYPES = [
  "title",
  "section",
  "bullets",
  "text",
  "image",
  "table",
  "chart",
] as const;

export type SlideType = (typeof SLIDE_TYPES)[number];

export interface TitleSlide {
  type: "title";
  title: string;
  subtitle?: string;
}

export interface SectionSlide {
  type: "section";
  title: string;
}

export type BulletItem = string | { text: string; level: number };

export interface BulletsSlide {
  type: "bullets";
  title?: string;
  items: BulletItem[];
}

export interface TextSlide {
  type: "text";
  title?: string;
  paragraphs: string[];
}

export type ImageType = "png" | "jpg";

export interface ImageSlide {
  type: "image";
  src: { dataBase64: string; type: ImageType };
  caption?: string;
  alt: string;
}

export interface TableSlide {
  type: "table";
  title?: string;
  header?: string[];
  rows: string[][];
}

export type ChartKind = "bar" | "line" | "pie";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSlide {
  type: "chart";
  title?: string;
  kind: ChartKind;
  labels: string[];
  series: ChartSeries[];
}
