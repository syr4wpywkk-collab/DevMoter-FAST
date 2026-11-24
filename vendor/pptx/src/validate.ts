import {
  DeckSpec,
  SLIDE_TYPES,
  SlideType,
  ChartKind,
} from "./spec.js";

export interface ValidationError {
  /** JSONPath-ish location, e.g. "slides[2].items[0].level". */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

const HEX_COLOR = /^[0-9a-fA-F]{6}$/;
const BASE64 = /^[A-Za-z0-9+/=\r\n]+$/;
const CHART_KINDS: ChartKind[] = ["bar", "line", "pie"];

type Errs = ValidationError[];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optString(errs: Errs, path: string, v: unknown): void {
  if (v !== undefined && typeof v !== "string") {
    errs.push({ path, message: `expected a string, got ${typeof v}` });
  }
}

function reqString(errs: Errs, path: string, v: unknown): void {
  if (typeof v !== "string" || v.length === 0) {
    errs.push({
      path,
      message:
        typeof v === "string"
          ? "must be a non-empty string"
          : `required; expected a non-empty string, got ${typeof v}`,
    });
  }
}

function optHex(errs: Errs, path: string, v: unknown): void {
  if (v !== undefined && (typeof v !== "string" || !HEX_COLOR.test(v))) {
    errs.push({ path, message: 'expected a 6-digit hex color without "#", e.g. "1A2B3C"' });
  }
}

/**
 * Validate a decoded-JSON deck spec. Error paths point at the exact field
 * so an LLM caller can self-correct and retry.
 */
export function validateSpec(spec: unknown): ValidationResult {
  const errs: Errs = [];

  if (!isObj(spec)) {
    return { ok: false, errors: [{ path: "$", message: "spec must be an object" }] };
  }

  if (spec.meta !== undefined) {
    if (!isObj(spec.meta)) {
      errs.push({ path: "meta", message: "expected an object {title?, author?}" });
    } else {
      optString(errs, "meta.title", spec.meta.title);
      optString(errs, "meta.author", spec.meta.author);
    }
  }

  if (spec.size !== undefined && spec.size !== "16:9" && spec.size !== "4:3") {
    errs.push({ path: "size", message: 'expected "16:9" or "4:3"' });
  }

  if (spec.theme !== undefined) {
    if (!isObj(spec.theme)) {
      errs.push({ path: "theme", message: "expected an object {primary?, accent?, background?, font?}" });
    } else {
      optHex(errs, "theme.primary", spec.theme.primary);
      optHex(errs, "theme.accent", spec.theme.accent);
      optHex(errs, "theme.background", spec.theme.background);
      optString(errs, "theme.font", spec.theme.font);
    }
  }

  if (!Array.isArray(spec.slides)) {
    errs.push({ path: "slides", message: "required; expected an array of slide objects" });
  } else if (spec.slides.length === 0) {
    errs.push({ path: "slides", message: "must contain at least one slide" });
  } else {
    spec.slides.forEach((s, i) => validateSlide(errs, `slides[${i}]`, s));
  }

  return errs.length === 0 ? { ok: true } : { ok: false, errors: errs };
}

function validateSlide(errs: Errs, path: string, s: unknown): void {
  if (!isObj(s)) {
    errs.push({ path, message: "each slide must be an object" });
    return;
  }
  const type = s.type as SlideType;
  if (typeof type !== "string" || !(SLIDE_TYPES as readonly string[]).includes(type)) {
    errs.push({
      path: `${path}.type`,
      message: `required; expected one of ${SLIDE_TYPES.map((t) => `"${t}"`).join(", ")}`,
    });
    return;
  }

  switch (type) {
    case "title":
      reqString(errs, `${path}.title`, s.title);
      optString(errs, `${path}.subtitle`, s.subtitle);
      break;
    case "section":
      reqString(errs, `${path}.title`, s.title);
      break;
    case "bullets":
      optString(errs, `${path}.title`, s.title);
      if (!Array.isArray(s.items) || s.items.length === 0) {
        errs.push({ path: `${path}.items`, message: "required; expected a non-empty array of strings or {text, level} objects" });
      } else {
        s.items.forEach((it, j) => {
          const ip = `${path}.items[${j}]`;
          if (typeof it === "string") {
            if (it.length === 0) errs.push({ path: ip, message: "must be a non-empty string" });
          } else if (isObj(it)) {
            reqString(errs, `${ip}.text`, it.text);
            if (typeof it.level !== "number" || !Number.isInteger(it.level) || it.level < 0) {
              errs.push({ path: `${ip}.level`, message: "required; expected an integer >= 0" });
            }
          } else {
            errs.push({ path: ip, message: "expected a string or an object {text: string, level: number}" });
          }
        });
      }
      break;
    case "text":
      optString(errs, `${path}.title`, s.title);
      if (!Array.isArray(s.paragraphs) || s.paragraphs.length === 0) {
        errs.push({ path: `${path}.paragraphs`, message: "required; expected a non-empty array of strings" });
      } else {
        s.paragraphs.forEach((p, j) => {
          if (typeof p !== "string") {
            errs.push({ path: `${path}.paragraphs[${j}]`, message: `expected a string, got ${typeof p}` });
          }
        });
      }
      break;
    case "image":
      if (!isObj(s.src)) {
        errs.push({ path: `${path}.src`, message: 'required; expected an object {dataBase64: string, type: "png"|"jpg"}' });
      } else {
        const d = s.src.dataBase64;
        if (typeof d !== "string" || d.length === 0 || !BASE64.test(d)) {
          errs.push({ path: `${path}.src.dataBase64`, message: "required; expected a non-empty base64 string" });
        }
        if (s.src.type !== "png" && s.src.type !== "jpg") {
          errs.push({ path: `${path}.src.type`, message: 'expected "png" or "jpg"' });
        }
      }
      optString(errs, `${path}.caption`, s.caption);
      reqString(errs, `${path}.alt`, s.alt);
      break;
    case "table": {
      optString(errs, `${path}.title`, s.title);
      if (s.header !== undefined) {
        if (!Array.isArray(s.header) || s.header.some((h) => typeof h !== "string")) {
          errs.push({ path: `${path}.header`, message: "expected an array of strings" });
        }
      }
      if (!Array.isArray(s.rows) || s.rows.length === 0) {
        errs.push({ path: `${path}.rows`, message: "required; expected a non-empty array of string arrays" });
      } else {
        const width = Array.isArray(s.header) ? s.header.length : undefined;
        s.rows.forEach((r, j) => {
          const rp = `${path}.rows[${j}]`;
          if (!Array.isArray(r) || r.length === 0 || r.some((c) => typeof c !== "string")) {
            errs.push({ path: rp, message: "expected a non-empty array of strings" });
          } else if (width !== undefined && r.length !== width) {
            errs.push({ path: rp, message: `has ${r.length} cells but header has ${width} columns` });
          }
        });
      }
      break;
    }
    case "chart": {
      optString(errs, `${path}.title`, s.title);
      if (!CHART_KINDS.includes(s.kind as ChartKind)) {
        errs.push({ path: `${path}.kind`, message: 'required; expected "bar", "line" or "pie"' });
      }
      if (!Array.isArray(s.labels) || s.labels.length === 0 || s.labels.some((l) => typeof l !== "string")) {
        errs.push({ path: `${path}.labels`, message: "required; expected a non-empty array of strings" });
      }
      const labelCount = Array.isArray(s.labels) ? s.labels.length : 0;
      if (!Array.isArray(s.series) || s.series.length === 0) {
        errs.push({ path: `${path}.series`, message: "required; expected a non-empty array of {name, values} objects" });
      } else {
        s.series.forEach((se, j) => {
          const sp = `${path}.series[${j}]`;
          if (!isObj(se)) {
            errs.push({ path: sp, message: "expected an object {name: string, values: number[]}" });
            return;
          }
          reqString(errs, `${sp}.name`, se.name);
          if (!Array.isArray(se.values) || se.values.some((v) => typeof v !== "number")) {
            errs.push({ path: `${sp}.values`, message: "required; expected an array of numbers" });
          } else if (labelCount > 0 && se.values.length !== labelCount) {
            errs.push({
              path: `${sp}.values`,
              message: `has ${se.values.length} values but labels has ${labelCount} entries; lengths must match`,
            });
          }
        });
      }
      break;
    }
  }
}
