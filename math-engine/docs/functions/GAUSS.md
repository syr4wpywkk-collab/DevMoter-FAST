# GAUSS

`GAUSS(z)` — `Φ(z) - 0.5`, i.e. the standard-normal CDF minus 0.5
(probability that a standard normal falls between 0 and z).

## Arguments
- `z`: any real number; non-numeric -> `#VALUE!`.

## Semantics
- `GAUSS(z) = NORM.S.DIST(z, TRUE) - 0.5`. Negative z -> negative
  result; `GAUSS(-z) = -GAUSS(z)`.

## Errors
- None for numeric z (|z| huge -> ±0.5 by saturation).

## Examples
- `GAUSS(2)` -> `0.4772498680518208`
- `GAUSS(0)` -> `0`
- `GAUSS(-1)` -> `-0.3413447460685429`
- `GAUSS("a")` -> `#VALUE!`

## Compatibility
- Excel 2013+. No legacy equivalent.

## Engine requirements
- **Distribution numerics**: standard normal CDF (erf-based or
  rational approximation) — shared with `NORM.S.DIST`/`GAUSS`/`PHI`
  family.

## Open questions
- None.
