/**
 * DeckPlan -> rendered PPTX pipeline (the "AI generation" entry point).
 *
 * `DeckPlan` is the shape an LLM emits. `planToSpec` lowers it onto the core
 * SlideSpec kinds; `renderPlan` renders directly via PptxGenJS.
 *
 * NOTE: `src/spec.ts` is being built on a parallel branch and does not exist
 * here yet. The `PlanSpecSlide*` types below are a local copy of the expected
 * spec shapes so `planToSpec` can be written and tested now; the integrator
 * reconciles this local copy with the real spec module at merge time.
 */
import PptxGenJS from "pptxgenjs";

// ---------------------------------------------------------------------------
// DeckPlan — the LLM-facing shape
// ---------------------------------------------------------------------------

export type SlideIntent =
  | "title"
  | "agenda"
  | "concept"
  | "data"
  | "comparison"
  | "summary"
  | "closing";

export interface PlanTable {
  header: string[];
  rows: string[][];
}

export interface PlanChartSeries {
  name: string;
  values: number[];
}

export type PlanChartKind = "bar" | "line" | "pie";

export interface PlanChart {
  kind: PlanChartKind;
  labels: string[];
  series: PlanChartSeries[];
}

export interface PlanSlide {
  intent: SlideIntent;
  heading: string;
  bullets?: string[];
  table?: PlanTable;
  chart?: PlanChart;
  /** Hint for an image an image-tool could fetch later; rendered as a text placeholder. */
  imageHint?: string;
  /** Speaker notes. */
  notes?: string;
}

export interface DeckPlan {
  title: string;
  audience?: string;
  goal?: string;
  slides: PlanSlide[];
}

// ---------------------------------------------------------------------------
// Local copy of the core spec types (reconciled with src/spec.ts at merge)
// ---------------------------------------------------------------------------

export interface SpecTextBody {
  heading: string;
  bullets: string[];
}

export interface SpecTableBody {
  header: string[];
  rows: string[][];
}

export interface SpecChartBody {
  kind: PlanChartKind;
  labels: string[];
  series: PlanChartSeries[];
}

export type PlanSpecSlideKind = "title" | "bullets" | "table" | "chart" | "closing";

export interface PlanSpecSlide {
  kind: PlanSpecSlideKind;
  text?: SpecTextBody;
  table?: SpecTableBody;
  chart?: SpecChartBody;
  notes?: string;
}

export interface PlanDeckSpec {
  title: string;
  slides: PlanSpecSlide[];
}

// ---------------------------------------------------------------------------
// planToSpec — intent -> spec-kind mapping
// ---------------------------------------------------------------------------

function bulletsOf(slide: PlanSlide): string[] {
  return slide.bullets ?? [];
}

function planSlideToSpec(slide: PlanSlide): PlanSpecSlide {
  const notes = slide.notes;
  switch (slide.intent) {
    case "title":
      return {
        kind: "title",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes,
      };
    case "agenda":
    case "concept":
    case "summary":
      // Bullet-list body for all prose intents.
      return {
        kind: "bullets",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes,
      };
    case "comparison":
      // A comparison is expressed as a table; without one, fall back to bullets.
      if (slide.table) {
        return { kind: "table", table: slide.table, notes };
      }
      return {
        kind: "bullets",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes,
      };
    case "data":
      // Prefer a chart when present; a chart needs matching label/value counts
      // to be renderable, otherwise prefer the table, then bullets.
      if (
        slide.chart &&
        slide.chart.series.every((s) => s.values.length === slide.chart!.labels.length)
      ) {
        return { kind: "chart", chart: slide.chart, notes };
      }
      if (slide.table) {
        return { kind: "table", table: slide.table, notes };
      }
      return {
        kind: "bullets",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes,
      };
    case "closing":
      return {
        kind: "closing",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes,
      };
  }
}

/** Lower a DeckPlan onto the core spec representation. */
export function planToSpec(plan: DeckPlan): PlanDeckSpec {
  return {
    title: plan.title,
    slides: plan.slides.map(planSlideToSpec),
  };
}

// ---------------------------------------------------------------------------
// renderPlan — DeckPlan -> PPTX bytes via PptxGenJS
// ---------------------------------------------------------------------------

const LAYOUT = "LAYOUT_WIDE"; // 13.33 x 7.5 in

const FONT = "Calibri";
const COLOR_HEADING = "1F3864";
const COLOR_BODY = "333333";
const COLOR_MUTED = "7F7F7F";

function addNotes(slide: PptxGenJS.Slide, notes?: string): void {
  if (notes) slide.addNotes(notes);
}

function addImageHintPlaceholder(slide: PptxGenJS.Slide, hint: string | undefined, y: number): void {
  // PptxGenJS can embed images only from real data/URLs; a hint is not
  // fetchable, so we render a muted placeholder line instead of faking media.
  if (!hint) return;
  slide.addText(`[image: ${hint}]`, {
    x: 0.6,
    y,
    w: 12.1,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    italic: true,
    color: COLOR_MUTED,
  });
}

function renderSpecSlide(pptx: PptxGenJS, spec: PlanSpecSlide, planSlide: PlanSlide): void {
  const slide = pptx.addSlide();

  switch (spec.kind) {
    case "title": {
      slide.addText(spec.text!.heading, {
        x: 0.6,
        y: 2.4,
        w: 12.1,
        h: 1.4,
        fontFace: FONT,
        fontSize: 44,
        bold: true,
        align: "center",
        color: COLOR_HEADING,
      });
      if (spec.text!.bullets.length > 0) {
        slide.addText(spec.text!.bullets.join("\n"), {
          x: 0.6,
          y: 4.0,
          w: 12.1,
          h: 1.6,
          fontFace: FONT,
          fontSize: 20,
          align: "center",
          color: COLOR_BODY,
          valign: "top",
        });
      }
      addImageHintPlaceholder(slide, planSlide.imageHint, 5.8);
      break;
    }
    case "closing": {
      slide.addText(spec.text!.heading, {
        x: 0.6,
        y: 2.8,
        w: 12.1,
        h: 1.2,
        fontFace: FONT,
        fontSize: 36,
        bold: true,
        align: "center",
        color: COLOR_HEADING,
      });
      if (spec.text!.bullets.length > 0) {
        slide.addText(spec.text!.bullets.join("\n"), {
          x: 0.6,
          y: 4.2,
          w: 12.1,
          h: 1.4,
          fontFace: FONT,
          fontSize: 18,
          align: "center",
          color: COLOR_BODY,
          valign: "top",
        });
      }
      addImageHintPlaceholder(slide, planSlide.imageHint, 5.8);
      break;
    }
    case "bullets": {
      slide.addText(spec.text!.heading, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: COLOR_HEADING,
      });
      slide.addText(
        spec.text!.bullets.map((b) => ({ text: b, options: { bullet: { code: "2022" } } })),
        {
          x: 0.9,
          y: 1.5,
          w: 11.5,
          h: 5.0,
          fontFace: FONT,
          fontSize: 18,
          color: COLOR_BODY,
          valign: "top",
          paraSpaceAfter: 8,
        },
      );
      addImageHintPlaceholder(slide, planSlide.imageHint, 6.8);
      break;
    }
    case "table": {
      slide.addText(planSlide.heading, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: COLOR_HEADING,
      });
      const headerRow = spec.table!.header.map((cell) => ({
        text: cell,
        options: { bold: true, fill: { color: "D9E2F3" } },
      }));
      const rows = spec.table!.rows.map((r) => r.map((cell) => ({ text: cell })));
      slide.addTable([headerRow, ...rows], {
        x: 0.6,
        y: 1.5,
        w: 12.1,
        fontFace: FONT,
        fontSize: 14,
        color: COLOR_BODY,
        border: { type: "solid", pt: 0.75, color: "BFBFBF" },
        valign: "middle",
      });
      addImageHintPlaceholder(slide, planSlide.imageHint, 6.8);
      break;
    }
    case "chart": {
      slide.addText(planSlide.heading, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: COLOR_HEADING,
      });
      const chartType =
        spec.chart!.kind === "bar"
          ? pptx.ChartType.bar
          : spec.chart!.kind === "line"
            ? pptx.ChartType.line
            : pptx.ChartType.pie;
      const data = spec.chart!.series.map((s) => ({
        name: s.name,
        labels: spec.chart!.labels,
        values: s.values,
      }));
      slide.addChart(chartType, data, {
        x: 0.6,
        y: 1.5,
        w: 12.1,
        h: 5.2,
        showLegend: spec.chart!.series.length > 1,
        showTitle: false,
      });
      addImageHintPlaceholder(slide, planSlide.imageHint, 6.9);
      break;
    }
  }

  addNotes(slide, spec.notes);
}

/**
 * Render a DeckPlan to .pptx bytes. Validates nothing — run
 * `validatePlan` from plan-schema.ts first if the plan comes from an LLM.
 */
export async function renderPlan(plan: DeckPlan): Promise<Uint8Array> {
  const spec = planToSpec(plan);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: LAYOUT, width: 13.33, height: 7.5 });
  pptx.layout = LAYOUT;
  pptx.title = plan.title;
  if (plan.audience) pptx.subject = `audience: ${plan.audience}`;

  spec.slides.forEach((s, i) => renderSpecSlide(pptx, s, plan.slides[i]));

  const out = await pptx.write({ outputType: "uint8array" });
  return out as Uint8Array;
}
