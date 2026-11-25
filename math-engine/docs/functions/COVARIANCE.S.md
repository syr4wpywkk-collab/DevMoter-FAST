# COVARIANCE.S

`COVARIANCE.S(array1, array2)` — sample covariance:
`Σ((x - x̄)(y - ȳ)) / (n - 1)`.

## Arguments / Coercion / Errors
- Identical to `COVARIANCE.P`, plus: fewer than 2 numeric pairs ->
  `#DIV/0!`.

## Examples
- `COVARIANCE.S({2,4,8},{6,12,18})` -> `14` (28/2)
- `COVARIANCE.S({1,2,3},{1,2,3})` -> `1` (sample variance of {1,2,3})
- `COVARIANCE.S({1,2,3,4},{2,4,5,8})` -> `3.3333333333333335`
  (x̄=2.5,ȳ=4.75; Σ=10; /3)
- `COVARIANCE.S({5},{5})` -> `#DIV/0!`
- `COVARIANCE.S({1,2},{1,2,3})` -> `#N/A`

## Compatibility
- Excel 2010+. No legacy equivalent (`COVAR` is population).

## Open questions
- Same pair-skip rules as `COVARIANCE.P`.
