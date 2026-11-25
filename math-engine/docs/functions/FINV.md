# FINV

`FINV(probability, deg_freedom1, deg_freedom2)` — inverse of the
right-tailed F distribution: returns `x` with `FDIST(x, v1, v2) =
probability`.

Legacy compatibility function; modern equivalent is `F.INV.RT`.

## Arguments
- `probability`: required scalar in `[0, 1]`.
- `deg_freedom1`, `deg_freedom2`: required; truncated to integers.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- Iterative inversion of `FDIST`; Excel refines to within ~3e-7 over
  up to ~100 iterations.

## Errors
- `probability < 0` or `> 1` -> `#NUM!`.
- `deg_freedom1 < 1` or `>= 10^10` (same for df2) -> `#NUM!`.
- Non-convergence -> `#N/A`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Incomplete beta function + iterative solver.

## Examples
- `FINV(0.01, 6, 4)` -> `15.20686486` (within tolerance)
- `FINV(0.100438, 2, 5)` -> `4.0` (within tolerance)
- `FINV(0.5, 1, 1)` -> `1` (F(1,1) median is 1)
- `FINV(2, 5, 5)` -> `#NUM!`

## Open questions
- `probability = 0` result — confirm vs `#NUM!`.
