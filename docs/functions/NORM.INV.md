# NORM.INV

`NORM.INV(probability, mean, standard_dev)` — inverse of the normal
CDF. Excel 2010+; legacy `NORMINV`.

## Arguments
- `probability`: required; `0 < p < 1`, else `#NUM!`.
- `mean`: required.
- `standard_dev`: required; `> 0`, else `#NUM!`.

## Semantics
- `NORM.INV(p, mu, sigma) = mu + sigma * NORM.S.INV(p)`.
- Round-trips with `NORM.DIST(..., TRUE)` within FP tolerance.
- Excel's implementation is an iterative refinement over its CDF
  approximation — precision ~`NORM.S.INV`'s (see that spec); Open
  question on required agreement.

## Errors
- `p <= 0` or `p >= 1` -> `#NUM!`.
- `sigma <= 0` -> `#NUM!`.
- Non-numeric -> `#VALUE!`.

## Examples
- `NORM.INV(0.908789, 40, 1.5)` -> `~42.0000` (doc example).
- `NORM.INV(0.5, 40, 1.5)` -> `40`.
- `NORM.INV(0.975, 0, 1)` -> `~1.9599640` (matches `NORM.S.INV`).

## Open questions
- Endpoint handling (exact `0`/`1`: `#NUM!` documented).
- Tail accuracy for p near 0/1.

## Engine requirements
- Shared inverse-normal (rational approximation a la Acklam) in
  `calc-core`.
