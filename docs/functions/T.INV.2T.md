# T.INV.2T

`T.INV.2T(probability, deg_freedom)` — inverse of the **two-tailed**
t distribution: returns `x` with `P(|T| >= x) = p`. Excel 2010+;
this is the modern equivalent of legacy `TINV(p, df)`.

## Arguments
- `probability`: required; `0 < p < 1`? — docs say p outside `(0,1]`
  errors; `p = 1` -> `0`? or `#NUM!`? (confirm; mathematically p=1 ->
  x=0). Likely `0 < p <= 1`, else `#NUM!`.
- `deg_freedom`: required; `>= 1` else `#NUM!`.

## Semantics
- `T.INV.2T(p, df) = T.INV(1 - p/2, df)` — always returns the positive
  quantile.

## Errors
- `p <= 0` or `p > 1` -> `#NUM!` (boundary at p=1 confirm).
- `df < 1` -> `#NUM!`; non-numeric -> `#VALUE!`.

## Examples
- `T.INV.2T(0.05, 10)` -> `2.2281389` (t_{0.025,10}).
- `T.INV.2T(0.54644930, 60)` -> `0.606533076` (Excel doc example
  `T.INV.2T(0.546449,60) = 0.606533`).
- `T.INV.2T(1, 10)` -> `0`? (confirm).

## Open questions
- `p = 1` boundary (`0` vs `#NUM!`).
- df truncation.

## Engine requirements
- Shared t-quantile routine with `T.INV`.
