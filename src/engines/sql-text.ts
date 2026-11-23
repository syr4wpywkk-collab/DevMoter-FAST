// Reads just enough of an SQL text to tell where its statements end: comments,
// quoted text and identifiers are skipped as units. It does not check the SQL.

export interface SqlShape {
  /** Number of statements: the parts between top-level ";" that hold anything but blanks and comments. */
  statements: number;
  /** First word of the first statement in upper case ("SELECT", "EXPLAIN"), or "" when it does not start with a word. */
  firstKeyword: string;
}

const WORD_START = /[A-Za-z_\u0080-\uffff]/;
const WORD = /[A-Za-z0-9_$\u0080-\uffff]*/y;
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

export function sqlShape(sql: string): SqlShape {
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
      index += 1;
    } else if (/\s/.test(char)) {
      index += 1;
    } else if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith('/*', index)) {
      index = skipBlockComment(sql, index);
    } else if (char === "'" || char === '"') {
      content();
      index = skipQuoted(sql, index, char, false);
    } else if (char === '$' && ((DOLLAR_TAG.lastIndex = index), DOLLAR_TAG.test(sql))) {
      content();
      const tag = sql.slice(index, DOLLAR_TAG.lastIndex);
      const end = sql.indexOf(tag, DOLLAR_TAG.lastIndex);
      index = end === -1 ? sql.length : end + tag.length;
    } else if (WORD_START.test(char)) {
      WORD.lastIndex = index;
      WORD.test(sql);
      const word = sql.slice(index, WORD.lastIndex);
      if (firstKeyword === undefined) firstKeyword = word.toUpperCase();
      content();
      index = WORD.lastIndex;
      // E'...' is the one string form in which a backslash escapes the quote.
      if ((word === 'e' || word === 'E') && sql[index] === "'") index = skipQuoted(sql, index, "'", true);
    } else {
      content();
      index += 1;
    }
  }
  return { statements, firstKeyword: firstKeyword ?? '' };
}
