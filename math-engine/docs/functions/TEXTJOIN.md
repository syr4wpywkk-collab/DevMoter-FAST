# TEXTJOIN

`TEXTJOIN(delimiter, ignore_empty, text1, [text2], ...)` — joins
multiple strings/ranges with a delimiter.

## Arguments
- `delimiter`: text inserted between items; empty string allowed.
  Numbers are coerced to text.
- `ignore_empty`: boolean. TRUE skips Blank values; FALSE includes them
  as empty strings.
- `text1..`: values or ranges; flattened left-to-right, row-major.

## Behavior
- Ranges and arrays are flattened in row-major order before joining.
- Blank cells: skipped when `ignore_empty` TRUE; produce `""` segment
  (still emitting the delimiter) when FALSE.
- Numbers/booleans are converted to their text form.
- Error values inside inputs propagate as the result.

## Errors
- Errors propagate.
- Result exceeding the engine's text-length limit returns the defined
  overflow error (`#VALUE!` unless a dedicated limit error is chosen —
  see Open questions). Excel's limit is 32,767 chars -> `#CALC!`.

## Edge cases
- `TEXTJOIN(",",TRUE,A1:A5)` skips blanks.
- `TEXTJOIN(" ",TRUE,{"a","","b"})` -> `"a b"`: `""` (empty text) is not
  Blank, so it is kept even with ignore_empty TRUE — verify vs Excel.

## Open questions
- Whether empty-string elements are treated as "empty" for
  `ignore_empty` purposes (Blank vs `Text("")` distinction, plan §3.1).
- Error type for length overflow (`#VALUE!` vs `#CALC!`) and the exact
  limit to adopt (32,767 vs engine text limit).
