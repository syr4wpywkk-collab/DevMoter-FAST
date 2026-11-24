/**
 * JSON Schema for DeckPlan plus a small validator so an agent runtime can
 * check LLM output before rendering.
 *
 * The canonical schema also lives in `src/plan-schema.json` (same directory)
 * for non-TS consumers; `deckPlanSchema` below is the embedded copy and a
 * golden test asserts both stay identical. Embedded copy is used instead of a
 * JSON import so that `tsc` output in `dist/` is self-contained.
 */
import type { DeckPlan } from "./plan.js";

/** One validation problem, in the shared office-error style. */
export interface ValidationError {
  /** JSON-pointer-ish path, e.g. `/slides/0/table/header`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Canonical DeckPlan JSON Schema (draft-07 subset). Keep in sync with plan-schema.json. */
export const deckPlanSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://devmoter.dev/schemas/deck-plan.json",
  title: "DeckPlan",
  description: "A slide-deck plan as emitted by an LLM before rendering to PPTX.",
  type: "object",
  required: ["title", "slides"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1 },
    audience: { type: "string" },
    goal: { type: "string" },
    slides: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/definitions/planSlide" },
    },
  },
  definitions: {
    planSlide: {
      type: "object",
      required: ["intent", "heading"],
      additionalProperties: false,
      properties: {
        intent: {
          type: "string",
          enum: ["title", "agenda", "concept", "data", "comparison", "summary", "closing"],
        },
        heading: { type: "string", minLength: 1 },
        bullets: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        table: {
          type: "object",
          required: ["header", "rows"],
          additionalProperties: false,
          properties: {
            header: { type: "array", minItems: 1, items: { type: "string" } },
            rows: {
              type: "array",
              items: { type: "array", items: { type: "string" } },
            },
          },
        },
        chart: {
          type: "object",
          required: ["kind", "labels", "series"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["bar", "line", "pie"] },
            labels: { type: "array", minItems: 1, items: { type: "string" } },
            series: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["name", "values"],
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1 },
                  values: { type: "array", minItems: 1, items: { type: "number" } },
                },
              },
            },
          },
        },
        imageHint: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
} as const;

type Json = unknown;
type Schema = Record<string, Json>;

function typeOf(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function resolveRef(root: Schema, ref: string): Schema | undefined {
  // Only local refs of the form "#/definitions/<name>" are used.
  const m = /^#\/definitions\/([^/]+)$/.exec(ref);
  if (!m) return undefined;
  const defs = root.definitions as Schema | undefined;
  return defs?.[m[1]] as Schema | undefined;
}

function validateNode(value: Json, schema: Schema, path: string, root: Schema, errors: ValidationError[]): void {
  if (typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);
    if (target) validateNode(value, target, path, root, errors);
    return;
  }

  const expected = schema.type as string | undefined;
  if (expected && typeOf(value) !== expected) {
    errors.push({ path, message: `expected ${expected}, got ${typeOf(value)}` });
    return; // Type mismatch: deeper checks are meaningless.
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, message: `must be one of ${(schema.enum as Json[]).map((e) => JSON.stringify(e)).join(", ")}` });
  }

  if (typeof value === "string") {
    const minLength = schema.minLength as number | undefined;
    if (minLength !== undefined && value.length < minLength) {
      errors.push({ path, message: `string shorter than minLength ${minLength}` });
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema.minItems as number | undefined;
    if (minItems !== undefined && value.length < minItems) {
      errors.push({ path, message: `array has fewer than minItems ${minItems}` });
    }
    const items = schema.items as Schema | undefined;
    if (items) value.forEach((item, i) => validateNode(item, items, `${path}/${i}`, root, errors));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, Json>;
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in obj)) errors.push({ path: `${path}/${key}`, message: "missing required property" });
    }
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) validateNode(obj[key], sub, `${path}/${key}`, root, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push({ path: `${path}/${key}`, message: "unexpected property" });
      }
    }
  }
}

/**
 * Validate unknown LLM output against the DeckPlan schema.
 * Returns `{ valid, errors }` — never throws.
 */
export function validatePlan(value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  validateNode(value, deckPlanSchema as unknown as Schema, "", deckPlanSchema as unknown as Schema, errors);
  return { valid: errors.length === 0, errors };
}

/** Validate and narrow: returns the plan if valid, otherwise null. */
export function parsePlan(value: unknown): DeckPlan | null {
  return validatePlan(value).valid ? (value as DeckPlan) : null;
}
