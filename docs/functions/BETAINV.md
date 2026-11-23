# BETAINV

`BETAINV(probability, alpha, beta, [A], [B])` — inverse of the
cumulative beta distribution: returns `x` such that
`BETADIST(x, alpha, beta, A, B) = probability`.

Legacy compatibility function; modern equivalent is `BETA.INV`.

## Arguments
- `probability`: required scalar in `[0, 1]`.
- `alpha`, `beta`: required shape parameters.
- `A`: optional lower bound; default `0`.
- `B`: optional upper bound; default `1`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `BETAINV(p, a, b, A, B) = A + (B - A) * I^{-1}(p, a, b)` where
  `I^{-1}` inverts the regularized incomplete beta function.
- Computed iteratively in Excel; result is approximate.

## Errors
- `probability < 0` or `> 1`, `alpha <= 0`, `beta <= 0`, or `A = B`
  -> `#NUM!`.
- Iteration fails to converge -> `#N/A` (documented Excel behavior
  for inverse-distribution functions).
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Inverse of the regularized incomplete beta function (root-finding
  over `I_x`). Same numerics requirement as `BETADIST`.

## Examples
- `BETAINV(0.5, 2, 2)` -> `0.5`
- `BETAINV(0.84375, 2, 2)` -> `0.75` (within iteration tolerance)
- `BETAINV(0.68256, 2, 3, 5, 10)` -> `8` (within tolerance)
- `BETAINV(1.5, 2, 2)` -> `#NUM!`

## Open questions
- Iteration count / convergence criterion to match Excel's
  precision (Excel uses up to ~100 iterations) — record in fixtures.
