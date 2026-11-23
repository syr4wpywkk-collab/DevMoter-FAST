# DELTA

`DELTA(number1, [number2])` — Kronecker delta: `1` if the two numbers
are equal, else `0`.

## Arguments
- `number1`: required numeric.
- `number2`: optional numeric; default `0`.

## Semantics
- Numeric equality test returning `1` or `0`. Commonly used to count
  matching pairs in `SUMPRODUCT`.

## Coercion
- Non-numeric text -> `#VALUE!`.
- Boolean/blank coercion per standard numeric rules (blank -> `0`,
  `TRUE` -> `1` — confirm).

## Errors
- Non-numeric `number1` or `number2` -> `#VALUE!`.

## Examples
- `DELTA(5, 4)` = `0`
- `DELTA(5, 5)` = `1`
- `DELTA(0.5, 0)` = `0`
- `DELTA(0)` = `1` (`number2` defaults to `0`)
- `DELTA("x", 0)` -> `#VALUE!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Open questions
- Text-vs-number equality: does `DELTA("5", 5)` coerce `"5"` to `5`
  (expected: yes, then `1`) or `#VALUE!`? Confirm.
- Floating-point equality tolerance — exact IEEE compare assumed.
