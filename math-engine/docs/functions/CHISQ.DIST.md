# CHISQ.DIST

`CHISQ.DIST(x, deg_freedom, cumulative)` — left-tailed chi-squared
distribution: PDF or `P(X <= x)`.

## Arguments
- `x`: value at which to evaluate; `x >= 0` (for CDF; negative x ->
  `#NUM!`). Non-numeric -> `#VALUE!`.
- `deg_freedom`: integer degrees of freedom, `1 <= df <= 10^10`
  (truncated if non-integer).
- `cumulative`: logical; `TRUE` -> CDF `P(X <= x)`, `FALSE` -> PDF.

## Semantics
- CDF `= P(df/2, x/2)` (regularized lower incomplete gamma).
- PDF `= x^(df/2 - 1) e^(-x/2) / (2^(df/2) Γ(df/2))`.

## Errors
- `x < 0` -> `#NUM!`.
- `df < 1` or `df > 10^10` -> `#NUM!`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `CHISQ.DIST(0.5,1,TRUE)` -> `0.5204998778130465`
- `CHISQ.DIST(2,3,FALSE)` -> `0.20755374871029736`
- `CHISQ.DIST(18.307,10,TRUE)` -> `0.95000003...` (≈0.95)
- `CHISQ.DIST(-1,3,TRUE)` -> `#NUM!`
- `CHISQ.DIST(2,0,TRUE)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `CHIDIST` returns the *right* tail only:
  `CHIDIST(x,df) = CHISQ.DIST.RT(x,df)`.

## Engine requirements
- **Distribution numerics**: regularized incomplete gamma `P(a,x)`
  (series + continued fraction) and `GAMMALN`; f64 only.

## Open questions
- Exact `df` upper bound (`10^10` per docs) — confirm enforcement.
