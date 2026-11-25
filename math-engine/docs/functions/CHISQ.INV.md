# CHISQ.INV

`CHISQ.INV(probability, deg_freedom)` — inverse of the left-tailed
chi-squared CDF: `x` with `P(X <= x) = probability`.

## Arguments
- `probability`: `0 <= p <= 1`; `p = 0` -> `0`, `p = 1` -> `+∞`?
  Excel returns `#NUM!` for `p = 1`? — **confirm boundary**.
- `deg_freedom`: `1 <= df <= 10^10`, truncated.

## Errors
- `p < 0` or `p > 1` -> `#NUM!`; `df` out of range -> `#NUM!`;
  non-numeric -> `#VALUE!`.

## Semantics
- Iterative inversion of `P(df/2, x/2)` (Newton/bisection with
  Wilson–Hilferty initial guess).

## Examples
- `CHISQ.INV(0.05,10)` -> `3.9402991365242097` (approx; χ²₀.₀₅,₁₀ =
  3.9403)
- `CHISQ.INV(0.95,10)` -> `18.307038053275146` (approx; χ²₀.₉₅,₁₀ =
  18.307)
- `CHISQ.INV(0.5204998778130465,1)` -> `0.5` (round-trip)
- `CHISQ.INV(-0.1,5)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `CHIINV` is the *right*-tail inverse:
  `CHIINV(p,df) = CHISQ.INV.RT(p,df)`.

## Engine requirements
- **Distribution numerics**: incomplete gamma + root solver.

## Open questions
- `p` exactly 0 or 1 results.
- Solver tolerance for golden fixtures.
