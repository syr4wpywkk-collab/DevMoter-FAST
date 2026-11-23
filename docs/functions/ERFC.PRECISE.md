# ERFC.PRECISE

`ERFC.PRECISE(x)` — returns the complementary error function
`erfc(x) = 1 - erf(x)`.

## Arguments
- `x`: required numeric.

## Semantics
- Identical to `ERFC(x)`; `.PRECISE` marks the Excel 2010+
  implementation. Range `(0, 2)`, decreasing.

## Errors
- Non-numeric `x` -> `#VALUE!`.

## Examples
- `ERFC.PRECISE(1)` = `0.157299` (approx `0.1572992071`)
- `ERFC.PRECISE(0)` = `1`
- `ERFC.PRECISE(2)` = `0.004678` (approx `0.0046777350`)

## Compatibility notes
- Excel 2010+.

## Engine requirements
- Shares erf/erfc numeric kernel with `ERF`/`ERFC`.

## Open questions
- None identified.
