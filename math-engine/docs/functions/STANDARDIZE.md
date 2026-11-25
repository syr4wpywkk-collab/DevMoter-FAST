# STANDARDIZE

`STANDARDIZE(x, mean, standard_dev)` — z-score `(x - mean)/sd` of a
value against a distribution.

## Arguments
- `x`: required.
- `mean`: required; the distribution mean.
- `standard_dev`: required; `> 0` else `#NUM!`.

## Semantics
- `(x - mean) / standard_dev`; may be negative.
- Note this is a plain arithmetic normalization — it does NOT compute
  the sample mean/sd of a range.

## Errors
- `standard_dev <= 0` -> `#NUM!`.
- Non-numeric args -> `#VALUE!`.

## Examples
- `STANDARDIZE(42, 40, 1.5)` -> `1.3333333...` (Excel doc example).
- `STANDARDIZE(40, 40, 1.5)` -> `0`.
- `STANDARDIZE(38.5, 40, 1.5)` -> `-1`.
- `STANDARDIZE(10, 5, 0)` -> `#NUM!`.

## Open questions
- None (pure arithmetic; FP ordering only).
