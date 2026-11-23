import { XMLParser } from "fast-xml-parser";

/**
 * Shared XML parser for .xlsx parts.
 *
 * Options chosen for OOXML semantics:
 * - `ignoreAttributes: false` so `r`, `t`, `s`, `r:id`, `ref` are visible.
 * - `parseTagValue: false` keeps `<v>` contents as strings so cell typing is
 *   decided from the `t` attribute, not the parser's guess.
 * - `trimValues: false` keeps meaningful whitespace inside shared strings and
 *   formulas (`<t xml:space="preserve">` handling is ours anyway).
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

/** Parse an XML part into a plain JS object tree. */
export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

/** Normalize a possibly-undefined node to an array of child nodes. */
export function asArray<T = unknown>(node: T | T[] | undefined | null): T[] {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

/**
 * Text content of a node parsed by fast-xml-parser: a bare string/number, or an
 * object whose text lives in `#text` (element with attributes).
 */
export function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    return t === undefined ? undefined : String(t);
  }
  return String(node);
}

/** Join all `<t>` text descendants (shared strings, inline strings, rich runs). */
export function joinText(node: unknown): string {
  let out = "";
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(n as Record<string, unknown>)) {
      if (key === "t") for (const t of asArray(value)) out += textOf(t) ?? "";
      else if (key !== "#text") walk(value);
    }
  };
  walk(node);
  return out;
}

/** Escape text for XML output. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape an attribute value for XML output. */
export function escapeAttr(value: string): string {
  return escapeXml(value).replace(/"/g, "&quot;");
}

/** ` xml:space="preserve"` when the text has leading/trailing whitespace. */
export function spacePreserve(text: string): string {
  return /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
}
