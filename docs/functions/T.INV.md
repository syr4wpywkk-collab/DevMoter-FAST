# T.INV

`T.INV(probability, deg_freedom)` — inverse of the **left-tailed**
t CDF. Excel 2010+; legacy `TINV` was the two-tailed inverse —
different function, do not alias.

## Arguments
- `probability`: required; `0 < p < 1`, else `#NUM!`.
- `deg_freedom`: required; `>= 1`, else `#NUM!` (truncated? confirm).

## Semantics
- Returns `x` with `P(T <= x) = p` for T ~ t_df.
- `T.INV(0.5, df) = 0` (enforce symmetry); `T.INV(1-p, df) =
  -T.INV(p, df)`.
- Typically bisection/Newton on the t-CDF — record iteration/tolerance.

## Errors
- `p <= 0` or `p >= 1` -> `#NUM!`; `df < 1` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `T.INV(0.054645, 60)` -> `-1.96` approx (doc example: `T.INV(0.054645,60)`
  = `-1.959999998`).
- `T.INV(0.95, 10)` -> `1.812461...` (t_{0.05,10} one-sided).
- `T.INV(0.5, 5)` -> `0`.

## Open questions
- df truncation; tail precision for p near 0/1.

## Engine requirements
- Root-finding over shared t-CDF (`T.DIST`) or dedicated inverse-beta
  routine.
