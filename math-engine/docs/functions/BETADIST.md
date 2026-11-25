# BETADIST

`BETADIST(x, alpha, beta, [A], [B])` — cumulative beta probability
density function evaluated at `x`.

Legacy compatibility function; modern equivalent is `BETA.DIST(x,
alpha, beta, TRUE, [A], [B])` (always cumulative here — no
`cumulative` argument). Kept for pre-2010 workbook compatibility.

## Arguments
- `x`: required scalar; point at which to evaluate. Must lie in
  `[A, B]`.
- `alpha`, `beta`: required scalars; distribution shape parameters.
- `A`: optional lower bound of the interval; default `0`.
- `B`: optional upper bound of the interval; default `1`.

## Coercion
- Scalar arguments: numeric text and booleans are coerced to numbers;
  non-numeric text -> `#VALUE!`. (Direct-argument rules, same split
  as `SUM`.)

## Semantics
- Returns `P(X <= x)` for `X ~ Beta(alpha, beta)` scaled to `[A,B]`,
  i.e. `I((x-A)/(B-A), alpha, beta)` where `I` is the regularized
  incomplete beta function.

## Errors
- `x < A`, `x > B`, `alpha <= 0`, `beta <= 0`, or `A = B` -> `#NUM!`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Requires the regularized incomplete beta function `I_x(a,b)` with
  documented convergence/precision bounds. No external crate
  dependencies in calc-core — implementation must be std-only.

## Examples
- `BETADIST(0.5, 2, 2)` -> `0.5`
- `BETADIST(0.75, 2, 2)` -> `0.84375` (CDF `3x^2 - 2x^3` at 0.75)
- `BETADIST(8, 2, 3, 5, 10)` -> `0.68256` (`I_{0.6}(2,3) = 0.68256`)
- `BETADIST(-0.5, 2, 2)` -> `#NUM!`

## Open questions
- Accepted numerical tolerance vs Excel's implementation — record in
  fixtures.
