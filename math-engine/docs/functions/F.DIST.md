# F.DIST

`F.DIST(x, deg_freedom1, deg_freedom2, cumulative)` — left-tailed F
distribution (ratio of two scaled chi-squared variates).

## Arguments
- `x`: `>= 0`.
- `deg_freedom1`, `deg_freedom2`: `1 <= df <= 10^10`, truncated to
  integer.
- `cumulative`: logical.

## Semantics
- CDF `= I_{df1*x/(df1*x + df2)}(df1/2, df2/2)` (regularized
  incomplete beta).
- PDF from the F density function.

## Errors
- `x < 0` -> `#NUM!`; df out of `[1, 10^10]` -> `#NUM!`; non-numeric
  -> `#VALUE!`.

## Examples
- `F.DIST(15.20686486,6,4,TRUE)` -> `0.99` (approx; F with df 6,4 at
  99th pct ≈ 15.2069)
- `F.DIST(15.20686486,6,4,FALSE)` -> `0.001223799...` (density value —
  fixture must be computed exactly)
- `F.DIST(1,1,1,TRUE)` -> `0.5` (mediated by I_{0.5}(0.5,0.5)=0.5)
- `F.DIST(-1,2,3,TRUE)` -> `#NUM!`
- `F.DIST(1,0,3,TRUE)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `FDIST` is right-tailed only:
  `FDIST(x,a,b) = F.DIST.RT(x,a,b)`.

## Engine requirements
- **Distribution numerics**: regularized incomplete beta + `GAMMALN`.

## Open questions
- Exact df upper bound — confirm `10^10`.
