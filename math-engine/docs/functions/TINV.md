# TINV

`TINV(probability, deg_freedom)` — inverse of the **two-tailed**
t-distribution: returns `x` with `TDIST(x, df, 2) = probability`.

Legacy compatibility function; modern equivalent is `T.INV.2T`
(identical). Note `T.INV` is the left-tailed inverse — a different
function: `TINV(p, v) = T.INV(1 - p/2, v)`.

## Arguments
- `probability`: required scalar; docs state `0 < p <= 1`
  (`probability <= 0` or `> 1` -> `#NUM!`; `p = 1` -> `0`).
- `deg_freedom`: required; truncated, `>= 1`.

## Coercion
- Scalars: numeric text and booleans coerced; non-numeric text ->
  `#VALUE!`.

## Semantics
- Iterative inversion; Excel refines to within ~3e-7.

## Errors
- `probability <= 0` or `probability > 1` -> `#NUM!`.
- `deg_freedom < 1` -> `#NUM!`.
- Non-convergence -> `#N/A`.
- Non-numeric argument -> `#VALUE!`.

## Engine requirements
- Incomplete beta + solver (shared with `FINV`/`BETAINV`).

## Examples
- `TINV(0.05, 10)` -> `2.228139` (standard t-table value)
- `TINV(0.054645, 60)` -> `1.959999998` (approx, paired with
  `TDIST` docs example)
- `TINV(1, 10)` -> `0`
- `TINV(0, 10)` -> `#NUM!`

## Open questions
- `probability = 1` boundary (`0` expected — confirm).
