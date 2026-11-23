# NORMINV

`NORMINV(probability, mean, standard_dev)` — inverse of the normal
CDF: `x` with `NORMDIST(x, mean, standard_dev, TRUE) =
probability`.

Legacy compatibility function; modern equivalent is `NORM.INV`.

## Arguments
- `probability`: required scalar in `(0, 1)`.
- `mean`: required distribution mean.
- `standard_dev`: required, `> 0`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- `NORMINV(p, m, s) = m + s * NORMSINV(p)`. Computed iteratively
  in Excel (refines to ~3e-7).

## Errors
- `probability <= 0` or `probability >= 1` -> `#NUM!`.
- `standard_dev <= 0` -> `#NUM!`.
- Non-convergence -> `#N/A`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- `NORMSINV` numerics + iterative refinement.

## Examples
- `NORMINV(0.908789, 40, 1.5)` -> `42.000002` (Microsoft docs
  example, approximate)
- `NORMINV(0.5, 40, 1.5)` -> `40`
- `NORMINV(0.975, 0, 1)` -> `1.9599640`
- `NORMINV(0, 40, 1.5)` -> `#NUM!`

## Open questions
- Exact iteration count and tolerance vs `NORMSINV`'s rational
  approximation — record in fixtures.
