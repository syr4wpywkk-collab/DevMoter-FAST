# AVEDEV

`AVEDEV(number1, [number2], ...)` — average of the absolute deviations of
data points from their mean: `AVERAGE(ABS(x - AVERAGE(x)))`.

## Arguments
- `number1, [number2], ...`: 1..255 arguments; numbers, ranges, or
  arrays. At least one numeric value is required.

## Coercion
- Ranges/arrays: only numeric cells are counted; text, logical, and
  blank cells inside ranges are ignored.
- Direct scalar arguments: text that parses as a number is converted;
  `TRUE`/`FALSE` -> `1`/`0`; unparsable text -> `#VALUE!`.
- Error values anywhere propagate.

## Semantics
- Result is in the same units as the input.
- For inputs `{x_i}` with mean `m`: `AVEDEV = SUM(ABS(x_i - m)) / n`.

## Errors
- No numeric values after coercion -> `#DIV/0!` (matches `AVERAGE`).
- Unparsable direct text argument -> `#VALUE!`.

## Examples
- `AVEDEV(4,5,6,7,5,4,3)` -> `1.0204081632653061` (mean 34/7 ≈ 4.857143)
- `AVEDEV({1,2,3})` -> `0.6666666666666666`
- `AVEDEV(A1:A5)` with A1:A5 = {2,4,6,8,10} -> `2.4`
- `AVEDEV("text",A1:A2)` with A1:A2={1,3} -> `#VALUE!`
- `AVEDEV(A1:A3)` with all cells blank -> `#DIV/0!`

## Compatibility
- Available in all modern Excel versions; behavior identical to
  LibreOffice `AVEDEV`.

## Engine requirements
- Numerically: a single-pass or two-pass mean then absolute-deviation
  pass; f64 is sufficient.

## Open questions
- Whether an error *cell inside a range* propagates or is skipped —
  Excel propagates errors in referenced ranges for aggregate
  functions; confirm against reference.
