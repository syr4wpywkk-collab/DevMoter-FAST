# NORM.S.INV

`NORM.S.INV(probability)` — inverse of the standard normal CDF.
Excel 2010+; legacy `NORMSINV`.

## Arguments
- `probability`: required; `0 < p < 1`, else `#NUM!`.

## Semantics
- `NORM.S.INV(0.5) = 0` exactly (enforce symmetry).
- Excel uses an iterative method seeded by an approximation; its result
  agrees with high-precision quantiles to ~1e-7 in the central region.
- Suggested implementation: Acklam's rational approximation +
  (optionally) one Halley refinement — record chosen algorithm in the
  fixture header.

## Errors
- `p <= 0` or `p >= 1` -> `#NUM!` (documented; endpoints do NOT return
  -Inf/+Inf — confirm).
- Non-numeric -> `#VALUE!`.

## Examples
- `NORM.S.INV(0.908789)` -> `~1.333334` (doc example `1.333333`).
- `NORM.S.INV(0.975)` -> `1.959963986...`.
- `NORM.S.INV(0.5)` -> `0`.
- `NORM.S.INV(0.001)` -> `-3.0902323...`.

## Open questions
- Endpoint behavior confirmation.
- Tail accuracy target (absolute vs relative) for fixture tolerances.

## Engine requirements
- Inverse-normal routine in `calc-core` (std only).
