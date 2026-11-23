# DEVSQ

`DEVSQ(number1, [number2], ...)` — sum of squared deviations from the
mean: `Σ(x - x̄)²` (= `n * VAR.P`, `(n-1) * VAR.S`).

## Arguments
- `number1, [number2], ...`: 1..255 args; numbers, ranges, arrays.

## Coercion
- Same rules as `AVERAGE`/`AVEDEV`: ranges ignore text/logical/blank;
  direct scalars coerce (`TRUE`->1, numeric text parsed, bad text ->
  `#VALUE!`); errors propagate.

## Errors
- No numeric values -> `#DIV/0!` (**confirm**: Excel returns `#DIV/0!`
  for empty input? flag).
- Non-numeric direct scalar -> `#VALUE!`.

## Examples
- `DEVSQ(4,5,8,7,11,4,3)` -> `48` (mean 6; Σ(x-6)²=48)
- `DEVSQ({1,2,3})` -> `2`
- `DEVSQ(5)` -> `0`
- `DEVSQ(A1:A3)` all blank -> `#DIV/0!` — confirm

## Compatibility
- All Excel versions; identical to legacy behavior.

## Engine requirements
- Two-pass or Welford accumulation for numerical stability; document
  the deviation from naive `Σx² - (Σx)²/n` if used.

## Open questions
- Empty-input error kind.
