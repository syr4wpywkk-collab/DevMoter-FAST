# EXPON.DIST

`EXPON.DIST(x, lambda, cumulative)` — exponential distribution PDF
`lambda * e^(-lambda x)` or CDF `1 - e^(-lambda x)`.

## Arguments
- `x`: `>= 0`.
- `lambda`: rate parameter; `> 0`.
- `cumulative`: logical.

## Errors
- `x < 0` -> `#NUM!`; `lambda <= 0` -> `#NUM!`; non-numeric ->
  `#VALUE!`.

## Examples
- `EXPON.DIST(0.2,10,TRUE)` -> `0.8646647167633873`
- `EXPON.DIST(0.2,10,FALSE)` -> `1.353352832366127`
- `EXPON.DIST(0,1,FALSE)` -> `1`
- `EXPON.DIST(-1,1,TRUE)` -> `#NUM!`
- `EXPON.DIST(1,0,TRUE)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `EXPONDIST` (identical signature).

## Engine requirements
- `e^x` only — no special numerics.

## Open questions
- None.
