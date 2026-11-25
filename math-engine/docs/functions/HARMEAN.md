# HARMEAN

`HARMEAN(number1, [number2], ...)` — harmonic mean
`n / Σ(1/x_i)` of positive numbers.

## Arguments / Coercion
- Same as `GEOMEAN`/`AVERAGE`: ranges ignore text/logical/blank;
  direct scalars coerce; errors propagate.

## Errors
- Any included value `<= 0` -> `#NUM!` (documented: data point <= 0
  returns `#NUM!`).
- No numeric values -> `#DIV/0!`? — **confirm** (same question as
  `GEOMEAN`).

## Examples
- `HARMEAN(4,5,8,7,11,4,3)` -> `5.028375962061728`
- `HARMEAN(1,2,4)` -> `1.7142857142857142` (12/7)
- `HARMEAN(10,20)` -> `13.333333333333334`
- `HARMEAN(5,0)` -> `#NUM!`
- `HARMEAN(-1,1)` -> `#NUM!`

## Compatibility
- All Excel versions.

## Open questions
- Empty-input error kind.
