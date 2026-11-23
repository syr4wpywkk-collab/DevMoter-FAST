# CHIINV

`CHIINV(probability, deg_freedom)` — inverse of the right-tailed
chi-squared distribution: returns `x` with `CHIDIST(x, df) =
probability`.

Legacy compatibility function; modern equivalent is `CHISQ.INV.RT`.

## Arguments
- `probability`: required scalar in `[0, 1]`.
- `deg_freedom`: required; truncated to integer.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- Iterative inversion of the chi-squared upper tail (Excel refines
  until the tail term is within ~3e-7, up to ~100 iterations per
  Microsoft documentation).

## Errors
- `probability < 0` or `> 1` -> `#NUM!`.
- `deg_freedom < 1` -> `#NUM!`.
- Non-convergence after the iteration limit -> `#N/A`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Regularized incomplete gamma function plus an iterative solver;
  convergence bound must be documented.

## Examples
- `CHIINV(0.05, 2)` -> `5.991464547107979` (within tolerance)
- `CHIINV(0.05, 10)` -> `18.307` (within tolerance)
- `CHIINV(0, 5)` -> `+inf`-scale value — **SPEC-OPEN** (see below)
- `CHIINV(1.5, 2)` -> `#NUM!`

## Open questions
- Excel result for `probability = 0` (`#NUM!` vs a very large
  number) — confirm.
- Whether `deg_freedom >= 10^10` errors like `CHIDIST` — confirm.
