// Parses the JSON that the engine shells print: one top-level array of row
// objects per statement, written back to back.

import type { ResultSet } from './types.ts';

/** Integers that a JavaScript number cannot hold exactly are returned as strings, not rounded. */
function exactNumbers(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value === 'number' && !Number.isSafeInteger(value) && context?.source !== undefined && /^-?\d+$/.test(context.source)) {
    return context.source;
  }
  return value;
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
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      let end = index + 1;
      while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
      out += source.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    const match = /^(?:-?Infinity|NaN)/.exec(source.slice(index, index + 9));
    if (match) {
      out += `"${match[0]}"`;
      index += match[0].length;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
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
