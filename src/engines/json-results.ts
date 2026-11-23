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

export function parseResultSets(text: string): ResultSet[] {
  return splitJsonValues(text).map((source) => {
    const rows: unknown = (JSON.parse as (text: string, reviver: typeof exactNumbers) => unknown)(source, exactNumbers);
    if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) {
      throw new SyntaxError('expected an array of row objects');
    }
    const typed = rows as Record<string, unknown>[];
    return { columns: typed[0] ? Object.keys(typed[0]) : [], rows: typed, rowCount: typed.length };
  });
}
