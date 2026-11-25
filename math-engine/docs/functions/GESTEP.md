# GESTEP

`GESTEP(number, [step])` — returns `1` if `number >= step`, else `0`
("Greater than or Equal STEP").

## Arguments
- `number`: required numeric; value to test.
- `step`: optional numeric threshold; default `0`.

## Semantics
- Scalar `1`/`0`. Typical use: `SUM` of `GESTEP` over a vector counts
  values meeting a threshold.

## Coercion / errors
- Non-numeric `number` or `step` -> `#VALUE!`.
- Blank -> `0`; booleans coerce per standard rules (confirm).

## Examples
- `GESTEP(5, 4)` = `1`
- `GESTEP(5, 5)` = `1`
- `GESTEP(-4, -5)` = `1`
- `GESTEP(-1)` = `0` (step defaults to `0`)
- `GESTEP("x", 1)` -> `#VALUE!`

## Compatibility notes
- Excel 2003+ (ATP earlier).

## Open questions
- Numeric-text coercion of `"5"` — expected yes; confirm.
- Blank `step` -> `0` (confirm).
