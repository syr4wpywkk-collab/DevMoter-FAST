# GEOMEAN

`GEOMEAN(number1, [number2], ...)` — geometric mean
`(Π x_i)^(1/n)` of positive numbers; implemented stably as
`EXP(AVERAGE(LN(x_i)))`.

## Arguments / Coercion
- 1..255 args; ranges ignore text/logical/blank; direct scalars coerce
  like `AVERAGE`; errors propagate.

## Errors
- Any included value `<= 0` -> `#NUM!` (documented: data point <= 0).
- No numeric values -> `#DIV/0!`? — **confirm** (likely `#DIV/0!`
  like `AVERAGE`, or `#NUM!`).

## Examples
- `GEOMEAN(4,5,8,7,11,4,3)` -> `5.476986969656962`
- `GEOMEAN(1.2,1.5,1.8)` -> `1.4803576174574004`
- `GEOMEAN(2,8)` -> `4`
- `GEOMEAN(1,-1,1)` -> `#NUM!`
- `GEOMEAN(0,5)` -> `#NUM!`

## Compatibility
- All Excel versions.

## Open questions
- Empty-input error kind.
- Whether zeros inside ranges also `#NUM!` (expected yes).
