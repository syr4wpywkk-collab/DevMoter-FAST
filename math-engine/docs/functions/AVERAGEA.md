# AVERAGEA

`AVERAGEA(value1, [value2], ...)` — arithmetic mean where text and
logical values are counted as numbers (`TRUE`=1, `FALSE`=0, text=0),
unlike `AVERAGE` which ignores them in ranges.

## Arguments
- `value1, [value2], ...`: 1..255 arguments; values, ranges, or arrays.

## Coercion
- Ranges/arrays: numeric cells count at face value; `TRUE`->`1`,
  `FALSE`->`0`, text (including `""`)->`0`; truly empty cells are
  **skipped** (not counted in the denominator).
- Direct scalar arguments: booleans -> `1`/`0`; text that parses as a
  number is converted (**SPEC-OPEN**: confirm; for `AVERAGEA` Excel may
  treat direct text as 0 rather than parsing — flag for reference
  test).
- Error values propagate.

## Semantics
- `AVERAGEA = SUM(effective values) / COUNT(effective values)` where
  effective values include zero-contributions from text/booleans.

## Errors
- No countable values (all arguments blank/empty ranges) -> `#DIV/0!`.
- Errors inside inputs propagate.

## Examples
- `AVERAGEA(1,2,3)` -> `2`
- `AVERAGEA(A1:A4)` with A1:A4 = {10, "text", TRUE, <blank>} ->
  `11/3 = 3.6666666666666665` (10+0+1 over 3 cells)
- `AVERAGEA(TRUE,FALSE)` -> `0.5`
- `AVERAGEA(A1:A2)` both blank -> `#DIV/0!`

## Compatibility
- Differs from `AVERAGE` only in the treatment of text/booleans inside
  referenced ranges.

## Open questions
- Direct text argument coercion: parseable text converted vs counted
  as 0 — flag for reference test.
- Empty-string cell: treated as text (0, counted) — confirm.
