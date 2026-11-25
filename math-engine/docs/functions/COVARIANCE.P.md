# COVARIANCE.P

`COVARIANCE.P(array1, array2)` — population covariance:
`Σ((x - x̄)(y - ȳ)) / n` over paired numeric values.

## Arguments
- `array1`, `array2`: ranges/arrays of equal size.

## Coercion
- Only cells where *both* positions are numeric form a pair; text,
  logical, and blank cells cause the pair to be skipped — **confirm**
  (Excel documentation: pairs containing non-numeric data are
  ignored).
- Error cells propagate.
- Direct scalar/array constants: numeric elements only.

## Errors
- Arrays of different sizes -> `#N/A`.
- No numeric pairs -> `#DIV/0!`.
- Non-numeric scalar args -> `#VALUE!`.

## Examples
- `COVARIANCE.P({2,4,8},{6,12,18})` -> `9.333333333333334`
  (x̄=14/3, ȳ=12; Σ(x-x̄)(y-ȳ)=28; /3)
- `COVARIANCE.P({1,2,3},{1,2,3})` -> `0.6666666666666666` (variance P)
- `COVARIANCE.P({1,2},{5,5})` -> `0`
- `COVARIANCE.P({1,2},{1,2,3})` -> `#N/A`
- `COVARIANCE.P({"a"},{"b"})` -> `#DIV/0!`

## Compatibility
- Excel 2010+. Legacy `COVAR` (same semantics — population version).

## Open questions
- Pair-skip rules for mixed-type ranges (expected: skip pair when
  either side non-numeric).
