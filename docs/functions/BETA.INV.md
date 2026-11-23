# BETA.INV

`BETA.INV(probability, alpha, beta, [A], [B])` — inverse of the beta
CDF: returns `x` such that `BETA.DIST(x, alpha, beta, TRUE, A, B) =
probability`.

## Arguments
- `probability`: required; `0 <= p <= 1`.
- `alpha`, `beta`: required; both `> 0`.
- `A`, `B`: optional bounds; defaults `0`, `1`; result scaled back to
  `[A,B]`.

## Errors
- `alpha <= 0` or `beta <= 0` -> `#NUM!`.
- `p < 0` or `p > 1` -> `#NUM!`.
- `A = B` -> `#NUM!` (**confirm** — same constraint as `BETA.DIST`).
- Non-numeric args -> `#VALUE!`.

## Semantics
- Solved iteratively (bisection/Newton) on the incomplete beta
  function; Excel converges to ~1e-7-style precision — implementation
  tolerance is a fixture detail.
- `p = 0` -> `A`; `p = 1` -> `B` (boundary behavior — confirm for
  `alpha<1`/`beta<1`).

## Examples
- `BETA.INV(0.6854705810117458,8,10,1,3)` -> `2` (round-trip of the
  `BETA.DIST` example)
- `BETA.INV(0.5,2,2)` -> `0.5` (symmetric distribution)
- `BETA.INV(0.6875,2,3)` -> `0.5`
- `BETA.INV(-0.1,2,3)` -> `#NUM!`

## Compatibility
- Excel 2010+. Legacy `BETAINV`.

## Engine requirements
- **Distribution numerics**: incomplete beta inverse via iterative
  solver over `I_x(a,b)`; f64 only.

## Open questions
- Solver tolerance and iteration cap needed to match Excel fixtures.
- `p` boundary values and degenerate shapes (`alpha` or `beta` < 1).
