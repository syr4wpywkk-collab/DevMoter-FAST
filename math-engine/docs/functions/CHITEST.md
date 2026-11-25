# CHITEST

`CHITEST(actual_range, expected_range)` — chi-squared test for
independence; returns the probability that a chi-squared statistic
at least as extreme could occur under the independence hypothesis.

Legacy compatibility function; modern equivalent is `CHISQ.TEST`.

## Arguments
- `actual_range`: required range/array of observed frequencies.
- `expected_range`: required range/array of expected frequencies;
  must have the same dimensions as `actual_range`.

## Coercion
- Range arguments: non-numeric cells are ignored; errors propagate.
  (Same range rules as `CORREL`.)

## Semantics
- `X^2 = sum((A_ij - E_ij)^2 / E_ij)` over all cells.
- Degrees of freedom: `(r-1)*(c-1)` for an `r x c` range; for a 1-D
  range `df = n - 1` (n = number of points).
- Returns `CHIDIST(X^2, df)`.
- `E_ij = 0` at any position -> division by zero inside the sum —
  Excel returns `#DIV/0!` (confirm).

## Errors
- Different numbers of data points in the two ranges -> `#N/A`.
- Any `E_ij = 0` -> `#DIV/0!` (confirm).
- Insufficient data such that `df < 1` -> `#N/A`-class result —
  **SPEC-OPEN** (Excel behavior for a single value pair: df = 0 ->
  result is `1`? — confirm).

## Engine requirements
- Reuses `CHIDIST` numerics (incomplete gamma).

## Examples
- `CHITEST({58,11,10;35,25,23}, {45.35,17.56,16.09;47.65,18.44,
  16.91})` -> `0.000308` (Microsoft docs example, df = 2)
- `CHITEST({10,20},{15,15})` -> `0.176916` (`CHIDIST(1.6667, 1)`)
- `CHITEST({1,2,3},{1,2})` -> `#N/A`

## Open questions
- Single-pair input (`1x1`) result — confirm vs `#DIV/0!`/df edge.
- Handling of blank cells inside ranges (skipped pairwise?).
