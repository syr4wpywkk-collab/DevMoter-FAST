# TRIM

`TRIM(text)` — removes leading and trailing spaces and collapses internal runs of spaces to single spaces.

## Arguments
- `text`: required; coerced to text (rules as `LEFT.md`).

## Behavior
- `TRIM("  a  b  ")` -> `"a b"`.
- Only the ASCII space `U+0020` is removed/collapsed in Excel — tabs,
  newlines, and non-breaking space `U+00A0` are **not** trimmed (Excel
  compatibility; `CLEAN` handles control chars, out of scope).
  **SPEC-OPEN**: confirm Excel does not treat `U+00A0` as trimmable
  (it does not) and document the exact character set as `{U+0020}`.
- Coercion of numbers/booleans happens before trimming.

## Errors
- Error argument propagates.
- Trimming can never produce an error.

## Edge cases
- `TRIM("")` -> `""`; `TRIM("   ")` -> `""`.
- `TRIM` of a blank cell reference -> `""`.
- Internal spacing between words: `"a \t b"` keeps the tab (confirm).

## Open questions
- Exact whitespace set (expected: ASCII space only).
- Behavior on `U+3000` ideographic space and other Unicode spaces
  (expected: not trimmed).
