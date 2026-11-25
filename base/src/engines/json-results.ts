// Parses the JSON that the engine shells print: one top-level array of row
// objects per statement, written back to back.

import type { ResultSet } from './types.ts';

/** Significant digits (no leading or trailing zeros) and the power of ten of the last one; undefined when `text` is not a decimal number. */
function decimalParts(text: string): { digits: string; exponent: number } | undefined {
  const match = /^-?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return undefined;
  const fraction = match[2] ?? '';
  const all = (match[1] as string) + fraction;
  const digits = all.replace(/^0+/, '').replace(/0+$/, '');
  if (digits === '') return { digits: '', exponent: 0 };
  return { digits, exponent: Number(match[3] ?? 0) - fraction.length + (all.length - all.replace(/0+$/, '').length) };
}

/** True when the double nearest to the decimal `source`, written with as many digits as `source` has, is `source` again. */
function survivesAsDouble(source: string, value: number): boolean {
  // Up to 15 significant digits always survive (and no exponent means no overflow).
  if (source.length <= 16 && !/[eE]/.test(source)) return true;
  const written = decimalParts(source);
  if (!written) return true;
  const precision = (/^-?0*\.?0*(\d*)\.?(\d*)/.exec(source) as RegExpExecArray).slice(1, 3).join('').length;
  if (precision === 0) return true; // zero
  if (precision > 100) return false;
  const read = decimalParts(value.toPrecision(precision));
  return read !== undefined && read.digits === written.digits && read.exponent === written.exponent;
}

/**
 * Numbers a JavaScript number cannot hold are returned as strings, not rounded: integers beyond
 * ±2^53, decimals with more digits than a double keeps (DuckDB prints a DECIMAL inside a list or
 * struct as a bare number), and values too large for a double, which become "Infinity" or
 * "-Infinity" (SQLite prints infinity as 9.0e+999).
 */
export function exactNumbers(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== 'number' || context?.source === undefined) return value;
  // An integer written as one. Written with a fraction or an exponent, it may be what a longer decimal was rounded to.
  if (Number.isSafeInteger(value) && !/[.eE]/.test(context.source)) return value;
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
  if (/^-?\d+$/.test(context.source)) return context.source;
  return survivesAsDouble(context.source, value) ? value : context.source;
}

/** Splits `text` into its top-level JSON values. */
export function splitJsonValues(text: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      if (depth === 0) throw new SyntaxError(`unexpected string at offset ${index}`);
      inString = true;
    } else if (char === '[' || char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) throw new SyntaxError(`unbalanced "${char}" at offset ${index}`);
      if (depth === 0) values.push(text.slice(start, index + 1));
    } else if (depth === 0 && char !== undefined && !/\s/.test(char)) {
      throw new SyntaxError(`unexpected "${char}" at offset ${index}`);
    }
  }
  if (depth !== 0 || inString) throw new SyntaxError('truncated JSON output');
  return values;
}

/**
 * Column names of the first row, in the order the engine wrote them. `Object.keys` cannot be
 * used: JavaScript objects list integer-like keys ("2024") first, in numeric order.
 * `source` must be valid JSON: one array of row objects.
 */
export function firstRowKeys(source: string): string[] {
  const keys = new Set<string>();
  let depth = 0; // 1: inside the array, 2: inside a row
  let expectKey = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      let end = index + 1;
      while (source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
      if (depth === 2 && expectKey) keys.add(JSON.parse(source.slice(index, end + 1)) as string);
      expectKey = false;
      index = end;
    } else if (char === '[' || char === '{') {
      depth += 1;
      expectKey = depth === 2;
    } else if (char === ']' || char === '}') {
      depth -= 1;
      if (depth <= 1) break;
    } else if (char === ',' && depth === 2) {
      expectKey = true;
    }
  }
  return [...keys];
}

/**
 * DuckDB prints non-finite doubles as bare `Infinity`, `-Infinity` and `NaN`, which JSON does not have.
 * They are returned as the strings "Infinity", "-Infinity" and "NaN".
 */
export function quoteNonFinite(source: string): string {
  // Results can be tens of megabytes: the text is copied in a few large slices, never character by character.
  const token = /"|-?Infinity|NaN/g;
  const parts: string[] = [];
  let copied = 0;
  for (let match = token.exec(source); match !== null; match = token.exec(source)) {
    if (match[0] === '"') {
      let end = match.index + 1;
      while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
      token.lastIndex = end + 1;
    } else {
      parts.push(source.slice(copied, match.index), `"${match[0]}"`);
      copied = token.lastIndex;
    }
  }
  if (copied === 0) return source;
  parts.push(source.slice(copied));
  return parts.join('');
}

// Anchored to a line feed only: a JSON string may hold a raw U+2028, which a /m "^" would also match after.
const CHANGES_LINE = /(?<![^\n])changes: +\d+ +total_changes: +(\d+)\n?/g;

/**
 * Takes out the lines the shell prints after each statement with ".changes on". They cannot be
 * mistaken for rows: JSON output has no line that starts with a bare word.
 */
export function takeChanges(stdout: string): { text: string; total: number | undefined } {
  let total: number | undefined;
  const text = stdout.replace(CHANGES_LINE, (_line, count: string) => {
    total = Number(count);
    return '';
  });
  return { text, total };
}

export function parseResultSets(text: string, options: { nonFinite?: boolean } = {}): ResultSet[] {
  return splitJsonValues(text).map((value) => {
    const source = options.nonFinite ? quoteNonFinite(value) : value;
    const rows: unknown = (JSON.parse as (text: string, reviver: typeof exactNumbers) => unknown)(source, exactNumbers);
    if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) {
      throw new SyntaxError('expected an array of row objects');
    }
    const typed = rows as Record<string, unknown>[];
    return { columns: firstRowKeys(source), rows: typed, rowCount: typed.length };
  });
}
