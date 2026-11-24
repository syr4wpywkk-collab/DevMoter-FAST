/**
 * Renderer for the extended deck spec (spec-ext.ts). Self-contained: does not
 * import render.ts (owned by a sibling track).
 */
import PptxGenJS from "pptxgenjs";
import type {
  Bullet,
  ExtDeckSpec,
  ExtSlide,
  ShapeItem,
} from "./spec-ext.js";

const SHAPE_NAME: Record<ShapeItem["kind"], PptxGenJS.SHAPE_NAME> = {
  rect: "rect",
  roundRect: "roundRect",
  oval: "ellipse",
  line: "line",
};

function toTextRuns(items: Bullet[]): PptxGenJS.TextProps[] {
  return items.map((it) => {
    const b: Bullet = it;
    const item = typeof b === "string" ? { text: b } : b;
    return {
      text: item.text,
      options: {
        breakLine: true,
        bullet: true,
        ...(item.url ? { hyperlink: { url: item.url }, color: "0563C1" } : {}),
      },
    };
  });
}

function addShape(slide: PptxGenJS.Slide, s: ShapeItem): void {
  const opts: PptxGenJS.ShapeProps = {
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    ...(s.fill ? { fill: { color: s.fill.color ?? "FFFFFF", transparency: s.fill.transparency } } : {}),
    ...(s.line
      ? { line: { color: s.line.color ?? "000000", width: s.line.width, dashType: s.line.dashType } }
      : {}),
  };
  slide.addShape(SHAPE_NAME[s.kind], opts);
  // PptxGenJS does not support text inside an addShape call for arbitrary
  // shapes in a single call; overlay a text box on the same rect instead.
  if (s.text && s.kind !== "line") {
    slide.addText(s.text, {
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      align: "center",
      valign: "middle",
    });
  }
}

export async function renderExtDeck(spec: ExtDeckSpec): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = spec.layout ?? "LAYOUT_WIDE";
  if (spec.title) pptx.title = spec.title;

  const masterNames = new Set<string>();
  for (const m of spec.masters ?? []) {
    masterNames.add(m.name);
    const objects: PptxGenJS.SlideMasterProps["objects"] = [];
    // Real 'ftr' placeholders are not supported by PptxGenJS
    // (PLACEHOLDER_TYPES lacks 'footer'); a master-level text object is the
    // closest supported behavior.
    if (m.footerText) {
      objects.push({
        text: {
          text: m.footerText,
          options: { x: 0.5, y: "90%", w: 4, h: 0.4, fontSize: 10, color: "808080" },
        },
      });
    }
    pptx.defineSlideMaster({
      title: m.name,
      background: m.background ? { color: m.background } : undefined,
      objects: objects.length ? objects : undefined,
      slideNumber:
        m.slideNumber ?? m.footerText
          ? { x: "92%", y: "90%", color: "808080", fontSize: 10 }
          : undefined,
    });
  }

  for (const s of spec.slides) {
    const slide = pptx.addSlide(s.master ? { masterName: s.master } : undefined);
    if (s.notes) slide.addNotes(s.notes);

    switch (s.kind) {
      case "title": {
        slide.addText(s.title, { x: 0.5, y: 2, w: "90%", h: 1.5, fontSize: 36, bold: true });
        if (s.subtitle)
          slide.addText(s.subtitle, { x: 0.5, y: 3.6, w: "90%", h: 1, fontSize: 20 });
        break;
      }
      case "bullets": {
        if (s.title)
          slide.addText(s.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 24, bold: true });
        slide.addText(toTextRuns(s.bullets), { x: 0.6, y: 1.2, w: "88%", h: 5 });
        break;
      }
      case "shapes": {
        if (s.title)
          slide.addText(s.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 24, bold: true });
        for (const sh of s.shapes) addShape(slide, sh);
        break;
      }
      case "twoColumn": {
        if (s.title)
          slide.addText(s.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 24, bold: true });
        slide.addText(toTextRuns(s.left), { x: 0.5, y: 1.2, w: "44%", h: 5 });
        slide.addText(toTextRuns(s.right), { x: "52%", y: 1.2, w: "44%", h: 5 });
        break;
      }
      case "quote": {
        slide.addText(`“${s.text}”`, {
          x: 1,
          y: 2,
          w: "80%",
          h: 2,
          fontSize: 28,
          italic: true,
          align: "center",
        });
        if (s.attribution)
          slide.addText(`— ${s.attribution}`, {
            x: 1,
            y: 4.2,
            w: "80%",
            h: 0.6,
            fontSize: 18,
            align: "center",
          });
        break;
      }
    }
  }

  const out = await pptx.write({ outputType: "uint8array" });
  return out as Uint8Array;
}
