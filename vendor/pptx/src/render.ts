import PptxGenJS from "pptxgenjs";
import { DeckSpec, DeckTheme, SlideSpec } from "./spec.js";
import { validateSpec } from "./validate.js";

const DEFAULTS = {
  primary: "1F3864",
  accent: "2E75B6",
  background: "FFFFFF",
  font: "Calibri",
};

interface Theme {
  primary: string;
  accent: string;
  background: string;
  font: string;
}

function resolveTheme(t?: DeckTheme): Theme {
  return {
    primary: t?.primary ?? DEFAULTS.primary,
    accent: t?.accent ?? DEFAULTS.accent,
    background: t?.background ?? DEFAULTS.background,
    font: t?.font ?? DEFAULTS.font,
  };
}

function stripHash(c: string): string {
  return c.startsWith("#") ? c.slice(1) : c;
}

/**
 * Render a DeckSpec to .pptx bytes via PptxGenJS.
 * Throws an Error listing validation errors when the spec is invalid.
 */
export async function renderDeck(spec: DeckSpec): Promise<Uint8Array> {
  const result = validateSpec(spec);
  if (!result.ok) {
    const detail = result.errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
    throw new Error(`invalid deck spec:\n${detail}`);
  }

  const theme = resolveTheme(spec.theme);
  const pptx = new PptxGenJS();
  // PptxGenJS built-in layouts: 16:9 = 10" x 5.625", 4:3 = 10" x 7.5".
  pptx.layout = spec.size === "4:3" ? "LAYOUT_4x3" : "LAYOUT_16x9";
  if (spec.meta?.title) pptx.title = spec.meta.title;
  if (spec.meta?.author) pptx.author = spec.meta.author;
  pptx.theme = { headFontFace: theme.font, bodyFontFace: theme.font };

  const W = 10;
  const H = spec.size === "4:3" ? 7.5 : 5.625;

  for (const s of spec.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: stripHash(theme.background) };
    renderSlide(slide, s, theme, W, H);
  }

  const out = await pptx.write({ outputType: "uint8array" });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

function addSlideTitle(
  slide: PptxGenJS.Slide,
  title: string,
  theme: Theme,
  W: number,
): void {
  slide.addText(title, {
    x: 0.5,
    y: 0.3,
    w: W - 1,
    h: 0.8,
    fontFace: theme.font,
    fontSize: 28,
    bold: true,
    color: stripHash(theme.primary),
  });
  // Accent rule under the title.
  slide.addShape("rect", {
    x: 0.5,
    y: 1.15,
    w: W - 1,
    h: 0.04,
    fill: { color: stripHash(theme.accent) },
    line: { type: "none" },
  });
}

function renderSlide(
  slide: PptxGenJS.Slide,
  s: SlideSpec,
  theme: Theme,
  W: number,
  H: number,
): void {
  const font = theme.font;
  const primary = stripHash(theme.primary);
  const accent = stripHash(theme.accent);

  switch (s.type) {
    case "title": {
      slide.addText(s.title, {
        x: 0.5,
        y: H / 2 - 1,
        w: W - 1,
        h: 1.2,
        fontFace: font,
        fontSize: 44,
        bold: true,
        color: primary,
        align: "center",
      });
      if (s.subtitle) {
        slide.addText(s.subtitle, {
          x: 0.5,
          y: H / 2 + 0.3,
          w: W - 1,
          h: 0.8,
          fontFace: font,
          fontSize: 20,
          color: accent,
          align: "center",
        });
      }
      break;
    }
    case "section": {
      // Accent band behind a large centered title.
      slide.addShape("rect", {
        x: 0,
        y: H / 2 - 0.9,
        w: W,
        h: 1.8,
        fill: { color: accent },
        line: { type: "none" },
      });
      slide.addText(s.title, {
        x: 0.5,
        y: H / 2 - 0.6,
        w: W - 1,
        h: 1.2,
        fontFace: font,
        fontSize: 36,
        bold: true,
        color: "FFFFFF",
        align: "center",
      });
      break;
    }
    case "bullets": {
      if (s.title) addSlideTitle(slide, s.title, theme, W);
      const y0 = s.title ? 1.5 : 0.5;
      slide.addText(
        s.items.map((it) => {
          const text = typeof it === "string" ? it : it.text;
          const level = typeof it === "string" ? 0 : it.level;
          return {
            text,
            options: {
              bullet: { code: "2022", indent: 14 },
              indentLevel: level,
              fontSize: Math.max(12, 18 - level * 2),
              color: "333333",
              fontFace: font,
              paraSpaceAfter: 6,
            },
          };
        }),
        { x: 0.7, y: y0, w: W - 1.4, h: H - y0 - 0.4, fontFace: font, valign: "top" },
      );
      break;
    }
    case "text": {
      if (s.title) addSlideTitle(slide, s.title, theme, W);
      const y0 = s.title ? 1.5 : 0.5;
      slide.addText(
        s.paragraphs.map((p) => ({
          text: p,
          options: { fontSize: 14, color: "333333", fontFace: font, paraSpaceAfter: 10 },
        })),
        { x: 0.7, y: y0, w: W - 1.4, h: H - y0 - 0.4, fontFace: font, valign: "top" },
      );
      break;
    }
    case "image": {
      const mime = s.src.type === "png" ? "image/png" : "image/jpeg";
      const capH = s.caption ? 0.5 : 0;
      slide.addImage({
        data: `${mime};base64,${s.src.dataBase64}`,
        x: 1,
        y: 0.6,
        w: W - 2,
        h: H - 1.2 - capH,
        altText: s.alt,
        // Fit the image inside the box without distortion.
        sizing: { type: "contain", w: W - 2, h: H - 1.2 - capH },
      });
      if (s.caption) {
        slide.addText(s.caption, {
          x: 1,
          y: H - 0.7,
          w: W - 2,
          h: 0.5,
          fontFace: font,
          fontSize: 12,
          italic: true,
          color: "666666",
          align: "center",
        });
      }
      break;
    }
    case "table": {
      if (s.title) addSlideTitle(slide, s.title, theme, W);
      const y0 = s.title ? 1.5 : 0.6;
      const rows: PptxGenJS.TableRow[] = [];
      if (s.header) {
        rows.push(
          s.header.map((h) => ({
            text: h,
            options: { bold: true, color: "FFFFFF", fill: { color: primary } },
          })),
        );
      }
      for (const r of s.rows) {
        rows.push(r.map((c) => ({ text: c, options: { color: "333333" } })));
      }
      slide.addTable(rows, {
        x: 0.5,
        y: y0,
        w: W - 1,
        fontFace: font,
        fontSize: 12,
        border: { pt: 0.5, color: "BFBFBF" },
      });
      break;
    }
    case "chart": {
      if (s.title) addSlideTitle(slide, s.title, theme, W);
      const y0 = s.title ? 1.5 : 0.5;
      const data = s.series.map((se) => ({
        name: se.name,
        labels: s.labels,
        values: se.values,
      }));
      slide.addChart(s.kind === "pie" ? "pie" : s.kind, data, {
        x: 0.5,
        y: y0,
        w: W - 1,
        h: H - y0 - 0.4,
        chartColors: [primary, accent, "8FAADC", "A9C4EB", "C9D7F0"],
        chartColorsOpacity: 100,
        showLegend: s.series.length > 1 || s.kind === "pie",
        showTitle: false,
        catAxisLabelFontFace: font,
        valAxisLabelFontFace: font,
        dataLabelFontFace: font,
      });
      break;
    }
  }
}
