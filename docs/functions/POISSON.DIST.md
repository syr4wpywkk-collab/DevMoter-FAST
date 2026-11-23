# POISSON.DIST

`POISSON.DIST(x, mean, cumulative)` — Poisson distribution. Excel
2010+; legacy `POISSON`.

## Arguments
- `x`: required; event count, truncated to integer; `< 0` -> `#NUM!`.
- `mean`: required; expected value; `<= 0`? docs say nonpositive ->
  `#NUM!` (`mean = 0` errors — confirm; mathematically degenerate).
- `cumulative`: required boolean; `TRUE` = CDF `P(X <= x)`, `FALSE` =
  PMF `P(X = x)`.

## Semantics
- PMF: `e^-mean * mean^x / x!`.
- CDF: sum `k=0..x` of PMF; numerically should use the incomplete-gamma
  relation for stability at large mean/x.
- Excel's legacy implementation loses precision for large `mean`
  (documented KB anomaly) — record tolerance.

## Errors
- `x < 0` -> `#NUM!`; `mean <= 0` -> `#NUM!` (confirm `mean=0`).
- Non-numeric -> `#VALUE!`; errors propagate.

## Examples
- `POISSON.DIST(2, 5, FALSE)` -> `0.084224337...` (Excel doc:
  `0.084224`).
- `POISSON.DIST(2, 5, TRUE)` -> `0.124652019...` (Excel doc:
  `0.124652`).
- `POISSON.DIST(0, 1, FALSE)` -> `e^-1 = 0.367879441`.
- `POISSON.DIST(0, 1, TRUE)` -> `0.367879441`.

## Open questions
- `mean = 0` behavior (`#NUM!` per docs — verify).
- Truncation of non-integer `x` (documented; confirm same floor rule
  as BINOM).
- Large-mean accuracy target.

## Engine requirements
- Needs log-gamma / incomplete-gamma or stable summation in
  `calc-core` (std only).
