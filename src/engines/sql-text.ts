// Reads just enough of an SQL text to tell where its statements end: comments,
// quoted text and identifiers are skipped as units. It does not check the SQL.

export interface SqlShape {
  /** Number of statements: the parts between top-level ";" that hold anything but blanks and comments. */
  statements: number;
  /** First word of the first statement in upper case ("SELECT", "EXPLAIN"), or "" when it does not start with a word. */
  firstKeyword: string;
}

export interface SqlDialect {
  /**
   * The engine reads these characters beyond ASCII as blank space (DuckDB does for the
   * no-break space and its like); elsewhere they are part of a word.
   */
  blanks?: RegExp;
}

/** What DuckDB's parser turns into a plain space before it reads the text. */
export const DUCKDB_SQL: SqlDialect = { blanks: /[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]/ };

const WORD_START = /[A-Za-z_\u0080-\uffff]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;

/** Index just after the quoted text that opens at `start`; the end of the text when it is not closed. */
function skipQuoted(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
  let index = start + 1;
  while (index < sql.length) {
    const char = sql[index];
    if (backslashEscapes && char === '\\') index += 2;
    else if (char !== quote) index += 1;
    else if (sql[index + 1] === quote) index += 2;
    else return index + 1;
  }
  return sql.length;
}

function skipBlockComment(sql: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < sql.length) {
    if (sql.startsWith('/*', index)) {
      depth += 1;
      index += 2;
    } else if (sql.startsWith('*/', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else index += 1;
  }
  return sql.length;
}

/** Index just after the word that starts at `start`. */
function skipWord(sql: string, start: number, blanks: RegExp | undefined): number {
  let index = start;
  while (index < sql.length) {
    const char = sql[index] as string;
    if (!/[A-Za-z0-9_$\u0080-\uffff]/.test(char) || blanks?.test(char)) break;
    index += 1;
  }
  return index;
}

/**
 * `onToken`, when given, is called for each piece outside comments in order: a word as written,
 * the opening character of quoted or dollar-quoted text, or any other single character (";" included).
 */
export function sqlShape(sql: string, dialect: SqlDialect = {}, onToken?: (token: string) => void): SqlShape {
  const { blanks } = dialect;
  let statements = 0;
  let firstKeyword: string | undefined;
  let open = false; // the current statement has content
  let index = 0;
  const content = () => {
    if (!open) statements += 1;
    open = true;
    firstKeyword ??= '';
  };
  while (index < sql.length) {
    const char = sql[index] as string;
    if (char === ';') {
      open = false;
      onToken?.(char);
      index += 1;
    } else if (/\s/.test(char) && char <= ' ') {
      index += 1;
    } else if (blanks?.test(char)) {
      index += 1;
    } else if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith('/*', index)) {
      index = skipBlockComment(sql, index);
    } else if (char === "'" || char === '"') {
      content();
      onToken?.(char);
      index = skipQuoted(sql, index, char, false);
    } else if (char === '$' && ((DOLLAR_TAG.lastIndex = index), DOLLAR_TAG.test(sql))) {
      content();
      onToken?.(char);
      const tag = sql.slice(index, DOLLAR_TAG.lastIndex);
      const end = sql.indexOf(tag, DOLLAR_TAG.lastIndex);
      index = end === -1 ? sql.length : end + tag.length;
    } else if (WORD_START.test(char)) {
      const end = skipWord(sql, index, blanks);
      const word = sql.slice(index, end);
      if (firstKeyword === undefined) firstKeyword = word.toUpperCase();
      content();
      onToken?.(word);
      index = end;
      // E'...' is the one string form in which a backslash escapes the quote.
      if ((word === 'e' || word === 'E') && sql[index] === "'") index = skipQuoted(sql, index, "'", true);
    } else {
      content();
      onToken?.(char);
      index += 1;
    }
  }
  return { statements, firstKeyword: firstKeyword ?? '' };
}
