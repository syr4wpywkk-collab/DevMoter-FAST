# GAMMAINV

`GAMMAINV(probability, alpha, beta)` — inverse of the cumulative
gamma distribution: `x` with `GAMMADIST(x, alpha, beta, TRUE) =
probability`.

Legacy compatibility function; modern equivalent is `GAMMA.INV`.

## Arguments
- `probability`: required scalar in `[0, 1]`.
- `alpha`, `beta`: required parameters, `> 0`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- Iterative inversion of `P(alpha, x/beta)`; Excel refines to within
  ~3e-7 over up to ~100 iterations.

## Errors
- `probability < 0` or `> 1`, `alpha <= 0`, `beta <= 0` -> `#NUM!`.
- Non-convergence -> `#N/A`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Incomplete gamma + solver (shared with `GAMMADIST`/`CHIINV`).

## Examples
- `GAMMAINV(0.068094, 9, 2)` -> `10.0000112` (Microsoft docs
  example, approximate)
- `GAMMAINV(0.632120559, 1, 1)` -> `1` (within tolerance)
- `GAMMAINV(0, 9, 2)` -> `0` (CDF(0)=0 — confirm)
- `GAMMAINV(1.5, 9, 2)` -> `#NUM!`

## Open questions
- `probability = 0` and `probability = 1` boundary results —
  confirm.
