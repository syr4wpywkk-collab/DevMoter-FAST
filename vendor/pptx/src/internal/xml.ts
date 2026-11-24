import { XMLParser } from "fast-xml-parser";

/**
 * Shared XML parser for .pptx parts.
 *
 * Options chosen for OOXML semantics:
 * - `ignoreAttributes: false` so `r:embed`, `type`, `idx`, `cx`/`cy` are visible.
 * - Element order within a single tag name is preserved as arrays; order
 *   between different tag names is not, which is acceptable for outline data.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  // Keep whitespace inside runs: <a:t xml:space="preserve"> may carry
  // meaningful leading/trailing spaces.
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
